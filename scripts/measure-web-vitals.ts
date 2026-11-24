import { chromium } from '@playwright/test';

function readMetrics(value: unknown) {
  if (typeof value !== 'object' || value === null) throw new Error('Missing browser metrics');
  if (!('lcpMs' in value) || typeof value.lcpMs !== 'number')
    throw new Error('Missing LCP measurement');
  if (!('cls' in value) || typeof value.cls !== 'number')
    throw new Error('Missing CLS measurement');
  if (!('inpMs' in value) || (value.inpMs !== null && typeof value.inpMs !== 'number'))
    throw new Error('Missing INP measurement');
  return { lcpMs: value.lcpMs, cls: value.cls, inpMs: value.inpMs };
}
const paths = (process.env.WEB_VITAL_PATHS ?? '/').split(',').filter(Boolean);
const origin = new URL(process.env.WEB_BASE_URL ?? 'http://localhost:3000').origin;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });

try {
  for (const path of paths) {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Paths must be local routes');
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const metrics: { lcpMs: number; cls: number; inpMs: number | null } = {
        lcpMs: 0,
        cls: 0,
        inpMs: null,
      };
      Reflect.set(window, '__vichaarLabVitals', metrics);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.lcpMs = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (Reflect.get(entry, 'hadRecentInput') !== true)
            metrics.cls += Number(Reflect.get(entry, 'value')) || 0;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (Number(Reflect.get(entry, 'interactionId')) > 0)
            metrics.inpMs = Math.max(metrics.inpMs ?? 0, entry.duration);
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    });
    await page.goto(new URL(path, origin).toString(), { waitUntil: 'load' });
    const textbox = page.getByRole('textbox').first();
    if (await textbox.count()) {
      await textbox.click();
      await textbox.fill('vitals@example.test');
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const measured: unknown = await page.evaluate(() => Reflect.get(window, '__vichaarLabVitals'));
    const result = readMetrics(measured);
    process.stdout.write(`${JSON.stringify({ path, ...result })}\n`);
    await page.close();
  }
} finally {
  await browser.close();
}
