import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * Responsive toolbar regimes. The toolbar has exactly two regimes, split at
 * the 1024px tablet boundary (the app's real boundary — CLAUDE.md's generic
 * "three modes / 900px" note does not apply to this toolbar):
 *
 *   > 1024  desktop  : the view-mode segment is shown, the hamburger hidden,
 *                      the ⋯ actions menu present, generation controls live in
 *                      the floating focus bar. At > 1280 the standalone ⚙ and
 *                      "Actions" label appear; at ≤ 1280 they fold into ⋯.
 *   ≤ 1024  hamburger: the segment is hidden (views live in the hamburger's
 *                      view row), the ⋯ menu is hidden (its items live in the
 *                      hamburger), generation controls live inline in
 *                      .toolbar-focus (600–1024) or the floating bar (≤ 600).
 *
 * Invariants asserted at every probed width:
 *   1. exactly one view surface — segment XOR hamburger,
 *   2. exactly one Settings entry point,
 *   3. exactly one generation-depth control surface (never zero),
 *   4. no toolbar child clips past the toolbar's left/right edge — stressed
 *      with a long tree name and the opt-in family-wizard button enabled.
 */

const WIDTHS = [360, 500, 700, 900, 1000, 1024, 1100, 1280, 1400];

/** Read the responsive state of the toolbar in one page round-trip. */
async function probe(page: Page) {
    return page.evaluate(() => {
        const shown = (el: Element | null): boolean => {
            if (!el) return false;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const displayed = (el: Element | null): boolean =>
            !!el && getComputedStyle(el).display !== 'none';

        const segment = shown(document.getElementById('view-mode-segment'));
        const hamburger = shown(document.querySelector('.hamburger-btn'));
        const viewRowInHamburger = !!document.getElementById('mm-view-family');

        // Settings entry points (exactly one must be active):
        //  - standalone ⚙ (> 1280)
        //  - the ⚙ item folded into the ⋯ actions menu (1024 < w ≤ 1280)
        //  - the hamburger (≤ 1024)
        const standaloneSettings = displayed(document.querySelector('.actions-toolbar-settings'));
        const actionsMenuPresent = displayed(document.querySelector('.actions-menu'));
        const foldedSettings = actionsMenuPresent
            && displayed(document.querySelector('.actions-menu-settings'));
        const settingsSurfaces =
            (standaloneSettings ? 1 : 0) + (foldedSettings ? 1 : 0) + (hamburger ? 1 : 0);

        // Generation-depth controls: inline (.toolbar-focus) or floating bar.
        const toolbarDepth = shown(document.getElementById('toolbar-depth-up'));
        const floatingDepth = shown(document.getElementById('focus-depth-up'));
        const depthSurfaces = (toolbarDepth ? 1 : 0) + (floatingDepth ? 1 : 0);

        // Clip audit: every visible toolbar child stays within the bar.
        const tb = document.querySelector('.toolbar') as HTMLElement;
        const tr = tb.getBoundingClientRect();
        const clipped: string[] = [];
        for (const c of Array.from(tb.children)) {
            if (getComputedStyle(c).display === 'none') continue;
            const r = c.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.right > tr.right + 1 || r.left < tr.left - 1) {
                clipped.push((c as HTMLElement).className || c.id);
            }
        }

        return {
            segment, hamburger, viewRowInHamburger,
            settingsSurfaces, standaloneSettings, foldedSettings,
            depthSurfaces, toolbarDepth, floatingDepth, clipped,
        };
    });
}

test('toolbar regimes have no duplicated or missing controls at any width', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 850 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Stress the layout: a 30+ char tree name and the opt-in family button on.
    await page.evaluate(() => {
        const name = document.getElementById('current-tree-name');
        if (name) name.textContent = 'Velmi Dlouhy Nazev Rodokmenu Test XYZ';
        for (const id of ['toolbar-family-btn', 'mm-family-btn']) {
            const b = document.getElementById(id);
            if (b) b.style.display = '';
        }
    });

    for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 850 });
        await page.waitForTimeout(60);
        const s = await probe(page);
        const at = `@${w}px`;

        // 1. Exactly one view surface.
        expect(s.segment !== s.hamburger, `${at}: segment XOR hamburger (seg=${s.segment} ham=${s.hamburger})`).toBe(true);
        if (w > 1024) {
            expect(s.segment, `${at}: desktop shows the segment`).toBe(true);
        } else {
            expect(s.hamburger, `${at}: hamburger regime shows the hamburger`).toBe(true);
            expect(s.viewRowInHamburger, `${at}: hamburger carries the view row`).toBe(true);
        }

        // 2. Exactly one Settings entry point.
        expect(s.settingsSurfaces, `${at}: exactly one Settings surface`).toBe(1);

        // 3. Exactly one generation-depth surface (never zero, never duplicated).
        expect(s.depthSurfaces, `${at}: exactly one generation-depth surface`).toBe(1);

        // 4. Nothing clips.
        expect(s.clipped, `${at}: no clipped toolbar children`).toEqual([]);
    }
});

test.describe('the 1280 fold boundary', () => {
    test('at 1281 the standalone ⚙ and Actions label are out; at 1280 they fold in', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.setViewportSize({ width: 1281, height: 850 });
        await page.waitForTimeout(60);
        expect(await page.locator('.actions-toolbar-settings').evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
        expect(await page.locator('.actions-menu-label').evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
        expect(await page.locator('.actions-menu-settings').first().evaluate((e) => getComputedStyle(e).display)).toBe('none');

        await page.setViewportSize({ width: 1280, height: 850 });
        await page.waitForTimeout(60);
        expect(await page.locator('.actions-toolbar-settings').evaluate((e) => getComputedStyle(e).display)).toBe('none');
        expect(await page.locator('.actions-menu-label').evaluate((e) => getComputedStyle(e).display)).toBe('none');
        expect(await page.locator('.actions-menu-settings').first().evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
    });
});
