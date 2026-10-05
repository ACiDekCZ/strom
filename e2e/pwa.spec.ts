import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * PWA offline indicator: the toolbar badge reflects connectivity. (Service
 * worker registration only runs on the hosted PWA host, not on localhost/dev,
 * so it is covered by the unit gate test rather than here — see COVERAGE.)
 */
test('offline indicator reflects connectivity', async ({ page, context }) => {
    await openApp(page);
    const badge = page.locator('#offline-indicator');
    await expect(badge).toBeHidden();

    await context.setOffline(true);
    await expect(badge).toBeVisible();

    await context.setOffline(false);
    await expect(badge).toBeHidden();
});

/**
 * Safari's own app (Add to Dock) gets a name and icon of its own: in Safari on
 * a computer the hosted app links manifest-safari.json, the muted touch icon
 * and an app title; Chromium and an iPad keep "Strom". The hosted beta is
 * answered locally (the service worker gets a 404 and stays out).
 */
test.describe('Safari\'s own app is told apart by name and icon', () => {
    const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const head = (page: import('@playwright/test').Page) => page.evaluate(() => ({
        manifest: document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href') ?? null,
        touch: document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
        title: document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content ?? null,
        badge: !!document.querySelector('.beta-badge'),
    }));

    async function hosted(browser: import('@playwright/test').Browser, ua: string | null, touch = 0) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(ua ? { userAgent: ua } : {}) });
        const html = await (await import('fs')).promises.readFile('e2e-dist/strom.html', 'utf8');
        await ctx.route('https://beta.stromapp.info/**', (route) => /\/run\/(index\.html)?$/.test(new URL(route.request().url()).pathname)
            ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
            : route.fulfill({ status: 404, body: '' }));
        const page = await ctx.newPage();
        if (ua) {
            await page.addInitScript((t) => {
                Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
                Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
                Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => t });
            }, touch);
        }
        await page.goto('https://beta.stromapp.info/run/');
        await page.waitForFunction(() => !!window.Strom?.UI);
        return { ctx, page };
    }

    test('Safari on a Mac: its own manifest, muted touch icon, "Strom Beta (Safari)"', async ({ browser }) => {
        const { ctx, page } = await hosted(browser, SAFARI);
        await expect.poll(() => head(page)).toMatchObject({
            manifest: '/run/manifest-safari.json', touch: '/run/icons/apple-touch-icon-muted.png', title: 'Strom Beta (Safari)', badge: true,
        });
        await ctx.close();
    });

    test('Chromium and an iPad: "Strom" as before', async ({ browser }) => {
        const chrome = await hosted(browser, null);
        await expect.poll(() => head(chrome.page)).toMatchObject({ manifest: '/run/manifest.json', touch: '/run/icons/apple-touch-icon.png', title: null });
        await chrome.ctx.close();
        const ipad = await hosted(browser, SAFARI, 5);
        await expect.poll(() => head(ipad.page)).toMatchObject({ manifest: '/run/manifest.json', touch: '/run/icons/apple-touch-icon.png', title: null });
        await ipad.ctx.close();
    });
});
