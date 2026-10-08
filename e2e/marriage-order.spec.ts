import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Marriage order (T13): a man with three wives — data order 1908, undated,
 * 1866 — in the expanded view. Each wife's card carries a pill on its top
 * edge at the corner pointing to him ("1st ∞ 1866", "2nd ∞ 1908", "3rd ∞"),
 * he has none, a couple of one marriage has none; the wives on one side
 * stand in the order of the marriages. Below 60 % zoom the pill hides; the
 * image export draws it whole, measured as the screen draws it; a mouse shows
 * its bubble, which names whose marriage it is. A union has one pill (a widow
 * who married a widower), and the pill never covers a hidden-relatives tab,
 * a neighbouring card, the middle of the top edge or a line at any density
 * (N18). Invented data.
 */

async function setup(page: Page, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.evaluate(async () => {
        const p = (id: string, extra: Record<string, unknown>) => ({
            id, gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
        });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                j: p('j', { firstName: 'Josef', lastName: 'Víšek', gender: 'male', birthDate: '1841',
                    partnerships: ['u2', 'u3', 'u1'], childIds: ['k', 'h', 'r'] }),
                a: p('a', { firstName: 'Anna', lastName: 'Králová', birthDate: '1845', partnerships: ['u1'], childIds: ['k'] }),
                m: p('m', { firstName: 'Marie', lastName: 'Nováková', birthDate: '1870', partnerships: ['u2'], childIds: ['h'] }),
                e: p('e', { firstName: 'Eva', lastName: 'Malá', birthDate: '1850', partnerships: ['u3'], childIds: ['r'] }),
                k: p('k', { firstName: 'Karel', lastName: 'Víšek', gender: 'male', birthDate: '1867',
                    partnerships: ['u4'], parentIds: ['j', 'a'] }),
                l: p('l', { firstName: 'Ludmila', lastName: 'Víšková', birthDate: '1870', partnerships: ['u4'] }),
                h: p('h', { firstName: 'Hana', lastName: 'Víšková', birthDate: '1909', parentIds: ['j', 'm'] }),
                r: p('r', { firstName: 'Rudolf', lastName: 'Víšek', gender: 'male', birthDate: '1885', parentIds: ['j', 'e'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'j', person2Id: 'a', status: 'married', childIds: ['k'], startDate: '1866-02-14', startPlace: 'Dolní Lhota' },
                u2: { id: 'u2', person1Id: 'j', person2Id: 'm', status: 'married', childIds: ['h'], startDate: '1908', startPlace: 'Praha' },
                u3: { id: 'u3', person1Id: 'j', person2Id: 'e', status: 'married', childIds: ['r'] },
                u4: { id: 'u4', person1Id: 'k', person2Id: 'l', status: 'married', childIds: [], startDate: '1890' },
            },
        } as never, 'Víškovi');
        window.Strom.TreeRenderer.setFocus('j' as never);
    });
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(card(page, 'Eva')).toBeVisible();
}

const pill = (page: Page, name: string) => card(page, name).locator('.union-order-pill');

/** The pill's visible text: its number, glyph and year (the bubble left out). */
async function pillText(page: Page, name: string): Promise<string> {
    // the visible text only: a hidden ordinal suffix ("st") or year drops out
    return pill(page, name).evaluate(el => {
        const shown = (n: Node): string => n.nodeType === Node.TEXT_NODE ? n.textContent ?? ''
            : getComputedStyle(n as Element).display === 'none' ? '' : [...n.childNodes].map(shown).join('');
        return [...el.querySelectorAll('.uo-num, .uo-glyph, .uo-year')]
            .filter(s => getComputedStyle(s).display !== 'none').map(shown).join(' ');
    });
}

async function zoomTo(page: Page, scale: number, around = 'j'): Promise<void> {
    await page.evaluate(([s, id]) => window.Strom.ZoomPan.glideToPerson(id as never, s as number, 0), [scale, around] as const);
    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scale, 2);
}

