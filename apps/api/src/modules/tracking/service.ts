import { randomUUID } from 'node:crypto';
import type { TrackEvent, Queue } from '@vichaar/queue';
import { verifyTrackingToken } from '@vichaar/shared';
import type { createTrackingRepository } from './repository.js';

type TrackQueue = Queue<{ type: 'TrackBatch'; events: TrackEvent[] }>;
export function createTrackingService(deps: {
  secret: string;
  repo: ReturnType<typeof createTrackingRepository>;
  queue: TrackQueue;
  now?: () => Date;
  maxBuffered?: number;
}) {
  const now = deps.now ?? (() => new Date());
  const maxBuffered = deps.maxBuffered ?? 1000;
  const buffer: TrackEvent[] = [];
  let flushing = false;
  const metrics = { accepted: 0, dropped: 0, errors: 0 };
  async function flush() {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer.splice(0, 100);
    try {
      await deps.queue.send({ type: 'TrackBatch', events: batch });
    } catch {
      metrics.errors++;
      metrics.dropped += batch.length;
    } finally {
      flushing = false;
    }
  }
  function record(value: ReturnType<typeof verifyTrackingToken>, isPrefetch: boolean) {
    if (!value) return;
    if (buffer.length >= maxBuffered) {
      metrics.dropped++;
      return;
    }
    buffer.push({
      eventId: randomUUID(),
      publicationId: value.publicationId,
      postId: value.postId,
      subscriptionId: value.subscriptionId,
      linkId: value.linkId,
      eventType: value.kind,
      isPrefetch,
      occurredAt: now().toISOString(),
      correlationId: randomUUID(),
    });
    metrics.accepted++;
    if (buffer.length >= 100) void flush();
  }
  return {
    open(token: string, prefetch: boolean) {
      record(
        verifyTrackingToken(deps.secret, token, 'open', Math.floor(now().getTime() / 1000)),
        prefetch,
      );
    },
    async click(token: string, prefetch: boolean): Promise<string | null> {
      const value = verifyTrackingToken(
        deps.secret,
        token,
        'click',
        Math.floor(now().getTime() / 1000),
      );
      if (!value?.linkId) return null;
      const target = await deps.repo.findTarget(value.publicationId, value.postId, value.linkId);
      if (!target) return null;
      const url = new URL(target);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      record(value, prefetch);
      return target;
    },
    flush,
    metrics: () => ({ ...metrics, buffered: buffer.length }),
  };
}
