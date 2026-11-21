import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['apps/api/__tests__/**/*.test.ts', 'packages/shared/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@contexta/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
});
