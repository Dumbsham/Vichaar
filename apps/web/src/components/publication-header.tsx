import type { PublicPublication } from '@/lib/api/schemas';
import Link from 'next/link';
import { languageLabel } from '@/lib/format';

export function PublicationHeader({
  publication,
  preview = false,
}: {
  publication: PublicPublication;
  preview?: boolean;
}) {
  return (
    <section className="publication-header" aria-labelledby="publication-title">
      <div className="eyebrow">
        <span className="eyebrow-mark" /> A publication on Vichaar{' '}
        <span className="eyebrow-end">{languageLabel(publication.language)}</span>
      </div>
      <h1 id="publication-title">
        {preview ? (
          publication.name
        ) : (
          <Link href={`/p/${publication.subdomain}`}>{publication.name}</Link>
        )}
      </h1>
      {publication.description && (
        <p className="publication-description">{publication.description}</p>
      )}
      {!preview && (
        <Link
          className="read-link publication-account-link"
          href={`/account/subscriptions?publicationId=${publication.id}`}
        >
          Your subscription status
        </Link>
      )}
      <div className="publication-rule" aria-hidden="true">
        <span />
      </div>
    </section>
  );
}
