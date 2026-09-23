/**
 * Editing fixes from the 2026-09 review (wave 2, D): emptied fields stay
 * empty (V8), no third parent / ancestry cycle (V10), the family wizard keeps
 * the anchor's parents (V11), one action = one undo step (V12), a surname
 * alone completes a placeholder (V13), deleted witnesses keep their name (S6),
 * no false validation errors on ranges / approximate dates (S7), unsafe media
 * data URLs are dropped on load, and dates in EN/DE forms parse (S4).
 * Persistence and audit logging are stubbed (as in undo.test).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, Gender, Person } from '../types.js';
import { validateTreeData, isSafeAttachmentDataUrl, isSafePhotoDataUrl } from '../validation.js';
import { normalizeDateInput } from '../dates.js';
import { newestLifeEvent } from '../events.js';

const TREE = 'review-editing-tree' as TreeId;

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
    DataManager.onMutationCommitted = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}
beforeEach(reset);

const undoDepth = (): number => (UndoManager as unknown as { undoStack: unknown[] }).undoStack.length;
const add = (firstName: string, gender: Gender = 'male', lastName = 'Test'): Person =>
    DataManager.createPerson({ firstName, lastName, gender });

describe('V8: emptied event / source fields stay empty', () => {
    it('updateLifeEvent drops keys sent as undefined', () => {
        const p = add('Jan');
        const ev = DataManager.addLifeEvent(p.id, { type: 'residence', date: '1900', place: 'Lipany', note: 'x' })!;
        DataManager.updateLifeEvent(p.id, ev.id, { type: 'residence', date: undefined, place: 'Lipany', note: undefined });
        const stored = DataManager.getPerson(p.id)!.events![0];
        expect(stored.place).toBe('Lipany');
        expect('date' in stored).toBe(false);
        expect('note' in stored).toBe(false);
    });

    it('updateSource drops keys sent as undefined', () => {
        const src = DataManager.addSource({ title: 'Register', repository: 'Archive', url: 'https://example.org' })!;
        DataManager.updateSource(src.id, { title: 'Register', repository: undefined, url: undefined });
        const stored = DataManager.getData().sources![src.id];
        expect(stored.title).toBe('Register');
        expect('repository' in stored).toBe(false);
        expect('url' in stored).toBe(false);
    });
});

describe('V10: addParentChild refuses a third parent and cycles', () => {
    it('refuses a third parent without touching anything', () => {
        const child = add('Kid');
        const a = add('A'), b = add('B', 'female'), c = add('C');
        expect(DataManager.addParentChild(a.id, child.id)).toBe(true);
        expect(DataManager.addParentChild(b.id, child.id)).toBe(true);
        const depth = undoDepth();
        expect(DataManager.addParentChild(c.id, child.id)).toBe(false);
        expect(DataManager.getPerson(c.id)!.childIds).toEqual([]);
        expect(DataManager.getPerson(child.id)!.parentIds).toEqual([a.id, b.id]);
        expect(undoDepth()).toBe(depth);
    });

    it('refuses a descendant (or the child itself) as parent', () => {
        const grand = add('Grand');
        const parent = add('Parent');
        const kid = add('Kid');
        DataManager.addParentChild(grand.id, parent.id);
        DataManager.addParentChild(parent.id, kid.id);
        expect(DataManager.addParentChild(kid.id, grand.id)).toBe(false);
        expect(DataManager.addParentChild(grand.id, grand.id)).toBe(false);
        expect(DataManager.getPerson(kid.id)!.childIds).toEqual([]);
        expect(DataManager.canAddParentChild(kid.id, grand.id)).toBe(false);
        // An existing link stays idempotent.
        expect(DataManager.addParentChild(parent.id, kid.id)).toBe(true);
    });

    it('reassignParentChild still works (and is one undo step)', () => {
        const kid = add('Kid');
        const wrong = add('Wrong'), right = add('Right'), mother = add('Mother', 'female');
        DataManager.addParentChild(wrong.id, kid.id);
        DataManager.addParentChild(mother.id, kid.id);
        const depth = undoDepth();
        expect(DataManager.reassignParentChild(kid.id, wrong.id, right.id)).toBe(true);
        expect(DataManager.getPerson(kid.id)!.parentIds.sort()).toEqual([mother.id, right.id].sort());
        expect(undoDepth()).toBe(depth + 1);
        DataManager.undo();
        expect(DataManager.getPerson(kid.id)!.parentIds.sort()).toEqual([mother.id, wrong.id].sort());
    });
});

describe('V11: family wizard respects existing parents', () => {
    it('never adds a third parent nor pairs a new father with a stranger', () => {
        const anchor = add('Ego');
        const mother = add('Mother', 'female');
        const stepMother = add('Other', 'female');
        DataManager.addParentChild(mother.id, anchor.id);

        DataManager.addFamily({
            anchorId: anchor.id,
            father: { firstName: 'Father', lastName: 'Test', gender: 'male' },
            // A mother row that is NOT the anchor's mother must not become a third parent.
            mother: { existingId: stepMother.id, firstName: 'Other', lastName: 'Test', gender: 'female' },
            siblings: [{ firstName: 'Sis', lastName: 'Test', gender: 'female' }],
            children: [],
        });

        const a = DataManager.getPerson(anchor.id)!;
        expect(a.parentIds).toHaveLength(2);
        expect(a.parentIds).toContain(mother.id);
        expect(a.parentIds).not.toContain(stepMother.id);
        const father = Object.values(DataManager.getData().persons).find(p => p.firstName === 'Father')!;
        expect(a.parentIds).toContain(father.id);
        // Parents' union is between the anchor's real parents only.
        expect(DataManager.getPartnershipBetween(father.id, mother.id)).not.toBeNull();
        expect(DataManager.getPartnershipBetween(father.id, stepMother.id)).toBeNull();
        // The sibling shares the anchor's parents.
        const sis = Object.values(DataManager.getData().persons).find(p => p.firstName === 'Sis')!;
        expect(sis.parentIds.sort()).toEqual([...a.parentIds].sort());
    });

    it('does not create a parent when both slots are taken', () => {
        const anchor = add('Ego');
        DataManager.addParentChild(add('F').id, anchor.id);
        DataManager.addParentChild(add('M', 'female').id, anchor.id);
        const before = Object.keys(DataManager.getData().persons).length;
        const created = DataManager.addFamily({
            anchorId: anchor.id,
            father: { firstName: 'Extra', lastName: 'Test', gender: 'male' },
            siblings: [], children: [],
        });
        expect(created).toBe(0);
        expect(Object.keys(DataManager.getData().persons).length).toBe(before);
    });
});

describe('V12: runBatch = one undo step, one toast', () => {
    it('groups mutations, nests, and fires the toast once', () => {
        const toasts: string[] = [];
        DataManager.onMutationCommitted = (d) => toasts.push(d);
        const depth = undoDepth();
        DataManager.runBatch(null, () => {
            const p = add('Batch');
            DataManager.runBatch('inner', () => {
                DataManager.updatePerson(p.id, { birthDate: '1900' });
                DataManager.addLifeEvent(p.id, { type: 'occupation', note: 'smith' });
            });
        });
        expect(undoDepth()).toBe(depth + 1);
        expect(toasts).toHaveLength(1);
        DataManager.undo();
        expect(Object.keys(DataManager.getData().persons)).toHaveLength(0);
    });

    it('closes the batch on a throw and records nothing for a no-op batch', () => {
        expect(() => DataManager.runBatch('boom', () => { add('X'); throw new Error('x'); })).toThrow();
        const depth = undoDepth();
        add('Y');   // must be its own undo step again
        expect(undoDepth()).toBe(depth + 1);
        DataManager.runBatch('nothing', () => { /* no mutation */ });
        expect(undoDepth()).toBe(depth + 1);
    });

    it('Save without changes records no undo step', () => {
        const p = add('Same');
        const depth = undoDepth();
        DataManager.updatePerson(p.id, { firstName: 'Same', lastName: 'Test', birthDate: '' });
        expect(undoDepth()).toBe(depth);
        const u = DataManager.createPartnership(p.id, add('W', 'female').id)!;
        const d2 = undoDepth();
        DataManager.updatePartnership(u.id, { status: u.status });
        expect(undoDepth()).toBe(d2);
        expect((DataManager as unknown as { pendingBefore: unknown }).pendingBefore).toBeNull();
    });
});

