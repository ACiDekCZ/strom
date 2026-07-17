import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * Responsive toolbar regimes. The toolbar has exactly two regimes, split at
 * the 1024px tablet boundary (the app's real boundary — CLAUDE.md's generic
 * "three modes / 900px" note does not apply to this toolbar):
 *
 *   > 1024  desktop   : the view-mode segment is shown, the bottom bar hidden,
 *                       the ⋯ actions menu present, generation controls live in
 *                       the floating focus bar. At > 1280 the standalone ⚙ and
 *                       "Actions" label appear; at ≤ 1280 they fold into ⋯.
 *   ≤ 1024  bottom bar : the segment is hidden (views live on the bottom bar's
 *                        tabs), the desktop ⋯ menu is hidden (its items live in
 *                        the "More" sheet, opened by the bottom-bar "More" tab
 *                        and the top-bar ⋯), generation controls live inline in
 *                        .toolbar-focus (600–1024) or the floating chip (≤ 600).
 *
 * Invariants asserted at every probed width:
 *   1. exactly one view surface — segment XOR bottom-bar tabs,
 *   2. exactly one Settings entry point (standalone ⚙ / folded ⋯ / More sheet),
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
        // The bottom bar replaces the old hamburger across the ≤1024 regime.
        const bottomBarTabs = shown(document.getElementById('bb-view-family'));

        // Settings entry points (exactly one must be active):
        //  - standalone ⚙ (> 1280)
        //  - the ⚙ item folded into the ⋯ actions menu (1024 < w ≤ 1280)
        //  - the bottom-bar "More" tab → the More sheet, which carries Settings (≤ 1024)
        const standaloneSettings = displayed(document.querySelector('.actions-toolbar-settings'));
        const actionsMenuPresent = displayed(document.querySelector('.actions-menu'));
        const foldedSettings = actionsMenuPresent
            && displayed(document.querySelector('.actions-menu-settings'));
        const moreSheetHome = shown(document.getElementById('bb-view-more'));
        const settingsSurfaces =
            (standaloneSettings ? 1 : 0) + (foldedSettings ? 1 : 0) + (moreSheetHome ? 1 : 0);

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
            segment, bottomBarTabs,
            settingsSurfaces, standaloneSettings, foldedSettings, moreSheetHome,
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
        const famBtn = document.getElementById('toolbar-family-btn');
        if (famBtn) famBtn.style.display = '';
    });

    for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 850 });
        await page.waitForTimeout(60);
        const s = await probe(page);
        const at = `@${w}px`;

        // 1. Exactly one view surface.
        expect(s.segment !== s.bottomBarTabs, `${at}: segment XOR bottom-bar tabs (seg=${s.segment} bar=${s.bottomBarTabs})`).toBe(true);
        if (w > 1024) {
            expect(s.segment, `${at}: desktop shows the segment`).toBe(true);
        } else {
            expect(s.bottomBarTabs, `${at}: mobile regime shows the bottom-bar tabs`).toBe(true);
            expect(s.moreSheetHome, `${at}: bottom bar carries the "More" tab`).toBe(true);
        }

        // 2. Exactly one Settings entry point.
        expect(s.settingsSurfaces, `${at}: exactly one Settings surface`).toBe(1);

        // 3. Exactly one generation-depth surface (never zero, never duplicated).
        expect(s.depthSurfaces, `${at}: exactly one generation-depth surface`).toBe(1);

        // 4. Nothing clips.
        expect(s.clipped, `${at}: no clipped toolbar children`).toEqual([]);
    }
});

/**
 * Regression guard for the ~1000–1100px "Letopis" regressions. The original
 * spec (above) only checked `offsetWidth > 0` at a handful of widths in en-US,
 * so it missed three real defects:
 *   1. the view tabs being present in the DOM but clipped/pushed off-screen
 *      (an element with width can still be outside the viewport, or covered),
 *   2. the switcher un-folding non-monotonically while shrinking,
 *   3. the ⋯ trigger rendering as a solid primary-green square (a generic
 *      `.toolbar button { background: var(--primary) }` beating a low-specificity
 *      ghost rule) — never caught because colour was never asserted.
 * These tests sweep finely, in cs-CZ (the widest labels), with a stressed
 * toolbar, and assert geometry + colour, not mere presence.
 */
