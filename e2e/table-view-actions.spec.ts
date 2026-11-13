import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The Table view's row actions (spec 073 §10): a click selects, ↑ ↓ move the
 * selection, Enter opens the person's page, Escape clears; the row's menu; a
 * double click edits and the saved row lights up, stays in place and, when
 * it no longer passes, dimmed with a note; ⌖ shows the person in the
 * diagram. On a phone a tap opens the row's sheet. A mouse only selects, on
 * a touch laptop and in a narrow window too: the row's menu is the right
 * button's (tester's report, 1113).
 */

const FAMILY: Record<string, SeedPerson> = {
    a: { firstName: 'Bertold', lastName: 'Vranoš', birthDate: '1851-02-03', deathDate: '1911-04-05', partners: ['b'] },
    b: { firstName: 'Zbyňka', lastName: 'Kořánková', gender: 'female', birthDate: '1856-08-09', deathDate: '1921-02-10', partners: ['a'] },
    c: { firstName: 'Lubor', lastName: 'Vranoš', birthDate: '1881-03-04', deathDate: '1951-03-05', parents: ['a', 'b'] },
    d: { firstName: 'Ermína', lastName: 'Vranošová', gender: 'female', birthDate: '1953-09-14', parents: ['c'] },
};

const row = (page: Page, key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);
const selected = (page: Page) => page.locator('#table-container .tv-body .tv-row[aria-selected="true"]');
const status = (page: Page) => page.locator('#table-container .tv-status-count');

async function cell(page: Page, key: string, colId: string) {
    const head = page.locator('#table-container .tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return page.locator(`#table-container .tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
}

async function openTable(page: Page, phone = false): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Vranoš', 'c');
    if (phone) {
        await page.locator('#bb-view-table').tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(status(page)).toHaveText('4 of 4 people');
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a click selects, ↑ ↓ move the selection, Enter opens the person, Escape clears; the row menu', async ({ page }) => {
        await openTable(page);
        const keys = await page.locator('#table-container .tv-body .tv-row').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key));
        await row(page, keys[0]!).locator('.tv-name').click();
        await expect(selected(page)).toHaveAttribute('data-key', keys[0]!);
        // The selected row carries its actions; no Edit is missing in a tree that can change.
        await expect(row(page, keys[0]!).locator('.tv-act')).toHaveCount(3);

        await page.keyboard.press('ArrowDown');
        await expect(selected(page)).toHaveAttribute('data-key', keys[1]!);
        await expect(row(page, keys[1]!).locator('.tv-name')).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(selected(page)).toHaveAttribute('data-key', keys[0]!);

        await page.keyboard.press('Enter');
        await expect(page.locator('#person-page-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-page-modal')).toBeHidden();
        // The diagram's focus and the view stay: the table is still on.
        await expect(page.locator('#table-container .tv-grid')).toBeVisible();

        await row(page, keys[0]!).locator('.tv-name').click();
        await page.keyboard.press('Escape');
        await expect(selected(page)).toHaveCount(0);

        // A right click: the row's menu, its row selected.
        await row(page, 'p:a').locator('.tv-name').click({ button: 'right' });
        const menu = page.locator('.tv-menu');
        await expect(menu).toHaveAttribute('aria-label', 'Actions: Bertold Vranoš');
        await expect(menu.locator('.tv-menu-label')).toHaveText(['Show in tree', 'Open person', 'Edit…']);
        await expect(menu.locator('.tv-menu-item[data-id="open"] .tv-menu-hint')).toHaveText('Enter');
        await expect(selected(page)).toHaveAttribute('data-key', 'p:a');
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
    });

    test('a double click edits; the saved row lights up and, no longer matching, stays dimmed with a note', async ({ page }) => {
        await openTable(page);
        await page.locator('#table-container .tv-search-q').fill('Ermína');
        await expect(status(page)).toHaveText('1 of 4 people');

        await row(page, 'p:d').locator('.tv-name').dblclick();
        const modal = page.locator('#person-modal');
        await expect(modal).toBeVisible();
        await modal.locator('#input-firstname').fill('Radmila');
        await modal.locator('#btn-save').click();
        await expect(modal).toBeHidden();

        // Lit for a moment, selected, kept although the search no longer finds it.
        const d = row(page, 'p:d');
        await expect(d).toHaveClass(/\bis-flash\b(?!-)/);
        await expect(d).toHaveClass(/is-stale/);
        await expect(d).toHaveAttribute('aria-selected', 'true');
        await expect(d.locator('.tv-stale-note')).toHaveText('no longer matches');
        await expect(status(page)).toHaveText('1 of 4 people');
        await expect(page.locator('.toast').last()).toContainText('Saved: Radmila Vranošová');
        await expect(d).not.toHaveClass(/\bis-flash\b(?!-)/, { timeout: 4000 });
        // The diagram did not move: the table is still on.
        await expect(page.locator('#tree-canvas')).toBeHidden();

        // The next change of the search: the row goes.
        await page.locator('#table-container .tv-search-q').fill('Radmila');
        await expect(d).not.toHaveClass(/is-stale/);
        await page.locator('#table-container .tv-search-q').fill('Ermína');
        await expect(status(page)).toHaveText('0 of 4 people');
    });

    test('⌖ shows the person in the family diagram', async ({ page }) => {
        await openTable(page);
        await row(page, 'p:a').locator('.tv-name').click();
        await row(page, 'p:a').locator('.tv-act[data-act="tree"]').click();
        await expect(page.locator('#table-container')).toBeHidden();
        await expect(page.locator('#tree-canvas .person-card.focused .name-text')).toHaveText(/Bertold/);
    });
});

