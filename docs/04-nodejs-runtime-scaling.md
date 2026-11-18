# Part 4: Node.js Runtime & OS Concurrency Scaling

Scaling Node.js to 10,000 concurrent users requires moving beyond default single-process configurations and tuning both the runtime and operating system.

---

## 1. Operating System Tuning (File Descriptors)

By default, macOS limits each process to 256 or 1,024 open file descriptors. Since every open TCP socket is a file descriptor in Unix, handling 10,000 concurrent connections requires raising this limit.

Check current limit:
```bash
ulimit -n
```

Raise the limit for the current shell session:
```bash
ulimit -n 65536
```

---

## 2. Multi-Core Scaling with Node.js Cluster (`cluster.js`)

Node.js runs single-threaded by default. On modern multi-core machines (e.g. 10 CPU cores), a single process leaves 90% of compute capacity unused.

The `cluster` module uses `fork()` to spawn worker processes that share the same server port via OS socket sharing (`SO_REUSEPORT` / round-robin on Unix).

```javascript
const cluster = require('cluster');
const os = require('os');
const { connectDatabase } = require('./src/config/database');
const app = require('./src/app');

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`[Master ${process.pid}] Spawning ${numCPUs} worker processes...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[Master] Worker ${worker.process.pid} died (${signal || code}). Respawning...`);
    cluster.fork();
  });
} else {
  // Worker Process Execution
  const PORT = process.env.PORT || 3000;

  connectDatabase().then(() => {
    const server = app.listen(PORT, () => {
      console.log(`[Worker ${process.pid}] Listening on port ${PORT}`);
    });

    // Keep-Alive Tuning
    server.keepAliveTimeout = 65000; // Keep sockets open longer than upstream proxy/clients
    server.headersTimeout = 66000;   // Must be greater than keepAliveTimeout
    server.maxHeadersCount = 100;

    // Graceful Shutdown
    const gracefulShutdown = (signal) => {
      console.log(`[Worker ${process.pid}] Received ${signal}. Closing server...`);
      server.close(() => {
        console.log(`[Worker ${process.pid}] Closed active connections. Exiting.`);
        process.exit(0);
      });

      // Force kill if connections don't drain within 10 seconds
      setTimeout(() => {
        console.error(`[Worker ${process.pid}] Forcing shutdown.`);
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  });
}
```

---

## 3. Offloading CPU Tasks with Worker Threads

The Node.js event loop must never be blocked by heavy computation (e.g. cryptographic signing, compression). We isolate CPU-bound tasks in a worker thread pool.

### Worker Script (`src/workers/cryptoWorker.js`)
```javascript
const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');

function computeOrderSignature(payload) {
  // Simulate heavy hashing / HMAC calculation
  let hash = payload;
  for (let i = 0; i < 50000; i++) {
    hash = crypto.createHash('sha256').update(hash).digest('hex');
  }
  return hash;
}

const signature = computeOrderSignature(workerData);
parentPort.postMessage({ signature });
```

### Worker Dispatcher (`src/utils/cryptoPool.js`)
```javascript
const { Worker } = require('worker_threads');
const path = require('path');

function runCryptoTask(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../workers/cryptoWorker.js'), {
      workerData: payload,
    });

    worker.on('message', (result) => resolve(result.signature));
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

module.exports = { runCryptoTask };
```
