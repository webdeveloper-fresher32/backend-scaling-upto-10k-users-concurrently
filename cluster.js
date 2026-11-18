const cluster = require("cluster");
const os = require("os");
const { connectDatabase } = require("./src/config/database");


const app = require("./src/app");

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
    console.log(`[Master] ${process.pid} Spawing ${numCPUs} worker processess.......`);


    for (let i = 0; i < numCPUs; i++) {
        cluster.fork()
    }

    cluster.on("exit", (worker, code, signal) => {
        console.warn(`[Master] Worker ${worker.process.pid} died  (${signal || code}). Respawning...`)
        cluster.fork();
    })
} else {
    const PORT = process.env.PORT || 3000;

    connectDatabase().then(() => {
        const server = app.listen(PORT, () => {
            console.log(` Worker ${process.pid} Listening on port ${PORT}`)
        })
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

    })
}