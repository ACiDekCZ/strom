/**
 * Writing out a place search into the forms the geocoder is asked in
 * (spec 034 §6). Fictional places only.
 */

import { describe, it, expect } from 'vitest';
import { expandPlaceQuery, withoutDiacritics, MAX_PLACE_QUERIES } from '../place-query.js';
import { StromData } from '../types.js';

describe('expandPlaceQuery', () => {
    it('the original first, then the abbreviation spelled out, then without diacritics', () => {
        expect(expandPlaceQuery('H. Lhota', 'cs')).toEqual(['H. Lhota', 'Horní Lhota', 'Hořejší Lhota']);
        expect(expandPlaceQuery('Horní Lhota', 'cs')).toEqual(['Horní Lhota', 'Horni Lhota']);
    });

    it('abbreviations of both languages, whatever the UI language', () => {
        expect(expandPlaceQuery('Ob. Lhota', 'en')).toEqual(['Ob. Lhota', 'Ober Lhota']);
        expect(expandPlaceQuery('Nd. Lhota', 'cs')).toEqual(['Nd. Lhota', 'Nieder Lhota']);
        expect(expandPlaceQuery('D. Lhota', 'de')).toEqual(['D. Lhota', 'Dolní Lhota']);
        // "St." is Stará in Czech and Sankt in German: the UI language's first.
        expect(expandPlaceQuery('St. Lhota', 'cs').slice(1, 3)).toEqual(['Stará Lhota', 'Sankt Lhota']);
        expect(expandPlaceQuery('St. Lhota', 'de').slice(1, 3)).toEqual(['Sankt Lhota', 'Stará Lhota']);
    });

    it('a phrase written short and an abbreviation without a space', () => {
        expect(expandPlaceQuery('Lhota u Č. Lípy', 'cs')).toContain('Lhota u České Lípy');
        expect(expandPlaceQuery('M.Lhota', 'cs')).toContain('Malá Lhota');
    });

    it('two abbreviations: the usual reading, then each other reading alone; at most four', () => {
        const out = expandPlaceQuery('H. Lhota u V. Jinova', 'cs');
        expect(out).toEqual(['H. Lhota u V. Jinova', 'Horní Lhota u Velká Jinova', 'Hořejší Lhota u Velká Jinova']);
        expect(expandPlaceQuery('H. Lhota u V. Jinova', 'cs', undefined, ['Lhota', 'Jinov'])).toHaveLength(MAX_PLACE_QUERIES);
        expect(out.length).toBeLessThanOrEqual(MAX_PLACE_QUERIES);
    });

    it('the names of the research’s place record and of the history of places', () => {
        const data: StromData = {
            persons: {}, partnerships: {},
            placeRecords: { L1: { id: 'L1', names: [{ name: 'Horní Lhota' }, { name: 'Ober Lhota', lang: 'de', to: 1945 }] } },
            placeRefs: { 'h lhota': 'L1' },
        };
        expect(expandPlaceQuery('Ober Lhota', 'cs', data)).toEqual(['Ober Lhota', 'Horní Lhota']);
        expect(expandPlaceQuery('Lhotínek', 'cs', undefined, ['Lhotinek', 'Klein Lhota'])).toEqual(['Lhotínek', 'Lhotinek', 'Klein Lhota']);
        // Through the ref of the very spelling.
        expect(expandPlaceQuery('H. Lhota', 'cs', data)).toEqual(['H. Lhota', 'Horní Lhota', 'Hořejší Lhota', 'Ober Lhota']);
    });

    it('no duplicates: case, Unicode form and spacing aside', () => {
        const nfd = 'Horní Lhota'.normalize('NFD');
        expect(expandPlaceQuery(`  ${nfd}  `, 'cs')).toEqual(['Horní Lhota', 'Horni Lhota']);
        expect(expandPlaceQuery('Lhota', 'cs', undefined, ['LHOTA', 'lhota'])).toEqual(['Lhota']);
        expect(expandPlaceQuery('   ', 'cs')).toEqual([]);
    });

    it('other scripts stay as they are', () => {
        expect(expandPlaceQuery('Йошкар-Ола', 'en')).toEqual(['Йошкар-Ола']);
        expect(expandPlaceQuery('Łotów', 'en')).toEqual(['Łotów', 'Lotow']);
        expect(withoutDiacritics('Ţară Ελλάδα')).toBe('Tara Ελλάδα');
    });
});
