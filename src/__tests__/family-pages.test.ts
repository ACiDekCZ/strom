/**
 * The family pages' set model (spec 026 §0, §2.1, §5, §6.3): pages, slugs,
 * breadcrumbs, the protection of the living, the search index, the image
 * registry, the file name and the size estimate; the person page's id prefix
 * and set links. The unchanged person page and book: family-pages-snapshot.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
    PAGE_SET_BIG_BYTES, PAGE_SET_SPLIT_BYTES, PageSet, buildPageSet, estimatePageSetSize, familyHasPage, pageSetFileName,
    familyHasWindowPage, pageSetLivingNames, pageSetPrivacyWarning, sizeVerdict, uniqueSlug, windowFamilyPages,
} from '../family-pages.js';
import { ImageRegistry } from '../image-registry.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageOptions, buildPersonPageBody, preparePersonPageData, prefixPageIds,
} from '../person-page.js';
import { buildLineages, rods, RodId } from '../lineage.js';
import { Partnership, PartnershipId, PersonId, StromData } from '../types.js';
import { familyPagesFixture, FP_NOW, CLIP_IMG } from './helpers/family-pages-fixture.js';

function fixtureRods(data: StromData): RodId[] {
    return rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
}

function rodsSet(data: StromData, extra: Partial<Parameters<typeof buildPageSet>[2]> = {}): PageSet {
    return buildPageSet(data, { kind: 'rods', rods: fixtureRods(data) }, { lang: 'cs', now: FP_NOW, ...extra });
}

/** A data URL of about `kb` kB, distinct by `n`. */
function bigImage(kb: number, n: number): string {
    return `data:image/jpeg;base64,${'A'.repeat(kb * 1000)}${'B'.repeat(n + 1)}`;
}

describe('slugs', () => {
    it('uniqueSlug adds -2, -3 to a taken slug', () => {
        const used = new Set<string>();
        expect(uniqueSlug('jan-fisek-1702-1761', used)).toBe('jan-fisek-1702-1761');
        expect(uniqueSlug('jan-fisek-1702-1761', used)).toBe('jan-fisek-1702-1761-2');
        expect(uniqueSlug('jan-fisek-1702-1761', used)).toBe('jan-fisek-1702-1761-3');
        expect(used.size).toBe(3);
    });

    it('every page has its own ASCII slug; namesakes with the same years get -2; the same choice gives the same slugs', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data);
        const slugs = set.pages.map(p => p.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(set.personSlug.get(ids.josefA)).toBe('josef-fisek-1862-1863');
        expect(set.personSlug.get(ids.josefB)).toBe('josef-fisek-1862-1863-2');
        expect(set.personSlug.get(ids.jan)).toBe('jan-fisek-1702-1761');
        expect(set.rodSlug.get(fixtureRods(data)[0])).toBe('rod-fisek');
        expect(rodsSet(familyPagesFixture().data).pages.map(p => p.slug)).toEqual(slugs);
    });

    it('the order of pages: introduction, lineages, families, people, indexes, map', () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data);
        const order = ['hub', 'rod', 'family', 'person', 'index', 'map'];
        const kinds = set.pages.map(p => order.indexOf(p.kind));
        expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
        expect(set.pages[0]).toMatchObject({ kind: 'hub', slug: 'uvod', title: 'Rody Fíšek, Řepík a Kvapil', crumbs: [] });
        expect(set.pages.filter(p => p.kind === 'index').map(p => p.slug)).toEqual(['rejstrik-osoby', 'rejstrik-rodiny', 'rejstrik-prijmeni', 'rejstrik-obce']);
        expect(set.pages[set.pages.length - 1].slug).toBe('mapa-obci');
        expect(rodsSet(data, { map: false }).pages.some(p => p.kind === 'map')).toBe(false);
    });

    it('a family slug from the protected tree: the living wife by her initials, the year of the marriage', () => {
        const { data, unions } = familyPagesFixture();
        const set = rodsSet(data);
        expect(set.familySlug.get(unions.f9)).toBe('rodina-josef-fisek-anna-kvapilova-1846');
        expect(set.familySlug.get(unions.jaroslavJana)).toBe('rodina-jaroslav-fisek-j-h-1950');
    });

    it('breadcrumbs: lineage › family; member: lineage › parents\' family › person; married in: lineage › own family › person', () => {
        const { data, ids, unions } = familyPagesFixture();
        const set = rodsSet(data);
        const crumbs = (slug: string | undefined) => set.bySlug.get(slug!)!.crumbs.map(c => c.label);
        expect(crumbs(set.familySlug.get(unions.f9))).toEqual(['Rod Fíšek', 'Josef a Anna']);
        expect(crumbs(set.personSlug.get(ids.antonin))).toEqual(['Rod Fíšek', 'Josef a Terezie', 'Antonín Fíšek']);
        expect(crumbs(set.personSlug.get(ids.terezie))).toEqual(['Rod Fíšek', 'Josef a Terezie', 'Terezie Lhotáková']);
        expect(crumbs(set.rodSlug.get(fixtureRods(data)[0]))).toEqual(['Rozcestník', 'Rod Fíšek']);
        expect(crumbs('rejstrik-osoby')).toEqual(['Úvod', 'Rejstřík osob']);
        // One lineage: the lineage is the introduction.
        const one = buildPageSet(data, { kind: 'rods', rods: [fixtureRods(data)[0]] }, { lang: 'cs', now: FP_NOW });
        expect(one.pages[0]).toMatchObject({ kind: 'rod', slug: 'rod-fisek', title: 'Rod Fíšek', crumbs: [] });
        expect(one.pages.some(p => p.kind === 'hub')).toBe(false);
    });
});

