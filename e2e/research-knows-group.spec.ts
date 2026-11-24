import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, UUID, HEAD, BRIDGE } from './research-bridge.js';

/**
 * What the research knows grouped (spec 140 §1–§3): "Group: … ▾" beside the
 * kind chips, None as before, By research line (a band per line in the
 * research's order, a row in each line of its person, an ended line marked,
 * No line last, "outside the tree" on an island's person), In the tree and
 * outside it (no tag), the choice kept for the tree. Invented people (the
 * Hrotkovi of Olšinky).
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

/**
 * Two lines (the second ended): Jan in the first, Vendelín in both, Albín in
 * the second; Kvido in none; Rozálie of a family outside the tree.
 */
function ged(): string {
    const person = (refn: string, name: string, sex: string, extra: string[] = []): string[] =>
        [`0 @${refn}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, `1 REFN ${refn}`, '2 TYPE strom-research', ...extra];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 11 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, `1 _STROM_LINKS ${LINKS.join(' ')}`, '1 CHAR UTF-8', '1 NOTE Hrotkovi',
        '1 _STROM_DIRECTIONS Y',
        '1 _STROM_DIRECTION G0001', '2 NAME Předci Jana Hrotka', '2 TYPE ancestors', '2 _FOCUS P0003', '2 STAT active',
        '1 _STROM_DIRECTION G0002', '2 NAME Albínova rodina', '2 TYPE descendants', '2 _FOCUS P0012', '2 STAT done',
        ...person('P0003', 'Jan /Hrotek/', 'M', [
            ...inLine('G0001'),
            ...conflict('BIRT', 'X0007', '1841', '1842'),
            ...hypo('H0022', 'Kdo byl otec Jana Hrotka?', true),
        ]),
        ...person('P0001', 'Vendelín /Hrotek/', 'M', [
            ...inLine('G0001', 'G0002'),
            ...hypo('H0031', 'Odkud přišel Vendelín do Olšinek?', true),
        ]),
        ...person('P0004', 'Kvido /Šeřík/', 'M', [...hypo('H0040', 'Byl Kvido Šeřík mlynář?', true)]),
        ...person('P0012', 'Albín /Hrotek/', 'M', [
            ...inLine('G0002'),
            ...conflict('DEAT', 'X0009', '1903', '1904'),
            ...hypo('H0050', 'Albín a mlýn v Olšinkách', false),
        ]),
        ...person('P0047', 'Rozálie /Šeříková/', 'F', [
            '1 _STROM_ISLAND 2', '2 _HYPO H0060', '3 _JOIN P0004', '2 _HELD 0',
            ...hypo('H0060', 'Otec je Kvido Šeřík', true),
        ]),
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

async function setup(page: Page): Promise<void> {
    await page.clock.install({ time: T0 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, LINKS);
    const text = ged();
    await fakeBridge(page, { features: FEATURES, treeGed: text, links: LINKS, waiting: [] });
    await openResearch(page, { ged: text });
    await poll(page);
    await page.route(`${BRIDGE}/events*`, () => new Promise<void>(() => { /* never answers */ }));
    await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
    await expect(page.locator('#live-panel')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(heading(page)).toBeVisible();
    if (await heading(page).getAttribute('aria-expanded') === 'false') await heading(page).click();
    await expect(heading(page)).toHaveAttribute('aria-expanded', 'true');
}

async function choose(page: Page, label: string): Promise<void> {
    await groupBtn(page).click();
    await expect(groupBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.research-overview__knows-group-menu [role="menuitemradio"]').filter({ hasText: label }).click();
    await expect(groupBtn(page)).toHaveAttribute('aria-label', `Group, ${label}`);
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
});
