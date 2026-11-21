import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createDatabaseClients, runMigrations, ensurePostDeliveriesPartitions } from '@vichaar/db';
import { createSqsQueues } from '../../../packages/queue/src/index.js';
import { createDeliveryRepository } from '../../workers/src/delivery-repository.js';
import { createPipeline } from '../../workers/src/pipeline.js';
import { EmailRejectedError } from '../../workers/src/provider.js';
import { createContainer, type AppContainer } from '../src/container.js';
import { createServer } from '../src/server.js';
import { createRateLimiter } from '../src/shared/rate-limiter.js';

const baseUrl =
  process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
const databaseName = `vichaar_phase2_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${databaseName}`;
const administrator = createDatabaseClients({ primaryUrl: baseUrl, maxConnections: 1 });
const queues = createSqsQueues({
  endpoint: 'http://localhost:9324',
  baseUrl: 'http://localhost:9324/queue',
  region: 'us-east-1',
  eventsName: `phase2-events-${databaseName.slice(-12)}`,
  sendsName: `phase2-sends-${databaseName.slice(-12)}`,
  hooksName: `phase2-hooks-${databaseName.slice(-12)}`,
});
const limiter = createRateLimiter(process.env.REDIS_URL ?? 'redis://localhost:6379');
let container: AppContainer;
const emails: { to: string; subject: string; html: string }[] = [];
let retryAttempts = 0;

beforeAll(async () => {
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
  await administrator.primaryPool.query(`CREATE DATABASE ${databaseName}`);
  await runMigrations(testUrl.toString());
  await queues.createLocalQueues();
  container = createContainer({ databaseUrl: testUrl.toString() });
}, 30000);
afterAll(async () => {
  if (container) await container.close();
  await limiter.close();
  await queues.deleteLocalQueues();
  queues.close();
  await administrator.primaryPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await administrator.close();
}, 30000);

