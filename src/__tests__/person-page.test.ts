/**
 * The person page (spec 025): section order, empty sections, default folds,
 * the timeline (merged rows, segments, switches), links per mode, what only
 * the window may carry, privacy of the living, escaping, unsafe images,
 * no external references in the file, file names and the size estimate.
 * Pure, fictional data (Jan Fíšek of Čapkov).
 */

import { describe, it, expect } from 'vitest';
import {
    preparePersonPageData, buildPersonPageBody, buildPersonPageDocument, personPageFileName, estimatePersonPageSize,
    personPageTimeline, personPageSections, protectPersonPageTree, stripResearchIds, registerKindOf, personPageDate,
    PERSON_PAGE_ALL_GROUPS, PersonPageOptions, personPageSizeMb, personPageLivingNames,
} from '../person-page.js';
import { personSourceRows } from '../person-sources.js';
import { computePersonLifeline } from '../timeline.js';
import { parseHistoryPayload, HistoryPayload } from '../history.js';
import { getStringsForLang } from '../strings.js';
import { StromData, PersonId, PartnershipId, Person, Gender, Partnership } from '../types.js';

/** A 1×1 JPEG. */
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const NOW = new Date('2026-10-29T12:00:00Z');

function p(id: string, first: string, last: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra } as Person;
}
const ids = (...xs: string[]) => xs as PersonId[];

function fiskTree(): StromData {
    const persons: StromData['persons'] = {};
    const add = (x: Person) => { persons[x.id] = x; };
    add(p('jan', 'Jan', 'Fíšek', 'male', {
        birthDate: '1860-03-12', birthPlace: 'Čapkov', deathDate: '1910-11-02', deathPlace: 'Čapkov',
        parentIds: ids('otec', 'matka'), childIds: ids('petr', 'rosa'), partnerships: ['u1' as PartnershipId],
        birthSourceIds: ['s1'], deathSourceIds: ['s3'], notes: 'Rolník z čísla 12 [S0042]',
        events: [
            { id: 'e1', type: 'baptism', date: '1860-03-13', place: 'Čapkov', sourceIds: ['s1'], participants: [{ id: 'g1', role: 'godparent', name: 'Josef Kmotr' }] },
            { id: 'e2', type: 'burial', date: '1910-11-05', place: 'Čapkov' },
            { id: 'e3', type: 'emigration', date: '1880', place: 'Vídeň' },
        ],
        story: { status: 'final', title: 'Rolník z Čapkova', text: 'Jan se narodil v Čapkově. [S0042]\n\nOženil se s Marií.', facts: ['Narozen 1860 [S0042]'], note: 'Nic nedokazuje.' },
    }));
    add(p('otec', 'Václav', 'Fíšek', 'male', { birthDate: '1830', deathDate: '1890', childIds: ids('jan', 'karel') }));
    add(p('matka', 'Anna', 'Nová', 'female', { birthDate: '1835', deathDate: '1895', childIds: ids('jan', 'karel') }));
    add(p('karel', 'Karel', 'Fíšek', 'male', { birthDate: '1862', deathDate: '1930', parentIds: ids('otec', 'matka') }));
    add(p('marie', 'Marie', 'Dvořáková', 'female', { birthDate: '1865', deathDate: '1930', partnerships: ['u1' as PartnershipId], childIds: ids('petr', 'rosa') }));
    add(p('petr', 'Petr', 'Fíšek', 'male', {
        birthDate: '1890-01-01', deathDate: '1892-05-05', parentIds: ids('jan', 'marie'),
        events: [{ id: 'b2', type: 'burial', date: '1892-05-07' }],
    }));
    add(p('rosa', 'Rosa', 'Fíšková', 'female', { birthDate: '1893', parentIds: ids('jan', 'marie') }));
    add(p('cizi', 'Tomáš', 'Neznámý', 'male', { birthDate: '1800', deathDate: '1870', notes: 'Cizí poznámka' }));
    return {
        persons,
        partnerships: {
            u1: { id: 'u1' as PartnershipId, person1Id: 'jan' as PersonId, person2Id: 'marie' as PersonId, status: 'married', childIds: ids('petr', 'rosa'), startDate: '1888-02-02', startPlace: 'Čapkov', sourceIds: ['s2'] },
        },
        sources: {
            s1: { id: 's1', title: 'Matrika narozených Čapkov 1850–1870', repository: 'Archiv Čapkov', reference: 'fol. 12', excerpts: [{ id: 'x1', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100 }], url: 'https://example.org/scan' },
            s2: { id: 's2', title: 'Matrika oddaných Čapkov', excerpts: [{ id: 'x2', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100 }] },
            s3: { id: 's3', title: 'Matrika zemřelých Čapkov', refn: 'S0042', transcript: 'Zemřel Jan.' },
            s9: { id: 's9', title: 'Nepoužitý pramen ze Lhoty' },
        },
    } as StromData;
}

