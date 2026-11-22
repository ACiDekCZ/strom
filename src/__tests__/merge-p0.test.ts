/**
 * Merge fixes of spec 134, story 0 (K0.1, K0.3, K0.7): an undecided weak
 * match is added as a separate person with its links, a suggested value
 * never replaces an existing one without a person's choice, and merging the
 * same source again brings back the persons an earlier merge lost.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeMerge, AUTO_CONFIRM_SCORE } from '../merge/executor.js';
import { calculateMergeStats, createMergeState, detectConflicts } from '../merge/matching.js';
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
function match(existing: Person, incoming: Person, score: number): PersonMatch {
    return {
        existingId: existing.id, incomingId: incoming.id, confidence: score >= 80 ? 'high' : 'low',
        reasons: [], score, existingPerson: existing, incomingPerson: incoming,
        conflicts: detectConflicts(existing, incoming),
    };
}

beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

/** Existing: one Tobiáš Lindner. Incoming: a Tobiáš Lindner with a father, a wife and a son. */
function weakMatchFixture(): { state: MergeState; eT: Person } {
    const eT = P('eT', 'Tobiáš', 'Lindner', { birthDate: '1871' });
    const existingData = tree([eT]);
    const iF = P('iF', 'Ignác', 'Lindner', { birthDate: '1840', childIds: ['iT'] });
    const iT = P('iT', 'Tobiáš', 'Lindner', { birthDate: '1874', parentIds: ['iF'], partnerships: ['iU'], childIds: ['iS'] });
    const iW = P('iW', 'Rozálie', 'Bergerová', { gender: 'female', birthDate: '1878', partnerships: ['iU'], childIds: ['iS'] });
    const iS = P('iS', 'Vilém', 'Lindner', { birthDate: '1900', parentIds: ['iT', 'iW'] });
    const incomingData = tree([iF, iT, iW, iS], [U('iU', 'iT', 'iW', ['iS'])]);
    const state: MergeState = {
        existingData, incomingData,
        matches: [match(eT, iT, 60)],
        unmatchedExisting: [], unmatchedIncoming: ['iF', 'iW', 'iS'] as PersonId[],
        decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
    };
    return { state, eT };
}

describe('K0.1 an undecided match below the auto-confirm score is added as a separate person', () => {
    it('the person is in the result, linked to the incoming father, wife and son', async () => {
        const { state } = weakMatchFixture();
        expect(state.matches[0].score).toBeLessThan(AUTO_CONFIRM_SCORE);
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const persons = Object.values(result.mergedData.persons);
        const tobias = persons.filter(p => p.firstName === 'Tobiáš');
        expect(tobias).toHaveLength(2);
        const added = tobias.find(p => p.id !== 'eT')!;
        expect(added.birthDate).toBe('1874');
        const father = persons.find(p => p.firstName === 'Ignác')!;
        const wife = persons.find(p => p.firstName === 'Rozálie')!;
        const son = persons.find(p => p.firstName === 'Vilém')!;
        expect(added.parentIds).toEqual([father.id]);
        expect(father.childIds).toEqual([added.id]);
        expect(son.parentIds.sort()).toEqual([added.id, wife.id].sort());
        const union = Object.values(result.mergedData.partnerships)[0];
        expect(Object.keys(result.mergedData.partnerships)).toHaveLength(1);
        expect([union.person1Id, union.person2Id].sort()).toEqual([added.id, wife.id].sort());
        expect(added.partnerships).toEqual([union.id]);
        expect(union.childIds).toEqual([son.id]);
        // The existing person stays as it was.
        expect(result.mergedData.persons['eT' as PersonId].birthDate).toBe('1871');
        expect(result.mergedData.persons['eT' as PersonId].parentIds).toEqual([]);
        expect(result.stats.added).toBe(4);
        expect(result.stats.merged).toBe(0);
    });

    it('willAdd counts it, as the executor adds it', async () => {
        const { state } = weakMatchFixture();
        expect(calculateMergeStats(state).willAdd).toBe(4);
        const result = await executeMerge(state);
        expect(result.stats.added).toBe(calculateMergeStats(state).willAdd);
    });

    it('skip and updateOnly still keep it out', async () => {
        const skipped = weakMatchFixture().state;
        skipped.decisions.set('iT' as PersonId, { type: 'skip' });
        expect(calculateMergeStats(skipped).willAdd).toBe(3);
        const r1 = await executeMerge(skipped);
        expect(r1.success).toBe(true);
        expect(Object.values(r1.mergedData.persons).filter(p => p.firstName === 'Tobiáš')).toHaveLength(1);
        // The wife came, her couple with the skipped Tobiáš did not: she names no couple that is not there.
        const wife = Object.values(r1.mergedData.persons).find(p => p.firstName === 'Rozálie')!;
        expect(wife.partnerships).toEqual([]);
        expect(r1.check?.ok).toBe(true);

        const onlyUpdate = weakMatchFixture().state;
        onlyUpdate.updateOnly = true;
        expect(calculateMergeStats(onlyUpdate).willAdd).toBe(0);
        const r2 = await executeMerge(onlyUpdate);
        expect(r2.success).toBe(true);
        expect(Object.keys(r2.mergedData.persons)).toEqual(['eT']);
    });
});

