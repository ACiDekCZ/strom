/**
 * The reliability belongs to the citation (spec 077, data version 19): the
 * same entry cited at two facts with another QUAY is one source with its
 * image, each citation keeping its QUAY; a file written from the tree (to the
 * research, "Back to {prog}", a plain GEDCOM) gives every citation its QUAY
 * back; a tree of 3.26 with sources made only for another QUAY gets them
 * joined into the entry, a source edited by hand stays. Invented data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));
vi.mock('../research-copy.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../research-copy.js')>()),
    rebaseResearchCopies: vi.fn(async () => undefined),
}));

import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { createSnapshot } from '../snapshots.js';
import { CONTENT_PRESETS } from '../privacy.js';
import {
    citationQuality, setCitationQuality, unionCitations, remapCitations, cleanTreeCitationQuay,
    qualityOnlySources, joinQualityOnlySources,
} from '../citation-quality.js';
import { StromData, Person, Source, TreeId, LifeEvent, STROM_DATA_VERSION } from '../types.js';

// ---------- fixtures ----------

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));
/** A JPEG header (SOI + APP0 + SOF0) claiming 1200×240. */
const JPEG = 'data:image/jpeg;base64,' + b64([0xFF, 0xD8,
    0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xFF, 0xC0, 0, 17, 8, 0, 240, 1200 >> 8, 1200 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xFF, 0xD9]);

const CENSUS = 'Census Bludovec 1857';
const REG_1667 = 'Register Bludovec 1667';
const REG_1668 = 'Register Bludovec 1668';

/**
 * The pattern of the report: a census entry (an original, one image) gives
 * the occupation first hand (QUAY 3) and the birth from the age (QUAY 2); two
 * registers are cited the same way.
 */
function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.30.1', '2 NAME Strom Research', '1 DATE 11 NOV 2026', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Drahoslav /Zlatoňák/', '1 SEX M', '1 REFN P0001',
        '1 BIRT', '2 DATE 1821', '2 SOUR @S0001@', '3 PAGE fol. 7', '3 QUAY 2',
        '1 OCCU chalupník', '2 SOUR @S0001@', '3 PAGE fol. 7', '3 QUAY 3',
        '1 DEAT', '2 DATE 1667', '2 SOUR @S0002@', '3 PAGE fol. 4', '3 QUAY 3',
        '1 RESI', '2 PLAC Bludovec', '2 SOUR @S0002@', '3 PAGE fol. 4', '3 QUAY 1',
        '0 @P0002@ INDI', '1 NAME Vratislavka /Hroznatová/', '1 SEX F', '1 REFN P0002',
        '1 BAPM', '2 DATE 1668', '2 SOUR @S0003@', '3 PAGE s. 9', '3 QUAY 3',
        '1 SOUR @S0003@', '2 PAGE s. 9', '2 QUAY 2',
        '0 @S0001@ SOUR', '1 TITL Census Bludovec 1857', '1 REFN S0001', '1 PUBL Bludovec archive',
        '1 OBJE', '2 FORM jpg', '2 TITL fol. 7', '2 _STROM_KIND excerpt',
        `2 FILE ${JPEG.slice(0, 40)}`, `3 CONC ${JPEG.slice(40)}`,
        '0 @S0002@ SOUR', '1 TITL Register Bludovec 1667', '1 REFN S0002', '1 PUBL Bludovec archive',
        '0 @S0003@ SOUR', '1 TITL Register Bludovec 1668', '1 REFN S0003', '1 PUBL Bludovec archive',
        '0 TRLR',
    ].join('\n');
}

/** The same pattern as another program writes it (no Strom tags, no REFN). */
function otherProgramGed(): string {
    return [
        '0 HEAD', '1 SOUR FAMILYPROG', '2 NAME Family Program', '2 VERS 7.0', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Drahoslav /Zlatoňák/', '1 SEX M',
        '1 BIRT', '2 DATE 1821', '2 SOUR @S1@', '3 PAGE fol. 7', '3 QUAY 2',
        '1 OCCU chalupník', '2 SOUR @S1@', '3 PAGE fol. 7', '3 QUAY 3',
        '1 DEAT', '2 DATE 1880', '2 SOUR @S1@', '3 PAGE fol. 7',
        '0 @S1@ SOUR', '1 TITL Census Bludovec 1857', '1 PUBL Bludovec archive',
        '0 TRLR',
    ].join('\n');
}

