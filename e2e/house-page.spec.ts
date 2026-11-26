import { test, expect, Page, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fakeBridge, links, openResearch, poll, BRIDGE } from './research-bridge.js';

/**
 * The house page (spec 030 §3, K7.1): opened from the Houses window ("House page ›"), the research's
 * result drawn in it (the timeline with its origin tags, holders and residents, a renumbering to confirm),
 * "‹ Houses" back, Save HTML as one file without actions, the ⋯ menu with the name after the farm written
 * in place, a queued house and a tree without a research, and a phone at 390 px without overflow.
 * A fake bridge with invented data: the Fíšek family of Bělokamen čp. 16.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const FEATURES = ['house', 'house.material', 'house.request', 'house.confirm', 'house.import'];
const KEY = 'belokamen|16';

interface FakeHouses {
    confirms: Record<string, unknown>[];
}

function row(init: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'A0001', key: KEY, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16',
        persons: 2, years: { from: 1820, to: 1880 }, state: 'done', at: '2027-03-01T09:00:00Z',
        summary: { events: 3, holders: 2, residents: 1, unknown: 1, materials: 0, passed: 1 }, ...init,
    };
}

/** The research's whole result of čp. 16: built, a fire, an own research's line, a conjecture, holders, a resident. */
function result(): Record<string, unknown> {
    return {
        ...row(),
        numbers: [
            { id: 'n1', number: '16', from: '1836', sources: [{ source: 'S0001', page: 'fol. 41' }] },
            { id: 'n2', number: '9', to: '1835', proposed: true, sources: [] },
        ],
        timeline: [
            { id: 'e1', kind: 'built', date: '1830', text: 'Stavení postaveno po rozdělení gruntu', sources: [{ source: 'S0001' }] },
            { id: 'e2', kind: 'fire', date: '1868', text: 'Požár obce', sources: [] },
            { id: 'e3', kind: 'other', date: '1871', text: 'Nový krov podle pamětníků', origin: 'import', sources: [] },
            { id: 'e4', kind: 'other', date: '1810', text: 'Snad starší chalupa na místě', certainty: 'guess', sources: [] },
            { id: 'e5', kind: 'other', date: '1961', text: 'Přestavba stodoly na dílnu', sources: [] },
        ],
        holders: [
            { id: 'h1', name: 'Josef Fíšek', person: 'P0001', from: '1845', to: '1880', how: 'inheritance', sources: [{ source: 'S0001' }] },
            { id: 'h2', name: 'Kvido Stranný', from: '1884', to: '1902', how: 'purchase', sources: [] },
        ],
        residents: [
            { id: 'r1', name: 'Jan Fíšek', person: 'P0003', role: 'farmer', from: '1850', to: '1880', sources: [] },
            { id: 'r2', name: 'Marie Prouzalová', role: 'tenant', from: '1955', to: '1962', sources: [] },
        ],
        unknown: [{ id: 'u1', text: 'Kdo dům držel 1880–1884?', question: 'Q0001' }],
        passed: [{ id: 'p1', what: 'Indikační skica 1840', found: false, at: '2027-02-20' }],
        maps: [], manual: [], archiveOnly: [], sensitive: [], same: [], materials: [],
    };
}

async function setup(page: Page, opts: { state?: string; empty?: boolean; recent?: boolean } = {}): Promise<FakeHouses> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    const houses: FakeHouses = { confirms: [] };
    const listRow = row(opts.state ? { state: opts.state } : {});
    await fakeBridge(page, {
        features: FEATURES, links: LINKS,
        statusExtra: { houses: { on: false, rev: 'r1', counts: { done: 1, running: 0, queued: 0, waiting: 0, held: 0 } } },
    });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: 'r1', houses: [listRow] }) });
    });
    await page.route(u => `${u.origin}${u.pathname}`.startsWith(`${BRIDGE}/houses/`), async (route: Route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/houses\//, ''));
        if (route.request().method() === 'POST' && path === 'confirm') {
            houses.confirms.push(JSON.parse(route.request().postData() ?? 'null'));
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ house: result(), head: 'a1b2c3d4e5f6', parent: '9b8c7d6e5f40' }) });
            return;
        }
        const body = opts.empty
            ? { ...listRow, numbers: [], timeline: [], holders: [], residents: [], maps: [], passed: [], manual: [], unknown: [],
                archiveOnly: [], sensitive: [], same: [], materials: [], persons: [] }
            : result();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await openResearch(page);
    await placeFamily(page, opts.recent);
    await poll(page);
    return houses;
}

