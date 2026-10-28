import { createDatabaseClients } from '@vichaar/db';
import { createSqsQueues } from '@vichaar/queue';
import { createRateLimiter } from '@vichaar/api/rate-limiter';
import { createDeliveryRepository } from './delivery-repository.js';
import { createEmailProvider } from './provider.js';
import { createPipeline } from './pipeline.js';
import { createWorkerMetrics } from './metrics.js';
import { startTracing } from './tracing.js';

export interface WorkerConfig {
  production: boolean;
  databaseUrl: string;
  redisUrl: string;
  sqsEndpoint: string;
  sqsQueueBaseUrl: string;
  region: string;
  tokenSecret: string;
  publicBaseUrl: string;
  emailFrom: string;
  emailProvider: 'smtp' | 'ses' | 'stub';
  smtpHost: string;
  smtpPort: number;
  verifiedAddresses: string[];
  role: 'relay' | 'fanout' | 'scheduler' | 'sender' | 'sweeper';
  metricsBasePort: number;
  otlpEndpoint?: string;
}

export function createWorkerContainer(config: WorkerConfig) {
  if (
    config.production &&
    (!config.sqsEndpoint.startsWith('https://') ||
      !config.sqsQueueBaseUrl.startsWith('https://') ||
      !config.publicBaseUrl.startsWith('https://') ||
      config.tokenSecret.length < 32 ||
      config.verifiedAddresses.length === 0)
  ) {
    throw new Error('Production queue and public URLs must be configured securely');
  }
  const tracing = startTracing(config.otlpEndpoint);
  const metrics = createWorkerMetrics(
    config.role,
    config.metricsBasePort +
      ['relay', 'fanout', 'scheduler', 'sender', 'sweeper'].indexOf(config.role),
  );
  const database = createDatabaseClients({ primaryUrl: config.databaseUrl, maxConnections: 3 });
  const queues = createSqsQueues({
    endpoint: config.sqsEndpoint,
    baseUrl: config.sqsQueueBaseUrl,
    region: config.region,
  });
  const provider = createEmailProvider({
    mode: config.emailProvider,
    production: config.production,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    region: config.region,
    verifiedAddresses: config.verifiedAddresses,
  });
  const rateLimiter = createRateLimiter(config.redisUrl);
  const pipeline = createPipeline({
    repo: createDeliveryRepository(database.primaryPool),
    events: queues.events,
    sends: queues.sends,
    provider,
    rateLimiter,
    tokenSecret: config.tokenSecret,
    baseUrl: config.publicBaseUrl,
    fromAddress: config.emailFrom,
    metrics,
  });
  return {
    database,
    queues,
    metrics,
    pipeline,
    async close() {
      await Promise.all([
        database.close(),
        rateLimiter.close(),
        provider.close(),
        metrics.close(),
        tracing.shutdown(),
      ]);
      queues.close();
    },
  };
}
