/**
 * The research's status asked at once after a write through its bridge in
 * the Research overview without following (spec 057 §7): an item of
 * Awaiting action (Sent, back to To do, an answer, a file) and a line (its
 * state, an edit) ask it as "Do next" does — the way researchStatusAfterWrite
 * chooses (the stream's way while following, the bridge at once without).
 * A write made outside the overview's lists (a conflict decided, a fact
 * verified) asks it only for the research viewed without following; a
 * followed one, another research or the overview drawn from the tree: not.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LiveSession, OverviewViewing } from '../ui/research-ui.js';
import type { LiveDirection, LiveWaiting } from '../research-link.js';
import type { TreeId } from '../types.js';

const fake = vi.hoisted(() => ({ session: null as unknown }));

vi.mock('../ui/research-ui.js', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../ui/research-ui.js')>();
    return { ...orig, researchSession: () => fake.session, liveSession: () => null };
});

vi.mock('../research-waiting-write.js', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../research-waiting-write.js')>();
    return {
        ...orig,
        postWaitingSent: vi.fn(async (_base: string, task: string, what: 'sent' | 'unsent') => ({ ok: true, sent: what === 'sent' ? [task] : [], unsent: what === 'unsent' ? [task] : [], head: '' })),
        answerWaiting: vi.fn(async () => ({ ok: true, head: '' })),
        putWaitingFile: vi.fn(async () => ({ ok: true, head: '' })),
    };
});

vi.mock('../research-directions-write.js', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../research-directions-write.js')>();
    return {
        ...orig,
        setDirectionState: vi.fn(async () => ({ ok: true, direction: null, head: '' })),
        editDirection: vi.fn(async () => ({ ok: true, direction: null, head: '' })),
    };
});

import { researchWaitingWriteMethods } from '../ui/research-waiting-write-ui.js';
import { researchDirectionsMethods } from '../ui/research-directions-ui.js';
import { directionFormMethods } from '../ui/direction-form-ui.js';
import { postWaitingSent, answerWaiting, putWaitingFile } from '../research-waiting-write.js';
import { setDirectionState, editDirection } from '../research-directions-write.js';

const actual = await vi.importActual<typeof import('../ui/research-ui.js')>('../ui/research-ui.js');

const TREE = 'saw-tree' as TreeId;
const BASE = 'http://127.0.0.1:47123/Kp3vR8sWq2xYnB5tLm9';
const ITEM: LiveWaiting = { id: 'T0042', what: 'Dopis na faru v Bukovci', kind: 'letter', at: '2026-11-12T09:00:00Z', actions: ['sent'] } as unknown as LiveWaiting;
const LINE: LiveDirection = { id: 'G0001', name: 'Předci Josefa Fíška', state: 'active', direction: 'ancestors', focus: 'P0001', order: 1 } as unknown as LiveDirection;

function sessionOf(o: Partial<LiveSession> = {}): LiveSession {
    return {
        bridge: { base: BASE, status: `${BASE}/status`, ged: '', events: `${BASE}/events`, log: '' },
        researchId: 'R1', treeId: TREE, name: 'Fíškovi', head: 'h', headAt: '', working: [], waiting: [{ ...ITEM }],
        features: ['waiting.sent', 'waiting.answer'], accepts: { mediaTask: true }, queue: [], queueMore: 0,
        update: null, spend: null, lastIntake: null, researches: [{ ...LINE }], autoCollapsed: new Set(), seenWaiting: new Set(),
        waitingPendingOpen: new Set(), overviewShown: new Set(), waitingView: {}, seenInSection: 0, startedAt: 0,
        startPersons: 0, startSources: 0, overview: true, logged: false, changes: [], adds: [], recent: null, ended: false,
        collapsed: false, seenChanges: 0, es: null, timer: null, failures: 0, lostSince: null, chain: Promise.resolve(),
        caps: { directionsWrite: true },
        ...o,
    } as unknown as LiveSession;
}

function viewingOf(kind: 'bridge' | 'tree', session: LiveSession): OverviewViewing {
    return { treeId: TREE, researchId: 'R1', kind, session, status: null, refreshedAt: 0, working: null, agentStarted: false, logHead: '', waitingAt: 0 };
}

/** The module's own methods as written, every other method of the UI a spy (null). */
function uiWith(methods: object, overrides: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
    const spies = new Map<string, ReturnType<typeof vi.fn>>();
    const target: Record<string, unknown> = {
        waitingHeadBeforeWrite: vi.fn(async () => ''),
        researchStatusAfterWrite: vi.fn(),
        liveStatusSoon: vi.fn(),
        directionsView: () => ({ canWrite: true, canOrder: true }),
        closeDirectionMenu: vi.fn(),
        redrawDirections: vi.fn(),
        ...overrides,
    };
    const ui: Record<string, ReturnType<typeof vi.fn>> = new Proxy(target, {
        get: (t, key: string) => {
            if (key in t) return t[key];
            if (key in methods) return (methods as Record<string, unknown>)[key];
            if (!spies.has(key)) spies.set(key, vi.fn(() => null));
            return spies.get(key);
        },
    }) as never;
    return ui;
}

beforeEach(() => {
    fake.session = null;
    vi.mocked(postWaitingSent).mockClear();
    vi.mocked(answerWaiting).mockClear();
    vi.mocked(putWaitingFile).mockClear();
    vi.mocked(setDirectionState).mockClear();
    vi.mocked(editDirection).mockClear();
});

afterEach(() => {
    actual.setOverviewWindowDrawn(null);
});

