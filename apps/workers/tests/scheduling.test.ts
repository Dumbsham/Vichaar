import { describe, expect, it } from 'vitest';
import { computeSendAt } from '../../../packages/shared/src/scheduling.js';

describe('delivery slot scheduling', () => {
  it('uses IST by default and bypasses slots for immediate sends', () => {
    const now = new Date('2026-10-28T00:00:00Z');
    expect(computeSendAt(now, null, 'morning', 'Asia/Kolkata', false).toISOString()).toBe(
      '2026-10-28T01:30:00.000Z',
    );
    expect(
      computeSendAt(now, new Date('2030-01-01T00:00:00Z'), 'evening', 'Asia/Kolkata', true),
    ).toEqual(now);
  });
  it('respects a future publication time and different timezone', () => {
    const now = new Date('2026-10-28T00:00:00Z');
    expect(
      computeSendAt(
        now,
        new Date('2026-10-28T02:00:00Z'),
        'morning',
        'Asia/Kolkata',
        false,
      ).toISOString(),
    ).toBe('2026-10-29T01:30:00.000Z');
    expect(computeSendAt(now, null, 'morning', 'America/New_York', false).toISOString()).toBe(
      '2026-10-28T11:00:00.000Z',
    );
  });
  it('changes the delivery instant when a reader changes timezone and crosses DST', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const before = computeSendAt(now, null, 'morning', 'America/New_York', false);
    const changed = computeSendAt(now, null, 'morning', 'Asia/Kolkata', false);
    expect(before.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(changed.toISOString()).toBe('2026-11-01T01:30:00.000Z');
  });
});
