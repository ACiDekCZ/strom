/**
 * The family pages' file (spec 026 §0.2, §1, §5, §8): one frame, a section
 * per page, ids unique and every in-file link landing, the hub, the lineage
 * and the branch, the protected living without a page or a name, an image
 * shared by two pages once, nothing from the internet, the window's single
 * page, and the time of a set of some five hundred people. The unchanged
 * person page and book: family-pages-snapshot.test.ts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PageSet, buildPageSet } from '../family-pages.js';
import { buildPageSetHtml, buildPageSetHtmlAsync, pageSetRenderedPages, pageSetSectionHtml } from '../family-pages-html.js';
import { PAGE_SET_SCRIPT } from '../family-pages-css.js';
import { buildLineages, rods, RodId } from '../lineage.js';
import { StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { familyPagesFixture, FP_NOW, CLIP_IMG } from './helpers/family-pages-fixture.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { calibrationWorkload, normalizedMs } from './helpers/perf-budget.js';

/** Calibration rounds for the set's budget: about as long as building the set of 500 people. */
const SET_CALIBRATION_ROUNDS = 40;
/** Best time of those rounds on the reference machine at rest (Apple M-series laptop). */
const SET_CALIBRATION_REFERENCE_MS = 212;

afterEach(() => setLanguage('cs'));

function fixtureRods(data: StromData): RodId[] {
    return rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
}

function rodsSet(data: StromData, rodIds = fixtureRods(data), extra: Partial<Parameters<typeof buildPageSet>[2]> = {}): PageSet {
    return buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'cs', now: FP_NOW, ...extra });
}

