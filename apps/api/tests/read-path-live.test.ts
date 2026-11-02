import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createClient } from 'redis';
import { createContainer } from '../src/container.js';
import { createServer } from '../src/server.js';
import { previewCacheKey } from '../src/shared/cache.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
const replicaUrl = process.env.DATABASE_REPLICA_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5433/vichaar';
const container = createContainer({ databaseUrl, databaseReplicaUrl: replicaUrl, rateLimitNamespace: randomUUID() });
const app = createServer(container);
const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
redis.on('error', () => {});
afterAll(async () => {
  if (redis.isOpen) await redis.quit();
  await container.close();
});

describe('Phase 3 live read path', () => {
  it('caches public previews, invalidates on unpublish, and falls back when replica is down', async () => {
    const suffix = randomUUID().slice(0, 8);
    const signup = await request(app).post('/auth/signup').send({
      email: `read-${suffix}@example.test`, password: 'strong-secret-123', name: 'Reader',
    });
    expect(signup.status).toBe(201);
    const cookie = signup.headers['set-cookie'];
    const ownerCookie = Array.isArray(cookie) ? cookie[0] : cookie;
    const subdomain = `read-${suffix}`;
    const pub = await request(app).post('/publications').set('Cookie', ownerCookie)
      .send({ name: 'Read Path', subdomain });
    expect(pub.status).toBe(201);
    const post = await request(app).post(`/publications/${pub.body.id}/posts`).set('Cookie', ownerCookie)
      .send({ title: 'Hello', body: '<p>Public text</p>', isPaid: false });
    expect(post.status).toBe(201);
    const published = await request(app).post(`/publications/${pub.body.id}/posts/${post.body.id}/publish`)
      .set('Cookie', ownerCookie).send({ sendImmediately: true });
    expect(published.status).toBe(202);
    await vi.waitFor(async () => {
      const row = await container.db!.replicaPool.query<{ status: string }>(
        'SELECT status FROM posts WHERE publication_id=$1 AND id=$2', [pub.body.id, post.body.id],
      );
      expect(row.rows[0]?.status).toBe('published');
    }, { timeout: 5000 });
    const path = `/public/${subdomain}/posts/hello`;
    const first = await request(app).get(path);
    expect(first.status).toBe(200);
    expect(first.body.htmlPreview).toContain('Public text');
    expect((await request(app).get(path)).status).toBe(200);
    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toMatch(/vichaar_preview_cache_hits_total [1-9]/);
    await redis.connect();
    expect(await redis.get(previewCacheKey(subdomain, 'hello'))).toContain('Public text');
    const full = await request(app).get(`${path}/full`);
    expect(full.status).toBe(200);
    expect(full.headers['cache-control']).toBe('private, no-store');
    const unpublished = await request(app).post(`/publications/${pub.body.id}/posts/${post.body.id}/unpublish`)
      .set('Cookie', ownerCookie);
    expect(unpublished.status).toBe(200);
    expect(await redis.get(previewCacheKey(subdomain, 'hello'))).toBeNull();
    await vi.waitFor(async () => {
      const row = await container.db!.replicaPool.query<{ status: string }>(
        'SELECT status FROM posts WHERE publication_id=$1 AND id=$2', [pub.body.id, post.body.id],
      );
      expect(row.rows[0]?.status).toBe('unpublished');
    }, { timeout: 5000 });
    expect((await request(app).get(path)).status).toBe(404);
    const paid = await request(app).post(`/publications/${pub.body.id}/posts`).set('Cookie', ownerCookie)
      .send({ title: 'Premium', body: '<p>Intro</p><p>Secret paid body</p>', isPaid: true });
    expect(paid.status).toBe(201);
    expect((await request(app).post(`/publications/${pub.body.id}/posts/${paid.body.id}/publish`)
      .set('Cookie', ownerCookie).send({ sendImmediately: true })).status).toBe(202);
    await vi.waitFor(async () => {
      const row = await container.db!.replicaPool.query<{ status: string }>(
        'SELECT status FROM posts WHERE publication_id=$1 AND id=$2', [pub.body.id, paid.body.id],
      );
      expect(row.rows[0]?.status).toBe('published');
    }, { timeout: 5000 });
    const paidPath = `/public/${subdomain}/posts/premium`;
    const paidPreview = await request(app).get(paidPath);
    expect(paidPreview.status).toBe(200);
    expect(paidPreview.body.htmlPreview).not.toContain('Secret paid body');
    const cachedPaid = await redis.get(previewCacheKey(subdomain, 'premium'));
    expect(cachedPaid).not.toContain('Secret paid body');
    expect(cachedPaid).not.toContain('htmlFull');
    const paidFull = await request(app).get(`${paidPath}/full`);
    expect(paidFull.status).toBe(401);
    expect(paidFull.headers['cache-control']).toBe('private, no-store');
    expect((await request(app).get(`${paidPath}/full`).set('Cookie', ownerCookie)).status).toBe(503);
    const fallback = createContainer({ databaseUrl, databaseReplicaUrl: 'postgres://vichaar:vichaar_pass@127.0.0.1:1/vichaar' });
    try {
      const result = await fallback.publicationService!.getBySubdomain(subdomain);
      expect(result.id).toBe(pub.body.id);
    } finally { await fallback.close(); }
  });
});
