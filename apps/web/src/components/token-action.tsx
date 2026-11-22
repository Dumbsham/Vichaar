'use client';

import { useState, type FormEvent } from 'react';
import { DeliveryFields } from './delivery-fields';
import { errorMessage } from '@/lib/api/browser';
import { readerApi } from '@/lib/api/reader';

export function TokenAction({
  kind,
  token,
}: {
  kind: 'confirm' | 'unsubscribe' | 'preferences';
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (kind === 'confirm') await readerApi.confirm(token);
      else if (kind === 'unsubscribe') await readerApi.unsubscribe(token);
      else
        await readerApi.preferences(token, {
          slot: String(data.get('slot') ?? ''),
          timezone: String(data.get('timezone') ?? ''),
        });
      setDone(true);
      if (kind === 'confirm') window.history.replaceState(null, '', '/confirm');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <p className="success-note" role="status">
        {kind === 'confirm'
          ? 'Your email is confirmed. The next letter will arrive at your chosen time.'
          : kind === 'unsubscribe'
            ? 'You have been unsubscribed from this publication.'
            : 'Your delivery preferences are saved.'}
      </p>
    );
  return (
    <form onSubmit={(event) => void submit(event)}>
      {kind === 'preferences' && <DeliveryFields />}
      {error && (
        <p className="form-error" role="alert">
          {error.includes('Invalid or expired')
            ? 'This link has expired or was already used. Request a new link from the publication.'
            : error}
        </p>
      )}
      <button
        className={kind === 'unsubscribe' ? 'quiet-button' : 'solid-button'}
        type="submit"
        disabled={busy}
      >
        {busy
          ? 'Please wait…'
          : kind === 'confirm'
            ? 'Confirm subscription'
            : kind === 'unsubscribe'
              ? 'Unsubscribe'
              : 'Save delivery time'}
      </button>
    </form>
  );
}
