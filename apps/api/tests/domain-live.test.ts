import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createContainer } from '../src/container.js';
import { createServer } from '../src/server.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
const container = createContainer({ databaseUrl, rateLimitNamespace: randomUUID() });
const app = createServer(container);
afterAll(async () => {
  await container.close();
});

describe('Phase 1B live domain flow', () => {
  it('enforces ownership, version checks, safe public previews, and one publish event', async () => {
    const suffix = randomUUID().slice(0, 8);
    async function signup(name: string) {
      const response = await request(app)
        .post('/auth/signup')
        .send({ email: `${name}-${suffix}@example.test`, password: 'strong-secret-123', name });
      expect(response.status).toBe(201);
      const cookie = response.headers['set-cookie'];
      expect(cookie).toBeDefined();
      return Array.isArray(cookie) ? cookie[0] : cookie;
    }
    const ownerCookie = await signup('owner');
    const strangerCookie = await signup('stranger');
    const pub = await request(app)
      .post('/publications')
      .set('Cookie', ownerCookie)
      .send({ name: 'Test Publication', subdomain: `test-${suffix}` });
    expect(pub.status).toBe(201);
    const pubId = pub.body.id;
    const strangerRead = await request(app)
      .get(`/publications/${pubId}`)
      .set('Cookie', strangerCookie);
    expect(strangerRead.status).toBe(404);
    const strangerStats = await request(app)
      .get(`/publications/${pubId}/stats`)
      .set('Cookie', strangerCookie);
    expect(strangerStats.status).toBe(404);
    expect((await request(app).get(`/publications/${pubId}/stats`)).status).toBe(401);
    const strangerPost = await request(app)
      .post(`/publications/${pubId}/posts`)
      .set('Cookie', strangerCookie)
      .send({ title: 'Not Mine', body: 'no' });
    expect(strangerPost.status).toBe(404);
    const unauthenticated = await request(app).get(`/publications/${pubId}`);
    expect(unauthenticated.status).toBe(401);

    const draft = await request(app)
      .post(`/publications/${pubId}/posts`)
      .set('Cookie', ownerCookie)
      .send({
        title: 'First Post',
        isPaid: true,
        body: '<p>Preview</p><script>alert(1)</script><p>Secret paid paragraph</p><a href="javascript:alert(1)" onclick="bad()">bad</a><a href="https://example.org/story">safe</a>',
      });
    expect(draft.status).toBe(201);
    const postId = draft.body.id;
    const strangerDraft = await request(app)
      .get(`/publications/${pubId}/posts/${postId}`)
      .set('Cookie', strangerCookie);
    expect(strangerDraft.status).toBe(404);
    const stale = await request(app)
      .patch(`/publications/${pubId}/posts/${postId}`)
      .set('Cookie', ownerCookie)
      .send({ version: 2, title: 'Wrong Version' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const saved = await request(app)
      .patch(`/publications/${pubId}/posts/${postId}`)
      .set('Cookie', ownerCookie)
      .send({ version: 1, title: 'Edited First Post' });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(2);
    const visitorBefore = await request(app).get(`/public/test-${suffix}/posts/first-post`);
    expect(visitorBefore.status).toBe(404);
    const published = await request(app)
      .post(`/publications/${pubId}/posts/${postId}/publish`)
      .set('Cookie', ownerCookie)
      .send({ sendImmediately: true });
    expect(published.status).toBe(202);
    const retry = await request(app)
      .post(`/publications/${pubId}/posts/${postId}/publish`)
      .set('Cookie', ownerCookie)
      .send({ sendImmediately: true });
    expect(retry.status).toBe(202);
    const strangerPublish = await request(app)
      .post(`/publications/${pubId}/posts/${postId}/publish`)
      .set('Cookie', strangerCookie)
      .send({});
    expect(strangerPublish.status).toBe(404);
    const eventCount = await container.db!.primaryPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox_events WHERE event_type='PostPublished' AND payload->>'postId'=$1`,
      [postId],
    );
    expect(eventCount.rows[0]?.count).toBe('1');
    const visitor = await request(app).get(`/public/test-${suffix}/posts/first-post`);
    expect(visitor.status).toBe(200);
    expect(visitor.body.htmlPreview).toContain('Preview');
    expect(visitor.body.htmlPreview).not.toContain('Secret paid paragraph');
    expect(visitor.body.htmlFull).toBeUndefined();
    expect(visitor.body.body).toBeUndefined();
    const stored = await container.db!.primaryPool.query<{ html_full: string }>(
      'SELECT html_full FROM post_contents WHERE publication_id=$1 AND post_id=$2',
      [pubId, postId],
    );
    expect(stored.rows[0]?.html_full).not.toContain('<script>');
    expect(stored.rows[0]?.html_full).not.toContain('javascript:');
    expect(stored.rows[0]?.html_full).not.toContain('onclick');
    const links = await container.db!.primaryPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM tracked_links WHERE publication_id=$1 AND post_id=$2',
      [pubId, postId],
    );
    expect(links.rows[0]?.count).toBe('1');
  });

  it('records a future scheduled post without exposing it publicly', async () => {
    const suffix = randomUUID().slice(0, 8);
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: `schedule-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Scheduler',
      });
    expect(signup.status).toBe(201);
    const cookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const publication = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'Scheduled Publication', subdomain: `scheduled-${suffix}` });
    expect(publication.status).toBe(201);
    const scheduledFor = '2030-01-01T10:00:00.000Z';
    const draft = await request(app)
      .post(`/publications/${publication.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'Future Story', body: '<p>Coming soon</p>', scheduledFor });
    expect(draft.status).toBe(201);
    const publish = await request(app)
      .post(`/publications/${publication.body.id}/posts/${draft.body.id}/publish`)
      .set('Cookie', cookie)
      .send({});
    expect(publish.status).toBe(202);
    expect(publish.body.status).toBe('scheduled');
    const publicRead = await request(app).get(`/public/scheduled-${suffix}/posts/future-story`);
    expect(publicRead.status).toBe(404);
  });

  it('uses the same error for unknown users and wrong passwords, and invalidates logout sessions', async () => {
    const authContainer = createContainer({ databaseUrl, rateLimitNamespace: randomUUID() });
    const authApp = createServer(authContainer);
    const email = `login-${randomUUID()}@example.test`;
    const signup = await request(authApp)
      .post('/auth/signup')
      .send({ email, password: 'strong-secret-123', name: 'Login Test' });
    expect(signup.status).toBe(201);
    const badKnown = await request(authApp)
      .post('/auth/login')
      .send({ email, password: 'incorrect' });
    const badUnknown = await request(authApp)
      .post('/auth/login')
      .send({ email: `unknown-${randomUUID()}@example.test`, password: 'incorrect' });
    expect(badKnown.status).toBe(401);
    expect(badUnknown.status).toBe(401);
    expect(badKnown.body.error.message).toBe(badUnknown.body.error.message);
    const login = await request(authApp)
      .post('/auth/login')
      .send({ email, password: 'strong-secret-123' });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'];
    const sessionCookie = Array.isArray(cookie) ? cookie[0] : cookie;
    const logout = await request(authApp).post('/auth/logout').set('Cookie', sessionCookie);
    expect(logout.status).toBe(204);
    const after = await request(authApp).get('/publications').set('Cookie', sessionCookie);
    expect(after.status).toBe(401);
    await authContainer.close();
  });
});