test.describe('marriage-order pill (T13)', () => {
    test('each wife has her number and year at the corner pointing to her husband; he and a single marriage have none', { tag: '@smoke' }, async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        expect(await pillText(page, 'Anna')).toBe('1st ∞ 1866');
        expect(await pillText(page, 'Marie')).toBe('2nd ∞ 1908');
        // Undated: the number only, after the dated marriages.
        expect(await pillText(page, 'Eva')).toBe('3rd ∞');
        await expect(card(page, 'Josef').locator('.union-order-pill')).toHaveCount(0);
        await expect(card(page, 'Karel').locator('.union-order-pill')).toHaveCount(0);
        await expect(card(page, 'Ludmila').locator('.union-order-pill')).toHaveCount(0);
        await expect(page.locator('.union-order-pill')).toHaveCount(3);

        // The wives on his left in the order of the marriages, the earliest
        // next to him; the newest (primary) marriage on his right.
        const x = async (name: string) => (await card(page, name).boundingBox())!.x;
        const [ex, ax, jx, mx] = [await x('Eva'), await x('Anna'), await x('Josef'), await x('Marie')];
        expect(ex).toBeLessThan(ax);
        expect(ax).toBeLessThan(jx);
        expect(jx).toBeLessThan(mx);

        // On the top edge, half over the border, 12px from the corner toward Josef.
        for (const [name, side] of [['Anna', 'right'], ['Eva', 'right'], ['Marie', 'left']] as const) {
            const c = (await card(page, name).boundingBox())!;
            const b = (await pill(page, name).boundingBox())!;
            expect(Math.abs(b.y + b.height / 2 - c.y)).toBeLessThanOrEqual(1.5);
            expect(b.height).toBeCloseTo(18, 0);
            if (side === 'right') expect(Math.abs(c.x + c.width - (b.x + b.width) - 12)).toBeLessThanOrEqual(1.5);
            else expect(Math.abs(b.x - c.x - 12)).toBeLessThanOrEqual(1.5);
        }
    });

    test('a mouse shows the bubble naming whose marriage it is, with the year and place; the card\'s hover card stays away', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        const tip = pill(page, 'Anna').locator('.uo-tip');
        await expect(tip).toBeHidden();
        await pill(page, 'Anna').hover();
        await expect(tip).toBeVisible();
        await expect(tip).toHaveText("Josef Víšek's 1st marriage, 1866, Dolní Lhota");
        await expect(card(page, 'Anna').locator('.card-tooltip')).not.toBeVisible();
        await expect(pill(page, 'Marie')).toHaveAttribute('aria-label', "Josef Víšek's 2nd marriage, 1908, Praha");
        await expect(pill(page, 'Anna')).toHaveCSS('cursor', 'default');
    });

    test('whole from 60 % zoom, hidden below', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 0.6);
        expect(await pillText(page, 'Anna')).toBe('1st ∞ 1866');
        await expect(pill(page, 'Anna')).toBeVisible();
        await zoomTo(page, 0.59);
        await expect(pill(page, 'Anna')).toBeHidden();
        await expect(pill(page, 'Marie')).toBeHidden();
        await zoomTo(page, 1);
        await expect(pill(page, 'Anna')).toBeVisible();
        expect(await pillText(page, 'Marie')).toBe('2nd ∞ 1908');
    });

    test('the SVG export draws the pills whole, as wide as the screen draws them', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        const screenW: Record<string, number> = {};
        for (const [id, name] of [['a', 'Anna'], ['m', 'Marie'], ['e', 'Eva']]) {
            screenW[id] = await pill(page, name).evaluate(el => el.getBoundingClientRect().width);
        }
        await zoomTo(page, 0.3);   // the screen's zoom does not hide the export's pills
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.locator('#export-modal .menu-option', { hasText: 'Poster' }).click();
        const poster = page.locator('#poster-modal');
        await expect(poster).toBeVisible();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            poster.locator('.menu-option', { hasText: 'SVG' }).click(),
        ]);
        const svg = readFileSync(await download.path(), 'utf-8');
        const pills = [...svg.matchAll(/<g class="union-order-pill" data-union-order="(\d+)" data-person="([^"]+)"[^>]*>(.*?)<\/g>/g)];
        expect(pills.map(m => `${m[2]}:${m[1]}`).sort()).toEqual(['a:1', 'e:3', 'm:2']);
        const anna = pills.find(m => m[2] === 'a')![3];
        expect(anna).toContain('>1st</text>');
        expect(anna).toContain('>∞</text>');
        expect(anna).toContain('>1866</text>');
        expect(svg).not.toMatch(/drop-shadow|<filter/);
        // The pill's outer width (the hairline rect + its 1px stroke) is the screen's.
        for (const m of pills) {
            const w = Number(/<rect [^>]*width="([\d.]+)" height="17"/.exec(m[3])![1]) + 1;
            expect(Math.abs(w - screenW[m[2]]), `pill of ${m[2]}: SVG ${w} vs screen ${screenW[m[2]]}`).toBeLessThanOrEqual(0.5);
        }
    });

    test('a pill wider than its half of the compact card (a wide font) shows a shorter label, the bubble and the export say it all', async ({ page }) => {
        await widenPillFont(page);
        await setup(page);
        await page.evaluate(() => window.Strom.UI.setCardDensity('compact' as never));
        await zoomTo(page, 1);
        // "2nd ∞ 1908" does not fit in the 71px half of the 150px card: the year goes.
        for (const [name, text] of [['Anna', '1st ∞'], ['Marie', '2nd ∞']] as const) {
            await expect(pill(page, name)).toHaveAttribute('data-label', 'noYear');
            expect(await pillText(page, name)).toBe(text);
            const c = (await card(page, name).boundingBox())!;
            const b = (await pill(page, name).boundingBox())!;
            const mid = c.x + c.width / 2;
            expect(b.x + b.width <= mid - 2 || b.x >= mid + 2, `${name}: the middle of the top edge stays free`).toBe(true);
        }
        // "3rd ∞" (no date) fits whole.
        await expect(pill(page, 'Eva')).toHaveAttribute('data-label', 'full');
        expect(await pillText(page, 'Eva')).toBe('3rd ∞');
        // Widths on the screen (no card hovered: a hovered card grows 3 %).
        const screenW: Record<string, number> = {};
        for (const [id, name] of [['a', 'Anna'], ['m', 'Marie'], ['e', 'Eva']]) {
            screenW[id] = await pill(page, name).evaluate(el => el.getBoundingClientRect().width);
        }
        // The bubble and the accessible label keep the year and the place.
        await expect(pill(page, 'Marie')).toHaveAttribute('aria-label', "Josef Víšek's 2nd marriage, 1908, Praha");
        await pill(page, 'Marie').hover();
        await expect(pill(page, 'Marie').locator('.uo-tip')).toBeVisible();
        await expect(pill(page, 'Marie').locator('.uo-tip')).toHaveText("Josef Víšek's 2nd marriage, 1908, Praha");
        await page.mouse.move(0, 0);

        // The SVG export draws the same label, as wide as the screen.
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.locator('#export-modal .menu-option', { hasText: 'Poster' }).click();
        const poster = page.locator('#poster-modal');
        await expect(poster).toBeVisible();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            poster.locator('.menu-option', { hasText: 'SVG' }).click(),
        ]);
        const svg = readFileSync(await download.path(), 'utf-8');
        const pills = [...svg.matchAll(/<g class="union-order-pill" data-union-order="(\d+)" data-person="([^"]+)"([^>]*)>(.*?)<\/g>/g)];
        expect(pills.map(m => `${m[2]}:${m[1]}`).sort()).toEqual(['a:1', 'e:3', 'm:2']);
        const marie = pills.find(m => m[2] === 'm')!;
        expect(marie[3]).toContain('data-label="noYear"');
        expect(marie[4]).toContain('>2nd</text>');
        expect(marie[4]).toContain('>∞</text>');
        expect(marie[4]).not.toContain('1908');
        expect(pills.find(m => m[2] === 'a')![4]).not.toContain('1866');
        expect(pills.find(m => m[2] === 'e')![3]).not.toContain('data-label');
        for (const m of pills) {
            const w = Number(/<rect [^>]*width="([\d.]+)" height="17"/.exec(m[4])![1]) + 1;
            expect(Math.abs(w - screenW[m[2]]), `pill of ${m[2]}: SVG ${w} vs screen ${screenW[m[2]]}`).toBeLessThanOrEqual(0.5);
        }
    });

    test('a pill whose half holds only its number shows the ordinal alone; the bubble and the accessible label keep it all', async ({ page }) => {
        // Wider still: not even "2nd ∞" fits in the half of the compact card, "2nd" does.
        await widenPillFont(page, SPACING_ORDINAL);
        await setup(page);
        await page.evaluate(() => window.Strom.UI.setCardDensity('compact' as never));
        await zoomTo(page, 1);
        for (const [name, text, tip] of [['Anna', '1st', "Josef Víšek's 1st marriage, 1866, Dolní Lhota"], ['Marie', '2nd', "Josef Víšek's 2nd marriage, 1908, Praha"]] as const) {
            await expect(pill(page, name)).toHaveAttribute('data-label', 'ordinal');
            expect(await pillText(page, name)).toBe(text);
            await expect(pill(page, name).locator('.uo-glyph, .uo-year')).toHaveCount(0);
            const c = (await card(page, name).boundingBox())!;
            const b = (await pill(page, name).boundingBox())!;
            const mid = c.x + c.width / 2;
            expect(b.x + b.width <= mid - 2 || b.x >= mid + 2, `${name}: the middle of the top edge stays free`).toBe(true);
            // The bubble and the accessible label: the number, the year and the place.
            await expect(pill(page, name)).toHaveAttribute('aria-label', tip);
            await pill(page, name).hover();
            await expect(pill(page, name).locator('.uo-tip')).toBeVisible();
            await expect(pill(page, name).locator('.uo-tip')).toHaveText(tip);
            await page.mouse.move(0, 0);
        }
    });

    test('the descendants view shows the pills too', async ({ page }) => {
        await setup(page);
        await page.locator('#view-mode-descendants').click();
        await expect(page.locator('#descendants-badge')).toBeVisible();
        await expect(card(page, 'Anna').locator('.union-order-pill')).toHaveCount(1);
        await expect(page.locator('.union-order-pill')).toHaveCount(3);
    });

    test('on a phone (360px) nothing overflows the page; dark theme draws the pill on the dark surface', async ({ page }) => {
        await setup(page, 360, 740);
        await expect(page.locator('.union-order-pill')).toHaveCount(3);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        const colours = await pill(page, 'Anna').evaluate(el => {
            const cs = getComputedStyle(el);
            const probe = document.createElement('div');
            probe.style.background = 'var(--surface)';
            probe.style.color = 'var(--accent)';
            document.body.appendChild(probe);
            const want = getComputedStyle(probe);
            const out = {
                bg: cs.backgroundColor, surface: want.backgroundColor,
                glyph: getComputedStyle(el.querySelector('.uo-glyph')!).color, accent: want.color,
            };
            probe.remove();
            return out;
        });
        expect(colours.bg).toBe(colours.surface);
        expect(colours.glyph).toBe(colours.accent);
        expect(colours.bg).not.toBe('rgb(255, 253, 248)');
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));
    });

    test('a widow who married a widower: one pill for their marriage, counted for the focus, the bubble names her', async ({ page }) => {
        await loadTree(page, widowWidower(), 'Ludmila');
        await zoomTo(page, 1, 'Ludmila');
        // Karel carries Ludmila's 2nd marriage; she carries none (no "1st" of Karel's beside it).
        await expect(byId(page, 'Karel').locator('.union-order-pill')).toHaveCount(1);
        expect(await byId(page, 'Karel').locator('.union-order-pill').getAttribute('data-toward')).toBe('Ludmila');
        await expect(byId(page, 'Karel').locator('.union-order-pill')).toHaveAttribute('aria-label', "Ludmila Černá's 2nd marriage, 1885, Čáslav");
        await expect(byId(page, 'Ludmila').locator('.union-order-pill')).toHaveCount(0);
        // Each card at most one pill; each union one.
        const perCard = await page.evaluate(() => [...document.querySelectorAll('#tree-canvas .person-card')]
            .map(c => c.querySelectorAll('.union-order-pill').length));
        expect(Math.max(...perCard)).toBe(1);
        // In Czech the name comes first (no genitive needed).
        await page.evaluate(() => window.Strom.UI.setLanguage('cs' as never));
        await expect(byId(page, 'Karel').locator('.union-order-pill')).toHaveAttribute('aria-label', 'Ludmila Černá: 2. sňatek, 1885, Čáslav');
    });

    test('on the detailed card a pill on the edge keeps clear of the name', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.setCardDensity('detailed' as never));
        await zoomTo(page, 1);
        for (const name of ['Anna', 'Marie', 'Eva']) {
            const p = (await pill(page, name).boundingBox())!;
            const n = (await card(page, name).locator('.name').boundingBox())!;
            expect(n.y - (p.y + p.height), name).toBeGreaterThanOrEqual(2);
        }
    });
});

