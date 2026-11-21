/**
 * The Table narrowed to a list of people (spec 084 §9, §13d): the list as the
 * window's selection with the scope Selection of the shared switch (spec 098
 * §11c; a phone's "Scope: … ▾" over the search), the People rows in the list's order with
 * #, the row types counting the scope, a jump to a person outside the list
 * (Not in the list, Show for now, Whole tree), a list deleted under the
 * scope, a work list's Done column and chips, Remove from the list in a
 * row's menu, Open in Table from the dialog Lists of people (with the chip
 * of people without a source) and a Table filter rule edited in the Table.
 * Invented names only; the clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
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
        dm.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['w', 'q', 't'] as never[], sort: 'manual' });
        const work = dm.createPersonList({ name: 'Graves to visit', dynamic: false, personIds: ['c', 'y'] as never[], sort: 'manual' })!;
        dm.setPersonListChecklist(work.id, true);
    });
}

const listId = (page: Page, name: string) => page.evaluate((n) => window.Strom.DataManager.getPersonLists().find(x => x.name === n)!.id, name);
const listIds = (page: Page, name: string) => page.evaluate((n) => {
    const l = window.Strom.DataManager.getPersonLists().find(x => x.name === n);
    return l ? window.Strom.DataManager.getPersonListIds(l.id) : null;
}, name);
const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const row = (page: Page, key: string) => tv(page, `.tv-body .tv-row[data-key="${key}"]`);
const tvItem = (page: Page, label: string | RegExp) => page.locator('.tv-menu .tv-menu-item', { hasText: label });
const status = (page: Page) => tv(page, '.tv-status-count');
const shownKeys = (page: Page) => tv(page, '.tv-body .tv-row[data-key]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key!));

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return row(page, key).locator(`[aria-colindex="${index}"]`);
}

async function openTable(page: Page, phone = false): Promise<void> {
    if (phone) await page.locator('#bb-view-table').tap();
    else await page.locator('#view-mode-table').click();
    await expect(status(page)).toHaveText('6 of 6 people');
}

/**
 * The shared switch (spec 098 §11c): Whole tree, or a list as the window's
 * selection from the choice under Selection ▾ (the part alone takes the
 * window's selection when it is that list already).
 */
async function chooseScope(page: Page, name: string): Promise<void> {
    if (name === 'Whole tree') {
        await page.locator('#table-scope-tree').click();
        await expect(page.locator('#table-scope-tree')).toHaveClass(/active/);
        return;
    }
    const sel = page.locator('#table-scope-sel');
    const pop = tv(page, '.table-scope-pick .sp-rodpick-pop');
    const taken = page.locator('#table-scope-sel.active', { hasText: name });
    await sel.click();
    await expect(pop.or(taken)).toBeVisible();
    if (await pop.isVisible()) await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: name }).locator('button').click();
    await expect(taken).toBeVisible();
}

