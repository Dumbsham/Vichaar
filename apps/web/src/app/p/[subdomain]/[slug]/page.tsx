import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicPost, getPublicPublication, PublicApiError } from '@/lib/api/public';
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
      {post.isPaid ? (
        <>
          <div className="article-body paid-preview">{post.htmlPreview}</div>
          <aside className="access-note">
            <span className="access-rule" aria-hidden="true" />
            <p className="eyebrow">For subscribers</p>
            <h2>Continue reading with {publication.name}</h2>
            <p>
              This letter is for paid subscribers. Reading the rest will be available here soon.
            </p>
          </aside>
        </>
      ) : (
        <div className="article-body" dangerouslySetInnerHTML={{ __html: post.htmlPreview }} />
      )}
      <div className="article-end" aria-hidden="true">
        ✳
      </div>
      <Link className="back-link bottom-back" href={`/p/${subdomain}`}>
        ← Back to all letters
      </Link>
    </article>
  );
}
