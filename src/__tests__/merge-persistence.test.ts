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
