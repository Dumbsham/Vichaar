import { spawn } from 'node:child_process';
import { z } from 'zod';
import { ensureLocalDevQueues } from './dev-queues.js';

const queueConfig = z
  .object({
    SQS_ENDPOINT: z.string().url().default('http://localhost:9324'),
    SQS_QUEUE_BASE_URL: z.string().url().default('http://localhost:9324/queue'),
    AWS_REGION: z.string().default('us-east-1'),
  })
  .parse(process.env);

await ensureLocalDevQueues({
  endpoint: queueConfig.SQS_ENDPOINT,
  baseUrl: queueConfig.SQS_QUEUE_BASE_URL,
  region: queueConfig.AWS_REGION,
  eventsName: 'vichaar-events',
  sendsName: 'vichaar-sends',
  hooksName: 'vichaar-hooks',
  tracksName: 'vichaar-tracks',
  pagesName: 'vichaar-pages',
});

const roles = [
  'relay',
  'fanout',
  'scheduler',
  'sender',
  'sweeper',
  'webhooks',
  'reconciliation',
  'analytics',
  'pages',
];
const children = roles.map((role) =>
  spawn('pnpm', ['exec', 'tsx', 'watch', 'src/index.ts'], {
    env: { ...process.env, WORKER_ROLE: role },
    stdio: 'inherit',
  }),
);
function stop() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
      stop();
    }
  });
