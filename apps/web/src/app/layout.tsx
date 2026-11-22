import type { Metadata } from 'next';
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/500.css';
import '@fontsource/noto-sans/600.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-tamil/400.css';
import './globals.css';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: { default: 'Vichaar', template: '%s · Vichaar' },
  description: 'Independent letters, thoughtfully sent.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="shell">
          <SiteHeader />
          <main id="main">{children}</main>
          <footer className="site-footer">
            <span>
              Vichaar <span lang="hi">· विचार</span>
            </span>
            <span>Words with a place to stay.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
