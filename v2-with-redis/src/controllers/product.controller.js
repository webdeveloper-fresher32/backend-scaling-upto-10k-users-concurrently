const productService = require("../services/product.service");

class ProductController {
    async getProducts(req, res, next) {
        try {
            const { category, minPrice, maxPrice, page, limit } = req.query;

            if (!category) {
                return res.status(400).json({
                    success: false,
                    error: {
                        message: `Query Parameter : "Category" is required `
                    }
                });
            }

            const { data: products, isHit, tier } = await productService.getProducts({
                category,
                minPrice,
                maxPrice,
                page,
                limit
            });

            // Diagnostic header: L1 (Memory 1µs), L2 (Redis 0.2ms), or MISS (DB)
            res.setHeader('X-Cache', isHit ? (tier || 'HIT') : 'MISS');
            res.status(200).json({
                success: true,
                count: products.length,
                data: products
            });

        } catch (error) {
            next(error);
        }
    }

    async getProductReviews(req, res, next) {
        try {
            const { id } = req.params;
            const { limit } = req.query;

            const { data: product, isHit, tier } = await productService.getProductWithReviews(id, limit);

            res.setHeader('X-Cache', isHit ? (tier || 'HIT') : 'MISS');
            res.status(200).json({
                success: true,
                data: product,
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ProductController();
