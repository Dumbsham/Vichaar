import { confirmationToken, unsubscribeToken } from '@vichaar/shared/subscription-tokens';
import type { Queue, EventMessage, SendMessage, DeliveryKey } from '@vichaar/queue';
import type { RateLimiter } from '@vichaar/api/rate-limiter';
import type { DeliveryRepository, SendResult } from './delivery-repository.js';
import { EmailRejectedError, type EmailProvider } from './provider.js';
import type { WorkerMetrics } from './metrics.js';
import { withSpan } from './tracing.js';

export interface PipelineDeps {
  repo: DeliveryRepository;
  events: Queue<EventMessage>;
  sends: Queue<SendMessage>;
  provider: EmailProvider;
  rateLimiter: RateLimiter;
  tokenSecret: string;
  baseUrl: string;
  fromAddress: string;
  metrics?: WorkerMetrics;
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
    relay: () => repo.relay((event) => events.send(event)),
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
                  html: `<p>Confirm your subscription: <a href="${base}/subscribe-demo?token=${token}">Confirm</a></p><p>After confirming, <a href="${base}/subscriptions/preferences/${manageToken}">set your delivery preferences</a>.</p>`,
                  headers: {},
                });
              } catch {
                throw new Error('Confirmation email failed');
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
            const next = await repo.fanout(input);
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
        });
      }
      return messages.length;
    },
    async scheduleOnce(): Promise<number> {
      await repo.releaseScheduled();
      const depth = await sends.depth();
      deps.metrics?.setQueueDepth(depth);
      if (depth > 10_000) return 0;
      const keys = await repo.queueDue();
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
          const rows = await repo.claim(message.body.keys);
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
                const preferencesUrl = `${base}/subscriptions/preferences/${token}`;
                const postUrl = `${base}/public/${encodeURIComponent(row.subdomain)}/posts/${encodeURIComponent(row.slug)}`;
                try {
                  const messageId = await provider.send({
                    to: row.email,
                    from: deps.fromAddress,
                    subject: cleanHeader(row.title),
                    html: `${row.access === 'paid' ? row.html_preview : row.html_full}<p><a href="${postUrl}">Read online</a></p><p><a href="${unsubscribeUrl}">Unsubscribe</a> · <a href="${preferencesUrl}">Delivery preferences</a></p>`,
                    headers: {
                      'List-Unsubscribe': `<${unsubscribeUrl}>`,
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
          await repo.record(results);
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
        });
      }
      return messages.length;
    },
    sweep: () => repo.sweep(),
  };
}
