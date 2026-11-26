/**
 * The showcase's research kept (spec 143 K4): opening a showcase keeps its
 * research's snapshot with the research's id and answers it in the page; at
 * the next start the snapshots of the showcase trees still here answer again,
 * their status mirrored, those of trees gone are forgotten. The open tree is
 * the showcase when it carries the sample mark. Invented data (the Berg family).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { TreeId, TreeMetadata, TreeSampleMark } from '../types.js';
import type { ShowcaseFile } from '../showcase-format.js';
import { inShowcase } from '../research-link.js';
import { resetShowcaseBridgeForTest, showcaseSnapshot, showcaseFetchInstalled } from '../showcase-bridge.js';

const TREE = 'tree_showcase' as TreeId;
const RID = '943fce29-c1c6-5433-8031-96ce4bbbcd8d';
const MARK: TreeSampleMark = { exportId: 'showcase-cs', lang: 'cs', sampleVersion: '3.33.0', asOf: '2026-11-01T09:00:00.000Z' };

type Ui = {
    tieShowcaseResearch(treeId: TreeId, file: ShowcaseFile, research: { treeId?: string | null }): void;
    initShowcaseResearch(): void;
};

function file(): ShowcaseFile {
    return {
        header: { asOf: MARK.asOf } as ShowcaseFile['header'],
        tree: { format: 'ged', text: '' },
        research: { id: RID, status: { tree: { id: RID, kind: 'research' }, name: 'Bergovi' }, log: { entries: [] }, material: null, queue: null },
    };
}

let store: Map<string, string>;
let methods: Record<string, unknown>;
let trees: TreeMetadata[];
const ui = () => methods as unknown as Ui;

beforeAll(async () => {
    const { showcaseOpenMethods } = await import('../ui/showcase-open-ui.js') as unknown as { showcaseOpenMethods: Record<string, unknown> };
    methods = { ...showcaseOpenMethods, researchKeepCopy: () => undefined };
}, 60000);

beforeEach(async () => {
    store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
    });
    trees = [{ id: TREE, name: 'Ukázka', sample: MARK, research: { id: RID } } as unknown as TreeMetadata];
    const { DataManager } = await import('../data.js');
    const { TreeManager } = await import('../tree-manager.js');
    vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
    vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE);
    vi.spyOn(DataManager, 'getData').mockReturnValue({ persons: {}, partnerships: {} } as never);
    vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(id => trees.find(t => t.id === id) ?? null);
    vi.spyOn(TreeManager, 'getTrees').mockImplementation(() => trees);
    vi.spyOn(TreeManager, 'setResearchLink').mockImplementation(() => undefined as never);
});

afterEach(() => {
    resetShowcaseBridgeForTest();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the showcase research kept', () => {
    it('the open tree is the showcase by its mark', () => {
        expect(inShowcase()).toBe(true);
        trees = [{ id: TREE, name: 'Novákovi' } as TreeMetadata];
        expect(inShowcase()).toBe(false);
    });

    it('opening it keeps the snapshot and mirrors its status', async () => {
        const { researchStatusNow } = await import('../ui/research-sync-ui.js');
        ui().tieShowcaseResearch(TREE, file(), { treeId: RID });
        expect(showcaseSnapshot(RID)?.log).toEqual({ entries: [] });
        expect(store.has(`strom-showcase-research:${RID}`)).toBe(true);
        expect(showcaseFetchInstalled()).toBe(true);
        expect(researchStatusNow(RID)?.name).toBe('Bergovi');
    });

    it('answers again after a restart, only for a showcase tree still here', async () => {
        const { setMirroredResearchStatus, researchStatusNow } = await import('../ui/research-sync-ui.js');
        ui().tieShowcaseResearch(TREE, file(), { treeId: RID });
        store.set('strom-showcase-research:0a1b2c3d-0000-4000-8000-000000000000',
            JSON.stringify({ id: '0a1b2c3d-0000-4000-8000-000000000000', status: null, log: null, material: null, queue: null }));
        resetShowcaseBridgeForTest();
        setMirroredResearchStatus(RID, null);
        expect(showcaseSnapshot(RID)).toBeNull();
        ui().initShowcaseResearch();
        expect(showcaseSnapshot(RID)).not.toBeNull();
        expect(researchStatusNow(RID)?.name).toBe('Bergovi');
        expect(store.has('strom-showcase-research:0a1b2c3d-0000-4000-8000-000000000000')).toBe(false);
    });
});
