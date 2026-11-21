import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ObjectStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export function createLocalQuoteCardStorage(directory: string): ObjectStorage {
  // Both Turbo package processes use the repository root for relative storage paths.
  const baseDirectory = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)), directory);
  const filePath = (key: string) => {
    if (!/^cards\/[0-9a-f]{64}\.png$/.test(key)) throw new Error('Invalid quote card key');
    return join(baseDirectory, key);
  };
  return {
    async put(key, bytes) {
      const file = filePath(key);
      await mkdir(join(baseDirectory, 'cards'), { recursive: true });
      await writeFile(file, bytes, { flag: 'wx' }).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
          return;
        throw error;
      });
    },
    async get(key) {
      try {
        return await readFile(filePath(key));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return null;
        throw error;
      }
    },
    async delete(key) {
      await unlink(filePath(key)).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return;
        throw error;
      });
    },
  };
}
