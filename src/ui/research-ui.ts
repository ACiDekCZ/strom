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

import { noteOverviewSectionRows } from './overview-columns-ui.js';
import { keepTableViews } from '../table-views-data.js';
import { setResearchActionLabel, researchActionMark } from './research-open-mark.js';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { researchHypothesisLogLine } from '../research-hypotheses.js';
import { sessionTone } from '../live-follow-targets.js';
import { hasFollowPrefs, resetFollowPrefs, restoreFollowPrefs } from '../live-follow-prefs.js';
import { helpMark } from './help-mark.js';
import type { HelpTopic } from '../help/topics.js';
import { StromData, TreeId, PersonId, SourceExcerpt, TreeImagesVariant } from '../types.js';
import { parseGedcom, convertToStrom, decodeGedcomFile, parseGedcomDate } from '../ged-parser.js';
import { formatFlexDate, instantLocalDay } from '../dates.js';
import { formatLiveTime, formatLiveClock } from '../live-time.js';
import { isMobile } from '../breakpoints.js';
import {
    readResearchHeader, parseLoopbackUrl, parseLiveBridge, contentFingerprint, fingerprintLike,
    decideResearchOpen, stabilizeIds, keepTitles, keepMarriedSurname, keepSurnameVariants, keepLineageOverrides, researchHasTitles, withResearchTitles, TITLES_FEATURE, carryOverMedia, carryOverUnknownPartners, sanitizeLiveStatus, sanitizeLiveChange,
    sanitizeLiveEnd, sanitizeWorking, WORKING_HELPS_FEATURE, researchFamilyPartners, workingWithFamilyPersons, parseEventData, extractChangedRefs, personsByRefs,
    humanizeChange, isGedcomFileName, isSafariBrowser,
    parseSendBridge, pickSendDefault, sanitizeSyncReply, researchSchemeUrl, researchTaskRef,
    ResearchLinkAction, ResearchLinkParams, LiveBridgeUrls, LiveStatus, LiveChange, LiveWorker, LiveWaiting,
    LiveQueueItem, LiveSpend, LiveIntake, LiveDirection, LiveBusy, LiveWork, ResearchCaps, BrowserInfo, LiveOffLine, ResearchHeaderInfo, ExportXrefs, ResearchAccepts, statusAgentless,
    LiveQueueCounts, QUEUE_PAGE_FEATURE, QUEUE_SEARCH_FEATURE,
    researchLinkMark, researchUrlMark,
} from '../research-link.js';
import { keepImports } from '../import-origin.js';
import { uiModule } from './module.js';
import { returnFocusAfterViewer } from './sources.js';
import { withAppVersion, researchGedcomTitles, researchSendsReadings, researchSendsSourceFields, TitlesInGedcom, changeKind, changeAdds, sanitizeLiveLog, sourceIdsByRef, findSourceTitle, lineNewerThanLoaded, textKind, textPersonRefs, textWithoutRefs, LiveChangeKind, LiveLogEntry, LiveCommitAdds, LiveRecent, waitingAnswerPlace } from '../research-link.js';
import { overviewInWindow } from '../windows/overview-window.js';
import { AGENT_DONE_MS, AGENT_DONE_FADE_MS, ResearchCardInfo, setResearchCardInfoProvider } from '../card-signals.js';
import {
    activeDirections, directionGlyph, directionsMulti, keepLineFocus, lineGlyphFor, linesMulti, queueDirectionFilter, selectedLine,
    taskDirectionName, workingLineCount, workingLineGroups,
} from './research-directions-ui.js';
import { iconSvg } from '../icons.js';
import {
    branchName, focusQueueMoved, personByRefn, queueBranchFilter, queueNextFor, queueNextOffered, queueRowFlash, queueWhyText, setQueueBranchFilter, taskMenuOrders, taskOrderOffered,
    waitBranchText, workingWhyText,
} from './research-offline-ui.js';
import type { TaskOrderDo } from '../research-directions-write.js';
import { OTHER_GROUP, panelWaiting, textWithLinks, todoWaiting, waitingSection, waitingTodoCount } from '../research-waiting.js';
import { agoShort } from '../research-others.js';
import {
    PrefKey, SECTION_PREFS_EVENT, SectionPref, autoFoldOrder, hasSectionPrefs, isImportantWaiting, resetSectionPrefs, restoreSectionPrefs, newWaiting, noteWaitingSeen, panelSectionOrder, sectionPrefs, sectionPrefsSnapshot, setSectionPref, topPrefs,
    waitingSeen, watchSectionPrefsStorage, PANEL_PREF_KEYS,
} from './live-section-prefs.js';
import {
    QUEUE_ROWS_CAP, QueueFilter, QueueList, loadMoreQueueList, noteQueueRev, onQueueListsChange, queueList, queueListItem, queueRemote, requestQueueList,
    resetQueueLists, retryQueueList,
} from '../research-queue-pages.js';
import {
    QueueSearch, activeQueueSearch, clearQueueSearch, markQueueSearchPending, queueSearchFor, queueSearchOffered, sayQueueSearch,
} from './queue-search-ui.js';
import { followNotice, researchNameBeside, FOLLOW_NOTICE_MS, FOLLOW_HIGHLIGHT_MS, FollowTreeRef } from '../research-follow.js';
import { SettingsManager } from '../settings.js';
import { countImages, stripMedia } from '../attachments.js';
import { exportToGedcom, countFamilies } from '../ged-exporter.js';
import { formatRelativeDateTime } from '../format.js';
import { safeFileName } from '../filenames.js';
import {
    noteResearchLinks, announcedResearchLinks, announcedResearchScheme, researchLinksEnabled, noteResearchWaiting, storedResearchWaiting,
    noteResearchBridge, noteResearchBridgeStatus, researchTreeOfStatus, patchResearchAutoState, researchAutoState, researchIdAtBridge, ResearchLinkBefore,
    storedResearchBridge,
} from '../research-device.js';
import { rememberBridgeStatus, researchSendMode, researchStatusNow } from './research-sync-ui.js';
import { sourceReadings, researchSendVouches, conflictTakeovers, heldConflicts } from '../research-sync.js';
import { currentAppBrowser, appBrowserName } from '../research-transfer.js';
import { localNetworkStatus } from '../local-network.js';
import { pendingAdopt } from './pending-adopt.js';
import { shownName, shownNameOrEmpty, fitNameHtml } from '../person-name.js';
import { bindSectionMenu, sectionClickSwallowed, sectionMovedNow } from './live-section-edit-ui.js';
import { BRIDGE_ANSWER_MS } from '../bridge-ask.js';
import { bridgeGivesEtag, bridgeGivesImagesByHash, bridgeGivesStale, staleTreeUrl, storedTreeEtag, treeFamilyPartners, treeFileState, treeReplyEtag, treeReplyHeads, treeReplyImages, TREE_GED_TIMEOUT_MS, type TreeReplyHeads } from '../research-tree-file.js';
import { findImageRefs, forgetHeldImages, imagesUrlOf, refTreeUrl, resolveImageRefs, sha256Hex, type ImageResolveDeps } from '../research-image-refs.js';
import { completeStatus, statusAskUrl } from '../status-parts.js';

/** What a research open needs to know from the file (or the bridge). */
export interface ResearchSource {
    treeId: string | null;
    name: string | null;
    date: string | null;
    /** Header `_STROM_ASOF` (an ISO instant in UTC, or a bare day from older research). */
    asOf?: string;
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
    /** The sources the line names, by the research's IDs ("S0012"; a newer research). */
    sourceRefs?: string[];
    /** A hypothesis decided in the Strom app (its `what` line says so; spec 074 V14). */
    inApp?: boolean;
}

/** What one research commit added (the "+N people, +N sources" of the last 24 hours). */
export type LiveAdds = LiveCommitAdds;

/** The panel's sections (each folds on its own). */
export type LiveSectionKey = 'working' | 'waiting' | 'changes' | 'queue';

/** The overview's "Awaiting action" while open: what is unfolded, the open detail, what is new. */
export interface WaitingView {
    /** Phases ("phase:todo") and groups ("group:sent:<key>") folded or unfolded by hand or by a new item. */
    open: Map<string, boolean>;
    /** The one item whose detail is open (by id). */
    detail: string | null;
    /** Items to do that came while following, new to the user until the overview closes. */
    fresh: Set<string>;
}

export function newWaitingView(): WaitingView {
    return { open: new Map(), detail: null, fresh: new Set() };
}

export interface LiveSession {
    bridge: LiveBridgeUrls;
    researchId: string;
    treeId: TreeId;
    name: string;
    /** The research's commit the followed tree holds (the loaded file's head with `ged.stale`). */
    head: string;
    /** `/status.directions.rev`: the print of who stands where in the lines (`directions.places`). */
    directionsRev?: string;
    /**
     * The tree shown is an older one the bridge gave at once (`tree.ged?stale=1`):
     * a newer version is being built, loaded when it comes (false: none).
     */
    preparing?: boolean;
    /** When the research last changed (ISO; '' = unknown). */
    headAt: string;
    working: LiveWorker[];
    /** The research's waiting list as shown: its last status with the rows moved by a write not yet in it (research-waiting-write-ui.ts). */
    waiting: LiveWaiting[];
    /** What the bridge can do (its last status's `features`; null: not said). */
    features: string[] | null;
    /** What the research takes from the app (its last status's `accepts`). */
    accepts: ResearchAccepts | null;
    queue: LiveQueueItem[];
    queueMore: number;
    /** The queue's counts for the filters (its last status's `queueCounts`, `queue.page`; absent: not said). */
    queueCounts?: LiveQueueCounts;
    update: { version: string } | null;
    /** Sessions and runs working now (its last status's `busy`; absent: not said). */
    busy?: LiveBusy;
    /** The gate and a session's length for "Work on the queue…" (its last status's `work`, `work.link`; absent: not said). */
    work?: LiveWork;
    spend: LiveSpend | null;
    lastIntake: LiveIntake | null;
    /** The research's directions (empty: an older research). */
    researches: LiveDirection[];
    /** What the bridge does with the directions (its last status's `caps`; absent: an older research). */
    caps?: ResearchCaps;
    /** The agent's browser (its last status's `browser`, spec 048 §11; absent: not said). */
    browser?: BrowserInfo;
    /** Work outside the directions by branches (its last status's `offLine`; absent: not said). */
    offLine?: LiveOffLine;
    /** Sections the panel folded by itself for lack of room (not remembered). */
    autoCollapsed: Set<LiveSectionKey>;
    /** Waiting task ids already shown: a new one unfolds "Waiting for you" (unless the user keeps it collapsed or hidden). */
    seenWaiting: Set<string>;
    /** New items to do that came while "Awaiting action" was collapsed or hidden: their phase and groups open when it is expanded. */
    waitingPendingOpen: Set<string>;
    /** Overview sections shown expanded until it closes (a chip, a link to them), whatever their choice; hidden ones say so. */
    overviewShown: Set<string>;
    /** How the overview shows "Awaiting action" (kept until it closes). */
    waitingView: WaitingView;
    /** Changes seen with the Changes section open (for "N new"). */
    seenInSection: number;
    /** A backup of the tree was taken before following first replaced it. */
    backedUp?: boolean;
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
    /** The bridge's own count of the last 24 hours, from the latest status (null: that status had none; count from `adds`). */
    recent: LiveRecent | null;
    ended: boolean;
    collapsed: boolean;
    /** Changes already seen when the panel was collapsed (for "N new"). */
    seenChanges: number;
    es: EventSource | null;
    timer: ReturnType<typeof setTimeout> | null;
    /** A status asked after someone started or stopped working (null: none waiting). */
    statusSoon?: ReturnType<typeof setTimeout> | null;
    /** When that status was last asked (ms). */
    statusAskedAt?: number;
    /**
     * How many `working` events came (absent: none). A status asked before
     * the last one answers with who worked then: its `working` is older than
     * the event's and is not taken (the bridge's status carries no sequence).
     */
    workingEvents?: number;
    failures: number;
    /** Since when the bridge does not answer (null: it does); it may come back (a restart). */
    lostSince: number | null;
    /** The bridge said another one comes up on its address: silence until then is no loss, even after the old one still answered (null: not said). */
    backBy?: number | null;
    /** Serialises tree refreshes (a change never overtakes another). */
    chain: Promise<void>;
}

/** Following started by opening a tree waits this long for its bridge's status (it answered seconds ago). */
const AUTO_CONNECT_MS = 3000;
/** Its bridge asked once more after following could not start (as the research's own quick ask). */
const AUTO_ASK_MS = 1500;
/**
 * Wait before reconnecting to the bridge's events / between status polls
 * (also the step of the backoff while the bridge is silent). A test may
 * shorten it through `__LIVE_RECONNECT_MS`; nothing else sets it.
 */
function reconnectMs(): number {
    return (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS ?? 2000;
}
/** Poll interval when the browser has no EventSource. */
const POLL_MS = 10000;
/** "Defaults restored" with its Undo stays this long (spec 057 §5). */
const RESTORED_TOAST_MS = 8000;
/** After someone starts or stops working: the status is asked this much later (the events settle)... */
const WORKING_STATUS_DELAY_MS = 1000;
/** ...and at most once in this long. */
const WORKING_STATUS_MIN_MS = 5000;
/**
 * How long the bridge may stay silent before following ends: strom can take a
 * moment to come back (a restart, a busy moment while two runs write), so the
 * app keeps asking meanwhile and says so. A test may shorten it.
 */
function lostGraceMs(): number {
    return (globalThis as { __LIVE_GRACE_MS?: number }).__LIVE_GRACE_MS ?? 60_000;
}
/** After the bridge said another one comes up on its address: so long its silence shows no loss. */
const BACK_QUIET_MS = 15000;
/** The first status asked after that (the new bridge starts). */
const BACK_FIRST_MS = 500;
/** The longest wait between two attempts while the bridge is silent. */
const RETRY_MAX_MS = 5000;
/** Most change lines kept while following (the overview lists them all). */
const MAX_CHANGES = 3000;
/** Change lines in the small panel. */
const PANEL_CHANGES = 5;

/** The small panel hides on another tree and while the overview (which shows the same) is drawn. */
function livePanelHidden(s: LiveSession): boolean {
    // The overview in its own window (spec 079 6g): the small panel stays here.
    return DataManager.getCurrentTreeId() !== s.treeId || (s.overview && !s.ended && !overviewInWindow()) || viewingShown();
}

/**
 * The overview open without following on the tree on screen: it hides the
 * panel (an ended following's, or the one without following) as a followed
 * research's overview does; the panel lay over its ⤡ and took its click.
 */
function viewingShown(): boolean {
    // Kept for the overview's own window (6g): nothing is drawn over the panel here.
    return !!viewing && viewing.treeId === DataManager.getCurrentTreeId() && !overviewInWindow();
}

/** Whether a panel section is folded: the user's choice, else the panel's own. */
function panelSectionCollapsed(s: LiveSession, key: LiveSectionKey): boolean {
    const p = sectionPrefs()[key];
    return p === 'collapsed' ? true : p === 'expanded' ? false : s.autoCollapsed.has(key);
}

/** A section the user hid: not drawn at all. */
function panelSectionHidden(key: PrefKey): boolean {
    return sectionPrefs()[key] === 'hidden';
}

/**
 * How a panel section shows now and why (for the Customize panel editor):
 * `autoFolded` = folded by the panel itself for lack of room (no choice made).
 */
export function livePanelSectionState(key: LiveSectionKey): { current: SectionPref; autoFolded: boolean } {
    const p = sectionPrefs()[key];
    const s = live;
    if (p) return { current: p, autoFolded: false };
    const autoFolded = !!s && s.autoCollapsed.has(key);
    return { current: autoFolded ? 'collapsed' : 'expanded', autoFolded };
}

/**
 * "Awaiting action" in a heading while it is collapsed or hidden: the items
 * to do, those not seen yet, and whether any (of all to do / of the new) is
 * important. The first look at a tree notes what is there as seen.
 */
export function waitingHeadInfo(s: LiveSession): { todo: number; fresh: number; important: boolean; freshImportant: boolean } {
    const todo = todoWaiting(s.waiting);
    let seen = waitingSeen(s.treeId);
    if (!seen) {
        noteWaitingSeen(s.treeId, todo.map(w => w.id));
        seen = new Set(todo.map(w => w.id));
    }
    const fresh = newWaiting(todo, seen);
    return { todo: todo.length, fresh: fresh.length, important: todo.some(isImportantWaiting), freshImportant: fresh.some(isImportantWaiting) };
}

/** "Awaiting action" is expanded and in view: what is to do now is seen. */
export function noteWaitingShown(s: LiveSession): void {
    noteWaitingSeen(s.treeId, todoWaiting(s.waiting).map(w => w.id));
}

/** The "N new" chip in the heading of a collapsed "Awaiting action" (null: nothing new). */
export function waitingNewChip(s: LiveSession): HTMLElement | null {
    const info = waitingHeadInfo(s);
    if (info.fresh === 0) return null;
    const chip = el('span', `live-panel-chip live-panel-new live-section__new${info.freshImportant ? ' is-important' : ''}`, strings.live.newChanges(info.fresh));
    if (info.freshImportant) chip.title = strings.live.importantHint;
    return chip;
}

/**
 * The "Waiting N" chip that keeps a collapsed or hidden "Awaiting action"
 * in sight (amber; solid with a dot while a decision or a permission waits).
 */
export function waitingChip(s: LiveSession, onClick: () => void, cls = ''): HTMLButtonElement | null {
    const info = waitingHeadInfo(s);
    if (info.todo === 0 || s.ended) return null;
    const L = strings.live;
    const chip = el('button', `live-panel-chip live-panel-chip--warn live-panel-waitchip${cls ? ` ${cls}` : ''}${info.important ? ' is-important' : ''}`, L.waitingShort(info.todo));
    chip.type = 'button';
    chip.setAttribute('aria-label', L.waitingChipAria(info.todo));
    if (info.important) chip.title = L.importantHint;
    chip.onclick = (e) => {
        e.stopPropagation();
        onClick();
    };
    return chip;
}

/** The box that says every section is hidden, with the way to Customize panel. */
export function appendAllHidden(host: HTMLElement, onEdit: (anchor: HTMLElement) => void): void {
    const L = strings.live;
    const box = host.appendChild(el('div', 'live-panel-allhidden'));
    box.appendChild(el('span', 'live-panel-allhidden__text', L.allHidden));
    const link = box.appendChild(el('button', 'link-button live-panel-allhidden__edit', L.editPanel));
    link.type = 'button';
    link.onclick = () => onEdit(link);
}

/** "16 min", "1 h 5 min" since a moment. */
export function liveDuration(since: number, now = Date.now()): string {
    const min = Math.max(0, Math.floor((now - since) / 60000));
    return min < 60 ? strings.live.minutes(min) : strings.live.hoursMinutes(Math.floor(min / 60), min % 60);
}

/** How a section of the panel or the overview folds, and what its heading carries besides the title. */
export interface LiveFold {
    id: string;
    collapsed: boolean;
    onToggle: () => void;
    /** Chips after the title, inside the heading's button (part of its name): "N new", "hidden". */
    extra?: HTMLElement[];
    /** Shown expanded for a while whatever the choice: the heading does not fold. */
    locked?: boolean;
    /** A line between the heading and the body ("Hidden section, shown until the overview closes."). */
    note?: HTMLElement;
    /** The section's own menu (right click, a long press, Menu / Shift+F10): at the pointer, or under the heading (null). */
    menu?: (head: HTMLElement, at: { x: number; y: number } | null) => void;
}

/**
 * A section heading that folds its section: ▾/▸, the title, and a summary
 * on the right. Returns the section's body (empty and hidden when folded).
 */
export function liveSection(host: HTMLElement, o: {
    id: string; title: string; summary?: string; summaryCls?: string;
    /** In place of `summary`: an element of its own (a folded section's search, spec 083 §1). */
    summaryEl?: HTMLElement;
    collapsed: boolean; headCls?: string; onToggle: () => void;
    /** A control beside the heading (not inside its button). */
    aside?: HTMLElement;
    /** The help mark "?" of this place: the last item of the heading row, after `aside`. */
    help?: HelpTopic;
    extra?: HTMLElement[];
    locked?: boolean;
    note?: HTMLElement;
    menu?: LiveFold['menu'];
}): HTMLElement {
    const head = el('button', `live-panel-heading live-section__head${o.headCls ? ` ${o.headCls}` : ''}`);
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!o.collapsed));
    head.setAttribute('aria-controls', o.id);
    const chevron = el('span', 'live-section__chevron', o.collapsed ? '▸' : '▾');
    chevron.setAttribute('aria-hidden', 'true');
    head.append(chevron, el('span', 'live-section__title', o.title));
    // A pause between the title and each chip for a screen reader (the spans would run together).
    for (const x of o.extra ?? []) head.append(el('span', 'live-section__sep', ', '), x);
    if (o.summaryEl) head.appendChild(o.summaryEl);
    else if (o.summary) head.appendChild(el('span', `live-section__sum${o.summaryCls ? ` ${o.summaryCls}` : ''}`, o.summary));
    if (o.locked) {
        head.setAttribute('aria-disabled', 'true');
        head.classList.add('is-locked');
    } else {
        // The release of a long press that opened the section's menu does not fold it too.
        head.onclick = () => {
            if (!sectionClickSwallowed()) o.onToggle();
        };
    }
    if (o.menu) bindSectionMenu(head, o.menu);
    const body = el('div', 'live-section__body');
    body.id = o.id;
    body.hidden = o.collapsed;
    // Just moved in Customize panel: lit for a while.
    if (sectionMovedNow(o.id)) {
        head.classList.add('is-moved');
        body.classList.add('is-moved');
    }
    if (o.aside && o.help) {
        // The control and "?" go under the heading together when they do not fit beside it.
        const row = el('div', 'live-section__headrow live-section__headrow--m');
        const tail = el('span', 'live-section__tail');
        tail.append(o.aside, helpMark(o.help));
        row.append(head, tail);
        host.append(row);
    } else if (o.aside) {
        const row = el('div', 'live-section__headrow');
        row.append(head, o.aside);
        host.append(row);
    } else if (o.help) {
        const row = el('div', 'live-section__headrow live-section__headrow--help live-section__headrow--m');
        row.append(head, helpMark(o.help));
        host.append(row);
    } else {
        host.append(head);
    }
    if (o.note) host.append(o.note);
    host.append(body);
    return body;
}

/** The help of the Now heading: how the agent works, or why it pauses while some run is paused (1105 §10). */
export function nowHelpTopic(s: LiveSession): HelpTopic {
    return s.working.some(w => w.paused) ? 'nowPaused' : 'now';
}

/** A change's text with the people in it as links (a click shows them in the tree). */
/**
 * The rows of one research commit, newest line first: its text in the
 * research's language (a newer research; an empty text shows nothing), else
 * its `what` lines put into words here.
 */
/** The sentence that a session or run at work is not interrupted by an update ('' = nothing at work, or not said). */
export function updateBusyText(busy: LiveBusy | undefined): string {
    return busy && (busy.sessions > 0 || busy.runs > 0) ? strings.research.updateBusy(busy.sessions, busy.runs) : '';
}

/** Why a queued task waits at the end (off the lines), or why it goes with its line (`helps`); '' = neither said. */
export function queueNoteText(q: LiveQueueItem): string {
    const r = strings.research;
    if (q.offLine === 'never') return r.queueOffNever;
    if (q.offLine === 'last') return r.queueOffLast;
    return q.helps ? r.queueHelps[q.helps] : '';
}

/** A queued task's kind in words ("story", "history"); '' = the research did not say. */
export function queueKindText(q: Pick<LiveQueueItem, 'kind'>): string {
    return q.kind ? strings.live.queueKind[q.kind] ?? '' : '';
}

/** The small tag of a queued task's kind after its text (null: no kind said). */
export function queueKindTag(q: Pick<LiveQueueItem, 'kind'>): HTMLElement | null {
    const text = queueKindText(q);
    if (!text) return null;
    const tag = el('span', 'live-queue-kind', text);
    tag.dataset.kind = q.kind!;
    return tag;
}

/** A task set to come next with `queue.next` (its "next" tag). */
function queueNextTagged(q: LiveQueueItem, s: LiveSession): boolean {
    return q.state === 'next' && q.own === 'next' && queueNextOffered(s);
}

/** A queued task's row with `queue.next`: its "next" tag after the text, lit for a while when just moved. */
function markQueueNextRow(li: HTMLElement, text: HTMLElement, q: LiveQueueItem, s: LiveSession): void {
    if (queueNextTagged(q, s)) text.append(' ', el('span', 'research-queue__tag-next', strings.live.queueTagNext));
    if (queueRowFlash(q.id)) {
        li.classList.add('research-queue__row--flash');
        if (!li.hasAttribute('tabindex')) li.tabIndex = -1;
    }
}

