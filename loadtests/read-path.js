/* global __ENV */
import http from 'k6/http';
import { check } from 'k6';

const base = __ENV.BASE_URL || 'http://localhost:4000';
const path = __ENV.POST_PATH;
const mode = __ENV.MODE || 'cached';
if (!path) throw new Error('POST_PATH must name an existing public post, for example /public/demo/posts/hello');
if (!['cached', 'uncached'].includes(mode)) throw new Error('MODE must be cached or uncached');
// For uncached mode, stop Redis and bypass the CDN before running this script.
const uncached = mode === 'uncached';
export const options = {
  scenarios: { reads: { executor: 'constant-arrival-rate', rate: uncached ? 100 : 1000, timeUnit: '1s', duration: '1m', preAllocatedVUs: uncached ? 50 : 100, maxVUs: uncached ? 200 : 400 } },
  thresholds: { http_req_duration: [`p(95)<${uncached ? 300 : 100}`], http_req_failed: ['rate<0.01'] },
};
export default function () { check(http.get(`${base}${path}`), { 'read succeeds': (r) => r.status === 200 }); }
