import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import { openResearch, fakeBridge, poll } from './research-bridge.js';

/**
 * The research's beta channel seen from the app: `/status.channel` said as
 * "Research: beta" in Research for this tree, and the npm update command of
 * the "older research" dialog — on the beta app (beta.stromapp.info) only;
 * the public app (stromapp.info) ignores the channel and keeps npm's latest.
 * Each host is answered from the built file. Invented data.
 */

/** The switch of the beta channel as the source has it (the built app under test is built from it). */
const BETA_CHANNEL_ON = /export const INSTALL_BETA_CHANNEL = true;/.test(fs.readFileSync('src/research-install.ts', 'utf8'));

for (const [name, origin, beta] of [['the beta app', 'https://beta.stromapp.info', true], ['the public app', 'https://stromapp.info', false]] as const) {
    test.describe(`${name} (${origin.replace('https://', '')})`, () => {
        test.use({ baseURL: `${origin}/strom.html`, serviceWorkers: 'block' });
        test.beforeEach(async ({ context }) => {
            const html = await fs.promises.readFile('e2e-dist/strom.html', 'utf8');
            await context.route(`${origin}/**`, (route) => new URL(route.request().url()).pathname === '/strom.html'
                ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
                : route.fulfill({ status: 404, body: '' }));
        });

        const settingsLine = async (page: Page) => {
            await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
            const dialog = page.locator('#research-tree-settings-modal');
            await expect(dialog.locator('legend', { hasText: 'Sending changes' })).toBeVisible();
            const count = await dialog.locator('.research-channel-line').count();
            const text = await dialog.textContent();
            await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
            return { count, text: text ?? '' };
        };

        test(`/status.channel "beta": ${beta ? 'said in Research for this tree' : 'ignored'}; a status without it says nothing`, async ({ page }) => {
            await openResearch(page);
            const bridge = await fakeBridge(page, { statusExtra: { channel: 'beta' } });
            await poll(page);
            const said = await settingsLine(page);
            if (beta) {
                expect(said.count).toBe(1);
                expect(said.text).toContain('Research: beta');
            } else {
                expect(said.count).toBe(0);
                expect(said.text).not.toMatch(/beta/i);
            }
            bridge.statusExtra = undefined;
            await poll(page);
            const quiet = await settingsLine(page);
            expect(quiet.count).toBe(0);
            expect(quiet.text).not.toMatch(/beta/i);
        });

        test(`the "older research" dialog: npm's ${beta && BETA_CHANNEL_ON ? 'beta tag' : 'latest'}`, async ({ page }) => {
            await openResearch(page);
            await page.evaluate(() => window.Strom.UI.showResearchUpdateHelp());
            const dialog = page.locator('#research-update-modal');
            await expect(dialog.locator('.install-line').first()).toHaveText('strom update');
            await expect(dialog.locator('.install-line').nth(1))
                .toHaveText(beta && BETA_CHANNEL_ON ? 'npm install -g strom-research@beta' : 'npm install -g strom-research@latest');
            if (!beta) expect(await dialog.evaluate(e => e.innerHTML)).not.toMatch(/beta/i);
        });
    });
}
