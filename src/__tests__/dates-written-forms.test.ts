/**
 * Dates written the way people write them (tester T42): "Asi 1850",
 * "Mezi 1850-1852", "Cca 3-4/1850", "Cca 14/6/1850" … read in the date field,
 * in a GEDCOM import and as text already in the data (shown, sorted, aged and
 * exported as the date they say, the text itself unchanged). Forms GEDCOM has
 * no word for ("Cca po 1850", "1850?", "18XX", "Q4/1850", "… nebo …") and
 * impossible dates stay text.
 *
 * Every value here is invented; the forms follow the tester's.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    normalizeDateInput, parseFlexDate, formatFlexDate, flexDateParts, dateSortKey, canonicalDate,
    formatDateForInput, ageReached, toCanonical, readWrittenDate,
} from '../dates.js';
import { parseGedcomDate, gedcomDatePhrase } from '../ged-parser.js';
import { exportToGedcom, formatGedcomDate } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { dateNumber } from '../ui/table-view/table-model.js';
import { setLanguage } from '../strings.js';

afterEach(() => setLanguage('en'));

/** Written form → the date it says (day first, as written in Czech). */
const READ: [string, string][] = [
    ['Asi 1850', '~1850'], ['ASI 1850', '~1850'], ['asi. 1850', '~1850'], ['Cca. 1850', '~1850'],
    ['ca 1850', '~1850'], ['Okolo 1850', '~1850'], ['Po roce 1850', '>1850'],
    ['Asi 3/1850', '~1850-03'], ['Asi 14/6/1850', '~1850-06-14'], ['Asi 14/11/1850', '~1850-11-14'],
    ['Cca 7/8/1850', '~1850-08-07'], ['Před 6/3/1850', '<1850-03-06'], ['Po 14/11/1850', '>1850-11-14'],
    ['Před 6.3.1850', '<1850-03-06'], ['14/6/1850', '1850-06-14'],
    ['Mezi 1850-1852', '1850..1852'], ['Mezi 1850 - 1852', '1850..1852'], ['mezi 1850–1852', '1850..1852'],
    ['Mezi 3/1850-5/1851', '1850-03..1851-05'], ['Mezi 1850-11/1851', '1850..1851-11'],
    ['Mezi 11/1850-3/1851', '1850-11..1851-03'], ['Mezi 14/6/1850-20/12/1851', '1850-06-14..1851-12-20'],
    ['1850-1852', '1850..1852'], ['5-7/1850', '1850-05..1850-07'],
    ['Cca 1850-1852', '1850..1852'], ['Asi 1850-1852', '1850..1852'], ['Asi mezi 1850-1852', '1850..1852'],
    ['Cca 3-4/1850', '1850-03..1850-04'], ['Cca 14-15/6/1850', '1850-06-14..1850-06-15'],
    ['Cca 1850-14/6/1851', '1850..1851-06-14'], ['Cca 1850-6/1851', '1850..1851-06'],
    ['Cca 11/1850-2/1851', '1850-11..1851-02'],
];

/** Forms with no GEDCOM equivalent, and impossible dates: never a date. */
const KEPT = [
    'Cca 1850/1851', 'Po 1850/1851', 'Před 1850/1851', 'Cca 1850/1851/1852', 'Cca po 1850/1851',
    'Cca po 1850', 'Cca před 1850', 'Asi po 1850', 'Před cca 1850', 'Možná 3/4/1850',
    'Cca 1850?', '1850?', 'Cca 14/6/1850?', 'Cca 14/6/18XX', 'Cca 4/3/18XX', 'Cca Q4/1850', 'Cca podzim 1850',
    '14/6/1850 nebo 14/11/1850', '14(15)/6/1850',
    'N/A', 'N/A?', 'Viz partner', 'Nehledám', 'Není online',
    '31/4/1850', '31/11/1850', '2/2/18500', '1852-1850', 'Mezi 1852-1850', 'Cca 1850-52',
];

