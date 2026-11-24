import { z } from 'zod';
import { apiRequest } from './browser';

const publication = z.object({
  id: z.string().uuid(),
  name: z.string(),
  subdomain: z.string(),
  description: z.string().nullable(),
  language: z.string(),
  monthlyPricePaise: z.number().int().nonnegative(),
  subscriberCount: z.number().int().nonnegative(),
  sendingStatus: z.enum(['active', 'paused']),
  createdAt: z.string(),
});
const publications = z.object({
  items: z.array(publication),
  nextCursor: z.string().uuid().nullable(),
  hasMore: z.boolean(),
});
const reader = z.object({
  id: z.string().uuid(),
  email: z.email(),
  slot: z.enum(['morning', 'afternoon', 'evening']),
  timezone: z.string(),
  joinedAt: z.string(),
});
const readers = z.object({
  items: z.array(reader),
  nextCursor: z.string().uuid().nullable(),
  hasMore: z.boolean(),
});
const milestones = z.object({
  milestones: z.array(
    z.object({ kind: z.string(), threshold: z.number().int(), createdAt: z.string() }),
  ),
  streak: z.object({
    currentWeeks: z.number().int(),
    longestWeeks: z.number().int(),
    lastPostWeek: z.string().nullable(),
  }),
});
const stats = z.object({
  data: z.array(
    z.object({
      post_id: z.string().uuid(),
      day: z.string(),
      event_type: z.enum(['open', 'click']),
      events: z.number().int().nonnegative(),
    }),
  ),
});
const posts = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      publicationId: z.string().uuid(),
      slug: z.string(),
      title: z.string(),
      status: z.enum(['draft', 'scheduled', 'published', 'unpublished']),
      version: z.number().int(),
      isPaid: z.boolean(),
      scheduledFor: z.string().nullable(),
      publishedAt: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  nextCursor: z.string().uuid().nullable(),
  hasMore: z.boolean(),
});
const post = posts.shape.items.element;
const postDetail = post.extend({ body: z.string(), language: z.string() });

export type Publication = z.infer<typeof publication>;
export type Reader = z.infer<typeof reader>;
export type AnalyticsStat = z.infer<typeof stats>['data'][number];
export type WriterPost = z.infer<typeof post>;
export type WriterPostDetail = z.infer<typeof postDetail>;

export const writerApi = {
  listPublications: (cursor?: string) =>
    apiRequest(
      `/publications?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      publications,
    ),
  getPublication: (id: string) =>
    apiRequest(`/publications/${encodeURIComponent(id)}`, publication),
  createPublication: (input: {
    name: string;
    subdomain: string;
    description?: string;
    language: string;
    monthlyPricePaise: number;
  }) => apiRequest('/publications', publication, { method: 'POST', body: input }),
  updatePublication: (
    id: string,
    input: { name: string; description: string; language: string; monthlyPricePaise: number },
  ) =>
    apiRequest(`/publications/${encodeURIComponent(id)}`, publication, {
      method: 'PATCH',
      body: input,
    }),
  listReaders: (id: string, cursor?: string) =>
    apiRequest(
      `/publications/${encodeURIComponent(id)}/readers?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      readers,
    ),
  getMilestones: (id: string) =>
    apiRequest(`/publications/${encodeURIComponent(id)}/milestones`, milestones),
  getStats: (id: string) => apiRequest(`/publications/${encodeURIComponent(id)}/stats`, stats),
  listPosts: (id: string, cursor?: string) =>
    apiRequest(
      `/publications/${encodeURIComponent(id)}/posts?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      posts,
    ),
  getPost: (id: string, postId: string) =>
    apiRequest(
      `/publications/${encodeURIComponent(id)}/posts/${encodeURIComponent(postId)}`,
      postDetail,
    ),
  createPost: (
    id: string,
    input: { title: string; body: string; language: string; isPaid: boolean },
  ) =>
    apiRequest(`/publications/${encodeURIComponent(id)}/posts`, post, {
      method: 'POST',
      body: input,
    }),
  updatePost: (
    id: string,
    postId: string,
    input: {
      version: number;
      title: string;
      body: string;
      language: string;
      isPaid: boolean;
      scheduledFor: string | null;
    },
  ) =>
    apiRequest(
      `/publications/${encodeURIComponent(id)}/posts/${encodeURIComponent(postId)}`,
      post,
      {
        method: 'PATCH',
        body: input,
      },
    ),
  publishPost: (id: string, postId: string, sendImmediately: boolean) =>
    apiRequest(
      `/publications/${encodeURIComponent(id)}/posts/${encodeURIComponent(postId)}/publish`,
      post,
      {
        method: 'POST',
        body: { sendImmediately },
      },
    ),
  unpublishPost: (id: string, postId: string) =>
    apiRequest(
      `/publications/${encodeURIComponent(id)}/posts/${encodeURIComponent(postId)}/unpublish`,
      post,
      {
        method: 'POST',
        body: {},
      },
    ),
};
