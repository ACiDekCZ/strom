import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, UUID, HEAD, BRIDGE } from './research-bridge.js';

/**
 * What the research knows grouped (spec 140 §1–§3): "Group: … ▾" beside the
 * kind chips, None as before, By research line (a band per line in the
 * research's order, a row in each line of its person, an ended line marked,
 * No line last, "outside the tree" on an island's person), In the tree and
 * outside it (no tag), the choice kept for the tree; the kind chips and the
 * search before the groups (a group of conflicts alone goes under
 * Hypotheses, a search unfolds a folded group and folds it again when
 * cleared, ↓ from the field reaches a row, not a band), the bulk head once
 * over the bands and the foot under them, a hypothesis in two groups one
 * choice; without lines no By line; a phone (a sheet, the first group open,
 * bands of 44 px); German with a long line's name without overflow at 1440,
 * 1024 and 390, light and dark. Invented people (the Hrotkovi of Olšinky,
 * the Pýchavkovi of Mlýnky).
 */

const FEATURES = ['hypothesis.decide.link', 'hypothesis.links', 'hypotheses.accept.link'];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'hypothesis', 'hypotheses'];
const T0 = new Date('2026-11-11T09:30:00Z');

const conflict = (tag: string, id: string, research: string, tree: string): string[] => [
    `1 ${tag}`, `2 DATE ${tree}`, `1 _STROM_CONFLICT ${id}`, `2 TYPE ${tag}`, '2 STAT open', '2 _STROM_TAKE Y',
    `2 VAL ${research}`, '3 SOUR @S0001@', '3 _STROM_SIDE research', `2 VAL ${tree}`, '3 _STROM_SIDE user',
];

const hypo = (id: string, title: string, prop: boolean): string[] => [
    `1 _STROM_HYPO ${id}`, `2 TITL ${title}`, '2 STAT open', '2 _PICK Y', ...(prop ? ['2 _PROP A', '3 DECI Matrika jmenuje otce.'] : []),
    '2 _VAR A', '3 TITL Syn Vendelína', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0001@',
    '2 _VAR B', '3 TITL Syn Kvida', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0004@',
];

const inLine = (...ids: string[]): string[] => ids.flatMap(id => [`1 _STROM_DIRECTION ${id}`, '2 TYPE line']);

/** A line's name of 62 characters (wrapped in a band, never cut short). */
const LONG_LINE = 'Pýchavkové z Mlýnků nad Olšinkou a jejich mlýny na horním toku';

interface GedOpts {
    /** Without the research's lines. */
    noLines?: boolean;
    /** A third line (LONG_LINE) of Kvirín's conflict alone, and Cyprián's and Dobromila's hypotheses without a line: ten rows, the search field. */
    more?: boolean;
}

/**
 * Two lines (the second ended): Jan in the first, Vendelín in both, Albín in
 * the second; Kvido in none; Rozálie of a family outside the tree.
 */