/** Josef (1820–1880) and his son Jan (1850) at Bělokamen čp. 16; with `recent` also Anna, born there in 1950. */
async function placeFamily(page: Page, recent = false): Promise<void> {
    await page.evaluate(recent => {
        const dm = window.Strom.DataManager;
        for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
            if (p.firstName === 'Josef') {
                dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820',
                    deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1880' } as never);
            }
            if (p.firstName === 'Jan') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850' } as never);
            if (recent && p.firstName === 'Anna') {
                dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1950' } as never);
            }
        }
    }, recent);
}

const pageWin = (page: Page) => page.locator('#house-page-modal');
const houseRow = (page: Page) => page.locator(`#houses-modal .house-row[data-house="${KEY}"]`);

async function openFromHouses(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showHousesWindow());
    await expect(houseRow(page)).toBeVisible();
    await houseRow(page).locator('.house-chev').click();
    const link = page.locator('#houses-modal .house-detail .house-page-link');
    await expect(link).toHaveText('House page ›');
    await link.click();
    await expect(pageWin(page).locator('#hp-title')).toHaveText('Bělokamen čp. 16');
    // The research's result arrives and the page draws it.
    await expect(pageWin(page).locator('#hp-sec-people')).toBeVisible();
}

test.describe('The house page', () => {
    test('opened from the Houses window: the research drawn with its tags, ‹ Houses back', async ({ page }) => {
        await setup(page);
        await openFromHouses(page);
        const win = pageWin(page);
        await expect(page.locator('#houses-modal')).not.toHaveClass(/active/);
        await expect(win.locator('.pp-kicker')).toHaveText('House');
        // The contents list only the sections there are (no map, no building).
        await expect(win.locator('.pp-toc-link')).toHaveText(['In brief', 'Numbers over time', 'Timeline', 'Holders and residents',
            'What is not known', 'What was searched', 'Sources and materials']);
        const tl = win.locator('#hp-sec-timeline');
        await expect(tl.locator('.hp-tl-r', { hasText: 'Stavení postaveno' }).locator('.hp-otag--res')).toHaveText('from research');
        await expect(tl.locator('.hp-tl-r', { hasText: 'Nový krov' }).locator('.hp-otag--own')).toHaveText('from own research');
        await expect(tl.locator('.hp-tl-r', { hasText: 'Snad starší' }).locator('.hp-otag')).toHaveText('conjecture');
        await expect(tl.locator('.hp-tl-r--tree', { hasText: 'Josef Fíšek' }).first().locator('.hp-otag--res')).toHaveCount(0);
        const people = win.locator('#hp-sec-people');
        await expect(people.locator('table')).toHaveCount(2);
        await expect(people).toContainText('Kvido Stranný · outside the tree');
        await expect(people).toContainText('A resident is not the same as an owner.');
        await expect(people.locator('td.hp-unk').first()).toHaveText('not known');
        // The research's state and its action in the facts.
        await expect(win.locator('.hp-state')).toBeVisible();
        // ‹ Houses: the window again, on the house.
        await win.locator('.hp-back').click();
        await expect(win).toHaveCount(0);
        await expect(page.locator('#houses-modal')).toHaveClass(/active/);
        await expect(houseRow(page)).toBeVisible();
    });

    test('Confirm of a renumbering goes over the bridge', async ({ page }) => {
        const houses = await setup(page);
        await openFromHouses(page);
        const prop = pageWin(page).locator('#hp-sec-numbers .hp-num--prop');
        await expect(prop).toContainText('čp. 9');
        await prop.locator('[data-hp-act="renumber"]').click();
        await expect.poll(() => houses.confirms).toEqual([{ house: KEY, what: 'renumber', id: 'n2' }]);
        expect(await links(page)).toEqual([]);
    });

    test('Save HTML: one self-contained file without the actions and the last ~100 years\' years', async ({ page }, testInfo) => {
        await setup(page, { recent: true });
        await openFromHouses(page);
        // The app shows everything: Anna's birth of 1950, the research's tenant and its event of 1961.
        const win = pageWin(page);
        await expect(win.locator('#hp-sec-timeline')).toContainText('Přestavba stodoly na dílnu');
        await expect(win.locator('#hp-sec-people')).toContainText('Marie Prouzalová');
        await expect(win).toContainText('1950');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            pageWin(page).locator('.pp-save').click(),
        ]);
        expect(download.suggestedFilename()).toBe('belokamen-cp-16.html');
        const file = testInfo.outputPath('house.html');
        await download.saveAs(file);
        const html = await readFile(file, 'utf8');
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('Stavení postaveno po rozdělení gruntu');
        expect(html).toContain('class="pp-toc"');
        expect(html).not.toContain('data-hp-act');
        expect(html).not.toContain('house-req');
        expect(html).not.toMatch(/<script[^>]+src=/);
        // The file: Anna without her years, the tenant the tree does not know and the event of 1961 left out.
        expect(html).toContain('Josef Fíšek');
        expect(html).toContain('1820');
        expect(html).not.toContain('1950');
        expect(html).not.toContain('Marie Prouzalová');
        expect(html).not.toContain('Přestavba stodoly');
        expect(html).not.toContain('1961');
        await expect(page.locator('.toast').filter({ hasText: 'Saved: belokamen-cp-16.html' })).toBeVisible();
    });

    test('the ⋯ menu: its items with the terminal mark, Escape back, the name after the farm in place', async ({ page }) => {
        await setup(page);
        await openFromHouses(page);
        const win = pageWin(page);
        const more = win.locator('.pp-more');
        await more.click();
        const menu = win.locator('.pp-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.pp-menu-item:visible')).toHaveText(['Open in the book…', 'House name…', 'Attach material…',
            /^Take over research from a file…/, 'Merge with another house…']);
        await expect(menu.locator('[data-hp-menu="import"] .research-open-mark')).toHaveCount(1);
        await expect(menu.locator('[data-hp-menu="import"] .research-ai-badge')).toHaveCount(0);
        await expect(menu.locator('.pp-menu-sep')).toHaveCount(2);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(more).toBeFocused();
        await expect(win).toBeVisible();
        // The name after the farm: written in the header, Enter keeps it.
        await more.click();
        await menu.locator('[data-hp-menu="name"]').click();
        const input = win.locator('.hp-name-input');
        await expect(input).toBeFocused();
        await input.fill('U Fíšků');
        await input.press('Enter');
        await expect(win.locator('.hp-name')).toHaveText('“U Fíšků”');
        await expect(win.locator('.pp-sub')).toHaveText('U Fíšků');
        expect(await page.evaluate(k => window.Strom.DataManager.getData().houses?.[k]?.name, KEY)).toBe('U Fíšků');
        // Escape closes the page, back to the Houses window.
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);
        await expect(page.locator('#houses-modal')).toHaveClass(/active/);
    });

    test('a queued house: the tree\'s residents and the queue\'s sentence', async ({ page }) => {
        await setup(page, { state: 'queued', empty: true });
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const win = pageWin(page);
        await expect(win.locator('#hp-sec-treeResidents')).toContainText('Josef Fíšek');
        await expect(win.locator('.hp-note')).toHaveText(/^The house history is in the research queue/);
        await expect(win.locator('#hp-sec-people')).toHaveCount(0);
    });

    test('a tree without a research: the page from the tree\'s records', async ({ page }) => {
        await openResearch(page, { bridge: false });
        await placeFamily(page);
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const win = pageWin(page);
        await expect(win.locator('#hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(win.locator('.hp-note')).toHaveText('This page is built from the records in the tree.');
        await expect(win.locator('#hp-sec-timeline')).toContainText('Jan Fíšek');
        await expect(win.locator('.hp-state')).toHaveCount(0);
    });
});

test.describe('The house page on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('390 px: the whole screen, nothing wider than it, Save in ⋯', async ({ page }) => {
        await setup(page);
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const win = pageWin(page);
        await expect(win.locator('#hp-sec-people')).toBeVisible();
        await expect(win.locator('.pp-mname')).toHaveText('Bělokamen čp. 16');
        await expect(win.locator('.pp-save')).toBeHidden();
        const sizes = await page.evaluate(() => {
            const body = document.querySelector('#house-page-modal .pp-body') as HTMLElement;
            const wide = [...body.querySelectorAll<HTMLElement>('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
                .map(el => el.className);
            return { doc: document.documentElement.scrollWidth, body: body.scrollWidth, client: body.clientWidth, wide };
        });
        expect(sizes.doc).toBeLessThanOrEqual(390);
        expect(sizes.body).toBeLessThanOrEqual(sizes.client);
        expect(sizes.wide).toEqual([]);
        await win.locator('.pp-more').click();
        await expect(win.locator('.pp-menu [data-hp-menu="save"]')).toBeVisible();
    });
});
