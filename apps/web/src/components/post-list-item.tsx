import type { PublicPostList } from '@/lib/api/schemas';
import Link from 'next/link';
import { formatDate, languageLabel } from '@/lib/format';

type Post = PublicPostList['items'][number];

export function PostListItem({
  post,
  subdomain,
  preview = false,
}: {
  post: Post;
  subdomain: string;
  preview?: boolean;
}) {
  return (
    <article className="post-list-item">
      <div className="post-meta">
        <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, post.language)}</time>
        <span aria-hidden="true">·</span>
        <span lang={post.language}>{languageLabel(post.language)}</span>
        {post.isPaid && <span className="paid-label">Paid</span>}
      </div>
      <h3 lang={post.language}>
        {preview ? post.title : <Link href={`/p/${subdomain}/${post.slug}`}>{post.title}</Link>}
      </h3>
      {post.excerpt && (
        <p className="post-excerpt" lang={post.language}>
          {post.excerpt}
        </p>
      )}
      {!preview && (
        <Link
          className="read-link"
          href={`/p/${subdomain}/${post.slug}`}
          aria-label={`Read ${post.title}`}
        >
          Read letter <span aria-hidden="true">↗</span>
        </Link>
      )}
    </article>
  );
}
