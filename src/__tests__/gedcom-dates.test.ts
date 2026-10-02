/**
 * GEDCOM date conversion preserves precision and qualifiers (flex dates).
 */

import { describe, it, expect } from 'vitest';
import { parseGedcomDate, gedcomDatePhrase } from '../ged-parser.js';

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

    it('reads between and from-to as a range, from alone as after', () => {
        expect(parseGedcomDate('mezi 1850 a 1855')).toBe('1850..1855');
        expect(parseGedcomDate('medzi rokmi 1850 a 1855')).toBe('1850..1855');
        expect(parseGedcomDate('zwischen 1850 und 1855')).toBe('1850..1855');
        expect(parseGedcomDate('pomiędzy 1850 i 1855')).toBe('1850..1855');
        expect(parseGedcomDate('между 1850 и 1855')).toBe('1850..1855');
        expect(parseGedcomDate('між 1850 та 1855')).toBe('1850..1855');
        expect(parseGedcomDate('od 1850 do 1855')).toBe('1850..1855');
        expect(parseGedcomDate('von 1850 bis 1855')).toBe('1850..1855');
        expect(parseGedcomDate('с 1850 по 1855')).toBe('1850..1855');
        expect(parseGedcomDate('від 1850 до 1855')).toBe('1850..1855');
        expect(parseGedcomDate('ab 1850')).toBe('>1850');
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
