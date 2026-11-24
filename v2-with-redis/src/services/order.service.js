const mongoose = require('mongoose');
const orderRepository = require('../repositories/order.repository');
const { runCryptoTask } = require('../util/cryptoPool');

class OrderService {
    async createOrder({ userId, items, totalAmount }) {
        // 1. Input Validation
        if (!userId || typeof userId !== 'string') {
            const error = new Error('Invalid or missing userId');
            error.statusCode = 400;
            throw error;
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            const error = new Error('Order must contain at least one item');
            error.statusCode = 400;
            throw error;
        }

        // 2. Validate items structure & calculate total
        let calculatedTotal = 0;
        for (const item of items) {
            if (!item.productId || !mongoose.Types.ObjectId.isValid(item.productId)) {
                const error = new Error('Invalid productId in order item');
                error.statusCode = 400;
                throw error;
            }
            if (!item.quantity || item.quantity < 1 || item.unitPrice === undefined) {
                const error = new Error('Item must have valid quantity and unitPrice');
                error.statusCode = 400;
                throw error;
            }
            calculatedTotal += item.quantity * item.unitPrice;
        }

        const finalAmount = totalAmount !== undefined ? Number(totalAmount) : calculatedTotal;

        // 3. Offload CPU-Bound Cryptographic Signing to Worker Threads
        const payloadToSign = JSON.stringify({
            userId,
            totalAmount: finalAmount,
            timestamp: Date.now(),
        });

        const paymentSignature = await runCryptoTask(payloadToSign);

        // 4. Persist Order to Database
        const orderData = {
            userId,
            items,
            totalAmount: finalAmount,
            status: 'CONFIRMED',
            paymentSignature,
        };

        return await orderRepository.createOrder(orderData);
    }

    async getUserOrders(userId, limit = 10) {
        if (!userId) {
            const error = new Error('userId is required');
            error.statusCode = 400;
            throw error;
        }
        const parsedLimit = limit !== undefined ? Math.min(50, Math.max(1, Number(limit))) : 10;
        return await orderRepository.getOrderByUserId(userId, parsedLimit);
    }
}

module.exports = new OrderService();