import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200).trim(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .toLowerCase()
    .trim()
    .regex(slugRegex, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  body: z.string().default(''),
  isPaid: z.boolean().default(false),
  scheduledFor: z.string().datetime().optional().nullable(),
});

export const updatePostSchema = z.object({
  version: z.number().int('Version integer is required for optimistic locking').min(1),
  title: z.string().min(1).max(200).trim().optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .toLowerCase()
    .trim()
    .regex(slugRegex, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  body: z.string().optional(),
  isPaid: z.boolean().optional(),
  scheduledFor: z.string().datetime().optional().nullable(),
});

export const publishPostSchema = z.object({
  sendImmediately: z.boolean().default(false),
});

export const postResponseSchema = z.object({
  id: z.string().uuid(),
  publicationId: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  status: z.enum(['draft', 'scheduled', 'published']),
  version: z.number(),
  isPaid: z.boolean(),
  scheduledFor: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const postDetailResponseSchema = postResponseSchema.extend({
  body: z.string().optional(),
  htmlPreview: z.string().optional(),
  htmlFull: z.string().optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type PublishPostInput = z.infer<typeof publishPostSchema>;
export type PostResponse = z.infer<typeof postResponseSchema>;
export type PostDetailResponse = z.infer<typeof postDetailResponseSchema>;
