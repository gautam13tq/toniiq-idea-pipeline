import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SMOKE_BASE_URL || 'https://toniiq-idea-pipeline.vercel.app'

export default defineConfig({
  testDir: '.',
  testMatch: 'smoke.spec.mjs',
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  reporter: 'line',
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
