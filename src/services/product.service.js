const productRepository = require("../repositories/product.repository.naive");

class ProductService {
    async getProducts(filters){
        const { category,minPrice,maxPrice,page,limit}=filters;

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
}
module.exports = new ProductService();