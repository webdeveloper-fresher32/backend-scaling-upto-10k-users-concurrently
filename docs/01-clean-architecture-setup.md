# Part 1: Clean Architecture & Foundation Setup

This guide establishes the production-grade Layered Architecture (MVC + Service-Repository pattern) for scaling a Node.js backend. Every component is isolated to guarantee testability, maintainability, and horizontal scalability.

---

## 1. Directory Structure

```
├── src/
│   ├── config/
│   │   └── database.js              # Resilient MongoDB connection pooling
│   ├── controllers/
│   │   └── product.controller.js    # HTTP request parsing & response formatting
│   ├── services/
│   │   └── product.service.js       # Business rules, validation & orchestration
│   ├── repositories/
│   │   └── product.repository.naive.js # Direct DB queries & Mongoose isolation
│   ├── models/
│   │   ├── product.model.js
│   │   ├── order.model.js
│   │   └── review.model.js          # Mongoose Schemas & Schema Indexes
│   ├── routes/
│   │   ├── product.routes.js        # Product route definitions
│   │   └── order.routes.js          # Order route definitions (stub)
│   ├── middlewares/
│   │   └── errorHandler.js          # Centralized error middleware
│   ├── workers/
│   │   └── cryptoWorker.js          # Worker threads for CPU tasks
│   └── app.js                       # Express app configuration
├── server.js                        # Single-process server entry point
├── cluster.js                       # Multi-process clustered entry point
├── k6/
│   └── catalog-load-test.js         # Load testing scripts
├── package.json
└── .env
```

---

## 2. Architectural Responsibilities (The Layered Pattern)

$$\text{HTTP Request} \longrightarrow \text{Routes} \longrightarrow \text{Controllers} \longrightarrow \text{Services} \longrightarrow \text{Repositories} \longrightarrow \text{MongoDB}$$

1. **Routes (`src/routes/`):** Map HTTP verbs (`GET`, `POST`) and URLs to controller actions. No logic lives here.
2. **Controllers (`src/controllers/`):** Extract query/body params, validate basic HTTP input, call services, and return status codes (`200`, `400`, `500`).
3. **Services (`src/services/`):** Contain business logic (e.g., price calculations, sanitization, default limits). Independent of Express (`req`, `res`).
4. **Repositories (`src/repositories/`):** Directly interact with the database driver/ODM. All query optimization (indexes, `.lean()`, projection) happens here without touching business logic.
5. **Models (`src/models/`):** Define the database schema, types, and indexes.

---

## 3. Complete Code Implementation for Foundation Files

### A. Database Connection Pool (`src/config/database.js`)
Configures the MongoDB Node.js driver connection pool with resilient timeouts and lifecycle listeners.

```javascript
const mongoose = require('mongoose');

const connectDatabase = async () => {
  const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/scale_10k_db';

  const options = {
    // Keep between 10 and 50 open sockets in the pool
    minPoolSize: 10,
    maxPoolSize: 50,

    // Fail fast if a connection cannot be acquired from the pool within 5s
    waitQueueTimeoutMS: 5000,

    // Close idle sockets after 30 seconds
    maxIdleTimeMS: 30000,

    // Network timeouts
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };

  try {
    await mongoose.connect(mongoURI, options);
    console.log(`[Database] Connected successfully to ${mongoURI}`);
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

### B. Centralized Error Handler (`src/middlewares/errorHandler.js`)
Catches all unhandled exceptions and promise rejections across controllers without crashing the process.

```javascript
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

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

### C. Service Layer (`src/services/product.service.js`)
Applies sanitization and production defaults so unvalidated client inputs cannot exhaust heap memory.

```javascript
const productRepository = require('../repositories/product.repository.naive');

class ProductService {
  async getProducts(filters) {
    const { category, minPrice, maxPrice, page, limit } = filters;

    // Sanitize parameters to prevent memory exhaustion
    const parsedMinPrice = minPrice !== undefined ? Number(minPrice) : 0;
    const parsedMaxPrice = maxPrice !== undefined ? Number(maxPrice) : 1000000;
    const parsedPage = page !== undefined ? Math.max(1, Number(page)) : 1;
    const parsedLimit = limit !== undefined ? Math.min(100, Math.max(1, Number(limit))) : 20;

    return await productRepository.findByCategory(
      category,
      parsedMinPrice,
      parsedMaxPrice,
      parsedPage,
      parsedLimit
    );
  }
}

module.exports = new ProductService();
```

---

### D. Controller Layer (`src/controllers/product.controller.js`)
Handles HTTP input/output and forwards unexpected errors to `next(error)`.

```javascript
const productService = require('../services/product.service');

class ProductController {
  async getProducts(req, res, next) {
    try {
      const { category, minPrice, maxPrice, page, limit } = req.query;

      if (!category) {
        return res.status(400).json({
          success: false,
          error: { message: 'Query parameter "category" is required' },
        });
      }

      const products = await productService.getProducts({
        category,
        minPrice,
        maxPrice,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        count: products.length,
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ProductController();
```

---

### E. Routes (`src/routes/product.routes.js` & `src/routes/order.routes.js`)

**`src/routes/product.routes.js`:**
```javascript
const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');

// Note: `next` must be present in (req, res, next) so controller errors reach the error middleware
router.get('/', (req, res, next) => productController.getProducts(req, res, next));

module.exports = router;
```

**`src/routes/order.routes.js` (Stub):**
```javascript
const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'orders route active' });
});

module.exports = router;
```

---

### F. Express Application Setup (`src/app.js`)

```javascript
const express = require('express');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Disable x-powered-by header to reduce response byte overhead
app.disable('x-powered-by');

// Parse JSON payloads with sensible byte limits
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

// Global Error Handler (must be mounted after all routes)
app.use(errorHandler);

module.exports = app;
```

---

### G. Server Entry Point (`server.js`)
Bootstraps MongoDB, tunes HTTP Keep-Alive sockets, and handles graceful process termination.

```javascript
require('dotenv').config();
const app = require('./src/app');
const { connectDatabase } = require('./src/config/database');

const PORT = process.env.PORT || 3000;

async function startServer() {
  // 1. Establish DB pool before accepting client connections
  await connectDatabase();

  // 2. Start HTTP listener
  const server = app.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT} (Process PID: ${process.pid})`);
  });

  // 3. High-concurrency socket tuning
  server.keepAliveTimeout = 65000; // Reuse TCP socket across consecutive HTTP requests
  server.headersTimeout = 66000;   // Must be greater than keepAliveTimeout

  // 4. Graceful shutdown handler
  const gracefulShutdown = (signal) => {
    console.log(`\n[Server] Received ${signal}. Draining active connections...`);
    server.close(() => {
      console.log('[Server] All HTTP connections closed. Process terminating cleanly.');
      process.exit(0);
    });

    // Force exit if connections hang past 10 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();
```
