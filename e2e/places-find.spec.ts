import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, seedSetting, seedTree } from './helpers.js';

/**
 * Find on the map in the Places dialog (spec 034 §6): every form of the name
 * asked ("Also searched as"), the results with the form that found them, a
 * warned result at the bottom with its reason and picked without a Check
 * mark, a pick with Undo, nothing found → a town nearby, placing by hand
 * with the arrow keys, the one mention of a research in a tree without one,
 * and a phone. The geocoder and the tiles are answered locally; invented
 * places and people (the Lhoták family).
 */

/** The tree's place key (placeKey): no accents, lowercase, dots and commas as spaces. */
const key = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();

type Hit = { lat: string; lon: string; display_name: string; addresstype: string; address?: Record<string, string> };

/** Horní Lhota next to the family's places, and another one 120 km away. */
const NEAR: Hit = {
    lat: '49.612', lon: '15.215', display_name: 'Horní Lhota, okres Lhotov, Česko', addresstype: 'village',
    address: { village: 'Horní Lhota', county: 'okres Lhotov', country: 'Česko' },
};
const FAR: Hit = {
    lat: '50.68', lon: '15.2', display_name: 'Horní Lhota, okres Jinov, Česko', addresstype: 'village',
    address: { village: 'Horní Lhota', county: 'okres Jinov', country: 'Česko' },
};
/** Horní Lhota in another country, hundreds of km away. */
const CROATIA: Hit = {
    lat: '45.3', lon: '14.4', display_name: 'Horní Lhota, Primorsko-goranska županija, Chorvatsko', addresstype: 'village',
    address: { village: 'Horní Lhota', county: 'Primorsko-goranska županija', country: 'Chorvatsko' },
};
const JINOV: Hit = { lat: '49.654', lon: '15.2', display_name: 'Jinov, okres Jinov, Česko', addresstype: 'town' };

/** Answer the geocoder by the query; anything else finds nothing. Returns what was asked. */
async function stubGeocoder(page: Page, answers: Record<string, Hit[]>): Promise<string[]> {
    const asked: string[] = [];
    await page.route('**://nominatim.openstreetmap.org/**', route => {
        const q = new URL(route.request().url()).searchParams.get('q') ?? '';
        asked.push(q);
        void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers[q] ?? []) });
    });
    return asked;
}

async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
    await page.route('**://tile.openstreetmap.org/**', route =>
        route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await seedSetting(page, 'mapTiles', true);
}

/**
 * The OSM tile server refusing every tile, as it answers one: HTTP 200 with
 * the "Access blocked" picture and Cache-Control: no-cache, with or without
 * the app's X-Requested-With.
 */
async function stubRefusedTiles(page: Page): Promise<void> {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
    await page.route('**://tile.openstreetmap.org/**', route => {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'X-Requested-With' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        return route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { ...cors, 'cache-control': 'no-cache' } });
    });
}

