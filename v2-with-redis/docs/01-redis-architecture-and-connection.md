# Module 1: Redis Architecture, Client Selection & Resilient Connection

This module covers the architectural role of Redis in our backend, selecting the right Node.js Redis client, configuring automatic connection recovery and exponential backoff retry strategies, and building `src/config/redis.js`.

---

## 1. Why Redis? Memory Mechanics vs MongoDB

In **v1**, our optimized MongoDB queries took ~1.1ms (median) by reading directly from WiredTiger's RAM B-Tree index.

Why add Redis if MongoDB was already fast?
1. **Zero B-Tree Traversal:** MongoDB must navigate B-Tree nodes to find keys ($O(\log N)$). Redis uses in-memory Hash Tables ($O(1)$ constant time lookup).
2. **Eliminating TCP & Parsing Overhead on Primary Database:** Serving 10,000 VUs from MongoDB generates 10,000 active database operations that compete with write locks and storage engine tickets. Offloading 95% of reads to Redis preserves 100% of MongoDB IOPS for orders and transactions.
3. **Sub-Millisecond Target:** Redis lookups over loopback/VPC return in **200 to 400 microseconds** ($0.2\text{ms} - 0.4\text{ms}$), cutting response times in half.

---

## 2. Client Selection: `ioredis` vs `node-redis`

For high-concurrency Node.js microservices, **`ioredis`** is the industry standard:

| Feature | `ioredis` (Selected) | `node-redis` |
| :--- | :--- | :--- |
| **Connection Pooling & Auto-Reconnect** | Built-in exponential backoff & jitter | Requires manual reconnection wrappers |
| **Cluster & Sentinel Support** | Native, production-ready drop-in | Requires separate configuration |
| **Pipeline & Multi Transactions** | Clean, fluent API with automatic batching | Supported |
| **Error Isolation** | Emits `error` events without unhandled crash | Can crash process if not caught |

---

## 3. Implementation: `src/config/redis.js`

Open or create **`src/config/redis.js`**:

```javascript
const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// Configure resilient connection parameters
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  // 1. Connection Timeout
  connectTimeout: 5000,

  // 2. Exponential Backoff Retry Strategy
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    console.warn(`[Redis] Reconnecting attempt #${times} in ${delay}ms...`);
    return delay;
  },

  // 3. Keep-Alive on TCP Socket
  keepAlive: 10000,

  // 4. Maximum Retries per Request
  maxRetriesPerRequest: 3,

  // 5. Fail Fast during startup if server is completely offline
  enableOfflineQueue: true,
});

// Event Listeners for Operational Telemetry
redis.on('connect', () => {
  console.log(`[Redis] Connected to redis://${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('ready', () => {
  console.log('[Redis] Client ready to receive commands.');
});

redis.on('error', (err) => {
  console.error('[Redis] Connection Error:', err.message);
});

redis.on('close', () => {
  console.warn('[Redis] Connection closed.');
});

module.exports = redis;
```

---

## 4. Verification Check

Before moving to Module 2, verify your connection:
```bash
# 1. Start Redis service if not already running
brew services start redis

# 2. Test connectivity via node
node -e '
const redis = require("./src/config/redis");
redis.ping().then(res => {
  console.log("Ping response:", res); // Output: PONG
  process.exit(0);
});
'
```
