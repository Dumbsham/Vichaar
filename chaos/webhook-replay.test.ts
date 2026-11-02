import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createClient } from 'redis';
import { createContainer } from '../apps/api/src/container.js';
import { createServer } from '../apps/api/src/server.js';
import {
  createBillingRepository,
  createBillingService,
  type BillingProvider,
  type ProviderSubscription,
} from '../apps/api/src/modules/billing/index.js';
import { createBillingPipeline } from '../apps/workers/src/billing.js';
import { confirmationToken } from '@vichaar/shared/subscription-tokens';
import { createSqsQueues } from '@vichaar/queue';
import { SystemClock } from '@vichaar/shared/clock';
import { createDatabaseClients, runMigrations } from '../packages/db/src/index.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
const databaseName = `vichaar_billing_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const testUrl = new URL(databaseUrl);
testUrl.pathname = `/${databaseName}`;
const administrator = createDatabaseClients({ primaryUrl: databaseUrl, maxConnections: 1 });
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const secret = 'phase4-webhook-test-secret';
const tokenSecret = process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!';
const snapshots = new Map<string, ProviderSubscription>();
let planCalls = 0;
let subscriptionCalls = 0;
const provider: BillingProvider = {
  async createPlan() {
    planCalls++;
    return `plan_${randomUUID().replaceAll('-', '')}`;
  },
  async createSubscription() {
    subscriptionCalls++;
    const snapshot: ProviderSubscription = {
      id: `sub_${randomUUID().replaceAll('-', '')}`,
      status: 'created',
      current_end: null,
    };
    snapshots.set(snapshot.id, snapshot);
    return snapshot;
  },
  async fetchSubscription(id) {
    const snapshot = snapshots.get(id);
    if (!snapshot) throw new Error('Stub subscription missing');
    return snapshot;
  },
  async cancelSubscription(id) {
    const snapshot = await this.fetchSubscription(id);
    return snapshot;
  },
};
let container: ReturnType<typeof createContainer>;
let app: ReturnType<typeof createServer>;
const queue = createSqsQueues({
  endpoint: 'http://localhost:9324',
  baseUrl: 'http://localhost:9324/queue',
  region: 'us-east-1',
  eventsName: `billing-events-${databaseName.slice(-12)}`,
  sendsName: `billing-sends-${databaseName.slice(-12)}`,
  hooksName: `billing-hooks-${databaseName.slice(-12)}`,
});
const redis = createClient({ url: redisUrl });
redis.on('error', () => {});
beforeAll(async () => {
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
  await administrator.primaryPool.query(`CREATE DATABASE ${databaseName}`);
  await runMigrations(testUrl.toString());
  await queue.createLocalQueues();
  container = createContainer({
    databaseUrl: testUrl.toString(),
    rateLimitNamespace: randomUUID(),
    billingProvider: provider,
    webhookSecret: secret,
    enqueueHook: async (id, correlationId) =>
      queue.hooks.send({ type: 'RazorpayWebhook', eventId: id, correlationId }),
  });
  app = createServer(container);
}, 30000);
afterAll(async () => {
  if (redis.isOpen) await redis.quit();
  if (container) await container.close();
  await queue.deleteLocalQueues();
  queue.close();
  await administrator.primaryPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await administrator.close();
}, 30000);

function cookie(response: request.Response): string {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? (header[0] ?? '') : (header ?? '');
}
async function sendWebhook(
  eventId: string,
  subscription: ProviderSubscription,
  createdAt: number,
  signatureSecret = secret,
) {
  const body = JSON.stringify({
    event: 'subscription.charged',
    created_at: createdAt,
    payload: { subscription: { entity: subscription } },
  });
  return request(app)
    .post('/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-event-id', eventId)
    .set('x-razorpay-signature', createHmac('sha256', signatureSecret).update(body).digest('hex'))
    .send(body);
}

describe('Phase 4 signed webhooks and paid access', () => {
  it('rejects forged events, deduplicates replay, ignores stale status, and repairs a lost event', async () => {
    const suffix = randomUUID().slice(0, 8);
    const writer = await request(app)
      .post('/auth/signup')
      .send({
        email: `writer-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Writer',
      });
    const readerEmail = `reader-${suffix}@example.test`;
    const reader = await request(app)
      .post('/auth/signup')
      .send({ email: readerEmail, password: 'strong-secret-123', name: 'Reader' });
    expect(writer.status).toBe(201);
    expect(reader.status).toBe(201);
    const ownerCookie = cookie(writer);
    const readerCookie = cookie(reader);
    const pub = await request(app)
      .post('/publications')
      .set('Cookie', ownerCookie)
      .send({ name: 'Paid Test', subdomain: `paid-${suffix}`, monthlyPricePaise: 49900 });
    const other = await request(app)
      .post('/publications')
      .set('Cookie', ownerCookie)
      .send({ name: 'Other Test', subdomain: `other-${suffix}`, monthlyPricePaise: 49900 });
    expect(pub.status).toBe(201);
    expect(other.status).toBe(201);
    const post = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', ownerCookie)
      .send({ title: 'Premium', body: '<p>Preview</p><p>Paid secret</p>', isPaid: true });
    expect(post.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${post.body.id}/publish`)
          .set('Cookie', ownerCookie)
          .send({ sendImmediately: true })
      ).status,
    ).toBe(202);
    await vi.waitFor(
      async () => {
        const result = await container.db!.replicaPool.query<{ status: string }>(
          'SELECT status FROM posts WHERE publication_id=$1 AND id=$2',
          [pub.body.id, post.body.id],
        );
        expect(result.rows[0]?.status).toBe('published');
      },
      { timeout: 5000 },
    );
    const fullPath = `/public/paid-${suffix}/posts/premium/full`;
    expect((await request(app).get(fullPath)).status).toBe(401);
    expect((await request(app).get(fullPath).set('Cookie', readerCookie)).status).toBe(403);
    expect(
      (await request(app).post(`/public/paid-${suffix}/checkout`).set('Cookie', readerCookie))
        .status,
    ).toBe(403);

    expect(
      (
        await request(app)
          .post(`/public/paid-${suffix}/subscribe`)
          .send({ email: readerEmail, slot: 'morning', timezone: 'Asia/Kolkata' })
      ).status,
    ).toBe(202);
    const pending = await container.db!.primaryPool.query<{ id: string; exp: number }>(
      'SELECT id,floor(extract(epoch FROM confirmation_expires_at))::integer AS exp FROM subscriptions WHERE publication_id=$1 AND email=$2',
      [pub.body.id, readerEmail],
    );
    const subscriptionId = pending.rows[0]?.id;
    const exp = pending.rows[0]?.exp;
    if (!subscriptionId || !exp) throw new Error('Confirmation state missing');
    const token = confirmationToken(tokenSecret, pub.body.id, subscriptionId, exp);
    expect((await request(app).post('/subscriptions/confirm').send({ token })).status).toBe(204);

    const checkout = await request(app)
      .post(`/public/paid-${suffix}/checkout`)
      .set('Cookie', readerCookie);
    expect(checkout.status).toBe(201);
    expect(checkout.body.status).toBe('created');
    expect(checkout.body.keyId).toBe('rzp_test_stub');
    expect(
      (await request(app).post(`/public/paid-${suffix}/checkout`).set('Cookie', readerCookie)).body
        .id,
    ).toBe(checkout.body.id);
    const listed = await request(app)
      .get(`/me/subscriptions?publicationId=${pub.body.id}`)
      .set('Cookie', readerCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(
      (
        await request(app)
          .get(`/me/subscriptions?publicationId=${other.body.id}`)
          .set('Cookie', readerCookie)
      ).body.items,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .post(`/me/subscriptions/${checkout.body.id}/cancel`)
          .set('Cookie', readerCookie)
          .send({ publicationId: other.body.id })
      ).status,
    ).toBe(404);
    expect(subscriptionCalls).toBe(1);
    expect(planCalls).toBe(1);
    expect((await request(app).get(fullPath).set('Cookie', readerCookie)).status).toBe(403);

    const providerId = checkout.body.razorpaySubscriptionId as string;
    const timestamp = Math.floor(Date.now() / 1000);
    const active: ProviderSubscription = {
      id: providerId,
      status: 'active',
      current_end: timestamp + 3600,
    };
    expect(
      (await sendWebhook(`evt_${randomUUID()}`, active, timestamp, 'wrong-secret')).status,
    ).toBe(401);
    const eventId = `evt_${randomUUID()}`;
    expect((await sendWebhook(eventId, active, timestamp)).status).toBe(200);
    expect((await sendWebhook(eventId, active, timestamp)).status).toBe(200);
    const inbox = await container.db!.primaryPool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM webhook_events WHERE provider='razorpay' AND provider_event_id=$1",
      [eventId],
    );
    expect(inbox.rows[0]?.total).toBe('1');
    const metrics = await request(app).get('/metrics');
    expect(metrics.text).toMatch(/vichaar_billing_checkouts_total 2/);
    expect(metrics.text).toMatch(/vichaar_billing_webhooks_received_total 2/);
    const pipeline = createBillingPipeline({
      pool: container.db!.primaryPool,
      hooks: queue.hooks,
      redisUrl,
    });
    try {
      expect(await pipeline.processOnce()).toBeGreaterThan(0);
    } finally {
      await pipeline.close();
    }
    const paidFull = await request(app).get(fullPath).set('Cookie', readerCookie);
    expect(paidFull.status).toBe(200);
    expect(paidFull.headers['cache-control']).toBe('private, no-store');
    expect(paidFull.body.htmlFull).toContain('Paid secret');
    snapshots.set(providerId, active);
    const cancellation = await request(app)
      .post(`/me/subscriptions/${checkout.body.id}/cancel`)
      .set('Cookie', readerCookie)
      .send({ publicationId: pub.body.id });
    expect(cancellation.status).toBe(200);
    expect(cancellation.body.status).toBe('active');
    expect((await request(app).get(fullPath).set('Cookie', readerCookie)).status).toBe(200);
    expect(
      (await request(app).post(`/public/other-${suffix}/checkout`).set('Cookie', readerCookie))
        .status,
    ).toBe(403);
    expect(await container.billingService!.isEntitled(other.body.id, reader.body.id)).toBe(false);

    const stale: ProviderSubscription = { id: providerId, status: 'halted', current_end: null };
    const staleEventId = `evt_${randomUUID()}`;
    expect((await sendWebhook(staleEventId, stale, timestamp - 10)).status).toBe(200);
    const staleInbox = await container.db!.primaryPool.query<{ id: string }>(
      "SELECT id FROM webhook_events WHERE provider='razorpay' AND provider_event_id=$1",
      [staleEventId],
    );
    expect(await container.billingService!.processWebhook(staleInbox.rows[0]!.id)).toBe(true);
    expect((await request(app).get(fullPath).set('Cookie', readerCookie)).status).toBe(200);

    await container.db!.primaryPool.query(
      "UPDATE paid_subscriptions SET last_event_at=now()-interval '2 hours' WHERE id=$1",
      [checkout.body.id],
    );
    snapshots.set(providerId, { id: providerId, status: 'halted', current_end: null });
    expect(await container.billingService!.reconcile()).toBeGreaterThan(0);
    expect((await request(app).get(fullPath).set('Cookie', readerCookie)).status).toBe(403);

    await container.db!.primaryPool.query(
      "UPDATE paid_subscriptions SET last_event_at=now()-interval '2 hours' WHERE id=$1",
      [checkout.body.id],
    );
    snapshots.set(providerId, { id: providerId, status: 'expired', current_end: null });
    expect(await container.billingService!.reconcile()).toBeGreaterThan(0);
    const renewal = await request(app)
      .post(`/public/paid-${suffix}/checkout`)
      .set('Cookie', readerCookie);
    expect(renewal.status).toBe(201);
    expect(renewal.body.id).not.toBe(checkout.body.id);
    expect(subscriptionCalls).toBe(2);
    expect(planCalls).toBe(1);
    await container.db!.primaryPool.query(
      "UPDATE paid_subscriptions SET created_at=now()-interval '25 hours' WHERE id=$1",
      [renewal.body.id],
    );
    expect(await container.billingService!.reconcile()).toBeGreaterThan(0);
    const abandoned = await container.db!.primaryPool.query<{ status: string }>(
      'SELECT status FROM paid_subscriptions WHERE id=$1',
      [renewal.body.id],
    );
    expect(abandoned.rows[0]?.status).toBe('expired');
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await request(app).post(`/public/paid-${suffix}/checkout`).set('Cookie', readerCookie)).status).toBe(201);
    expect((await request(app).post(`/public/paid-${suffix}/checkout`).set('Cookie', readerCookie)).status).toBe(429);
  });

  it('falls back to PostgreSQL on a Redis outage and returns 503 when PostgreSQL is unavailable', async () => {
    const clock = new SystemClock();
    const fallback = createBillingService({
      repo: createBillingRepository(container.db!.primaryPool, clock),
      provider,
      publicationService: container.publicationService!,
      redisUrl: 'redis://127.0.0.1:1',
      keyId: 'rzp_test_stub',
      clock,
    });
    try {
      expect(await fallback.isEntitled(randomUUID(), randomUUID())).toBe(false);
    } finally {
      await fallback.close();
    }
    const broken = createContainer({
      databaseUrl: 'postgres://vichaar:vichaar_pass@127.0.0.1:1/vichaar',
      billingProvider: provider,
    });
    try {
      await expect(
        broken.billingService!.isEntitled(randomUUID(), randomUUID()),
      ).rejects.toMatchObject({ statusCode: 503 });
    } finally {
      await broken.close();
    }
  });
});
