# 🚀 High-Concurrency Node.js Backend: From Zero Redis to Production Caching

An end-to-end engineering benchmark and architecture repository demonstrating how to scale a **Node.js + MongoDB backend to 10,000+ concurrent virtual users** across two architectural paradigms:

---

## 🏛️ Repository Architecture: The 2-Tier Progression

```
high-concurrency-nodejs-backend/
├── v1-without-redis/    # Phase 1: Scaling to 10k VUs with Pure Database & Runtime Engineering (NO Redis)
│   ├── cluster.js       # Multi-core clustering (10 CPU cores)
│   ├── src/             # Clean Architecture (ESR Compound Index, .lean(), Covered Queries, Worker Threads)
│   ├── docs/            # 9 comprehensive guides & post-mortems + whitepaper PDF
│   └── k6/              # Load testing scripts (10,000 VUs benchmark)
│
└── v2-with-redis/       # Phase 2: Ultra High-Throughput with Distributed Redis Caching
    ├── (In Progress)    # Cache-Aside, Invalidation, Stampede Protection, Redis Connection Pooling
```

---

## 📊 Phase Comparison: v1 vs. v2

| Dimension | v1 (Without Redis) | v2 (With Redis) |
| :--- | :--- | :--- |
| **Primary Data Store** | MongoDB (WiredTiger B-Trees) | MongoDB + Redis In-Memory Store |
| **Concurrency Milestone** | **10,000 VUs Sustained** | **10,000+ VUs Ultra-Low Latency** |
| **Total Requests Tested** | 1,124,035 requests | Target: > 2,000,000 requests |
| **HTTP Error Rate** | **0.00%** | Target: **0.00%** |
| **p95 Latency** | **5.43 milliseconds** | Target: **< 2.0 milliseconds** |
| **Median Latency** | **775 microseconds** | Target: **< 400 microseconds** |
| **Database IOPS** | Optimized via Covered Queries (`totalDocsExamined: 0`) | Offloaded: ~95% Cache Hit Ratio |
| **Key Patterns** | ESR Rule, `.lean()`, Worker Threads, OS `ulimit` | Cache-Aside, Cache Invalidation, Stampede / Mutex Locks |

---

## 📁 Exploring the Codebase

- Read the full pure-database scaling whitepaper: [v1-without-redis/README.md](v1-without-redis/README.md)
- Download the complete technical report: [v1-without-redis/High-Concurrency-NodeJS-10k-Users-Architecture-Report.pdf](v1-without-redis/High-Concurrency-NodeJS-10k-Users-Architecture-Report.pdf)
