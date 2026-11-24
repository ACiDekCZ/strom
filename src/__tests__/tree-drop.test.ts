/**
 * Drops on a tree's row in Manage trees (spec 134 K10.3): what a dropped file
 * or a dragged tree does there, and which target the import guide starts with
 * (the tree dropped on; a blocked one is not chosen and Add to a tree stays).
 */

import { describe, it, expect } from 'vitest';
import { initialMergeTarget, shortName, treeRowDrop, treeRowFileRoute } from '../tree-drop.js';

describe('treeRowDrop', () => {
    const edit = { canEdit: true };

    it('a file on a row: the guide with that tree as the target', () => {
        expect(treeRowDrop({ kind: 'files' }, 'tB', edit)).toEqual({ kind: 'file', target: 'tB' });
    });

    it('a tree on another row: the dragged tree the import, the row its target', () => {
        expect(treeRowDrop({ kind: 'tree', treeId: 'tA' }, 'tB', edit)).toEqual({ kind: 'tree', source: 'tA', target: 'tB' });
    });

    it('a tree on its own row, off a row, nothing dragged or a read-only app: nothing', () => {
        expect(treeRowDrop({ kind: 'tree', treeId: 'tA' }, 'tA', edit)).toEqual({ kind: 'none' });
        expect(treeRowDrop({ kind: 'files' }, null, edit)).toEqual({ kind: 'none' });
        expect(treeRowDrop(null, 'tB', edit)).toEqual({ kind: 'none' });
        expect(treeRowDrop({ kind: 'files' }, 'tB', { canEdit: false })).toEqual({ kind: 'none' });
        expect(treeRowDrop({ kind: 'tree', treeId: 'tA' }, 'tB', { canEdit: false })).toEqual({ kind: 'none' });
    });
});

describe('treeRowFileRoute', () => {
    it('a GEDCOM file or a Strom tree opens the guide; anything else is refused, never a research batch', () => {
        expect(treeRowFileRoute(['rodokmen.ged'])).toBe('guide-ged');
        expect(treeRowFileRoute(['strom.JSON'])).toBe('json');
        expect(treeRowFileRoute(['foto.jpg'])).toBe('refuse');
        expect(treeRowFileRoute(['foto.jpg', 'rodokmen.ged'])).toBe('refuse');
        expect(treeRowFileRoute(['rodokmen.ged', 'foto.jpg'])).toBe('guide-ged');
        expect(treeRowFileRoute([])).toBe('none');
    });
});

describe('shortName', () => {
    it('keeps a short name, cuts a long one with an ellipsis', () => {
        expect(shortName('Modřínovi')).toBe('Modřínovi');
        const cut = shortName('Rodokmen rodu Modřínů z Dolní Vsi u Lesa', 20);
        expect(Array.from(cut)).toHaveLength(20);
        expect(cut.endsWith('…')).toBe(true);
    });
});

describe('initialMergeTarget', () => {
    const trees = ['tOpen', 'tB', 'tLocked'];
    const usable = (id: string | null): boolean => !!id && id !== 'tLocked';

    it('the tree dropped on is the target, open or not, Add to a tree', () => {
        expect(initialMergeTarget({ requested: 'tB', openId: 'tOpen', trees, usable, twoTrees: false })).toEqual({ targetId: 'tB', keepAdd: true });
        expect(initialMergeTarget({ requested: 'tOpen', openId: 'tOpen', trees, usable, twoTrees: true })).toEqual({ targetId: 'tOpen', keepAdd: true });
    });

    it('a blocked tree dropped on: no other tree is chosen for it, Add to a tree stays (step 1 says why on its tile)', () => {
        expect(initialMergeTarget({ requested: 'tLocked', openId: 'tOpen', trees, usable, twoTrees: true })).toEqual({ targetId: null, keepAdd: true });
    });

    it('nothing asked: the open tree, else for two trees the first that can take it, else none', () => {
        expect(initialMergeTarget({ openId: 'tOpen', trees, usable, twoTrees: false })).toEqual({ targetId: 'tOpen', keepAdd: false });
        expect(initialMergeTarget({ openId: 'tLocked', trees, usable, twoTrees: true })).toEqual({ targetId: 'tOpen', keepAdd: false });
        expect(initialMergeTarget({ openId: 'tLocked', trees, usable, twoTrees: false })).toEqual({ targetId: null, keepAdd: false });
    });
});
