import { test, expect, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { webkit } from 'playwright';
import { openApp, card, controlCardComesBack } from './helpers.js';
import { expectFits, phoneScreens, sampleTree } from './mobile-screens.js';
import { poll, openResearchMenu, researchGed, HEAD, UUID, BRIDGE, dropFile, block } from './research-bridge.js';

/**
 * An iPhone, an iPad and desktop Safari (WebKit; an Android phone in
 * mobile-android.spec.ts): the main screens fit, a card
 * opens its sheet, the minimap shows where there is room and moves the view,
 * the prompt of a new version fits the screen, and Safari says it cannot reach
 * the research on this computer. WebKit runs where it is installed (`npx
 * playwright install webkit`); CI installs Chromium only, so there it skips.
 */

const hasWebkit = (() => { try { return existsSync(webkit.executablePath()); } catch { return false; } })();
test.skip(!hasWebkit, 'WebKit is not installed here');
test.use({ browserName: 'webkit' });

/** A device's screen and touch, the browser being this file's (WebKit). */
function screenOf(name: string) {
    const { defaultBrowserType: _browser, ...screen } = devices[name];
    return screen;
}

test.describe('iPhone (WebKit)', () => {
    test.use(screenOf('iPhone 14'));
    test('the main screens fit; a card opens its sheet; no minimap; the new-version prompt fits', async ({ page }) => {
        await phoneScreens(page);
    });
});

test.describe('iPad (WebKit)', () => {
    test.use(screenOf('iPad (gen 7) landscape'));
    test('the minimap shows when zoomed in and a tap in it moves the view', async ({ page }) => {
        await sampleTree(page);
        for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
        await expect(page.locator('#minimap-panel')).toBeVisible();
        const before = await page.evaluate(() => JSON.stringify(window.Strom.ZoomPan.getTransform()));
        const mm = (await page.locator('#minimap-canvas').boundingBox())!;
        await page.mouse.click(mm.x + mm.width * 0.85, mm.y + mm.height * 0.85);
        await expect.poll(() => page.evaluate(() => JSON.stringify(window.Strom.ZoomPan.getTransform()))).not.toBe(before);
        await expectFits(page, 'tablet with the minimap');
    });
});

test.describe('Safari on a computer (WebKit)', () => {
    // Safari's own user agent (the project's is Chrome's).
    test.use({ ...screenOf('Desktop Safari'), viewport: { width: 1280, height: 850 } });
    test('a research tree: Safari says it cannot reach the research on this computer, and offers the file', async ({ page }) => {
        await openApp(page);
        await dropFile(page, 'tree-strom.ged', researchGed(HEAD));
        await expect(card(page, 'Jan')).toBeVisible();
        await page.evaluate(({ uuid, base }) => localStorage.setItem(`strom-research-bridge:${uuid}`,
            JSON.stringify({ base, accepts: { sync: { auto: 'write' }, sources: true, verified: true } })), { uuid: UUID, base: BRIDGE });
        // No bridge answers (Safari blocks the page from 127.0.0.1; here nothing listens there).
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'safari');
        await expect(block(page)).toContainText("Safari can't reach the research");
        await expect(block(page)).toContainText('open the tree in Chrome, Edge or Firefox');
        await expect(block(page).locator('[data-action="downloadGedcom"]')).toBeVisible();
    });
    // B17-1: Safari reported the shown minimap inside the hidden card as hidden.
    test('with the zoom buttons off the minimap and its card come back after the tree fitted', async ({ page }) => {
        await controlCardComesBack(page);
    });
});
