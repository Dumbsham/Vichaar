import type { Pool } from '@vichaar/db';
import { eventMessage, type DeliveryKey, type EventMessage } from '@vichaar/queue';
import { computeSendAt, type Slot } from '@vichaar/shared/scheduling';

interface Subscriber {
  id: string;
  slot: Slot;
  timezone: string;
}
interface ClaimRow {
  publication_id: string;
  post_id: string;
  subscription_id: string;
  send_month: string;
  attempts: number;
  email: string;
  title: string;
  slug: string;
  access: 'free' | 'paid';
  html_full: string;
  html_preview: string;
  subdomain: string;
  status: string;
  post_status: string;
  sending_status: string;
  suppressed: boolean;
}
export interface SendResult {
  key: DeliveryKey;
  status: 'sent' | 'failed' | 'pending' | 'skipped';
  messageId?: string;
  error?: string;
  sendAt?: Date;
}
const keyOf = (row: {
  publication_id: string;
  post_id: string;
  subscription_id: string;
  send_month: string;
  correlation_id?: string | null;
}): DeliveryKey => ({
  publicationId: row.publication_id,
  postId: row.post_id,
  subscriptionId: row.subscription_id,
  sendMonth: row.send_month,
  ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
});
const dbKey = (key: DeliveryKey) => ({
  publication_id: key.publicationId,
  post_id: key.postId,
  subscription_id: key.subscriptionId,
  send_month: key.sendMonth,
});

