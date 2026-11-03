/**
 * A GEDCOM 7 file from another program: its bookkeeping (UID, CREA, EXID) is
 * no data of the family and must not swell the "Unsupported" count, and a
 * `_RELATIONSHIP_STATUS` line reads as the couple's status the way `_STAT`
 * does, so partners or a separated couple do not arrive married.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import type { Partnership, StromData } from '../types.js';

const GED7 = `0 HEAD
1 GEDC
2 VERS 7.0
1 SOUR SomeProgram
0 @I1@ INDI
1 UID 0b5c6f5e-8a52-4f8e-9d1c-6a0f9c1e2b3a
1 EXID KWZX-123
2 TYPE https://www.familysearch.org/tree/person/
1 NAME Tomasz /Wierzbowski/
1 SEX M
1 BIRT
2 DATE 4 MAR 1901
2 PLAC Lisówek
1 CREA
2 DATE 27 MAR 2022
3 TIME 15:47:00
1 FAMS @F1@
1 FAMS @F2@
1 FAMS @F3@
0 @I2@ INDI
1 UID 9a3d1b77-0c11-4c55-8a3e-3f2b6c1d4e5f
1 NAME Halina /Kłosek/
1 SEX F
1 CREA
2 DATE 1 APR 2022
1 FAMS @F1@
0 @I3@ INDI
1 NAME Zofia /Grabczyk/
1 SEX F
1 FAMS @F2@
0 @I4@ INDI
1 NAME Irena /Modrzew/
1 SEX F
1 FAMS @F3@
0 @F1@ FAM
1 UID 7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1925
1 _RELATIONSHIP_STATUS Separated
1 CREA
2 DATE 27 MAR 2022
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 _RELATIONSHIP_STATUS Partners
1 EXID 55
0 @F3@ FAM
1 HUSB @I1@
1 WIFE @I4@
1 MARR
1 _RELATIONSHIP_STATUS Engaged
0 @S1@ SOUR
1 TITL Księga urodzeń
1 UID 1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b
1 CREA
2 DATE 2 MAY 2022
0 TRLR
`;

function convert(ged: string): { data: StromData; stats: ReturnType<typeof convertToStrom>['stats'] } {
    const r = convertToStrom(parseGedcom(ged));
    return { data: r.data, stats: r.stats };
}

function unionOf(data: StromData, wifeFirst: string): Partnership {
    const wife = Object.values(data.persons).find(p => p.firstName === wifeFirst)!;
    return Object.values(data.partnerships).find(u => u.person1Id === wife.id || u.person2Id === wife.id)!;
}

describe('GEDCOM 7 bookkeeping (UID, CREA, EXID)', () => {
    it('is not counted as unsupported', () => {
        const { stats } = convert(GED7);
        expect(stats.droppedTagSummary).not.toMatch(/\b(UID|CREA|EXID)\b/);
    });

    it('a CREA date never lands on the birth or the wedding', () => {
        const { data } = convert(GED7);
        const tomasz = Object.values(data.persons).find(p => p.firstName === 'Tomasz')!;
        expect(tomasz.birthDate).toBe('1901-03-04');
        expect(JSON.stringify(data)).not.toContain('2022');
        expect(unionOf(data, 'Halina').startDate).toBe('1925');
    });
});

describe('_RELATIONSHIP_STATUS', () => {
    it('reads as the status of the couple, like _STAT', () => {
        const { data } = convert(GED7);
        // A wedding date rides on MARR, the status still says separated.
        expect(unionOf(data, 'Halina').status).toBe('separated');
        expect(unionOf(data, 'Zofia').status).toBe('partners');
    });

    it('a value it does not know leaves the status to MARR/DIV and is counted as unsupported', () => {
        const { data, stats } = convert(GED7);
        expect(unionOf(data, 'Irena').status).toBe('married');
        expect(stats.droppedTagSummary).toBe('_RELATIONSHIP_STATUS ×1');
        expect(stats.unsupportedTags).toBe(1);
    });

    it.each([
        ['married', 'married'], ['Divorced', 'divorced'], ['separated', 'separated'], ['Partners', 'partners'],
        ['Unmarried couple', 'partners'], ['Common law', 'partners'], ['Civil union', 'partners'],
        // pl
        ['Małżeństwo', 'married'], ['Związek nieformalny', 'partners'], ['Konkubinat', 'partners'],
        ['W separacji', 'separated'], ['Rozwiedzeni', 'divorced'],
        // de
        ['Verheiratet', 'married'], ['Lebensgemeinschaft', 'partners'], ['Getrennt', 'separated'], ['Geschieden', 'divorced'],
        // cs
        ['Manželé', 'married'], ['Partneři', 'partners'], ['Druh a družka', 'partners'], ['Odloučeni', 'separated'], ['Rozvedeni', 'divorced'],
    ] as const)('%s → %s (both _RELATIONSHIP_STATUS and _STAT)', (value, status) => {
        for (const tag of ['_RELATIONSHIP_STATUS', '_STAT']) {
            const ged = `0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME Jan /Olcha/\n1 SEX M\n1 FAMS @F1@\n`
                + `0 @I2@ INDI\n1 NAME Ewa /Topolan/\n1 SEX F\n1 FAMS @F1@\n`
                + `0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR\n1 ${tag} ${value}\n0 TRLR\n`;
            const { data, stats } = convert(ged);
            expect(Object.values(data.partnerships)[0].status, tag).toBe(status);
            expect(stats.unsupportedTags, tag).toBe(0);
        }
    });

    it('_STAT wins over _RELATIONSHIP_STATUS when a family carries both', () => {
        const ged = `0 HEAD\n0 @I1@ INDI\n1 NAME Jan /Olcha/\n1 SEX M\n1 FAMS @F1@\n`
            + `0 @I2@ INDI\n1 NAME Ewa /Topolan/\n1 SEX F\n1 FAMS @F1@\n`
            + `0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 _RELATIONSHIP_STATUS Married\n1 _STAT Partners\n0 TRLR\n`;
        expect(Object.values(convert(ged).data.partnerships)[0].status).toBe('partners');
    });
});
