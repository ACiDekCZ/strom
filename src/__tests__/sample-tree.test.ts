/**
 * The sample trees and their "Sample" tag (spec 143 §1): the showcase carries
 * its header's mark (TreeMetadata.sample) and is found again by its export id
 * (a second opening only switches); the bundled Berg sample (demo) gets the
 * same tag. The tag follows the mark, not the name. All data is invented.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stored = new Map<string, unknown>();
vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(_store: string, key: string): Promise<T | null> { return (stored.get(key) as T) ?? null; },
        async set(_store: string, key: string, value: unknown): Promise<void> { stored.set(key, structuredClone(value)); },
        async delete(_store: string, key: string): Promise<void> { stored.delete(key); },
        async keys(): Promise<string[]> { return [...stored.keys()]; },
        async flush(): Promise<void> {},
    },
}));

import { TreeManager } from '../tree-manager.js';
import { setLanguage } from '../strings.js';
import { treeOriginLine, treeSampleKind } from '../tree-row.js';
import { sampleTagHtml } from '../ui/sample-tag.js';
import { formatFlexDate } from '../dates.js';
import type { TreeId, TreeMetadata, TreeSampleMark } from '../types.js';

const SHOWCASE = 'tree_showcase' as TreeId;
const BERGS = 'tree_bergs' as TreeId;
const OWN = 'tree_own' as TreeId;
const MARK: TreeSampleMark = { exportId: 'showcase-cs', lang: 'cs', sampleVersion: '3.33.0', asOf: '2026-11-01T09:00:00.000Z' };

function meta(id: TreeId, name: string, extra: Partial<TreeMetadata> = {}): TreeMetadata {
    return { id, name, createdAt: '2026-11-01', lastModifiedAt: '2026-11-01', personCount: 5, partnershipCount: 2, sizeBytes: 0, ...extra } as TreeMetadata;
}

function index(trees: TreeMetadata[]): void {
    (TreeManager as unknown as { index: { version: number; activeTreeId: TreeId | null; trees: TreeMetadata[] } }).index =
        { version: 1, activeTreeId: trees[0]?.id ?? null, trees };
}

const tree = (id: TreeId) => TreeManager.getTreeMetadata(id)!;

beforeEach(() => {
    stored.clear();
    setLanguage('en');
    index([meta(SHOWCASE, 'Ukázka – rod Horáků'), meta(BERGS, 'Sample: the Berg family', { demo: true }), meta(OWN, 'Novákovi')]);
});

describe('markSampleTree and sampleKindOf', () => {
    it('the showcase keeps its header\'s mark and its export id as its source', () => {
        TreeManager.markSampleTree(SHOWCASE, { ...MARK, ...{ name: 'ignored' } } as TreeSampleMark);
        expect(tree(SHOWCASE).sample).toEqual(MARK);
        expect(tree(SHOWCASE).sourceExportId).toBe('showcase-cs');
        expect(TreeManager.sampleKindOf(SHOWCASE)).toBe('showcase');
        expect(TreeManager.sampleKindOf(BERGS)).toBe('demo');
        expect(TreeManager.sampleKindOf(OWN)).toBeNull();
        expect(TreeManager.sampleKindOf(null)).toBeNull();
        expect(TreeManager.sampleKindOf('gone' as TreeId)).toBeNull();
        // Stored with the index.
        const saved = stored.get('tree_index') ?? [...stored.values()][0];
        expect(JSON.stringify(saved)).toContain('"sampleVersion":"3.33.0"');
    });

    it('an update marks it again with the new version', () => {
        TreeManager.markSampleTree(SHOWCASE, MARK);
        TreeManager.markSampleTree(SHOWCASE, { ...MARK, sampleVersion: '3.34.0' });
        expect(tree(SHOWCASE).sample?.sampleVersion).toBe('3.34.0');
    });

    it('the bundled Berg sample is never made a showcase (it has no research at all)', () => {
        TreeManager.markSampleTree(BERGS, MARK);
        expect(tree(BERGS).sample).toBeUndefined();
        expect(TreeManager.sampleKindOf(BERGS)).toBe('demo');
    });

    it('a renamed showcase is a showcase still: the mark, not the name', () => {
        TreeManager.markSampleTree(SHOWCASE, MARK);
        TreeManager.renameTree(SHOWCASE, 'Moje zkouška');
        expect(TreeManager.sampleKindOf(SHOWCASE)).toBe('showcase');
        expect(sampleTagHtml(tree(SHOWCASE))).toContain('>Sample</span>');
        // A tree named like a sample is no sample.
        TreeManager.renameTree(OWN, 'Ukázka – rod Horáků');
        expect(TreeManager.sampleKindOf(OWN)).toBeNull();
    });
});

describe('findTreeByExportId finds the showcase again (a second opening only switches)', () => {
    it('by its mark and by its source export id', () => {
        expect(TreeManager.findTreeByExportId('showcase-cs')).toBeNull();
        TreeManager.markSampleTree(SHOWCASE, MARK);
        expect(TreeManager.findTreeByExportId('showcase-cs')?.id).toBe(SHOWCASE);
        // An older record with only the mark (no source id) is found too.
        delete tree(SHOWCASE).sourceExportId;
        expect(TreeManager.findTreeByExportId('showcase-cs')?.id).toBe(SHOWCASE);
        // Another language's showcase is another tree.
        expect(TreeManager.findTreeByExportId('showcase-de')).toBeNull();
    });
});

describe('sampleTagHtml', () => {
    it('the tag of either sample, with its hover text; none for another tree', () => {
        const html = sampleTagHtml({ sample: MARK });
        expect(html).toBe('<span class="tree-sample-tag" title="A made-up family for trying things out. Other trees stay unchanged; the sample can be deleted in Manage trees.">Sample</span>');
        expect(sampleTagHtml({ demo: true })).toBe(html);
        expect(sampleTagHtml({})).toBe('');
        expect(sampleTagHtml(null)).toBe('');
    });

    it('standing alone it is a control of its own: a tab stop with its words as its name', () => {
        setLanguage('cs');
        expect(sampleTagHtml({ demo: true }, { focusable: true })).toBe(
            '<span class="tree-sample-tag" title="Vymyšlená rodina k vyzkoušení. Ostatní stromy zůstávají beze změny; ukázku jde smazat ve Správě stromů."'
            + ' tabindex="0" role="button" aria-label="Ukázka, Vymyšlená rodina k vyzkoušení. Ostatní stromy zůstávají beze změny; ukázku jde smazat ve Správě stromů.">Ukázka</span>');
    });

    it('in every language the tag\'s word', () => {
        const words = { cs: 'Ukázka', en: 'Sample', de: 'Beispiel', pl: 'Przykład' } as const;
        for (const [lang, word] of Object.entries(words)) {
            setLanguage(lang as keyof typeof words);
            expect(sampleTagHtml({ sample: MARK })).toContain(`>${word}</span>`);
        }
    });
});

describe('the Manage trees row of a sample', () => {
    const plain = { owner: false, copyOrigin: null };

    it('the showcase: its research for viewing only (before any research tie it has)', () => {
        expect(treeOriginLine(meta(SHOWCASE, 'x', { sample: MARK }), plain)).toEqual({ kind: 'sample', text: 'sample research · view only' });
        const tied = meta(SHOWCASE, 'x', { sample: MARK, research: { id: '943fce29-c1c6-5433-8031-96ce4bbbcd8d' } as TreeMetadata['research'] });
        expect(treeOriginLine(tied, { owner: true, copyOrigin: null }).kind).toBe('sample');
        setLanguage('cs');
        expect(treeOriginLine(meta(SHOWCASE, 'x', { sample: MARK }), plain).text).toBe('výzkum ukázky · jen k prohlížení');
    });

    it('the Berg sample stays a tree without research', () => {
        expect(treeOriginLine(meta(BERGS, 'x', { demo: true }), plain)).toEqual({ kind: 'none', text: 'no research' });
        expect(treeSampleKind({ demo: true })).toBe('demo');
        expect(treeSampleKind({ sample: MARK, demo: true })).toBe('showcase');
    });

    it('the showcase\'s date as of its snapshot, in the UI\'s language', () => {
        expect(formatFlexDate('2026-11-01', 'cs')).toBe('1. 11. 2026');
        setLanguage('cs');
        expect(`stav k ${formatFlexDate('2026-11-01')}`).toBe('stav k 1. 11. 2026');
    });
});

describe('deleting a showcase tree (spec 143 K4)', () => {
    const RID = '943fce29-c1c6-5433-8031-96ce4bbbcd8d';
    const snap = { id: RID, status: { tree: { id: RID } }, log: null, material: null, queue: null };

    it('takes its research snapshot with its last tree', async () => {
        const { keepShowcaseResearch, showcaseSnapshot, resetShowcaseBridgeForTest } = await import('../showcase-bridge.js');
        try {
            const tie = { id: RID, fingerprint: 'f', syncedAt: '2026-11-01T09:00:00.000Z' } as TreeMetadata['research'];
            index([meta(SHOWCASE, 'Ukázka', { sample: MARK, research: tie }), meta(OWN, 'Novákovi', { sample: MARK, research: tie })]);
            keepShowcaseResearch(snap, 'https://stromapp.info');
            await TreeManager.deleteTree(SHOWCASE);
            // Another showcase tree of the same research still reads it.
            expect(showcaseSnapshot(RID)).not.toBeNull();
            await TreeManager.deleteTree(OWN);
            expect(showcaseSnapshot(RID)).toBeNull();
        } finally {
            resetShowcaseBridgeForTest();
        }
    });
});
