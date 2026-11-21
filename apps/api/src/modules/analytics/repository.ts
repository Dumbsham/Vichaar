import { z } from 'zod';
import { analyticsStat } from './schemas.js';
import { withExternalSpan } from '@vichaar/api/tracing';

export function createAnalyticsRepository(
  url: string,
  database: string,
  user?: string,
  password?: string,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Invalid ClickHouse database');
  return {
    async list(publicationId: string) {
      const id = z.string().uuid().parse(publicationId);
      const endpoint = new URL(url);
      endpoint.searchParams.set(
        'query',
        `SELECT post_id, toString(day) AS day, event_type, toUInt64(uniqExactMerge(event_ids)) AS events FROM ${database}.email_event_rollups WHERE publication_id='${id}' GROUP BY post_id,day,event_type ORDER BY day DESC LIMIT 1000 FORMAT JSONEachRow`,
      );
      const credentials =
        user && password
          ? { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
          : undefined;
      const response = await withExternalSpan('clickhouse.analytics.query', () => fetcher(endpoint, {
        method: 'POST',
        headers: credentials,
        signal: AbortSignal.timeout(5000),
      }));
      if (!response.ok) throw new Error('Analytics unavailable');
      const text = await response.text();
      return text.trim()
        ? text
            .trim()
            .split('\n')
            .map((line) => analyticsStat.parse(JSON.parse(line)))
        : [];
    },
  };
}