// ---------------------------------------------------------------------------
// N18: the pill and the hidden-relatives tabs at every density (a harness)
// ---------------------------------------------------------------------------

type Tree = { persons: Record<string, unknown>; partnerships: Record<string, unknown> };

function builder() {
    const persons: Record<string, { id: string; firstName: string; lastName: string; gender: string; birthDate?: string;
        isPlaceholder: boolean; partnerships: string[]; parentIds: string[]; childIds: string[] }> = {};
    const partnerships: Record<string, unknown> = {};
    const person = (id: string, first: string, last: string, gender: 'male' | 'female', birthDate?: string) => {
        persons[id] = { id, firstName: first, lastName: last, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
            ...(birthDate ? { birthDate } : {}) };
    };
    const union = (id: string, a: string, b: string, startDate: string, kids: string[] = [], startPlace?: string) => {
        partnerships[id] = { id, person1Id: a, person2Id: b, childIds: kids, status: 'married', startDate, ...(startPlace ? { startPlace } : {}) };
        persons[a].partnerships.push(id); persons[b].partnerships.push(id);
        for (const k of kids) { persons[k].parentIds.push(a, b); persons[a].childIds.push(k); persons[b].childIds.push(k); }
    };
    /** Parents and two siblings (the "parents" and "siblings" tabs while they are out of view). */
    const kin = (id: string) => {
        const last = persons[id].lastName;
        person(`${id}_f`, 'Otec', last, 'male', '1790'); person(`${id}_m`, 'Matka', last, 'female', '1795');
        person(`${id}_s1`, 'Sestra', last, 'female', '1815'); person(`${id}_s2`, 'Bratr', last, 'male', '1817');
        union(`${id}_pu`, `${id}_f`, `${id}_m`, '1812', [id, `${id}_s1`, `${id}_s2`]);
    };
    return { person, union, kin, tree: (): Tree => ({ persons, partnerships }) };
}