const ORIGIN: GedcomImportOrigin = { at: '2026-11-11', file: 'family.ged', encoding: 'utf-8' };
const read = (ged: string, origin?: GedcomImportOrigin): StromData =>
    migrateData(convertToStrom(parseGedcom(ged), origin ? { importOrigin: origin } : {}).data);
const sourcesNamed = (d: StromData, title: string): Source[] => Object.values(d.sources ?? {}).filter(s => s.title === title);
const named = (d: StromData, first: string): Person => Object.values(d.persons).find(p => p.firstName === first)!;
const eventOf = (p: Person, type: string): LifeEvent => p.events!.find(e => e.type === type)!;

/**
 * Every citation's QUAY in a GEDCOM file: `<person's name>|<fact tag>|<source title>` → QUAY
 * ('-' for a citation without one). The person's own citations have the fact tag `INDI`.
 */
function quaysOf(ged: string): Record<string, string> {
    const lines = ged.split(/\r?\n/);
    const titles = new Map<string, string>();
    let rec = '';
    for (const l of lines) {
        const m = /^0 (@[^@]+@) SOUR/.exec(l);
        if (m) rec = m[1];
        else if (l.startsWith('0 ')) rec = '';
        else if (rec && l.startsWith('1 TITL ')) titles.set(rec, l.slice(7));
    }
    const out: Record<string, string> = {};
    let name = '';
    let fact = '';
    let cite: { key: string; level: number } | null = null;
    const close = () => { if (cite && !(cite.key in out)) out[cite.key] = '-'; cite = null; };
    for (const l of lines) {
        const [lv, tag, ...rest] = l.split(' ');
        const level = Number(lv);
        if (cite && level <= cite.level) close();
        if (level === 0) { name = ''; fact = ''; continue; }
        if (level === 1 && tag === 'NAME' && !name) name = rest.join(' ');
        if (level === 1) fact = tag === 'SOUR' ? 'INDI' : tag;
        if (tag === 'SOUR' && /^@[^@]+@$/.test(rest[0] ?? '') && name) {
            cite = { key: `${name}|${fact}|${titles.get(rest[0]) ?? rest[0]}`, level };
        } else if (cite && tag === 'QUAY') {
            out[cite.key] = rest[0];
        }
    }
    close();
    return out;
}

const REPORT_QUAYS = {
    'Drahoslav /Zlatoňák/|BIRT|Census Bludovec 1857': '2',
    'Drahoslav /Zlatoňák/|OCCU|Census Bludovec 1857': '3',
    'Drahoslav /Zlatoňák/|DEAT|Register Bludovec 1667': '3',
    'Drahoslav /Zlatoňák/|RESI|Register Bludovec 1667': '1',
    'Vratislavka /Hroznatová/|BAPM|Register Bludovec 1668': '3',
    'Vratislavka /Hroznatová/|INDI|Register Bludovec 1668': '2',
};

// ---------- K1.1: import ----------

