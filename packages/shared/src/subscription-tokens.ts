import { signToken } from './tokens.js';

export function confirmationToken(
  secret: string,
  publicationId: string,
  subscriptionId: string,
  exp: number,
): string {
  return signToken({ purpose: 'confirm', publicationId, subscriptionId, exp }, secret);
}
export function unsubscribeToken(
  secret: string,
  publicationId: string,
  subscriptionId: string,
  exp: number,
): string {
  return signToken({ purpose: 'unsubscribe', publicationId, subscriptionId, exp }, secret);
}
