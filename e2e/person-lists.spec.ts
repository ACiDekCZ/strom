/**
 * The dialog Lists of people (spec 084 §2, §15, §16): the entry in ⋯ and in
 * More, the overview and the chosen list, renaming in place (a taken name is
 * not saved), Duplicate, Delete with Undo, removing a person, the sort
 * choice, the empty states, a list of more than 200 people, a read-only
 * tree, and on a phone the overview and the list taking turns; the manual
 * order (the handle, Alt+↑/↓, Move up / down in a person's ⋯ on a phone),
 * Freeze, a rule that finds nothing any more and the checklist. Invented
 * names only; the clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree } from './helpers';

const NOW = new Date('2026-11-16T10:30:00Z');

async function family(page: Page): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    await seedTree(page, {
        q: { firstName: 'Quillon', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1950' },
        t: { firstName: 'Tamsel', lastName: 'Varnholm', parents: ['c', 'y'], partners: ['i'], birthDate: '1921', birthPlace: 'Hollowmere' },
        i: { firstName: 'Ilvara', lastName: 'Brannoc', gender: 'female', partners: ['t'], birthDate: '1925' },
        c: { firstName: 'Corvin', lastName: 'Varnholm', partners: ['y'], birthDate: '1890' },
        y: { firstName: 'Yselda', lastName: 'Fennick', gender: 'female', partners: ['c'], birthDate: '1894' },
        w: { firstName: 'Wendrel', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1953' },
    }, 'Varnholm', 'q');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['t', 'c', 'y'] as never[], sort: 'old' });
        dm.createPersonList({ name: 'Ancestors – Quillon', dynamic: true, rule: { kind: 'ancestors', personId: 'q' as never } });
    });
}

const dialog = (page: Page) => page.locator('#person-lists-modal');
const rowNames = (page: Page) => dialog(page).locator('.pl-row .pl-row-name');
const people = (page: Page) => dialog(page).locator('.pl-person .pl-pname');

async function openFromMenu(page: Page): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-lists-row').click();
    await expect(dialog(page)).toBeVisible();
}

test.describe('Lists of people: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the overview and the chosen list; rename, duplicate, delete with Undo, remove a person, sort', async ({ page }) => {
        await family(page);
        await openFromMenu(page);
        const d = dialog(page);
        await expect(d.locator('.pl-title')).toHaveText('Lists of people');
        await expect(d.locator('.pl-new')).toBeVisible();
        // By name: the ready-made list is there too (not stored, nothing added since 3.30 here).
        await expect(rowNames(page)).toHaveText(['Added in the last 30 days', 'Ancestors – Quillon', 'Letters to write']);
        await expect(d.locator('.pl-row').nth(1).locator('.pl-row-meta')).toHaveText('automatic · Ancestors: Quillon Varnholm, all generations');
        await expect(d.locator('.pl-row').nth(1).locator('.pl-row-count')).toHaveText('5');

        // The first one is chosen: its empty state.
        await expect(d.locator('.pl-row').first()).toHaveAttribute('aria-selected', 'true');
        await expect(d.locator('.pl-empty-text')).toHaveText('Nothing yet – the date added is recorded from version 3.30.');

        // An automatic list: the rule, the note, generations as the people's meta, no ×.
        await d.locator('.pl-row', { hasText: 'Ancestors – Quillon' }).click();
        await expect(d.locator('.pl-badge')).toHaveText('Automatic list');
        await expect(d.locator('.pl-rule')).toContainText('Based on Ancestors: Quillon Varnholm, all generations');
        await expect(d.locator('.pl-note')).toHaveText('The rule decides the content – nothing is added or removed by hand.');
        await expect(d.locator('.pl-person .pl-meta')).toHaveText(['person of the rule', 'parents', 'parents', 'grandparents', 'grandparents']);
        await expect(d.locator('.pl-x')).toHaveCount(0);
        await d.locator('.pl-sort').click();
        await expect(d.locator('.pl-menu [data-sort="manual"]')).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');
        await expect(d.locator('.pl-menu')).toHaveCount(0);
        await expect(d).toBeVisible();

        // A fixed list: tiles, people oldest first, the sort choice.
        await d.locator('.pl-row', { hasText: 'Letters to write' }).click();
        await expect(d.locator('.pl-name')).toHaveText('Letters to write');
        await expect(d.locator('.pl-tile').first().locator('.pl-tile-v')).toHaveText('3');
        await expect(d.locator('.pl-tile').nth(1).locator('.pl-tile-v')).toHaveText('1890–1921');
        await expect(d.locator('.pl-tile-link')).toHaveText('3 without citation ›');
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Yselda Fennick', 'Tamsel Varnholm']);
        await expect(d.locator('.pl-person').nth(2).locator('.pl-meta')).toHaveText('Hollowmere');
        await d.locator('.pl-sort').click();
        await d.locator('.pl-menu [data-sort="name"]').click();
        await expect(d.locator('.pl-sort')).toContainText('Sort: Alphabetically');
        await expect(people(page)).toHaveText(['Yselda Fennick', 'Corvin Varnholm', 'Tamsel Varnholm']);

        // Rename in place: a taken name says so and is not saved; Enter saves a free one.
        await d.locator('.pl-pencil').click();
        const input = d.locator('.pl-name-input');
        await expect(input).toBeFocused();
        await input.fill('Ancestors – Quillon');
        await expect(d.locator('.pl-name-err')).toHaveText('A list with this name exists. Suggested: “Ancestors – Quillon (2)”.');
        await input.press('Enter');
        await expect(input).toBeVisible();
        await input.fill('Letters to the archive');
        await input.press('Enter');
        await expect(d.locator('.pl-name')).toHaveText('Letters to the archive');
        await expect(rowNames(page)).toHaveText(['Added in the last 30 days', 'Ancestors – Quillon', 'Letters to the archive']);
        // Escape gives the old name back.
        await d.locator('.pl-name').click();
        await d.locator('.pl-name-input').fill('Something else');
        await page.keyboard.press('Escape');
        await expect(d.locator('.pl-name')).toHaveText('Letters to the archive');
        await expect(d).toBeVisible();

        // Remove a person with ×.
        await d.locator('.pl-person', { hasText: 'Tamsel' }).hover();
        await d.locator('.pl-person', { hasText: 'Tamsel' }).locator('.pl-x').click();
        await expect(people(page)).toHaveText(['Yselda Fennick', 'Corvin Varnholm']);

        // ⋯ of the list: Open in Table · Rename · Duplicate · Tick off done · Delete.
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu .pl-menu-item')).toHaveText(['Open in Table', 'On the map', 'Rename', 'Duplicate', 'Tick off done', 'Export›', 'Delete']);
        await d.locator('.pl-menu [data-run="dup"]').click();
        await expect(rowNames(page)).toHaveText(['Added in the last 30 days', 'Ancestors – Quillon', 'Letters to the archive', 'Letters to the archive (2)']);
        await expect(d.locator('.pl-row', { hasText: 'Letters to the archive (2)' })).toHaveAttribute('aria-selected', 'true');

        // Delete from the overview's ⋯: gone at once, Undo brings it back.
        await d.locator('.pl-row', { hasText: 'Letters to the archive (2)' }).locator('.pl-dots').click();
        await d.locator('.pl-menu [data-run="delete"]').click();
        await expect(rowNames(page)).toHaveText(['Added in the last 30 days', 'Ancestors – Quillon', 'Letters to the archive']);
        const toast = page.locator('.undo-toast', { hasText: 'List “Letters to the archive (2)” deleted.' });
        await expect(toast).toBeVisible();
        await toast.locator('.undo-toast-btn').click();
        await expect(rowNames(page)).toHaveText(['Added in the last 30 days', 'Ancestors – Quillon', 'Letters to the archive', 'Letters to the archive (2)']);

        // The keyboard: ↑/↓ choose, Delete deletes the focused list, Escape closes.
        await d.locator('.pl-row', { hasText: 'Ancestors – Quillon' }).click();
        await page.keyboard.press('ArrowDown');
        await expect(d.locator('.pl-row', { hasText: 'Letters to the archive' }).first()).toHaveAttribute('aria-selected', 'true');
        await expect(d.locator('.pl-row[aria-selected="true"]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
    });

    test('a list of more than 200 people shows the first 200 and leads to the Table; no list at all: New list…', async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await openApp(page);
        const people: Record<string, { firstName: string; lastName: string; birthDate: string }> = {};
        for (let i = 0; i < 230; i++) people[`p${i}`] = { firstName: `Corvin${i}`, lastName: 'Varnholm', birthDate: String(1700 + i) };
        await seedTree(page, people, 'Varnholm', 'p0');
        await page.evaluate(() => {
            const ids = Object.keys(window.Strom.DataManager.getData().persons);
            window.Strom.DataManager.createPersonList({ name: 'Everyone', dynamic: false, personIds: ids as never[], sort: 'old' });
            window.Strom.UI.showPersonLists();
        });
        const d = dialog(page);
        await d.locator('.pl-row', { hasText: 'Everyone' }).click();
        await expect(d.locator('.pl-person')).toHaveCount(200);
        await expect(d.locator('.pl-foot-note')).toHaveText('The first 200 of 230 people.');
        await d.locator('[data-key="open-table-foot"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();

        // Every list deleted: what a list is for, and New list… opens the dialog New list; an empty list says so.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            for (const l of dm.getPersonLists()) dm.deletePersonList(l.id);
            window.Strom.UI.showPersonLists();
        });
        await expect(d.locator('.pl-none-title')).toHaveText('The tree has no list of people yet.');
        await expect(d.locator('.pl-head .pl-new')).toHaveCount(0);
        await d.locator('.pl-none .pl-new').click();
        const form = page.locator('#person-list-new');
        await expect(form.locator('#pln-name')).toBeFocused();
        await form.locator('#pln-name').fill('To visit');
        await form.locator('[data-act="create"]').click();
        await expect(form).toHaveCount(0);
        await expect(d.locator('.pl-name')).toHaveText('To visit');
        await expect(d.locator('.pl-empty-text')).toHaveText('The list has no people yet.');
    });

    test('the manual order: the handle, Escape, Alt+↑/↓, a person\'s ⋯; another order keeps it', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = dialog(page);
        await d.locator('.pl-row', { hasText: 'Letters to write' }).click();
        // Oldest first: no handle, no row takes the keyboard.
        await expect(d.locator('.pl-handle')).toHaveCount(0);
        await d.locator('.pl-sort').click();
        await d.locator('.pl-menu [data-sort="manual"]').click();
        await expect(d.locator('.pl-sort')).toContainText('Sort: Manual');
        await expect(people(page)).toHaveText(['Tamsel Varnholm', 'Corvin Varnholm', 'Yselda Fennick']);
        await expect(d.locator('.pl-handle')).toHaveCount(3);
        await expect(d.locator('.pl-handle').first()).toHaveAttribute('aria-label', 'Move – drag or Alt+↑/↓');

        // Drag Yselda above Tamsel: the row lifts, a line shows where it lands.
        const drag = async (from: string, to: string, finish: 'drop' | 'escape'): Promise<void> => {
            // A redraw queued by the last change lands first (it replaces the rows).
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            const h = (await d.locator('.pl-person', { hasText: from }).locator('.pl-handle').boundingBox())!;
            const target = (await d.locator('.pl-person', { hasText: to }).boundingBox())!;
            await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
            await page.mouse.down();
            await page.mouse.move(h.x + h.width / 2, target.y + 6, { steps: 8 });
            await expect(d.locator('.pl-person.is-lifted')).toHaveCount(1);
            await expect(d.locator('.pl-drop')).toBeVisible();
            if (finish === 'escape') await page.keyboard.press('Escape');
            await page.mouse.up();
            await expect(d.locator('.pl-drop')).toHaveCount(0);
        };
        await drag('Yselda', 'Tamsel', 'drop');
        await expect(people(page)).toHaveText(['Yselda Fennick', 'Tamsel Varnholm', 'Corvin Varnholm']);
        await expect(d.locator('.pl-person .pl-num')).toHaveText(['1', '2', '3']);
        await expect(page.locator('#person-lists-modal .pl-live')).toHaveText('Moved: Yselda Fennick is at position 1 of 3.');
        // Escape puts the row back and keeps the dialog.
        await drag('Corvin', 'Yselda', 'escape');
        await expect(d).toBeVisible();
        await expect(people(page)).toHaveText(['Yselda Fennick', 'Tamsel Varnholm', 'Corvin Varnholm']);

        // The keyboard: a focused row moves with Alt+↓ and keeps the focus.
        await d.locator('.pl-person', { hasText: 'Yselda' }).locator('.pl-pname').click();
        await expect(d.locator('.pl-person', { hasText: 'Yselda' })).toBeFocused();
        await page.keyboard.press('Alt+ArrowDown');
        await expect(people(page)).toHaveText(['Tamsel Varnholm', 'Yselda Fennick', 'Corvin Varnholm']);
        await expect(d.locator('.pl-person', { hasText: 'Yselda' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(d.locator('.pl-person', { hasText: 'Corvin' })).toBeFocused();
        await page.keyboard.press('Alt+ArrowUp');
        await expect(people(page)).toHaveText(['Tamsel Varnholm', 'Corvin Varnholm', 'Yselda Fennick']);

        // A person's ⋯ (shown on hover): Move up / Move down / Remove; the first cannot go up.
        await d.locator('.pl-person', { hasText: 'Tamsel' }).hover();
        await d.locator('.pl-person', { hasText: 'Tamsel' }).locator('.pl-person-dots').click();
        await expect(d.locator('.pl-menu .pl-menu-label')).toHaveText(['Move up', 'Move down', 'Remove from the list']);
        await expect(d.locator('.pl-menu [data-run="up"]')).toHaveAttribute('aria-disabled', 'true');
        await d.locator('.pl-menu [data-run="down"]').click();
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Tamsel Varnholm', 'Yselda Fennick']);

        // Another order leaves the manual one; back to Manual brings it back.
        await d.locator('.pl-sort').click();
        await d.locator('.pl-menu [data-sort="name"]').click();
        await expect(people(page)).toHaveText(['Yselda Fennick', 'Corvin Varnholm', 'Tamsel Varnholm']);
        await expect(d.locator('.pl-handle')).toHaveCount(0);
        await d.locator('.pl-sort').click();
        await d.locator('.pl-menu [data-sort="manual"]').click();
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Tamsel Varnholm', 'Yselda Fennick']);

        // Every change is one undo step: back over the two sorts and the last move.
        const order = await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            for (let i = 0; i < 3; i++) dm.undo();
            return dm.getPersonLists().find(l => l.name === 'Letters to write')!.personIds;
        });
        expect(order).toEqual(['t', 'c', 'y']);
    });

    test('an automatic list: Freeze with Undo; a rule that finds nothing any more', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = dialog(page);
        await d.locator('.pl-row', { hasText: 'Ancestors – Quillon' }).click();
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu .pl-menu-item')).toHaveText(['Open in Table', 'On the map', 'Rename', 'Duplicate', 'FreezeBecomes fixed with the people it has now', 'Export›', 'Delete']);
        await d.locator('.pl-menu [data-run="freeze"]').click();
        await expect(d.locator('.pl-badge')).toHaveText('Fixed list');
        await expect(d.locator('.pl-rule')).toContainText('Created from Ancestors: Quillon Varnholm, all generations');
        await expect(d.locator('.pl-note')).toHaveCount(0);
        await expect(people(page)).toHaveCount(5);
        await expect(d.locator('.pl-x')).toHaveCount(5);
        const toast = page.locator('.undo-toast', { hasText: 'List frozen – it is fixed now.' });
        await expect(toast).toBeVisible();
        await toast.locator('.undo-toast-btn').click();
        await expect(d.locator('.pl-badge')).toHaveText('Automatic list');
        await expect(d.locator('.pl-x')).toHaveCount(0);

        // The person of the rule deleted: the list stays, empty, with the amber note.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.createPersonList({ name: 'Descendants – Wendrel', dynamic: true, rule: { kind: 'descendants', personId: 'w' as never } });
            dm.deletePerson('w' as never);
        });
        await d.locator('.pl-row', { hasText: 'Descendants – Wendrel' }).click();
        await expect(d.locator('.pl-note--warn')).toContainText('The rule finds nothing any more: Wendrel Varnholm was deleted.');
        await expect(d.locator('.pl-empty-text')).toHaveText('The list has no people yet.');
        await d.locator('.pl-note--warn [data-act="delete"]').click();
        await expect(d.locator('.pl-row', { hasText: 'Descendants – Wendrel' })).toHaveCount(0);
    });

    test('a checklist: Tick off done, the boxes, All / Left / Done; off keeps what is done', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = dialog(page);
        const row = d.locator('.pl-row', { hasText: 'Letters to write' });
        await row.click();
        await expect(d.locator('.pl-check')).toHaveCount(0);
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu [data-run="work"]')).toHaveAttribute('aria-checked', 'false');
        await d.locator('.pl-menu [data-run="work"]').click();
        await expect(d.locator('.pl-badge')).toHaveText('Checklist');
        await expect(row.locator('.pl-row-meta')).toHaveText('checklist · 3 of 3 left');
        await expect(d.locator('.pl-filter-opt')).toHaveText(['All', 'Left 3', 'Done 0']);
        await expect(d.locator('.pl-check')).toHaveCount(3);
        await expect(d.locator('.pl-tile').first()).toContainText('3 / 3');

        // Tick Corvin off with a click, Yselda with the space bar.
        await d.locator('.pl-person', { hasText: 'Corvin' }).locator('.pl-check').click();
        await expect(d.locator('.pl-person', { hasText: 'Corvin' }).locator('.pl-check')).toHaveAttribute('aria-checked', 'true');
        await expect(d.locator('.pl-person', { hasText: 'Corvin' })).toHaveClass(/is-done/);
        await d.locator('.pl-person', { hasText: 'Yselda' }).locator('.pl-check').focus();
        await page.keyboard.press('Space');
        await expect(d.locator('.pl-person', { hasText: 'Yselda' }).locator('.pl-check')).toHaveAttribute('aria-checked', 'true');
        await expect(d.locator('.pl-filter-opt')).toHaveText(['All', 'Left 1', 'Done 2']);
        await expect(row.locator('.pl-row-meta')).toHaveText('checklist · 1 of 3 left');
        await expect(d.locator('.pl-tile').first()).toContainText('1 / 3');

        // Left and Done show their people; the position stays the one in the whole list.
        await d.locator('.pl-filter-opt[data-filter="left"]').click();
        await expect(people(page)).toHaveText(['Tamsel Varnholm']);
        await expect(d.locator('.pl-person .pl-num')).toHaveText(['3']);
        await d.locator('.pl-filter-opt[data-filter="done"]').click();
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Yselda Fennick']);
        // Ticked back under Done: the row goes, the keyboard stays on a box.
        await d.locator('.pl-person', { hasText: 'Corvin' }).locator('.pl-check').click();
        await expect(people(page)).toHaveText(['Yselda Fennick']);
        await expect(d.locator('.pl-person', { hasText: 'Yselda' }).locator('.pl-check')).toBeFocused();

        // Off: no boxes; on again: what was done is back.
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu [data-run="work"]')).toHaveAttribute('aria-checked', 'true');
        await d.locator('.pl-menu [data-run="work"]').click();
        await expect(d.locator('.pl-check, .pl-filter')).toHaveCount(0);
        await expect(people(page)).toHaveCount(3);
        await expect(d.locator('.pl-badge')).toHaveText('Fixed list');
        await d.locator('.pl-more').click();
        await d.locator('.pl-menu [data-run="work"]').click();
        await expect(d.locator('.pl-filter-opt')).toHaveText(['All', 'Left 2', 'Done 1']);
        await expect(d.locator('.pl-filter-opt[data-filter="all"]')).toHaveAttribute('aria-pressed', 'true');

        // Read only: the done people stay struck through, no boxes, no handle.
        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        await page.evaluate(() => { window.Strom.UI.closePersonLists(); window.Strom.UI.showPersonLists(); });
        await d.locator('.pl-row', { hasText: 'Letters to write' }).click();
        await expect(d.locator('.pl-filter-opt')).toHaveText(['All', 'Left 2', 'Done 1']);
        await expect(d.locator('.pl-check, .pl-handle, .pl-person-dots')).toHaveCount(0);
        await expect(d.locator('.pl-person.is-done')).toHaveCount(1);
    });

    test('a read-only tree: the badge, and no way to change a list', async ({ page }) => {
        await family(page);
        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = dialog(page);
        await expect(d.locator('.pl-ro')).toHaveText('Read only');
        await d.locator('.pl-row', { hasText: 'Letters to write' }).click();
        await expect(people(page)).toHaveCount(3);
        await expect(d.locator('.pl-new, .pl-dots, .pl-more, .pl-pencil, .pl-x, .pl-link[data-act="fill"]')).toHaveCount(0);
        await d.locator('.pl-name').click();
        await expect(d.locator('.pl-name-input')).toHaveCount(0);
        await d.locator('.pl-row', { hasText: 'Letters to write' }).press('Delete');
        await expect(rowNames(page)).toHaveCount(3);
    });
});

test.describe('Lists of people: a tablet', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false });

    test('the manual order with a finger: a 44 px handle, ⋯ always shown', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const l = dm.getPersonLists().find(x => x.name === 'Letters to write')!;
            dm.setPersonListSort(l.id, 'manual');
            window.Strom.UI.showPersonLists({ listId: l.id });
        });
        const d = dialog(page);
        await expect(people(page)).toHaveText(['Tamsel Varnholm', 'Corvin Varnholm', 'Yselda Fennick']);
        const h = (await d.locator('.pl-person', { hasText: 'Yselda' }).locator('.pl-handle').boundingBox())!;
        expect(h.width).toBeGreaterThanOrEqual(44);
        expect(h.height).toBeGreaterThanOrEqual(44);
        await expect(d.locator('.pl-person', { hasText: 'Tamsel' }).locator('.pl-person-dots')).toBeVisible();

        // A finger drags Yselda above Tamsel.
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const target = (await d.locator('.pl-person', { hasText: 'Tamsel' }).boundingBox())!;
        const cdp = await page.context().newCDPSession(page);
        const x = h.x + h.width / 2;
        let y = h.y + h.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 0; i < 8; i++) {
            y += (target.y + 6 - (h.y + h.height / 2)) / 8;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        }
        await expect(d.locator('.pl-person.is-lifted')).toHaveCount(1);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(people(page)).toHaveText(['Yselda Fennick', 'Tamsel Varnholm', 'Corvin Varnholm']);
    });
});

test.describe('Lists of people: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('More › Lists of people: the overview, then the list with ‹ back; ⋯ is a sheet', async ({ page }) => {
        await family(page);
        await page.locator('#bb-view-more').tap();
        await page.locator('#sheet-lists').tap();
        const d = dialog(page);
        await expect(d).toBeVisible();
        const box = (await d.locator('.pl-modal').boundingBox())!;
        expect(box.width).toBe(390);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        await expect(d.locator('.pl-detail')).toBeHidden();
        await expect(d.locator('.pl-tools .pl-new')).toBeVisible();
        await expect(d.locator('.pl-row[aria-selected="true"]')).toHaveCount(0);

        await d.locator('.pl-row', { hasText: 'Letters to write' }).tap();
        await expect(d.locator('.pl-side')).toBeHidden();
        await expect(d.locator('.pl-title')).toHaveText('Letters to write');
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Yselda Fennick', 'Tamsel Varnholm']);
        await expect(d.locator('.pl-meta').first()).toBeHidden();
        // The name stands in the head; Rename is in ⋯.
        await expect(d.locator('.pl-name, .pl-pencil')).toHaveCount(0);
        await expect(d.locator('.pl-x')).toHaveCount(0);
        for (const el of await d.locator('.pl-back, .pl-close, .pl-more, .pl-person-dots').all()) {
            const b = (await el.boundingBox())!;
            expect(b.height).toBeGreaterThanOrEqual(40);
        }
        // The tiles wrap three to a row.
        const tiles = await d.locator('.pl-tile').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tiles).size).toBe(2);

        // A person's ⋯: Remove from the list.
        await d.locator('.pl-person', { hasText: 'Tamsel' }).locator('.pl-person-dots').tap();
        await page.locator('#pl-sheet-remove').tap();
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Yselda Fennick']);

        // The list's ⋯ is a sheet from below.
        await d.locator('.pl-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet.locator('.bottom-sheet-item')).toHaveText(['Open in Table', 'On the map', 'Rename', 'Duplicate', 'Tick off done', 'Export›', 'Delete']);
        await page.locator('#pl-sheet-rename').tap();
        const input = d.locator('.pl-name-input');
        await expect(input).toBeFocused();
        await input.fill('Letters sent');
        await input.press('Enter');
        await expect(d.locator('.pl-title')).toHaveText('Letters sent');
        await expect(input).toHaveCount(0);
        await d.locator('.pl-more').tap();
        await page.locator('#pl-sheet-delete').tap();
        await expect(d.locator('.pl-side')).toBeVisible();
        await expect(rowNames(page)).toHaveText(['Added in the last 30 days', 'Ancestors – Quillon']);

        // ‹ back to the overview.
        await d.locator('.pl-row', { hasText: 'Ancestors – Quillon' }).tap();
        await d.locator('.pl-back').tap();
        await expect(d.locator('.pl-side')).toBeVisible();
        await expect(d.locator('.pl-title')).toHaveText('Lists of people');
        await d.locator('.pl-close').tap();
        await expect(dialog(page)).toHaveCount(0);
    });

    test('the manual order on a phone: no handle, Move up / down in a person\'s ⋯; the checklist\'s boxes', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const l = dm.getPersonLists().find(x => x.name === 'Letters to write')!;
            dm.setPersonListSort(l.id, 'manual');
            window.Strom.UI.showPersonLists({ listId: l.id });
        });
        const d = dialog(page);
        await expect(people(page)).toHaveText(['Tamsel Varnholm', 'Corvin Varnholm', 'Yselda Fennick']);
        await expect(d.locator('.pl-handle')).toHaveCount(0);
        const sheet = page.locator('.bottom-sheet-menu');

        // The first one: Move down and Remove (no Move up).
        await d.locator('.pl-person', { hasText: 'Tamsel' }).locator('.pl-person-dots').tap();
        await expect(sheet.locator('.bottom-sheet-item')).toHaveText(['↓Move down', '×Remove from the list']);
        await page.locator('#pl-sheet-down').tap();
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Tamsel Varnholm', 'Yselda Fennick']);
        // The last one: Move up.
        await d.locator('.pl-person', { hasText: 'Yselda' }).locator('.pl-person-dots').tap();
        await expect(sheet.locator('.bottom-sheet-item')).toHaveText(['↑Move up', '×Remove from the list']);
        await page.locator('#pl-sheet-up').tap();
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Yselda Fennick', 'Tamsel Varnholm']);

        // A checklist on a phone: the boxes take a finger, the segment fits.
        await d.locator('.pl-more').tap();
        await page.locator('#pl-sheet-work').tap();
        await expect(d.locator('.pl-check')).toHaveCount(3);
        const chk = (await d.locator('.pl-check').first().boundingBox())!;
        expect(chk.height).toBeGreaterThanOrEqual(40);
        await d.locator('.pl-person', { hasText: 'Tamsel' }).locator('.pl-check').tap();
        await expect(d.locator('.pl-filter-opt')).toHaveText(['All', 'Left 2', 'Done 1']);
        await d.locator('.pl-filter-opt[data-filter="left"]').tap();
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Yselda Fennick']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        const seg = (await d.locator('.pl-filter').boundingBox())!;
        expect(seg.x + seg.width).toBeLessThanOrEqual(390);
    });
});


test.describe('Lists of people: the tiles of a checklist', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('six tiles side by side cut no label ("s vyprávěním" whole, on a second line if need be)', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            window.Strom.DataManager.createPersonList({ name: 'Letters to send', dynamic: false, personIds: ['t', 'c', 'y'] as never[], checklist: true });
            window.Strom.UI.setLanguage('cs' as never);
        });
        await openFromMenu(page);
        const d = dialog(page);
        await d.locator('.pl-row', { hasText: 'Letters to send' }).click();
        await expect(d.locator('.pl-tiles--6 .pl-tile')).toHaveCount(6);
        await expect(d.locator('.pl-tile-k').last()).toHaveText('s vyprávěním');
        const cut = await d.locator('.pl-tile-k, .pl-tile-v').evaluateAll(els => els
            .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
        expect(cut).toEqual([]);
    });
});
