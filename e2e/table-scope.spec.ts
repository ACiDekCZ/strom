/**
 * The Table's scope (spec 098 §11c): the shared switch This view / Selection ▾
 * / Whole tree in the bar after "Scope"; a list chosen in the choice is the
 * window's selection (the Family view highlights it) with its order, # and
 * Done; This view is the people the Family view lays out; Sources dim the
 * switch; where the bar is tight (1100 px) the switch folds into one button
 * with its menu; a phone's "Scope: … ▾" on a row of its own opens the sheet.
 * Invented names only; the clock is fixed.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { openApp, seedSetting, seedTree } from './helpers';

const NOW = new Date('2026-11-16T10:30:00Z');

/** Quillon's family (six people around him) and Merrit with no tie to them (only in the Whole tree); two lists. */
async function family(page: Page): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    await seedTree(page, {
        q: { firstName: 'Quillon', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1950' },
        t: { firstName: 'Tamsel', lastName: 'Varnholm', parents: ['o', 'y'], partners: ['i'], birthDate: '1921' },
        i: { firstName: 'Ilvara', lastName: 'Brannoc', gender: 'female', partners: ['t'], birthDate: '1925' },
        o: { firstName: 'Orvald', lastName: 'Varnholm', partners: ['y'], birthDate: '1890' },
        y: { firstName: 'Yselda', lastName: 'Fennick', gender: 'female', partners: ['o'], birthDate: '1894' },
        w: { firstName: 'Wendrel', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1953' },
        m: { firstName: 'Merrit', lastName: 'Quorne', birthDate: '1960' },
    }, 'Varnholm', 'q');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['w', 'q', 'm'] as never[], sort: 'manual' });
        const work = dm.createPersonList({ name: 'Graves to visit', dynamic: false, personIds: ['y', 'o'] as never[], sort: 'manual' })!;
        dm.setPersonListChecklist(work.id, true);
    });
}

const tv = (page: Page, sel: string): Locator => page.locator(`#table-container ${sel}`);
const status = (page: Page): Locator => tv(page, '.tv-status-count');
const shownKeys = (page: Page): Promise<string[]> => tv(page, '.tv-body .tv-row[data-key]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key!));
const headCols = (page: Page): Promise<string[]> => tv(page, '.tv-headrow [data-col]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.col ?? ''));
const listId = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.Strom.DataManager.getPersonLists().find(x => x.name === n)!.id, name);
const storedSelection = (page: Page) => page.evaluate(() => {
    const S = window.Strom;
    return (S.SettingsManager.getSelectionForTree(S.DataManager.getCurrentTreeId()) as { ref: Record<string, unknown> } | null)?.ref ?? null;
});

async function openTable(page: Page, phone = false): Promise<void> {
    if (phone) await page.locator('#bb-view-table').tap();
    else await page.locator('#view-mode-table').click();
    await expect(status(page)).toHaveText('7 of 7 people');
}

test.describe('the Table\'s scope, a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the switch in the bar: This view the Family view\'s people; a list chosen is the window\'s selection with # and Done; Sources dim it @smoke', async ({ page }) => {
        await family(page);
        await openTable(page);
        await expect(tv(page, '.tv-slot-scope .tv-scope-label')).toHaveText('Scope');
        await expect(page.locator('#table-scope-tree')).toHaveClass(/active/);
        await expect(tv(page, '.tv-scope-btn')).toBeHidden();
        // The bar stays one row.
        expect((await tv(page, '.tv-bar-row1').boundingBox())!.height).toBeLessThan(60);

        // This view: the six people laid out around Quillon, Merrit not among them.
        await page.locator('#table-scope-view').click();
        await expect(page.locator('#table-scope-view')).toHaveClass(/active/);
        await expect(status(page)).toHaveText('6 of 6 people');
        expect((await shownKeys(page)).sort()).toEqual(['p:i', 'p:o', 'p:q', 'p:t', 'p:w', 'p:y']);
        expect(await headCols(page)).not.toContain('num');

        // Selection ▾ without a selection: the choice; a list picked becomes the window's selection.
        await page.locator('#table-scope-sel').click();
        const pop = tv(page, '.table-scope-pick .sp-rodpick-pop');
        await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Graves to visit' }).locator('button').click();
        const sel = page.locator('#table-scope-sel');
        await expect(sel).toHaveClass(/active/);
        await expect(sel).toContainText('List: Graves to visit');
        await expect(sel).toContainText('· 2');
        await expect(status(page)).toHaveText('2 of 2 people');
        expect(await shownKeys(page)).toEqual(['p:y', 'p:o']);
        expect((await headCols(page)).slice(0, 2)).toEqual(['num', 'done']);
        await expect(tv(page, '.tv-status')).toContainText('Sort: # (list order)');
        // The list's order is the scope's: the open view stays unchanged.
        await expect(tv(page, '.tv-view-changed')).toBeHidden();
        const graves = await listId(page, 'Graves to visit');
        expect(await storedSelection(page)).toEqual({ kind: 'list', listId: graves });

        // Sources: the switch stays, dimmed, and says why; a click changes nothing.
        await tv(page, '.tv-rowtype [data-rowtype="sources"]').click();
        const seg = tv(page, '.table-scope.scope-seg');
        await expect(seg).toHaveAttribute('aria-disabled', 'true');
        await expect(seg).toHaveAttribute('title', 'The scope does not apply to sources.');
        await page.locator('#table-scope-tree').click({ force: true });
        await expect(sel).toHaveClass(/active/);
        await tv(page, '.tv-rowtype [data-rowtype="persons"]').click();
        await expect(seg).not.toHaveAttribute('aria-disabled', 'true');
        await expect(status(page)).toHaveText('2 of 2 people');

        // The Whole tree: every row, the list's # gone from the sort; the Family view highlights the selection.
        await page.locator('#table-scope-tree').click();
        await expect(status(page)).toHaveText('7 of 7 people');
        expect(await headCols(page)).not.toContain('num');
        await page.locator('#view-mode-family').click();
        await expect(page.locator('#evidence-pill .evidence-pill-label--pick')).toContainText('Graves to visit');
    });
});

