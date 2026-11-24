'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api/browser';
import { writerApi, type WriterPostDetail } from '@/lib/api/writer';
import { localDateTime, scheduledUtc } from '@/lib/schedule';
import { useStudioPublication } from './studio-frame';

const RichPostEditor = dynamic(() => import('./rich-post-editor'), {
  ssr: false,
  loading: () => <p role="status">Opening editor…</p>,
});
type Draft = {
  title: string;
  body: string;
  language: string;
  isPaid: boolean;
  scheduledFor: string | null;
};
const zones = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Europe/London', 'America/New_York'];

export function StudioPostEditor({ postId }: { postId: string }) {
  const { publication } = useStudioPublication();
  const [post, setPost] = useState<WriterPostDetail | null>(null);
  const postRef = useRef<WriterPostDetail | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [language, setLanguage] = useState(publication.language);
  const [isPaid, setIsPaid] = useState(false);
  const [zone, setZone] = useState('Asia/Kolkata');
  const [local, setLocal] = useState('');
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'publish' | 'unpublish' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saved = useRef('');
  const pending = useRef<Promise<boolean>>(Promise.resolve(true));
  const blocked = useRef(false);

  async function load() {
    setError('');
    try {
      const result = await writerApi.getPost(publication.id, postId);
      postRef.current = result;
      setPost(result);
      setTitle(result.title);
      setBody(result.body);
      setLanguage(result.language);
      setIsPaid(result.isPaid);
      setLocal(result.scheduledFor ? localDateTime(new Date(result.scheduledFor), zone) : '');
      saved.current = JSON.stringify({
        title: result.title,
        body: result.body,
        language: result.language,
        isPaid: result.isPaid,
        scheduledFor: result.scheduledFor,
      });
      blocked.current = false;
      setConflict(false);
      setStatus(
        result.status === 'draft'
          ? 'Saved'
          : result.status === 'scheduled'
            ? 'Scheduled'
            : result.status === 'published'
              ? 'Published'
              : 'Unpublished',
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus('Could not load');
    }
  }
  useEffect(() => {
    void load();
  }, [publication.id, postId]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmAction && !dialog.open) dialog.showModal();
    if (!confirmAction && dialog.open) dialog.close();
  }, [confirmAction]);

  const scheduledFor = local ? scheduledUtc(local, zone) : null;
  const scheduleValid =
    !local || (scheduledFor !== null && new Date(scheduledFor).getTime() > Date.now());
  const draft: Draft = { title, body, language, isPaid, scheduledFor };
  const serialized = JSON.stringify(draft);
  const editable = post?.status === 'draft';

  function queueSave(input: Draft): Promise<boolean> {
    const snapshot = JSON.stringify(input);
    pending.current = pending.current.then(async () => {
      const current = postRef.current;
      if (!current || blocked.current || current.status !== 'draft') return false;
      if (snapshot === saved.current) return true;
      setStatus('Saving…');
      try {
        const updated = await writerApi.updatePost(publication.id, postId, {
          version: current.version,
          ...input,
        });
        postRef.current = { ...current, ...updated, body: input.body, language: input.language };
        setPost(postRef.current);
        saved.current = snapshot;
        setStatus('Saved');
        setError('');
        return true;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          blocked.current = true;
          setConflict(true);
          setStatus('Could not save');
          setError('This draft changed elsewhere. Copy your text before reloading.');
        } else {
          setStatus('Could not save');
          setError(errorMessage(cause));
        }
        return false;
      }
    });
    return pending.current;
  }

  useEffect(() => {
    if (
      !editable ||
      blocked.current ||
      serialized === saved.current ||
      !scheduleValid ||
      !title.trim()
    )
      return;
    setStatus('Unsaved changes');
    const timer = window.setTimeout(() => {
      void queueSave(draft);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [serialized, editable, scheduleValid]);

  async function saveNow(): Promise<boolean> {
    if (!title.trim()) {
      setError('Add a title before saving.');
      return false;
    }
    if (!scheduleValid) {
      setError('Choose a valid future time in the selected timezone.');
      return false;
    }
    return queueSave(draft);
  }

  async function preparePublish() {
    setBusy(true);
    if (!body.replace(/<[^>]*>/g, '').trim()) {
      setError('Add some writing before publishing.');
      setBusy(false);
      return;
    }
    const ok = await saveNow();
    if (!ok) {
      setBusy(false);
      return;
    }
    setBusy(false);
    setConfirmAction('publish');
  }

  async function publish() {
    setConfirmAction(null);
    setBusy(true);
    try {
      const updated = await writerApi.publishPost(publication.id, postId, !local);
      postRef.current = postRef.current ? { ...postRef.current, ...updated } : null;
      setPost(postRef.current);
      setStatus(updated.status === 'scheduled' ? 'Scheduled' : 'Published');
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setConfirmAction(null);
    setBusy(true);
    try {
      const updated = await writerApi.unpublishPost(publication.id, postId);
      postRef.current = postRef.current ? { ...postRef.current, ...updated } : null;
      setPost(postRef.current);
      setStatus('Unpublished');
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function changeZone(next: string) {
    if (local) {
      const instant = scheduledUtc(local, zone);
      if (instant) setLocal(localDateTime(new Date(instant), next));
    }
    setZone(next);
  }

  return (
    <div className="studio-page post-compose">
      <p className="eyebrow">
        <Link href={`/studio/${publication.id}/posts`}>← Posts</Link>
      </p>
      {!post && !error && <p role="status">Loading draft…</p>}
      {!post && error && (
        <div role="alert">
          <p className="form-error">{error}</p>
          <button type="button" className="quiet-button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {post && (
        <>
          <div className="studio-posts-head">
            <div>
              <h2>{editable ? 'Write a letter.' : post.title}</h2>
              <p className="studio-intro" role="status">
                {status}
              </p>
            </div>
            {editable && (
              <button
                type="button"
                className="quiet-button"
                onClick={() => void saveNow()}
                disabled={busy || conflict}
              >
                Save now
              </button>
            )}
          </div>
          <label className="post-field">
            Title
            <input
              value={title}
              maxLength={200}
              disabled={!editable}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="post-options">
            <label className="post-field">
              Language
              <select
                value={language}
                disabled={!editable}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
                <option value="ta">தமிழ்</option>
              </select>
            </label>
            <label className="post-check">
              <input
                type="checkbox"
                checked={isPaid}
                disabled={!editable}
                onChange={(event) => setIsPaid(event.target.checked)}
              />{' '}
              Paid post
            </label>
          </div>
          <label className="post-field">Body</label>
          <RichPostEditor body={body} onChange={setBody} disabled={!editable} />
          {editable && (
            <div className="post-schedule">
              <h3>When to publish</h3>
              <p>Leave the time empty to publish now.</p>
              <div className="post-options">
                <label className="post-field">
                  Date and time
                  <input
                    type="datetime-local"
                    value={local}
                    onChange={(event) => setLocal(event.target.value)}
                  />
                </label>
                <label className="post-field">
                  Timezone
                  <select value={zone} onChange={(event) => changeZone(event.target.value)}>
                    {zones.map((value) => (
                      <option key={value} value={value}>
                        {value.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!scheduleValid && (
                <p className="form-error" role="alert">
                  Choose a valid future time in {zone}.
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {conflict && (
            <div className="post-conflict">
              <p>Your text remains here. Copy it before reloading the latest version.</p>
              <textarea readOnly aria-label="Unsaved post HTML to copy" value={body} />
              <button type="button" className="quiet-button" onClick={() => void load()}>
                Reload latest version
              </button>
            </div>
          )}
          <div className="post-actions">
            {editable && (
              <button
                className="solid-button"
                type="button"
                disabled={busy || conflict || !scheduleValid}
                onClick={() => void preparePublish()}
              >
                {busy ? 'Working…' : local ? 'Schedule post' : 'Publish post'}
              </button>
            )}
            {post.status === 'published' && (
              <>
                <Link href={`/p/${publication.subdomain}/${post.slug}`}>Read public post ↗</Link>
                <button
                  type="button"
                  className="quiet-button"
                  disabled={busy}
                  onClick={() => setConfirmAction('unpublish')}
                >
                  Unpublish
                </button>
              </>
            )}
            {post.status === 'scheduled' && (
              <p>
                Scheduled for{' '}
                {post.scheduledFor
                  ? new Date(post.scheduledFor).toLocaleString('en-IN', {
                      timeZone: zone,
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'later'}{' '}
                ({zone}).
              </p>
            )}
            {post.status === 'unpublished' && (
              <p>This post is unpublished. Create a new draft to write again.</p>
            )}
          </div>
          <dialog
            ref={dialogRef}
            className="post-confirm"
            onClose={() => setConfirmAction(null)}
            aria-labelledby="post-confirm-title"
          >
            <h3 id="post-confirm-title">
              {confirmAction === 'unpublish'
                ? 'Unpublish this post?'
                : local
                  ? 'Schedule this post?'
                  : 'Publish this post?'}
            </h3>
            <p>
              {confirmAction === 'unpublish'
                ? 'Its public page will stop appearing.'
                : local
                  ? `Readers will receive it at the selected time in ${zone}.`
                  : 'Email delivery may start after publishing.'}
            </p>
            <div className="post-actions">
              <button type="button" className="quiet-button" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="solid-button"
                onClick={() => {
                  if (confirmAction === 'unpublish') void unpublish();
                  else void publish();
                }}
              >
                Confirm
              </button>
            </div>
          </dialog>
        </>
      )}
    </div>
  );
}
