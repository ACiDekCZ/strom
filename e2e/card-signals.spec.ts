import { test, expect, Page } from '@playwright/test';
import { openApp, card, cardAction } from './helpers.js';
import { FakeBridge, fakeBridge, openResearch, poll, touchScreenNow } from './research-bridge.js';
import { FakeVerify, VERIFY_FEATURES, fakeVerify, verifyGed } from './verify-bridge.js';

/**
 * What a card shows at a glance: the one status mark (spec 066 P4 §1) and the
 * story's folded corner at the card's bottom-right corner, one action badge on the avatar's
 * corner (waiting for an answer ! > conflict ≠ > question ?), the tooltip rows, the
 * aria-label, densities and far zoom, Settings → "Show on card", the person
 * menu leading with the signal, and the Evidence mode in tree health.
 * Invented data only.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
        '1 CHAR UTF-8', '1 NOTE Fíškovi',
        '0 @S12@ SOUR', '1 TITL Křestní matrika Chlumy 1865', '1 REFN S0012',
        '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 DEAT', '2 DATE 1900',
        '1 REFN P0001', '1 FAMS @F0001@',
        '1 _STORY', '2 STAT hotovo', '2 TEXT Josef hospodařil na čp. 12.',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '2 SOUR @S12@', '1 DEAT', '2 DATE 1932', '2 SOUR @S12@',
        '1 REFN P0012', '1 FAMC @F0001@',
        '1 _STORY', '2 STAT navrh', '2 TEXT Jan se narodil v Chlumech.',
        '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 3 FEB 1865', '3 SOUR @S12@', '2 VAL 1866',
        '1 _STROM_HYPO', '2 TITL Otec: Josef, nebo Jan Fíšek?',
        '0 @P0013@ INDI', '1 NAME Eva /Fíšková/', '1 SEX F', '1 BIRT', '2 DATE 1868', '1 REFN P0013', '1 FAMC @F0001@',
        '1 _STROM_CONFLICT X0010', '2 TYPE DEAT', '2 STAT open', '2 VAL 1930', '2 VAL 1931',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** The research tree; the research last said a task about Eva waits (before the app starts). */
/**
 * Zoom far out (below 0.55) with the − button's steps: the presses add up
 * (each builds on the scale the running zoom heads for), so they go at once,
 * then the zoom is waited for until it lands. The steps stop at the first
 * scale below 0.55, as pressing − by hand until the dots come would.
 */
async function zoomOutFar(page: Page): Promise<void> {
    const steps = await page.evaluate(() => {
        const zoom = window.Strom.ZoomPan;
        let n = 0;
        for (let s = zoom.getScale(); s >= 0.55; s /= 1.3) { zoom.zoomOut(); n++; }
        return n;
    });
    expect(steps).toBeGreaterThan(0);
    await expect(page.locator('#tree-canvas')).not.toHaveClass(/is-moving/);
    expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeLessThan(0.55);
}

/** Zoom to `scale` at once, around the card's centre (spec 066 P4 §7). */
async function zoomTo(page: Page, scale: number, name = 'Jan'): Promise<void> {
    await card(page, name).evaluate((el, s) => {
        const c = el as HTMLElement;
        const wx = parseFloat(c.style.left) + c.offsetWidth / 2;
        const wy = parseFloat(c.style.top) + c.offsetHeight / 2;
        window.Strom.ZoomPan.zoomAroundWorldPoint(wx, wy, s, 0, t => t);
    }, scale);
    expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scale, 3);
}

/** The poster as an SVG download (Image export → SVG). */
async function posterSvg(page: Page): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
    ]);
    const { readFileSync } = await import('fs');
    return readFileSync(await download.path(), 'utf-8');
}

async function setup(page: Page, width = 1440): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((uuid) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({
            items: [{ id: 'T0004', what: 'Uložte snímek oddací matriky', at: '', person: 'P0013' }],
            at: new Date(Date.now() - 3600_000).toISOString(),
        }));
    }, UUID);
    await openApp(page);
    await dropFile(page, researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
}

/** A plain tree from JSON (no research). */
async function plainTree(page: Page, persons: Record<string, Record<string, unknown>>, sources: Record<string, unknown> = {}): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async ({ persons, sources }) => {
        const full: Record<string, unknown> = {};
        for (const [id, p] of Object.entries(persons)) {
            full[id] = { id, gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p };
        }
        await window.Strom.DataManager.importAsNewTree({ persons: full, partnerships: {}, sources }, 'Karty');
    }, { persons, sources });
}

