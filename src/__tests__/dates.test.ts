/**
 * Tests for flexible (partial) genealogy dates.
 */

import { describe, it, expect } from 'vitest';
import { initLanguage } from '../strings.js';
import {
    parseFlexDate,
    toCanonical,
    normalizeDateInput,
    isValidDateInput,
    formatDateForInput,
    displayYear,
    yearOf,
    dateSortKey,
    formatFlexDate,
    ageBetween,
} from '../dates.js';

describe('parseFlexDate', () => {
    it('parses full ISO dates (legacy data)', () => {
        expect(parseFlexDate('1880-05-15')).toEqual({ qualifier: '', year: 1880, month: 5, day: 15 });
    });

    it('parses partial dates', () => {
        expect(parseFlexDate('1880')).toEqual({ qualifier: '', year: 1880, month: undefined, day: undefined });
        expect(parseFlexDate('1880-05')).toEqual({ qualifier: '', year: 1880, month: 5, day: undefined });
    });

    it('parses qualifiers', () => {
        expect(parseFlexDate('~1880')).toEqual({ qualifier: '~', year: 1880, month: undefined, day: undefined });
        expect(parseFlexDate('<1880-05')).toEqual({ qualifier: '<', year: 1880, month: 5, day: undefined });
        expect(parseFlexDate('>1900-01-01')).toEqual({ qualifier: '>', year: 1900, month: 1, day: 1 });
    });

    it('rejects invalid values', () => {
        expect(parseFlexDate('')).toBeNull();
        expect(parseFlexDate(undefined)).toBeNull();
        expect(parseFlexDate('abc')).toBeNull();
        expect(parseFlexDate('1880-13')).toBeNull();
        expect(parseFlexDate('1880-02-30')).toBeNull();
        expect(parseFlexDate('1880-00-01')).toBeNull();
    });

    it('validates leap years', () => {
        expect(parseFlexDate('1880-02-29')).not.toBeNull();
        expect(parseFlexDate('1881-02-29')).toBeNull();
    });
});

describe('toCanonical', () => {
    it('round-trips with parseFlexDate', () => {
        for (const v of ['1880', '1880-05', '1880-05-15', '~1880', '<1905-12', '>1900-01-01']) {
            expect(toCanonical(parseFlexDate(v)!)).toBe(v);
        }
    });

    it('zero-pads months and days', () => {
        expect(toCanonical({ qualifier: '', year: 1880, month: 5, day: 3 })).toBe('1880-05-03');
    });
});

