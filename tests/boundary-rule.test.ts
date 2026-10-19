import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

describe('Boundary Lint Rules', () => {
  it('fails with a boundary violation when importing a module internal file', async () => {
    const eslint = new ESLint({
      overrideConfigFile: path.resolve(process.cwd(), 'eslint.config.js'),
      ignore: false,
    });

    const targetFile = path.resolve(
      process.cwd(),
      'fixtures/boundary-violation-fixture/modules/posts/service.ts',
    );

    const results = await eslint.lintFiles([targetFile]);

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.errorCount).toBeGreaterThan(0);

    const boundaryError = result.messages.find(
      (m) => m.ruleId === 'boundaries/enforce-module-boundaries',
    );
    expect(boundaryError).toBeDefined();
    expect(boundaryError?.message).toContain('Boundary violation');
    expect(boundaryError?.message).toContain('../auth/repository.js');
  });

  it('fails when a service imports Express types', async () => {
    const eslint = new ESLint({
      overrideConfigFile: path.resolve(process.cwd(), 'eslint.config.js'),
      ignore: false,
    });

    const code = `
import { Request, Response } from 'express';

export function handleSomething(req: Request, res: Response) {
  return res.send('ok');
}
`;

    const results = await eslint.lintText(code, {
      filePath: path.resolve(process.cwd(), 'apps/api/src/modules/posts/service.ts'),
    });

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.errorCount).toBeGreaterThan(0);

    const layerError = result.messages.find(
      (m) => m.ruleId === 'boundaries/enforce-module-boundaries',
    );
    expect(layerError).toBeDefined();
    expect(layerError?.message).toContain('Layer violation: Services and repositories must never import Express types');
  });
});
