import { describe, it, expect, afterEach } from 'vitest';
import { plural, pluralCategory, getStringsForLang, setLanguage, joinAnd } from '../strings.js';
import { formatRelativeDateTime, formatFileSize } from '../format.js';

const COUNTS = [0, 1, 2, 5, 21, 22];

describe('plural categories (Intl.PluralRules)', () => {
    it('Czech has one / few / other', () => {
        expect(COUNTS.map(n => pluralCategory('cs', n))).toEqual(['other', 'one', 'few', 'other', 'other', 'other']);
        expect(COUNTS.map(n => `${n} ${plural('cs', n, 'osoba', 'osoby', 'osob')}`)).toEqual(
            ['0 osob', '1 osoba', '2 osoby', '5 osob', '21 osob', '22 osob']);
    });
    it('English and German have one / other', () => {
        for (const lang of ['en', 'de'] as const) {
            expect(COUNTS.map(n => pluralCategory(lang, n))).toEqual(['other', 'one', 'other', 'other', 'other', 'other']);
        }
    });
});

describe('counted nouns in the UI strings', () => {
    const table: Record<'en' | 'cs' | 'de', Record<string, string[]>> = {
        en: {
            persons: ['0 people', '1 person', '2 people', '5 people', '21 people', '22 people'],
            families: ['0 families', '1 family', '2 families', '5 families', '21 families', '22 families'],
            backups: ['0 backups', '1 backup', '2 backups', '5 backups', '21 backups', '22 backups'],
            results: ['0 results', '1 result', '2 results', '5 results', '21 results', '22 results'],
        },
        cs: {
            persons: ['0 osob', '1 osoba', '2 osoby', '5 osob', '21 osob', '22 osob'],
            families: ['0 rodin', '1 rodina', '2 rodiny', '5 rodin', '21 rodin', '22 rodin'],
            backups: ['0 záloh', '1 záloha', '2 zálohy', '5 záloh', '21 záloh', '22 záloh'],
            results: ['0 výsledků', '1 výsledek', '2 výsledky', '5 výsledků', '21 výsledků', '22 výsledků'],
        },
        de: {
            persons: ['0 Personen', '1 Person', '2 Personen', '5 Personen', '21 Personen', '22 Personen'],
            families: ['0 Familien', '1 Familie', '2 Familien', '5 Familien', '21 Familien', '22 Familien'],
            backups: ['0 Sicherungen', '1 Sicherung', '2 Sicherungen', '5 Sicherungen', '21 Sicherungen', '22 Sicherungen'],
            results: ['0 Ergebnisse', '1 Ergebnis', '2 Ergebnisse', '5 Ergebnisse', '21 Ergebnisse', '22 Ergebnisse'],
        },
    };
    for (const lang of ['en', 'cs', 'de'] as const) {
        it(`${lang}: persons, families, backups, search results`, () => {
            const s = getStringsForLang(lang);
            expect(COUNTS.map(n => s.treeManager.persons(n))).toEqual(table[lang].persons);
            expect(COUNTS.map(n => s.snapshots.persons(n))).toEqual(table[lang].persons);
            expect(COUNTS.map(n => s.treeManager.families(n))).toEqual(table[lang].families);
            expect(COUNTS.map(n => s.snapshots.total(n, ''))).toEqual(table[lang].backups);
            expect(COUNTS.map(n => s.searchFilters.resultCount(n))).toEqual(table[lang].results);
        });
    }
    it('never "1 persons" / "1 backups" in English', () => {
        const s = getStringsForLang('en');
        expect(s.snapshots.total(1, '')).toBe('1 backup');
        expect(s.snapshots.persons(1)).toBe('1 person');
        expect(s.danger.deleteBackupMessage(1)).toContain('1 person.');
    });
    it('sources: citation counts decline too', () => {
        expect(getStringsForLang('cs').danger.sourceCited(1)).toContain('na 1 místě');
        expect(getStringsForLang('cs').danger.sourceCited(5)).toContain('na 5 místech');
        expect(getStringsForLang('en').danger.sourceCited(1)).toContain('in 1 place;');
        expect(getStringsForLang('de').danger.sourceCited(2)).toContain('an 2 Stellen');
    });
});

