/**
 * Link to… in a tree that follows a live research (1123): the lock checks
 * with `exceptFollow` leave following out — every other reason (a locked
 * person, a locked tree, a read-only view) still counts — and without it
 * following keeps the tree read-only as before.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { Gender, StromData, TreeId } from '../types.js';

const TREE = 'attach-followed-tree' as TreeId;
const PX = 'data:image/jpeg;base64,AAAA';

type Internals = { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };

describe('Lock checks except following a live research (1123)', () => {
    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as Internals;
        dm.data = { persons: {}, partnerships: {} };
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    afterEach(() => {
        DataManager.setLiveTree(null);
        (DataManager as unknown as Internals).viewMode = false;
        vi.restoreAllMocks();
    });

    function fileOfAda(): { personId: ReturnType<typeof DataManager.createPerson>['id']; mediaId: string } {
        const p = DataManager.createPerson({ firstName: 'Ada', lastName: 'Quellbach', gender: 'female' as Gender });
        const a = DataManager.addAttachment(p.id, { name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: PX, sizeBytes: 3 })!;
        return { personId: p.id, mediaId: a.id };
    }

    it('not followed: the same answer with or without exceptFollow', () => {
        const { personId, mediaId } = fileOfAda();
        expect(DataManager.isTreeLocked()).toBe(false);
        expect(DataManager.isTreeLocked({ exceptFollow: true })).toBe(false);
        expect(DataManager.isPersonLocked(personId)).toBe(false);
        expect(DataManager.isPersonLocked(personId, { exceptFollow: true })).toBe(false);
        expect(DataManager.canEditMedia(mediaId)).toBe(true);
        expect(DataManager.canEditMedia(mediaId, { exceptFollow: true })).toBe(true);
    });

    it('followed: locked as before, but not with exceptFollow', () => {
        const { personId, mediaId } = fileOfAda();
        DataManager.setLiveTree(TREE);
        expect(DataManager.isLiveFollowing()).toBe(true);
        expect(DataManager.isTreeLocked()).toBe(true);
        expect(DataManager.isPersonLocked(personId)).toBe(true);
        expect(DataManager.canEditMedia(mediaId)).toBe(false);
        expect(DataManager.isTreeLocked({ exceptFollow: true })).toBe(false);
        expect(DataManager.isPersonLocked(personId, { exceptFollow: true })).toBe(false);
        expect(DataManager.canEditMedia(mediaId, { exceptFollow: true })).toBe(true);
    });

    it('another tree followed: this one is not locked by it', () => {
        const { mediaId } = fileOfAda();
        DataManager.setLiveTree('another-tree' as TreeId);
        expect(DataManager.canEditMedia(mediaId)).toBe(true);
    });

    it('a locked person still locks with exceptFollow, followed or not', () => {
        const { personId, mediaId } = fileOfAda();
        DataManager.getData().persons[personId].isLocked = true;
        expect(DataManager.isPersonLocked(personId, { exceptFollow: true })).toBe(true);
        expect(DataManager.canEditMedia(mediaId, { exceptFollow: true })).toBe(false);
        DataManager.setLiveTree(TREE);
        expect(DataManager.isPersonLocked(personId, { exceptFollow: true })).toBe(true);
        expect(DataManager.canEditMedia(mediaId, { exceptFollow: true })).toBe(false);
    });

    it('a tree locked in its metadata still locks with exceptFollow', () => {
        const { personId, mediaId } = fileOfAda();
        vi.spyOn(TreeManager, 'getActiveTreeMetadata').mockReturnValue({ isLocked: true } as ReturnType<typeof TreeManager.getActiveTreeMetadata>);
        DataManager.setLiveTree(TREE);
        expect(DataManager.isTreeLocked({ exceptFollow: true })).toBe(true);
        expect(DataManager.isPersonLocked(personId, { exceptFollow: true })).toBe(true);
        expect(DataManager.canEditMedia(mediaId, { exceptFollow: true })).toBe(false);
    });

    it('a read-only view still refuses with exceptFollow', () => {
        const { mediaId } = fileOfAda();
        DataManager.setLiveTree(TREE);
        (DataManager as unknown as Internals).viewMode = true;
        expect(DataManager.canEditMedia(mediaId, { exceptFollow: true })).toBe(false);
    });
});
