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
import { formatFlexDate } from '../dates.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { SettingsManager } from '../settings.js';
import { stripMedia } from '../attachments.js';
import {
    LiveStatus, contentFingerprint, fingerprintLike, sanitizeLiveStatus, sanitizeSyncReply, isSafariBrowser,
    parseLiveBridge, researchSchemeUrl, readResearchHeader, stabilizeIds,
} from '../research-link.js';
import {
    noteResearchLinks, noteResearchWaiting, noteResearchBridgeStatus, storedResearchBridge, researchLinksEnabled,
    researchAutoState, patchResearchAutoState, researchAutoIntroSeen, noteResearchAutoIntroSeen,
} from '../research-device.js';
import {
    ResearchSyncState, ResearchSyncKind, researchSyncState, researchSyncWantsAttention, researchSyncUnsent,
    pendingSendFate, sourceReadings, THEN_LOAD_MAX_AGE_MS,
} from '../research-sync.js';
import { uiModule } from './module.js';
import {
    fetchWithTimeout, fetchGedcomText, postSync, onComputer, readTree, researchGedcom, imagesDroppedBy,
} from './research-ui.js';

/** How often the bridge is asked, the window visible: normally / while a send waits. */
const POLL_MS = 60_000;
const POLL_PENDING_MS = 30_000;
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

/** What the app knows about one research's bridge in this page. */
interface BridgeRuntime {
    up: boolean;
    checkedAt: number;
    status: LiveStatus | null;
    /** The last ask failed the way Safari fails (a TypeError on a local address). */
    blocked: boolean;
    /** Since when it does not answer (ms; 0 = it answers). */
    downSince: number;
}

