/**
 * Opening a research from Strom Research, the command-line research tool:
 *
 *   A. File Handling API — the installed app opens a .ged (launchQueue);
 *   B. ?import-url=<file on this computer> — fetched once and imported;
 *   C. a .ged dropped anywhere onto the window;
 *   D. ?live=<bridge on this computer> — follow a running research: the tree
 *      refreshes by itself, changed people glow, a small panel says who is
 *      at work, what changed and what waits for the user.
 *
 * All four end in the same place: a Strom Research file (header
 * `1 SOUR STROM_RESEARCH` + `1 _STROM_TREE <uuid>`) creates its tree the
 * first time and updates that tree afterwards, asking first when the user
 * changed it in the app. Any other GEDCOM goes to the normal import dialog.
 * Other trees are never touched.
 *
 * Every browser API used here is optional: without launchQueue, EventSource,
 * drag and drop or AbortController the matching feature is simply absent.
 * Everything from a bridge is untrusted text and is rendered as text only.
 * The pure logic lives in src/research-link.ts.
 */

import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { StromData, TreeId, PersonId } from '../types.js';
import { parseGedcom, convertToStrom, decodeGedcomFile, parseGedcomDate } from '../ged-parser.js';
import { formatFlexDate } from '../dates.js';
import { formatLiveTime, formatLiveClock } from '../live-time.js';
import { isMobile } from '../breakpoints.js';
import {
    readResearchHeader, parseLoopbackUrl, parseLiveBridge, contentFingerprint, fingerprintLike,
    decideResearchOpen, stabilizeIds, carryOverMedia, sanitizeLiveStatus, sanitizeLiveChange,
    sanitizeWorking, parseEventData, extractChangedRefs, personsByRefs,
    humanizeChange, isGedcomFileName, isSafariBrowser,
    parseSendBridge, pickSendDefault, sanitizeSyncReply, researchSchemeUrl, researchTaskRef,
    ResearchLinkAction, ResearchLinkParams, LiveBridgeUrls, LiveStatus, LiveChange, LiveWorker, LiveWaiting,
    LiveQueueItem, LiveSpend, LiveIntake, LiveDirection, ResearchHeaderInfo,
} from '../research-link.js';
import { uiModule } from './module.js';
import { withAppVersion, changeKind, changeAdds, sanitizeLiveLog, textKind, textPersonRefs, textWithoutRefs, LiveChangeKind, LiveLogEntry } from '../research-link.js';
import { AGENT_DONE_MS, AGENT_DONE_FADE_MS, ResearchCardInfo, setResearchCardInfoProvider } from '../card-signals.js';
import { activeDirections, directionsMulti, queueDirectionFilter, setQueueDirectionFilter, taskDirectionName } from './research-directions-ui.js';
import { iconSvg } from '../icons.js';
import { SettingsManager } from '../settings.js';
import { countImages, stripMedia } from '../attachments.js';
import { exportToGedcom } from '../ged-exporter.js';
import { formatRelativeDateTime } from '../format.js';
import { safeFileName } from '../filenames.js';
import {
    noteResearchLinks, announcedResearchLinks, researchLinksEnabled, noteResearchWaiting, storedResearchWaiting,
    noteResearchBridge, noteResearchBridgeStatus, patchResearchAutoState, researchAutoState,
} from '../research-device.js';
import { rememberBridgeStatus } from './research-sync-ui.js';
import { sourceReadings, researchSendVouches, conflictTakeovers, heldConflicts } from '../research-sync.js';

/** What a research open needs to know from the file (or the bridge). */
export interface ResearchSource {
    treeId: string | null;
    name: string | null;
    date: string | null;
    /** The research commit (file header `_STROM_HEAD`); the bridge passes it in opts. */
    head?: string | null;
    /** `_STROM_MODE archive`: the research works without an agent. */
    mode?: 'archive' | null;
}

export interface LiveChangeItem {
    text: string;
    at: string;
    personIds: PersonId[];
    /** What it is about (the overview's filters). */
    kind: LiveChangeKind;
    /** The agent's task when it came ('' = none known). */
    task: string;
    /** The research version it came with ('' = unknown). */
    head: string;
    /** The research direction it was for ("G0002"; a newer research). */
    research?: string;
}

/** What one research commit added (the "+N people, +N sources" of the last 24 hours). */
export interface LiveAdds {
    head: string;
    at: string;
    persons: number;
    sources: number;
}

/** The panel's sections (each folds on its own). */
export type LiveSectionKey = 'working' | 'waiting' | 'changes' | 'queue';

export interface LiveSession {
    bridge: LiveBridgeUrls;
    researchId: string;
    treeId: TreeId;
    name: string;
    head: string;
    /** When the research last changed (ISO; '' = unknown). */
    headAt: string;
    working: LiveWorker[];
    waiting: LiveWaiting[];
    queue: LiveQueueItem[];
    queueMore: number;
    update: { version: string } | null;
    spend: LiveSpend | null;
    lastIntake: LiveIntake | null;
    /** The research's directions (empty: an older research). */
    researches: LiveDirection[];
    /** Sections the panel folded by itself for lack of room (not remembered). */
    autoCollapsed: Set<LiveSectionKey>;
    /** Waiting task ids already shown: a new one unfolds "Waiting for you". */
    seenWaiting: Set<string>;
    /** Changes seen with the Changes section open (for "N new"). */
    seenInSection: number;
    /** When following began, and the tree's people and sources then. */
    startedAt: number;
    startPersons: number;
    startSources: number;
    /** The Research overview is open instead of the small panel. */
    overview: boolean;
    /** The changes come from the research's own history (/log), not only from following. */
    logged: boolean;
    changes: LiveChangeItem[];
    /** Every commit seen (also those with nothing to show), newest first. */
    adds: LiveAdds[];
    ended: boolean;
    collapsed: boolean;
    /** Changes already seen when the panel was collapsed (for "N new"). */
    seenChanges: number;
    es: EventSource | null;
    timer: ReturnType<typeof setTimeout> | null;
    failures: number;
    /** Since when the bridge does not answer (null: it does); it may come back (a restart). */
    lostSince: number | null;
    /** Serialises tree refreshes (a change never overtakes another). */
    chain: Promise<void>;
}

/** Wait before reconnecting to the bridge's events / between status polls. */
const RECONNECT_MS = 2000;
/** Poll interval when the browser has no EventSource. */
const POLL_MS = 10000;
/**
 * How long the bridge may stay silent before following ends: strom can take a
 * moment to come back (a restart, a busy moment while two runs write), so the
 * app keeps asking meanwhile and says so. A test may shorten it.
 */
function lostGraceMs(): number {
    return (globalThis as { __LIVE_GRACE_MS?: number }).__LIVE_GRACE_MS ?? 60_000;
}
/** The longest wait between two attempts while the bridge is silent. */
const RETRY_MAX_MS = 5000;
/** Most change lines kept while following (the overview lists them all). */
const MAX_CHANGES = 3000;
/** Change lines in the small panel. */
const PANEL_CHANGES = 5;
/** Sections the user folded (true) or unfolded (false), per device. */
const SECTIONS_KEY = 'strom-live-sections';
/** The panel folds these by itself, in this order, when it runs out of room. */
const AUTO_FOLD: LiveSectionKey[] = ['queue', 'changes', 'working'];

/** The user's fold choices of one set of sections (panel or overview). */
export function storedLiveSections(key: string): Record<string, boolean> {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') out[k] = v;
        return out;
    } catch {
        return {};
    }
}

export function storeLiveSection(key: string, section: string, collapsed: boolean): void {
    try {
        localStorage.setItem(key, JSON.stringify({ ...storedLiveSections(key), [section]: collapsed }));
    } catch { /* not kept */ }
}

/** The small panel hides on another tree and while the overview (which shows the same) is drawn. */
function livePanelHidden(s: LiveSession): boolean {
    return DataManager.getCurrentTreeId() !== s.treeId || (s.overview && !s.ended);
}

/** Whether a panel section is folded: the user's choice, else the panel's own. */
function panelSectionCollapsed(s: LiveSession, key: LiveSectionKey): boolean {
    const stored = storedLiveSections(SECTIONS_KEY)[key];
    return stored ?? s.autoCollapsed.has(key);
}

/** "16 min", "1 h 5 min" since a moment. */
export function liveDuration(since: number, now = Date.now()): string {
    const min = Math.max(0, Math.floor((now - since) / 60000));
    return min < 60 ? strings.live.minutes(min) : strings.live.hoursMinutes(Math.floor(min / 60), min % 60);
}

/**
 * A section heading that folds its section: ▾/▸, the title, and a summary
 * on the right. Returns the section's body (empty and hidden when folded).
 */
export function liveSection(host: HTMLElement, o: {
    id: string; title: string; summary?: string; summaryCls?: string;
    collapsed: boolean; headCls?: string; onToggle: () => void;
}): HTMLElement {
    const head = el('button', `live-panel-heading live-section__head${o.headCls ? ` ${o.headCls}` : ''}`);
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!o.collapsed));
    head.setAttribute('aria-controls', o.id);
    const chevron = el('span', 'live-section__chevron', o.collapsed ? '▸' : '▾');
    chevron.setAttribute('aria-hidden', 'true');
    head.append(chevron, el('span', 'live-section__title', o.title));
    if (o.summary) head.appendChild(el('span', `live-section__sum${o.summaryCls ? ` ${o.summaryCls}` : ''}`, o.summary));
    head.onclick = o.onToggle;
    const body = el('div', 'live-section__body');
    body.id = o.id;
    body.hidden = o.collapsed;
    host.append(head, body);
    return body;
}

/** A change's text with the people in it as links (a click shows them in the tree). */
/**
 * The rows of one research commit, newest line first: its text in the
 * research's language (a newer research; an empty text shows nothing), else
 * its `what` lines put into words here.
 */
function entryItems(e: LiveLogEntry, data: StromData | null, nameOf: (ref: string) => string | null): LiveChangeItem[] {
    const base = { at: e.at, task: e.task, head: e.head, ...(e.research ? { research: e.research } : {}) };
    const ids = (refs: string[]): PersonId[] => (data && refs.length > 0 ? personsByRefs(data, refs) : []);
    if (e.text) {
        return e.text.map((line, i) => ({
            ...base, text: textWithoutRefs(line), personIds: ids(textPersonRefs(line)), kind: e.kinds?.[i] ?? textKind(line, e.what),
        })).reverse();
    }
    return [...e.what].reverse().map(line => ({
        ...base,
        text: humanizeChange(line, nameOf, strings.research.changeWords),
        personIds: ids(extractChangedRefs([line])),
        kind: changeKind(line),
    }));
}

/** What a commit added: its `+P…` and `+S…` lines (whatever the text says). */
function entryAdds(e: LiveLogEntry): LiveAdds {
    let persons = 0;
    let sources = 0;
    for (const line of e.what) {
        const a = changeAdds(line);
        if (a === 'person') persons++;
        else if (a === 'source') sources++;
    }
    return { head: e.head, at: e.at, persons, sources };
}

export function appendChangeText(host: HTMLElement, c: LiveChangeItem, show: (id: PersonId) => void): void {
    const names: { id: PersonId; name: string }[] = [];
    for (const id of c.personIds) {
        const p = DataManager.getPerson(id);
        const name = p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
        if (name && c.text.includes(name)) names.push({ id, name });
    }
    let rest = c.text;
    while (rest) {
        let first: { id: PersonId; name: string; at: number } | null = null;
        for (const n of names) {
            const at = rest.indexOf(n.name);
            if (at >= 0 && (!first || at < first.at)) first = { ...n, at };
        }
        if (!first) {
            host.appendChild(document.createTextNode(rest));
            break;
        }
        if (first.at > 0) host.appendChild(document.createTextNode(rest.slice(0, first.at)));
        const link = el('button', 'live-person-link', first.name);
        link.type = 'button';
        link.title = strings.research.showInTree;
        const id = first.id;
        link.onclick = (e) => {
            e.stopPropagation();
            show(id);
        };
        host.appendChild(link);
        rest = rest.slice(first.at + first.name.length);
    }
}

/**
 * The followed bridge, kept for a reload of this tab (sessionStorage: survives
 * F5 in the same window, never reaches another window or the next start of
 * the app — the bridge address carries a secret token).
 */
const LIVE_RESUME_KEY = 'strom.live';

function rememberLiveBridge(base: string, treeId: string): void {
    try {
        sessionStorage.setItem(LIVE_RESUME_KEY, JSON.stringify({ bridge: base, treeId }));
    } catch { /* no storage: a reload just ends following */ }
}

function forgetLiveBridge(): void {
    try {
        sessionStorage.removeItem(LIVE_RESUME_KEY);
    } catch { /* nothing stored */ }
}

/** The bridge to follow again after a reload, or null. */
export function rememberedLiveBridge(): string | null {
    try {
        const raw = sessionStorage.getItem(LIVE_RESUME_KEY);
        if (!raw) return null;
        const bridge = (JSON.parse(raw) as { bridge?: unknown }).bridge;
        return typeof bridge === 'string' && parseLiveBridge(bridge) ? bridge : null;
    } catch {
        return null;
    }
}

let externalReady = false;
/** Removes the listeners of the open ⋯ task menu (null: none open). */
let liveTaskMenuCleanup: (() => void) | null = null;
let live: LiveSession | null = null;
/** The "Waiting for you" panel while no research is followed (the research's id). */
let idlePanel: string | null = null;

/**
 * The research's word per person REFN for the cards: what waits for the user
 * (live, or as last heard within a week) and, while following, whom the agent
 * works on right now (its arc), who is in its queue (tooltip only: a dozen
 * queued people would all look worked on) and whom it was just done with (a
 * short check). Only for the active research tree.
 */
