/**
 * A house's location in outputs (spec 145 T3): one rule (houseOutputFilter: a
 * house without people of the last ~100 years and not hidden by hand), how sure
 * the location is, the sentence of what outputs leave out, the manual switch on
 * the house page, the cut of today's map made for an output (a fake loader and
 * canvas, its cache, no network), the book's option "House locations" and the
 * HTML's pictures. Fictional houses (helpers/house-book-fixture.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseId, StromData } from '../types.js';
import { collectHouses, mergeIncomingHouses, sanitizeHouseUserData, type TreeHouse } from '../houses.js';
import { houseOutputFilter } from '../house-privacy.js';
import { getStringsForLang, type Language } from '../strings.js';
import { houseMapHtml, type HouseMapInput } from '../house-map.js';
import {
    HOUSE_SHOT_HEIGHT, HOUSE_SHOT_WIDTH, houseShotKey, houseShots, houseShotsFor, todayHouseShot, todayShotTiles,
    type HouseShotDeps, type ShotCache, type ShotContext,
} from '../house-map-shot.js';
import { HOUSE_MAP_ZOOM } from '../house-map.js';
import {
    bookHouseMaps, bookHouseMapsState, defaultBookOptions, estimateBook, housesChapterPages, housesWithLocation, HOUSE_MAP_PAGES,
} from '../book-options.js';
import { buildFamilyBook } from '../book.js';
import { bookOptionsFromMemory, loadBookMemory, saveBookMemory } from '../book-memory.js';
import { buildHousePage } from '../house-page.js';
import type { LiveHouseLayer } from '../research-link.js';
import { HOUSE_ID, HOUSE_NOW, OLD_HOUSE_ID, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const LANGS: Language[] = ['cs', 'en', 'de', 'pl'];

function houseOf(data: StromData, id: string): TreeHouse {
    const h = collectHouses(data).find(x => x.id === id);
    if (!h) throw new Error(id);
    return h;
}

/** The old house (Mlýnkovice čp. 3, people of 1795–1860 only) with the research's point instead of one of its own. */
function oldWithResearchPoint(data: StromData, confirmed: boolean) {
    delete data.houses![OLD_HOUSE_ID].location;
    return {
        ...houseResearch(), key: OLD_HOUSE_ID, house: '3', timeline: [], holders: [], residents: [], sensitive: [],
        location: { lat: 49.61, lon: 15.31, confirmed: confirmed ? { by: 'research', at: '2026-01-02' } : null, sources: [] },
    } as unknown as ReturnType<typeof houseResearch>;
}

describe('houseOutputFilter: the location in outputs (spec 145 T3)', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
    afterEach(() => { vi.useRealTimers(); });

    it('a house of old times only: its location, sure when its point was confirmed', () => {
        const data = houseTree();
        const out = houseOutputFilter(houseOf(data, OLD_HOUSE_ID), null, data, HOUSE_NOW);
        expect(out.location).toEqual({ lat: 49.6, lng: 15.3 });
        expect(out.locationSure).toBe('confirmed');
        expect(out.hidden).toMatchObject({ location: false, locationBy: null });
    });

    it('the research\'s point: confirmed by the research → confirmed; otherwise assumed', () => {
        const a = houseTree();
        const assumed = houseOutputFilter(houseOf(a, OLD_HOUSE_ID), oldWithResearchPoint(a, false), a, HOUSE_NOW);
        expect(assumed.location).toEqual({ lat: 49.61, lng: 15.31 });
        expect(assumed.locationSure).toBe('assumed');
        const b = houseTree();
        expect(houseOutputFilter(houseOf(b, OLD_HOUSE_ID), oldWithResearchPoint(b, true), b, HOUSE_NOW).locationSure).toBe('confirmed');
    });

    it('a house with the living / people of the last ~100 years: no location, by the rule', () => {
        const data = houseTree();
        const out = houseOutputFilter(houseOf(data, HOUSE_ID), houseResearch(), data, HOUSE_NOW);
        expect(out.location).toBeNull();
        expect(out.locationSure).toBeNull();
        expect(out.hidden).toMatchObject({ location: true, locationBy: 'recent' });
    });

    it('hidden by hand wins over an old house; the rule\'s reason stays when both apply', () => {
        const data = houseTree();
        data.houses![OLD_HOUSE_ID].hideLocation = true;
        const out = houseOutputFilter(houseOf(data, OLD_HOUSE_ID), null, data, HOUSE_NOW);
        expect(out.location).toBeNull();
        expect(out.hidden).toMatchObject({ location: true, locationBy: 'manual' });
        data.houses![HOUSE_ID].hideLocation = true;
        expect(houseOutputFilter(houseOf(data, HOUSE_ID), houseResearch(), data, HOUSE_NOW).hidden.locationBy).toBe('recent');
    });

    it('a house without any point: nothing hidden', () => {
        const data = houseTree();
        delete data.houses![OLD_HOUSE_ID].location;
        data.houses![OLD_HOUSE_ID].hideLocation = true;
        expect(houseOutputFilter(houseOf(data, OLD_HOUSE_ID), null, data, HOUSE_NOW).hidden).toMatchObject({ location: false, locationBy: null });
    });
});

