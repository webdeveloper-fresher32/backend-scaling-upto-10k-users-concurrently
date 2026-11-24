const cluster = require('cluster');
const os = require('os');

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`[Master ${process.pid}] Multi-Core Clustered Mode active.`);
  console.log(`[Master ${process.pid}] Spawning ${numCPUs} worker processes across all CPU cores...`);

  // Fork a worker process for each core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Handle worker failures with automatic resurrection
  cluster.on('exit', (worker, code, signal) => {
    // Only resurrect if the worker died unexpectedly (crash), not on clean shutdown
    if (signal !== 'SIGTERM' && signal !== 'SIGINT' && code !== 0) {
      console.warn(`[Master] Worker ${worker.process.pid} died (${signal || code}). Resurrecting worker...`);
      cluster.fork();
    } else {
      console.log(`[Master] Worker ${worker.process.pid} exited cleanly.`);
    }
  });

  // Master graceful shutdown: forward signals to all workers
  const shutdownMaster = () => {
    console.log('\n[Master] Graceful shutdown initiated. Terminating workers...');
    for (const id in cluster.workers) {
      if (cluster.workers[id]) {
        cluster.workers[id].process.kill('SIGTERM');
      }
    }
  };

  process.on('SIGINT', shutdownMaster);
  process.on('SIGTERM', shutdownMaster);
} else {
  // Each worker runs server.js and handles its share of incoming TCP connections
  require('./server');
}
