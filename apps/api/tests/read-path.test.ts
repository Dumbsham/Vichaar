import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPreviewCache, previewCacheKey } from '../src/shared/cache.js';
import { createPublicPostRouter } from '../src/modules/posts/index.js';
import type { PublicPreview } from '../src/shared/cache.js';

const preview: PublicPreview = {
  id: '11111111-1111-4111-8111-111111111111',
  publicationId: '22222222-2222-4222-8222-222222222222',
  slug: 'hello', language: 'en', title: 'Hello', status: 'published', version: 3,
  isPaid: true, scheduledFor: null, publishedAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  htmlPreview: '<p>Preview</p>',
};

describe('Phase 3 public read path', () => {
  it('shares simultaneous misses even when Redis is down', async () => {
    const cache = createPreviewCache('redis://127.0.0.1:1');
    let loads = 0;
    const load = async () => { loads++; return preview; };
    const results = await Promise.all(Array.from({ length: 10 }, () => cache.getOrLoad(previewCacheKey('demo', 'hello'), load)));
    expect(loads).toBe(1);
    expect(results).toEqual(Array(10).fill(preview));
    await cache.close();
  });

  it('sends public cache headers and never exposes paid full body', async () => {
    const app = express();
    app.use('/public/:subdomain', createPublicPostRouter({ postService: { publicPreview: async () => preview, publicFull: async () => ({ htmlFull: '' }) } }));
    const response = await request(app).get('/public/demo/posts/hello');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(response.headers.etag).toBe('"11111111-1111-4111-8111-111111111111-3"');
    expect(response.body.htmlFull).toBeUndefined();
    const full = await request(app).get('/public/demo/posts/hello/full');
    expect(full.headers['cache-control']).toBe('private, no-store');
  });
});
