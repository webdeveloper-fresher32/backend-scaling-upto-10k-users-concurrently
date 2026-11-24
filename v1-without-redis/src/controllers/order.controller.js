

const orderService = require('../services/order.service');

class OrderController {
  async createOrder(req, res, next) {
    try {
      const { userId, items, totalAmount } = req.body;

      const order = await orderService.createOrder({
        userId,
        items,
        totalAmount,
      });

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserOrders(req, res, next) {
    try {
      const { userId } = req.params;
      const { limit } = req.query;

      const orders = await orderService.getUserOrders(userId, limit);

      res.status(200).json({
        success: true,
        count: orders.length,
        data: orders,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new OrderController();
