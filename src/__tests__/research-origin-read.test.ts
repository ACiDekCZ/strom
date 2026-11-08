/**
 * The research's origin of facts (spec 066): read from Strom's own files
 * only — the research's tree and the app's own export coming back — never
 * from another program's file; written back by a file export and read again
 * unchanged; the app's import records kept over a research version.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { keepImports } from '../import-origin.js';
import { resolveContentOptions } from '../privacy.js';
import { Person, StromData } from '../types.js';

const SHA = 'cd'.repeat(32);

const HEAD_RESEARCH = `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.30.0
1 _STROM_TREE 11111111-2222-3333-4444-555555555555
1 _STROM_IMPORT R1
2 SOUR Rodokmenar
2 VERS 5.2
2 DATE 12 MAR 2024
2 _AT 2026-11-01
2 FILE stary.ged
2 _SHA ${SHA}
1 CHAR UTF-8`;

const BODY = `0 @I1@ INDI
1 REFN P0001
1 NAME Hostivít /Šmudlák/
2 GIVN Hostivít
2 SURN Šmudlák
2 _STROM_ORIGIN import I1 SURN
2 _STROM_WAS Hostivit
3 _STROM_IMPORT I1
3 _PART GIVN
3 _REF N:P0001:1
1 SEX M
1 _STROM_SEX_ORIGIN user
1 BIRT
2 DATE 2 FEB 1851
2 PLAC Hrachovec Dolní
2 SOUR @S1@
2 _STROM_STATUS proven
2 _STROM_ORIGIN research
2 _STROM_WAS 1 FEB 1850
3 _STROM_IMPORT I1
3 _PART DATE
3 _REF E0001
2 _STROM_WAS Bramborov, okres Lupínek
3 _STROM_IMPORT I1
3 _PART PLAC
3 _REF E0001
1 OCCU mlynář
2 _STROM_ORIGIN import R1
1 DEAT
2 DATE 1910
2 _STROM_ORIGIN user
2 _STROM_WAS 1909
3 _STROM_IMPORT I1
3 _REF E0002
1 FAMS @F1@
1 _STROM_CONFLICT X0001
2 TYPE BIRT
2 _STROM_TAKE Y
2 _STROM_KIND import
2 VAL 1 FEB 1850
3 _STROM_SIDE user
2 VAL 2 FEB 1851
3 SOUR @S1@
3 _STROM_SIDE research
0 @I2@ INDI
1 REFN P0002
1 NAME Radmila /Pupínková/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1875
2 _STROM_ORIGIN import I1 DATE
0 @S1@ SOUR
1 TITL Matrika Bramborov
0 TRLR`;

const RESEARCH_GED = `${HEAD_RESEARCH}\n${BODY}`;
const FOREIGN_GED = `0 HEAD
1 SOUR RODOKMENAR
2 VERS 5.2
1 _STROM_IMPORT R1
2 SOUR Rodokmenar
2 _AT 2026-11-01
1 CHAR UTF-8
${BODY}`;

const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;

const ORIGIN = { at: '2026-11-08', file: 'x.ged', encoding: 'utf-8', sha: SHA };

describe('research origin from the research tree', () => {
    const data = convertToStrom(parseGedcom(RESEARCH_GED)).data;
    const p = byName(data, 'Hostivít');
    const s1 = Object.keys(data.sources ?? {})[0];

    it('reads the origin of the name with the parts from the import and the earlier given name', () => {
        expect(p.researchOrigins?.name).toEqual({
            kind: 'import', importId: 'I1', parts: ['SURN'],
            was: { value: 'Hostivit', importId: 'I1', parts: ['GIVN'], ref: 'N:P0001:1' },
        });
        expect(p.firstName).toBe('Hostivít');
        expect(p.lastName).toBe('Šmudlák');
    });

    it('reads the origin of the sex from 1 _STROM_SEX_ORIGIN', () => {
        expect(p.researchOrigins?.sex).toEqual({ kind: 'user' });
        expect(p.gender).toBe('male');
    });

    it('keeps each changed part with its own value, the ref and the cited record', () => {
        expect(p.researchOrigins?.birth).toEqual({
            kind: 'research',
            was: {
                value: '1 FEB 1850', importId: 'I1', parts: ['DATE', 'PLAC'], ref: 'E0001',
                partValues: { DATE: '1 FEB 1850', PLAC: 'Bramborov, okres Lupínek' },
            },
            sourceIds: [s1],
        });
        // The fact's own reading is untouched: its value, status and citation.
        expect(p.birthDate).toBeTruthy();
        expect(p.birthPlace).toBe('Hrachovec Dolní');
        expect(p.birthStatus).toBe('proven');
        expect(p.birthSourceIds).toEqual([s1]);
        expect(p.notes ?? '').not.toMatch(/STROM|Bramborov|E0001/);
    });

    it('reads a whole-fact earlier value without parts, and an event origin from the research import', () => {
        expect(p.researchOrigins?.death).toEqual({ kind: 'user', was: { value: '1909', importId: 'I1', ref: 'E0002' } });
        const occu = p.events?.find(e => e.type === 'occupation');
        expect(occu).toBeTruthy();
        expect(p.researchOrigins?.[`event:${occu!.id}`]).toEqual({ kind: 'import', importId: 'R1' });
    });

    it('reads the origin of the wedding', () => {
        const ps = Object.values(data.partnerships)[0];
        expect(ps.researchOrigins?.marriage).toEqual({ kind: 'import', importId: 'I1', parts: ['DATE'] });
    });

    it('reads the kind of a conflict', () => {
        expect(p.research?.conflicts?.[0]).toMatchObject({ id: 'X0001', fact: 'BIRT', take: true, kind: 'import' });
    });

    it('takes the research import records of its header', () => {
        expect(data.imports).toEqual([{
            id: 'R1', program: 'Rodokmenar', version: '5.2', fileDate: '12 MAR 2024', at: '2026-11-01', file: 'stary.ged', sha: SHA,
        }]);
        // Nothing is marked as from the file on the app's side.
        expect(p.importedValues).toBeUndefined();
    });

    it('keeps it all through the data migration', () => {
        const again = migrateData(structuredClone(data));
        expect(byName(again, 'Hostivít').researchOrigins).toEqual(p.researchOrigins);
        expect(again.imports).toEqual(data.imports);
    });

    it('ignores an unknown origin word and a conflict kind it does not know', () => {
        const odd = RESEARCH_GED.replace('2 _STROM_ORIGIN user\n2 _STROM_WAS 1909', '2 _STROM_ORIGIN somebody')
            .replace('2 _STROM_KIND import', '2 _STROM_KIND agent');
        const d = convertToStrom(parseGedcom(odd)).data;
        const q = byName(d, 'Hostivít');
        expect(q.researchOrigins?.death).toBeUndefined();
        expect(q.research?.conflicts?.[0].kind).toBeUndefined();
    });

    it('adds nothing for a research that writes no origin', () => {
        const plain = RESEARCH_GED.split('\n')
            .filter(l => !/_STROM_(ORIGIN|WAS|SEX_ORIGIN|IMPORT)|_PART|_REF|^2 (SOUR|VERS|DATE|_AT|FILE|_SHA) /.test(l) || /^0|^1 SOUR/.test(l))
            .join('\n');
        const d = convertToStrom(parseGedcom(plain)).data;
        expect(byName(d, 'Hostivít').researchOrigins).toBeUndefined();
        expect(d.imports).toBeUndefined();
    });
});

describe('another program\'s file never gives a research origin', () => {
    for (const [label, opts] of [['opened', {}], ['imported', { importOrigin: ORIGIN }]] as const) {
        it(`${label}: no origin, no earlier value, no research import record, no conflict kind`, () => {
            const d = convertToStrom(parseGedcom(FOREIGN_GED), opts).data;
            const q = byName(d, 'Hostivít');
            expect(q.researchOrigins).toBeUndefined();
            for (const ps of Object.values(d.partnerships)) expect(ps.researchOrigins).toBeUndefined();
            expect((d.imports ?? []).some(r => r.id === 'R1')).toBe(false);
            expect(q.research).toBeUndefined();
            expect(JSON.stringify(d)).not.toContain('E0001');
        });
    }
});

describe('a file export of Strom read back', () => {
    // A tree as the app holds it: the research's origins, the app's import record.
    const research = convertToStrom(parseGedcom(RESEARCH_GED)).data;
    const tree: StromData = migrateData(structuredClone({
        ...research,
        imports: [...(research.imports ?? []), { id: 'I1', program: 'Rodokmenar', at: '2026-10-01', sha: SHA }],
    }));
    const ged = exportToGedcom(tree, 'Šmudlákovi', { origins: true }).content;

    it('writes the origin and the earlier values under each fact', () => {
        expect(ged).toContain('2 _STROM_ORIGIN import I1 SURN');
        expect(ged).toContain('1 _STROM_SEX_ORIGIN user');
        expect(ged).toContain('2 _STROM_ORIGIN research');
        expect(ged).toMatch(/2 _STROM_WAS 1 FEB 1850\n3 _STROM_IMPORT I1\n3 _PART DATE\n3 _REF E0001\n2 _STROM_WAS Bramborov, okres Lupínek\n3 _STROM_IMPORT I1\n3 _PART PLAC\n3 _REF E0001/);
        expect(ged).toContain('2 _STROM_ORIGIN import I1 DATE');
    });

    it('writes none of it to the research, nor without the option', () => {
        const sent = exportToGedcom(tree, 'Šmudlákovi', { research: { id: '11111111-2222-3333-4444-555555555555' } }).content;
        expect(sent).not.toMatch(/_STROM_ORIGIN|_STROM_WAS|_STROM_SEX_ORIGIN/);
    });

    it('imported again: the same origins and records, no new import record, no new "from family tree" mark', () => {
        const back = convertToStrom(parseGedcom(ged), { importOrigin: ORIGIN }).data;
        expect(back.imports?.map(r => r.id).sort()).toEqual(['I1', 'R1']);
        const q = byName(back, 'Hostivít');
        const p = byName(tree, 'Hostivít');
        const strip = (o: Person['researchOrigins']): unknown => JSON.parse(JSON.stringify(o ?? {}, (k, v) => (k === 'sourceIds' ? undefined : v)));
        // Event ids are new on import: compare by fact name, events by type.
        const named = (person: Person): Record<string, unknown> => {
            const out: Record<string, unknown> = {};
            for (const [fact, o] of Object.entries(person.researchOrigins ?? {})) {
                const key = fact.startsWith('event:') ? `event:${person.events?.find(e => `event:${e.id}` === fact)?.type}` : fact;
                out[key] = strip({ x: o } as never);
            }
            return out;
        };
        expect(named(q)).toEqual(named(p));
        expect(q.importedValues).toBeUndefined();
        expect(Object.values(back.persons).every(x => !x.importedValues)).toBe(true);
        expect(q.researchOrigins?.birth?.sourceIds?.length).toBe(1);
        const ps = Object.values(back.partnerships)[0];
        expect(ps.researchOrigins?.marriage).toEqual({ kind: 'import', importId: 'I1', parts: ['DATE'] });
    });

    it('as the app\'s own file opened without an import, too', () => {
        const back = convertToStrom(parseGedcom(ged)).data;
        expect(byName(back, 'Hostivít').researchOrigins?.sex).toEqual({ kind: 'user' });
    });
});

describe('a research version over the tree keeps the app\'s import records', () => {
    it('adds the app\'s records beside the research\'s and keeps the origins it brings', () => {
        const next = convertToStrom(parseGedcom(RESEARCH_GED)).data;
        const previous: StromData = structuredClone(next);
        previous.imports = [{ id: 'I1', program: 'Rodokmenar', at: '2026-10-01', file: 'rodokmen.ged' }];
        const kept = keepImports(next, previous);
        expect(kept.imports?.map(r => r.id).sort()).toEqual(['I1', 'R1']);
        expect(byName(kept, 'Hostivít').researchOrigins).toEqual(byName(next, 'Hostivít').researchOrigins);
        expect(next.imports?.map(r => r.id)).toEqual(['R1']);
    });
});

/**
 * The research's file through the app and back out (066 N-B): every fact the
 * app keeps keeps its origin, also one without a date or a place — a known
 * death (`DEAT Y`), a wedding said only by its status, an event with only a
 * remark, an address or a label.
 */
