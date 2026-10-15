/**
 * "The research has been an archive since …" in Research for this tree: the
 * date of the LAST switch of the research's mode (K5.3/A1). A second switch
 * dates the line anew; the bridge's own date wins when it says one; a research
 * waiting for its agent (`agentHere: false`) is no switch. Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { researchAutoState } from '../research-device.js';
import { TreeManager } from '../tree-manager.js';
import type { TreeId } from '../types.js';

const TREE = 'tree_1700000000000_ab12c' as TreeId;
const RID = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const BRIDGE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';

type Ui = { researchNoteMode(treeId: TreeId): void };

describe('the date of the research mode switch', () => {
    let methods: Record<string, unknown>;
    let store: Map<string, string>;

    beforeAll(async () => {
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
        methods = researchSyncMethods;
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
        vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ research: { id: RID, fingerprint: 'f', syncedAt: '2026-10-01T08:00:00Z' } } as never);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const ui = (): Ui => ({ ...methods, researchSyncCapable: () => true } as unknown as Ui);
    const bridgeSays = (accepts: Record<string, unknown>): void => {
        store.set(`strom-research-bridge:${RID}`, JSON.stringify({ base: BRIDGE, accepts: { sync: { auto: 'mirror' }, ...accepts } }));
    };
    const noticeOn = (iso: string): void => {
        vi.setSystemTime(new Date(iso));
        ui().researchNoteMode(TREE);
    };

    it('a second switch dates the line anew (not the first switch for ever)', () => {
        bridgeSays({ mode: 'research' });
        noticeOn('2026-09-20T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBeUndefined();
        bridgeSays({ mode: 'archive' });
        noticeOn('2026-10-01T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBe('2026-10-01T10:00:00.000Z');
        // Noticed again in the same mode: the date stays.
        noticeOn('2026-10-05T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBe('2026-10-01T10:00:00.000Z');
        // Back to research on 10 October: that is the date now.
        bridgeSays({ mode: 'research' });
        noticeOn('2026-10-10T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBe('2026-10-10T10:00:00.000Z');
    });

    it('a state kept before (a dated switch, no mode noticed): the next switch still dates anew', () => {
        store.set(`strom-research-auto:${TREE}`, JSON.stringify({ modeSeen: 'agent', modeSince: '2026-10-01T10:00:00.000Z' }));
        bridgeSays({ mode: 'archive' });
        noticeOn('2026-10-03T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBe('2026-10-01T10:00:00.000Z');
        bridgeSays({ mode: 'research' });
        noticeOn('2026-10-12T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBe('2026-10-12T10:00:00.000Z');
    });

    it("the bridge's own date of the switch wins over the day the app noticed it", () => {
        bridgeSays({ mode: 'research' });
        noticeOn('2026-09-20T10:00:00Z');
        bridgeSays({ mode: 'archive', modeSince: '2026-10-08T07:30:00.000Z' });
        noticeOn('2026-10-11T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBe('2026-10-08T07:30:00.000Z');
    });

    it('a research waiting for its agent is no switch: no date, nothing said', () => {
        bridgeSays({ mode: 'research' });
        noticeOn('2026-09-20T10:00:00Z');
        bridgeSays({ mode: 'research', agentHere: false });
        noticeOn('2026-10-02T10:00:00Z');
        expect(researchAutoState(TREE).modeSince).toBeUndefined();
        expect(researchAutoState(TREE).modeSeen).toBe('agent');
    });
});
