import { createClient } from 'redis';
import { AppError, NotFoundError } from '@vichaar/shared/errors';
import type { Clock } from '@vichaar/shared/clock';
import type { PublicationService } from '../publications/index.js';
import type { BillingProvider } from './provider.js';
import type { BillingRepository, PaidRow } from './repository.js';

export interface BillingService {
  checkout(subdomain: string, userId: string, email: string): Promise<object>;
  list(publicationId: string, userId: string, cursor?: string): Promise<object>;
  cancel(publicationId: string, userId: string, id: string): Promise<object>;
  isEntitled(publicationId: string, userId: string): Promise<boolean>;
  receiveWebhook(
    providerEventId: string,
    payload: Parameters<BillingRepository['receiveWebhook']>[1],
  ): Promise<string>;
  processWebhook(id: string): Promise<boolean>;
  reconcile(): Promise<number>;
  stats(): {
    checkouts: number;
    webhooks: number;
    cacheHits: number;
    dbChecks: number;
    redisErrors: number;
  };
  close(): Promise<void>;
}
function view(row: PaidRow) {
  return {
    id: row.id,
    publicationId: row.publication_id,
    status: row.status,
    pricePaise: row.price_paise,
    currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
    razorpaySubscriptionId: row.razorpay_subscription_id,
  };
}
export function createBillingService({
  repo,
  provider,
  publicationService,
  redisUrl,
  keyId,
  clock,
}: {
  repo: BillingRepository;
  provider: BillingProvider;
  publicationService: PublicationService;
  redisUrl: string;
  keyId: string;
  clock: Clock;
}): BillingService {
  const redis = createClient({
    url: redisUrl,
    socket: { connectTimeout: 200, reconnectStrategy: false },
    disableOfflineQueue: true,
  });
  redis.on('error', () => {});
  const counts = { checkouts: 0, webhooks: 0, cacheHits: 0, dbChecks: 0, redisErrors: 0 };
  async function cache() {
    if (!redis.isOpen) await redis.connect();
    return redis;
  }
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Redis deadline exceeded')), 500);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  function key(publicationId: string, userId: string) {
    return `entitlement:${publicationId}:${userId}`;
  }
  async function invalidate(publicationId: string, userId: string) {
    try {
      await bounded((await bounded(cache())).del(key(publicationId, userId)));
    } catch {
      counts.redisErrors++;
      if (redis.isOpen) redis.destroy();
    }
  }
  return {
    async checkout(subdomain, userId, email) {
      const pub = await publicationService.getBySubdomain(subdomain);
      if (pub.monthly_price_paise < 100)
        throw new AppError('Paid plan is unavailable', 409, 'PLAN_UNAVAILABLE');
      const row = await repo.checkout(
        pub.id,
        userId,
        email,
        pub.name,
        pub.monthly_price_paise,
        provider,
      );
      counts.checkouts++;
      return { ...view(row), keyId };
    },
    async list(publicationId, userId, cursor) {
      const rows = await repo.listOwned(publicationId, userId, cursor);
      return {
        items: rows.slice(0, 50).map(view),
        nextCursor: rows.length > 50 ? (rows[49]?.id ?? null) : null,
      };
    },
    async cancel(publicationId, userId, id) {
      const row = await repo.findOwned(publicationId, userId, id);
      if (!row) throw new NotFoundError();
      const remote = await provider.cancelSubscription(row.razorpay_subscription_id);
      const changed = await repo.applySnapshot(row.razorpay_subscription_id, remote, clock.now());
      if (changed) await invalidate(changed.publicationId, changed.userId);
      return {
        status: remote.status,
        currentPeriodEnd: remote.current_end
          ? new Date(remote.current_end * 1000).toISOString()
          : null,
      };
    },
    async isEntitled(publicationId, userId) {
      try {
        const value = await bounded((await bounded(cache())).get(key(publicationId, userId)));
        if (value === '1' || value === '0') {
          counts.cacheHits++;
          return value === '1';
        }
      } catch {
        counts.redisErrors++;
        if (redis.isOpen) redis.destroy();
      }
      let allowed: boolean;
      try {
        counts.dbChecks++;
        allowed = await repo.isEntitled(publicationId, userId);
      } catch {
        throw new AppError(
          'Paid access is temporarily unavailable',
          503,
          'ENTITLEMENT_UNAVAILABLE',
        );
      }
      try {
        await bounded(
          (await bounded(cache())).set(key(publicationId, userId), allowed ? '1' : '0', { EX: 60 }),
        );
      } catch {
        counts.redisErrors++;
        if (redis.isOpen) redis.destroy();
      }
      return allowed;
    },
    async receiveWebhook(providerEventId, payload) {
      const id = await repo.receiveWebhook(providerEventId, payload);
      counts.webhooks++;
      return id;
    },
    async processWebhook(id) {
      const result = await repo.processWebhook(id);
      if (result.publicationId && result.userId)
        await invalidate(result.publicationId, result.userId);
      return result.processed;
    },
    async reconcile() {
      const rows = await repo.stale(100);
      for (const row of rows) {
        const snapshot = await provider.fetchSubscription(row.razorpay_subscription_id);
        const abandoned =
          snapshot.status === 'created' &&
          clock.now().getTime() - row.created_at.getTime() >= 86_400_000;
        const changed = await repo.applySnapshot(
          row.razorpay_subscription_id,
          abandoned ? { ...snapshot, status: 'expired' } : snapshot,
          clock.now(),
        );
        if (changed) await invalidate(changed.publicationId, changed.userId);
      }
      return rows.length;
    },
    async close() {
      if (redis.isOpen) redis.destroy();
    },
    stats() {
      return { ...counts };
    },
  };
}
