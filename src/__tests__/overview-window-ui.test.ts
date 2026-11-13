/**
 * The main window's UI side of the Research overview in a window of its own
 * (spec 079 K3, 6g): the state it sends there (the followed research's
 * session, else the open tree's viewed without following, opened for the
 * window), safe to clone and without the bridge's address; each action the
 * window asks for runs today's function; with the window open the overview
 * does not open here (⤢ and Research › Research overview bring the window to
 * the front, their tooltip says so); the window closed, the overview it
 * showed without following goes with it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fake = vi.hoisted(() => ({ live: null as unknown, viewing: null as unknown }));

vi.mock('../ui/research-ui.js', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../ui/research-ui.js')>();
    return {
        ...orig,
        liveSession: () => fake.live,
        overviewViewing: () => fake.viewing,
        researchSession: () => fake.live ?? null,
    };
});

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { LiveSession } from '../ui/research-ui.js';
import type { TreeId } from '../types.js';
import { overviewWindowMethods } from '../ui/overview-window-ui.js';
import { researchOverviewMethods } from '../ui/research-overview-ui.js';
import { researchActionsMethods } from '../ui/research-actions-ui.js';
import { setOverviewWindowProbe, type OverviewAction } from '../windows/overview-window.js';
import { strings } from '../strings.js';

const TREE = 'ow-tree' as TreeId;
const BASE = 'http://127.0.0.1:47123/Zq8tY2kQw9xLmN4pRs7';

/** A UI where every method not named answers "nothing" (null). */
function fakeUi(overrides: Record<string, unknown>): Record<string, ReturnType<typeof vi.fn>> {
    return new Proxy(overrides, {
        get: (target, key) => (key in target ? target[key as string] : () => null),
    }) as never;
}

function liveOf(o: Partial<LiveSession> = {}): LiveSession {
    return {
        bridge: { base: BASE, status: `${BASE}/status`, ged: '', events: `${BASE}/events`, log: '' },
        researchId: 'R1', treeId: TREE, name: 'Okurkovi research', head: 'h', headAt: '', working: [],
        waiting: [{ id: 'W1', kind: 'question', title: 'Which parish?' }], features: null, accepts: null, queue: [], queueMore: 0,
        update: null, spend: null, lastIntake: null, researches: [{ id: 'D1', name: 'Okurka line', state: 'active' }],
        autoCollapsed: new Set(), seenWaiting: new Set(), waitingPendingOpen: new Set(), overviewShown: new Set(),
        waitingView: {}, seenInSection: 0, startedAt: 0, startPersons: 0, startSources: 0, overview: false, logged: true,
        changes: [], adds: [], recent: null, ended: false, collapsed: false, seenChanges: 0,
        es: { close() {} }, timer: null, statusSoon: null, failures: 0, lostSince: null, chain: Promise.resolve(),
        ...o,
    } as unknown as LiveSession;
}

function stateUi(extra: Record<string, unknown> = {}) {
    return fakeUi({
        activeResearchId: () => 'R1',
        researchLiveState: () => ({ on: true, pending: null, canStart: false, canStop: true, ended: null, note: null }),
        activeResearchAgentless: () => false,
        activeResearchNoAgent: () => false,
        isLiveFollowOn: () => true,
        liveFollowView: () => 'family',
        openOverviewViewing: vi.fn(() => true),
        ...extra,
    });
}

beforeEach(() => {
    fake.live = null;
    fake.viewing = null;
    vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE);
    vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ id: TREE, name: 'Okurkovi' } as never);
});