describe('protection of the living (§5)', () => {
    it('the protected Eva has no page and no slug; the index carries her protected name only, without a tag', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data);
        expect(set.personSlug.has(ids.eva)).toBe(false);
        expect(set.pages.some(p => p.id === ids.eva)).toBe(false);
        expect(set.pages.some(p => /eva/i.test(p.slug))).toBe(false);
        const json = JSON.stringify(set.searchIndex);
        expect(json).not.toMatch(/eva/i);
        const entry = set.searchIndex.find(e => e.n === 'E. F.');
        expect(entry).toMatchObject({ s: '', t: '', k: 'e f' });
    });

    it('a family of two protected partners has no page; one of them living, it has', () => {
        const { data, unions } = familyPagesFixture();
        const set = rodsSet(data);
        expect(set.familySlug.has(unions.f24)).toBe(false);
        expect(familyHasPage(data.partnerships[unions.f24], set)).toBe(false);
        expect(set.familySlug.has(unions.jaroslavJana)).toBe(true);
        // Under full data the living are not protected.
        const full = rodsSet(data, { privacy: 'full' });
        expect(familyHasPage(full.protectedTree.tree.partnerships[unions.f24], full)).toBe(true);
    });

    it('the living of the selection for the dialog\'s warning (full data only)', () => {
        const { data } = familyPagesFixture();
        const full = rodsSet(data, { privacy: 'full' });
        expect(pageSetLivingNames(full).sort()).toEqual(['Eva Fíšková', 'Jana Hrabánková', 'Petr Řepík']);
        expect(pageSetPrivacyWarning(full)).toBe('Ve výběru jsou 3 žijící osoby. Soubor ponese jejich jména, data a místa.');
        expect(pageSetPrivacyWarning(rodsSet(data))).toBe('');
    });
});

describe('familyHasPage (§2.1)', () => {
    function withUnion(u: Omit<Partnership, 'id'>): { data: StromData; id: PartnershipId } {
        const { data } = familyPagesFixture();
        const id = 'uX' as PartnershipId;
        data.partnerships[id] = { ...u, id };
        for (const p of [u.person1Id, u.person2Id]) data.persons[p].partnerships.push(id);
        for (const k of u.childIds) {
            data.persons[k].parentIds.push(u.person1Id, u.person2Id);
            data.persons[u.person1Id].childIds.push(k);
            data.persons[u.person2Id].childIds.push(k);
        }
        return { data, id };
    }

    it('a couple without a marriage but with children: a page; without a marriage and children: none', () => {
        const { ids } = familyPagesFixture();
        const kids = withUnion({ person1Id: 'jan1880' as PersonId, person2Id: ids.katerina, status: 'partners', childIds: ['alois' as PersonId] });
        const setA = rodsSet(kids.data);
        expect(familyHasPage(kids.data.partnerships[kids.id], setA)).toBe(true);
        const none = withUnion({ person1Id: 'jan1880' as PersonId, person2Id: ids.katerina, status: 'partners', childIds: [] });
        expect(familyHasPage(none.data.partnerships[none.id], rodsSet(none.data))).toBe(false);
    });

    it('a parent alone: none; families as a section: none at all', () => {
        const { data, unions } = familyPagesFixture();
        const set = rodsSet(data);
        expect(familyHasPage(data.partnerships[unions.single], set)).toBe(false);
        expect(familyHasPage(data.partnerships[unions.f9], set)).toBe(true);
        expect(familyHasPage(data.partnerships[unions.f9], set, { families: 'section' })).toBe(false);
        const section = rodsSet(data, { families: 'section' });
        expect(section.pages.some(p => p.kind === 'family')).toBe(false);
        expect(section.familySlug.size).toBe(0);
    });
});

