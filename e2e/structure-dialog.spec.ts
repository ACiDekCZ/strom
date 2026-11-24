import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, createFirstPerson, openTreeActions, openStructureDialog } from './helpers.js';

/**
 * Change structure… (spec 139 §1–§2): one item of the tree's actions opens a
 * dialog of the options in three groups; a greyed option says why under it,
 * the steps of an option are further screens of the same dialog.
 */

const OPTION_KEYS = ['select', 'copy', 'families', 'parts', 'into', 'file'];

/** A second, empty tree; the first one stays open. */
async function secondTree(page: Page, name: string): Promise<void> {
    await page.evaluate(async (n) => {
        const TM = window.Strom.TreeManager;
        const id = TM.createTree(n);
        await TM.saveTreeData(id, { persons: {}, partnerships: {} });
    }, name);
}

function option(dialog: Locator, key: string): Locator {
    return dialog.locator(`.menu-option[data-action="${key}"]`);
}

test.describe('desktop', () => {
    test('the groups and options with their direction; ↓ skips a greyed option; a step and back by its header and Escape', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Vojtěch', 'Jesenský');
        await secondTree(page, 'Rodina Kalinovských');

        const dialog = await openStructureDialog(page, await openTreeActions(page));
        await expect(dialog.locator('#structure-title')).toHaveText('Change structure: My Family Tree');
        await expect(dialog.locator('.structure-intro')).toHaveText('What should happen to the tree. Each option says which tree changes.');
        await expect(dialog.locator('.menu-group-title')).toHaveText(['New tree', 'Split', 'Join']);
        expect(await dialog.locator('.menu-option').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action))).toEqual(OPTION_KEYS);
        await expect(dialog.locator('.menu-option .option-title')).toHaveText([
            'From a selection…', 'Copy of the whole tree', 'Into families…', 'Separate disconnected parts…',
            'A selection or the whole tree into another tree…', 'Add from a file to this tree…',
        ]);
        await expect(dialog.locator('.menu-option svg.structure-dir')).toHaveCount(6);
        // No back button on the first screen; Close only (the tree is open).
        await expect(dialog.locator('#structure-back')).toBeHidden();
        await expect(dialog.locator('#structure-footer button')).toHaveText(['Close']);

        // One person is one connected family: nothing to separate, said under the option.
        await expect(option(dialog, 'parts')).toHaveAttribute('aria-disabled', 'true');
        await expect(dialog.locator('#structure-why-parts')).toHaveText('The whole tree is connected.');

        // Keyboard: the first option focused, ↓ skips the greyed one, End/Home the ends.
        await expect(option(dialog, 'select')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(option(dialog, 'families')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(option(dialog, 'into')).toBeFocused();
        await page.keyboard.press('End');
        await expect(option(dialog, 'file')).toBeFocused();
        await page.keyboard.press('Home');
        await expect(option(dialog, 'select')).toBeFocused();

        // Enter on Join › into another tree: its first step in the same dialog.
        await option(dialog, 'into').focus();
        await page.keyboard.press('Enter');
        await expect(dialog).toHaveAttribute('data-step', 'join-what');
        await expect(dialog.locator('#structure-title')).toHaveText('Join into another tree');
        await expect(dialog.locator('#structure-sub')).toHaveText('My Family Tree · what to join');
        const back = dialog.locator('#structure-back');
        await expect(back).toBeVisible();
        await expect(back).toHaveText('Change structure');
        await expect(dialog.locator('[data-join="whole"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-join="whole"]')).toContainText('The whole tree My Family Tree');
        await expect(dialog.locator('#structure-footer button')).toHaveText(['Back', 'Cancel', 'Continue to the guide']);
        // ↓ chooses the selection, as a radio group does.
        await page.keyboard.press('ArrowDown');
        await expect(dialog.locator('[data-join="selection"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-join="selection"]')).toBeFocused();
        await back.click();
        await expect(dialog).toHaveAttribute('data-step', 'options');
        await expect(back).toBeHidden();

        // The file step; Escape goes back one screen, then closes.
        await option(dialog, 'file').click();
        await expect(dialog).toHaveAttribute('data-step', 'file');
        await expect(dialog.locator('#structure-title')).toHaveText('Add from a file to this tree');
        await expect(dialog.locator('.menu-option[data-action="gedcom"]')).toContainText('GEDCOM file (.ged)');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveAttribute('data-step', 'options');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });

    test('the only tree has nothing to join into; the whole tree goes to the merge guide', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Vojtěch', 'Jesenský');
        let dialog = await openStructureDialog(page, await openTreeActions(page));
        await expect(option(dialog, 'into')).toHaveAttribute('aria-disabled', 'true');
        await expect(dialog.locator('#structure-why-into')).toHaveText('There is no other tree.');
        await option(dialog, 'into').click({ force: true });
        await expect(dialog).toHaveAttribute('data-step', 'options');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();

        // With another tree: the whole tree into it through the guide, the dialog gives way to it.
        await secondTree(page, 'Rodina Kalinovských');
        dialog = await openStructureDialog(page, await openTreeActions(page));
        await option(dialog, 'into').click();
        await dialog.locator('[data-action="continue"]').click();
        const wizard = page.locator('#merge-modal');
        await expect(wizard).toBeVisible();
        await expect(dialog).toBeHidden();
        await expect(wizard.locator('.merge-s1-targets')).toContainText('Rodina Kalinovských');
    });

    test('a tree that is not open, from Manage trees: what needs it open says so, Open the tree… brings the options alive; Escape back to the manager', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Vojtěch', 'Jesenský');
        await secondTree(page, 'Ostrožní z Mezihoře');
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const manager = page.locator('#tree-manager-modal');
        const row = manager.locator('.tree-manager-item', { hasText: 'Ostrožní z Mezihoře' });
        const dialog = await openStructureDialog(page, row.locator('.tree-manager-item-actions'));
        await expect(manager).not.toHaveClass(/active/);
        await expect(dialog.locator('#structure-title')).toHaveText('Change structure: Ostrožní z Mezihoře');
        for (const key of ['select', 'file']) {
            await expect(option(dialog, key)).toHaveAttribute('aria-disabled', 'true');
            await expect(dialog.locator(`#structure-why-${key}`)).toHaveText('Once the tree is open.');
        }
        for (const key of ['copy', 'families', 'into']) await expect(option(dialog, key)).not.toHaveAttribute('aria-disabled', 'true');
        // A selection to join needs the tree open too.
        await option(dialog, 'into').click();
        await expect(dialog.locator('[data-join="selection"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(dialog.locator('[data-join="selection"]')).toContainText('Once the tree is open.');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveAttribute('data-step', 'options');

        // Escape returns to the manager it was opened from.
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(manager).toHaveClass(/active/);

        // Open the tree…: the tree opens and its options come alive.
        await openStructureDialog(page, row.locator('.tree-manager-item-actions'));
        const open = dialog.locator('#structure-footer [data-action="openTree"]');
        await expect(open).toHaveText('Open the tree Ostrožní z Mezihoře');
        await open.click();
        await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Ostrožní z Mezihoře');
        await expect(dialog).toBeVisible();
        await expect(option(dialog, 'select')).not.toHaveAttribute('aria-disabled', 'true');
        await expect(option(dialog, 'file')).not.toHaveAttribute('aria-disabled', 'true');
        await expect(dialog.locator('#structure-footer [data-action="openTree"]')).toHaveCount(0);
    });
});

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    for (const way of [{ name: 'upright', width: 390, height: 844 }, { name: 'held sideways', width: 844, height: 390 }]) {
        test(`More › Tree › Change structure… opens the dialog over the whole screen, nothing overflows (${way.name})`, async ({ page }) => {
            await page.setViewportSize({ width: way.width, height: way.height });
            await openApp(page);
            await createFirstPerson(page, 'Vojtěch', 'Jesenský');
            await page.locator('#bb-view-more').tap();
            await page.locator('.bottom-sheet-tree-row').click();
            const sheet = page.locator('.bottom-sheet-tree-actions');
            await expect(sheet).toBeVisible();
            await sheet.locator('[data-action="structure"]').click();
            await expect(sheet).toHaveCount(0);

            const dialog = page.locator('#structure-modal');
            await expect(dialog).toBeVisible();
            const box = (await dialog.locator('.modal').boundingBox())!;
            expect(Math.round(box.x)).toBe(0);
            expect(Math.round(box.width)).toBe(way.width);
            expect(Math.round(box.height)).toBe(way.height);
            for (const h of await dialog.locator('.menu-option').evaluateAll(els => els.map(el => el.getBoundingClientRect().height))) {
                expect(Math.round(h)).toBeGreaterThanOrEqual(56);
            }
            // Nothing wider than the screen; the footer on screen.
            const content = dialog.locator('.modal-content');
            expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            const footer = (await dialog.locator('#structure-footer').boundingBox())!;
            expect(footer.y + footer.height).toBeLessThanOrEqual(way.height + 1);
            await dialog.locator('#structure-footer [data-dismiss]').click();
            await expect(dialog).toBeHidden();
        });
    }
});
