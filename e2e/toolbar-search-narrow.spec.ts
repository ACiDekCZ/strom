import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, settleLayout } from './helpers.js';

/**
 * ZADANI kolo 12 §4.2 — the toolbar search stays usable as it narrows.
 * The "/" keyboard-shortcut chip is a desktop-keyboard hint and is dropped on
 * the tablet/mobile regime (≤1024px), which frees the input next to the
 * magnifier + funnel. In the tablet band the input keeps a usable width, or,
 * where the bar cannot give it that room, folds into the magnifier: the top
 * bar carries the window's selection in every tree (spec 098 §10), and at
 * 641-768 px with a long tree name the field had a stub of 9-57 px beside it.
 * Nothing in the bar overflows at any width.
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
        const toolbar = document.querySelector('.toolbar') as HTMLElement;
        const magnifier = document.querySelector('.toolbar .search-open-btn') as HTMLElement | null;
        return {
            input: inp ? Math.round(inp.getBoundingClientRect().width) : -1,
            chipHidden: !chip || getComputedStyle(chip).display === 'none',
            funnelShown: !!funnel && getComputedStyle(funnel).display !== 'none',
            folded: toolbar.classList.contains('toolbar-squeeze-3') && !!magnifier && magnifier.getClientRects().length > 0,
            overflow: toolbar.scrollWidth - toolbar.clientWidth,
        };
    });

    // Desktop: the chip is present.
    await page.setViewportSize({ width: 1200, height: 850 });
    await settleLayout(page, '#toolbar-search-picker .person-picker-input');
    const desktop = await probe();
    expect(desktop.chipHidden, '@1200: chip present on desktop').toBe(false);
    expect(desktop.overflow, '@1200: nothing in the bar overflows').toBeLessThanOrEqual(0);

    // Tablet band and down: chip dropped, funnel kept, input ≥80px in the band
    // (900 and 1024 px hold it; 700 and 768 px may fold it into the magnifier).
    for (const w of [700, 768, 900, 1024]) {
        await page.setViewportSize({ width: w, height: 850 });
        await settleLayout(page, '#toolbar-search-picker .person-picker-input');
        const s = await probe();
        expect(s.chipHidden, `@${w}px: "/" chip hidden`).toBe(true);
        expect(s.overflow, `@${w}px: nothing in the bar overflows`).toBeLessThanOrEqual(0);
        if (w <= 768 && s.folded) continue;
        expect(s.funnelShown, `@${w}px: funnel filter kept`).toBe(true);
        expect(s.input, `@${w}px: search input ≥80px (got ${s.input})`).toBeGreaterThanOrEqual(80);
    }
});
