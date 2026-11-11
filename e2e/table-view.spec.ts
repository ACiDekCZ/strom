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

/** Names with carons over capitals and letters below the line, one of them married twice (sub-rows). */
const INKY: Record<string, SeedPerson> = {
    a: { firstName: 'Ťygvald', lastName: 'Pýchrož', birthDate: '1891-07-14', partners: ['b', 'c'] },
    b: { firstName: 'Jagyp', lastName: 'Šypfeld', gender: 'female', birthDate: '1893-05-02', partners: ['a'] },
    c: { firstName: 'Žopygra', lastName: 'Ďopylová', gender: 'female', birthDate: '1898-11-30', partners: ['a'] },
    d: { firstName: 'Quijany', lastName: 'Pýchrož', gender: 'female', parents: ['a', 'b'], birthDate: '1919-08-21' },
};

/**
 * The texts of the table's body cut at the edge of the box that clips them
 * (T54): each text's line box must lie inside its nearest clipping box within
 * its cell with at least 1 px above and below (the ink of carons and of
 * g, j, p, y reaches the line box's edge), and no such box may scroll.
 */
async function clippedTexts(page: Page): Promise<string[]> {
    return page.locator('#table-container .tv-body').evaluate((body) => {
        const bad: string[] = [];
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent?.trim()) continue;
            const cell = n.parentElement?.closest('.tv-cell');
            if (!cell) continue;
            let clip: HTMLElement | null = null;
            for (let el = n.parentElement; el && cell.contains(el); el = el.parentElement) {
                const o = getComputedStyle(el);
                if (o.overflowY !== 'visible' || o.overflowX !== 'visible') { clip = el; break; }
            }
            if (!clip) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            const t = range.getBoundingClientRect();
            if (!t.width) continue;
            const c = clip.getBoundingClientRect();
            const top = t.top - c.top, bottom = c.bottom - t.bottom;
            if (top < 1 || bottom < 1 || clip.scrollHeight > clip.clientHeight) {
                bad.push(`${n.textContent.trim()} in .${clip.className.split(' ')[0]}: ${top.toFixed(2)} above, ${bottom.toFixed(2)} below, ${clip.scrollHeight}/${clip.clientHeight}`);
            }
        }
        return bad;
    });
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
        await expect(page.locator('#table-container .tv-headrow [data-col="name"]')).toHaveText('Full name');

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
    test('no text of a cell is cut at its top or bottom (T54)', async ({ page }) => {
        await openApp(page);
        await seedTree(page, INKY, 'Pýchrož', 'a');
        await openTable(page);
        await expect(page.locator('#table-container .tv-body .tv-row[data-key="p:a#u2"]')).toBeVisible();
        expect(await clippedTexts(page)).toEqual([]);
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await expect(page.locator('#table-container .tv-headrow')).toContainText('Geburt');
        await expect(page.locator('#table-container .tv-body .tv-row[data-key="p:a#u2"]')).toBeVisible();
        expect(await clippedTexts(page)).toEqual([]);
    });

    test('the person in focus goes along between the table and the other views (U9)', async ({ page }) => {
        await openApp(page);
        await seedTree(page, longTree(120), 'Kvelden', 'p0');
        const focusId = () => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId());
        const grid = page.locator('#table-container .tv-grid');
        const row = (key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);
        const selected = page.locator('#table-container .tv-body .tv-row[aria-selected="true"]');

        // Focus far down the table's order (by birth): entered, the table opens at that row.
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('p90' as never));
        await openTable(page);
        await expect(row('p:p90')).toHaveAttribute('aria-selected', 'true');
        await expect(selected).toHaveCount(1);
        const g = (await grid.boundingBox())!;
        const r = (await row('p:p90').boundingBox())!;
        expect(r.y).toBeGreaterThanOrEqual(g.y);
        expect(r.y + r.height).toBeLessThanOrEqual(g.y + g.height);

        // Another row chosen in the table: the family view opens on that person.
        await row('p:p92').locator('.tv-name').click();
        await expect(row('p:p92')).toHaveAttribute('aria-selected', 'true');
        await page.locator('#view-mode-family').click();
        await expect.poll(focusId).toBe('p92');
        await expect(page.locator('#tree-canvas .person-card.focused')).toContainText('Darut Udrasko');

        // Unions: the union of the person in focus is the active row; another one chosen hands over its first partner.
        await openTable(page);
        await expect(row('p:p92')).toHaveAttribute('aria-selected', 'true');
        await page.getByRole('radio', { name: /^Unions, / }).click();
        await page.locator('#view-mode-family').click();
        await expect.poll(focusId).toBe('p92');
        await openTable(page);
        await expect(row('u:u_p92_p93')).toHaveAttribute('aria-selected', 'true');
        const other = row('u:u_p94_p95');
        await other.getByText('Married').click();
        await expect(other).toHaveAttribute('aria-selected', 'true');
        await page.locator('#view-mode-family').click();
        await expect.poll(focusId).toBe('p94');
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('p92' as never));
        await openTable(page);
        await page.getByRole('radio', { name: /^People, / }).click();

        // A person the search leaves out: no row is active, the focus stays.
        await expect(row('p:p92')).toHaveAttribute('aria-selected', 'true');
        await page.locator('#table-container .tv-search-q').fill('Aldemar');
        await expect(page.locator('#table-container .tv-status-count')).toHaveText('2 of 120 people');
        await page.locator('#view-mode-family').click();
        await expect.poll(focusId).toBe('p92');
        await openTable(page);
        await expect(row('p:p0')).toBeVisible();
        await expect(selected).toHaveCount(0);
        await page.locator('#view-mode-family').click();
        await expect.poll(focusId).toBe('p92');
    });

    test('the diagram\'s back / forward (↩ ↪) stay away from the table and come back with the diagram (T54 G14)', async ({ page }) => {
        await openApp(page);
        await seedTree(page, longTree(12), 'Kvelden', 'p0');
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('p4' as never));
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('p8' as never));
        await page.locator('#focus-back-btn').click();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('p4');
        const back = page.locator('#focus-back-btn');
        const forward = page.locator('#focus-forward-btn');
        await expect(back).toBeVisible();
        await expect(forward).toBeVisible();
        await openTable(page);
        await expect(back).toBeHidden();
        await expect(forward).toBeHidden();
        await page.locator('#view-mode-family').click();
        await expect(back).toBeVisible();
        await expect(forward).toBeVisible();
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

    test('no text of a cell is cut at its top or bottom on a phone (T54)', async ({ page }) => {
        await openApp(page);
        await seedTree(page, INKY, 'Pýchrož', 'a');
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
        await expect(page.locator('#table-container .tv-body .tv-row[data-key="p:a#u2"]')).toBeVisible();
        expect(await clippedTexts(page)).toEqual([]);
    });
});
