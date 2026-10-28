import { appendFileSync } from 'node:fs';
import { createDatabaseClients } from '../packages/db/src/index.js';
import { createSqsQueues } from '../packages/queue/src/index.js';
import { createDeliveryRepository } from '../apps/workers/src/delivery-repository.js';
import { createPipeline } from '../apps/workers/src/pipeline.js';

const receiptFile = process.env.CHAOS_RECEIPT_FILE;
if (!receiptFile) throw new Error('CHAOS_RECEIPT_FILE is required');
const db = createDatabaseClients({
  primaryUrl: process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar',
  maxConnections: 2,
});
const queueSuffix = process.env.CHAOS_QUEUE_SUFFIX;
if (!queueSuffix) throw new Error('CHAOS_QUEUE_SUFFIX is required');
const queues = createSqsQueues({
  endpoint: 'http://localhost:9324',
  baseUrl: 'http://localhost:9324/queue',
  region: 'us-east-1',
  eventsName: `chaos-events-${queueSuffix}`,
  sendsName: `chaos-sends-${queueSuffix}`,
});
const pipeline = createPipeline({
  repo: createDeliveryRepository(db.primaryPool),
  events: queues.events,
  sends: queues.sends,
  provider: {
    async send() {
      appendFileSync(receiptFile, 'accepted\n');
      process.kill(process.pid, 'SIGKILL');
      return 'never';
    },
    async close() {},
  },
  rateLimiter: {
    async consume() {
      return true;
    },
    async close() {},
  },
  tokenSecret: 'local_development_hmac_secret_32chars_min!',
  baseUrl: 'http://localhost:4000',
  fromAddress: 'newsletter@vichaar.test',
});
await pipeline.sendOnce();