describe('import: one source cited with another QUAY (K1.1)', () => {
    it('the census is one source with its image; each citation keeps its QUAY', () => {
        const d = read(researchGed());
        const census = sourcesNamed(d, CENSUS);
        expect(census).toHaveLength(1);
        expect(census[0].excerpts).toHaveLength(1);
        expect(census[0].refn).toBe('S0001');
        const p = named(d, 'Drahoslav');
        expect(p.birthSourceIds).toEqual([census[0].id]);
        expect(eventOf(p, 'occupation').sourceIds).toEqual([census[0].id]);
        expect(citationQuality(p, 'birthSourceIds', census[0].id, d.sources)).toBe(2);
        expect(citationQuality(eventOf(p, 'occupation'), 'sourceIds', census[0].id, d.sources)).toBe(3);
    });

    it('the two registers are each one source, the QUAY at the citation', () => {
        const d = read(researchGed());
        const [r1667] = sourcesNamed(d, REG_1667);
        const [r1668] = sourcesNamed(d, REG_1668);
        expect(sourcesNamed(d, REG_1667)).toHaveLength(1);
        expect(sourcesNamed(d, REG_1668)).toHaveLength(1);
        expect(Object.keys(d.sources ?? {})).toHaveLength(3);
        const p = named(d, 'Drahoslav');
        expect(citationQuality(p, 'deathSourceIds', r1667.id, d.sources)).toBe(3);
        expect(citationQuality(eventOf(p, 'residence'), 'sourceIds', r1667.id, d.sources)).toBe(1);
        const v = named(d, 'Vratislavka');
        expect(citationQuality(eventOf(v, 'baptism'), 'sourceIds', r1668.id, d.sources)).toBe(3);
        expect(citationQuality(v, 'sourceIds', r1668.id, d.sources)).toBe(2);
    });

    it('only a QUAY other than the source\'s is kept at the citation', () => {
        const d = read(researchGed());
        const [census] = sourcesNamed(d, CENSUS);
        const p = named(d, 'Drahoslav');
        const occu = eventOf(p, 'occupation');
        const own = [p.citationQuay?.birthSourceIds?.[census.id], occu.citationQuay?.sourceIds?.[census.id]];
        // One of the two is the source's default, the other is kept at its citation.
        expect(own.filter(v => v !== undefined)).toHaveLength(1);
        expect([2, 3]).toContain(census.quality);
    });

    it('a citation without a QUAY of a source with one is kept as none', () => {
        const d = read(otherProgramGed(), ORIGIN);
        const [census] = sourcesNamed(d, CENSUS);
        expect(sourcesNamed(d, CENSUS)).toHaveLength(1);
        const p = named(d, 'Drahoslav');
        expect(citationQuality(p, 'deathSourceIds', census.id, d.sources)).toBeUndefined();
        expect(citationQuality(p, 'birthSourceIds', census.id, d.sources)).toBe(2);
        expect(citationQuality(eventOf(p, 'occupation'), 'sourceIds', census.id, d.sources)).toBe(3);
    });
});

// ---------- K1.2: another page or date still an entry of its own ----------

describe('another page or date is still a source of its own (K1.2)', () => {
    const ged = (extra: string[]) => [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.30.1', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Drahoslav /Zlatoňák/', '1 SEX M', '1 REFN P0001',
        '1 BIRT', '2 DATE 1821', '2 SOUR @S0001@', '3 PAGE fol. 7', '3 QUAY 3',
        ...extra,
        '0 @S0001@ SOUR', '1 TITL Census Bludovec 1857', '1 REFN S0001',
        '0 TRLR',
    ].join('\n');

    it('another page: its own source; cited there with two QUAYs it is still one', () => {
        const d = read(ged([
            '1 OCCU chalupník', '2 SOUR @S0001@', '3 PAGE fol. 9', '3 QUAY 3',
            '1 RESI', '2 PLAC Bludovec', '2 SOUR @S0001@', '3 PAGE fol. 9', '3 QUAY 1',
        ]));
        const census = sourcesNamed(d, CENSUS);
        expect(census).toHaveLength(2);
        const page9 = census.find(s => s.reference === 'fol. 9')!;
        // The page's entry, not the record (that has the research's number).
        expect(page9.refn).toBeUndefined();
        const p = named(d, 'Drahoslav');
        expect(eventOf(p, 'occupation').sourceIds).toEqual([page9.id]);
        expect(eventOf(p, 'residence').sourceIds).toEqual([page9.id]);
        expect(citationQuality(eventOf(p, 'occupation'), 'sourceIds', page9.id, d.sources)).toBe(3);
        expect(citationQuality(eventOf(p, 'residence'), 'sourceIds', page9.id, d.sources)).toBe(1);
    });

    it('another date of the entry at the same page: its own source', () => {
        const d = read(ged(['1 OCCU chalupník', '2 SOUR @S0001@', '3 PAGE fol. 7', '3 DATA', '4 DATE 2 MAR 1857', '3 QUAY 2']));
        const census = sourcesNamed(d, CENSUS);
        expect(census).toHaveLength(2);
        const dated = census.find(s => s.recordDate === '1857-03-02')!;
        expect(eventOf(named(d, 'Drahoslav'), 'occupation').sourceIds).toEqual([dated.id]);
    });
});