function ged(o: GedOpts = {}): string {
    const lineOf = (...ids: string[]): string[] => o.noLines ? [] : inLine(...ids);
    const person = (refn: string, name: string, sex: string, extra: string[] = []): string[] =>
        [`0 @${refn}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, `1 REFN ${refn}`, '2 TYPE strom-research', ...extra];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 11 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, `1 _STROM_LINKS ${LINKS.join(' ')}`, '1 CHAR UTF-8', '1 NOTE Hrotkovi',
        ...(o.noLines ? [] : [
            '1 _STROM_DIRECTIONS Y',
            '1 _STROM_DIRECTION G0001', '2 NAME Předci Jana Hrotka', '2 TYPE ancestors', '2 _FOCUS P0003', '2 STAT active',
            '1 _STROM_DIRECTION G0002', '2 NAME Albínova rodina', '2 TYPE descendants', '2 _FOCUS P0012', '2 STAT done',
            ...(o.more ? ['1 _STROM_DIRECTION G0003', `2 NAME ${LONG_LINE}`, '2 TYPE ancestors', '2 _FOCUS P0070', '2 STAT active'] : []),
        ]),
        ...person('P0003', 'Jan /Hrotek/', 'M', [
            ...lineOf('G0001'),
            ...conflict('BIRT', 'X0007', '1841', '1842'),
            ...hypo('H0022', 'Kdo byl otec Jana Hrotka?', true),
        ]),
        ...person('P0001', 'Vendelín /Hrotek/', 'M', [
            ...lineOf('G0001', 'G0002'),
            ...hypo('H0031', 'Odkud přišel Vendelín do Olšinek?', true),
        ]),
        ...person('P0004', 'Kvido /Šeřík/', 'M', [...hypo('H0040', 'Byl Kvido Šeřík mlynář?', true)]),
        ...person('P0012', 'Albín /Hrotek/', 'M', [
            ...lineOf('G0002'),
            ...conflict('DEAT', 'X0009', '1903', '1904'),
            ...hypo('H0050', 'Albín a mlýn v Olšinkách', false),
        ]),
        ...person('P0047', 'Rozálie /Šeříková/', 'F', [
            '1 _STROM_ISLAND 2', '2 _HYPO H0060', '3 _JOIN P0004', '2 _HELD 0',
            ...hypo('H0060', 'Otec je Kvido Šeřík', true),
        ]),
        ...(o.more ? [
            ...person('P0070', 'Kvirín /Pýchavka/', 'M', [...lineOf('G0003'), ...conflict('BIRT', 'X0011', '1812', '1813')]),
            ...person('P0071', 'Cyprián /Pýchavka/', 'M', [...hypo('H0070', 'Byl Cyprián Pýchavka mlynář v Mlýnkách?', false)]),
            ...person('P0072', 'Dobromila /Pýchavková/', 'F', [...hypo('H0071', 'Odkud přišla Dobromila Pýchavková?', true)]),
        ] : []),
        '0 @S0001@ SOUR', '1 TITL Matrika Olšinky', '1 REFN S0001',
        '0 TRLR',
    ].join('\n');
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-knows');
const heading = (page: Page) => ov(page).locator('[aria-controls="ov-sec-knows"]');
const groupBtn = (page: Page) => sec(page).locator('.research-overview__knows-group-btn');
const bands = (page: Page) => sec(page).locator('[data-band]');
const rows = (page: Page) => sec(page).locator('.research-overview__knows-row');

const field = (page: Page) => sec(page).locator('.research-overview__section-search-input');
const chips = (page: Page) => sec(page).locator('.research-overview__knows-kinds .research-overview__filter');
const box = (page: Page, id: string) => sec(page).locator(`.hp2-box[data-hypo="${id}"]`);
const bandTitles = (page: Page) => bands(page).locator('.research-overview__group-title');

/** The research tree followed live, the overview open, the section unfolded; `lang` before the overview opens. */
async function setup(page: Page, opts: GedOpts & { width?: number; lang?: string; dark?: boolean } = {}): Promise<void> {
    await page.clock.install({ time: T0 });
    const width = opts.width ?? 1440;
    await page.setViewportSize({ width, height: width < 641 ? 844 : 900 });
    if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, LINKS);
    const text = ged(opts);
    await fakeBridge(page, { features: FEATURES, treeGed: text, links: LINKS, waiting: [] });
    await openResearch(page, { ged: text });
    await poll(page);
    await page.route(`${BRIDGE}/events*`, () => new Promise<void>(() => { /* never answers */ }));
    await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
    await expect(page.locator('#live-panel')).toBeVisible();
    if (opts.lang) await page.evaluate(lang => window.Strom.UI.setLanguage(lang as never), opts.lang);
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(heading(page)).toBeVisible();
    if (await heading(page).getAttribute('aria-expanded') === 'false') await heading(page).click();
    await expect(heading(page)).toHaveAttribute('aria-expanded', 'true');
}

/** Group by `label` from the menu (`aria`: the button's word in the language shown). */
async function choose(page: Page, label: string, aria = 'Group'): Promise<void> {
    await groupBtn(page).click();
    await expect(groupBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.research-overview__knows-group-menu [role="menuitemradio"]').filter({ hasText: label }).click();
    await expect(groupBtn(page)).toHaveAttribute('aria-label', `${aria}, ${label}`);
}

/** What sticks out of the section's body or its bar (their scroll width over their width), and of the page. */
async function overflow(page: Page): Promise<{ body: number; bar: number; doc: number; wide: string[] }> {
    return sec(page).evaluate((s) => {
        const bar = s.querySelector<HTMLElement>('.research-overview__knows-bar')!;
        const right = s.getBoundingClientRect().right;
        const wide = [...s.querySelectorAll<HTMLElement>('*')].filter(e => e.getClientRects().length > 0 && e.getBoundingClientRect().right > right + 1)
            .map(e => e.className || e.tagName);
        return {
            body: s.scrollWidth - s.clientWidth, bar: bar.scrollWidth - bar.clientWidth,
            doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: wide.slice(0, 5),
        };
    });
}

/** The relative luminance contrast of an element's text against the overview's background. */
function contrastOf(page: Page, sel: string): Promise<number> {
    return page.evaluate((q) => {
        const lum = (c: string): number => {
            const [r, g, b] = c.match(/[\d.]+/g)!.map(Number).slice(0, 3).map(v => {
                const x = v / 255;
                return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const e = document.querySelector<HTMLElement>(`#research-overview ${q}`)!;
        const a = lum(getComputedStyle(e).color);
        const b = lum(getComputedStyle(document.getElementById('research-overview')!).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, sel);
}

test.describe('What the research knows grouped (spec 140)', () => {
    test('None as before; by line: the research\'s order, a row in both lines, the ended line, No line last, the island\'s tag; kept for the tree', async ({ page }) => {
        await setup(page);
        // None: the chips and Group in one bar, no band, no tag.
        await expect(sec(page).locator('.research-overview__knows-bar > .research-overview__knows-kinds')).toHaveCount(1);
        await expect(groupBtn(page)).toHaveText('Group:None▾');
        await expect(groupBtn(page)).not.toHaveClass(/is-set/);
        await expect(bands(page)).toHaveCount(0);
        await expect(rows(page)).toHaveCount(7);
        await expect(sec(page).locator('.rok-tag--island')).toHaveCount(0);

        await choose(page, 'By research line');
        await expect(groupBtn(page)).toHaveClass(/is-set/);
        await expect(groupBtn(page)).toBeFocused();
        await expect(bands(page).locator('.research-overview__group-title')).toHaveText([
            'Předci Jana Hrotka', 'Albínova rodina · ended', 'No line',
        ]);
        await expect(bands(page).locator('.research-overview__group-span')).toHaveText(['3', '3', '2']);
        await expect(bands(page).nth(1)).toHaveAttribute('aria-label', 'Albínova rodina, ended, 3 findings');
        await expect(bands(page).first()).not.toHaveAttribute('data-row', /.*/);
        // Vendelín's hypothesis in both of his lines; the conflicts first in each.
        await expect(sec(page).locator('.research-overview__knows.is-grouped')).toHaveCount(3);
        await expect(sec(page).locator('.research-overview__knows.is-grouped').first().locator('.research-overview__knows-row'))
            .toHaveText([/^Jan Hrotek · /, /H0022|Kdo byl otec/, /Odkud přišel/]);
        await expect(rows(page).filter({ hasText: 'Odkud přišel' })).toHaveCount(2);
        // Rozálie's row says outside the tree, first of its tags.
        const island = rows(page).filter({ hasText: 'Rozálie' });
        await expect(island.locator('.rok-tags > .rok-tag').first()).toHaveText('outside the tree');
        await expect(sec(page).locator('.rok-tag--island')).toHaveCount(1);
        // The bulk head once, over the first band.
        await expect(sec(page).locator('.hp2-head')).toHaveCount(1);

        // A band folds and unfolds.
        await bands(page).first().click();
        await expect(bands(page).first()).toHaveAttribute('aria-expanded', 'false');
        await expect(bands(page).first()).toBeFocused();
        await expect(sec(page).locator('.research-overview__knows.is-grouped')).toHaveCount(2);
        await bands(page).first().click();
        await expect(sec(page).locator('.research-overview__knows.is-grouped')).toHaveCount(3);

        // Kept for this tree.
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').knowsGroupByTree);
        expect(Object.values(stored ?? {})).toEqual(['line']);

        // In the tree and outside it: two bands, no tag.
        await choose(page, 'In the tree and outside it');
        await expect(bands(page).locator('.research-overview__group-title')).toHaveText(['In the tree', 'Outside the tree']);
        await expect(bands(page).locator('.research-overview__group-span')).toHaveText(['6', '1']);
        await expect(sec(page).locator('.rok-tag--island')).toHaveCount(0);

        // None again: the list as before.
        await choose(page, 'None');
        await expect(bands(page)).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__knows.is-grouped')).toHaveCount(0);
        await expect(rows(page)).toHaveCount(7);
    });

    test('the kind chips and the search before the groups: a group of conflicts alone goes under Hypotheses, a search unfolds a folded group and folds it again when cleared, ↓ reaches a row', async ({ page }) => {
        await setup(page, { more: true });
        await expect(field(page)).toBeVisible();
        await choose(page, 'By research line');
        await expect(bandTitles(page)).toHaveText(['Předci Jana Hrotka', 'Albínova rodina · ended', LONG_LINE, 'No line']);
        await expect(bands(page).locator('.research-overview__group-span')).toHaveText(['3', '3', '1', '4']);
        // A long line's name wraps in its band (the whole name on hover), nothing cut, no "more".
        await expect(bandTitles(page).nth(2)).toHaveAttribute('title', LONG_LINE);
        await expect(sec(page).locator('.research-overview__group-more:visible')).toHaveCount(0);

        // Hypotheses: Kvirín's line of a conflict alone goes, the counts follow.
        await chips(page).nth(2).click();
        await expect(bandTitles(page)).toHaveText(['Předci Jana Hrotka', 'Albínova rodina · ended', 'No line']);
        await expect(bands(page).locator('.research-overview__group-span')).toHaveText(['2', '2', '4']);
        await chips(page).nth(0).click();
        await expect(bands(page)).toHaveCount(4);

        // No line folded by hand; a search of a row in it unfolds it, clearing the search folds it again.
        const noLine = bands(page).filter({ hasText: 'No line' });
        await noLine.click();
        await expect(noLine).toHaveAttribute('aria-expanded', 'false');
        await field(page).fill('Cyprián');
        await expect(bandTitles(page)).toHaveText(['No line']);
        await expect(noLine).toHaveAttribute('aria-expanded', 'true');
        await expect(rows(page)).toHaveText([/^Cyprián Pýchavka · /]);
        await field(page).fill('');
        await expect(bands(page)).toHaveCount(4);
        await expect(noLine).toHaveAttribute('aria-expanded', 'false');

        // ↓ from the field: the first row of the first open group, never a band.
        await bands(page).first().click();
        await expect(bands(page).first()).toHaveAttribute('aria-expanded', 'false');
        await field(page).focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator(':focus')).toHaveClass(/research-overview__knows-row/);
        await expect(page.locator(':focus')).toHaveText(/^Albín Hrotek · /);
        // A redraw (a status of the research followed live comes at any moment) keeps the focus on that row.
        await page.evaluate(() => window.Strom.UI.renderResearchOverview());
        await expect(page.locator(':focus')).toHaveClass(/research-overview__knows-row/);
        await expect(page.locator(':focus')).toHaveText(/^Albín Hrotek · /);
    });

    test('bulk accepting grouped: the head once over the bands, the foot once under them, a hypothesis in two groups one choice', async ({ page }) => {
        await setup(page);
        await choose(page, 'By research line');
        const order = (): Promise<string[]> => sec(page).evaluate(s => [...s.children].flatMap(c =>
            c.classList.contains('hp2-head') ? ['head'] : c.classList.contains('hp2-foot') ? ['foot']
                : c.classList.contains('research-overview__knows-grouphead') ? ['band'] : c.classList.contains('is-grouped') ? ['rows'] : []));
        expect(await order()).toEqual(['head', 'band', 'rows', 'band', 'rows', 'band', 'rows']);
        // Vendelín's hypothesis in both his lines: one box ticked ticks the other.
        await expect(box(page, 'H0031')).toHaveCount(2);
        await box(page, 'H0031').last().check();
        await expect(box(page, 'H0031').first()).toBeChecked();
        await expect(box(page, 'H0031').last()).toBeChecked();
        await expect(box(page, 'H0031').last()).toBeFocused();
        // The foot once, under the last group.
        expect(await order()).toEqual(['head', 'band', 'rows', 'band', 'rows', 'band', 'rows', 'foot']);
        await expect(sec(page).locator('.hp2-foot .hp2-sum')).toContainText('1 selected.');
        await expect(sec(page).locator('.hp2-foot .hp2-accept')).toContainText('Accept proposal');
        await box(page, 'H0031').first().uncheck();
        await expect(box(page, 'H0031').last()).not.toBeChecked();
        // Verifying stays under it all, outside the groups (none here: nothing waits).
        await expect(sec(page).locator('.is-grouped .vfy-section--tree')).toHaveCount(0);
    });

    test('without lines By line is not offered; In the tree and outside it still is', async ({ page }) => {
        await setup(page, { noLines: true });
        await groupBtn(page).click();
        await expect(page.locator('.research-overview__knows-group-menu [role="menuitemradio"]')).toHaveText([/None$/, 'In the tree and outside it']);
        await page.locator('.research-overview__knows-group-menu [role="menuitemradio"]').filter({ hasText: 'In the tree' }).click();
        await expect(bandTitles(page)).toHaveText(['In the tree', 'Outside the tree']);
    });

    test.describe('a phone held by touch', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test('a phone: the choice in a sheet, only the first group open, bands of 44 px, nothing wider than the screen', async ({ page }) => {
            await setup(page, { width: 390 });
            // The button 32 px high, its touch area 6 px more above and under it.
            expect((await groupBtn(page).boundingBox())!.height).toBeCloseTo(32, 0);
            expect(await groupBtn(page).evaluate(b => getComputedStyle(b, '::before').top)).toBe('-6px');
            await groupBtn(page).click();
            const sheet = page.locator('.research-overview__knows-group-sheet');
            await expect(sheet.locator('[role="menuitemradio"]')).toHaveText(['None', 'By research line', 'In the tree and outside it'].map(t => new RegExp(t)));
            await expect(sheet.locator('[role="menuitemradio"]').first()).toHaveAttribute('aria-checked', 'true');
            await sheet.locator('[role="menuitemradio"]').filter({ hasText: 'By research line' }).click();
            await expect(sheet).toHaveCount(0);
            await expect(groupBtn(page)).toHaveAttribute('aria-label', 'Group, By research line');
            await expect(bands(page)).toHaveCount(3);
            await expect(bands(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
            await expect(bands(page).nth(1)).toHaveAttribute('aria-expanded', 'false');
            await expect(bands(page).nth(2)).toHaveAttribute('aria-expanded', 'false');
            await expect(sec(page).locator('.research-overview__knows.is-grouped')).toHaveCount(1);
            for (const h of await bands(page).evaluateAll(bs => bs.map(b => b.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
            const o = await overflow(page);
            expect(o.wide).toEqual([]);
            expect(o.body).toBeLessThanOrEqual(0);
            expect(o.bar).toBeLessThanOrEqual(0);
            expect(o.doc).toBeLessThanOrEqual(0);
        });
    });

    for (const [width, dark] of [[1440, false], [1024, true], [390, false], [390, true]] as const) {
        test(`German at ${width}${dark ? ', dark' : ''}: a long line's name and the bar without overflow, the tags legible`, async ({ page }) => {
            await setup(page, { more: true, width, lang: 'de', dark });
            if (width < 641) {
                await groupBtn(page).click();
                await page.locator('.research-overview__knows-group-sheet [role="menuitemradio"]').filter({ hasText: 'Nach Forschungslinie' }).click();
                await expect(groupBtn(page)).toHaveAttribute('aria-label', 'Gruppieren, Nach Forschungslinie');
                // Every group open (the long line's and Rozálie's tag in sight).
                for (const b of await bands(page).all()) if (await b.getAttribute('aria-expanded') === 'false') await b.click();
            } else {
                await choose(page, 'Nach Forschungslinie', 'Gruppieren');
            }
            await expect(bandTitles(page).nth(1)).toHaveText('Albínova rodina · beendet');
            await expect(bandTitles(page).nth(2)).toHaveText(LONG_LINE);
            await expect(sec(page).locator('.research-overview__knows.is-grouped')).toHaveCount(4);
            await expect(sec(page).locator('.rok-tag--island')).toHaveText('außerhalb des Baums');
            const o = await overflow(page);
            expect(o.wide).toEqual([]);
            expect(o.body).toBeLessThanOrEqual(0);
            expect(o.bar).toBeLessThanOrEqual(0);
            expect(o.doc).toBeLessThanOrEqual(0);
            // The muted words read on either background.
            expect(await contrastOf(page, '#ov-sec-knows .rok-tag--island')).toBeGreaterThanOrEqual(4.5);
            expect(await contrastOf(page, '#ov-sec-knows .research-overview__group-state')).toBeGreaterThanOrEqual(4.5);
            expect(await contrastOf(page, '#ov-sec-knows .research-overview__groups-btn-label')).toBeGreaterThanOrEqual(4.5);
        });
    }
});
