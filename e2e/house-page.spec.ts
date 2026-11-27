import { test, expect, Page, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fakeBridge, links, openResearch, poll, BRIDGE } from './research-bridge.js';
import { seedSetting } from './helpers.js';

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

interface FakeMap {
    location?: Record<string, unknown>;
    maps?: Record<string, unknown>[];
    layers?: Record<string, unknown>[];
}

async function setup(page: Page, opts: { state?: string; empty?: boolean; recent?: boolean; map?: FakeMap; features?: string[];
    extra?: Record<string, unknown> } = {}): Promise<FakeHouses> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    const houses: FakeHouses = { confirms: [] };
    const listRow = row(opts.state ? { state: opts.state } : {});
    const full = (): Record<string, unknown> => ({ ...result(), ...(opts.map?.location ? { location: opts.map.location } : {}),
        ...(opts.map?.maps ? { maps: opts.map.maps } : {}), ...opts.extra });
    await fakeBridge(page, {
        features: opts.features ?? FEATURES, links: LINKS,
        statusExtra: { houses: { on: false, rev: 'r1', counts: { done: 1, running: 0, queued: 0, waiting: 0, held: 0 },
            ...(opts.map?.layers ? { layers: opts.map.layers } : {}) } },
    });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: 'r1', houses: [listRow] }) });
    });
    await page.route(u => `${u.origin}${u.pathname}`.startsWith(`${BRIDGE}/houses/`), async (route: Route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/houses\//, ''));
        if (route.request().method() === 'POST' && path === 'confirm') {
            houses.confirms.push(JSON.parse(route.request().postData() ?? 'null'));
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ house: full(), head: 'a1b2c3d4e5f6', parent: '9b8c7d6e5f40' }) });
            return;
        }
        const body = opts.empty
            ? { ...listRow, numbers: [], timeline: [], holders: [], residents: [], maps: [], passed: [], manual: [], unknown: [],
                archiveOnly: [], sensitive: [], same: [], materials: [], persons: [] }
            : full();
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
/** Today's tiles and the research's layer answered here: nothing reaches a map server. */
async function stubMapServers(page: Page): Promise<string[]> {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const asked: string[] = [];
    await page.route(/^https:\/\/(tile\.openstreetmap\.org|ortho\.example\.org|aerial\.example\.org)\//, route => {
        asked.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    });
    await seedSetting(page, 'mapTiles', true);
    return asked;
}

const ORTHO_LAYER = {
    id: 'cz-ortho', kind: 'ortho', label: 'Ortofoto (dnes)', type: 'wms', url: 'https://ortho.example.org/wms', layers: '0',
    format: 'image/jpeg', attribution: '© Zeměměřický ústav Brodek', license: 'CC BY 4.0', bbox: [12, 48.5, 19, 51],
};
const AERIAL_LAYER = {
    id: 'cz-ortho-1950', kind: 'ortho-1950', label: 'Letecké snímky 50. let', type: 'wms', url: 'https://aerial.example.org/wms',
    layers: 'orto', format: 'image/jpeg', crs: 'EPSG:5514', attribution: 'Archiv leteckých snímků Brodek, 1953', license: 'CC BY 4.0',
    bbox: [12, 48.5, 19, 51],
};
const HOUSE_MAP: FakeMap = {
    location: { lat: 49.6118, lon: 15.2251, certainty: 'medium', how: 'old-map', confirmed: null, sources: [] },
    maps: [
        { id: 'm1', kind: 'cadastre', manual: true, sheet: 'list 2', url: 'https://archiv.example.org/skica/belokamen' },
        { id: 'm2', kind: 'ortho', layer: 'cz-ortho' },
    ],
    layers: [ORTHO_LAYER, AERIAL_LAYER],
};

const houseRow = (page: Page) => page.locator(`#houses-modal .house-row[data-house="${KEY}"]`);

