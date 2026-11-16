/**
 * Taking over after the main window closed (spec 097 §7, K2.6): the order
 * (following windows first, then the detached ones, the main window's order
 * within each), one winner by the lock after `rank × 400 ms`, the others told
 * and saying so once the new main window is here; nothing without a live
 * session, without a stored bridge address (failed in every window) or when
 * the main window comes back within 3 s (its F5).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WindowBus, createMemoryHub, type WindowStatus } from '../window-bus.js';
import { SatelliteClient, MAIN_SILENCE_MS, MAIN_CHECK_MS, type SatelliteDataTarget } from '../satellite.js';
import { tryBecomeMain, type LocksLike } from '../window-role.js';
import { Takeover, takeoverOrder, takeoverRank, TAKEOVER_STEP_MS, type TakeoverLive } from '../takeover.js';
import type { TreeId } from '../../types.js';

const TREE = 'tree-1' as TreeId;
const A = 'aa11aa11';
const B = 'bb22bb22';
const C = 'cc33cc33';

describe('the order of taking over', () => {
    it('following windows first, then the detached ones, each in the main window\'s order; a window without a following never', () => {
        expect(takeoverOrder([A, B, C], { A: undefined, [A]: 'detached', [B]: 'paused', [C]: 'attached' })).toEqual([B, C, A]);
        expect(takeoverOrder([A, B, C], { [A]: 'attached', [C]: 'detached' })).toEqual([A, C]);
        expect(takeoverOrder([A, B], {})).toEqual([]);
    });

    it('a window\'s rank in a status (-1: none, or no status)', () => {
        expect(takeoverRank(B, { windows: [A, B], agents: { [A]: 'attached', [B]: 'attached' } })).toBe(1);
        expect(takeoverRank(A, { windows: [A, B], agents: { [A]: 'detached', [B]: 'paused' } })).toBe(1);
        expect(takeoverRank(A, { windows: [A, B] })).toBe(-1);
        expect(takeoverRank(A, null)).toBe(-1);
    });
});

/** One lock for every window, as navigator.locks keeps it (`ifAvailable`, held until released). */
function sharedLocks(): LocksLike & { holder: () => boolean; release: () => void } {
    let held: (() => void) | null = null;
    return {
        holder: () => held !== null,
        release: () => { const r = held; held = null; r?.(); },
        request: (_name, _opts, cb) => {
            if (held) return Promise.resolve(cb(null));
            const done = cb({}) as Promise<void>;
            let release: () => void = () => {};
            const gone = new Promise<void>((r) => { release = r; });
            held = () => release();
            void Promise.race([done, gone]).then(() => { held = null; });
            return Promise.resolve();
        },
        query: async () => ({ held: held ? [{ name: 'strom-main' }] : [] }),
    };
}

function data(): SatelliteDataTarget {
    return { setWindowSink: () => {}, loadFromWindow: () => {}, windowDataJson: () => '{}', isEditSessionActive: () => false };
}

interface Win {
    client: SatelliteClient;
    takeover: Takeover;
    become: ReturnType<typeof vi.fn>;
    taken: ReturnType<typeof vi.fn>;
    restarted: TakeoverLive[];
}

let hub: ReturnType<typeof createMemoryHub>;
let main: WindowBus;
let locks: ReturnType<typeof sharedLocks>;
let bridge: boolean;
let windows: Win[];

function win(id: string, research: string | null = 'G0001'): Win {
    const client = new SatelliteClient({ kind: 'family', treeId: TREE, windowId: id, newId: false }, {
        bus: new WindowBus(id, hub.channel()), data: data(), storage: null, locks, closeSelf: () => {}, hasFocus: () => true, bounds: () => undefined,
    });
    const restarted: TakeoverLive[] = [];
    const become = vi.fn(async (live: TakeoverLive, locked: () => void) => {
        const lock = await tryBecomeMain(locks);
        if (!lock) return false;
        locked();
        restarted.push(live);
        return true;
    });
    const taken = vi.fn();
    const takeover = new Takeover(client, {
        researchId: () => research,
        followOn: () => true,
        hasBridge: () => bridge,
        become,
        changed: () => {},
        takenOver: taken,
    }).start();
    client.start();
    const w = { client, takeover, become, taken, restarted };
    windows.push(w);
    return w;
}

function status(over: Partial<WindowStatus> = {}): WindowStatus {
    return {
        live: true, locked: false, readOnly: true, researchState: null, treeExists: true, treeId: TREE, treeName: 'Strom',
        revision: 1, canUndo: false, canRedo: false, windows: [A, B], agents: { [A]: 'detached', [B]: 'attached' }, ...over,
    };
}

async function settle(ms = 0): Promise<void> {
    await hub.flush();
    await vi.advanceTimersByTimeAsync(ms);
    await hub.flush();
}

/** The main window says its status, then closes (its lock released, silence). */
async function mainCloses(over: Partial<WindowStatus> = {}): Promise<void> {
    main.post({ type: 'status', ...status(over) });
    await settle();
    locks.release();
    await settle(MAIN_SILENCE_MS + MAIN_CHECK_MS);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
    hub = createMemoryHub();
    main = new WindowBus('main-1', hub.channel());
    locks = sharedLocks();
    bridge = true;
    windows = [];
    // The main window holds the lock.
    void tryBecomeMain(locks);
});

