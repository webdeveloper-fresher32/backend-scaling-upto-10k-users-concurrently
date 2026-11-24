# 🚀 High-Concurrency Node.js Backend: From Zero Redis to Production Caching

An end-to-end engineering benchmark and architecture repository demonstrating how to scale a **Node.js + MongoDB backend to 10,000+ concurrent virtual users** across two architectural paradigms:

---

## 🏛️ Repository Architecture: The 2-Tier Progression

```
high-concurrency-nodejs-backend/
├── v1-without-redis/    # Phase 1: Scaling to 10k VUs with Pure Database & Runtime Engineering (NO Redis)
│   ├── .env             # Port 5001, MongoDB URI
│   ├── cluster.js       # Multi-core clustering (10 CPU cores)
│   ├── src/             # Clean Architecture (ESR Compound Index, .lean(), Covered Queries, Worker Threads)
│   ├── docs/            # 9 comprehensive guides & post-mortems + whitepaper PDF
│   ├── k6/              # Load testing scripts (10,000 VUs benchmark)
│   └── README.md        # Full v1 Architecture & Benchmark Guide
│
└── v2-with-redis/       # Phase 2: Ultra High-Throughput with Distributed Redis Caching
    ├── .env             # Port 5002, Redis Host/Port, Cache TTLs
    ├── docs/            # 6 module-by-module implementation guides
    └── README.md        # Full v2 Architecture & Implementation Roadmap
```

---

## 📊 Phase Comparison: v1 vs. v2

| Dimension | v1 (Without Redis) | v2 (With Redis) |
| :--- | :--- | :--- |
| **Primary Data Store** | MongoDB (WiredTiger B-Trees) | MongoDB + Redis In-Memory Store |
| **Server Port** | `5001` | `5002` |
| **Concurrency Milestone** | **10,000 VUs Sustained** | **10,000+ VUs Ultra-Low Latency** |
| **Total Requests Tested** | 1,124,035 requests | Target: > 2,000,000 requests |
| **HTTP Error Rate** | **0.00%** | Target: **0.00%** |
| **p95 Latency** | **5.43 milliseconds** | Target: **< 2.0 milliseconds** |
| **Median Latency** | **775 microseconds** | Target: **< 400 microseconds** |
| **Database IOPS** | Optimized via Covered Queries (`totalDocsExamined: 0`) | Offloaded: ~95% Cache Hit Ratio |
| **Key Patterns** | ESR Rule, `.lean()`, Worker Threads, OS `ulimit` | Cache-Aside, Cache Invalidation, Stampede / Mutex Locks |

---

## 📁 Quick Links

- **Phase 1 Guide:** [v1-without-redis/README.md](v1-without-redis/README.md)
- **Phase 1 Whitepaper PDF:** [v1-without-redis/High-Concurrency-NodeJS-10k-Users-Architecture-Report.pdf](v1-without-redis/High-Concurrency-NodeJS-10k-Users-Architecture-Report.pdf)
- **Phase 2 Guide:** [v2-with-redis/README.md](v2-with-redis/README.md)
- **Phase 2 Implementation Modules:** [v2-with-redis/docs/README.md](v2-with-redis/docs/README.md)
