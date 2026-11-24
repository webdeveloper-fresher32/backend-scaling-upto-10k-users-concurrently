# Module 4: Write-Path Caching & Transactional Invalidation

> *"There are only two hard things in Computer Science: cache invalidation and naming things."* — Phil Karlton

In this module, you will implement **Transactional Cache Invalidation** on the write path (`POST /api/orders`) to ensure that when orders are placed and inventory is decremented, users never see stale product stock or outdated catalog prices.

---

## 1. Architectural Strategy: Invalidation vs Write-Through

When an order updates a product's stock in MongoDB, should we:
* **Option A: Write-Through (Update Redis with new stock)**
* **Option B: Invalidate (Delete the Redis key and let read-path reload)**

### Why Invalidation (`DEL`) Wins at High Concurrency:
Under high concurrency (e.g., 50 orders per second for the same hot product), Write-Through suffers from **Write Race Conditions**:
1. Order A reads stock 10, calculates new stock 9.
2. Order B reads stock 10, calculates new stock 8.
3. Order B updates Redis to 8.
4. Order A (delayed by network) updates Redis to 9.
*Result: Redis now displays corrupted stock 9 instead of 8!*

With **Cache Invalidation (`DEL`)**:
1. Order A commits to MongoDB and deletes the Redis key.
2. Order B commits to MongoDB and deletes the Redis key.
3. The next read encounters a cache miss, acquires the stampede mutex lock, and reads the definitive atomic truth directly from MongoDB.

---

## 2. Invalidation Flow on Order Creation

```
POST /api/orders
       │
       ▼
[ Worker Threads ] ───▶ Heavy Crypto Hash Check
       │
       ▼
[ MongoDB Write ]  ───▶ Atomic Stock Decrement ($inc: { stock: -qty })
       │
   (Success)
       │
       ├───────────────────────────────┐
       ▼                               ▼
[ Invalidate Product Key ]    [ Invalidate Catalog Keys ]
DEL product:id:<productId>    SCAN & DEL products:cat:<category>:*
       │                               │
       └──────────────┬────────────────┘
                      ▼
             Return 201 Created
```

---

## 3. Updating `src/services/order.service.js`

Open **`src/services/order.service.js`** and add cache eviction logic:

```javascript
const orderRepository = require('../repositories/order.repository');
const productRepository = require('../repositories/product.repository.optimized');
const cacheService = require('./cache.service');
const { runCryptoTask } = require('../util/cryptoPool');

class OrderService {
  async createOrder({ userId, productId, quantity, clientSignature }) {
    // 1. Offload heavy CPU-bound crypto verification to worker_threads (from v1)
    const isValidSignature = await runCryptoTask({
      userId,
      productId,
      quantity,
      signature: clientSignature,
    });

    if (!isValidSignature) {
      const error = new Error('Invalid cryptographic signature.');
      error.statusCode = 401;
      throw error;
    }

    // 2. Fetch product category for catalog invalidation
    const product = await productRepository.findById(productId);
    if (!product) {
      const error = new Error('Product not found.');
      error.statusCode = 404;
      throw error;
    }

    if (product.stock < quantity) {
      const error = new Error('Insufficient inventory.');
      error.statusCode = 409;
      throw error;
    }

    // 3. Atomic Order Write + Stock Decrement in MongoDB
    const order = await orderRepository.createOrderWithInventoryReduction({
      userId,
      productId,
      quantity,
      unitPrice: product.price,
      totalPrice: product.price * quantity,
    });

    // 4. TRANSACTIONAL CACHE INVALIDATION
    // Step A: Evict the specific product key immediately
    const productKey = `product:id:${productId}`;
    await cacheService.del(productKey);

    // Step B: Evict affected catalog listings using non-blocking SCAN
    const catalogPattern = `products:cat:${product.category}:*`;
    // We run pattern eviction asynchronously so response latency stays under 10ms
    cacheService.delByPattern(catalogPattern).catch((err) => {
      console.error('[OrderService] Catalog cache eviction failed:', err.message);
    });

    return order;
  }
}

module.exports = new OrderService();
```

---

## 4. Verification Check

Let's test end-to-end cache invalidation.

### Step 1: Query Product Detail (Warming the Cache)
```bash
curl -i http://localhost:5001/api/products/65f29d20c5a31b40974b2101
```
*Observe: `X-Cache: HIT`, Stock: 50*

### Step 2: Place an Order for 2 Items
```bash
curl -i -X POST http://localhost:5001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "65f29d20c5a31b40974b9999",
    "productId": "65f29d20c5a31b40974b2101",
    "quantity": 2,
    "clientSignature": "valid_token"
  }'
```
*Observe: `HTTP/1.1 201 Created`*

### Step 3: Query Product Detail Again
```bash
curl -i http://localhost:5001/api/products/65f29d20c5a31b40974b2101
```
*Observe:*
```http
HTTP/1.1 200 OK
X-Cache: MISS
```
*The payload now displays `stock: 48`!*

### Step 4: Query Once More
```bash
curl -i http://localhost:5001/api/products/65f29d20c5a31b40974b2101
```
*Observe: `X-Cache: HIT` with `stock: 48` served straight from Redis in 350 µs!*
