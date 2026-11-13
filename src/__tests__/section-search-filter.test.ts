import { describe, it, expect } from 'vitest';
import {
    chipCount, searchIndex, searchSection, sectionPartOpen, selectedOutside, sheetOverKeyboard, toggleSectionPart,
} from '../section-search-filter';
import { foldSearch2, idNumber, tokenize, type SearchDoc } from '../section-search-match';

/** Invented items of Awaiting action (the Hrotkovi of Olšinky). */
interface Item { id: string; what: string; kind: 'images' | 'letter' | 'decide'; person?: string; name?: string; place: string }
const ITEMS: Item[] = [
    { id: 'T0815', what: 'Uložit snímky matriky Olšinky 1841', kind: 'images', person: 'P0012', name: 'Albín Hrotek', place: 'Archiv Olšinky' },
    { id: 'T0816', what: 'Uložit snímky matriky Białe Pole', kind: 'images', place: 'Archiv Olšinky' },
    { id: 'T0817', what: 'Napsat faře o křest', kind: 'letter', person: 'P0047', name: 'Rozálie Hrotková', place: 'Pfarramt Großhof' },
    { id: 'T0818', what: 'Napsat úřadu o sňatek', kind: 'letter', place: 'MěÚ Lhota' },
    { id: 'H0022', what: 'Kdo byl otec Rozálie?', kind: 'decide', person: 'P0047', name: 'Rozálie Hrotková', place: 'Rozhodnutí' },
];
const docOf = (it: Item): SearchDoc => ({
    hay: foldSearch2([it.what, it.name, it.person, it.id, it.place].filter(Boolean).join(' ')),
    pn: idNumber(it.person),
    tn: it.id.startsWith('T') ? idNumber(it.id) : undefined,
    hn: it.id.startsWith('H') ? idNumber(it.id) : undefined,
});
const kindOf = (it: Item) => it.kind;
const ids = (xs: Item[]) => xs.map(x => x.id);

describe('searchIndex', () => {
    it('is built once per list of items and stamp, again when either changes', () => {
        let built = 0;
        const doc = (it: Item) => { built++; return docOf(it); };
        const a = searchIndex(null, ITEMS, ['cs'], doc);
        expect(built).toBe(ITEMS.length);
        // Typing (the same items): the same index, nothing built.
        expect(searchIndex(a, ITEMS, ['cs'], doc)).toBe(a);
        expect(built).toBe(ITEMS.length);
        // New data (a new list from the bridge) or another language: built anew.
        const b = searchIndex(a, [...ITEMS], ['cs'], doc);
        expect(b).not.toBe(a);
        const c = searchIndex(b, b.items, ['en'], doc);
        expect(c).not.toBe(b);
        expect(built).toBe(ITEMS.length * 3);
        expect(c.docs).toHaveLength(ITEMS.length);
    });
});

describe('searchSection', () => {
    const index = searchIndex(null, ITEMS, [], docOf);

    it('without words: everything found, the chip narrows, no search shown', () => {
        const res = searchSection(index, tokenize(''), kindOf, 'images');
        expect(res.searching).toBe(false);
        expect(res.matched).toHaveLength(5);
        expect(ids(res.shown)).toEqual(['T0815', 'T0816']);
        expect(res.total).toBe(2);
        // A chip says its own count while nothing is searched.
        expect(chipCount(res, 'letter', 2)).toBe(2);
    });

    it('text: every word, in any order; the counts of the chips are what was found', () => {
        const res = searchSection(index, tokenize('hrotkova'), kindOf, 'all');
        expect(res.searching).toBe(true);
        expect(ids(res.matched)).toEqual(['T0817', 'H0022']);
        expect(chipCount(res, 'all', 5)).toBe(2);
        expect(chipCount(res, 'letter', 2)).toBe(1);
        expect(chipCount(res, 'decide', 1)).toBe(1);
        // A kind with nothing found: 0 (its chip stays, dashed).
        expect(chipCount(res, 'images', 2)).toBe(0);
        expect(res.hits.get(ITEMS[2])).toEqual({});
        expect(ids(searchSection(index, tokenize('otec rozalie'), kindOf, 'all').matched)).toEqual(['H0022']);
        expect(searchSection(index, tokenize('otec albin'), kindOf, 'all').matched).toHaveLength(0);
    });

    it('ß ł spelled out, the last letter forgiven', () => {
        expect(ids(searchSection(index, tokenize('grosshof'), kindOf, 'all').matched)).toEqual(['T0817']);
        expect(ids(searchSection(index, tokenize('bialy'), kindOf, 'all').matched)).toEqual(['T0816']);
    });

    it('numbers: P by value with its hit, T and a bare number as a task, H, a year as text', () => {
        const p = searchSection(index, tokenize('P47'), kindOf, 'all');
        expect(ids(p.matched)).toEqual(['T0817', 'H0022']);
        expect(p.hits.get(ITEMS[2])).toEqual({ p: 1 });
        const t = searchSection(index, tokenize('815'), kindOf, 'all');
        expect(ids(t.matched)).toEqual(['T0815']);
        expect(t.hits.get(ITEMS[0])).toEqual({ t: 1 });
        expect(ids(searchSection(index, tokenize('t0815'), kindOf, 'all').matched)).toEqual(['T0815']);
        const h = searchSection(index, tokenize('H22'), kindOf, 'all');
        expect(h.hits.get(ITEMS[4])).toEqual({ h: 1 });
        expect(ids(searchSection(index, tokenize('1841'), kindOf, 'all').matched)).toEqual(['T0815']);
    });

    it('under a kind: shown and m are the kind\'s, the counts of the others stay', () => {
        const res = searchSection(index, tokenize('olsinky'), kindOf, 'letter');
        expect(ids(res.matched)).toEqual(['T0815', 'T0816']);
        expect(res.shown).toHaveLength(0);
        expect(res.total).toBe(2);
        expect(chipCount(res, 'images', 2)).toBe(2);
        expect(chipCount(res, 'letter', 2)).toBe(0);
    });
});

