import { defineConfig, devices } from '@playwright/test';
import { basename } from 'node:path';

/**
 * Each checkout gets its own port: the main one keeps 8199, a worktree
 * (e.g. ../strom-beta) derives one from its folder name. With
 * reuseExistingServer a shared port would let one checkout's run silently test
 * the other checkout's strom.html. E2E_PORT overrides.
 */
function e2ePort(): number {
    if (process.env.E2E_PORT) return Number(process.env.E2E_PORT);
    const dir = basename(process.cwd());
    if (dir === 'Strom') return 8199;
    let hash = 0;
    for (const ch of dir) hash = (hash * 31 + ch.charCodeAt(0)) % 700;
    return 8200 + hash;
}
const PORT = e2ePort();

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
    // GitHub's runner has 4 vCPUs; one worker ran the suite serially (~16 min).
    workers: process.env.CI ? 4 : undefined,
    reporter: [['list']],
    timeout: 30_000,
    use: {
        baseURL: `http://localhost:${PORT}/strom.html`,
        locale: 'en-US',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: `npx http-server . -p ${PORT} -c-1 --silent`,
        url: `http://localhost:${PORT}/strom.html`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
