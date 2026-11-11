/**
 * A source's place field by field in GEDCOM (spec 075 U3, ZADANI_VYZKUM §3):
 * the record carries the PAGE composed of the folio, the rest of the location
 * and the image, the fields themselves as `1 _STROM_FOLIO` / `_STROM_IMAGE` /
 * `_STROM_LOCATOR` (the app's own file, a research with `sources.fields`) and
 * the call number as `2 CALN` under `1 REPO`. Read back: the fields hold and
 * the PAGE is ignored; a citation carrying the composed PAGE cites the record
 * itself. A source without the new fields goes out as it always did.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { APP_VERSION, Source, StromData, STROM_DATA_VERSION } from '../types.js';
import { setLanguage, strings } from '../strings.js';

beforeAll(() => setLanguage('cs'));

const load = (text: string) => convertToStrom(parseGedcom(text), {});

function sourceTitled(data: StromData, title: string): Source {
    const s = Object.values(data.sources ?? {}).find(x => x.title === title);
    if (!s) throw new Error(`no ${title}`);
    return s;
}

/** The lines of the source record titled so. */
function sourceRecord(ged: string, title: string): string[] {
    const recs = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/).filter(l => l !== ''));
    const rec = recs.find(r => / SOUR$/.test(r[0]) && r.includes(`1 TITL ${title}`));
    if (!rec) throw new Error(`no record ${title}`);
    return rec;
}

/** The lines of the individual record with this name, from its first SOUR on. */
function citationLines(ged: string, name: string): string[] {
    const recs = ged.split(/\r?\n(?=0 )/).map(r => r.split(/\r?\n/).filter(l => l !== ''));
    const rec = recs.find(r => / INDI$/.test(r[0]) && r.some(l => l.startsWith(`1 NAME ${name}`)));
    if (!rec) throw new Error(`no person ${name}`);
    return rec.slice(rec.findIndex(l => / SOUR @/.test(l)));
}

/** A tree with one person citing one source (its fields as given). */
function tree(source: Partial<Source>): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            p1: {
                id: 'p1', firstName: 'Ludmila', lastName: 'Vzorová', gender: 'female', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], birthDate: '1865-02-03', birthSourceIds: ['s1'],
            },
        },
        partnerships: {},
        sources: { s1: { id: 's1', title: 'Křty Vzorov', ...source } },
    } as unknown as StromData;
}

const FIELDS = { repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'č. 5' };