/** Barbora married twice; both husbands have parents and siblings in the data. */
function widow(): Tree {
    const t = builder();
    t.person('Barbora', 'Barbora', 'Hrubá', 'female', '1825');
    t.person('Ondrej', 'Ondřej Maxmilián', 'Hrubý-Kratochvíl', 'male', '1818');
    t.person('Pavel', 'Pavel', 'Novotný', 'male', '1820');
    t.kin('Barbora'); t.kin('Ondrej'); t.kin('Pavel');
    t.person('c1', 'Jan', 'Hrubý', 'male', '1846'); t.person('c2', 'Marie', 'Novotná', 'female', '1852');
    t.union('w2', 'Pavel', 'Barbora', '1850', ['c2']);
    t.union('w1', 'Ondrej', 'Barbora', '1845', ['c1'], 'Dolní Lhota');
    return t.tree();
}

/** Jiří married Anna, Berta and Cecílie, each of whom married once more. */
function chain(): Tree {
    const t = builder();
    t.person('Jiri', 'Jiří', 'Chrpan', 'male', '1850');
    t.kin('Jiri');
    for (const [w, wn, h, hn, d1, d2] of [['Anna', 'Anna Bělá', 'Daniel', 'Daniel Erben', '1872', '1879'],
        ['Berta', 'Berta Cihlová', 'Emil', 'Emil Fiala', '1876', '1884'], ['Cecilie', 'Cecílie Doubková', 'Frantisek', 'František Gregor', '1878', '1882']]) {
        const [wf, wl] = wn.split(' '); const [hf, hl] = hn.split(' ');
        t.person(w, wf, wl, 'female', '1852'); t.person(h, hf, hl, 'male', '1848');
        t.kin(w);
        t.person(`${w}_k1`, 'Syn', hl, 'male', String(+d1 + 1)); t.person(`${w}_k2`, 'Dcera', 'Chrpanová', 'female', String(+d2 + 1));
        t.union(`u_${w}_J`, 'Jiri', w, d2, [`${w}_k2`]);
        t.union(`u_${w}_${h}`, h, w, d1, [`${w}_k1`]);
    }
    return t.tree();
}

