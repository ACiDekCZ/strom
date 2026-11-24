/**
 * Take over the research of the original by its copy (spec 139 K5.5): the
 * copy becomes the research's owner, the original a tree without research;
 * nothing else moves. Invented trees (Rodina Kalinovských and its copy).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isResearchOwner, researchOriginalOf, researchCopyOrigin, transferResearchTie, type ResearchTransferOf } from '../research-owner.js';
import { TreeManager } from '../tree-manager.js';
import type { TreeId, TreeMetadata } from '../types.js';

const R = '3e5a7c9b-1d2f-4a6c-8e0b-2c4e6a8c0e2f';

function trees(): ResearchTransferOf[] {
    return [
        { id: 't-orig', name: 'Rodina Kalinovských', research: { id: R, mergeHold: { mergeId: 'm1', at: '2026-11-20T10:00:00Z', persons: 2 } } },
        { id: 't-copy', name: 'Rodina Kalinovských (kopie)', copyOf: { treeId: 't-orig', name: 'Rodina Kalinovských' } },
        // An older copy still tied to the research.
        { id: 't-old', name: 'Kalinovští', research: { id: R, copy: true } },
        { id: 't-plain', name: 'Jesenští' },
        { id: 't-demo', name: 'Ukázka', demo: true },
    ];
}

describe('the original of a copy', () => {
    it('is the tree the copy names when it owns a research, else the owner of the copy\'s old tie', () => {
        const all = trees();
        expect(researchOriginalOf(all, 't-copy')?.id).toBe('t-orig');
        expect(researchOriginalOf(all, 't-old')?.id).toBe('t-orig');
        expect(researchOriginalOf(all, 't-orig')).toBeNull();
        expect(researchOriginalOf(all, 't-plain')).toBeNull();
    });
});

describe('transferResearchTie', () => {
    it('makes the copy the owner; the original has no research and is no copy', () => {
        const all = trees();
        expect(transferResearchTie(all, 't-orig', 't-copy')).toBe(true);
        const orig = all.find(t => t.id === 't-orig')!;
        const copy = all.find(t => t.id === 't-copy')!;
        expect(orig.research).toBeUndefined();
        expect(orig.copyOf).toBeUndefined();
        expect(copy.research?.id).toBe(R);
        expect(copy.research?.copy).toBeUndefined();
        expect(copy.copyOf).toBeUndefined();
        // The merges held for the original are not the copy's.
        expect(copy.research?.mergeHold).toBeUndefined();
        expect(isResearchOwner(all, 't-copy')).toBe(true);
        expect(isResearchOwner(all, 't-orig')).toBe(false);
        expect(researchCopyOrigin(all, 't-copy')).toBeNull();
        // The older tied copy now names the new owner as its original.
        expect(researchOriginalOf(all, 't-old')?.id).toBe('t-copy');
    });

    it('an older tied copy takes it over as its owner (its copy mark goes)', () => {
        const all = trees();
        expect(transferResearchTie(all, 't-orig', 't-old')).toBe(true);
        expect(all.find(t => t.id === 't-old')!.research).toEqual({ id: R });
        expect(isResearchOwner(all, 't-old')).toBe(true);
    });

    it('changes nothing from a tree that owns no research, to itself or to the sample tree', () => {
        for (const [from, to] of [['t-copy', 't-plain'], ['t-old', 't-plain'], ['t-orig', 't-orig'], ['t-orig', 't-demo'], ['t-orig', 't-missing']]) {
            const all = trees();
            expect(transferResearchTie(all, from, to)).toBe(false);
            expect(all).toEqual(trees());
        }
    });
});

describe('TreeManager.transferResearch', () => {
    afterEach(() => vi.restoreAllMocks());

    it('stores the index with the copy as the owner', () => {
        const tm = TreeManager as unknown as { index: { trees: TreeMetadata[] }; saveIndex(): void };
        const saved = vi.spyOn(tm, 'saveIndex').mockImplementation(() => {});
        const before = tm.index.trees;
        tm.index.trees = trees() as unknown as TreeMetadata[];
        try {
            expect(TreeManager.researchOriginalOf('t-copy' as TreeId)?.id).toBe('t-orig');
            expect(TreeManager.transferResearch('t-orig' as TreeId, 't-copy' as TreeId)).toBe(true);
            expect(saved).toHaveBeenCalledTimes(1);
            expect(TreeManager.canSendToResearch('t-copy' as TreeId)).toBe(true);
            expect(TreeManager.canSendToResearch('t-orig' as TreeId)).toBe(false);
            expect(TreeManager.getTreeMetadata('t-orig' as TreeId)?.research).toBeUndefined();
            expect(TreeManager.getTreeMetadata('t-copy' as TreeId)?.copyOf).toBeUndefined();
            // Done once: a second take-over from the original changes nothing.
            expect(TreeManager.transferResearch('t-orig' as TreeId, 't-copy' as TreeId)).toBe(false);
            expect(saved).toHaveBeenCalledTimes(1);
        } finally {
            tm.index.trees = before;
        }
    });
});
