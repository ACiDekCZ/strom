import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real single-file build (strom.html), served
 * by http-server. `npm run test:e2e` builds first, then runs these. Each test
 * gets a fresh browser context (clean IndexedDB), and the locale is forced to
 * en-US so the (system-language) UI is deterministically English; a few tests
 * override the locale to cs-CZ.
 */
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['list']],
    timeout: 30_000,
    use: {
        baseURL: 'http://localhost:8199/strom.html',
        locale: 'en-US',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: 'npx http-server . -p 8199 -c-1 --silent',
        url: 'http://localhost:8199/strom.html',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
