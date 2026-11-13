/**
 * The Research overview in a window of its own (spec 079 §6, K3): what the
 * main window and the overview window agree on.
 *
 * - `research-state` (main → overview window): a snapshot of what the
 *   overview draws from (`OverviewResearchState`). The main window builds it
 *   from the followed research's session, else from the open tree's research
 *   viewed without following, plus what only the main window knows (the
 *   switch that turns the research on, following in the tree, the lines'
 *   writes under way, hypotheses asked). It crosses
 *   as a structured clone: no EventSource, timers, promises, functions or DOM
 *   nodes, and nothing of the bridge's address or token — the window never
 *   talks to the bridge.
 * - `research-action` (overview window → main): one of `OVERVIEW_ACTION_IDS`
 *   with its arguments; the main window runs it with today's functions. An
 *   action with a `reqId` gets its outcome back (`research-action-result`).
 *   The queue's pages and its search (`queue-list`) are such answers: the
 *   window keeps its own lists, the main window reads each page for it.
 * - 6g: while an overview window is open the main window draws no overview
 *   of its own; ⤢ and Research › Research overview bring that window to the
 *   front. The main window's wiring tells this module (`setOverviewWindowProbe`),
 *   so the UI asks here without importing the windows' start.
 */

import type { TreeId } from '../types.js';
import type { LiveSession, OverviewViewing } from '../ui/research-ui.js';
import { RESEARCH_LINK_ACTIONS, type ResearchLinkAction } from '../research-link.js';
import { sanitizeTaskOrderWas, type TaskOrderWas } from '../research-directions-write.js';
import { queueQuery, type QueueFilter } from '../research-queue-pages.js';

/** Raised when the snapshot's shape changes in a way an older window cannot read. */
export const OVERVIEW_STATE_VERSION = 1;

// ==================== THE SNAPSHOT ====================

/** Where the overview is drawn from: the followed research, its bridge without following, or the tree only. */
export type OverviewSource = 'live' | 'bridge' | 'tree';

/** A session's fields that cross windows: all but the bridge's addresses and what lives only in the main window. */
export type OverviewSessionData = Omit<LiveSession, 'bridge' | 'es' | 'timer' | 'statusSoon' | 'chain'>;

/** The overview opened without following, as the renderer reads it (its session is `OverviewResearchState.session`). */
export type OverviewViewingData = Pick<OverviewViewing, 'treeId' | 'researchId' | 'kind' | 'follow' | 'refreshedAt' | 'working' | 'agentStarted' | 'logHead' | 'waitingAt'>;

/** A line's write that the bridge refused, said at its row. */
export interface OverviewLineProblem {
    id: string;
    text: string;
    tone: 'warn' | 'danger';
    /** "Try again" is offered (the action `line-retry`). */
    retry: boolean;
}

/** The lines' state the main window holds (research-directions-ui). */
export interface OverviewLinesState {
    /** The line selected for the queue and the light in the tree ('all': none). */
    selected: string;
    /** The order shown while its write is on its way (null: the status's order). */
    pendingOrder: string[] | null;
    /** The order is being written. */
    orderSaving: boolean;
    /** Lines whose state write is on its way. */
    busy: string[];
    problems: OverviewLineProblem[];
    /** The bridge said its research is an archive: the lines are read-only. */
    archive: boolean;
}

/** What the overview shows that only the main window knows. */
export interface OverviewExtras {
    /** The switch that turns the research on and off (researchLiveState); null: none here. */
    liveSwitch: { on: boolean; pending: 'starting' | 'stopping' | null; canStart: boolean; canStop: boolean; ended: 'stopped' | 'idle' | null; note: { text: string; command?: string } | null } | null;
    /** An archive, or a research waiting for its agent: nobody to follow. */
    agentless: boolean;
    /** No agent known to work now (agentless, or its mode not known yet). */
    noAgent: boolean;
    /** ◎ following in the tree and the view it runs in. */
    follow: { on: boolean; view: 'family' | 'fan' | 'map' | null };
    lines: OverviewLinesState;
    /** Hypotheses asked of the research and waiting for its answer, and the list of proposals accepted at once. */
    hypotheses: { pending: Record<string, unknown>; batch: unknown | null };
    /** Tasks whose own place in the queue is being written, and what a refused one says (by task). */
    taskOrder: { busy: string[]; problems: Record<string, string> };
    /**
     * The tree's "Verifying" (spec 065 §10k) as the main window has it: facts waiting, Stop and the bulk
     * verification offered (null: the research does not verify, or its bridge does not answer).
     */
    verify?: OverviewVerifyState | null;
    /** The group the evidence pill lights up in the main window's tree now: its kind and the pill's name (null: none). */
    highlight?: OverviewHighlight | null;
}