/** Ludmila married Tomáš, then the widower Karel, who married Rozálie after her. */
function widowWidower(): Tree {
    const t = builder();
    t.person('Ludmila', 'Ludmila', 'Černá', 'female', '1860'); t.person('Tomas', 'Tomáš', 'Bílý', 'male', '1855');
    t.person('Karel', 'Karel', 'Dušek', 'male', '1852'); t.person('Rozalie', 'Rozálie', 'Malá', 'female', '1865');
    t.kin('Ludmila'); t.kin('Karel');
    t.person('k1', 'Josef', 'Bílý', 'male', '1881'); t.person('k2', 'Anna', 'Dušková', 'female', '1886');
    t.person('k3', 'Václav', 'Dušek', 'male', '1895');
    t.union('l1', 'Tomas', 'Ludmila', '1880', ['k1']);
    t.union('lk', 'Karel', 'Ludmila', '1885', ['k2'], 'Čáslav');
    t.union('kr', 'Karel', 'Rozalie', '1894', ['k3']);
    return t.tree();
}

const byId = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);

async function loadTree(page: Page, tree: Tree, focus: string, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.evaluate(async ([t, f]) => {
        await window.Strom.DataManager.importAsNewTree(t as never, 'T13');
        window.Strom.TreeRenderer.setFocus(f as never);
    }, [tree, focus] as const);
    await expect(byId(page, focus)).toBeVisible();
}

