'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/lib/api/browser';
import { writerApi } from '@/lib/api/writer';
import { useStudioPublication } from './studio-frame';

export function StudioSettings() {
  const { publication, refresh } = useStudioPublication();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      const price = Number(data.get('price'));
      if (!Number.isInteger(price) || price < 0 || price > 21474836)
        throw new Error('Enter a whole number of rupees within the allowed price range.');
      await writerApi.updatePublication(publication.id, {
        name: String(data.get('name') ?? ''),
        description: String(data.get('description') ?? ''),
        language: String(data.get('language') ?? ''),
        monthlyPricePaise: price * 100,
      });
      await refresh();
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? 'These settings changed elsewhere. Reload and review before saving again.'
          : cause instanceof Error && !(cause instanceof ApiError)
            ? cause.message
            : errorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-page">
      <p className="eyebrow">Settings</p>
      <h2>Publication details.</h2>
      <p className="studio-intro">
        These details appear on the public page. The public link name stays fixed after creation.
      </p>
      <form
        className="studio-settings-form"
        key={publication.id}
        onSubmit={(event) => void save(event)}
      >
        <label className="form-field">
          <span>Name</span>
          <input name="name" defaultValue={publication.name} maxLength={100} required />
        </label>
        <label className="form-field">
          <span>Public link</span>
          <input value={`/p/${publication.subdomain}`} disabled readOnly />
        </label>
        <label className="form-field">
          <span>Description</span>
          <textarea
            name="description"
            defaultValue={publication.description ?? ''}
            maxLength={500}
            rows={4}
          />
        </label>
        <div className="field-pair">
          <label className="form-field">
            <span>Language tag</span>
            <input name="language" defaultValue={publication.language} maxLength={10} required />
          </label>
          <label className="form-field">
            <span>Monthly price in rupees</span>
            <input
              name="price"
              type="number"
              min="0"
              step="1"
              defaultValue={publication.monthlyPricePaise / 100}
              required
            />
          </label>
        </div>
        <p className="form-help">
          0 keeps the publication free. A paid price is charged only after the reader confirms and
          starts test-mode checkout.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="success-note">
            Settings saved.
          </p>
        )}
        <button className="solid-button" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </div>
  );
}
