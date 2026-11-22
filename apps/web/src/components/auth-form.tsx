'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api/browser';
import { readerApi } from '@/lib/api/reader';

export function AuthForm({ mode, nextPath }: { mode: 'login' | 'signup'; nextPath: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const email = String(data.get('email') ?? '');
      const password = String(data.get('password') ?? '');
      if (mode === 'signup') {
        await readerApi.signup({
          name: String(data.get('name') ?? ''),
          email,
          password,
          timezone: String(data.get('timezone') ?? 'Asia/Kolkata'),
        });
      } else {
        await readerApi.login({ email, password });
      }
      router.push(nextPath);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  const other = mode === 'login' ? '/signup' : '/login';
  return (
    <div className="form-page">
      <p className="eyebrow">Your reading account</p>
      <h1>{mode === 'login' ? 'Welcome back.' : 'Make a place for your reading.'}</h1>
      <p className="form-intro">
        {mode === 'login'
          ? 'Sign in to read paid letters and manage your subscriptions.'
          : 'One account for reading and writing on Vichaar.'}
      </p>
      <form onSubmit={(event) => void submit(event)}>
        {mode === 'signup' && (
          <label className="form-field">
            <span>Your name</span>
            <input name="name" autoComplete="name" maxLength={100} required />
          </label>
        )}
        <label className="form-field">
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" maxLength={254} required />
        </label>
        <label className="form-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : 1}
            required
          />
        </label>
        {mode === 'signup' && (
          <label className="form-field">
            <span>Timezone</span>
            <input name="timezone" defaultValue="Asia/Kolkata" required />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="solid-button" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
      <p className="form-switch">
        {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
        <Link href={`${other}?next=${encodeURIComponent(nextPath)}`}>
          {mode === 'login' ? 'Create an account' : 'Log in'}
        </Link>
      </p>
    </div>
  );
}