const runtime = new Map<string, BridgeRuntime>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let started = false;
/** The tree a send is on its way for (one at a time). */
let sendingTree: TreeId | null = null;
/** The quiet-time timer of the open tree. */
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let autoTimerTree: TreeId | null = null;
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
    researchModeOf(researchId: string, link?: ResearchLink): 'agent' | 'archive' {
        const accepts = runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts;
        if (accepts) return accepts.mode;
        return link?.mode === 'archive' ? 'archive' : 'agent';
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
        try {
            const res = await fetchWithTimeout(`${bridge.status}?poll=1`, timeout);
            if (res.ok) status = sanitizeLiveStatus(await res.json());
        } catch (err) {
            blocked = err instanceof TypeError;
        }
        // An address of another research (the port went to another tree's bridge): not ours.
        if (status && status.treeId !== researchId) status = null;
        const prev = runtime.get(researchId);
        const downSince = status ? 0 : (prev?.up || !prev?.downSince ? Date.now() : prev.downSince);
        runtime.set(researchId, { up: !!status, checkedAt: Date.now(), status, blocked: !status && blocked, downSince });
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
        // Only a research that said what it takes (at a ?live= / ?send=) is
        // asked on its own; an older one is never contacted unasked.
        if (!parseLiveBridge(storedResearchBridge(researchId)?.base) || !this.researchSyncCapable(researchId)) {
            this.refreshResearchSyncUi();
            return false;
        }
        if (polling && opts.timeout === undefined) return this.researchBridgeFresh(researchId);
        polling = true;
        let status: LiveStatus | null;
        try {
            status = await this.askResearchBridge(researchId, opts.timeout ?? POLL_TIMEOUT_MS);
        } finally {
            polling = false;
        }
        this.researchNoteMode(ctx.treeId);
        if (status) await this.settleResearchSend(ctx.treeId, status);
        this.refreshResearchSyncUi();
        if (status && opts.reschedule !== false) void this.researchAutoCheck();
        return !!status;
    },

    /** Ask now unless the last answer is only seconds old (menu opened, window back). */
    refreshResearchStateSoon(): void {
        const ctx = this.researchSyncLink();
        const rt = ctx ? runtime.get(ctx.link.id) : undefined;
        if (rt && Date.now() - rt.checkedAt < RECHECK_MS) return;
        void this.pollResearchBridge();
    },

    scheduleResearchPoll(): void {
        if (pollTimer) clearTimeout(pollTimer);
        const ctx = this.researchSyncLink();
        const waiting = ctx?.link.sent?.state === 'pending';
        pollTimer = setTimeout(() => {
            pollTimer = null;
            if (visible()) void this.pollResearchBridge();
            else this.scheduleResearchPoll();
        }, waiting ? POLL_PENDING_MS : POLL_MS);
    },

    /** The research's mode as first seen is remembered quietly; a later switch is said once. */
    researchNoteMode(treeId: TreeId): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || !this.researchSyncCapable(link.id)) return;
        const mode = this.researchModeOf(link.id, link);
        const st = researchAutoState(treeId);
        if (!st.modeSeen) patchResearchAutoState(treeId, { modeSeen: mode });
        else if (st.modeSeen !== mode && !st.modeSince) patchResearchAutoState(treeId, { modeSince: new Date().toISOString() });
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
        if (fate === null || fate.state === 'pending') return;
        const closed: ResearchSend = {
            ...sent, state: fate.state, closedAt: fate.at || new Date().toISOString(),
            ...(fate.reason ? { reason: fate.reason } : {}),
            ...(fate.nothing ? { changes: 0 } : {}),
        };
        delete closed.writing;
        TreeManager.patchResearchLink(treeId, { sent: closed });
        const s = strings.sync;
        if (fate.state === 'discarded') {
            if (!sent.noticed) {
                TreeManager.patchResearchLink(treeId, { sent: { ...closed, noticed: true } });
                this.showToast(s.rejectedToast(when(sent.at), fate.reason), Infinity, {
                    closable: true,
                    action: { label: s.sendAgain, run: () => { void this.researchSendTree(treeId); } },
                });
            }
            return;
        }
        if (!fate.nothing) patchResearchAutoState(treeId, { lastWritten: { at: closed.closedAt!, changes: closed.changes, conflicts: 0 } });
        // Written: "Send, then load" loads the version that has the changes now.
        if (sent.thenLoad && DataManager.getCurrentTreeId() === treeId) {
            const fps = this.researchSyncFingerprints(treeId, link);
            if (fps.current === sent.fingerprint) await this.researchLoadNewer({ afterSend: true });
            else await this.researchLoadNewer();
            return;
        }
        // A write that took longer (202): its result now, as the reply would have said it.
        if (sent.writing) await this.researchAfterWrite(treeId, closed);
    },

    // ==================== SENDING BY ITSELF ====================

    /** The user edited a tree: count it, and the quiet time starts again. */
    researchNoteUserChange(treeId: TreeId): void {
        if (quietLoading) return;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || !this.researchSyncCapable(link.id)) return;
        fpCache = null;
        patchResearchAutoState(treeId, { edits: (researchAutoState(treeId).edits ?? 0) + 1 });
        autoDue.delete(treeId);
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
        autoTimer = setTimeout(() => {
            autoTimer = null;
            autoTimerTree = null;
            void this.researchAutoSend(treeId, 'quiet');
        }, delay);
    },

    clearResearchAutoTimer(): void {
        if (autoTimer) clearTimeout(autoTimer);
        autoTimer = null;
        autoTimerTree = null;
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
        await this.postResearchSend(treeId, { auto: true, thenLoad: why === 'newer', keepalive: why === 'leave' });
    },

    /** After an answer from the bridge: what waited for it goes now; a written send's new version loads quietly. */
    async researchAutoCheck(): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const { treeId, link } = ctx;
        if (this.researchAutoOn(link) && this.researchBridgeFresh(link.id) && !sendingTree) {
            const kind = this.currentResearchSyncState().core;
            // Not sent, and the research has a newer version: send now (it loads after the write).
            if (kind === 'unsentAndNewer') { await this.researchAutoSend(treeId, 'newer'); return; }
            if (autoDue.has(treeId)) { await this.researchAutoSend(treeId, 'bridge'); return; }
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
    async postResearchSend(treeId: TreeId, opts: { auto: boolean; thenLoad?: boolean; keepalive?: boolean }): Promise<void> {
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
        const head = runtime.get(link.id)?.status?.head ?? '';
        const gedcom = researchGedcom(data, meta?.name ?? '', {
            id: link.id, head: link.head, appTree: treeId, transcripts: link.transcripts, sent: fps.current,
        });
        sendingTree = treeId;
        if (autoTimerTree === treeId) this.clearResearchAutoTimer();
        this.refreshResearchSyncUi();
        let res: Response;
        try {
            res = await postSync(`${bridge.base}/sync`, gedcom, SEND_TIMEOUT_MS, !!opts.keepalive && gedcom.length < KEEPALIVE_MAX_CHARS);
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
        if (!res.ok || !reply.ok) {
            TreeManager.patchResearchLink(treeId, { refused: { reason: reply.error, at: new Date().toISOString() } });
            this.refreshResearchSyncUi();
            if (opts.auto) this.tellResearchAutoStopped(treeId, reply.error);
            else await this.showResearchRefused(reply.error, opts);
            return;
        }
        const now = new Date().toISOString();
        // Written at once (the research's own word), or nothing it could take (0 changes).
        const writing = reply.inbox === false && reply.pending;
        const written = (reply.inbox === false && !reply.pending) || reply.changes === 0;
        const changes = reply.applied ?? reply.changes;
        const sent: ResearchSend = {
            fingerprint: fps.current, at: now, changes, head,
            ...(reply.intake ? { intake: reply.intake } : {}),
            state: written ? 'written' : 'pending',
            ...(written ? { closedAt: now } : {}),
            ...(opts.thenLoad && !written ? { thenLoad: true } : {}),
            ...(writing ? { writing: true } : {}),
            ...(opts.auto ? {} : { manual: true }),
        };
        TreeManager.patchResearchLink(treeId, { refused: undefined, sentSources: sourceReadings(data), sent });
        patchResearchAutoState(treeId, { edits: undefined, toldRefused: undefined });
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
            if (opts.thenLoad && active) {
                patchResearchAutoState(treeId, { lastWritten: { at: now, changes, conflicts: 0 } });
                if (!opts.auto) this.showToast(s.writtenToast(changes ?? 0), 6000);
                await this.researchLoadNewer({ afterSend: true });
            } else {
                await this.researchAfterWrite(treeId, sent);
            }
        } else if (writing) {
            if (!opts.auto) this.showToast(strings.sync.markWriting, 4000);
        } else if (!opts.auto) {
            const open = this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.id }) : null;
            this.showToast(s.sentToast(reply.changes), 6000, open
                ? { action: { label: s.openResearch, run: () => this.launchResearchLink(open) } } : {});
        }
        // Edited while it was on its way: the quiet time starts again.
        this.researchAutoArm();
    },

    /**
     * A send the research wrote: remember it, show the ✓, load the new version
     * quietly when nothing here changed since, and tell the conflicts it left
     * (by hand: a toast; by itself: the note under the mark, for new ones only).
     */
    async researchAfterWrite(treeId: TreeId, sent: ResearchSend): Promise<void> {
        const at = sent.closedAt ?? new Date().toISOString();
        patchResearchAutoState(treeId, { lastWritten: { at, changes: sent.changes, conflicts: 0 } });
        justWritten = { treeId, until: Date.now() + WRITTEN_MARK_MS };
        setTimeout(() => { justWritten = null; this.renderResearchSyncPill(); }, WRITTEN_MARK_MS + 50);
        this.refreshResearchSyncUi();
        const loaded = await this.researchQuietLoad(treeId);
        const persons = loaded?.conflictPersons ?? [];
        const conflicts = loaded?.conflicts ?? 0;
        if (conflicts > 0) {
            patchResearchAutoState(treeId, { lastWritten: { at, changes: sent.changes, conflicts, persons: persons.slice(0, 20) } });
            const link = TreeManager.getTreeMetadata(treeId)?.research;
            if (link?.sent) TreeManager.patchResearchLink(treeId, { sent: { ...link.sent, conflicts } });
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

    /** Sending by itself stopped (the research refused): said once per reason, with "Send again". */
    tellResearchAutoStopped(treeId: TreeId, reason: string): void {
        const told = researchAutoState(treeId).toldRefused ?? [];
        if (told.includes(reason)) return;
        patchResearchAutoState(treeId, { toldRefused: [...told, reason] });
        const s = strings.sync;
        this.showToast(s.autoStoppedToast(reason || '?'), Infinity, {
            closable: true,
            action: { label: s.sendAgain, run: () => { void this.researchSendTree(treeId); } },
        });
    },

    /**
     * Load the research's version over the open tree without asking, after a
     * write: the last send was written there, nothing changed here since, no
     * dialog or editor is open, its head moved on, and nothing would be lost
     * (until the research takes the app's images: none of them would go).
     * The view stays (zoom, place, focus); no toast. Returns the conflicts it
     * brought, or null when it did not load.
     */
    async researchQuietLoad(treeId: TreeId): Promise<{ conflicts: number; conflictPersons: PersonId[] } | null> {
        if (DataManager.getCurrentTreeId() !== treeId || DataManager.isTreeLocked() || DataManager.isReadOnly()) return null;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const sent = link?.sent;
        if (!link || !sent || sent.state !== 'written' || link.copy) return null;
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
        const stable = stabilizeIds(data, previous);
        if (imagesDroppedBy(stable, previous) > 0) {
            quietSkippedHead = header.head ?? remote;
            return null;
        }
        const before = openConflictCounts(previous);
        quietLoading = true;
        try {
            DataManager.loadStromData(stable);
        } finally {
            quietLoading = false;
        }
        const head = header.head || remote;
        TreeManager.setResearchLink(treeId, {
            id: link.id,
            fingerprint: contentFingerprint(DataManager.getData()),
            syncedAt: new Date().toISOString(),
            ...(head ? { head } : {}),
            ...(header.mode === 'archive' ? { mode: 'archive' as const } : {}),
        });
        patchResearchAutoState(treeId, { edits: undefined });
        fpCache = null;
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
    async showResearchRefused(reason: string, opts: { thenLoad?: boolean } = {}): Promise<void> {
        const s = strings.sync;
        const message = [reason ? s.refusedReason(reason) : '', s.refusedBody].filter(Boolean).join('\n\n');
        const pick = await this.showChoice(message, s.refusedTitle, [{ id: 'retry', label: s.retry }], undefined,
            { cancelLabel: strings.buttons.close });
        if (pick === 'retry') await this.researchSendNow(opts);
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
            case 'sendThenLoad': void this.researchSendNow({ thenLoad: true }); break;
            case 'loadNewer': void this.researchLoadNewer(); break;
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
        return persons.filter(id => this.personOpenConflicts(id).length > 0);
    },

    /** "Decide in the research ↗": the one open conflict of the one person, when the research announced the link. */
    researchDecideUrl(treeId: TreeId): string | null {
        if (!this.researchLinkAvailable('conflict')) return null;
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
        if (!researchAutoState(ctx.treeId).lastWritten) return undefined;
        return { tag: strings.sync.archiveTag, text: strings.sync.archiveDeleteNote };
    },

    // ==================== SHOWING IT ====================

    /** Redraw everything that shows the state (menu block, ⋯ dot, toolbar). */
    refreshResearchSyncUi(): void {
        this.refreshActionMenuBadges();
        this.renderResearchSyncPill();
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
                const conflicts = persons.length > 0 ? lw?.conflicts ?? 0 : 0;
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
            rejected: () => ({ tone: 'warn', title: s.stateRejected(when(state.sent?.at)),
                sub: auto
                    ? s.rejectedAutoSub(when(state.sent?.closedAt), state.sent?.reason ?? '')
                    : [s.rejectedSub(when(state.sent?.closedAt)), state.sent?.reason ? `(${state.sent.reason})` : ''].filter(Boolean).join(' '),
                actions: [{ action: 'sendAgain', label: s.sendAgain }] }),
            safari: () => ({ tone: 'neutral', title: s.stateSafari, sub: s.safariSub, actions: [{ action: 'downloadGedcom', label: s.downloadGedcom, asLink: true }] }),
            autoWaiting: () => ({ tone: 'quiet', title: s.autoWaitingTitle, sub: changed ? s.changedAt(changed) : undefined,
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
            + '</div>';
    },

    /** The ⋯ dot and label for the sync state (refreshActionMenuBadges calls this). */
    researchSyncAttention(): boolean {
        const state = this.currentResearchSyncState();
        const kind = state.kind;
        const attention = researchSyncWantsAttention(kind);
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
            ...(auto ? {
                autoBridgeDown: { text: archive ? s.pillBridgeDownWaiting(Math.max(1, researchAutoState(ctx.treeId).edits ?? 1)) : s.pillBridgeDown,
                    button: s.pillStart, action: 'startResearch' },
                autoPaused: { text: s.pillRefused, button: s.sendAgain, action: 'retry' },
                rejected: { text: s.pillRejected, button: s.sendAgain, action: 'sendAgain' },
            } : {}),
        };
        const w = warn[kind];
        if (w && (w.action !== 'startResearch' || this.researchLinkAvailable('open') || this.researchLinkAvailable('live'))) {
            this.closeResearchSyncNote();
            set('is-warn', '<span class="research-sync-pill-mark" aria-hidden="true">!</span>'
                + `<span class="research-sync-pill-label" onclick="${call('openResearchSyncMenu')}">${esc(w.text)}</span>`
                + `<button type="button" class="research-sync-pill-send" data-action="${w.action}" onclick="event.stopPropagation(); ${call('researchSyncAction', `'${w.action}'`)}">${esc(w.button)}</button>`, w.text);
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
            if (kind !== 'unsent') { hide(); return; }
            const busy = sendingTree === ctx.treeId;
            set('is-send', `<button type="button" class="research-sync-send" id="research-sync-send"${busy ? ' disabled aria-busy="true"' : ''}`
                + ` title="${esc(s.sendButtonTitle)}" onclick="${call('researchSyncAction', "'send'")}">`
                + (busy
                    ? `<span class="research-sync-spinner" aria-hidden="true"></span><span>${esc(s.sending)}</span>`
                    : `<span class="research-sync-send-long">${esc(s.sendButton)}</span><span class="research-sync-send-short">${esc(s.barSend)}</span>`)
                + '</button>');
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
            label = s.markWaiting;
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
        if (!toolbarWide()) return;
        const s = strings.sync;
        const one = persons.length === 1 ? DataManager.getPerson(persons[0]) : null;
        const name = one ? `${one.firstName} ${one.lastName}`.trim() : '';
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
        note = null;
        const pill = document.getElementById('research-sync-pill');
        pill?.querySelector('.research-sync-note')?.remove();
        if (pill) pill.dataset.html = pill.innerHTML;
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
        if (DataManager.getCurrentTreeId() !== treeId) return lastLine;
        const state = this.currentResearchSyncState();
        switch (state.core) {
            case 'autoPaused': return { text: t.statusStopped(state.reason || '?'), warn: true, action: 'sendAgain' };
            case 'refused': return { text: `${strings.sync.stateRefused}: ${state.reason || '?'}.`, warn: true, action: 'sendAgain' };
            case 'rejected': return { text: t.statusRejected(when(state.sent?.at)), warn: true, action: 'sendAgain' };
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
