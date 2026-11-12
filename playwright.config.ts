import { defineConfig, devices } from '@playwright/test';

// E2E targets a production-like build via `vite preview` rather than the dev
// server. Dev mode's HMR + on-demand transforms are flakier in CI, and the
// chunked code-split bundles only show up after `vite build`. The local
// `reuseExistingServer` flag keeps the iteration loop fast when you've
// already got `npm run dev` running on 5173.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173/',
    trace: 'retain-on-failure',
  },
  webServer: {
    // --mode e2e keeps the window.$debug handle in the bundle that this
    // suite drives the app through. A plain `npm run build` runs MODE=
    // production and the conditional in main.ts tree-shakes $debug away.
    command: 'npm run build -- --mode e2e && npm run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // build + preview start is slower than `vite` alone
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
