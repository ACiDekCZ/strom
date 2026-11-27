import { test, expect, Page, Locator, BrowserContext, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openApp, seedTree, seedSetting, SeedPerson } from './helpers.js';
import { fakeBridge, openResearch, poll, BRIDGE } from './research-bridge.js';

/**
 * A house's location in outputs (spec 145 T3): the book's Houses chapter with a
 * cut of today's map at a house of old times only, none at a house with a
 * living person; the option "House locations" off; "Hide location in outputs"
 * on the house page (one undo step) taking it out of the book and the HTML;
 * the saved house page and the family pages with the cut as a picture in the
 * file, opened offline; a second save offline served from what is kept; the
 * research's historical layer beside today's map.
 *
 * Fake tiles and a fake layer answered here (nothing reaches a map server);
 * invented village Bělokamen: čp. 16 of the Prouzals (1820–1910), čp. 7 of
 * the Trnovec family with Vojmír, born there in 1988.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

interface Tiles { asked: string[]; offline: boolean }

/** Today's tiles and the research's layers answered here, as their servers do (CORS, a cache lifetime). */
async function stubMapServers(page: Page): Promise<Tiles> {
    const t: Tiles = { asked: [], offline: false };
    await page.route(/^https:\/\/(tile\.openstreetmap\.org|ortho\.example\.org|aerial\.example\.org)\//, (route: Route) => {
        t.asked.push(route.request().url());
        if (t.offline) return route.abort('internetdisconnected');
        return route.fulfill({
            status: 200, contentType: 'image/png', body: PNG,
            headers: { 'cache-control': 'max-age=604800', 'access-control-allow-origin': '*' },
        });
    });
    await seedSetting(page, 'mapTiles', true);
    return t;
}

const PEOPLE: Record<string, SeedPerson> = {
    svatobor: {
        firstName: 'Svatobor', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890', partners: ['radegunda'],
    },
    radegunda: {
        firstName: 'Radegunda', lastName: 'Prouzalová', gender: 'female', birthPlace: 'Mlýnkovice', birthDate: '1824',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1891', partners: ['svatobor'],
    },
    hostivit: {
        firstName: 'Hostivít', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1910', parents: ['svatobor', 'radegunda'],
    },
    lubomir: { firstName: 'Lubomír', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1830', deathDate: '1890' },
    kresomysl: {
        firstName: 'Křesomysl', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1862', deathDate: '1918',
        parents: ['lubomir'],
    },
    vojmir: { firstName: 'Vojmír', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1988' },
};

const OLD = 'belokamen|16';
const LIVING = 'belokamen|7';

async function seedVillage(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, PEOPLE, 'Prouzal', 'svatobor');
    await page.evaluate(async ([old, living]) => {
        const S = window.Strom;
        S.DataManager.setHouseUserData(old as never, { name: 'U Prouzalů', location: { lat: 49.6118, lng: 15.2251, how: 'manual' } } as never, 'čp. 16');
        S.DataManager.setHouseUserData(living as never, { location: { lat: 49.6125, lng: 15.2262, how: 'manual' } } as never, 'čp. 7');
        await S.TreeManager.flush();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    }, [OLD, LIVING]);
}

async function bookDialog(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    const houses = dialog.locator('.book-part[data-part="houses"] input');
    if (!(await houses.isChecked())) await houses.check();
    return dialog;
}

async function openBook(page: Page, context: BrowserContext): Promise<Page> {
    const [book] = await Promise.all([context.waitForEvent('page'), page.locator('#book-modal #book-open').click()]);
    await book.waitForLoadState('domcontentloaded');
    await book.locator('.book-toolbar').waitFor();
    await book.locator('#book-houses').waitFor();
    return book;
}

const chapterHouse = (book: Page, id: string) => book.locator(`#kap-dum-${id.replace(/[^a-z0-9]+/gi, '-')}`);

/** A picture that has really loaded (decoded, of its full size). */
async function loadedWidth(img: Locator): Promise<number> {
    await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).complete)).toBe(true);
    return img.evaluate(el => (el as HTMLImageElement).naturalWidth);
}

const housePage = (page: Page) => page.locator('#house-page-modal');

