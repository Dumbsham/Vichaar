import { createDatabaseClients, type DatabaseClients } from '@vichaar/db';
import { SystemClock } from '@vichaar/shared/clock';
import { createRateLimiter, type RateLimiter } from './shared/rate-limiter.js';
import { createPreviewCache, type PreviewCache } from './shared/cache.js';
import { createSqsQueues } from '@vichaar/queue';
import {
  createBillingRepository,
  createBillingService,
  createRazorpayProvider,
  type BillingProvider,
  type BillingService,
} from './modules/billing/index.js';
import {
  createHealthRepository,
  createHealthService,
  type HealthService,
} from './modules/health/index.js';
import { createAuthRepository, createAuthService, type AuthService } from './modules/auth/index.js';
import {
  createPublicationRepository,
  createPublicationService,
  type PublicationService,
} from './modules/publications/index.js';
import {
  createPostRepository,
  createPostService,
  type PostService,
} from './modules/posts/index.js';
import {
  createSubscriptionRepository,
  createSubscriptionService,
  type SubscriptionService,
} from './modules/subscriptions/index.js';
import { createAnalyticsRepository, createAnalyticsService } from './modules/analytics/index.js';
import { createQuoteCardRepository, createQuoteCardService, createQuoteRenderer, createLocalQuoteCardStorage, type QuoteCardService } from './modules/quote-cards/index.js';
import { createMilestoneRepository, createMilestoneService } from './modules/milestones/index.js';

export interface AppContainer {
  db?: DatabaseClients;
  healthService: HealthService;
  authService?: AuthService;
  publicationService?: PublicationService;
  postService?: PostService;
  subscriptionService?: SubscriptionService;
  rateLimiter?: RateLimiter;
  previewCache?: PreviewCache;
  billingService?: BillingService;
  analyticsService?: ReturnType<typeof createAnalyticsService>;
  quoteCardService?: QuoteCardService;
  milestoneService?: ReturnType<typeof createMilestoneService>;
  enqueueHook?: (id: string, correlationId: string) => Promise<void>;
  webhookSecret?: string;
  close: () => Promise<void>;
}
export interface ContainerConfig {
  databaseUrl: string;
  databaseReplicaUrl?: string;
  rateLimitNamespace?: string;
  billingProvider?: BillingProvider;
  enqueueHook?: (id: string, correlationId: string) => Promise<void>;
  webhookSecret?: string;
}
export function createContainer(config: ContainerConfig): AppContainer {
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.TOKEN_HMAC_SECRET || process.env.TOKEN_HMAC_SECRET.length < 32)
  ) {
    throw new Error('TOKEN_HMAC_SECRET must be configured in production');
  }
  const db = createDatabaseClients({
    primaryUrl: config.databaseUrl,
    replicaUrl: config.databaseReplicaUrl,
  });
  const clock = new SystemClock();
  const healthService = createHealthService({
    healthRepo: createHealthRepository({ pool: db.primaryPool }),
  });
  const authService = createAuthService({
    authRepo: createAuthRepository({ pool: db.primaryPool }),
    clock,
  });
  const publicationService = createPublicationService({
    publicationRepo: createPublicationRepository({
      pool: db.primaryPool,
      readPool: db.replicaPool,
    }),
  });
  const billingPublicationService = createPublicationService({
    publicationRepo: createPublicationRepository({ pool: db.primaryPool }),
  });
  const analyticsService = createAnalyticsService({ publicationService: billingPublicationService, repo: createAnalyticsRepository(process.env.CLICKHOUSE_URL ?? 'http://localhost:8123', process.env.CLICKHOUSE_DB ?? 'vichaar', process.env.CLICKHOUSE_USER, process.env.CLICKHOUSE_PASSWORD) });
  const rateLimiter = createRateLimiter(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    Date.now,
    config.rateLimitNamespace,
  );
  const previewCache = createPreviewCache(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const provider =
    config.billingProvider ??
    (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') && process.env.RAZORPAY_KEY_SECRET
      ? createRazorpayProvider(process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET)
      : undefined);
  const webhookSecret = config.webhookSecret ?? process.env.RAZORPAY_WEBHOOK_SECRET;
  if (
    provider &&
    !config.billingProvider &&
    (!webhookSecret || webhookSecret.length < 32 || webhookSecret.includes('placeholder'))
  )
    throw new Error('A distinct Razorpay webhook secret of at least 32 characters is required');
  const billingService = provider
    ? createBillingService({
        repo: createBillingRepository(db.primaryPool, clock),
        provider,
        publicationService: billingPublicationService,
        clock,
        redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
        keyId: process.env.RAZORPAY_KEY_ID ?? 'rzp_test_stub',
      })
    : undefined;
  const hooks = createSqsQueues({
    endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:9324',
    baseUrl: process.env.SQS_QUEUE_BASE_URL ?? 'http://localhost:9324/queue',
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  const enqueueHook =
    config.enqueueHook ??
    (async (id: string, correlationId: string) => {
      await hooks.hooks.send({ type: 'RazorpayWebhook', eventId: id, correlationId });
    });
  const postService = createPostService({
    postRepo: createPostRepository({ pool: db.primaryPool, readPool: db.replicaPool }),
    previewCache,
    entitlement: billingService,
    publicationService,
    clock,
  });
  const subscriptionService = createSubscriptionService({
    repository: createSubscriptionRepository({ pool: db.primaryPool }),
    publicationService,
    tokenSecret: process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!',
  });
  const quoteCardService = createQuoteCardService({
    publicationService,
    repository: createQuoteCardRepository(db.primaryPool),
    storage: createLocalQuoteCardStorage(process.env.QUOTE_CARD_DIR ?? './data/quote-cards'),
    renderer: createQuoteRenderer(),
    entitlement: billingService,
  });
  const milestoneService = createMilestoneService({ publicationService, repository: createMilestoneRepository(db.primaryPool) });
  return {
    db,
    healthService,
    authService,
    publicationService,
    postService,
    subscriptionService,
    rateLimiter,
    previewCache,
    billingService,
    analyticsService,
    quoteCardService,
    milestoneService,
    enqueueHook,
    webhookSecret,
    close: async () => {
      await rateLimiter.close();
      await previewCache.close();
      if (billingService) await billingService.close();
      hooks.close();
      await db.close();
    },
  };
}
