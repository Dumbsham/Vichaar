import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createContainer } from '../src/container.js';
import { createServer } from '../src/server.js';

const container = createContainer({
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar',
  databaseReplicaUrl:
    process.env.DATABASE_REPLICA_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5433/vichaar',
  rateLimitNamespace: randomUUID(),
});
const app = createServer(container);
afterAll(async () => {
  await container.close();
});

describe('public reading API', () => {
  it('scopes the published list, paginates it, and never exposes paid full HTML', async () => {
    const suffix = randomUUID().slice(0, 8);
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: `public-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Writer',
      });
    expect(signup.status).toBe(201);
    const cookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const subdomain = `reading-${suffix}`;
    const publication = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'Reading Test', description: 'Letters in two languages', subdomain });
    expect(publication.status).toBe(201);
    const otherPublication = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'Other', subdomain: `other-${suffix}` });
    expect(otherPublication.status).toBe(201);
    const makePost = async (publicationId: string, title: string, body: string, isPaid = false) => {
      const post = await request(app)
        .post(`/publications/${publicationId}/posts`)
        .set('Cookie', cookie)
        .send({ title, body, isPaid });
      expect(post.status).toBe(201);
      return post.body.id as string;
    };
    const publish = async (publicationId: string, postId: string) => {
      const response = await request(app)
        .post(`/publications/${publicationId}/posts/${postId}/publish`)
        .set('Cookie', cookie)
        .send({ sendImmediately: true });
      expect(response.status).toBe(202);
    };
    const freeId = await makePost(
      publication.body.id,
      'First letter',
      '<p>Public opening &amp; rain</p><p>Public ending</p>',
    );
    const paidId = await makePost(
      publication.body.id,
      'Paid letter',
      '<p>Allowed preview</p><p>Secret paid paragraph</p>',
      true,
    );
    await makePost(publication.body.id, 'Private draft', '<p>Not published</p>');
    const otherId = await makePost(
      otherPublication.body.id,
      'Other tenant letter',
      '<p>Other tenant text</p>',
    );
    await publish(publication.body.id, freeId);
    await publish(publication.body.id, paidId);
    await publish(otherPublication.body.id, otherId);

    const info = await request(app).get(`/public/${subdomain}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      name: 'Reading Test',
      description: 'Letters in two languages',
    });
    expect(info.body.ownerId).toBeUndefined();
    expect(info.headers['cache-control']).toBe('no-store');
    await vi.waitFor(
      async () => {
        const page = await request(app).get(`/public/${subdomain}/posts?limit=1`);
        expect(page.status).toBe(200);
        expect(page.body.items).toHaveLength(1);
        expect(page.body.hasMore).toBe(true);
      },
      { timeout: 5000 },
    );
    const first = await request(app).get(`/public/${subdomain}/posts?limit=1`);
    expect(first.headers['cache-control']).toBe('no-store');
    const second = await request(app).get(
      `/public/${subdomain}/posts?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);
    const titles = [...first.body.items, ...second.body.items].map(
      (item: { title: string }) => item.title,
    );
    expect(titles).toEqual(expect.arrayContaining(['First letter', 'Paid letter']));
    expect(titles).not.toContain('Private draft');
    expect(titles).not.toContain('Other tenant letter');
    expect(JSON.stringify([first.body, second.body])).not.toContain('Secret paid paragraph');
    expect(JSON.stringify([first.body, second.body])).not.toContain('htmlFull');
    const free = [...first.body.items, ...second.body.items].find(
      (item: { title: string }) => item.title === 'First letter',
    );
    expect(free.excerpt).toBe('Public opening & rain Public ending');
    expect((await request(app).get(`/public/${subdomain}/posts?cursor=invalid`)).status).toBe(422);
    const paid = [...first.body.items, ...second.body.items].find(
      (item: { isPaid: boolean }) => item.isPaid,
    );
    expect(paid.excerpt).toContain('Allowed preview');
    expect(paid.excerpt).not.toContain('Secret paid paragraph');
    const post = await request(app).get(`/public/${subdomain}/posts/first-letter`);
    expect(post.status).toBe(200);
    expect(post.body.htmlPreview).toContain('Public ending');
    await request(app)
      .post(`/publications/${publication.body.id}/posts/${freeId}/unpublish`)
      .set('Cookie', cookie);
    await vi.waitFor(
      async () => {
        const list = await request(app).get(`/public/${subdomain}/posts`);
        expect(list.body.items.map((item: { title: string }) => item.title)).toEqual([
          'Paid letter',
        ]);
      },
      { timeout: 5000 },
    );
    expect((await request(app).get(`/public/${subdomain}/posts/first-letter`)).status).toBe(404);
  });
});