/**
 * Every pill of the view against the tabs, the cards and the lines, in
 * screen pixels: no pill covers a hidden-relatives tab or another card,
 * leaves its own card's width, covers the middle of its card's top edge or
 * has a line running under it.
 */
async function pillCollisions(page: Page): Promise<{ pills: number; above: number; besideTabs: number; errors: string[] }> {
    return page.evaluate(() => {
        type R = { left: number; top: number; right: number; bottom: number };
        const hit = (a: R, b: R, m = 0.5) => a.left < b.right - m && b.left < a.right - m && a.top < b.bottom - m && b.top < a.bottom - m;
        const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0.5 && getComputedStyle(el).visibility !== 'hidden'; };
        const cards = [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')];
        const tabs = [...document.querySelectorAll('#tree-canvas .branch-tab')].filter(visible).map(t => t.getBoundingClientRect());
        const svg = document.querySelector<SVGSVGElement>('#tree-lines')!;
        const ctm = svg.getScreenCTM()!;
        const pt = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(ctm);
        const lines = [...svg.querySelectorAll('line')].map(l => {
            const a = pt(+l.getAttribute('x1')!, +l.getAttribute('y1')!), b = pt(+l.getAttribute('x2')!, +l.getAttribute('y2')!);
            return { cls: l.getAttribute('class') ?? '', r: { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) } };
        }).filter(l => !/gen-guide|gen-band|debug/.test(l.cls));
        const errors: string[] = [];
        let pills = 0, above = 0, besideTabs = 0;
        for (const c of cards) {
            const cr = c.getBoundingClientRect();
            for (const p of c.querySelectorAll('.union-order-pill')) {
                if (!visible(p)) continue;
                pills++;
                const r = p.getBoundingClientRect();
                const tag = `pill of ${c.dataset.id} (${p.parentElement!.className.replace('card-edge ', '')})`;
                if (p.parentElement!.classList.contains('edge-top-above')) above++;
                if (p.parentElement!.classList.contains('edge-top-right') && c.querySelector('.branch-tab')) besideTabs++;
                if (r.left < cr.left - 0.5 || r.right > cr.right + 0.5) errors.push(`${tag}: leaves its card's width`);
                const mid = (cr.left + cr.right) / 2;
                if (r.left < mid + 2 && r.right > mid - 2) errors.push(`${tag}: covers the middle of the top edge`);
                for (const t of tabs) if (hit(r, t)) errors.push(`${tag}: covers a tab`);
                for (const o of cards) if (o !== c && hit(r, o.getBoundingClientRect())) errors.push(`${tag}: reaches the card of ${o.dataset.id}`);
                for (const q of c.querySelectorAll('.union-order-pill')) if (q !== p) errors.push(`${tag}: a second pill on the card`);
                for (const l of lines) {
                    // a line (1.5px stroke) through the pill's inside
                    const s = { left: l.r.left - 0.75, right: l.r.right + 0.75, top: l.r.top - 0.75, bottom: l.r.bottom + 0.75 };
                    if (hit(r, s, 1)) errors.push(`${tag}: a line (${l.cls}) runs under it`);
                }
            }
        }
        return { pills, above, besideTabs, errors };
    });
}

