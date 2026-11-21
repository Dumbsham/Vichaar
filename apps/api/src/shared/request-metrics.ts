const bucketBounds = [10, 50, 100, 300, 1000, 5000];

export function createRequestMetrics() {
  const counts = { total: 0, errors: 0, durationMs: 0, inFlight: 0 };
  const buckets = bucketBounds.map(() => 0);
  let infinity = 0;
  return {
    begin() {
      counts.inFlight++;
      const started = performance.now();
      return (statusCode: number) => {
        const duration = performance.now() - started;
        counts.inFlight--;
        counts.total++;
        if (statusCode >= 500) counts.errors++;
        counts.durationMs += duration;
        for (let i = 0; i < bucketBounds.length; i++)
          if (duration <= bucketBounds[i]!) buckets[i]!++;
        infinity++;
      };
    },
    prometheus() {
      return `vichaar_api_requests_total ${counts.total}\n` +
        `vichaar_api_errors_total ${counts.errors}\n` +
        `vichaar_api_requests_in_flight ${counts.inFlight}\n` +
        `vichaar_api_request_duration_ms_sum ${counts.durationMs}\n` +
        `vichaar_api_request_duration_ms_count ${counts.total}\n` +
        bucketBounds.map((bound, i) => `vichaar_api_request_duration_ms_bucket{le="${bound}"} ${buckets[i]}`).join('\n') + '\n' +
        `vichaar_api_request_duration_ms_bucket{le="+Inf"} ${infinity}\n`;
    },
  };
}