describe('normalizeDateInput', () => {
    it('accepts empty input as empty', () => {
        expect(normalizeDateInput('')).toBe('');
        expect(normalizeDateInput('   ')).toBe('');
    });

    it('accepts Czech day-first formats', () => {
        expect(normalizeDateInput('15.5.1880')).toBe('1880-05-15');
        expect(normalizeDateInput('15. 5. 1880')).toBe('1880-05-15');
        expect(normalizeDateInput('15/5/1880')).toBe('1880-05-15');
    });

    it('accepts month/year and year-only', () => {
        expect(normalizeDateInput('5/1880')).toBe('1880-05');
        expect(normalizeDateInput('5.1880')).toBe('1880-05');
        expect(normalizeDateInput('1880-05')).toBe('1880-05');
        expect(normalizeDateInput('1880')).toBe('1880');
    });

    it('accepts ISO', () => {
        expect(normalizeDateInput('1880-05-15')).toBe('1880-05-15');
    });

    it('accepts Czech qualifier words', () => {
        expect(normalizeDateInput('kolem 1880')).toBe('~1880');
        expect(normalizeDateInput('cca 1880')).toBe('~1880');
        expect(normalizeDateInput('okolo 1880')).toBe('~1880');
        expect(normalizeDateInput('před 1880')).toBe('<1880');
        expect(normalizeDateInput('pred 1880')).toBe('<1880');
        expect(normalizeDateInput('po 1880')).toBe('>1880');
    });

    it('accepts English qualifier words', () => {
        expect(normalizeDateInput('about 1880')).toBe('~1880');
        expect(normalizeDateInput('abt 1880')).toBe('~1880');
        expect(normalizeDateInput('before 1880')).toBe('<1880');
        expect(normalizeDateInput('after 1880')).toBe('>1880');
    });

    it('accepts qualifier symbols', () => {
        expect(normalizeDateInput('~1880')).toBe('~1880');
        expect(normalizeDateInput('~ 15.5.1880')).toBe('~1880-05-15');
        expect(normalizeDateInput('<1880')).toBe('<1880');
        expect(normalizeDateInput('>5/1880')).toBe('>1880-05');
    });

    it('combines qualifier words with full dates', () => {
        expect(normalizeDateInput('kolem 5/1880')).toBe('~1880-05');
        expect(normalizeDateInput('před 15.5.1880')).toBe('<1880-05-15');
    });

    it('rejects garbage', () => {
        expect(normalizeDateInput('patnáctého května')).toBeNull();
        expect(normalizeDateInput('32.1.1880')).toBeNull();
        expect(normalizeDateInput('15.13.1880')).toBeNull();
        expect(normalizeDateInput('50')).toBeNull();
        expect(normalizeDateInput('9999')).toBeNull();
        expect(normalizeDateInput('1880-')).toBeNull();
    });

    it('isValidDateInput mirrors normalizeDateInput', () => {
        expect(isValidDateInput('')).toBe(true);
        expect(isValidDateInput('kolem 1880')).toBe(true);
        expect(isValidDateInput('nesmysl')).toBe(false);
    });
});

describe('displayYear / yearOf / dateSortKey', () => {
    it('keeps qualifier in display year', () => {
        expect(displayYear('~1880')).toBe('~1880');
        expect(displayYear('<1880-05-15')).toBe('<1880');
        expect(displayYear('1880-05-15')).toBe('1880');
        expect(displayYear(undefined)).toBe('');
    });

    it('yearOf strips qualifier and returns number', () => {
        expect(yearOf('~1880')).toBe(1880);
        expect(yearOf('1880-05-15')).toBe(1880);
        expect(yearOf(undefined)).toBeNull();
        expect(yearOf('garbage')).toBeNull();
    });

    it('dateSortKey strips qualifier only', () => {
        expect(dateSortKey('~1880')).toBe('1880');
        expect(dateSortKey('<1880-05')).toBe('1880-05');
        expect(dateSortKey('1880-05-15')).toBe('1880-05-15');
        expect(dateSortKey(undefined)).toBe('');
    });

    it('sort keys order sensibly across precisions', () => {
        const sorted = ['1881', '~1880-06', '1880-05-15', '1880'].sort((a, b) =>
            dateSortKey(a).localeCompare(dateSortKey(b)));
        expect(sorted).toEqual(['1880', '1880-05-15', '~1880-06', '1881']);
    });
});

describe('formatFlexDate', () => {
    it('formats Czech', () => {
        expect(formatFlexDate('1880-05-15', 'cs')).toBe('15. 5. 1880');
        expect(formatFlexDate('1880-05', 'cs')).toBe('5/1880');
        expect(formatFlexDate('1880', 'cs')).toBe('1880');
        expect(formatFlexDate('~1880', 'cs')).toBe('kolem 1880');
        expect(formatFlexDate('<1880-05-15', 'cs')).toBe('před 15. 5. 1880');
    });

    it('formats English', () => {
        expect(formatFlexDate('1880-05-15', 'en')).toBe('5/15/1880');
        expect(formatFlexDate('~1880', 'en')).toBe('about 1880');
        expect(formatFlexDate('>1880-05', 'en')).toBe('after 5/1880');
    });

    it('passes through unparseable legacy values', () => {
        expect(formatFlexDate('divné datum', 'cs')).toBe('divné datum');
        expect(formatFlexDate(undefined, 'cs')).toBe('');
    });
});

