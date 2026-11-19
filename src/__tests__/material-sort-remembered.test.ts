/**
 * The remembered sorting of materials (spec 102 §0, §6): a record stored
 * before runs of batches still reads (a run of one batch), a run of batches
 * is checked as stored, the closed proposal's line and the files the agent
 * left unassigned outlive a reload. Invented data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sortRememberedFrom, sortClosedFrom, sortLeftFrom, researchAutoState, patchResearchAutoState } from '../research-device.js';

const TREE = 'tree_1700000000000_qm7tv';

describe('the remembered sorting as stored', () => {
    // As 3.30.0-beta.6 stored it: one sorting of at most 50 files, no run.
    const old = {
        id: 'sort-20261117120000-ab12', files: ['I0001', 'I0002', 'I0003'], text: 'Talvanen box from the attic', at: '2026-11-17T12:00:00Z',
        decided: { I0001: 'accepted', I0002: 'rejected', I0009: 'accepted' },
        reverts: { I0001: { media: 'att-1', fields: {} } }, batch: 'Quellmayer letters',
    };

    it('reads a record stored before runs of batches as one batch (no run), as it was', () => {
        const r = sortRememberedFrom(old)!;
        expect(r).toEqual({
            id: old.id, files: old.files, text: old.text, at: old.at, batch: 'Quellmayer letters',
            decided: { I0001: 'accepted', I0002: 'rejected' },
            reverts: { I0001: { media: 'att-1', fields: {} } },
        });
        expect(r).not.toHaveProperty('run');
        expect(sortRememberedFrom({ ...old, ended: 'cancelled' })!.ended).toBe('cancelled');
    });

    it('keeps a run of batches as stored and the decided rows of every batch of it', () => {
        const run = {
            id: 'run-20261119-ab', batches: [['I0001', 'I0002'], ['I0010', 'bad', 'I0011'], []], sorts: ['sort-20261119-a1', 'nope'],
            next: 7, scope: 'selection', error: { batch: 1, code: 'limit', reason: 'The subscription’s limit was reached' }, stopped: true,
        };
        const r = sortRememberedFrom({ ...old, decided: { I0001: 'accepted', I0011: 'rejected', I0099: 'accepted' }, run })!;
        expect(r.run).toEqual({
            id: 'run-20261119-ab', batches: [['I0001', 'I0002'], ['I0010', 'I0011']], sorts: ['sort-20261119-a1'],
            next: 2, scope: 'selection', error: { batch: 1, code: 'limit', reason: 'The subscription’s limit was reached' }, stopped: true,
        });
        expect(r.decided).toEqual({ I0001: 'accepted', I0011: 'rejected' });
    });

    it('drops a run that is off (no batches) and reads an unknown scope or code safely', () => {
        expect(sortRememberedFrom({ ...old, run: { batches: [] } })).not.toHaveProperty('run');
        expect(sortRememberedFrom({ ...old, run: 'all' })).not.toHaveProperty('run');
        const r = sortRememberedFrom({ ...old, run: { id: 'not-a-run', batches: [['I0001']], scope: 'everything', error: { batch: 0, code: 'boom' } } })!;
        expect(r.run).toEqual({ batches: [['I0001']], sorts: [], next: 0, scope: 'all', error: { batch: 0, code: 'other' } });
    });

    it('the closed line and the unassigned files: anything off is left out', () => {
        expect(sortClosedFrom({ at: '2026-11-19T10:30:00Z', handled: 40, unassigned: 10, files: 50, batches: 1 }))
            .toEqual({ at: '2026-11-19T10:30:00Z', handled: 40, unassigned: 10, files: 50, batches: 1 });
        expect(sortClosedFrom({ at: 'yesterday', handled: 4 })).toBeNull();
        expect(sortClosedFrom({ at: '2026-11-19T10:30:00Z', handled: -3, unassigned: 'x' })).toEqual({ at: '2026-11-19T10:30:00Z', handled: 0, unassigned: 0, files: 0, batches: 1 });
        expect(sortLeftFrom({ I0007: { at: '2026-11-19T10:30:00Z', why: 'nothing-said' }, I0008: { at: '2026-11-19T10:30:00Z', why: 'Not A Reason!' }, bad: { at: 'x' }, I0009: 'x' }))
            .toEqual({ I0007: { at: '2026-11-19T10:30:00Z', why: 'nothing-said' }, I0008: { at: '2026-11-19T10:30:00Z' } });
    });
});

describe('the remembered sorting outlives a reload', () => {
    let store: Map<string, string>;
    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('closing the proposal: the sorting goes, its line and the unassigned files stay', () => {
        patchResearchAutoState(TREE, { materialSort: sortRememberedFrom({ id: 'sort-20261119-a1', files: ['I0001'], text: '', at: '2026-11-19T10:00:00Z', decided: {} })! });
        expect(researchAutoState(TREE).materialSort?.id).toBe('sort-20261119-a1');
        patchResearchAutoState(TREE, {
            materialSort: undefined,
            sortClosed: { at: '2026-11-19T10:30:00Z', handled: 40, unassigned: 10, files: 50, batches: 1 },
            sortLeft: { I0007: { at: '2026-11-19T10:30:00Z', why: 'unrelated' } },
        });
        const now = researchAutoState(TREE);
        expect(now.materialSort).toBeUndefined();
        expect(now.sortClosed).toEqual({ at: '2026-11-19T10:30:00Z', handled: 40, unassigned: 10, files: 50, batches: 1 });
        expect(now.sortLeft).toEqual({ I0007: { at: '2026-11-19T10:30:00Z', why: 'unrelated' } });
    });
});
