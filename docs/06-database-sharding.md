# Part 6: MongoDB Sharding & Horizontal Scale

When a single database node reaches hardware limits (RAM, disk I/O, or CPU), horizontal partitioning (**Sharding**) distributes data and query load across multiple database clusters.

---

## 1. MongoDB Sharding Architecture

```
[Node.js Clustered Workers]
         │
         ▼
    [mongos (Query Router)]
     /         │         \
    ▼          ▼          ▼
[Config Srv] [Shard A] [Shard B]
 (Metadata)   (Replica) (Replica)
```

1. **`mongos` (Query Router):** A lightweight, stateless proxy. Node.js connects to `mongos` as if it were a standard standalone MongoDB instance.
2. **Config Database (Replica Set):** Stores cluster metadata and mapping of chunks to shards.
3. **Shards:** Independent replica sets that each store a portion of the cluster's collections.

---

## 2. Choosing the Right Shard Key

The shard key determines data distribution. Choosing the wrong shard key can permanently degrade performance.

### Key Criteria:
1. **High Cardinality:** The key must have millions of distinct values (e.g., `userId`, `orderId`, or UUIDs). Keys with low cardinality (e.g., `status: "PENDING"`) create un-splittable **jumbo chunks**.
2. **Balanced Write Distribution:**
   - **Monotonically Increasing Anti-Pattern:** Using `{ createdAt: 1 }` or `{ _id: 1 }` routes 100% of new inserts to the newest shard, creating a severe write hotspot.
   - **Hashed Sharding:** Using `{ _id: "hashed" }` distributes writes uniformly across all shards via MD5 hash buckets.
3. **Targeted Queries vs. Scatter-Gather:**
   - **Targeted Query:** If a query includes the shard key (e.g. `{ userId: "12345" }`), `mongos` routes the request directly to the single shard holding that chunk.
   - **Scatter-Gather:** If a query omits the shard key, `mongos` must broadcast the query to every shard and aggregate the results, multiplying network overhead.

---

## 3. Shard Key Decision Matrix for Our Domain

| Collection | Shard Key Pattern | Strategy | Trade-off / Justification |
| :--- | :--- | :--- | :--- |
| **Orders** | `{ userId: "hashed" }` | Hashed | Evenly distributes high-volume order writes while keeping all orders for a single user localized. |
| **Products** | Compound: `{ category: 1, _id: 1 }` | Range | Localizes catalog lookups by category to specific shards, while `_id` provides secondary cardinality. |
| **Reviews** | Compound: `{ productId: 1, createdAt: -1 }` | Range | Targets product review lookups to the specific shard holding that product's reviews. |

---

## 4. Chunk Splits & Balancing

1. **Chunks:** Continuous ranges of shard key values (default size: 64MB).
2. **Splits:** When a chunk reaches 64MB, `mongos` splits it into two smaller chunks.
3. **Balancer:** A background process that migrates chunks from shards with the most chunks to shards with the fewest.
   > **Production Tip:** Under high write spikes (e.g., flash sales), schedule the balancer to run during off-peak hours to prevent migration network overhead from competing with client traffic.