test.describe('Table scope: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Selection ▾: the list\'s people in its order with #, the counts in the scope, back to the whole tree', async ({ page }) => {
        await family(page);
        await openTable(page);
        const sel = page.locator('#table-scope-sel');
        await expect(page.locator('#table-scope-tree')).toHaveClass(/active/);
        await expect(tv(page, '.tv-slot-scope .tv-scope-label')).toHaveText('Scope');
        await sel.click();
        const pick = tv(page, '.table-scope-pick .sp-rodpick-pop li.sp-selpick-row[data-sec="lists"]');
        await expect(pick.filter({ hasText: 'Letters to write' })).toContainText('3');
        await pick.filter({ hasText: 'Letters to write' }).locator('button').click();

        await expect(sel).toHaveClass(/active/);
        await expect(sel).toContainText('List: Letters to write');
        await expect(status(page)).toHaveText('3 of 3 people');
        await expect(tv(page, '.tv-status')).toContainText('Sort: # (list order)');
        expect(await shownKeys(page)).toEqual(['p:w', 'p:q', 'p:t']);
        await expect(tv(page, '.tv-headrow [data-col]').first()).toHaveAttribute('data-col', 'num');
        await expect(await cell(page, 'p:t', 'num')).toHaveText('3');
        // The bar stays one row.
        expect((await tv(page, '.tv-bar-row1').boundingBox())!.height).toBeLessThan(60);
        // Unions: those with a partner in the list (Tamsel + Ilvara); Sources keep the whole tree and dim the scope.
        await tv(page, '.tv-rowtype [data-rowtype="unions"]').click();
        await expect(status(page)).toHaveText(/^1 of 1 union/);
        await tv(page, '.tv-rowtype [data-rowtype="sources"]').click();
        await expect(tv(page, '.table-scope.scope-seg')).toHaveAttribute('aria-disabled', 'true');
        await tv(page, '.tv-rowtype [data-rowtype="persons"]').click();
        await expect(status(page)).toHaveText('3 of 3 people');

        // Clear filters does not drop the scope; Whole tree does.
        await tv(page, '.tv-search-q').fill('Quillon');
        await expect(status(page)).toHaveText('1 of 3 people');
        await tv(page, '.tv-search-q').fill('');
        await expect(status(page)).toHaveText('3 of 3 people');
        await chooseScope(page, 'Whole tree');
        await expect(status(page)).toHaveText('6 of 6 people');
        await expect(tv(page, '.tv-headrow [data-col="num"]')).toHaveCount(0);
    });

    test('the Added column (§8): offered in the Columns panel, the day or "earlier" in italics, sorted down with "earlier" at the end', async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await openApp(page);
        await seedTree(page, {
            q: { firstName: 'Quillon', lastName: 'Varnholm', birthDate: '1950', addedAt: '2026-11-02T09:00:00.000Z' },
            t: { firstName: 'Tamsel', lastName: 'Varnholm', birthDate: '1921' },
            w: { firstName: 'Wendrel', lastName: 'Varnholm', birthDate: '1953', addedAt: '2026-11-14T15:00:00.000Z' },
        }, 'Varnholm', 'q');
        await page.locator('#view-mode-table').click();
        await expect(status(page)).toHaveText('3 of 3 people');
        await expect(tv(page, '.tv-headrow [data-col="added"]')).toHaveCount(0);

        await tv(page, '.tv-cols-btn').click();
        const panel = page.getByRole('dialog', { name: 'Columns' });
        await page.locator('.tv-cp-q').fill('added');
        await panel.getByRole('checkbox', { name: 'Added', exact: true }).check();
        await page.keyboard.press('Escape');
        // In the Person group, right after the name.
        await expect(tv(page, '.tv-headrow [data-col]').nth(1)).toHaveAttribute('data-col', 'added');
        await expect(await cell(page, 'p:w', 'added')).toHaveText('14 Nov 2026');
        const earlier = await cell(page, 'p:t', 'added');
        await expect(earlier).toHaveText('earlier');
        await expect(earlier).toHaveClass(/tv-cell--word/);
        await expect(earlier.locator('.tv-cell-text')).toHaveCSS('font-style', 'italic');

        const head = tv(page, '.tv-headrow [data-col="added"]');
        await head.hover();
        await head.getByRole('button', { name: 'Column menu: Added' }).click();
        await page.getByRole('menuitem', { name: 'Sort descending' }).click();
        await expect(tv(page, '.tv-status-sort')).toHaveText('Sort: Added ↓');
        expect(await shownKeys(page)).toEqual(['p:w', 'p:q', 'p:t']);
    });

    test('a jump to a person outside the list: Not in the list, Show for now, Whole tree; a deleted list', async ({ page }) => {
        await family(page);
        await openTable(page);
        await page.evaluate(() => window.Strom.UI.openTableView('b:births'));
        await chooseScope(page, 'Letters to write');
        await expect(status(page)).toHaveText('3 of 3 people');
        const mother = async () => (await cell(page, 'p:q', 'mother')).locator('.tv-nm--jump');
        await (await mother()).click();
        const notice = tv(page, '.tv-notice');
        await expect(notice.locator('.tv-notice-text')).toHaveText('Not in the list: Ilvara Brannoc.');
        await expect(notice.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
        await notice.getByRole('button', { name: 'Show for now' }).click();
        await expect(notice).toBeHidden();
        await expect(row(page, 'p:i')).toHaveClass(/is-outside-list/);
        await expect(row(page, 'p:i').locator('.tv-outside')).toHaveText('outside the list');
        await expect(await cell(page, 'p:i', 'num')).toHaveText('–');
        await expect(status(page)).toHaveText('3 of 3 people');

        await tv(page, '.tv-nav-btn[data-nav="-1"]').click();
        await expect(row(page, 'p:i')).toHaveCount(0);
        await (await mother()).click();
        await notice.getByRole('button', { name: 'Whole tree' }).click();
        await expect(notice).toBeHidden();
        await expect(page.locator('#table-scope-tree')).toHaveClass(/active/);
        await expect(row(page, 'p:i')).toHaveAttribute('aria-selected', 'true');

        // The list deleted under the scope: the window's selection cleared and said in a toast (held while the
        // delete's toast with Undo shows), the whole tree; no notice under the bar.
        await chooseScope(page, 'Letters to write');
        await expect(status(page)).toHaveText('3 of 3 people');
        const id = await listId(page, 'Letters to write');
        await page.evaluate((x) => window.Strom.DataManager.deletePersonList(x), id);
        await expect(page.locator('body > .toast', { hasText: 'Selection cleared: the list “Letters to write” was deleted.' })).toBeAttached();
        await expect(notice).toBeHidden();
        await expect(status(page)).toHaveText('6 of 6 people');
        await expect(page.locator('#table-scope-tree')).toHaveClass(/active/);
    });

    test('a work list: Done boxes ticked by a click and Space, the chips Left and Done; Remove from the list', async ({ page }) => {
        await family(page);
        await openTable(page);
        await chooseScope(page, 'Graves to visit');
        await expect(status(page)).toHaveText('2 of 2 people');
        const heads = await tv(page, '.tv-headrow [data-col]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col));
        expect(heads.slice(0, 2)).toEqual(['num', 'done']);
        const box = (await cell(page, 'p:c', 'done')).locator('.tv-check');
        await expect(box).toHaveAttribute('aria-checked', 'false');
        await box.click();
        await expect(box).toHaveAttribute('aria-checked', 'true');
        const done = () => page.evaluate(() => window.Strom.DataManager.getPersonLists().find(l => l.name === 'Graves to visit')!.done ?? []);
        expect(await done()).toEqual(['c']);
        const chips = tv(page, '.tv-chips [data-chip]');
        await expect(chips.nth(0)).toHaveAttribute('data-chip', 'left');
        await expect(chips.nth(1)).toHaveAttribute('data-chip', 'done');
        await tv(page, '.tv-chips [data-chip="left"]').click();
        await expect(status(page)).toHaveText('1 of 2 people');
        await tv(page, '.tv-chips [data-chip="done"]').click();
        await expect(tv(page, '.tv-chips [data-chip="left"]')).toHaveAttribute('aria-pressed', 'false');
        expect(await shownKeys(page)).toEqual(['p:c']);
        await tv(page, '.tv-chips [data-chip="done"]').click();
        // Space on the Done cell ticks it back.
        await (await cell(page, 'p:c', 'done')).click({ position: { x: 50, y: 6 } });
        await page.keyboard.press('Space');
        await expect((await cell(page, 'p:c', 'done')).locator('.tv-check')).toHaveAttribute('aria-checked', 'false');
        expect(await done()).toEqual([]);

        // A fixed list's row menu: Remove from the list.
        await row(page, 'p:y').locator('.tv-name').click({ button: 'right' });
        await tvItem(page, 'Remove from the list').click();
        await expect(status(page)).toHaveText('1 of 1 person');
        expect(await listIds(page, 'Graves to visit')).toEqual(['c']);
        // Not offered on the whole tree.
        await chooseScope(page, 'Whole tree');
        await row(page, 'p:c').locator('.tv-name').click({ button: 'right' });
        await expect(tvItem(page, 'Add to list')).toBeVisible();
        await expect(tvItem(page, 'Remove from the list')).toHaveCount(0);
        await page.keyboard.press('Escape');
    });

    test('Open in Table from the dialog Lists of people, with the chip of people without a source; a Table filter rule edited in the Table', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = page.locator('#person-lists-modal');
        await d.locator('.pl-row', { hasText: 'Letters to write' }).click();
        await d.locator('[data-key="open-table"]').click();
        await expect(d).toHaveCount(0);
        await expect(tv(page, '.tv-scope-btn')).toHaveAttribute('aria-label', 'Scope: List: Letters to write');
        await expect(page.locator('#table-scope-sel')).toHaveClass(/active/);
        await expect(status(page)).toHaveText('3 of 3 people');

        await page.evaluate(() => window.Strom.UI.showPersonLists());
        await d.locator('.pl-row', { hasText: 'Graves to visit' }).click();
        await d.locator('[data-key="no-cite"]').click();
        await expect(tv(page, '.tv-scope-btn')).toHaveAttribute('aria-label', 'Scope: List: Graves to visit');
        await expect(tv(page, '.tv-chips [data-chip="noSource"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(status(page)).toHaveText('2 of 2 people');

        // A list made from a Table filter: Edit rule… opens the Table with the filter; ⋯ saves it to the list.
        const ruleId = await page.evaluate(() => window.Strom.DataManager.createPersonList({
            name: 'Born before 1900', dynamic: true,
            rule: { kind: 'tableFilter', rowType: 'persons', filter: { op: 'and', items: [{ col: 'bDate', kind: 'date', to: 1900 }] as never[] }, sort: [{ col: 'bDate', dir: 1 }] },
        })!.id);
        expect(await listIds(page, 'Born before 1900')).toEqual(['c', 'y']);
        await page.evaluate((x) => window.Strom.UI.openTableForRule(x), ruleId);
        await expect(page.locator('#table-scope-tree')).toHaveClass(/active/);
        await expect(status(page)).toHaveText('2 of 6 people');
        // The filter goes to the rule (the search is not part of it).
        await tv(page, '.tv-chips [data-chip="living"]').click();
        await expect(status(page)).toHaveText('0 of 6 people');
        await tv(page, '.tv-more-menu-btn').click();
        await tvItem(page, 'Save to the list Born before 1900').click();
        await expect(page.locator('.undo-toast, .toast', { hasText: 'Born before 1900' }).first()).toBeVisible();
        expect(await listIds(page, 'Born before 1900')).toEqual([]);
        expect(await page.evaluate((x) => JSON.stringify(window.Strom.DataManager.getPersonList(x)!.rule), ruleId)).toContain('"chip":"living"');
    });
});

test.describe('Table scope: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('"Scope: … ▾" over the search: the lists in its sheet, the rows in the list\'s order', async ({ page }) => {
        await family(page);
        await openTable(page, true);
        // The scope is not in ⋯ any more (spec 098 §11c): a row of its own.
        const btn = tv(page, '.table-scope-btn');
        await expect(btn).toContainText('Scope: Whole tree');
        await btn.tap();
        const sheet = page.locator('.table-scope-sheet');
        await expect(sheet).toBeVisible();
        const item = sheet.locator('.scope-row[data-sel]', { hasText: 'Letters to write' });
        expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await item.tap();
        await expect(status(page)).toHaveText('3 of 3 people');
        expect(await shownKeys(page)).toEqual(['p:w', 'p:q', 'p:t']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        // Again: the button says the list; the Whole tree back from its sheet.
        await expect(btn).toContainText('List: Letters to write');
        await btn.tap();
        await expect(sheet).toBeVisible();
        await sheet.locator('[data-scope="tree"]').tap();
        await expect(status(page)).toHaveText('6 of 6 people');
    });
});
