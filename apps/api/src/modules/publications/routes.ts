import { Router } from 'express';
import { z } from 'zod';
import { cursorPaginationSchema } from '@vichaar/shared/schemas';
import { createPublicationSchema, updatePublicationSchema } from './schemas.js';
import type { PublicationService } from './service.js';
import type { AuthService } from '../auth/index.js';

const idSchema = z.string().uuid();
export function createPublicationRouter({
  publicationService,
  authService,
}: {
  publicationService: PublicationService;
  authService: AuthService;
}): Router {
  const router = Router();
  router.post('/', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    const result = await publicationService.create(
      user.id,
      createPublicationSchema.parse(req.body),
    );
    res.status(201).json(result);
  });
  router.get('/', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    const query = cursorPaginationSchema
      .extend({ cursor: z.string().uuid().optional() })
      .parse(req.query);
    res.json(await publicationService.listOwned(user.id, query.cursor, query.limit));
  });
  router.get('/:pubId', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    res.json(await publicationService.getOwned(idSchema.parse(req.params.pubId), user.id));
  });
  router.patch('/:pubId', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    res.json(
      await publicationService.update(
        idSchema.parse(req.params.pubId),
        user.id,
        updatePublicationSchema.parse(req.body),
      ),
    );
  });
  return router;
}
