/**
 * A task's place in the Queue without following (spec 052 §4 with spec 057
 * §7): the ⋯ offers "Do next" (and To the end / Reset with `queue.own`) for
 * the research the overview acts on — the followed one, else the one viewed
 * through its bridge — and nothing while the bridge does not answer (the
 * overview drawn from the tree). The write goes to the viewed research's
 * bridge as while following, and its status is asked again at once (the
 * stream's way while following, the bridge itself without).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LiveSession, OverviewViewing } from '../ui/research-ui.js';
import type { LiveQueueItem } from '../research-link.js';
import type { TreeId } from '../types.js';

const fake = vi.hoisted(() => ({ session: null as unknown, onWrite: null as null | (() => void) }));

vi.mock('../ui/research-ui.js', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../ui/research-ui.js')>();
    return { ...orig, researchSession: () => fake.session, liveSession: () => null };
});

vi.mock('../research-directions-write.js', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../research-directions-write.js')>();
    const answer = (task: string) => {
        fake.onWrite?.();
        return { ok: true, task: { id: task, text: 'Matriky', state: 'next', own: 'next' }, was: {}, head: '' };
    };
    return {
        ...orig,
        setTaskOrder: vi.fn(async (_base: string, task: string) => answer(task)),
        restoreTaskOrder: vi.fn(async (_base: string, task: string) => answer(task)),
    };
});

import { researchOffLineMethods, taskMenuOrders } from '../ui/research-offline-ui.js';
import { setTaskOrder } from '../research-directions-write.js';

const actual = await vi.importActual<typeof import('../ui/research-ui.js')>('../ui/research-ui.js');

const TREE = 'qo-tree' as TreeId;
const BASE = 'http://127.0.0.1:47123/Zq8tY2kQw9xLmN4pRs7';
const QUEUE: LiveQueueItem[] = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next' },
    { id: 'T0102', text: 'Sčítání lidu 1880', state: 'next' },
    { id: 'T0103', text: 'Pozemková kniha', state: 'next' },
];

function sessionOf(o: Partial<LiveSession> = {}): LiveSession {
    return {
        bridge: { base: BASE, status: `${BASE}/status`, ged: '', events: `${BASE}/events`, log: '' },
        researchId: 'R1', treeId: TREE, name: 'Fíškovi', head: 'h', headAt: '', working: [], waiting: [],
        features: ['queue.next'], accepts: null, queue: structuredClone(QUEUE), queueMore: 0,
        update: null, spend: null, lastIntake: null, researches: [], autoCollapsed: new Set(), seenWaiting: new Set(),
        waitingPendingOpen: new Set(), overviewShown: new Set(), waitingView: {}, seenInSection: 0, startedAt: 0,
        startPersons: 0, startSources: 0, overview: true, logged: false, changes: [], adds: [], recent: null, ended: false,
        collapsed: false, seenChanges: 0, es: null, timer: null, failures: 0, lostSince: null, chain: Promise.resolve(),
        ...o,
    } as unknown as LiveSession;
}

function viewingOf(kind: 'bridge' | 'tree', session: LiveSession): OverviewViewing {
    return { treeId: TREE, researchId: 'R1', kind, session, status: null, refreshedAt: 0, working: null, agentStarted: false, logHead: '', waitingAt: 0 };
}

/** A UI where every method not named answers "nothing" (null). */
function fakeUi(overrides: Record<string, unknown>): Record<string, ReturnType<typeof vi.fn>> {
    return new Proxy(overrides, {
        get: (target, key) => (key in target ? target[key as string] : () => null),
    }) as never;
}

const writeUi = () => fakeUi({
    waitingHeadBeforeWrite: vi.fn(async () => ''),
    renderLivePanel: vi.fn(),
    researchStatusAfterWrite: vi.fn(),
    researchTakeOwnWriteHead: vi.fn(),
    showToast: vi.fn(),
});

beforeEach(() => {
    fake.session = null;
    fake.onWrite = null;
    vi.mocked(setTaskOrder).mockClear();
});

afterEach(() => {
    actual.setOverviewWindowDrawn(null);
});

