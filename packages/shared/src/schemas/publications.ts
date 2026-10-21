import { z } from 'zod';

const subdomainRegex = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

export const createPublicationSchema = z.object({
  name: z.string().min(1, 'Publication name is required').max(100).trim(),
  subdomain: z
    .string()
    .min(3, 'Subdomain must be at least 3 characters')
    .max(30, 'Subdomain cannot exceed 30 characters')
    .toLowerCase()
    .trim()
    .regex(subdomainRegex, 'Subdomain can only contain lowercase letters, numbers, and hyphens (cannot start or end with hyphen)'),
  description: z.string().max(500).optional(),
  monthlyPricePaise: z.number().int('Price must be an integer in paise').min(0, 'Price cannot be negative').default(0),
  language: z.string().min(2).max(10).default('en'),
});

export const updatePublicationSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).optional(),
  monthlyPricePaise: z.number().int().min(0).optional(),
  language: z.string().min(2).max(10).optional(),
});

export const publicationResponseSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string(),
  subdomain: z.string(),
  description: z.string().nullable().optional(),
  monthlyPricePaise: z.number(),
  language: z.string(),
  sendingStatus: z.enum(['active', 'paused']),
  dailySendLimit: z.number(),
  subscriberCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;
export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;
export type PublicationResponse = z.infer<typeof publicationResponseSchema>;
