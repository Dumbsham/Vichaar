import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import type { Clock } from '@vichaar/shared/clock';
import {
  ConflictError,
  NotFoundError,
  SendingPausedError,
  VersionConflictError,
} from '@vichaar/shared/errors';
import type { CreatePostInput, UpdatePostInput, PublishPostInput } from '@vichaar/shared/schemas';
import type { PublicationService } from '../publications/index.js';
import type { PostRepository, PostRow } from './repository.js';

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
  publish(
    publicationId: string,
    ownerId: string,
    postId: string,
    input: PublishPostInput,
  ): Promise<ReturnType<typeof postView>>;
  publicPreview(subdomain: string, slug: string): Promise<object>;
}
export function createPostService({
  postRepo,
  publicationService,
  clock,
}: {
  postRepo: PostRepository;
  publicationService: PublicationService;
  clock: Clock;
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
      await publicationService.getOwned(publicationId, ownerId);
      const row = await postRepo.update(publicationId, postId, input);
      if (!row) {
        const existing = await postRepo.find(publicationId, postId);
        if (!existing) throw new NotFoundError();
        throw new VersionConflictError();
      }
      return postView(row);
    },
    async publish(publicationId, ownerId, postId, input) {
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
      });
      if (!result) throw new VersionConflictError();
      return postView(result.row);
    },
    async publicPreview(subdomain, slug) {
      const publication = await publicationService.getBySubdomain(subdomain);
      const row = await postRepo.findPublic(publication.id, slug);
      if (!row) throw new NotFoundError();
      return { ...postView(row), htmlPreview: row.html_preview ?? '' };
    },
  };
}