function idsOf(html: string): string[] {
    return [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
}

/** The section of a slug (sections never nest). */
function section(html: string, slug: string): string {
    const start = html.indexOf(`<section class="sp-page sp-page--`);
    expect(start).toBeGreaterThan(-1);
    const at = html.search(new RegExp(`<section class="sp-page sp-page--[a-z]+" id="${slug}"`));
    expect(at, `section ${slug}`).toBeGreaterThan(-1);
    const next = html.indexOf('<section class="sp-page sp-page--', at + 10);
    return html.slice(at, next < 0 ? html.indexOf('</main>') : next);
}

function expectWellFormed(html: string, set: PageSet): void {
    // One document, one frame.
    expect(html.match(/<html /g)).toHaveLength(1);
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('<html lang="cs" class="no-js">');
    const ids = idsOf(html);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    expect(dup).toEqual([]);
    // Every in-file link lands on a section or an id inside one.
    const known = new Set(ids);
    const hrefs = [...new Set([...html.matchAll(/href="#([^"]*)"/g)].map(m => m[1]))];
    expect(hrefs.filter(h => !known.has(h))).toEqual([]);
    // A section per drawn page, in the set's order.
    const sections = [...html.matchAll(/<section class="sp-page sp-page--[a-z]+" id="([^"]+)"/g)].map(m => m[1]);
    expect(sections).toEqual(pageSetRenderedPages(set).map(p => p.slug));
    expect(html.match(/ data-sp-intro/g)).toHaveLength(1);
    // The scripts once each.
    expect(html.split(PAGE_SET_SCRIPT).length - 1).toBe(1);
    expect(html.match(/<script type="application\/json" id="sp-index">/g)).toHaveLength(1);
    // Nothing from the internet (the person page's printed URLs of sources would be text, none here).
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).not.toMatch(/url\(["']?https?:/);
    expect(html).not.toMatch(/@import/);
}

describe('the file of one lineage, several lineages, a branch (§0.2, §1)', () => {
    it('one lineage: the lineage is the introduction; the contents of the file come first; the person pages are the set\'s', () => {
        const { data, ids } = familyPagesFixture();
        const rodIds = fixtureRods(data);
        const set = rodsSet(data, [rodIds[0]]);
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        expect(set.introSlug).toBe('rod-fisek');
        const rod = section(html, 'rod-fisek');
        expect(rod).toContain(' data-sp-intro');
        expect(rod).toContain('<h1 class="sp-h1">Rod Fíšek</h1>');
        expect(rod).toContain('id="rod-fisek--sp-line"');
        expect(rod).toContain(`href="#${set.personSlug.get(ids.jan)}"`);
        // Index of people from the teaser.
        expect(rod).toContain(`<a class="sp-btn" href="#${set.indexSlug.persons}">`);
        // The contents without the script, before the first section.
        const toc = html.indexOf('<nav class="sp-toc-file"');
        expect(toc).toBeGreaterThan(-1);
        expect(toc).toBeLessThan(html.indexOf('<section class="sp-page'));
        // A person page carries the set's prefix and its breadcrumbs.
        const josef = set.personSlug.get(ids.josef)!;
        const page = section(html, josef);
        expect(page).toContain(`id="${josef}--pp-sec-family"`);
        expect(page).toMatch(/<nav class="sp-crumbs" aria-label="[^"]+"><a class="sp-crumb-back" href="#[^"]+">‹ /);
        expect(page).toContain('<a class="sp-crumb" href="#rod-fisek">Rod Fíšek</a>');
        // The print footer names the file.
        expect(html).toContain('<p class="sp-print-foot">Rod-Fisek.html · vytištěna jen tato stránka</p>');
        // The search index the script will read: the set's, parsable.
        const json = html.match(/<script type="application\/json" id="sp-index">([^<]*)<\/script>/)![1];
        expect(JSON.parse(json)).toEqual(set.searchIndex);
    });

    it('several lineages: the hub has a card per lineage and the marriages between them', () => {
        const { data, unions } = familyPagesFixture();
        const set = rodsSet(data);
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        const hub = section(html, 'uvod');
        expect(hub).toContain('<div class="sp-kicker">Soubor</div>');
        for (const id of set.rodIds) expect(hub).toContain(`<a class="sp-card" href="#${set.rodSlug.get(id)}">`);
        expect(hub).toContain('Sňatky mezi rody');
        // Josef Fíšek and Anna Kvapilová (f9): the family's page, both lineages named.
        expect(hub).toMatch(new RegExp(`<a class="pp-link" href="#${set.familySlug.get(unions.f9)}">[^<]+</a><span class="sp-cross-rods">Fíšek · Kvapil</span>`));
        // The lineages follow the hub, each with its breadcrumbs back to it.
        expect(section(html, 'rod-kvapil')).toContain('<a class="sp-crumb" href="#uvod">');
    });

    it('the hub card writes the founder like the lineage header: "asi" for an approximate birth, the place', () => {
        const { data } = familyPagesFixture();
        const set0 = rodsSet(data);
        const rod = set0.rodIds[0];
        const lineages = buildLineages(data);
        const founderId = rods(lineages).find(r => r.id === rod)!.founderId;
        data.persons[founderId].birthDate = '~1810';
        data.persons[founderId].birthPlace = 'Brdovice';
        const set = rodsSet(data);
        const html = buildPageSetHtml(set);
        const hub = section(html, 'uvod');
        const rodPage = section(html, set.rodSlug.get(rod)!);
        expect(rodPage).toContain(' (* asi 1810, Brdovice)');
        expect(hub).toContain(' (* asi 1810, Brdovice)');
    });

    it('without sources and without stories (the dialog\'s "Includes", §6.2): neither is in the file, the tree is untouched', () => {
        const { data } = familyPagesFixture();
        const someone = Object.values(data.persons).find(p => !p.isPlaceholder && !p.birthDate?.startsWith('20'))!;
        someone.story = { text: 'Mlýn v Brdovicích stál u potoka.', status: 'final' };
        const before = JSON.stringify(data);
        const full = buildPageSetHtml(rodsSet(data));
        expect(full).toContain('Mlýn v Brdovicích stál u potoka.');
        expect(full).toContain('class="pp-src"');
        const bare = buildPageSetHtml(rodsSet(data, undefined, { sources: false, stories: false }));
        expect(bare).not.toContain('Mlýn v Brdovicích');
        expect(bare).not.toContain('class="pp-src"');
        expect(JSON.stringify(data)).toBe(before);
    });

    it('a branch: descendants of the founder, the children of daughters included', () => {
        const { data, ids } = familyPagesFixture();
        const set = buildPageSet(data, { kind: 'descendants', person: ids.jan }, { lang: 'cs', now: FP_NOW });
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        const branch = section(html, set.introSlug);
        expect(branch).toContain('<div class="sp-kicker">Větev</div>');
        expect(branch).toContain(`<h1 class="sp-h1">${set.pages[0].title}</h1>`);
        // Dorota Fíšková's son by Tomáš Řepík is in the branch, as a link.
        const dorota = data.persons['dorota' as keyof typeof data.persons];
        expect(dorota.childIds.length).toBeGreaterThan(0);
        for (const c of dorota.childIds) expect(branch).toContain(`href="#${set.personSlug.get(c)}"`);
    });
});

describe('a family\'s page (§2.2)', () => {
    it('Josef and Anna: the kicker, ⚭ in the title, the other marriage, the partners, the marriage, the children', () => {
        const { data, ids, unions } = familyPagesFixture();
        const set = rodsSet(data, fixtureRods(data), { privacy: 'full' });
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        const f9 = set.familySlug.get(unions.f9)!, f10 = set.familySlug.get(unions.f10)!;
        const page = section(html, f9);
        expect(page).toMatch(/<div class="sp-kicker">Rodina · rod Fíšek, [IVX]+\. generace<\/div>/);
        expect(page).toContain('<h1 class="sp-h1">Josef Fíšek <span class="sp-sym">⚭</span> Anna Kvapilová</h1>');
        expect(page).toContain('<p class="sp-sub">⚭ 12. 2. 1846, Čapkov · 7 dětí</p>');
        // The repeated marriages: f9 leads to f10 and f10 back to f9.
        expect(page).toContain(`<span class="sp-other-pre">Josef Fíšek · 2. sňatek:</span><a class="pp-link" href="#${f10}">⚭ 1876 Terezie Lhotáková</a>`);
        expect(section(html, f10)).toContain(`<span class="sp-other-pre">Josef Fíšek · 1. sňatek:</span><a class="pp-link" href="#${f9}">⚭ 1846 Anna Kvapilová</a>`);
        // The partners: roles, facts, the lineage, the parents' family, the person page.
        expect(page).toContain('<span class="sp-role">manžel</span>');
        expect(page).toContain('<span class="sp-role">manželka</span>');
        expect(page).toContain('<dt>Povolání</dt><dd>rolník</dd>');
        expect(page).toContain(`<a class="sp-go" href="#${set.personSlug.get(ids.josef)}">Stránka osoby →</a>`);
        expect(page).toMatch(/<span class="sp-prow"><a class="pp-link" href="#rod-fisek">rod Fíšek, [IVX]+\. generace<\/a><\/span>/);
        expect(page).toMatch(/<span class="sp-prow">↑ rodina rodičů: (?:<a class="pp-link" href="#rodina-[^"]+">)?Jakub a Magdalena/);
        expect(page).toMatch(/class="pp-img sp-portrait img-\d+"/);
        // The marriage: date, place, the witness, the record's excerpt with its zoom.
        expect(page).toContain('<dt>Svědci</dt><dd>Jiří Vrbátek</dd>');
        expect(page).toContain(`<a class="sp-clip" href="#${f9}--obr-1"`);
        expect(page).toContain(`<div class="pp-lb" id="${f9}--obr-1"`);
        expect(page).toContain('Oddací matrika Čapkov 1840–1860, fol. 12');
        // The children: seven, those who died young tinted, a married son leading to his family, a daughter to her husband's.
        expect(page).toContain('<h2 class="sp-h2">Děti (7)</h2>');
        expect(page.match(/class="sp-kid sp-kid--young"/g)).toHaveLength(3);
        expect(page).toContain('zemřela v dětství');
        expect(page).toMatch(/<a class="pp-link" href="#rodina-[^"]+">→ rodina Jan a Rosálie<\/a>/);
        expect(page).toMatch(/→ rodina Matouš a Anna/);
        // The family's sources.
        expect(page).toContain('<h2 class="sp-h2">Prameny rodiny</h2>');
    });

    it('Eva and Petr, both living: no page and no names; Kateřina without a union: no family page', () => {
        const { data, ids, unions } = familyPagesFixture();
        const set = rodsSet(data);
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        expect(set.familySlug.has(unions.f24)).toBe(false);
        expect(html).not.toMatch(/\bEva\b/);
        expect(html).not.toMatch(/Petr Řepík/);
        const fams = set.pages.filter(p => p.kind === 'family');
        const tree = set.protectedTree.tree;
        expect(fams.some(p => [tree.partnerships[p.id as never]?.person1Id, tree.partnerships[p.id as never]?.person2Id].includes(ids.katerina))).toBe(false);
        expect(set.personSlug.has(ids.katerina)).toBe(true);
        // A living partner's page keeps the protected name, no facts, no link.
        const jj = section(html, set.familySlug.get(unions.jaroslavJana)!);
        expect(jj).not.toContain('Hrabanov');
    });

    it('a couple with children and no marriage: a page without ⚭, father and mother', () => {
        const { data, unions } = familyPagesFixture();
        const u = data.partnerships[unions.f10];
        u.status = 'partners';
        delete u.startDate;
        const set = rodsSet(data, fixtureRods(data), { privacy: 'full' });
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        const page = section(html, set.familySlug.get(unions.f10)!);
        expect(page).toContain('<h1 class="sp-h1">Josef Fíšek a Terezie Lhotáková</h1>');
        expect(page).not.toContain('⚭ 1876');
        expect(page).toContain('<p class="sp-sub">bez záznamu o sňatku · 1 dítě</p>');
        expect(page).toContain('<span class="sp-role">otec</span>');
        expect(page).toContain('<span class="sp-role">matka</span>');
        expect(page).toContain('<dd>roz. Vrbátková</dd>');
        expect(page).not.toContain('sp-marriage');
    });

    it('the couple\'s story: once on the family page, its ids the page\'s; left out without stories', () => {
        const { data, unions } = familyPagesFixture();
        data.partnerships[unions.f9].story = { text: 'Josef převzal statek čp. 12 v roce 1846.' } as never;
        const set = rodsSet(data, fixtureRods(data), { privacy: 'full' });
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        const slug = set.familySlug.get(unions.f9)!;
        const page = section(html, slug);
        expect(page).toContain('<h2 class="sp-h2">Vyprávění</h2>');
        expect(page).toContain(`id="${slug}--pp-story-`);
        expect(page).toContain('převzal statek');
        const without = section(buildPageSetHtml(rodsSet(data, fixtureRods(data), { privacy: 'full', stories: false })), slug);
        expect(without).not.toContain('převzal statek');
    });

    it('families as a section: no family pages at all', () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data, fixtureRods(data), { families: 'section' });
        const html = buildPageSetHtml(set);
        expectWellFormed(html, set);
        expect(html).not.toContain('sp-page--family');
        expect(html).not.toMatch(/id="rodina-/);
        expect(html).not.toMatch(/href="#rodina-/);
    });

    it('in the window: the links are buttons, the excerpt an image, no zoom of the file', () => {
        const { data, unions } = familyPagesFixture();
        const set = rodsSet(data, fixtureRods(data), { privacy: 'full' });
        const page = pageSetSectionHtml(set, set.familySlug.get(unions.f9)!);
        expect(page).toContain(`data-sp-open="family:${unions.f10}"`);
        expect(page).toContain('<img class="sp-clip-img"');
        expect(page).not.toContain('pp-lb');
        expect(page).not.toMatch(/href="#/);
    });
});

describe('the families on a person\'s page of the set (§2.4)', () => {
    it('a family with a page is a card, one without a tinted block; the parents first', () => {
        const { data, ids, unions } = familyPagesFixture();
        const set = rodsSet(data, fixtureRods(data), { privacy: 'full' });
        const html = buildPageSetHtml(set);
        const josef = section(html, set.personSlug.get(ids.josef)!);
        const f9 = set.familySlug.get(unions.f9)!, f10 = set.familySlug.get(unions.f10)!;
        expect(josef).toContain(`<a class="sp-famcard" href="#${f9}"><span class="sp-famcard-t">⚭ 1846 Anna Kvapilová</span><span class="sp-famcard-m">7 dětí</span><span class="sp-famcard-go">Stránka rodiny →</span></a>`);
        expect(josef).toContain(`<a class="sp-famcard" href="#${f10}"><span class="sp-famcard-t">⚭ 1876 Terezie Lhotáková</span>`);
        expect(josef).toMatch(/<a class="sp-famcard" href="#rodina-jakub-[^"]+"><span class="sp-famcard-t">Rodiče: Jakub a Magdalena<\/span>/);
        expect(josef.indexOf('Rodiče: Jakub')).toBeLessThan(josef.indexOf('⚭ 1846 Anna'));
        // Marie's son, the father not recorded: a section of her page.
        const marie = section(html, set.personSlug.get(ids.marie)!);
        expect(marie).toContain('<span class="sp-oddil-k">Rodina · bez vlastní stránky</span><span class="sp-oddil-t">otec neuveden · 1 dítě</span>');
        expect(marie).toMatch(/<ul class="sp-oddil-l"><li><a class="pp-link" href="#alois-[^"]+">Alois Fíšek<\/a> <span class="sp-yrs">\(1885–1950\)<\/span><\/li><\/ul>/);
        // In the window the cards are buttons.
        const win = pageSetSectionHtml(set, set.personSlug.get(ids.josef)!);
        expect(win).toContain(`<button type="button" class="sp-famcard" data-sp-open="family:${unions.f9}">`);
    });

    it('families as a section: blocks instead of cards, the breadcrumbs lineage › person', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data, fixtureRods(data), { privacy: 'full', families: 'section' });
        const html = buildPageSetHtml(set);
        const slug = set.personSlug.get(ids.antonin)!;
        const page = section(html, slug);
        expect(page).not.toContain('sp-famcard');
        expect(page).toContain('<span class="sp-oddil-k">Rodiče</span>');
        expect(page).toContain('<span class="sp-oddil-t">⚭ 1905 Ludmila Řepíková · 1 dítě</span>');
        expect(set.bySlug.get(slug)!.crumbs.map(c => c.slug)).toEqual(['rod-fisek', slug]);
    });
});

describe('the living (§5)', () => {
    it('a protected person has no section and the real name is nowhere in the file', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data);
        const html = buildPageSetHtml(set);
        expect(set.personSlug.has(ids.eva)).toBe(false);
        expect(html).not.toMatch(/\bEva\b/);
        // The line names her by the protected name only.
        expect(section(html, 'rod-fisek')).toContain('<div class="sp-row sp-row--prot">');
    });

    it('under hidden names the living are named in the file\'s language, whatever the app\'s', () => {
        setLanguage('en');
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data, fixtureRods(data), { privacy: 'anonymous' });
        expect(set.protectedTree.tree.persons[ids.eva].firstName).toBe('Žijící osoba');
        const html = buildPageSetHtml(set);
        expect(html).not.toContain('Living person');
        expect(html).not.toMatch(/\bEva\b/);
    });
});

describe('images and the window (§0.4, §0.8)', () => {
    it('the marriage record\'s excerpt shown on two pages is in the file once', () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data, fixtureRods(data), { privacy: 'full' });
        const html = buildPageSetHtml(set);
        expect(html.split(CLIP_IMG).length - 1).toBe(1);
        expect(html.match(/\.img-1\{/g)).toHaveLength(1);
        expect((html.match(/ img-1"/g) ?? []).length).toBeGreaterThan(1);
    });

    it('a page for the window: buttons to the set\'s pages, no anchors, no registry', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data);
        const rod = pageSetSectionHtml(set, 'rod-fisek');
        expect(rod).toContain(`data-sp-open="person:${ids.jan}"`);
        expect(rod).not.toMatch(/href="#(?!rod-fisek--)/);
        const josef = pageSetSectionHtml(set, set.personSlug.get(ids.josef)!);
        expect(josef).toContain(`<button type="button" class="sp-crumb" data-sp-open="rod:${set.rodIds[0]}">`);
        expect(pageSetSectionHtml(set, set.indexSlug.persons)).toContain('<button type="button" class="sp-crumb" data-sp-open="page:uvod">');
        expect(pageSetSectionHtml(set, 'nope')).toBe('');
        expect(set.images.count).toBe(0);
    });

    it('a page at a time gives the same file, with the progress', async () => {
        const { data } = familyPagesFixture();
        const at: number[] = [];
        const one = buildPageSetHtml(rodsSet(data));
        const two = await buildPageSetHtmlAsync(rodsSet(data), { pause: () => Promise.resolve(), progress: d => at.push(d) });
        expect(two).toBe(one);
        expect(at.length).toBe(pageSetRenderedPages(rodsSet(data)).length);
    });
});

describe('time (§6.5)', () => {
    it('a set of about 500 people: built and drawn within 1.5 s', () => {
        const { data } = syntheticTree({ persons: 500, founders: 10 });
        const rodIds = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
        const run = (): string => buildPageSetHtml(buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'cs', now: FP_NOW }));
        // Warm-up, then each run right after a calibration run (helpers/perf-budget.ts); the best normalized run counts.
        const persons = (run().match(/<section class="sp-page sp-page--person"/g) ?? []).length;
        expect(persons).toBeGreaterThan(400);
        let ms = Infinity;
        for (let i = 0; i < 3; i++) {
            const c0 = performance.now();
            calibrationWorkload(SET_CALIBRATION_ROUNDS);
            const calMs = performance.now() - c0;
            const t0 = performance.now();
            run();
            ms = Math.min(ms, normalizedMs(performance.now() - t0, calMs, SET_CALIBRATION_REFERENCE_MS));
        }
        expect(ms).toBeLessThan(1500);
    });
});