describe('ageBetween', () => {
    it('computes exact age', () => {
        expect(ageBetween('1880-05-15', '1950-05-14')).toEqual({ years: 69, approx: false });
        expect(ageBetween('1880-05-15', '1950-05-15')).toEqual({ years: 70, approx: false });
    });

    it('marks partial precision as approximate', () => {
        expect(ageBetween('1880', '1950')).toEqual({ years: 70, approx: true });
        expect(ageBetween('~1880-05-15', '1950-05-15')).toEqual({ years: 70, approx: true });
    });

    it('handles open end (still alive) without crashing', () => {
        const r = ageBetween('1990-01-01');
        expect(r).not.toBeNull();
        expect(r!.years).toBeGreaterThan(30);
    });

    it('returns null for missing/invalid birth or negative age', () => {
        expect(ageBetween(undefined, '1950')).toBeNull();
        expect(ageBetween('1950', '1880')).toBeNull();
    });
});

describe('formatDateForInput', () => {
    it('emits Czech input forms that parse back to the same canonical value', () => {
        initLanguage('cs');
        for (const canonical of ['1880', '~1880', '<1905', '1880-05', '1880-05-15', '>1900-12-03']) {
            const shown = formatDateForInput(canonical);
            expect(shown).not.toContain('-');           // no ISO in Czech inputs
            expect(normalizeDateInput(shown)).toBe(canonical);
        }
        expect(formatDateForInput('1880-05-15')).toBe('15.5.1880');
        expect(formatDateForInput('~1880')).toBe('~1880');
        initLanguage('en');
    });

    it('keeps canonical ISO for English (day-first parsing would misread M/D)', () => {
        initLanguage('en');
        expect(formatDateForInput('1880-05-15')).toBe('1880-05-15');
        expect(formatDateForInput('~1880')).toBe('~1880');
    });

    it('passes through empty and unparseable values', () => {
        expect(formatDateForInput('')).toBe('');
        expect(formatDateForInput(undefined)).toBe('');
        expect(formatDateForInput('nonsense')).toBe('nonsense');
    });
});

describe('date ranges (K4)', () => {
    it('parses canonical ranges with start components + end', () => {
        const d = parseFlexDate('1880..1885')!;
        expect(d.year).toBe(1880);
        expect(d.end).toEqual({ year: 1885, month: undefined, day: undefined });
        expect(parseFlexDate('1880-05..1881-02-03')!.end).toEqual({ year: 1881, month: 2, day: 3 });
    });

    it('rejects malformed ranges', () => {
        expect(parseFlexDate('~1880..1885')).toBeNull();
        expect(parseFlexDate('1880..')).toBeNull();
        expect(parseFlexDate('1880..~1885')).toBeNull();
        expect(parseFlexDate('1880..1885..1890')).toBeNull();
    });

    it('normalizes user input ranges (.., mezi/a, between/and)', () => {
        expect(normalizeDateInput('1880..1885')).toBe('1880..1885');
        expect(normalizeDateInput('15.5.1880..1890')).toBe('1880-05-15..1890');
        expect(normalizeDateInput('mezi 1880 a 1885')).toBe('1880..1885');
        expect(normalizeDateInput('between 1880 and 1885')).toBe('1880..1885');
        expect(normalizeDateInput('kolem 1880..1885')).toBeNull();
    });

    it('formats ranges for display and keeps input form canonical', () => {
        expect(formatFlexDate('1880..1885', 'cs')).toBe('mezi 1880 a 1885');
        expect(formatFlexDate('1880..1885', 'en')).toBe('between 1880 and 1885');
        expect(formatDateForInput('1880..1885')).toBe('1880..1885');
    });

    it('yearOf of a range is the start year (conservative sort key)', () => {
        expect(yearOf('1880..1885')).toBe(1880);
    });
});