/** The Lhoták family around Lhota: Lhota, Lhotov and Jinov on the map; H. Lhota and Lhotínek not. */
async function seed(page: Page, opts: { refusedTiles?: boolean; branch?: boolean } = {}): Promise<void> {
    await seedSetting(page, 'geocoding', true);
    if (opts.refusedTiles) {
        await stubRefusedTiles(page);
        await seedSetting(page, 'mapTiles', true);
    } else {
        await stubTiles(page);
    }
    await openApp(page);
    await seedTree(page, {
        a: { firstName: 'Zorbin', lastName: 'Lhoták', birthDate: '1820', birthPlace: 'Lhota' },
        b: { firstName: 'Quilla', lastName: 'Lhoták', gender: 'female', birthDate: '1840', birthPlace: 'Lhotov' },
        c: { firstName: 'Yarek', lastName: 'Lhoták', birthDate: '1850', birthPlace: 'H. Lhota' },
        d: { firstName: 'Orvel', lastName: 'Lhoták', birthDate: '1860', birthPlace: 'Jinov' },
        e: { firstName: 'Myrtan', lastName: 'Lhoták', birthDate: '1855', birthPlace: 'Lhotínek' },
        // Another branch, 40 km north: the Zlamtek family at Hrubovec and Hrubovka.
        ...(opts.branch ? {
            f: { firstName: 'Kvetula', lastName: 'Zlamtek', gender: 'female', birthDate: '1850', birthPlace: 'Hrubovec' },
            g: { firstName: 'Orvel', lastName: 'Zlamtek', birthDate: '1852', birthPlace: 'Hrubovka' },
        } : {}),
    } as never, 'Lhoták');
    await page.evaluate((branch) => {
        const S = window.Strom;
        S.DataManager.getData().places = {
            lhota: { lat: 49.6, lon: 15.2, label: 'Lhota, okres Jinov, Česko' },
            lhotov: { lat: 49.564, lon: 15.2, label: 'Lhotov, okres Jinov, Česko' },
            jinov: { lat: 49.654, lon: 15.2, label: 'Jinov, okres Jinov, Česko' },
            ...(branch ? {
                hrubovec: { lat: 50.0, lon: 15.2, label: 'Hrubovec, okres Brodnice, Česko' },
                hrubovka: { lat: 50.02, lon: 15.2, label: 'Hrubovka, okres Brodnice, Česko' },
            } : {}),
        };
        S.TreeRenderer.render();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast').forEach(t => t.remove());
    }, !!opts.branch);
}

const modal = (page: Page): Locator => page.locator('#places-modal');
const row = (page: Page, name: string): Locator => modal(page).locator(`.place-row[data-key="${key(name)}"]`);
/** The dialog opened on a place: its search is open. */
const openOn = (page: Page, name: string): Promise<void> =>
    page.evaluate((k) => window.Strom.UI.showPlacesManager(k, undefined, 'tree'), key(name));
const geoOf = (page: Page, name: string): Promise<Record<string, unknown> | null> =>
    page.evaluate((k) => JSON.parse(JSON.stringify(window.Strom.DataManager.getData().places?.[k] ?? null)), key(name));
const toast = (page: Page, text: string | RegExp): Locator => page.locator('.toast', { hasText: text });

/** Every form takes the geocoder's interval: a search of three forms takes a few seconds. */
const SEARCH = { timeout: 15000 };

async function search(page: Page, name: string): Promise<Locator> {
    await openOn(page, name);
    const r = row(page, name);
    await expect(r.locator('.place-search')).toBeVisible();
    await r.locator('.place-search-go').click();
    return r;
}

