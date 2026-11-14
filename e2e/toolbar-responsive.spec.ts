import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, settleLayout } from './helpers.js';
import { fakeBridge, openResearch, poll } from './research-bridge.js';

/**
 * Responsive toolbar regimes. The toolbar has exactly two regimes, split at
 * the 1024px toolbar boundary — the documented content-driven exception to the
 * 499/900 breakpoint map (index.html, src/breakpoints.ts), because the desktop
 * toolbar does not fit below it:
 *
 *   > 1024  desktop   : the view-mode segment is shown, the bottom bar hidden,
 *                       the ⋯ actions menu present, generation controls live in
 *                       the floating focus bar. At > 1280 the standalone ⚙ and
 *                       "Actions" label appear; at ≤ 1280 they fold into ⋯.
 *   ≤ 1024  bottom bar : the segment is hidden (views live on the bottom bar's
 *                        tabs), the desktop ⋯ menu is hidden (its items live in
 *                        the "More" sheet, opened by the bottom-bar "More" tab
 *                        and the top-bar ⋯), generation controls live inline in
 *                        .toolbar-focus (641–1024) or the floating chip (≤ 640,
 *                        the phone-chrome exception: the inline toolbar does
 *                        not fit below it).
 *
 * Invariants asserted at every probed width:
 *   1. exactly one view surface — segment XOR bottom-bar tabs,
 *   2. exactly one Settings entry point (the last ⋯ Actions row / More sheet),
 *   3. exactly one generation-depth control surface (never zero),
 *   4. no toolbar child clips past the toolbar's left/right edge — stressed
 *      with a long tree name and the opt-in family-wizard button enabled.
 */

const WIDTHS = [360, 499, 500, 600, 640, 641, 700, 768, 900, 1000, 1024, 1100, 1280, 1400];

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

        // Settings entry points (exactly one must be active; no toolbar ⚙ at any width):
        //  - the last row of the ⋯ actions menu (> 1024)
        //  - the bottom-bar "More" tab → the More sheet, which carries Settings (≤ 1024)
        const standaloneSettings = !!document.querySelector('.actions-toolbar-settings');
        const actionsMenuPresent = displayed(document.querySelector('.actions-menu'));
        const foldedSettings = actionsMenuPresent
            && displayed(document.querySelector('#actions-settings-row'));
        const moreSheetHome = shown(document.getElementById('bb-view-more'));
        const settingsSurfaces =
            (standaloneSettings ? 1 : 0) + (foldedSettings ? 1 : 0) + (moreSheetHome ? 1 : 0);

        // Generation-depth controls: inline (.toolbar-focus) or floating bar.
        // The visible control is the stepper fronting each (hidden) select.
        const toolbarDepth = shown(document.getElementById('toolbar-depth-up')?.closest('.depth-stepper') ?? null);
        // The phone panel shows ↑n / ↓n chips (they unfold the steppers).
        const floatingDepth = shown(document.getElementById('focus-depth-up')?.closest('.depth-stepper') ?? null)
            || shown(document.querySelector('#focus-controls .focus-chip'));
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

test('toolbar regimes have no duplicated or missing controls at any width', { tag: '@smoke' }, async ({ page }) => {
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
        await settleLayout(page);
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
            await settleLayout(page);
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

    test('no ⋯ in the top bar up to 1024px: More is the bottom bar\'s', async ({ page }) => {
        await openApp(page);
        for (const width of [390, 900, 1024]) {
            await page.setViewportSize({ width, height: 850 });
            await expect(page.locator('.mobile-more-btn'), `${width}px`).toBeHidden();
            await expect(page.locator('.actions-menu-btn'), `${width}px`).toBeHidden();
            await expect(page.locator('#bb-view-more'), `${width}px`).toBeVisible();
        }
        await page.setViewportSize({ width: 1025, height: 850 });
        await expect(page.locator('.actions-menu-btn')).toBeVisible();
    });
});