async function openHousePage(page: Page, id: string): Promise<Locator> {
    await page.evaluate(id => window.Strom.UI.openHousePage(id), id);
    const win = housePage(page);
    await expect(win.locator('#hp-title')).toBeVisible();
    return win;
}

async function saveHousePage(page: Page): Promise<string> {
    const [download] = await Promise.all([page.waitForEvent('download'), housePage(page).locator('.pp-save').click()]);
    return readFile((await download.path())!, 'utf8');
}

test.describe('A house\'s location in outputs (spec 145 T3)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the book: the cut of today\'s map at the old house, none at the house with a living person; the option off: the town only', async ({ page, context }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
        const tiles = await stubMapServers(page);
        await seedVillage(page);
        const dialog = await bookDialog(page);
        const sw = dialog.locator('.book-house-maps [data-switch="houseMaps"]');
        await expect(dialog.locator('.book-house-maps')).toBeVisible();
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('.book-house-maps')).toContainText('House locations');

        const book = await openBook(page, context);
        const old = chapterHouse(book, OLD);
        const img = old.locator('figure.book-house-map img.book-house-map-img');
        await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/);
        expect(await loadedWidth(img)).toBe(600);
        await expect(old.locator('.book-house-map-pos')).toHaveText('49.6118° N, 15.2251° E · Today’s location · number match confirmed');
        await expect(old.locator('.book-house-map-attr')).toHaveText('© OpenStreetMap contributors, licence ODbL');
        // The house with the living: no picture, no coordinates.
        await expect(chapterHouse(book, LIVING)).toBeVisible();
        await expect(chapterHouse(book, LIVING).locator('.book-house-map')).toHaveCount(0);
        await expect(chapterHouse(book, LIVING)).not.toContainText('49.6125');
        // Only tiles of zoom 17 around the old house were asked for.
        expect(tiles.asked.length).toBeGreaterThan(0);
        expect(tiles.asked.every(u => /tile\.openstreetmap\.org\/17\//.test(u))).toBe(true);
        await book.close();

        // Off: the town only, remembered.
        await page.evaluate(() => window.Strom.UI.showBookDialog());
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        const plain = await openBook(page, context);
        await expect(chapterHouse(plain, OLD)).toBeVisible();
        await expect(plain.locator('.book-house-map')).toHaveCount(0);
        await expect(plain.locator('#book-houses')).not.toContainText('49.6118');
        await plain.close();
        await page.evaluate(() => window.Strom.UI.showBookDialog());
        await expect(sw).toHaveAttribute('aria-checked', 'false');
    });

    test('no network: the book gives the coordinates and the certainty, without a picture and without an error', async ({ page, context }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
        const tiles = await stubMapServers(page);
        tiles.offline = true;
        await seedVillage(page);
        await bookDialog(page);
        const book = await openBook(page, context);
        const old = chapterHouse(book, OLD);
        await expect(old.locator('figure.book-house-map--words .book-house-map-pos')).toHaveText(/^49\.6118° N, 15\.2251° E · Today’s location/);
        await expect(old.locator('img')).toHaveCount(0);
        await expect(page.locator('.toast.error, .toast--error')).toHaveCount(0);
    });

    test('Hide location in outputs: one undo step; the book and the saved page without it, back after undo', async ({ page, context }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
        await stubMapServers(page);
        await seedVillage(page);
        const win = await openHousePage(page, OLD);
        const out = win.locator('.hmap-out');
        await expect(out.locator('.hmap-out-t')).toHaveText('Outputs (HTML, book) show the house location.');
        await out.locator('[data-hp-act="hide-location"]').click();
        await expect(out).toHaveClass(/hmap-out--hidden/);
        await expect(out.locator('.hmap-out-t')).toHaveText('The house location is hidden by hand in outputs (HTML, book).');
        await expect(out.locator('[data-hp-act="hide-location"]')).toHaveText('Show location in outputs');
        await expect(out.locator('[data-hp-act="hide-location"]')).toBeFocused();
        expect(await page.evaluate(id => window.Strom.DataManager.getData().houses?.[id as never]?.hideLocation, OLD)).toBe(true);

        const html = await saveHousePage(page);
        expect(html).not.toContain('<figure class="hmap-shot"');
        expect(html).not.toContain('49.6118');
        await win.locator('.pp-close').click();

        await bookDialog(page);
        // The option goes with the last house whose location may show.
        await expect(page.locator('#book-modal .book-house-maps')).toBeHidden();
        const book = await openBook(page, context);
        await expect(book.locator('.book-house-map')).toHaveCount(0);
        await book.close();
        await page.evaluate(() => window.Strom.UI.closeBookDialog());

        // One undo step brings it back.
        await page.evaluate(() => window.Strom.DataManager.undo());
        expect(await page.evaluate(id => window.Strom.DataManager.getData().houses?.[id as never]?.hideLocation, OLD)).toBeUndefined();
        await openHousePage(page, OLD);
        const again = await saveHousePage(page);
        expect(again).toContain('<img class="hmap-shot-img" src="data:image/png;base64,');
    });

    test('the saved house page: the cut as a picture in the file, opened offline; a second save offline from what is kept', async ({ page, context }, testInfo) => {
        await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
        const tiles = await stubMapServers(page);
        await seedVillage(page);
        await openHousePage(page, OLD);
        const [download] = await Promise.all([page.waitForEvent('download'), housePage(page).locator('.pp-save').click()]);
        const file = testInfo.outputPath('house.html');
        await download.saveAs(file);
        const html = await readFile(file, 'utf8');
        expect(html).toMatch(/<figure class="hmap-shot" data-shot="today"><img class="hmap-shot-img" src="data:image\/png;base64,[^"]+" alt="[^"]+" width="600" height="300">/);
        expect(html).toContain('© OpenStreetMap contributors, licence ODbL');
        expect(html).toContain('49.6118° N, 15.2251° E');
        expect(html).toContain('openstreetmap.org/?mlat=');
        expect(html).not.toMatch(/src="https?:/);
        expect(tiles.asked.length).toBeGreaterThan(0);
        const src = html.match(/<img class="hmap-shot-img" src="([^"]+)"/)![1];

        // The file offline: its picture is in it, nothing is asked of the network.
        const offline = await context.newPage();
        const net: string[] = [];
        offline.on('request', r => { if (/^https?:/.test(r.url())) net.push(r.url()); });
        await context.setOffline(true);
        await offline.goto(pathToFileURL(file).href);
        expect(await loadedWidth(offline.locator('.hmap-shot-img').first())).toBe(600);
        expect(await offline.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(net).toEqual([]);
        await offline.close();
        await context.setOffline(false);

        // A second save after a reload (nothing in the tab) with the map servers out of reach: the same picture,
        // which only what is kept can give.
        tiles.offline = true;
        await page.reload();
        await page.locator('.person-card').first().waitFor();
        await openHousePage(page, OLD);
        const again = await saveHousePage(page);
        expect(again.match(/<img class="hmap-shot-img" src="([^"]+)"/)?.[1]).toBe(src);
    });

    test('the family pages: the house page in the file with the cut as a picture', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
        await stubMapServers(page);
        await seedVillage(page);
        await page.evaluate(() => window.Strom.UI.showBookDialog('pages'));
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res.locator('.fp-res-t')).toHaveText('The file is ready');
        const [download] = await Promise.all([page.waitForEvent('download'), res.locator('.fp-res-save').click()]);
        const html = await readFile((await download.path())!, 'utf8');
        const houses = html.split('<article class="pp hp"').slice(1).map(a => a.slice(0, a.indexOf('</article>')));
        const old = houses.find(a => a.includes('U Prouzalů'));
        const living = houses.find(a => a.includes('čp. 7') || a.includes('čp. 7'));
        expect(old).toBeTruthy();
        expect(old).toMatch(/<img class="hmap-shot-img" src="data:image\/png;base64,/);
        expect(old).toContain('© OpenStreetMap contributors, licence ODbL');
        if (living) {
            expect(living).not.toContain('<figure class="hmap-shot"');
            expect(living).not.toContain('49.6125');
        }
    });
});