test('under the pointer, the row\'s actions get their room: a long name ends in "…" before them', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, {
        ...FAMILY,
        c: { ...FAMILY.c, firstName: 'Lubor Maximilián Bořivoj', lastName: 'Vranoš z Lichtenburku' },
    }, 'Vranoš', 'a');
    await page.locator('#view-mode-table').click();
    await expect(status(page)).toHaveText('4 of 4 people');
    const geometry = (key: string) => row(page, key).locator('.tv-name').evaluate(cell => {
        const text = cell.querySelector('.tv-cell-text') as HTMLElement;
        const acts = cell.querySelector('.tv-acts') as HTMLElement;
        return {
            textRight: text.getBoundingClientRect().right,
            actsLeft: acts.getBoundingClientRect().left,
            cut: text.scrollWidth > text.clientWidth,
            acts: getComputedStyle(acts).display,
        };
    });
    // Not selected, under the pointer: the same room as the selected row's.
    await row(page, 'p:c').locator('.tv-name').hover();
    const hovered = await geometry('p:c');
    expect(hovered.acts).not.toBe('none');
    expect(hovered.cut).toBe(true);
    expect(hovered.textRight).toBeLessThanOrEqual(hovered.actsLeft);
    await row(page, 'p:c').locator('.tv-name').click();
    const chosen = await geometry('p:c');
    expect(chosen.textRight).toBeLessThanOrEqual(chosen.actsLeft);
    expect(Math.abs(chosen.textRight - hovered.textRight)).toBeLessThan(1);
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a tap opens the row\'s sheet: the actions and its unions', async ({ page }) => {
        await openTable(page, true);
        // No small icons on a phone.
        await expect(page.locator('#table-container .tv-act')).toHaveCount(0);
        await row(page, 'p:a').locator('.tv-name').tap();
        await expect(selected(page)).toHaveAttribute('data-key', 'p:a');
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Bertold Vranoš');
        await expect(sheet).toContainText('1851–1911');
        const items = sheet.locator('.bottom-sheet-item');
        await expect(items.locator('.bottom-sheet-label')).toHaveText(['Show in tree', 'Open person', 'Edit…', 'Union 1: Zbyňka Kořánková']);
        await expect(items.last().locator('.bottom-sheet-value')).toHaveText('Edit ›');
        const box = await items.first().boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);

        await items.filter({ hasText: 'Edit…' }).tap();
        await expect(page.locator('#person-modal')).toBeVisible();
    });
});

test.describe('touch laptop with a mouse (1280, pointer: coarse)', () => {
    test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });

    test('a mouse click only selects the row and the cell; a tap opens the row\'s sheet; the right button the row\'s menu', async ({ page }) => {
        await openTable(page);
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
        const sheet = page.locator('.bottom-sheet-menu');
        const date = await cell(page, 'p:a', 'bDate');
        await date.click();
        await expect(selected(page)).toHaveAttribute('data-key', 'p:a');
        await expect(date).toBeFocused();
        await expect(sheet).toHaveCount(0);
        await expect(page.locator('.tv-menu')).toHaveCount(0);
        // A second click elsewhere moves the selection, still nothing pops up.
        await row(page, 'p:c').locator('.tv-name').click();
        await expect(selected(page)).toHaveAttribute('data-key', 'p:c');
        await expect(sheet).toHaveCount(0);

        // A completeness cell clicked by a mouse: its title, no bubble.
        const grid = page.locator('#table-container .tv-grid');
        await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await (await cell(page, 'p:d', 'comp')).click();
        await expect(selected(page)).toHaveAttribute('data-key', 'p:d');
        await expect(page.locator('.tv-bubble')).toHaveCount(0);
        await grid.evaluate(el => { el.scrollLeft = 0; });

        // A finger: the row's sheet as before.
        await row(page, 'p:a').locator('.tv-name').tap();
        await expect(selected(page)).toHaveAttribute('data-key', 'p:a');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Bertold Vranoš');
        await page.locator('.bottom-sheet-overlay').tap({ position: { x: 20, y: 20 } });
        await expect(sheet).toBeHidden();

        // The right button: the row's menu.
        await row(page, 'p:b').locator('.tv-name').click({ button: 'right' });
        const menu = page.locator('.tv-menu');
        await expect(menu).toHaveAttribute('aria-label', 'Actions: Zbyňka Kořánková');
        await expect(selected(page)).toHaveAttribute('data-key', 'p:b');
    });
});

test.describe('narrow window with a mouse (390)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a mouse click only selects; the right button opens the row\'s sheet', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
        await openApp(page);
        await seedTree(page, FAMILY, 'Vranoš', 'c');
        await page.locator('#bb-view-table').click();
        await expect(status(page)).toHaveText('4 of 4 people');
        const sheet = page.locator('.bottom-sheet-menu');
        await row(page, 'p:a').locator('.tv-name').click();
        await expect(selected(page)).toHaveAttribute('data-key', 'p:a');
        await expect(sheet).toHaveCount(0);
        await row(page, 'p:a').locator('.tv-name').click({ button: 'right' });
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Bertold Vranoš');
    });
});
