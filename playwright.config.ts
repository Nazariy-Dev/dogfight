import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:8091', viewport: { width: 960, height: 540 } },
  webServer: {
    command: 'node server/src/index.ts',
    url: 'http://127.0.0.1:8091/health',
    env: { PORT: '8091', LOG_LEVEL: 'warn', LOG_DIR: './.e2e-logs' },
    reuseExistingServer: false,
  },
})
