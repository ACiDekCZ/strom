/**
 * Merge session persistence: the "update existing only" flag (Primitive 1)
 * survives a save/resume round-trip, and sessions saved before the flag
 * existed resume with it defaulting to false.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveCurrentMerge, getCurrentMerge } from '../merge/persistence.js';
import { StorageManager } from '../storage.js';
import { MergeState } from '../merge/types.js';
import { StromData, PersonId } from '../types.js';

function emptyTree(): StromData {
    return { persons: {}, partnerships: {} };
}

function baseState(updateOnly?: boolean): MergeState {
    return {
        existingData: emptyTree(),
        incomingData: emptyTree(),
        matches: [],
        unmatchedExisting: [],
        unmatchedIncoming: [],
        decisions: new Map(),
        conflictResolutions: new Map(),
        phase: 'reviewing',
        ...(updateOnly === undefined ? {} : { updateOnly }),
    };
}

let store: Map<string, unknown>;

beforeEach(() => {
    store = new Map();
    vi.spyOn(StorageManager, 'set').mockImplementation(async (ns: string, key: string, val: unknown) => {
        store.set(`${ns}:${key}`, structuredClone(val));
    });
    vi.spyOn(StorageManager, 'get').mockImplementation(async (ns: string, key: string) => {
        return (store.get(`${ns}:${key}`) ?? null) as never;
    });
});

describe('merge session persistence — updateOnly flag', () => {
    it('round-trips updateOnly=true', async () => {
        await saveCurrentMerge(baseState(true), 'file.json');
        const resumed = await getCurrentMerge();
        expect(resumed).not.toBeNull();
        expect(resumed!.updateOnly).toBe(true);
    });

    it('round-trips updateOnly=false', async () => {
        await saveCurrentMerge(baseState(false), 'file.json');
        const resumed = await getCurrentMerge();
        expect(resumed!.updateOnly).toBe(false);
    });

    it('old sessions without the field resume with updateOnly=false', async () => {
        // Simulate a session saved before the flag existed: build the stored
        // shape by hand, omitting updateOnly from the serialized state.
        const legacySession = {
            id: 'current',
            savedAt: new Date().toISOString(),
            incomingFileName: 'legacy.json',
            stats: { total: 0, reviewed: 0, resolved: 0, conflicts: 0 },
            state: {
                existingData: emptyTree(),
                incomingData: emptyTree(),
                matches: [],
                unmatchedExisting: [],
                unmatchedIncoming: [] as PersonId[],
                decisions: [],
                conflictResolutions: [],
                phase: 'reviewing',
                // NOTE: no updateOnly field
            },
        };
        await StorageManager.set('merge', 'current', legacySession);

        const resumed = await getCurrentMerge();
        expect(resumed).not.toBeNull();
        expect(resumed!.updateOnly).toBe(false);
    });
});

describe('merge session persistence — suggestions are not resolutions (spec 134 K0.3)', () => {
    function legacyWithSuggestion(answered: boolean) {
        const existing = { id: 'e1', firstName: 'Jan', lastName: 'Novák', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate: '1880' };
        const incoming = { ...existing, id: 'i1', birthDate: '1880-05-15' };
        // Saved before suggestions stopped being the default: the suggested
        // side sits in `resolution`.
        const conflicts = [{ field: 'birthDate', existingValue: '1880', incomingValue: '1880-05-15', resolution: 'use_incoming', suggestedReason: 'more_precise_date' }];
        return {
            id: 'current', savedAt: new Date().toISOString(), incomingFileName: 'legacy.json',
            stats: { total: 1, reviewed: 0, resolved: 0, conflicts: 1 },
            state: {
                existingData: { persons: { e1: existing }, partnerships: {} },
                incomingData: { persons: { i1: incoming }, partnerships: {} },
                matches: [{ existingId: 'e1', incomingId: 'i1', confidence: 'high', reasons: [], score: 95, existingPerson: existing, incomingPerson: incoming, conflicts }],
                unmatchedExisting: [], unmatchedIncoming: [], decisions: [],
                conflictResolutions: answered ? [['i1', structuredClone(conflicts)]] : [],
                phase: 'reviewing',
            },
        };
    }

    it('an unanswered suggestion of an old session resumes as keep-existing with the hint', async () => {
        await StorageManager.set('merge', 'current', legacyWithSuggestion(false));
        const resumed = await getCurrentMerge();
        const c = resumed!.matches[0].conflicts[0];
        expect(c.resolution).toBe('keep_existing');
        expect(c.suggested).toBe('use_incoming');
    });

    it('a choice a person made in the old session stays', async () => {
        await StorageManager.set('merge', 'current', legacyWithSuggestion(true));
        const resumed = await getCurrentMerge();
        expect(resumed!.matches[0].conflicts[0].resolution).toBe('use_incoming');
    });
});