// ---------- K1.3: export ----------

describe('export: every citation has its QUAY (K1.3)', () => {
    it('to the research and back again: no QUAY of any citation changes', () => {
        expect(quaysOf(researchGed())).toEqual(REPORT_QUAYS);
        const once = read(researchGed());
        const sent = exportToGedcom(once, 'Zlatoňák', { research: { id: 'r-test' } }).content;
        expect(quaysOf(sent)).toEqual(REPORT_QUAYS);
        // The research's file read again (as the research would send it back) and sent again.
        const twice = read(sent);
        expect(Object.keys(twice.sources ?? {})).toHaveLength(3);
        const again = exportToGedcom(twice, 'Zlatoňák', { research: { id: 'r-test' } }).content;
        expect(quaysOf(again)).toEqual(REPORT_QUAYS);
        // One image, one source in the file.
        expect(again.split('\n').filter(l => l === '0 @S1@ SOUR' || /^0 @[^@]+@ SOUR$/.test(l))).toHaveLength(3);
    });

    it('a plain GEDCOM and "Back to {prog}" write each citation\'s QUAY', () => {
        const d = read(otherProgramGed(), ORIGIN);
        const want = {
            'Drahoslav /Zlatoňák/|BIRT|Census Bludovec 1857': '2',
            'Drahoslav /Zlatoňák/|OCCU|Census Bludovec 1857': '3',
            'Drahoslav /Zlatoňák/|DEAT|Census Bludovec 1857': '-',
        };
        expect(quaysOf(otherProgramGed())).toEqual(want);
        expect(quaysOf(exportToGedcom(d, 'Zlatoňák').content)).toEqual(want);
        const back = exportToGedcom(d, 'Zlatoňák', { content: CONTENT_PRESETS.back, origins: true, backTo: d.imports![0].id }).content;
        expect(quaysOf(back)).toEqual(want);
    });

    it('without QUAY of its own a citation writes its source\'s, as before', () => {
        const d = read(otherProgramGed(), ORIGIN);
        cleanTreeCitationQuay(d);
        for (const p of Object.values(d.persons)) {
            delete p.citationQuay;
            for (const e of p.events ?? []) delete e.citationQuay;
        }
        const [census] = sourcesNamed(d, CENSUS);
        const q = quaysOf(exportToGedcom(d, 'Zlatoňák').content);
        expect(new Set(Object.values(q))).toEqual(new Set([String(census.quality)]));
    });
});

// ---------- the helpers ----------