export function createDeliveryRepository(pool: Pool) {
  return {
    async cardKeys(publicationId: string, postId: string): Promise<string[]> {
      const result = await pool.query<{ storage_key: string }>(
        'SELECT storage_key FROM quote_cards WHERE publication_id=$1 AND post_id=$2',
        [publicationId, postId],
      );
      return result.rows.map((row) => row.storage_key);
    },
    async deleteCards(publicationId: string, postId: string): Promise<void> {
      await pool.query('DELETE FROM quote_cards WHERE publication_id=$1 AND post_id=$2', [publicationId, postId]);
    },
    async recordMilestones(publicationId: string): Promise<Array<{ threshold: number; email: string; publicationName: string }>> {
      const result = await pool.query<{ threshold: number; email: string; publication_name: string }>(
        `WITH inserted AS (
           INSERT INTO milestones(publication_id,kind,threshold)
           SELECT p.id,'subscribers',t.threshold
           FROM publications p CROSS JOIN (VALUES (10),(100),(1000)) AS t(threshold)
           WHERE p.id=$1 AND p.subscriber_count>=t.threshold
           ON CONFLICT DO NOTHING RETURNING publication_id,threshold
         ) SELECT i.threshold,u.email,p.name AS publication_name
         FROM inserted i JOIN publications p ON p.id=i.publication_id JOIN users u ON u.id=p.owner_id
         ORDER BY i.threshold`,
        [publicationId],
      );
      return result.rows.map((row) => ({ threshold: row.threshold, email: row.email, publicationName: row.publication_name }));
    },
    async trackedLinks(keys: DeliveryKey[]): Promise<Array<{ id: string; publication_id: string; post_id: string; target_url: string }>> {
      const result = await pool.query<{ id: string; publication_id: string; post_id: string; target_url: string }>('SELECT id,publication_id,post_id,target_url FROM tracked_links WHERE publication_id=ANY($1::uuid[]) AND post_id=ANY($2::uuid[])', [[...new Set(keys.map((key) => key.publicationId))], [...new Set(keys.map((key) => key.postId))]]);
      return result.rows;
    },
    async relay(send: (event: EventMessage) => Promise<void>): Promise<number> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<{ id: number; event_type: string; payload: unknown }>(
          'SELECT id,event_type,payload FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED',
        );
        for (const row of result.rows) {
          if (
            row.event_type !== 'PostPublished' &&
            row.event_type !== 'SubscriptionConfirmationRequested' &&
            row.event_type !== 'SubscriptionConfirmed' &&
            row.event_type !== 'PostUnpublished'
          )
            throw new Error(`Unknown outbox type ${row.event_type}`);
          if (typeof row.payload !== 'object' || row.payload === null)
            throw new Error('Invalid outbox payload');
          const payload = row.payload;
          const correlationId =
            'correlationId' in payload && typeof payload.correlationId === 'string'
              ? payload.correlationId
              : String(row.id);
          const event = {
            ...payload,
            type: row.event_type,
            eventId: Number(row.id),
            correlationId,
          };
          await send(eventMessage.parse(event));
          await client.query('UPDATE outbox_events SET published_at=now() WHERE id=$1', [row.id]);
        }
        await client.query('COMMIT');
        return result.rowCount ?? 0;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async confirmation(
      publicationId: string,
      subscriptionId: string,
      exp: number,
    ): Promise<{ email: string; subdomain: string } | null> {
      const result = await pool.query<{ email: string; subdomain: string }>(
        `UPDATE subscriptions s SET confirmation_dispatched_at=now(),updated_at=now()
         FROM publications p WHERE s.publication_id=$1 AND s.id=$2 AND p.id=s.publication_id
           AND s.status='pending' AND s.confirmation_dispatched_at IS NULL
           AND s.confirmation_expires_at=to_timestamp($3) AND s.confirmation_expires_at>now()
         RETURNING s.email,p.subdomain`,
        [publicationId, subscriptionId, exp],
      );
      return result.rows[0] ?? null;
    },
    async fanout(input: {
      publicationId: string;
      postId: string;
      afterId: string | null;
      scheduledFor: string | null;
      sendImmediately: boolean;
      correlationId?: string;
    }): Promise<string | null> {
      const client = await pool.connect();
      try {
        const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
        const now = nowResult.rows[0]?.now;
        if (!now) throw new Error('Database clock unavailable');
        const post = await client.query<{ status: string; delivery_month: string | null }>(
          "SELECT status,to_char(delivery_month,'YYYY-MM-DD') AS delivery_month FROM posts WHERE publication_id=$1 AND id=$2",
          [input.publicationId, input.postId],
        );
        if (!post.rows[0] || !['published', 'scheduled'].includes(post.rows[0].status)) return null;
        const sendMonth = post.rows[0].delivery_month;
        if (!sendMonth) throw new Error('Published post has no delivery month');
        const page = await client.query<Subscriber>(
          `SELECT s.id,s.slot,s.timezone FROM subscriptions s
           WHERE s.publication_id=$1 AND s.status='active' AND ($2::uuid IS NULL OR s.id>$2::uuid)
             AND NOT EXISTS (SELECT 1 FROM suppressions x WHERE x.publication_id=s.publication_id AND x.email=s.email)
           ORDER BY s.id LIMIT 1000`,
          [input.publicationId, input.afterId],
        );
        if (page.rows.length === 0) return null;
        const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
        const rows = page.rows.map((subscriber) => {
          const sendAt = computeSendAt(
            now,
            scheduledFor,
            subscriber.slot,
            subscriber.timezone,
            input.sendImmediately,
          );
          return {
            subscription_id: subscriber.id,
            send_at: sendAt.toISOString(),
            send_month: sendMonth,
          };
        });
        await client.query(
          `INSERT INTO post_deliveries(post_id,subscription_id,send_month,publication_id,send_at,send_immediately,correlation_id,status,updated_at)
           SELECT $1::uuid,x.subscription_id,x.send_month,$2::uuid,x.send_at,$4::boolean,$5::text,'pending',now()
           FROM jsonb_to_recordset($3::jsonb) AS x(subscription_id uuid,send_at timestamptz,send_month date)
           ON CONFLICT DO NOTHING`,
          [
            input.postId,
            input.publicationId,
            JSON.stringify(rows),
            input.sendImmediately,
            input.correlationId ?? null,
          ],
        );
        return page.rows.length === 1000 ? (page.rows.at(-1)?.id ?? null) : null;
      } finally {
        client.release();
      }
    },
    async releaseScheduled(): Promise<number> {
      const result = await pool.query<{ count: number }>(
        `WITH released AS (
           UPDATE posts SET status='published',published_at=now(),updated_at=now()
           WHERE status='scheduled' AND scheduled_for<=now() RETURNING publication_id
         ), affected AS (SELECT DISTINCT publication_id FROM released),
         streak AS (
           INSERT INTO writing_streaks(publication_id,current_weeks,longest_weeks,last_post_week)
           SELECT publication_id,1,1,date_trunc('week',now() AT TIME ZONE 'Asia/Kolkata')::date FROM affected
           ON CONFLICT(publication_id) DO UPDATE SET
             current_weeks=CASE WHEN writing_streaks.last_post_week=EXCLUDED.last_post_week THEN writing_streaks.current_weeks
               WHEN writing_streaks.last_post_week=EXCLUDED.last_post_week-7 THEN writing_streaks.current_weeks+1 ELSE 1 END,
             longest_weeks=GREATEST(writing_streaks.longest_weeks,CASE WHEN writing_streaks.last_post_week=EXCLUDED.last_post_week-7 THEN writing_streaks.current_weeks+1 ELSE 1 END),
             last_post_week=EXCLUDED.last_post_week RETURNING publication_id
         ) SELECT count(*)::integer AS count FROM released`,
      );
      return result.rows[0]?.count ?? 0;
    },
    async queueDue(): Promise<DeliveryKey[]> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cursor = await client.query<{ after_publication_id: string | null }>(
          "SELECT after_publication_id FROM scheduler_state WHERE name='delivery' FOR UPDATE",
        );
        const afterId = cursor.rows[0]?.after_publication_id ?? null;
        const publications = await client.query<{ id: string; daily_send_limit: number }>(
          `SELECT p.id,p.daily_send_limit FROM publications p
           WHERE p.sending_status='active' AND EXISTS (
             SELECT 1 FROM post_deliveries d JOIN posts post ON post.id=d.post_id AND post.publication_id=d.publication_id
             WHERE d.publication_id=p.id AND d.status='pending' AND d.send_at<=now() AND post.status='published'
           )
           ORDER BY CASE WHEN $1::uuid IS NULL OR p.id>$1::uuid THEN 0 ELSE 1 END,p.id
           LIMIT 20 FOR UPDATE OF p SKIP LOCKED`,
          [afterId],
        );
        const pubIds = publications.rows.map((row) => row.id);
        if (pubIds.length === 0) {
          await client.query('COMMIT');
          return [];
        }
        const last = pubIds.at(-1);
        await client.query(
          "UPDATE scheduler_state SET after_publication_id=$1,updated_at=now() WHERE name='delivery'",
          [last],
        );
        const used = await client.query<{ publication_id: string; count: number }>(
          `SELECT publication_id,count(*)::integer AS count FROM post_deliveries
           WHERE publication_id=ANY($1::uuid[]) AND updated_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
             AND (status IN ('queued','sending','sent') OR (status='failed' AND last_error='unknown_outcome'))
           GROUP BY publication_id`,
          [pubIds],
        );
        const usedByPublication = new Map(used.rows.map((row) => [row.publication_id, row.count]));
        const selected = await client.query<ClaimRow>(
          `SELECT due.publication_id,due.post_id,due.subscription_id,to_char(due.send_month,'YYYY-MM-DD') AS send_month,due.correlation_id
           FROM unnest($1::uuid[]) AS candidate(id)
           JOIN LATERAL (
             SELECT d.publication_id,d.post_id,d.subscription_id,d.send_month,d.send_at,d.correlation_id
             FROM post_deliveries d JOIN posts post ON post.id=d.post_id AND post.publication_id=d.publication_id
             WHERE d.publication_id=candidate.id AND d.status='pending' AND d.send_at<=now() AND post.status='published'
             ORDER BY d.send_at LIMIT 100 FOR UPDATE OF d SKIP LOCKED
           ) due ON true ORDER BY due.publication_id,due.send_at`,
          [pubIds],
        );
        const counts = new Map<string, number>();
        const limits = new Map(publications.rows.map((row) => [row.id, row.daily_send_limit]));
        const keys: DeliveryKey[] = [];
        for (const row of selected.rows) {
          const count = counts.get(row.publication_id) ?? 0;
          const remaining =
            (limits.get(row.publication_id) ?? 0) -
            (usedByPublication.get(row.publication_id) ?? 0);
          if (count >= Math.min(100, remaining)) continue;
          counts.set(row.publication_id, count + 1);
          keys.push(keyOf(row));
        }
        if (keys.length)
          await client.query(
            `UPDATE post_deliveries d SET status='queued',updated_at=now()
           FROM jsonb_to_recordset($1::jsonb) AS x(publication_id uuid,post_id uuid,subscription_id uuid,send_month date)
           WHERE d.publication_id=x.publication_id AND d.post_id=x.post_id AND d.subscription_id=x.subscription_id AND d.send_month=x.send_month AND d.status='pending'`,
            [JSON.stringify(keys.map(dbKey))],
          );
        await client.query('COMMIT');
        return keys;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async claim(keys: DeliveryKey[]): Promise<ClaimRow[]> {
      const result = await pool.query<ClaimRow>(
        `WITH claimed AS (
           UPDATE post_deliveries d SET status='sending',attempts=attempts+1,updated_at=now()
           FROM jsonb_to_recordset($1::jsonb) AS x(publication_id uuid,post_id uuid,subscription_id uuid,send_month date)
           WHERE d.publication_id=x.publication_id AND d.post_id=x.post_id AND d.subscription_id=x.subscription_id AND d.send_month=x.send_month AND d.status='queued'
           RETURNING d.publication_id,d.post_id,d.subscription_id,d.send_month,d.attempts
         ) SELECT c.publication_id,c.post_id,c.subscription_id,to_char(c.send_month,'YYYY-MM-DD') AS send_month,c.attempts,s.email,s.status,p.sending_status,p.subdomain,post.status AS post_status,post.title,post.slug,post.access,pc.html_full,pc.html_preview,
           EXISTS(SELECT 1 FROM suppressions x WHERE x.publication_id=c.publication_id AND x.email=s.email) AS suppressed
           FROM claimed c JOIN subscriptions s ON s.id=c.subscription_id AND s.publication_id=c.publication_id
           JOIN publications p ON p.id=c.publication_id
           JOIN posts post ON post.id=c.post_id AND post.publication_id=c.publication_id
           JOIN post_contents pc ON pc.post_id=c.post_id AND pc.publication_id=c.publication_id`,
        [JSON.stringify(keys.map(dbKey))],
      );
      return result.rows;
    },
    async record(results: SendResult[]): Promise<void> {
      if (!results.length) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE post_deliveries d SET status=x.status,provider_message_id=x.message_id,last_error=x.error,
         send_at=COALESCE(x.send_at,d.send_at),sent_at=CASE WHEN x.status='sent' THEN now() ELSE d.sent_at END,updated_at=now()
         FROM jsonb_to_recordset($1::jsonb) AS x(publication_id uuid,post_id uuid,subscription_id uuid,send_month date,status text,message_id text,error text,send_at timestamptz)
         WHERE d.publication_id=x.publication_id AND d.post_id=x.post_id AND d.subscription_id=x.subscription_id AND d.send_month=x.send_month AND d.status='sending'`,
          [
            JSON.stringify(
              results.map((r) => ({
                ...dbKey(r.key),
                status: r.status,
                message_id: r.messageId ?? null,
                error: r.error ?? null,
                send_at: r.sendAt?.toISOString() ?? null,
              })),
            ),
          ],
        );
        const permanent = results.filter((result) => result.error === 'permanent_rejection');
        if (permanent.length)
          await client.query(
            `INSERT INTO suppressions(publication_id,email,reason)
         SELECT d.publication_id,s.email,'permanent_rejection'
         FROM jsonb_to_recordset($1::jsonb) AS x(publication_id uuid,post_id uuid,subscription_id uuid,send_month date)
         JOIN post_deliveries d ON d.publication_id=x.publication_id AND d.post_id=x.post_id AND d.subscription_id=x.subscription_id AND d.send_month=x.send_month
         JOIN subscriptions s ON s.publication_id=d.publication_id AND s.id=d.subscription_id
         ON CONFLICT(publication_id,email) DO NOTHING`,
            [JSON.stringify(permanent.map((r) => dbKey(r.key)))],
          );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async sweep(): Promise<{ unknown: number; requeued: number; outboxPurged: number }> {
      const unknown = await pool.query(
        `WITH stale AS (
           SELECT publication_id,post_id,subscription_id,send_month FROM post_deliveries
           WHERE status='sending' AND updated_at<now()-interval '10 minutes'
           ORDER BY updated_at LIMIT 1000 FOR UPDATE SKIP LOCKED
         ) UPDATE post_deliveries d SET status='failed',last_error='unknown_outcome',updated_at=now()
           FROM stale s WHERE d.publication_id=s.publication_id AND d.post_id=s.post_id AND d.subscription_id=s.subscription_id AND d.send_month=s.send_month AND d.status='sending'`,
      );
      const requeued = await pool.query(
        `WITH stale AS (
           SELECT publication_id,post_id,subscription_id,send_month FROM post_deliveries
           WHERE status='queued' AND updated_at<now()-interval '30 minutes' AND send_at<now()-interval '30 minutes'
           ORDER BY updated_at LIMIT 1000 FOR UPDATE SKIP LOCKED
         ) UPDATE post_deliveries d SET status='pending',updated_at=now()
           FROM stale s WHERE d.publication_id=s.publication_id AND d.post_id=s.post_id AND d.subscription_id=s.subscription_id AND d.send_month=s.send_month AND d.status='queued'`,
      );
      const outbox = await pool.query(
        "DELETE FROM outbox_events WHERE id IN (SELECT id FROM outbox_events WHERE published_at<now()-interval '7 days' ORDER BY id LIMIT 1000)",
      );
      return {
        unknown: unknown.rowCount ?? 0,
        requeued: requeued.rowCount ?? 0,
        outboxPurged: outbox.rowCount ?? 0,
      };
    },
  };
}
export type DeliveryRepository = ReturnType<typeof createDeliveryRepository>;
export type ClaimedDelivery = ClaimRow;
