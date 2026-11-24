require('dotenv').config();

const app = require('./src/app');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const redis = require('./src/config/redis');

const PORT = process.env.PORT || 5002;

async function startServer() {
    // 1. Connect to MongoDB connection pool
    await connectDatabase();

    // 2. Start HTTP listener with expanded 4096 socket backlog queue
    const server = app.listen(PORT, 4096, () => {
        console.log(`[Worker ${process.pid}] Server listening on port ${PORT}`);
    });

    // 3. High-concurrency socket tuning
    server.keepAliveTimeout = 65000; // Keep TCP socket open across consecutive requests
    server.headersTimeout = 66000;   // Must be greater than keepAliveTimeout

    // 4. Multi-resource graceful shutdown handler
    const gracefulShutdown = (signal) => {
        console.log(`\n[Worker ${process.pid}] Received ${signal}. Draining active connections...`);

        // Step A: Stop accepting new HTTP requests
        server.close(async () => {
            console.log(`[Worker ${process.pid}] HTTP server closed.`);

            try {
                // Step B: Disconnect MongoDB Pool
                await disconnectDatabase();
                console.log(`[Worker ${process.pid}] MongoDB pool cleanly drained.`);

                // Step C: Disconnect Redis Client
                await redis.quit();
                console.log(`[Worker ${process.pid}] Redis connection cleanly closed.`);

                process.exit(0);
            } catch (err) {
                console.error(`[Worker ${process.pid}] Error during shutdown:`, err.message);
                process.exit(1);
            }
        });

        // Force terminate after 10s if connections refuse to drain
        setTimeout(() => {
            console.error(`[Worker ${process.pid}] Forcing shutdown after timeout.`);
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
    console.error('[Fatal Error during startup]:', err);
    process.exit(1);
});
