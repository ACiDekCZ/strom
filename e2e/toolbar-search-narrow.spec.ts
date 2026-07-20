import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction } from './helpers.js';

/**
 * ZADANI kolo 12 §4.2 — the toolbar search stays usable as it narrows.
 * The "/" keyboard-shortcut chip is a desktop-keyboard hint and is dropped on
 * the tablet/mobile regime (≤1024px), which frees the input next to the
 * magnifier + funnel. In the tablet band the input keeps a usable width.
 */
test('search: "/" chip hidden ≤1024px and the input keeps a usable width in the tablet band', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 850 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    // Stress the toolbar exactly like the real audit (a long tree name).
    await page.evaluate(() => {
        const n = document.getElementById('current-tree-name');
        if (n) n.textContent = 'Velmi Dlouhy Nazev Rodokmenu Test XYZ';
    });

    const probe = () => page.evaluate(() => {
        const inp = document.querySelector('#toolbar-search-picker .person-picker-input') as HTMLElement | null;
        const chip = document.querySelector('.search-shortcut') as HTMLElement | null;
        const funnel = document.querySelector('.search-filter-toggle') as HTMLElement | null;
        return {
            input: inp ? Math.round(inp.getBoundingClientRect().width) : -1,
            chipHidden: !chip || getComputedStyle(chip).display === 'none',
            funnelShown: !!funnel && getComputedStyle(funnel).display !== 'none',
        };
    });

    // Desktop: the chip is present.
    await page.setViewportSize({ width: 1200, height: 850 });
    await page.waitForTimeout(60);
    expect((await probe()).chipHidden, '@1200: chip present on desktop').toBe(false);

    // Tablet band and down: chip dropped, funnel kept, input ≥80px in the band.
    for (const w of [700, 768, 900, 1024]) {
        await page.setViewportSize({ width: w, height: 850 });
        await page.waitForTimeout(60);
        const s = await probe();
        expect(s.chipHidden, `@${w}px: "/" chip hidden`).toBe(true);
        expect(s.funnelShown, `@${w}px: funnel filter kept`).toBe(true);
        expect(s.input, `@${w}px: search input ≥80px (got ${s.input})`).toBeGreaterThanOrEqual(80);
    }
});
