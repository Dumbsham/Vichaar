'use client';

import Link from 'next/link';

export default function PublicationError({ reset }: { reset: () => void }) {
  return (
    <div className="status-page" role="alert">
      <p className="eyebrow">Temporary interruption</p>
      <h1>This page could not load.</h1>
      <p>Please try again in a moment.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
      <Link href="/">Vichaar home</Link>
    </div>
  );
}
