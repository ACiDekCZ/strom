import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, seedTree, type SeedPerson } from './helpers.js';
import { readXlsx } from '../src/__tests__/helpers/xlsx-read.js';

/**
 * The Table view's XLSX export (spec 073 §11.3, §14.4): the format choice in
 * the Export panel (click and arrows; the choice kept), the file name and
 * the button follow it, the download is an .xlsx (a zip: "PK") whose sheet
 * has the head, a continuation row as an outline and a finding's fill and
 * comment; on a phone the same in the sheet from ⋯.
 */

const FAMILY: Record<string, SeedPerson> = {
    a: { firstName: 'Velimor', lastName: 'Trasknar', birthDate: '1850-03-01', deathDate: '1910-05-02', partners: ['b', 'c'] },
    b: { firstName: 'Orsina', lastName: 'Pelgarth', gender: 'female', birthDate: '1855-07-12', deathDate: '1880-01-09', partners: ['a'] },
    c: { firstName: 'Damira', lastName: 'Kostelfeld', gender: 'female', birthDate: '1860-09-20', deathDate: '1930-11-11', partners: ['a'] },
    // Died before the birth: an error on the dates.
    d: { firstName: 'Bertlav', lastName: 'Trasknar', birthDate: '1900-04-02', deathDate: '1890-06-30', parents: ['a', 'c'] },
};

const status = (page: Page) => page.locator('#table-container .tv-status-count');

async function openTable(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Trasknar', 'a');
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('XLSX chosen in the Export panel: name, button, download, and the choice kept', async ({ page }) => {
        await openTable(page);
        await page.locator('#view-mode-table').click();
        await expect(status(page)).toHaveText('4 of 4 people');
        // The findings are on the cells before the export reads them.
        await expect(page.locator('#table-container .tv-cell.has-issue').first()).toBeVisible();

        await page.locator('#table-container .tv-export-btn').click();
        const panel = page.locator('.tv-fpanel.tv-xpanel');
        await expect(panel).toBeVisible();
        const picks = panel.locator('.tv-xopt-pick');
        await expect(picks).toHaveText(['●CSV · for Excel and Google Sheets', '○XLSX · groups, frozen panes, check colours']);
        await expect(picks.nth(0)).toHaveAttribute('aria-checked', 'true');
        // Arrows move the choice like a radio group.
        await picks.nth(0).focus();
        await page.keyboard.press('ArrowDown');
        await expect(picks.nth(1)).toHaveAttribute('aria-checked', 'true');
        await expect(picks.nth(1)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(picks.nth(0)).toHaveAttribute('aria-checked', 'true');
        await picks.nth(1).click();
        await expect(picks.nth(1)).toHaveText('●XLSX · groups, frozen panes, check colours');
        await expect(panel.locator('.tv-xfile')).toHaveText('File: Trasknar_Overview_2026-06-15.xlsx');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            panel.locator('.tv-fpanel-apply', { hasText: 'Download XLSX' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('Trasknar_Overview_2026-06-15.xlsx');
        const bytes = readFileSync(await download.path());
        expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
        const read = readXlsx(new Uint8Array(bytes));
        expect(read.cell('A2')?.text).toBe('Name');
        expect(read.cell('A3')?.text).toBe('filled');
        // Every part parses in the browser's own XML parser: one broken attribute in
        // styles.xml was enough for Numbers to refuse the whole file.
        const broken = await page.evaluate(parts => parts
            .filter(([, text]) => new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('parsererror').length > 0)
            .map(([path]) => path), [...read.files]);
        expect(read.files.size).toBeGreaterThan(6);
        expect(broken).toEqual([]);
        // The coverage row's shares are numbers shown as a percentage, the names texts, and
        // Excel's "number stored as text" warning is off for the sheet.
        const coverage = [...read.rows[2].cells.values()].filter(c => c.ref !== 'A3');
        expect(coverage.length).toBeGreaterThan(0);
        expect(coverage.every(c => c.type === '' || c.text === '–')).toBe(true);
        expect(read.rows.slice(3).map(r => r.cells.get(`A${r.r}`)).filter(c => c?.text).every(c => c!.type === 's')).toBe(true);
        expect(read.sheet).toMatch(/<ignoredErrors><ignoredError sqref="A1:[A-Z]+\d+" numberStoredAsText="1"\/><\/ignoredErrors>/);
        expect(read.sheet).toContain('state="frozen"');
        // Velimor's second union: a continuation row one outline level down.
        expect(read.rows.filter(r => r.outline === 1)).toHaveLength(1);
        // Bertlav: a filled cell with the finding as its comment.
        expect([...read.comments.values()].some(c => c.startsWith('Error: '))).toBe(true);
        await expect(page.locator('.toast').last()).toContainText('Downloaded: Trasknar_Overview_2026-06-15.xlsx · 4 people, 5 rows,');

        // The choice is kept for the next export.
        await page.locator('#table-container .tv-export-btn').click();
        await expect(page.locator('.tv-fpanel.tv-xpanel .tv-xopt-pick').nth(1)).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('.tv-fpanel.tv-xpanel .tv-fpanel-apply')).toHaveText('Download XLSX');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('XLSX from ⋯ → Export in the sheet', async ({ page }) => {
        await openTable(page);
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
        await expect(status(page)).toHaveText('4 of 4 people');
        await page.locator('#table-container .tv-more-menu-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Export' }).tap();
        const xs = page.locator('.tv-fsheet.tv-xpanel');
        await expect(xs).toBeVisible();
        const pick = xs.locator('.tv-xopt-pick').nth(1);
        expect(Math.round((await pick.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        await pick.tap();
        await expect(xs.locator('.tv-xfile')).toHaveText('File: Trasknar_Overview_2026-06-15.xlsx');
        const box = (await xs.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            xs.locator('.tv-fs-apply', { hasText: 'Download XLSX' }).tap(),
        ]);
        expect(download.suggestedFilename()).toBe('Trasknar_Overview_2026-06-15.xlsx');
        const bytes = readFileSync(await download.path());
        expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
        expect(readXlsx(new Uint8Array(bytes)).cell('A2')?.text).toBe('Name');
    });
});
