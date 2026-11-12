import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, seedTree, waitForPersist, type SeedPerson } from './helpers.js';

/**
 * The Table view's saved views and its CSV export (spec 073 §9, §11): save a
 * changed view as a new one, switch, "● changed" and Save, the view and its
 * unsaved state back after the tree is opened again; rename and delete; the
 * CSV of what the table shows ("N of M" rows and a head); the Export dialog's
 * link into the table; on a phone the views and the export as sheets.
 */

const FAMILY: Record<string, SeedPerson> = {
    a: { firstName: 'Ferdan', lastName: 'Oskvelt', birthDate: '1850-03-01', deathDate: '1910-05-02', partners: ['b'] },
    b: { firstName: 'Lumira', lastName: 'Haskendal', gender: 'female', birthDate: '1855-07-12', deathDate: '1920-01-09', partners: ['a'] },
    c: { firstName: 'Petrin', lastName: 'Oskvelt', birthDate: '1880-01-04', deathDate: '1950-02-03', parents: ['a', 'b'], partners: ['d'] },
    d: { firstName: 'Ilvena', lastName: 'Šťorbalová', gender: 'female', birthDate: '1884-09-20', deathDate: '1960-11-11', partners: ['c'] },
    e: { firstName: 'Ondrin', lastName: 'Oskvelt', birthDate: '1915-04-02', deathDate: '1990-06-30', parents: ['c', 'd'] },
    f: { firstName: 'Mareth', lastName: 'Oskvelt', gender: 'female', birthDate: '1952-08-14', parents: ['e'] },
    g: { firstName: 'Hedda', lastName: 'Prellwin', gender: 'female', birthDate: '1975-03-03' },
};

const status = (page: Page) => page.locator('#table-container .tv-status-count');
const viewBtn = (page: Page) => page.locator('#table-container .tv-view-btn');
const viewName = (page: Page) => page.locator('#table-container .tv-view-name');
const changed = (page: Page) => page.locator('#table-container .tv-view-changed');
const chip = (page: Page, id: string) => page.locator(`#table-container .tv-chips .tv-chip[data-chip="${id}"]`);
const menuItem = (page: Page, label: string) => page.locator('.tv-menu .tv-menu-item', { hasText: label });

