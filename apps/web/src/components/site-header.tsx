import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Vichaar home">
        Vichaar<span lang="hi">विचार</span>
      </Link>
      <nav className="site-nav" aria-label="Main navigation">
        <span className="site-kicker">Independent letters, thoughtfully sent.</span>
        <Link href="/studio">Writing desk</Link>
        <Link href="/account/subscriptions">Your account</Link>
      </nav>
    </header>
  );
}