/**
 * A tree tied to a research adds the Research button (with its count) left of
 * Actions: in the widest labels (cs, de) the toolbar still keeps every child
 * whole between 1025 and 1280 px, the button and the view tabs clickable.
 * Above 1280 px (B15-1) the Actions label and the standalone ⚙ come back and
 * in de the full "＋ Person hinzufügen" no longer fits up to ~1360 px: the add
 * button folds to ＋ by measurement, so it is never cut at the window edge and
 * the tree switcher never slides under the search field.
 */
const RESEARCH_LABEL: Record<string, string> = { 'cs-CZ': 'Výzkum', 'de-DE': 'Forschung', 'en-US': 'Research' };

async function openConnectedResearch(page: Page, locale: string): Promise<void> {
    await openResearch(page, { edit: true });
    await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null },
        links: ['send', 'open', 'live', 'app', 'setup', 'chat'], waiting: [{ id: 'T0001', what: 'A question' }, { id: 'T0002', what: 'Another' }] });
    await poll(page);
    await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
    await expect(page.locator('#research-menu-signal')).toHaveText('2');
    await expect(page.locator('#research-menu-btn .research-menu-label')).toHaveText(RESEARCH_LABEL[locale]);
}

/** The add button and the tree switcher against the toolbar and the search field. */
async function probeFit(page: Page) {
    return page.evaluate(() => {
        const tb = document.querySelector('.toolbar') as HTMLElement;
        const tr = tb.getBoundingClientRect();
        const add = document.querySelector('.toolbar .btn-add-person') as HTMLElement;
        const ar = add.getBoundingClientRect();
        const hit = document.elementFromPoint(ar.left + ar.width / 2, ar.top + ar.height / 2);
        const label = add.querySelector('.btn-add-label') as HTMLElement;
        const lr = label.getBoundingClientRect();
        const pill = document.querySelector('.toolbar .tree-switcher-btn') as HTMLElement;
        const pr = pill.getBoundingClientRect();
        const sw = (document.querySelector('.toolbar .tree-switcher') as HTMLElement).getBoundingClientRect();
        // The search field, or the magnifier it folded into (toolbar-squeeze-3; e.g. de with ⧉ for windows).
        const folded = tb.classList.contains('toolbar-squeeze-3');
        const search = (document.querySelector(folded ? '.toolbar .search-open-btn' : '.toolbar .search-container') as HTMLElement).getBoundingClientRect();
        return {
            // The toolbar holds its content: nothing scrolls past its edge.
            overflow: tb.scrollWidth - tb.clientWidth,
            // The add button lies wholly inside the toolbar and is clickable.
            addInside: ar.left >= tr.left - 1 && ar.right <= tr.right + 1,
            addHit: !!hit && (hit === add || add.contains(hit)),
            // Its label is either shown whole or folded away (＋ alone), never cut.
            labelWhole: lr.width <= 1 || (lr.right <= ar.right + 1 && label.scrollWidth <= label.clientWidth + 1),
            addName: add.getAttribute('title') ?? '',
            // The switcher pill stays inside its slot and clear of the search field.
            pillInSlot: pr.right <= sw.right + 1,
            pillClearOfSearch: pr.right <= search.left + 1,
        };
    });
}