/** The tree's verification as the overview's "Verifying" block draws it. */
export interface OverviewVerifyState {
    waiting: number;
    stop: boolean;
    bulk: boolean;
}

/** A highlight of people in the main window's tree (evidence-ui's group: `changed`, `direction`, `direction-found`, …). */
export interface OverviewHighlight {
    kind: string;
    label: string;
}

/** `research-state`: the overview's whole state as the main window has it now. */
export interface OverviewResearchState {
    v: typeof OVERVIEW_STATE_VERSION;
    /** When it was taken (ms): a frozen state says "as of" it (§6 state 5). */
    at: number;
    treeId: TreeId | null;
    /** The open tree's name (the window's title). */
    treeName: string;
    /** The open tree's research (null: a tree without research, §6 state 4). */
    researchId: string | null;
    /** The research's name as the overview says it. */
    researchName: string;
    /** Where it is drawn from (null: nothing to draw). */
    source: OverviewSource | null;
    /** The research's bridge answers now. */
    bridgeUp: boolean;
    /** The session the overview draws (null: nothing to draw). */
    session: OverviewSessionData | null;
    /** Opened without following (null: following, or nothing). */
    viewing: OverviewViewingData | null;
    extras: OverviewExtras;
    /** The open tree is locked in the main window: nothing of its research is sent (the window says it is locked). */
    locked?: boolean;
}

/** The parts of a bridge's address a snapshot never carries: the address itself and its token. */
export function bridgeSecrets(...bases: (string | null | undefined)[]): string[] {
    const out = new Set<string>();
    for (const base of bases) {
        if (!base) continue;
        out.add(base);
        try {
            const url = new URL(base);
            // The token is a long path segment (short ones are words of the path, not secrets).
            for (const part of url.pathname.split('/')) if (part.length >= 16) out.add(part);
            if (url.search.length > 1) out.add(url.search.slice(1));
        } catch { /* not a URL: the string alone */ }
    }
    return [...out];
}

function isPlainObject(v: object): boolean {
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

/**
 * A copy that a structured clone takes and that names no secret: plain
 * objects, arrays, Maps and Sets copied; strings that hold a secret, and
 * functions, DOM nodes, promises, timers or any other class instance left
 * out (a Map's or Set's such entry too).
 */
export function cloneSafe(value: unknown, secrets: readonly string[] = [], seen = new WeakMap<object, unknown>()): unknown {
    if (value === null || value === undefined) return value;
    switch (typeof value) {
        case 'string':
            return secrets.some(s => s && value.includes(s)) ? undefined : value;
        case 'number':
        case 'boolean':
            return value;
        case 'bigint':
        case 'function':
        case 'symbol':
            return undefined;
    }
    const obj = value as object;
    if (seen.has(obj)) return seen.get(obj);
    if (Array.isArray(obj)) {
        const out: unknown[] = [];
        seen.set(obj, out);
        for (const x of obj) {
            const c = cloneSafe(x, secrets, seen);
            out.push(c === undefined ? null : c);
        }
        return out;
    }
    if (obj instanceof Map) {
        const out = new Map<unknown, unknown>();
        seen.set(obj, out);
        for (const [k, v] of obj) {
            const ck = cloneSafe(k, secrets, seen);
            const cv = cloneSafe(v, secrets, seen);
            if (ck !== undefined && (cv !== undefined || v === undefined)) out.set(ck, cv);
        }
        return out;
    }
    if (obj instanceof Set) {
        const out = new Set<unknown>();
        seen.set(obj, out);
        for (const x of obj) {
            const c = cloneSafe(x, secrets, seen);
            if (c !== undefined) out.add(c);
        }
        return out;
    }
    if (obj instanceof Date) return new Date(obj.getTime());
    if (!isPlainObject(obj)) return undefined;
    const out: Record<string, unknown> = {};
    seen.set(obj, out);
    for (const [k, v] of Object.entries(obj)) {
        const c = cloneSafe(v, secrets, seen);
        if (c !== undefined) out[k] = c;
    }
    return out;
}

/** Fields of a session that never cross (the bridge's addresses, the stream, timers, the promise chain). */
const SESSION_LOCAL = new Set(['bridge', 'es', 'timer', 'statusSoon', 'chain']);

/** A session as it crosses to the overview window. */
export function overviewSessionData(s: LiveSession, secrets: readonly string[]): OverviewSessionData {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
        if (SESSION_LOCAL.has(k)) continue;
        const c = cloneSafe(v, secrets);
        if (c !== undefined) out[k] = c;
    }
    return out as unknown as OverviewSessionData;
}

