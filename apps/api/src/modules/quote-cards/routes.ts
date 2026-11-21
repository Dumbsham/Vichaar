import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { postSlugSchema } from '@vichaar/shared/schemas';
import type { AuthService } from '../auth/index.js';
import type { QuoteCardService } from './service.js';
import { quoteCardHash, quoteCardInput } from './schemas.js';

export function createQuoteCardRouter(service: QuoteCardService, auth: AuthService): ExpressRouter {
  const router = Router({ mergeParams: true });
  const subdomain = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/);
  router.post<{ subdomain: string; slug: string }>('/posts/:slug/quote-cards', async (req, res) => {
    const user = req.cookies?.vichaar_session
      ? await auth.authenticate(req.cookies.vichaar_session)
      : undefined;
    const result = await service.create(
      subdomain.parse(req.params.subdomain),
      postSlugSchema.parse(req.params.slug),
      quoteCardInput.parse(req.body).quote,
      user?.id,
    );
    res.status(result.cached ? 200 : 201).json(result);
  });
  router.get<{ subdomain: string; slug: string; hash: string }>(
    '/posts/:slug/quote-cards/:hash.png',
    async (req, res) => {
      const png = await service.image(
        subdomain.parse(req.params.subdomain),
        postSlugSchema.parse(req.params.slug),
        quoteCardHash.parse(req.params.hash),
      );
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.type('image/png').send(png);
    },
  );
  return router;
}
