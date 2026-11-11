import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, waitForPersist, type SeedPerson } from './helpers.js';

/**
 * The Table view's cell (T54 F9, F4): a click makes the cell the active one
 * (a quiet outline, the arrows move it), Ctrl/Cmd+C copies its shown text
 * (a text selected by hand copies as usual); the row's menu starts with the
 * cell's Copy · Only "{value}" · Without "{value}" (an empty cell: only empty
 * / only filled), the filters "= / ≠" as chips, kept with a saved view; a
 * father's Only lists the siblings, not the children of a namesake; on a
 * phone the row's sheet starts with the same choices.
 */

const FAMILY: Record<string, SeedPerson> = {
    f: { firstName: 'Radomír', lastName: 'Šlapetný', birthDate: '1850-02-03', partners: ['m'] },
    m: { firstName: 'Žofie', lastName: 'Kvapilová', gender: 'female', birthDate: '1855-05-06', birthPlace: 'Dolní Vřesová', partners: ['f'] },
    b1: { firstName: 'Bonifác', lastName: 'Šlapetný', birthDate: '1880-03-04', birthPlace: 'Lhotka nad Brodem', parents: ['f', 'm'] },
    b2: { firstName: 'Hedvika', lastName: 'Šlapetná', gender: 'female', birthDate: '1882-07-08', birthPlace: 'lhotka nad brodem', parents: ['f', 'm'] },
    f2: { firstName: 'Radomír', lastName: 'Šlapetný', birthDate: '1849-09-10', partners: ['w'] },
    w: { firstName: 'Bohdana', lastName: 'Měchurková', gender: 'female', birthDate: '1851-11-12', partners: ['f2'] },
    t: { firstName: 'Teofil', lastName: 'Měchurka', birthDate: '1885-01-02', birthPlace: 'Dolni Vresova', parents: ['f2', 'w'] },
};

const row = (page: Page, key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);
const cell = (page: Page, key: string, colId: string) =>
    page.locator('#table-container .tv-headrow [data-col]').evaluateAll((els, id) => els.findIndex(e => (e as HTMLElement).dataset.col === id) + 1, colId)
        .then(i => row(page, key).locator(`[aria-colindex="${i}"]`));
const status = (page: Page) => page.locator('#table-container .tv-status-count');
const colChips = (page: Page) => page.locator('#table-container .tv-chip--col .tv-chip-edit');
const menuLabels = (page: Page) => page.locator('.tv-menu .tv-menu-label');
const menuItem = (page: Page, label: string) => page.locator('.tv-menu .tv-menu-item', { hasText: label });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

