/**
 * What a person said about houses in a GEDCOM file (spec 030 U4b, the
 * research's answer 8): `0 @Hn@ _HOUSE` written by the app's exporter and
 * read back by its parser. A fictional village Bělokamen: čp. 9 renumbered
 * to čp. 16 about 1860, the Prouzals' house "U Prouzalů"; Hvozdnice čp. 3
 * with nothing said about it.
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { gedcomHouseRecords, housesFromRecords, openHouseRecord, readHouseRecordLine } from '../ged-houses.js';
import { keepHouses } from '../houses.js';
import { applyLivingPrivacy } from '../privacy.js';
import type { HouseUserData, Person, PersonId, StromData } from '../types.js';

function person(id: string, first: string, last: string, gender: Person['gender'], o: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o };
}

function village(houses?: StromData['houses']): StromData {
    const persons = [
        person('svatobor', 'Svatobor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1820-03-02',
            deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890-11-01',
            childIds: ['hostivit'] as PersonId[],
        }),
        person('hostivit', 'Hostivít', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1848',
            deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1910',
            parentIds: ['svatobor'] as PersonId[],
        }),
        person('kapradin', 'Kapradin', 'Trnovec', 'male', { birthPlace: 'Hvozdnice', birthAddress: 'čp. 3', birthDate: '1880' }),
    ];
    return {
        version: 27,
        persons: Object.fromEntries(persons.map(p => [p.id, p])),
        partnerships: {},
        ...(houses ? { houses } : {}),
    } as StromData;
}

const PROUZALS: Record<string, HouseUserData> = {
    'belokamen|16': {
        name: 'U Prouzalů', merged: ['belokamen|9'], split: ['belokamen|61'],
        location: { lat: 49.5, lng: 15.2, how: 'manual' }, revealInOutputs: ['E3'],
    },
};

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const houseLines = (ged: string): string[] => {
    const lines = ged.split('\n');
    const start = lines.findIndex(l => / _HOUSE$/.test(l));
    if (start < 0) return [];
    const end = lines.findIndex((l, i) => i > start && l.startsWith('0 ') && !/ _HOUSE$/.test(l));
    return lines.slice(start, end);
};

describe('_HOUSE in the GEDCOM export', () => {
    it('writes a named house with its joined number, each with the years of its facts', () => {
        const ged = exportToGedcom(village(PROUZALS)).content;
        expect(houseLines(ged)).toEqual([
            '0 @H1@ _HOUSE',
            '1 PLAC Bělokamen',
            '1 _NUM čp. 16',
            '2 DATE FROM 1890 TO 1910',
            '1 NAME U Prouzalů',
            '1 _SAME @H2@',
            '1 _STROM_KEY belokamen|16',
            '0 @H2@ _HOUSE',
            '1 PLAC Bělokamen',
            '1 _NUM čp. 9',
            '2 DATE FROM 1820 TO 1848',
            '1 _STROM_KEY belokamen|9',
        ]);
        // The trailer stays last; nothing else of the house data goes into the file.
        expect(ged.trimEnd().endsWith('0 TRLR')).toBe(true);
        expect(ged).not.toMatch(/belokamen\|61|49\.5|E3/);
    });

    it('writes no record for houses nothing was said about, nor "Back to {prog}"', () => {
        expect(exportToGedcom(village()).content).not.toContain('_HOUSE');
        expect(exportToGedcom(village({ 'hvozdnice|3': { location: { lat: 49, lng: 15, how: 'confirmed' } } })).content).not.toContain('_HOUSE');
        expect(exportToGedcom(village(PROUZALS), undefined, { backTo: 'imp1' }).content).not.toContain('_HOUSE');
    });

    it('a joined house the tree has no fact of still has its record, so _SAME points at one', () => {
        const records = gedcomHouseRecords(village({ 'belokamen|16': { merged: ['belokamen|7'] } }));
        expect(records).toEqual([
            { key: 'belokamen|16', town: 'Bělokamen', numbers: [{ house: 'čp. 16', from: 1890, to: 1910 }], same: ['belokamen|7'] },
            { key: 'belokamen|7', town: 'Bělokamen', numbers: [], same: [] },
        ]);
    });

    it('under a privacy mode a protected house goes as JSON does: without its name', () => {
        // Hostivít died in 1990: the house has a record of the last ~100 years.
        const data = village(PROUZALS);
        data.persons['hostivit' as PersonId].deathDate = '1990';
        const ged = exportToGedcom(applyLivingPrivacy(data, 'initials', 2026)).content;
        expect(ged).toContain('1 _STROM_KEY belokamen|16');
        expect(ged).not.toContain('U Prouzalů');
        // Only a name, protected: no record at all.
        const named = village({ 'belokamen|16': { name: 'U Prouzalů' } });
        named.persons['hostivit' as PersonId].deathDate = '1990';
        expect(exportToGedcom(applyLivingPrivacy(named, 'initials', 2026)).content).not.toContain('_HOUSE');
    });
});

describe('_HOUSE in the GEDCOM import', () => {
    it('round-trip: the name and the houses joined come back, the rest is the app\'s own', () => {
        const back = importGed(exportToGedcom(village(PROUZALS)).content);
        expect(back.houses).toEqual({ 'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'] } });
        // Export → import → export gives the same records.
        expect(houseLines(exportToGedcom(back).content)).toEqual(houseLines(exportToGedcom(village(PROUZALS)).content));
    });

    it('is not reported as a record the app cannot read', () => {
        const parsed = parseGedcom(exportToGedcom(village(PROUZALS)).content);
        expect(parsed.droppedTags.has('_HOUSE')).toBe(false);
        expect(parsed.houseRecords?.length).toBe(2);
    });

    it('reads the research\'s shape: numbers over time, _SAME, no key', () => {
        const ged = [
            '0 HEAD', '1 SOUR STROM_RESEARCH', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Svatobor /Prouzal/',
            '0 @H7@ _HOUSE', '1 PLAC Bělokamen',
            '1 _NUM čp. 9', '2 DATE FROM 1784 TO 1860',
            '1 _NUM čp. 16', '2 DATE FROM 1860',
            '1 NAME U Prouzalů', '2 CONC  na návsi', '1 _SAME @H8@', '1 _UNKNOWN x',
            '0 @H8@ _HOUSE', '1 PLAC Bělokamen', '1 _NUM 61', '1 _STROM_KEY belokamen|61',
            '0 @H9@ _HOUSE', '1 NAME Bez obce',
            '0 TRLR',
        ].join('\n');
        expect(importGed(ged).houses).toEqual({ 'belokamen|16': { name: 'U Prouzalů na návsi', merged: ['belokamen|9', 'belokamen|61'] } });
    });

    it('reads a CONC of a number and a key', () => {
        const rec = openHouseRecord('@H1@');
        for (const [l, t, v] of [[1, 'PLAC', 'Bělokamen'], [1, '_NUM', 'čp.'], [2, 'CONC', ' 16'], [1, '_STROM_KEY', 'belokamen|'], [2, 'CONC', '16']] as const) {
            readHouseRecordLine(rec, l, t, v);
        }
        expect(rec.numbers).toEqual([{ house: 'čp. 16' }]);
        expect(housesFromRecords([{ ...rec, name: 'Mlýn' }])).toEqual({ 'belokamen|16': { name: 'Mlýn' } });
    });

    it('a version from the research takes a house\'s name and joins, keeps what the file does not carry', () => {
        const previous = village(PROUZALS);
        const next = village({ 'belokamen|16': { name: 'Prouzalovic', merged: ['belokamen|61', 'belokamen|5'] }, 'hvozdnice|3': { name: 'Na Skále' } });
        expect(keepHouses(next, previous).houses).toEqual({
            'belokamen|16': {
                name: 'Prouzalovic', merged: ['belokamen|9', 'belokamen|5'], split: ['belokamen|61'],
                location: { lat: 49.5, lng: 15.2, how: 'manual' }, revealInOutputs: ['E3'],
            },
            'hvozdnice|3': { name: 'Na Skále' },
        });
        // A file without any word about houses keeps the previous state whole.
        expect(keepHouses(village(), previous).houses).toEqual(PROUZALS);
    });
});

describe('the name of a house is cut and joined back whole (fuzz)', () => {
    const HARD = ['👨‍👩‍👧', '👍🏽', '🇨🇿🇩🇪', 'é', 'ạ̈', '각', '家族', '𠮷', '@', 'ř', ' '];
    let seed = 3011;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const utf8 = (s: string): number => new TextEncoder().encode(s).length;
    const hasLoneSurrogate = (s: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

    let conc = 0;
    const cuts = (): number => conc;
    const roundTrip = (name: string): void => {
        const ged = exportToGedcom(village({ 'belokamen|16': { name } })).content;
        if (ged.includes('\n2 CONC ')) conc++;
        for (const line of houseLines(ged)) {
            expect(hasLoneSurrogate(line)).toBe(false);
            expect(utf8(line)).toBeLessThanOrEqual(255);
            expect(/^\d+ (?:CONC|CONT) [\p{M}‍\u{1F3FB}-\u{1F3FF}]/u.test(line)).toBe(false);
        }
        expect(importGed(ged).houses).toEqual({ 'belokamen|16': { name } });
    };

    it('CJK right at the line\'s byte limit', () => {
        for (let lead = 0; lead < 6; lead++) roundTrip('a'.repeat(lead) + '家'.repeat(66));
        roundTrip('家'.repeat(66) + '𠮷');
        roundTrip('U ' + '각'.repeat(65) + 'é');
    });

    it('emoji, combining marks and CJK at the cut', () => {
        for (let round = 0; round < 80; round++) {
            let name = 'U Prouzalů '.repeat(1 + rand(16)).slice(0, 150 + rand(45));
            while (name.length < 230) name += HARD[rand(HARD.length)] + (rand(3) ? 'ž' : '');
            // A stored name is at most 200 UTF-16 units, trimmed (sanitizeHouseUserData): cut on a whole character.
            let cut = 200;
            while (cut > 0 && /[\uDC00-\uDFFF]/.test(name[cut])) cut--;
            roundTrip(name.slice(0, cut).trim());
        }
        // Most names were cut onto a CONC line (the test tests the cut).
        expect(cuts()).toBeGreaterThan(40);
    });
});
