/**
 * Spec 095 in GEDCOM: a fact's main citation (`3 _STROM_MAIN Y` under its
 * `2 SOUR`), the events a source record records (`1 DATA / 2 EVEN`), the
 * order of a fact's `2 SOUR` (K1.1) and a page of a research's record going
 * to the research as a citation of that record (fictional people).
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { researchGedcom, researchGedcomExport } from '../ui/research-ui.js';
import { researchCitationsOut } from '../citation-gates.js';
import { LifeEvent, Person, StromData } from '../types.js';

const HEAD = '0 HEAD\n1 SOUR OTHERPROG\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n';

/** One file of another program with a main citation at every kind of fact, and one where none is a fact's. */
const MARKED = HEAD + [
    '0 @I1@ INDI', '1 NAME Kryštof /Jestřáb/', '1 SEX M',
    '1 SOUR @S3@', '2 _STROM_MAIN Y',
    '1 BIRT', '2 DATE 12 MAR 1851',
    '2 SOUR @S1@', '3 QUAY 3',
    '2 SOUR @S2@', '3 QUAY 1', '3 _STROM_MAIN Y',
    '2 SOUR @S3@', '3 _STROM_MAIN Y',
    '1 DEAT', '2 DATE 1910',
    '2 SOUR @S1@', '3 PAGE fol. 99', '3 _STROM_MAIN Y',
    '2 SOUR @S2@',
    '1 OCCU Mlynář', '2 SOUR @S2@', '2 SOUR @S3@', '3 _STROM_MAIN Y',
    '0 @I2@ INDI', '1 NAME Bohdana /Jestřábová/', '1 SEX F',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
    '1 SOUR @S1@', '2 _STROM_MAIN Y',
    '1 MARR', '2 DATE 1875', '2 SOUR @S2@', '2 SOUR @S3@',
    '1 DIV', '2 DATE 1890', '2 SOUR @S2@', '2 SOUR @S3@', '3 _STROM_MAIN Y',
    '1 RESI', '2 DATE 1880', '2 SOUR @S2@', '3 _STROM_MAIN Y', '2 SOUR @S3@',
    '0 @S1@ SOUR', '1 TITL Matrika Lomnička', '1 DATA', '2 EVEN BIRT, chr,BURI',
    '0 @S2@ SOUR', '1 TITL Soupis Hrádeček',
    '0 @S3@ SOUR', '1 TITL Kronika Ostrožná',
    '0 TRLR',
].join('\n') + '\n';

const importOf = (ged: string) => convertToStrom(parseGedcom(ged));
const load = (ged: string): StromData => migrateData(importOf(ged).data);

const byFirst = (d: StromData, first: string): Person => Object.values(d.persons).find(p => p.firstName === first)!;
const couple = (d: StromData) => Object.values(d.partnerships)[0];
const titleOf = (d: StromData, id: string | undefined): string | undefined => (id ? d.sources?.[id] : undefined)?.title;
const sourceTitled = (d: StromData, title: string, page?: string) =>
    Object.values(d.sources ?? {}).find(s => s.title === title && (page === undefined || (s.reference ?? '') === page))!;

/** The lines of the first `1 <tag>` block of the record whose NAME starts so (or the FAM record: name ''). */
function block(ged: string, name: string, tag: string): string[] {
    const lines = ged.split('\n');
    const start = name
        ? lines.findIndex((l, i) => l.startsWith('1 NAME ' + name) && lines[i - 1]?.endsWith(' INDI')) - 1
        : lines.findIndex(l => / FAM$/.test(l) && l.startsWith('0 '));
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l.startsWith('0 '));
    const rec = lines.slice(start, end);
    const at = rec.findIndex(l => l === `1 ${tag}` || l.startsWith(`1 ${tag} `));
    expect(at).toBeGreaterThan(0);
    const stop = rec.findIndex((l, i) => i > at && l.startsWith('1 '));
    return rec.slice(at, stop < 0 ? undefined : stop);
}

/** The titles of the source records, by xref. */
function recordTitles(ged: string): Map<string, string> {
    const out = new Map<string, string>();
    const lines = ged.split('\n');
    lines.forEach((l, i) => {
        const m = /^0 (@[^@]+@) SOUR$/.exec(l);
        if (m) out.set(m[1], lines.slice(i + 1).find(x => x.startsWith('1 TITL '))!.slice(7));
    });
    return out;
}

/** A block's citations at `level`: title (and ` *` when it carries `_STROM_MAIN Y`). */
function cites(ged: string, lines: string[], level = 2): string[] {
    const titles = recordTitles(ged);
    const out: string[] = [];
    for (const l of lines) {
        const m = new RegExp(`^${level} SOUR (@[^@]+@)$`).exec(l);
        if (m) out.push(titles.get(m[1]) ?? m[1]);
        else if (l === `${level + 1} _STROM_MAIN Y`) out[out.length - 1] += ' *';
    }
    return out;
}