describe('hiddenSummary: what outputs leave out, by its reason, in four languages', () => {
    it('every branch says something of its own, impersonal', () => {
        for (const lang of LANGS) {
            const H = getStringsForLang(lang).houses;
            const texts = [H.hiddenSummary(2, 'recent'), H.hiddenSummary(2, 'manual'), H.hiddenSummary(2, null),
                H.hiddenSummary(0, 'manual'), H.hiddenSummary(0, 'recent'), H.hiddenSummary(1, null)];
            expect(new Set(texts).size, lang).toBe(texts.length);
            for (const t of texts) {
                expect(t.length, lang).toBeGreaterThan(10);
                expect(t, lang).not.toMatch(/\b(your|you|Sie|Ihr|váš|vaše|twój|twoje)\b/i);
            }
            // The manual hide names the hand, the rule names the last ~100 years.
            expect(H.hiddenSummary(0, 'recent'), lang).toContain('~100');
            expect(H.hiddenSummary(0, 'manual'), lang).not.toContain('~100');
            expect(H.hiddenSummary(2, 'recent'), lang).toContain('~100');
        }
        expect(getStringsForLang('cs').houses.hiddenSummary(0, 'manual')).toBe('Ve výstupech (HTML, kniha) je poloha domu skrytá ručně.');
    });
});

describe('hideLocation: kept, validated and merged', () => {
    it('only true is kept', () => {
        expect(sanitizeHouseUserData(HOUSE_ID as HouseId, { hideLocation: true })).toEqual({ hideLocation: true });
        expect(sanitizeHouseUserData(HOUSE_ID as HouseId, { hideLocation: 'yes', name: 'U Prouzalů' })).toEqual({ name: 'U Prouzalů' });
        expect(sanitizeHouseUserData(HOUSE_ID as HouseId, { hideLocation: false })).toBeNull();
    });

    it('a merge keeps a house hidden on either side', () => {
        const ours = { [HOUSE_ID]: { name: 'U Prouzalů' } } as Record<HouseId, { name?: string; hideLocation?: true }>;
        const merged = mergeIncomingHouses(ours, { [HOUSE_ID]: { hideLocation: true }, [OLD_HOUSE_ID]: { hideLocation: true } } as never);
        expect(merged?.[HOUSE_ID as HouseId]).toEqual({ name: 'U Prouzalů', hideLocation: true });
        expect(merged?.[OLD_HOUSE_ID as HouseId]).toEqual({ hideLocation: true });
    });
});

