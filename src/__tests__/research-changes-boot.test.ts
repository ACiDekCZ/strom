/**
 * "What will be sent" asked before the startup tree is in: the app holds an
 * empty stand-in while the tree is read, so the answer then is not the tree's.
 * It must not stay once the tree is in (it stayed until the next edit:
 * "4 changes" instead of 1). Invented data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StromData, ResearchLink, TreeId, TreeMetadata } from '../types.js';

const TREE = 'boot-tree' as TreeId;

const person = (id: string, firstName: string, birthPlace?: string) => ({
    id, firstName, lastName: 'Víšek', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
    refn: id.toUpperCase(), ...(birthPlace ? { birthPlace } : {}),
});
const researchVersion = (): StromData => ({
    persons: { p1: person('p1', 'Josef'), p2: person('p2', 'Jan'), p3: person('p3', 'Karel') },
    partnerships: {},
} as unknown as StromData);

let kept: StromData;
vi.mock('../research-copy.js', () => ({
    saveResearchCopy: async () => {},
    loadResearchCopy: async () => structuredClone(kept),
    saveResearchPrevCopy: async () => {},
    loadResearchPrevCopy: async () => null,
}));

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { researchChangesMethods } from '../ui/research-changes-ui.js';
import { researchSyncMethods } from '../ui/research-sync-ui.js';
import { contentFingerprint } from '../research-link.js';

describe('the changes per person asked before the startup tree is in', () => {
    let data: StromData;
    let link: ResearchLink;

    beforeEach(() => {
        kept = researchVersion();
        link = { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', fingerprint: contentFingerprint(kept), syncedAt: '2026-10-01T10:00:00.000Z' };
        // The startup state: the tree is chosen, its data not read yet (an empty stand-in).
        data = { persons: {}, partnerships: {} } as unknown as StromData;
        vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE);
        vi.spyOn(DataManager, 'getData').mockImplementation(() => data);
        vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(() => ({ id: TREE, research: link } as unknown as TreeMetadata));
        vi.stubGlobal('localStorage', { getItem: () => link.fingerprint, setItem: () => {}, removeItem: () => {} });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('once the tree is read in, the list is the tree\'s: only the real edit', async () => {
        const ui = { ...researchSyncMethods, ...researchChangesMethods, refreshResearchSyncUi() {} } as unknown as typeof researchChangesMethods;
        // Asked while the stand-in is there (the copy loads first, then the answer is worked out).
        expect(await ui.researchChangesReady()).not.toBeNull();
        // The tree is read in (a new data object, as every load makes): Jan's birth place edited, not sent.
        const tree = researchVersion();
        (tree.persons as Record<string, unknown>).p2 = person('p2', 'Jan', 'Brno');
        data = tree;
        expect(ui.researchChangesNow()?.map(c => `${c.name}: ${c.kinds.join(',')}`)).toEqual(['Jan Víšek: birth']);
    });
});
