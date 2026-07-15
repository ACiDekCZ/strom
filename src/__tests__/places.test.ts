/**
 * Places registry: everything is derived from the tree's own strings — no
 * external data. Spellings that differ only by case/diacritics/punctuation are
 * one place; renaming rewrites every field that used it.
 */
import { describe, it, expect } from 'vitest';
import { placeKey, collectPlaces, placeList, placesWithVariants, renamePlace } from '../places.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender: 'male',
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}
function tree(persons: Person[], startPlace?: string): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: (startPlace ? {
            u1: { id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
                  childIds: [], status: 'married' as const, startPlace },
        } : {}) as StromData['partnerships'],
    };
}

describe('placeKey', () => {
    it('folds case, diacritics and punctuation', () => {
        expect(placeKey('Děčín')).toBe(placeKey('decin'));
        expect(placeKey('Děčín')).toBe(placeKey('DĚČÍN'));
        expect(placeKey('Praha,  2')).toBe(placeKey('praha 2'));
        expect(placeKey('  Brno ')).toBe('brno');
    });
    it('keeps genuinely different places apart', () => {
        expect(placeKey('Děčín')).not.toBe(placeKey('Dečice'));
    });
});

describe('collectPlaces', () => {
    it('gathers places from births, deaths, events and weddings with counts', () => {
        const data = tree([
            person('a', { birthPlace: 'Děčín', deathPlace: 'Praha' }),
            person('b', { birthPlace: 'Děčín', events: [{ id: 'e1', type: 'baptism', place: 'Praha' }] }),
        ], 'Brno');
        const places = collectPlaces(data);
        expect(places.get('decin')!.count).toBe(2);
        expect(places.get('praha')!.count).toBe(2);
        expect(places.get('brno')!.count).toBe(1);
    });

    it('groups variants and shows the most used spelling', () => {
        const data = tree([
            person('a', { birthPlace: 'Děčín' }),
            person('b', { birthPlace: 'Děčín' }),
            person('c', { birthPlace: 'decin' }),
        ]);
        const entry = collectPlaces(data).get('decin')!;
        expect(entry.count).toBe(3);
        expect(entry.variants.size).toBe(2);
        expect(entry.display).toBe('Děčín');       // 2 uses beats 1
    });

    it('ignores empty and whitespace-only places', () => {
        const data = tree([person('a', { birthPlace: '   ', deathPlace: '' })]);
        expect(collectPlaces(data).size).toBe(0);
    });
});

describe('placeList / placesWithVariants', () => {
    it('sorts by usage and finds inconsistent spellings', () => {
        const data = tree([
            person('a', { birthPlace: 'Praha' }),
            person('b', { birthPlace: 'Praha' }),
            person('c', { birthPlace: 'Děčín' }),
            person('d', { birthPlace: 'Děčín' }),
            person('e', { birthPlace: 'decin' }),
        ]);
        // Praha (2) and Děčín (3 across two spellings, 'Děčín' used most).
        expect(placeList(data).map(p => p.display)).toEqual(['Děčín', 'Praha']);
        const inconsistent = placesWithVariants(data);
        expect(inconsistent).toHaveLength(1);
        expect(inconsistent[0].variants.size).toBe(2);
    });
});

describe('renamePlace', () => {
    it('rewrites every field using any variant and leaves the original alone', () => {
        const data = tree([
            person('a', { birthPlace: 'decin', deathPlace: 'Praha' }),
            person('b', { birthPlace: 'Děčín', events: [{ id: 'e1', type: 'burial', place: 'DECIN' }] }),
        ], 'Děčín');
        const { data: out, changed } = renamePlace(data, 'decin', 'Děčín');
        // Only the misspelled ones count: a.birthPlace + b's event. b.birthPlace
        // and the wedding are already spelled 'Děčín'.
        expect(changed).toBe(2);
        expect(out.persons['a' as PersonId].birthPlace).toBe('Děčín');
        expect(out.persons['b' as PersonId].events![0].place).toBe('Děčín');
        expect(out.partnerships['u1' as PartnershipId].startPlace).toBe('Děčín');
        expect(out.persons['a' as PersonId].deathPlace).toBe('Praha');   // untouched
        // the source data is not mutated
        expect(data.persons['a' as PersonId].birthPlace).toBe('decin');
    });
});
