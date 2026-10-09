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
import { TreeId, PersonId, ResearchLink, ResearchSend, ResearchSendMode, StromData, ResearchConflict } from '../types.js';
import { formatLiveClock } from '../live-time.js';
import { localNetworkDenied } from '../local-network.js';
import { currentAppBrowser } from '../research-transfer.js';
import { isTreeStale } from '../tab-sync.js';
import { formatFlexDate } from '../dates.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import {
    LiveStatus, contentFingerprint, fingerprintLike, sanitizeLiveStatus, sanitizeSyncReply, isSafariBrowser,
    parseLiveBridge, researchSchemeUrl, readResearchHeader, stabilizeIds, researchPersonRef, ResearchAccepts,
    researchIdsByContent, holdsResearchIds, ResearchSendRecord, AdoptIds, ExportXrefs, applySyncIds, researchGedcomTitles,
    researchHasTitles, hasTitles, withoutTitles, TITLES_FEATURE,
} from '../research-link.js';
import { loadResearchCopy } from '../research-copy.js';
import {
    noteResearchLinks, noteResearchWaiting, noteResearchBridgeStatus, storedResearchBridge, researchLinksEnabled,
    researchAutoState, patchResearchAutoState, researchAutoIntroSeen, noteResearchAutoIntroSeen, forgetResearchWaitingItems, anyResearchBridgeKnown,
    researchSendPreviewSkipped, announcedResearchScheme, RESEARCH_BRIDGE_MOVED_EVENT,
    ResearchHeldConflicts,
} from '../research-device.js';
import {
    ResearchSyncState, ResearchSyncKind, researchSyncState, researchSyncWantsAttention, researchSyncUnsent,
    pendingSendFate, sourceReadings, THEN_LOAD_MAX_AGE_MS, conflictTakeovers, heldConflicts,
    researchKeepsTakenBack, latestUndone, nextUndone, openUndone, undoneLeftBehind,
} from '../research-sync.js';
import { setResearchConflictsProvider } from '../card-signals.js';
import { uiModule } from './module.js';
import { researchWrittenList } from './research-changes-ui.js';
import {
    fetchWithTimeout, fetchGedcomText, postSync, onComputer, readTree, researchGedcom, researchGedcomExport,
} from './research-ui.js';
import { shownNameOrEmpty } from '../person-name.js';

/** The "told once" mark of sending held for want of the research's numbers (see tellResearchNoIds). */
const NO_IDS = 'no-ids';

/** A button of the research state block: the action researchSyncAction runs, its label, a link look. */
export interface ResearchSyncBlockAction { action: string; label: string; asLink?: boolean }
/** The research state block's content (the menu draws it in full, the More sheet as one line). */
export interface ResearchSyncBlock {
    kind: string;
    tone: 'warn' | 'neutral' | 'quiet';
    title: string;
    sub?: string;
    actions: ResearchSyncBlockAction[];
    spinner: boolean;
    /** A send of this tree is on its way (the send buttons wait). */
    sendingNow: boolean;
}

/** What reading the research's numbers came to (researchReadIds). */
type NoIdsResult ={ ok: true } | { ok: false; why: 'unavailable' | 'unreachable' | 'other-tree' | 'unmatched'; research?: StromData; header?: ReturnType<typeof readResearchHeader> };
/** How often the bridge is asked, the window visible: normally / while a send waits. */
const POLL_MS = 20_000;
const POLL_PENDING_MS = 15_000;
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

/**
 * The research that took a copy in (`was`) is the one that answers now (`now`):
 * either not known counts as the same (a copy kept before the version was kept).
 */
export function researchSameVersion(was: string | undefined, now: string): boolean {
    return !was || !now || was === now;
}

/** A catch-up of titles the research never got is running (researchTitlesCatchUp). */
let titlesCatchingUp = false;

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
    /**
     * How the last ask failed: `hung` — connected, no answer in time (the bridge
     * runs but is stuck); `refused` — it answered but not to this address (the
     * token or the tree no longer its: open the research from the app again);
     * `denied` — the browser blocks the address (its local network permission,
     * "Apps on device" in Edge): the research may well be running;
     * '' — nothing there (not running, or another port).
     */
    why?: '' | 'hung' | 'refused' | 'denied';
}

const runtime = new Map<string, BridgeRuntime>();

/** Where to allow the research in this browser's site settings (Brave: its localhost access). */
const blockedSub = (): string => strings.sync.blockedSub(currentAppBrowser() === 'brave' ? strings.sync.settingBrave : strings.sync.settingApps);
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
/** The send whose "Written N, not written M" was told (its plain "Written" toast is then not shown too). */
let toldNotWritten = '';
/** Sends by hand the research wrote before sending by itself is offered. */
const OFFER_AFTER_WRITES = 5;
/** "Restore the state before loading" is offered this long after a load (and only while the tree is unchanged). */
const LOAD_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;
/** The ✓ shown on the mark for a moment after a write. */
let justWritten: { treeId: TreeId; until: number } | null = null;
/** The open tree as last seen (a switch sends the one left). */
let lastActiveTree: TreeId | null = null;
/** The research's numbers are going onto the tree: that is not the user's edit. */
let quietLoading = false;
/**
 * The fingerprints of the active tree, worked out lazily (cleared by every
 * edit), for the data they were worked out from: data read in since (the
 * tree loaded at startup, a switch, a restore) are worked out again — asked
 * before the startup tree was in, the empty stand-in's stayed until an edit.
 */
let fpCache: { treeId: TreeId; current: string; matchesBase: boolean; base: string; data: StromData } | null = null;
/** The note under the mark (a new conflict, the first start of sending by itself). */
let note: { kind: 'conflict' | 'intro'; html: string; timer: ReturnType<typeof setTimeout> | null } | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const call = (method: string, arg = ''): string => `window.Strom.UI.${method}(${arg})`;

/** "Research version loaded" stands as a block this long after a load (then only the menu row, O2). */
const LOADED_BLOCK_MS = 60 * 60 * 1000;

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

/** The app's persons the research's refs name ("P0012"), in order, found ones only. */
export function personsByResearchRefs(data: StromData, refs: readonly string[]): PersonId[] {
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
        matchesBase: researchBaseStands(link) && !!link.fingerprint && fingerprintLike(data, link.fingerprint) === link.fingerprint,
    };
}

/**
 * The research's version loaded here is still what the research holds of this
 * tree: no send written (or waiting to be) since it was loaded. Its version
 * is no longer loaded after a write (only when asked), so once a send changed
 * something there, the tree going back to the old values is a change to send —
 * compared with the copy sent, never with the version before it (V-A).
 */
function researchBaseStands(link: ResearchLink): boolean {
    const sent = link.sent;
    if (!sent || sent.changes === 0 || (sent.state !== 'written' && sent.state !== 'pending')) return true;
    const sentAt = Date.parse(sent.at);
    const loadedAt = Date.parse(link.syncedAt);
    return Number.isFinite(sentAt) && Number.isFinite(loadedAt) && sentAt < loadedAt;
}

/** A status the bridge gave elsewhere (?live=, ?send=, following): it runs, and this is what it said. */
export function rememberBridgeStatus(researchId: string, status: LiveStatus): void {
    runtime.set(researchId, { up: true, checkedAt: Date.now(), status, blocked: false, downSince: 0 });
}

/** The research's name as its bridge said it (else the generic one). */
export function researchDisplayName(researchId: string): string {
    return runtime.get(researchId)?.status?.name || strings.research.defaultName;
}

/** How a tree's changes go to its research (missing: by themselves, a tie from before 3.9). */
export function researchSendMode(link: ResearchLink | undefined): ResearchSendMode {
    return link?.sendMode === 'manual' || link?.sendMode === 'off' ? link.sendMode : 'auto';
}

