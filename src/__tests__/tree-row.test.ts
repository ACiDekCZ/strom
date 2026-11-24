/**
 * The Manage trees row's facts (spec 139 §7.2, §9.1): the origin line read
 * from the tree index alone, the size shown for every tree, and which row an
 * unfinished merge stands under.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setLanguage } from '../strings.js';
import { formatTreeSize } from '../format.js';
import {
    treeOriginLine, importOriginOf, researchShortId,
    pendingMergeTreeId, pendingMergeHasTarget, pendingMergeSourceName,
} from '../tree-row.js';
import type { TreeMetadata } from '../types.js';

const tree = (extra: Partial<TreeMetadata> = {}): TreeMetadata => ({
    id: 'tree_a', name: 'Jesenští', createdAt: 0, lastModifiedAt: 0, personCount: 12, partnershipCount: 4, sizeBytes: 240 * 1024,
    ...extra,
} as TreeMetadata);

const plain = { owner: false, copyOrigin: null };
const RID = '3f2a9c71-5b0e-4d2a-9e61-0c7d8b1a2f44';

describe('treeOriginLine', () => {
    beforeEach(() => setLanguage('en'));

    it('a tree that owns its research: the research by its short id, the switch beside it', () => {
        const line = treeOriginLine(tree({ research: { id: RID } } as Partial<TreeMetadata>), { owner: true, copyOrigin: null });
        expect(line).toEqual({ kind: 'research', text: 'Research 3f2a9c71', researchId: RID });
    });

    it('a copy of a research tree: never a research tree, even with the link copied', () => {
        const line = treeOriginLine(tree({ research: { id: RID } } as Partial<TreeMetadata>), { owner: false, copyOrigin: { name: 'Rodina Kalinovských' } });
        expect(line).toEqual({ kind: 'copy', text: 'copy of the tree “Rodina Kalinovských” · no research' });
        expect(treeOriginLine(tree(), { owner: false, copyOrigin: { name: null } }).text).toBe('copy of a research tree · no research');
    });

    it('a copy known from the index alone (copyOf)', () => {
        const line = treeOriginLine(tree({ copyOf: { treeId: 'tree_b', name: 'Ostrožní z Mezihoře' } } as never), plain);
        expect(line.kind).toBe('copy');
        expect(line.text).toBe('copy of the tree “Ostrožní z Mezihoře” · no research');
    });

    it('a tree cut from another', () => {
        const line = treeOriginLine(tree({ fromTree: { treeId: 'tree_b', name: 'Ostrožní z Mezihoře', what: 'branch' } } as never), plain);
        expect(line).toEqual({ kind: 'fromTree', text: 'cut from the tree “Ostrožní z Mezihoře” · no research' });
    });

    it('a tree loaded from a GEDCOM or a JSON file', () => {
        expect(treeOriginLine(tree({ importedFrom: { file: 'jesensti.ged', kind: 'gedcom' } }), plain))
            .toEqual({ kind: 'import', text: 'from GEDCOM jesensti.ged · no research' });
        expect(treeOriginLine(tree({ importedFrom: { file: 'zaloha.json', kind: 'json' } }), plain))
            .toEqual({ kind: 'import', text: 'from the file zaloha.json · no research' });
    });

    it('a tree made here: "no research", never an empty line', () => {
        expect(treeOriginLine(tree(), plain)).toEqual({ kind: 'none', text: 'no research' });
    });

    it('speaks the UI language', () => {
        setLanguage('cs');
        expect(treeOriginLine(tree(), plain).text).toBe('bez výzkumu');
    });
});

describe('importOriginOf', () => {
    it('the last load with a file name', () => {
        expect(importOriginOf({ imports: [
            { file: 'stary.ged' }, { file: 'jesensti.ged' }, { file: '' },
        ] } as never)).toEqual({ file: 'jesensti.ged', kind: 'gedcom' });
        expect(importOriginOf({ imports: [{ file: 'zaloha.JSON' }] } as never)).toEqual({ file: 'zaloha.JSON', kind: 'json' });
    });

    it('none without a load', () => {
        expect(importOriginOf({} as never)).toBeUndefined();
        expect(importOriginOf({ imports: [{ file: '  ' }] } as never)).toBeUndefined();
    });
});

describe('researchShortId', () => {
    it('the first 8 characters of a long id', () => {
        expect(researchShortId(RID)).toBe('3f2a9c71');
        expect(researchShortId('abc')).toBe('abc');
    });
});

describe('unfinished merges by their target', () => {
    const trees = [{ id: 'tree_a', name: 'Jesenští' }, { id: 'tree_b', name: 'Kalinovští' }, { id: 'tree_c', name: 'Kalinovští' }];

    it('by the id it carries; a deleted target gives none', () => {
        expect(pendingMergeTreeId({ targetTreeId: 'tree_a', targetTreeName: 'Kalinovští' }, trees)).toBe('tree_a');
        expect(pendingMergeTreeId({ targetTreeId: 'tree_gone', targetTreeName: 'Jesenští' }, trees)).toBeNull();
    });

    it('an older session by its target name, when one tree has it', () => {
        expect(pendingMergeTreeId({ targetTreeName: 'Jesenští' }, trees)).toBe('tree_a');
        expect(pendingMergeTreeId({ targetTreeName: 'Kalinovští' }, trees)).toBeNull();
        expect(pendingMergeTreeId({}, trees)).toBeNull();
    });

    it('a session naming no target is not "target gone"', () => {
        expect(pendingMergeHasTarget({})).toBe(false);
        expect(pendingMergeHasTarget({ targetTreeName: 'Jesenští' })).toBe(true);
    });

    it('what comes in: its own name, the source tree for the made-up "Target + Source"', () => {
        expect(pendingMergeSourceName({ incomingFileName: 'rodokmen-jilmovi.ged', targetTreeName: 'Jesenští' }, '?')).toBe('rodokmen-jilmovi.ged');
        expect(pendingMergeSourceName({ incomingFileName: 'Jesenští + Kalinovští', targetTreeName: 'Jesenští', sourceTreeName: 'Kalinovští' }, '?')).toBe('Kalinovští');
        expect(pendingMergeSourceName({}, 'file')).toBe('file');
    });
});

describe('formatTreeSize', () => {
    it('every tree shows its size: whole kB below 1 MB, MB above', () => {
        expect(formatTreeSize(240 * 1024, 'en')).toBe('240 kB');
        expect(formatTreeSize(10, 'en')).toBe('1 kB');
        expect(formatTreeSize(0, 'en')).toBe('1 kB');
        expect(formatTreeSize(5 * 1024 * 1024, 'en')).toMatch(/^5(\.0)? MB$/);
    });
});
