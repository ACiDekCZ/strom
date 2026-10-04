import { describe, it, expect } from 'vitest';
import { bookReference, entryDateLine } from '../source-page.js';

describe('another page of the same book', () => {
    it('keeps the book of a reference, without its page', () => {
        expect(bookReference('Voss, Ministerialbok 1820–1835, s. 112')).toBe('Voss, Ministerialbok 1820–1835, s. ');
        expect(bookReference('Matrika N 1784–1820, fol. 12v')).toBe('Matrika N 1784–1820, fol. ');
        expect(bookReference('Taufbuch 3 Seite 7')).toBe('Taufbuch 3 Seite ');
        expect(bookReference('Register, p. 12–13')).toBe('Register, p. ');
    });

    it('nothing when it is only a page or no page is seen', () => {
        expect(bookReference('s. 113')).toBe('');
        expect(bookReference('Ministerialbok 1820–1835')).toBe('');
        expect(bookReference('')).toBe('');
    });

    it('a line with only a recording date belongs to the entry', () => {
        expect(entryDateLine('Zapsáno: 20 MAR 1825')).toBe(true);
        expect(entryDateLine('Recorded 1825-03-20')).toBe(true);
        expect(entryDateLine('eingetragen am 20. 3. 1825')).toBe(true);
        expect(entryDateLine('Kniha je poškozená, 1825 chybí')).toBe(false);
        expect(entryDateLine('Farní úřad Voss')).toBe(false);
    });
});
