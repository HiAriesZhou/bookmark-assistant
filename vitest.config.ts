import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/types/src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'packages/extension/src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'packages/extension/scripts/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'packages/server/src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'packages/server/scripts/**/*.{test,spec}.{js,mjs}',
      'tests/unit/**/*.{test,spec}.{js,ts,jsx,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', 'tests/e2e/**'],
    alias: {
      '@product-logo': resolve(__dirname, 'packages/shared/assets/brand/logo.png'),
      '@bookmark-assistant/types': resolve(__dirname, 'packages/types/src/index.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'build/', '**/*.config.{js,ts}', '**/*.d.ts', 'tests/'],
    },
  },
});
