# 🔬 Bottleneck Benchmarks & Failure Mode Reports

This directory archives the deep-dive empirical load test analyses, bottleneck postmortems, and Activity Monitor profiling logs captured while pushing Node.js from an unoptimized baseline up to 15,000–20,000 concurrent Virtual Users (VUs).

---

## 📑 Chronological Optimization Journey & Failure Reports

The reports below are ordered chronologically by how we pushed the system, broke bottlenecks, and engineered solutions:

| Step | Report Directory | Scale | Bottleneck Uncovered | Primary Failure Mode | Resolution Applied |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **01** | **[`01-baseline-failure-analysis`](01-baseline-failure-analysis/README.md)** | 10k VUs | Single-core event loop + Unindexed MongoDB COLLSCAN | 100% CPU lockup, `dial: i/o timeout` (98.46% failures) | Compound ESR covered index (`-_id`) + `.lean()` |
| **02** | **[`02-20k-concurrency-limits-analysis`](02-20k-concurrency-limits-analysis/README.md)** | 20k VUs | macOS Ephemeral Port Exhaustion (16,383 limit) + Passive Thermal Throttling | `can't assign requested address` (`EADDRNOTAVAIL`, 7.52% errors) | Ephemeral port expansion via `sysctl` (`portrange.first=10240`) |
| **03** | **[`03-15k-concurrency-clustering-analysis`](03-15k-concurrency-clustering-analysis/README.md)** | 15k VUs | MongoDB Disk IOPS / WiredTiger Queue Saturation (3.8k queries/sec) | 1.03% query queue timeout at peak concurrency | Multi-core clustering (10 workers) + Redis Cache-Aside |
| **04** | **[`04-15k-redis-benchmark`](04-15k-redis-benchmark/README.md)** | 15k VUs | Conquered 15k with Redis caching + stampede lock | 0.00% errors, 1.96M requests at 5,000 RPS, 292 µs median latency | Validated 10-core clustering + Redis `SETNX` distributed lock |
| **05** | **[`05-20k-two-tier-redis-benchmark`](05-20k-two-tier-redis-benchmark/README.md)** | **20k VUs** | Loopback TCP socket contention & V8 serialization churn | Tail latency crossed threshold (`p95=2.02s`, 65.76% System CPU) | **Two-Tier L1 RAM + L2 Redis Caching; 2.87M requests @ 7,319 RPS, 1.42ms p95, 100% green checks!** |

---

## 🧭 Navigation
- 🔙 Return to [Main v2-with-redis Documentation](../README.md)
