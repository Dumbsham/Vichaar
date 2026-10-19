import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { createHealthService } from '../src/modules/health/index.js';

describe('Health & Readiness Endpoints', () => {
  function createTestServer(dbHealthy: boolean) {
    const healthService = createHealthService({
      healthRepo: {
        pingDatabase: async () => dbHealthy,
      },
    });

    return createServer({
      healthService,
      close: async () => {},
    });
  }

  it('GET /healthz returns 200 with ok status and uptime', async () => {
    const app = createTestServer(true);

    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
    });
    expect(typeof res.body.uptime).toBe('number');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('GET /readyz returns 200 when database ping succeeds', async () => {
    const app = createTestServer(true);

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'connected',
    });
  });

  it('GET /readyz returns 503 when database ping fails', async () => {
    const app = createTestServer(false);

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'unhealthy',
      database: 'disconnected',
    });
  });

  it('GET /api/v1/ping returns 200 pong', async () => {
    const app = createTestServer(true);

    const res = await request(app).get('/api/v1/ping');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'pong' });
  });

  it('Unknown route returns structured 404', async () => {
    const app = createTestServer(true);

    const res = await request(app).get('/unknown-path');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
      },
    });
  });
});
