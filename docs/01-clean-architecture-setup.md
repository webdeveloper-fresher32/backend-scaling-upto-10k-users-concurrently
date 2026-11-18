
# Part 1: Clean Architecture & Foundation Setup

This guide establishes the foundational architecture for scaling a Node.js backend to high concurrency.

---

## 1. Directory Structure

A strict separation of concerns is vital. Each layer has a single responsibility:

```
├── src/
│   ├── config/
│   │   └── database.js         # Resilient MongoDB connection pooling
│   ├── controllers/
│   │   ├── product.controller.js
│   │   └── order.controller.js  # HTTP request/response handling only
│   ├── services/
│   │   ├── product.service.js
│   │   └── order.service.js    # Business logic & orchestration
│   ├── repositories/
│   │   ├── product.repository.js
│   │   └── order.repository.js  # Direct database queries & Mongoose isolation
│   ├── models/
│   │   ├── product.model.js
│   │   ├── order.model.js
│   │   └── review.model.js     # Mongoose Schemas & Schema Indexes
│   ├── middlewares/
│   │   └── errorHandler.js     # Centralized async error handling
│   ├── workers/
│   │   └── cryptoWorker.js     # Worker threads for CPU-bound tasks
│   └── app.js                  # Express app initialization
├── server.js                   # Single-process server entry point
├── cluster.js                  # Multi-process clustered entry point
├── k6/                         # Load testing scripts
└── package.json
```

---

## 2. Why the Repository Pattern Matters for Scaling

1. **Decoupling Business Logic from ORM/ODM:**
   Services contain business rules (e.g., validate stock, calculate totals). They should never care whether data comes from Mongoose, native MongoDB driver, or memory.
2. **Performance Tuning Isolation:**
   When optimizing queries (such as adding `.lean()`, projection hints, or raw aggregation pipelines), changes are confined to the Repository layer without touching business logic in Services.

---

## 3. Resilient Database Connection Pooling (`src/config/database.js`)

At 10,000 concurrent users, connection pool exhaustion is a common point of failure. The MongoDB Node.js driver uses an internal connection pool.

```javascript
const mongoose = require('mongoose');

const connectDatabase = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/scale_10k_db';

  const options = {
    // Maintain between minPoolSize and maxPoolSize connections per process
    minPoolSize: 10,
    maxPoolSize: 50, // For multi-process clusters, total connections = maxPoolSize * worker_count
  
    // Timeout if a connection cannot be acquired from pool within 5 seconds
    waitQueueTimeoutMS: 5000,
  
    // Close idle sockets after 30 seconds
    maxIdleTimeMS: 30000,
  
    // Fast fail for network disconnects
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };

  try {
    await mongoose.connect(mongoUri, options);
    console.log(`[Database] Connected successfully to ${mongoUri}`);
  } catch (error) {
    console.error('[Database] Connection failed:', error.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[Database] Lost connection to MongoDB.');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[Database] Reconnected to MongoDB.');
  });
};

module.exports = { connectDatabase };
```

---

## 4. Centralized Async Error Handling (`src/middlewares/errorHandler.js`)

Express 5 natively resolves rejected promises in route handlers, eliminating the need for `try/catch` boilerplate across controllers.

```javascript
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Avoid logging verbose traces during high-load benchmarks
  if (process.env.NODE_ENV !== 'production' && statusCode === 500) {
    console.error('[Unhandled Error]', err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};

module.exports = errorHandler;
```

---

## 5. Express App Setup (`src/app.js`)

```javascript
const express = require('express');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Disable x-powered-by header to reduce response byte overhead
app.disable('x-powered-by');

// Parse JSON payloads with a sensible limit
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Health check endpoint for load balancers
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: Date.now() });
});

// Import and mount route modules
const productRoutes = require('./routes/product.routes');
const orderRoutes = require('./routes/order.routes');

app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

// Global Error Handler
app.use(errorHandler);

module.exports = app;
```
