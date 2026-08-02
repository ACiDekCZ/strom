/**
 * DataManager.reassignParentChild: moving a parent→child link to a different
 * parent in one step ("I linked them to the wrong person"). The interesting
 * cases are the richly-connected ones: a child with two parents hanging under
 * a partnership, relationship types that must survive the move, and the
 * refusals (cycles, existing parents) with full rollback.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, NewPersonData, Gender } from '../types.js';

const TREE = 'reassign-test-tree' as TreeId;

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

beforeEach(reset);

/**
 * The multi-linked fixture the owner asked to verify against:
 *   couple A ⚭ B with children C (under the partnership) and S,
 *   a second couple E ⚭ F (childless),
 *   a lone wrong parent X with child D linked as 'step'.
 */
function richFamily() {
    const A = DataManager.createPerson(personData('A'));
    const B = DataManager.createPerson(personData('B', 'female'));
    const E = DataManager.createPerson(personData('E'));
    const F = DataManager.createPerson(personData('F', 'female'));
    const X = DataManager.createPerson(personData('X'));
    const C = DataManager.createPerson(personData('C'));
    const S = DataManager.createPerson(personData('S', 'female'));
    const D = DataManager.createPerson(personData('D'));
    const uAB = DataManager.createPartnership(A.id, B.id)!;
    const uEF = DataManager.createPartnership(E.id, F.id)!;
    DataManager.addParentChild(A.id, C.id, uAB.id);
    DataManager.addParentChild(B.id, C.id, uAB.id);
    DataManager.addParentChild(A.id, S.id, uAB.id);
    DataManager.addParentChild(B.id, S.id, uAB.id);
    DataManager.addParentChild(X.id, D.id);
    DataManager.setParentRelType(D.id, X.id, 'step');
    return { A: A.id, B: B.id, E: E.id, F: F.id, X: X.id, C: C.id, S: S.id, D: D.id, uAB: uAB.id, uEF: uEF.id };
}

describe('reassignParentChild', () => {
    it('moves a lone-parent link and keeps the relationship type', () => {
        const f = richFamily();
        expect(DataManager.reassignParentChild(f.D, f.X, f.E)).toBe(true);
        const d = DataManager.getPerson(f.D)!;
        expect(d.parentIds).toEqual([f.E]);
        expect(DataManager.getPerson(f.X)!.childIds).not.toContain(f.D);
        expect(DataManager.getPerson(f.E)!.childIds).toContain(f.D);
        // 'step' survived the move; the old record is gone.
        expect(d.parentRelTypes?.[f.E]).toBe('step');
        expect(d.parentRelTypes?.[f.X]).toBeUndefined();
    });

    it('re-hangs the child under the new parent\'s union with the remaining parent', () => {
        const f = richFamily();
        // C's father A was wrong; the real father is E — but E has no union
        // with B, so C stays a plain child of both. Then move B → F, where a
        // union E⚭F exists: C must land in ITS childIds.
        expect(DataManager.reassignParentChild(f.C, f.A, f.E)).toBe(true);
        let c = DataManager.getPerson(f.C)!;
        expect(new Set(c.parentIds)).toEqual(new Set([f.B, f.E]));
        const uAB = DataManager.getData().partnerships[f.uAB]!;
        expect(uAB.childIds).not.toContain(f.C);          // left the A⚭B union
        expect(uAB.childIds).toContain(f.S);              // sibling untouched
        expect(DataManager.getData().partnerships[f.uEF]!.childIds).not.toContain(f.C);

        expect(DataManager.reassignParentChild(f.C, f.B, f.F)).toBe(true);
        c = DataManager.getPerson(f.C)!;
        expect(new Set(c.parentIds)).toEqual(new Set([f.E, f.F]));
        expect(DataManager.getData().partnerships[f.uEF]!.childIds).toContain(f.C);
    });

    it('refuses a parent the child already has, the child itself, and cycles', () => {
        const f = richFamily();
        expect(DataManager.reassignParentChild(f.C, f.A, f.B)).toBe(false);   // already a parent
        expect(DataManager.reassignParentChild(f.C, f.A, f.C)).toBe(false);   // itself
        // D is X's child; making D the parent of X would loop the line.
        expect(DataManager.reassignParentChild(f.C, f.A, f.C)).toBe(false);
        const G = DataManager.createPerson(personData('G'));
        DataManager.addParentChild(f.C, G.id);                                 // G is C's child
        expect(DataManager.reassignParentChild(f.C, f.A, G.id)).toBe(false);   // descendant = cycle
        // Nothing changed on refusal.
        const c = DataManager.getPerson(f.C)!;
        expect(new Set(c.parentIds)).toEqual(new Set([f.A, f.B]));
        expect(DataManager.getData().partnerships[f.uAB]!.childIds).toContain(f.C);
    });

    it('rolls back completely when the new link cannot be made', () => {
        const f = richFamily();
        const locked = DataManager.createPerson(personData('Locked'));
        const dm = DataManager as unknown as { isPersonLocked(id: PersonId): boolean };
        const spy = vi.spyOn(dm, 'isPersonLocked').mockImplementation((id: PersonId) => id === locked.id);
        expect(DataManager.reassignParentChild(f.D, f.X, locked.id)).toBe(false);
        spy.mockRestore();
        // The original link incl. its type is back.
        const d = DataManager.getPerson(f.D)!;
        expect(d.parentIds).toEqual([f.X]);
        expect(d.parentRelTypes?.[f.X]).toBe('step');
        expect(DataManager.getPerson(f.X)!.childIds).toContain(f.D);
    });

    it('a partnership-hung child rolls back into its union too', () => {
        const f = richFamily();
        const locked = DataManager.createPerson(personData('Locked'));
        const dm = DataManager as unknown as { isPersonLocked(id: PersonId): boolean };
        const spy = vi.spyOn(dm, 'isPersonLocked').mockImplementation((id: PersonId) => id === locked.id);
        expect(DataManager.reassignParentChild(f.C, f.A, locked.id)).toBe(false);
        spy.mockRestore();
        const c = DataManager.getPerson(f.C)!;
        expect(new Set(c.parentIds)).toEqual(new Set([f.A, f.B]));
        expect(DataManager.getData().partnerships[f.uAB]!.childIds).toContain(f.C);
    });
});
