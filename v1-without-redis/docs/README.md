# High-Concurrency Node.js Engineering Documentation (10k Users Without Redis)

Welcome to the complete hands-on guide for scaling a Node.js and MongoDB backend to **10,000 concurrent users without Redis**.

## 📚 Documentation & Engineering Guides

1. [Part 1: Clean Architecture & Foundation Setup](01-clean-architecture-setup.md)
   - Layered architecture (Routes $\rightarrow$ Controllers $\rightarrow$ Services $\rightarrow$ Repositories $\rightarrow$ Models).
   - Complete code for `product.service.js`, `product.controller.js`, `product.routes.js`, and `server.js`.
   - Resilient MongoDB connection pooling (`minPoolSize`, `maxPoolSize`, `waitQueueTimeoutMS`).
   - Express 5 centralized async error handling.

2. [Part 2: Domain Modeling & High-Volume Data Seeding](02-domain-modeling-and-seeding.md)
   - Mongoose schemas (`Product`, `Review`, `Order`).
   - High-throughput bulk seeder inserting 500,000 products and 1,000,000 reviews with memory-safe chunking.

3. [Part 3: Baseline Load Testing with k6 & Summary Report](03-baseline-k6-load-testing.md)
   - Setting up k6 on macOS.
   - Naive unoptimized repository implementation.
   - Ramp-up load test script ($500 \rightarrow 2,000 \rightarrow 5,000 \rightarrow 10,000$ VUs).
   - Baseline benchmark report documenting the failure point.

4. 🧪 [The Definitive Guide to k6: Internal Mechanics & Load Testing Mastery](k6-load-testing-internals-guide.md)
   - How k6 works under the hood (Go runtime, Goja engine, Goroutines vs OS threads).
   - What a Virtual User (VU) actually is and how it runs an infinite execution loop.
   - Anatomy of an HTTP request: `looking_up`, `dialing`, `sending`, `waiting` (TTFB), and `receiving`.
   - Why averages lie and how to analyze p50, p90, p95, and p99 percentiles.
   - Error signature catalog (`dial: i/o timeout`, `ECONNRESET`, timeouts).

5. 🚨 [Deep-Dive Post-Mortem: Why the Backend Failed at 10k Users](k6-failure-analysis-post-mortem.md)
   - Complete architectural failure analysis (**When, Where, How, and Why**).
   - Mathematical proof of connection pool starvation ($50 / 0.3\text{s} = 166\text{ req/s}$ capacity vs $5,000\text{ req/s}$ demand).
   - The "Idle CPU Paradox" (Why CPU sat at 37% and Mac was 76% idle during a crash).
   - Mermaid sequence and architecture diagrams of the cascading failure.

6. [Part 4: Node.js Runtime & OS Concurrency Scaling](04-nodejs-runtime-scaling.md)
   - OS tuning: increasing file descriptor limits (`ulimit -n 65536`).
   - Multi-process Node.js `cluster` module scaling across all available CPU cores.
   - Offloading CPU-heavy hashing and crypto tasks to `worker_threads`.
   - HTTP Keep-Alive tuning and zero-downtime graceful shutdown.

7. [Part 5: MongoDB Deep Optimization (Scaling Without Redis)](05-mongodb-optimization-without-redis.md)
   - Bypassing Mongoose document hydration with `.lean()`.
   - The **ESR Rule** (Equality $\rightarrow$ Sort $\rightarrow$ Range) for compound indexes.
   - Index-covered queries with `totalDocsExamined: 0` served directly from RAM.
   - Sub-pipeline `$lookup` and `$project` query optimization.
   - Read Preferences (`secondaryPreferred`) and Write Concerns (`w: 1` vs `w: "majority"`).

8. [Part 6: MongoDB Sharding & Horizontal Scale](06-database-sharding.md)
   - Sharding architecture: `mongos`, Config Servers, and Shard replica sets.
   - Shard key selection criteria: high cardinality, avoiding monotonic keys, targeted vs. scatter-gather queries.
   - Chunk splits, migrations, and balancing under high load.

9. [Part 7: Final 10K Benchmark & Interview Defense Mastery](07-final-10k-benchmark-and-interview-defense.md)
   - Live benchmark results: 1.06M requests handled with 0.00% error rate under 10k VUs.
   - Complete 7-phase visual walkthrough from Thunder Client sanity check to cooldown.
   - Comprehensive Before vs. After comparison table and senior engineering interview Q&A cheatsheet.
