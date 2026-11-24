const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');

router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'Order route active',
    });
});

// 1. High-Throughput Write Path (Offloads Crypto to Worker Threads)
router.post('/', (req, res, next) => {
    orderController.createOrder(req, res, next);
});

// 2. Fetch User Order History (Uses Compound Index { userId: 1, createdAt: -1 })
router.get('/user/:userId', (req, res, next) => {
    orderController.getUserOrders(req, res, next);
});

module.exports = router;