const HARNESS: Array<[string, () => Tree, string[]]> = [
    ['widow', widow, ['Barbora', 'Ondrej', 'Pavel', 'c1', 'Barbora_f']],
    ['chain', chain, ['Jiri', 'Anna', 'Berta', 'Cecilie', 'Daniel', 'Anna_k2', 'Jiri_f']],
    ['widow-widower', widowWidower, ['Ludmila', 'Karel', 'Tomas', 'Rozalie', 'k2']],
];

/**
 * A wider pill font, as Linux draws the pill (CI: "2nd ∞ 1908" wider than
 * the 71px half of the 150px compact card): every character of the pill's
 * parts 2px wider, on screen and in the screen's own measure alike.
 */
/** Letter spacing of the pill's parts at which only the ordinal fits in the half of the compact card. */
const SPACING_ORDINAL = 8;

async function widenPillFont(page: Page, spacing = 2): Promise<void> {
    await page.addInitScript((spacing) => {
        const add = () => {
            const s = document.createElement('style');
            s.textContent = `.union-order-pill .uo-num, .union-order-pill .uo-glyph, .union-order-pill .uo-year { letter-spacing: ${spacing}px; }`;
            document.documentElement.appendChild(s);
        };
        if (document.documentElement) add();
        else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); add(); } }).observe(document, { childList: true });
    }, spacing);
}

for (const density of ['compact', 'normal', 'detailed', 'custom', 'compact-wide'] as const) {
    test(`N18 harness (${density}): no pill covers a tab, a neighbouring card, the middle of the top edge or a line`, async ({ page }) => {
        test.setTimeout(120_000);
        let views = 0, pills = 0, above = 0, besideTabs = 0, shortened = 0;
        const errors: string[] = [];
        // A wide font (as on Linux): the whole pill no longer fits in its half of the compact card.
        const wide = density === 'compact-wide';
        if (wide) await widenPillFont(page);
        for (const [name, make, focuses] of HARNESS) {
            await loadTree(page, make(), focuses[0]);
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), wide ? 'compact' : density);
            for (const view of ['expanded', 'standard', 'descendants'] as const) {
                if (view === 'standard') await page.evaluate(() => window.Strom.TreeRenderer.toggleShowAllPartnerships());
                if (view === 'descendants') {
                    await page.evaluate(() => window.Strom.TreeRenderer.toggleShowAllPartnerships());
                    await page.locator('#view-mode-descendants').click();
                }
                for (const focus of focuses) {
                    await page.evaluate((f) => window.Strom.TreeRenderer.setFocus(f as never), focus);
                    await page.evaluate(() => document.fonts.ready);
                    await zoomTo(page, 1, focus);
                    const r = await pillCollisions(page);
                    views++; pills += r.pills; above += r.above; besideTabs += r.besideTabs;
                    shortened += await page.locator('#tree-canvas .union-order-pill:is([data-label="noYear"], [data-label="ordinal"])').count();
                    errors.push(...r.errors.map(e => `${name}/${view}/focus ${focus}: ${e}`));
                }
                if (view === 'descendants') await page.locator('#view-mode-family').click();
            }
        }
        console.log(`N18 harness ${density}: ${views} views, ${pills} pills (${above} above the tabs, ${besideTabs} beside tabs, ${shortened} shortened), ${errors.length} collisions`);
        expect(errors).toEqual([]);
        expect(pills).toBeGreaterThan(20);
        // compact and normal cards meet the case the fix is for: a pill above the tabs
        if (density === 'compact' || density === 'normal') expect(above).toBeGreaterThan(0);
        // the wide font meets the case of a whole pill wider than its half: a shorter label
        if (wide) expect(shortened).toBeGreaterThan(0);
    });
}


