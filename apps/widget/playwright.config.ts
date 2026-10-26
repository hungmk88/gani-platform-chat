import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the built widget (`pnpm build` first) on its test page (demo/index.html), axe-core on every step
// (apps/widget/CLAUDE.md "Kiểm chứng"). CHROMIUM_PATH: a Chromium already on the machine; without it, `playwright install chromium`.
const chromium = process.env['CHROMIUM_PATH'];

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env['CI']),
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'node scripts/serve.mjs', url: 'http://localhost:4173/demo/index.html' },
});
