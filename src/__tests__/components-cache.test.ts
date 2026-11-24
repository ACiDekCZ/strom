/**
 * Change structure… (spec 139 §5.3): the separate parts of a tree are
 * counted once per tree and change; Separate disconnected parts… right after
 * the dialog's count takes them from the cache. An edit of the open tree
 * (its data revision) or a saved change of another tree counts again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = { current: 't-open', revision: 1, modified: { 't-open': '2026-11-01', 't-other': '2026-11-02' } as Record<string, string> };

vi.mock('../data.js', () => ({
    DataManager: {
        getCurrentTreeId: () => env.current,
        getRevision: () => env.revision,
    },
}));
vi.mock('../tree-manager.js', () => ({
    TreeManager: {
        getTreeMetadata: (id: string) => (env.modified[id] ? { id, lastModifiedAt: env.modified[id] } : undefined),
    },
}));

import { componentsKey, componentsOf, componentsKnown } from '../ui/components-cache.js';
import type { StromData, TreeId } from '../types.js';

const person = (id: string, last: string): Record<string, unknown> => ({
    id, firstName: id, lastName: last, gender: 'male', partnerships: [], parentIds: [], childIds: [],
});

/** Ostrožní and, with no tie to them, one Jesenský. */
const data = (): StromData => ({
    version: 1,
    persons: { jan: person('jan', 'Ostrožní'), karel: person('karel', 'Jesenský') },
    partnerships: {},
} as unknown as StromData);

beforeEach(() => {
    env.revision = 1;
});

describe('the parts of a tree, counted once per change', () => {
    it('the same tree as it was: the parts of the first count, not counted again', () => {
        const key = componentsKey('t-open' as TreeId);
        const first = componentsOf(key, data());
        expect(first).toHaveLength(2);
        expect(componentsKnown(key)).toBe(first);
        expect(componentsOf(componentsKey('t-open' as TreeId), data())).toBe(first);
    });

    it('an edit of the open tree counts again', () => {
        const before = componentsKey('t-open' as TreeId);
        componentsOf(before, data());
        env.revision = 2;
        const after = componentsKey('t-open' as TreeId);
        expect(after).not.toBe(before);
        expect(componentsKnown(after)).toBeNull();
    });

    it('a tree not open: its saved change decides, not the open tree\'s edits', () => {
        const key = componentsKey('t-other' as TreeId);
        env.revision = 5;
        expect(componentsKey('t-other' as TreeId)).toBe(key);
        env.modified['t-other'] = '2026-11-03';
        expect(componentsKey('t-other' as TreeId)).not.toBe(key);
    });
});
