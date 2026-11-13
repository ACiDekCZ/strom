/**
 * The Research overview in a window of its own (spec 079 K3, §6): the
 * window's side. Today's renderer (research-overview-ui) draws it in mode
 * 'window' over the main window's snapshot (`research-state`); every research
 * action it offers is asked of the main window (`research-action`, the
 * contract in windows/overview-window.ts), which runs it with today's
 * functions. This window never follows a research, never asks its bridge
 * and never writes the tree's storage: only what "⋯ Edit panel" chooses is
 * kept (localStorage, as everywhere). Folds, open details, a typed answer and
 * the filters stay here.
 */

import type { PersonId, ResearchHypothesis } from '../types.js';
import type { LiveDirection, LiveWaiting } from '../research-link.js';
import { researchSchemeUrl, researchTaskRef, RESEARCH_LINK_ACTIONS, type ResearchLinkAction, type ResearchLinkParams } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import type { DirectionMove } from '../research-directions.js';
import type { DirectionStateDo } from '../research-directions-write.js';
import type { FollowView } from '../live-follow-prefs.js';
import { PLACES_ANSWER_FEATURE, PLACES_UNDO_FEATURE } from '../places-bridge.js';
import { todoWaiting } from '../research-waiting.js';
import { replacePendingHypotheses, type PendingHypothesis } from '../research-hypothesis-wait.js';
import { setAcceptBatch, type AcceptBatch } from '../research-hypothesis-waiting.js';
import { applyQueueSnapshot, setQueueRemote, type QueueList } from '../research-queue-pages.js';
import { strings } from '../strings.js';
import type { UIClass } from './index.js';
import { el, setOverviewWindowDrawn, type LiveSession, type OverviewViewing } from './research-ui.js';
import { applyDirectionsWindowState, setQueueDirectionFilter } from './research-directions-ui.js';
import { setOverviewOwnWindow } from './research-overview-ui.js';
import { sectionPrefs } from './live-section-prefs.js';
import type { DirectionFormOptions } from './direction-form-ui.js';
import type { WaitingAnswerOutcome } from './waiting-answer-form.js';
import {
    OVERVIEW_ACTIONS_TO_MAIN, emptyOverviewExtras, overviewSessionFromData, readOverviewState,
    type OverviewAction, type OverviewActionId, type OverviewResearchState,
} from '../windows/overview-window.js';

/** How the window reaches the main window (the satellite client, or a test's double). */
export interface OverviewWindowPort {
    /** Ask the main window for an action. */
    send(action: OverviewActionId, args?: unknown): void;
    /** Ask and wait for its outcome (null: no answer in `waitMs`). */
    ask(action: OverviewActionId, args: unknown, waitMs: number): Promise<unknown>;
    /** The main window to the front (an action that shows something in its tree). */
    focusMain(): void;
}

/** How long an answer sent from the window waits for the main window's outcome. */
export const OVERVIEW_ANSWER_WAIT_MS = 30_000;

/**
 * A session's fields that are this window's own view: what is unfolded and
 * new in "Awaiting action", the sections shown for a while, what was seen.
 * The main window's next snapshot does not overwrite them.
 */
const VIEW_FIELDS = ['waitingView', 'overviewShown', 'seenWaiting', 'waitingPendingOpen', 'autoCollapsed', 'seenInSection', 'seenChanges', 'collapsed'] as const;

/** What the window draws from a snapshot: the followed research, or the one viewed without following. */
export interface OverviewWindowDrawn {
    live: LiveSession | null;
    viewing: OverviewViewing | null;
}

/**
 * The sessions the renderer draws from a snapshot. `prev` (the session drawn
 * before) gives this window's own view when it is the same research of the
 * same tree; the first snapshot of a research brings the main window's.
 * Returns the waiting items new since `prev` too (the renderer unfolds them).
 */
export function overviewWindowDrawn(state: OverviewResearchState, prev: LiveSession | null): OverviewWindowDrawn & { fresh: LiveWaiting[] } {
    if (!state.session || !state.source) return { live: null, viewing: null, fresh: [] };
    const s = overviewSessionFromData(state.session);
    let fresh: LiveWaiting[] = [];
    if (prev && prev.researchId === s.researchId && prev.treeId === s.treeId) {
        const rec = s as unknown as Record<string, unknown>;
        const old = prev as unknown as Record<string, unknown>;
        for (const k of VIEW_FIELDS) rec[k] = old[k];
        fresh = s.waiting.filter(w => !s.seenWaiting.has(w.id));
        for (const w of fresh) s.seenWaiting.add(w.id);
    }
    // The overview is what this window shows: open whatever the main window's own is.
    s.overview = true;
    if (state.source === 'live') return { live: s, viewing: null, fresh };
    const v = state.viewing;
    return {
        live: null,
        viewing: {
            treeId: s.treeId, researchId: state.researchId ?? s.researchId, kind: state.source, session: s, status: null,
            follow: v?.follow, refreshedAt: v?.refreshedAt ?? 0, working: v?.working ?? null, agentStarted: !!v?.agentStarted,
            logHead: v?.logHead ?? '', waitingAt: v?.waitingAt ?? 0,
        },
        fresh,
    };
}

