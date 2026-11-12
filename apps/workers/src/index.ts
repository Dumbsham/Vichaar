import { z } from 'zod';
import { verifyPostDeliveriesPartitions } from '@vichaar/db';
import { createWorkerContainer } from './container.js';

const config = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .default('postgres://vichaar:vichaar_pass@localhost:5432/vichaar'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    SQS_ENDPOINT: z.string().url().default('http://localhost:9324'),
    SQS_QUEUE_BASE_URL: z.string().url().default('http://localhost:9324/queue'),
    AWS_REGION: z.string().default('us-east-1'),
    TOKEN_HMAC_SECRET: z.string().min(32).default('local_development_hmac_secret_32chars_min!'),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
    EMAIL_FROM: z.string().email().default('newsletter@vichaar.test'),
    EMAIL_PROVIDER: z.enum(['smtp', 'ses', 'stub']).default('smtp'),
    MAILPIT_SMTP_HOST: z.string().default('localhost'),
    MAILPIT_SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SES_VERIFIED_ADDRESSES: z.string().default(''),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    CLICKHOUSE_URL: z.string().url().default('http://localhost:8123'),
    CLICKHOUSE_DB: z.string().regex(/^[a-zA-Z0-9_]+$/).default('vichaar'),
    CLICKHOUSE_USER: z.string().optional(),
    CLICKHOUSE_PASSWORD: z.string().optional(),
    TRACKING_BASE_URL: z.string().url().default('http://localhost:4001'),
    TRACKING_HMAC_SECRET: z.string().min(32).default('local_development_tracking_secret_32chars_min!'),
    WORKER_ROLE: z.enum([
      'relay',
      'fanout',
      'scheduler',
      'sender',
      'sweeper',
      'webhooks',
      'reconciliation',
      'analytics',
    ]),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    METRICS_BASE_PORT: z.coerce.number().int().positive().default(9100),
  })
  .parse(process.env);
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.TOKEN_HMAC_SECRET || !process.env.EMAIL_FROM)
) {
  throw new Error('Production token and sender configuration must be explicit');
}
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.TRACKING_HMAC_SECRET || !config.TRACKING_BASE_URL.startsWith('https://'))
) {
  throw new Error('Production tracking configuration must be explicit and secure');
}
const worker = createWorkerContainer({
  production: process.env.NODE_ENV === 'production',
  databaseUrl: config.DATABASE_URL,
  redisUrl: config.REDIS_URL,
  sqsEndpoint: config.SQS_ENDPOINT,
  sqsQueueBaseUrl: config.SQS_QUEUE_BASE_URL,
  region: config.AWS_REGION,
  tokenSecret: config.TOKEN_HMAC_SECRET,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  emailFrom: config.EMAIL_FROM,
  emailProvider: config.EMAIL_PROVIDER,
  smtpHost: config.MAILPIT_SMTP_HOST,
  smtpPort: config.MAILPIT_SMTP_PORT,
  verifiedAddresses: config.SES_VERIFIED_ADDRESSES.split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  role: config.WORKER_ROLE,
  clickhouseUrl: config.CLICKHOUSE_URL,
  clickhouseDb: config.CLICKHOUSE_DB,
  clickhouseUser: config.CLICKHOUSE_USER,
  clickhousePassword: config.CLICKHOUSE_PASSWORD,
  trackingBaseUrl: config.TRACKING_BASE_URL,
  trackingSecret: config.TRACKING_HMAC_SECRET,
  razorpayKeyId: config.RAZORPAY_KEY_ID,
  razorpayKeySecret: config.RAZORPAY_KEY_SECRET,
  metricsBasePort: config.METRICS_BASE_PORT,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const { database, queues, metrics, pipeline, billing, analytics } = worker;
const roles = {
  relay: { interval: 1000, run: pipeline.relay }, // post publish hogya,queue mein daalta
  fanout: { interval: 1000, run: pipeline.fanoutOnce },
  scheduler: { interval: 15_000, run: pipeline.scheduleOnce },
  sender: { interval: 1000, run: pipeline.sendOnce },
  sweeper: { interval: 60_000, run: pipeline.sweep },
  webhooks: { interval: 1000, run: billing.processOnce },
  reconciliation: { interval: 3_600_000, run: billing.reconcile },
  analytics: { interval: 1000, run: analytics.consumeOnce },
};
const role = roles[config.WORKER_ROLE];
let running = true;
process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});
async function main() {
  await metrics.ready;
  if (config.WORKER_ROLE === 'analytics') await analytics.initialize();
  const partitions = await verifyPostDeliveriesPartitions(database.primaryPool);
  if (!partitions.ok)
    throw new Error(`Missing delivery partitions: ${partitions.missingPartitions.join(',')}`);
  while (running) {
    const started = Date.now();
    const cpuStarted = process.cpuUsage();
    try {
      const result = await role.run();
      const queueDepth =
        config.WORKER_ROLE === 'relay' || config.WORKER_ROLE === 'fanout'
          ? await queues.events.depth()
          : config.WORKER_ROLE === 'webhooks'
            ? await queues.hooks.depth()
            : config.WORKER_ROLE === 'reconciliation'
              ? 0
              : config.WORKER_ROLE === 'analytics'
                ? await queues.tracks.depth()
              : await queues.sends.depth();
      metrics.setQueueDepth(queueDepth);
      metrics.increment('worker_runs_total');
      metrics.increment('worker_duration_ms_total', Date.now() - started);
      if (typeof result === 'number') {
        metrics.increment('worker_items_total', result);
        if (config.WORKER_ROLE === 'webhooks') metrics.increment('webhook_processed_total', result);
        if (config.WORKER_ROLE === 'reconciliation')
          metrics.increment('reconciliation_checked_total', result);
      } else {
        metrics.increment('sweeper_unknown_outcome_total', result.unknown);
        metrics.increment('sweeper_requeued_total', result.requeued);
        metrics.increment('sweeper_outbox_purged_total', result.outboxPurged);
      }
      if (config.WORKER_ROLE === 'sender') {
        const cpu = process.cpuUsage(cpuStarted);
        metrics.increment('sender_cpu_ms_total', (cpu.user + cpu.system) / 1000);
      }
      console.log(
        JSON.stringify({ worker: config.WORKER_ROLE, result, durationMs: Date.now() - started }),
      );
    } catch (error) {
      metrics.increment('worker_errors_total');
      console.error(
        JSON.stringify({
          worker: config.WORKER_ROLE,
          error: error instanceof Error ? error.message : 'unknown',
        }),
      );
    }
    if (running) await new Promise<void>((resolve) => setTimeout(resolve, role.interval));
  }
}
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await worker.close();
  });
