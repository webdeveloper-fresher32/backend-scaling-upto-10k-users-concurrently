# Phase 2: High-Concurrency Node.js Backend with Distributed Redis Caching

Welcome to the **v2 Architecture Implementation Guide**. In this phase, we evolve our high-concurrency Node.js + MongoDB backend by introducing **Redis** as a distributed in-memory caching and lock coordination layer.

---

## 🎯 What We Are Achieving in v2

In **v1**, we achieved 10,000 concurrent Virtual Users through pure database engineering (5.43ms p95 latency, `totalDocsExamined: 0`). 
In **v2**, we integrate Redis to unlock **ultra-low sub-millisecond latencies (< 500 µs)** and offload **95%+ of query volume** from MongoDB, while guarding against classic distributed caching hazards.

### The 4 Major Caching Hazards Solved in v2:
1. **Cache Stampede (Thundering Herd):** Preventing 10,000 concurrent requests from slamming MongoDB simultaneously when a popular cache key expires, using a **Distributed Mutex Lock (`SETNX`)**.
2. **Cache Avalanche:** Preventing mass simultaneous key expirations by applying **TTL Jittering** (randomized expiration offsets).
3. **Cache Penetration:** Preventing queries for non-existent IDs from repeatedly hitting MongoDB by caching empty null states with short TTLs.
4. **Data Inconsistency (Stale Cache):** Implementing transactional **Cache Invalidation** on write paths (`POST /api/orders`) to guarantee users never see outdated catalog stock or stale review data.

---

## 📚 Module-by-Module Implementation Roadmap

Follow these 6 comprehensive guides in order:

| Module | Title | Core Focus | Files Built / Modified |
| :--- | :--- | :--- | :--- |
| **[Module 1](01-redis-architecture-and-connection.md)** | **Redis Architecture & Resilient Connection** | Client selection (`ioredis`), connection retry strategy, keep-alive, error handling | `src/config/redis.js`, `src/config/database.js` |
| **[Module 2](02-caching-patterns-and-stampede-prevention.md)** | **Core Caching Service & Stampede Mutex Locks** | Generic Cache-Aside, distributed locking (`SET key val NX EX`), TTL jittering | `src/services/cache.service.js` |
| **[Module 3](03-read-path-caching-and-catalog.md)** | **Read-Path Caching (Catalog & Reviews)** | Caching product listings, single product lookups, review sub-pipelines | `src/services/product.service.js`, `src/controllers/product.controller.js` |
| **[Module 4](04-write-path-cache-invalidation.md)** | **Write-Path Caching & Invalidation** | Cache Invalidation vs Write-Through, transactional order placement, stock eviction | `src/services/order.service.js`, `src/repositories/order.repository.js` |
| **[Module 5](05-multi-core-clustering-with-redis.md)** | **Clustered Multi-Core Runtime with Redis** | Sharing Redis across 10 worker processes, connection pooling multiplier, graceful shutdown | `cluster.js`, `server.js` |
| **[Module 6](06-k6-load-testing-and-benchmarking.md)** | **10,000 VU k6 Load Testing & v1 vs v2 Comparison** | Running k6 stress tests, measuring Cache Hit Ratio, p95/p99 comparisons vs v1 | `k6/catalog-load-test.js` |

---

## 🏛️ v2 Target Directory Structure

```
v2-with-redis/
├── src/
│   ├── config/
│   │   ├── database.js               # MongoDB connection pool (from v1)
│   │   └── redis.js                  # Resilient ioredis client with retry logic
│   ├── services/
│   │   ├── cache.service.js          # Generic Cache-Aside + Stampede Lock + TTL Jitter
│   │   ├── product.service.js        # Product queries with Redis cache integration
│   │   └── order.service.js          # Order placement with cache invalidation
│   ├── repositories/
│   │   ├── product.repository.optimized.js # MongoDB covered index queries (fallback on cache miss)
│   │   └── order.repository.js       # Order creation with write concerns
│   ├── models/
│   │   ├── product.model.js          # Product schema & ESR covered index
│   │   ├── order.model.js            # Order schema & user index
│   │   └── review.model.js           # Review schema & foreign lookup index
│   ├── controllers/
│   │   ├── product.controller.js
│   │   └── order.controller.js
│   ├── routes/
│   │   ├── product.routes.js
│   │   └── order.routes.js
│   ├── middlewares/
│   │   └── errorHandler.js
│   ├── util/
│   │   └── cryptoPool.js             # Worker threads for CPU-bound hashing
│   ├── workers/
│   │   └── cryptoWorker.js
│   └── app.js                        # Express 5 application setup
├── cluster.js                        # Multi-core clustered entry point
├── server.js                         # Single-process development server
├── package.json
└── README.md
```
