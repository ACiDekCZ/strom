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
 * End-to-end tests run against the real single-file build, served by
 * http-server from e2e-dist/: globalSetup copies strom.html there when a run
 * starts, so a build made during the run does not change what is tested.
 * `npm run test:e2e` (scripts/e2e.sh: one heavy run at a time on this
 * computer) builds first, then runs these. Each test
 * gets a fresh browser context (clean IndexedDB), and the locale is forced to
 * en-US so the (system-language) UI is deterministically English; a few tests
 * override the locale to cs-CZ.
 */
export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // One retry on CI: a flake does not stop a deploy, and the run reports it
    // as "flaky" (the workflow puts the count in the job summary).
    retries: process.env.CI ? 1 : 0,
    // CI runs the suite in 4 shards (deploy.yml); a GitHub runner has 4 vCPUs,
    // and 4 Chromium workers on it overloaded it into flakes — 3 per shard.
    // Locally E2E_WORKERS overrides Playwright's default (half the cores).
    workers: process.env.CI ? 3 : process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,
    reporter: process.env.CI
        ? [['list'], ['json', { outputFile: 'e2e-results.json' }]]
        : [['list']],
    timeout: 30_000,
    use: {
        baseURL: `http://localhost:${PORT}/strom.html`,
        locale: 'en-US',
        // No animations: a glide or a fade still running when a test acts
        // was the main cause of flakes. Specs that check the motion itself
        // switch it back with page.emulateMedia({ reducedMotion: 'no-preference' }).
        contextOptions: { reducedMotion: 'reduce' },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        // Up before globalSetup copies the build in: ready by the folder's listing.
        command: `mkdir -p e2e-dist && npx http-server e2e-dist -p ${PORT} -c-1 --silent`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