function researchCardInfo(): Map<string, ResearchCardInfo> {
    const out = new Map<string, ResearchCardInfo>();
    if (DataManager.isViewMode()) return out;
    const treeId = DataManager.getCurrentTreeId();
    if (!treeId) return out;
    const following = followedHere();
    const researchId = TreeManager.getTreeMetadata(treeId)?.research?.id;
    const waiting = following?.waiting ?? (researchId ? storedResearchWaiting(researchId)?.items : undefined) ?? [];
    const note = (ref: string | undefined, what: 'waiting' | 'agent' | 'queued', text: string): void => {
        if (!ref || !text) return;
        const info = out.get(ref) ?? {};
        info[what] ??= text;
        out.set(ref, info);
    };
    for (const w of waiting) {
        if (w.kind !== 'story') { note(w.person, 'waiting', w.what); continue; }
        // A story's new version: the app's own words, on both partners of a couple.
        for (const ref of [w.person, w.partner]) {
            if (!ref || out.get(ref)?.waiting) continue;
            note(ref, 'waiting', strings.story.nvWaitingItem);
            out.get(ref)!.waitingStory = true;
        }
    }
    if (following) {
        for (const w of following.working) if (!w.paused) note(w.person, 'agent', w.task || w.who);
        for (const q of following.queue) if (q.state === 'next') note(q.person, 'queued', q.text);
        const now = Date.now();
        for (const [ref, at] of agentDone) {
            if (now - at < AGENT_DONE_MS + AGENT_DONE_FADE_MS) out.set(ref, { ...out.get(ref), done: at });
        }
    }
    return out;
}
setResearchCardInfoProvider(researchCardInfo);

/** The live session of the tree on screen (null: not following it). */
function followedHere(): LiveSession | null {
    const treeId = DataManager.getCurrentTreeId();
    return live && !live.ended && live.treeId === treeId ? live : null;
}

/**
 * Whom the agent was just done with: REFN → when it left `working[]`.
 * Only a live change counts (never what a page load finds), so the session
 * whose `working[]` was last seen is kept alongside.
 */
const agentDone = new Map<string, number>();
let lastWorked: { session: LiveSession; refs: Set<string> } | null = null;
let agentDoneTimer: ReturnType<typeof setTimeout> | null = null;

function trackAgentDone(): void {
    const s = followedHere();
    if (!s) {
        lastWorked = null;
        agentDone.clear();
        return;
    }
    // A paused run is still at work on its person.
    const refs = new Set(s.working.map(w => w.person).filter((r): r is string => !!r));
    if (lastWorked?.session === s) {
        const now = Date.now();
        for (const ref of lastWorked.refs) if (!refs.has(ref)) agentDone.set(ref, now);
    }
    for (const ref of refs) agentDone.delete(ref);
    lastWorked = { session: s, refs };
    // Redraw once the oldest check has faded, dropping it.
    const now = Date.now();
    for (const [ref, at] of agentDone) if (now - at >= AGENT_DONE_MS + AGENT_DONE_FADE_MS) agentDone.delete(ref);
    if (agentDoneTimer) clearTimeout(agentDoneTimer);
    agentDoneTimer = null;
    if (agentDone.size > 0) {
        const next = Math.min(...agentDone.values()) + AGENT_DONE_MS + AGENT_DONE_FADE_MS - now;
        agentDoneTimer = setTimeout(() => { agentDoneTimer = null; syncResearchCardInfo(); }, Math.max(0, next) + 20);
    }
}

/** The badges last drawn from the research (a change redraws the cards). */
let cardInfoKey = '[]';
let cardInfoPending = false;

/** Redraw the cards once the research's word about people changed. */
function syncResearchCardInfo(): void {
    if (cardInfoPending) return;
    cardInfoPending = true;
    queueMicrotask(() => {
        cardInfoPending = false;
        trackAgentDone();
        const key = JSON.stringify([...researchCardInfo()].sort(([a], [b]) => a.localeCompare(b)));
        if (key === cardInfoKey) return;
        cardInfoKey = key;
        TreeRenderer.render();
    });
}

/** How long "Load new version" waits for the research to send it. */
const VERSION_WAIT_MS = 20_000;
let versionWait: ReturnType<typeof setTimeout> | null = null;
/**
 * A new version the research sent to another tab (the app open in a browser,
 * not installed: the address opens a new tab) also ends this tab's wait.
 */
const VERSION_CHANNEL = 'strom-research-version';
let versionChannel: BroadcastChannel | null = null;

/** What the page says after handing a link over: it cannot tell whether anything opened. */
export type ResearchLinkKind = 'terminal' | 'agent' | 'version';

/** What waits for the user in the active tree's research: live, or as last heard. */
export interface ResearchWaitingState {
    items: LiveWaiting[];
    at: number;
    live: boolean;
    /** A newer Strom Research is out. */
    update: { version: string } | null;
    /** The last send the research took in. */
    lastIntake: LiveIntake | null;
}
/** One open at a time: a second file waits for the first dialog. */
let openChain: Promise<unknown> = Promise.resolve();

function enqueueOpen<T>(job: () => Promise<T>): Promise<T | undefined> {
    const next = openChain.then(job, job).catch((err) => {
        console.error('Opening a research failed', err);
        return undefined;
    });
    openChain = next;
    return next;
}

/**
 * fetch with a timeout where AbortController exists; never sends cookies.
 * The timeout covers reading the body too (`res.json()` / `res.text()`):
 * a bridge that sends its headers and then nothing more must not leave the
 * caller waiting for ever (a stuck read stopped all asking in that page).
 */
export async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
    if (typeof fetch !== 'function') throw new Error('fetch unavailable');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
        return await fetch(withAppVersion(url), {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            signal: ctl?.signal,
        });
    } catch (err) {
        if (timer) clearTimeout(timer);
        throw err;
    }
}

