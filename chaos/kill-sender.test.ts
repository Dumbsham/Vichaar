import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createDatabaseClients, generateId } from '../packages/db/src/index.js';
import { createSqsQueues } from '../packages/queue/src/index.js';
import { createDeliveryRepository } from '../apps/workers/src/delivery-repository.js';
import { createPipeline } from '../apps/workers/src/pipeline.js';

const db = createDatabaseClients({
  primaryUrl: process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar',
});
afterAll(async () => {
  await db.close();
});

describe('kill-sender chaos', () => {
  it('flags an accepted in-flight send as unknown and suppresses redelivery', async () => {
    const userId = generateId();
    const publicationId = generateId();
    const postId = generateId();
    const subscriptionId = generateId();
    const client = await db.primaryPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)',
        [userId, `${userId}@example.test`, 'test-hash', 'Chaos'],
      );
      await client.query(
        'INSERT INTO publications(id,owner_id,name,subdomain) VALUES($1,$2,$3,$4)',
        [publicationId, userId, 'Chaos', `chaos-${randomUUID().slice(0, 12)}`],
      );
      await client.query(
        "INSERT INTO posts(id,publication_id,slug,title,status,published_at) VALUES($1,$2,'chaos','Chaos send','published',now())",
        [postId, publicationId],
      );
      await client.query(
        "INSERT INTO post_contents(post_id,publication_id,html_full) VALUES($1,$2,'<p>Chaos</p>')",
        [postId, publicationId],
      );
      await client.query(
        "INSERT INTO subscriptions(id,publication_id,email,status) VALUES($1,$2,$3,'active')",
        [subscriptionId, publicationId, `${subscriptionId}@example.test`],
      );
      await client.query(
        "INSERT INTO post_deliveries(post_id,subscription_id,send_month,publication_id,send_at) VALUES($1,$2,date_trunc('month',now())::date,$3,now()-interval '1 minute')",
        [postId, subscriptionId, publicationId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const repo = createDeliveryRepository(db.primaryPool);
    const queueSuffix = randomUUID().slice(0, 12);
    const queues = createSqsQueues({
      endpoint: 'http://localhost:9324',
      baseUrl: 'http://localhost:9324/queue',
      region: 'us-east-1',
      eventsName: `chaos-events-${queueSuffix}`,
      sendsName: `chaos-sends-${queueSuffix}`,
      hooksName: `chaos-hooks-${queueSuffix}`,
    });
    const keys = (await repo.queueDue()).filter((key) => key.postId === postId);
    expect(keys).toHaveLength(1);
    const directory = mkdtempSync(join(tmpdir(), 'vichaar-chaos-'));
    const receiptFile = join(directory, 'receipts.txt');
    const previousAccessKey = process.env.AWS_ACCESS_KEY_ID;
    const previousSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    try {
      await queues.createLocalQueues();
      await queues.sends.send({ type: 'SendBatch', keys, correlationId: postId });
      const exit = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        output: string;
      }>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'chaos/kill-sender-child.ts'], {
          cwd: process.cwd(),
          env: { ...process.env, CHAOS_RECEIPT_FILE: receiptFile, CHAOS_QUEUE_SUFFIX: queueSuffix },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.on('error', reject);
        child.on('exit', (code, signal) => resolve({ code, signal, output }));
      });
      expect(exit, exit.output).toMatchObject({ signal: 'SIGKILL' });
      expect(readFileSync(receiptFile, 'utf8')).toBe('accepted\n');
      const before = await db.primaryPool.query<{ status: string }>(
        'SELECT status FROM post_deliveries WHERE publication_id=$1 AND post_id=$2',
        [publicationId, postId],
      );
      expect(before.rows[0]?.status).toBe('sending');
      await db.primaryPool.query(
        "UPDATE post_deliveries SET updated_at=now()-interval '11 minutes' WHERE publication_id=$1 AND post_id=$2",
        [publicationId, postId],
      );
      expect((await repo.sweep()).unknown).toBeGreaterThanOrEqual(1);
      expect(await repo.claim(keys)).toHaveLength(0);
      await queues.sends.send({ type: 'SendBatch', keys, correlationId: postId });
      const pipeline = createPipeline({
        repo,
        events: queues.events,
        sends: queues.sends,
        provider: {
          async send() {
            throw new Error('Duplicate send');
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
      expect(readFileSync(receiptFile, 'utf8')).toBe('accepted\n');
      const after = await db.primaryPool.query<{ status: string; last_error: string }>(
        'SELECT status,last_error FROM post_deliveries WHERE publication_id=$1 AND post_id=$2',
        [publicationId, postId],
      );
      expect(after.rows[0]).toMatchObject({ status: 'failed', last_error: 'unknown_outcome' });
    } finally {
      await queues.deleteLocalQueues();
      queues.close();
      if (previousAccessKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = previousAccessKey;
      if (previousSecretKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
      else process.env.AWS_SECRET_ACCESS_KEY = previousSecretKey;
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
});
