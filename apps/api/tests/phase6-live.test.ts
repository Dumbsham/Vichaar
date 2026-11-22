import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClients, runMigrations } from '@vichaar/db';
import { createSqsQueues } from '../../../packages/queue/src/index.js';
import { createDeliveryRepository } from '../../workers/src/delivery-repository.js';
import { createPipeline } from '../../workers/src/pipeline.js';
import { createContainer, type AppContainer } from '../src/container.js';
import { createServer } from '../src/server.js';
import { createRateLimiter } from '../src/shared/rate-limiter.js';
import {
  createLocalQuoteCardStorage,
  createQuoteRenderer,
} from '../src/modules/quote-cards/index.js';
import { createPostRepository } from '../src/modules/posts/index.js';

const baseUrl =
  process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
const databaseName = `vichaar_phase6_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${databaseName}`;
const admin = createDatabaseClients({ primaryUrl: baseUrl, maxConnections: 1 });
const queues = createSqsQueues({
  endpoint: 'http://localhost:9324',
  baseUrl: 'http://localhost:9324/queue',
  region: 'us-east-1',
  eventsName: `phase6-events-${databaseName.slice(-12)}`,
  sendsName: `phase6-sends-${databaseName.slice(-12)}`,
  hooksName: `phase6-hooks-${databaseName.slice(-12)}`,
});
const limiter = createRateLimiter(process.env.REDIS_URL ?? 'redis://localhost:6379');
const sent: Array<{ to: string; subject: string; html: string }> = [];
let container: AppContainer;
let tempDir: string;

beforeAll(async () => {
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
  tempDir = await mkdtemp(join(tmpdir(), 'vichaar-cards-'));
  process.env.QUOTE_CARD_DIR = tempDir;
  await admin.primaryPool.query(`CREATE DATABASE ${databaseName}`);
  await runMigrations(testUrl.toString());
  await queues.createLocalQueues();
  container = createContainer({
    databaseUrl: testUrl.toString(),
    rateLimitNamespace: databaseName,
  });
}, 30000);
afterAll(async () => {
  if (container) await container.close();
  await limiter.close();
  await queues.deleteLocalQueues();
  queues.close();
  await admin.primaryPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  delete process.env.QUOTE_CARD_DIR;
}, 30000);

