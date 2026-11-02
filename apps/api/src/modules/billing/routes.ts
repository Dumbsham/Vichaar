import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { UnauthorizedError, ValidationError } from '@vichaar/shared/errors';
import type { AuthService } from '../auth/index.js';
import type { BillingService } from './service.js';
import { webhookSchema } from './schemas.js';

const uuid = z.string().uuid();
const subdomain = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/);
export function createCheckoutRouter(service: BillingService, auth: AuthService): Router {
  const router = Router({ mergeParams: true });
  router.post<{ subdomain: string }>('/checkout', async (req, res) => {
    const user = await auth.authenticate(req.cookies?.vichaar_session);
    res
      .status(201)
      .json(await service.checkout(subdomain.parse(req.params['subdomain']), user.id, user.email));
  });
  return router;
}
export function createMyBillingRouter(service: BillingService, auth: AuthService): Router {
  const router = Router();
  router.get('/subscriptions', async (req, res) => {
    const user = await auth.authenticate(req.cookies?.vichaar_session);
    const cursor = z.string().uuid().optional().parse(req.query.cursor);
    const publicationId = uuid.parse(req.query.publicationId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await service.list(publicationId, user.id, cursor));
  });
  router.post('/subscriptions/:id/cancel', async (req, res) => {
    const user = await auth.authenticate(req.cookies?.vichaar_session);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(
      await service.cancel(uuid.parse(req.body.publicationId), user.id, uuid.parse(req.params.id)),
    );
  });
  return router;
}
export function createRazorpayWebhookRouter(
  service: BillingService,
  secret: string,
  enqueue: (id: string, correlationId: string) => Promise<void>,
): Router {
  const router = Router();
  router.post('/razorpay', async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new UnauthorizedError('Invalid webhook');
    const signature = req.get('x-razorpay-signature');
    const eventId = req.get('x-razorpay-event-id');
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature) || !eventId || eventId.length > 128)
      throw new UnauthorizedError('Invalid webhook');
    const expected = createHmac('sha256', secret).update(req.body).digest();
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected))
      throw new UnauthorizedError('Invalid webhook');
    let decoded: unknown;
    try {
      decoded = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw new ValidationError('Invalid webhook JSON');
    }
    const payload = webhookSchema.parse(decoded);
    const id = await service.receiveWebhook(eventId, payload);
    await enqueue(id, z.string().parse(req.headers['x-correlation-id']));
    res.status(200).end();
  });
  return router;
}
