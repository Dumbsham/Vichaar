import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { createHealthService } from '../src/modules/health/index.js';

const original = process.env.TRUST_PROXY;
afterEach(() => {
  if (original === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = original;
});

describe('rate limit client address', () => {
  function appWithCapturedIps(ips: string[]) {
    return createServer({
      healthService: createHealthService({ healthRepo: { pingDatabase: async () => true } }),
      rateLimiter: {
        consume: async (ip) => {
          ips.push(ip);
          return true;
        },
        close: async () => {},
      },
      close: async () => {},
    });
  }

  it('ignores a forged forwarded address by default', async () => {
    delete process.env.TRUST_PROXY;
    const ips: string[] = [];
    await request(appWithCapturedIps(ips))
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({});
    expect(ips).toHaveLength(1);
    expect(ips[0]).not.toBe('203.0.113.9');
  });

  it('uses the forwarded address only from an explicitly trusted proxy', async () => {
    process.env.TRUST_PROXY = 'loopback';
    const ips: string[] = [];
    await request(appWithCapturedIps(ips))
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({});
    expect(ips).toEqual(['203.0.113.9']);
  });
});
