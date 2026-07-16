/**
 * Life-events tests: DataManager add/update/remove (with undo), the events.ts
 * helpers, validation of imported events, and privacy stripping.
 *
 * DataManager persistence is stubbed so mutations stay in memory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, NewPersonData, Gender, Person, LifeEvent } from '../types.js';
import { SELECTABLE_EVENT_TYPES, sortLifeEvents } from '../events.js';
import { validateTreeData } from '../validation.js';
import { applyLivingPrivacy } from '../privacy.js';

const TREE = 'events-test-tree' as TreeId;

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

describe('events.ts helpers', () => {
    it('never offers birth or death as selectable types', () => {
        expect(SELECTABLE_EVENT_TYPES).not.toContain('birth');
        expect(SELECTABLE_EVENT_TYPES).not.toContain('death');
    });

    it('sorts chronologically with undated events last, stable by id', () => {
        const events: LifeEvent[] = [
            { id: 'b', type: 'residence' },              // undated
            { id: 'c', type: 'occupation', date: '1950' },
            { id: 'a', type: 'baptism', date: '1900' },
            { id: 'd', type: 'burial' },                 // undated
        ];
        const sorted = sortLifeEvents(events).map(e => e.id);
        expect(sorted).toEqual(['a', 'c', 'b', 'd']);
    });
});

describe('DataManager life events', () => {
    it('adds an event and undoes it', () => {
        const p = DataManager.createPerson(personData('Alice', 'female'));
        const event = DataManager.addLifeEvent(p.id, { type: 'baptism', date: '1900', place: 'Praha' });
        expect(event).not.toBeNull();
        expect(DataManager.getPerson(p.id)?.events).toHaveLength(1);
        expect(event!.id).toBeTruthy();

        DataManager.undo();
        expect(DataManager.getPerson(p.id)?.events ?? []).toHaveLength(0);

        DataManager.redo();
        expect(DataManager.getPerson(p.id)?.events).toHaveLength(1);
    });

    it('rejects birth and death as event types', () => {
        const p = DataManager.createPerson(personData('Bob'));
        expect(DataManager.addLifeEvent(p.id, { type: 'birth' } as Omit<LifeEvent, 'id'>)).toBeNull();
        expect(DataManager.addLifeEvent(p.id, { type: 'death' } as Omit<LifeEvent, 'id'>)).toBeNull();
        expect(DataManager.getPerson(p.id)?.events ?? []).toHaveLength(0);
    });

    it('rejects a custom event without a label', () => {
        const p = DataManager.createPerson(personData('Cyril'));
        expect(DataManager.addLifeEvent(p.id, { type: 'custom' })).toBeNull();
        expect(DataManager.addLifeEvent(p.id, { type: 'custom', customLabel: 'Award' })).not.toBeNull();
    });

    it('updates an event and undoes the change', () => {
        const p = DataManager.createPerson(personData('Dana', 'female'));
        const event = DataManager.addLifeEvent(p.id, { type: 'occupation', note: 'Farmer' })!;

        const ok = DataManager.updateLifeEvent(p.id, event.id, { note: 'Blacksmith', place: 'Kladno' });
        expect(ok).toBe(true);
        const updated = DataManager.getPerson(p.id)?.events?.[0];
        expect(updated?.note).toBe('Blacksmith');
        expect(updated?.place).toBe('Kladno');

        DataManager.undo();
        expect(DataManager.getPerson(p.id)?.events?.[0].note).toBe('Farmer');
    });

    it('removes an event and undoes the removal', () => {
        const p = DataManager.createPerson(personData('Emil'));
        const event = DataManager.addLifeEvent(p.id, { type: 'residence', place: 'Brno' })!;

        expect(DataManager.removeLifeEvent(p.id, event.id)).toBe(true);
        expect(DataManager.getPerson(p.id)?.events ?? []).toHaveLength(0);

        DataManager.undo();
        expect(DataManager.getPerson(p.id)?.events).toHaveLength(1);
    });

    it('removing the last participant via an empty array drops the property (finding 6)', () => {
        const jan = DataManager.createPerson(personData('Jan'));
        const event = DataManager.addLifeEvent(jan.id, {
            type: 'baptism',
            participants: [{ id: 'pt1', role: 'godparent', name: 'Marie' }],
        })!;
        expect(DataManager.getPerson(jan.id)?.events?.[0].participants).toHaveLength(1);

        // The editor always sends the array; an empty one means "all removed".
        DataManager.updateLifeEvent(jan.id, event.id, { participants: [] });
        expect(DataManager.getPerson(jan.id)?.events?.[0].participants).toBeUndefined();
    });
});

/** Build a minimal tree with one person carrying the given events. */
function treeWithEvents(events: LifeEvent[], overrides: Partial<Person> = {}): StromData {
    const person: Person = {
        id: 'p1' as PersonId,
        firstName: 'Test', lastName: 'Person', gender: 'male',
        isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [],
        events,
        ...overrides,
    };
    return { persons: { [person.id]: person }, partnerships: {} };
}

