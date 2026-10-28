import { describe, expect, it } from 'vitest';
import { createWorkerMetrics } from '../src/metrics.js';

describe('worker metrics', () => {
  it('exposes bounded counters and queue depth without recipient data', async () => {
    const metrics = createWorkerMetrics('sender', 0);
    try {
      const port = await metrics.ready;
      metrics.increment('sender_emails_total', 2);
      metrics.increment('sender_unknown_outcome_total');
      metrics.setQueueDepth(7);
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('vichaar_sender_emails_total{worker="sender"} 2');
      expect(body).toContain('vichaar_sender_unknown_outcome_total{worker="sender"} 1');
      expect(body).toContain('vichaar_queue_depth{worker="sender"} 7');
      expect(body).not.toContain('@');
    } finally {
      await metrics.close();
    }
  });
});
