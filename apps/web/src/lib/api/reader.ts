import { z } from 'zod';
import { apiRequest } from './browser';

const empty = z.undefined();
const message = z.object({ message: z.string() });
const session = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.email(),
    name: z.string(),
    timezone: z.string(),
  }),
  expiresAt: z.string(),
});
const paid = z.object({
  id: z.string().uuid(),
  publicationId: z.string().uuid(),
  status: z.string(),
  pricePaise: z.number().int(),
  currentPeriodEnd: z.string().nullable(),
  razorpaySubscriptionId: z.string(),
});
const checkout = paid.extend({ keyId: z.string() });
const paidList = z.object({ items: z.array(paid), nextCursor: z.string().uuid().nullable() });

export type PaidSubscription = z.infer<typeof paid>;

export const readerApi = {
  signup: (input: { name: string; email: string; password: string; timezone: string }) =>
    apiRequest('/auth/signup', session, { method: 'POST', body: input }),
  login: (input: { email: string; password: string }) =>
    apiRequest('/auth/login', session, { method: 'POST', body: input }),
  logout: () => apiRequest('/auth/logout', empty, { method: 'POST' }),
  subscribe: (subdomain: string, input: { email: string; slot: string; timezone: string }) =>
    apiRequest(`/public/${encodeURIComponent(subdomain)}/subscribe`, message, {
      method: 'POST',
      body: input,
    }),
  confirm: (token: string) =>
    apiRequest('/subscriptions/confirm', empty, { method: 'POST', body: { token } }),
  preferences: (token: string, input: { slot: string; timezone: string }) =>
    apiRequest(`/subscriptions/preferences/${encodeURIComponent(token)}`, empty, {
      method: 'POST',
      body: input,
    }),
  unsubscribe: (token: string) =>
    apiRequest(`/subscriptions/unsubscribe/${encodeURIComponent(token)}`, empty, {
      method: 'POST',
    }),
  listPaid: (publicationId: string, cursor?: string) =>
    apiRequest(
      `/me/subscriptions?publicationId=${encodeURIComponent(publicationId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      paidList,
    ),
  cancelPaid: (publicationId: string, id: string) =>
    apiRequest(
      `/me/subscriptions/${encodeURIComponent(id)}/cancel`,
      z.object({ status: z.string(), currentPeriodEnd: z.string().nullable() }),
      {
        method: 'POST',
        body: { publicationId },
      },
    ),
  checkout: (subdomain: string) =>
    apiRequest(`/public/${encodeURIComponent(subdomain)}/checkout`, checkout, { method: 'POST' }),
};
