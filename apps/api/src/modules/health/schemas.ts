import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number(),
  timestamp: z.string(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'unhealthy']),
  database: z.enum(['connected', 'disconnected']),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
