'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/lib/api/browser';
import { writerApi, type Publication } from '@/lib/api/writer';

export function StudioHome() {
  const router = useRouter();
  const [items, setItems] = useState<Publication[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  async function load(next?: string) {
    setLoading(true);
    setError('');
    try {
      const result = await writerApi.listPublications(next);
      setItems((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401)
        router.replace('/login?next=%2Fstudio');
      else setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setFormError('');
    try {
      const price = Number(form.get('price'));
      if (!Number.isInteger(price) || price < 0 || price > 21474836)
        throw new Error('Enter a whole number of rupees within the allowed price range.');
      const publication = await writerApi.createPublication({
        name: String(form.get('name') ?? ''),
        subdomain: String(form.get('subdomain') ?? '')
          .trim()
          .toLowerCase(),
        description: String(form.get('description') ?? ''),
        language: String(form.get('language') ?? 'en'),
        monthlyPricePaise: price * 100,
      });
      router.push(`/studio/${publication.id}`);
    } catch (cause) {
      setFormError(
        cause instanceof Error && !(cause instanceof ApiError)
          ? cause.message
          : errorMessage(cause),
      );
      setBusy(false);
    }
  }

  return (
    <div className="studio-home">
      <p className="eyebrow">Writing desk</p>
      <h1>Your publications.</h1>
      <p className="studio-intro">
        A clear place to see your readers and keep your publication in order.
      </p>
      <section aria-labelledby="your-publications">
        <div className="studio-section-heading">
          <h2 id="your-publications">Publications</h2>
          <span>{items.length} shown</span>
        </div>
        {loading && items.length === 0 && <p role="status">Loading publications…</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="empty-note">No publications yet. Create your first one below.</p>
        )}
        <ul className="studio-publications">
          {items.map((publication) => (
            <li key={publication.id}>
              <Link href={`/studio/${publication.id}`}>
                <strong>{publication.name}</strong>
                <span>
                  {publication.subscriberCount.toLocaleString('en-IN')} active readers · /
                  {publication.subdomain}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {cursor && (
          <button
            className="quiet-button"
            type="button"
            disabled={loading}
            onClick={() => void load(cursor)}
          >
            {loading ? 'Loading…' : 'Load more publications'}
          </button>
        )}
      </section>
      <section className="studio-create" aria-labelledby="create-publication">
        <div className="studio-section-heading">
          <h2 id="create-publication">Start a publication</h2>
        </div>
        <form onSubmit={(event) => void create(event)}>
          <div className="field-pair">
            <label className="form-field">
              <span>Publication name</span>
              <input name="name" maxLength={100} required />
            </label>
            <label className="form-field">
              <span>Public link name</span>
              <input name="subdomain" minLength={3} maxLength={30} required />
              <small>Lowercase letters, numbers, hyphens</small>
            </label>
          </div>
          <label className="form-field">
            <span>Description</span>
            <textarea name="description" maxLength={500} rows={3} />
          </label>
          <div className="field-pair">
            <label className="form-field">
              <span>Language tag</span>
              <input name="language" defaultValue="en" maxLength={10} required />
              <small>For example: en, hi, ta</small>
            </label>
            <label className="form-field">
              <span>Monthly price in rupees</span>
              <input name="price" type="number" min="0" step="1" defaultValue="0" required />
              <small>Use 0 for a free publication.</small>
            </label>
          </div>
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
          <button className="solid-button" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create publication'}
          </button>
        </form>
      </section>
    </div>
  );
}
