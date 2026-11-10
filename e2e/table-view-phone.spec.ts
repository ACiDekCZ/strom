import { test, expect, Page } from '@playwright/test';
import { card, openApp, seedSetting, seedTree, type SeedPerson } from './helpers.js';

/**
 * The Table view on a phone and in its states (spec 073 §12, §13): the bar in
 * two rows with ⋯ (Columns, Export, Coverage row, unions), one row when the
 * phone is held sideways; a completeness bubble by a tap; an empty tree, a
 * Unions table without unions, nothing matching and a read-only tree.
 */

const FAMILY: Record<string, SeedPerson> = {
    a: { firstName: 'Orvin', lastName: 'Kvelden', birthDate: '1850-03-02', birthPlace: 'Kveldenau', partners: ['b', 'c'] },
    b: { firstName: 'Tamsa', lastName: 'Morastin', gender: 'female', birthDate: '1852-05-11', partners: ['a'] },
    c: { firstName: 'Ivrena', lastName: 'Pelvarek', gender: 'female', birthDate: '1858-01-20', partners: ['a'] },
    d: { firstName: 'Belko', lastName: 'Kvelden', birthDate: '1880-07-14', parents: ['a', 'b'] },
};

const LONERS: Record<string, SeedPerson> = {
    a: { firstName: 'Darut', lastName: 'Udrasko', birthDate: '1901-04-02' },
    b: { firstName: 'Selvie', lastName: 'Udrasko', gender: 'female', birthDate: '1903-09-12' },
};

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);