test.describe('the Table\'s scope in German, a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the switch stays unfolded with a list taken (its order leaves the view unchanged)', async ({ page }) => {
        await seedSetting(page, 'language', 'de');
        await family(page);
        await page.locator('#view-mode-table').click();
        await expect(page.locator('#table-scope-tree')).toBeVisible();
        await page.locator('#table-scope-sel').click();
        await tv(page, '.table-scope-pick .sp-rodpick-pop li.sp-selpick-row[data-sec="lists"]').filter({ hasText: 'Graves to visit' }).locator('button').click();
        await expect(page.locator('#table-scope-sel')).toHaveClass(/active/);
        await expect(tv(page, '.tv-view-changed')).toBeHidden();
        await expect(tv(page, '.table-scope.scope-seg')).toBeVisible();
        await expect(tv(page, '.tv-scope-btn')).toBeHidden();
        expect((await tv(page, '.tv-bar-row1').boundingBox())!.height).toBeLessThan(60);
    });

    test('a list name of 30 characters keeps the switch unfolded: the name cut shorter inside it, one row', async ({ page }) => {
        await seedSetting(page, 'language', 'de');
        await family(page);
        const id = await page.evaluate(() => window.Strom.DataManager.createPersonList({
            name: 'Briefe an die Pfarrei Varnholm', dynamic: false, personIds: ['w', 'q'] as never[], sort: 'manual',
        })!.id);
        await page.locator('#view-mode-table').click();
        await page.evaluate((l) => window.Strom.UI.setTableScopeTo(l), id);
        await expect(page.locator('#table-scope-sel')).toHaveClass(/active/);
        await expect(page.locator('#table-scope-sel')).toContainText('Briefe an die');
        await expect(tv(page, '.table-scope.scope-seg')).toBeVisible();
        await expect(tv(page, '.tv-scope-btn')).toBeHidden();
        const row = tv(page, '.tv-bar-row1');
        // The bar settles after a measurement (fitBarRow): poll, not one look.
        await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(60);
        // The name inside the switch ends with "…", nothing past the row's edge.
        const name = page.locator('#table-scope-sel .scope-name');
        await expect.poll(() => name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        await expect.poll(() => row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
        // The narrower search keeps its placeholder whole: no room kept for the clear cross while empty.
        const fits = await tv(page, '.tv-search-q').evaluate(el => {
            const inp = el as HTMLInputElement;
            const cs = getComputedStyle(inp);
            const probe = document.createElement('span');
            probe.textContent = inp.placeholder;
            probe.style.cssText = `position:absolute;white-space:nowrap;font:${cs.font}`;
            document.body.appendChild(probe);
            const textW = probe.offsetWidth;
            probe.remove();
            const room = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const noCross = [...document.styleSheets].some(sh => [...sh.cssRules].some(r =>
                r instanceof CSSStyleRule && r.selectorText.includes('.tv-search-q:placeholder-shown::-webkit-search-cancel-button')
                && r.style.display === 'none'));
            return { textW, room, noCross };
        });
        expect(fits.noCross).toBe(true);
        expect(fits.room).toBeGreaterThanOrEqual(fits.textW);
    });
});

