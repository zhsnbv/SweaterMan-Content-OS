import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3111',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx next start -p 3111',
    url: 'http://127.0.0.1:3111/week',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      CONTENT_OS_DATA_DIR: '.localdata/e2e',
      AI_PROVIDER: 'mock',
      GITHUB_SYNC: 'local',
    },
  },
});
