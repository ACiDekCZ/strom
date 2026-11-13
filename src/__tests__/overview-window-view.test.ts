/**
 * The Research overview's own window (spec 079 K3, §6), the window's side:
 * what it draws from the main window's snapshot, that it never reaches the
 * research's bridge (no request to another origin, no event stream), and
 * that each control of the overview asks the main window for its action
 * (`research-action`) with the ids and arguments the main window runs.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { LiveSession } from '../ui/research-ui.js';
import type { LiveDirection, LiveWaiting } from '../research-link.js';
import type { PersonId, TreeId } from '../types.js';
import {
    guardOverviewWindowNetwork, overviewWindowDrawn, overviewWindowOverrides, startOverviewWindowView, type OverviewWindowPort,
} from '../ui/overview-window-view.js';
import {
    OVERVIEW_STATE_VERSION, emptyOverviewExtras, type OverviewActionId, type OverviewResearchState, type OverviewSessionData,
} from '../windows/overview-window.js';
import { SECTION_PREFS_EVENT, SECTION_PREFS_KEY } from '../ui/live-section-prefs.js';

const TREE = 'ow-tree' as TreeId;
const BRIDGE = 'http://127.0.0.1:47123/Zq8tY2kQw9xLmN4pRs7';

function sessionData(o: Partial<OverviewSessionData> = {}): OverviewSessionData {
    return {
        researchId: 'R1', treeId: TREE, name: 'Okurkovi research', head: 'h', headAt: '', working: [],
        waiting: [{ id: 'W1', kind: 'question', title: 'Which parish?' }], features: null, accepts: null, queue: [], queueMore: 0,
        update: null, spend: null, lastIntake: null, researches: [{ id: 'D1', name: 'Okurka line', state: 'active' }],
        autoCollapsed: new Set(), seenWaiting: new Set(['W1']), waitingPendingOpen: new Set(), overviewShown: new Set(),
        waitingView: { open: new Set(), fresh: new Set() }, seenInSection: 0, startedAt: 0, startPersons: 0, startSources: 0,
        overview: false, logged: true, changes: [], adds: [], recent: null, ended: false, collapsed: false, seenChanges: 0,
        failures: 0, lostSince: null,
        ...o,
    } as unknown as OverviewSessionData;
}

function stateOf(o: Partial<OverviewResearchState> = {}): OverviewResearchState {
    return {
        v: OVERVIEW_STATE_VERSION, at: 1000, treeId: TREE, treeName: 'Okurkovi', researchId: 'R1', researchName: 'Okurkovi research',
        source: 'live', bridgeUp: true, session: sessionData(), viewing: null, extras: emptyOverviewExtras(),
        ...o,
    };
}

function portSpy() {
    const sent: { action: OverviewActionId; args: unknown }[] = [];
    const port = {
        send: vi.fn((action: OverviewActionId, args?: unknown) => { sent.push({ action, args }); }),
        ask: vi.fn(async (_a: OverviewActionId, _args: unknown, _ms: number): Promise<unknown> => 'saved'),
        focusMain: vi.fn(),
    } satisfies OverviewWindowPort;
    return { port, sent };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('what the window draws from a snapshot', () => {
    it('followed: the live session, opened, with an empty bridge', () => {
        const d = overviewWindowDrawn(stateOf(), null);
        expect(d.viewing).toBeNull();
        expect(d.live?.researchId).toBe('R1');
        expect(d.live?.overview).toBe(true);
        expect(d.live?.bridge).toEqual({ base: '', status: '', ged: '', events: '', log: '' });
        expect(d.live?.es).toBeNull();
        expect(d.fresh).toEqual([]);
    });

    it('viewed through the bridge or from the tree: the viewing with its kind and what it was said', () => {
        const viewing = { follow: undefined, refreshedAt: 50, working: null, agentStarted: true, logHead: 'lh', waitingAt: 7 };
        const d = overviewWindowDrawn(stateOf({ source: 'bridge', viewing: viewing as never }), null);
        expect(d.live).toBeNull();
        expect(d.viewing).toMatchObject({ treeId: TREE, researchId: 'R1', kind: 'bridge', refreshedAt: 50, agentStarted: true, logHead: 'lh', waitingAt: 7 });
        expect(d.viewing?.session.overview).toBe(true);
        expect(overviewWindowDrawn(stateOf({ source: 'tree' }), null).viewing?.kind).toBe('tree');
    });

    it('nothing to draw: no session or no source', () => {
        expect(overviewWindowDrawn(stateOf({ session: null }), null)).toEqual({ live: null, viewing: null, fresh: [] });
        expect(overviewWindowDrawn(stateOf({ source: null }), null)).toEqual({ live: null, viewing: null, fresh: [] });
    });

    it('the same research again: this window\'s folds and seen items stay; items new since are said', () => {
        const first = overviewWindowDrawn(stateOf(), null).live as LiveSession;
        first.collapsed = true;
        first.overviewShown.add('queue');
        const next = stateOf({
            session: sessionData({
                collapsed: false, seenWaiting: new Set(), waiting: [
                    { id: 'W1', kind: 'question', title: 'Which parish?' } as unknown as LiveWaiting,
                    { id: 'W2', kind: 'question', title: 'Which year?' } as unknown as LiveWaiting,
                ],
            }),
        });
        const d = overviewWindowDrawn(next, first);
        expect(d.live?.collapsed).toBe(true);
        expect([...(d.live?.overviewShown ?? [])]).toEqual(['queue']);
        expect(d.fresh.map(w => w.id)).toEqual(['W2']);
        expect(d.live?.seenWaiting.has('W2')).toBe(true);
        // Another research: the main window's view, nothing said as new.
        const other = overviewWindowDrawn(stateOf({ session: sessionData({ researchId: 'R2' }) }), first);
        expect(other.live?.collapsed).toBe(false);
        expect(other.fresh).toEqual([]);
    });
});

describe('the window asks no bridge', () => {
    function fakeWindow() {
        const fetch = vi.fn(async (_input: unknown, _init?: unknown) => new Response('ok'));
        const opened: string[] = [];
        class EventSource { constructor(url: string) { opened.push(url); } }
        const win = { fetch, EventSource, location: { href: 'http://localhost:8742/strom.html?okno=overview', origin: 'http://localhost:8742' } };
        return { win: win as unknown as Window & typeof globalThis, fetch, opened };
    }

    it('a request to the bridge is refused before it is made; the app\'s own origin, data: and blob: pass', async () => {
        const { win, fetch } = fakeWindow();
        const restore = guardOverviewWindowNetwork(win);
        await expect(win.fetch(`${BRIDGE}/status`)).rejects.toThrow(TypeError);
        await expect(win.fetch(new URL(`${BRIDGE}/queue`))).rejects.toThrow(TypeError);
        await expect(win.fetch(new Request(`${BRIDGE}/log`))).rejects.toThrow(TypeError);
        expect(fetch).not.toHaveBeenCalled();
        await win.fetch('/strom.html');
        await win.fetch('data:text/plain,x');
        expect(fetch).toHaveBeenCalledTimes(2);
        restore();
        await win.fetch(`${BRIDGE}/status`);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('no event stream is made', () => {
        const { win, opened } = fakeWindow();
        const restore = guardOverviewWindowNetwork(win);
        expect(() => new win.EventSource(`${BRIDGE}/events`)).toThrow(TypeError);
        expect(opened).toEqual([]);
        restore();
        new win.EventSource(`${BRIDGE}/events`);
        expect(opened).toEqual([`${BRIDGE}/events`]);
    });
});

describe('the overview\'s controls ask the main window', () => {
    const W1 = { id: 'W1', kind: 'question', title: 'Which parish?' } as unknown as LiveWaiting;
    const D1 = { id: 'D1', name: 'Okurka line', state: 'active' } as unknown as LiveDirection;

    function overrides(state: OverviewResearchState | null = stateOf()) {
        const spy = portSpy();
        const o = overviewWindowOverrides(spy.port, () => state) as Record<string, (...a: unknown[]) => unknown>;
        return { ...spy, o };
    }

    it('actions in the tree go with their ids and bring the main window forward', () => {
        const { o, sent, port } = overrides();
        o.overviewShowPerson('P1' as PersonId);
        o.showDirectionInTree(D1);
        o.showDirectionFoundInTree(D1);
        o.startPersonHighlight('changed', 'Changed', ['P1', 'P2'] as PersonId[]);
        o.showPersonResearchDialog('P3' as PersonId, { hypo: { id: 'H1' } });
        o.showWaitingPlaces('Kutná Hora');
        o.openDirectionForm({ mode: 'edit', direction: D1 });
        o.openDirectionForm({ mode: 'new' });
        expect(sent).toEqual([
            { action: 'show-person', args: { personId: 'P1' } },
            { action: 'show-direction', args: { directionId: 'D1' } },
            { action: 'direction-found', args: { directionId: 'D1' } },
            { action: 'show-people', args: { title: 'Changed', personIds: ['P1', 'P2'] } },
            { action: 'person-research', args: { personId: 'P3', hypo: 'H1' } },
            { action: 'waiting-places', args: { focus: 'Kutná Hora' } },
            { action: 'line-edit', args: { directionId: 'D1' } },
            { action: 'line-new', args: undefined },
        ]);
        expect(port.focusMain).toHaveBeenCalledTimes(sent.length);
    });

    it('actions that stay where they are: sent, the main window stays behind', async () => {
        const { o, sent, port } = overrides();
        o.stopLiveFollow();
        o.startFollowLive();
        o.setLiveFollow(false);
        o.setLiveFollowView('fan');
        await o.toggleResearchLive();
        await o.changeDirectionState(D1, 'done', { reason: 'found' });
        expect(await o.changeDirectionState(D1, 'delete')).toBe(false);
        o.moveDirection('D1', 'up');
        await o.markWaitingSent(null, W1);
        await o.markWaitingUnsent(null, 'W1');
        await o.markWaitingGroupSent(null, 'repo:R1');
        o.askWaitingHypothesis({ id: 'H1' }, 'decide', 'a');
        o.acceptHypothesisProposals(['H1', 'H2']);
        o.answerResearchTask(W1);
        expect(sent).toEqual([
            { action: 'stop-follow', args: undefined },
            { action: 'follow-live', args: undefined },
            { action: 'follow-tree', args: { on: false } },
            { action: 'follow-view', args: { view: 'fan' } },
            { action: 'turn-on', args: undefined },
            { action: 'line-state', args: { directionId: 'D1', do: 'done', reason: 'found' } },
            { action: 'line-move', args: { directionId: 'D1', move: 'up' } },
            { action: 'waiting-sent', args: { itemId: 'W1' } },
            { action: 'waiting-unsent', args: { itemId: 'W1' } },
            { action: 'waiting-group-sent', args: { group: 'repo:R1' } },
            { action: 'hypothesis-ask', args: { hypothesisId: 'H1', do: 'decide', variant: 'a' } },
            { action: 'hypotheses-accept', args: { ids: ['H1', 'H2'] } },
            { action: 'answer-task', args: { itemId: 'W1' } },
        ]);
        expect(port.focusMain).not.toHaveBeenCalled();
    });

    it('an answer waits for the main window\'s outcome (no answer: failed)', async () => {
        const { o, port } = overrides();
        await expect(o.sendWaitingAnswer(null, W1, 'Kutná Hora')).resolves.toBe('saved');
        expect(port.ask).toHaveBeenCalledWith('waiting-answer', { itemId: 'W1', text: 'Kutná Hora' }, 30_000);
        port.ask.mockResolvedValueOnce(null);
        await expect(o.sendWaitingAnswer(null, W1, 'x')).resolves.toBe('fail');
    });

    it('the main window\'s state is read from the snapshot', () => {
        const extras = { ...emptyOverviewExtras(), agentless: true, follow: { on: true, view: 'fan' as const } };
        const { o } = overrides(stateOf({ extras }));
        expect(o.activeResearchId()).toBe('R1');
        expect(o.isFollowingActiveResearch()).toBe(true);
        expect(o.activeResearchAgentless()).toBe(true);
        expect(o.isLiveFollowOn()).toBe(true);
        expect(o.liveFollowView()).toBe('fan');
        expect(overrides(stateOf({ source: 'bridge' })).o.isFollowingActiveResearch()).toBe(false);
        expect(overrides(null).o.activeResearchId()).toBeNull();
    });
});

describe('the window\'s start', () => {
    function fakeUi() {
        return { renderResearchOverview: vi.fn(), openWaitingItems: vi.fn() };
    }

    it('a snapshot is taken in and drawn; anything else is not', () => {
        const ui = fakeUi();
        const { port } = portSpy();
        const view = startOverviewWindowView(ui as never, port, () => 'Okurkovi');
        expect(view.apply({ type: 'nonsense' })).toBe(false);
        expect(ui.renderResearchOverview).not.toHaveBeenCalled();
        expect(view.apply(stateOf())).toBe(true);
        expect(view.state()?.researchId).toBe('R1');
        expect(ui.renderResearchOverview).toHaveBeenCalledTimes(1);
        // The renderer's calls are the window's now: an action asks the main window.
        (ui as unknown as { stopLiveFollow(): void }).stopLiveFollow();
        expect(port.send).toHaveBeenCalledWith('stop-follow', undefined);
        view.stop();
    });

    it('a section\'s choice, here or in another window, draws the window again', () => {
        const doc = new EventTarget();
        const win = new EventTarget();
        vi.stubGlobal('document', doc);
        vi.stubGlobal('window', win);
        const ui = fakeUi();
        const view = startOverviewWindowView(ui as never, portSpy().port, () => 'Okurkovi');
        view.apply(stateOf());
        expect(ui.renderResearchOverview).toHaveBeenCalledTimes(1);
        doc.dispatchEvent(new CustomEvent(SECTION_PREFS_EVENT));
        expect(ui.renderResearchOverview).toHaveBeenCalledTimes(2);
        // Written by the main window: the browser's storage event.
        win.dispatchEvent(Object.assign(new Event('storage'), { key: SECTION_PREFS_KEY }));
        expect(ui.renderResearchOverview).toHaveBeenCalledTimes(3);
        win.dispatchEvent(Object.assign(new Event('storage'), { key: 'something-else' }));
        expect(ui.renderResearchOverview).toHaveBeenCalledTimes(3);
        view.stop();
        doc.dispatchEvent(new CustomEvent(SECTION_PREFS_EVENT));
        expect(ui.renderResearchOverview).toHaveBeenCalledTimes(3);
    });
});
