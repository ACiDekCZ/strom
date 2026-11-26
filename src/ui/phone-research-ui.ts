/**
 * The phone's Research screen (spec 094 K3.13): on a phone in the device mode
 * the app opens on what the research does now — Now, Waiting, Finds, Lines,
 * "Progress and queue ›" and the dock for photos — read from the research's
 * bridge (device-research-data.ts) before the tree is on the device. The tree
 * comes only when asked for (Family, Table, "Show in the tree"): downloaded
 * with its progress over the dock, or the copy held here at once
 * (`phoneOpenTree`). Back from the tree returns to this screen, the tree kept.
 *
 * Only a phone (`MQ_PHONE_BAR`) in the device mode, whose research offers the
 * screen's data (`glance`) or whose last state is held here; a tablet, a second
 * computer and the app elsewhere are as before.
 *
 * This module must never reach the tree (DataManager), the renderer or the
 * person picker, even through another module (device-research-imports.test.ts):
 * whatever needs the tree is asked through the UI (`this.…`), whose type only
 * is imported.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { chosenTreeId, chooseTree, computerLabelOf, findsSeenAt, markFindsSeen, pairingNow } from '../device/device-store.js';
import { retryDeviceConnection } from '../device/device-connection.js';
import {
    heldResearchState, readDeviceResearch, readDeviceResearchFeatures, readFinds, watchDeviceResearch,
    type DeviceFindGroup, type DeviceFindLine, type DeviceFinds,
    type DeviceGlance, type DeviceGlanceLine, type DeviceGlanceNow, type DeviceGlanceWaiting, type DeviceResearchFeatures, type DeviceResearchState,
    type DeviceWaitingDo, type DeviceWay,
} from '../device/device-research-data.js';
import {
    deviceBridgeBase, researchBridgeMark, researchConflictRef, researchDeviceAgentLink, researchDeviceAllows, researchDeviceState, researchLinkMark,
    researchSchemeUrl, researchTaskRef, type ResearchLinkAction, type ResearchLinkParams,
} from '../research-link.js';
import { researchActionLabel, researchMarkFlags } from './research-open-mark.js';
import { busySpinHtml } from './busy.js';
import {
    clearDeviceAgentStart, deviceAgentStartOf, noteDeviceAgentGlance, onDeviceAgentStart, type DeviceAgentStartEntry,
} from '../device/device-agent.js';
import type { DeviceAgentCtx, DeviceAgentSheetInfo } from './device-agent-ui.js';
import {
    answerBranchWaiting, researchBridgeWrite, setDirectionState, writeDirectionOrder,
    type BridgeWriteResult, type DirectionStateDo, type DirectionWriteRefused,
} from '../research-directions-write.js';
import {
    WAITING_FILE_ACCEPT, answerWaiting, postWaitingSent, putWaitingFile, retryWaiting, waitingFileTaken,
    type WaitingRetryRefused, type WaitingWriteRefused,
} from '../research-waiting-write.js';
import { WaitingAnswerForm, type WaitingAnswerOutcome } from './waiting-answer-form.js';
import { deviceHypothesisBody, type DeviceHypothesisDo } from './device-decide-ui.js';
import { postRunStop } from '../research-runs-write.js';
import { formatLiveClock, formatWaitingSince } from '../live-time.js';
import { deviceDrafts } from '../device/device-photos.js';
import type { ViewMode } from '../types.js';

export const PHONE_RESEARCH_ID = 'phone-research';
export const PHONE_DOCK_ID = 'phone-dock';
/** The body's class while the screen is what is seen. */
export const PHONE_RESEARCH_ON = 'phone-research-on';
/** The body's class while the screen is offered (the bar's Research tab, Descendants under More). */
export const PHONE_RESEARCH_READY = 'phone-research-ready';
/** The history entry of the tree opened from the screen (Back returns to the screen). */
export const PHONE_TREE_STATE = 'tree';

/** How long the start waits for the research's features before it decides (then the tree opens as before). */
const FEATURES_WAIT_MS = 4000;

/** The sections of the screen, top to bottom on a phone held upright (§1 point 1). */
export const PHONE_SECTIONS = ['now', 'waiting', 'finds', 'lines'] as const;
export type PhoneSection = typeof PHONE_SECTIONS[number];
/** Held sideways (§1 point 6): Now and Waiting on the left, Finds, Lines and the dock on the right. */
export const PHONE_COLUMNS: Record<PhoneSection, 'a' | 'b'> = { now: 'a', waiting: 'a', finds: 'b', lines: 'b' };

/** The bottom bar's items (§1 point 3, variant A). */
export type PhoneBarItem = 'research' | 'family' | 'descendants' | 'add' | 'table' | 'more';

/**
 * The bottom bar's items for where the app runs: a phone in the device mode whose research offers the screen has
 * Research | Family | (+) | Table | More (Descendants under More); anything else Family | Descendants | (+) | Table | More.
 */
export function phoneBarItems(o: { deviceMode: boolean; phone: boolean; offered: boolean }): PhoneBarItem[] {
    return o.deviceMode && o.phone && o.offered
        ? ['research', 'family', 'add', 'table', 'more']
        : ['family', 'descendants', 'add', 'table', 'more'];
}

/** Whether the Research screen stands first for a tree: its research gives the screen's data, or its last state is held here. */
export function phoneScreenFor(o: { features: DeviceResearchFeatures | null; held: boolean }): boolean {
    return !!o.features?.glance || o.held;
}

/** Where the tree is opened to from the screen (§7): a view, a person (P…, the research's ID), the overview over the screen. */
export interface PhoneTreeTarget {
    view?: ViewMode;
    person?: string;
    /** The overview over the screen; 'waiting': with its Waiting open ("n more" of Waiting). */
    overview?: boolean | 'waiting';
}

/** What opening the tree came to (`deviceOpenPhoneTree`). */
export type PhoneTreeOpen = 'open' | 'cancel' | 'failed' | 'offline';

let screenTreeId: string | null = null;
let features: DeviceResearchFeatures | null = null;
let shownState: DeviceResearchState | null = null;
/** Without the computer (§8 point 1): the last state shown, its actions grey; the dock goes on. */
let away = false;
/** The screen's tree's last read failed (no connection): the held state is shown. */
let readFailed = false;
let unwatch: (() => void) | null = null;
let reading: AbortController | null = null;
/** The trees opened here since the page opened, or held here (no "downloaded when opened" for them). */
const treesOpened = new Set<string>();
/** The tree's opening on its way (one at a time). */
let opening: Promise<boolean> | null = null;
/** Where each column was scrolled when the screen went (kept while the app is open). */
const scrollKept: Record<'main' | 'a' | 'b', number> = { main: 0, a: 0, b: 0 };
let phoneQuery: MediaQueryList | null = null;
let historyWatched = false;
let dockObserver: ResizeObserver | null = null;

/** The phone's media query (a phone either way up), or null where there is none. */
function phoneMedia(): MediaQueryList | null {
    if (phoneQuery) return phoneQuery;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    phoneQuery = window.matchMedia(MQ_PHONE_BAR);
    return phoneQuery;
}

/** The viewport is a phone's (≤ 640 px, or a phone held sideways). */
export function phoneViewport(): boolean {
    return phoneMedia()?.matches ?? false;
}

/** Follow the phone's media query (each change calls `onChange`); once. */
export function watchPhoneViewport(onChange: () => void): void {
    const mq = phoneMedia();
    if (!mq || (mq as MediaQueryList & { __phoneWatched?: boolean }).__phoneWatched) return;
    (mq as MediaQueryList & { __phoneWatched?: boolean }).__phoneWatched = true;
    mq.addEventListener?.('change', onChange);
}

/** The Research screen is what is seen now. */
export function phoneResearchShown(): boolean {
    return typeof document !== 'undefined' && document.body.classList.contains(PHONE_RESEARCH_ON);
}

/** The screen is offered (a phone in the device mode, its research giving the screen's data). */
export function phoneResearchReady(): boolean {
    return typeof document !== 'undefined' && document.body.classList.contains(PHONE_RESEARCH_READY)
        && document.body.classList.contains('device-mode') && document.body.classList.contains('device-phone');
}

/** The tree of the screen (the device's chosen tree, as switched on the screen). */
export function phoneResearchTreeId(): string | null {
    return screenTreeId ?? chosenTreeId();
}

/** The screen is seen and its research is an archive (3.6): no Now nor Lines, no actions, "Archive · read-only". */
export function phoneResearchArchive(): boolean {
    return phoneResearchShown() && shownState?.glance?.tree.state === 'archive';
}

/** A tree opened here (or held here): the dock's "downloaded when opened" goes. */
export function notePhoneTreeOpened(treeId: string): void {
    treesOpened.add(treeId);
}

function computerName(): string {
    return computerLabelOf(pairingNow()?.computer);
}

/** The section's element (its body is where the section's rows go: appendPhoneNow…). */
function sectionEl(screen: HTMLElement, key: PhoneSection): { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement } | null {
    const sec = screen.querySelector<HTMLElement>(`.phone-sec[data-sec="${key}"]`);
    const head = sec?.querySelector<HTMLElement>('.phone-sec__title');
    const sum = sec?.querySelector<HTMLElement>('.phone-sec__sum');
    const body = sec?.querySelector<HTMLElement>('.phone-sec__body');
    return sec && head && sum && body ? { sec, head, sum, body } : null;
}

/** The sections whose rows are kept by their keys across a render (only their texts change). */
const KEYED_SECTIONS: ReadonlySet<PhoneSection> = new Set<PhoneSection>(['now', 'waiting', 'finds', 'lines']);

/** One quiet sentence in a section's body (an empty section, §8 point 8). */
function quiet(body: HTMLElement, text: string): void {
    const p = document.createElement('p');
    p.className = 'phone-sec__quiet';
    p.textContent = text;
    body.append(p);
}

const CHEVRON = '<svg class="phone-research__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

// ——— Now and Lines (§2, §3) ———

/** The glyph of a line's way: ↑ ancestors, ↓ descendants, ? a person or a question. */
export function wayGlyph(way: DeviceWay): string {
    return way === 'up' ? '↑' : way === 'down' ? '↓' : '?';
}

/** How a line is moved in the order of work (§3 point 2). */
export type PhoneLineMove = 'up' | 'down' | 'first';

/** The order of work (line IDs) after `id` is moved; null when the move changes nothing (or the line is not there). */
export function movedLineOrder(ids: readonly string[], id: string, move: PhoneLineMove): string[] | null {
    const i = ids.indexOf(id);
    if (i < 0) return null;
    const to = move === 'up' ? i - 1 : move === 'down' ? i + 1 : 0;
    if (to < 0 || to >= ids.length || to === i) return null;
    const out = ids.filter(x => x !== id);
    out.splice(to, 0, id);
    return out;
}

/**
 * The lines in the order of work, numbered again from 1: by `order` when given (a move on its way; lines it does
 * not name keep their order after it), else by the research's own numbers.
 */
export function linesInOrder(lines: readonly DeviceGlanceLine[], order: readonly string[] | null = null): DeviceGlanceLine[] {
    const sorted = [...lines].sort((a, b) => a.n - b.n);
    if (order) {
        const at = new Map(order.map((id, i) => [id, i] as const));
        const rank = (l: DeviceGlanceLine): number => at.get(l.id) ?? order.length + sorted.indexOf(l);
        sorted.sort((a, b) => rank(a) - rank(b));
    }
    return sorted.map((l, i) => (l.n === i + 1 ? l : { ...l, n: i + 1 }));
}

/** Now's heading: "Now · n lines" when more than one line is worked on, else "Now". */
export function phoneNowTitle(now: readonly DeviceGlanceNow[]): string {
    const r = strings.deviceResearch;
    const lines = new Set(now.map(n => n.line ?? '')).size;
    return lines > 1 ? r.nowTitleLines(lines) : r.nowTitle;
}

/** What a row of Now says under its task: stopping, paused until a time, or working since a time. */
export function phoneNowMeta(n: DeviceGlanceNow, o: { stopping: boolean; lang: string; now?: number }): string {
    const r = strings.deviceResearch;
    if (o.stopping) return r.nowStopping;
    const at = o.now ?? Date.now();
    const clock = (iso: string): string => formatLiveClock(Date.parse(iso), at, o.lang);
    return n.paused ? r.nowPaused(clock(n.paused.until)) : r.nowSince(clock(n.since));
}

/** What Now says when nobody works (§2 point 4): never worked on, or nothing now and when it was worked on last. */
export function phoneNowIdle(g: DeviceGlance | null, o: { lang: string; now?: number }): { kind: 'never' } | { kind: 'idle'; last: string } | null {
    if (g?.now.length) return null;
    if (!g?.lastWorked) return { kind: 'never' };
    return { kind: 'idle', last: strings.live.lastWorked(formatLiveClock(Date.parse(g.lastWorked), o.now ?? Date.now(), o.lang), '') };
}

/** Whether a refusal of a line's write is the research being written just now (409, 503): "linesBusy" under the list. */
export function lineWriteBusy(r: BridgeWriteResult<object>): boolean {
    return !r.ok && (r.status === 409 || r.status === 503);
}

/**
 * The quiet sentences of what stays on the computer (spec 094 K3.15): null where this device starts that work itself —
 * a line's conversation with `agent.start`, sorting by the agent with `agent.bridge` (§10: the sentence is not drawn,
 * the button stands in its place). A conflict's sentence stays (its value is chosen on the computer).
 */
export type PhoneComputerOnly = 'line-work' | 'batch-sort' | 'conflict';
/** A device of a research (the marks of the computer itself are no device's). */
const onDevice = (): boolean => researchDeviceState() !== null;
export function phoneComputerOnlyNote(kind: PhoneComputerOnly, pc: string): string | null {
    switch (kind) {
        case 'line-work': return onDevice() && researchLinkMark('chat') === 'agent' ? null : strings.device.dirWorkOnComputer(pc);
        case 'batch-sort': return onDevice() && researchBridgeMark('material-sort') === 'bridgeAgent' ? null : strings.batch.sortOnComputer;
        case 'conflict': return strings.deviceResearch.conflictOnComputer(pc);
    }
}

// ——— The agent started from the device (§10, K3.15) ———

/** "Only N tasks" of the queue's sheet (as the computer's WORK_TASKS_DEFAULT). */
export const PHONE_WORK_TASKS = 5;

/**
 * The agent's link of a research tree, built as the computer builds it; null where this device does not start it
 * (no `agent.start`, a link the research would not take).
 */
export function phoneAgentLink(tree: string | null, action: ResearchLinkAction, params: Omit<ResearchLinkParams, 'tree'> = {}): string | null {
    const url = tree ? researchSchemeUrl(action, { tree, ...params }) : null;
    return url && researchDeviceAgentLink(url) ? url : null;
}

/** A start of the tree on its way (not ended, not a conversation at the computer): what it holds. */
function startOnWay(start: DeviceAgentStartEntry | null): boolean {
    return !!start && (start.state === 'starting' || start.state === 'waitPc' || (start.state === 'running' && start.kind !== 'chat'));
}

/**
 * Whether "Work on the queue…" stands under Now (§2 point 6): a research that is no archive, a link this device
 * starts, the queue's run not at work and no start of the queue on its way. The most runs at once is the research's
 * to say (its answer of the start), the glance does not tell it.
 */
export function phoneQueueWorkOffered(g: DeviceGlance | null, start: DeviceAgentStartEntry | null, link: string | null): boolean {
    if (!g || !link || g.tree.state === 'archive') return false;
    if (g.runs.some(r => r.line === null)) return false;
    return !(startOnWay(start) && start!.kind === 'queue');
}