describe('destructive confirmation texts', () => {
    afterEach(() => setLanguage('en'));
    it('lists the links that go with a person, in each language', () => {
        expect(getStringsForLang('cs').danger.personLinks('female', 2, 1, 0))
            .toBe('Odstraní se i její vazby: 2 rodiče a 1 partner.');
        expect(getStringsForLang('cs').danger.personLinks('male', 0, 2, 5))
            .toBe('Odstraní se i jeho vazby: 2 partneři a 5 dětí.');
        expect(getStringsForLang('en').danger.personLinks('male', 2, 1, 3))
            .toBe('His links are removed too: 2 parents, 1 partner and 3 children.');
        expect(getStringsForLang('de').danger.personLinks('female', 1, 0, 1))
            .toBe('Ihre Verbindungen werden ebenfalls entfernt: 1 Elternteil und 1 Kind.');
        expect(getStringsForLang('en').danger.personLinks('male', 0, 0, 0)).toBe('');
    });
    it('verb labels, never Yes/OK', () => {
        for (const lang of ['en', 'cs', 'de'] as const) {
            const d = getStringsForLang(lang).danger;
            for (const label of [d.deletePerson, d.deleteTree, d.deleteBackup, d.deleteSource]) {
                expect(label).not.toMatch(/^(Yes|OK|Ano|Ja)$/i);
            }
        }
        expect(getStringsForLang('cs').danger.deletePersonTitle('Jan Novák')).toBe('Smazat osobu Jan Novák?');
    });
    it('joins lists with the language\'s "and"', () => {
        expect(joinAnd('cs', ['a1', 'b1', 'c1'])).toBe('a1, b1 a c1');
        expect(joinAnd('de', ['x', 'y'])).toBe('x und y');
        expect(joinAnd('en', ['x'])).toBe('x');
    });
});

describe('relative backup times', () => {
    const now = new Date(2026, 8, 23, 18, 0).getTime();
    it('today / yesterday / older with a date, never seconds', () => {
        expect(formatRelativeDateTime(new Date(2026, 8, 23, 14, 36, 59).getTime(), 'cs', now)).toBe('dnes 14:36');
        expect(formatRelativeDateTime(new Date(2026, 8, 22, 9, 10).getTime(), 'cs', now)).toBe('včera 9:10');
        expect(formatRelativeDateTime(new Date(2026, 6, 20, 14, 36).getTime(), 'cs', now)).toBe('20. 7. 2026 14:36');
        expect(formatRelativeDateTime(new Date(2026, 8, 23, 14, 36).getTime(), 'de', now)).toBe('heute 14:36');
        expect(formatRelativeDateTime(new Date(2026, 8, 22, 9, 10).getTime(), 'de', now)).toMatch(/^gestern 0?9:10$/);
        expect(formatRelativeDateTime(new Date(2026, 8, 23, 14, 36).getTime(), 'en', now)).toMatch(/^today 2:36\sPM$/);
        expect(formatRelativeDateTime(new Date(2026, 6, 20, 14, 36).getTime(), 'en', now)).toMatch(/^7\/20\/2026 2:36\sPM$/);
    });
});

describe('file sizes', () => {
    it('only from 1 MB, rounded, with the language\'s decimal mark', () => {
        expect(formatFileSize(0, 'cs')).toBe('');
        expect(formatFileSize(900 * 1024, 'en')).toBe('');
        expect(formatFileSize(1024 * 1024, 'en')).toBe('1 MB');
        expect(formatFileSize(1.43 * 1024 * 1024, 'cs')).toBe('1,4 MB');
        expect(formatFileSize(1.43 * 1024 * 1024, 'en')).toBe('1.4 MB');
        expect(formatFileSize(12.6 * 1024 * 1024, 'de')).toBe('13 MB');
    });
});