describe('export: the PAGE composed, the fields as _STROM_*, the call number as CALN', () => {
    it('the record and the citation carry the composed PAGE; the record its fields and CALN under its REPO', () => {
        const ged = exportToGedcom(tree(FIELDS)).content;
        const rec = sourceRecord(ged, 'Křty Vzorov');
        expect(rec).toEqual(expect.arrayContaining([
            '2 CALN N 7', '1 PAGE fol. 12v, č. 5, snímek 34', '1 _STROM_FOLIO fol. 12v', '1 _STROM_IMAGE 34', '1 _STROM_LOCATOR č. 5',
        ]));
        const repo = rec.findIndex(l => /^1 REPO @R\d+@$/.test(l));
        expect(repo).toBeGreaterThan(0);
        expect(rec[repo + 1]).toBe('2 CALN N 7');
        const cite = citationLines(ged, 'Ludmila');
        expect(cite[1]).toBe('3 PAGE fol. 12v, č. 5, snímek 34');
        // the header names the app and its version (the research knows the app's file by it)
        expect(ged).toContain(`0 HEAD\n1 SOUR STROM\n2 VERS ${APP_VERSION}\n`);
    });

    it('the image word in the app\'s language; an empty field is not written', () => {
        setLanguage('de');
        try {
            const ged = exportToGedcom(tree({ folio: 'S. 15', image: '7' })).content;
            const rec = sourceRecord(ged, 'Křty Vzorov');
            expect(rec).toContain('1 PAGE S. 15, Bild 7');
            expect(rec.some(l => l.startsWith('1 _STROM_LOCATOR'))).toBe(false);
            expect(rec.some(l => l.startsWith('1 REPO'))).toBe(false);
        } finally {
            setLanguage('cs');
        }
    });

    it('a call number without an archive: under a REPO of none', () => {
        const rec = sourceRecord(exportToGedcom(tree({ callNumber: 'N 7', reference: 'fol. 3' })).content, 'Křty Vzorov');
        const at = rec.indexOf('1 REPO');
        expect(at).toBeGreaterThan(0);
        expect(rec[at + 1]).toBe('2 CALN N 7');
        // no folio, no image: the PAGE is the reference exactly, no _STROM_* lines
        expect(rec).toContain('1 PAGE fol. 3');
        expect(rec.some(l => l.startsWith('1 _STROM_FOLIO') || l.startsWith('1 _STROM_IMAGE') || l.startsWith('1 _STROM_LOCATOR'))).toBe(false);
    });

    it('a source without the new fields goes out as before (its record and citation exactly)', () => {
        const ged = exportToGedcom(tree({ repository: 'Zemský archiv Vzorov', reference: 'fol. 12v, č. 5, snímek 34', quality: 3 })).content;
        const rec = sourceRecord(ged, 'Křty Vzorov');
        expect(rec.slice(1)).toEqual([
            '1 TITL Křty Vzorov', expect.stringMatching(/^1 REPO @R\d+@$/), '1 PAGE fol. 12v, č. 5, snímek 34',
        ]);
        expect(citationLines(ged, 'Ludmila').slice(0, 3)).toEqual([
            expect.stringMatching(/^2 SOUR @S\d+@$/), '3 PAGE fol. 12v, č. 5, snímek 34', '3 QUAY 3',
        ]);
        expect(ged).not.toContain('CALN');
        expect(ged).not.toMatch(/_STROM_(FOLIO|IMAGE|LOCATOR)/);
    });

    it('to a research without sources.fields and "Back to {prog}": the composed PAGE and CALN, no _STROM_* fields', () => {
        for (const options of [{ sourceFields: false }, { backTo: 'I1' }]) {
            const ged = exportToGedcom(tree(FIELDS), undefined, options).content;
            expect(ged, JSON.stringify(options)).not.toMatch(/_STROM_(FOLIO|IMAGE|LOCATOR)/);
            expect(ged).toContain('2 CALN N 7');
            expect(citationLines(ged, 'Ludmila')[1]).toBe('3 PAGE fol. 12v, č. 5, snímek 34');
        }
        expect(sourceRecord(exportToGedcom(tree(FIELDS), undefined, { sourceFields: false }).content, 'Křty Vzorov'))
            .toContain('1 PAGE fol. 12v, č. 5, snímek 34');
        // with the feature: the fields go along
        expect(exportToGedcom(tree(FIELDS), undefined, { sourceFields: true }).content).toContain('1 _STROM_IMAGE 34');
    });

    it('N1: the reference naming the image the field gives too says it once; _STROM_LOCATOR carries the reference whole', () => {
        const rec = sourceRecord(exportToGedcom(tree({ reference: 'fol. 12, snímek 3', image: '4' })).content, 'Křty Vzorov');
        expect(rec).toContain('1 PAGE fol. 12, snímek 4');
        expect(rec).toContain('1 _STROM_LOCATOR fol. 12, snímek 3');
        expect(rec).toContain('1 _STROM_IMAGE 4');
    });
});

