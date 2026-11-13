import { describe, it, expect } from 'vitest';
import { fieldVisible, foldSearch2, idNumber, matchDoc, tokenize, type SearchDoc } from '../section-search-match.js';
import { csZ, getStringsForLang, type Language } from '../strings.js';

const doc = (text: string, nums: Omit<SearchDoc, 'hay'> = {}): SearchDoc => ({ hay: foldSearch2(text), ...nums });
const finds = (d: SearchDoc, q: string): boolean => matchDoc(d, tokenize(q)) !== null;

describe('foldSearch2', () => {
    it('lowers and drops diacritics, spells out what NFD keeps whole', () => {
        expect(foldSearch2('Olšinky')).toBe('olsinky');
        expect(foldSearch2('Pfarramt Großhof')).toBe('pfarramt grosshof');
        expect(foldSearch2('GROẞHOF')).toBe('grosshof');
        expect(foldSearch2('Białe Pole, Łódź')).toBe('biale pole, lodz');
        expect(foldSearch2('Đurić Søren Æbelø Œuvre')).toBe('duric soren aebelo oeuvre');
    });
});

describe('tokenize', () => {
    it('splits at spaces, commas and semicolons into kinds', () => {
        expect(tokenize(' P0047, t815;h22  1841 Hrotek ')).toEqual([
            { k: 'p', n: 47, t: 'p0047' },
            { k: 't', n: 815, t: 't815' },
            { k: 'h', n: 22, t: 'h22' },
            { k: 'n', n: 1841, t: '1841' },
            { k: 's', t: 'hrotek' },
        ]);
    });
    it('an empty query or only separators has no words', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize(' ,; ,')).toEqual([]);
    });
    it('a word with letters after a number is text', () => {
        expect(tokenize('p47a')).toEqual([{ k: 's', t: 'p47a' }]);
    });
});

describe('matchDoc', () => {
    const biale = doc('Snímek matriky · Białe Pole · fara');
    const grosshof = doc('Dotaz do archivu Pfarramt Großhof', { pn: 12 });
    const p47 = doc('Albín Hrotek P0047', { pn: 47 });
    const p470 = doc('Marie Hrotková P0470', { pn: 470 });
    const p1047 = doc('Josef Fialka P1047', { pn: 1047 });
    const t815 = doc('Přečíst matriku T0815', { tn: 815 });
    const fialkova = doc('Anna Fialková · otec neznámý', { pn: 3 });
    const fialkovaOnly = doc('Anna Fialková · matka', { pn: 4 });
    const conflict = doc('Josef Hrotek P0012 · narození · 1841 · 1842', { pn: 12 });
    const h22 = doc('Hypotéza H0022 Albín je syn Josefa', { hn: 22, pn: 47 });
    const h220 = doc('Hypotéza H0220', { hn: 220 });
    const olsinky = doc('Fara Olšinky · Olšinek');

    it('no words: everything matches, nothing by its number', () => {
        expect(matchDoc(biale, [])).toEqual({});
        expect(matchDoc(biale, tokenize(' , '))).toEqual({});
    });
    it('a word forgives its last letter from five letters on', () => {
        expect(finds(biale, 'bialy')).toBe(true);
        expect(finds(biale, 'Białe')).toBe(true);
        expect(finds(olsinky, 'olsinkach')).toBe(false);
        // Shorter words must be in the text as typed.
        expect(finds(biale, 'fary')).toBe(false);
        expect(finds(biale, 'fara')).toBe(true);
    });
    it('the tolerance holds only at a word\'s start', () => {
        expect(finds(doc('Nebiale pole'), 'bialy')).toBe(false);
        expect(finds(doc('(Białe) pole'), 'bialy')).toBe(true);
    });
    it('ß, ẞ and ss are one', () => {
        for (const q of ['grosshof', 'Großhof', 'GROSSHOF', 'GROẞHOF']) expect(finds(grosshof, q)).toBe(true);
    });
    it('a person by number: P47 = p0047, only P0047', () => {
        for (const q of ['P47', 'p0047', 'P0047']) {
            expect(matchDoc(p47, tokenize(q))).toEqual({ p: 1 });
            expect(finds(p470, q)).toBe(false);
            expect(finds(p1047, q)).toBe(false);
        }
    });
    it('a task by number: T815, t0815 and a bare 815', () => {
        for (const q of ['T815', 't0815', '815', '0815']) expect(matchDoc(t815, tokenize(q))).toEqual({ t: 1 });
        expect(finds(p47, 'T815')).toBe(false);
    });
    it('a hypothesis by number: H22, only H0022; a bare number without a task is a hypothesis', () => {
        expect(matchDoc(h22, tokenize('H22'))).toEqual({ h: 1 });
        expect(finds(h220, 'H22')).toBe(false);
        expect(matchDoc(h22, tokenize('22'))).toEqual({ h: 1 });
    });
    it('a bare number neither a task nor a hypothesis is text (a year)', () => {
        expect(matchDoc(conflict, tokenize('1841'))).toEqual({});
        expect(finds(conflict, '1843')).toBe(false);
    });
    it('every word must match, in any order', () => {
        expect(finds(fialkova, 'fialkova otec')).toBe(true);
        expect(finds(fialkova, 'otec fialkova')).toBe(true);
        expect(finds(fialkovaOnly, 'fialkova otec')).toBe(false);
        expect(matchDoc(h22, tokenize('albin H22 P47'))).toEqual({ h: 1, p: 1 });
        expect(finds(h22, 'albin H23')).toBe(false);
    });
    it('commas and semicolons separate words', () => {
        expect(finds(fialkova, 'fialkova,otec')).toBe(true);
        expect(finds(fialkova, 'fialkova;;otec')).toBe(true);
    });
});

