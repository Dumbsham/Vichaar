import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabaseClients, runMigrations } from '../packages/db/src/index.js';
import { createContainer } from '../apps/api/src/container.js';
import { createServer } from '../apps/api/src/server.js';
import type { BillingProvider } from '../apps/api/src/modules/billing/index.js';
import { startDockerService } from './docker-service.js';

const rootUrl = process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
if (!['localhost', '127.0.0.1'].includes(new URL(rootUrl).hostname)) throw new Error('Chaos test requires local PostgreSQL');
const databaseName = `vichaar_redis_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const url = new URL(rootUrl);
url.pathname = `/${databaseName}`;
const admin = createDatabaseClients({ primaryUrl: rootUrl, maxConnections: 1 });
const provider: BillingProvider = {
  async createPlan() { return 'plan_stub'; },
  async createSubscription() { return { id: 'sub_stub', status: 'active', current_end: null }; },
  async fetchSubscription() { return { id: 'sub_stub', status: 'active', current_end: null }; },
  async cancelSubscription() { return { id: 'sub_stub', status: 'cancelled', current_end: null }; },
};
let redis: Awaited<ReturnType<typeof startDockerService>> | undefined;
let container: ReturnType<typeof createContainer> | undefined;

beforeAll(async () => {
  redis = await startDockerService('redis:7-alpine', 6379);
  const client = createClient({ url: `redis://127.0.0.1:${redis.port}`, socket: { connectTimeout: 1000, reconnectStrategy: false } });
  client.on('error', () => {});
  try {
    await vi.waitFor(async () => { await client.connect(); expect(await client.ping()).toBe('PONG'); }, { timeout: 20_000, interval: 100 });
  } finally { if (client.isOpen) await client.quit(); }
  await admin.primaryPool.query(`CREATE DATABASE ${databaseName}`);
  await runMigrations(url.toString());
  container = createContainer({ databaseUrl: url.toString(), redisUrl: `redis://127.0.0.1:${redis.port}`, billingProvider: provider, rateLimitNamespace: randomUUID() });
}, 90_000);

afterAll(async () => {
  if (container) await container.close();
  await admin.primaryPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.close();
  if (redis) await redis.remove();
}, 60_000);

describe('Redis outage', () => {
  it('serves previews and paid bodies through PostgreSQL after Redis stops', async () => {
    if (!container || !redis) throw new Error('Test setup failed');
    const app = createServer(container);
    const suffix = randomUUID().slice(0, 8);
    const email = `reader-${suffix}@example.test`;
    const signup = await request(app).post('/auth/signup').send({ email, password: 'strong-secret-123', name: 'Reader' });
    expect(signup.status).toBe(201);
    const userId = signup.body.user.id as string;
    const cookies = signup.headers['set-cookie'];
    const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
    const pubId = randomUUID();
    const postId = randomUUID();
    const subId = randomUUID();
    const subdomain = `chaos-${suffix}`;
    await container.db!.primaryPool.query(
      'INSERT INTO publications(id,owner_id,name,subdomain,monthly_price_paise) VALUES($1,$2,$3,$4,49900)',
      [pubId, userId, 'Redis chaos', subdomain],
    );
    await container.db!.primaryPool.query(
      "INSERT INTO posts(id,publication_id,slug,title,access,status,published_at) VALUES($1,$2,'premium','Premium','paid','published',now())",
      [postId, pubId],
    );
    await container.db!.primaryPool.query(
      "INSERT INTO post_contents(post_id,publication_id,html_preview,html_full) VALUES($1,$2,'<p>Preview</p>','<p>Paid body</p>')",
      [postId, pubId],
    );
    await container.db!.primaryPool.query(
      "INSERT INTO subscriptions(id,publication_id,email,status) VALUES($1,$2,$3,'active')",
      [subId, pubId, email],
    );
    await container.db!.primaryPool.query(
      "INSERT INTO paid_subscriptions(id,publication_id,subscription_id,user_id,razorpay_subscription_id,status,price_paise) VALUES($1,$2,$3,$4,$5,'active',49900)",
      [randomUUID(), pubId, subId, userId, `sub_${suffix}`],
    );
    const path = `/public/${subdomain}/posts/premium`;
    expect((await request(app).get(path)).status).toBe(200);
    expect((await request(app).get(`${path}/full`).set('Cookie', cookie)).status).toBe(200);
    await redis.stop();
    const preview = await request(app).get(path);
    const paid = await request(app).get(`${path}/full`).set('Cookie', cookie);
    expect(preview.status).toBe(200);
    expect(preview.body.htmlPreview).toContain('Preview');
    expect(paid.status).toBe(200);
    expect(paid.body.htmlFull).toContain('Paid body');
    expect(container.previewCache!.stats().redisErrors).toBeGreaterThan(0);
    expect(container.billingService!.stats().redisErrors).toBeGreaterThan(0);
    expect(container.billingService!.stats().dbChecks).toBeGreaterThan(0);
  }, 60_000);
});
