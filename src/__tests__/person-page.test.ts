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
    PERSON_PAGE_ALL_GROUPS, PersonPageOptions, personPageFileToggles, personPageSizeMb, personPageLivingNames, personPageExportPrivacy,
    personPageTocCurrent, dataUrlImageSize, personPageChartInput, personPageYear,
} from '../person-page.js';
import { PERSON_PAGE_CSS } from '../person-page-css.js';
import { historyKindSvg } from '../history-symbols.js';
import { lifelineGlyph } from '../lifeline-glyphs.js';
import { buildFamilyBook } from '../book.js';
import { getDemoTree } from '../demo-tree.js';
import { personSourceRows } from '../person-sources.js';
import { computePersonLifeline } from '../timeline.js';
import { parseHistoryPayload, HistoryPayload } from '../history.js';
import { getStringsForLang } from '../strings.js';
import { placeKey } from '../places.js';
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
        expect(html.indexOf('<header class="pp-hero"')).toBeLessThan(html.indexOf('pp-sec-family'));
        expect(sectionIds(html)).toEqual(['pp-sec-family', 'pp-sec-story', 'pp-sec-places', 'pp-sec-timeline', 'pp-sec-materials', 'pp-sec-notes', 'pp-sec-sources', 'pp-sec-research']);
        expect(personPageSections(html, 'cs').map(s => s.key)).toEqual(['family', 'story', 'places', 'timeline', 'materials', 'notes', 'sources', 'research']);
    });

    it('a person with only a name has a header and nothing empty', () => {
        const data: StromData = { persons: { x: p('x', 'Jakub', 'Prostý', 'male') }, partnerships: {} } as StromData;
        const html = body(data, { personId: 'x' as PersonId });
        expect(sectionIds(html)).toEqual([]);
        expect(html).toContain('Jakub Prostý');
        const file = doc(data, { personId: 'x' as PersonId });
        expect(file).toContain('<footer class="pp-foot">');
    });

    it('a story in draft is shown marked as a draft, in the window and in the file; the researchers section needs a research tree', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].story!.status = 'draft';
        const html = body(d, { research: false });
        expect(html).toContain('pp-sec-story');
        expect(html).toContain('Jan se narodil v Čapkově.');
        expect(html).toContain('<span class="pp-draft-tag">Návrh</span>');
        expect(html).not.toContain('pp-sec-research');
        const file = doc(d, { lang: 'de' });
        expect(file).toContain('Jan se narodil v Čapkově.');
        expect(file).toContain('<span class="pp-draft-tag">Entwurf</span>');
        // Without a title the tag sits in the section's heading.
        delete d.persons['jan' as PersonId].story!.title;
        expect(body(d, { lang: 'en' })).toContain('<h2 class="pp-kicker pp-story-kicker">Story <span class="pp-draft-tag">Draft</span></h2>');
        // An approved story has no tag.
        expect(body(fiskTree())).not.toContain('pp-draft-tag">');
    });

    it('a couple’s story follows the person’s own, on both partners’ pages; alone it still makes the section', () => {
        const d = fiskTree();
        d.partnerships['u1' as PartnershipId].story = { status: 'draft', text: 'Jan a Marie hospodařili na čísle 12. [S0042]' };
        const html = body(d);
        const own = html.indexOf('Oženil se s Marií.');
        // The own story and one chapter make two: the chapter is tinted (round 2, point 9).
        const couple = html.indexOf('<div class="pp-couple-story pp-couple-story--tint" id="pp-story-u1" tabindex="-1">');
        expect(own).toBeGreaterThan(0);
        expect(couple).toBeGreaterThan(own);
        expect(html).toContain('<h3 class="pp-ch-title">Jan Fíšek a Marie Dvořáková <span class="pp-draft-tag">Návrh</span></h3>');
        expect(html).toContain('Jan a Marie hospodařili na čísle 12.');
        expect(html).not.toContain('hospodařili na čísle 12. [S0042]');
        // Marie's page tells it too, she first (monogram and names); a title replaces the names as the heading.
        const marie = body(d, { personId: 'marie' as PersonId });
        expect(marie).toContain('<h3 class="pp-ch-title">Marie Dvořáková a Jan Fíšek <span class="pp-draft-tag">Návrh</span></h3>');
        // Her page has the chapter alone: no monogram; with her own story too, the monogram puts her first.
        expect(marie).not.toContain('pp-ch-mono');
        d.persons['marie' as PersonId].story = { status: 'final', text: 'Marie byla z mlýna.' };
        expect(body(d, { personId: 'marie' as PersonId })).toContain('<span class="pp-ch-mono" aria-hidden="true"><span>MD</span><span>JF</span></span>');
        delete d.persons['marie' as PersonId].story;
        d.partnerships['u1' as PartnershipId].story!.title = 'Dvůr pod kopcem';
        d.partnerships['u1' as PartnershipId].story!.status = 'final';
        const de = body(d, { lang: 'de' });
        expect(de).toContain('<h3 class="pp-ch-title">Dvůr pod kopcem</h3>');
        expect(de).toContain('<p class="pp-ch-pair">Jan Fíšek und Marie Dvořáková</p>');
        // Only the couple's story: the section and its place in the contents remain, in the file as well.
        delete d.persons['jan' as PersonId].story;
        const only = body(d);
        // A chapter alone is not tinted and has no monogram, but keeps its kicker (round 2, point 9).
        expect(only).toContain('<h2 class="pp-kicker pp-story-kicker">Vyprávění</h2><div class="pp-couple-story" id="pp-story-u1"');
        expect(only).not.toContain('pp-couple-story--tint');
        expect(only).not.toContain('pp-ch-mono');
        expect(only).toContain('<p class="pp-kicker pp-ch-kicker">Vyprávění manželství');
        expect(personPageSections(only, 'cs').map(x => x.key)).toContain('story');
        expect(doc(d, { lang: 'en' })).toContain('<h3 class="pp-ch-title">Dvůr pod kopcem</h3>');
    });

    it('the couple’s chapter: kicker with the marriage’s years, the partner named under it (spec 027 §5.2)', () => {
        const d = fiskTree();
        d.partnerships['u1' as PartnershipId].story = { status: 'final', text: 'Hospodařili spolu.' };
        const html = body(d);
        // 1888 (wedding) → 1910 (Jan, the first to die).
        expect(html).toContain('<p class="pp-kicker pp-ch-kicker">Vyprávění manželství · 1888–1910</p>');
        // The partner's name stands alone, in the nominative (round 2, point 8).
        expect(html).toContain('<p class="pp-ch-foot"><span class="pp-ch-also">Stejné vyprávění je i na stránce: <button type="button" class="pp-link" data-pp-person="marie">Marie Dvořáková</button>.</span></p>');
        expect(body(d, { lang: 'en' })).toContain('The same story is also on the page of: <button');
    });

    it('continued reading: the own story leads on to the chapters; after it a chapter folds to its first paragraph (spec 027 §6.1)', () => {
        const d = fiskTree();
        d.partnerships['u1' as PartnershipId].story = { status: 'final', text: 'Svatba byla v únoru.\n\nPak přišel mlýn.\n\nA pak děti.' };
        const html = body(d);
        expect(html).toContain('<p class="pp-story-cont"><span>Pokračuje vyprávěním manželství:</span> <button type="button" class="pp-link pp-story-jump" data-pp-story="pp-story-u1">Jan a Marie ↓</button></p>');
        // The window: the first paragraph, the rest hidden behind "Read all ▾" (state in the open set).
        expect(html).toContain('<div class="pp-prose"><p>Svatba byla v únoru.</p></div><div class="pp-ch-rest" id="pp-story-u1-rest" hidden><div class="pp-prose"><p>Pak přišel mlýn.</p><p>A pak děti.</p></div>');
        expect(html).toContain('<button type="button" class="pp-ch-more" aria-expanded="false" aria-controls="pp-story-u1-rest" data-pp-toggle="story-u1"><span class="pp-st-closed">Číst celé ▾</span><span class="pp-st-open">Sbalit ▴</span></button>');
        const open = body(d, { open: new Set(['story-u1']) });
        expect(open).toContain('<div class="pp-ch-rest" id="pp-story-u1-rest"><div class="pp-prose">');
        expect(open).toContain('aria-expanded="true"');
        // The file: the first paragraph outside, the rest in <details>; the jump is an anchor.
        const file = doc(d);
        expect(file).toContain('<div class="pp-prose"><p>Svatba byla v únoru.</p></div><details class="pp-ch-fold"><summary class="pp-ch-more">');
        // Opened, "Collapse ▴" stands after the last paragraph, not between the first one and the rest.
        expect(file).toMatch(/<details class="pp-ch-fold"><summary class="pp-ch-more">.*?<\/summary><div class="pp-prose"><p>Pak přišel mlýn\.<\/p><p>A pak děti\.<\/p><\/div><\/details><p class="pp-ch-foot"><button type="button" class="pp-ch-more pp-ch-less js-only" data-pp-fold-close>Sbalit ▴<\/button><span class="pp-ch-also">/);
        expect(file).toContain('html.js .pp-ch-fold[open] > summary { display: none; }');
        expect(file).toContain("q('[data-pp-fold-close]')");
        expect(file).toContain('<a class="pp-story-jump" href="#pp-story-u1" data-pp-story="pp-story-u1">Jan a Marie ↓</a>');
        // Print: everything unfolded.
        const print = body(d, { mode: 'print', links: 'plain' });
        expect(print).toContain('<p>Svatba byla v únoru.</p><p>Pak přišel mlýn.</p><p>A pak děti.</p>');
        expect(print).not.toContain('pp-ch-more');
        // The couple's story titled: the link carries the title.
        d.partnerships['u1' as PartnershipId].story!.title = 'Mlýn';
        expect(body(d)).toContain('data-pp-story="pp-story-u1">Mlýn ↓</button>');
        // A single paragraph never folds.
        d.partnerships['u1' as PartnershipId].story!.text = 'Jen jeden odstavec.';
        expect(body(d)).not.toContain('pp-ch-more');
        // Without the own story (Marie's page has none) the chapter is whole, no continuation line.
        d.partnerships['u1' as PartnershipId].story!.text = 'Svatba byla v únoru.\n\nPak přišel mlýn.';
        const marie = body(d, { personId: 'marie' as PersonId });
        expect(marie).not.toContain('pp-ch-more');
        expect(marie).not.toContain('pp-story-cont');
        expect(marie).toContain('<p>Svatba byla v únoru.</p><p>Pak přišel mlýn.</p>');
    });

    it('privacy leaves out a couple’s story with a living partner; a deceased couple keeps theirs', () => {
        const d = fiskTree();
        d.partnerships['u1' as PartnershipId].story = { status: 'final', text: 'Jan a Marie hospodařili na čísle 12.' };
        // Karel (deceased) with a second wife still living, no children to date her.
        d.persons['lida' as PersonId] = p('lida', 'Lída', 'Malá', 'female', { birthDate: '1950', partnerships: ['u2' as PartnershipId] });
        d.persons['karel' as PersonId].partnerships = ['u2' as PartnershipId];
        d.persons['karel' as PersonId].story = { status: 'final', text: 'Karel zůstal na statku.' };
        d.partnerships['u2' as PartnershipId] = { id: 'u2' as PartnershipId, person1Id: 'karel' as PersonId, person2Id: 'lida' as PersonId, status: 'married', childIds: [], story: { status: 'final', text: 'Karel a Lída žili ve mlýně.' } };
        expect(doc(d, { privacy: 'initials' })).toContain('Jan a Marie hospodařili na čísle 12.');
        const karel = doc(d, { personId: 'karel' as PersonId, privacy: 'initials' });
        expect(karel).not.toContain('žili ve mlýně');
        expect(karel).not.toContain('pp-couple-story"');
        // Karel is deceased: his own story stays.
        expect(karel).toContain('Karel zůstal na statku.');
        expect(doc(d, { personId: 'karel' as PersonId, privacy: 'full' })).toContain('Karel a Lída žili ve mlýně.');
    });

    it('the gallery shows safe images, with or without research (§3.3)', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].attachments = [
            { id: 'a1', name: 'dum.jpg', mimeType: 'image/jpeg', dataUrl: IMG, sizeBytes: 100, note: 'Dům čp. 12' },
            { id: 'a2', name: 'zlé.svg', mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', sizeBytes: 10 },
        ];
        const withResearch = body(d);
        expect(withResearch).toContain('pp-sec-materials');
        expect(withResearch).toContain('Dům čp. 12');
        expect(withResearch).not.toContain('image/svg');
        expect(body(d, { research: false })).toContain('Dům čp. 12');
    });
});

