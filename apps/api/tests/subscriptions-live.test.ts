import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createContainer } from '../src/container.js';
import { createServer } from '../src/server.js';
import { confirmationToken, unsubscribeToken } from '@vichaar/shared/subscription-tokens';
import { createDeliveryRepository } from '../../workers/src/delivery-repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
const secret = process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!';
const container = createContainer({ databaseUrl, rateLimitNamespace: randomUUID() });
const app = createServer(container);
afterAll(async () => {
  await container.close();
});

describe('Phase 2 live subscription and delivery state', () => {
  it('confirms once, isolates tenants, suppresses unsubscribe, and claims a delivery once', async () => {
    const suffix = randomUUID().slice(0, 8);
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: `writer-${suffix}@example.test`,
        password: 'strong-secret-123',
        name: 'Writer',
      });
    expect(signup.status).toBe(201);
    const cookie = Array.isArray(signup.headers['set-cookie'])
      ? signup.headers['set-cookie'][0]
      : signup.headers['set-cookie'];
    const pub = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'First', subdomain: `first-${suffix}` });
    const other = await request(app)
      .post('/publications')
      .set('Cookie', cookie)
      .send({ name: 'Second', subdomain: `second-${suffix}` });
    expect(pub.status).toBe(201);
    expect(other.status).toBe(201);
    const email = `reader-${suffix}@example.test`;
    const input = { email, slot: 'morning', timezone: 'Asia/Kolkata' };
    const response = await request(app).post(`/public/first-${suffix}/subscribe`).send(input);
    const repeat = await request(app).post(`/public/first-${suffix}/subscribe`).send(input);
    expect(response.status).toBe(202);
    expect(repeat.body).toEqual(response.body);
    const pending = await container.db!.primaryPool.query<{ id: string; exp: number }>(
      'SELECT id,floor(extract(epoch FROM confirmation_expires_at))::integer AS exp FROM subscriptions WHERE publication_id=$1 AND email=$2',
      [pub.body.id, email],
    );
    const id = pending.rows[0]?.id;
    const exp = pending.rows[0]?.exp;
    expect(id).toBeDefined();
    expect(exp).toBeDefined();
    if (!id || !exp) throw new Error('Subscription missing');
    const token = confirmationToken(secret, pub.body.id, id, exp);
    expect((await request(app).post('/subscriptions/confirm').send({ token })).status).toBe(204);
    expect((await request(app).post('/subscriptions/confirm').send({ token })).status).toBe(204);
    const count = await container.db!.primaryPool.query<{ subscriber_count: number }>(
      'SELECT subscriber_count FROM publications WHERE id=$1',
      [pub.body.id],
    );
    expect(count.rows[0]?.subscriber_count).toBe(1);
    const crossTenant = await container.db!.primaryPool.query(
      'SELECT * FROM subscriptions WHERE publication_id=$1 AND id=$2',
      [other.body.id, id],
    );
    expect(crossTenant.rowCount).toBe(0);

    const draft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'Delivery test', body: '<p>Safe email</p>' });
    expect(draft.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${draft.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: true })
      ).status,
    ).toBe(202);
    const repo = createDeliveryRepository(container.db!.primaryPool);
    await repo.fanout({
      publicationId: pub.body.id,
      postId: draft.body.id,
      afterId: null,
      scheduledFor: null,
      sendImmediately: true,
    });
    await repo.fanout({
      publicationId: pub.body.id,
      postId: draft.body.id,
      afterId: null,
      scheduledFor: null,
      sendImmediately: true,
    });
    const keys = await repo.queueDue();
    const own = keys.filter((key) => key.postId === draft.body.id);
    expect(own).toHaveLength(1);
    expect(await repo.claim(own)).toHaveLength(1);
    expect(await repo.claim(own)).toHaveLength(0);
    await repo.record([{ key: own[0]!, status: 'sent', messageId: 'stub-test' }]);
    const state = await container.db!.primaryPool.query<{ status: string }>(
      'SELECT status FROM post_deliveries WHERE publication_id=$1 AND post_id=$2',
      [pub.body.id, draft.body.id],
    );
    expect(state.rows[0]?.status).toBe('sent');

    const unsub = unsubscribeToken(secret, pub.body.id, id, Math.floor(Date.now() / 1000) + 3600);
    const futureSlot = '2030-01-01T00:00:00.000Z';
    const slotDraft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'Slot test', body: '<p>Slot</p>', scheduledFor: futureSlot });
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${slotDraft.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: false })
      ).status,
    ).toBe(202);
    await repo.fanout({
      publicationId: pub.body.id,
      postId: slotDraft.body.id,
      afterId: null,
      scheduledFor: futureSlot,
      sendImmediately: false,
    });
    const beforeSlot = await container.db!.primaryPool.query<{ send_at: Date; send_month: string }>(
      "SELECT send_at,to_char(send_month,'YYYY-MM-DD') AS send_month FROM post_deliveries WHERE publication_id=$1 AND post_id=$2",
      [pub.body.id, slotDraft.body.id],
    );
    expect(
      (
        await request(app)
          .post(`/subscriptions/preferences/${unsub}`)
          .send({ slot: 'evening', timezone: 'America/New_York' })
      ).status,
    ).toBe(204);
    const afterSlot = await container.db!.primaryPool.query<{ send_at: Date; send_month: string }>(
      "SELECT send_at,to_char(send_month,'YYYY-MM-DD') AS send_month FROM post_deliveries WHERE publication_id=$1 AND post_id=$2",
      [pub.body.id, slotDraft.body.id],
    );
    expect(afterSlot.rows[0]?.send_at.toISOString()).not.toBe(
      beforeSlot.rows[0]?.send_at.toISOString(),
    );
    expect(afterSlot.rows[0]?.send_month).toBe(beforeSlot.rows[0]?.send_month);
    expect(afterSlot.rows[0]?.send_month).not.toBe(
      afterSlot.rows[0]?.send_at.toISOString().slice(0, 7) + '-01',
    );
    await repo.fanout({
      publicationId: pub.body.id,
      postId: slotDraft.body.id,
      afterId: null,
      scheduledFor: futureSlot,
      sendImmediately: false,
    });
    const replayCount = await container.db!.primaryPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM post_deliveries WHERE publication_id=$1 AND post_id=$2',
      [pub.body.id, slotDraft.body.id],
    );
    expect(replayCount.rows[0]?.count).toBe('1');
    await container.db!.primaryPool.query(
      "UPDATE posts SET scheduled_for=now()-interval '1 second' WHERE publication_id=$1 AND id=$2",
      [pub.body.id, slotDraft.body.id],
    );
    expect(await repo.releaseScheduled()).toBeGreaterThanOrEqual(1);
    expect(await repo.releaseScheduled()).toBe(0);
    const released = await container.db!.primaryPool.query<{ status: string }>(
      'SELECT status FROM posts WHERE publication_id=$1 AND id=$2',
      [pub.body.id, slotDraft.body.id],
    );
    expect(released.rows[0]?.status).toBe('published');
    const limitDraft = await request(app)
      .post(`/publications/${pub.body.id}/posts`)
      .set('Cookie', cookie)
      .send({ title: 'Daily limit', body: '<p>Cap</p>' });
    expect(
      (
        await request(app)
          .post(`/publications/${pub.body.id}/posts/${limitDraft.body.id}/publish`)
          .set('Cookie', cookie)
          .send({ sendImmediately: true })
      ).status,
    ).toBe(202);
    await repo.fanout({
      publicationId: pub.body.id,
      postId: limitDraft.body.id,
      afterId: null,
      scheduledFor: null,
      sendImmediately: true,
    });
    await container.db!.primaryPool.query(
      'UPDATE publications SET daily_send_limit=1 WHERE id=$1',
      [pub.body.id],
    );
    expect((await repo.queueDue()).filter((key) => key.postId === limitDraft.body.id)).toHaveLength(
      0,
    );
    expect((await request(app).post(`/unsubscribe/${unsub}`)).status).toBe(204);
    expect((await request(app).post(`/unsubscribe/${unsub}`)).status).toBe(204);
    expect((await request(app).post(`/public/first-${suffix}/subscribe`).send(input)).status).toBe(
      202,
    );
    const suppression = await container.db!.primaryPool.query(
      'SELECT 1 FROM suppressions WHERE publication_id=$1 AND email=$2',
      [pub.body.id, email],
    );
    expect(suppression.rowCount).toBe(1);
    const finalCount = await container.db!.primaryPool.query<{ subscriber_count: number }>(
      'SELECT subscriber_count FROM publications WHERE id=$1',
      [pub.body.id],
    );
    expect(finalCount.rows[0]?.subscriber_count).toBe(0);
  });
});