async function openTable(page: Page, phone = false): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Šlapetný', 'b1');
    if (phone) {
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(status(page)).toHaveText('7 of 7 people');
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

    test('a click makes the active cell; the arrows move it; Ctrl/Cmd+C copies its text, a selection copies as usual', async ({ page }) => {
        await openTable(page);
        // Coming into the table the person in focus is the active row, no cell is outlined.
        await expect(row(page, 'p:b1')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#table-container .is-active-cell')).toHaveCount(0);

        const place = await cell(page, 'p:b1', 'bPlace');
        await place.click();
        await expect(place).toHaveClass(/is-active-cell/);
        await expect(page.locator('#table-container .is-active-cell')).toHaveCount(1);
        await expect(row(page, 'p:b1')).toHaveAttribute('aria-selected', 'true');
        // A quiet outline in the light and the dark scheme.
        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            const o = await place.evaluate(e => { const s = getComputedStyle(e); return { style: s.outlineStyle, width: s.outlineWidth }; });
            expect(o).toEqual({ style: 'solid', width: '1px' });
        }
        await page.emulateMedia({ colorScheme: 'light' });

        await page.keyboard.press('ControlOrMeta+c');
        await expect.poll(() => clipboard(page)).toBe('Lhotka nad Brodem');

        // → moves the active cell; the date copies as shown.
        await page.keyboard.press('ArrowRight');
        const death = await cell(page, 'p:b1', 'dDate');
        await expect(death).toHaveClass(/is-active-cell/);
        await expect(place).not.toHaveClass(/is-active-cell/);
        await page.keyboard.press('Home');
        await expect(await cell(page, 'p:b1', 'name')).toHaveClass(/is-active-cell/);
        await page.keyboard.press('ControlOrMeta+c');
        await expect.poll(() => clipboard(page)).toBe('Bonifác Šlapetný');

        // A text selected by hand is copied as it is.
        const other = await cell(page, 'p:t', 'bPlace');
        await other.locator('.tv-cell-text').evaluate((el) => {
            const range = document.createRange();
            range.setStart(el.firstChild!, 0);
            range.setEnd(el.firstChild!, 5);
            const sel = window.getSelection()!;
            sel.removeAllRanges();
            sel.addRange(range);
        });
        await page.keyboard.press('ControlOrMeta+c');
        await expect.poll(() => clipboard(page)).toBe('Dolni');
    });

    test('a click leaves no caret in the active cell, so a cut text keeps its "…"', async ({ page }) => {
        await openTable(page);
        // The selected row's cell: the click redraws nothing, the caret would stay in the text.
        const place = await cell(page, 'p:b1', 'bPlace');
        await place.locator('.tv-cell-text').click({ position: { x: 20, y: 6 } });
        await expect(place).toHaveClass(/is-active-cell/);
        const caretIn = () => place.evaluate((el) => {
            const sel = window.getSelection();
            return !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
        });
        expect(await caretIn()).toBe(false);
        await place.click({ button: 'right' });
        await expect(menuLabels(page).first()).toHaveText('Copy');
        expect(await caretIn()).toBe(false);
    });

    test('the cell\'s part of the row menu: Copy, Only and Without as "=" and "≠" chips; an empty cell: only empty / only filled', async ({ page }) => {
        await openTable(page);
        const place = await cell(page, 'p:b1', 'bPlace');
        await place.click({ button: 'right' });
        await expect(place).toHaveClass(/is-active-cell/);
        await expect(menuLabels(page)).toHaveText(['Copy', 'Only “Lhotka nad Brodem”', 'Without “Lhotka nad Brodem”', 'Edit cell', 'Show in tree', 'Open person', 'Edit…']);
        await expect(page.locator('.tv-menu .tv-menu-item').first().locator('.tv-menu-hint')).toHaveText(/^(Ctrl\+C|⌘C)$/);
        await expect(page.locator('.tv-menu .tv-menu-sep')).toHaveCount(1);
        await menuItem(page, 'Copy').click();
        await expect.poll(() => clipboard(page)).toBe('Lhotka nad Brodem');

        // Only: the same place in any case.
        await place.click({ button: 'right' });
        await menuItem(page, 'Only').click();
        await expect(status(page)).toHaveText('2 of 7 people');
        await expect(colChips(page)).toHaveText(['Birthplace = Lhotka nad Brodem']);
        // The chip edits as "is" with the value.
        await colChips(page).click();
        const panel = page.locator('.tv-fpanel');
        await expect(panel.locator('.tv-ff-match')).toHaveValue('equals');
        await expect(panel.locator('.tv-ff-text')).toHaveValue('Lhotka nad Brodem');
        await page.keyboard.press('Escape');
        await page.locator('#table-container .tv-chip--col .tv-chip-x').click();
        await expect(status(page)).toHaveText('7 of 7 people');

        // Without: everyone else, the empty places among them; diacritics aside.
        await (await cell(page, 'p:t', 'bPlace')).click({ button: 'right' });
        await expect(menuLabels(page).nth(1)).toHaveText('Only “Dolni Vresova”');
        await menuItem(page, 'Without').click();
        await expect(colChips(page)).toHaveText(['Birthplace ≠ Dolni Vresova']);
        await expect(status(page)).toHaveText('5 of 7 people');
        await expect(row(page, 'p:m')).toHaveCount(0);
        await page.locator('#table-container .tv-chip--col .tv-chip-x').click();
        await expect(status(page)).toHaveText('7 of 7 people');

        // An empty cell: only empty / only filled.
        await (await cell(page, 'p:f', 'bPlace')).click({ button: 'right' });
        await expect(menuLabels(page)).toHaveText(['Only empty', 'Only filled', 'Edit cell', 'Show in tree', 'Open person', 'Edit…']);
        await menuItem(page, 'Only empty').click();
        await expect(status(page)).toHaveText('3 of 7 people');

        // Shift+F10 on the active cell: the same part.
        await page.locator('#table-container .tv-chips-clear').click();
        await (await cell(page, 'p:b2', 'bDate')).click();
        await page.keyboard.press('Shift+F10');
        await expect(menuLabels(page).first()).toHaveText('Copy');
        await expect(menuLabels(page).nth(1)).toHaveText(/^Only “.*1882.*”$/);
        await page.keyboard.press('Escape');
        // The row's own name keeps the row's actions alone.
        await row(page, 'p:b2').locator('.tv-name').click({ button: 'right' });
        await expect(menuLabels(page)).toHaveText(['Show in tree', 'Open person', 'Edit…']);
    });

    test('Only "{father}" lists the siblings (a namesake\'s son not), kept in a saved view and back after a reload', async ({ page }) => {
        await openTable(page);
        await page.locator('#table-container .tv-view-btn').click();
        await menuItem(page, 'Births and parents').click();
        const father = await cell(page, 'p:b1', 'father');
        await expect(father).toHaveText('Radomír Šlapetný');
        await father.click({ button: 'right' });
        await menuItem(page, 'Only').click();
        await expect(status(page)).toHaveText('2 of 7 people');
        await expect(row(page, 'p:b2')).toHaveCount(1);
        await expect(row(page, 'p:t')).toHaveCount(0);
        await expect(colChips(page)).toHaveText(['Father = Radomír Šlapetný']);

        await page.locator('#table-container .tv-view-saveas').click();
        const input = page.locator('.tv-fpanel.tv-vpanel .tv-vname-input');
        await input.fill('Siblings');
        await input.press('Enter');
        await expect(page.locator('#table-container .tv-view-name')).toHaveText('Siblings');
        await waitForPersist(page, 'Siblings');
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        if (!await page.locator('#table-container .tv-grid').isVisible()) await page.locator('#view-mode-table').click();
        await expect(page.locator('#table-container .tv-view-name')).toHaveText('Siblings');
        await expect(status(page)).toHaveText('2 of 7 people');
        await expect(colChips(page)).toHaveText(['Father = Radomír Šlapetný']);
        await expect(row(page, 'p:t')).toHaveCount(0);
    });

    test('the menu of a cell on another row than the selected one opens under that cell (T54 G7)', async ({ page }) => {
        await openTable(page);
        await expect(row(page, 'p:b1')).toHaveAttribute('aria-selected', 'true');
        const menu = page.locator('.tv-menu');
        const under = async (key: string, colId: string) => {
            const c = await cell(page, key, colId);
            await c.click({ button: 'right' });
            await expect(menu).toBeVisible();
            await expect(row(page, key)).toHaveAttribute('aria-selected', 'true');
            const box = (await menu.boundingBox())!;
            const at = (await (await cell(page, key, colId)).boundingBox())!;
            // Under the cell (or above it near the window's bottom), never in the window's corner.
            expect(Math.abs(box.x - at.x)).toBeLessThan(2);
            expect(Math.abs(box.y - (at.y + at.height + 2)) < 2 || Math.abs(box.y + box.height + 2 - at.y) < 2).toBe(true);
            await page.keyboard.press('Escape');
            await expect(menu).toHaveCount(0);
        };
        await under('p:t', 'bPlace');
        await under('p:m', 'bDate');
        // The selected row's cell as before.
        await under('p:m', 'bPlace');
        // Shift+F10 on a cell of another row, focused by the keyboard.
        await (await cell(page, 'p:b2', 'bDate')).focus();
        await page.keyboard.press('Shift+F10');
        await expect(menu).toBeVisible();
        const box = (await menu.boundingBox())!;
        const at = (await (await cell(page, 'p:b2', 'bDate')).boundingBox())!;
        expect(Math.abs(box.x - at.x)).toBeLessThan(2);
        expect(box.y).toBeGreaterThan(at.y);
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a tap on a cell: the row\'s sheet starts with Copy, Only and Without', async ({ page }) => {
        await openTable(page, true);
        // The birth date (the places carry a finding, whose tap opens its list).
        await (await cell(page, 'p:b1', 'bDate')).tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        const labels = sheet.locator('.bottom-sheet-item .bottom-sheet-label');
        await expect(labels).toHaveText(['Copy', 'Only “4 Mar 1880”', 'Without “4 Mar 1880”', 'Show in tree', 'Open person', 'Edit…']);
        expect((await sheet.locator('.bottom-sheet-item').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await sheet.locator('.bottom-sheet-item', { hasText: 'Only' }).tap();
        await expect(sheet).toHaveCount(0);
        await expect(status(page)).toHaveText('1 of 7 people');
        // The name keeps the row's sheet as it was.
        await row(page, 'p:b1').locator('.tv-name').tap();
        await expect(labels).toHaveText(['Show in tree', 'Open person', 'Edit…']);
    });
});
