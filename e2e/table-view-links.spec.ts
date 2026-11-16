import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * A person's name in the Table as a link to their row (spec 103 U3): a click
 * jumps (‹ › back and forward, Alt+← / Alt+→, Enter on the cell), a person
 * the filter hides gets the strip with Show for now and Clear filters, an
 * event's participant offers "Go to …" (D6 c), a phone's row sheet lists the
 * people in the cell.
 */

const FAMILY: Record<string, SeedPerson> = {
    a: { firstName: 'Drevan', lastName: 'Ostrolam', birthDate: '1850-03-02', partners: ['b'] },
    b: { firstName: 'Velmira', lastName: 'Quarnet', gender: 'female', birthDate: '1852-05-11', partners: ['a'] },
    c: { firstName: 'Kestrin', lastName: 'Ostrolam', birthDate: '1880-07-14', parents: ['a', 'b'], partners: ['d', 'e'] },
    d: { firstName: 'Lunara', lastName: 'Pestvik', gender: 'female', birthDate: '1882-01-20', partners: ['c'] },
    e: { firstName: 'Sorvela', lastName: 'Brinkat', gender: 'female', birthDate: '1890-09-12', partners: ['c'] },
    f: {
        firstName: 'Arvid', lastName: 'Ostrolam', birthDate: '1905-04-02', parents: ['c', 'd'],
        events: [{ id: 'bp', type: 'baptism', date: '1905-04-09', participants: [{ role: 'godparent', personId: 'e' }] }],
    },
};

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const row = (page: Page, key: string) => tv(page, `.tv-body .tv-row[data-key="${key}"]`);

async function openTable(page: Page, phone: boolean, view = 'b:births'): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Ostrolam', 'f');
    await page.locator(phone ? '#bb-view-table' : '#view-mode-table').click();
    await expect(tv(page, '.tv-grid')).toBeVisible();
    await page.evaluate((v) => window.Strom.UI.openTableView(v), view);
    await expect(tv(page, '.tv-status')).toContainText('6 of 6');
}

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return row(page, key).locator(`[aria-colindex="${index}"]`);
}