describe('validation of imported events', () => {
    it('flags a birth/death type stored in events as an error', () => {
        const data = treeWithEvents([{ id: 'e1', type: 'birth' }]);
        const result = validateTreeData(data);
        expect(result.issues.some(i => i.severity === 'error')).toBe(true);
    });

    it('warns about a custom event with no label', () => {
        const data = treeWithEvents([{ id: 'e1', type: 'custom' }]);
        const result = validateTreeData(data);
        expect(result.issues.some(i => i.severity === 'warning')).toBe(true);
    });

    it('warns about an invalid flex date', () => {
        const data = treeWithEvents([{ id: 'e1', type: 'baptism', date: 'not-a-date' }]);
        const result = validateTreeData(data);
        expect(result.issues.some(i => i.severity === 'warning')).toBe(true);
    });

    it('accepts a well-formed event', () => {
        const data = treeWithEvents([{ id: 'e1', type: 'baptism', date: '1900-01-15', place: 'Praha' }]);
        const result = validateTreeData(data);
        expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    });
});

describe('event participants survive person changes', () => {
    it('deletePerson keeps the written name, drops the dangling link (finding 1)', () => {
        const marie = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female' });
        const jan = DataManager.createPerson(personData('Jan'));
        DataManager.addLifeEvent(jan.id, {
            type: 'baptism', date: '1880',
            participants: [{ id: 'pt1', role: 'godparent', personId: marie.id }],
        });

        expect(DataManager.deletePerson(marie.id)).toBe(true);
        const part = DataManager.getPerson(jan.id)?.events?.[0].participants?.[0];
        expect(part?.personId).toBeUndefined();
        expect(part?.name).toBe('Marie Dvořáková');   // name survives the delete

        // Same mutation, so undo restores both the person and the link.
        DataManager.undo();
        const restored = DataManager.getPerson(jan.id)?.events?.[0].participants?.[0];
        expect(restored?.personId).toBe(marie.id);
        expect(restored?.name).toBeUndefined();
        expect(DataManager.getPerson(marie.id)).toBeDefined();
    });

    it('mergePersons remaps a participant link to the kept person (finding 2)', () => {
        const keep = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female' });
        const remove = DataManager.createPerson({ firstName: 'Maria', lastName: 'Dvorak', gender: 'female' });
        const jan = DataManager.createPerson(personData('Jan'));
        DataManager.addLifeEvent(jan.id, {
            type: 'baptism',
            participants: [{ id: 'pt1', role: 'godparent', personId: remove.id }],
        });

        expect(DataManager.mergePersons(keep.id, remove.id, {}, new Map())).toBe(true);
        const part = DataManager.getPerson(jan.id)?.events?.[0].participants?.[0];
        expect(part?.personId).toBe(keep.id);
    });

    it('mergePersons drops a duplicate participant of the same role (finding 2)', () => {
        const keep = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female' });
        const remove = DataManager.createPerson({ firstName: 'Maria', lastName: 'Dvorak', gender: 'female' });
        const jan = DataManager.createPerson(personData('Jan'));
        DataManager.addLifeEvent(jan.id, {
            type: 'baptism',
            participants: [
                { id: 'pt1', role: 'godparent', personId: keep.id },
                { id: 'pt2', role: 'godparent', personId: remove.id },
            ],
        });

        expect(DataManager.mergePersons(keep.id, remove.id, {}, new Map())).toBe(true);
        const parts = DataManager.getPerson(jan.id)?.events?.[0].participants ?? [];
        expect(parts).toHaveLength(1);
        expect(parts[0].personId).toBe(keep.id);
    });

    it('validation flags a participant linked to a missing person (finding 5)', () => {
        const data = treeWithEvents([{
            id: 'e1', type: 'baptism',
            participants: [{ id: 'pt1', role: 'godparent', personId: 'ghost' as PersonId, name: 'Marie' }],
        }]);
        const result = validateTreeData(data);
        const issue = result.issues.find(i => i.type === 'orphanedParticipantRef');
        expect(issue).toBeDefined();
        expect(issue?.severity).toBe('error');
        expect(issue?.personIds).toContain('p1' as PersonId);
    });

    it('auto-fix drops the dangling link but keeps the name (finding 5)', () => {
        const jan = DataManager.createPerson(personData('Jan'));
        DataManager.addLifeEvent(jan.id, {
            type: 'baptism',
            participants: [{ id: 'pt1', role: 'godparent', personId: 'ghost' as PersonId, name: 'Marie' }],
        });

        const issue = validateTreeData(DataManager.getData())
            .issues.find(i => i.type === 'orphanedParticipantRef')!;
        expect(DataManager.isFixableIssue(issue)).toBe(true);
        expect(DataManager.repairValidationIssue(issue)).toBe(true);

        const part = DataManager.getPerson(jan.id)?.events?.[0].participants?.[0];
        expect(part?.personId).toBeUndefined();
        expect(part?.name).toBe('Marie');
    });
});

describe('privacy strips events for living people', () => {
    it('drops events under anonymous mode', () => {
        const data = treeWithEvents(
            [{ id: 'e1', type: 'residence', place: 'Secret Town', date: '2010' }],
            { isDeceased: false },
        );
        const filtered = applyLivingPrivacy(data, 'anonymous', 2026);
        expect(filtered.persons['p1' as PersonId].events).toBeUndefined();
    });

    it('keeps events for deceased people', () => {
        const data = treeWithEvents(
            [{ id: 'e1', type: 'burial', place: 'Old Cemetery' }],
            { isDeceased: true },
        );
        const filtered = applyLivingPrivacy(data, 'anonymous', 2026);
        expect(filtered.persons['p1' as PersonId].events).toHaveLength(1);
    });
});
