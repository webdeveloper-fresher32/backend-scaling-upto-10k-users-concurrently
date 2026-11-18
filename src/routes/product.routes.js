
const express = require("express");

const router = express.Router();

const productController = require("../controllers/product.controller");


router.get("/", (req, res, next) => {
    productController.getProducts(req, res, next)
});

router.get("/:id/reviews", (req, res, next) => {
    productController.getProductReviews(req, res, next);
});

module.exports = router;


