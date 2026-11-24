import { confirmationToken, unsubscribeToken } from '@vichaar/shared/subscription-tokens';
import type { Queue, EventMessage, SendMessage, DeliveryKey, PageMessage } from '@vichaar/queue';
import type { RateLimiter } from '@vichaar/api/rate-limiter';
import type { DeliveryRepository, SendResult } from './delivery-repository.js';
import { EmailRejectedError, type EmailProvider } from './provider.js';
import type { WorkerMetrics } from './metrics.js';
import { withSpan } from './tracing.js';
import { signTrackingToken } from '@vichaar/shared';
import type { ObjectStorage } from '@vichaar/api/quote-cards';
import { logger } from '@vichaar/api/logger';

export interface PipelineDeps {
  repo: DeliveryRepository;
  events: Queue<EventMessage>;
  sends: Queue<SendMessage>;
  pages?: Queue<PageMessage>;
  provider: EmailProvider;
  rateLimiter: RateLimiter;
  tokenSecret: string;
  baseUrl: string;
  fromAddress: string;
  trackingBaseUrl?: string;
  trackingSecret?: string;
  metrics?: WorkerMetrics;
  cardStorage?: ObjectStorage;
}
function cleanHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ').slice(0, 200);
}
const group = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
};
export function createPipeline(deps: PipelineDeps) {
  const { repo, events, sends, provider, rateLimiter } = deps;
  const base = deps.baseUrl.replace(/\/$/, '');
  return {
    relay: () =>
      repo.relay(async (event) => {
        await events.send(event);
        if (deps.pages && (event.type === 'PostPublished' || event.type === 'PostUnpublished'))
          await deps.pages.send({
            type: event.type,
            eventId: event.eventId,
            publicationId: event.publicationId,
            postId: event.postId,
            correlationId: event.correlationId,
          });
      }),
    async fanoutOnce(): Promise<number> {
      const messages = await events.receive();
      for (const message of messages) {
        await withSpan('worker.event', message.body.correlationId, async () => {
          const event = message.body;
          if (event.type === 'SubscriptionConfirmationRequested') {
            const recipient = await repo.confirmation(
              event.publicationId,
              event.subscriptionId,
              event.exp,
            );
            if (recipient) {
              const token = confirmationToken(
                deps.tokenSecret,
                event.publicationId,
                event.subscriptionId,
                event.exp,
              );
              const manageToken = unsubscribeToken(
                deps.tokenSecret,
                event.publicationId,
                event.subscriptionId,
                Math.floor(Date.now() / 1000) + 365 * 86400,
              );
              try {
                await provider.send({
                  to: recipient.email,
                  from: deps.fromAddress,
                  subject: 'Confirm your Vichaar subscription',
                  html: `<p>Confirm your subscription: <a href="${base}/confirm?token=${token}">Confirm</a></p><p>After confirming, <a href="${base}/preferences/${manageToken}">set your delivery preferences</a>.</p>`,
                  headers: {},
                });
              } catch {
                throw new Error('Confirmation email failed');
              }
            }
          } else if (event.type === 'PostUnpublished') {
            if (!deps.cardStorage) throw new Error('Quote card storage is unavailable');
            const keys = await repo.cardKeys(event.publicationId, event.postId);
            for (const key of keys) await deps.cardStorage.delete(key);
            await repo.deleteCards(event.publicationId, event.postId);
          } else if (event.type === 'SubscriptionConfirmed') {
            const milestones = await repo.recordMilestones(event.publicationId);
            for (const milestone of milestones) {
              deps.metrics?.increment('milestones_created_total');
              try {
                await provider.send({
                  to: milestone.email,
                  from: deps.fromAddress,
                  subject: `${milestone.threshold} subscribers on Vichaar`,
                  html: `<p>${milestone.publicationName.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)} reached ${milestone.threshold} subscribers.</p>`,
                  headers: {},
                });
                deps.metrics?.increment('milestone_notifications_sent_total');
              } catch {
                deps.metrics?.increment('milestone_notifications_failed_total');
              }
            }
          } else {
            const input =
              event.type === 'PostPublished'
                ? {
                    publicationId: event.publicationId,
                    postId: event.postId,
                    afterId: null,
                    scheduledFor: event.scheduledFor,
                    sendImmediately: event.sendImmediately,
                    correlationId: event.correlationId,
                  }
                : event;
            const next = await withSpan('postgres.delivery.fanout', event.correlationId, () =>
              repo.fanout(input),
            );
            if (next)
              await events.send({
                type: 'FanoutPage',
                publicationId: input.publicationId,
                postId: input.postId,
                afterId: next,
                scheduledFor: input.scheduledFor,
                sendImmediately: input.sendImmediately,
                correlationId: event.correlationId,
              });
          }
          await events.delete(message.receipt);
          logger.info(
            { worker: 'fanout', eventType: event.type, correlationId: event.correlationId },
            'event processed',
          );
        });
      }
      return messages.length;
    },
    async scheduleOnce(): Promise<number> {
      await withSpan('postgres.delivery.release_scheduled', null, () => repo.releaseScheduled());
      const depth = await sends.depth();
      deps.metrics?.setQueueDepth(depth);
      if (depth > 10_000) return 0;
      const keys = await withSpan('postgres.delivery.queue_due', null, () => repo.queueDue());
      for (const batch of group(keys, 100))
        await sends.send({
          type: 'SendBatch',
          keys: batch,
          correlationId: batch[0]?.correlationId ?? batch[0]?.postId ?? '',
        });
      return keys.length;
    },
    async sendOnce(): Promise<number> {
      const messages = await sends.receive();
      for (const message of messages) {
        await withSpan('worker.send_batch', message.body.correlationId, async () => {
          const rows = await withSpan('postgres.delivery.claim', message.body.correlationId, () =>
            repo.claim(message.body.keys),
          );
          const links = rows.length ? await repo.trackedLinks(message.body.keys) : [];
          const linkIds = new Map(
            links.map((link) => [
              `${link.publication_id}:${link.post_id}:${link.target_url}`,
              link.id,
            ]),
          );
          const results: SendResult[] = [];
          for (const groupOfFive of group(rows, 5)) {
            const groupResults = await Promise.all(
              groupOfFive.map(async (row): Promise<SendResult> => {
                const key: DeliveryKey = {
                  publicationId: row.publication_id,
                  postId: row.post_id,
                  subscriptionId: row.subscription_id,
                  sendMonth: row.send_month,
                };
                if (
                  row.status !== 'active' ||
                  row.sending_status !== 'active' ||
                  row.post_status !== 'published' ||
                  row.suppressed
                ) {
                  return { key, status: 'skipped' };
                }
                const allowedGlobal = await withSpan(
                  'rate_limit.global',
                  message.body.correlationId,
                  () => rateLimiter.consume('provider-global', 100, 1),
                );
                const allowedPublication = await withSpan(
                  'rate_limit.publication',
                  message.body.correlationId,
                  () => rateLimiter.consume(`publication:${row.publication_id}`, 50, 1),
                );
                if (!allowedGlobal || !allowedPublication) {
                  return {
                    key,
                    status: 'pending',
                    error: 'rate_limited',
                    sendAt: new Date(Date.now() + 15_000),
                  };
                }
                const token = unsubscribeToken(
                  deps.tokenSecret,
                  row.publication_id,
                  row.subscription_id,
                  Math.floor(Date.now() / 1000) + 365 * 86400,
                );
                const unsubscribeUrl = `${base}/unsubscribe/${token}`;
                const oneClickUrl = `${unsubscribeUrl}/one-click`;
                const preferencesUrl = `${base}/preferences/${token}`;
                const postUrl = `${base}/p/${encodeURIComponent(row.subdomain)}/${encodeURIComponent(row.slug)}`;
                const expiry = Math.floor(Date.now() / 1000) + 365 * 86400;
                const trackBase = (deps.trackingBaseUrl ?? 'http://localhost:4001').replace(
                  /\/$/,
                  '',
                );
                const trackingSecret = deps.trackingSecret ?? deps.tokenSecret;
                const htmlBody = (row.access === 'paid' ? row.html_preview : row.html_full).replace(
                  /href="([^"]+)"/g,
                  (original, target: string) => {
                    const linkId = linkIds.get(`${row.publication_id}:${row.post_id}:${target}`);
                    if (!linkId) return original;
                    const clickToken = signTrackingToken(trackingSecret, {
                      publicationId: row.publication_id,
                      postId: row.post_id,
                      subscriptionId: row.subscription_id,
                      linkId,
                      kind: 'click',
                      exp: expiry,
                    });
                    return `href="${trackBase}/t/c/${clickToken}"`;
                  },
                );
                const openToken = signTrackingToken(trackingSecret, {
                  publicationId: row.publication_id,
                  postId: row.post_id,
                  subscriptionId: row.subscription_id,
                  linkId: null,
                  kind: 'open',
                  exp: expiry,
                });
                try {
                  const messageId = await provider.send({
                    to: row.email,
                    from: deps.fromAddress,
                    subject: cleanHeader(row.title),
                    html: `${htmlBody}<p><a href="${postUrl}">Read online</a></p><p><a href="${unsubscribeUrl}">Unsubscribe</a> · <a href="${preferencesUrl}">Delivery preferences</a></p><img src="${trackBase}/t/o/${openToken}.gif" width="1" height="1" alt="">`,
                    headers: {
                      'List-Unsubscribe': `<${oneClickUrl}>`,
                      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                    },
                  });
                  return { key, status: 'sent', messageId };
                } catch (error) {
                  if (error instanceof EmailRejectedError) {
                    if (!error.retryable)
                      return { key, status: 'failed', error: 'permanent_rejection' };
                    if (row.attempts >= 5)
                      return { key, status: 'failed', error: 'retry_exhausted' };
                    const baseDelay = Math.min(900_000, 30_000 * 2 ** (row.attempts - 1));
                    const jitter = Math.floor(Math.random() * Math.min(15_000, baseDelay));
                    return {
                      key,
                      status: 'pending',
                      error: 'temporary_rejection',
                      sendAt: new Date(Date.now() + baseDelay + jitter),
                    };
                  }
                  return { key, status: 'failed', error: 'unknown_outcome' };
                }
              }),
            );
            results.push(...groupResults);
          }
          await withSpan('postgres.delivery.record', message.body.correlationId, () =>
            repo.record(results),
          );
          deps.metrics?.increment('sender_emails_total', results.length);
          for (const result of results) {
            if (result.status === 'sent') deps.metrics?.increment('sender_sent_total');
            if (result.status === 'skipped') deps.metrics?.increment('sender_skipped_total');
            if (result.status === 'pending') deps.metrics?.increment('sender_retried_total');
            if (result.status === 'failed') deps.metrics?.increment('sender_failed_total');
            if (result.error === 'unknown_outcome')
              deps.metrics?.increment('sender_unknown_outcome_total');
          }
          await sends.delete(message.receipt);
          logger.info(
            {
              worker: 'sender',
              correlationId: message.body.correlationId,
              sent: results.filter((result) => result.status === 'sent').length,
              failed: results.filter((result) => result.status === 'failed').length,
            },
            'send batch processed',
          );
        });
      }
      return messages.length;
    },
    sweep: () => repo.sweep(),
  };
}
