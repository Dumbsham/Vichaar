import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { AppError, NotFoundError } from '@vichaar/shared/errors';
import type { PublicationService } from '../publications/index.js';
import type { QuoteCardRepository } from './repository.js';
import type { ObjectStorage } from './storage.js';
import type { QuoteRenderer } from './render.js';

export function normalizeQuote(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
function plainText(html: string): string {
  return normalizeQuote(
    sanitizeHtml(html.replace(/<[^>]*>/g, ' '), { allowedTags: [], allowedAttributes: {} }),
  );
}

export interface QuoteCardService {
  create(
    subdomain: string,
    slug: string,
    quote: string,
    userId?: string,
  ): Promise<{ url: string; cached: boolean }>;
  image(subdomain: string, slug: string, hash: string): Promise<Buffer>;
  stats(): {
    rendered: number;
    failures: number;
    rejected: number;
    renderDurationMsTotal: number;
    cacheHits: number;
    invalidQuotes: number;
  };
}

export function createQuoteCardService(deps: {
  publicationService: PublicationService;
  repository: QuoteCardRepository;
  storage: ObjectStorage;
  renderer: QuoteRenderer;
  entitlement?: { isEntitled(publicationId: string, userId: string): Promise<boolean> };
}): QuoteCardService {
  let cacheHits = 0;
  let invalidQuotes = 0;
  return {
    async create(subdomain, slug, rawQuote, userId) {
      const publication = await deps.publicationService.getBySubdomain(subdomain);
      const post = await deps.repository.findPost(publication.id, slug);
      if (!post) throw new NotFoundError();
      const quote = normalizeQuote(rawQuote);
      if (!quote || [...quote].length > 200)
        throw new AppError('Quote must contain 1 to 200 characters', 422, 'INVALID_QUOTE');
      const entitled =
        post.access === 'free' ||
        (userId !== undefined &&
          deps.entitlement !== undefined &&
          (await deps.entitlement.isEntitled(publication.id, userId)));
      const allowedText = plainText(entitled ? post.html_full : post.html_preview);
      if (!allowedText.includes(quote)) {
        invalidQuotes++;
        throw new AppError('Quote does not appear in this post', 422, 'QUOTE_NOT_IN_POST');
      }
      const hash = createHash('sha256').update(`${post.id}\0${quote}\0v1`).digest('hex');
      const url = `/public/${subdomain}/posts/${slug}/quote-cards/${hash}.png`;
      const cached = await deps.repository.findCard(publication.id, post.id, hash);
      if (cached && (await deps.storage.get(cached))) {
        cacheHits++;
        return { url, cached: true };
      }
      const png = await deps.renderer.render(quote, post.title, post.language);
      const key = `cards/${hash}.png`;
      await deps.storage.put(key, png);
      if (!(await deps.repository.putCard(publication.id, post.id, hash, key))) {
        await deps.storage.delete(key);
        throw new NotFoundError();
      }
      return { url, cached: false };
    },
    async image(subdomain, slug, hash) {
      const publication = await deps.publicationService.getBySubdomain(subdomain);
      const key = await deps.repository.findLiveCard(publication.id, slug, hash);
      if (!key) throw new NotFoundError();
      const png = await deps.storage.get(key);
      if (!png) throw new NotFoundError();
      return png;
    },
    stats: () => ({ ...deps.renderer.stats(), cacheHits, invalidQuotes }),
  };
}
