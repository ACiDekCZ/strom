/**
 * Migration over time (P5): the dated harvest that feeds the map's time slider.
 * Pure data — every point comes from the tree's own dates and places.
 */
import { describe, it, expect } from 'vitest';
import { collectDatedPlacePoints } from '../map-time.js';
import { placeKey } from '../places.js';
import { StromData, Person, Partnership, PersonId, PartnershipId } from '../types.js';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender: 'male',
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}
function tree(persons: Person[], partnerships: Record<string, Partnership> = {}): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: partnerships as StromData['partnerships'],
    };
}

describe('collectDatedPlacePoints — sources', () => {
    it('harvests birth, death, event and wedding (a point for BOTH partners)', () => {
        const data = tree([
            person('a', {
                birthDate: '1850', birthPlace: 'Děčín',
                deathDate: '1910', deathPlace: 'Praha',
                events: [{ id: 'e1', type: 'residence', date: '1880', place: 'Brno' }],
            }),
            person('b', { id: 'b' as PersonId }),
        ], {
            u1: {
                id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
                childIds: [], status: 'married', startDate: '1875', startPlace: 'Plzeň',
            },
        });

        const { points } = collectDatedPlacePoints(data);
        const kinds = points.map(p => `${p.kind}:${p.placeKey}:${p.personId}`).sort();
        expect(kinds).toEqual([
            'birth:decin:a',
            'death:praha:a',
            'event:brno:a',
            'wedding:plzen:a',   // wedding is a point for each partner
            'wedding:plzen:b',
        ].sort());
    });

    it('skips references missing either a date or a place', () => {
        const data = tree([
            person('a', { birthDate: '1850' }),                    // no place
            person('b', { id: 'b' as PersonId, birthPlace: 'Brno' }),   // no date
            person('c', { id: 'c' as PersonId, deathDate: '1900', deathPlace: 'Praha' }),
        ]);
        const { points } = collectDatedPlacePoints(data);
        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({ year: 1900, placeKey: 'praha', kind: 'death' });
    });
});

describe('collectDatedPlacePoints — flex years', () => {
    it('resolves qualified and ranged dates to their year', () => {
        const data = tree([
            person('a', { birthDate: '~1880', birthPlace: 'Brno' }),
            person('b', { id: 'b' as PersonId, birthDate: '1901..1905', birthPlace: 'Praha' }),
            person('c', { id: 'c' as PersonId, birthDate: '<1870', birthPlace: 'Plzeň' }),
        ]);
        const years = collectDatedPlacePoints(data).points.map(p => p.year).sort((x, y) => x - y);
        expect(years).toEqual([1870, 1880, 1901]);  // ~ → year, range → start, < → year
    });
});

describe('collectDatedPlacePoints — range and undated', () => {
    it('reports minYear/maxYear across every point', () => {
        const data = tree([
            person('a', { birthDate: '1850', birthPlace: 'Brno', deathDate: '1921', deathPlace: 'Praha' }),
            person('b', { id: 'b' as PersonId, birthDate: '1888', birthPlace: 'Plzeň' }),
        ]);
        const h = collectDatedPlacePoints(data);
        expect(h.minYear).toBe(1850);
        expect(h.maxYear).toBe(1921);
    });

    it('has a null range when nothing is dated', () => {
        const data = tree([person('a', { birthPlace: 'Brno' })]);
        const h = collectDatedPlacePoints(data);
        expect(h.points).toHaveLength(0);
        expect(h.minYear).toBeNull();
        expect(h.maxYear).toBeNull();
    });

    it('counts pinned places that carry no date at all', () => {
        // Brno has a dated birth; Praha is pinned and used but undated; Zlín is
        // used but has no pin (so it belongs to the "no coordinates" status, not
        // here); Ghost is an orphan pin nobody uses.
        const data = tree([
            person('a', { birthDate: '1850', birthPlace: 'Brno' }),
            person('b', { id: 'b' as PersonId, birthPlace: 'Praha' }),
            person('c', { id: 'c' as PersonId, birthPlace: 'Zlín' }),
        ]);
        data.places = {
            [placeKey('Brno')]: { lat: 49.2, lon: 16.6 },
            [placeKey('Praha')]: { lat: 50.08, lon: 14.42 },
            [placeKey('Ghost')]: { lat: 0, lon: 0 },
        };
        // Only Praha: pinned, used, and never dated.
        expect(collectDatedPlacePoints(data).undatedPlaceCount).toBe(1);
    });

    it('does not count a place once it has at least one dated reference', () => {
        // Praha is undated on person a but dated on person b — it can sit on the
        // axis, so it is not "undated".
        const data = tree([
            person('a', { birthPlace: 'Praha' }),
            person('b', { id: 'b' as PersonId, birthDate: '1900', birthPlace: 'Praha' }),
        ]);
        data.places = { [placeKey('Praha')]: { lat: 50.08, lon: 14.42 } };
        expect(collectDatedPlacePoints(data).undatedPlaceCount).toBe(0);
    });
});

describe('collectDatedPlacePoints — person filter', () => {
    it('keeps only points for people in scope (wedding needs one partner in)', () => {
        const data = tree([
            person('a', { birthDate: '1850', birthPlace: 'Brno' }),
            person('b', { id: 'b' as PersonId, birthDate: '1855', birthPlace: 'Praha' }),
        ], {
            u1: {
                id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
                childIds: [], status: 'married', startDate: '1878', startPlace: 'Plzeň',
            },
        });
        const scope = new Set<PersonId>(['a' as PersonId]);
        const { points } = collectDatedPlacePoints(data, scope);
        // a's birth + the wedding point for a — b is out of scope.
        expect(points.map(p => `${p.kind}:${p.personId}`).sort())
            .toEqual(['birth:a', 'wedding:a']);
    });
});
