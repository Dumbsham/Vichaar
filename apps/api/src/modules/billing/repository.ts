import type { Pool } from '@vichaar/db';
import { generateId } from '@vichaar/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@vichaar/shared/errors';
import type { Clock } from '@vichaar/shared/clock';
import type { BillingProvider } from './provider.js';
import { webhookSchema, type ProviderSubscription, type WebhookPayload } from './schemas.js';

export interface PaidRow {
  id: string;
  publication_id: string;
  subscription_id: string;
  user_id: string;
  razorpay_subscription_id: string;
  status: string;
  price_paise: number;
  current_period_end: Date | null;
  last_event_at: Date | null;
  created_at: Date;
}
export interface BillingRepository {
  checkout(
    publicationId: string,
    userId: string,
    email: string,
    name: string,
    pricePaise: number,
    provider: BillingProvider,
  ): Promise<PaidRow>;
  findOwned(publicationId: string, userId: string, id: string): Promise<PaidRow | null>;
  listOwned(publicationId: string, userId: string, cursor?: string): Promise<PaidRow[]>;
  isEntitled(publicationId: string, userId: string): Promise<boolean>;
  receiveWebhook(providerEventId: string, payload: WebhookPayload): Promise<string>;
  processWebhook(
    id: string,
  ): Promise<{ processed: boolean; publicationId?: string; userId?: string }>;
  applySnapshot(
    providerId: string,
    snapshot: ProviderSubscription,
    observedAt: Date,
  ): Promise<{ publicationId: string; userId: string } | null>;
  stale(limit: number): Promise<PaidRow[]>;
}
function statusOf(value: ProviderSubscription['status']): string {
  if (value === 'resumed') return 'active';
  if (value === 'authenticated') return 'created';
  if (value === 'pending' || value === 'paused') return 'halted';
  if (value === 'completed') return 'expired';
  return value;
}
export function createBillingRepository(pool: Pool, clock: Clock): BillingRepository {
  return {
    async checkout(publicationId, userId, email, name, pricePaise, provider) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const active = await client.query<{ id: string }>(
          `SELECT id FROM subscriptions WHERE publication_id=$1 AND email=$2 AND status='active' FOR UPDATE`,
          [publicationId, email],
        );
        const subscriptionId = active.rows[0]?.id;
        if (!subscriptionId)
          throw new ForbiddenError('Confirm your email subscription before checkout');
        const existing = await client.query<PaidRow>(
          `SELECT * FROM paid_subscriptions WHERE publication_id=$1 AND subscription_id=$2
           ORDER BY created_at DESC,id DESC FOR UPDATE`,
          [publicationId, subscriptionId],
        );
        const previous = existing.rows[0];
        if (previous) {
          if (previous.user_id !== userId)
            throw new ConflictError('Subscription already linked to another account');
        }
        const open = existing.rows.find(
          (row) =>
            ['created', 'active', 'halted'].includes(row.status) ||
            (row.status === 'cancelled' &&
              row.current_period_end !== null &&
              row.current_period_end > clock.now()),
        );
        if (open) {
          await client.query('COMMIT');
          return open;
        }
        const plan = await client.query<{ razorpay_plan_id: string }>(
          'SELECT razorpay_plan_id FROM billing_plans WHERE publication_id=$1 AND price_paise=$2',
          [publicationId, pricePaise],
        );
        let planId = plan.rows[0]?.razorpay_plan_id;
        if (!planId) {
          planId = await provider.createPlan(name, pricePaise);
          await client.query(
            'INSERT INTO billing_plans(publication_id,price_paise,razorpay_plan_id) VALUES($1,$2,$3)',
            [publicationId, pricePaise, planId],
          );
        }
        const remote = await provider.createSubscription(planId, publicationId, subscriptionId);
        const created = await client.query<PaidRow>(
          `INSERT INTO paid_subscriptions(id,publication_id,subscription_id,user_id,razorpay_subscription_id,status,price_paise)
           VALUES($1,$2,$3,$4,$5,'created',$6) RETURNING *`,
          [generateId(), publicationId, subscriptionId, userId, remote.id, pricePaise],
        );
        const row = created.rows[0];
        if (!row) throw new Error('Checkout row missing');
        await client.query('COMMIT');
        return row;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async findOwned(publicationId, userId, id) {
      const result = await pool.query<PaidRow>(
        'SELECT * FROM paid_subscriptions WHERE publication_id=$1 AND user_id=$2 AND id=$3',
        [publicationId, userId, id],
      );
      return result.rows[0] ?? null;
    },
    async listOwned(publicationId, userId, cursor) {
      const result = await pool.query<PaidRow>(
        'SELECT * FROM paid_subscriptions WHERE publication_id=$1 AND user_id=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 51',
        [publicationId, userId, cursor ?? null],
      );
      return result.rows;
    },
    async isEntitled(publicationId, userId) {
      const result = await pool.query(
        `SELECT 1 FROM paid_subscriptions WHERE publication_id=$1 AND user_id=$2
         AND (status='active' OR (status='cancelled' AND current_period_end>now())) LIMIT 1`,
        [publicationId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async receiveWebhook(providerEventId, payload) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO webhook_events(id,provider,provider_event_id,type,payload)
         VALUES($1,'razorpay',$2,$3,$4) ON CONFLICT(provider,provider_event_id)
         DO NOTHING RETURNING id`,
        [generateId(), providerEventId, payload.event, payload],
      );
      const id =
        result.rows[0]?.id ??
        (
          await pool.query<{ id: string }>(
            "SELECT id FROM webhook_events WHERE provider='razorpay' AND provider_event_id=$1",
            [providerEventId],
          )
        ).rows[0]?.id;
      if (!id) throw new Error('Webhook inbox row missing');
      return id;
    },
    async processWebhook(id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const event = await client.query<{ payload: unknown; status: string }>(
          "SELECT payload,status FROM webhook_events WHERE id=$1 AND provider='razorpay' FOR UPDATE",
          [id],
        );
        const row = event.rows[0];
        if (!row) throw new NotFoundError();
        if (row.status !== 'pending') {
          await client.query('COMMIT');
          return { processed: true };
        }
        const payload = webhookSchema.parse(row.payload);
        const entity = payload.payload.subscription.entity;
        const paid = await client.query<PaidRow>(
          'SELECT * FROM paid_subscriptions WHERE razorpay_subscription_id=$1 FOR UPDATE',
          [entity.id],
        );
        const current = paid.rows[0];
        if (!current) {
          await client.query('COMMIT');
          return { processed: false };
        }
        const incomingAt = new Date(payload.created_at * 1000);
        if (!current.last_event_at || incomingAt > current.last_event_at) {
          await client.query(
            `UPDATE paid_subscriptions SET status=$2,current_period_end=$3,last_event_at=$4,updated_at=now() WHERE id=$1`,
            [
              current.id,
              statusOf(entity.status),
              entity.current_end ? new Date(entity.current_end * 1000) : null,
              incomingAt,
            ],
          );
        }
        await client.query(
          "UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1",
          [id],
        );
        await client.query('COMMIT');
        return { processed: true, publicationId: current.publication_id, userId: current.user_id };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async applySnapshot(providerId, snapshot, observedAt) {
      const result = await pool.query<{ publication_id: string; user_id: string }>(
        `UPDATE paid_subscriptions SET status=$2,current_period_end=$3,last_event_at=$4,updated_at=now()
         WHERE razorpay_subscription_id=$1 AND (last_event_at IS NULL OR last_event_at<$4)
         RETURNING publication_id,user_id`,
        [
          providerId,
          statusOf(snapshot.status),
          snapshot.current_end ? new Date(snapshot.current_end * 1000) : null,
          observedAt,
        ],
      );
      const row = result.rows[0];
      return row ? { publicationId: row.publication_id, userId: row.user_id } : null;
    },
    async stale(limit) {
      const result = await pool.query<PaidRow>(
        `SELECT * FROM paid_subscriptions WHERE status IN ('created','active','halted')
         AND (last_event_at IS NULL OR last_event_at<now()-interval '1 hour' OR current_period_end<now())
         ORDER BY last_event_at NULLS FIRST,id LIMIT $1`,
        [limit],
      );
      return result.rows;
    },
  };
}
