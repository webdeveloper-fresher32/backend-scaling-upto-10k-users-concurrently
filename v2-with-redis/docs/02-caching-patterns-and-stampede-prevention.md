# Module 2: Core Caching Service & Distributed Stampede Prevention

In this module, you will build **`src/services/cache.service.js`**, implementing the **Cache-Aside** pattern, **TTL Jittering** to eliminate Cache Avalanches, and a **Distributed Mutex Lock (`SETNX`)** to prevent Cache Stampedes (Thundering Herd) when 10,000 concurrent Virtual Users hit an expired key.

---

## 1. The Anatomy of Caching Failures at 10,000 VUs

When running at 10,000 concurrent users, simple `redis.get()` and `redis.set()` calls will cause system failure under edge conditions:

### 1.1 Cache Stampede (Thundering Herd)
* **The Scenario:** Key `product:id:101` expires at $t = 0$.
* **The Disaster:** At $t = 1\text{ms}$, 1,500 concurrent requests arrive for `product:id:101`. All 1,500 check Redis, see `null` (miss), and simultaneously fire heavy database aggregation queries to MongoDB.
* **The Impact:** MongoDB pool queues explode, CPU saturates, and database latency spikes from 1ms to 5,000ms, defeating the purpose of the cache.
* **The Solution (Distributed Mutex):** The first request acquires an atomic lock in Redis (`SET lock:product:id:101 <uuid> NX EX 5`). It queries MongoDB, populates Redis, and releases the lock. The other 1,499 requests fail to acquire the lock, wait 50ms, retry, and read the populated cache!

### 1.2 Cache Avalanche
* **The Scenario:** 10,000 products are batch-cached with a static `TTL = 3600` (1 hour).
* **The Disaster:** Exactly 1 hour later, all 10,000 keys expire at the same second. The entire read traffic crashes onto MongoDB simultaneously.
* **The Solution (TTL Jittering):** Add randomized jitter to every TTL:
  $$\text{Effective TTL} = \text{Base TTL} + \text{random}(0, \text{Jitter Window})$$
  Example: A 300s TTL with a 60s jitter distributes expirations evenly between 300s and 360s.

### 1.3 Cache Penetration
* **The Scenario:** Malicious users or crawlers query random non-existent IDs (`/api/products/unknown-99999`).
* **The Disaster:** Redis never has these keys, so every single request punches straight through to MongoDB.
* **The Solution:** Cache `null` or a sentinel empty payload with a short TTL (e.g., 60 seconds).

---

## 2. Distributed Mutex Lock Architecture

```
Client Requests (10,000 Concurrent VUs)
               │
               ▼
       [ Check Redis Cache ]
          │             │
        (Hit)         (Miss)
          │             │
   Return Data          ▼
               [ Acquire Mutex Lock ]
             (SET lock:<key> NX EX 5)
                │              │
           (Acquired)      (Failed)
                │              │
         Query MongoDB    Sleep 50ms &
                │         Retry Cache Check
         Write to Redis        │
                │         Return Cached Data
         Release Lock
                │
           Return Data
```

---

## 3. Implementation: `src/services/cache.service.js`

Create **`src/services/cache.service.js`** in your project:

