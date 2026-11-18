const productServie = require("../services/product.service");


class ProductContoller {
    async getProducts(req, res, next) {
        try {

            const { category, minPrice, maxPrice, page, limit } = req.query;

            if (!category) {
                return res.status(400).json({
                    success: false,
                    error: {
                        message: `Query Parameter : "Category" is required `
                    }
                })
            }

            const products = await productServie.getProducts({
                category,
                minPrice,
                maxPrice,
                page,
                limit
            })

            res.status(200).json({
                success: true,
                count: products.length,
                data: products
            })

        } catch (error) {
            next(error)
        }
    }

    async getProductReviews(req, res, next) {
        try {
            const { id } = req.params;
            const { limit } = req.query;

            const product = await productServie.getProductWithReviews(id, limit);

            res.status(200).json({
                success: true,
                data: product,
            });
        } catch (error) {
            next(error);
        }
    }

}

module.exports = new ProductContoller();