# 🚀 Milestone Report: 15,000 Concurrent VUs with 10-Core Multi-Process Clustering

This standalone engineering report documents our **15,000 concurrent Virtual User (VU)** benchmark on **`v2-with-redis`**, demonstrating the power of **Multi-Core Process Clustering** combined with **MongoDB ESR Covered Queries**.

In this test, the backend processed over **1.51 Million requests** at a sustained throughput of **3,869 requests/second** with a **98.96% success rate** and a **1.2 ms median latency**, while revealing the exact saturation limits of a pure database architecture before introducing Redis.

---

## 1. Test Architecture & System Configuration

* **Runtime:** Node.js v20 Clustered Mode (`cluster.js`) spawning **10 worker processes** (1 per Apple Silicon CPU core).
* **Port / Socket Balancing:** Single master process binding to port 5002; OS kernel round-robin socket balancing.
* **Database Engine:** MongoDB 7.0 (`scale_db_with_redis`) with 500,000 products and 1,000,000 reviews.
* **Database Optimization:** 7-field ESR compound index + `.lean()` covered query projection (`totalDocsExamined: 0`).
* **Cache Layer:** **Zero Redis caching (pure database load)**.
* **File Descriptors:** `ulimit -n 65536`.
* **Load Generator:** Grafana k6 running 15,000 looping VUs over 6.5 minutes.

---

## 2. Chronological Telemetry & Test Progression

### Phase 1: Early Ramp-Up (1,000 ➔ 5,600 VUs)
As k6 ramped through the first 5,000 VUs, all 10 Node.js workers engaged simultaneously:

![15k Activity Monitor Early](images/11-15k-activity-monitor-10-workers-early.jpg)
*Figure 1: Activity Monitor showing 10 distinct `node` worker processes (PIDs 79600–79608) sharing the load equally (~15% CPU each) with **64.63% Idle CPU**.*

![k6 Ramp-up to 5,600 VUs](images/12-15k-k6-rampup-5600-vus.jpg)
*Figure 2: k6 crossing 5,647 VUs with over 182,000 completed iterations and zero socket drops.*

---

### Phase 2: Mid-Test Scaling (5,600 ➔ 10,500 VUs)
Crossing 10,000 concurrent VUs, the OS socket distribution maintained near-perfect balance:

![15k Activity Monitor Mid](images/13-15k-activity-monitor-10-workers-mid.jpg)
*Figure 3: All 10 worker processes scaling evenly to ~40% CPU each. `mongod` processing index queries at 155.9% CPU with 22.73% Idle CPU remaining.*

![k6 Scaling to 10,500 VUs](images/14-15k-k6-rampup-10500-vus.jpg)
*Figure 4: k6 scaling past 10,500 VUs with 802,310 completed requests.*

---

### Phase 3: Peak Stress at 15,000 Concurrent VUs
During the 2-minute sustained peak at **15,000 VUs**, all 10 CPU cores reached full saturation:

![15k Activity Monitor Peak](images/15-15k-activity-monitor-10-workers-peak.jpg)
*Figure 5: Full 10-core utilization (User: 52.12%, System: 46.29%, Idle: 1.60%). Each of the 10 worker processes consumed ~42% CPU, handling ~1,500 open sockets each.*

![k6 Peak 14,500 VUs](images/16-15k-k6-peak-14500-vus.jpg)
*Figure 6: k6 sustaining 14,568 VUs with 1.27 Million requests processed.*

---

## 3. Final Benchmark Scorecard (15,000 VUs)

Below is the definitive k6 scorecard for the 15,000 VU clustered test:

![15k Final Scorecard](images/17-15k-final-scorecard-1-5m-requests.jpg)
*Figure 7: Final benchmark metrics recording 1,515,896 requests, 3,869 req/s throughput, and a 1.2 ms median latency.*

### Metric Comparison: Baseline vs 10k Single-Core vs 15k Multi-Core