/**
 * A hovered card: the relations icon joins the right group left of its tabs.
 * Every pill on the edge keeps clear of it (N35): each card with a pill on its
 * top edge and tabs in its right corner hovered in turn.
 */
async function hoverCollisions(page: Page): Promise<{ hovered: number; errors: string[] }> {
    const ids = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')]
        .filter(c => c.querySelector(':scope > .card-edge:not(.edge-top-above) .union-order-pill') && c.querySelector('.edge-top-right .branch-tab')
            && c.querySelector('.rel-link-icon'))
        .map(c => c.dataset.id!));
    const errors: string[] = [];
    for (const id of ids) {
        const c = byId(page, id);
        await zoomTo(page, 1, id);
        const box = (await c.boundingBox())!;
        // Over the card's lower half: the icon shows, the pill and the tabs are not under the pointer.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
        await expect(c.locator('.rel-link-icon')).toBeVisible();
        const clash = await c.evaluate((el) => {
            const p = el.querySelector('.union-order-pill')!.getBoundingClientRect();
            const i = el.querySelector('.rel-link-icon')!.getBoundingClientRect();
            return Math.min(p.right, i.right) - Math.max(p.left, i.left);
        });
        if (clash > 0.5) errors.push(`pill of ${id} (card ${box.width.toFixed(0)}px): the relations icon covers ${clash.toFixed(1)}px of it`);
        await page.mouse.move(0, 0);
    }
    return { hovered: ids.length, errors };
}

/** Josef married Anna and then Marie; both wives' parents and siblings are out of view (two tabs each). */
function twoWives(): Tree {
    const t = builder();
    t.person('Josef', 'Josef', 'Víšek', 'male', '1841');
    t.person('Anna', 'Anna', 'Králová', 'female', '1845'); t.person('Marie', 'Marie', 'Nováková', 'female', '1850');
    t.kin('Anna'); t.kin('Marie');
    t.person('k1', 'Karel', 'Víšek', 'male', '1867'); t.person('k2', 'Hana', 'Víšková', 'female', '1879');
    t.union('u1', 'Josef', 'Anna', '1866', ['k1']);
    t.union('u2', 'Josef', 'Marie', '1878', ['k2']);
    return t.tree();
}

test('N35: on a hovered card the relations icon never covers the marriage-order pill, at every density and custom card width', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    let hovered = 0;
    await loadTree(page, twoWives(), 'Josef');
    for (const density of ['compact', 'normal', 'detailed', 'custom'] as const) {
        await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
        // The custom card is as wide as the view's longest name: a longer one, a narrow letter at a time,
        // walks the pill and the tabs past each other (the medium width's cap, 320px, ends it).
        const steps = density === 'custom' ? 45 : 1;
        for (let n = 0; n < steps; n++) {
            await page.evaluate((n) => {
                const dm = window.Strom.DataManager;
                dm.updatePerson('k1' as never, { lastName: 'Víšek' + 'i'.repeat(n) });
                window.Strom.TreeRenderer.setFocus('Josef' as never);
            }, n);
            await page.evaluate(() => document.fonts.ready);
            const r = await hoverCollisions(page);
            hovered += r.hovered;
            errors.push(...r.errors.map(e => `${density}/${n}: ${e}`));
        }
    }
    console.log(`N35: ${hovered} hovered cards with a pill on the edge and tabs, ${errors.length} collisions`);
    expect(errors).toEqual([]);
    expect(hovered).toBeGreaterThan(0);
});
