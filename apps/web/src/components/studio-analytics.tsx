'use client';

import { useEffect, useState } from 'react';
import { writerApi, type AnalyticsStat } from '@/lib/api/writer';
import { useStudioPublication } from './studio-frame';

export function StudioAnalytics() {
  const { publication } = useStudioPublication();
  const [data, setData] = useState<AnalyticsStat[] | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  async function load() {
    setError('');
    try {
      const result = await writerApi.getStats(publication.id);
      setData(result.data);
      setPage(0);
      try {
        const posts = await writerApi.listPosts(publication.id);
        setTitles(new Map(posts.items.map((post) => [post.id, post.title])));
      } catch {
        setTitles(new Map());
      }
    } catch {
      setData(null);
      setError('The analytics service is unavailable. Try again in a moment.');
    }
  }
  useEffect(() => {
    void load();
  }, [publication.id]);
  const visible = data?.slice(page * 50, (page + 1) * 50) ?? [];

  return (
    <div className="studio-page">
      <p className="eyebrow">Email activity</p>
      <h2>Opens and clicks.</h2>
      <p className="studio-intro">
        Daily counts from sent letters. Email clients can prefetch opens, so treat these as signals
        rather than a count of people.
      </p>
      <div className="studio-section-heading">
        <h3>Latest activity</h3>
        <span>Up to 1,000 rows</span>
      </div>
      {!data && !error && <p role="status">Loading email activity…</p>}
      {error && (
        <div role="alert">
          <p className="form-error">Data may be delayed. {error}</p>
          <button className="quiet-button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {data && data.length === 0 && (
        <p className="studio-empty">
          No email activity yet. Counts will appear after letters are sent and events are processed.
        </p>
      )}
      {visible.length > 0 && (
        <div className="table-scroll">
          <table className="studio-table">
            <thead>
              <tr>
                <th scope="col">Day (UTC)</th>
                <th scope="col">Post</th>
                <th scope="col">Event</th>
                <th scope="col" className="number-cell">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={`${row.post_id}-${row.day}-${row.event_type}`}>
                  <td>{row.day}</td>
                  <td>{titles.get(row.post_id) ?? `Post ${row.post_id.slice(0, 8)}`}</td>
                  <td>{row.event_type === 'open' ? 'Opens' : 'Clicks'}</td>
                  <td className="number-cell">{row.events.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.length > 50 && (
        <div className="table-pages">
          <button
            className="quiet-button"
            type="button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {Math.ceil(data.length / 50)}
          </span>
          <button
            className="quiet-button"
            type="button"
            disabled={(page + 1) * 50 >= data.length}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
