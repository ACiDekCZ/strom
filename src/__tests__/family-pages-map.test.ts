/**
 * The family pages' map of places (spec 026 §3.7): the places of the line's
 * people grouped by place (people, period), no protected living and no
 * wedding with one; the map page only when asked for and when the places
 * make a map (else no page and the places of a lineage's header lead to the
 * index of places); points sized by their people, no path; a lineage's
 * header leads to the map; the person page's own map unchanged.
 */

import { describe, it, expect } from 'vitest';
import { PageSet, buildPageSet } from '../family-pages.js';
import { buildPageSetHtml, pageSetRenderedPages, pageSetSectionHtml } from '../family-pages-html.js';
import { collectRodPlacePoints, rodPlacePointSize } from '../person-page-map.js';
import { placeKey } from '../places.js';
import { buildLineages, rods } from '../lineage.js';
import { PersonId, StromData } from '../types.js';
import { familyPagesFixture, FP_NOW } from './helpers/family-pages-fixture.js';

function rodsSet(data: StromData, extra: Partial<Parameters<typeof buildPageSet>[2]> = {}): PageSet {
    const rodIds = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
    return buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'cs', now: FP_NOW, ...extra });
}

/** The page section of a slug: up to the next page section. */
function section(html: string, slug: string): string {
    const open = html.lastIndexOf('<section class="sp-page', html.indexOf(`" id="${slug}"`));
    const next = html.indexOf('<section class="sp-page', open + 1);
    return html.slice(open, next < 0 ? html.length : next);
}

describe('collectRodPlacePoints (§3.7)', () => {
    it('groups the people\'s own dated events by place: people, period, the most frequent spelling', () => {
        const { data } = familyPagesFixture();
        const all = Object.keys(data.persons) as PersonId[];
        const pts = collectRodPlacePoints(data, all);
        const capkov = pts.find(p => p.placeKey === placeKey('Čapkov'))!;
        expect(capkov.place).toBe('Čapkov');
        expect(capkov.personIds).toContain('jan');
        expect(capkov.from).toBe(1702);
        expect(capkov.yearLabel).toBe(`1702–${capkov.to}`);
        // One point per place, in the order of the first year.
        expect(new Set(pts.map(p => p.placeKey)).size).toBe(pts.length);
        expect(pts.map(p => p.from)).toEqual([...pts.map(p => p.from)].sort((a, b) => a - b));
        // Rozina was born in Hrabanov.
        expect(pts.find(p => p.placeKey === placeKey('Hrabanov'))!.personIds).toContain('rozina');
    });

    it('a hidden person gives nothing, nor does a wedding with one', () => {
        const { data, ids } = familyPagesFixture();
        const all = Object.keys(data.persons) as PersonId[];
        const hidden = new Set<PersonId>([ids.eva, ids.petr]);
        const pts = collectRodPlacePoints(data, all, { hidden: id => hidden.has(id) });
        for (const p of pts) for (const id of hidden) expect(p.personIds).not.toContain(id);
        // Petr alone: his birth in Řepíkov; the wedding of 1975 in Čapkov only while Eva is not hidden.
        const keys = (list: typeof pts) => list.map(p => p.placeKey);
        const open = collectRodPlacePoints(data, [ids.petr]);
        expect(keys(open)).toEqual([placeKey('Řepíkov'), placeKey('Čapkov')]);
        expect(open[1].from).toBe(1975);
        const shut = collectRodPlacePoints(data, [ids.petr], { hidden: id => id === ids.eva });
        expect(keys(shut)).toEqual([placeKey('Řepíkov')]);
    });

    it('a point grows with the square root of its people', () => {
        expect(rodPlacePointSize(1)).toBe(22);
        expect(rodPlacePointSize(4)).toBe(26);
        expect(rodPlacePointSize(9)).toBe(30);
        expect(rodPlacePointSize(1000)).toBe(40);
    });
});

describe('the map of places in the file (§3.7)', () => {
    it('a page with sized points, no path, a row per place with its people; no protected living', () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data);
        expect(pageSetRenderedPages(set).some(p => p.kind === 'map')).toBe(true);
        const html = buildPageSetHtml(set);
        const map = section(html, set.mapSlug);
        expect(map).toContain('class="sp-page sp-page--map"');
        expect(map).toContain(`id="${set.mapSlug}--pp-sec-places"`);
        expect(map).toContain('<h1 class="sp-h1">Mapa obcí</h1>');
        expect(map).toContain('Obrysy jsou součástí souboru, mapa funguje bez internetu.');
        expect(map).not.toContain('pp-map-route');
        const pts = [...map.matchAll(/class="pp-map-pt[^"]*sp-map-sz" style="[^"]*--pt:(\d+)px"/g)].map(m => Number(m[1]));
        expect(pts.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...pts)).toBeGreaterThan(Math.min(...pts));
        const capkov = map.match(/<li class="pp-map-row[^"]*"[^>]*data-pp-map-place="capkov"[^>]*>.*?<\/li>/)?.[0] ?? '';
        expect(capkov).toMatch(/Čapkov<\/b> · <span class="pp-map-ev">1702–\d{4} · \d+ osob<\/span>/);
        expect(capkov).toContain('<span class="sp-map-people">');
        expect(capkov).toContain(`href="#${set.personSlug.get('josef' as PersonId)}"`);
        // The protected living: no name, no year of theirs.
        expect(map).not.toMatch(/\bEva\b|Petr\b/);
        // The bar, the menu and the lineage's teaser lead to the map; the map's script is in the file.
        expect(html).toContain(`<a data-sp-nav="map" class="sp-fbar-a" href="#${set.mapSlug}">`);
        expect(html).toContain(`<a class="sp-menu-a" href="#${set.mapSlug}">`);
        expect(html).toContain(`<a class="sp-btn" href="#${set.mapSlug}">`);
        expect(html).toMatch(/<script>\(function\(\)\{var d=document;\nfunction sel\(/);
    });

    it('the places of a lineage\'s header lead to the map', () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data);
        const html = buildPageSetHtml(set);
        const rod = section(html, set.rodSlug.values().next().value!);
        expect(rod).toContain(`<a class="pp-link sp-place" href="#${set.mapSlug}" data-sp-place="capkov">Čapkov</a>`);
        // In the app's window: a button to the map page.
        const app = pageSetSectionHtml(set, set.rodSlug.values().next().value!);
        expect(app).toContain(`data-sp-open="page:${set.mapSlug}" data-sp-place="capkov"`);
        expect(pageSetSectionHtml(set, set.mapSlug)).toContain('sp-page--map');
    });

    it('no map without the choice or without positions: no page, the places lead to the index of places', () => {
        const { data } = familyPagesFixture();
        const off = rodsSet(data, { map: false });
        expect(pageSetRenderedPages(off).some(p => p.kind === 'map')).toBe(false);
        const noGeo = rodsSet({ ...data, places: {} });
        expect(noGeo.mapSlug).not.toBe('');
        expect(pageSetRenderedPages(noGeo).some(p => p.kind === 'map')).toBe(false);
        const html = buildPageSetHtml(noGeo);
        expect(html).not.toContain('class="sp-page sp-page--map"');
        expect(html).not.toContain('data-sp-nav="map"');
        expect(html).toMatch(/<a class="pp-link sp-place" href="#rejstrik-obce--o-\d+" data-sp-place="capkov">/);
    });
});