test.describe('Find on the map', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('every form asked: "Also searched as", found as Horní Lhota, the warned result last; picked, it has no Check mark', async ({ page }) => {
        const asked = await stubGeocoder(page, { 'Horní Lhota': [FAR, NEAR] });
        await seed(page);
        const r = await search(page, 'H. Lhota');
        const results = r.locator('.place-result');
        await expect(results).toHaveCount(2, SEARCH);
        expect(asked).toEqual(['H. Lhota', 'Horní Lhota', 'Hořejší Lhota']);
        // Only the name went out.
        expect(asked.join(' ')).not.toMatch(/Lhoták|Yarek|1850/);
        await expect(r.locator('.place-tried-chip')).toHaveText(['Horní Lhota', 'Hořejší Lhota']);
        await expect(r.locator('.place-tried-label')).toHaveText('Also searched as');

        // A: the one near the family's places, found under the full name.
        const a = results.nth(0);
        await expect(a).toHaveAttribute('data-tone', 'near');
        await expect(a.locator('.place-result-letter')).toHaveText('A');
        await expect(a.locator('.place-candidate-sub')).toHaveText('town · okres Lhotov, Česko');
        // Measured by the family's places around 1850 (Lhotov, Jinov), as the check measures.
        await expect(a.locator('.place-result-km')).toContainText('5 km from Jinov');
        await expect(a.locator('.place-result-near')).toHaveText('⌖ near the other places');
        await expect(a.locator('.place-result-as')).toHaveText('found as Horní Lhota');

        // B: the far one, at the bottom with the check's reason.
        const b = results.nth(1);
        await expect(b).toHaveAttribute('data-tone', 'warn');
        await expect(b.locator('.place-result-warn')).toHaveText(/^! 1\d\d km from the other places of the Lhoták family in 1840–1860\. Possibly another place of the same name\.$/);
        // What the colours say: the ones shown.
        await expect(r.locator('.place-result-legend-item')).toHaveText(['no warning, near the other places', 'a warning, its reason under the result']);
        await expect(r.locator('.place-result-swatch')).toHaveCount(2);
        await expect(b.locator('.place-result-near')).toHaveCount(0);

        // The small map: the tree's places grey, the results lettered.
        await expect(r.locator('.place-mini')).toBeVisible();
        await expect(r.locator('.place-mini-dot:not(.is-legend)')).toHaveCount(3);
        await expect(r.locator('.place-mini-pin')).toHaveText(['A', 'B']);
        await expect(r.locator('.place-mini-pin[data-tone="warn"]')).toHaveText('B');
        await expect(r.locator('.place-mini-toggle')).toBeHidden();
        await expect(r.locator('.place-none-fits')).toHaveText('None fits? Place by hand on the map');

        // Picked knowingly: by hand, the warning answered, no Check mark.
        await b.click();
        await expect(toast(page, 'Matched to Horní Lhota, okres Jinov, Česko')).toBeVisible();
        const geo = await geoOf(page, 'H. Lhota');
        expect(geo).toMatchObject({ lat: 50.68, origin: 'hand' });
        expect(geo?.keptAt).toBeTruthy();
        expect(geo?.at).toMatch(/^\d{4}-\d\d-\d\d$/);
        await expect(row(page, 'H. Lhota')).not.toHaveAttribute('data-state', 'check');
        await expect(row(page, 'H. Lhota').locator('.place-pin-state')).toContainText('Placed by hand');
    });

    test('beside another branch’s village: measured by the family’s places, grey with its legend, not near (1106)', async ({ page }) => {
        const BRANCH: Hit = {
            lat: '50.01', lon: '15.2', display_name: 'Horní Lhota, okres Brodnice, Česko', addresstype: 'village',
            address: { village: 'Horní Lhota', county: 'okres Brodnice', country: 'Česko' },
        };
        await stubGeocoder(page, { 'Horní Lhota': [BRANCH] });
        await seed(page, { branch: true });
        const r = await search(page, 'H. Lhota');
        const a = r.locator('.place-result');
        await expect(a).toHaveCount(1, SEARCH);
        // 1 km from the Zlamtek family's Hrubovec, 40 km from the Lhoták family's Jinov: said by the family.
        await expect(a.locator('.place-result-km')).toContainText('40 km from Jinov');
        await expect(a.locator('.place-result-km')).not.toContainText('Hrubov');
        await expect(a).toHaveAttribute('data-tone', 'plain');
        await expect(a.locator('.place-result-near')).toHaveCount(0);
        await expect(r.locator('.place-result-legend-item')).toHaveText(['no warning']);
        await expect(r.locator('.place-result-swatch[data-tone="plain"]')).toHaveCount(1);
    });

    test('far away in another country: folded under More far away, only hinted at on the small map’s edge, the map fits the tree’s country (1106)', async ({ page }) => {
        await stubGeocoder(page, { 'Horní Lhota': [CROATIA, FAR, NEAR] });
        await seed(page);
        const r = await search(page, 'H. Lhota');
        const results = r.locator('.place-result');
        await expect(results).toHaveCount(3, SEARCH);
        // The two in Česko first, A and B; Croatia (the map's first) last, folded.
        await expect(r.locator('.place-found-list > .place-result .place-candidate-sub')).toHaveText(['town · okres Lhotov, Česko', 'town · okres Jinov, Česko']);
        const toggle = r.locator('.place-away-toggle');
        await expect(toggle).toHaveText('More far away (1)');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        const far = r.locator('.place-away-list .place-result');
        await expect(far).toBeHidden();

        // The small map fits Česko: A and B well apart, Croatia a dashed hint on the edge.
        const mini = r.locator('.place-mini-map');
        const box = (await mini.boundingBox())!;
        const pin = (l: string): Locator => r.locator('.place-mini-pin', { hasText: new RegExp(`^${l}$`) });
        const [a, b, c] = [await pin('A').boundingBox(), await pin('B').boundingBox(), await pin('C').boundingBox()];
        // A and B are 1.07° of latitude apart: about 75 px at the fitted zoom, under 40 px with Croatia in the view.
        expect(Math.abs(b!.y - a!.y)).toBeGreaterThan(60);
        await expect(pin('C')).toHaveClass(/is-away/);
        await expect(pin('A')).not.toHaveClass(/is-away/);
        expect(c!.x).toBeGreaterThanOrEqual(box.x);
        expect(c!.y + c!.height).toBeLessThanOrEqual(box.y + box.height + 1);
        // South-west of the tree: at the bottom edge.
        expect(c!.y + c!.height / 2).toBeGreaterThan(box.y + box.height - 20);
        await expect(pin('C')).toHaveAttribute('aria-label', /^C: Horní Lhota · \d+ km from the family’s other places$/);
        await expect(r.locator('.place-mini-legend', { hasText: 'far results: only their direction at the edge' })).toBeVisible();

        // The hint opens its row (not picked unseen); the row says why it is far.
        await pin('C').click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(far).toBeVisible();
        await expect(far).toBeFocused();
        await expect(far.locator('.place-candidate-sub')).toHaveText('town · Primorsko-goranska županija, Chorvatsko');
        await expect(far.locator('.place-result-warn')).toHaveText(/^! \d+ km from the other places of the Lhoták family in 1840–1860\. Possibly another place of the same name\.$/);
        expect(await geoOf(page, 'H. Lhota')).toBeNull();
        await toggle.click();
        await expect(far).toBeHidden();
    });

    test('every result far away: nothing folded, the map shows them all (1106)', async ({ page }) => {
        await stubGeocoder(page, { 'Horní Lhota': [CROATIA] });
        await seed(page);
        const r = await search(page, 'H. Lhota');
        await expect(r.locator('.place-result')).toHaveCount(1, SEARCH);
        await expect(r.locator('.place-result')).toBeVisible();
        await expect(r.locator('.place-away-toggle')).toHaveCount(0);
        await expect(r.locator('.place-mini-pin.is-away')).toHaveCount(0);
    });

    test('a pick: the location by hand, a toast with Undo', async ({ page }) => {
        await stubGeocoder(page, { 'Horní Lhota': [NEAR] });
        await seed(page);
        const r = await search(page, 'H. Lhota');
        await expect(r.locator('.place-result')).toHaveCount(1, SEARCH);
        // A click on the small map's point picks too.
        await r.locator('.place-mini-pin').click();
        const t = toast(page, 'Matched to Horní Lhota, okres Lhotov, Česko');
        await expect(t).toBeVisible();
        const geo = await geoOf(page, 'H. Lhota');
        expect(geo).toMatchObject({ lat: 49.612, lon: 15.215, origin: 'hand' });
        expect(geo?.keptAt).toBeUndefined();
        await t.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => geoOf(page, 'H. Lhota')).toBeNull();
    });

    test('nothing found: what was asked, a town nearby locates the place by the town', async ({ page }) => {
        const asked = await stubGeocoder(page, { Jinov: [JINOV] });
        await seed(page);
        const r = await search(page, 'Lhotínek');
        const empty = r.locator('.place-empty');
        await expect(empty).toBeVisible(SEARCH);
        await expect(empty.locator('.place-empty-head')).toHaveText('The map found nothing under Lhotínek (also searched as Lhotinek).');
        expect(asked).toEqual(['Lhotínek', 'Lhotinek']);
        await expect(empty.locator('.place-near-note')).toHaveText('The location is attached by that town and the place is marked “located by the town”.');

        await empty.locator('.place-near-town').fill('Jinov');
        await empty.locator('.place-near-go').click();
        await expect(row(page, 'Lhotínek').locator('.place-bytown')).toHaveText('⌖ Located by the town of Jinov');
        expect(await geoOf(page, 'Lhotínek')).toMatchObject({ lat: 49.654, byTown: 'Jinov', origin: 'hand' });
    });

    test('a town nearby the map does not know either says so', async ({ page }) => {
        await stubGeocoder(page, {});
        await seed(page);
        const r = await search(page, 'Lhotínek');
        await expect(r.locator('.place-empty')).toBeVisible(SEARCH);
        await r.locator('.place-near-town').fill('Łotów');
        await r.locator('.place-near-go').click();
        await expect(r.locator('.place-near-note')).toHaveText('The map does not know Łotów either.');
        expect(await geoOf(page, 'Lhotínek')).toBeNull();
    });

    test('Place by hand: the arrows move the map under the cross, Place here, Undo', async ({ page }) => {
        await stubGeocoder(page, {});
        await seed(page);
        const r = await search(page, 'Lhotínek');
        await expect(r.locator('.place-empty')).toBeVisible(SEARCH);
        await r.locator('.place-pin-open').click();
        const map = r.locator('.place-hand-map');
        await expect(map).toBeVisible();
        await expect(map).toBeFocused();
        await expect(r.locator('.place-card-head')).toHaveText('The place goes under the cross in the middle of the map.');
        // The sentence about what is attached stays above it all.
        await expect(r.locator('.place-attach-note')).toBeVisible();
        const at = r.locator('.place-hand-at');
        await expect(at).toHaveText(/^Cross: /);
        const before = await at.textContent();
        for (let i = 0; i < 4; i++) await map.press('ArrowRight');
        await expect(at).not.toHaveText(before ?? '');
        await expect(at).toHaveText(/^Cross: about \d+ km east of (Lhota|Lhotov|Jinov)$/);

        await r.locator('.place-hand-here').click();
        const t = toast(page, 'Placed by hand: Lhotínek.');
        await expect(t).toBeVisible();
        await expect(row(page, 'Lhotínek').locator('.place-pin-state')).toContainText('Placed by hand');
        const geo = await geoOf(page, 'Lhotínek');
        expect(geo).toMatchObject({ origin: 'hand' });
        expect(geo?.label).toBeUndefined();
        expect(geo?.lon as number).toBeGreaterThan(15.2);
        await t.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => geoOf(page, 'Lhotínek')).toBeNull();
    });

    test('a tree without a research: one sentence and What is a research', async ({ page }) => {
        await stubGeocoder(page, {});
        await seed(page);
        const r = await search(page, 'Lhotínek');
        await expect(r.locator('.place-empty')).toBeVisible(SEARCH);
        await expect(r.locator('.place-empty-look')).toHaveCount(0);
        await expect(r.locator('.place-empty-research')).toContainText('A research can identify a place from the context of the records.');
        await r.getByRole('button', { name: 'What is a research ›' }).click();
        await expect(page.locator('#research-info-modal .research-install-dialog')).toBeVisible();
    });
});

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`a phone (${size.width}×${size.height}): the map behind Show on the map, no horizontal scroll`, async ({ page }) => {
        await page.setViewportSize(size);
        await stubGeocoder(page, { 'Horní Lhota': [FAR, NEAR] });
        await seed(page);
        const r = await search(page, 'H. Lhota');
        await expect(r.locator('.place-result')).toHaveCount(2, SEARCH);
        await expect(r.locator('.place-mini')).toBeHidden();
        const toggle = r.locator('.place-mini-toggle');
        await expect(toggle).toHaveText('⌖ Show on the map');
        await toggle.click();
        await expect(r.locator('.place-mini')).toBeVisible();
        await expect(toggle).toHaveText('⌖ Hide the map');
        await expect(r.locator('.place-mini-pin')).toHaveCount(2);
        const overflow = await page.evaluate(() => {
            const m = document.querySelector('#places-modal .modal-content, #places-modal .modal') as HTMLElement | null;
            const doc = document.documentElement;
            return { page: doc.scrollWidth - doc.clientWidth, modal: m ? m.scrollWidth - m.clientWidth : 0 };
        });
        expect(overflow).toEqual({ page: 0, modal: 0 });

        await r.locator('.place-none-fits').click();
        await expect(r.locator('.place-hand-map')).toBeVisible();
        const box = await r.locator('.place-hand-map').boundingBox();
        expect(box?.height).toBe(size.width < 640 ? 220 : 150);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
}

