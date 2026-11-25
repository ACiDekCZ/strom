/**
 * A menu of the rule builder by a button near the window's bottom (spec 136,
 * U4): the catalog of conditions and a row's ⋯ open upwards when there is
 * little room under the button and more over it, so the menu lies whole in the
 * window and shows at least five rows (all of a shorter menu) without a scroll
 * inside it; it does not cover its button. At 1024 × 768 and 1440 × 900.
 */

import { test, expect, Locator, Page } from '@playwright/test';
import { form, lists, openList, seedFamily } from './list-rules-seed';

/** The open menu's box, its button's box and how many of its rows are wholly visible. */
async function placement(page: Page, button: Locator): Promise<{ top: number; bottom: number; full: number; view: number; shown: number; rows: number; btnTop: number; btnBottom: number }> {
    const b = await button.boundingBox();
    const m = await page.locator('.plr-menu').evaluate((menu) => {
        const r = menu.getBoundingClientRect();
        // The rows' box inside the menu (below a sticky search field, if any).
        const list = menu.querySelector<HTMLElement>('.pl-mlist') ?? menu;
        const search = menu.querySelector<HTMLElement>('.pl-msearch')?.getBoundingClientRect();
        const lo = Math.max(r.top, search ? search.bottom : r.top, 0);
        const hi = Math.min(r.bottom, window.innerHeight);
        const items = Array.from(list.querySelectorAll<HTMLElement>('.pl-menu-item')).filter(i => i.getClientRects().length);
        const shown = items.filter(i => { const x = i.getBoundingClientRect(); return x.top >= lo - 0.5 && x.bottom <= hi + 0.5; }).length;
        return { top: r.top, bottom: r.bottom, full: menu.scrollHeight + menu.offsetHeight - menu.clientHeight, view: window.innerHeight, shown, rows: items.length };
    });
    return { ...m, btnTop: b!.y, btnBottom: b!.y + b!.height };
}

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test.describe(`Rule menus near the bottom at ${viewport.width}`, () => {
        test.use({ viewport });

        test('the catalog and a row\'s ⋯ open upwards, whole and with five rows in sight', async ({ page }) => {
            await seedFamily(page, 'de');
            await openList(page, 'l-wide');
            await lists(page).locator('.pl-rule [data-act="edit-rule"], .pl-rule [data-act="whole-rule"]').first().click();
            const f = form(page);
            await expect(f.locator('.plr-row[data-path="1.1"]')).toBeVisible();
            const toEnd = (): Promise<void> => f.locator('.pln-body').evaluate(b => { b.scrollTop = b.scrollHeight; });

            /** Opens the menu of `button` near the window's bottom and checks where it lies. */
            const check = async (what: string, button: Locator): Promise<void> => {
                await toEnd();
                await expect(button).toBeInViewport();
                await button.click();
                await expect(page.locator('.plr-menu')).toBeVisible();
                const p = await placement(page, button);
                // Too little room under the button for the whole menu.
                expect(p.full + 12, `${what}: its button is near the bottom`).toBeGreaterThan(p.view - p.btnBottom);
                expect(p.top, `${what} starts in the window`).toBeGreaterThanOrEqual(0);
                expect(p.bottom, `${what} ends in the window`).toBeLessThanOrEqual(p.view);
                expect(p.bottom, `${what} opens upwards, over its button`).toBeLessThanOrEqual(p.btnTop + 0.5);
                expect(p.shown, `${what}: rows in sight`).toBeGreaterThanOrEqual(Math.min(5, p.rows));
            };

            // The builder scrolled to its end: "+ Add condition" sits near the window's bottom.
            await check('the catalog', f.locator('.plr > .plr-add [data-rb="add"]'));
            // A condition added at the end: its row's ⋯ is the lowest.
            const rows = f.locator('.plr > .plr-rows > .plr-row');
            const before = await rows.count();
            await page.locator('.plr-menu .pl-menu-item[data-id="alive"]').click();
            await expect(page.locator('.plr-menu')).toHaveCount(0);
            await expect(rows).toHaveCount(before + 1);
            const last = rows.last();
            await check('the last row\'s ⋯', last.locator('> .plr-d'));
            await page.keyboard.press('Escape');
            await expect(page.locator('.plr-menu')).toHaveCount(0);
        });
    });
}
