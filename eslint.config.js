import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Custom rule enforcing architectural boundary constraints:
 * 1. Modules in src/modules/<name> must only be imported via their public index.ts.
 * 2. Services and repositories must never import Express types.
 */
const boundaryPlugin = {
  rules: {
    'enforce-module-boundaries': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Enforce module public API boundaries and layer separation',
        },
        messages: {
          noInternalModuleImport:
            'Boundary violation: Cross-module imports must only import from the module public index.ts, not internals ("{{importPath}}").',
          noExpressInServiceOrRepo:
            'Layer violation: Services and repositories must never import Express types ("{{importPath}}").',
        },
      },
      create(context) {
        const filename = context.filename.replace(/\\/g, '/');

        return {
          ImportDeclaration(node) {
            const importPath = node.source.value;

            // Rule 1: Cross-module internal imports
            // Matches relative imports to other modules' internal files:
            // e.g. ../auth/repository, ../users/service, ./auth/schemas
            // Or absolute imports like src/modules/auth/repository
            const crossModuleInternalRegex = /(?:^|\/|\.\.\/)modules\/([^/]+)\/(?!index(\.[a-z]+)?$)(.+)$/;
            const relativeModuleInternalRegex = /^\.\.\/([^/]+)\/(?!index(\.[a-z]+)?$)(.+)$/;

            if (
              (crossModuleInternalRegex.test(importPath) ||
                (filename.includes('/modules/') && relativeModuleInternalRegex.test(importPath)))
            ) {
              context.report({
                node,
                messageId: 'noInternalModuleImport',
                data: { importPath },
              });
            }

            // Rule 2: No Express in services or repositories
            if (
              (filename.includes('/service') ||
                filename.includes('.service.') ||
                filename.includes('/repository') ||
                filename.includes('.repository.')) &&
              (importPath === 'express' || importPath.startsWith('express/'))
            ) {
              context.report({
                node,
                messageId: 'noExpressInServiceOrRepo',
                data: { importPath },
              });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      boundaries: boundaryPlugin,
    },
    rules: {
      'boundaries/enforce-module-boundaries': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/.next/**', '**/.playwright-cli/**', '**/coverage/**', '**/fixtures/**'],
  },
);
