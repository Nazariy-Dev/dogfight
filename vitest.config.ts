import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: './shared', include: ['test/**/*.test.ts'] } },
      { test: { name: 'client', root: './client', include: ['test/**/*.test.ts'] } },
      { test: { name: 'server', root: './server', include: ['test/**/*.test.ts'], testTimeout: 10000 } },
    ],
    coverage: {
      provider: 'v8',
      include: ['shared/src/**/*.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
})
