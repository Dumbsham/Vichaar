import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Vichaar home">
        Vichaar<span lang="hi">विचार</span>
      </Link>
      <span className="site-kicker">Independent letters, thoughtfully sent.</span>
    </header>
  );
}
