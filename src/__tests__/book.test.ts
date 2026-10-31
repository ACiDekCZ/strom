/**
 * The family book ("Kniha rodu 2", 1031 §5): the orchestrator and its blocks.
 * Determinism, living-person privacy in the text, the line tree, the contents
 * and the index (all four modes), no stray markdown, sources numbered once by
 * first occurrence, the order of chapters along the line, the research
 * controls on screen only, the parts, the CSS of the running heads, the
 * estimate. Pure — no DOM. Invented names only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildFamilyBook, tocHtml } from '../book.js';
import { BOOK_PART_KEYS, BookOptions, bookPartAvailability, defaultBookOptions, effectiveBookParts, estimateBook } from '../book-options.js';
import { buildBookModel } from '../book-model.js';
import { cssString, rodPagesCss } from '../book-css.js';
import { printedUrl } from '../book-blocks.js';
import { buildLineages, rodPlaceSpans, rods } from '../lineage.js';
import { cleanWorkNote } from '../person-page.js';
import { proseHtml } from '../story-text.js';
import { getDemoTree } from '../demo-tree.js';
import { setLanguage } from '../strings.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, Source, Gender } from '../types.js';
import { PrivacyMode } from '../privacy.js';

const NOW = new Date('2026-10-31T12:00:00Z');
const ENV = { now: NOW, dateLabel: 'sestaveno 31. 10. 2026' };

afterEach(() => setLanguage('cs'));

interface Opts {
    birthDate?: string; deathDate?: string; birthPlace?: string; deathPlace?: string;
    notes?: string; isDeceased?: boolean; marriedSurname?: string;
    parentIds?: string[]; childIds?: string[]; partnerships?: string[]; sourceIds?: string[]; birthSourceIds?: string[];
}

function p(id: string, first: string, last: string, gender: Gender, o: Opts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false,
        parentIds: (o.parentIds ?? []) as PersonId[],
        childIds: (o.childIds ?? []) as PersonId[],
        partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.birthPlace ? { birthPlace: o.birthPlace } : {}),
        ...(o.deathPlace ? { deathPlace: o.deathPlace } : {}),
        ...(o.notes ? { notes: o.notes } : {}),
        ...(o.isDeceased !== undefined ? { isDeceased: o.isDeceased } : {}),
        ...(o.marriedSurname ? { marriedSurname: o.marriedSurname } : {}),
        ...(o.sourceIds ? { sourceIds: o.sourceIds } : {}),
        ...(o.birthSourceIds ? { birthSourceIds: o.birthSourceIds } : {}),
    };
}

function u(id: string, a: string, b: string, kids: string[], extra: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, status: 'married', childIds: kids as PersonId[], ...extra };
}

function tree(persons: Person[], unions: Partnership[], sources?: Record<string, Source>): StromData {
    return {
        persons: Object.fromEntries(persons.map(x => [x.id, x])) as StromData['persons'],
        partnerships: Object.fromEntries(unions.map(x => [x.id, x])) as StromData['partnerships'],
        ...(sources ? { sources } : {}),
    };
}

/**
 * The Ostružník line over four generations; the last two are living
 * (Zdeněk * 1950 and his wife Radmila Mlhovcová * 1952, their son Ondřej * 1980).
 */
