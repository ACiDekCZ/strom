/**
 * Branch classification relative to a focus person (pure).
 */

import { describe, it, expect } from 'vitest';
import { classifyBranches, branchesOf } from '../branch-colors.js';
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
        const { map: m, numbered } = classifyBranches(d, pid('F'));

        expect(m.get(pid('Fa'))).toEqual({ paternal: true });
        expect(m.get(pid('PGf'))).toEqual({ paternal: true });
        expect(m.get(pid('PGm'))).toEqual({ paternal: true });
        expect(m.get(pid('PUncle'))).toEqual({ paternal: true });   // sibling of an ancestor
        expect(m.get(pid('Mo'))).toEqual({ maternal: true });
        expect(m.get(pid('MGf'))).toEqual({ maternal: true });
        expect(m.get(pid('C'))).toEqual({ descendant: true });
        expect(numbered).toBe(false);   // father + mother

        // Focus, in-laws and unrelated people are untagged (other).
        expect(m.has(pid('F'))).toBe(false);
        expect(m.has(pid('Spouse'))).toBe(false);
        expect(m.has(pid('X'))).toBe(false);
    });

    it('R4: an ancestor reached from both sides (marriage of relatives) carries both lines', () => {
        const d = data(
            person('F', 'male', { parentIds: ['Fa', 'Mo'] }),
            person('Fa', 'male', { parentIds: ['G'], childIds: ['F'] }),
            person('Mo', 'female', { parentIds: ['G'], childIds: ['F'] }),
            person('G', 'male', { childIds: ['Fa', 'Mo'] }),
        );
        const { map: m } = classifyBranches(d, pid('F'));
        expect(m.get(pid('G'))).toEqual({ paternal: true, maternal: true });
        expect(branchesOf(m.get(pid('G')))).toEqual(['paternal', 'maternal']);
        // Each parent is also the sibling of the other side's ancestor: both lines.
        expect(m.get(pid('Fa'))).toEqual({ paternal: true, maternal: true });
    });

    it('a descendant who is also an ancestor (cycle in the data) keeps only the ancestral line', () => {
        const d = data(
            person('F', 'male', { parentIds: ['Fa'], childIds: ['Fa'] }),
            person('Fa', 'male', { parentIds: ['F'], childIds: ['F'] }),
        );
        const { map: m } = classifyBranches(d, pid('F'));
        expect(m.get(pid('Fa'))).toEqual({ paternal: true });
    });

    it('returns an empty map when the focus has no relatives', () => {
        const d = data(person('solo', 'male'));
        const r = classifyBranches(d, pid('solo'));
        expect(r.map.size).toBe(0);
        expect(r.numbered).toBe(false);
    });

    it('returns an empty result for an unknown focus', () => {
        const r = classifyBranches(data(person('a', 'male')), pid('nobody'));
        expect(r.map.size).toBe(0);
        expect(r.numbered).toBe(false);
    });

    it('R3: siblings and cousins of the focus get no marker', () => {
        const d = data(
            person('F', 'male', { parentIds: ['Fa', 'Mo'] }),
            person('Sib', 'female', { parentIds: ['Fa', 'Mo'] }),
            person('Fa', 'male', { parentIds: ['G'], childIds: ['F', 'Sib'] }),
            person('Mo', 'female', { childIds: ['F', 'Sib'] }),
            person('G', 'male', { childIds: ['Fa', 'Uncle'] }),
            person('Uncle', 'male', { parentIds: ['G'], childIds: ['Cousin'] }),
            person('Cousin', 'female', { parentIds: ['Uncle'] }),
        );
        const { map: m } = classifyBranches(d, pid('F'));
        expect(m.get(pid('Uncle'))).toEqual({ paternal: true });
        expect(m.has(pid('Sib'))).toBe(false);
        expect(m.has(pid('Cousin'))).toBe(false);
    });

    it("a descendant's partner gets no marker, the focus none either", () => {
        const d = data(
            person('F', 'female', { childIds: ['C'] }),
            person('C', 'male', { parentIds: ['F'], childIds: ['GC'] }),
            person('CW', 'female', { childIds: ['GC'] }),
            person('GC', 'male', { parentIds: ['C', 'CW'] }),
        );
        const { map: m } = classifyBranches(d, pid('F'));
        expect(m.get(pid('C'))).toEqual({ descendant: true });
        expect(m.get(pid('GC'))).toEqual({ descendant: true });
        expect(m.has(pid('CW'))).toBe(false);
        expect(m.has(pid('F'))).toBe(false);
    });
});

describe('classifyBranches — R5 numbered lines', () => {
    it('two fathers: both get a slot (declaration order) and the lines are numbered', () => {
        const d = data(
            person('F', 'male', { parentIds: ['A', 'B'] }),
            person('A', 'male', { childIds: ['F'] }),
            person('B', 'male', { childIds: ['F'] }),
        );
        const { map: m, numbered } = classifyBranches(d, pid('F'));
        expect(m.get(pid('A'))).toEqual({ paternal: true });
        expect(m.get(pid('B'))).toEqual({ maternal: true });
        expect(numbered).toBe(true);
    });

    it('two mothers: numbered', () => {
        const d = data(
            person('F', 'male', { parentIds: ['A', 'B'] }),
            person('A', 'female', { childIds: ['F'] }),
            person('B', 'female', { childIds: ['F'] }),
        );
        expect(classifyBranches(d, pid('F')).numbered).toBe(true);
    });

    it('a parent of unknown sex: not numbered', () => {
        const d = data(
            person('F', 'male', { parentIds: ['A', 'B'] }),
            person('A', 'male', { childIds: ['F'] }),
            person('B', 'unknown', { childIds: ['F'] }),
        );
        expect(classifyBranches(d, pid('F')).numbered).toBe(false);
    });

    it('a single known parent: not numbered', () => {
        const d = data(
            person('F', 'male', { parentIds: ['A'] }),
            person('A', 'female', { childIds: ['F'] }),
        );
        const r = classifyBranches(d, pid('F'));
        expect(r.numbered).toBe(false);
        expect(r.map.get(pid('A'))).toEqual({ maternal: true });
    });
});