/** German (the longest texts) on a touch phone: the results, nothing found and the map by hand stay inside the panel. */
test('the tile server refuses the background: the small map says so once, no empty tile frames, the letters stay', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubGeocoder(page, { 'Horní Lhota': [FAR, NEAR] });
    await seed(page, { refusedTiles: true });
    const r = await search(page, 'H. Lhota');
    await expect(r.locator('.place-result')).toHaveCount(2, SEARCH);

    const mini = r.locator('.place-mini-map');
    const note = mini.locator('.map-tiles-blocked');
    await expect(note).toBeVisible();
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText(/OpenStreetMap tile server refused/);
    // No tile picture is left, and no empty tile draws a frame or a broken-image icon.
    const tiles = mini.locator('.map-tile');
    await expect.poll(() => mini.locator('.map-tile[src]').count()).toBe(0);
    expect(await tiles.count()).toBeGreaterThan(0);
    expect(await tiles.evaluateAll(els => els.every(el => getComputedStyle(el).visibility === 'hidden'))).toBe(true);
    // The letters are drawn over the note and still pick.
    await expect(r.locator('.place-mini-pin')).toHaveText(['A', 'B']);
    await r.locator('.place-mini-pin').first().click();
    await expect(toast(page, 'Matched to Horní Lhota, okres Lhotov, Česko')).toBeVisible();
});

