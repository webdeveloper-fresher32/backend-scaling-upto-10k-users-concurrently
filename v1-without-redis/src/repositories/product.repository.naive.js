const Product = require('../models/product.model');

class ProductRepositoryNaive {
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
}

module.exports = new ProductRepositoryNaive();
