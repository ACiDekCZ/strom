import { test, expect, Page } from '@playwright/test';
import { openApp, card, createFirstPerson } from './helpers.js';

/**
 * A link from Strom Research (?live= / ?send= / ?adopt=) that cannot reach
 * its bridge: "Couldn't connect to the research" with the reason the browser
 * gives (local network access denied, waiting for the user's answer, the
 * research not answering, no answer at all, Safari), the way to allow it,
 * and Try again. The tree stays as it was, no new tree is made. Invented data.
 */

const BRIDGE = 'http://127.0.0.1:5991/0123456789abcdef0123456789abcdef';

/** The browser's local network permission, as `state` ('none': the API is missing). */
async function lnaPermission(page: Page, state: 'denied' | 'prompt' | 'granted' | 'none'): Promise<void> {
    await page.addInitScript((st) => {
        const perms = navigator.permissions;
        const status: { state: string; onchange: (() => void) | null } = { state: st, onchange: null };
        (window as unknown as { __lna: typeof status }).__lna = status;
        const orig = perms?.query?.bind(perms);
        Object.defineProperty(navigator, 'permissions', {
            configurable: true,
            value: {
                query: (d: { name: string }) => {
                    // Every name the app may ask it under (local-network.ts).
                    if (['local-network-access', 'loopback-network', 'local-network'].includes(d.name)) {
                        return st === 'none' ? Promise.reject(new TypeError('unknown permission')) : Promise.resolve(status);
                    }
                    return orig ? orig(d as PermissionDescriptor) : Promise.reject(new TypeError('no'));
                },
            },
        });
    }, state);
}

async function setup(page: Page, state: 'denied' | 'prompt' | 'granted' | 'none'): Promise<void> {
    await page.setViewportSize({ width: 1280, height: 900 });
    await lnaPermission(page, state);
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    // The bridge is not there.
    await page.route(`${BRIDGE}/**`, route => route.abort('connectionrefused'));
}

const dialog = (page: Page) => page.locator('#research-connect-failed');
const trees = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getTrees().length);

test.describe('couldn\'t connect to the research', () => {
    test('local network access denied: said so, the way to allow it open; Close leaves the tree as it was', async ({ page }) => {
        await setup(page, 'denied');
        const before = await trees(page);
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ live: b })), BRIDGE);
        const d = dialog(page);
        await expect(d.locator('h2')).toHaveText("Couldn't connect to the research");
        await expect(d.locator('.connect-reason')).toHaveText('Chromium blocks the connection');
        await expect(d.locator('.connect-how')).toHaveAttribute('open', '');
        await expect(d.locator('.connect-how li')).toHaveCount(3);
        await expect(d.locator('.connect-nothing')).toHaveText(/the tree .* stays as it was/);
        await expect(d.locator('.close-btn')).toHaveCount(0);
        await d.getByRole('button', { name: 'Close' }).click();
        await expect(d).toHaveCount(0);
        await expect(card(page, 'Jan')).toBeVisible();
        expect(await trees(page)).toBe(before);
    });

    test('waiting for the user\'s answer: once allowed, it tries again by itself', async ({ page }) => {
        await setup(page, 'prompt');
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        const d = dialog(page);
        await expect(d.locator('.connect-reason')).toHaveText('The browser is waiting for permission');
        await expect(d.locator('.connect-how')).toHaveCount(0);
        let asked = 0;
        await page.unroute(`${BRIDGE}/**`);
        await page.route(`${BRIDGE}/**`, route => { asked++; return route.abort('connectionrefused'); });
        await page.evaluate(() => {
            const st = (window as unknown as { __lna: { state: string; onchange: (() => void) | null } }).__lna;
            st.state = 'granted';
            st.onchange?.();
        });
        // Tried again: asked the bridge, which is still not there → the dialog again (now "not responding").
        await expect.poll(() => asked).toBeGreaterThan(0);
        await expect(d.locator('.connect-reason')).toHaveText("The research isn't responding");
    });

    test('allowed and still unreachable: the research is not responding, Try again asks again', async ({ page }) => {
        await setup(page, 'granted');
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ send: b })), BRIDGE);
        const d = dialog(page);
        await expect(d.locator('.connect-reason')).toHaveText("The research isn't responding");
        await expect(d.locator('.connect-text')).toContainText('Start it again');
        await expect(d.locator('.connect-how')).toHaveCount(0);
        await d.getByRole('button', { name: 'Try again' }).click();
        await expect(d.locator('.connect-reason')).toHaveText("The research isn't responding");
        await page.keyboard.press('Escape');
        await expect(d).toHaveCount(0);
    });

    test('m4 of the Windows round: a hand-over survives a reload while blocked, and goes on by itself once allowed — never the old research quietly', async ({ page }) => {
        await setup(page, 'denied');
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        const d = dialog(page);
        await expect(d.locator('.connect-reason')).toHaveText('Chromium blocks the connection');
        // The browser's advice: reload after allowing. The hand-over is asked again, not lost.
        await page.reload();
        await expect(d.locator('.connect-reason')).toHaveText('Chromium blocks the connection');
        // Allowed in the site settings: it connects by itself, no reload, no click.
        await page.unroute(`${BRIDGE}/**`);
        await page.route(`${BRIDGE}/**`, (route) => route.request().method() === 'OPTIONS'
            ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
            : new URL(route.request().url()).pathname.endsWith('/adopt')
                ? route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ token: 'Q'.repeat(43), name: 'Novákovi' }) })
                : route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' }));
        await page.evaluate(() => {
            const st = (window as unknown as { __lna: { state: string; onchange: (() => void) | null } }).__lna;
            st.state = 'granted';
            st.onchange?.();
        });
        await expect(d).toHaveCount(0);
        // This browser has no tree for that token: where to open it (the hand-over went on, it was not dropped).
        await expect(page.locator('#research-elsewhere-modal')).toBeVisible();
        // Over: nothing is kept for a later reload.
        expect(await page.evaluate(() => sessionStorage.getItem('strom-pending-adopt'))).toBeNull();
        await page.reload();
        await expect(page.locator('#research-elsewhere-modal')).toHaveCount(0);
        await expect(d).toHaveCount(0);
    });

    test('a hand-over closed as it is ("Close") is not asked again at the next reload', async ({ page }) => {
        await setup(page, 'denied');
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        const d = dialog(page);
        await expect(d).toBeVisible();
        await d.getByRole('button', { name: 'Close' }).click();
        await expect(d).toHaveCount(0);
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(d).toHaveCount(0);
    });

    test('no permission API (Firefox): the general text, the way folded', async ({ page }) => {
        await setup(page, 'none');
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ live: b })), BRIDGE);
        const d = dialog(page);
        await expect(d.locator('.connect-text')).toContainText('the browser is blocking it');
        await expect(d.locator('.connect-how')).not.toHaveAttribute('open', '');
    });

    test('Safari: its own text and Copy link instead of Try again', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'userAgent', {
                configurable: true,
                get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
            });
        });
        await setup(page, 'none');
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ live: b })), BRIDGE);
        const d = dialog(page);
        await expect(d.locator('.connect-reason')).toHaveText("Safari won't connect to the research");
        await expect(d.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        await d.getByRole('button', { name: 'Copy link' }).click();
        await expect(page.locator('.toast')).toContainText('Link copied');
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(new URL(copied).searchParams.get('live')).toBe(BRIDGE);
    });
});
