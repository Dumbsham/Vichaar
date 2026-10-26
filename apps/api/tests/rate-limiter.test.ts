import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRateLimiter } from '../src/shared/rate-limiter.js';

describe('auth rate limiting', () => {
  it('uses a smaller bounded local limit when Redis is unavailable', async () => {
    let time = 1_000;
    const limiter = createRateLimiter('redis://127.0.0.1:1', () => time);
    try {
      const key = randomUUID();
      for (let i = 0; i < 5; i++) expect(await limiter.consume(key, 10, 60)).toBe(true);
      expect(await limiter.consume(key, 10, 60)).toBe(false);
      time += 61_000;
      expect(await limiter.consume(key, 10, 60)).toBe(true);
    } finally {
      await limiter.close();
    }
  });

  const redisUrl = process.env.REDIS_TEST_URL;
  it.skipIf(!redisUrl)('shares the Redis limit across API instances', async () => {
    if (!redisUrl) throw new Error('Redis test URL missing');
    const first = createRateLimiter(redisUrl);
    const second = createRateLimiter(redisUrl);
    try {
      const key = randomUUID();
      expect(await first.consume(key, 3, 60)).toBe(true);
      expect(await second.consume(key, 3, 60)).toBe(true);
      expect(await first.consume(key, 3, 60)).toBe(true);
      expect(await second.consume(key, 3, 60)).toBe(false);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
