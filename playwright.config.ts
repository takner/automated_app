import { defineConfig, devices } from '@playwright/test';

try {
  process.loadEnvFile?.('.env');
} catch {
  // CI passes variables directly
}

const E2E_DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, '/hamrooz_e2e$1');
const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  // the local e2e database is reached through an SSH tunnel, so server renders are slower than in production
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'fa-IR', timezoneId: 'Asia/Tehran', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/offline`,

    stderr: 'pipe',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: E2E_DB!, APP_URL: `http://localhost:${PORT}`, NODE_ENV: 'production', APP_RELEASE: 'e2e' },
  },
});

export { E2E_DB };