for (const locale of ['cs-CZ', 'de-DE', 'en-US']) {
    test.describe(`a research tree's toolbar (${locale})`, () => {
        test.use({ locale });

        test('1281–1400 px: the add button is never cut, the tree switcher stays clear of the search field', async ({ page }) => {
            await page.setViewportSize({ width: 1400, height: 850 });
            await openConnectedResearch(page, locale);
            const widths = [1281, 1290, 1300, 1310, 1320, 1330, 1340, 1344, 1350, 1360, 1370, 1380, 1390, 1400];
            // Shrinking and growing again: the result depends on the width alone.
            for (const w of [...widths].reverse().concat(widths)) {
                await page.setViewportSize({ width: w, height: 850 });
                await settleLayout(page);
                const s = await probe(page);
                expect(s.clipped, `@${w}px: no clipped toolbar children`).toEqual([]);
                const f = await probeFit(page);
                expect(f.overflow, `@${w}px: the toolbar does not overflow`).toBeLessThanOrEqual(0);
                expect({ addInside: f.addInside, addHit: f.addHit, labelWhole: f.labelWhole, pillInSlot: f.pillInSlot, pillClearOfSearch: f.pillClearOfSearch },
                    `@${w}px`).toEqual({ addInside: true, addHit: true, labelWhole: true, pillInSlot: true, pillClearOfSearch: true });
                expect(f.addName, `@${w}px: the add button keeps its name`).not.toBe('');
            }
        });

        test('1025–1280 px: nothing clips, the Research button and the view tabs stay whole and hit-testable', async ({ page }) => {
            await page.setViewportSize({ width: 1280, height: 850 });
            await openConnectedResearch(page, locale);
            for (let w = 1280; w >= 1025; w -= 15) {
                await page.setViewportSize({ width: w, height: 850 });
                await settleLayout(page);
                const s = await probe(page);
                expect(s.clipped, `@${w}px: no clipped toolbar children`).toEqual([]);
                const hit = await page.evaluate(() => {
                    const vw = window.innerWidth;
                    const whole = (el: Element | null): boolean => {
                        if (!el) return false;
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.left < -1 || r.right > vw + 1) return false;
                        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                        return !!top && (top === el || el.contains(top));
                    };
                    const btn = document.getElementById('research-menu-btn');
                    const label = btn?.querySelector('.research-menu-label') as HTMLElement | null;
                    const tabs = Array.from(document.querySelectorAll('#view-mode-segment button'));
                    return {
                        button: whole(btn),
                        // The word is never cut (no ellipsis, no overflow).
                        label: !!label && label.scrollWidth <= label.clientWidth + 1,
                        tabs: tabs.every(whole),
                        actions: whole(document.querySelector('.actions-menu-btn')),
                    };
                });
                expect(hit, `@${w}px`).toEqual({ button: true, label: true, tabs: true, actions: true });
            }
        });
    });
}

/**
 * The tree's name in the switcher (de, a research tree: the tightest toolbar).
 * The search field gives way before the name does, the add button folds to ＋
 * when the name would still be cut below its own cap, and a renamed tree is
 * measured again.
 */
test.describe('the tree switcher\'s name in a tight toolbar (de-DE)', () => {
    test.use({ locale: 'de-DE' });

    async function nameFit(page: Page) {
        return page.evaluate(() => {
            const tb = document.querySelector('.toolbar') as HTMLElement;
            const name = document.getElementById('current-tree-name') as HTMLElement;
            const cap = parseFloat(getComputedStyle(name).maxWidth);
            return {
                text: name.textContent ?? '',
                // Shown whole, or cut only by its own max-width.
                whole: name.scrollWidth <= name.clientWidth + 1 || (Number.isFinite(cap) && name.getBoundingClientRect().width >= cap - 1),
                overflow: tb.scrollWidth - tb.clientWidth,
            };
        });
    }

    test('1440 px: the name whole, after a rename too; 1024 and 390 px: nothing runs over', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openConnectedResearch(page, 'de-DE');
        await settleLayout(page);
        let f = await nameFit(page);
        expect(f.whole, `"${f.text}" shown whole`).toBe(true);
        expect(f.overflow).toBeLessThanOrEqual(0);

        // A longer name: the switcher shows it (up to its cap), the toolbar fits again.
        const long = 'Familie Fischer aus Mähren und Böhmen';
        await page.evaluate(() => window.Strom.UI.showRenameTreeDialog(window.Strom.TreeManager.getActiveTreeId()!));
        await page.locator('#rename-tree-name').fill(long);
        await page.locator('#rename-tree-modal .buttons .primary').click();
        await expect(page.locator('#current-tree-name')).toHaveText(long);
        await expect.poll(async () => (await nameFit(page)).whole).toBe(true);
        expect((await nameFit(page)).overflow).toBeLessThanOrEqual(0);

        for (const width of [1024, 390]) {
            await page.setViewportSize({ width, height: 850 });
            await settleLayout(page);
            f = await nameFit(page);
            expect(f.overflow, `@${width}px: the toolbar does not overflow`).toBeLessThanOrEqual(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `@${width}px: no page scroll`).toBe(true);
        }
    });
    test('1025 px, a long name and the Table tab: the view tabs stay whole, nothing runs over, the cut name has its tooltip', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 850 });
        await openConnectedResearch(page, 'de-DE');
        const long = 'Familie Fischer aus Mähren und Böhmen';
        await page.evaluate(() => window.Strom.UI.showRenameTreeDialog(window.Strom.TreeManager.getActiveTreeId()!));
        await page.locator('#rename-tree-name').fill(long);
        await page.locator('#rename-tree-modal .buttons .primary').click();
        await expect(page.locator('#current-tree-name')).toHaveText(long);
        await page.setViewportSize({ width: 1025, height: 850 });
        await settleLayout(page);
        await expect(page.locator('#view-mode-table')).toHaveText('Tabelle');
        const fit = await page.evaluate(() => {
            const vw = window.innerWidth;
            const tb = document.querySelector('.toolbar') as HTMLElement;
            const whole = (el: Element): boolean => {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.left < -1 || r.right > vw + 1) return false;
                const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return !!top && (top === el || el.contains(top));
            };
            const tabs = Array.from(document.querySelectorAll('#view-mode-segment button'));
            const name = document.getElementById('current-tree-name') as HTMLElement;
            return {
                tabs: tabs.length, tabsWhole: tabs.every(whole),
                overflow: tb.scrollWidth - tb.clientWidth,
                nameTitle: name.scrollWidth > name.clientWidth + 1 ? name.title : long,
            };
        });
        expect(fit.tabs).toBe(6);
        expect(fit.tabsWhole).toBe(true);
        expect(fit.overflow).toBeLessThanOrEqual(0);
        expect(fit.nameTitle).toBe(long);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

