'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api/browser';
import { readerApi } from '@/lib/api/reader';

type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: () => void;
  modal: { ondismiss: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open(): void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Payment window could not load'));
    document.body.append(script);
  });
}

export function CheckoutButton({
  subdomain,
  publicationName,
  publicationId,
}: {
  subdomain: string;
  publicationName: string;
  publicationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function start() {
    setBusy(true);
    setMessage('');
    try {
      const checkout = await readerApi.checkout(subdomain);
      if (!/^rzp_test_[A-Za-z0-9]+$/.test(checkout.keyId) || checkout.keyId === 'rzp_test_stub') {
        setMessage('Test-mode checkout is unavailable until Razorpay test keys are configured.');
        return;
      }
      await loadRazorpay();
      if (!window.Razorpay) throw new Error('Payment window could not load');
      new window.Razorpay({
        key: checkout.keyId,
        subscription_id: checkout.razorpaySubscriptionId,
        name: publicationName,
        description: 'Monthly subscription',
        handler: () => {
          setMessage(
            'Payment is being confirmed. Your reading access will update after the payment webhook is processed.',
          );
          router.refresh();
        },
        modal: {
          ondismiss: () => setMessage('Payment window closed. You can try again when ready.'),
        },
      }).open();
    } catch (cause) {
      setMessage(
        cause instanceof ApiError && cause.status === 404
          ? 'Test-mode checkout is unavailable until Razorpay test keys are configured.'
          : errorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="checkout-control">
      <button className="solid-button" type="button" disabled={busy} onClick={() => void start()}>
        {busy ? 'Preparing checkout…' : 'Continue with test payment'}
      </button>
      {message && <p role="status">{message}</p>}
      <a
        className="read-link"
        href={`/account/subscriptions?publicationId=${encodeURIComponent(publicationId)}`}
      >
        Check subscription status
      </a>
    </div>
  );
}
