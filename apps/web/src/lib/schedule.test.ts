import { describe, expect, it } from 'vitest';
import { localDateTime, scheduledUtc } from './schedule';

describe('scheduled local time', () => {
  it('converts IST wall time to UTC', () => {
    expect(scheduledUtc('2026-12-01T09:00', 'Asia/Kolkata')).toBe('2026-12-01T03:30:00.000Z');
  });
  it('preserves an instant when its displayed timezone changes', () => {
    const instant = '2026-12-01T03:30:00.000Z';
    const london = localDateTime(new Date(instant), 'Europe/London');
    expect(scheduledUtc(london, 'Europe/London')).toBe(instant);
  });
  it('rejects a nonexistent daylight-saving wall time', () => {
    expect(scheduledUtc('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });
});
