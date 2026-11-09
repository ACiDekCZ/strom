/**
 * GEDCOM date conversion preserves precision and qualifiers (flex dates).
 */

import { describe, it, expect } from 'vitest';
import { parseGedcomDate, gedcomDatePhrase } from '../ged-parser.js';
import { normalizeDateInput } from '../dates.js';

describe('parseGedcomDate (flex dates)', () => {
    it('preserves precision instead of fabricating month/day', () => {
        expect(parseGedcomDate('1900')).toBe('1900');
        expect(parseGedcomDate('JUN 1900')).toBe('1900-06');
        expect(parseGedcomDate('3 JUN 1900')).toBe('1900-06-03');
    });

    it('maps qualifiers to flex-date prefixes', () => {
        expect(parseGedcomDate('ABT 1900')).toBe('~1900');
        expect(parseGedcomDate('ABOUT 1900')).toBe('~1900');
        expect(parseGedcomDate('EST 1900')).toBe('~1900');
        expect(parseGedcomDate('BEF 1900')).toBe('<1900');
        expect(parseGedcomDate('BEFORE JUN 1900')).toBe('<1900-06');
        expect(parseGedcomDate('AFT 3 JUN 1900')).toBe('>1900-06-03');
    });

    it('handles empty and garbage input', () => {
        expect(parseGedcomDate('')).toBe('');
        expect(parseGedcomDate('UNKNOWN')).toBe('');
    });

    it('strips calendar escapes instead of losing the date', () => {
        // "@#DJULIAN@ 3 JUN 1699" parsed to '' — every pre-1752 Julian date
        // silently vanished.
        expect(parseGedcomDate('@#DJULIAN@ 3 JUN 1699')).toBe('1699-06-03');
        expect(parseGedcomDate('@#DGREGORIAN@ 1900')).toBe('1900');
        expect(parseGedcomDate('ABT @#DJULIAN@ 1699')).toBe('~1699');
        expect(parseGedcomDate('BET @#DJULIAN@ 1690 AND @#DJULIAN@ 1699')).toBe('1690..1699');
    });

    it('reads dual years as the year written in the record', () => {
        // "1699/00" is the same moment under old-style/new-style year counting;
        // the flex-date model has no dual form, so the first (as-written) year
        // is kept rather than parsing to ''.
        expect(parseGedcomDate('1699/00')).toBe('1699');
        expect(parseGedcomDate('11 FEB 1699/00')).toBe('1699-02-11');
        expect(parseGedcomDate('FEB 1699/00')).toBe('1699-02');
        expect(parseGedcomDate('@#DJULIAN@ 11 FEB 1699/00')).toBe('1699-02-11');
    });
});

describe('dates written with local words', () => {
    it('reads after, before and about in the languages of the registers', () => {
        expect(parseGedcomDate('Po 1919')).toBe('>1919');
        expect(parseGedcomDate('po roce 1919')).toBe('>1919');
        expect(parseGedcomDate('nach 1919')).toBe('>1919');
        expect(parseGedcomDate('после 1870 г.')).toBe('>1870');
        expect(parseGedcomDate('після 1870')).toBe('>1870');
        expect(parseGedcomDate('před 1900')).toBe('<1900');
        expect(parseGedcomDate('PRZED 1900')).toBe('<1900');
        expect(parseGedcomDate('bis 1900')).toBe('<1900');
        expect(parseGedcomDate('kolem r. 1850')).toBe('~1850');
        expect(parseGedcomDate('cca 1850')).toBe('~1850');
        expect(parseGedcomDate('ca. 1850')).toBe('~1850');
        expect(parseGedcomDate('około 1850')).toBe('~1850');
        expect(parseGedcomDate('ungefähr im Jahr 1850')).toBe('~1850');
        expect(parseGedcomDate('около 1850')).toBe('~1850');
    });

    it('keeps the precision of the date after the word', () => {
        expect(parseGedcomDate('po 12 MAR 1919')).toBe('>1919-03-12');
        expect(parseGedcomDate('po 12. 3. 1919')).toBe('>1919-03-12');
        expect(parseGedcomDate('kolem 3.1850')).toBe('~1850-03');
    });

    it('reads between as a range, from-to as a period, from alone as an open period', () => {
        expect(parseGedcomDate('mezi 1850 a 1855')).toBe('1850..1855');
        expect(parseGedcomDate('medzi rokmi 1850 a 1855')).toBe('1850..1855');
        expect(parseGedcomDate('zwischen 1850 und 1855')).toBe('1850..1855');
        expect(parseGedcomDate('pomiędzy 1850 i 1855')).toBe('1850..1855');
        expect(parseGedcomDate('между 1850 и 1855')).toBe('1850..1855');
        expect(parseGedcomDate('між 1850 та 1855')).toBe('1850..1855');
        expect(parseGedcomDate('od 1850 do 1855')).toBe('1850/1855');
        expect(parseGedcomDate('von 1850 bis 1855')).toBe('1850/1855');
        expect(parseGedcomDate('с 1850 по 1855')).toBe('1850/1855');
        expect(parseGedcomDate('від 1850 до 1855')).toBe('1850/1855');
        expect(parseGedcomDate('ab 1850')).toBe('1850/');
    });

    it('needs a date after the word: "after the war" is no date', () => {
        expect(parseGedcomDate('po válce')).toBe('');
        expect(gedcomDatePhrase('po válce')).toBe('po válce');
    });

    it('writes no "as written" note for a word it knows', () => {
        expect(gedcomDatePhrase('Po 1919')).toBeNull();
        expect(gedcomDatePhrase('mezi 1850 a 1855')).toBeNull();
    });

    it('takes a year after an unknown word as an estimate and keeps the words', () => {
        expect(parseGedcomDate('Nejspíš 1919')).toBe('~1919');
        expect(gedcomDatePhrase('Nejspíš 1919')).toBe('Nejspíš 1919');
        // An unknown month between a day and a year: the year is certain.
        expect(parseGedcomDate('3 XYZ 1900')).toBe('1900');
    });
});

