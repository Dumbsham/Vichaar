import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AppContainer } from './container.js';
import { logger } from './shared/logger.js';
import { createHealthRouter } from './modules/health/index.js';

export function createServer(container: AppContainer): Express {
  const app = express();

  // 1. Correlation ID
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  });

  // 2. Request Logging (pino-http)
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: IncomingMessage) =>
        (req.headers['x-correlation-id'] as string) || randomUUID(),
    }),
  );

  // 3. Security Headers (helmet)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );

  // 4. CORS
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || true,
      credentials: true,
    }),
  );

  // Body Parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Health and Readiness endpoints (mounted at root)
  const healthRouter = createHealthRouter({ healthService: container.healthService });
  app.use('/', healthRouter);

  // Base API v1 router placeholder
  const apiV1Router = express.Router();
  apiV1Router.get('/ping', (_req, res) => {
    res.json({ message: 'pong' });
  });
  app.use('/api/v1', apiV1Router);

  // 404 handler for unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
      },
    });
  });

  // Central Error Handler (never leak stack traces)
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = res.getHeader('x-correlation-id') || 'unknown';
    req.log?.error({ err, correlationId }, 'Unhandled request error');

    const status = 500;
    res.status(status).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred',
        requestId: correlationId,
      },
    });
  });

  return app;
}
