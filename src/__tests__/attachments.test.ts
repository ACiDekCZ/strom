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
import { stripAttachments, stripMedia, totalAttachmentBytes, attachmentResizeState, ATTACHMENT_MAX_SIDE } from '../attachments.js';
import { strings, getStringsForLang } from '../strings.js';
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

describe('DataManager.linkMedia and sameFileMedia (spec 102 §4, §12h)', () => {
    it('adds the places a tree file lacks, makes a new record from material outside the tree, one undo step', () => {
        const a = DataManager.createPerson(personData('Alice', 'female'));
        const b = DataManager.createPerson(personData('Bob'));
        const att = DataManager.addAttachment(a.id, fakeAttachment())!;
        const original = { sha256: 'ab'.repeat(32), name: 'scan.tif', mimeType: 'image/tiff', bytes: 9 };
        const changed = DataManager.linkMedia(
            [{ id: att.id }, { record: { ...fakeAttachment('scan.tif'), original } }],
            [{ personId: a.id }, { personId: b.id }],
        );
        expect(changed).toHaveLength(2);
        expect(DataManager.getMedia(att.id)!.places.map(p => 'personId' in p && p.personId)).toEqual([a.id, b.id]);
        const added = DataManager.sameFileMedia({ original })!;
        expect(added.places).toHaveLength(2);
        expect(added.addedAt).toBeTruthy();
        DataManager.undo();
        expect(DataManager.getMedia(att.id)!.places).toHaveLength(1);
        expect(DataManager.sameFileMedia({ original })).toBeUndefined();
    });

    it('leaves out a place that is not in the tree or of a locked person', () => {
        const a = DataManager.createPerson(personData('Alice', 'female'));
        const att = DataManager.addAttachment(a.id, fakeAttachment())!;
        expect(DataManager.linkMedia([{ id: att.id }], [{ personId: 'nobody' as PersonId }])).toEqual([]);
        expect(DataManager.getMedia(att.id)!.places).toHaveLength(1);
    });

    it('the same file: by the original, else by the same copy; a file taken out of the tree is not one', () => {
        const a = DataManager.createPerson(personData('Alice', 'female'));
        const att = DataManager.addAttachment(a.id, fakeAttachment())!;
        expect(DataManager.sameFileMedia({ dataUrl: 'data:image/jpeg;base64,AAAA' })?.id).toBe(att.id);
        expect(DataManager.sameFileMedia({ dataUrl: 'data:image/jpeg;base64,BBBB' })).toBeUndefined();
        expect(DataManager.sameFileMedia({ dataUrl: 'data:image/jpeg;base64,AAAA', originalOnly: true })).toBeUndefined();
        DataManager.removeMedia(att.id, { keep: true });
        expect(DataManager.sameFileMedia({ dataUrl: 'data:image/jpeg;base64,AAAA' })).toBeUndefined();
        expect(DataManager.restoreMedia(att.id)).toBe(true);
        expect(DataManager.getMedia(att.id)!.places).toHaveLength(1);
    });
});

/**
 * The material detail says "resized to 1600 px" only of a picture that was
 * downscaled (its stored longest side is the limit), "at most 1600 px" when
 * the size cannot be read, nothing for a smaller or larger one
 * (verification of 3.30.0, finding N5).
 */
describe('attachmentResizeState', () => {
    /** A PNG data URL whose header says w × h (the size is all that is read). */
    function png(w: number, h: number): string {
        const b = new Uint8Array(33);
        b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
        const dv = new DataView(b.buffer);
        dv.setUint32(16, w);
        dv.setUint32(20, h);
        return 'data:image/png;base64,' + btoa(String.fromCharCode(...b));
    }
    const img = (dataUrl: string, mimeType = 'image/png') => ({ mimeType, dataUrl });

    it('a picture smaller than the limit was not resized', () => {
        expect(attachmentResizeState(img(png(160, 120)))).toBeNull();
    });
    it('a picture whose longest side is the limit was resized (landscape and portrait)', () => {
        expect(attachmentResizeState(img(png(ATTACHMENT_MAX_SIDE, 1200)))).toBe('resized');
        expect(attachmentResizeState(img(png(900, ATTACHMENT_MAX_SIDE)))).toBe('resized');
    });
    it('a larger picture (kept as it came) was not resized', () => {
        expect(attachmentResizeState(img(png(2400, 1800)))).toBeNull();
    });
    it('an image whose size cannot be read is "unknown"', () => {
        expect(attachmentResizeState(img('data:image/png;base64,AAAA'))).toBe('unknown');
    });
    it('a PDF, only the original, or one with its original is never said resized', () => {
        expect(attachmentResizeState(img('data:application/pdf;base64,JVBERi0=', 'application/pdf'))).toBeNull();
        expect(attachmentResizeState({ ...img(''), originalOnly: true })).toBeNull();
        expect(attachmentResizeState({ ...img(png(ATTACHMENT_MAX_SIDE, 1200)), original: { name: 'scan.tif' } })).toBeNull();
    });
    it('the neutral "at most" text is in every language', () => {
        expect(strings.materials.resizedAtMost).toBeTruthy();
        expect(getStringsForLang('cs').materials.resizedAtMost).toBe('nejvýš 1600 px');
        expect(getStringsForLang('de').materials.resizedAtMost).toBe('höchstens 1600 px');
        expect(getStringsForLang('pl').materials.resizedAtMost).toBe('najwyżej 1600 px');
        expect(getStringsForLang('en').materials.resizedAtMost).toBe('at most 1600 px');
    });
});
