import { test, expect, Page, Request } from '@playwright/test';
import * as path from 'path';
import { openApp, createFirstPerson, card, importJsonAsNewTree } from './helpers.js';

/**
 * A browser that never met Strom Research — the default for almost every
 * user: nothing of the research may show or run. No request to a bridge on
 * this computer (127.0.0.1, localhost on another port, [::1]), no
 * strom-research:// launch, no dot, button, block, pill or setting of the
 * research, nothing remembered about it. The only trace is the explanation
 * item "AI ancestor research" (the way to install it), which is not part of
 * this check. Covers the desktop (where the research runs) with edits, a tree
 * switch and the page going hidden, past the two minutes after which a
 * research tree would send by itself.
 */

const DESKTOP = { width: 1440, height: 900 };

/** A request to this computer other than the app's own server. */
function isLocalBridge(req: Request, appOrigin: string): boolean {
    let url: URL;
    try { url = new URL(req.url()); } catch { return false; }
    if (url.origin === appOrigin) return false;
    return ['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0'].includes(url.hostname);
}

/** Record every strom-research:// launch the page attempts (location, window.open, a link click). */
async function recordLaunches(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        const origOpen = window.open.bind(window);
        window.open = ((url?: string | URL, ...rest: unknown[]) => {
            if (String(url ?? '').startsWith('strom-research:')) { launched.push(String(url)); return null; }
            return origOpen(url as string, ...(rest as [string?, string?]));
        }) as typeof window.open;
        document.addEventListener('click', (e) => {
            const a = (e.target as Element | null)?.closest?.('a[href^="strom-research:"]');
            if (a) { launched.push(a.getAttribute('href') ?? ''); e.preventDefault(); }
        }, true);
    });
}

test.describe('no Strom Research on this computer: nothing of it shows or runs', () => {
    test.use({ viewport: DESKTOP });

    test('a clean profile: no bridge request, no research UI, nothing remembered', { tag: '@smoke' }, async ({ page, baseURL }) => {
        const appOrigin = new URL(baseURL!).origin;
        const local: string[] = [];
        page.on('request', (req) => { if (isLocalBridge(req, appOrigin)) local.push(req.url()); });
        await recordLaunches(page);
        await page.clock.install();

        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novák', { birthDate: '1900-01-01' });
        await expect(card(page, 'Jan')).toBeVisible();
        // A second tree with sources and attachments, then back and forth.
        await importJsonAsNewTree(page, path.join('e2e', 'fixtures', 'rich-person.json'), 'Druhý');
        await page.locator('.person-card').first().waitFor();

        // The page goes hidden and comes back (a research tree would send now).
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        });
        // Past every timer of the research: the minute's status poll and the two quiet minutes.
        await page.clock.fastForward(5 * 60_000);

        // Toolbar: no research mark, Send button or pill; no research dot on ⋯.
        await expect(page.locator('#research-sync-pill')).toBeHidden();
        await expect(page.locator('#actions-menu-research-dot')).toBeHidden();
        await expect(page.locator('#actions-menu-dot')).toBeHidden();

        // ⋯ menu: no Research submenu, no state block.
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#actions-research-row')).toBeHidden();
        await expect(page.locator('.research-sync-block')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // Person menu: no "Research ›".
        await page.locator('.person-card').first().click();
        const menu = page.locator('.context-menu:not(.context-submenu)');
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-menu="research"]')).toHaveCount(0);
        await expect(menu.locator('[data-action^="research-"]')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // Settings: neither "Strom Research on this computer" nor the research's card edge.
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#settings-modal')).toBeVisible();
        await expect(page.locator('#research-links-row')).toBeHidden();
        await expect(page.locator('#research-edge-settings')).toBeHidden();

        expect(local, 'requests to a bridge on this computer').toEqual([]);
        expect(await page.evaluate(() => (window as unknown as { __launched: string[] }).__launched)).toEqual([]);
        // Nothing about a research remembered in this browser.
        const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-research')));
        expect(keys).toEqual([]);
    });
});