describe('family pages in the app\'s window (§2.4, §7)', () => {
    it('a person\'s families and the parents\' family that have a page: the window\'s sets agree', () => {
        const { data, ids, unions } = familyPagesFixture();
        const index = buildLineages(data);
        const josef = windowFamilyPages(data, index, ids.josef);
        expect(josef.has(unions.f9)).toBe(true);
        expect(josef.has(unions.f10)).toBe(true);
        expect(josef.size).toBe(3);
        // Kateřina: only her parents' family; Marie's son without a father: none of her own.
        expect([...windowFamilyPages(data, index, ids.katerina)]).toEqual([...josef].filter(u => u !== unions.f9 && u !== unions.f10));
        expect(windowFamilyPages(data, index, ids.marie).has(unions.single)).toBe(false);
        expect(familyHasWindowPage(data, index, data.partnerships[unions.single])).toBe(false);
        // Each union said to have one is a family page of a partner's lineage's set (full data, as the window).
        for (const uid of josef) {
            const u = data.partnerships[uid];
            const sets = [u.person1Id, u.person2Id].map(pid => index.rodByPerson.get(pid)).filter((r): r is RodId => !!r)
                .map(r => buildPageSet(data, { kind: 'rods', rods: [r] }, { lang: 'cs', now: FP_NOW, privacy: 'full' }));
            expect(sets.some(s => s.familySlug.has(uid))).toBe(true);
        }
    });
});

describe('search index (§0.7)', () => {
    it('keys from the name, surname forms and the lineage\'s forms; the tag says the lineage, the generation and a spelling of its own', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data);
        const martin = set.searchIndex.find(e => e.n === 'Martin Fischek')!;
        expect(martin.t).toBe('rod Fíšek, III. generace · zapsán jako Fischek');
        expect(martin.k.split(' ')).toEqual(expect.arrayContaining(['martin', 'fischek', 'fisek', 'fysek', 'fiskova']));
        const josef = set.searchIndex.find(e => e.s === set.personSlug.get(ids.josef))!;
        expect(josef).toMatchObject({ n: 'Josef Fíšek', y: '1820–1894', t: 'rod Fíšek, IV. generace' });
        const terezie = set.searchIndex.find(e => e.s === set.personSlug.get(ids.terezie))!;
        expect(terezie.t).toBe('manželka v rodu Fíšek');
        expect(terezie.k.split(' ')).toEqual(expect.arrayContaining(['terezie', 'lhotakova', 'vrbatkova']));
        // English: the same tags in English.
        const en = rodsSet(data, { lang: 'en' });
        expect(en.searchIndex.find(e => e.n === 'Martin Fischek')!.t).toBe('Fíšek family line, generation III · recorded as Fischek');
    });
});

describe('image registry (§0.4)', () => {
    it('the same image is registered once, a class per image, one rule each', () => {
        const reg = new ImageRegistry();
        const a = reg.add(CLIP_IMG, 'clip');
        expect(a).toBe('img-1');
        expect(reg.add(` ${CLIP_IMG}\n`, 'photo')).toBe('img-1');
        expect(reg.add(bigImage(1, 0), 'photo')).toBe('img-2');
        expect(reg.count).toBe(2);
        expect(reg.css().match(/\.img-1\{/g)).toHaveLength(1);
        expect(reg.add('javascript:alert(1)', 'clip')).toBeNull();
    });

    it('none carries no image of the kind; small takes the reduced copy', () => {
        const reg = new ImageRegistry({ clips: 'none', photos: 'small', replace: () => CLIP_IMG });
        expect(reg.add(bigImage(1, 1), 'clip')).toBeNull();
        expect(reg.add(bigImage(1, 2), 'photo')).toBe('img-1');
        expect(reg.entries()[0].src).toBe(CLIP_IMG);
    });

    it('two pages of the set share one registry: the excerpt they both show is in it once', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data, { privacy: 'full' });
        for (const id of [ids.josef, ids.anna]) {
            const o = setPageOpts(set, id);
            buildPersonPageBody(preparePersonPageData(data, o, { protected: set.protectedTree }), o);
        }
        expect(set.images.count).toBe(1);
        expect(set.images.css()).toContain('.img-1{background-image:url("data:image/jpeg;base64,');
    });
});

