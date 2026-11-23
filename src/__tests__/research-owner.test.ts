import { describe, it, expect } from 'vitest';
import { isResearchOwner, researchOwnerIn, researchCopyOrigin, type ResearchTieOf } from '../research-owner.js';

/** One research, one tree (spec 139 K5.1): only the owner of a research writes to it. */
describe('research owner', () => {
    const R = '7a1d3c5e-2b4f-4a6c-8e0d-1f3b5d7e9a2c';
    const trees: ResearchTieOf[] = [
        { id: 't-plain', name: 'Klenovi' },
        { id: 't-own', name: 'Habrovi', research: { id: R } },
        { id: 't-copy', name: 'Habrovi – kopie', research: { id: R, copy: true } },
        { id: 't-second', name: 'Habrovi znovu', research: { id: R } },
        { id: 't-orphan', name: 'Jasanovi – kopie', research: { id: '0c2e4a6b-8d1f-4e3a-9b5c-7d9f1a3c5e7b', copy: true } },
        { id: 't-demo', name: 'Ukázka', demo: true, research: { id: '5e7a9c1b-3d5f-4b2a-8c4e-6f8a0b2d4c6e' } },
        // A copy made now: no tie at all, only the tree it came from.
        { id: 't-new-copy', name: 'Habrovi – kopie 2', copyOf: { treeId: 't-own', name: 'Habrovi' } },
        // A copy that got a research of its own since.
        { id: 't-grown', name: 'Javorkovi', copyOf: { treeId: 't-own', name: 'Habrovi' }, research: { id: '9b1d3f5a-7c9e-4d2b-8a6c-0e2f4a6c8e0a' } },
    ];

    it('only the tree that takes the research\'s updates may write to it', () => {
        expect(isResearchOwner(trees, 't-own')).toBe(true);
        // A copy (Duplicate, Open as a new copy, a second import) never.
        expect(isResearchOwner(trees, 't-copy')).toBe(false);
        // Two trees never write to one research: the second tie of the same research is not its owner.
        expect(isResearchOwner(trees, 't-second')).toBe(false);
        // A copy whose original was deleted stays a tree without research.
        expect(isResearchOwner(trees, 't-orphan')).toBe(false);
        // A tree without a research, the sample tree, no tree at all.
        expect(isResearchOwner(trees, 't-plain')).toBe(false);
        expect(isResearchOwner(trees, 't-demo')).toBe(false);
        expect(isResearchOwner(trees, null)).toBe(false);
        expect(isResearchOwner(trees, 't-missing')).toBe(false);
    });

    it('the owner is found by the research id in any case', () => {
        expect(researchOwnerIn(trees, R.toUpperCase())?.id).toBe('t-own');
        expect(researchOwnerIn(trees, '0c2e4a6b-8d1f-4e3a-9b5c-7d9f1a3c5e7b')).toBeNull();
    });

    it('a copy names the tree it is a copy of, when that tree is there', () => {
        expect(researchCopyOrigin(trees, 't-new-copy')).toEqual({ name: 'Habrovi' });
        expect(isResearchOwner(trees, 't-new-copy')).toBe(false);
        // Older copies still tied to the research name its owner.
        expect(researchCopyOrigin(trees, 't-copy')).toEqual({ name: 'Habrovi' });
        expect(researchCopyOrigin(trees, 't-second')).toEqual({ name: 'Habrovi' });
        expect(researchCopyOrigin(trees, 't-orphan')).toEqual({ name: null });
        // The owner, a copy with a research of its own, a tree without research and the sample tree are no copies.
        expect(researchCopyOrigin(trees, 't-own')).toBeNull();
        expect(isResearchOwner(trees, 't-grown')).toBe(true);
        expect(researchCopyOrigin(trees, 't-grown')).toBeNull();
        expect(researchCopyOrigin(trees, 't-plain')).toBeNull();
        expect(researchCopyOrigin(trees, 't-demo')).toBeNull();
    });
});
