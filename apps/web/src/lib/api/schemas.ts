import { z } from 'zod';

export const publicPublicationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  subdomain: z.string(),
  description: z.string().nullable(),
  language: z.string(),
  monthlyPricePaise: z.number().int().nonnegative(),
});

export const publicPostListItemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  language: z.string(),
  isPaid: z.boolean(),
  publishedAt: z.string().datetime(),
  excerpt: z.string(),
});

export const publicPostListSchema = z.object({
  items: z.array(publicPostListItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const publicPostPreviewSchema = z.object({
  id: z.string().uuid(),
  publicationId: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  language: z.string(),
  isPaid: z.boolean(),
  publishedAt: z.string().datetime().nullable(),
  htmlPreview: z.string(),
});

export type PublicPublication = z.infer<typeof publicPublicationSchema>;
export type PublicPostList = z.infer<typeof publicPostListSchema>;
export type PublicPostPreview = z.infer<typeof publicPostPreviewSchema>;