describe('K0.3 an undecided difference keeps the existing value', () => {
    it('"Jan" vs "Jan Nepomuk" and "1900" vs "3 MAR 1900" stay as the tree has them', async () => {
        const eJ = P('eJ', 'Jan', 'Kořínek', { birthDate: '1900', birthPlace: 'Vlašim' });
        const iJ = P('iJ', 'Jan Nepomuk', 'Kořínek', { birthDate: '3 MAR 1900', birthPlace: 'Vlašim' });
        const state: MergeState = {
            existingData: tree([eJ]), incomingData: tree([iJ]),
            matches: [match(eJ, iJ, 95)],
            unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const conflicts = state.matches[0].conflicts;
        expect(conflicts.map(c => c.field).sort()).toEqual(['birthDate', 'firstName']);
        // The suggestion is kept as a hint, never as the default.
        for (const c of conflicts) {
            expect(c.resolution).toBe('keep_existing');
            expect(c.suggested).toBe('use_incoming');
        }
        const result = await executeMerge(state);
        const jan = result.mergedData.persons['eJ' as PersonId];
        expect(jan.firstName).toBe('Jan');
        expect(jan.birthDate).toBe('1900');
        expect(Object.keys(result.mergedData.persons)).toEqual(['eJ']);
    });

    it('an empty value is still filled from the import', async () => {
        const eJ = P('eJ', 'Jan', 'Kořínek', { birthDate: '1900' });
        const iJ = P('iJ', 'Jan', 'Kořínek', { birthDate: '1900', deathDate: '1960', birthPlace: 'Vlašim' });
        const state: MergeState = {
            existingData: tree([eJ]), incomingData: tree([iJ]),
            matches: [match(eJ, iJ, 95)],
            unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const result = await executeMerge(state);
        const jan = result.mergedData.persons['eJ' as PersonId];
        expect(jan.deathDate).toBe('1960');
        expect(jan.birthPlace).toBe('Vlašim');
    });
});

describe('K0.7 merging the same source again brings back persons an earlier merge lost', () => {
    it('lost persons are added, merged and added ones are not doubled', async () => {
        // The tree as an older merge left it: the confirmed Tobiáš is there with
        // his father; his weakly matched sister Klára was lost (neither merged
        // nor added), so the father has only one child.
        const eF = P('eF', 'Ignác', 'Lindner', { birthDate: '1840', deathDate: '1910', childIds: ['eT'] });
        const eT = P('eT', 'Tobiáš', 'Lindner', { birthDate: '1871', parentIds: ['eF'] });
        const existingData = tree([eF, eT]);
        // The same source again.
        const iF = P('iF', 'Ignác', 'Lindner', { birthDate: '1840', deathDate: '1910', childIds: ['iT', 'iK'] });
        const iT = P('iT', 'Tobiáš', 'Lindner', { birthDate: '1871', parentIds: ['iF'] });
        const iK = P('iK', 'Klára', 'Lindnerová', { gender: 'female', birthDate: '1875', parentIds: ['iF'] });
        const incomingData = tree([iF, iT, iK]);

        const state = createMergeState(existingData, incomingData);
        const byIncoming = new Map(state.matches.map(m => [m.incomingId, m.existingId]));
        expect(byIncoming.get('iF' as PersonId)).toBe('eF');
        expect(byIncoming.get('iT' as PersonId)).toBe('eT');
        expect(byIncoming.has('iK' as PersonId)).toBe(false);
        for (const m of state.matches) expect(m.score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
        const stats = calculateMergeStats(state);
        expect(stats.willAdd).toBe(1);

        const result = await executeMerge(state);
        const persons = Object.values(result.mergedData.persons);
        expect(persons).toHaveLength(3);
        for (const name of ['Ignác', 'Tobiáš', 'Klára']) {
            expect(persons.filter(p => p.firstName === name)).toHaveLength(1);
        }
        const klara = persons.find(p => p.firstName === 'Klára')!;
        expect(klara.parentIds).toEqual(['eF']);
        expect(result.mergedData.persons['eF' as PersonId].childIds).toEqual(['eT', klara.id]);
    });
});

describe('K0.8 a merge keeps the order of the children the tree already has', () => {
    it('existing children stay in their order, a new child comes after them', async () => {
        // The tree's order of Ignác's children is not the order the persons
        // were stored in (a hand reorder, a GEDCOM's CHIL order).
        const eA = P('eA', 'Anna', 'Lindnerová', { gender: 'female', birthDate: '1870', parentIds: ['eF', 'eM'] });
        const eB = P('eB', 'Bedřich', 'Lindner', { birthDate: '1872', parentIds: ['eF', 'eM'] });
        const eC = P('eC', 'Cyril', 'Lindner', { birthDate: '1874', parentIds: ['eF', 'eM'] });
        const eF = P('eF', 'Ignác', 'Lindner', { birthDate: '1840', deathDate: '1910', partnerships: ['eU'], childIds: ['eC', 'eA', 'eB'] });
        const eM = P('eM', 'Marta', 'Lindnerová', { gender: 'female', birthDate: '1845', partnerships: ['eU'], childIds: ['eB', 'eC', 'eA'] });
        const existingData = tree([eA, eB, eC, eF, eM], [U('eU', 'eF', 'eM', ['eC', 'eA', 'eB'])]);
        const iF = P('iF', 'Ignác', 'Lindner', { birthDate: '1840', deathDate: '1910', childIds: ['iD'] });
        const iD = P('iD', 'Dorota', 'Lindnerová', { gender: 'female', birthDate: '1880', parentIds: ['iF'] });
        const incomingData = tree([iF, iD]);
        const state: MergeState = {
            existingData, incomingData,
            matches: [match(eF, iF, 95)],
            unmatchedExisting: [], unmatchedIncoming: ['iD'] as PersonId[],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const result = await executeMerge(state);
        const merged = result.mergedData;
        const dorota = Object.values(merged.persons).find(p => p.firstName === 'Dorota')!;
        expect(merged.persons['eF' as PersonId].childIds).toEqual(['eC', 'eA', 'eB', dorota.id]);
        expect(merged.persons['eM' as PersonId].childIds).toEqual(['eB', 'eC', 'eA']);
        expect(merged.partnerships['eU' as PartnershipId].childIds).toEqual(['eC', 'eA', 'eB']);
    });
});
