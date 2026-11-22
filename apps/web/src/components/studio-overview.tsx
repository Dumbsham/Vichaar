'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api/browser';
import { writerApi } from '@/lib/api/writer';
import { useStudioPublication } from './studio-frame';

type Milestones = Awaited<ReturnType<typeof writerApi.getMilestones>>;

export function StudioOverview() {
  const { publication } = useStudioPublication();
  const [data, setData] = useState<Milestones | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void writerApi
      .getMilestones(publication.id)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [publication.id]);

  return (
    <div className="studio-page">
      <p className="eyebrow">Overview</p>
      <h2>At a glance.</h2>
      <p className="studio-intro">
        The current state of {publication.name}, directly from your publication data.
      </p>
      <div className="studio-metrics">
        <div>
          <span>Active readers</span>
          <strong>{publication.subscriberCount.toLocaleString('en-IN')}</strong>
        </div>
        <div>
          <span>Monthly price</span>
          <strong>
            {publication.monthlyPricePaise
              ? `₹${(publication.monthlyPricePaise / 100).toLocaleString('en-IN')}`
              : 'Free'}
          </strong>
        </div>
        <div>
          <span>Writing streak</span>
          <strong>
            {data
              ? `${data.streak.currentWeeks} ${data.streak.currentWeeks === 1 ? 'week' : 'weeks'}`
              : '…'}
          </strong>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          Milestones could not load: {error}
        </p>
      )}
      <section>
        <div className="studio-section-heading">
          <h3>Milestones</h3>
          <span>Reached once</span>
        </div>
        {!data && !error && <p role="status">Loading milestones…</p>}
        {data && data.milestones.length === 0 && (
          <p className="studio-empty">
            No milestones yet. The first arrives at 10 confirmed readers.
          </p>
        )}
        {data && data.milestones.length > 0 && (
          <ul className="milestone-list">
            {data.milestones.map((item) => (
              <li key={`${item.kind}-${item.threshold}`}>
                <strong>{item.threshold.toLocaleString('en-IN')} readers</strong>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleDateString('en-IN', {
                    dateStyle: 'medium',
                    timeZone: 'Asia/Kolkata',
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="studio-next">
        <Link href={`/studio/${publication.id}/readers`}>See readers ↗</Link>
        <Link href={`/studio/${publication.id}/analytics`}>See email activity ↗</Link>
        <Link href={`/studio/${publication.id}/settings`}>Edit settings ↗</Link>
      </div>
    </div>
  );
}
