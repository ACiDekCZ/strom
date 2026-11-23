/**
 * Manage trees (134 S-P1): a tree whose images another tree shares (a copy)
 * has its size noted "images shared" — the size counts the pooled images of
 * each tree, while they take their space once.
 */
import { describe, it, expect } from 'vitest';
import { sharedImageTrees } from '../snapshots.js';

describe('sharedImageTrees', () => {
    it('names both trees of a shared image, not a tree whose images are its own', () => {
        const ids = new Map<string, string[]>([
            ['original', ['a', 'b', 'c']],
            ['copy', ['b']],
            ['other', ['d', 'd']],
            ['empty', []],
        ]);
        expect([...sharedImageTrees(ids)].sort()).toEqual(['copy', 'original']);
    });

    it('three copies of one tree: all three', () => {
        const ids = new Map<string, string[]>([['t1', ['x']], ['t2', ['x']], ['t3', ['x', 'y']]]);
        expect([...sharedImageTrees(ids)].sort()).toEqual(['t1', 't2', 't3']);
    });

    it('no trees, or one image twice in one tree: none', () => {
        expect(sharedImageTrees(new Map()).size).toBe(0);
        expect(sharedImageTrees(new Map([['t1', ['x', 'x']]])).size).toBe(0);
    });
});
