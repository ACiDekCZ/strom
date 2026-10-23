/**
 * A research waiting for its agent saves as an archive does, and the app
 * shows it as one until the agent starts (spec 017 decision e): the
 * "Archive" label in the tree switcher and the archive's intro of the phone
 * dialog. Once the bridge says the agent is here: "Research" and the
 * research's intro. Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ResearchLink, TreeId, TreeMetadata } from '../types.js';
import { strings } from '../strings.js';

const TREE = 'waiting-tree' as TreeId;
const RESEARCH = '5a1c3e70-2b4d-4f6a-8c0e-9d1b3f5a7c90';
const BRIDGE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';

type Ui = {
    treeKindLabel(tree: TreeMetadata): string;
    phoneIntroLines(): readonly string[];
};

describe('a research waiting for its agent is shown as an archive', () => {
    let methods: Record<string, unknown>;
    let store: Map<string, string>;
    const link: ResearchLink = { id: RESEARCH, fingerprint: 'f', syncedAt: '2026-10-20T10:00:00.000Z' } as ResearchLink;
    const tree = { id: TREE, name: 'Hruskovi z Neudorfelu', research: link } as unknown as TreeMetadata;

    beforeAll(async () => {
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
        const { researchOthersMethods } = await import('../ui/research-others-ui.js') as unknown as { researchOthersMethods: Record<string, unknown> };
        const { phoneMethods } = await import('../ui/phone-ui.js') as unknown as { phoneMethods: Record<string, unknown> };
        methods = { ...researchSyncMethods, ...researchOthersMethods, ...phoneMethods };
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
        const { DataManager } = await import('../data.js');
        const { TreeManager } = await import('../tree-manager.js');
        vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE);
        vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(() => tree);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const ui = () => methods as unknown as Ui;
    /** What the research's bridge said last (kept in this browser). */
    const bridgeSaid = (accepts: Record<string, unknown>) =>
        store.set(`strom-research-bridge:${RESEARCH}`, JSON.stringify({ base: BRIDGE, accepts }));

    it('waiting for its agent: the archive label and the archive\'s phone intro', () => {
        bridgeSaid({ mode: 'research', agentHere: false, sync: { auto: 'write' } });
        expect(ui().treeKindLabel(tree)).toBe(strings.treeSwitcher.kindArchive);
        expect(ui().phoneIntroLines()).toEqual(strings.phone.introArchive);
    });

    it('the agent started (the bridge says research, the agent here): research', () => {
        bridgeSaid({ mode: 'research', sync: { auto: 'write' } });
        expect(ui().treeKindLabel(tree)).toBe(strings.treeSwitcher.kindResearch);
        expect(ui().phoneIntroLines()).toEqual(strings.phone.intro);
    });

    it('an archive stays an archive', () => {
        bridgeSaid({ mode: 'archive', sync: { auto: 'write' } });
        expect(ui().treeKindLabel(tree)).toBe(strings.treeSwitcher.kindArchive);
        expect(ui().phoneIntroLines()).toEqual(strings.phone.introArchive);
    });
});
