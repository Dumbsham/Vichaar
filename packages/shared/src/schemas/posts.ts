import { z } from 'zod';

const slugRegex = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:-[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u;

export const postSlugSchema = z
  .string()
  .min(1)
  .max(100)
  .toLowerCase()
  .trim()
  .regex(slugRegex, 'Slug must contain letters, numbers, and hyphens');

export const createPostSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200)
    .regex(/^[^\r\n]*$/, 'Title cannot contain line breaks')
    .trim(),
  slug: postSlugSchema.optional(),
  body: z.string().default(''),
  language: z.string().min(2).max(10).optional(),
  isPaid: z.boolean().default(false),
  scheduledFor: z.string().datetime().optional().nullable(),
});

export const updatePostSchema = z.object({
  version: z.number().int('Version integer is required for optimistic locking').min(1),
  title: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\r\n]*$/, 'Title cannot contain line breaks')
    .trim()
    .optional(),
  slug: postSlugSchema.optional(),
  body: z.string().optional(),
  language: z.string().min(2).max(10).optional(),
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
  language: z.string().min(2).max(10).optional(),
  htmlPreview: z.string().optional(),
  htmlFull: z.string().optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type PublishPostInput = z.infer<typeof publishPostSchema>;
export type PostResponse = z.infer<typeof postResponseSchema>;
export type PostDetailResponse = z.infer<typeof postDetailResponseSchema>;