describe('GEDCOM: reading a main citation (spec 095)', () => {
    it('`3 _STROM_MAIN Y` under a fact\'s `2 SOUR` is that fact\'s main citation, the first of two marks', () => {
        const d = load(MARKED);
        const k = byFirst(d, 'Kryštof');
        expect(titleOf(d, k.citationMain?.birthSourceIds)).toBe('Soupis Hrádeček');
        // The death's main citation is a page of the record (a source of its own for `fol. 99`).
        expect(d.sources?.[k.citationMain!.deathSourceIds!]?.reference).toBe('fol. 99');
        expect(k.deathSourceIds).toContain(k.citationMain!.deathSourceIds);
        const occu = k.events!.find(e => e.type === 'occupation')!;
        expect(titleOf(d, occu.citationMain?.sourceIds)).toBe('Kronika Ostrožná');
        const u = couple(d);
        expect(titleOf(d, u.citationMain?.divorceSourceIds)).toBe('Kronika Ostrožná');
        expect(titleOf(d, u.events?.find(e => e.type === 'residence')?.citationMain?.sourceIds)).toBe('Soupis Hrádeček');
    });

    it('a mark under a `1 SOUR` of a person or a family is no fact\'s: not read, not reported', () => {
        const r = importOf(MARKED);
        const d = migrateData(r.data);
        // The person's own citations have no main one; the family's `1 SOUR` shares the wedding's list, unmarked there.
        expect(byFirst(d, 'Kryštof').citationMain?.sourceIds).toBeUndefined();
        expect(couple(d).sourceIds?.length).toBe(3);
        expect(couple(d).citationMain?.sourceIds).toBeUndefined();
        expect(r.stats.droppedTagSummary ?? '').not.toContain('_STROM_MAIN');
    });

    it('`1 DATA / 2 EVEN` on a source record is the events it records (any case and spacing), not left out', () => {
        const r = importOf(MARKED);
        const d = migrateData(r.data);
        expect(sourceTitled(d, 'Matrika Lomnička', '').events).toEqual(['BIRT', 'CHR', 'BURI']);
        // A page's source of its own records the same events as its record.
        expect(sourceTitled(d, 'Matrika Lomnička', 'fol. 99').events).toEqual(['BIRT', 'CHR', 'BURI']);
        expect(sourceTitled(d, 'Soupis Hrádeček').events).toBeUndefined();
        expect(r.stats.droppedTagSummary ?? '').not.toContain('DATA');
    });

    it('a line under DATA with no field (`3 DATE` of an EVEN, `2 AGNC`) is reported once as DATA', () => {
        const r = importOf(HEAD + [
            '0 @I1@ INDI', '1 NAME Kryštof /Jestřáb/', '1 BIRT', '2 SOUR @S1@',
            '0 @S1@ SOUR', '1 TITL Matrika Lomnička', '1 DATA', '2 EVEN CHR', '3 DATE FROM 1840 TO 1880', '2 AGNC Fara Lomnička',
            '0 TRLR',
        ].join('\n'));
        expect(Object.values(r.data.sources!)[0].events).toEqual(['CHR']);
        expect(r.stats.droppedTagSummary).toContain('DATA ×1');
    });
});

