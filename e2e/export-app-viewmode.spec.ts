import { test, expect, Page, TestInfo } from '@playwright/test';
import { pathToFileURL } from 'url';
import { openApp, createFirstPerson, card, addRelation } from './helpers.js';

/**
 * Start the standalone-HTML app export from the export dialog. Optionally set an
 * encryption password. Returns after the export-password dialog is ready to
 * confirm.
 */
async function openAppExportDialog(page: Page, password?: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    if (password) {
        await pwd.locator('#export-encrypt-toggle').check();
        await pwd.locator('#export-password-input').fill(password);
        await pwd.locator('#export-password-confirm').fill(password);
    }
}

/** Save the just-triggered download as an .html file and open it via file://. */
async function saveAndOpen(page: Page, testInfo: TestInfo, downloadPromise: Promise<import('@playwright/test').Download>): Promise<void> {
    const download = await downloadPromise;
    const out = testInfo.outputPath('exported.html');
    await download.saveAs(out);
    await page.goto(pathToFileURL(out).href);
}

test('exported standalone HTML opens in read-only view mode', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    await openAppExportDialog(page);
    await saveAndOpen(page, testInfo, (async () => {
        const [d] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-password-modal').locator('#export-submit-btn').click(),
        ]);
        return d;
    })());

    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(page.locator('#view-mode-banner')).toBeVisible();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();

    // Editing affordances are hidden in view mode (CSS driven by body.view-mode).
    await expect(page.locator('#add-person-btn')).toBeHidden();
    await expect(page.locator('.add-person-round')).toBeHidden();
    await expect(page.locator('.toolbar-buttons')).toBeHidden();
});

test('every stromapp.info link of the exported file carries the exported tree, not the file\'s own default tree', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        tm.renameTree(tm.getActiveTreeId()!, 'Sledovany');
    });

    await openAppExportDialog(page);
    await saveAndOpen(page, testInfo, (async () => {
        const [d] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-password-modal').locator('#export-submit-btn').click(),
        ]);
        return d;
    })());
    await expect(page.locator('#view-mode-banner')).toBeVisible();

    // The view mode button, the top banner link and the info dialog link alike.
    for (const id of ['view-mode-go-online', 'go-online-link', 'embedded-info-go-online']) {
        await expect(page.locator(`#${id}`)).toHaveAttribute('href', /[?&]import=from-file&name=Sledovany$/);
    }
});

test('encrypted exported HTML requires the correct password to reveal the tree', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    await openAppExportDialog(page, 'correct-horse');
    await saveAndOpen(page, testInfo, (async () => {
        const [d] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-password-modal').locator('#export-submit-btn').click(),
        ]);
        return d;
    })());

    // The opened file withholds view mode behind a password prompt.
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/view-mode/);

    // Wrong password: error shown, prompt stays, still locked.
    await prompt.locator('#password-prompt-input').fill('nope');
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt.locator('#password-prompt-error')).toBeVisible();
    await expect(prompt).toBeVisible();

    // Correct password: prompt closes, tree revealed in view mode.
    await prompt.locator('#password-prompt-input').fill('correct-horse');
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
});

/**
 * Menu 1020 §10: an exported page (view mode) has an Actions menu (P) and a
 * More sheet (T) with what works there — Anniversaries, Family book, Poster,
 * the fly-through, Tree overview, Settings (language, theme) and About; no
 * Export, nothing that edits. Before, Actions opened empty.
 */
test.describe('view mode: Actions and More carry what an exported page can do', () => {
    async function exportedTree(page: Page, testInfo: TestInfo): Promise<void> {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
        await openAppExportDialog(page);
        await saveAndOpen(page, testInfo, (async () => {
            const [d] = await Promise.all([
                page.waitForEvent('download'),
                page.locator('#export-password-modal').locator('#export-submit-btn').click(),
            ]);
            return d;
        })());
        await expect(page.locator('body')).toHaveClass(/view-mode/);
        await expect(card(page, 'Jan')).toBeVisible();
    }

    test('a computer: the Actions rows, each one opens', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await exportedTree(page, testInfo);
        const dropdown = page.locator('#actions-menu-dropdown');
        const open = async () => {
            await page.locator('.actions-menu-btn').click();
            await expect(dropdown).toHaveClass(/active/);
        };
        await open();
        // The same "For the family ›" as in editing; About is reached through Settings (menu 1020 D1, D18).
        const rows = (await dropdown.locator(':scope > .tree-switcher-action:visible, :scope > .actions-submenu-wrap:visible > .actions-submenu-row')
            .allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
        expect(rows.map(r => r.replace(/\s*\d+$/, ''))).toEqual(['Anniversaries', 'For the family ›', 'Tree overview', 'Settings']);
        await expect(page.locator('#actions-view-about-row')).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        const viaFamily = async (row: string) => {
            await open();
            await page.locator('#actions-family-row').click();
            await page.locator(row).click();
        };
        await viaFamily('#actions-book-row');
        await expect(page.locator('#book-modal')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeBookDialog());
        await viaFamily('#actions-poster-row');
        await expect(page.locator('#poster-modal')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closePosterDialog());
        await open();
        await page.locator('#actions-settings-row').click();
        await expect(page.locator('#settings-modal')).toHaveClass(/active/);
        // About is reachable from the Settings footer in the view mode too.
        await page.locator('#settings-about').click();
        await expect(page.locator('#settings-modal')).not.toHaveClass(/active/);
        await expect(page.locator('#about-modal')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeAboutDialog());
        await viaFamily('#actions-slideshow-row');
        await expect(page.locator('body')).toHaveClass(/slideshow-mode/);
        await page.evaluate(() => window.Strom.UI.stopSlideshow());
    });

    test('a phone: More has no Undo / Redo, For the family ›, Tree overview, View, Settings | About', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await exportedTree(page, testInfo);
        // The view-mode banner sits above the bottom bar, More is not under it.
        const banner = (await page.locator('#view-mode-banner').boundingBox())!;
        const moreTab = (await page.locator('#bb-view-more').boundingBox())!;
        expect(banner.y + banner.height).toBeLessThanOrEqual(moreTab.y + 1);
        await page.locator('#bb-view-more').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(page.locator('#sheet-undo')).toHaveCount(0);
        const rows = (await sheet.locator('.bottom-sheet-items > .bottom-sheet-item').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
        // "For the family ›" as in editing (menu 1020 D18).
        expect(rows.map(r => r.replace(/\s*\d+$/, ''))).toEqual(['Anniversaries', 'For the family ›', 'Tree overview']);
        await expect(sheet.locator('.bottom-sheet-pair').last().locator('.bottom-sheet-item')).toHaveText(['Settings', 'About Strom']);
        await page.locator('#sheet-family').click();
        await page.locator('#sheet-book').click();
        await expect(page.locator('#book-modal')).toBeVisible();
    });

    test('Actions never opens empty: with no row to show it stays closed', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.addStyleTag({ content: '#actions-menu-dropdown [role="menuitem"] { display: none !important; }' });
        await page.evaluate(() => window.Strom.UI.toggleActionsMenu());
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
    });
});