describe('the date field reads written forms (T42)', () => {
    it('reads about, before, after and ranges as GEDCOM has them', () => {
        for (const [text, date] of READ) expect(normalizeDateInput(text, 'cs'), text).toBe(date);
    });

    it('keeps forms GEDCOM has no word for, and impossible dates, unread', () => {
        for (const text of KEPT) expect(normalizeDateInput(text, 'cs'), text).toBeNull();
    });

    it('reads the same words in English, German and Polish, and keeps their old forms', () => {
        for (const [text, lang, date] of [
            ['between 1850 - 1852', 'en', '1850..1852'], ['about 1850-1852', 'en', '1850..1852'],
            ['circa 1850', 'en', '~1850'], ['abt 1850', 'en', '~1850'], ['bef 1850', 'en', '<1850'],
            ['zwischen 1850-1852', 'de', '1850..1852'], ['um 1850-1852', 'de', '1850..1852'],
            ['etwa 1850', 'de', '~1850'], ['vor 1850', 'de', '<1850'], ['nach 14/6/1850', 'de', '>1850-06-14'],
            ['między 1850-1852', 'pl', '1850..1852'], ['około 1850', 'pl', '~1850'], ['przed 1850', 'pl', '<1850'],
            ['po 1850', 'pl', '>1850'], ['zwischen 1850 und 1852', 'de', '1850..1852'], ['między 1850 a 1852', 'pl', '1850..1852'],
            ['od 1850 do 1852', 'cs', '1850/1852'], ['od 1850', 'cs', '>1850'], ['1880-5', 'cs', '1880-05'],
            ['1880-05-15', 'en', '1880-05-15'], ['5/15/1880', 'en', '1880-05-15'], ['1880..1885', 'cs', '1880..1885'],
        ] as const) {
            expect(normalizeDateInput(text, lang), `${lang} ${text}`).toBe(date);
        }
        expect(normalizeDateInput('1880..1885..1890', 'cs')).toBeNull();
    });
});

describe('a GEDCOM import reads written forms (T42)', () => {
    it('reads them as the date field does', () => {
        setLanguage('cs');
        for (const [text, date] of READ) expect(parseGedcomDate(text), text).toBe(date);
    });

    it('a range was read as one year before: "Mezi 1850 - 1852" is no "about 1852"', () => {
        expect(parseGedcomDate('Mezi 1850 - 1852')).toBe('1850..1852');
        expect(gedcomDatePhrase('Mezi 1850 - 1852')).toBeNull();
    });

    it('keeps the text as written when the reading took a choice', () => {
        setLanguage('cs');
        // "cca" left out of a range; day and month that could swap.
        for (const text of ['Cca 1850-1852', 'Asi mezi 1850-1852', 'Cca 3-4/1850', 'Cca 7/8/1850', 'Před 6/3/1850']) {
            expect(gedcomDatePhrase(text), text).toBe(text);
        }
        // Nothing left out, one order only.
        for (const text of ['Mezi 1850-1852', 'Asi 14/6/1850', 'Cca 3/1850', 'Mezi 14/6/1850-20/12/1851', 'Po 14/11/1850']) {
            expect(gedcomDatePhrase(text), text).toBeNull();
        }
        // In English the swappable date reads month first, the way the field reads it.
        setLanguage('en');
        expect(parseGedcomDate('Cca 7/8/1850')).toBe('~1850-07-08');
        expect(gedcomDatePhrase('Cca 7/8/1850')).toBe('Cca 7/8/1850');
    });

    it('leaves forms with no GEDCOM equivalent and impossible dates to the note', () => {
        setLanguage('cs');
        for (const text of ['Cca 1850/1851', 'Cca 1850?', '1850?', 'Cca 14/6/18XX', 'Cca Q4/1850', '14/6/1850 nebo 14/11/1850',
            '14(15)/6/1850', 'N/A', 'Viz partner', '31/4/1850', '31/11/1850', '2/2/18500', 'Mezi 1852-1850']) {
            expect(parseGedcomDate(text), text).toBe('');
            expect(gedcomDatePhrase(text), text).toBe(text);
        }
    });

    it('reads GEDCOM forms as before', () => {
        for (const [text, date] of [
            ['ABT 1850', '~1850'], ['BET 1850 AND 1852', '1850..1852'], ['FROM 1850 TO 1852', '1850/1852'],
            ['14 JUN 1850', '1850-06-14'], ['1699/00', '1699'], ['BEF JUN 1850', '<1850-06'], ['AFT 1850', '>1850'],
        ]) {
            expect(parseGedcomDate(text), text).toBe(date);
            expect(gedcomDatePhrase(text), text).toBeNull();
        }
        expect(readWrittenDate('ABT 1850')).toBeNull();
        expect(readWrittenDate('14 JUN 1850')).toBeNull();
    });
});

