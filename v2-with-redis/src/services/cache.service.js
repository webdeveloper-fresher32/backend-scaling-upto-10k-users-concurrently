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
  constructor() {
    // Tier 1: Ultra-fast in-memory L1 cache (Per-Process V8 RAM)
    // Eliminates TCP socket roundtrips and OS kernel context switching
    this.l1Cache = new Map();
    this.L1_TTL_MS = 5000; // 5-second micro-cache: absorbs 20k VU spikes while keeping data strictly fresh

    // Periodic cleanup of expired L1 entries every 10 seconds to keep memory lean
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.l1Cache.entries()) {
        if (now > item.expiresAt) {
          this.l1Cache.delete(key);
        }
      }
    }, 10000).unref(); // .unref() ensures timer does not block graceful shutdown
  }

  /**
   * Tier 1 Check: In-Process Memory Lookup (0.001 ms - ZERO network/TCP sockets)
   */
  getL1(key) {
    const item = this.l1Cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.l1Cache.delete(key);
      return null;
    }
    return item.data;
  }

  /**
   * Set In-Process Memory Cache with size bounding (LRU-like eviction)
   */
  setL1(key, data, ttlMs = this.L1_TTL_MS) {
    // Bound L1 size to 1,000 hot entries per worker process to protect RAM
    if (this.l1Cache.size > 1000) {
      const firstKey = this.l1Cache.keys().next().value;
      this.l1Cache.delete(firstKey);
    }
    this.l1Cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Two-Tier GET:
   * 1. Check L1 Memory (0.001 ms)
   * 2. Check L2 Redis (0.2 ms) -> populates L1
   */
  async get(key) {
    const l1Data = this.getL1(key);
    if (l1Data !== null) {
      return l1Data;
    }

    try {
      const data = await redis.get(key);
      if (!data) return null;
      const parsed = JSON.parse(data);
      this.setL1(key, parsed);
      return parsed;
    } catch (err) {
      console.warn(`[CacheService] GET error on "${key}": ${err.message}`);
      return null;
    }
  }

  /**
   * Sets a key in both L1 (Memory) and L2 (Redis) with randomized TTL jitter.
   */
  async set(key, value, ttlSeconds = 300, enableJitter = true) {
    this.setL1(key, value);

    try {
      const serialized = JSON.stringify(value);
      let finalTtl = ttlSeconds;

      if (enableJitter && ttlSeconds > 5) {
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
   * Deletes a single key from both L1 and L2.
   */
  async del(key) {
    this.l1Cache.delete(key);
    try {
      await redis.del(key);
      return true;
    } catch (err) {
      console.warn(`[CacheService] DEL error on "${key}": ${err.message}`);
      return false;
    }
  }

  /**
   * Non-blocking pattern deletion using Redis SCAN cursor + L1 flush.
   */
  async delByPattern(pattern) {
    this.l1Cache.clear();

    try {
      let cursor = '0';
      let totalDeleted = 0;

      do {
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
   * High-Concurrency Two-Tier Cache Wrapper:
   * 1. Check L1 In-Memory Cache (0.001 ms) -> returns { data, isHit: true, tier: 'L1' }
   * 2. Check L2 Redis Cache (0.2 ms) -> populates L1 -> returns { data, isHit: true, tier: 'L2' }
   * 3. On dual miss, acquire distributed mutex lock (SETNX).
   * 4. Winner queries MongoDB, writes to Redis + L1, unlocks Lua.
   * 5. Losers spin-wait on L1/L2.
   */
  async getOrSetWithLock(key, ttlSeconds, fetchFn, lockTtlMs = 4000) {
    // 1. Tier 1: Check L1 Process Memory Cache (Instant 1 microsecond!)
    const l1Data = this.getL1(key);
    if (l1Data !== null) {
      return { data: l1Data, isHit: true, tier: 'L1' };
    }

    // 2. Tier 2: Check L2 Shared Redis Cache (~0.2 ms)
    const l2Data = await this.get(key);
    if (l2Data !== null) {
      return { data: l2Data, isHit: true, tier: 'L2' };
    }

    // 3. Dual Cache Miss: Distributed Mutex Acquisition
    const lockKey = `lock:${key}`;
    const lockToken = crypto.randomUUID();

    try {
      const acquired = await redis.set(lockKey, lockToken, 'PX', lockTtlMs, 'NX');

      if (acquired === 'OK') {
        // ---- WINNER OF MUTEX LOCK ----
        try {
          const freshData = await fetchFn();
          await this.set(key, freshData, ttlSeconds, true);
          return { data: freshData, isHit: false, tier: 'DB' };
        } finally {
          try {
            await redis.eval(UNLOCK_SCRIPT, 1, lockKey, lockToken);
          } catch (unlockErr) {
            console.warn(`[CacheService] Unlock error on "${lockKey}": ${unlockErr.message}`);
          }
        }
      } else {
        // ---- CONCURRENT REQUEST WAITING FOR WINNER ----
        const maxWaitMs = 1500;
        const intervalMs = 25;
        const maxAttempts = Math.floor(maxWaitMs / intervalMs);

        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));

          const pollData = this.getL1(key) || await this.get(key);
          if (pollData !== null) {
            return { data: pollData, isHit: true, tier: 'L2' };
          }
        }

        const directData = await fetchFn();
        return { data: directData, isHit: false, tier: 'DB' };
      }
    } catch (redisErr) {
      console.warn(`[CacheService] Redis failure during getOrSetWithLock for "${key}": ${redisErr.message}`);
      const directData = await fetchFn();
      return { data: directData, isHit: false, tier: 'DB' };
    }
  }
}

module.exports = new CacheService();
