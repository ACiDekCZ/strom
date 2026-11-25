/**
 * The agent's work started from a device of the home network (spec 094 K3.15):
 * the device sends the same `strom-research://…` link the app on the computer
 * would open, through the gateway's own action `POST device/agent {link, yes?}`
 * (sealed tunnel), and the gateway opens the research's terminal with the agent
 * on the computer.
 *
 * - `deviceAgentStart(treeId, link, yes?)` asks the gateway and answers a typed
 *   result: `ask` (the question before the start, its `yes` token), `started`,
 *   `computer` (the question stays in the terminal), `said` (nothing started),
 *   or a failure by its `code` (never the gateway's text, D14);
 * - a store of each tree's start (`starting`, `running`, `waitPc`,
 *   `notStarted`), proved by the research's glance (D15: a new run of this
 *   device or of the same action, or a question at the computer of this
 *   device); without a proof within 30 s the start did not start.
 *
 * This module must never reach the tree (DataManager), the renderer or the
 * person picker, even through another module (device-research-imports.test.ts).
 */

import { tunnel, GatewayError, DEVICE_REPLAY } from './gateway-client';
import type { DeviceGlance, DeviceGlanceRun } from './device-research-data';

/** The gateway's own path of the start (K3.15). */
export const DEVICE_AGENT_PATH = 'device/agent';
/** The longest link the gateway takes. */
export const DEVICE_AGENT_LINK_MAX = 2048;
/** How long a start waits for its proof in the glance before it did not start (D15). */
export const DEVICE_AGENT_PROOF_MS = 30_000;

// ——— the gateway's answer ———

/** The question the terminal would ask before the start, in the research's language (`forPhone`). */
export interface DeviceAgentAsk {
    /** What is started ("Start the agent on 5 tasks of the queue?"). */
    what: string;
    /** The lines under it: the estimate, the subscription used, how many tasks. */
    note: string[];
    /** What the terminal says before the question. */
    said: string[];
    /** The tree's name. */
    tree: string;
}

/** What `POST device/agent` answered (200). */
export type DeviceAgentAnswer =
    | { state: 'ask'; ask: DeviceAgentAsk; yes: string; expiresAt: string }
    | { state: 'started'; terminal?: 'fallback' }
    | { state: 'computer'; why: 'price' | 'question'; terminal?: 'fallback' }
    | { state: 'said'; text: string; refused?: 'archive' | 'waiting' };

/**
 * A start refused or not carried, by its `code` (D14):
 * - `noTerminal` 503 agent.noterminal: no terminal opens on the computer, nothing started;
 * - `down` the gateway not reachable (no answer, time out, a broken answer);
 * - `researchNewer` 409 research.locked: a newer Strom Research wrote the research;
 * - `recent` 409 agent.recent: the terminal of the same link opened a moment ago (a double tap): it starts;
 * - `yesExpired` 410 agent.yes-expired: the token holds no more — asked again without it;
 * - `computerOnly` 403 device.computer-only: the action is the computer's only (`action`: `link.<action>`);
 * - `replay` the gateway took the request already, its answer lost on the way: it may have started;
 * - `unpaired` 401: the device is not paired;
 * - `unknown` 404 device.unknown-action: a gateway without `device/agent`;
 * - `bad` 400 device.body / device.link, an answer of another shape (`agent.answer`), anything else.
 */
export type DeviceAgentFailureKind = 'noTerminal' | 'down' | 'researchNewer' | 'recent' | 'yesExpired' | 'computerOnly'
    | 'replay' | 'unpaired' | 'unknown' | 'bad';

export interface DeviceAgentFailure {
    ok: false;
    kind: DeviceAgentFailureKind;
    /** The refusal's code (`agent.noterminal`, …; `network`, `timeout`, `device.answer` of the connection). */
    code: string;
    /** Its HTTP status (0: no answer). */
    status: number;
    /** `device.computer-only`: the action refused (`link.send`, …). */
    action?: string;
}