function setPageOpts(set: PageSet, personId: PersonId, mode: 'file' | 'app' = 'file'): PersonPageOptions {
    return {
        personId, lang: 'cs', mode, groups: { ...PERSON_PAGE_ALL_GROUPS }, privacy: set.options.privacy,
        toggles: { history: true, childEvents: true }, research: false, now: FP_NOW, toc: true,
        links: { mode: 'set', personSlug: set.personSlug, familySlug: set.familySlug, rodSlug: set.rodSlug },
        idPrefix: set.personSlug.get(personId)!, images: set.images,
    };
}

describe('the person page in a set (§0.3, §0.8)', () => {
    it('with a prefix every id and every reference to one carries it; links to the set\'s pages go by their slugs', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data, { privacy: 'full' });
        const o = setPageOpts(set, ids.josef);
        const html = buildPersonPageBody(preparePersonPageData(data, o, { protected: set.protectedTree }), o);
        const prefix = `${set.personSlug.get(ids.josef)}--`;
        const idsIn = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
        expect(idsIn.length).toBeGreaterThan(5);
        for (const id of idsIn) expect(id.startsWith(prefix)).toBe(true);
        const slugs = new Set(set.pages.map(p => p.slug));
        for (const m of html.matchAll(/\shref="#([^"]+)"/g)) expect(m[1].startsWith(prefix) || slugs.has(m[1])).toBe(true);
        for (const m of html.matchAll(/\s(?:aria-controls|data-pp-osa|data-pp-story)="([^"]+)"/g)) expect(m[1].startsWith(prefix)).toBe(true);
        // His son Antonín's page, by its slug.
        expect(html).toContain(`<a class="pp-link" href="#${set.personSlug.get(ids.antonin)}">`);
        // No image style of its own: the set's registry has them.
        expect(html).not.toContain('background-image');
    });

    it('in the window the set\'s links are buttons that open the page', () => {
        const { data, ids } = familyPagesFixture();
        const set = rodsSet(data, { privacy: 'full' });
        const o = setPageOpts(set, ids.josef, 'app');
        const html = buildPersonPageBody(preparePersonPageData(data, o, { protected: set.protectedTree }), o);
        expect(html).toContain(`<button type="button" class="pp-link" data-sp-open="person:${ids.antonin}">`);
        expect(html).not.toContain(`href="#${set.personSlug.get(ids.antonin)}"`);
    });

    it('prefixPageIds: own ids and references, a slug of the set kept', () => {
        const out = prefixPageIds('<a href="#obr-1">x</a><a href="#jan-fisek">y</a><div id="obr-1" aria-controls="pp-x pp-y"></div><svg><path fill="url(#g1)" id="g1"/></svg>', 'p', new Set(['jan-fisek']));
        expect(out).toBe('<a href="#p--obr-1">x</a><a href="#jan-fisek">y</a><div id="p--obr-1" aria-controls="p--pp-x p--pp-y"></div><svg><path fill="url(#p--g1)" id="p--g1"/></svg>');
        expect(prefixPageIds('<a href="#obr-1">', '')).toBe('<a href="#obr-1">');
    });
});

