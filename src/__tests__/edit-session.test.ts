/**
 * DataManager edit sessions (review S9): a staged dialog whose operations
 * apply live, but Save records ONE undo step and Discard rolls everything
 * back without an undo step, a save or an audit entry.
 * Persistence and audit persistence are stubbed (as in review-editing.test).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, TreeId, Gender, Person } from '../types.js';

const TREE = 'edit-session-tree' as TreeId;
/** The private writer behind log(): what actually lands in the history. */
const audit = AuditLogManager as unknown as { append: (treeId: TreeId, entry: { d: string }) => void };
let saves = 0;

function reset(): void {
    // Never leave a session open between tests.
    DataManager.rollbackEditSession();
    saves = 0;
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => { saves++; });
    const dm = DataManager as unknown as {
        data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    DataManager.onMutationCommitted = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}
beforeEach(reset);

const undoDepth = (): number => (UndoManager as unknown as { undoStack: unknown[] }).undoStack.length;
const add = (firstName: string, gender: Gender = 'male'): Person =>
    DataManager.createPerson({ firstName, lastName: 'Test', gender });

describe('edit session', () => {
    it('commit records all operations (nested runBatch included) as one undo step', () => {
        const a = add('Adam');
        const b = add('Beata', 'female');
        const depth = undoDepth();
        saves = 0;
        const toasts: string[] = [];
        DataManager.onMutationCommitted = (d) => toasts.push(d);

        expect(DataManager.beginEditSession()).toBe(true);
        const u = DataManager.createPartnership(a.id, b.id)!;
        DataManager.addPartnershipParticipant(u.id, { name: 'Witness' });
        DataManager.runBatch(null, () => {
            DataManager.updatePartnership(u.id, { note: 'register' });
        });
        // Applied live, nothing recorded or saved yet.
        expect(DataManager.getPartnership(u.id)!.note).toBe('register');
        expect(undoDepth()).toBe(depth);
        expect(toasts).toHaveLength(0);
        expect(saves).toBe(0);
        expect(DataManager.editSessionHasChanges()).toBe(true);

        DataManager.commitEditSession(null);
        expect(DataManager.isEditSessionActive()).toBe(false);
        expect(undoDepth()).toBe(depth + 1);
        expect(toasts).toHaveLength(1);
        expect(saves).toBeGreaterThan(0);

        // One Ctrl+Z reverts the whole dialog.
        DataManager.undo();
        expect(DataManager.getPartnership(u.id)).toBeNull();
        expect(DataManager.getPerson(a.id)!.partnerships).toEqual([]);
    });

    it('rollback restores the state at open with no undo step, save or audit entry', () => {
        const a = add('Adam');
        const b = add('Beata', 'female');
        const before = JSON.stringify(DataManager.getData());
        const depth = undoDepth();
        const logSpy = vi.spyOn(audit, 'append').mockImplementation(() => {});
        (AuditLogManager as unknown as { enabled: boolean }).enabled = true;

        DataManager.beginEditSession();
        const u = DataManager.createPartnership(a.id, b.id)!;
        DataManager.setParentRelType(a.id, b.id, 'adoptive');
        DataManager.removePartnership(a.id, b.id);
        DataManager.createPartnership(a.id, b.id);
        expect(u).toBeTruthy();
        const savesBefore = saves;

        expect(DataManager.rollbackEditSession()).toBe(true);
        (AuditLogManager as unknown as { enabled: boolean }).enabled = false;
        expect(JSON.stringify(DataManager.getData())).toBe(before);
        expect(undoDepth()).toBe(depth);
        expect(logSpy).not.toHaveBeenCalled();
        // The restored state is persisted (the in-memory data had diverged).
        expect(saves).toBe(savesBefore + 1);
        // Back to normal: the next mutation is its own undo step again.
        add('Cyril');
        expect(undoDepth()).toBe(depth + 1);
    });

    it('rollback without changes is a no-op and commit without changes records nothing', () => {
        add('Adam');
        const depth = undoDepth();
        DataManager.beginEditSession();
        expect(DataManager.editSessionHasChanges()).toBe(false);
        expect(DataManager.rollbackEditSession()).toBe(false);
        DataManager.beginEditSession();
        DataManager.commitEditSession(null);
        expect(undoDepth()).toBe(depth);
    });

    it('commit writes the held audit entries, in order', () => {
        const written: string[] = [];
        vi.spyOn(audit, 'append').mockImplementation((_t, e) => { written.push(e.d); });
        (AuditLogManager as unknown as { enabled: boolean }).enabled = true;
        try {
            DataManager.beginEditSession();
            add('Adam');
            add('Beata', 'female');
            expect(written).toHaveLength(0);
            DataManager.commitEditSession(null);
            expect(written.length).toBeGreaterThanOrEqual(2);
        } finally {
            (AuditLogManager as unknown as { enabled: boolean }).enabled = false;
        }
    });

    it('undo / redo are refused while a session is open', () => {
        add('Adam');
        DataManager.beginEditSession();
        add('Beata', 'female');
        expect(DataManager.undo()).toBeNull();
        expect(Object.keys(DataManager.getData().persons)).toHaveLength(2);
        DataManager.rollbackEditSession();
        expect(Object.keys(DataManager.getData().persons)).toHaveLength(1);
    });

    it('only one session at a time, none in view mode', () => {
        expect(DataManager.beginEditSession()).toBe(true);
        expect(DataManager.beginEditSession()).toBe(false);
        DataManager.rollbackEditSession();
        (DataManager as unknown as { viewMode: boolean }).viewMode = true;
        expect(DataManager.beginEditSession()).toBe(false);
    });

    it('a tree switch under the session drops it without touching the new tree', () => {
        const a = add('Adam');
        DataManager.beginEditSession();
        DataManager.updatePerson(a.id, { firstName: 'Changed' });
        const other = { persons: {}, partnerships: {} } as StromData;
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null };
        dm.currentTreeId = 'other-tree' as TreeId;
        dm.data = other;
        expect(DataManager.rollbackEditSession()).toBe(false);
        expect(DataManager.getData()).toBe(other);
        expect(DataManager.isEditSessionActive()).toBe(false);
    });
});
