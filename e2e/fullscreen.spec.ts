import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, seedSetting, seedTree } from './helpers.js';

/**
 * Full screen (spec 082 K1.3, T48): a row of More in the bottom-bar regime, only
 * where the browser offers full screen (document.fullscreenEnabled), its label
 * following the state. Safari on an iPhone (no full screen for pages) gets
 * "Full screen…" with the way to the Home Screen and its separate storage; the
 * app on the Home Screen has no row. A slideshow leaves full screen on when it
 * was on before the show.
 *
 * The Fullscreen API is stubbed (headless browsers differ in what they allow):
 * `enabled` is what the browser says, the calls switch a flag and are counted.
 */
async function stubFullscreen(page: Page, enabled: boolean, extra: { standalone?: boolean } = {}): Promise<void> {
    await page.addInitScript(([on, standalone]) => {
        let element: Element | null = null;
        const w = window as unknown as { __fs: { requests: number; exits: number } };
        w.__fs = { requests: 0, exits: 0 };
        Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => on });
        Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get: () => element });
        Element.prototype.requestFullscreen = function (this: Element) {
            w.__fs.requests++;
            if (!on) return Promise.reject(new TypeError('not allowed'));
            element = this;
            document.dispatchEvent(new Event('fullscreenchange'));
            return Promise.resolve();
        };
        Document.prototype.exitFullscreen = function () {
            w.__fs.exits++;
            element = null;
            document.dispatchEvent(new Event('fullscreenchange'));
            return Promise.resolve();
        };
        if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    }, [enabled, !!extra.standalone] as const);
}

const fs = (page: Page) => page.evaluate(() => ({
    on: !!document.fullscreenElement,
    ...(window as unknown as { __fs: { requests: number; exits: number } }).__fs,
}));

async function openMore(page: Page): Promise<void> {
    await page.locator('#bb-view-more').tap();
    await expect(page.locator('.bottom-sheet-more')).toBeVisible();
}

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('More: Full screen where the browser offers it, Exit full screen while on', async ({ page }) => {
        await stubFullscreen(page, true);
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await openMore(page);
        const row = page.locator('#sheet-fullscreen');
        await expect(row).toHaveText('Full screen');
        // Under the View tiles.
        const tiles = (await page.locator('.bottom-sheet-pair[aria-label="View"]').boundingBox())!;
        expect((await row.boundingBox())!.y).toBeGreaterThan(tiles.y);
        await row.tap();
        await expect(page.locator('.bottom-sheet-more')).toHaveCount(0);
        expect(await fs(page)).toMatchObject({ on: true, requests: 1 });
        await openMore(page);
        await expect(row).toHaveText('Exit full screen');
        await row.tap();
        expect(await fs(page)).toMatchObject({ on: false, exits: 1 });
    });

    test('More: no full screen row where the browser does not offer it', async ({ page }) => {
        await stubFullscreen(page, false);
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await openMore(page);
        await expect(page.locator('.bottom-sheet-item', { hasText: 'Settings' })).toBeVisible();
        await expect(page.locator('#sheet-fullscreen')).toHaveCount(0);
    });

    test('Czech: Celá obrazovka / Ukončit celou obrazovku', async ({ page }) => {
        await stubFullscreen(page, true);
        await seedSetting(page, 'language', 'cs');
        await openApp(page);
        await seedTree(page, { jan: { firstName: 'Jan', lastName: 'Novák', gender: 'male' } });
        await openMore(page);
        await expect(page.locator('#sheet-fullscreen')).toHaveText('Celá obrazovka');
        await page.locator('#sheet-fullscreen').tap();
        await openMore(page);
        await expect(page.locator('#sheet-fullscreen')).toHaveText('Ukončit celou obrazovku');
    });

    test('a slideshow leaves full screen on when it was on before the show', async ({ page }) => {
        await stubFullscreen(page, true);
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        // Not on before: the show turns it on and its end off.
        await page.evaluate(() => window.Strom.UI.startSlideshow());
        await expect(page.locator('body')).toHaveClass(/slideshow-mode/);
        expect(await fs(page)).toMatchObject({ on: true, requests: 1, exits: 0 });
        await page.evaluate(() => window.Strom.UI.stopSlideshow());
        await expect(page.locator('body')).not.toHaveClass(/slideshow-mode/);
        expect(await fs(page)).toMatchObject({ on: false, exits: 1 });
        // On before (More › Full screen): the show asks for nothing and its end keeps it.
        await openMore(page);
        await page.locator('#sheet-fullscreen').tap();
        expect(await fs(page)).toMatchObject({ on: true, requests: 2 });
        await page.evaluate(() => window.Strom.UI.startSlideshow());
        await expect(page.locator('body')).toHaveClass(/slideshow-mode/);
        await page.evaluate(() => window.Strom.UI.stopSlideshow());
        await expect(page.locator('body')).not.toHaveClass(/slideshow-mode/);
        expect(await fs(page)).toMatchObject({ on: true, requests: 2, exits: 1 });
    });
});

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test.describe('iPhone Safari', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });

    test('Full screen… shows the way to the Home Screen and its separate storage', async ({ page }) => {
        await stubFullscreen(page, false);
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await openMore(page);
        const row = page.locator('#sheet-fullscreen');
        await expect(row).toHaveText('Full screen…');
        await row.tap();
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toBeVisible();
        await expect(page.locator('#confirm-title')).toContainText('Full screen');
        await expect(page.locator('#confirm-message')).toContainText('Share → Add to Home Screen');
        await expect(page.locator('#confirm-message')).toContainText('separate storage');
        expect(await fs(page)).toMatchObject({ requests: 0 });
        await page.locator('#confirm-ok-btn').tap();
        await expect(dialog).toBeHidden();
    });

    test('the app on the Home Screen has no full screen row', async ({ page }) => {
        await stubFullscreen(page, false, { standalone: true });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await openMore(page);
        await expect(page.locator('.bottom-sheet-item', { hasText: 'Settings' })).toBeVisible();
        await expect(page.locator('#sheet-fullscreen')).toHaveCount(0);
    });
});

test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('no full screen row outside the bottom-bar regime', async ({ page }) => {
        await stubFullscreen(page, true);
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showMoreMenuSheet());
        await expect(page.locator('.bottom-sheet-more')).toBeVisible();
        await expect(page.locator('#sheet-fullscreen')).toHaveCount(0);
    });
});
