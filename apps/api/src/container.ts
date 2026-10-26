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

export interface AppContainer {
  db?: DatabaseClients;
  healthService: HealthService;
  authService?: AuthService;
  publicationService?: PublicationService;
  postService?: PostService;
  rateLimiter?: RateLimiter;
  close: () => Promise<void>;
}
export interface ContainerConfig {
  databaseUrl: string;
  databaseReplicaUrl?: string;
}
export function createContainer(config: ContainerConfig): AppContainer {
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
  return {
    db,
    healthService,
    authService,
    publicationService,
    postService,
    rateLimiter,
    close: async () => {
      await rateLimiter.close();
      await db.close();
    },
  };
}