afterEach(() => {
    setOverviewWindowProbe(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the state sent to the overview window', () => {
    it('followed: the live session, clone-safe, without the bridge\'s address or token', () => {
        fake.live = liveOf();
        const state = overviewWindowMethods.overviewWindowState.call(stateUi() as never);
        expect(state).toMatchObject({
            v: 1, treeId: TREE, treeName: 'Okurkovi', researchId: 'R1', researchName: 'Okurkovi research', source: 'live', bridgeUp: true, viewing: null,
        });
        expect(state.session?.waiting.map(w => w.id)).toEqual(['W1']);
        expect(state.extras.follow).toEqual({ on: true, view: 'family' });
        expect(state.extras.liveSwitch?.on).toBe(true);
        expect(() => structuredClone(state)).not.toThrow();
        const text = JSON.stringify(state);
        expect(text).not.toContain('Zq8tY2kQw9xLmN4pRs7');
        expect(text).not.toContain('47123');
        expect(state.session && 'es' in state.session).toBe(false);
    });

    it('a following that lost its bridge says so', () => {
        fake.live = liveOf({ lostSince: 5 });
        expect(overviewWindowMethods.overviewWindowState.call(stateUi() as never).bridgeUp).toBe(false);
    });

    it('not followed: the research viewed without following (opened for the window when none is)', () => {
        const ui = stateUi();
        const state = overviewWindowMethods.overviewWindowState.call(ui as never);
        expect(ui.openOverviewViewing).toHaveBeenCalledTimes(1);
        expect(state.source).toBeNull();
        fake.viewing = { treeId: TREE, researchId: 'R1', kind: 'tree', session: liveOf({ bridge: { base: '', status: '', ged: '', events: '', log: '' } }), status: null, refreshedAt: 0, working: null, agentStarted: false, logHead: '', waitingAt: 7 };
        const again = overviewWindowMethods.overviewWindowState.call(ui as never);
        expect(ui.openOverviewViewing).toHaveBeenCalledTimes(1);
        expect(again).toMatchObject({ source: 'tree', bridgeUp: false, viewing: { kind: 'tree', waitingAt: 7 } });
    });

    it('a tree without research: an empty state, nothing opened', () => {
        const ui = stateUi({ activeResearchId: () => null });
        const state = overviewWindowMethods.overviewWindowState.call(ui as never);
        expect(state).toMatchObject({ researchId: null, source: null, session: null });
        expect(ui.openOverviewViewing).not.toHaveBeenCalled();
    });
});

describe('the window\'s actions run today\'s functions', () => {
    const run = (ui: unknown, a: OverviewAction) => overviewWindowMethods.runOverviewWindowAction.call(ui as never, a);

    it('each action reaches its function with its arguments', async () => {
        fake.live = liveOf();
        const ui = fakeUi({
            overviewShowPerson: vi.fn(), startPersonHighlight: vi.fn(), startFollowLive: vi.fn(), stopLiveFollow: vi.fn(),
            setLiveFollow: vi.fn(), setLiveFollowView: vi.fn(), setWorkingLine: vi.fn(), moveDirection: vi.fn(),
            changeDirectionState: vi.fn(async () => true), sendWaitingAnswer: vi.fn(async () => 'saved'),
            showPersonResearchDialog: vi.fn(), showWaitingPlaces: vi.fn(), answerResearchTask: vi.fn(),
            activeResearchLink: vi.fn(() => 'strom-research://chat?tree=R1'), launchResearchLink: vi.fn(),
            acceptHypothesisProposals: vi.fn(), markWaitingUnsent: vi.fn(async () => {}), openDirectionForm: vi.fn(),
            showDirectionFoundInTree: vi.fn(() => true),
        });
        const s = fake.live as LiveSession;
        run(ui, { action: 'show-person', args: { personId: 'P1' } });
        expect(ui.overviewShowPerson).toHaveBeenCalledWith('P1', 'docked');
        run(ui, { action: 'show-people', args: { title: 'Changed', personIds: ['P1', 'P2'] } });
        expect(ui.startPersonHighlight).toHaveBeenCalledWith('changed', 'Changed', ['P1', 'P2'], null);
        // What a line found: its people lit up as by its link here.
        expect(run(ui, { action: 'direction-found', args: { directionId: 'D1' } })).toBe(true);
        expect(ui.showDirectionFoundInTree).toHaveBeenCalledWith(s.researches[0], 'docked');
        expect(run(ui, { action: 'direction-found', args: { directionId: 'gone' } })).toBe(false);
        run(ui, { action: 'follow-live' });
        expect(ui.startFollowLive).toHaveBeenCalledWith('overview');
        run(ui, { action: 'stop-follow' });
        expect(ui.stopLiveFollow).toHaveBeenCalled();
        run(ui, { action: 'follow-tree', args: { on: false } });
        expect(ui.setLiveFollow).toHaveBeenCalledWith(false);
        run(ui, { action: 'follow-view', args: { view: 'fan' } });
        expect(ui.setLiveFollowView).toHaveBeenCalledWith('fan');
        run(ui, { action: 'line-select', args: { directionId: 'D1' } });
        expect(ui.setWorkingLine).toHaveBeenCalledWith('D1');
        run(ui, { action: 'line-move', args: { directionId: 'D1', move: 'up' } });
        expect(ui.moveDirection).toHaveBeenCalledWith('D1', 'up');
        await run(ui, { action: 'line-state', args: { directionId: 'D1', do: 'done', reason: 'found' } });
        expect(ui.changeDirectionState).toHaveBeenCalledWith(s.researches[0], 'done', { reason: 'found' });
        run(ui, { action: 'line-edit', args: { directionId: 'D1' } });
        expect(ui.openDirectionForm).toHaveBeenCalledWith({ mode: 'edit', direction: s.researches[0] });
        await expect(run(ui, { action: 'waiting-answer', args: { itemId: 'W1', text: 'Kutná Hora' } })).resolves.toBe('saved');
        expect(ui.sendWaitingAnswer).toHaveBeenCalledWith(s, s.waiting[0], 'Kutná Hora');
        expect(run(ui, { action: 'waiting-answer', args: { itemId: 'gone', text: 'x' } })).toBe('gone');
        run(ui, { action: 'waiting-unsent', args: { itemId: 'W1' } });
        expect(ui.markWaitingUnsent).toHaveBeenCalledWith(s, 'W1');
        run(ui, { action: 'person-research', args: { personId: 'P1', conflict: 'C1' } });
        expect(ui.showPersonResearchDialog).toHaveBeenCalledWith('P1', { conflict: 'C1' });
        run(ui, { action: 'waiting-places', args: { focus: 'Kutná Hora' } });
        expect(ui.showWaitingPlaces).toHaveBeenCalledWith('Kutná Hora');
        run(ui, { action: 'answer-task', args: { itemId: 'W1' } });
        expect(ui.answerResearchTask).toHaveBeenCalledWith(s.waiting[0]);
        run(ui, { action: 'hypotheses-accept', args: { ids: ['H1'] } });
        expect(ui.acceptHypothesisProposals).toHaveBeenCalledWith(['H1']);
        // A research link: built here for the open tree, launched with its mark's kind.
        run(ui, { action: 'research-link', args: { link: 'chat', params: { person: 'P0012' }, kind: 'agent' } });
        expect(ui.activeResearchLink).toHaveBeenCalledWith('chat', { person: 'P0012' });
        expect(ui.launchResearchLink).toHaveBeenCalledWith('strom-research://chat?tree=R1', 'agent');
    });

    it('Turn on only turns on: a research that runs is not stopped', () => {
        const toggle = vi.fn();
        const off = fakeUi({ researchLiveState: () => ({ on: false, pending: null, canStart: true, canStop: false, ended: 'stopped', note: null }), toggleResearchLive: toggle });
        expect(run(off, { action: 'turn-on' })).toBe(true);
        expect(toggle).toHaveBeenCalledWith(TREE);
        toggle.mockClear();
        const on = fakeUi({ researchLiveState: () => ({ on: true, pending: null, canStart: false, canStop: true, ended: null, note: null }), toggleResearchLive: toggle });
        expect(run(on, { action: 'turn-on' })).toBe(false);
        expect(toggle).not.toHaveBeenCalled();
    });

    it('Stop without following: nothing', () => {
        const stop = vi.fn();
        expect(run(fakeUi({ stopLiveFollow: stop }), { action: 'stop-follow' })).toBe(false);
        expect(stop).not.toHaveBeenCalled();
    });
});

describe('6g: the main window while the overview is in its own window', () => {
    it('opening the overview here brings the window to the front instead', () => {
        const focus = vi.fn();
        setOverviewWindowProbe({ open: () => true, focus });
        const ui = fakeUi({ openOverviewViewing: vi.fn(() => true), renderLivePanel: vi.fn() });
        researchOverviewMethods.openResearchOverview.call(ui as never);
        expect(focus).toHaveBeenCalledTimes(1);
        expect(ui.openOverviewViewing).not.toHaveBeenCalled();
        expect(ui.renderLivePanel).not.toHaveBeenCalled();
    });

    it('without the window: it opens here as before', () => {
        const focus = vi.fn();
        setOverviewWindowProbe({ open: () => false, focus });
        const ui = fakeUi({ openOverviewViewing: vi.fn(() => false) });
        researchOverviewMethods.openResearchOverview.call(ui as never);
        expect(ui.openOverviewViewing).toHaveBeenCalledTimes(1);
        expect(focus).not.toHaveBeenCalled();
    });

    it('Research › Research overview says the window has it', () => {
        const menuUi = (): never => <never>fakeUi({
            researchMenuShown: () => true, activeResearchId: () => 'R1', researchAnyAnnounced: () => true, researchLinkAvailable: () => true,
            researchSyncCapable: () => true, researchBridgeFresh: () => true, activeResearchArchive: () => false, activeResearchAgentAway: () => false,
            activeResearchModeKnown: () => true, isFollowingActiveResearch: () => false, researchWaitingCount: () => 0,
            researchBlockChangesElsewhere: () => false, researchOlderBlockHtml: () => '', historyManageAvailable: () => false,
        });
        const row = () => researchActionsMethods.researchMenuModel.call(menuUi()).first[0];
        expect(row().title).toBeUndefined();
        setOverviewWindowProbe({ open: () => true, focus: () => {} });
        expect(row()).toMatchObject({ id: 'research-item-overview', title: strings.win.overviewInWindow });
    });

    it('the window opened: the overview here closes; closed: the overview it showed without following goes', async () => {
        fake.live = liveOf({ overview: true });
        const opened = fakeUi({ closeResearchOverview: vi.fn(), renderLivePanel: vi.fn() });
        overviewWindowMethods.overviewWindowOpenChanged.call(opened as never, true);
        expect(opened.closeResearchOverview).toHaveBeenCalledTimes(1);
        const closed = fakeUi({ closeOverviewViewing: vi.fn(), renderLivePanel: vi.fn() });
        overviewWindowMethods.overviewWindowOpenChanged.call(closed as never, false);
        expect(closed.closeOverviewViewing).toHaveBeenCalledTimes(1);
        expect((fake.live as LiveSession).overview).toBe(false);
        expect(closed.renderLivePanel).toHaveBeenCalled();
    });
});