describe('phases and groups while searching', () => {
    it('open while searching unless folded during the search; the hand-made state comes back when cleared', () => {
        const manual = new Map<string, boolean>([['phase:sent', true], ['group:todo:a', false]]);
        const searchOpen = new Map<string, boolean>();
        // Not searching: by hand, else the default.
        expect(sectionPartOpen('phase:todo', true, false, manual, searchOpen)).toBe(true);
        expect(sectionPartOpen('phase:sent', false, false, manual, searchOpen)).toBe(true);
        expect(sectionPartOpen('group:todo:a', true, false, manual, searchOpen)).toBe(false);
        expect(sectionPartOpen('group:todo:b', false, false, manual, searchOpen)).toBe(false);
        // Searching: every one with a match open, whatever was chosen by hand.
        expect(sectionPartOpen('group:todo:a', false, true, manual, searchOpen)).toBe(true);
        expect(sectionPartOpen('group:todo:b', false, true, manual, searchOpen)).toBe(true);
        // A click while searching folds it for the search only.
        toggleSectionPart('group:todo:b', true, true, manual, searchOpen);
        expect(sectionPartOpen('group:todo:b', false, true, manual, searchOpen)).toBe(false);
        expect(manual.has('group:todo:b')).toBe(false);
        // Cleared (the field empties its map): the hand-made state as before.
        searchOpen.clear();
        expect(sectionPartOpen('group:todo:a', true, false, manual, searchOpen)).toBe(false);
        expect(sectionPartOpen('phase:sent', false, false, manual, searchOpen)).toBe(true);
        // A click without a search lasts.
        toggleSectionPart('group:todo:b', false, false, manual, searchOpen);
        expect(manual.get('group:todo:b')).toBe(true);
        // No field (never shown): by hand.
        expect(sectionPartOpen('phase:todo', true, false, manual, null)).toBe(true);
    });
});

describe('selectedOutside', () => {
    it('the picked ones the search does not show, in their order', () => {
        expect(selectedOutside(['H0001', 'H0002', 'H0003'], new Set(['H0002']))).toEqual(['H0001', 'H0003']);
        expect(selectedOutside(new Set(['H0002']), new Set(['H0002']))).toEqual([]);
    });
});

describe('sheetOverKeyboard', () => {
    it('as high as what is visible above the keyboard, else its own size', () => {
        expect(sheetOverKeyboard({ height: 844, offsetTop: 0 }, 844)).toBeNull();
        expect(sheetOverKeyboard({ height: 843.5, offsetTop: 0 }, 844)).toBeNull();
        expect(sheetOverKeyboard({ height: 508.4, offsetTop: 0 }, 844)).toEqual({ top: 0, height: 508 });
        // iOS: the page scrolled under the keyboard.
        expect(sheetOverKeyboard({ height: 500, offsetTop: 120.6 }, 844)).toEqual({ top: 121, height: 500 });
        expect(sheetOverKeyboard(null, 844)).toBeNull();
        expect(sheetOverKeyboard({ height: 0, offsetTop: 0 }, 844)).toBeNull();
    });
});
