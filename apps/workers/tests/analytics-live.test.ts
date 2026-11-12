import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqsQueues } from '@vichaar/queue';
import { createAnalyticsPipeline } from '../src/analytics.js';

const suffix = randomUUID().slice(0, 8);
const queues = createSqsQueues({
  endpoint: 'http://localhost:9324',
  baseUrl: 'http://localhost:9324/queue',
  region: 'us-east-1',
  eventsName: `phase5-events-${suffix}`,
  sendsName: `phase5-sends-${suffix}`,
  hooksName: `phase5-hooks-${suffix}`,
  tracksName: `phase5-tracks-${suffix}`,
});
const analytics = createAnalyticsPipeline({
  tracks: queues.tracks,
  clickhouseUrl: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  database: 'vichaar',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'vichaar',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'vichaar_local',
});
const publicationId = randomUUID();
const postId = randomUUID();
const eventId = randomUUID();
describe.skipIf(!process.env.CLICKHOUSE_TEST_URL)('Phase 5 ClickHouse analytics', () => {
  beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID ??= 'test';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
    await queues.createLocalQueues();
    await analytics.initialize();
  });
  afterAll(async () => {
    await queues.deleteLocalQueues();
    queues.close();
  });
  it('stores one count when a batch is replayed and excludes prefetch', async () => {
    const event = {
      eventId,
      publicationId,
      postId,
      subscriptionId: randomUUID(),
      linkId: null,
      eventType: 'open' as const,
      isPrefetch: false,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
    };
    await queues.tracks.send({
      type: 'TrackBatch',
      events: [event, { ...event, eventId: randomUUID(), isPrefetch: true }],
    });
    expect(await analytics.consumeOnce()).toBe(2);
    await queues.tracks.send({ type: 'TrackBatch', events: [event] });
    expect(await analytics.consumeOnce()).toBe(1);
    const stats = await analytics.stats(publicationId);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.events).toBe(1);
  });
});