describe('which research the ⋯ of a queued task acts on', () => {
    it('followed: its own; viewed through its bridge: the viewed one; drawn from the tree (bridge silent): none', () => {
        const followed = sessionOf();
        actual.setOverviewWindowDrawn({ live: followed, viewing: null });
        expect(actual.researchSession()).toBe(followed);
        const viewed = sessionOf();
        actual.setOverviewWindowDrawn({ live: null, viewing: viewingOf('bridge', viewed) });
        expect(actual.researchSession()).toBe(viewed);
        actual.setOverviewWindowDrawn({ live: null, viewing: viewingOf('tree', sessionOf({ features: null })) });
        expect(actual.researchSession()).toBeNull();
    });

    it('queue.next: "Do next" for a task not first, without following as while following', () => {
        const s = sessionOf();
        expect(taskMenuOrders(s, s.queue[2])).toEqual({ next: true, orders: ['next'] });
        // The task first already: nothing to set (Postpone and Give up stay the research's).
        expect(taskMenuOrders(s, s.queue[0])).toEqual({ next: true, orders: [] });
        // The agent at work on it: no "Do next".
        const busy = sessionOf({ working: [{ who: 'a', since: '', task: 'Pozemková kniha' }] as LiveSession['working'] });
        expect(taskMenuOrders(busy, busy.queue[2]).orders).toEqual([]);
    });

    it('queue.own with branches: Do next, To the end and Reset (a task with its own place)', () => {
        const s = sessionOf({ features: ['queue.own'], caps: { offLineBranches: true } as LiveSession['caps'] });
        expect(taskMenuOrders(s, { ...s.queue[1], own: 'last' })).toEqual({ next: false, orders: ['next', 'last', 'default'] });
        const both = sessionOf({ features: ['queue.own', 'queue.next'], caps: { offLineBranches: true } as LiveSession['caps'] });
        expect(taskMenuOrders(both, both.queue[1])).toEqual({ next: true, orders: ['next', 'last'] });
    });

    it('nothing to set: no research (the bridge silent), a lost bridge, an ended one, a research without the features', () => {
        const q = QUEUE[1];
        expect(taskMenuOrders(null, q)).toEqual({ next: false, orders: [] });
        expect(taskMenuOrders(sessionOf({ lostSince: 1 }), q).orders).toEqual([]);
        expect(taskMenuOrders(sessionOf({ ended: true }), q).orders).toEqual([]);
        expect(taskMenuOrders(sessionOf({ features: [] }), q).orders).toEqual([]);
    });
});

describe('how the status is asked after a write', () => {
    it('followed: the stream\'s way; viewed through its bridge: the bridge at once; otherwise not', () => {
        const s = sessionOf();
        expect(actual.statusAfterWriteWay(s, s, null)).toBe('live');
        expect(actual.statusAfterWriteWay(s, null, viewingOf('bridge', s))).toBe('bridge');
        // The overview drawn from the tree, another research viewed, an ended session: nothing asked.
        expect(actual.statusAfterWriteWay(s, null, viewingOf('tree', s))).toBeNull();
        expect(actual.statusAfterWriteWay(s, null, viewingOf('bridge', sessionOf()))).toBeNull();
        expect(actual.statusAfterWriteWay(s, null, null)).toBeNull();
        const ended = sessionOf({ ended: true });
        expect(actual.statusAfterWriteWay(ended, null, viewingOf('bridge', ended))).toBeNull();
    });
});

describe('a task\'s place written without following', () => {
    it('Do next: through the viewed research\'s bridge, the task first at once, its status asked again', async () => {
        const s = sessionOf();
        fake.session = s;
        const ui = writeUi();
        const out = await researchOffLineMethods.writeTaskOrder.call(ui as never, 'T0103', { do: 'next' });
        expect(out).toMatchObject({ ok: true, was: {} });
        expect(setTaskOrder).toHaveBeenCalledWith(BASE, 'T0103', 'next');
        expect(s.queue.map(q => q.id)).toEqual(['T0103', 'T0101', 'T0102']);
        expect(s.queue[0].own).toBe('next');
        expect(ui.researchStatusAfterWrite).toHaveBeenCalledWith(s);
    });

    it('To the end (queue.own): through the viewed research\'s bridge, its status asked again', async () => {
        const s = sessionOf({ features: ['queue.own'], caps: { offLineBranches: true } as LiveSession['caps'] });
        fake.session = s;
        const ui = writeUi();
        await expect(researchOffLineMethods.changeTaskOrder.call(ui as never, 'T0102', 'last')).resolves.toBe(true);
        expect(setTaskOrder).toHaveBeenCalledWith(BASE, 'T0102', 'last');
        expect(ui.researchStatusAfterWrite).toHaveBeenCalledWith(s);
    });

    it('no research to act on (the bridge silent): nothing written', async () => {
        const ui = writeUi();
        await expect(researchOffLineMethods.writeTaskOrder.call(ui as never, 'T0103', { do: 'next' })).resolves.toEqual({ ok: false, why: 'refused' });
        await expect(researchOffLineMethods.changeTaskOrder.call(ui as never, 'T0103', 'next')).resolves.toBe(false);
        expect(setTaskOrder).not.toHaveBeenCalled();
    });

    it('another research meanwhile (the viewed one replaced, following begun): refused, nothing asked', async () => {
        const s = sessionOf();
        fake.session = s;
        fake.onWrite = () => { fake.session = sessionOf(); };
        const ui = writeUi();
        await expect(researchOffLineMethods.writeTaskOrder.call(ui as never, 'T0102', { do: 'next' })).resolves.toEqual({ ok: false, why: 'refused' });
        expect(s.queue.map(q => q.id)).toEqual(['T0101', 'T0102', 'T0103']);
        expect(ui.researchStatusAfterWrite).not.toHaveBeenCalled();
    });
});
