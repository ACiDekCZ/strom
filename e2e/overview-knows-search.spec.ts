import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, UUID, HEAD, BRIDGE, FakeBridge } from './research-bridge.js';

/**
 * What the research knows searched in the Research overview (spec 083 §2,
 * K2.1–K2.2): the field from ten rows, filtering at once, the kind chips
 * counting what was found (a kind with nothing found dashed), a year of a
 * conflict's value found as text, a person's or hypothesis's number in an
 * amber tag, "Select found with a proposal (n)" with its box (empty / – /
 * ✓ over the found ones), the picked ones outside the search said in the
 * foot with Deselect outside the search and every picked one in Accept
 * proposals (N), Verifying under it all even with nothing found, no field
 * under ten rows; the same without following, nothing asked of the bridge
 * while typing; 390 px. Invented people (the Hrotkovi of Olšinky).
 */

const FEATURES = ['waiting.groups', 'hypothesis.decide.link', 'hypothesis.links', 'hypotheses.accept.link', 'verify', 'verify.bulk'];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'hypothesis', 'hypotheses'];
const T0 = new Date('2026-11-11T09:30:00Z');

/** An open conflict of a fact: the research's value × the tree's. */
const conflict = (tag: string, id: string, research: string, tree: string): string[] => [
    `1 ${tag}`, `2 DATE ${tree}`, `1 _STROM_CONFLICT ${id}`, `2 TYPE ${tag}`, '2 STAT open', '2 _STROM_TAKE Y',
    `2 VAL ${research}`, '3 SOUR @S0001@', '3 _STROM_SIDE research', `2 VAL ${tree}`, '3 _STROM_SIDE user',
];

/** An open hypothesis whose two versions make a child of `on` (A: of P0001, B: of P0004); `prop`: the agent proposes A. */
const hypo = (id: string, title: string, on: string, prop: boolean): string[] => [
    `1 _STROM_HYPO ${id}`, `2 TITL ${title}`, '2 STAT open', '2 _PICK Y', ...(prop ? ['2 _PROP A', '3 DECI Matrika jmenuje otce.'] : []),
    '2 _VAR A', '3 TITL Syn Vendelína', '3 _LINK child', `4 _PERS @${on}@`, '4 _PAR @P0001@',
    '2 _VAR B', '3 TITL Syn Kvida', '3 _LINK child', `4 _PERS @${on}@`, '4 _PAR @P0004@',
];