function opts(o: Partial<PersonPageOptions> = {}): PersonPageOptions {
    return {
        personId: 'jan' as PersonId, lang: 'cs', mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
        privacy: 'full', toggles: { history: true, childEvents: true }, research: true, now: NOW, ...o,
    };
}

function body(data: StromData, o: Partial<PersonPageOptions> = {}): string {
    const op = opts(o);
    return buildPersonPageBody(preparePersonPageData(data, op), op);
}

function doc(data: StromData, o: Partial<PersonPageOptions> = {}): string {
    const op = opts({ mode: 'file', links: 'plain', ...o });
    return buildPersonPageDocument(preparePersonPageData(data, op), op);
}

const sectionIds = (html: string) => [...html.matchAll(/<section class="pp-sec[^"]*" id="(pp-sec-[a-z]+)"/g)].map(m => m[1]);

describe('sections', () => {
    it('come in the agreed order; header first, footer last', () => {
        const html = body(fiskTree(), { open: new Set(['research']) });
        expect(html.startsWith('<article class="pp"')).toBe(true);
        expect(html.indexOf('<header class="pp-hero">')).toBeLessThan(html.indexOf('pp-sec-family'));
        expect(sectionIds(html)).toEqual(['pp-sec-family', 'pp-sec-story', 'pp-sec-notes', 'pp-sec-timeline', 'pp-sec-sources', 'pp-sec-research']);
        expect(personPageSections(html, 'cs').map(s => s.key)).toEqual(['family', 'story', 'notes', 'timeline', 'sources', 'research']);
    });

    it('a person with only a name has a header and nothing empty', () => {
        const data: StromData = { persons: { x: p('x', 'Jakub', 'Prostý', 'male') }, partnerships: {} } as StromData;
        const html = body(data, { personId: 'x' as PersonId });
        expect(sectionIds(html)).toEqual([]);
        expect(html).toContain('Jakub Prostý');
        const file = doc(data, { personId: 'x' as PersonId });
        expect(file).toContain('<footer class="pp-foot">');
    });

    it('a story in draft is not shown; the researchers section needs a research tree', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].story!.status = 'draft';
        const html = body(d, { research: false });
        expect(html).not.toContain('pp-sec-story');
        expect(html).not.toContain('pp-sec-research');
        expect(html).not.toContain('pp-sec-materials');
    });

    it('materials show safe images in a research tree only', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].attachments = [
            { id: 'a1', name: 'dum.jpg', mimeType: 'image/jpeg', dataUrl: IMG, sizeBytes: 100, note: 'Dům čp. 12' },
            { id: 'a2', name: 'zlé.svg', mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', sizeBytes: 10 },
        ];
        const withResearch = body(d);
        expect(withResearch).toContain('pp-sec-materials');
        expect(withResearch).toContain('Dům čp. 12');
        expect(withResearch).not.toContain('image/svg');
        expect(body(d, { research: false })).not.toContain('pp-sec-materials');
    });
});