describe('V13: a surname completes a placeholder', () => {
    it('clears isPlaceholder when only the last name is filled', () => {
        const ph = DataManager.createPerson({ firstName: '?', lastName: '', gender: 'female' }, true);
        DataManager.updatePerson(ph.id, { firstName: '', lastName: 'Nováková' });
        const p = DataManager.getPerson(ph.id)!;
        expect(p.isPlaceholder).toBe(false);
        expect(p.lastName).toBe('Nováková');
    });

    it('keeps a placeholder whose preset surname was not edited', () => {
        const ph = DataManager.createPerson({ firstName: '?', lastName: 'Novák', gender: 'male' }, true);
        DataManager.updatePerson(ph.id, { firstName: '', lastName: 'Novák' });
        expect(DataManager.getPerson(ph.id)!.isPlaceholder).toBe(true);
    });
});

describe('S6: deleting a witness keeps the written name', () => {
    it('unlinks partnership participants with a name snapshot', () => {
        const h = add('Husband'), w = add('Wife', 'female'), witness = add('Karel', 'male', 'Svědek');
        const u = DataManager.createPartnership(h.id, w.id)!;
        DataManager.addPartnershipParticipant(u.id, { personId: witness.id });
        DataManager.deletePerson(witness.id);
        const part = DataManager.getPartnership(u.id)!.participants![0];
        expect(part.personId).toBeUndefined();
        expect(part.name).toBe('Karel Svědek');
    });

    it('validation reports and repairs a dangling witness link', () => {
        const h = add('Husband'), w = add('Wife', 'female');
        const u = DataManager.createPartnership(h.id, w.id)!;
        u.participants = [{ id: 'pp1', role: 'witness', personId: 'ghost' as PersonId, name: 'Ghost' }];
        const issue = validateTreeData(DataManager.getData()).issues.find(i => i.type === 'orphanedParticipantRef');
        expect(issue?.partnershipIds).toEqual([u.id]);
        expect(DataManager.repairValidationIssue(issue!)).toBe(true);
        expect(DataManager.getPartnership(u.id)!.participants![0].personId).toBeUndefined();
    });
});