export const researchSyncMethods = uiModule({
    /** Start watching the active research tree (after the first render; once). */
    initResearchSync(): void {
        if (started || typeof window === 'undefined') return;
        // Cards count the conflicts as the research has them now (its version not loaded, finding 40).
        setResearchConflictsProvider(id => {
            const treeId = DataManager.getCurrentTreeId();
            const held = treeId ? this.researchHeld(treeId) : null;
            if (held && id in held.persons) return held.persons[id];
            // Decided in the research since this version was loaded (V-E): not open here either.
            const settled = treeId ? this.researchSettledConflicts(treeId) : null;
            const own = DataManager.getPerson(id)?.research?.conflicts;
            return settled && own?.some(c => settled.has(c.id)) ? own.filter(c => !settled.has(c.id)) : null;
        });
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
        // The research's bridge at a new address (started again: a new token): a refusal of the old one is over.
        window.addEventListener(RESEARCH_BRIDGE_MOVED_EVENT, (e) => {
            const researchId = (e as CustomEvent<{ researchId?: string }>).detail?.researchId;
            if (researchId) this.researchBridgeMoved(researchId);
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

    /** The research keeps a family of one spouse and no children (its `family.alone`); not known: no. */
    researchKeepsLoneFamilies(researchId: string): boolean {
        return !!runtime.get(researchId)?.status?.features?.includes('family.alone');
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
        // (Out of "only load" with changes waiting: the first send goes by hand, through "What will be sent".)
        return !!link && researchSendMode(link) === 'auto' && !link.previewDue && this.researchSyncCapable(link.id) && !safariBrowser();
    },

    /** The bridge answered within FRESH_MS. */
    /** The bridge answered the last time it was asked (however long ago; polls keep it current). */
    researchBridgeUp(researchId: string): boolean {
        return !!runtime.get(researchId)?.up;
    },

    /**
     * How the research's bridge is reached, when not: not running, not
     * responding (stuck), or turning this app down — with what to do. Null
     * while it answers. Said beside any state, never hidden by one (A1).
     */
    researchConnectionNote(researchId: string): { title: string; sub: string; warn: boolean } | null {
        const rt = runtime.get(researchId);
        if (!rt || rt.up) return null;
        const s = strings.sync;
        if (rt.why === 'hung') return { title: s.stateNotResponding, sub: s.notRespondingSub, warn: true };
        if (rt.why === 'refused') return { title: s.stateAddressRefused, sub: s.addressRefusedSub, warn: true };
        if (rt.why === 'denied') return { title: s.stateBlocked, sub: blockedSub(), warn: true };
        return { title: s.stateBridgeDown, sub: s.bridgeDownSub, warn: false };
    },

    /** The bridge was asked in this page and did not answer (stopped): what it listed waits until it runs. */
    researchBridgeKnownDown(researchId: string): boolean {
        const rt = runtime.get(researchId);
        return !!rt && !rt.up;
    },

    researchBridgeFresh(researchId: string): boolean {
        const rt = runtime.get(researchId);
        return !!rt?.up && Date.now() - rt.checkedAt < FRESH_MS;
    },

    /** The fingerprints of the active tree now (cached until the next edit). */
    researchSyncFingerprints(treeId: TreeId, link: ResearchLink): { current: string; matchesBase: boolean } {
        const key = `${link.fingerprint}|${link.syncedAt}|${link.sent?.at ?? ''}|${link.sent?.state ?? ''}`;
        const data = DataManager.getData();
        if (fpCache && fpCache.treeId === treeId && fpCache.base === key && fpCache.data === data) return fpCache;
        const fps = fingerprintsOf(data, link);
        fpCache = { treeId, ...fps, base: key, data };
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
        const auto = researchSendMode(link) === 'auto' && !link.previewDue;
        const mode = this.researchModeOf(link.id, link);
        const st = researchAutoState(treeId);
        return researchSyncState({
            link, capable, shown,
            matchesBase: fps.matchesBase,
            current: fps.current,
            bridgeUp: !!rt?.up,
            safari,
            remoteHead,
            ownHead: link.sent?.state === 'written' && link.sent.ownBase ? link.sent.replyHead ?? '' : '',
            stale: isTreeStale(treeId),
            heldConflicts: (this.researchHeld(treeId)?.takeovers.length ?? 0) > 0,
            openConflicts: this.researchSendsOpenConflicts(treeId, link) > 0,
            auto,
            sendOff: researchSendMode(link) === 'off',
            archive: mode === 'archive',
            sending: sendingTree === treeId,
            autoDue: autoDue.has(treeId),
            written: st.lastWritten ?? null,
            switched: !!st.modeSeen && st.modeSeen !== mode,
            // By hand and written a few times: sending by itself is offered, once (never at once).
            offerDue: researchSendMode(link) === 'manual' && !st.offerSeen && (st.manualWrites ?? 0) >= OFFER_AFTER_WRITES,
            introDue: auto && !toolbarWide() && !researchAutoIntroSeen(),
            notWritten: !!st.notWritten && link.sent?.state === 'written' && st.notWritten.fingerprint === link.sent.fingerprint,
            piled: !!link.previewDue && researchSendMode(link) !== 'off',
            loaded: (() => {
                const lb = this.researchLoadBackup(treeId);
                return !!lb && Date.now() - Date.parse(lb.at) < LOADED_BLOCK_MS;
            })(),
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
        let why: BridgeRuntime['why'] = '';
        try {
            const res = await fetchWithTimeout(`${bridge.status}?poll=1`, timeout);
            if (res.ok) status = sanitizeLiveStatus(await res.json());
            // Busy (starting up, a long write): ask again after the time it names.
            else if (res.status === 503) busyFor = retryAfterMs(res.headers.get('Retry-After'));
            // Something answers there, but not to this address (an old token, another tree's bridge).
            else if (res.status === 401 || res.status === 403 || res.status === 404) why = 'refused';
        } catch (err) {
            blocked = err instanceof TypeError;
            // No answer in time: the bridge is there but stuck (B5 of the rc.22 round).
            if ((err as { name?: string })?.name === 'AbortError' || (err as { name?: string })?.name === 'TimeoutError') why = 'hung';
            // Refused by the browser itself: never said as "not running" (F4 of the Windows round).
            else if (blocked && await localNetworkDenied()) why = 'denied';
        }
        // An address of another research (the port went to another tree's bridge): not ours.
        if (status && status.treeId !== researchId) { status = null; why = 'refused'; }
        const prev = runtime.get(researchId);
        const downSince = status ? 0 : (prev?.up || !prev?.downSince ? Date.now() : prev.downSince);
        runtime.set(researchId, { up: !!status, checkedAt: Date.now(), status, blocked: !status && blocked, downSince,
            busyUntil: busyFor ? Date.now() + busyFor : 0, why: status ? '' : why });
        if (status) {
            noteResearchLinks(status.links, status.linkScheme);
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
            this.researchNoteWrittenAgain(ctx.treeId, status);
            this.researchNoteConflictsSettled(ctx.treeId, status);
            // Its version moved on since its conflicts were read (a send taken back closed them, or one
            // was decided there): read again, never counted from the old one (B1 of beta.56).
            const held = this.researchHeld(ctx.treeId);
            if (held && status.head && status.head !== held.head) await this.researchReadHeld(ctx.treeId);
        }
        this.refreshResearchSyncUi();
        // Updated since: it takes sends now — what waits starts its quiet time.
        if (status && !capable && this.researchSyncCapable(researchId)) this.researchAutoArm();
        if (status && opts.reschedule !== false) void this.researchAutoCheck();
        // Originals waiting for it go while it answers.
        if (status) void this.researchOriginalsKick();
        return !!status;
    },

    /**
     * A research's bridge answers at a new address (a ?live= / ?send= / ?adopt= /
     * tree.ged after it started again with a new token, N20): what the old
     * address said is forgotten, a refusal of a send is over for every tree
     * of that research, and changes waiting go by themselves again — asked
     * at once, so the open tree's changes go without the user.
     */
    researchBridgeMoved(researchId: string): void {
        runtime.delete(researchId);
        olderAsked.delete(researchId);
        for (const tree of TreeManager.getTrees()) {
            const link = tree.research;
            if (link?.id !== researchId || !link.refused) continue;
            TreeManager.patchResearchLink(tree.id, { refused: undefined });
            patchResearchAutoState(tree.id, { toldRefused: undefined });
            if (this.researchAutoOn(link)) autoDue.add(tree.id);
        }
        this.refreshResearchSyncUi();
        // After the caller has taken in the new address's status (fetchStatus goes on after this).
        if (this.researchSyncLink()?.link.id === researchId) {
            void Promise.resolve().then(() => this.pollResearchBridge({ timeout: POLL_TIMEOUT_MS }));
        }
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
            // The research's version with this write in it: its own, not "a newer version" to load.
            ...(fate.state === 'written' && sent.ownBase && status.head && status.head !== sent.head ? { replyHead: status.head } : {}),
        };
        delete closed.writing;
        TreeManager.patchResearchLink(treeId, { sent: closed,
            // Written with the titles: the research has them now (B18-1).
            ...(fate.state === 'written' && sent.titles ? { titlesIn: sent.intake || sent.at } : {}) });
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
        } else if (!fate.inherited) {
            this.researchNoteTookNothing(treeId, sent.fingerprint);
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
     * are here and not there any more, told once. Nothing goes by itself until
     * the user decides — Send again (theirs again) or load the research's
     * version (the undo kept, asked): any copy sent meanwhile would carry what
     * was taken back and write it there again (finding 43). Edits since wait.
     */
    researchNoteUndone(treeId: TreeId, status: LiveStatus): void {
        const lw = researchAutoState(treeId).lastWritten;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || !status.sends) return;
        const rec = lw?.intake ? status.sends.find(r => r.intake === lw.intake) : undefined;
        if (!lw?.intake || rec?.state !== 'undone' || rec.again) {
            this.researchNoteOlderUndone(treeId, link, status);
            return;
        }
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
            action: { label: s.sendAgain, run: () => { void this.researchSendTree(treeId, { undoAgain: true }); } },
        });
    },

    /**
     * A send of this tree the research took back that this app was not told of
     * as it happened (taken back before this page, or not the last write): in
     * sight like any other, with its own Send again — unless the research's
     * version was loaded after it (the undo kept), or it was written again.
     */
    researchNoteOlderUndone(treeId: TreeId, link: ResearchLink, status: LiveStatus): void {
        if (link.sent?.state === 'undone' || link.sent?.state === 'pending' || link.copy) return;
        const open = openUndone(status.sends, tree => tree === treeId || tree === link.id, researchAutoState(treeId).resent ?? [], link.syncedAt);
        const rec = open[0];
        if (!rec) return;
        TreeManager.patchResearchLink(treeId, {
            fingerprint: '',
            sent: { fingerprint: link.sent?.fingerprint ?? '', at: rec.at || new Date().toISOString(), changes: rec.changes, head: '',
                state: 'undone', closedAt: rec.decidedAt || new Date().toISOString(), intake: rec.intake, noticed: true },
        });
        fpCache = null;
        this.refreshResearchSyncUi();
    },

    /**
     * The send shown as taken back was written again since (`again` in its
     * record: Send again from another window, or in the research): not taken
     * back any more (finding B). Its changes are there again; what was edited
     * since goes as usual.
     */
    researchNoteWrittenAgain(treeId: TreeId, status: LiveStatus): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const sent = link?.sent;
        if (!link || sent?.state !== 'undone' || !sent.intake || !status.sends) return;
        const rec = status.sends.find(r => r.intake === sent.intake);
        if (!rec?.again) return;
        // A send taken back before it is an older state: never offered (R3 of the rc.49 round).
        const next = nextUndone(status.sends, tree => tree === treeId || tree === link.id, [...(researchAutoState(treeId).resent ?? []), sent.intake]);
        TreeManager.patchResearchLink(treeId, { sent: next
            ? { ...sent, at: next.at || sent.at, intake: next.intake, closedAt: next.decidedAt || sent.closedAt, takenBack: undefined }
            : { ...sent, state: 'written', closedAt: rec.decidedAt || new Date().toISOString(), takenBack: undefined } });
        fpCache = null;
        this.refreshResearchSyncUi();
        this.researchAutoArm();
    },

    /**
     * Conflicts a write left, decided in the research since (V-E): its record
     * says none is open any more, and no other send of this tree it keeps has
     * one open — no "1 conflict to decide" here; its version still loads when asked.
     */
    researchNoteConflictsSettled(treeId: TreeId, status: LiveStatus): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const sent = link?.sent;
        if (!link || !sent || sent.state !== 'written' || !sent.intake || !status.sends) return;
        const st = researchAutoState(treeId);
        const shown = (sent.conflicts ?? 0) > 0 || (st.lastWritten?.conflicts ?? 0) > 0 || !!st.held;
        if (!shown) return;
        const rec = status.sends.find(r => r.intake === sent.intake);
        if (!rec || rec.conflicts !== 0) return;
        const mine = status.sends.filter(r => r.tree === treeId || r.tree === link.id);
        if (mine.some(r => (r.conflicts ?? 0) > 0)) return;
        TreeManager.patchResearchLink(treeId, { sent: { ...sent, conflicts: undefined } });
        // The conflicts it named are decided there: the cards stop showing them until its version is loaded.
        const ids = [...new Set([...(st.lastWritten?.conflictIds ?? []), ...(st.settledConflicts?.base === (link.head ?? '') ? st.settledConflicts.ids : [])])];
        patchResearchAutoState(treeId, {
            held: undefined,
            ...(ids.length ? { settledConflicts: { base: link.head ?? '', ids } } : {}),
            ...(st.lastWritten ? { lastWritten: { ...st.lastWritten, conflicts: 0, persons: undefined, conflictIds: undefined } } : {}),
        });
        fpCache = null;
        // The cards' conflict badges follow.
        if (DataManager.getCurrentTreeId() === treeId) TreeRenderer.render();
    },

    // ==================== SENDING BY ITSELF ====================

    /** The user edited a tree: count it, and the quiet time starts again. */
    researchNoteUserChange(treeId: TreeId): void {
        if (quietLoading) return;
        // "Restore the state before loading" stands until the next edit of the tree (O2, V-H): never offered
        // again, not even when an undo brings the tree back to what was loaded.
        if (researchAutoState(treeId).loadBackup) patchResearchAutoState(treeId, { loadBackup: undefined });
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
        if (DataManager.getCurrentTreeId() === treeId && this.researchAutoOn(link) && !this.researchHoldsForUndo(link)) this.scheduleResearchAutoSend(treeId);
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
        if (this.researchHoldsForUndo(ctx.link)) return;
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
        // A send taken back and a research that would write it again from a copy: the user decides first
        // (Send again, or the research's version), never a copy by itself (finding 43).
        if (this.researchHoldsForUndo(link)) return;
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
        // The research newer: its version stays "newer" after the write, loaded only when the user asks.
        await this.postResearchSend(treeId, { auto: true, keepalive: why === 'leave' });
    },

    /** After an answer from the bridge: what waited for it goes now (the research's version loads only when asked). */
    async researchAutoCheck(): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const { treeId, link } = ctx;
        // Once per tree: how should changes go (asked while its research runs).
        if (runtime.get(link.id)?.up && this.researchSyncCapable(link.id)) this.maybeAskResearchSendMode(treeId);
        if (this.researchAutoOn(link) && this.researchBridgeFresh(link.id) && !sendingTree) {
            const kind = this.currentResearchSyncState().core;
            // Not sent, and the research has a newer version: send now (it loads after the write) — unless
            // that version is the one a write left conflicts in: it does not load after a send anyway, and
            // each edit would go at once (a new conflict each); then the quiet time as any edit.
            const conflictsLeft = (link.sent?.state === 'written' && (link.sent.conflicts ?? 0) > 0)
                || (this.researchHeld(treeId)?.takeovers.length ?? 0) > 0;
            if (kind === 'unsentAndNewer' && !conflictsLeft) { await this.researchAutoSend(treeId, 'newer'); return; }
            if (autoDue.has(treeId)) { await this.researchAutoSend(treeId, kind === 'unsentAndNewer' ? 'newer' : 'bridge'); return; }
        }
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
    async researchSendNow(opts: { thenLoad?: boolean; treeId?: TreeId; undoAgain?: boolean; previewed?: boolean } = {}): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx || sendingTree) return;
        // Asked for one tree: never send another (the open tree changed meanwhile).
        if (opts.treeId && ctx.treeId !== opts.treeId) return;
        const { treeId, link } = ctx;
        if (!this.researchSyncCapable(link.id)) {
            // An older research: the old way, it starts it in the terminal (?send= comes back).
            await this.sendTreeToResearch(treeId);
            return;
        }
        if (!await this.researchBridgeReady(link.id)) {
            const conn = this.researchConnectionNote(link.id);
            // Not running and it can be started from here: the research starts and takes the send.
            if (!conn?.warn && this.researchLinkAvailable('send')) {
                await this.sendTreeToResearch(treeId);
                return;
            }
            // Stuck, turned down, or not running with no way to start it from here: said, the changes
            // stay and wait — never the old manual way, which this research no longer has (A2, B6).
            this.showToast(conn?.warn ? `${conn.title}. ${conn.sub}` : strings.sync.sendWhenRunning, Infinity, {
                closable: true,
                action: { label: strings.sync.retry, run: () => { void this.researchSendTree(treeId, { thenLoad: opts.thenLoad, undoAgain: opts.undoAgain }); } },
            });
            return;
        }
        if (!await this.ensureLocalUnlocked()) return;
        // A send taken back: only "Send again" writes it there again (`/again`). Any other send is a copy —
        // a research that leaves out what was taken back takes it; an older one would write it again, so
        // there the user decides first (finding A of the rc.19 round).
        if (!opts.undoAgain && this.researchHoldsForUndo(link)) {
            this.tellResearchUndoneChoice(strings.sync.undoneDecideFirst);
            return;
        }
        // By hand, what would go is shown first and Send there sends — unless the user said "next time
        // without the preview"; the first send out of "only load" always shows it. ("Send again" and
        // "send, then load" are their own decisions.)
        // Never skipped while something waits: a list that cannot be told exactly here (its base moved:
        // a restore before loading, a send taken back) says so in the panel, and Send there sends (A of rc.34).
        if (!opts.previewed && !opts.undoAgain && !opts.thenLoad && researchSendMode(link) !== 'off'
            && (link.previewDue || !researchSendPreviewSkipped(treeId))) {
            const list = await this.researchChangesReady();
            const fps = this.researchSyncFingerprints(treeId, link);
            const waiting = !fps.matchesBase && fps.current !== link.sent?.fingerprint;
            if ((list && list.length > 0) || waiting) {
                this.showResearchChanges('send', { confirm: true, inexact: !list || list.length === 0 });
                return;
            }
        }
        // "Send again" writes what was taken back; the edits made since go after it like any send, never
        // left waiting behind the taken-back bar (beta.59 round, 1).
        const editsSince = !!opts.undoAgain && link.sent?.state === 'undone'
            && this.researchSyncFingerprints(treeId, link).current !== link.sent.fingerprint;
        await this.postResearchSend(treeId, { auto: false, thenLoad: opts.thenLoad, undoAgain: opts.undoAgain });
        if (!editsSince || DataManager.getCurrentTreeId() !== treeId) return;
        const after = TreeManager.getTreeMetadata(treeId)?.research;
        if (!after || after.refused) return;
        const fps = this.researchSyncFingerprints(treeId, after);
        if (fps.matchesBase || fps.current === after.sent?.fingerprint) return;
        await this.researchSendNow({ treeId });
    },

    /**
     * Post a tree to its research's bridge and take in the answer. By hand,
     * the result is told (a toast, the refusal dialog, the old way when the
     * bridge is gone); by itself, only what needs the user is (a refusal,
     * once per reason) and the mark shows the rest.
     */
    async postResearchSend(treeId: TreeId, opts: { auto: boolean; thenLoad?: boolean; keepalive?: boolean; again?: boolean; undoAgain?: boolean }): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!link || sendingTree) return;
        const s = strings.sync;
        // "Only load from the research": nothing goes, ever — said when the user asked to send.
        if (researchSendMode(link) === 'off') {
            if (!opts.auto) this.tellResearchSendOff(treeId);
            return;
        }
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
    async postResearchSendNow(treeId: TreeId, opts: { auto: boolean; thenLoad?: boolean; keepalive?: boolean; again?: boolean; undoAgain?: boolean; noIdsRetried?: boolean }): Promise<void> {
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
                // "Send, then load": nothing to send, its version loads (asked as any load) — never "the same tree".
                if (opts.thenLoad) await this.researchLoadNewer();
                else this.showToast(s.nothingToast, 4000);
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
        // Its version as it is now: one the poll has not seen yet (a person added there just before)
        // would read as this tree's own after the write, and never be offered to load (R3 of beta.56).
        const polledHead = runtime.get(link.id)?.status?.head ?? '';
        const head = (opts.keepalive ? null : await this.askResearchBridge(link.id, PING_TIMEOUT_MS))?.head || polledHead;
        // Another send started while it was asked: one at a time.
        if (sendingTree) return;
        // The research had nothing this tree lacks: its write of this copy is this tree's own version.
        const ownBase = !head || head === link.head || (link.sent?.state === 'written' && !!link.sent.ownBase && head === link.sent.replyHead);
        // "Send again" by hand for a send the research took back (`strom sync undo`): the research
        // writes it again from what it kept, on the state it was sent from (POST /sync/<R…>/again,
        // 1.12). A copy sent instead reads there as "removed by the research": nothing written (finding 35).
        const again = opts.undoAgain && !opts.auto && link.sent?.state === 'undone' && link.sent.intake ? link.sent : null;
        // What goes over is then the state that send had, not this one (edits since go after it).
        const sentFp = again ? again.fingerprint : fps.current;
        // The research took in an earlier copy of this tree and its version was not loaded here since: this copy
        // is that one plus the edits since — said, so the research takes that copy as the base (a bridge that says
        // sync.since), whether that send was written, brought nothing new, or went beside a send taken back (A4).
        // Always when known, whatever the bridge said it takes (its status may not be read yet; an older
        // research passes the line by): without it the research guesses the base (finding N1). Only a version
        // of the research loaded here since makes it wrong — that version (_STROM_HEAD) is the base then.
        // A copy another version of the research took in is no such base (B18-2): `strom update` from 1.12.1 to 1.13
        // — what 1.12 left out of it (a known sex set unknown, N33) would read in it as given already, and never be
        // taken; without the line the newer one finds the base in its own history.
        const lastCopy = researchAutoState(treeId).lastCopy;
        const version = this.researchBridgeVersion(link.id);
        const since = lastCopy && lastCopy.base === (link.head ?? '') && researchSameVersion(lastCopy.version, version) ? lastCopy.intake : undefined;
        // The titles as the research takes them (B-1); a send that carries them, once written, leaves them there (B18-1).
        const titles = researchGedcomTitles(this.researchStatusOf(link.id));
        const carriesTitles = again ? !!again.titles : titles === 'line';
        const exported = again ? null : researchGedcomExport(data, meta?.name ?? '', {
            id: link.id, head: link.head, appTree: treeId, transcripts: this.researchTranscriptsLink(link).transcripts, sent: fps.current,
            ...(since ? { since } : {}),
        }, titles);
        const gedcom = exported?.content ?? '';
        // What this send carries, person by person (what was written, once it is).
        if (!again) this.researchNoteSending(treeId, data, fps.current);
        sendingTree = treeId;
        // Before this tree first goes to the research from this browser: a backup, whatever the setting
        // (not while the page is being left — the send must go at once).
        if (active && !again && !opts.keepalive && !researchAutoState(treeId).firstSendBackup) {
            if (await DataManager.snapshotNow('pre-first-send')) patchResearchAutoState(treeId, { firstSendBackup: true });
        }
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
                // The research answered before, so it takes sends straight: not the old way through its
                // terminal, but said what happened, with the way to try again (B6 of the rc.22 round).
                this.refreshResearchSyncUi();
                this.showToast(err instanceof DOMException && err.name === 'AbortError' ? s.sendNoAnswer : s.sendUnreachable, Infinity, {
                    closable: true,
                    action: { label: s.retry, run: () => { void this.researchSendTree(treeId, { undoAgain: !!again }); } },
                });
            }
            return;
        }
        let reply = sanitizeSyncReply(null);
        try { reply = sanitizeSyncReply(await res.json()); } catch { /* a refusal without a reason */ }
        sendingTree = null;
        // The research has this copy now (any answer with its mark; a send written again is the old copy, not this one).
        if (res.ok && reply.ok && reply.intake && !again) {
            patchResearchAutoState(treeId, { lastCopy: { intake: reply.intake, base: link.head ?? '', ...(version ? { version } : {}) } });
        }
        // The first send out of "only load" went (through the preview): sending by itself may go on.
        if (res.ok && reply.ok && link.previewDue) TreeManager.patchResearchLink(treeId, { previewDue: undefined });
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
        // Changes the research counted but neither wrote nor said why (not skipped, not left out as taken
        // back, not a conflict): never silent — the user's edits would stand here only (A5 of the rc.23 round).
        // What it lists (`notWritten`, rc.25) is said with its reason (taken back has its own word).
        const explained = reply.skipped.length + (reply.conflicts ?? 0)
            + (reply.notWritten.length ? reply.notWritten.length : reply.takenBack ?? 0);
        const unexplained = written && reply.applied !== null && reply.changes !== null ? reply.changes - reply.applied - explained : 0;
        const listed = reply.notWritten.filter(n => n.why !== 'takenBack');
        const notWrittenCount = written ? listed.length + Math.max(0, unexplained) : 0;
        if (notWrittenCount > 0) {
            if (unexplained > 0) console.warn('The research wrote fewer changes than it counted, without saying why', reply);
            // What it wrote is its `applied`, never what this app sent: the rest is kept as not written (the
            // state, "What was written") until the next send is written (V-J).
            patchResearchAutoState(treeId, { notWritten: { at: now, fingerprint: sentFp, written: Math.max(0, changes ?? 0),
                items: listed.slice(0, 50).map(n => ({ person: n.person, fact: n.fact, why: n.why, ...(n.name ? { name: n.name } : {}) })), unexplained: Math.max(0, unexplained) } });
            // "Written N, not written M · Show": by hand and by itself alike (the written count is in it).
            toldNotWritten = sentFp;
            this.showToast(`${s.writtenCount(Math.max(0, changes ?? 0), notWrittenCount)} ${listed.length ? s.notWrittenListed(notWrittenCount) : s.notWrittenToast(notWrittenCount)}`, Infinity, {
                closable: true,
                action: { label: s.showConflicts, run: () => this.showResearchChanges('written') },
            });
        } else if (written && reply.changes !== 0) {
            patchResearchAutoState(treeId, { notWritten: undefined });
        }
        const sent: ResearchSend = {
            fingerprint: sentFp, at: now, changes, head,
            ...(reply.intake ? { intake: reply.intake } : {}),
            state: written ? 'written' : 'pending',
            ...(written ? { closedAt: now } : {}),
            ...(opts.thenLoad && !written ? { thenLoad: true } : {}),
            ...(writing ? { writing: true } : {}),
            ...(opts.auto ? {} : { manual: true }),
            ...(written && reply.head ? { replyHead: reply.head } : {}),
            ...(ownBase ? { ownBase: true } : {}),
            ...(carriesTitles ? { titles: true as const } : {}),
        };
        // The copy still carries sends the research took back since its base (`undoneSince`, 1.12): what
        // it wrote stands, but the app and the research differ by those — never shown as in step, nor
        // loaded quietly over them. The bar "taken back" names the send taken back, at its own time
        // (findings 38, 39): Send again (theirs again) or load (the undo kept).
        // The latest of them, never simply the last mark (finding B).
        const undoneIntake = again ? '' : latestUndone(reply.undoneSince, runtime.get(link.id)?.status?.sends, researchAutoState(treeId).resent);
        const undone = !!undoneIntake;
        // Written with the titles: the research has them now. Gone without them (a research that does not keep them,
        // or one not asked: in NPFX / NSFX only, which 1.12 drops): it may lack them.
        const titlesIn = written && carriesTitles ? reply.intake || now : !again && titles !== 'line' ? undefined : link.titlesIn;
        TreeManager.patchResearchLink(treeId, { refused: undefined, sentSources: sourceReadings(data), titlesIn,
            sent: undone ? { ...sent, at: this.researchSendTime(treeId, link, undoneIntake) || now, state: 'undone', intake: undoneIntake,
                closedAt: now, noticed: true, ...(reply.takenBack ? { takenBack: reply.takenBack } : {}) } : sent });
        // Written again: never offered again (the research may still list it as taken back); a send taken
        // back before it is an older state, never offered either (R3 of the rc.49 round, over finding B2).
        if (again && written) {
            const resent = [...(researchAutoState(treeId).resent ?? []).filter(x => x !== again.intake), again.intake!].slice(-30);
            patchResearchAutoState(treeId, { resent });
            const next = nextUndone(runtime.get(link.id)?.status?.sends, tree => tree === treeId || tree === link.id, resent);
            if (next) {
                TreeManager.patchResearchLink(treeId, { sent: { ...sent, at: next.at || now, state: 'undone', intake: next.intake,
                    closedAt: next.decidedAt || now, noticed: true } });
            }
        }
        // The research's numbers for what this send added (`ids`, rc.26): kept on those people and sources,
        // so the next sends name them even while its version is not loaded here (no duplicate person).
        const retagged = written && reply.ids && exported && active ? this.researchTakeSyncIds(treeId, exported.xrefs, reply.ids, sentFp) : null;
        // The research's version is the state sent with its numbers: the copy goes under the fingerprint the send now has.
        if (written && reply.changes !== 0) this.researchNoteWritten(treeId, sentFp, now, retagged ?? undefined);
        // Nothing new taken: the copy stays the research's version, now for this send too (N40).
        else if (written && reply.changes === 0 && !undone) this.researchNoteTookNothing(treeId, sentFp, retagged?.fingerprint);
        // Edits since the send taken back were not in it: they still wait.
        if (sentFp === fps.current) patchResearchAutoState(treeId, { edits: undefined, unsentSince: undefined, toldRefused: undefined });
        else patchResearchAutoState(treeId, { toldRefused: undefined });
        if (undone) {
            console.warn('The copy sent carries sends the research took back since', reply.undoneSince);
            this.refreshResearchSyncUi();
            // The research left those changes out (rc.19): said, with Send again to have them back there.
            if (reply.takenBack) {
                this.showToast(s.takenBackToast(reply.takenBack), Infinity, {
                    closable: true, action: { label: s.sendAgain, run: () => { void this.researchSendTree(treeId, { undoAgain: true }); } },
                });
            } else {
                this.tellResearchUndoneChoice(s.undoneSinceToast(reply.undoneSince.length));
            }
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
            // Edits went, the research took none of them: said so (its tree may be ahead, never "the same").
            // "Send, then load" loads its version all the same — asked first, what it replaces shown (N60-4).
            if (!opts.auto) this.showToast(s.nothingTakenToast, 6000);
            if (!opts.auto && opts.thenLoad && active) await this.researchLoadNewer();
        } else if (written) {
            // A write that left conflicts never loads after itself: told as any write (the note, the
            // conflicts), its version waits for the user — it holds the research's values in place of theirs.
            // Nor one that left changes unwritten: loading would drop them here without a word (V-J).
            if (opts.thenLoad && active && !((reply.conflicts ?? 0) > 0) && notWrittenCount === 0) {
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
            const open = this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.id }, announcedResearchScheme()) : null;
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
     * A send the research wrote: remember it, show the ✓ and tell the conflicts
     * it left (by hand: a toast; by itself: the note under the mark, for new
     * ones only). Its new version is not loaded: only when the user asks.
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
        // The research's version is loaded only when the user asks (all modes): the research's word on the
        // conflicts, and what its conflicts say now, read from that version without loading it (finding 40).
        const active = DataManager.getCurrentTreeId() === treeId;
        const data = active ? DataManager.getData() : null;
        const persons = known && known.conflicts !== null && data ? personsByResearchRefs(data, known.refs) : [];
        const conflicts = known && known.conflicts !== null ? known.conflicts : 0;
        if (conflicts > 0 || this.researchHeld(treeId)) await this.researchReadHeld(treeId);
        if (conflicts > 0) {
            patchResearchAutoState(treeId, { lastWritten: { ...base, conflicts, persons: persons.slice(0, 20),
                ...(known?.ids?.length ? { conflictIds: known.ids.slice(0, 20) } : {}) } });
            const link = TreeManager.getTreeMetadata(treeId)?.research;
            if (link?.sent && link.sent.at === sent.at) TreeManager.patchResearchLink(treeId, { sent: { ...link.sent, conflicts } });
        }
        const s = strings.sync;
        if (sent.manual && sent.changes !== 0) patchResearchAutoState(treeId, { manualWrites: (researchAutoState(treeId).manualWrites ?? 0) + 1 });
        if (sent.manual) {
            if (conflicts > 0) {
                this.showToast(s.writtenConflictToast(sent.changes ?? 0, conflicts), 8000,
                    { action: { label: s.showConflicts, run: () => this.researchShowConflicts(persons) } });
            } else if (sent.changes !== 0 && toldNotWritten !== sent.fingerprint) {
                // (0 written: nothing to say here — what was left out or skipped is told on its own;
                // "Written N, not written M" said it already.)
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
     * The backup taken before the research's version was last loaded, while
     * the open tree is still just what was loaded (no edit since) and for a
     * week at most: "Restore the state before loading".
     */
    researchLoadBackup(treeId: TreeId): { id: string; at: string } | null {
        const lb = researchAutoState(treeId).loadBackup;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!lb || !link || DataManager.getCurrentTreeId() !== treeId) return null;
        if (Date.now() - Date.parse(lb.at) > LOAD_BACKUP_MS) return null;
        return this.researchSyncFingerprints(treeId, link).current === lb.fingerprint ? lb : null;
    },

    /** Back to the tree as it was before the research's version was loaded (Ctrl+Z brings the load back). */
    async researchRestoreBeforeLoad(treeId: TreeId): Promise<void> {
        const lb = researchAutoState(treeId).loadBackup;
        if (!lb || DataManager.getCurrentTreeId() !== treeId || DataManager.isReadOnly()) return;
        // The tree as it was, built on the tie it had then: the next send names that head (and the copy since),
        // the research's version is "newer" again, to load when asked (V-B).
        const before = lb.before;
        const restored = await DataManager.restoreSnapshot(lb.id, before ? { head: before.head, fingerprint: before.fingerprint } : null).catch(() => null);
        if (!restored) {
            this.showToast(strings.storageSafety.snapshotFailed, 5000);
            return;
        }
        if (before) TreeManager.patchResearchLink(treeId, { syncedAt: before.syncedAt, sent: before.sent });
        patchResearchAutoState(treeId, { loadBackup: undefined, held: undefined });
        fpCache = null;
        await TreeRenderer.renderAsync();
        this.refreshSearch();
        this.refreshResearchSyncUi();
        this.showToast(strings.sync.restoredBeforeLoad, 8000, { action: { label: strings.undo.undo, run: () => this.performUndo() } });
    },

    /** "Only load from the research" and the user asked to send: said, with the way to change it. */
    tellResearchSendOff(treeId: TreeId): void {
        this.showToast(strings.sync.sendOffToast, 8000,
            { action: { label: strings.sync.sendOffChange, run: () => { void this.showResearchTreeSettings(treeId); } } });
    },

    /** Tree menus' "Send changes": the same send for any tree (switched to first when a running research takes it straight). */
    async researchSendTree(treeId: TreeId, opts: { thenLoad?: boolean; undoAgain?: boolean } = {}): Promise<void> {
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
            // (Changes the last send left unwritten would go: the load dialog says so, V-J.)
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

    /**
     * Switch how the tree's changes go; to "by themselves" with changes waiting starts the quiet time.
     * `told`: the dialog that switched says what piled up itself (no toast).
     */
    setResearchSendMode(treeId: TreeId, mode: ResearchSendMode, opts: { told?: boolean } = {}): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || researchSendMode(link) === mode) return;
        const wasOff = researchSendMode(link) === 'off';
        TreeManager.patchResearchLink(treeId, { sendMode: mode });
        // Out of "only load": the first send goes through "What will be sent" (set below when changes wait).
        if (mode === 'off' || !wasOff) TreeManager.patchResearchLink(treeId, { previewDue: undefined });
        // Out of "only load": nothing goes before what piled up meanwhile was seen (held at once, the list may
        // still be loading; let go when nothing piled up), and it is said, with what would go.
        if (wasOff && DataManager.getCurrentTreeId() === treeId) {
            fpCache = null;
            TreeManager.patchResearchLink(treeId, { previewDue: true });
            void this.researchChangesReady().then(list => {
                const now = TreeManager.getTreeMetadata(treeId)?.research;
                if (!now?.previewDue || researchSendMode(now) === 'off' || DataManager.getCurrentTreeId() !== treeId) return;
                if (list && list.length === 0) {
                    TreeManager.patchResearchLink(treeId, { previewDue: undefined });
                    this.refreshResearchSyncUi();
                } else if (list && !opts.told) {
                    this.showToast(strings.sync.offPiledUp(list.length), 10000,
                        { action: { label: strings.changes.whatWillBeSent, run: () => this.showResearchChanges('send', { confirm: true }) } });
                }
            });
        }
        if (mode !== 'auto') {
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
            case 'send': case 'retry': void this.researchSendNow(); break;
            // "Send again" on a send taken back writes that send again (`/again`); on a discarded one, the changes go again.
            case 'sendAgain': void this.researchSendNow({ undoAgain: ctx.link.sent?.state === 'undone' }); break;
            case 'acceptUndo': void this.researchAcceptUndo(); break;
            case 'sendThenLoad': void this.researchSendNow({ thenLoad: true }); break;
            case 'showChanges': this.showResearchChanges('send'); break;
            case 'showChangesFirst': this.showResearchChanges('send', { confirm: true }); break;
            case 'showOriginals': this.showOriginalsQueue(); break;
            case 'showWritten': this.showResearchChanges('written'); break;
            case 'loadNewer': void this.researchLoadNewer(); break;
            case 'reload': window.location.reload(); break;
            case 'cancelLoad': this.researchCancelThenLoad(); break;
            case 'startResearch': {
                const url = this.researchStartUrl();
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'installResearch': this.showResearchInstall(); break;
            case 'startAndSend': void this.sendTreeToResearch(ctx.treeId); break;
            // Blocked by the browser: the way to allow it, then asked again.
            case 'allowHow':
                void this.showResearchConnectFailed(new TypeError('blocked')).then(retry => {
                    if (retry) void this.pollResearchBridge({ reschedule: false });
                });
                break;
            case 'openResearch': {
                const url = this.activeResearchLink('open');
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'downloadGedcom': void this.downloadResearchGedcom(ctx.treeId); break;
            case 'restoreBeforeLoad': void this.researchRestoreBeforeLoad(ctx.treeId); break;
            case 'changeSendMode': this.closeActionsMenu(); void this.showResearchTreeSettings(ctx.treeId); break;
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
        const kind = this.currentResearchSyncState().core;
        if (kind === 'writtenConflicts' || (kind === 'rejected' && this.researchUndoneConflicts(treeId) > 0)) {
            const held = kind === 'writtenConflicts' ? (this.researchHeld(treeId)?.takeovers ?? []) as PersonId[] : [];
            return [...new Set([...persons, ...held])].filter(id => DataManager.getPerson(id));
        }
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
        void this.researchTitlesCatchUp();
        this.refreshActionMenuBadges();
        this.renderResearchSyncPill();
        // "Only in browser" depends on what the research holds.
        this.refreshUnsavedForResearch();
        // A bridge that says whether it knows what variants connect: the view links show or go.
        this.viewLinksBridgeChanged();
    },

    /**
     * A research that keeps titles now (updated from 1.12) and never got this
     * tree's: they stayed here while it did not know them, or the tree went
     * before it said so (B18-1). The open tree in step with it holds titles
     * its version lacks, so that version — the one loaded, or the send it
     * wrote — is the tree without them: its fingerprint and the kept copy say
     * so, and the titles are changes to send ("What will be sent", the next
     * send). A send still in its inbox is waited for; one discarded or taken
     * back there waits for the user's next step as it does.
     */
    async researchTitlesCatchUp(): Promise<void> {
        if (titlesCatchingUp) return;
        const ctx = this.researchSyncLink();
        if (!ctx || DataManager.isReadOnly() || DataManager.isTreeLocked()) return;
        const features = this.researchStatusOf(ctx.link.id)?.features;
        if (researchHasTitles(ctx.link, features) || !features?.includes(TITLES_FEATURE) || ctx.link.sent?.state === 'pending') return;
        if (!hasTitles(DataManager.getData())) return;
        titlesCatchingUp = true;
        try {
            // The copy read first (the changes per person count from it).
            await this.researchChangesReady();
            const now = this.researchSyncLink();
            if (!now || now.treeId !== ctx.treeId || researchHasTitles(now.link, features) || now.link.sent?.state === 'pending') return;
            const { treeId, link } = now;
            const data = DataManager.getData();
            if (!hasTitles(data)) return;
            const fps = this.researchSyncFingerprints(treeId, link);
            const sentHere = link.sent?.state === 'written' && fps.current === link.sent.fingerprint;
            if (!fps.matchesBase && !sentHere) return;
            const bare = contentFingerprint(withoutTitles(data));
            if (bare === fps.current) return;
            await this.researchRetagCopy(treeId, [link.fingerprint, ...(sentHere ? [link.sent!.fingerprint] : [])], bare, withoutTitles);
            TreeManager.patchResearchLink(treeId, {
                ...(fps.matchesBase ? { fingerprint: bare } : {}),
                ...(sentHere ? { sent: { ...link.sent!, fingerprint: bare } } : {}),
            });
            fpCache = null;
        } finally {
            titlesCatchingUp = false;
        }
        this.refreshResearchSyncUi();
        this.researchAutoArm();
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

    /** The state block at the top of the research menu: its tone, text and actions (null when there is none). */
    researchSyncBlockData(): ResearchSyncBlock | null {
        const state = this.currentResearchSyncState();
        if (state.kind === 'none') return null;
        const s = strings.sync;
        const ctx = this.researchSyncLink();
        const link = ctx?.link;
        const treeId = ctx?.treeId;
        const archive = !!link && this.researchModeOf(link.id, link) === 'archive';
        const auto = researchSendMode(link) === 'auto';
        const autoState = treeId ? researchAutoState(treeId) : {};
        type Action = ResearchSyncBlockAction;
        type Block = { tone: 'warn' | 'neutral' | 'quiet'; title: string; sub?: string; actions?: Action[]; spinner?: boolean };
        const changed = treeId ? when(TreeManager.getTreeMetadata(treeId)?.changedAt) : '';
        const edits = Math.max(1, autoState.edits ?? 1);
        const rt = link ? runtime.get(link.id) : undefined;
        // A research tree on a computer can always be started (announced or not); while the research is not known
        // to be on this computer, the way to install it goes beside.
        const start: Action[] = this.researchStartUrl()
            ? [{ action: 'startResearch', label: s.startResearch },
                ...(this.researchKnownHere() ? [] : [{ action: 'installResearch', label: strings.research.awaitingNotInstalled, asLink: true }])]
            : [];
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
                    const name = one ? shownNameOrEmpty(one) : '';
                    actions.push({ action: 'showConflicts', label: name ? `${name} ›` : `${s.showConflicts} ›`, asLink: true });
                    if (treeId && this.researchDecideUrl(treeId)) actions.push({ action: 'decideInResearch', label: s.decideInResearch, asLink: true });
                }
                return { tone: 'quiet', title: s.writtenAt(when(lw?.at)), sub: parts.join(' · ') || undefined, actions };
            },
            writtenConflicts: () => {
                const lw = autoState.lastWritten;
                const conflicts = treeId ? this.researchHeldConflictCount(treeId, state.sent) : 0;
                const persons = treeId ? this.researchWrittenConflictPersons(treeId) : [];
                const one = persons.length === 1 ? DataManager.getPerson(persons[0]) : null;
                const name = one ? shownNameOrEmpty(one) : '';
                const actions: Action[] = [];
                if (treeId && this.researchDecideUrl(treeId)) actions.push({ action: 'decideInResearch', label: s.decideInResearch, asLink: true });
                if (persons.length) actions.push({ action: 'showConflicts', label: name ? `${name} ›` : `${s.showConflicts} ›`, asLink: true });
                actions.push({ action: 'loadNewer', label: s.loadVersion, asLink: true });
                // How the research is reached, said beside the conflict (it outranks the connection as the state).
                const conn = link ? this.researchConnectionNote(link.id) : null;
                // The research's value stands there only while a conflict really is open.
                const at = s.writtenAt(when(lw?.at ?? state.sent?.closedAt));
                return { tone: conn && conn.warn ? 'warn' : 'neutral', title: conflicts > 0 ? s.flyConflict(conflicts) : at,
                    sub: [conn ? `${conn.title}.` : '', conn?.sub ?? '', conflicts > 0 ? at : '', conflicts > 0 ? s.writtenConflictsSub : ''].filter(Boolean).join(' '), actions };
            },
            unsent: () => ({ tone: 'warn', title: s.stateUnsent, sub: changed ? s.changedAt(changed) : undefined, actions: [{ action: 'send', label: s.send }] }),
            notTaken: () => ({ tone: 'neutral', title: s.stateUnsent, sub: s.notTakenSub, actions: [{ action: 'send', label: s.send }] }),
            sentPending: () => ({ tone: 'neutral', title: s.stateSent(when(state.sent?.at), state.sent?.changes ?? null),
                sub: s.statePendingSub, actions: this.researchLinkAvailable('open') ? [{ action: 'openResearch', label: s.openResearch, asLink: true }] : [] }),
            newer: () => {
                const at = rt?.status?.headAt;
                return { tone: 'neutral', title: s.stateNewer, sub: s.newerSub(at ? when(at) : ''), actions: [{ action: 'loadNewer', label: s.load }] };
            },
            // The last send left changes unwritten: amber (a dot) until the list was seen, then neutral; until the next send.
            notWritten: () => {
                const nw = autoState.notWritten;
                const m = (nw?.items.length ?? 0) + (nw?.unexplained ?? 0);
                return { tone: nw?.seen ? 'neutral' : 'warn', title: s.writtenCount(nw?.written ?? 0, m).replace(/\.$/, ''),
                    sub: s.notWrittenSub(when(nw?.at)), actions: [{ action: 'showWritten', label: s.showConflicts, asLink: true }] };
            },
            // Out of "only load": what piled up meanwhile, nothing goes before it is seen.
            piled: () => {
                const n = this.researchChangesNow()?.length ?? 0;
                return { tone: 'neutral', title: n ? strings.treeSettings.piled(n) : s.stateUnsent,
                    actions: [{ action: 'showChangesFirst', label: strings.treeSettings.whatWillBeSent }] };
            },
            // The research's version loaded within the hour: the way back in sight (later only the menu row).
            loaded: () => {
                const lb = treeId ? this.researchLoadBackup(treeId) : null;
                return { tone: 'quiet', title: s.loadedTitle(when(lb?.at)), actions: [{ action: 'restoreBeforeLoad', label: s.restoreBeforeLoad, asLink: true }] };
            },
            // Only loading: a quiet line in place of the state, with the way to change it.
            off: () => ({ tone: 'quiet', title: s.sendOffLine, actions: [{ action: 'changeSendMode', label: s.sendOffChange, asLink: true }] }),
            // Send goes as any send (by hand through "What will be sent"); the newer version loads only when asked (V-I).
            unsentAndNewer: () => ({ tone: 'warn', title: s.stateUnsent, sub: s.unsentNewerSub, actions: [{ action: 'send', label: s.send }] }),
            waitThenLoad: () => ({ tone: 'neutral', title: s.stateSent(when(state.sent?.at), state.sent?.changes ?? null),
                sub: s.waitThenLoadSub, actions: [{ action: 'cancelLoad', label: s.cancelLoad, asLink: true }] }),
            // Stuck or blocked by the browser: the way out first, starting the research always beside it (never neither).
            bridgeDown: () => rt?.why === 'hung'
                ? { tone: 'warn', title: s.stateNotResponding, sub: s.notRespondingSub, actions: start.map(a => ({ ...a, asLink: true })) }
                : rt?.why === 'denied'
                    ? { tone: 'warn', title: s.stateBlocked, sub: blockedSub(), actions: [{ action: 'allowHow', label: s.allowHow }, ...start.map(a => ({ ...a, asLink: true }))] }
                : rt?.why === 'refused'
                    ? { tone: 'warn', title: s.stateAddressRefused, sub: s.addressRefusedSub, actions: start }
                    : { tone: 'quiet', title: s.stateBridgeDown, sub: s.bridgeDownSub, actions: start.map(a => ({ ...a, asLink: true })) },
            unsentBridgeDown: () => ({ tone: 'warn', title: s.stateUnsent, sub: s.unsentBridgeDownSub,
                actions: this.researchLinkAvailable('send') ? [{ action: 'startAndSend', label: s.startAndSend }] : start }),
            refused: () => ({ tone: 'warn', title: s.stateRefused,
                sub: [state.reason, s.staysHere].filter(Boolean).join(' '), actions: [{ action: 'retry', label: s.retry }] }),
            rejected: () => state.sent?.state === 'undone'
                ? this.researchUndoneBlock(treeId, auto, state.sent)
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
                : { tone: 'neutral', title: s.switchedToAgentTitle, sub: s.switchedToAgentSub, actions: [{ action: 'gotIt', label: s.gotIt, asLink: true }] },
            offerAuto: () => ({ tone: 'neutral', title: s.offerAutoTitle,
                actions: [{ action: 'offerYes', label: s.offerAutoYes }, { action: 'offerNo', label: s.offerAutoNo, asLink: true }] }),
            autoIntro: () => ({ tone: 'neutral', title: s.autoIntroTitle, sub: s.autoWhen,
                actions: [{ action: 'introSeen', label: s.gotIt, asLink: true }, { action: 'introChange', label: s.autoIntroChange, asLink: true }] }),
        };
        const b = blocks[state.kind]();
        // How the research is reached, said in every other state too (A1): not running, stuck, or turning this app down.
        const connNote = link ? this.researchConnectionNote(link.id) : null;
        if (connNote && !['bridgeDown', 'unsentBridgeDown', 'autoBridgeDown', 'writtenConflicts', 'rejected', 'safari', 'stale'].includes(state.kind)) {
            b.sub = [b.sub, `${connNote.title}.`, connNote.sub].filter(Boolean).join(' ');
            if (connNote.warn) b.tone = 'warn';
        }
        // The bridge there but stuck, or answering not to this app: said as such whatever waits (B4, B5).
        if (rt && !rt.up && (rt.why === 'hung' || rt.why === 'refused' || rt.why === 'denied') && ['unsentBridgeDown', 'autoBridgeDown'].includes(state.kind)) {
            b.tone = 'warn';
            if (rt.why === 'denied') {
                // The changes wait; what keeps them is the browser (starting the research only beside, never neither).
                b.title = s.stateBlocked;
                b.sub = [s.staysHere, blockedSub()].join(' ');
                b.actions = [{ action: 'allowHow', label: s.allowHow }, ...start.map(a => ({ ...a, asLink: true }))];
            } else {
                b.title = rt.why === 'hung' ? s.stateNotResponding : s.stateAddressRefused;
                b.sub = [b.sub, rt.why === 'hung' ? s.notRespondingSub : s.addressRefusedSub].filter(Boolean).join(' ');
            }
        }
        // A switch of mode not yet acknowledged: said under the state, with its "Got it".
        if (state.switchedNote) {
            b.sub = [b.sub, archive ? s.switchedToArchiveTitle : s.switchedToAgentTitle].filter(Boolean).join(' · ');
            b.actions = [...(b.actions ?? []), { action: 'gotIt', label: s.gotIt, asLink: true }];
        }
        // Changes per person: how many people, and "What will be sent ›" / "What was written ›".
        if (['unsent', 'autoWaiting', 'unsentBridgeDown', 'unsentAndNewer', 'notTaken'].includes(state.kind)) {
            const list = this.researchChangesNow();
            if (list && list.length > 0) {
                b.sub = [strings.changes.personsChanged(list.length), b.sub].filter(Boolean).join(' · ');
                b.actions = [...(b.actions ?? []), { action: 'showChanges', label: strings.changes.whatWillBeSent, asLink: true }];
            }
        } else if (state.kind === 'written' && treeId && researchWrittenList(treeId)?.list.length && researchSendMode(link) !== 'off') {
            b.actions = [...(b.actions ?? []), { action: 'showWritten', label: strings.changes.whatWasWritten, asLink: true }];
        }
        // Changes of an older send taken back, left behind by Send again of a later one (R3 keeps them out of
        // Send again, a copy never writes them): said with the way to see the difference, never silent.
        const behind = this.researchUndoneLeftBehind();
        if (behind && !['rejected', 'stale', 'safari', 'sending'].includes(state.kind)) {
            b.tone = 'warn';
            b.sub = [b.sub, s.leftBehind(when(behind.at))].filter(Boolean).join(' ');
            if (!(b.actions ?? []).some(a => a.action === 'loadNewer')) b.actions = [...(b.actions ?? []), { action: 'loadNewer', label: s.loadVersion, asLink: true }];
        }
        // ("Only load from the research" is the quiet `off` block; a real state of the research outranks it.
        // "Restore the state before loading" is the `loaded` block for an hour, then a row of the menu.)
        return { kind: state.kind, tone: b.tone, title: b.title, sub: b.sub, actions: b.actions ?? [], spinner: !!b.spinner,
            sendingNow: !!treeId && sendingTree === treeId };
    },

    /**
     * The state block as the research menu draws it ('' when there is none).
     * Only its text is a live region; its buttons are items of the menu (the
     * first one described by the text), not announced again with every change.
     */
    researchSyncBlockHtml(data?: ResearchSyncBlock | null): string {
        const b = data === undefined ? this.researchSyncBlockData() : data;
        if (!b) return '';
        const s = strings.sync;
        const sendingNow = b.sendingNow;
        const buttons = b.actions.map((a, i) => {
            const describe = i === 0 ? ' aria-describedby="research-sync-status"' : '';
            const busy = sendingNow && !a.asLink && ['send', 'sendThenLoad', 'retry', 'sendAgain'].includes(a.action);
            return a.asLink
                ? `<button type="button" class="research-sync-link" role="menuitem" data-action="${a.action}"${describe} onclick="${call('researchSyncAction', `'${a.action}'`)}">${esc(a.label)}</button>`
                : `<button type="button" class="primary btn-sm research-sync-btn" role="menuitem" data-action="${a.action}"${describe}${busy ? ' disabled aria-busy="true"' : ''}`
                    + ` onclick="${call('researchSyncAction', `'${a.action}'`)}">${busy ? `<span class="research-sync-spinner" aria-hidden="true"></span>${esc(s.sending)}` : esc(a.label)}</button>`;
        }).join('');
        // (An archive says so beside the menu's title, not again in the block.)
        return `<div class="research-sync-block research-sync-block--${b.tone}" id="research-sync-block" data-state="${b.kind}">`
            + `<div class="research-sync-status" id="research-sync-status" role="status" aria-live="polite">`
            + `<div class="research-sync-title">${b.spinner ? '<span class="research-sync-spinner" aria-hidden="true"></span>' : ''}${esc(b.title)}</div>`
            + (b.sub ? `<div class="research-sync-sub">${esc(b.sub)}</div>` : '')
            + '</div>'
            + (buttons ? `<div class="research-sync-actions">${buttons}</div>` : '')
            + this.originalsQueueLineHtml()
            + this.batchLineHtml()
            + '</div>';
    },

    /**
     * The block of a send taken back: Send again, or keep the undo. A send
     * written since that left conflicts (its copy still carried the send taken
     * back) is in sight beside it — what it wrote stands (finding 39).
     */
    researchUndoneBlock(treeId: TreeId | undefined, auto: boolean, sent: ResearchSend | undefined): {
        tone: 'warn'; title: string; sub: string; actions: { action: string; label: string; asLink?: boolean }[];
    } {
        const s = strings.sync;
        const conflicts = treeId ? this.researchUndoneConflicts(treeId) : 0;
        const actions: { action: string; label: string; asLink?: boolean }[] = [{ action: 'sendAgain', label: s.sendAgain }];
        const link = treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
        const kept = !!link && !this.researchHoldsForUndo(link);
        const sub = [kept ? s.undoneKeptSub(when(sent?.closedAt)) : auto ? s.undoneAutoSub(when(sent?.closedAt)) : s.undoneSub(when(sent?.closedAt))];
        if (sent?.takenBack) sub.push(s.takenBackSub(sent.takenBack));
        const conn = link ? this.researchConnectionNote(link.id) : null;
        if (conn) sub.unshift(`${conn.title}.`, ...(conn.warn ? [conn.sub] : []));
        if (treeId && conflicts > 0) {
            // The time of that write when known; never empty brackets (R5 of the N1 round).
            const at = when(researchAutoState(treeId).lastWritten?.at);
            sub.push(at ? `${s.flyConflict(conflicts)} (${at}).` : `${s.flyConflict(conflicts)}.`);
            const persons = this.researchWrittenConflictPersons(treeId);
            const one = persons.length === 1 ? DataManager.getPerson(persons[0]) : null;
            const name = one ? shownNameOrEmpty(one) : '';
            actions.push({ action: 'showConflicts', label: name ? `${name} ›` : `${s.showConflicts} ›`, asLink: true });
            if (this.researchDecideUrl(treeId)) actions.push({ action: 'decideInResearch', label: s.decideInResearch, asLink: true });
        }
        actions.push({ action: 'acceptUndo', label: s.loadVersion, asLink: true });
        return { tone: 'warn', title: s.stateUndone(when(sent?.at)), sub: sub.join(' '), actions };
    },

    /**
     * The research's conflicts read from its version that was not loaded
     * (researchReadHeld), while the tree still builds on the head it was read
     * against; null: none, or the tree moved on (that version or a later one loaded).
     */
    researchHeld(treeId: TreeId): ResearchHeldConflicts | null {
        const held = researchAutoState(treeId).held;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        return held && link && held.base === (link.head ?? '') ? held : null;
    },

    /** A person's conflicts as the research has them now: its unloaded version's when read (finding 40), else the tree's (less those decided there since, V-E). */
    researchConflictsOf(personId: PersonId): ResearchConflict[] {
        const treeId = DataManager.getCurrentTreeId();
        const held = treeId ? this.researchHeld(treeId) : null;
        if (held && personId in held.persons) return held.persons[personId];
        const own = DataManager.getPerson(personId)?.research?.conflicts ?? [];
        const settled = treeId ? this.researchSettledConflicts(treeId) : null;
        return settled ? own.filter(c => !settled.has(c.id)) : own;
    },

    /** Conflicts decided in the research since the tree's version was loaded (null: none known). */
    researchSettledConflicts(treeId: TreeId): Set<string> | null {
        const sc = researchAutoState(treeId).settledConflicts;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        return sc && link && sc.base === (link.head ?? '') && sc.ids.length ? new Set(sc.ids) : null;
    },

    /**
     * "Written, N conflicts to decide": the conflicts open there, each once —
     * as the cards count them when known here; else the research's largest
     * single count (its sends repeat a conflict still open, so their sum
     * overcounts: R1 of the rc.49 round). 0: none known.
     */
    researchHeldConflictCount(treeId: TreeId, sent: ResearchSend | undefined): number {
        const cards = this.researchOpenConflictTotal(treeId);
        if (cards > 0) return cards;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const sends = link ? runtime.get(link.id)?.status?.sends ?? [] : [];
        const largest = sends.filter(r => link && (r.tree === treeId || r.tree === link.id) && r.state === 'written')
            .reduce((n, r) => Math.max(n, r.conflicts ?? 0), 0);
        return Math.max(sent?.conflicts ?? 0, researchAutoState(treeId).lastWritten?.conflicts ?? 0, largest);
    },

    /** The conflicts still open in the research from this tree's sends, as its `/status.sends` says (0: none, or not known). */
    researchSendsOpenConflicts(treeId: TreeId, link: ResearchLink): number {
        const sends = runtime.get(link.id)?.status?.sends ?? [];
        return sends.filter(r => (r.tree === treeId || r.tree === link.id) && r.state === 'written')
            .reduce((n, r) => n + Math.max(0, r.conflicts ?? 0), 0);
    },

    /** The conflicts open in the research for the open tree's people: its unloaded version's where read, else the tree's. */
    researchOpenConflictTotal(treeId: TreeId): number {
        if (DataManager.getCurrentTreeId() !== treeId) return 0;
        let n = 0;
        for (const id of Object.keys(DataManager.getData().persons)) n += this.researchConflictsOf(id as PersonId).filter(c => c.status === 'open').length;
        return n;
    },

    /** Read the research's version (not loading it) for what its conflicts say now; true when read. */
    async researchReadHeld(treeId: TreeId): Promise<boolean> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || DataManager.getCurrentTreeId() !== treeId) return false;
        const bridge = parseLiveBridge(storedResearchBridge(link.id)?.base);
        if (!bridge) return false;
        let text: string;
        try {
            text = await fetchGedcomText(bridge.ged);
        } catch {
            return false;
        }
        const header = readResearchHeader(text);
        if (!header.isStromResearch || header.treeId !== link.id) return false;
        let data: StromData;
        try {
            data = convertToStrom(parseGedcom(text)).data;
        } catch {
            return false;
        }
        const now = TreeManager.getTreeMetadata(treeId)?.research;
        if (DataManager.getCurrentTreeId() !== treeId || !now || now.head !== link.head) return false;
        const previous = DataManager.getData();
        const head = header.head || runtime.get(link.id)?.status?.head || '';
        patchResearchAutoState(treeId, { held: heldConflicts(previous, stabilizeIds(data, previous), link.head ?? '', head) });
        this.refreshResearchSyncUi();
        TreeRenderer.render();
        return true;
    },

    /**
     * A send taken back holds what goes by itself: a research before 1.12.0-rc.19
     * would write it again from any copy (finding 43). A later one leaves it out
     * (`takenBack`), so edits since go as usual and the send taken back stays out.
     */
    researchHoldsForUndo(link: ResearchLink): boolean {
        return link.sent?.state === 'undone'
            && !researchKeepsTakenBack(this.researchBridgeVersion(link.id), runtime.get(link.id)?.status?.features);
    },

    /**
     * Numbers the research gave what a send added, by that file's xrefs, onto
     * the open tree's people and sources without one — quietly: a number of
     * the research is no edit of the user's. When nothing was edited since the
     * send, the sent state takes them in too (it is not "changes to send"),
     * and that state with its fingerprint is returned (else null).
     */
    researchTakeSyncIds(treeId: TreeId, xrefs: ExportXrefs, ids: AdoptIds, sentFp: string): { fingerprint: string; data: StromData } | null {
        if (DataManager.getCurrentTreeId() !== treeId || DataManager.isReadOnly() || DataManager.isTreeLocked()) return null;
        const before = DataManager.getData();
        const unchanged = contentFingerprint(before) === sentFp;
        const { data, changed } = applySyncIds(before, xrefs, ids);
        if (!changed) return null;
        quietLoading = true;
        try {
            DataManager.replaceWithSourceData(data);
        } finally {
            quietLoading = false;
        }
        fpCache = null;
        let retagged: { fingerprint: string; data: StromData } | null = null;
        if (unchanged) {
            const link = TreeManager.getTreeMetadata(treeId)?.research;
            const fp = contentFingerprint(DataManager.getData());
            if (link?.sent && link.sent.fingerprint === sentFp) {
                TreeManager.patchResearchLink(treeId, { sent: { ...link.sent, fingerprint: fp } });
                retagged = { fingerprint: fp, data: DataManager.getData() };
            }
        }
        // Originals that waited for these people or sources to be known there go now (F2).
        void this.researchOriginalsKick();
        return retagged;
    },

    /** Conflicts a send written beside a send taken back left open (0: none). */
    researchUndoneConflicts(treeId: TreeId): number {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (link?.sent?.state !== 'undone') return 0;
        // Every conflict open there, each once (as the cards count them), not only those the last write named.
        const cards = this.researchOpenConflictTotal(treeId);
        return cards > 0 ? cards : researchAutoState(treeId).lastWritten?.conflicts ?? 0;
    },

    /** The newest older send taken back whose changes Send again of a later one left here only (see undoneLeftBehind). */
    researchUndoneLeftBehind(): ResearchSendRecord | null {
        const ctx = this.researchSyncLink();
        if (!ctx) return null;
        const { treeId, link } = ctx;
        if (link.sent?.state === 'undone') return null;
        return undoneLeftBehind(runtime.get(link.id)?.status?.sends, tree => tree === treeId || tree === link.id,
            researchAutoState(treeId).resent ?? [], link.syncedAt)[0] ?? null;
    },

    /** The sync state asks for the user (the Research button's dot, after a waiting count). */
    researchSyncAttention(): boolean {
        const state = this.currentResearchSyncState();
        const kind = state.kind;
        // Not written: a dot until its list was seen.
        const ctx = this.researchSyncLink();
        const notWrittenSeen = kind === 'notWritten' && !!ctx && !!researchAutoState(ctx.treeId).notWritten?.seen;
        return (researchSyncWantsAttention(kind) && !notWrittenSeen) || this.originalsQueueWarn() || !!this.researchUndoneLeftBehind();
    },

    /**
     * Changes not sent: `dot` as the toolbar has them (a block over them, e.g.
     * "piled up", does not hide them); `label` for the Research button's name.
     */
    researchSyncUnsentNow(): { dot: boolean; label: boolean } {
        const state = this.currentResearchSyncState();
        return { dot: state.core === 'unsent' || state.core === 'notTaken',
            label: researchSyncUnsent(state.kind) || researchSyncUnsent(state.core) };
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
            pill.onclick = null;
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
            unsentAndNewer: { text: s.barUnsent, button: s.barSend, action: 'send' },
            stale: { text: s.pillStale, button: strings.storageSafety.reload, action: 'reload' },
            // A write left conflicts: they stay in sight until decided or the version is loaded (finding 40).
            // A send taken back or discarded: in sight however changes go (sent by hand too, B1).
            rejected: { text: state.sent?.state === 'undone'
                ? [s.pillUndone, this.researchUndoneConflicts(ctx.treeId) > 0 ? s.conflictsN(this.researchUndoneConflicts(ctx.treeId)) : ''].filter(Boolean).join(' · ')
                : state.sent?.failed ? s.pillFailed : s.pillRejected, button: s.sendAgain, action: 'sendAgain' },
            writtenConflicts: { text: [this.researchHeldConflictCount(ctx.treeId, state.sent) > 0
                ? s.flyConflict(this.researchHeldConflictCount(ctx.treeId, state.sent)) : s.writtenAt(when(researchAutoState(ctx.treeId).lastWritten?.at ?? state.sent?.closedAt)),
                this.researchConnectionNote(ctx.link.id)?.title ?? ''].filter(Boolean).join(' · '), button: s.showConflicts, action: 'conflicts' },
            ...(auto ? {
                autoBridgeDown: { text: archive ? s.pillBridgeDownWaiting(Math.max(1, researchAutoState(ctx.treeId).edits ?? 1)) : s.pillBridgeDown,
                    button: s.pillStart, action: 'startResearch' },
                autoPaused: { text: s.pillRefused, button: s.sendAgain, action: 'retry' },
            } : {}),
        };
        // The bridge there but stuck, or answering not to this app: in sight, never the quiet mark (B4, B5).
        const rtNow = runtime.get(link!.id);
        // (Beside another warning it is said in that one's text; alone, in its own — whatever the state, A1.)
        const badBridge = !!rtNow && !rtNow.up && (rtNow.why === 'hung' || rtNow.why === 'refused' || rtNow.why === 'denied')
            && (!warn[kind] || kind === 'unsentBridgeDown' || kind === 'autoBridgeDown') && kind !== 'safari' && kind !== 'stale';
        const conn = this.researchConnectionNote(link!.id);
        const base = warn[kind];
        const w = badBridge
            ? { text: rtNow!.why === 'hung' ? s.stateNotResponding : rtNow!.why === 'denied' ? s.pillBlocked : s.stateAddressRefused, button: s.showConflicts, action: 'conflicts' }
            : base && conn?.warn && kind !== 'writtenConflicts' ? { ...base, text: `${base.text} · ${conn.title}` } : base;
        // A new conflict's note (with the person) first; the pill once it goes.
        const noteFirst = kind === 'writtenConflicts' && note?.kind === 'conflict';
        if (w && !noteFirst && (w.action !== 'startResearch' || !!this.researchStartUrl())) {
            this.closeResearchSyncNote();
            // The research's reason, when it gave one, on hover too (not only in the block).
            const tip = kind === 'rejected' && !state.sent?.failed && state.sent?.reason ? `${w.text}: ${state.sent.reason}` : w.text;
            // The state (mark, text, its title) opens the details; only the button acts (R4 of the rc.49
            // round: the pill named by the state, its text hidden, had the button in its middle).
            set('is-warn', `<span class="research-sync-pill-mark" title="${esc(tip)}" aria-hidden="true">!</span>`
                + `<span class="research-sync-pill-label" title="${esc(tip)}">${esc(w.text)}</span>`
                + `<button type="button" class="research-sync-pill-send" data-action="${w.action}" onclick="event.stopPropagation(); ${call('researchSyncAction', `'${w.action}'`)}">${esc(w.button)}</button>`);
            pill.onclick = (e) => {
                if (!(e.target as Element | null)?.closest('button')) this.openResearchSyncMenu();
            };
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
            // "Only load from the research": never a Send button — the quiet mark says nothing goes.
            if (researchSendMode(link) === 'off') {
                const down = kind === 'bridgeDown';
                const label = down ? s.stateBridgeDown : s.sendOffLine;
                set('is-send', `<button type="button" class="research-sync-mark" id="research-sync-mark" data-look="${down ? 'ghost' : 'off'}"`
                    + ` title="${esc(label)}" aria-label="${esc(label)}" onclick="${call('openResearchSyncMenu')}">`
                    + `<span class="research-sync-mark-${down ? 'ghost' : 'dot'}" aria-hidden="true"></span></button>`);
                return;
            }
            // Nothing to send: the button's place stays (empty), so the toolbar does not move when it comes.
            if (kind !== 'unsent' && kind !== 'notTaken') {
                // In its place the quiet mark (in step, or the research not running), at the end next to the tree switcher.
                const down = kind === 'bridgeDown' || kind === 'unsentBridgeDown';
                const lwm = researchAutoState(ctx.treeId).lastWritten;
                const label = down ? (lwm ? s.markBridgeDown(when(lwm.at)) : s.stateBridgeDown) : lwm ? s.writtenAt(when(lwm.at)) : s.stateInSync;
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
            label = lw ? s.markBridgeDown(when(lw.at)) : s.stateBridgeDown;
        } else if (kind === 'notTaken') {
            look = 'dot';
            label = s.stateUnsent;
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

    /** The pill (its state, the mark): the research menu, focus back here when it closes. */
    openResearchSyncMenu(): void {
        this.closeResearchSyncNote();
        if (this.isResearchMenuOpen()) {
            this.closeResearchMenu();
            return;
        }
        const pill = document.getElementById('research-sync-pill');
        const active = document.activeElement;
        const opener = pill && active instanceof HTMLElement && pill.contains(active)
            ? active : pill?.querySelector<HTMLElement>('button') ?? null;
        this.openResearchMenu({ opener });
    },

    /** The note under the mark: a send by itself left a new conflict. */
    showResearchConflictNote(conflicts: number, persons: readonly PersonId[]): void {
        const s = strings.sync;
        const one = persons.length === 1 ? DataManager.getPerson(persons[0]) : null;
        const name = one ? shownNameOrEmpty(one) : '';
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
            case 'rejected': return { text: state.sent?.state !== 'undone' ? t.statusRejected(when(state.sent?.at))
                : !this.researchHoldsForUndo(link) ? t.statusUndoneKept(when(state.sent?.at)) : t.statusUndone(when(state.sent?.at)),
                warn: true, action: 'sendAgain' };
            case 'sentPending': case 'waitThenLoad': return { text: strings.sync.markPending(when(state.sent?.at)), warn: false };
            case 'autoBridgeDown':
                if (runtime.get(link.id)?.why === 'denied') return { text: t.statusBlocked, warn: true };
                if (archive) {
                    const rt = runtime.get(link.id);
                    return { text: t.statusArchiveBridgeDown(whenMs(rt?.downSince ?? 0), Math.max(1, st.edits ?? 1)), warn: true };
                }
                return { text: t.statusBridgeDown, warn: false };
            case 'bridgeDown': case 'unsentBridgeDown':
                return runtime.get(link.id)?.why === 'denied' ? { text: t.statusBlocked, warn: true } : { text: t.statusBridgeDown, warn: false };
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
