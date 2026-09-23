import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

/** The expected group order: the person itself → add relatives → the rest. */
const ORDER = ['edit', 'focus', 'descendants', 'parent', 'partner', 'child', 'sibling', 'add-family',
    'relationship', 'archives', 'toggle-lock', 'merge', 'delete'];

async function actionsOf(page: Page, selector: string): Promise<string[]> {
    return page.locator(`${selector} [data-action]`).evaluateAll(
        (els) => els.map((el) => (el as HTMLElement).dataset.action || ''));
}

/**
 * In the bottom-navigation regime (≤ 1024px) the card menu is a bottom sheet,
 * like the "More" menu: a floating menu there ended up under the bottom bar
 * and the add button. Every row must be reachable and clickable.
 */
for (const width of [600, 924, 1024]) {
    test(`card menu is a bottom sheet with every row clickable at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 720 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await card(page, 'Jan').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        await expect(page.locator('.context-menu')).toHaveCount(0);
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('Jan Novak');
        expect(await actionsOf(page, '.bottom-sheet-person')).toEqual(ORDER);

        // Actionability (visible, stable, receives the pointer — not covered by
        // the bottom bar or the FAB) for every row, scrolling as needed.
        for (const action of ORDER) {
            await sheet.locator(`[data-action="${action}"]`).click({ trial: true });
        }

        // And a real click does its job.
        await sheet.locator('[data-action="edit"]').click();
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(sheet).toHaveCount(0);
    });
}

/**
 * On desktop the floating menu lives between the toolbar and the window's
 * bottom edge: it never covers the toolbar, and a list taller than that
 * space scrolls instead of running off screen.
 */
test('desktop card menu stays below the toolbar and scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await card(page, 'Jan').click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
    expect(await actionsOf(page, '.context-menu')).toEqual(ORDER);

    const geo = await page.evaluate(() => {
        const m = document.querySelector('.context-menu') as HTMLElement;
        const r = m.getBoundingClientRect();
        const tb = document.querySelector('.toolbar')!.getBoundingClientRect();
        return {
            top: r.top, bottom: r.bottom, toolbarBottom: tb.bottom, vh: window.innerHeight,
            scrollable: m.scrollHeight > m.clientHeight,
            overflowY: getComputedStyle(m).overflowY,
        };
    });
    expect(geo.top).toBeGreaterThanOrEqual(geo.toolbarBottom);
    expect(geo.bottom).toBeLessThanOrEqual(geo.vh - 8 + 0.5);
    expect(geo.scrollable, 'the list is taller than the space: it scrolls').toBe(true);
    expect(geo.overflowY).toBe('auto');

    // The last row is reachable by scrolling.
    await menu.locator('[data-action="delete"]').click({ trial: true });
});
