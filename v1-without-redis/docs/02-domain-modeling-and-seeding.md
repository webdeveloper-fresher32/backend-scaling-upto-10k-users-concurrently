# Part 2: Domain Modeling & High-Volume Data Seeding

Testing backend performance against 50 rows in a database gives false positives: queries return in 0ms because the entire dataset fits in CPU L1/L2 cache. To simulate true production load under 10,000 concurrent users, the database must contain realistic volume: **500,000 products** and **1,000,000 reviews**.

---

## 1. Domain Schemas

### A. Product Model (`src/models/product.model.js`)
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

### B. Review Model (`src/models/review.model.js`)
```javascript
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    userId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 },
    isVerifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Review', reviewSchema);
```

### C. Order Model (`src/models/order.model.js`)
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

## 2. High-Performance Bulk Seeder (`src/scripts/seed.js`)

Inserting 500k documents via single `Product.create()` calls would take hours and crash Node's heap. Instead, we use `insertMany` with streaming batches of 5,000 documents and `ordered: false`.

```javascript
const mongoose = require('mongoose');
const Product = require('../models/product.model');
const Review = require('../models/review.model');
const { connectDatabase } = require('../config/database');

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
    // Retain a subset of IDs in memory to reference for reviews
    if (productIds.length < 50000) {
      inserted.forEach((doc) => productIds.push(doc._id));
    }

    process.stdout.write(`\rInserted ${i + batch.length} / ${TOTAL_PRODUCTS} products...`);
  }

  console.log(`\nProducts seeded in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);

  console.log('--- Seeding Reviews ---');
  const reviewStartTime = Date.now();

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

---

## 3. Running the Seeder & Verifying Count

Execute the seeder:
```bash
node src/scripts/seed.js
```

Verify that 500k documents exist in your collection:
```bash
node -e "
const mongoose = require('mongoose');
const Product = require('./src/models/product.model');
mongoose.connect('mongodb://127.0.0.1:27017/scale_10k_db').then(async () => {
  const count = await Product.countDocuments();
  console.log('Total Products in DB:', count);
  process.exit(0);
});
"
```
Output:
```text
Total Products in DB: 500000
```
