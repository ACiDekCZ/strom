import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The Table view's columns (spec 073 §4.3–§4.6): the Columns panel (a panel
 * at the right on a computer, a sheet on a phone), the group row's −/+ and
 * the collapsed band, moving and pinning columns, the width, the header menu.
 */

const FAMILY: Record<string, SeedPerson> = {
    a: { firstName: 'Orvin', lastName: 'Kvelden', partners: ['b'] },
    b: { firstName: 'Tamsa', lastName: 'Morastin', gender: 'female', partners: ['a'] },
    c: { firstName: 'Belko', lastName: 'Kvelden', parents: ['a', 'b'] },
    d: { firstName: 'Ivrena', lastName: 'Kvelden', gender: 'female', parents: ['a', 'b'] },
};

async function openTable(page: Page): Promise<void> {
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
}

/** The head's column ids in their drawn order. */
async function headOrder(page: Page): Promise<string[]> {
    return page.locator('#table-container .tv-headrow .tv-headcell').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? `band:${(el as HTMLElement).dataset.band}`));
}

const head = (page: Page, col: string) => page.locator(`#table-container .tv-headrow [data-col="${col}"]`);

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Columns panel shows, hides and moves columns, switches the coverage row and resets', async ({ page }) => {
        await openApp(page);
        await seedTree(page, FAMILY, 'Kvelden', 'a');
        await openTable(page);
        const overview = ['name', 'bDate', 'bPlace', 'dDate', 'dAge', 'partner', 'wDate', 'wAge', 'nFind', 'comp'];
        expect(await headOrder(page)).toEqual(overview);

        const btn = page.locator('#table-container .tv-cols-btn');
        await expect(btn).toHaveAccessibleName(/^Columns, 10 of \d+$/);
        await btn.click();
        const panel = page.getByRole('dialog', { name: 'Columns' });
        await expect(panel).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.tv-cp-q')).toBeFocused();
        // At the right over the grid, 360 px wide.
        const box = (await panel.boundingBox())!;
        expect(Math.round(box.width)).toBe(360);
        expect(Math.round(box.x + box.width)).toBe(1440);

        // The search filters the names; groups without a match hide.
        await page.locator('.tv-cp-q').fill('father');
        await expect(panel.locator('.tv-cp-group')).toHaveCount(2);
        await panel.getByRole('checkbox', { name: 'Father', exact: true }).check();
        await expect(head(page, 'father')).toHaveCount(1);
        // Father (Parents) sits after the birth columns, before death.
        expect(await headOrder(page)).toEqual(['name', 'bDate', 'bPlace', 'father', 'dDate', 'dAge', 'partner', 'wDate', 'wAge', 'nFind', 'comp']);
        await page.locator('.tv-cp-q').fill('');

        // The name stays checked and locked.
        await panel.getByRole('button', { name: /^Person\b/ }).click();
        const name = panel.getByRole('checkbox', { name: 'Name', exact: true });
        await expect(name).toBeChecked();
        await expect(name).toBeDisabled();
        await expect(panel.locator('.tv-cp-item[data-col="name"] .tv-cp-note')).toHaveText('pinned');

        // Unchecking hides; Alt+↓ on a focused column moves it within its group.
        await panel.getByRole('button', { name: /^Birth and baptism\b/ }).click();
        await panel.getByRole('checkbox', { name: 'Birthplace', exact: true }).uncheck();
        await expect(head(page, 'bPlace')).toHaveCount(0);
        await panel.getByRole('checkbox', { name: 'Birthplace', exact: true }).check();
        const bDate = panel.getByRole('checkbox', { name: 'Birth date', exact: true });
        await bDate.focus();
        await page.keyboard.press('Alt+ArrowDown');
        expect((await headOrder(page)).slice(1, 3)).toEqual(['bPlace', 'bDate']);
        await expect(bDate).toBeFocused();
        // ↑ on the focused column moves it back; past its group it does not go.
        await panel.getByRole('button', { name: 'Move up: Birth date' }).click();
        expect((await headOrder(page)).slice(1, 3)).toEqual(['bDate', 'bPlace']);
        await expect(panel.getByRole('button', { name: 'Move up: Birth date' })).toHaveAttribute('aria-disabled', 'true');

        // "all" checks the whole group.
        await panel.getByRole('button', { name: 'All columns: Birth and baptism' }).click();
        await expect(head(page, 'bapDate')).toHaveCount(1);
        await expect(panel.locator('.tv-cp-group[data-group="birth"] .tv-cp-gcount')).toHaveText(/^(\d+) of \1$/);

        // The coverage row switch.
        await expect(page.locator('#table-container .tv-covrow')).toBeVisible();
        await panel.getByRole('switch', { name: 'Coverage row' }).uncheck();
        await expect(page.locator('#table-container .tv-covrow')).toBeHidden();

        // Reset to default: the overview's columns and the coverage row again.
        await panel.getByRole('button', { name: 'Reset to default' }).click();
        expect(await headOrder(page)).toEqual(overview);
        await expect(page.locator('#table-container .tv-covrow')).toBeVisible();

        // Escape closes; the focus returns to the Columns button.
        await page.locator('.tv-cp-q').focus();
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(btn).toBeFocused();
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
    });

    test('a group collapses to a band and opens again; a column pins left and its edge shadows after a scroll', async ({ page }) => {
        await openApp(page);
        await seedTree(page, FAMILY, 'Kvelden', 'a');
        await openTable(page);

        const collapse = page.getByRole('button', { name: 'Collapse group Unions' });
        await expect(collapse).toHaveAttribute('aria-expanded', 'true');
        await collapse.click();
        const band = page.locator('#table-container .tv-headrow .tv-bandhead[data-band="union"]');
        await expect(band).toHaveText('3 columns');
        expect(Math.round((await band.boundingBox())!.width)).toBe(130);
        await expect(head(page, 'partner')).toHaveCount(0);
        await expect(page.locator('#table-container .tv-body .tv-row').first().locator('.tv-band')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Expand group Unions' })).toHaveAttribute('aria-expanded', 'false');
        // A click on the band opens the group.
        await band.click();
        await expect(head(page, 'partner')).toHaveCount(1);

        // Pin left from the header menu (right click): behind the name, sticky.
        await head(page, 'wDate').click({ button: 'right' });
        const menu = page.getByRole('menu', { name: 'Marriage date' });
        await expect(menu).toBeVisible();
        await menu.getByRole('menuitem', { name: 'Pin left' }).click();
        await expect(menu).toHaveCount(0);
        expect((await headOrder(page)).slice(0, 2)).toEqual(['name', 'wDate']);
        await expect(head(page, 'wDate')).toHaveClass(/tv-pinned-last/);

        // Many columns: the grid scrolls sideways, the pinned edge gets its shadow.
        await page.locator('#table-container .tv-cols-btn').click();
        const panel = page.getByRole('dialog', { name: 'Columns' });
        await panel.getByRole('button', { name: /^Death and burial\b/ }).click();
        await panel.getByRole('button', { name: 'All columns: Death and burial' }).click();
        await panel.getByRole('button', { name: 'Done' }).click();
        await expect(panel).toHaveCount(0);
        const grid = page.locator('#table-container .tv-grid');
        await grid.evaluate(el => { el.scrollLeft = 400; el.dispatchEvent(new Event('scroll')); });
        await expect(grid).toHaveClass(/is-scrolled-x/);
        const shadow = await head(page, 'wDate').evaluate(el => getComputedStyle(el).boxShadow);
        expect(shadow).not.toBe('none');
        const x = (await head(page, 'wDate').boundingBox())!.x;
        expect(Math.round(x)).toBe(250);

        // Unpin returns it to its group.
        await head(page, 'wDate').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Unpin' }).click();
        const order = await headOrder(page);
        expect(order.indexOf('wDate')).toBe(order.indexOf('partner') + 1);
    });

    test('the header menu and keys: sort, move, width; a column is dragged within its group', async ({ page }) => {
        await openApp(page);
        await seedTree(page, FAMILY, 'Kvelden', 'a');
        await openTable(page);

        // Shift+F10 on a focused head cell opens its menu; Escape returns the focus.
        await head(page, 'name').focus();
        await page.keyboard.press('ArrowRight');
        await expect(head(page, 'bDate')).toBeFocused();
        await page.keyboard.press('Shift+F10');
        const menu = page.getByRole('menu', { name: 'Birth date' });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Sort ascending' })).toBeFocused();
        // The name has no "Hide"; this column has it.
        await expect(menu.getByRole('menuitem', { name: 'Hide column' })).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(head(page, 'bDate')).toBeFocused();

        // Sort descending from the menu (▾).
        await head(page, 'bDate').hover();
        await head(page, 'bDate').getByRole('button', { name: 'Column menu: Birth date' }).click();
        await page.getByRole('menuitem', { name: 'Sort descending' }).click();
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Birth date ↓');
        await expect(head(page, 'bDate')).toHaveAttribute('aria-sort', 'descending');

        // Alt+→ moves within the group; past it nothing happens.
        await head(page, 'bDate').focus();
        await page.keyboard.press('Alt+ArrowRight');
        expect((await headOrder(page)).slice(1, 3)).toEqual(['bPlace', 'bDate']);
        await expect(head(page, 'bDate')).toBeFocused();
        await page.keyboard.press('Alt+ArrowRight');
        expect((await headOrder(page)).slice(1, 4)).toEqual(['bPlace', 'bDate', 'dDate']);

        // Alt+Shift+→ widens by 16 px.
        const w0 = (await head(page, 'bDate').boundingBox())!.width;
        await page.keyboard.press('Alt+Shift+ArrowRight');
        await expect.poll(async () => Math.round((await head(page, 'bDate').boundingBox())!.width)).toBe(Math.round(w0 + 16));

        // Dragging the right edge changes the width.
        const edge = head(page, 'partner').locator('.tv-resize');
        const eb = (await edge.boundingBox())!;
        const pw = (await head(page, 'partner').boundingBox())!.width;
        await page.mouse.move(eb.x + 4, eb.y + eb.height / 2);
        await page.mouse.down();
        await page.mouse.move(eb.x + 24, eb.y + eb.height / 2, { steps: 4 });
        await page.mouse.move(eb.x + 44, eb.y + eb.height / 2, { steps: 4 });
        await page.mouse.up();
        await expect.poll(async () => Math.round((await head(page, 'partner').boundingBox())!.width)).toBe(Math.round(pw + 40));

        // Drag "Age at marriage" onto "Partner": it lands in front (same group).
        const from = (await head(page, 'wAge').boundingBox())!;
        const to = (await head(page, 'partner').boundingBox())!;
        await page.mouse.move(from.x + 20, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x - 20, from.y + from.height / 2, { steps: 3 });
        await expect(page.locator('.tv-drop-line')).toHaveCount(1);
        await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 6 });
        await page.mouse.up();
        await expect(page.locator('.tv-drop-line')).toHaveCount(0);
        const order = await headOrder(page);
        expect(order.slice(order.indexOf('wAge'), order.indexOf('wAge') + 3)).toEqual(['wAge', 'partner', 'wDate']);
    });

    test('German column names wrap to two lines at most, the whole name in the title', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await seedTree(page, FAMILY, 'Kvelden', 'a');
        await page.locator('#view-mode-table').click();
        await expect(page.locator('#table-container .tv-grid')).toBeVisible();
        await page.locator('#table-container .tv-cols-btn').click();
        const panel = page.getByRole('dialog', { name: 'Spalten' });
        await panel.locator('.tv-cp-q').fill('Mutter');
        await panel.getByRole('checkbox', { name: 'Alter der Mutter bei der Geburt' }).check();
        await panel.getByRole('button', { name: 'Fertig' }).click();
        const cell = head(page, 'mAge');
        await expect(cell).toHaveAttribute('title', 'Alter der Mutter bei der Geburt');
        const lines = await cell.locator('.tv-cell-text').evaluate(el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
        expect(lines).toBeLessThanOrEqual(2);
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the Columns sheet: groups, ↑ ↓ on checked columns, collapsing a group; no −/+ in the grid', async ({ page }) => {
        await openApp(page);
        await seedTree(page, FAMILY, 'Kvelden', 'a');
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
        await expect(page.locator('#table-container .tv-grid')).toBeVisible();
        await expect(page.locator('#table-container .tv-group-toggle')).toHaveCount(0);

        await page.locator('#table-container .tv-cols-btn').tap();
        const sheet = page.getByRole('dialog', { name: 'Columns' });
        await expect(sheet).toBeVisible();
        await expect(page.locator('.bottom-sheet-overlay.tv-colpanel-overlay')).toHaveClass(/active/);
        const sb = (await sheet.boundingBox())!;
        expect(Math.round(sb.x)).toBe(0);
        expect(Math.round(sb.width)).toBe(390);

        await sheet.getByRole('button', { name: /^Birth and baptism\b/ }).tap();
        const item = sheet.locator('.tv-cp-item[data-col="bDate"]');
        await expect(item).toHaveCSS('min-height', '48px');
        await expect(item.getByRole('button', { name: 'Move down: Birth date' })).toBeVisible();
        await item.getByRole('button', { name: 'Move down: Birth date' }).tap();
        expect((await headOrder(page)).slice(1, 3)).toEqual(['bPlace', 'bDate']);
        await expect(sheet.locator('.tv-cp-grip')).toHaveCount(0);

        // Collapsing a group is here on a phone.
        await sheet.getByRole('button', { name: 'Collapse group Birth and baptism' }).tap();
        await expect(page.locator('#table-container .tv-headrow .tv-bandhead[data-band="birth"]')).toHaveCount(1);

        await sheet.getByRole('button', { name: 'Done' }).tap();
        await expect(sheet).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
