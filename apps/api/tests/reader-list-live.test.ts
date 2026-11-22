import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createContainer } from '../src/container.js';
import { createServer } from '../src/server.js';

const container = createContainer({
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar',
  rateLimitNamespace: randomUUID(),
});
const app = createServer(container);
afterAll(async () => {
  await container.close();
});

describe('owner reader list', () => {
  it('pages active readers within one publication and rejects another owner', async () => {
    const suffix = randomUUID().slice(0, 8);
    const signup = async (name: string) => {
      const result = await request(app)
        .post('/auth/signup')
        .send({
          name,
          email: `${name}-${suffix}@example.test`,
          password: 'strong-secret-123',
        });
      expect(result.status).toBe(201);
      return Array.isArray(result.headers['set-cookie'])
        ? result.headers['set-cookie'][0]
        : result.headers['set-cookie'];
    };
    const ownerCookie = await signup('owner');
    const otherCookie = await signup('other');
    const publication = await request(app)
      .post('/publications')
      .set('Cookie', ownerCookie)
      .send({ name: 'Reader List', subdomain: `readers-${suffix}` });
    expect(publication.status).toBe(201);
    const publicationId = z.string().uuid().parse(publication.body.id);
    if (!container.db) throw new Error('Database missing');
    for (const [index, status] of [
      'active',
      'active',
      'active',
      'pending',
      'unsubscribed',
    ].entries()) {
      await container.db.primaryPool.query(
        'INSERT INTO subscriptions(id,publication_id,email,status) VALUES($1,$2,$3,$4)',
        [randomUUID(), publicationId, `reader-${index}-${suffix}@example.test`, status],
      );
    }
    const path = `/publications/${publicationId}/readers`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set('Cookie', otherCookie)).status).toBe(404);
    const first = await request(app).get(`${path}?limit=2`).set('Cookie', ownerCookie);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBeTruthy();
    expect(JSON.stringify(first.body)).not.toContain('confirmation_token_hash');
    const second = await request(app)
      .get(`${path}?limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', ownerCookie);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);
    expect(second.body.nextCursor).toBeNull();
    expect((await request(app).get(`${path}?limit=1000`).set('Cookie', ownerCookie)).status).toBe(
      400,
    );
    expect(
      (await request(app).get(`${path}?cursor=invalid`).set('Cookie', ownerCookie)).status,
    ).toBe(400);
  });
});
