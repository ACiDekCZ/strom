import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, seedTree, type SeedPerson } from './helpers.js';
import { readXlsx } from '../src/__tests__/helpers/xlsx-read.js';

/**
 * The Table view's Export with a filter or a search (1110): the panel says
 * how many rows are shown and which filter applies, and offers all rows
 * without the filter; the rows shown stay the default. A choice of all rows
 * writes every row of the type (CSV and XLSX), in the sort shown. Without a
 * filter the panel is as before. The choice is a radio group (click, arrows;
 * 44 px rows by touch); on a phone the same in the sheet from ⋯.
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
const chip = (page: Page, id: string) => page.locator(`#table-container .tv-chips .tv-chip[data-chip="${id}"]`);

async function openTable(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Oskvelt', 'c');
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-grid')).toBeVisible();
    await expect(status(page)).toHaveText('7 of 7 people');
}

/** The data lines of a downloaded CSV (the head left out). */
function csvRows(path: string): string[][] {
    const text = readFileSync(path, 'utf-8');
    return text.slice(1).split('\r\n').filter(Boolean).slice(1).map(l => l.split(';'));
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('without a filter the rows are one fixed line as before', async ({ page }) => {
        await openTable(page);
        await page.locator('#table-container .tv-export-btn').click();
        const panel = page.locator('.tv-fpanel.tv-xpanel');
        await expect(panel.locator('.tv-xrows .tv-xopt')).toHaveText(['●Everything shown · 7 people']);
        await expect(panel.locator('.tv-xrows .tv-xopt-pick')).toHaveCount(0);
    });

    test('a filter: the rows shown by default with the count and the filter, or all without it (CSV and XLSX)', async ({ page }) => {
        await openTable(page);
        await chip(page, 'deceased').click();
        await expect(status(page)).toHaveText('5 of 7 people');
        await page.locator('#table-container .tv-export-btn').click();
        const panel = page.locator('.tv-fpanel.tv-xpanel');
        const rows = panel.locator('.tv-xrows .tv-xopt-pick');
        await expect(panel.locator('.tv-xrows')).toHaveAttribute('role', 'radiogroup');
        await expect(rows).toHaveText(['●Shown · 5 of 7 people (filter: Deceased)', '○All people without the filter · 7']);
        await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
        await expect(panel.locator('.tv-xwhat')).toContainText('filter and sort as now');

        // The rows shown are the default: 5 lines.
        const [shown] = await Promise.all([
            page.waitForEvent('download'),
            panel.locator('.tv-fpanel-apply', { hasText: 'Download CSV' }).click(),
        ]);
        expect(csvRows(await shown.path())).toHaveLength(5);

        // Arrows move the choice; all rows: 7 lines, the sentence says so.
        await page.locator('#table-container .tv-export-btn').click();
        await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
        await rows.nth(0).focus();
        await page.keyboard.press('ArrowDown');
        await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
        await expect(rows.nth(1)).toBeFocused();
        await expect(rows.nth(1).locator('.tv-xopt-dot')).toHaveText('●');
        await expect(panel.locator('.tv-xwhat')).toContainText('sort as now, without the filter');
        const [all] = await Promise.all([
            page.waitForEvent('download'),
            panel.locator('.tv-fpanel-apply', { hasText: 'Download CSV' }).click(),
        ]);
        const lines = csvRows(await all.path());
        expect(lines).toHaveLength(7);
        expect(lines.map(l => l[0])).toContain('Hedda Prellwin');
        await expect(page.locator('.toast').last()).toContainText('7 people, 7 rows');
        // The table itself keeps its filter.
        await expect(status(page)).toHaveText('5 of 7 people');

        // XLSX takes the same choice; the panel opens again with the rows shown.
        await page.locator('#table-container .tv-export-btn').click();
        await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
        await panel.locator('.tv-xformats .tv-xopt-pick').nth(1).click();
        await rows.nth(1).click();
        const [x] = await Promise.all([
            page.waitForEvent('download'),
            panel.locator('.tv-fpanel-apply', { hasText: 'Download XLSX' }).click(),
        ]);
        const read = readXlsx(new Uint8Array(readFileSync(await x.path())));
        // A row of groups, the head, the coverage row, then the people.
        expect(read.rows.filter(r => r.r > 3)).toHaveLength(7);
    });

    test('a search alone offers the choice too', async ({ page }) => {
        await openTable(page);
        await page.locator('#table-container .tv-search-q').fill('Prellwin');
        await expect(status(page)).toHaveText('1 of 7 people');
        await page.locator('#table-container .tv-export-btn').click();
        await expect(page.locator('.tv-fpanel.tv-xpanel .tv-xrows .tv-xopt-pick'))
            .toHaveText(['●Shown · 1 of 7 people (filter: “Prellwin”)', '○All people without the filter · 7']);
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the sheet from ⋯: the choice by touch, 44 px rows, nothing past the width', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
        await openApp(page);
        await seedTree(page, FAMILY, 'Oskvelt', 'c');
        await page.locator('#bb-view-table').tap();
        await expect(status(page)).toHaveText('7 of 7 people');
        await page.locator('#table-container .tv-search-q').fill('Prellwin');
        await expect(status(page)).toHaveText('1 of 7 people');

        await page.locator('#table-container .tv-more-menu-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Export' }).tap();
        const xs = page.locator('.tv-fsheet.tv-xpanel');
        await expect(xs).toBeVisible();
        const rows = xs.locator('.tv-xrows .tv-xopt-pick');
        await expect(rows).toHaveText(['●Shown · 1 of 7 people (filter: “Prellwin”)', '○All people without the filter · 7']);
        for (const box of [await rows.nth(0).boundingBox(), await rows.nth(1).boundingBox()]) {
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        }
        expect(await xs.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await rows.nth(1).tap();
        await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            xs.locator('.tv-fs-apply', { hasText: 'Download CSV' }).tap(),
        ]);
        expect(csvRows(await download.path())).toHaveLength(7);
    });
});
