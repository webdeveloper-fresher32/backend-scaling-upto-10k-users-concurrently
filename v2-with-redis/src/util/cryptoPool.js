const { Worker } = require("worker_threads");
const path = require("path");

function runCryptoTask(payload) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, "../workers/cryptoWorker.js"), {
            workerData: payload
        })
        worker.on("message", (res) => resolve(res.signature))
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
        });
    })
}
module.exports = { runCryptoTask }