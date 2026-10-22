import { defineConfig } from '@playwright/test';

// PW_PORT lets a second checkout run its own server instead of silently reusing another
// checkout's dev server on 8080 (reuseExistingServer would otherwise test the wrong code).
const PORT = process.env.PW_PORT || '8080';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  // GitHub-hosted runners for this public repo have 4 CPUs, so CI uses 4 workers (it used to run 2 and the UI suite
  // took about 12 minutes). Locally the default stays 2; set PW_WORKERS to use more of a bigger machine.
  workers: Number(process.env.PW_WORKERS) || (process.env.CI ? 4 : 2),
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
