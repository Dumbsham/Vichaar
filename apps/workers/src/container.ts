import { createDatabaseClients } from '@vichaar/db';
import { createSqsQueues } from '@vichaar/queue';
import { createRateLimiter } from '@vichaar/api/rate-limiter';
import { createLocalQuoteCardStorage } from '@vichaar/api/quote-cards';
import { createDeliveryRepository } from './delivery-repository.js';
import { createEmailProvider } from './provider.js';
import { createPipeline } from './pipeline.js';
import { createWorkerMetrics } from './metrics.js';
import { startTracing } from './tracing.js';
import { createBillingPipeline } from './billing.js';
import { createAnalyticsPipeline } from './analytics.js';
import {
  createCloudflarePurger,
  createLocalPublicPageStore,
  createPublicPageFetcher,
  createPublicPagePipeline,
  createPublicPageRepository,
} from './public-pages.js';

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
  role:
    | 'relay'
    | 'fanout'
    | 'scheduler'
    | 'sender'
    | 'sweeper'
    | 'webhooks'
    | 'reconciliation'
    | 'analytics'
    | 'pages';
  clickhouseUrl: string;
  clickhouseDb: string;
  clickhouseUser?: string;
  clickhousePassword?: string;
  trackingBaseUrl: string;
  trackingSecret: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  metricsBasePort: number;
  otlpEndpoint?: string;
  quoteCardDir: string;
  publicHtmlDir: string;
  webOrigin: string;
  cloudflareZoneId?: string;
  cloudflareApiToken?: string;
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
  if (
    config.production &&
    config.role === 'pages' &&
    (!config.cloudflareZoneId || !config.cloudflareApiToken)
  )
    throw new Error('Production public pages require CDN purge credentials');
  const tracing = startTracing(config.otlpEndpoint);
  const metrics = createWorkerMetrics(
    config.role,
    config.metricsBasePort +
      [
        'relay',
        'fanout',
        'scheduler',
        'sender',
        'sweeper',
        'webhooks',
        'reconciliation',
        'analytics',
        'pages',
      ].indexOf(config.role),
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
    pages: queues.pages,
    provider,
    rateLimiter,
    tokenSecret: config.tokenSecret,
    baseUrl: config.publicBaseUrl,
    fromAddress: config.emailFrom,
    trackingBaseUrl: config.trackingBaseUrl,
    trackingSecret: config.trackingSecret,
    metrics,
    cardStorage: createLocalQuoteCardStorage(config.quoteCardDir),
  });
  const billing = createBillingPipeline({
    pool: database.primaryPool,
    hooks: queues.hooks,
    redisUrl: config.redisUrl,
    keyId: config.razorpayKeyId,
    keySecret: config.razorpayKeySecret,
  });
  const analytics = createAnalyticsPipeline({
    tracks: queues.tracks,
    clickhouseUrl: config.clickhouseUrl,
    database: config.clickhouseDb,
    user: config.clickhouseUser,
    password: config.clickhousePassword,
  });
  const publicPages = createPublicPagePipeline({
    pages: queues.pages,
    repository: createPublicPageRepository(database.primaryPool),
    store: createLocalPublicPageStore(config.publicHtmlDir),
    fetcher: createPublicPageFetcher(config.webOrigin),
    purger: createCloudflarePurger({
      baseUrl: config.publicBaseUrl,
      zoneId: config.cloudflareZoneId,
      apiToken: config.cloudflareApiToken,
    }),
  });
  return {
    database,
    queues,
    metrics,
    pipeline,
    billing,
    analytics,
    publicPages,
    async close() {
      await Promise.all([
        database.close(),
        rateLimiter.close(),
        billing.close(),
        provider.close(),
        metrics.close(),
        tracing.shutdown(),
      ]);
      queues.close();
    },
  };
}