// ── The research's historical layer beside today's map ───────────────────────

const KEY = 'belokamen|16';
const AERIAL_LAYER = {
    id: 'cz-ortho-1950', kind: 'ortho-1950', label: 'Letecké snímky 50. let', type: 'wms', url: 'https://aerial.example.org/wms',
    layers: 'orto', format: 'image/jpeg', crs: 'EPSG:5514', attribution: 'Archiv leteckých snímků Brodek, 1953', license: 'CC BY 4.0',
    bbox: [12, 48.5, 19, 51],
};
const ORTHO_LAYER = {
    id: 'cz-ortho', kind: 'ortho', label: 'Ortofoto (dnes)', type: 'wms', url: 'https://ortho.example.org/wms', layers: '0',
    format: 'image/jpeg', attribution: '© Zeměměřický ústav Brodek', license: 'CC BY 4.0', bbox: [12, 48.5, 19, 51],
};

function houseRow(): Record<string, unknown> {
    return {
        id: 'A0001', key: KEY, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16',
        persons: 2, years: { from: 1820, to: 1880 }, state: 'done', at: '2027-03-01T09:00:00Z',
        summary: { events: 1, holders: 1, residents: 0, unknown: 0, materials: 0, passed: 0 },
    };
}

function houseResult(): Record<string, unknown> {
    return {
        ...houseRow(),
        numbers: [{ id: 'n1', number: '16', from: '1836', sources: [] }],
        timeline: [{ id: 'e1', kind: 'built', date: '1830', text: 'Stavení postaveno po rozdělení gruntu', sources: [] }],
        holders: [{ id: 'h1', name: 'Josef Fíšek', person: 'P0001', from: '1845', to: '1880', how: 'inheritance', sources: [] }],
        residents: [], unknown: [], passed: [], manual: [], archiveOnly: [], sensitive: [], same: [], materials: [],
        location: { lat: 49.6118, lon: 15.2251, certainty: 'medium', how: 'old-map', confirmed: null, sources: [] },
        maps: [{ id: 'm2', kind: 'ortho', layer: 'cz-ortho' }],
    };
}

