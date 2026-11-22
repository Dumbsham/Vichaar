import Link from 'next/link';

export default function PublicationNotFound() {
  return (
    <div className="status-page">
      <p className="eyebrow">Page not found</p>
      <h1>There is no letter here.</h1>
      <p>The publication or letter may have moved, or this link may be out of date.</p>
      <Link href="/">Vichaar home →</Link>
    </div>
  );
}
