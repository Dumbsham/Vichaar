import http from 'k6/http';
import { check } from 'k6';
/* global __ENV */

// Supply pre-signed, published-link tokens through environment variables.
export const options = {
  scenarios: {
    opens: {
      executor: 'constant-arrival-rate',
      rate: 1000,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: { http_req_failed: ['rate<0.01'], dropped_iterations: ['count==0'] },
};
const base = __ENV.TRACKING_BASE_URL || 'http://localhost:4001';
const token = __ENV.OPEN_TOKEN;
if (!token) throw new Error('OPEN_TOKEN is required');
export default function () {
  const response = http.get(`${base}/t/o/${token}.gif`, { tags: { name: 'tracking-open' } });
  check(response, { 'pixel succeeds': (result) => result.status === 200 });
}