test.describe('card signals', () => {
    test('status icons, badges by priority, tooltip and aria-label', async ({ page }) => {
        await setup(page);
        // The status mark by the card's corner, the story as the folded corner itself.
        // Josef: nothing cited in a tree with sources (an empty dotted mark), a finished story.
        // Jan: birth and death cited (●●), a draft story (a hollow fold).
        await expect(card(page, 'Josef').locator(':scope > .card-status-mark')).toHaveClass(/\bcs-none\b/);
        await expect(card(page, 'Josef').locator(':scope > .card-story')).not.toHaveClass(/draft/);
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark.cs-p2 .fs-dots i.on')).toHaveCount(2);
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toHaveClass(/draft/);
        // One mark, no stripes of the older builds.
        await expect(page.locator('.ev-stripe, .card-state, .st-ev')).toHaveCount(0);
        // The fold covers the card's corner; the mark stands left of it.
        const fold = await card(page, 'Jan').evaluate((el) => {
            const c = el.getBoundingClientRect();
            const foldEl = el.querySelector<HTMLElement>(':scope > .card-story')!;
            const stEl = el.querySelector<HTMLElement>(':scope > .card-status-mark')!;
            const f = foldEl.getBoundingClientRect();
            const st = stEl.getBoundingClientRect();
            return { right: f.right - c.right, bottom: f.bottom - c.bottom, size: foldEl.offsetWidth, markRight: getComputedStyle(stEl).right, markClear: st.right <= f.left + 4 };
        });
        expect(fold).toMatchObject({ right: 0, bottom: 0, size: 14, markRight: '15px', markClear: true });
        await expect(card(page, 'Anna').locator(':scope > .card-story')).toHaveCount(0);
        // Neutral: the mark's dots take the light text colour.
        const colour = await card(page, 'Jan').locator(':scope > .card-status-mark').evaluate((el) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--text-light)';
            el.parentElement!.appendChild(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return { got: getComputedStyle(el).color, want };
        });
        expect(colour.got).toBe(colour.want);
        // The year text itself is unchanged by the mark.
        await expect(card(page, 'Jan').locator('.birth-date')).toHaveText('1865 – 1932');

        // Jan: an open conflict (≠). Eva: a conflict AND a waiting task — waiting wins (!).
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveText('≠');
        await expect(card(page, 'Eva').locator('.card-signal')).toHaveText('!');
        await expect(card(page, 'Josef').locator('.card-signal')).toHaveCount(0);
        await expect(card(page, 'Eva').locator('.card-signal')).toHaveAttribute('aria-label', 'Awaiting action: Uložte snímek oddací matriky');

        const tt = card(page, 'Jan').locator('.card-tooltip .tt-signals');
        // The card map's order (spec 066 P4 §5): name, years, the mark in words; then story, what waits.
        await expect(card(page, 'Jan')).toHaveAttribute('aria-label', 'Jan Fíšek, 1865 – 1932, documented by sources; Story (draft); conflicting sources');
        // The mark in words: the card's own pill, then the level and the sources; no title of its own.
        await expect(tt.locator('.tt-status')).toHaveText('Backed by sources · 1 source');
        await expect(tt.locator('.tt-status > .card-status-mark.cs-p2')).toHaveCount(1);
        await expect(card(page, 'Jan').locator('.card-status-mark[title]')).toHaveCount(0);
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-foot')).toHaveText('Click opens the person menu');
        await expect(tt.locator('.tt-story')).toHaveText('Story (draft)');
        await expect(tt.locator('.tt-action')).toHaveText(['1 conflict · 1 hypothesis']);
        await expect(card(page, 'Eva').locator('.card-tooltip .tt-action')).toHaveText(['Awaiting action: Uložte snímek oddací matriky', '1 conflict']);
    });

    test('the badge opens what it signals, not the card menu', async ({ page }) => {
        await setup(page);
        await card(page, 'Jan').locator('.card-signal').click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(page.locator('.context-menu')).toHaveCount(0);
    });

    test('the status mark sits in the bottom-right corner in every density, over no text', async ({ page }) => {
        await setup(page);
        for (const density of ['custom', 'compact', 'normal', 'detailed', 'register']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            const jan = card(page, 'Jan');
            await expect(jan.locator(':scope > .card-status-mark')).toBeVisible();
            const box = (await jan.boundingBox())!;
            const stripes = (await jan.locator(':scope > .card-status-mark').boundingBox())!;
            expect(box.x + box.width - (stripes.x + stripes.width)).toBeGreaterThan(4);
            expect(box.y + box.height - (stripes.y + stripes.height)).toBeGreaterThan(3);
            // No text line of the card runs under them.
            for (const sel of ['.name-text', '.birth-date', '.card-years']) {
                for (const t of await jan.locator(sel).all()) {
                    if (!(await t.isVisible())) continue;
                    const r = (await t.boundingBox())!;
                    const overlaps = r.x < stripes.x + stripes.width && stripes.x < r.x + r.width
                        && r.y < stripes.y + stripes.height && stripes.y < r.y + r.height;
                    expect(overlaps, `${density}: ${sel} under the status mark`).toBe(false);
                }
            }
        }
        // The mark answers the mouse: a click there opens its status tip, not the card menu.
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toHaveCSS('pointer-events', 'auto');
    });

    test('every card type draws the lock, the status mark, the story fold and the corner dot, the custom one too (N34)', async ({ page }) => {
        await setup(page);
        const jan = card(page, 'Jan');
        // Jan's own lock (the card keeps its signals; the lock sits in the top-right corner).
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const id = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan')!.id;
            dm.updatePerson(id, { isLocked: true });
            window.Strom.TreeRenderer.render();
        });
        for (const density of ['custom', 'compact', 'normal', 'detailed', 'register']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            await expect(page.locator('body')).toHaveAttribute('data-card-density', density);
            await expect(jan.locator(':scope > .lock-icon'), `${density}: lock`).toBeVisible();
            await expect(jan.locator(':scope > .card-status-mark .fs-dots i.on'), `${density}: status mark`).toHaveCount(2);
            await expect(jan.locator(':scope > .card-status-mark'), `${density}: status mark`).toBeVisible();
            await expect(jan.locator(':scope > .card-story'), `${density}: fold`).toBeVisible();
            await expect(jan.locator(':scope > .card-signal-dot'), `${density}: corner dot`).toHaveCount(1);
            // No text of the card runs under the lock, the status mark or the fold.
            const clash = await jan.evaluate((el) => {
                const marks = [...el.querySelectorAll<HTMLElement>(':scope > .lock-icon, :scope > .card-status-mark, :scope > .card-story')]
                    .map(m => m.getBoundingClientRect());
                const body = el.querySelector('.card-body')!;
                const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
                const out: string[] = [];
                for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                    if (!n.textContent?.trim()) continue;
                    const range = document.createRange();
                    range.selectNodeContents(n);
                    for (const r of range.getClientRects()) {
                        if (marks.some(m => r.left < m.right - 0.5 && m.left < r.right - 0.5 && r.top < m.bottom - 0.5 && m.top < r.bottom - 0.5)) out.push(n.textContent.trim());
                    }
                }
                return out;
            });
            expect(clash, `${density}: text under a mark`).toEqual([]);
        }
        // Custom, zoomed far out: the dot stands for the badge as on the other cards.
        await page.evaluate(() => window.Strom.UI.setCardDensity('custom'));
        await zoomOutFar(page);
        await expect(jan.locator('.card-signal')).toBeHidden();
        await expect(jan.locator(':scope > .card-signal-dot')).toBeVisible();
    });

    test('the ⇄ other-trees pill: neutral, no ↗, 40px from the corner; the status mark stays in the corner, the text keeps clear (spec 066 P4 §2)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        // The same documented Jan in two trees: his card carries the ⇄ pill.
        await page.evaluate(async () => {
            const jan = { id: 'j', firstName: 'Jan', lastName: 'Novák', gender: 'male', birthDate: '1900', birthPlace: 'Lipany u Prahy a okolí',
                birthSourceIds: ['s1'], isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
            const sources = { s1: { id: 's1', title: 'Křest' } };
            await window.Strom.DataManager.importAsNewTree({ persons: { j: jan }, partnerships: {}, sources } as never, 'Strom A');
            await window.Strom.DataManager.importAsNewTree({ persons: { j: jan }, partnerships: {}, sources } as never, 'Strom B');
            window.Strom.TreeRenderer.render();
        });
        const jan = card(page, 'Jan');
        const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
            a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        for (const density of ['custom', 'normal', 'compact', 'detailed', 'register']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            await expect(jan.locator('.cross-tree-badge')).toBeVisible();
            await expect(jan).toHaveClass(/has-edge-br/);
            // Another tree is a move inside the app: no ↗, no jump look.
            await expect(jan.locator('.cross-tree-badge')).not.toContainText('↗');
            await expect(jan.locator('.cross-tree-badge')).not.toHaveClass(/kind-jump/);
            const stripes = jan.locator(':scope > .card-status-mark');
            await expect(stripes).toHaveCSS('bottom', '4px');
            const sBox = (await stripes.boundingBox())!;
            const pill = (await jan.locator('.cross-tree-badge').boundingBox())!;
            expect(overlap(sBox, pill), `${density}: status mark under the pill`).toBe(false);
            // The bottom edge ends 40px before the card's right edge (the corner is the status).
            await expect(jan.locator('.edge-bottom-right')).toHaveCSS('right', '40px');
            const fields = density === 'custom' || density === 'detailed' || density === 'register';
            if (fields) {
                // A card of details is not narrowed: it was measured 12px taller (padding 10 → 22),
                // its text ends above the stripes and is never shortened for them.
                await expect(jan).toHaveClass(/has-edge-room/);
                await expect(jan).toHaveCSS('padding-bottom', '22px');
                await expect(jan.locator('.card-body > :last-child')).toHaveCSS('margin-right', '0px');
                await expect(jan.locator('.card-lines > :last-child')).toHaveCSS('padding-right', '0px');
                await expect(jan.locator('.card-line [title]')).toHaveCount(0);
            }
            // Text lines clip at their own box: no box reaches under the stripes.
            for (const sel of ['.name', '.birth-date', '.card-line']) {
                for (const t of await jan.locator(sel).all()) {
                    if (!(await t.isVisible())) continue;
                    expect(overlap((await t.boundingBox())!, sBox), `${density}: ${sel} under the status mark`).toBe(false);
                }
            }
        }
        // Without the pill: no class, the mark back at the bottom.
        await page.evaluate(() => window.Strom.UI.toggleCrossTreeBadges(false));
        await expect(jan.locator('.cross-tree-badge')).toHaveCount(0);
        await expect(jan).not.toHaveClass(/has-edge-br/);
        await expect(jan.locator(':scope > .card-status-mark')).toHaveCSS('bottom', '4px');
        await expect(jan.locator(':scope > .card-status-mark')).toHaveCSS('right', '5px');
        // The Register card no longer keeps the pills' room.
        await expect(jan).not.toHaveClass(/has-edge-room/);
        await expect(jan).toHaveCSS('padding-bottom', '10px');
    });

    test('all five card types: the status mark ●● / ●○ / empty, the fold, the badges ! ≠ ?, the dot far out, and Settings switches them off (U03a)', async ({ page }) => {
        test.setTimeout(90_000);
        await setup(page);
        // Anna: birth cited, a death not cited (partial: ●○) and an open question (?).
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const data = dm.getData();
            const src = Object.keys(data.sources ?? {})[0];
            const anna = Object.values(data.persons).find((p: any) => p.firstName === 'Anna')!;
            dm.updatePerson(anna.id, { birthDate: '1842', deathDate: '1910', question: 'Kde zemřela?' } as never);
            dm.citePerson(anna.id, src, 'birth');
            window.Strom.TreeRenderer.render();
        });
        const [jan, eva, anna, josef] = ['Jan', 'Eva', 'Anna', 'Josef'].map(n => card(page, n));
        for (const density of ['compact', 'normal', 'detailed', 'register', 'custom']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            await expect(page.locator('body')).toHaveAttribute('data-card-density', density);
            const why = (what: string) => `${density}: ${what}`;
            await expect(jan.locator(':scope > .card-status-mark.cs-p2 .fs-dots i.on'), why('full')).toHaveCount(2);
            await expect(anna.locator(':scope > .card-status-mark.cs-p1 .fs-dots i.on'), why('partial')).toHaveCount(1);
            await expect(josef.locator(':scope > .card-status-mark'), why('none')).toHaveClass(/\bcs-none\b/);
            await expect(josef.locator(':scope > .card-story'), why('final fold')).not.toHaveClass(/draft/);
            await expect(jan.locator(':scope > .card-story'), why('draft fold')).toHaveClass(/draft/);
            if (density === 'compact') {
                // No avatar: the dot on the card's corner stands for the badge.
                for (const c of [jan, eva, anna]) await expect(c.locator(':scope > .card-signal-dot'), why('dot')).toBeVisible();
            } else {
                await expect(eva.locator('.card-avatar-wrap .card-signal'), why('!')).toHaveText('!');
                await expect(jan.locator('.card-avatar-wrap .card-signal'), why('≠')).toHaveText('≠');
                await expect(anna.locator('.card-avatar-wrap .card-signal'), why('?')).toHaveText('?');
            }
            // The tooltip and the aria-label say the state as on every card.
            await expect(jan.locator('.card-tooltip .tt-status'), why('tooltip')).toHaveCount(1);
            expect(await jan.getAttribute('aria-label'), why('aria-label')).toContain('documented by sources; Story (draft); conflicting sources');
            expect(await anna.getAttribute('aria-label'), why('aria-label')).toContain('open question');
        }
        // Zoomed far out (below 0.55): the badges give way to dots on every type.
        await zoomOutFar(page);
        for (const density of ['compact', 'normal', 'detailed', 'register', 'custom']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            await expect(page.locator('body')).toHaveAttribute('data-card-density', density);
            await expect(jan.locator('.card-signal'), `${density}: no badge far out`).toBeHidden();
            for (const c of [jan, eva, anna]) await expect(c.locator(':scope > .card-signal-dot'), `${density}: dot far out`).toBeVisible();
            // The status mark stays far out, grown to stay readable (spec 066 P4 §7); the fold goes.
            await expect(jan.locator(':scope > .card-status-mark'), `${density}: status mark far out`).toBeVisible();
            await expect(jan.locator(':scope > .card-story'), `${density}: no fold far out`).toBeHidden();
        }
        await page.evaluate(() => window.Strom.ZoomPan.zoomIn());

        // Settings → Show on card: switched off, gone from every type; the setting is kept apart from the type.
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#card-signals-settings');
        await settings.locator('input[data-signal="status"]').uncheck();
        await settings.locator('input[data-signal="story"]').uncheck();
        await settings.locator('input[data-signal="question"]').uncheck();
        await page.keyboard.press('Escape');
        const kept = await page.evaluate(() => localStorage.getItem('strom-card-signals'));
        for (const density of ['compact', 'normal', 'detailed', 'register', 'custom']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            await expect(page.locator('body')).toHaveAttribute('data-card-density', density);
            await expect(jan.locator(':scope > .card-status-mark'), `${density}: status mark off`).toHaveCount(0);
            await expect(josef.locator(':scope > .card-story'), `${density}: fold off`).toHaveCount(0);
            await expect(anna.locator('.card-signal'), `${density}: ? off`).toHaveCount(0);
            if (density !== 'compact') await expect(eva.locator('.card-signal'), `${density}: ! stays`).toHaveText('!');
            expect(await page.evaluate(() => localStorage.getItem('strom-card-signals'))).toBe(kept);
        }
    });

    test('the desktop person menu starts with what there is to do: ordinary items with the mark\'s glyph, no block explaining the marks (spec 065 round 2)', async ({ page }) => {
        await setup(page);
        await card(page, 'Jan').locator('.name').click();
        const menu = page.locator('.context-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.menu-person-state, [data-action="marks-help"]')).toHaveCount(0);
        // Jan: the open conflict and the hypothesis, one item right after the header.
        const acts = menu.locator('.menu-act');
        await expect(acts).toHaveCount(1);
        await expect(acts.first()).toHaveAttribute('data-action', 'signal-knows');
        await expect(acts.first().locator('.menu-act-text')).toHaveText('What the research knows · 1 conflict, 1 hypothesis ›');
        await expect(acts.first().locator('.menu-signal-glyph')).toHaveText('≠');
        expect(await menu.evaluate(el => el.querySelector('.context-menu-item')?.classList.contains('menu-act'))).toBe(true);
        // An ordinary item: no warning background of its own; its glyph in the kind column
        // (◎ of Focus), its text in line with the other items' text.
        const look = await acts.first().evaluate((el) => {
            const kind = el.parentElement!.querySelector<HTMLElement>('.context-menu-item:has(> .menu-item-kind)')!;
            const plain = el.parentElement!.querySelector<HTMLElement>('.context-menu-item:not(.menu-act):not(:has(> .menu-item-kind))')!;
            const textX = (row: HTMLElement) => {
                const r = document.createRange();
                const t = [...row.querySelectorAll('*'), row].flatMap(n => [...n.childNodes]).find(n => n.nodeType === 3 && n.textContent!.trim().length > 2)!;
                r.selectNodeContents(t);
                return Math.round(r.getBoundingClientRect().left);
            };
            const glyphX = (g: Element) => Math.round(g.getBoundingClientRect().left + g.getBoundingClientRect().width / 2);
            return {
                bg: getComputedStyle(el).backgroundColor, plainBg: getComputedStyle(plain).backgroundColor,
                glyph: glyphX(el.querySelector('.menu-signal-glyph')!), kind: glyphX(kind.querySelector('.menu-item-kind')!),
                text: textX(el.querySelector('.menu-act-text')!), plainText: textX(plain),
            };
        });
        expect(look.bg).toBe(look.plainBg);
        expect(Math.abs(look.glyph - look.kind), JSON.stringify(look)).toBeLessThanOrEqual(1);
        expect(Math.abs(look.text - look.plainText)).toBeLessThanOrEqual(1);
        await acts.first().click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await page.keyboard.press('Escape');

        // Eva: the task waiting for an answer comes first, then what the research knows.
        await card(page, 'Eva').locator('.name').click();
        await expect(menu.locator('.menu-act')).toHaveCount(2);
        await expect(menu.locator('.menu-act').first()).toHaveAttribute('data-action', 'signal-waiting');
        await expect(menu.locator('.menu-act .menu-act-text')).toHaveText(['Answer · 1 waiting', 'What the research knows · 1 conflict ›']);
        await page.keyboard.press('Escape');

        // Josef: nothing to do, no such item.
        await card(page, 'Josef').locator('.name').click();
        await expect(menu).toBeVisible();
        await expect(menu.locator('.menu-act')).toHaveCount(0);
    });

    test('desktop: each mark has its own bubble over it, the card\'s bubble steps aside; a click does what the bubble says (spec 065 round 2)', async ({ page }) => {
        await setup(page);
        const jan = card(page, 'Jan');
        const cardTip = jan.locator('.card-tooltip');
        const hoverTip = async (mark: string, tip: string, head: string, action: string, side: 'above' | 'below') => {
            const m = jan.locator(mark);
            await m.hover();
            const t = jan.locator(tip);
            await expect(t, mark).toBeVisible();
            await expect(t.locator('.badge-tooltip-header')).toHaveText(head);
            if (action) await expect(t.locator('.badge-tooltip-action')).toHaveText(action);
            await expect(t).toHaveAttribute('role', 'tooltip');
            const mb = (await m.boundingBox())!;
            const tb = (await t.boundingBox())!;
            if (side === 'above') expect(tb.y + tb.height, `${mark}: above`).toBeLessThanOrEqual(mb.y);
            else expect(tb.y, `${mark}: below`).toBeGreaterThanOrEqual(mb.y + mb.height - 1);
            // The card's own bubble does not open over a mark.
            await page.waitForTimeout(700);
            await expect(cardTip).toBeHidden();
        };
        await hoverTip('.card-signal', '.mt-badge', 'Conflict in sources', 'Click: what the research knows', 'above');
        await expect(jan.locator('.mt-badge .badge-tooltip-body').first()).toHaveText('1 conflict · 1 hypothesis');
        await expect(jan.locator('.card-signal')).toHaveAttribute('aria-describedby', /^mt-badge-/);
        await hoverTip(':scope > .card-story', '.mt-story', 'Story', 'Click: open the story', 'below');
        // Away from the marks the card's bubble comes back.
        await jan.locator('.name').hover();
        await expect(cardTip).toBeVisible();

        // The story's corner opens the story, not the card menu.
        await jan.locator(':scope > .card-story').click();
        await expect(page.locator('#person-story-modal')).toBeVisible();
        await expect(page.locator('.context-menu')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // The lock: its bubble above, a click is the card's.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const id = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan')!.id;
            dm.updatePerson(id, { isLocked: true });
            window.Strom.TreeRenderer.render();
        });
        await hoverTip(':scope > .lock-icon', '.mt-lock', 'Locked', '', 'above');
        await expect(jan.locator(':scope > .lock-icon[title]')).toHaveCount(0);
        await jan.locator(':scope > .lock-icon').click();
        await expect(page.locator('.context-menu')).toBeVisible();
    });

    test('keyboard: the badge\'s focus shows its bubble as the mouse does (spec 065 round 2)', async ({ page }) => {
        await setup(page);
        const badge = card(page, 'Jan').locator('.card-signal');
        await badge.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(badge).toBeFocused();
        await expect(card(page, 'Jan').locator('.mt-badge')).toBeVisible();
    });

    test('desktop: a click on the ? opens what the research knows at the question', async ({ page }) => {
        await setup(page);
        const id = await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const p = Object.values(dm.getData().persons).find((x: any) => x.firstName === 'Josef')!;
            dm.updatePerson(p.id, { question: 'Kde hospodařil před svatbou?' } as never);
            window.Strom.TreeRenderer.render();
            return p.id;
        });
        expect(id).toBeTruthy();
        const badge = card(page, 'Josef').locator('.card-signal');
        await expect(badge).toHaveText('?');
        await badge.hover();
        await expect(card(page, 'Josef').locator('.mt-badge .badge-tooltip-header')).toHaveText('Open question');
        await badge.click();
        const modal = page.locator('#person-research-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.person-research-question')).toHaveText('Kde hospodařil před svatbou?');
        await expect(modal.locator('.person-research-question')).toBeFocused();
        await expect(page.locator('.context-menu')).toHaveCount(0);
    });

    test('compact: a dot on the card corner; far zoom: dots only', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));
        await expect(card(page, 'Jan').locator('.card-signal')).toBeVisible();
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeHidden();

        // Zoom out step by step (each step is animated) until below 55 %.
        await zoomOutFar(page);
        await expect(page.locator('#tree-canvas')).toHaveClass(/zoom-far/);
        await expect(card(page, 'Jan').locator('.card-signal')).toBeHidden();
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toBeVisible();
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toBeHidden();
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeVisible();
    });

    test('zoomed out: at 40 % the status mark stays in the corner, readable; under 30 % it goes (spec 066 P4 §7)', async ({ page }) => {
        await setup(page);
        const jan = card(page, 'Jan');
        const mark = jan.locator(':scope > .card-status-mark');
        await zoomTo(page, 0.4);
        await expect(page.locator('#tree-canvas')).toHaveClass(/zoom-far/);
        await expect(page.locator('#tree-canvas')).not.toHaveClass(/zoom-tiny/);
        await expect(mark).toBeVisible();
        const far = await jan.evaluate((el) => {
            const c = el.getBoundingClientRect();
            const m = el.querySelector(':scope > .card-status-mark')!.getBoundingClientRect();
            return { h: m.height, right: c.right - m.right, bottom: c.bottom - m.bottom, inside: m.left >= c.left && m.top >= c.top };
        });
        // 12px × 0.85 / 0.4 world px = about 10px on screen, its corner kept (5px + the 1px border, × 0.4).
        expect(far.h).toBeGreaterThan(9);
        expect(far.right).toBeGreaterThan(1);
        expect(far.right).toBeLessThan(4);
        expect(far.bottom).toBeGreaterThan(1);
        expect(far.bottom).toBeLessThan(4);
        expect(far.inside).toBe(true);
        await expect(jan.locator(':scope > .card-story')).toBeHidden();
        await zoomTo(page, 0.25);
        await expect(page.locator('#tree-canvas')).toHaveClass(/zoom-tiny/);
        await expect(mark).toBeHidden();
        await expect(jan.locator(':scope > .card-signal-dot')).toBeVisible();
        // Back at 100 %: its own size, beside the fold.
        await zoomTo(page, 1);
        await expect(page.locator('#tree-canvas')).not.toHaveClass(/zoom-far|zoom-tiny/);
        expect((await mark.boundingBox())!.height).toBeCloseTo(12, 0);
        await expect(mark).toHaveCSS('right', '15px');
    });

    test('zoomed out: the ⇄ pill keeps clear of the grown mark, the lock goes; under 30 % the edge pills go too (spec 066 P4 §7)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async () => {
            const P = (id: string, o: Record<string, unknown>) => ({ id, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o });
            const S = window.Strom;
            await S.DataManager.importAsNewTree({ persons: { a: P('a', { firstName: 'Hostivít', lastName: 'Kvapilík', birthDate: '1878' }) }, partnerships: {} }, 'Jinde');
            await S.DataManager.importAsNewTree({ persons: {
                a: P('a', { firstName: 'Hostivít', lastName: 'Kvapilík', birthDate: '1878', birthSourceIds: ['s1'], isLocked: true }),
            }, partnerships: {}, sources: { s1: { id: 's1', title: 'Matrika' } } }, 'Karty');
        });
        const h = card(page, 'Hostivít');
        await expect(h.locator('.cross-tree-badge')).toBeVisible();
        await expect(h.locator(':scope > .lock-icon')).toBeVisible();
        const apart = () => h.evaluate((el) => {
            const m = el.querySelector(':scope > .card-status-mark')!.getBoundingClientRect();
            const x = el.querySelector('.cross-tree-badge')!.getBoundingClientRect();
            return m.left - x.right;
        });
        for (const s of [0.5, 0.4, 0.32]) {
            await zoomTo(page, s, 'Hostivít');
            expect(await apart()).toBeGreaterThan(0);
            await expect(h.locator(':scope > .lock-icon')).toBeHidden();
        }
        await zoomTo(page, 0.25, 'Hostivít');
        await expect(h.locator('.cross-tree-badge')).toBeHidden();
        await zoomTo(page, 1, 'Hostivít');
        await expect(h.locator('.cross-tree-badge')).toBeVisible();
        await expect(h.locator(':scope > .lock-icon')).toBeVisible();
    });

    test('printing the page: the status mark and the fold, no badge, whatever the zoom (spec 066 P4 §7)', async ({ page }) => {
        await setup(page);
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toBeVisible();
        await zoomTo(page, 0.25);
        await page.emulateMedia({ media: 'print' });
        for (const sel of [':scope > .card-status-mark', ':scope > .card-story']) {
            await expect(card(page, 'Jan').locator(sel)).toBeVisible();
        }
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toHaveCSS('transform', 'none');
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toHaveCSS('right', '15px');
        for (const sel of ['.card-signal', '.card-signal-dot']) await expect(card(page, 'Jan').locator(sel)).toBeHidden();
        // The same with the print view's class on screen.
        await page.emulateMedia({ media: 'screen' });
        await page.evaluate(() => document.body.classList.add('view-mode-print'));
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toBeVisible();
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toBeVisible();
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeHidden();
    });

    test('image export: the status mark and the fold as the cards show them, only with their switch on (spec 066 P4 §7)', async ({ page }) => {
        await setup(page);
        const on = await posterSvg(page);
        // Jan ●●, a draft (hollow fold); Josef an empty dotted frame and a full fold.
        expect(on).toContain('<g class="card-status-mark" data-status="cs-p2">');
        expect(on).toContain('<g class="card-status-mark" data-status="cs-none">');
        expect(on).toContain('<g class="card-story hollow">');
        expect(on).toContain('<g class="card-story">');
        // The badges and the agent are this device's: never in the image.
        expect(on).not.toMatch(/card-signal|≠<\/text>/);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await page.locator('#card-signals-settings input[data-signal="status"]').uncheck();
        await page.keyboard.press('Escape');
        const off = await posterSvg(page);
        expect(off).not.toContain('card-status-mark');
        expect(off).toContain('card-story');
    });

    test('image export with living people protected: no mark or fold on a living person\'s card (spec 066 P4 §7)', async ({ page }) => {
        await plainTree(page, {
            a: { firstName: 'Hostivít', lastName: 'Kvapilík', gender: 'male', birthDate: '1850', deathDate: '1921', birthSourceIds: ['s1'], story: { text: 'Mlýn.', status: 'final' } },
            b: { firstName: 'Zdeslava', lastName: 'Kvapilíková', birthDate: '1990', birthSourceIds: ['s1'], story: { text: 'Dnes.', status: 'final' } },
        }, { s1: { id: 's1', title: 'Matrika' } });
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await page.locator('#poster-privacy-mode').selectOption('initials');
        const svg = await posterSvg(page);
        expect(svg.match(/<g class="card-status-mark"/g) ?? []).toHaveLength(1);
        expect(svg.match(/<g class="card-story/g) ?? []).toHaveLength(1);
    });

    test('Settings: switching a signal off hides it on the card, the tooltip keeps it', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#card-signals-settings');
        // One preview for the density and the signals, under the density select.
        const preview = page.locator('#card-preview-settings .card-signals-preview');
        await expect(preview.locator('.person-card')).toBeVisible();
        await expect(preview.locator('.name-text')).toHaveText('Jan Vlk');
        // A research tree: "Awaiting action" is offered; the agent only with the research connected here.
        await expect(settings.locator('input[data-signal="waiting"]')).toHaveCount(1);
        await expect(settings.locator('input[data-signal="agent"]')).toHaveCount(0);
        // The preview's invented person carries ●○ while the status is on.
        await expect(preview.locator('.card-status-mark.cs-p1')).toHaveCount(1);
        await settings.locator('input[data-signal="conflict"]').uncheck();
        await settings.locator('input[data-signal="status"]').uncheck();
        await expect(preview.locator('.card-status-mark')).toHaveCount(0);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toHaveCount(0);
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-status')).toHaveCount(1);
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-action')).toHaveText(['1 conflict · 1 hypothesis']);
        // Eva still shows the waiting task.
        await expect(card(page, 'Eva').locator('.card-signal')).toHaveText('!');
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-card-signals') ?? '{}'))).toMatchObject({ conflict: false, status: false, v: 2 });
        // Back on: the mark returns in the tree and the preview.
        await settings.locator('input[data-signal="status"]').check();
        await expect(preview.locator('.card-status-mark.cs-p1')).toHaveCount(1);
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toHaveCount(1);
    });

    test('Settings → Show on card: three groups in order, what is always shown, the branch colours and the help (spec 066 P4 §3)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#card-signals-settings');
        await expect(settings.locator('.card-signals-group-title')).toHaveText(['Person status', 'Awaiting a decision', 'Links']);
        const keys = (group: string) => settings.locator(`.card-signals-group--${group} input[data-signal]`)
            .evaluateAll(els => els.map(el => (el as HTMLInputElement).dataset.signal));
        expect(await keys('state')).toEqual(['status', 'story']);
        // A research tree without the research connected here: waiting yes, the agent no.
        expect(await keys('action')).toEqual(['waiting', 'conflict', 'question']);
        expect(await keys('links')).toEqual(['crossTree']);
        // Everything on by default.
        expect(await settings.locator('input[data-signal]').evaluateAll(els => els.every(el => (el as HTMLInputElement).checked))).toBe(true);
        await expect(settings.locator('.card-signals-group--state .settings-desc')).toHaveText('Mark at the bottom right: how well the person is backed and who stands behind the facts.');
        await expect(settings.locator('.card-signals-always')).toHaveText('Always shown: lock, sibling order, branch tabs.');
        // The older rows are gone: one switch for the tree cards, the cross-tree pill in the list.
        await expect(page.locator('#reliability-tree-toggle, #cross-tree-badges-toggle')).toHaveCount(0);
        // The person dialog's pills: their own row right under the list.
        const own = page.locator('#card-signals-settings + .reliability-card-setting');
        await expect(own.locator('.settings-name')).toHaveText('Reliability at facts in the person card');
        await expect(own.locator('#reliability-card-toggle')).toHaveCount(1);
        // In the app, no marks of a new window.
        const branch = settings.locator('.card-signals-branch-link');
        await expect(branch).toHaveText('Branch colours: Tree settings ›');
        await branch.click();
        await expect(page.locator('#branch-colors-toggle')).toBeFocused();
        await expect(page.locator('#branch-colors-toggle')).toBeInViewport();
        const help = settings.locator('.card-signals-help-link');
        await expect(help).toHaveText('What the marks mean');
        await help.click();
        await expect(page.locator('.help-rule[data-rule="R3.8"]')).toHaveClass(/is-target/);
    });

    test('settings of an older build: stripes and the tree cards\' reliability both off stay off as one status switch (spec 066 P4 §8)', async ({ page }) => {
        await page.addInitScript(() => {
            if (sessionStorage.getItem('seeded-old')) return;
            sessionStorage.setItem('seeded-old', '1');
            localStorage.setItem('strom-card-signals', JSON.stringify({ evidence: false, conflict: false }));
            const app = JSON.parse(localStorage.getItem('strom-settings') ?? '{}');
            localStorage.setItem('strom-settings', JSON.stringify({ ...app, reliabilityTree: false, crossTreeBadges: false }));
        });
        await setup(page);
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toHaveCount(0);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-card-signals') ?? '{}')))
            .toMatchObject({ v: 2, status: false, conflict: false, crossTree: false });
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#card-signals-settings');
        await expect(settings.locator('input[data-signal="status"]')).not.toBeChecked();
        await expect(settings.locator('input[data-signal="crossTree"]')).not.toBeChecked();
        await expect(settings.locator('input[data-signal="story"]')).toBeChecked();
    });

    test('a tree without any source shows no evidence; a question gets the ? badge', async ({ page }) => {
        await plainTree(page, {
            a: { firstName: 'Marie', lastName: 'Dvořáková', birthDate: '1901', question: 'Kde se narodila?' },
        });
        await expect(card(page, 'Marie')).toBeVisible();
        await expect(card(page, 'Marie').locator('.card-status-mark')).toHaveCount(0);
        await expect(card(page, 'Marie').locator('.card-tooltip .tt-status')).toHaveCount(0);
        await expect(card(page, 'Marie').locator('.card-signal')).toHaveText('?');
        await expect(card(page, 'Marie').locator('.card-tooltip .tt-action')).toHaveText(['Question: Kde se narodila?']);
    });

    test('the name keeps its whole row; the status mark stays inside the card', async ({ page }) => {
        await plainTree(page, {
            k: {
                firstName: 'Kateřina', lastName: 'Fýšková', birthDate: '1842', deathDate: '1901',
                birthPlace: 'Chlumy u Třeboně, okres Jindřichův Hradec', sourceIds: ['s1'],
                story: { text: 'Kateřina vedla hospodu.', status: 'draft' },
            },
        }, { s1: { id: 's1', title: 'Matrika' } });
        const k = card(page, 'Kateřina');
        await expect(k.locator(':scope > .card-status-mark')).toBeVisible();
        await expect(k.locator(':scope > .card-story.draft')).toBeVisible();
        // The names are fitted a frame after the render (and again once the card fonts are in).
        await expect.poll(() => k.locator('.name-text').evaluate(el => el.scrollWidth > el.clientWidth + 0.5)).toBe(false);
        // The card keeps its width (the focused card is drawn a little larger).
        expect(await k.evaluate(el => (el as HTMLElement).offsetWidth)).toBe(188);
        const box = await k.boundingBox();
        // The mark stays inside the card.
        const icons = await k.locator(':scope > .card-status-mark').boundingBox();
        expect(icons!.x + icons!.width).toBeLessThanOrEqual(box!.x + box!.width);
    });

    test('Evidence in tree: every card framed by its level, counts switch to a group', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showTreeOverview(window.Strom.DataManager.getCurrentTreeId(), { section: 'quality' }));
        await page.locator('#tree-overview-modal [data-tov="levels"]').click();
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        await expect(card(page, 'Jan')).toHaveClass(/evl-full/);
        await expect(card(page, 'Josef')).toHaveClass(/evl-none/);
        await expect(page.locator('.person-card.evidence-dim')).toHaveCount(0);
        const pill = page.locator('#evidence-pill');
        await expect(pill.locator('.evidence-pill-level')).toHaveText(['1', '0', '3']);
        // Each level drawn as the cards' frame in this mode, no glyph of another font's size (1109).
        await expect(pill.locator('.evidence-pill-swatch')).toHaveCount(3);
        await pill.locator('.evidence-pill-level-none').click();
        await expect(card(page, 'Josef')).toHaveClass(/evidence-hit/);
        await expect(card(page, 'Jan')).toHaveClass(/evidence-dim/);
        await expect(pill.locator('.evidence-pill-level-none')).toHaveAttribute('aria-pressed', 'true');
        await expect(pill.locator('.evidence-pill-next')).toBeVisible();
        await pill.locator('.evidence-pill-level-none').click();
        await expect(card(page, 'Jan')).toHaveClass(/evl-full/);
        await page.keyboard.press('Escape');
        await expect(pill).toHaveCount(0);
        await expect(page.locator('.person-card.evl-full')).toHaveCount(0);
    });

    test('phone without the live strip: back and forward stand above the Evidence pill and take a tap, in the tree and the fan (1101)', async ({ page }) => {
        await setup(page, 390);
        const idOf = (first: string) => page.evaluate((f) =>
            window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === f)!.id, first);
        const focusName = () => page.evaluate(() => window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId()!)?.firstName ?? null);
        const navClash = (): Promise<string[]> => page.evaluate(() => {
            const rect = (el: Element | null) => {
                const r = el?.getBoundingClientRect();
                return r && r.width > 0 && r.height > 0 && getComputedStyle(el!).visibility !== 'hidden' ? r : null;
            };
            const out: string[] = [];
            if (!rect(document.querySelector('#evidence-pill'))) out.push('no pill');
            for (const nav of ['#focus-back-btn', '#focus-forward-btn']) {
                const n = rect(document.querySelector(nav));
                if (!n) { if (nav === '#focus-back-btn') out.push('no back'); continue; }
                if (n.top < 0 || n.bottom > window.innerHeight || n.left < 0 || n.right > window.innerWidth) out.push(`${nav} outside`);
                const hit = document.elementFromPoint(n.left + n.width / 2, n.top + n.height / 2);
                if (!hit?.closest(nav)) out.push(`${nav} under ${hit?.id || hit?.className}`);
                for (const sel of ['#evidence-pill', '#fan-origin-pill', '#fan-legend-chip', '#fan-legend', '#fan-zoom-controls', '#fan-toolbar',
                    '.zoom-controls', '.control-block', '.bottom-bar', '.tree-legend', 'body > .toast.show']) {
                    for (const el of document.querySelectorAll(sel)) {
                        const b = rect(el);
                        if (b && n.left < b.right && b.left < n.right && n.top < b.bottom && b.top < n.bottom) out.push(`${nav} × ${sel}`);
                    }
                }
            }
            return out;
        });
        await page.evaluate(() => window.Strom.UI.showEvidenceLevels());
        await expect(page.locator('#evidence-pill')).toBeVisible();
        await expect(page.locator('#live-panel.phone-strip:not([hidden])')).toHaveCount(0);
        for (const [w, h] of [[390, 844], [844, 390]]) {
            await page.setViewportSize({ width: w, height: h });
            for (const mode of ['family', 'fan']) {
                await page.evaluate((m) => window.Strom.UI.setDisplayViewMode(m as 'family'), mode);
                await expect(page.locator('body')).toHaveAttribute('data-view-mode', mode);
                const start = await focusName();
                // A step to another person shows the back button.
                const other = start === 'Eva' ? 'Jan' : 'Eva';
                await page.evaluate((p) => window.Strom.TreeRenderer.setFocus(p as never), await idOf(other));
                await expect(page.locator('#focus-back-btn')).toBeVisible();
                await expect.poll(navClash, `${w}×${h} ${mode}`).toEqual([]);
                // A toast keeps clear of the buttons too.
                await page.evaluate(() => window.Strom.UI.showToast('Fíškovi: 4 osoby, 1 rodina', 10000));
                await expect(page.locator('body > .toast.show')).toBeVisible();
                await expect.poll(navClash, `${w}×${h} ${mode} toast`).toEqual([]);
                await page.locator('#focus-back-btn').click();
                await expect.poll(focusName, `${w}×${h} ${mode}`).not.toBe(other);
            }
        }
    });

    test('phone: the person sheet starts with what there is to do, no block explaining the marks', async ({ page }) => {
        await setup(page, 360);
        await card(page, 'Jan').locator('.name').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet.locator('.menu-person-state')).toHaveCount(0);
        await expect(sheet.locator('.menu-act .menu-act-text')).toHaveText(['What the research knows · 1 conflict, 1 hypothesis ›']);
    });

    test('touch: a tap on a mark opens its tip pinned with the action as a 44px button; the status mark\'s tip carries the story (spec 065 round 2, §9)', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' });
        const page = await context.newPage();
        await openApp(page);
        await dropFile(page, researchGed());
        const jan = card(page, 'Jan');
        await expect(jan).toBeVisible();
        await jan.evaluate(el => window.Strom.ZoomPan.centerOnPerson((el as HTMLElement).dataset.id as never));
        await expect(page.locator('#tree-canvas')).not.toHaveClass(/is-moving/);
        const tip = page.locator('#status-tip');
        const tapAt = async (x: number, y: number) => { await page.touchscreen.tap(x, y); };
        const box = (await jan.boundingBox())!;

        // D: the card's bottom-right corner — the status tip, with the story's row.
        await tapAt(box.x + box.width - 6, box.y + box.height - 3);
        await expect(tip).toBeVisible();
        await expect(tip.locator('.st-head')).toContainText('Backed by sources');
        const story = tip.getByRole('button', { name: /^Story/ });
        await expect(story).toBeVisible();
        expect((await story.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
        await story.tap();
        await expect(page.locator('#person-story-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-story-modal')).toBeHidden();

        // C: the badge — its bubble pinned with the action.
        const badge = (await jan.locator('.card-signal').boundingBox())!;
        await tapAt(badge.x + badge.width / 2, badge.y + badge.height / 2);
        await expect(tip).toBeVisible();
        await expect(tip.locator('.st-head')).toHaveText('Conflict in sources');
        const act = tip.locator('.st-mark-action');
        await expect(act).toHaveCount(1);
        expect((await act.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        await act.tap();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await page.keyboard.press('Escape');

        // The card's middle: the person sheet as before.
        await jan.locator('.name').tap();
        await expect(page.locator('.bottom-sheet-person')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        await context.close();
    });

    test('phone: the sheet\'s rows take 48px; held sideways the menu is a 360px panel at the right, scrolling, closed by a tap beside it (spec 066 P4 §9)', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' });
        const page = await context.newPage();
        await openApp(page);
        await dropFile(page, researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        // The card is the same on touch: the mark in its place and size.
        const mark = card(page, 'Jan').locator(':scope > .card-status-mark');
        await expect(mark).toHaveCSS('height', '12px');
        await expect(mark).toHaveCSS('right', '15px');
        await card(page, 'Jan').locator('.name').tap();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet.locator('.menu-act')).toHaveCount(1);
        await page.waitForTimeout(300);
        const rows = await sheet.locator('.bottom-sheet-items > .bottom-sheet-item:not(.sheet-tile):not(.menu-chip):visible').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
        expect(rows.length).toBeGreaterThan(0);
        for (const h of rows) expect(h).toBeGreaterThanOrEqual(47.5);
        // From the bottom, the whole width.
        const portrait = (await sheet.boundingBox())!;
        expect(portrait.x).toBeLessThanOrEqual(1);
        expect(portrait.y + portrait.height).toBeCloseTo(844, 0);
        await page.locator('.bottom-sheet-overlay').click({ position: { x: 20, y: 20 } });
        await expect(sheet).toHaveCount(0);

        // Held sideways: a panel at the right, 360px, over the whole height.
        await page.setViewportSize({ width: 844, height: 390 });
        await card(page, 'Jan').evaluate(el => window.Strom.ZoomPan.centerOnPerson((el as HTMLElement).dataset.id as never));
        await card(page, 'Jan').locator('.name').tap();
        await expect(sheet.locator('.menu-act')).toHaveCount(1);
        await expect.poll(async () => (await sheet.boundingBox())!.x).toBeCloseTo(844 - 360, 0);
        const side = (await sheet.boundingBox())!;
        expect(side.width).toBeCloseTo(360, 0);
        expect(side.y).toBeLessThanOrEqual(0.5);
        expect(side.height).toBeCloseTo(390, 0);
        // Taller than the phone: it scrolls; nothing runs off sideways.
        const scroll = await sheet.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY }));
        expect(scroll.overflow).toBe('auto');
        expect(scroll.scroll).toBeGreaterThan(scroll.client);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
        for (const h of await sheet.locator('.bottom-sheet-items > .bottom-sheet-item:not(.sheet-tile):not(.menu-chip):visible').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
            expect(h).toBeGreaterThanOrEqual(47.5);
        }
        // The tree to the left stays in view; a tap there closes the panel.
        await page.locator('.bottom-sheet-overlay').click({ position: { x: 200, y: 200 } });
        await expect(sheet).toHaveCount(0);
        await context.close();
    });

    test('dark theme: the same shapes in the dark variables (spec 066 P4 §9)', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'en-US' });
        const page = await context.newPage();
        await openApp(page);
        await dropFile(page, researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        const look = (name: string) => card(page, name).locator(':scope > .card-status-mark').evaluate((el) => {
            const probe = (v: string, prop: 'color' | 'backgroundColor' = 'color') => {
                const p = document.createElement('span');
                p.style[prop] = `var(${v})`;
                el.parentElement!.appendChild(p);
                const c = getComputedStyle(p)[prop];
                p.remove();
                return c;
            };
            const cs = getComputedStyle(el);
            return {
                bg: cs.backgroundColor, wantBg: probe('--surface-2', 'backgroundColor'),
                ink: cs.color, wantInk: probe('--text-light'), wantFaint: probe('--text-faint'),
                frame: cs.borderTopColor, wantFrame: probe('--border'), wantLine: probe('--line-color'), style: cs.borderTopStyle,
                dark: document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
            };
        });
        const jan = await look('Jan');
        expect(jan.dark).toBe('dark');
        // ●●: the second surface, the light text's dots, the hairline frame.
        expect(jan.bg).toBe(jan.wantBg);
        expect(jan.ink).toBe(jan.wantInk);
        expect(jan.frame).toBe(jan.wantFrame);
        expect(jan.bg).not.toBe('rgb(246, 242, 234)');
        // No source: a dotted frame of the line colour, no fill.
        const josef = await look('Josef');
        expect(josef.style).toBe('dotted');
        expect(josef.frame).toBe(josef.wantLine);
        expect(josef.ink).toBe(josef.wantFaint);
        expect(josef.bg).toBe('rgba(0, 0, 0, 0)');
        await context.close();
    });

    test('the tree legend names only the card marks the tree shows, with the help (spec 066 P4 §5)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => { window.Strom.SettingsManager.setBranchLegend(true); window.Strom.TreeRenderer.render(); });
        const part = page.locator('#tree-legend #legend-marks');
        await expect(part.locator('.legend-marks-title')).toHaveText('Card marks');
        const shown = await page.evaluate(() => {
            const has = (sel: string) => !!document.querySelector(`#tree-canvas .person-card ${sel}`);
            return {
                status: ['cs-human', 'cs-p2', 'cs-p1', 'cs-res', 'cs-import', 'cs-none'].filter(c => has(`> .card-status-mark.${c}`)),
                legend: [...document.querySelectorAll('#legend-marks .legend-mark .card-status-mark')].map(m => (m as HTMLElement).dataset.status),
            };
        });
        // Each mark the cards show, no other.
        expect(shown.legend).toEqual(shown.status);
        expect(shown.legend).toContain('cs-p2');
        expect(shown.legend).not.toContain('cs-import');
        await expect(part.locator('.legend-mark-row')).toContainText(['the person\'s story', 'a marriage story or a draft', 'awaiting a decision (!, ≠, ?)']);
        // No other tree here: no ⇄ row.
        await expect(part.locator('.legend-cross')).toHaveCount(0);
        await part.locator('.legend-marks-help').click();
        await expect(page.locator('.help-rule[data-rule="R3.8"]')).toHaveClass(/is-target/);
        // Without the legend setting no legend at all.
        await page.evaluate(() => { window.Strom.SettingsManager.setBranchLegend(false); window.Strom.TreeRenderer.render(); });
        await expect(page.locator('#tree-legend')).toBeHidden();
    });
});

