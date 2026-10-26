import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ZodError, z } from 'zod';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  ValidationError,
  isAppError,
} from '@vichaar/shared/errors';
import type { AppContainer } from './container.js';
import { logger } from './shared/logger.js';
import { createHealthRouter } from './modules/health/index.js';
import { createAuthRouter } from './modules/auth/index.js';
import { createPublicationRouter } from './modules/publications/index.js';
import { createPostRouter, createPublicPostRouter } from './modules/posts/index.js';

export function createServer(container: AppContainer): Express {
  const app = express();
  const trustedProxy = process.env.TRUST_PROXY?.trim();
  if (trustedProxy) app.set('trust proxy', trustedProxy);
  const rateLimiter = container.rateLimiter;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const raw = req.headers['x-correlation-id'];
    const correlationId =
      typeof raw === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(raw) ? raw : randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: IncomingMessage) => req.headers['x-correlation-id'] as string,
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? false, credentials: true }));
  app.use(async (req, _res, next) => {
    if ((req.path === '/auth/login' || req.path === '/auth/signup') && rateLimiter) {
      const allowed = await rateLimiter.consume(req.ip ?? 'unknown', 10, 60);
      if (!allowed) {
        next(new AppError('Too many authentication attempts', 429, 'RATE_LIMITED'));
        return;
      }
    }
    next();
  });
  app.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      const allowed = process.env.CORS_ORIGIN;
      if (
        origin &&
        (allowed
          ? origin !== allowed
          : origin !== `http://${req.get('host')}` && origin !== `https://${req.get('host')}`)
      ) {
        next(new ForbiddenError('Invalid request origin'));
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use('/', createHealthRouter({ healthService: container.healthService }));
  const { authService, publicationService, postService } = container;
  if (authService && publicationService && postService) {
    app.use('/auth', createAuthRouter({ authService }));
    app.use('/publications/:pubId', async (req, _res, next) => {
      const user = await authService.authenticate(req.cookies?.vichaar_session);
      await publicationService.getOwned(z.string().uuid().parse(req.params.pubId), user.id);
      next();
    });
    app.use('/public/:subdomain', async (req, _res, next) => {
      await publicationService.getBySubdomain(
        z.string().min(3).max(30).parse(req.params.subdomain),
      );
      next();
    });
    app.use('/publications', createPublicationRouter({ publicationService, authService }));
    app.use('/publications/:pubId/posts', createPostRouter({ postService, authService }));
    app.use('/public/:subdomain', createPublicPostRouter({ postService }));
  }
  const apiV1Router = express.Router();
  apiV1Router.get('/ping', (_req, res) => res.json({ message: 'pong' }));
  app.use('/api/v1', apiV1Router);
  app.use((_req: Request, res: Response) =>
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found' } }),
  );
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = res.getHeader('x-correlation-id') || 'unknown';
    if (err instanceof ZodError) err = new ValidationError('Invalid request data');
    if (err instanceof SyntaxError && 'body' in err) err = new ValidationError('Invalid JSON');
    if (isAppError(err)) {
      res
        .status(err.statusCode)
        .json({ error: { code: err.code, message: err.message, requestId: correlationId } });
      return;
    }
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
      const conflict = new ConflictError();
      res.status(conflict.statusCode).json({
        error: { code: conflict.code, message: conflict.message, requestId: correlationId },
      });
      return;
    }
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      typeof err.code === 'string' &&
      (err.code.startsWith('08') || ['57014', '57P01', '53300'].includes(err.code))
    ) {
      req.log?.error({ err, correlationId }, 'Database unavailable');
      res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service temporarily unavailable',
          requestId: correlationId,
        },
      });
      return;
    }
    req.log?.error({ err, correlationId }, 'Unhandled request error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred',
        requestId: correlationId,
      },
    });
  });
  return app;
}
