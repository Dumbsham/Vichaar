import { z } from 'zod';

export const trackingPathToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  .max(1024);
