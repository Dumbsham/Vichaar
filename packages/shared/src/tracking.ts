import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payload = z.object({
  publicationId: z.string().uuid(),
  postId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  linkId: z.string().uuid().nullable(),
  kind: z.enum(['open', 'click']),
  exp: z.number().int(),
});
export type TrackingPayload = z.infer<typeof payload>;

export function signTrackingToken(secret: string, value: TrackingPayload): string {
  const body = Buffer.from(JSON.stringify(payload.parse(value))).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyTrackingToken(
  secret: string,
  token: string,
  kind: 'open' | 'click',
  nowSeconds: number,
): TrackingPayload | null {
  if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = payload.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    return parsed.kind === kind &&
      parsed.exp >= nowSeconds &&
      (kind === 'open' ? parsed.linkId === null : parsed.linkId !== null)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
