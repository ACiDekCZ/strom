import { test, expect, devices } from '@playwright/test';
import { phoneScreens } from './mobile-screens.js';
import { openApp, card } from './helpers.js';
import { dropFile, researchGed, HEAD } from './research-bridge.js';

/** An Android phone (Chromium): the same main screens as the iPhone in mobile-webkit.spec.ts. */
test.use({ ...devices['Pixel 7'] });

test('Android phone: the main screens fit; a card opens its sheet; no minimap; the new-version prompt fits', async ({ page }) => {
    await phoneScreens(page);
});

test.describe('Android phone held sideways', () => {
    const { defaultBrowserType: _browser, ...sideways } = devices['Pixel 7 landscape'];
    test.use(sideways);
    test('the empty state scrolls beside the side bar and under the header: Try a sample tree can be reached and tapped', async ({ page }) => {
        await openApp(page);
        const empty = page.locator('#empty-state');
        await expect(empty).toBeVisible();
        // Taller than the space: it scrolls (by the user's finger as by the wheel), not the tree.
        await empty.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const demo = page.getByRole('button', { name: 'Try a sample tree' });
        const box = (await demo.boundingBox())!;
        // Sideways the bar is a side bar on the left (4a of the phone round).
        const bar = (await page.locator('.bottom-bar').boundingBox())!;
        const toolbar = (await page.locator('.toolbar').boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bar.x + bar.width);
        expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
        expect(box.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
        await demo.tap();
        await expect(card(page, 'Johan')).toBeVisible();
    });
});

test('a research tree on a phone: Ancestor research says the research is on a computer, not how to install it', async ({ page }) => {
    await openApp(page);
    await dropFile(page, 'tree-strom.ged', researchGed(HEAD));
    await expect(card(page, 'Jan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.showResearchInfoDialog());
    await expect(page.locator('#confirmation-modal')).toContainText('This tree already has its research');
    await expect(page.locator('#research-install-modal')).toHaveCount(0);
});

test('a phone: the small links of the person form are big enough for a finger; a reminder never sits over an open dialog', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const more = page.locator('#person-modal .detail-more:visible').first();
    await expect(more).toBeVisible();
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The reminder to save to a file, shown while a dialog is open: it waits.
    await page.evaluate(() => {
        const el = document.createElement('div');
        el.id = 'file-copy-notice';
        el.className = 'storage-notice file-copy-notice show';
        el.textContent = 'reminder';
        document.body.appendChild(el);
    });
    await expect(page.locator('#file-copy-notice')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#file-copy-notice')).toBeVisible();
});
