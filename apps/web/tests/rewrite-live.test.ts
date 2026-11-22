import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';
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
  const container = createContainer({
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar',
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
      }),
    });
    expect(publication.status).toBe(201);
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
