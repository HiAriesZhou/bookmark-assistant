import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/extension',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    channel: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