describe('Awaiting action written through the viewed research\'s bridge: its status asked again', () => {
    it('Sent and back to To do', async () => {
        const s = sessionOf();
        fake.session = s;
        const ui = uiWith(researchWaitingWriteMethods);
        await researchWaitingWriteMethods.markWaitingSent.call(ui as never, s, s.waiting[0]);
        expect(postWaitingSent).toHaveBeenCalledWith(BASE, 'T0042', 'sent');
        expect(ui.researchStatusAfterWrite).toHaveBeenCalledWith(s);
        ui.researchStatusAfterWrite.mockClear();
        await researchWaitingWriteMethods.markWaitingUnsent.call(ui as never, s, 'T0042');
        expect(postWaitingSent).toHaveBeenLastCalledWith(BASE, 'T0042', 'unsent');
        expect(ui.researchStatusAfterWrite).toHaveBeenCalledWith(s);
        // Never the stream's own ask directly: researchStatusAfterWrite chooses the way.
        expect(ui.liveStatusSoon).not.toHaveBeenCalled();
    });

    it('an answer and a file', async () => {
        const s = sessionOf();
        fake.session = s;
        const ui = uiWith(researchWaitingWriteMethods);
        await expect(researchWaitingWriteMethods.sendWaitingAnswer.call(ui as never, s, s.waiting[0], 'Fara odpověděla.')).resolves.toBe('saved');
        expect(answerWaiting).toHaveBeenCalled();
        expect(ui.researchStatusAfterWrite).toHaveBeenCalledWith(s);
        ui.researchStatusAfterWrite.mockClear();
        const file = new File(['%PDF'], 'odpoved.pdf', { type: 'application/pdf' });
        await researchWaitingWriteMethods.sendWaitingFile.call(ui as never, s, 'T0042', file);
        expect(putWaitingFile).toHaveBeenCalled();
        expect(ui.researchStatusAfterWrite).toHaveBeenCalledWith(s);
    });

    it('the overview gone meanwhile (no research to act on): nothing asked', async () => {
        const s = sessionOf();
        const ui = uiWith(researchWaitingWriteMethods);
        await researchWaitingWriteMethods.markWaitingSent.call(ui as never, s, s.waiting[0]);
        expect(ui.researchStatusAfterWrite).not.toHaveBeenCalled();
    });
});

describe('a line written through the viewed research\'s bridge: its status asked again', () => {
    it('paused, and an edit', async () => {
        const s = sessionOf();
        fake.session = s;
        // The lines' module reads the research as the overview has it (viewed through its bridge).
        actual.setOverviewWindowDrawn({ live: null, viewing: viewingOf('bridge', s) });
        const ui = uiWith(researchDirectionsMethods);
        await expect(researchDirectionsMethods.changeDirectionState.call(ui as never, s.researches[0], 'pause')).resolves.toBe(true);
        expect(setDirectionState).toHaveBeenCalledWith(BASE, 'G0001', 'pause', undefined);
        expect(ui.researchStatusAfterWrite).toHaveBeenCalledWith(s);
        const form = uiWith(directionFormMethods);
        await expect(directionFormMethods.writeDirectionEdit.call(form as never, s.researches[0], { name: 'Předci Fíšků' })).resolves.toBe(true);
        expect(editDirection).toHaveBeenCalledWith(BASE, 'G0001', { name: 'Předci Fíšků' });
        expect(form.researchStatusAfterWrite).toHaveBeenCalledWith(s);
    });

    it('no research to act on (the bridge silent): nothing written, nothing asked', async () => {
        const ui = uiWith(researchDirectionsMethods);
        await expect(researchDirectionsMethods.changeDirectionState.call(ui as never, LINE, 'pause')).resolves.toBe(false);
        expect(setDirectionState).not.toHaveBeenCalled();
        expect(ui.researchStatusAfterWrite).not.toHaveBeenCalled();
    });
});

describe('a write made outside the overview\'s lists (a conflict decided, a fact verified)', () => {
    it('asks only the research viewed through its bridge without following', () => {
        const s = sessionOf();
        expect(actual.viewedWriteSession('R1', null, viewingOf('bridge', s))).toBe(s);
        // The id as the tree's link keeps it (lower case).
        expect(actual.viewedWriteSession('r1', null, viewingOf('bridge', s))).toBe(s);
        // Followed: its stream says it (nothing changes there).
        const followed = sessionOf();
        expect(actual.viewedWriteSession('R1', followed, viewingOf('bridge', s))).toBeNull();
        // Another research, the overview drawn from the tree, no bridge known, not open: nothing asked.
        expect(actual.viewedWriteSession('R2', null, viewingOf('bridge', s))).toBeNull();
        expect(actual.viewedWriteSession('R1', null, viewingOf('tree', s))).toBeNull();
        const noBridge = sessionOf({ bridge: { base: '', status: '', ged: '', events: '', log: '' } });
        expect(actual.viewedWriteSession('R1', null, viewingOf('bridge', noBridge))).toBeNull();
        expect(actual.viewedWriteSession('R1', null, null)).toBeNull();
    });

    it('the way after a write: followed the stream\'s, viewed the bridge at once, without a bridge none', () => {
        const s = sessionOf();
        expect(actual.statusAfterWriteWay(s, s, null)).toBe('live');
        expect(actual.statusAfterWriteWay(s, null, viewingOf('bridge', s))).toBe('bridge');
        const noBridge = sessionOf({ bridge: { base: '', status: '', ged: '', events: '', log: '' } });
        expect(actual.statusAfterWriteWay(noBridge, null, viewingOf('bridge', noBridge))).toBeNull();
    });
});
