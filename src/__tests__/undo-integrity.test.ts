/**
 * Undo-choke-point integrity (audit K3/V9/V1): bulk operations must go
 * through beginMutation/commitMutation so the undo stack never goes stale,
 * and delete cascades must not leave dangling references.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { validateTreeData } from '../validation.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, TreeId, PersonId, PartnershipId } from '../types.js';

const TREE = 'undo-int-tree' as TreeId;

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

beforeEach(reset);

describe('bulk operations and the undo stack', () => {
    it('clearData is undoable and does not leave a stale stack', () => {
        const a = DataManager.createPerson({ firstName: 'Jan', lastName: 'N', gender: 'male' });
        DataManager.createPerson({ firstName: 'Eva', lastName: 'N', gender: 'female' });
        expect(DataManager.getAllPersons()).toHaveLength(2);

        DataManager.clearData();
        expect(DataManager.getAllPersons()).toHaveLength(0);

        // One undo returns EXACTLY the pre-clear state (both persons)...
        const result = DataManager.undo();
        expect(result).not.toBeNull();
        expect(DataManager.getAllPersons()).toHaveLength(2);
        expect(DataManager.getPerson(a.id)).not.toBeNull();
    });

    it('loadStromData (import-over) is one Ctrl+Z away', () => {
        DataManager.createPerson({ firstName: 'Original', lastName: 'X', gender: 'male' });
        const incoming: StromData = { persons: {}, partnerships: {} };
        DataManager.loadStromData(incoming);
        expect(DataManager.getAllPersons()).toHaveLength(0);
        DataManager.undo();
        expect(DataManager.getAllPersons()).toHaveLength(1);
        expect(DataManager.getAllPersons()[0].firstName).toBe('Original');
    });

    it('repairValidationIssue is undoable; a no-op repair leaves no snapshot', () => {
        const p = DataManager.createPerson({ firstName: 'Jan', lastName: 'N', gender: 'male' });
        // Plant an orphaned parent ref.
        DataManager.getPerson(p.id)!.parentIds.push('ghost' as PersonId);
        const repaired = DataManager.repairValidationIssue({
            id: 'i1', severity: 'error', type: 'orphanedParentRef',
            message: 'x', personIds: [p.id],
        });
        expect(repaired).toBe(true);
        expect(DataManager.getPerson(p.id)!.parentIds).toHaveLength(0);
        DataManager.undo();
        expect(DataManager.getPerson(p.id)!.parentIds).toEqual(['ghost']);

        // Un-fixable issue: no data change, no stray undo entry.
        const before = DataManager.getAllPersons().length;
        const nothing = DataManager.repairValidationIssue({
            id: 'i2', severity: 'error', type: 'orphanedParentRef',
            message: 'x', personIds: ['nobody' as PersonId],
        });
        expect(nothing).toBe(false);
        expect(DataManager.getAllPersons()).toHaveLength(before);
    });
});

describe('delete cascades', () => {
    it('deletePerson removes the orphaned parentRelTypes entry on children', () => {
        const dad = DataManager.createPerson({ firstName: 'Dad', lastName: 'N', gender: 'male' });
        const kid = DataManager.createPerson({ firstName: 'Kid', lastName: 'N', gender: 'male' });
        DataManager.addParentChild(dad.id, kid.id);
        DataManager.setParentRelType(kid.id, dad.id, 'adoptive');
        expect(DataManager.getPerson(kid.id)!.parentRelTypes?.[dad.id]).toBe('adoptive');

        DataManager.deletePerson(dad.id);
        const after = DataManager.getPerson(kid.id)!;
        expect(after.parentIds).toHaveLength(0);
        expect(after.parentRelTypes?.[dad.id]).toBeUndefined();
    });
});

describe('a person listing a couple that is not there (spec 134 K0.7)', () => {
    it('loading keeps it as it is, the tree check finds it and its repair removes it', () => {
        const p = DataManager.createPerson({ firstName: 'Kvido', lastName: 'Hrbolec', gender: 'male' });
        const w = DataManager.createPerson({ firstName: 'Radmila', lastName: 'Hrbolcová', gender: 'female' });
        const u = DataManager.createPartnership(p.id, w.id)!;
        DataManager.getPerson(p.id)!.partnerships.push('u_gone' as PartnershipId);

        // Loading (migration) changes nothing on its own.
        const loaded = migrateData(structuredClone(DataManager.getData()));
        expect(loaded.persons[p.id].partnerships).toEqual([u.id, 'u_gone']);

        const issues = validateTreeData(DataManager.getData()).issues.filter(i => i.type === 'orphanedPartnershipRef');
        expect(issues).toHaveLength(1);
        expect(issues[0].personIds).toEqual([p.id]);
        expect(DataManager.isFixableIssue(issues[0])).toBe(true);
        expect(DataManager.repairValidationIssue(issues[0])).toBe(true);
        expect(DataManager.getPerson(p.id)!.partnerships).toEqual([u.id]);
        expect(validateTreeData(DataManager.getData()).issues.filter(i => i.type === 'orphanedPartnershipRef')).toEqual([]);
    });
});
