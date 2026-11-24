const mongoose = require("mongoose");
const Product = require('../models/product.model');

class ProductRepositoryOptimized {
    async findByCategory(category, minPrice, maxPrice, page = 1, limit = 20) {
        const skip = (page - 1) * limit;

        return await Product.find({
            category: category,
            isActive: true,
            price: { $gte: minPrice, $lte: maxPrice },
        })
            // .select('sku title category price stock rating attributes')
            .select('-_id sku title category price stock rating')
            .sort({ price: 1 })
            .skip(skip)
            .limit(limit)
            .lean(); // Bypasses Mongoose document hydration
    }

    async getProductWithRecentReviews(productId, limit = 5) {
        return await Product.aggregate([
            // Stage 1: Match the specific product (uses _id primary index)
            {
                $match: { _id: new mongoose.Types.ObjectId(productId) },
            },
            // Stage 2: Project only the product fields we want to expose
            {
                $project: {
                    sku: 1,
                    title: 1,
                    category: 1,
                    price: 1,
                    stock: 1,
                    rating: 1,
                    numReviews: 1,
                },
            },
            // Stage 3: Sub-pipeline $lookup on the reviews collection
            {
                $lookup: {
                    from: 'reviews', // collection name in MongoDB
                    let: { pId: '$_id' }, // captures product _id as variable $$pId
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$productId', '$$pId'] }, // Uses our { productId: 1, createdAt: -1 } index!
                            },
                        },
                        { $sort: { createdAt: -1 } }, // Newest first
                        { $limit: limit }, // Caps to top N reviews
                        {
                            $project: {
                                _id: 1,
                                rating: 1,
                                comment: 1,
                                userId: 1,
                                createdAt: 1,
                            },
                        },
                    ],
                    as: 'recentReviews',
                },
            },
        ]);
    }
}

module.exports = new ProductRepositoryOptimized();