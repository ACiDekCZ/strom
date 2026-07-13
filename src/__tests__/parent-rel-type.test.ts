/**
 * Parent→child relationship type tests: DataManager.setParentRelType (with undo),
 * the 'biological' default that clears the record, and cleanup when the
 * parent-child link is removed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, NewPersonData, Gender } from '../types.js';

const TREE = 'parentrel-test-tree' as TreeId;

function personData(firstName: string, gender: Gender = 'male'): NewPersonData {
    return { firstName, lastName: 'Test', gender };
}

function reset(): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as {
        data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

/** Create a parent + child linked pair. Returns their ids. */
function parentChild(): { parentId: PersonId; childId: PersonId } {
    const parent = DataManager.createPerson(personData('Parent'));
    const child = DataManager.createPerson(personData('Child'));
    DataManager.addParentChild(parent.id, child.id);
    return { parentId: parent.id, childId: child.id };
}

beforeEach(reset);

describe('setParentRelType', () => {
    it('sets an adoptive type and undo restores biological', () => {
        const { parentId, childId } = parentChild();
        expect(DataManager.setParentRelType(childId, parentId, 'adoptive')).toBe(true);
        expect(DataManager.getPerson(childId)?.parentRelTypes?.[parentId]).toBe('adoptive');

        DataManager.undo();
        expect(DataManager.getPerson(childId)?.parentRelTypes).toBeUndefined();
    });

    it("'biological' clears the record (it is the default)", () => {
        const { parentId, childId } = parentChild();
        DataManager.setParentRelType(childId, parentId, 'foster');
        expect(DataManager.getPerson(childId)?.parentRelTypes?.[parentId]).toBe('foster');
        DataManager.setParentRelType(childId, parentId, 'biological');
        expect(DataManager.getPerson(childId)?.parentRelTypes).toBeUndefined();
    });

    it('rejects a parent that is not actually a parent of the child', () => {
        const parent = DataManager.createPerson(personData('Parent'));
        const child = DataManager.createPerson(personData('Child'));
        expect(DataManager.setParentRelType(child.id, parent.id, 'adoptive')).toBe(false);
    });

    it('is cleaned up when the parent-child link is removed', () => {
        const { parentId, childId } = parentChild();
        DataManager.setParentRelType(childId, parentId, 'step');
        DataManager.removeParentChild(parentId, childId);
        expect(DataManager.getPerson(childId)?.parentRelTypes).toBeUndefined();
    });
});

describe('person merge keeps parent relationship types', () => {
    it('re-keys a child\'s parentRelTypes when their parent is merged away', () => {
        const { parentId, childId } = parentChild();
        const keepParent = DataManager.createPerson(personData('KeptParent'));
        DataManager.setParentRelType(childId, parentId, 'adoptive');
        expect(DataManager.getPerson(childId)?.parentRelTypes?.[parentId]).toBe('adoptive');

        const ok = DataManager.mergePersons(keepParent.id, parentId, {}, new Map());
        expect(ok).toBe(true);
        const child = DataManager.getPerson(childId)!;
        expect(child.parentIds).toContain(keepParent.id);
        expect(child.parentRelTypes?.[keepParent.id]).toBe('adoptive');
        expect(child.parentRelTypes?.[parentId]).toBeUndefined();
    });

    it('carries the removed person\'s own parent rel types when parents transfer', () => {
        const { parentId, childId } = parentChild();
        DataManager.setParentRelType(childId, parentId, 'foster');
        const keepChild = DataManager.createPerson(personData('KeptChild'));

        const ok = DataManager.mergePersons(keepChild.id, childId, {}, new Map());
        expect(ok).toBe(true);
        const kept = DataManager.getPerson(keepChild.id)!;
        expect(kept.parentIds).toContain(parentId);
        expect(kept.parentRelTypes?.[parentId]).toBe('foster');
    });
});
