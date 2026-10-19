import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { createContainer } from '../src/container.js';

describe('Live Health & Readiness Integration', () => {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
  const container = createContainer({ databaseUrl });
  const app = createServer(container);

  afterAll(async () => {
    await container.close();
  });

  it('GET /readyz connects to real PostgreSQL container and returns 200 ok', async () => {
    const res = await request(app).get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'connected',
    });
  });

  it('GET /healthz returns 200 ok with correlation ID', async () => {
    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });
});
