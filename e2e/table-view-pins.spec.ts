import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * Pinned rows of the Table (spec 103 U3, §3): the row menu pins a row (or
 * the rows of a range selected across rows), the pinned rows stay under the
 * head while the body scrolls and while a filter hides them, the bar's chip
 * "Pinned rows (n)" × unpins all, Unpin row unpins one, at most 10, another
 * row type drops them; a tablet's row sheet offers it, a phone's does not.
 */

const NAMES = ['Drevan', 'Kestrin', 'Arvid', 'Tolmar', 'Brisen', 'Halvek', 'Orrin', 'Zemrik', 'Pellar', 'Quovan'];

/** 40 people born a year apart (the table's order by birth): r0 … r19 Ostrolam, r20 … r39 Pestvik. */
const PEOPLE: Record<string, SeedPerson> = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`r${i}`, {
    firstName: `${NAMES[i % NAMES.length]}${i}`, lastName: i < 20 ? 'Ostrolam' : 'Pestvik', birthDate: `${1800 + i}-03-02`,
}]));

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const row = (page: Page, key: string) => tv(page, `.tv-body:not(.tv-pinbody) .tv-row[data-key="${key}"]`);
const pinned = (page: Page) => tv(page, '.tv-pinrows .tv-row.is-pinned');
const menu = (page: Page) => page.locator('.tv-menu');

async function openTable(page: Page, phone = false): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, PEOPLE, 'Ostrolam', 'r0');
    if (phone) await page.locator('#bb-view-table').click();
    else await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
    await expect(tv(page, '.tv-grid')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.openTableView('b:births'));
    await expect(tv(page, '.tv-status')).toContainText('40 of 40');
}

/** The row's menu by a right click on its name, then its pin item. */
async function pinItem(page: Page, key: string, zone = false) {
    const r = zone ? tv(page, `.tv-pinrows .tv-row[data-key="${key}"]`) : row(page, key);
    await r.locator('.tv-name').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    return menu(page).locator('.tv-menu-item[data-id="pin"], .tv-menu-item[data-id="unpin"]');
}