/** The window's state now (null: the main window has said nothing yet). */
export interface OverviewWindowView {
    /** The main window's last snapshot (null: none yet). */
    state(): OverviewResearchState | null;
    /** A `research-state` heard: taken in and drawn (false: not one this window can draw). */
    apply(raw: unknown): boolean;
    /** Draw again (a resize across two columns, the language). */
    render(): void;
    stop(): void;
}

/**
 * The renderer's calls that, in the main window, reach its research, its
 * bridge or its tree: here each one asks the main window (the contract's
 * action) or reads the snapshot. Assigned onto the UI instance of this window.
 */
export function overviewWindowOverrides(port: OverviewWindowPort, read: () => OverviewResearchState | null): Partial<UIClass> & ThisType<UIClass> {
    const extras = () => read()?.extras ?? emptyOverviewExtras();
    const session = (): LiveSession | null => (read()?.source ? drawnNow?.live ?? drawnNow?.viewing?.session ?? null : null);
    /** An action asked; one that shows something in the main window's tree brings that window forward. */
    const run = <T extends OverviewActionId>(action: T, args?: Extract<OverviewAction, { action: T }>['args']): void => {
        port.send(action, args);
        if (OVERVIEW_ACTIONS_TO_MAIN.has(action)) port.focusMain();
    };
    /** The link of an action as `activeResearchLink` built it here: what the main window builds for its tree. */
    const links = new Map<string, { link: ResearchLinkAction; params: Record<string, unknown> }>();
    return {
        // ---- what the overview reads of the main window ----
        activeResearchId(): string | null { return read()?.researchId ?? null; },
        activeResearchAgentless(): boolean { return extras().agentless; },
        activeResearchNoAgent(): boolean { return extras().noAgent; },
        isFollowingActiveResearch(): boolean { return read()?.source === 'live'; },
        isLiveFollowOn(): boolean { return extras().follow.on; },
        liveFollowView(): FollowView | null { return extras().follow.view; },
        researchLiveState(this: UIClass, _treeId: string) {
            return extras().liveSwitch as ReturnType<UIClass['researchLiveState']>;
        },
        evidenceHighlightKind() { return null; },
        endEvidenceHighlight(): void { /* the light is the main window's */ },
        pauseLiveFollow(): void { /* following runs in the main window */ },
        /** Places answered through the main window's dialog: what the research's status says it takes. */
        waitingPlacesAccess() {
            const features = session()?.features ?? [];
            const canAnswer = read()?.bridgeUp === true && features.includes(PLACES_ANSWER_FEATURE);
            return { canAnswer, canUndo: canAnswer && features.includes(PLACES_UNDO_FEATURE), base: null, features, unknownAll: false };
        },
        // The tree's verification is run from the main window (not one of the window's actions).
        treeVerifyBlock(): HTMLElement | null { return null; },
        // Its own overview (no small panel here); none opened or closed here.
        renderLivePanel(this: UIClass): void { this.renderResearchOverview(); },
        openOverviewViewing(): boolean { return !!read()?.source; },
        closeOverviewViewing(): void { /* the main window's */ },
        /** The ◎ switch: following in the main window's tree, as that window says it. */
        liveFollowButton(this: UIClass, size: 'panel' | 'overview' | 'phone'): HTMLButtonElement | null {
            if (read()?.source !== 'live') return null;
            const on = extras().follow.on;
            const L = strings.live;
            const btn = el('button', `live-follow-btn live-follow-btn--${size}`, '◎');
            btn.type = 'button';
            btn.setAttribute('aria-pressed', String(on));
            btn.classList.toggle('is-on', on);
            const label = on ? L.followOff : L.followOn;
            btn.setAttribute('aria-label', label);
            btn.title = label;
            btn.onclick = () => this.setLiveFollow(!on);
            return btn;
        },
        // "Follow in" belongs to the main window's views (its small panel has it).
        liveFollowViewRow(): HTMLElement | null { return null; },

        // ---- the actions: asked of the main window ----
        stopLiveFollow(): void { run('stop-follow'); },
        startFollowLive(): void { run('follow-live'); },
        setLiveFollow(on: boolean): void { run('follow-tree', { on }); },
        setLiveFollowView(view: FollowView): void { run('follow-view', { view }); },
        async toggleResearchLive(): Promise<void> { run('turn-on'); },
        overviewShowPerson(id: PersonId): void { run('show-person', { personId: id }); },
        startPersonHighlight(_kind: string, label: string, ids: PersonId[]): void {
            run('show-people', { title: label, personIds: [...ids] });
        },
        showDirectionInTree(d: LiveDirection): void { run('show-direction', { directionId: d.id }); },
        showPersonResearchDialog(personId: PersonId, opts: { hypo?: { id: string }; conflict?: string } = {}): void {
            run('person-research', {
                personId, ...(opts.conflict ? { conflict: opts.conflict } : {}), ...(opts.hypo?.id ? { hypo: opts.hypo.id } : {}),
            });
        },
        async showTreeOverview(): Promise<void> { run('tree-overview'); },
        showWaitingPlaces(focus?: string): void { run('waiting-places', focus ? { focus } : {}); },
        async showWaitingGroupNote(_s: LiveSession, key: string, name: string): Promise<void> {
            run('waiting-group-note', { group: key, name });
        },
        openWaitingImages(_s: LiveSession, w: LiveWaiting, files?: readonly File[]): void {
            run('waiting-images', { itemId: w.id, ...(files?.length ? { files: [...files] } : {}) });
        },
        openDirectionForm(opts: DirectionFormOptions): void {
            if (opts.mode === 'edit' && opts.direction) run('line-edit', { directionId: opts.direction.id });
            else if (opts.mode === 'new') run('line-new');
        },
        setWorkingLine(this: UIClass, id: string): void {
            // Selected here at once; the main window's light and queue follow.
            setQueueDirectionFilter(id);
            run('line-select', { directionId: id });
            this.renderResearchOverview();
        },
        async changeDirectionState(d: LiveDirection, what: DirectionStateDo, opts: { reason?: string } = {}): Promise<boolean> {
            if (what !== 'pause' && what !== 'resume' && what !== 'done') return false;
            run('line-state', { directionId: d.id, do: what, ...(opts.reason ? { reason: opts.reason } : {}) });
            return true;
        },
        moveDirection(id: string, move: DirectionMove | { drop: number }): void { run('line-move', { directionId: id, move }); },
        // A task's place in the queue is not one of the window's actions (changed in the main window).
        async changeTaskOrder(): Promise<boolean> { return false; },
        async sendWaitingAnswer(_s: LiveSession, w: LiveWaiting, text: string): Promise<WaitingAnswerOutcome> {
            const r = await port.ask('waiting-answer', { itemId: w.id, text }, OVERVIEW_ANSWER_WAIT_MS);
            return (typeof r === 'string' ? r : 'fail') as WaitingAnswerOutcome;
        },
        async markWaitingSent(_s: LiveSession, w: LiveWaiting): Promise<void> { run('waiting-sent', { itemId: w.id }); },
        async markWaitingUnsent(_s: LiveSession, id: string): Promise<void> { run('waiting-unsent', { itemId: id }); },
        async markWaitingGroupSent(_s: LiveSession, key: string): Promise<void> { run('waiting-group-sent', { group: key }); },
        async sendWaitingFile(s: LiveSession, task: string, file: File): Promise<void> {
            const w = s.waiting.find(x => researchTaskRef(x.id) === task);
            if (w) run('waiting-file', { itemId: w.id, file });
        },
        askWaitingHypothesis(h: ResearchHypothesis, what: 'decide' | 'abandon' | 'keep-open', variant?: string): void {
            if (!h.id) return;
            run('hypothesis-ask', { hypothesisId: h.id, do: what, ...(variant ? { variant } : {}) });
        },
        acceptHypothesisProposals(ids: readonly string[]): void { run('hypotheses-accept', { ids: [...ids] }); },
        answerResearchTask(w: LiveWaiting): void { run('answer-task', { itemId: w.id }); },
        /** The research's link as the main window would build it for its tree (kept to be asked by action). */
        activeResearchLink(this: UIClass, action: ResearchLinkAction, params: Omit<ResearchLinkParams, 'tree'> = {}): string | null {
            if (!this.researchLinkAvailable(action)) return null;
            const tree = read()?.researchId;
            const url = tree ? researchSchemeUrl(action, { tree, ...params }, announcedResearchScheme()) : null;
            if (url) links.set(url, { link: action, params: { ...params } });
            return url;
        },
        /** Handing the link over: the main window builds it for its open tree and launches it. */
        handOverResearchLink(url: string): void {
            const l = links.get(url);
            if (!l || !(RESEARCH_LINK_ACTIONS as readonly string[]).includes(l.link)) return;
            port.send('research-link', { link: l.link, params: l.params });
        },
    };
}

