const mongoose = require('mongoose');
const orderRepository = require('../repositories/order.repository');
const Product = require('../models/product.model');
const cacheService = require('./cache.service');
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
        const categoriesToInvalidate = new Set();

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

        // 4. Atomic Inventory Reduction in MongoDB
        for (const item of items) {
            const updateResult = await Product.updateOne(
                { _id: item.productId, stock: { $gte: item.quantity } },
                { $inc: { stock: -item.quantity } }
            );

            if (updateResult.matchedCount === 0) {
                const error = new Error(`Insufficient stock or invalid product for ID ${item.productId}`);
                error.statusCode = 409;
                throw error;
            }

            // Fetch product category for targeted cache invalidation
            const prod = await Product.findById(item.productId).select('category').lean();
            if (prod && prod.category) {
                categoriesToInvalidate.add(prod.category);
            }
        }

        // 5. Persist Order to Database
        const orderData = {
            userId,
            items,
            totalAmount: finalAmount,
            status: 'CONFIRMED',
            paymentSignature,
        };

        const createdOrder = await orderRepository.createOrder(orderData);

        // 6. TRANSACTIONAL CACHE INVALIDATION
        // Step A: Invalidate product detail keys immediately
        for (const item of items) {
            const productPattern = `product:id:${item.productId}*`;
            await cacheService.delByPattern(productPattern);
        }

        // Step B: Asynchronously invalidate affected catalog listings using non-blocking SCAN
        for (const category of categoriesToInvalidate) {
            const catalogPattern = `products:cat:${category}*`;
            cacheService.delByPattern(catalogPattern).catch((err) => {
                console.warn(`[OrderService] Async catalog cache eviction failed for "${catalogPattern}":`, err.message);
            });
        }

        return createdOrder;
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
