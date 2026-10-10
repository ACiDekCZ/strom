/**
 * N40: a send the research wrote, then one it took nothing new from. The
 * research's version is still the copy kept at the first send, so the
 * changes per person stay listed against it — also once the page is opened
 * again (the copy read back from storage). Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { StromData, ResearchLink, ResearchSend, TreeId, TreeMetadata } from '../types.js';

const TREE = 'took-nothing-tree' as TreeId;

const store = vi.hoisted(() => ({
    copies: new Map<string, { data: unknown; fp: string }>(),
    local: new Map<string, string>(),
}));

vi.mock('../research-copy.js', () => ({
    saveResearchCopy: async (id: string, data: unknown, fp: string) => { store.copies.set(`c:${id}`, { data: structuredClone(data), fp }); },
    loadResearchCopy: async (id: string, fp?: string) => {
        const c = store.copies.get(`c:${id}`);
        return c && (fp === undefined || c.fp === fp) ? structuredClone(c.data) : null;
    },
    saveResearchPrevCopy: async (id: string, data: unknown, fp: string) => { store.copies.set(`p:${id}`, { data: structuredClone(data), fp }); },
    loadResearchPrevCopy: async (id: string, fp: string) => {
        const c = store.copies.get(`p:${id}`);
        return c && c.fp === fp ? structuredClone(c.data) : null;
    },
}));

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { contentFingerprint } from '../research-link.js';

const person = (id: string, firstName: string, birthPlace?: string) => ({
    id, firstName, lastName: 'Novák', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
    refn: id.toUpperCase(), ...(birthPlace ? { birthPlace } : {}),
});
const tree = (janPlace?: string): StromData => ({
    persons: { p1: person('p1', 'Josef'), p2: person('p2', 'Jan', janPlace) },
    partnerships: {},
} as unknown as StromData);

type Ui = {
    researchKeepCopy(treeId: TreeId, data: StromData, fp?: string): void;
    researchChangesReady(): Promise<{ name: string; kinds: string[] }[] | null>;
    researchNoteSending(treeId: TreeId, data: StromData, fingerprint: string): void;
    researchNoteWritten(treeId: TreeId, fingerprint: string, at: string): void;
    researchNoteTookNothing(treeId: TreeId, fingerprint: string, fp?: string): void;
};

/** The UI as a fresh page has it (module state read anew). */
async function freshUi(): Promise<Ui> {
    vi.resetModules();
    const { researchChangesMethods } = await import('../ui/research-changes-ui.js');
    const { researchSyncMethods } = await import('../ui/research-sync-ui.js');
    return { ...researchSyncMethods, ...researchChangesMethods, refreshResearchSyncUi() {} } as unknown as Ui;
}

const rows = (list: { name: string; kinds: string[] }[] | null) => list?.map(c => `${c.name}: ${c.kinds.join(',')}`) ?? null;

describe('N40: changes per person after a send the research took nothing from', () => {
    let data: StromData;
    let link: ResearchLink;

    // The first load of the UI modules transforms their whole import graph; on a busy machine
    // that alone could pass the test's 5 s. Done once here, a fresh page only evaluates them again.
    beforeAll(async () => {
        await import('../ui/research-changes-ui.js');
        await import('../ui/research-sync-ui.js');
    });

    beforeEach(() => {
        store.copies.clear();
        store.local.clear();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.local.get(k) ?? null,
            setItem: (k: string, v: string) => { store.local.set(k, v); },
            removeItem: (k: string) => { store.local.delete(k); },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** Mocks read through these, so a fresh module sees the same tree and tie. */
    async function stubs(): Promise<void> {
        const dm = (await import('../data.js')).DataManager as typeof DataManager;
        const tm = (await import('../tree-manager.js')).TreeManager as typeof TreeManager;
        vi.spyOn(dm, 'isViewMode').mockReturnValue(false);
        vi.spyOn(dm, 'getCurrentTreeId').mockReturnValue(TREE);
        vi.spyOn(dm, 'getData').mockImplementation(() => data);
        vi.spyOn(tm, 'getTreeMetadata').mockImplementation(() => ({ id: TREE, research: link } as unknown as TreeMetadata));
    }

    it('the copy of the written send stays the research\'s version: the edit is listed, after a reopen and another edit too', async () => {
        const base = tree();
        link = { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', fingerprint: contentFingerprint(base), syncedAt: '2026-10-01T10:00:00.000Z' };
        data = base;
        let ui = await freshUi();
        await stubs();
        ui.researchKeepCopy(TREE, base, link.fingerprint);

        // A send the research wrote (Kolín).
        data = tree('Kolín');
        const f1 = contentFingerprint(data);
        ui.researchNoteSending(TREE, data, f1);
        ui.researchNoteWritten(TREE, f1, '2026-10-08T10:00:00.000Z');
        link = { ...link, sent: { fingerprint: f1, at: '2026-10-08T10:00:00.000Z', changes: 1, state: 'written' } as ResearchSend };

        // Then one it took nothing from (Brno).
        data = tree('Brno');
        const f2 = contentFingerprint(data);
        ui.researchNoteSending(TREE, data, f2);
        ui.researchNoteTookNothing(TREE, f2);
        link = { ...link, sent: { fingerprint: f2, at: '2026-10-08T10:05:00.000Z', changes: 0, state: 'written' } as ResearchSend };
        expect(rows(await ui.researchChangesReady())).toEqual(['Jan Novák: birth']);

        // Opened again: the copy read back from storage is the same.
        ui = await freshUi();
        await stubs();
        expect(rows(await ui.researchChangesReady())).toEqual(['Jan Novák: birth']);

        // Another edit: still against the research's version.
        data = tree('Plzeň');
        expect(rows(await ui.researchChangesReady())).toEqual(['Jan Novák: birth']);
        // Back to what the research has: nothing listed.
        data = tree('Kolín');
        expect(rows(await ui.researchChangesReady())).toEqual([]);
    });
});
