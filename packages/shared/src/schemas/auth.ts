import { z } from 'zod';

export const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email('Valid email address required')),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  name: z.string().min(1, 'Name is required').max(100).trim(),
  timezone: z.string().default('Asia/Kolkata'),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email('Valid email address required')),
  password: z.string().min(1, 'Password is required'),
});

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  timezone: z.string(),
  createdAt: z.string(),
});

export const authSessionResponseSchema = z.object({
  user: userResponseSchema,
  expiresAt: z.string(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