describe('default folds', () => {
    it('siblings, sources, each source, the basis and the researchers section start closed', () => {
        const html = body(fiskTree());
        for (const id of ['pp-sibs', 'pp-sources', 'pp-src-s1', 'pp-basis', 'pp-research']) {
            expect(html).toContain(`aria-controls="${id}-body"`);
            expect(html).toMatch(new RegExp(`id="${id}-body" hidden`));
        }
        expect(html).toContain('aria-expanded="false"');
        // The researchers' intro stays visible above the fold.
        expect(html.indexOf('pp-research-intro')).toBeLessThan(html.indexOf('id="pp-research-body"'));
    });

    it('open keys open them', () => {
        const html = body(fiskTree(), { open: new Set(['sources', 'sibs']) });
        expect(html).toContain('id="pp-sources-body">');
        expect(html).toContain('id="pp-sibs-body">');
        expect(html).toContain('id="pp-basis-body" hidden');
    });

    it('the file uses <details> (closed) and no window toggles', () => {
        const html = doc(fiskTree());
        expect(html).toContain('<details class="pp-coll pp-sources" id="pp-sources-fold">');
        expect(html).not.toContain('data-pp-toggle');
        expect(html).toContain('<p class="pp-eyebrow">');
        expect(body(fiskTree())).not.toContain('pp-eyebrow');
    });
});

describe('header', () => {
    const html = body(fiskTree());
    it('writes dates in words, the age at death and the baptism when it differs', () => {
        expect(html).toContain('<dt>Narozen</dt><dd>12. března 1860');
        expect(html).toContain('<dt>Pokřtěn</dt><dd>13. března 1860');
        expect(html).toContain('ve věku 50 let');
    });
    it('approximate dates and English', () => {
        expect(personPageDate('~1835', 'cs')).toBe('asi 1835');
        expect(personPageDate('1860-03-12', 'en')).toContain('1860');
        expect(personPageDate('1860-03-12', 'en')).toMatch(/March/);
    });
    it('an open birth conflict gives the differs badge leading to the researchers section', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].research = {
            conflicts: [{ id: 'k1', fact: 'BIRT', status: 'open', values: [{ value: '1860', sourceIds: ['s1'] }, { value: '1861 [S0042]' }] }],
        };
        const app = body(d);
        expect(app).toContain('data-pp-differs');
        expect(app).toContain('1860 (pramen: Matrika narozených');
        expect(app).not.toContain('[S0042]');
        expect(doc(d)).toContain('<a class="pp-differs js-only" href="#pp-research">');
        expect(body(d, { research: false })).not.toContain('pp-differs');
    });
});

