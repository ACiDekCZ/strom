/**
 * The research of the showcase (spec 143):
 * - one `strom demo` made (K2, R1 N1): its status says `tree.demo`; read and
 *   written through its bridge as any research, but nothing of the agent's
 *   is offered (noAgent) and its tree carries the "Sample" tag;
 * - one opened from a showcase file (K4.1): nothing of it is ever sent, a
 *   send or a research link asked by hand only says why.
 * Invented data (the Berg family).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ResearchLink, TreeId, TreeMetadata } from '../types.js';
import { sanitizeLiveStatus, setInShowcaseLookup, setShowcaseWhy, researchSchemeUrl } from '../research-link.js';
import { noteResearchBridgeStatus, researchTreeOfStatus, storedResearchDemo, noteResearchLinks, announcedResearchLinks } from '../research-device.js';
import { sampleTagHtml } from '../ui/sample-tag.js';

const TREE = 'berg-demo' as TreeId;
const RESEARCH = '7d3e9a10-4b2c-4e5f-8a6b-1c2d3e4f5a6b';
const BRIDGE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';

type Ui = {
    activeResearchNoAgent(): boolean;
    activeResearchDemo(): boolean;
    researchSendTree(treeId: TreeId): Promise<void>;
    postResearchSend(treeId: TreeId, opts: { auto: boolean }): Promise<void>;
    launchResearchLink(url: string, kind?: string, el?: HTMLElement | null): Promise<string>;
    handOverResearchLink(url: string): void;
    researchLinkAvailable(action: string): boolean;
};

let store: Map<string, string>;

beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
    });
});

afterEach(() => {
    setInShowcaseLookup(null);
    setShowcaseWhy(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** What the research's bridge said last (kept in this browser). */
const bridgeSaid = (tree: Record<string, unknown>) => store.set(`strom-research-bridge:${RESEARCH}`,
    JSON.stringify({ base: BRIDGE, accepts: { mode: 'research', sync: { auto: 'write' } }, tree }));

describe('tree.demo', () => {
    it('is read from the status only when true', () => {
        expect(sanitizeLiveStatus({ tree: { id: RESEARCH, demo: true } })?.treeDemo).toBe(true);
        expect(sanitizeLiveStatus({ tree: { id: RESEARCH, demo: 'yes' } })?.treeDemo).toBeUndefined();
        expect(sanitizeLiveStatus({ tree: { id: RESEARCH } })?.treeDemo).toBeUndefined();
    });

    it('is kept with the bridge for the next start', () => {
        const status = sanitizeLiveStatus({ tree: { id: RESEARCH, demo: true } })!;
        noteResearchBridgeStatus(RESEARCH, null, '', researchTreeOfStatus(status));
        expect(storedResearchDemo(RESEARCH)).toBe(true);
        noteResearchBridgeStatus(RESEARCH, null, '', researchTreeOfStatus(sanitizeLiveStatus({ tree: { id: RESEARCH } })!));
        expect(storedResearchDemo(RESEARCH)).toBe(false);
    });

    it('tags its tree "Sample"; another research tree has no tag', () => {
        const tree = { research: { id: RESEARCH } as ResearchLink };
        expect(sampleTagHtml(tree)).toBe('');
        bridgeSaid({ kind: 'research', state: 'research', demo: true });
        expect(sampleTagHtml(tree)).toContain('tree-sample-tag');
    });
});

describe('the research UI', () => {
    let methods: Record<string, unknown>;
    let meta: TreeMetadata;
    const ui = () => methods as unknown as Ui;

    beforeAll(async () => {
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
        const { researchUiMethods } = await import('../ui/research-ui.js') as unknown as { researchUiMethods: Record<string, unknown> };
        methods = { ...researchSyncMethods, ...researchUiMethods };
    }, 60000);

    beforeEach(async () => {
        meta = { id: TREE, name: 'Bergovi', research: { id: RESEARCH, fingerprint: 'f', syncedAt: '2026-10-20T10:00:00.000Z' } } as unknown as TreeMetadata;
        const { DataManager } = await import('../data.js');
        const { TreeManager } = await import('../tree-manager.js');
        vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE);
        vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(() => meta);
        vi.spyOn(TreeManager, 'canSendToResearch').mockImplementation(id => id === TREE);
    });

    it('offers nothing of the agent for the research strom demo made', () => {
        bridgeSaid({ kind: 'research', state: 'research' });
        expect(ui().activeResearchDemo()).toBe(false);
        expect(ui().activeResearchNoAgent()).toBe(false);
        bridgeSaid({ kind: 'research', state: 'research', demo: true });
        expect(ui().activeResearchDemo()).toBe(true);
        expect(ui().activeResearchNoAgent()).toBe(true);
    });

    it('sends nothing of a showcase tree; by hand it says why', async () => {
        meta = { ...meta, sample: { exportId: 'x', sampleVersion: 1, lang: 'cs', asOf: '2026-10-01' } } as unknown as TreeMetadata;
        const fetchSpy = vi.fn(async () => new Response('{}'));
        vi.stubGlobal('fetch', fetchSpy);
        const why = vi.fn();
        setShowcaseWhy(why);
        await ui().researchSendTree(TREE);
        expect(why).toHaveBeenCalledWith(null, 'send');
        why.mockClear();
        await ui().postResearchSend(TREE, { auto: true });
        expect(why).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('opens no research link in the showcase, only says why; draws its main actions', async () => {
        const handed: string[] = [];
        vi.stubGlobal('document', {
            createElement: () => ({ style: {}, click: () => handed.push('click'), remove: () => undefined }),
            body: { appendChild: () => undefined },
        });
        setInShowcaseLookup(() => true);
        const why = vi.fn();
        setShowcaseWhy(why);
        const url = researchSchemeUrl('conflict', { tree: RESEARCH, conflict: 'X0007', conflictDo: 'agent' } as never)!;
        expect(await ui().launchResearchLink(url, 'agent', null)).toBe('opened');
        expect(why).toHaveBeenLastCalledWith(null, 'conflict-agent');
        ui().handOverResearchLink(researchSchemeUrl('work', { tree: RESEARCH, workDo: 'loop' } as never)!);
        expect(why).toHaveBeenLastCalledWith(null, 'work');
        expect(handed).toEqual([]);
        expect(ui().researchLinkAvailable('work')).toBe(true);
        expect(ui().researchLinkAvailable('excerpt')).toBe(false);
    });

    it('reads the showcase status through the standard code, keeping nothing of it as this computer\'s research', async () => {
        const { keepShowcaseResearch, resetShowcaseBridgeForTest } = await import('../showcase-bridge.js');
        const { fetchStatus } = await import('../ui/research-ui.js');
        const { showcaseBridgeBase } = await import('../research-link.js');
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
        noteResearchLinks(['open'], undefined);
        try {
            keepShowcaseResearch({ id: RESEARCH, status: { tree: { id: RESEARCH, kind: 'research' }, links: ['work', 'chat'],
                waiting: [{ id: 'W1', text: 'Která Anna Bergová?' }] }, log: null, material: null, queue: null }, 'https://stromapp.info');
            const status = await fetchStatus(`${showcaseBridgeBase(RESEARCH)}/status`);
            expect(status?.treeId).toBe(RESEARCH);
            expect(announcedResearchLinks()).toEqual(['open']);
            expect([...store.keys()].filter(k => k.includes(RESEARCH))).toEqual([`strom-showcase-research:${RESEARCH}`]);
        } finally {
            resetShowcaseBridgeForTest();
        }
    });
});
