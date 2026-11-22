import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { unsubscribeToken } from '@vichaar/shared/subscription-tokens';
import { createContainer } from '../../api/src/container.js';
import { createServer } from '../../api/src/server.js';

async function freePort(): Promise<number> {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No free port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe('same-origin API rewrite', () => {
  const providerSubscriptionId = `sub_${crypto.randomUUID().replaceAll('-', '')}`;
  const container = createContainer({
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar',
    billingProvider: {
      createPlan: async () => `plan_${crypto.randomUUID().replaceAll('-', '')}`,
      createSubscription: async () => ({
        id: providerSubscriptionId,
        status: 'created',
        current_end: null,
      }),
      fetchSubscription: async () => ({
        id: providerSubscriptionId,
        status: 'active',
        current_end: null,
      }),
      cancelSubscription: async () => ({
        id: providerSubscriptionId,
        status: 'cancelled',
        current_end: Math.floor(Date.now() / 1000) + 86400,
      }),
    },
  });
  let web: ChildProcess | undefined;
  let apiServer: ReturnType<ReturnType<typeof createServer>['listen']> | undefined;
  afterAll(async () => {
    web?.kill('SIGTERM');
    if (apiServer) await new Promise<void>((resolve) => apiServer?.close(() => resolve()));
    await container.close();
  });

  it('preserves session cookies and rejects a foreign Origin', async () => {
    const webPort = await freePort();
    const webOrigin = `http://127.0.0.1:${webPort}`;
    const apiPort = await freePort();
    process.env.CORS_ORIGIN = webOrigin;
    apiServer = createServer(container).listen(apiPort, '127.0.0.1');
    web = spawn(
      'node',
      [
        'node_modules/next/dist/bin/next',
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(webPort),
      ],
      {
        cwd: new URL('..', import.meta.url).pathname,
        env: {
          ...process.env,
          API_ORIGIN: `http://127.0.0.1:${apiPort}`,
          NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: 'ignore',
      },
    );
    await vi.waitFor(
      async () => {
        const ready = await fetch(webOrigin);
        expect(ready.status).toBe(200);
      },
      { timeout: 60000, interval: 300 },
    );
    expect((await fetch(`${webOrigin}/api/metrics`)).status).toBe(404);
    const email = `web-${crypto.randomUUID()}@example.test`;
    const signup = await fetch(`${webOrigin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: webOrigin },
      body: JSON.stringify({ email, password: 'strong-secret-123', name: 'Web Reader' }),
    });
    expect(signup.status).toBe(201);
    const setCookie = signup.headers.get('set-cookie');
    expect(setCookie).toContain('vichaar_session=');
    expect(setCookie).toContain('HttpOnly');
    const cookie = setCookie?.split(';')[0];
    expect(cookie).toBeTruthy();
    const publication = await fetch(`${webOrigin}/api/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: webOrigin, cookie: cookie! },
      body: JSON.stringify({
        name: 'Through the web',
        subdomain: `web-${crypto.randomUUID().slice(0, 8)}`,
        monthlyPricePaise: 49900,
      }),
    });
    expect(publication.status).toBe(201);
    const publicationId = z
      .object({ id: z.string().uuid(), subdomain: z.string() })
      .parse(await publication.json());
    const owned = await fetch(`${webOrigin}/api/publications`, { headers: { cookie: cookie! } });
    expect(owned.status).toBe(200);
    const foreign = await fetch(`${webOrigin}/api/publications`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://foreign.example',
        cookie: cookie!,
      },
      body: JSON.stringify({
        name: 'Rejected',
        subdomain: `bad-${crypto.randomUUID().slice(0, 8)}`,
      }),
    });
    expect(foreign.status).toBe(403);

    const postResponse = await fetch(`${webOrigin}/api/publications/${publicationId.id}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: webOrigin, cookie: cookie! },
      body: JSON.stringify({
        title: 'F2 paid letter',
        body: '<p>Shared opening</p><p>Private ending</p>',
        isPaid: true,
      }),
    });
    expect(postResponse.status).toBe(201);
    const post = z
      .object({ id: z.string().uuid(), slug: z.string() })
      .parse(await postResponse.json());
    const publish = await fetch(
      `${webOrigin}/api/publications/${publicationId.id}/posts/${post.id}/publish`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: webOrigin, cookie: cookie! },
        body: JSON.stringify({ sendImmediately: false }),
      },
    );
    expect(publish.status).toBe(202);
    const postUrl = `${webOrigin}/p/${publicationId.subdomain}/${post.slug}`;
    const anonymousHtml = await (await fetch(postUrl)).text();
    expect(anonymousHtml).toContain('Shared opening');
    expect(anonymousHtml).not.toContain('Private ending');
    expect(anonymousHtml).toContain('Log in to read');
    const deniedHtml = await (await fetch(postUrl, { headers: { cookie: cookie! } })).text();
    expect(deniedHtml).toContain('Continue with test payment');
    expect(deniedHtml).not.toContain('Private ending');

    if (!container.db || !container.billingService) throw new Error('Billing test setup missing');
    const subscriptionId = crypto.randomUUID();
    await container.db.primaryPool.query(
      "INSERT INTO subscriptions(id,publication_id,email,status,slot,timezone) VALUES($1,$2,$3,'active','morning','Asia/Kolkata')",
      [subscriptionId, publicationId.id, email],
    );
    const checkout = await fetch(`${webOrigin}/api/public/${publicationId.subdomain}/checkout`, {
      method: 'POST',
      headers: { origin: webOrigin, cookie: cookie! },
    });
    expect(checkout.status).toBe(201);
    const checkoutId = z.object({ id: z.string().uuid() }).parse(await checkout.json()).id;
    const pending = await fetch(
      `${webOrigin}/api/me/subscriptions?publicationId=${publicationId.id}`,
      { headers: { cookie: cookie! } },
    );
    expect(
      z.object({ items: z.array(z.object({ status: z.string() })) }).parse(await pending.json())
        .items[0]?.status,
    ).toBe('created');
    const webhookId = await container.billingService.receiveWebhook(crypto.randomUUID(), {
      event: 'subscription.activated',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        subscription: {
          entity: { id: providerSubscriptionId, status: 'active', current_end: null },
        },
      },
    });
    expect(await container.billingService.processWebhook(webhookId)).toBe(true);
    const allowedHtml = await (await fetch(postUrl, { headers: { cookie: cookie! } })).text();
    expect(allowedHtml).toContain('Private ending');
    const cancel = await fetch(`${webOrigin}/api/me/subscriptions/${checkoutId}/cancel`, {
      method: 'POST',
      headers: { origin: webOrigin, cookie: cookie!, 'content-type': 'application/json' },
      body: JSON.stringify({ publicationId: publicationId.id }),
    });
    expect(cancel.status).toBe(200);
    const cancelledButEntitled = await (
      await fetch(postUrl, { headers: { cookie: cookie! } })
    ).text();
    expect(cancelledButEntitled).toContain('Private ending');
    const statusPage = await (
      await fetch(`${webOrigin}/account/subscriptions?publicationId=${publicationId.id}`, {
        headers: { cookie: cookie! },
      })
    ).text();
    expect(statusPage).toContain('Subscriptions');

    const manageToken = unsubscribeToken(
      process.env.TOKEN_HMAC_SECRET ?? 'local_development_hmac_secret_32chars_min!',
      publicationId.id,
      subscriptionId,
      Math.floor(Date.now() / 1000) + 86400,
    );
    expect(
      (
        await fetch(`${webOrigin}/subscribe-demo?token=${encodeURIComponent(manageToken)}`, {
          redirect: 'manual',
        })
      ).status,
    ).toBe(307);
    expect(
      (await fetch(`${webOrigin}/subscriptions/preferences/${manageToken}`, { redirect: 'manual' }))
        .status,
    ).toBe(307);
    const preferences = await fetch(`${webOrigin}/api/subscriptions/preferences/${manageToken}`, {
      method: 'POST',
      headers: { origin: webOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ slot: 'evening', timezone: 'Asia/Kolkata' }),
    });
    expect(preferences.status).toBe(204);
    expect(
      (await fetch(`${webOrigin}/unsubscribe/${manageToken}/one-click`, { method: 'POST' })).status,
    ).toBe(204);
    const subscription = await container.db.primaryPool.query<{ status: string }>(
      'SELECT status FROM subscriptions WHERE publication_id=$1 AND id=$2',
      [publicationId.id, subscriptionId],
    );
    expect(subscription.rows[0]?.status).toBe('unsubscribed');
    const logout = await fetch(`${webOrigin}/api/auth/logout`, {
      method: 'POST',
      headers: { origin: webOrigin, cookie: cookie! },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('vichaar_session=;');
    expect(
      (await fetch(`${webOrigin}/api/publications`, { headers: { cookie: cookie! } })).status,
    ).toBe(401);
  }, 90000);
});