async function openTable(page: Page, people: Record<string, SeedPerson>, phone: boolean): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, people, 'Kvelden', 'a');
    if (phone) {
        await page.locator('#bb-view-more').click();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).click();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(tv(page, '.tv-grid')).toBeVisible();
}

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return tv(page, `.tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
}

const box = async (page: Page, sel: string) => (await tv(page, sel).boundingBox())!;

/**
 * Findings beside the longest values (1110): Ludvar's death before his birth
 * marks both dates (an error, "28. 12. 1888" in Czech), Veslin married at
 * 15–16 (a warning on the age range: born 1898 only, married 2 Feb 1914).
 */
async function openMarked(page: Page, phone: boolean, lang = 'cs'): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await seedSetting(page, 'language', lang);
    await openApp(page);
    const person = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown>) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [] as string[], parentIds: [], childIds: [], ...extra });
    const persons = {
        m: person('m', 'Ludvar', 'Strenko', 'male', { birthDate: '1888-12-28', deathDate: '1880-05-08' }),
        n: person('n', 'Veslin', 'Ombrecht', 'male', { birthDate: '1898', partnerships: ['u1'] }),
        k: person('k', 'Arnela', 'Pozvarek', 'female', { birthDate: '1890-03-04', partnerships: ['u1'] }),
    };
    const partnerships = { u1: { id: 'u1', person1Id: 'n', person2Id: 'k', childIds: [], status: 'married', startDate: '1914-02-02' } };
    await page.evaluate(async ({ persons, partnerships }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships } as never, 'Ombrecht');
        await window.Strom.TreeRenderer.setFocus('n' as never);
    }, { persons, partnerships });
    await expect(card(page, 'Veslin')).toBeVisible();
    if (phone) {
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: lang === 'cs' ? 'Tabulka' : 'Table' }).tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(tv(page, '.tv-grid')).toBeVisible();
}

/** The cells of a column that carry a finding's mark: each value whole (its text not cut), the column's width. */
async function markedCells(page: Page, colId: string): Promise<{ texts: string[]; cut: string[]; width: number }> {
    const grid = tv(page, '.tv-grid');
    const head = tv(page, `.tv-headrow [data-col="${colId}"]`);
    // The column window draws only what is near the view: scroll the column in.
    await expect(async () => {
        await grid.evaluate((el, id) => {
            const h = el.querySelector<HTMLElement>(`.tv-headrow [data-col="${id}"]`);
            if (!h) { el.scrollLeft += 120; el.dispatchEvent(new Event('scroll')); return; }
            h.scrollIntoView({ inline: 'center', block: 'nearest' });
        }, colId);
        await expect(head).toBeVisible({ timeout: 300 });
    }).toPass();
    const index = await head.getAttribute('aria-colindex');
    const cells = tv(page, `.tv-body .tv-row [aria-colindex="${index}"]:has(> .tv-mark)`);
    await expect(cells.first()).toBeVisible();
    const width = (await head.boundingBox())!.width;
    const all = await cells.evaluateAll(els => els.map(el => {
        const t = el.querySelector<HTMLElement>('.tv-cell-text')!;
        return { text: t.textContent ?? '', cut: t.scrollWidth > t.clientWidth };
    }));
    return { texts: all.map(a => a.text), cut: all.filter(a => a.cut).map(a => a.text), width };
}

/** Events in the table, by the type sheet on a phone. */
async function toEvents(page: Page, phone: boolean): Promise<void> {
    if (phone) {
        await tv(page, '.tv-rowtype-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: /^Události|^Events/ }).tap();
    } else {
        await tv(page, '.tv-rowtype [data-rowtype="events"]').click();
    }
    await expect(tv(page, '.tv-rowtype [data-rowtype="events"][aria-checked="true"]')).toHaveCount(1);
}

for (const [label, viewport] of [['390', { width: 390, height: 844 }], ['844 × 390', { width: 844, height: 390 }]] as const) {
    test.describe(`phone (${label}), a finding beside a date or an age range`, () => {
        test.use({ viewport, hasTouch: true, isMobile: true });

        test('the age range at marriage and the event date stay whole beside their marks (cs)', async ({ page }) => {
            await openMarked(page, true);
            const age = await markedCells(page, 'wAge');
            expect(age.texts).toContain('15–16');
            expect(age.cut).toEqual([]);

            await toEvents(page, true);
            const date = await markedCells(page, 'evDate');
            expect(date.texts).toContain('28. 12. 1888');
            expect(date.cut).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        });
    });
}

test.describe('desktop (1440), a finding beside a date or an age range', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the widths of Age at marriage and the event date stay as before', async ({ page }) => {
        await openMarked(page, false);
        expect(Math.round((await markedCells(page, 'wAge')).width)).toBe(90);
        await toEvents(page, false);
        expect(Math.round((await markedCells(page, 'evDate')).width)).toBe(110);
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the bar in two rows with ⋯; Columns, Export, Coverage row and unions in its sheet', async ({ page }) => {
        await openTable(page, FAMILY, true);
        // Row 1: the row type, the view, ⋯; row 2: the search and Filters. No Columns or Export buttons.
        const type = await box(page, '.tv-rowtype-btn');
        const viewBtn = await box(page, '.tv-view-btn');
        const more = await box(page, '.tv-more-menu-btn');
        const search = await box(page, '.tv-search-q');
        const filters = await box(page, '.tv-filters-btn');
        expect(Math.abs(type.y - more.y)).toBeLessThan(4);
        expect(Math.abs(type.y - viewBtn.y)).toBeLessThan(4);
        expect(search.y).toBeGreaterThan(type.y + type.height);
        expect(Math.abs(search.y - filters.y)).toBeLessThan(4);
        expect(more.width).toBe(44);
        expect(more.x + more.width).toBeLessThanOrEqual(390);
        await expect(tv(page, '.tv-cols-btn')).toBeHidden();
        await expect(tv(page, '.tv-export-btn')).toBeHidden();

        const sheet = page.locator('.bottom-sheet-menu');
        const openMore = async (): Promise<void> => {
            await tv(page, '.tv-more-menu-btn').tap();
            await expect(sheet).toBeVisible();
        };
        await openMore();
        await expect(sheet.locator('.bottom-sheet-item')).toHaveText([/^Columns/, 'Export', /^Coverage row/, 'Collapse unions']);
        await sheet.locator('.bottom-sheet-item', { hasText: 'Columns' }).tap();
        await expect(page.locator('.tv-colpanel--sheet')).toBeVisible();
        await page.locator('.tv-colpanel--sheet .tv-cp-done').tap();
        await expect(page.locator('.tv-colpanel--sheet')).toHaveCount(0);

        await openMore();
        await sheet.locator('.bottom-sheet-item', { hasText: 'Export' }).tap();
        await expect(page.locator('.bottom-sheet', { hasText: 'Download CSV' })).toBeVisible();
        await page.keyboard.press('Escape');

        // The coverage row off and on again.
        await expect(tv(page, '.tv-covrow')).toBeVisible();
        await openMore();
        await sheet.locator('.bottom-sheet-item', { hasText: 'Coverage row' }).tap();
        await expect(tv(page, '.tv-covrow')).toBeHidden();
        await openMore();
        await sheet.locator('.bottom-sheet-item', { hasText: 'Coverage row' }).tap();
        await expect(tv(page, '.tv-covrow')).toBeVisible();

        // Orvin's two unions: collapsed from ⋯, then the item offers Expand.
        await expect(tv(page, '.tv-body .tv-row--sub')).toHaveCount(2);
        await openMore();
        await sheet.locator('.bottom-sheet-item', { hasText: 'Collapse unions' }).tap();
        await expect(tv(page, '.tv-body .tv-row--sub')).toHaveCount(0);
        await openMore();
        await expect(sheet.locator('.bottom-sheet-item').last()).toHaveText('Expand unions');
        await page.keyboard.press('Escape');

        // Only the grid scrolls sideways, never the page.
        const grid = tv(page, '.tv-grid');
        expect(await grid.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        await grid.evaluate(el => { el.scrollLeft = 200; });
        await expect(grid).toHaveClass(/is-scrolled-x/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('a tap on a completeness cell opens its bubble as a sheet; elsewhere the row sheet', async ({ page }) => {
        await openTable(page, FAMILY, true);
        const grid = tv(page, '.tv-grid');
        await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        const comp = await cell(page, 'p:d', 'comp');
        await comp.tap();
        const bubble = page.locator('.tv-bubble--sheet');
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.tv-bub-sheet-title')).toHaveText(/^Overall completeness \d+ %$/);
        await expect(bubble).toContainText('missing:');
        await bubble.locator('.tv-bub-close').tap();
        await expect(bubble).toHaveCount(0);
        await grid.evaluate(el => { el.scrollLeft = 0; });
        await (await cell(page, 'p:d', 'bDate')).tap();
        await expect(page.locator('.bottom-sheet-menu')).toContainText('Show in tree');
    });

    test('an empty tree: the table says so, Add person opens the dialog', async ({ page }) => {
        await openTable(page, FAMILY, true);
        await page.evaluate(async () => { await window.Strom.DataManager.importAsNewTree({ persons: {}, partnerships: {} } as never, 'Udrasko'); });
        const empty = tv(page, '.tv-empty');
        await expect(empty).toBeVisible();
        await expect(tv(page, '.tv-grid')).toBeHidden();
        await expect(page.locator('#empty-state')).toBeHidden();
        await expect(empty.locator('.empty-block-title')).toHaveText('The table is empty so far');
        await expect(tv(page, '.tv-rowtype-btn')).toHaveText('People · 0 ▾');
        await expect(tv(page, '.tv-status-count')).toHaveText('0 of 0 people');
        await empty.locator('.empty-block-action').tap();
        await expect(page.locator('#person-modal')).toBeVisible();
    });
});

test.describe('phone held sideways (844 × 390)', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the bar in one row of 50 px: type, view, search, Filters, ⋯; a 26 px status line', async ({ page }) => {
        await openTable(page, FAMILY, true);
        const row = await box(page, '.tv-bar-row1');
        expect(Math.round(row.height)).toBe(50);
        const tops = await Promise.all(['.tv-rowtype-btn', '.tv-view-btn', '.tv-search-q', '.tv-filters-btn', '.tv-more-menu-btn'].map(s => box(page, s)));
        const xs = tops.map(b => b.x);
        expect([...xs].sort((a, b) => a - b)).toEqual(xs);
        for (const b of tops) expect(b.y + b.height).toBeLessThanOrEqual(row.y + row.height);
        expect(Math.round((await box(page, '.tv-status')).height)).toBe(26);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('an empty tree in the table, Unions without unions and nothing matching the search', async ({ page }) => {
        await openTable(page, LONERS, false);
        await expect(tv(page, '.tv-more-menu-btn')).toBeHidden();
        await expect(tv(page, '.tv-cols-btn')).toBeVisible();

        await page.getByRole('radio', { name: /^Unions, / }).click();
        const empty = tv(page, '.tv-empty');
        await expect(empty).toBeVisible();
        await expect(empty.locator('.empty-block-title')).toHaveText('There is no union in the tree');
        await expect(empty.locator('button')).toHaveCount(0);
        await expect(tv(page, '.tv-status-count')).toHaveText('0 of 0 unions');
        await page.getByRole('radio', { name: /^People, / }).click();
        await expect(empty).toBeHidden();

        // Nothing matches: the head stays, the sentence and Clear filters under it (13c).
        await tv(page, '.tv-search-q').fill('Kvelden');
        await expect(tv(page, '.tv-nomatch')).toBeVisible();
        await expect(tv(page, '.tv-nomatch-title')).toHaveText('Nothing matches the filter');
        await expect(tv(page, '.tv-headrow')).toBeVisible();
        await expect(tv(page, '.tv-status-count')).toHaveText('0 of 2 people');
        await tv(page, '.tv-nomatch-clear').click();
        await expect(tv(page, '.tv-status-count')).toHaveText('2 of 2 people');

        await page.evaluate(async () => { await window.Strom.DataManager.importAsNewTree({ persons: {}, partnerships: {} } as never, 'Udrasko'); });
        await expect(empty.locator('.empty-block-title')).toHaveText('The table is empty so far');
        await expect(tv(page, '.tv-chips')).toBeHidden();
        await expect(page.locator('#empty-state')).toBeHidden();
        // The first person added: the grid comes back.
        await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Imbra', lastName: 'Udrasko', gender: 'female' } as never));
        await page.evaluate(() => window.Strom.TreeRenderer.render());
        await expect(tv(page, '.tv-grid')).toBeVisible();
        await expect(empty).toBeHidden();
        await expect(tv(page, '.tv-status-count')).toHaveText('1 of 1 person');
    });

    test('a read-only (locked) tree: the sentence in the status line, no Edit, no Save', async ({ page }) => {
        await openTable(page, FAMILY, false);
        const tid = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
        await page.evaluate((id) => window.Strom.UI.toggleTreeLock(id), tid);
        const ro = tv(page, '.tv-status-ro');
        await expect(ro).toBeVisible();
        await expect(ro.locator('.tv-ro-long')).toHaveText('Read only: edits and “Not an error” are not available here.');
        const row = tv(page, '.tv-body .tv-row[data-key="p:d"]');
        await row.click();
        await expect(row.locator('.tv-act[data-act="open"]')).toBeVisible();
        await expect(row.locator('.tv-act[data-act="edit"]')).toHaveCount(0);
        await page.evaluate((id) => window.Strom.UI.toggleTreeLock(id), tid);
        await expect(ro).toBeHidden();
        await expect(row.locator('.tv-act[data-act="edit"]')).toHaveCount(1);
    });
});