/**
 * The search field of a tree without a research (de: the widest view tabs).
 * The view tabs' labels take the 500 cut (the chosen one's bold cut is drawn
 * over its label and takes no room) and the search funnel keeps a 1px chip
 * edge; the tabs' side padding and the funnel's give that room back, so the
 * search input is no narrower than with the earlier tabs (400 cut, 14 px sides)
 * and the edgeless funnel. The earlier look is put back with an injected style
 * and measured in the same page. A machine that draws the bold cut wider (CI's
 * Linux, 2-4 px a label) changes no tab's width.
 */
test.describe('the search field beside the view tabs (de-DE, no research)', () => {
    test.use({ locale: 'de-DE' });
    const EARLIER_LOOK = `
        .view-mode-segment .sel-tab { padding-left: 14px !important; padding-right: 14px !important; }
        .view-mode-segment .sel-tab:not(.active) { font-weight: 400 !important; }
        .view-mode-segment .sel-l::after { content: none !important; }
        .view-mode-segment .sel-tab.active > .sel-l { font-weight: 600 !important; -webkit-text-fill-color: currentColor !important; }
        .toolbar .search-filter-toggle { border: 0 !important; padding-left: 14px !important; padding-right: 14px !important; }`;

    async function searchRoom(page: Page) {
        await settleLayout(page, '#toolbar-search-picker', '#view-mode-segment');
        return page.evaluate(() => {
            const input = document.querySelector('#toolbar-search-picker .person-picker-input') as HTMLElement;
            const tabs = Array.from(document.querySelectorAll<HTMLElement>('#view-mode-segment button'));
            return {
                search: input.getBoundingClientRect().width,
                steps: (document.querySelector('.toolbar') as HTMLElement).className,
                tabsWhole: tabs.every(t => t.scrollWidth <= t.clientWidth + 0.5),
            };
        });
    }

    test('1440 and 1300 px, the sample and a long tree name: the search input keeps the earlier width', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.loadDemoTree());
        await expect(page.locator('.person-card').first()).toBeVisible();
        for (const name of [null, 'Familie Großmann aus Oberbayern']) {
            if (name) {
                await page.evaluate(() => window.Strom.UI.showRenameTreeDialog(window.Strom.TreeManager.getActiveTreeId()!));
                await page.locator('#rename-tree-name').fill(name);
                await page.locator('#rename-tree-modal .buttons .primary').click();
                await expect(page.locator('#current-tree-name')).toHaveText(name);
            }
            for (const width of [1440, 1300]) {
                await page.setViewportSize({ width, height: 900 });
                const now = await searchRoom(page);
                const earlier = await page.addStyleTag({ content: EARLIER_LOOK });
                const before = await searchRoom(page);
                await earlier.evaluate(el => el.remove());
                const at = `${name ?? 'sample'} @${width}px`;
                expect(now.tabsWhole, `${at}: no view tab cuts its label`).toBe(true);
                expect(now.steps, `${at}: the same fit steps as with the earlier tabs`).toBe(before.steps);
                expect(now.search, `${at}: the search input (${now.search}) keeps the earlier width (${before.search})`)
                    .toBeGreaterThanOrEqual(before.search - 0.5);
            }
        }
    });

    test('a wider bold cut (as a Linux rasteriser draws it) changes no view tab\'s width', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.loadDemoTree());
        await expect(page.locator('.person-card').first()).toBeVisible();
        const tabs = () => page.locator('#view-mode-segment button').evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
        await settleLayout(page, '#view-mode-segment');
        const regular = await tabs();
        // Every 600 cut 3 px wider a label: the reserve of the bold cut grew with it (CI 1440 px: search 53 -> 30).
        const wide = await page.addStyleTag({ content: `
            .view-mode-segment .sel-l::after { letter-spacing: .45px !important; }` });
        await settleLayout(page, '#view-mode-segment');
        const widened = await tabs();
        for (let i = 0; i < regular.length; i++) expect(widened[i], `tab ${i}`).toBeCloseTo(regular[i], 1);
        // The chosen label is drawn whole in the bold cut, inside its tab.
        const drawn = await page.locator('#view-mode-family').evaluate(btn => {
            const after = getComputedStyle(btn.querySelector('.sel-l')!, '::after');
            return { visibility: after.visibility, weight: after.fontWeight, tabWhole: btn.scrollWidth <= btn.clientWidth + 0.5 };
        });
        expect(drawn).toEqual({ visibility: 'visible', weight: '600', tabWhole: true });
        await wide.evaluate(el => el.remove());
    });
});