/**
 * A line's own run in its actions (§3 point 2): null while it is not offered (ended, at work, no link), else
 * `why` it is grey (paused, nothing to do, its start on its way) or offered ('').
 */
export function phoneLineRunWhy(line: DeviceGlanceLine, g: DeviceGlance, start: DeviceAgentStartEntry | null, link: string | null): string | null {
    if (!link || line.state === 'done' || g.runs.some(r => r.line === line.id)) return null;
    if (startOnWay(start) && start!.kind === 'line' && start!.line === line.id) return strings.busy.starting;
    if (line.state === 'paused') return strings.live.lineRunPaused;
    if (line.tasks <= 0) return strings.live.lineRunEmpty;
    return '';
}

/** A row of a sheet of the screen (presentMenuSheet's row): the agent's carry their marks as flags. */
interface PhoneSheetRow {
    label: string;
    run: () => void;
    id: string;
    sub?: string;
    ai?: boolean;
    ext?: boolean;
    disabled?: boolean;
    why?: string;
}

/** Now's row of a start from this device (10.3–10.7): what it says and what can be done there. */
export interface PhoneStartRow {
    state: 'starting' | 'waitPc' | 'notStarted' | 'chat';
    title: string;
    /** The quiet line under it (where the agent comes up, without confirmation, what is confirmed at the computer). */
    sub: string;
    /** Why it did not start (the error colour). */
    why: string;
    /** Try again (not started). */
    retry: boolean;
    /** The conversation's row can be put away. */
    close: boolean;
}

/** The row of a start, or null where Now's own rows say it (a run proved: the research's row). */
export function phoneStartRow(start: DeviceAgentStartEntry | null, pc: string): PhoneStartRow | null {
    if (!start) return null;
    const A = strings.deviceAgent;
    const L = strings.live;
    const b = strings.busy;
    const name = start.label ?? '';
    switch (start.state) {
        case 'starting':
            return {
                state: 'starting',
                title: start.kind === 'queue' ? b.queueStarting : name ? L.lineRunStarting(name) : b.starting,
                sub: start.noConfirm ? A.noConfirm(pc) : A.startingSub(pc), why: '', retry: false, close: false,
            };
        case 'running':
            return start.kind === 'chat' ? { state: 'chat', title: A.chatRow(pc), sub: name, why: '', retry: false, close: true } : null;
        case 'waitPc':
            return { state: 'waitPc', title: A.waitPc(pc), sub: A.waitPcSub, why: '', retry: false, close: false };
        case 'notStarted': {
            if (start.why === 'timeout') {
                const title = start.kind === 'queue' ? b.queueNotStarted : name ? `${L.lineRunNotStarted} · ${name}` : L.lineRunNotStarted;
                return { state: 'notStarted', title, sub: '', why: '', retry: true, close: false };
            }
            const title = start.kind === 'queue' ? A.notStartedTitle : start.kind === 'line' ? A.notStartedLine
                : start.kind === 'chat' ? A.notStartedChat : A.failed;
            const why = start.why === 'said' && start.text ? start.text
                : start.why === 'noTerminal' ? A.noTerminal(pc)
                : start.why === 'researchNewer' ? A.researchNewer
                : start.why === 'down' ? A.down(pc)
                : title === A.failed ? '' : A.failed;
            return { state: 'notStarted', title, sub: start.kind === 'line' || start.kind === 'chat' ? name : '', why, retry: true, close: false };
        }
    }
}

// ——— The dock (§6) ———

/** How the batches of this page stand (batch-ui's `batchQueueInfo`), for the queue's strip (§6 point 4). */
export interface BatchQueueInfo {
    /** The batch going (or ended, its window not closed yet): its photos, sent, failed, the share sent with the one on its way. */
    run: { researchId: string; total: number; sent: number; failed: number; share: number; finished: boolean; paused: boolean; lost: boolean } | null;
    /** The last batch that ended in this page: when, how many of how many reached the research, how many failed. */
    ended: { researchId: string; at: number; k: number; n: number; failed: number } | null;
}

/** How long "k of n photos are in the research" stays in the strip. */
export const QUEUE_DONE_MS = 5000;

/** What the queue's strip says (nothing waiting or sent: no strip). */
export type PhoneQueueStrip =
    | { kind: 'sending'; n: number; a: number; b: number; share: number }
    | { kind: 'offline'; n: number }
    | { kind: 'failed'; n: number }
    | { kind: 'done'; k: number; n: number }
    | null;

/**
 * The strip of the queue (§6 point 4) from the batches' state, the photos handed over that wait here (`held`) and the
 * time now: a batch going is "sending a of b" (lost connection: waiting for it), failed photos "n not sent" with
 * Try again, handed photos waiting here "waiting for connection", a batch just ended "k of n in the research" for 5 s.
 */
export function phoneQueueStrip(info: BatchQueueInfo, held: number, now: number): PhoneQueueStrip {
    const r = info.run;
    if (r && !r.finished) {
        if (r.paused && r.lost) return { kind: 'offline', n: Math.max(1, r.total - r.sent) };
        return { kind: 'sending', n: r.total, a: Math.min(r.total, r.sent + r.failed + 1), b: r.total, share: Math.max(0, Math.min(1, r.share)) };
    }
    if (r?.finished && r.failed > 0) return { kind: 'failed', n: r.failed };
    if (held > 0) return { kind: 'offline', n: held };
    const e = info.ended;
    if (e && e.failed > 0) return { kind: 'failed', n: e.failed };
    if (e && now - e.at < QUEUE_DONE_MS) return { kind: 'done', k: e.k, n: e.n };
    return null;
}

/** The strip's text: its count in bold (the part before " · "), the rest quiet; failed photos all bold, then Try again. */
export function phoneQueueStripHtml(strip: NonNullable<PhoneQueueStrip>): string {
    const r = strings.deviceResearch;
    const bold = (text: string): string => {
        const at = text.indexOf(' · ');
        return at < 0 ? `<b>${esc(text)}</b>` : `<b>${esc(text.slice(0, at))}</b>${esc(text.slice(at))}`;
    };
    switch (strip.kind) {
        case 'sending':
            return `<span class="phone-dock__queue-text">${bold(r.queueSending(strip.n, strip.a, strip.b))}</span>`
                + `<span class="phone-dock__queue-bar" aria-hidden="true"><i style="width:${Math.round(strip.share * 100)}%"></i></span>`;
        case 'offline': return `<span class="phone-dock__queue-text">${bold(r.queueOffline(strip.n))}</span>`;
        case 'failed':
            return `<span class="phone-dock__queue-text"><b>${esc(r.queueFailed(strip.n))}</b></span>`
                + `<span class="phone-dock__queue-retry">${esc(strings.batch.retry)}</span>`;
        case 'done': return `<span class="phone-dock__queue-text">${esc(strings.batch.doneDevice(strip.k, strip.n))}</span>`;
    }
}

