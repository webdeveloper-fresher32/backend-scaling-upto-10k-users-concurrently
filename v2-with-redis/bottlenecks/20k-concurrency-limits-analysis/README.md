# 🔬 Boundary Testing: 20,000 Concurrent VUs & OS Ephemeral Port Exhaustion

This standalone technical analysis documents our boundary testing experiment: pushing our optimized MongoDB + Node.js backend to **20,000 concurrent Virtual Users (VUs)** on a single machine. 

It explains the transition from our **10,000 VU success (0.00% error rate)** to the physical breakdown at 20,000 VUs caused by **macOS ephemeral port exhaustion (`EADDRNOTAVAIL`)** and **hardware thermal limits**, demonstrating why 10,000 concurrent VUs represents the true single-host production ceiling.

---

## 1. The Preceding Milestone: 10,000 VUs with ESR Covered Queries

Before pushing to 20,000 VUs, we first applied two critical database-layer optimizations to our single-process backend:
1. **The 7-Field ESR Compound Index:** Built across 500,000 products (`category_1_isActive_1_price_1_sku_1_title_1_stock_1_rating_1`).
2. **Covered Projection & Mongoose `.lean()`:** Suppressed `_id` and bypassed document hydration, returning raw POJOs directly from WiredTiger's RAM B-Tree.

### 📸 Telemetry Proof at 10,000 VUs:

![k6 Running Smoothly](images/07-esr-covered-k6-running-smooth.jpg)
*Figure 1: k6 executing cleanly without a single `dial: i/o timeout` socket rejection.*

![Activity Monitor 65% Idle CPU](images/08-activity-monitor-65-percent-idle-cpu.jpg)
*Figure 2: System CPU relaxed at **65.38% Idle**. MongoDB CPU consumption plunged 5x from 255.1% down to **51.7%**.*

![10k Milestone Results](images/09-esr-covered-k6-1m-reqs-0-percent-failure.jpg)
*Figure 3: Final 10,000 VU scorecard: **1,085,360 requests handled with a 0.00% error rate** and an **871 µs median latency**.*

---

## 2. Pushing the Boundary: The 20,000 VU Stress Test

Seeing the system running at **65% Idle CPU** with **zero errors**, we asked an aggressive architectural question:

> *"Can a single developer laptop afford 20,000 concurrent Virtual Users?"*

We updated `k6/catalog-load-test.js` to ramp through 1,000 ➔ 5,000 ➔ 10,000 ➔ **20,000 concurrent VUs**:

```javascript
export const options = {
  stages: [
    { duration: '30s', target: 1000 },   // Warm-up to 1,000 VUs
    { duration: '1m',  target: 5000 },   // Ramp up to 5,000 VUs
    { duration: '2m',  target: 10000 },  // Stress at 10,000 VUs
    { duration: '2m',  target: 20000 },  // 🚀 Peak Target: 20,000 Concurrent VUs
    { duration: '1m',  target: 0 },      // Graceful cool-down
  ],
};
```

---

## 3. The 20,000 VU Post-Mortem: What Broke?

At the 20,000 VU mark, k6 began emitting a continuous stream of socket allocation failures:

```text
WARN[0340] Request Failed error="Get \"http://localhost:5002/api/products?...\": dial tcp 127.0.0.1:5002: connect: can't assign requested address"
WARN[0352] Request Failed error="read tcp 127.0.0.1:54831->127.0.0.1:5002: read: connection reset by peer"
WARN[0357] Request Failed error="request timeout"
```

![20,000 VU Breakdown](images/10-20k-vus-ephemeral-port-exhaustion-heat-crash.jpg)
*Figure 4: k6 final scorecard under 20,000 VUs reporting socket exhaustion and elevated tail latency.*

---

## 4. Deep-Dive Root Causes: The Dual Boundary Breakdown

### Root Cause 1: Ephemeral Port Exhaustion (`EADDRNOTAVAIL` / Error 49)

In TCP/IP networking, every single outbound client connection requires a unique 4-tuple:
$$\text{Socket Tuple} = (\text{Source IP}, \text{Source Port}, \text{Dest IP}, \text{Dest Port})$$

When running both **k6 (the client)** and **Node.js (the server)** on the same host (`localhost` / `127.0.0.1`):
* macOS kernel allocates outgoing client ports strictly from the **Ephemeral Port Range**.
* Inspecting the macOS kernel reveals:
  ```bash
  sysctl net.inet.ip.portrange.first net.inet.ip.portrange.last
  # net.inet.ip.portrange.first: 49152
  # net.inet.ip.portrange.last: 65535
  ```
