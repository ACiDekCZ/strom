/**
 * The dialog Lists of people (spec 084 §2, §15, §16): the entry in ⋯ and in
 * More, the overview and the chosen list, renaming in place (a taken name is
 * not saved), Duplicate, Delete with Undo, removing a person, the sort
 * choice, the empty states, a list of more than 200 people, a read-only
 * tree, and on a phone the overview and the list taking turns. Invented
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
        await expect(d.locator('.pl-row').nth(1).locator('.pl-row-meta')).toHaveText('automatic · Ancestors of Quillon Varnholm, all generations');
        await expect(d.locator('.pl-row').nth(1).locator('.pl-row-count')).toHaveText('5');

        // The first one is chosen: its empty state.
        await expect(d.locator('.pl-row').first()).toHaveAttribute('aria-selected', 'true');
        await expect(d.locator('.pl-empty-text')).toHaveText('Nothing yet – the date added is recorded from version 3.30.');

        // An automatic list: the rule, the note, generations as the people's meta, no ×.
        await d.locator('.pl-row', { hasText: 'Ancestors – Quillon' }).click();
        await expect(d.locator('.pl-badge')).toHaveText('Automatic list');
        await expect(d.locator('.pl-rule')).toContainText('Based on Ancestors of Quillon Varnholm, all generations');
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

        // ⋯ of the list: Open in Table · Rename · Duplicate · Delete.
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu .pl-menu-item')).toHaveText(['Open in Table', 'Rename', 'Duplicate', 'Delete']);
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

        // Every list deleted: what a list is for, and New list… makes one with its name open.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            for (const l of dm.getPersonLists()) dm.deletePersonList(l.id);
            window.Strom.UI.showPersonLists();
        });
        await expect(d.locator('.pl-none-title')).toHaveText('The tree has no list of people yet.');
        await expect(d.locator('.pl-head .pl-new')).toHaveCount(0);
        await d.locator('.pl-none .pl-new').click();
        await expect(d.locator('.pl-name-input')).toBeFocused();
        await expect(d.locator('.pl-name-input')).toHaveValue('New list of people');
        await expect(d.locator('.pl-empty-text')).toHaveText('The list has no people yet.');
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
        await expect(sheet.locator('.bottom-sheet-item')).toHaveText(['Open in Table', 'Rename', 'Duplicate', 'Delete']);
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
});