async function openFromHouses(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showHousesWindow());
    await expect(houseRow(page)).toBeVisible();
    await houseRow(page).locator('.house-chev').click();
    const link = page.locator('#houses-modal .house-detail .house-page-link');
    await expect(link).toHaveText('House page ›');
    await link.click();
    await expect(pageWin(page).locator('#hp-title')).toHaveText('Bělokamen čp. 16');
    // The header's title (and its phone line) keeps the number to its marker: a non-breaking space (question 18).
    expect(await pageWin(page).locator('#hp-title, .pp-mname').evaluateAll(els => els.map(e => e.textContent))).toEqual(['Bělokamen čp.\u00a016', 'Bělokamen čp.\u00a016']);
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
        // A house done: "Request again…" above "Attach material…" (houseActionOf, as beside its state).
        await expect(menu.locator('.pp-menu-item:visible')).toHaveText(['Open in the book…', 'House name…', /^Request again…/, 'Attach material…',
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

    // spec 145 T2: with `house.chat` the agent's chat about the house, after the house's action, before Attach material…
    // (without it the item is missing: the test above).
    test('the ⋯ menu with house.chat: "Discuss with the agent" with AI and the terminal, its link do=chat', async ({ page }) => {
        await setup(page, { features: [...FEATURES, 'house.chat'] });
        await openFromHouses(page);
        const win = pageWin(page);
        await win.locator('.pp-more').click();
        const menu = win.locator('.pp-menu');
        await expect(menu.locator('.pp-menu-item:visible')).toHaveText(['Open in the book…', 'House name…', /^Request again…/,
            /^Discuss with the agent/, 'Attach material…', /^Take over research from a file…/, 'Merge with another house…']);
        const chat = menu.locator('[data-hp-menu="chat"]');
        await expect(chat.locator('.research-ai-badge')).toHaveCount(1);
        await expect(chat.locator('.research-open-mark')).toHaveCount(1);
        await chat.click();
        await expect(menu).toBeHidden();
        await expect.poll(() => links(page)).toHaveLength(1);
        expect((await links(page))[0]).toMatch(/^strom-research[a-z0-9-]*:\/\/house\?tree=[^&]+&house=belokamen%7C16&do=chat$/);
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

    test('the person page: the address and the row Houses open the house page', async ({ page }) => {
        await openResearch(page, { bridge: false });
        await placeFamily(page);
        const jan = await page.evaluate(() =>
            (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);
        await page.evaluate(id => window.Strom.UI.showPersonPage(id as never), jan);
        const person = page.locator('#person-page-modal');
        // The birth's address is a button to the house; the row Houses names it with Jan's year there.
        await expect(person.locator(`#pp-sec-timeline [data-pp-house="${KEY}"]`)).toHaveText('čp. 16');
        const row = person.locator('.pp-houses .pp-house');
        await expect(row).toHaveText('Bělokamen House čp. 16 › 1850');
        // The years stay together when a long town wraps the row on a phone ("1850–" / "1912" read apart).
        expect(await row.locator('.pp-house-y').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
        await row.locator(`[data-pp-house="${KEY}"]`).click();
        const win = pageWin(page);
        await expect(win.locator('#hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(win.locator('#hp-sec-timeline')).toContainText('Jan Fíšek');
    });

    test('the map: today with the point, the research\'s layer as tiles with its attribution, the maps to open by hand, Confirm location', async ({ page }) => {
        const asked = await stubMapServers(page);
        const houses = await setup(page, { map: HOUSE_MAP });
        await openFromHouses(page);
        const map = pageWin(page).locator('#hp-sec-map');
        await expect(map).toBeVisible();
        await expect(map.locator('.hmap-layer')).toHaveText(['Today', 'Orthophoto today', 'Aerial 1950s']);
        await expect(map.locator('.hmap-layer[aria-checked="true"]')).toHaveText('Today');
        await expect(map.locator('.hpt.main')).toHaveText('16');
        await expect(map.locator('.hmap-attr')).toContainText('OpenStreetMap');
        await expect(map.locator('.hmap-tiles img').first()).toHaveAttribute('data-tile-url', /tile\.openstreetmap\.org\/17\//);
        await expect(map.locator('.hmap-pos-t')).toHaveText('Location uncertain (the number may have changed)');
        const manual = map.locator('.hmap-man a');
        await expect(manual).toHaveText('Cadastral map, list 2 ↗');
        await expect(manual).toHaveAttribute('href', 'https://archiv.example.org/skica/belokamen');
        // The research's layer: WMS tiles in Web Mercator, its attribution whole with the licence.
        await map.locator('.hmap-layer', { hasText: 'Orthophoto today' }).click();
        await expect(map.locator('.hmap-layer[aria-checked="true"]')).toHaveText('Orthophoto today');
        await expect(map.locator('.hmap-attr')).toHaveText('© Zeměměřický ústav Brodek · CC BY 4.0');
        await expect(map.locator('.hmap-tiles img').first()).toHaveAttribute('src', /^https:\/\/ortho\.example\.org\/wms\?SERVICE=WMS&.*CRS=EPSG:3857&BBOX=/);
        await expect.poll(() => asked.some(u => u.startsWith('https://ortho.example.org/wms?'))).toBe(true);
        // Zoom: one step out asks for tiles of zoom 16.
        await map.locator('.hmap-zout').click();
        await expect(map.locator('.hmap-tiles img').first()).toHaveAttribute('src', /BBOX=/);
        // The aerial photos of the 1950s: one picture of the place in S-JTSK, the house in its middle.
        await map.locator('.hmap-layer', { hasText: 'Aerial 1950s' }).click();
        const img = map.locator('.hmap-img');
        await expect(img).toHaveAttribute('src', /^https:\/\/aerial\.example\.org\/wms\?SERVICE=WMS&.*CRS=EPSG:5514&BBOX=-\d+(\.\d+)?,-\d+/);
        await expect(img).toHaveAttribute('alt', 'Aerial photo of the 1950s around the house');
        await expect(map.locator('.hmap-tiles img')).toHaveCount(1);
        await expect(map.locator('.hmap-attr')).toHaveText('Archiv leteckých snímků Brodek, 1953 · CC BY 4.0');
        const frame = (await map.locator('.hmap').boundingBox())!;
        const pinBox = (await map.locator('.hpt').boundingBox())!;
        expect(Math.abs(pinBox.x + pinBox.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(2);
        expect(Math.abs(pinBox.y + pinBox.height / 2 - (frame.y + frame.height / 2))).toBeLessThan(2);
        // Moving the point goes on today's map.
        await map.locator('[data-hmap-act="move"]').click();
        await expect(map.locator('.hmap-layer[aria-checked="true"]')).toHaveText('Today');
        await map.locator('[data-hmap-act="cancel"]').click();
        // Confirm location: into the tree and to the research.
        await map.locator('[data-hmap-act="confirm"]').click();
        await expect(map.locator('.hmap-pos-t')).toHaveText('Location confirmed');
        await expect(map.locator('[data-hmap-act="confirm"]')).toHaveCount(0);
        await expect.poll(() => houses.confirms).toEqual([{ house: KEY, what: 'location' }]);
        const stored = await page.evaluate(() => Object.values((window.Strom.DataManager.getData() as { houses?: Record<string, { location?: unknown }> }).houses ?? {})
            .map(h => h.location).filter(Boolean));
        expect(stored).toEqual([{ lat: 49.6118, lng: 15.2251, how: 'confirmed' }]);
    });

    test('Move the point: dragged, Saved into the tree and to the research, Undo back; Cancel leaves it', async ({ page }) => {
        await stubMapServers(page);
        const houses = await setup(page, { map: HOUSE_MAP });
        await openFromHouses(page);
        const map = pageWin(page).locator('#hp-sec-map');
        const pin = map.locator('.hpt');
        await map.locator('[data-hmap-act="move"]').click();
        await expect(pin).toHaveClass(/drag/);
        await expect(map.locator('.hmap-move-hint')).toHaveText('The point can be dragged to the house.');
        // Cancel after a drag: nothing stored, the line as it was.
        let box = (await pin.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 10, { steps: 4 });
        await page.mouse.up();
        await map.locator('[data-hmap-act="cancel"]').click();
        await expect(pin).not.toHaveClass(/drag/);
        await expect(map.locator('.hmap-pos-t')).toHaveText('Location uncertain (the number may have changed)');
        const houseData = () => page.evaluate(() => Object.values((window.Strom.DataManager.getData() as { houses?: Record<string, { location?: { lat: number; lng: number; how: string } }> }).houses ?? {}).map(h => h.location).filter(Boolean));
        expect(await houseData()).toEqual([]);
        // Move, drag 40 px right and 20 px down (a touch's pointer events alike), Save.
        await map.locator('[data-hmap-act="move"]').click();
        box = (await pin.boundingBox())!;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await pin.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true, bubbles: true });
        await pin.dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: x + 40, clientY: y + 20, isPrimary: true, bubbles: true });
        await pin.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: x + 40, clientY: y + 20, isPrimary: true, bubbles: true });
        await map.locator('[data-hmap-act="save"]').click();
        await expect(map.locator('.hmap-pos-t')).toHaveText('Location set by hand');
        const [moved] = await houseData();
        expect(moved!.how).toBe('manual');
        // 40 px east and 20 px south at zoom 17: east and south of the research's point by a few tens of metres.
        expect(moved!.lng).toBeGreaterThan(15.2251 + 0.0002);
        expect(moved!.lat).toBeLessThan(49.6118 - 0.00005);
        await expect.poll(() => houses.confirms).toEqual([{ house: KEY, what: 'location', lat: moved!.lat, lon: moved!.lng }]);
        // Undo: the research's point again.
        await page.evaluate(() => window.Strom.DataManager.undo());
        await expect(map.locator('.hmap-pos-t')).toHaveText('Location uncertain (the number may have changed)');
        expect(await houseData()).toEqual([]);
    });
});

// 1127 (Milan: "the role wraps, it does not look nice"): Role / How and When keep their words whole and take their
// content's width, the name the rest; German's longest roles, long names, nothing wider than the page.
test.describe('The house page\'s tables', () => {
    const LONG = 'Maximilian Kunibert Fíšek-Stranný z Horního Bělokamene';
    const residents = ['farmer', 'retired', 'lodger', 'servant', 'tenant', 'other'].map((role, i) => ({
        id: `r${i}`, name: `${LONG} ${i + 1}`, role, from: String(1820 + i * 10), to: String(1850 + i * 10), sources: [] }));
    const holders = ['purchase', 'inheritance', 'marriage', 'auction', 'allotment', 'handover'].map((how, i) => ({
        id: `h${i}`, name: `${LONG} ${i + 1}`, how, from: String(1800 + i * 15), to: String(1815 + i * 15), sources: [] }));

    for (const width of [1440, 1024, 390]) {
        test(`${width} px, German: each role and each When on one line, the table no wider than the page`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await setup(page, { extra: { holders, residents } });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
            const win = pageWin(page);
            await expect(win.locator('#hp-sec-people td.hp-role').first()).toHaveText('Kauf');
            const r = await page.evaluate(() => {
                const lines = (td: Element): number => {
                    const range = document.createRange();
                    range.selectNodeContents(td);
                    return new Set([...range.getClientRects()].map(x => Math.round(x.top))).size;
                };
                const cells = [...document.querySelectorAll('#house-page-modal #hp-sec-people td.hp-role, #house-page-modal #hp-sec-people td.hp-y')];
                const body = document.querySelector('#house-page-modal .pp-body') as HTMLElement;
                const tables = [...document.querySelectorAll<HTMLElement>('#house-page-modal .hp-table')];
                return {
                    cells: cells.length,
                    wrapped: cells.filter(td => td.textContent && lines(td) !== 1).map(td => td.textContent),
                    tableWide: tables.filter(t => t.scrollWidth > t.parentElement!.clientWidth + 1).length,
                    body: body.scrollWidth <= body.clientWidth,
                    doc: document.documentElement.scrollWidth <= window.innerWidth,
                };
            });
            expect(r.cells).toBe(24);
            expect(r.wrapped).toEqual([]);
            expect(r.tableWide).toBe(0);
            expect(r.body).toBe(true);
            expect(r.doc).toBe(true);
        });
    }
});

// spec 145 T1: The building with the look of the house, the town's pictures and field names, the check of the look;
// a look not known says so once, with Attach material… and the step by hand.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const LOOK_FULL = {
    look: { text: 'Zděné přízemní stavení se dvěma okny do návsi, krytina pálená.', certainty: 'probable', origin: 'research',
        images: [{ url: 'https://pictures.example.org/dum16.png', license: 'CC BY 4.0', credit: 'Archiv Brodek' }] },
    lookCheck: { next: 'source', text: 'pozemková kniha popisuje stavení podrobněji', task: 'T0002', at: '2027-03-01', origin: 'research' },
    town: {
        id: 'A0002', place: { id: 'L0001', name: 'Bělokamen' }, passed: [], manual: [], archiveOnly: [], maps: [], unknown: [],
        pictures: [
            { id: 'i1', url: 'https://pictures.example.org/naves.png', license: 'CC BY-SA 4.0', credit: 'Jan Brodský', shows: 'Náves od kaple, 1912', origin: 'research' },
            { id: 'i2', url: 'https://pictures.example.org/hraz.png', license: 'CC0', shows: 'Hráz rybníka pod obcí', origin: 'research' },
        ],
        fieldNames: [
            { id: 'f1', name: 'Na Skále', kind: 'samota', origin: 'research' },
            { id: 'f2', name: 'Prouzalův mlýn', kind: 'mlýn', house: '16', url: 'https://maps.example.org/mlyn', origin: 'research' },
        ],
    },
};
const LOOK_NONE = {
    lookCheck: { next: 'none', text: 'žádný volný obrázek ani popis', at: '2027-03-01', origin: 'research' },
    unknown: [
        { id: 'u1', text: 'Kdo dům držel 1880–1884?', question: 'Q0001' },
        { id: 'u9', text: 'podoba: víc automaticky nejde – žádný volný obrázek ani popis', question: null, about: 'look' },
    ],
    manual: [{ id: 'o1', what: 'Indikační skica k. ú. Bělokamen, list 2', url: 'https://archiv.example.org/skica', why: 'stáhnout a přiložit k domu' }],
};

async function stubPictures(page: Page): Promise<void> {
    await page.route(/^https:\/\/pictures\.example\.org\//, route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
}

test.describe('The house page\'s building', () => {
    test('the full look: its text and picture, the town\'s pictures, the field names with this house first, still researched', async ({ page }) => {
        await stubPictures(page);
        await setup(page, { features: [...FEATURES, 'house.look'], extra: LOOK_FULL });
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const sec = pageWin(page).locator('#hp-sec-look');
        await expect(sec.locator('h2')).toHaveText('The building');
        await expect(sec.locator('.hp-look')).toContainText('Zděné přízemní stavení');
        await expect(sec.locator('.hp-look .hp-otag')).toHaveText('probable');
        await expect(sec.locator('.hp-h3')).toHaveText(['Pictures of the town', 'Field names']);
        // Each picture lazy, without a referrer; what it shows, its author and licence, a link out.
        await expect(sec.locator('img.hp-img')).toHaveCount(3);
        for (const img of await sec.locator('img.hp-img').all()) {
            await expect(img).toHaveAttribute('loading', 'lazy');
            await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
        }
        const naves = sec.locator('.hp-figs .hp-fig').first();
        await expect(naves.locator('.hp-fig-what')).toHaveText('Náves od kaple, 1912');
        await expect(naves.locator('.hp-fig-by')).toHaveText('Jan Brodský · CC BY-SA 4.0 · pictures.example.org ↗');
        await expect(naves.locator('a')).toHaveAttribute('target', '_blank');
        // The field names: the one at this house first and marked.
        await expect(sec.locator('.hp-fns .hp-fn')).toHaveText(['Prouzalův mlýn ↗', 'Na Skále']);
        await expect(sec.locator('.hp-fns .hp-fn--this')).toContainText('mlýn · at no. 16');
        await expect(sec.locator('.hp-look-more')).toHaveText('The look of the house is still being researched: pozemková kniha popisuje stavení podrobněji.');
        await expect(sec.locator('.house-attach')).toHaveCount(0);
        await expect(pageWin(page).locator('.pp-toc-link', { hasText: 'The building' })).toHaveCount(1);
    });

    test('not known: the one item once on the page, the step by hand, Attach material… opens its dialog', async ({ page }) => {
        await setup(page, { features: [...FEATURES, 'house.look'], extra: LOOK_NONE });
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const win = pageWin(page);
        const sec = win.locator('#hp-sec-look');
        await expect(sec.locator('.hp-look-unk')).toHaveText('podoba: víc automaticky nejde – žádný volný obrázek ani popis');
        await expect(win.getByText('podoba: víc automaticky nejde', { exact: false })).toHaveCount(1);
        await expect(win.locator('#hp-sec-unknown')).toContainText('Kdo dům držel 1880–1884?');
        await expect(win.locator('#hp-sec-unknown')).not.toContainText('podoba');
        await expect(sec.locator('.hp-look-hand a')).toHaveText('Indikační skica k. ú. Bělokamen, list 2 ↗');
        await expect(sec.locator('.hp-look-hand')).toContainText('stáhnout a přiložit k domu');
        await expect(sec.locator('img')).toHaveCount(0);
        await sec.locator('.house-attach').click();
        await expect(page.locator('#house-material-modal')).toBeVisible();
    });

    test('a researched house without its look: the sentence and Attach material… only with house.look', async ({ page }) => {
        await setup(page, { features: [...FEATURES, 'house.look'] });
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const sec = pageWin(page).locator('#hp-sec-look');
        await expect(sec.locator('.hp-look-unk')).toHaveText('What the house looked like is not known.');
        await expect(sec.locator('.house-attach')).toHaveText('Attach material…');
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

    test('390 px: the map on the whole width, 240 px high, the layer switch under it, nothing wider than the screen', async ({ page }) => {
        await stubMapServers(page);
        await setup(page, { map: HOUSE_MAP });
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const map = pageWin(page).locator('#hp-sec-map');
        await expect(map.locator('.hmap')).toBeVisible();
        const box = (await map.locator('.hmap').boundingBox())!;
        expect(Math.round(box.height)).toBe(240);
        expect(Math.round(box.x)).toBe(0);
        expect(Math.round(box.width)).toBe(390);
        const seg = (await map.locator('.hmap-layers').boundingBox())!;
        expect(seg.y).toBeGreaterThan(box.y + box.height - 1);
        const sizes = await page.evaluate(() => {
            const body = document.querySelector('#house-page-modal .pp-body') as HTMLElement;
            return { doc: document.documentElement.scrollWidth, body: body.scrollWidth, client: body.clientWidth };
        });
        expect(sizes.doc).toBeLessThanOrEqual(390);
        expect(sizes.body).toBeLessThanOrEqual(sizes.client);
    });
});

test.describe('The house page in the family pages (spec 145 T6)', () => {
    test('the window and the saved file carry the research\'s result: holders linked to their pages, nothing of the last ~100 years', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.openFamilyPages());
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await win.locator('.sp-fbar-nav [data-sp-open]').first().click();
        await win.locator('[data-sp-open="page:rejstrik-domy"]:visible').first().click();
        await win.locator('.pp-body [data-sp-open^="page:dum-"]').first().click();
        const house = win.locator('.pp-body article.hp');
        // The research's holders arrive over the bridge: Josef leads to his page, the stranger is text.
        await expect(house.locator('.hp-table button[data-sp-open^="person:"]', { hasText: 'Josef Fíšek' })).toBeVisible();
        await expect(house.locator('.hp-table tr', { hasText: 'Kvido Stranný' })).toBeVisible();
        await expect(house.locator('.hp-table tr', { hasText: 'Kvido Stranný' }).locator('[data-sp-open]')).toHaveCount(0);
        await expect(house).not.toContainText('Přestavba stodoly');
        await expect(house).not.toContainText('Marie Prouzalová');
        await win.locator('.pp-close, .close-btn').first().click();

        // The saved file: the same result through the same filter.
        await page.evaluate(() => window.Strom.UI.showBookDialog('pages'));
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res.locator('.fp-res-t')).toHaveText('The file is ready');
        const [download] = await Promise.all([page.waitForEvent('download'), res.locator('.fp-res-save').click()]);
        const html = await readFile((await download.path())!, 'utf8');
        const at = html.indexOf('<article class="pp hp"');
        expect(at).toBeGreaterThan(0);
        const hp = html.slice(at, html.indexOf('</article>', at));
        expect(hp).toMatch(/<a class="pp-link" href="#[^"]+">Josef Fíšek<\/a>/);
        expect(hp).toContain('Kvido Stranný');
        expect(hp).not.toContain('Přestavba stodoly');
        expect(hp).not.toContain('Marie Prouzalová');
    });
});

