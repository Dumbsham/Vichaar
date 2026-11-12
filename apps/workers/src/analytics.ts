import { z } from 'zod';
import type { Queue, TrackEvent } from '@vichaar/queue';

type TrackQueue = Queue<{ type: 'TrackBatch'; events: TrackEvent[] }>;
const row = z.object({
  publication_id: z.string().uuid(),
  post_id: z.string().uuid(),
  day: z.string(),
  event_type: z.string(),
  events: z.coerce.number().int().nonnegative(),
});
export function createAnalyticsPipeline(config: {
  tracks: TrackQueue;
  clickhouseUrl: string;
  database: string;
  user?: string;
  password?: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = config.fetcher ?? fetch;
  const endpoint = new URL(config.clickhouseUrl);
  async function query(sql: string, body = '') {
    const url = new URL(endpoint);
    url.searchParams.set('query', sql);
    const credentials =
      config.user && config.password
        ? {
            Authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`,
          }
        : undefined;
    const response = await fetcher(url, {
      method: 'POST',
      body,
      headers: credentials,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`ClickHouse returned ${response.status}`);
    return response.text();
  }
  async function initialize() {
    await query(`CREATE DATABASE IF NOT EXISTS ${config.database}`);
    await query(
      `CREATE TABLE IF NOT EXISTS ${config.database}.email_events (event_id UUID, publication_id UUID, post_id UUID, subscription_id UUID, link_id Nullable(UUID), event_type LowCardinality(String), is_prefetch UInt8, occurred_at DateTime64(3, 'UTC')) ENGINE=ReplacingMergeTree() PARTITION BY toYYYYMM(occurred_at) ORDER BY (publication_id, post_id, event_type, event_id)`,
    );
    await query(
      `CREATE TABLE IF NOT EXISTS ${config.database}.email_event_rollups (publication_id UUID, post_id UUID, day Date, event_type LowCardinality(String), event_ids AggregateFunction(uniqExact, UUID)) ENGINE=AggregatingMergeTree() ORDER BY (publication_id, post_id, day, event_type)`,
    );
    await query(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${config.database}.email_event_rollups_mv TO ${config.database}.email_event_rollups AS SELECT publication_id, post_id, toDate(occurred_at) AS day, event_type, uniqExactState(event_id) AS event_ids FROM ${config.database}.email_events WHERE is_prefetch=0 GROUP BY publication_id, post_id, day, event_type`,
    );
  }
  return {
    initialize,
    async consumeOnce(): Promise<number> {
      const messages = await config.tracks.receive();
      if (messages.length === 0) return 0;
      const events = messages.flatMap((message) => message.body.events).slice(0, 1000);
      const lines = events
        .map((event) =>
          JSON.stringify({
            event_id: event.eventId,
            publication_id: event.publicationId,
            post_id: event.postId,
            subscription_id: event.subscriptionId,
            link_id: event.linkId,
            event_type: event.eventType,
            is_prefetch: event.isPrefetch ? 1 : 0,
            occurred_at: event.occurredAt.replace('T', ' ').replace('Z', ''),
          }),
        )
        .join('\n');
      await query(`INSERT INTO ${config.database}.email_events FORMAT JSONEachRow`, lines);
      for (const message of messages) await config.tracks.delete(message.receipt);
      return events.length;
    },
    async stats(publicationId: string) {
      const output = await query(
        `SELECT publication_id, post_id, toString(day) AS day, event_type, toUInt64(uniqExactMerge(event_ids)) AS events FROM ${config.database}.email_event_rollups WHERE publication_id = '${z.string().uuid().parse(publicationId)}' GROUP BY publication_id, post_id, day, event_type ORDER BY day DESC LIMIT 1000 FORMAT JSONEachRow`,
      );
      return output.trim()
        ? output
            .trim()
            .split('\n')
            .map((line) => row.parse(JSON.parse(line)))
        : [];
    },
  };
}
