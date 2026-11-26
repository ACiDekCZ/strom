/**
 * The map of a house (spec 030 §4, K7.2): the layer switch only from the
 * research's layers (`/status.houses.layers`) the house refers to or whose
 * frame holds its point, a layer in a system the app cannot draw left out,
 * the WMS tiles in Web Mercator, the attribution with its licence, the line
 * under the map, and the saved file without any map server (K3.3).
 */
import { describe, expect, it } from 'vitest';
import type { HouseResearch } from '../house-bridge.js';
import type { LiveHouseLayer } from '../research-link.js';
import type { TreeHouse } from '../houses.js';
import {
    houseMapAttribution, houseMapHtml, houseMapViews, housePointLabel, housePositionText, houseLocationUnsure,
    houseImageUrl, tileBox3857, wmsGetMapUrl, wmsTileUrl, type HouseMapInput,
} from '../house-map.js';
import { wgs84ToSjtsk } from '../sjtsk.js';

const ORTHO: LiveHouseLayer = {
    id: 'cz-ortho', kind: 'ortho', label: 'Ortofoto ČR (dnes)', type: 'wms',
    url: 'https://ortho.example.org/wms', layers: '0', format: 'image/jpeg',
    attribution: '© Zeměměřický ústav Brodek', license: 'CC BY 4.0', bbox: [12, 48.5, 19, 51],
};
const AERIAL: LiveHouseLayer = {
    id: 'cz-ortho-1950', kind: 'ortho-1950', label: 'Letecké snímky 50. let', type: 'wms',
    url: 'https://aerial.example.org/wms', layers: 'orto', format: 'image/jpeg', crs: 'EPSG:5514',
    attribution: 'Archiv leteckých snímků Brodek', license: 'CC BY 4.0', bbox: [12, 48.5, 19, 51],
};
const ELSEWHERE: LiveHouseLayer = { ...ORTHO, id: 'far', kind: 'ortho', bbox: [100, 10, 101, 11] };
const OTHER_CRS: LiveHouseLayer = { ...ORTHO, id: 'gk', crs: 'EPSG:31468' };

const POINT = { lat: 49.6118, lng: 15.2251 };

const house = { id: 'belokamen|16', text: 'čp. 16', ref: { town: 'Bělokamen', house: 'čp. 16' } } as unknown as TreeHouse;

function research(init: Partial<HouseResearch> = {}): HouseResearch {
    return {
        id: 'A0001', key: 'belokamen|16', maps: [], location: { lat: POINT.lat, lon: POINT.lng, certainty: 'medium', how: 'old-map', confirmed: null, sources: [] },
        ...init,
    } as unknown as HouseResearch;
}

function input(init: Partial<HouseMapInput> = {}): HouseMapInput {
    return { mode: 'app', lang: 'en', house, research: research(), location: POINT, layers: [ORTHO], canEdit: true, hasResearch: true, ...init };
}

describe('house map — the layer switch', () => {
    it('today first, then a research layer whose frame holds the point; one elsewhere left out', () => {
        const views = houseMapViews([ORTHO, ELSEWHERE], research(), POINT, 'en');
        expect(views.map(v => [v.id, v.kind, v.label])).toEqual([['today', 'today', 'Today'], ['cz-ortho', 'tiles', 'Orthophoto today']]);
    });

    it('a layer the house refers to (maps[].layer) is offered even without a point', () => {
        const r = research({ maps: [{ id: 'm2', kind: 'ortho', layer: 'far' }] });
        expect(houseMapViews([ELSEWHERE], r, null, 'cs').map(v => v.label)).toEqual(['Dnes', 'Ortofoto dnes']);
    });

    it('a layer in a system the app cannot draw (crs) is left out', () => {
        expect(houseMapViews([OTHER_CRS], research(), POINT, 'en').map(v => v.id)).toEqual(['today']);
        expect(houseMapViews([AERIAL], research(), POINT, 'en', []).map(v => v.id)).toEqual(['today']);
    });

    it('the aerial photos of the 1950s in S-JTSK: their own picture of the place, after the tiles', () => {
        const views = houseMapViews([AERIAL, ORTHO], research(), POINT, 'cs');
        expect(views.map(v => [v.id, v.kind, v.label])).toEqual([
            ['today', 'today', 'Dnes'], ['cz-ortho', 'tiles', 'Ortofoto dnes'], ['cz-ortho-1950', 'image', 'Letecké 50. léta']]);
    });

    it('a layer with an address that is not https is left out', () => {
        expect(houseMapViews([{ ...ORTHO, url: 'javascript:alert(1)' }], research(), POINT, 'en').map(v => v.id)).toEqual(['today']);
    });
});

