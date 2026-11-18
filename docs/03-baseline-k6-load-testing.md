# Part 3: Baseline Load Testing with k6 & Bottleneck Discovery

Before optimizing, we must measure the unoptimized application to identify failure modes under load.

---

## 1. Installing k6

On macOS (using Homebrew):
```bash
brew install k6
```

Verify installation:
```bash
k6 version
```

---

## 2. The Naive (Unoptimized) Implementation

To demonstrate real bottlenecks, we start with a standard but unoptimized implementation.

### Naive Repository (`src/repositories/product.repository.naive.js`)
```javascript
const Product = require('../models/product.model');

class ProductRepositoryNaive {
  // Problems:
  // 1. No index on { category: 1, price: 1 } -> Full collection scan (COLLSCAN)
  // 2. Returns full Mongoose documents (hydrates Mongoose getters, setters, internals)
  // 3. Fetches all fields without projection
  async findByCategory(category, minPrice, maxPrice, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    return await Product.find({
      category: category,
      price: { $gte: minPrice, $lte: maxPrice },
    })
      .sort({ price: 1 })
      .skip(skip)
      .limit(limit);
  }
}

module.exports = new ProductRepositoryNaive();
```

---

## 3. k6 Test Script (`k6/catalog-load-test.js`)

This script ramps Virtual Users (VUs) from 100 up to 10,000 to test both read and write traffic.

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 500 },    // Warm-up to 500 VUs
    { duration: '1m', target: 2000 },    // Ramp up to 2,000 VUs
    { duration: '2m', target: 5000 },    // Stress at 5,000 VUs
    { duration: '2m', target: 10000 },   // Spike to 10,000 VUs
    { duration: '1m', target: 0 },       // Cool down
  ],
  thresholds: {
    // 95% of requests must complete below 300ms
    http_req_duration: ['p(95)<300', 'p(99)<1000'],
    // Error rate must remain under 1%
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const CATEGORIES = ['Electronics', 'Books', 'Home', 'Apparel', 'Sports'];

export default function () {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const minPrice = 10;
  const maxPrice = 500;
  const page = Math.floor(Math.random() * 5) + 1;

  const url = `${BASE_URL}/api/products?category=${category}&minPrice=${minPrice}&maxPrice=${maxPrice}&page=${page}`;

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    },
  };

  const res = http.get(url, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 500ms': (r) => r.timings.duration < 500,
  });

  // Simulate realistic user think time (1 to 2 seconds)
  sleep(Math.random() * 1 + 1);
}
```

---

## 4. Running the Test & Monitoring Bottlenecks

1. Start the single-process unoptimized backend:
   ```bash
   node server.js
   ```
2. In a separate terminal, run k6:
   ```bash
   k6 run k6/catalog-load-test.js
   ```

### What Happens to the Unoptimized Server at 2,000+ VUs:
1. **CPU Saturation (Single Core at 100%):** Because `node server.js` runs on 1 core, it cannot process incoming requests fast enough.
2. **Event Loop Lag Spikes:** Unindexed MongoDB queries hold the event loop waiting, and Mongoose document hydration burns CPU memory cycles.
3. **Database COLLSCAN:** MongoDB scans 500,000 documents for every incoming query, overloading WiredTiger cache.
4. **Socket Hang-ups (`ECONNRESET` / `ETIMEDOUT`):** The Express backlog queue overflows, causing k6 to report error rates $> 40\%$.
