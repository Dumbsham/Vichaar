import { Router, type Router as ExpressRouter } from 'express';
import type { AuthService } from '../auth/index.js';
import { milestonePublicationId } from './schemas.js';
import type { createMilestoneService } from './service.js';

export function createMilestoneRouter(
  service: ReturnType<typeof createMilestoneService>,
  auth: AuthService,
): ExpressRouter {
  const router = Router({ mergeParams: true });
  router.get<{ pubId: string }>('/milestones', async (req, res) => {
    const user = await auth.authenticate(req.cookies?.vichaar_session);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await service.list(milestonePublicationId.parse(req.params.pubId), user.id));
  });
  return router;
}
