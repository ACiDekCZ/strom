import { describe, it, expect } from 'vitest';
import { bookReference, entryDateLine, sameBookReference } from '../source-page.js';

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

describe('another entry from the same book: the reference without the entry', () => {
    const cut = (ref: string) => sameBookReference(ref);

    it('leaves out the entry number and its date (cs, en, de, pl)', () => {
        expect(cut('kn. 704, sn. 88, str. 169, 6. zápis (21./22. 2. 1755)')).toEqual({ reference: 'kn. 704, sn. 88, str. 169', whole: false });
        expect(cut('kn. 704, sn. 88, str. 169, zápis č. 6')).toEqual({ reference: 'kn. 704, sn. 88, str. 169', whole: false });
        expect(cut('Register 12, image 88, p. 169, entry 6 (21/22 Feb 1755)')).toEqual({ reference: 'Register 12, image 88, p. 169', whole: false });
        expect(cut('Register 12, p. 169, 6th entry')).toEqual({ reference: 'Register 12, p. 169', whole: false });
        expect(cut('Taufbuch 3, Bild 88, S. 169, 6. Eintrag (21./22. 2. 1755)')).toEqual({ reference: 'Taufbuch 3, Bild 88, S. 169', whole: false });
        expect(cut('Taufbuch 3, S. 169, Eintrag Nr. 6')).toEqual({ reference: 'Taufbuch 3, S. 169', whole: false });
        expect(cut('Księga 3, skan 88, s. 169, wpis 6 (21/22.02.1755)')).toEqual({ reference: 'Księga 3, skan 88, s. 169', whole: false });
        expect(cut('Księga 3, s. 169, 2. wpis')).toEqual({ reference: 'Księga 3, s. 169', whole: false });
        expect(cut('pag. 228, 2. zápis')).toEqual({ reference: 'pag. 228', whole: false });
    });

    it('keeps the book after the entry, its separators and a bracket with a comma', () => {
        expect(cut('kn. 704, 6. zápis, sn. 88')).toEqual({ reference: 'kn. 704, sn. 88', whole: false });
        expect(cut('kn. 704; str. 169; 6. zápis; 21. 2. 1755')).toEqual({ reference: 'kn. 704; str. 169', whole: false });
        expect(cut('kn. Velkohrádek 12, oddaní fol. 31 (sn. 64, pravá), 1. zápis května (3. na straně)'))
            .toEqual({ reference: 'kn. Velkohrádek 12, oddaní fol. 31 (sn. 64, pravá)', whole: false });
        // An entry written in decomposed letters (NFD) is recognized too.
        expect(cut('kn. 704, 6. zápis'.normalize('NFD'))).toEqual({ reference: 'kn. 704', whole: false });
    });

    it('a shape not recognized stays whole, to be checked by hand', () => {
        expect(cut('Týnec 17')).toEqual({ reference: 'Týnec 17', whole: true });
        expect(cut('kn. 704 str. 169 šestý zápis')).toEqual({ reference: 'kn. 704 str. 169 šestý zápis', whole: true });
        expect(cut('Zápisy 1750–1760, str. 3')).toEqual({ reference: 'Zápisy 1750–1760, str. 3', whole: true });
        expect(cut('Matrika N 1784–1820, fol. 12v')).toEqual({ reference: 'Matrika N 1784–1820, fol. 12v', whole: true });
        // Only the entry: nothing of the book would stay.
        expect(cut('6. zápis (21. 2. 1755)')).toEqual({ reference: '6. zápis (21. 2. 1755)', whole: true });
        expect(cut('')).toEqual({ reference: '', whole: true });
    });
});
