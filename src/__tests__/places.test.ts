/**
 * Places registry: everything is derived from the tree's own strings — no
 * external data. Spellings that differ only by case/diacritics/punctuation are
 * one place; renaming rewrites every field that used it.
 */
import { describe, it, expect } from 'vitest';
import { placeKey, collectPlaces, placeList, placesWithVariants, renamePlace, orphanedPlaceKeys } from '../places.js';
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

describe('orphanedPlaceKeys', () => {
    // A tree where Brno is used (a birth) but data.places also carries an old
    // pin for Praha that no record mentions any more (a deleted person's place).
    function withPlaces(): StromData {
        const data = tree([person('a', { birthPlace: 'Brno' })]);
        data.places = {
            [placeKey('Brno')]: { lat: 49.2, lon: 16.6, label: 'Brno' },
            [placeKey('Praha')]: { lat: 50.08, lon: 14.42, label: 'Praha' },
            [placeKey('Wien')]: { lat: 48.2, lon: 16.37, label: 'Wien' },
        };
        return data;
    }

    it('reports only place keys nothing in the tree still references', () => {
        const data = withPlaces();
        const orphans = orphanedPlaceKeys(data).sort();
        expect(orphans).toEqual([placeKey('Praha'), placeKey('Wien')].sort());
        expect(orphans).not.toContain(placeKey('Brno'));   // Brno is a live birthplace
    });

    it('counts a wedding place and an event place as live references', () => {
        const data = tree([
            person('a', { events: [{ id: 'e1', type: 'residence', place: 'Plzeň' }] }),
            person('b'),
        ], 'Tábor');
        data.places = {
            [placeKey('Plzeň')]: { lat: 49.7, lon: 13.4 },
            [placeKey('Tábor')]: { lat: 49.4, lon: 14.7 },
            [placeKey('Ghost')]: { lat: 0, lon: 0 },
        };
        expect(orphanedPlaceKeys(data)).toEqual([placeKey('Ghost')]);
    });

    it('returns nothing when there is no places registry', () => {
        expect(orphanedPlaceKeys(tree([person('a', { birthPlace: 'Brno' })]))).toEqual([]);
    });
});
