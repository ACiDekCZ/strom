import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The Table view's filter, search and sort (spec 073 §8, §13c/§13d): quick
 * chips with "N of M", a column's filter from the head menu, the search with
 * its highlight, sorting by two columns (click, Shift + click), nothing
 * passing with "Clear filters"; on a phone the Filters sheet.
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
const head = (page: Page, col: string) => page.locator(`#table-container .tv-headrow [data-col="${col}"]`);

async function openTable(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Oskvelt', 'c');
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-grid')).toBeVisible();
    await expect(status(page)).toHaveText('7 of 7 people');
}

/** The persons' rows, top to bottom. */
async function keys(page: Page): Promise<string[]> {
    return page.locator('#table-container .tv-body .tv-row').evaluateAll(els =>
        els.map(el => (el as HTMLElement).dataset.key ?? '').filter(k => k.startsWith('p:') && !k.includes('#')));
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a quick chip filters to "N of M"; Clear filters shows everyone again', async ({ page }) => {
        await openTable(page);
        const chips = page.locator('#table-container .tv-chips');
        await expect(chips).toBeVisible();
        await expect(chip(page, 'deceased')).toHaveAttribute('aria-pressed', 'false');
        await chip(page, 'deceased').click();
        await expect(status(page)).toHaveText('5 of 7 people');
        await expect(chip(page, 'deceased')).toHaveAttribute('aria-pressed', 'true');
        await expect(chip(page, 'deceased')).toHaveText('✓ Deceased');
        // Living and deceased exclude each other.
        await chip(page, 'living').click();
        await expect(status(page)).toHaveText('2 of 7 people');
        await expect(chip(page, 'deceased')).toHaveAttribute('aria-pressed', 'false');
        await page.locator('#table-container .tv-chips-clear').click();
        await expect(status(page)).toHaveText('7 of 7 people');
        await expect(page.locator('#table-container .tv-chips-clear')).toHaveCount(0);
    });

    test('a column filter from the head menu: years from–to, the head mark and its chip with ×', async ({ page }) => {
        await openTable(page);
        await head(page, 'bDate').click({ button: 'right' });
        await page.locator('.tv-menu .tv-menu-item[data-id="filter"]').click();
        const panel = page.locator('.tv-fpanel');
        await expect(panel).toBeVisible();
        await panel.locator('.tv-ff-from').fill('1880');
        await panel.locator('.tv-ff-to').fill('1920');
        await panel.locator('.tv-ff-to').press('Enter');
        await expect(panel).toHaveCount(0);
        await expect(status(page)).toHaveText('3 of 7 people');
        expect((await keys(page)).sort()).toEqual(['p:c', 'p:d', 'p:e']);
        await expect(head(page, 'bDate').locator('.tv-filter-mark')).toHaveText('filter');
        const colChip = page.locator('#table-container .tv-chip--col');
        await expect(colChip).toHaveText(/Birth date 1880–1920/);
        await colChip.locator('.tv-chip-x').click();
        await expect(status(page)).toHaveText('7 of 7 people');
        await expect(head(page, 'bDate').locator('.tv-filter-mark')).toHaveCount(0);
    });

    test('the search ignores diacritics and marks the match', async ({ page }) => {
        await openTable(page);
        const search = page.locator('#table-container .tv-search-q');
        // Her own row and her husband's Partner cell.
        await search.fill('storba');
        await expect(status(page)).toHaveText('2 of 7 people');
        await expect(page.locator('#table-container .tv-matches')).toHaveText('2 matches');
        expect(await keys(page)).toEqual(['p:c', 'p:d']);
        await expect(page.locator('#table-container .tv-body mark.tv-hit').first()).toHaveText('Šťorba');
        // Escape empties the field.
        await search.press('Escape');
        await expect(search).toHaveValue('');
        await expect(status(page)).toHaveText('7 of 7 people');
    });

    test('a click on a head sorts by that column; Shift + click adds a second key', async ({ page }) => {
        await openTable(page);
        await head(page, 'dDate').locator('.tv-cell-text').click();
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Death date ↑');
        await expect(head(page, 'dDate')).toHaveAttribute('aria-sort', 'ascending');
        // No death date: last, in the model's order among themselves.
        await head(page, 'bDate').locator('.tv-cell-text').click({ modifiers: ['Shift'] });
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Death date ↑, Birth date ↑');
        await expect(head(page, 'dDate').locator('.tv-sort-mark')).toHaveText('↑1');
        await expect(head(page, 'bDate').locator('.tv-sort-mark')).toHaveText('↑2');
        expect(await keys(page)).toEqual(['p:a', 'p:b', 'p:c', 'p:d', 'p:e', 'p:f', 'p:g']);
        await head(page, 'bDate').locator('.tv-cell-text').click({ modifiers: ['Shift'] });
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Death date ↑, Birth date ↓');
        expect(await keys(page)).toEqual(['p:a', 'p:b', 'p:c', 'p:d', 'p:e', 'p:g', 'p:f']);
        // A plain click: that column alone, descending after ascending.
        await head(page, 'dDate').locator('.tv-cell-text').click();
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Death date ↑');
        await head(page, 'dDate').locator('.tv-cell-text').click();
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Death date ↓');
        expect((await keys(page)).slice(0, 2)).toEqual(['p:e', 'p:d']);
    });

    test('nothing passes: the message under the head and Clear filters', async ({ page }) => {
        await openTable(page);
        await chip(page, 'living').click();
        await page.locator('#table-container .tv-search-q').fill('Oskvelt');
        await expect(status(page)).toHaveText('1 of 7 people');
        await page.locator('#table-container .tv-search-q').fill('Haskendal');
        const none = page.locator('#table-container .tv-nomatch');
        await expect(none).toBeVisible();
        await expect(status(page)).toHaveText('0 of 7 people');
        await expect(none.locator('.tv-nomatch-title')).toHaveText('Nothing matches the filter');
        await expect(none.locator('.tv-nomatch-text')).toHaveText('Applies: Living · “Haskendal”');
        // The head stays.
        await expect(head(page, 'name')).toBeVisible();
        await none.locator('.tv-nomatch-clear').click();
        await expect(none).toBeHidden();
        await expect(status(page)).toHaveText('7 of 7 people');
        await expect(page.locator('#table-container .tv-search-q')).toHaveValue('');
        await expect(chip(page, 'living')).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the Filters button opens the sheet; a chip there applies at once', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
        await openApp(page);
        await seedTree(page, FAMILY, 'Oskvelt', 'c');
        await page.locator('#bb-view-table').tap();
        await expect(status(page)).toHaveText('7 of 7 people');
        // No chips' row on a phone: the Filters button beside the search.
        await expect(page.locator('#table-container .tv-chips')).toBeHidden();
        const btn = page.locator('#table-container .tv-filters-btn');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveText('Filters');
        await expect(page.locator('#table-container .tv-search-q')).toBeVisible();
        await btn.tap();
        const sheet = page.locator('.tv-fsheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tv-cp-title')).toHaveText('Filters');
        const rowH = await sheet.locator('label.tv-fs-row').first().evaluate(el => el.getBoundingClientRect().height);
        expect(rowH).toBeGreaterThanOrEqual(48);
        await sheet.locator('input[data-chip="deceased"]').check();
        await expect(status(page)).toHaveText('5 of 7 people');
        await expect(sheet.locator('.tv-fs-show')).toHaveText('Show 5 people');
        // More (n) shows the rest.
        await sheet.locator('.tv-fs-more').tap();
        await expect(sheet.locator('input[data-chip="noSource"]')).toBeVisible();
        await sheet.locator('.tv-fs-show').tap();
        await expect(sheet).toHaveCount(0);
        await expect(btn).toHaveText('Filters (1)');
        await expect(btn).toHaveClass(/is-active/);
        // No row overflows the phone's width.
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over).toBeLessThanOrEqual(0);
    });
});
