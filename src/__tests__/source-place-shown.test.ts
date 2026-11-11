/**
 * Where a cited entry stands, as the pages made from the tree show it (spec
 * 075 §4): the person page's source card (archive · call number · folio ·
 * image · the rest), the family book's list of sources and a chapter's
 * sources, the family pages' sources and marriage excerpt. A source without
 * the new fields (call number, folio, image) reads exactly as before.
 * Invented data only.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { preparePersonPageData, buildPersonPageBody, PERSON_PAGE_ALL_GROUPS, PersonPageOptions } from '../person-page.js';
import { buildFamilyBook } from '../book.js';
import { buildPageSet } from '../family-pages.js';
import { buildPageSetHtml } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { getDemoTree } from '../demo-tree.js';
import { setLanguage } from '../strings.js';
import { StromData, PersonId, Person, Source } from '../types.js';
import { familyPagesFixture, FP_NOW } from './helpers/family-pages-fixture.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const ENV = { now: NOW, dateLabel: 'sestaveno 29. 10. 2026' };

afterEach(() => setLanguage('cs'));

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A source with the place in fields: the book (archive, call number) and the entry (folio, image, the rest). */
const FIELDS: Partial<Source> = { repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'č. 5' };

function tree(): StromData {
    const person = {
        id: 'anna' as PersonId, firstName: 'Anna', lastName: 'Vzorková', gender: 'female', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], birthDate: '1834-05-03', birthSourceIds: ['old', 'new'],
    } as unknown as Person;
    return {
        persons: { anna: person },
        partnerships: {},
        sources: {
            old: { id: 'old', title: 'Oddací matrika Pokusov 1820–1835', repository: 'Zemský archiv Vzorov', reference: 'fol. 31 recto, snímek 3, č. 2' },
            new: { id: 'new', title: 'Křest – Anna Vzorková, 1834', ...FIELDS } as Source,
        },
    } as StromData;
}

function personPage(data: StromData, lang: PersonPageOptions['lang'] = 'cs'): string {
    const op: PersonPageOptions = {
        personId: 'anna' as PersonId, lang, mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
        privacy: 'full', toggles: { history: true, childEvents: true }, research: true, now: NOW,
    };
    return buildPersonPageBody(preparePersonPageData(data, op), op);
}

const refs = (html: string) => [...html.matchAll(/<span class="pp-src-ref">([^<]*)<\/span>/g)].map(m => m[1]);

describe('the person page', () => {
    it('a source card names archive · call number · folio · image · the rest; an older one archive · location', () => {
        expect(refs(personPage(tree()))).toEqual(expect.arrayContaining([
            esc('Zemský archiv Vzorov · N 7 · fol. 12v · snímek 34 · č. 5'),
            esc('Zemský archiv Vzorov · fol. 31 recto, snímek 3, č. 2'),
        ]));
        // The image word in the page's language.
        expect(refs(personPage(tree(), 'de'))).toContain(esc('Zemský archiv Vzorov · N 7 · fol. 12v · Bild 34 · č. 5'));
    });

    it('the demo tree, whose sources have none of the new fields, reads as before', () => {
        const data = getDemoTree();
        const ids = Object.values(data.persons).filter(p => (p.birthSourceIds?.length || p.sourceIds?.length || p.events?.some(e => e.sourceIds?.length))).map(p => p.id);
        expect(ids.length).toBeGreaterThan(0);
        const old = new Set(Object.values(data.sources ?? {}).map(s => esc([s.repository, s.reference].map(x => x?.trim()).filter(Boolean).join(' · '))));
        let seen = 0;
        for (const id of ids) {
            const op: PersonPageOptions = {
                personId: id, lang: 'en', mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
                privacy: 'full', toggles: { history: true, childEvents: true }, research: true, now: NOW,
            };
            for (const r of refs(buildPersonPageBody(preparePersonPageData(data, op), op))) {
                expect(old.has(r)).toBe(true);
                seen++;
            }
        }
        expect(seen).toBeGreaterThan(0);
    });
});

describe('the family book', () => {
    it('the list of sources gives the whole place; a source without the new fields is byte-identical to before', () => {
        const data = getDemoTree();
        const before = buildFamilyBook(data, { lang: 'en', privacy: 'full' }, ENV);
        // The older formula: title, archive, location (each escaped, joined ", ").
        const listed = [...before.matchAll(/<p class="book-source"><span class="book-pn">P\d+<\/span>([^<]*)/g)].map(m => m[1]);
        expect(listed.length).toBeGreaterThan(0);
        const old = new Set(Object.values(data.sources ?? {}).map(s => [s.title, s.repository, s.reference].filter(x => !!x?.trim()).map(x => esc(x!.trim())).join(', ')));
        for (const l of listed) expect(old.has(l)).toBe(true);

        // The same source with its place in fields: the call number, folio and image in the list, the entry in the chapter.
        const id = Object.keys(data.sources ?? {}).find(k => listed.some(l => l.startsWith(esc(data.sources![k].title))))!;
        const changed = structuredClone(data);
        Object.assign(changed.sources![id], FIELDS);
        const after = buildFamilyBook(changed, { lang: 'en', privacy: 'full' }, ENV);
        const title = esc(data.sources![id].title);
        expect(after).toContain(`${title}, Zemský archiv Vzorov, N 7, fol. 12v, image 34, č. 5`);
        expect(after).toContain(`</span>${title}, fol. 12v, image 34, č. 5</p>`);
        // Nothing else of the book changes.
        const s = data.sources![id];
        const mark = (html: string, full: string, short: string) => html.split(full).join('@FULL@').split(`</span>${short}</p>`).join('</span>@SHORT@</p>');
        expect(mark(after, `${title}, Zemský archiv Vzorov, N 7, fol. 12v, image 34, č. 5`, `${title}, fol. 12v, image 34, č. 5`))
            .toBe(mark(before, [title, esc(s.repository!), esc(s.reference!)].join(', '), `${title}, ${esc(s.reference!)}`));
    });
});

describe('the family pages', () => {
    function pages(data: StromData): string {
        const ids = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
        return buildPageSetHtml(buildPageSet(data, { kind: 'rods', rods: ids }, { lang: 'cs', now: FP_NOW }));
    }

    it('a marriage\'s sources and its excerpt name the entry; an older source reads as before', () => {
        const { data } = familyPagesFixture();
        const before = pages(data);
        expect(before).toContain('<p class="sp-src">Oddací matrika Čapkov 1840–1860, fol. 12</p>');
        expect(before).toContain('<span class="sp-clip-cap">Oddací matrika Čapkov 1840–1860, fol. 12</span>');

        const changed = structuredClone(data);
        Object.assign(changed.sources!['s-marr1846'], { callNumber: 'N 7', folio: 'fol. 12', image: '34', reference: undefined });
        const after = pages(changed);
        expect(after).toContain('<p class="sp-src">Oddací matrika Čapkov 1840–1860, fol. 12, snímek 34</p>');
        expect(after).toContain('<span class="sp-clip-cap">Oddací matrika Čapkov 1840–1860, fol. 12, snímek 34</span>');
        expect(after).not.toContain('undefined');
    });
});