describe('S7: no false validation errors', () => {
    it('an event inside a death range is not "after death"', () => {
        const p = add('Range');
        DataManager.updatePerson(p.id, { birthDate: '1850', deathDate: '1900..1910' });
        DataManager.addLifeEvent(p.id, { type: 'residence', date: '1905', place: 'X' });
        const types = validateTreeData(DataManager.getData()).issues.map(i => i.type);
        expect(types).not.toContain('eventAfterDeath');
    });

    it('approximate birth years are not "parent younger than child"', () => {
        const parent = add('Parent'), kid = add('Kid');
        DataManager.updatePerson(parent.id, { birthDate: '~1850' });
        DataManager.updatePerson(kid.id, { birthDate: '~1848' });
        DataManager.addParentChild(parent.id, kid.id);
        const types = validateTreeData(DataManager.getData()).issues.map(i => i.type);
        expect(types).not.toContain('parentYoungerThanChild');
    });

    it('exact dates still report a real error', () => {
        const parent = add('Parent'), kid = add('Kid');
        DataManager.updatePerson(parent.id, { birthDate: '1870' });
        DataManager.updatePerson(kid.id, { birthDate: '1850' });
        DataManager.addParentChild(parent.id, kid.id);
        const types = validateTreeData(DataManager.getData()).issues.map(i => i.type);
        expect(types).toContain('parentYoungerThanChild');
    });
});

describe('media data URLs', () => {
    it('only image (and PDF for attachments) base64 payloads are accepted', () => {
        expect(isSafePhotoDataUrl('data:image/png;base64,AAAA')).toBe(true);
        expect(isSafePhotoDataUrl('data:image/svg+xml;base64,AAAA')).toBe(false);
        expect(isSafeAttachmentDataUrl('data:application/pdf;base64,AAAA')).toBe(true);
        expect(isSafeAttachmentDataUrl('data:text/html;base64,AAAA')).toBe(false);
    });

    it('migrateData drops unsafe photos and attachments', () => {
        const data = migrateData({
            persons: {
                p1: {
                    id: 'p1', firstName: 'A', lastName: 'B', gender: 'male', partnerships: [], parentIds: [], childIds: [],
                    photo: 'data:text/html;base64,PHNjcmlwdD4=',
                    attachments: [
                        { id: 'a1', name: 'x.html', mimeType: 'text/html', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
                        { id: 'a2', name: 'x.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' },
                    ],
                },
            },
            partnerships: {},
        });
        const p = data.persons['p1' as PersonId];
        expect(p.photo).toBeUndefined();
        expect(p.attachments!.map(a => a.id)).toEqual(['a2']);
    });
});

describe('S4: date input forms', () => {
    it('parses English month names and German qualifiers', () => {
        expect(normalizeDateInput('15 May 1880')).toBe('1880-05-15');
        expect(normalizeDateInput('May 15, 1880')).toBe('1880-05-15');
        expect(normalizeDateInput('May 1880')).toBe('1880-05');
        expect(normalizeDateInput('about 15 May 1880')).toBe('~1880-05-15');
        expect(normalizeDateInput('um 1880')).toBe('~1880');
        expect(normalizeDateInput('ca. 1880')).toBe('~1880');
        expect(normalizeDateInput('vor 1880')).toBe('<1880');
        expect(normalizeDateInput('nach 1880')).toBe('>1880');
        expect(normalizeDateInput('zwischen 1880 und 1885')).toBe('1880..1885');
        expect(normalizeDateInput('15 Foo 1880')).toBeNull();
    });
});

describe('quick event: newest dated wins over undated', () => {
    it('prefers the newest dated event', () => {
        const ev = (id: string, date?: string) => ({ id, type: 'occupation' as const, note: id, ...(date ? { date } : {}) });
        expect(newestLifeEvent([ev('a', '1900'), ev('b'), ev('c', '1910')])!.id).toBe('c');
        expect(newestLifeEvent([ev('b')])!.id).toBe('b');
        expect(newestLifeEvent([])).toBeNull();
    });
});