describe('citation QUAY helpers', () => {
    const SOURCES: Record<string, Source> = {
        a: { id: 'a', title: 'A', quality: 3 },
        b: { id: 'b', title: 'B', quality: 1 },
        c: { id: 'c', title: 'C' },
    };

    it('setCitationQuality keeps only a QUAY other than the source\'s', () => {
        const h: { sourceIds?: string[]; citationQuay?: Record<string, Record<string, number | null>> } = { sourceIds: ['a', 'c'] };
        setCitationQuality(h, 'sourceIds', 'a', 3, SOURCES);
        expect(h.citationQuay).toBeUndefined();
        setCitationQuality(h, 'sourceIds', 'a', 2, SOURCES);
        expect(citationQuality(h, 'sourceIds', 'a', SOURCES)).toBe(2);
        setCitationQuality(h, 'sourceIds', 'a', undefined, SOURCES);
        expect(h.citationQuay).toEqual({ sourceIds: { a: null } });
        expect(citationQuality(h, 'sourceIds', 'a', SOURCES)).toBeUndefined();
        setCitationQuality(h, 'sourceIds', 'a', 3, SOURCES);
        expect(h.citationQuay).toBeUndefined();
        expect(citationQuality(h, 'sourceIds', 'c', SOURCES)).toBeUndefined();
    });

    it('unionCitations adds the other\'s citations with their own QUAY, the kept ones keep theirs', () => {
        const keep = { sourceIds: ['a'], citationQuay: { sourceIds: { a: 1 } } };
        const other = { sourceIds: ['a', 'b'], citationQuay: { sourceIds: { a: 2, b: 0 } } };
        unionCitations(keep, other, 'sourceIds');
        expect(keep.sourceIds).toEqual(['a', 'b']);
        expect(keep.citationQuay).toEqual({ sourceIds: { a: 1, b: 0 } });
    });

    it('remapCitations moves a citation to the kept source with the QUAY it had', () => {
        const data = {
            persons: {
                x: { id: 'x', firstName: 'Drahoslav', lastName: 'Zlatoňák', gender: 'male', partnerships: [], parentIds: [], childIds: [],
                    sourceIds: ['b2', 'c'], birthSourceIds: ['a2'], citationQuay: { birthSourceIds: { a2: 0 } } },
            },
            partnerships: {},
            sources: { a: SOURCES.a, b: SOURCES.b, c: SOURCES.c },
        } as unknown as StromData;
        const before: Record<string, Source> = { ...SOURCES, a2: { id: 'a2', title: 'A' , quality: 2 }, b2: { id: 'b2', title: 'B', quality: 1 } };
        remapCitations(data, new Map([['a2', 'a'], ['b2', 'b']]), before);
        const p = data.persons['x' as keyof typeof data.persons];
        expect(p.sourceIds).toEqual(['b', 'c']);
        expect(p.birthSourceIds).toEqual(['a']);
        // Its own 0 goes with it; b2's default 1 is b's: nothing of its own.
        expect(citationQuality(p, 'birthSourceIds', 'a', data.sources)).toBe(0);
        expect(p.citationQuay?.sourceIds).toBeUndefined();
    });
});

// ---------- K1.5: migration of a tree from 3.26 ----------

/**
 * The tree as 3.26 stored it: the birth's citation of the census (another
 * QUAY) on a source of its own `<id>~1` made of the entry, without its image.
 */
function storedBy326(version: 17 | 18): { data: StromData; census: Source; derived: Source } {
    const d = read(researchGed());
    const [census] = sourcesNamed(d, CENSUS);
    const p = named(d, 'Drahoslav');
    const occu = eventOf(p, 'occupation');
    const birthQuay = citationQuality(p, 'birthSourceIds', census.id, d.sources)!;
    // The entry's own QUAY is the occupation's; the birth's was the derived source's.
    census.quality = citationQuality(occu, 'sourceIds', census.id, d.sources);
    delete p.citationQuay;
    delete occu.citationQuay;
    const derived: Source = {
        id: `${census.id}~1`, title: census.title, reference: census.reference, quality: birthQuay,
        ...(census.repository ? { repository: census.repository } : {}),
        ...(census.note ? { note: census.note } : {}),
        ...(census.url ? { url: census.url } : {}),
        ...(census.gedcomExtra ? { gedcomExtra: census.gedcomExtra } : {}),
        ...(census.importId ? { importId: census.importId } : {}),
        ...(census.originalIds ? { originalIds: census.originalIds } : {}),
    };
    d.sources![derived.id] = derived;
    p.birthSourceIds = [derived.id];
    cleanTreeCitationQuay(d);
    d.version = version;
    return { data: d, census, derived };
}

