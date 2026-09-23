/**
 * A union both trees know but describe differently (status, dates, place)
 * surfaces as a partnership conflict the user resolves, instead of being
 * silently kept from the existing tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    executeMerge,
    detectPartnershipConflicts,
    updatePartnershipConflictResolution
} from '../merge/executor.js';
import { calculateMergeStats } from '../merge/matching.js';
import { StorageManager } from '../storage.js';
import { MergeState, PersonMatch } from '../merge/types.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender } from '../types.js';

function P(id: string, first: string, gender: Gender, partnerships: string[]): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'Testfield', gender, isPlaceholder: false,
        partnerships: partnerships as PartnershipId[], parentIds: [], childIds: [],
    };
}
function U(id: string, p1: string, p2: string, o: Partial<Partnership> = {}): Partnership {
    return {
        id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId,
        childIds: [], status: 'married', ...o,
    };
}
function tree(persons: Person[], partnerships: Partnership[]): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
function match(existing: Person, incoming: Person, score = 95): PersonMatch {
    return {
        existingId: existing.id, incomingId: incoming.id, confidence: 'high',
        reasons: [], score, existingPerson: existing, incomingPerson: incoming, conflicts: [],
    };
}

function scenario(incomingUnion: Partial<Partnership>): MergeState {
    const H = P('H', 'Adam', 'male', ['U1']);
    const W = P('W', 'Eva', 'female', ['U1']);
    const existingData = tree([H, W], [U('U1', 'H', 'W', {
        status: 'married', startDate: '1900-05-01', startPlace: 'Oakfield', endDate: undefined,
    })]);
    const iH = P('iH', 'Adam', 'male', ['iU1']);
    const iW = P('iW', 'Eva', 'female', ['iU1']);
    // Incoming lists the partners the other way round — still the same union.
    const incomingData = tree([iH, iW], [U('iU1', 'iW', 'iH', incomingUnion)]);
    return {
        existingData, incomingData,
        matches: [match(H, iH), match(W, iW)],
        unmatchedExisting: [], unmatchedIncoming: [],
        decisions: new Map(), conflictResolutions: new Map(), phase: 'reviewing',
    };
}

beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('partnership conflicts in tree merge', () => {
    it('detects differing status, start date and place; a one-sided end date is no conflict', () => {
        const state = scenario({ status: 'divorced', startDate: '1901-05-01', startPlace: 'Elmwood', endDate: '1920' });
        const conflicts = detectPartnershipConflicts(state);
        expect(conflicts.map(c => c.field).sort()).toEqual(['startDate', 'startPlace', 'status']);
        expect(conflicts.every(c => c.resolution === 'keep_existing')).toBe(true);
        const status = conflicts.find(c => c.field === 'status')!;
        expect(status.existingValue).toBe('married');
        expect(status.incomingValue).toBe('divorced');
        expect(status.existingPartnershipId).toBe('U1');
        expect(status.incomingPartnershipId).toBe('iU1');
    });

    it('identical unions produce no conflict', () => {
        const state = scenario({ status: 'married', startDate: '1900-05-01', startPlace: 'Oakfield' });
        expect(detectPartnershipConflicts(state)).toEqual([]);
        expect(calculateMergeStats(state).partnershipConflicts).toBe(0);
    });

    it('depends on the person decisions: a rejected partner means no shared union', () => {
        const state = scenario({ status: 'divorced' });
        expect(detectPartnershipConflicts(state)).toHaveLength(1);
        state.decisions.set('iW' as PersonId, { type: 'reject' });
        expect(detectPartnershipConflicts(state)).toEqual([]);
        state.decisions.set('iW' as PersonId, { type: 'skip' });
        expect(detectPartnershipConflicts(state)).toEqual([]);
    });

    it('a weak undecided match does not count, a manual match does', () => {
        const state = scenario({ status: 'separated' });
        state.matches[1].score = 30;
        expect(detectPartnershipConflicts(state)).toEqual([]);
        state.decisions.set('iW' as PersonId, { type: 'manual_match', targetId: 'W' as PersonId });
        expect(detectPartnershipConflicts(state)).toHaveLength(1);
    });

    it('stats count conflicting unions and those the user resolved', () => {
        const state = scenario({ status: 'divorced', startDate: '1901' });
        let stats = calculateMergeStats(state);
        expect(stats.partnershipConflicts).toBe(1);
        expect(stats.partnershipConflictsResolved).toBe(0);
        updatePartnershipConflictResolution(state, 'iU1' as PartnershipId, 'status', 'keep_existing');
        stats = calculateMergeStats(state);
        expect(stats.partnershipConflictsResolved).toBe(1);
    });

    it('default keeps the existing values', async () => {
        const state = scenario({ status: 'divorced', startDate: '1901-05-01', endDate: '1920' });
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const unions = Object.values(result.mergedData.partnerships);
        expect(unions).toHaveLength(1);
        expect(unions[0].status).toBe('married');
        expect(unions[0].startDate).toBe('1900-05-01');
        // Non-conflicting one-sided value is still filled in.
        expect(unions[0].endDate).toBe('1920');
    });

    it('use_incoming applies per field, the rest stays', async () => {
        const state = scenario({ status: 'divorced', startDate: '1901-05-01', startPlace: 'Elmwood' });
        updatePartnershipConflictResolution(state, 'iU1' as PartnershipId, 'status', 'use_incoming');
        updatePartnershipConflictResolution(state, 'iU1' as PartnershipId, 'startPlace', 'use_incoming');
        updatePartnershipConflictResolution(state, 'iU1' as PartnershipId, 'startDate', 'keep_existing');
        expect(detectPartnershipConflicts(state).find(c => c.field === 'status')!.resolution).toBe('use_incoming');
        const result = await executeMerge(state);
        const u = result.mergedData.partnerships['U1' as PartnershipId];
        expect(u.status).toBe('divorced');
        expect(u.startPlace).toBe('Elmwood');
        expect(u.startDate).toBe('1900-05-01');
        expect(Object.keys(result.mergedData.partnerships)).toEqual(['U1']);
        // The existing tree itself is untouched (the merge works on a clone).
        expect(state.existingData.partnerships['U1' as PartnershipId].status).toBe('married');
    });
});
