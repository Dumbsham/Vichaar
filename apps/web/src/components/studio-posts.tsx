'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api/browser';
import { writerApi, type WriterPost } from '@/lib/api/writer';
import { useStudioPublication } from './studio-frame';

export function StudioPosts() {
  const { publication } = useStudioPublication();
  const router = useRouter();
  const [items, setItems] = useState<WriterPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  async function load(next?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await writerApi.listPosts(publication.id, next);
      setItems((current) => (next ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [publication.id]);

  async function create() {
    if (!newTitle.trim()) {
      setError('Give the draft a title first.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const post = await writerApi.createPost(publication.id, {
        title: newTitle.trim(),
        body: '',
        language: publication.language,
        isPaid: false,
      });
      router.push(`/studio/${publication.id}/posts/${post.id}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setCreating(false);
    }
  }

  return (
    <div className="studio-page">
      <p className="eyebrow">Writing desk</p>
      <div className="studio-posts-head">
        <div>
          <h2>Your letters.</h2>
          <p className="studio-intro">Draft, schedule, and publish from one place.</p>
        </div>
      </div>
      <form
        className="post-create"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="post-field">
          New draft title
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            maxLength={200}
            required
            placeholder="A working title"
          />
        </label>
        <button className="solid-button" type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create draft'}
        </button>
      </form>
      {error && (
        <div role="alert">
          <p className="form-error">{error}</p>
          <button className="quiet-button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {loading && items.length === 0 && <p role="status">Loading posts…</p>}
      {!loading && !error && items.length === 0 && (
        <p className="studio-empty">No posts yet. Start with a draft.</p>
      )}
      <ul className="studio-post-list">
        {items.map((post) => (
          <li key={post.id}>
            <Link href={`/studio/${publication.id}/posts/${post.id}`}>
              <strong>{post.title}</strong>
              <span>
                {post.status === 'draft'
                  ? 'Draft'
                  : post.status === 'scheduled'
                    ? 'Scheduled'
                    : post.status === 'published'
                      ? 'Published'
                      : 'Unpublished'}{' '}
                · {post.isPaid ? 'Paid' : 'Free'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          className="quiet-button"
          type="button"
          disabled={loading}
          onClick={() => {
            if (cursor) void load(cursor);
          }}
        >
          {loading ? 'Loading…' : 'More posts'}
        </button>
      )}
    </div>
  );
}
