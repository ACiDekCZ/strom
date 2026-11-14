/**
 * The family pages' bar, search and indexes (spec 026 §3.1, §3.4, §3.5): the
 * file's script normalizes and searches as the app does (one sample of
 * names with "Ch", ß, ł, ø), the exact surname first, the protected living
 * found by nothing of their name, the bar and the results' texts in the file,
 * the indexes' tabs, letters (Ch after H in Czech), families, surnames and
 * places, and the lineage header's places leading to the index of places.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PageSet, buildPageSet, pageSetPlaces } from '../family-pages.js';
import { buildPageSetHtml, indexLetter, pageSetBarHtml, pageSetSearchHtml, pageSetSectionHtml } from '../family-pages-html.js';
import { PAGE_SET_SEARCH_JS, pluralTemplates, searchPageSetIndex } from '../family-pages-search.js';
import { normalizeSearchText } from '../name-search.js';
import { buildLineages, rods, RodId } from '../lineage.js';
import { StromData } from '../types.js';
import { setLanguage, strings } from '../strings.js';
import { familyPagesFixture, FP_NOW } from './helpers/family-pages-fixture.js';

afterEach(() => setLanguage('cs'));

interface ScriptSearch {
    spNorm(text: string): string;
    spSearch(index: unknown, query: string, lang: string, max: number): { hits: { n: string }[]; total: number };
}

const script = new Function(`${PAGE_SET_SEARCH_JS}; return { spNorm: spNorm, spSearch: spSearch };`)() as ScriptSearch;

function rodsSet(data: StromData, lang: 'cs' | 'en' | 'de' = 'cs'): PageSet {
    const rodIds: RodId[] = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
    return buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang, now: FP_NOW });
}

/** The fixture with two wives married in under C and Ch (Czech: C … H, Ch, I …). */
function chFixture(): ReturnType<typeof familyPagesFixture> {
    const fx = familyPagesFixture();
    fx.data.persons['rozina' as never].lastName = 'Chmurná';
    fx.data.persons['ludmila' as never].lastName = 'Cvrčková';
    return fx;
}

function section(html: string, slug: string): string {
    const at = html.search(new RegExp(`<section class="sp-page sp-page--[a-z]+" id="${slug}"`));
    expect(at, `section ${slug}`).toBeGreaterThan(-1);
    const next = html.indexOf('<section class="sp-page sp-page--', at + 10);
    return html.slice(at, next < 0 ? html.indexOf('</main>') : next);
}

/** A safety net for a loaded machine (the full suite with other runs beside it); the tests check no time. */
const LOADED_TIMEOUT = { timeout: 60_000 };