/**
 * A session the overview's renderer can draw in the overview window: the
 * snapshot's data with an empty bridge (nothing there may reach it) and none
 * of the main window's stream or timers.
 */
export function overviewSessionFromData(data: OverviewSessionData): LiveSession {
    return {
        ...data,
        bridge: { base: '', status: '', ged: '', events: '', log: '' },
        es: null,
        timer: null,
        statusSoon: null,
        chain: Promise.resolve(),
    } as LiveSession;
}

/** An empty state: no tree, no research (the window's state 4 until the main window says more). */
export function emptyOverviewExtras(): OverviewExtras {
    return {
        liveSwitch: null,
        agentless: false,
        noAgent: false,
        follow: { on: false, view: null },
        lines: { selected: 'all', pendingOrder: null, orderSaving: false, busy: [], problems: [], archive: false },
        hypotheses: { pending: {}, batch: null },
        taskOrder: { busy: [], problems: {} },
        verify: null,
        highlight: null,
    };
}

/** A `research-state` read safely (null: not one this window can draw). */
export function readOverviewState(raw: unknown): OverviewResearchState | null {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Partial<OverviewResearchState>;
    if (s.v !== OVERVIEW_STATE_VERSION || typeof s.at !== 'number' || !s.extras || typeof s.extras !== 'object') return null;
    if (s.session !== null && (typeof s.session !== 'object' || s.session === undefined)) return null;
    return s as OverviewResearchState;
}

// ==================== THE ACTIONS ====================

/**
 * The research actions an overview window asks the main window for (§6
 * table), each with its arguments. "⋯ Edit panel" is none: the window does
 * it itself (the choices live in localStorage).
 */