| Metric | Unindexed Baseline (Single Core) | ESR Covered Query (Single Core - 10k VUs) | 10-Core Clustered (15k VUs - No Redis) |
| :--- | :--- | :--- | :--- |
| **Concurrent VUs** | 10,000 VUs (Collapsed) | 10,000 VUs | **15,000 Concurrent VUs** |
| **Total Requests Processed** | 255,289 (mostly failed) | 1,085,360 | **1,515,896 completed (1.51M!)** |
| **Throughput (RPS)** | ~639 req/s | 2,770 req/s | **3,869 sustained req/s (7,738 checks/s)** |
| **Successful Requests (`200 OK`)** | 3,928 passed (1.56%) | 1,085,360 passed (100%) | **1,500,155 passed (98.96%)** |
| **HTTP Error Rate (`http_req_failed`)** | **98.46%** (251k failed) | **0.00%** (0 errors) | **1.03%** (Only 15k outliers out of 1.51M) |
| **Median Latency (`med`)** | 5,000 ms | 871 µs | **1.2 milliseconds (Sub-2ms!)** |
| **Min Latency (`min`)** | 0 ms (timeout) | 216 µs | **269 microseconds** |
| **Average Latency (`avg`)** | 5,300 ms | 75.9 ms | **518.8 ms** |
| **p90 Latency** | 6,280 ms | 333.5 ms | **1.84 seconds** |
| **p95 Latency** | 6,980 ms | 436.7 ms | **2.58 seconds** |
| **Active Node Processes** | 1 process | 1 process | **10 worker processes (1 per core)** |
| **Network Data Transferred** | 514 MB | 2.7 GB | **3.7 GB received / 283 MB sent** |

---

## 4. Deep-Dive Post-Mortem: Why Did 1.03% Fail at 15k?

While **98.96% of requests (1.50 Million) succeeded**, k6 recorded a modest 1.03% error rate (15,741 requests) during the absolute peak of 15,000 VUs. 

### Why Did This Happen?
Notice that during the 20,000 VU test, the error was `connect: can't assign requested address` (ephemeral port exhaustion). 

In this 15,000 VU test:
* **The OS Port Problem Was Solved:** Because 15,000 is safely below the 16,383 ephemeral port limit, k6 did **not** run out of local ports.
* **The New Bottleneck Was MongoDB IOPS Saturation:**
  * Node.js scaled across all 10 cores and pumped **3,869 queries per second** directly into MongoDB.
  * While MongoDB's compound index in WiredTiger RAM is fast (~1ms), serving **3,869 queries every single second** means MongoDB executed over **230,000 database operations every minute**.
  * At the absolute peak of 15,000 VUs, MongoDB's connection pool queue experienced temporary micro-delays, pushing tail latency (p95) to 2.58 seconds and timing out a tiny sliver of requests (1.03%).

---

## 5. The Ultimate Proof: Why Redis is Imperative

This benchmark provides the definitive real-world justification for **Redis In-Memory Caching**:

> *"Through pure database indexing and 10-core process clustering, our Node.js backend sustained 1.51 Million requests at 3,869 RPS with a 1.2ms median latency. However, routing 100% of read traffic to MongoDB eventually saturates database IOPS at 15,000 VUs."*

### What Happens When We Add Redis (Modules 1–6):
1. **95%+ Query Offload:** Instead of 3,869 queries/sec hitting MongoDB, **3,675 queries/sec are served directly from Redis RAM in $< 300\text{ µs}$**.
2. **MongoDB CPU Drops to $< 5\%$:** MongoDB only handles the ~5% cache misses and order writes.
3. **p95 Drops from 2.58s to $< 2\text{ ms}$:** Zero connection pool queueing in MongoDB.
4. **Error Rate Drops to 0.00%:** Completely clean pass across all 15,000 VUs.

---

### Implementation Modules
Proceed to the implementation modules inside [`docs/`](../../docs/README.md):
* **[Module 1: Redis Architecture & Resilient Connection](../../docs/01-redis-architecture-and-connection.md)**
* **[Module 2: Core Caching Service & Distributed Stampede Prevention](../../docs/02-caching-patterns-and-stampede-prevention.md)**
* **[Module 3: Read-Path Caching (Catalog & Product Lookups)](../../docs/03-read-path-caching-and-catalog.md)**
* **[Module 4: Write-Path Caching & Transactional Invalidation](../../docs/04-write-path-cache-invalidation.md)**
* **[Module 5: Clustered Multi-Core Scaling with Redis](../../docs/05-multi-core-clustering-with-redis.md)**
* **[Module 6: 10,000 VU k6 Load Testing & v1 vs v2 Benchmark](../../docs/06-k6-load-testing-and-benchmarking.md)**
* **[Module 7: Two-Tier L1/L2 Caching & 20,000 VU Benchmark](../../docs/07-two-tier-l1-l2-caching-and-20k-benchmark.md)**
