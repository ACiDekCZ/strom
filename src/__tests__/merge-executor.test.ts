/**
 * executeMerge safety: relationship symmetry after a merge (a duplicate parent
 * that cannot take a third slot must not leave dangling links), and partnership
 * sourceIds unioned like persons'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeMerge } from '../merge/executor.js';
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