describe('timeline', () => {
    const d = fiskTree();
    const points = computePersonLifeline(d, 'jan', { childEvents: true });

    it('merges birth + baptism, death + burial, and a child’s death + burial', () => {
        const segs = personPageTimeline(points, [], { childEvents: true, history: true, living: false });
        const rows = segs.flatMap(s => s.rows);
        const birth = rows.find(r => r.kind === 'own' && r.point.kind === 'birth');
        expect(birth && 'merged' in birth && birth.merged?.eventType).toBe('baptism');
        const death = rows.find(r => r.kind === 'own' && r.point.kind === 'death');
        expect(death && 'merged' in death && death.merged?.eventType).toBe('burial');
        expect(rows.filter(r => r.kind === 'own' && r.point.kind === 'event' && (r.point.eventType === 'burial' || r.point.eventType === 'baptism'))).toEqual([]);
        const kid = rows.filter(r => r.kind === 'kid');
        expect(kid).toHaveLength(1);
        expect(kid[0].kind === 'kid' && kid[0].merged?.childEvent).toBe('burial');
        const html = body(d);
        expect(html).toContain('Narození a křest');
        expect(html).toContain('Úmrtí a pohřeb');
        expect(html).toContain('kmotři Josef Kmotr');
    });

    it('splits before / married / after, and drops empty segments', () => {
        const segs = personPageTimeline(points, [], { childEvents: true, history: true, living: false });
        expect(segs.map(s => s.key)).toEqual(['before', 'married']);
        expect(segs[0].titled).toBe(true);
        // Rosa's marriage after Jan's death lands after.
        const later: typeof points = [...points, { ...points[0], kind: 'childEvent', childEvent: 'marriage', year: 1915, relatedId: 'rosa', relatedName: 'Rosa Fíšková' } as typeof points[0]];
        const segs2 = personPageTimeline(later, [], { childEvents: true, history: true, living: false });
        expect(segs2.map(s => s.key)).toEqual(['before', 'married', 'after']);
        expect(personPageTimeline(later, [], { childEvents: false, history: true, living: false }).map(s => s.key)).toEqual(['before', 'married']);
    });

    it('without a marriage the one segment has no title; a living person has no after', () => {
        const single: StromData = { persons: { x: p('x', 'Jakub', 'Prostý', 'male', { birthDate: '1900', deathDate: '1950' }) }, partnerships: {} } as StromData;
        const segs = personPageTimeline(computePersonLifeline(single, 'x'), [], { childEvents: true, history: true, living: false });
        expect(segs).toHaveLength(1);
        expect(segs[0].titled).toBe(false);
        expect(body(single, { personId: 'x' as PersonId })).not.toContain('pp-seg-title');
        const later = [...computePersonLifeline(single, 'x'), { kind: 'event', year: 1960, eventType: 'residence' } as never];
        expect(personPageTimeline(later, [], { childEvents: true, history: true, living: true }).map(s => s.key)).toEqual(['before']);
    });

    it('history items are single rows after the person’s rows of the same year', () => {
        const item = (year: number, text: string) => ({ ev: { id: `h${year}`, from: year, kind: 'war', scope: 'region' }, year, age: '', place: 'Čapkov', placeKey: 'capkov', text, textLang: 'cs' }) as never;
        const segs = personPageTimeline(points, [item(1888, 'Válka'), item(1888, 'Mor')], { childEvents: true, history: true, living: false });
        const married = segs.find(s => s.key === 'married')!;
        expect(married.rows.slice(0, 3).map(r => r.kind)).toEqual(['own', 'hist', 'hist']);
        const off = personPageTimeline(points, [item(1888, 'Válka')], { childEvents: true, history: false, living: false });
        expect(off.flatMap(s => s.rows).some(r => r.kind === 'hist')).toBe(false);
    });

    it('the switches are drawn only for rows that exist and set the article classes', () => {
        const html = body(fiskTree(), { toggles: { history: true, childEvents: false } });
        expect(html).toContain('data-pp-switch="childEvents"');
        expect(html).toContain('aria-checked="false" data-pp-switch="childEvents"');
        expect(html).not.toContain('data-pp-switch="history"');
        expect(html).toMatch(/<article class="pp pp-no-kids"/);
        expect(html).toContain('pp-seg--kid');
        expect(body(fiskTree(), { groups: { ...PERSON_PAGE_ALL_GROUPS, childEvents: false } })).not.toContain('pp-row--kid');
    });

    it('main excerpts sit at the birth and marriage rows; the source refers to them', () => {
        const html = body(fiskTree(), { open: new Set(['sources', 's:s1']) });
        expect(html).toContain('id="pp-ex-birth"');
        expect(html).toContain('Zápis o narození a křtu v matrice narozených, Čapkov 1860');
        expect(html).toContain('id="pp-ex-marriage-1"');
        expect(html).toContain('href="#pp-ex-birth"');
        expect((html.match(/<img /g) ?? []).length).toBe(2);
        const noEx = body(fiskTree(), { groups: { ...PERSON_PAGE_ALL_GROUPS, excerpts: false } });
        expect(noEx).not.toContain('<img');
    });

    it('register kinds come from the source title', () => {
        expect(registerKindOf('Matrika narozených')).toBe('birth');
        expect(registerKindOf('Kirchenbuch Trauungen')).toBe('marriage');
        expect(registerKindOf('Death register')).toBe('death');
        expect(registerKindOf('Pozemková kniha')).toBeNull();
    });
});

