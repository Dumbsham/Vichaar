export type Slot = 'morning' | 'afternoon' | 'evening';
const slotHour: Record<Slot, number> = { morning: 7, afternoon: 13, evening: 20 };
export function computeSendAt(
  now: Date,
  scheduledFor: Date | null,
  slot: Slot,
  timezone: string,
  sendImmediately: boolean,
): Date {
  if (sendImmediately) return new Date(now);
  const start = Math.max(now.getTime(), scheduledFor?.getTime() ?? 0);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const quarter = 15 * 60_000;
  for (
    let time = Math.ceil(start / quarter) * quarter;
    time < start + 72 * 60 * 60_000;
    time += quarter
  ) {
    const parts = Object.fromEntries(
      formatter.formatToParts(time).map((part) => [part.type, part.value]),
    );
    if (Number(parts.hour) === slotHour[slot] && Number(parts.minute) === 0) return new Date(time);
  }
  throw new Error('No delivery slot found in the next 72 hours');
}
