'use client';

import { useState, type FormEvent } from 'react';
import { DeliveryFields } from './delivery-fields';
import { errorMessage } from '@/lib/api/browser';
import { readerApi } from '@/lib/api/reader';

export function SubscribeForm({ subdomain }: { subdomain: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setState('sending');
    setError('');
    try {
      await readerApi.subscribe(subdomain, {
        email: String(data.get('email') ?? ''),
        slot: String(data.get('slot') ?? ''),
        timezone: String(data.get('timezone') ?? ''),
      });
      setState('sent');
    } catch (cause) {
      setError(errorMessage(cause));
      setState('idle');
    }
  }

  return (
    <section className="reader-action" aria-labelledby="subscribe-heading">
      <p className="eyebrow">Keep reading</p>
      <h2 id="subscribe-heading">Get the next letter by email.</h2>
      {state === 'sent' ? (
        <p role="status">
          If this address can subscribe, check your inbox for a confirmation link.
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-field">
            <span>Email address</span>
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <DeliveryFields />
          <p className="form-help">
            We send only after you confirm your address. Change your time later from the email link.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="solid-button" disabled={state === 'sending'} type="submit">
            {state === 'sending' ? 'Sending request…' : 'Send confirmation link'}
          </button>
        </form>
      )}
    </section>
  );
}
