/**
 * "New Strom Research X" in the Research menu only as the bridge says it now
 * (T25): a version remembered from an earlier answer may be the one installed
 * since, so with the research not running, not asked in this page yet, or
 * last heard from long ago, the menu offers no update. The last send and the
 * rest of what was remembered stay. Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { noteResearchWaiting } from '../research-device.js';
import type { ResearchWaitingState } from '../ui/research-ui.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const OTHER = '7d1e9f30-2a4b-4c6d-8e0f-1a2b3c4d5e6f';
const BRIDGE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';
const INTAKE = { id: 'I0042', at: '2026-10-14T08:00:00.000Z' };

type Ui = {
    researchWaiting(): ResearchWaitingState | null;
    askResearchBridge(researchId: string, timeout: number): Promise<unknown>;
};

describe('the update notice of the research menu', () => {
    let methods: Record<string, unknown>;
    let store: Map<string, string>;
    let answer: (() => Response) | null;

    beforeAll(async () => {
        const { researchUiMethods } = await import('../ui/research-ui.js') as unknown as { researchUiMethods: Record<string, unknown> };
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
        methods = { ...researchUiMethods, ...researchSyncMethods };
    }, 60000);

    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
        answer = null;
        vi.stubGlobal('fetch', async () => {
            if (!answer) throw new TypeError('Failed to fetch');
            return answer();
        });
        // The research's bridge is known on this computer (as after a ?live=), what it said last remembered.
        store.set(`strom-research-bridge:${TREE}`, JSON.stringify({ base: BRIDGE, accepts: { sync: { auto: 'off' }, sources: true, verified: true } }));
        noteResearchWaiting(TREE, [], { update: { version: '1.12.1' }, lastIntake: INTAKE });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    // What a bridge said stays in the page (as in the app): the case "not asked" has a research of its own.
    function ui(researchId = TREE): Ui {
        return { ...methods, activeResearchId: () => researchId, activeResearchArchive: () => false } as unknown as Ui;
    }

    const status = (update: { version: string } | null) => () => new Response(JSON.stringify({
        tree: { id: TREE, name: 'Víškovi' }, head: '3f2a9c1e5b7d', links: ['open', 'update'], lastIntake: INTAKE,
        ...(update ? { update } : {}),
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    it('not asked in this page yet: no update, the last send stays', () => {
        store.set(`strom-research-bridge:${OTHER}`, JSON.stringify({ base: BRIDGE }));
        noteResearchWaiting(OTHER, [], { update: { version: '1.12.1' }, lastIntake: INTAKE });
        const known = ui(OTHER).researchWaiting();
        expect(known?.update).toBeNull();
        expect(known?.lastIntake).toEqual(INTAKE);
    });

    it('the bridge does not answer (the research not running): no update, the last send stays', async () => {
        const u = ui();
        expect(await u.askResearchBridge(TREE, 500)).toBeNull();
        const known = u.researchWaiting();
        expect(known?.update).toBeNull();
        expect(known?.lastIntake).toEqual(INTAKE);
    });

    it('the bridge answers with a newer version: shown, until its answer is old', async () => {
        const u = ui();
        answer = status({ version: '1.12.2' });
        expect(await u.askResearchBridge(TREE, 500)).not.toBeNull();
        expect(u.researchWaiting()?.update).toEqual({ version: '1.12.2' });
        // Not heard from for a minute (a hidden window asks nothing): not shown as now.
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
        expect(u.researchWaiting()?.update).toBeNull();
        expect(u.researchWaiting()?.lastIntake).toEqual(INTAKE);
    });

    it('the bridge answers without one (the research already updated): the remembered one goes', async () => {
        const u = ui();
        answer = status(null);
        expect(await u.askResearchBridge(TREE, 500)).not.toBeNull();
        expect(u.researchWaiting()?.update).toBeNull();
    });
});
