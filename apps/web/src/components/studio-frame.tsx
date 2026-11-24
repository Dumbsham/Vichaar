'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api/browser';
import { writerApi, type Publication } from '@/lib/api/writer';

const StudioContext = createContext<{
  publication: Publication;
  refresh: () => Promise<void>;
} | null>(null);

export function useStudioPublication() {
  const value = useContext(StudioContext);
  if (!value) throw new Error('Studio publication is unavailable');
  return value;
}

export function StudioFrame({ id, children }: { id: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setPublication(await writerApi.getPublication(id));
      setError('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/studio/${id}`)}`);
        return;
      }
      setError(
        cause instanceof ApiError && cause.status === 404
          ? 'This publication was not found in your account.'
          : errorMessage(cause),
      );
    }
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  if (error)
    return (
      <div className="status-page" role="alert">
        <p className="eyebrow">Studio</p>
        <h1>Could not open this publication.</h1>
        <p>{error}</p>
        <button type="button" onClick={() => void refresh()}>
          Try again
        </button>
        <Link href="/studio">All publications</Link>
      </div>
    );
  if (!publication)
    return (
      <div className="studio-loading" role="status">
        Opening your publication…
      </div>
    );

  const base = `/studio/${publication.id}`;
  const links = [
    { href: base, label: 'Overview' },
    { href: `${base}/posts`, label: 'Posts' },
    { href: `${base}/readers`, label: 'Readers' },
    { href: `${base}/analytics`, label: 'Analytics' },
    { href: `${base}/settings`, label: 'Settings' },
  ];
  return (
    <StudioContext.Provider value={{ publication, refresh }}>
      <div className="studio-layout">
        <aside className="studio-sidebar">
          <Link className="studio-switcher" href="/studio">
            ← All publications
          </Link>
          <p className="eyebrow">Writing desk</p>
          <h1>{publication.name}</h1>
          <p className="studio-status">
            Sending {publication.sendingStatus === 'active' ? 'active' : 'paused'}
          </p>
          <nav aria-label="Publication studio">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Link className="studio-public-link" href={`/p/${publication.subdomain}`}>
            View public page ↗
          </Link>
        </aside>
        <div className="studio-content">{children}</div>
      </div>
    </StudioContext.Provider>
  );
}
