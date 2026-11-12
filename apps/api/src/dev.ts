import { spawn } from 'node:child_process';

const children = ['index.ts', 'tracking-server.ts'].map((entry) =>
  spawn('pnpm', ['exec', 'tsx', 'watch', `src/${entry}`], { env: process.env, stdio: 'inherit' }),
);
function stop() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', (code) => {
    if (code) {
      process.exitCode = code;
      stop();
    }
  });
