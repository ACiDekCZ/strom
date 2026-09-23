/**
 * Date input follows the UI language the same way the display does: English
 * slash dates are month-first (M/D/Y, like formatFlexDate), Czech and German
 * day-first; dotted input is always day-first. Whatever an edit input shows
 * parses back to the same stored value in every language.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { initLanguage, Language } from '../strings.js';
import { normalizeDateInput, formatDateForInput, formatFlexDate, toCanonical, DateQualifier } from '../dates.js';

afterEach(() => initLanguage('en'));

describe('numeric day/month order by language', () => {
    it('English reads slashes month-first, like it displays them', () => {
        initLanguage('en');
        expect(normalizeDateInput('3/4/1880')).toBe('1880-03-04');
        expect(normalizeDateInput('5/15/1880')).toBe('1880-05-15');
        expect(formatFlexDate(normalizeDateInput('3/4/1880')!)).toBe('3/4/1880');
    });

    it('English: a first number above 12 can only be the day', () => {
        initLanguage('en');
        expect(normalizeDateInput('15/5/1880')).toBe('1880-05-15');
        expect(normalizeDateInput('31/12/1900')).toBe('1900-12-31');
        expect(normalizeDateInput('13/13/1880')).toBeNull();
        expect(normalizeDateInput('2/30/1880')).toBeNull();
    });

    it('dotted input is day-first in every language', () => {
        for (const lang of ['en', 'cs', 'de'] as Language[]) {
            initLanguage(lang);
            expect(normalizeDateInput('3.4.1880')).toBe('1880-04-03');
            expect(normalizeDateInput('15. 5. 1880')).toBe('1880-05-15');
        }
    });

    it('Czech and German read slashes day-first', () => {
        for (const lang of ['cs', 'de'] as Language[]) {
            initLanguage(lang);
            expect(normalizeDateInput('3/4/1880')).toBe('1880-04-03');
            expect(normalizeDateInput('15/5/1880')).toBe('1880-05-15');
            expect(normalizeDateInput('5/15/1880')).toBeNull();
        }
    });

    it('explicit language overrides the UI language; qualifiers and ranges follow it', () => {
        initLanguage('cs');
        expect(normalizeDateInput('3/4/1880', 'en')).toBe('1880-03-04');
        initLanguage('en');
        expect(normalizeDateInput('3/4/1880', 'cs')).toBe('1880-04-03');
        expect(normalizeDateInput('about 3/4/1880')).toBe('~1880-03-04');
        expect(normalizeDateInput('3/4/1880..3/5/1880')).toBe('1880-03-04..1880-03-05');
        expect(normalizeDateInput('between 3/4/1880 and 1890')).toBe('1880-03-04..1890');
    });

    it('month/year and other forms are unchanged', () => {
        initLanguage('en');
        expect(normalizeDateInput('5/1880')).toBe('1880-05');
        expect(normalizeDateInput('May 15, 1880')).toBe('1880-05-15');
        expect(normalizeDateInput('15 May 1880')).toBe('1880-05-15');
        expect(normalizeDateInput('1880-05-15')).toBe('1880-05-15');
    });
});

describe('edit input round trip in every language', () => {
    // Deterministic sample over the whole calendar: every month, days that
    // are ambiguous (<= 12) and unambiguous (> 12), month ends, leap day.
    const dates: string[] = [];
    const qualifiers: DateQualifier[] = ['', '~', '<', '>'];
    let i = 0;
    for (const year of [1700, 1880, 1900, 1904, 2000, 2024]) {
        for (let month = 1; month <= 12; month++) {
            const last = new Date(year, month, 0).getDate();
            for (const day of [1, 2, month, 12, 13, 28, last]) {
                const q = qualifiers[i++ % qualifiers.length];
                dates.push(toCanonical({ qualifier: q, year, month, day }));
            }
            dates.push(toCanonical({ qualifier: qualifiers[i++ % 4], year, month }));
        }
        dates.push(`${year}`, `~${year}`);
    }
    dates.push('1880..1885', '1880-05-15..1890', '1880-03-04..1880-04-03');

    for (const lang of ['en', 'cs', 'de'] as Language[]) {
        it(`${lang}: formatDateForInput parses back to the same value (${dates.length} dates)`, () => {
            initLanguage(lang);
            for (const canonical of dates) {
                const shown = formatDateForInput(canonical);
                expect(normalizeDateInput(shown), `${lang}: ${canonical} shown as ${shown}`).toBe(canonical);
            }
        });

        it(`${lang}: the displayed exact date parses back when typed into an input`, () => {
            initLanguage(lang);
            for (const canonical of dates) {
                if (canonical.includes('..') || /^[~<>]/.test(canonical)) continue;
                const shown = formatFlexDate(canonical);
                expect(normalizeDateInput(shown), `${lang}: ${canonical} displayed as ${shown}`).toBe(canonical);
            }
        });
    }
});
