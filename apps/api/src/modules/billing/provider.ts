import { z } from 'zod';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { providerSubscriptionSchema, type ProviderSubscription } from './schemas.js';

const tracer = trace.getTracer('vichaar.api.billing');
async function withBillingSpan<T>(operation: string, work: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(operation, async (span) => {
    try {
      return await work();
    } catch (error) {
      span.recordException(new Error('Razorpay request failed'));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export interface BillingProvider {
  createPlan(name: string, pricePaise: number): Promise<string>;
  createSubscription(
    planId: string,
    publicationId: string,
    subscriptionId: string,
  ): Promise<ProviderSubscription>;
  fetchSubscription(providerId: string): Promise<ProviderSubscription>;
  cancelSubscription(providerId: string): Promise<ProviderSubscription>;
}
export function createRazorpayProvider(keyId: string, keySecret: string): BillingProvider {
  if (!/^rzp_test_[A-Za-z0-9]+$/.test(keyId) || !keySecret || keySecret.includes('placeholder'))
    throw new Error('Real Razorpay test-mode credentials are required for billing');
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  async function call(method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> {
    return withBillingSpan(`razorpay.${method.toLowerCase()}`, async () => {
      const attempts = method === 'GET' ? 3 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
            method,
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(3000),
          });
          if (!response.ok) throw new Error(`Razorpay HTTP ${response.status}`);
          return await response.json();
        } catch (error) {
          if (attempt === attempts - 1) throw error;
          await new Promise<void>((resolve) =>
            setTimeout(resolve, 100 * 2 ** attempt + Math.floor(Math.random() * 50)),
          );
        }
      }
      throw new Error('Razorpay request failed');
    });
  }
  return {
    async createPlan(name, pricePaise) {
      const result = await call('POST', 'plans', {
        period: 'monthly',
        interval: 1,
        item: { name, amount: pricePaise, currency: 'INR' },
      });
      return z.object({ id: z.string().regex(/^plan_[A-Za-z0-9]+$/) }).parse(result).id;
    },
    async createSubscription(planId, publicationId, subscriptionId) {
      return providerSubscriptionSchema.parse(
        await call('POST', 'subscriptions', {
          plan_id: planId,
          total_count: 12,
          quantity: 1,
          customer_notify: false,
          notes: { publication_id: publicationId, subscription_id: subscriptionId },
        }),
      );
    },
    async fetchSubscription(providerId) {
      return providerSubscriptionSchema.parse(
        await call('GET', `subscriptions/${encodeURIComponent(providerId)}`),
      );
    },
    async cancelSubscription(providerId) {
      return providerSubscriptionSchema.parse(
        await call('POST', `subscriptions/${encodeURIComponent(providerId)}/cancel`, {
          cancel_at_cycle_end: 1,
        }),
      );
    },
  };
}