afterEach(() => {
    for (const w of windows) { w.takeover.stop(); w.client.stop(); }
    vi.useRealTimers();
});

describe('taking over after the main window closed', () => {
    it('the first following window takes over at once; the detached one is told, never tries, and says so once the new main window is here', async () => {
        const a = win(A);
        const b = win(B);
        await settle();
        expect(locks.holder()).toBe(true);
        await mainCloses();
        expect(b.client.connection).toBe('main-closed');
        expect(b.become).toHaveBeenCalledTimes(1);
        expect(b.takeover.phase).toBe('running');
        expect(b.restarted).toEqual([{ treeId: TREE, researchId: 'G0001', follow: true }]);
        // A's turn (400 ms) passes: it was told and does not try.
        await settle(TAKEOVER_STEP_MS * 2);
        expect(a.become).not.toHaveBeenCalled();
        expect(a.takeover.phase).toBeNull();
        expect(a.taken).not.toHaveBeenCalled();
        // The new main window's status: A says another window took over (once).
        const next = new WindowBus('main-2', hub.channel());
        next.post({ type: 'status', ...status({ windows: [A] }) });
        await settle();
        expect(a.client.connection).toBe('connected');
        expect(a.taken).toHaveBeenCalledTimes(1);
        next.post({ type: 'status', ...status({ windows: [A] }) });
        await settle();
        expect(a.taken).toHaveBeenCalledTimes(1);
    });

    it('the second in the order waits its 400 ms; one lock, one winner', async () => {
        const a = win(A);
        const b = win(B);
        await settle();
        // B detached now, A following: A first.
        main.post({ type: 'status', ...status({ agents: { [A]: 'paused', [B]: 'detached' } }) });
        await settle();
        locks.release();
        await vi.advanceTimersByTimeAsync(MAIN_SILENCE_MS + MAIN_CHECK_MS);
        await hub.flush();
        expect(a.become).toHaveBeenCalledTimes(1);
        expect(b.become).not.toHaveBeenCalled();
        expect(a.takeover.phase).toBe('running');
        await settle(TAKEOVER_STEP_MS * 3);
        expect(b.become).not.toHaveBeenCalled();
    });

    it('without a stored bridge address no window becomes the main one: every one says it cannot be restored', async () => {
        bridge = false;
        const a = win(A);
        const b = win(B);
        await settle();
        await mainCloses();
        await settle(TAKEOVER_STEP_MS * 2);
        expect(a.become).not.toHaveBeenCalled();
        expect(b.become).not.toHaveBeenCalled();
        expect(a.takeover.stripPhase).toBe('failed');
        expect(b.takeover.stripPhase).toBe('failed');
        // A main window opened by hand: the strip goes, nobody says another one took over.
        main.post({ type: 'status', ...status() });
        await settle();
        expect(a.takeover.phase).toBeNull();
        expect(a.taken).not.toHaveBeenCalled();
    });

    it('nothing without a live session (spec 079 unchanged)', async () => {
        const a = win(A);
        const b = win(B);
        await settle();
        await mainCloses({ live: false });
        await settle(TAKEOVER_STEP_MS * 2);
        expect(a.client.connection).toBe('main-closed');
        expect(a.become).not.toHaveBeenCalled();
        expect(b.become).not.toHaveBeenCalled();
        expect(b.takeover.phase).toBeNull();
    });

    it('a tree read-only without a research known (no session in the mirror): the main window closed as in spec 079', async () => {
        const a = win(A, null);
        await settle();
        await mainCloses({ windows: [A], agents: { [A]: 'attached' } });
        await settle(TAKEOVER_STEP_MS);
        expect(a.client.connection).toBe('main-closed');
        expect(a.become).not.toHaveBeenCalled();
        expect(a.takeover.phase).toBeNull();
    });

    it('a window without a following of its own (the overview\'s) never takes over', async () => {
        const a = win(A);
        await settle();
        await mainCloses({ windows: [A], agents: {} });
        await settle(TAKEOVER_STEP_MS);
        expect(a.become).not.toHaveBeenCalled();
        expect(a.takeover.phase).toBeNull();
    });

    it('the main window\'s F5 (its status back within 3 s) starts nothing', async () => {
        const a = win(A);
        const b = win(B);
        await settle();
        main.post({ type: 'status', ...status() });
        await settle(MAIN_SILENCE_MS - 1000);
        // The reloaded page: another id, the lock taken again at its start.
        const again = new WindowBus('main-1b', hub.channel());
        again.post({ type: 'status', ...status() });
        await settle(MAIN_SILENCE_MS + MAIN_CHECK_MS);
        again.post({ type: 'status', ...status() });
        await settle(2000);
        expect(a.client.connection).toBe('connected');
        expect(a.become).not.toHaveBeenCalled();
        expect(b.become).not.toHaveBeenCalled();
        expect(a.takeover.phase).toBeNull();
        expect(b.takeover.phase).toBeNull();
    });
});
