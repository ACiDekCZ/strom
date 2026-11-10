import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, card, type SeedPerson } from './helpers.js';

/**
 * The Table view (spec 073): the whole tree as rows of people or unions. A
 * tab in the desktop toolbar, a tile in the More sheet below it; the row type
 * switches between People and Unions; only the rows in view are drawn.
 */

const GIVEN = ['Orvin', 'Tamsa', 'Belko', 'Ivrena', 'Darut', 'Selvie', 'Kostan', 'Imbra'];
const FAMILY = ['Kvelden', 'Morastin', 'Pelvarek', 'Udrasko'];

/** A long tree: `n` people in couples (the first one named apart, the focus). */
function longTree(n: number): Record<string, SeedPerson> {
    const people: Record<string, SeedPerson> = {};
    for (let i = 0; i < n; i++) {
        const id = `p${i}`;
        const female = i % 2 === 1;
        people[id] = {
            firstName: i === 0 ? 'Aldemar' : GIVEN[i % GIVEN.length], lastName: FAMILY[Math.floor(i / 8) % FAMILY.length],
            gender: female ? 'female' : 'male', birthDate: String(1800 + (i % 150)),
            partners: female ? [`p${i - 1}`] : (i + 1 < n ? [`p${i + 1}`] : []),
        };
    }
    return people;
}

async function openTable(page: Page): Promise<void> {
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container')).toBeVisible();
    await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Table tab lists every person, switches to unions and draws only the rows in view', { tag: '@smoke' }, async ({ page }) => {
        await openApp(page);
        const people = longTree(160);
        await seedTree(page, people, 'Kvelden', 'p0');

        const tab = page.locator('#view-mode-table');
        await expect(tab).toBeVisible();
        await expect(tab).toHaveText('Table');
        await openTable(page);
        await expect(tab).toHaveClass(/active/);
        await expect(page.locator('#tree-canvas')).toBeHidden();

        const status = page.locator('#table-container .tv-status-count');
        await expect(status).toHaveText('160 of 160 people');
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Birth date ↑');
        await expect(page.locator('#table-container .tv-headrow [data-col="name"]')).toHaveText('Name');

        // Only a window of the 160 rows is in the DOM; scrolled to the end, the last row is drawn and the first is not.
        const rows = page.locator('#table-container .tv-body .tv-row');
        const drawn = await rows.count();
        expect(drawn).toBeGreaterThan(5);
        expect(drawn).toBeLessThan(80);
        await page.locator('#table-container .tv-grid').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(page.locator('#table-container .tv-body .tv-row[data-index="159"]')).toHaveCount(1);
        await expect(page.locator('#table-container .tv-body .tv-row[data-index="0"]')).toHaveCount(0);

        // Unions: one row per union, its own count; People keeps its scroll.
        const unions = page.getByRole('radio', { name: /^Unions, / });
        await unions.click();
        await expect(unions).toHaveAttribute('aria-checked', 'true');
        await expect(status).toHaveText('80 of 80 unions');
        await expect(page.locator('#table-container .tv-headrow [data-col="p1"]')).toHaveText('Partner 1');
        await page.getByRole('radio', { name: /^People, / }).click();
        await expect(status).toHaveText('160 of 160 people');
        await expect(page.locator('#table-container .tv-body .tv-row[data-index="159"]')).toHaveCount(1);

        // Back to the family view: the cards return, the table is hidden.
        await page.locator('#view-mode-family').click();
        await expect(page.locator('#table-container')).toBeHidden();
        await expect(card(page, 'Aldemar')).toBeVisible();
    });

    test('the table follows a change of the data and is remembered for the tree', async ({ page }) => {
        await openApp(page);
        await seedTree(page, {
            a: { firstName: 'Orvin', lastName: 'Kvelden', birthDate: '1901', partners: ['b'] },
            b: { firstName: 'Tamsa', lastName: 'Morastin', gender: 'female', partners: ['a'] },
            c: { firstName: 'Belko', lastName: 'Kvelden', parents: ['a', 'b'], birthDate: '1930' },
        }, 'Kvelden', 'a');
        await openTable(page);
        const status = page.locator('#table-container .tv-status-count');
        await expect(status).toHaveText('3 of 3 people');
        // The undated person sorts last under "Birth date ↑".
        await expect(page.locator('#table-container .tv-body .tv-row[data-index="2"] .tv-name')).toHaveText(/Tamsa/);
        await page.evaluate(() => {
            const DM = window.Strom.DataManager;
            DM.createPerson({ firstName: 'Ivrena', lastName: 'Kvelden', gender: 'female' } as never);
            window.Strom.TreeRenderer.render();
        });
        await expect(status).toHaveText('4 of 4 people');
        await page.reload();
        await expect(page.locator('#table-container')).toBeVisible();
        await expect(status).toHaveText('4 of 4 people');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the Table tile in the More sheet opens the table; the row type is a button with a sheet', async ({ page }) => {
        await openApp(page);
        await seedTree(page, {
            a: { firstName: 'Orvin', lastName: 'Kvelden', partners: ['b'] },
            b: { firstName: 'Tamsa', lastName: 'Morastin', gender: 'female', partners: ['a'] },
            c: { firstName: 'Belko', lastName: 'Kvelden', parents: ['a', 'b'] },
        }, 'Kvelden', 'a');
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
        await expect(page.locator('#table-container')).toBeVisible();
        await expect(page.locator('#bb-view-more')).toHaveClass(/active/);
        await expect(page.locator('#table-container .tv-status-count')).toHaveText('3 of 3 people');

        const typeBtn = page.locator('#table-container .tv-rowtype-btn');
        await expect(typeBtn).toBeVisible();
        await expect(typeBtn).toHaveText('People · 3 ▾');
        await expect(page.locator('#table-container .tv-rowtype')).toBeHidden();
        // The pinned name column at its phone width.
        expect(await page.locator('#table-container .tv-headrow [data-col="name"]').evaluate(el => el.getBoundingClientRect().width)).toBe(156);

        await typeBtn.tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toContainText('Each row type keeps its own columns, filter and sort.');
        await sheet.locator('.bottom-sheet-item', { hasText: 'Unions' }).tap();
        await expect(page.locator('#table-container .tv-status-count')).toHaveText('1 of 1 union');
        await expect(typeBtn).toHaveText('Unions · 1 ▾');
        // Nothing runs over the window's width.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
