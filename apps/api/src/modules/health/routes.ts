import { Router } from 'express';
import { HealthService } from './service.js';

export function createHealthRouter({
  healthService,
}: {
  healthService: HealthService;
}): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    const liveness = healthService.getLiveness();
    res.status(200).json(liveness);
  });

  router.get('/readyz', async (_req, res) => {
    const readiness = await healthService.getReadiness();
    const statusCode = readiness.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(readiness);
  });

  return router;
}