export type OverviewAction =
    // ---- the tree in the main window (it comes to the front: OVERVIEW_ACTIONS_TO_MAIN) ----
    /** A person of a row: centred in the main window's tree (following there pauses). */
    | { action: 'show-person'; args: { personId: string } }
    /** "Show changed in tree": the people of the changes the progress shows, lit up. */
    | { action: 'show-people'; args: { title: string; personIds: string[] } }
    /** A line's people lit up in the tree. */
    | { action: 'show-direction'; args: { directionId: string } }
    /** "{n} persons" of what a line found: those people lit up in the tree. */
    | { action: 'direction-found'; args: { directionId: string } }
    /** A conflict's or hypothesis's row of "What the research knows": its person's research dialog. */
    | { action: 'person-research'; args: { personId: string; conflict?: string; hypo?: string } }
    /** "Where evidence is missing": the tree overview's Data quality. */
    | { action: 'tree-overview'; args?: Record<string, never> }
    /** A place's questions of "Awaiting action" (the places dialog). */
    | { action: 'waiting-places'; args: { focus?: string } }
    /** The text of all a place's queries with Copy. */
    | { action: 'waiting-group-note'; args: { group: string; name: string } }
    /** "Add images" at a task (the main window's upload dialog; files dropped on the row come along). */
    | { action: 'waiting-images'; args: { itemId: string; files?: File[] } }
    /** A line's form: edit it, or a new line. */
    | { action: 'line-edit'; args: { directionId: string } }
    | { action: 'line-new'; args?: Record<string, never> }
    /** "Verify facts in the tree…" of the tree's "Verifying": the main window's bulk dialog (spec 065 10l). */
    | { action: 'verify-bulk'; args?: Record<string, never> }
    // ---- in the main window, it stays where it is ----
    /** A row hovered: its card lit up in the main window's tree (null: none). */
    | { action: 'hover-person'; args: { personId: string | null } }
    /** Stop of the tree's "Verifying": the research drops what it has not begun to verify. */
    | { action: 'verify-stop'; args?: Record<string, never> }
    /** The main window's highlight of `kind` ends (the changes' filter left none of its people to show). */
    | { action: 'highlight-end'; args: { kind: string } }
    /** Follow live from the overview (it stays open, followed). */
    | { action: 'follow-live'; args?: Record<string, never> }
    /** Stop following (the overview stays, without following). */
    | { action: 'stop-follow'; args?: Record<string, never> }
    /** ◎: following in the tree on or off. */
    | { action: 'follow-tree'; args: { on: boolean } }
    /** "Follow in: Family / Fan / Map". */
    | { action: 'follow-view'; args: { view: 'family' | 'fan' | 'map' } }
    /** Turn on (the research not running): the switch as today. */
    | { action: 'turn-on'; args?: Record<string, never> }
    /** A line selected for the queue and the tree's light ('all': none). */
    | { action: 'line-select'; args: { directionId: string } }
    /** Pause / end / restart a line through the bridge (`reason`: why it ends). */
    | { action: 'line-state'; args: { directionId: string; do: 'pause' | 'resume' | 'done'; reason?: string } }
    /** Move a line in the order (▲ ▼ to the top, or dropped at a place). */
    | { action: 'line-move'; args: { directionId: string; move: 'up' | 'down' | 'top' | { drop: number } } }
    /** "Try again" at a line whose write was refused. */
    | { action: 'line-retry'; args: { directionId: string } }
    /** An answer to an item of "Awaiting action" (the outcome comes back: WaitingAnswerOutcome). */
    | { action: 'waiting-answer'; args: { itemId: string; text: string } }
    /** Mark an item sent, or back to do. */
    | { action: 'waiting-sent'; args: { itemId: string } }
    | { action: 'waiting-unsent'; args: { itemId: string } }
    /** Mark a whole place's items sent. */
    | { action: 'waiting-group-sent'; args: { group: string } }
    /** A file picked in the window for a task. */
    | { action: 'waiting-file'; args: { itemId: string; file: File } }
    /** Ask the research (its terminal) to decide a hypothesis of "Awaiting action". */
    | { action: 'hypothesis-ask'; args: { hypothesisId: string; do: 'decide' | 'abandon' | 'keep-open'; variant?: string } }
    /** "Accept proposals (n)". */
    | { action: 'hypotheses-accept'; args: { ids: string[] } }
    /** "Answer (research)" at an item: its task, story or archive in the research. */
    | { action: 'answer-task'; args: { itemId: string } }
    /** A link into the research (its mark as today): built and launched by the main window for its open tree. */
    | { action: 'research-link'; args: { link: ResearchLinkAction; params?: Record<string, unknown>; kind?: 'terminal' | 'agent' } }
    /**
     * One page of the queue (spec 052 §1 in the window): read by the main window from its bridge with the
     * docked overview's function and answered (`QueuePageResult`: the tasks, `total`, `next`, a search's
     * `match` and `elsewhere`, or why it failed). `filter.q`: the searched text (none: the queue's pages).
     */
    | { action: 'queue-list'; args: { filter: QueueFilter; from: number; count: number } }
    /**
     * A task's own place in the queue (Do next / To the end / Reset to default), written through the bridge.
     * With `queue.next`: "Do next" and `restore` (its Undo, back to `was`) answer with their outcome and the place before.
     */
    | { action: 'queue-order'; args: { task: string; do: 'next' | 'last' | 'default' } | { task: string; do: 'restore'; was: TaskOrderWas } };

export type OverviewActionId = OverviewAction['action'];
export type OverviewActionArgs<T extends OverviewActionId> = Extract<OverviewAction, { action: T }>['args'];

export const OVERVIEW_ACTION_IDS = [
    'show-person', 'show-people', 'show-direction', 'direction-found', 'person-research', 'tree-overview', 'waiting-places', 'waiting-group-note',
    'waiting-images', 'line-edit', 'line-new', 'verify-bulk',
    'hover-person', 'verify-stop', 'highlight-end', 'follow-live', 'stop-follow', 'follow-tree', 'follow-view', 'turn-on',
    'line-select', 'line-state', 'line-move', 'line-retry',
    'waiting-answer', 'waiting-sent', 'waiting-unsent', 'waiting-group-sent', 'waiting-file',
    'hypothesis-ask', 'hypotheses-accept', 'answer-task', 'research-link',
    'queue-list', 'queue-order',
] as const satisfies readonly OverviewActionId[];

