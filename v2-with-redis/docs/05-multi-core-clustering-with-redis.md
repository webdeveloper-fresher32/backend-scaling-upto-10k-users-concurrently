# Module 5: Clustered Multi-Core Scaling with Redis

In this module, you will configure Node.js **Multi-Core Clustering** alongside **Redis** and implement **production-grade Graceful Shutdown** across all worker processes.

---

## 1. Multi-Core Process Model with Centralized Redis

In Node.js, each worker process runs on an isolated V8 thread with its own memory space:

```
                  ┌─────────────────────────────────────────┐
                  │           Linux / macOS Kernel          │
                  │   OS Round-Robin Port 5001 Balancing    │
                  └────────────────────┬────────────────────┘
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        ▼              ▼               ▼               ▼              ▼
  [ Worker 1 ]   [ Worker 2 ]    [ Worker 3 ]    [ Worker 4 ]   ... [ Worker 10 ]
   (Core 0)       (Core 1)        (Core 2)        (Core 3)           (Core 9)
        │              │               │               │              │
        │ 1 TCP Conn   │ 1 TCP Conn    │ 1 TCP Conn    │ 1 TCP Conn   │ 1 TCP Conn
        ▼              ▼               ▼               ▼              ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                       Centralized Redis Engine                         │
   │               Shared In-Memory Hash Table & Mutex Locks                │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       │
                       (Cache Miss Fallback Only: < 5%)
                                       ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                           MongoDB Replica Set                          │
   │                 Indexed WiredTiger Storage Engine                      │
   └────────────────────────────────────────────────────────────────────────┘
```

### Why Redis is the Ultimate Multi-Core Synchronizer
In a clustered Node.js application, in-memory variables (`const cache = {}`) **do not share memory** across CPU cores. If Worker 1 caches a product in RAM, Worker 2 through 10 cannot see it.
Redis solves this: all 10 workers read from and write to the same single Redis instance.
* When Worker 1 acquires a stampede lock (`SET lock:product:id:101 ... NX`), Workers 2 through 10 immediately observe the lock and wait.
* When Worker 3 places an order and invalidates a key, Workers 1, 2, and 4 through 10 immediately observe the invalidation.

---

## 2. Connection Math: Sizing Pools Correctly

| Component | Architecture | Connections per Worker | Total System Connections (10 Cores) |
| :--- | :--- | :--- | :--- |
| **MongoDB** | Connection Pool | 50 sockets (`maxPoolSize: 50`) | $10 \times 50 = 500$ sockets |
| **Redis** | Multiplexed TCP Stream | 1 client (`ioredis`) | $10 \times 1 = 10$ sockets |

Because Redis is single-threaded and executes commands sequentially in nanoseconds, **a single persistent TCP connection per Node.js process** handles tens of thousands of requests per second through command pipelining. You do not need a connection pool for Redis.

---

## 3. Implementation: `cluster.js`

Create or update **`cluster.js`**:

```javascript
const cluster = require('cluster');
const os = require('os');
const path = require('path');

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`[Master ${process.pid}] Multi-Core Clustered Mode active.`);
  console.log(`[Master ${process.pid}] Spawning ${numCPUs} worker processes across all CPU cores...`);

  // Fork a worker for each CPU core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Handle worker failures with automatic resurrection
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[Master] Worker ${worker.process.pid} died (${signal || code}). Resurrecting worker...`);
    cluster.fork();
  });

  // Forward shutdown signals to all workers
  const shutdownMaster = () => {
    console.log('\n[Master] Graceful shutdown initiated. Terminating workers...');
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill('SIGTERM');
    }
  };

  process.on('SIGINT', shutdownMaster);
  process.on('SIGTERM', shutdownMaster);
} else {
  // Worker process: Boot the Express HTTP server
  require('./server');
}
```

---

## 4. Implementation: `server.js` with Multi-Resource Graceful Shutdown

Open **`server.js`** to ensure clean tear-down of HTTP listeners, MongoDB pools, and Redis connections:

```javascript
require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { connectDB, disconnectDB } = require('./src/config/database');
const redis = require('./src/config/redis');

const PORT = process.env.PORT || 5001;

async function bootstrap() {
  // 1. Initialize MongoDB connection pool
  await connectDB();

  // 2. Redis client auto-connects via src/config/redis.js

  // 3. Create HTTP server with tuned keep-alive
  const server = http.createServer(app);

  // Keep-alive header timeout tuned for high-concurrency reuse
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.listen(PORT, () => {
    console.log(`[Worker ${process.pid}] Server listening on port ${PORT}`);
  });

  // 4. Graceful Shutdown Handler
  const shutdown = async (signal) => {
    console.log(`\n[Worker ${process.pid}] Received ${signal}. Starting graceful shutdown...`);

    // Step A: Stop accepting new HTTP requests
    server.close(async () => {
      console.log(`[Worker ${process.pid}] HTTP server closed.`);

      try {
        // Step B: Disconnect MongoDB Pool
        await disconnectDB();
        console.log(`[Worker ${process.pid}] MongoDB connection pool drained.`);

        // Step C: Disconnect Redis Client
        await redis.quit();
        console.log(`[Worker ${process.pid}] Redis connection cleanly closed.`);

        process.exit(0);
      } catch (err) {
        console.error(`[Worker ${process.pid}] Error during shutdown:`, err.message);
        process.exit(1);
      }
    });

    // Force exit if graceful shutdown takes longer than 10 seconds
    setTimeout(() => {
      console.error(`[Worker ${process.pid}] Force shutdown timeout reached. Terminating.`);
      process.exit(1);
    }, 10000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Fatal Error during startup]:', err);
  process.exit(1);
});
```

---

## 5. Verification Check

Launch the cluster:
```bash
node cluster.js
```

*Expected Terminal Output:*
```
[Master 38410] Multi-Core Clustered Mode active.
[Master 38410] Spawning 10 worker processes across all CPU cores...
[Worker 38412] Connected to MongoDB replica set.
[Worker 38412] [Redis] Connected to redis://127.0.0.1:6379
[Worker 38412] Server listening on port 5001
[Worker 38413] Server listening on port 5001
...
[Worker 38421] Server listening on port 5001
```

Press `Ctrl + C` to test graceful shutdown:
```
^C
[Master] Graceful shutdown initiated. Terminating workers...
[Worker 38412] Received SIGTERM. Starting graceful shutdown...
[Worker 38412] HTTP server closed.
[Worker 38412] MongoDB connection pool drained.
[Worker 38412] Redis connection cleanly closed.
```
All resources clean up cleanly with zero leaked file descriptors or orphaned sockets!
