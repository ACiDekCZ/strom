/**
 * Search-filter tests (filterPersons): AND combination of last name, place,
 * birth-year range, gender and living/deceased, with diacritics-insensitive
 * text matching. Pure function — no DOM.
 */

import { describe, it, expect } from 'vitest';
import { filterPersons, hasSearchCriteria } from '../search-filter.js';
import { StromData, PersonId, Person, Gender } from '../types.js';

function p(id: string, firstName: string, lastName: string, gender: Gender, opts: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName, lastName, gender, isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...opts,
    };
}

function tree(...persons: Person[]): StromData {
    const map: StromData['persons'] = {};
    for (const person of persons) map[person.id] = person;
    return { persons: map, partnerships: {} };
}

const data = tree(
    p('borivoj', 'Bořivoj', 'Přemyslovec', 'male', { birthDate: '~0852', deathDate: '0889', birthPlace: 'Praha' }),
    p('vaclav', 'Václav', 'Přemyslovec', 'male', { birthDate: '~0907', deathDate: '0935', birthPlace: 'Stochov' }),
    p('otakar', 'Otakar', 'Přemyslovec', 'male', { birthDate: '1233', deathDate: '1278' }),
    p('anna', 'Anna', 'Nováková', 'female', { birthDate: '1990' }),  // living, no death
    p('ph', 'Unknown', '', 'male', { isPlaceholder: true }),
);

describe('filterPersons', () => {
    it('filters by last name (diacritics-insensitive)', () => {
        const ids = filterPersons(data, { lastName: 'premyslovec' });
        expect(ids.sort()).toEqual(['borivoj', 'otakar', 'vaclav']);
    });

    it('combines last name + birth-year range (AND)', () => {
        const ids = filterPersons(data, { lastName: 'Přemyslovec', birthFrom: 900, birthTo: 1000 });
        expect(ids).toEqual(['vaclav']);
    });

    it('filters by place across birth/death', () => {
        expect(filterPersons(data, { place: 'praha' })).toEqual(['borivoj']);
    });

    it('filters by gender', () => {
        expect(filterPersons(data, { gender: 'female' })).toEqual(['anna']);
    });

    it('filters living vs deceased (heuristic)', () => {
        expect(filterPersons(data, { living: 'living' }, 2026)).toEqual(['anna']);
        expect(filterPersons(data, { living: 'deceased' }, 2026).sort()).toEqual(['borivoj', 'otakar', 'vaclav']);
    });

    it('skips placeholders and returns all with no criteria', () => {
        const ids = filterPersons(data, {});
        expect(ids).not.toContain('ph');
        expect(ids).toHaveLength(4);
    });

    it('matches free-text query on the full name', () => {
        expect(filterPersons(data, { query: 'vaclav prem' })).toEqual(['vaclav']);
    });

    it('hasSearchCriteria detects active criteria', () => {
        expect(hasSearchCriteria({})).toBe(false);
        expect(hasSearchCriteria({ lastName: '  ' })).toBe(false);
        expect(hasSearchCriteria({ gender: 'male' })).toBe(true);
        expect(hasSearchCriteria({ birthFrom: 1900 })).toBe(true);
    });
});
