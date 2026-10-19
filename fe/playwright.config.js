import { defineConfig } from '@playwright/test';

// PW_PORT lets a second checkout run its own server instead of silently reusing another
// checkout's dev server on 8080 (reuseExistingServer would otherwise test the wrong code).
const PORT = process.env.PW_PORT || '8080';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  workers: 2,
  retries: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    channel: 'chrome',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 15000,
  },
});