const back = (page: Page) => tv(page, '.tv-nav-btn[data-nav="-1"]');
const forward = (page: Page) => tv(page, '.tv-nav-btn[data-nav="1"]');

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a click on a name jumps to the person\'s row; ‹ goes back, › and Alt+→ forward, Enter jumps', async ({ page }) => {
        await openTable(page, false);
        await expect(tv(page, '.tv-slot-nav')).toBeHidden();
        const father = await cell(page, 'p:f', 'father');
        const link = father.locator('.tv-nm--jump');
        await expect(link).toHaveText('Kestrin Ostrolam');
        // The link looks as the cell's text (underlined only under the mouse).
        await expect(link).toHaveCSS('text-decoration-line', 'none');
        await link.hover();
        await expect(link).toHaveCSS('text-decoration-line', 'underline');

        await link.click();
        await expect(row(page, 'p:c')).toHaveAttribute('aria-selected', 'true');
        const name = await cell(page, 'p:c', 'name');
        await expect(name).toHaveClass(/is-active-cell/);
        await expect(name).toBeFocused();
        await expect(tv(page, '.tv-slot-nav')).toBeVisible();
        await expect(back(page)).toHaveAttribute('aria-label', 'Back to Arvid Ostrolam');
        await expect(back(page)).toHaveAttribute('aria-disabled', 'false');
        await expect(forward(page)).toHaveAttribute('aria-disabled', 'true');

        await back(page).click();
        await expect(row(page, 'p:f')).toHaveAttribute('aria-selected', 'true');
        await expect(await cell(page, 'p:f', 'father')).toHaveClass(/is-active-cell/);
        await expect(back(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(forward(page)).toHaveAttribute('aria-label', 'Forward to Kestrin Ostrolam');

        // From the grid: Alt+→ repeats the jump, Alt+← goes back.
        await (await cell(page, 'p:f', 'bDate')).click();
        await page.keyboard.press('Alt+ArrowRight');
        await expect(row(page, 'p:c')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Alt+ArrowLeft');
        await expect(row(page, 'p:f')).toHaveAttribute('aria-selected', 'true');

        // Enter on a cell with one link jumps; a new jump drops the steps ahead.
        await (await cell(page, 'p:f', 'mother')).click({ position: { x: 4, y: 4 } });
        await expect(await cell(page, 'p:f', 'mother')).toHaveClass(/is-active-cell/);
        await expect(row(page, 'p:d')).not.toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Enter');
        await expect(row(page, 'p:d')).toHaveAttribute('aria-selected', 'true');
        await expect(forward(page)).toHaveAttribute('aria-disabled', 'true');
    });

    test('through a partner: the Partner cell on the union\'s line, the name it came from marked', async ({ page }) => {
        await openTable(page, false, 'b:overview');
        await (await cell(page, 'p:d', 'partner')).locator('.tv-nm--jump').click();
        const target = await cell(page, 'p:c#u1', 'partner');
        await expect(target).toHaveClass(/is-active-cell/);
        await expect(target.locator('.tv-nm.is-origin')).toHaveText('Lunara Pestvik');
    });

    test('a person the filter hides: the strip, Show for now (outside the filter), Clear filters', async ({ page }) => {
        await openTable(page, false);
        await tv(page, '.tv-search-q').fill('Arvid');
        await expect(tv(page, '.tv-status')).toContainText('1 of 6');
        const father = async () => (await cell(page, 'p:f', 'father')).locator('.tv-nm--jump');
        await (await father()).click();
        const notice = tv(page, '.tv-notice');
        await expect(notice).toBeVisible();
        await expect(notice.locator('.tv-notice-text')).toHaveText('Hidden by the filter: Kestrin Ostrolam.');
        await expect(row(page, 'p:c')).toHaveCount(0);

        await notice.getByRole('button', { name: 'Show for now' }).click();
        await expect(notice).toBeHidden();
        await expect(row(page, 'p:c')).toHaveClass(/is-temp/);
        await expect(row(page, 'p:c').locator('.tv-outside')).toHaveText('outside the filter');
        await expect(row(page, 'p:c')).toHaveAttribute('aria-selected', 'true');
        // Not counted among the rows the filter shows.
        await expect(tv(page, '.tv-status')).toContainText('1 of 6');
        await back(page).click();
        await expect(row(page, 'p:c')).toHaveCount(0);

        await (await father()).click();
        await notice.getByRole('button', { name: 'Clear filters' }).click();
        await expect(notice).toBeHidden();
        await expect(tv(page, '.tv-search-q')).toHaveValue('');
        await expect(tv(page, '.tv-status')).toContainText('6 of 6');
        await expect(row(page, 'p:c')).toHaveAttribute('aria-selected', 'true');
        await expect(row(page, 'p:c')).not.toHaveClass(/is-temp/);

        // × closes the strip.
        await tv(page, '.tv-search-q').fill('Arvid');
        await expect(tv(page, '.tv-status')).toContainText('1 of 6');
        await (await father()).click();
        await expect(notice).toBeVisible();
        await notice.getByRole('button', { name: 'Close' }).click();
        await expect(notice).toBeHidden();
    });

    test('a pinned person the filter hides: the jump goes to their pinned row, no strip, no row for now', async ({ page }) => {
        await openTable(page, false);
        const pinRow = (key: string) => tv(page, `.tv-pinrows .tv-row[data-key="${key}"]`);
        const bodyRow = (key: string) => tv(page, `.tv-body:not(.tv-pinbody) .tv-row[data-key="${key}"]`);
        await bodyRow('p:c').locator('.tv-name').click({ button: 'right' });
        await page.locator('.tv-menu .tv-menu-item[data-id="pin"]').click();
        await expect(pinRow('p:c')).toHaveCount(1);
        await tv(page, '.tv-search-q').fill('Arvid');
        await expect(tv(page, '.tv-status')).toContainText('1 of 6');
        await expect(pinRow('p:c')).toHaveClass(/is-outside/);

        await (await cell(page, 'p:f', 'father')).locator('.tv-nm--jump').click();
        const name = pinRow('p:c').locator('.tv-name');
        await expect(name).toHaveClass(/is-active-cell/);
        await expect(name).toBeFocused();
        await expect(pinRow('p:c')).toHaveAttribute('aria-selected', 'true');
        await expect(tv(page, '.tv-notice')).toBeHidden();
        await expect(bodyRow('p:c')).toHaveCount(0);
        await expect(tv(page, '.tv-row.is-temp')).toHaveCount(0);
        await expect(tv(page, '.tv-status')).toContainText('1 of 6');

        // ‹ back to the cell it started from, › to the pinned row again.
        await expect(back(page)).toHaveAttribute('aria-label', 'Back to Arvid Ostrolam');
        await back(page).click();
        await expect(await cell(page, 'p:f', 'father')).toHaveClass(/is-active-cell/);
        await forward(page).click();
        await expect(name).toHaveClass(/is-active-cell/);
        await expect(tv(page, '.tv-notice')).toBeHidden();
        await expect(bodyRow('p:c')).toHaveCount(0);
    });

    test('through a partner to a pinned person the filter hides: the Partner cell on the pinned union\'s line', async ({ page }) => {
        await openTable(page, false, 'b:overview');
        await tv(page, '.tv-body:not(.tv-pinbody) .tv-row[data-key="p:c"] .tv-name').click({ button: 'right' });
        await page.locator('.tv-menu .tv-menu-item[data-id="pin"]').click();
        await tv(page, '.tv-search-q').fill('1882');
        await expect(tv(page, '.tv-status')).toContainText('1 of 6');
        await (await cell(page, 'p:d', 'partner')).locator('.tv-nm--jump').click();
        const head = tv(page, '.tv-headrow [data-col]');
        const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
        const index = await head.nth(ids.indexOf('partner')).getAttribute('aria-colindex');
        const target = tv(page, `.tv-pinrows .tv-row[data-key="p:c#u1"] [aria-colindex="${index}"]`);
        await expect(target).toHaveClass(/is-active-cell/);
        await expect(target).toBeFocused();
        await expect(target.locator('.tv-nm.is-origin')).toHaveText('Lunara Pestvik');
        await expect(tv(page, '.tv-notice')).toBeHidden();
    });

    test('Events: a participant\'s menu starts with "Go to …", the jump to the People table and back', async ({ page }) => {
        await openTable(page, false);
        await tv(page, '.tv-rowtype [data-rowtype="events"]').click();
        await tv(page, '.tv-body .tv-nm[aria-haspopup="menu"]').filter({ hasText: 'Sorvela Brinkat' }).click();
        const menu = page.locator('.tv-menu');
        await expect(menu.locator('.tv-menu-label')).toHaveText(['Go to Sorvela Brinkat', 'Filter: godparent Sorvela Brinkat', 'Open person']);
        await menu.locator('.tv-menu-item[data-id="goTo"]').click();
        await expect(tv(page, '.tv-rowtype [data-rowtype="persons"]')).toHaveAttribute('aria-checked', 'true');
        await expect(row(page, 'p:e')).toHaveAttribute('aria-selected', 'true');
        await back(page).click();
        await expect(tv(page, '.tv-rowtype [data-rowtype="events"]')).toHaveAttribute('aria-checked', 'true');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

    test('the row sheet lists the people in the cell; a tap on one jumps', async ({ page }) => {
        await openTable(page, true);
        await (await cell(page, 'p:f', 'father')).tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-section').first()).toHaveText('People in the cell');
        const go = sheet.locator('.bottom-sheet-item').first();
        await expect(go.locator('.bottom-sheet-label')).toHaveText('Go to Kestrin Ostrolam');
        expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await go.tap();
        await expect(sheet).toBeHidden();
        await expect(row(page, 'p:c')).toHaveAttribute('aria-selected', 'true');
        await expect(back(page)).toBeVisible();
        const nav = (await back(page).boundingBox())!;
        expect(nav.width).toBeGreaterThanOrEqual(44);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow).toBe(false);
    });
});
