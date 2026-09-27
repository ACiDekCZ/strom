/**
 * What Strom Research knows about a person beyond the facts — conflicting
 * sources, hypotheses, what was searched — arrives in the person's `research`
 * from the research's own files only, and never goes back out in a GEDCOM
 * (the research is its source of truth). Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { Person } from '../types.js';

const head = (research: boolean): string => `0 HEAD
1 CHAR UTF-8
${research ? '1 SOUR STROM_RESEARCH\n1 _STROM_TREE 0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10\n1 _STROM_ASOF 2026-09-20\n' : ''}`;

const BODY = `0 @S12@ SOUR
1 TITL Křestní matrika Chlumy 1871
0 @S31@ SOUR
1 TITL Sčítání lidu 1880
0 @I1@ INDI
1 NAME Anna /Víšková/
1 SEX F
1 REFN P0012
1 BIRT
2 DATE 1872
1 _STROM_CONFLICT X0007
2 TYPE BIRT
2 STAT open
2 VAL 3 FEB 1871
3 SOUR @S12@
2 VAL 1872
3 SOUR @S31@
1 _STROM_CONFLICT X0008
2 TYPE deat
2 STAT decided
2 VAL 1944
2 VAL 1945
3 SOUR @S31@
2 DECI 1945 (S0031)
1 _STROM_CONFLICT X0009
2 TYPE EVEN
2 TITL Rok narození An
3 CONC ny
2 STAT open
2 VAL 70 let při úmrtí 1937
2 VAL 12 MAR 1865, Týnec
1 _STROM_CONFLICT C0010
2 TYPE BIRT
2 VAL 1870
1 _STROM_HYPO
2 TITL Otec: Václav, nebo Jan Víšek?
2 NOTE Oba žili v Chlumech.
3 CONT Rozhodne oddací zápis.
1 _STROM_SEARCHED
2 TITL Oddací matrika Chlumy
2 DATE FROM 1890 TO 1900
2 RESN none
2 _AT 2026-09-18
1 _STROM_SEARCHED
2 TITL Křestní matrika Chlumy
2 DATE 1871
2 RESN found
0 TRLR
`;

function anna(research: boolean): { person: Person; asOf?: string; sources: Record<string, { title: string }> } {
    const data = convertToStrom(parseGedcom(head(research) + BODY)).data;
    const person = Object.values(data.persons).find(p => p.refn === 'P0012')!;
    return { person, asOf: data.researchAsOf, sources: data.sources ?? {} };
}

describe('Strom Research knowledge in GEDCOM', () => {
    it('reads conflicts, hypotheses and searches from a research file', () => {
        const { person, asOf, sources } = anna(true);
        expect(asOf).toBe('2026-09-20');
        const r = person.research!;
        // X1 (no TYPE, no VAL) and C0010 (not a research id) are dropped.
        expect(r.conflicts).toHaveLength(3);
        const [open, decided, general] = r.conflicts!;
        expect(general).toMatchObject({ id: 'X0009', fact: 'EVEN', title: 'Rok narození Anny', status: 'open' });
        expect(general.values.map(v => v.value)).toEqual(['70 let při úmrtí 1937', '12 MAR 1865, Týnec']);
        expect(open).toMatchObject({ id: 'X0007', fact: 'BIRT', status: 'open' });
        expect(open.values.map(v => v.value)).toEqual(['3 FEB 1871', '1872']);
        expect(sources[open.values[0].sourceIds![0]].title).toBe('Křestní matrika Chlumy 1871');
        expect(sources[open.values[1].sourceIds![0]].title).toBe('Sčítání lidu 1880');
        expect(decided).toMatchObject({ id: 'X0008', fact: 'DEAT', status: 'decided' });
        expect(decided.decision?.value).toBe('1945 (S0031)');
        expect(decided.decision?.sourceIds).toBeUndefined();
        expect(decided.values[0].sourceIds).toBeUndefined();
        expect(r.hypotheses).toEqual([{ title: 'Otec: Václav, nebo Jan Víšek?', note: 'Oba žili v Chlumech.\nRozhodne oddací zápis.' }]);
        expect(r.searched).toEqual([
            { title: 'Oddací matrika Chlumy', from: 1890, to: 1900, result: 'none', at: '2026-09-18' },
            { title: 'Křestní matrika Chlumy', from: 1871, to: 1871, result: 'found' },
        ]);
    });

    it('ignores the tags in any other GEDCOM', () => {
        const { person, asOf } = anna(false);
        expect(person.research).toBeUndefined();
        expect(asOf).toBeUndefined();
    });

    it('never writes them back into a GEDCOM', () => {
        const data = convertToStrom(parseGedcom(head(true) + BODY)).data;
        const ged = exportToGedcom(data, 'Test', { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } }).content;
        expect(ged).not.toMatch(/_STROM_CONFLICT|_STROM_HYPO|_STROM_SEARCHED|_STROM_ASOF/);
    });

    it('a new version replaces them whole', () => {
        const first = convertToStrom(parseGedcom(head(true) + BODY)).data;
        const next = convertToStrom(parseGedcom(head(true) + BODY.replace(/1 _STROM_CONFLICT X0007[\s\S]*?(?=1 _STROM_CONFLICT X0008)/, ''))).data;
        const before = Object.values(first.persons).find(p => p.refn === 'P0012')!;
        const after = Object.values(next.persons).find(p => p.refn === 'P0012')!;
        expect(before.research?.conflicts?.map(c => c.id)).toEqual(['X0007', 'X0008', 'X0009']);
        expect(after.research?.conflicts?.map(c => c.id)).toEqual(['X0008', 'X0009']);
    });
});
