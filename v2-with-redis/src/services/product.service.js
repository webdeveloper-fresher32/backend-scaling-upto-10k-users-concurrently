const mongoose = require("mongoose");
// 🚀 Optimized Repository: Uses ESR Covered Index + .lean() to bypass hydration
const productRepository = require("../repositories/product.repository.optimized");
const cacheService = require("./cache.service");

class ProductService {
    async getProducts(filters) {
        const { category, minPrice, maxPrice, page, limit } = filters;

        // Sanitize and provide production defaults
        const parsedMinPrice = minPrice !== undefined ? Number(minPrice) : 0;
        const parsedMaxPrice = maxPrice !== undefined ? Number(maxPrice) : 1000000;
        const parsedPage = page !== undefined ? Math.max(1, Number(page)) : 1;
        const parsedLimit = limit !== undefined ? Math.min(100, Math.max(1, Number(limit))) : 20;

        // Deterministic cache key matching query parameters
        const cacheKey = `products:cat:${category}:min:${parsedMinPrice}:max:${parsedMaxPrice}:page:${parsedPage}:limit:${parsedLimit}`;
        const TTL_SECONDS = 300; // 5 minutes cache with jitter

        return await cacheService.getOrSetWithLock(cacheKey, TTL_SECONDS, async () => {
            return await productRepository.findByCategory(
                category,
                parsedMinPrice,
                parsedMaxPrice,
                parsedPage,
                parsedLimit
            );
        });
    }

    async getProductWithReviews(productId, limit = 5) {
        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            const error = new Error("Invalid or missing product ID");
            error.statusCode = 400;
            throw error;
        }

        const parsedLimit = limit !== undefined ? Math.min(20, Math.max(1, Number(limit))) : 5;
        const cacheKey = `product:id:${productId}:reviews:${parsedLimit}`;
        const TTL_SECONDS = 600; // 10 minutes cache with jitter

        return await cacheService.getOrSetWithLock(cacheKey, TTL_SECONDS, async () => {
            const results = await productRepository.getProductWithRecentReviews(productId, parsedLimit);

            if (!results || results.length === 0) {
                const error = new Error('Product not found');
                error.statusCode = 404;
                throw error;
            }

            return results[0];
        });
    }
}

module.exports = new ProductService();
