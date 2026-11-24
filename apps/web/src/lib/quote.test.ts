import { describe, expect, it } from 'vitest';
import { normalizeQuoteText, quoteLength } from './quote';

describe('reader quote selection', () => {
  it('normalizes whitespace and Unicode before submitting a selected passage', () => {
    expect(normalizeQuoteText('  cafe\u0301\n  aur   चाय  ')).toBe('café aur चाय');
  });

  it('counts Unicode characters after normalization for the API limit', () => {
    expect(quoteLength('🙂'.repeat(200))).toBe(200);
    expect(quoteLength('🙂'.repeat(201))).toBe(201);
  });
});
