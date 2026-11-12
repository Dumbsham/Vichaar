import { Router } from 'express';
import { analyticsPublicationId } from './schemas.js';
import type { AuthService } from '../auth/index.js';
import type { createAnalyticsService } from './service.js';

export function createAnalyticsRouter(
  service: ReturnType<typeof createAnalyticsService>,
  auth: AuthService,
): Router {
  const router = Router({ mergeParams: true });
  router.get<{ pubId: string }>('/stats', async (req, res) => {
    const user = await auth.authenticate(req.cookies?.vichaar_session);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      data: await service.stats(analyticsPublicationId.parse(req.params.pubId), user.id),
    });
  });
  return router;
}
