const { parentPort, workerData } = require("worker_threads");
const crypto = require("crypto");

function computeOrderSignature(payload) {
    let hash = payload;
    for (let i = 0; i < 50000; i++) {
        hash = crypto.createHash("sha256").update(hash).digest("hex");
    }
    return hash
}

const signature = computeOrderSignature(workerData);
parentPort.postMessage({ signature })