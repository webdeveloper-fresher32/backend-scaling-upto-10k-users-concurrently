# Part 5: MongoDB Deep Optimization (Scaling Without Redis)

When Redis cannot be used, database performance directly determines system throughput. Sub-millisecond queries can be achieved by eliminating document hydration, applying the ESR indexing rule, and serving covered queries directly from RAM.

---

## 1. Eliminating Document Hydration with `.lean()`

By default, Mongoose wraps every returned database document in a heavy `HydratedDocument` instance (attaching change tracking, getters, setters, schema validation, and middleware hooks).

```javascript
// BAD: Generates thousands of complex V8 objects, triggering frequent GC pauses
const products = await Product.find({ category: 'Electronics' });

// GOOD: Returns plain JavaScript Objects (POJOs), reducing V8 heap usage by up to 70%
const products = await Product.find({ category: 'Electronics' }).lean();
```

---

## 2. The ESR Indexing Rule (Equality, Sort, Range)

To prevent in-memory sorts and full scans, compound index fields must follow the **ESR Rule**:

1. **Equality (E):** Fields tested for exact equality (e.g., `{ category: 'Electronics', isActive: true }`).
2. **Sort (S):** Fields determining the order (e.g., `.sort({ price: 1 })`).
3. **Range (R):** Fields filtered with range operators (e.g., `{ price: { $gte: 50, $lte: 200 } }`).

### Creating the Compound Index
```javascript
// Migration script or schema index definition:
productSchema.index({ category: 1, isActive: 1, price: 1 });
```

---

## 3. Covered Queries (`totalDocsExamined: 0`)

An **index-covered query** occurs when all fields requested in the filter and projection are already present inside the index key. MongoDB satisfies the entire query from the RAM index structure without reading the underlying document from disk or cache.

```javascript
// If the index is: { category: 1, price: 1, sku: 1, title: 1 }
// This query is 100% COVERED:
const results = await Product.find(
  { category: 'Electronics', price: { $lte: 200 } },
  { _id: 0, category: 1, price: 1, sku: 1, title: 1 }
).lean();
```

Verify in `mongosh`:
```javascript
db.products.find(
  { category: "Electronics", price: { $lte: 200 } },
  { _id: 0, category: 1, price: 1, sku: 1, title: 1 }
).explain("executionStats");

// Look for:
// "stage": "IXSCAN"
// "totalDocsExamined": 0
```

---

## 4. Optimized Aggregation Pipelines with `$lookup`

Naive `$lookup` operations cause nested document iteration across large collections. To prevent this, use pipeline `$lookup` with early `$match` and selective `$project`:

```javascript
const getProductWithRecentReviews = async (productId) => {
  return await Product.aggregate([
    {
      $match: { _id: new mongoose.Types.ObjectId(productId) },
    },
    {
      $project: {
        title: 1,
        price: 1,
        category: 1,
        rating: 1,
      },
    },
    {
      $lookup: {
        from: 'reviews',
        let: { pId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$productId', '$$pId'] },
            },
          },
          { $sort: { createdAt: -1 } },
          { $limit: 5 }, // Only fetch 5 most recent reviews
          { $project: { rating: 1, comment: 1, userId: 1, createdAt: 1 } },
        ],
        as: 'recentReviews',
      },
    },
  ]);
};
```

---

## 5. Read Preferences & Write Concerns

### Read Preferences (Replica Sets)
When running a MongoDB Replica Set:
- `primary`: Default. Guarantees read-after-write consistency.
- `secondaryPreferred`: Offloads high-volume reads (e.g., catalog searches) to secondary nodes, preserving primary node IOPS for write operations.

```javascript
const products = await Product.find({ category: 'Electronics' })
  .read('secondaryPreferred')
  .lean();
```

### Write Concerns
- `w: 1`: Returns acknowledgment as soon as the primary node writes to memory. Maximizes throughput.
- `w: 'majority'`: Waits for a majority of replica set nodes to commit. Maximizes durability.

```javascript
// High-throughput order placement:
await order.save({ w: 'majority', wtimeoutMS: 5000 });
```
