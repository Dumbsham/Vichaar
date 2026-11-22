'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api/browser';
import { readerApi, type PaidSubscription } from '@/lib/api/reader';

export function AccountSubscriptions({ publicationId }: { publicationId?: string }) {
  const router = useRouter();
  const [items, setItems] = useState<PaidSubscription[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(publicationId));
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  async function load(next?: string) {
    if (!publicationId) return;
    setLoading(true);
    setError('');
    try {
      const result = await readerApi.listPaid(publicationId, next);
      setItems((previous) => (next ? [...previous, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.push(
          `/login?next=${encodeURIComponent(`/account/subscriptions?publicationId=${publicationId}`)}`,
        );
      } else
        setError(
          cause instanceof ApiError && cause.status === 404
            ? 'Paid subscription status is unavailable until Razorpay test keys are configured.'
            : errorMessage(cause),
        );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [publicationId]);

  async function cancel(id: string) {
    if (!publicationId) return;
    setBusyId(id);
    setError('');
    try {
      await readerApi.cancelPaid(publicationId, id);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId('');
    }
  }

  async function logout() {
    try {
      await readerApi.logout();
      router.push('/login');
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <div className="form-page account-page">
      <p className="eyebrow">Your account</p>
      <h1>Subscriptions</h1>
      {!publicationId ? (
        <p className="form-intro">
          Open a publication and follow its subscription link to see your status here.
        </p>
      ) : (
        <>
          <p className="form-intro">
            Payment status is checked with Vichaar. Access to a paid letter is decided by the post
            itself.
          </p>
          {loading && <p role="status">Checking subscriptions…</p>}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {!loading && !error && items.length === 0 && (
            <p>No paid subscription found for this publication.</p>
          )}
          <ul className="subscription-list">
            {items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.status === 'created' || item.status === 'halted'
                      ? 'Payment is being confirmed'
                      : item.status}
                  </strong>
                  <span>₹{(item.pricePaise / 100).toFixed(2)} / month</span>
                </div>
                {item.currentPeriodEnd && (
                  <p>
                    Current period ends{' '}
                    {new Date(item.currentPeriodEnd).toLocaleDateString('en-IN', {
                      dateStyle: 'long',
                      timeZone: 'Asia/Kolkata',
                    })}
                    .
                  </p>
                )}
                {item.status === 'active' && (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void cancel(item.id)}
                  >
                    {busyId === item.id ? 'Cancelling…' : 'Cancel at period end'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {cursor && (
            <button className="quiet-button" type="button" onClick={() => void load(cursor)}>
              Load older subscriptions
            </button>
          )}
        </>
      )}
      <div className="account-links">
        <Link href="/">Vichaar home</Link>
        <button className="quiet-button" type="button" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </div>
  );
}