describe('the search (§3.4)', LOADED_TIMEOUT, () => {
    it('the file\'s script normalizes as the app (Ch, ß, ł, ø, æ, marks, punctuation, spaces)', () => {
        const sample = ['Chmurná', 'Straße', 'Łukasz Wałęsa', 'Søren Kierkegård', 'Ægir Œdipe', 'Đorđe Þór',
            "O'Brien-Smith", '  Jan   Fíšek  ', 'ŘEPÍKOVÁ', 'Mädchen Müller', 'Ångström 1902', 'ı ŀ ŧ ĸ ŋ ħ ð'];
        for (const s of sample) expect(script.spNorm(s), s).toBe(normalizeSearchText(s));
    });

    it('the file\'s script finds what the app finds, in the same order', () => {
        const set = rodsSet(chFixture().data);
        for (const q of ['fischek', 'fíšek', 'fis', 'jan', 'jan fis', 'eva', 'vrbatkova', 'lhot', 'chm', 'cvrc', 'kvapil', 'x', '  ']) {
            const app = searchPageSetIndex(set.searchIndex, q, 'cs');
            const file = script.spSearch(set.searchIndex, q, 'cs', 10);
            expect(file.total, q).toBe(app.total);
            expect(file.hits.map(h => h.n), q).toEqual(app.hits.map(h => h.n));
        }
    });

    it('the exact surname first: "fischek" gives Martin Fischek before the Fíšeks of the line\'s forms', () => {
        const set = rodsSet(familyPagesFixture().data);
        const res = searchPageSetIndex(set.searchIndex, 'fischek', 'cs');
        expect(res.hits[0].n).toBe('Martin Fischek');
        expect(res.total).toBeGreaterThan(1);
        expect(res.hits.length).toBeLessThanOrEqual(10);
        // Every token the start of a word: "fis" finds, "isek" does not.
        expect(searchPageSetIndex(set.searchIndex, 'isek', 'cs').total).toBe(0);
    });

    it('a birth surname finds the married woman; the protected Eva is found by nothing of her name', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data);
        const terezie = searchPageSetIndex(set.searchIndex, 'vrbatkova', 'cs').hits.map(h => h.s);
        expect(terezie).toContain(set.personSlug.get(ids.terezie));
        const eva = searchPageSetIndex(set.searchIndex, 'eva', 'cs');
        expect(eva.hits.map(h => h.n)).not.toContain('Eva Fíšková');
        expect(eva.total).toBe(0);
    });

    it('in the window: up to ten rows as buttons, the protected as text, "N more in the index", nothing found explained', () => {
        const set = rodsSet(familyPagesFixture().data);
        const html = pageSetSearchHtml(set, 'f');
        const total = searchPageSetIndex(set.searchIndex, 'f', 'cs').total;
        expect(total).toBeGreaterThan(10);
        expect(html.match(/class="sp-res-row"/g)).toHaveLength(10);
        expect(html).toContain('data-sp-open="person:');
        expect(html).toContain(`a dalších ${total - 10} v rejstříku →`);
        expect(html).not.toContain('href=');
        const none = pageSetSearchHtml(set, 'eva');
        expect(none).toContain('Pro „eva“ se nic nenašlo.');
        expect(none).toContain('Jména žijících osob jsou chráněná.');
        expect(none).toContain('Rejstřík osob →');
        expect(pageSetSearchHtml(set, '   ')).toBe('');
    });

    it('the counts for the script: a template per plural category', () => {
        const t = pluralTemplates('cs', n => strings.familyPages.searchResults(n, '{q}'));
        expect(t.one).toBe('1 výsledek pro „{q}“'.replace('1', '{n}'));
        expect(t.few).toBe('{n} výsledky pro „{q}“');
        expect(t.other).toBe('{n} výsledků pro „{q}“');
    });
});

describe('the bar (§3.1)', LOADED_TIMEOUT, () => {
    it('the file: one bar before the pages, the field, Index, Map of places, Menu with the indexes; no map link without a map', () => {
        const set = rodsSet(familyPagesFixture().data);
        const html = buildPageSetHtml(set);
        expect(html.match(/<div class="sp-fbar">/g)).toHaveLength(1);
        const bar = html.slice(html.indexOf('<div class="sp-fbar">'), html.indexOf('<main '));
        expect(bar).toContain('class="sp-fbar-home" href="#uvod"');
        expect(bar).toContain('placeholder="Hledat jméno…"');
        expect(bar).toContain('data-sp-nav="index"');
        expect(bar).toContain('data-sp-nav="map" class="sp-fbar-a sel-tab" data-sel-dir="down" href="#mapa-obci"');
        expect(bar).toContain('href="#rejstrik-osoby"');
        expect(bar).toContain('href="#rejstrik-obce"');
        expect(bar).toContain('>Menu</button>');
        expect(html).toContain('<div class="sp-results" id="sp-results" aria-live="polite" hidden></div>');
        const strs = JSON.parse(html.match(/<script type="application\/json" id="sp-strings">([^<]*)<\/script>/)![1]);
        expect(strs.idx).toBe('rejstrik-osoby');
        expect(strs.res.few).toContain('{n}');
        expect(strs.none).toContain('{q}');
        // Without positions there is no map, so no link to it.
        const noGeo = buildPageSetHtml(rodsSet({ ...familyPagesFixture().data, places: {} }));
        expect(noGeo).not.toContain('data-sp-nav="map"');
    });

    it('the window: buttons, the current index marked', () => {
        const set = rodsSet(familyPagesFixture().data);
        const bar = pageSetBarHtml(set, 'rejstrik-rodiny');
        expect(bar).not.toContain('href=');
        expect(bar).toMatch(/<button aria-current="page" data-sp-nav="index" type="button" class="sp-fbar-a"|<button aria-current="page" type="button" class="sp-fbar-a" data-sp-open="page:rejstrik-osoby"|aria-current="page"[^>]*data-sp-nav="index"/);
    });
});

