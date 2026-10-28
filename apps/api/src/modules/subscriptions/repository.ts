import { createHash } from 'node:crypto';
import type { Pool } from '@vichaar/db';
import { generateId } from '@vichaar/db';
import type { SubscribeInput } from './schemas.js';
import type { PreferencesInput } from './schemas.js';
import { computeSendAt } from '@vichaar/shared/scheduling';

export interface SubscriptionRow {
  id: string;
  publication_id: string;
  email: string;
  status: string;
  slot: 'morning' | 'afternoon' | 'evening';
  timezone: string;
  confirmation_expires_at: Date | null;
}
interface PendingDeliveryRow {
  post_id: string;
  old_month: string;
  scheduled_for: Date | null;
  send_immediately: boolean;
}
export interface SubscriptionRepository {
  request(
    publicationId: string,
    input: SubscribeInput,
    tokenFactory: (id: string, exp: number) => string,
    correlationId: string,
  ): Promise<void>;
  confirm(publicationId: string, id: string, token: string): Promise<boolean>;
  unsubscribe(publicationId: string, id: string): Promise<void>;
  find(publicationId: string, id: string): Promise<SubscriptionRow | null>;
  updatePreferences(publicationId: string, id: string, input: PreferencesInput): Promise<boolean>;
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSubscriptionRepository({ pool }: { pool: Pool }): SubscriptionRepository {
  return {
    async request(publicationId, input, tokenFactory, correlationId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<SubscriptionRow>(
          'SELECT * FROM subscriptions WHERE publication_id=$1 AND email=$2 FOR UPDATE',
          [publicationId, input.email],
        );
        if (existing.rows[0]?.status === 'active') {
          await client.query('COMMIT');
          return;
        }
        const suppressed = await client.query(
          'SELECT 1 FROM suppressions WHERE publication_id=$1 AND email=$2',
          [publicationId, input.email],
        );
        if (suppressed.rowCount) {
          await client.query('COMMIT');
          return;
        }
        const id = existing.rows[0]?.id ?? generateId();
        const daily = await client.query<{ allowed: boolean }>(
          `SELECT COALESCE(confirmation_day<>current_date, true) OR confirmation_count<3 AS allowed
           FROM subscriptions WHERE publication_id=$1 AND id=$2`,
          [publicationId, id],
        );
        if (daily.rows[0] && !daily.rows[0].allowed) {
          await client.query('COMMIT');
          return;
        }
        const expiry = await client.query<{ exp: number }>(
          "SELECT floor(extract(epoch FROM now() + interval '24 hours'))::integer AS exp",
        );
        const exp = expiry.rows[0]?.exp;
        if (!exp) throw new Error('Cannot create confirmation expiry');
        const token = tokenFactory(id, exp);
        const updated = await client.query<SubscriptionRow>(
          `INSERT INTO subscriptions (id,publication_id,email,slot,timezone,confirmation_token_hash,confirmation_expires_at,confirmation_sent_at,confirmation_day,confirmation_count)
           VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7),now(),current_date,1)
           ON CONFLICT (publication_id,email) DO UPDATE SET
             status='pending',slot=EXCLUDED.slot,timezone=EXCLUDED.timezone,
             confirmation_token_hash=EXCLUDED.confirmation_token_hash,
             confirmation_expires_at=EXCLUDED.confirmation_expires_at,
             confirmation_sent_at=now(),
             confirmation_dispatched_at=NULL,
             confirmation_count=CASE WHEN subscriptions.confirmation_day=current_date THEN subscriptions.confirmation_count+1 ELSE 1 END,
             confirmation_day=current_date,updated_at=now()
           RETURNING *`,
          [id, publicationId, input.email, input.slot, input.timezone, hash(token), exp],
        );
        const subscription = updated.rows[0];
        if (subscription)
          await client.query('INSERT INTO outbox_events(event_type,payload) VALUES ($1,$2)', [
            'SubscriptionConfirmationRequested',
            { publicationId, subscriptionId: subscription.id, exp, correlationId },
          ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async confirm(publicationId, id, token) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<{ id: string }>(
          `UPDATE subscriptions SET status='active',confirmation_token_hash=NULL,updated_at=now()
           WHERE publication_id=$1 AND id=$2 AND status='pending'
             AND confirmation_token_hash=$3 AND confirmation_expires_at>now()
             AND NOT EXISTS (SELECT 1 FROM suppressions x WHERE x.publication_id=$1 AND x.email=subscriptions.email)
           RETURNING id`,
          [publicationId, id, hash(token)],
        );
        if (result.rows[0])
          await client.query(
            'UPDATE publications SET subscriber_count=subscriber_count+1,updated_at=now() WHERE id=$1',
            [publicationId],
          );
        await client.query('COMMIT');
        if (result.rows[0]) return true;
        const existing = await pool.query<{ status: string }>(
          'SELECT status FROM subscriptions WHERE publication_id=$1 AND id=$2',
          [publicationId, id],
        );
        return existing.rows[0]?.status === 'active';
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async unsubscribe(publicationId, id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const previous = await client.query<{ email: string; status: string }>(
          'SELECT email,status FROM subscriptions WHERE publication_id=$1 AND id=$2 FOR UPDATE',
          [publicationId, id],
        );
        const prior = previous.rows[0];
        const changed = await client.query<{ email: string }>(
          `UPDATE subscriptions SET status='unsubscribed',confirmation_token_hash=NULL,updated_at=now()
           WHERE publication_id=$1 AND id=$2 AND status<>'unsubscribed' RETURNING email`,
          [publicationId, id],
        );
        const row = changed.rows[0];
        if (row) {
          await client.query(
            `INSERT INTO suppressions(publication_id,email,reason) VALUES($1,$2,'unsubscribe')
             ON CONFLICT(publication_id,email) DO NOTHING`,
            [publicationId, row.email],
          );
          if (prior?.status === 'active')
            await client.query(
              'UPDATE publications SET subscriber_count=subscriber_count-1,updated_at=now() WHERE id=$1',
              [publicationId],
            );
          await client.query(
            `UPDATE post_deliveries SET status='skipped',updated_at=now()
             WHERE publication_id=$1 AND subscription_id=$2 AND status IN ('pending','queued')`,
            [publicationId, id],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async find(publicationId, id) {
      const result = await pool.query<SubscriptionRow>(
        'SELECT * FROM subscriptions WHERE publication_id=$1 AND id=$2',
        [publicationId, id],
      );
      return result.rows[0] ?? null;
    },
    async updatePreferences(publicationId, id, input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const changed = await client.query(
          `UPDATE subscriptions SET slot=$3,timezone=$4,updated_at=now()
           WHERE publication_id=$1 AND id=$2 AND status='active' RETURNING id`,
          [publicationId, id, input.slot, input.timezone],
        );
        if (!changed.rows[0]) {
          await client.query('COMMIT');
          return false;
        }
        const clock = await client.query<{ now: Date }>('SELECT now() AS now');
        const now = clock.rows[0]?.now;
        if (!now) throw new Error('Database clock unavailable');
        let afterPostId: string | null = null;
        for (;;) {
          const page: { rows: PendingDeliveryRow[] } = await client.query<PendingDeliveryRow>(
            `SELECT d.post_id,to_char(d.send_month,'YYYY-MM-DD') AS old_month,p.scheduled_for,d.send_immediately
             FROM post_deliveries d JOIN posts p ON p.id=d.post_id AND p.publication_id=d.publication_id
             WHERE d.publication_id=$1 AND d.subscription_id=$2 AND d.status='pending'
               AND ($3::uuid IS NULL OR d.post_id>$3::uuid)
             ORDER BY d.post_id LIMIT 100 FOR UPDATE OF d`,
            [publicationId, id, afterPostId],
          );
          if (page.rows.length === 0) break;
          const updates = page.rows.map((row) => {
            const sendAt = computeSendAt(
              now,
              row.scheduled_for,
              input.slot,
              input.timezone,
              row.send_immediately,
            );
            return {
              post_id: row.post_id,
              old_month: row.old_month,
              send_at: sendAt.toISOString(),
            };
          });
          await client.query(
            `UPDATE post_deliveries d SET send_at=x.send_at,updated_at=now()
             FROM jsonb_to_recordset($3::jsonb) AS x(post_id uuid,old_month date,send_at timestamptz)
             WHERE d.publication_id=$1 AND d.subscription_id=$2 AND d.post_id=x.post_id AND d.send_month=x.old_month AND d.status='pending'`,
            [publicationId, id, JSON.stringify(updates)],
          );
          afterPostId = page.rows.at(-1)?.post_id ?? null;
          if (page.rows.length < 100) break;
        }
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
