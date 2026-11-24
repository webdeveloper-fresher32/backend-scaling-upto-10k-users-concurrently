const mongoose = require("mongoose");
// const productRepository = require("../repositories/product.repository.naive");
const productRepository = require("../repositories/product.repository.optimized");


class ProductService {
    async getProducts(filters) {
        const { category, minPrice, maxPrice, page, limit } = filters;

        // Sanitize and provide production defaults
        const parsedMinPrice = minPrice !== undefined ? Number(minPrice) : 0;
        const parsedMaxPrice = maxPrice !== undefined ? Number(maxPrice) : 1000000;
        const parsedPage = page !== undefined ? Math.max(1, Number(page)) : 1;
        const parsedLimit = limit !== undefined ? Math.min(100, Math.max(1, Number(limit))) : 20;

        return await productRepository.findByCategory(
            category,
            parsedMinPrice,
            parsedMaxPrice,
            parsedPage,
            parsedLimit
        )
    }

    async getProductWithReviews(productId, limit = 5) {
        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            const error = new Error("Invalid or missing product ID")
            error.statusCode = 400;
            throw error
        }
        // 2 . Bound limit btw 1 to 20 
        const parsedLimit = limit !== undefined ? Math.min(20, Math.max(1, Number(limit))) : 5

        // 3. Delegate to repository
        const results = await productRepository.getProductWithRecentReviews(productId, parsedLimit);
        // 4. Handle 404 Not Found
        if (!results || results.length === 0) {
            const error = new Error('Product not found');
            error.statusCode = 404;
            throw error;
        }
        // Return the single matched product object
        return results[0];
    }
}
module.exports = new ProductService();