const BARE_FACTS_GED = `${HEAD_RESEARCH}
0 @I1@ INDI
1 NAME Bořivoj /Kmínek/
2 _STROM_ORIGIN import R1
1 SEX M
1 _STROM_SEX_ORIGIN import R1
1 BIRT
2 DATE 1840
2 _STROM_ORIGIN import R1
1 EDUC
2 _STROM_ORIGIN import R1
2 NOTE obecná škola
1 RESI
2 ADDR čp. 12
2 _STROM_ORIGIN import R1
1 DEAT Y
2 SOUR @S1@
3 PAGE fol. 7
3 QUAY 1
2 _STROM_STATUS lead
2 _STROM_ORIGIN import R1
1 FAMS @F1@
0 @I2@ INDI
1 NAME Ludmila /Kmínková/
2 _STROM_ORIGIN import R1
1 SEX F
1 _STROM_SEX_ORIGIN import R1
1 DEAT Y
2 _STROM_STATUS proven
2 _STROM_ORIGIN research
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR Y
2 _STROM_STATUS lead
2 _STROM_ORIGIN import R1
1 EVEN
2 TYPE Zasnoubení
2 _STROM_STATUS lead
2 _STROM_ORIGIN import R1
0 @S1@ SOUR
1 TITL Matrika Kmínkov
0 TRLR`;

