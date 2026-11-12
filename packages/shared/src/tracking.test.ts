import { describe, expect, it } from 'vitest';
import { signTrackingToken, verifyTrackingToken } from './tracking.js';

const secret = 'test_tracking_secret_at_least_32_characters';
const value = {
  publicationId: '11111111-1111-4111-8111-111111111111',
  postId: '22222222-2222-4222-8222-222222222222',
  subscriptionId: '33333333-3333-4333-8333-333333333333',
  linkId: null,
  kind: 'open' as const,
  exp: 2000,
};
describe('signed tracking tokens', () => {
  it('accepts only the correct kind before expiry', () => {
    const token = signTrackingToken(secret, value);
    expect(verifyTrackingToken(secret, token, 'open', 1999)).toEqual(value);
    expect(verifyTrackingToken(secret, token, 'click', 1999)).toBeNull();
    expect(verifyTrackingToken(secret, token, 'open', 2001)).toBeNull();
  });
  it('rejects tampering and wrong secrets', () => {
    const token = signTrackingToken(secret, value);
    expect(verifyTrackingToken(secret, token.replace(/.$/, 'x'), 'open', 1000)).toBeNull();
    expect(
      verifyTrackingToken('another_secret_at_least_32_characters', token, 'open', 1000),
    ).toBeNull();
  });
});
