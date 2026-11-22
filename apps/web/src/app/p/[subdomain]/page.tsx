import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicationHeader } from '@/components/publication-header';
import { PostListItem } from '@/components/post-list-item';
import { SubscribeForm } from '@/components/subscribe-form';
import { getPublicPublication, listPublicPosts, PublicApiError } from '@/lib/api/public';

type Props = {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  try {
    const publication = await getPublicPublication(subdomain);
    return {
      title: publication.name,
      description: publication.description || `Read ${publication.name} on Vichaar.`,
    };
  } catch {
    return { title: 'Publication' };
  }
}

export default async function PublicationPage({ params, searchParams }: Props) {
  const { subdomain } = await params;
  const { cursor } = await searchParams;
  if (Array.isArray(cursor)) notFound();
  let publication;
  try {
    publication = await getPublicPublication(subdomain);
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  }
  const posts = await listPublicPosts(subdomain, cursor);
  return (
    <div className="reading-page">
      <PublicationHeader publication={publication} />
      <section className="letters-section" aria-labelledby="latest-heading">
        <div className="section-heading">
          <span>01 / The letters</span>
          <h2 id="latest-heading">Latest writing</h2>
        </div>
        {posts.items.length ? (
          <div className="post-list">
            {posts.items.map((post) => (
              <PostListItem key={post.id} post={post} subdomain={subdomain} />
            ))}
          </div>
        ) : (
          <p className="empty-note">
            No letters here yet. When the first one is published, it will appear on this page.
          </p>
        )}
        {posts.hasMore && posts.nextCursor && (
          <Link
            className="older-link"
            href={`/p/${subdomain}?cursor=${encodeURIComponent(posts.nextCursor)}`}
          >
            Older letters <span aria-hidden="true">→</span>
          </Link>
        )}
      </section>
      <SubscribeForm subdomain={subdomain} />
    </div>
  );
}
