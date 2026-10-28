import { z } from 'zod';

export const subscribeSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  slot: z.enum(['morning', 'afternoon', 'evening']).default('morning'),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});
export const confirmSchema = z.object({ token: z.string().min(1).max(2048) });
export const preferencesSchema = subscribeSchema.pick({ slot: true, timezone: true });
export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
