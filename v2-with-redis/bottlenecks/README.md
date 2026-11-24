# 🔬 Bottleneck Benchmarks & Failure Mode Reports

This directory archives the deep-dive empirical load test analyses, bottleneck postmortems, and Activity Monitor profiling logs captured while pushing Node.js from an unoptimized baseline up to 15,000–20,000 concurrent Virtual Users (VUs).

---

## 📑 Included Analysis Reports

| Report | Scale | Bottleneck Uncovered | Primary Failure Mode | Resolution |
| :--- | :--- | :--- | :--- | :--- |
| **[1. Baseline Failure Analysis](baseline-failure-analysis/README.md)** | 10k VUs | Single-core event loop + Unindexed MongoDB COLLSCAN | 100% CPU lockup, `dial: i/o timeout` (98.46% failures) | Compound ESR covered index (`-_id`) + `.lean()` |
| **[2. 20k Concurrency Limits](20k-concurrency-limits-analysis/README.md)** | 20k VUs | macOS Ephemeral Port Exhaustion (16,383 limit) + Passive Thermal Throttling | `can't assign requested address` (`EADDRNOTAVAIL`) | Capped single-host target to 15,000 VUs |
| **[3. 15k Clustering Milestone](15k-concurrency-clustering-analysis/README.md)** | 15k VUs | MongoDB Disk IOPS / WiredTiger Queue Saturation (3.8k queries/sec) | 1.03% query queue timeout at peak concurrency | Redis caching with `SETNX` distributed mutex & TTL jitter |

---

## 🧭 Navigation
- 🔙 Return to [Main v2-with-redis Documentation](../README.md)