async function openTable(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Oskvelt', 'c');
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-grid')).toBeVisible();
    await expect(status(page)).toHaveText('7 of 7 people');
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('save as new, switch, change → "changed", Save; the view and its changes are back after a reload', async ({ page }) => {
        await openTable(page);
        await expect(viewName(page)).toHaveText('Overview');
        await expect(changed(page)).toBeHidden();

        // A built-in view changed: no Save, the mark says why.
        await chip(page, 'deceased').click();
        await expect(status(page)).toHaveText('5 of 7 people');
        await expect(changed(page)).toHaveText('● changed');
        await expect(changed(page)).toHaveAttribute('title', 'The built-in view stays as it is. Changes can be saved as a new view.');
        await expect(page.locator('#table-container .tv-view-save')).toBeHidden();
        await expect(page.locator('#table-container .tv-view-discard')).toBeVisible();

        // Save as new: the name panel, prefilled "{name} 2", Enter saves.
        await page.locator('#table-container .tv-view-saveas').click();
        const panel = page.locator('.tv-fpanel.tv-vpanel');
        await expect(panel).toBeVisible();
        const input = panel.locator('.tv-vname-input');
        await expect(input).toHaveValue('Overview 2');
        await input.fill('');
        await panel.locator('.tv-fpanel-apply').click();
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        await input.fill('Deceased line');
        await input.press('Enter');
        await expect(panel).toHaveCount(0);
        await expect(viewName(page)).toHaveText('Deceased line');
        await expect(changed(page)).toBeHidden();

        // The list: built-in first, then the tree's own; the open one checked.
        await viewBtn(page).click();
        await expect(page.locator('.tv-menu .tv-menu-heading')).toHaveText(['Built-in', 'Custom']);
        await expect(menuItem(page, 'Deceased line')).toHaveAttribute('aria-checked', 'true');
        await expect(menuItem(page, 'Marriages').locator('.tv-menu-hint')).toHaveText('unions');
        await menuItem(page, 'Overview').click();
        await expect(viewName(page)).toHaveText('Overview');
        await expect(status(page)).toHaveText('7 of 7 people');
        await expect(changed(page)).toBeHidden();

        await viewBtn(page).click();
        await menuItem(page, 'Deceased line').click();
        await expect(status(page)).toHaveText('5 of 7 people');

        // A saved view changed: Save keeps it.
        await page.locator('#table-container .tv-headrow [data-col="name"]').click();
        await expect(changed(page)).toBeVisible();
        await page.locator('#table-container .tv-view-save').click();
        await expect(changed(page)).toBeHidden();

        // An unsaved change and the open view come back with the tree.
        await page.locator('#table-container .tv-headrow [data-col="bDate"]').click();
        await expect(changed(page)).toBeVisible();
        const sort = page.locator('#table-container .tv-status-sort');
        await expect(sort).toHaveText('Sort: Birth date ↑');
        await waitForPersist(page, 'Deceased line');
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        if (!await page.locator('#table-container .tv-grid').isVisible()) await page.locator('#view-mode-table').click();
        await expect(viewName(page)).toHaveText('Deceased line');
        await expect(changed(page)).toBeVisible();
        await expect(status(page)).toHaveText('5 of 7 people');
        await expect(sort).toHaveText('Sort: Birth date ↑');
        // Discard changes: the view as saved.
        await page.locator('#table-container .tv-view-discard').click();
        await expect(changed(page)).toBeHidden();
        await expect(status(page)).toHaveText('5 of 7 people');
    });

    test('rename and delete a saved view; a deleted view falls back to Overview; built-in ones cannot', async ({ page }) => {
        await openTable(page);
        await viewBtn(page).click();
        await expect(menuItem(page, 'Rename…')).toHaveAttribute('aria-disabled', 'true');
        await expect(menuItem(page, 'Delete')).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('.tv-menu .tv-menu-foot')).toHaveText('A built-in view cannot be renamed or deleted.');
        await menuItem(page, 'Save as new…').click();
        const input = page.locator('.tv-vpanel .tv-vname-input');
        await input.fill('Overview');
        await input.press('Enter');
        // The name is taken by a built-in view: " (2)".
        await expect(viewName(page)).toHaveText('Overview (2)');

        await viewBtn(page).click();
        await menuItem(page, 'Rename…').click();
        await expect(input).toHaveValue('Overview (2)');
        await input.fill('Parish book');
        await input.press('Enter');
        await expect(viewName(page)).toHaveText('Parish book');

        await viewBtn(page).click();
        await menuItem(page, 'Delete').click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toBeVisible();
        await expect(confirm.locator('#confirm-title')).toHaveText('Delete the view Parish book?');
        await confirm.locator('#confirm-buttons button', { hasText: 'Delete' }).click();
        await expect(viewName(page)).toHaveText('Overview');
        await viewBtn(page).click();
        await expect(page.locator('.tv-menu .tv-menu-heading')).toHaveText(['Built-in']);
    });

    test('unsaved columns of a view come back after a reload, of a view left too; once saved, nothing unsaved (T54 G9)', async ({ page }) => {
        await openTable(page);
        await waitForPersist(page, 'Ferdan');
        const headCell = (id: string) => page.locator(`#table-container .tv-headrow [data-col="${id}"]`);
        const reopen = async (): Promise<void> => {
            await page.reload();
            await expect(page.locator('html')).not.toHaveClass(/app-loading/);
            if (!await page.locator('#table-container .tv-grid').isVisible()) await page.locator('#view-mode-table').click();
            await expect(status(page)).toHaveText('7 of 7 people');
        };
        // Hide a column of Overview from its header menu: "changed".
        await expect(headCell('bPlace')).toBeVisible();
        await headCell('bPlace').hover();
        await headCell('bPlace').getByRole('button', { name: /^Column menu: / }).click();
        await page.getByRole('menuitem', { name: 'Hide column' }).click();
        await expect(headCell('bPlace')).toHaveCount(0);
        await expect(changed(page)).toBeVisible();
        await reopen();
        await expect(viewName(page)).toHaveText('Overview');
        await expect(changed(page)).toBeVisible();
        await expect(headCell('bPlace')).toHaveCount(0);

        // Another view, a reload, and back: Overview still has its unsaved columns.
        await viewBtn(page).click();
        await menuItem(page, 'Sources and citations').click();
        await expect(viewName(page)).toHaveText('Sources and citations');
        await expect(changed(page)).toBeHidden();
        await reopen();
        await expect(viewName(page)).toHaveText('Sources and citations');
        await viewBtn(page).click();
        await menuItem(page, 'Overview').click();
        await expect(viewName(page)).toHaveText('Overview');
        await expect(changed(page)).toBeVisible();
        await expect(headCell('bPlace')).toHaveCount(0);

        // Saved as a new view: after a reload it opens as saved, nothing "changed".
        await page.locator('#table-container .tv-view-saveas').click();
        const input = page.locator('.tv-vpanel .tv-vname-input');
        await input.fill('Without places');
        await input.press('Enter');
        await expect(viewName(page)).toHaveText('Without places');
        await expect(changed(page)).toBeHidden();
        await waitForPersist(page, 'Without places');
        await reopen();
        await expect(viewName(page)).toHaveText('Without places');
        await expect(changed(page)).toBeHidden();
        await expect(headCell('bPlace')).toHaveCount(0);
        await viewBtn(page).click();
        await menuItem(page, 'Overview').click();
        await expect(changed(page)).toBeHidden();
        await expect(headCell('bPlace')).toBeVisible();
    });

    test('Export: the panel, then a CSV with a head and as many rows as "N of M"', async ({ page }) => {
        await openTable(page);
        await chip(page, 'deceased').click();
        await expect(status(page)).toHaveText('5 of 7 people');
        await page.locator('#table-container .tv-export-btn').click();
        const panel = page.locator('.tv-fpanel.tv-xpanel');
        await expect(panel).toBeVisible();
        expect(Math.round((await panel.boundingBox())!.width)).toBe(380);
        await expect(panel.locator('.tv-xopt')).toHaveText(['●CSV · for Excel and Google Sheets', '○XLSX · groups, frozen panes, check colours',
            '●Shown · 5 of 7 people (filter: Deceased)', '○All people without the filter · 7']);
        await expect(panel.locator('.tv-xfile')).toHaveText('File: Oskvelt_Overview_2026-06-15.csv');
        await expect(panel.locator('.tv-fpanel-cancel')).toHaveCount(0);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            panel.locator('.tv-fpanel-apply', { hasText: 'Download CSV' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('Oskvelt_Overview_2026-06-15.csv');
        const text = readFileSync(await download.path(), 'utf-8');
        expect(text.charCodeAt(0)).toBe(0xfeff);
        const lines = text.slice(1).split('\r\n').filter(Boolean);
        const head = lines[0].split(';');
        expect(head[0]).toBe('Full name');
        expect(lines.length - 1).toBe(5);
        expect(lines.slice(1).every(l => l.split(';').length === head.length)).toBe(true);
        await expect(page.locator('.toast').last()).toContainText(
            `Downloaded: Oskvelt_Overview_2026-06-15.csv · 5 people, 5 rows, ${head.length} columns`);
    });

    test('the Export dialog links to the Table view and opens its Export', async ({ page }) => {
        await openTable(page);
        await page.locator('#view-mode-family').click();
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        const link = page.locator('#export-modal .export-table-link');
        await expect(link).toHaveText('Custom columns, filter and sort: Table view ›');
        await link.click();
        await expect(page.locator('#export-modal')).toBeHidden();
        await expect(page.locator('#table-container .tv-grid')).toBeVisible();
        await expect(page.locator('.tv-fpanel.tv-xpanel')).toBeVisible();
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the views and the export as sheets', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
        await openApp(page);
        await seedTree(page, FAMILY, 'Oskvelt', 'c');
        await page.locator('#bb-view-table').tap();
        await expect(status(page)).toHaveText('7 of 7 people');

        await expect(viewBtn(page)).toBeVisible();
        await expect(page.locator('#table-container .tv-view-label')).toBeHidden();
        await viewBtn(page).tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-item', { hasText: 'Marriages' })).toContainText('unions');
        await sheet.locator('.bottom-sheet-item', { hasText: 'Deaths' }).tap();
        await expect(viewName(page)).toHaveText('Deaths');
        await expect(status(page)).toHaveText('5 of 7 people');

        // On a phone Export is in ⋯ (§12).
        await page.locator('#table-container .tv-more-menu-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Export' }).tap();
        const xs = page.locator('.tv-fsheet.tv-xpanel');
        await expect(xs).toBeVisible();
        await expect(xs.locator('.tv-xopt').nth(2)).toHaveText('●Shown · 5 of 7 people (filter: Deceased)');
        const box = (await xs.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            xs.locator('.tv-fs-apply', { hasText: 'Download CSV' }).tap(),
        ]);
        expect(download.suggestedFilename()).toBe('Oskvelt_Deaths_2026-06-15.csv');
        // No row of the bar runs past the phone's width.
        const right = await page.locator('#table-container .tv-bar-row1 > *').evaluateAll(els =>
            Math.max(...els.map(el => el.getBoundingClientRect().right)));
        expect(right).toBeLessThanOrEqual(390);
    });
});
