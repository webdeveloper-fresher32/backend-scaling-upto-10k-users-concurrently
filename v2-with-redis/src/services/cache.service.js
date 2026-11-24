const crypto = require('crypto');
const redis = require('../config/redis');

// Atomic unlock Lua script: Only deletes the lock if the value matches the owner's token
const UNLOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

class CacheService {
  /**
   * Safely retrieves a parsed JSON object from Redis.
   * Degrades gracefully to null if Redis fails.
   */
  async get(key) {
    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err) {
      console.warn(`[CacheService] GET error on "${key}": ${err.message}`);
      return null;
    }
  }

  /**
   * Sets a key with JSON serialization and randomized TTL jitter (+/- 10-20%)
   * to eliminate Cache Stampede / thundering herd.
   */
  async set(key, value, ttlSeconds = 300, enableJitter = true) {
    try {
      const serialized = JSON.stringify(value);
      let finalTtl = ttlSeconds;

      if (enableJitter && ttlSeconds > 5) {
        // Add random jitter of +/- 10%
        const jitterVariance = Math.floor(ttlSeconds * 0.1);
        const randomOffset = Math.floor(Math.random() * (jitterVariance * 2 + 1)) - jitterVariance;
        finalTtl = Math.max(1, ttlSeconds + randomOffset);
      }

      await redis.set(key, serialized, 'EX', finalTtl);
      return true;
    } catch (err) {
      console.warn(`[CacheService] SET error on "${key}": ${err.message}`);
      return false;
    }
  }

  /**
   * Deletes a single key.
   */
  async del(key) {
    try {
      await redis.del(key);
      return true;
    } catch (err) {
      console.warn(`[CacheService] DEL error on "${key}": ${err.message}`);
      return false;
    }
  }

  /**
   * Non-blocking pattern deletion using Redis SCAN cursor.
   * Replaces blocking 'KEYS *' to guarantee zero event loop freezing.
   */
  async delByPattern(pattern) {
    try {
      let cursor = '0';
      let totalDeleted = 0;

      do {
        // Scan 100 keys per iteration
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;

        if (keys && keys.length > 0) {
          const pipeline = redis.pipeline();
          keys.forEach((k) => pipeline.del(k));
          await pipeline.exec();
          totalDeleted += keys.length;
        }
      } while (cursor !== '0');

      return totalDeleted;
    } catch (err) {
      console.warn(`[CacheService] delByPattern error for "${pattern}": ${err.message}`);
      return 0;
    }
  }

  /**
   * High-Concurrency Cache Wrapper:
   * 1. Checks cache -> returns { data, isHit: true } on hit.
   * 2. On miss, acquires distributed mutex lock (SETNX with PX expiry).
   * 3. Winner executes fetchFn(), writes to cache with jitter, and releases lock via atomic Lua.
   * 4. Losers back off and spin-wait for winner's result instead of pounding MongoDB.
   * 5. Fail-Safe: If Redis is completely down, falls back to direct fetchFn() without throwing.
   */
  async getOrSetWithLock(key, ttlSeconds, fetchFn, lockTtlMs = 4000) {
    // 1. Fast Path: Cache Lookup
    const cached = await this.get(key);
    if (cached !== null) {
      return { data: cached, isHit: true };
    }

    // 2. Cache Miss: Distributed Mutex Acquisition
    const lockKey = `lock:${key}`;
    const lockToken = crypto.randomUUID();

    try {
      // SET lock:<key> <token> PX <ms> NX
      const acquired = await redis.set(lockKey, lockToken, 'PX', lockTtlMs, 'NX');

      if (acquired === 'OK') {
        // ---- WINNER OF MUTEX LOCK ----
        try {
          const freshData = await fetchFn();
          await this.set(key, freshData, ttlSeconds, true);
          return { data: freshData, isHit: false };
        } finally {
          // Atomic unlock via Lua script
          try {
            await redis.eval(UNLOCK_SCRIPT, 1, lockKey, lockToken);
          } catch (unlockErr) {
            console.warn(`[CacheService] Unlock error on "${lockKey}": ${unlockErr.message}`);
          }
        }
      } else {
        // ---- CONCURRENT REQUEST WAITING FOR WINNER ----
        // Spin-wait with exponential/linear backoff up to 2 seconds
        const maxWaitMs = 2000;
        const intervalMs = 50;
        const maxAttempts = Math.floor(maxWaitMs / intervalMs);

        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));

          const pollData = await this.get(key);
          if (pollData !== null) {
            return { data: pollData, isHit: true };
          }
        }

        // Timeout waiting for lock holder -> Fallback to direct fetch
        console.warn(`[CacheService] Lock spin timeout for "${key}". Falling back to DB query.`);
        const directData = await fetchFn();
        return { data: directData, isHit: false };
      }
    } catch (redisErr) {
      // Complete Redis failure: Graceful fallback directly to database
      console.warn(`[CacheService] Redis failure during getOrSetWithLock for "${key}": ${redisErr.message}`);
      const directData = await fetchFn();
      return { data: directData, isHit: false };
    }
  }
}

module.exports = new CacheService();