describe('idNumber', () => {
    it('reads the number of an id', () => {
        expect(idNumber('P0047')).toBe(47);
        expect(idNumber('T0815')).toBe(815);
        expect(idNumber('H0000')).toBe(0);
        expect(idNumber('X')).toBeUndefined();
        expect(idNumber(null)).toBeUndefined();
    });
});

describe('fieldVisible', () => {
    it('ten items or more, or a text typed', () => {
        expect(fieldVisible(9, '')).toBe(false);
        expect(fieldVisible(10, '')).toBe(true);
        expect(fieldVisible(3, 'h')).toBe(true);
        expect(fieldVisible(0, 'h')).toBe(true);
    });
});

describe('csZ', () => {
    it('"ze" where the number is read with s, z or dv at its start', () => {
        for (const n of [2, 7, 17, 70, 74, 79, 100, 106, 150, 199, 700, 745, 799]) expect(csZ(n)).toBe('ze');
    });
    it('"z" elsewhere', () => {
        for (const n of [0, 1, 3, 14, 20, 27, 69, 80, 99, 200, 300, 699, 800, 1000, 1999]) expect(csZ(n)).toBe('z');
    });
    it('thousands by their leading group', () => {
        expect(csZ(2000)).toBe('ze');
        expect(csZ(7500)).toBe('ze');
        expect(csZ(150_000)).toBe('ze');
        expect(csZ(3000)).toBe('z');
    });
    it('"Found n of m" in Czech takes it', () => {
        const L = getStringsForLang('cs').live;
        expect(L.sectionSearchFound(7, 106)).toBe('Nalezeno 7 ze 106');
        expect(L.sectionSearchFound(3, 14)).toBe('Nalezeno 3 z 14');
        expect(L.sectionSearchFound(12, 300)).toBe('Nalezeno 12 z 300');
        expect(L.sectionSearchFound(1, 7)).toBe('Nalezeno 1 ze 7');
    });
});

describe('the search texts', () => {
    const langs: Language[] = ['cs', 'en', 'de', 'pl'];
    it('exist in four languages', () => {
        for (const lang of langs) {
            const L = getStringsForLang(lang).live;
            for (const t of [L.waitingSearchPlaceholder, L.knowsSearchPlaceholder, L.sectionSearchAllKinds, L.bulkDeselectHidden]) {
                expect(typeof t).toBe('string');
                expect(t.length).toBeGreaterThan(0);
            }
            expect(L.sectionSearchFound(7, 106)).toMatch(/7.*106/);
            expect(L.sectionSearchNoneKind('X')).toContain('X');
            expect(L.bulkSelectFound(4)).toContain('4');
            expect(L.bulkSelectedHidden(6, 2)).toMatch(/6.*2/);
        }
    });
    it('the fields are named after their sections\' titles', () => {
        const pl = getStringsForLang('pl');
        expect(pl.live.waitingSearchAria(pl.research.waiting)).toBe('Szukaj w „Czeka na załatwienie”');
        expect(pl.live.knowsSearchAria(pl.live.knowsTitle)).toBe('Szukaj w „Co wie badanie”');
        const cs = getStringsForLang('cs');
        expect(cs.live.waitingSearchAria(cs.research.waiting)).toBe('Hledat v Čeká na vyřízení');
        expect(cs.live.knowsSearchAria(cs.live.knowsTitle)).toBe('Hledat v Co ví výzkum');
        const en = getStringsForLang('en');
        expect(en.live.waitingSearchAria(en.research.waiting)).toBe('Search Awaiting action');
        expect(en.live.knowsSearchAria(en.live.knowsTitle)).toBe('Search What the research knows');
        const de = getStringsForLang('de');
        expect(de.live.waitingSearchAria(de.research.waiting)).toBe('In „Wartet auf Bearbeitung“ suchen');
        expect(de.live.sectionSearchFound(7, 106)).toBe('7 von 106 gefunden');
        expect(en.live.sectionSearchFound(7, 106)).toBe('Found 7 of 106');
        expect(pl.live.sectionSearchFound(7, 106)).toBe('Znaleziono 7 z 106');
    });
});
