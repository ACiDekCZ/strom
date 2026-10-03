/**
 * Where a research tree stands with its research, and sending changes to it
 * (Strom Research 1.12+, which says so in its status: `accepts`).
 *
 * The app remembers the research's bridge (its address comes with every
 * ?live= / ?send=), asks it now and then how things are (`/status?poll=1`, which
 * does not keep the bridge awake) and shows ONE state: a block at the top of
 * ⋯ → Research, a dot on ⋯ when the user has something to do, and one place
 * in the toolbar — a quiet mark while changes go by themselves, the Send
 * button when the user sends by hand, an amber pill only when something needs
 * the user.
 *
 * Changes go by themselves by default (ResearchLink.sendMode 'auto'): after
 * two quiet minutes, when the user switches trees and when the page is left —
 * only to a running bridge, never by opening anything. The research writes a
 * send at once (an archive mirrors it; with an agent an edit of a documented
 * fact becomes a conflict) or keeps it for the user (`sync.auto: "off"`).
 * After a write the research's new version loads quietly when nothing here
 * changed since and nothing would be lost. An older research (no `accepts`)
 * keeps every old path unchanged.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { TreeId, PersonId, ResearchLink, ResearchSend, ResearchSendMode, StromData } from '../types.js';
import { formatLiveClock } from '../live-time.js';
import { isTreeStale } from '../tab-sync.js';
import { formatFlexDate } from '../dates.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { SettingsManager } from '../settings.js';
import { stripMedia } from '../attachments.js';
import {
    LiveStatus, contentFingerprint, fingerprintLike, sanitizeLiveStatus, sanitizeSyncReply, isSafariBrowser,
    parseLiveBridge, researchSchemeUrl, readResearchHeader, stabilizeIds, carryOverMedia, researchPersonRef, ResearchAccepts,
    researchIdsByContent, holdsResearchIds,
} from '../research-link.js';
import { loadResearchCopy } from '../research-copy.js';
import {
    noteResearchLinks, noteResearchWaiting, noteResearchBridgeStatus, storedResearchBridge, researchLinksEnabled,
    researchAutoState, patchResearchAutoState, researchAutoIntroSeen, noteResearchAutoIntroSeen, forgetResearchWaitingItems, anyResearchBridgeKnown,
} from '../research-device.js';
import {
    ResearchSyncState, ResearchSyncKind, researchSyncState, researchSyncWantsAttention, researchSyncUnsent,
    pendingSendFate, sourceReadings, THEN_LOAD_MAX_AGE_MS, researchSendVouches, conflictTakeovers,
} from '../research-sync.js';
import { uiModule } from './module.js';
import { researchWrittenList } from './research-changes-ui.js';
import {
    fetchWithTimeout, fetchGedcomText, postSync, onComputer, readTree, researchGedcom,
} from './research-ui.js';

/** The "told once" mark of sending held for want of the research's numbers (see tellResearchNoIds). */
const NO_IDS = 'no-ids';

/** What reading the research's numbers came to (researchReadIds). */
type NoIdsResult = { ok: true } | { ok: false; why: 'unavailable' | 'unreachable' | 'other-tree' | 'unmatched'; research?: StromData; header?: ReturnType<typeof readResearchHeader> };
/** How often the bridge is asked, the window visible: normally / while a send waits. */
const POLL_MS = 60_000;
const POLL_PENDING_MS = 30_000;
/** The bridge not answering while changes wait for it: asked more often, so it is found soon after it starts. */
const POLL_DOWN_MS = 15_000;
/** A status this fresh counts as "the bridge runs" without asking again. */
const FRESH_MS = 30_000;
/** Timeouts: the background ask, the ask before a send, the send itself (the research writes it, up to 20 s and then 202). */
const POLL_TIMEOUT_MS = 3000;
const PING_TIMEOUT_MS = 1500;
const SEND_TIMEOUT_MS = 120_000;
/** An answer younger than this is not asked again when the menu opens or the window comes back. */
const RECHECK_MS = 5000;
/** Quiet after the last edit before the state is worked out again. */
const RECOMPUTE_DEBOUNCE_MS = 1500;
/** Quiet after the last edit before the changes go by themselves. */
const AUTO_QUIET_MS = 120_000;
/** The ✓ on the mark after a write. */
const WRITTEN_MARK_MS = 2000;
/** The note under the mark about a new conflict. */
const CONFLICT_NOTE_MS = 8000;
/** A keepalive request body is capped at 64 kB: a bigger tree goes as a normal request. */
const KEEPALIVE_MAX_CHARS = 60_000;
/** The toolbar keeps a place for the research from this width (index.html has the same breakpoint). */
const TOOLBAR_MIN_WIDTH = 1180;

/** A Retry-After header (seconds) as ms, between 1 s and 30 s; 5 s when it says nothing usable. */
function retryAfterMs(value: string | null): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(30_000, Math.max(1000, n * 1000)) : 5000;
}

/** Researches that said nothing of what they take, asked once in this page whether they do now. */
const olderAsked = new Set<string>();

/** What the app knows about one research's bridge in this page. */
interface BridgeRuntime {
    up: boolean;
    checkedAt: number;
    status: LiveStatus | null;
    /** The last ask failed the way Safari fails (a TypeError on a local address). */
    blocked: boolean;
    /** It answered 503 (busy): asked again from this time (ms), sooner than a bridge that is down. */
    busyUntil?: number;
    /** Since when it does not answer (ms; 0 = it answers). */
    downSince: number;
}

const runtime = new Map<string, BridgeRuntime>();
/** Trees whose windows' lock this window holds now (see researchWindowLock). */
const heldLocks = new Set<TreeId>();
/** A send pending this long with no tries said is stuck: it goes again. */
const STUCK_PENDING_MS = 5 * 60 * 1000;
/** Edits unsent this long are "only in the browser" again (the storage pill shows). */
const RESEARCH_HOLD_MS = 10 * 60 * 1000;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
/** When the scheduled ask runs (ms). */
let pollDueAt = 0;
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let started = false;
/** The tree a send is on its way for (one at a time). */
let sendingTree: TreeId | null = null;
/** The quiet-time timer of the open tree. */
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let autoTimerTree: TreeId | null = null;
/** When the running quiet time ends (ms), for "sent at 16:57". */
let autoDueAt = 0;
/** Trees whose quiet time ran out while the bridge was not there: sent when it comes back. */
const autoDue = new Set<TreeId>();
/** The ✓ shown on the mark for a moment after a write. */
let justWritten: { treeId: TreeId; until: number } | null = null;
/** The open tree as last seen (a switch sends the one left). */
let lastActiveTree: TreeId | null = null;
/** The quiet load is replacing the tree: that is not the user's edit. */
let quietLoading = false;
/** A research version not loaded quietly (it would drop the user's images): not fetched again. */
let quietSkippedHead = '';
/** The fingerprints of the active tree, worked out lazily (cleared by every edit). */
let fpCache: { treeId: TreeId; current: string; matchesBase: boolean; base: string } | null = null;
/** The note under the mark (a new conflict, the first start of sending by itself). */
let note: { kind: 'conflict' | 'intro'; html: string; timer: ReturnType<typeof setTimeout> | null } | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const call = (method: string, arg = ''): string => `window.Strom.UI.${method}(${arg})`;

function safariBrowser(): boolean {
    return typeof navigator !== 'undefined' && isSafariBrowser(navigator.userAgent || '')
        && /apple/i.test(navigator.vendor || '');
}

function visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** The toolbar has the research's place (the mark, the button, the pill) at this width. */
function toolbarWide(): boolean {
    return typeof window === 'undefined' || window.innerWidth >= TOOLBAR_MIN_WIDTH;
}

/** "14:32" today, a date otherwise. */
function when(iso: string | undefined): string {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? formatLiveClock(t, Date.now(), getCurrentLanguage()) : '';
}

function whenMs(ms: number): string {
    return ms > 0 ? formatLiveClock(ms, Date.now(), getCurrentLanguage()) : '';
}

/** A dialog or an editor is open: the tree is not replaced under it. */
function anyDialogOpen(): boolean {
    return typeof document !== 'undefined' && !!document.querySelector('.modal-overlay.active');
}

/** Open conflicts per person (to tell which ones a write added). */
function openConflictCounts(data: StromData): Map<PersonId, number> {
    const out = new Map<PersonId, number>();
    for (const [id, p] of Object.entries(data.persons ?? {})) {
        const n = (p?.research?.conflicts ?? []).filter(c => c.status === 'open').length;
        if (n > 0) out.set(id as PersonId, n);
    }
    return out;
}

/** The app's persons the research's refs name ("P0012"), in order, found ones only. */
function personsByResearchRefs(data: StromData, refs: readonly string[]): PersonId[] {
    const out: PersonId[] = [];
    for (const ref of refs) {
        const hit = Object.entries(data.persons ?? {}).find(([, p]) => researchPersonRef(p?.refn) === ref);
        if (hit && !out.includes(hit[0] as PersonId)) out.push(hit[0] as PersonId);
    }
    return out;
}

/** What the research said about a write's conflicts (null count: it did not say). */
interface KnownConflicts {
    conflicts: number | null;
    refs: string[];
    /** The conflicts' own ids, when the reply names them. */
    ids?: string[];
}

/** The fingerprints of a tree's data against its research link. */
function fingerprintsOf(data: StromData, link: ResearchLink): { current: string; matchesBase: boolean } {
    return {
        current: contentFingerprint(data),
        matchesBase: !!link.fingerprint && fingerprintLike(data, link.fingerprint) === link.fingerprint,
    };
}

/** A status the bridge gave elsewhere (?live=, ?send=, following): it runs, and this is what it said. */
export function rememberBridgeStatus(researchId: string, status: LiveStatus): void {
    runtime.set(researchId, { up: true, checkedAt: Date.now(), status, blocked: false, downSince: 0 });
}

/** The research's name as its bridge said it (else the generic one). */
export function researchDisplayName(researchId: string): string {
    return runtime.get(researchId)?.status?.name || strings.research.defaultName;
}

/** How a tree's changes go to its research (missing: by themselves). */
export function researchSendMode(link: ResearchLink | undefined): ResearchSendMode {
    return link?.sendMode === 'manual' ? 'manual' : 'auto';
}

