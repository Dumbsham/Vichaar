import express from 'express';
import helmet from 'helmet';
import { createDatabaseClients } from '@vichaar/db';
import { createSqsQueues } from '@vichaar/queue';
import {
  createTrackingRepository,
  createTrackingRouter,
  createTrackingService,
} from './modules/tracking/index.js';

const secret =
  process.env.TRACKING_HMAC_SECRET ??
  (process.env.NODE_ENV === 'production'
    ? undefined
    : 'local_development_tracking_secret_32chars_min!');
if (!secret || secret.length < 32)
  throw new Error('TRACKING_HMAC_SECRET must be at least 32 characters');
const database = createDatabaseClients({
  primaryUrl: process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar',
  maxConnections: 2,
});
const queues = createSqsQueues({
  endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:9324',
  baseUrl: process.env.SQS_QUEUE_BASE_URL ?? 'http://localhost:9324/queue',
  region: process.env.AWS_REGION ?? 'us-east-1',
});
const service = createTrackingService({
  secret,
  repo: createTrackingRepository(database.primaryPool),
  queue: queues.tracks,
});
const app = express();
app.use(helmet());
app.use('/t', createTrackingRouter(service));
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/metrics', (_req, res) => {
  const m = service.metrics();
  res
    .type('text/plain')
    .send(
      `vichaar_tracking_accepted_total ${m.accepted}\nvichaar_tracking_dropped_total ${m.dropped}\nvichaar_tracking_errors_total ${m.errors}\nvichaar_tracking_buffered ${m.buffered}\n`,
    );
});
const server = app.listen(Number(process.env.TRACKING_PORT) || 4001);
const interval = setInterval(() => {
  void service.flush();
}, 200);
async function close() {
  clearInterval(interval);
  await service.flush();
  server.close();
  queues.close();
  await database.close();
}
process.on('SIGTERM', () => {
  void close();
});
process.on('SIGINT', () => {
  void close();
});
