/**
 * Attachment tests: DataManager add/remove/updateNote (with undo), and the
 * strip helpers (stripAttachments / stripMedia) + privacy stripping. Image
 * compression is browser-only and is covered by the e2e suite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, NewPersonData, Gender, Person, Attachment } from '../types.js';
import { stripAttachments, stripMedia, totalAttachmentBytes } from '../attachments.js';
import { applyLivingPrivacy } from '../privacy.js';
import { personMedia } from '../media.js';

const TREE = 'attachments-test-tree' as TreeId;

function personData(firstName: string, gender: Gender = 'male'): NewPersonData {
    return { firstName, lastName: 'Test', gender };
}

/** A tiny synthetic attachment (real compression is browser-only). */
function fakeAttachment(name = 'scan.jpg'): Omit<Attachment, 'id' | 'places'> {
    const dataUrl = 'data:image/jpeg;base64,AAAA';
    return { name, mimeType: 'image/jpeg', dataUrl, sizeBytes: 3 };
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

describe('DataManager attachments', () => {
    it('adds an attachment and undoes it', () => {
        const p = DataManager.createPerson(personData('Alice', 'female'));
        const att = DataManager.addAttachment(p.id, fakeAttachment());
        expect(att).not.toBeNull();
        expect(DataManager.personMedia(p.id)).toHaveLength(1);

        DataManager.undo();
        expect(DataManager.personMedia(p.id)).toHaveLength(0);

        DataManager.redo();
        expect(DataManager.personMedia(p.id)).toHaveLength(1);
    });

    it('updates an attachment note and clears it', () => {
        const p = DataManager.createPerson(personData('Bob'));
        const att = DataManager.addAttachment(p.id, fakeAttachment())!;
        expect(DataManager.updateAttachmentNote(p.id, att.id, 'Birth certificate')).toBe(true);
        expect(DataManager.personMedia(p.id)[0].note).toBe('Birth certificate');
        DataManager.updateAttachmentNote(p.id, att.id, '   ');
        expect(DataManager.personMedia(p.id)[0].note).toBeUndefined();
    });

    it('removes an attachment and undo restores it', () => {
        const p = DataManager.createPerson(personData('Cyril'));
        const att = DataManager.addAttachment(p.id, fakeAttachment())!;
        expect(DataManager.removeAttachment(p.id, att.id)).toBe(true);
        expect(DataManager.personMedia(p.id)).toHaveLength(0);

        DataManager.undo();
        expect(DataManager.personMedia(p.id)).toHaveLength(1);
    });
});

/** Build a one-person tree with an attachment (and a photo) for strip tests. */
function treeWithAttachment(living: boolean): StromData {
    const attachment: Attachment = { id: 'a1', name: 'letter.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA', sizeBytes: 3, places: [{ personId: 'p1' as PersonId }] };
    const person: Person = {
        id: 'p1' as PersonId,
        firstName: 'Test', lastName: 'Person', gender: 'male',
        isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [],
        photo: 'data:image/jpeg;base64,BBBB',
        isDeceased: !living,
    };
    return { persons: { [person.id]: person }, partnerships: {}, media: { [attachment.id]: attachment } };
}

describe('strip helpers', () => {
    it('stripAttachments removes attachments but keeps photos', () => {
        const out = stripAttachments(treeWithAttachment(false));
        expect(personMedia(out, 'p1' as PersonId)).toHaveLength(0);
        expect(out.persons['p1' as PersonId].photo).toBeDefined();
    });

    it('stripMedia removes both photos and attachments', () => {
        const out = stripMedia(treeWithAttachment(false));
        expect(personMedia(out, 'p1' as PersonId)).toHaveLength(0);
        expect(out.persons['p1' as PersonId].photo).toBeUndefined();
    });

    it('totalAttachmentBytes sums attachment payloads', () => {
        expect(totalAttachmentBytes(treeWithAttachment(false))).toBe(3);
    });
});

describe('privacy strips attachments', () => {
    it('drops attachments for living people under a privacy mode', () => {
        const out = applyLivingPrivacy(treeWithAttachment(true), 'anonymous', 2026);
        expect(personMedia(out, 'p1' as PersonId)).toHaveLength(0);
    });

    it('drops attachments even for deceased people under a privacy mode', () => {
        const out = applyLivingPrivacy(treeWithAttachment(false), 'minimal', 2026);
        expect(personMedia(out, 'p1' as PersonId)).toHaveLength(0);
    });

    it('keeps attachments under full mode', () => {
        const out = applyLivingPrivacy(treeWithAttachment(true), 'full', 2026);
        expect(personMedia(out, 'p1' as PersonId)).toHaveLength(1);
    });
});

describe('merge keeps attachments', () => {
    it('person merge carries the removed person\'s attachments to the kept one', () => {
        const keep = DataManager.createPerson(personData('Keep'));
        const remove = DataManager.createPerson(personData('Remove'));
        DataManager.addAttachment(keep.id, fakeAttachment());
        DataManager.addAttachment(remove.id, fakeAttachment());

        const ok = DataManager.mergePersons(keep.id, remove.id, {}, new Map());
        expect(ok).toBe(true);
        expect(DataManager.personMedia(keep.id)).toHaveLength(2);
        expect(DataManager.getPerson(remove.id)).toBeNull();
    });
});
