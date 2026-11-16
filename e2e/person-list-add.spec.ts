/**
 * Add to a list and save a view as a list (spec 084 §4, §6): the person
 * menu's "Add to list ›" (✓ where the person is, a click takes them out),
 * the dialog Add person of a fixed list (people already in it greyed), a
 * Table row's menu and a range of rows, the Table's ⋯ with Save as list of
 * people at every width, the search results' "Results to a list ›", the
 * family line's choice, the phone's second sheet, and a read-only tree
 * (none of it). Invented names only; the clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, card } from './helpers';

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
        window.Strom.DataManager.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['t', 'c', 'y'] as never[], sort: 'old' });
        window.Strom.DataManager.createPersonList({ name: 'Varnholm descendants', dynamic: true, rule: { kind: 'descendants', personId: 'c' as never } });
    });
}

const listIds = (page: Page, name: string) => page.evaluate((n) => {
    const l = window.Strom.DataManager.getPersonLists().find(x => x.name === n);
    return l ? window.Strom.DataManager.getPersonListIds(l.id) : null;
}, name);
const tvMenu = (page: Page) => page.locator('.tv-menu');
const tvItem = (page: Page, label: string | RegExp) => page.locator('.tv-menu .tv-menu-item', { hasText: label });
const row = (page: Page, key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);

async function openTable(page: Page, phone = false): Promise<void> {
    if (phone) await page.locator('#bb-view-table').tap();
    else await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-status-count')).toHaveText('6 of 6 people');
}

test.describe('Add to list: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the person menu: fixed lists only, the person added and taken out, a new list with the person', async ({ page }) => {
        await family(page);
        await card(page, 'Quillon').click();
        const menu = page.locator('.context-menu:not(.context-submenu)');
        await expect(menu).toBeVisible();
        // In the group of Find relationship… and Search in archives…, right after them.
        const labels = await menu.locator('.context-menu-item').allInnerTexts();
        const at = labels.findIndex(l => l.startsWith('Add to list'));
        expect(labels[at - 1]).toContain('Search in archives');
        await menu.locator('[data-menu="add-to-list"]').click();
        const sub = page.locator('.context-submenu');
        await expect(sub).toBeVisible();
        await expect(sub.locator('.menu-section-header')).toHaveText('Lists of people');
        // The automatic list is not offered; the note says why.
        await expect(sub.locator('[data-action^="list-toggle:"]')).toHaveCount(1);
        await expect(sub.locator('[data-action^="list-toggle:"] .menu-item-label')).toHaveText('Letters to write');
        await expect(sub.locator('[data-action^="list-toggle:"] .menu-item-meta')).toHaveText('3');
        await expect(sub.locator('.menu-hint')).toHaveText('Automatic lists fill themselves from their rule.');
        await sub.locator('[data-action^="list-toggle:"]').click();
        await expect(page.locator('.undo-toast', { hasText: 'Quillon Varnholm added to “Letters to write”.' })).toBeVisible();
        expect(await listIds(page, 'Letters to write')).toEqual(['c', 'y', 't', 'q']);

        // Again: ✓ where the person is; a click takes them out.
        await card(page, 'Quillon').click();
        await page.locator('.context-menu [data-menu="add-to-list"]').click();
        const toggle = page.locator('.context-submenu [data-action^="list-toggle:"]');
        await expect(toggle.locator('.menu-item-meta')).toHaveText('✓');
        await expect(toggle).toHaveAttribute('aria-label', 'Letters to write, already in the list');
        await toggle.click();
        await expect(page.locator('.undo-toast', { hasText: 'Quillon Varnholm removed from the list.' })).toBeVisible();
        expect(await listIds(page, 'Letters to write')).toEqual(['c', 'y', 't']);

        // New list with this person…: the dialog New list with the person given (ancestors of them).
        await card(page, 'Wendrel').click();
        await page.locator('.context-menu [data-menu="add-to-list"]').click();
        await page.locator('.context-submenu [data-action="list-new-with"]').click();
        const form = page.locator('#person-list-new');
        await expect(form).toBeVisible();
        await form.locator('.pln-opt[data-opt="ancestors"] .pln-opt-label').click();
        await expect(form.locator('.pln-person')).toContainText('Wendrel Varnholm');
    });

    test('Add person of a fixed list: a search, several people, those in the list greyed', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            const l = window.Strom.DataManager.getPersonLists().find(x => x.name === 'Letters to write')!;
            window.Strom.UI.showPersonLists({ listId: l.id });
        });
        await page.locator('#person-lists-modal [data-act="add-person"]').first().click();
        const dlg = page.locator('#person-list-add');
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('#pla-title')).toHaveText('Add a person to the list');
        expect(Math.round((await dlg.locator('.pla-modal').boundingBox())!.width)).toBe(460);
        await expect(dlg.locator('.pla-search')).toBeFocused();
        await dlg.locator('.pla-search').fill('Varnholm');
        const tamsel = dlg.locator('.pla-row', { hasText: 'Tamsel' });
        await expect(tamsel).toHaveAttribute('aria-disabled', 'true');
        await expect(tamsel.locator('.pla-in')).toHaveText('already in the list');
        await expect(dlg.locator('[data-act="add"]')).toBeDisabled();
        await dlg.locator('.pla-row', { hasText: 'Quillon' }).click();
        await dlg.locator('.pla-row', { hasText: 'Wendrel' }).click();
        await expect(dlg.locator('[data-act="add"]')).toHaveText('Add (2)');
        await dlg.locator('[data-act="add"]').click();
        await expect(dlg).toHaveCount(0);
        await expect(page.locator('.undo-toast', { hasText: '2 people added to “Letters to write”.' })).toBeVisible();
        expect(await listIds(page, 'Letters to write')).toEqual(['c', 'y', 't', 'q', 'w']);
        // Escape closes it and leaves Lists of people open.
        await page.locator('#person-lists-modal [data-act="add-person"]').first().click();
        await expect(dlg).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dlg).toHaveCount(0);
        await expect(page.locator('#person-lists-modal')).toBeVisible();
    });

    test('the Table: a row\'s menu, a range of rows, ⋯ and the views\' menu save the table as a list', async ({ page }) => {
        await family(page);
        await openTable(page);
        await row(page, 'p:w').locator('.tv-name').click({ button: 'right' });
        await expect(tvItem(page, 'Add to list')).toBeVisible();
        await tvItem(page, 'Add to list').click();
        await expect(page.locator('.tv-menu .tv-menu-heading')).toHaveText('Lists of people');
        await expect(page.locator('.tv-menu .tv-menu-foot')).toHaveText('Automatic lists fill themselves from their rule.');
        await tvItem(page, 'Letters to write').click();
        await expect(page.locator('.undo-toast', { hasText: 'Wendrel Varnholm added to “Letters to write”.' })).toBeVisible();
        expect(await listIds(page, 'Letters to write')).toEqual(['c', 'y', 't', 'w']);

        // A range selected across rows (a drag): "Add n people to a list", each person once, no ✓.
        const keys = await page.locator('#table-container .tv-body .tv-row[data-key]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key!));
        const from = (await row(page, keys[0]).locator('.tv-name').boundingBox())!;
        const to = (await row(page, keys[2]).locator('[aria-colindex="3"]').boundingBox())!;
        await page.mouse.move(from.x + 4, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();
        await row(page, keys[1]).locator('.tv-name').click({ button: 'right' });
        await expect(tvItem(page, 'Add 3 people to a list')).toBeVisible();
        await tvItem(page, 'Add 3 people to a list').click();
        await expect(page.locator('.tv-menu .tv-menu-item[aria-checked="true"]')).toHaveCount(0);
        await expect(tvItem(page, 'New list with these people…')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.getSelection()?.removeAllRanges());

        // ⋯ at a computer's width: an icon square with Save as list of people.
        const more = page.locator('#table-container .tv-more-menu-btn');
        await expect(more).toBeVisible();
        const box = (await more.boundingBox())!;
        expect(Math.round(box.width)).toBe(34);
        // The bar stays one row.
        const bar = (await page.locator('#table-container .tv-bar-row1').boundingBox())!;
        expect(bar.height).toBeLessThan(60);
        await more.click();
        // Group by › and the groups' Collapse / Expand all (spec 084 §10) come first.
        await expect(page.locator('.tv-menu .tv-menu-label')).toHaveText(['Group by', 'Collapse all groups', 'Expand all groups', 'Save as list of people…']);
        await tvItem(page, 'Save as list of people…').click();
        const save = page.locator('#person-list-save');
        await expect(save).toBeVisible();
        await expect(save).toContainText('6 people are saved in the table’s order.');
        await save.locator('[data-act="cancel"]').first().click();

        // The views' menu: after Delete, behind a separator.
        await page.locator('#table-container .tv-view-btn').first().click();
        await expect(tvItem(page, 'Save as list of people…')).toBeVisible();
        await page.keyboard.press('Escape');

        // Events: nothing to save, but ⋯ stays for Group by (spec 084 §10); Sources: nothing to offer, no ⋯.
        await page.locator('#table-container .tv-rowtype [data-rowtype="events"]').click();
        await more.click();
        await expect(page.locator('.tv-menu .tv-menu-label')).toHaveText(['Group by', 'Collapse all groups', 'Expand all groups']);
        await page.keyboard.press('Escape');
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(more).toBeHidden();
    });

    test('the search results: Results to a list › with all the results', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            const all = Object.values(window.Strom.DataManager.getData().persons).filter(p => p.lastName === 'Varnholm');
            window.Strom.UI.showSearchResultsModal(all, 'Varnholm');
        });
        const link = page.locator('#confirmation-modal .search-to-list');
        await expect(link).toHaveText('Results to a list ›');
        await link.click();
        await expect(page.locator('.tv-menu .tv-menu-label').first()).toHaveText('New list from the results (4)…');
        await tvItem(page, 'Letters to write').click();
        await expect(page.locator('.undo-toast', { hasText: '2 people added to “Letters to write”.' })).toBeVisible();
        await link.click();
        await tvItem(page, 'New list from the results').click();
        const save = page.locator('#person-list-save');
        await expect(save).toBeVisible();
        await expect(save.locator('#pln-name')).toHaveValue('Search: Varnholm');
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    });

    test('a read-only tree: no Add to list, no ⋯ in the Table, no link under the search results', async ({ page }) => {
        await family(page);
        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        await card(page, 'Quillon').click();
        await expect(page.locator('.context-menu:not(.context-submenu)')).toBeVisible();
        await expect(page.locator('.context-menu [data-menu="add-to-list"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            const all = Object.values(window.Strom.DataManager.getData().persons);
            window.Strom.UI.showSearchResultsModal(all, 'a');
        });
        await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
        await expect(page.locator('#confirmation-modal .search-to-list')).toHaveCount(0);
    });
});

test.describe('Add to list: German at 1440', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Table\'s bar with ⋯ and ⧉ stays one row', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await page.locator('#view-mode-table').click();
        await expect(row(page, 'p:q')).toBeVisible();
        const more = page.locator('#table-container .tv-more-menu-btn');
        await expect(more).toBeVisible();
        const bar = page.locator('#table-container .tv-bar-row1');
        expect(await bar.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        const tops = await bar.locator(':scope > *:not([hidden])').evaluateAll(els => els
            .filter(el => (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().width > 0)
            .map(el => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
        // One row: every control's middle on the same line.
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(8);
        await more.click();
        await expect(page.locator('.tv-menu .tv-menu-label')).toHaveText(['Gruppieren nach', 'Alle Gruppen einklappen', 'Alle Gruppen ausklappen', 'Als Personenliste speichern…']);
    });
});

test.describe('Add to list: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the person sheet\'s second page and the Table\'s ⋯ sheet', async ({ page }) => {
        await family(page);
        await card(page, 'Quillon').tap();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        await sheet.locator('[data-menu="add-to-list"]').tap();
        const sub = sheet.locator('.sheet-page-sub');
        await expect(sub).toBeVisible();
        await expect(sub.locator('.sheet-subhead-title')).toHaveText('Add to list');
        await expect(sub.locator('.bottom-sheet-hint')).toHaveText('Automatic lists fill themselves from their rule.');
        const toggle = sub.locator('[data-action^="list-toggle:"]');
        expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await toggle.tap();
        await expect(page.locator('.undo-toast', { hasText: 'Quillon Varnholm added to “Letters to write”.' })).toBeVisible();
        expect(await listIds(page, 'Letters to write')).toEqual(['c', 'y', 't', 'q']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        await openTable(page, true);
        await page.locator('#table-container .tv-more-menu-btn').tap();
        const more = page.locator('.bottom-sheet');
        // After Scope › (spec 084 §9) and Group by › (§10).
        await expect(more.locator('.bottom-sheet-item').nth(2)).toContainText('Save as list of people…');
        await more.locator('.bottom-sheet-item', { hasText: 'Save as list of people…' }).tap();
        await expect(page.locator('#person-list-save')).toBeVisible();
    });
});
