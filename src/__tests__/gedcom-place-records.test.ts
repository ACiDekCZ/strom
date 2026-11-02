/**
 * Strom Research's place records in its GEDCOM (spec 034): `0 @L…@ _STROM_PLACE`
 * and `3 _STROM_PLACE @L…@` under a PLAC. Read as they come, invalid values
 * dropped, never counted as unsupported, never written back by the exporter.
 * Fictional places only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { placeKey } from '../places.js';

const HEAD = ['0 HEAD', '1 SOUR STROM_RESEARCH', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];

function ged(...body: string[]): string {
    return [...HEAD, ...body, '0 TRLR'].join('\n');
}

const PERSON = [
    '0 @I1@ INDI',
    '1 NAME Jan /Lhoták/',
    '1 SEX M',
    '1 BIRT',
    '2 DATE 1 JAN 1850',
    '2 PLAC Horní Lhota',
    '3 MAP',
    '4 LATI N49.61',
    '4 LONG E15.23',
    '3 _STROM_PLACE @L0012@',
    '1 DEAT',
    '2 PLAC H. Lhota',
    '3 _STROM_PLACE @L0012@',
];

const RECORD = [
    '0 @L0012@ _STROM_PLACE',
    '1 NAME Horní Lhota',
    '1 NAME Ober Lhota',
    '2 LANG de',
    '2 DATE TO 1945',
    '1 NAME Hořejší Lhota',
    '2 DATE FROM 1700 TO 1850',
    '1 MAP',
    '2 LATI N49.61',
    '2 LONG E15.23',
    '1 _STROM_JUR parish Lhotov',
    '2 DATE FROM 1784',
    '1 _STROM_JUR district Jinov',
    '1 _STROM_IN @L0003@',
    '1 _STROM_BY research',
    '1 _STROM_AT 2026-11-03',
    '1 _STROM_WHY Baptisms of the family are in the parish of Lhotov,',
    '2 CONC  which covers Horní Lhota.',
    '2 CONT Second line.',
    '1 _STROM_SRC Register of Lhotov 1784–1850',
    '2 WWW https://example.org/lhotov',
    '1 _STROM_VERIFIED 2026-11-04',
    '0 @L0003@ _STROM_PLACE',
    '1 NAME Lhotov',
    '1 _STROM_BY person',
];

describe('GEDCOM _STROM_PLACE records', () => {
    it('reads a record with names, coordinates, jurisdictions, why and source', () => {
        const parsed = parseGedcom(ged(...PERSON, ...RECORD));
        const rec = parsed.placeRecords?.get('L0012');
        expect(rec).toEqual({
            id: 'L0012',
            names: [
                { name: 'Horní Lhota' },
                { name: 'Ober Lhota', lang: 'de', to: 1945 },
                { name: 'Hořejší Lhota', from: 1700, to: 1850 },
            ],
            coords: { lat: 49.61, lon: 15.23 },
            jurisdictions: [{ kind: 'parish', name: 'Lhotov', from: 1784 }, { kind: 'district', name: 'Jinov' }],
            parent: 'L0003',
            by: 'research',
            at: '2026-11-03',
            why: 'Baptisms of the family are in the parish of Lhotov, which covers Horní Lhota.\nSecond line.',
            source: { title: 'Register of Lhotov 1784–1850', url: 'https://example.org/lhotov' },
            verified: '2026-11-04',
        });
        expect(parsed.placeRecords?.get('L0003')).toEqual({ id: 'L0003', names: [{ name: 'Lhotov' }], by: 'person' });
    });

    it('reads the refs under PLAC, keyed by placeKey', () => {
        const parsed = parseGedcom(ged(...PERSON, ...RECORD));
        expect(Object.fromEntries(parsed.placeRefs ?? [])).toEqual({
            [placeKey('Horní Lhota')]: 'L0012',
            [placeKey('H. Lhota')]: 'L0012',
        });
        // The MAP under the same PLAC still reads.
        expect(parsed.places.get(placeKey('Horní Lhota'))).toMatchObject({ lat: 49.61, lon: 15.23 });
    });

    it('never counts the records or the refs as unsupported', () => {
        const result = convertToStrom(parseGedcom(ged(...PERSON, ...RECORD)));
        expect(result.stats.unsupportedTags).toBe(0);
        expect(result.data.placeRecords?.['L0012']?.names[0].name).toBe('Horní Lhota');
        expect(result.data.placeRefs?.[placeKey('H. Lhota')]).toBe('L0012');
    });

    it('reads an unlocated place with and without its reason', () => {
        const parsed = parseGedcom(ged(
            '0 @L0020@ _STROM_PLACE', '1 NAME Lhotínek', '1 _STROM_UNLOCATED No such village in the gazetteers',
            '2 _STROM_NEEDS The parish of the baptism',
            '0 @L0021@ _STROM_PLACE', '1 NAME Łotów', '1 _STROM_UNLOCATED',
        ));
        expect(parsed.placeRecords?.get('L0020')).toMatchObject({
            unlocated: 'No such village in the gazetteers', needs: 'The parish of the baptism',
        });
        expect(parsed.placeRecords?.get('L0021')?.unlocated).toBe('');
    });

    it('drops invalid values and records', () => {
        const parsed = parseGedcom(ged(
            '0 @L0030@ _STROM_PLACE',
            '1 NAME Jinov',
            '2 LANG not a language',
            '1 MAP', '2 LATI N149.5', '2 LONG E15.2',
            '1 _STROM_JUR kingdom Lhotov',
            '1 _STROM_IN @X12@',
            '1 _STROM_BY robot',
            '1 _STROM_AT yesterday',
            '1 _STROM_SRC Register', '2 WWW javascript:alert(1)',
            '1 _STROM_VERIFIED soon',
            `1 _STROM_WHY ${'x'.repeat(2500)}`,
            // A record without a name is no record.
            '0 @L0031@ _STROM_PLACE', '1 _STROM_BY research',
            // An id that is not L + digits is no place record.
            '0 @LX1@ _STROM_PLACE', '1 NAME Lhota',
            // A ref to a record the file does not have.
            '0 @I1@ INDI', '1 NAME Jan /Lhoták/', '1 BIRT', '2 PLAC Lhota', '3 _STROM_PLACE @L0099@',
            '1 DEAT', '2 PLAC Jinov', '3 _STROM_PLACE <script>',
        ));
        expect(parsed.placeRecords?.get('L0030')).toEqual({ id: 'L0030', names: [{ name: 'Jinov' }], source: { title: 'Register' } });
        expect(parsed.placeRecords?.has('L0031')).toBe(false);
        expect(parsed.placeRecords?.size).toBe(1);
        expect(parsed.placeRefs).toBeUndefined();
    });

    it('a ref directly under a fact (not under PLAC) says nothing', () => {
        const parsed = parseGedcom(ged(
            '0 @I1@ INDI', '1 BIRT', '2 PLAC Lhota', '2 DATE 1850', '3 _STROM_PLACE @L0001@',
            '0 @L0001@ _STROM_PLACE', '1 NAME Lhota',
        ));
        expect(parsed.placeRefs).toBeUndefined();
    });

    it('survives a load (migrateData) and is not written by the exporter', () => {
        const data = migrateData(convertToStrom(parseGedcom(ged(...PERSON, ...RECORD))).data);
        expect(data.placeRecords?.['L0012']?.jurisdictions?.[0]).toEqual({ kind: 'parish', name: 'Lhotov', from: 1784 });
        expect(data.placeRefs?.[placeKey('Horní Lhota')]).toBe('L0012');
        const out = exportToGedcom(data).content;
        expect(out).not.toContain('_STROM_PLACE');
        expect(out).not.toContain('_STROM_JUR');
    });

    it('a tree without the records has none', () => {
        const result = convertToStrom(parseGedcom(ged('0 @I1@ INDI', '1 NAME Jan /Lhoták/', '1 BIRT', '2 PLAC Lhota')));
        expect(result.data.placeRecords).toBeUndefined();
        expect(result.data.placeRefs).toBeUndefined();
    });
});
