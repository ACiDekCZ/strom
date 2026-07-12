/**
 * Undo / Redo tests.
 *
 * Two layers:
 *  - UndoManager in isolation (stack bounds, redo invalidation, tree switch).
 *  - DataManager mutations end-to-end (add/edit/delete person, partnership,
 *    parent-child move, merge) with persistence stubbed, verifying that
 *    undo/redo cycles return byte-identical data.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager, MAX_UNDO_STEPS } from '../undo.js';
import { StromData, PersonId, TreeId, NewPersonData, Gender } from '../types.js';

const TREE = 'undo-test-tree' as TreeId;

function emptyData(): StromData {
    return { persons: {}, partnerships: {} };
}

function snapshot(): StromData {
    return structuredClone(DataManager.getData());
}

function personData(firstName: string, gender: Gender = 'male'): NewPersonData {
    return { firstName, lastName: 'Test', gender };
}

/** Reset the singletons to a clean in-memory tree with persistence stubbed. */
function reset(): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as {
        data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    };
    dm.data = emptyData();
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    // Force a fresh, empty history for TREE.
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

beforeEach(reset);

describe('UndoManager', () => {
    it('undo returns the pushed snapshot and stashes current for redo', () => {
        const before: StromData = { persons: {}, partnerships: {} };
        const after: StromData = { persons: {}, partnerships: {} };
        UndoManager.push({ data: before, description: 'a' });
        const undone = UndoManager.undo(after);
        expect(undone?.data).toBe(before);
        expect(UndoManager.canRedo()).toBe(true);
        const redone = UndoManager.redo(before);
        expect(redone?.data).toBe(after);
    });

    it('a new push clears the redo stack', () => {
        UndoManager.push({ data: emptyData(), description: 'a' });
        UndoManager.undo(emptyData());
        expect(UndoManager.canRedo()).toBe(true);
        UndoManager.push({ data: emptyData(), description: 'b' });
        expect(UndoManager.canRedo()).toBe(false);
    });

    it(`keeps at most ${MAX_UNDO_STEPS} steps`, () => {
        for (let i = 0; i < MAX_UNDO_STEPS + 10; i++) {
            UndoManager.push({ data: emptyData(), description: `step ${i}` });
        }
        let count = 0;
        while (UndoManager.undo(emptyData())) count++;
        expect(count).toBe(MAX_UNDO_STEPS);
    });

    it('switching the active tree clears both stacks', () => {
        UndoManager.push({ data: emptyData(), description: 'a' });
        expect(UndoManager.canUndo()).toBe(true);
        UndoManager.setActiveTree('other-tree' as TreeId);
        expect(UndoManager.canUndo()).toBe(false);
        expect(UndoManager.canRedo()).toBe(false);
    });

    it('undo on an empty stack returns null', () => {
        expect(UndoManager.undo(emptyData())).toBeNull();
        expect(UndoManager.redo(emptyData())).toBeNull();
    });
});

describe('DataManager undo/redo', () => {
    it('undoes and redoes adding a person (deep equal)', () => {
        const empty = snapshot();
        const p = DataManager.createPerson(personData('Alice', 'female'));
        const afterAdd = snapshot();
        expect(DataManager.getPerson(p.id)).not.toBeNull();

        expect(DataManager.undo()).toEqual({ description: expect.any(String) });
        expect(DataManager.getData()).toEqual(empty);
        expect(DataManager.getPerson(p.id)).toBeNull();

        expect(DataManager.redo()).not.toBeNull();
        expect(DataManager.getData()).toEqual(afterAdd);
    });

    it('undoes and redoes editing a person', () => {
        const p = DataManager.createPerson(personData('Bob'));
        const beforeEdit = snapshot();
        DataManager.updatePerson(p.id, { firstName: 'Robert' });
        const afterEdit = snapshot();
        expect(DataManager.getPerson(p.id)?.firstName).toBe('Robert');

        DataManager.undo();
        expect(DataManager.getData()).toEqual(beforeEdit);
        expect(DataManager.getPerson(p.id)?.firstName).toBe('Bob');

        DataManager.redo();
        expect(DataManager.getData()).toEqual(afterEdit);
    });

    it('undoes and redoes deleting a person', () => {
        const p = DataManager.createPerson(personData('Carol', 'female'));
        const beforeDelete = snapshot();
        DataManager.deletePerson(p.id);
        expect(DataManager.getPerson(p.id)).toBeNull();

        DataManager.undo();
        expect(DataManager.getData()).toEqual(beforeDelete);
        expect(DataManager.getPerson(p.id)).not.toBeNull();
    });

    it('undoes creating a partnership', () => {
        const a = DataManager.createPerson(personData('Dad', 'male'));
        const b = DataManager.createPerson(personData('Mom', 'female'));
        const beforePartnership = snapshot();
        const partnership = DataManager.createPartnership(a.id, b.id);
        expect(partnership).not.toBeNull();

        DataManager.undo();
        expect(DataManager.getData()).toEqual(beforePartnership);
    });

    it('undoes a parent-child link (child move)', () => {
        const parent = DataManager.createPerson(personData('Parent'));
        const child = DataManager.createPerson(personData('Child'));
        const beforeLink = snapshot();
        DataManager.addParentChild(parent.id, child.id);
        expect(DataManager.getPerson(parent.id)?.childIds).toContain(child.id);

        DataManager.undo();
        expect(DataManager.getData()).toEqual(beforeLink);
    });

    it('undoes merging two persons', () => {
        const keep = DataManager.createPerson(personData('Jan'));
        const other = DataManager.createPerson(personData('Honza'));
        const beforeMerge = snapshot();
        const ok = DataManager.mergePersons(keep.id, other.id, {}, new Map());
        expect(ok).toBe(true);
        expect(DataManager.getPerson(other.id)).toBeNull();

        DataManager.undo();
        expect(DataManager.getData()).toEqual(beforeMerge);
        expect(DataManager.getPerson(other.id)).not.toBeNull();
    });

    it('a new mutation clears the redo stack', () => {
        DataManager.createPerson(personData('One'));
        DataManager.undo();
        expect(DataManager.canRedo()).toBe(true);
        DataManager.createPerson(personData('Two'));
        expect(DataManager.canRedo()).toBe(false);
    });

    it('survives multiple undo/redo cycles returning to identical data', () => {
        const start = snapshot();
        const p = DataManager.createPerson(personData('Eve', 'female'));
        DataManager.updatePerson(p.id, { lastName: 'Newname' });
        const end = snapshot();

        DataManager.undo();
        DataManager.undo();
        expect(DataManager.getData()).toEqual(start);
        DataManager.redo();
        DataManager.redo();
        expect(DataManager.getData()).toEqual(end);
        DataManager.undo();
        DataManager.undo();
        expect(DataManager.getData()).toEqual(start);
    });

    it('does nothing when there is nothing to undo', () => {
        expect(DataManager.undo()).toBeNull();
        expect(DataManager.redo()).toBeNull();
    });
});
