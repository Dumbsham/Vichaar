import { Router, type Router as ExpressRouter } from 'express';
import type { SubscriptionService } from './service.js';
import { subscribeSchema, confirmSchema, preferencesSchema } from './schemas.js';
import { z } from 'zod';
import type { AuthService } from '../auth/index.js';

export function createReaderRouter(service: SubscriptionService, auth: AuthService): ExpressRouter {
  const router = Router({ mergeParams: true });
  router.get<{ pubId: string }>('/readers', async (req, res) => {
    const user = await auth.authenticate(req.cookies?.vichaar_session);
    const publicationId = z.string().uuid().parse(req.params.pubId);
    const query = z
      .object({
        cursor: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(25),
      })
      .parse(req.query);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await service.listReaders(publicationId, user.id, query.cursor, query.limit));
  });
  return router;
}

export function createSubscriptionRouter({
  service,
}: {
  service: SubscriptionService;
}): ExpressRouter {
  const router = Router({ mergeParams: true });
  router.post('/subscribe', async (req, res) => {
    await service.subscribe(
      z.object({ subdomain: z.string() }).parse(req.params).subdomain,
      subscribeSchema.parse(req.body),
      z.string().parse(req.headers['x-correlation-id']),
    );
    res.status(202).json({ message: 'If this address can subscribe, check your inbox.' });
  });
  return router;
}
export function createConfirmationRouter({
  service,
}: {
  service: SubscriptionService;
}): ExpressRouter {
  const router = Router();
  router.post('/confirm', async (req, res) => {
    await service.confirm(
      confirmSchema.parse(req.body).token,
      z.string().parse(req.headers['x-correlation-id']),
    );
    res.status(204).end();
  });
  router.post('/unsubscribe/:token', async (req, res) => {
    await service.unsubscribe(confirmSchema.parse(req.params).token);
    res.status(204).end();
  });
  router.post('/preferences/:token', async (req, res) => {
    await service.updatePreferences(
      z.object({ token: z.string() }).parse(req.params).token,
      preferencesSchema.parse(req.body),
    );
    res.status(204).end();
  });
  router.get('/preferences/:token', (req, res) => {
    const token = z
      .object({ token: z.string().regex(/^[A-Za-z0-9._-]{1,2048}$/) })
      .parse(req.params).token;
    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Delivery preferences</title><h1>Delivery preferences</h1><form method="post" action="/subscriptions/preferences/${token}"><label>Slot <select name="slot"><option>morning</option><option>afternoon</option><option>evening</option></select></label><label>Timezone <input name="timezone" value="Asia/Kolkata" required></label><button>Save</button></form>`,
      );
  });
  return router;
}