function ostruznik(): StromData {
    return tree([
        p('f', 'Bohumil', 'Ostružník', 'male', { birthDate: '1850', deathDate: '1920', birthPlace: 'Lhota', partnerships: ['u1'], childIds: ['v', 'a'], sourceIds: ['s1'] }),
        p('fw', 'Ludmila', 'Sejková', 'female', { birthDate: '1855', deathDate: '1930', partnerships: ['u1'], childIds: ['v', 'a'] }),
        p('v', 'Vojtěch', 'Ostružník', 'male', { birthDate: '1880', deathDate: '1950', birthPlace: 'Lhota', parentIds: ['f', 'fw'], partnerships: ['u2'], childIds: ['z'], birthSourceIds: ['s3'], sourceIds: ['s1'] }),
        p('a', 'Anna', 'Ostružníková', 'female', { birthDate: '1883', deathDate: '1960', parentIds: ['f', 'fw'] }),
        p('vw', 'Terezie', 'Hrabcová', 'female', { birthDate: '1885', deathDate: '1960', partnerships: ['u2'], childIds: ['z'] }),
        p('z', 'Zdeněk', 'Ostružník', 'male', { birthDate: '1950', birthPlace: 'Brno', isDeceased: false, parentIds: ['v', 'vw'], partnerships: ['u3'], childIds: ['o'], sourceIds: ['s5'] }),
        p('zw', 'Radmila', 'Mlhovcová', 'female', { birthDate: '1952', isDeceased: false, marriedSurname: 'Ostružníková', partnerships: ['u3'], childIds: ['o'] }),
        p('o', 'Ondřej', 'Ostružník', 'male', { birthDate: '1980', isDeceased: false, parentIds: ['z', 'zw'] }),
    ], [
        u('u1', 'f', 'fw', ['v', 'a'], { startDate: '1878', startPlace: 'Lhota', sourceIds: ['s2'] }),
        u('u2', 'v', 'vw', ['z'], { startDate: '1905' }),
        u('u3', 'z', 'zw', ['o'], { startDate: '1975', startPlace: 'Brno' }),
    ], {
        s1: { id: 's1', title: 'Matrika Lhota 1850', repository: 'Archiv Kapradina', reference: 'sv. 3, s. 12' },
        s2: { id: 's2', title: 'Matrika oddaných Lhota 1878' },
        s3: { id: 's3', title: 'Matrika narozených Lhota 1880', url: 'https://example.org/scan/lhota/1880/page-0012' },
        s4: { id: 's4', title: 'Nikým necitovaný pramen' },
        s5: { id: 's5', title: 'Matrika narozených Brno 1950' },
    });
}

/** The parts of a document: contents, the line tree, the chapters, the index. */
function regions(html: string): { toc: string; lineage: string; text: string; index: string } {
    const cut = (from: string, to: string): string => {
        const a = html.indexOf(from);
        if (a < 0) return '';
        const b = html.indexOf(to, a);
        return html.slice(a, b < 0 ? undefined : b);
    };
    return {
        toc: cut('<nav class="book-sheet book-front book-toc"', '</nav>'),
        lineage: cut('<section class="book-rod-lineage', '</section>'),
        text: cut('<article', '<section class="book-sheet book-back'),
        index: cut('class="book-index"', '</section>'),
    };
}