/** A queued task has its ⋯: the research's actions, a place by hand, or "Do next" for it. */
function queueRowMenu(s: LiveSession, q: LiveQueueItem, canTask: boolean, canOrder: boolean): boolean {
    return canTask || canOrder || (queueNextOffered(s) && queueNextFor(s, q));
}

/**
 * The note under a queued task's text (a quiet second line): why it stands
 * where it stands (a research with branches; one line, the whole sentence
 * in its title), else what an older research says of it.
 */
function appendQueueNote(text: HTMLElement, q: LiveQueueItem, s: LiveSession): void {
    // `queue.next`: a task set to come next carries its tag instead of the sentence.
    if (queueNextTagged(q, s)) return;
    const why = queueWhyText(q, s);
    if (why) {
        const note = el('span', 'live-queue-note live-queue-why', why);
        note.title = why;
        text.appendChild(note);
        return;
    }
    const note = queueNoteText(q);
    if (note) text.appendChild(el('span', 'live-queue-note', note));
}

function entryItems(e: LiveLogEntry, data: StromData | null, nameOf: (ref: string) => string | null): LiveChangeItem[] {
    const base = { at: e.at, task: e.task, head: e.head, ...(e.research ? { research: e.research } : {}) };
    const ids = (refs: string[]): PersonId[] => (data && refs.length > 0 ? personsByRefs(data, refs) : []);
    // Hypotheses decided in the Strom app: their lines tagged (the research's text, or the line in these words).
    const inApp = new Set(e.what.map(line => researchHypothesisLogLine(line)?.id).filter((id): id is string => !!id));
    if (e.text) {
        return e.text.map((line, i) => ({
            ...base, text: textWithoutRefs(line), personIds: ids(textPersonRefs(line)), kind: e.kinds?.[i] ?? textKind(line, e.what),
            ...(e.sources?.[i]?.length ? { sourceRefs: e.sources[i] } : {}),
            ...(inApp.has(/^(H\d+)\b/.exec(line.trim())?.[1] ?? '') ? { inApp: true } : {}),
        })).reverse();
    }
    return [...e.what].reverse().map(line => {
        const hypo = researchHypothesisLogLine(line);
        return {
            ...base,
            text: hypo ? hypo.text : humanizeChange(line, nameOf, strings.research.changeWords),
            personIds: ids(extractChangedRefs([line])),
            kind: changeKind(line),
            ...(hypo ? { inApp: true } : {}),
        };
    });
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

/** A history line's sources as links: the followed tree's data (null: another tree is open, no links). */
export interface ChangeSourceLinks {
    data: StromData | null;
    open: (sourceId: string, link: HTMLButtonElement) => void;
}

/**
 * A change's text with the people in it as links (a click shows them in the
 * tree) and, with `sources`, the sources it names (a click opens the source).
 * Returns whether the line names a source the app's version does not have.
 */
export function appendChangeText(host: HTMLElement, c: LiveChangeItem, show: (id: PersonId) => void, sources?: ChangeSourceLinks): boolean {
    type Mark = { person?: PersonId; source?: string; name: string; at: number; length: number };
    const marks: Mark[] = [];
    for (const id of c.personIds) {
        const p = DataManager.getPerson(id);
        const name = p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
        const at = name ? c.text.indexOf(name) : -1;
        if (at >= 0) marks.push({ person: id, name, at, length: name.length });
    }
    let missing = false;
    if (sources?.data && c.sourceRefs?.length) {
        const byRef = sourceIdsByRef(sources.data);
        for (const ref of c.sourceRefs) {
            const id = byRef.get(ref);
            const src = id ? sources.data.sources?.[id] : undefined;
            if (!id || !src) {
                missing = true;
                continue;
            }
            const hit = findSourceTitle(c.text, src.title ?? '');
            if (hit) marks.push({ source: id, name: c.text.slice(hit.at, hit.at + hit.length), ...hit });
        }
    }
    // Left to right; one that overlaps an earlier mark stays text.
    marks.sort((a, b) => a.at - b.at || b.length - a.length);
    let pos = 0;
    for (const m of marks) {
        if (m.at < pos) continue;
        if (m.at > pos) host.appendChild(document.createTextNode(c.text.slice(pos, m.at)));
        const link = el('button', m.source ? 'live-person-link live-source-link' : 'live-person-link', m.name);
        link.type = 'button';
        if (m.source) {
            const id = m.source;
            link.dataset.source = id;
            link.title = strings.live.showSource;
            link.onclick = (e) => {
                e.stopPropagation();
                sources?.open(id, link);
            };
        } else {
            const id = m.person!;
            link.title = strings.research.showInTree;
            link.onclick = (e) => {
                e.stopPropagation();
                show(id);
            };
        }
        host.appendChild(link);
        pos = m.at + m.length;
    }
    if (pos < c.text.length) host.appendChild(document.createTextNode(c.text.slice(pos)));
    // A hypothesis decided in the app (spec 074 DEV §5): the same tag as in the Load dialog.
    if (c.inApp) host.append(' ', el('span', 'research-change-inapp', strings.research.hypoInApp));
    return missing;
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
 * One person's waiting items the card's ! (or the person menu) led to: shown
 * first in the panel and the overview and lit, until the panel closes or
 * "Waiting for you" opens for everyone. `why`: none of them can be answered
 * here — their row says why.
 */
let waitingFocus: { treeId: TreeId; ids: ReadonlySet<string>; why: boolean } | null = null;

/** The ids of the waiting items lit for one person (empty: none, or another tree's). */
function waitingFocusIds(): ReadonlySet<string> {
    return waitingFocus && waitingFocus.treeId === DataManager.getCurrentTreeId() ? waitingFocus.ids : new Set();
}

/** Light a waiting item's row when it is one of the person's the card led to. */
export function markWaitingFocus(li: HTMLElement, w: LiveWaiting): void {
    li.dataset.waitingId = w.id;
    if (waitingFocusIds().has(w.id)) li.classList.add('is-person-focus');
}

/** The line under a lit row that cannot be answered here (null: none). */
export function waitingWhyEl(w: LiveWaiting): HTMLElement | null {
    if (!waitingFocus?.why || !waitingFocusIds().has(w.id)) return null;
    const p = el('p', 'live-waiting-why', strings.live.waitingNoAnswerHere);
    p.setAttribute('role', 'note');
    return p;
}

/**
 * The panel's line once following began (spec 011): which tree is followed
 * now. Its countdown waits while the pointer or focus is in the panel (or the
 * overview); one node, so a polite live region announces it once.
 */
interface FollowNote {
    treeId: TreeId;
    text: string;
    /** Time left (ms) and since when it counts (null: held). */
    remaining: number;
    since: number | null;
    timer: ReturnType<typeof setTimeout> | null;
    /** Its text was put into the live region already (a redraw only moves it). */
    said: boolean;
}
let followNote: FollowNote | null = null;
let followNoteNode: HTMLElement | null = null;
/** What holds the line's countdown: hover / focus in the panel or the overview. */
const followNoteHolds = new Map<string, HTMLElement>();
/** The followed tree's name is lit in the head for a while after a switch. */
let litTree: TreeId | null = null;
let litTimer: ReturnType<typeof setTimeout> | null = null;
/** Researches whose open tree's idle panel saw nobody at work: an agent there later "has started work". */
const idleSeen = new Set<string>();

function followNoteHeld(): boolean {
    for (const [key, host] of followNoteHolds) if (!host.isConnected) followNoteHolds.delete(key);
    return followNoteHolds.size > 0;
}

function runFollowNote(): void {
    const n = followNote;
    if (!n || n.timer || followNoteHeld()) return;
    n.since = Date.now();
    n.timer = setTimeout(() => {
        if (followNote !== n) return;
        followNote = null;
        followNoteNode?.remove();
    }, n.remaining);
}

function holdFollowNote(key: string, host: HTMLElement, on: boolean): void {
    if (on) followNoteHolds.set(key, host);
    else followNoteHolds.delete(key);
    const n = followNote;
    if (!n) return;
    if (followNoteHeld()) {
        if (n.timer) {
            clearTimeout(n.timer);
            n.timer = null;
            n.remaining = Math.max(0, n.remaining - (Date.now() - (n.since ?? Date.now())));
            n.since = null;
        }
    } else runFollowNote();
}

/** The line about the switch waits while the pointer or focus is in `host` (the panel or the overview). */
export function holdFollowNoteIn(host: HTMLElement, key: string): void {
    host.addEventListener('mouseenter', () => holdFollowNote(`${key}:hover`, host, true));
    host.addEventListener('mouseleave', () => holdFollowNote(`${key}:hover`, host, false));
    host.addEventListener('focusin', () => holdFollowNote(`${key}:focus`, host, true));
    host.addEventListener('focusout', (e) => {
        if (!host.contains(e.relatedTarget as Node | null)) holdFollowNote(`${key}:focus`, host, false);
    });
}

function clearFollowNote(): void {
    if (followNote?.timer) clearTimeout(followNote.timer);
    followNote = null;
    followNoteNode?.remove();
    if (litTimer) clearTimeout(litTimer);
    litTimer = null;
    litTree = null;
    document.querySelectorAll('.live-panel-title.is-fresh').forEach(t => t.classList.remove('is-fresh'));
}

/** The line about the switch, under the head of the followed tree's panel or overview (nothing when there is none). */
export function appendFollowNote(host: HTMLElement, s: LiveSession): void {
    const n = followNote;
    if (!n || s.ended || n.treeId !== s.treeId) return;
    if (!followNoteNode) {
        followNoteNode = el('p', 'live-follow-note');
        followNoteNode.setAttribute('aria-live', 'polite');
    }
    const node = followNoteNode;
    host.appendChild(node);
    if (n.said) {
        node.textContent = n.text;
        return;
    }
    // The region first, then its text: read out once.
    n.said = true;
    node.textContent = '';
    setTimeout(() => {
        if (followNote === n) node.textContent = n.text;
    }, 50);
}

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
    // What was sent and waits for a reply asks nothing of the user now.
    for (const w of todoWaiting(waiting)) {
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

/** What the Table view's research cells read beyond the tree (spec 073 §16). */
export interface ResearchTableLive {
    /**
     * The agent's work and queue are known now: the tree on screen is followed
     * live, or (on a computer) its research's bridge answers the regular ask
     * (spec 057 §7.4: the cells look as while following).
     */
    live: boolean;
    /** What waits: live, else as last heard (≤ 7 days). */
    waiting: LiveSession['waiting'];
    working: LiveSession['working'];
    queue: LiveSession['queue'];
    /** People (REFN) the agent was just done with, since when. */
    done: ReadonlyMap<string, number>;
    /** The followed bridge (its lines' places); null when not followed. */
    base: string | null;
    /** Followed here (else, when live, the bridge answers without following). */
    followed: boolean;
}

const NO_DONE: ReadonlyMap<string, number> = new Map();
const NO_WAITING: LiveSession['waiting'] = [];
const NO_WORKING: LiveSession['working'] = [];
const NO_QUEUE: LiveSession['queue'] = [];
/** The kept waiting list last given out: the same list again while it does not change (the table builds its research anew only on a change). */
let storedWaiting: { key: string; items: LiveSession['waiting'] } | null = null;

/** The agent's work as the last status of an unfollowed research said it (the same list again for the same status). */
let unfollowedAgent: { status: LiveStatus; working: LiveSession['working'] } | null = null;

/**
 * The agent's work and queue of the open tree's research without following
 * (spec 057 §7.4): what its bridge said at the regular ask (its status, whose
 * `queue[]` is the queue's window), while it answers; null otherwise (a phone
 * never asks, a bridge down said nothing).
 */
function unfollowedAgentNow(researchId: string): Pick<LiveSession, 'working' | 'queue'> | null {
    if (!onComputer()) return null;
    const status = researchStatusNow(researchId);
    if (!status || status.treeId !== researchId) return null;
    if (unfollowedAgent?.status !== status) {
        const bridge = parseLiveBridge(storedResearchBridge(researchId)?.base);
        unfollowedAgent = { status, working: bridge ? withFamilyPersons(status.working, bridge) : status.working };
    }
    return { working: unfollowedAgent.working, queue: status.queue };
}

/**
 * The research's live state for the Table view: the followed session, else
 * what its bridge says without following (the agent's work and queue) beside
 * the waiting list kept from the last time.
 */
export function researchTableLive(): ResearchTableLive {
    const s = followedHere();
    if (s) return { live: true, waiting: s.waiting, working: s.working, queue: s.queue, done: agentDone, base: s.bridge.base || null, followed: true };
    const treeId = DataManager.getCurrentTreeId();
    const researchId = treeId && !DataManager.isViewMode() ? TreeManager.getTreeMetadata(treeId)?.research?.id : undefined;
    const items = (researchId ? storedResearchWaiting(researchId)?.items : undefined) ?? NO_WAITING;
    let waiting = NO_WAITING;
    if (items.length > 0) {
        const key = `${researchId}|${JSON.stringify(items)}`;
        if (storedWaiting?.key !== key) storedWaiting = { key, items };
        waiting = storedWaiting.items;
    }
    const agent = researchId ? unfollowedAgentNow(researchId) : null;
    if (agent) return { live: true, waiting, working: agent.working, queue: agent.queue, done: NO_DONE, base: null, followed: false };
    return { live: false, waiting, working: NO_WORKING, queue: NO_QUEUE, done: NO_DONE, base: null, followed: false };
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
    /** A newer Strom Research is out, as its bridge says now (a live session, or an answer within the last half minute). */
    update: { version: string } | null;
    /** Sessions and runs working in it now, as its bridge says with the update (absent: not said). */
    busy?: LiveBusy;
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
export async function fetchWithTimeout(url: string, ms: number, headers?: Record<string, string>): Promise<Response> {
    if (typeof fetch !== 'function') throw new Error('fetch unavailable');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
        return await fetch(withAppVersion(url), {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            // Only when asked for (a header outside the simple ones makes the browser ask the bridge first).
            ...(headers ? { headers } : {}),
            signal: ctl?.signal,
        });
    } catch (err) {
        if (timer) clearTimeout(timer);
        throw err;
    }
}

/** One heavy part of a light status (`GET <token>/status/<part>`, research 1.26.0). */
export async function readStatusPart(url: string): Promise<unknown> {
    const res = await fetchWithTimeout(url, BRIDGE_ANSWER_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** A tree this browser holds that is exactly a file of its research's bridge (its ETag kept). */
interface HeldResearchFile {
    treeId: TreeId;
    /** The tag to ask with (`If-None-Match`). */
    etag: string;
    /** The tree as stored. */
    data: StromData;
    /** The head that file was written from ('' when not known). */
    head: string;
    mode: 'archive' | null;
}

/** The research's tree as fetched, with what the answer's headers say of it. */
export interface FetchedTree extends TreeReplyHeads {
    text: string;
    /** The file's `ETag` (a bridge with `ged.etag`; null without one, or when not readable here). */
    etag: string | null;
    /** 304: the bridge would send the very file `etag` asked with (`text` is then empty). */
    notModified?: true;
    /** Which file came: its images by their hash (`ref`) or in it (`data`); its tag is of that variant. */
    variant: TreeImagesVariant;
    /** The images the file names by their hash, resolved: the parser takes them (convertToStrom `images`). */
    images?: ReadonlyMap<string, string>;
}

/** The excerpt images of the tree stored for a research (the open one as it is in memory). */
async function researchTreeImages(researchId: string): Promise<string[]> {
    const meta = TreeManager.findTreeByResearchId(researchId);
    if (!meta || TreeManager.isTreeUnreadable(meta.id)) return [];
    const data = await readTree(meta.id);
    const out: string[] = [];
    for (const src of Object.values(data?.sources ?? {})) {
        for (const exc of src.excerpts ?? []) if (exc.dataUrl) out.push(exc.dataUrl);
    }
    return out;
}

/** What resolving the images by hash takes from the app: the network, hashing, the stored tree. */
const imageDeps: ImageResolveDeps = {
    fetch: (url, init) => fetch(url, init),
    sha256Hex,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    address: url => withAppVersion(url),
    treeImages: researchTreeImages,
};

/**
 * The research's tree from `url` (its bridge's `tree.ged`). `stale`: the last
 * tree the bridge built, at once (a bridge with `ged.stale`); without it the
 * bridge answers once the tree of its head now is built. `etag`: the tag of
 * the file the tree holds (a bridge with `ged.etag`), sent as `If-None-Match`;
 * a 304 then comes back as `notModified` with no text. `byHash`: the bridge
 * has `ged.imagesByHash` — the file comes with its images by their hash and
 * only the images not held here are downloaded (`etag` must then be a tag of
 * that variant); `images: false` leaves them out (not resolved). Anything
 * that keeps an image from being had loads the file with its images in it.
 */
export async function fetchResearchTree(url: string, opts: { stale?: boolean; etag?: string | null; byHash?: boolean; images?: boolean } = {}): Promise<FetchedTree> {
    if (opts.byHash) {
        const got = await fetchRefTree(url, opts);
        if (got) return got;
        // The images could not all be had: this load takes the file with them in it.
        return fetchResearchTree(url, { stale: opts.stale });
    }
    const res = await fetchWithTimeout(opts.stale ? staleTreeUrl(url) : url, TREE_GED_TIMEOUT_MS,
        opts.etag ? { 'If-None-Match': opts.etag } : undefined);
    const get = (name: string): string | null => res.headers?.get(name) ?? null;
    if (opts.etag && res.status === 304) return { text: '', notModified: true, variant: 'data', etag: treeReplyEtag(get) ?? opts.etag, ...treeReplyHeads(get) };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = decodeGedcomFile(await res.arrayBuffer());
    noteFamilyPartners(url, researchFamilyPartners(text));
    // Its images are in it: those held for the last file would only be a second copy.
    forgetHeldImages();
    return { text, variant: 'data', etag: treeReplyEtag(get), ...treeReplyHeads(get) };
}

/**
 * The file with its images by their hash (`images=ref`) and those images;
 * null when they could not all be had (the caller then takes the file with
 * them in it). A bridge that cannot be reached throws, as for the whole file.
 */
async function fetchRefTree(url: string, opts: { stale?: boolean; etag?: string | null; images?: boolean }): Promise<FetchedTree | null> {
    const res = await fetchWithTimeout(refTreeUrl(opts.stale ? staleTreeUrl(url) : url), TREE_GED_TIMEOUT_MS,
        opts.etag ? { 'If-None-Match': opts.etag } : undefined);
    const get = (name: string): string | null => res.headers?.get(name) ?? null;
    if (opts.etag && res.status === 304) return { text: '', notModified: true, variant: 'ref', etag: treeReplyEtag(get) ?? opts.etag, ...treeReplyHeads(get) };
    if (!res.ok) {
        console.warn('The tree with its images by hash was refused, loading the whole file', res.status);
        return null;
    }
    const text = decodeGedcomFile(await res.arrayBuffer());
    const said = treeReplyImages(get);
    const base = { text, etag: treeReplyEtag(get), ...treeReplyHeads(get) };
    noteFamilyPartners(url, researchFamilyPartners(text));
    // The bridge sent the file with its images in it after all: it is complete as it is.
    if (said === 'data') {
        forgetHeldImages();
        return { ...base, variant: 'data' };
    }
    if (opts.images === false) return { ...base, variant: 'ref' };
    const refs = findImageRefs(text);
    try {
        const got = await resolveImageRefs({ researchId: readResearchHeader(text).treeId, refs, imagesUrl: imagesUrlOf(url) }, imageDeps);
        return { ...base, variant: 'ref', images: got.images };
    } catch (err) {
        console.warn('The images by hash could not all be had, loading the whole file', err);
        forgetHeldImages();
        return null;
    }
}

export async function fetchGedcomText(url: string): Promise<string> {
    return (await fetchResearchTree(url)).text;
}

/**
 * The research's tree for reading, its images as the file with them in it
 * would carry: by their hash when the bridge's `features` (its last status)
 * say it gives them so, else the whole file.
 */
export async function readResearchTreeFile(url: string, features: readonly string[] | null | undefined): Promise<{ text: string; images?: ReadonlyMap<string, string> }> {
    const got = await fetchResearchTree(url, { byHash: bridgeGivesImagesByHash(features) });
    return { text: got.text, ...(got.images ? { images: got.images } : {}) };
}

/** The partners of the research's families by the tree's address (its last read), for rows of `working[]` about a couple. */
const familyPartners = new Map<string, Map<string, string[]>>();

function noteFamilyPartners(url: string, partners: Map<string, string[]>): void {
    familyPartners.delete(url);
    // The trees of a few researches at most (an old one goes first).
    while (familyPartners.size >= 4) familyPartners.delete(familyPartners.keys().next().value!);
    familyPartners.set(url, partners);
    // The live session's rows about a couple get their person now that the families are known.
    if (live && live.bridge.ged === url) live.working = workingWithFamilyPersons(live.working, familyPartners.get(url)!);
}

/** Bridges whose tree is being read only for its families (a row about a couple came before the tree). */
const familiesReading = new Set<string>();

/** `working[]` of a bridge with the person of a couple's row filled in (see workingWithFamilyPersons). */
function withFamilyPersons(working: LiveWorker[], bridge: LiveBridgeUrls): LiveWorker[] {
    return workingWithFamilyPersons(working, familyPartners.get(bridge.ged) ?? null);
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

/**
 * The base a loaded research version leaves (its fingerprint and kept copy)
 * and whether the research has had the tree's titles (ResearchLink.titlesIn),
 * B18-1. `loaded`: the tree as loaded; `research`: the research's version as
 * it came, before keepTitles. A version with every title of the tree has had
 * them (`titlesIn`: the one before, else 'load'). One that lacks some kept
 * here has not: a research that keeps titles (`knowsTitles`) holds the tree
 * with its own names, so those titles are changes to send; one that does not
 * know titles (or not said yet) cannot take them — they stay here, in step.
 */
export function researchTitlesBase(loaded: StromData, research: StromData, knowsTitles: boolean, before: string | undefined): { base: StromData; titlesIn: string | undefined } {
    const theirs = withResearchTitles(loaded, research);
    if (theirs === loaded) return { base: loaded, titlesIn: before || 'load' };
    return { base: knowsTitles ? theirs : loaded, titlesIn: undefined };
}

/**
 * The GEDCOM the research gets back: the whole tree, as is, naming its
 * research and version. `titles`: how the names carry their titles, by what
 * the research said of itself (researchGedcomTitles).
 */
export function researchGedcom(data: StromData, treeName: string, link: ResearchHeaderInfo, titles: TitlesInGedcom, readings = false, sourceFields = false): string {
    return exportToGedcom(data, treeName, { research: link, titles, readings, sourceFields }).content;
}

/**
 * researchGedcom with the xrefs it gave the records (a send's `ids` answer by
 * them). `readings`: the sources' reading marks go along (researchSendsReadings).
 */
export function researchGedcomExport(data: StromData, treeName: string, link: ResearchHeaderInfo, titles: TitlesInGedcom, readings = false, sourceFields = false): { content: string; xrefs: ExportXrefs } {
    const r = exportToGedcom(data, treeName, { research: link, titles, readings, sourceFields });
    return { content: r.content, xrefs: r.xrefs };
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
/** `refused`: something answered at the address, but not to it (an old token, another tree's bridge on that port). */
export type ConnectReason = 'denied' | 'prompt' | 'down' | 'unknown' | 'safari' | 'refused';
const CONNECT_FAILED_ID = 'research-connect-failed';

/** denied / prompt as the browser says; granted and still unreachable = the research is down; no answer = unknown. */
async function localNetworkReason(): Promise<ConnectReason> {
    const st = await localNetworkStatus();
    if (!st) return 'unknown';
    return st.state === 'denied' ? 'denied' : st.state === 'prompt' ? 'prompt' : 'down';
}

export async function fetchStatus(url: string, ms = BRIDGE_ANSWER_MS): Promise<LiveStatus | null> {
    const res = await fetchWithTimeout(statusAskUrl(url), ms);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = sanitizeLiveStatus(await completeStatus(url, await res.json(), readStatusPart));
    // The bridge runs on this computer: what it announces holds here.
    if (status) noteResearchLinks(status.links, status.linkScheme);
    if (status?.treeId) {
        noteResearchWaiting(status.treeId, status.waiting, status);
        // Where this research's bridge is now (the port can change between runs).
        noteResearchBridge(status.treeId, url.replace(/\/status(\?.*)?$/, ''));
        noteResearchBridgeStatus(status.treeId, status.accepts, status.head, researchTreeOfStatus(status));
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

/**
 * "23. 9. 2026" / "23 Sep 2026": the local day of the header `_STROM_ASOF`
 * instant when it carries a time, else the header `1 DATE` (a GEDCOM day,
 * UTC), else today.
 */
export function researchDateLabel(gedDate: string | null, asOf?: string | null): string {
    const local = instantLocalDay(asOf);
    if (local) return formatFlexDate(local);
    let iso = '';
    try {
        iso = gedDate ? parseGedcomDate(gedDate) : '';
    } catch {
        iso = '';
    }
    return formatFlexDate(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayIso());
}

/** Panel times ("5 min ago") are refreshed this often. */
const TIME_TICK_MS = 30_000;

let timeTicker: ReturnType<typeof setInterval> | null = null;

/**
 * A time element of the panel: `ago` = "just now / N min ago / 14:36",
 * `since` = "since 14:36". Refreshed by the ticker from its data-ts.
 */
export function timeEl(value: string, kind: LiveTimeKind): HTMLElement | null {
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return null;
    const node = el('small', 'live-time');
    node.dataset.ts = String(ts);
    node.dataset.kind = kind;
    node.textContent = liveTimeText(ts, kind);
    return node;
}

/** How a time is said: ago, since, since and for how long, the last change, the bridge's last answer. */
type LiveTimeKind = 'ago' | 'since' | 'sincefor' | 'lastchange' | 'refreshed';

function liveTimeText(ts: number, kind: LiveTimeKind): string {
    const lang = getCurrentLanguage();
    if (kind === 'refreshed') return strings.live.refreshedAgo(formatLiveTime(ts, Date.now(), lang, strings.research.justNow));
    if (kind === 'lastchange') return strings.live.lastChange(formatLiveTime(ts, Date.now(), lang, strings.research.justNow));
    if (kind === 'sincefor') return strings.live.sinceFor(formatLiveClock(ts, Date.now(), lang), liveDuration(ts));
    return kind === 'since'
        ? strings.research.since(formatLiveClock(ts, Date.now(), lang))
        : formatLiveTime(ts, Date.now(), lang, strings.research.justNow);
}

/** The short label of a waiting item's kind (text, not an icon). */
export function waitingKindLabel(w: LiveWaiting): HTMLElement {
    const section = waitingSection(w);
    return el('span', `live-kind live-kind--${section}`, strings.live.waitingKinds[section]);
}

/** Text with its http(s) addresses as links (each piece set as text, never HTML). */
export function appendLinkedText(host: HTMLElement, text: string): void {
    for (const piece of textWithLinks(text)) {
        if (!piece.url) { host.append(piece.text); continue; }
        const a = el('a', 'live-text-link', piece.text);
        a.href = piece.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        host.appendChild(a);
    }
}

/** The research's state in a word: at work, waiting for the user, paused (its runs wait for their gate), idle. */
export function liveState(s: LiveSession): { label: string; cls: 'is-working' | 'is-waiting' | 'is-paused' | 'is-idle' | 'is-lost' } {
    const L = strings.live;
    if (s.lostSince !== null && !s.ended) return { label: L.stateLost, cls: 'is-lost' };
    if (s.working.some(w => !w.paused)) return { label: L.stateWorking, cls: 'is-working' };
    if (waitingTodoCount(s.waiting) > 0) return { label: L.stateWaiting, cls: 'is-waiting' };
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

/** "Preparing a newer version…" with a small spinner (the tree shown is an older one the bridge gave at once). */
function livePreparing(tag: 'p' | 'span', cls: string): HTMLElement {
    const note = el(tag, cls);
    note.setAttribute('role', 'status');
    const spin = note.appendChild(el('span', 'live-panel-spinner'));
    spin.setAttribute('aria-hidden', 'true');
    note.appendChild(el('span', 'live-panel-preparing-text', strings.research.newerPreparing));
    return note;
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
            const kind = k === 'since' || k === 'sincefor' || k === 'lastchange' || k === 'refreshed' ? k : 'ago';
            node.textContent = liveTimeText(Number(node.dataset.ts), kind);
        });
    }
}

/** Start the time ticker (the overview draws times too). */
export function ensureLiveTicker(): void {
    if (!timeTicker) timeTicker = setInterval(tickLiveTimes, TIME_TICK_MS);
}

/** "user" (or nothing) is who the section heading already names. */
export function waitsOnUser(on: string | undefined): boolean {
    return !on || /^\s*user\s*$/i.test(on);
}

/**
 * `--live-strip-h` on the root: how much room the phone's strip takes above
 * the bottom bar (its height and the 8px gap above it; 0 without a strip, or
 * when the panel is a card at the top). The tree's pills stand on top of it.
 */
/** A session's number in "At work": a 20px circle in the session's colour. */
export function workingNumberBadge(n: number): HTMLElement {
    const badge = el('span', `live-working-num follow-${sessionTone(n)}`, String(n));
    badge.title = strings.live.sessionN(n);
    return badge;
}

function publishLiveStrip(): void {
    const panel = document.getElementById('live-panel');
    const phone = window.matchMedia?.('(max-width: 640px)').matches === true;
    const h = panel && !panel.hidden && phone ? panel.getBoundingClientRect().height : 0;
    const value = h > 0 ? `${Math.ceil(h) + 8}px` : '0px';
    const root = document.documentElement.style;
    if (root.getPropertyValue('--live-strip-h') === value) return;
    root.setProperty('--live-strip-h', value);
    // The map lifts its bottom bars above the strip: it measures them again.
    window.dispatchEvent(new Event('strom:live-strip'));
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
    // The Table view's bar spans the width under the top bar (and may wrap): the card stands below it.
    for (const sel of ['#embedded-mode-banner.visible', '#collab-bar', '#collab-badge', 'body[data-view-mode="table"] #table-container > .tv-bar']) {
        const node = document.querySelector<HTMLElement>(sel);
        if (!node || getComputedStyle(node).display === 'none') continue;
        const r = node.getBoundingClientRect();
        if (overlaps(r) && r.top < window.innerHeight / 3) top = Math.max(top, r.bottom + 8);
    }
    let bottom = window.innerHeight - 12;
    for (const sel of ['.control-block', '.zoom-controls', '.fan-zoom-controls', '.bottom-bar', '#view-mode-banner.visible', 'body[data-view-mode="table"] #table-container > .tv-status']) {
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

/**
 * The Research overview in a window of its own (spec 079 K3): what it draws,
 * taken from the main window's snapshot (null: this is not that window).
 * Its session is the followed one or the viewed one; nothing here follows or
 * asks a bridge for it.
 */
let windowDrawn: { live: LiveSession | null; viewing: OverviewViewing | null } | null = null;

/** The overview window's research as the main window last said it (null: not that window). */
export function setOverviewWindowDrawn(d: { live: LiveSession | null; viewing: OverviewViewing | null } | null): void {
    windowDrawn = d;
}

/** The followed research (null: none), for the overview. */
export function liveSession(): LiveSession | null {
    return windowDrawn ? windowDrawn.live : live;
}

/**
 * The Research overview open without following (spec 057 §7): the open
 * tree's research, drawn from what its bridge says (its status, /log and
 * /queue as the regular ask brings them) or, while it does not answer (a
 * phone never asks), from the tree and what was last said. `session` is
 * shaped as the followed one for the overview's helpers but is never `live`:
 * the tree is neither replaced nor locked.
 */
export interface OverviewViewing {
    treeId: TreeId;
    researchId: string;
    /** Where it is drawn from now: the bridge answers, or only the tree (and what it said last). */
    kind: 'bridge' | 'tree';
    session: LiveSession;
    /** The bridge's last status taken in (null: none, drawn from the tree). */
    status: LiveStatus | null;
    /** "Follow live" was asked from the overview: it stays open with following. */
    follow?: boolean;
    /** When the bridge last answered (ms; 0: not since the overview opened). */
    refreshedAt: number;
    /** Someone worked at the last answer (null: not known yet). */
    working: boolean | null;
    /** An agent began while the overview was open (§7.3): said, never followed by itself. */
    agentStarted: boolean;
    /** The research's head whose history (/log) was read last ('' : none yet). */
    logHead: string;
    /** Bridge-less: when the waiting list kept on this device was said (ms; 0: none kept). */
    waitingAt: number;
}
let viewing: OverviewViewing | null = null;

/** The overview open without following (null: not open, or open while following). */
export function overviewViewing(): OverviewViewing | null {
    return windowDrawn ? windowDrawn.viewing : viewing;
}

/** What the overview and its sections act on: the followed research, else the one viewed through its bridge. */
export function researchSession(): LiveSession | null {
    const l = liveSession();
    if (l && !l.ended) return l;
    const v = overviewViewing();
    return v?.kind === 'bridge' ? v.session : null;
}

/** No bridge known (the overview drawn from the tree). */
const EMPTY_BRIDGE: LiveBridgeUrls = { base: '', status: '', ged: '', events: '', log: '' };

/** An empty session-shaped record of a research viewed without following (filled from its status). */
function viewingSessionOf(bridge: LiveBridgeUrls, researchId: string, treeId: TreeId, name: string): LiveSession {
    const data = DataManager.getData();
    return {
        bridge, researchId, treeId, name, head: '', headAt: '',
        working: [], waiting: [], features: null, accepts: null, queue: [], queueMore: 0, update: null, spend: null,
        lastIntake: null, researches: [], autoCollapsed: new Set(), seenWaiting: new Set(), waitingPendingOpen: new Set(),
        overviewShown: new Set(), waitingView: newWaitingView(), seenInSection: 0, startedAt: Date.now(),
        startPersons: Object.values(data.persons).filter(p => !p.isPlaceholder).length,
        startSources: Object.keys(data.sources ?? {}).length,
        overview: true, logged: false, changes: [], adds: [], recent: null, ended: false, collapsed: false, seenChanges: 0,
        es: null, timer: null, failures: 0, lostSince: null, chain: Promise.resolve(),
    };
}

/**
 * How the status of `s` is asked after a write through its bridge: `live`
 * (followed: its stream's way), `bridge` (the overview viewing it through
 * its bridge without following: the bridge asked at once), or null (neither,
 * e.g. ended, another research, or the bridge not answering).
 */
export function statusAfterWriteWay(s: LiveSession, followed: LiveSession | null, viewed: OverviewViewing | null): 'live' | 'bridge' | null {
    if (s.ended) return null;
    if (followed === s) return 'live';
    return viewed?.kind === 'bridge' && viewed.session === s && !!s.bridge.base ? 'bridge' : null;
}

/**
 * The research viewed through its bridge without following whose status a
 * write of `researchId` made elsewhere (not from the overview's lists) asks
 * at once; null: followed (its stream says it), another research, the
 * overview drawn from the tree or not open.
 */
export function viewedWriteSession(researchId: string, followed: LiveSession | null, viewed: OverviewViewing | null): LiveSession | null {
    if (followed && !followed.ended) return null;
    const s = viewed?.kind === 'bridge' ? viewed.session : null;
    if (!s || s.researchId.toLowerCase() !== researchId.toLowerCase()) return null;
    return statusAfterWriteWay(s, followed, viewed) === 'bridge' ? s : null;
}

/** The followed research's whole queue is read by pages now (`queue.page`, its bridge answering). */
export function queuePaged(s: LiveSession | null): boolean {
    if (!s || s.ended || s.lostSince !== null || !s.features?.includes(QUEUE_PAGE_FEATURE)) return false;
    // The overview's own window: its pages asked of the main window while its bridge answers, with the search
    // only (spec 052 §1 there); a research without `queue.search` keeps the window's queue as before.
    const remote = queueRemote();
    if (remote) return remote.up() && s.features.includes(QUEUE_SEARCH_FEATURE);
    return !!s.bridge.base;
}

/** A queued task by id: in the status's window, else in a page read past it. */
export function liveQueueItem(s: LiveSession | null, id: string): LiveQueueItem | null {
    if (!s) return null;
    return s.queue.find(q => q.id === id) ?? queueListItem(s.bridge.base, id);
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
            // A hand-over this tab was in before a reload comes first — before the old bridge or research.
            const adoptUrl = params.get('adopt') ?? (importUrl === null && liveUrl === null && sendUrl === null && !params.has('open') ? pendingAdopt() : null);
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
            // A section choice (panel, overview, Settings, another tab) redraws what follows the research.
            document.addEventListener(SECTION_PREFS_EVENT, () => this.onLiveSectionPrefs());
            watchSectionPrefsStorage();
            // The Fan view's toolbar moved (the card stands below it).
            window.addEventListener('strom:fan-toolbar-moved', () => this.placeLivePanel());
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
        // A file field, or a place that takes files itself (images for a waiting task): not the window's drop.
        const onFileInput = (e: Event): boolean =>
            !!(e.target as Element | null)?.closest?.('input[type="file"], .takes-images, .waiting-upload');
        const modalOpen = (): boolean => !!document.querySelector('.modal-overlay.active');
        // Files reading can take (spec 013): two zones, "Read now" left and "Add to materials" right.
        let readZones = false;
        let dropCancelled = false;
        const zoneAt = (e: DragEvent): 'read' | 'add' => (!this.batchAvailable() || e.clientX < window.innerWidth / 2 ? 'read' : 'add');
        const overlay = (show: boolean): void => {
            let node = document.getElementById('drop-overlay');
            if (!show) {
                node?.classList.remove('active', 'drop-overlay--read');
                return;
            }
            if (!node) {
                node = el('div', 'drop-overlay');
                node.id = 'drop-overlay';
                node.setAttribute('aria-hidden', 'true');
                node.appendChild(el('div', 'drop-overlay-box', strings.research.dropHint));
                document.body.appendChild(node);
            }
            node.querySelector('.drop-zones')?.remove();
            const box = node.firstElementChild as HTMLElement | null;
            if (box) box.hidden = readZones;
            node.classList.toggle('drop-overlay--read', readZones);
            if (readZones) {
                const t = strings.read;
                const zones = el('div', 'drop-zones');
                const zone = (kind: 'read' | 'add', title: string, sub: string, ai: boolean): HTMLElement => {
                    const z = el('div', `drop-zone drop-zone--${kind}`);
                    z.dataset.zone = kind;
                    const head = z.appendChild(el('div', 'drop-overlay-title'));
                    head.appendChild(el('span', undefined, title));
                    if (ai) head.appendChild(el('span', 'research-ai-badge', strings.research.aiBadge));
                    z.appendChild(el('div', 'drop-overlay-sub', sub));
                    return z;
                };
                zones.appendChild(zone('read', t.dropRead, t.dropReadSub, true));
                if (this.batchAvailable()) zones.appendChild(zone('add', t.dropAdd, t.dropAddSub, false));
                node.appendChild(zones);
            } else if (box && this.batchAvailable()) {
                // A tree linked to a research that takes batches: other files go there as material.
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
                if (depth === 0) {
                    dropCancelled = false;
                    readZones = !modalOpen() && this.readDropOffered(e.dataTransfer);
                }
                depth++;
                if (!modalOpen() && !dropCancelled) overlay(true);
            });
            window.addEventListener('dragover', (e) => {
                if (!hasFiles(e) || onFileInput(e)) return;
                // Without this the browser would navigate away to the file.
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = modalOpen() || dropCancelled ? 'none' : 'copy';
                if (readZones && !dropCancelled) {
                    const at = zoneAt(e);
                    document.querySelectorAll<HTMLElement>('#drop-overlay .drop-zone').forEach(z => z.classList.toggle('is-over', z.dataset.zone === at));
                }
            });
            // Esc while dragging: the overlay goes, the drop does nothing.
            window.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || !document.getElementById('drop-overlay')?.classList.contains('active')) return;
                dropCancelled = true;
                overlay(false);
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
                if (dropCancelled) { dropCancelled = false; return; }
                const files = Array.from(e.dataTransfer?.files ?? []);
                // "Read now": the dialog with the files in it (reading starts from there).
                if (readZones && zoneAt(e) === 'read') {
                    readZones = false;
                    this.showReadDocumentDialog({ files });
                    return;
                }
                readZones = false;
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
    async importResearchFromUrl(raw: string, opts: { afterSend?: TreeId; plainAsk?: boolean; takeSame?: boolean } = {}): Promise<void> {
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
            if (header.isStromResearch) noteResearchLinks(header.links, header.scheme);
            // Served by the research's bridge (…/tree.ged): where it runs, and how (its mode, what it
            // takes) — asked, so the tree knows its bridge from now on, not only after a ?live=.
            if (header.isStromResearch && header.treeId && /\/tree\.ged$/.test(url.pathname)) {
                const base = `${url.origin}${url.pathname.replace(/\/tree\.ged$/, '')}`;
                void fetchStatus(`${base}/status`).then(() => this.refreshResearchSyncUi()).catch(() => undefined);
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
        const reason: ConnectReason = bridgeFailure(err) === 'safari' ? 'safari'
            : err instanceof Error && /^HTTP (401|403|404)$/.test(err.message) ? 'refused' : await localNetworkReason();
        const c = strings.connect;
        const tree = TreeManager.getActiveTreeMetadata();
        const people = Object.values(DataManager.getData().persons).some(p => !p.isPlaceholder);
        // A hand-over (?adopt=) names its tree only at the bridge, never reached here: the open one is not it.
        const handOver = request?.param === 'adopt';
        const texts: Record<ConnectReason, [string, string]> = {
            denied: [c.reasonDenied(appBrowserName(currentAppBrowser())), c.textDenied], prompt: [c.reasonPrompt, c.textPrompt],
            down: [c.reasonDown, c.textDown], unknown: [c.reasonUnknown, c.textUnknown], safari: [c.reasonSafari, c.textSafari],
            refused: [c.reasonRefused, c.textRefused],
        };
        const [why, browserText] = texts[reason];
        // A ?live= link on a phone: the research runs on a computer, and a browser of the phone
        // (all of them WebKit on an iPhone) is never the way to it. A touch computer without
        // a phone's browser or size keeps the computer's texts.
        const onPhone = request?.param === 'live' && !onComputer()
            && (reason === 'safari' || isMobile() || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''));
        const text = onPhone ? c.textPhoneLive : browserText;
        // The heading too: no browser of the phone is the cause, the computer is the way.
        const heading = onPhone ? c.reasonPhoneLive : why;
        // The way to allow it: open where it is the cause, folded where it may be.
        const how = !onPhone && (reason === 'denied' || reason === 'unknown') ? `
            <details class="connect-how"${reason === 'denied' ? ' open' : ''}>
                <summary>${this.escapeHtml(c.howTitle)}</summary>
                <ol>${(currentAppBrowser() === 'brave' ? c.howBrave : currentAppBrowser() === 'firefox' ? c.howFirefox : c.how).map(t => `<li>${this.escapeHtml(t)}</li>`).join('')}</ol>
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
                        <div class="audit-log-subtitle connect-reason"><span class="connect-dot" aria-hidden="true"></span>${this.escapeHtml(heading)}</div>
                    </div>
                </div>
                <div class="modal-content">
                    <p class="connect-text">${this.escapeHtml(text)}</p>
                    ${how}
                    <p class="connect-nothing">${this.escapeHtml(tree && people && !handOver ? c.nothingChanged(tree.name) : c.nothingChangedEmpty)}</p>
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
            // Waiting for the user's answer to the browser, or blocked and changed in its settings:
            // once allowed, connect by itself — no reload (which used to lose ?adopt=).
            if (reason === 'prompt' || reason === 'denied') {
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
    async openGedcomText(text: string, opts: { afterSend?: TreeId; plainAsk?: boolean; takeSame?: boolean } = {}): Promise<void> {
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
        await this.applyResearch(result.data, header, { ...(opts.afterSend ? { afterSend: opts.afterSend } : {}), ...(opts.plainAsk ? { plainAsk: true } : {}),
            ...(opts.takeSame ? { takeSame: true } : {}) });
    },

    /**
     * The research's version (`data` as read, `research` as it came) is the
     * open tree `treeId` as it is and its base unchanged — its head moved on
     * by a write that left the tree alone (the family's material): its head
     * is taken, nothing loaded, no backup, said briefly. False when anything
     * would change (the usual load then asks).
     */
    researchTakeSameVersion(treeId: TreeId, previous: StromData, data: StromData, research: StromData, source: ResearchSource,
        head: string, includeImages: boolean, knowsTitles: boolean): boolean {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!head || !link || !source.treeId || DataManager.getCurrentTreeId() !== treeId || head === link.head) return false;
        const incoming = includeImages ? data : stripMedia(data);
        const kept = carryOverMedia(stabilizeIds(incoming, previous), previous).data;
        const stable = this.researchKeepsLoneFamilies(source.treeId) ? kept : carryOverUnknownPartners(kept, previous);
        if (contentFingerprint(stable) !== contentFingerprint(previous)) return false;
        const { base, titlesIn } = researchTitlesBase(stable, research, knowsTitles, link.titlesIn);
        if (fingerprintLike(base, link.fingerprint) !== link.fingerprint) return false;
        TreeManager.patchResearchLink(treeId, {
            head, syncedAt: new Date().toISOString(), titlesIn,
            ...(source.mode === 'archive' ? { mode: 'archive' as const } : {}),
        });
        this.refreshResearchSyncUi();
        this.showToast(strings.sync.stateInSync, 4000);
        return true;
    },

    /**
     * Put a research into the right tree: create it the first time, update it
     * afterwards (asking when the user changed it in the app), switch to it.
     * Returns the tree, or null when the user cancelled.
     * `force`: the caller showed what the load changes, or it changes only
     * what a decision of a conflict brings (conflict-decide-ui.ts): loaded
     * over the tree (a backup first), nothing asked.
     * `noDialog`: following that opening the tree started (spec 011): loaded
     * only over a tree that is the research's version or holds nothing it
     * lacks; anything that would ask leaves the tree as it is (null), and
     * the load says nothing.
     */
    async applyResearch(data: StromData, source: ResearchSource, opts: { head?: string; quiet?: boolean; afterSend?: TreeId; plainAsk?: boolean; noAsk?: boolean; live?: string; force?: boolean; noDialog?: boolean;
        /** "Load the new version" from the running research: the very same tree under a new head is only taken (no question). */
        takeSame?: boolean;
        /** Told back: whether the file's images were taken (the setting, or the choice in a question). */
        taken?: { images: boolean } }): Promise<TreeId | null> {
        const name = source.name || strings.research.defaultName;
        const dateLabel = researchDateLabel(source.date, source.asOf);
        const existing = source.treeId ? TreeManager.findTreeByResearchId(source.treeId) : null;

        let previous: StromData | null = null;
        let includeImages = SettingsManager.isImportImages();
        let action = decideResearchOpen(null, null);
        let asCopy = false;
        let holdsSent = false;
        // "Load the research version?" with the values it overwrites (asked at every load the user asks for).
        let askLoad = false;
        /** The research's version as it came, before the titles it never got were kept (B18-1). */
        const research = data;
        const features = source.treeId ? this.researchStatusOf(source.treeId)?.features : null;
        const knowsTitles = !!features?.includes(TITLES_FEATURE);
        if (opts.noDialog && (!existing || TreeManager.isTreeUnreadable(existing.id))) return null;
        if (existing) {
            const unreadable = TreeManager.isTreeUnreadable(existing.id);
            previous = unreadable ? null : await readTree(existing.id);
            if (previous) {
                // Titles a research that does not know them dropped stay (T07), and so do those a research that
                // knows them never got (B18-1): never asked about, never lost. The surname after marriage
                // likewise, from a research that does not keep a name's kind, and the surname-variant groups
                // from a version that carries none.
                data = keepTableViews(keepImports(keepLineageOverrides(keepSurnameVariants(keepMarriedSurname(keepTitles(data, previous, features, researchHasTitles(existing.research, features)), previous, features), previous), previous), previous, features), previous);
            }
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
            if (opts.afterSend === existing.id && takesOver && previous && !opts.force) {
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
            // Nothing asked: changes here the research lacks, or images it would drop, keep the tree as it is.
            if (opts.noDialog && action === 'ask' && !holdsChanges) return null;
            // The question is about that tree: show it behind the dialog, never
            // whichever tree was open (the user must see what they decide on).
            if (action === 'ask' && previous && !unreadable && !holdsChanges && !opts.force && DataManager.getCurrentTreeId() !== existing.id) {
                if (existing.isHidden) TreeManager.setTreeVisibility(existing.id, false);
                await this.switchToTree(existing.id, { follow: false });
                if (DataManager.getCurrentTreeId() !== existing.id) return null;
                window.dispatchEvent(new CustomEvent('strom:tree-switched'));
            }
            if (unreadable || !previous) {
                // Cannot be read with this session's key: never overwrite it.
                asCopy = true;
            } else if (opts.force) {
                // Asked already, or nothing to ask (a decision's load): over the tree.
            } else if (holdsChanges) {
                // Nothing here the research lacks (a backup is still kept below): what it overwrites shown first.
                holdsSent = true;
                askLoad = true;
            } else if (edited && existing.research && researchSendMode(existing.research) === 'off' && !plainAsk) {
                // Only loading from the research: these values go — said in the load dialog, never "send first".
                askLoad = true;
            } else if (edited && existing.research && !plainAsk && this.researchSyncCapable(existing.research.id)) {
                // (plainAsk: a copy that cannot send yet — "send first" would only come back here.)
                // A research that tells what it has: send first, or decide knowing it.
                // "The research has a newer version" only when it has (not a ?live= with the same head, N61-4).
                const incoming = opts.head || source.head || '';
                const newer = !incoming || incoming !== (existing.research.head ?? '');
                const choice = await this.showResearchUpdateConflict(existing.id, existing.name, data, includeImages, newer);
                if (choice === null) return null;
                if (choice === 'sendThenLoad') {
                    const live = opts.live;
                    if (live) {
                        // Starting to follow live: sent and its version loaded (no preview — the choice was
                        // made here), then following starts — on a tree that is the research's version now,
                        // nothing is asked again (R3 of the N1 round, of beta.56). A write left with conflicts
                        // or not loaded: the tree stays as it is, the research menu tells what is next.
                        void this.researchSendTree(existing.id, { thenLoad: true }).then(() => {
                            const link = TreeManager.getTreeMetadata(existing.id)?.research;
                            if (link && DataManager.getCurrentTreeId() === existing.id
                                && this.researchSyncFingerprints(existing.id, link).matchesBase) void this.startLiveFollow(live);
                        });
                        return null;
                    }
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
                            return p ? shownNameOrEmpty(p) : '';
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
            } else {
                askLoad = true;
            }
            // Asked when the user asked for the version (not after a hand-over, a send that loads after
            // itself, or following live): each value here it changes or removes, what it adds, the backup.
            // Following live asks too when it would replace changes made here the research lacks (only
            // loading): once, at the start — while it follows, the tree is read-only.
            if (askLoad && previous && !asCopy && !opts.quiet && !opts.afterSend && (!opts.noAsk || (edited && !holdsSent))) {
                // The research's version is this tree as it is (its head moved by a write that left the
                // tree alone — the family's material): nothing to load or to ask; its head is taken.
                if (opts.takeSame && !edited && !holdsSent && source.treeId && this.researchTakeSameVersion(existing.id, previous, data, research, source, opts.head || source.head || '', includeImages, knowsTitles)) {
                    return existing.id;
                }
                if (DataManager.getCurrentTreeId() !== existing.id) {
                    if (existing.isHidden) TreeManager.setTreeVisibility(existing.id, false);
                    await this.switchToTree(existing.id, { follow: false });
                    if (DataManager.getCurrentTreeId() !== existing.id) return null;
                }
                const st = researchAutoState(existing.id);
                const sent = existing.research?.sent;
                const nw = st.notWritten && sent?.state === 'written' && st.notWritten.fingerprint === sent.fingerprint
                    ? st.notWritten.items.length + st.notWritten.unexplained : 0;
                const bytes = incomingImageBytes(data);
                const answer = await this.askResearchLoad(existing.name, dateLabel, previous, stabilizeIds(data, previous), {
                    off: researchSendMode(existing.research) === 'off', notWritten: nw,
                    hypotheses: this.researchHypothesisRowsFor(previous, data),
                    ...(bytes > 0 ? { images: { label: strings.importImages.label, checked: includeImages, detail: strings.importImages.size((bytes / (1024 * 1024)).toFixed(1)) } } : {}),
                });
                if (!answer) return null;
                asCopy = answer.choice === 'copy';
                if (bytes > 0) includeImages = answer.images;
            }
        }
        // Images stay out when the user said so (the setting, or the checkbox).
        if (!includeImages) data = stripMedia(data);
        if (opts.taken) opts.taken.images = includeImages;

        const previousTreeId = DataManager.getCurrentTreeId();
        let treeId: TreeId;
        let created = false;
        /** The backup of the tree as it was before the research's version replaced it, and the tie it built on. */
        let backupId: string | null = null;
        let tieBefore: ResearchLinkBefore | undefined;
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
            const kept = carryOverMedia(stabilizeIds(data, previous!), previous!).data;
            // "Married, the spouse unknown": a research that drops such a family never takes it from here (N1).
            const stable = source.treeId && this.researchKeepsLoneFamilies(source.treeId) ? kept : carryOverUnknownPartners(kept, previous!);
            if (DataManager.getCurrentTreeId() !== treeId) {
                if (!await DataManager.switchTree(treeId)) return null;
                TreeRenderer.restoreFromSession();
            }
            // Always a backup first (whatever the setting): the load can be taken back — with the tie it built on.
            backupId = await DataManager.snapshotNow('pre-research-load');
            const was = TreeManager.getTreeMetadata(treeId)?.research;
            if (was) tieBefore = { head: was.head ?? '', fingerprint: was.fingerprint ?? '', syncedAt: was.syncedAt, ...(was.sent ? { sent: was.sent } : {}) };
            DataManager.loadStromData(stable);
        }

        if (source.treeId) {
            const head = opts.head || source.head;
            const loaded = DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : data;
            const { base, titlesIn } = researchTitlesBase(loaded, research, knowsTitles, existing?.research?.titlesIn);
            TreeManager.setResearchLink(treeId, {
                id: source.treeId,
                fingerprint: contentFingerprint(base),
                syncedAt: new Date().toISOString(),
                ...(head ? { head } : {}),
                ...(source.mode === 'archive' ? { mode: 'archive' as const } : {}),
                ...(titlesIn ? { titlesIn } : {}),
            }, { agentless: this.researchAgentlessFor(source.treeId, source.mode === 'archive' ? { mode: 'archive' } : undefined) });
            if (!titlesIn) TreeManager.patchResearchLink(treeId, { titlesIn: undefined });
            // The load itself counted as an edit (it went through the edit path before the tie moved on): nothing waits now.
            patchResearchAutoState(treeId, { edits: undefined, unsentSince: undefined });
            this.researchKeepCopy(treeId, base);
        }
        // "Restore the state before loading", offered while the tree is just what was loaded.
        if (backupId && DataManager.getCurrentTreeId() === treeId) {
            patchResearchAutoState(treeId, { loadBackup: { id: backupId, at: new Date().toISOString(), fingerprint: contentFingerprint(DataManager.getData()),
                ...(tieBefore ? { before: tieBefore } : {}) } });
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
        const families = countFamilies(stored);
        const restore = backupId
            ? { action: { label: strings.sync.restoreBeforeLoad, run: () => { void this.researchRestoreBeforeLoad(treeId); } } } : {};
        // Loaded over the tree: "Research version loaded · Restore the state before loading" (10 s).
        if (opts.noDialog) {
            // Said by the research panel's line (which tree is followed now), never a toast.
        } else if (loadedAfterSend) this.showToast(strings.sync.loadedToast, 10000, restore);
        else if (!opts.quiet) {
            if (created) this.showToast(strings.research.opened(name, persons, families, dateLabel), 6000);
            else if (backupId) this.showToast(strings.sync.loadedToast, 10000, restore);
            else this.showToast(strings.research.updated(name, persons, families, dateLabel), 6000);
        }
        this.refreshResearchSyncUi();
        // Shown links the new version no longer holds: said once (after the load's own notice).
        // Hypotheses asked from this page and now decided in it: said, the waits end (spec 074).
        if (!created) this.researchHypothesesLoaded(treeId);
        if (!created && previous) this.noteViewLinksAfterLoad(treeId, previous);
        // A tree new from the research: its places not on the map, offered once (spec 034 U5 point 7).
        if (created && source.treeId) this.armPlacesOffer(treeId);
        return treeId;
    },

    /**
     * An update over a tree with changes the research does not have (a
     * research that tells what it has). Its bridge runs: send them first (the
     * new version then holds them), open as a copy, or load without them. It
     * does not run: the copy is the advice; overwriting stays possible.
     * `newer`: the research's version is newer than the one the tree builds on.
     * Resolves 'sendThenLoad' | 'update' | 'copy', or null (cancelled).
     */
    async showResearchUpdateConflict(treeId: TreeId, treeName: string, data: StromData, includeImages: boolean, newer = true): Promise<'sendThenLoad' | 'update' | 'copy' | null> {
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
            // Confirmed in the research only while sends wait in its inbox; else written at once (an archive, writing straight).
            const review = !!link && this.researchReviewOn(link.id);
            const message = [u.unsentBody(treeName, review), names, mediaLine].filter(Boolean).join('\n\n');
            // "Only load from the research": sending first is no way out here.
            const sendOff = link?.sendMode === 'off';
            const pick = await this.showChoice(message, u.unsentTitle, [
                { id: 'copy', label: r.openCopy },
                ...(sendOff ? [] : [{ id: 'sendThenLoad', label: strings.sync.sendThenLoad }]),
            ], images, { subtitle: newer ? `${treeName} · ${u.newerSub}` : treeName, aside: { id: 'update', label: u.loadWithout, sub: u.loadWithoutSub } });
            return pick as 'sendThenLoad' | 'update' | 'copy' | null;
        }
        const message = [u.bridgeDownBody(treeName), names, u.bridgeDownAdvice, mediaLine].filter(Boolean).join('\n\n');
        const start = link && this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.id }, announcedResearchScheme()) : null;
        const pick = await this.showChoice(message, r.editedTitle, [{ id: 'copy', label: r.openCopy }], images, {
            aside: { id: 'update', label: u.overwrite },
            ...(start ? { link: { label: u.startResearch, run: () => this.launchResearchLink(start), research: researchLinkMark('open') !== 'none' } } : {}),
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
        if (DataManager.getCurrentTreeId() !== tree.id) await this.switchToTree(tree.id, { follow: false });
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
            res = await postSync(bridge.sync, researchGedcom(data, tree.name, { id: link.id, head: link.head, appTree: tree.id, transcripts: this.researchTranscriptsLink(link).transcripts }, researchGedcomTitles(status), researchSendsReadings(status), researchSendsSourceFields(status)), 120000);
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
        // A link the research takes without its terminal (no mark): no word of a terminal window.
        else if (researchUrlMark(url) === 'none') this.showToast(r.openingQuietHint, 8000, { title: r.opening });
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
        return tree ? researchSchemeUrl(action, { tree, ...params }, announcedResearchScheme()) : null;
    },

    /**
     * The link that starts the active research tree's research: the announced
     * one, else — on a computer, the links not switched off — the open link by
     * the last known scheme. The tree came from a research, so it is offered
     * even when no announcement holds now (a bridge that said "none" while
     * starting, updating or ending); the system says so when nothing takes it.
     */
    researchStartUrl(): string | null {
        const announced = this.activeResearchLink('open') ?? this.activeResearchLink('live');
        if (announced) return announced;
        const tree = this.activeResearchId();
        if (!tree || !onComputer() || !researchLinksEnabled()) return null;
        return researchSchemeUrl('open', { tree }, announcedResearchScheme());
    },

    /** The active tree's research is known to be on this computer: it announced its links, or its bridge answered here. */
    researchKnownHere(): boolean {
        if (this.researchAnyAnnounced()) return true;
        const tree = this.activeResearchId();
        return !!tree && !!storedResearchBridge(tree)?.base;
    },

    /** What waits for the user in the active tree's research (null: nothing known, or older than a week). */
    researchWaiting(): ResearchWaitingState | null {
        const treeId = DataManager.getCurrentTreeId();
        if (live && !live.ended && live.treeId === treeId) {
            // An archive (or a research waiting for its agent) has no tasks for the user, live or not.
            return { items: this.activeResearchAgentless() ? [] : live.waiting, at: Date.now(), live: true, update: live.update, ...(live.busy ? { busy: live.busy } : {}), lastIntake: live.lastIntake };
        }
        const researchId = this.activeResearchId();
        const stored = researchId ? storedResearchWaiting(researchId) : null;
        if (!stored) return null;
        // An archive has no tasks for the user (whatever its status or an old list says); its update and last send stay.
        // A research that stopped running here has none either until it runs again ("not running" shows instead).
        const none = this.activeResearchAgentless() || (!!researchId && this.researchBridgeKnownDown(researchId));
        // A newer version only as the bridge says it now: one remembered from an earlier answer may be
        // the very version installed since (the research updated, or not running, or not asked in this page yet).
        const fresh = !!researchId && this.researchBridgeFresh(researchId);
        const { busy, ...rest } = stored;
        // What works there now, likewise only as the bridge says it now.
        return { ...rest, items: none ? [] : stored.items, update: fresh ? stored.update : null, ...(fresh && busy ? { busy } : {}), live: false };
    },

    /** Research menu "Waiting for you": the live panel open at that section, or the last known state. */
    showResearchWaiting(): void {
        waitingFocus = null;
        this.openResearchWaiting();
    },

    /**
     * One person's waiting items (the card's !, the person menu): the panel
     * open with them first and lit, in view; the overview when the panel
     * cannot show them (a phone, the section folded or hidden, the overview
     * open). `why`: none can be answered here, their rows say why.
     */
    showPersonWaiting(items: readonly LiveWaiting[], why = false): void {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || items.length === 0) {
            this.showResearchWaiting();
            return;
        }
        waitingFocus = { treeId, ids: new Set(items.map(w => w.id)), why };
        const s = live && !live.ended && live.treeId === treeId ? live : null;
        const phone = window.matchMedia?.('(max-width: 640px)').matches === true;
        if (s && (phone || s.overview || panelSectionHidden('waiting') || panelSectionCollapsed(s, 'waiting'))) {
            this.openWaitingItems(s, items);
            this.openResearchOverview({ showWaiting: true });
            const row = document.querySelector<HTMLElement>('#research-overview .research-overview__waiting-item.is-person-focus');
            row?.scrollIntoView({ block: 'nearest' });
            return;
        }
        this.openResearchWaiting();
    },

    /** The panel open at "Waiting for you": at the lit person's first row, else at the heading. */
    openResearchWaiting(): void {
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
            }
            idlePanel = researchId;
            this.renderLivePanel();
        }
        const panel = document.getElementById('live-panel');
        const body = panel?.querySelector<HTMLElement>('.live-panel-body');
        const heading = panel?.querySelector<HTMLElement>('.live-panel-heading-waiting');
        const lit = panel?.querySelector<HTMLElement>('.live-waiting-row.is-person-focus');
        const at = lit ?? heading;
        if (body && at) body.scrollTop = Math.max(0, at.offsetTop - body.offsetTop - 4);
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
        waitingFocus = null;
        this.renderLivePanel();
    },

    isResearchIdlePanelOpen(): boolean {
        return idlePanel !== null && !!document.getElementById('live-panel');
    },

    /** The research panel of the open tree without following (never over a research followed now). */
    openResearchIdlePanel(researchId: string): void {
        if (live && !live.ended) return;
        if (this.activeResearchId() !== researchId) return;
        if (live) {
            // The ended session's panel makes way for the current state.
            live = null;
        }
        idlePanel = researchId;
        this.renderLivePanel();
    },

    /**
     * Following that opening a tree started could not begin (its bridge did
     * not answer in time, a change here the research lacks, another research
     * at the address): asked once more for the marks, the tree stays as it is
     * and its research panel says how things are — never a dialog.
     */
    async researchFollowFailed(researchId: string, treeId: TreeId): Promise<void> {
        await this.askResearchBridge(researchId, AUTO_ASK_MS);
        this.refreshResearchSyncUi();
        if (DataManager.getCurrentTreeId() !== treeId || (live && !live.ended)) return;
        this.openResearchIdlePanel(researchId);
    },

    /** "Follow live" in the idle panel: the open tree's research, through its bridge here (else its link). */
    followResearchHere(researchId: string): void {
        this.startFollowLive('panel', researchId);
    },

    /**
     * "Follow live", wherever it is asked (the Research menu, the idle panel,
     * the overview's strip; spec 057 §7.1): the research through its bridge
     * here when this browser knows it (the tree switches to the research's
     * version), else its link (the research starts its bridge and opens
     * ?live= here). One way for all of them.
     */
    startFollowLive(origin: 'menu' | 'panel' | 'overview', forResearch?: string): void {
        const researchId = forResearch ?? this.activeResearchId();
        if (!researchId) return;
        const base = storedResearchBridge(researchId)?.base;
        if (base && parseLiveBridge(base)) {
            // From the overview: it stays open, now the followed research's.
            if (origin === 'overview' && viewing) viewing.follow = true;
            void this.startLiveFollow(base, { follow: true, from: { followed: null, open: null } });
            return;
        }
        const url = this.activeResearchLink('live');
        if (url) this.launchResearchLink(url);
    },

    // ==================== THE OVERVIEW WITHOUT FOLLOWING (spec 057 §7) ====================

    /** Open the overview of the open tree's research without following (false: not a research tree). */
    openOverviewViewing(): boolean {
        const treeId = DataManager.getCurrentTreeId();
        const researchId = this.activeResearchId();
        if (!treeId || !researchId) return false;
        if (!viewing || viewing.treeId !== treeId || viewing.researchId !== researchId) {
            const name = TreeManager.getTreeMetadata(treeId)?.name || strings.research.defaultName;
            viewing = {
                treeId, researchId, kind: 'tree', session: viewingSessionOf(EMPTY_BRIDGE, researchId, treeId, name),
                status: null, refreshedAt: 0, working: null, agentStarted: false, logHead: '', waitingAt: 0,
            };
        }
        this.syncOverviewViewing(false);
        // What the bridge says now (unless it said so seconds ago): the overview follows its answer.
        if (onComputer()) this.refreshResearchStateSoon();
        return true;
    },

    /** Close the overview opened without following (its record goes; nothing else changes). */
    closeOverviewViewing(): void {
        if (!viewing) return;
        viewing = null;
        resetQueueLists();
        onQueueListsChange(null);
    },

    /**
     * The overview open without following takes in what the bridge says now
     * (each answer of the regular ask; a phone never asks): its status, the
     * history when the research moved on, and an agent who began meanwhile.
     * Another tree, or following begun: it goes. `draw`: redraw it.
     */
    syncOverviewViewing(draw = true): void {
        const v = viewing;
        if (!v) return;
        if (DataManager.getCurrentTreeId() !== v.treeId || this.activeResearchId() !== v.researchId || (live && !live.ended)) {
            this.closeOverviewViewing();
            // The panel it hid shows again (and the overview goes with the redraw).
            if (draw) this.renderLivePanel();
            return;
        }
        const status = onComputer() ? this.researchStatusOf(v.researchId) : null;
        const bridge = status ? parseLiveBridge(storedResearchBridge(v.researchId)?.base) : null;
        if (status && bridge && status.treeId === v.researchId) {
            if (status !== v.status) this.takeViewingStatus(v, status, bridge);
        } else {
            this.viewingFromTree(v);
        }
        if (draw) this.renderResearchOverview();
    },

    /** A status of the viewed research: the overview's record follows it (no tree loaded, nothing locked). */
    takeViewingStatus(v: OverviewViewing, status: LiveStatus, bridge: LiveBridgeUrls): void {
        const first = v.kind !== 'bridge' || v.session.bridge.base !== bridge.base;
        if (first) {
            v.session = viewingSessionOf(bridge, v.researchId, v.treeId, v.session.name);
            v.logHead = '';
            // Pages of the queue read through the bridge redraw the overview when they come.
            resetQueueLists();
            onQueueListsChange(() => this.queueListsChanged());
        }
        const s = v.session;
        v.kind = 'bridge';
        v.status = status;
        v.refreshedAt = Date.now();
        if (status.name) s.name = status.name;
        s.head = status.head;
        if (status.headAt) s.headAt = status.headAt;
        s.working = withFamilyPersons(status.working, s.bridge);
        s.features = status.features;
        s.accepts = status.accepts;
        s.waiting = this.withoutBranchAnswers(this.liveWaitingShown(s, status.waiting));
        // A task new since the overview opened unfolds as it does while following (the first answer is no news).
        const fresh = status.waiting.filter(w => !s.seenWaiting.has(w.id));
        for (const w of fresh) s.seenWaiting.add(w.id);
        if (!first) {
            const freshTodo = todoWaiting(fresh);
            for (const w of freshTodo) s.waitingView.fresh.add(w.id);
            const pref = sectionPrefs().waiting;
            if (freshTodo.length > 0 && (pref === undefined || pref === 'expanded')) this.openWaitingItems(s, freshTodo);
            else for (const w of freshTodo) s.waitingPendingOpen.add(w.id);
        }
        s.queue = status.queue;
        s.queueMore = status.queueMore;
        s.queueCounts = status.queueCounts;
        if (status.queueCounts) noteQueueRev(s.bridge.base, status.queueCounts.rev);
        s.researches = status.researches;
        s.caps = status.caps;
        s.offLine = status.offLine;
        s.update = status.update;
        s.busy = status.busy;
        s.work = status.work;
        s.browser = status.browser;
        s.spend = status.spend;
        s.lastIntake = status.lastIntake;
        s.recent = status.recent;
        s.directionsRev = status.directionsRev;
        // An agent began while it was open: said in its strip, never followed by itself (§7.3).
        const working = status.working.some(w => !w.paused);
        if (v.working === false && working) v.agentStarted = true;
        if (!working) v.agentStarted = false;
        v.working = working;
        // The research moved on: its history read again (the changes, the last 24 hours).
        if (status.head !== v.logHead) {
            v.logHead = status.head;
            void this.fetchLiveLog(s);
        }
    },

    /** The bridge does not answer (or a phone): the tree and the waiting list said last on this device (≤ 7 days). */
    viewingFromTree(v: OverviewViewing): void {
        if (v.kind === 'bridge') {
            v.session = viewingSessionOf(EMPTY_BRIDGE, v.researchId, v.treeId, v.session.name);
            resetQueueLists();
            onQueueListsChange(null);
        }
        v.kind = 'tree';
        v.status = null;
        v.working = null;
        v.agentStarted = false;
        v.logHead = '';
        const stored = this.activeResearchAgentless() ? null : storedResearchWaiting(v.researchId);
        v.session.waiting = stored?.items ?? [];
        v.waitingAt = stored?.at ?? 0;
    },

    /** Opening the tree found its bridge answering with nobody at work: an agent there later "has started work". */
    researchNoteIdle(researchId: string): void {
        idleSeen.add(researchId);
    },

    /** The tree's name as the panel's head shows it. */
    liveTreeName(treeId: TreeId, fallback: string): string {
        return TreeManager.getTreeMetadata(treeId)?.name || fallback;
    },

    /**
     * Following began: the panel says which tree is followed now and which stays (or is editable again), and
     * lights its name; following the open tree with nothing else changing says nothing and lights nothing.
     */
    noteLiveFollowStarted(s: LiveSession, from: { followed: TreeId | null; open: TreeId | null }): void {
        clearFollowNote();
        const ref = (id: TreeId | null): FollowTreeRef | null => {
            const meta = id ? TreeManager.getTreeMetadata(id) : null;
            return meta ? { id: meta.id, name: meta.name } : null;
        };
        // The tree open before is named only when it is a research tree (it stays editable beside this one).
        const open = from.open && TreeManager.getTreeMetadata(from.open)?.research ? ref(from.open) : null;
        const notice = followNotice({ tree: { id: s.treeId, name: this.liveTreeName(s.treeId, s.name) }, prevFollowed: ref(from.followed), prevOpen: open });
        if (!notice) return;
        const o = strings.otherResearch;
        followNote = {
            treeId: s.treeId,
            text: notice.kind === 'moved' ? o.followMoved(notice.tree, notice.prev ?? '') : o.followStarted(notice.tree, notice.prev),
            remaining: FOLLOW_NOTICE_MS, since: null, timer: null, said: false,
        };
        runFollowNote();
        litTree = s.treeId;
        litTimer = setTimeout(() => {
            litTimer = null;
            litTree = null;
            document.querySelectorAll('.live-panel-title.is-fresh').forEach(t => t.classList.remove('is-fresh'));
        }, FOLLOW_HIGHLIGHT_MS);
    },

    /** "Answer (research)" at a waiting task: that task in the research, else the research itself. */
    answerResearchTask(w: LiveWaiting): void {
        // A story's new version: the research shows both and asks (take it is the default).
        if (w.kind === 'story' && w.person) {
            const url = this.activeResearchLink('story', { person: w.person, ...(w.partner ? { partner: w.partner } : {}) })
                ?? this.activeResearchLink('open');
            if (url) this.launchResearchLink(url);
            return;
        }
        // An archive's question: the research asks it there (an older research only opens).
        if (w.kind === 'permission' && w.host) {
            const url = this.activeResearchLink('archive', { host: w.host }) ?? this.activeResearchLink('open');
            if (url) this.launchResearchLink(url);
            return;
        }
        const task = researchTaskRef(w.id);
        const url = (task ? this.activeResearchLink('task', { task }) : null) ?? this.activeResearchLink('open');
        if (url) this.launchResearchLink(url);
    },

    /** "Answer (research)" can be offered at this waiting item (a link the research takes leads there). */
    canAnswerResearchWaiting(w: LiveWaiting): boolean {
        if (this.researchLinkAvailable('open')) return true;
        return w.kind === 'permission' ? this.researchLinkAvailable('archive') : this.researchLinkAvailable('task');
    },

    /** Tree menu "Send changes to the research": one click when the research handles it, else the way there. */
    async sendTreeToResearch(treeId: TreeId): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const url = link && this.researchLinkAvailable('send') ? researchSchemeUrl('send', { tree: link.id }, announcedResearchScheme()) : null;
        if (url) this.launchResearchLink(url, 'terminal');
        else await this.showSendToResearchHelp(treeId);
    },

    /**
     * The link opening an excerpt of a source at full quality in the
     * research, or null: only crops the research marked (`_STROM_CLIP`) have
     * an original there. `excerpt` is its index among the file's excerpts or
     * the excerpt itself (one loaded from the research).
     */
    excerptResearchUrl(sourceId: string, excerpt: number | SourceExcerpt): string | null {
        if (!this.researchLinkAvailable('excerpt')) return null;
        const treeId = DataManager.getCurrentTreeId();
        const link = treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
        const source = DataManager.getData().sources?.[sourceId];
        const clip = typeof excerpt === 'number' ? source?.excerpts?.[excerpt]?.clip : excerpt.clip;
        if (!link || !source?.refn || !clip) return null;
        return researchSchemeUrl('excerpt', { tree: link.id, source: source.refn, clip }, announcedResearchScheme());
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
        const blob = new Blob([researchGedcom(data, meta.name, research, researchGedcomTitles(this.researchStatusOf(meta.research.id)), researchSendsReadings(this.researchStatusOf(meta.research.id)), researchSendsSourceFields(this.researchStatusOf(meta.research.id)))], { type: 'text/plain;charset=utf-8' });
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
     * The tree of that research this browser holds, when it is exactly a file
     * its bridge sent with an ETag (`ged.etag`): readable, the tie's base the
     * load gave, the tree unchanged since, its images taken as the setting
     * says now, the tag of the file's `variant` about to be asked (the one
     * with its images by hash and the one with them in it have their own
     * tags). Null otherwise (the file is then asked without a tag).
     */
    async researchHeldFile(researchId: string, variant: TreeImagesVariant = 'data'): Promise<HeldResearchFile | null> {
        const meta = TreeManager.findTreeByResearchId(researchId);
        const link = meta?.research;
        if (!meta || !link?.treeEtag || TreeManager.isTreeUnreadable(meta.id)) return null;
        const data = await readTree(meta.id);
        if (!data) return null;
        const etag = storedTreeEtag(link, fingerprintLike(data, link.fingerprint), SettingsManager.isImportImages(), variant);
        if (!etag) return null;
        return { treeId: meta.id, etag, data, head: link.head ?? '', mode: link.mode ?? null };
    },

    /** Keep the tag of the file just loaded into `treeId` with its tie (only that research's, not a copy's), with the file's variant. */
    researchKeepTreeEtag(treeId: TreeId, researchId: string, tag: string, images: boolean, variant: TreeImagesVariant = 'data'): void {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || link.copy || link.id !== researchId.toLowerCase() || !link.fingerprint) return;
        TreeManager.patchResearchLink(treeId, { treeEtag: { tag, head: link.head ?? '', fingerprint: link.fingerprint, images, ...(variant === 'ref' ? { variant } : {}) } });
    },

    /**
     * The bridge would send the very file the tree holds (a 304 to its tag):
     * what loading that file over the unchanged tree does, without the load —
     * the tree opened, its tie set as a load sets it (on the file's `head`),
     * nothing replaced (so no backup). Returns the tree, or null when it could
     * not be opened.
     */
    async researchKeepHeldFile(held: HeldResearchFile, researchId: string, opts: { head: string; quiet?: boolean; noDialog?: boolean }): Promise<TreeId | null> {
        const treeId = held.treeId;
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!meta || !link) return null;
        const previousTreeId = DataManager.getCurrentTreeId();
        if (meta.isHidden) TreeManager.setTreeVisibility(treeId, false);
        if (previousTreeId !== treeId) {
            if (!await DataManager.switchTree(treeId)) return null;
            TreeRenderer.restoreFromSession();
        }
        const head = opts.head || link.head || '';
        const archive = link.mode === 'archive';
        TreeManager.setResearchLink(treeId, {
            id: researchId,
            fingerprint: link.fingerprint,
            syncedAt: new Date().toISOString(),
            ...(head ? { head } : {}),
            ...(archive ? { mode: 'archive' as const } : {}),
            ...(link.treeEtag ? { treeEtag: { ...link.treeEtag, head } } : {}),
        }, { agentless: this.researchAgentlessFor(researchId, archive ? { mode: 'archive' } : undefined) });
        patchResearchAutoState(treeId, { edits: undefined, unsentSince: undefined });
        this.researchKeepCopy(treeId, held.data);
        const switched = previousTreeId !== treeId;
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        await TreeRenderer.renderAsync();
        if (switched) {
            ZoomPan.centerOnFocusWithContext();
            window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        }
        this.refreshSearch();
        this.updateUrlTreeParam(treeId);
        // Nothing loaded: the tree is the research's version as it is.
        if (!opts.quiet && !opts.noDialog) this.showToast(strings.sync.stateInSync, 4000);
        this.refreshResearchSyncUi();
        return treeId;
    },

    /**
     * A ?live= from a research whose version is the one this tree builds on,
     * the tree changed since: nothing to receive — its bridge is known again
     * (the status just asked noted it) and what waits goes as usual. True when
     * handled so. Following is not started (it would replace those changes):
     * "Follow live" on the toast starts it the usual way, asking first.
     */
    async researchReconnectOnly(status: LiveStatus, raw: string): Promise<boolean> {
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
        // The tree is the send the research wrote whole (no conflict kept, nothing left unwritten): nothing here
        // it lacks, its version loads (R3 of the N1 round). With a conflict its version holds the research's value.
        const nw = researchAutoState(existing.id).notWritten;
        if (researchSendVouches(link.sent) && contentFingerprint(previous) === link.sent!.fingerprint && !held
            && !(nw && nw.fingerprint === link.sent!.fingerprint)) return false;
        if (DataManager.getCurrentTreeId() !== existing.id) {
            await this.switchToTree(existing.id, { follow: false });
            if (DataManager.getCurrentTreeId() !== existing.id) return false;
        }
        rememberBridgeStatus(status.treeId!, status);
        this.showToast(strings.research.reconnected, 10000, {
            closable: true,
            action: { label: strings.research.followLive, run: () => { void this.startLiveFollow(raw, { follow: true }); } },
        });
        this.refreshResearchSyncUi();
        void this.pollResearchBridge();
        return true;
    },

    /**
     * ?live=: follow a running research through its bridge on this computer.
     * `auto`: opening its tree started it (an agent works there, spec 011):
     * nothing is asked and nothing said when it cannot be followed — the tree
     * stays as it is, editable, its research panel says how things are.
     * `from`: the tree followed and the tree open before (the panel's line
     * says which tree is followed now); by default as they are now.
     */
    async startLiveFollow(raw: string, opts: { resume?: boolean; follow?: boolean; auto?: { researchId: string; treeId: TreeId }; from?: { followed: TreeId | null; open: TreeId | null } } = {}): Promise<void> {
        const bridge = parseLiveBridge(raw);
        if (!bridge) {
            if (opts.resume) forgetLiveBridge();
            else if (!opts.auto) this.showToast(strings.research.notLocal, 6000);
            return;
        }
        if (DataManager.isViewMode()) {
            if (opts.resume) forgetLiveBridge();
            else if (!opts.auto) this.showToast(strings.research.notInViewMode, 5000);
            return;
        }
        const auto = opts.auto;
        // Following could not start: passive, the research panel of that tree says how things are (no dialog).
        const passive = (): void => {
            if (auto) void this.researchFollowFailed(auto.researchId, auto.treeId);
        };
        await enqueueOpen(async () => {
            // Opened by a switch: only while that tree is still the one open, and never a password asked.
            if (auto && (DataManager.getCurrentTreeId() !== auto.treeId || TreeManager.isTreeUnreadable(auto.treeId))) return;
            if (!auto && !await this.ensureLocalUnlocked()) {
                if (opts.resume) forgetLiveBridge();
                return;
            }
            // Which tree was followed and which was open: the panel's line names them once following began.
            const from = opts.resume ? null : opts.from ?? {
                followed: live && !live.ended ? live.treeId : null,
                open: DataManager.getCurrentTreeId(),
            };
            this.stopLiveFollow(true);

            let status: LiveStatus | null;
            let text: string;
            // A bridge with `ged.stale` gives its last built tree at once; the tree's state is then that file's head.
            let reply: TreeReplyHeads | null = null;
            // A bridge with `ged.etag`: the file's tag (kept once it is loaded), and the tree this browser holds
            // when the bridge answered 304 to its tag (the very file it would send: nothing downloaded or parsed).
            let etag: string | null = null;
            let held: HeldResearchFile | null = null;
            // A bridge with `ged.imagesByHash`: the file with its images by their hash, and those images.
            let images: ReadonlyMap<string, string> | undefined;
            let variant: TreeImagesVariant = 'data';
            try {
                status = opts.resume || auto
                    ? await fetchStatus(bridge.status, auto ? AUTO_CONNECT_MS : undefined)
                    : await this.connectResearchBridge(() => fetchStatus(bridge.status, CONNECT_TIMEOUT_MS));
                if (!status) throw new Error('bad status');
                if (auto && status.treeId !== auto.researchId) {
                    passive();
                    return;
                }
                if (!status.treeId) {
                    await this.showAlert(strings.research.liveNoTree, 'error');
                    return;
                }
                const stale = bridgeGivesStale(status.features);
                const tagged = bridgeGivesEtag(status.features);
                const byHash = bridgeGivesImagesByHash(status.features);
                const asked: TreeImagesVariant = byHash ? 'ref' : 'data';
                const ask = tagged ? await this.researchHeldFile(status.treeId, asked) : null;
                let got = await fetchResearchTree(bridge.ged, { stale, etag: ask?.etag, byHash });
                if (got.notModified) {
                    // Still exactly that tree (nothing changed it meanwhile): kept. Else the file itself.
                    const now = await this.researchHeldFile(status.treeId, asked);
                    if (now && now.etag === ask?.etag && now.treeId === ask.treeId) {
                        held = now;
                    } else {
                        got = await fetchResearchTree(bridge.ged, { stale, byHash });
                    }
                }
                text = got.text;
                images = got.images;
                variant = got.variant;
                if (stale) reply = got;
                if (tagged) etag = got.etag;
            } catch (err) {
                console.warn('Connecting to the research bridge failed', err);
                if (auto) {
                    passive();
                    return;
                }
                if (opts.resume) {
                    // The bridge stopped while the page reloaded (strom ends it
                    // after 2 h idle): nothing to import, just say so briefly.
                    forgetLiveBridge();
                    this.showToast(strings.research.ended, 4000);
                    return;
                }
                // The tree of that research, when this browser knows its address: the question is about it,
                // never about whichever tree the page started with (rc.27 round).
                const knownId = researchIdAtBridge(bridge.base);
                const knownTree = knownId ? TreeManager.findTreeByResearchId(knownId) : null;
                if (knownTree && DataManager.getCurrentTreeId() !== knownTree.id) await this.switchToTree(knownTree.id, { follow: false });
                if (await this.showResearchConnectFailed(err, { param: 'live', value: raw })) void this.startLiveFollow(raw);
                return;
            }
            // The tree held: what its file said is in its tie (the research, the head, the mode).
            const header = held
                ? { ...readResearchHeader(''), treeId: status.treeId, head: held.head || null, mode: held.mode }
                : readResearchHeader(text);
            if (header.treeId && header.treeId !== status.treeId) {
                if (auto) passive();
                else await this.showAlert(strings.research.liveOtherTree, 'error');
                return;
            }
            let data: StromData;
            try {
                data = held ? held.data : convertToStrom(parseGedcom(text), { images }).data;
            } catch {
                if (auto) passive();
                else await this.showAlert(strings.gedcom.parseError, 'error');
                return;
            }
            // Its couples by the research's families (a row of `working[]` about a couple), as the file would say.
            if (held) noteFamilyPartners(bridge.ged, treeFamilyPartners(held.data));
            const name = status.name || header.name || strings.research.defaultName;
            const file = reply ? treeFileState(reply, header.head, status.head) : { head: status.head, preparing: false, headNow: '' };
            // The research has nothing new beyond what this tree builds on, and the tree has changes it lacks
            // (opened again from it, e.g. its bridge on a new port): connected again, the changes go to it —
            // never asked whether to replace them (B3 of the rc.22 round). `follow`: "Follow live" asked for it.
            if (!opts.resume && !opts.follow && !auto && await this.researchReconnectOnly(status, raw)) return;
            // A research still waiting for its tree from here (opened before the hand-over): the hand-over,
            // not a second, empty tree (J7 of the language round).
            if (!opts.resume && !auto && Object.keys(data.persons ?? {}).length === 0 && !TreeManager.findTreeByResearchId(status.treeId)
                && await this.researchAwaitsHandOver(bridge.base)) {
                void this.adoptFromResearch(bridge.base);
                return;
            }
            const taken = { images: SettingsManager.isImportImages() };
            const treeId = held
                ? await this.researchKeepHeldFile(held, status.treeId, { head: file.head, quiet: opts.resume, noDialog: !!auto })
                : await this.applyResearch(
                    data,
                    { treeId: status.treeId, name, date: header.date, ...(header.asOf ? { asOf: header.asOf } : {}), mode: header.mode },
                    { head: file.head, quiet: opts.resume, noAsk: true, live: raw, ...(auto ? { noDialog: true } : {}), taken }
                );
            // The file's tag kept with the tree it was loaded into (only a file sent with one: one built without
            // all its images has none and is never kept as a finished state).
            if (treeId && etag && !held) this.researchKeepTreeEtag(treeId, status.treeId, etag, taken.images, variant);
            if (!treeId) {
                if (opts.resume) forgetLiveBridge();
                passive();
                return;
            }
            // An archive has no agent to follow: the tree opens for editing, its
            // bridge remembered (the changes go to it by themselves).
            if (statusAgentless(status)) {
                if (opts.resume) forgetLiveBridge();
                passive();
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
                head: file.head,
                ...(file.preparing ? { preparing: true } : {}),
                headAt: status.headAt,
                working: withFamilyPersons(status.working, bridge),
                waiting: status.waiting,
                features: status.features,
                accepts: status.accepts,
                queue: status.queue,
                queueMore: status.queueMore,
                ...(status.queueCounts ? { queueCounts: status.queueCounts } : {}),
                update: status.update,
                ...(status.busy ? { busy: status.busy } : {}),
                ...(status.work ? { work: status.work } : {}),
                spend: status.spend,
                lastIntake: status.lastIntake,
                researches: status.researches,
                ...(status.caps ? { caps: status.caps } : {}),
                ...(status.offLine ? { offLine: status.offLine } : {}),
                autoCollapsed: new Set(window.innerHeight < 700 ? ['queue'] : []),
                seenWaiting: new Set(status.waiting.map(w => w.id)),
                waitingPendingOpen: new Set(),
                overviewShown: new Set(),
                waitingView: newWaitingView(),
                seenInSection: 0,
                startedAt: Date.now(),
                startPersons: Object.values(data.persons).filter(p => !p.isPlaceholder).length,
                startSources: Object.keys(data.sources ?? {}).length,
                overview: false,
                logged: false,
                changes: [],
                adds: [],
                recent: status.recent,
                ended: false,
                collapsed: isMobile(),
                seenChanges: 0,
                es: null,
                timer: null,
                failures: 0,
                lostSince: null,
                chain: Promise.resolve(),
            };
            // The overview open without following stays open, now of the followed research, when "Follow
            // live" was asked from it; else it opens as it was left last time.
            const viewed = !!viewing?.follow && viewing.treeId === treeId;
            viewing = null;
            live.overview = viewed || this.researchOverviewRemembered();
            if (live.overview) live.collapsed = false;
            // Pages of the queue read through the bridge redraw the overview when they come.
            resetQueueLists();
            if (live.queueCounts) noteQueueRev(bridge.base, live.queueCounts.rev);
            onQueueListsChange(() => this.queueListsChanged());
            // Which tree is followed now, said in the panel (never a toast): started, or moved from another tree.
            if (from) this.noteLiveFollowStarted(live, from);
            DataManager.setLiveTree(treeId);
            TreeRenderer.render();
            this.renderLivePanel();
            this.refreshActionMenuBadges();
            this.connectLiveEvents(live);
            void this.fetchLiveLog(live);
            this.refreshDirectionPeople(live, live.head);
            // An older tree shown at once: the newer one is waited for now (the bridge answers once it is built),
            // never only on an event that may have gone before the stream opened.
            const s = live;
            if (file.preparing && file.headNow) this.enqueueLive(s, () => this.onLiveChange(s, { head: file.headNow, what: [], at: '' }));
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
            if (s.logged && !s.ended) void this.fetchLiveLog(s);
        });
        es.addEventListener('change', (e) => {
            this.liveBridgeBack(s);
            const change = sanitizeLiveChange(payload(e));
            if (change) this.enqueueLive(s, () => this.onLiveChange(s, change));
            // The stream stays open (hello comes once): a change may be a switch of mode
            // (`strom mode archive` commits), which only the status says.
            this.liveStatusSoon(s);
        });
        // A reading's new state (spec 013): at once, its full status soon after.
        es.addEventListener('read', (e) => {
            this.liveBridgeBack(s);
            this.noteReadEvent(s.researchId, payload(e));
            this.liveStatusSoon(s);
        });
        // The research's events of the time changed without a commit (spec 020): read them by their rev.
        es.addEventListener('history', (e) => {
            this.liveBridgeBack(s);
            this.noteHistoryEvent(s.researchId, payload(e));
        });
        // The research's "not an error" marks changed (spec 021 §D): read them by their rev.
        es.addEventListener('quality', (e) => {
            this.liveBridgeBack(s);
            this.noteQualityEvent(s.researchId, payload(e));
        });
        es.addEventListener('working', (e) => {
            s.workingEvents = (s.workingEvents ?? 0) + 1;
            s.working = withFamilyPersons(sanitizeWorking(payload(e), !!s.features?.includes(WORKING_HELPS_FEATURE)), s.bridge);
            this.renderLivePanel();
            // The event names only who works: the directions (their spinner, tasks and what waits) come with a status.
            this.liveStatusSoon(s);
        });
        // The bridge says it ends (`live.end`): gone for good → ended at once; another one coming → reconnect quietly.
        es.addEventListener('end', (e) => {
            if (s.es !== es) return;
            es.close();
            s.es = null;
            const end = sanitizeLiveEnd(payload(e));
            // Switched off (here or in the terminal) or after a time without work: kept for the switch's text (spec 064).
            this.noteResearchLiveEnd(s.researchId, end.reason, end.by);
            if (end.back === false) {
                this.endLiveFollow(s, 'ended');
            } else if (end.back === true) {
                s.backBy = Date.now() + BACK_QUIET_MS;
                this.scheduleLive(s, () => this.probeLive(s), BACK_FIRST_MS);
            } else {
                void this.probeLive(s);
            }
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
            const asked = s.workingEvents ?? 0;
            const status = await fetchStatus(s.bridge.status);
            if (!status) throw new Error('bad status');
            this.liveBridgeBack(s);
            this.onLiveStatus(s, status, asked);
            if (s.ended) return;
            if (typeof EventSource === 'function') this.scheduleLive(s, () => this.connectLiveEvents(s), reconnectMs());
            else this.scheduleLive(s, () => this.probeLive(s), POLL_MS);
        } catch {
            s.failures++;
            const now = Date.now();
            if (s.backBy && now < s.backBy) {
                // A new bridge is starting on this address: no loss yet.
                this.scheduleLive(s, () => this.probeLive(s), Math.min(reconnectMs() * s.failures, RETRY_MAX_MS));
                return;
            }
            s.backBy = null;
            if (s.lostSince === null) {
                s.lostSince = now;
                this.renderLivePanel();
            }
            if (now - s.lostSince >= lostGraceMs()) this.endLiveFollow(s, 'ended');
            else this.scheduleLive(s, () => this.probeLive(s), Math.min(reconnectMs() * s.failures, RETRY_MAX_MS));
        }
    },

    /**
     * Someone started or stopped working: the status, for the directions'
     * spinners and counts, asked once the events settle (`?poll=1`, at most
     * once in WORKING_STATUS_MIN_MS; events meanwhile wait for that one).
     */
    liveStatusSoon(s: LiveSession): void {
        if (s.statusSoon || s.ended || live !== s) return;
        const wait = Math.max(WORKING_STATUS_DELAY_MS, (s.statusAskedAt ?? 0) + WORKING_STATUS_MIN_MS - Date.now());
        s.statusSoon = setTimeout(() => {
            s.statusSoon = null;
            if (s.ended || live !== s) return;
            s.statusAskedAt = Date.now();
            const asked = s.workingEvents ?? 0;
            fetchStatus(`${s.bridge.status}?poll=1`).then((status) => {
                if (status && !s.ended && live === s) this.onLiveStatus(s, status, asked);
            }).catch(() => { /* the event stream says when the bridge is gone */ });
        }, wait);
    },

    /**
     * A write through the bridge changed the research `s` (a task's place,
     * an item of Awaiting action, a line): its status, so the overview shows
     * the research's own again. Followed: as
     * after its events (liveStatusSoon). Viewed without following (spec 057
     * §7): its bridge asked at once, not at the next regular ask, and the
     * overview takes the answer in (nothing is followed, the tree stays).
     */
    researchStatusAfterWrite(s: LiveSession): void {
        const way = statusAfterWriteWay(s, live, viewing);
        if (way === 'live') {
            this.liveStatusSoon(s);
            return;
        }
        if (way !== 'bridge' || !onComputer()) return;
        const v = viewing!;
        void this.askResearchBridge(v.researchId, BRIDGE_ANSWER_MS, s.bridge.base).then(() => {
            // Still the overview of that research: it takes in what the bridge said (with the rest of the app).
            if (viewing === v) this.refreshResearchSyncUi();
        });
    },

    /**
     * A write through the bridge of the research `researchId` made outside the
     * overview's own lists (a conflict decided, a fact verified, a place
     * answered): the overview viewing it through its bridge without following
     * asks it at once (researchStatusAfterWrite). Followed: nothing changes
     * here (its stream says it, as ever).
     */
    researchViewedStatusAfterWrite(researchId: string): void {
        const s = viewedWriteSession(researchId, live, viewing);
        if (s) this.researchStatusAfterWrite(s);
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

    /**
     * A status (hello or probe): lists for the panel; a new head means a missed change.
     * `workingAsked`: how many `working` events had come when it was asked (absent: it came
     * on the stream, in order with them); a `working` event after that is newer than its `working`.
     */
    onLiveStatus(s: LiveSession, status: LiveStatus, workingAsked?: number): void {
        if (status.treeId && status.treeId !== s.researchId) {
            this.endLiveFollow(s, 'other');
            return;
        }
        if (this.liveEndIfAgentless(s.researchId, status)) {
            void this.pollResearchBridge();
            return;
        }
        if (status.headAt) s.headAt = status.headAt;
        if (workingAsked === undefined || workingAsked === (s.workingEvents ?? 0)) s.working = withFamilyPersons(status.working, s.bridge);
        // Asked before the last `working` event: who works comes from the event; a fresh status is asked for the rest.
        else this.liveStatusSoon(s);
        s.features = status.features;
        s.accepts = status.accepts;
        // A row moved by a write the research has not reported yet stays where it was moved.
        s.waiting = this.withoutBranchAnswers(this.liveWaitingShown(s, status.waiting));
        // A task that was not there before unfolds "Waiting for you" (its phase and its group;
        // the section is expanded by default). Collapsed or hidden by the user, nothing opens:
        // the heading counts it as new, and expanding it later opens what came meanwhile.
        // What came already sent needs nothing from the user: it unfolds nothing (an item
        // that moves to sent keeps its id and is not new).
        const fresh = status.waiting.filter(w => !s.seenWaiting.has(w.id));
        for (const w of fresh) s.seenWaiting.add(w.id);
        const freshTodo = todoWaiting(fresh);
        for (const w of freshTodo) s.waitingView.fresh.add(w.id);
        const pref = sectionPrefs().waiting;
        if (freshTodo.length > 0 && (pref === undefined || pref === 'expanded')) {
            s.autoCollapsed.delete('waiting');
            this.openWaitingItems(s, freshTodo);
        } else {
            for (const w of freshTodo) s.waitingPendingOpen.add(w.id);
        }
        s.queue = status.queue;
        s.queueMore = status.queueMore;
        s.queueCounts = status.queueCounts;
        // A new order of the queue: the pages on screen are read again (after a pause), the others forgotten.
        if (status.queueCounts) noteQueueRev(s.bridge.base, status.queueCounts.rev);
        s.researches = status.researches;
        s.caps = status.caps;
        s.offLine = status.offLine;
        s.update = status.update;
        s.busy = status.busy;
        s.work = status.work;
        s.browser = status.browser;
        s.spend = status.spend;
        s.lastIntake = status.lastIntake;
        // The latest status decides: without its count (an older research, a bridge just started) the history counts.
        s.recent = status.recent;
        s.directionsRev = status.directionsRev;
        if (status.treeId) noteResearchWaiting(status.treeId, status.waiting, status);
        this.refreshActionMenuBadges();
        if (status.head && status.head !== s.head) {
            this.enqueueLive(s, () => this.onLiveChange(s, { head: status.head, what: [], at: '' }));
        }
        this.refreshDirectionPeople(s, status.head || s.head);
        this.renderLivePanel();
    },

    /**
     * Switched to an archive while followed (or its agent gone from this computer): nobody works
     * in it to follow, so following ends and the tree opens for editing, as a ?live= to an archive
     * does (A2). Any status of the followed research decides (the stream's, or the regular ask's),
     * said once. True when following ended here.
     */
    liveEndIfAgentless(researchId: string, status: LiveStatus): boolean {
        const s = live;
        if (!s || s.ended || s.researchId !== researchId) return false;
        const accepts = status.accepts;
        if (!statusAgentless(status)) return false;
        if (status.treeId) noteResearchBridgeStatus(status.treeId, accepts, status.head, researchTreeOfStatus(status));
        this.endLiveFollow(s, 'stopped');
        this.renderLiveFollowPill();
        const archive = status.treeState ? status.treeState === 'archive' : accepts?.mode === 'archive';
        this.showToast(archive ? strings.research.liveEndedArchive : strings.research.liveEndedNoAgent, 6000);
        this.refreshResearchSyncUi();
        return true;
    },

    /** A change: refresh the tree, list what changed, light up those people. */
    async onLiveChange(s: LiveSession, change: LiveChange): Promise<void> {
        if (s.ended || live !== s) return;
        // A reconnect replays the last change; the tree already has it.
        if (change.head && change.head === s.head) return;
        const data = await this.refreshLiveTree(s, change.head);
        if (!data) return;
        // Following live: a hypothesis asked from this page and decided in this version is said (spec 074).
        if (DataManager.getCurrentTreeId() === s.treeId) this.researchHypothesesLoaded(s.treeId);
        const nameOf = (ref: string): string | null => {
            const [id] = personsByRefs(data, [ref]);
            const p = id ? data.persons[id] : undefined;
            return p ? shownNameOrEmpty(p) || null : null;
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
        // The cards show what came by themselves (TreeRenderer.renderLive: the scene of the load).
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
        // Followed, or the overview open without following (spec 057 §7.2).
        if (!entries || s.ended || (live !== s && viewing?.session !== s)) return;
        const data = DataManager.getCurrentTreeId() === s.treeId ? DataManager.getData() : null;
        const nameOf = (ref: string): string | null => {
            const [id] = data ? personsByRefs(data, [ref]) : [];
            const p = id && data ? data.persons[id] : undefined;
            return p ? shownNameOrEmpty(p) || null : null;
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

    /**
     * Fetch the research's current GEDCOM and put it into the followed tree only.
     * `head`: the change's; a bridge with `ged.stale` says the file's own head,
     * which is the state the tree then holds.
     */
    async refreshLiveTree(s: LiveSession, head: string): Promise<StromData | null> {
        let text: string;
        let fileHead: string | null = null;
        let etag: string | null = null;
        const ownHead = bridgeGivesStale(s.features);
        // Following live asks nothing: the setting decides about images (not taken: not even downloaded).
        const takeImages = SettingsManager.isImportImages();
        let images: ReadonlyMap<string, string> | undefined;
        let variant: TreeImagesVariant = 'data';
        try {
            const got = await fetchResearchTree(s.bridge.ged, { byHash: bridgeGivesImagesByHash(s.features), images: takeImages });
            text = got.text;
            images = got.images;
            variant = got.variant;
            if (!takeImages) forgetHeldImages();
            if (bridgeGivesEtag(s.features)) etag = got.etag;
            if (ownHead) fileHead = got.head ?? readResearchHeader(text).head;
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
            data = convertToStrom(parseGedcom(text), { images }).data;
        } catch {
            return null;
        }
        if (!takeImages) data = stripMedia(data);
        if (!TreeManager.getTreeMetadata(s.treeId)) {
            // The user deleted the followed tree: stop, never recreate it.
            this.endLiveFollow(s, 'ended');
            return null;
        }
        const active = DataManager.getCurrentTreeId() === s.treeId;
        const previous = await readTree(s.treeId);
        // Images added in the app before following stay (the research has none of them).
        // Titles a research that does not know them dropped stay (T07), and those it never got (B18-1).
        const features = this.researchStatusOf(s.researchId)?.features;
        const knowsTitles = !!features?.includes(TITLES_FEATURE);
        const link = TreeManager.getTreeMetadata(s.treeId)?.research;
        const known = previous ? keepTableViews(keepImports(keepLineageOverrides(keepSurnameVariants(keepMarriedSurname(keepTitles(data, previous, features, researchHasTitles(link, features)), previous, features), previous), previous), previous, features), previous) : data;
        const kept = previous ? carryOverMedia(stabilizeIds(known, previous), previous).data : data;
        const stable = migrateData(previous && !this.researchKeepsLoneFamilies(s.researchId) ? carryOverUnknownPartners(kept, previous) : kept);
        if (active) {
            // Following replaces the tree again and again: one backup, before the first time.
            if (!s.backedUp) s.backedUp = !!await DataManager.snapshotNow('pre-research-load');
            DataManager.replaceWithSourceData(stable);
            this.refreshSearch();
        } else {
            TreeManager.updateTreeFromImport(s.treeId, stable);
        }
        if (fileHead || head) s.head = fileHead || head;
        // The tree of the research's head now (asked without `stale`): nothing newer is being built for it.
        s.preparing = false;
        // Titles kept that the research never got: its version without them is the base, they go with the next send.
        const loaded = active ? DataManager.getData() : stable;
        const { base, titlesIn } = researchTitlesBase(loaded, data, knowsTitles, link?.titlesIn);
        TreeManager.setResearchLink(s.treeId, {
            id: s.researchId,
            fingerprint: contentFingerprint(base),
            syncedAt: new Date().toISOString(),
            ...(s.head ? { head: s.head } : {}),
            ...(header.mode === 'archive' ? { mode: 'archive' as const } : {}),
            ...(titlesIn ? { titlesIn } : {}),
        }, { agentless: this.researchAgentlessFor(s.researchId, header.mode === 'archive' ? { mode: 'archive' } : undefined) });
        if (!titlesIn) TreeManager.patchResearchLink(s.treeId, { titlesIn: undefined });
        this.researchKeepCopy(s.treeId, base);
        // The file's tag (one sent with it): a reload while the research stays here keeps this tree (a 304).
        if (etag) this.researchKeepTreeEtag(s.treeId, s.researchId, etag, takeImages, variant);
        return loaded;
    },

    /** The user stops following (or a new ?live= replaces the session). */
    stopLiveFollow(silent = false): void {
        const s = live;
        if (!s) return;
        // "Stop following" asked with the overview open: it stays (an end the app makes closes it).
        const keepOverview = !silent && !s.ended && s.overview
            && DataManager.getCurrentTreeId() === s.treeId && this.isResearchOverviewOpen();
        this.endLiveFollow(s, 'stopped', { keepOverview });
        if (silent) return;
        this.showToast(strings.research.stopped);
        // The one-time "How should changes go?" right away, not at a later click (063 U3 A7).
        this.researchAskSendModeAfterFollow();
    },

    /** End a session: close the stream, lift read-only, keep the last state. */
    endLiveFollow(s: LiveSession, reason: 'ended' | 'other' | 'stopped', opts: { keepOverview?: boolean } = {}): void {
        if (live !== s) return;
        forgetLiveBridge();
        resetQueueLists();
        const wasEnded = s.ended;
        s.ended = true;
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
        if (s.statusSoon) clearTimeout(s.statusSoon);
        s.statusSoon = null;
        try {
            s.es?.close();
        } catch { /* already closed */ }
        s.es = null;
        if (DataManager.getLiveTreeId() === s.treeId) DataManager.setLiveTree(null);
        if (followNote?.treeId === s.treeId) clearFollowNote();
        if (reason === 'stopped') {
            live = null;
            // Stopped with its overview open: following ends, the overview stays, now without following
            // (only its ⤡, × or Escape close it).
            if (opts.keepOverview) this.openOverviewViewing();
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
        this.renderLivePanel();
    },

    toggleLivePanel(): void {
        if (!live) return;
        live.collapsed = !live.collapsed;
        if (live.collapsed) {
            live.seenChanges = live.changes.length;
            waitingFocus = null;
        }
        this.renderLivePanel();
    },

    syncLivePanelVisibility(): void {
        this.renderResearchOverview();
        const panel = document.getElementById('live-panel');
        if (!panel) return;
        // The same rule as the panel's own redraw: a drawn overview hides it.
        if (live) panel.hidden = livePanelHidden(live);
        else if (idlePanel) panel.hidden = this.activeResearchId() !== idlePanel || viewingShown();
    },

    /** The panel element (created on first use). */
    livePanelElement(): HTMLElement {
        let panel = document.getElementById('live-panel');
        if (!panel) {
            panel = el('aside', 'live-panel');
            panel.id = 'live-panel';
            panel.setAttribute('role', 'region');
            holdFollowNoteIn(panel, 'panel');
            document.body.appendChild(panel);
            // Its size (the strip grows with a note, hides, goes) moves the tree's pills on a phone.
            if (typeof ResizeObserver === 'function') new ResizeObserver(publishLiveStrip).observe(panel);
        }
        return panel;
    },

    /**
     * The "Waiting for you" section: the first few tasks to do (in the
     * research's order, with their kind), since when, and (while the research
     * runs) "Answer (research)" into the research; the rest in the overview. Bridge
     * text is text only. Returns the section's body. Without `fold` the
     * heading does not fold (the panel shown without following).
     */
    appendWaitingSection(body: HTMLElement, items: readonly LiveWaiting[], answerable: boolean,
        fold?: LiveFold): HTMLElement {
        const r = strings.research;
        const L = strings.live;
        const todo = waitingTodoCount(items);
        const sent = items.length - todo;
        const title = `${r.waiting} · ${todo}`;
        const replies = sent > 0 ? L.waitingReplyCount(sent) : undefined;
        let host: HTMLElement;
        if (fold) {
            host = liveSection(body, { ...fold, title, summary: replies, headCls: 'live-panel-heading-waiting', help: 'waiting' });
        } else {
            const row = body.appendChild(el('div', 'live-section__headrow live-section__headrow--help live-section__headrow--m'));
            const h = row.appendChild(el('h4', 'live-panel-heading live-panel-heading-waiting'));
            h.appendChild(el('span', 'live-section__title', title));
            if (replies) h.appendChild(el('span', 'live-section__sum', replies));
            row.appendChild(helpMark('waiting'));
            host = body;
        }
        const list = el('ul', 'live-panel-list live-waiting');
        host.appendChild(list);
        const { shown, more } = panelWaiting(items, undefined, waitingFocusIds());
        for (const w of shown) {
            const li = el('li', 'live-waiting-row');
            markWaitingFocus(li, w);
            const text = el('div', 'live-waiting-text');
            if (w.kind === 'story') {
                // A story's new version: compared here, not answered there.
                const compare = this.appendStoryWaiting(text, w, (id) => this.showLivePerson(id));
                const at = timeEl(w.at, 'ago');
                if (at) text.appendChild(at);
                const whyStory = waitingWhyEl(w);
                if (whyStory) text.appendChild(whyStory);
                li.append(text, compare);
                list.appendChild(li);
                continue;
            }
            const what = text.appendChild(el('span', 'live-waiting-what'));
            // A newer research names the kind: a short label before the text.
            if (w.kind === 'branch') what.appendChild(el('span', 'live-kind live-kind--decide', strings.live.waitBranchKind));
            else if (w.section) what.appendChild(waitingKindLabel(w));
            // A hypothesis (spec 074 §9): its id before its question.
            if (w.kind === 'hypothesis') what.append(el('strong', 'hwr-id', w.id), ' · ');
            what.append(w.kind === 'branch' ? waitBranchText(w, liveSession()) : w.what);
            // "on" is the agent's free text; "user" only repeats the heading.
            if (!waitsOnUser(w.on)) text.appendChild(el('small', 'live-time', r.waitingOn(w.on!)));
            const at = timeEl(w.at, 'ago');
            if (at) text.appendChild(at);
            const why = waitingWhyEl(w);
            if (why) text.appendChild(why);
            li.appendChild(text);
            const s = answerable ? liveSession() : null;
            if (s && !s.ended && this.appendPanelWaitingTask(li, what, s, w)) {
                // Images, a website or a check (spec 048 §7): their short state and one main action, drawn there.
            } else if (w.kind === 'place' && this.waitingPlacesAccess().canAnswer) {
                // A question about a place: its card, answered through the bridge.
                const answer = el('button', 'live-waiting-answer', strings.places.waiting.answer);
                answer.type = 'button';
                answer.dataset.action = 'place';
                answer.onclick = () => this.showWaitingPlaces(w.place ?? w.id);
                li.appendChild(answer);
            } else if (w.kind === 'hypothesis') {
                // A hypothesis: decided in its card (or in the overview's row), "More ›" leads there.
                const personId = this.waitingHypothesisPerson(w);
                if (personId) li.appendChild(this.waitingHypothesisMoreEl(w.id, personId, 'panel'));
            } else if (answerable && this.canAnswerResearchWaiting(w)) {
                const answer = setResearchActionLabel(el('button', 'live-waiting-answer'), r.answer, researchLinkMark('task'));
                answer.type = 'button';
                answer.onclick = () => this.answerResearchTask(w);
                li.appendChild(answer);
            }
            list.appendChild(li);
        }
        if (more > 0) {
            // The rest in the overview (where it can open), else just how many.
            if (this.canExpandLivePanel()) {
                const btn = el('button', 'link-button live-waiting-more', L.waitingMore(more));
                btn.type = 'button';
                btn.onclick = () => this.openResearchOverview();
                host.appendChild(btn);
            } else {
                host.appendChild(el('p', 'live-waiting-more', L.waitingMore(more).replace(/\s*⤢$/, '')));
            }
        }
        return host;
    },

    /** Fold or unfold a section of the small panel: a lasting choice (this device, panel and overview alike). */
    toggleLiveSection(key: LiveSectionKey): void {
        const s = live;
        if (!s) return;
        const collapsed = panelSectionCollapsed(s, key);
        s.autoCollapsed.delete(key);
        if (key === 'changes' && collapsed) s.seenInSection = s.changes.length;
        // The choice redraws (strom:live-section-prefs); an unchanged one redraws here.
        const before = sectionPrefs()[key];
        setSectionPref(key, collapsed ? 'expanded' : 'collapsed');
        if (before === (collapsed ? 'expanded' : 'collapsed')) this.renderLivePanel();
    },

    /** Open the phase "To do" and the groups of these items in the overview's "Awaiting action". */
    openWaitingItems(s: LiveSession, items: readonly LiveWaiting[]): void {
        if (items.length === 0) return;
        s.waitingView.open.set('phase:todo', true);
        for (const w of items) s.waitingView.open.set(`group:todo:${w.group?.key ?? OTHER_GROUP}`, true);
    },

    /**
     * The section choices changed (here, in Settings, in another tab): what
     * came while "Awaiting action" was collapsed or hidden opens once it is
     * expanded (as it would have opened then), and both places redraw.
     */
    onLiveSectionPrefs(): void {
        // Settings, when open, shows the same choices.
        this.renderResearchFollowSettings();
        // An open editor or section menu shows the new choices (also with no panel drawn).
        this.syncLiveSectionEditor();
        const s = live;
        if (!s) {
            this.renderLivePanel();
            return;
        }
        const pref = sectionPrefs().waiting;
        if (s.waitingPendingOpen.size > 0 && (pref === undefined || pref === 'expanded')) {
            this.openWaitingItems(s, s.waiting.filter(w => s.waitingPendingOpen.has(w.id)));
            s.waitingPendingOpen.clear();
        }
        this.renderLivePanel();
    },

    /** Restore defaults: every choice goes (no question), with Undo for a while. Nothing chosen: nothing happens. */
    resetLiveSections(withFollow = false): void {
        const follow = withFollow && hasFollowPrefs();
        if (!hasSectionPrefs() && !follow) return;
        // The choices of following first: the sections' reset redraws Settings.
        const followBefore = follow ? resetFollowPrefs() : null;
        const before = hasSectionPrefs() ? resetSectionPrefs() : null;
        if (!before) this.renderResearchFollowSettings();
        this.showToast(strings.live.restoredToast, RESTORED_TOAST_MS, {
            kind: 'live-sections',
            action: {
                label: strings.live.undo,
                run: () => {
                    if (followBefore) restoreFollowPrefs(followBefore);
                    if (before) restoreSectionPrefs(before);
                    else this.renderResearchFollowSettings();
                },
            },
        });
    },

    /** A section hidden from its menu (it vanishes where it was clicked): said, with Undo for a while. */
    hideLiveSection(key: PrefKey): void {
        const before = sectionPrefsSnapshot();
        if (before.s[key] === 'hidden') return;
        setSectionPref(key, 'hidden');
        this.showToast(strings.live.hiddenToast, 6000, {
            kind: 'live-sections',
            action: { label: strings.undo.undo, run: () => restoreSectionPrefs(before) },
        });
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
        s.working.forEach((w, i) => {
            const li = el('li');
            // Two or more runs while following: the session's number in its colour (as in the fan).
            const num = this.liveWorkingNumber(i);
            if (num !== null) {
                li.classList.add('has-num');
                li.appendChild(workingNumberBadge(num));
            }
            li.appendChild(el('strong', undefined, w.who));
            if (w.task) li.appendChild(el('span', 'live-task', ` — ${w.task}`));
            // Whom it works on, a click shows them (focused when the tree on screen lacks them).
            const person = w.person ? Object.values(DataManager.getData().persons).find(p => p.refn === w.person) : undefined;
            if (person) {
                li.appendChild(document.createTextNode(' · '));
                const link = el('button', 'live-person-link live-working__person', shownNameOrEmpty(person) || r.showInTree);
                if (shownNameOrEmpty(person)) link.innerHTML = fitNameHtml(person, shownNameOrEmpty(person));
                link.type = 'button';
                link.title = r.showInTree;
                link.onclick = () => this.overviewShowPerson(person.id, 'docked');
                li.appendChild(link);
            } else if (w.person) {
                // A person the app's tree does not have: the research's identifier, no link.
                li.appendChild(document.createTextNode(' · '));
                const ref = el('span', 'live-person-unknown live-working__person', w.person);
                ref.title = strings.live.personNotInApp;
                li.appendChild(ref);
            }
            // How the task helps its line, or its branch outside the lines (as in the overview's Now).
            const why = workingWhyText(w, s);
            if (why) li.appendChild(el('span', 'live-working__why', ` · ${why}`));
            if (w.paused) li.appendChild(el('span', 'live-paused', pausedText(w)));
            const since = timeEl(w.since, 'sincefor');
            if (since) li.appendChild(since);
            working.appendChild(li);
        });
    },

    /**
     * The sources of the research's history as links: the viewer opens over
     * the panel or the overview (a sheet stays under it), only to read;
     * following goes on, the focus comes back to the link once it closes.
     */
    liveSourceLinks(s: LiveSession, overSheet = false): ChangeSourceLinks {
        return {
            data: DataManager.getCurrentTreeId() === s.treeId ? DataManager.getData() : null,
            open: (id, link) => {
                this.showSourceViewer(id, null, { readOnly: true, overSheet });
                const host = link.closest('#research-overview') ? '#research-overview' : '#live-panel';
                returnFocusAfterViewer(link, () => document.querySelector<HTMLElement>(`${host} .live-source-link[data-source="${CSS.escape(id)}"]`));
            },
        };
    },

    /**
     * Under a history line naming a source the app's version does not have:
     * "The source is in a newer research version." — only for a line newer
     * than that version (an older one: the source was taken back or merged).
     * `withLoad`: "Load new version" when one waits (the overview; the panel
     * has it in its bar).
     */
    appendSourceInNewer(host: HTMLElement, s: LiveSession, c: LiveChangeItem, withLoad: boolean): void {
        const link = TreeManager.getTreeMetadata(s.treeId)?.research;
        const st = DataManager.getCurrentTreeId() === s.treeId ? this.currentResearchSyncState() : null;
        const waits = !!st && (['newer', 'unsentAndNewer'] as string[]).some(k => k === st.kind || k === st.core);
        if (!lineNewerThanLoaded(c.head, s.adds.map(a => a.head), link?.head || s.head, waits)) return;
        const hint = el('div', 'live-hint', strings.live.sourceInNewer);
        if (withLoad && waits) {
            const load = el('button', 'link-button live-hint__load', strings.sync.loadNewer);
            load.type = 'button';
            load.onclick = (e) => {
                e.stopPropagation();
                this.researchSyncAction('loadNewer');
            };
            hint.append(' ', load);
        }
        host.appendChild(hint);
    },

    /** Change rows (text with the people as links, then the time). */
    appendChangeRows(list: HTMLElement, changes: readonly LiveChangeItem[], glyph?: (c: LiveChangeItem) => string): void {
        const r = strings.research;
        if (changes.length === 0) list.appendChild(el('li', 'live-empty', r.noChanges));
        const s = live;
        const sources = s ? this.liveSourceLinks(s) : undefined;
        for (const c of changes) {
            const li = el('li');
            const row = el('div', 'live-change');
            const text = el('span', 'live-change-text');
            const missing = appendChangeText(text, c, (id) => this.showLivePerson(id), sources);
            if (missing && s) this.appendSourceInNewer(text, s, c, false);
            row.appendChild(text);
            const at = timeEl(c.at, 'ago');
            // Two or more lines at work: the change's line before its time ("↑ · 2 min ago").
            const g = glyph?.(c) ?? '';
            if (g) {
                const meta = el('small', 'live-change-meta');
                meta.appendChild(el('span', 'live-change-dir', g));
                if (at) meta.append(' · ', at);
                row.appendChild(meta);
            } else if (at) row.appendChild(at);
            li.appendChild(row);
            list.appendChild(li);
        }
    },

    /**
     * A row of `working[]` about a couple whose family the app does not know
     * yet (the tree was not read from this bridge since it opened): read the
     * tree once for its families, then draw again with the couple's person.
     */
    readWorkingFamilies(): void {
        const s = live;
        if (!s || s.ended || familyPartners.has(s.bridge.ged) || familiesReading.has(s.bridge.ged)) return;
        if (!s.working.some(w => w.family && !w.person)) return;
        const url = s.bridge.ged;
        familiesReading.add(url);
        // Only its families are read: the file with its images by hash is enough, its images are not asked.
        void fetchResearchTree(url, { byHash: bridgeGivesImagesByHash(s.features), images: false }).then(() => {
            if (live === s) this.renderLivePanel();
        }, () => { /* the next status tries again */ }).finally(() => familiesReading.delete(url));
    },

    /** Draw the "Research now" panel. Bridge text is set as text, never HTML. */
    renderLivePanel(): void {
        this.readWorkingFamilies();
        queueMicrotask(keepLineFocus());
        queueMicrotask(focusQueueMoved);
        syncResearchCardInfo();
        // A selected line drops with the tree it was made in or the end of following.
        this.syncLineSelection();
        // The switcher's marks follow the live status (in place, after this redraw).
        this.refreshResearchMarks();
        this.noteResearchMarksDrawn();
        // Research for this tree, when open: its work outside the directions follows the status.
        this.renderOffLineSettings();
        // Following the agent in the tree reacts to every status and change (after this redraw).
        queueMicrotask(() => this.syncLiveFollow());
        const s = live;
        if (!s && !idlePanel) {
            document.getElementById('live-panel')?.remove();
            publishLiveStrip();
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
        // A phone with "Awaiting action" hidden: the sheet shows it until it closes (the strip counts it).
        toggle.onclick = () => (phone && !s.ended
            ? this.openResearchOverview({ showWaiting: panelSectionHidden('waiting') && waitingTodoCount(s.waiting) > 0 })
            : this.toggleLivePanel());
        // The followed tree by name ("Live research" stays the panel's label); lit for a while after a switch.
        const treeName = this.liveTreeName(s.treeId, s.name);
        const title = toggle.appendChild(el('span', 'live-panel-title', s.ended ? r.ended : treeName));
        if (!s.ended) title.title = treeName;
        if (!s.ended && litTree === s.treeId) title.classList.add('is-fresh');
        const chevron = el('span', 'live-panel-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.innerHTML = iconSvg('chevron-down', { size: 14 });
        toggle.appendChild(chevron);
        head.appendChild(toggle);
        // The buttons as one group: a name that does not fit beside them puts them all on a row under it.
        const actions = head.appendChild(el('div', 'live-panel-actions'));
        // "Awaiting action" hidden: its count stays in the head, first (a click shows it in the overview).
        // Folded, the summary has it; a phone's strip has its own.
        const waitHidden = panelSectionHidden('waiting');
        const headWaitChip = waitHidden && !collapsed && !phone ? waitingChip(s, () => this.openResearchOverview({ showWaiting: true })) : null;
        if (headWaitChip) actions.appendChild(headWaitChip);
        // Folded: the other trees as one chip (unfolds the panel with them shown; spec 011).
        const otherChip = collapsed && !phone && !s.ended ? this.researchElsewhereChip('collapsed') : null;
        if (otherChip) actions.appendChild(otherChip);
        // ◎ ⤢ ⋯ close together (one row with Stop under a long name, 260px wide on a tablet).
        const icons = el('div', 'live-panel-icons');
        const followBtn = phone ? null : this.liveFollowButton('panel');
        if (followBtn) icons.appendChild(followBtn);
        if (this.canExpandLivePanel()) {
            const expand = el('button', 'live-panel-expand', '⤢');
            expand.type = 'button';
            // The overview in its own window (6g): ⤢ brings that window to the front.
            const label = overviewInWindow() ? strings.win.overviewInWindow : L.openOverview;
            expand.setAttribute('aria-label', label);
            expand.title = label;
            expand.onclick = () => this.openResearchOverview();
            icons.appendChild(expand);
        }
        // Customize panel (a phone's strip has none: its sheet has it).
        if (!phone) icons.appendChild(this.liveSectionMoreButton('live-panel-more', 'panel'));
        if (icons.childElementCount > 0) actions.appendChild(icons);
        const action = el('button', 'live-panel-action', s.ended ? r.close : r.stop);
        action.type = 'button';
        action.onclick = () => (s.ended ? this.closeLivePanel() : this.stopLiveFollow());
        actions.appendChild(action);
        panel.appendChild(head);
        // Following on: "Follow in: Family / Fan / Map" right under the head (also folded; a phone has it as the strip's second row).
        const followView = phone ? null : this.liveFollowViewRow('panel');
        if (followView) panel.appendChild(followView);
        // Which tree is followed now (after a switch): under the head, above "Elsewhere".
        if (!panel.hidden) appendFollowNote(panel, s);
        if (!s.ended && s.update && !phone) this.appendUpdateStrip(panel, s.update.version, s.busy);
        // Under the head: a document being read (spec 013), then the other trees where an agent works or something waits (spec 011).
        if (!collapsed && !s.ended) this.appendReadStrip(panel);
        if (!collapsed && !s.ended) this.appendResearchElsewhere(panel, 'panel');
        // Collapsed: what the hidden body would say first. On a phone: the state and what waits.
        if (collapsed) {
            const summary = el('div', 'live-panel-summary');
            if (phone && !s.ended) {
                summary.appendChild(el('span', 'live-panel-chip', liveState(s).label));
                const todo = waitingTodoCount(s.waiting);
                if (todo > 0) {
                    // A decision or a permission among them: solid amber with a dot.
                    const important = todoWaiting(s.waiting).some(isImportantWaiting);
                    const chip = summary.appendChild(el('span', `live-panel-chip live-panel-chip--warn${important ? ' is-important' : ''}`, `${r.waiting} ${todo}`));
                    if (important) chip.title = L.importantHint;
                }
                // The other trees: a chip of its own that opens the tree list.
                const chip = this.researchElsewhereChip('phone');
                if (chip) summary.appendChild(chip);
            }
            // "Awaiting action" collapsed or hidden: its count first (a click opens the overview; hidden, shown there).
            if (!phone && (waitHidden || panelSectionCollapsed(s, 'waiting'))) {
                const chip = waitingChip(s, () => this.openResearchOverview({ showWaiting: waitHidden }));
                if (chip) summary.appendChild(chip);
            }
            const fresh = s.changes.length - s.seenChanges;
            if (fresh > 0) summary.appendChild(el('span', 'live-panel-chip live-panel-new', r.newChanges(fresh)));
            // An older tree shown at once: the newer one comes by itself.
            if (s.preparing && !s.ended) summary.appendChild(livePreparing('span', 'live-panel-chip live-panel-preparing'));
            if (!s.ended && !phone) summary.appendChild(el('span', 'live-panel-chip', r.readOnly));
            // Phone: the follow switch at the strip's right end.
            const phoneFollow = phone ? this.liveFollowButton('phone') : null;
            if (phoneFollow) summary.appendChild(phoneFollow);
            if (summary.childElementCount > 0) panel.appendChild(summary);
            // The phone strip's second row: "Follow in" while following is on.
            const phoneView = phone ? this.liveFollowViewRow('phone') : null;
            if (phoneView) panel.appendChild(phoneView);
        }

        const body = el('div', 'live-panel-body');
        const stateText = s.ended ? r.endedText : s.lostSince !== null ? r.reconnecting
            : strings.otherResearch.followingTree(treeName, researchNameBeside(treeName, s.name));
        const stateLine = body.appendChild(el('p', 'live-panel-state', stateText));
        if (!s.ended && s.lostSince !== null) {
            stateLine.classList.add('is-lost');
            stateLine.setAttribute('role', 'status');
        }
        if (s.preparing && !s.ended) body.appendChild(livePreparing('p', 'live-panel-preparing'));
        // "Research on" (spec 064): once following ended, the tree's bridge can be switched on again here
        // (while following, the panel's room is the agent's; the idle panel and the tree manager have the switch).
        if (!phone && s.ended) body.appendChild(this.researchLiveSlot(s.treeId, 'panel'));
        const fold = (key: LiveSectionKey): LiveFold => ({
            id: `live-sec-${key}`,
            collapsed: panelSectionCollapsed(s, key),
            onToggle: () => this.toggleLiveSection(key),
            menu: (h, at) => this.openLiveSectionMenu(h, key, 'panel', at),
        });
        // Every section hidden: a word and the way back instead (the head keeps the count of what waits).
        if (PANEL_PREF_KEYS.every(k => panelSectionHidden(k))) {
            appendAllHidden(body, (anchor) => this.openLiveSectionEditor(anchor, 'panel'));
        }

        // Once following has ended the bridge's "who is working" is stale —
        // show it only while live.
        const multi = linesMulti(s);
        const sel = selectedLine(s);
        const drawWorking = (): void => {
            if (panelSectionHidden('working')) {
                // Hidden by the user: not drawn.
            } else if (!s.ended && multi) {
                // Two or more lines at work: a row each, one can be selected (spec 011).
                const o = strings.otherResearch;
                const groups = workingLineGroups(s);
                const n = workingLineCount(groups);
                const glyphs = groups.filter(g => g.id).map(g => directionGlyph(g.direction)).join(' ');
                const summary = sel ? o.lineSelected(directionGlyph(sel), sel.name)
                    : [glyphs, o.linesWorking(n)].filter(Boolean).join(' · ');
                // Folded, the summary says the lines or the selection; unfolded, the title says the count
                // and "All directions" drops a selection.
                const workingFold = fold('working');
                const title = n >= 2 && !workingFold.collapsed ? o.linesTitle(n) : r.atWork;
                let aside: HTMLButtonElement | undefined;
                if (sel && !workingFold.collapsed) {
                    aside = el('button', 'link-button live-lines-all', o.linesAll);
                    aside.type = 'button';
                    // Focus goes back to the dropped line's row after the redraw.
                    aside.dataset.direction = sel.id;
                    aside.onclick = () => this.setWorkingLine('all');
                }
                const host = liveSection(body, { ...workingFold, title, summary: workingFold.collapsed ? summary : undefined, aside, help: nowHelpTopic(s) });
                this.appendWorkingLines(host, s, groups);
            } else if (!s.ended) {
                const w = s.working[0];
                const since = w ? Date.parse(w.since) : NaN;
                const summary = w ? [w.who, w.paused ? L.statePaused : Number.isFinite(since) ? liveDuration(since) : ''].filter(Boolean).join(' · ') : L.nobody;
                const host = liveSection(body, { ...fold('working'), title: r.atWork, summary, help: nowHelpTopic(s) });
                this.appendWorkingList(host, s);
            }
        };

        // What waits for the user (by default before what changed: it needs them).
        const drawWaiting = (): void => {
            if (s.waiting.length > 0 && !panelSectionHidden('waiting')) {
                const waitingFold = fold('waiting');
                // Collapsed: "N new" beside the title (inside the heading's button); expanded and in view: all seen.
                const newChip = waitingFold.collapsed ? waitingNewChip(s) : null;
                if (!waitingFold.collapsed && !collapsed && !panel.hidden) noteWaitingShown(s);
                const host = this.appendWaitingSection(body, s.waiting, !s.ended, { ...waitingFold, ...(newChip ? { extra: [newChip] } : {}) });
                if (!s.ended) {
                    // A question about a place is answered here (its Answer opens the dialog), the rest in the research.
                    const where = waitingAnswerPlace(s.waiting, this.waitingPlacesAccess().canAnswer);
                    host.appendChild(el('p', 'live-panel-hint', where === 'here' ? r.answerHere : where === 'mixed' ? r.answerMixed : r.answerWhere));
                }
            }
        };

        // What changed: the last few here, all of them in the overview; a selected line: only its own.
        const drawChanges = (): void => {
            const changesHidden = panelSectionHidden('changes');
            const changesFold = fold('changes');
            if (!changesFold.collapsed && !changesHidden) s.seenInSection = s.changes.length;
            const freshInSection = s.changes.length - s.seenInSection;
            const shownChanges = sel ? s.changes.filter(c => c.research === sel.id) : s.changes;
            if (!changesHidden) {
                const changesHost = liveSection(body, {
                    ...changesFold, title: r.changes,
                    ...(sel ? { summary: strings.otherResearch.lineOnly(directionGlyph(sel), sel.name) }
                        : { summary: freshInSection > 0 ? L.newChanges(freshInSection) : undefined, summaryCls: 'live-section__sum--new' }),
                });
                const changes = el('ul', 'live-panel-list live-changes');
                changesHost.appendChild(changes);
                this.appendChangeRows(changes, shownChanges.slice(0, PANEL_CHANGES), multi ? (c) => lineGlyphFor(s, c.research) : undefined);
                if (shownChanges.length > PANEL_CHANGES && this.canExpandLivePanel()) {
                    const all = el('button', 'link-button live-all-changes', L.allInOverview);
                    all.type = 'button';
                    all.onclick = () => this.openResearchOverview();
                    changesHost.appendChild(all);
                }
            }
        };

        // The agent's queue: only while live (an old queue misleads).
        const drawQueue = (): void => {
            if (!s.ended && !panelSectionHidden('queue')) this.appendQueueSection(body, s, fold('queue'), 3);
        };
        // In the sections' order (one for the panel and the overview; the panel has four of them).
        const draw: Record<LiveSectionKey, () => void> = { working: drawWorking, waiting: drawWaiting, changes: drawChanges, queue: drawQueue };
        for (const key of panelSectionOrder()) draw[key]();
        panel.appendChild(body);
        if (!s.ended && s.spend && !phone) this.appendSpendFoot(panel, s.spend);
        placeLivePanel(panel);
        const again = menuTask ? panel.querySelector<HTMLElement>(`.live-queue-more[data-task="${menuTask}"]`) : null;
        if (again && menuTask) this.openLiveTaskMenu(again, menuTask, true);
        // Too tall for the window: fold from the bottom up (by default Up next, then Changes, then Working;
        // never Waiting, never a section with a choice: one kept expanded makes the panel scroll). Not remembered.
        if (!collapsed && !panel.hidden && body.scrollHeight > body.clientHeight + 1) {
            const prefs = sectionPrefs();
            const next = autoFoldOrder().find(k => prefs[k] === undefined && !s.autoCollapsed.has(k)
                && body.querySelector(`#live-sec-${k}`));
            if (next) {
                s.autoCollapsed.add(next);
                this.renderLivePanel();
                return;
            }
        }
        if (!timeTicker) timeTicker = setInterval(tickLiveTimes, TIME_TICK_MS);
        // An open Customize panel or section menu follows the redraw.
        this.syncLiveSectionEditor();
    },

    appendUpdateStrip(panel: HTMLElement, version: string, busy?: LiveBusy): void {
        const r = strings.research;
        const strip = el('div', 'live-panel-update');
        strip.appendChild(el('span', 'live-panel-update-text', r.updateAvailable(version)));
        const url = this.activeResearchLink('update');
        if (url) {
            const btn = setResearchActionLabel(el('button', 'link-button live-panel-update-link'), r.updateResearch, researchLinkMark('update'));
            btn.type = 'button';
            btn.onclick = () => this.launchResearchLink(url);
            strip.appendChild(btn);
        }
        // A session or run at work: the update does not interrupt it (it finishes on the current version).
        const working = updateBusyText(busy);
        if (working) {
            const note = el('span', 'live-panel-update-busy', working);
            note.title = r.updateBusyHint;
            strip.appendChild(note);
        }
        panel.appendChild(strip);
    },

    /**
     * "Up next": the first `limit` tasks of the agent's queue (⋯ parks or
     * drops one in the research), parked ones below (Resume (research)), the rest as
     * one link. Nothing changes here after an action: the next status tells.
     */
    appendQueueSection(body: HTMLElement, s: LiveSession,
        fold: LiveFold, limit: number, title = strings.research.queue,
        directions = false): void {
        const r = strings.research;
        const L = strings.live;
        // The overview, two or more directions running: each task names its
        // direction, and pills filter the queue by one. The filter is the
        // panel's selected line too (one choice), so it narrows both.
        const dirFilter = queueDirectionFilter(s);
        const multi = directions && (directionsMulti(s) || dirFilter !== 'all');
        // The overview narrowed to one branch outside the directions ("All N tasks in the queue ›").
        const branch = directions ? queueBranchFilter(s) : null;
        const inFilter = (q: LiveQueueItem): boolean => branch ? q.branch === branch
            : dirFilter === 'all' || q.research === dirFilter;
        const allNext = s.queue.filter(q => q.state === 'next');
        const counts = s.queueCounts;
        if (s.queue.length === 0 && s.queueMore === 0 && !(counts && counts.next + counts.parked > 0)) return;
        // The counts of the whole queue (`queueCounts`), else of the status's window.
        const nextCount = counts ? counts.next : allNext.length + s.queueMore;
        const lineCount = (id: string): number => counts ? counts.research[id] ?? 0 : allNext.filter(q => q.research === id).length;
        // The overview reads the whole queue by pages through the bridge (`queue.page`): a filter's
        // tasks from all of it, the rest of the queue by "Load more"; never while the section is folded.
        const paged = directions && !fold.collapsed && !!counts && queuePaged(s);
        const base = s.bridge.base;
        const filter: QueueFilter | null = !paged ? null
            : branch ? { branch } : dirFilter !== 'all' ? { research: dirFilter } : null;
        const whole: QueueFilter = { state: 'next' };
        // A filter's list is read when shown; the whole queue's only once "Load more" was asked.
        const list = filter ? requestQueueList(base, filter, 'queue')
            : paged && queueList(base, whole) ? requestQueueList(base, whole, 'queue') : null;
        const next = list ? list.items.filter(q => q.state === 'next') : allNext.filter(inFilter);
        const windowParked = s.queue.filter(q => q.state === 'parked' && inFilter(q));
        const parked = list ? [...list.items.filter(q => q.state === 'parked'),
            ...windowParked.filter(q => !list.items.some(x => x.id === q.id))] : windowParked;
        const shownNext = list ? next : next.slice(0, limit);
        const shownParked = list ? parked : parked.slice(0, limit);
        const hidden = s.queueMore + (next.length - shownNext.length) + (parked.length - shownParked.length);
        // The overview's own window guesses its height for its columns; more loaded splits them anew.
        if (directions) noteOverviewSectionRows('queue', shownNext.length + shownParked.length, list ? list.items.length : 0);

        const sel = !directions && dirFilter !== 'all' ? s.researches.find(d => d.id === dirFilter) : undefined;
        // The overview's queue searched through the bridge (`queue.search`): the field under the heading, once unfolded.
        const searchable = directions && queueSearchOffered(s);
        const search = searchable && paged ? queueSearchFor(s, () => this.renderResearchOverview()) : null;
        // The heading's own action on its right (unfolded only), and the count in the title whenever the field or it is there.
        const action = directions && !fold.collapsed ? this.queueHeadAction(s) : null;
        const counted = searchable || !!action;
        const host = liveSection(body, {
            ...fold, title: counted ? L.queueTitleCount(title, nextCount) : title, headCls: 'live-queue-toggle', help: 'queue',
            ...(action ? { aside: action } : {}),
            ...(counted ? {} : {
                summary: sel ? strings.otherResearch.lineQueueOf(counts ? lineCount(sel.id) : next.length, nextCount, directionGlyph(sel))
                    : L.queueCount(nextCount),
            }),
        });
        if (search) search.field.mount(host);
        if (multi) {
            const pills = el('div', 'research-overview__filters research-overview__queue-filters');
            pills.setAttribute('role', 'radiogroup');
            pills.setAttribute('aria-label', L.dirFilterLabel);
            const active = activeDirections(s);
            // A selected line no longer running keeps its pill.
            const picked = s.researches.find(d => d.id === dirFilter);
            if (picked && !active.includes(picked)) active.push(picked);
            const options: [string, string, number][] = [
                ['all', L.filterAll, counts ? counts.next : allNext.length],
                ...active.map(d => [d.id, d.name, lineCount(d.id)] as [string, string, number]),
            ];
            for (const [id, label, n] of options) {
                const chip = el('button', 'research-overview__filter', `${label} ${n}`);
                chip.type = 'button';
                chip.setAttribute('role', 'radio');
                chip.setAttribute('aria-checked', String(dirFilter === id));
                chip.dataset.direction = id;
                chip.onclick = () => {
                    // A line's pill replaces a branch's narrowing.
                    setQueueBranchFilter(s, null);
                    this.setWorkingLine(id);
                };
                pills.appendChild(chip);
            }
            host.appendChild(pills);
        }
        if (branch) {
            // The branch's chip beside the lines' ones; × shows the whole queue again.
            const n = counts ? counts.branch[branch] ?? 0 : allNext.filter(q => q.branch === branch).length;
            const chip = this.branchQueueChip(s, branch, n);
            let pills = host.querySelector<HTMLElement>('.research-overview__queue-filters');
            if (!pills) {
                pills = el('div', 'research-overview__filters research-overview__queue-filters');
                host.appendChild(pills);
            } else {
                pills.querySelectorAll('[role="radio"]').forEach(c => c.setAttribute('aria-checked', 'false'));
            }
            // First in the row: the active narrowing, never scrolled out of a narrow row.
            pills.prepend(chip);
            pills.scrollLeft = 0;
        }
        if (search && this.appendQueueSearchResult(host, s, search, { base, branch, dirFilter, multi })) return;
        const ul = el('ul', 'live-panel-list live-queue');
        host.appendChild(ul);
        if (search) this.queueRowsKeys(ul, search);
        if (list && list.total === null) {
            // The filter's first page not read yet: being read, or failed (try again).
            this.appendQueueListState(ul, list.error, () => {
                retryQueueList(base, list.filter, 'queue');
                this.renderResearchOverview();
            });
            return;
        }
        const canTask = this.researchLinkAvailable('task');
        // A task's own place (Do next / To the end) is set through the bridge, no mark.
        const canOrder = taskOrderOffered(s);
        // Narrowed to a branch: each task keeps its place in the whole queue,
        // the same number as under the branch (a line's filter counts anew,
        // unless the bridge says each task's place).
        const placeOf = branch ? new Map(allNext.map((q, i) => [q.id, i + 1])) : null;
        const placeAt = (q: LiveQueueItem, i: number): number =>
            (list || branch || dirFilter === 'all' ? q.pos : undefined) ?? placeOf?.get(q.id) ?? i + 1;
        // One width for every number of the list (the widest place's digits): the texts start in one column.
        const widest = shownNext.reduce((m, q, i) => Math.max(m, placeAt(q, i)), 0);
        if (widest >= 10) ul.style.setProperty('--live-queue-num', `${String(widest).length}ch`);
        shownNext.forEach((q, i) => {
            const li = el('li', 'live-queue-row');
            li.dataset.task = q.id;
            // With the search: ↓ from its field comes here.
            if (search) li.tabIndex = -1;
            const place = placeAt(q, i);
            const num = el('span', 'live-queue-num', String(place));
            if (placeOf || list) num.setAttribute('aria-label', L.branchQueuePos(place));
            li.appendChild(num);
            const text = el('span', 'live-queue-text', q.text);
            // The panel, two or more lines at work: the task's line first.
            const glyph = directions ? '' : lineGlyphFor(s, q.research);
            if (glyph) text.prepend(el('span', 'live-queue-dir', `${glyph} `));
            const kind = queueKindTag(q);
            if (kind) text.append(' ', kind);
            markQueueNextRow(li, text, q, s);
            const dir = multi ? taskDirectionName(s, q.research) : '';
            if (dir) text.appendChild(el('span', 'research-overview__dir', ` · ${dir}`));
            appendQueueNote(text, q, s);
            const problem = this.taskOrderProblem(q.id);
            if (problem) {
                const box = el('span', 'live-queue-problem', problem);
                box.setAttribute('role', 'alert');
                text.appendChild(box);
            }
            if (this.taskOrderBusy(q.id)) li.setAttribute('aria-busy', 'true');
            li.appendChild(text);
            if (queueRowMenu(s, q, canTask, canOrder)) {
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
            ul.appendChild(li);
        });
        for (const q of shownParked) {
            const li = el('li', 'live-queue-row live-queue-row--parked');
            li.dataset.task = q.id;
            if (search) li.tabIndex = -1;
            const text = el('span', 'live-queue-text', `${r.parkedPrefix} ${q.text}`);
            const kind = queueKindTag(q);
            if (kind) text.append(' ', kind);
            appendQueueNote(text, q, s);
            li.appendChild(text);
            if (canTask) {
                const wake = setResearchActionLabel(el('button', 'link-button live-queue-wake'), r.wake, researchLinkMark('task', { taskDo: 'wake' }));
                wake.type = 'button';
                wake.onclick = () => this.runLiveTask(q.id, 'wake');
                li.appendChild(wake);
            }
            ul.appendChild(li);
        }
        const open = this.activeResearchLink('open');
        if (paged && counts) {
            // How far the list goes: "Load more" (a page) while there is more, the cap said at its end.
            // Only the tasks up next count, as the chips do: a filter's list holds the set-aside ones
            // after them (the research's order), never part of "N of M shown".
            const filterNext = !filter ? counts.next
                : filter.branch ? counts.branch[filter.branch] : filter.research ? counts.research[filter.research] : undefined;
            const total = list ? filterNext ?? list.total ?? 0 : counts.next;
            const has = list ? next.length : allNext.length;
            const more = list ? list.next !== null && has < total : allNext.length < counts.next;
            if (list?.error) {
                this.appendQueueListState(ul, list.error, () => {
                    loadMoreQueueList(base, list.filter, 'queue');
                    this.renderResearchOverview();
                });
            } else if (more && has < QUEUE_ROWS_CAP) {
                const li = el('li', 'live-queue-row live-queue-row--more live-queue-row--load');
                const busy = !!list?.loading;
                const btn = el('button', 'link-button live-queue-load', busy ? L.queueLoading : L.queueLoadMore);
                btn.type = 'button';
                btn.dataset.do = 'queue-more';
                if (busy) {
                    btn.setAttribute('aria-disabled', 'true');
                    li.setAttribute('aria-busy', 'true');
                } else {
                    btn.onclick = () => {
                        loadMoreQueueList(base, filter ?? whole, 'queue', filter ? undefined : { items: allNext, total: counts.next });
                        this.renderResearchOverview();
                        document.querySelector<HTMLElement>('#research-overview .live-queue-load')?.focus({ preventScroll: true });
                    };
                }
                li.append(btn, el('span', 'live-queue-shown', L.queueShown(has, total)));
                // Right under the tasks up next (more of them come there), above the set-aside ones.
                ul.insertBefore(li, ul.querySelector('.live-queue-row--parked'));
            } else if (has >= QUEUE_ROWS_CAP && total > has) {
                const li = el('li', 'live-queue-row live-queue-row--more live-queue-row--cap');
                li.appendChild(el('span', 'live-queue-shown', L.queueCapNote(has, total)));
                if (open) {
                    const rest = setResearchActionLabel(el('button', 'link-button live-queue-rest'), r.queueMore(total - has), researchLinkMark('open'));
                    rest.type = 'button';
                    rest.onclick = () => this.launchResearchLink(open);
                    li.appendChild(rest);
                }
                ul.insertBefore(li, ul.querySelector('.live-queue-row--parked'));
            }
            return;
        }
        if (hidden > 0 && open) {
            const li = el('li', 'live-queue-row live-queue-row--more');
            const more = setResearchActionLabel(el('button', 'link-button live-queue-rest'), r.queueMore(hidden), researchLinkMark('open'));
            more.type = 'button';
            more.onclick = () => this.launchResearchLink(open);
            li.appendChild(more);
            ul.appendChild(li);
        }
        // The small panel: "Search the queue…" opens the overview's queue with the caret in its field (not on a phone).
        if (!directions && this.canExpandLivePanel() && queueSearchOffered(s)) {
            const link = el('button', 'link-button live-queue-search-link', L.queueSearchLink);
            link.type = 'button';
            link.onclick = () => this.openQueueSearch();
            host.appendChild(link);
        }
    },

    /**
     * The control on the right of the overview's Queue heading (null: none). Its
     * being there also puts the queue's count into the title ("QUEUE · 1 240").
     */
    queueHeadAction(s: LiveSession): HTMLElement | null {
        // "Work on the queue…" (spec 052 §5), or "At work ›" while the research works.
        return this.queueWorkHead(s);
    },

    /**
     * The search's answer under the field (`queue.search`): the line saying what
     * was found, then its tasks. False: nothing searched (or the first answer not
     * read yet), the queue itself is drawn (dimmed while a search is typed or read).
     */
    appendQueueSearchResult(host: HTMLElement, s: LiveSession, search: QueueSearch,
        o: { base: string; branch: string | null; dirFilter: string; multi: boolean }): boolean {
        const L = strings.live;
        if (!search.applied) {
            search.shown = null;
            markQueueSearchPending(search.typing);
            return false;
        }
        // The chips narrow the search too: the tasks of the chip that match the text.
        const filter: QueueFilter = o.branch ? { branch: o.branch, q: search.applied }
            : o.dirFilter !== 'all' ? { research: o.dirFilter, q: search.applied } : { q: search.applied };
        const list = requestQueueList(o.base, filter, 'search');
        const read = list.total !== null;
        if (read) search.shown = list;
        const failed = !read && !!list.error;
        markQueueSearchPending(search.typing || (!read && !failed));
        const narrowed = o.branch ? branchName(o.branch) : o.dirFilter !== 'all' ? taskDirectionName(s, o.dirFilter) : '';
        const line = el('div', 'research-overview__queue-result');
        const cancel = (): HTMLElement => {
            const b = el('button', 'link-button research-overview__queue-cancel', L.queueSearchCancel);
            b.type = 'button';
            b.onclick = () => clearQueueSearch();
            return b;
        };
        if (failed) {
            // The bridge failed or is busy: why, and Try again; the text stays in the field.
            line.classList.add('is-error');
            line.appendChild(el('span', 'research-overview__queue-result-text', list.error === 'busy' ? L.queueSearchBusy : L.queueSearchErr));
            const retry = el('button', 'link-button live-queue-retry', L.dirRetry);
            retry.type = 'button';
            retry.dataset.do = 'queue-retry';
            retry.onclick = () => {
                retryQueueList(o.base, filter, 'search');
                this.renderResearchOverview();
            };
            line.appendChild(retry);
            host.appendChild(line);
            return true;
        }
        const drawn = read ? list : search.shown;
        if (!drawn || drawn.total === null) {
            // The first answer not read yet: the queue stays, dimmed.
            search.shown = null;
            return false;
        }
        const total = drawn.total;
        let said: string;
        if (total > 0 || drawn.items.length > 0) {
            said = L.queueSearchFound(total) + (narrowed ? ` · ${L.queueSearchInDir(narrowed)}` : '');
            line.appendChild(el('span', 'research-overview__queue-result-text', said));
        } else if (drawn.elsewhere) {
            // A task's number outside the queue: where it is now.
            const state = L.queueState[drawn.elsewhere.state] ?? drawn.elsewhere.state;
            said = L.queueSearchElsewhere(drawn.elsewhere.id, state);
            line.append(el('span', 'research-overview__queue-result-text', said), cancel());
        } else {
            said = narrowed ? L.queueSearchNoneDir(narrowed) : L.queueSearchNone;
            line.appendChild(el('span', 'research-overview__queue-result-text', said));
            if (narrowed) {
                // The same text in the whole queue: the chip back on All.
                const all = el('button', 'link-button research-overview__queue-all', L.queueSearchAllDirs);
                all.type = 'button';
                all.onclick = () => {
                    setQueueBranchFilter(s, null);
                    this.setWorkingLine('all');
                    activeQueueSearch()?.input.focus({ preventScroll: true });
                };
                line.appendChild(all);
            }
            line.appendChild(cancel());
        }
        host.appendChild(line);
        if (read) sayQueueSearch(list.key, said);
        if (drawn.items.length === 0) return true;
        const ul = el('ul', 'live-panel-list live-queue research-overview__queue-found');
        host.appendChild(ul);
        this.queueRowsKeys(ul, search);
        this.appendQueueSearchRows(ul, s, drawn, o.multi);
        const has = drawn.items.length;
        if (drawn === list && list.error) {
            this.appendQueueListState(ul, list.error, () => {
                loadMoreQueueList(o.base, filter, 'search');
                this.renderResearchOverview();
            });
        } else if (drawn.next !== null && has < total && has < QUEUE_ROWS_CAP) {
            const li = el('li', 'live-queue-row live-queue-row--more live-queue-row--load');
            const busy = !!drawn.loading;
            const btn = el('button', 'link-button live-queue-load', busy ? L.queueLoading : L.queueLoadMore);
            btn.type = 'button';
            btn.dataset.do = 'queue-more';
            if (busy) {
                btn.setAttribute('aria-disabled', 'true');
                li.setAttribute('aria-busy', 'true');
            } else if (drawn === list) {
                btn.onclick = () => {
                    loadMoreQueueList(o.base, filter, 'search');
                    this.renderResearchOverview();
                    document.querySelector<HTMLElement>('#research-overview .live-queue-load')?.focus({ preventScroll: true });
                };
            }
            li.append(btn, el('span', 'live-queue-shown', L.queueShown(has, total)));
            ul.insertBefore(li, ul.querySelector('.live-queue-row--parked'));
        } else if (has >= QUEUE_ROWS_CAP && total > has) {
            const li = el('li', 'live-queue-row live-queue-row--more live-queue-row--cap');
            li.appendChild(el('span', 'live-queue-shown', L.queueCapNote(has, total)));
            ul.insertBefore(li, ul.querySelector('.live-queue-row--parked'));
        }
        return true;
    },

    /** The tasks found: the queue's rows with the task's number under the text (lit when the number or the person matched). */
    appendQueueSearchRows(ul: HTMLElement, s: LiveSession, list: QueueList, multi: boolean): void {
        const r = strings.research;
        const L = strings.live;
        const canTask = this.researchLinkAvailable('task');
        const canOrder = taskOrderOffered(s);
        // Set-aside ones last (the research's order), without a place.
        const items = [...list.items.filter(q => q.state === 'next'), ...list.items.filter(q => q.state === 'parked')];
        const widest = items.reduce((m, q) => Math.max(m, q.pos ?? 0), 0);
        if (widest >= 10) ul.style.setProperty('--live-queue-num', `${String(widest).length}ch`);
        for (const q of items) {
            const parked = q.state === 'parked';
            const li = el('li', `live-queue-row${parked ? ' live-queue-row--parked' : ''}`);
            li.dataset.task = q.id;
            li.tabIndex = -1;
            const place = !parked ? q.pos : undefined;
            const num = el('span', 'live-queue-num', place !== undefined ? String(place) : '–');
            if (place !== undefined) num.setAttribute('aria-label', L.branchQueuePos(place));
            li.appendChild(num);
            const text = el('span', 'live-queue-text', q.text);
            const kind = queueKindTag(q);
            if (kind) text.append(' ', kind);
            if (!parked) markQueueNextRow(li, text, q, s);
            const dir = multi ? taskDirectionName(s, q.research) : '';
            if (dir) text.appendChild(el('span', 'research-overview__dir', ` · ${dir}`));
            appendQueueNote(text, q, s);
            // The task's number (lit when it matched), the person who matched, "deferred".
            const how = list.match?.[q.id];
            const meta = el('span', 'live-queue-meta');
            meta.appendChild(el('span', how === 'id' ? 'research-queue__match' : 'live-queue-id', q.id));
            if (how === 'person' && q.person) {
                const p = personByRefn(q.person);
                meta.appendChild(el('span', 'research-queue__match', p ? `${q.person} ${shownName(p)}` : q.person));
            }
            if (parked) meta.appendChild(el('span', 'research-queue__deferred', L.queueTagDeferred));
            text.appendChild(meta);
            const problem = this.taskOrderProblem(q.id);
            if (problem) {
                const box = el('span', 'live-queue-problem', problem);
                box.setAttribute('role', 'alert');
                text.appendChild(box);
            }
            if (this.taskOrderBusy(q.id)) li.setAttribute('aria-busy', 'true');
            li.appendChild(text);
            if (!parked && queueRowMenu(s, q, canTask, canOrder)) {
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
            } else if (parked && canTask) {
                const wake = setResearchActionLabel(el('button', 'link-button live-queue-wake'), r.wake, researchLinkMark('task', { taskDo: 'wake' }));
                wake.type = 'button';
                wake.onclick = () => this.runLiveTask(q.id, 'wake');
                li.appendChild(wake);
            }
            ul.appendChild(li);
        }
    },

    /** The rows under the search's field: ↑/↓ from row to row, ↑ from the first back to the field. */
    queueRowsKeys(ul: HTMLElement, search: QueueSearch): void {
        ul.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('li.live-queue-row[data-task]');
            if (!row || e.target !== row) return;
            const rows = [...ul.querySelectorAll<HTMLElement>(':scope > li.live-queue-row[data-task]')];
            const i = rows.indexOf(row);
            e.preventDefault();
            if (e.key === 'ArrowDown') rows[i + 1]?.focus();
            else if (i > 0) rows[i - 1].focus();
            else search.input.focus();
        });
    },

    /** A list of the queue not read: "Loading tasks…", or why it failed with Try again. */
    appendQueueListState(host: HTMLElement, error: 'busy' | 'failed' | null, retry: () => void): void {
        const L = strings.live;
        const tag = host.tagName === 'UL' ? 'li' : 'div';
        const row = el(tag, `live-queue-state${error ? ' is-error' : ''}`);
        if (!error) {
            row.setAttribute('aria-busy', 'true');
            row.setAttribute('role', 'status');
            row.appendChild(el('span', 'live-queue-state__text', L.queueLoading));
        } else {
            row.appendChild(el('span', 'live-queue-state__text', error === 'busy' ? L.queueLoadBusy : L.queueLoadFailed));
            const btn = el('button', 'link-button live-queue-retry', L.dirRetry);
            btn.type = 'button';
            btn.dataset.do = 'queue-retry';
            btn.onclick = (e) => {
                e.stopPropagation();
                retry();
                document.querySelector<HTMLElement>(`#research-overview .live-queue-state[aria-busy="true"], #research-overview .live-queue-load`)
                    ?.focus?.({ preventScroll: true });
            };
            row.appendChild(btn);
        }
        host.appendChild(row);
    },

    /** Pages of the queue came (or failed): the overview drawn again, the focus kept on "Load more" or moved to the rows it brought. */
    queueListsChanged(draw?: () => void): void {
        const a = document.activeElement as HTMLElement | null;
        const fromLoad = !!a?.matches?.('#research-overview .live-queue-load, #research-overview .live-queue-retry');
        const before = fromLoad ? document.querySelectorAll('#research-overview .live-queue > .live-queue-row:not(.live-queue-row--more)').length : 0;
        // `draw`: the overview's own window draws its states over the overview too (greyed while the main window is closed).
        if (draw) draw();
        else this.renderResearchOverview();
        const now = document.activeElement;
        if (!fromLoad || (now && now !== document.body && now.isConnected)) return;
        const load = document.querySelector<HTMLElement>('#research-overview .live-queue-load');
        if (load) {
            load.focus({ preventScroll: true });
            return;
        }
        // The list's end: the first task it brought (its ⋯), else the list's last control.
        const rows = [...document.querySelectorAll<HTMLElement>('#research-overview .live-queue > .live-queue-row:not(.live-queue-row--more)')];
        const first = rows[before] ?? rows[rows.length - 1];
        first?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    },

    /** Park / drop / wake a queued task in the research. */
    runLiveTask(task: string, what: 'park' | 'drop' | 'wake'): void {
        this.closeLiveTaskMenu();
        const url = this.activeResearchLink('task', { task, taskDo: what });
        if (url) this.launchResearchLink(url);
    },

    /**
     * The small ⋯ menu of a queued task: Park / Drop (in the research). Escape or a click elsewhere closes it.
     * `again`: drawn anew after a panel redraw (a phone's sheet stands at once, without sliding up again).
     */
    openLiveTaskMenu(anchor: HTMLElement, task: string, again = false): void {
        const wasOpen = document.getElementById('live-task-menu')?.dataset.task === task;
        this.closeLiveTaskMenu();
        if (wasOpen) return;
        const r = strings.research;
        const menu = el('div', 'context-menu live-task-menu');
        menu.id = 'live-task-menu';
        menu.dataset.task = task;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', r.taskMenu);
        // The followed research, else the one viewed through its bridge without following (spec 057 §7).
        const s = researchSession();
        const q = liveQueueItem(s, task);
        // `queue.next`: "Do next" (exact Undo) first, also without branches; not for a task first already, at work or set aside.
        const { next: nextOn, orders } = taskMenuOrders(s, q);
        // On a phone, with `queue.next`: a sheet at the bottom titled by the task.
        const sheet = nextOn && !!q && window.matchMedia('(max-width: 640px)').matches;
        if (sheet && q) {
            // The app's bottom sheet: its handle on top, over a darkened window (bottom-sheet.ts).
            menu.classList.add('live-task-menu--sheet', 'bottom-sheet');
            const handle = el('div', 'bottom-sheet-handle');
            handle.setAttribute('aria-hidden', 'true');
            menu.appendChild(handle);
            const title = el('div', 'live-task-menu__title');
            title.append(el('span', 'live-task-menu__num', q.id), document.createTextNode(` ${q.text}`));
            menu.appendChild(title);
        }
        if (s && q && orders.length > 0) {
            const L = strings.live;
            const labels: Record<TaskOrderDo, [string, string | undefined]> = {
                next: nextOn ? [L.queueNext, L.queueNextHint] : [L.taskDoNext, L.taskDoNextHint],
                last: [L.taskDoLast, L.taskDoLastHint],
                default: [L.taskOrderReset, undefined],
            };
            const own = orders.map(what => [what, ...labels[what]] as const);
            for (const [what, label, hint] of own) {
                const item = el('div', 'context-menu-item research-direction-menu__item');
                item.setAttribute('role', 'menuitem');
                item.tabIndex = -1;
                item.dataset.order = what;
                if (q.own === what) item.setAttribute('aria-current', 'true');
                item.appendChild(el('span', 'research-direction-menu__label', label));
                if (hint) item.appendChild(el('span', 'research-direction-menu__hint', hint));
                const go = (): void => { void (nextOn && what === 'next' ? this.doTaskNext(task) : this.changeTaskOrder(task, what)); };
                item.onclick = go;
                item.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
                };
                menu.appendChild(item);
            }
            if (own.length && this.researchLinkAvailable('task')) {
                const sep = el('div', 'context-menu-divider');
                sep.setAttribute('role', 'separator');
                menu.appendChild(sep);
            }
        }
        for (const [what, label] of (this.researchLinkAvailable('task') ? [['park', r.park], ['drop', r.drop]] as const : [])) {
            const item = setResearchActionLabel(el('div', 'context-menu-item'), label, researchLinkMark('task', { taskDo: what }));
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.action = what;
            item.onclick = () => this.runLiveTask(task, what);
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.runLiveTask(task, what); }
            };
            menu.appendChild(item);
        }
        // A phone's sheet: over the app's darkened backdrop; a tap on it closes the sheet (focus back on the ⋯).
        const backdrop = sheet ? el('div', 'bottom-sheet-overlay live-task-sheet') : null;
        if (backdrop) {
            backdrop.appendChild(menu);
            backdrop.addEventListener('click', (e) => {
                if (e.target !== backdrop) return;
                this.closeLiveTaskMenu();
                anchor.focus({ preventScroll: true });
            });
            if (again) backdrop.classList.add('active');
            document.body.appendChild(backdrop);
            if (!again) requestAnimationFrame(() => backdrop.classList.add('active'));
        } else document.body.appendChild(menu);
        anchor.setAttribute('aria-expanded', 'true');
        if (!sheet) {
            const rect = anchor.getBoundingClientRect();
            const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
            const below = rect.bottom + 4;
            const top = below + menu.offsetHeight > window.innerHeight - 8 ? rect.top - menu.offsetHeight - 4 : below;
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(top)}px`;
        }
        menu.querySelector<HTMLElement>('.context-menu-item')?.focus();
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
            // A sheet's backdrop closes it on its click (a press there alone would let the click fall through).
            if (backdrop && e.target === backdrop) return;
            if (!menu.contains(e.target as Node)) this.closeLiveTaskMenu();
        };
        document.addEventListener('keydown', onKey, true);
        // Armed after the press that opened it. A menu closed before that
        // (Escape at once, a panel redraw) disarms it too: added after the
        // cleanup, the stray listener closed every later menu at its first press.
        const arm = setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
        liveTaskMenuCleanup = () => {
            clearTimeout(arm);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('mousedown', onDown, true);
            anchor.setAttribute('aria-expanded', 'false');
        };
    },

    closeLiveTaskMenu(): void {
        liveTaskMenuCleanup?.();
        liveTaskMenuCleanup = null;
        const menu = document.getElementById('live-task-menu');
        (menu?.parentElement?.classList.contains('live-task-sheet') ? menu.parentElement : menu)?.remove();
    },

    /** "Agent this month: 4 sessions · $3.20" at the foot of the panel, (research) to the sessions. */
    appendSpendFoot(panel: HTMLElement, spend: LiveSpend): void {
        const r = strings.research;
        let amount: string;
        try {
            amount = new Intl.NumberFormat(getCurrentLanguage(), { style: 'currency', currency: spend.currency }).format(spend.amount);
        } catch {
            amount = `${spend.amount.toFixed(2)} ${spend.currency}`;
        }
        // The parts the top shows (the cost only when switched on); neither: no foot.
        const top = topPrefs();
        const sessions = top['month.sessions'];
        const price = top['month.price'];
        if (!sessions && !price) return;
        const text = sessions && price ? r.spend(spend.sessions, amount) : sessions ? r.spendSessions(spend.sessions) : r.spendAmount(amount);
        const foot = el('div', 'live-panel-spend');
        foot.appendChild(el('span', 'live-panel-spend-text', text));
        const url = this.activeResearchLink('sessions');
        if (url) {
            const btn = el('button', 'live-panel-spend-link');
            btn.innerHTML = researchActionMark(researchLinkMark('sessions'), { sr: false });
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
        // The overview open without following shows the same (and the panel lay over its ⤡).
        panel.hidden = this.activeResearchId() !== researchId || viewingShown();
        panel.replaceChildren();

        const head = el('div', 'live-panel-head');
        head.appendChild(el('span', 'live-dot'));
        // The open tree by name ("Research" stays the panel's label).
        const treeId = DataManager.getCurrentTreeId();
        const treeName = (treeId ? TreeManager.getTreeMetadata(treeId)?.name : '') || r.panelIdle;
        const title = head.appendChild(el('span', 'live-panel-title live-panel-title--static', treeName));
        title.title = treeName;
        const close = el('button', 'live-panel-close');
        close.type = 'button';
        close.innerHTML = '&times;';
        close.setAttribute('aria-label', r.close);
        close.title = r.close;
        close.onclick = () => this.closeResearchIdlePanel();
        head.appendChild(close);
        panel.appendChild(head);
        // Under the head: a document being read (spec 013), then the other trees where an agent works or something waits (spec 011).
        this.appendReadStrip(panel);
        this.appendResearchElsewhere(panel, 'panel');

        const body = el('div', 'live-panel-body');
        const o = strings.otherResearch;
        const answer = researchId && this.otherResearchEnabled() ? this.researchAnswerOf(researchId) : null;
        // Its bridge did not answer (not the browser's refusal): not running — no list to act on, how it reconnects (§5).
        const off = !!researchId && answer?.result === 'off' && this.researchModeOf(researchId) !== 'archive';
        panel.classList.toggle('is-off', off);
        // "Research on" (spec 064): the open tree's bridge, first in the panel while it runs.
        if (treeId && !off) body.appendChild(this.researchLiveSlot(treeId, 'idle'));
        if (off) {
            body.appendChild(el('p', 'live-panel-state', o.offPanel));
            const last = state ? waitingTodoCount(state.items) : 0;
            if (last > 0) body.appendChild(el('p', 'live-panel-hint rs-off-hint', o.offLast(last, agoShort(state!.at, Date.now(), getCurrentLanguage()))));
            // Off: only "Switch on" (the quiet link) and under it the one command, in case the link does nothing.
            if (treeId && this.researchLiveState(treeId)) body.appendChild(this.researchLiveSlot(treeId, 'start'));
            else body.appendChild(this.researchLiveStartHow());
        } else {
            // Connected, nobody at work: how edits reach it follows the tree's send mode.
            const status = answer?.result === 'up' ? answer.status : null;
            const agentless = this.activeResearchAgentless();
            const working = !!status && !agentless && status.working.some(w => !w.paused);
            const connected = !!status && !agentless && !working;
            if (connected && researchId) idleSeen.add(researchId);
            // An agent began while the tree was open: never locked by itself (an edit may be under way), offered instead.
            if (working && researchId && idleSeen.has(researchId)) {
                const row = body.appendChild(el('div', 'live-agent-started'));
                row.setAttribute('role', 'status');
                row.appendChild(el('span', 'live-agent-started-text', o.agentStarted));
                const go = row.appendChild(el('button', 'link-button live-agent-started-follow', r.followLive));
                go.type = 'button';
                go.onclick = () => this.followResearchHere(researchId);
            }
            if (connected) {
                // Back from "only load" with changes meanwhile, the first send goes by hand.
                const link = treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
                const mode = researchSendMode(link);
                body.appendChild(el('p', 'live-panel-state', o.idlePanel(mode === 'auto' && link?.previewDue ? 'manual' : mode)));
            }
            this.appendWaitingSection(body, state?.items ?? [], false);
            // "As of …, not running" only when it is not known to answer now.
            if (state && !status) {
                const when = new Date(state.at).toLocaleString(getCurrentLanguage(), {
                    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
                });
                body.appendChild(el('p', 'live-panel-hint', r.waitingAsOf(when)));
            }
        }
        panel.appendChild(body);

        const open = this.activeResearchLink('open');
        // Its bridge answers and an agent is there: following is the user's choice (by itself only when opening a tree where one works).
        const upHere = !off && !!researchId && answer?.result === 'up' && !!answer.status && !this.activeResearchAgentless()
            && !panel.querySelector('.live-agent-started');
        if (open || upHere) {
            const foot = el('div', 'live-panel-foot');
            if (upHere && researchId) {
                const follow = el('button', 'live-panel-follow', r.followLive);
                follow.type = 'button';
                follow.onclick = () => this.followResearchHere(researchId);
                foot.appendChild(follow);
            }
            if (open) {
                const btn = setResearchActionLabel(el('button', 'primary live-panel-open'), r.openResearch, researchLinkMark('open'));
                btn.type = 'button';
                btn.onclick = () => this.launchResearchLink(open);
                foot.appendChild(btn);
            }
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
        publishLiveStrip();
    },
});

/** A button that lights a group in the tree: which group (its kind and name, as the pill holds them). */
export function lightsGroup(btn: HTMLElement, kind: string, name: string): void {
    btn.dataset.lights = kind;
    btn.dataset.lightsName = name;
}

/** The buttons whose group the main window's tree lights now are lit (`is-lit`, aria-current); the rest not. */
export function markOverviewLit(root: HTMLElement, lit: { kind: string; label: string } | null): void {
    for (const btn of root.querySelectorAll<HTMLElement>('[data-lights]')) {
        const on = !!lit && btn.dataset.lights === lit.kind && btn.dataset.lightsName === lit.label;
        btn.classList.toggle('is-lit', on);
        if (on) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
    }
}