describe('house map — WMS', () => {
    it('a tile asks the service in Web Mercator with the tile frame', () => {
        expect(tileBox3857({ x: 0, y: 0, z: 0 }).map(Math.round)).toEqual([-20037508, -20037508, 20037508, 20037508]);
        const url = new URL(wmsTileUrl(ORTHO, { x: 1, y: 0, z: 1 }));
        expect(url.origin + url.pathname).toBe('https://ortho.example.org/wms');
        expect(url.searchParams.get('CRS')).toBe('EPSG:3857');
        expect(url.searchParams.get('REQUEST')).toBe('GetMap');
        expect(url.searchParams.get('LAYERS')).toBe('0');
        expect(url.searchParams.get('BBOX')).toBe('0,0,20037508.34,20037508.34');
        expect(url.searchParams.get('WIDTH')).toBe('256');
    });

    it('1.1.1 names the system SRS; an address with a query gets "&"', () => {
        const url = wmsGetMapUrl({ ...ORTHO, url: 'https://ortho.example.org/wms?map=x' }, 'EPSG:5514', [-1, -2, 3, 4], 400, 280, '1.1.1');
        expect(url).toContain('?map=x&SERVICE=WMS&VERSION=1.1.1');
        expect(url).toContain('&SRS=EPSG:5514&BBOX=-1,-2,3,4&WIDTH=400&HEIGHT=280');
    });

    it('the picture of the place: a GetMap in EPSG:5514 of 400 × 280 m with the house in the middle', () => {
        const url = new URL(houseImageUrl(AERIAL, POINT, 400, 280, 800, 560)!);
        expect(url.origin + url.pathname).toBe('https://aerial.example.org/wms');
        expect(url.searchParams.get('CRS')).toBe('EPSG:5514');
        expect(url.searchParams.get('LAYERS')).toBe('orto');
        expect(url.searchParams.get('WIDTH')).toBe('800');
        expect(url.searchParams.get('HEIGHT')).toBe('560');
        const [minx, miny, maxx, maxy] = url.searchParams.get('BBOX')!.split(',').map(Number);
        const p = wgs84ToSjtsk(POINT.lat, POINT.lng);
        expect(maxx - minx).toBeCloseTo(400, 0);
        expect(maxy - miny).toBeCloseTo(280, 0);
        expect(Math.abs((minx + maxx) / 2 - p.x)).toBeLessThan(0.02);
        expect(Math.abs((miny + maxy) / 2 - p.y)).toBeLessThan(0.02);
        expect(maxx).toBeLessThan(0);
        expect(houseImageUrl(OTHER_CRS, POINT, 400, 280, 800, 560)).toBeNull();
    });

    it('the attribution goes whole with its licence; today is OpenStreetMap', () => {
        expect(houseMapAttribution({ id: 'cz-ortho', kind: 'tiles', label: '', layer: ORTHO }).text).toBe('© Zeměměřický ústav Brodek · CC BY 4.0');
        expect(houseMapAttribution({ id: 'today', kind: 'today', label: '' }).text).toContain('OpenStreetMap');
    });
});

describe('house map — the section', () => {
    it('the app: the switch, the point with the number, the attribution, Confirm and Move for an unsure point, manual maps', () => {
        const r = research({ maps: [{ id: 'm1', kind: 'cadastre', url: 'https://archiv.example.org/skica/12', manual: true, sheet: 'list 2' }] });
        const html = houseMapHtml(input({ research: r }));
        expect(html).toContain('data-hmap-view="today"');
        expect(html).toContain('data-hmap-view="cz-ortho"');
        expect(html).toContain('class="hpt main"');
        expect(html).toMatch(/>16<\/span>/);
        expect(html).toContain('Location uncertain (the number may have changed)');
        expect(html).toContain('data-hmap-act="confirm"');
        expect(html).toContain('data-hmap-act="move"');
        expect(html).toContain('To open by hand:');
        expect(html).toContain('Cadastral map, list 2 ↗');
        expect(html).toContain('OpenStreetMap');
    });

    it('without research layers: no switch, the quiet sentence; without a research nothing', () => {
        expect(houseMapHtml(input({ layers: [] }))).toContain('Today’s map only; the research has no other layers for this country.');
        const none = houseMapHtml(input({ layers: [], research: null, hasResearch: false }));
        expect(none).not.toContain('hmap-note');
        expect(none).not.toContain('sel-seg');
    });

    it('a house without a point shows the town and says so; nothing without either', () => {
        const html = houseMapHtml(input({ location: null, town: { lat: 49.6, lng: 15.2 } }));
        expect(html).toContain('hpt town');
        expect(html).toContain('The house location is not known; the town is shown.');
        expect(houseMapHtml(input({ location: null, town: null }))).toBe('');
    });

    it('a read-only tree has no actions', () => {
        expect(houseMapHtml(input({ canEdit: false }))).not.toContain('data-hmap-act');
    });

    it('the line under the map: by hand, confirmed, sure by today\'s number, sure otherwise', () => {
        expect(housePositionText({ lang: 'en', location: POINT, how: 'manual', research: research() })).toBe('Location placed by hand');
        expect(housePositionText({ lang: 'en', location: POINT, how: 'confirmed', research: research() })).toBe('Location confirmed');
        const high = (how: string) => research({ location: { lat: 1, lon: 2, certainty: 'high', how, confirmed: null, sources: [] } });
        expect(housePositionText({ lang: 'cs', location: POINT, research: high('today-number') })).toBe('Poloha podle dnešního čísla domu · jistota vysoká');
        expect(housePositionText({ lang: 'en', location: POINT, research: high('old-map') })).toBe('Location from the research · high certainty');
        expect(houseLocationUnsure({ location: POINT, research: high('old-map') })).toBe(false);
        expect(houseLocationUnsure({ location: POINT, how: 'manual', research: research() })).toBe(false);
    });

    it('the saved file: no map server, the location in words with a link; nothing without a location (K3.3)', () => {
        const html = houseMapHtml(input({ mode: 'file' }));
        expect(html).not.toContain('hmap-tiles');
        expect(html).not.toContain('data-hmap');
        expect(html).not.toContain('example.org/wms');
        expect(html).toContain('49.6118° N, 15.2251° E');
        expect(html).toContain('href="https://www.openstreetmap.org/?mlat=49.61180&amp;mlon=15.22510#map=18/49.61180/15.22510"');
        expect(houseMapHtml(input({ mode: 'file', location: null, town: { lat: 49.6, lng: 15.2 } }))).toBe('');
    });

    it('the point label leaves out the "čp." and keeps a street', () => {
        expect(housePointLabel('čp. 16')).toBe('16');
        expect(housePointLabel('č. p. 7')).toBe('7');
        expect(housePointLabel('Kopřivná 12')).toBe('Kopřivná 12');
    });
});
