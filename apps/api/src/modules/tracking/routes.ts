import { Router } from 'express';
import type { createTrackingService } from './service.js';
import { trackingPathToken } from './schemas.js';

const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
export function createTrackingRouter(service: ReturnType<typeof createTrackingService>): Router {
  const router = Router();
  router.get('/o/:token.gif', (req, res) => {
    const token = trackingPathToken.safeParse(req.params.token);
    if (token.success)
      service.open(token.data, /prefetch|preview|bot/i.test(req.get('user-agent') ?? ''));
    res.setHeader('Cache-Control', 'no-store');
    res.type('gif').send(gif);
  });
  router.get('/c/:token', async (req, res) => {
    let target: string | null = null;
    try {
      const token = trackingPathToken.safeParse(req.params.token);
      if (token.success)
        target = await service.click(
          token.data,
          /prefetch|preview|bot/i.test(req.get('user-agent') ?? ''),
        );
    } catch {
      /* Analytics lookup failure must not expose an unverified redirect. */
    }
    if (!target) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, target);
  });
  return router;
}