describe('import: the fields hold, the PAGE is ignored; CALN into the call number', () => {
    const RESEARCH = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.31.0
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ludmila /Vzorová/
1 SEX F
1 BIRT
2 DATE 3 FEB 1865
2 SOUR @S1@
3 PAGE fol. 12v, č. 5, image 34
0 @S1@ SOUR
1 TITL Křty Vzorov
1 REPO @R1@
2 CALN N 7
1 REPO @R2@
2 CALN N 8
1 PAGE fol. 12v, č. 5, image 34
1 _STROM_FOLIO fol. 12v
1 _STROM_IMAGE 34
1 _STROM_LOCATOR č. 5
1 WWW https://archiv.vzorov.example/snimek/34
1 REFN S0012
0 @R1@ REPO
1 NAME Zemský archiv Vzorov
0 @R2@ REPO
1 NAME Farní úřad Vzorov
0 TRLR
`;

    it('a record with _STROM_* lines: folio, image, the rest from _STROM_LOCATOR; the first CALN; nothing counted as dropped', () => {
        const r = load(RESEARCH);
        const s = sourceTitled(r.data, 'Křty Vzorov');
        expect(s).toMatchObject({ repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'č. 5' });
        expect(s.note ?? '').not.toContain('N 7');
        expect(r.stats.droppedTagSummary).not.toMatch(/_STROM_|CALN/);
        // the citation's PAGE is the record's composed one (in the research's language): the record itself, no page source
        expect(Object.keys(r.data.sources ?? {})).toHaveLength(1);
        const p = Object.values(r.data.persons)[0];
        expect(p.birthSourceIds).toEqual([s.id]);
    });

    it('only the folio: the rest is empty (the PAGE is not taken)', () => {
        const r = load(RESEARCH.replace('1 _STROM_IMAGE 34\n1 _STROM_LOCATOR č. 5\n', ''));
        const s = sourceTitled(r.data, 'Křty Vzorov');
        expect(s.folio).toBe('fol. 12v');
        expect(s.image).toBeUndefined();
        expect(s.reference).toBeUndefined();
    });

    it('an older file (no _STROM_*): the PAGE as the whole location, unchanged; CALN still the call number, no note line', () => {
        const old = RESEARCH.replace('1 _STROM_FOLIO fol. 12v\n1 _STROM_IMAGE 34\n1 _STROM_LOCATOR č. 5\n', '');
        const r = load(old);
        const s = sourceTitled(r.data, 'Křty Vzorov');
        expect(s.reference).toBe('fol. 12v, č. 5, image 34');
        expect(s.folio).toBeUndefined();
        expect(s.image).toBeUndefined();
        expect(s.callNumber).toBe('N 7');
        expect(s.note ?? '').not.toContain(strings.gedcomNotes.sourceCallNumber('N 7'));
    });

    it('a citation of another page: a source of its own, the PAGE its whole location, the book\'s call number with it', () => {
        const other = RESEARCH.replace('3 PAGE fol. 12v, č. 5, image 34', '3 PAGE fol. 13, č. 9');
        const r = load(other);
        const sources = Object.values(r.data.sources ?? {});
        expect(sources).toHaveLength(2);
        const page = sources.find(x => x.reference === 'fol. 13, č. 9')!;
        expect(page).toMatchObject({ title: 'Křty Vzorov', callNumber: 'N 7' });
        expect(page.folio).toBeUndefined();
        expect(page.image).toBeUndefined();
    });

    it('a REPO of none with its CALN', () => {
        const r = load(RESEARCH.replace('1 REPO @R1@\n2 CALN N 7\n1 REPO @R2@\n2 CALN N 8\n', '1 REPO\n2 CALN N 7\n'));
        const s = sourceTitled(r.data, 'Křty Vzorov');
        expect(s.callNumber).toBe('N 7');
        expect(s.repository).toBeUndefined();
    });
});

describe('round trip: the app\'s file read back keeps every field', () => {
    it('archive, call number, folio, image, the rest, URL — and a long rest over CONC lines', () => {
        const long = `č. 5, ${'poznámka k zápisu '.repeat(20).trim()}`;
        for (const src of [FIELDS, { ...FIELDS, reference: long, url: 'https://archiv.vzorov.example/snimek/34' }, { callNumber: 'N 7', image: '57–58' }]) {
            const back = load(exportToGedcom(tree(src)).content);
            const s = sourceTitled(back.data, 'Křty Vzorov');
            for (const k of ['repository', 'callNumber', 'folio', 'image', 'reference', 'url'] as const) {
                expect(s[k], k).toBe((src as Partial<Source>)[k]);
            }
            expect(Object.keys(back.data.sources ?? {})).toHaveLength(1);
        }
    });

    it('an older source reads back as it went out: its whole location, no fields', () => {
        const back = load(exportToGedcom(tree({ repository: 'Zemský archiv Vzorov', reference: 'fol. 12v, č. 5, snímek 34' })).content);
        const s = sourceTitled(back.data, 'Křty Vzorov');
        expect(s.reference).toBe('fol. 12v, č. 5, snímek 34');
        expect(s.folio).toBeUndefined();
        expect(s.image).toBeUndefined();
        expect(s.callNumber).toBeUndefined();
    });
});

describe('data version 18 (spec 075)', () => {
    it('is at least 18', () => {
        expect(STROM_DATA_VERSION).toBeGreaterThanOrEqual(18);
    });

    it('a v17 tree with older sources loads unchanged: the whole location stays in reference, no field is added', () => {
        const old = { ...tree({ repository: 'Zemský archiv Vzorov', reference: 'fol. 12v, č. 5, snímek 34' }), version: 17 } as StromData;
        old.sources!.s2 = { id: 's2', title: 'Sňatky Vzorov', reference: 'pag. 58, č. 9' };
        const loaded = migrateData(structuredClone(old));
        expect(loaded.sources).toEqual(old.sources);
        for (const s of Object.values(loaded.sources ?? {})) {
            expect('folio' in s || 'image' in s || 'callNumber' in s).toBe(false);
        }
    });

    it('a v18 tree keeps the fields', () => {
        const loaded = migrateData(structuredClone(tree(FIELDS)));
        expect(loaded.sources?.s1).toMatchObject(FIELDS);
    });
});
