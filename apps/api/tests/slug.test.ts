import { describe, expect, it } from 'vitest';
import { slugFromTitle } from '../src/modules/posts/index.js';

describe('generated post slugs', () => {
  it('preserves Indian scripts and accented letters', () => {
    expect(slugFromTitle('हिंदी कहानी')).toBe('हिंदी-कहानी');
    expect(slugFromTitle('Café Notes')).toBe('café-notes');
    expect(slugFromTitle('தமிழ் கட்டுரை')).toBe('தமிழ்-கட்டுரை');
  });

  it('uses a unique fallback for titles without letters or numbers', () => {
    expect(slugFromTitle('😊')).toMatch(/^post-[0-9a-f]{8}$/);
  });
});
