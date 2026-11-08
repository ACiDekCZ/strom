import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

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
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-foot')).toHaveText('Click opens the menu that explains the marks');
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
        // Decoration only: a click there is a click on the card.
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toHaveCSS('pointer-events', 'none');
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
            await expect(jan.locator(':scope > .card-status-mark'), `${density}: no status mark far out`).toBeHidden();
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

    test('the desktop person menu leads with the marks explained: the mark, the story, the signal, the help (spec 066 P4 §5)', async ({ page }) => {
        await setup(page);
        await card(page, 'Jan').locator('.name').click();
        const first = page.locator('.context-menu .menu-person-state');
        // The bubble's rows in the card map's order, then the help.
        await expect(first.locator('.mps-status')).toHaveText('Backed by sources · 1 source');
        await expect(first.locator('.mps-status .card-status-mark.cs-p2')).toHaveCount(1);
        await expect(first.locator('.mps-story')).toHaveText('story (draft)');
        expect(await first.evaluate(el => [...el.children].map(c => c.classList[0] === 'mps-row' ? c.classList[1] : c.classList.contains('menu-signal') ? 'signal' : c.classList.contains('mps-link') ? c.dataset.action : '?')))
            .toEqual(['mps-status', 'mps-story', 'signal', 'marks-help']);
        await expect(first.locator('[data-action="marks-help"]')).toHaveText('What the marks mean');
        // The block stands on the second surface with a line under it.
        expect(await first.evaluate(el => getComputedStyle(el).borderBottomStyle)).toBe('solid');
        const block = page.locator('.context-menu .menu-signal');
        await expect(block).toContainText('1 conflict · 1 hypothesis');
        await expect(block).toContainText('What the research knows ›');
        await block.click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        // "What the marks mean" opens the help at the marks (in the app, no mark of a new window).
        await page.keyboard.press('Escape');
        await card(page, 'Jan').locator('.name').click();
        await page.locator('.context-menu [data-action="marks-help"]').click();
        await expect(page.locator('.help-rule[data-rule="R3.8"]')).toHaveClass(/is-target/);
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
        await expect(card(page, 'Jan').locator(':scope > .card-status-mark')).toBeHidden();
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toBeHidden();
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeVisible();
    });

    test('printing the page: no status mark, fold or badge', async ({ page }) => {
        await setup(page);
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toBeVisible();
        await page.emulateMedia({ media: 'print' });
        for (const sel of [':scope > .card-status-mark', ':scope > .card-story', '.card-signal']) {
            await expect(card(page, 'Jan').locator(sel)).toBeHidden();
        }
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
        await expect(pill.locator('.evidence-pill-level')).toHaveText(['● 1', '◐ 0', '○ 3']);
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

    test('phone: the person menu leads with the marks explained and the signal', async ({ page }) => {
        await setup(page, 360);
        await card(page, 'Jan').locator('.name').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet.locator('.menu-person-state .mps-status')).toHaveText('Backed by sources · 1 source');
        await expect(sheet.locator('.menu-person-state .mps-story')).toHaveText('story (draft)');
        await expect(sheet.locator('.menu-person-state .menu-signal')).toContainText('1 conflict');
    });

    test('touch: a tap on the card opens the menu with the marks explained; its links take a finger (spec 066 P4 §5, §9)', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' });
        const page = await context.newPage();
        await openApp(page);
        await dropFile(page, researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        await card(page, 'Jan').locator('.name').tap();
        const block = page.locator('.bottom-sheet-person .menu-person-state');
        await expect(block.locator('.mps-status .card-status-mark')).toHaveCount(1);
        const help = block.locator('[data-action="marks-help"]');
        await expect(help).toHaveText('What the marks mean');
        expect((await help.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // Nothing of the sheet runs off the phone's width.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