/** Actions whose result shows in the main window: the overview window asks it to the front after them. */
export const OVERVIEW_ACTIONS_TO_MAIN: ReadonlySet<OverviewActionId> = new Set<OverviewActionId>([
    'show-person', 'show-people', 'show-direction', 'direction-found', 'person-research', 'tree-overview', 'waiting-places', 'waiting-group-note',
    'waiting-images', 'line-edit', 'line-new', 'verify-bulk',
]);

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const isFile = (v: unknown): v is File => typeof File !== 'undefined' && v instanceof File;
const LINK_ACTIONS = new Set<string>(RESEARCH_LINK_ACTIONS);

function queueFilter(v: unknown): QueueFilter | null {
    const f = obj(v);
    const out: QueueFilter = {};
    if (f.branch !== undefined) { if (!str(f.branch)) return null; out.branch = f.branch; }
    if (f.research !== undefined) { if (!str(f.research)) return null; out.research = f.research; }
    if (f.state !== undefined) { if (f.state !== 'next' && f.state !== 'parked') return null; out.state = f.state; }
    if (f.q !== undefined) {
        // A searched text as the bridge takes it (trimmed, at most 100 characters); an empty one: the queue's pages.
        if (typeof f.q !== 'string') return null;
        const q = queueQuery(f.q);
        if (q) out.q = q;
    }
    return out;
}

/** A page's place and size: from a task on, at most the bridge's page. */
const pageFrom = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const pageCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;

/** A research link's parameters: strings and lists of strings only (the main window builds the link from them). */
function linkParams(v: unknown): Record<string, unknown> | null {
    const p = obj(v);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(p)) {
        if (k === 'tree') continue;   // always the main window's open tree
        if (typeof x === 'string' || strs(x)) out[k] = x;
        else return null;
    }
    return out;
}

/**
 * An action as an overview window sent it, checked (null: not one of the
 * list, or its arguments are not what it takes). The main window runs only
 * what passes.
 */
