import { Router } from 'express';
import { z } from 'zod';
import { cursorPaginationSchema, postSlugSchema } from '@vichaar/shared/schemas';
import type { AuthService } from '../auth/index.js';
import { createPostSchema, updatePostSchema, publishPostSchema } from './schemas.js';
import type { PostService } from './service.js';

const uuid = z.string().uuid();
const subdomain = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/);
export function createPostRouter({
  postService,
  authService,
}: {
  postService: PostService;
  authService: AuthService;
}): Router {
  const router = Router({ mergeParams: true });
  router.post<{ pubId: string }>('/', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    res
      .status(201)
      .json(
        await postService.create(
          uuid.parse(req.params['pubId']),
          user.id,
          createPostSchema.parse(req.body),
        ),
      );
  });
  router.get<{ pubId: string }>('/', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    const query = cursorPaginationSchema.extend({ cursor: uuid.optional() }).parse(req.query);
    res.json(
      await postService.list(uuid.parse(req.params['pubId']), user.id, query.cursor, query.limit),
    );
  });
  router.get<{ pubId: string; postId: string }>('/:postId', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    res.json(
      await postService.get(
        uuid.parse(req.params['pubId']),
        user.id,
        uuid.parse(req.params.postId),
      ),
    );
  });
  router.patch<{ pubId: string; postId: string }>('/:postId', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    res.json(
      await postService.update(
        uuid.parse(req.params['pubId']),
        user.id,
        uuid.parse(req.params.postId),
        updatePostSchema.parse(req.body),
      ),
    );
  });
  router.post<{ pubId: string; postId: string }>('/:postId/publish', async (req, res) => {
    const user = await authService.authenticate(req.cookies?.vichaar_session);
    res
      .status(202)
      .json(
        await postService.publish(
          uuid.parse(req.params['pubId']),
          user.id,
          uuid.parse(req.params.postId),
          publishPostSchema.parse(req.body),
        ),
      );
  });
  return router;
}
export function createPublicPostRouter({ postService }: { postService: PostService }): Router {
  const router = Router({ mergeParams: true });
  router.get<{ subdomain: string; slug: string }>('/posts/:slug', async (req, res) => {
    const result = await postService.publicPreview(
      subdomain.parse(req.params['subdomain']),
      postSlugSchema.parse(req.params.slug),
    );
    res.setHeader('ETag', `"${z.object({ version: z.number() }).parse(result).version}"`);
    res.json(result);
  });
  return router;
}
