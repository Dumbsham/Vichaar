import { z } from 'zod';

export const analyticsPublicationId = z.string().uuid();
export const analyticsStat = z.object({
  post_id: z.string().uuid(),
  day: z.string(),
  event_type: z.enum(['open', 'click']),
  events: z.coerce.number().int().nonnegative(),
});
