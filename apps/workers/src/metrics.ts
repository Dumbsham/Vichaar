import { createServer, type Server } from 'node:http';

export function createWorkerMetrics(role: string, port: number) {
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();
  const allowed = new Set([
    'worker_runs_total',
    'worker_errors_total',
    'worker_items_total',
    'worker_duration_ms_total',
    'sender_cpu_ms_total',
    'sender_emails_total',
    'sender_sent_total',
    'sender_failed_total',
    'sender_unknown_outcome_total',
    'sender_retried_total',
    'sender_skipped_total',
    'sweeper_unknown_outcome_total',
    'sweeper_requeued_total',
    'sweeper_outbox_purged_total',
  ]);
  const server: Server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    const lines = [...counters.entries(), ...gauges.entries()].map(
      ([name, value]) => `vichaar_${name}{worker="${role}"} ${value}`,
    );
    res
      .writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
      .end(`${lines.join('\n')}\n`);
  });
  const ready = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      const address = server.address();
      if (typeof address === 'object' && address) resolve(address.port);
      else reject(new Error('Metrics listener has no port'));
    });
  });
  return {
    ready,
    increment(name: string, value = 1) {
      if (!allowed.has(name)) throw new Error('Unknown metric');
      counters.set(name, (counters.get(name) ?? 0) + value);
    },
    setQueueDepth(value: number) {
      gauges.set('queue_depth', value);
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
export type WorkerMetrics = ReturnType<typeof createWorkerMetrics>;