export async function fetchGedcomText(url: string): Promise<string> {
    const res = await fetchWithTimeout(url, 30000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return decodeGedcomFile(await res.arrayBuffer());
}

/** POST the tree to the send bridge; never sends cookies. */
export async function postSync(url: string, gedcom: string, ms: number, keepalive = false): Promise<Response> {
    if (typeof fetch !== 'function') throw new Error('fetch unavailable');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
        // text/plain keeps it a simple request (no CORS preflight beyond the
        // browser's own private-network check).
        return await fetch(withAppVersion(url), {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: gedcom,
            signal: ctl?.signal,
            // Leaving the page: a small tree still reaches the bridge (a keepalive body is capped at 64 kB).
            ...(keepalive ? { keepalive: true } : {}),
        });
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Why nothing is sent: the research ends its wait at once and says why. */
export type SendCancelReason = 'unchanged' | 'cancelled' | 'no-tree';

/** Tell the send bridge nothing is coming (fire and forget; errors ignored). */
export function postCancel(url: string, reason: SendCancelReason): void {
    if (typeof fetch !== 'function') return;
    void fetch(withAppVersion(url), {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: JSON.stringify({ reason }),
    }).catch(() => { /* the research gives up on its own */ });
}

/** The GEDCOM the research gets back: the whole tree, as is, naming its research and version. */
export function researchGedcom(data: StromData, treeName: string, link: ResearchHeaderInfo): string {
    return exportToGedcom(data, treeName, { research: link }).content;
}

/**
 * The first contact from a link the research opened (?live= / ?send= /
 * ?adopt=): long enough for the browser's question about access to the local
 * network (Chrome holds the request until the user answers it).
 */
export const CONNECT_TIMEOUT_MS = 60000;
/** After this long the user is told what is being waited for. */
const CONNECT_HINT_MS = 1500;

/** Why a bridge could not be reached: it timed out (a prompt unanswered, or blocked), it refused, or Safari. */
export type BridgeFailure = 'timeout' | 'unreachable' | 'safari';

export function bridgeFailure(err: unknown): BridgeFailure {
    if (typeof navigator !== 'undefined' && isSafariBrowser(navigator.userAgent || '')) return 'safari';
    return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError') ? 'timeout' : 'unreachable';
}

/** Why a bridge could not be reached, as far as the browser tells (the connect-failed dialog). */
export type ConnectReason = 'denied' | 'prompt' | 'down' | 'unknown' | 'safari';
const CONNECT_FAILED_ID = 'research-connect-failed';

/** The browser's local network permission (Chrome), or null where it has none to tell. */
async function localNetworkStatus(): Promise<PermissionStatus | null> {
    try {
        const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
        if (!perms?.query) return null;
        return await perms.query({ name: 'local-network-access' } as unknown as PermissionDescriptor);
    } catch {
        return null;
    }
}

/** denied / prompt as the browser says; granted and still unreachable = the research is down; no answer = unknown. */
async function localNetworkReason(): Promise<ConnectReason> {
    const st = await localNetworkStatus();
    if (!st) return 'unknown';
    return st.state === 'denied' ? 'denied' : st.state === 'prompt' ? 'prompt' : 'down';
}

export async function fetchStatus(url: string, ms = 10000): Promise<LiveStatus | null> {
    const res = await fetchWithTimeout(url, ms);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = sanitizeLiveStatus(await res.json());
    // The bridge runs on this computer: what it announces holds here.
    if (status) noteResearchLinks(status.links);
    if (status?.treeId) {
        noteResearchWaiting(status.treeId, status.waiting, status);
        // Where this research's bridge is now (the port can change between runs).
        noteResearchBridge(status.treeId, url.replace(/\/status(\?.*)?$/, ''));
        noteResearchBridgeStatus(status.treeId, status.accepts, status.head);
        rememberBridgeStatus(status.treeId, status);
    }
    syncResearchCardInfo();
    return status;
}

/** Strom Research runs in a terminal on a computer, never on a phone or tablet. */
export function onComputer(): boolean {
    try { return !(window.matchMedia?.('(pointer: coarse)').matches ?? false); } catch { return true; }
}

/** Read a File as bytes (FileReader fallback for browsers without File.arrayBuffer). */
function readFileBuffer(file: Blob): Promise<ArrayBuffer> {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

/** A tree's stored data as the app would load it, or null when unreadable. */
export async function readTree(treeId: TreeId): Promise<StromData | null> {
    if (DataManager.getCurrentTreeId() === treeId && !DataManager.isLocked()) return DataManager.getData();
    try {
        const data = await TreeManager.getTreeData(treeId);
        return data ? migrateData(data) : null;
    } catch {
        return null;
    }
}

/** Bytes of photos, attachments and excerpts a research brings (0 = none). */
function incomingImageBytes(data: StromData): number {
    return countImages(data).bytes;
}

function todayIso(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "23. 9. 2026" / "23 Sep 2026": the file's header date, else today. */
function researchDateLabel(gedDate: string | null): string {
    let iso = '';
    try {
        iso = gedDate ? parseGedcomDate(gedDate) : '';
    } catch {
        iso = '';
    }
    return formatFlexDate(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayIso());
}

/** Changed cards stay highlighted this long, then the highlight goes. */
const HIGHLIGHT_MS = 30_000;
/** Panel times ("5 min ago") are refreshed this often. */
const TIME_TICK_MS = 30_000;

let highlightTimer: ReturnType<typeof setTimeout> | null = null;
let timeTicker: ReturnType<typeof setInterval> | null = null;

/**
 * A time element of the panel: `ago` = "just now / N min ago / 14:36",
 * `since` = "since 14:36". Refreshed by the ticker from its data-ts.
 */
export function timeEl(value: string, kind: 'ago' | 'since' | 'sincefor' | 'lastchange'): HTMLElement | null {
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return null;
    const node = el('small', 'live-time');
    node.dataset.ts = String(ts);
    node.dataset.kind = kind;
    node.textContent = liveTimeText(ts, kind);
    return node;
}

function liveTimeText(ts: number, kind: 'ago' | 'since' | 'sincefor' | 'lastchange'): string {
    const lang = getCurrentLanguage();
    if (kind === 'lastchange') return strings.live.lastChange(formatLiveTime(ts, Date.now(), lang, strings.research.justNow));
    if (kind === 'sincefor') return strings.live.sinceFor(formatLiveClock(ts, Date.now(), lang), liveDuration(ts));
    return kind === 'since'
        ? strings.research.since(formatLiveClock(ts, Date.now(), lang))
        : formatLiveTime(ts, Date.now(), lang, strings.research.justNow);
}

/** The research's state in a word: at work, waiting for the user, paused (its runs wait for their gate), idle. */
export function liveState(s: LiveSession): { label: string; cls: 'is-working' | 'is-waiting' | 'is-paused' | 'is-idle' | 'is-lost' } {
    const L = strings.live;
    if (s.lostSince !== null && !s.ended) return { label: L.stateLost, cls: 'is-lost' };
    if (s.working.some(w => !w.paused)) return { label: L.stateWorking, cls: 'is-working' };
    if (s.waiting.length > 0) return { label: L.stateWaiting, cls: 'is-waiting' };
    if (s.working.length > 0) return { label: L.statePaused, cls: 'is-paused' };
    return { label: L.stateIdle, cls: 'is-idle' };
}

/** A paused run: "Paused · <why> · resumes at 21:30" (what the research says of it). */
export function pausedText(w: LiveWorker): string {
    if (!w.paused) return '';
    const ts = Date.parse(w.paused.until);
    const L = strings.live;
    return [L.statePaused, w.paused.reason, Number.isFinite(ts) ? L.pausedUntil(formatLiveClock(ts, Date.now(), getCurrentLanguage())) : '']
        .filter(Boolean).join(' · ');
}

/** Keep the panel's (and the overview's) times fresh while shown. */
function tickLiveTimes(): void {
    const hosts = [document.getElementById('live-panel'), document.getElementById('research-overview')].filter(Boolean) as HTMLElement[];
    if (hosts.length === 0) {
        if (timeTicker) clearInterval(timeTicker);
        timeTicker = null;
        return;
    }
    for (const host of hosts) {
        host.querySelectorAll<HTMLElement>('.live-time[data-ts]').forEach((node) => {
            const k = node.dataset.kind;
            const kind = k === 'since' || k === 'sincefor' || k === 'lastchange' ? k : 'ago';
            node.textContent = liveTimeText(Number(node.dataset.ts), kind);
        });
    }
}

/** Start the time ticker (the overview draws times too). */
export function ensureLiveTicker(): void {
    if (!timeTicker) timeTicker = setInterval(tickLiveTimes, TIME_TICK_MS);
}

/** "user" (or nothing) is who the section heading already names. */
function waitsOnUser(on: string | undefined): boolean {
    return !on || /^\s*user\s*$/i.test(on);
}

/**
 * Where the panel may be: below whatever sits at the top on its side (the
 * standalone-file banner, the collaboration bar or badge), above whatever
 * sits at the bottom (zoom controls, bottom bar). Top-anchored layouts only;
 * the phone strip is placed by CSS.
 */
function placeLivePanel(panel: HTMLElement): void {
    panel.style.top = '';
    panel.style.maxHeight = '';
    if (panel.hidden || window.matchMedia('(max-width: 640px)').matches) return;
    const base = panel.getBoundingClientRect();
    const overlaps = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < base.right && r.right > base.left;
    let top = base.top;
    for (const sel of ['#embedded-mode-banner.visible', '#collab-bar', '#collab-badge']) {
        const node = document.querySelector<HTMLElement>(sel);
        if (!node || getComputedStyle(node).display === 'none') continue;
        const r = node.getBoundingClientRect();
        if (overlaps(r) && r.top < window.innerHeight / 3) top = Math.max(top, r.bottom + 8);
    }
    let bottom = window.innerHeight - 12;
    for (const sel of ['.control-block', '.zoom-controls', '.bottom-bar', '#view-mode-banner.visible']) {
        const node = document.querySelector<HTMLElement>(sel);
        if (!node) continue;
        const r = node.getBoundingClientRect();
        if (overlaps(r) && r.top > top) bottom = Math.min(bottom, r.top - 8);
    }
    if (top !== base.top) panel.style.top = `${Math.round(top)}px`;
    panel.style.maxHeight = `min(60vh, 520px, ${Math.max(120, Math.round(bottom - top))}px)`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The followed research (null: none), for the overview. */
export function liveSession(): LiveSession | null {
    return live;
}

export const researchUiMethods = uiModule({
    // ==================== ENTRY POINTS ====================

    /**
     * After the first render: read (and drop) ?import-url= / ?live= / ?open=,
     * start the file handler. Runs once; never throws.
     */
    initExternalOpen(): void {
        if (externalReady) return;
        externalReady = true;
        try {
            const startSearch = window.location.search;
            const params = new URLSearchParams(startSearch);
            const importUrl = params.get('import-url');
            const liveUrl = params.get('live');
            const sendUrl = params.get('send');
            const adoptUrl = params.get('adopt');
            if (importUrl !== null || liveUrl !== null || sendUrl !== null || adoptUrl !== null || params.has('open')) {
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('import-url');
                    url.searchParams.delete('live');
                    url.searchParams.delete('send');
                    url.searchParams.delete('adopt');
                    url.searchParams.delete('open');
                    history.replaceState(null, '', url.toString());
                } catch { /* keep the address as it is */ }
            }
            window.addEventListener('strom:data-changed', () => this.syncLivePanelVisibility());
            window.addEventListener('strom:tree-switched', () => this.syncLivePanelVisibility());
            window.addEventListener('resize', () => this.placeLivePanel());
            this.initLaunchQueue(startSearch);
            this.initResearchVersionChannel(importUrl !== null || liveUrl !== null || adoptUrl !== null);
            const reveal = (): void => document.documentElement.classList.remove('external-opening');
            const explicit = liveUrl !== null || importUrl !== null || sendUrl !== null || adoptUrl !== null || params.has('open');
            // Something else was asked for in this tab: the old bridge is over.
            if (explicit) forgetLiveBridge();
            const resume = explicit ? null : rememberedLiveBridge();
            if (sendUrl !== null) { reveal(); void this.sendChangesToResearch(sendUrl); }
            else if (adoptUrl !== null) { reveal(); void this.adoptFromResearch(adoptUrl); }
            else if (liveUrl !== null) void this.startLiveFollow(liveUrl).finally(reveal);
            else if (importUrl !== null) void this.importResearchFromUrl(importUrl).finally(reveal);
            // A reload while following: follow the same bridge again, quietly.
            else if (resume !== null) void this.startLiveFollow(resume, { resume: true }).finally(reveal);
            else reveal();
            // The link sent from a phone (?research=install): the install dialog, once.
            if (params.get('research') === 'install') {
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('research');
                    history.replaceState(null, '', url.toString());
                } catch { /* keep the address */ }
                if (!explicit) this.openResearchInstallFromLink();
            }
        } catch (err) {
            document.documentElement.classList.remove('external-opening');
            console.warn('External open unavailable', err);
        }
    },

    /**
     * A. The installed app launched again (manifest launch_handler
     * "focus-existing"): the open window is brought forward and gets the launch
     * here — .ged files (File Handling API) and/or the address it was opened
     * with (`targetURL`), e.g. ?send= from Strom Research. The launch that
     * started this page arrives here too; its address was already handled by
     * initExternalOpen, so it is skipped once.
     */
    initLaunchQueue(startSearch = ''): void {
        type LaunchParamsLike = { files?: ArrayLike<{ getFile?: () => Promise<File> }>; targetURL?: string };
        const lq = (window as unknown as {
            launchQueue?: { setConsumer?: (consumer: (params: LaunchParamsLike) => void) => void };
        }).launchQueue;
        if (!lq || typeof lq.setConsumer !== 'function') return;
        let startupLaunchSeen = false;
        try {
            lq.setConsumer((params) => {
                if (typeof params?.targetURL === 'string') {
                    let search = '';
                    try { search = new URL(params.targetURL).search; } catch { /* not a URL */ }
                    const isStartup = !startupLaunchSeen && search === startSearch;
                    startupLaunchSeen = true;
                    if (!isStartup) this.openExternalRequest(new URLSearchParams(search));
                }
                const files = params?.files ? Array.from(params.files) : [];
                for (const handle of files) {
                    if (!handle || typeof handle.getFile !== 'function') continue;
                    void handle.getFile().then(
                        (file) => this.openGedcomFile(file),
                        (err) => console.warn('Launch file unreadable', err)
                    );
                }
            });
        } catch (err) {
            console.warn('launchQueue unavailable', err);
        }
    },

    /**
     * A request from Strom Research reaching the window that is already open
     * (a later launch of the installed app): the same handling as at startup.
     * Returns whether there was one.
     */
    openExternalRequest(params: URLSearchParams): boolean {
        const sendUrl = params.get('send');
        const liveUrl = params.get('live');
        const importUrl = params.get('import-url');
        const adoptUrl = params.get('adopt');
        if (sendUrl === null && liveUrl === null && importUrl === null && adoptUrl === null) return false;
        // Something else was asked for: the old bridge is over.
        forgetLiveBridge();
        this.settleResearchVersion();
        if (sendUrl !== null) void this.sendChangesToResearch(sendUrl);
        else if (adoptUrl !== null) void this.adoptFromResearch(adoptUrl);
        else if (liveUrl !== null) void this.startLiveFollow(liveUrl);
        else if (importUrl !== null) void this.importResearchFromUrl(importUrl);
        return true;
    },

    /** C. A file dropped anywhere onto the window. No-op without drag and drop. */
    initFileDrop(): void {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        let depth = 0;
        const hasFiles = (e: DragEvent): boolean => {
            const types = e.dataTransfer?.types;
            if (!types) return false;
            return Array.prototype.indexOf.call(types, 'Files') >= 0;
        };
        const onFileInput = (e: Event): boolean =>
            !!(e.target as Element | null)?.closest?.('input[type="file"]');
        const modalOpen = (): boolean => !!document.querySelector('.modal-overlay.active');
        const overlay = (show: boolean): void => {
            let node = document.getElementById('drop-overlay');
            if (!show) {
                node?.classList.remove('active');
                return;
            }
            if (!node) {
                node = el('div', 'drop-overlay');
                node.id = 'drop-overlay';
                node.setAttribute('aria-hidden', 'true');
                node.appendChild(el('div', 'drop-overlay-box', strings.research.dropHint));
                document.body.appendChild(node);
            }
            const box = node.firstElementChild;
            // A tree linked to a research that takes batches: other files go there as material.
            if (box && this.batchAvailable()) {
                box.innerHTML = '';
                box.appendChild(el('div', 'drop-overlay-title', strings.batch.dropTitle));
                box.appendChild(el('div', 'drop-overlay-sub', strings.batch.dropSub));
            } else if (box) box.textContent = strings.research.dropHint;
            node.classList.add('active');
        };

        try {
            window.addEventListener('dragenter', (e) => {
                if (!hasFiles(e) || onFileInput(e)) return;
                e.preventDefault();
                depth++;
                if (!modalOpen()) overlay(true);
            });
            window.addEventListener('dragover', (e) => {
                if (!hasFiles(e) || onFileInput(e)) return;
                // Without this the browser would navigate away to the file.
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = modalOpen() ? 'none' : 'copy';
            });
            window.addEventListener('dragleave', (e) => {
                if (!hasFiles(e)) return;
                depth = Math.max(0, depth - 1);
                if (depth === 0) overlay(false);
            });
            window.addEventListener('drop', (e) => {
                depth = 0;
                overlay(false);
                if (!hasFiles(e) || onFileInput(e)) return;
                e.preventDefault();
                if (modalOpen()) return;
                const files = Array.from(e.dataTransfer?.files ?? []);
                // Anything but one family tree, for a research that takes batches: the batch's review.
                if (this.batchAvailable() && !(files.length === 1 && isGedcomFileName(files[0].name))) {
                    void this.batchFilesFromDrop(e.dataTransfer).then(list => this.showBatchDialog({ files: list }));
                    return;
                }
                const file = files[0];
                if (file) void this.openGedcomFile(file);
            });
        } catch (err) {
            console.warn('Drag and drop unavailable', err);
        }
    },

    /** A local file (dropped or from the file handler). */
    async openGedcomFile(file: File): Promise<void> {
        if (!externalReady) {
            this.showToast(strings.research.notReady);
            return;
        }
        if (!isGedcomFileName(file?.name)) {
            this.showToast(strings.research.onlyGedcom, 4000);
            return;
        }
        let buffer: ArrayBuffer;
        try {
            buffer = await readFileBuffer(file);
        } catch {
            await this.showAlert(strings.gedcom.parseError, 'error');
            return;
        }
        await enqueueOpen(async () => {
            let text: string;
            try {
                text = decodeGedcomFile(buffer);
            } catch {
                await this.showAlert(strings.gedcom.parseError, 'error');
                return;
            }
            await this.openGedcomText(text);
        });
    },

    /** B. ?import-url=: a file offered by Strom Research on this computer. */
    async importResearchFromUrl(raw: string, opts: { afterSend?: TreeId; plainAsk?: boolean } = {}): Promise<void> {
        // "Load new version" asked for this: its spinner is done.
        this.settleResearchVersion();
        const url = parseLoopbackUrl(raw);
        if (!url) {
            this.showToast(strings.research.notLocal, 6000);
            return;
        }
        if (DataManager.isViewMode()) {
            this.showToast(strings.research.notInViewMode, 5000);
            return;
        }
        await enqueueOpen(async () => {
            let text: string;
            try {
                text = await fetchGedcomText(url.href);
            } catch (err) {
                console.warn('Fetching the research failed', err);
                await this.offerManualImport(strings.research.fetchFailed);
                return;
            }
            // Served from 127.0.0.1: the research is on this computer.
            const header = readResearchHeader(text);
            if (header.isStromResearch) noteResearchLinks(header.links);
            // Served by the research's bridge (…/tree.ged): where it runs, and how (its mode, what it
            // takes) — asked, so the tree knows its bridge from now on, not only after a ?live=.
            if (header.isStromResearch && header.treeId && /\/tree\.ged$/.test(url.pathname)) {
                const base = `${url.origin}${url.pathname.replace(/\/tree\.ged$/, '')}`;
                void fetchStatus(`${base}/status`, 4000).then(() => this.refreshResearchSyncUi()).catch(() => undefined);
            }
            await this.openGedcomText(text, opts);
        });
    },

    /** The browser refused the local address: explain, offer the file picker. */
    /**
     * Wait for a bridge the user just came from; after a moment say what is
     * waited for (the browser may be asking about the local network).
     */
    async connectResearchBridge<T>(ask: () => Promise<T>): Promise<T> {
        const hint = setTimeout(() => this.showToast(strings.research.connecting, CONNECT_TIMEOUT_MS,
            { spinner: true, kind: 'research-connect' }), CONNECT_HINT_MS);
        try {
            return await ask();
        } finally {
            clearTimeout(hint);
            document.querySelector('.toast[data-kind="research-connect"]')?.remove();
        }
    },

    /**
     * The research could not be reached from a link it opened: say why (as
     * far as the browser lets us know) instead of leaving an empty tree.
     * Resolves true when the user wants to try again. Safari: the ways that
     * work there.
     */
    async showResearchConnectFailed(err: unknown, request?: { param: 'adopt' | 'send' | 'live'; value: string }): Promise<boolean> {
        const reason: ConnectReason = bridgeFailure(err) === 'safari' ? 'safari' : await localNetworkReason();
        const c = strings.connect;
        const tree = TreeManager.getActiveTreeMetadata();
        const people = Object.values(DataManager.getData().persons).some(p => !p.isPlaceholder);
        const texts: Record<ConnectReason, [string, string]> = {
            denied: [c.reasonDenied, c.textDenied], prompt: [c.reasonPrompt, c.textPrompt],
            down: [c.reasonDown, c.textDown], unknown: [c.reasonUnknown, c.textUnknown], safari: [c.reasonSafari, c.textSafari],
        };
        const [why, text] = texts[reason];
        // The way to allow it: open where it is the cause, folded where it may be.
        const how = reason === 'denied' || reason === 'unknown' ? `
            <details class="connect-how"${reason === 'denied' ? ' open' : ''}>
                <summary>${this.escapeHtml(c.howTitle)}</summary>
                <ol>${c.how.map(t => `<li>${this.escapeHtml(t)}</li>`).join('')}</ol>
            </details>` : '';
        document.getElementById(CONNECT_FAILED_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = CONNECT_FAILED_ID;
        overlay.innerHTML = `
            <div class="modal research-connect-failed" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="connect-failed-title" data-reason="${reason}">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="connect-failed-title">${this.escapeHtml(c.title)}</h2>
                        <div class="audit-log-subtitle connect-reason"><span class="connect-dot" aria-hidden="true"></span>${this.escapeHtml(why)}</div>
                    </div>
                </div>
                <div class="modal-content">
                    <p class="connect-text">${this.escapeHtml(text)}</p>
                    ${how}
                    <p class="connect-nothing">${this.escapeHtml(tree && people ? c.nothingChanged(tree.name) : c.nothingChangedEmpty)}</p>
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" data-act="close" data-dismiss>${this.escapeHtml(strings.buttons.close)}</button>
                    <button type="button" class="primary" data-act="${reason === 'safari' ? 'copy' : 'retry'}">${this.escapeHtml(reason === 'safari' ? c.copyLink : c.retry)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(CONNECT_FAILED_ID);
        return new Promise<boolean>((resolve) => {
            let settled = false;
            let watch: PermissionStatus | null = null;
            const finish = (retry: boolean): void => {
                if (settled) return;
                settled = true;
                if (watch) watch.onchange = null;
                this.closeResearchConnectFailed();
                resolve(retry);
            };
            this.researchConnectFailedResolve = () => finish(false);
            overlay.querySelectorAll<HTMLElement>('[data-act]').forEach(el => el.addEventListener('click', () => {
                const act = el.dataset.act;
                if (act === 'retry') finish(true);
                else if (act === 'close') finish(false);
                else if (act === 'copy') {
                    const url = new URL(window.location.href);
                    url.search = '';
                    url.hash = '';
                    if (request) url.searchParams.set(request.param, request.value);
                    void navigator.clipboard.writeText(url.toString()).then(
                        () => this.showToast(c.linkCopied, 5000),
                        () => this.showToast(url.toString(), 10000));
                }
            }));
            // Waiting for the user's answer to the browser: once allowed, connect by itself.
            if (reason === 'prompt') {
                void localNetworkStatus().then(st => {
                    if (!st || settled) return;
                    watch = st;
                    st.onchange = () => { if (st.state === 'granted') finish(true); };
                });
            }
            overlay.querySelector<HTMLElement>('.primary')?.focus();
        });
    },

    /** Escape on the dialog = Close. */
    cancelResearchConnectFailed(): void {
        const resolve = this.researchConnectFailedResolve;
        if (resolve) resolve();
        else this.closeResearchConnectFailed();
    },

    closeResearchConnectFailed(): void {
        this.researchConnectFailedResolve = null;
        document.getElementById(CONNECT_FAILED_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== CONNECT_FAILED_ID);
    },

    async offerManualImport(message: string): Promise<void> {
        // Safari blocks the local connection for good: say so and point to
        // the ways that work there (another browser, or drag the file in).
        const safari = typeof navigator !== 'undefined' && isSafariBrowser(navigator.userAgent || '');
        if (safari) message = strings.research.safariBlocked;
        const pick = await this.showConfirm(message, strings.research.fetchFailedTitle, {
            ok: strings.research.importManually,
            cancel: strings.research.close,
        });
        if (pick) this.startGedcomImportPlain();
    },

    // ==================== THE SHARED FLOW ====================

    /**
     * GEDCOM text from outside. A Strom Research file opens its research
     * tree; any other GEDCOM goes to the normal import dialog.
     */
    async openGedcomText(text: string, opts: { afterSend?: TreeId; plainAsk?: boolean } = {}): Promise<void> {
        if (DataManager.isViewMode()) {
            this.showToast(strings.research.notInViewMode, 5000);
            return;
        }
        const header = readResearchHeader(text);
        let result;
        try {
            result = convertToStrom(parseGedcom(text));
        } catch (err) {
            console.error('GEDCOM parse error:', err);
            await this.showAlert(strings.gedcom.parseError, 'error');
            return;
        }
        if (!header.isStromResearch) {
            // The same dialog as Import → GEDCOM (new tree / merge).
            this.importFromTreeManager = false;
            this.importToCurrentTree = false;
            this.gedcomResult = result;
            this.gedcomImportImages = null;
            this.showGedcomResultDialog();
            return;
        }
        if (!await this.ensureLocalUnlocked()) return;
        await this.applyResearch(result.data, header, { ...(opts.afterSend ? { afterSend: opts.afterSend } : {}), ...(opts.plainAsk ? { plainAsk: true } : {}) });
    },

    /**
     * Put a research into the right tree: create it the first time, update it
     * afterwards (asking when the user changed it in the app), switch to it.
     * Returns the tree, or null when the user cancelled.
     */
    async applyResearch(data: StromData, source: ResearchSource, opts: { head?: string; quiet?: boolean; afterSend?: TreeId; plainAsk?: boolean }): Promise<TreeId | null> {
        const name = source.name || strings.research.defaultName;
        const dateLabel = researchDateLabel(source.date);
        const existing = source.treeId ? TreeManager.findTreeByResearchId(source.treeId) : null;

        let previous: StromData | null = null;
        let includeImages = SettingsManager.isImportImages();
        let action = decideResearchOpen(null, null);
        let asCopy = false;
        let holdsSent = false;
        if (existing) {
            const unreadable = TreeManager.isTreeUnreadable(existing.id);
            previous = unreadable ? null : await readTree(existing.id);
            action = decideResearchOpen(existing.research, previous ? fingerprintLike(previous, existing.research?.fingerprint) : null);
            // The app's images stay (carryOverMedia); those of people or sources
            // the research dropped would go — never without asking, even over a
            // tree unchanged since.
            const edited = action === 'ask';
            const lost = previous ? carryOverMedia(stabilizeIds(data, previous), previous).lost : 0;
            if (lost > 0) action = 'ask';
            // Nothing here the research lacks: the last send was written there and
            // the tree has not changed since — its newer version holds it all.
            const sent = existing.research?.sent;
            const sentIsTree = !!previous && !!sent && contentFingerprint(previous) === sent.fingerprint;
            // …unless a conflict still open there is about a value the user has here: theirs would go (finding 37).
            const takeovers = previous ? conflictTakeovers(previous, stabilizeIds(data, previous)) : [];
            const takesOver = takeovers.length > 0;
            // Just written ("Send, then load"), and its version holds the research's values over open conflicts:
            // not loaded and nothing asked (finding 37) — the conflict stays in sight, read from that version.
            if (opts.afterSend === existing.id && takesOver && previous) {
                patchResearchAutoState(existing.id, { held: heldConflicts(previous, stabilizeIds(data, previous), existing.research?.head ?? '', opts.head || source.head || '') });
                this.refreshResearchSyncUi();
                TreeRenderer.render();
                return null;
            }
            const holdsChanges = edited && lost === 0 && sentIsTree && researchSendVouches(sent) && !takesOver;
            // The tree is what was sent and written, but the research did not take it all (nothing
            // written, a conflict left): asked plainly — "send first" would send nothing new (findings 29, 35).
            // (Waiting in its inbox, or taken back: "send, then load" still means something.)
            const plainAsk = !!opts.plainAsk || (sentIsTree && sent?.state === 'written' && (!researchSendVouches(sent) || takesOver));
            // The question is about that tree: show it behind the dialog, never
            // whichever tree was open (the user must see what they decide on).
            if (action === 'ask' && previous && !unreadable && !holdsChanges && DataManager.getCurrentTreeId() !== existing.id) {
                if (existing.isHidden) TreeManager.setTreeVisibility(existing.id, false);
                await this.switchToTree(existing.id);
                if (DataManager.getCurrentTreeId() !== existing.id) return null;
                window.dispatchEvent(new CustomEvent('strom:tree-switched'));
            }
            if (unreadable || !previous) {
                // Cannot be read with this session's key: never overwrite it.
                asCopy = true;
            } else if (holdsChanges) {
                // Replaced without asking (a backup is still kept below).
                holdsSent = true;
            } else if (edited && existing.research && !plainAsk && this.researchSyncCapable(existing.research.id)) {
                // (plainAsk: a copy that cannot send yet — "send first" would only come back here.)
                // A research that tells what it has: send first, or decide knowing it.
                const choice = await this.showResearchUpdateConflict(existing.id, existing.name, data, includeImages);
                if (choice === null) return null;
                if (choice === 'sendThenLoad') {
                    // That tree, named — never the one that happens to be open.
                    void this.researchSendTree(existing.id, { thenLoad: true });
                    return null;
                }
                asCopy = choice === 'copy';
                if (incomingImageBytes(data) > 0) includeImages = this.choiceCheckboxChecked;
            } else if (action === 'ask') {
                const backup = TreeManager.isAutoBackupEnabled(existing.id);
                const ownMedia = countImages(previous);
                const message = edited
                    ? [strings.research.editedMessage(existing.name, backup),
                        // Values the user has where a conflict is open there: said, by name (finding 37).
                        takesOver ? strings.research.conflictTakeover(takeovers.map(id => {
                            const p = previous!.persons[id];
                            return p ? `${p.firstName} ${p.lastName}`.trim() : '';
                        }).filter(Boolean).slice(0, 5).join(', ')) : '',
                        lost > 0 ? strings.research.mediaLost(lost)
                            : ownMedia.photos + ownMedia.attachments + ownMedia.excerpts > 0 ? strings.research.mediaKept : '',
                    ].filter(Boolean).join('\n\n')
                    : strings.research.mediaLostMessage(existing.name, lost, backup);
                const choice = await this.showChoice(
                    message,
                    edited ? strings.research.editedTitle : strings.research.mediaLostTitle,
                    [
                        { id: 'update', label: strings.research.update, variant: 'danger' },
                        { id: 'copy', label: strings.research.openCopy },
                    ],
                    incomingImageBytes(data) > 0
                        ? { label: strings.importImages.label, checked: includeImages,
                            detail: strings.importImages.size((incomingImageBytes(data) / (1024 * 1024)).toFixed(1)) }
                        : undefined
                );
                if (choice === null) return null;
                asCopy = choice === 'copy';
                if (incomingImageBytes(data) > 0) includeImages = this.choiceCheckboxChecked;
            }
        }
        // Images stay out when the user said so (the setting, or the checkbox).
        if (!includeImages) data = stripMedia(data);

        const previousTreeId = DataManager.getCurrentTreeId();
        let treeId: TreeId;
        let created = false;
        if (!existing || asCopy) {
            // The new tree takes the updates: the next open of this research
            // updates it. The tree the user changed stays exactly as it is and
            // keeps its tie as a copy — its changes can still be sent back.
            if (existing?.research) TreeManager.setResearchLink(existing.id, { ...existing.research, copy: true });
            const treeName = existing ? strings.research.copyName(name, formatFlexDate(todayIso())) : name;
            treeId = await DataManager.importAsNewTree(data, treeName);
            created = true;
        } else {
            treeId = existing.id;
            if (existing.isHidden) TreeManager.setTreeVisibility(treeId, false);
            const stable = carryOverMedia(stabilizeIds(data, previous!), previous!).data;
            if (DataManager.getCurrentTreeId() !== treeId) {
                if (!await DataManager.switchTree(treeId)) return null;
                TreeRenderer.restoreFromSession();
            }
            // The user's own changes are about to be replaced: keep a backup.
            if (action === 'ask') await DataManager.snapshotNow('pre-import');
            DataManager.loadStromData(stable);
        }

        if (source.treeId) {
            const head = opts.head || source.head;
            TreeManager.setResearchLink(treeId, {
                id: source.treeId,
                fingerprint: contentFingerprint(DataManager.getData()),
                syncedAt: new Date().toISOString(),
                ...(head ? { head } : {}),
                ...(source.mode === 'archive' ? { mode: 'archive' as const } : {}),
            });
            // The load itself counted as an edit (it went through the edit path before the tie moved on): nothing waits now.
            patchResearchAutoState(treeId, { edits: undefined, unsentSince: undefined });
            this.researchKeepCopy(treeId, DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : data);
        }
        const loadedAfterSend = !created && (holdsSent || (!!opts.afterSend && opts.afterSend === treeId));

        const switched = previousTreeId !== treeId;
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        if (created) TreeRenderer.resetFocusHistory();
        await TreeRenderer.renderAsync();
        if (switched) {
            ZoomPan.centerOnFocusWithContext();
            if (!created) window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        }
        this.refreshSearch();
        this.updateUrlTreeParam(treeId);

        const stored = DataManager.getData();
        // Count real people only: "?" placeholders (unknown partners) are not
        // part of the research and would inflate the summary.
        const persons = Object.values(stored.persons).filter(p => !p.isPlaceholder).length;
        const families = Object.keys(stored.partnerships).length;
        if (loadedAfterSend) this.showToast(strings.sync.loadedAfterSend, 6000);
        else if (!opts.quiet) {
            this.showToast(created
                ? strings.research.opened(name, persons, families, dateLabel)
                : strings.research.updated(name, persons, families, dateLabel), 6000);
        }
        this.refreshResearchSyncUi();
        return treeId;
    },

    /**
     * An update over a tree with changes the research does not have (a
     * research that tells what it has). Its bridge runs: send them first (the
     * new version then holds them), open as a copy, or load without them. It
     * does not run: the copy is the advice; overwriting stays possible.
     * Resolves 'sendThenLoad' | 'update' | 'copy', or null (cancelled).
     */
    async showResearchUpdateConflict(treeId: TreeId, treeName: string, data: StromData, includeImages: boolean): Promise<'sendThenLoad' | 'update' | 'copy' | null> {
        const u = strings.researchUpdate;
        const r = strings.research;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const bridgeUp = !!link && await this.researchBridgeReady(link.id);
        const previous = await readTree(treeId);
        // The app's images stay; only those of people or sources the research dropped would go.
        const lost = previous ? carryOverMedia(stabilizeIds(data, previous), previous).lost : 0;
        const own = previous ? countImages(previous) : null;
        const mediaLine = lost > 0 ? r.mediaLost(lost)
            : own && own.photos + own.attachments + own.excerpts > 0 ? r.mediaKept : '';
        const images = incomingImageBytes(data) > 0
            ? { label: strings.importImages.label, checked: includeImages,
                detail: strings.importImages.size((incomingImageBytes(data) / (1024 * 1024)).toFixed(1)) }
            : undefined;
        // Who would lose what (A2): at most five people, then "and N more".
        const names = treeId === DataManager.getCurrentTreeId() ? await this.researchOverwriteNames() : '';
        if (bridgeUp) {
            const message = [u.unsentBody(treeName), names, mediaLine].filter(Boolean).join('\n\n');
            const pick = await this.showChoice(message, u.unsentTitle, [
                { id: 'copy', label: r.openCopy },
                { id: 'sendThenLoad', label: strings.sync.sendThenLoad },
            ], images, { subtitle: `${treeName} · ${u.newerSub}`, aside: { id: 'update', label: u.loadWithout, sub: u.loadWithoutSub } });
            return pick as 'sendThenLoad' | 'update' | 'copy' | null;
        }
        const message = [u.bridgeDownBody(treeName), names, u.bridgeDownAdvice, mediaLine].filter(Boolean).join('\n\n');
        const start = link && this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.id }) : null;
        const pick = await this.showChoice(message, r.editedTitle, [{ id: 'copy', label: r.openCopy }], images, {
            aside: { id: 'update', label: u.overwrite },
            ...(start ? { link: { label: u.startResearch, run: () => this.launchResearchLink(start) } } : {}),
        });
        return pick as 'update' | 'copy' | null;
    },

    // ==================== E. SENDING CHANGES BACK ====================

    /**
     * ?send=: Strom Research asks for the user's changes to one of its trees.
     * The app sends one tree, as a faithful GEDCOM naming the research and
     * the version it came from; the research works out the changes, shows
     * them and writes nothing without the user. The app's data is untouched.
     */
    async sendChangesToResearch(raw: string): Promise<void> {
        const r = strings.research;
        const bridge = parseSendBridge(raw);
        if (!bridge) {
            this.showToast(r.notLocal, 6000);
            return;
        }
        const cancel = (reason: SendCancelReason): void => postCancel(bridge.cancel, reason);
        if (DataManager.isViewMode()) {
            cancel('cancelled');
            this.showToast(r.notInViewMode, 5000);
            return;
        }
        let status: LiveStatus | null = null;
        try {
            status = await this.connectResearchBridge(() => fetchStatus(bridge.status, CONNECT_TIMEOUT_MS));
        } catch (err) {
            console.warn('The research bridge did not answer', err);
            if (await this.showResearchConnectFailed(err, { param: 'send', value: raw })) {
                void this.sendChangesToResearch(raw);
                return;
            }
        }
        if (!status?.treeId) {
            await this.offerResearchGedcom(r.sendUnreachable, null);
            return;
        }
        const researchName = status.name || r.defaultName;
        const trees = TreeManager.findTreesByResearchId(status.treeId);
        let tree = pickSendDefault(trees, DataManager.getCurrentTreeId());
        if (!tree) {
            cancel('no-tree');
            await this.showAlert(r.sendNoTree(researchName), 'info');
            return;
        }
        if (trees.length > 1) {
            // Never more than one tree: the user picks (suggested one last = primary).
            const lang = getCurrentLanguage();
            const suggested = tree;
            const ordered = [...trees.filter(t => t.id !== suggested.id), suggested];
            const pick = await this.showChoice(r.sendPickMessage(researchName), r.sendPickTitle,
                ordered.map(t => ({
                    id: t.id,
                    label: r.sendPickItem(t.name, formatRelativeDateTime(Date.parse(t.changedAt ?? t.lastModifiedAt) || Date.now(), lang)),
                })));
            if (pick === null) { cancel('cancelled'); return; }
            tree = trees.find(t => t.id === pick) ?? suggested;
        }
        const link = tree.research;
        if (!link) { cancel('no-tree'); return; }
        if (!await this.ensureLocalUnlocked()) { cancel('cancelled'); return; }
        const data = TreeManager.isTreeUnreadable(tree.id) ? null : await readTree(tree.id);
        if (!data) {
            cancel('cancelled');
            await this.showAlert(strings.storageSafety.treeLocked, 'warning');
            return;
        }
        // Show the tree being sent behind the dialogs, not whichever was open.
        if (DataManager.getCurrentTreeId() !== tree.id) await this.switchToTree(tree.id);
        const capable = !!status.accepts;
        // Nothing changed since the research sent it (a tree followed live
        // is read-only, so it always lands here).
        if (link.fingerprint && fingerprintLike(data, link.fingerprint) === link.fingerprint) {
            cancel('unchanged');
            if (capable) this.showToast(strings.sync.nothingToast, 4000);
            else await this.showAlert(r.sendNothing(tree.name), 'info');
            return;
        }
        // A research that tells what it has: no question, the same send as
        // "Send changes" in the app (the research shows the changes and asks).
        if (capable) {
            await this.researchSendNow();
            return;
        }
        const ok = await this.showConfirm(r.sendConfirm(tree.name, researchName), r.sendConfirmTitle, { confirmLabel: r.sendButton });
        if (!ok) { cancel('cancelled'); return; }

        this.showToast(r.sending, 60000);
        let res: Response;
        try {
            res = await postSync(bridge.sync, researchGedcom(data, tree.name, { id: link.id, head: link.head, appTree: tree.id, transcripts: this.researchTranscriptsLink(link).transcripts }), 120000);
        } catch (err) {
            console.warn('Sending to the research failed', err);
            document.querySelector('.toast')?.remove();
            await this.offerResearchGedcom(r.sendUnreachable, tree.id);
            return;
        }
        let reply = sanitizeSyncReply(null);
        try {
            reply = sanitizeSyncReply(await res.json());
        } catch { /* not JSON: a refusal without a reason */ }
        document.querySelector('.toast')?.remove();
        if (res.ok && reply.ok) {
            // What the research now has of the user's transcripts (Research for this tree).
            TreeManager.patchResearchLink(tree.id, { sentSources: sourceReadings(data) });
            await this.showAlert(r.sent, 'info');
        } else await this.showAlert(r.sendRefused(reply.error), 'error');
    },

    /** Explain the way back to the research; offer the faithful GEDCOM of the tree. */
    async offerResearchGedcom(message: string, treeId: TreeId | null): Promise<void> {
        const r = strings.research;
        const id = treeId ?? DataManager.getCurrentTreeId();
        const linked = id ? TreeManager.getTreeMetadata(id)?.research : undefined;
        if (!id || !linked) {
            await this.showAlert(message, 'warning');
            return;
        }
        const pick = await this.showConfirm(message, r.sendHowTitle, { confirmLabel: r.sendExportGedcom, cancel: r.close });
        if (pick) await this.downloadResearchGedcom(id);
    },

    /** Tree menu: how to send changes back (the research starts it), or the file. */
    async showSendToResearchHelp(treeId: TreeId): Promise<void> {
        await this.offerResearchGedcom(strings.research.sendHow, treeId);
    },

    // ==================== F. LINKS INTO THE RESEARCH (strom-research://) ====================

    /** The research on this computer handles `action` (announced, not switched off, on a computer). */
    researchLinkAvailable(action: ResearchLinkAction): boolean {
        return onComputer() && researchLinksEnabled() && announcedResearchLinks().includes(action);
    },

    /** Hand a strom-research:// link to the system (the browser asks first). */
    handOverResearchLink(url: string): void {
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
    },

    /** Open a strom-research:// link and say what to expect (the page cannot tell whether it opened). */
    launchResearchLink(url: string, kind: ResearchLinkKind = 'terminal'): void {
        this.handOverResearchLink(url);
        const r = strings.research;
        if (kind === 'version') this.awaitResearchVersion();
        else if (kind === 'agent') this.showToast(r.openingAgentHint, 8000, { title: r.openingAgent });
        else this.showToast(r.openingHint, 8000, { title: r.opening });
    },

    /** Listen for a version that reached another tab; announce one that reached this tab. */
    initResearchVersionChannel(arrivedHere: boolean): void {
        if (typeof BroadcastChannel !== 'function') return;
        try {
            versionChannel = new BroadcastChannel(VERSION_CHANNEL);
            versionChannel.onmessage = () => {
                this.settleResearchVersion();
                // The research came back for the tree in another tab: stop waiting here.
                document.querySelector('.toast[data-kind="adopt"]')?.remove();
            };
            if (arrivedHere) versionChannel.postMessage('arrived');
        } catch { /* no channel: the wait just ends on its own */ }
    },

    /** "Load new version": a spinner until the research sends ?import-url=, at most 20 s. */
    awaitResearchVersion(): void {
        const r = strings.research;
        if (versionWait) clearTimeout(versionWait);
        this.showToast(r.awaitingVersion, VERSION_WAIT_MS + 500, { spinner: true });
        versionWait = setTimeout(() => {
            versionWait = null;
            this.showToast(r.noAnswer, 6000);
        }, VERSION_WAIT_MS);
    },

    /** The version came (or something else was asked for): stop waiting quietly. */
    settleResearchVersion(): void {
        if (!versionWait) return;
        clearTimeout(versionWait);
        versionWait = null;
        document.querySelector('.toast')?.remove();
    },

    /** The active tree's research id, when it is a research tree (the app's own trees: null). */
    activeResearchId(): string | null {
        if (DataManager.isViewMode()) return null;
        const id = DataManager.getCurrentTreeId();
        return (id ? TreeManager.getTreeMetadata(id)?.research?.id : undefined) ?? null;
    },

    /** A strom-research:// link for the active research tree, or null (not announced, not a research tree, bad id). */
    activeResearchLink(action: ResearchLinkAction, params: Omit<ResearchLinkParams, 'tree'> = {}): string | null {
        if (!this.researchLinkAvailable(action)) return null;
        const tree = this.activeResearchId();
        return tree ? researchSchemeUrl(action, { tree, ...params }) : null;
    },

    /** What waits for the user in the active tree's research (null: nothing known, or older than a week). */
    researchWaiting(): ResearchWaitingState | null {
        const treeId = DataManager.getCurrentTreeId();
        if (live && !live.ended && live.treeId === treeId) {
            return { items: live.waiting, at: Date.now(), live: true, update: live.update, lastIntake: live.lastIntake };
        }
        const researchId = this.activeResearchId();
        const stored = researchId ? storedResearchWaiting(researchId) : null;
        if (!stored) return null;
        // An archive has no tasks for the user (whatever its status or an old list says); its update and last send stay.
        // A research that stopped running here has none either until it runs again ("not running" shows instead).
        const none = this.activeResearchArchive() || (!!researchId && this.researchBridgeKnownDown(researchId));
        return { ...stored, items: none ? [] : stored.items, live: false };
    },

    /** Research menu "Waiting for you": the live panel open at that section, or the last known state. */
    showResearchWaiting(): void {
        const treeId = DataManager.getCurrentTreeId();
        if (live && !live.ended && live.treeId === treeId) {
            live.collapsed = false;
            this.renderLivePanel();
        } else {
            const researchId = this.activeResearchId();
            if (!researchId) return;
            if (live) {
                // The ended session's panel makes way for the current state.
                live = null;
                TreeRenderer.setChangedIds(null);
            }
            idlePanel = researchId;
            this.renderLivePanel();
        }
        const panel = document.getElementById('live-panel');
        const body = panel?.querySelector<HTMLElement>('.live-panel-body');
        const heading = panel?.querySelector<HTMLElement>('.live-panel-heading-waiting');
        if (body && heading) body.scrollTop = Math.max(0, heading.offsetTop - body.offsetTop - 4);
    },

    /** A card's agent badge: the followed research's panel, unfolded. */
    showLiveResearchNow(): void {
        if (!live || live.ended) return;
        live.collapsed = false;
        this.renderLivePanel();
    },

    /** Close the "Waiting for you" panel shown without following. */
    closeResearchIdlePanel(): void {
        if (!idlePanel) return;
        idlePanel = null;
        this.renderLivePanel();
    },

    isResearchIdlePanelOpen(): boolean {
        return idlePanel !== null && !!document.getElementById('live-panel');
    },

    /** "Answer ↗" at a waiting task: that task in the research, else the research itself. */
    answerResearchTask(w: LiveWaiting): void {
        // A story's new version: the research shows both and asks (take it is the default).
        if (w.kind === 'story' && w.person) {
            const url = this.activeResearchLink('story', { person: w.person, ...(w.partner ? { partner: w.partner } : {}) })
                ?? this.activeResearchLink('open');
            if (url) this.launchResearchLink(url);
            return;
        }
        const task = researchTaskRef(w.id);
        const url = (task ? this.activeResearchLink('task', { task }) : null) ?? this.activeResearchLink('open');
        if (url) this.launchResearchLink(url);
    },

    /** Tree menu "Send changes to the research": one click when the research handles it, else the way there. */
    async sendTreeToResearch(treeId: TreeId): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const url = link && this.researchLinkAvailable('send') ? researchSchemeUrl('send', { tree: link.id }) : null;
        if (url) this.launchResearchLink(url, 'terminal');
        else await this.showSendToResearchHelp(treeId);
    },

    /**
     * The link opening excerpt `index` (0-based) of a source at full quality in
     * the research, or null: only crops the research marked (`_STROM_CLIP`)
     * have an original there.
     */
    excerptResearchUrl(sourceId: string, index: number): string | null {
        if (!this.researchLinkAvailable('excerpt')) return null;
        const treeId = DataManager.getCurrentTreeId();
        const link = treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
        const source = DataManager.getData().sources?.[sourceId];
        const clip = source?.excerpts?.[index]?.clip;
        if (!link || !source?.refn || !clip) return null;
        return researchSchemeUrl('excerpt', { tree: link.id, source: source.refn, clip });
    },

    /** Download the faithful GEDCOM of a research tree (naming its research and version). */
    async downloadResearchGedcom(treeId: TreeId): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        if (!meta?.research) return;
        if (!await this.ensureLocalUnlocked()) return;
        const data = TreeManager.isTreeUnreadable(treeId) ? null : await readTree(treeId);
        if (!data) {
            await this.showAlert(strings.storageSafety.treeLocked, 'warning');
            return;
        }
        const research = { id: meta.research.id, head: meta.research.head, appTree: treeId, transcripts: this.researchTranscriptsLink(meta.research).transcripts };
        const blob = new Blob([researchGedcom(data, meta.name, research)], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeFileName(meta.name, 'family-tree')}.ged`;
        a.click();
        URL.revokeObjectURL(url);
        TreeManager.noteFileCopy([treeId]);
    },

    // ==================== D. LIVE BRIDGE ====================

    /**
     * A ?live= from a research whose version is the one this tree builds on,
     * the tree changed since: nothing to receive — its bridge is known again
     * (the status just asked noted it) and what waits goes as usual. True when
     * handled so.
     */
    async researchReconnectOnly(status: LiveStatus): Promise<boolean> {
        const existing = status.treeId ? TreeManager.findTreeByResearchId(status.treeId) : null;
        const link = existing?.research;
        if (!existing || !link || link.copy || !status.head || !status.accepts) return false;
        // Nothing new there: its head is the one the tree builds on, the one this app's last write made, or
        // the one a conflict kept from loading (its conflicts read already) — A3 of the rc.23 round.
        const held = researchAutoState(existing.id).held;
        const known = [link.head, link.sent?.replyHead, held && held.base === (link.head ?? '') ? held.head : undefined];
        if (!known.includes(status.head)) return false;
        const previous = await readTree(existing.id);
        if (!previous || fingerprintLike(previous, link.fingerprint) === link.fingerprint) return false;
        if (DataManager.getCurrentTreeId() !== existing.id) {
            await this.switchToTree(existing.id);
            if (DataManager.getCurrentTreeId() !== existing.id) return false;
        }
        rememberBridgeStatus(status.treeId!, status);
        this.showToast(strings.research.reconnected, 6000);
        this.refreshResearchSyncUi();
        void this.pollResearchBridge();
        return true;
    },

    /** ?live=: follow a running research through its bridge on this computer. */
    async startLiveFollow(raw: string, opts: { resume?: boolean } = {}): Promise<void> {
        const bridge = parseLiveBridge(raw);
        if (!bridge) {
            if (opts.resume) forgetLiveBridge();
            else this.showToast(strings.research.notLocal, 6000);
            return;
        }
        if (DataManager.isViewMode()) {
            if (opts.resume) forgetLiveBridge();
            else this.showToast(strings.research.notInViewMode, 5000);
            return;
        }
        await enqueueOpen(async () => {
            if (!await this.ensureLocalUnlocked()) {
                if (opts.resume) forgetLiveBridge();
                return;
            }
            this.stopLiveFollow(true);

            let status: LiveStatus | null;
            let text: string;
            try {
                status = opts.resume
                    ? await fetchStatus(bridge.status)
                    : await this.connectResearchBridge(() => fetchStatus(bridge.status, CONNECT_TIMEOUT_MS));
                if (!status) throw new Error('bad status');
                if (!status.treeId) {
                    await this.showAlert(strings.research.liveNoTree, 'error');
                    return;
                }
                text = await fetchGedcomText(bridge.ged);
            } catch (err) {
                console.warn('Connecting to the research bridge failed', err);
                if (opts.resume) {
                    // The bridge stopped while the page reloaded (strom ends it
                    // after 2 h idle): nothing to import, just say so briefly.
                    forgetLiveBridge();
                    this.showToast(strings.research.ended, 4000);
                    return;
                }
                if (await this.showResearchConnectFailed(err, { param: 'live', value: raw })) void this.startLiveFollow(raw);
                return;
            }
            const header = readResearchHeader(text);
            if (header.treeId && header.treeId !== status.treeId) {
                await this.showAlert(strings.research.liveOtherTree, 'error');
                return;
            }
            let data: StromData;
            try {
                data = convertToStrom(parseGedcom(text)).data;
            } catch {
                await this.showAlert(strings.gedcom.parseError, 'error');
                return;
            }
            const name = status.name || header.name || strings.research.defaultName;
            // The research has nothing new beyond what this tree builds on, and the tree has changes it lacks
            // (opened again from it, e.g. its bridge on a new port): connected again, the changes go to it —
            // never asked whether to replace them (B3 of the rc.22 round).
            if (!opts.resume && await this.researchReconnectOnly(status)) return;
            const treeId = await this.applyResearch(
                data,
                { treeId: status.treeId, name, date: header.date, mode: header.mode },
                { head: status.head, quiet: opts.resume }
            );
            if (!treeId) {
                if (opts.resume) forgetLiveBridge();
                return;
            }
            // An archive has no agent to follow: the tree opens for editing, its
            // bridge remembered (the changes go to it by themselves).
            if (status.accepts?.mode === 'archive') {
                if (opts.resume) forgetLiveBridge();
                this.refreshResearchSyncUi();
                void this.pollResearchBridge();
                return;
            }
            rememberLiveBridge(bridge.base, treeId);

            live = {
                bridge,
                researchId: status.treeId,
                treeId,
                name,
                head: status.head,
                headAt: status.headAt,
                working: status.working,
                waiting: status.waiting,
                queue: status.queue,
                queueMore: status.queueMore,
                update: status.update,
                spend: status.spend,
                lastIntake: status.lastIntake,
                researches: status.researches,
                autoCollapsed: new Set(window.innerHeight < 700 ? ['queue'] : []),
                seenWaiting: new Set(status.waiting.map(w => w.id)),
                seenInSection: 0,
                startedAt: Date.now(),
                startPersons: Object.values(data.persons).filter(p => !p.isPlaceholder).length,
                startSources: Object.keys(data.sources ?? {}).length,
                overview: false,
                logged: false,
                changes: [],
                adds: [],
                ended: false,
                collapsed: isMobile(),
                seenChanges: 0,
                es: null,
                timer: null,
                failures: 0,
                lostSince: null,
                chain: Promise.resolve(),
            };
            live.overview = this.researchOverviewRemembered();
            if (live.overview) live.collapsed = false;
            DataManager.setLiveTree(treeId);
            TreeRenderer.render();
            this.renderLivePanel();
            this.refreshActionMenuBadges();
            this.connectLiveEvents(live);
            void this.fetchLiveLog(live);
        });
    },

    /** Open the bridge's event stream (or poll its status without EventSource). */
    connectLiveEvents(s: LiveSession): void {
        if (s.ended || live !== s) return;
        if (typeof EventSource !== 'function') {
            this.scheduleLive(s, () => this.probeLive(s), POLL_MS);
            return;
        }
        let es: EventSource;
        try {
            es = new EventSource(withAppVersion(s.bridge.events));
        } catch {
            this.scheduleLive(s, () => this.probeLive(s), POLL_MS);
            return;
        }
        s.es = es;
        const payload = (e: Event): unknown => parseEventData((e as MessageEvent).data);
        es.addEventListener('hello', (e) => {
            this.liveBridgeBack(s);
            const status = sanitizeLiveStatus(payload(e));
            if (status) this.onLiveStatus(s, status);
            // After a reconnect: what happened meanwhile, from the research's history.
            if (s.logged) void this.fetchLiveLog(s);
        });
        es.addEventListener('change', (e) => {
            this.liveBridgeBack(s);
            const change = sanitizeLiveChange(payload(e));
            if (change) this.enqueueLive(s, () => this.onLiveChange(s, change));
        });
        es.addEventListener('working', (e) => {
            s.working = sanitizeWorking(payload(e));
            this.renderLivePanel();
        });
        es.onerror = () => {
            if (s.es !== es) return;
            // The stream dropped: find out whether the bridge is still there
            // before reconnecting (EventSource alone would retry forever).
            es.close();
            s.es = null;
            void this.probeLive(s);
        };
    },

    /** Ask the bridge for its status: alive → reconnect; gone → ended. */
    async probeLive(s: LiveSession): Promise<void> {
        if (s.ended || live !== s) return;
        try {
            const status = await fetchStatus(s.bridge.status);
            if (!status) throw new Error('bad status');
            this.liveBridgeBack(s);
            this.onLiveStatus(s, status);
            if (s.ended) return;
            if (typeof EventSource === 'function') this.scheduleLive(s, () => this.connectLiveEvents(s), RECONNECT_MS);
            else this.scheduleLive(s, () => this.probeLive(s), POLL_MS);
        } catch {
            s.failures++;
            const now = Date.now();
            if (s.lostSince === null) {
                s.lostSince = now;
                this.renderLivePanel();
            }
            if (now - s.lostSince >= lostGraceMs()) this.endLiveFollow(s, 'ended');
            else this.scheduleLive(s, () => this.probeLive(s), Math.min(RECONNECT_MS * s.failures, RETRY_MAX_MS));
        }
    },

    /** The bridge answered: following goes on (after a silence: say so by redrawing). */
    liveBridgeBack(s: LiveSession): void {
        s.failures = 0;
        if (s.lostSince === null) return;
        s.lostSince = null;
        this.renderLivePanel();
    },

    scheduleLive(s: LiveSession, run: () => void, ms: number): void {
        if (s.timer) clearTimeout(s.timer);
        s.timer = setTimeout(() => {
            s.timer = null;
            if (!s.ended && live === s) run();
        }, ms);
    },

    enqueueLive(s: LiveSession, job: () => Promise<void>): void {
        s.chain = s.chain.then(job).catch((err) => console.warn('Live update failed', err));
    },

    /** A status (hello or probe): lists for the panel; a new head means a missed change. */
    onLiveStatus(s: LiveSession, status: LiveStatus): void {
        if (status.treeId && status.treeId !== s.researchId) {
            this.endLiveFollow(s, 'other');
            return;
        }
        if (status.headAt) s.headAt = status.headAt;
        s.working = status.working;
        s.waiting = status.waiting;
        // A task that was not there before unfolds "Waiting for you", even when folded.
        const fresh = status.waiting.filter(w => !s.seenWaiting.has(w.id));
        if (fresh.length > 0) {
            for (const w of fresh) s.seenWaiting.add(w.id);
            if (storedLiveSections(SECTIONS_KEY).waiting === true) storeLiveSection(SECTIONS_KEY, 'waiting', false);
            s.autoCollapsed.delete('waiting');
        }
        s.queue = status.queue;
        s.queueMore = status.queueMore;
        s.researches = status.researches;
        s.update = status.update;
        s.spend = status.spend;
        s.lastIntake = status.lastIntake;
        if (status.treeId) noteResearchWaiting(status.treeId, status.waiting, status);
        this.refreshActionMenuBadges();
        if (status.head && status.head !== s.head) {
            this.enqueueLive(s, () => this.onLiveChange(s, { head: status.head, what: [], at: '' }));
        }
        this.renderLivePanel();
    },

    /** A change: refresh the tree, list what changed, light up those people. */
    async onLiveChange(s: LiveSession, change: LiveChange): Promise<void> {
        if (s.ended || live !== s) return;
        // A reconnect replays the last change; the tree already has it.
        if (change.head && change.head === s.head) return;
        const data = await this.refreshLiveTree(s, change.head);
        if (!data) return;
        const refs = extractChangedRefs(change.what);
        const changedIds = personsByRefs(data, refs);
        const nameOf = (ref: string): string | null => {
            const [id] = personsByRefs(data, [ref]);
            const p = id ? data.persons[id] : undefined;
            return p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null;
        };
        // An older research does not say when it changed: a change says it.
        if (change.at && Date.parse(change.at) > (Date.parse(s.headAt) || 0)) s.headAt = change.at;
        // Already there from the research's history.
        if (change.head && s.adds.some(a => a.head === change.head)) {
            this.renderLivePanel();
            return;
        }
        // A newer research sends the commits as /log does (each with its task
        // and text); an older one only the lines (the task: whatever runs now).
        const entries: LiveLogEntry[] = change.entries ?? [{
            head: change.head, at: change.at || new Date().toISOString(), what: change.what, task: s.working[0]?.task ?? '',
        }];
        const known = new Set(s.adds.map(a => a.head));
        const items: LiveChangeItem[] = [];
        const adds: LiveAdds[] = [];
        for (const e of entries) {
            if (e.head && known.has(e.head)) continue;
            items.push(...entryItems(e, data, nameOf));
            adds.push(entryAdds(e));
        }
        s.changes = [...items, ...s.changes].slice(0, MAX_CHANGES);
        s.adds = [...adds, ...s.adds].slice(0, MAX_CHANGES);
        if (DataManager.getCurrentTreeId() === s.treeId) {
            TreeRenderer.setChangedIds(new Set(changedIds));
            // The highlight marks what just came; it goes after a while.
            if (highlightTimer) clearTimeout(highlightTimer);
            highlightTimer = setTimeout(() => {
                highlightTimer = null;
                if (live === s) TreeRenderer.setChangedIds(null);
            }, HIGHLIGHT_MS);
        }
        this.renderLivePanel();
    },

    /**
     * The research's own history (a bridge of Strom Research 1.8+): the
     * changes as the research made them, not only those seen while following.
     * Replaces the list; an older bridge (404) leaves following as it was.
     */
    async fetchLiveLog(s: LiveSession): Promise<void> {
        let entries: LiveLogEntry[] | null = null;
        try {
            const res = await fetchWithTimeout(s.bridge.log, 10000);
            if (res.ok) entries = sanitizeLiveLog(await res.json());
        } catch {
            return;
        }
        if (!entries || s.ended || live !== s) return;
        const data = DataManager.getCurrentTreeId() === s.treeId ? DataManager.getData() : null;
        const nameOf = (ref: string): string | null => {
            const [id] = data ? personsByRefs(data, [ref]) : [];
            const p = id && data ? data.persons[id] : undefined;
            return p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null;
        };
        const items = entries.flatMap(e => entryItems(e, data, nameOf));
        const fresh = items.length - s.changes.length;
        s.changes = items.slice(0, MAX_CHANGES);
        s.adds = entries.map(entryAdds);
        // Nothing new to announce on the first load: the history is not news.
        if (!s.logged) {
            s.seenChanges = s.changes.length;
            s.seenInSection = s.changes.length;
        } else if (fresh < 0) {
            s.seenChanges = Math.min(s.seenChanges, s.changes.length);
        }
        s.logged = true;
        if (entries[0] && (Date.parse(entries[0].at) || 0) > (Date.parse(s.headAt) || 0)) s.headAt = entries[0].at;
        this.renderLivePanel();
    },

    /** Fetch the research's current GEDCOM and put it into the followed tree only. */
    async refreshLiveTree(s: LiveSession, head: string): Promise<StromData | null> {
        let text: string;
        try {
            text = await fetchGedcomText(s.bridge.ged);
        } catch {
            // The probe after the stream error decides whether the bridge is gone.
            return null;
        }
        if (s.ended || live !== s) return null;
        const header = readResearchHeader(text);
        if (header.treeId && header.treeId !== s.researchId) {
            this.endLiveFollow(s, 'other');
            return null;
        }
        let data: StromData;
        try {
            data = convertToStrom(parseGedcom(text)).data;
        } catch {
            return null;
        }
        // Following live asks nothing: the setting decides about images.
        if (!SettingsManager.isImportImages()) data = stripMedia(data);
        if (!TreeManager.getTreeMetadata(s.treeId)) {
            // The user deleted the followed tree: stop, never recreate it.
            this.endLiveFollow(s, 'ended');
            return null;
        }
        const active = DataManager.getCurrentTreeId() === s.treeId;
        const previous = await readTree(s.treeId);
        // Images added in the app before following stay (the research has none of them).
        const stable = migrateData(previous ? carryOverMedia(stabilizeIds(data, previous), previous).data : data);
        if (active) {
            DataManager.replaceWithSourceData(stable);
            this.refreshSearch();
        } else {
            TreeManager.updateTreeFromImport(s.treeId, stable);
        }
        if (head) s.head = head;
        TreeManager.setResearchLink(s.treeId, {
            id: s.researchId,
            fingerprint: contentFingerprint(active ? DataManager.getData() : stable),
            syncedAt: new Date().toISOString(),
            ...(s.head ? { head: s.head } : {}),
            ...(header.mode === 'archive' ? { mode: 'archive' as const } : {}),
        });
        this.researchKeepCopy(s.treeId, active ? DataManager.getData() : stable);
        return active ? DataManager.getData() : stable;
    },

    /** The user stops following (or a new ?live= replaces the session). */
    stopLiveFollow(silent = false): void {
        const s = live;
        if (!s) return;
        this.endLiveFollow(s, 'stopped');
        if (!silent) this.showToast(strings.research.stopped);
    },

    /** End a session: close the stream, lift read-only, keep the last state. */
    endLiveFollow(s: LiveSession, reason: 'ended' | 'other' | 'stopped'): void {
        if (live !== s) return;
        forgetLiveBridge();
        const wasEnded = s.ended;
        s.ended = true;
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
        try {
            s.es?.close();
        } catch { /* already closed */ }
        s.es = null;
        if (DataManager.getLiveTreeId() === s.treeId) DataManager.setLiveTree(null);
        if (reason === 'stopped') {
            live = null;
            TreeRenderer.setChangedIds(null);
        } else if (!wasEnded && reason === 'other') {
            this.showToast(strings.research.liveOtherTree, 6000);
        }
        if (DataManager.getCurrentTreeId() === s.treeId) TreeRenderer.render();
        this.renderLivePanel();
    },

    /** Close the "following ended" panel. */
    closeLivePanel(): void {
        if (live && !live.ended) return;
        live = null;
        TreeRenderer.setChangedIds(null);
        this.renderLivePanel();
    },

    toggleLivePanel(): void {
        if (!live) return;
        live.collapsed = !live.collapsed;
        if (live.collapsed) live.seenChanges = live.changes.length;
        this.renderLivePanel();
    },

    syncLivePanelVisibility(): void {
        this.renderResearchOverview();
        const panel = document.getElementById('live-panel');
        if (!panel) return;
        // The same rule as the panel's own redraw: a drawn overview hides it.
        if (live) panel.hidden = livePanelHidden(live);
        else if (idlePanel) panel.hidden = this.activeResearchId() !== idlePanel;
    },

    /** The panel element (created on first use). */
    livePanelElement(): HTMLElement {
        let panel = document.getElementById('live-panel');
        if (!panel) {
            panel = el('aside', 'live-panel');
            panel.id = 'live-panel';
            panel.setAttribute('role', 'region');
            document.body.appendChild(panel);
        }
        return panel;
    },

    /**
     * The "Waiting for you" section: the tasks, since when, and (while the
     * research runs) "Answer ↗" into the research. Bridge text is text only.
     * Returns the section's body. Without `fold` the heading does not fold
     * (the panel shown without following).
     */
    appendWaitingSection(body: HTMLElement, items: readonly LiveWaiting[], answerable: boolean,
        fold?: { collapsed: boolean; onToggle: () => void; id: string }): HTMLElement {
        const r = strings.research;
        const title = `${r.waiting} · ${items.length}`;
        let host: HTMLElement;
        if (fold) {
            host = liveSection(body, { id: fold.id, title, collapsed: fold.collapsed, onToggle: fold.onToggle, headCls: 'live-panel-heading-waiting' });
        } else {
            body.appendChild(el('h4', 'live-panel-heading live-panel-heading-waiting', title));
            host = body;
        }
        const list = el('ul', 'live-panel-list live-waiting');
        host.appendChild(list);
        const canAnswer = answerable && (this.researchLinkAvailable('task') || this.researchLinkAvailable('open'));
        for (const w of items) {
            const li = el('li', 'live-waiting-row');
            const text = el('div', 'live-waiting-text');
            if (w.kind === 'story') {
                // A story's new version: compared here, not answered there.
                const compare = this.appendStoryWaiting(text, w, (id) => this.showLivePerson(id));
                const at = timeEl(w.at, 'ago');
                if (at) text.appendChild(at);
                li.append(text, compare);
                list.appendChild(li);
                continue;
            }
            text.appendChild(el('span', 'live-waiting-what', w.what));
            // "on" is the agent's free text; "user" only repeats the heading.
            if (!waitsOnUser(w.on)) text.appendChild(el('small', 'live-time', r.waitingOn(w.on!)));
            const at = timeEl(w.at, 'ago');
            if (at) text.appendChild(at);
            li.appendChild(text);
            if (canAnswer) {
                const answer = el('button', 'live-waiting-answer', r.answer);
                answer.type = 'button';
                answer.onclick = () => this.answerResearchTask(w);
                li.appendChild(answer);
            }
            list.appendChild(li);
        }
        return host;
    },

    /** Fold or unfold a section of the small panel (remembered on this device). */
    toggleLiveSection(key: LiveSectionKey): void {
        const s = live;
        if (!s) return;
        const collapsed = panelSectionCollapsed(s, key);
        storeLiveSection(SECTIONS_KEY, key, !collapsed);
        s.autoCollapsed.delete(key);
        if (key === 'changes' && collapsed) s.seenInSection = s.changes.length;
        this.renderLivePanel();
    },

    /** Show a person from a live change: focus them and bring them into view. */
    showLivePerson(id: PersonId): void {
        if (!DataManager.getPerson(id)) return;
        TreeRenderer.setFocus(id);
        void TreeRenderer.renderAsync().then(() => ZoomPan.centerOnFocusWithContext());
    },

    /** "Working": who, on what, since when and for how long. */
    appendWorkingList(host: HTMLElement, s: LiveSession): void {
        const r = strings.research;
        const working = el('ul', 'live-panel-list live-working');
        host.appendChild(working);
        if (s.working.length === 0) working.appendChild(el('li', 'live-empty', r.nobodyWorking));
        for (const w of s.working) {
            const li = el('li');
            li.appendChild(el('strong', undefined, w.who));
            if (w.task) li.appendChild(el('span', 'live-task', ` — ${w.task}`));
            if (w.paused) li.appendChild(el('span', 'live-paused', pausedText(w)));
            const since = timeEl(w.since, 'sincefor');
            if (since) li.appendChild(since);
            working.appendChild(li);
        }
    },

    /** Change rows (text with the people as links, then the time). */
    appendChangeRows(list: HTMLElement, changes: readonly LiveChangeItem[]): void {
        const r = strings.research;
        if (changes.length === 0) list.appendChild(el('li', 'live-empty', r.noChanges));
        for (const c of changes) {
            const li = el('li');
            const row = el('div', 'live-change');
            const text = el('span', 'live-change-text');
            appendChangeText(text, c, (id) => this.showLivePerson(id));
            row.appendChild(text);
            const at = timeEl(c.at, 'ago');
            if (at) row.appendChild(at);
            li.appendChild(row);
            list.appendChild(li);
        }
    },

    /** Draw the "Research now" panel. Bridge text is set as text, never HTML. */
    renderLivePanel(): void {
        syncResearchCardInfo();
        // Following the agent in the tree reacts to every status and change (after this redraw).
        queueMicrotask(() => this.syncLiveFollow());
        const s = live;
        if (!s && !idlePanel) {
            document.getElementById('live-panel')?.remove();
            this.renderResearchOverview();
            return;
        }
        const panel = this.livePanelElement();
        if (!s) {
            this.renderResearchOverview();
            this.renderIdleResearchPanel(panel);
            return;
        }
        // Following a research: its panel says it all.
        idlePanel = null;
        const r = strings.research;
        const L = strings.live;
        // Phones: the panel is a strip (head and a summary); a tap opens the overview sheet.
        const phone = window.matchMedia?.('(max-width: 640px)').matches === true;
        const collapsed = s.collapsed || phone;
        panel.setAttribute('aria-label', r.panelLabel);
        panel.classList.remove('idle');
        panel.classList.toggle('ended', s.ended);
        panel.classList.toggle('lost', !s.ended && s.lostSince !== null);
        panel.classList.toggle('collapsed', collapsed);
        panel.classList.toggle('phone-strip', phone && !s.ended);
        // The overview shows the same (a drawn overview hides the panel).
        panel.hidden = livePanelHidden(s);
        // A redraw replaces the ⋯ buttons: an open task menu moves to the new one.
        const menuTask = document.getElementById('live-task-menu')?.dataset.task ?? null;
        this.closeLiveTaskMenu();
        panel.replaceChildren();
        this.renderResearchOverview();

        const head = el('div', 'live-panel-head');
        head.appendChild(el('span', 'live-dot'));
        const toggle = el('button', 'live-panel-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = phone ? L.openOverview : collapsed ? r.show : r.hide;
        toggle.onclick = () => (phone && !s.ended ? this.openResearchOverview() : this.toggleLivePanel());
        toggle.appendChild(el('span', 'live-panel-title', s.ended ? r.ended : r.panelTitle));
        const chevron = el('span', 'live-panel-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.innerHTML = iconSvg('chevron-down', { size: 14 });
        toggle.appendChild(chevron);
        head.appendChild(toggle);
        const followBtn = phone ? null : this.liveFollowButton('panel');
        if (followBtn) head.appendChild(followBtn);
        if (this.canOpenResearchOverview()) {
            const expand = el('button', 'live-panel-expand', '⤢');
            expand.type = 'button';
            expand.setAttribute('aria-label', L.openOverview);
            expand.title = L.openOverview;
            expand.onclick = () => this.openResearchOverview();
            head.appendChild(expand);
        }
        const action = el('button', 'live-panel-action', s.ended ? r.close : r.stop);
        action.type = 'button';
        action.onclick = () => (s.ended ? this.closeLivePanel() : this.stopLiveFollow());
        head.appendChild(action);
        panel.appendChild(head);
        if (!s.ended && s.update && !phone) this.appendUpdateStrip(panel, s.update.version);
        // Collapsed: what the hidden body would say first. On a phone: the state and what waits.
        if (collapsed) {
            const summary = el('div', 'live-panel-summary');
            if (phone && !s.ended) {
                summary.appendChild(el('span', 'live-panel-chip', liveState(s).label));
                if (s.waiting.length > 0) summary.appendChild(el('span', 'live-panel-chip live-panel-chip--warn', `${r.waiting} ${s.waiting.length}`));
            }
            const fresh = s.changes.length - s.seenChanges;
            if (fresh > 0) summary.appendChild(el('span', 'live-panel-chip live-panel-new', r.newChanges(fresh)));
            if (!s.ended && !phone) summary.appendChild(el('span', 'live-panel-chip', r.readOnly));
            // Phone: the follow switch at the strip's right end.
            const phoneFollow = phone ? this.liveFollowButton('phone') : null;
            if (phoneFollow) summary.appendChild(phoneFollow);
            if (summary.childElementCount > 0) panel.appendChild(summary);
        }

        const body = el('div', 'live-panel-body');
        const stateText = s.ended ? r.endedText : s.lostSince !== null ? r.reconnecting : r.following(s.name);
        const stateLine = body.appendChild(el('p', 'live-panel-state', stateText));
        if (!s.ended && s.lostSince !== null) {
            stateLine.classList.add('is-lost');
            stateLine.setAttribute('role', 'status');
        }
        const fold = (key: LiveSectionKey) => ({
            id: `live-sec-${key}`,
            collapsed: panelSectionCollapsed(s, key),
            onToggle: () => this.toggleLiveSection(key),
        });

        // Once following has ended the bridge's "who is working" is stale —
        // show it only while live.
        if (!s.ended) {
            const w = s.working[0];
            const since = w ? Date.parse(w.since) : NaN;
            const summary = w ? [w.who, w.paused ? L.statePaused : Number.isFinite(since) ? liveDuration(since) : ''].filter(Boolean).join(' · ') : L.nobody;
            const host = liveSection(body, { ...fold('working'), title: r.atWork, summary });
            this.appendWorkingList(host, s);
        }

        // What waits for the user comes before what changed: it needs them.
        if (s.waiting.length > 0) {
            const host = this.appendWaitingSection(body, s.waiting, !s.ended, fold('waiting'));
            if (!s.ended) host.appendChild(el('p', 'live-panel-hint', r.answerWhere));
        }

        // What changed: the last few here, all of them in the overview.
        const changesFold = fold('changes');
        if (!changesFold.collapsed) s.seenInSection = s.changes.length;
        const freshInSection = s.changes.length - s.seenInSection;
        const changesHost = liveSection(body, {
            ...changesFold, title: r.changes,
            summary: freshInSection > 0 ? L.newChanges(freshInSection) : undefined, summaryCls: 'live-section__sum--new',
        });
        const changes = el('ul', 'live-panel-list live-changes');
        changesHost.appendChild(changes);
        this.appendChangeRows(changes, s.changes.slice(0, PANEL_CHANGES));
        if (s.changes.length > PANEL_CHANGES && this.canOpenResearchOverview()) {
            const all = el('button', 'link-button live-all-changes', L.allInOverview);
            all.type = 'button';
            all.onclick = () => this.openResearchOverview();
            changesHost.appendChild(all);
        }

        // The agent's queue: only while live (an old queue misleads).
        if (!s.ended) this.appendQueueSection(body, s, fold('queue'), 3);
        panel.appendChild(body);
        if (!s.ended && s.spend && !phone) this.appendSpendFoot(panel, s.spend);
        placeLivePanel(panel);
        const again = menuTask ? panel.querySelector<HTMLElement>(`.live-queue-more[data-task="${menuTask}"]`) : null;
        if (again && menuTask) this.openLiveTaskMenu(again, menuTask);
        // Too tall for the window: fold Up next, then Changes, then Working (never
        // Waiting, never what the user chose). Not remembered.
        if (!collapsed && !panel.hidden && body.scrollHeight > body.clientHeight + 1) {
            const stored = storedLiveSections(SECTIONS_KEY);
            const next = AUTO_FOLD.find(k => stored[k] === undefined && !s.autoCollapsed.has(k)
                && body.querySelector(`#live-sec-${k}`));
            if (next) {
                s.autoCollapsed.add(next);
                this.renderLivePanel();
                return;
            }
        }
        if (!timeTicker) timeTicker = setInterval(tickLiveTimes, TIME_TICK_MS);
    },

    appendUpdateStrip(panel: HTMLElement, version: string): void {
        const r = strings.research;
        const strip = el('div', 'live-panel-update');
        strip.appendChild(el('span', 'live-panel-update-text', r.updateAvailable(version)));
        const url = this.activeResearchLink('update');
        if (url) {
            const btn = el('button', 'link-button live-panel-update-link', r.updateResearch);
            btn.type = 'button';
            btn.onclick = () => this.launchResearchLink(url);
            strip.appendChild(btn);
        }
        panel.appendChild(strip);
    },

    /**
     * "Up next": the first `limit` tasks of the agent's queue (⋯ parks or
     * drops one in the research), parked ones below (Resume ↗), the rest as
     * one link. Nothing changes here after an action: the next status tells.
     */
    appendQueueSection(body: HTMLElement, s: LiveSession,
        fold: { id: string; collapsed: boolean; onToggle: () => void }, limit: number, title = strings.research.queue,
        directions = false): void {
        const r = strings.research;
        // The overview, two or more directions running: each task names its
        // direction, and pills filter the queue by one.
        const multi = directions && directionsMulti(s);
        const dirFilter = multi ? queueDirectionFilter(s) : 'all';
        const inFilter = (q: LiveQueueItem): boolean => dirFilter === 'all' || q.research === dirFilter;
        const allNext = s.queue.filter(q => q.state === 'next');
        const next = allNext.filter(inFilter);
        const parked = s.queue.filter(q => q.state === 'parked' && inFilter(q));
        if (s.queue.length === 0 && s.queueMore === 0) return;
        const shownNext = next.slice(0, limit);
        const shownParked = parked.slice(0, limit);
        const hidden = s.queueMore + (next.length - shownNext.length) + (parked.length - shownParked.length);

        const host = liveSection(body, {
            ...fold, title, headCls: 'live-queue-toggle',
            summary: strings.live.queueCount(allNext.length + s.queueMore),
        });
        if (multi) {
            const pills = el('div', 'research-overview__filters research-overview__queue-filters');
            pills.setAttribute('role', 'radiogroup');
            pills.setAttribute('aria-label', strings.live.dirFilterLabel);
            const active = activeDirections(s);
            const options: [string, string, number][] = [
                ['all', strings.live.filterAll, allNext.length],
                ...active.map(d => [d.id, d.name, allNext.filter(q => q.research === d.id).length] as [string, string, number]),
            ];
            for (const [id, label, n] of options) {
                const chip = el('button', 'research-overview__filter', `${label} ${n}`);
                chip.type = 'button';
                chip.setAttribute('role', 'radio');
                chip.setAttribute('aria-checked', String(dirFilter === id));
                chip.dataset.direction = id;
                chip.onclick = () => {
                    setQueueDirectionFilter(id);
                    this.renderResearchOverview();
                };
                pills.appendChild(chip);
            }
            host.appendChild(pills);
        }
        const list = el('ul', 'live-panel-list live-queue');
        host.appendChild(list);
        const canTask = this.researchLinkAvailable('task');
        shownNext.forEach((q, i) => {
            const li = el('li', 'live-queue-row');
            li.appendChild(el('span', 'live-queue-num', String(i + 1)));
            const text = el('span', 'live-queue-text', q.text);
            const dir = multi ? taskDirectionName(s, q.research) : '';
            if (dir) text.appendChild(el('span', 'research-overview__dir', ` · ${dir}`));
            li.appendChild(text);
            if (canTask) {
                const more = el('button', 'live-queue-more', '⋯');
                more.type = 'button';
                more.setAttribute('aria-label', r.taskMenu);
                more.setAttribute('aria-haspopup', 'menu');
                more.dataset.task = q.id;
                more.onclick = (e) => {
                    e.stopPropagation();
                    this.openLiveTaskMenu(more, q.id);
                };
                li.appendChild(more);
            }
            list.appendChild(li);
        });
        for (const q of shownParked) {
            const li = el('li', 'live-queue-row live-queue-row--parked');
            li.appendChild(el('span', 'live-queue-text', `${r.parkedPrefix} ${q.text}`));
            if (canTask) {
                const wake = el('button', 'link-button live-queue-wake', r.wake);
                wake.type = 'button';
                wake.onclick = () => this.runLiveTask(q.id, 'wake');
                li.appendChild(wake);
            }
            list.appendChild(li);
        }
        const open = this.activeResearchLink('open');
        if (hidden > 0 && open) {
            const li = el('li', 'live-queue-row live-queue-row--more');
            const more = el('button', 'link-button live-queue-rest', r.queueMore(hidden));
            more.type = 'button';
            more.onclick = () => this.launchResearchLink(open);
            li.appendChild(more);
            list.appendChild(li);
        }
    },

    /** Park / drop / wake a queued task in the research. */
    runLiveTask(task: string, what: 'park' | 'drop' | 'wake'): void {
        this.closeLiveTaskMenu();
        const url = this.activeResearchLink('task', { task, taskDo: what });
        if (url) this.launchResearchLink(url);
    },

    /** The small ⋯ menu of a queued task: Park ↗ / Drop ↗. Escape or a click elsewhere closes it. */
    openLiveTaskMenu(anchor: HTMLElement, task: string): void {
        const wasOpen = document.getElementById('live-task-menu')?.dataset.task === task;
        this.closeLiveTaskMenu();
        if (wasOpen) return;
        const r = strings.research;
        const menu = el('div', 'context-menu live-task-menu');
        menu.id = 'live-task-menu';
        menu.dataset.task = task;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', r.taskMenu);
        for (const [what, label] of [['park', r.park], ['drop', r.drop]] as const) {
            const item = el('div', 'context-menu-item', label);
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.action = what;
            item.onclick = () => this.runLiveTask(task, what);
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.runLiveTask(task, what); }
            };
            menu.appendChild(item);
        }
        document.body.appendChild(menu);
        anchor.setAttribute('aria-expanded', 'true');
        const rect = anchor.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
        const below = rect.bottom + 4;
        const top = below + menu.offsetHeight > window.innerHeight - 8 ? rect.top - menu.offsetHeight - 4 : below;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        (menu.firstElementChild as HTMLElement | null)?.focus();
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeLiveTaskMenu();
                anchor.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const items = [...menu.querySelectorAll<HTMLElement>('.context-menu-item')];
                const i = items.indexOf(document.activeElement as HTMLElement);
                items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }
        };
        const onDown = (e: Event): void => {
            if (!menu.contains(e.target as Node)) this.closeLiveTaskMenu();
        };
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
        liveTaskMenuCleanup = () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('mousedown', onDown, true);
            anchor.setAttribute('aria-expanded', 'false');
        };
    },

    closeLiveTaskMenu(): void {
        liveTaskMenuCleanup?.();
        liveTaskMenuCleanup = null;
        document.getElementById('live-task-menu')?.remove();
    },

    /** "Agent this month: 4 sessions · $3.20" at the foot of the panel, ↗ to the sessions. */
    appendSpendFoot(panel: HTMLElement, spend: LiveSpend): void {
        const r = strings.research;
        let amount: string;
        try {
            amount = new Intl.NumberFormat(getCurrentLanguage(), { style: 'currency', currency: spend.currency }).format(spend.amount);
        } catch {
            amount = `${spend.amount.toFixed(2)} ${spend.currency}`;
        }
        const foot = el('div', 'live-panel-spend');
        foot.appendChild(el('span', 'live-panel-spend-text', r.spend(spend.sessions, amount)));
        const url = this.activeResearchLink('sessions');
        if (url) {
            const btn = el('button', 'live-panel-spend-link', '↗');
            btn.type = 'button';
            btn.setAttribute('aria-label', r.spendOpenSr);
            btn.title = r.spendOpenSr;
            btn.onclick = () => this.launchResearchLink(url);
            foot.appendChild(btn);
        }
        panel.appendChild(foot);
    },

    /** The panel without following: what waited for the user when the research last said so. */
    renderIdleResearchPanel(panel: HTMLElement): void {
        const r = strings.research;
        const researchId = idlePanel;
        const state = researchId ? storedResearchWaiting(researchId) : null;
        panel.setAttribute('aria-label', r.panelIdle);
        panel.classList.remove('ended', 'collapsed');
        panel.classList.add('idle');
        panel.hidden = this.activeResearchId() !== researchId;
        panel.replaceChildren();

        const head = el('div', 'live-panel-head');
        head.appendChild(el('span', 'live-dot'));
        head.appendChild(el('span', 'live-panel-title live-panel-title--static', r.panelIdle));
        const close = el('button', 'live-panel-close');
        close.type = 'button';
        close.innerHTML = '&times;';
        close.setAttribute('aria-label', r.close);
        close.title = r.close;
        close.onclick = () => this.closeResearchIdlePanel();
        head.appendChild(close);
        panel.appendChild(head);

        const body = el('div', 'live-panel-body');
        this.appendWaitingSection(body, state?.items ?? [], false);
        if (state) {
            const when = new Date(state.at).toLocaleString(getCurrentLanguage(), {
                day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            body.appendChild(el('p', 'live-panel-hint', r.waitingAsOf(when)));
        }
        panel.appendChild(body);

        const open = this.activeResearchLink('open');
        if (open) {
            const foot = el('div', 'live-panel-foot');
            const btn = el('button', 'primary live-panel-open', r.openResearch + ' ↗');
            btn.type = 'button';
            btn.onclick = () => this.launchResearchLink(open);
            foot.appendChild(btn);
            panel.appendChild(foot);
        }
        placeLivePanel(panel);
        if (!timeTicker) timeTicker = setInterval(tickLiveTimes, TIME_TICK_MS);
    },

    /** Re-place the panel (window resized, a bar appeared). */
    placeLivePanel(): void {
        // Across the phone / tablet / desktop widths the panel and the overview change form.
        const overview = document.getElementById('research-overview');
        const phone = window.matchMedia?.('(max-width: 640px)').matches === true;
        const form = `${phone}:${window.innerWidth >= 1280}`;
        if (overview && overview.dataset.form !== form) {
            overview.dataset.form = form;
            this.renderLivePanel();
            return;
        }
        const panel = document.getElementById('live-panel');
        if (panel && live && panel.classList.contains('phone-strip') !== (phone && !live.ended)) {
            this.renderLivePanel();
            return;
        }
        if (panel) placeLivePanel(panel);
    },
});