describe('a fact without a date or a place keeps its origin through the app (066 N-B)', () => {
    const count = (text: string, re: RegExp): number => text.split(/\r?\n/).filter(l => re.test(l)).length;
    const data = convertToStrom(parseGedcom(BARE_FACTS_GED)).data;

    for (const [label, content] of [['the file export (every content)', resolveContentOptions(true)], ['no content choice', undefined]] as const) {
        it(`${label}: as many _STROM_ORIGIN lines go out as came in`, () => {
            const out = exportToGedcom(structuredClone(data), 'Kmínkovi', { origins: true, ...(content ? { content } : {}) }).content;
            expect(count(out, /^2 _STROM_ORIGIN /)).toBe(count(BARE_FACTS_GED, /^2 _STROM_ORIGIN /));
            expect(count(out, /^1 _STROM_SEX_ORIGIN /)).toBe(2);
            // The known death with its citation says where it came from.
            expect(out).toMatch(/1 DEAT Y\n2 _STROM_STATUS lead\n2 SOUR @S\d+@\n3 PAGE fol\. 7\n3 QUAY 1\n2 _STROM_ORIGIN import R1/);
        });
    }

    it('a fact the content choice leaves out takes its origin with it', () => {
        // Leaving the notes out keeps every fact: the birth keeps its origin.
        const out = exportToGedcom(structuredClone(data), 'Kmínkovi', { origins: true, content: { ...resolveContentOptions(true), notes: false } }).content;
        expect(out).toMatch(/1 BIRT\n2 DATE 1840\n2 _STROM_ORIGIN import R1/);
    });
});
