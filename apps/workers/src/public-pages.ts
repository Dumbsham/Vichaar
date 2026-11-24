import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Pool } from '@vichaar/db';
import type { PageMessage, Queue } from '@vichaar/queue';
import { z } from 'zod';
import { withSpan } from './tracing.js';

const routeSchema = z.object({
  subdomain: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.string(),
});
const purgeResponse = z.object({ success: z.boolean() });
type PublicRoute = z.infer<typeof routeSchema>;

export interface PublicPageRepository {
  route(publicationId: string, postId: string): Promise<PublicRoute | null>;
}
export interface PublicPageStore {
  write(path: string, html: string): Promise<void>;
  remove(path: string): Promise<void>;
}
export interface PublicPageFetcher {
  get(path: string): Promise<string>;
}
export interface PublicCachePurger {
  purge(paths: string[]): Promise<void>;
}

export function createPublicPageRepository(pool: Pool): PublicPageRepository {
  return {
    async route(publicationId, postId) {
      const result = await pool.query<PublicRoute>(
        `SELECT p.subdomain,s.slug,s.status FROM posts s
         JOIN publications p ON p.id=s.publication_id
         WHERE s.publication_id=$1 AND s.id=$2`,
        [publicationId, postId],
      );
      return result.rows[0] ? routeSchema.parse(result.rows[0]) : null;
    },
  };
}

export function createLocalPublicPageStore(directory: string): PublicPageStore {
  return {
    async write(path, html) {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, html, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async remove(path) {
      await rm(join(directory, path), { force: true });
    },
  };
}

export function createPublicPageFetcher(origin: string): PublicPageFetcher {
  const base = new URL(origin).origin;
  return {
    async get(path) {
      const response = await fetch(`${base}${path}`, {
        headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/html'))
        throw new Error('Public page render failed');
      if (!response.body) throw new Error('Public page render has no body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2_000_000) throw new Error('Public page render is too large');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const html = Buffer.concat(chunks).toString('utf8');
      if (!html.startsWith('<!DOCTYPE html>'))
        throw new Error('Public page render was invalid or too large');
      return html;
    },
  };
}

export function createCloudflarePurger(config: {
  baseUrl: string;
  zoneId?: string;
  apiToken?: string;
  request?: typeof fetch;
}): PublicCachePurger {
  if (Boolean(config.zoneId) !== Boolean(config.apiToken))
    throw new Error('Cloudflare zone and API token must be configured together');
  const base = new URL(config.baseUrl);
  if (base.pathname !== '/' || base.search || base.hash)
    throw new Error('Public base URL must be an origin');
  return {
    async purge(paths) {
      if (!config.zoneId || !config.apiToken) return;
      const files = paths.map((path) => new URL(path, base).toString());
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await (config.request ?? fetch)(
            `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}/purge_cache`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${config.apiToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ files }),
              signal: AbortSignal.timeout(5000),
            },
          );
          const parsed = purgeResponse.safeParse(await response.json());
          if (!response.ok || !parsed.success || !parsed.data.success)
            throw new Error('CDN purge was rejected');
          return;
        } catch {
          if (attempt === 2) throw new Error('CDN purge failed after retries');
          await new Promise<void>((resolve) =>
            setTimeout(resolve, 150 * 2 ** attempt + Math.floor(Math.random() * 100)),
          );
        }
      }
    },
  };
}

export function createPublicPagePipeline(deps: {
  pages: Queue<PageMessage>;
  repository: PublicPageRepository;
  store: PublicPageStore;
  fetcher: PublicPageFetcher;
  purger: PublicCachePurger;
}) {
  return {
    async consumeOnce(): Promise<number> {
      const messages = await deps.pages.receive();
      for (const message of messages) {
        await withSpan('worker.public_page', message.body.correlationId, async () => {
          const route = await deps.repository.route(
            message.body.publicationId,
            message.body.postId,
          );
          if (!route) throw new Error('Public page route is missing');
          const indexPath = `/p/${route.subdomain}`;
          const postPath = `${indexPath}/${route.slug}`;
          const indexFile = `p/${route.subdomain}/index.html`;
          const postFile = `p/${route.subdomain}/${route.slug}/index.html`;
          const indexHtml = await withSpan(
            'web.render_public_index',
            message.body.correlationId,
            () => deps.fetcher.get(indexPath),
          );
          const latest = await deps.repository.route(
            message.body.publicationId,
            message.body.postId,
          );
          if (!latest) throw new Error('Public page route disappeared');
          if (latest.status === 'published') {
            const postHtml = await withSpan(
              'web.render_public_post',
              message.body.correlationId,
              () => deps.fetcher.get(postPath),
            );
            await deps.store.write(postFile, postHtml);
          } else {
            await deps.store.remove(postFile);
          }
          await deps.store.write(indexFile, indexHtml);
          await withSpan('cdn.purge_public_pages', message.body.correlationId, () =>
            deps.purger.purge([indexPath, postPath]),
          );
          await deps.pages.delete(message.receipt);
        });
      }
      return messages.length;
    },
  };
}