test.describe('A house\'s location in outputs: the research\'s layers (spec 145 T3)', () => {
    test('the saved house page: today\'s map and the historical layer, each with its attribution; today\'s orthophoto not', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
        await fakeBridge(page, {
            features: ['house', 'house.material', 'house.request', 'house.confirm'], links: ['send', 'open', 'live', 'app', 'setup'],
            statusExtra: { houses: { on: false, rev: 'r1', counts: { done: 1, running: 0, queued: 0, waiting: 0, held: 0 }, layers: [ORTHO_LAYER, AERIAL_LAYER] } },
        });
        await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: 'r1', houses: [houseRow()] }) }));
        await page.route(u => `${u.origin}${u.pathname}`.startsWith(`${BRIDGE}/houses/`), route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(houseResult()) }));
        const tiles = await stubMapServers(page);
        await openResearch(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
                if (p.firstName === 'Josef') {
                    dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820',
                        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1880' } as never);
                }
                if (p.firstName === 'Jan') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850' } as never);
            }
        });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        const row = page.locator(`#houses-modal .house-row[data-house="${KEY}"]`);
        await expect(row).toBeVisible();
        await row.locator('.house-chev').click();
        await page.locator('#houses-modal .house-detail .house-page-link').click();
        const win = housePage(page);
        await expect(win.locator('#hp-sec-people')).toBeVisible();
        await expect(win.locator('.hmap-out-t')).toHaveText('Outputs (HTML, book) show the house location.');

        const html = await saveHousePage(page);
        const shots = [...html.matchAll(/<figure class="hmap-shot" data-shot="([^"]+)"><img class="hmap-shot-img" src="(data:image\/[a-z]+);/g)]
            .map(m => [m[1], m[2]]);
        expect(shots).toEqual([['today', 'data:image/png'], ['cz-ortho-1950', 'data:image/jpeg']]);
        expect(html).toContain('Archiv leteckých snímků Brodek, 1953');
        expect(html).toContain('CC BY 4.0');
        expect(html).toContain('Today’s location · number match assumed');
        // The layer asked once as one picture in its own system (S-JTSK), not as tiles.
        const aerial = tiles.asked.filter(u => u.startsWith('https://aerial.example.org/'));
        expect(aerial).toHaveLength(1);
        expect(aerial[0]).toMatch(/EPSG:5514/);
        expect(tiles.asked.some(u => u.startsWith('https://ortho.example.org/'))).toBe(false);
    });
});