test.describe('view switcher — monotonic, in-viewport, ghost ⋯ (cs-CZ, stressed)', () => {
    test.use({ locale: 'cs-CZ' });

    async function primaryGreen(page: Page): Promise<string> {
        return page.evaluate(() => {
            const p = document.createElement('div');
            p.style.background = 'var(--primary)';
            document.body.appendChild(p);
            const c = getComputedStyle(p).backgroundColor;
            p.remove();
            return c;
        });
    }

    /** Geometry + colour of the view switcher and the visible ⋯ trigger. */
    async function probeView(page: Page) {
        return page.evaluate(() => {
            const vw = window.innerWidth;
            const shown = (el: Element | null): boolean => {
                if (!el) return false;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            };

            const seg = document.getElementById('view-mode-segment');
            const segShown = shown(seg);
            let segInViewport = true;
            let segTabsHit = true;
            if (segShown && seg) {
                const r = seg.getBoundingClientRect();
                // The whole segment must sit inside the viewport, not clipped.
                segInViewport = r.left >= -1 && r.right <= vw + 1 && r.top >= -1;
                // Every tab must be the top-most element at its own centre — i.e.
                // actually visible and clickable, not covered or off-screen.
                for (const tab of Array.from(seg.querySelectorAll('button'))) {
                    const tr = tab.getBoundingClientRect();
                    if (tr.width === 0) continue;
                    const cx = tr.left + tr.width / 2, cy = tr.top + tr.height / 2;
                    if (cx < 0 || cx > vw || cy < 0) { segTabsHit = false; break; }
                    const hit = document.elementFromPoint(cx, cy);
                    if (!hit || !(hit === tab || tab.contains(hit))) { segTabsHit = false; break; }
                }
            }

            const bbTabs = shown(document.getElementById('bb-view-family'));

            // The ⋯ trigger currently on screen: desktop actions menu (>1024) or
            // the mobile "More" button (≤1024).
            const desktopDots = document.querySelector('.actions-menu-btn');
            const mobileDots = document.querySelector('.mobile-more-btn');
            const dots = shown(desktopDots) ? desktopDots : (shown(mobileDots) ? mobileDots : null);
            const dotsBg = dots ? getComputedStyle(dots).backgroundColor : null;

            return { vw, segShown, segInViewport, segTabsHit, bbTabs, dotsBg };
        });
    }

    test('tabs stay in-viewport and hit-testable, fold exactly once, ⋯ never green', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 850 });
        await openApp(page);
        // The empty state already carries the full toolbar (segment, ⋯,
        // add-person) and the bottom bar; no person needed. Creating one is
        // avoided on purpose — the add-person helper keys off the English
        // "Save" label and this context runs in cs-CZ.

        // Stress every width-hungry toolbar element at once.
        await page.evaluate(() => {
            const name = document.getElementById('current-tree-name');
            if (name) name.textContent = 'Velmi Dlouhy Nazev Rodokmenu Test XYZ';
            const famBtn = document.getElementById('toolbar-family-btn');
            if (famBtn) famBtn.style.display = '';
            const fileBtn = document.getElementById('file-link-indicator');
            if (fileBtn) fileBtn.style.display = '';
        });

        const green = await primaryGreen(page);

        let sawFold = false;        // segment has disappeared at least once
        let prevSegShown: boolean | null = null;

        for (let w = 1600; w >= 360; w -= 40) {
            await page.setViewportSize({ width: w, height: 850 });
            await page.waitForTimeout(50);
            const s = await probeView(page);
            const at = `@${w}px`;

            // Exactly one view surface, always.
            expect(s.segShown !== s.bbTabs, `${at}: segment XOR bottom-bar tabs (seg=${s.segShown} bar=${s.bbTabs})`).toBe(true);

            // The desktop segment, when shown, is fully on-screen and clickable.
            if (s.segShown) {
                expect(s.segInViewport, `${at}: segment fully within the viewport (not clipped/pushed off)`).toBe(true);
                expect(s.segTabsHit, `${at}: every view tab is the top-most element at its centre`).toBe(true);
            }

            // Monotonic fold: once the segment folds away while shrinking it must
            // never reappear on the surface.
            if (prevSegShown === false && s.segShown === true) {
                throw new Error(`${at}: view segment reappeared after folding — non-monotonic (oscillation)`);
            }
            if (prevSegShown === true && s.segShown === false) sawFold = true;
            if (sawFold) {
                expect(s.segShown, `${at}: segment stays folded once it has folded`).toBe(false);
            }
            prevSegShown = s.segShown;

            // The ⋯ trigger is a ghost button, never the primary-green fill.
            expect(s.dotsBg, `${at}: ⋯ trigger must not be primary-green`).not.toBe(green);
        }

        // Sanity: we actually observed the fold within the swept range.
        expect(sawFold, 'the segment folded into the bottom bar somewhere in 360–1600px').toBe(true);
    });

    test('the mobile ⋯ stays ghost at rest, on hover, and when its sheet is open', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 850 });
        await openApp(page);
        const green = await primaryGreen(page);
        const dots = page.locator('.mobile-more-btn');

        const bg = () => dots.evaluate((e) => getComputedStyle(e).backgroundColor);
        expect(await bg(), 'resting ⋯ is not primary-green').not.toBe(green);
        await dots.hover();
        expect(await bg(), 'hovered ⋯ is not primary-green').not.toBe(green);
        await dots.click();  // opens the More sheet
        await page.waitForTimeout(50);
        expect(await bg(), 'open-state ⋯ is not primary-green').not.toBe(green);
    });
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