describe('a tree of 3.26: sources made only for another QUAY are joined (K1.5)', () => {
    for (const version of [17, 18] as const) {
        it(`v${version}: the derived source goes, the birth cites the census with its QUAY`, () => {
            const { data, census, derived } = storedBy326(version);
            expect(qualityOnlySources(data.sources)).toEqual(new Map([[derived.id, census.id]]));
            const loaded = migrateData(structuredClone(data));
            expect(loaded.sources?.[derived.id]).toBeUndefined();
            expect(sourcesNamed(loaded, CENSUS)).toHaveLength(1);
            const p = named(loaded, 'Drahoslav');
            expect(p.birthSourceIds).toEqual([census.id]);
            expect(citationQuality(p, 'birthSourceIds', census.id, loaded.sources)).toBe(derived.quality);
            expect(citationQuality(eventOf(p, 'occupation'), 'sourceIds', census.id, loaded.sources)).toBe(census.quality);
            // Written back: the QUAYs of the research's file.
            expect(quaysOf(exportToGedcom(loaded, 'Zlatoňák', { research: { id: 'r-test' } }).content)).toEqual(REPORT_QUAYS);
        });
    }

    it('another page made once per QUAY (the research\'s file): its twins become one', () => {
        const d = read([
            '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.30.1', '1 CHAR UTF-8',
            '0 @P0001@ INDI', '1 NAME Drahoslav /Zlatoňák/', '1 SEX M', '1 REFN P0001',
            '1 BIRT', '2 DATE 1821', '2 SOUR @S0001@', '3 PAGE fol. 7', '3 QUAY 3',
            '1 OCCU chalupník', '2 SOUR @S0001@', '3 PAGE fol. 9', '3 QUAY 3',
            '1 RESI', '2 PLAC Bludovec', '2 SOUR @S0001@', '3 PAGE fol. 9', '3 QUAY 1',
            '0 @S0001@ SOUR', '1 TITL Census Bludovec 1857', '1 REFN S0001',
            '0 TRLR',
        ].join('\n'));
        const page9 = sourcesNamed(d, CENSUS).find(s => s.reference === 'fol. 9')!;
        const p = named(d, 'Drahoslav');
        const resi = eventOf(p, 'residence');
        // As 3.26 read it: the residence's citation on a twin of the page with its QUAY.
        const twin: Source = { ...page9, id: `${page9.id}~2`, quality: 1 };
        delete resi.citationQuay;
        d.sources![twin.id] = twin;
        resi.sourceIds = [twin.id];
        d.version = 18;
        const loaded = migrateData(structuredClone(d));
        expect(loaded.sources?.[twin.id]).toBeUndefined();
        expect(sourcesNamed(loaded, CENSUS)).toHaveLength(2);
        const lp = named(loaded, 'Drahoslav');
        expect(eventOf(lp, 'residence').sourceIds).toEqual([page9.id]);
        expect(citationQuality(eventOf(lp, 'residence'), 'sourceIds', page9.id, loaded.sources)).toBe(1);
        expect(citationQuality(eventOf(lp, 'occupation'), 'sourceIds', page9.id, loaded.sources)).toBe(3);
    });

    it('another program\'s file (no record with more): joined into the first from the same record', () => {
        const d = read(otherProgramGed(), ORIGIN);
        const [census] = sourcesNamed(d, CENSUS);
        const p = named(d, 'Drahoslav');
        const birthQuay = citationQuality(p, 'birthSourceIds', census.id, d.sources);
        const derived: Source = { ...census, id: `${census.id}~1`, quality: birthQuay };
        delete p.citationQuay;
        for (const e of p.events ?? []) delete e.citationQuay;
        census.quality = 3;
        d.sources![derived.id] = derived;
        p.birthSourceIds = [derived.id];
        d.version = 18;
        expect(qualityOnlySources(d.sources)).toEqual(new Map([[derived.id, census.id]]));
        // Two such sources a person made by hand (no mark of a file) stay apart.
        const hand = structuredClone(d);
        for (const s of Object.values(hand.sources ?? {})) { delete s.importId; delete s.originalIds; }
        expect(qualityOnlySources(hand.sources).size).toBe(0);
    });

    it('a v19 tree is not touched', () => {
        const { data } = storedBy326(18);
        data.version = 19;
        const loaded = migrateData(structuredClone(data));
        expect(Object.keys(loaded.sources ?? {}).sort()).toEqual(Object.keys(data.sources ?? {}).sort());
    });

    it('a derived source edited by hand stays (a note, a transcript, an image)', () => {
        const edits: Array<(s: Source) => void> = [
            s => { s.note = 'Age given by the neighbour'; },
            s => { s.transcript = 'Drahoslav, 36 years'; },
            s => { s.excerpts = [{ id: 'exc9', dataUrl: JPEG, width: 1200, height: 240, sizeBytes: 50 }]; },
        ];
        for (const edit of edits) {
            const { data, derived } = storedBy326(18);
            edit(data.sources![derived.id]);
            const loaded = migrateData(structuredClone(data));
            expect(loaded.sources?.[derived.id]).toBeDefined();
            expect(named(loaded, 'Drahoslav').birthSourceIds).toEqual([derived.id]);
        }
    });

    it('a derived source with the entry\'s QUAY is not joined (nothing to carry)', () => {
        const { data, census, derived } = storedBy326(18);
        data.sources![derived.id].quality = census.quality;
        expect(qualityOnlySources(data.sources).size).toBe(0);
    });

    it('joinQualityOnlySources also moves an attachment naming the derived source', () => {
        const { data, census, derived } = storedBy326(18);
        const p = named(data, 'Drahoslav');
        p.attachments = [{ id: 'att1', name: 'scan', mimeType: 'image/jpeg', dataUrl: JPEG, sizeBytes: 50, sourceId: derived.id }];
        expect(joinQualityOnlySources(data)).toBe(1);
        expect(p.attachments[0].sourceId).toBe(census.id);
    });

    describe('TreeManager.readTreeData', () => {
        const TREE = 'quay-326' as TreeId;
        let saved: StromData[];
        beforeEach(() => {
            saved = [];
            vi.mocked(createSnapshot).mockClear();
            vi.spyOn(TreeManager, 'saveTreeData').mockImplementation((_id, data) => { saved.push(JSON.parse(JSON.stringify(data))); });
        });
        afterEach(() => { vi.restoreAllMocks(); });

        it('backs the tree up before the update, joins and saves it once', async () => {
            const { data, census, derived } = storedBy326(18);
            vi.spyOn(TreeManager as unknown as { readTreeRecord: () => Promise<unknown> }, 'readTreeRecord')
                .mockResolvedValue({ status: 'ok', data: structuredClone(data) });
            const result = await TreeManager.readTreeData(TREE);
            if (result.status !== 'ok') throw new Error(result.status);
            expect(createSnapshot).toHaveBeenCalledTimes(1);
            expect(vi.mocked(createSnapshot).mock.calls[0][2]).toBe('pre-migration');
            // The backup is the tree as it was.
            expect((vi.mocked(createSnapshot).mock.calls[0][1] as StromData).sources?.[derived.id]).toBeDefined();
            expect(saved).toHaveLength(1);
            expect(saved[0].sources?.[derived.id]).toBeUndefined();
            expect(named(result.data, 'Drahoslav').birthSourceIds).toEqual([census.id]);
        });

        it('a tree with nothing to join keeps its sources; backed up and saved once for data version 20', async () => {
            const d = read(researchGed());
            d.version = 18;
            const sources = structuredClone(d.sources);
            vi.spyOn(TreeManager as unknown as { readTreeRecord: () => Promise<unknown> }, 'readTreeRecord')
                .mockResolvedValue({ status: 'ok', data: d });
            await TreeManager.readTreeData(TREE);
            expect(createSnapshot).toHaveBeenCalledTimes(1);
            expect(saved).toHaveLength(1);
            expect(saved[0].sources).toEqual(sources);
        });

        it('a v20 tree is neither backed up nor saved', async () => {
            const d = read(researchGed());
            d.version = 20;
            vi.spyOn(TreeManager as unknown as { readTreeRecord: () => Promise<unknown> }, 'readTreeRecord')
                .mockResolvedValue({ status: 'ok', data: d });
            await TreeManager.readTreeData(TREE);
            expect(createSnapshot).not.toHaveBeenCalled();
            expect(saved).toHaveLength(0);
        });
    });
});

describe('data version', () => {
    it('is at least 19', () => {
        expect(STROM_DATA_VERSION).toBeGreaterThanOrEqual(19);
    });
});