describe('Phase 6 with real Postgres, Redis, and ElasticMQ', () => {
  it('renders allowed Hindi text, denies unavailable quotes, and caches the card', async () => {
    const app = createServer(container);
    const suffix = randomUUID().slice(0, 8);
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: `writer-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Writer',
      });
    const cookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const pub = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'Hindi Writing', subdomain: `hindi-${suffix}`, language: 'hi' });
    expect(pub.status).toBe(201);
    const draft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'नया लेख', body: '<p>नमस्ते दुनिया यहाँ है।</p>', language: 'hi' });
    expect(draft.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${draft.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: false })
      ).status,
    ).toBe(202);
    const cardPath = `/public/hindi-${suffix}/posts/${draft.body.slug}/quote-cards`;
    const invalid = await request(app).post(cardPath).send({ quote: 'गुप्त सामग्री' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('QUOTE_NOT_IN_POST');
    const made = await request(app).post(cardPath).send({ quote: 'नमस्ते   दुनिया यहाँ है।' });
    expect(made.status).toBe(201);
    const png = await request(app).get(made.body.url);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toMatch(/image\/png/);
    expect(png.body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const cached = await request(app).post(cardPath).send({ quote: 'नमस्ते दुनिया यहाँ है।' });
    expect(cached.status).toBe(200);
    expect(cached.body.url).toBe(made.body.url);
    const paid = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({
        title: 'सदस्य लेख',
        body: '<p>सारांश यहाँ है।</p><p>गुप्त अनुच्छेद यहाँ है।</p>',
        language: 'hi',
        isPaid: true,
      });
    expect(paid.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${paid.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: false })
      ).status,
    ).toBe(202);
    const paidPath = `/public/hindi-${suffix}/posts/${paid.body.slug}/quote-cards`;
    const hidden = await request(app).post(paidPath).send({ quote: 'गुप्त अनुच्छेद यहाँ है।' });
    expect(hidden.status).toBe(422);
    expect(hidden.body.error.code).toBe('QUOTE_NOT_IN_POST');
    expect((await request(app).post(paidPath).send({ quote: 'सारांश यहाँ है।' })).status).toBe(201);
    const streak = await request(app)
      .get(`/publications/${pub.body.id}/milestones`)
      .set('Cookie', cookie);
    expect(streak.status).toBe(200);
    expect(streak.body.streak.currentWeeks).toBe(1);
    expect(streak.body.milestones).toEqual([]);
    const postRepo = createPostRepository({
      pool: container.db!.primaryPool,
      readPool: container.db!.primaryPool,
    });
    const nextWeek = (offset: number) =>
      new Date(Date.parse(`${streak.body.streak.lastPostWeek}T00:00:00.000Z`) + offset * 86400000)
        .toISOString()
        .slice(0, 10);
    for (const [week, expectedCurrent, expectedLongest] of [
      [nextWeek(7), 2, 2],
      [nextWeek(21), 1, 2],
    ] as const) {
      const extra = await request(app)
        .post(`/publications/${pub.body.id}/posts`)
        .set('Cookie', cookie)
        .send({ title: `Streak ${week}`, body: '<p>Streak</p>' });
      expect(extra.status).toBe(201);
      const result = await postRepo.publish({
        publicationId: pub.body.id,
        postId: extra.body.id,
        expectedVersion: 1,
        htmlFull: '<p>Streak</p>',
        htmlPreview: '<p>Streak</p>',
        links: [],
        sendImmediately: false,
        scheduledFor: null,
        now: new Date(`${week}T12:00:00.000Z`),
        weekStart: week,
        correlationId: randomUUID(),
      });
      expect(result?.published).toBe(true);
      const row = await container.db!.primaryPool.query<{
        current_weeks: number;
        longest_weeks: number;
      }>('SELECT current_weeks,longest_weeks FROM writing_streaks WHERE publication_id=$1', [
        pub.body.id,
      ]);
      expect(row.rows[0]).toMatchObject({
        current_weeks: expectedCurrent,
        longest_weeks: expectedLongest,
      });
    }
    const other = await request(app)
      .post('/auth/signup')
      .send({
        email: `other-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Other',
      });
    const otherCookie = Array.isArray(other.headers['set-cookie'])
      ? other.headers['set-cookie'][0]
      : other.headers['set-cookie'];
    expect(
      (await request(app).get(`/publications/${pub.body.id}/milestones`).set('Cookie', otherCookie))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${draft.body.id}/unpublish`)
          .set('Cookie', cookie)
      ).status,
    ).toBe(200);
    expect((await request(app).get(made.body.url)).status).toBe(404);
    const cleanup = createPipeline({
      repo: createDeliveryRepository(container.db!.primaryPool),
      events: queues.events,
      sends: queues.sends,
      rateLimiter: limiter,
      cardStorage: createLocalQuoteCardStorage(tempDir),
      provider: {
        async send() {
          return 'stub';
        },
        async close() {},
      },
      tokenSecret: process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!',
      baseUrl: 'http://localhost:4000',
      fromAddress: 'newsletter@vichaar.test',
    });
    expect(await cleanup.relay()).toBe(5);
    expect(await cleanup.fanoutOnce()).toBe(5);
    const hash = made.body.url.match(/([0-9a-f]{64})\.png$/)?.[1];
    expect(hash).toBeDefined();
    expect(await createLocalQuoteCardStorage(tempDir).get(`cards/${hash}.png`)).toBeNull();
    const removed = await container.db!.primaryPool.query(
      'SELECT 1 FROM quote_cards WHERE publication_id=$1 AND post_id=$2',
      [pub.body.id, draft.body.id],
    );
    expect(removed.rowCount).toBe(0);
  });

  it('renders Tamil glyphs with its bundled font', async () => {
    const png = await createQuoteRenderer().render('வணக்கம் உலகம்', 'தமிழ் எழுத்து', 'ta');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('records a subscriber milestone once when confirmation events are replayed', async () => {
    const app = createServer(container);
    const suffix = randomUUID().slice(0, 8);
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: `owner-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Owner',
      });
    const cookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const pub = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'Milestone Test', subdomain: `milestone-${suffix}` });
    expect(pub.status).toBe(201);
    await container.db!.primaryPool.query(
      'UPDATE publications SET subscriber_count=9 WHERE id=$1',
      [pub.body.id],
    );
    const repo = createDeliveryRepository(container.db!.primaryPool);
    const pipeline = createPipeline({
      repo,
      events: queues.events,
      sends: queues.sends,
      rateLimiter: limiter,
      provider: {
        async send(message) {
          sent.push({ to: message.to, subject: message.subject, html: message.html });
          return `stub-${sent.length}`;
        },
        async close() {},
      },
      tokenSecret: process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!',
      baseUrl: 'http://localhost:4000',
      fromAddress: 'newsletter@vichaar.test',
    });
    expect(
      (
        await request(app)
          .post(`/public/milestone-${suffix}/subscribe`)
          .send({
            email: `reader-${suffix}@example.test`,
            slot: 'morning',
            timezone: 'Asia/Kolkata',
          })
      ).status,
    ).toBe(202);
    await pipeline.relay();
    await pipeline.fanoutOnce();
    const token = sent.at(-1)?.html.match(/\/confirm\?token=([^"<]+)/)?.[1];
    expect(token).toBeDefined();
    expect((await request(app).post('/subscriptions/confirm').send({ token })).status).toBe(204);
    expect((await request(app).post('/subscriptions/confirm').send({ token })).status).toBe(204);
    expect(await pipeline.relay()).toBe(1);
    expect(await pipeline.fanoutOnce()).toBe(1);
    const view = await request(app)
      .get(`/publications/${pub.body.id}/milestones`)
      .set('Cookie', cookie);
    expect(view.status).toBe(200);
    expect(view.body.milestones.map((row: { threshold: number }) => row.threshold)).toEqual([10]);
    expect(sent.filter((message) => message.subject.includes('10 subscribers'))).toHaveLength(1);
    const event = await container.db!.primaryPool.query<{
      id: number;
      payload: { subscriptionId: string; correlationId: string };
    }>(
      "SELECT id,payload FROM outbox_events WHERE event_type='SubscriptionConfirmed' AND payload->>'publicationId'=$1",
      [pub.body.id],
    );
    await queues.events.send({
      type: 'SubscriptionConfirmed',
      eventId: Number(event.rows[0]!.id),
      publicationId: pub.body.id,
      subscriptionId: event.rows[0]!.payload.subscriptionId,
      correlationId: event.rows[0]!.payload.correlationId,
    });
    await pipeline.fanoutOnce();
    expect(sent.filter((message) => message.subject.includes('10 subscribers'))).toHaveLength(1);
  });
});