describe('history layer', () => {
    const payload: HistoryPayload = parseHistoryPayload({
        state: { on: true, search: 'done', at: '2026-10-27T14:05:00Z' }, lang: 'cs', hidden: [],
        events: [{
            id: 'cz-bohemia-0001', from: 1866, kind: 'war', scope: 'region',
            region: { id: 'cz-bohemia', name: { cs: 'Čechy' } }, text: { cs: 'Prusko-rakouská válka' },
            source: { title: 'Válka', publisher: 'Wikipedie', url: 'https://cs.wikipedia.org/wiki/X', checked: '2026-10-27' },
        }],
        places: { 'Čapkov': { events: ['cz-bohemia-0001'] } },
    }, '2026-10-27T14:05:00Z')!;

    it('shows history rows with a safe external link, only in a research tree', () => {
        const op = opts();
        const page = preparePersonPageData(fiskTree(), op, { history: { payload } });
        expect(page.counts.history).toBe(1);
        const html = buildPersonPageBody(page, op);
        expect(html).toContain('Prusko-rakouská válka');
        expect(html).toContain('href="https://cs.wikipedia.org/wiki/X" rel="noopener noreferrer" target="_blank"');
        expect(html).toContain('data-pp-switch="history"');
        const plain = preparePersonPageData(fiskTree(), opts({ research: false }), { history: { payload } });
        expect(plain.history).toEqual([]);
        expect(plain.groups.history).toBe(false);
    });
});

describe('links per mode', () => {
    it('app: people and places are buttons', () => {
        const html = body(fiskTree());
        expect(html).toContain('data-pp-person="otec"');
        expect(html).toContain('data-pp-place="Čapkov"');
        expect(html).toContain('data-pp-action="source"');
    });
    it('plain: text only', () => {
        const html = doc(fiskTree());
        expect(html).not.toMatch(/data-pp-(person|place|action|source|toggle|differs)/);
        expect(html).not.toContain('<a class="pp-link"');
        expect(html).toContain('Václav Fíšek');
    });
    it('set: anchors to members only', () => {
        const html = doc(fiskTree(), { links: 'set', setMembers: new Set(ids('otec', 'jan')) });
        expect(html).toContain('href="#vaclav-fisek-1830-1890"');
        expect(html).not.toContain('href="#anna-nova');
    });
    it('read-only: no way into the research', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].research = { hypotheses: [{ id: 'h1', title: 'Otec mohl být mlynář' }] };
        expect(body(d)).toContain('data-pp-action="research:open"');
        const op = opts();
        const ro = buildPersonPageBody(preparePersonPageData(d, op, { readOnly: true }), op);
        expect(ro).toContain('Otec mohl být mlynář');
        expect(ro).not.toContain('data-pp-action="research');
    });
});

