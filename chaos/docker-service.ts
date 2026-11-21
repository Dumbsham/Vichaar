import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFile = promisify(execFileCallback);

export async function startDockerService(image: string, containerPort: number, environment: string[] = [], memory = '512m') {
  const name = `vichaar-chaos-${randomUUID().slice(0, 12)}`;
  await execFile('docker', [
    'run', '-d', '--name', name, '--memory', memory, '-p', `127.0.0.1::${containerPort}`,
    ...environment.flatMap((entry) => ['-e', entry]), image,
  ], { timeout: 60_000 });
  try {
    async function mappedPort() {
      const { stdout } = await execFile('docker', ['port', name, `${containerPort}/tcp`], { timeout: 10_000 });
      const address = stdout.trim().split('\n')[0];
      const port = Number(address?.split(':').at(-1));
      if (!Number.isInteger(port) || port <= 0) throw new Error('Docker did not expose a service port');
      return port;
    }
    const service = {
      name,
      port: await mappedPort(),
      stop: async () => { await execFile('docker', ['stop', name], { timeout: 30_000 }); },
      start: async () => {
        await execFile('docker', ['start', name], { timeout: 30_000 });
        service.port = await mappedPort();
      },
      remove: async () => { await execFile('docker', ['rm', '-f', name], { timeout: 30_000 }); },
    };
    return service;
  } catch (error) {
    await execFile('docker', ['rm', '-f', name], { timeout: 30_000 });
    throw error;
  }
}