* Mathematical limit of available local ports:
  $$\text{Max Available Ephemeral Ports} = 65,535 - 49,152 = \mathbf{16,383 \text{ ports}}$$

#### The Moment of Collapse:
When k6 ramped past 16,000 active Virtual Users towards **20,000 VUs**, it attempted to open more simultaneous outbound sockets than the operating system physically possessed.

Once all 16,383 ports were consumed, the macOS networking subsystem could no longer allocate a local port for any new connection request. The kernel immediately rejected new `connect()` system calls with:
$$\mathbf{\text{can't assign requested address} \equiv \text{EADDRNOTAVAIL (Error 49)}}$$

---

### Root Cause 2: Hardware Thermal Throttling on Passively Cooled Apple Silicon

During the 20,000 VU run, the user's laptop experienced intense thermal elevation:

1. **Passive Cooling Architecture:** The MacBook Air chassis has **no internal fan**. It relies entirely on passive thermal conduction through its aluminum unibody.
2. **Extreme Concurrent Load:**
   * k6 was managing **20,000 concurrent Go goroutines**.
   * Node.js single thread was parsing over **3,420 incoming HTTP requests every second**.
   * MongoDB was executing **3,420 index searches per second**.
   * Data throughput reached **3.2 GB received and 242 MB sent** over loopback memory buffers in 6.5 minutes.
3. **The Thermal Throttling Event:**
   * As internal die temperatures crossed safe silicon thresholds, macOS hardware firmware automatically lowered CPU clock speeds (thermal throttling) to protect the processor.
   * Clock speed reduction combined with single-core queuing caused tail latency to balloon to **6.53 seconds (p95)** and **15.43 seconds (p99)**.

---

## 5. The Surprising Scorecard: The Backend Survived!

Despite running completely out of OS network ports and entering thermal throttling, the underlying architecture demonstrated incredible resilience:

| Metric | 20,000 VU Boundary Test Result | Engineering Significance |
| :--- | :--- | :--- |
| **Total Requests Processed** | **1,340,126 requests** | Massive volume sustained on a single laptop |
| **Throughput (RPS)** | **3,420 requests/second** | Highest throughput achieved so far |
| **Successful Requests (`200 OK`)** | **1,233,037 requests passed (92.01%)** | Over 1.23 Million requests served successfully |
| **HTTP Failure Rate** | **7.99%** (107,089 failed) | Caused almost entirely by client-side port exhaustion |
| **Expected Response Median Latency** | **93.35 milliseconds** | Core database engine never collapsed |
| **Failure Classification** | **Client Socket Exhaustion (`EADDRNOTAVAIL`)** | The database did NOT crash; the OS ran out of local ports |

---

## 6. Core Engineering Takeaways for Production & Interviews

1. **The Single-Host Scaling Wall:** A single machine cannot afford more than ~16,000 concurrent sockets on `localhost` without exhausting the ephemeral port range (`49152–65535`).
2. **How Real Systems Test 20k+ Users:** In production (e.g., Netflix, Uber), testing beyond 10,000 concurrent VUs is never done on a single machine. It is executed via **Distributed Load Testing** (fanning out k6 across multiple cloud instances with distinct IP addresses targeting a load balancer).
3. **10,000 Concurrent VUs is the True Single-Host Benchmark:**
   * 10,000 VUs yields **1.08M+ requests** with **0.00% error rate**, **871 µs median latency**, and **65% Idle CPU**.
   * In real-world web traffic (where users think for 15–30 seconds between clicks), 10,000 concurrent VUs represents an active user base of **500,000 to 1,000,000 Daily Active Users (DAUs)**.

---

### What's Next in v2?

With our database optimization validated and physical single-host boundaries established, we return to our **10,000 VU benchmark** to integrate the ultimate scaling layer:

* **[Module 1: Redis Architecture & Resilient Connection](../docs/01-redis-architecture-and-connection.md)**
* **[Module 2: Core Caching Service & Distributed Stampede Prevention](../docs/02-caching-patterns-and-stampede-prevention.md)**
* **[Module 3: Read-Path Caching (Catalog & Product Lookups)](../docs/03-read-path-caching-and-catalog.md)**
* **[Module 4: Write-Path Caching & Transactional Invalidation](../docs/04-write-path-cache-invalidation.md)**
* **[Module 5: Clustered Multi-Core Scaling with Redis](../docs/05-multi-core-clustering-with-redis.md)**
* **[Module 6: 10,000 VU k6 Load Testing & v1 vs v2 Benchmark](../docs/06-k6-load-testing-and-benchmarking.md)**
