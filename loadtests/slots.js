import { randomUUID } from 'node:crypto';
import os from 'node:os';
import process from 'node:process';
import { URL } from 'node:url';
import { Console } from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabaseClients, runMigrations } from '../packages/db/src/index.ts';
import { createDeliveryRepository } from '../apps/workers/src/delivery-repository.ts';
import { createEmailProvider } from '../apps/workers/src/provider.ts';

const count = Number(process.env.SLOT_COHORT ?? '1000');
if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('SLOT_COHORT must be 1..10000');
const rootUrl = process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
if (!['localhost', '127.0.0.1'].includes(new URL(rootUrl).hostname)) throw new Error('Benchmark requires a local PostgreSQL host');
const databaseName = `vichaar_slots_bench_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const url = new URL(rootUrl);
url.pathname = `/${databaseName}`;
const admin = createDatabaseClients({ primaryUrl: rootUrl, maxConnections: 1 });
const provider = createEmailProvider({ mode: 'stub', production: false, smtpHost: 'localhost', smtpPort: 1025, region: 'us-east-1', verifiedAddresses: [] });
const output = new Console(process.stdout, process.stderr);
let db;
let created = false;
try {
  await admin.primaryPool.query(`CREATE DATABASE ${databaseName}`);
  created = true;
  await runMigrations(url.toString());
  db = createDatabaseClients({ primaryUrl: url.toString(), maxConnections: 4 });
  const pool = db.primaryPool;
  const ownerId = randomUUID();
  const pubId = randomUUID();
  const postId = randomUUID();
  await pool.query("INSERT INTO users(id,email,password_hash,display_name) VALUES($1,'slot-owner@example.test','stub','Bench')", [ownerId]);
  await pool.query('INSERT INTO publications(id,owner_id,name,subdomain,daily_send_limit) VALUES($1,$2,$3,$4,$5)', [pubId, ownerId, 'Slots', `slots-${pubId.slice(0, 8)}`, count]);
  await pool.query("INSERT INTO posts(id,publication_id,slug,title,status,published_at,delivery_month) VALUES($1,$2,'slots','Slots','published',now(),date_trunc('month',now())::date)", [postId, pubId]);
  await pool.query("INSERT INTO post_contents(post_id,publication_id,html_full,html_preview) VALUES($1,$2,'<p>Slots</p>','<p>Slots</p>')", [postId, pubId]);
  await pool.query("INSERT INTO subscriptions(id,publication_id,email,status,slot,timezone) SELECT gen_random_uuid(),$1,'slot-'||n||'@example.test','active',CASE WHEN n%3=0 THEN 'morning' WHEN n%3=1 THEN 'afternoon' ELSE 'evening' END,CASE WHEN n%4=0 THEN 'Asia/Kolkata' WHEN n%4=1 THEN 'America/New_York' WHEN n%4=2 THEN 'Europe/London' ELSE 'Asia/Tokyo' END FROM generate_series(1,$2::integer) n", [pubId, count]);
  const repo = createDeliveryRepository(pool);
  let cursor = null;
  do {
    cursor = await repo.fanout({ publicationId: pubId, postId, afterId: cursor, scheduledFor: null, sendImmediately: false, correlationId: 'phase7-slot-benchmark' });
  } while (cursor);
  // Move the computed slot cohort to a common due instant; the benchmark measures queue start lag.
  await pool.query('UPDATE post_deliveries SET send_at=now() WHERE publication_id=$1 AND post_id=$2', [pubId, postId]);
  const slotStart = Date.now();
  const lags = [];
  let tick = 0;
  while (lags.length < count && tick < 25) {
    const due = await repo.queueDue();
    if (due.length) {
      const claimed = await repo.claim(due);
      const startLag = Date.now() - slotStart;
      const results = await Promise.all(claimed.map(async (row) => ({
        key: { publicationId: row.publication_id, postId: row.post_id, subscriptionId: row.subscription_id, sendMonth: row.send_month },
        status: 'sent', messageId: await provider.send({ to: row.email, from: 'newsletter@vichaar.test', subject: 'Slot benchmark', html: '<p>Benchmark</p>', headers: {} }),
      })));
      await repo.record(results);
      lags.push(...claimed.map(() => startLag));
    }
    tick++;
    if (lags.length < count) await delay(Math.max(0, slotStart + tick * 15_000 - Date.now()));
  }
  lags.sort((a, b) => a - b);
  const p99Ms = lags[Math.ceil(lags.length * 0.99) - 1] ?? Infinity;
  const result = { date: new Date().toISOString(), hardware: { model: os.cpus()[0]?.model, logicalCpus: os.cpus().length, hostMemoryGiB: Math.round(os.totalmem() / 2 ** 30) }, provider: 'stub', cohort: count, started: lags.length, schedulerIntervalMs: 15_000, p99StartLagMs: p99Ms, withinFiveMinutesPercent: Math.round(lags.filter((lag) => lag <= 300_000).length / count * 10000) / 100, passed: lags.length === count && p99Ms <= 300_000, note: 'A time-shifted, precomputed slot cohort measures PostgreSQL scheduler plus claim start, with a stub provider. It excludes queue/network latency and delivery completion.' };
  output.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally {
  await provider.close();
  if (db) await db.close();
  if (created) await admin.primaryPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.close();
}
