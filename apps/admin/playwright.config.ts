import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the built admin (`next build` first) against e2e/stub-api.ts; axe on every screen (apps/admin/CLAUDE.md).
// CHROMIUM_PATH: a Chromium already on the machine; without it, the one of `playwright install chromium`.
const chromium = process.env['CHROMIUM_PATH'];

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env['CI']),
  reporter: 'list',
  globalSetup: './e2e/stub-api.ts',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm start', url: 'http://localhost:3001/login', timeout: 60_000 },
});