describe('GEDCOM: writing a fact\'s citations (spec 095 K1.1, M11)', () => {
    it('the main citation first with `3 _STROM_MAIN Y`, the rest in the K1.1 order, at every kind of fact', () => {
        const d = load(MARKED);
        const ged = exportToGedcom(d).content;
        // Birth: the main one, then the primary record (a birth register, QUAY 3), then the rest.
        expect(cites(ged, block(ged, 'Kryštof', 'BIRT'))).toEqual(['Soupis Hrádeček *', 'Matrika Lomnička', 'Kronika Ostrožná']);
        expect(cites(ged, block(ged, 'Kryštof', 'DEAT'))).toEqual(['Matrika Lomnička *', 'Soupis Hrádeček']);
        expect(cites(ged, block(ged, 'Kryštof', 'OCCU'))).toEqual(['Kronika Ostrožná *', 'Soupis Hrádeček']);
        expect(cites(ged, block(ged, '', 'DIV'))).toEqual(['Kronika Ostrožná *', 'Soupis Hrádeček']);
        expect(cites(ged, block(ged, '', 'RESI'))).toEqual(['Soupis Hrádeček *', 'Kronika Ostrožná']);
        // The wedding has none: no mark; a person's own citations never carry one.
        expect(cites(ged, block(ged, '', 'MARR')).some(c => c.endsWith('*'))).toBe(false);
        expect(ged).not.toMatch(/^2 _STROM_MAIN/m);
    });

    it('a main citation at a fact of one citation is not marked', () => {
        const d = load(MARKED);
        const k = byFirst(d, 'Kryštof');
        const occu = k.events!.find(e => e.type === 'occupation')!;
        occu.sourceIds = [occu.citationMain!.sourceIds!];
        const ged = exportToGedcom(d).content;
        expect(cites(ged, block(ged, 'Kryštof', 'OCCU'))).toEqual(['Kronika Ostrožná']);
    });

    it('without a main citation the order is K1.1 alone and nothing is marked', () => {
        const d = load(MARKED);
        const k = byFirst(d, 'Kryštof');
        delete k.citationMain;
        // The stored list: Matrika (QUAY 3, a birth register), Soupis (QUAY 1), Kronika (none) → unchanged.
        k.birthSourceIds = [...k.birthSourceIds!].reverse();
        const ged = exportToGedcom(d).content;
        expect(cites(ged, block(ged, 'Kryštof', 'BIRT'))).toEqual(['Matrika Lomnička', 'Soupis Hrádeček', 'Kronika Ostrožná']);
        expect(cites(ged, block(ged, 'Kryštof', 'DEAT')).some(c => c.endsWith('*'))).toBe(false);
    });

    it('a research tree that orders its citations keeps the list\'s order, the main one first', () => {
        const d = load(MARKED);
        const k = byFirst(d, 'Kryštof');
        const [matrika, soupis, kronika] = k.birthSourceIds!;
        k.birthSourceIds = [kronika, matrika, soupis];
        k.citationMain = { birthSourceIds: soupis };
        const ged = exportToGedcom(d, 'T', { citationFileOrder: true }).content;
        expect(cites(ged, block(ged, 'Kryštof', 'BIRT'))).toEqual(['Soupis Hrádeček *', 'Kronika Ostrožná', 'Matrika Lomnička']);
    });

    it('no mark for a research without citations.main, nor for "Back to"; the main one still first', () => {
        const d = load(MARKED);
        const plain = researchGedcom(d, 'T', { id: 'r-095' }, 'tags');
        expect(plain).not.toContain('_STROM_MAIN');
        expect(cites(plain, block(plain, 'Kryštof', 'BIRT'))[0]).toBe('Soupis Hrádeček');
        const marked = researchGedcom(d, 'T', { id: 'r-095' }, 'tags', false, false, researchCitationsOut({ features: ['citations.main'] }));
        expect(cites(marked, block(marked, 'Kryštof', 'BIRT'))[0]).toBe('Soupis Hrádeček *');
        const off = exportToGedcom(d, 'T', { citationMain: false }).content;
        expect(off).not.toContain('_STROM_MAIN');
    });

    it('a shared event\'s copies each carry the common main citation', () => {
        const d = load(MARKED);
        const k = byFirst(d, 'Kryštof');
        const b = byFirst(d, 'Bohdana');
        const occu = k.events!.find(e => e.type === 'occupation')!;
        const census = (id: string): LifeEvent => ({
            id, type: 'census', date: '1890', sourceIds: [...occu.sourceIds!], citationMain: { sourceIds: occu.sourceIds![1] }, shareId: 'SH095AB',
        } as LifeEvent);
        k.events!.push(census('e_k'));
        (b.events ??= []).push(census('e_b'));
        const ged = exportToGedcom(d).content;
        for (const who of ['Kryštof', 'Bohdana']) {
            expect(cites(ged, block(ged, who, 'CENS'))).toEqual(['Kronika Ostrožná *', 'Soupis Hrádeček']);
        }
        const back = load(ged);
        for (const who of ['Kryštof', 'Bohdana']) {
            const ev = byFirst(back, who).events!.find(e => e.type === 'census')!;
            expect(titleOf(back, ev.citationMain?.sourceIds)).toBe('Kronika Ostrožná');
        }
    });

    it('`1 DATA / 2 EVEN` goes back on the source record, and the marks round-trip', () => {
        const d = load(MARKED);
        const ged = exportToGedcom(d).content;
        const lines = ged.split('\n');
        const at = lines.findIndex((l, i) => l === '1 TITL Matrika Lomnička' && lines[i - 1].endsWith(' SOUR'));
        const rec = lines.slice(at, lines.findIndex((l, i) => i > at && l.startsWith('0 ')));
        expect(rec).toContain('1 DATA');
        expect(rec[rec.indexOf('1 DATA') + 1]).toBe('2 EVEN BIRT, CHR, BURI');
        expect(ged.match(/^1 DATA$/gm)?.length).toBe(2); // the record and its page's source
        const again = importOf(ged);
        expect(again.stats.droppedTagSummary ?? '').not.toContain('DATA');
        const d2 = migrateData(again.data);
        const k1 = byFirst(d, 'Kryštof');
        const k2 = byFirst(d2, 'Kryštof');
        const mains = (dd: StromData, p: Person) => ({
            birth: titleOf(dd, p.citationMain?.birthSourceIds),
            death: dd.sources?.[p.citationMain?.deathSourceIds ?? '']?.reference,
            occu: titleOf(dd, p.events?.find(e => e.type === 'occupation')?.citationMain?.sourceIds),
        });
        expect(mains(d2, k2)).toEqual(mains(d, k1));
        expect(titleOf(d2, couple(d2).citationMain?.divorceSourceIds)).toBe('Kronika Ostrožná');
        expect(sourceTitled(d2, 'Matrika Lomnička', '').events).toEqual(['BIRT', 'CHR', 'BURI']);
    });

    it('JSON keeps the main citations and the events (data v21)', () => {
        const d = load(MARKED);
        const back = migrateData(JSON.parse(JSON.stringify(d)));
        expect(byFirst(back, 'Kryštof').citationMain).toEqual(byFirst(d, 'Kryštof').citationMain);
        expect(couple(back).citationMain).toEqual(couple(d).citationMain);
        expect(sourceTitled(back, 'Matrika Lomnička', '').events).toEqual(['BIRT', 'CHR', 'BURI']);
    });
});

