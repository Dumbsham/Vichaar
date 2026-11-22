import Link from 'next/link';

export default function Home() {
  return (
    <div className="home-page">
      <p className="eyebrow">
        <span className="eyebrow-mark" /> For independent writers and curious readers
      </p>
      <h1>
        Good writing deserves
        <br />
        <em>room to breathe.</em>
      </h1>
      <p className="home-intro">
        Vichaar is a quiet home for newsletters. Open a publication link to read its latest letters,
        in the language they were written.
      </p>
      <div className="home-action">
        <Link className="text-action" href="/signup">
          Create an account <span aria-hidden="true">↗</span>
        </Link>
        <Link className="text-action" href="/studio">
          Open writing desk <span aria-hidden="true">↗</span>
        </Link>
        <Link className="text-action" href="/design-proof">
          See the reading layout <span aria-hidden="true">↗</span>
        </Link>
        <span>Sample content · design preview</span>
      </div>
      <div className="home-note">
        <span>01 / Read</span>
        <span>02 / Reflect</span>
        <span>03 / Return</span>
      </div>
    </div>
  );
}
