import { createDatabaseClients, type DatabaseClients } from '@vichaar/db';
import { SystemClock } from '@vichaar/shared/clock';
import { createRateLimiter, type RateLimiter } from './shared/rate-limiter.js';
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

export interface AppContainer {
  db?: DatabaseClients;
  healthService: HealthService;
  authService?: AuthService;
  publicationService?: PublicationService;
  postService?: PostService;
  subscriptionService?: SubscriptionService;
  rateLimiter?: RateLimiter;
  close: () => Promise<void>;
}
export interface ContainerConfig {
  databaseUrl: string;
  databaseReplicaUrl?: string;
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
    publicationRepo: createPublicationRepository({ pool: db.primaryPool }),
  });
  const rateLimiter = createRateLimiter(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const postService = createPostService({
    postRepo: createPostRepository({ pool: db.primaryPool }),
    publicationService,
    clock,
  });
  const subscriptionService = createSubscriptionService({
    repository: createSubscriptionRepository({ pool: db.primaryPool }),
    publicationService,
    tokenSecret: process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!',
  });
  return {
    db,
    healthService,
    authService,
    publicationService,
    postService,
    subscriptionService,
    rateLimiter,
    close: async () => {
      await rateLimiter.close();
      await db.close();
    },
  };
}
