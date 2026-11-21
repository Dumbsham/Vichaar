import { randomUUID } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signTrackingToken } from '@vichaar/shared';
import { createSqsQueues } from '@vichaar/queue';
import { createDatabaseClients, runMigrations } from '../packages/db/src/index.js';
import { createTrackingRepository, createTrackingRouter, createTrackingService } from '../apps/api/src/modules/tracking/index.js';
import { createAnalyticsPipeline } from '../apps/workers/src/analytics.js';
import { startDockerService } from './docker-service.js';

const rootUrl = process.env.DATABASE_URL ?? 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
if (!['localhost', '127.0.0.1'].includes(new URL(rootUrl).hostname)) throw new Error('Chaos test requires local PostgreSQL');
const databaseName = `vichaar_ch_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const url = new URL(rootUrl);
url.pathname = `/${databaseName}`;
const admin = createDatabaseClients({ primaryUrl: rootUrl, maxConnections: 1 });
const queues = createSqsQueues({
  endpoint: 'http://localhost:9324', baseUrl: 'http://localhost:9324/queue', region: 'us-east-1',
  tracksName: `ch-storm-${randomUUID().slice(0, 12)}`,
});
let db: ReturnType<typeof createDatabaseClients> | undefined;
let clickhouse: Awaited<ReturnType<typeof startDockerService>> | undefined;
let databaseCreated = false;
let queueCreated = false;

beforeAll(async () => {
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
  clickhouse = await startDockerService('clickhouse/clickhouse-server:24.3-alpine', 8123, [
    'CLICKHOUSE_DB=vichaar', 'CLICKHOUSE_USER=vichaar', 'CLICKHOUSE_PASSWORD=vichaar_local',
  ], '2048m');
  await vi.waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${clickhouse!.port}/ping`, { signal: AbortSignal.timeout(1000) });
    expect(response.ok).toBe(true);
  }, { timeout: 60_000, interval: 200 });
  await admin.primaryPool.query(`CREATE DATABASE ${databaseName}`);
  databaseCreated = true;
  await runMigrations(url.toString());
  db = createDatabaseClients({ primaryUrl: url.toString(), maxConnections: 10 });
  await queues.createLocalQueues();
  queueCreated = true;
}, 120_000);

afterAll(async () => {
  if (db) await db.close();
  if (queueCreated) await queues.deleteLocalQueues();
  queues.close();
  if (databaseCreated) await admin.primaryPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  await admin.close();
  if (clickhouse) await clickhouse.remove();
}, 90_000);

describe('ClickHouse outage during clicks', () => {
  it('keeps redirecting 1,000 clicks and drains the queued events after recovery', async () => {
    if (!db || !clickhouse) throw new Error('Test setup failed');
    const pubId = randomUUID();
    const postId = randomUUID();
    const subId = randomUUID();
    const linkId = randomUUID();
    const userId = randomUUID();
    await db.primaryPool.query("INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'stub','Writer')", [userId, `writer-${userId}@example.test`]);
    await db.primaryPool.query('INSERT INTO publications(id,owner_id,name,subdomain) VALUES($1,$2,$3,$4)', [pubId, userId, 'Click chaos', `click-${pubId.slice(0, 8)}`]);
    await db.primaryPool.query("INSERT INTO posts(id,publication_id,slug,title,status,published_at) VALUES($1,$2,'click','Click','published',now())", [postId, pubId]);
    await db.primaryPool.query("INSERT INTO subscriptions(id,publication_id,email,status) VALUES($1,$2,$3,'active')", [subId, pubId, `reader-${subId}@example.test`]);
    await db.primaryPool.query('INSERT INTO tracked_links(id,publication_id,post_id,target_url) VALUES($1,$2,$3,$4)', [linkId, pubId, postId, 'https://example.com/article']);
    const secret = 'phase7_clickhouse_storm_secret_32_chars';
    const token = signTrackingToken(secret, { publicationId: pubId, postId, subscriptionId: subId, linkId, kind: 'click', exp: Math.floor(Date.now() / 1000) + 3600 });
    const service = createTrackingService({ secret, repo: createTrackingRepository(db.primaryPool), queue: queues.tracks });
    const server = express().use('/t', createTrackingRouter(service)).listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP listener did not bind');
    const target = `http://127.0.0.1:${address.port}/t/c/${token}`;
    const pipelineAt = (endpoint: string) => createAnalyticsPipeline({ tracks: queues.tracks, clickhouseUrl: endpoint, database: 'vichaar', user: 'vichaar', password: 'vichaar_local' });
    let endpoint = `http://127.0.0.1:${clickhouse.port}`;
    let analytics = pipelineAt(endpoint);
    try {
      await analytics.initialize();
      await clickhouse.stop();
      const burstStarted = performance.now();
      for (let offset = 0; offset < 1000; offset += 100) {
        const responses = await Promise.all(Array.from({ length: 100 }, () => fetch(target, { redirect: 'manual' })));
        for (const response of responses) {
          expect(response.status).toBe(302);
          expect(response.headers.get('location')).toBe('https://example.com/article');
        }
      }
      const burstMs = performance.now() - burstStarted;
      console.log(JSON.stringify({ clickBurstRequests: 1000, clickBurstMs: burstMs, clickBurstPerSecond: 1000 / (burstMs / 1000) }));
      await vi.waitFor(async () => { await service.flush(); expect(service.metrics().buffered).toBe(0); }, { timeout: 30_000, interval: 100 });
      expect(service.metrics()).toMatchObject({ accepted: 1000, dropped: 0, errors: 0 });
      await expect(analytics.consumeOnce()).rejects.toThrow();
      await clickhouse.start();
      endpoint = `http://127.0.0.1:${clickhouse.port}`;
      analytics = pipelineAt(endpoint);
      await vi.waitFor(async () => {
        const response = await fetch(`${endpoint}/ping`, { signal: AbortSignal.timeout(1000) });
        expect(response.ok).toBe(true);
      }, { timeout: 60_000, interval: 200 });
      await vi.waitFor(async () => {
        await analytics.consumeOnce();
        const response = await fetch(`${endpoint}/?query=SELECT%20uniqExact(event_id)%20FROM%20vichaar.email_events%20FORMAT%20TabSeparated`, {
          headers: { Authorization: `Basic ${Buffer.from('vichaar:vichaar_local').toString('base64')}` },
          signal: AbortSignal.timeout(5000),
        });
        expect(response.ok).toBe(true);
        expect(Number((await response.text()).trim())).toBe(1000);
        expect(await queues.tracks.depth()).toBe(0);
      }, { timeout: 90_000, interval: 500 });
    } finally {
      server.close();
    }
  }, 180_000);
});
