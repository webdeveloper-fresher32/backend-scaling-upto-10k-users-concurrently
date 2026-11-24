const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// Configure resilient connection parameters
const redis = new Redis({
  host: REDIS_HOST,
  port: Number(REDIS_PORT),
  password: REDIS_PASSWORD,

  // 1. Connection Timeout (5 seconds): Fail fast if Redis is completely unreachable
  connectTimeout: 5000,

  // 2. Exponential Backoff Retry Strategy (50ms, 100ms... up to 2000ms max)
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    console.warn(`[Redis] Reconnecting attempt #${times} in ${delay}ms...`);
    return delay;
  },

  // 3. Keep-Alive on TCP Socket (10 seconds)
  keepAlive: 10000,

  // 4. Maximum Retries per Request
  maxRetriesPerRequest: 3,

  // 5. Offline Queue: Temporarily buffer commands if Redis drops momentarily
  enableOfflineQueue: true,
});

// Telemetry Event Listeners
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