describe('Phase 2 pipeline with real Postgres, Redis, and ElasticMQ', () => {
  it('relays confirmation and publish events, sends once, and honors unsubscribe', async () => {
    const suffix = randomUUID().slice(0, 8);
    const app = createServer(container);
    const repo = createDeliveryRepository(container.db!.primaryPool);
    const pipeline = createPipeline({
      repo,
      events: queues.events,
      sends: queues.sends,
      rateLimiter: limiter,
      provider: {
        async send(message) {
          if (message.subject === 'Retry Post' && retryAttempts++ === 0)
            throw new EmailRejectedError(true);
          if (message.subject === 'Rejected Post') throw new EmailRejectedError(false);
          emails.push({ to: message.to, subject: message.subject, html: message.html });
          return `stub-${emails.length}`;
        },
        async close() {},
      },
      tokenSecret: process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!',
      baseUrl: 'http://localhost:4000',
      fromAddress: 'newsletter@vichaar.test',
    });
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: `owner-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Owner',
      });
    expect(signup.status).toBe(201);
    const cookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const pub = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'Pipeline', subdomain: `pipeline-${suffix}` });
    expect(pub.status).toBe(201);
    const subscription = await request(app)
      .post(`/public/pipeline-${suffix}/subscribe`)
      .send({ email: `reader-${suffix}@example.test`, slot: 'morning', timezone: 'Asia/Kolkata' });
    expect(subscription.status).toBe(202);
    expect(await pipeline.relay()).toBe(1);
    expect(await pipeline.fanoutOnce()).toBe(1);
    expect(emails).toHaveLength(1);
    const token = emails[0]?.html.match(/subscribe-demo\?token=([^"<]+)/)?.[1];
    expect(token).toBeDefined();
    expect((await request(app).post('/subscriptions/confirm').send({ token })).status).toBe(204);
    const draft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'Pipeline Post', body: '<p>Hello</p>' });
    expect(draft.status).toBe(201);
    const published = await request(app)
      .post(`/publications/${pub.body.id}/posts/${draft.body.id}/publish`)
      .set('Cookie', cookie)
      .send({ sendImmediately: true });
    expect(published.status).toBe(202);
    expect(await pipeline.relay()).toBe(2);
    expect(await pipeline.fanoutOnce()).toBe(2);
    expect(await pipeline.scheduleOnce()).toBe(1);
    expect(await pipeline.sendOnce()).toBe(1);
    expect(emails).toHaveLength(2);
    expect(emails[1]?.html).toContain('<p>Hello</p>');
    const keys = await container.db!.primaryPool.query<{
      status: string;
      subscription_id: string;
      correlation_id: string;
    }>(
      'SELECT status,subscription_id,correlation_id FROM post_deliveries WHERE publication_id=$1 AND post_id=$2',
      [pub.body.id, draft.body.id],
    );
    expect(keys.rows[0]?.status).toBe('sent');
    expect(keys.rows[0]?.correlation_id).toBe(published.headers['x-correlation-id']);
    const duplicate = await container.db!.primaryPool.query<{ send_month: string }>(
      "SELECT to_char(send_month,'YYYY-MM-DD') AS send_month FROM post_deliveries WHERE publication_id=$1 AND post_id=$2",
      [pub.body.id, draft.body.id],
    );
    await queues.sends.send({
      type: 'SendBatch',
      keys: [
        {
          publicationId: pub.body.id,
          postId: draft.body.id,
          subscriptionId: keys.rows[0]!.subscription_id,
          sendMonth: duplicate.rows[0]!.send_month,
        },
      ],
      correlationId: draft.body.id,
    });
    await pipeline.sendOnce();
    expect(emails).toHaveLength(2);
    const paidDraft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({
        title: 'Paid Post',
        isPaid: true,
        body: '<p>Public preview</p><p>Private paid body</p>',
      });
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${paidDraft.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: true })
      ).status,
    ).toBe(202);
    await pipeline.relay();
    await pipeline.fanoutOnce();
    await pipeline.scheduleOnce();
    await pipeline.sendOnce();
    expect(emails[2]?.html).toContain('Public preview');
    expect(emails[2]?.html).not.toContain('Private paid body');
    const retryDraft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'Retry Post', body: '<p>Retry</p>' });
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${retryDraft.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: true })
      ).status,
    ).toBe(202);
    await pipeline.relay();
    await pipeline.fanoutOnce();
    await pipeline.scheduleOnce();
    await pipeline.sendOnce();
    const retryState = await container.db!.primaryPool.query<{ status: string; attempts: number }>(
      'SELECT status,attempts FROM post_deliveries WHERE publication_id=$1 AND post_id=$2',
      [pub.body.id, retryDraft.body.id],
    );
    expect(retryState.rows[0]).toMatchObject({ status: 'pending', attempts: 1 });
    await container.db!.primaryPool.query(
      "UPDATE post_deliveries SET send_at=now()-interval '1 second' WHERE publication_id=$1 AND post_id=$2",
      [pub.body.id, retryDraft.body.id],
    );
    await pipeline.scheduleOnce();
    await pipeline.sendOnce();
    const acceptedRetry = await container.db!.primaryPool.query<{
      status: string;
      attempts: number;
    }>('SELECT status,attempts FROM post_deliveries WHERE publication_id=$1 AND post_id=$2', [
      pub.body.id,
      retryDraft.body.id,
    ]);
    expect(acceptedRetry.rows[0]).toMatchObject({ status: 'sent', attempts: 2 });
    expect(emails).toHaveLength(4);
    const rejectDraft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'Rejected Post', body: '<p>Reject</p>' });
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${rejectDraft.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: true })
      ).status,
    ).toBe(202);
    await pipeline.relay();
    await pipeline.fanoutOnce();
    await pipeline.scheduleOnce();
    await pipeline.sendOnce();
    const rejected = await container.db!.primaryPool.query<{ status: string; last_error: string }>(
      'SELECT status,last_error FROM post_deliveries WHERE publication_id=$1 AND post_id=$2',
      [pub.body.id, rejectDraft.body.id],
    );
    expect(rejected.rows[0]).toMatchObject({ status: 'failed', last_error: 'permanent_rejection' });
    const unsubToken = emails[1]?.html.match(/unsubscribe\/([^"<]+)/)?.[1];
    expect(unsubToken).toBeDefined();
    expect((await request(app).post(`/unsubscribe/${unsubToken}`)).status).toBe(204);
    const suppression = await container.db!.primaryPool.query(
      'SELECT 1 FROM suppressions WHERE publication_id=$1',
      [pub.body.id],
    );
    expect(suppression.rowCount).toBe(1);
    const futureMonth = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 3, 1),
    );
    const suffixMonth = `${futureMonth.getUTCFullYear()}_${String(futureMonth.getUTCMonth() + 1).padStart(2, '0')}`;
    const futurePartition = `post_deliveries_${suffixMonth}`;
    const futureDate = futureMonth.toISOString().slice(0, 10);
    await container.db!.primaryPool.query(`DROP TABLE ${futurePartition}`);
    await container.db!.primaryPool.query(
      "INSERT INTO post_deliveries(post_id,subscription_id,send_month,publication_id,send_at,status) VALUES($1,$2,$3::date,$4,$3::date::timestamptz,'skipped')",
      [draft.body.id, keys.rows[0]!.subscription_id, futureDate, pub.body.id],
    );
    const fallback = await container.db!.primaryPool.query<{ partition: string }>(
      'SELECT tableoid::regclass::text AS partition FROM post_deliveries WHERE publication_id=$1 AND post_id=$2 AND send_month=$3',
      [pub.body.id, draft.body.id, futureDate],
    );
    expect(fallback.rows[0]?.partition).toBe('post_deliveries_default');
    await ensurePostDeliveriesPartitions(container.db!.primaryPool);
    const moved = await container.db!.primaryPool.query<{ partition: string }>(
      'SELECT tableoid::regclass::text AS partition FROM post_deliveries WHERE publication_id=$1 AND post_id=$2 AND send_month=$3',
      [pub.body.id, draft.body.id, futureDate],
    );
    expect(moved.rows[0]?.partition).toBe(futurePartition);
  }, 30000);
});
