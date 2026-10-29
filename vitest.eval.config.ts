import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Real-provider evaluations; run explicitly with `pnpm eval:organize`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/extension/eval/**/*.eval.ts'],
    alias: {
      '@bookmark-assistant/types': resolve(__dirname, 'packages/types/src/index.ts'),
    },
  },
});
