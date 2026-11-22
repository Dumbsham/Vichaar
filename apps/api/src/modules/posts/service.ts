import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import type { Clock } from '@vichaar/shared/clock';
import { previewCacheKey, type PreviewCache, type PublicPreview } from './cache-types.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  SendingPausedError,
  VersionConflictError,
} from '@vichaar/shared/errors';
import type { CreatePostInput, UpdatePostInput, PublishPostInput } from '@vichaar/shared/schemas';
import type { PublicationService } from '../publications/index.js';
import type { PostRepository, PostRow } from './repository.js';
import { z } from 'zod';

const publicCursorSchema = z.object({ publishedAt: z.string().datetime(), id: z.string().uuid() });

function decodePublicCursor(
  cursor: string | undefined,
): { publishedAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new AppError('Invalid page cursor', 422, 'VALIDATION_FAILED');
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('Invalid page cursor', 422, 'VALIDATION_FAILED');
  }
  const parsed = publicCursorSchema.safeParse(decoded);
  if (!parsed.success) throw new AppError('Invalid page cursor', 422, 'VALIDATION_FAILED');
  return { publishedAt: new Date(parsed.data.publishedAt), id: parsed.data.id };
}

function excerptFromPreview(html: string): string {
  const spaced = html.replace(/<\s*\/?\s*(?:p|br|h[1-3]|li|blockquote|ul|ol)\b[^>]*>/gi, ' ');
  const escaped = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  const plain = escaped.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, code: string) => {
      if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? match;
      const hex = code[1]?.toLowerCase() === 'x';
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff &&
        !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value)
        : '';
    },
  );
  return [...plain].slice(0, 240).join('').replace(/\s+/gu, ' ').trim();
}