test.describe('the Table\'s scope where the bar is tight', () => {
    test.use({ viewport: { width: 1100, height: 800 }, colorScheme: 'dark' });

    test('folded into one button: its menu with the three scopes, a few selections and All selections…', async ({ page }) => {
        await family(page);
        await openTable(page);
        const btn = tv(page, '.tv-scope-btn');
        await expect(btn).toBeVisible();
        await expect(tv(page, '.table-scope.scope-seg')).toBeHidden();
        await expect(btn).toContainText('Whole tree');
        expect((await tv(page, '.tv-bar-row1').boundingBox())!.height).toBeLessThan(60);
        await btn.click();
        const menu = page.locator('.tv-scope-menu');
        await expect(menu.locator('.tv-menu-heading')).toHaveText(['Table scope', 'Change the selection']);
        const item = (label: string | RegExp): Locator => menu.locator('.tv-menu-item', { hasText: label });
        await expect(item('Whole tree')).toHaveAttribute('aria-checked', 'true');
        await expect(item('Whole tree')).toContainText('7');
        await expect(item('This view')).toHaveAttribute('aria-checked', 'false');
        await expect(item('This view')).toContainText('6');
        await expect(item('Selection…')).toBeVisible();
        await item('Letters to write').click();

        await expect(btn).toHaveClass(/is-list/);
        await expect(btn).toHaveAttribute('aria-label', 'Scope: List: Letters to write');
        await expect(status(page)).toHaveText('3 of 3 people');
        expect(await shownKeys(page)).toEqual(['p:w', 'p:q', 'p:m']);

        // All selections…: the choice under the folded button.
        await btn.click();
        await expect(item('Selection: List: Letters to write')).toHaveAttribute('aria-checked', 'true');
        await item('All selections…').click();
        await expect(tv(page, '.table-scope-pick .sp-rodpick-pop')).toBeVisible();
        // Escape belongs to the choice once the keyboard is in it (its search field, focused a frame after it opens).
        await expect(tv(page, '.table-scope-pick .sp-rodpick-q')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(tv(page, '.table-scope-pick')).toHaveCount(0);

        await btn.click();
        await item('This view').click();
        await expect(status(page)).toHaveText('6 of 6 people');
        await expect(btn).toContainText('This view');
    });
});

test.describe('the Table\'s scope on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('"Scope: … ▾" on a row of its own over the search, 44 px; its sheet chooses', async ({ page }) => {
        await family(page);
        await openTable(page, true);
        const btn = tv(page, '.table-scope-btn');
        await expect(btn).toBeVisible();
        await expect(btn).toContainText('Scope: Whole tree');
        await expect(tv(page, '.table-scope.scope-seg')).toBeHidden();
        const box = (await btn.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        const search = (await tv(page, '.tv-slot-search').boundingBox())!;
        const view = (await tv(page, '.tv-slot-view').boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(view.y + view.height - 1);
        expect(search.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
        expect(box.width).toBeGreaterThan(300);

        await btn.tap();
        const sheet = page.locator('.table-scope-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-scope]')).toHaveCount(3);
        await expect(sheet.locator('[data-scope="tree"]')).toHaveAttribute('aria-checked', 'true');
        for (const row of await sheet.locator('.scope-row').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await sheet.locator('.scope-row[data-sel]', { hasText: 'Graves to visit' }).tap();
        await expect(sheet).toBeHidden();
        await expect(status(page)).toHaveText('2 of 2 people');
        await expect(btn).toContainText('List: Graves to visit');
    });
});