describe('file name (§6.3)', () => {
    it('from the choice, ASCII, never a living person\'s name', () => {
        const { data, ids } = familyPagesFixture();
        const all = fixtureRods(data);
        expect(pageSetFileName(rodsSet(data))).toBe('Rody-Fisek-Repik-Kvapil.html');
        expect(pageSetFileName(buildPageSet(data, { kind: 'rods', rods: [all[0]] }, { lang: 'cs', now: FP_NOW }))).toBe('Rod-Fisek.html');
        expect(pageSetFileName(buildPageSet(data, { kind: 'descendants', person: ids.josef }, { lang: 'cs', now: FP_NOW }))).toBe('Potomci-Josef-Fisek.html');
        for (const privacy of ['full', 'initials', 'anonymous'] as const) {
            const name = pageSetFileName(buildPageSet(data, { kind: 'descendants', person: ids.eva }, { lang: 'cs', now: FP_NOW, privacy }));
            expect(name).toBe('Potomci.html');
        }
    });

    it('the branch of a living person: the title by the protected name ("Potomci: E. F."), the real one only under full data (§9.7)', () => {
        const { data, ids } = familyPagesFixture();
        const branch = (privacy: 'full' | 'initials') => buildPageSet(data, { kind: 'descendants', person: ids.eva }, { lang: 'cs', now: FP_NOW, privacy }).pages[0];
        expect(branch('initials').title).toBe('Potomci: E. F.');
        expect(branch('initials').slug).not.toMatch(/eva/);
        expect(branch('full').title).toBe('Potomci: Eva Fíšková');
    });

    it('a lineage founded by a living person: its surname; under hidden names "Rod"', () => {
        // A living founder: a mother born 1990 and her son, a line of their own.
        const d = familyPagesFixture().data;
        const hana = 'hanaX' as PersonId;
        d.persons[hana] = { id: hana, firstName: 'Hana', lastName: 'Doubravková', gender: 'female', isPlaceholder: false, birthDate: '1990', parentIds: [], childIds: [], partnerships: [] } as unknown as StromData['persons'][PersonId];
        const son = 'tomX' as PersonId;
        d.persons[son] = { id: son, firstName: 'Tomáš', lastName: 'Doubravka', gender: 'male', isPlaceholder: false, birthDate: '2015', parentIds: [hana], childIds: [], partnerships: [] } as unknown as StromData['persons'][PersonId];
        const uid = 'uH' as PartnershipId;
        d.partnerships[uid] = { id: uid, person1Id: hana, person2Id: '' as PersonId, childIds: [son], status: 'partners' };
        d.persons[hana].partnerships.push(uid);
        d.persons[hana].childIds.push(son);
        const idx2 = buildLineages(d);
        const r2 = idx2.rodByPerson.get(son);
        expect(r2).toBeTruthy();
        const set2 = (privacy: 'initials' | 'anonymous') => buildPageSet(d, { kind: 'rods', rods: [r2!] }, { lang: 'cs', now: FP_NOW, privacy });
        const founder = idx2.rods.get(r2!)!.founderId;
        expect([hana, son]).toContain(founder);
        expect(pageSetFileName(set2('initials'))).toMatch(/^Rod-Doubrav/);
        expect(pageSetFileName(set2('anonymous'))).toBe('Rod.html');
        expect(set2('anonymous').pages[0].title).toBe('Rod');
    });
});

describe('size estimate (§6.3)', () => {
    function withExcerpts(count: number, kb: number): StromData {
        const { data } = familyPagesFixture();
        data.sources!['s-marr1846'].excerpts = Array.from({ length: count }, (_, i) => ({
            id: `x${i}`, dataUrl: bigImage(kb, i), width: 3000, height: 2000, sizeBytes: kb * 750,
        }));
        return data;
    }

    it('counts pages, people and images; a small sample is fine', () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data);
        const size = estimatePageSetSize(set);
        expect(size.pages).toBe(set.pages.length);
        expect(size.persons).toBe(set.personSlug.size);
        expect(size.images).toBe(1);
        expect(size.bytes).toBe(size.textBytes + size.imageBytes);
        expect(sizeVerdict(size.bytes)).toBe('ok');
    });

    it('large excerpts: over 15 MB is large, reducing them helps, none leaves them out; over 50 MB a set of files', () => {
        const big = rodsSet(withExcerpts(8, 2500));
        const size = estimatePageSetSize(big);
        expect(size.bytes).toBeGreaterThan(PAGE_SET_BIG_BYTES);
        expect(sizeVerdict(size.bytes)).toBe('big');
        const small = estimatePageSetSize(big, { clips: 'small' });
        expect(small.imageBytes).toBeLessThan(size.imageBytes / 4);
        // Without excerpts only the portrait stays.
        expect(estimatePageSetSize(big, { clips: 'none' })).toMatchObject({ images: 1 });
        expect(estimatePageSetSize(big, { clips: 'none' }).imageBytes).toBeLessThan(1000);
        expect(estimatePageSetSize(big, { clips: 'none', photos: 'none' })).toMatchObject({ imageBytes: 0, images: 0 });
        const huge = estimatePageSetSize(rodsSet(withExcerpts(30, 2000)));
        expect(huge.bytes).toBeGreaterThan(PAGE_SET_SPLIT_BYTES);
        expect(sizeVerdict(huge.bytes)).toBe('set');
    });
});