describe('the indexes (§3.5)', LOADED_TIMEOUT, () => {
    it('the four tabs on every index; the lineage\'s block links the four', () => {
        const set = rodsSet(familyPagesFixture().data);
        const html = buildPageSetHtml(set);
        for (const slug of ['rejstrik-osoby', 'rejstrik-rodiny', 'rejstrik-prijmeni', 'rejstrik-obce']) {
            const sec = section(html, slug);
            expect(sec.match(/class="sp-tab sel-tab"/g), slug).toHaveLength(4);
            expect(sec).toContain(`<span class="sp-tab sel-tab" data-sel-dir="down" aria-current="page"><span class="sel-l" data-label=`);
        }
        const rod = section(html, 'rod-fisek');
        for (const slug of ['rejstrik-osoby', 'rejstrik-rodiny', 'rejstrik-prijmeni', 'rejstrik-obce']) expect(rod).toContain(`href="#${slug}"`);
    });

    it('people by initial letter, Ch after H in Czech; the alphabet links its groups', () => {
        const set = rodsSet(chFixture().data);
        const sec = section(buildPageSetHtml(set), 'rejstrik-osoby');
        const letters = [...sec.matchAll(/<h2 class="sp-ix-letter">([^<]*)<\/h2>/g)].map(m => m[1]);
        expect(letters).toContain('Ch');
        expect(letters.indexOf('C')).toBeLessThan(letters.indexOf('H'));
        expect(letters.indexOf('H')).toBeLessThan(letters.indexOf('Ch'));
        expect(letters.indexOf('Ch')).toBeLessThan(letters.indexOf('K'));
        expect(sec).toContain('href="#rejstrik-osoby--pis-1" data-sp-letter="1"');
        expect(sec).toContain('Chmurná, Rozina');
        // The protected by the protected name, no link.
        expect(sec).not.toContain('Eva');
    });

    it('the initial letter: Ch in Czech only, the base letter where the language does not tell them apart', () => {
        expect(indexLetter('Chmurná', 'cs')).toBe('Ch');
        expect(indexLetter('chmurná', 'cs')).toBe('Ch');
        expect(indexLetter('Chmurná', 'en')).toBe('C');
        expect(indexLetter('Čapek', 'cs')).toBe('Č');
        expect(indexLetter('Čapek', 'en')).toBe('C');
        expect(indexLetter('Österreicher', 'de')).toBe('O');
        expect(indexLetter('Řepík', 'cs')).toBe('Ř');
    });

    it('a letter with a stroke (Ł, Ø, Đ) goes under its base letter, Polish keeps Ł its own', () => {
        for (const lang of ['cs', 'en', 'de'] as const) {
            expect(indexLetter('Łopatnicki', lang)).toBe('L');
            expect(indexLetter('łopatnicki', lang)).toBe('L');
            expect(indexLetter('Ørsted', lang)).toBe('O');
            expect(indexLetter('Đuro', lang)).toBe('D');
            expect(indexLetter('Śmigulski', lang)).toBe('S');
        }
        expect(indexLetter('Łopatnicki', 'pl')).toBe('Ł');
        expect(indexLetter('Ørsted', 'pl')).toBe('O');
        expect(indexLetter('Đuro', 'pl')).toBe('D');
    });

    it('families: only those with a page; surnames: the forms per line and the birth surnames of the wives', () => {
        const set = rodsSet(familyPagesFixture().data);
        const html = buildPageSetHtml(set);
        const fam = section(html, 'rejstrik-rodiny');
        const famSlugs = [...set.bySlug.values()].filter(p => p.kind === 'family').map(p => p.slug);
        const linked = [...fam.matchAll(/href="#([^"]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('rejstrik-') && s !== 'uvod');
        expect(new Set(linked)).toEqual(new Set(famSlugs));
        const sur = section(html, 'rejstrik-prijmeni');
        expect(sur).toContain('Fischek');
        expect(sur).toContain('Fyšek');
        expect(sur).toContain('Rodná příjmení přivdaných');
        expect(sur).toContain('Hrabánková');
        expect(sur).toContain('<details class="sp-ix-more"');
    });

    it('places: dated records of people with a page, the protected left out; the lineage header leads there', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data);
        const rows = pageSetPlaces(set);
        expect(rows[0].name).toBe('Čapkov');
        for (const r of rows) {
            expect(r.personIds).not.toContain(ids.eva);
            expect(r.from).toBeLessThanOrEqual(r.to);
        }
        const html = buildPageSetHtml(set);
        const obce = section(html, 'rejstrik-obce');
        expect(obce).toContain('id="rejstrik-obce--o-1"');
        expect(obce).toMatch(/<span class="sp-ix-n">Čapkov<\/span> <span class="sp-ix-dot" aria-hidden="true">·<\/span> <span class="sp-ix-y">\d{4}–\d{4}<\/span>/);
        // With a map the header leads to the map (family-pages-map.test.ts); without one to the index.
        const plain = rodsSet({ ...data, places: {} });
        const rod = section(buildPageSetHtml(plain), 'rod-fisek');
        expect(rod).toContain('<a class="pp-link sp-place" href="#rejstrik-obce--o-1" data-sp-place="capkov">Čapkov</a>');
        // The window: the places index as a button.
        const win = pageSetSectionHtml(plain, 'rod-fisek');
        expect(win).toContain('data-sp-open="page:rejstrik-obce" data-sp-place="capkov"');
    });

    it('places: the spellings of one research place are one row', () => {
        const { data } = familyPagesFixture();
        const before = pageSetPlaces(rodsSet(data)).find(r => r.name === 'Čapkov')!;
        let n = 0;
        for (const p of Object.values(data.persons)) if (p.birthPlace === 'Čapkov' && n++ % 2 === 0) p.birthPlace = 'Capkow';
        expect(n).toBeGreaterThan(1);
        expect(pageSetPlaces(rodsSet(data)).some(r => r.name === 'Capkow')).toBe(true);
        data.placeRecords = { L0001: { id: 'L0001', names: [{ name: 'Čapkov' }] } };
        data.placeRefs = { capkov: 'L0001', capkow: 'L0001' };
        const rows = pageSetPlaces(rodsSet(data));
        const row = rows.find(r => r.name === 'Čapkov')!;
        expect(row).toMatchObject({ key: 'capkov', alsoKeys: ['capkow'], from: before.from, to: before.to });
        expect(new Set(row.personIds)).toEqual(new Set(before.personIds));
        expect(rows.some(r => r.name === 'Capkow')).toBe(false);
    });

    it('in English: the same indexes, no Czech letter rule', () => {
        setLanguage('en');
        const set = rodsSet(chFixture().data, 'en');
        const html = buildPageSetHtml(set);
        const people = [...set.bySlug.values()].find(p => p.kind === 'index' && p.id === 'persons')!;
        const sec = section(html, people.slug);
        const letters = [...sec.matchAll(/<h2 class="sp-ix-letter">([^<]*)<\/h2>/g)].map(m => m[1]);
        expect(letters).not.toContain('Ch');
        expect(html).toContain('placeholder="Search name…"'.replace('Search name…', strings.familyPages.searchPh));
    });
});