export const researchSyncMethods = uiModule({
    /** Start watching the active research tree (after the first render; once). */
    initResearchSync(): void {
        if (started || typeof window === 'undefined') return;
        started = true;
        lastActiveTree = DataManager.getCurrentTreeId();
        const changed = (): void => {
            fpCache = null;
            this.researchNoteTreeSwitch();
            if (recomputeTimer) clearTimeout(recomputeTimer);
            recomputeTimer = setTimeout(() => { recomputeTimer = null; this.refreshResearchSyncUi(); }, RECOMPUTE_DEBOUNCE_MS);
        };
        window.addEventListener('strom:file-copy', changed);
        window.addEventListener('strom:data-changed', changed);
        window.addEventListener('strom:user-change', (e) => {
            const treeId = (e as CustomEvent<{ treeId?: TreeId }>).detail?.treeId;
            if (treeId) this.researchNoteUserChange(treeId);
        });
        window.addEventListener('strom:tree-switched', () => {
            fpCache = null;
            this.researchNoteTreeSwitch();
            this.refreshResearchSyncUi();
            void this.pollResearchBridge();
        });
        // Back to the window: ask at once (a hidden window does not ask at all).
        // Leaving it: the changes go now (the quiet time may never end).
        document.addEventListener('visibilitychange', () => {
            if (visible()) this.refreshResearchStateSoon();
            else void this.researchAutoLeave();
        });
        window.addEventListener('focus', () => this.refreshResearchStateSoon());
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        window.addEventListener('resize', () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { resizeTimer = null; this.refreshResearchSyncUi(); }, 200);
        });
        // The note under the mark closes on Esc and on a click elsewhere.
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && note) this.closeResearchSyncNote(); });
        document.addEventListener('mousedown', (e) => {
            if (note && !(e.target as Element | null)?.closest?.('#research-sync-pill')) this.closeResearchSyncNote();
        }, true);
        void this.pollResearchBridge();
        this.researchAutoArm();
    },

    /** The active tree's research link, when the new behaviour applies to it (else null). */
    researchSyncLink(): { treeId: TreeId; link: ResearchLink } | null {
        if (DataManager.isViewMode()) return null;
        const treeId = DataManager.getCurrentTreeId();
        const link = treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
        return treeId && link ? { treeId, link } : null;
    },

    /**
     * Run `fn` as the only window of this app doing a research step for the
     * tree (Web Lock per tree; windows of the same browser share it).
     * `ifAvailable`: skip when another window holds it (the automatic steps);
     * else wait for it (a send by hand). Without Web Locks: just run.
     * Resolves whether `fn` ran.
     */
    async researchWindowLock(treeId: TreeId, ifAvailable: boolean, fn: () => Promise<void>): Promise<boolean> {
        const locks = (navigator as Navigator & { locks?: LockManager }).locks;
        // Held by this window already (the quiet load after its own send): go on.
        if (!locks?.request || heldLocks.has(treeId)) {
            await fn();
            return true;
        }
        let ran = false;
        await locks.request(`strom-research-${treeId}`, { ifAvailable }, async (lock) => {
            if (!lock) return;
            ran = true;
            heldLocks.add(treeId);
            try {
                await fn();
            } finally {
                heldLocks.delete(treeId);
            }
        });
        return ran;
    },

    /** What the research takes (its last status, else what it said before), or null. */
    researchAcceptsOf(researchId: string): ResearchAccepts | null {
        return runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts ?? null;
    },

    /** The research's last status in this page (null: not asked yet, or it did not answer). */
    researchStatusOf(researchId: string): LiveStatus | null {
        return runtime.get(researchId)?.status ?? null;
    },

    /** The research's version as its bridge said it in this page ('' = not asked yet, or not said). */
    researchBridgeVersion(researchId: string): string {
        return runtime.get(researchId)?.status?.version ?? '';
    },

    /** The research said what it takes (now or before): sending straight and the states are on. */
    researchSyncCapable(researchId: string): boolean {
        return !!(runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts);
    },

    /** It knows how much a transcript weighs (Research for this tree, "Transcription verified"). */
    researchTranscriptsCapable(researchId: string | undefined): boolean {
        if (!researchId) return false;
        const accepts = runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts;
        return !!accepts?.verified;
    },

    /** Agent or archive: the bridge's word (now or last time), else the file's (`_STROM_MODE`). */
    researchModeOf(researchId: string, link?: Pick<ResearchLink, 'mode'>): 'agent' | 'archive' {
        const accepts = runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts;
        // A bridge that does not say its mode (older) does not outweigh the file's archive.
        if (accepts && (accepts.modeSaid || link?.mode !== 'archive')) return accepts.mode;
        return link?.mode === 'archive' ? 'archive' : 'agent';
    },

    /**
     * The link as its transcripts weigh in the research: an archive takes them as leads
     * (a source the user ticked as verified aside), so the tree's setting is neither
     * offered there nor sent (`_STROM_TRANSCRIPTS`); it is kept for a switch to research.
     */
    researchTranscriptsLink<L extends Pick<ResearchLink, 'id' | 'transcripts' | 'mode'>>(link: L): L {
        return link.transcripts !== undefined && this.researchModeOf(link.id, link) === 'archive'
            ? { ...link, transcripts: undefined } : link;
    },

    /**
     * The active research tree's mode is known here: its bridge answered (now or
     * before), or its file says archive. Researches hand their bridge over
     * (1.11+); when this browser knows bridges of others but never heard of this
     * one's (it reached another browser, or the public app), the tree is neither
     * shown as working with an agent nor given its old "waiting for you". With
     * no bridge known at all (an older research, links from its file), as before.
     */
    activeResearchModeKnown(): boolean {
        const ctx = this.researchSyncLink();
        if (!ctx) return false;
        const id = ctx.link.id;
        return !!runtime.get(id)?.status || !!storedResearchBridge(id)?.base || ctx.link.mode === 'archive' || !anyResearchBridgeKnown();
    },

    /** Nothing that leads to an agent: an archive, or a research whose mode is not known here. */
    activeResearchNoAgent(): boolean {
        return this.activeResearchArchive() || !this.activeResearchModeKnown();
    },

    /** The active research tree is an archive (no agent): the agent's actions are not offered. */
    activeResearchArchive(): boolean {
        const ctx = this.researchSyncLink();
        return !!ctx && this.researchModeOf(ctx.link.id, ctx.link) === 'archive';
    },

    /** A send waits in the research's inbox for the user (`sync.auto: "off"`). */
    researchReviewOn(researchId: string): boolean {
        const accepts = runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts;
        return !!accepts?.review;
    },

    /** The tree's changes go by themselves (a research that tells what it has, not Safari). */
    researchAutoOn(link: ResearchLink | undefined): boolean {
        return !!link && researchSendMode(link) === 'auto' && this.researchSyncCapable(link.id) && !safariBrowser();
    },

    /** The bridge answered within FRESH_MS. */
    /** The bridge answered the last time it was asked (however long ago; polls keep it current). */
    researchBridgeUp(researchId: string): boolean {
        return !!runtime.get(researchId)?.up;
    },

    researchBridgeFresh(researchId: string): boolean {
        const rt = runtime.get(researchId);
        return !!rt?.up && Date.now() - rt.checkedAt < FRESH_MS;
    },

    /** The fingerprints of the active tree now (cached until the next edit). */
    researchSyncFingerprints(treeId: TreeId, link: ResearchLink): { current: string; matchesBase: boolean } {
        if (fpCache && fpCache.treeId === treeId && fpCache.base === link.fingerprint) return fpCache;
        const fps = fingerprintsOf(DataManager.getData(), link);
        fpCache = { treeId, ...fps, base: link.fingerprint };
        return fpCache;
    },

    /** The one state of the active tree (kind 'none': nothing new is shown). */
    currentResearchSyncState(): ResearchSyncState {
        const ctx = this.researchSyncLink();
        if (!ctx) return { kind: 'none', core: 'none' };
        const { treeId, link } = ctx;
        const shown = onComputer() && researchLinksEnabled() && !DataManager.isTreeLocked();
        const capable = this.researchSyncCapable(link.id);
        if (!shown || !capable) return { kind: 'none', core: 'none' };
        const rt = runtime.get(link.id);
        const fps = this.researchSyncFingerprints(treeId, link);
        const remoteHead = rt?.status?.head || storedResearchBridge(link.id)?.head || '';
        const safari = safariBrowser() && (!rt || rt.blocked || !storedResearchBridge(link.id)?.base);
        const auto = researchSendMode(link) === 'auto';
        const mode = this.researchModeOf(link.id, link);
        const st = researchAutoState(treeId);
        return researchSyncState({
            link, capable, shown,
            matchesBase: fps.matchesBase,
            current: fps.current,
            bridgeUp: !!rt?.up,
            safari,
            remoteHead,
            stale: isTreeStale(treeId),
            auto,
            archive: mode === 'archive',
            sending: sendingTree === treeId,
            autoDue: autoDue.has(treeId),
            written: st.lastWritten ?? null,
            switched: !!st.modeSeen && st.modeSeen !== mode,
            offerUnseen: !st.offerSeen,
            introDue: auto && !toolbarWide() && !researchAutoIntroSeen(),
        });
    },

    // ==================== ASKING THE BRIDGE ====================

    /** Ask a research's bridge for its status (short timeout); takes in what it says. Null: it does not answer. */
    async askResearchBridge(researchId: string, timeout: number): Promise<LiveStatus | null> {
        const bridge = parseLiveBridge(storedResearchBridge(researchId)?.base);
        if (!bridge) return null;
        let status: LiveStatus | null = null;
        let blocked = false;
        let busyFor = 0;
        try {
            const res = await fetchWithTimeout(`${bridge.status}?poll=1`, timeout);
            if (res.ok) status = sanitizeLiveStatus(await res.json());
            // Busy (starting up, a long write): ask again after the time it names.
            else if (res.status === 503) busyFor = retryAfterMs(res.headers.get('Retry-After'));
        } catch (err) {
            blocked = err instanceof TypeError;
        }
        // An address of another research (the port went to another tree's bridge): not ours.
        if (status && status.treeId !== researchId) status = null;
        const prev = runtime.get(researchId);
        const downSince = status ? 0 : (prev?.up || !prev?.downSince ? Date.now() : prev.downSince);
        runtime.set(researchId, { up: !!status, checkedAt: Date.now(), status, blocked: !status && blocked, downSince, busyUntil: busyFor ? Date.now() + busyFor : 0 });
        if (status) {
            noteResearchLinks(status.links);
            noteResearchWaiting(researchId, status.waiting, status);
            noteResearchBridgeStatus(researchId, status.accepts, status.head);
        }
        return status;
    },

    /**
     * Ask the active research's bridge how things are (`/status?poll=1`, short
     * timeout), take in what it says, settle a waiting send, send what waits
     * for it, load a written send's new version quietly, redraw. Schedules the
     * next ask. Never throws.
     */
    async pollResearchBridge(opts: { timeout?: number; reschedule?: boolean } = {}): Promise<boolean> {
        if (opts.reschedule !== false) this.scheduleResearchPoll();
        const ctx = this.researchSyncLink();
        if (!ctx || !onComputer() || !researchLinksEnabled()) return false;
        const researchId = ctx.link.id;
        // A research that said what it takes (at a ?live= / ?send=) is asked
        // on its own. One that did not (an older version) is asked once per
        // page, quietly: it may have been updated since, and then it says
        // what it takes and the tree goes on by itself. Nothing more unasked.
        const bridgeKnown = !!parseLiveBridge(storedResearchBridge(researchId)?.base);
        const capable = this.researchSyncCapable(researchId);
        if (!bridgeKnown || (!capable && olderAsked.has(researchId))) {
            this.refreshResearchSyncUi();
            return false;
        }
        if (!capable) olderAsked.add(researchId);
        if (polling && opts.timeout === undefined) return this.researchBridgeFresh(researchId);
        polling = true;
        let status: LiveStatus | null;
        try {
            status = await this.askResearchBridge(researchId, opts.timeout ?? POLL_TIMEOUT_MS);
        } finally {
            polling = false;
        }
        this.researchNoteMode(ctx.treeId);
        // The next ask by what this one found (down with changes waiting: soon).
        if (opts.reschedule !== false) this.scheduleResearchPoll();
        if (status) {
            await this.settleResearchSend(ctx.treeId, status);
            this.researchNoteUndone(ctx.treeId, status);
        }
        this.refreshResearchSyncUi();
        // Updated since: it takes sends now — what waits starts its quiet time.
        if (status && !capable && this.researchSyncCapable(researchId)) this.researchAutoArm();
        if (status && opts.reschedule !== false) void this.researchAutoCheck();
        // Originals waiting for it go while it answers.
        if (status) void this.researchOriginalsKick();
        return !!status;
    },

    /** Ask now unless the last answer is only seconds old (menu opened, window back). */
    refreshResearchStateSoon(): void {
        const ctx = this.researchSyncLink();
        const rt = ctx ? runtime.get(ctx.link.id) : undefined;
        if (rt && Date.now() - rt.checkedAt < RECHECK_MS) return;
        void this.pollResearchBridge();
    },

    /** Schedule the next ask; `onlySooner`: only when that comes sooner than the one already scheduled. */
    scheduleResearchPoll(onlySooner = false): void {
        const ctx = this.researchSyncLink();
        const waiting = ctx?.link.sent?.state === 'pending';
        const rt = ctx ? runtime.get(ctx.link.id) : undefined;
        // Down with changes the research lacks (sent by hand or by itself): look again soon.
        const downWithChanges = !!ctx && !!rt && !rt.up && this.researchSyncCapable(ctx.link.id)
            && (() => {
                const fps = this.researchSyncFingerprints(ctx.treeId, ctx.link);
                return !fps.matchesBase && fps.current !== ctx.link.sent?.fingerprint;
            })();
        const busy = rt?.busyUntil && rt.busyUntil > Date.now() ? Math.max(1000, rt.busyUntil - Date.now()) : 0;
        const delay = busy || (downWithChanges ? POLL_DOWN_MS : waiting ? POLL_PENDING_MS : POLL_MS);
        if (onlySooner && pollTimer && pollDueAt <= Date.now() + delay) return;
        if (pollTimer) clearTimeout(pollTimer);
        pollDueAt = Date.now() + delay;
        pollTimer = setTimeout(() => {
            pollTimer = null;
            if (visible()) void this.pollResearchBridge();
            else this.scheduleResearchPoll();
        }, delay);
    },

    /** The research's mode as first seen is remembered quietly; a later switch is said once. */
    researchNoteMode(treeId: TreeId): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || !this.researchSyncCapable(link.id)) return;
        const mode = this.researchModeOf(link.id, link);
        const st = researchAutoState(treeId);
        if (!st.modeSeen) patchResearchAutoState(treeId, { modeSeen: mode });
        else if (st.modeSeen !== mode && !st.modeSince) patchResearchAutoState(treeId, { modeSince: new Date().toISOString() });
        // An archive: the tasks it listed with an agent are not the user's any more.
        if (mode === 'archive') forgetResearchWaitingItems(link.id);
    },

    /** A send waiting in the research (its inbox, or still being written): written, discarded, or still there. */
    async settleResearchSend(treeId: TreeId, status: LiveStatus): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const sent = link?.sent;
        if (!link || !sent || sent.state !== 'pending') return;
        // "Send, then load" waits a day at most.
        if (sent.thenLoad && Date.now() - Date.parse(sent.at) > THEN_LOAD_MAX_AGE_MS) {
            TreeManager.patchResearchLink(treeId, { sent: { ...sent, thenLoad: false } });
        }
        const fate = pendingSendFate(sent, treeId, link.id, status);
        if (fate === null) return;
        if (fate.state === 'pending') {
            // Stuck: the research is not trying it again (no tries said) and
            // it has been a while — send again (a send is idempotent).
            const age = Date.now() - Date.parse(sent.at);
            if (!fate.tries && age > STUCK_PENDING_MS && DataManager.getCurrentTreeId() === treeId && !link.copy) {
                void this.postResearchSend(treeId, { auto: true, again: true });
            }
            return;
        }
        const closed: ResearchSend = {
            ...sent, state: fate.state, closedAt: fate.at || new Date().toISOString(),
            // A discard keeps the user's own words from the research; a failed write's bridge text is not shown.
            ...(fate.reason && !fate.failed ? { reason: fate.reason } : {}),
            ...(fate.nothing ? { changes: 0 } : {}),
            ...(fate.failed ? { failed: true } : {}),
            ...(fate.inherited ? { inherited: true } : {}),
        };
        delete closed.writing;
        TreeManager.patchResearchLink(treeId, { sent: closed });
        const s = strings.sync;
        if (fate.state === 'discarded') {
            if (!sent.noticed) {
                TreeManager.patchResearchLink(treeId, { sent: { ...closed, noticed: true } });
                this.showToast(fate.failed ? s.failedToast(when(sent.at)) : s.rejectedToast(when(sent.at), fate.reason), Infinity, {
                    closable: true,
                    action: { label: s.sendAgain, run: () => { void this.researchSendTree(treeId); } },
                });
            }
            return;
        }
        if (!fate.nothing) {
            patchResearchAutoState(treeId, { lastWritten: { at: closed.closedAt!, changes: closed.changes, conflicts: 0,
                ...(closed.intake ? { intake: closed.intake } : {}), fingerprint: closed.fingerprint } });
            this.researchNoteWritten(treeId, sent.fingerprint, closed.closedAt!);
        }
        // Written: "Send, then load" loads the version that has the changes now — not one that left
        // conflicts (it holds the research's values in place of the user's): told, it waits for the user.
        const leftConflicts = (fate.conflicts ?? 0) > 0;
        if (leftConflicts) TreeManager.patchResearchLink(treeId, { sent: { ...closed, conflicts: fate.conflicts! } });
        if (sent.thenLoad && !leftConflicts && DataManager.getCurrentTreeId() === treeId) {
            const fps = this.researchSyncFingerprints(treeId, link);
            if (fps.current === sent.fingerprint) await this.researchLoadNewer({ afterSend: true });
            else await this.researchLoadNewer();
            return;
        }
        // A write that took longer (202), or one that left conflicts: its result now, as the reply would have said it.
        if (sent.writing || leftConflicts) {
            await this.researchAfterWrite(treeId, closed,
                fate.conflicts !== undefined ? { conflicts: fate.conflicts ?? null, refs: fate.conflictPersons ?? [] } : undefined);
        }
    },

    /** When a send of this tree went, by the research's mark: its record there, else this app's own. */
    researchSendTime(treeId: TreeId, link: ResearchLink, intake: string): string {
        if (!intake) return '';
        const rec = runtime.get(link.id)?.status?.sends?.find(r => r.intake === intake);
        if (rec?.at) return rec.at;
        if (link.sent?.intake === intake) return link.sent.at;
        const lw = researchAutoState(treeId).lastWritten;
        return lw?.intake === intake ? lw.at : '';
    },

    /**
     * The research took a written send back (`strom sync undo`): the changes
     * are here and not there any more — "changes the research does not have"
     * again, told once; nothing goes by itself until the next edit, and the
     * research's version asks before it loads over them.
     */
    researchNoteUndone(treeId: TreeId, status: LiveStatus): void {
        const lw = researchAutoState(treeId).lastWritten;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!lw?.intake || !link || !status.sends) return;
        const rec = status.sends.find(r => r.intake === lw.intake);
        if (rec?.state !== 'undone') return;
        // The state now stands for the send taken back (the version loaded after the write is that state,
        // its ids from the research); edited since, the written state does, and the edits go again.
        const fps = this.researchSyncFingerprints(treeId, link);
        const fingerprint = fps.matchesBase || !lw.fingerprint ? fps.current : lw.fingerprint;
        TreeManager.patchResearchLink(treeId, {
            // No base any more: an update from the research asks first.
            fingerprint: '',
            sent: { fingerprint, at: lw.at, changes: lw.changes, head: '', state: 'undone', closedAt: rec.decidedAt || new Date().toISOString(),
                intake: lw.intake, noticed: true },
        });
        patchResearchAutoState(treeId, { lastWritten: undefined });
        fpCache = null;
        const s = strings.sync;
        this.showToast(s.undoneToast(when(lw.at)), Infinity, {
            closable: true,
            action: { label: s.sendAgain, run: () => { void this.researchSendTree(treeId); } },
        });
    },

    // ==================== SENDING BY ITSELF ====================

    /** The user edited a tree: count it, and the quiet time starts again. */
    researchNoteUserChange(treeId: TreeId): void {
        if (quietLoading) return;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || !this.researchSyncCapable(link.id)) return;
        fpCache = null;
        const st = researchAutoState(treeId);
        patchResearchAutoState(treeId, {
            edits: (st.edits ?? 0) + 1,
            ...(st.unsentSince ? {} : { unsentSince: new Date().toISOString() }),
        });
        autoDue.delete(treeId);
        // The bridge not answering and now changes wait for it: look for it sooner.
        if (DataManager.getCurrentTreeId() === treeId && !runtime.get(link.id)?.up) this.scheduleResearchPoll(true);
        if (DataManager.getCurrentTreeId() === treeId && this.researchAutoOn(link)) this.scheduleResearchAutoSend(treeId);
    },

    /** The open tree changed: the one left goes now (its quiet time would never end), the new one is watched. */
    researchNoteTreeSwitch(): void {
        const current = DataManager.getCurrentTreeId();
        if (current === lastActiveTree) return;
        const left = lastActiveTree;
        lastActiveTree = current;
        if (autoTimerTree === left) this.clearResearchAutoTimer();
        if (left) {
            const link = TreeManager.getTreeMetadata(left)?.research;
            if (this.researchAutoOn(link)) void this.researchAutoSend(left, 'switch');
        }
        this.researchAutoArm();
    },

    /** The open tree has changes that go by themselves and no timer runs: start the quiet time. */
    researchAutoArm(): void {
        const ctx = this.researchSyncLink();
        if (!ctx || !this.researchAutoOn(ctx.link) || autoTimerTree === ctx.treeId || autoDue.has(ctx.treeId)) return;
        const fps = this.researchSyncFingerprints(ctx.treeId, ctx.link);
        if (fps.matchesBase || fps.current === ctx.link.sent?.fingerprint) return;
        this.scheduleResearchAutoSend(ctx.treeId);
    },

    scheduleResearchAutoSend(treeId: TreeId, delay = AUTO_QUIET_MS): void {
        this.clearResearchAutoTimer();
        autoTimerTree = treeId;
        autoDueAt = Date.now() + delay;
        autoTimer = setTimeout(() => {
            autoTimer = null;
            autoTimerTree = null;
            autoDueAt = 0;
            void this.researchAutoSend(treeId, 'quiet');
        }, delay);
    },

    /** "16:57": when the open tree's quiet time ends and its changes go ('' = no timer runs for it). */
    researchAutoDueClock(treeId: TreeId | null | undefined): string {
        return treeId && autoTimerTree === treeId && autoDueAt > 0 ? when(new Date(autoDueAt).toISOString()) : '';
    },

    clearResearchAutoTimer(): void {
        if (autoTimer) clearTimeout(autoTimer);
        autoTimer = null;
        autoTimerTree = null;
        autoDueAt = 0;
    },

    /** Leaving the page (hidden): the open tree's changes go now, the request outliving the page when small. */
    async researchAutoLeave(): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx || !this.researchAutoOn(ctx.link)) return;
        this.clearResearchAutoTimer();
        await this.researchAutoSend(ctx.treeId, 'leave');
    },

    /**
     * Send a tree's changes by themselves, when everything allows it: the
     * tree sends by itself, the research did not stop it (a refusal), the
     * state is not the one sent or discarded already, nothing else is on its
     * way, and the bridge answers. The bridge not there: nothing is opened,
     * the changes wait ("not running") and go when it answers again.
     */
    async researchAutoSend(treeId: TreeId, why: 'quiet' | 'switch' | 'leave' | 'bridge' | 'newer'): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || !this.researchAutoOn(link) || link.refused) return;
        if (sendingTree) {
            // One at a time: the open tree tries again after the quiet time.
            if (sendingTree !== treeId && DataManager.getCurrentTreeId() === treeId) this.scheduleResearchAutoSend(treeId);
            return;
        }
        const active = DataManager.getCurrentTreeId() === treeId;
        if (active && (DataManager.isTreeLocked() || DataManager.isReadOnly())) return;
        const data = active ? DataManager.getData() : await readTree(treeId);
        if (!data) return;
        const fps = active ? this.researchSyncFingerprints(treeId, link) : fingerprintsOf(data, link);
        // Nothing the research lacks: its version, the state sent, or the state it discarded (sent again only after an edit).
        if (fps.matchesBase || fps.current === link.sent?.fingerprint) {
            autoDue.delete(treeId);
            return;
        }
        const up = this.researchBridgeFresh(link.id) || !!await this.askResearchBridge(link.id, PING_TIMEOUT_MS);
        if (!up) {
            autoDue.add(treeId);
            this.refreshResearchSyncUi();
            return;
        }
        // The research newer: load its version after the write.
        const newer = why === 'newer' || (active && this.currentResearchSyncState().core === 'unsentAndNewer');
        await this.postResearchSend(treeId, { auto: true, thenLoad: newer, keepalive: why === 'leave' });
    },

    /** After an answer from the bridge: what waited for it goes now; a written send's new version loads quietly. */
    async researchAutoCheck(): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const { treeId, link } = ctx;
        if (this.researchAutoOn(link) && this.researchBridgeFresh(link.id) && !sendingTree) {
            const kind = this.currentResearchSyncState().core;
            // Not sent, and the research has a newer version: send now (it loads after the write) — unless
            // that version is the one a write left conflicts in: it does not load after a send anyway, and
            // each edit would go at once (a new conflict each); then the quiet time as any edit.
            const conflictsLeft = (link.sent?.state === 'written' && (link.sent.conflicts ?? 0) > 0);
            if (kind === 'unsentAndNewer' && !conflictsLeft) { await this.researchAutoSend(treeId, 'newer'); return; }
            if (autoDue.has(treeId)) { await this.researchAutoSend(treeId, kind === 'unsentAndNewer' ? 'newer' : 'bridge'); return; }
        }
        await this.researchQuietLoad(treeId);
    },

    // ==================== SENDING ====================

    /** Is the bridge up right now? A fresh status, else a quick ask. */
    async researchBridgeReady(researchId: string): Promise<boolean> {
        if (this.researchBridgeFresh(researchId)) return true;
        const ctx = this.researchSyncLink();
        if (ctx?.link.id === researchId) return this.pollResearchBridge({ timeout: PING_TIMEOUT_MS, reschedule: false });
        return !!await this.askResearchBridge(researchId, PING_TIMEOUT_MS);
    },

    /**
     * "Send changes" (the Send button, the menus): straight to the bridge when
     * it runs (no dialog), else the old way through the terminal. `thenLoad`:
     * load the research's new version once the send is written there.
     */
    async researchSendNow(opts: { thenLoad?: boolean; treeId?: TreeId } = {}): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx || sendingTree) return;
        // Asked for one tree: never send another (the open tree changed meanwhile).
        if (opts.treeId && ctx.treeId !== opts.treeId) return;
        const { treeId, link } = ctx;
        if (!this.researchSyncCapable(link.id) || !await this.researchBridgeReady(link.id)) {
            // The old way: the research starts it in the terminal (?send= comes back).
            await this.sendTreeToResearch(treeId);
            return;
        }
        if (!await this.ensureLocalUnlocked()) return;
        await this.postResearchSend(treeId, { auto: false, thenLoad: opts.thenLoad });
    },

    /**
     * Post a tree to its research's bridge and take in the answer. By hand,
     * the result is told (a toast, the refusal dialog, the old way when the
     * bridge is gone); by itself, only what needs the user is (a refusal,
     * once per reason) and the mark shows the rest.
     */
    async postResearchSend(treeId: TreeId, opts: { auto: boolean; thenLoad?: boolean; keepalive?: boolean; again?: boolean }): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!link || sendingTree) return;
        const s = strings.sync;
        // Another window stored this tree since: what this one holds would
        // take back what that one has. Never send it; a reload brings it up to date.
        if (isTreeStale(treeId) || !await TreeManager.researchBaseMatches(treeId)) {
            console.warn('Not sending a stale copy of the tree to the research', treeId);
            if (!opts.auto) this.showToast(s.staleTab, 8000, { action: { label: strings.storageSafety.reload, run: () => window.location.reload() } });
            return;
        }
        // One window sends by itself (another window of this tree may be at it).
        if (opts.auto) {
            const ran = await this.researchWindowLock(treeId, true, () => this.postResearchSendNow(treeId, opts));
            // Another window is at it: this one tries again after the quiet time.
            if (!ran && DataManager.getCurrentTreeId() === treeId) this.scheduleResearchAutoSend(treeId);
            return;
        }
        await this.researchWindowLock(treeId, false, () => this.postResearchSendNow(treeId, opts));
    },

    /** The send itself (postResearchSend, under the windows' lock). */
    async postResearchSendNow(treeId: TreeId, opts: { auto: boolean; thenLoad?: boolean; keepalive?: boolean; again?: boolean; noIdsRetried?: boolean }): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!link || sendingTree) return;
        const s = strings.sync;
        const active = DataManager.getCurrentTreeId() === treeId;
        const data = active ? DataManager.getData() : await readTree(treeId);
        const bridge = parseLiveBridge(storedResearchBridge(link.id)?.base);
        if (!data || !bridge) return;
        const fps = active ? this.researchSyncFingerprints(treeId, link) : fingerprintsOf(data, link);
        if (fps.matchesBase) {
            TreeManager.patchResearchLink(treeId, { refused: undefined });
            if (!opts.auto) {
                this.showToast(s.nothingToast, 4000);
                if (opts.thenLoad) await this.researchLoadNewer();
            }
            this.refreshResearchSyncUi();
            return;
        }
        // A copy that went over without the research's numbers: never sent as it is (it would read
        // there as a second family tree) — its numbers first, from the research's version.
        if (link.awaitingIds && holdsResearchIds(data)) {
            // Its people carry the research's numbers already (the mark outlived them, e.g. set by a
            // refusal of a send that named them): nothing to wait for.
            TreeManager.patchResearchLink(treeId, { awaitingIds: undefined });
            patchResearchAutoState(treeId, { toldRefused: (researchAutoState(treeId).toldRefused ?? []).filter(r => r !== NO_IDS) });
        } else if (link.awaitingIds) {
            // Another tree (sent on a switch): it waits, and is told once it is open.
            if (!active) return;
            if (!await this.researchFetchIds(treeId)) {
                this.tellResearchNoIds(treeId, opts.auto);
                return;
            }
            if (!opts.auto) this.showToast(s.noIdsLoaded, 4000);
            return this.postResearchSendNow(treeId, opts);
        }
        const head = runtime.get(link.id)?.status?.head ?? '';
        // "Send again" by hand for a send the research took back (`strom sync undo`): the research
        // writes it again from what it kept, on the state it was sent from (POST /sync/<R…>/again,
        // 1.12). A copy sent instead reads there as "removed by the research": nothing written (finding 35).
        const again = !opts.auto && link.sent?.state === 'undone' && link.sent.intake ? link.sent : null;
        // What goes over is then the state that send had, not this one (edits since go after it).
        const sentFp = again ? again.fingerprint : fps.current;
        const gedcom = again ? '' : researchGedcom(data, meta?.name ?? '', {
            id: link.id, head: link.head, appTree: treeId, transcripts: this.researchTranscriptsLink(link).transcripts, sent: fps.current,
        });
        // What this send carries, person by person (what was written, once it is).
        if (!again) this.researchNoteSending(treeId, data, fps.current);
        sendingTree = treeId;
        if (autoTimerTree === treeId) this.clearResearchAutoTimer();
        this.refreshResearchSyncUi();
        let res: Response;
        try {
            res = await postSync(again ? `${bridge.base}/sync/${encodeURIComponent(again.intake!)}/again` : `${bridge.base}/sync`,
                gedcom, SEND_TIMEOUT_MS, !!opts.keepalive && gedcom.length < KEEPALIVE_MAX_CHARS);
        } catch (err) {
            console.warn('Sending to the research failed', err);
            sendingTree = null;
            const prev = runtime.get(link.id);
            runtime.set(link.id, { up: false, checkedAt: Date.now(), status: null, blocked: err instanceof TypeError,
                downSince: prev?.downSince || Date.now() });
            if (opts.auto) {
                autoDue.add(treeId);
                this.refreshResearchSyncUi();
            } else {
                this.refreshResearchSyncUi();
                await this.sendTreeToResearch(treeId);
            }
            return;
        }
        let reply = sanitizeSyncReply(null);
        try { reply = sanitizeSyncReply(await res.json()); } catch { /* a refusal without a reason */ }
        sendingTree = null;
        // Busy (503): not a refusal — it goes again at the next look.
        if (res.status === 503) {
            if (opts.auto) autoDue.add(treeId);
            this.refreshResearchSyncUi();
            return;
        }
        // Not kept there any more (only its last 30 sends), or a research without the way back: said, the bar stays.
        if (again && res.status === 404) {
            console.warn('The research does not keep the send taken back any more', again.intake, reply.code);
            this.refreshResearchSyncUi();
            this.tellResearchUndoneChoice(s.againGone);
            return;
        }
        // Refused as a copy without the research's numbers (`tree.no-ids`, 1.12): they come from its
        // version, then the send goes again (once).
        // A send that named the research's people refused so is the research's own matter (as
        // Strom Research rc.9 did): told as any refusal, never waiting for numbers it has.
        if (reply.code === 'tree.no-ids' && active && !holdsResearchIds(data)) {
            TreeManager.patchResearchLink(treeId, { awaitingIds: true });
            if (!opts.noIdsRetried && await this.researchFetchIds(treeId)) {
                if (!opts.auto) this.showToast(s.noIdsLoaded, 4000);
                return this.postResearchSendNow(treeId, { ...opts, noIdsRetried: true });
            }
            this.refreshResearchSyncUi();
            this.tellResearchNoIds(treeId, opts.auto);
            return;
        }
        if (!res.ok || !reply.ok) {
            // The bridge's own sentence is in the research's language: not put into this app's sentences
            // (until it sends a code to say it here). Its technical reason only as the dialog's details, to pass on.
            TreeManager.patchResearchLink(treeId, { refused: { reason: '', at: new Date().toISOString() } });
            this.refreshResearchSyncUi();
            if (opts.auto) this.tellResearchAutoStopped(treeId, '');
            else await this.showResearchRefused('', { ...opts, details: reply.reason });
            return;
        }
        const now = new Date().toISOString();
        // A send taken back, sent again, and the research still writes nothing: the changes are here
        // and not there — never shown as in step (finding 35). The bar stays; said why, with the way out.
        if (again && reply.changes === 0) {
            console.warn('Sent again after the research took it back, and it wrote nothing', again.intake);
            this.refreshResearchSyncUi();
            this.tellResearchUndoneChoice(s.againNothing);
            return;
        }
        // Written at once (the research's own word), or nothing it could take (0 changes).
        const writing = reply.inbox === false && reply.pending;
        const written = (reply.inbox === false && !reply.pending) || reply.changes === 0;
        const changes = reply.applied ?? reply.changes;
        const sent: ResearchSend = {
            fingerprint: sentFp, at: now, changes, head,
            ...(reply.intake ? { intake: reply.intake } : {}),
            state: written ? 'written' : 'pending',
            ...(written ? { closedAt: now } : {}),
            ...(opts.thenLoad && !written ? { thenLoad: true } : {}),
            ...(writing ? { writing: true } : {}),
            ...(opts.auto ? {} : { manual: true }),
        };
        // The copy still carries sends the research took back since its base (`undoneSince`, 1.12): what
        // it wrote stands, but the app and the research differ by those — never shown as in step, nor
        // loaded quietly over them. The bar "taken back" names the send taken back, at its own time
        // (findings 38, 39): Send again (theirs again) or load (the undo kept).
        const undone = !again && reply.undoneSince.length > 0;
        const undoneIntake = undone ? reply.undoneSince[reply.undoneSince.length - 1] : '';
        TreeManager.patchResearchLink(treeId, { refused: undefined, sentSources: sourceReadings(data),
            sent: undone ? { ...sent, at: this.researchSendTime(treeId, link, undoneIntake) || now, state: 'undone', intake: undoneIntake,
                closedAt: now, noticed: true } : sent });
        if (written && reply.changes !== 0) this.researchNoteWritten(treeId, sentFp, now);
        // Edits since the send taken back were not in it: they still wait.
        if (sentFp === fps.current) patchResearchAutoState(treeId, { edits: undefined, unsentSince: undefined, toldRefused: undefined });
        else patchResearchAutoState(treeId, { toldRefused: undefined });
        if (undone) {
            console.warn('The copy sent carries sends the research took back since', reply.undoneSince);
            this.refreshResearchSyncUi();
            this.tellResearchUndoneChoice(s.undoneSinceToast(reply.undoneSince.length));
            // This send itself was written: remembered and its conflicts told like any write (nothing loads —
            // the copy and the research differ by the send taken back).
            if (written && reply.changes !== 0) {
                await this.researchAfterWrite(treeId, sent,
                    reply.conflicts !== null ? { conflicts: reply.conflicts, refs: reply.conflictPersons, ids: reply.conflictIds } : undefined);
            }
            return;
        }
        autoDue.delete(treeId);
        // The commit the write made is the research's version now.
        if (written && reply.head) {
            const rt = runtime.get(link.id);
            if (rt?.status) runtime.set(link.id, { ...rt, status: { ...rt.status, head: reply.head } });
            noteResearchBridgeStatus(link.id, null, reply.head);
        }
        this.refreshResearchSyncUi();
        this.scheduleResearchPoll();
        if (reply.changes === 0) {
            if (!opts.auto) this.showToast(s.nothingToast, 4000);
        } else if (written) {
            // A write that left conflicts never loads after itself: told as any write (the note, the
            // conflicts), its version waits for the user — it holds the research's values in place of theirs.
            if (opts.thenLoad && active && !((reply.conflicts ?? 0) > 0)) {
                patchResearchAutoState(treeId, { lastWritten: { at: now, changes, conflicts: 0, ...(sent.intake ? { intake: sent.intake } : {}), fingerprint: sentFp } });
                if (!opts.auto) this.showToast(s.writtenToast(changes ?? 0), 6000);
                await this.researchLoadNewer({ afterSend: true });
            } else {
                await this.researchAfterWrite(treeId, sent,
                    reply.conflicts !== null ? { conflicts: reply.conflicts, refs: reply.conflictPersons, ids: reply.conflictIds } : undefined);
            }
        } else if (writing) {
            if (!opts.auto) this.showToast(strings.sync.markWriting, 4000);
        } else if (!opts.auto) {
            const open = this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.id }) : null;
            this.showToast(s.sentToast(reply.changes), 6000, open
                ? { action: { label: s.openResearch, run: () => this.launchResearchLink(open) } } : {});
        }
        // Written, but some changes it could not write and skipped (1.12): said in this app's words
        // (the research's `why` is its own text — shown once it sends a code to say it here).
        if (reply.skipped.length) {
            this.showToast(s.skippedToast(reply.skipped.length, ''), 12000, { closable: true });
        }
        // Edited while it was on its way: the quiet time starts again.
        this.researchAutoArm();
    },

    /**
     * A send the research wrote: remember it, show the ✓, load the new version
     * quietly when nothing here changed since, and tell the conflicts it left
     * (by hand: a toast; by itself: the note under the mark, for new ones only).
     */
    async researchAfterWrite(treeId: TreeId, sent: ResearchSend, known?: KnownConflicts): Promise<void> {
        const at = sent.closedAt ?? new Date().toISOString();
        const base = { at, changes: sent.changes, ...(sent.intake ? { intake: sent.intake } : {}), fingerprint: sent.fingerprint };
        patchResearchAutoState(treeId, { lastWritten: { ...base, conflicts: 0 } });
        justWritten = { treeId, until: Date.now() + WRITTEN_MARK_MS };
        setTimeout(() => { justWritten = null; this.renderResearchSyncPill(); }, WRITTEN_MARK_MS + 50);
        this.refreshResearchSyncUi();
        // Conflicts the research names in its reply: known before anything loads — the version keeps
        // the research's values in their place, so it is not loaded over the user's quietly.
        if (known && (known.conflicts ?? 0) > 0) {
            const now = TreeManager.getTreeMetadata(treeId)?.research;
            if (now?.sent && now.sent.at === sent.at) TreeManager.patchResearchLink(treeId, { sent: { ...now.sent, conflicts: known.conflicts! } });
        }
        const loaded = await this.researchQuietLoad(treeId);
        // The research's own word on the conflicts first; else what the new version shows.
        const active = DataManager.getCurrentTreeId() === treeId;
        const data = active ? DataManager.getData() : null;
        const persons = known && known.conflicts !== null
            ? (data ? personsByResearchRefs(data, known.refs) : [])
            : loaded?.conflictPersons ?? [];
        const conflicts = known && known.conflicts !== null ? known.conflicts : loaded?.conflicts ?? 0;
        if (conflicts > 0) {
            patchResearchAutoState(treeId, { lastWritten: { ...base, conflicts, persons: persons.slice(0, 20),
                ...(known?.ids?.length ? { conflictIds: known.ids.slice(0, 20) } : {}) } });
            const link = TreeManager.getTreeMetadata(treeId)?.research;
            if (link?.sent && link.sent.at === sent.at) TreeManager.patchResearchLink(treeId, { sent: { ...link.sent, conflicts } });
        }
        const s = strings.sync;
        if (sent.manual) {
            if (conflicts > 0) {
                this.showToast(s.writtenConflictToast(sent.changes ?? 0, conflicts), 8000,
                    { action: { label: s.showConflicts, run: () => this.researchShowConflicts(persons) } });
            } else {
                this.showToast(s.writtenToast(sent.changes ?? 0), 6000);
            }
        } else if (conflicts > 0) {
            this.showResearchConflictNote(conflicts, persons);
        }
        this.refreshResearchSyncUi();
    },

    /**
     * A copy that went over without the research's numbers (awaitingIds):
     * they come from the research's version. Unchanged since, that version
     * loads quietly; else its numbers go onto the people they belong to
     * (matched to what went over), the edits kept. True when the tree names
     * the research's people now.
     */
    async researchFetchIds(treeId: TreeId): Promise<boolean> {
        return (await this.researchReadIds(treeId)).ok;
    },

    /** researchFetchIds, saying why not: the research unreachable, its version another tree, or none of its people matched (with that version). */
    async researchReadIds(treeId: TreeId): Promise<NoIdsResult> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || DataManager.getCurrentTreeId() !== treeId || DataManager.isTreeLocked() || DataManager.isReadOnly()) return { ok: false, why: 'unavailable' };
        const bridge = parseLiveBridge(storedResearchBridge(link.id)?.base);
        if (!bridge) return { ok: false, why: 'unreachable' };
        let text: string;
        try {
            text = await fetchGedcomText(bridge.ged);
        } catch (err) {
            console.warn('Loading the research version for its numbers failed', err);
            return { ok: false, why: 'unreachable' };
        }
        const header = readResearchHeader(text);
        if (!header.isStromResearch || header.treeId !== link.id) {
            console.warn('The research version is not this tree', { stromResearch: header.isStromResearch, tree: header.treeId, expected: link.id });
            return { ok: false, why: 'other-tree' };
        }
        const research = convertToStrom(parseGedcom(text)).data;
        if (this.researchSyncFingerprints(treeId, link).matchesBase) {
            const done = await this.applyResearch(research, header, { quiet: true });
            return done === treeId && !TreeManager.getTreeMetadata(treeId)?.research?.awaitingIds
                ? { ok: true } : { ok: false, why: 'unavailable' };
        }
        const current = DataManager.getData();
        const kept = await loadResearchCopy(treeId);
        const base = kept ?? current;
        const next = researchIdsByContent(current, base, research);
        // Success is the tree naming the research's people — also when they all did already
        // (nothing new to number), never "none matched".
        if (!holdsResearchIds(next.data)) {
            const people = (d: StromData) => Object.values(d.persons ?? {}).filter(p => p && !p.isPlaceholder);
            console.warn('The research version names none of the people that went over', link.id, {
                theirs: people(research).length, theirsNumbered: people(research).filter(p => !!p.refn).length,
                wentOver: people(base).length, keptCopy: !!kept, hereNumberedOtherwise: people(current).filter(p => !!p.refn).length,
            });
            return { ok: false, why: 'unmatched', research, header };
        }
        if (next.persons + next.sources > 0) DataManager.replaceWithSourceData(next.data);
        // The kept version gets them too: changes per person stay the user's own.
        this.researchKeepCopy(treeId, researchIdsByContent(base, base, research).data, link.fingerprint);
        TreeManager.patchResearchLink(treeId, { awaitingIds: undefined });
        this.refreshResearchSyncUi();
        return { ok: true };
    },

    /** Not sent for want of the research's numbers: by hand a toast with "Load the research's version", by itself once. */
    tellResearchNoIds(treeId: TreeId, auto: boolean): void {
        if (auto) {
            const told = researchAutoState(treeId).toldRefused ?? [];
            if (told.includes(NO_IDS)) return;
            patchResearchAutoState(treeId, { toldRefused: [...told, NO_IDS] });
        }
        const s = strings.sync;
        this.showToast(s.noIdsToast, Infinity, {
            closable: true,
            action: { label: s.loadVersion, run: () => { void this.researchLoadIds(treeId); } },
        });
    },

    /**
     * "Load the research's version" for a copy without its numbers: then what
     * waits goes. When none of its people match what went over, the way out
     * is taking that version (over this tree, a backup kept, or as a new tree):
     * asked, never done by itself.
     */
    async researchLoadIds(treeId: TreeId): Promise<void> {
        if (DataManager.getCurrentTreeId() !== treeId || !await this.ensureLocalUnlocked()) return;
        const s = strings.sync;
        const got = await this.researchReadIds(treeId);
        if (!got.ok) {
            if (got.why === 'unmatched' && got.research && got.header) {
                if (!await this.showConfirm(s.noIdsUnmatched, s.noIdsUnmatchedTitle, { confirmLabel: s.loadVersion })) return;
                await this.applyResearch(got.research, got.header, { plainAsk: true });
                this.refreshResearchSyncUi();
                return;
            }
            this.showToast(got.why === 'other-tree' ? s.noIdsOtherTree : s.noIdsFailed, 6000);
            return;
        }
        patchResearchAutoState(treeId, { toldRefused: (researchAutoState(treeId).toldRefused ?? []).filter(r => r !== NO_IDS) });
        this.refreshResearchSyncUi();
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (link && !this.researchSyncFingerprints(treeId, link).matchesBase) {
            this.showToast(s.noIdsLoaded, 4000);
            await this.postResearchSend(treeId, { auto: false });
        }
    },

    /** Sending by itself stopped (the research refused): said once per reason, with "Send again". */
    tellResearchAutoStopped(treeId: TreeId, reason: string): void {
        const told = researchAutoState(treeId).toldRefused ?? [];
        if (told.includes(reason)) return;
        patchResearchAutoState(treeId, { toldRefused: [...told, reason] });
        const s = strings.sync;
        this.showToast(s.autoStoppedToast(reason), Infinity, {
            closable: true,
            action: { label: s.sendAgain, run: () => { void this.researchSendTree(treeId); } },
        });
    },

    /**
     * Load the research's version over the open tree without asking, after a
     * write: the last send was written there, nothing changed here since, no
     * dialog or editor is open, its head moved on, and nothing would be lost
     * (the app's images carried over; none belongs to a record the research dropped).
     * The view stays (zoom, place, focus); no toast. Returns the conflicts it
     * brought, or null when it did not load.
     */
    async researchQuietLoad(treeId: TreeId): Promise<{ conflicts: number; conflictPersons: PersonId[] } | null> {
        if (DataManager.getCurrentTreeId() !== treeId || DataManager.isTreeLocked() || DataManager.isReadOnly()) return null;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const sent = link?.sent;
        // Only a send that vouches for the research's version (something written, no conflict left).
        if (!link || !sent || !researchSendVouches(sent) || link.copy) return null;
        // Written as another window's send (it replaced ours), or this window's
        // copy is stale: what the research has is not this state — load on request only.
        if (sent.inherited || isTreeStale(treeId)) return null;
        // Following live refreshes the tree by itself.
        if (this.isFollowingActiveResearch()) return null;
        if (anyDialogOpen()) return null;
        if (this.researchSyncFingerprints(treeId, link).current !== sent.fingerprint) return null;
        const remote = runtime.get(link.id)?.status?.head ?? '';
        if (!remote || remote === link.head || remote === quietSkippedHead) return null;
        const bridge = parseLiveBridge(storedResearchBridge(link.id)?.base);
        if (!bridge) return null;
        let text: string;
        try {
            text = await fetchGedcomText(bridge.ged);
        } catch {
            return null;
        }
        const header = readResearchHeader(text);
        if (!header.isStromResearch || header.treeId !== link.id) return null;
        let data: StromData;
        try {
            data = convertToStrom(parseGedcom(text)).data;
        } catch {
            return null;
        }
        // Asked nothing: the setting decides about images (as following live).
        if (!SettingsManager.isImportImages()) data = stripMedia(data);
        // Meanwhile: an edit, a switch, a dialog — then not now.
        const fresh = TreeManager.getTreeMetadata(treeId)?.research;
        if (DataManager.getCurrentTreeId() !== treeId || !fresh || anyDialogOpen()) return null;
        fpCache = null;
        if (this.researchSyncFingerprints(treeId, fresh).current !== sent.fingerprint) return null;
        const previous = DataManager.getData();
        // The app's images stay with their people and sources; images of
        // records the research dropped would go — that is asked, never quiet.
        const carried = carryOverMedia(stabilizeIds(data, previous), previous);
        if (carried.lost > 0) {
            quietSkippedHead = header.head ?? remote;
            return null;
        }
        const stable = carried.data;
        // A conflict still open there over a value the user has here: their value would go (finding 37) —
        // that version is loaded only when asked.
        if (conflictTakeovers(previous, stable).length > 0) {
            quietSkippedHead = header.head ?? remote;
            return null;
        }
        const before = openConflictCounts(previous);
        // One window loads (another window of this tree may be at it too).
        if (!await this.researchWindowLock(treeId, true, async () => {
            // A backup of the state before (auto backups on): the load can be undone, and here is the proof.
            await DataManager.snapshotNow('pre-import');
            // Edited while the backup was written: then not now (the edit must not be loaded over).
            fpCache = null;
            const now = TreeManager.getTreeMetadata(treeId)?.research;
            if (DataManager.getCurrentTreeId() !== treeId || anyDialogOpen() || !now
                || this.researchSyncFingerprints(treeId, now).current !== sent.fingerprint) return;
            quietLoading = true;
            try {
                DataManager.loadStromData(stable);
            } finally {
                quietLoading = false;
            }
        }) || DataManager.getData() === previous) return null;
        const head = header.head || remote;
        TreeManager.setResearchLink(treeId, {
            id: link.id,
            fingerprint: contentFingerprint(DataManager.getData()),
            syncedAt: new Date().toISOString(),
            ...(head ? { head } : {}),
            ...(header.mode === 'archive' ? { mode: 'archive' as const } : {}),
        });
        patchResearchAutoState(treeId, { edits: undefined, unsentSince: undefined });
        fpCache = null;
        this.researchKeepCopy(treeId, DataManager.getData());
        const after = openConflictCounts(DataManager.getData());
        const conflictPersons: PersonId[] = [];
        let conflicts = 0;
        for (const [id, n] of after) {
            const added = n - (before.get(id) ?? 0);
            if (added > 0) {
                conflicts += added;
                conflictPersons.push(id);
            }
        }
        this.updateTreeSwitcher();
        await TreeRenderer.renderAsync();
        this.refreshSearch();
        this.refreshResearchSyncUi();
        return { conflicts, conflictPersons };
    },

    /** Tree menus' "Send changes": the same send for any tree (switched to first when a running research takes it straight). */
    async researchSendTree(treeId: TreeId, opts: { thenLoad?: boolean } = {}): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link) return;
        if (!this.researchSyncCapable(link.id)) {
            await this.sendTreeToResearch(treeId);
            return;
        }
        if (DataManager.getCurrentTreeId() !== treeId) {
            await this.switchToTree(treeId);
            if (DataManager.getCurrentTreeId() !== treeId) return;
        }
        await this.researchSendNow({ ...opts, treeId });
    },

    /** The bridge refused the send: say why, offer to try again. */
    async showResearchRefused(reason: string, opts: { thenLoad?: boolean; details?: string } = {}): Promise<void> {
        const s = strings.sync;
        const details = opts.details && opts.details !== reason ? s.refusedDetails(opts.details) : '';
        const message = [reason ? s.refusedReason(reason) : '', s.refusedBody, details].filter(Boolean).join('\n\n');
        const pick = await this.showChoice(message, s.refusedTitle, [{ id: 'retry', label: s.retry }], undefined,
            { cancelLabel: strings.buttons.close });
        if (pick === 'retry') await this.researchSendNow({ thenLoad: opts.thenLoad });
    },

    /**
     * Load the research's version: straight from the bridge when it runs (the
     * usual update path asks when the tree has changes), else the old link.
     * `afterSend`: the version holds the user's changes (they were sent and
     * written): replace without asking. Sending by itself to a research that
     * writes at once: changes it lacks go first and the version loads after
     * (no question — the write cannot lose them).
     */
    async researchLoadNewer(opts: { afterSend?: boolean } = {}): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const { treeId, link } = ctx;
        const bridge = parseLiveBridge(storedResearchBridge(link.id)?.base);
        if (bridge && await this.researchBridgeReady(link.id)) {
            if (!opts.afterSend && this.researchAutoOn(link) && !this.researchReviewOn(link.id) && !link.refused) {
                const fps = this.researchSyncFingerprints(treeId, link);
                if (!fps.matchesBase && fps.current !== link.sent?.fingerprint) {
                    await this.postResearchSend(treeId, { auto: true, thenLoad: true });
                    return;
                }
            }
            await this.importResearchFromUrl(`${bridge.base}/tree.ged`, opts.afterSend ? { afterSend: treeId } : {});
            return;
        }
        const url = this.activeResearchLink('app');
        if (url) this.launchResearchLink(url, 'version');
    },

    /** A send taken back that cannot go again as it is: why, and "Load the research's version" (the undo kept). */
    tellResearchUndoneChoice(message: string): void {
        this.showToast(message, Infinity, {
            closable: true,
            action: { label: strings.sync.loadVersion, run: () => { void this.researchAcceptUndo(); } },
        });
    },

    /**
     * Keep what the research took back: its version over this tree, asked
     * plainly (replace it, a backup kept, or open as a copy) — never "send
     * first", which would only send it again.
     */
    async researchAcceptUndo(): Promise<void> {
        const ctx = this.researchSyncLink();
        const bridge = ctx ? parseLiveBridge(storedResearchBridge(ctx.link.id)?.base) : null;
        if (!ctx || !bridge || !await this.researchBridgeReady(ctx.link.id)) {
            this.showToast(strings.sync.noIdsFailed, 6000);
            return;
        }
        await this.importResearchFromUrl(`${bridge.base}/tree.ged`, { plainAsk: true });
        this.refreshResearchSyncUi();
    },

    /** "Cancel loading": the send stays, the new version is not loaded by itself. */
    researchCancelThenLoad(): void {
        const ctx = this.researchSyncLink();
        const sent = ctx?.link.sent;
        if (!ctx || !sent) return;
        TreeManager.patchResearchLink(ctx.treeId, { sent: { ...sent, thenLoad: false } });
        this.refreshResearchSyncUi();
    },

    /** Switch how the tree's changes go; to "by themselves" with changes waiting starts the quiet time. */
    setResearchSendMode(treeId: TreeId, mode: ResearchSendMode): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || researchSendMode(link) === mode) return;
        TreeManager.patchResearchLink(treeId, { sendMode: mode });
        if (mode === 'manual') {
            if (autoTimerTree === treeId) this.clearResearchAutoTimer();
            autoDue.delete(treeId);
        } else {
            this.researchAutoArm();
        }
        this.refreshResearchSyncUi();
    },

    /** The conflicts a write left: one person — that person; more — "Waiting for you". */
    researchShowConflicts(persons: readonly PersonId[]): void {
        this.closeResearchSyncNote();
        this.closeActionsMenu();
        const live = persons.filter(id => DataManager.getPerson(id));
        if (live.length === 1) {
            const id = live[0];
            TreeRenderer.setFocus(id);
            ZoomPan.centerOnPerson(id);
            this.showPersonResearchDialog(id);
            return;
        }
        this.showResearchWaiting();
    },

    /** A button of the state block / pill / data row. */
    researchSyncAction(action: string): void {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const keepMenu = action === 'cancelLoad';
        if (!keepMenu) this.closeActionsMenu();
        switch (action) {
            case 'send': case 'retry': case 'sendAgain': void this.researchSendNow(); break;
            case 'acceptUndo': void this.researchAcceptUndo(); break;
            case 'sendThenLoad': void this.researchSendNow({ thenLoad: true }); break;
            case 'showChanges': this.showResearchChanges('send'); break;
            case 'showOriginals': this.showOriginalsQueue(); break;
            case 'showWritten': this.showResearchChanges('written'); break;
            case 'loadNewer': void this.researchLoadNewer(); break;
            case 'reload': window.location.reload(); break;
            case 'cancelLoad': this.researchCancelThenLoad(); break;
            case 'startResearch': {
                const url = this.activeResearchLink('open') ?? this.activeResearchLink('live');
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'startAndSend': void this.sendTreeToResearch(ctx.treeId); break;
            case 'openResearch': {
                const url = this.activeResearchLink('open');
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'downloadGedcom': void this.downloadResearchGedcom(ctx.treeId); break;
            case 'showConflicts': this.researchShowConflicts(this.researchWrittenConflictPersons(ctx.treeId)); break;
            case 'conflicts': this.openResearchSyncMenu(); break;
            case 'decideInResearch': {
                const url = this.researchDecideUrl(ctx.treeId);
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'gotIt':
                patchResearchAutoState(ctx.treeId, { modeSeen: this.researchModeOf(ctx.link.id, ctx.link) });
                this.refreshResearchSyncUi();
                break;
            case 'offerYes':
                patchResearchAutoState(ctx.treeId, { offerSeen: true });
                this.setResearchSendMode(ctx.treeId, 'auto');
                break;
            case 'offerNo':
                patchResearchAutoState(ctx.treeId, { offerSeen: true });
                this.refreshResearchSyncUi();
                break;
            case 'introSeen':
                noteResearchAutoIntroSeen();
                this.refreshResearchSyncUi();
                break;
            case 'introChange':
                noteResearchAutoIntroSeen();
                this.closeResearchSyncNote();
                void this.showResearchTreeSettings(ctx.treeId);
                this.refreshResearchSyncUi();
                break;
        }
    },

    /** The persons the last write's conflicts are about, while they are still open. */
    researchWrittenConflictPersons(treeId: TreeId): PersonId[] {
        const persons = (researchAutoState(treeId).lastWritten?.persons ?? []) as PersonId[];
        // The research's version not loaded: its new conflicts are not in this tree yet — the people it named.
        if (this.currentResearchSyncState().kind === 'writtenConflicts') return persons.filter(id => DataManager.getPerson(id));
        return persons.filter(id => this.personOpenConflicts(id).length > 0);
    },

    /** "Decide in the research ↗": the one open conflict of the one person, when the research announced the link. */
    researchDecideUrl(treeId: TreeId): string | null {
        if (!this.researchLinkAvailable('conflict')) return null;
        // The one conflict the write's reply named (it may not be in this tree yet).
        const named = researchAutoState(treeId).lastWritten?.conflictIds ?? [];
        if (named.length === 1) return this.activeResearchLink('conflict', { conflict: named[0], conflictDo: 'decide' });
        if (named.length > 1) return null;
        const persons = this.researchWrittenConflictPersons(treeId);
        if (persons.length !== 1) return null;
        const open = this.personOpenConflicts(persons[0]);
        return open.length === 1 && open[0].id ? this.activeResearchLink('conflict', { conflict: open[0].id, conflictDo: 'decide' }) : null;
    },

    /** What a delete adds in an archive the research already wrote to: it is set aside there, not lost. */
    researchArchiveDeleteNote(): { tag: string; text: string } | undefined {
        const ctx = this.researchSyncLink();
        if (!ctx || !onComputer() || !this.researchSyncCapable(ctx.link.id)) return undefined;
        if (this.researchModeOf(ctx.link.id, ctx.link) !== 'archive') return undefined;
        // The archive has the tree: it came from there, or a send was written there.
        if (!ctx.link.head && !researchAutoState(ctx.treeId).lastWritten) return undefined;
        return { tag: strings.sync.archiveTag, text: strings.sync.archiveDeleteNote };
    },

    // ==================== SHOWING IT ====================

    /** Redraw everything that shows the state (menu block, ⋯ dot, toolbar). */
    refreshResearchSyncUi(): void {
        this.refreshActionMenuBadges();
        this.renderResearchSyncPill();
        // "Only in browser" depends on what the research holds.
        this.refreshUnsavedForResearch();
    },

    /**
     * Does the research hold this tree's edits, so the "only in browser"
     * pill need not show? Yes when it has everything (in sync, or the last
     * send taken in), and while edits are fresh — they go within minutes;
     * no once they stay unsent for RESEARCH_HOLD_MS (the bridge down, refused,
     * by hand and not sent). `until`: when a "yes" turns into "no".
     * Only on a computer, for a research that says what it takes.
     */
    researchHoldsTree(treeId: TreeId, now = Date.now()): { holds: boolean; until?: number } {
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!link || !onComputer() || !researchLinksEnabled() || !this.researchSyncCapable(link.id)) return { holds: false };
        const st = researchAutoState(treeId);
        const sentGone = link.sent?.state === 'discarded' || link.sent?.state === 'undone';
        let unsent: boolean;
        if (treeId === DataManager.getCurrentTreeId()) {
            const fps = this.researchSyncFingerprints(treeId, link);
            unsent = !fps.matchesBase && (sentGone || fps.current !== link.sent?.fingerprint);
        } else {
            unsent = sentGone || !!st.unsentSince;
        }
        if (!unsent) return { holds: true };
        const since = Date.parse(st.unsentSince ?? (sentGone ? link.sent?.at ?? '' : meta?.changedAt ?? ''));
        if (!Number.isFinite(since)) return { holds: false };
        const until = since + RESEARCH_HOLD_MS;
        return now < until ? { holds: true, until } : { holds: false };
    },

    /** The state block at the top of ⋯ → Research ('' when there is none). */
    researchSyncBlockHtml(): string {
        const state = this.currentResearchSyncState();
        if (state.kind === 'none') return '';
        const s = strings.sync;
        const ctx = this.researchSyncLink();
        const link = ctx?.link;
        const treeId = ctx?.treeId;
        const archive = !!link && this.researchModeOf(link.id, link) === 'archive';
        const auto = researchSendMode(link) === 'auto';
        const autoState = treeId ? researchAutoState(treeId) : {};
        type Action = { action: string; label: string; asLink?: boolean };
        type Block = { tone: 'warn' | 'neutral' | 'quiet'; title: string; sub?: string; actions?: Action[]; tag?: boolean; spinner?: boolean };
        const changed = treeId ? when(TreeManager.getTreeMetadata(treeId)?.changedAt) : '';
        const edits = Math.max(1, autoState.edits ?? 1);
        const rt = link ? runtime.get(link.id) : undefined;
        const start: Action[] = this.researchLinkAvailable('open') || this.researchLinkAvailable('live')
            ? [{ action: 'startResearch', label: s.startResearch }] : [];
        const blocks: Record<Exclude<ResearchSyncKind, 'none'>, () => Block> = {
            inSync: () => ({ tone: 'quiet', title: s.stateInSync,
                sub: s.sinceTime(when(link?.sent?.state === 'written' ? link.sent.closedAt : link?.syncedAt)) }),
            written: () => {
                const lw = autoState.lastWritten;
                const persons = treeId ? this.researchWrittenConflictPersons(treeId) : [];
                // Known persons: while one of them still has an open conflict; unknown ones: the research's count.
                const conflicts = persons.length > 0 || !lw?.persons?.length ? lw?.conflicts ?? 0 : 0;
                const parts = [archive ? '' : lw?.changes ? s.changesN(lw.changes) : '', conflicts > 0 ? s.conflictsN(conflicts) : ''].filter(Boolean);
                const actions: Action[] = [];
                if (conflicts > 0) {
                    const one = persons.length === 1 ? DataManager.getPerson(persons[0]) : null;
                    const name = one ? `${one.firstName} ${one.lastName}`.trim() : '';
                    actions.push({ action: 'showConflicts', label: name ? `${name} ›` : `${s.showConflicts} ›`, asLink: true });
                    if (treeId && this.researchDecideUrl(treeId)) actions.push({ action: 'decideInResearch', label: s.decideInResearch, asLink: true });
                }
                return { tone: 'quiet', title: s.writtenAt(when(lw?.at)), sub: parts.join(' · ') || undefined, actions };
            },
            writtenConflicts: () => {
                const lw = autoState.lastWritten;
                const conflicts = Math.max(state.sent?.conflicts ?? 0, lw?.conflicts ?? 0, 1);
                const persons = (lw?.persons ?? []).filter(id => DataManager.getPerson(id as PersonId)) as PersonId[];
                const one = persons.length === 1 ? DataManager.getPerson(persons[0]) : null;
                const name = one ? `${one.firstName} ${one.lastName}`.trim() : '';
                const actions: Action[] = [];
                if (treeId && this.researchDecideUrl(treeId)) actions.push({ action: 'decideInResearch', label: s.decideInResearch, asLink: true });
                if (persons.length) actions.push({ action: 'showConflicts', label: name ? `${name} ›` : `${s.showConflicts} ›`, asLink: true });
                actions.push({ action: 'loadNewer', label: s.loadVersion, asLink: true });
                return { tone: 'neutral', title: s.flyConflict(conflicts), sub: [s.writtenAt(when(lw?.at ?? state.sent?.closedAt)), s.writtenConflictsSub].join(' · '), actions };
            },
            unsent: () => ({ tone: 'warn', title: s.stateUnsent, sub: changed ? s.changedAt(changed) : undefined, actions: [{ action: 'send', label: s.send }] }),
            sentPending: () => ({ tone: 'neutral', title: s.stateSent(when(state.sent?.at), state.sent?.changes ?? null),
                sub: s.statePendingSub, actions: this.researchLinkAvailable('open') ? [{ action: 'openResearch', label: s.openResearch, asLink: true }] : [] }),
            newer: () => {
                const at = rt?.status?.headAt;
                return { tone: 'neutral', title: s.stateNewer, sub: at ? s.fromTime(when(at)) : undefined, actions: [{ action: 'loadNewer', label: s.loadNewer }] };
            },
            unsentAndNewer: () => ({ tone: 'warn', title: s.stateUnsent, sub: s.unsentNewerSub, actions: [{ action: 'sendThenLoad', label: s.sendThenLoad }] }),
            waitThenLoad: () => ({ tone: 'neutral', title: s.stateSent(when(state.sent?.at), state.sent?.changes ?? null),
                sub: s.waitThenLoadSub, actions: [{ action: 'cancelLoad', label: s.cancelLoad, asLink: true }] }),
            bridgeDown: () => ({ tone: 'quiet', title: s.stateBridgeDown, sub: s.bridgeDownSub,
                actions: start.map(a => ({ ...a, asLink: true })) }),
            unsentBridgeDown: () => ({ tone: 'warn', title: s.stateUnsent, sub: s.unsentBridgeDownSub,
                actions: this.researchLinkAvailable('send') ? [{ action: 'startAndSend', label: s.startAndSend }] : [] }),
            refused: () => ({ tone: 'warn', title: s.stateRefused,
                sub: [state.reason, s.staysHere].filter(Boolean).join(' '), actions: [{ action: 'retry', label: s.retry }] }),
            rejected: () => state.sent?.state === 'undone'
                ? { tone: 'warn', title: s.stateUndone(when(state.sent?.at)),
                    sub: auto ? s.undoneAutoSub(when(state.sent?.closedAt)) : s.undoneSub(when(state.sent?.closedAt)),
                    actions: [{ action: 'sendAgain', label: s.sendAgain }, { action: 'acceptUndo', label: s.loadVersion, asLink: true }] }
                : state.sent?.failed
                    ? { tone: 'warn', title: s.stateFailed(when(state.sent?.at)), sub: s.failedSub(''),
                        actions: [{ action: 'sendAgain', label: s.sendAgain }] }
                : ({ tone: 'warn', title: s.stateRejected(when(state.sent?.at)),
                sub: auto
                    ? s.rejectedAutoSub(when(state.sent?.closedAt), state.sent?.reason ?? '')
                    : [s.rejectedSub(when(state.sent?.closedAt)), state.sent?.reason ? `(${state.sent.reason})` : ''].filter(Boolean).join(' '),
                actions: [{ action: 'sendAgain', label: s.sendAgain }] }),
            stale: () => ({ tone: 'warn', title: s.stateStale, sub: s.staleSub, actions: [{ action: 'reload', label: strings.storageSafety.reload }] }),
            safari: () => ({ tone: 'neutral', title: s.stateSafari, sub: s.safariSub, actions: [{ action: 'downloadGedcom', label: s.downloadGedcom, asLink: true }] }),
            autoWaiting: () => ({ tone: 'quiet', title: s.autoWaitingTitle,
                sub: [changed ? s.changedAt(changed) : '', this.researchAutoDueClock(treeId) ? s.autoSendsAt(this.researchAutoDueClock(treeId)) : ''].filter(Boolean).join(' · ') || undefined,
                actions: [{ action: 'send', label: s.sendNow, asLink: true }] }),
            sending: () => ({ tone: 'quiet', title: archive ? s.markWriting : s.markSending, spinner: true }),
            autoBridgeDown: () => archive
                ? { tone: 'warn', title: s.bridgeDownSince(whenMs(rt?.downSince ?? 0) || changed), sub: s.archiveBridgeDownSub(edits), actions: start }
                : { tone: 'warn', title: s.stateBridgeDown, sub: s.autoBridgeDownSub(changed), actions: start },
            autoPaused: () => ({ tone: 'warn', title: s.stateRefused,
                sub: [state.reason ? `${state.reason}.` : '', s.autoStoppedSub].filter(Boolean).join(' '), actions: [{ action: 'sendAgain', label: s.sendAgain }] }),
            switched: () => archive
                ? { tone: 'neutral', title: s.switchedToArchiveTitle, sub: s.switchedToArchiveSub, actions: [{ action: 'gotIt', label: s.gotIt, asLink: true }] }
                : { tone: 'neutral', title: s.switchedToAgentTitle, sub: s.switchedToAgentSub, actions: [{ action: 'gotIt', label: s.gotIt, asLink: true }], tag: false },
            offerAuto: () => ({ tone: 'neutral', title: s.offerAutoTitle, sub: s.offerAutoSub,
                actions: [{ action: 'offerYes', label: s.offerAutoYes }, { action: 'offerNo', label: s.offerAutoNo, asLink: true }] }),
            autoIntro: () => ({ tone: 'neutral', title: s.autoIntroTitle, sub: s.autoWhen,
                actions: [{ action: 'introSeen', label: s.gotIt, asLink: true }, { action: 'introChange', label: s.autoIntroChange, asLink: true }] }),
        };
        const b = blocks[state.kind]();
        // Changes per person: how many people, and "What will be sent ›" / "What was written ›".
        if (['unsent', 'autoWaiting', 'unsentBridgeDown', 'unsentAndNewer'].includes(state.kind)) {
            const list = this.researchChangesNow();
            if (list && list.length > 0) {
                b.sub = [strings.changes.personsChanged(list.length), b.sub].filter(Boolean).join(' · ');
                b.actions = [...(b.actions ?? []), { action: 'showChanges', label: strings.changes.whatWillBeSent, asLink: true }];
            }
        } else if (state.kind === 'written' && treeId && researchWrittenList(treeId)?.list.length) {
            b.actions = [...(b.actions ?? []), { action: 'showWritten', label: strings.changes.whatWasWritten, asLink: true }];
        }
        const sendingNow = !!treeId && sendingTree === treeId;
        const buttons = (b.actions ?? []).map(a => {
            const busy = sendingNow && !a.asLink && ['send', 'sendThenLoad', 'retry', 'sendAgain'].includes(a.action);
            return a.asLink
                ? `<button type="button" class="research-sync-link" data-action="${a.action}" onclick="${call('researchSyncAction', `'${a.action}'`)}">${esc(a.label)}</button>`
                : `<button type="button" class="primary btn-sm research-sync-btn" data-action="${a.action}"${busy ? ' disabled aria-busy="true"' : ''}`
                    + ` onclick="${call('researchSyncAction', `'${a.action}'`)}">${busy ? `<span class="research-sync-spinner" aria-hidden="true"></span>${esc(s.sending)}` : esc(a.label)}</button>`;
        }).join('');
        const tag = archive && b.tag !== false ? `<span class="research-sync-tag">${esc(s.archiveTag)}</span>` : '';
        return `<div class="research-sync-block research-sync-block--${b.tone}" id="research-sync-block" data-state="${state.kind}" role="status" aria-live="polite">`
            + tag
            + `<div class="research-sync-title">${b.spinner ? '<span class="research-sync-spinner" aria-hidden="true"></span>' : ''}${esc(b.title)}</div>`
            + (b.sub ? `<div class="research-sync-sub">${esc(b.sub)}</div>` : '')
            + (buttons ? `<div class="research-sync-actions">${buttons}</div>` : '')
            + this.originalsQueueLineHtml()
            + this.batchLineHtml()
            + '</div>';
    },

    /** The ⋯ dot and label for the sync state (refreshActionMenuBadges calls this). */
    researchSyncAttention(): boolean {
        const state = this.currentResearchSyncState();
        const kind = state.kind;
        const attention = researchSyncWantsAttention(kind) || this.originalsQueueWarn();
        const btn = document.querySelector<HTMLElement>('.actions-menu-btn');
        if (btn) {
            if (btn.dataset.baseLabel === undefined) btn.dataset.baseLabel = btn.getAttribute('aria-label') ?? '';
            btn.setAttribute('aria-label', researchSyncUnsent(kind) ? strings.sync.moreHint : btn.dataset.baseLabel || strings.menu.actions);
        }
        // Sent by hand: where the toolbar has no Send button, a dot on ⋯ instead (CSS hides it from 1180 px).
        const narrowDot = document.getElementById('actions-menu-research-dot');
        if (narrowDot) narrowDot.style.display = kind === 'unsent' ? 'block' : 'none';
        const rowDot = document.getElementById('actions-research-dot');
        if (rowDot) rowDot.style.display = attention || kind === 'unsent' ? 'inline-block' : 'none';
        return attention;
    },

    /**
     * The research's one place in the toolbar: the amber pill when something
     * needs the user; sent by hand, the Send button while changes wait and
     * the bridge runs; sent by itself, the quiet mark (it stays, so the
     * toolbar does not move while a send goes).
     */
    renderResearchSyncPill(): void {
        const pill = document.getElementById('research-sync-pill');
        if (!pill) return;
        const state = this.currentResearchSyncState();
        const kind = state.core;
        const s = strings.sync;
        const ctx = this.researchSyncLink();
        const link = ctx?.link;
        const auto = this.researchAutoOn(link);
        const archive = !!link && this.researchModeOf(link.id, link) === 'archive';
        const hide = (): void => {
            pill.style.display = 'none';
            pill.innerHTML = '';
            pill.dataset.html = '';
            pill.className = 'storage-pill research-sync-pill';
            this.closeResearchSyncNote();
        };
        if (kind === 'none' || !ctx) { hide(); return; }
        const set = (cls: string, html: string, title = ''): void => {
            pill.style.display = '';
            pill.className = `storage-pill research-sync-pill ${cls}`;
            if (title) pill.title = title;
            else pill.removeAttribute('title');
            const full = html + (note ? `<div class="research-sync-note" role="status">${note.html}</div>` : '');
            if (pill.dataset.html !== full) {
                pill.innerHTML = full;
                pill.dataset.html = full;
            }
        };
        // Attention: the amber pill (sent by hand, only when changes would be lost).
        const warn: Partial<Record<ResearchSyncKind, { text: string; button: string; action: string }>> = {
            unsentAndNewer: { text: s.barUnsent, button: s.barSend, action: 'sendThenLoad' },
            stale: { text: s.pillStale, button: strings.storageSafety.reload, action: 'reload' },
            // A write left conflicts: they stay in sight until decided or the version is loaded (finding 40).
            writtenConflicts: { text: s.flyConflict(Math.max(state.sent?.conflicts ?? 0, 1)), button: s.showConflicts, action: 'conflicts' },
            ...(auto ? {
                autoBridgeDown: { text: archive ? s.pillBridgeDownWaiting(Math.max(1, researchAutoState(ctx.treeId).edits ?? 1)) : s.pillBridgeDown,
                    button: s.pillStart, action: 'startResearch' },
                autoPaused: { text: s.pillRefused, button: s.sendAgain, action: 'retry' },
                rejected: { text: state.sent?.state === 'undone' ? s.pillUndone : state.sent?.failed ? s.pillFailed : s.pillRejected, button: s.sendAgain, action: 'sendAgain' },
            } : {}),
        };
        const w = warn[kind];
        // A new conflict's note (with the person) first; the pill once it goes.
        const noteFirst = kind === 'writtenConflicts' && note?.kind === 'conflict';
        if (w && !noteFirst && (w.action !== 'startResearch' || this.researchLinkAvailable('open') || this.researchLinkAvailable('live'))) {
            this.closeResearchSyncNote();
            set('is-warn', '<span class="research-sync-pill-mark" aria-hidden="true">!</span>'
                + `<span class="research-sync-pill-label" onclick="${call('openResearchSyncMenu')}">${esc(w.text)}</span>`
                + `<button type="button" class="research-sync-pill-send" data-action="${w.action}" onclick="event.stopPropagation(); ${call('researchSyncAction', `'${w.action}'`)}">${esc(w.button)}</button>`,
                // The research's reason, when it gave one, on hover too (not only in the block).
                kind === 'rejected' && !state.sent?.failed && state.sent?.reason ? `${w.text}: ${state.sent.reason}` : w.text);
            pill.setAttribute('aria-live', 'polite');
            return;
        }
        // Originals waiting 3 days or more, or their space nearly full: the amber pill "Originals waiting"
        // (not over the Send button while changes wait to go by hand).
        if (this.originalsQueueWarn() && (auto || kind !== 'unsent') && !safariBrowser()) {
            this.closeResearchSyncNote();
            const canStart = this.researchLinkAvailable('open') || this.researchLinkAvailable('live');
            const action = canStart ? 'startResearch' : 'showOriginals';
            set('is-warn is-media', '<span class="research-sync-pill-mark" aria-hidden="true">!</span>'
                + `<span class="research-sync-pill-label" onclick="${call('showOriginalsQueue')}">${esc(strings.mediaQueue.pill)}</span>`
                + `<button type="button" class="research-sync-pill-send" data-action="${action}" onclick="event.stopPropagation(); ${call('researchSyncAction', `'${action}'`)}">`
                + `${esc(canStart ? s.pillStart : strings.mediaQueue.show)}</button>`, strings.mediaQueue.pill);
            pill.setAttribute('aria-live', 'polite');
            return;
        }
        pill.removeAttribute('aria-live');
        if (kind === 'waitThenLoad') {
            set('is-wait', '<span class="research-sync-spinner" aria-hidden="true"></span>'
                + `<span class="research-sync-pill-label" onclick="${call('openResearchSyncMenu')}">${esc(s.waitThenLoad)}</span>`, s.waitThenLoad);
            return;
        }
        // Sent by hand: the Send button while changes wait and the bridge runs.
        if (!auto) {
            if (safariBrowser()) { hide(); return; }
            // Nothing to send: the button's place stays (empty), so the toolbar does not move when it comes.
            if (kind !== 'unsent') {
                // In its place the quiet mark (in step, or the research not running), at the end next to the tree switcher.
                const down = kind === 'bridgeDown' || kind === 'unsentBridgeDown';
                const lwm = researchAutoState(ctx.treeId).lastWritten;
                const label = down ? s.markBridgeDown(lwm ? when(lwm.at) : '') : lwm ? s.writtenAt(when(lwm.at)) : s.stateInSync;
                set('is-send is-reserved', `<button type="button" class="research-sync-mark research-sync-mark--reserved" id="research-sync-mark" data-look="${down ? 'ghost' : 'dot'}"`
                    + ` title="${esc(label)}" aria-label="${esc(label)}" onclick="${call('openResearchSyncMenu')}">`
                    + `<span class="research-sync-mark-${down ? 'ghost' : 'dot'}" aria-hidden="true"></span></button>`
                    + `<span class="research-sync-send research-sync-send--placeholder" aria-hidden="true">`
                    + `<span class="research-sync-send-long">${esc(s.sendButton)}</span><span class="research-sync-send-short">${esc(s.barSend)}</span></span>`
                    + this.researchSendMoreHtml(true));
                return;
            }
            const busy = sendingTree === ctx.treeId;
            // Split: "Send to research | 3 ⌄", the second part shows who changed (A2).
            const more = this.researchSendMoreHtml(busy);
            set(`is-send${more.startsWith('<button') ? ' is-split' : ''}`, `<button type="button" class="research-sync-send" id="research-sync-send"${busy ? ' disabled aria-busy="true"' : ''}`
                + ` title="${esc(s.sendButtonTitle)}" onclick="${call('researchSyncAction', "'send'")}">`
                + (busy
                    ? `<span class="research-sync-spinner" aria-hidden="true"></span><span>${esc(s.sending)}</span>`
                    : `<span class="research-sync-send-long">${esc(s.sendButton)}</span><span class="research-sync-send-short">${esc(s.barSend)}</span>`)
                + '</button>' + more);
            return;
        }
        // Sent by itself: the mark, always there (the toolbar does not move while a send goes).
        const lw = researchAutoState(ctx.treeId).lastWritten;
        const writtenAt = lw ? s.writtenAt(when(lw.at)) : s.stateInSync;
        let look: 'ring' | 'spin' | 'check' | 'dot' | 'ghost';
        let label: string;
        if (justWritten && justWritten.treeId === ctx.treeId && Date.now() < justWritten.until) {
            look = 'check';
            label = [writtenAt, lw?.changes ? s.changesN(lw.changes) : ''].filter(Boolean).join(' · ');
        } else if (kind === 'sending') {
            look = 'spin';
            label = archive ? s.markWriting : s.markSending;
        } else if (kind === 'autoWaiting') {
            look = 'ring';
            label = s.markWaiting(this.researchAutoDueClock(ctx.treeId));
        } else if (kind === 'sentPending') {
            look = 'ring';
            label = s.markPending(when(state.sent?.at));
        } else if (kind === 'bridgeDown' || kind === 'autoBridgeDown') {
            look = 'ghost';
            label = s.markBridgeDown(lw ? when(lw.at) : '');
        } else {
            look = 'dot';
            label = writtenAt;
        }
        set('is-mark', `<button type="button" class="research-sync-mark" id="research-sync-mark" data-look="${look}"`
            + ` title="${esc(label)}" aria-label="${esc(label)}" onclick="${call('openResearchSyncMenu')}">`
            + (look === 'spin' ? '<span class="research-sync-spinner" aria-hidden="true"></span>'
                : look === 'check' ? '<span class="research-sync-mark-check" aria-hidden="true">✓</span>'
                : `<span class="research-sync-mark-${look}" aria-hidden="true"></span>`)
            + '</button>');
        // The first time the mark shows on this install: say once that changes now go by themselves.
        if (!note && toolbarWide() && !researchAutoIntroSeen()) this.showResearchIntroNote();
    },

    /** The pill's text: open ⋯ → Research. */
    openResearchSyncMenu(): void {
        this.closeResearchSyncNote();
        this.toggleActionsMenu();
        if (document.getElementById('actions-menu-dropdown')?.classList.contains('active')) this.openActionsResearchSubmenu();
    },

    /** The note under the mark: a send by itself left a new conflict. */
    showResearchConflictNote(conflicts: number, persons: readonly PersonId[]): void {
        const s = strings.sync;
        const one = persons.length === 1 ? DataManager.getPerson(persons[0]) : null;
        const name = one ? `${one.firstName} ${one.lastName}`.trim() : '';
        // No room for the note under the mark: a toast says it, with the way to the conflicts.
        if (!toolbarWide()) {
            this.showToast(s.flyConflict(conflicts), CONFLICT_NOTE_MS,
                { action: { label: name || s.showConflicts, run: () => this.researchShowConflicts([...persons]) } });
            return;
        }
        const ids = JSON.stringify(persons).replace(/"/g, '&quot;');
        this.setResearchSyncNote('conflict', `<span class="research-sync-note-text">${esc(s.flyConflict(conflicts))}</span>`
            + `<button type="button" class="research-sync-note-link" onclick="${call('researchShowConflicts', ids)}">${esc(name || s.showConflicts)} ›</button>`
            + `<button type="button" class="research-sync-note-x" aria-label="${esc(strings.buttons.close)}" onclick="${call('closeResearchSyncNote')}">&times;</button>`,
        CONFLICT_NOTE_MS);
    },

    /** The note under the mark at its first appearance: changes now go by themselves. */
    showResearchIntroNote(): void {
        const s = strings.sync;
        this.setResearchSyncNote('intro', `<span class="research-sync-note-text">${esc(s.autoIntro)}</span>`
            + `<button type="button" class="research-sync-note-link" onclick="${call('researchSyncAction', "'introChange'")}">${esc(s.autoIntroChange)}</button>`
            + `<button type="button" class="research-sync-note-x" aria-label="${esc(strings.buttons.close)}" onclick="${call('closeResearchSyncNote')}">&times;</button>`,
        0);
    },

    setResearchSyncNote(kind: 'conflict' | 'intro', html: string, ms: number): void {
        if (note?.timer) clearTimeout(note.timer);
        note = { kind, html, timer: ms > 0 ? setTimeout(() => this.closeResearchSyncNote(), ms) : null };
        const pill = document.getElementById('research-sync-pill');
        if (pill) pill.dataset.html = '';
        this.renderResearchSyncPill();
    },

    closeResearchSyncNote(): void {
        if (!note) return;
        if (note.timer) clearTimeout(note.timer);
        if (note.kind === 'intro') noteResearchAutoIntroSeen();
        const wasConflict = note.kind === 'conflict';
        note = null;
        const pill = document.getElementById('research-sync-pill');
        pill?.querySelector('.research-sync-note')?.remove();
        if (pill) pill.dataset.html = pill.innerHTML;
        // The conflicts it told may still wait (the pill says so from now on).
        if (wasConflict) this.renderResearchSyncPill();
    },

    /** The row in "Where your data is" while the research lacks the changes (null otherwise). */
    researchSyncDataRow(): HTMLElement | null {
        const kind = this.currentResearchSyncState().kind;
        if (!researchSyncUnsent(kind)) return null;
        const s = strings.sync;
        const row = document.createElement('div');
        row.className = 'storage-status-research';
        const label = document.createElement('span');
        label.className = 'storage-status-research-label';
        const strong = document.createElement('strong');
        strong.textContent = s.dataRowLabel;
        label.append(strong, document.createTextNode(` ${s.stateUnsent}`));
        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'link-button storage-status-research-send';
        send.textContent = s.barSend;
        send.onclick = () => {
            this.closeStorageStatusDialog();
            void this.researchSendNow();
        };
        row.append(label, send);
        return row;
    },

    /** "Research for this tree": the line about how things stand (null: nothing to say). */
    researchTreeStatusLine(treeId: TreeId): { text: string; warn: boolean; action?: string } | null {
        const t = strings.treeSettings;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link) return null;
        if (safariBrowser()) return { text: t.statusSafari, warn: true };
        const auto = researchSendMode(link) === 'auto';
        const archive = this.researchModeOf(link.id, link) === 'archive';
        const st = researchAutoState(treeId);
        const lastLine = st.lastWritten ? { text: t.statusLast(when(st.lastWritten.at), st.lastWritten.changes ?? 0), warn: false } : null;
        if (link.awaitingIds) return { text: t.statusNoIds, warn: true, action: 'loadVersion' };
        if (DataManager.getCurrentTreeId() !== treeId) return lastLine;
        const state = this.currentResearchSyncState();
        switch (state.core) {
            case 'autoPaused': return { text: t.statusStopped(state.reason ?? ''), warn: true, action: 'sendAgain' };
            case 'refused': return { text: state.reason ? `${strings.sync.stateRefused}: ${state.reason}.` : `${strings.sync.stateRefused}.`, warn: true, action: 'sendAgain' };
            case 'rejected': return { text: state.sent?.state === 'undone' ? t.statusUndone(when(state.sent?.at)) : t.statusRejected(when(state.sent?.at)), warn: true, action: 'sendAgain' };
            case 'sentPending': case 'waitThenLoad': return { text: strings.sync.markPending(when(state.sent?.at)), warn: false };
            case 'autoBridgeDown':
                if (archive) {
                    const rt = runtime.get(link.id);
                    return { text: t.statusArchiveBridgeDown(whenMs(rt?.downSince ?? 0), Math.max(1, st.edits ?? 1)), warn: true };
                }
                return { text: t.statusBridgeDown, warn: false };
            case 'bridgeDown': case 'unsentBridgeDown': return { text: t.statusBridgeDown, warn: false };
            default:
                if (!auto && !lastLine) return null;
                return lastLine;
        }
    },

    /** "Research for this tree": when the research last switched mode, said by date. */
    researchModeSinceLine(treeId: TreeId): string {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const since = researchAutoState(treeId).modeSince;
        if (!link || !since) return '';
        const d = new Date(since);
        const date = formatFlexDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        return this.researchModeOf(link.id, link) === 'archive'
            ? strings.treeSettings.modeArchiveSince(date) : strings.treeSettings.modeAgentSince(date);
    },
});
