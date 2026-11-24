import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSqsQueues } from '@vichaar/queue';
import { ensureLocalDevQueues } from '../src/dev-queues.js';

describe('local worker queue setup', () => {
  it('rejects partial names before touching the shared default queues', async () => {
    const partial = createSqsQueues({
      endpoint: 'http://localhost:9324',
      baseUrl: 'http://localhost:9324/queue',
      region: 'us-east-1',
      tracksName: `isolated-tracks-${randomUUID().slice(0, 8)}`,
    });
    try {
      await expect(partial.createLocalQueues()).rejects.toThrow('explicit event, send, and hook names');
    } finally {
      partial.close();
    }
  });
  it('creates all five queues before workers start', async () => {
    process.env.AWS_ACCESS_KEY_ID ??= 'test';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
    const suffix = randomUUID().slice(0, 8);
    const config = {
      endpoint: 'http://localhost:9324',
      baseUrl: 'http://localhost:9324/queue',
      region: 'us-east-1',
      eventsName: `dev-events-${suffix}`,
      sendsName: `dev-sends-${suffix}`,
      hooksName: `dev-hooks-${suffix}`,
      tracksName: `dev-tracks-${suffix}`,
      pagesName: `dev-pages-${suffix}`,
    };
    const probe = createSqsQueues(config);
    try {
      await ensureLocalDevQueues(config);
      expect(
        await Promise.all([
          probe.events.depth(),
          probe.sends.depth(),
          probe.hooks.depth(),
          probe.tracks.depth(),
          probe.pages.depth(),
        ]),
      ).toEqual([0, 0, 0, 0, 0]);
    } finally {
      await probe.deleteLocalQueues();
      probe.close();
    }
  });
});