test('in German at 390px with touch: nothing in the search panel overflows', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'de-DE' });
    const page = await context.newPage();
    try {
        await seedSetting(page, 'language', 'de');
        await stubGeocoder(page, { 'Horní Lhota': [FAR, NEAR, CROATIA] });
        await seed(page);
        const outside = (): Promise<string[]> => page.evaluate(() => {
            const panel = document.querySelector('#places-modal .place-row .place-search:not([hidden])') as HTMLElement;
            const edge = panel.getBoundingClientRect().right + 1;
            return [...panel.querySelectorAll<HTMLElement>('*')]
                .filter(el => el.offsetParent !== null && !el.closest('.place-mini-marks, .place-mini-tiles, .place-hand-cross')
                    && (el.getBoundingClientRect().right > edge || el.scrollWidth > el.clientWidth + 1)
                    && !el.matches('.place-mini-map, .place-hand-map, input'))
                .map(el => `${el.className}: ${el.textContent?.slice(0, 40)}`);
        });
        const r = await search(page, 'H. Lhota');
        await expect(r.locator('.place-result')).toHaveCount(3, SEARCH);
        await r.locator('.place-mini-toggle').click();
        await expect(r.locator('.place-away-toggle')).toHaveText('Weitere entfernte (1)');
        await r.locator('.place-away-toggle').click();
        await expect(r.locator('.place-away-list .place-result')).toBeVisible();
        expect(await outside()).toEqual([]);
        expect((await r.locator('.place-away-toggle').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // 44 px on touch.
        expect((await r.locator('.place-result').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await r.locator('.place-none-fits').boundingBox())!.height).toBeGreaterThanOrEqual(44);

        const e = await search(page, 'Lhotínek');
        await expect(e.locator('.place-empty')).toBeVisible(SEARCH);
        expect(await outside()).toEqual([]);
        await e.locator('.place-pin-open').click();
        await expect(e.locator('.place-hand-map')).toBeVisible();
        expect(await outside()).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    } finally {
        await context.close();
    }
});