describe('a month and year in figures (T42)', () => {
    it('reads MM/YYYY, M/YYYY, MM.YYYY and M.YYYY as the month of that year', () => {
        // "Cca 07/1987" was left to the note "Date in the record: …" with no date.
        for (const [value, date] of [
            ['07/1987', '1987-07'], ['7/1987', '1987-07'], ['07.1987', '1987-07'], ['7.1987', '1987-07'],
            ['12/1987', '1987-12'], ['1/987', '987-01'],
        ]) {
            expect(parseGedcomDate(value), value).toBe(date);
            expect(gedcomDatePhrase(value), value).toBeNull();
        }
    });

    it('keeps the qualifier, in GEDCOM keywords and in local words', () => {
        for (const [value, date] of [
            ['Cca 07/1987', '~1987-07'], ['ABT 07/1987', '~1987-07'], ['EST 7/1987', '~1987-07'],
            ['ca. 07/1987', '~1987-07'], ['circa 7/1987', '~1987-07'], ['kolem 07.1987', '~1987-07'],
            ['um 07/1987', '~1987-07'], ['ok. 07/1987', '~1987-07'], ['około 7/1987', '~1987-07'],
            ['před 07/1987', '<1987-07'], ['BEF 7/1987', '<1987-07'], ['vor 07/1987', '<1987-07'], ['przed 7.1987', '<1987-07'],
            ['po 7.1987', '>1987-07'], ['AFT 07.1987', '>1987-07'], ['nach 07/1987', '>1987-07'],
            ['BET 5/1880 AND 7/1880', '1880-05..1880-07'],
        ]) {
            expect(parseGedcomDate(value), value).toBe(date);
            expect(gedcomDatePhrase(value), value).toBeNull();
        }
    });

    it('a number that is no month stays unknown, kept as written', () => {
        for (const value of ['13/1987', '00/1987', 'Cca 13/1987']) {
            expect(parseGedcomDate(value), value).toBe('');
            expect(gedcomDatePhrase(value), value).toBe(value);
        }
    });

    it('a dual year and a day-first date read as before', () => {
        expect(parseGedcomDate('1699/00')).toBe('1699');
        expect(parseGedcomDate('ABT 1699/00')).toBe('~1699');
        expect(parseGedcomDate('1987/07')).toBe('1987');
        expect(parseGedcomDate('kolem 12. 3. 1919')).toBe('~1919-03-12');
        expect(parseGedcomDate('5/3/1919')).toBe('');
        expect(gedcomDatePhrase('5/3/1919')).toBe('5/3/1919');
    });

    it('a date typed in the app reads the same in every language', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            for (const value of ['07/1987', '7.1987', 'Cca 07/1987', 'kolem 7/1987', 'před 07/1987', 'po 7.1987',
                'um 07/1987', 'ok. 07/1987', 'przed 7/1987', 'ABT 07/1987', '13/1987']) {
                expect(normalizeDateInput(value, lang) ?? '', `${lang} ${value}`).toBe(parseGedcomDate(value));
            }
        }
    });
});
