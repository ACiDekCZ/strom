/**
 * The Table narrowed to a list of people (spec 084 §9, §13d): Scope ▾ in the
 * bar (the phone's Scope › in ⋯), the People rows in the list's order with
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

async function chooseScope(page: Page, name: string): Promise<void> {
    await tv(page, '.tv-scope-btn').click();
    await tvItem(page, name).click();
}

test.describe('Table scope: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Scope ▾: the list\'s people in its order with #, the counts in the scope, back to the whole tree', async ({ page }) => {
        await family(page);
        await openTable(page);
        const btn = tv(page, '.tv-scope-btn');
        await expect(btn).toHaveText(/Whole tree/);
        await expect(btn).not.toHaveClass(/is-list/);
        await expect(tv(page, '.tv-slot-scope .tv-scope-label')).toHaveText('Scope');
        await btn.click();
        await expect(page.locator('.tv-menu .tv-menu-heading')).toHaveText('Lists of people');
        await expect(tvItem(page, 'Whole tree')).toHaveAttribute('aria-checked', 'true');
        await expect(tvItem(page, 'Letters to write')).toContainText('3');
        await expect(tvItem(page, 'Manage lists…')).toBeVisible();
        await tvItem(page, 'Letters to write').click();

        await expect(btn).toHaveClass(/is-list/);
        await expect(btn).toHaveAttribute('aria-label', 'Scope: Letters to write');
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
        await expect(btn).toHaveAttribute('aria-disabled', 'true');
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
        await expect(tv(page, '.tv-scope-btn')).toHaveText(/Whole tree/);
        await expect(row(page, 'p:i')).toHaveAttribute('aria-selected', 'true');

        // The list deleted under the scope: the whole tree, said under the bar.
        await chooseScope(page, 'Letters to write');
        await expect(status(page)).toHaveText('3 of 3 people');
        const id = await listId(page, 'Letters to write');
        await page.evaluate((x) => window.Strom.DataManager.deletePersonList(x), id);
        await expect(notice.locator('.tv-notice-text')).toHaveText('The view’s list is gone; the whole tree is shown.');
        await expect(status(page)).toHaveText('6 of 6 people');
        await notice.locator('.tv-notice-close').click();
        await expect(notice).toBeHidden();
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
        await expect(tv(page, '.tv-scope-btn')).toHaveAttribute('aria-label', 'Scope: Letters to write');
        await expect(status(page)).toHaveText('3 of 3 people');

        await page.evaluate(() => window.Strom.UI.showPersonLists());
        await d.locator('.pl-row', { hasText: 'Graves to visit' }).click();
        await d.locator('[data-key="no-cite"]').click();
        await expect(tv(page, '.tv-scope-btn')).toHaveAttribute('aria-label', 'Scope: Graves to visit');
        await expect(tv(page, '.tv-chips [data-chip="noSource"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(status(page)).toHaveText('2 of 2 people');

        // A list made from a Table filter: Edit rule… opens the Table with the filter; ⋯ saves it to the list.
        const ruleId = await page.evaluate(() => window.Strom.DataManager.createPersonList({
            name: 'Born before 1900', dynamic: true,
            rule: { kind: 'tableFilter', rowType: 'persons', filter: { op: 'and', items: [{ col: 'bDate', kind: 'date', to: 1900 }] as never[] }, sort: [{ col: 'bDate', dir: 1 }] },
        })!.id);
        expect(await listIds(page, 'Born before 1900')).toEqual(['c', 'y']);
        await page.evaluate((x) => window.Strom.UI.openTableForRule(x), ruleId);
        await expect(tv(page, '.tv-scope-btn')).toHaveText(/Whole tree/);
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

    test('Scope › in ⋯: the lists on a second page, the rows in the list\'s order, no Scope ▾ in the bar', async ({ page }) => {
        await family(page);
        await openTable(page, true);
        await expect(tv(page, '.tv-slot-scope')).toBeHidden();
        await tv(page, '.tv-more-menu-btn').tap();
        const sheet = page.locator('.bottom-sheet');
        const first = sheet.locator('.bottom-sheet-item').first();
        await expect(first).toContainText('Scope');
        await expect(first).toContainText('Whole tree');
        await first.tap();
        const sub = sheet.locator('.bottom-sheet-subpage');
        await expect(sub).toBeVisible();
        const item = sub.locator('.bottom-sheet-item', { hasText: 'Letters to write' });
        expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await item.tap();
        await expect(status(page)).toHaveText('3 of 3 people');
        expect(await shownKeys(page)).toEqual(['p:w', 'p:q', 'p:t']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        // Again: the row says the list; ✓ on it.
        await tv(page, '.tv-more-menu-btn').tap();
        await expect(sheet.locator('.bottom-sheet-item').first()).toContainText('Letters to write');
        await sheet.locator('.bottom-sheet-item').first().tap();
        await expect(sub.locator('.bottom-sheet-item', { hasText: 'Letters to write' })).toContainText('✓');
        await sub.locator('.bottom-sheet-item', { hasText: 'Whole tree' }).tap();
        await expect(status(page)).toHaveText('6 of 6 people');
    });
});
