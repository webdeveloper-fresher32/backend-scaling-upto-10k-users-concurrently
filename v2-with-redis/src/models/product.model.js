const mongoose = require("mongoose");


const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    stock: { type: Number, required: true, default: 0 },
    rating: { type: Number, default: 0 },
    numReviews: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    attributes: {
      brand: String,
      color: String,
      size: String,
    },
  },
  { timestamps: true }
)

productSchema.index({
  category: 1,
  isActive: 1,
  price: 1,
  sku: 1,
  title: 1,
  stock: 1,
  rating: 1,
})

module.exports = mongoose.model("Product", productSchema);