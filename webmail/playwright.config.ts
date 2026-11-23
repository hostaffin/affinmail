/**
 * E2E config for the AffinMail webmail SPA.
 *
 * Serves the production build on 127.0.0.1:4173; `/jmap` is proxied to the local
 * Stalwart instance by webmail/vite.config.ts (same path Caddy uses in prod).
 *
 * Plain object export on purpose: importing `@playwright/test` from this file
 * would resolve webmail/node_modules while the CLI/spec resolve the root copy,
 * and Playwright refuses to load two copies of itself.
 */
export default {
  testDir: '../tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
};