describe('the file holds only the page', () => {
    const html = doc(fiskTree());
    it('no other people, sources or notes of the tree', () => {
        expect(html).not.toContain('Neznámý');
        expect(html).not.toContain('Cizí poznámka');
        expect(html).not.toContain('Nepoužitý pramen');
        const page = preparePersonPageData(fiskTree(), opts());
        expect(Object.keys(page.tree.persons).sort()).toEqual(['jan', 'karel', 'marie', 'matka', 'otec', 'petr', 'rosa']);
        expect(page.tree.persons['otec' as PersonId].notes).toBeUndefined();
    });
    it('no external references and nothing of the app', () => {
        expect(html).not.toMatch(/<link\b|src="https?:|@import|url\(\s*["']?https?:|strom-research:/i);
        expect(html).not.toContain('javascript:');
        expect(html).toMatch(/^<!doctype html><html lang="cs"/);
        expect(html).toContain('<meta name="generator" content="Strom">');
        expect(html).toContain('<title>Jan Fíšek (1860–1910)</title>');
        // http(s) links leave with rel + target.
        for (const m of html.matchAll(/<a [^>]*href="https?:[^"]*"[^>]*>/g)) {
            expect(m[0]).toContain('rel="noopener noreferrer"');
            expect(m[0]).toContain('target="_blank"');
        }
    });
    it('research ids are stripped from texts', () => {
        expect(html).not.toContain('[S0042]');
        expect(html).toContain('<code>S0042</code>');
        expect(stripResearchIds('A [M-12] b [G0001] c [D-x1]')).toEqual({ text: 'A b c', ids: ['M-12', 'G0001', 'D-x1'] });
    });
    it('the font CSS is embedded when given, with no way out of the style element', () => {
        const withFont = doc(fiskTree(), { fontCss: "@font-face{font-family:'Strom Serif';src:url(data:font/woff2;base64,AAAA)}</style><script>" });
        expect(withFont).toContain("font-family:'Strom Serif'");
        expect(withFont).not.toContain('</style><script>');
    });
});

describe('escaping and unsafe content', () => {
    function hostile(): StromData {
        const d = fiskTree();
        const jan = d.persons['jan' as PersonId];
        jan.firstName = '<script>alert(1)</script>';
        jan.lastName = 'O"Brien\'s';
        jan.notes = '<img src=x onerror=alert(2)>';
        jan.photo = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMyk+';
        jan.story = { status: 'final', text: '<b onclick="x()">bold</b>' };
        d.sources!.s1.title = '"><script>alert(4)</script>';
        d.sources!.s1.url = 'javascript:alert(5)';
        d.sources!.s2.excerpts = [{ id: 'x', dataUrl: 'data:image/jpeg;base64,AAAA" onerror="alert(6)', width: 1, height: 1, sizeBytes: 1 }];
        return d;
    }
    it('names, notes, the story and source titles are escaped', () => {
        for (const html of [body(hostile(), { open: new Set(['sources']) }), doc(hostile())]) {
            expect(html).not.toContain('<script>alert');
            expect(html).not.toContain('<img src=x');
            expect(html).not.toContain('<b onclick');
            expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
            expect(html).toContain('O&quot;Brien&#39;s');
        }
    });
    it('unsafe images are dropped; javascript: is never a link', () => {
        const html = doc(hostile());
        expect(html).not.toContain('image/svg');
        expect(html).not.toMatch(/<[^>]*\sonerror/);
        expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
        expect(html).not.toContain('javascript:');
        expect(html).toContain('pp-initials');
        expect(body(hostile())).not.toContain('javascript:');
    });
});

describe('privacy of the living', () => {
    function living(): StromData {
        const d: StromData = {
            persons: {
                karel: p('karel', 'Karel', 'Fíšek', 'male', { birthDate: '1925', deathDate: '1999', childIds: ids('eva'), partnerships: ['u2' as PartnershipId], birthSourceIds: ['s1'] }),
                lida: p('lida', 'Lída', 'Malá', 'female', { birthDate: '1950-05-05', partnerships: ['u2' as PartnershipId], childIds: ids('eva') }),
                eva: p('eva', 'Eva', 'Fíšková', 'female', { birthDate: '1952-07-14', birthPlace: 'Čapkov', parentIds: ids('karel', 'lida'), notes: 'Učitelka' }),
            },
            partnerships: {
                u2: { id: 'u2' as PartnershipId, person1Id: 'karel' as PersonId, person2Id: 'lida' as PersonId, status: 'married', childIds: ids('eva'), startDate: '1951-06-01', startPlace: 'Čapkov' } as Partnership,
            },
            sources: { s1: { id: 's1', title: 'Matrika Čapkov' } },
        } as StromData;
        return d;
    }
    it('a living person’s own page carries initials and the birth year only', () => {
        const op = opts({ personId: 'eva' as PersonId, mode: 'file', links: 'plain', privacy: 'initials' });
        const page = preparePersonPageData(living(), op);
        const html = buildPersonPageDocument(page, op);
        expect(html).not.toContain('Eva');
        expect(html).not.toContain('Fíšková');
        expect(html).not.toContain('Učitelka');
        expect(html).not.toContain('14. července');
        expect(html).toContain('E. F.');
        expect(personPageFileName(page)).toBe('stranka-osoby-e-f-1952.html');
    });
    it('a living relative is initials on another page, never a link', () => {
        const op = opts({ personId: 'karel' as PersonId, mode: 'file', links: 'set', setMembers: new Set(ids('eva', 'karel')), privacy: 'initials' });
        const html = buildPersonPageDocument(preparePersonPageData(living(), op), op);
        expect(html).not.toContain('Eva');
        expect(html).not.toContain('Lída');
        expect(html).not.toMatch(/href="#[^"]*e-f/);
        // The privacy keeps a year at most (as everywhere in the app).
        expect(html).not.toContain('června 1951');
    });
    it('full privacy keeps everything; a protected tree is reused', () => {
        const prot = protectPersonPageTree(living(), 'full', NOW);
        expect(prot.living.has('eva' as PersonId)).toBe(true);
        const op = opts({ personId: 'eva' as PersonId, mode: 'file', links: 'plain', privacy: 'full' });
        const page = preparePersonPageData(living(), op, { protected: prot });
        expect(buildPersonPageDocument(page, op)).toContain('Eva Fíšková');
        expect(personPageFileName(page)).toBe('eva-fiskova-1952.html');
    });
    it('names the living people the privacy choice is about; none on a page of the dead', () => {
        const op = opts({ personId: 'karel' as PersonId, mode: 'file', links: 'plain', privacy: 'full' });
        expect(personPageLivingNames(preparePersonPageData(living(), op)).sort()).toEqual(['Eva Fíšková', 'Lída Malá']);
        expect(personPageLivingNames(preparePersonPageData(fiskTree(), opts({ personId: 'karel' as PersonId })))).toEqual([]);
    });
});

