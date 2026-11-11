import { test, expect, Page } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * The Table view's cell edited in place (T54 F8): a double click, F2 or
 * Enter opens a field over a cell that stands for one fact (a date, a place,
 * a surname, an occupation, a wedding); Enter saves, Escape cancels, Tab
 * saves and goes to the next such cell of the row, a click elsewhere saves;
 * a date is read as the person dialog reads it, one that cannot be read keeps
 * the field with its error; a save is one undo step, keeps the fact's
 * citations and the event's other fields, lights the row and says "Saved:
 * {name}"; a read-only tree and a phone have no field; any other cell's
 * double click still opens Edit….
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    v: person('v', 'Bořivoj', 'Vrtišek', {
        birthDate: '1850-03-01', birthPlace: 'Lopuchov', birthSourceIds: ['s1'], partnerships: ['u1'], childIds: ['c'],
        events: [{ id: 'vb', type: 'baptism', date: '1850-03-02', place: 'Lopuchov', note: 'Godfather a miller', sourceIds: ['s1'] }],
    }),
    k: person('k', 'Kunhuta', 'Hrnčíříková', { gender: 'female', birthDate: '1852-04-05', partnerships: ['u1'], childIds: ['c'] }),
    c: person('c', 'Celestýn', 'Vrtišek', { birthDate: '1875-06-07', parentIds: ['v', 'k'] }),
};
const PARTNERSHIPS = {
    u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: ['c'], status: 'married', startDate: '1874-02-12', startPlace: 'Klenovice' },
};
const SOURCES = { s1: { id: 's1', title: 'Parish register Lopuchov', reference: 'fol. 3' } };

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const row = (page: Page, key: string) => tv(page, `.tv-body .tv-row[data-key="${key}"]`);
const editor = (page: Page) => tv(page, '.tv-editor-input');
const editorError = (page: Page) => tv(page, '.tv-editor-error');
const status = (page: Page) => tv(page, '.tv-status-count');
const personOf = (page: Page, id: string) => page.evaluate((pid) => window.Strom.DataManager.getPerson(pid as never), id);

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return tv(page, `.tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
}

async function openTable(page: Page, phone = false): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await page.evaluate(async ({ persons, partnerships, sources }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources } as never, 'Vrtišek');
        await window.Strom.TreeRenderer.setFocus('c' as never);
    }, { persons: PERSONS, partnerships: PARTNERSHIPS, sources: SOURCES });
    await expect(card(page, 'Celestýn')).toBeVisible();
    if (phone) {
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(status(page)).toHaveText('3 of 3 people');
}

/** Switch columns on in the Columns panel by their names. */
async function showColumns(page: Page, names: string[]): Promise<void> {
    await tv(page, '.tv-cols-btn').click();
    const panel = page.getByRole('dialog', { name: 'Columns' });
    await expect(panel).toBeVisible();
    for (const name of names) {
        await page.locator('.tv-cp-q').fill(name);
        await panel.getByRole('checkbox', { name, exact: true }).check();
    }
    await page.locator('.tv-cp-q').fill('');
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel).toHaveCount(0);
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a date and a place edited in the cell: Enter saves, the row lit, "Saved: {name}", one undo step each', async ({ page }) => {
        await openTable(page);
        const date = await cell(page, 'p:c', 'bDate');
        await expect(date).toHaveClass(/is-editable/);
        expect(await date.evaluate(e => getComputedStyle(e).cursor)).toBe('text');
        // The name, a computed cell: not edited in place.
        await expect(row(page, 'p:c').locator('.tv-name')).not.toHaveClass(/is-editable/);
        await expect(await cell(page, 'p:c', 'comp')).not.toHaveClass(/is-editable/);

        await date.dblclick();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page)).toBeFocused();
        await expect(editor(page)).toHaveValue('1875-06-07');
        await expect(editor(page)).toHaveAttribute('aria-label', 'Edit: Birth date');
        // The field covers its cell.
        const [eb, cb] = [await editor(page).boundingBox(), await date.boundingBox()];
        expect(Math.abs(eb!.x - cb!.x)).toBeLessThan(2);
        expect(Math.abs(eb!.y - cb!.y)).toBeLessThan(2);
        await editor(page).fill('about 1876');
        await editor(page).press('Enter');
        await expect(editor(page)).toHaveCount(0);
        expect((await personOf(page, 'c'))!.birthDate).toBe('~1876');
        await expect(row(page, 'p:c')).toHaveClass(/\bis-flash\b(?!-)/);
        await expect(page.locator('.toast').last()).toContainText('Saved: Celestýn Vrtišek');
        await expect(date).toBeFocused();
        await expect(date).toContainText('1876');

        // A place offers the tree's places; a new one is written as typed.
        const place = await cell(page, 'p:c', 'bPlace');
        await place.dblclick();
        await expect(editor(page)).toHaveAttribute('list', 'places-datalist');
        await expect(page.locator('#places-datalist option[value="Klenovice"]')).toHaveCount(1);
        await editor(page).fill('Ostrolhota');
        await editor(page).press('Enter');
        await expect(place).toContainText('Ostrolhota');
        expect((await personOf(page, 'c'))!.birthPlace).toBe('Ostrolhota');

        // One Ctrl/Cmd+Z takes back the place alone.
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await personOf(page, 'c'))!.birthPlace ?? '').toBe('');
        expect((await personOf(page, 'c'))!.birthDate).toBe('~1876');
    });

    test('a date that cannot be read keeps the field with its error; Escape cancels; Tab saves and goes to the next cell edited in place', async ({ page }) => {
        await openTable(page);
        const date = await cell(page, 'p:v', 'bDate');
        await date.click();
        await page.keyboard.press('F2');
        await expect(editor(page)).toBeFocused();
        await editor(page).fill('the spring after the flood');
        await editor(page).press('Enter');
        await expect(editorError(page)).toBeVisible();
        await expect(editorError(page)).toHaveText('The date cannot be read (e.g. 1880-05-15, 1880, about 1880)');
        await expect(editor(page)).toBeFocused();
        expect((await personOf(page, 'v'))!.birthDate).toBe('1850-03-01');
        // Typing again takes the error away; Escape leaves the date as it was.
        await editor(page).press('Backspace');
        await expect(editorError(page)).toBeHidden();
        await editor(page).press('Escape');
        await expect(editor(page)).toHaveCount(0);
        await expect(date).toBeFocused();
        expect((await personOf(page, 'v'))!.birthDate).toBe('1850-03-01');

        // Enter on the active cell opens the field too; Tab saves and goes on.
        await page.keyboard.press('Enter');
        await expect(editor(page)).toHaveValue('1850-03-01');
        await editor(page).fill('1851-03-01');
        await editor(page).press('Tab');
        await expect(editor(page)).toHaveValue('Lopuchov');
        expect((await personOf(page, 'v'))!.birthDate).toBe('1851-03-01');
        await editor(page).press('Tab');
        // The death date (empty), then over the computed age and the partner to the wedding's date.
        await expect(editor(page)).toHaveValue('');
        await editor(page).press('Tab');
        await expect(editor(page)).toHaveValue('1874-02-12');
        await editor(page).press('Shift+Tab');
        await expect(editor(page)).toHaveValue('');
        await editor(page).press('Escape');
        await expect(editor(page)).toHaveCount(0);
        await expect(await cell(page, 'p:v', 'dDate')).toBeFocused();
        expect((await personOf(page, 'v'))!.birthPlace).toBe('Lopuchov');
    });

    test('a save keeps the citations and the event\'s other fields; a click elsewhere saves', async ({ page }) => {
        await openTable(page);
        await showColumns(page, ['Baptism place']);
        const bap = await cell(page, 'p:v', 'bapPlace');
        await expect(bap).toHaveText('Lopuchov');
        await bap.dblclick();
        await editor(page).fill('Klenovice');
        // A click on another row saves.
        await row(page, 'p:k').locator('.tv-name').click();
        await expect(editor(page)).toHaveCount(0);
        await expect(bap).toHaveText('Klenovice');
        const v = (await personOf(page, 'v'))!;
        expect(v.events).toEqual([{ id: 'vb', type: 'baptism', date: '1850-03-02', place: 'Klenovice', note: 'Godfather a miller', sourceIds: ['s1'] }]);

        await (await cell(page, 'p:v', 'bPlace')).dblclick();
        await editor(page).fill('Lopuchov u Klenovic');
        await editor(page).press('Enter');
        const after = (await personOf(page, 'v'))!;
        expect(after.birthPlace).toBe('Lopuchov u Klenovic');
        expect(after.birthSourceIds).toEqual(['s1']);

        // An emptied baptism date leaves the baptism with its place, note and source.
        await showColumns(page, ['Baptism date']);
        await (await cell(page, 'p:v', 'bapDate')).dblclick();
        await editor(page).fill('');
        await editor(page).press('Enter');
        expect((await personOf(page, 'v'))!.events).toEqual([{ id: 'vb', type: 'baptism', place: 'Klenovice', note: 'Godfather a miller', sourceIds: ['s1'] }]);
    });

    test('the row menu offers "Edit cell" (F2); a double click on any other cell opens Edit…', async ({ page }) => {
        await openTable(page);
        const place = await cell(page, 'p:k', 'bPlace');
        await place.click({ button: 'right' });
        const item = page.locator('.tv-menu .tv-menu-item', { hasText: 'Edit cell' });
        await expect(item.locator('.tv-menu-hint')).toHaveText('F2');
        await item.click();
        await expect(editor(page)).toBeFocused();
        await editor(page).fill('Klenovice');
        await editor(page).press('Enter');
        expect((await personOf(page, 'k'))!.birthPlace).toBe('Klenovice');

        // The age at death is computed: no "Edit cell", the double click opens the person's dialog.
        const age = await cell(page, 'p:k', 'dAge');
        await age.click({ button: 'right' });
        await expect(page.locator('.tv-menu .tv-menu-item', { hasText: 'Edit cell' })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await age.dblclick();
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(editor(page)).toHaveCount(0);
    });

    test('a read-only (locked) tree: no field in the cell, a double click does not edit', async ({ page }) => {
        await openTable(page);
        const tid = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
        await page.evaluate((id) => window.Strom.UI.toggleTreeLock(id), tid);
        await expect(tv(page, '.tv-status-ro')).toBeVisible();
        const date = await cell(page, 'p:c', 'bDate');
        await expect(date).not.toHaveClass(/is-editable/);
        await expect(tv(page, '.tv-body .is-editable')).toHaveCount(0);
        await date.dblclick();
        await date.click();
        await page.keyboard.press('F2');
        await expect(editor(page)).toHaveCount(0);
        expect((await personOf(page, 'c'))!.birthDate).toBe('1875-06-07');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('no field in the cell: a tap keeps the row\'s sheet, without "Edit cell"', async ({ page }) => {
        await openTable(page, true);
        await expect(tv(page, '.tv-body .is-editable')).toHaveCount(0);
        await (await cell(page, 'p:c', 'bDate')).tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-label', { hasText: 'Edit cell' })).toHaveCount(0);
        await expect(editor(page)).toHaveCount(0);
    });
});
