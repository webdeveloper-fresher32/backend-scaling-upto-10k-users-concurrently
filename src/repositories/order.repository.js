const Order = require("../models/order.model");

class OrderRepository {
    async createOrder(orderData, writeConcern = {
        w: 1, wtimeoutMS: 5000
    }) {
        const order = new Order(orderData);
        await order.save(writeConcern);
        return order.toObject();
    }
    async getOrderByUserId(userId, limit = 10) {
        return await Order.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean()
    }
}

module.exports = new OrderRepository();