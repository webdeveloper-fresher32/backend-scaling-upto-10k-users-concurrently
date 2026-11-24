import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 1000 },   // Warm-up to 1,000 VUs
    { duration: '1m', target: 5000 },    // Ramp up to 5,000 VUs
    { duration: '2m', target: 10000 },   // Stress at 10,000 VUs
    { duration: '2m', target: 15000 },   // 🚀 Peak Target: 15,000 Concurrent VUs!
    { duration: '1m', target: 0 },       // Graceful cool-down
  ],
  thresholds: {
    // 95% of requests must complete below 300ms
    http_req_duration: ['p(95)<300', 'p(99)<1000'],
    // Error rate must remain under 1%
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:5002';
const CATEGORIES = ['Electronics', 'Books', 'Home', 'Apparel', 'Sports'];

export default function () {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const minPrice = 10;
  const maxPrice = 500;
  const page = Math.floor(Math.random() * 5) + 1;

  const url = `${BASE_URL}/api/products?category=${category}&minPrice=${minPrice}&maxPrice=${maxPrice}&page=${page}`;

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    },
  };

  const res = http.get(url, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 500ms': (r) => r.timings.duration < 500,
  });

  // Simulate realistic user think time (1 to 2 seconds)
  sleep(Math.random() * 1 + 1);
}