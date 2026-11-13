import { describe, it, expect } from 'vitest';
import { knowsSearchDoc, knowsSearchIndex, knowsSearchSource, type KnowsSearchRow } from '../knows-search';
import { bulkBoxState, searchSection, selectedOutside } from '../section-search-filter';
import { tokenize } from '../section-search-match';

/** Invented rows of What the research knows (the Hrotkovi of Olšinky). */
const ROWS: KnowsSearchRow[] = [
    { key: 'c:p1:X0007', conflict: true, name: 'Albín Hrotek', personRef: 'P0012', words: ['Narození', '3. 2. 1841', '1842'] },
    { key: 'c:p2:X0008', conflict: true, name: 'Rozálie Šeříková', personRef: 'P0047', words: ['Úmrtí', '1890', '1891'] },
    { key: 'h:p2:H0022', conflict: false, name: 'Rozálie Šeříková', personRef: 'P0047', words: ['Otec je Kvido Šeřík'], hypoId: 'H0022' },
    { key: 'h:p3:H0031', conflict: false, name: 'Vendelín Hrotek', personRef: 'P0003', words: ['Byli manželé?'], hypoId: 'H0031' },
    { key: 'h:p4:H0040', conflict: false, name: 'Ludmila Šeříková', personRef: null, words: ['Dcera Kvida Šeříka'], hypoId: 'H0040' },
];
const kindOf = (key: string) => key.startsWith('c:') ? 'con' as const : 'hyp' as const;
const find = (q: string, chip: 'all' | 'con' | 'hyp' = 'all') =>
    searchSection(knowsSearchIndex(null, ROWS, 'cs').index, tokenize(q), kindOf, chip);

describe('the search of What the research knows', () => {
    it('a conflict is searched by its person, its fact and its values; a hypothesis by its person, title and H…', () => {
        expect(knowsSearchSource(ROWS[0])).toBe('Albín Hrotek P0012 Narození 3. 2. 1841 1842');
        expect(knowsSearchSource(ROWS[2])).toBe('Rozálie Šeříková P0047 Otec je Kvido Šeřík H0022');
        expect(knowsSearchDoc(ROWS[0])).toEqual({ hay: 'albin hrotek p0012 narozeni 3. 2. 1841 1842', pn: 12 });
        expect(knowsSearchDoc(ROWS[2])).toMatchObject({ pn: 47, hn: 22 });
        // A conflict has no hypothesis's number; a person without a P… none either.
        expect(knowsSearchDoc(ROWS[0]).hn).toBeUndefined();
        expect(knowsSearchDoc(ROWS[4]).pn).toBeUndefined();
    });

    it('a year of a conflict\'s value is found as text; a bare number is no hypothesis\'s unless one has it', () => {
        expect(find('1841').matched).toEqual(['c:p1:X0007']);
        expect(find('22').matched).toEqual(['h:p2:H0022']);
        expect(find('22').hits.get('h:p2:H0022')).toEqual({ h: 1 });
    });

    it('P… and H… by their value, every word in any order, the last letter forgiven', () => {
        expect(find('P47').matched).toEqual(['c:p2:X0008', 'h:p2:H0022']);
        expect(find('p0047').hits.get('c:p2:X0008')).toEqual({ p: 1 });
        expect(find('H22').matched).toEqual(['h:p2:H0022']);
        expect(find('otec serikova').matched).toEqual(['h:p2:H0022']);
        expect(find('serikovy').matched).toEqual(['c:p2:X0008', 'h:p2:H0022', 'h:p4:H0040']);
    });

    it('the chips count what was found of each kind; "H22" under Conflicts finds nothing there, Hypotheses 1', () => {
        const res = find('H22', 'con');
        expect(res.shown).toEqual([]);
        expect(res.total).toBe(2);
        expect(res.counts.get('hyp')).toBe(1);
        expect(res.counts.get('con')).toBeUndefined();
    });

    it('the index stays while the rows say the same (typing, a redraw), built anew when they change or the language does', () => {
        const a = knowsSearchIndex(null, ROWS, 'cs');
        // A redraw makes new row objects saying the same: the same index.
        expect(knowsSearchIndex(a, ROWS.map(r => ({ ...r })), 'cs').index).toBe(a.index);
        // A conflict decided: its row gone, built anew.
        const b = knowsSearchIndex(a, ROWS.slice(1), 'cs');
        expect(b.index).not.toBe(a.index);
        expect(b.index.items).toEqual(ROWS.slice(1).map(r => r.key));
        // A name changed: anew.
        const renamed = ROWS.map((r, i) => i === 3 ? { ...r, name: 'Vendelín Hrotík' } : r);
        expect(knowsSearchIndex(a, renamed, 'cs').index).not.toBe(a.index);
        // Another language: anew, with the same keys.
        const en = knowsSearchIndex(a, ROWS, 'en');
        expect(en.index).not.toBe(a.index);
        expect(en.index.items).toBe(a.index.items);
    });
});

describe('the bulk head while searching', () => {
    it('its box is empty, – or ✓ over the found ones with a proposal only', () => {
        const found = ['H0022', 'H0031', 'H0040'];
        expect(bulkBoxState(found, new Set())).toBe('none');
        // Picked ones outside the search do not count.
        expect(bulkBoxState(found, new Set(['H0090', 'H0091']))).toBe('none');
        expect(bulkBoxState(found, new Set(['H0022', 'H0090']))).toBe('some');
        expect(bulkBoxState(found, new Set([...found, 'H0090']))).toBe('all');
        expect(bulkBoxState([], new Set(['H0022']))).toBe('none');
    });

    it('the picked ones outside the search stay picked and are told apart', () => {
        const picked = new Set(['H0022', 'H0031', 'H0090', 'H0091']);
        expect(selectedOutside(picked, new Set(['H0022', 'H0031', 'H0040']))).toEqual(['H0090', 'H0091']);
        // Nothing found: every picked one is outside.
        expect(selectedOutside(picked, new Set())).toHaveLength(4);
    });
});
