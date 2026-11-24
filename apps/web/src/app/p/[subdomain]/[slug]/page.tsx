import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicPost, getPublicPublication, PublicApiError } from '@/lib/api/public';
import { getPrivatePost } from '@/lib/api/private';
import { CheckoutButton } from '@/components/checkout-button';
import { SubscribeForm } from '@/components/subscribe-form';
import { QuoteCardControl } from '@/components/quote-card-control';
import { formatDate, languageLabel } from '@/lib/format';

type Props = { params: Promise<{ subdomain: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain, slug } = await params;
  try {
    const post = await getPublicPost(subdomain, slug);
    return { title: post.title, description: `Read ${post.title} on Vichaar.` };
  } catch {
    return { title: 'Letter' };
  }
}

export default async function PostPage({ params }: Props) {
  const { subdomain, slug } = await params;
  let publication;
  let post;
  try {
    [publication, post] = await Promise.all([
      getPublicPublication(subdomain),
      getPublicPost(subdomain, slug),
    ]);
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  }
  const full = post.isPaid ? await getPrivatePost(subdomain, slug) : undefined;
  if (full?.state === 'missing') notFound();
  return (
    <article className="article-page" lang={post.language}>
      <Link className="back-link" href={`/p/${subdomain}`}>
        ← All letters from {publication.name}
      </Link>
      <div className="article-head">
        <div className="post-meta">
          <time dateTime={post.publishedAt || undefined}>
            {post.publishedAt && formatDate(post.publishedAt, post.language)}
          </time>
          <span aria-hidden="true">·</span>
          <span>{languageLabel(post.language)}</span>
          {post.isPaid && <span className="paid-label">Paid letter</span>}
        </div>
        <h1>{post.title}</h1>
        <p>By {publication.name}</p>
      </div>
      {post.isPaid && full?.state === 'full' ? (
        <QuoteCardControl subdomain={subdomain} slug={slug}>
          <div className="article-body" dangerouslySetInnerHTML={{ __html: full.html }} />
        </QuoteCardControl>
      ) : post.isPaid ? (
        <>
          <QuoteCardControl subdomain={subdomain} slug={slug}>
            <div
              className="article-body paid-preview"
              dangerouslySetInnerHTML={{ __html: post.htmlPreview }}
            />
          </QuoteCardControl>
          <aside className="access-note">
            <span className="access-rule" aria-hidden="true" />
            <p className="eyebrow">For subscribers</p>
            <h2>Continue reading with {publication.name}</h2>
            {full?.state === 'login' ? (
              <>
                <p>Log in to check your paid access. You can subscribe by email below.</p>
                <Link
                  className="solid-button"
                  href={`/login?next=${encodeURIComponent(`/p/${subdomain}/${slug}`)}`}
                >
                  Log in to read
                </Link>
              </>
            ) : full?.state === 'unavailable' ? (
              <p role="status">
                Paid access is temporarily unavailable. Please try this page again soon. If you are
                testing locally, configure Razorpay test keys to enable checkout.
              </p>
            ) : (
              <>
                <p>
                  This letter is for paid subscribers. First confirm your email subscription, then
                  continue to test-mode payment.
                </p>
                <CheckoutButton
                  subdomain={subdomain}
                  publicationName={publication.name}
                  publicationId={publication.id}
                />
              </>
            )}
          </aside>
        </>
      ) : (
        <QuoteCardControl subdomain={subdomain} slug={slug}>
          <div className="article-body" dangerouslySetInnerHTML={{ __html: post.htmlPreview }} />
        </QuoteCardControl>
      )}
      <div className="article-end" aria-hidden="true">
        ✳
      </div>
      <Link className="back-link bottom-back" href={`/p/${subdomain}`}>
        ← Back to all letters
      </Link>
      {post.isPaid && (
        <div className="article-subscribe">
          <SubscribeForm subdomain={subdomain} />
        </div>
      )}
    </article>
  );
}
