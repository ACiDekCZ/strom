import { test, expect, Page } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * The Table view's cells edited in place, the tester's second round (T54 G3,
 * G5): a union's empty cell adds its wedding or its divorce the way the union
 * form adds it (one undo step each), a recorded age at the wedding, the
 * union's type and the sex chosen from their values, the cause and the
 * recorded age at death and the reference number typed; a union without a
 * wedding (partners) has "–" in the wedding's cells with why in the bubble,
 * no field there, and its completeness counts only the partner. T54 G10:
 * "Full name" and the first name edited in its own column.
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    v: person('v', 'Bořivoj', 'Vrtišek', { birthDate: '1850-03-01', deathDate: '1910-01-05', partnerships: ['u1'], childIds: ['c'] }),
    k: person('k', 'Kunhuta', 'Hrnčíříková', { gender: 'female', birthDate: '1852-04-05', partnerships: ['u1'], childIds: ['c'] }),
    c: person('c', 'Celestýn', 'Vrtišek', { birthDate: '1875-06-07', parentIds: ['v', 'k'], partnerships: ['u2', 'u3'] }),
    r: person('r', 'Radegunda', 'Kroupová', { gender: 'female', birthDate: '1877-08-09', partnerships: ['u2'] }),
    q: person('q', 'Kvirina', 'Hrachovcová', { gender: 'female', birthDate: '1880-10-11', partnerships: ['u3'] }),
};
const PARTNERSHIPS = {
    u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: ['c'], status: 'married', startDate: '1874-02-12', startPlace: 'Klenovice' },
    // A wedding the tree does not know yet.
    u2: { id: 'u2', person1Id: 'c', person2Id: 'r', childIds: [], status: 'married' },
    // Partners: no wedding.
    u3: { id: 'u3', person1Id: 'c', person2Id: 'q', childIds: [], status: 'partners' },
};

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const editor = (page: Page) => tv(page, '.tv-editor-input');
const unionOf = (page: Page, id: string) => page.evaluate((uid) => window.Strom.DataManager.getData().partnerships[uid as never], id);
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

