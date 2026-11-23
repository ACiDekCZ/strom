import { describe, it, expect } from 'vitest';
import { followBlocksTree, type FollowBlockState } from '../live-follow-block';

const base: FollowBlockState = {
    on: true, session: { treeId: 'tree_konvalinkovi' }, treeId: 'tree_konvalinkovi', openTreeId: 'tree_konvalinkovi', working: true,
};

describe('following blocks a merge target only when it is following the screen shows (134, bod 10)', () => {
    it('blocks: ◎ on, the live session of this open tree, the agent working on someone', () => {
        expect(followBlocksTree(base)).toBe(true);
    });
    it('◎ stored on with a running bridge but the agent idle ("waiting for the agent") does not block', () => {
        expect(followBlocksTree({ ...base, working: false })).toBe(false);
    });
    it('◎ stored on without any live session (a linked tree, bridge not running) does not block', () => {
        expect(followBlocksTree({ ...base, session: null })).toBe(false);
    });
    it('a copy or another tree open while the session is of the research tree does not block', () => {
        expect(followBlocksTree({ ...base, treeId: 'tree_kopie', openTreeId: 'tree_kopie' })).toBe(false);
    });
    it('◎ off, an ended session, or the tree not open do not block', () => {
        expect(followBlocksTree({ ...base, on: false })).toBe(false);
        expect(followBlocksTree({ ...base, session: { treeId: 'tree_konvalinkovi', ended: true } })).toBe(false);
        expect(followBlocksTree({ ...base, openTreeId: null })).toBe(false);
    });
});