test.describe('the 1280 fold boundary', () => {
    test('no toolbar ⚙ at any width: Settings is the last ⋯ Actions row on both sides of 1280; the Actions label folds at 1280', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await expect(page.locator('.actions-toolbar-settings')).toHaveCount(0);

        for (const [width, label] of [[1281, true], [1280, false]] as const) {
            await page.setViewportSize({ width, height: 850 });
            await settleLayout(page);
            expect(await page.locator('.actions-menu-label').evaluate((e) => getComputedStyle(e).display) !== 'none', `@${width}`).toBe(label);
            await page.locator('.actions-menu-btn').click();
            const last = page.locator('#actions-menu-dropdown > .tree-switcher-action:visible').last();
            await expect(last).toHaveId('actions-settings-row');
            await expect(last).toHaveText('Settings');
            await page.keyboard.press('Escape');
        }
    });
});

/**
 * The sample tree's toolbar carries the person in the centre with both depth
 * steppers, the family line picker ("Stammlinien ▾", spec 039) and ⧉ (spec
 * 079). In de at 1024 px the steppers ran out of the person's group under the
 * line picker ("Nachkommen − 6 +" half covered), the person's name squeezed
 * away: the tablet toolbar was not measured. Every language, the tablet band
 * and the desktop, the Family and the Descendants view, in the app's fonts
 * and in a wide one (CI's fonts are wider than a Mac's): no two of the
 * toolbar's controls overlap, none runs out of the toolbar, the steppers'
 * buttons take a click where they are drawn.
 */
