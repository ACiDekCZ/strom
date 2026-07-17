/**
 * executeMerge safety: relationship symmetry after a merge (a duplicate parent
 * that cannot take a third slot must not leave dangling links), and partnership
 * sourceIds unioned like persons'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeMerge } from '../merge/executor.js';
import { calculateMergeStats } from '../merge/matching.js';
import { validateTreeData } from '../validation.js';
import { StorageManager } from '../storage.js';
import { MergeState, PersonMatch } from '../merge/types.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender } from '../types.js';

type PersonOverrides = Partial<Omit<Person, 'partnerships' | 'parentIds' | 'childIds'>> & {
    partnerships?: string[]; parentIds?: string[]; childIds?: string[];
};
function P(id: string, first: string, last: string, o: PersonOverrides = {}): Person {
    const { partnerships, parentIds, childIds, ...rest } = o;
    return {
        id: id as PersonId, firstName: first, lastName: last,
        gender: (o.gender as Gender) ?? 'male', isPlaceholder: false,
        partnerships: (partnerships ?? []) as PartnershipId[],
        parentIds: (parentIds ?? []) as PersonId[],
        childIds: (childIds ?? []) as PersonId[],
        ...rest,
    };
}
function U(id: string, p1: string, p2: string, childIds: string[], o: Partial<Partnership> = {}): Partnership {
    return {
        id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId,
        childIds: childIds as PersonId[], status: 'married', ...o,
    };
}
function tree(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
function confirmedMatch(existing: Person, incoming: Person): PersonMatch {
    return {
        existingId: existing.id, incomingId: incoming.id, confidence: 'high',
        reasons: [], score: 95, existingPerson: existing, incomingPerson: incoming, conflicts: [],
    };
}

beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('executeMerge enforces parent/child symmetry (Bredlow shape)', () => {
    it('a duplicate mother added for a child that already has two parents leaves no dangling link', async () => {
        // Existing: child Karel with two parents (Josef + Anna), married union.
        const D = P('D', 'Josef', 'Bredlow', { birthDate: '1900', childIds: ['X'], partnerships: ['U1'] });
        const M1 = P('M1', 'Anna', 'Bredlow', { gender: 'female', birthDate: '1905', childIds: ['X'], partnerships: ['U1'] });
        const X = P('X', 'Karel', 'Bredlow', { birthDate: '1930', parentIds: ['D', 'M1'] });
        const existingData = tree([D, M1, X], [U('U1', 'D', 'M1', ['X'])]);

        // Incoming: same father + same child, but a DIFFERENT (duplicate) mother,
        // married to the father, listing the same child.
        const iD = P('iD', 'Josef', 'Bredlow', { birthDate: '1900', childIds: ['iX'], partnerships: ['iU2'] });
        const iM2 = P('iM2', 'Marie', 'Bredlow', { gender: 'female', birthDate: '1908', childIds: ['iX'], partnerships: ['iU2'] });
        const iX = P('iX', 'Karel', 'Bredlow', { birthDate: '1930', parentIds: ['iD', 'iM2'] });
        const incomingData = tree([iD, iM2, iX], [U('iU2', 'iD', 'iM2', ['iX'])]);

        const state: MergeState = {
            existingData, incomingData,
            matches: [confirmedMatch(D, iD), confirmedMatch(X, iX)],
            unmatchedExisting: [], unmatchedIncoming: ['iM2' as PersonId],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };

        const result = await executeMerge(state);
        expect(result.success).toBe(true);

        const merged = result.mergedData;
        const validation = validateTreeData(merged);
        const offending = validation.issues.filter(i =>
            ['missingParentRef', 'missingChildRef', 'partnershipChildMismatch',
                'orphanedParentRef', 'orphanedChildRef', 'orphanedPartnershipChildRef',
                'tooManyParents'].includes(i.type));
        expect(offending).toEqual([]);

        // The child still has exactly its two original parents — not a third.
        const child = merged.persons['X' as PersonId];
        expect(child.parentIds).toHaveLength(2);
        expect(child.parentIds).toContain('D');
        expect(child.parentIds).toContain('M1');

        // The duplicate mother was added, but does NOT keep the child in childIds
        // (the link was dropped on both sides), and no union claims the child
        // without both parents.
        const dupMother = Object.values(merged.persons).find(p => p.firstName === 'Marie');
        expect(dupMother).toBeDefined();
        expect(dupMother!.childIds).not.toContain('X');
        for (const u of Object.values(merged.partnerships)) {
            for (const cid of u.childIds) {
                const c = merged.persons[cid];
                expect(c.parentIds).toContain(u.person1Id);
                expect(c.parentIds).toContain(u.person2Id);
            }
        }
    });
});

describe('executeMerge unions partnership sourceIds (Fix 4)', () => {
    it('a marriage record cited on either side survives', async () => {
        const D = P('D', 'Josef', 'Novák', { birthDate: '1900', partnerships: ['U1'] });
        const M = P('M', 'Anna', 'Nováková', { gender: 'female', birthDate: '1905', partnerships: ['U1'] });
        const existingData = tree([D, M], [U('U1', 'D', 'M', [], { sourceIds: ['s1'] })]);

        const iD = P('iD', 'Josef', 'Novák', { birthDate: '1900', partnerships: ['iU1'] });
        const iM = P('iM', 'Anna', 'Nováková', { gender: 'female', birthDate: '1905', partnerships: ['iU1'] });
        const incomingData = tree([iD, iM], [U('iU1', 'iD', 'iM', [], { sourceIds: ['s2'] })]);

        const state: MergeState = {
            existingData, incomingData,
            matches: [confirmedMatch(D, iD), confirmedMatch(M, iM)],
            unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };

        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const union = result.mergedData.partnerships['U1' as PartnershipId];
        expect(union.sourceIds).toContain('s1');
        expect(union.sourceIds).toContain('s2');
    });
});

const OFFENDING = [
    'missingParentRef', 'missingChildRef', 'partnershipChildMismatch',
    'orphanedParentRef', 'orphanedChildRef', 'orphanedPartnershipChildRef',
    'tooManyParents',
];

describe('executeMerge "update existing only" mode (Primitive 1)', () => {
    // Existing tree: only Josef. Incoming brings the same Josef (to enrich) plus
    // a brand-new wife Marie, their child Karel, and their union.
    function buildState(updateOnly: boolean): MergeState {
        const A = P('A', 'Josef', 'Novák', { birthDate: '1900' });
        const existingData = tree([A]);

        const iA = P('iA', 'Josef', 'Novák', { birthDate: '1900', birthPlace: 'Praha', partnerships: ['iU'] });
        const iB = P('iB', 'Marie', 'Novák', { gender: 'female', birthDate: '1905', childIds: ['iC'], partnerships: ['iU'] });
        const iC = P('iC', 'Karel', 'Novák', { birthDate: '1930', parentIds: ['iA', 'iB'] });
        const incomingData = tree([iA, iB, iC], [U('iU', 'iA', 'iB', ['iC'])]);

        return {
            existingData, incomingData,
            matches: [confirmedMatch(A, iA)],
            unmatchedExisting: [], unmatchedIncoming: ['iB' as PersonId, 'iC' as PersonId],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
            updateOnly,
        };
    }

    it('enriches the matched person but adds no unmatched persons', async () => {
        const state = buildState(true);
        const result = await executeMerge(state);
        expect(result.success).toBe(true);

        const persons = Object.values(result.mergedData.persons);
        // Only Josef survives; Marie and Karel are NOT added.
        expect(persons).toHaveLength(1);
        expect(persons.find(p => p.firstName === 'Marie')).toBeUndefined();
        expect(persons.find(p => p.firstName === 'Karel')).toBeUndefined();
        // Josef was enriched with the incoming birthPlace.
        expect(result.mergedData.persons['A' as PersonId].birthPlace).toBe('Praha');
        expect(result.stats.merged).toBe(1);
        expect(result.stats.added).toBe(0);
    });

    it('skips partnerships whose members did not all arrive', async () => {
        const state = buildState(true);
        const result = await executeMerge(state);
        // The incoming union depends on Marie, who was not added → no partnership.
        expect(Object.keys(result.mergedData.partnerships)).toHaveLength(0);
    });

    it('leaves no dangling links (symmetry holds)', async () => {
        const state = buildState(true);
        const result = await executeMerge(state);
        const offending = validateTreeData(result.mergedData).issues.filter(i => OFFENDING.includes(i.type));
        expect(offending).toEqual([]);
    });

    it('normal mode (updateOnly=false) DOES add the new persons and union', async () => {
        const state = buildState(false);
        const result = await executeMerge(state);
        const persons = Object.values(result.mergedData.persons);
        expect(persons.find(p => p.firstName === 'Marie')).toBeDefined();
        expect(persons.find(p => p.firstName === 'Karel')).toBeDefined();
        expect(result.stats.added).toBe(2);
        expect(Object.keys(result.mergedData.partnerships)).toHaveLength(1);
    });
});

describe('executeMerge per-match skip decision (Primitive 2)', () => {
    it('a skipped incoming person is neither merged nor added, and is counted', async () => {
        const A = P('A', 'Josef', 'Novák', { birthDate: '1900' });
        const existingData = tree([A]);

        const iA = P('iA', 'Josef', 'Novák', { birthDate: '1900' });
        const iMarie = P('iMarie', 'Marie', 'Novák', { gender: 'female', birthDate: '1905' });
        const incomingData = tree([iA, iMarie]);

        const state: MergeState = {
            existingData, incomingData,
            matches: [confirmedMatch(A, iA)],
            unmatchedExisting: [], unmatchedIncoming: ['iMarie' as PersonId],
            // Marie is explicitly skipped — don't bring her at all.
            decisions: new Map([['iMarie' as PersonId, { type: 'skip' }]]),
            conflictResolutions: new Map(), phase: 'executing',
        };

        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        expect(Object.values(result.mergedData.persons).find(p => p.firstName === 'Marie')).toBeUndefined();
        expect(result.stats.added).toBe(0);
        expect(result.stats.skipped).toBe(1);
    });

    it('calculateMergeStats reflects skip: skipped counted, willAdd excludes it', async () => {
        const A = P('A', 'Josef', 'Novák', { birthDate: '1900' });
        const iA = P('iA', 'Josef', 'Novák', { birthDate: '1900' });
        const iMarie = P('iMarie', 'Marie', 'Novák', { gender: 'female' });
        const iPetr = P('iPetr', 'Petr', 'Novák', {});

        const state: MergeState = {
            existingData: tree([A]), incomingData: tree([iA, iMarie, iPetr]),
            matches: [confirmedMatch(A, iA)],
            unmatchedExisting: [], unmatchedIncoming: ['iMarie' as PersonId, 'iPetr' as PersonId],
            decisions: new Map([['iMarie' as PersonId, { type: 'skip' }]]),
            conflictResolutions: new Map(), phase: 'reviewing',
        };

        const stats = calculateMergeStats(state);
        expect(stats.skipped).toBe(1);
        // Petr (no decision) will be added; Marie (skip) will not.
        expect(stats.willAdd).toBe(1);
    });

    it('updateOnly forces willAdd to 0 regardless of undecided unmatched', () => {
        const A = P('A', 'Josef', 'Novák', { birthDate: '1900' });
        const iA = P('iA', 'Josef', 'Novák', { birthDate: '1900' });
        const iPetr = P('iPetr', 'Petr', 'Novák', {});
        const state: MergeState = {
            existingData: tree([A]), incomingData: tree([iA, iPetr]),
            matches: [confirmedMatch(A, iA)],
            unmatchedExisting: [], unmatchedIncoming: ['iPetr' as PersonId],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'reviewing',
            updateOnly: true,
        };
        expect(calculateMergeStats(state).willAdd).toBe(0);
    });
});
