import { describe, expect, it } from 'vitest';
import type { PageMessage, Queue } from '@vichaar/queue';
import { createCloudflarePurger, createPublicPagePipeline } from '../src/public-pages.js';

const published: PageMessage = {
  type: 'PostPublished',
  eventId: 1,
  publicationId: '00000000-0000-4000-8000-000000000001',
  postId: '00000000-0000-4000-8000-000000000002',
  correlationId: 'public-page-test',
};
const unpublished: PageMessage = { ...published, type: 'PostUnpublished' };

describe('public HTML event replay', () => {
  it('writes only anonymous HTML, then removes the post on unpublish and stale replay', async () => {
    const files = new Map<string, string>();
    const purges: string[][] = [];
    const messages: PageMessage[] = [published, published, unpublished, published];
    let status = 'published';
    const queue: Queue<PageMessage> = {
      async send() {},
      async receive() {
        const next = messages.shift();
        return next ? [{ body: next, receipt: String(next.eventId) }] : [];
      },
      async delete() {},
      async depth() {
        return messages.length;
      },
    };
    const pipeline = createPublicPagePipeline({
      pages: queue,
      repository: {
        async route() {
          return { subdomain: 'letters', slug: 'first-post', status };
        },
      },
      fetcher: {
        async get(path) {
          return path.endsWith('first-post')
            ? '<!DOCTYPE html><p>Visible preview</p>'
            : '<!DOCTYPE html><p>Published list</p>';
        },
      },
      store: {
        async write(path, html) {
          files.set(path, html);
        },
        async remove(path) {
          files.delete(path);
        },
      },
      purger: {
        async purge(paths) {
          purges.push(paths);
        },
      },
    });
    expect(await pipeline.consumeOnce()).toBe(1);
    expect(await pipeline.consumeOnce()).toBe(1);
    expect(files.get('p/letters/first-post/index.html')).toContain('Visible preview');
    status = 'unpublished';
    expect(await pipeline.consumeOnce()).toBe(1);
    expect(files.has('p/letters/first-post/index.html')).toBe(false);
    expect(await pipeline.consumeOnce()).toBe(1);
    expect(files.has('p/letters/first-post/index.html')).toBe(false);
    expect(purges).toEqual(
      Array.from({ length: 4 }, () => ['/p/letters', '/p/letters/first-post']),
    );
  });
});

describe('narrow CDN purge', () => {
  it('sends only the changed publication and post URLs', async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const purger = createCloudflarePurger({
      baseUrl: 'https://vichaar.example',
      zoneId: 'test-zone',
      apiToken: 'test-token',
      async request(input, options) {
        calls.push({ url: String(input), options: options ?? {} });
        return Response.json({ success: true });
      },
    });
    await purger.purge(['/p/letters', '/p/letters/first-post']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/zones/test-zone/purge_cache');
    expect(JSON.parse(String(calls[0]?.options.body))).toEqual({
      files: ['https://vichaar.example/p/letters', 'https://vichaar.example/p/letters/first-post'],
    });
    expect(calls[0]?.options.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });
});
