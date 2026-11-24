
require('dotenv').config();

const app = require("./src/app")

const { connectDatabase } = require("./src/config/database");

const PORT = process.env.PORT || 5002;

async function startServer (){
    await connectDatabase();

    const server = app.listen(PORT,()=>{
        console.log(`[Server] Running on http:localhost:${PORT} (PID : ${process.pid})`)
    })

      // 3. High-concurrency socket tuning
    server.keepAliveTimeout = 65000; // Keep TCP socket open across consecutive requests
    server.headersTimeout = 66000;   // Must be greater than keepAliveTimeout

    // 4. Graceful shutdown handler
  const gracefulShutdown = (signal) => {
    console.log(`\n[Server] Received ${signal}. Draining active connections...`);
    server.close(() => {
      console.log('[Server] All connections closed. Exiting.');
      process.exit(0);
    });
    // Force terminate after 10s if connections refuse to drain
    setTimeout(() => {
      console.error('[Server] Forcing shutdown after timeout.');
      process.exit(1);
    }, 10000);
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();