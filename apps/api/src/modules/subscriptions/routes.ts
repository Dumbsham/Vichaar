import { Router, type Router as ExpressRouter } from 'express';
import type { SubscriptionService } from './service.js';
import { subscribeSchema, confirmSchema, preferencesSchema } from './schemas.js';
import { z } from 'zod';

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
    await service.confirm(confirmSchema.parse(req.body).token);
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
