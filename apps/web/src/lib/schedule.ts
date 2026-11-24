const parts = (date: Date, timeZone: string) => {
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(values.map((part) => [part.type, part.value]));
};

export function localDateTime(date: Date, timeZone: string): string {
  const value = parts(date, timeZone);
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

export function scheduledUtc(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (!Number.isFinite(wall)) return null;
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = parts(new Date(instant), timeZone);
    const shown = Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour),
      Number(value.minute),
    );
    instant += wall - shown;
  }
  const date = new Date(instant);
  return localDateTime(date, timeZone) === local ? date.toISOString() : null;
}
