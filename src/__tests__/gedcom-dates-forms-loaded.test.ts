/**
 * Person / Partnership `gedcomDates` come back from saved trees and shared
 * files: only a valid one-line GEDCOM date form is ever written back. A
 * crafted value (a line break carrying whole records, an '@' pointer, any
 * other text) is dropped on load, and the export writes the date in its own
 * form even when such a value reaches it.
 *
 * The family (Lhoták of Čapkov) is invented.
 */

import { describe, it, expect } from 'vitest';
import { exportToGedcom, formatGedcomDate } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { isGedcomDateForm, isGedcomDateFormOf, sanitizeGedcomDates } from '../gedcom-date-form.js';
import { StromData } from '../types.js';

const RESEARCH = { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } };

function crafted(): unknown {
    return {
        persons: {
            p1: {
                id: 'p1', firstName: 'Matěj', lastName: 'Lhoták', gender: 'male',
                birthDate: '1850', deathDate: '~1910',
                gedcomDates: {
                    '1850': '1850\n0 @X1@ INDI\n1 NAME Podvrh /X/',
                    '~1910': 'CAL 1910',
                    '1860': '@X2@',
                    '1870': 'kdysi',
                    '1880': 42,
                },
                partnerships: ['u1'], childIds: [], parentIds: [],
            },
            p2: {
                id: 'p2', firstName: 'Anna', lastName: 'Lhotáková', gender: 'female',
                partnerships: ['u1'], childIds: [], parentIds: [],
                gedcomDates: 'EST 1990',
            },
        },
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: [], status: 'married',
                startDate: '1875',
                gedcomDates: { '1875': 'ABT 1875\r\n0 @X3@ FAM' },
            },
        },
    };
}

/** The DATE lines of an export and whether any crafted record got in. */
function dateLines(data: StromData, withResearch: boolean): { dates: string[]; injected: boolean } {
    const ged = exportToGedcom(data, 'T', withResearch ? RESEARCH : undefined).content;
    const lines = ged.split(/\r?\n/);
    return {
        dates: lines.filter(l => / DATE /.test(l)).map(l => l.trim()),
        injected: lines.some(l => /@X\d@|Podvrh/.test(l)),
    };
}

