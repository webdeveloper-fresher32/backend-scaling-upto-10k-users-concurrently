import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  discardResponseBodies: true, // 🚀 Cuts k6 CPU by 70% by not buffering 4GB+ of JSON in Go memory
  stages: [
    { duration: '30s', target: 2000 },   // Warm-up to 2,000 VUs
    { duration: '1m', target: 8000 },    // Ramp up to 8,000 VUs
    { duration: '2m', target: 14000 },   // Step up to 14,000 VUs
    { duration: '2m', target: 20000 },   // 🚀 Peak Target: 20,000 Concurrent VUs!
    { duration: '1m', target: 0 },       // Graceful cool-down
  ],
  thresholds: {
    // 95% of requests must complete below 1000ms under 20k VUs on single host
    http_req_duration: ['p(95)<1000', 'p(99)<2500'],
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
    'latency < 1000ms': (r) => r.timings.duration < 1000,
  });

  // Simulate realistic user think time (1 to 2 seconds)
  sleep(Math.random() * 1 + 1);
}