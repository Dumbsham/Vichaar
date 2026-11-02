import { z } from 'zod';

export const providerSubscriptionSchema = z.object({
  id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  status: z.enum([
    'created',
    'authenticated',
    'active',
    'pending',
    'halted',
    'paused',
    'cancelled',
    'completed',
    'expired',
    'resumed',
  ]),
  current_end: z.number().int().nonnegative().nullable(),
  created_at: z.number().int().nonnegative().optional(),
  short_url: z.string().url().nullable().optional(),
});
export const webhookSchema = z.object({
  event: z.string().startsWith('subscription.'),
  created_at: z.number().int().nonnegative(),
  payload: z.object({ subscription: z.object({ entity: providerSubscriptionSchema }) }),
});
export type ProviderSubscription = z.infer<typeof providerSubscriptionSchema>;
export type WebhookPayload = z.infer<typeof webhookSchema>;