function esc(text: string): string {
    return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** Photos handed over on this device that wait here (read again when the queue changes, not while a batch is sent). */
let heldHanded = 0;
let queueTimer: ReturnType<typeof setTimeout> | null = null;

const DOCK_ICONS = {
    camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z"/><circle cx="12" cy="13" r="3.5"/>',
    gallery: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17.5 5-4.5 4 3.5 2.5-2 4.5 3.5"/>',
    file: '<path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z"/><path d="M14 3.5V8h4.5"/>',
} as const;

function dockButton(pick: keyof typeof DOCK_ICONS, label: string, primary = false): string {
    return `<button type="button" class="phone-dock__btn${primary ? ' is-primary' : ''}" data-act="dock-pick" data-pick="${pick}">`
        + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DOCK_ICONS[pick]}</svg>`
        + `<span>${esc(label)}</span></button>`;
}

// ——— Finds (§4) ———

/** At most this many lines of a group on the screen; the rest says "and n more". */
export const FIND_GROUP_LINES = 3;
/** How long Finds stay in view before what they show counts as seen here. */
export const FINDS_SEEN_MS = 2000;
/** How far back "Show older finds" reads (the bridge goes no further). */
const FINDS_OLDER_DAYS = 31;
/** How much of Finds is to be in view (px; a shorter section: all of it) for them to count as seen. */
const FINDS_VIEW_PX = 96;

function isoMs(iso: string | null | undefined): number {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : NaN;
}

/** Whether a find is newer than the finds last seen here (nothing seen yet: every find is). */
export function findIsNew(at: string, seenAt: string | null): boolean {
    const t = isoMs(at);
    if (!Number.isFinite(t)) return false;
    const seen = isoMs(seenAt);
    return !Number.isFinite(seen) || t > seen;
}

/**
 * What the finds are asked since, by when they were last seen here: just after it (the bridge's window holds its
 * start, and what was seen is not new); nothing seen yet: null (the last 24 hours).
 */
export function findsWindowSince(seenAt: string | null): string | null {
    const t = isoMs(seenAt);
    return Number.isFinite(t) ? new Date(t + 1).toISOString() : null;
}

/** The newest moment of the finds (ISO), or '' when there is none. */
export function newestFindAt(finds: DeviceFinds | null | undefined): string {
    let best = '';
    let bestMs = -Infinity;
    for (const g of finds?.groups ?? []) {
        for (const at of [g.at, ...g.lines.map(l => l.at)]) {
            const t = isoMs(at);
            if (Number.isFinite(t) && t > bestMs) {
                bestMs = t;
                best = at;
            }
        }
    }
    return best;
}

/** The heading's quiet summary: since the finds were last seen here, or (nothing seen yet) the last 24 hours. */
export function phoneFindsSummary(seenAt: string | null, o: { lang: string; now?: number }): string {
    const r = strings.deviceResearch;
    const t = isoMs(seenAt);
    return Number.isFinite(t) ? r.findsSince(formatLiveClock(t, o.now ?? Date.now(), o.lang)) : r.findsDay;
}

/** A name with its years in brackets ("Jan Lhoták (1851–1919)", as the research writes it) without them. */
function withoutSpan(text: string, span: string | undefined): string {
    const tail = span ? ` (${span})` : '';
    return tail && text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}

/** A group's heading: a person or a family by its name (serif) with the years, sources and resolved by the app's words. */
export interface PhoneFindHead {
    name: string;
    years?: string;
    /** Sources and resolved: the app's own heading, sans-serif. */
    plain: boolean;
}

export function phoneFindHead(g: DeviceFindGroup): PhoneFindHead {
    const r = strings.deviceResearch;
    if (g.kind === 'sources') return { name: r.findsSources, plain: true };
    if (g.kind === 'resolved') return { name: r.findsResolved, plain: true };
    const name = g.kind === 'person' ? (g.name || withoutSpan(g.title ?? '', g.span)) : (g.title || g.name || '');
    // A family with its marriage place beside the years (K3.13; an older research sends none).
    const years = [g.span, g.kind === 'family' ? g.place : undefined].filter(Boolean).join(' · ');
    return { name, ...(years ? { years } : {}), plain: false };
}

/** What a line of finds says: a quiet prefix (its kind), the record's words, a quiet suffix ("· corrected"). */
export interface PhoneFindText {
    prefix?: string;
    text: string;
    suffix?: string;
}

export function phoneFindText(l: DeviceFindLine, g: DeviceFindGroup): PhoneFindText {
    const r = strings.deviceResearch;
    const head = phoneFindHead(g);
    const named = (): string => (head.plain ? '' : head.years ? `${head.name} · ${head.years}` : head.name);
    switch (l.kind) {
        case 'person':
        case 'family':
            return { prefix: r.findPerson, text: l.text || named() };
        case 'name':
            return { prefix: r.findName, text: l.text };
        case 'child': {
            const name = withoutSpan(l.text, l.span);
            return { prefix: r.findChild, text: l.span ? `${name} · ${l.span}` : name };
        }
        case 'fact':
        case 'fixed':
        case 'cited': {
            const text = l.fact?.what && l.fact.name ? `${l.fact.name} · ${l.fact.what}` : l.text;
            const suffix = l.kind === 'fixed' ? r.findFixed : l.kind === 'cited' ? r.findCited : undefined;
            return { text, ...(suffix ? { suffix } : {}) };
        }
        case 'source':
            // Under "New sources" the heading says it already.
            return g.kind === 'sources' ? { text: l.text } : { prefix: r.findSource, text: l.text };
        case 'conflict':
            return { prefix: r.findConflict, text: l.text };
        case 'hypothesis':
            return { prefix: r.findQuestion, text: l.text, ...(l.decided ? { suffix: r.findDecided(l.decided) } : {}) };
    }
}

/** A group's lines newest first: at most `max` of them, and how many more there are. */
export function phoneFindLines(g: DeviceFindGroup, max: number = FIND_GROUP_LINES): { lines: DeviceFindLine[]; more: number } {
    const sorted = [...g.lines].sort((a, b) => (isoMs(b.at) || 0) - (isoMs(a.at) || 0));
    return { lines: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

/** The groups newest first. */
export function phoneFindGroups(groups: readonly DeviceFindGroup[]): DeviceFindGroup[] {
    return [...groups].sort((a, b) => (isoMs(b.at) || 0) - (isoMs(a.at) || 0));
}

/**
 * The older finds read on "Show older finds" that the list does not show yet: only their lines before `before`
 * (the start of the window shown), each group's moment its newest such line; groups left with none go.
 */
export function olderFindGroups(older: DeviceFinds, before: string): DeviceFindGroup[] {
    const limit = isoMs(before);
    const out: DeviceFindGroup[] = [];
    for (const g of older.groups) {
        const lines = Number.isFinite(limit) ? g.lines.filter(l => isoMs(l.at) < limit) : g.lines;
        if (!lines.length) continue;
        out.push({ ...g, lines, at: newestFindAt({ since: '', groups: [{ ...g, at: '', lines }] }) || g.at });
    }
    return phoneFindGroups(out);
}

/** How many lines of `next` are newer than all of `prev` (the finds that came while the screen ran). */
export function findsArrived(prev: DeviceFinds | null | undefined, next: DeviceFinds | null | undefined): number {
    const last = isoMs(newestFindAt(prev));
    if (!Number.isFinite(last)) return 0;
    let n = 0;
    for (const g of next?.groups ?? []) for (const l of g.lines) if (isoMs(l.at) > last) n++;
    return n;
}

/** Since when the detail of a group counts its finds: the window shown when all its lines are in it, else its oldest line. */
export function findGroupSince(g: DeviceFindGroup, windowSince: string | null): string {
    const w = isoMs(windowSince);
    const oldest = g.lines.reduce((a, l) => (isoMs(l.at) < isoMs(a) || !a ? l.at : a), '');
    return Number.isFinite(w) && g.lines.every(l => isoMs(l.at) >= w) ? windowSince! : oldest;
}

// ——— Waiting (§5) ———

/** At most this many items of Waiting on the screen; the rest is in the Research overview ("n more"). */
export const PHONE_WAITING_MAX = 5;
/** How long an item answered here stays as a row ("Sent 14:41 · 1 photo") after the research no longer lists it. */
const WAITING_ANSWERED_KEEP_MS = 10 * 60_000;

/** What an item of Waiting is (its tag and its actions). */
export type PhoneWaitingKind = 'task' | 'branch' | 'hypothesis' | 'conflict';

/** An item's kind by what the research says of it (its kind or section, else its ID: T…, W-B-…, H…). */
export function phoneWaitingKind(w: Pick<DeviceGlanceWaiting, 'id' | 'kind' | 'section' | 'hypothesis'>): PhoneWaitingKind {
    const k = `${w.kind}|${w.section}`;
    if (w.hypothesis || /(^|\|)hypothesis(\||$)/.test(k) || /^H\d/.test(w.id)) return 'hypothesis';
    if (/(^|\|)branch(\||$)/.test(k) || w.id.startsWith('W-B-')) return 'branch';
    if (/(^|\|)conflict(\||$)/.test(k)) return 'conflict';
    return /^T\d/.test(w.id) ? 'task' : 'conflict';
}

/** The items shown (at most PHONE_WAITING_MAX) and how many more wait (`n`: all of them, the research's count). */
export function phoneWaitingShown<T>(items: readonly T[], n: number): { items: T[]; more: number } {
    const shown = items.slice(0, PHONE_WAITING_MAX);
    return { items: shown, more: Math.max(0, Math.max(n, items.length) - shown.length) };
}

/** The order of an item's actions by its kind; only those its `do` offers are drawn. */
const WAITING_ACTION_ORDER: Record<PhoneWaitingKind, readonly DeviceWaitingDo[]> = {
    task: ['answer', 'sent', 'unsent', 'retry'],
    branch: ['line', 'keep', 'never'],
    hypothesis: ['decide'],
    conflict: ['keep'],
};

/**
 * The actions of an item, only those its `do` offers, in the order of its kind: a task's Sent while it is to do,
 * Back to To do once sent, Retry with the agent when the research says it can go back; a hypothesis decided
 * here has none. `allows`: what this device may do (§6; absent: everything).
 */
export function phoneWaitingActions(w: Pick<DeviceGlanceWaiting, 'id' | 'kind' | 'section' | 'phase' | 'retry' | 'hypothesis' | 'do'>,
    o: { decided?: boolean; allows?: (d: DeviceWaitingDo) => boolean } = {}): DeviceWaitingDo[] {
    const kind = phoneWaitingKind(w);
    if (o.decided) return [];
    return WAITING_ACTION_ORDER[kind].filter((d) => {
        if (!w.do.includes(d)) return false;
        if (d === 'sent' && w.phase !== 'todo') return false;
        if (d === 'unsent' && w.phase !== 'sent') return false;
        if (d === 'retry' && !w.retry?.can) return false;
        return o.allows ? o.allows(d) : true;
    });
}

/** Whether an item is new here: after the finds last seen here; nothing seen yet, within the last 24 hours. */
export function waitingIsNew(at: string, seenAt: string | null, now: number = Date.now()): boolean {
    const t = isoMs(at);
    if (!Number.isFinite(t)) return false;
    const seen = isoMs(seenAt);
    return Number.isFinite(seen) ? t > seen : now - t < 24 * 3600_000;
}

/** A sent item's meta: "Sent 14:41 · 1 photo", without files "Sent 14:41". */
export function phoneWaitingSentMeta(t: string, files: number): string {
    const r = strings.deviceResearch;
    return files > 0 ? r.waitingSent(t, files) : r.waitingSentAt(t);
}

/** A version of a hypothesis as said ("version A"), or "no version holds" for none. */
function hypoChoiceText(p: { variant?: string; abandon?: true } | undefined): string {
    if (!p) return '';
    if (p.abandon) return strings.research.hypoNoneWord;
    return p.variant ? strings.deviceResearch.hypoVersion(p.variant) : '';
}

/** What a refused write of a task says at its row. */
function waitingRefusedText(r: WaitingWriteRefused | WaitingRetryRefused): string {
    const W = strings.live.waitingWrite;
    switch (r.code) {
        case 'busy': return W.busy;
        case 'locked': return W.locked;
        case 'app-only': return W.appOnly;
        case 'bad-body': case 'bad': return W.badBody;
        case 'not-sendable': return W.notSendable;
        case 'changed': return strings.live.waitingRetry.errChanged;
        case 'not': return strings.live.waitingRetry.errNot;
        case 'limit': return strings.live.waitingRetry.errNot;
        case 'held': return (r as WaitingWriteRefused).held?.said || W.writeFailed;
        case 'network': case 'down': case 'failed': return W.failed;
        default: return W.writeFailed;
    }
}

/** What a refused answer to a branch says at its row (as the overview's directions say it). */
function branchRefusedText(r: DirectionWriteRefused): string {
    const L = strings.live;
    switch (r.code) {
        case 'busy': return L.dirBusy;
        case 'network': return L.dirBridgeDown;
        case 'held': return r.held?.said || (r.reason ? L.dirNotSavedSaid(r.reason) : L.dirNotSaved);
        default: return r.reason ? L.dirNotSavedSaid(r.reason) : L.dirNotSaved;
    }
}

/** A stop asked here for a run, until the research says it finishes (or it is gone). */
const stopsAsked = new Set<string>();
/** A move of the order of work on its way (the list shown in it at once); null: none. */
let orderMoving: string[] | null = null;
/** The research refused the last write of the lines as being written just now: "linesBusy" until a write goes. */
let linesBusy = false;

/** What a write here did to an item of Waiting, shown until the research says the same (its next glance). */
interface WaitingHere {
    /** Marked sent (its moment) or back to do here. */
    phase?: 'todo' | 'sent';
    sentAt?: string;
    /** Answered here: when and with how many files (the row says "Sent 14:41 · 1 photo"). */
    answered?: { at: string; files: number };
    /** A hypothesis decided here: what holds ('' none said). */
    decided?: string;
    /** Done here (a branch answered, a task back to the agent, a conflict kept): the row goes. */
    gone?: boolean;
    /** The item as last seen, its place in the list (an answered one stays a while after the research drops it). */
    item: DeviceGlanceWaiting;
    index: number;
    /** When it was done here (ms). */
    set: number;
}
const waitingHere = new Map<string, WaitingHere>();
/** What each tree's last start from here asked (its sheet, its row's words): Try again asks the same. */
const startsAsked = new Map<string, DeviceAgentCtx>();
/** The starts' changes draw Now again (subscribed once). */
let startsWatched = false;
/** A write of an item on its way (its buttons wait). */
const waitingWriting = new Set<string>();
/** The research refused an item's last write: its quiet sentence at the row until a write of it goes. */
const waitingProblems = new Map<string, string>();

/** The finds' window of each tree for this page's life: since they were last seen when the screen first read them (null: the last 24 hours). */
const findsWindow = new Map<string, string | null>();
/** When the screen's tree's finds were last seen here: the dots "new" are of the finds after it. */
let findsSeen: string | null = null;
/** The tree `findsSeen` is of (null: not read yet). */
let findsSeenOf: string | null = null;
/** The older finds read on "Show older finds" (until the tree changes or the page goes). */
let olderFinds: { treeId: string; finds: DeviceFinds } | null = null;
let olderReading = false;
/** The lines of finds that came while the screen ran with Finds out of view ("n new ↓"). */
let findsCame = 0;
/** What the screen shows was read while it was seen: a later read's newer finds came while it ran. */
let readWhileShown = false;
let findsObserver: IntersectionObserver | null = null;
let findsInView = false;
let seenTimer: ReturnType<typeof setTimeout> | null = null;

/** The section's element shape (appendPhoneNow…). */
type PhoneSectionEl = { sec: HTMLElement; head: HTMLElement; sum: HTMLElement; body: HTMLElement };

/** A keyed child of a section's body: kept across live changes (only its texts change, nothing flashes). */
interface KeyedRow {
    key: string;
    make: () => HTMLElement;
    fill: (el: HTMLElement) => void;
}

/** The body's children by `rows` (each kept by its key, only its texts rewritten); anything else goes. */
function syncRows(body: HTMLElement, rows: readonly KeyedRow[]): void {
    const old = new Map<string, HTMLElement>();
    for (const c of Array.from(body.children) as HTMLElement[]) {
        if (c.dataset.key) old.set(c.dataset.key, c);
    }
    const next = rows.map((row) => {
        const el = old.get(row.key) ?? row.make();
        el.dataset.key = row.key;
        row.fill(el);
        return el;
    });
    const keep = new Set(next);
    for (const c of Array.from(body.children)) if (!keep.has(c as HTMLElement)) c.remove();
    next.forEach((el, i) => {
        if (body.children[i] !== el) body.insertBefore(el, body.children[i] ?? null);
    });
}

/** Text set only when it changed. */
function setText(el: Element | null, text: string): void {
    if (el && el.textContent !== text) el.textContent = text;
}

/** A quiet sentence as a keyed row. */
function quietRow(key: string, text: string, cls = 'phone-sec__quiet'): KeyedRow {
    return {
        key,
        make: () => {
            const p = document.createElement('p');
            p.className = cls;
            return p;
        },
        fill: el => setText(el, text),
    };
}

/** A row of Now or Lines: (number), glyph, name, task, meta, ⋯ (44 px). */
function makeLineRow(act: 'now-menu' | 'line-menu', numbered: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = `phone-line${numbered ? ' phone-line--num' : ''}`;
    row.dataset.act = act;
    row.innerHTML = `${numbered ? '<span class="phone-line__n"></span>' : ''}<span class="phone-line__glyph" aria-hidden="true"></span>`
        + '<div class="phone-line__main"><span class="phone-line__name"></span><span class="phone-line__task"></span>'
        + '<span class="phone-line__meta"><span class="phone-line__meta-text"></span><span class="phone-line__chip"></span></span></div>'
        + '<button type="button" class="phone-line__more" aria-haspopup="menu">⋯</button>';
    return row;
}

function fillLineRow(row: HTMLElement, o: { n?: number; way: DeviceWay; name: string; task?: string; meta: string; chip?: string; off?: boolean; menu: string; locked?: boolean }): void {
    if (o.n !== undefined) setText(row.querySelector('.phone-line__n'), String(o.n));
    setText(row.querySelector('.phone-line__glyph'), wayGlyph(o.way));
    setText(row.querySelector('.phone-line__name'), o.name);
    const task = row.querySelector<HTMLElement>('.phone-line__task');
    if (task) {
        setText(task, o.task ?? '');
        task.hidden = !o.task;
    }
    setText(row.querySelector('.phone-line__meta-text'), o.meta);
    const chip = row.querySelector<HTMLElement>('.phone-line__chip');
    if (chip) {
        setText(chip, o.chip ?? '');
        chip.hidden = !o.chip;
    }
    row.classList.toggle('is-off', !!o.off);
    const more = row.querySelector<HTMLButtonElement>('.phone-line__more');
    if (more && more.getAttribute('aria-label') !== o.menu) more.setAttribute('aria-label', o.menu);
    // Without the computer the line's actions are grey (§8 point 1): nothing is asked of the research.
    if (more) more.disabled = !!o.locked;
    row.classList.toggle('is-locked', !!o.locked);
    if (o.locked) row.setAttribute('aria-disabled', 'true');
    else row.removeAttribute('aria-disabled');
}

// ——— Waiting's rows (§5) ———

/** The answer's sheet of a task on the screen. */
const PHONE_ANSWER_ID = 'phone-waiting-answer';

function waitingHereKey(treeId: string, id: string): string {
    return `${treeId}|${id}`;
}

/** What a write did here to an item (shown at once, until the research says the same). */
function setWaitingHere(item: DeviceGlanceWaiting, what: Omit<WaitingHere, 'item' | 'index' | 'set'>): void {
    const treeId = phoneResearchTreeId();
    if (!treeId) return;
    const items = shownState?.glance?.waiting.items ?? [];
    const key = waitingHereKey(treeId, item.id);
    const was = waitingHere.get(key);
    const index = Math.max(0, items.findIndex(x => x.id === item.id));
    waitingHere.set(key, { ...what, item, index: was?.index ?? index, set: Date.now() });
}

/** Whether the research says what was done here (the overlay can go). */
function waitingSettled(item: DeviceGlanceWaiting, here: WaitingHere, now: number): boolean {
    if (now - here.set > WAITING_ANSWERED_KEEP_MS) return true;
    if (here.answered || here.gone || here.decided !== undefined) return false;
    return here.phase !== undefined && item.phase === here.phase;
}

/**
 * The items of Waiting as shown: the research's, each with what was done here; those done here (gone) left out;
 * an item answered here stays at its place a while after the research no longer lists it.
 */
function phoneWaitingList(g: DeviceGlance, treeId: string, now: number = Date.now()): { item: DeviceGlanceWaiting; here?: WaitingHere }[] {
    const ids = new Set(g.waiting.items.map(i => i.id));
    const out: { item: DeviceGlanceWaiting; here?: WaitingHere }[] = [];
    for (const item of g.waiting.items) {
        const key = waitingHereKey(treeId, item.id);
        let here = waitingHere.get(key);
        if (here && waitingSettled(item, here, now)) {
            waitingHere.delete(key);
            here = undefined;
        }
        if (!here?.gone) out.push(here ? { item, here } : { item });
    }
    for (const [key, here] of waitingHere) {
        if (!key.startsWith(`${treeId}|`) || ids.has(here.item.id)) continue;
        if (here.answered && now - here.set <= WAITING_ANSWERED_KEEP_MS) out.splice(Math.min(here.index, out.length), 0, { item: here.item, here });
        else waitingHere.delete(key);
    }
    return out;
}

/** How many items the research still lists that are done here (not counted in the heading). */
function phoneWaitingHidden(g: DeviceGlance, treeId: string): number {
    return g.waiting.items.filter(i => waitingHere.get(waitingHereKey(treeId, i.id))?.gone).length;
}

/** An item shown now by its ID. */
function phoneWaitingFind(id: string): { item: DeviceGlanceWaiting; here?: WaitingHere } | null {
    const g = shownState?.glance;
    const treeId = phoneResearchTreeId();
    if (!g || !treeId) return null;
    return phoneWaitingList(g, treeId).find(x => x.item.id === id) ?? null;
}

/** What a row of Waiting shows. */
/** A button of an item: an action through the bridge (`waiting-do`), or the agent started on the computer (`waiting-agent`). */
interface WaitingAct {
    do: DeviceWaitingDo | PhoneWaitingAgent;
    label: string;
    cls: string;
    /** The label with its mark (trusted markup), for the agent's buttons. */
    html?: string;
    act?: 'waiting-agent';
}

/** The agent's work on an item (§5, §10): a task talked over, a conflict left to the agent. */
export type PhoneWaitingAgent = 'discuss' | 'leave';

/** The agent's link of an item (null: not offered here): a task talked over (T…), a conflict left to the agent (X…). */
export function phoneWaitingAgentLink(tree: string | null, item: Pick<DeviceGlanceWaiting, 'id'>, what: PhoneWaitingAgent): string | null {
    if (what === 'discuss') {
        const task = researchTaskRef(item.id);
        return task ? phoneAgentLink(tree, 'task', { task, taskDo: 'chat' }) : null;
    }
    const conflict = researchConflictRef(item.id);
    return conflict ? phoneAgentLink(tree, 'conflict', { conflict, conflictDo: 'agent' }) : null;
}

/** The agent's button of an item, its label with the mark the computer gives it. */
function waitingAgentAct(what: PhoneWaitingAgent): WaitingAct {
    const label = what === 'discuss' ? strings.live.waitingTask.discuss : strings.research.leaveToAgent;
    const mark = what === 'discuss' ? researchLinkMark('task', { taskDo: 'chat' }) : researchLinkMark('conflict', { conflictDo: 'agent' });
    return { do: what, label, cls: 'is-outline is-agent', html: researchActionLabel(label, mark), act: 'waiting-agent' };
}

interface WaitingRowData {
    id: string;
    tag: string;
    isNew: boolean;
    text: string;
    /** Whom it is about (P…) and the name its link says. */
    person?: string;
    personName?: string;
    meta: string;
    /** The quiet sentence of what is decided on the computer (a conflict). */
    note?: string;
    acts: WaitingAct[];
    busy: boolean;
    /** Without the computer: its actions grey (§8 point 1). */
    locked?: boolean;
    problem?: string;
}

const WAITING_TAGS: Record<PhoneWaitingKind, () => string> = {
    task: () => strings.deviceResearch.kindTask,
    branch: () => strings.deviceResearch.kindBranch,
    hypothesis: () => strings.deviceResearch.kindHypothesis,
    conflict: () => strings.deviceResearch.kindConflict,
};

/** A button's words and look by the action. */
function waitingActLabel(d: DeviceWaitingDo): { label: string; cls: string } {
    const r = strings.deviceResearch;
    const L = strings.live;
    switch (d) {
        case 'answer': return { label: strings.research.answer, cls: 'is-outline' };
        case 'sent': return { label: L.waitingWrite.sent, cls: 'is-link' };
        case 'unsent': return { label: L.waitingWrite.unsent, cls: 'is-link' };
        case 'retry': return { label: L.waitingRetry.action, cls: 'is-outline' };
        case 'line': return { label: L.dirCreate, cls: 'is-outline' };
        case 'keep': return { label: r.waitingKeep, cls: 'is-outline' };
        case 'never': return { label: L.offModeCap.never, cls: 'is-link' };
        case 'decide': return { label: r.waitingDecide, cls: 'is-outline' };
    }
}

/** A row's data from the item and what was done here. */
function phoneWaitingRowData(item: DeviceGlanceWaiting, here: WaitingHere | undefined, o: {
    g: DeviceGlance; lang: string; now: number; seen: string | null; pc: string; allows: (d: DeviceWaitingDo) => boolean; locked?: boolean;
    /** The agent's link of the item (absent: none here, e.g. an archive). */
    agent?: (what: PhoneWaitingAgent) => string | null;
}): WaitingRowData {
    const r = strings.deviceResearch;
    const kind = phoneWaitingKind(item);
    const clock = (iso: string): string => formatLiveClock(Date.parse(iso), o.now, o.lang);
    const since = formatWaitingSince(Date.parse(item.at), o.now, o.lang, { justNow: strings.research.justNow, yesterday: strings.live.waitingSinceYesterday });
    const phase = here?.phase ?? item.phase;
    const sentAt = here?.phase === 'sent' ? here.sentAt : item.sentAt;
    const decided = here?.decided !== undefined;
    let meta: string;
    let personShown = true;
    if (here?.answered) {
        meta = phoneWaitingSentMeta(clock(here.answered.at), here.answered.files);
        personShown = false;
    } else if (decided) {
        meta = [r.waitingDecided, here!.decided].filter(Boolean).join(' · ');
    } else if (kind === 'task' && phase === 'sent') {
        meta = sentAt ? phoneWaitingSentMeta(clock(sentAt), 0) : strings.live.waitingWrite.sent;
        personShown = false;
    } else if (kind === 'hypothesis') {
        const proposed = hypoChoiceText(item.hypothesis?.proposal);
        meta = [proposed ? r.waitingProposal(proposed) : '', since].filter(Boolean).join(' · ');
    } else {
        meta = [kind === 'task' ? '' : item.on ?? '', since].filter(Boolean).join(' · ');
    }
    const person = personShown && item.person && o.g.people[item.person] ? item.person : undefined;
    const acts: WaitingAct[] = (here?.answered ? [] : phoneWaitingActions({ ...item, phase }, { decided, allows: o.allows }))
        .map(d => ({ do: d, ...waitingActLabel(d) }));
    // The agent's work beside the item's own actions, as on the computer (§5, §10): after Answer, after Keep.
    if (!here?.answered && !decided && o.agent) {
        const what: PhoneWaitingAgent | null = kind === 'task' && phase === 'todo' ? 'discuss' : kind === 'conflict' ? 'leave' : null;
        if (what && o.agent(what)) {
            const after = acts.findIndex(a => a.do === (what === 'discuss' ? 'answer' : 'keep'));
            acts.splice(after + 1, 0, waitingAgentAct(what));
        }
    }
    return {
        id: item.id,
        tag: WAITING_TAGS[kind](),
        isNew: !here && waitingIsNew(item.at, o.seen, o.now),
        text: item.what,
        ...(person ? { person, personName: o.g.people[person].name } : {}),
        meta,
        ...(kind === 'conflict' ? { note: phoneComputerOnlyNote('conflict', o.pc) ?? undefined } : {}),
        acts,
        busy: waitingWriting.has(item.id),
        locked: !!o.locked,
        ...(waitingProblems.has(item.id) ? { problem: waitingProblems.get(item.id) } : {}),
    };
}

/** A row of Waiting: tags, what waits, whom and since when, the quiet note, the actions, the refusal. */
function makeWaitingRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'phone-wait';
    row.innerHTML = '<div class="phone-wait__tags"><span class="phone-wait__tag"></span><span class="phone-wait__tag is-new"></span></div>'
        + '<p class="phone-wait__text"></p>'
        + '<div class="phone-wait__meta"><button type="button" class="phone-wait__person" data-act="waiting-person"></button><span class="phone-wait__meta-text"></span></div>'
        + '<p class="phone-wait__note"></p><div class="phone-wait__acts"></div><p class="phone-wait__problem" role="status"></p>';
    return row;
}

function fillWaitingRow(row: HTMLElement, d: WaitingRowData): void {
    row.dataset.id = d.id;
    const [tag, fresh] = Array.from(row.querySelectorAll<HTMLElement>('.phone-wait__tag'));
    setText(tag, d.tag);
    setText(fresh, strings.deviceResearch.findNew);
    fresh.hidden = !d.isNew;
    setText(row.querySelector('.phone-wait__text'), d.text);
    const person = row.querySelector<HTMLElement>('.phone-wait__person')!;
    setText(person, d.personName ?? '');
    person.hidden = !d.person;
    if (d.person) person.dataset.person = d.person;
    else delete person.dataset.person;
    setText(row.querySelector('.phone-wait__meta-text'), d.person && d.meta ? `· ${d.meta}` : d.meta);
    const note = row.querySelector<HTMLElement>('.phone-wait__note')!;
    setText(note, d.note ?? '');
    note.hidden = !d.note;
    const acts = row.querySelector<HTMLElement>('.phone-wait__acts')!;
    const sig = d.acts.map(a => `${a.do}:${a.label}`).join('|');
    if (acts.dataset.sig !== sig) {
        acts.dataset.sig = sig;
        acts.replaceChildren(...d.acts.map((a) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `phone-wait__btn ${a.cls}`;
            b.dataset.act = a.act ?? 'waiting-do';
            b.dataset.do = a.do;
            b.dataset.id = d.id;
            if (a.html) b.innerHTML = a.html;
            else b.textContent = a.label;
            return b;
        }));
    }
    acts.hidden = !d.acts.length;
    for (const b of Array.from(acts.children) as HTMLButtonElement[]) b.disabled = d.busy || !!d.locked;
    row.classList.toggle('is-busy', d.busy);
    const problem = row.querySelector<HTMLElement>('.phone-wait__problem')!;
    setText(problem, d.problem ?? '');
    problem.hidden = !d.problem;
}

/** A find's words into `el`: its quiet prefix, the record's words, its quiet suffix. */
function fillFindText(el: HTMLElement, t: PhoneFindText): void {
    const parts: Node[] = [];
    if (t.prefix) {
        const k = document.createElement('span');
        k.className = 'phone-find__k';
        k.textContent = t.prefix;
        parts.push(k, document.createTextNode(' '));
    }
    parts.push(document.createTextNode(t.text));
    if (t.suffix) {
        const k = document.createElement('span');
        k.className = 'phone-find__k';
        k.textContent = ` · ${t.suffix}`;
        parts.push(k);
    }
    el.replaceChildren(...parts);
}

/** A moment of the finds as Now says it: the time today, the day and time before. */
function findClock(iso: string, lang: string): string {
    const t = isoMs(iso);
    return Number.isFinite(t) ? formatLiveClock(t, Date.now(), lang) : '';
}

/** A group of finds on the screen (a button: its detail in a sheet): heading, time, at most three lines, "and n more". */
function findGroupRow(key: string, g: DeviceFindGroup, seenAt: string | null, older: boolean, dots = !older): KeyedRow {
    return {
        key,
        make: () => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'phone-find';
            b.dataset.act = 'find-group';
            b.setAttribute('aria-haspopup', 'dialog');
            return b;
        },
        fill: (b) => {
            const lang = getCurrentLanguage();
            const head = phoneFindHead(g);
            const { lines, more } = phoneFindLines(g);
            const shown = lines.map(l => ({ t: phoneFindText(l, g), fresh: dots && findIsNew(l.at, seenAt) }));
            const at = findClock(g.at, lang);
            const sig = JSON.stringify([head, at, shown, more, lang]);
            b.dataset.group = g.key;
            b.dataset.older = older ? '1' : '';
            if (b.dataset.sig === sig) return;
            b.dataset.sig = sig;
            const h = document.createElement('span');
            h.className = `phone-find__head${head.plain ? ' is-plain' : ''}`;
            const name = document.createElement('span');
            name.className = 'phone-find__name';
            name.textContent = head.name;
            h.append(name);
            if (head.years) {
                const years = document.createElement('span');
                years.className = 'phone-find__years';
                years.textContent = head.years;
                h.append(years);
            }
            const time = document.createElement('span');
            time.className = 'phone-find__at';
            time.textContent = at;
            h.append(time);
            const rows: HTMLElement[] = shown.map(({ t, fresh }) => {
                const line = document.createElement('span');
                line.className = 'phone-find__line';
                const dot = document.createElement('span');
                dot.className = `phone-find__dot${fresh ? ' is-new' : ''}`;
                if (fresh) {
                    dot.setAttribute('role', 'img');
                    dot.setAttribute('aria-label', strings.deviceResearch.findNew);
                } else dot.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.className = 'phone-find__text';
                fillFindText(text, t);
                line.append(dot, text);
                return line;
            });
            if (more) {
                const m = document.createElement('span');
                m.className = 'phone-find__more';
                m.textContent = strings.deviceResearch.findsGroupMore(more);
                rows.push(m);
            }
            b.replaceChildren(h, ...rows);
        },
    };
}

/** A quiet link-like button as a keyed row ("Show older finds"). */
/**
 * Now's row of a start from this device (10.3–10.7): the spinner while it starts, waiting at the computer in the
 * warning colour, not started with why (the error colour) and Try again, the conversation at the computer with
 * Close. Without the computer its buttons are grey (10.13).
 */
function phoneStartRowKeyed(m: PhoneStartRow, locked: boolean): KeyedRow {
    return {
        key: `start:${m.state}`,
        make: () => {
            const row = document.createElement('div');
            row.className = `phone-start is-${m.state}`;
            row.innerHTML = '<span class="phone-start__icon" aria-hidden="true"></span>'
                + '<div class="phone-line__main"><span class="phone-start__title"></span><span class="phone-start__sub"></span>'
                + '<span class="phone-start__why"></span></div>'
                + '<button type="button" class="phone-wait__btn is-link phone-start__btn"></button>';
            if (m.state === 'starting') {
                row.setAttribute('aria-busy', 'true');
                row.querySelector('.phone-start__icon')!.innerHTML = busySpinHtml(16);
            } else if (m.state === 'chat') row.querySelector('.phone-start__icon')!.innerHTML = '<span class="phone-dot is-on"></span>';
            row.querySelector('.phone-start__title')!.setAttribute('role', 'status');
            return row;
        },
        fill: (row) => {
            setText(row.querySelector('.phone-start__title'), m.title);
            const sub = row.querySelector<HTMLElement>('.phone-start__sub')!;
            setText(sub, m.sub);
            sub.hidden = !m.sub;
            const why = row.querySelector<HTMLElement>('.phone-start__why')!;
            setText(why, m.why);
            why.hidden = !m.why;
            const btn = row.querySelector<HTMLButtonElement>('.phone-start__btn')!;
            btn.hidden = !m.retry && !m.close;
            btn.dataset.act = m.retry ? 'agent-retry' : 'agent-close';
            setText(btn, m.retry ? strings.busy.retry : strings.buttons.close);
            btn.disabled = m.retry && locked;
        },
    };
}

function linkRow(key: string, act: string, text: string, busy: boolean, locked = false): KeyedRow {
    return {
        key,
        make: () => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'phone-sec__link';
            b.dataset.act = act;
            return b;
        },
        fill: (b) => {
            setText(b, text);
            b.toggleAttribute('aria-busy', busy);
            (b as HTMLButtonElement).disabled = busy || locked;
        },
    };
}

/** The scrolled part of the screen and the first kept element at its top (to keep it where it is across a render). */
function scrollAnchor(screen: HTMLElement): { box: HTMLElement; el: HTMLElement; top: number } | null {
    for (const box of Array.from(screen.querySelectorAll<HTMLElement>('[data-scroll]'))) {
        if (box.scrollTop <= 0 || box.scrollHeight <= box.clientHeight) continue;
        const top = box.getBoundingClientRect().top;
        for (const el of Array.from(box.querySelectorAll<HTMLElement>('.phone-sec__head, [data-key]'))) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.top >= top) return { box, el, top: r.top };
        }
    }
    return null;
}

/** What was under the finger stays there: rows put in above it move the scroll by as much (no overflow-anchor everywhere). */
function keepScrollAnchor(a: { box: HTMLElement; el: HTMLElement; top: number } | null): void {
    if (!a || !a.el.isConnected) return;
    const moved = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(moved) >= 1) a.box.scrollTop += moved;
}


export const phoneResearchMethods = uiModule({
    /** The Research screen is what is seen now. */
    phoneResearchActive(): boolean {
        return phoneResearchShown();
    },

    /**
     * At the device's start (and a tree chosen): on a phone whose research gives the screen's data (or whose last
     * state is held here), the screen instead of the tree — nothing downloaded. False: the tree opens as before.
     */
    async phoneResearchFirst(treeId: string): Promise<boolean> {
        if (!document.body.classList.contains('device-phone')) return false;
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), FEATURES_WAIT_MS) : undefined;
        let said: DeviceResearchFeatures | null = null;
        try {
            said = await readDeviceResearchFeatures(treeId, ctl?.signal ?? null);
        } catch { /* no connection: the state held here decides */ } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
        const held = said?.glance ? null : await heldResearchState(treeId).catch(() => null);
        if (!phoneScreenFor({ features: said, held: !!held })) return false;
        screenTreeId = treeId;
        features = said;
        if (held) shownState = held;
        if (this.deviceTreeHeldHere(treeId)) treesOpened.add(treeId);
        document.body.classList.add(PHONE_RESEARCH_READY);
        this.watchPhoneHistory();
        return true;
    },

    /** The Research screen shown (over the tree, which stays as it is): its data read again, the bar's Research marked. */
    showPhoneResearch(): void {
        if (!phoneResearchReady()) return;
        let screen = document.getElementById(PHONE_RESEARCH_ID);
        if (!screen) screen = this.buildPhoneResearch();
        if (!startsWatched) {
            startsWatched = true;
            // A start's state changed (the flow's answer, the 30 s without a proof): Now drawn again.
            onDeviceAgentStart((tree) => {
                if (phoneResearchShown() && tree === phoneResearchTreeId()) this.renderPhoneResearch();
            });
        }
        screen.hidden = false;
        document.body.classList.add(PHONE_RESEARCH_ON);
        this.placePhoneScreenLines();
        if (this.deviceDownKind()) void this.renderDeviceQline();
        this.syncPhoneBar();
        this.updateTreeSwitcher();
        readWhileShown = false;
        findsCame = 0;
        this.renderPhoneResearch();
        for (const k of ['main', 'a', 'b'] as const) {
            const el = screen.querySelector<HTMLElement>(`[data-scroll="${k}"]`);
            if (el) el.scrollTop = scrollKept[k];
        }
        this.watchPhoneResearchData();
        void this.refreshPhoneResearch();
    },

    /**
     * The quiet lines under the screen's header while it is seen: the home-screen icon's (§8 point 6) and, without
     * the computer, the one that says so (§8 point 1; the home line gives way to it meanwhile).
     */
    placePhoneScreenLines(): void {
        const screen = document.getElementById(PHONE_RESEARCH_ID);
        if (!screen || screen.hidden || !phoneResearchShown()) return;
        for (const id of ['device-home-line', 'device-qline']) {
            const line = document.getElementById(id);
            if (line && line.parentElement !== screen) screen.prepend(line);
        }
    },

    /** When the state the screen shows was read (null: none; undefined: the screen is not seen). */
    phoneResearchStateAt(): string | null | undefined {
        if (!phoneResearchShown()) return undefined;
        return shownState?.at ?? null;
    },

    /**
     * Unpaired (§8 point 4): the research's last state went with the pairing (forgetPairing) and the tree held here
     * with it (deviceForgetHeldTree): the screen forgets what it showed — "The research's state is not on this
     * device yet." and the dock, whose queue stays.
     */
    phoneResearchForget(): void {
        reading?.abort();
        reading = null;
        features = null;
        shownState = null;
        readFailed = false;
        treesOpened.clear();
        stopsAsked.clear();
        orderMoving = null;
        linesBusy = false;
        waitingHere.clear();
        waitingWriting.clear();
        waitingProblems.clear();
        findsWindow.clear();
        findsSeen = null;
        findsSeenOf = null;
        olderFinds = null;
        findsCame = 0;
        if (phoneResearchShown()) this.renderPhoneResearch();
    },

    /** The screen goes (the tree is seen): where it was scrolled kept, the live reads stopped. */
    hidePhoneResearch(): void {
        const screen = document.getElementById(PHONE_RESEARCH_ID);
        if (screen) {
            for (const k of ['main', 'a', 'b'] as const) {
                const el = screen.querySelector<HTMLElement>(`[data-scroll="${k}"]`);
                if (el) scrollKept[k] = el.scrollTop;
            }
            screen.hidden = true;
            for (const id of ['device-home-line', 'device-qline']) {
                const line = document.getElementById(id);
                if (line && line.parentElement === screen) document.body.append(line);
            }
        }
        document.body.classList.remove(PHONE_RESEARCH_ON);
        // The quiet line over the tree says what the tree shows (its copy, or none).
        if (this.deviceDownKind()) void this.renderDeviceQline();
        if (seenTimer) clearTimeout(seenTimer);
        seenTimer = null;
        unwatch?.();
        unwatch = null;
        reading?.abort();
        reading = null;
        this.syncPhoneBar();
        this.updateTreeSwitcher();
        this.updateViewModeUI();
    },

    /** The screen's frame: the columns, each section's heading and body, "Progress and queue ›", the dock. */
    buildPhoneResearch(): HTMLElement {
        const r = strings.deviceResearch;
        const screen = document.createElement('div');
        screen.id = PHONE_RESEARCH_ID;
        screen.className = 'phone-research';
        screen.setAttribute('role', 'region');
        screen.setAttribute('aria-label', r.researchTab);
        const sec = (key: PhoneSection): string => `
            <section class="phone-sec" data-sec="${key}" aria-labelledby="phone-sec-${key}">
                <h2 class="phone-sec__head"><span class="phone-sec__title" id="phone-sec-${key}"></span><span class="phone-sec__sum"></span></h2>
                <div class="phone-sec__body"></div>
            </section>`;
        const col = (c: 'a' | 'b'): string => PHONE_SECTIONS.filter(k => PHONE_COLUMNS[k] === c).map(sec).join('');
        screen.innerHTML = `
            <div class="phone-research__main" data-scroll="main">
                <div class="phone-finds-new" hidden><button type="button" class="phone-finds-new__btn" data-act="finds-new"><span class="phone-finds-new__pill"></span></button></div>
                <div class="phone-research__col phone-research__col--a" data-scroll="a">${col('a')}</div>
                <div class="phone-research__col phone-research__col--b" data-scroll="b">${col('b')}
                    <button type="button" class="phone-research__more" data-act="overview"><span class="phone-research__more-text"></span>${CHEVRON}</button>
                </div>
            </div>
            <div class="phone-dock" id="${PHONE_DOCK_ID}"></div>`;
        // Upright the sections stand one under the other in the order of §1 point 1 (Now, Waiting, Finds, Lines):
        // the columns are only the sideways layout's.
        screen.addEventListener('click', (e) => {
            const at = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
            const act = at?.dataset.act;
            // A grey row (without the computer) asks nothing.
            if (at?.getAttribute('aria-disabled') === 'true') return;
            if (act === 'overview') void this.phoneOpenOverview();
            else if (act === 'now-menu' && at) this.openPhoneNowMenu(Number(at.dataset.index));
            else if (act === 'line-menu' && at?.dataset.line) this.openPhoneLineMenu(at.dataset.line);
            else if (act === 'find-group' && at?.dataset.group) this.openPhoneFindGroup(at.dataset.group, at.dataset.older === '1');
            else if (act === 'finds-older') void this.phoneFindsOlder();
            else if (act === 'finds-new') this.phoneScrollToFinds();
            else if (act === 'waiting-do' && at?.dataset.id && at.dataset.do) this.phoneWaitingDo(at.dataset.id, at.dataset.do as DeviceWaitingDo);
            else if (act === 'waiting-agent' && at?.dataset.id && at.dataset.do) this.phoneWaitingAgent(at.dataset.id, at.dataset.do as PhoneWaitingAgent, at);
            else if (act === 'queue-work') this.phoneStartQueueWork(at ?? null);
            else if (act === 'agent-retry') this.phoneAgentRetry();
            else if (act === 'agent-close') this.phoneAgentClose();
            else if (act === 'waiting-person' && at?.dataset.person) void this.phoneOpenTree({ person: at.dataset.person });
            else if (act === 'waiting-more') void this.phoneOpenTree({ overview: 'waiting' });
            else if (act === 'dock-pick' && at?.dataset.pick) this.phoneDockPick(at.dataset.pick as 'camera' | 'gallery' | 'file');
            else if (act === 'dock-queue') this.phoneQueueOpen();
        });
        const tabbar = document.getElementById('bottom-bar');
        if (tabbar?.parentElement) tabbar.parentElement.insertBefore(screen, tabbar);
        else document.body.append(screen);
        const dock = screen.querySelector<HTMLElement>(`#${PHONE_DOCK_ID}`);
        if (dock && typeof ResizeObserver === 'function') {
            dockObserver?.disconnect();
            // The toasts stand over the dock (§7 point 2): its height for the stylesheet.
            dockObserver = new ResizeObserver(() => {
                document.documentElement.style.setProperty('--phone-dock-h', `${dock.offsetHeight}px`);
            });
            dockObserver.observe(dock);
        }
        const finds = screen.querySelector<HTMLElement>('.phone-sec[data-sec="finds"]');
        if (finds && typeof IntersectionObserver === 'function') {
            findsObserver?.disconnect();
            // Finds in view (enough of them, past the header and the dock's edge): seen after FINDS_SEEN_MS (§4).
            findsObserver = new IntersectionObserver((entries) => {
                for (const e of entries) {
                    findsInView = e.isIntersecting && e.intersectionRect.height >= Math.min(FINDS_VIEW_PX, e.boundingClientRect.height) - 1;
                }
                this.phoneFindsViewChanged();
            }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
            findsObserver.observe(finds);
        }
        return screen;
    },

    /** The screen drawn from what is known now (the state read last, or the one held here). */
    renderPhoneResearch(): void {
        const screen = document.getElementById(PHONE_RESEARCH_ID);
        if (!screen) return;
        const r = strings.deviceResearch;
        const more = screen.querySelector('.phone-research__more-text');
        if (more) more.textContent = r.moreOverview;
        const state = shownState;
        // Nothing known of the research: nothing of it to open either (8.2).
        const moreBtn = screen.querySelector<HTMLElement>('.phone-research__more');
        if (moreBtn) moreBtn.hidden = !state;
        const anchor = scrollAnchor(screen);
        away = this.deviceDownKind() !== null;
        screen.classList.toggle('is-down', readFailed);
        screen.classList.toggle('is-away', away);
        screen.classList.toggle('is-empty', !state);
        // The switcher's second line follows the screen's research (an archive: read-only, 3.6).
        this.refreshDeviceSwitcherLine();
        for (const key of PHONE_SECTIONS) {
            const el = sectionEl(screen, key);
            if (!el) continue;
            // Now and Lines keep their rows (a live change rewrites their texts only, §2 point 2).
            if (!state || !KEYED_SECTIONS.has(key)) el.body.replaceChildren();
            el.sum.textContent = '';
            el.sec.hidden = false;
            el.sec.classList.remove('is-none');
        }
        const now = sectionEl(screen, 'now');
        // Nothing known of the research yet (§8 point 2): one sentence, the dock under it.
        if (!state) {
            for (const key of PHONE_SECTIONS) {
                const el = sectionEl(screen, key);
                if (el) el.sec.hidden = key !== 'now';
            }
            if (now) {
                // One quiet sentence, no heading (8.2, 8.4).
                now.head.textContent = r.nowTitle;
                now.sec.classList.add('is-none');
                quiet(now.body, r.stateNotHere);
            }
            this.renderPhoneDock();
            this.syncFindsPill();
            return;
        }
        if (now) this.appendPhoneNow(now, state);
        const waiting = sectionEl(screen, 'waiting');
        if (waiting) this.appendPhoneWaiting(waiting, state);
        const finds = sectionEl(screen, 'finds');
        if (finds) this.appendPhoneFinds(finds, state);
        const lines = sectionEl(screen, 'lines');
        if (lines) this.appendPhoneLines(lines, state);
        this.renderPhoneDock();
        keepScrollAnchor(anchor);
        this.syncFindsPill();
        this.phoneFindsSeenLater();
    },

    /**
     * Now (§2): each line at work — its glyph, its name, the task, since when (paused: until when; stopping…), ⋯ —
     * and the last 24 hours in one quiet line. Nobody at work: "Nothing is being worked on now" and when it was
     * last; never: one sentence. A live change rewrites the rows' texts only. An archive has no Now (§8).
     */
    appendPhoneNow(el: PhoneSectionEl, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const g = state.glance;
        const lang = getCurrentLanguage();
        if (g?.tree.state === 'archive') {
            el.sec.hidden = true;
            el.body.replaceChildren();
            return;
        }
        const now = g?.now ?? [];
        setText(el.head, phoneNowTitle(now));
        // A stop asked is forgotten once its run finishes or is gone (the research says so).
        for (const run of [...stopsAsked]) {
            const known = g?.runs.find(x => x.id === run);
            const atWork = now.some(n => n.run === run);
            if (!atWork || known?.state === 'finishing') stopsAsked.delete(run);
        }
        const rows: KeyedRow[] = now.map((n, i) => {
            const line = n.line ? g?.lines.find(l => l.id === n.line) : undefined;
            // The queue's own run (10.4): "Queue · agent", the task under it.
            const queueRun = !line && !!n.run && g?.runs.find(x => x.id === n.run)?.line === null;
            const name = queueRun ? strings.deviceAgent.queueRunRow : line?.name || (n.person ? g?.people[n.person]?.name : '') || n.task?.text || '';
            const task = name === n.task?.text ? undefined : n.task?.text;
            const finishing = !!n.run && g?.runs.find(x => x.id === n.run)?.state === 'finishing';
            const stopping = !!n.run && (stopsAsked.has(n.run) || finishing);
            return {
                key: `now:${n.run ?? n.line ?? i}`,
                make: () => makeLineRow('now-menu', false),
                fill: (row: HTMLElement) => {
                    row.dataset.index = String(i);
                    fillLineRow(row, { way: n.way, name, task, meta: phoneNowMeta(n, { stopping, lang }), menu: strings.deviceResearch.lineActions, locked: away });
                    row.classList.toggle('is-stopping', stopping);
                },
            };
        });
        const idle = phoneNowIdle(g, { lang });
        if (idle?.kind === 'never') rows.push(quietRow('never', r.neverWorked));
        else if (idle?.kind === 'idle') {
            rows.push({
                key: 'idle',
                make: () => {
                    const box = document.createElement('div');
                    box.className = 'phone-now-idle';
                    box.innerHTML = '<span class="phone-dot is-ring" aria-hidden="true"></span>'
                        + '<div class="phone-line__main"><span class="phone-line__name"></span><span class="phone-line__meta"></span></div>';
                    return box;
                },
                fill: (box) => {
                    setText(box.querySelector('.phone-line__name'), strings.live.nothingAtWork);
                    setText(box.querySelector('.phone-line__meta'), idle.last);
                },
            });
        }
        const treeId = phoneResearchTreeId();
        const start = treeId ? deviceAgentStartOf(treeId) : null;
        const startRow = phoneStartRow(start, computerName());
        if (startRow) rows.push(phoneStartRowKeyed(startRow, away));
        if (g?.day) rows.push(quietRow('day', r.dayLine(g.day.persons, g.day.sources, g.day.saves), 'phone-sec__day'));
        // "Work on the queue…" under Now (§2 point 6, §10): AI + the terminal, as on the computer; grey without it.
        const queueLink = phoneAgentLink(treeId, 'work', { workDo: 'loop' });
        if (phoneQueueWorkOffered(g ?? null, start, queueLink)) {
            rows.push({
                key: 'queue-work',
                make: () => {
                    const box = document.createElement('div');
                    box.className = 'phone-now-acts';
                    box.innerHTML = '<button type="button" class="phone-wait__btn is-link phone-now-work" data-act="queue-work" aria-haspopup="dialog"></button>';
                    return box;
                },
                fill: (box) => {
                    const b = box.querySelector<HTMLButtonElement>('button')!;
                    b.innerHTML = researchActionLabel(strings.live.queueWork, researchLinkMark('work'));
                    b.disabled = away;
                },
            });
        }
        syncRows(el.body, rows);
    },

    /**
     * Waiting (§5): at most PHONE_WAITING_MAX items, then "n more" to the Research overview's Waiting. Each item: its
     * kind's tag (and "new"), what waits, whom and since when, and only the actions its `do` offers (44 px, through
     * the bridge, no mark; nothing that starts an agent). A write shows at once and keeps the row (its texts change,
     * nothing flashes); a refusal says the research's quiet sentence at the row. Nothing waits: the section's
     * heading goes, one quiet sentence stays.
     */
    appendPhoneWaiting(el: PhoneSectionEl, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const g = state.glance;
        const treeId = phoneResearchTreeId() ?? '';
        const list = g ? phoneWaitingList(g, treeId) : [];
        const n = Math.max(0, (g?.waiting.n ?? 0) - (g ? phoneWaitingHidden(g, treeId) : 0));
        setText(el.head, r.waitingTitle(n));
        el.sec.dataset.count = String(n);
        const none = !n && !list.length;
        el.sec.classList.toggle('is-none', none);
        if (none) {
            syncRows(el.body, [quietRow('none', r.waitingNone)]);
            return;
        }
        const shown = phoneWaitingShown(list, n);
        const lang = getCurrentLanguage();
        const now = Date.now();
        const seen = treeId ? findsWindow.get(treeId) ?? null : null;
        const pc = computerName();
        // An archive is read only (3.6): what waits is shown without its actions.
        const archive = g?.tree.state === 'archive';
        const allows = (d: DeviceWaitingDo): boolean => !archive && researchDeviceAllows(d === 'decide' ? 'hypothesis' : 'waiting-answer');
        const rows: KeyedRow[] = shown.items.map(({ item, here }) => ({
            key: `w:${item.id}`,
            make: makeWaitingRow,
            fill: (row: HTMLElement) => fillWaitingRow(row, phoneWaitingRowData(item, here, {
                g: g!, lang, now, seen, pc, allows, locked: away,
                ...(archive ? {} : { agent: (what: PhoneWaitingAgent) => phoneWaitingAgentLink(treeId, item, what) }),
            })),
        }));
        if (shown.more) {
            rows.push({
                key: 'more',
                make: () => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'phone-wait-more';
                    b.dataset.act = 'waiting-more';
                    b.innerHTML = `<span class="phone-wait-more__text"></span>${CHEVRON}`;
                    return b;
                },
                fill: (b: HTMLElement) => setText(b.querySelector('.phone-wait-more__text'), r.waitingMore(shown.more)),
            });
        }
        syncRows(el.body, rows);
    },

    /** An action of an item of Waiting (its `do`). */
    phoneWaitingDo(id: string, d: DeviceWaitingDo): void {
        const found = phoneWaitingFind(id);
        if (!found || away || shownState?.glance?.tree.state === 'archive') return;
        const { item } = found;
        const kind = phoneWaitingKind(item);
        const L = strings.live;
        if (d === 'answer') {
            this.openPhoneWaitingAnswer(item);
            return;
        }
        if (d === 'decide') {
            this.openPhoneHypothesis(item);
            return;
        }
        if (d === 'sent' || d === 'unsent') {
            void this.phoneWaitingWrite(item, async (base) => {
                const res = await postWaitingSent(base, item.id, d);
                return res.ok ? { ok: true } : res.code === 'none' ? { ok: false, none: true } : { ok: false, text: waitingRefusedText(res) };
            }, () => setWaitingHere(item, d === 'sent' ? { phase: 'sent', sentAt: new Date().toISOString() } : { phase: 'todo' }));
            return;
        }
        if (d === 'retry') {
            void this.phoneWaitingWrite(item, async (base) => {
                const res = await retryWaiting(base, item.id, { expect: item.at });
                return res.ok ? { ok: true } : res.code === 'none' ? { ok: false, none: true } : { ok: false, text: waitingRefusedText(res) };
            }, () => {
                setWaitingHere(item, { gone: true });
                const working = !!shownState?.glance?.now.length;
                this.showToast(working ? L.waitingRetry.doneRunning : L.waitingRetry.doneIdle, 6000);
            });
            return;
        }
        if (kind === 'branch' && (d === 'line' || d === 'keep' || d === 'never')) {
            void this.phoneWaitingWrite(item, async (base) => {
                const res = await answerBranchWaiting(base, item.id, d);
                return res.ok ? { ok: true } : res.code === 'none' ? { ok: false, none: true } : { ok: false, text: branchRefusedText(res) };
            }, () => {
                setWaitingHere(item, { gone: true });
                this.showToast(d === 'line' ? L.dirToastAdded : d === 'never' ? L.dirToastBranchOff : L.dirToastSaved, 6000);
            });
            return;
        }
        if (kind === 'conflict' && d === 'keep') {
            void this.phoneWaitingWrite(item, async (base) => {
                const res = await researchBridgeWrite(base, 'POST', `waiting/${encodeURIComponent(item.id)}`, { do: 'keep' }, () => ({}));
                return res.ok ? { ok: true } : res.code === 'none' ? { ok: false, none: true } : { ok: false, text: branchRefusedText(res) };
            }, () => setWaitingHere(item, { gone: true }));
        }
    },

    /**
     * One write of an item through the bridge: its buttons wait meanwhile; taken, `done` says what changed here (the
     * row at once) and the research is read again; gone meanwhile (404), the row goes; refused, the quiet sentence at
     * the row until a write of it goes.
     */
    async phoneWaitingWrite(item: DeviceGlanceWaiting, write: (base: string) => Promise<{ ok: boolean; none?: boolean; text?: string }>,
        done: () => void): Promise<boolean> {
        const treeId = phoneResearchTreeId();
        if (!treeId || waitingWriting.has(item.id)) return false;
        waitingWriting.add(item.id);
        waitingProblems.delete(item.id);
        this.renderPhoneResearch();
        let res: { ok: boolean; none?: boolean; text?: string };
        try {
            res = await write(deviceBridgeBase(treeId));
        } finally {
            waitingWriting.delete(item.id);
        }
        if (res.ok) done();
        else if (res.none) setWaitingHere(item, { gone: true });
        else waitingProblems.set(item.id, res.text || strings.live.waitingWrite.failed);
        this.renderPhoneResearch();
        if (res.ok || res.none) void this.refreshPhoneResearch();
        return res.ok;
    },

    /**
     * Decide… of a hypothesis (§5, 5.4): its versions ("Version A holds", the claim, the agent's proposal at its
     * version), No version holds, Leave open and As the agent proposes, each through the gateway's own
     * `device/hypothesis/<H>`. Decided: "Decided in the research" at the row, its buttons gone.
     */
    openPhoneHypothesis(item: DeviceGlanceWaiting): void {
        const r = strings.deviceResearch;
        const R = strings.research;
        const h = item.hypothesis;
        const proposal = h?.proposal;
        const rows: { label: string; run: () => void; sub?: string; id?: string }[] = [];
        for (const v of h?.variants ?? []) {
            const sub = [v.claim, proposal?.variant === v.label ? r.agentProposal : ''].filter(Boolean).join(' · ');
            rows.push({ label: r.hypoHolds(v.label), sub, id: `phone-hypo-${v.label}`, run: () => { void this.phoneDecideHypothesis(item, 'decide', v.label); } });
        }
        rows.push({ label: R.hypoNone, id: 'phone-hypo-none', run: () => { void this.phoneDecideHypothesis(item, 'abandon'); } });
        rows.push({ label: R.hypoLeave, id: 'phone-hypo-open', run: () => { void this.phoneDecideHypothesis(item, 'keep-open'); } });
        if (proposal && (proposal.variant || proposal.abandon)) {
            rows.push({ label: r.hypoByProposal, sub: hypoChoiceText(proposal), id: 'phone-hypo-proposed', run: () => { void this.phoneDecideHypothesis(item, 'proposed'); } });
        }
        const since = formatWaitingSince(Date.parse(item.at), Date.now(), getCurrentLanguage(), { justNow: R.justNow, yesterday: strings.live.waitingSinceYesterday });
        this.presentMenuSheet(item.what, [{ rows }], { subtitle: `${r.kindHypothesis} · ${since}`, overlayClass: 'phone-sheet-overlay' });
    },

    /** A hypothesis decided through the gateway (`device/hypothesis/<H>`); decided already elsewhere: said, the row goes. */
    async phoneDecideHypothesis(item: DeviceGlanceWaiting, what: DeviceHypothesisDo, variant?: string): Promise<void> {
        const D = strings.device;
        const body = deviceHypothesisBody(what, variant);
        if (!body || !researchDeviceAllows('hypothesis')) return;
        let gone = false;
        const ok = await this.phoneWaitingWrite(item, async (base) => {
            const res = await researchBridgeWrite(base, 'POST', `device/hypothesis/${encodeURIComponent(item.id)}`, body, () => ({}));
            if (res.ok) return { ok: true };
            gone = res.status === 409 && res.errorCode === 'hypothesis.gone';
            return gone ? { ok: false, none: true } : { ok: false, text: D.hypoFailed };
        }, () => {
            const holds = what === 'decide' ? { variant } : what === 'abandon' ? { abandon: true as const } : what === 'proposed' ? item.hypothesis?.proposal : undefined;
            if (what === 'keep-open') setWaitingHere(item, { gone: true });
            else setWaitingHere(item, { decided: hypoChoiceText(holds) });
        });
        if (ok) this.showToast(D.hypoDecided, 3000);
        else if (gone) this.showToast(D.hypoGone, 3000);
    },

    /**
     * Answer of a task (§5, 5.2) on the screen: the answer's form full screen (the tree's sheet needs the tree; this
     * one only the bridge), Take photo / From gallery / File for the task, "Send answer". The files go to the task
     * first, then the answer; taken, the row says "Sent 14:41 · 1 photo".
     */
    openPhoneWaitingAnswer(item: DeviceGlanceWaiting): void {
        const treeId = phoneResearchTreeId();
        if (!treeId || !researchDeviceAllows('waiting-answer')) return;
        document.getElementById(PHONE_ANSWER_ID)?.remove();
        const T = strings.live.waitingTask;
        const r = strings.deviceResearch;
        const R = strings.research;
        const node = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
            const n = document.createElement(tag);
            n.className = cls;
            if (text !== undefined) n.textContent = text;
            return n;
        };
        const sheet = node('div', 'modal-overlay active waiting-answer-sheet phone-answer');
        sheet.id = PHONE_ANSWER_ID;
        sheet.dataset.id = item.id;
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-labelledby', `${PHONE_ANSWER_ID}-title`);
        const head = node('div', 'waiting-answer-sheet__head');
        const cancel = node('button', 'waiting-answer-sheet__cancel', T.cancel);
        cancel.type = 'button';
        const title = node('h2', 'waiting-answer-sheet__title', R.answer);
        title.id = `${PHONE_ANSWER_ID}-title`;
        head.append(cancel, title, node('span', 'phone-answer__spacer'));
        const what = node('p', 'waiting-answer-sheet__task', item.what);
        const person = item.person ? shownState?.glance?.people[item.person]?.name : '';
        const since = formatWaitingSince(Date.parse(item.at), Date.now(), getCurrentLanguage(), { justNow: R.justNow, yesterday: strings.live.waitingSinceYesterday });
        const meta = node('p', 'phone-answer__meta', [r.kindTask, person, since].filter(Boolean).join(' · '));
        const body = node('div', 'waiting-answer-sheet__body');
        const files: File[] = [];
        let sentFiles = 0;
        const filesHead = node('p', 'phone-answer__files-head');
        const filesList = node('ul', 'phone-answer__files');
        const drawFiles = (): void => {
            filesHead.textContent = r.answerFiles(files.length);
            filesHead.hidden = !files.length;
            filesList.replaceChildren(...files.map(f => node('li', 'phone-answer__file', f.name || r.file)));
            filesList.hidden = !files.length;
        };
        const pick = (label: string, cls: string, accept: string, capture: boolean): HTMLElement => {
            const lab = node('label', `phone-answer__pick ${cls}`);
            const input = node('input', 'phone-answer__input');
            input.type = 'file';
            input.accept = accept;
            if (capture) input.setAttribute('capture', 'environment');
            else input.multiple = true;
            input.addEventListener('change', () => {
                for (const f of Array.from(input.files ?? [])) if (waitingFileTaken(f)) files.push(f);
                input.value = '';
                drawFiles();
            });
            lab.append(input, node('span', 'phone-answer__pick-text', label));
            return lab;
        };
        const picks = node('div', 'phone-answer__picks');
        picks.append(pick(T.takePhoto, 'is-wide', 'image/*', true), pick(T.fromGallery, '', 'image/*', false), pick(r.file, '', WAITING_FILE_ACCEPT, false));
        const send = node('button', 'phone-answer__send', T.answerSend);
        send.type = 'button';
        const foot = node('div', 'phone-answer__foot');
        foot.append(send);
        const close = (): void => {
            form.keepDraftNow();
            sheet.remove();
        };
        const form: WaitingAnswerForm = new WaitingAnswerForm({
            treeId, task: item.id, idPrefix: `phone-answer-${item.id}`, buttons: false,
            send: async (text): Promise<WaitingAnswerOutcome> => {
                const base = deviceBridgeBase(treeId);
                // The files first (each once), then the answer: an answer never goes without what it speaks of.
                while (sentFiles < files.length) {
                    const res = await putWaitingFile(base, item.id, files[sentFiles]);
                    if (!res.ok) return res.code === 'busy' || res.code === 'locked' ? 'busy' : res.code === 'none' ? 'gone' : 'fail';
                    sentFiles++;
                }
                const res = await answerWaiting(base, item.id, { text, expect: item.at });
                if (res.ok) {
                    setWaitingHere(item, { answered: { at: new Date().toISOString(), files: sentFiles } });
                    this.showToast(T.answerSaved, 6000);
                    return 'saved';
                }
                switch (res.code) {
                    case 'none': setWaitingHere(item, { gone: true }); return 'gone';
                    case 'changed': return 'changed';
                    case 'no-answer': return 'no-answer';
                    case 'busy': case 'locked': return 'busy';
                    default: return 'fail';
                }
            },
            cancel: close,
            done: () => {
                sheet.remove();
                this.renderPhoneResearch();
                void this.refreshPhoneResearch();
            },
            onChange: (f) => {
                send.setAttribute('aria-disabled', String(!f.canSend));
                send.textContent = f.error ? T.retry : T.answerSend;
                send.classList.toggle('is-sending', f.sending);
            },
        });
        cancel.onclick = () => form.cancel();
        send.onclick = () => {
            if (send.getAttribute('aria-disabled') === 'true') return;
            void form.submit();
        };
        sheet.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                form.cancel();
            }
        });
        body.append(meta, form.root, filesHead, filesList, picks);
        sheet.append(head, what, body, foot);
        drawFiles();
        document.body.append(sheet);
        send.setAttribute('aria-disabled', String(!form.canSend));
        form.focus();
    },

    /**
     * Finds (§4): since they were last seen here (or the last 24 hours), the groups newest first — a person or a
     * family by its name and years, new sources, resolved — each with its time, at most three lines (a dot for what
     * came since they were last seen) and "and n more"; a tap shows the whole group. Under them the older finds once
     * asked for, "and n more in the overview" when the research cut the list, "Show older finds" when there are any.
     */
    appendPhoneFinds(el: PhoneSectionEl, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        setText(el.head, r.findsTitle);
        const treeId = phoneResearchTreeId();
        const finds = state.finds;
        if (finds) setText(el.sum, phoneFindsSummary(treeId ? findsWindow.get(treeId) ?? null : null, { lang: getCurrentLanguage() }));
        // Until it is known when they were last seen here, no dots (none flash and go).
        const known = !!treeId && findsSeenOf === treeId;
        const rows: KeyedRow[] = phoneFindGroups(finds?.groups ?? []).map(g => findGroupRow(`find:${g.key}`, g, findsSeen, false, known));
        if (!rows.length) rows.push(quietRow('none', r.findsNone));
        const older = olderFinds && olderFinds.treeId === treeId && finds ? olderFinds.finds : null;
        if (older && finds) rows.push(...olderFindGroups(older, finds.since).map(g => findGroupRow(`old:${g.key}`, g, null, true)));
        const cut = older ? older.cut : finds?.cut;
        if (cut) rows.push(quietRow('cut', r.findsCut(cut)));
        if (finds?.earlier && !older) rows.push(linkRow('older', 'finds-older', r.findsOlder, olderReading, away));
        syncRows(el.body, rows);
    },

    /** A group of finds tapped: its detail (§4 point 2). */
    openPhoneFindGroup(key: string, older: boolean): void {
        const treeId = phoneResearchTreeId();
        const finds = shownState?.finds;
        const pool = older
            ? (olderFinds && olderFinds.treeId === treeId && finds ? olderFindGroups(olderFinds.finds, finds.since) : [])
            : finds?.groups ?? [];
        const g = pool.find(x => x.key === key);
        if (g) this.showFindGroupSheet(g, older);
    },

    /**
     * The detail of a group of finds in a sheet from below: all its lines with their times, "n finds since t"; a
     * person (or a family by its first partner) with "Show in the tree", which opens the tree on that person (§7).
     * Sources have no "Open in the Research overview": the overview needs the tree.
     */
    showFindGroupSheet(g: DeviceFindGroup, older = false): void {
        const lang = getCurrentLanguage();
        const head = phoneFindHead(g);
        const treeId = phoneResearchTreeId();
        const list = document.createElement('div');
        list.className = 'phone-find-sheet';
        for (const l of phoneFindLines(g, Infinity).lines) {
            const row = document.createElement('div');
            row.className = 'phone-find-sheet__row';
            const text = document.createElement('span');
            text.className = 'phone-find-sheet__text';
            fillFindText(text, phoneFindText(l, g));
            const at = document.createElement('span');
            at.className = 'phone-find-sheet__at';
            at.textContent = findClock(l.at, lang);
            row.append(text, at);
            list.append(row);
        }
        const rows: { label: string; id?: string; run: () => void }[] = [];
        const person = g.person;
        if (person) rows.push({ label: strings.live.showInTree, id: 'phone-find-tree', run: () => { void this.phoneOpenTree({ person }); } });
        const since = findGroupSince(g, older || !treeId ? null : findsWindow.get(treeId) ?? null);
        this.presentMenuSheet(head.name, [{ rows, content: list }], {
            titleAside: head.years,
            subtitle: strings.deviceResearch.findsDetailSub(g.lines.length, findClock(since, lang)),
            overlayClass: `phone-sheet-overlay phone-find-overlay${head.plain ? ' is-plain' : ''}`,
        });
    },

    /** "Show older finds" (§4 point 3): the finds of the last 31 days read, those before the list's shown under it. */
    async phoneFindsOlder(): Promise<void> {
        const treeId = phoneResearchTreeId();
        if (!treeId || olderReading || !shownState?.finds || away) return;
        olderReading = true;
        this.renderPhoneResearch();
        try {
            const since = new Date(Date.now() - FINDS_OLDER_DAYS * 24 * 3600_000).toISOString();
            const older = await readFinds(treeId, { since, lang: getCurrentLanguage() });
            if (older && phoneResearchTreeId() === treeId) olderFinds = { treeId, finds: older };
        } catch { /* no connection: the link stays for another try */ } finally {
            olderReading = false;
        }
        if (phoneResearchShown()) this.renderPhoneResearch();
    },

    /** "n new ↓": its count while finds came with Finds out of view, hidden otherwise. */
    syncFindsPill(): void {
        const wrap = document.querySelector<HTMLElement>(`#${PHONE_RESEARCH_ID} .phone-finds-new`);
        if (!wrap) return;
        const show = findsCame > 0 && !findsInView && phoneResearchShown();
        wrap.hidden = !show;
        if (show) setText(wrap.querySelector('.phone-finds-new__pill'), strings.deviceResearch.findsNew(findsCame));
    },

    /** "n new ↓" tapped: Finds scrolled into view. */
    phoneScrollToFinds(): void {
        const sec = document.querySelector<HTMLElement>(`#${PHONE_RESEARCH_ID} .phone-sec[data-sec="finds"]`);
        findsCame = 0;
        this.syncFindsPill();
        sec?.scrollIntoView({ block: 'start' });
    },

    /** Finds came into view or went out of it: "n new ↓" goes once they are seen, the 2 s of "seen" start or stop. */
    phoneFindsViewChanged(): void {
        if (findsInView) findsCame = 0;
        this.syncFindsPill();
        this.phoneFindsSeenLater();
    },

    /**
     * Finds in view with something new among them: after FINDS_SEEN_MS still in view, what they show counts as seen
     * here (`markFindsSeen` with their newest moment) and the dots go. The heading's "since" moves on the next start.
     */
    phoneFindsSeenLater(): void {
        const treeId = phoneResearchTreeId();
        const newest = newestFindAt(shownState?.finds);
        const unseen = !!treeId && findsSeenOf === treeId && !!newest && findIsNew(newest, findsSeen);
        if (!findsInView || !phoneResearchShown() || !unseen) {
            if (seenTimer) clearTimeout(seenTimer);
            seenTimer = null;
            return;
        }
        if (seenTimer) return;
        seenTimer = setTimeout(() => {
            seenTimer = null;
            const now = phoneResearchTreeId();
            const at = newestFindAt(shownState?.finds);
            if (!findsInView || !phoneResearchShown() || !now || now !== treeId || !at || !findIsNew(at, findsSeen)) return;
            findsSeen = at;
            void markFindsSeen(now, at).catch(() => undefined);
            this.renderPhoneResearch();
        }, FINDS_SEEN_MS);
    },

    /**
     * Lines (§3) in the order of work: number, glyph, name, tasks, "paused" / "ended", ⋯ (the row too) for the
     * line's actions. A move shows at once; a refusal puts the row back and says "linesBusy" under the list until
     * a write goes. None: one sentence. An archive has no Lines (§8).
     */
    appendPhoneLines(el: PhoneSectionEl, state: DeviceResearchState): void {
        const r = strings.deviceResearch;
        const g = state.glance;
        setText(el.head, r.linesTitle);
        if (g?.tree.state === 'archive') {
            el.sec.hidden = true;
            el.body.replaceChildren();
            return;
        }
        const lines = linesInOrder(g?.lines ?? [], orderMoving);
        const rows: KeyedRow[] = lines.map(l => ({
            key: `line:${l.id}`,
            make: () => makeLineRow('line-menu', true),
            fill: (row: HTMLElement) => {
                row.dataset.line = l.id;
                const chip = l.state === 'paused' ? strings.live.dirPausedChip('') : l.state === 'done' ? r.lineEnded : undefined;
                fillLineRow(row, {
                    n: l.n, way: l.way, name: l.name, meta: l.state === 'done' ? '' : r.lineMeta(l.tasks), chip,
                    off: l.state !== 'active', menu: strings.deviceResearch.lineActions, locked: away,
                });
            },
        }));
        if (!lines.length) rows.push(quietRow('none', r.linesNone));
        if (linesBusy) rows.push(quietRow('busy', r.linesBusy, 'phone-sec__quiet phone-sec__warn'));
        syncRows(el.body, rows);
    },

    /** The ⋯ of a row of Now (§2 point 3): Show in the tree, Line actions…, Stop run (with its confirmation). */
    openPhoneNowMenu(index: number): void {
        const g = shownState?.glance;
        const n = g?.now[index];
        if (!g || !n || away) return;
        const r = strings.deviceResearch;
        const L = strings.live;
        const line = n.line ? g.lines.find(l => l.id === n.line) : undefined;
        const name = line?.name || (n.person ? g.people[n.person]?.name : '') || n.task?.text || '';
        const stopping = !!n.run && (stopsAsked.has(n.run) || g.runs.find(x => x.id === n.run)?.state === 'finishing');
        const person = n.person ?? line?.focus;
        const rows: { label: string; run: () => void; danger?: boolean; sub?: string; id?: string }[] = [];
        if (person) rows.push({ label: L.showInTree, id: 'phone-now-tree', run: () => { void this.phoneOpenTree({ person }); } });
        if (line) rows.push({ label: `${r.lineActions}…`, id: 'phone-now-line', run: () => this.openPhoneLineMenu(line.id) });
        if (n.run && !stopping && researchDeviceAllows('run-stop')) {
            const run = n.run;
            rows.push({ label: L.stopRun, sub: r.stopSub(computerName()), danger: true, id: 'phone-now-stop', run: () => { void this.phoneStopRun(run, name); } });
        }
        if (!rows.length) return;
        const sub = [name === n.task?.text ? '' : n.task?.text ?? '', phoneNowMeta(n, { stopping, lang: getCurrentLanguage() })].filter(Boolean).join(' · ');
        this.presentMenuSheet(name, [{ rows }], { subtitle: sub, overlayClass: 'phone-sheet-overlay' });
    },

    /** Stop run (§2 point 3): asked first (as on the computer), then through the bridge; "stopping…" until it finishes. */
    async phoneStopRun(runId: string, lineName: string): Promise<void> {
        const r = strings.deviceResearch;
        const treeId = phoneResearchTreeId();
        if (!treeId || stopsAsked.has(runId) || !researchDeviceAllows('run-stop')) return;
        const pc = computerName();
        const ok = await this.showConfirm(r.stopText(pc), r.stopAsk(lineName), { confirmLabel: strings.live.stopRun, cancel: r.stopKeep, variant: 'danger' });
        if (!ok) return;
        stopsAsked.add(runId);
        this.renderPhoneResearch();
        const res = await postRunStop(deviceBridgeBase(treeId), runId);
        // 404: the run is gone already, nothing more to stop.
        if (!res.ok && res.status !== 404) {
            stopsAsked.delete(runId);
            if (res.reason) this.showToast(res.reason, 6000);
        }
        this.renderPhoneResearch();
        void this.refreshPhoneResearch();
    },

    /**
     * Line actions (§3 point 2): on top the agent's work as on the computer (§10, AI + the terminal) — its own run
     * (grey with the reason while it cannot start) and the conversation about it; then move up, down, to the top,
     * pause ↔ resume, Show in the tree, End… (with its confirmation) — each through the bridge, none with a mark.
     * A device that does not start the agent says where the conversation is (phoneComputerOnlyNote).
     */
    openPhoneLineMenu(lineId: string): void {
        const g = shownState?.glance;
        if (!g || g.tree.state === 'archive' || away) return;
        const lines = linesInOrder(g.lines, orderMoving);
        const line = lines.find(l => l.id === lineId);
        if (!line) return;
        const r = strings.deviceResearch;
        const L = strings.live;
        const rows: { label: string; run: () => void; danger?: boolean; id?: string }[] = [];
        const writes = researchDeviceAllows('direction');
        if (writes) {
            const move = (m: PhoneLineMove, label: string, id: string): void => {
                if (movedLineOrder(lines.map(l => l.id), line.id, m)) rows.push({ label, id, run: () => { void this.phoneMoveLine(line.id, m); } });
            };
            move('up', r.lineUp, 'phone-line-up');
            move('down', r.lineDown, 'phone-line-down');
            if (line.n > 2) move('first', r.lineFirst, 'phone-line-first');
            if (line.state === 'active') rows.push({ label: L.dirPause, id: 'phone-line-pause', run: () => { void this.phoneLineState(line.id, 'pause'); } });
            else rows.push({ label: r.lineResume, id: 'phone-line-resume', run: () => { void this.phoneLineState(line.id, 'resume'); } });
        }
        const focus = line.focus;
        if (focus) rows.push({ label: L.showInTree, id: 'phone-line-tree', run: () => { void this.phoneOpenTree({ person: focus }); } });
        if (writes && line.state !== 'done') {
            rows.push({ label: L.dirEndMenu, danger: true, id: 'phone-line-end', run: () => { void this.phoneEndLine(line.id, line.name); } });
        }
        const agentRows = this.phoneLineAgentRows(line, g);
        const quietNote = phoneComputerOnlyNote('line-work', computerName()) ?? undefined;
        this.presentMenuSheet(line.name, agentRows.length
            ? [{ rows: agentRows }, { rows, divider: rows.length > 0 }]
            : [{ rows, quiet: quietNote }], {
            subtitle: r.lineSheetSub(line.n, line.tasks), overlayClass: 'phone-sheet-overlay',
        });
    },

    /** The agent's rows of Line actions (§3 point 2, 10.8): Put an agent on this line, Work on this line. */
    phoneLineAgentRows(line: DeviceGlanceLine, g: DeviceGlance): PhoneSheetRow[] {
        const L = strings.live;
        const tree = phoneResearchTreeId();
        const pc = computerName();
        const rows: PhoneSheetRow[] = [];
        const runLink = phoneAgentLink(tree, 'work', { workDo: 'loop', research: line.id });
        const why = phoneLineRunWhy(line, g, tree ? deviceAgentStartOf(tree) : null, runLink);
        if (why !== null && runLink) {
            const f = researchMarkFlags(researchLinkMark('work'));
            rows.push({
                label: L.lineRun, id: 'phone-line-run', ai: f.ai, ext: f.research,
                ...(why ? { disabled: true, why } : { sub: strings.deviceAgent.whereLine(pc) }),
                run: () => this.phoneStartAgent(runLink, { sheet: { kind: 'line', lineName: line.name, tasks: line.tasks }, label: line.name }),
            });
        }
        const chatLink = line.state === 'active' ? phoneAgentLink(tree, 'chat', { research: line.id }) : null;
        if (chatLink) {
            const f = researchMarkFlags(researchLinkMark('chat'));
            rows.push({
                label: L.dirWork, id: 'phone-line-work', ai: f.ai, ext: f.research, sub: L.dirWorkHint,
                run: () => this.phoneStartAgent(chatLink, { sheet: { kind: 'chat', sub: line.name }, label: line.name }),
            });
        }
        return rows;
    },

    /**
     * The agent's link of the screen's tree started from here (§10): its sheet (or none), then its state in Now
     * (quiet: no toast). Without the computer nothing starts and nothing waits to start later (10.13).
     */
    phoneStartAgent(link: string, o: { sheet: DeviceAgentSheetInfo; label?: string; from?: HTMLElement | null }): void {
        const tree = phoneResearchTreeId();
        if (!tree || away || this.deviceDownKind() !== null) return;
        const ctx: DeviceAgentCtx = { tree, pc: computerName(), sheet: o.sheet, quiet: true, ...(o.label ? { label: o.label } : {}) };
        startsAsked.set(tree, ctx);
        void this.startAgentFromDevice(link, { ...ctx, from: o.from ?? null }).then(() => {
            if (phoneResearchShown()) this.renderPhoneResearch();
        });
    },

    /** "Work on the queue…" (§2 point 6, 10.2): its sheet with Automatically / Only N. */
    phoneStartQueueWork(from: HTMLElement | null): void {
        const tree = phoneResearchTreeId();
        const linkFor = (mode: 'loop' | 'tasks'): string | null => mode === 'loop'
            ? phoneAgentLink(tree, 'work', { workDo: 'loop' })
            : phoneAgentLink(tree, 'work', { workDo: 'tasks', n: String(PHONE_WORK_TASKS) });
        const link = linkFor('loop');
        if (!link) return;
        this.phoneStartAgent(link, { sheet: { kind: 'queue', mode: { n: PHONE_WORK_TASKS, on: 'loop' }, linkFor }, from });
    },

    /** The agent's work on an item of Waiting (§5, §10): a task talked over, a conflict left to the agent. */
    phoneWaitingAgent(id: string, what: PhoneWaitingAgent, from: HTMLElement | null): void {
        const found = phoneWaitingFind(id);
        const link = found ? phoneWaitingAgentLink(phoneResearchTreeId(), found.item, what) : null;
        if (!found || !link) return;
        this.phoneStartAgent(link, { sheet: { kind: 'chat', sub: found.item.what }, label: found.item.what, from });
    },

    /** Try again (10.6, after 30 s without a proof): the start forgotten, the same link asked anew. */
    phoneAgentRetry(): void {
        const tree = phoneResearchTreeId();
        const start = tree ? deviceAgentStartOf(tree) : null;
        if (!tree || !start || away) return;
        const asked = startsAsked.get(tree);
        clearDeviceAgentStart(tree);
        const sheet = asked?.sheet;
        // The queue's choice as the link says it (Only N chosen before).
        const on = /[?&]do=tasks(&|$)/.test(start.link) ? 'tasks' as const : 'loop' as const;
        const ctx: DeviceAgentCtx = {
            ...(asked ?? { tree, pc: computerName(), quiet: true, ...(start.label ? { label: start.label } : {}) }),
            ...(sheet?.mode ? { sheet: { ...sheet, mode: { ...sheet.mode, on } } } : {}),
        };
        void this.startAgentFromDevice(start.link, ctx).then(() => {
            if (phoneResearchShown()) this.renderPhoneResearch();
        });
    },

    /** The conversation's row put away (it goes on in the terminal on the computer). */
    phoneAgentClose(): void {
        const tree = phoneResearchTreeId();
        if (tree) clearDeviceAgentStart(tree);
    },

    /** A line moved in the order of work: shown at once, written through the bridge; refused, back where it was. */
    async phoneMoveLine(lineId: string, move: PhoneLineMove): Promise<void> {
        const treeId = phoneResearchTreeId();
        const g = shownState?.glance;
        if (!treeId || !g || orderMoving) return;
        const order = movedLineOrder(linesInOrder(g.lines).map(l => l.id), lineId, move);
        if (!order) return;
        orderMoving = order;
        this.renderPhoneResearch();
        const res = await writeDirectionOrder(deviceBridgeBase(treeId), order);
        orderMoving = null;
        if (res.ok) {
            linesBusy = false;
            // The research's order kept until its next glance says the same.
            const held = shownState?.glance;
            if (held) shownState = { ...shownState!, glance: { ...held, lines: linesInOrder(held.lines, order) } };
        } else if (lineWriteBusy(res)) linesBusy = true;
        this.renderPhoneResearch();
        if (res.ok) void this.refreshPhoneResearch();
    },

    /** A line paused, resumed or ended through the bridge; a refusal as the research being written says so under the list. */
    async phoneLineState(lineId: string, what: DirectionStateDo): Promise<boolean> {
        const treeId = phoneResearchTreeId();
        if (!treeId) return false;
        const res = await setDirectionState(deviceBridgeBase(treeId), lineId, what);
        if (res.ok) {
            linesBusy = false;
            const held = shownState?.glance;
            const next = what === 'pause' ? 'paused' : what === 'done' ? 'done' : 'active';
            if (held) shownState = { ...shownState!, glance: { ...held, lines: held.lines.map(l => (l.id === lineId ? { ...l, state: next } : l)) } };
        } else if (lineWriteBusy(res)) linesBusy = true;
        this.renderPhoneResearch();
        if (res.ok) void this.refreshPhoneResearch();
        return res.ok;
    },

    /** End… (§3 point 2, 3.5): asked first, then ended through the bridge. */
    async phoneEndLine(lineId: string, name: string): Promise<void> {
        const r = strings.deviceResearch;
        const ok = await this.showConfirm(r.lineEndText, r.lineEndAsk(name), { confirmLabel: r.lineEndOk, cancel: r.lineEndKeep, variant: 'danger' });
        if (ok) await this.phoneLineState(lineId, 'done');
    },

    /**
     * The dock (§6; its buttons and the queue's strip: D6): fixed at the bottom over the bar. Under its buttons,
     * until the tree is opened here once, "n people · downloaded when opened" (§7 point 3).
     */
    renderPhoneDock(): void {
        const dock = document.getElementById(PHONE_DOCK_ID);
        if (!dock) return;
        let actions = dock.querySelector<HTMLElement>('.phone-dock__actions');
        if (!actions) {
            const queue = document.createElement('button');
            queue.type = 'button';
            queue.className = 'phone-dock__queue';
            queue.dataset.act = 'dock-queue';
            queue.hidden = true;
            actions = document.createElement('div');
            actions.className = 'phone-dock__actions';
            actions.innerHTML = dockButton('camera', strings.batch.photo, true)
                + dockButton('gallery', strings.batch.gallery) + dockButton('file', strings.deviceResearch.file);
            dock.append(queue, actions);
            this.phoneQueueChanged();
        }
        let note = dock.querySelector<HTMLElement>('.phone-dock__note');
        const treeId = phoneResearchTreeId();
        const persons = shownState?.glance?.tree.persons ?? 0;
        const notYet = !!treeId && !treesOpened.has(treeId) && persons > 0;
        if (!notYet) {
            note?.remove();
            return;
        }
        if (!note) {
            note = document.createElement('p');
            note.className = 'phone-dock__note';
            dock.append(note);
        }
        note.textContent = strings.deviceResearch.treeNotYet(persons);
    },

    /** A dock's button: the batch of the screen's research, its camera, gallery or file chooser opened within the same tap. */
    phoneDockPick(pick: 'camera' | 'gallery' | 'file'): void {
        const treeId = phoneResearchTreeId();
        if (!treeId) return;
        this.showBatchDialog({ screen: treeId, pick });
    },

    /** The strip tapped: the batch's progress; photos waiting here: what waits on this device; failed ones sent again. */
    phoneQueueOpen(): void {
        const info = this.batchQueueInfo();
        const strip = phoneQueueStrip(info, heldHanded, Date.now());
        if (strip?.kind === 'failed') {
            if (!this.batchRetryFromStrip()) {
                const treeId = phoneResearchTreeId();
                if (treeId) this.showBatchDialog({ screen: treeId });
            }
        } else if (strip?.kind === 'offline' && !info.run) void this.showDeviceWaiting();
        else this.batchReopen();
        this.phoneQueueChanged();
    },

    /** The batches changed: the strip and the Research tab's dot again (the photos waiting here read anew unless one is sent). */
    phoneQueueChanged(): void {
        if (!phoneResearchReady()) {
            const dot = document.getElementById('bb-research-dot');
            if (dot) dot.hidden = true;
            return;
        }
        const info = this.batchQueueInfo();
        if (info.run && !info.run.finished) {
            this.renderPhoneQueue();
            return;
        }
        void deviceDrafts()
            .then(ds => { heldHanded = ds.filter(d => d.handedAt).reduce((n, d) => n + d.photos.length, 0); })
            .catch(() => undefined)
            .then(() => this.renderPhoneQueue());
    },

    /** The strip (none when nothing is sent or waits) and the dot on Research while photos are sent or wait. */
    renderPhoneQueue(): void {
        const strip = phoneQueueStrip(this.batchQueueInfo(), heldHanded, Date.now());
        const dot = document.getElementById('bb-research-dot');
        if (dot) dot.hidden = !strip || strip.kind === 'done';
        const queue = document.querySelector<HTMLButtonElement>(`#${PHONE_DOCK_ID} .phone-dock__queue`);
        if (queueTimer) clearTimeout(queueTimer);
        queueTimer = null;
        if (!queue) return;
        queue.hidden = !strip;
        queue.classList.toggle('is-failed', strip?.kind === 'failed');
        queue.dataset.kind = strip?.kind ?? '';
        if (!strip) {
            queue.innerHTML = '';
            return;
        }
        const html = phoneQueueStripHtml(strip);
        if (queue.innerHTML !== html) queue.innerHTML = html;
        if (strip.kind === 'done') {
            const ended = this.batchQueueInfo().ended;
            const left = ended ? Math.max(0, QUEUE_DONE_MS - (Date.now() - ended.at)) : 0;
            queueTimer = setTimeout(() => { queueTimer = null; this.renderPhoneQueue(); }, left + 50);
        }
    },

    /** The screen's data read now (the held state first when nothing is drawn yet); a failed read keeps what is shown. */
    async refreshPhoneResearch(): Promise<void> {
        const treeId = phoneResearchTreeId();
        if (!treeId) return;
        if (findsSeenOf !== treeId || !findsWindow.has(treeId)) {
            // When the finds were last seen here: the dots' line, and (once per page) the window of the finds read.
            const seen = await findsSeenAt(treeId).catch(() => null);
            if (phoneResearchTreeId() !== treeId) return;
            if (!findsWindow.has(treeId)) findsWindow.set(treeId, seen);
            if (findsSeenOf !== treeId) {
                findsSeen = seen;
                findsSeenOf = treeId;
            }
        }
        if (!shownState) {
            const held = await heldResearchState(treeId).catch(() => null);
            if (held && phoneResearchTreeId() === treeId && !shownState) {
                shownState = held;
                this.renderPhoneResearch();
            }
        }
        reading?.abort();
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        reading = ctl;
        try {
            if (!features) features = await readDeviceResearchFeatures(treeId, ctl?.signal ?? null);
            const state = await readDeviceResearch(treeId, {
                features, lang: getCurrentLanguage(), findsSince: findsWindowSince(findsWindow.get(treeId) ?? null), signal: ctl?.signal ?? null,
            });
            if (reading !== ctl || phoneResearchTreeId() !== treeId) return;
            // Finds newer than all shown, read while the screen ran with Finds out of view: "n new ↓" (§4 point 4).
            const came = readWhileShown && phoneResearchShown() ? findsArrived(shownState?.finds, state.finds) : 0;
            if (came && !findsInView) findsCame += came;
            if (phoneResearchShown()) readWhileShown = true;
            shownState = state.glance || state.finds ? state : shownState;
            readFailed = false;
            // A start from here proved (or ended) by what the research says now (D15).
            if (state.glance) noteDeviceAgentGlance(treeId, state.glance, pairingNow()?.deviceId ?? null);
            // Photos handed over here for this research go now that it answers (§6 point 4; no tree needed).
            if (phoneResearchShown()) void this.batchResumeDevicePhotos({ screen: treeId }).then(() => this.phoneQueueChanged());
        } catch {
            if (reading !== ctl) return;
            readFailed = true;
        } finally {
            if (reading === ctl) reading = null;
        }
        if (phoneResearchShown()) this.renderPhoneResearch();
    },

    /** The bridge's live events read the screen again (only while it is seen). */
    watchPhoneResearchData(): void {
        unwatch?.();
        const treeId = phoneResearchTreeId();
        unwatch = treeId ? watchDeviceResearch(treeId, () => { void this.refreshPhoneResearch(); }) : null;
    },

    /** Another tree picked in the switcher on the screen (§1 point 8): only the screen's data, nothing downloaded. */
    async phonePickTree(researchId: string): Promise<void> {
        if (researchId === phoneResearchTreeId()) return;
        await chooseTree(researchId);
        // The event stream is of the chosen tree.
        retryDeviceConnection();
        screenTreeId = researchId;
        features = null;
        shownState = null;
        readFailed = false;
        olderFinds = null;
        findsCame = 0;
        readWhileShown = false;
        if (this.deviceTreeHeldHere(researchId)) treesOpened.add(researchId);
        this.updateTreeSwitcher();
        this.renderPhoneResearch();
        this.watchPhoneResearchData();
        await this.refreshPhoneResearch();
    },

    /** The name of the screen's tree for the switcher (null: the screen is not seen, the open tree's name stands). */
    phoneResearchTreeName(): string | null {
        if (!phoneResearchShown()) return null;
        const treeId = phoneResearchTreeId();
        if (!treeId) return null;
        return shownState?.glance?.tree.name || pairingNow()?.trees.find(t => t.id === treeId)?.name || null;
    },

    /**
     * The tree from the screen (§7): Family, Table, "Show in the tree", a person's link. The copy held here opens at
     * once; a tree never opened here is downloaded with its progress over the dock (Cancel: the screen stays as it
     * was); a failure says so with Try again; without a connection and a copy, one toast. Opened, the screen goes
     * (a history entry: Back returns to it) and the view or the person asked for is shown.
     */
    async phoneOpenTree(target: PhoneTreeTarget = {}): Promise<boolean> {
        if (opening) return opening;
        const treeId = phoneResearchTreeId();
        if (!treeId) {
            this.hidePhoneResearch();
            return false;
        }
        const run = async (): Promise<boolean> => {
            const res: PhoneTreeOpen = await this.deviceOpenPhoneTree(treeId, () => { void this.phoneOpenTree(target); });
            if (res === 'offline') this.showToast(strings.deviceResearch.treeNotHereOffline(computerName()), 6000);
            if (res !== 'open') return false;
            treesOpened.add(treeId);
            if (target.overview) {
                this.renderPhoneDock();
                this.openResearchOverview(target.overview === 'waiting' ? { showWaiting: true } : {});
                return true;
            }
            if (phoneResearchShown()) {
                this.hidePhoneResearch();
                try { history.pushState({ phone: PHONE_TREE_STATE }, ''); } catch { /* Back leaves the app as before */ }
            }
            if (target.view) this.setDisplayViewMode(target.view);
            if (target.person) this.deviceShowResearchPerson(target.person);
            return true;
        };
        opening = run().finally(() => { opening = null; });
        return opening;
    },

    /** "Progress and queue ›": the Research overview's sheet over the screen, once the tree is here (§1 point 1). */
    async phoneOpenOverview(): Promise<void> {
        await this.phoneOpenTree({ overview: true });
    },

    /** The bar's Research tab: from the tree back to the screen (the tree stays open). */
    phoneResearchTab(): void {
        if (phoneResearchShown()) return;
        const st = history.state as { phone?: string } | null;
        if (st?.phone === PHONE_TREE_STATE) {
            // Back to the entry before the tree: its popstate shows the screen.
            history.back();
            return;
        }
        this.showPhoneResearch();
    },

    /** System Back from the tree opened from the screen shows the screen again (§1 point 5). */
    watchPhoneHistory(): void {
        if (historyWatched) return;
        historyWatched = true;
        window.addEventListener('popstate', (e) => {
            if (!phoneResearchReady()) return;
            const st = (e.state ?? null) as { phone?: string } | null;
            if (st?.phone === PHONE_TREE_STATE) {
                if (phoneResearchShown()) this.hidePhoneResearch();
                return;
            }
            if (!phoneResearchShown()) this.showPhoneResearch();
        });
    },

    /**
     * The bar's marks: Research marked (Linka, aria-current) while the screen is seen, the view's tab otherwise; the
     * screen's (+) hidden with its place kept (§1 point 3).
     */
    syncPhoneBar(): void {
        const shown = phoneResearchShown();
        const tab = document.getElementById('bb-view-research');
        if (tab) {
            if (shown) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        }
        if (shown) {
            for (const id of ['bb-view-family', 'bb-view-descendants', 'bb-view-table', 'bb-view-more']) {
                document.getElementById(id)?.classList.remove('active');
            }
        }
    },

    /** The viewport changed (a phone turned into a tablet's width, or back): the device mode's classes again. */
    phoneViewportChanged(): void {
        this.refreshDeviceModeUi();
        if (!phoneResearchReady() && phoneResearchShown()) this.hidePhoneResearch();
    },
});

/** The module's state forgotten (tests). */
export function resetPhoneResearchForTests(): void {
    screenTreeId = null;
    features = null;
    shownState = null;
    readFailed = false;
    treesOpened.clear();
    opening = null;
    stopsAsked.clear();
    orderMoving = null;
    linesBusy = false;
    waitingHere.clear();
    waitingWriting.clear();
    waitingProblems.clear();
    findsWindow.clear();
    findsSeen = null;
    findsSeenOf = null;
    olderFinds = null;
    olderReading = false;
    findsCame = 0;
    readWhileShown = false;
    findsInView = false;
    if (seenTimer) clearTimeout(seenTimer);
    seenTimer = null;
    heldHanded = 0;
    if (queueTimer) clearTimeout(queueTimer);
    queueTimer = null;
}

