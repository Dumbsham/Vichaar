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
    WORKER_ROLE: z.enum(['relay', 'fanout', 'scheduler', 'sender', 'sweeper']),
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
  metricsBasePort: config.METRICS_BASE_PORT,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const { database, queues, metrics, pipeline } = worker;
const roles = {
  relay: { interval: 1000, run: pipeline.relay },
  fanout: { interval: 1000, run: pipeline.fanoutOnce },
  scheduler: { interval: 15_000, run: pipeline.scheduleOnce },
  sender: { interval: 1000, run: pipeline.sendOnce },
  sweeper: { interval: 60_000, run: pipeline.sweep },
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
          : await queues.sends.depth();
      metrics.setQueueDepth(queueDepth);
      metrics.increment('worker_runs_total');
      metrics.increment('worker_duration_ms_total', Date.now() - started);
      if (typeof result === 'number') metrics.increment('worker_items_total', result);
      else {
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
