/**
 * What a record adds to an event beyond its date and place: cause (CAUS), age
 * as recorded (AGE), house or address (ADDR), the divorce place and each
 * partner's age at a wedding. Read into fields, written back as the same tags,
 * and the recorded age compared with the one the dates give. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { readRecordedAge, gedcomAge, localAge, checkRecordedAge } from '../recorded-age.js';
import { ageRangeBetween } from '../dates.js';
import { setLanguage } from '../strings.js';
import { StromData, Person, Partnership } from '../types.js';

const GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jan /Vlk/
1 SEX M
1 BIRT
2 DATE 1862
2 PLAC Horní Lhota
2 ADDR čp. 13
1 DEAT
2 DATE 12 MAR 1919
2 PLAC Horní Lhota
2 CAUS souchotiny
2 AGE 54y
2 ADDR čp. 13
1 BURI
2 DATE 15 MAR 1919
2 AGE 54y
1 FAMS @F1@
0 @I2@ INDI
1 NAME Marie /Dvořáková/
1 SEX F
1 BAPM
2 DATE 2 FEB 1869
2 PLAC Dolní Lhota
2 ADDR čp. 7
1 DEAT
2 DATE Po 1919
2 AGE INFANT
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 14 FEB 1888
2 PLAC Dolní Lhota
2 ADDR čp. 7
2 HUSB
3 AGE 24y
2 WIFE
3 AGE 19y
1 DIV
2 DATE 1900
2 PLAC Praha
0 TRLR`;

const load = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;
const theUnion = (data: StromData): Partnership => Object.values(data.partnerships)[0];

describe('event details from GEDCOM', () => {
    beforeEach(() => setLanguage('cs'));

    it('reads the death, the birth house and the event fields', () => {
        const data = load(GED);
        const jan = byName(data, 'Jan');
        expect(jan).toMatchObject({ birthAddress: 'čp. 13', deathCause: 'souchotiny', deathAge: '54 let', deathAddress: 'čp. 13' });
        expect(jan.events?.find(e => e.type === 'burial')?.age).toBe('54 let');
        const marie = byName(data, 'Marie');
        expect(marie.events?.find(e => e.type === 'baptism')?.address).toBe('čp. 7');
        expect(marie.deathAge).toBe('kojenec');
        expect(marie.deathDate).toBe('>1919');
        expect(jan.notes ?? '').toBe('');
    });

    it('reads the wedding house, both ages and the divorce place', () => {
        const data = load(GED);
        const u = theUnion(data);
        const jan = byName(data, 'Jan');
        const marie = byName(data, 'Marie');
        expect(u.address).toBe('čp. 7');
        expect(u.ages).toEqual({ [jan.id]: '24 let', [marie.id]: '19 let' });
        expect(u.endPlace).toBe('Praha');
        expect(u.note ?? '').toBe('');
    });

    it('writes them back as the same tags, never as a note', () => {
        const out = exportToGedcom(load(GED)).content;
        for (const line of ['2 ADDR čp. 13', '2 CAUS souchotiny', '2 AGE 54y', '2 AGE INFANT', '2 ADDR čp. 7',
            '2 HUSB\n3 AGE 24y', '2 WIFE\n3 AGE 19y', '1 DIV\n2 DATE 1900\n2 PLAC Praha']) {
            expect(out).toContain(line);
        }
        expect(out).not.toMatch(/NOTE.*(souchotiny|Věk|Příčina)/);
        expect(out).toContain('2 DATE AFT 1919');
    });

    it('comes back from a round trip unchanged', () => {
        const once = load(GED);
        const twice = load(exportToGedcom(once).content);
        const strip = (d: StromData) => Object.values(d.persons).map(p => ({
            b: p.birthAddress, c: p.deathCause, a: p.deathAge, d: p.deathAddress,
            e: (p.events ?? []).map(e => [e.type, e.cause, e.age, e.address]),
        }));
        expect(strip(twice)).toEqual(strip(once));
        expect(Object.values(theUnion(twice).ages ?? {})).toEqual(['24 let', '19 let']);
        expect(theUnion(twice).endPlace).toBe('Praha');
    });

    it('keeps a detail with no field in the note: the cause of a birth', () => {
        const data = load(GED.replace('2 ADDR čp. 13\n1 DEAT', '2 ADDR čp. 13\n2 CAUS doma\n1 DEAT'));
        expect(byName(data, 'Jan').notes).toContain('doma');
    });
});

describe('the recorded age', () => {
    beforeEach(() => setLanguage('cs'));

    it('reads spans in the languages of the registers, and the age words', () => {
        expect(readRecordedAge('54 let')).toMatchObject({ kind: 'span', years: 54 });
        expect(readRecordedAge('54y')).toMatchObject({ years: 54 });
        expect(readRecordedAge('27y 3m')).toMatchObject({ years: 27, months: 3 });
        expect(readRecordedAge('1 Jahr und 2 Monate')).toMatchObject({ years: 1, months: 2 });
        expect(readRecordedAge('3 měsíce')).toMatchObject({ years: 0, months: 3 });
        expect(readRecordedAge('2 týdny')).toMatchObject({ weeks: 2 });
        expect(readRecordedAge('5 dnů')).toMatchObject({ days: 5 });
        expect(readRecordedAge('лет 5')).toBeNull();
        expect(readRecordedAge('40 лет')).toMatchObject({ years: 40 });
        expect(readRecordedAge('<1y')).toMatchObject({ qualifier: '<', years: 1 });
        expect(readRecordedAge('kojenec')).toEqual({ kind: 'word', word: 'INFANT' });
        expect(readRecordedAge('mrtvě narozené')).toEqual({ kind: 'word', word: 'STILLBORN' });
        expect(readRecordedAge('asi padesát')).toBeNull();
    });

    it('goes out the GEDCOM way when it can be read, as written otherwise', () => {
        expect(gedcomAge('54 let')).toBe('54y');
        expect(gedcomAge('3 Monate')).toBe('3m');
        expect(gedcomAge('2 týdny')).toBe('14d');
        expect(gedcomAge('kojenec')).toBe('INFANT');
        expect(gedcomAge('asi padesát')).toBe('asi padesát');
    });

    it('comes in in words of the UI language', () => {
        expect(localAge('54y')).toBe('54 let');
        expect(localAge('27y 3m')).toBe('27 let 3 měsíce');
        expect(localAge('STILLBORN')).toBe('mrtvě narozené');
        setLanguage('en');
        expect(localAge('1y')).toBe('1 year');
    });

    it('is compared with the range the dates allow, and the gap given in years', () => {
        expect(ageRangeBetween('1862', '1919-03-12')).toEqual({ min: 56, max: 57 });
        expect(ageRangeBetween('1862', '1888-02-14')).toEqual({ min: 25, max: 26 });
        expect(ageRangeBetween('1869-02-02', '1888-02-14')).toEqual({ min: 19, max: 19 });
        expect(ageRangeBetween('~1862', '1919')).toBeNull();
        expect(checkRecordedAge('54 let', '1862', '1919-03-12')).toEqual({ range: '56–57 let', differs: '2 roky' });
        expect(checkRecordedAge('56 let', '1862', '1919-03-12')).toEqual({ range: '56–57 let', differs: '' });
        expect(checkRecordedAge('kojenec', '1862', '1919-03-12')?.differs).toBe('');
        expect(checkRecordedAge('3 měsíce', '1919-01-01', '1919-04-02')).toEqual({ range: '0 let', differs: '' });
        expect(checkRecordedAge('54 let', undefined, '1919')).toBeNull();
        expect(checkRecordedAge('19 let', '1869-02-02', '1888-02-14')).toEqual({ range: '19 let', differs: '' });
    });
});
