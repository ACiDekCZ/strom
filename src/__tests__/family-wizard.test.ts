/**
 * Family wizard batch: DataManager.addFamily builds a whole family in ONE undo
 * step, links to existing persons instead of duplicating, and ignores empty
 * members. Persistence and audit logging are stubbed (as in undo.test).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, Gender } from '../types.js';

const TREE = 'wizard-test-tree' as TreeId;

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

function member(firstName: string, lastName: string, gender: Gender, birthDate?: string) {
    return { firstName, lastName, gender, ...(birthDate ? { birthDate } : {}) };
}
const persons = () => Object.values(DataManager.getData().persons);
const byName = (first: string) => persons().find(p => p.firstName === first);

describe('DataManager.addFamily', () => {
    it('adds parents, partner and children as ONE undo step', () => {
        const anchor = DataManager.createPerson({ firstName: 'Ego', lastName: 'Novak', gender: 'male' });
        const beforeCount = persons().length;

        const created = DataManager.addFamily({
            anchorId: anchor.id,
            father: member('Otec', 'Novak', 'male', '1940'),
            mother: member('Matka', 'Novak', 'female', '1942'),
            partner: { ...member('Zena', 'Nova', 'female'), weddingDate: '1990' },
            siblings: [member('Sestra', 'Novak', 'female')],
            children: [member('Syn', 'Novak', 'male'), member('Dcera', 'Novak', 'female')],
        });

        expect(created).toBe(6);
        expect(persons().length).toBe(beforeCount + 6);

        // Relationships wired up.
        const anchorNow = DataManager.getPerson(anchor.id)!;
        expect(anchorNow.parentIds).toHaveLength(2);
        expect(byName('Sestra')!.parentIds).toHaveLength(2);
        expect(byName('Syn')!.parentIds).toContain(anchor.id);
        expect(byName('Syn')!.parentIds).toContain(byName('Zena')!.id);

        // Wedding date landed on the couple's partnership.
        const union = Object.values(DataManager.getData().partnerships)
            .find(u => u.person1Id === anchor.id || u.person2Id === anchor.id)!;
        expect(union.startDate).toBe('1990');

        // ONE undo reverts the whole family.
        expect(DataManager.undo()).not.toBeNull();
        expect(persons().length).toBe(beforeCount);
        expect(DataManager.getData().partnerships).toEqual({});
    });

    it('ignores empty members and does not create blanks', () => {
        const anchor = DataManager.createPerson({ firstName: 'Ego', lastName: 'X', gender: 'male' });
        const created = DataManager.addFamily({
            anchorId: anchor.id,
            father: member('', '', 'male'),          // empty → skipped
            mother: member('Mama', 'X', 'female'),
            siblings: [member('', '', 'female'), member('Bro', 'X', 'male')],
            children: [],
        });
        expect(created).toBe(2);
        expect(DataManager.getPerson(anchor.id)!.parentIds).toEqual([byName('Mama')!.id]);
    });

    it('links to an existing person instead of duplicating', () => {
        const anchor = DataManager.createPerson({ firstName: 'Ego', lastName: 'X', gender: 'male' });
        const existingDad = DataManager.createPerson({ firstName: 'Karel', lastName: 'X', gender: 'male' });
        const before = persons().length;

        const created = DataManager.addFamily({
            anchorId: anchor.id,
            father: { existingId: existingDad.id, firstName: 'Karel', lastName: 'X', gender: 'male' },
            siblings: [],
            children: [],
        });

        expect(created).toBe(0);                       // no new person
        expect(persons().length).toBe(before);
        expect(DataManager.getPerson(anchor.id)!.parentIds).toEqual([existingDad.id]);
    });
});

it('a throw inside the batch still closes it — later mutations keep saving/undoing', () => {
    const anchor = DataManager.createPerson({ firstName: 'Anchor', lastName: 'X', gender: 'male' });
    // Force a throw mid-batch: an existingId pointing at a person that
    // disappears between checks is hard to fake, so stub createPartnership.
    const orig = DataManager.createPartnership.bind(DataManager);
    (DataManager as unknown as { createPartnership: () => never }).createPartnership = () => {
        throw new Error('boom');
    };
    try {
        expect(() => DataManager.addFamily({
            anchorId: anchor.id,
            father: { firstName: 'F', lastName: 'X', gender: 'male' },
            mother: { firstName: 'M', lastName: 'X', gender: 'female' },
            siblings: [], children: [],
        })).toThrow('boom');
    } finally {
        (DataManager as unknown as { createPartnership: typeof orig }).createPartnership = orig;
    }
    // The batch must be closed: a normal mutation still produces an undo step.
    const p = DataManager.createPerson({ firstName: 'After', lastName: 'X', gender: 'male' });
    expect(DataManager.getPerson(p.id)).not.toBeNull();
    expect(DataManager.canUndo()).toBe(true);
    DataManager.undo();
    expect(DataManager.getPerson(p.id)).toBeNull();
});