```javascript
const redis = require('../config/redis');
const crypto = require('crypto');

class CacheService {
  /**
   * Calculate TTL with randomized jitter to prevent Cache Avalanche
   * @param {number} baseTtlSeconds 
   * @param {number} jitterSeconds 
   * @returns {number}
   */
  getJitteredTtl(baseTtlSeconds, jitterSeconds = 30) {
    const jitter = Math.floor(Math.random() * jitterSeconds);
    return baseTtlSeconds + jitter;
  }

  /**
   * Fetch a key from Redis and deserialize JSON
   * @param {string} key 
   * @returns {Promise<any|null>}
   */
  async get(key) {
    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err) {
      console.error(`[CacheService] GET error for key ${key}:`, err.message);
      return null; // Graceful fallback: return null to let app hit DB
    }
  }

  /**
   * Store data in Redis with TTL and optional jitter
   * @param {string} key 
   * @param {any} value 
   * @param {number} ttlSeconds 
   * @param {number} jitterSeconds 
   */
  async set(key, value, ttlSeconds = 300, jitterSeconds = 30) {
    try {
      const serialized = JSON.stringify(value);
      const effectiveTtl = this.getJitteredTtl(ttlSeconds, jitterSeconds);
      await redis.set(key, serialized, 'EX', effectiveTtl);
    } catch (err) {
      console.error(`[CacheService] SET error for key ${key}:`, err.message);
    }
  }

  /**
   * Invalidate a single key
   * @param {string} key 
   */
  async del(key) {
    try {
      await redis.del(key);
    } catch (err) {
      console.error(`[CacheService] DEL error for key ${key}:`, err.message);
    }
  }

  /**
   * Invalidate multiple keys matching a pattern using non-blocking SCAN
   * CAUTION: Never use redis.keys() in production!
   * @param {string} pattern 
   */
  async delByPattern(pattern) {
    try {
      let cursor = '0';
      do {
        // Scan 100 keys per iteration without blocking Redis event loop
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      console.error(`[CacheService] delByPattern error for pattern ${pattern}:`, err.message);
    }
  }

  /**
   * Core Cache-Aside wrapper with Distributed Stampede Lock
   * 
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Database query function to execute on miss
   * @param {number} ttlSeconds - Base TTL in seconds
   * @param {object} options - Configuration for retry and jitter
   * @returns {Promise<any>}
   */
  async getOrSetWithLock(key, fetchFn, ttlSeconds = 300, options = {}) {
    const {
      jitterSeconds = 30,
      lockTtlSeconds = 5,
      maxRetries = 5,
      retryDelayMs = 50,
      cacheNull = true,
      nullTtlSeconds = 60,
    } = options;

    // Step 1: Check Cache (Fast path)
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    // Step 2: Cache Miss. Attempt to acquire Distributed Mutex Lock
    const lockKey = `lock:${key}`;
    const lockValue = crypto.randomUUID(); // Unique owner identifier

    // SET lockKey lockValue NX EX lockTtlSeconds: Atomic lock acquisition
    const acquired = await redis.set(lockKey, lockValue, 'NX', 'EX', lockTtlSeconds);

    if (acquired === 'OK') {
      try {
        // Step 3: Winner executes the DB fetch
        const freshData = await fetchFn();

        if (freshData === null || freshData === undefined) {
          // Prevent Cache Penetration: Cache null with a short TTL
          if (cacheNull) {
            await this.set(key, null, nullTtlSeconds, 0);
          }
          return null;
        }

        // Populate Cache with Jittered TTL
        await this.set(key, freshData, ttlSeconds, jitterSeconds);
        return freshData;
      } finally {
        // Step 4: Safely release lock using Lua script to verify lock ownership
        const releaseLua = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await redis.eval(releaseLua, 1, lockKey, lockValue);
      }
    } else {
      // Step 5: Failed to acquire lock. Another request is currently querying DB.
      // Wait and retry reading the cache with exponential backoff.
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        const retryData = await this.get(key);
        if (retryData !== null) {
          return retryData;
        }
      }

      // Fallback: If lock holder died or timed out, query DB directly as safeguard
      return await fetchFn();
    }
  }
}

module.exports = new CacheService();
```

---

## 4. Key Architectural Takeaways

1. **Why Lua for Lock Release?**
   If lock release was a simple `redis.del(lockKey)`, a slow query could hold the lock beyond its TTL (`EX 5`), let another process acquire it, and then accidentally delete the *other* process's lock! The Lua script guarantees atomic ownership verification (`if get == lockValue then del`).
2. **Why SCAN instead of KEYS?**
   Redis is single-threaded. Running `redis.keys('products:*')` on a dataset with 500k keys freezes the entire Redis server for hundreds of milliseconds, blocking all 10,000 VUs. `SCAN` operates via stateful pagination without blocking.
3. **Graceful Degradation:**
   If Redis crashes, `try/catch` wrappers catch the error, log a warning, and fall back to returning `null` or calling `fetchFn()`. The application stays alive even if the cache layer fails.

---

## 5. Quick Test

Test your cache service:
```bash
node -e '
const cache = require("./src/services/cache.service");

async function test() {
  console.log("Testing stampede lock...");
  const data = await cache.getOrSetWithLock("test:key", async () => {
    console.log("--> Fetching from DB simulator...");
    return { id: 1, name: "Super Widget" };
  }, 60);

  console.log("Result 1 (Miss):", data);

  const data2 = await cache.getOrSetWithLock("test:key", async () => {
    console.log("--> Fetching from DB simulator...");
    return { id: 1, name: "Super Widget" };
  }, 60);

  console.log("Result 2 (Hit):", data2);
  process.exit(0);
}

test();
'
```
*Expected Output:*
```
Testing stampede lock...
--> Fetching from DB simulator...
Result 1 (Miss): { id: 1, name: 'Super Widget' }
Result 2 (Hit): { id: 1, name: 'Super Widget' }
```
*(Notice that `--> Fetching from DB simulator...` only prints ONCE!)*