describe('family', () => {
    const tree = (html: string) => html.match(/<div class="pp-ft"[^>]*>.*?<\/div><div class="pp-rail">/)?.[0] ?? '';
    const rail = (html: string) => html.match(/<div class="pp-rail">.*?<\/div>(?=<div class="pp-ft-more">|<\/div><\/section>)/)?.[0] ?? '';
    it('the tree: parents above, the person marked, the partner beside with the marriage year, children under the union', () => {
        const app = tree(body(fiskTree()));
        expect(app).toMatch(/<button type="button" class="pp-ft-card pp-ft-card--partner pp-ft-link" data-pp-person="marie"[^>]*><span class="pp-ft-name" title="Marie Dvořáková">Marie Dvořáková<\/span><span class="pp-ft-years">1865–1930<\/span><\/button>/);
        expect(app).toContain('data-pp-person="otec"');
        expect(app).toContain('data-pp-person="petr"');
        expect(app).toMatch(/<span class="pp-ft-card pp-ft-card--me"[^>]*><span class="pp-ft-name" title="Jan Fíšek">/);
        expect(app).toContain('<span>⚭ 1888</span>');
        // Parents first, the person, the partner, the children (top to bottom).
        const top = (id: string) => Number(app.match(new RegExp(`data-pp-person="${id}" style="[^"]*top:(\\d+)px`))?.[1]);
        expect(top('otec')).toBeLessThan(top('marie'));
        expect(top('marie')).toBeLessThan(top('petr'));
        // The file: plain text cards, no buttons.
        const file = doc(fiskTree());
        expect(tree(file)).toContain('<span class="pp-ft-card pp-ft-card--partner" style=');
        expect(tree(file)).not.toContain('<button');
    });
    it('the rail (narrow pages): the union\'s date and place, the partner, the children', () => {
        const r = rail(body(fiskTree()));
        expect(r).toContain('⚭ 2. února 1888, Čapkov');
        expect(r).toContain('Děti (2)');
        expect(r.indexOf('data-pp-person="marie"')).toBeLessThan(r.indexOf('data-pp-person="petr"'));
    });
    it('three unions and more: the upright tree on every width, a union a row with the children in a grid (round 2, point 2)', () => {
        const d = fiskTree();
        const jan = d.persons['jan' as PersonId];
        for (const [k, name] of [['u2', 'Ludmila'], ['u3', 'Terezie']] as const) {
            const w = `w${k}`;
            d.persons[w as PersonId] = p(w, name, 'Fíšková', 'female', { birthDate: '1866', deathDate: '1931', partnerships: [k as PartnershipId] });
            d.partnerships[k as PartnershipId] = { id: k as PartnershipId, person1Id: 'jan' as PersonId, person2Id: w as PersonId, status: 'married', childIds: [] };
            jan.partnerships.push(k as PartnershipId);
        }
        const html = body(d);
        expect(html).not.toContain('<div class="pp-ft"');
        expect(html).toContain('<div class="pp-rail pp-rail--wide">');
        expect(html.match(/<div class="pp-rail-u">/g)).toHaveLength(3);
        expect(html).toContain('<div class="pp-rail-2 pp-rail-kidgrid">');
        // The file and the print carry it the same way.
        expect(doc(d)).toContain('<div class="pp-rail pp-rail--wide">');
        expect(doc(d)).not.toContain('<div class="pp-ft"');
        // Two unions keep the tree to the sides (and the narrow rail).
        delete d.partnerships['u3' as PartnershipId];
        jan.partnerships = jan.partnerships.filter(x => x !== 'u3');
        const two = body(d);
        expect(two).toContain('<div class="pp-ft"');
        expect(two).toContain('<div class="pp-rail">');
        expect(two).not.toContain('pp-rail--wide');
    });
    it('a union without a wedding date sorts by its first child, after a dated one of that year, no year last; its label says so (round 3, §4.5)', () => {
        const d = fiskTree();
        const jan = d.persons['jan' as PersonId];
        // u1 (1888) as data has it; u0 undated with a child of 1886; u2 undated with a child of 1888; u3 nothing; u4 an event of 1900.
        const add = (k: string, name: string, kids: [string, string][], extra: Partial<Partnership> = {}) => {
            const w = `w${k}`;
            d.persons[w as PersonId] = p(w, name, 'Fíšková', 'female', { birthDate: '1862', deathDate: '1931', partnerships: [k as PartnershipId] });
            for (const [kid, born] of kids) d.persons[kid as PersonId] = p(kid, `Dítě${kid}`, 'Fíšek', 'male', { birthDate: born, deathDate: '1950', parentIds: ids('jan', w) });
            d.partnerships[k as PartnershipId] = { id: k as PartnershipId, person1Id: 'jan' as PersonId, person2Id: w as PersonId, status: 'married', childIds: ids(...kids.map(x => x[0])), ...extra };
            jan.partnerships.push(k as PartnershipId);
            jan.childIds.push(...ids(...kids.map(x => x[0])));
        };
        add('u3', 'Terezie', []);
        add('u2', 'Ludmila', [['k2', '1888-06-01']]);
        add('u0', 'Kateřina', [['k0', '1886']]);
        add('u4', 'Bohumila', [], { events: [{ id: 'pe1', type: 'custom', date: '1900' }] as Partnership['events'] });
        const html = body(d);
        // 5 unions: the upright tree, a union a row in the sorted order.
        const order = [...html.matchAll(/<div class="pp-rail-u"><div class="pp-rail-side">.*?data-pp-person="(w?u?\w+)"/g)].map(m => m[1]);
        expect(order).toEqual(['wu0', 'marie', 'wu2', 'wu4', 'wu3']);
        expect(html).toContain('⚭ rok neznámý · děti od 1886');
        expect(html).toContain('⚭ rok neznámý · děti od 1888');
        // An event alone gives the order, not the label; no inferred "before 1886".
        expect(html).not.toContain('děti od 1900');
        expect(html).not.toContain('před 1886');
        expect(body(d, { lang: 'en' })).toContain('⚭ year unknown · children from 1886');
        expect(body(d, { lang: 'de' })).toContain('⚭ Jahr unbekannt · Kinder ab 1886');
        // The tree to the sides (two unions): the label in two lines.
        for (const k of ['u2', 'u3', 'u4']) {
            delete d.partnerships[k as PartnershipId];
            jan.partnerships = jan.partnerships.filter(x => x !== k);
        }
        const ft = tree(body(d));
        expect(ft).toContain('<span>⚭ rok neznámý</span><span class="pp-ft-from">děti od 1886</span>');
        expect(ft.indexOf('data-pp-person="wu0"')).toBeLessThan(ft.indexOf('data-pp-person="marie"'));
    });
    it('over five children: every row has its own bus with ticks, a trunk runs to the last row\'s bus (round 2, K2-2b)', () => {
        const d = fiskTree();
        const kids = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
        for (const [i, k] of kids.entries()) {
            d.persons[k as PersonId] = p(k, `Dítě${i + 1}`, 'Fíšek', 'male', { birthDate: `${1889 + i}`, deathDate: '1950', parentIds: ids('jan', 'marie') });
        }
        d.persons['jan' as PersonId].childIds = ids(...kids);
        d.persons['marie' as PersonId].childIds = ids(...kids);
        d.partnerships['u1' as PartnershipId].childIds = ids(...kids);
        delete d.persons['petr' as PersonId];
        delete d.persons['rosa' as PersonId];
        const ft = tree(body(d));
        const tops = [...new Set(kids.map(k => Number(ft.match(new RegExp(`data-pp-person="${k}" style="[^"]*top:(\\d+)px`))![1])))];
        expect(tops).toHaveLength(2);
        const hs = [...ft.matchAll(/<span class="pp-ft-h" style="left:([\d.]+)%;top:(\d+)px;width:([\d.]+)%"/g)].map(m => ({ left: +m[1], top: +m[2], w: +m[3] }));
        const vs = [...ft.matchAll(/<span class="pp-ft-v" style="left:([\d.]+)%;top:(\d+)px;height:(\d+)px"/g)].map(m => ({ left: +m[1], top: +m[2], h: +m[3] }));
        for (const t of tops) {
            // A bus 12 px over the row, a 12 px tick down to each of its cards.
            expect(hs.some(h => h.top === t - 12)).toBe(true);
            expect(vs.filter(v => v.top === t - 12 && v.h === 12).length).toBeGreaterThanOrEqual(2);
        }
        // The trunk: one vertical line ends on the last row's bus.
        const lastBus = Math.max(...tops) - 12;
        expect(vs.some(v => v.top + v.h === lastBus && v.h > 50)).toBe(true);
        // The shorter last row (2 of 7) is centred under the trunk.
        const trunk = vs.find(v => v.top + v.h === lastBus && v.h > 50)!;
        const last = hs.find(h => h.top === lastBus)!;
        expect(Math.abs(last.left + last.w / 2 - trunk.left)).toBeLessThan(0.5);
    });
    it('in the 960 px column the tree keeps 680 px in the middle, only the children\'s row is wider: up to 7 cards (round 5, K5-37)', () => {
        const d = fiskTree();
        // Two children fit the 680 px tree as they are: no wide variant.
        expect(body(d)).not.toContain('<div class="pp-ft9"');
        const kids = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
        for (const [i, k] of kids.entries()) {
            d.persons[k as PersonId] = p(k, `Dítě${i + 1}`, 'Fíšek', 'male', { birthDate: `${1889 + i}`, deathDate: '1950', parentIds: ids('jan', 'marie') });
        }
        d.persons['jan' as PersonId].childIds = ids(...kids);
        d.persons['marie' as PersonId].childIds = ids(...kids);
        d.partnerships['u1' as PartnershipId].childIds = ids(...kids);
        delete d.persons['petr' as PersonId];
        delete d.persons['rosa' as PersonId];
        const html = body(d);
        const wide = html.match(/<div class="pp-ft9"[^>]*>.*?<\/div>(?=<div class="pp-ft")/)?.[0] ?? '';
        expect(wide).not.toBe('');
        // The 680 px tree is still there (under 1280 px, print).
        expect(tree(html)).toContain('data-pp-person="k7"');
        const box = (id: string) => {
            const at = id === 'jan' ? 'pp-ft-card--me"' : `data-pp-person="${id}"`;
            const m = wide.match(new RegExp(`${at} style="left:([\\d.]+)%;top:(\\d+)px;width:([\\d.]+)%`))!;
            return { left: +m[1] * 9.6, top: +m[2], w: +m[3] * 9.6 };
        };
        // The person and the partner: the 680 px geometry moved 140 px into the middle of 960.
        expect(box('jan').left).toBeCloseTo(140 + 265, 0);
        expect(box('jan').w).toBeCloseTo(150, 0);
        expect(box('marie').left).toBeCloseTo(140, 0);
        // Seven children in one row of 126 px cards 10 px apart.
        const row = kids.map(box);
        expect(new Set(row.map(r => r.top)).size).toBe(1);
        expect(row.every(r => Math.abs(r.w - 126) < 0.5)).toBe(true);
        expect(row[1].left - row[0].left).toBeCloseTo(136, 0);
        const trunk = [...wide.matchAll(/<span class="pp-ft-v" style="left:([\d.]+)%;top:(\d+)px;height:(\d+)px"/g)]
            .map(m => ({ x: +m[1] * 9.6, end: +m[2] + +m[3] })).find(v => v.end === row[0].top - 12)!;
        // The row (942 px) is pushed into the column; the union's trunk ends on its bus.
        expect(row[0].left).toBeGreaterThanOrEqual(0);
        expect(row[6].left + 126).toBeLessThanOrEqual(960.5);
        expect(trunk.x).toBeGreaterThan(row[0].left);
        expect(trunk.x).toBeLessThan(row[6].left + 126);
        // Four children under the left partner: at 680 the group is pushed to the edge, at 960 it sits centred under the trunk.
        const four = kids.slice(0, 4);
        d.partnerships['u1' as PartnershipId].childIds = ids(...four);
        d.persons['jan' as PersonId].childIds = ids(...four);
        d.persons['marie' as PersonId].childIds = ids(...four);
        for (const k of kids.slice(4)) delete d.persons[k as PersonId];
        const w4 = body(d).match(/<div class="pp-ft9"[^>]*>.*?<\/div>(?=<div class="pp-ft")/)?.[0] ?? '';
        const lefts = four.map(k => +w4.match(new RegExp(`data-pp-person="${k}" style="left:([\\d.]+)%`))![1] * 9.6);
        const stem = [...w4.matchAll(/<span class="pp-ft-v" style="left:([\d.]+)%;top:(\d+)px;height:(\d+)px"/g)].map(m => +m[1] * 9.6);
        expect(stem.some(x => Math.abs((lefts[0] + lefts[3] + 126) / 2 - x) < 0.5)).toBe(true);
        // The CSS shows it only from 1280 px, never in print.
        expect(PERSON_PAGE_CSS).toMatch(/@media screen and \(min-width: 1280px\) \{[^}]*\}[^@]*\.pp-fam\.pp-wide \.pp-ft9 \{ display: block; max-width: 960px/);
        expect(PERSON_PAGE_CSS).toContain('.pp-fam.pp-wide .pp-ft9 + .pp-ft { display: none; }');
        expect(PERSON_PAGE_CSS).toContain('.pp-ft9 { display: none !important; }');
    });
    it('a step-parent is labelled and joined by a dashed line; a couple without children says so', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].parentRelTypes = { otec: 'step' } as Person['parentRelTypes'];
        d.persons['jan' as PersonId].childIds = [];
        d.partnerships['u1' as PartnershipId].childIds = [];
        const html = body(d);
        expect(tree(html)).toContain('<span class="pp-ft-rel">nevlastní otec</span>');
        expect(tree(html)).toContain('pp-ft-dash');
        expect(tree(html)).toContain('bez dětí');
    });
    it('the cards and chips keep the precision of a life date: about, before, a range of years', () => {
        const d = fiskTree();
        d.persons['otec' as PersonId].birthDate = '~1798';
        d.persons['matka' as PersonId].birthDate = '1802..1804';
        d.persons['matka' as PersonId].deathDate = '<1850';
        d.persons['karel' as PersonId].birthDate = '>1862';
        delete d.persons['karel' as PersonId].deathDate;
        d.partnerships['u1' as PartnershipId].startDate = '~1888';
        const html = body(d);
        expect(html).toContain('<span class="pp-ft-years" title="asi 1798 – 1890">asi 1798 – 1890</span>');
        expect(html).toContain('<span class="pp-ft-years" title="1802–1804 – před 1850">1802–1804 – před 1850</span>');
        expect(html).toContain('<span class="pp-chip-years">* po 1862</span>');
        expect(html).toContain('<span>⚭ asi 1888</span>');
        expect(html).not.toContain('1798–1890');
        expect(html).not.toContain('1802–1850');
        // Plain years stay as they were; the English page in its words.
        expect(html).toContain('<span class="pp-ft-years">1865–1930</span>');
        expect(body(d, { lang: 'en' })).toContain('<span class="pp-ft-years" title="1802–1804 – before 1850">1802–1804 – before 1850</span>');
    });
    it('siblings over three and the grandchildren are folded rows of chips', () => {
        const d = fiskTree();
        for (const k of ['s2', 's3', 's4']) {
            d.persons[k as PersonId] = p(k, `Sourozenec${k}`, 'Fíšek', 'male', { birthDate: '1870', parentIds: ids('otec', 'matka') });
            d.persons['otec' as PersonId].childIds.push(k as PersonId);
        }
        d.persons['vnucka' as PersonId] = p('vnucka', 'Božena', 'Fíšková', 'female', { birthDate: '1915', deathDate: '1990', parentIds: ids('rosa') });
        d.persons['rosa' as PersonId].childIds = ids('vnucka');
        const html = body(d);
        expect(html).toContain('aria-controls="pp-sibs-body"');
        expect(html).toMatch(/id="pp-sibs-body" hidden/);
        expect(html).toContain('Sourozenci (4)');
        expect(html).toContain('Vnoučata (1)');
        expect(html).toMatch(/id="pp-grand-body" hidden><div class="pp-chips"><button type="button" class="pp-chip pp-chip-link" data-pp-person="vnucka"><span class="pp-chip-name">Božena Fíšková<\/span> <span class="pp-chip-years">1915–1990<\/span><\/button>/);
        // Three siblings or fewer: a plain row.
        expect(body(fiskTree())).toContain('<div class="pp-ft-row pp-ft-row--open"><span class="pp-ft-row-h">Sourozenci (1)</span>');
        // The file: <details>, the chips plain text.
        const file = doc(d);
        expect(file).toContain('<details class="pp-coll pp-ft-row pp-grand" id="pp-grand">');
        expect(file).toContain('<span class="pp-chip"><span class="pp-chip-name">Božena Fíšková</span>');
    });
});

