import { z } from 'zod';

export const quoteCardInput = z.object({ quote: z.string().min(1).max(1000) }).strict();
export const quoteCardHash = z.string().regex(/^[0-9a-f]{64}$/);
export type QuoteCardInput = z.infer<typeof quoteCardInput>;
