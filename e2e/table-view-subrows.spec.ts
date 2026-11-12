import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The Table view's union sub-rows and coverage row (spec 073 §3, §6.1): a
 * person with two or more unions has a row of their own and one sub-row per
 * union, collapsed by ▸, the head's button, → / ← or `*`; the coverage row
 * gives each column's filled share, bold under half.
 */

const FAMILY: Record<string, SeedPerson> = {
    h: { firstName: 'Halvor', lastName: 'Quillmaren', birthDate: '1862-04-10', deathDate: '1934-02-01', partners: ['w1', 'w2'] },
    w1: { firstName: 'Ysolde', lastName: 'Arkenvale', gender: 'female', birthDate: '1865', partners: ['h'] },
    w2: { firstName: 'Brenna', lastName: 'Thistlecombe', gender: 'female', birthDate: '1878-06-01', partners: ['h'] },
    c: { firstName: 'Corvin', lastName: 'Quillmaren', birthDate: '1891-03-02', deathDate: '1950-07-08', parents: ['h', 'w1'] },
    s: { firstName: 'Tobin', lastName: 'Pellwright', birthDate: '1990' },
};

const grid = (page: Page) => page.locator('#table-container .tv-grid');
const bodyRows = (page: Page) => page.locator('#table-container .tv-body .tv-row');
const row = (page: Page, key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);

async function openTable(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, FAMILY, 'Quillmaren', 'h');
    await page.locator('#view-mode-table').click();
    await expect(grid(page)).toBeVisible();
}

/** The drawn rows' keys, top to bottom. */
async function keys(page: Page): Promise<string[]> {
    return bodyRows(page).evaluateAll(els => els.map(el => (el as HTMLElement).dataset.key ?? ''));
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a person with two unions: sub-rows, collapsed by ▸, the head button and the keys', async ({ page }) => {
        await openTable(page);
        const main = row(page, 'p:h');
        const subs = page.locator('#table-container .tv-body .tv-row--sub');

        // Expanded by default: the person's row, then Union 1 of 2 and 2 of 2.
        await expect(subs).toHaveCount(2);
        expect((await keys(page)).slice(0, 3)).toEqual(['p:h', 'p:h#u1', 'p:h#u2']);
        await expect(main).toHaveAttribute('aria-expanded', 'true');
        await expect(row(page, 'p:h#u1')).toHaveAttribute('aria-level', '2');
        await expect(row(page, 'p:h#u1')).toHaveAttribute('aria-label', 'Union 1 of 2 of Halvor Quillmaren');
        await expect(row(page, 'p:h#u1').locator('.tv-sub-label')).toHaveText('Union 1 of 2');
        await expect(main).toContainText('2 unions');
        await expect(row(page, 'p:h#u1')).toContainText('Ysolde');
        await expect(row(page, 'p:h#u2')).toContainText('Brenna');
        // One union: in the person's own row, no toggle.
        await expect(row(page, 'p:w1')).not.toHaveAttribute('aria-expanded', /.*/);
        await expect(row(page, 'p:w1')).toContainText('Halvor');

        // ▾ collapses: one row with the first union and the count pill.
        await main.locator('.tv-toggle').click();
        await expect(subs).toHaveCount(0);
        await expect(main).toHaveAttribute('aria-expanded', 'false');
        await expect(main).toHaveAttribute('aria-label', 'Halvor Quillmaren, 2 unions, collapsed');
        await expect(main.locator('.tv-unions-pill')).toHaveText('2 unions');
        await expect(main).toContainText('Ysolde');
        // Nothing expanded: the head's button offers to expand.
        const headAll = page.locator('#table-container .tv-headrow [data-col="name"] .tv-head-all');
        await expect(headAll).toHaveText('Expand unions');
        await headAll.click();
        await expect(subs).toHaveCount(2);
        await expect(headAll).toHaveText('Collapse unions');
        await headAll.click();
        await expect(subs).toHaveCount(0);

        // Keys on the name cell: → expands, ← collapses, ← on a sub-row goes to the person's row.
        // The row is the active one (the person in focus, U9): its icons beside the name, the pill in the cell's middle.
        await main.locator('.tv-name').focus();
        await page.keyboard.press('ArrowRight');
        await expect(subs).toHaveCount(2);
        await page.keyboard.press('ArrowDown');
        await expect(row(page, 'p:h#u1').locator('.tv-name')).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(main.locator('.tv-name')).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(subs).toHaveCount(0);
        await expect(main.locator('.tv-name')).toBeFocused();
        // `*` does what the head's button says (here: expand everyone).
        await page.keyboard.press('*');
        await expect(subs).toHaveCount(2);
        // The status line still counts people, not lines.
        await expect(page.locator('#table-container .tv-status-count')).toHaveText('5 of 5 people');
    });

    test('the coverage row: the filled share of each column over the rows it applies to', async ({ page }) => {
        await openTable(page);
        const cov = (col: string) => page.locator(`#table-container .tv-covrow [data-col="${col}"]`);
        await expect(page.locator('#table-container .tv-covrow')).toBeVisible();
        await expect(cov('name')).toHaveText('filled');
        await expect(cov('bDate')).toHaveText('100 %');
        await expect(cov('bDate')).not.toHaveClass(/tv-cov-low/);
        await expect(cov('bDate')).toHaveAttribute('title', '5 of 5');
        // Death date: Tobin is living and left out; 2 of the other 4.
        await expect(cov('dDate')).toHaveText('50 %');
        await expect(cov('dDate')).toHaveAttribute('title', '2 of 4');
        // Birth place: nobody has one; bold under half.
        await expect(cov('bPlace')).toHaveText('0 %');
        await expect(cov('bPlace')).toHaveClass(/tv-cov-low/);
        expect(Number(await cov('bPlace').evaluate(el => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
        // Wedding date: the unit is the union (Halvor's 2, one each for Ysolde and Brenna).
        await expect(cov('wDate')).toHaveAttribute('title', '0 of 4');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('sub-rows on a phone: tapping the toggle collapses and expands, nothing runs over the width', async ({ page }) => {
        await openApp(page);
        await seedTree(page, FAMILY, 'Quillmaren', 'h');
        await page.locator('#bb-view-table').tap();
        await expect(grid(page)).toBeVisible();

        const main = row(page, 'p:h');
        const subs = page.locator('#table-container .tv-body .tv-row--sub');
        await expect(subs).toHaveCount(2);
        await expect(row(page, 'p:h#u2').locator('.tv-sub-label')).toHaveText('Union 2 of 2');
        // The toggle is a 44 px target on touch.
        const box = await main.locator('.tv-toggle').boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        await main.locator('.tv-toggle').tap();
        await expect(subs).toHaveCount(0);
        await expect(main.locator('.tv-unions-pill')).toHaveText('2 unions');
        await main.locator('.tv-toggle').tap();
        await expect(subs).toHaveCount(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