describe('default folds', () => {
    it('siblings, sources, each source, the basis and the researchers section start closed', () => {
        const html = body(fiskTree());
        for (const id of ['pp-sources', 'pp-src-s1', 'pp-basis', 'pp-research']) {
            expect(html).toContain(`aria-controls="${id}-body"`);
            expect(html).toMatch(new RegExp(`id="${id}-body" hidden`));
        }
        expect(html).toContain('aria-expanded="false"');
        // The researchers' intro stays visible above the fold.
        expect(html.indexOf('pp-research-intro')).toBeLessThan(html.indexOf('id="pp-research-body"'));
    });

    it('open keys open them', () => {
        const html = body(fiskTree(), { open: new Set(['sources', 's:s1']) });
        expect(html).toContain('id="pp-sources-body">');
        expect(html).toContain('id="pp-src-s1-body">');
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
        // The number and its unit never part at a line break.
        expect(html).toContain('ve věku 50\u00a0let');
        expect(body(fiskTree(), { lang: 'en' })).toContain('aged\u00a050');
        expect(body(fiskTree(), { lang: 'de' })).toContain('im Alter von 50\u00a0Jahren');
    });
    it('approximate dates and English', () => {
        expect(personPageDate('~1835', 'cs')).toBe('asi 1835');
        expect(personPageDate('1860-03-12', 'en')).toContain('1860');
        expect(personPageDate('1860-03-12', 'en')).toMatch(/March/);
    });
    it('an occupation keeps the precision of its date: before, after, about, a period (round 3, finding 3)', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].events!.push(
            { id: 'o1', type: 'occupation', date: '<1895', note: 'zámečník' },
            { id: 'o2', type: 'occupation', date: '1896/1901', note: 'hostinský' },
            { id: 'o3', type: 'occupation', date: '~1905', note: 'rolník' },
            { id: 'o4', type: 'occupation', date: '1908-04-01', note: 'starosta' },
        );
        const html = body(d);
        expect(html).toContain('zámečník (před 1895), hostinský (1896–1901), rolník (asi 1905), starosta (1908)');
        expect(html).not.toContain('zámečník (1895)');
        expect(personPageYear('>1880', 'cs')).toBe('po 1880');
        expect(personPageYear('<1965', 'en')).toBe('before 1965');
        expect(personPageYear('<1965', 'de')).toBe('vor 1965');
        expect(personPageYear('/1965', 'cs')).toBe('do 1965');
        expect(personPageYear('1890..1892', 'cs')).toBe('1890–1892');
        expect(personPageYear('1890-05-01', 'cs')).toBe('1890');
    });
    it('for researchers: the certainty of the facts and how many a source backs (§0.6)', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].birthStatus = 'proven';
        d.partnerships['u1' as PartnershipId].startStatus = 'probable';
        const html = body(d);
        const sec = html.slice(html.indexOf('id="pp-sec-research"'));
        expect(sec).toContain('<p class="pp-kicker">Jistota údajů</p>');
        // Birth, death, baptism, burial, emigration, the marriage: birth, death, baptism and marriage cite a source.
        expect(sec).toContain('<li>Doloženo prameny: 4 z 6 údajů</li>');
        expect(sec).toContain('<li><strong>Narození 1860:</strong> Doložené</li>');
        expect(sec).toContain('<li><strong>Sňatek 1888:</strong> Pravděpodobné</li>');
        expect(body(d, { lang: 'en' })).toContain('Backed by sources: 4 of 6 facts');
        expect(body(d, { lang: 'de' })).toContain('Durch Quellen belegt: 4 von 6 Angaben');
        expect(body(d, { research: false })).not.toContain('Jistota údajů');
        // A protected file: a marriage to a living partner counts neither its status nor its sources.
        const live = fiskTree();
        live.partnerships['u1' as PartnershipId].startStatus = 'probable';
        // Marie living: no death and no children born long ago to date her.
        Object.assign(live.persons['marie' as PersonId], { birthDate: '1950', deathDate: undefined, childIds: [] });
        live.partnerships['u1' as PartnershipId].childIds = [];
        for (const k of ['petr', 'rosa']) live.persons[k as PersonId].parentIds = ids('jan');
        Object.assign(live.persons['jan' as PersonId], { birthDate: '1948-03-12', deathDate: '2010-11-02' });
        live.persons['jan' as PersonId].events = [];
        live.partnerships['u1' as PartnershipId].startDate = '1975-02-02';
        const prot = doc(live, { privacy: 'initials' });
        expect(prot).toContain('Doloženo prameny: 2 z 2 údajů');
        expect(prot).not.toContain('Pravděpodobné');
        expect(doc(live)).toContain('Doloženo prameny: 3 z 3 údajů');
        // A living person's own page in a protected file: the header alone.
        expect(doc(live, { personId: 'marie' as PersonId, privacy: 'initials' })).not.toContain('Jistota údajů');
    });
    it('an occupation keeps the precision of its date in the places, on the map and on the timeline too (round 3, N1)', () => {
        const d = fiskTree();
        d.places = { [placeKey('Čapkov')]: { lat: 49.6, lon: 15.6 }, [placeKey('Vídeň')]: { lat: 48.21, lon: 16.37 }, [placeKey('Brno')]: { lat: 49.19, lon: 16.61 } };
        d.persons['jan' as PersonId].events!.push(
            { id: 'o1', type: 'occupation', date: '<1895', note: 'zámečník', place: 'Brno' },
            { id: 'o2', type: 'occupation', date: '1896/1901', note: 'hostinský' },
        );
        const html = body(d);
        // Timeline: the word small above the year, a range in two lines as elsewhere.
        expect(html).toContain('<span class="pp-y"><span class="pp-yr"><small>před</small><b>1895</b></span></span>');
        expect(html).toContain('<span class="pp-y"><span class="pp-yr"><b>1896</b><small>–1901</small></span></span>');
        // Places list and the map's label.
        expect(html).toContain('povolání před 1895');
        expect(html).not.toContain('povolání 1895');
        expect(html).toMatch(/Brno<span class="pp-map-yr y-d">před 1895<\/span>/);
        expect(body(d, { lang: 'de' })).toContain('vor 1895');
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
    it('a recorded age shows in the row only when it differs from the dates, or the dates give none (§0.6)', () => {
        const d = fiskTree();
        const jan = d.persons['jan' as PersonId];
        // Jan died aged 50 by the dates (1860-03-12 → 1910-11-02).
        jan.deathAge = '50 let';
        d.partnerships['u1' as PartnershipId].ages = { jan: '27 let' };
        expect(body(d)).not.toContain('podle záznamu');
        jan.deathAge = '54 let';
        d.partnerships['u1' as PartnershipId].ages = { jan: '25 let' };
        const html = body(d);
        expect(html).toContain('podle záznamu 54 let');
        expect(html).toContain('podle záznamu 25 let');
        expect(body(d, { lang: 'en' })).toContain('54 years per the record');
        expect(body(d, { lang: 'de' })).toContain('laut Eintrag 54 Jahre');
        // Without a birth (nor a baptism) the record is the only age there is; a non-number is quoted as written.
        delete jan.birthDate;
        jan.events = jan.events!.filter(e => e.type !== 'baptism');
        jan.events.push({ id: 'e9', type: 'military', date: '1880', age: '1 rok' });
        jan.deathAge = 'kmet';
        const noBirth = body(d);
        expect(noBirth).toContain('podle záznamu 1 rok');
        expect(noBirth).toContain('podle záznamu: kmet');
        expect(getStringsForLang('cs').personPage.detail.recordedAge(3)).toBe('podle záznamu 3 roky');
    });

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

    it('the saved file starts with every switch as the window shows it (what is visible is what gets saved)', () => {
        expect(personPageFileToggles({ history: false, childEvents: false, kidPlaces: false })).toEqual({ history: false, childEvents: false, kidPlaces: false });
        expect(personPageFileToggles({ history: true, childEvents: true })).toEqual({ history: true, childEvents: true, kidPlaces: true });
        const off = doc(fiskTree(), { toggles: personPageFileToggles({ history: false, childEvents: false, kidPlaces: true }) });
        // The rows stay in the file (its own switch turns them back on), hidden by the article's classes.
        expect(off).toMatch(/<article class="pp pp-no-history pp-no-kids"/);
        expect(off).toContain('aria-checked="false" data-pp-switch="childEvents"');
        expect(off).toContain('pp-row--kid');
        expect(doc(fiskTree(), { toggles: personPageFileToggles({ history: true, childEvents: true }) })).toMatch(/<article class="pp"/);
    });

    it('main excerpts sit at the birth and marriage rows; the source refers to them', () => {
        const html = body(fiskTree(), { open: new Set(['sources', 's:s1']) });
        expect(html).toContain('id="pp-ex-birth"');
        expect(html).toContain('Zápis o narození a křtu v matrice narozených, Čapkov 1860');
        expect(html).toContain('id="pp-ex-marriage-1"');
        expect(html).toContain('href="#pp-ex-birth"');
        // Two at the rows, both again in the gallery.
        expect((html.match(/<img /g) ?? []).length).toBe(4);
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

describe('links to the scans in the archive (K1.5)', () => {
    const fig = (html: string, id: string) => html.match(new RegExp(`<figure class="pp-fig" id="${id}">[\\s\\S]*?</figure>`))?.[0] ?? '';
    const card = (html: string, sid: string) => html.match(new RegExp(`<li class="pp-src">(?:(?!<li class="pp-src">)[\\s\\S])*?id="pp-src-${sid}-body"[\\s\\S]*?</li>`))?.[0] ?? '';
    function scans(): StromData {
        const d = fiskTree();
        d.sources!.s1.excerpts![0].pageUrl = 'https://example.org/scan/12';
        d.sources!.s1.excerpts!.push(
            { id: 'x1b', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100, caption: 'Druhý výřez', pageUrl: 'https://example.org/scan/13' },
            { id: 'x1c', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100, caption: 'Třetí výřez', pageUrl: 'https://example.org/scan/14' },
        );
        return d;
    }

    it('an event\'s excerpt links its own scan, else its source\'s page, else nothing', () => {
        const own = fig(body(scans()), 'pp-ex-birth');
        expect(own).toContain('<p class="pp-fig-scan"><a href="https://example.org/scan/12" rel="noopener noreferrer" target="_blank">Sken v archivu ↗</a></p>');
        // s1's excerpt without a page of its own: the source's page.
        expect(fig(body(fiskTree()), 'pp-ex-birth')).toContain('<a href="https://example.org/scan" rel="noopener noreferrer" target="_blank">Stránka v archivu ↗</a>');
        // s2 has neither: no line under the image.
        expect(fig(body(fiskTree()), 'pp-ex-marriage-1')).not.toContain('pp-fig-scan');
    });

    it('each excerpt in a source card links its own scan; the card\'s link is a page not linked yet', () => {
        const html = body(scans(), { open: new Set(['sources', 's:s1']) });
        const c = card(html, 's1');
        expect(c).toContain('href="https://example.org/scan/13"');
        expect(c).toContain('href="https://example.org/scan/14"');
        expect(c.match(/class="pp-fig-scan"/g)).toHaveLength(2);
        // The first excerpt sits at the birth row with its link; the card names the source's page.
        expect(c).not.toContain('scan/12');
        expect(c).toContain('<p><a href="https://example.org/scan" rel="noopener noreferrer" target="_blank">Stránka v archivu ↗</a></p>');
        // Without a page of the source: the main excerpt's page is still reachable from the card.
        const d = scans();
        delete d.sources!.s1.url;
        const c2 = card(body(d, { open: new Set(['sources', 's:s1']) }), 's1');
        expect(c2).toContain('<p><a href="https://example.org/scan/12" rel="noopener noreferrer" target="_blank">Stránka v archivu ↗</a></p>');
        // The same page on a card's excerpt and the source: once.
        d.sources!.s1.url = 'https://example.org/scan/13';
        d.sources!.s1.excerpts![0].pageUrl = undefined;
        const c3 = card(body(d, { open: new Set(['sources', 's:s1']) }), 's1');
        expect(c3.match(/scan\/13"/g)).toHaveLength(1);
        // The file carries the same links.
        const file = doc(scans());
        expect(fig(file, 'pp-ex-birth')).toContain('href="https://example.org/scan/12"');
        expect(file).toContain('href="https://example.org/scan/13"');
        expect(file).toContain('href="https://example.org/scan/14"');
        expect(file).toContain('target="_blank"');
    });

    it('only http(s) pages become links', () => {
        const d = scans();
        d.sources!.s1.excerpts![0].pageUrl = 'javascript:alert(1)';
        d.sources!.s1.excerpts![1].pageUrl = 'data:text/html,x';
        d.sources!.s1.url = 'javascript:alert(2)';
        for (const html of [body(d, { open: new Set(['sources', 's:s1']) }), doc(d)]) {
            expect(html).not.toContain('javascript:');
            expect(html).not.toContain('data:text/html');
            expect(fig(html, 'pp-ex-birth')).not.toContain('pp-fig-scan');
        }
        expect(doc(d)).toContain('href="https://example.org/scan/14"');
    });

    it('a protected file links no scan of a living person\'s record (initials)', () => {
        const d: StromData = {
            persons: {
                karel: p('karel', 'Karel', 'Fíšek', 'male', { birthDate: '1925', deathDate: '1999', childIds: ids('eva'), birthSourceIds: ['s1'] }),
                eva: p('eva', 'Eva', 'Fíšková', 'female', { birthDate: '1952-07-14', parentIds: ids('karel'), birthSourceIds: ['s2'] }),
            },
            partnerships: {},
            sources: {
                s1: { id: 's1', title: 'Matrika narozených Čapkov 1925', excerpts: [{ id: 'xk', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100, pageUrl: 'https://example.org/karel' }] },
                s2: { id: 's2', title: 'Matrika narozených Čapkov 1952', url: 'https://example.org/kniha-1952', excerpts: [{ id: 'xe', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100, pageUrl: 'https://example.org/eva' }] },
            },
        } as StromData;
        for (const personId of ids('karel', 'eva')) {
            const html = doc(d, { personId, privacy: 'initials' });
            expect(html).not.toContain('example.org/eva');
            expect(html).not.toContain('kniha-1952');
        }
        expect(doc(d, { personId: 'karel' as PersonId, privacy: 'initials' })).toContain('href="https://example.org/karel"');
        // Full data (the window, or a file without protection) keeps it.
        expect(doc(d, { personId: 'eva' as PersonId, privacy: 'full' })).toContain('href="https://example.org/eva"');
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

    it('the legend names only the kinds of history the rows carry, in the window and the file', () => {
        for (const mode of ['app', 'file'] as const) {
            const op = opts({ mode, links: mode === 'app' ? 'app' : 'plain' });
            const page = preparePersonPageData(fiskTree(), op, { history: { payload } });
            const html = mode === 'app' ? buildPersonPageBody(page, op) : buildPersonPageDocument(page, op);
            const legend = html.match(/<p class="pp-legend">([\s\S]*?)<\/p>/)?.[1] ?? '';
            expect(legend).toContain('Dějiny regionu');
            expect(legend).not.toContain('Dějiny místa');
            expect(legend).not.toContain('Z pramenů');
            expect(legend.match(/class="pp-hm /g)).toHaveLength(1);
            // Round 3 §10: under it the kinds shown, the symbol and its name (only "war" here).
            const kinds = html.match(/<p class="pp-legend-kinds">([\s\S]*?)<\/p>/)?.[1] ?? '';
            expect(kinds).toBe(`<span><span class="pp-lk" aria-hidden="true">${historyKindSvg('war', 12)}</span>válka</span>`);
        }
    });

    it('a history row: the kind\'s symbol in the circle in the origin\'s colour, the origin at its corner; own rows carry the card\'s glyphs (round 3 §10)', () => {
        for (const mode of ['app', 'file'] as const) {
            const op = opts({ mode, links: mode === 'app' ? 'app' : 'plain' });
            const page = preparePersonPageData(fiskTree(), op, { history: { payload } });
            const html = mode === 'app' ? buildPersonPageBody(page, op) : buildPersonPageDocument(page, op);
            expect(html).toContain(`<span class="pp-mk pp-mk-h is-region" title="válka" aria-hidden="true">${historyKindSvg('war', 14)}<span class="pp-mk-o" aria-hidden="true"></span></span>`);
            // No Unicode marks left in the circles: the glyphs are SVG (13 px), nothing in the text.
            const marks = [...html.matchAll(/<span class="pp-mk[^"]*"[^>]*>([\s\S]*?)<\/span><\/span>/g)].map(m => m[1]);
            expect(marks.length).toBeGreaterThan(3);
            for (const m of marks) expect(m.replace(/<[^>]*>/g, '')).toBe('');
            expect(html).toContain(lifelineGlyph({ kind: 'birth' }, 13));
            expect(html).toContain(lifelineGlyph({ kind: 'death' }, 13));
            expect(html).toContain(lifelineGlyph({ kind: 'marriage' }, 13));
        }
    });
});

describe('history spans and the folded sources', () => {
    it('a span of years is two lines in the year column, the start in bold, "–1890" under it; "age 24–39" stays one piece (round 3, §2.8)', () => {
        const payload = parseHistoryPayload({
            state: { on: true, search: 'done', at: '2026-10-27T14:05:00Z' }, lang: 'cs', hidden: [],
            events: [{
                id: 'cz-bohemia-0002', from: 1880, to: 1890, kind: 'war', scope: 'region',
                region: { id: 'cz-bohemia', name: { cs: 'Kraj' } }, text: { cs: 'Válka v kraji' },
                source: { title: 'Období', publisher: 'Wikipedie', url: 'https://cs.wikipedia.org/wiki/Y', checked: '2026-10-27' },
            }],
            places: { 'Čapkov': { events: ['cz-bohemia-0002'] } },
        }, '2026-10-27T14:05:00Z')!;
        const d = fiskTree();
        d.persons['jan' as PersonId].events!.push({ id: 'e4', type: 'residence', date: 'FROM 1895 TO 1900', place: 'Lhota' });
        for (const mode of ['app', 'file'] as const) {
            const op = opts({ mode, links: mode === 'app' ? 'app' : 'plain' });
            const html = buildPersonPageBody(preparePersonPageData(d, op, { history: { payload } }), op);
            expect(html).toContain('<span class="pp-y"><span class="pp-yr"><b>1880</b><small>–1890</small></span></span>');
            expect(html).toContain('<span class="pp-y">1860</span>');
            expect(html).not.toContain('<wbr>');
            expect(html).toContain('<span class="pp-nw">věk 20–30</span>');
            // The file carries the two-line rule (no JavaScript needed).
            if (mode === 'file') {
                const file = buildPersonPageDocument(preparePersonPageData(d, op, { history: { payload } }), op);
                expect(file).toContain('.pp-yr { display: inline-flex; flex-direction: column;');
            }
        }
    });

    it('folded, the sources name three titles in plain text under the heading and count the rest', () => {
        const d = fiskTree();
        for (let i = 0; i < 28; i++) {
            const id = `m${i}`;
            d.sources![id] = { id, title: `Velmi dlouhý název pramene číslo ${i} z archivu v Čapkově, fol. ${i}` };
            d.persons['jan' as PersonId].sourceIds = [...(d.persons['jan' as PersonId].sourceIds ?? []), id];
        }
        for (const s of Object.values(d.sources!)) s.title = `${s.title}, fond Farní úřad Čapkov, inventární číslo 12, signatura II/3`;
        for (const mode of ['app', 'file'] as const) {
            const op = opts({ mode, links: mode === 'app' ? 'app' : 'plain' });
            const html = buildPersonPageBody(preparePersonPageData(d, op), op);
            const peek = html.match(/<span class="pp-peek">([^<]*)<\/span>/)?.[1] ?? '';
            expect(peek.split(' · ')).toHaveLength(4);
            expect(peek).toMatch(/ · a 28 dalších$/);
            // A long title is cut at a word, so three titles stay a short preview.
            const titles = peek.split(' · ').slice(0, 3);
            for (const t of titles) expect(t.length).toBeLessThanOrEqual(60);
            expect(titles.every(t => /[^\s,(]…$/.test(t))).toBe(true);
            // Not inside the heading (where it took the heading's font and pushed it aside).
            const heading = html.match(/<h2 class="pp-fold-h">((?:(?!<\/h2>).)*)<\/h2>/)?.[1] ?? '';
            expect(heading).toContain('Prameny');
            expect(heading).not.toContain('pp-peek');
        }
        const en = buildPersonPageBody(preparePersonPageData(d, opts({ lang: 'en' })), opts({ lang: 'en' }));
        expect(en).toMatch(/ · and 28 more<\/span>/);
    });
});

describe('the contents mark the section being read', () => {
    const secs = [{ id: 'facts', top: 0 }, { id: 'family', top: 300 }, { id: 'timeline', top: 700 }, { id: 'sources', top: 3000 }, { id: 'research', top: 3200 }];
    it('the last section past the reading line; the top one before any', () => {
        expect(personPageTocCurrent(secs, { scrollTop: 0, clientHeight: 800, scrollHeight: 3500 })).toBe('facts');
        expect(personPageTocCurrent(secs, { scrollTop: 600, clientHeight: 800, scrollHeight: 3500 })).toBe('timeline');
        expect(personPageTocCurrent(secs, { scrollTop: 2600, clientHeight: 800, scrollHeight: 3500 })).toBe('timeline');
    });
    it('at the end of the page the last section, though it never reaches the line', () => {
        expect(personPageTocCurrent(secs, { scrollTop: 2700, clientHeight: 800, scrollHeight: 3500 })).toBe('research');
        expect(personPageTocCurrent(secs, { scrollTop: 2690, clientHeight: 800, scrollHeight: 3500 })).toBe('timeline');
        // A page that does not scroll: the top.
        expect(personPageTocCurrent(secs, { scrollTop: 0, clientHeight: 4000, scrollHeight: 4000 })).toBe('facts');
        expect(personPageTocCurrent([], { scrollTop: 0, clientHeight: 1, scrollHeight: 1 })).toBeNull();
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
        // Only a birth year: "(* 1860)", as the header has it, never "(1860–)" (round 2, a).
        const born = fiskTree();
        delete born.persons['jan' as PersonId].deathDate;
        born.persons['jan' as PersonId].isDeceased = true;
        expect(doc(born)).toContain('<title>Jan Fíšek (* 1860)</title>');
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

describe('the contents "On this page" in the file (round 3 §0.7)', () => {
    const navOf = (html: string) => html.slice(html.indexOf('<nav class="pp-toc"'), html.indexOf('</nav>', html.indexOf('<nav class="pp-toc"')) + 6);
    const hrefs = (html: string) => [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
    it('on: a column beside the page and a closed fold under the header, plain anchors to the sections the file has', () => {
        const html = doc(fiskTree(), { toc: true });
        expect(html).toContain('<div class="pp-file-layout"><nav class="pp-toc" aria-label="Na stránce"><div class="pp-toc-h">Na stránce</div><ol>');
        const nav = navOf(html);
        expect(hrefs(nav)).toEqual(['pp-sec-facts', ...sectionIds(html)]);
        expect(nav).toContain('>Rodina</a>');
        expect(nav).not.toMatch(/<script|onclick|data-pp-toc/);
        // The fold: under the header, closed, the same entries.
        const fold = html.slice(html.indexOf('<details class="pp-toc-m">'), html.indexOf('</details>', html.indexOf('<details class="pp-toc-m">')));
        expect(html.indexOf('<details class="pp-toc-m">')).toBeGreaterThan(html.indexOf('<header class="pp-hero"'));
        expect(html.indexOf('<details class="pp-toc-m">')).toBeLessThan(html.indexOf('id="pp-sec-family"'));
        expect(fold).toContain('<summary>Na stránce<span class="pp-toc-m-arr" aria-hidden="true">▾</span></summary>');
        expect(hrefs(fold)).toEqual(hrefs(nav));
        // Section names only: no name of a person.
        for (const name of ['Jan', 'Fíšek', 'Marie', 'Rosa', 'Petr']) expect(nav + fold).not.toContain(name);
        // Desktop / phone / print.
        expect(html).toContain('.pp-toc-m { display: none; }');
        expect(html).toMatch(/@media \(max-width: 899px\) \{[^@]*\.pp-file-layout > \.pp-toc \{ display: none; \}/);
        expect(html).toContain('.pp-toc, .pp-toc-m { display: none !important; }');
        expect(doc(fiskTree(), { toc: true, lang: 'en' })).toContain('aria-label="On this page"');
    });
    it('off, under four sections, or in the window: none', () => {
        const off = doc(fiskTree());
        for (const c of ['<div class="pp-file-layout">', '<nav class="pp-toc"', '<details class="pp-toc-m">']) expect(off).not.toContain(c);
        const poor: StromData = { persons: { x: p('x', 'Jakub', 'Prostý', 'male') }, partnerships: {} } as StromData;
        const small = doc(poor, { personId: 'x' as PersonId, toc: true });
        expect(small).not.toContain('<nav class="pp-toc"');
        expect(small).not.toContain('<details class="pp-toc-m">');
        expect(body(fiskTree(), { toc: true })).not.toContain('pp-toc-m');
    });
    it('a group left out of the file has no entry', () => {
        const html = doc(fiskTree(), { toc: true, groups: { ...PERSON_PAGE_ALL_GROUPS, sources: false, research: false } });
        const nav = navOf(html);
        expect(hrefs(nav)).toEqual(['pp-sec-facts', ...sectionIds(html)]);
        expect(nav).not.toContain('pp-sec-sources');
        expect(nav).not.toContain('pp-sec-research');
    });
    it('protects the living: hidden in the whole file and the contents; with full data the contents follow the file', () => {
        const d = fiskTree();
        delete d.persons['rosa' as PersonId].deathDate;
        d.persons['rosa' as PersonId].birthDate = '1950-04-04';
        const prot = doc(d, { toc: true, privacy: 'initials' });
        expect(prot).toContain('<nav class="pp-toc"');
        expect(prot).not.toContain('Rosa');
        const full = doc(d, { toc: true, privacy: 'full' });
        expect(full).toContain('Rosa');
        expect(hrefs(navOf(full))).toEqual(['pp-sec-facts', ...sectionIds(full)]);
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
    it('the export starts with initials + birth year; a remembered choice wins; full data without the living', () => {
        expect(personPageExportPrivacy(true, undefined)).toBe('initials');
        expect(personPageExportPrivacy(true, 'full')).toBe('full');
        expect(personPageExportPrivacy(true, 'minimal')).toBe('minimal');
        expect(personPageExportPrivacy(true, 'bogus' as never)).toBe('initials');
        expect(personPageExportPrivacy(false, 'initials')).toBe('full');
    });
    it('protection covers the living only: the dead keep sources and excerpts (K2.7)', () => {
        const d = living();
        d.sources = {
            s1: { id: 's1', title: 'Matrika narozených Čapkov 1925', excerpts: [{ id: 'xk', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100, caption: 'Zápis křtu Karla' }] },
            s2: { id: 's2', title: 'Matrika narozených Čapkov 1952', excerpts: [{ id: 'xe', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100, caption: 'Zápis narození Evy' }] },
        };
        d.persons['eva' as PersonId].birthSourceIds = ['s2'];
        const op = opts({ personId: 'karel' as PersonId, mode: 'file', links: 'plain', privacy: 'initials' });
        const page = preparePersonPageData(d, op);
        const html = buildPersonPageDocument(page, op);
        expect(html).toContain('Matrika narozených Čapkov 1925');
        expect(html).toContain('<figure class="pp-fig"');
        expect(Object.keys(page.tree.sources ?? {})).toEqual(['s1']);
        expect(page.counts.excerpts).toBe(1);
        expect(html).not.toContain('Matrika narozených Čapkov 1952');
        expect(html).not.toContain('Zápis narození Evy');
        expect(html).not.toContain('Eva');
        expect(html).not.toContain('14. července');
        // The living person's own page has no sources at all.
        const evaOp = { ...op, personId: 'eva' as PersonId };
        const evaHtml = buildPersonPageDocument(preparePersonPageData(d, evaOp), evaOp);
        expect(evaHtml).not.toContain('Matrika narozených');
        expect(evaHtml).not.toContain('<figure class="pp-fig"');
        // The family book protects the same way: the dead keep theirs, the living lose them.
        const book = buildFamilyBook(d, { lang: 'cs', privacyMode: 'initials' });
        expect(book).toContain('Matrika narozených Čapkov 1925');
        expect(book).not.toContain('Matrika narozených Čapkov 1952');
        expect(buildFamilyBook(d, { lang: 'cs', privacyMode: 'full' })).toContain('Matrika narozených Čapkov 1925');
    });
    it('names the living people the privacy choice is about; none on a page of the dead', () => {
        const op = opts({ personId: 'karel' as PersonId, mode: 'file', links: 'plain', privacy: 'full' });
        // Each with the relation to the page's person, in the page's language.
        expect(personPageLivingNames(preparePersonPageData(living(), op)).sort()).toEqual(['Eva Fíšková (dcera)', 'Lída Malá (manželka / partnerka)']);
        expect(personPageLivingNames(preparePersonPageData(living(), { ...op, lang: 'de' })).sort()).toEqual(['Eva Fíšková (Tochter)', 'Lída Malá (Ehefrau / Partnerin)']);
        // A living person's own page: the name alone for the person, the relation for the others.
        expect(personPageLivingNames(preparePersonPageData(living(), { ...op, personId: 'eva' as PersonId, lang: 'en' })).sort()).toEqual(['Eva Fíšková', 'Lída Malá (mother)']);
        expect(personPageLivingNames(preparePersonPageData(fiskTree(), opts({ personId: 'karel' as PersonId })))).toEqual([]);
        // A great-great-grandchild on the page only as a witness (the great-grandchild between is not on
        // the page; grandchildren are, for the family tree): the relation comes from the whole tree.
        const d = living();
        d.persons['vnuk' as PersonId] = p('vnuk', 'Ota', 'Fíšek', 'male', { birthDate: '1975', parentIds: ids('eva'), childIds: ids('pravnuk') });
        d.persons['pravnuk' as PersonId] = p('pravnuk', 'Petr', 'Fíšek', 'male', { birthDate: '1995', parentIds: ids('vnuk'), childIds: ids('prapra') });
        d.persons['prapra' as PersonId] = p('prapra', 'Jakub', 'Fíšek', 'male', { birthDate: '2015', parentIds: ids('pravnuk') });
        d.persons['eva' as PersonId].childIds = ids('vnuk');
        d.persons['karel' as PersonId].events = [{ id: 'e9', type: 'burial', date: '1999', participants: [{ id: 'g9', role: 'witness', name: 'Jakub Fíšek', personId: 'prapra' as PersonId }] }];
        const page = preparePersonPageData(d, op);
        expect(personPageLivingNames(page, d)).toContainEqual(expect.stringMatching(/^Jakub Fíšek \(.+\)$/));
        expect(personPageLivingNames(page)).toContain('Jakub Fíšek');
    });
});

describe('person page 2 (§0, §3, §4)', () => {
    /** A PNG header of the given size (enough for the size parser and a safe image). */
    function png(w: number, h: number): string {
        const b = Buffer.alloc(33);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
        b.writeUInt32BE(13, 8);
        b.write('IHDR', 12, 'ascii');
        b.writeUInt32BE(w, 16);
        b.writeUInt32BE(h, 20);
        return `data:image/png;base64,${b.toString('base64')}`;
    }
    const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj<</Type /Page>>endobj\n2 0 obj<</Type /Page>>endobj\n%%EOF').toString('base64')}`;
    function withAttachments(n: number): StromData {
        const d = fiskTree();
        d.persons['jan' as PersonId].attachments = [
            ...Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `foto${i}.png`, mimeType: 'image/png', dataUrl: png(10 + i, 20), sizeBytes: 50, note: `Fotografie ${i + 1}` })),
            { id: 'pdf1', name: 'smlouva-1902.pdf', mimeType: 'application/pdf', dataUrl: PDF, sizeBytes: 90 },
        ];
        return d;
    }

    it('reads the size of PNG, GIF and JPEG data URLs', () => {
        expect(dataUrlImageSize(png(1600, 900))).toEqual({ w: 1600, h: 900 });
        expect(dataUrlImageSize(IMG)).toEqual({ w: 1, h: 1 });
        const gif = Buffer.from('GIF89a\x07\x00\x03\x00\x00\x00\x00\x00\x00\x00', 'latin1').toString('base64');
        expect(dataUrlImageSize(`data:image/gif;base64,${gif}`)).toEqual({ w: 7, h: 3 });
        expect(dataUrlImageSize('data:image/png;base64,AAAA')).toBeNull();
    });

    it('the summary needs three cells; a poor person has none and small initials', () => {
        const html = body(fiskTree());
        const sum = html.match(/<div class="pp-sum[^"]*" role="list"[^>]*>.*?<\/div><\/div>(?=<section|<div class="pp-sum-cell")/)?.[0] ?? html;
        expect(html).toContain('<div class="pp-sum pp-sum--3 pp-wide" role="list" aria-label="V kostce">');
        expect(sum).toContain('<span class="pp-sum-big">50 let</span><span class="pp-sum-lab">dožitý věk</span>');
        expect(sum).toContain('<span class="pp-sum-big">2 děti</span>');
        expect(sum).toMatch(/<span class="pp-sum-big">\d+ let manželství<\/span><span class="pp-sum-lab">oženil se ve 27 letech<\/span>/);
        // An unknown gender: neutral forms, no declined pronoun (round 2, point 8).
        const u = fiskTree();
        u.persons['jan' as PersonId].gender = 'unknown';
        expect(body(u)).toContain('<span class="pp-sum-lab">uzavřel/a sňatek ve 27 letech</span>');
        // Before the family, after the header.
        expect(html.indexOf('pp-sum')).toBeGreaterThan(html.indexOf('</header>'));
        expect(html.indexOf('pp-sum')).toBeLessThan(html.indexOf('pp-sec-family'));
        // A name and a birth year: no summary, the small initials.
        const poor: StromData = { persons: { x: p('x', 'Jakub', 'Prostý', 'male', { birthDate: '1801' }) }, partnerships: {} } as StromData;
        const ph = body(poor, { personId: 'x' as PersonId });
        expect(ph).not.toContain('pp-sum');
        expect(ph).toContain('<div class="pp-initials pp-initials--small" aria-hidden="true">JP</div>');
        expect(html).not.toContain('pp-initials--small');
    });

    it('the open question: in the window, in the file only for the deceased', () => {
        const d = fiskTree();
        d.persons['jan' as PersonId].question = 'Odkud přišel jeho otec? [S0042]';
        const html = body(d);
        expect(html).toContain('<section class="pp-sec pp-sec--question" id="pp-sec-question"><div class="pp-question"><h2 class="pp-kicker">Otevřená otázka</h2><p class="pp-question-text">Odkud přišel jeho otec?</p></div></section>');
        // After the story, before the timeline.
        expect(html.indexOf('pp-sec-question')).toBeGreaterThan(html.indexOf('pp-sec-story'));
        expect(html.indexOf('pp-sec-question')).toBeLessThan(html.indexOf('pp-sec-timeline'));
        expect(doc(d)).toContain('Odkud přišel jeho otec?');
        // A short block under the story, not an entry of the contents (round 2, point 1).
        expect(personPageSections(html, 'cs').map(x => x.id)).not.toContain('pp-sec-question');
        expect(doc(d)).not.toContain('href="#pp-sec-question"');
        // A living person's question stays in the app (even with full data in the file).
        d.persons['rosa' as PersonId].question = 'Kde žije?';
        delete d.persons['rosa' as PersonId].deathDate;
        d.persons['rosa' as PersonId].birthDate = '1993';
        expect(body(d, { personId: 'rosa' as PersonId })).toContain('Kde žije?');
        expect(doc(d, { personId: 'rosa' as PersonId, privacy: 'full' })).not.toContain('Kde žije?');
    });

    it('people around: the baptism, the marriage and the godchildren; one name alone makes no section', () => {
        expect(body(fiskTree())).not.toContain('pp-sec-people');
        const d = fiskTree();
        d.partnerships['u1' as PartnershipId].participants = [{ id: 'w1', role: 'witness', name: 'František Svědek', note: 'soused' }];
        d.persons['cizi' as PersonId].events = [{ id: 'cb', type: 'baptism', date: '1870', participants: [{ id: 'g2', role: 'godparent', name: 'Jan Fíšek', personId: 'jan' as PersonId }] }];
        const html = body(d);
        const sec = html.match(/<section class="pp-sec pp-sec--people" id="pp-sec-people">.*?<\/section>/)?.[0] ?? '';
        // The role lives in the group's heading; each name stands alone, without a declined role after it (round 2, point 8).
        expect(sec).toContain('<dt>Kmotři při křtu 1860</dt><dd><ul><li><strong>Josef Kmotr</strong></li></ul></dd>');
        expect(sec).toContain('<dt>Svědci při sňatku 1888</dt><dd><ul><li><strong>František Svědek</strong>, soused</li></ul></dd>');
        expect(sec).toMatch(/<dt>Byl kmotrem<\/dt><dd><ul><li><strong><button[^>]*data-pp-person="cizi"[^>]*>Tomáš Neznámý<\/button><\/strong> <span class="pp-people-note">\(křest 1870\)<\/span>/);
        expect(sec).not.toContain('pp-people-role');
        // After the gallery, before the notes.
        expect(html.indexOf('pp-sec-people')).toBeGreaterThan(html.indexOf('pp-sec-materials'));
        expect(html.indexOf('pp-sec-people')).toBeLessThan(html.indexOf('pp-sec-notes'));
    });

    it('the gallery: six images, the rest folded, PDF rows; in the app the images zoom in place', () => {
        const d = withAttachments(6);
        const html = body(d);
        const sec = html.match(/<section class="pp-sec pp-sec--materials" id="pp-sec-materials">.*?<\/section>/)?.[0] ?? '';
        // 2 excerpts + 6 photos + 1 PDF.
        expect(sec).toContain('<span class="pp-count">9</span>');
        expect(sec.match(/<figure class="pp-gal-item pp-gal-item--(record|photo)">/g)).toHaveLength(8);
        expect(sec).toContain('aria-controls="pp-gal-more-body"');
        expect(sec).toContain('Zobrazit další (2)');
        expect(sec).toContain('<button type="button" class="pp-gal-thumb" data-pp-zoom');
        expect(sec).toContain('<span class="pp-pdf-meta">PDF · 2 strany · 1902</span>');
        expect(sec).toContain('data-pp-action="materials"');
        // Excerpts carry the record's kind, attachments are photos.
        expect(sec).toContain('<span class="pp-gal-kind">Zápis z matriky</span><span class="pp-gal-cap">Zápis o narození a křtu</span>');
        expect(sec).toContain('<span class="pp-gal-kind">Fotografie</span><span class="pp-gal-cap">Fotografie 1</span>');
        // The print shows them all.
        expect(body(d, { mode: 'print', links: 'plain' })).not.toContain('pp-gal-more');
    });

    it('the gallery (round 4, K4-31): a record or document whole on a paper ground, a wide one (2 : 1) over two columns, a photo cropped', () => {
        const d = fiskTree();
        // A register line 900 x 300 (3 : 1), a near-square entry, a wide photo and a wide document attachment.
        d.sources!['s1'].excerpts = [{ id: 'x1', dataUrl: png(900, 300), width: 900, height: 300, sizeBytes: 100 }];
        d.sources!['s2'].excerpts = [{ id: 'x2', dataUrl: png(400, 300), width: 400, height: 300, sizeBytes: 100 }];
        d.persons['jan' as PersonId].attachments = [
            { id: 'a1', name: 'krajina.png', mimeType: 'image/png', dataUrl: png(1000, 400), sizeBytes: 50, note: 'Pohled na Čapkov' },
            { id: 'a2', name: 'dopis.png', mimeType: 'image/png', dataUrl: png(800, 400), sizeBytes: 50, note: 'Dopis bratrovi' },
        ];
        for (const html of [body(d), doc(d)]) {
            const sec = html.match(/<section class="pp-sec pp-sec--materials" id="pp-sec-materials">.*?<\/section>/)?.[0] ?? '';
            const classes = [...sec.matchAll(/<figure class="([^"]+)">/g)].map(m => m[1]);
            expect(classes).toEqual(expect.arrayContaining([
                'pp-gal-item pp-gal-item--record pp-gal-item--wide',
                'pp-gal-item pp-gal-item--record',
                'pp-gal-item pp-gal-item--photo',
                'pp-gal-item pp-gal-item--document pp-gal-item--wide',
            ]));
            expect(classes).toHaveLength(4);
        }
        // A size from the excerpt's fields, else from the image itself.
        d.sources!['s1'].excerpts = [{ id: 'x1', dataUrl: png(900, 300), width: 0, height: 0, sizeBytes: 100 }];
        expect(body(d)).toContain('<figure class="pp-gal-item pp-gal-item--record pp-gal-item--wide">');
        // The CSS: contain on the paper ground with 6 px, span 2 at 8 : 3, dense flow; a phone's wide tile over the whole row.
        expect(PERSON_PAGE_CSS).toContain('.pp-gal { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-flow: dense;');
        expect(PERSON_PAGE_CSS).toContain('.pp-gal-item--record .pp-gal-thumb, .pp-gal-item--document .pp-gal-thumb { box-sizing: border-box; padding: 6px; background-color: var(--card-bg-2); }');
        expect(PERSON_PAGE_CSS).toContain('.pp-gal-item--record .pp-gal-img, .pp-gal-item--document .pp-gal-img { object-fit: contain; background-size: contain; }');
        expect(PERSON_PAGE_CSS).toContain('.pp-gal-item--wide { grid-column: span 2; }\n.pp-gal-item--wide .pp-gal-thumb { aspect-ratio: 8 / 3; }');
        expect(PERSON_PAGE_CSS.match(/@media \(max-width: 640px\) \{[^@]*\.pp-gal-item--wide \{ grid-column: 1 \/ -1; \}/)).not.toBeNull();
    });

    it('the size line\'s image count is the attached images, each once, without the portrait (round 2, b)', () => {
        const d = withAttachments(2);
        d.persons['jan' as PersonId].photo = png(300, 400);
        const op = opts({ mode: 'file', links: 'plain' });
        const page = preparePersonPageData(d, op);
        // The excerpts (one image twice) and two photos: 3 images; the portrait and the PDF are not among them.
        expect(estimatePersonPageSize(page, op).images).toBe(3);
        // The window counts the same images.
        expect(estimatePersonPageSize(preparePersonPageData(d, opts()), opts()).images).toBe(3);
        // Without the images group: none.
        const noImg = opts({ mode: 'file', links: 'plain', groups: { ...PERSON_PAGE_ALL_GROUPS, excerpts: false, materials: false } });
        expect(estimatePersonPageSize(preparePersonPageData(d, noImg), noImg).images).toBe(0);
    });

    it('the file: one light box per image, each image embedded once, the timeline points to the box', () => {
        const d = withAttachments(2);
        d.persons['jan' as PersonId].photo = png(300, 400);
        const html = doc(d);
        // Excerpts (the same image twice), two photos, the portrait: three distinct data URLs + the portrait.
        expect(html.split(IMG).length - 1).toBe(1);
        expect(html.split(png(10, 20)).length - 1).toBe(1);
        expect(html.split(png(300, 400)).length - 1).toBe(1);
        expect(html).not.toContain('<img ');
        for (const n of [1, 2, 3, 4]) expect(html).toContain(`<div class="pp-lb" id="obr-${n}" role="dialog"`);
        expect(html).not.toContain('id="obr-5"');
        expect(html).toContain('<span class="pp-lb-count">1 / 4</span>');
        expect(html).toContain('<a class="pp-lb-nav" href="#obr-2" data-pp-lb="next">další ›</a>');
        expect(html).toContain('<a class="pp-lb-close" href="#pp-sec-materials" data-pp-lb="close">✕ Zavřít</a>');
        expect(html).toContain('<a class="pp-gal-thumb" href="#obr-1"');
        // The portrait opens its own box.
        expect(html).toMatch(/<a class="pp-portrait[^"]*" href="#obr-p"/);
        expect(html).toContain('<div class="pp-lb" id="obr-p" role="dialog"');
        // The timeline's excerpt opens the gallery's box of the same image.
        expect(html).toMatch(/<figure class="pp-fig"[^>]*>.*?href="#obr-[12]"/);
        // The PDF is embedded as a download.
        expect(html).toContain('download="smlouva-1902.pdf"');
        // Images and PDF off: no boxes, the PDF named as left out.
        const off = doc(d, { groups: { ...PERSON_PAGE_ALL_GROUPS, excerpts: false, materials: false, pdf: false } });
        expect(off).not.toContain('id="obr-1"');
        // The portrait belongs to the header and keeps its box.
        expect(off).toContain('id="obr-p"');
        expect(off).not.toContain(png(10, 20));
        expect(off).not.toContain('application/pdf');
    });

    it('the family tree in the file: a living card is "E. F. · * 1952" with a dashed border, no living name anywhere', () => {
        const d: StromData = {
            persons: {
                karel: p('karel', 'Karel', 'Fíšek', 'male', { birthDate: '1925', deathDate: '1999', childIds: ids('eva'), partnerships: ['u2' as PartnershipId], question: 'Kdo byl otec?' }),
                lida: p('lida', 'Lída', 'Malá', 'female', { birthDate: '1950-05-05', partnerships: ['u2' as PartnershipId], childIds: ids('eva') }),
                eva: p('eva', 'Eva', 'Fíšková', 'female', { birthDate: '1952-07-14', parentIds: ids('karel', 'lida'), childIds: ids('ota'), question: 'Kde žije?' }),
                ota: p('ota', 'Ota', 'Fíšek', 'male', { birthDate: '1975', parentIds: ids('eva') }),
            },
            partnerships: {
                u2: { id: 'u2' as PartnershipId, person1Id: 'karel' as PersonId, person2Id: 'lida' as PersonId, status: 'married', childIds: ids('eva'), startDate: '1951-06-01', participants: [{ id: 'w', role: 'witness', name: 'Ota Fíšek', personId: 'ota' as PersonId }, { id: 'w2', role: 'witness', name: 'Eva Fíšková', personId: 'eva' as PersonId }] } as Partnership,
            },
            sources: {},
        } as StromData;
        d.persons['karel' as PersonId].attachments = [{ id: 'ph', name: 'dum-1960.png', mimeType: 'image/png', dataUrl: png(5, 5), sizeBytes: 9, note: 'Dům čp. 12' }];
        const html = doc(d, { personId: 'karel' as PersonId, privacy: 'initials' });
        expect(html).toContain('<span class="pp-ft-card pp-ft-card--kid pp-ft-card--living" style=');
        expect(html).toContain('<span class="pp-ft-name" title="E. F.">E. F.</span><span class="pp-ft-years">* 1952</span>');
        expect(html).toContain('<span class="pp-chip pp-chip--living"><span class="pp-chip-name">O. F.</span> · <span class="pp-chip-years">* 1975</span></span>');
        for (const name of ['Eva', 'Fíšková', 'Lída', 'Malá', 'Ota', 'Kde žije?', '14. července', '1952-07']) expect(html).not.toContain(name);
        // The dead person's own question and the summary stay; the living witnesses leave the people around.
        expect(html).toContain('Kdo byl otec?');
        expect(html).not.toContain('pp-sec-people');
        // The style marks a living card dashed.
        expect(html).toMatch(/\.pp-ft-card--living[^{]*\{[^}]*border-style:\s*dashed/);
        // A living person's own page: the header with initials and the birth year, the note, nothing else.
        const eva = doc(d, { personId: 'eva' as PersonId, privacy: 'initials' });
        const art = eva.match(/<article class="pp".*<\/article>/s)?.[0] ?? '';
        expect(art).toContain('<h1 class="pp-name">E. F.</h1>');
        expect(art).toContain('<p class="pp-living-note">Žijící osoba. Další údaje se v souboru neuvádějí.</p>');
        expect(art).not.toMatch(/<section /);
        expect(art).not.toContain('pp-sum');
        for (const name of ['Eva', 'Karel', 'Ota', 'Lída', 'Kde žije?']) expect(art).not.toContain(name);
        // Full data: the names are there.
        expect(doc(d, { personId: 'karel' as PersonId, privacy: 'full' })).toContain('Eva Fíšková');
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
        // Both excerpts are the same image: embedded once.
        expect(est.images).toBe(1);
    });
    it('counts what each group holds', () => {
        const page = preparePersonPageData(fiskTree(), opts());
        expect(page.counts).toMatchObject({ childEvents: 1, excerpts: 2, sources: 3, materials: 0, pdf: 0 });
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

describe('person page 2: the places map and the life chart wired in (§1, §2)', () => {
    const geoTree = (): StromData => {
        const d = fiskTree();
        d.places = {
            [placeKey('Čapkov')]: { lat: 49.85, lon: 15.2, label: 'Čapkov, Česko' },
            [placeKey('Vídeň')]: { lat: 48.21, lon: 16.37 },
            [placeKey('Toronto')]: { lat: 43.65, lon: -79.38 },
            [placeKey('Lhota')]: { lat: 49.9, lon: 15.3 },
        };
        // Rosa: two places of her own, a living daughter who emigrated, a living second husband with a couple's story.
        const rosa = d.persons['rosa' as PersonId];
        Object.assign(rosa, {
            birthPlace: 'Čapkov', deathDate: '1970', deathPlace: 'Vídeň',
            childIds: ids('eva'), partnerships: ['u2' as PartnershipId, 'u3' as PartnershipId],
        });
        d.persons['tomas' as PersonId] = p('tomas', 'Tomáš', 'Malý', 'male', {
            birthDate: '1890', deathDate: '1960', partnerships: ['u2' as PartnershipId], childIds: ids('eva'),
        });
        d.persons['jiri' as PersonId] = p('jiri', 'Zbyňka', 'Nováková', 'female', {
            birthDate: '1950-02-02', birthPlace: 'Lhota', partnerships: ['u3' as PartnershipId],
        });
        d.persons['eva' as PersonId] = p('eva', 'Evelína', 'Malá', 'female', {
            birthDate: '1955-04-04', birthPlace: 'Lhota', parentIds: ids('tomas', 'rosa'),
            events: [{ id: 'ev1', type: 'emigration', date: '1980', place: 'Toronto' }],
        });
        d.partnerships['u2' as PartnershipId] = { id: 'u2' as PartnershipId, person1Id: 'tomas' as PersonId, person2Id: 'rosa' as PersonId, status: 'married', childIds: ids('eva'), startDate: '1950' } as Partnership;
        d.partnerships['u3' as PartnershipId] = {
            id: 'u3' as PartnershipId, person1Id: 'rosa' as PersonId, person2Id: 'jiri' as PersonId, status: 'married', childIds: [], startDate: '1965',
            story: { status: 'final', title: 'Pozdní láska', text: 'Potkaly se ve Lhotě.' },
        } as Partnership;
        return d;
    };
    const rosa = { personId: 'rosa' as PersonId };

    it('the Places section sits between the story and the timeline; the chart opens the timeline above its rows', () => {
        const html = body(geoTree(), { open: new Set(['research']) });
        expect(sectionIds(html)).toEqual(['pp-sec-family', 'pp-sec-story', 'pp-sec-places', 'pp-sec-timeline', 'pp-sec-materials', 'pp-sec-notes', 'pp-sec-sources', 'pp-sec-research']);
        expect(html).toContain('class="pp-map pp-wide');
        const tl = html.slice(html.indexOf('id="pp-sec-timeline"'));
        expect(tl.indexOf('class="pp-chart-host pp-wide"')).toBeGreaterThan(0);
        expect(tl.indexOf('class="pp-chart-host pp-wide"')).toBeLessThan(tl.indexOf('class="pp-seg'));
        // The contents name the new section.
        expect(personPageSections(html, 'cs').find(s => s.key === 'places')).toEqual({ key: 'places', id: 'pp-sec-places', label: 'Místa života' });
        expect(personPageSections(html, 'en').find(s => s.key === 'places')?.label).toBe('Places of life');
    });

    it('thresholds: one place → no section; places without position → the list; one dated year → no chart', () => {
        const one = geoTree();
        one.persons['jan' as PersonId].events = one.persons['jan' as PersonId].events!.filter(e => e.place !== 'Vídeň');
        expect(body(one)).not.toContain('id="pp-sec-places"');
        expect(doc(one)).not.toContain(".pp-places');if(!root)");
        const noGeo = fiskTree();
        const w = body(noGeo);
        expect(w).toContain('id="pp-sec-places"');
        expect(w).not.toContain('class="pp-map pp-wide');
        expect(w).toContain('Polohu lze doplnit v Místech.');
        expect(doc(noGeo)).not.toContain('Polohu lze doplnit v Místech.');
        const poor: StromData = { persons: { x: p('x', 'Jakub', 'Prostý', 'male', { birthDate: '1900', birthPlace: 'Čapkov' }) }, partnerships: {} } as StromData;
        const ph = body(poor, { personId: 'x' as PersonId });
        expect(ph).not.toContain('pp-chart');
        expect(ph).not.toContain('id="pp-sec-places"');
    });

    it('window: the switch, Open in map, the selected place; the file: none of them, the script only with the map', () => {
        const app = body(geoTree(), { ...rosa, selectedPlace: placeKey('Vídeň') });
        expect(app).toContain('data-pp-switch="kidPlaces"');
        expect(app).toContain('data-pp-action="map:open"');
        expect(app).toMatch(/class="pp-map-row is-sel"[^>]*data-pp-map-place="vi/);
        // Toronto (the daughter's emigration) far away: the world inset, the hollow point in the list.
        expect(app).toContain('Toronto');
        const off = body(geoTree(), { ...rosa, toggles: { history: true, childEvents: true, kidPlaces: false } });
        expect(off).toContain('aria-checked="false" data-pp-switch="kidPlaces"');
        expect(off).not.toContain('Toronto');
        const file = doc(geoTree(), { ...rosa, privacy: 'full' });
        expect(file).not.toContain('data-pp-switch="kidPlaces"');
        expect(file).not.toContain('map:open');
        expect(file).toContain(".pp-places');if(!root)");
        // Places in the text lead to the section.
        expect(file).toMatch(/<a class="pp-link pp-place-link" href="#pp-sec-places" data-pp-to-place="[^"]+">Čapkov<\/a>/);
        // The window keeps its buttons: the window decides where a place leads (§1.6).
        expect(app).toContain('data-pp-place="Čapkov"');
    });

    it('every anchor of the chart and the places list names a timeline row, each id once', () => {
        for (const html of [body(geoTree()), doc(geoTree()), body(geoTree(), rosa)]) {
            const ids = [...html.matchAll(/ id="(osa-[^"]+)"/g)].map(m => m[1]);
            expect(new Set(ids).size).toBe(ids.length);
            const targets = new Set([...html.matchAll(/data-pp-osa="(osa-[^"]+)"/g)].map(m => m[1]));
            expect(targets.size).toBeGreaterThan(0);
            for (const t of targets) expect(ids).toContain(t);
        }
        // The chart's anchors work without JavaScript: plain fragment links in the file.
        expect(doc(geoTree())).toMatch(/<a [^>]*href="#osa-1860-/);
        // The merged baptism keeps its own anchor inside the birth row.
        const birthKey = computePersonLifeline(geoTree(), 'jan').find(pt => pt.eventType === 'baptism')!.sortKey;
        expect(body(geoTree())).toMatch(new RegExp(`<span class="pp-osa-anchor" id="osa-${birthKey.toFixed(3).replace('.', '-')}">`));
    });

    it('the switches cover the chart: the history row and the children\'s lines hide with them', () => {
        const app = body(geoTree(), { ...rosa, toggles: { history: true, childEvents: false } });
        expect(app.startsWith('<article class="pp pp-no-kids"')).toBe(true);
        expect(app).toContain('pp-ch-kid');
        expect(app).toContain('data-pp-switch="childEvents"');
    });

    it('a protected file: no living person in the map or the chart, the living one\'s own page has neither block', () => {
        const prot = doc(geoTree(), { ...rosa, privacy: 'initials' });
        expect(prot).toContain('id="pp-sec-places"');
        expect(prot).toContain('class="pp-chart"');
        for (const word of ['Evelína', 'Toronto', 'Lhota', 'Zbyňka', 'Pozdní láska', '1955-04-04']) expect(prot).not.toContain(word);
        // The window (full data) has them.
        const app = body(geoTree(), rosa);
        for (const word of ['Evelína', 'Toronto']) expect(app).toContain(word);
        const evaFile = doc(geoTree(), { personId: 'eva' as PersonId, privacy: 'initials' });
        expect(evaFile).not.toContain('id="pp-sec-places"');
        expect(evaFile).not.toContain('class="pp-chart"');
        expect(evaFile).not.toContain(".pp-places');if(!root)");
        // The living person's page in the window: the map and the chart (to today).
        const evaApp = body(geoTree(), { personId: 'eva' as PersonId });
        expect(evaApp).toContain('id="pp-sec-places"');
        expect(evaApp).toContain('class="pp-chart"');
    });

    it('a protected file: the chart keeps a marriage to a living partner as the family tree does, no widowhood after it (round 3, finding 1)', () => {
        const op = opts({ ...rosa, mode: 'file', links: 'plain', privacy: 'initials' });
        const page = preparePersonPageData(geoTree(), op);
        const input = personPageChartInput(page, NOW)!;
        expect(input.periods.map(x => `${x.kind}:${x.name ?? ''}:${Math.floor(x.from)}-${Math.floor(x.to)}`)).toEqual([
            'youth::1893-1950', 'marriage:Tomáš:1950-1960', 'widowed::1960-1965', 'marriage:Z. N.:1965-1970',
        ]);
        expect(input.lines.some(l => l.kind === 'partner' && l.name.startsWith('Z'))).toBe(false);
        const html = buildPersonPageDocument(page, op);
        expect(html).toContain('Manželství · Z. N.');
        for (const word of ['Zbyňka', 'Nováková', '1950-02-02']) expect(html).not.toContain(word);
    });

    it('a protected file: a union with a living partner that ended has no length in the chart, nor its end (round 3, finding F)', () => {
        // Sample tree: Martin (died 2015) and the living Sarah Walsh separated in 1978.
        const op = opts({ personId: 'demo_martin' as PersonId, mode: 'file', links: 'plain', privacy: 'initials' });
        const page = preparePersonPageData(getDemoTree(), op);
        const input = personPageChartInput(page, NOW)!;
        expect(input.periods.map(x => `${x.kind}:${x.name ?? ''}:${Math.floor(x.from)}-${Math.floor(x.to)}`)).toEqual([
            'youth::1940-1969', 'life::1969-2015',
        ]);
        expect(input.marks.filter(m => m.kind === 'marriage').map(m => `${m.title}:${m.year}`)).toEqual(['S. W.:1969']);
        const html = buildPersonPageDocument(page, op);
        for (const word of ['1978', 'Partnerství · S. W.', 'po rozvodu', 'po rozchodu', 'vdovec', 'Sarah', 'Walsh']) expect(html).not.toContain(word);
        // Without protection the chart keeps the union's nine years and the time after it.
        const fullOp = opts({ personId: 'demo_martin' as PersonId, mode: 'file', links: 'plain' });
        const fullHtml = buildPersonPageDocument(preparePersonPageData(getDemoTree(), fullOp), fullOp);
        expect(fullHtml).toContain('Partnerství · Sarah · 9 let');
    });

    it('the family tree links to the couple\'s chapter with the chapter helpers; none with a living partner in a protected file', () => {
        const d = geoTree();
        d.partnerships['u1' as PartnershipId].story = { status: 'final', title: 'Svatba v Čapkově', text: 'Vzali se.' };
        const app = body(d);
        // Round 3 (§4.1): the fixed "story ↓" (only "↓" in a narrow gap, CSS), the title in the tooltip and the accessible name.
        const inner = '<span class="pp-ft-story-l">vyprávění ↓</span><span class="pp-ft-story-s" aria-hidden="true">↓</span>';
        const tip = 'title="Vyprávění manželství: Svatba v Čapkově" aria-label="Vyprávění manželství: Svatba v Čapkově"';
        expect(app).toContain(`<button type="button" class="pp-link pp-ft-story" data-pp-story="pp-story-u1" ${tip}>${inner}</button>`);
        expect(app).not.toContain('data-pp-goto');
        // (The title with ↓ stays only in the own story's "continued in" line, not in the tree.)
        expect(app).not.toMatch(/pp-ft-story[^>]*>Svatba/);
        expect(doc(d)).toContain(`<a class="pp-ft-story" href="#pp-story-u1" data-pp-story="pp-story-u1" ${tip}>${inner}</a>`);
        // The upright tree: "· story ↓" in one piece after the date.
        expect(app).toMatch(/<span class="pp-rail-story">· <button type="button" class="pp-link pp-ft-story" data-pp-story="pp-story-u1"/);
        // The label between the cards is never wider than the gap.
        expect(app).toMatch(/<span class="pp-ft-lab" style="left:[\d.]+%;top:\d+px;max-width:16\.912%"><span>⚭ 1888<\/span><button[^>]*pp-ft-story/);
        // No title: the two first names; a draft says so.
        delete d.partnerships['u1' as PartnershipId].story!.title;
        d.partnerships['u1' as PartnershipId].story!.status = 'draft';
        expect(body(d, { lang: 'en' })).toMatch(/title="Story of the marriage: [^"]+ and [^"]+ \(draft\)"/);
        expect(body(d, rosa)).toContain('data-pp-story="pp-story-u3"');
        const prot = doc(d, { ...rosa, privacy: 'initials' });
        expect(prot).not.toContain('pp-story-u3');
    });

    it('the file carries the map and chart tokens on :root and grey print values', () => {
        const file = doc(geoTree());
        expect(file).toMatch(/:root \{[^}]*--map-land: #f4efe4[^}]*--chart-young: #e2d6bd/);
        expect(file).toContain('--accent: #b0703c');
        expect(file).toMatch(/@media print \{\s*\.pp-places, \.pp-chart \{[^}]*--map-land: #ffffff/);
    });
});
