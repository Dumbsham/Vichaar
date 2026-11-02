import type { Pool } from '@vichaar/db';
import type { Queue, HookMessage } from '@vichaar/queue';
import {
  createBillingRepository,
  createBillingService,
  createRazorpayProvider,
  type BillingProvider,
} from '@vichaar/api/billing';
import { createPublicationRepository, createPublicationService } from '@vichaar/api/publications';
import { SystemClock } from '@vichaar/shared/clock';

export function createBillingPipeline({
  pool,
  hooks,
  redisUrl,
  keyId,
  keySecret,
}: {
  pool: Pool;
  hooks: Queue<HookMessage>;
  redisUrl: string;
  keyId?: string;
  keySecret?: string;
}) {
  const provider: BillingProvider | undefined =
    keyId && keySecret ? createRazorpayProvider(keyId, keySecret) : undefined;
  const publicationService = createPublicationService({
    publicationRepo: createPublicationRepository({ pool }),
  });
  const clock = new SystemClock();
  const billing = createBillingService({
    repo: createBillingRepository(pool, clock),
    clock,
    provider: provider ?? {
      async createPlan() {
        throw new Error('Razorpay test credentials unavailable');
      },
      async createSubscription() {
        throw new Error('Razorpay test credentials unavailable');
      },
      async fetchSubscription() {
        throw new Error('Razorpay test credentials unavailable');
      },
      async cancelSubscription() {
        throw new Error('Razorpay test credentials unavailable');
      },
    },
    publicationService,
    redisUrl,
    keyId: keyId ?? 'unconfigured',
  });
  return {
    async processOnce() {
      const messages = await hooks.receive();
      let processed = 0;
      for (const message of messages) {
        const done = await billing.processWebhook(message.body.eventId);
        if (done) {
          await hooks.delete(message.receipt);
          processed++;
        }
      }
      return processed;
    },
    async reconcile() {
      return provider ? billing.reconcile() : 0;
    },
    close: () => billing.close(),
  };
}