async function openTable(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await page.evaluate(async ({ persons, partnerships }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships } as never, 'Vrtišek');
        await window.Strom.TreeRenderer.setFocus('c' as never);
    }, { persons: PERSONS, partnerships: PARTNERSHIPS });
    await expect(card(page, 'Celestýn')).toBeVisible();
    await page.locator('#view-mode-table').click();
    await expect(tv(page, '.tv-status-count')).toHaveText('5 of 5 people');
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

    test('a union\'s empty cells add its wedding, an age and its divorce, one undo step each; its type is chosen', async ({ page }) => {
        await openTable(page);
        await tv(page, '.tv-rowtype [data-rowtype="unions"]').click();
        await expect(page.locator('#table-container')).toHaveAttribute('data-rowtype', 'unions');

        // The wedding's date from an empty cell.
        const date = await cell(page, 'u:u2', 'wDate');
        await expect(date).toHaveClass(/is-editable/);
        await date.dblclick();
        await expect(editor(page)).toBeFocused();
        await expect(editor(page)).toHaveValue('');
        await editor(page).fill('1899-05-03');
        await editor(page).press('Enter');
        await expect(editor(page)).toHaveCount(0);
        await expect(date).toContainText('1899');
        expect((await unionOf(page, 'u2'))!.startDate).toBe('1899-05-03');
        await expect(page.locator('.toast').last()).toContainText('Saved:');

        // Partner 1's recorded age.
        const age = await cell(page, 'u:u2', 'rec1');
        await age.dblclick();
        await editor(page).fill('24');
        await editor(page).press('Enter');
        await expect(age).toHaveText('24');
        expect((await unionOf(page, 'u2'))!.ages).toEqual({ c: '24' });

        // The divorce from its empty date; one undo takes it back alone.
        const div = await cell(page, 'u:u2', 'divDate');
        await div.dblclick();
        await editor(page).fill('1905');
        await editor(page).press('Enter');
        await expect(div).toContainText('1905');
        expect((await unionOf(page, 'u2'))!.endDate).toBe('1905');
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await unionOf(page, 'u2'))!.endDate ?? '').toBe('');
        const after = (await unionOf(page, 'u2'))!;
        expect(after.startDate).toBe('1899-05-03');
        expect(after.ages).toEqual({ c: '24' });

        // The union's type: chosen from the union form's types.
        const type = await cell(page, 'u:u2', 'uStatus');
        await type.dblclick();
        const select = tv(page, 'select.tv-editor-input');
        await expect(select).toBeFocused();
        await expect(select).toHaveValue('married');
        expect(await select.locator('option').allTextContents()).toEqual(['Married', 'Partners', 'Divorced', 'Separated']);
        await select.selectOption('partners');
        await select.press('Enter');
        await expect(editor(page)).toHaveCount(0);
        await expect(type).toHaveText('Partners');
        expect((await unionOf(page, 'u2'))!.status).toBe('partners');
        // Now without a wedding: the date stored stays shown, the empty age does not apply.
        await expect(date).toContainText('1899');
        await expect(await cell(page, 'u:u2', 'rec2')).toHaveText('–');
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await unionOf(page, 'u2'))!.status).toBe('married');
    });

    test('partners: the wedding\'s cells "–" with "does not apply", no field, the completeness of the partner alone', async ({ page }) => {
        await openTable(page);
        await tv(page, '.tv-rowtype [data-rowtype="unions"]').click();
        for (const id of ['wDate', 'wPlace', 'age1', 'rec1', 'age2', 'rec2', 'witnesses']) {
            const c = await cell(page, 'u:u3', id);
            await expect(c, id).toHaveText('–');
            await expect(c, id).toHaveAttribute('title', 'Does not apply: a union without a wedding');
            await expect(c, id).not.toHaveClass(/is-editable/);
        }
        const date = await cell(page, 'u:u3', 'wDate');
        await date.click();
        await page.keyboard.press('F2');
        await expect(editor(page)).toHaveCount(0);
        await date.click({ button: 'right' });
        await expect(page.locator('.tv-menu .tv-menu-item', { hasText: 'Edit cell' })).toHaveCount(0);
        await page.keyboard.press('Escape');
        // The married union without a wedding misses it; the partners do not.
        await expect(await cell(page, 'u:u3', 'uComp')).toContainText('100');
        await expect(await cell(page, 'u:u2', 'uComp')).toContainText('25');
        // The type stays chosen in the cell.
        await expect(await cell(page, 'u:u3', 'uStatus')).toHaveClass(/is-editable/);
    });

    test('the sex chosen, the cause and the recorded age at death and the reference number typed', async ({ page }) => {
        await openTable(page);
        await showColumns(page, ['Sex', 'Cause of death', 'Recorded age at death', 'Ref. number']);
        await expect(tv(page, '.tv-headrow [data-col="refn"]')).toContainText('Ref. number');
        await expect(tv(page, '.tv-headrow [data-col="refn"]')).not.toContainText('REFN');

        const sex = await cell(page, 'p:v', 'gender');
        await expect(sex).toHaveText('Male');
        await sex.dblclick();
        const select = tv(page, 'select.tv-editor-input');
        await expect(select).toBeFocused();
        expect(await select.locator('option').allTextContents()).toEqual(['Male', 'Female', 'Unknown']);
        await select.selectOption('unknown');
        await select.press('Enter');
        await expect(sex).toHaveText('');
        expect((await personOf(page, 'v'))!.gender).toBe('unknown');
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await personOf(page, 'v'))!.gender).toBe('male');

        for (const [id, value, field] of [['dCause', 'Typhus', 'deathCause'], ['dAgeRec', '59', 'deathAge'], ['refn', 'B-12', 'refn']] as const) {
            const c = await cell(page, 'p:v', id);
            await c.dblclick();
            await expect(editor(page), id).toBeFocused();
            await editor(page).fill(value);
            await editor(page).press('Enter');
            await expect(c, id).toHaveText(value);
            expect((await personOf(page, 'v'))![field], id).toBe(value);
        }
    });

    test('"Full name" pinned and composed; "First name" offered, hidden by default, edited in the cell with one undo step (T54 G10)', async ({ page }) => {
        await openTable(page);
        await expect(tv(page, '.tv-headrow [data-col="name"]')).toContainText('Full name');
        await expect(tv(page, '.tv-headrow [data-col="firstName"]')).toHaveCount(0);
        await showColumns(page, ['First name']);
        const first = await cell(page, 'p:v', 'firstName');
        await expect(first).toHaveText('Bořivoj');
        await first.dblclick();
        await expect(editor(page)).toBeFocused();
        await expect(editor(page)).toHaveValue('Bořivoj');
        await editor(page).fill('Bolemír');
        await editor(page).press('Enter');
        await expect(first).toHaveText('Bolemír');
        await expect(await cell(page, 'p:v', 'name')).toContainText('Bolemír Vrtišek');
        expect((await personOf(page, 'v'))!.firstName).toBe('Bolemír');
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await personOf(page, 'v'))!.firstName).toBe('Bořivoj');
        await expect(first).toHaveText('Bořivoj');
    });
});
