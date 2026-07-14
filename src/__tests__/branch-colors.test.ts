/**
 * Branch classification relative to a focus person (pure).
 */

import { describe, it, expect } from 'vitest';
import { classifyBranches } from '../branch-colors.js';
import { StromData, PersonId, Person, Gender } from '../types.js';

interface POpts { parentIds?: string[]; childIds?: string[]; }
function person(id: string, gender: Gender, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder: false,
        partnerships: [], parentIds: (o.parentIds ?? []) as PersonId[], childIds: (o.childIds ?? []) as PersonId[],
    };
}
function data(...ps: Person[]): StromData {
    return { persons: Object.fromEntries(ps.map(p => [p.id, p])) as StromData['persons'], partnerships: {} };
}
const pid = (s: string) => s as PersonId;

describe('classifyBranches', () => {
    it('tags paternal / maternal ancestors, their siblings, and descendants', () => {
        const d = data(
            person('F', 'male', { parentIds: ['Fa', 'Mo'], childIds: ['C'] }),
            person('Fa', 'male', { parentIds: ['PGf', 'PGm'], childIds: ['F'] }),
            person('Mo', 'female', { parentIds: ['MGf'], childIds: ['F'] }),
            person('PGf', 'male', { childIds: ['Fa', 'PUncle'] }),
            person('PGm', 'female', { childIds: ['Fa', 'PUncle'] }),
            person('PUncle', 'male', { parentIds: ['PGf', 'PGm'] }),
            person('MGf', 'male', { childIds: ['Mo'] }),
            person('C', 'male', { parentIds: ['F', 'Spouse'] }),
            person('Spouse', 'female', { childIds: ['C'] }),   // partner married in → other
            person('X', 'male'),                               // unrelated → other
        );
        const m = classifyBranches(d, pid('F'));

        expect(m.get(pid('Fa'))).toBe('paternal');
        expect(m.get(pid('PGf'))).toBe('paternal');
        expect(m.get(pid('PGm'))).toBe('paternal');
        expect(m.get(pid('PUncle'))).toBe('paternal');   // sibling of an ancestor
        expect(m.get(pid('Mo'))).toBe('maternal');
        expect(m.get(pid('MGf'))).toBe('maternal');
        expect(m.get(pid('C'))).toBe('descendant');

        // Focus, in-laws and unrelated people are untagged (other).
        expect(m.get(pid('F'))).toBeUndefined();
        expect(m.get(pid('Spouse'))).toBeUndefined();
        expect(m.get(pid('X'))).toBeUndefined();
    });

    it('resolves a shared ancestor to the paternal side (first wins)', () => {
        const d = data(
            person('F', 'male', { parentIds: ['Fa', 'Mo'] }),
            person('Fa', 'male', { parentIds: ['G'], childIds: ['F'] }),
            person('Mo', 'female', { parentIds: ['G'], childIds: ['F'] }),
            person('G', 'male', { childIds: ['Fa', 'Mo'] }),
        );
        const m = classifyBranches(d, pid('F'));
        expect(m.get(pid('G'))).toBe('paternal');   // reachable from both, paternal computed first
    });

    it('returns an empty map when the focus has no relatives', () => {
        const d = data(person('solo', 'male'));
        expect(classifyBranches(d, pid('solo')).size).toBe(0);
    });
});
