import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { signTrackingToken } from '@vichaar/shared';
import { createTrackingRouter, createTrackingService } from '../src/modules/tracking/index.js';

const secret = 'test_tracking_secret_at_least_32_characters';
const ids = {
  publicationId: '11111111-1111-4111-8111-111111111111',
  postId: '22222222-2222-4222-8222-222222222222',
  subscriptionId: '33333333-3333-4333-8333-333333333333',
};
describe('tracking routes', () => {
  it('serves pixels and redirects to stored targets while recording events', async () => {
    const sent: unknown[] = [];
    const service = createTrackingService({
      secret,
      now: () => new Date('2026-01-01T00:00:00Z'),
      repo: { findTarget: async () => 'https://example.com/article' },
      queue: {
        send: async (message) => {
          sent.push(message);
        },
        receive: async () => [],
        delete: async () => {},
        depth: async () => 0,
      },
    });
    const app = express().use('/t', createTrackingRouter(service));
    const open = signTrackingToken(secret, { ...ids, linkId: null, kind: 'open', exp: 1800000000 });
    const click = signTrackingToken(secret, {
      ...ids,
      linkId: '44444444-4444-4444-8444-444444444444',
      kind: 'click',
      exp: 1800000000,
    });
    expect((await request(app).get(`/t/o/${open}.gif`)).status).toBe(200);
    const redirect = await request(app).get(`/t/c/${click}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe('https://example.com/article');
    await service.flush();
    expect(sent).toHaveLength(1);
  });
});
