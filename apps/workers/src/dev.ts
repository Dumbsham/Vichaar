import { spawn } from 'node:child_process';

const roles = ['relay', 'fanout', 'scheduler', 'sender', 'sweeper'];
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
