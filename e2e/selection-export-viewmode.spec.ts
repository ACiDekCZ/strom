/**
 * The window's selection in an exported tree opened read-only (spec 098
 * §12): the toolbar's choice and the person menu's Select › work (a list of
 * the tree included), Hide others too; nothing offers to save the selection
 * as a list. Invented names only (e2e/rods-fixture.ts).
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { pathToFileURL } from 'url';
import { openApp, card } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

async function exportAndOpen(page: Page, testInfo: TestInfo): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
    const out = testInfo.outputPath('exported.html');
    await download.saveAs(out);
    await page.goto(pathToFileURL(out).href);
    await expect(page.locator('body')).toHaveClass(/view-mode/);
}

const host = (page: Page) => page.locator('#view-rod-picker');
const pill = (page: Page) => page.locator('#evidence-pill');
const pillName = (page: Page) => pill(page).locator('.evidence-pill-label--pick');

test.describe('the selection in an exported tree', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the choice, a list and Select › work read-only; nothing offers to save it as a list', async ({ page }, testInfo) => {
        await openApp(page);
        await page.evaluate(async (data) => {
            const S = window.Strom;
            await S.DataManager.importAsNewTree(data, 'Brandvold');
            S.DataManager.createPersonList({ name: 'Letters', dynamic: false, personIds: ['b14', 'b15'] as never[], sort: 'manual' });
            S.TreeRenderer.setFocus('b16' as never);
            await S.TreeRenderer.renderAsync();
        }, rodsTree());
        await exportAndOpen(page, testInfo);
        await expect(card(page, 'Mikael')).toBeVisible();
        expect(await page.evaluate(() => window.Strom.DataManager.isReadOnly())).toBe(true);

        // A list of the tree from the toolbar's choice; Hide others.
        await host(page).locator('.sp-rodpick-btn').click();
        const pop = host(page).locator('.sp-rodpick-pop');
        await expect(pop).toBeVisible();
        await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Letters' }).locator('button').click();
        await expect(pillName(page)).toContainText('Letters');
        await pill(page).locator('.evidence-pill-hide').click();
        await expect(pill(page).locator('.evidence-pill-hide')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#tree-canvas .person-card[data-id="b14"]')).toBeVisible();

        // Select › Ancestors from the person menu; the choice does not offer to save it.
        await card(page, 'Mikael').click();
        await page.locator('.context-menu.person-menu [data-menu="select"]').click();
        await page.locator('.context-submenu [data-action^="select:anc:"]').click();
        await expect(pillName(page)).toContainText('Ancestors: Mikael');
        await host(page).locator('.sp-rodpick-btn').click();
        await expect(pop.locator('.sp-selpick-cur')).toBeVisible();
        await expect(pop.locator('.sp-selpick-save')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // Cleared with ×.
        await pill(page).locator('.evidence-pill-close').click();
        await expect(pill(page)).toBeHidden();
    });
});
