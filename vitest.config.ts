import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@axiom/core': path.resolve(rootDir, 'packages/core/src/index.ts'),
      '@axiom/cli': path.resolve(rootDir, 'packages/cli/src/main.ts'),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'examples/*/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    watch: false,
  },
});
