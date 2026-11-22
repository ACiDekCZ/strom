import { describe, it, expect } from 'vitest';
import { treeEditCount } from '../merge/resume-change.js';
import type { StromData } from '../types.js';

const tree = (persons: Record<string, unknown>, partnerships: Record<string, unknown> = {}): StromData =>
    ({ persons, partnerships } as unknown as StromData);

describe('treeEditCount (the change line of a saved merge, spec 134 §2)', () => {
    const a = { id: 'p1', firstName: 'Ada', lastName: 'Modřínová' };
    const b = { id: 'p2', firstName: 'Ota', lastName: 'Modřín' };
    const u = { id: 'u1', person1Id: 'p1', person2Id: 'p2' };

    it('is 0 for the same tree', () => {
        expect(treeEditCount(tree({ p1: a, p2: b }, { u1: u }), tree({ p1: a, p2: b }, { u1: u }))).toBe(0);
    });

    it('counts a person added, one removed, one changed and a partnership added', () => {
        const before = tree({ p1: a, p2: b });
        const after = tree({ p1: { ...a, birthPlace: 'Křemenná' }, p3: { id: 'p3', firstName: 'Eva', lastName: 'Jilmová' } }, { u1: u });
        expect(treeEditCount(before, after)).toBe(4);
    });
});
