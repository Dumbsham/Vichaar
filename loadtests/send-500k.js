import { randomUUID } from 'node:crypto';
import os from 'node:os';
import process from 'node:process';
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Console } from 'node:console';
import { createDatabaseClients, runMigrations } from '../packages/db/src/index.ts';
import { createDeliveryRepository } from '../apps/workers/src/delivery-repository.ts';
import { createPipeline } from '../apps/workers/src/pipeline.ts';
import { createEmailProvider } from '../apps/workers/src/provider.ts';

const count = Number(process.env.BENCH_SUBSCRIBERS ?? '500000');
if (!Number.isInteger(count) || count < 1 || count > 500000) throw new Error('BENCH_SUBSCRIBERS must be 1..500000');
const rootUrl = process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
if (!['localhost', '127.0.0.1'].includes(new URL(rootUrl).hostname)) throw new Error('Benchmark requires a local PostgreSQL host');
const databaseName = `vichaar_send_bench_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const url = new URL(rootUrl);
url.pathname = `/${databaseName}`;
const admin = createDatabaseClients({ primaryUrl: rootUrl, maxConnections: 1 });
let db;
let created = false;
const startedAt = new Date().toISOString();
const cpuStarted = process.cpuUsage();
const pubId = randomUUID();
const postId = randomUUID();
const ownerId = randomUUID();
const provider = createEmailProvider({ mode: 'stub', production: false, smtpHost: 'localhost', smtpPort: 1025, region: 'us-east-1', verifiedAddresses: [] });
const output = new Console(process.stdout, process.stderr);
try {
  await admin.primaryPool.query(`CREATE DATABASE ${databaseName}`);
  created = true;
  await runMigrations(url.toString());
  db = createDatabaseClients({ primaryUrl: url.toString(), maxConnections: 4 });
  const pool = db.primaryPool;
  await pool.query("INSERT INTO users(id,email,password_hash,display_name) VALUES($1,'bench-owner@example.test','stub','Bench')", [ownerId]);
  await pool.query('INSERT INTO publications(id,owner_id,name,subdomain,daily_send_limit) VALUES($1,$2,$3,$4,$5)', [pubId, ownerId, 'Bench', `bench-${pubId.slice(0, 8)}`, count]);
  await pool.query("INSERT INTO posts(id,publication_id,slug,title,status,published_at,delivery_month) VALUES($1,$2,'bench','Benchmark','published',now(),date_trunc('month',now())::date)", [postId, pubId]);
  await pool.query("INSERT INTO post_contents(post_id,publication_id,html_full,html_preview) VALUES($1,$2,'<p>Benchmark</p>','<p>Preview</p>')", [postId, pubId]);
  const seedStarted = performance.now();
  for (let first = 1; first <= count; first += 5000)
    await pool.query("INSERT INTO subscriptions(id,publication_id,email,status) SELECT gen_random_uuid(),$1,'bench-'||n||'@example.test','active' FROM generate_series($2::integer,$3::integer) n", [pubId, first, Math.min(count, first + 4999)]);
  const seedMs = performance.now() - seedStarted;
  const repo = createDeliveryRepository(pool);
  const fanoutStarted = performance.now();
  let afterId = null;
  let pages = 0;
  do {
    afterId = await repo.fanout({ publicationId: pubId, postId, afterId, scheduledFor: null, sendImmediately: true, correlationId: 'phase7-benchmark' });
    pages++;
  } while (afterId);
  const fanoutMs = performance.now() - fanoutStarted;
  const total = Number((await pool.query('SELECT count(*)::integer AS count FROM post_deliveries WHERE publication_id=$1 AND post_id=$2', [pubId, postId])).rows[0].count);
  if (total !== count) throw new Error(`Fanout mismatch: ${total} of ${count}`);
  let message = null;
  const sends = {
    async send() { throw new Error('Benchmark send queue is receive-only'); },
    async receive() { const result = message; message = null; return result ? [{ body: result, receipt: 'benchmark' }] : []; },
    async delete() {},
    async depth() { return 0; },
  };
  const pipeline = createPipeline({
    repo, events: sends, sends, provider,
    rateLimiter: { async consume() { return true; }, async close() {} },
    tokenSecret: 'phase7_benchmark_token_secret_32_chars',
    baseUrl: 'http://localhost:4000', fromAddress: 'newsletter@vichaar.test',
  });
  const sendStarted = performance.now();
  let sent = 0;
  let cursor = null;
  while (sent < count) {
    const page = await pool.query(
      "SELECT subscription_id,to_char(send_month,'YYYY-MM-DD') AS send_month FROM post_deliveries WHERE publication_id=$1 AND post_id=$2 AND ($3::uuid IS NULL OR subscription_id>$3::uuid) ORDER BY subscription_id LIMIT 100",
      [pubId, postId, cursor],
    );
    if (!page.rows.length) throw new Error(`Delivery cursor ended at ${sent}`);
    cursor = page.rows.at(-1).subscription_id;
    const keys = page.rows.map((row) => ({ publicationId: pubId, postId, subscriptionId: row.subscription_id, sendMonth: row.send_month }));
    await pool.query("UPDATE post_deliveries SET status='queued' WHERE publication_id=$1 AND post_id=$2 AND subscription_id=ANY($3::uuid[]) AND status='pending'", [pubId, postId, keys.map((key) => key.subscriptionId)]);
    message = { type: 'SendBatch', keys, correlationId: 'phase7-benchmark' };
    const processed = await pipeline.sendOnce();
    if (processed !== 1) throw new Error(`Sender consumed ${processed} batches`);
    sent += keys.length;
    if (sent % 50000 === 0 || sent === count) process.stderr.write(`sent ${sent}/${count}\n`);
  }
  const sendMs = performance.now() - sendStarted;
  const confirmed = Number((await pool.query("SELECT count(*)::integer AS count FROM post_deliveries WHERE publication_id=$1 AND post_id=$2 AND status='sent'", [pubId, postId])).rows[0].count);
  if (confirmed !== count) throw new Error(`Sent-state mismatch: ${confirmed} of ${count}`);
  const cpu = process.cpuUsage(cpuStarted);
  output.log(JSON.stringify({ date: startedAt, hardware: { model: os.cpus()[0]?.model, logicalCpus: os.cpus().length, hostMemoryGiB: Math.round(os.totalmem() / 2 ** 30) }, provider: 'stub', subscribers: count, fanoutPages: pages, seedMs, fanoutMs, fanoutPerSecond: count / (fanoutMs / 1000), senderMs: sendMs, senderPerSecond: count / (sendMs / 1000), cpuMsPerEmail: (cpu.user + cpu.system) / 1000 / count, confirmedSent: confirmed, note: 'Sender uses actual pipeline and PostgreSQL claim/record; in-memory queue and permissive rate limiter isolate raw stub capacity from production SQS and provider limits.' }));
} finally {
  await provider.close();
  if (db) await db.close();
  if (created) await admin.primaryPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.close();
}