describe('file name and size', () => {
    it('names the file after the person and the years', () => {
        expect(personPageFileName(preparePersonPageData(fiskTree(), opts()))).toBe('jan-fisek-1860-1910.html');
        const d = fiskTree();
        delete d.persons['jan' as PersonId].birthDate;
        expect(personPageFileName(preparePersonPageData(d, opts()))).toBe('jan-fisek.html');
    });
    it('the estimate matches the saved file', () => {
        const op = opts({ mode: 'file', links: 'plain' });
        const page = preparePersonPageData(fiskTree(), op);
        const est = estimatePersonPageSize(page, op);
        const real = new TextEncoder().encode(buildPersonPageDocument(page, op)).length;
        expect(Math.abs(est.bytes - real) / real).toBeLessThan(0.1);
        expect(est.images).toBe(2);
    });
    it('counts what each group holds', () => {
        const page = preparePersonPageData(fiskTree(), opts());
        expect(page.counts).toMatchObject({ childEvents: 1, excerpts: 2, sources: 3, materials: 0 });
        expect(page.counts.research).toBeGreaterThan(0);
    });
    it('says the size in MB with one decimal, never 0, with the language’s decimal mark', () => {
        expect(personPageSizeMb(2_340_000, 'en')).toBe('2.3');
        expect(personPageSizeMb(2_340_000, 'cs')).toBe('2,3');
        expect(personPageSizeMb(2_360_000, 'de')).toBe('2,4');
        expect(personPageSizeMb(12_000, 'en')).toBe('0.1');
        expect(personPageSizeMb(0, 'cs')).toBe('0,1');
        expect(personPageSizeMb(15_000_000, 'en')).toBe('15.0');
    });
});

describe('person sources (shared with the Sources dialog)', () => {
    it('one row per source with what it supports', () => {
        const rows = personSourceRows(fiskTree(), 'jan' as PersonId, getStringsForLang('cs'));
        expect(rows.map(r => r.source.id)).toEqual(['s1', 's2', 's3']);
        expect(rows[0].cites.map(c => c.label)).toEqual(['Narození 1860', 'Křest 1860']);
        expect(rows[1].cites[0].ctx).toEqual({ partnershipId: 'u1' });
    });
});

describe('languages', () => {
    it('English and German pages use their strings', () => {
        expect(body(fiskTree(), { lang: 'en' })).toContain('Family');
        expect(body(fiskTree(), { lang: 'de' })).toContain('Familie');
    });
});
