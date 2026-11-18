# Part 2: Domain Modeling & High-Volume Data Seeding

Testing scalability with 50 documents will yield deceptive 0ms latencies. To identify real bottlenecks under 10k concurrent users, the database must contain realistic volume: at least **500,000 products** and **1,000,000 reviews**.

---

## 1. Mongoose Models

### Product Model (`src/models/product.model.js`)
```javascript
const mongoose = require('mongoose');

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
);

module.exports = mongoose.model('Product', productSchema);
```

### Review Model (`src/models/review.model.js`)
```javascript
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 },
    isVerifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Review', reviewSchema);
```

### Order Model (`src/models/order.model.js`)
```javascript
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'CANCELLED'],
      default: 'PENDING',
    },
    paymentSignature: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
```

---

## 2. High-Performance Bulk Data Seeder (`scripts/seed.js`)

Inserting 500,000 documents one by one will take hours and crash Node's memory limit. We use `insertMany` with streaming chunks and `ordered: false` for maximum throughput.

```javascript
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const Review = require('../src/models/review.model');
const { connectDatabase } = require('../src/config/database');

const CATEGORIES = ['Electronics', 'Books', 'Home', 'Apparel', 'Automotive', 'Sports'];
const BRANDS = ['Sony', 'Apple', 'Samsung', 'Nike', 'Adidas', 'Logitech', 'Anker'];

const TOTAL_PRODUCTS = 500000;
const REVIEWS_PER_PRODUCT_SAMPLE = 2; // ~1,000,000 total reviews
const BATCH_SIZE = 5000;

async function seed() {
  await connectDatabase();
  console.log('--- Cleaning Existing Data ---');
  await Product.deleteMany({});
  await Review.deleteMany({});
  console.log('Database cleaned.');

  console.log(`--- Seeding ${TOTAL_PRODUCTS} Products ---`);
  const startTime = Date.now();
  let productIds = [];

  for (let i = 0; i < TOTAL_PRODUCTS; i += BATCH_SIZE) {
    const batch = [];
    for (let j = 0; j < BATCH_SIZE && i + j < TOTAL_PRODUCTS; j++) {
      const idx = i + j;
      batch.push({
        sku: `SKU-${idx.toString().padStart(8, '0')}`,
        title: `Product Title ${idx}`,
        category: CATEGORIES[idx % CATEGORIES.length],
        price: parseFloat((10 + (idx % 1000) * 0.99).toFixed(2)),
        stock: 50 + (idx % 500),
        rating: 3.5 + ((idx % 15) / 10),
        numReviews: 2,
        isActive: true,
        attributes: {
          brand: BRANDS[idx % BRANDS.length],
          color: idx % 2 === 0 ? 'Black' : 'White',
          size: idx % 3 === 0 ? 'L' : 'M',
        },
      });
    }

    const inserted = await Product.insertMany(batch, { ordered: false });
    // Keep a subset of IDs in memory to reference for reviews
    if (productIds.length < 50000) {
      inserted.forEach((doc) => productIds.push(doc._id));
    }

    process.stdout.write(`\rInserted ${i + batch.length} / ${TOTAL_PRODUCTS} products...`);
  }

  console.log(`\nProducts seeded in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);

  console.log('--- Seeding Reviews ---');
  const reviewStartTime = Date.now();
  const TOTAL_REVIEWS = productIds.length * REVIEWS_PER_PRODUCT_SAMPLE;

  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const reviewBatch = [];
    for (let j = 0; j < BATCH_SIZE && i + j < productIds.length; j++) {
      const prodId = productIds[i + j];
      for (let r = 1; r <= REVIEWS_PER_PRODUCT_SAMPLE; r++) {
        reviewBatch.push({
          productId: prodId,
          userId: `user_${(i + j) * 10 + r}`,
          rating: (r % 5) + 1,
          comment: `Sample review comment for product ${prodId}`,
          isVerifiedPurchase: r % 2 === 0,
        });
      }
    }
    await Review.insertMany(reviewBatch, { ordered: false });
    process.stdout.write(`\rSeeded reviews for ${i + BATCH_SIZE} products...`);
  }

  console.log(`\nReviews seeded in ${((Date.now() - reviewStartTime) / 1000).toFixed(1)}s.`);
  console.log('Data Seeding Complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
```