/** The drawn sessions now (the overrides read the session of the last snapshot). */
let drawnNow: OverviewWindowDrawn | null = null;

/**
 * Start the overview's own window: the overrides on `ui`, the queue's lists
 * from the main window, and every `research-state` drawn as it comes.
 */
export function startOverviewWindowView(ui: UIClass, port: OverviewWindowPort, treeName: () => string): OverviewWindowView {
    let state: OverviewResearchState | null = null;
    Object.assign(ui, overviewWindowOverrides(port, () => state));
    setOverviewOwnWindow({
        treeName,
        hover: (id) => port.send('hover-person', { personId: id }),
    });
    setQueueRemote({
        ask: (what, filter, slot, seed) => {
            if (what === 'list') port.send('queue-list', { filter, slot });
            else if (what === 'more') port.send('queue-more', { filter, slot, ...(seed ? { seed } : {}) });
            else port.send('queue-retry', { filter, slot });
        },
    });
    const render = (): void => ui.renderResearchOverview();
    return {
        state: () => state,
        apply(raw: unknown): boolean {
            const next = readOverviewState(raw);
            if (!next) return false;
            const prevSession = drawnNow?.live ?? drawnNow?.viewing?.session ?? null;
            const sameResearch = !!state && state.researchId === next.researchId && state.treeId === next.treeId;
            state = next;
            const d = overviewWindowDrawn(next, sameResearch ? prevSession : null);
            drawnNow = { live: d.live, viewing: d.viewing };
            setOverviewWindowDrawn(drawnNow);
            const s = d.live ?? d.viewing?.session ?? null;
            // What only the main window knows: the lines' writes, the hypotheses waited for, the queue's pages.
            applyDirectionsWindowState(next.extras.lines, s, (id) => port.send('line-retry', { directionId: id }));
            if (next.researchId) {
                replacePendingHypotheses(next.researchId, next.extras.hypotheses.pending as Record<string, PendingHypothesis>);
                setAcceptBatch(next.researchId, next.extras.hypotheses.batch as AcceptBatch | null);
            }
            applyQueueSnapshot(next.extras.queue as { rev: string; lists: QueueList[] } | null);
            // New to do since the last snapshot: unfolded here as while following (unless kept collapsed or hidden).
            const freshTodo = s ? todoWaiting(d.fresh) : [];
            if (s && freshTodo.length > 0) {
                for (const w of freshTodo) s.waitingView.fresh.add(w.id);
                const pref = sectionPrefs().waiting;
                if (pref === undefined || pref === 'expanded') ui.openWaitingItems(s, freshTodo);
                else for (const w of freshTodo) s.waitingPendingOpen.add(w.id);
            }
            render();
            return true;
        },
        render,
        stop(): void {
            setOverviewOwnWindow(null);
            setOverviewWindowDrawn(null);
            setQueueRemote(null);
            drawnNow = null;
        },
    };
}

/**
 * This window asks no bridge (§6): a request to another origin or a stream
 * is refused here, whatever code would make it (a safety net under the
 * overrides). Returns how to put them back (tests).
 */
export function guardOverviewWindowNetwork(win: Window & typeof globalThis = window): () => void {
    const fetchBefore = win.fetch;
    const esBefore = win.EventSource;
    const own = (url: string): boolean => {
        try {
            const u = new URL(url, win.location.href);
            return u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === win.location.origin;
        } catch {
            return false;
        }
    };
    if (typeof fetchBefore === 'function') {
        win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (!own(url)) return Promise.reject(new TypeError('The overview window asks no bridge'));
            return fetchBefore.call(win, input, init);
        }) as typeof fetch;
    }
    if (typeof esBefore === 'function') {
        win.EventSource = class {
            constructor() { throw new TypeError('The overview window follows no bridge'); }
        } as unknown as typeof EventSource;
    }
    return () => {
        win.fetch = fetchBefore;
        win.EventSource = esBefore;
    };
}
