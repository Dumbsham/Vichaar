import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { z } from 'zod';
import { withExternalSpan } from './tracing.js';

const previewSchema = z.object({
  id: z.string().uuid(), publicationId: z.string().uuid(), slug: z.string(), language: z.string(),
  title: z.string(), status: z.literal('published'), version: z.number(), isPaid: z.boolean(),
  scheduledFor: z.string().nullable(), publishedAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(), htmlPreview: z.string(),
});
export type PublicPreview = z.infer<typeof previewSchema>;
const entrySchema = z.object({ value: previewSchema, freshUntil: z.number() });
export interface PreviewCache {
  getOrLoad(key: string, load: () => Promise<PublicPreview>): Promise<PublicPreview>;
  invalidate(key: string): Promise<void>;
  stats(): { hits: number; misses: number; redisErrors: number };
  close(): Promise<void>;
}
function bounded<T>(promise: Promise<T>, ms = 300): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Cache timeout')), ms);
  })]).finally(() => clearTimeout(timer));
}
export function previewCacheKey(subdomain: string, slug: string): string {
  return `post-preview:${subdomain}:${slug}`;
}
export function createPreviewCache(redisUrl: string, now: () => number = Date.now): PreviewCache {
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 200, reconnectStrategy: false }, disableOfflineQueue: true });
  client.on('error', () => {});
  const pending = new Map<string, Promise<PublicPreview>>();
  let disabledUntil = 0;
  const counters = { hits: 0, misses: 0, redisErrors: 0 };
  async function redis() {
    if (now() < disabledUntil) throw new Error('Cache circuit open');
    try {
      if (!client.isOpen) await bounded(client.connect());
      return client;
    } catch (error) {
      disabledUntil = now() + 5_000;
      if (client.isOpen) client.destroy();
      throw error;
    }
  }
  async function read(key: string): Promise<z.infer<typeof entrySchema> | null> {
    try {
      const raw = await withExternalSpan('redis.preview.get', async () => bounded((await redis()).get(key)));
      return raw ? entrySchema.parse(JSON.parse(raw)) : null;
    } catch { counters.redisErrors++; return null; }
  }
  async function loadAndCache(key: string, load: () => Promise<PublicPreview>): Promise<PublicPreview> {
    const stale = await read(key);
    if (stale && stale.freshUntil > now()) { counters.hits++; return stale.value; }
    counters.misses++;
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    let ownsLock = false;
    try { ownsLock = (await withExternalSpan('redis.preview.lock', async () => bounded((await redis()).set(lockKey, token, { NX: true, PX: 2000 })))) === 'OK'; }
    catch { /* Database fallback when Redis is unavailable. */ }
    if (!ownsLock && stale) return stale.value;
    if (!ownsLock) {
      for (let attempt = 0; attempt < 4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const other = await read(key);
        if (other) return other.value;
      }
    }
    try {
      const value = previewSchema.parse(await load());
      try {
        const ttl = 60 + Math.floor(Math.random() * 15);
        await withExternalSpan('redis.preview.set', async () => bounded((await redis()).set(key, JSON.stringify({ value, freshUntil: now() + ttl * 1000 }), { EX: ttl + 300 })));
      } catch { /* Cache failure must not break public reads. */ }
      return value;
    } finally {
      if (ownsLock) {
        try {
          await withExternalSpan('redis.preview.unlock', async () => bounded((await redis()).eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", { keys: [lockKey], arguments: [token] })));
        } catch { /* Lock expires automatically. */ }
      }
    }
  }
  return {
    getOrLoad(key, load) {
      const existing = pending.get(key);
      if (existing) return existing;
      const work = loadAndCache(key, load).finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    },
    async invalidate(key) {
      try { await withExternalSpan('redis.preview.invalidate', async () => bounded((await redis()).del(key))); } catch { /* TTL bounds stale content during Redis outage. */ }
    },
    stats() { return { ...counters }; },
    async close() { if (client.isOpen) client.destroy(); },
  };
}