describe('gedcomDates from loaded data', () => {
    it('keeps only valid one-line date forms on load', () => {
        const data = migrateData(crafted());
        expect(data.persons['p1' as never].gedcomDates).toEqual({ '~1910': 'CAL 1910' });
        expect(data.persons['p2' as never].gedcomDates).toBeUndefined();
        expect(data.partnerships['u1' as never].gedcomDates).toBeUndefined();
    });

    for (const withResearch of [true, false]) {
        it(`export ${withResearch ? 'to the research' : 'as plain GEDCOM'} writes only valid DATE lines`, () => {
            const { dates, injected } = dateLines(migrateData(crafted()), withResearch);
            expect(injected).toBe(false);
            expect(dates).toContain('2 DATE 1850');
            expect(dates).toContain('2 DATE CAL 1910');
            expect(dates).toContain('2 DATE 1875');
        });
    }

    it('export ignores a crafted form that bypassed loading', () => {
        // Data handed to the exporter without migrateData (e.g. a merge of a shared file).
        const data = crafted() as StromData;
        const { dates, injected } = dateLines(data, true);
        expect(injected).toBe(false);
        expect(dates).toContain('2 DATE 1850');
        expect(dates).toContain('2 DATE 1875');
    });

    it('formatGedcomDate uses a kept form only when it is one', () => {
        expect(formatGedcomDate('1850', { '1850': '1850\n0 @X1@ INDI' })).toBe('1850');
        expect(formatGedcomDate('1850', { '1850': '@X1@' })).toBe('1850');
        expect(formatGedcomDate('1850', { '1850': 'kdysi' })).toBe('1850');
        expect(formatGedcomDate('~1838', { '~1838': 'CAL 1838' })).toBe('CAL 1838');
        expect(formatGedcomDate('1699-03-03', { '1699-03-03': '3 MAR 1699/00' })).toBe('3 MAR 1699/00');
    });

    it('isGedcomDateForm / sanitizeGedcomDates', () => {
        expect(isGedcomDateForm('FROM 22 MAR 1871 TO 1882')).toBe(true);
        expect(isGedcomDateForm('BET 1850 AND 1860')).toBe(true);
        expect(isGedcomDateForm('INT 1900')).toBe(true);
        expect(isGedcomDateForm('1850 ')).toBe(false);
        expect(isGedcomDateForm('1850\n')).toBe(false);
        expect(isGedcomDateForm(1850)).toBe(false);
        expect(sanitizeGedcomDates(['CAL 1850'])).toBeUndefined();
        expect(sanitizeGedcomDates(null)).toBeUndefined();
        expect(sanitizeGedcomDates({ '': 'CAL 1850', '~1850': 'CAL 1850' })).toEqual({ '~1850': 'CAL 1850' });
    });

    describe('a valid form of another date', () => {
        /** Valid one-line forms, but each pair here either reads as its own date or not. */
        function foreignForms(): unknown {
            return {
                persons: {
                    p1: {
                        id: 'p1', firstName: 'Matěj', lastName: 'Lhoták', gender: 'male',
                        birthDate: '1850', deathDate: '~1910',
                        gedcomDates: { '1850': 'ABT 1999', '~1910': 'CAL 1910' },
                        partnerships: ['u1'], childIds: [], parentIds: [],
                    },
                    p2: {
                        id: 'p2', firstName: 'Anna', lastName: 'Lhotáková', gender: 'female',
                        birthDate: '1852-03-03',
                        gedcomDates: { '1852-03-03': '3 MAR 1853' },
                        partnerships: ['u1'], childIds: [], parentIds: [],
                    },
                },
                partnerships: {
                    u1: {
                        id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: [], status: 'divorced',
                        startDate: '~1875', endDate: '1880',
                        gedcomDates: { '~1875': 'EST 1875', '1880': 'BEF 1880' },
                    },
                },
            };
        }

        it('is dropped on load, a form of its own date stays', () => {
            const data = migrateData(foreignForms());
            expect(data.persons['p1' as never].gedcomDates).toEqual({ '~1910': 'CAL 1910' });
            expect(data.persons['p2' as never].gedcomDates).toBeUndefined();
            expect(data.partnerships['u1' as never].gedcomDates).toEqual({ '~1875': 'EST 1875' });
        });

        for (const loaded of [true, false]) {
            it(`is not exported in place of the date (${loaded ? 'loaded' : 'not through loading'})`, () => {
                const data = (loaded ? migrateData(foreignForms()) : foreignForms()) as StromData;
                const { dates } = dateLines(data, true);
                expect(dates).toContain('2 DATE 1850');
                expect(dates).toContain('2 DATE 3 MAR 1852');
                expect(dates).toContain('2 DATE 1880');
                expect(dates).toContain('2 DATE CAL 1910');
                expect(dates).toContain('2 DATE EST 1875');
                expect(dates.join('\n')).not.toMatch(/1999|1853|BEF 1880/);
            });
        }

        it('isGedcomDateFormOf reads the form back with the import reader', () => {
            expect(isGedcomDateFormOf('~1850', 'ABT 1850')).toBe(true);
            expect(isGedcomDateFormOf('~1850', 'INT 1850')).toBe(true);
            expect(isGedcomDateFormOf('1850..1860', 'BET 1850 AND 1860')).toBe(true);
            expect(isGedcomDateFormOf('1871-03-22/1882', 'FROM 22 MAR 1871 TO 1882')).toBe(true);
            expect(isGedcomDateFormOf('1850', 'ABT 1999')).toBe(false);
            expect(isGedcomDateFormOf('1850', 'ABT 1850')).toBe(false);
            expect(isGedcomDateFormOf('1850', '1850\n0 @X1@ INDI')).toBe(false);
        });
    });
});