async function pinRow(page: Page, key: string): Promise<void> {
    const item = await pinItem(page, key);
    await expect(item).toHaveAttribute('data-id', 'pin');
    await item.click();
    await expect(menu(page)).toBeHidden();
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Pin row keeps it under the head while the body scrolls and a filter hides it; Unpin row and the chip\'s × unpin', async ({ page }) => {
        await openTable(page);
        await expect(tv(page, '.tv-pinrows')).toBeHidden();
        await expect(tv(page, '.tv-pinchip')).toHaveCount(0);

        const item = await pinItem(page, 'p:r0');
        await expect(item.locator('.tv-menu-label')).toHaveText('Pin row');
        await item.click();
        await expect(tv(page, '.tv-pinrows')).toBeVisible();
        await expect(tv(page, '.tv-pinrows')).toHaveAttribute('aria-label', 'Pinned rows');
        await expect(pinned(page)).toHaveCount(1);
        await expect(pinned(page)).toHaveAttribute('aria-label', 'Pinned row: Drevan0 Ostrolam');
        await expect(pinned(page).locator('.tv-pin:not(.tv-pin--outline)')).toHaveCount(1);
        // The row in the body stays, with the pin's outline only.
        await expect(row(page, 'p:r0').locator('.tv-pin--outline')).toHaveCount(1);
        await expect(tv(page, '.tv-pinchip-text')).toHaveText('Pinned rows (1)');

        // The body scrolls to its end: the pinned row stays under the head.
        await tv(page, '.tv-grid').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(row(page, 'p:r39')).toBeVisible();
        await expect(pinned(page)).toBeInViewport();
        const head = (await tv(page, '.tv-headrow').boundingBox())!;
        const pin = (await pinned(page).boundingBox())!;
        expect(pin.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
        expect(pin.y).toBeLessThan(head.y + head.height + 60);

        // A search hides the row: it stays pinned, dimmed, "outside the filter", not counted.
        await tv(page, '.tv-search-q').fill('Pestvik');
        await expect(tv(page, '.tv-status')).toContainText('20 of 40');
        await expect(pinned(page)).toHaveCount(1);
        await expect(pinned(page)).toHaveClass(/is-outside/);
        await expect(pinned(page)).toContainText('outside the filter');
        await tv(page, '.tv-search-q').fill('');
        await expect(tv(page, '.tv-status')).toContainText('40 of 40');
        await expect(pinned(page)).not.toHaveClass(/is-outside/);

        // Unpin row, from the pinned row's menu.
        const unpin = await pinItem(page, 'p:r0', true);
        await expect(unpin).toHaveAttribute('data-id', 'unpin');
        await expect(unpin.locator('.tv-menu-label')).toHaveText('Unpin row');
        await unpin.click();
        await expect(tv(page, '.tv-pinrows')).toBeHidden();
        await expect(tv(page, '.tv-pinchip')).toHaveCount(0);
        await expect(row(page, 'p:r0').locator('.tv-pin')).toHaveCount(0);

        // The chip's × unpins all.
        await tv(page, '.tv-grid').evaluate(el => { el.scrollTop = 0; });
        await pinRow(page, 'p:r1');
        await pinRow(page, 'p:r2');
        await expect(pinned(page)).toHaveCount(2);
        const x = tv(page, '.tv-pinchip-x');
        await expect(x).toHaveAttribute('aria-label', 'Unpin all rows');
        await x.click();
        await expect(tv(page, '.tv-pinrows')).toBeHidden();
        await expect(tv(page, '.tv-pinchip')).toHaveCount(0);
    });

    test('at most 10 rows: the part scrolls on its own past a third of the body, the 11th is disabled with why', async ({ page }) => {
        await openTable(page);
        for (let i = 0; i < 10; i++) await pinRow(page, `p:r${i}`);
        await expect(pinned(page)).toHaveCount(10);
        await expect(tv(page, '.tv-pinchip-text')).toHaveText('Pinned rows (10)');
        // In the table's order (by birth), not the order pinned.
        await expect(pinned(page).first()).toHaveAttribute('data-key', 'p:r0');
        const zone = tv(page, '.tv-pinrows');
        await expect(zone).toHaveClass(/has-scroll/);
        const [zoneH, gridH] = await Promise.all([
            zone.evaluate(el => el.getBoundingClientRect().height), tv(page, '.tv-grid').evaluate(el => el.clientHeight),
        ]);
        expect(zoneH).toBeLessThanOrEqual(gridH / 3 + 2);

        const item = await pinItem(page, 'p:r10');
        await expect(item).toHaveAttribute('aria-disabled', 'true');
        await expect(item).toHaveAttribute('title', 'At most 10 rows can be pinned.');
        await item.click({ force: true });
        await expect(pinned(page)).toHaveCount(10);
    });

    test('a range selected across rows pins its rows; another row type unpins all', async ({ page }) => {
        await openTable(page);
        // A drag across three rows selects their text (the grid's range).
        const from = (await row(page, 'p:r1').locator('.tv-name').boundingBox())!;
        const to = (await row(page, 'p:r3').locator('[aria-colindex="3"]').boundingBox())!;
        await page.mouse.move(from.x + 4, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();
        expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('Tolmar3');

        await row(page, 'p:r2').locator('.tv-name').click({ button: 'right' });
        const item = menu(page).locator('.tv-menu-item[data-id="pin"]');
        await expect(item.locator('.tv-menu-label')).toHaveText('Pin rows (3)');
        // The cell's part is Copy only for a range.
        await expect(menu(page).locator('.tv-menu-item[data-id="cellCopy"]')).toHaveCount(1);
        await item.click();
        await expect(pinned(page)).toHaveCount(3);
        expect(await pinned(page).evaluateAll(els => els.map(el => (el as HTMLElement).dataset.key))).toEqual(['p:r1', 'p:r2', 'p:r3']);

        // Another row type unpins them; back on People none are pinned.
        await tv(page, '.tv-rowtype [data-rowtype="unions"]').click();
        await expect(tv(page, '.tv-pinrows')).toBeHidden();
        await tv(page, '.tv-rowtype [data-rowtype="persons"]').click();
        await expect(tv(page, '.tv-status')).toContainText('40 of 40');
        await expect(tv(page, '.tv-pinrows')).toBeHidden();
        await expect(tv(page, '.tv-pinchip')).toHaveCount(0);
    });
});

test.describe('tablet (1024, touch)', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

    test('the row sheet offers Pin row', async ({ page }) => {
        await openTable(page);
        await row(page, 'p:r0').locator('.tv-name').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        const item = sheet.locator('.bottom-sheet-item').filter({ hasText: 'Pin row' });
        await expect(item).toHaveCount(1);
        await item.tap();
        await expect(pinned(page)).toHaveCount(1);
        await expect(tv(page, '.tv-pinchip-text')).toHaveText('Pinned rows (1)');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

    test('no pins: the row sheet has no Pin row', async ({ page }) => {
        await openTable(page, true);
        await row(page, 'p:r0').locator('[aria-colindex="2"]').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-item').first()).toBeVisible();
        await expect(sheet).not.toContainText('Pin row');
        await expect(tv(page, '.tv-pinrows')).toBeHidden();
    });
});