describe('buildFamilyBook: the document', () => {
    it('is the same for the same data and options (now and the date injected)', () => {
        const a = buildFamilyBook(ostruznik(), { lang: 'cs', detail: 'all' }, ENV);
        const b = buildFamilyBook(ostruznik(), { lang: 'cs', detail: 'all' }, ENV);
        expect(a).toBe(b);
        expect(buildFamilyBook(getDemoTree(), { lang: 'en' }, ENV)).toBe(buildFamilyBook(getDemoTree(), { lang: 'en' }, ENV));
        expect(a.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(a).toContain('sestaveno 31. 10. 2026');
        expect(a).not.toContain('<script');
    });

    it('has a title page and contents as front matter, a part per lineage with its named page, the back matter', () => {
        const html = buildFamilyBook(ostruznik(), { lang: 'cs', privacy: 'full' }, { ...ENV, treeName: 'Rodina z Lhoty' });
        expect(html).toContain('<section class="book-sheet book-front book-title-page">');
        expect(html).toContain('<h1>Rodina z Lhoty</h1>');
        expect(html).toContain('<div class="book-title-sub">1850–1980</div>');
        expect(html).toContain('<nav class="book-sheet book-front book-toc" id="book-toc">');
        expect(html).toContain('<section class="book-sheet book-rod rod-1" id="rod-1">');
        expect(html).toContain('.rod-1 { page: rod-1; }');
        expect(html).toContain('@page rod-1 { @top-left { content: "Rod Ostružník";');
        expect(html).toContain('@bottom-center { content: counter(page);');
        expect(html).toContain('id="book-sources"');
        expect(html).toContain('id="book-index"');
        // No drawn tree page any more (no SVG with HTML inside it).
        expect(html).not.toContain('foreignObject');
    });

    it('an embedded font carries its license notice', () => {
        const html = buildFamilyBook(ostruznik(), { lang: 'cs' }, { ...ENV, fontCss: "@font-face { font-family: 'Strom Serif'; }" });
        expect(html).toMatch(/<!-- Strom Serif: [^>]*Source Serif 4[^>]*SIL Open Font License, Version 1\.1[^>]*-->\n<style>@font-face/);
        expect(buildFamilyBook(ostruznik(), { lang: 'cs' }, ENV)).not.toContain('Open Font License');
    });

    it('leaves out the parts switched off', () => {
        const off = { ...defaultBookOptions('cs').parts, toc: false, index: false, sources: false, tree: false };
        const html = buildFamilyBook(ostruznik(), { lang: 'cs', privacy: 'full', parts: off }, ENV);
        expect(html).not.toContain('id="book-toc"');
        expect(html).not.toContain('id="book-index"');
        expect(html).not.toContain('id="book-sources"');
        expect(html).not.toContain('class="book-p"');
        expect(html).not.toContain('class="book-rod-lineage');
        // The families are always in.
        expect(html).toContain('id="kap-1"');
    });

    it('takes its headings from the book language, not the app language', () => {
        setLanguage('cs');
        const de = buildFamilyBook(ostruznik(), { lang: 'de', privacy: 'full' }, ENV);
        expect(de).toContain('<html lang="de">');
        expect(de).toContain('Stammlinie Ostružník');
        expect(de).not.toContain('Rejstřík');
    });

    it('a saved file has no research controls and a toolbar with Print only', () => {
        const d = ostruznik();
        d.persons['v' as PersonId].story = { status: 'draft', text: 'Vojtěch byl kovář.' };
        const env = { ...ENV, approveStoryUrl: () => 'strom-research://story?tree=x&person=P0001&do=final' };
        const screen = buildFamilyBook(d, { lang: 'cs', privacy: 'full' }, env);
        expect(screen).toContain('<p class="book-story-approve"><a href="strom-research://story?tree=x&amp;person=P0001&amp;do=final">Schválit ve výzkumu<span class="book-open-mark"');
        expect(screen).toMatch(/@media print \{[\s\S]*?\.book-story-approve[^{]*\{ display: none !important; \}/);
        expect(screen).toContain('window.close()');
        const saved = buildFamilyBook(d, { lang: 'cs', privacy: 'full' }, { ...env, forSave: true });
        expect(saved).not.toContain('book-story-approve"><a');
        expect(saved).not.toContain('window.close()');
        expect(saved).toContain('window.print()');
        expect(saved).toContain('Vojtěch byl kovář.');
    });
});

describe('living-person privacy in the text, the line tree, the contents and the index', () => {
    const living = ['Zdeněk', 'Radmila', 'Ondřej'];

    it('full: the living are named everywhere', () => {
        const r = regions(buildFamilyBook(ostruznik(), { lang: 'cs', privacy: 'full' }, ENV));
        expect(r.toc).toContain('Zdeněk Ostružník a Radmila Ostružníková');
        expect(r.lineage).toContain('Zdeněk Ostružník');
        expect(r.text).toContain('Radmila Ostružníková');
        expect(r.index).toContain('Ostružník Ondřej');
        expect(r.lineage.match(/class="book-lineage-row"/g)).toHaveLength(5);
    });

    for (const mode of ['initials', 'anonymous', 'minimal'] as PrivacyMode[]) {
        it(`${mode}: no living first name anywhere; the regions are there`, () => {
            const html = buildFamilyBook(ostruznik(), { lang: 'cs', privacy: mode }, ENV);
            const r = regions(html);
            for (const region of [r.toc, r.lineage, r.text, r.index]) expect(region.length).toBeGreaterThan(0);
            for (const name of living) expect(html, name).not.toContain(name);
            // The dead stay readable.
            expect(r.toc).toContain('Vojtěch Ostružník a Terezie Hrabcová');
            expect(r.index).toContain('Ostružník Bohumil');
            // A living person's source is gone, a dead one's stays.
            expect(html).not.toContain('Matrika narozených Brno 1950');
            expect(html).toContain('Matrika Lhota 1850');
        });
    }

    it('initials and hidden names: no lineage is named for the living, no surname of theirs leaks', () => {
        for (const mode of ['initials', 'anonymous'] as PrivacyMode[]) {
            const html = buildFamilyBook(ostruznik(), { lang: 'cs', privacy: mode }, ENV);
            expect(html, mode).not.toContain('Mlhovc');
            expect(html, mode).not.toContain('Brno');
            // The living are not rows of the line tree (full: five rows).
            expect(regions(html).lineage.match(/class="book-lineage-row"/g)).toHaveLength(3);
        }
        const r = regions(buildFamilyBook(ostruznik(), { lang: 'cs', privacy: 'initials' }, ENV));
        expect(r.index).toContain('(* 1950)');
    });

    it('"Living person" in the book language', () => {
        setLanguage('cs');
        const en = buildFamilyBook(ostruznik(), { lang: 'en', privacy: 'anonymous' }, ENV);
        expect(en).toContain('Living person');
        expect(en).not.toContain('Žijící osoba');
        const cs = buildFamilyBook(ostruznik(), { lang: 'cs', privacy: 'minimal' }, ENV);
        expect(regions(cs).toc).toContain('Žijící osoba Ostružník');
        expect(regions(cs).index).toContain('Žijící osoba');
    });
});

describe('the text', () => {
    it('has no markdown marks left (stories, notes)', () => {
        const d = ostruznik();
        d.persons['v' as PersonId].story = { status: 'final', text: 'Byl to **kovář** z Lhoty.\nA ** taky sedlák.\n\n**' };
        d.persons['v' as PersonId].notes = '**Pozor:**\n- [ ] ověřit 🔍 křest (jistota: nízká)';
        d.partnerships['u2' as PartnershipId].story = { status: 'final', text: 'Svatba *v zimě* a **tanec**.' };
        const html = buildFamilyBook(d, { lang: 'cs', privacy: 'full', notes: true, detail: 'all' }, ENV);
        expect(html).not.toContain('**');
        expect(html).toContain('<strong>kovář</strong>');
        expect(html).toContain('<em>v zimě</em>');
        // The note is printed cleaned, under its heading, only with the notes on.
        expect(html).toContain('class="book-notes');
        expect(html).not.toContain('🔍');
        expect(html).not.toContain('[ ]');
        expect(html).not.toContain('jistota');
        expect(buildFamilyBook(d, { lang: 'cs', privacy: 'full' }, ENV)).not.toContain('class="book-notes');
    });

    it('escapes the text before it renders emphasis', () => {
        const d = ostruznik();
        d.persons['v' as PersonId].story = { status: 'final', text: '<script>alert(1)</script> a **tučně**' };
        const html = buildFamilyBook(d, { lang: 'cs', privacy: 'full' }, ENV);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('<strong>tučně</strong>');
    });
});

describe('sources', () => {
    it('each cited source once in the list, P-numbers by first occurrence, back references to chapters', () => {
        const html = buildFamilyBook(ostruznik(), { lang: 'cs', privacy: 'full' }, ENV);
        const list = html.slice(html.indexOf('id="book-sources"'));
        const listed = [...list.matchAll(/<p class="book-source"><span class="book-pn">P(\d+)<\/span>([^<]*)/g)].map(m => [Number(m[1]), m[2]] as const);
        expect(listed.map(x => x[0])).toEqual([1, 2, 3, 4]);
        const titles = listed.map(x => x[1].split(',')[0]);
        expect(new Set(titles).size).toBe(titles.length);
        expect(titles).toEqual(expect.arrayContaining(['Matrika Lhota 1850', 'Matrika oddaných Lhota 1878', 'Matrika narozených Lhota 1880', 'Matrika narozených Brno 1950']));
        expect(list).not.toContain('Nikým necitovaný pramen');
        // Numbers first appear in order in the text: 1, 2, 3, …
        const body = html.slice(0, html.indexOf('id="book-sources"'));
        let max = 0;
        for (const m of body.matchAll(/<sup class="book-p">P(\d+)<\/sup>/g)) {
            const n = Number(m[1]);
            if (n > max) { expect(n).toBe(max + 1); max = n; }
        }
        expect(max).toBe(4);
        // The scan's address, printed short; the chapters that cite it.
        expect(list).toContain('data-print="example.org/scan/lhota/1880/page-0012"');
        expect(list).toMatch(/Matrika Lhota 1850[\s\S]*?book-source-refs"><a href="#kap-1">kap\. 1<\/a>, <a href="#kap-2">kap\. 2<\/a>/);
        // A chapter lists its own sources at its end.
        expect(html).toContain('Prameny ke kapitole');
    });

    it('printedUrl: without the scheme when short, else domain/…/last two parts', () => {
        expect(printedUrl('https://example.org/a/b')).toBe('example.org/a/b');
        expect(printedUrl('https://archives.example.org/matriky/fond/12345/kniha/678/strana/0042')).toBe('archives.example.org/…/strana/0042');
    });
});

describe('chapters along the line', () => {
    /** Founder Adam (sons Bedřich 1830 and Cyril 1832); Bedřich's son Dalibor has a family; Cyril's marriage is childless. */
    const line = (): StromData => tree([
        p('a', 'Adam', 'Trnkopal', 'male', { birthDate: '1800', deathDate: '1870', partnerships: ['ua'], childIds: ['b', 'c'] }),
        p('aw', 'Eva', 'Vlnovská', 'female', { birthDate: '1805', deathDate: '1880', partnerships: ['ua'], childIds: ['b', 'c'] }),
        p('b', 'Bedřich', 'Trnkopal', 'male', { birthDate: '1830', deathDate: '1900', parentIds: ['a', 'aw'], partnerships: ['ub'], childIds: ['d'] }),
        p('bw', 'Bára', 'Hvozdecká', 'female', { birthDate: '1835', deathDate: '1905', partnerships: ['ub'], childIds: ['d'] }),
        p('c', 'Cyril', 'Trnkopal', 'male', { birthDate: '1832', deathDate: '1899', parentIds: ['a', 'aw'], partnerships: ['uc'] }),
        p('cw', 'Cecílie', 'Mlhovcová', 'female', { birthDate: '1836', deathDate: '1910', partnerships: ['uc'] }),
        p('d', 'Dalibor', 'Trnkopal', 'male', { birthDate: '1860', deathDate: '1930', parentIds: ['b', 'bw'], partnerships: ['ud'], childIds: ['e'] }),
        p('dw', 'Dana', 'Kapradinová', 'female', { birthDate: '1862', deathDate: '1940', partnerships: ['ud'], childIds: ['e'] }),
        p('e', 'Emil', 'Trnkopal', 'male', { birthDate: '1890', deathDate: '1960', parentIds: ['d', 'dw'] }),
    ], [
        u('ua', 'a', 'aw', ['b', 'c'], { startDate: '1828' }),
        u('ub', 'b', 'bw', ['d'], { startDate: '1858' }),
        u('uc', 'c', 'cw', [], { startDate: '1860' }),
        u('ud', 'd', 'dw', ['e'], { startDate: '1888' }),
    ]);

    it('walk the line depth first: a son with his descendants before the next son; a childless union is a subchapter', () => {
        const model = buildBookModel(line(), { kind: 'tree' });
        expect(model.chapters.map(c => c.unionId)).toEqual(['ua', 'ub', 'ud', 'uc']);
        expect(model.chapters.map(c => c.sub)).toEqual([false, false, false, true]);
        expect(model.chapters.map(c => c.gen)).toEqual([1, 2, 3, 2]);
        const html = buildFamilyBook(line(), { lang: 'cs', privacy: 'full' }, ENV);
        const order = [...html.matchAll(/<article class="book-family( is-sub)?" id="kap-(\d+)">/g)].map(m => `${m[2]}${m[1] ? 's' : ''}`);
        expect(order).toEqual(['1', '2', '3', '4s']);
    });

    it('the contents: "{no} {couple} · {gen}. gen. · {wedding year}", 18 px per generation, a subchapter one step further', () => {
        const html = buildFamilyBook(line(), { lang: 'cs', privacy: 'full' }, ENV);
        const toc = regions(html).toc;
        expect(toc).toContain('<a href="#rod-1">Rod Trnkopal</a> <span class="book-muted">· kap. 1–4</span>');
        expect(toc).toContain('<li class="book-toc-fam" style="padding-left:0px"><a href="#kap-1"><span class="book-toc-no">1</span>Adam Trnkopal a Eva Vlnovská · 1. gen. · 1828</a></li>');
        expect(toc).toContain('style="padding-left:36px"><a href="#kap-3"><span class="book-toc-no">3</span>Dalibor Trnkopal a Dana Kapradinová · 3. gen. · 1888');
        expect(toc).toContain('<li class="book-toc-fam book-toc-sub" style="padding-left:36px"><a href="#kap-4">');
        // No page numbers: browsers cannot count them.
        expect(toc).not.toContain('target-counter');
    });

    it('children point to their own chapter', () => {
        const html = buildFamilyBook(line(), { lang: 'cs', privacy: 'full' }, ENV);
        const first = html.slice(html.indexOf('id="kap-1"'), html.indexOf('id="kap-2"'));
        expect(first).toContain('<a href="#kap-2">→ kap. 2</a>');
        expect(first).toContain('<a href="#kap-4">→ kap. 4</a>');
    });

    it('the tocHtml block alone lists the back of the book by the parts', () => {
        const html = buildFamilyBook(line(), { lang: 'en', privacy: 'full' }, ENV);
        expect(regions(html).toc).toContain('<a href="#book-index">Person index</a>');
        expect(typeof tocHtml).toBe('function');
    });
});

describe('stories, research controls and the detail', () => {
    it('a new version of a story: the banner and the comparison on screen, never in a saved file', () => {
        const d = ostruznik();
        d.persons['v' as PersonId].story = { status: 'final', text: 'Starý text.', draft: { text: 'Nový text.' } };
        const env = { ...ENV, storyDraftUrls: () => ({ final: 'strom-research://story?do=final', keep: 'strom-research://story?do=keep' }) };
        const screen = buildFamilyBook(d, { lang: 'cs', privacy: 'full' }, env);
        expect(screen).toContain('<div class="book-nv">');
        expect(screen).toContain('<dialog class="book-compare" id="bc-1" data-story-person="v"');
        // The approved text is printed, the draft only in the comparison.
        expect(screen.slice(0, screen.indexOf('<dialog'))).not.toContain('Nový text.');
        const saved = buildFamilyBook(d, { lang: 'cs', privacy: 'full' }, { ...env, forSave: true });
        expect(saved).not.toContain('<dialog');
        expect(saved).not.toContain('book-nv"');
    });

    it('"All" shows every excerpt in a grid of three; "Brief" sets two partners side by side', () => {
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const d = ostruznik();
        d.sources!['s3'].excerpts = [{ id: 'x1', dataUrl: png, width: 1, height: 1, sizeBytes: 70 } as never, { id: 'x2', dataUrl: png, width: 1, height: 1, sizeBytes: 70 } as never];
        const all = buildFamilyBook(d, { lang: 'cs', privacy: 'full', detail: 'all' }, ENV);
        expect(all).toMatch(/<div class="book-clips"><figure class="pp-fig book-clip">[\s\S]*?<figure class="pp-fig book-clip">/);
        const normal = buildFamilyBook(d, { lang: 'cs', privacy: 'full', detail: 'normal' }, ENV);
        expect(normal).not.toContain('<div class="book-clips">');
        const brief = buildFamilyBook(d, { lang: 'cs', privacy: 'full', detail: 'brief' }, ENV);
        expect(brief).toContain('<div class="book-pair">');
        expect(brief).not.toContain('class="book-chart');
    });
});

describe('the book options', () => {
    const opts = (o: Partial<BookOptions> = {}): BookOptions => ({ ...defaultBookOptions('en'), ...o });

    it('part availability says why a part cannot be had', () => {
        const d = ostruznik();
        const a = bookPartAvailability(d, opts({ detail: 'brief' }));
        expect(a.story).toEqual({ available: false, reason: 'The selection has no stories.' });
        expect(a.chart).toEqual({ available: false, reason: 'Only with the Normal and All detail.' });
        expect(a.history).toEqual({ available: false, reason: 'The tree has no history.' });
        expect(a.media).toEqual({ available: false, reason: 'The tree has no photos or record clippings.' });
        expect(a.sources.available).toBe(true);
        expect(a.smallRods.available).toBe(true);
        expect(bookPartAvailability(d, opts(), { hasHistory: true }).history.available).toBe(true);
        const rod = rods(buildLineages(d))[0];
        const forRods = bookPartAvailability(d, opts({ selection: { kind: 'rods', rods: [rod.id] } }));
        expect(forRods.smallRods).toEqual({ available: false, reason: 'Only in a book of the whole tree.' });
        const noSources = structuredClone(d);
        delete noSources.sources;
        expect(bookPartAvailability(noSources, opts()).sources.reason).toBe('The selection has no sources.');
        // What is unavailable is left out whatever is ticked; the families always stay.
        const eff = effectiveBookParts(d, opts({ detail: 'brief', parts: Object.fromEntries(BOOK_PART_KEYS.map(k => [k, false])) as BookOptions['parts'] }));
        expect(eff.families).toBe(true);
        expect(eff.chart).toBe(false);
        expect(effectiveBookParts(d, opts()).story).toBe(false);
    });

    it('estimateBook: under 50 ms on a thousand people, sizes ordered by detail, about half a page a person at Normal', () => {
        const big = generatedTree(22);
        const persons = Object.keys(big.persons).length;
        expect(persons).toBeGreaterThan(950);
        const index = buildLineages(big);
        estimateBook(big, opts(), { index }); // warm up
        // The best of three runs: a busy machine must not fail the budget.
        let ms = Infinity;
        for (let i = 0; i < 3; i++) {
            const t0 = performance.now();
            estimateBook(big, opts(), { index });
            ms = Math.min(ms, performance.now() - t0);
        }
        expect(ms).toBeLessThan(50);
        const normal = estimateBook(big, opts(), { index });
        const brief = estimateBook(big, opts({ detail: 'brief' }), { index });
        const all = estimateBook(big, opts({ detail: 'all' }), { index });
        expect(brief.pages).toBeLessThan(normal.pages);
        expect(normal.pages).toBeLessThan(all.pages);
        // Calibration (30 Oct 2026: 835 people at Normal ≈ 430 pages, about 0.5 a person).
        expect(normal.pages / normal.persons).toBeGreaterThan(0.3);
        expect(normal.pages / normal.persons).toBeLessThan(0.9);
        expect(normal.chapters).toBeGreaterThan(300);
        expect(normal.outline[normal.outline.length - 1]).toBe('Index of people');
    });
});

describe('typesetting helpers', () => {
    it('cssString escapes quotes, backslashes, line breaks and angle brackets for @page', () => {
        expect(cssString('Rod O"Brien')).toBe('"Rod O\\"Brien"');
        expect(cssString('a\\b')).toBe('"a\\\\b"');
        expect(cssString('a\nb')).toBe('"a b"');
        expect(cssString('</style><script>')).not.toMatch(/[<>]/);
        const css = rodPagesCss(['Rod O"Brien</style>']);
        expect(css).toContain('@page rod-1 { @top-left { content: "Rod O\\"Brien\\3c /style\\3e ";');
    });

    it('a lineage label cannot close the book\'s style element', () => {
        const d = ostruznik();
        for (const id of ['f', 'v', 'a', 'z', 'o']) d.persons[id as PersonId].lastName = 'Ostr"úž</style>';
        const html = buildFamilyBook(d, { lang: 'cs', privacy: 'full' }, ENV);
        const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
        expect(style).toContain('@page rod-1');
        expect(html.match(/<\/style>/g)).toHaveLength(1);
    });

    it('rodPlaceSpans: places with the span of dated records, most people first; protected people and their weddings skipped', () => {
        const d = ostruznik();
        const index = buildLineages(d);
        const rod = rods(index).find(r => r.surname === 'Ostružník')!;
        const spans = rodPlaceSpans(index, rod.id);
        expect(spans[0]).toEqual({ name: 'Lhota', from: 1850, to: 1880, persons: 2 });
        expect(spans.map(s => s.name)).toContain('Brno');
        const living = new Set(['z', 'zw', 'o']);
        expect(rodPlaceSpans(index, rod.id, id => living.has(id)).map(s => s.name)).toEqual(['Lhota']);
    });

    it('cleanWorkNote drops research ids, emoji, task boxes, stage and certainty marks', () => {
        expect(cleanWorkNote('- [ ] ověřit křest 🔍\n- [x] hotovo ✓\nText (jistota: nízká) zůstane.')).toBe('ověřit křest\nhotovo\nText zůstane.');
        expect(cleanWorkNote('Plain text.')).toBe('Plain text.');
    });

    it('proseHtml: paragraphs on empty lines, a single line break as a space, emphasis, no stray marks', () => {
        expect(proseHtml('One\nline.\n\nTwo **bold** *it*.', { softBreak: 'space', dropStrayMarks: true }))
            .toBe('<p>One line.</p><p>Two <strong>bold</strong> <em>it</em>.</p>');
        expect(proseHtml('A ** b *', { dropStrayMarks: true })).not.toContain('*');
        expect(proseHtml('A\nB')).toContain('<br>');
    });
});

/** `lines` independent lines of five generations (two sons each), every son married: about 46 people a line. */
function generatedTree(lines: number): StromData {
    const persons: Person[] = [];
    const unions: Partnership[] = [];
    let n = 0;
    const grow = (id: string, gen: number, born: number, surname: string, parents: string[]): void => {
        const kids: string[] = [];
        const person = p(id, `Jméno${n++}`, surname, 'male', { birthDate: String(born), deathDate: String(born + 60), parentIds: parents });
        persons.push(person);
        if (gen >= 5) return;
        const wife = `${id}w`;
        const uid = `${id}u`;
        for (let k = 0; k < 2; k++) kids.push(`${id}${k}`);
        persons.push(p(wife, `Žena${n++}`, `Rodná${n}`, 'female', { birthDate: String(born + 2), deathDate: String(born + 70), partnerships: [uid], childIds: kids }));
        person.partnerships = [uid as PartnershipId];
        person.childIds = kids as PersonId[];
        unions.push(u(uid, id, wife, kids, { startDate: String(born + 25) }));
        kids.forEach((k, i) => grow(k, gen + 1, born + 28 + i * 2, surname, [id, wife]));
    };
    for (let l = 0; l < lines; l++) grow(`L${l}_`, 1, 1700 + l, `Linie${String.fromCharCode(65 + (l % 26))}${l}`, []);
    return tree(persons, unions);
}
