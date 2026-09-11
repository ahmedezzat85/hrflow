import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    channel: 'chrome',
  },
  webServer: {
    command: 'npm run dev -- --port 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
