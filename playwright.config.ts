import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

const FRONTEND_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    extraHTTPHeaders: process.env.PAWVY_API_KEY ? { Authorization: `Bearer ${process.env.PAWVY_API_KEY}` } : {},
  },
  webServer: {
    command: 'pnpm run dev',
    url: FRONTEND_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
