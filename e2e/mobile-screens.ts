import { expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/** Shared by the phone specs (mobile-webkit.spec.ts, mobile-android.spec.ts). */

/** Nothing wider than the screen: no sideways scroll of the page, and every open dialog inside it. */
export async function expectFits(page: Page, what: string): Promise<void> {
    const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        const over = [...document.querySelectorAll('.modal-overlay.active .modal, .bottom-sheet, .pwa-update.show, .toast')]
            .map(el => el.getBoundingClientRect()).filter(b => b.width > 0 && (b.left < -1 || b.right > vw + 1)).length;
        return { scroll: document.documentElement.scrollWidth, vw, over };
    });
    expect(r.scroll, `${what}: the page scrolls sideways`).toBeLessThanOrEqual(r.vw + 1);
    expect(r.over, `${what}: something sticks out of the screen`).toBe(0);
}

export async function sampleTree(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
}

/** The main screens on a phone: the empty state, a tree, a card's sheet, a form, Settings, the new-version prompt. */
export async function phoneScreens(page: Page): Promise<void> {
    await openApp(page);
    await expect(page.locator('#empty-state')).toBeVisible();
    await expectFits(page, 'empty state');
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expectFits(page, 'tree');
    // The minimap needs the control block, which a phone does not have.
    for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
    await expect(page.locator('#minimap-panel')).toBeHidden();
    await card(page, 'Johan').tap();
    await expect(page.locator('.bottom-sheet-person')).toBeVisible();
    await expectFits(page, 'card sheet');
    await page.evaluate(() => window.Strom.UI.hideBottomSheet());
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await expect(page.locator('#person-modal')).toBeVisible();
    await expectFits(page, 'add person');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expectFits(page, 'Settings');
    await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
    await page.evaluate(() => window.Strom.UI.showUpdateAvailable());
    const prompt = page.locator('.pwa-update');
    await expect(prompt).toContainText('A new version is available.');
    await expect(prompt.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expectFits(page, 'new-version prompt');
}

