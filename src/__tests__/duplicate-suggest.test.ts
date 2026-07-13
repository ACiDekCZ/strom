/**
 * Duplicate-suggestion scoring tests (findSimilarPersons). Verifies diacritics-
 * and case-insensitive name matching, birth-year tolerance, gender gating, and
 * the excludeId option. Pure function — no DOM.
 */

import { describe, it, expect } from 'vitest';
import { findSimilarPersons } from '../merge/matching.js';
import { StromData, PersonId, Person, Gender } from '../types.js';

function person(id: string, firstName: string, lastName: string, gender: Gender, birthDate?: string): Person {
    return {
        id: id as PersonId, firstName, lastName, gender, isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [],
        ...(birthDate ? { birthDate } : {}),
    };
}

function tree(...persons: Person[]): StromData {
    const map: StromData['persons'] = {};
    for (const p of persons) map[p.id] = p;
    return { persons: map, partnerships: {} };
}

describe('findSimilarPersons', () => {
    it('matches names ignoring diacritics and case, with the same birth year', () => {
        const data = tree(person('p1', 'Jan', 'Novák', 'male', '1880'));
        const results = findSimilarPersons(data, { firstName: 'jan', lastName: 'novak', gender: 'male', birthDate: '1880' });
        expect(results).toHaveLength(1);
        expect(results[0].person.id).toBe('p1');
    });

    it('tolerates a birth year within ±2 but ranks an exact year higher', () => {
        const data = tree(
            person('near', 'Jan', 'Novak', 'male', '1881'),
            person('exact', 'Jan', 'Novak', 'male', '1880'),
        );
        const results = findSimilarPersons(data, { firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1880' });
        expect(results.map(r => r.person.id)).toContain('exact');
        expect(results[0].person.id).toBe('exact'); // exact year scores highest
    });

    it('does not match a different gender', () => {
        const data = tree(person('f', 'Jan', 'Novak', 'female', '1880'));
        const results = findSimilarPersons(data, { firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1880' });
        expect(results).toHaveLength(0);
    });

    it('does not match clearly different names', () => {
        const data = tree(person('p1', 'Petr', 'Svoboda', 'male', '1880'));
        const results = findSimilarPersons(data, { firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1880' });
        expect(results).toHaveLength(0);
    });

    it('honours excludeId and skips placeholders', () => {
        const placeholder = { ...person('ph', 'Jan', 'Novak', 'male', '1880'), isPlaceholder: true };
        const data = tree(person('self', 'Jan', 'Novak', 'male', '1880'), placeholder);
        const results = findSimilarPersons(data, { firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1880' }, 'self' as PersonId);
        expect(results).toHaveLength(0);
    });

    it('returns nothing for an empty draft', () => {
        const data = tree(person('p1', 'Jan', 'Novak', 'male', '1880'));
        expect(findSimilarPersons(data, { firstName: '', lastName: '', gender: 'male' })).toHaveLength(0);
    });
});
