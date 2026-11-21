import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/shared/logger.js';

describe('structured logging', () => {
  it('redacts session cookies in response headers', async () => {
    const output: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk));
        callback();
      },
    });
    createLogger(destination).error({ res: { headers: { 'set-cookie': 'vichaar_session=never-log-this' } } }, 'redaction check');
    await vi.waitFor(() => expect(output.length).toBeGreaterThan(0));
    expect(output.join('')).toContain('[REDACTED]');
    expect(output.join('')).not.toContain('never-log-this');
  });
});