export function slugFromTitle(title: string): string {
  const words =
    title
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
  let slug = '';
  for (const character of words.join('-')) {
    if (slug.length + character.length > 100) break;
    slug += character;
  }
  return slug.replace(/-+$/, '') || `post-${randomUUID().slice(0, 8)}`;
}
function postView(row: PostRow) {
  return {
    id: row.id,
    publicationId: row.publication_id,
    slug: row.slug,
    title: row.title,
    language: row.language,
    status: row.status,
    version: row.version,
    isPaid: row.access === 'paid',
    scheduledFor: row.scheduled_for?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
function sanitizeBody(raw: string): { html: string; links: string[] } {
  const links = new Set<string>();
  const html = sanitizeHtml(raw, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'b',
      'i',
      'u',
      'blockquote',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'a',
      'code',
      'pre',
    ],
    allowedAttributes: { a: ['href', 'title', 'rel'] },
    allowedSchemes: ['http', 'https'],
    transformTags: {
      a: (_tag, attrs) => {
        const href = attrs.href;
        if (href && /^https?:\/\//i.test(href)) links.add(href);
        return {
          tagName: 'a',
          attribs: {
            ...(href && /^https?:\/\//i.test(href) ? { href } : {}),
            rel: 'noopener noreferrer nofollow',
          },
        };
      },
    },
  });
  return { html, links: [...links] };
}
function weekStartIST(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  const shift = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - shift);
  return day.toISOString().slice(0, 10);
}
export interface PostService {
  create(
    publicationId: string,
    ownerId: string,
    input: CreatePostInput,
  ): Promise<ReturnType<typeof postView>>;
  get(publicationId: string, ownerId: string, postId: string): Promise<object>;
  list(
    publicationId: string,
    ownerId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<object>;
  update(
    publicationId: string,
    ownerId: string,
    postId: string,
    input: UpdatePostInput,
  ): Promise<ReturnType<typeof postView>>;
  unpublish(
    publicationId: string,
    ownerId: string,
    postId: string,
    correlationId: string,
  ): Promise<ReturnType<typeof postView>>;
  publish(
    publicationId: string,
    ownerId: string,
    postId: string,
    input: PublishPostInput,
    correlationId: string,
  ): Promise<ReturnType<typeof postView>>;
  publicPreview(subdomain: string, slug: string): Promise<PublicPreview>;
  listPublic(subdomain: string, cursor: string | undefined, limit: number): Promise<{
    items: { id: string; slug: string; title: string; language: string; isPaid: boolean; publishedAt: string; excerpt: string }[];
    nextCursor: string | null;
    hasMore: boolean;
  }>;
  publicFull(subdomain: string, slug: string, userId?: string): Promise<{ htmlFull: string }>;
}
export function createPostService({
  postRepo,
  publicationService,
  clock,
  previewCache,
  entitlement,
}: {
  postRepo: PostRepository;
  publicationService: PublicationService;
  clock: Clock;
  previewCache: PreviewCache;
  entitlement?: { isEntitled(publicationId: string, userId: string): Promise<boolean> };
}): PostService {
  return {
    async create(publicationId, ownerId, input) {
      const publication = await publicationService.getOwned(publicationId, ownerId);
      const row = await postRepo.create(
        publicationId,
        input,
        input.slug ?? slugFromTitle(input.title),
        input.language ?? publication.language,
      );
      if (!row) throw new ConflictError('Post slug already exists');
      return postView(row);
    },
    async get(publicationId, ownerId, postId) {
      await publicationService.getOwned(publicationId, ownerId);
      const row = await postRepo.find(publicationId, postId);
      if (!row) throw new NotFoundError();
      return { ...postView(row), body: row.body_json?.html ?? '' };
    },
    async list(publicationId, ownerId, cursor, limit) {
      await publicationService.getOwned(publicationId, ownerId);
      const rows = await postRepo.list(publicationId, cursor, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        items: page.map(postView),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
        hasMore,
      };
    },
    async update(publicationId, ownerId, postId, input) {
      const publication = await publicationService.getOwned(publicationId, ownerId);
      const row = await postRepo.update(publicationId, postId, input);
      if (!row) {
        const existing = await postRepo.find(publicationId, postId);
        if (!existing) throw new NotFoundError();
        throw new VersionConflictError();
      }
      await previewCache.invalidate(previewCacheKey(publication.subdomain, row.slug));
      return postView(row);
    },
    async unpublish(publicationId, ownerId, postId, correlationId) {
      const publication = await publicationService.getOwned(publicationId, ownerId);
      const row = await postRepo.unpublish(publicationId, postId, correlationId);
      if (!row) throw new NotFoundError();
      await previewCache.invalidate(previewCacheKey(publication.subdomain, row.slug));
      return postView(row);
    },
    async publish(publicationId, ownerId, postId, input, correlationId) {
      const publication = await publicationService.getOwned(publicationId, ownerId);
      const draft = await postRepo.find(publicationId, postId);
      if (!draft) throw new NotFoundError();
      if (draft.status !== 'draft') return postView(draft);
      if (publication.sendingStatus !== 'active') throw new SendingPausedError();
      const { html, links } = sanitizeBody(draft.body_json?.html ?? '');
      const plain = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
      const firstParagraph = html.match(/<p>(.*?)<\/p>/is)?.[1] ?? plain.slice(0, 300);
      const preview =
        draft.access === 'paid'
          ? sanitizeHtml(firstParagraph, { allowedTags: [], allowedAttributes: {} })
          : html;
      const now = clock.now();
      const result = await postRepo.publish({
        publicationId,
        postId,
        expectedVersion: draft.version,
        htmlFull: html,
        htmlPreview: preview,
        links,
        sendImmediately: input.sendImmediately,
        scheduledFor: draft.scheduled_for,
        now,
        weekStart: weekStartIST(now),
        correlationId,
      });
      if (!result) throw new VersionConflictError();
      await previewCache.invalidate(previewCacheKey(publication.subdomain, result.row.slug));
      return postView(result.row);
    },
    async publicFull(subdomain, slug, userId) {
      const publication = await publicationService.getBySubdomain(subdomain);
      const publicRow = await postRepo.findPublic(publication.id, slug);
      if (!publicRow) throw new NotFoundError();
      if (publicRow.access === 'paid') {
        if (!userId) throw new AppError('Login required', 401, 'UNAUTHORIZED');
        if (!entitlement)
          throw new AppError('Paid access is not available yet', 503, 'ENTITLEMENT_UNAVAILABLE');
        if (!(await entitlement.isEntitled(publication.id, userId)))
          throw new AppError('Paid subscription required', 403, 'FORBIDDEN');
      }
      const row = await postRepo.find(publication.id, publicRow.id);
      if (!row || row.status !== 'published') throw new NotFoundError();
      return { htmlFull: row.html_full ?? '' };
    },
    async publicPreview(subdomain, slug) {
      return previewCache.getOrLoad(previewCacheKey(subdomain, slug), async () => {
        const publication = await publicationService.getBySubdomain(subdomain);
        const row = await postRepo.findPublic(publication.id, slug);
        if (!row) throw new NotFoundError();
        return { ...postView(row), status: 'published', htmlPreview: row.html_preview ?? '' };
      });
    },
    async listPublic(subdomain, cursor, limit) {
      const publication = await publicationService.getBySubdomain(subdomain);
      const rows = await postRepo.listPublic(publication.id, decodePublicCursor(cursor), limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          language: row.language,
          isPaid: row.access === 'paid',
          publishedAt: row.published_at.toISOString(),
          excerpt: excerptFromPreview(row.html_preview),
        })),
        nextCursor: hasMore && last
          ? Buffer.from(JSON.stringify({ publishedAt: last.published_at.toISOString(), id: last.id })).toString('base64url')
          : null,
        hasMore,
      };
    },
  };
}
