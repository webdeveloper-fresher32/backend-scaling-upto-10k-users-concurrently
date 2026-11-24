const Product = require('../models/product.model');
const mongoose = require('mongoose');

class ProductRepositoryNaive {
  /**
   * Unoptimized catalog query:
   * - No .lean() (V8 hydrates every document into a heavy Mongoose model)
   * - No covered projection (MongoDB must fetch full documents from disk/RAM)
   * - Collscan / unoptimized sort under load
   */
  async findByCategory(category, minPrice, maxPrice, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    return await Product.find({
      category: category,
      price: { $gte: minPrice, $lte: maxPrice },
    })
      .sort({ price: 1 })
      .skip(skip)
      .limit(limit);
  }

  /**
   * Unoptimized product detail query:
   * - Performs unbounded $lookup joining all reviews into memory
   */
  async getProductWithRecentReviews(productId, limit = 5) {
    return await Product.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(productId) } },
      {
        $lookup: {
          from: 'reviews',
          localField: '_id',
          foreignField: 'productId',
          as: 'reviews',
        },
      },
    ]);
  }
}

module.exports = new ProductRepositoryNaive();