test.describe('verify facts: the person and the tree (spec 065 §10 h–m)', () => {
    const FIX = { at: '2026-11-08T22:41:07Z', facts: 3, people: 2 };
    const LINE = { id: 'G0001', name: 'Fíšek line', state: 'active', focus: 'P0003' };
    const COUNTS = { asked: 0, images: 0, permission: 0, kept: 0, confirmed: 0 };

    async function verifySetup(page: Page, statusExtra: Record<string, unknown> = {}): Promise<{ bridge: FakeBridge; verify: FakeVerify; jan: string }> {
        const bridge = await fakeBridge(page, { features: VERIFY_FEATURES, treeGed: verifyGed(), statusExtra: { researches: [LINE], ...statusExtra } });
        const verify = await fakeVerify(page, bridge);
        await openResearch(page, { ged: verifyGed() });
        await poll(page);
        const jan = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), jan);
        return { bridge, verify, jan };
    }

    test('the person menu has one "Verify facts · N" with the AI badge alone; the preview recounts, 0 checked cannot start; a start makes it "Verifying · N"', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const { verify } = await verifySetup(page);
        await card(page, 'Jan').locator('.name').click();
        const menu = page.locator('.context-menu');
        const item = menu.locator('[data-action="signal-verify"]');
        await expect(item).toHaveCount(1);
        await expect(menu.locator('.menu-act', { hasText: 'Verify facts' })).toHaveCount(1);
        await expect(item.locator('.menu-act-text')).toContainText('Verify facts · 2');
        await expect(item.locator('.research-ai-badge')).toHaveCount(1);
        await expect(item.locator('svg')).toHaveCount(0);
        await item.click();

        const dialog = page.locator('#verify-person-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.vfy-check')).toHaveCount(2);
        expect(verify.posts[0]).toEqual({ route: 'verify', body: { person: 'P0003', dry: true } });
        const est = dialog.locator('.vfy-est-head');
        const start = dialog.locator('[data-vfy="start"]');
        await expect(est).toHaveText('Estimate: 1 low, 1 higher');
        await expect(start).toContainText('Verify (2)');
        await expect(start.locator('.research-ai-badge')).toHaveCount(1);
        // The kind's rule: × in the header, Cancel right before the one primary.
        await expect(dialog.locator('.close-btn')).toHaveCount(1);
        expect(await dialog.locator('.buttons [data-dismiss]').evaluate(el => el.nextElementSibling?.classList.contains('primary'))).toBe(true);
        // The research's answer drew the content again: the focus stayed in the dialog.
        await expect(dialog.locator('[data-dismiss]')).toBeFocused();

        await dialog.locator('.vfy-check').nth(1).uncheck();
        await expect(est).toHaveText('Estimate: 1 low, 0 higher');
        await expect(start).toContainText('Verify (1)');
        await dialog.locator('.vfy-check').nth(0).uncheck();
        await expect(est).toHaveText('Estimate: 0 low, 0 higher');
        await expect(start).toBeDisabled();
        await dialog.locator('.vfy-check').nth(0).check();
        await dialog.locator('.vfy-check').nth(1).check();
        await expect(start).toBeEnabled();
        await start.click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: '2 facts queued for verification.' })).toBeVisible();
        expect(verify.posts.filter(p => !p.body.dry)).toEqual([{ route: 'verify', body: { person: 'P0003' } }]);

        // Both facts wait now: no "Verify facts"; "Verifying · 2" leads to what the research knows.
        await card(page, 'Jan').locator('.name').click();
        await expect(menu.locator('[data-action="signal-verify"]')).toHaveCount(0);
        const pending = menu.locator('[data-action="signal-verify-pending"]');
        await expect(pending.locator('.menu-act-text')).toHaveText('Verifying · 2');
        await expect(pending.locator('.research-ai-badge')).toHaveCount(0);
        await pending.click();
        const knows = page.locator('#person-research-modal [data-verify-section="person"]');
        await expect(knows).toBeVisible();
        await expect(knows.locator('.vfy-sec-pending')).toContainText('Waiting to be verified: 2 facts');
        await expect(knows.locator('[data-verify-act="bulk"] .research-ai-badge')).toHaveCount(1);
        await knows.locator('[data-verify-act="bulk"]').click();
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        await expect(page.locator('#verify-bulk-modal')).toBeVisible();
    });

    test('the person card: "Verify facts (N)" with the AI badge above the events, as in the menu; after a start how many wait (1109)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const { verify } = await verifySetup(page);
        await cardAction(page, 'Jan', 'edit');
        const modal = page.locator('#person-modal');
        const row = modal.locator('#pm-verify-row');
        await expect(row).toBeVisible();
        // Right above the events, inside their section.
        expect(await row.evaluate(el => el.nextElementSibling?.id)).toBe('events-section');
        const btn = row.locator('.pm-verify-btn');
        await expect(btn).toContainText('Verify facts (2)');
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        await expect(btn.locator('svg')).toHaveCount(0);
        await btn.click();
        const dialog = page.locator('#verify-person-modal');
        await expect(dialog).toBeVisible();
        expect(verify.posts[0]).toEqual({ route: 'verify', body: { person: 'P0003', dry: true } });
        await expect(dialog.locator('.vfy-check')).toHaveCount(2);
        await dialog.locator('[data-vfy="start"]').click();
        await expect(dialog).toHaveCount(0);
        // The person card stays open: the row now says how many wait, no button.
        await expect(modal).toHaveClass(/active/);
        await expect(row).toHaveText('2 facts waiting to be verified');
        await expect(row.locator('button')).toHaveCount(0);
        // The pills say they are controls: a pointer and a ring under the mouse.
        const pill = modal.locator('button.fact-status').first();
        await expect(pill).toHaveCSS('cursor', 'pointer');
        await pill.hover();
        await expect(pill).not.toHaveCSS('box-shadow', 'none');
    });

    test('the card mark\'s tip: "Verify facts (N)" is a button of the tip, drawn as the fact tip\'s Verify (1109)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await verifySetup(page);
        await card(page, 'Jan').locator(':scope > .card-status-mark[data-mark="status"]').click();
        const tip = page.locator('#status-tip');
        await expect(tip).toBeVisible();
        const btn = tip.locator('.st-acts > .st-verify-person');
        await expect(btn).toContainText('Verify facts (2)');
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        // A framed button as the tip's other actions, not bare text.
        await expect(btn).toHaveClass(/\bst-v-btn\b/);
        await expect(btn).toHaveCSS('border-top-style', 'solid');
        await expect(btn).toHaveCSS('border-top-left-radius', '8px');
        expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(30);
        await btn.click();
        await expect(page.locator('#verify-person-modal')).toBeVisible();
    });

    test('a person with residences: the menu counts what /verify takes (the residences too), as the preview does; the toast says what the research queued', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // Two residences the research holds (their ids): no "Verify" of their own, but a person's /verify takes them.
        const resi = ['1 RESI', '2 DATE 1880', '2 PLAC Čapkov', '2 _STROM_STATUS lead', '2 _STROM_EID E0014',
            '1 RESI', '2 DATE 1890', '2 PLAC Lhota', '2 _STROM_STATUS lead', '2 _STROM_EID E0015'];
        const ged = verifyGed(undefined, resi);
        const facts = [
            { fact: 'E0012', kind: 'BIRT', how: 'read', record: { source: 'S0001', title: 'Křestní matrika Čapkov', page: 'fol. 12' } },
            { fact: 'E0013', kind: 'DEAT', how: 'search' },
            { fact: 'E0014', kind: 'RESI', how: 'search' },
            { fact: 'E0015', kind: 'RESI', how: 'search' },
        ];
        const bridge = await fakeBridge(page, { features: VERIFY_FEATURES, treeGed: ged, statusExtra: { researches: [LINE] } });
        // The start queues one more than the preview listed (a fact the research holds that the tree does not show).
        const verify = await fakeVerify(page, bridge, { facts, startFacts: [...facts, { fact: 'E0016', kind: 'CENS', how: 'search' }] });
        await openResearch(page, { ged });
        await poll(page);
        const jan = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), jan);

        await card(page, 'Jan').locator('.name').click();
        const menu = page.locator('.context-menu');
        await expect(menu.locator('[data-action="signal-verify"] .menu-act-text')).toContainText('Verify facts · 4');
        await menu.locator('[data-action="signal-verify"]').click();
        const dialog = page.locator('#verify-person-modal');
        await expect(dialog.locator('.vfy-check')).toHaveCount(4);
        await expect(dialog.locator('[data-vfy="start"]')).toContainText('Verify (4)');
        await dialog.locator('[data-vfy="start"]').click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: '5 facts queued for verification.' })).toBeVisible();
        expect(verify.posts.filter(p => !p.body.dry)).toEqual([{ route: 'verify', body: { person: 'P0003' } }]);

        // Each of the four the tree holds waits now (the residences too).
        await card(page, 'Jan').locator('.name').click();
        await expect(menu.locator('[data-action="signal-verify"]')).toHaveCount(0);
        await expect(menu.locator('[data-action="signal-verify-pending"] .menu-act-text')).toHaveText('Verifying · 4');
    });

    test('the tree\'s Verifying: Stop, then the bulk dialog with the line, nearest ancestors first and a try on 5 people; the estimate follows the choice', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // The research's asked, images and permission are counts among its waiting ones, not more of them.
        const { verify } = await verifySetup(page, { verify: { ...COUNTS, waiting: 2, asked: 2, images: 1 } });
        await page.evaluate(() => window.Strom.UI.showVerifyTreeDialog());
        const tree = page.locator('#verify-tree-modal');
        await expect(tree.locator('.vfy-sec-pending')).toContainText('Waiting to be verified: 2 facts');
        const stop = tree.locator('[data-verify-act="stop"]');
        await expect(stop).toHaveText('Stop');
        await expect(stop.locator('.research-ai-badge')).toHaveCount(0);
        await stop.click();
        await expect(page.locator('.toast', { hasText: 'Verification stopped.' })).toBeVisible();
        expect(verify.posts.at(-1)).toEqual({ route: 'verify/stop', body: {} });
        await tree.locator('[data-verify-act="bulk"]').click();
        await expect(tree).toHaveCount(0);

        const bulk = page.locator('#verify-bulk-modal');
        await expect(bulk).toBeVisible();
        const scopes = bulk.locator('input[name="vfy-scope"]');
        await expect(scopes).toHaveCount(3);
        await expect(scopes.first()).toBeChecked();
        await expect(bulk.locator('.vfy-opt').first()).toContainText('Line: Fíšek line');
        await expect(bulk.locator('[data-scope-count="line"]')).toHaveText('4 facts');
        await expect(bulk.locator('[data-scope-count="tree"]')).toHaveText('30 facts');
        await expect(bulk.locator('input[name="vfy-order"][value="ancestors"]')).toBeChecked();
        await expect(bulk.locator('input[name="vfy-try"]')).toBeChecked();
        const start = bulk.locator('[data-vfy="start"]');
        await expect(start).toContainText('Try on 5');
        await expect(start.locator('.research-ai-badge')).toHaveCount(1);
        await expect(bulk.locator('.vfy-est-head')).toContainText('4 facts');
        expect(verify.posts.some(p => p.route === 'verify/bulk' && p.body.scope === 'line' && p.body.of === 'G0001'
            && p.body.order === 'ancestors' && p.body.try === 5 && p.body.dry === true)).toBe(true);

        // The whole tree without a try: 30 facts.
        await scopes.nth(2).check();
        await bulk.locator('input[name="vfy-try"]').uncheck();
        await expect(start).toContainText('Verify (30)');
        await expect(bulk.locator('.vfy-est-head')).toContainText('30 facts');
        await start.click();
        await expect(bulk).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: '30 facts queued for verification.' })).toBeVisible();
        expect(verify.posts.at(-1)).toEqual({ route: 'verify/bulk', body: { scope: 'tree', order: 'ancestors' } });
    });

    test('the preview names every fact the research sends by its name, never by its tag (OCCU → Occupation) (1109)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const ged = verifyGed(undefined, ['1 OCCU kovář', '2 _STROM_STATUS lead', '2 _STROM_EID E0014']);
        const facts = [
            { fact: 'E0012', kind: 'BIRT', how: 'read', record: { source: 'S0001', title: 'Křestní matrika Čapkov', page: 'fol. 12' } },
            { fact: 'E0014', kind: 'OCCU', how: 'search' },
            // Facts the tree does not show: named by their tags all the same.
            { fact: 'E0016', kind: 'CENS', how: 'search' },
            { fact: 'E0017', kind: 'EDUC', how: 'search' },
            { fact: 'E0018', kind: 'EVEN', how: 'search' },
        ];
        const bridge = await fakeBridge(page, { features: VERIFY_FEATURES, treeGed: ged, statusExtra: { researches: [LINE] } });
        await fakeVerify(page, bridge, { facts });
        await openResearch(page, { ged });
        await poll(page);
        const jan = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => window.Strom.UI.showVerifyPersonDialog(id as never), jan);
        const titles = page.locator('#verify-person-modal .vfy-row-title');
        await expect(titles).toHaveCount(5);
        await expect(titles).toHaveText([/^Birth/, 'Occupation', 'Census', 'Education', 'Other fact']);
        for (const tag of ['BIRT', 'OCCU', 'CENS', 'EDUC', 'EVEN']) await expect(page.locator('#verify-person-modal')).not.toContainText(tag);
    });

    test('the bulk dialog asks the research one request at a time: no "busy" refusal while it counts and estimates (1109)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const bridge = await fakeBridge(page, { features: VERIFY_FEATURES, treeGed: verifyGed(), statusExtra: { researches: [LINE] } });
        // As the research: a request that comes while another is answered gets 503 research.busy.
        const verify = await fakeVerify(page, bridge, { busy: 'overlap', delayMs: 150 });
        await openResearch(page, { ged: verifyGed() });
        await poll(page);
        const jan = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), jan);
        await page.evaluate(() => window.Strom.UI.showVerifyBulkDialog());
        const bulk = page.locator('#verify-bulk-modal');
        await expect(bulk.locator('.vfy-est-head')).toContainText('4 facts');
        await expect(bulk.locator('[data-scope-count="line"]')).toHaveText('4 facts');
        await expect(bulk.locator('[data-scope-count="lineage"]')).toHaveText('9 facts');
        await expect(bulk.locator('[data-scope-count="tree"]')).toHaveText('30 facts');
        // A new choice while the counts are asked waits its turn too.
        await bulk.locator('input[name="vfy-scope"]').nth(2).check();
        await expect(bulk.locator('.vfy-est-head')).toContainText('7 facts');
        await expect(bulk.locator('.vfy-error')).toHaveCount(0);
        expect(verify.busyAnswers).toBe(0);
        expect(verify.maxInFlight).toBe(1);
        await expect(bulk.locator('[data-vfy="start"]')).toBeEnabled();
        await bulk.locator('[data-vfy="start"]').click();
        await expect(page.locator('.toast', { hasText: 'facts queued for verification.' })).toBeVisible();
        expect(verify.busyAnswers).toBe(0);
        expect(verify.maxInFlight).toBe(1);
    });

    test('a dry run the research refuses as busy is asked again shortly; the estimate comes (1109)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const bridge = await fakeBridge(page, { features: VERIFY_FEATURES, treeGed: verifyGed(), statusExtra: { researches: [LINE] } });
        const verify = await fakeVerify(page, bridge, { busy: 2 });
        await openResearch(page, { ged: verifyGed() });
        await poll(page);
        const jan = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), jan);
        await page.evaluate(() => window.Strom.UI.showVerifyBulkDialog());
        const bulk = page.locator('#verify-bulk-modal');
        await expect(bulk.locator('.vfy-est-head')).toContainText('4 facts');
        await expect(bulk.locator('.vfy-error')).toHaveCount(0);
        expect(verify.busyAnswers).toBe(2);
        // The same estimate asked three times: twice busy, then answered.
        const estimates = verify.posts.filter(p => p.route === 'verify/bulk' && p.body.try === 5);
        expect(estimates.length).toBe(3);
    });

    test.describe('in Czech', () => {
        test.use({ locale: 'cs-CZ' });

        test('a research busy all the time: the bulk dialog says so in the app\'s language, never the bridge\'s English (1109)', async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            const bridge = await fakeBridge(page, { features: VERIFY_FEATURES, treeGed: verifyGed(), statusExtra: { researches: [LINE] } });
            await fakeVerify(page, bridge, { busy: 'always' });
            await openResearch(page, { ged: verifyGed() });
            await poll(page);
            const jan = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
            await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), jan);
            await page.evaluate(() => window.Strom.UI.showVerifyBulkDialog());
            const error = page.locator('#verify-bulk-modal .vfy-error');
            await expect(error).toHaveText('Výzkum je teď zaneprázdněný. Ověřování půjde za chvíli znovu.', { timeout: 10_000 });
            await expect(page.locator('#verify-bulk-modal')).not.toContainText('busy');
            await expect(page.locator('#verify-bulk-modal [data-vfy="start"]')).toBeDisabled();
        });
    });

    test('the toast after a run of re-verification comes once per run', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const { bridge } = await verifySetup(page, { verify: { waiting: 3, ...COUNTS, fix: FIX } });
        const toast = page.locator('.toast[data-kind="verify-queued"]');
        await expect(toast).toHaveCount(1);
        await expect(toast).toContainText('3 facts with an original are waiting to be verified');
        await toast.locator('button', { hasText: 'Details' }).click();
        await expect(page.locator('#verify-tree-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#verify-tree-modal')).toHaveCount(0);
        await poll(page);
        await poll(page);
        await expect(toast).toHaveCount(0);
        // Another run: the toast again.
        bridge.statusExtra = { ...bridge.statusExtra, verify: { waiting: 1, ...COUNTS, fix: { ...FIX, at: '2026-11-09T08:00:00Z', facts: 1 } } };
        await poll(page);
        await expect(toast).toHaveCount(1);
        await expect(toast).toContainText('1 fact with an original is waiting');
        // A run that says no count: the waiting ones, the asked among them not counted twice.
        bridge.statusExtra = { ...bridge.statusExtra, verify: { ...COUNTS, waiting: 2, asked: 2, fix: { ...FIX, at: '2026-11-09T09:00:00Z', facts: 0 } } };
        await poll(page);
        await expect(page.locator('.toast[data-kind="verify-queued"]', { hasText: '2 facts with an original are waiting' })).toHaveCount(1);
    });

    test('phone 390 × 844 with touch: the preview is a bottom sheet, its rows 52 px, its buttons 48 px, nothing wider than the screen', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const { jan } = await verifySetup(page);
        await touchScreenNow(page);
        await page.evaluate((id) => window.Strom.UI.showVerifyPersonDialog(id as never), jan);
        const modal = page.locator('#verify-person-modal .vfy-modal');
        await expect(modal.locator('.vfy-check')).toHaveCount(2);
        const look = await modal.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const row = el.querySelector('.vfy-row')!.getBoundingClientRect();
            const btns = [...el.querySelectorAll<HTMLElement>('.vfy-foot button')].map(b => b.getBoundingClientRect().height);
            const box = el.querySelector('.vfy-check')!.getBoundingClientRect();
            const main = el.querySelector('.vfy-row-main')!.getBoundingClientRect();
            // The checkbox beside the fact's text (a label of a dialog is no block above it).
            const beside = box.right <= main.left && box.top < main.bottom && box.bottom > main.top;
            return { left: r.left, right: r.right, bottom: r.bottom, row: row.height, btns, scroll: el.scrollWidth - el.clientWidth, vw: innerWidth, vh: innerHeight, beside };
        });
        expect(look.beside).toBe(true);
        expect(look.left).toBe(0);
        expect(Math.round(look.right)).toBe(look.vw);
        expect(Math.round(look.bottom)).toBe(look.vh);
        expect(look.row).toBeGreaterThanOrEqual(52);
        expect(Math.min(...look.btns)).toBeGreaterThanOrEqual(48);
        expect(look.scroll).toBeLessThanOrEqual(0);
        // Opened without a menu, drawn again with the answer: Esc still closes it.
        await page.keyboard.press('Escape');
        await expect(page.locator('#verify-person-modal')).toHaveCount(0);
    });
});