export function readOverviewAction(action: unknown, args: unknown): OverviewAction | null {
    const a = obj(args);
    switch (action) {
        case 'show-person':
            return str(a.personId) ? { action, args: { personId: a.personId } } : null;
        case 'show-people':
            return strs(a.personIds) && typeof a.title === 'string' ? { action, args: { title: a.title, personIds: [...a.personIds] } } : null;
        case 'show-direction':
        case 'direction-found':
        case 'line-edit':
        case 'line-select':
        case 'line-retry':
            return str(a.directionId) ? { action, args: { directionId: a.directionId } } as OverviewAction : null;
        case 'person-research': {
            if (!str(a.personId)) return null;
            if ((a.conflict !== undefined && !str(a.conflict)) || (a.hypo !== undefined && !str(a.hypo))) return null;
            return { action, args: { personId: a.personId, ...(a.conflict ? { conflict: a.conflict as string } : {}), ...(a.hypo ? { hypo: a.hypo as string } : {}) } };
        }
        case 'tree-overview':
        case 'line-new':
        case 'verify-bulk':
        case 'verify-stop':
        case 'follow-live':
        case 'stop-follow':
        case 'turn-on':
            return { action } as OverviewAction;
        case 'waiting-places':
            return a.focus === undefined || str(a.focus) ? { action, args: a.focus ? { focus: a.focus as string } : {} } : null;
        case 'waiting-group-note':
            return str(a.group) && typeof a.name === 'string' ? { action, args: { group: a.group, name: a.name } } : null;
        case 'waiting-images': {
            if (!str(a.itemId)) return null;
            if (a.files !== undefined && !(Array.isArray(a.files) && a.files.every(isFile))) return null;
            return { action, args: { itemId: a.itemId, ...(a.files ? { files: a.files as File[] } : {}) } };
        }
        case 'highlight-end':
            return str(a.kind) ? { action, args: { kind: a.kind } } : null;
        case 'hover-person':
            return a.personId === null || str(a.personId) ? { action, args: { personId: a.personId as string | null } } : null;
        case 'follow-tree':
            return typeof a.on === 'boolean' ? { action, args: { on: a.on } } : null;
        case 'follow-view':
            return a.view === 'family' || a.view === 'fan' || a.view === 'map' ? { action, args: { view: a.view } } : null;
        case 'line-state': {
            if (!str(a.directionId) || (a.do !== 'pause' && a.do !== 'resume' && a.do !== 'done')) return null;
            if (a.reason !== undefined && typeof a.reason !== 'string') return null;
            return { action, args: { directionId: a.directionId, do: a.do, ...(a.reason ? { reason: a.reason as string } : {}) } };
        }
        case 'line-move': {
            if (!str(a.directionId)) return null;
            const m = a.move;
            if (m === 'up' || m === 'down' || m === 'top') return { action, args: { directionId: a.directionId, move: m } };
            const drop = obj(m).drop;
            return typeof drop === 'number' && Number.isInteger(drop) && drop >= 0 ? { action, args: { directionId: a.directionId, move: { drop } } } : null;
        }
        case 'waiting-answer':
            return str(a.itemId) && typeof a.text === 'string' ? { action, args: { itemId: a.itemId, text: a.text } } : null;
        case 'waiting-sent':
        case 'waiting-unsent':
        case 'answer-task':
            return str(a.itemId) ? { action, args: { itemId: a.itemId } } as OverviewAction : null;
        case 'waiting-group-sent':
            return str(a.group) ? { action, args: { group: a.group } } : null;
        case 'waiting-file':
            return str(a.itemId) && isFile(a.file) ? { action, args: { itemId: a.itemId, file: a.file } } : null;
        case 'hypothesis-ask': {
            if (!str(a.hypothesisId) || (a.do !== 'decide' && a.do !== 'abandon' && a.do !== 'keep-open')) return null;
            if (a.variant !== undefined && !str(a.variant)) return null;
            return { action, args: { hypothesisId: a.hypothesisId, do: a.do, ...(a.variant ? { variant: a.variant as string } : {}) } };
        }
        case 'hypotheses-accept':
            return strs(a.ids) && a.ids.length > 0 ? { action, args: { ids: [...a.ids] } } : null;
        case 'research-link': {
            if (typeof a.link !== 'string' || !LINK_ACTIONS.has(a.link)) return null;
            const params = linkParams(a.params);
            if (!params) return null;
            if (a.kind !== undefined && a.kind !== 'terminal' && a.kind !== 'agent') return null;
            return { action, args: { link: a.link as ResearchLinkAction, params, ...(a.kind ? { kind: a.kind as 'terminal' | 'agent' } : {}) } };
        }
        case 'queue-order': {
            if (!str(a.task)) return null;
            if (a.do === 'restore') {
                const was = sanitizeTaskOrderWas(a.was);
                return was ? { action, args: { task: a.task, do: 'restore', was } } : null;
            }
            return a.do === 'next' || a.do === 'last' || a.do === 'default' ? { action, args: { task: a.task, do: a.do } } : null;
        }
        case 'queue-list': {
            const filter = queueFilter(a.filter);
            if (!filter || !pageFrom(a.from) || !pageCount(a.count)) return null;
            return { action, args: { filter, from: a.from, count: a.count } };
        }
        default:
            return null;
    }
}

// ==================== 6g: THE MAIN WINDOW WITH AN OVERVIEW WINDOW OPEN ====================

/** How the main window's UI learns about its overview window (set by the main window's start; none elsewhere). */
export interface OverviewWindowProbe {
    /** An overview window is open (it said hello, or was just opened from here). */
    open(): boolean;
    /** Bring it to the front. */
    focus(): void;
}

let probe: OverviewWindowProbe | null = null;
let changeListener: (() => void) | null = null;

export function setOverviewWindowProbe(p: OverviewWindowProbe | null): void {
    probe = p;
}

/** The Research overview is in a window of its own now: the main window draws none (6g). */
export function overviewInWindow(): boolean {
    try {
        return !!probe?.open();
    } catch {
        return false;
    }
}

/** Bring the overview window to the front (⤢, Research › Research overview while it is open). */
export function focusOverviewWindow(): void {
    probe?.focus();
}

/** Who hears that what the overview shows may have changed (the main window's snapshot poster). */
export function setOverviewChangeListener(fn: (() => void) | null): void {
    changeListener = fn;
}

/** What the overview shows may have changed (every redraw of the research panel says so). */
export function overviewChanged(): void {
    changeListener?.();
}