/** Three conflicts and eight hypotheses (eleven rows); `small`: one conflict and four (five rows). */
function ged(small = false): string {
    const person = (refn: string, name: string, sex: string, extra: string[] = []): string[] =>
        [`0 @${refn}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, `1 REFN ${refn}`, '2 TYPE strom-research', ...extra];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 11 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, `1 _STROM_LINKS ${LINKS.join(' ')}`, '1 CHAR UTF-8', '1 NOTE Hrotkovi',
        ...person('P0003', 'Jan /Hrotek/', 'M', [
            ...conflict('BIRT', 'X0007', '1841', '1842'),
            ...hypo('H0022', 'Kdo byl otec Jana Hrotka?', 'P0003', true),
            ...hypo('H0023', 'Byl Jan Hrotek kovář?', 'P0003', false),
        ]),
        ...person('P0001', 'Vendelín /Hrotek/', 'M', small ? [] : [
            ...conflict('DEAT', 'X0008', '1890', '1891'),
            ...hypo('H0031', 'Odkud přišel Vendelín do Olšinek?', 'P0003', true),
        ]),
        ...person('P0004', 'Kvido /Šeřík/', 'M', small ? [] : [
            ...hypo('H0040', 'Byl Kvido Šeřík mlynář?', 'P0003', true),
            ...hypo('H0041', 'Kde se Kvido Šeřík oženil?', 'P0003', true),
        ]),
        ...person('P0012', 'Albín /Hrotek/', 'M', small ? [...hypo('H0050', 'Albín a mlýn v Olšinkách', 'P0003', true)] : [
            ...conflict('DEAT', 'X0009', '1903', '1904'),
            ...hypo('H0050', 'Albín a mlýn v Olšinkách', 'P0003', true),
            ...hypo('H0051', 'Albínova první žena', 'P0003', false),
        ]),
        ...person('P0047', 'Rozálie /Šeříková/', 'F', [...hypo('H0060', 'Otec je Kvido Šeřík', 'P0003', true)]),
        '0 @S0001@ SOUR', '1 TITL Matrika Olšinky', '1 REFN S0001',
        '0 TRLR',
    ].join('\n');
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-knows');
const heading = (page: Page) => ov(page).locator('[aria-controls="ov-sec-knows"]');
const field = (page: Page) => sec(page).locator('.research-overview__section-search-input');
const chips = (page: Page) => sec(page).locator('.research-overview__knows-kinds .research-overview__filter');
const status = (page: Page) => sec(page).locator('.research-overview__search-status');
const empty = (page: Page) => sec(page).locator('.research-overview__search-empty');
const rows = (page: Page) => sec(page).locator('.research-overview__knows-row');
const head = (page: Page) => sec(page).locator('.hp2-head .hp2-all');
const headBox = (page: Page) => head(page).locator('.hp2-all-box');
const foot = (page: Page) => sec(page).locator('.hp2-foot');
const box = (page: Page, id: string) => sec(page).locator(`.hp2-box[data-hypo="${id}"]`);
const verify = (page: Page) => sec(page).locator('.vfy-section--tree');

/** The bridge's requests besides its regular status asks and the events' stream. */
const asked = (b: FakeBridge) => (b.seen ?? []).filter(s => !/^GET \/(status|events)\b/.test(s));

/** The research tree; `follow`: followed live (the events' stream quiet), else viewed through its bridge. The overview open, the section unfolded. */
async function setup(page: Page, opts: { follow?: boolean; small?: boolean; width?: number } = {}): Promise<FakeBridge> {
    await page.clock.install({ time: T0 });
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.width && opts.width < 641 ? 844 : 900 });
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, LINKS);
    const text = ged(opts.small);
    const bridge = await fakeBridge(page, { features: FEATURES, treeGed: text, links: LINKS, waiting: [] });
    await openResearch(page, { ged: text });
    await poll(page);
    if (opts.follow !== false) {
        await page.route(`${BRIDGE}/events*`, () => new Promise<void>(() => { /* never answers */ }));
        await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
        await expect(page.locator('#live-panel')).toBeVisible();
    }
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(heading(page)).toBeVisible();
    if (await heading(page).getAttribute('aria-expanded') === 'false') await heading(page).click();
    await expect(heading(page)).toHaveAttribute('aria-expanded', 'true');
    return bridge;
}

test.describe('What the research knows searched in the overview', () => {
    test('typing filters at once: the field over the chips, chips with what was found and a dashed one, a year of a value, Found n of m', async ({ page }) => {
        await setup(page);
        await expect(field(page)).toBeVisible();
        await expect(field(page)).toHaveAttribute('placeholder', 'Search people, conflicts, hypotheses…');
        await expect(field(page)).toHaveAttribute('aria-label', 'Search What the research knows');
        // The order: field, chips, the conflicts, the head, the hypotheses.
        const order = await sec(page).evaluate(s => [...s.children].map(c => c.className.split(' ')[0]));
        expect(order.indexOf('research-overview__section-search')).toBeLessThan(order.indexOf('research-overview__filters'));
        await expect(chips(page)).toHaveText(['All 11', 'Conflicts 3', 'Hypotheses 8']);
        await expect(rows(page)).toHaveCount(11);
        await expect(head(page)).toHaveText('Select all with a proposal');
        await expect(status(page)).toBeHidden();

        await field(page).click();
        await page.keyboard.type('1841');
        // A conflict's value found as text; the hypotheses' kind with none dashed.
        await expect(status(page)).toHaveText('Found 1 of 11');
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toHaveText(/^Jan Hrotek · .*1841.*1842/);
        await expect(chips(page)).toHaveText(['All 1', 'Conflicts 1', 'Hypotheses 0']);
        await expect(chips(page).nth(2)).toHaveClass(/research-overview__filter--empty/);
        await expect(chips(page).nth(2)).toHaveCSS('border-top-style', 'dashed');
        await expect(field(page)).toBeFocused();
        // No hypotheses found: no head.
        await expect(sec(page).locator('.hp2-head')).toHaveCount(0);

        // Every word, any order; the folded "serikova" forgives its last letter.
        await field(page).fill('serikovy otec');
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText('Rozálie Šeříková · Hypothesis: Otec je Kvido Šeřík');
        await field(page).fill('hrotek');
        await expect(status(page)).toHaveText('Found 8 of 11');
        // A kind chosen: Found n of m counts within it.
        await chips(page).nth(1).click();
        await expect(status(page)).toHaveText('Found 3 of 3');
        await expect(rows(page)).toHaveCount(3);
    });

    test('a number: the amber P… before a conflict\'s name, H… and P… in a hypothesis\'s tags; H22 under Conflicts finds nothing there', async ({ page }) => {
        await setup(page);
        await field(page).fill('P1');
        // P1 = P0001: Vendelín's conflict and hypothesis.
        await expect(rows(page)).toHaveCount(2);
        const con = sec(page).locator('.research-overview__knows-row.is-conflict');
        await expect(con.locator('.research-overview__hit')).toHaveText('P0001');
        expect(await con.evaluate(b => (b.firstChild as HTMLElement).className)).toBe('research-overview__hit');
        const hyp = rows(page).filter({ hasText: 'Odkud přišel' });
        await expect(hyp.locator('.rok-tags .research-overview__hit')).toHaveText('P0001');
        await field(page).fill('H22');
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).locator('.rok-tags .research-overview__hit').first()).toHaveText('H0022');
        // Text alone is never marked.
        await field(page).fill('hrotek');
        await expect(sec(page).locator('.research-overview__hit')).toHaveCount(0);

        // Under Conflicts: nothing, with Search all kinds and Clear search; the Hypotheses chip says 1.
        await field(page).fill('H22');
        await chips(page).nth(1).click();
        await expect(empty(page)).toContainText('Nothing found in Conflicts.');
        await expect(chips(page)).toHaveText(['All 1', 'Conflicts 0', 'Hypotheses 1']);
        await empty(page).getByRole('button', { name: 'Search all kinds' }).click();
        await expect(chips(page).nth(0)).toHaveAttribute('aria-checked', 'true');
        await expect(field(page)).toHaveValue('H22');
        await expect(field(page)).toBeFocused();
        await expect(rows(page)).toHaveCount(1);
    });

    test('bulk accepting: Select found with a proposal (n) with its box, the picked ones outside said in the foot, every one in the button', async ({ page }) => {
        await setup(page);
        // Two picked by hand before searching.
        await box(page, 'H0050').check();
        await box(page, 'H0060').check();
        await expect(headBox(page)).toHaveAttribute('aria-checked', 'mixed');
        expect(await headBox(page).evaluate(b => (b as HTMLInputElement).indeterminate)).toBe(true);
        await field(page).fill('kvido');
        // Found: H0040, H0041 (Kvido Šeřík) and H0060 (Otec je Kvido Šeřík), all with a proposal; H0060 picked.
        await expect(head(page)).toHaveText('Select found with a proposal (3)');
        await expect(head(page)).toHaveCSS('font-weight', '600');
        await expect(headBox(page)).toHaveAttribute('aria-checked', 'mixed');
        await expect(foot(page).locator('.hp2-sum')).toContainText('2 selected, 1 outside the search.');
        await expect(foot(page).locator('.hp2-accept')).toContainText('Accept proposals (2)');
        await head(page).click();
        await expect(headBox(page)).toBeChecked();
        await expect(headBox(page)).toHaveAttribute('aria-checked', 'true');
        await expect(foot(page).locator('.hp2-sum')).toContainText('4 selected, 1 outside the search.');
        await expect(foot(page).locator('.hp2-accept')).toContainText('Accept proposals (4)');
        // The box ✓: a click drops the found ones only.
        await headBox(page).click();
        await expect(headBox(page)).toHaveAttribute('aria-checked', 'false');
        await expect(foot(page).locator('.hp2-sum')).toContainText('1 selected, 1 outside the search.');
        await head(page).click();

        // Nothing found: the foot stays while something is picked; Verifying under it all.
        await field(page).fill('zzzz');
        await expect(empty(page)).toContainText('Nothing found.');
        await expect(rows(page)).toHaveCount(0);
        await expect(foot(page).locator('.hp2-sum')).toContainText('4 selected, 4 outside the search.');
        await field(page).fill('kvido');
        await foot(page).getByRole('button', { name: 'Deselect outside the search' }).click();
        await expect(foot(page).locator('.hp2-sum')).toHaveText('3 selected.');
        await expect(foot(page).locator('.hp2-accept')).toContainText('Accept proposals (3)');
        await expect(box(page, 'H0050')).toHaveCount(0);
        await field(page).fill('');
        await expect(box(page, 'H0050')).not.toBeChecked();
        await expect(head(page)).toHaveText('Select all with a proposal');
    });

    test('nothing found: Clear search; Verifying stays under the section, unchanged', async ({ page }) => {
        await setup(page);
        const last = () => sec(page).evaluate(s => (s.lastElementChild as HTMLElement).className);
        await expect(verify(page)).toBeVisible();
        const text = await verify(page).innerText();
        expect(await last()).toBe('vfy-section vfy-section--tree');
        await field(page).fill('qqqq');
        await expect(empty(page)).toContainText('Nothing found.');
        await expect(rows(page)).toHaveCount(0);
        await expect(verify(page)).toBeVisible();
        expect(await verify(page).innerText()).toBe(text);
        expect(await last()).toBe('vfy-section vfy-section--tree');
        await empty(page).getByRole('button', { name: 'Clear search' }).click();
        await expect(field(page)).toHaveValue('');
        await expect(rows(page)).toHaveCount(11);
    });

    test('under ten rows no field: the section as before', async ({ page }) => {
        await setup(page, { small: true });
        await expect(rows(page)).toHaveCount(5);
        await expect(field(page)).toHaveCount(0);
        await expect(chips(page)).toHaveText(['All 5', 'Conflicts 1', 'Hypotheses 4']);
        await expect(head(page)).toHaveText('Select all with a proposal');
    });

    test('folded with a text: the magnifier and the text in the heading; unfolded the same result', async ({ page }) => {
        await setup(page);
        await field(page).fill('hrotek');
        await heading(page).click();
        await expect(heading(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(ov(page).locator('.research-overview__section-sum--search').filter({ hasText: 'hrotek' })).toBeVisible();
        await heading(page).click();
        await expect(field(page)).toHaveValue('hrotek');
        await expect(status(page)).toHaveText('Found 8 of 11');
    });

    test('without following: searched the same, nothing asked of the bridge while typing', async ({ page }) => {
        const bridge = await setup(page, { follow: false });
        const before = asked(bridge).length;
        await field(page).click();
        await page.keyboard.type('serik');
        await expect(status(page)).toHaveText(/^Found \d+ of 11$/);
        await page.keyboard.press('Escape');
        await expect(field(page)).toHaveValue('');
        expect(asked(bridge).slice(before)).toEqual([]);
    });
});

/** Nothing of the section wider than the overview, nor the page wider than its window. */
async function noOverflow(page: Page): Promise<void> {
    const over = await ov(page).evaluate((root) => {
        const r = root.getBoundingClientRect();
        return [...root.querySelectorAll<HTMLElement>('#ov-sec-knows *')].filter(e => {
            const b = e.getBoundingClientRect();
            return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5);
        }).map(e => e.className);
    });
    expect(over).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('German at 400 px: the longest head and the foot with the picked ones outside fit', async ({ page }) => {
    await setup(page, { width: 400 });
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    if (await heading(page).getAttribute('aria-expanded') === 'false') await heading(page).click();
    await box(page, 'H0050').check();
    await field(page).fill('kvido');
    await expect(head(page)).toHaveText('Gefundene mit Vorschlag auswählen (3)');
    await expect(foot(page).locator('.hp2-sum')).toContainText('1 ausgewählt, davon 1 außerhalb der Suche.');
    await expect(foot(page).getByRole('button', { name: 'Auswahl außerhalb der Suche aufheben' })).toBeVisible();
    await noOverflow(page);
});

test.describe('What the research knows searched on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('390 px: the field 44 px with 16 px text, the chips 32 px, nothing wider than the sheet while searching', async ({ page }) => {
        await setup(page, { width: 390 });
        await field(page).fill('hrotek');
        await expect(status(page)).toHaveText('Found 8 of 11');
        await expect(ov(page)).toHaveClass(/research-overview--sheet/);
        expect(Math.round(await field(page).evaluate(i => i.closest('.research-overview__section-search')!.getBoundingClientRect().height))).toBe(44);
        await expect(field(page)).toHaveCSS('font-size', '16px');
        expect(Math.round((await chips(page).first().boundingBox())!.height)).toBe(32);
        await noOverflow(page);
        await field(page).fill('qqqq');
        await expect(empty(page)).toBeVisible();
        await noOverflow(page);
    });
});