/** The research's file: one record cited at two places of it (a citation's PAGE that is not the record's). */
const RESEARCH = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.30.0', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Kryštof /Jestřáb/', '1 SEX M', '1 REFN P0001',
    '1 BIRT', '2 DATE 1851', '2 SOUR @S12@', '3 PAGE fol. 7', '3 QUAY 3',
    '1 DEAT', '2 DATE 1910', '2 SOUR @S12@', '3 PAGE fol. 99', '3 QUAY 2', '3 DATA', '4 DATE 1910', '2 SOUR @S13@',
    '0 @S12@ SOUR', '1 DATA', '2 EVEN CHR, BURI', '1 TITL Matrika Lomnička', '1 PAGE fol. 7', '1 REFN S0012',
    '0 @S13@ SOUR', '1 TITL Soupis Hrádeček', '1 REFN S0013',
    '0 TRLR',
].join('\n') + '\n';

describe('GEDCOM: a page of a research\'s record goes back as a citation of that record (spec 095, V8)', () => {
    it('both citations name the one record with its REFN, each with its own PAGE; no record made for the page', () => {
        const d = load(RESEARCH);
        // In the app the other page is a source of its own (as before).
        expect(Object.values(d.sources!).filter(s => s.title === 'Matrika Lomnička').map(s => s.reference).sort()).toEqual(['fol. 7', 'fol. 99']);
        const { content: ged, xrefs } = researchGedcomExport(d, 'T', { id: 'r-095' }, 'tags');
        const records = ged.split('\n').filter(l => /^0 @[^@]+@ SOUR$/.test(l));
        expect(records).toHaveLength(2);
        expect(ged.match(/^1 REFN S0012$/gm)).toHaveLength(1);
        const birth = block(ged, 'Kryštof', 'BIRT');
        const death = block(ged, 'Kryštof', 'DEAT');
        const ref = (b: string[]) => b.find(l => l.startsWith('2 SOUR '))!.slice(7);
        expect(ref(birth)).toBe(ref(death));
        expect(birth).toContain('3 PAGE fol. 7');
        expect(death).toContain('3 PAGE fol. 99');
        expect(death).toContain('3 QUAY 2');
        expect(death).toContain('4 DATE 1910');
        // The research answers by the record: the page is not named apart.
        const page = Object.values(d.sources!).find(s => s.reference === 'fol. 99')!;
        expect(xrefs.sources.has(page.id)).toBe(false);
        // Read back, it is the same tree: the record and its other page.
        const again = load(ged.replace('1 SOUR STROM\n', '1 SOUR STROM_RESEARCH\n'));
        expect(Object.values(again.sources!).filter(s => s.title === 'Matrika Lomnička').map(s => s.reference).sort()).toEqual(['fol. 7', 'fol. 99']);
        expect(Object.values(again.sources!).find(s => s.reference === 'fol. 99')!.events).toEqual(['CHR', 'BURI']);
    });

    it('another file keeps a record per source; an edited page is an entry of its own to the research too', () => {
        const d = load(RESEARCH);
        const own = exportToGedcom(d).content;
        expect(own.split('\n').filter(l => /^0 @[^@]+@ SOUR$/.test(l))).toHaveLength(3);
        const page = Object.values(d.sources!).find(s => s.reference === 'fol. 99')!;
        page.transcript = 'Zemřel Kryštof Jestřáb, mlynář.';
        const ged = researchGedcom(d, 'T', { id: 'r-095' }, 'tags');
        expect(ged.split('\n').filter(l => /^0 @[^@]+@ SOUR$/.test(l))).toHaveLength(3);
    });
});
