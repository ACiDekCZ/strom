/**
 * Export of a list of people (spec 084 §12): ⋯ of a list › Export › with
 * CSV downloaded at once (# first, the list's order) and GEDCOM… opening
 * the dialog Export on the list; the dialog's third scope List of people
 * with its list (remembered, a list gone falls back to the whole tree),
 * GEDCOM and the JSON backup narrowed to the list's people (the lists in
 * the file narrowed too), the other formats disabled; the Table's export in
 * a work list's scope with # and Done; a phone. Invented names only; the
 * clock is fixed.
 */

import { readFileSync } from 'fs';
import { test, expect, Page, Download } from '@playwright/test';
import { openApp, seedTree } from './helpers';

const NOW = new Date('2026-11-16T10:30:00Z');

async function family(page: Page): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    await seedTree(page, {
        q: { firstName: 'Quillon', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1950' },
        t: { firstName: 'Tamsel', lastName: 'Varnholm', parents: ['c', 'y'], partners: ['i'], birthDate: '1921' },
        i: { firstName: 'Ilvara', lastName: 'Brannoc', gender: 'female', partners: ['t'], birthDate: '1925' },
        c: { firstName: 'Corvin', lastName: 'Varnholm', partners: ['y'], birthDate: '1890' },
        y: { firstName: 'Yselda', lastName: 'Fennick', gender: 'female', partners: ['c'], birthDate: '1894' },
        w: { firstName: 'Wendrel', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1953' },
    }, 'Varnholm', 'q');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['t', 'c', 'y'] as never[], sort: 'old' });
        const work = dm.createPersonList({ name: 'Graves to visit', dynamic: false, personIds: ['c', 'q', 'y'] as never[], sort: 'manual' })!;
        dm.setPersonListChecklist(work.id, true);
        dm.togglePersonListDone(work.id, 'q' as never, true);
        dm.togglePersonListDone(work.id, 'y' as never, true);
    });
}

const listId = (page: Page, name: string) => page.evaluate((n) => window.Strom.DataManager.getPersonLists().find(x => x.name === n)!.id, name);
const lists = (page: Page) => page.locator('#person-lists-modal');
const exportModal = (page: Page) => page.locator('#export-modal');