export type DeviceAgentResult = { ok: true; answer: DeviceAgentAnswer } | DeviceAgentFailure;

/** The failure's kind by its code and status (D14). */
export function deviceAgentFailureKind(code: string, status: number): DeviceAgentFailureKind {
    switch (code) {
        case 'agent.noterminal': return 'noTerminal';
        case 'research.locked': return 'researchNewer';
        case 'agent.recent': return 'recent';
        case 'agent.yes-expired': return 'yesExpired';
        case 'device.computer-only': return 'computerOnly';
        case 'device.unpaired': return 'unpaired';
        case 'device.unknown-action': return 'unknown';
        case DEVICE_REPLAY: return 'replay';
        case 'network': case 'timeout': case 'device.answer': return 'down';
        default: break;
    }
    if (status === 0 || status === 502 || status === 504) return 'down';
    if (status === 401) return 'unpaired';
    if (status === 410) return 'yesExpired';
    return 'bad';
}

const MAX_TEXT = 1000;
const MAX_LINES = 12;

/** A text of one line (control characters and runs of spaces flattened), cut at `max`. */
function flat(v: unknown, max = MAX_TEXT): string {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const t = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function lines(v: unknown): string[] {
    return Array.isArray(v) ? v.slice(0, MAX_LINES).map((x) => flat(x)).filter(Boolean) : [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The gateway's answer cleaned (unknown fields dropped, texts flattened); null when it is none of the four. */
export function sanitizeDeviceAgentAnswer(value: unknown): DeviceAgentAnswer | null {
    const r = asRecord(value);
    if (!r) return null;
    const fallback = r.terminal === 'fallback' ? { terminal: 'fallback' as const } : {};
    switch (r.state) {
        case 'ask': {
            const ask = asRecord(r.ask);
            const what = flat(ask?.what);
            const yes = typeof r.yes === 'string' && /^[A-Za-z0-9._~+/=-]{1,512}$/.test(r.yes) ? r.yes : '';
            const expiresAt = typeof r.expiresAt === 'string' && r.expiresAt.length <= 40 && Number.isFinite(Date.parse(r.expiresAt)) ? r.expiresAt : '';
            if (!ask || !what || !yes || !expiresAt) return null;
            return { state: 'ask', ask: { what, note: lines(ask.note), said: lines(ask.said), tree: flat(ask.tree, 300) }, yes, expiresAt };
        }
        case 'started':
            return { state: 'started', ...fallback };
        case 'computer':
            // A newer research's other reason: a question in the terminal.
            return { state: 'computer', why: r.why === 'price' ? 'price' : 'question', ...fallback };
        case 'said': {
            const text = flat(r.text);
            if (!text) return null;
            const refused = r.refused === 'archive' || r.refused === 'waiting' ? { refused: r.refused as 'archive' | 'waiting' } : {};
            return { state: 'said', text, ...refused };
        }
        default:
            return null;
    }
}

/** A link the gateway can take: the research's scheme (its own install's too), at most 2048 characters. */
export function deviceAgentLinkOk(link: unknown): link is string {
    return typeof link === 'string' && link.length > 0 && link.length <= DEVICE_AGENT_LINK_MAX
        && /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/[a-z-]+(?:\?\S*)?$/.test(link);
}

function failure(code: string, status: number, said?: Record<string, unknown> | null): DeviceAgentFailure {
    const action = typeof said?.action === 'string' && said.action.length <= 80 ? said.action : undefined;
    return { ok: false, kind: deviceAgentFailureKind(code, status), code, status, ...(action ? { action } : {}) };
}

/**
 * The agent's link started on the computer (`POST device/agent {link, yes?}` through the tunnel to `treeId`).
 * Without `yes` the gateway says what the terminal would do (`ask`, `started`, `computer`, `said`); with the
 * `yes` of an `ask` it starts. Never throws for the gateway's refusals or the connection (a failure of its
 * kind); a cancel by `signal` throws its AbortError.
 */
export async function deviceAgentStart(treeId: string, link: string, yes?: string, signal?: AbortSignal | null): Promise<DeviceAgentResult> {
    if (!deviceAgentLinkOk(link)) return failure('device.link', 400);
    let answer: Awaited<ReturnType<typeof tunnel>>;
    try {
        answer = await tunnel({ m: 'POST', p: DEVICE_AGENT_PATH, tree: treeId, b: { link, ...(yes ? { yes } : {}) }, signal: signal ?? null });
    } catch (e) {
        if (e instanceof GatewayError) return failure(e.code, e.status, e.extra);
        throw e;
    }
    let said: unknown = null;
    try { said = JSON.parse(new TextDecoder().decode(answer.body ?? new Uint8Array())); } catch { said = null; }
    if (answer.s !== 200) {
        const r = asRecord(said);
        return failure(typeof r?.code === 'string' && r.code.length <= 80 ? r.code : `http.${answer.s}`, answer.s, r);
    }
    const clean = sanitizeDeviceAgentAnswer(said);
    return clean ? { ok: true, answer: clean } : failure('agent.answer', 200);
}

// ——— what was started ———

/** What a link starts: the queue's work, a line's run, a conversation in the terminal, other work of the agent. */
export type DeviceAgentKind = 'queue' | 'line' | 'chat' | 'other';

/** The kind of an agent's link and the line it holds (`research=G…`). */
export function deviceAgentKindOf(link: string): { kind: DeviceAgentKind; line?: string } {
    const m = /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/([a-z-]+)(?:\?(.*))?$/.exec(link.trim());
    if (!m) return { kind: 'other' };
    const q = new URLSearchParams(m[2] ?? '');
    const line = q.get('research') ?? undefined;
    switch (m[1]) {
        case 'work': return line ? { kind: 'line', line } : { kind: 'queue' };
        case 'chat': return { kind: 'chat', ...(line ? { line } : {}) };
        case 'task': case 'conflict': return { kind: 'chat' };
        default: return { kind: 'other' };
    }
}

// ——— the start's state per tree ———

/**
 * The state of a start (the row in Now, 10.3–10.7):
 * - `starting` the gateway opened the terminal (or will), no proof yet (spinner; 30 s at most);
 * - `running` the glance shows its run (or a conversation in the terminal: no run to show);
 * - `waitPc` a question or a consent waits at the computer;
 * - `notStarted` nothing started (`why`), with Try again.
 */
export type DeviceAgentStartState = 'starting' | 'running' | 'waitPc' | 'notStarted';

/** Why a start did not start: no proof in 30 s, its failure's kind, or the research said why (`text`). */
export type DeviceAgentNotStarted = 'timeout' | 'said' | DeviceAgentFailureKind;

export interface DeviceAgentStartEntry {
    tree: string;
    link: string;
    kind: DeviceAgentKind;
    /** The line of a line's run or a conversation about it (G…). */
    line?: string;
    /** What the row says of it (a line's name, a task's text), as the caller gave it. */
    label?: string;
    state: DeviceAgentStartState;
    /** Started without a confirmation (`run.confirm no` on the computer, 10.7): one quiet sentence. */
    noConfirm: boolean;
    /** When the state began (ms). */
    since: number;
    /** The run that proved it (run-…). */
    run?: string;
    /** `notStarted`: why. */
    why?: DeviceAgentNotStarted;
    /** `notStarted` of `said`: the research's sentence (its language). */
    text?: string;
    /** The runs the glance showed when it started (a new run proves it). */
    runsBefore: readonly string[];
    /** A glance proved its state (once that proof is gone, the start is over). */
    proved?: boolean;
}

const starts = new Map<string, DeviceAgentStartEntry>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** The runs of each tree's last glance noted (what is "new" for the next start). */
const lastRuns = new Map<string, readonly string[]>();
const listeners = new Set<(tree: string, start: DeviceAgentStartEntry | null) => void>();

function emit(tree: string): void {
    const s = starts.get(tree) ?? null;
    for (const cb of [...listeners]) {
        try { cb(tree, s); } catch { /* a listener's own */ }
    }
}

function stopTimer(tree: string): void {
    const t = timers.get(tree);
    if (t !== undefined) clearTimeout(t);
    timers.delete(tree);
}

function put(entry: DeviceAgentStartEntry): void {
    stopTimer(entry.tree);
    starts.set(entry.tree, entry);
    if (entry.state === 'starting') {
        const tree = entry.tree;
        timers.set(tree, setTimeout(() => {
            timers.delete(tree);
            const now = starts.get(tree);
            if (now !== entry) return;
            put({ ...now, state: 'notStarted', why: 'timeout', since: Date.now() });
        }, DEVICE_AGENT_PROOF_MS));
    }
    emit(entry.tree);
}

/** A tree's start now, or null. */
export function deviceAgentStartOf(tree: string): DeviceAgentStartEntry | null {
    return starts.get(tree) ?? null;
}

/** Each change of a tree's start (null: none any more); returns the unsubscribe. */
export function onDeviceAgentStart(cb: (tree: string, start: DeviceAgentStartEntry | null) => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

/** What is noted of a start: its link, the row's text, the runs seen before (else those of the last glance noted). */
export interface DeviceAgentStartNote {
    link: string;
    label?: string;
    runsBefore?: readonly string[];
}

function entryOf(tree: string, o: DeviceAgentStartNote, state: DeviceAgentStartState, extra: Partial<DeviceAgentStartEntry> = {}): DeviceAgentStartEntry {
    const { kind, line } = deviceAgentKindOf(o.link);
    return {
        tree, link: o.link, kind, ...(line ? { line } : {}), ...(o.label ? { label: o.label } : {}),
        state, noConfirm: false, since: Date.now(), runsBefore: [...(o.runsBefore ?? lastRuns.get(tree) ?? [])], ...extra,
    };
}

/**
 * The terminal opens on the computer (`started`; `noConfirm`: without the question, `run.confirm no`): starting
 * until the glance proves it (30 s at most). A conversation has no run to prove it: it is at the computer at once.
 */
export function noteDeviceAgentStarting(tree: string, o: DeviceAgentStartNote & { noConfirm?: boolean }): DeviceAgentStartEntry {
    const chat = deviceAgentKindOf(o.link).kind === 'chat';
    const entry = entryOf(tree, o, chat ? 'running' : 'starting', { noConfirm: !!o.noConfirm });
    put(entry);
    return entry;
}

/** The terminal opened and asks at the computer (`computer`, 10.5). */
export function noteDeviceAgentWaitPc(tree: string, o: DeviceAgentStartNote): DeviceAgentStartEntry {
    const entry = entryOf(tree, o, 'waitPc');
    put(entry);
    return entry;
}

/** Nothing started (10.6): why, and the research's sentence of `said`. */
export function noteDeviceAgentNotStarted(tree: string, o: DeviceAgentStartNote & { why: DeviceAgentNotStarted; text?: string }): DeviceAgentStartEntry {
    const entry = entryOf(tree, o, 'notStarted', { why: o.why, ...(o.text ? { text: o.text } : {}) });
    put(entry);
    return entry;
}

/** A tree's start forgotten (Try again begins anew, the row closed, the tree left). */
export function clearDeviceAgentStart(tree: string): void {
    stopTimer(tree);
    if (starts.delete(tree)) emit(tree);
}

/** Every start forgotten (the device mode left; tests). */
export function resetDeviceAgentStarts(): void {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    const trees = [...starts.keys()];
    starts.clear();
    lastRuns.clear();
    for (const tree of trees) emit(tree);
}

/**
 * What `deviceAgentStart` answered, noted as the tree's start, and what the caller does next:
 * - `ask` show the question (its sheet), send `yes` on the person's yes;
 * - `askAgain` the token held no more: ask again without `yes`;
 * - `noted` the start's state is noted (starting, running, waiting at the computer, not started);
 * - `refused` the action is the computer's only (`noteResearchDeviceRefused`, the toast `device.onlyComputer`);
 * - `error` a request or an answer of another shape: nothing noted (a general error).
 */
export type DeviceAgentNext = 'ask' | 'askAgain' | 'noted' | 'refused' | 'error';

export function applyDeviceAgentResult(tree: string, o: DeviceAgentStartNote & { yesSent?: boolean }, result: DeviceAgentResult): DeviceAgentNext {
    if (result.ok) {
        const a = result.answer;
        switch (a.state) {
            case 'ask': return 'ask';
            case 'started': noteDeviceAgentStarting(tree, { ...o, noConfirm: !o.yesSent }); return 'noted';
            case 'computer': noteDeviceAgentWaitPc(tree, o); return 'noted';
            case 'said': noteDeviceAgentNotStarted(tree, { ...o, why: 'said', text: a.text }); return 'noted';
        }
    }
    switch (result.kind) {
        case 'yesExpired': return 'askAgain';
        // A double tap: the terminal of the same link opened a moment ago.
        case 'recent': noteDeviceAgentStarting(tree, { ...o, noConfirm: false }); return 'noted';
        // The answer lost on the way: a start with yes may have started (the glance tells), a question is asked again.
        case 'replay':
            if (!o.yesSent) return 'askAgain';
            noteDeviceAgentStarting(tree, { ...o, noConfirm: false });
            return 'noted';
        case 'noTerminal': case 'down': case 'researchNewer': noteDeviceAgentNotStarted(tree, { ...o, why: result.kind }); return 'noted';
        case 'computerOnly': return 'refused';
        default: return 'error';
    }
}

// ——— the proof in the glance (D15) ———

function sameAction(start: DeviceAgentStartEntry, run: DeviceGlanceRun): boolean {
    if (start.kind === 'line') return run.line === start.line;
    if (start.kind === 'queue') return run.line === null;
    return false;
}

/**
 * What a glance says of a start: its run (new since the start: this device's, or of the same action — the
 * queue, the same line) and whether a question or a consent waits at the computer (the run's, or one of
 * this device's terminal). null: no proof.
 */
export function deviceAgentProof(start: DeviceAgentStartEntry, glance: DeviceGlance, deviceId: string | null): { run?: string; waitPc: boolean } | null {
    const before = new Set(start.runsBefore);
    const fresh = glance.runs.filter(r => !before.has(r.id));
    const run = (deviceId ? fresh.find(r => r.device?.id === deviceId) : undefined) ?? fresh.find(r => sameAction(start, r))
        ?? (start.run ? glance.runs.find(r => r.id === start.run) : undefined);
    const asks = (glance.onComputer ?? []).some(o => (!!deviceId && o.device === deviceId) || (!!run && o.run === run.id));
    if (run) return { run: run.id, waitPc: !!run.onComputer || asks };
    return asks ? { waitPc: true } : null;
}

/**
 * A glance of `tree` read (the Research screen, D15): the tree's start moves on by its proof — starting or
 * waiting becomes running (its run) or waiting at the computer; a running start whose run is gone ends (the
 * row of Now shows the research again). The runs are kept for the next start's "new".
 */
export function noteDeviceAgentGlance(tree: string, glance: DeviceGlance, deviceId: string | null): void {
    lastRuns.set(tree, glance.runs.map(r => r.id));
    const start = starts.get(tree);
    if (!start || start.state === 'notStarted') return;
    if (start.kind === 'chat' && start.state === 'running') return;
    const proof = deviceAgentProof(start, glance, deviceId);
    if (!proof) {
        // Its run ended (or was stopped), the question at the computer went without a run: the start is over.
        if (start.proved) clearDeviceAgentStart(tree);
        return;
    }
    const state: DeviceAgentStartState = proof.waitPc ? 'waitPc' : 'running';
    if (state === start.state && proof.run === start.run && start.proved) return;
    put({ ...start, state, proved: true, ...(proof.run ? { run: proof.run } : {}), since: state === start.state ? start.since : Date.now() });
}