/** A fake canvas that records what is drawn and gives a data URL of it. */
function fakeDeps(init: Partial<HouseShotDeps> & { store?: Map<string, string> } = {}) {
    const store = init.store ?? new Map<string, string>();
    const drawn: string[] = [];
    const tiles: string[] = [];
    const cache: ShotCache = { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
    const ctx = {
        drawImage: () => { drawn.push('img'); }, beginPath() {}, arc() {}, fill() {}, stroke() {},
        fillText: (t: string) => { drawn.push(`text:${t}`); },
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'center', textBaseline: 'middle',
    } as unknown as ShotContext;
    const deps: HouseShotDeps = {
        tilesAllowed: true,
        loadTile: async url => { tiles.push(url); return { width: 256, height: 256 }; },
        loadLayer: async () => ({ width: HOUSE_SHOT_WIDTH, height: HOUSE_SHOT_HEIGHT }),
        canvas: () => ({ ctx, toDataUrl: type => `data:${type};base64,${drawn.length}` }),
        cache,
        ...init,
    };
    return { deps, store, drawn, tiles };
}

const POINT = { lat: 49.6, lng: 15.3 };
const AERIAL: LiveHouseLayer = {
    id: 'cz-ortho-1950', kind: 'ortho-1950', label: 'Letecké snímky 50. let', type: 'wms',
    url: 'https://aerial.example.org/wms', layers: 'orto', format: 'image/jpeg', crs: 'EPSG:5514',
    attribution: 'Archiv leteckých snímků Brodek', license: 'CC BY 4.0', bbox: [12, 48.5, 19, 51],
};
const ORTHO_TODAY: LiveHouseLayer = { ...AERIAL, id: 'cz-ortho', kind: 'ortho', label: 'Ortofoto', crs: undefined };

describe('the cut of today\'s map (src/house-map-shot.ts)', () => {
    it('its tiles put together with the house\'s number, a PNG, kept under house + point + layer + zoom', async () => {
        const { deps, store, drawn, tiles } = fakeDeps();
        const shot = await todayHouseShot(OLD_HOUSE_ID as HouseId, 'čp. 3', POINT, 'cs', deps);
        expect(shot?.src.startsWith('data:image/png')).toBe(true);
        expect(shot).toMatchObject({ view: 'today', width: HOUSE_SHOT_WIDTH, height: HOUSE_SHOT_HEIGHT, attribution: '© přispěvatelé OpenStreetMap, licence ODbL' });
        expect(tiles.length).toBe(todayShotTiles(POINT).length);
        expect(tiles.every(u => u.includes(`/${HOUSE_MAP_ZOOM}/`))).toBe(true);
        expect(drawn).toContain('text:3');
        const key = houseShotKey(OLD_HOUSE_ID as HouseId, POINT, 'today');
        expect(key).toContain(`z${HOUSE_MAP_ZOOM}`);
        expect(store.get(key)).toBe(shot?.src);
    });

    it('a second output offline: served from what is kept, no tile asked for', async () => {
        const first = fakeDeps();
        const made = await todayHouseShot(OLD_HOUSE_ID as HouseId, 'čp. 3', POINT, 'en', first.deps);
        const offline = fakeDeps({ store: first.store, tilesAllowed: false, loadTile: async () => { throw new Error('offline'); } });
        const again = await todayHouseShot(OLD_HOUSE_ID as HouseId, 'čp. 3', POINT, 'en', offline.deps);
        expect(again?.src).toBe(made?.src);
        expect(offline.tiles).toEqual([]);
    });

    it('a tile that does not come, no consent to the map or past the limit: no picture, no error', async () => {
        const failing = fakeDeps({ loadTile: async () => { throw new Error('offline'); } });
        expect(await todayHouseShot(OLD_HOUSE_ID as HouseId, 'čp. 3', POINT, 'cs', failing.deps)).toBeNull();
        expect(failing.store.size).toBe(0);
        const noConsent = fakeDeps({ tilesAllowed: false });
        expect(await todayHouseShot(OLD_HOUSE_ID as HouseId, 'čp. 3', POINT, 'cs', noConsent.deps)).toBeNull();
        expect(noConsent.tiles).toEqual([]);
        const slow = fakeDeps({ timeoutMs: 20, loadTile: (_u, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
        expect(await todayHouseShot(OLD_HOUSE_ID as HouseId, 'čp. 3', POINT, 'cs', slow.deps)).toBeNull();
        const broken = fakeDeps({ cache: { get: async () => { throw new Error('db'); }, put: async () => { throw new Error('db'); } } });
        expect((await todayHouseShot(OLD_HOUSE_ID as HouseId, 'čp. 3', POINT, 'cs', broken.deps))?.src).toMatch(/^data:image\/png/);
    });

    it('the HTML\'s historical layer beside it (JPEG of a photo, its attribution); today\'s orthophoto is not historical', async () => {
        const { deps } = fakeDeps();
        const got = await houseShots({ houseId: OLD_HOUSE_ID as HouseId, houseText: 'čp. 3', point: POINT, research: null, layers: [AERIAL, ORTHO_TODAY] }, 'cs', deps);
        expect(got.today).not.toBeNull();
        expect(got.layers.map(l => l.view)).toEqual(['cz-ortho-1950']);
        expect(got.layers[0].src.startsWith('data:image/jpeg')).toBe(true);
        expect(got.layers[0].attribution).toContain('Archiv leteckých snímků Brodek');
        expect(got.layers[0].attribution).toContain('CC BY 4.0');
    });

    it('several houses: a house without any picture is left out, the rest kept', async () => {
        const away = { lat: 49.5, lng: 15.2 };
        const offline = new Set(todayShotTiles(away).map(t => t.url));
        const { deps } = fakeDeps({ loadTile: async url => { if (offline.has(url)) throw new Error('x'); return { width: 256, height: 256 }; } });
        const map = await houseShotsFor([
            { houseId: OLD_HOUSE_ID as HouseId, houseText: 'čp. 3', point: POINT, research: null },
            { houseId: HOUSE_ID as HouseId, houseText: 'čp. 16', point: away, research: null },
        ], 'en', deps);
        expect(map.has(OLD_HOUSE_ID as HouseId)).toBe(true);
        expect(map.has(HOUSE_ID as HouseId)).toBe(false);
    });
});

describe('the house page: the location in outputs (spec 145 T3)', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
    afterEach(() => { vi.useRealTimers(); });

    const page = (data: StromData, id: string, mode: 'app' | 'file', canEdit = true, extra: Record<string, unknown> = {}): string =>
        buildHousePage(data, houseOf(data, id), id === HOUSE_ID ? houseResearch() : null, mode, {
            lang: 'cs', now: HOUSE_NOW, ...(mode === 'app' ? { app: { canEdit } } : {}), ...extra,
        } as never);

    it('the app: "Hide location in outputs" for an old house, "Show…" once hidden, the state alone read-only', () => {
        const data = houseTree();
        expect(page(data, OLD_HOUSE_ID, 'app')).toContain('data-hp-act="hide-location" data-hide="hide"');
        data.houses![OLD_HOUSE_ID].hideLocation = true;
        const hidden = page(data, OLD_HOUSE_ID, 'app');
        expect(hidden).toContain('data-hide="show"');
        expect(hidden).toContain('hmap-out--hidden');
        const ro = page(data, OLD_HOUSE_ID, 'app', false);
        expect(ro).toContain('hmap-out--hidden');
        expect(ro).not.toContain('data-hp-act="hide-location"');
    });

    it('the app: no switch for a house whose location the rule leaves out', () => {
        expect(page(houseTree(), HOUSE_ID, 'app')).not.toContain('hmap-out');
    });

    it('the file: the cuts as pictures beside the coordinates and links; hidden by hand: none of it', () => {
        const data = houseTree();
        const today = { view: 'today', label: 'Dnes', src: 'data:image/png;base64,AAAA', width: 600, height: 300,
            attribution: '© přispěvatelé OpenStreetMap, licence ODbL', attributionUrl: 'https://www.openstreetmap.org/copyright' };
        const layer = { ...today, view: 'cz-ortho-1950', label: 'Letecké snímky 50. let', src: 'data:image/jpeg;base64,BBBB', attribution: 'Archiv · CC BY 4.0' };
        const html = page(data, OLD_HOUSE_ID, 'file', true, { mapShots: { today, layers: [layer] } });
        expect(html).toContain('<img class="hmap-shot-img" src="data:image/png;base64,AAAA"');
        expect(html).toContain('data:image/jpeg;base64,BBBB');
        expect(html).toContain('© přispěvatelé OpenStreetMap, licence ODbL');
        expect(html).toContain('49.6000° N, 15.3000° E');
        expect(html).toContain('Dnešní poloha · shoda čísla ověřená');
        expect(html).toContain('openstreetmap.org/?mlat=');
        expect(html).not.toMatch(/tile\.openstreetmap\.org/);
        // Without pictures (offline, nothing kept): the location in words, no error.
        const words = page(data, OLD_HOUSE_ID, 'file');
        expect(words).not.toContain('hmap-shot');
        expect(words).toContain('49.6000° N');
        data.houses![OLD_HOUSE_ID].hideLocation = true;
        const hidden = page(data, OLD_HOUSE_ID, 'file', true, { mapShots: { today, layers: [layer] } });
        expect(hidden).not.toContain('hmap-shot');
        expect(hidden).not.toContain('49.6000');
    });

    it('houseMapHtml: a file without a location has no pictures even when given', () => {
        const input = { mode: 'file', lang: 'en', house: houseOf(houseTree(), OLD_HOUSE_ID), research: null, location: null, layers: [],
            canEdit: false, hasResearch: false, shots: { today: { view: 'today', label: 'Today', src: 'data:x', width: 1, height: 1, attribution: 'a' }, layers: [] } } as HouseMapInput;
        expect(houseMapHtml(input)).toBe('');
    });
});

describe('the book: "House locations" (spec 145 T3)', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
    afterEach(() => { vi.useRealTimers(); });

    const opts = (houseMaps?: boolean) => ({
        ...defaultBookOptions('cs'), selection: { kind: 'tree' } as const, privacy: 'full' as const,
        parts: { ...defaultBookOptions('cs').parts, houses: true }, ...(houseMaps === undefined ? {} : { houseMaps }),
    });
    const env = { now: HOUSE_NOW, houseResearch: (h: TreeHouse) => (h.id === HOUSE_ID ? houseResearch() : null) };
    const shot = { view: 'today', label: 'Dnes', src: 'data:image/png;base64,CCCC', width: 600, height: 300, attribution: '© přispěvatelé OpenStreetMap, licence ODbL' };
    const chapter = (html: string): string => html.slice(html.indexOf('id="book-houses"'), html.indexOf('</section>', html.indexOf('id="book-houses"')));
    const houseCh = (ch: string, id: string): string => {
        const at = ch.indexOf(`id="kap-dum-${id.replace(/[^a-z0-9]+/gi, '-')}"`);
        return ch.slice(at, ch.indexOf('<div class="book-house-ch"', at + 10) > 0 ? ch.indexOf('<div class="book-house-ch"', at + 10) : undefined);
    };

    it('on by default: the old house with its cut, coordinates, certainty and attribution; the house with the living without', () => {
        expect(bookHouseMaps(defaultBookOptions('cs'))).toBe(true);
        const ch = chapter(buildFamilyBook(houseTree(), opts(), { dateLabel: 'x', ...env, houseMapShot: h => (h.id === OLD_HOUSE_ID ? shot : null) }));
        const old = houseCh(ch, OLD_HOUSE_ID);
        expect(old).toContain('<img class="book-house-map-img" src="data:image/png;base64,CCCC"');
        expect(old).toContain('49.6000° N, 15.3000° E · Dnešní poloha · shoda čísla ověřená');
        expect(old).toContain('© přispěvatelé OpenStreetMap, licence ODbL');
        const living = houseCh(ch, HOUSE_ID);
        expect(living).not.toContain('book-house-map');
        expect(living).not.toContain('49.5');
    });

    it('no picture (offline, nothing kept): coordinates and certainty only', () => {
        const ch = chapter(buildFamilyBook(houseTree(), opts(), { dateLabel: 'x', ...env }));
        expect(houseCh(ch, OLD_HOUSE_ID)).toContain('book-house-map--words');
        expect(houseCh(ch, OLD_HOUSE_ID)).not.toContain('<img');
    });

    it('off: the town only; hidden by hand: none either', () => {
        const off = chapter(buildFamilyBook(houseTree(), opts(false), { dateLabel: 'x', ...env, houseMapShot: () => shot }));
        expect(off).not.toContain('book-house-map');
        expect(off).not.toContain('49.6000');
        expect(off).toContain('Události po roce 1925 a poloha domu se v knize neuvádějí.');
        const data = houseTree();
        data.houses![OLD_HOUSE_ID].hideLocation = true;
        const hidden = chapter(buildFamilyBook(data, opts(), { dateLabel: 'x', ...env, houseMapShot: () => shot }));
        expect(hidden).not.toContain('book-house-map');
    });

    it('the switch is offered only for a chapter with a house whose location may show', () => {
        const data = houseTree();
        expect(bookHouseMapsState(data, opts(), env)).toMatchObject({ shown: true });
        expect([...bookHouseMapsState(data, opts(), env).houses]).toEqual([OLD_HOUSE_ID]);
        expect(bookHouseMapsState(data, { ...opts(), parts: { ...opts().parts, houses: false } }, env).shown).toBe(false);
        data.houses![OLD_HOUSE_ID].hideLocation = true;
        expect(bookHouseMapsState(data, opts(), env).shown).toBe(false);
    });

    it('the estimate: a page share for each house shown with its map', () => {
        const data = houseTree();
        const houses = collectHouses(data);
        const withMap = housesWithLocation(data, houses, env);
        expect(housesChapterPages(houses, withMap) - housesChapterPages(houses)).toBeCloseTo(HOUSE_MAP_PAGES * withMap.size);
        expect(estimateBook(data, opts(), env).pages).toBeGreaterThanOrEqual(estimateBook(data, opts(false), env).pages);
    });

    it('remembered like the other options', () => {
        const mem = new Map<string, string>();
        const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
        saveBookMemory(storage as Storage, 't1' as never, opts(false));
        const back = bookOptionsFromMemory('cs', loadBookMemory(storage as Storage, 't1' as never), { kind: 'tree' });
        expect(back.houseMaps).toBe(false);
        expect(bookOptionsFromMemory('cs', null, { kind: 'tree' }).houseMaps).toBeUndefined();
    });
});