/** CSV lines without the BOM, split into fields. */
async function csvOf(download: Download): Promise<string[][]> {
    const text = readFileSync((await download.path())!, 'utf-8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    return text.slice(1).split('\r\n').filter(Boolean).map(l => l.split(';'));
}

/** Pick Full data in the export's privacy step and download. */
async function confirmExport(page: Page): Promise<Download> {
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
    return download;
}

test.describe('Export of a list: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('⋯ of a list › Export ›: CSV at once in the list\'s order with #; GEDCOM… opens the dialog Export on the list', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = lists(page);
        await d.locator('.pl-row', { hasText: 'Letters to write' }).click();
        await d.locator('[data-act="menu-detail"]').click();
        const main = d.locator('.pl-menu:not(.pl-submenu)');
        const exportRow = main.locator('[data-key="menu-export"]');
        await expect(exportRow).toHaveAttribute('aria-expanded', 'false');
        await exportRow.click();
        const sub = d.locator('.pl-submenu');
        await expect(sub.locator('.pl-menu-item')).toHaveText(['GEDCOM…', 'CSV (list order)']);
        await expect(sub.locator('.pl-menu-item').first()).toBeFocused();
        // Beside the menu, not over it.
        const mb = (await main.boundingBox())!;
        const sb = (await sub.boundingBox())!;
        expect(sb.x >= mb.x + mb.width - 1 || sb.x + sb.width <= mb.x + 1).toBe(true);
        // ← goes back to the row, → opens again; Escape closes the second level only.
        await page.keyboard.press('ArrowLeft');
        await expect(sub).toHaveCount(0);
        await expect(exportRow).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(sub).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(sub).toHaveCount(0);
        await expect(main).toBeVisible();
        await expect(exportRow).toBeFocused();

        await exportRow.click();
        const [csv] = await Promise.all([page.waitForEvent('download'), sub.locator('.pl-menu-item', { hasText: 'CSV' }).click()]);
        expect(csv.suggestedFilename()).toBe('Varnholm_Letters-to-write_2026-11-16.csv');
        const lines = await csvOf(csv);
        expect(lines[0][0]).toBe('#');
        expect(lines[0][1]).toBe('Full name');
        expect(lines.slice(1).map(l => `${l[0]} ${l[1]}`)).toEqual(['1 Corvin Varnholm', '2 Yselda Fennick', '3 Tamsel Varnholm']);

        await d.locator('[data-act="menu-detail"]').click();
        await main.locator('[data-key="menu-export"]').click();
        await sub.locator('.pl-menu-item', { hasText: 'GEDCOM…' }).click();
        await expect(d).toHaveCount(0);
        const m = exportModal(page);
        await expect(m).toBeVisible();
        await expect(m.locator('#export-scope-list')).toHaveAttribute('aria-checked', 'true');
        await expect(m.locator('#export-scope-list')).toHaveText('List of people');
        await expect(m.locator('#export-list-pick label')).toHaveText('List');
        await expect(m.locator('#export-list-select')).toHaveValue(await listId(page, 'Letters to write'));
        await expect(m.locator('#export-list-select option:checked')).toHaveText('Letters to write · 3 people');
        await expect(m.locator('#export-list-kind svg')).toHaveCount(1);
        // GEDCOM and the backup narrowed to the list; the rest export the whole tree only.
        await expect(m.locator('#export-gedcom-btn')).toBeEnabled();
        await expect(m.locator('#export-gedcom-btn .option-desc:visible')).toHaveText('The people of the list and the families between them');
        await expect(m.locator('#export-backup-btn .option-desc:visible')).toHaveText('The tree’s data narrowed to the people of the list');
        const poster = m.locator('.menu-option', { hasText: 'Poster' });
        await expect(poster).toBeDisabled();
        await expect(poster.locator('.option-desc:visible')).toHaveText('This format exports the whole tree');
        await expect(m.locator('.menu-option', { hasText: 'App with data' })).toBeDisabled();

        await m.locator('#export-gedcom-btn').click();
        const ged = await confirmExport(page);
        expect(ged.suggestedFilename()).toBe('varnholm-letters-to-write.ged');
        const text = readFileSync((await ged.path())!, 'utf-8');
        for (const name of ['Corvin', 'Yselda', 'Tamsel']) expect(text).toContain(name);
        for (const name of ['Quillon', 'Wendrel', 'Ilvara', 'Letters to write']) expect(text).not.toContain(name);
        // Corvin and Yselda's family with Tamsel goes along.
        expect(text).toMatch(/0 @F\d+@ FAM/);
    });

    test('the dialog Export\'s List of people: remembered, the backup narrowed with its lists, a list gone falls back to the whole tree', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        const m = exportModal(page);
        await expect(m.locator('.export-scope .segment-btn:visible')).toHaveCount(3);
        await expect(m.locator('#export-scope-list')).toHaveAttribute('aria-checked', 'false');
        await expect(m.locator('#export-list-pick')).toBeHidden();
        await m.locator('#export-scope-list').click();
        await expect(m.locator('#export-list-pick')).toBeVisible();
        const options = await m.locator('#export-list-select option').allTextContents();
        expect(options).toContain('Graves to visit · 3 people');
        expect(options).toContain('Letters to write · 3 people');
        const graves = await listId(page, 'Graves to visit');
        await m.locator('#export-list-select').selectOption(graves);
        await m.locator('#export-backup-btn').click();
        const json = await confirmExport(page);
        expect(json.suggestedFilename()).toBe('varnholm-graves-to-visit.json');
        const data = JSON.parse(readFileSync((await json.path())!, 'utf-8'));
        expect(Object.keys(data.persons).sort()).toEqual(['c', 'q', 'y']);
        const byName = (n: string) => (data.personLists as Array<{ name: string; personIds?: string[]; done?: string[] }>).find(l => l.name === n);
        expect(byName('Graves to visit')!.personIds).toEqual(['c', 'q', 'y']);
        expect(byName('Graves to visit')!.done).toEqual(['q', 'y']);
        // Another list keeps only the people who went along.
        expect(byName('Letters to write')!.personIds).toEqual(['c', 'y']);

        // Remembered with its list.
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await expect(m.locator('#export-scope-list')).toHaveAttribute('aria-checked', 'true');
        await expect(m.locator('#export-list-select')).toHaveValue(graves);
        await page.evaluate(() => window.Strom.UI.closeExportDialog());
        // The list is gone: the whole tree.
        await page.evaluate((id) => window.Strom.DataManager.deletePersonList(id), graves);
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await expect(m.locator('.export-scope .segment-btn[data-scope="tree"]')).toHaveAttribute('aria-checked', 'true');
        await expect(m.locator('#export-list-pick')).toBeHidden();
        await expect(m.locator('.menu-option', { hasText: 'Poster' })).toBeEnabled();
    });

    test('the Table\'s export in a work list\'s scope writes # and Done first', async ({ page }) => {
        await family(page);
        const graves = await listId(page, 'Graves to visit');
        await page.evaluate((id) => window.Strom.UI.openTableInScope(id, {}), graves);
        await expect(page.locator('#table-container .tv-status-count')).toHaveText('3 of 3 people');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.evaluate(() => window.Strom.UI.downloadTableExport('csv', false)),
        ]);
        const lines = await csvOf(download);
        expect(lines[0].slice(0, 3)).toEqual(['#', 'Done', 'Full name']);
        expect(lines.slice(1).map(l => l.slice(0, 3).join('|'))).toEqual(['1||Corvin Varnholm', '2|✓|Quillon Varnholm', '3|✓|Yselda Fennick']);
    });
});

test.describe('Export of a list: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('⋯ of a list › Export is a page of the sheet; the dialog Export with the list fits the phone', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = lists(page);
        await d.locator('.pl-row', { hasText: 'Letters to write' }).tap();
        await d.locator('.pl-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await page.locator('#pl-sheet-export').tap();
        await expect(sheet.locator('.bottom-sheet-subpage .bottom-sheet-item')).toHaveText(['GEDCOM…', 'CSV (list order)']);
        await page.locator('#pl-sheet-export-ged').tap();
        const m = exportModal(page);
        await expect(m).toBeVisible();
        await expect(m.locator('#export-scope-list')).toHaveAttribute('aria-checked', 'true');
        await expect(m.locator('#export-list-select option:checked')).toHaveText('Letters to write · 3 people');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        for (const el of await m.locator('.export-scope .segment-btn:visible, #export-list-select').all()) {
            const b = (await el.boundingBox())!;
            expect(b.height).toBeGreaterThanOrEqual(44);
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.x + b.width).toBeLessThanOrEqual(390);
        }
        // The segment's three choices stay on one row.
        const tops = await m.locator('.export-scope .segment-btn:visible').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);
    });
});
