import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import satori from 'satori';
import { renderAsync } from '@resvg/resvg-js';
import { AppError } from '@vichaar/shared/errors';

const require = createRequire(import.meta.url);
const fontPaths = {
  en: require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
  hi: require.resolve('@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff'),
  ta: require.resolve('@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff'),
};
const fonts = Promise.all(
  Object.entries(fontPaths).map(
    async ([language, path]) => [language, await readFile(path)] as const,
  ),
).then((entries) => new Map(entries));

export interface QuoteRenderer {
  render(quote: string, title: string, language: string): Promise<Buffer>;
  stats(): { rendered: number; failures: number; rejected: number; renderDurationMsTotal: number };
}

export function createQuoteRenderer(): QuoteRenderer {
  let active = 0;
  const waiters: Array<() => void> = [];
  const counters = { rendered: 0, failures: 0, rejected: 0, renderDurationMsTotal: 0 };
  return {
    async render(quote, title, language) {
      if (active >= 2) {
        if (waiters.length >= 10) {
          counters.rejected++;
          throw new AppError('Quote card renderer is busy', 503, 'RENDER_BUSY');
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      } else active++;
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const next = waiters.shift();
        if (next) next();
        else active--;
      };
      try {
        const loaded = await fonts;
        const lang = language.split('-')[0];
        const selected = lang === 'hi' || lang === 'ta' ? lang : 'en';
        const primary = loaded.get(selected);
        const latin = loaded.get('en');
        if (!primary || !latin) throw new Error('Quote card fonts unavailable');
        const family =
          selected === 'hi'
            ? 'Noto Sans Devanagari'
            : selected === 'ta'
              ? 'Noto Sans Tamil'
              : 'Noto Sans';
        const regionalFonts: Array<{ name: string; data: Buffer; weight: 400; style: 'normal' }> =
          selected === 'en' ? [] : [{ name: family, data: primary, weight: 400, style: 'normal' }];
        const task = (async () => {
          try {
            const svg = await satori(
              createElement(
                'div',
                {
                  style: {
                    width: 1056,
                    height: 486,
                    backgroundColor: '#fff8ec',
                    color: '#28322e',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '72px',
                  },
                },
                createElement(
                  'div',
                  {
                    style: {
                      fontFamily: family,
                      fontSize: quote.length > 120 ? 48 : 60,
                      lineHeight: 1.35,
                      overflow: 'hidden',
                      display: 'flex',
                    },
                  },
                  `“${quote}”`,
                ),
                createElement(
                  'div',
                  {
                    style: { fontFamily: family, fontSize: 26, color: '#695e50', display: 'flex' },
                  },
                  title.slice(0, 100),
                ),
              ),
              {
                width: 1200,
                height: 630,
                fonts: [
                  { name: 'Noto Sans', data: latin, weight: 400, style: 'normal' },
                  ...regionalFonts,
                ],
              },
            );
            return (await renderAsync(svg, { font: { loadSystemFonts: false } })).asPng();
          } finally {
            release();
          }
        })();
        const png = await Promise.race([
          task,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new AppError('Quote card render timed out', 503, 'RENDER_TIMEOUT')),
              5000,
            );
          }),
        ]);
        counters.rendered++;
        return png;
      } catch (error) {
        counters.failures++;
        throw error;
      } finally {
        counters.renderDurationMsTotal += Date.now() - started;
        clearTimeout(timer);
        // A timed-out render keeps its slot until the underlying work finishes.
        if (!released && !timer) release();
      }
    },
    stats: () => ({ ...counters }),
  };
}