test.describe('the sample tree\'s toolbar with the line picker and ⧉', () => {
    const WIDE_FONT = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';
    const FIT_WIDTHS = [1440, 1100, 1024, 960, 900, 800, 700, 641];
    /** The line picker's "all lines" label: the language is the one asked for. */
    const ALL_LINES: Record<string, string> = { 'de-DE': 'Stammlinien', 'cs-CZ': 'Rody', 'en-US': 'Lines', 'pl-PL': 'Rody' };

    async function toolbarAudit(page: Page) {
        return page.evaluate(() => {
            const tb = document.querySelector('.toolbar') as HTMLElement;
            const tr = tb.getBoundingClientRect();
            const visible = (el: Element): boolean => {
                const r = el.getBoundingClientRect();
                return r.width >= 1 && r.height >= 1 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
            };
            const label = (el: Element): string =>
                `${el.id ? `#${el.id}` : `.${String((el as HTMLElement).className).split(' ')[0] || el.tagName}`}"${(el.textContent ?? '').trim().slice(0, 16)}"`;
            // The controls a person sees: buttons and fields whole, the texts beside them.
            const controls = Array.from(tb.querySelectorAll('button, summary, input, strong, .focus-count, .depth-stepper-label, .depth-stepper-value, .app-wordmark'))
                .filter(el => !el.parentElement?.closest('button, summary'))
                .filter(el => !el.closest('.sp-rodpick-pop, #view-window-menu, .person-picker-dropdown, .tree-switcher-dropdown'))
                .filter(visible);
            const overlaps: string[] = [];
            for (let i = 0; i < controls.length; i++) {
                for (let j = i + 1; j < controls.length; j++) {
                    if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
                    const a = controls[i].getBoundingClientRect();
                    const b = controls[j].getBoundingClientRect();
                    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
                        overlaps.push(`${label(controls[i])} × ${label(controls[j])}`);
                    }
                }
            }
            const outside = controls.filter(el => {
                const r = el.getBoundingClientRect();
                return r.left < tr.left - 1 || r.right > tr.right + 1;
            }).map(label);
            // A stepper's buttons take the click where they are drawn (the
            // toolbar's on a tablet, the descendants badge's in that view).
            const covered = Array.from(document.querySelectorAll('.depth-stepper-btn')).filter(visible).filter(btn => {
                const r = btn.getBoundingClientRect();
                const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return !top || !(top === btn || btn.contains(top));
            }).map(btn => `${btn.closest('.depth-stepper')?.querySelector('.depth-stepper-label')?.textContent?.trim() ?? ''} ${btn.textContent}`);
            const name = document.getElementById('toolbar-focus-name') as HTMLElement;
            const nameShown = !visible(name.parentElement!) || name.getBoundingClientRect().width + 1 >= Math.min(name.scrollWidth, 60);
            return {
                overlaps, outside, covered, nameShown,
                overflow: tb.scrollWidth - tb.clientWidth,
                linePicker: visible(document.getElementById('view-rod-picker')!),
            };
        });
    }

    for (const locale of ['de-DE', 'cs-CZ', 'en-US', 'pl-PL']) test.describe(locale, () => {
        test.use({ locale });
        test('nothing overlaps or runs over from 1440 to 641 px', async ({ page }) => {
            test.setTimeout(90_000);
            await page.setViewportSize({ width: 1024, height: 800 });
            await openApp(page);
            await page.evaluate(() => window.Strom.UI.loadDemoTree());
            await expect(page.locator('.person-card').first()).toBeVisible();
            await expect(page.locator('#view-rod-picker .sp-rodpick-btn')).toContainText(ALL_LINES[locale]);
            for (const font of ['app', 'wide']) {
                if (font === 'wide') await page.addStyleTag({ content: WIDE_FONT });
                for (const view of ['family', 'descendants'] as const) {
                    await page.evaluate((v) => window.Strom.UI.setDisplayViewMode(v), view);
                    for (const width of FIT_WIDTHS) {
                        await page.setViewportSize({ width, height: 800 });
                        await settleLayout(page, '.toolbar-focus', '#view-rod-picker');
                        const a = await toolbarAudit(page);
                        const at = `${locale} ${font} font, ${view} @${width}px`;
                        expect(a.linePicker, `${at}: the line picker is in the toolbar`).toBe(true);
                        expect(a.overlaps, `${at}: no two controls overlap`).toEqual([]);
                        expect(a.outside, `${at}: no control runs out of the toolbar`).toEqual([]);
                        expect(a.overflow, `${at}: the toolbar does not overflow`).toBeLessThanOrEqual(0);
                        expect(a.covered, `${at}: the steppers take their clicks`).toEqual([]);
                        expect(a.nameShown, `${at}: the person's name is not squeezed away`).toBe(true);
                    }
                }
            }
        });
    });
});