describe('a written date already in the data (T42)', () => {
    it('reads as the date it says, the text unchanged', () => {
        setLanguage('cs');
        expect(toCanonical(parseFlexDate('Cca 5/1850')!)).toBe('~1850-05');
        expect(toCanonical(parseFlexDate('Mezi 1850-1852')!)).toBe('1850..1852');
        expect(canonicalDate('Asi 14/6/1850')).toBe('~1850-06-14');
        expect(canonicalDate('Cca 1850/1851')).toBe('Cca 1850/1851');
        expect(canonicalDate('~1850')).toBe('~1850');
        expect(parseFlexDate('Cca 1850?')).toBeNull();
        expect(parseFlexDate('31/4/1850')).toBeNull();
        // The edit field shows the text as it is.
        expect(formatDateForInput('Cca 5/1850')).toBe('Cca 5/1850');
    });

    it('is shown, sorted and aged as that date', () => {
        setLanguage('cs');
        expect(formatFlexDate('Cca 5/1850', 'cs')).toBe('kolem 5/1850');
        expect(formatFlexDate('Mezi 1850-1852', 'cs')).toBe('mezi 1850 a 1852');
        expect(formatFlexDate('Po roce 1850', 'en')).toBe('after 1850');
        expect(flexDateParts('Asi 14/6/1850', 'cs')).toEqual({ qualifier: '~', main: '14. 6. 1850' });
        expect(flexDateParts('Cca 1850-1852', 'cs')).toEqual({ qualifier: '', main: '1850–1852' });
        // Sorted among canonical dates, not after them as text.
        const sorted = ['1851', 'Po 1850', '1849', 'Mezi 1848-1852'].sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b)));
        expect(sorted).toEqual(['Mezi 1848-1852', '1849', 'Po 1850', '1851']);
        expect(dateNumber('Cca 5/1850')).toBe(18500500);
        expect(dateNumber('Viz partner')).toBeNull();
        // Ages as for the canonical value: an estimate, a range.
        expect(ageReached('1820-03-01', 'Cca 1850')).toEqual(ageReached('1820-03-01', '~1850'));
        expect(ageReached('1820-03-01', 'Cca 1850')?.kind).toBe('about');
        expect(ageReached('1820-03-01', 'Mezi 1850-1852')).toEqual({ kind: 'span', years: 29, max: 32 });
    });

    it('goes out to GEDCOM in GEDCOM words, the data keeping its text', () => {
        setLanguage('cs');
        expect(formatGedcomDate('Cca 5/1850')).toBe('ABT MAY 1850');
        expect(formatGedcomDate('Mezi 1850-1852')).toBe('BET 1850 AND 1852');
        expect(formatGedcomDate('Před 6.3.1850')).toBe('BEF 6 MAR 1850');
        expect(formatGedcomDate('Cca 1850-1852')).toBe('BET 1850 AND 1852');

        const data = migrateData({
            persons: {
                p1: {
                    id: 'p1', firstName: 'Bonifác', lastName: 'Kolomazník', gender: 'male',
                    birthDate: 'Asi 14/6/1820', deathDate: 'Mezi 1850-1852',
                    partnerships: [], childIds: [], parentIds: [],
                },
            },
            partnerships: {},
        });
        const lines = exportToGedcom(data, 'T').content.split(/\r?\n/).filter(l => / DATE /.test(l)).map(l => l.trim());
        expect(lines).toContain('2 DATE ABT 14 JUN 1820');
        expect(lines).toContain('2 DATE BET 1850 AND 1852');
        expect(data.persons['p1' as keyof typeof data.persons].birthDate).toBe('Asi 14/6/1820');
        expect(data.persons['p1' as keyof typeof data.persons].deathDate).toBe('Mezi 1850-1852');
    });
});
