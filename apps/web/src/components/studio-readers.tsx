'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api/browser';
import { writerApi, type Reader } from '@/lib/api/writer';
import { useStudioPublication } from './studio-frame';

export function StudioReaders() {
  const { publication } = useStudioPublication();
  const [items, setItems] = useState<Reader[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(next?: string) {
    setLoading(true);
    setError('');
    try {
      const result = await writerApi.listReaders(publication.id, next);
      setItems((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [publication.id]);

  return (
    <div className="studio-page">
      <p className="eyebrow">Readers</p>
      <h2>People who confirmed.</h2>
      <p className="studio-intro">
        Only active, confirmed readers appear here. Email addresses stay within your publication.
      </p>
      <div className="studio-section-heading">
        <h3>Active readers</h3>
        <span>{publication.subscriberCount.toLocaleString('en-IN')} total</span>
      </div>
      {loading && items.length === 0 && <p role="status">Loading readers…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button className="quiet-button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="studio-empty">
          No confirmed readers yet. Your first reader will appear after confirming their email.
        </p>
      )}
      {items.length > 0 && (
        <div className="table-scroll">
          <table className="studio-table">
            <thead>
              <tr>
                <th scope="col">Reader</th>
                <th scope="col">Delivery</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {items.map((reader) => (
                <tr key={reader.id}>
                  <td>{reader.email}</td>
                  <td>
                    {reader.slot} · {reader.timezone}
                  </td>
                  <td>
                    <time dateTime={reader.joinedAt}>
                      {new Date(reader.joinedAt).toLocaleDateString('en-IN', {
                        dateStyle: 'medium',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <button
          className="quiet-button studio-more"
          type="button"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          {loading ? 'Loading…' : 'Load more readers'}
        </button>
      )}
    </div>
  );
}
