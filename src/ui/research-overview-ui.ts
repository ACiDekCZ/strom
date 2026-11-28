/**
 * The Research overview: the followed research at length, next to the tree.
 * One thing in two sizes with the small live panel (⤢ / ⤡); the same
 * sections, drawn by the same helpers (src/ui/research-ui.ts).
 *   - desktop (≥ 1280px): a side panel; the tree's area narrows beside it and
 *     the point in the middle of the view stays in the middle;
 *   - tablet: a 400px panel over the tree;
 *   - phone: a full-screen sheet opened from the strip.
 * Summary (state, what came while watching, this month), Now, Waiting for
 * you, Progress (changes grouped by the agent's task, filtered, hover lights
 * the card up, "Show changed in tree"), Queue, What the research knows
 * (open conflicts and hypotheses across the tree), and where evidence is
 * missing. Bridge text is set as text, never HTML. Only while following.
 */

import { noteQueueStartStatus, QUEUE_SCOPE, QUEUE_START_MS, type QueueStartView } from './queue-start.js';
import { NOW_LIMIT_NOTE, runsSideBySide } from './queue-work-dialog.js';
import { RUN_ENDED_MS, linesWithRun, liveRuns, orderRuns, runCount, runLinesOn, runStopOn, runsShown, type LiveRun } from '../research-runs.js';
import { postRunStop } from '../research-runs-write.js';
import { runEndedText, runName, runWaitText, runsWaitingText } from '../research-runs-text.js';
import { busySpinHtml, busyStatusEl } from './busy.js';
import { canvasBusy } from './canvas-busy.js';
import type { RowRefusal } from './waiting-row-notes.js';
import { researchBridgeActionLabel, researchOpenSrText, setResearchActionLabel } from './research-open-mark.js';
import { OVERVIEW_START_MS, commandLine } from './research-live-ui.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { Person, PersonId, ResearchHypothesis } from '../types.js';
import { acceptBatch, acceptBatchRowResult } from '../research-hypothesis-waiting.js';
import { computeEvidenceGaps } from '../stats.js';
import { LiveBook, type LiveDirection, LiveChangeKind, LiveWaiting, LiveWorker, ResearchActionMark, WAITING_SECTIONS, type QueueTaskKind, booksOn, waitingGainOn, researchConflictRef, researchPersonRef, researchTaskRef, recentAddsCount, researchDeviceAllows, researchLinkMark, inShowcase, showcaseOff, researchNow } from '../research-link.js';
import { bookById, bookHeadTitle, bookImagesText, bookMetaParts, bookOfferText, bookTitle, bookWebUrl, urgentBooks, urgentBooksShown } from '../research-books.js';
import {
    waitingGroupSendable, waitingGroupHasNote, waitingSendable, waitingUnsendable, waitingFileWritable, waitingSentDayOf, waitingDayShown, waitingDayAgo,
} from '../research-waiting-write.js';
import {
    FLAT_GROUP, PLACES_GROUP, WaitingFilter, WaitingGroupOpts, WaitingGroupRows, WaitingOrder, WaitingPhase, isSortedOrder, isTimeOrder, listedBook, sortWaiting, waitingOrdersFor, effectiveWaitingFilter, waitingActionDo, waitingChatLeads, waitingChips, waitingDaysAgo, waitingGroupChatTask,
    waitingGroupOpenByDefault, waitingPhase, waitingPhases, waitingSection, waitingTaskActions, waitingTodoCount,
    WaitActionView, imagesState, splitWaitingActions, waitingActions, waitingAllImagesOffered, waitingForImages, waitingGroupBandLines, waitingGroupMissing, waitingPhaseLines, textWithLinks,
    waitingRetryCount, waitingRetryLimitText, waitingRetryMain, waitingRetryReason,
    WaitingGroupRetry, groupRetryAria, groupRetryConfirmText, groupRetryCountText, groupRetryLaterText, waitingGroupRetry, waitingGroupRetryReason,
    scopedWaiting, type WaitingScope,
} from '../research-waiting.js';
import { WaitingAnswerForm, WaitingAnswerMode, allImagesAnswerTexts, answerFormKey, waitingAnswerChangedNote } from './waiting-answer-form.js';
import { appendImagesDetail, bindImagesDrop, clearImagesSeen, forgetImagesArrived, imagesShortEl, itemKey, noteImagesArrived } from './waiting-images-ui.js';
import { clearOverviewImages, foldOverviewImages, overviewImagesResult, auditFixedRowDrawn, waitingAuditMarkEl, waitingAuditShown } from './waiting-task-ui.js';
import { formatLiveClock } from '../live-time.js';
import { waitsText } from '../research-holds.js';
import { MQ_PHONE_BAR, isMobile, isPhoneBar } from '../breakpoints.js';
import { openHeadMenu } from './table-view/table-headmenu.js';
import {
    ORDER_ICON, WaitingGroups, noteWaitingNew, setWaitingDrawn, shownWaitingGroups, storeWaitingGroupMode, storeWaitingGroups, storeWaitingOrder,
    storedWaitingGroupMode, storedWaitingGroups, storedWaitingOrder, waitingDrawn, waitingGroupModesFor, waitingGroupsLabel,
    groupTitleMoreEl, waitingOnMoreEl, waitingGainEl, waitingGroupTagEl, waitingOrderLabel, waitingSideEl, waitingSinceEl, watchWaitingOrderStorage,
} from './waiting-order-ui.js';
import { browserGroupNote, browserNote } from '../research-browser.js';
import { uiModule } from './module.js';
import { LiveChangeItem, LiveFold, LiveSession, appendChangeText, el, ensureLiveTicker, liveDuration, liveSection, liveSession, nowHelpTopic, timeEl, appendAllHidden, noteWaitingShown, waitingChip, waitingNewChip, liveState, pausedText, appendWorkingHold, workingHoldEl, workingSavingEl, waitsOnUser, appendLinkedText, newWaitingView, waitingKindLabel, appendFollowNote, holdFollowNoteIn, markWaitingFocus, waitingWhyEl, overviewViewing, OverviewViewing, lightsGroup, markOverviewLit, researchSession, researchTableLive, researchHere } from './research-ui.js';
import { storyPeopleLinks, storyWaitingPeople } from './story-compare-ui.js';
import {
    WorkingLine, directionDragActive, directionGlyph, directionPersonIds, directionRedrawHeld, keepLineFocus, setQueueDirectionFilter, taskDirectionName, workingLineCount, workingLineGroups,
} from './research-directions-ui.js';
import { conflictValueSaid, researchValueText } from './person-research-ui.js';
import { shownName, fitNameHtml } from '../person-name.js';
import { isOpenHypothesis } from '../view-links.js';
import { focusQueueMoved, setQueueBranchFilter, waitBranchText, workingWhyText } from './research-offline-ui.js';
import { setQueueKindFilter } from './queue-kind-ui.js';
import { beginQueueSlots, endQueueSlots } from '../research-queue-pages.js';
import { KnowsKind, knowsKindChoice, knowsKindShows } from '../knows-kind.js';
import { knowsGroupOptions, knowsGroupShown, knowsGroupedRows, knowsGroups, type KnowsGroup, type KnowsGroupLine, type KnowsGroupOf } from '../knows-group.js';
import { personLineIds, researchLinesOf } from './table-view/table-research.js';
import { SettingsManager } from '../settings.js';
import { activeQueueSearch, clearQueueSearch } from './queue-search-ui.js';
import { overviewSearches, focusFirstSectionRow, type SectionSearch } from './section-search.js';
import { appendSearchOutcome, keepSheetOverKeyboard, mountSectionSearch, paintSearchChip, searchHitTag, searchSummaryEl } from './section-search-view.js';
import { fieldVisible, foldSearch2, idNumber, tokenize, type SearchDoc, type SearchHit } from '../section-search-match.js';
import { chipCount, searchIndex, searchSection, sectionPartOpen, toggleSectionPart, type SearchIndex } from '../section-search-filter.js';
import type { HypothesisListSearch } from './hypothesis-waiting-ui.js';
import { knowsSearchIndex, type KnowsIndex, type KnowsSearchRow } from '../knows-search.js';
import { inDeviceMode, deviceComputerName } from './device-mode-ui.js';
import { deviceProgressSeenAt, deviceProgressSends, noteDeviceProgressSeen, resetDeviceProgressSeen } from './device-progress-ui.js';
import { PREF_KEYS, PrefKey, SectionPref, prefKeyOfOverview, overviewKeyOf, sectionOrder, sectionPrefs, setSectionPref, topPrefs, topTileShown } from './live-section-prefs.js';
import { OverviewSourceKind, afterTurnOnKeys, skeletonLines } from '../research-overview-source.js';
import { sectionTitle } from './live-section-edit.js';
import { keepSectionControlFocus } from './live-section-edit-ui.js';
import { joinAnd } from '../strings.js';
import { canOpenWindows, openInNewWindow } from '../windows/window-open.js';
import { focusOverviewWindow, overviewChanged, overviewInWindow } from '../windows/overview-window.js';
import { agentMirror } from '../windows/agent-mirror.js';
import { greyOverviewActions } from './overview-window-states.js';
import { markShowcaseOff, sampleNoteEl, showcaseDayText, showcaseItemActions, researchLastWork } from './sample-why.js';
import { houseLabel } from '../houses.js';
import { importAskWho } from '../research-import-ask.js';
import { importAskDayText } from './waiting-import-ui.js';
import { arrangeOverviewColumns, beginOverviewColumns, noteOverviewSectionRows, nodesAfter, resetOverviewColumns } from './overview-columns-ui.js';

/**
 * "Load more" of the queue keeps the keyboard's focus over any redraw (a status, the own window's
 * snapshot): the overview is drawn anew, and the focus went to the page with the old button.
 */
function keepQueueLoadFocus(): () => void {
    const a = document.activeElement as HTMLElement | null;
    if (!a?.matches?.('#research-overview .live-queue-load')) return () => {};
    return () => {
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        document.querySelector<HTMLElement>('#research-overview .live-queue-load')?.focus({ preventScroll: true });
    };
}

/** The overview stays open over a reload / the next following (per device). */
/** The "did not switch on" sentences already said as an alert (tree + when it was said). */
const notStartedSaid = new Set<string>();
const OPEN_KEY = 'strom-live-overview-open';
/** The chip chosen in "Awaiting action" (per device). */
const WAITING_FILTER_KEY = 'strom-live-overview-waiting-filter';
/** Folded unless the user chose otherwise. */
const FOLDED_BY_DEFAULT = new Set(['queue', 'knows']);
/** Changes without a task are grouped by this long. */
const GROUP_MS = 15 * 60_000;
/** Rows shown in one group: a bulk command can save hundreds of changes at once. */
const GROUP_ROWS = 100;
/** How far back the timeline and its summary look. */
const RECENT_MS = 24 * 60 * 60_000;
/** Steps (groups) the timeline shows at most. */
const MAX_STEPS = 20;
/** Items whose browser note their group's heading says (spec 048 §11.2): their details leave it out. */
const browserNotedInHead = new Set<string>();

/**
 * A place's "Retry all with the agent" asked to confirm in its band (spec 089
 * §4): the place's key, and whether its write runs. One place at a time;
 * gone when the overview closes or the place no longer offers it.
 */
let retryConfirm: { key: string; saving: boolean } | null = null;

/** The element with this focus key in the overview, focused after a redraw. */
function focusOverviewKey(key: string): void {
    const t = document.querySelector<HTMLElement>(`#research-overview [data-focus-key="${CSS.escape(key)}"]`);
    if (t && !(t as HTMLButtonElement).disabled) t.focus({ preventScroll: true });
}

type Filter = 'all' | Exclude<LiveChangeKind, 'other'>;
type Mode = 'docked' | 'overlay' | 'sheet' | 'window';

let filter: Filter = 'all';
/** The changed people lit again because the filter changed (not asked anew). */
let relighting = false;
/** The kind shown in "What the research knows" while the overview is open (All again once it closes). */
let knowsKind: KnowsKind = 'all';
/** The groups of "What the research knows" folded or unfolded by hand (`${group}:${key}`), while the overview is open (spec 140). */
const knowsGroupsOpen = new Map<string, boolean>();
/** When the overview was opened (changes after it are marked new for a moment). */
let openedAt = 0;
/** Older change groups the user unfolded (by group key). */
const toggledGroups = new Set<string>();
/** Awaiting action's search index (spec 083 §1): built anew when its items change, not at each key. */
let waitingIndex: SearchIndex<LiveWaiting> | null = null;
/** What the research knows' search index (spec 083 §2): built anew when its rows say something else. */
let knowsIndex: KnowsIndex | null = null;
/** The card lit up by hovering a change row. */
let hovered: HTMLElement | null = null;

/**
 * The overview in a window of its own (spec 079 K3, §6): drawn there over the
 * main window's snapshot, its research actions asked of the main window
 * (null: the overview of the main window).
 */
export interface OverviewOwnWindow {
    /** The open tree's name (the head says "{tree} · Research overview"). */
    treeName(): string;
    /** A row hovered: its card lit up in the main window's tree (null: none). */
    hover(id: PersonId | null): void;
    /** The main window closed (§3.3): when what is shown was last current (null: it is live). */
    frozenAt?(): number | null;
    /** The strip under the head while the main window is closed (null: none). */
    strip?(): HTMLElement | null;
}
let ownWindow: OverviewOwnWindow | null = null;
/** The last card asked to light up from the window (asked once per row, not per mouse move). */
let ownWindowHovered: PersonId | null = null;

/** This window shows the overview alone (K3; null: the main window's overview). */
export function setOverviewOwnWindow(w: OverviewOwnWindow | null): void {
    ownWindow = w;
    ownWindowHovered = null;
}


/** A section's heading at the top of what scrolls it: the overview's body, or its column in the own window (spec 083 §4). */
function scrollHeadingToTop(body: HTMLElement, heading: HTMLElement): void {
    const scroller = heading.closest<HTMLElement>('.research-overview__col') ?? body;
    scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 6;
}

/** The overview's own window, a phone (≤ 640 px) and a phone held sideways (the full-screen sheet). */
export function overviewMode(): Mode {
    if (ownWindow) return 'window';
    if (window.matchMedia?.(MQ_PHONE_BAR).matches) return 'sheet';
    return window.innerWidth >= 1280 ? 'docked' : 'overlay';
}

function storedWaitingFilter(): WaitingFilter {
    try {
        const v = localStorage.getItem(WAITING_FILTER_KEY);
        return v && (WAITING_SECTIONS as readonly string[]).includes(v) ? v as WaitingFilter : 'all';
    } catch {
        return 'all';
    }
}

function storeWaitingFilter(f: WaitingFilter): void {
    try {
        if (f === 'all') localStorage.removeItem(WAITING_FILTER_KEY);
        else localStorage.setItem(WAITING_FILTER_KEY, f);
    } catch { /* not kept */ }
}

/** The choice an overview section follows (none: its default). */
function sectionPref(key: string): SectionPref | undefined {
    const k = prefKeyOfOverview(key);
    return k ? sectionPrefs()[k] : undefined;
}

/** Whether an overview section is folded by the choice (else by its default). */
function sectionCollapsed(key: string): boolean {
    const p = sectionPref(key);
    return p === 'collapsed' ? true : p === 'expanded' ? false : FOLDED_BY_DEFAULT.has(key);
}

/** How an overview section shows now without a temporary show (for the Customize panel editor). */
export function overviewSectionState(key: string): SectionPref {
    const p = sectionPref(key);
    return p ?? (FOLDED_BY_DEFAULT.has(key) ? 'collapsed' : 'expanded');
}

/**
 * The overview's first section with something in it, in the sections' order (spec 094 §4, 4.3: on a device's
 * phone only that one opens by itself). Now always has its line; without the bridge only what the tree holds.
 */
function firstSectionWithContent(s: LiveSession, fromTree: boolean): string | null {
    for (const k of sectionOrder()) {
        if (sectionPref(overviewKeyOf(k)) === 'hidden') continue;
        const has = k === 'working' ? !fromTree && s.working.length > 0
            : k === 'waiting' ? s.waiting.length > 0
                : k === 'directions' ? s.researches.length > 0
                    : k === 'changes' ? !fromTree && (s.changes.length > 0 || s.adds.length > 0)
                        : k === 'queue' ? !fromTree && !s.ended && s.queue.length > 0
                            : true;
        if (has) return overviewKeyOf(k);
    }
    return null;
}

/**
 * Now on a device while nothing is worked on (spec 094 §4, 4.10): "Nothing is being worked on now" and, when the
 * research said its last run, when it ended and on which line.
 */
function idleNowRow(s: LiveSession): HTMLElement {
    const L = strings.live;
    const li = el('li', 'live-empty research-overview__idle');
    li.appendChild(el('span', 'research-overview__idle-title', L.nothingAtWork));
    const last = researchLastWork(s, inShowcase());
    if (last) {
        const line = last.research ? s.researches.find(d => d.id === last.research)?.name ?? '' : '';
        // The showcase says its day (a snapshot: no hour of "today").
        const when = inShowcase() ? showcaseDayText(last.at) : formatLiveClock(last.at, researchNow(), getCurrentLanguage());
        li.appendChild(el('span', 'research-overview__idle-last', L.lastWorked(when, line)));
    }
    return li;
}

function personByRefn(refn: string | undefined): Person | null {
    if (!refn) return null;
    return Object.values(DataManager.getData().persons).find(p => p.refn === refn) ?? null;
}

const fullName = (p: Person): string => shownName(p);

function hhmm(ts: number): string {
    return new Date(ts).toLocaleTimeString(getCurrentLanguage(), { hour: 'numeric', minute: '2-digit' });
}

/** Light a card up while its change row is hovered (in this window, or in the overview's own window: K3). */
export function hoverCard(id: PersonId | null): void {
    if (ownWindow) {
        if (id === ownWindowHovered) return;
        ownWindowHovered = id;
        ownWindow.hover(id);
        return;
    }
    hovered?.classList.remove('overview-hover');
    hovered = id ? document.querySelector<HTMLElement>(`.person-card[data-id="${CSS.escape(id)}"]`) : null;
    hovered?.classList.add('overview-hover');
}

// ==================== AN ITEM'S ACTIONS, ANSWER AND IMAGES (spec 048 U6) ====================

/** One action of an item as drawn: a button that runs, a website in a new window, or a write through the bridge. */
interface ItemAction {
    key: string;
    label: string;
    /** A link into the research: the mark of its group by the map (`researchLinkMark`). Absent: it stays here or goes through the bridge, no mark. */
    mark?: ResearchActionMark;
    href?: string;
    run?: () => void;
    /** Written through the bridge (one click only). */
    write?: boolean;
    /** What goes with it, after its name and never wrapped apart ("· 2 images", spec 089 §3). */
    count?: string;
    /** Its write runs ("saving" in its row): no second click. */
    disabled?: boolean;
    /** The showcase (spec 143 K4.1): seen greyed with its mark, a click only says why. */
    off?: boolean;
}

/** The action "All images added" of an item whose count of images is not known (its `data-action`). */
const ALL_IMAGES = 'all-images';


/** Answer forms by tree and item: the open one (one at a time) and those kept over a redraw. */
const answerForms = new Map<string, WaitingAnswerForm>();
let answeringKey: string | null = null;
/** What the open form writes: an answer, or "All images added" (a count of images not known). */
let answeringMode: WaitingAnswerMode = 'answer';
/** Items whose answer met a task that waits for something else now (409 changed): the ochre note at the top. */
const answerChanged = new Set<string>();
/** The "More actions" menu open (the item's id) and how it is let go. */
let moreMenuFor: string | null = null;
let moreMenuCleanup: (() => void) | null = null;
/**
 * The focus key of the button whose choice menu (openWaitingChoice: the
 * order, the groups, Group of What the research knows) is open: a redraw
 * meanwhile draws that button anew still saying the menu is open.
 */
let choiceOpenFor: string | null = null;
/** After a redraw of the overview: the button of the open choice menu, drawn anew, says it is open. */
function keepChoiceOpen(): void {
    if (!choiceOpenFor) return;
    document.querySelector(`#research-overview [data-focus-key="${CSS.escape(choiceOpenFor)}"][aria-haspopup="menu"]`)
        ?.setAttribute('aria-expanded', 'true');
}

/** The answer form drawn last loses no focus to a redraw: the same field, the caret where it was. */
function keepAnswerFocus(): () => void {
    const a = document.activeElement;
    if (!(a instanceof HTMLTextAreaElement) || !a.closest('#research-overview .waiting-answer')) return () => {};
    const { selectionStart, selectionEnd, scrollTop } = a;
    return () => {
        if (!a.isConnected || document.activeElement === a) return;
        a.focus({ preventScroll: true });
        a.setSelectionRange(selectionStart, selectionEnd);
        a.scrollTop = scrollTop;
    };
}

/**
 * A control with a focus key (the hypotheses' boxes, "Select all", "Accept
 * proposals") keeps the focus over a redraw that rebuilt it: a status of the
 * research followed live draws the overview again at any moment.
 */
function keepKeyFocus(): () => void {
    const a = document.activeElement as HTMLElement | null;
    const key = a?.closest('#research-overview') ? a.dataset.focusKey : undefined;
    if (!a || !key) return () => {};
    return () => {
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        const target = document.querySelector<HTMLElement>(`#research-overview [data-focus-key="${CSS.escape(key)}"]`);
        if (target && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
    };
}

/** The open answer form closes (its draft stays). */
function closeAnswerForm(): void {
    if (!answeringKey) return;
    answerForms.get(answerFormKey(answeringKey, answeringMode))?.keepDraftNow();
    answerChanged.delete(answeringKey);
    answeringKey = null;
    answeringMode = 'answer';
}

/**
 * The website an item's "Open website ↗" leads to (spec 105 U4 §2): its host
 * beside the link (hidden on a phone) and in the link's name.
 */
function appendWaitingWebHost(link: HTMLElement, url: string): void {
    let host = '';
    try {
        host = new URL(url).host;
    } catch { /* no host said */ }
    if (!host) return;
    link.setAttribute('aria-label', strings.live.waitingWebHostAria(host));
    const span = el('span', 'research-overview__waiting-host', host);
    span.setAttribute('aria-hidden', 'true');
    link.after(span);
}

/** An item's action drawn by its weight: the main one filled, the next outlined, the rest as links. */
function waitingActionEl(a: ItemAction, weight: 'primary' | 'secondary' | 'link'): HTMLElement {
    const cls = `waiting-action waiting-action--${weight}`;
    if (a.href) {
        const web = el('a', `${cls} research-overview__waiting-web`, a.label);
        web.href = a.href;
        web.title = a.href;
        web.target = '_blank';
        web.rel = 'noopener noreferrer';
        web.dataset.action = a.key;
        return web;
    }
    const btn = el('button', `${cls} research-overview__waiting-action`);
    if (a.mark) setResearchActionLabel(btn, a.label, a.mark);
    else btn.textContent = a.label;
    if (a.count) {
        btn.classList.add('has-count');
        btn.append(' ', el('span', 'waiting-retry-count', a.count));
    }
    btn.type = 'button';
    btn.dataset.action = a.key;
    if (a.off) return markShowcaseOff(btn, a.mark ?? 'none', a.label);
    if (a.write) btn.dataset.write = 'bridge';
    if (a.disabled) btn.disabled = true;
    btn.onclick = (e) => {
        e.stopPropagation();
        if (a.write) {
            if (btn.disabled) return;
            btn.disabled = true;
        }
        a.run?.();
    };
    return btn;
}

interface ChangeGroup {
    /** What joins the run: the task, or the 15 minutes. */
    run: string;
    title: string;
    items: LiveChangeItem[];
}

/** Changes (newest first) in runs of the same task; without one, by 15 minutes. */
/** The changes of the last 24 hours: the overview is a preview, the research has the rest. */
function recentChanges(changes: readonly LiveChangeItem[], now = researchNow()): LiveChangeItem[] {
    return changes.filter(c => now - (Date.parse(c.at) || 0) < RECENT_MS);
}

/** The task a session line names ("N0123 closed: T0124: …", "N0124 session started on T0039"). */
const SESSION_TASK_RE = /^N\d+ (?:closed: |session started on )(T\d+)\b/;

function groupChanges(changes: readonly LiveChangeItem[]): ChangeGroup[] {
    const groups: ChangeGroup[] = [];
    // A task by its id, as the research titles it elsewhere in the history.
    const titles = new Map<string, string>();
    for (const c of changes) {
        const id = /^T\d+\b/.exec(c.task)?.[0];
        if (id && !titles.has(id)) titles.set(id, c.task);
    }
    for (const c of changes) {
        const ts = Date.parse(c.at);
        const bucket = Number.isFinite(ts) ? Math.floor(ts / GROUP_MS) * GROUP_MS : 0;
        // A session's own line without a task still belongs to the task it names.
        const named = c.task ? '' : SESSION_TASK_RE.exec(c.text)?.[1] ?? '';
        const task = c.task || (named ? titles.get(named) ?? named : '');
        const run = task ? `t:${task}` : `b:${bucket}`;
        const last = groups[groups.length - 1];
        if (last && last.run === run) {
            last.items.push(c);
            continue;
        }
        // Changes outside any task: the head's time span says when.
        const title = task || strings.live.otherChanges;
        groups.push({ run, title, items: [c] });
    }
    return groups;
}

/** The followed research, with its overview open on its tree (null: none). */
function followedOverview(): LiveSession | null {
    const s = liveSession();
    return s && !s.ended && s.overview && DataManager.getCurrentTreeId() === s.treeId ? s : null;
}

/** What the overview draws: the followed research's, else the open tree's viewed without following (null: neither). */
function drawnSession(): LiveSession | null {
    const followed = followedOverview();
    if (followed) return followed;
    const v = overviewViewing();
    return v && v.treeId === DataManager.getCurrentTreeId() ? v.session : null;
}


/** Stop of a run asked here: while the bridge writes it, done (the run finishing until the bridge says so), refused (its sentence). */
type RunStopNote = { state: 'stopping' } | { state: 'stopped' } | { state: 'failed'; text: string };
const runStopNotes = new Map<string, RunStopNote>();

/** What Now knows of a stop asked for the run (forgotten once the bridge says it finishes or it ended). */
function runStopNote(run: Pick<LiveRun, 'id'> & Partial<Pick<LiveRun, 'state'>>): RunStopNote | null {
    const note = runStopNotes.get(run.id) ?? null;
    if (note && note.state !== 'stopping' && (run.state === 'finishing' || run.state === 'ended')) {
        runStopNotes.delete(run.id);
        return null;
    }
    return note;
}

/** Now drawn again when the first run ended a moment ago is to go (RUN_ENDED_MS after its end). */
let runsEndedTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRunsEndedRedraw(runs: readonly LiveRun[], redraw: () => void): void {
    if (runsEndedTimer) clearTimeout(runsEndedTimer);
    runsEndedTimer = null;
    const ends = runs.filter(r => r.state === 'ended' && r.endedAt !== undefined).map(r => r.endedAt! + RUN_ENDED_MS);
    if (ends.length === 0) return;
    const wait = Math.max(0, Math.min(...ends) - Date.now()) + 50;
    runsEndedTimer = setTimeout(() => {
        runsEndedTimer = null;
        redraw();
    }, wait);
}

export const researchOverviewMethods = uiModule({
    /**
     * The overview opens: a research tree is open, followed or not, on any
     * screen (a phone's is a full-screen sheet; spec 057 §7.1).
     */
    canOpenResearchOverview(): boolean {
        return this.isFollowingActiveResearch() || this.activeResearchId() !== null;
    },

    /** ⤢ in the small panel: following a research, on a screen wider than a phone (the panel without following has none). */
    canExpandLivePanel(): boolean {
        const s = liveSession();
        return !!s && !s.ended && window.matchMedia?.('(max-width: 640px)').matches !== true;
    },

    /** Following the research of the tree on screen. */
    isFollowingActiveResearch(): boolean {
        const s = liveSession();
        return !!s && !s.ended && s.treeId === DataManager.getCurrentTreeId();
    },

    isResearchOverviewOpen(): boolean {
        return !!document.getElementById('research-overview');
    },

    /** The overview was open last time (a new following opens it again). */
    researchOverviewRemembered(): boolean {
        try {
            return localStorage.getItem(OPEN_KEY) === '1' && window.matchMedia?.('(max-width: 640px)').matches !== true;
        } catch {
            return false;
        }
    },

    /**
     * Open the overview: of the followed research, else of the open tree's
     * research without following (from its bridge, or the tree; spec 057 §7).
     * `showWaiting`: "Awaiting action" shown there expanded until it closes,
     * whatever its choice (the chip of a hidden or collapsed one), with the
     * focus on its heading.
     */
    openResearchOverview(opts: { showWaiting?: boolean } = {}): void {
        // The overview in its own window (spec 079 6g): that window comes to the front, none opens here.
        if (overviewInWindow()) {
            focusOverviewWindow();
            return;
        }
        const s = liveSession();
        if (s && !s.ended && s.treeId === DataManager.getCurrentTreeId()) {
            s.overview = true;
        } else if (!this.openOverviewViewing()) {
            return;
        }
        openedAt = Date.now();
        resetDeviceProgressSeen();
        if (overviewMode() !== 'sheet') {
            try { localStorage.setItem(OPEN_KEY, '1'); } catch { /* not kept */ }
        }
        if (opts.showWaiting) {
            this.showOverviewWaiting();
            return;
        }
        this.renderLivePanel();
        document.querySelector<HTMLElement>('#research-overview .research-overview__close')?.focus();
    },

    /**
     * "Search the queue…" of the small panel: the overview's Queue shown
     * unfolded until it closes (the choice stays), its heading at the top and
     * the caret in its search field.
     */
    openQueueSearch(): void {
        if (overviewInWindow()) {
            this.openResearchOverview();
            return;
        }
        if (!this.isResearchOverviewOpen()) this.openResearchOverview();
        if (!drawnSession()) return;
        this.unfoldOverviewSection('queue');
        this.renderLivePanel();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('[aria-controls="ov-sec-queue"]');
        if (body && heading) scrollHeadingToTop(body, heading);
        const input = activeQueueSearch()?.input;
        if (input?.isConnected) input.focus({ preventScroll: true });
        else heading?.focus({ preventScroll: true });
    },

    /**
     * "Research overview ›" under the queue's tasks in "Work on the queue": the overview (open
     * already when the dialog came from it) with its Queue unfolded, its heading at the top and focused.
     */
    showOverviewQueue(): void {
        if (overviewInWindow()) {
            this.openResearchOverview();
            return;
        }
        if (!this.isResearchOverviewOpen()) this.openResearchOverview();
        if (!drawnSession()) return;
        this.unfoldOverviewSection('queue');
        this.renderLivePanel();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('[aria-controls="ov-sec-queue"]');
        if (!body || !heading) return;
        scrollHeadingToTop(body, heading);
        heading.focus({ preventScroll: true });
    },

    /**
     * The overview's Queue narrowed to one kind of work (`queue.kind`; "Show in the queue" beside "Waiting for
     * verification"): every line and branch, no search, the kind's chip picked, the heading at the top and the
     * chip focused. The overview in its own window comes to the front as it is.
     */
    showOverviewQueueKind(kind: QueueTaskKind): void {
        if (overviewInWindow()) {
            this.openResearchOverview();
            return;
        }
        if (!this.isResearchOverviewOpen()) this.openResearchOverview();
        const s = drawnSession();
        if (!s) return;
        setQueueBranchFilter(s, null);
        setQueueDirectionFilter('all');
        clearQueueSearch(false);
        setQueueKindFilter(s, kind);
        this.unfoldOverviewSection('queue');
        this.renderLivePanel();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('[aria-controls="ov-sec-queue"]');
        if (!body || !heading) return;
        scrollHeadingToTop(body, heading);
        const chip = body.querySelector<HTMLElement>(`.research-overview__queue-kinds [data-task-kind="${kind}"]`);
        (chip ?? heading).focus({ preventScroll: true });
    },

    /** "Awaiting action" in the open overview, shown until it closes (the choice stays), in view and focused. */
    showOverviewWaiting(): void {
        const s = drawnSession();
        if (!s) return;
        s.overviewShown.add('waiting');
        // What came while it was out of sight opens as it would have.
        this.openWaitingItems(s, s.waiting.filter(w => s.waitingPendingOpen.has(w.id)));
        s.waitingPendingOpen.clear();
        this.renderLivePanel();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('[aria-controls="ov-sec-waiting"]');
        if (body && heading) {
            scrollHeadingToTop(body, heading);
            heading.focus({ preventScroll: true });
        }
    },

    /**
     * "At work ›" of the Queue heading (spec 052 §5): Now shown until the
     * overview closes (the choice stays), its heading at the top and the focus
     * on its first "Finish and stop" (else on the heading).
     */
    showOverviewNowFinish(): void {
        if (!drawnSession()) return;
        this.unfoldOverviewSection('now');
        this.renderLivePanel();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('[aria-controls="ov-sec-now"]');
        if (!body || !heading) return;
        scrollHeadingToTop(body, heading);
        const finish = body.querySelector<HTMLElement>('#ov-sec-now .research-overview__finish');
        if (finish) {
            finish.scrollIntoView?.({ block: 'nearest' });
            finish.focus({ preventScroll: true });
        } else heading.focus({ preventScroll: true });
    },

    /**
     * "In Now ›" of a direction's run (spec 126 U10 §1): Now shown, the run's
     * block (its `data-run`, else its direction's row) flashed and focused;
     * no block: Now's heading at the top as "At work ›" does.
     */
    showOverviewNowRun(runId: string, direction?: string): void {
        if (!drawnSession()) return;
        this.unfoldOverviewSection('now');
        this.renderLivePanel();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('[aria-controls="ov-sec-now"]');
        if (!body || !heading) return;
        scrollHeadingToTop(body, heading);
        const sec = body.querySelector<HTMLElement>('#ov-sec-now');
        const block = sec?.querySelector<HTMLElement>(`[data-run="${CSS.escape(runId)}"]`)
            ?? (direction ? sec?.querySelector<HTMLElement>(`[data-direction="${CSS.escape(direction)}"]`) : null)
            ?? null;
        if (!block) {
            heading.focus({ preventScroll: true });
            return;
        }
        block.scrollIntoView?.({ block: 'nearest' });
        block.classList.remove('is-flash');
        void block.offsetWidth;
        block.classList.add('is-flash');
        window.setTimeout(() => block.classList.remove('is-flash'), 1600);
        if (!block.hasAttribute('tabindex')) block.tabIndex = -1;
        block.focus({ preventScroll: true });
    },

    /**
     * "Settings ›" beside the most runs at once reached (spec 126 U10 §1):
     * Research for this tree at that field (the phone's sheet goes first, as
     * for Books).
     */
    openRunsSettings(): void {
        const treeId = drawnSession()?.treeId ?? liveSession()?.treeId ?? overviewViewing()?.treeId;
        if (!treeId) return;
        if (document.querySelector('#research-overview.research-overview--sheet')) this.closeResearchOverview();
        void this.showResearchTreeSettings(treeId, { focus: 'runs-max' });
    },

    /** ⤡ (and Escape): back to the small panel; following goes on. Without following: the overview closes. */
    closeResearchOverview(): void {
        // The overview's own window has no ⤡: it closes as a window.
        if (ownWindow) return;
        const s = drawnSession();
        if (!s) return;
        s.overview = false;
        // What was unfolded, opened and new in "Awaiting action" lasts while the overview is open;
        // so do the sections shown whatever their choice.
        s.waitingView = newWaitingView();
        s.waitingScope = null;
        s.overviewShown.clear();
        // The sections' searches and the kind shown in "What the research knows" last while the overview is open.
        overviewSearches.reset();
        knowsKind = 'all';
        knowsGroupsOpen.clear();
        retryConfirm = null;
        if (s !== liveSession()) this.closeOverviewViewing();
        closeAnswerForm();
        clearImagesSeen();
        clearOverviewImages();
        this.closeWaitingAnswerSheet();
        this.closeWaitingMoreMenu();
        if (overviewMode() !== 'sheet') {
            try { localStorage.setItem(OPEN_KEY, '0'); } catch { /* not kept */ }
        }
        hoverCard(null);
        this.renderLivePanel();
    },

    /** Another view chosen: the overview open without following closes as by its ⤡ (a followed research's stays). */
    researchOverviewViewSwitched(): void {
        if (!this.isResearchOverviewOpen() || followedOverview()) return;
        if (overviewViewing()) this.closeResearchOverview();
    },

    /** Narrow the tree's area beside the docked overview, keeping the view's middle in the middle. */
    setResearchOverviewDocked(on: boolean): void {
        if (document.body.classList.contains('overview-docked') === on) return;
        const { width, height } = ZoomPan.getViewportSize();
        const t = ZoomPan.getTransform();
        const wx = (width / 2 - t.tx) / t.scale;
        const wy = (height / 2 - t.ty) / t.scale;
        document.body.classList.toggle('overview-docked', on);
        if (width > 0) ZoomPan.centerOnWorldPoint(wx, wy);
    },

    /** Draw (or remove) the overview. Called with every panel redraw. */
    renderResearchOverview(): void {
        // What the overview shows may have changed: an overview in its own window hears it (K3).
        overviewChanged();
        // A direction dragged: its row stays under the pointer; the redraw comes when it lands.
        if (directionDragActive()) {
            directionRedrawHeld();
            return;
        }
        queueMicrotask(keepLineFocus());
        queueMicrotask(keepAnswerFocus());
        queueMicrotask(keepKeyFocus());
        queueMicrotask(keepChoiceOpen);
        queueMicrotask(keepSectionControlFocus());
        queueMicrotask(keepQueueLoadFocus());
        // A task just moved by "Do next": focused once drawn first.
        queueMicrotask(focusQueueMoved);
        // The followed research's, else the open tree's viewed without following (spec 057 §7.2).
        const followed = followedOverview();
        const viewed = followed ? null : overviewViewing();
        // The overview in its own window (6g): none is drawn here.
        const inWindow = overviewInWindow();
        // Another window of the app (spec 097 K2.5): it mirrors the main window's session, the
        // overview's flag with it, but shows the research through its strip only, never the overview.
        const s = inWindow || agentMirror() ? null : drawnSession();
        const on = !!s;
        const source: OverviewSourceKind = followed ? 'live' : viewed?.kind ?? 'tree';
        // "More actions" belongs to the open detail: gone with it.
        if (moreMenuFor && (!on || s?.waitingView.detail !== moreMenuFor)) this.closeWaitingMoreMenu();
        let root = document.getElementById('research-overview');
        if (!on || !s) {
            // Nothing shows the queue's pages: their reads stop (the overview's own window asks for its own).
            if (!inWindow) {
                beginQueueSlots();
                endQueueSlots();
            }
            if (root) {
                root.remove();
                hoverCard(null);
                overviewSearches.reset();
                resetOverviewColumns();
                knowsKind = 'all';
                knowsGroupsOpen.clear();
                retryConfirm = null;
            }
            keepSheetOverKeyboard(null);
            this.setResearchOverviewDocked(false);
            this.syncLiveSectionEditor();
            return;
        }
        const L = strings.live;
        const r = strings.research;
        const mode = overviewMode();
        if (!root) {
            root = el('aside', 'research-overview');
            root.id = 'research-overview';
            // Delegated on the root, which outlives every redraw: a row rebuilt
            // under the pointer never gets its mouseleave, and a per-row
            // handler left that card lit up for good.
            root.addEventListener('mouseover', (e) => {
                const row = (e.target as HTMLElement).closest<HTMLElement>('.research-overview__row.has-person, .research-overview__waiting-item.has-person');
                hoverCard((row?.dataset.person as PersonId | undefined) ?? null);
            });
            root.addEventListener('mouseleave', () => hoverCard(null));
            holdFollowNoteIn(root, 'overview');
            document.body.appendChild(root);
        }
        // Where the body (or each of the own window's columns) was scrolled, read before the class goes:
        // without it the columns lose their height and with it their scroll. The sections' rows are said anew.
        const scroller = root.querySelector<HTMLElement>('.research-overview__body');
        const scrollTop = scroller?.scrollTop ?? 0;
        const colScroll = mode === 'window' ? beginOverviewColumns(root) : null;
        // The own window's columns by its width (spec 083 §4) are set once the sections are drawn.
        root.className = `research-overview research-overview--${mode}`;
        // A phone's sheet ends where the keyboard begins: what a section's search found stays in sight (spec 083 §3).
        keepSheetOverKeyboard(mode === 'sheet' ? root : null);
        root.dataset.form = `${mode === 'sheet'}:${window.innerWidth >= 1280}`;
        if (mode === 'window') {
            root.setAttribute('role', 'main');
            root.removeAttribute('aria-modal');
        } else if (mode === 'sheet') {
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
        } else {
            root.setAttribute('role', 'complementary');
            root.removeAttribute('aria-modal');
        }
        root.setAttribute('aria-label', L.overviewTitle);
        // The sections' search fields are drawn again: the focus and caret they had go back to them.
        overviewSearches.noteFocus();
        root.replaceChildren();
        // The queue's pages this drawing shows (a branch unfolded, the queue's filter); the rest is let go at its end.
        beginQueueSlots();

        // Head: state dot, title over a line with the research's name and
        // Stop, then the follow switch and ⤡ / ×. Stop on the name's line
        // keeps the title whole in the 400px overlay and on a phone.
        // The own window has a head of its own (§6): no ⤡, ×, ⧉ or "Follow in".
        const head = mode === 'window' ? this.overviewWindowHead(s, source, !!ownWindow?.frozenAt?.()) : el('div', 'research-overview__head');
        // The main window closed (§3.3): what is shown is frozen as of then, every action greyed.
        const frozenAt = mode === 'window' ? ownWindow?.frozenAt?.() ?? null : null;
        if (mode === 'window') {
            root.appendChild(head);
            const closedStrip = ownWindow?.strip?.() ?? null;
            if (closedStrip) root.appendChild(closedStrip);
            // Without following, the bridge answering: what "Follow live" does, under the head (6b).
            // A device of the home network (spec 094 §4, 9): its tree is the research's already; following is an option of the menu.
            if (source === 'bridge' && !this.activeResearchAgentless() && frozenAt === null && !inDeviceMode() && !inShowcase()) {
                root.appendChild(el('p', 'research-overview__window-note', L.followNote));
            }
        } else {
            head.appendChild(el('span', `live-dot live-dot--still${source === 'tree' ? ' live-dot--off' : ''}`));
            const titles = el('div', 'research-overview__titles');
            const sub = el('div', 'research-overview__sub');
            // A long name is cut short beside Stop and the head's buttons: whole on hover.
            sub.appendChild(el('span', 'research-overview__name', s.name)).title = s.name;
            titles.append(el('h2', 'research-overview__title', L.overviewTitle), sub);
            head.appendChild(titles);
            const close = el('button', 'research-overview__close', mode === 'sheet' ? '×' : '⤡');
            close.type = 'button';
            close.setAttribute('aria-label', mode === 'sheet' ? r.close : L.closeOverview);
            close.title = mode === 'sheet' ? r.close : L.closeOverview;
            close.onclick = () => this.closeResearchOverview();
            // Following: Stop and the follow switch (the full-screen sheet covers the tree: no switch there).
            if (source === 'live') {
                const stop = el('button', 'live-panel-action', r.stop);
                stop.type = 'button';
                stop.onclick = () => this.stopLiveFollow();
                sub.append(stop);
            }
            const follow = mode === 'sheet' || source !== 'live' ? null : this.liveFollowButton('overview');
            // "Awaiting action" hidden: its count stays in sight; a click shows it here until the overview closes.
            if (sectionPref('waiting') === 'hidden' && s.waiting.length > 0) {
                const chip = waitingChip(s, () => this.showOverviewWaiting());
                if (chip) sub.append(chip);
            }
            if (follow) head.appendChild(follow);
            // Customize panel: after the follow switch, before ⤡ / ×.
            head.appendChild(this.liveSectionMoreButton('research-overview__more', 'overview'));
            // ⧉ the overview in a window of its own (spec 079 §6, K3): beside ⋯, not on a phone or a touch screen.
            if (mode !== 'sheet' && canOpenWindows()) head.appendChild(this.overviewWindowButton());
            head.appendChild(close);
            root.appendChild(head);
            // Without following, the bridge answering: "Follow live" and what it does, under the head (§7.3).
            // Not on a device of the home network (spec 094 §4, 9): its tree is the research's already, editable; following
            // live stays an option of the menu (read-only meanwhile, with the follow panel of today).
            // The showcase (spec 143 K4.1): nothing to follow, its research is a snapshot.
            if (source === 'bridge' && viewed && !inDeviceMode() && !inShowcase()) {
                const strip = this.overviewFollowStrip(viewed);
                if (strip) root.appendChild(strip);
            }
            // Following on: "Follow in: Family / Fan / Map" under the head (in the phone's sheet too: a phone
            // held sideways keeps the strip to one row and has it only here).
            const followView = source === 'live' ? this.liveFollowViewRow('overview') : null;
            if (followView) root.appendChild(followView);
        }
        // The showcase (spec 143 K4.1): as of when and view only, with the command of the full research, under the head.
        if (inShowcase()) root.appendChild(sampleNoteEl({ asOf: true }));

        const body = el('div', 'research-overview__body');
        root.appendChild(body);
        // Which tree is followed now (after a switch), first.
        if (source === 'live') appendFollowNote(body, s);
        this.appendOverviewSummary(body, s, mode, viewed);
        // The own window without the bridge (§6 state 3): "not running · showing what is in the tree" and Turn on.
        if (mode === 'window' && viewed?.kind === 'tree' && researchHere()) this.appendOverviewOffFrame(body, viewed);
        if (s.update) this.appendUpdateStrip(body, s.update.version, s.busy);

        // A section hidden by the choice is not drawn, unless shown until the overview closes
        // (expanded, its heading says so and does not fold). A click on a heading is a lasting choice.
        const shown = (key: string): boolean => sectionPref(key) !== 'hidden' || s.overviewShown.has(key);
        const frozenWhen = frozenAt !== null ? L.asOf(formatLiveClock(frozenAt, researchNow(), getCurrentLanguage())) : '';
        const fold = (key: string): LiveFold => {
            let f = foldOf(key);
            // Frozen: each section says as of when (Awaiting action without the bridge says its own time).
            if (frozenWhen && !(key === 'waiting' && source === 'tree')) {
                f = { ...f, extra: [...(f.extra ?? []), el('span', 'research-overview__as-of research-overview__frozen-at', frozenWhen)] };
            }
            const pk = prefKeyOfOverview(key);
            return pk ? { ...f, menu: (h, at) => this.openLiveSectionMenu(h, pk, 'overview', at) } : f;
        };
        // A device's phone (spec 094 §4, 4.3): a section without a choice of its own opens only when it is the first with content.
        const firstOpen = mode === 'sheet' && inDeviceMode() ? firstSectionWithContent(s, source === 'tree') : null;
        const foldOf = (key: string): LiveFold => {
            const id = `ov-sec-${key}`;
            const pk = prefKeyOfOverview(key);
            if (sectionPref(key) === 'hidden') {
                const tag = el('span', 'live-section__tag', L.hiddenTag);
                const note = el('p', 'live-section__once');
                note.appendChild(el('span', '', L.shownOnce));
                const edit = note.appendChild(el('button', 'link-button live-section__once-edit', L.editPanel));
                edit.type = 'button';
                edit.onclick = () => this.openLiveSectionEditor(edit, 'overview');
                return { id, collapsed: false, locked: true, extra: [tag], note, onToggle: () => {} };
            }
            if (s.overviewShown.has(key) && sectionCollapsed(key)) {
                // Shown for a while: folding it ends that and keeps the choice.
                return { id, collapsed: false, onToggle: () => {
                    s.overviewShown.delete(key);
                    if (pk) setSectionPref(pk, 'collapsed');
                    this.renderResearchOverview();
                } };
            }
            const collapsed = firstOpen !== null && sectionPref(key) === undefined ? key !== firstOpen : sectionCollapsed(key);
            return { id, collapsed, onToggle: () => {
                if (pk) setSectionPref(pk, collapsed ? 'expanded' : 'collapsed');
            } };
        };

        // Every section hidden: a word and the way back instead (a section shown for a while still comes).
        if (PREF_KEYS.every(k => sectionPrefs()[k] === 'hidden')) {
            appendAllHidden(body, (anchor) => this.openLiveSectionEditor(anchor, 'overview'));
        }
        // Without the bridge only what the tree holds: the agent's work comes once the research runs.
        const fromTree = source === 'tree';
        const host = body;
        const draw: Record<PrefKey, () => void> = {
            working: () => {
                if (fromTree) return;
                if (shown('now')) this.appendOverviewNow(host, s, fold('now'), mode);
            },
            waiting: () => {
                // Nothing waits: no section, unless the research offers books to download (spec 105 §3, 5i).
                if ((s.waiting.length === 0 && !(booksOn(s) && urgentBooks(s.books).length > 0)) || !shown('waiting')) return;
                if (fromTree) {
                    this.appendOverviewWaitingAsOf(host, s, fold('waiting'), mode, viewed?.waitingAt ?? 0);
                    return;
                }
                const f = fold('waiting');
                // What was not seen yet keeps its "new" tag while the overview is open (spec 083 K5.3).
                noteWaitingNew(s.treeId, s.waiting, s.waitingView.tagged);
                // Collapsed: "N new" beside the title; expanded: what is to do now is seen.
                if (f.collapsed) {
                    const chip = waitingNewChip(s);
                    if (chip) f.extra = [...(f.extra ?? []), chip];
                } else {
                    noteWaitingShown(s);
                }
                this.appendOverviewWaiting(host, s, f, mode);
            },
            directions: () => {
                if (!shown('directions')) return;
                if (fromTree) this.appendOverviewSkeletonLines(host, fold('directions'));
                else this.appendOverviewDirections(host, s, fold('directions'), mode, shown('now'));
            },
            changes: () => {
                if (!fromTree && shown('timeline')) this.appendOverviewTimeline(host, s, fold('timeline'), mode);
            },
            queue: () => {
                if (!fromTree && !s.ended && shown('queue')) this.appendQueueSection(host, s, fold('queue'), 20, L.queueTitle, true);
            },
            knows: () => {
                if (shown('knows')) this.appendOverviewKnows(host, fold('knows'), mode, s.treeId);
            },
        };
        // In the sections' order (one for the overview and the panel); the own window notes what each drew for its columns.
        const drawnSections: { key: PrefKey; nodes: ChildNode[] }[] = [];
        for (const key of sectionOrder()) {
            const mark = body.lastChild;
            draw[key]();
            const nodes = colScroll ? nodesAfter(body, mark) : [];
            if (nodes.length > 0) drawnSections.push({ key, nodes });
        }
        // The research not running (on a computer): one line names what comes once it runs (not on a phone,
        // whose state says the agent's work is seen on the computer; none when all of it is hidden).
        if (fromTree && researchHere()) {
            const names = afterTurnOnKeys(sectionOrder(), sectionPrefs()).map(k => sectionTitle('overview', k));
            if (names.length > 0) body.appendChild(el('p', 'research-overview__after-on', L.afterTurnOn(joinAnd(getCurrentLanguage(), names))));
        }
        this.appendOverviewFoot(root, s, mode);
        // The own window: what the main window's tree lights now said at its button (the docked overview sits beside the pill);
        // nothing lit once the main window is closed (its tree with it).
        if (mode === 'window') markOverviewLit(root, frozenAt !== null ? null : this.evidenceHighlightNow());
        // The own window: every action greyed while the main window is closed, the answers while the research is off.
        if (mode === 'window') greyOverviewActions(root, frozenAt !== null ? 'all' : source === 'tree' ? 'answers' : null);
        endQueueSlots();
        // The own window: one, two or three columns by its width, each scrolled as before.
        if (colScroll) arrangeOverviewColumns(root, body, drawnSections, colScroll);
        else body.scrollTop = scrollTop;

        this.setResearchOverviewDocked(mode === 'docked');
        ensureLiveTicker();
        this.syncLiveSectionEditor();
    },

    /**
     * The summary strip: state, what came while watching (the last 24 hours), this month. Without
     * following (`viewed`): the bridge's state with when it last answered; without the bridge the
     * state alone ("not running · Turn on", on a phone "from the tree only").
     */
    appendOverviewSummary(body: HTMLElement, s: LiveSession, mode: Mode, viewed: OverviewViewing | null = null): void {
        const L = strings.live;
        const data = DataManager.getData();
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const sources = Object.keys(data.sources ?? {}).length;
        const strip = el('div', 'research-overview__summary');
        // What the top shows: the parts of the tiles (the cost only when switched on).
        const top = topPrefs();
        const cell = (label: string, value: HTMLElement | string, sub: HTMLElement | string | null, cls = '', title = ''): void => {
            const c = el('div', `research-overview__cell${cls ? ` ${cls}` : ''}`);
            const valueEl = typeof value === 'string' ? el('div', 'research-overview__cell-value', value) : value;
            c.append(el('div', 'research-overview__cell-label', label), valueEl);
            if (sub !== null) {
                const subEl = typeof sub === 'string' ? el('div', 'research-overview__cell-sub', sub) : sub;
                // One line; the whole text (and the research version) on hover.
                subEl.title = title || subEl.textContent || '';
                c.appendChild(subEl);
            }
            strip.appendChild(c);
        };
        // A tile with one part: that part is its value, no line under it.
        const dayCell = (label: string, persons: string, sources: string): void => {
            if (!topTileShown(top, 'day')) return;
            const p = top['day.persons'];
            const q = top['day.sources'];
            if (p && q) cell(label, persons, sources);
            else cell(label, p ? persons : sources, null);
        };
        if (viewed?.kind === 'tree') {
            this.appendOverviewStateOff(strip, viewed);
            strip.classList.add('research-overview__summary--n1');
            body.appendChild(strip);
            return;
        }
        const { label: state, cls: stateCls } = liveState(s);
        // When the research last changed (its own time; else the last change
        // seen; unknown: nothing). The research version (commit) on hover.
        const lastIso = s.headAt || s.changes[0]?.at || '';
        // Without following: when the bridge last answered (its data come with the regular ask).
        // The showcase's snapshot: its research's last change (as of its own time), never when the shim answered.
        const lastEl = viewed && !inShowcase() ? timeEl(new Date(viewed.refreshedAt || Date.now()).toISOString(), 'refreshed') : timeEl(lastIso, 'lastchange');
        lastEl?.classList.add('research-overview__cell-sub');
        const hover = s.head ? L.versionTitle(s.head.slice(0, 7)) : '';
        // Paused: when it goes on (and why, on hover) says more than the last change.
        const paused = stateCls === 'is-paused' ? s.working.find(w => w.paused) : undefined;
        const resumes = paused ? Date.parse(paused.paused!.until) : NaN;
        // Two or more runs side by side (spec 126 U10 §3): "3 agents working", under it those waiting (runsWaitingText).
        const runs = runLinesOn(s.features) && stateCls !== 'is-lost' ? liveRuns(s).filter(r => r.state !== 'ended') : [];
        if (runs.length >= 2) {
            const sub = runsWaitingText(runs) ?? lastEl ?? '';
            cell(L.state, L.stateAgents(runs.length), sub, 'is-working', [lastEl?.textContent ?? '', hover].filter(Boolean).join(' · '));
        } else if (paused && Number.isFinite(resumes)) {
            // A run waiting for an archive gives up then rather than resumes (spec 127): its own sentence.
            cell(L.state, state, paused.waits ? waitsText(paused) : L.pausedUntil(formatLiveClock(resumes, researchNow(), getCurrentLanguage())), stateCls,
                [pausedText(paused), lastEl?.textContent ?? '', hover].filter(Boolean).join(' · '));
        } else if (stateCls === 'is-lost') {
            cell(L.state, state, strings.research.reconnectingShort, stateCls, [lastEl?.textContent ?? '', hover].filter(Boolean).join(' · '));
        } else {
            cell(L.state, state, lastEl ?? '', stateCls, [paused ? pausedText(paused) : '', lastEl?.textContent ?? '', hover].filter(Boolean).join(' · '));
        }
        if (s.logged || viewed) {
            // What the research added in the last 24 hours: the bridge's own count
            // (and what came after it), else from its history.
            const added = recentAddsCount(s.recent, s.adds, researchNow(), RECENT_MS);
            dayCell(L.last24h, L.plusPersons(added.persons), L.plusSourcesToday(added.sources));
        } else {
            dayCell(L.sinceWatching, L.plusPersons(Math.max(0, persons - s.startPersons)),
                L.plusSources(Math.max(0, sources - s.startSources), hhmm(s.startedAt)));
        }
        if (s.spend && mode !== 'sheet' && topTileShown(top, 'month')) {
            const currency = s.spend.currency;
            const money = (n: number): string => {
                try {
                    return new Intl.NumberFormat(getCurrentLanguage(), { style: 'currency', currency }).format(n);
                } catch {
                    return `${n.toFixed(2)} ${currency}`;
                }
            };
            const price = top['month.price'];
            const count = s.spend.sessions;
            const url = this.activeResearchLink('sessions');
            // The sessions: a link into the research (with its mark), else plain text.
            const sessionsEl = (cls: string): HTMLElement => {
                if (!url) return el('div', cls, L.sessions(count));
                const btn = setResearchActionLabel(el('button', `link-button ${cls}`), L.sessions(count), researchLinkMark('sessions'));
                btn.type = 'button';
                btn.onclick = () => this.launchResearchLink(url);
                return btn;
            };
            if (!price) {
                // Without the cost: the sessions are the value; no amount anywhere (nor on hover).
                cell(L.thisMonth, sessionsEl('research-overview__cell-value'), null);
            } else {
                const amount = money(s.spend.amount);
                cell(L.thisMonth, amount, top['month.sessions'] ? sessionsEl('research-overview__cell-sub') : null);
            }
            // Of it the scan readers (a bridge that counts them, when they cost anything): a part of the cost.
            if (price && s.spend.readers) {
                const readers = el('div', 'research-overview__cell-sub research-overview__readers', L.scanReaders(money(s.spend.readers)));
                readers.title = readers.textContent ?? '';
                strip.lastElementChild?.appendChild(readers);
            }
        }
        // The tiles share the row equally (3 / 2); the state alone takes it whole.
        const n = Math.min(3, strip.childElementCount);
        for (const k of [1, 2, 3]) strip.classList.toggle(`research-overview__summary--n${k}`, k === n);
        body.appendChild(strip);
    },

    /**
     * The state without the bridge, the strip's only tile: "The research is not running" with
     * Turn on (spec 064: the bridge without a window or a terminal), or the command where the
     * research cannot take that; a phone, which never asks the bridge: "From the tree only".
     */
    appendOverviewStateOff(strip: HTMLElement, v: OverviewViewing): void {
        const L = strings.live;
        const c = strip.appendChild(el('div', 'research-overview__cell is-off'));
        c.appendChild(el('div', 'research-overview__cell-label', L.state));
        // A device of the home network asks the bridge through the gateway: without it its computer is not reachable (spec 094 §4).
        if (inDeviceMode()) {
            c.appendChild(el('div', 'research-overview__cell-value', strings.device.downShort(deviceComputerName())));
            return;
        }
        if (!researchHere()) {
            c.append(el('div', 'research-overview__cell-value', L.phoneTreeOnly), el('div', 'research-overview__cell-sub research-overview__why-off', L.phoneWhy));
            return;
        }
        c.appendChild(el('div', 'research-overview__cell-value', L.notRunning));
        // The own window says Turn on in its frame under the tiles (appendOverviewOffFrame).
        if (ownWindow) return;
        this.appendOverviewTurnOn(c, v.treeId, 'link-button research-overview__turn-on');
    },

    /**
     * Turn on (the research switched on by the quiet link, never off), "Switching on…" while it is on its way;
     * no answer within ~10 s: "The research did not switch on", Open research, Try again and the command
     * (1126); where the research cannot take the link, the command only.
     */
    appendOverviewTurnOn(into: HTMLElement, treeId: string, cls: string): void {
        const state = this.researchLiveState(treeId);
        const turnOn = (): void => { void this.startResearchLive(treeId, { limitMs: OVERVIEW_START_MS }); };
        const failed = state && !state.pending && !state.on && state.note?.notStarted ? state.note : null;
        if (failed) {
            const box = into.appendChild(el('div', 'research-overview__not-started'));
            // Said once (a redraw draws it again without the alert).
            const said = `${treeId} ${failed.at ?? ''}`;
            if (!notStartedSaid.has(said)) {
                notStartedSaid.add(said);
                box.setAttribute('role', 'alert');
            }
            box.appendChild(el('span', 'research-overview__not-started-text', strings.researchLive.notStarted));
            const row = box.appendChild(el('span', 'research-overview__not-started-acts'));
            const open = this.activeResearchLink('open');
            if (open) {
                const btn = setResearchActionLabel(el('button', 'link-button research-overview__open-instead'), strings.research.openResearch, researchLinkMark('open'));
                btn.type = 'button';
                btn.onclick = () => { void this.launchResearchLink(open, 'terminal', btn); };
                row.appendChild(btn);
            }
            const retry = el('button', 'link-button research-overview__retry', strings.busy.retry);
            retry.type = 'button';
            retry.onclick = turnOn;
            row.appendChild(retry);
            const how = box.appendChild(el('p', 'research-live-note research-overview__not-started-how'));
            how.append(el('span', undefined, strings.researchLive.startHow), ' ', commandLine(failed.command ?? 'strom live start', cmd => this.copyResearchLiveCommand(cmd)));
            return;
        }
        if (state?.canStart || state?.pending === 'starting') {
            const starting = state.pending === 'starting';
            const btn = el('button', cls, starting ? strings.researchLive.starting : strings.live.turnOn);
            btn.type = 'button';
            if (starting) {
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
            }
            btn.onclick = turnOn;
            into.appendChild(btn);
        } else {
            into.appendChild(this.researchLiveStartHow());
        }
    },

    /**
     * The own window without the bridge (§6 state 3): a frame under the tiles,
     * "The research is not running · showing what is in the tree" and Turn on
     * (asked of the main window; the bridge without a terminal, so no mark),
     * or the command where the research cannot take that.
     */
    appendOverviewOffFrame(body: HTMLElement, v: OverviewViewing): void {
        const L = strings.live;
        const frame = body.appendChild(el('div', 'research-overview__off-frame'));
        frame.setAttribute('role', 'status');
        frame.appendChild(el('span', 'research-overview__off-text', `${L.notRunning} · ${strings.win.overviewOffNote}`));
        this.appendOverviewTurnOn(frame, v.treeId, 'research-overview__turn-on research-overview__turn-on--frame');
    },

    /**
     * The strip under the head without following, the bridge answering
     * (spec 057 §7.3): what "Follow live" does and the button; an agent who
     * began meanwhile is said first and the button filled — nothing switches
     * by itself.
     */
    overviewFollowStrip(v: OverviewViewing): HTMLElement | null {
        // An archive (or a research waiting for its agent) has nobody to follow.
        if (this.activeResearchAgentless()) return null;
        const L = strings.live;
        const strip = el('div', `research-overview__follow${v.agentStarted ? ' is-agent' : ''}`);
        const text = strip.appendChild(el('div', 'research-overview__follow-text'));
        if (v.agentStarted) {
            const said = text.appendChild(el('p', 'research-overview__agent-started'));
            said.setAttribute('role', 'status');
            said.appendChild(el('span', 'research-overview__agent-dot')).setAttribute('aria-hidden', 'true');
            said.appendChild(el('span', undefined, L.agentStarted));
        }
        text.appendChild(el('p', 'research-overview__follow-note', L.followNote));
        const btn = el('button', `research-overview__follow-live${v.agentStarted ? ' is-filled' : ''}`, strings.research.followLive);
        btn.type = 'button';
        // Found again when the overview is drawn anew while following starts: the state stays on it (§1.2).
        btn.dataset.action = 'follow-live-strip';
        btn.onclick = () => { void this.startFollowLive('overview', undefined, btn); };
        strip.appendChild(btn);
        return strip;
    },

    /** "Awaiting action" without the bridge: the list said last on this device, with when ("as of …"). */
    appendOverviewWaitingAsOf(body: HTMLElement, s: LiveSession, fold: LiveFold, mode: Mode, at: number): void {
        const when = at ? strings.live.asOf(new Date(at).toLocaleString(getCurrentLanguage(), {
            day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
        })) : '';
        const f = when && fold.collapsed ? { ...fold, extra: [...(fold.extra ?? []), el('span', 'research-overview__as-of', when)] } : fold;
        this.appendOverviewWaiting(body, s, f, mode);
        if (when && !fold.collapsed) body.querySelector('#ov-sec-waiting')?.appendChild(el('p', 'research-overview__as-of', when));
    },

    /** The lines as the tree's file says them (the bridge does not answer): each name with its people, nothing of the work. */
    appendOverviewSkeletonLines(body: HTMLElement, fold: LiveFold): void {
        const lines = skeletonLines(DataManager.getData());
        if (lines.length === 0) return;
        const host = liveSection(body, { ...fold, title: strings.live.dirTitleEmpty });
        host.classList.add('research-directions', 'research-directions--skeleton');
        const list = el('ul', 'live-panel-list research-overview__lines');
        for (const l of lines) {
            const li = el('li', 'research-overview__line');
            li.dataset.direction = l.id;
            li.append(el('span', 'research-overview__line-name', l.name), el('small', 'research-overview__line-meta', strings.treeManager.persons(l.persons)));
            list.appendChild(li);
        }
        host.appendChild(list);
    },

    /**
     * The scope's chip over "Awaiting action" (spec 150): "Direction: … ✕" / "Person: … ✕", pressed; a click drops it.
     * Nothing of it waits now: a quiet line under it says so.
     */
    waitingScopeChip(scope: WaitingScope, none: boolean): HTMLElement {
        const L = strings.live;
        const box = el('div', 'research-overview__waiting-scope');
        const chip = el('button', 'research-overview__filter sel-opt research-overview__scope-chip');
        chip.type = 'button';
        chip.dataset.scope = scope.kind;
        chip.setAttribute('aria-pressed', 'true');
        const text = scope.kind === 'line' ? L.waitingScopeLine(scope.name) : L.waitingScopePerson(scope.name);
        chip.appendChild(el('span', 'research-overview__scope-text', text));
        const x = el('span', 'research-overview__scope-x', '✕');
        x.setAttribute('aria-hidden', 'true');
        chip.appendChild(x);
        chip.setAttribute('aria-label', `${text}, ${L.waitingScopeClear}`);
        chip.title = L.waitingScopeClear;
        chip.onclick = () => this.clearWaitingScope();
        box.appendChild(chip);
        if (none) box.appendChild(el('p', 'research-overview__muted research-overview__scope-none', L.waitingScopeNone));
        return box;
    },

    /**
     * "Awaiting action" of a direction or a person (spec 150 K1.2, K2.3): the overview opens (or comes to the
     * front, its own window too) at the section, narrowed until ✕ or until it closes.
     */
    openWaitingScope(scope: WaitingScope): void {
        const s = liveSession();
        if (!s || s.ended || s.treeId !== DataManager.getCurrentTreeId()) return;
        s.waitingScope = { ...scope };
        // The place groups unfold as a chip's filter unfolds them.
        for (const key of [...s.waitingView.open.keys()]) if (key.startsWith('group:')) s.waitingView.open.delete(key);
        if (overviewInWindow()) {
            this.renderLivePanel();
            focusOverviewWindow();
            return;
        }
        if (this.isResearchOverviewOpen()) this.showOverviewWaiting();
        else this.openResearchOverview({ showWaiting: true });
    },

    /** ✕ of the scope's chip: all of "Awaiting action" again. */
    clearWaitingScope(): void {
        const s = liveSession();
        if (!s?.waitingScope) return;
        s.waitingScope = null;
        this.renderLivePanel();
    },

    /**
     * Awaiting action: compact rows, one detail open at a time. From a
     * research with `waiting.groups`: chips by kind, To do (open) and
     * Awaiting a reply (folded), each by the place it is done at (folded
     * groups with counts; a filter unfolds them). An older research: the rows
     * in its order. The heading counts what is to do.
     */
    appendOverviewWaiting(body: HTMLElement, s: LiveSession, fold: LiveFold, mode: Mode): void {
        const r = strings.research;
        const L = strings.live;
        const view = s.waitingView;
        // Narrowed to a direction or a person (spec 150 K1.2, K2.3): before the kinds, phases and places.
        const scope = s.waitingScope ?? null;
        const waiting = scopedWaiting(s.waiting, scope);
        const todo = waitingTodoCount(s.waiting);
        const replies = s.waiting.length - todo;
        // The section's search (spec 083 §1): its field from ten items, or while a text is typed; folded,
        // the heading says the text in place of its summary.
        const total = waiting.length;
        const typed = overviewSearches.text('waiting');
        const showField = !fold.collapsed && fieldVisible(total, typed);
        const search: SectionSearch | null = showField ? overviewSearches.ensure({
            section: 'waiting', mode: 'local',
            placeholder: L.waitingSearchPlaceholder, ariaLabel: L.waitingSearchAria(r.waiting),
            onInput: () => this.renderResearchOverview(),
            onArrowDown: () => focusFirstSectionRow(search!),
        }) : overviewSearches.get('waiting');
        const toks = tokenize(search?.text ?? '');
        const host = liveSection(body, {
            ...fold, title: `${r.waiting} · ${todo}`, summary: replies > 0 ? L.waitingReplyCount(replies) : undefined, headCls: 'live-panel-heading-waiting',
            help: 'waiting',
            ...(fold.collapsed && typed.trim() ? { summaryEl: searchSummaryEl(typed) } : {}),
        });
        host.classList.add('research-overview__waiting');
        if (view.detail && !s.waiting.some(w => w.id === view.detail)) view.detail = null;
        noteImagesArrived(s);
        if (showField) mountSectionSearch(host, search, total);
        const grouped = s.waiting.some(w => w.section);
        // The research's books (spec 105): the groups by book and "Most tasks" only with its part books (else as before).
        const books = grouped && booksOn(s);
        // The order chosen (spec 083 K5.1, K5.2): kept on this device; the Groups switch only in a time order.
        watchWaitingOrderStorage(() => this.renderResearchOverview());
        // "Most helpful" (spec 105 K4.1) only where the research says what doing an item gains.
        const gain = waitingGainOn(s);
        const order = storedWaitingOrder(books, gain);
        const groupsShown = shownWaitingGroups(storedWaitingGroupMode(), order, books);
        const flat = isSortedOrder(order) && grouped && groupsShown === 'none';
        // The research's books also by place: a file of a book's inbox set aside stands under its book there too.
        const groupOpts: WaitingGroupOpts = books ? { ...(groupsShown === 'book' ? { by: 'book' as const } : {}), books: s.books } : {};
        setWaitingDrawn(order, flat);
        const orderRow = total >= 2 ? this.overviewWaitingOrderEl(order, grouped, mode, books, { gain }) : null;
        const chips = grouped ? waitingChips(waiting) : [];
        const chosen = storedWaitingFilter();
        const filter = grouped ? effectiveWaitingFilter(waiting, chosen) : 'all';
        // A filter whose last item went falls back to all (and stays there).
        if (grouped && filter !== chosen) storeWaitingFilter(filter);
        // The index is built when the items change (or the people's names, the language), not at each key.
        waitingIndex = searchIndex(waitingIndex, waiting, [DataManager.getData().persons, getCurrentLanguage(), books ? s.books : null], w => this.waitingSearchDoc(s, w));
        const res = searchSection(waitingIndex, toks, waitingSection, chips.length > 0 ? filter : 'all');
        const searching = res.searching;
        // Its guessed height in the own window's columns: phases and places without the search (rows when ungrouped).
        if (grouped) {
            const all = waitingPhases(waiting, filter, order, !flat, groupOpts);
            // Without groups a phase's rows count, else its bands (a wrapped title, a book's archive, facts and actions,
            // a place's actions and what it misses; spec 105 U4 §1, §2), "No book" and the parts of "Most tasks" (U4 §4).
            const lines = (p: WaitingPhase): number => waitingPhaseLines(all[p], g => this.waitingGroupBandRows(g, s, p, mode));
            noteOverviewSectionRows('waiting', (['todo', 'sent'] as WaitingPhase[]).reduce((n, p) => n + (all[p].length > 0 ? 1 + lines(p) : 0), 0)
                + (orderRow && order === 'most' ? 1 : 0) + this.overviewBooksOfferRows(s, filter) + this.waitingRetryOpenRows(s, mode));
        } else noteOverviewSectionRows('waiting', waiting.length + this.overviewBooksOfferRows(s, 'all') + this.waitingRetryOpenRows(s, mode));
        // The hypotheses the search shows (the picked ones outside it stay picked) and what matched each by its number.
        const hypoSearch: HypothesisListSearch | null = searching ? {
            found: new Set(res.shown.filter(w => w.kind === 'hypothesis').map(w => w.id)),
            hitOf: (id) => {
                const w = res.shown.find(x => x.id === id);
                return w ? res.hits.get(w) : undefined;
            },
        } : null;
        let listed = false;
        const rows = (items: readonly LiveWaiting[], grouped = false): HTMLElement => {
            // A group's items hang on its line under its band (spec 105 U4 §2); a list without groups has none.
            const list = el('ul', `research-overview__waiting-rows${grouped ? ' is-grouped' : ''}`);
            // A hypothesis (spec 074 §9): its choices in the row, not behind a detail.
            for (const w of items) {
                const hit = searching ? res.hits.get(w) : undefined;
                list.appendChild(w.kind === 'hypothesis' ? this.hypothesisWaitingRow(w, mode, null, hit) : this.overviewWaitingRow(s, w, mode, hit));
            }
            // Its proposals accepted at once (§10), where the research takes that.
            if (!items.some(w => w.kind === 'hypothesis')) return list;
            const out = this.hypothesisWaitingList(items, mode, list, hypoSearch);
            if (out !== list) listed = true;
            return out;
        };
        // Searching and no list of hypotheses drawn (none found): the picked ones are still said, with the way to drop them.
        const outsideFoot = (): void => {
            const rid = this.activeResearchId();
            if (!searching || listed || !rid || !s.waiting.some(w => w.kind === 'hypothesis') || !this.hypothesesAcceptAvailable()) return;
            const foot = this.hypothesisAcceptFootEl(rid, 'waiting', hypoSearch);
            if (foot) host.appendChild(foot);
        };
        if (scope) host.appendChild(this.waitingScopeChip(scope, waiting.length === 0));
        // An older research: no kinds, places or phases.
        if (!grouped) {
            if (orderRow) host.appendChild(orderRow);
            appendSearchOutcome(host, search, { searching, found: res.shown.length, total: res.total, kindLabel: null, onAllKinds: () => {} });
            const shown = isSortedOrder(order) ? sortWaiting(res.shown, order) : res.shown;
            if (shown.length > 0) host.appendChild(rows(shown));
            outsideFoot();
            this.appendOverviewBooksOffer(host, s, { filter: 'all', toks, searching, searchOpen: search?.searchOpen });
            return;
        }

        if (chips.length > 0) {
            const bar = el('div', 'research-overview__filters research-overview__waiting-filters');
            bar.setAttribute('role', 'radiogroup');
            bar.setAttribute('aria-label', L.waitingFilterLabel);
            const all: { f: WaitingFilter; label: string; count: number }[] = [
                { f: 'all', label: L.filterAll, count: waiting.length },
                ...chips.map(c => ({ f: c.section as WaitingFilter, label: L.waitingChips[c.section], count: c.count })),
            ];
            for (const c of all) {
                const chip = el('button', 'research-overview__filter sel-opt');
                // Searching: what was found of its kind; nothing found: dashed, in its place, still choosable.
                const empty = paintSearchChip(chip, c.label, chipCount(res, c.f, c.count), searching);
                chip.type = 'button';
                chip.setAttribute('role', 'radio');
                chip.setAttribute('aria-checked', String(filter === c.f));
                chip.dataset.filter = c.f;
                // A new item the filter hides: a dot on its kind (not on a kind the search found nothing of).
                if (!empty && c.f !== 'all' && filter !== 'all' && c.f !== filter
                    && res.matched.some(w => view.fresh.has(w.id) && waitingSection(w) === c.f)) {
                    chip.classList.add('has-new');
                    chip.setAttribute('aria-label', `${chip.textContent}, ${L.waitingNewSr}`);
                }
                chip.onclick = () => {
                    storeWaitingFilter(c.f);
                    // A filter unfolds every group: what was folded by hand meant the other default.
                    for (const key of [...view.open.keys()]) if (key.startsWith('group:')) view.open.delete(key);
                    this.renderResearchOverview();
                };
                bar.appendChild(chip);
            }
            host.appendChild(bar);
        }
        if (orderRow) host.appendChild(orderRow);
        appendSearchOutcome(host, search, {
            searching, found: res.shown.length, total: res.total,
            kindLabel: filter === 'all' ? null : L.waitingChips[filter],
            onAllKinds: () => {
                storeWaitingFilter('all');
                this.renderResearchOverview();
            },
        });
        // "Most tasks" says what it puts first (spec 105 U4 §4), under the order (outside its sticky head).
        if (orderRow && order === 'most') host.appendChild(el('p', 'research-overview__order-note', L.books.mostNote));

        // Searching: only what was found, each phase and place with a match open unless folded during the search.
        const phases = waitingPhases(res.matched, filter, order, !flat, groupOpts);
        const searchOpen = search?.searchOpen;
        browserNotedInHead.clear();
        for (const phase of ['todo', 'sent'] as WaitingPhase[]) {
            const groups = phases[phase];
            if (groups.length === 0) continue;
            const count = groups.reduce((n, g) => n + g.items.length, 0);
            const phaseKey = `phase:${phase}`;
            const open = sectionPartOpen(phaseKey, phase === 'todo', searching, view.open, searchOpen);
            const ph = el('button', 'research-overview__phase-head');
            ph.type = 'button';
            ph.dataset.phase = phase;
            ph.setAttribute('aria-expanded', String(open));
            const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
            chevron.setAttribute('aria-hidden', 'true');
            ph.append(chevron, el('span', 'research-overview__phase-title', `${phase === 'todo' ? L.waitingPhaseTodo : L.waitingPhaseSent} · ${count}`));
            ph.onclick = () => {
                toggleSectionPart(phaseKey, open, searching, view.open, searchOpen);
                this.renderResearchOverview();
            };
            host.appendChild(ph);
            if (!open) continue;
            const wrap = el('div', 'research-overview__phase');
            wrap.dataset.phase = phase;
            for (const g of groups) {
                // Without groups (a time order): one list, its hypotheses' head over its first row (decision H4 a).
                if (g.key === FLAT_GROUP) {
                    wrap.appendChild(rows(g.items));
                    continue;
                }
                // "Most tasks" with books of both parts in the phase (spec 105 U4 §4): each part under its subheading.
                if (g.part) {
                    wrap.appendChild(el('div', `research-overview__nobook research-overview__books-part is-${g.part.kind}`,
                        g.part.kind === 'download' ? L.books.toDownload(g.part.count) : L.books.onDiskAll(g.part.count)));
                }
                // The places after the books (spec 105 §1): under "No book".
                if (g.afterBooks) wrap.appendChild(el('div', 'research-overview__nobook', L.books.noBook));
                // Every place has its heading, a lone item's too: a bare row would read as an item of the place above.
                const key = `group:${phase}:${g.key}`;
                const gOpen = sectionPartOpen(key, waitingGroupOpenByDefault(g.items, filter, view.fresh), searching, view.open, searchOpen);
                wrap.appendChild(this.overviewWaitingGroupHead(s, g, phase, gOpen, () => {
                    toggleSectionPart(key, gOpen, searching, view.open, searchOpen);
                    this.renderResearchOverview();
                }, mode));
                if (gOpen) wrap.appendChild(rows(g.items, true));
            }
            host.appendChild(wrap);
        }
        outsideFoot();
        this.appendOverviewBooksOffer(host, s, { filter, toks, searching, searchOpen });
    },

    /** How many lines "Faster by downloading" adds to the section (the own window's columns): its heading, open its text, rows and "and N more". */
    overviewBooksOfferRows(s: LiveSession, filter: WaitingFilter): number {
        if (!booksOn(s)) return 0;
        const list = urgentBooksShown(s.books, filter);
        if (list.length === 0) return 0;
        if (!s.waitingView.open.get('urgent')) return 1;
        return 2 + list.length + ((s.books?.more ?? 0) > 0 ? 1 : 0);
    },

    /**
     * "Faster by downloading" (spec 105 §3, 3a–3e, 5i): at the end of
     * Awaiting action, under its phases (and under nothing when nothing
     * waits), the books the research offers to download that nothing waits
     * for, in the order of "Most tasks". Folded by default (`urgent`); open, a
     * sentence with Settings… (Research for this tree at Books), a row per
     * book (title, archive · tasks in the queue · images [· to be taken in]
     * [· sign-in]; what can be downloaded, the archive's website ↗, its
     * folder without a mark), its details under its title (`urgent:<id>`),
     * and "and N more books are in the research". Only under the filter All
     * or Images; searching, the books whose title or archive match. Never
     * counted in the section's title, summary or "Waiting N".
     */
    appendOverviewBooksOffer(host: HTMLElement, s: LiveSession, ctx: {
        filter: WaitingFilter; toks: ReturnType<typeof tokenize>; searching: boolean; searchOpen: Map<string, boolean> | null | undefined;
    }): void {
        if (!booksOn(s)) return;
        const list = urgentBooksShown(s.books, ctx.filter, ctx.toks);
        if (list.length === 0) return;
        const B = strings.live.books;
        const view = s.waitingView;
        const open = sectionPartOpen('urgent', false, ctx.searching, view.open, ctx.searchOpen);
        const box = el('div', 'research-overview__urgent');
        const head = el('button', 'research-overview__phase-head research-overview__urgent-head');
        head.type = 'button';
        head.dataset.focusKey = 'waiting-urgent';
        head.setAttribute('aria-expanded', String(open));
        const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
        chevron.setAttribute('aria-hidden', 'true');
        head.append(chevron, el('span', 'research-overview__phase-title', B.urgent), el('span', 'research-overview__urgent-count', `· ${B.urgentCount(list.length)}`));
        head.onclick = () => {
            toggleSectionPart('urgent', open, ctx.searching, view.open, ctx.searchOpen);
            this.renderResearchOverview();
        };
        box.appendChild(head);
        if (open) {
            const text = el('p', 'research-overview__urgent-text', `${B.urgentText} `);
            const settings = el('button', 'link-button research-overview__urgent-settings', B.urgentSettings);
            settings.type = 'button';
            settings.onclick = () => this.openBooksSettings();
            text.appendChild(settings);
            box.appendChild(text);
            for (const b of list) box.appendChild(this.overviewUrgentBookRow(s, b));
            const more = s.books?.more ?? 0;
            if (more > 0 && !ctx.searching) box.appendChild(el('p', 'research-overview__urgent-more', B.more(more)));
        }
        host.appendChild(box);
    },

    /** A book of "Faster by downloading": its title and line, its details unfolded by a click on them, its offer and actions. */
    overviewUrgentBookRow(s: LiveSession, b: LiveBook): HTMLElement {
        const L = strings.live;
        const B = L.books;
        const key = `urgent:${b.id}`;
        const open = s.waitingView.open.get(key) === true;
        const row = el('div', 'research-overview__urgent-book');
        row.dataset.book = b.id;
        const toggle = el('button', 'research-overview__urgent-toggle');
        toggle.type = 'button';
        toggle.dataset.focusKey = key;
        toggle.setAttribute('aria-expanded', String(open));
        const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
        chevron.setAttribute('aria-hidden', 'true');
        const titles = el('span', 'research-overview__urgent-titles');
        const name = bookTitle(b);
        const title = el('span', 'research-overview__urgent-title', name);
        title.title = bookHeadTitle(b);
        const meta = el('span', 'research-overview__book-meta research-overview__urgent-meta');
        const parts: { cls: string; text: string }[] = [
            ...(b.archive?.name ? [{ cls: 'archive', text: b.archive.name }] : []),
            { cls: 'queue', text: B.inQueueTasks(b.open) },
            { cls: 'images', text: bookImagesText(b) },
            ...(b.pending ? [{ cls: 'pending', text: B.pending(b.pending) }] : []),
            ...(b.access === 'online-login' ? [{ cls: 'login', text: B.login }] : []),
        ];
        parts.forEach((p, i) => {
            if (i > 0) {
                const sep = el('span', 'research-overview__book-sep', '·');
                sep.setAttribute('aria-hidden', 'true');
                meta.appendChild(sep);
            }
            const part = el('span', `research-overview__book-${p.cls}`, p.text);
            if (p.cls === 'archive') part.title = p.text;
            meta.appendChild(part);
        });
        titles.append(title, meta);
        toggle.append(chevron, titles);
        toggle.setAttribute('aria-label', [name, ...parts.map(p => p.text)].join(', '));
        toggle.onclick = () => {
            s.waitingView.open.set(key, !open);
            this.renderResearchOverview();
        };
        row.appendChild(toggle);
        if (open) {
            const dl = el('dl', 'research-overview__urgent-detail');
            const add = (label: string, value: string): void => {
                dl.append(el('dt', '', label), el('dd', '', value));
            };
            add(B.detailTasks, `${b.tasks}${b.parked > 0 ? ` · ${B.parked(b.parked)}` : ''}`);
            if (b.folder) add(B.detailFolder, b.folder);
            if (b.access === 'online-login' || b.access === 'online-free') add(B.detailAccess, b.access === 'online-login' ? B.login : B.accessFree);
            row.appendChild(dl);
        }
        const actions = el('div', 'research-overview__urgent-actions');
        const offer = bookOfferText(b);
        if (offer) actions.appendChild(el('span', 'research-overview__book-offer', offer));
        const url = bookWebUrl(b);
        if (url) {
            const web = el('a', 'waiting-action waiting-action--link research-overview__waiting-archiveweb', L.waitingTask.archiveWeb);
            web.href = url;
            web.title = url;
            web.target = '_blank';
            web.rel = 'noopener noreferrer';
            actions.appendChild(web);
        }
        // Its folder in the shared inbox: the research opens it without a terminal (V7, no mark).
        const folder = b.folder ? this.activeResearchLink('book', { book: b.id, bookDo: 'folder' }) : null;
        if (folder) {
            const btn = setResearchActionLabel(el('button', 'live-waiting-answer research-overview__waiting-groupwrite research-overview__book-folder'),
                L.waitingTask.openFolder, researchLinkMark('book'), { sr: false });
            btn.type = 'button';
            btn.dataset.book = b.id;
            btn.setAttribute('aria-label', `${L.waitingTask.openFolder} · ${name}`);
            btn.onclick = () => this.launchResearchLink(folder);
            actions.appendChild(btn);
        }
        if (actions.childElementCount > 0) row.appendChild(actions);
        return row;
    },

    /**
     * Settings… of "Faster by downloading": Research for this tree at Books,
     * open and highlighted (the overview as a phone's full-screen sheet goes
     * first: it stays above every dialog).
     */
    openBooksSettings(): void {
        const treeId = drawnSession()?.treeId ?? liveSession()?.treeId ?? overviewViewing()?.treeId;
        if (!treeId) return;
        if (document.querySelector('#research-overview.research-overview--sheet')) this.closeResearchOverview();
        void this.showResearchTreeSettings(treeId, { group: 'books' });
    },

    /**
     * "Faster by downloading · N books ⤢" of the small panel (spec 105 §5, Q2):
     * the overview opens with Awaiting action shown and that part open, its
     * heading at the top.
     */
    showOverviewBooksOffer(): void {
        if (overviewInWindow()) {
            focusOverviewWindow();
            return;
        }
        if (!this.isResearchOverviewOpen()) this.openResearchOverview();
        const s = drawnSession();
        if (!s) return;
        s.waitingView.open.set('urgent', true);
        s.overviewShown.add('waiting');
        this.renderLivePanel();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('#ov-sec-waiting .research-overview__urgent-head');
        if (body && heading) {
            scrollHeadingToTop(body, heading);
            heading.focus({ preventScroll: true });
        }
    },

    /**
     * The order of Awaiting action (spec 083 §5, 5r1–5r5): "⇅ Recommended ▾"
     * opens the orders (a sheet on a phone); in a time order the Groups
     * switch beside it (a research with places only). With the research's
     * books (spec 105 §1, §2) "Most tasks" too, and in place of the switch
     * the choice of groups (Archive | Book [| No groups]), none in "Most
     * tasks". With the items' gains (`gain`, spec 105 K4.1) "Most helpful",
     * grouped as a time order. All stay in the app (no mark) and are kept on
     * this device for every tree.
     */
    overviewWaitingOrderEl(order: WaitingOrder, grouped: boolean, mode: Mode, books = false,
        opts: { compact?: boolean; redraw?: () => void; gain?: boolean } = {}): HTMLElement {
        const L = strings.live;
        const redraw = opts.redraw ?? (() => this.renderResearchOverview());
        const gain = !!opts.gain;
        const orders = waitingOrdersFor(books, gain);
        const bar = el('div', 'research-overview__order');
        const btn = el('button', `research-overview__order-btn${isSortedOrder(order) ? ' is-time' : ''}`);
        btn.type = 'button';
        btn.dataset.focusKey = 'waiting-order';
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', L.waitingOrderAria(waitingOrderLabel(order)));
        btn.insertAdjacentHTML('beforeend', ORDER_ICON);
        btn.append(el('span', 'research-overview__order-name', waitingOrderLabel(order)));
        const caret = el('span', 'research-overview__order-caret', '▾');
        caret.setAttribute('aria-hidden', 'true');
        btn.appendChild(caret);
        const choose = (o: WaitingOrder): void => {
            if (o === storedWaitingOrder(books, gain)) return;
            storeWaitingOrder(o);
            redraw();
        };
        const sheet = mode === 'sheet' || isPhoneBar();
        btn.onclick = () => this.openWaitingChoice(btn, {
            title: L.waitingOrder, sheet, sheetClass: 'research-overview__order-sheet', menuClass: 'research-overview__order-menu',
            // "Most tasks" says what it puts first (spec 105 U4 §4).
            options: orders.map(o => ({ id: `order-${o}`, label: waitingOrderLabel(o), sub: o === 'most' ? L.books.orderMostSub : undefined, on: o === order, run: () => choose(o) })),
        });
        bar.appendChild(btn);
        if (books && order !== 'most') {
            bar.appendChild(this.waitingGroupsChoiceEl(order, { compact: sheet || !!opts.compact, sheet, redraw }));
        } else if (isSortedOrder(order) && grouped && !books) {
            const on = storedWaitingGroups();
            const sw = el('button', 'research-overview__groups');
            sw.type = 'button';
            sw.dataset.focusKey = 'waiting-groups';
            sw.setAttribute('role', 'switch');
            sw.setAttribute('aria-checked', String(on));
            const track = el('span', 'research-overview__groups-track');
            track.setAttribute('aria-hidden', 'true');
            track.appendChild(el('span', 'research-overview__groups-knob'));
            sw.append(track, el('span', 'research-overview__groups-label', L.waitingGroups));
            sw.onclick = () => {
                storeWaitingGroups(!on);
                redraw();
            };
            bar.appendChild(sw);
        }
        return bar;
    },

    /**
     * A choice of one opened from a button (the order, the groups): a sheet
     * on a phone (its rows a choice of one), else the head menu under the
     * button, which says it is open while it is.
     */
    openWaitingChoice(btn: HTMLElement, c: {
        title: string; sheet: boolean; sheetClass: string; menuClass: string;
        options: { id: string; label: string; sub?: string; on: boolean; run: () => void }[];
    }): void {
        if (c.sheet) {
            this.presentMenuSheet(c.title, [{ rows: c.options.map(o => ({ label: o.label, sub: o.sub, active: o.on, run: o.run })) }],
                { overlayClass: c.sheetClass });
            // The choices are a choice of one.
            const sheet = [...document.querySelectorAll<HTMLElement>(`.${c.sheetClass} .bottom-sheet-menu`)].pop();
            sheet?.querySelectorAll<HTMLElement>('.bottom-sheet-item').forEach((b, i) => {
                b.setAttribute('role', 'menuitemradio');
                b.setAttribute('aria-checked', String(!!c.options[i]?.on));
            });
            return;
        }
        // A redraw meanwhile (a status of the research followed live) draws the button anew:
        // it is found again by its focus key, says the menu is open and takes the focus back.
        const key = btn.closest('#research-overview') ? btn.dataset.focusKey ?? null : null;
        const current = (): HTMLElement => {
            if (btn.isConnected || !key) return btn;
            return document.querySelector<HTMLElement>(`#research-overview [data-focus-key="${CSS.escape(key)}"][aria-haspopup="menu"]`) ?? btn;
        };
        choiceOpenFor = key;
        btn.setAttribute('aria-expanded', 'true');
        const menu = openHeadMenu(btn, '', '', [
            { heading: c.title },
            ...c.options.map(o => ({ id: o.id, label: o.label, desc: o.sub, icon: '', checked: o.on, run: o.run })),
        ], { focusBack: current });
        menu.classList.add(c.menuClass);
        menu.setAttribute('aria-label', c.title);
        // Closed any way: the button says so again.
        const watch = new MutationObserver(() => {
            if (menu.isConnected) return;
            watch.disconnect();
            if (key && choiceOpenFor === key) choiceOpenFor = null;
            current().setAttribute('aria-expanded', 'false');
        });
        watch.observe(document.body, { childList: true });
    },

    /**
     * The choice of groups of Awaiting action (spec 105 §1, 1a–1d, 5a, 5b):
     * wide a segment "Groups Archive | Book [| No groups]"; narrow (a phone,
     * one held sideways, the small panel) a button "Groups: Book ▾" opening
     * a sheet (`sheet`) or a menu. Recommended has no "No groups" (it draws
     * as Archive, the kept choice is not rewritten). Kept on this device.
     */
    waitingGroupsChoiceEl(order: WaitingOrder, opts: { compact: boolean; sheet: boolean; redraw: () => void }): HTMLElement {
        const B = strings.live.books;
        const modes = waitingGroupModesFor(order);
        const shown = shownWaitingGroups(storedWaitingGroupMode(), order, true);
        const choose = (m: WaitingGroups): void => {
            if (m === storedWaitingGroupMode()) return;
            storeWaitingGroupMode(m);
            opts.redraw();
        };
        if (opts.compact) {
            const btn = el('button', 'research-overview__order-btn research-overview__groups-btn');
            btn.type = 'button';
            btn.dataset.focusKey = 'waiting-groups';
            btn.setAttribute('aria-haspopup', 'menu');
            btn.setAttribute('aria-expanded', 'false');
            btn.setAttribute('aria-label', B.groupsAria(waitingGroupsLabel(shown)));
            btn.append(el('span', 'research-overview__groups-btn-label', `${B.groups}:`), el('span', 'research-overview__order-name', waitingGroupsLabel(shown)));
            const caret = el('span', 'research-overview__order-caret', '▾');
            caret.setAttribute('aria-hidden', 'true');
            btn.appendChild(caret);
            btn.onclick = () => this.openWaitingChoice(btn, {
                title: B.groups, sheet: opts.sheet, sheetClass: 'research-overview__groups-sheet', menuClass: 'research-overview__groups-menu',
                options: modes.map(m => ({ id: `groups-${m}`, label: waitingGroupsLabel(m), on: m === shown, run: () => choose(m) })),
            });
            return btn;
        }
        const box = el('div', 'research-overview__groups-choice');
        const label = el('span', 'research-overview__groups-choice-label', B.groups);
        label.setAttribute('aria-hidden', 'true');
        const seg = el('div', 'research-overview__groups-seg sel-seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', B.groups);
        modes.forEach((m, i) => {
            const b = el('button', 'research-overview__groups-opt sel-opt', waitingGroupsLabel(m));
            b.type = 'button';
            b.dataset.selForm = 'seg';
            b.dataset.groups = m;
            b.dataset.focusKey = `waiting-groups-${m}`;
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(m === shown));
            b.tabIndex = m === shown ? 0 : -1;
            b.onclick = () => choose(m);
            // A choice of one: the arrows move it (and the focus with it, kept over the redraw).
            b.onkeydown = (e) => {
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = modes[(i + step + modes.length) % modes.length];
                (seg.querySelector<HTMLElement>(`[data-groups="${next}"]`))?.focus();
                choose(next);
            };
            seg.appendChild(b);
        });
        box.append(label, seg);
        return box;
    },

    /**
     * What an item of Awaiting action is searched by (spec 083 §1): its text,
     * what it waits on, its people (names and numbers), its task, its
     * hypothesis, its place's name, the archive and whom a letter goes to;
     * all of it is seen in its row, its detail or its group's heading.
     */
    waitingSearchDoc(s: LiveSession, w: LiveWaiting): SearchDoc {
        const people = w.kind === 'story' ? storyWaitingPeople(w).map(p => p.name) : w.kind === 'houseStory' ? [this.houseStoryWaitingWho(w)].filter(Boolean)
            : w.kind === 'import' ? (w.importAsk?.samples ?? []).map(p => p.name)
                : [personByRefn(w.person)].filter((p): p is Person => !!p).map(fullName);
        const task = researchTaskRef(w.id);
        const hypo = w.kind === 'hypothesis' ? w.id : /\bH\d+\b/.exec(w.on)?.[0];
        const what = w.kind === 'story' ? strings.story.nvWaitingItem : w.kind === 'houseStory' ? this.houseStoryWaitingText(w) : w.kind === 'branch' ? waitBranchText(w, s) : w.kind === 'aside' ? this.asideText(w, s)
            : w.kind === 'import' ? `${strings.live.importAsk.question} ${w.what}` : w.what;
        const place = w.kind === 'place' ? strings.places.waiting.group : w.group?.name;
        // Its book's title and archive (spec 105 §1), as its book's heading says them.
        const book = booksOn(s) ? bookById(s, w.book) : null;
        const bookText = book ? [bookTitle(book), book.archive?.name] : [];
        const hay = [what, w.on, ...people, w.person, w.partner, task, hypo, place, w.host, w.to, ...bookText].filter(Boolean).join(' ');
        return { hay: foldSearch2(hay), pn: idNumber(w.person), tn: idNumber(task), hn: idNumber(hypo) };
    },

    /**
     * The fold button of a group's band (spec 105 U4 §1, §2; spec 140 §2): the
     * chevron, the title wrapped up to its cap (its "more" goes under the
     * button, see groupTitleMoreEl; `titleExtra` wraps with it), and at the
     * top right what `side` holds.
     */
    groupBandButton(b: {
        cls?: string; name: string; titleAttr: string; titleExtra?: HTMLElement; side: HTMLElement[];
        label: string; open: boolean; toggle: () => void;
    }): { button: HTMLButtonElement; title: HTMLElement } {
        const gh = el('button', `research-overview__group-head research-overview__waiting-group${b.cls ? ` ${b.cls}` : ''}`);
        gh.type = 'button';
        gh.setAttribute('aria-expanded', String(b.open));
        const chevron = el('span', 'live-section__chevron', b.open ? '▾' : '▸');
        chevron.setAttribute('aria-hidden', 'true');
        const title = el('span', 'research-overview__group-title', b.name);
        if (b.titleExtra) title.appendChild(b.titleExtra);
        title.title = b.titleAttr;
        const side = el('span', 'research-overview__group-side');
        side.append(...b.side);
        gh.append(chevron, title, side);
        gh.setAttribute('aria-label', b.label);
        gh.onclick = b.toggle;
        return { button: gh, title };
    },

    /** The band's button of a group of Awaiting action: its kind, new and how many at the top right. */
    waitingBandButton(g: WaitingGroupRows, open: boolean, toggle: () => void, h: {
        cls: string; name: string; titleAttr: string; kind: string | null; newText: string; label: string;
    }): { button: HTMLButtonElement; title: HTMLElement } {
        const side: HTMLElement[] = [];
        if (h.kind) side.push(el('span', 'research-overview__group-kind', h.kind));
        if (h.newText) side.push(el('span', 'research-overview__new', h.newText));
        side.push(el('span', 'research-overview__group-span', String(g.items.length)));
        const band = this.groupBandButton({ cls: h.cls, name: h.name, titleAttr: h.titleAttr, side, label: h.label, open, toggle });
        band.button.dataset.group = g.key;
        return band;
    },

    /** The title of a group's band as drawn (a place, "Other", the questions about places, a book with its years). */
    waitingGroupTitle(g: WaitingGroupRows): string {
        if (g.book) {
            const info = listedBook(g.book);
            return info ? bookTitle(info) : g.book.title;
        }
        return g.key === PLACES_GROUP ? strings.places.waiting.group : g.group?.name ?? strings.live.waitingOtherGroup;
    },

    /**
     * How many lines a group's band adds to the section's guessed height (the
     * own window's columns): with "Retry all with the agent" and its
     * confirmation kept beforehand, and the Now line its items share (spec 089 §8).
     */
    waitingGroupBandRows(g: WaitingGroupRows, s: LiveSession, phase: WaitingPhase, mode: Mode): number {
        return waitingGroupBandLines(this.waitingGroupTitle(g), g.book
            ? { book: true, listed: listedBook(g.book) !== null }
            : {
                missing: g.key !== PLACES_GROUP && waitingGroupMissing(g.items) !== null,
                retry: this.waitingGroupRetryOffer(s, g, phase, mode) !== null,
                now: this.waitingGroupRetryNow(g, mode) !== null,
            });
    },

    /**
     * "Retry all with the agent" of a place's band (spec 089 §4): what it
     * takes back, counted of EVERY item of the place (the bridge takes the
     * whole place, not what a filter or a search shows); null where it is not
     * offered — the bridge without `waiting.retry`, a phone, the questions
     * about places, a book or no place, fewer than two items that can go back
     * now. Its band in one phase only: to do when one of them is there.
     */
    waitingGroupRetryOffer(s: LiveSession, g: WaitingGroupRows, phase: WaitingPhase, mode: Mode): WaitingGroupRetry | null {
        const key = g.group?.key;
        if (mode === 'sheet' || g.book || !key || g.key === PLACES_GROUP || !this.liveWaitingWrites(s).retry) return null;
        const all = s.waiting.filter(w => w.group?.key === key);
        const offer = waitingGroupRetry(all);
        if (offer.n < 2) return null;
        const at: WaitingPhase = all.some(w => w.retry?.can && waitingPhase(w) === 'todo') ? 'todo' : 'sent';
        return at === phase ? offer : null;
    },

    /**
     * The Now line a place's band says for its items (spec 089 §2, frame 9):
     * two or more of its items shown wait for one reason; not on a phone (its
     * band gets nothing new there, each item says its own).
     */
    waitingGroupRetryNow(g: WaitingGroupRows, mode: Mode): ReturnType<typeof waitingGroupRetryReason> {
        if (mode === 'sheet' || g.book || g.key === PLACES_GROUP) return null;
        return waitingGroupRetryReason(g.items, getCurrentLanguage());
    },

    /**
     * A place's band (spec 105 U4 §1, §2): the fold button (its name wrapped,
     * kind, new, how many), "more" under a cut name, the time of its first
     * item in a time order, the images its items miss, and the place's own
     * actions (overviewWaitingGroupAction) under them.
     */
    overviewWaitingGroupHead(s: LiveSession, g: WaitingGroupRows, phase: WaitingPhase, open: boolean, toggle: () => void, mode: Mode): HTMLElement {
        if (g.book) return this.overviewWaitingBookHead(s, g, open, toggle, mode);
        const L = strings.live;
        const row = el('div', 'research-overview__waiting-grouphead');
        const places = g.key === PLACES_GROUP;
        const name = this.waitingGroupTitle(g);
        const kind = places ? name : L.waitingGroupKinds[g.group?.kind ?? 'other'];
        // How many images its items miss together (a research that says which).
        const missing = places ? null : waitingGroupMissing(g.items);
        const missingText = missing ? L.waitingTask.groupMissing(missing) : '';
        // Folded with new items: how many (K5.3).
        const fresh = open ? 0 : g.items.filter(w => s.waitingView.tagged.has(w.id)).length;
        const newText = fresh > 0 ? L.waitingNewCount(fresh) : '';
        const { button, title } = this.waitingBandButton(g, open, toggle, {
            cls: '', name, titleAttr: name, kind: kind !== name ? kind : null, newText,
            label: `${name} · ${g.items.length}${kind !== name ? `, ${kind}` : ''}${missingText ? `, ${missingText}` : ''}${newText ? `, ${newText}` : ''}`,
        });
        row.append(button, groupTitleMoreEl(title, g.key, s.waitingView.open));
        // A time order (spec 083 §5): the time of its first item under the name.
        const since = isTimeOrder(waitingDrawn().order) && g.items[0] ? waitingSinceEl(g.items[0], 'research-overview__group-since') : null;
        if (since) row.appendChild(since);
        if (missing) row.appendChild(el('span', 'research-overview__group-missing', missingText));
        const action = this.overviewWaitingGroupAction(s, g, phase, mode);
        if (action) row.appendChild(action);
        // Two or more of its items wait for images from one browser-only archive: said once, here (spec 048 §11.2).
        // Items that can go back to the agent say why in their Now line instead (spec 089 §2).
        const ctx = this.overviewBrowserContext(mode);
        const noted = g.items.filter(w => !w.retry);
        const note = browserGroupNote(s.browser, noted, s.waiting, ctx);
        if (note) {
            row.classList.add('has-browser-note');
            row.appendChild(this.browserNoteEl(note, s.researchId, 'research-overview__waiting-groupnote-browser'));
            for (const w of noted) if (browserNote(s.browser, w, s.waiting, ctx)?.host === note.host) browserNotedInHead.add(itemKey(s, w.id));
        }
        // Two or more of its items that can go back wait for one reason: their Now line once, here; theirs left out (frame 9).
        const shared = this.waitingGroupRetryNow(g, mode);
        if (shared) {
            row.classList.add('has-browser-note');
            row.appendChild(this.waitingNowEl(s, shared, mode));
            for (const id of shared.ids) browserNotedInHead.add(itemKey(s, id));
        }
        return row;
    },

    /**
     * A book's band (spec 105 §1, U4 §1, §2): in its fold button the title
     * wrapped up to its cap (whole in `title` with the archive and the tasks),
     * "Book", new and how many; under it "more" for a cut title, the time of
     * its first item in a time order, the archive whole on its own line, then
     * tasks · waiting [· in the queue] [· parked] · images [· to be taken in]
     * [· sign-in] — in "Most tasks" the counts bold (the order's key, Q3). Then
     * the book's actions: what can be downloaded, the archive's website ↗,
     * its folder (no mark), Chat (AI and the terminal; not on a phone). A
     * book outside the research's list: its title, "Book" and how many only.
     */
    overviewWaitingBookHead(s: LiveSession, g: WaitingGroupRows, open: boolean, toggle: () => void, mode: Mode): HTMLElement {
        const L = strings.live;
        const B = L.books;
        const book = g.book!;
        const info = listedBook(book);
        const row = el('div', 'research-overview__waiting-grouphead is-book');
        const name = this.waitingGroupTitle(g);
        const fresh = open ? 0 : g.items.filter(w => s.waitingView.tagged.has(w.id)).length;
        const newText = fresh > 0 ? L.waitingNewCount(fresh) : '';
        const archive = info?.archive?.name ?? '';
        const parts = info ? bookMetaParts(info) : [];
        const metaText = parts.map(p => p.text).join(' · ');
        const { button, title } = this.waitingBandButton(g, open, toggle, {
            cls: 'research-overview__book-head', name, titleAttr: info ? bookHeadTitle(info) : name, kind: B.kind, newText,
            label: [`${name} · ${g.items.length}`, B.kind, archive, metaText, newText].filter(Boolean).join(', '),
        });
        button.dataset.book = book.id;
        row.append(button, groupTitleMoreEl(title, g.key, s.waitingView.open));
        const since = isTimeOrder(waitingDrawn().order) && g.items[0] ? waitingSinceEl(g.items[0], 'research-overview__group-since') : null;
        if (since) row.appendChild(since);
        if (archive) row.appendChild(el('span', 'research-overview__book-archive', archive));
        if (info) {
            const most = waitingDrawn().order === 'most';
            const meta = el('span', 'research-overview__book-meta');
            const sep = (): HTMLElement => {
                const dot = el('span', 'research-overview__book-sep', '·');
                dot.setAttribute('aria-hidden', 'true');
                return dot;
            };
            parts.forEach((p, i) => {
                if (i > 0) meta.appendChild(sep());
                // "Most tasks": its keys bold — the tasks, and the images missing (none for a book whole on disk; U4 §4).
                if (!most || p.key < 0) {
                    meta.appendChild(el('span', `research-overview__book-${p.kind}`, p.text));
                    return;
                }
                const span = el('span', `research-overview__book-${p.kind}`);
                p.pieces.forEach((piece, j) => {
                    if (j > 0) span.append(' · ');
                    span.appendChild(j === p.key ? el('span', 'is-key', piece) : document.createTextNode(piece));
                });
                meta.appendChild(span);
            });
            row.appendChild(meta);
        }
        const actions = info ? this.overviewWaitingBookActions(info, g, mode) : null;
        if (actions) row.appendChild(actions);
        return row;
    },

    /** A book's actions under its heading (a click never folds it): the offer, its website ↗, its folder, Chat. */
    overviewWaitingBookActions(b: LiveBook, g: WaitingGroupRows, mode: Mode): HTMLElement | null {
        const L = strings.live;
        const box = el('div', 'research-overview__waiting-groupactions research-overview__book-actions');
        const offer = bookOfferText(b);
        if (offer) box.appendChild(el('span', 'research-overview__book-offer', offer));
        const url = bookWebUrl(b);
        if (url) {
            const web = el('a', 'waiting-action waiting-action--link research-overview__waiting-archiveweb', L.waitingTask.archiveWeb);
            web.href = url;
            web.title = url;
            web.target = '_blank';
            web.rel = 'noopener noreferrer';
            web.onclick = (e) => e.stopPropagation();
            box.appendChild(web);
        }
        // Its folder in the shared inbox: the research opens it without a terminal (V7, no mark).
        const folder = b.folder ? this.activeResearchLink('book', { book: b.id, bookDo: 'folder' }) : null;
        if (folder) {
            const btn = setResearchActionLabel(el('button', 'live-waiting-answer research-overview__waiting-groupwrite research-overview__book-folder'),
                L.books.folderBook, researchLinkMark('book'), { sr: false });
            btn.type = 'button';
            btn.dataset.book = b.id;
            btn.setAttribute('aria-label', `${L.books.folderBook} · ${bookTitle(b)}`);
            btn.onclick = (e) => {
                e.stopPropagation();
                this.launchResearchLink(folder);
            };
            box.appendChild(btn);
        }
        const task = mode === 'sheet' ? null : waitingGroupChatTask(g.items);
        const chat = task ? this.activeResearchLink('task', { task, taskDo: 'chat' }) : null;
        if (chat) {
            const btn = setResearchActionLabel(el('button', 'live-waiting-answer research-overview__waiting-groupchat'), L.waitingActions.chat, researchLinkMark('task', { taskDo: 'chat' }), { sr: false });
            btn.type = 'button';
            btn.dataset.task = task!;
            btn.setAttribute('aria-label', `${L.waitingActions.chat} · ${bookTitle(b)}${researchOpenSrText(true)}`);
            btn.onclick = () => this.launchResearchLink(chat);
            box.appendChild(btn);
        }
        return box.childElementCount > 0 ? box : null;
    },

    /**
     * A whole group's actions beside its heading, outside the fold button
     * (seen folded too; a click never folds): "Chat (research)" on the place (the task
     * link of its first item offering a chat; the research's chat takes up
     * the rest of the group) — not on a phone, it opens the research on the
     * computer; through the bridge, where it takes them (a phone too):
     * "Sent" for the place's items to do and "All queries' text".
     */
    overviewWaitingGroupAction(s: LiveSession, g: WaitingGroupRows, phase: WaitingPhase, mode: Mode): HTMLElement | null {
        const L = strings.live;
        const W = L.waitingWrite;
        const name = g.group?.name ?? L.waitingOtherGroup;
        const box = el('div', 'research-overview__waiting-groupactions');
        // The questions about places: answered in their own window (the bridge takes them).
        if (g.key === PLACES_GROUP) {
            if (phase !== 'todo' || !this.waitingPlacesAccess().canAnswer) return null;
            const P = strings.places.waiting;
            const btn = el('button', 'live-waiting-answer research-overview__waiting-groupwrite research-overview__waiting-places', P.answer);
            btn.type = 'button';
            btn.dataset.action = 'places';
            btn.setAttribute('aria-label', `${P.answer} · ${P.group}`);
            btn.onclick = (e) => {
                e.stopPropagation();
                this.showWaitingPlaces();
            };
            if (inShowcase()) markShowcaseOff(btn, 'none', P.answer);
            box.appendChild(btn);
            return box;
        }
        // The archive's website: one session in its browser for all the place's tasks.
        if (g.group?.url) {
            const web = el('a', 'waiting-action waiting-action--link research-overview__waiting-archiveweb', L.waitingTask.archiveWeb);
            web.href = g.group.url;
            web.title = g.group.url;
            web.target = '_blank';
            web.rel = 'noopener noreferrer';
            web.onclick = (e) => e.stopPropagation();
            box.appendChild(web);
        }
        const task = mode === 'sheet' ? null : waitingGroupChatTask(g.items);
        const url = task ? this.activeResearchLink('task', { task, taskDo: 'chat' }) : null;
        if (url) {
            const btn = setResearchActionLabel(el('button', 'live-waiting-answer research-overview__waiting-groupchat'), L.waitingActions.chat, researchLinkMark('task', { taskDo: 'chat' }), { sr: false });
            btn.type = 'button';
            btn.dataset.task = task!;
            btn.setAttribute('aria-label', `${L.waitingActions.chat} · ${name}${researchOpenSrText(true)}`);
            btn.onclick = () => this.launchResearchLink(url);
            box.appendChild(btn);
        }
        // A place the research names: the whole place (not only what a filter shows).
        const key = g.group?.key;
        const writes = this.liveWaitingWrites(s);
        if (key && writes.sent && phase === 'todo') {
            const sendable = waitingGroupSendable(s.waiting.filter(w => w.group?.key === key));
            if (sendable.length > 0) {
                // The day they went out is asked first where the bridge takes it (spec 149 K1.6: one day for all).
                const btn: HTMLButtonElement = this.waitingWriteButton(W.groupSent, 'group-sent',
                    () => this.askWaitingSentDay(s, btn, { kind: 'group', key, n: sendable.length }), 'research-overview__waiting-groupwrite', !writes.sentDay);
                btn.setAttribute('aria-label', W.groupSentLabel(name, sendable.length));
                box.appendChild(btn);
            }
        }
        // Every item of the place that can go back, back to the agent at once (spec 089 §4), confirmed in place.
        const retry = this.waitingGroupRetryOffer(s, g, phase, mode);
        if (key && retry) this.appendWaitingGroupRetry(box, s, key, name, retry);
        else if (key && retryConfirm && retryConfirm.key === key && !retryConfirm.saving
            && !this.waitingGroupRetryOffer(s, g, 'todo', mode) && !this.waitingGroupRetryOffer(s, g, 'sent', mode)) retryConfirm = null;
        if (key && writes.note && waitingGroupHasNote(s.waiting.filter(w => w.group?.key === key))) {
            const btn = el('button', 'live-waiting-answer research-overview__waiting-groupwrite research-overview__waiting-groupnote', W.groupNote);
            btn.type = 'button';
            btn.dataset.action = 'group-note';
            btn.setAttribute('aria-label', `${W.groupNote} · ${name}`);
            btn.onclick = (e) => {
                e.stopPropagation();
                void this.showWaitingGroupNote(s, key, name, btn);
            };
            box.appendChild(btn);
        }
        return box.childElementCount > 0 ? box : null;
    },

    /**
     * "Retry all with the agent (2 tasks, 5 images)" in a place's actions
     * (spec 089 §4, frames 7, 8): through the bridge, no mark; "· 1 only
     * tomorrow 9:12" after it for those held by the limit. A click asks in
     * place — the question, Return (focused) and Cancel (Escape too) instead
     * of the button; Return writes the place, "saving" meanwhile.
     */
    appendWaitingGroupRetry(box: HTMLElement, s: LiveSession, key: string, name: string, retry: WaitingGroupRetry): void {
        const R = strings.live.waitingRetry;
        const lang = getCurrentLanguage();
        const buttonKey = `group-retry:${key}`;
        if (retryConfirm?.key !== key) {
            const btn = this.waitingWriteButton(R.groupAction, 'group-retry', () => {
                retryConfirm = { key, saving: false };
                this.renderResearchOverview();
                focusOverviewKey('group-retry-yes');
            }, 'research-overview__waiting-groupwrite research-overview__waiting-groupretry', false);
            btn.append(' ', el('span', 'waiting-retry-count', groupRetryCountText(retry, lang)));
            btn.setAttribute('aria-label', groupRetryAria(name, retry, lang));
            btn.dataset.focusKey = buttonKey;
            box.appendChild(btn);
            const later = groupRetryLaterText(retry, lang);
            if (later) box.appendChild(el('span', 'research-overview__muted research-overview__group-retry-later', `· ${later}`));
            return;
        }
        const saving = retryConfirm.saving;
        const ask = el('div', 'research-overview__retry-confirm');
        ask.setAttribute('role', 'group');
        ask.setAttribute('aria-label', R.groupAction);
        ask.appendChild(el('span', 'research-overview__retry-question', groupRetryConfirmText(retry, lang)));
        const cancel = (): void => {
            if (retryConfirm?.key !== key || retryConfirm.saving) return;
            retryConfirm = null;
            this.renderResearchOverview();
            focusOverviewKey(buttonKey);
        };
        const yes = el('button', 'waiting-action waiting-action--primary research-overview__retry-yes', R.yes);
        yes.type = 'button';
        yes.dataset.action = 'group-retry-yes';
        yes.dataset.write = 'bridge';
        yes.dataset.focusKey = 'group-retry-yes';
        yes.disabled = saving;
        yes.onclick = (e) => {
            e.stopPropagation();
            if (retryConfirm?.key !== key || retryConfirm.saving) return;
            retryConfirm = { key, saving: true };
            this.renderResearchOverview();
            void this.retryWaitingGroup(s, key).then((r) => {
                if (retryConfirm?.key === key) retryConfirm = null;
                this.renderResearchOverview();
                // Not taken: the focus back on the place's button.
                if (!r || !r.ok || r.retried.length === 0) focusOverviewKey(buttonKey);
            });
        };
        const no = el('button', 'waiting-action waiting-action--link research-overview__retry-no', R.no);
        no.type = 'button';
        no.dataset.action = 'group-retry-no';
        no.disabled = saving;
        no.onclick = (e) => {
            e.stopPropagation();
            cancel();
        };
        ask.append(yes, no);
        if (saving) ask.appendChild(busyStatusEl(strings.busy.savingRow));
        ask.onclick = (e) => e.stopPropagation();
        ask.onkeydown = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            cancel();
        };
        box.appendChild(ask);
    },

    /** A Now line (spec 089 §2): "Now:" bold, why it waits, the extension's link after it on a computer. */
    waitingNowEl(s: LiveSession, reason: { text: string; extLink: boolean }, mode: Mode): HTMLElement {
        const now = el('p', 'research-overview__waiting-now');
        now.setAttribute('role', 'note');
        const text = el('span');
        text.append(el('b', undefined, strings.live.waitingRetry.now), ' ', reason.text);
        now.appendChild(text);
        if (reason.extLink && mode !== 'sheet' && s.browser?.url) now.appendChild(this.browserExtLink(s.browser.url));
        return now;
    },

    /** The browser note's context in the overview: a phone gets no links. */
    overviewBrowserContext(mode: Mode): { phone: boolean; links: boolean } {
        const phone = mode === 'sheet';
        return { phone, links: !phone && this.researchLinkAvailable('archive') };
    },

    /** One waiting item: a compact row (kind, text in two lines, person, age); a click opens its detail. */
    overviewWaitingRow(s: LiveSession, w: LiveWaiting, mode: Mode, hit?: SearchHit): HTMLElement {
        const L = strings.live;
        const view = s.waitingView;
        const open = view.detail === w.id;
        const drawnAs = waitingDrawn();
        const li = el('li', 'research-overview__waiting-item');
        li.dataset.id = w.id;
        // A growing branch is a suggestion: marked fresh while it waits (no stripe since 1128; the "new" tag is its own).
        if (view.fresh.has(w.id) || w.kind === 'branch') li.classList.add('is-fresh');
        if (open) li.classList.add('is-open');
        const detailId = `ov-wait-${w.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
        const row = el('button', 'research-overview__waiting-row');
        row.type = 'button';
        // The first row ↓ of the section's search reaches.
        row.dataset.row = '';
        row.setAttribute('aria-expanded', String(open));
        row.setAttribute('aria-controls', detailId);
        const head = el('span', 'research-overview__waiting-what');
        // A finding of how the task is recorded (spec 109 §1.2): its mark before the title.
        if (waitingAuditShown(s, w)) head.appendChild(waitingAuditMarkEl(L.waitingAudit.auditHead));
        if (w.kind === 'story' || w.kind === 'houseStory') head.appendChild(el('span', 'live-kind-story', L.kindStory));
        else if (w.kind === 'branch') head.appendChild(el('span', 'live-kind live-kind--decide', L.waitBranchKind));
        else if (w.section || w.kind) head.appendChild(waitingKindLabel(w));
        // A question of a house (spec 030 §14): the kind "Houses" with it.
        const houseQ = w.kind === 'story' || w.kind === 'houseStory' || w.kind === 'branch' || w.kind === 'aside' || w.kind === 'import' ? null : this.houseOfWaiting(w.id);
        if (houseQ) {
            const tag = el('span', 'live-kind live-kind--house', strings.live.taskKinds.house ?? '');
            tag.dataset.house = houseQ.key;
            head.appendChild(tag);
        }
        head.append(w.kind === 'story' ? strings.story.nvWaitingItem : w.kind === 'houseStory' ? this.houseStoryWaitingText(w) : w.kind === 'branch' ? waitBranchText(w, s) : w.kind === 'aside' ? this.asideText(w, s)
            : w.kind === 'import' ? strings.live.importAsk.question : w.what);
        row.appendChild(head);
        const meta = el('span', 'research-overview__waiting-meta');
        // A question about a send (1127): its day, how many people and three of them.
        let people = w.kind === 'story' ? storyWaitingPeople(w).map(p => p.name) : w.kind === 'houseStory' ? [this.houseStoryWaitingWho(w)].filter(Boolean)
            : w.kind === 'import' ? [importAskRowWho(w)] : [personByRefn(w.person)].filter((p): p is Person => !!p).map(fullName);
        // A number the section's search matched (spec 083 §1): the amber tag, that part left out of the line.
        if (hit?.t) meta.appendChild(searchHitTag(researchTaskRef(w.id) ?? w.id));
        if (hit?.p && w.person) {
            const person = personByRefn(w.person);
            const name = person ? fullName(person) : '';
            meta.appendChild(searchHitTag(name ? `${w.person} ${name}` : w.person));
            if (name) people = people.filter((n, i) => n !== name || people.indexOf(n) !== i);
            if (people.length > 0) meta.appendChild(el('span', 'research-overview__waiting-who', people.join(', ')));
        } else {
            meta.appendChild(el('span', people.length > 0 ? 'research-overview__waiting-who' : 'research-overview__muted', people.length > 0 ? people.join(', ') : L.wholeResearch));
        }
        const img = imagesState(w);
        if (img) meta.appendChild(imagesShortEl(itemKey(s, w.id), img));
        if (waitingPhase(w) === 'sent') {
            // The day it went out as the research says it (`sentDay`), counted by the calendar (spec 149 K1.4).
            const day = waitingSentDayOf(w.sentAt ? w : { sentAt: w.at });
            if (day) {
                const now = researchNow();
                const lang = getCurrentLanguage();
                const sent = meta.appendChild(el('span', 'research-overview__waiting-sent', L.waitingSentOn(waitingDayShown(day, now, lang))));
                sent.dataset.day = day;
                meta.appendChild(el('span', 'research-overview__waiting-age', waitingDayAgo(day, now, lang)));
            }
        } else if (!isTimeOrder(drawnAs.order)) {
            // A time order says it beside the row instead.
            const at = timeEl(w.at, 'ago');
            if (at) meta.appendChild(at);
        }
        // Without groups: the place it belongs to (spec 083 K5.2).
        if (drawnAs.flat) meta.appendChild(waitingGroupTagEl(w));
        row.appendChild(meta);
        // "Most helpful" (spec 105 K4.1): why it helps, quiet under the row.
        const gainWhy = waitingGainEl(w, drawnAs.order, 'span', 'research-overview__muted');
        if (gainWhy) row.appendChild(gainWhy);
        // The "new" tag (any order) over the time it has waited since (a time order).
        let side = waitingSideEl(w, { isNew: view.tagged.has(w.id), time: isTimeOrder(drawnAs.order) });
        // Its own write not confirmed yet (§7, 7a): "saving" with the small spinner at the row's end.
        const note = this.waitingRowNote(s, w.id);
        if (note?.kind === 'saving') {
            side ??= el('span', 'research-overview__waiting-side');
            side.appendChild(busyStatusEl(strings.busy.savingRow));
        }
        if (side) {
            row.classList.add('has-side');
            row.appendChild(side);
        }
        row.onclick = () => {
            view.detail = open ? null : w.id;
            // One thing at a time: an answer being written closes (its draft stays); what arrived was seen.
            closeAnswerForm();
            if (open) {
                forgetImagesArrived(itemKey(s, w.id));
                foldOverviewImages(itemKey(s, w.id));
            }
            this.renderResearchOverview();
        };
        li.appendChild(row);
        // Refused (§7): back where it was, tinted until the next action in it or 10 s, its sentence with Try again.
        if (note?.kind === 'refused') {
            if (note.tint) li.classList.add('is-refused');
            if (note.refusal.text) li.appendChild(this.waitingRowRefusalEl(s, w.id, note.refusal));
            li.addEventListener('click', () => {
                if (this.touchWaitingRow(s, w.id)) li.classList.remove('is-refused');
            }, true);
        }
        // Just fixed (spec 109 §2.4): its title in view and focused once drawn where it now belongs.
        auditFixedRowDrawn(itemKey(s, w.id), row);
        // One person's items the card's ! led to: lit, with why they cannot be answered here.
        markWaitingFocus(li, w);
        const why = waitingWhyEl(w);
        if (why) li.appendChild(why);
        // Files dropped on an item that takes images: its detail opens with them (spec 048 §3).
        if (mode !== 'sheet' && waitingActions(w, { writes: this.liveWaitingWrites(s), links: false, phone: false })?.some(v => v.key === 'images')) {
            li.classList.add('takes-images');
            bindImagesDrop(li, (files) => this.openWaitingImages(s, w, files));
        }
        const person = personByRefn(w.person);
        if (person) {
            li.classList.add('has-person');
            li.dataset.person = person.id;
        }
        if (open) {
            const detail = this.overviewWaitingDetail(s, w, mode);
            detail.id = detailId;
            li.appendChild(detail);
        }
        return li;
    },

    /** A refused write's sentence in its row (`role=alert` on its first drawing only), "Try again" and the seal's way. */
    waitingRowRefusalEl(s: LiveSession, id: string, r: RowRefusal): HTMLElement {
        const msg = el('div', 'busy-msg is-err research-overview__waiting-note');
        if (!r.said) {
            msg.setAttribute('role', 'alert');
            r.said = true;
        }
        msg.tabIndex = -1;
        msg.appendChild(el('span', undefined, r.text));
        if (r.retry) {
            const again = el('button', 'link', strings.busy.retry);
            again.type = 'button';
            again.dataset.action = 'write-retry';
            again.onclick = (e) => {
                e.stopPropagation();
                this.retryWaitingRow(s, id);
            };
            msg.appendChild(again);
        }
        if (r.alt) {
            const alt = r.alt;
            const b = el('button', 'link');
            setResearchActionLabel(b, alt.label, alt.ai ? 'agent' : alt.research ? 'terminal' : 'none');
            b.type = 'button';
            b.onclick = (e) => {
                e.stopPropagation();
                alt.run();
            };
            msg.appendChild(b);
        }
        return msg;
    },

    /**
     * An item's detail (its text whole in the open row above, not again):
     * what it waits on and whom, its text's addresses as links, the images,
     * the person · direction, and its actions. A story and a growing branch
     * keep their own.
     */
    overviewWaitingDetail(s: LiveSession, w: LiveWaiting, mode: Mode): HTMLElement {
        const L = strings.live;
        const detail = el('div', 'research-overview__waiting-detail');
        if (w.kind === 'story') {
            // A story's new version (its label and whose it is stand in the row): the names as links, the comparison here.
            const who = storyPeopleLinks(w, (id) => this.overviewShowPerson(id, mode));
            if (who) {
                const meta = el('div', 'research-overview__waiting-meta');
                meta.appendChild(who);
                detail.appendChild(meta);
            }
            const actions = el('div', 'research-overview__waiting-actions');
            actions.appendChild(this.storyCompareButton(w));
            detail.appendChild(actions);
            return detail;
        }
        if (w.kind === 'houseStory') {
            // A house's story (spec 145 T4; its text stands in the row): "House čp. N ›" to its page at the story.
            const actions = el('div', 'research-overview__waiting-actions');
            actions.appendChild(this.houseStoryOpenButton(w));
            detail.appendChild(actions);
            return detail;
        }
        if (w.kind === 'branch') {
            // A growing branch: its person, then the answers through the bridge (a phone says where).
            const person = personByRefn(w.person);
            if (person) {
                const meta = el('div', 'research-overview__waiting-meta');
                const link = el('button', 'live-person-link');
                link.innerHTML = fitNameHtml(person, fullName(person));
                link.type = 'button';
                link.onclick = () => this.overviewShowPerson(person.id, mode);
                meta.appendChild(link);
                detail.appendChild(meta);
            }
            this.appendBranchWaitingActions(detail, w, s);
            return detail;
        }
        if (w.kind === 'aside') {
            // A file of a book's inbox set aside: the image it is compared with, the book's folder, the answers through the bridge.
            this.appendAsideWaitingActions(detail, w, s);
            return detail;
        }
        if (w.kind === 'import') {
            // A question about a send of the app (1127): the send, what Yes would change, the answers through the bridge.
            this.appendImportAskDetail(detail, w, s);
            return detail;
        }
        // Images, a website or a check (spec 048 U6): the actions of their kind, an answer written here, the images' state.
        const writes = this.liveWaitingWrites(s);
        // "Retry with the agent" (spec 089 §1.2) stands among the actions of an item without the Deliver block.
        // A device of the home network (spec 094 §4, 4.4): its photos go with the item, as a computer's files do.
        const phoneOnly = mode === 'sheet' && !inDeviceMode();
        let views = waitingActions(w, { writes, links: mode !== 'sheet' && this.researchLinkAvailable('task'), phone: phoneOnly, retry: true });
        const key = itemKey(s, w.id);
        // The body (spec 105 U4 §3): the text stands once, whole, in the open row above; first what changed of the answer,
        // then what it waits on, the images, the browser's note, the person · direction, the actions and their hint.
        if (views && answerChanged.has(key)) detail.appendChild(waitingAnswerChangedNote());
        // Images to deliver (spec 105 U4 §5): what and where first, the steps in their order (hidden while the upload
        // area is open or an answer is written); a phone only says where they are saved.
        const deliver = !!views && this.waitingTakesImages(s, w);
        // With the Deliver block, "Retry with the agent" has its own row under the Now line (waitingRetryEl).
        if (deliver) views = views!.filter(v => v.key !== 'retry');
        if (deliver) {
            const task = researchTaskRef(w.id);
            const busy = !!this.overviewImagesArea(s, w)
                || (answeringKey === key && !!task && views!.some(v => v.key === 'answer' && v.via === 'bridge'));
            // The one filled button of the item: Retry when it is the main action, "Add images" then outlined.
            const retryMain = !!w.retry && this.waitingRetryOffered(s, w, mode) && waitingRetryMain(w.retry);
            detail.appendChild(this.waitingDeliverEl(s, w, { phone: phoneOnly, steps: !busy, retryMain }));
        }
        const onBox = this.overviewWaitingOnBox(s, w);
        if (onBox) detail.appendChild(onBox);
        // The addresses of its text: links here (the row is a button and holds none).
        const links = textWithLinks(w.what).filter(p => p.url);
        if (links.length > 0) {
            const line = el('div', 'research-overview__waiting-links');
            appendLinkedText(line, links.map(p => p.text).join(' '));
            detail.appendChild(line);
        }
        const img = views ? imagesState(w) : null;
        if (img) appendImagesDetail(detail, img, { allImages: !!views && waitingAllImagesOffered(w, views) });
        // An archive only the agent's browser reaches (spec 048 §11.2): under the book, unless its group's heading says it.
        // An item that can go back to the agent says why it waits in its Now line instead (spec 089 §2).
        const bNote = views && !w.retry && !browserNotedInHead.has(key) ? browserNote(s.browser, w, s.waiting, this.overviewBrowserContext(mode)) : null;
        const bNoteEl = bNote ? this.browserNoteEl(bNote, s.researchId) : null;
        if (bNoteEl) detail.appendChild(bNoteEl);
        // Its button there too with the Deliver block, or without actions of its kind; else among the actions below.
        const retryEl = this.waitingRetryEl(s, w, mode, deliver || !views);
        if (retryEl) detail.appendChild(retryEl);
        // A finding of how the task is recorded (spec 109 §1.2): under what it waits on and its images, above its actions.
        const audit = this.waitingAuditEl(s, w, mode);
        if (audit) detail.appendChild(audit);
        const meta = el('div', 'research-overview__waiting-meta');
        const person = personByRefn(w.person);
        // A question of a house (spec 030 §14): "House čp. 16 ›" to its page (the tree's house only).
        const houseRow = this.houseOfWaiting(w.id);
        const house = houseRow ? this.treeHouseOf(houseRow.key) : null;
        if (person) {
            const link = el('button', 'live-person-link');
            link.innerHTML = fitNameHtml(person, fullName(person));
            link.type = 'button';
            link.onclick = () => this.overviewShowPerson(person.id, mode);
            meta.appendChild(link);
        } else if (!house) {
            meta.appendChild(el('span', 'research-overview__muted', L.wholeResearch));
        }
        if (house) {
            const link = el('button', 'link-button house-page-link live-waiting-house', strings.houses.integration.houseLink(houseLabel(house.text)));
            link.type = 'button';
            link.dataset.house = house.id;
            link.onclick = () => this.openHouse(house.id);
            meta.appendChild(link);
        }
        const dir = taskDirectionName(s, w.research);
        if (dir) meta.appendChild(el('span', 'research-overview__dir', `· ${dir}`));
        if (!img && w.inbox?.want !== undefined) meta.appendChild(el('span', 'research-overview__waiting-inbox', L.waitingInbox(w.inbox.have, w.inbox.want)));
        detail.appendChild(meta);
        if (views) {
            this.appendWaitingTaskActions(detail, s, w, views, mode, deliver);
            // Not beside the open "Have images" area or an answer being written.
            if (detail.querySelector('.waiting-upload, .waiting-answer')) {
                bNoteEl?.remove();
                retryEl?.remove();
            }
            return detail;
        }

        const actions = el('div', 'research-overview__waiting-actions');
        // The research runs on the computer: a phone gets no (research) into it, only the bridge's writes.
        const hint = this.appendWaitingActions(actions, w, s, mode);
        if (w.url) {
            const web = el('a', 'live-waiting-answer research-overview__waiting-web', L.waitingOpenWeb);
            web.href = w.url;
            web.target = '_blank';
            web.rel = 'noopener noreferrer';
            actions.appendChild(web);
            appendWaitingWebHost(web, w.url);
        }
        if (actions.childElementCount > 0) detail.appendChild(actions);
        if (hint) detail.appendChild(el('p', 'research-overview__waiting-hint', L.waitingAnswerHint));
        if (mode === 'sheet') detail.appendChild(el('div', 'research-overview__muted', L.answerOnComputer));
        return detail;
    },

    /**
     * "Retry with the agent" may be offered at an item (spec 089 §1.2, §7):
     * the bridge here takes it, the item can go back now and it is not a
     * phone. An item whose `retry` came while the bridge does not answer
     * here keeps its Now line, without the button.
     */
    waitingRetryOffered(s: LiveSession, w: LiveWaiting, mode: Mode): boolean {
        return mode !== 'sheet' && !!w.retry?.can && !!researchTaskRef(w.id) && this.liveWaitingWrites(s).retry;
    },

    /** The item's "Retry with the agent" as an action: its count after the name, disabled while its write runs. */
    waitingRetryAction(s: LiveSession, w: LiveWaiting): ItemAction | null {
        if (!w.retry) return null;
        return {
            key: 'retry', label: strings.live.waitingRetry.action, write: true,
            count: waitingRetryCount(w.retry, getCurrentLanguage()) || undefined,
            disabled: this.waitingRowNote(s, w.id)?.kind === 'saving',
            run: () => { void this.retryWaitingItem(s, w); },
        };
    },

    /**
     * Why an item that can go back to the agent waits now, and what can be
     * done (spec 089 §2, §3, §6, §8): the Now line (the extension's link
     * after it on a computer), then — `button` — "Retry with the agent"
     * (filled when it is the main action, else outlined), or the limit in
     * its place (back three times in 24 hours), or on a phone where it is
     * done. Null for an item without `retry` (an older research: today's
     * detail). Without `button` the button stands among the item's actions.
     */
    waitingRetryEl(s: LiveSession, w: LiveWaiting, mode: Mode, button = true): HTMLElement | null {
        const r = w.retry;
        if (!r) return null;
        const R = strings.live.waitingRetry;
        const lang = getCurrentLanguage();
        const box = el('div', 'research-overview__waiting-retry');
        // Said once in its place's band for all its items (frame 9): only the button here.
        const reason = browserNotedInHead.has(itemKey(s, w.id)) ? null : waitingRetryReason(w, lang);
        if (reason) box.appendChild(this.waitingNowEl(s, reason, mode));
        const limit = waitingRetryLimitText(r, lang);
        if (limit) {
            box.appendChild(el('p', 'research-overview__waiting-hint', limit));
        } else if (mode === 'sheet') {
            box.appendChild(el('p', 'research-overview__muted waiting-phone-note', R.phone));
        } else if (button && this.waitingRetryOffered(s, w, mode)) {
            const a = this.waitingRetryAction(s, w)!;
            const row = el('div', 'research-overview__waiting-actions waiting-actions');
            row.appendChild(waitingActionEl(a, waitingRetryMain(r) ? 'primary' : 'secondary'));
            box.appendChild(row);
        }
        return box.childElementCount > 0 ? box : null;
    },

    /**
     * The open item's rows of "Retry with the agent" for the guessed height
     * in the own window's columns (spec 089 §8): its Now line, and the button
     * or the limit in its place.
     */
    waitingRetryOpenRows(s: LiveSession, mode: Mode): number {
        const w = s.waitingView.detail ? s.waiting.find(x => x.id === s.waitingView.detail) : undefined;
        if (!w?.retry) return 0;
        const now = waitingRetryReason(w, getCurrentLanguage()) ? 1 : 0;
        return now + (!w.retry.can || this.waitingRetryOffered(s, w, mode) ? 1 : 0);
    },

    /**
     * "Waiting on" of an item's detail (spec 105 U4 §3, 3b–3h): the research's
     * whole instruction in a framed block — its heading, the text (addresses
     * as links) clamped at 10 lines (3 on a phone held sideways) with "more"
     * / "less" only when it overflows (kept under `on:<id>`), and whom it goes
     * to as its second line. None when it waits on the user alone ("user"
     * only repeats the heading); then whom it goes to stands on its own.
     */
    overviewWaitingOnBox(s: LiveSession, w: LiveWaiting): HTMLElement | null {
        const L = strings.live;
        const to = (): HTMLElement => {
            const line = el('p', 'research-overview__waiting-to');
            line.append(el('span', 'research-overview__waiting-to-label', L.waitingToLabel), ' ', w.to!);
            return line;
        };
        if (waitsOnUser(w.on)) return w.to ? to() : null;
        const box = el('div', 'research-overview__waiting-on-box');
        box.appendChild(el('span', 'research-overview__waiting-on-label', L.waitingOnLabel));
        const text = el('p', 'research-overview__waiting-on');
        appendLinkedText(text, w.on!);
        box.append(text, waitingOnMoreEl(text, w.id, s.waitingView.open));
        if (w.to) box.appendChild(to());
        return box;
    },

    /**
     * The actions of an item waiting for images, a website or a check (spec
     * 048 §1, §5, §9), by weight: the main one filled, the next outlined, the
     * rest as links; beyond two beside it, "More actions" (⋯). The research's
     * other actions it offers (Sent, a file, the query's text) come after
     * them. "Answer" through the bridge opens the answer in the detail (the
     * actions hide meanwhile); through the terminal, its hint goes under them.
     */
    appendWaitingTaskActions(detail: HTMLElement, s: LiveSession, w: LiveWaiting, views: readonly WaitActionView[], mode: Mode, deliver = false): void {
        const L = strings.live;
        const T = L.waitingTask;
        const W = L.waitingWrite;
        const key = itemKey(s, w.id);
        const task = researchTaskRef(w.id);
        const phone = mode === 'sheet';
        // The upload area of "Add images" (spec 048 §3): open, the actions hide meanwhile.
        const area = (!phone || inDeviceMode()) && views.some(v => v.key === 'images') ? this.overviewImagesArea(s, w) : null;
        if (area) {
            detail.appendChild(area);
            return;
        }
        // How the last upload left it (until the detail folds).
        const result = overviewImagesResult(key);
        if (result) {
            const line = el('p', 'waiting-images-result', result);
            line.setAttribute('role', 'status');
            detail.appendChild(line);
        }
        // The answer written in the detail (a phone: its own sheet).
        if (!phone && answeringKey === key && task && views.some(v => v.key === 'answer' && v.via === 'bridge')) {
            detail.appendChild(this.overviewAnswerForm(s, w, task, answeringMode).root);
            return;
        }
        if (answeringKey === key) closeAnswerForm();
        // With a finding shown, Discuss with the agent lives in its row (spec 109 §3), not again here.
        const audited = !!waitingAuditShown(s, w);
        const list: ItemAction[] = [];
        // What the day of a Sent opens under: the actions' row (its ⋯), else the detail (asked at the click).
        const actionsAnchor = (): HTMLElement => detail.querySelector<HTMLElement>('.waiting-more') ?? detail.querySelector<HTMLElement>('.waiting-actions') ?? detail;
        for (const v of views) {
            if (v.key === 'chat' && audited) continue;
            // Back to the agent through the bridge (spec 089 §1.2): no mark, its count on the button.
            if (v.key === 'retry') {
                const a = this.waitingRetryAction(s, w);
                if (a) list.push(a);
                continue;
            }
            if (v.key === 'web') {
                if (w.url) list.push({ key: 'web', label: T.openWeb, href: w.url });
            } else if (v.key === 'images') {
                list.push({ key: 'images', label: T.haveImages, run: () => this.openWaitingImages(s, w) });
            } else if (v.key === 'answer' && v.via === 'bridge') {
                // A count of images not known: "All images added" first, the same answer through the bridge with its fixed text.
                if (waitingAllImagesOffered(w, views)) {
                    list.push({ key: ALL_IMAGES, label: T.allImages, run: () => phone ? this.openWaitingAnswerSheet(s, w, 'all-images') : this.openOverviewAnswer(s, w, 'all-images') });
                }
                list.push({ key: 'answer', label: T.answer, run: () => phone ? this.openWaitingAnswerSheet(s, w) : this.openOverviewAnswer(s, w) });
            } else if (task) {
                const taskDo = v.key === 'answer' ? undefined : v.key;
                const url = this.activeResearchLink('task', { task, taskDo });
                if (!url) continue;
                const label = v.key === 'answer' ? T.answer : v.key === 'chat' ? T.discuss : T.openFolder;
                list.push({ key: v.key, label, mark: researchLinkMark('task', { taskDo }), run: () => this.launchResearchLink(url) });
            }
        }
        // What else the research offers at the task (its writes through the bridge where it takes them).
        const writes = this.liveWaitingWrites(s);
        const links = mode !== 'sheet' && !!task && this.researchLinkAvailable('task');
        for (const action of waitingTaskActions(w) ?? []) {
            if (!task || action === 'answer' || action === 'chat' || action === 'folder') continue;
            if (action === 'sent' && writes.sent && waitingSendable(w)) {
                list.push({ key: 'sent', label: W.sent, write: true, run: () => this.askWaitingSentDay(s, actionsAnchor(), { kind: 'sent', w }) });
            } else if (action === 'file' && writes.file && waitingFileWritable(w)) {
                list.push({ key: 'file', label: W.file, write: true, run: () => this.pickWaitingFile(s, w) });
            } else if (links) {
                const url = this.activeResearchLink('task', { task, taskDo: waitingActionDo(action) });
                if (url) list.push({ key: action, label: L.waitingActions[action], mark: researchLinkMark('task', { taskDo: waitingActionDo(action) }), run: () => this.launchResearchLink(url) });
            }
        }
        if (task && writes.sent && waitingUnsendable(w)) {
            list.push({ key: 'unsent', label: W.unsent, write: true, run: () => { void this.markWaitingUnsent(s, w.id); } });
            // A sent request's day changed afterwards (spec 149 K2.1).
            if (writes.sentDay) list.push({ key: 'sent-day', label: W.changeSentDay, write: true, run: () => this.askWaitingSentDay(s, actionsAnchor(), { kind: 'change', w }) });
        }
        // The showcase (spec 143 K4.1): the answer greyed, the website read; nothing else is written or asked.
        // "All images added" is an answer too.
        if (inShowcase()) showcaseItemActions(list, ['answer', ALL_IMAGES], showcaseOff('waiting-answer'));
        const moreBtn = (more: readonly ItemAction[]): HTMLElement => {
            const btn = el('button', 'waiting-more', '⋯');
            btn.type = 'button';
            btn.dataset.more = w.id;
            btn.title = T.more;
            btn.setAttribute('aria-label', T.more);
            btn.setAttribute('aria-haspopup', 'menu');
            btn.setAttribute('aria-expanded', String(moreMenuFor === w.id));
            btn.onclick = (e) => {
                e.stopPropagation();
                this.openWaitingMoreMenu(btn, w.id, more);
            };
            return btn;
        };
        let shown: ItemAction[];
        let more: ItemAction[];
        if (deliver) {
            // Images to deliver (spec 105 U4 §5): the website, the folder and "Add images" are the Deliver block's steps;
            // the answer is "Images can't be obtained…" as a link, the rest under ⋯ (none on a phone).
            const rest = list.filter(a => a.key !== 'images' && a.key !== 'web' && a.key !== 'folder');
            const answer = rest.find(a => a.key === 'answer') ?? null;
            // A count of images not known: "All images added" outlined before the link (spec 105 U4 §5 + K044).
            const all = rest.find(a => a.key === ALL_IMAGES) ?? null;
            shown = [all, answer].filter((a): a is ItemAction => !!a);
            more = phone ? [] : rest.filter(a => a !== answer && a !== all);
            if (shown.length > 0 || more.length > 0) {
                const row = el('div', 'research-overview__waiting-actions waiting-actions is-deliver');
                if (all) row.appendChild(waitingActionEl(all, 'secondary'));
                if (answer) {
                    const link = el('button', 'link-button waiting-cannot-get');
                    link.type = 'button';
                    link.dataset.action = 'answer';
                    if (answer.mark) setResearchActionLabel(link, T.cannotGet, answer.mark);
                    else link.textContent = T.cannotGet;
                    if (answer.off) markShowcaseOff(link, answer.mark ?? 'none', answer.label);
                    link.onclick = (e) => {
                        e.stopPropagation();
                        answer.run?.();
                    };
                    row.appendChild(link);
                }
                if (more.length > 0) row.appendChild(moreBtn(more));
                detail.appendChild(row);
            }
        } else {
            ({ shown, more } = splitWaitingActions(list, { phone: mode === 'sheet' }));
            if (shown.length > 0) {
                const row = el('div', 'research-overview__waiting-actions waiting-actions');
                shown.forEach((a, i) => {
                    const action = row.appendChild(waitingActionEl(a, i === 0 ? 'primary' : i === 1 ? 'secondary' : 'link'));
                    if (a.key === 'web' && a.href) appendWaitingWebHost(action, a.href);
                });
                if (more.length > 0) row.appendChild(moreBtn(more));
                detail.appendChild(row);
            }
        }
        // Answered in the terminal: the answer is kept with the task.
        if ([...shown, ...more].some(a => a.key === 'answer' && !!a.mark)) {
            detail.appendChild(el('p', 'research-overview__waiting-hint', T.answerHintOld));
        }
        // A phone adds no images and answers only through the bridge: it says where the rest is done
        // (images to deliver say it in their Deliver block).
        if (phone && waitingForImages(w) && !deliver) detail.appendChild(el('p', 'research-overview__muted waiting-phone-note', T.phoneImages));
        if (phone && !views.some(v => v.key === 'answer' && v.via === 'bridge')) {
            detail.appendChild(el('p', 'research-overview__muted waiting-phone-note', T.phoneNoAnswer));
        }
    },

    /** The answer being written in the overview closes (its draft stays). */
    closeOverviewAnswer(): void {
        closeAnswerForm();
    },

    /**
     * "Answer" through the bridge: the answer opens in the item's detail, the
     * field focused (its draft back); `all-images`: "All images added", its
     * fixed answer with an optional note.
     */
    openOverviewAnswer(s: LiveSession, w: LiveWaiting, mode: WaitingAnswerMode = 'answer'): void {
        closeAnswerForm();
        answeringKey = itemKey(s, w.id);
        answeringMode = mode;
        this.closeWaitingMoreMenu();
        this.renderResearchOverview();
        const form = answerForms.get(answerFormKey(answeringKey, mode));
        if (form?.root.isConnected) form.focus();
    },

    /** The item's answer form, the same node over every redraw (what is written, the caret, an error). */
    overviewAnswerForm(s: LiveSession, w: LiveWaiting, task: string, mode: WaitingAnswerMode = 'answer'): WaitingAnswerForm {
        const key = itemKey(s, w.id);
        const formKey = answerFormKey(key, mode);
        let form = answerForms.get(formKey);
        if (form && !form.spent) return form;
        const focusAnswer = (): void => {
            this.renderResearchOverview();
            const li = document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(w.id)}"]`);
            li?.querySelector<HTMLElement>(`[data-action="${mode === 'answer' ? 'answer' : ALL_IMAGES}"]`)?.focus();
        };
        form = new WaitingAnswerForm({
            treeId: s.treeId, task, idPrefix: `ov-${mode}-${w.id}`,
            ...(mode === 'all-images' ? allImagesAnswerTexts() : this.waitingAnswerTexts(s, w)),
            send: async (text) => {
                // The item as the research says it now (its wording may have changed meanwhile).
                const now = s.waiting.find(x => x.id === w.id) ?? w;
                const outcome = await this.sendWaitingAnswer(s, now, text);
                if (outcome === 'changed') {
                    answerChanged.add(key);
                    this.renderResearchOverview();
                } else if (outcome !== 'busy' && outcome !== 'fail' && outcome !== 'skipped') {
                    answerChanged.delete(key);
                }
                return outcome;
            },
            cancel: () => {
                closeAnswerForm();
                focusAnswer();
            },
            done: () => {
                answerForms.delete(formKey);
                if (answeringKey === key) closeAnswerForm();
                answerChanged.delete(key);
                this.renderResearchOverview();
            },
        });
        answerForms.set(formKey, form);
        return form;
    },

    /** "More actions" of an item: a menu under ⋯ (Escape, a click elsewhere or a choice closes it). */
    openWaitingMoreMenu(anchor: HTMLElement, id: string, items: readonly ItemAction[]): void {
        const wasOpen = moreMenuFor === id;
        this.closeWaitingMoreMenu();
        if (wasOpen) return;
        const T = strings.live.waitingTask;
        const menu = el('div', 'context-menu waiting-more-menu');
        menu.id = 'waiting-more-menu';
        menu.dataset.id = id;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', T.more);
        const button = (): HTMLElement | null =>
            document.querySelector<HTMLElement>(`#research-overview .waiting-more[data-more="${CSS.escape(id)}"]`);
        for (const a of items) {
            const item = a.href ? el('a', 'context-menu-item waiting-more-menu__item') : el('div', 'context-menu-item waiting-more-menu__item');
            if (a.mark) setResearchActionLabel(item, a.label, a.mark);
            else item.textContent = a.label;
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.action = a.key;
            if (a.write) item.dataset.write = 'bridge';
            if (item instanceof HTMLAnchorElement && a.href) {
                item.href = a.href;
                item.title = a.href;
                item.target = '_blank';
                item.rel = 'noopener noreferrer';
                item.onclick = () => this.closeWaitingMoreMenu();
            } else {
                const go = (): void => {
                    this.closeWaitingMoreMenu();
                    a.run?.();
                };
                item.onclick = go;
                item.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
                };
            }
            menu.appendChild(item);
        }
        document.body.appendChild(menu);
        moreMenuFor = id;
        anchor.setAttribute('aria-expanded', 'true');
        const rect = anchor.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
        const below = rect.bottom + 4;
        const top = below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menu.offsetHeight - 4) : below;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        (menu.firstElementChild as HTMLElement | null)?.focus();
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeWaitingMoreMenu();
                button()?.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const all = [...menu.querySelectorAll<HTMLElement>('.context-menu-item')];
                const i = all.indexOf(document.activeElement as HTMLElement);
                all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
            } else if (e.key === 'Tab') {
                this.closeWaitingMoreMenu();
            }
        };
        const onDown = (e: Event): void => {
            const t = e.target as Node;
            if (!menu.contains(t) && !button()?.contains(t)) this.closeWaitingMoreMenu();
        };
        document.addEventListener('keydown', onKey, true);
        const arm = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
        moreMenuCleanup = () => {
            clearTimeout(arm);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            button()?.setAttribute('aria-expanded', 'false');
        };
    },

    closeWaitingMoreMenu(): void {
        moreMenuCleanup?.();
        moreMenuCleanup = null;
        moreMenuFor = null;
        document.getElementById('waiting-more-menu')?.remove();
    },

    /**
     * The item's actions: "Sent", "Back to To do" and "Add a file" through
     * the bridge where it takes them (waiting.sent, accepts.media.task; a
     * phone too), the other task link's actions it offers (`actions`; only
     * on a computer whose research takes task links), else "Answer (research)" as
     * before. True when "Answer (research)" saves the answer with the task (the hint
     * goes under it).
     */
    appendWaitingActions(host: HTMLElement, w: LiveWaiting, s: LiveSession, mode: Mode): boolean {
        const L = strings.live;
        const W = L.waitingWrite;
        // A question about a place: its card, answered through the bridge (without it: as any item).
        if (w.kind === 'place' && this.waitingPlacesAccess().canAnswer) {
            const btn = el('button', 'live-waiting-answer research-overview__waiting-action is-primary', strings.places.waiting.answer);
            btn.type = 'button';
            btn.dataset.action = 'place';
            btn.onclick = () => this.showWaitingPlaces(w.place ?? w.id);
            if (inShowcase()) markShowcaseOff(btn, 'none');
            host.appendChild(btn);
            return false;
        }
        const offered = waitingTaskActions(w);
        const task = researchTaskRef(w.id);
        const writes = this.liveWaitingWrites(s);
        const links = mode !== 'sheet' && !!offered && !!task && this.researchLinkAvailable('task');
        const appendUnsent = (): void => {
            if (task && writes.sent && waitingUnsendable(w)) {
                host.appendChild(this.waitingWriteButton(W.unsent, 'unsent', () => { void this.markWaitingUnsent(s, w.id); }));
                // A sent request's day changed afterwards (spec 149 K2.1).
                if (writes.sentDay) {
                    const day: HTMLButtonElement = this.waitingWriteButton(W.changeSentDay, 'sent-day',
                        () => this.askWaitingSentDay(s, day, { kind: 'change', w }), undefined, false);
                    host.appendChild(day);
                }
            }
        };
        // With a finding shown, Discuss with the agent lives in its row (spec 109 §3), not again here.
        const audited = !!waitingAuditShown(s, w);
        if (offered && task && (links || writes.sent || writes.file)) {
            let answer = false;
            for (const action of offered) {
                if (action === 'chat' && audited) continue;
                if (action === 'sent' && writes.sent && waitingSendable(w)) {
                    // The day it went out is asked first where the bridge takes it (spec 149 K2.1).
                    const sent: HTMLButtonElement = this.waitingWriteButton(W.sent, 'sent',
                        () => this.askWaitingSentDay(s, sent, { kind: 'sent', w }), undefined, !writes.sentDay);
                    host.appendChild(sent);
                    continue;
                }
                if (action === 'file' && writes.file && waitingFileWritable(w)) {
                    host.appendChild(this.waitingWriteButton(W.file, 'file', () => this.pickWaitingFile(s, w), undefined, false));
                    continue;
                }
                if (!links) continue;
                const url = this.activeResearchLink('task', { task, taskDo: waitingActionDo(action) });
                if (!url) continue;
                const btn = setResearchActionLabel(el('button', 'live-waiting-answer research-overview__waiting-action'), L.waitingActions[action], researchLinkMark('task', { taskDo: waitingActionDo(action) }));
                btn.type = 'button';
                btn.dataset.action = action;
                if (action === 'chat' && waitingChatLeads(w)) btn.classList.add('is-primary');
                btn.onclick = () => this.launchResearchLink(url);
                host.appendChild(btn);
                if (action === 'answer') answer = true;
            }
            appendUnsent();
            if (links) return answer;
        } else {
            appendUnsent();
        }
        if (mode === 'sheet' || !this.canAnswerResearchWaiting(w)) return false;
        const btn = setResearchActionLabel(el('button', 'live-waiting-answer research-overview__waiting-action'), strings.research.answer, researchLinkMark('task'));
        btn.type = 'button';
        btn.dataset.action = 'answer';
        btn.onclick = () => this.answerResearchTask(w);
        host.appendChild(btn);
        return false;
    },

    /** Now: who works on what, since when; "Show in tree" when the research names the person. */
    appendOverviewNow(body: HTMLElement, s: LiveSession, fold: LiveFold, mode: Mode): void {
        const L = strings.live;
        const w0 = s.working[0];
        const since0 = w0 ? Date.parse(w0.since) : NaN;
        // Now says who does what: by line while two or more lines work. The
        // line selected in the panel or the queue is only the queue's filter,
        // so it neither adds a row nor marks one here (Milan, 17 Nov 2026).
        const all = workingLineGroups(s);
        const multi = workingLineCount(all) >= 2;
        const groups = multi ? all : [];
        const lines = workingLineCount(groups);
        // "Work on the queue…" started from here (3a, 3b): its row stands until the session's own row comes.
        // With runs side by side (spec 126 U10) every start has its row, until its own run comes, whoever else works.
        const runsOn = runLinesOn(s.features);
        const starts = this.runStartsNow();
        const start = starts.find(x => x.scope === QUEUE_SCOPE)?.view ?? null;
        if (starts.length > 0 && (s.working.length > 0 || (s.runs?.length ?? 0) > 0)) {
            queueMicrotask(() => noteQueueStartStatus(s.researchId, { working: s.working, busy: s.busy, runs: s.runs }));
        }
        const starting = s.working.length === 0 || runsOn ? start : null;
        // A direction's dialog open meanwhile: "Start" held once its run cannot start any more (spec 126 U10 §2).
        if (runsOn && document.querySelector('#queue-work-modal[data-direction]')) queueMicrotask(() => this.syncLineRunDialog(s));
        const lineStarts = runsOn ? starts.filter(x => x.scope !== QUEUE_SCOPE) : [];
        // A block per run (spec 126 U10 §3) once a direction has its own run, or two run; a general run alone: Now as before.
        const runs = runsOn ? runsShown(s.bridge.base, liveRuns(s), Date.now()) : [];
        if (runs.some(r => r.kind === 'line') || runs.length >= 2) {
            this.appendOverviewNowRuns(body, s, fold, mode, runs, starts);
            return;
        }
        const host = liveSection(body, {
            ...fold, title: lines >= 2 ? strings.otherResearch.nowLines(lines) : L.now,
            summary: multi ? undefined
                : w0 ? [w0.who, w0.paused ? L.statePaused : Number.isFinite(since0) ? liveDuration(since0) : ''].filter(Boolean).join(' · ')
                : starting?.phase === 'starting' ? strings.busy.queueStarting
                : starting?.phase === 'silent' ? strings.busy.queueNotStarted : L.nobody,
            help: nowHelpTopic(s),
        });
        // First in Now: the other trees where an agent works or something waits (spec 011).
        this.appendResearchElsewhere(host, 'overview');
        const list = el('ul', 'live-panel-list live-working research-overview__now');
        host.appendChild(list);
        // A direction's run on its way (spec 126 U10 §1): its row first, "Starting… · Name (G0002)".
        for (const ls of lineStarts) list.appendChild(this.overviewQueueStartRow(ls.view, s.researches.find(d => d.id === ls.scope) ?? null, ls.scope));
        if (multi) {
            // Two or more lines at work: a row per line (spec 011).
            if (starting) list.appendChild(this.overviewQueueStartRow(starting));
            for (const g of groups) list.appendChild(this.overviewNowLine(g, mode));
            this.appendOverviewNowWork(host, s);
            return;
        }
        if (starting) list.appendChild(this.overviewQueueStartRow(starting));
        else if (s.working.length === 0 && lineStarts.length === 0) list.appendChild(inDeviceMode() || inShowcase() ? idleNowRow(s) : el('li', 'live-empty', L.nobody));
        for (const w of s.working) {
            const li = el('li', 'research-overview__now-row');
            if (w.run) li.dataset.run = w.run;
            if (w.research) li.dataset.direction = w.research;
            const text = el('div', 'research-overview__now-text');
            text.appendChild(el('strong', undefined, w.who));
            if (w.task) text.appendChild(el('span', 'live-task', ` — ${w.task}`));
            const saving = workingSavingEl(w);
            if (saving) text.appendChild(saving);
            // How the task helps its line, or its branch outside the lines; else the line's name (two or more lines).
            const why = workingWhyText(w, s);
            const dir = why || taskDirectionName(s, w.research);
            if (dir) text.appendChild(el('span', why ? 'research-overview__dir research-overview__why' : 'research-overview__dir', ` · ${dir}`));
            if (w.paused) text.appendChild(el('span', 'live-paused', pausedText(w)));
            const since = timeEl(w.since, 'sincefor');
            if (since) text.appendChild(since);
            appendWorkingHold(text, w);
            li.appendChild(text);
            // Its actions in a row of links under the text (the text keeps the whole width).
            const person = personByRefn(w.person);
            const actions = this.overviewNowActions(w, mode, person ? () => this.overviewShowPerson(person.id, mode) : null, s.features);
            if (actions) li.appendChild(actions);
            list.appendChild(li);
        }
        this.appendOverviewNowWork(host, s);
    },

    /**
     * Now's "Work on the queue…" (the Queue heading's action, its mark and its
     * conditions): offered while nothing runs, so Now starts the work as well
     * as it finishes it. While an agent works Now keeps "Finish and stop" only.
     */
    appendOverviewNowWork(host: HTMLElement, s: LiveSession): void {
        // The showcase (spec 143 K4.1): "Continue the research" stays in sight, greyed with its mark; a click says why.
        if (showcaseOff('work')) {
            const row = el('div', 'research-overview__now-actions research-overview__now-work');
            const btn = setResearchActionLabel(el('button', 'link-button research-overview__work'), strings.sample.continueResearch, researchLinkMark('work'));
            btn.type = 'button';
            row.appendChild(markShowcaseOff(btn, researchLinkMark('work')));
            host.appendChild(row);
            return;
        }
        // Runs side by side (spec 126 U10 §5): the directions' own runs leave it offered, the most at once hold it.
        if (!runsSideBySide(s) && s.working.length > 0) return;
        const offer = this.queueWorkOfferFor(s);
        if (offer !== 'offer' && offer !== 'limit') return;
        const row = el('div', 'research-overview__now-actions research-overview__now-work');
        if (offer === 'limit') {
            row.appendChild(this.queueWorkHeldButton('link-button research-overview__work', NOW_LIMIT_NOTE));
            host.appendChild(row);
            host.appendChild(this.queueWorkLimitNote(s, NOW_LIMIT_NOTE));
            return;
        }
        const btn = setResearchActionLabel(el('button', 'link-button research-overview__work'), strings.live.queueWork, researchLinkMark('work'));
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.onclick = () => this.showQueueWorkDialog(s, btn);
        this.drawQueueWorkStarting(btn);
        row.appendChild(btn);
        host.appendChild(row);
    },

    /**
     * Now's row while the queue's work starts (3a): the spinner, "Starting work on the queue…" and that the
     * agent starts in the research's terminal; after 30 s without a proof (3b) the question, the sentence with
     * Try again and the hint.
     */
    overviewQueueStartRow(start: QueueStartView, line: LiveDirection | null = null, scope?: string): HTMLElement {
        const b = strings.busy;
        const L = strings.live;
        const li = el('li', `live-now-starting${start.phase === 'silent' ? ' is-silent' : ''}`);
        // A direction's run (spec 126 U10 §1): "Starting… · Name (G0002)", its own question and Try again.
        if (scope) li.dataset.startScope = scope;
        const name = scope ? `${line?.name ?? scope} (${scope})` : '';
        const title = el('span', 'live-now-starting__title');
        if (start.phase === 'starting') {
            li.setAttribute('aria-busy', 'true');
            title.setAttribute('role', 'status');
            title.insertAdjacentHTML('afterbegin', busySpinHtml(14));
            title.appendChild(el('span', undefined, scope ? L.lineRunStarting(name) : b.queueStarting));
            li.appendChild(title);
            li.appendChild(el('span', 'live-now-starting__sub', scope ? L.lineRunStartingSub : b.queueStartingSub));
            return li;
        }
        title.textContent = scope ? `${L.lineRunNotStarted} · ${name}` : b.queueNotStarted;
        li.appendChild(title);
        // Neutral, as the terminal's own limit (§3.1): a terminal that did not answer may only be asking.
        const msg = el('div', 'busy-msg');
        msg.setAttribute('role', 'status');
        msg.appendChild(el('span', 'busy-msg__text', b.terminalSilent(Math.round(QUEUE_START_MS / 1000))));
        const retry = el('button', 'link busy-msg__retry', b.retry);
        retry.type = 'button';
        retry.onclick = () => this.retryQueueWork(scope);
        msg.appendChild(retry);
        msg.appendChild(el('span', 'hint', b.notOpenedHint));
        li.appendChild(msg);
        return li;
    },

    /**
     * A session's actions under its text in Now: Show in tree (when it has
     * whom to show) · Finish and stop (in the research: the agent writes up
     * what it found and closes the session; not on the phone's sheet).
     * Nothing to offer: no row.
     */
    overviewNowActions(w: LiveWorker, mode: Mode, show: (() => void) | null, features: readonly string[] | null = null): HTMLElement | null {
        const L = strings.live;
        const row = el('div', 'research-overview__now-actions');
        if (show) {
            const btn = el('button', 'link-button research-overview__show-in-tree', L.showInTree);
            btn.type = 'button';
            btn.onclick = show;
            row.appendChild(btn);
        }
        // A device of the home network (spec 094 §4, 4.3): "Stop run" through the bridge, without a mark.
        const runId = w.run;
        if (inDeviceMode() && runId && !w.paused && runStopOn(features) && researchDeviceAllows('run-stop')) {
            const btn = el('button', 'link-button research-overview__run-stop');
            btn.type = 'button';
            btn.title = L.runStopHint;
            if (runStopNote({ id: runId })?.state === 'stopping') {
                btn.setAttribute('aria-disabled', 'true');
                btn.setAttribute('aria-busy', 'true');
                btn.classList.add('is-busy');
                btn.innerHTML = `${busySpinHtml(12)}${researchBridgeActionLabel(L.runStopping, 'run-stop')}`;
            } else {
                btn.innerHTML = researchBridgeActionLabel(L.stopRun, 'run-stop');
                btn.onclick = () => void this.stopRun(runId);
            }
            row.appendChild(btn);
        }
        const finish = mode !== 'sheet' && w.session && !w.paused ? this.activeResearchLink('finish', { session: w.session }) : null;
        if (finish) {
            const btn = setResearchActionLabel(el('button', 'link-button research-overview__finish'), L.finishSession, researchLinkMark('finish'));
            btn.type = 'button';
            btn.title = L.finishHint;
            btn.onclick = () => this.launchResearchLink(finish);
            row.appendChild(btn);
        }
        return row.childElementCount > 0 ? row : null;
    },

    /**
     * A line in Now: glyph, "name — task", "agent · person · since · how
     * long", Show in tree (the line's people lit up; work outside the
     * directions: its person), Finish and stop (research) per session.
     */
    overviewNowLine(g: WorkingLine, mode: Mode): HTMLElement {
        const L = strings.live;
        const s = drawnSession();
        const li = el('li', 'research-overview__now-row research-overview__now-row--line');
        if (g.id) li.dataset.direction = g.id;
        const run = g.workers.find(w => w.run)?.run;
        if (run) li.dataset.run = run;
        const glyph = el('span', 'live-line__glyph', g.id ? directionGlyph(g.direction) : '·');
        glyph.setAttribute('aria-hidden', 'true');
        li.appendChild(glyph);
        const text = el('div', 'research-overview__now-text');
        const name = g.direction?.name ?? L.dirOutside;
        // Show in tree: the line's people lit up; work outside the directions: its person. Under the first session.
        const d = g.direction;
        const workerPerson = g.workers.map(w => personByRefn(w.person)).find((p): p is Person => !!p);
        const show = (d ? directionPersonIds(d) : workerPerson)
            ? () => (d ? this.showDirectionInTree(d, mode) : workerPerson && this.overviewShowPerson(workerPerson.id, mode))
            : null;
        g.workers.forEach((w, i) => {
            const head = el('div', 'research-overview__now-line');
            if (i === 0) head.appendChild(el('strong', undefined, name));
            if (w.task) head.appendChild(el('span', 'live-task', i === 0 ? ` — ${w.task}` : w.task));
            const saving = workingSavingEl(w, head.childNodes.length > 0);
            if (saving) head.appendChild(saving);
            text.appendChild(head);
            const meta = el('small', 'research-overview__now-meta');
            const person = personByRefn(w.person);
            const parts: (string | HTMLElement)[] = [w.who];
            if (person) parts.push(fullName(person));
            else if (w.person) parts.push(w.person);
            const why = s ? workingWhyText(w, s, true) : '';
            if (why) parts.push(el('span', 'research-overview__why', why));
            if (w.paused) parts.push(el('span', 'live-paused', pausedText(w)));
            else {
                const since = timeEl(w.since, 'sincefor');
                if (since) parts.push(since);
                const hold = workingHoldEl(w);
                if (hold) parts.push(hold);
            }
            parts.filter(Boolean).forEach((part, j) => meta.append(...(j > 0 ? [' · ', part] : [part])));
            text.appendChild(meta);
            // Each session its own row of actions under its text.
            const actions = this.overviewNowActions(w, mode, i === 0 ? show : null);
            if (actions) text.appendChild(actions);
        });
        // The line's people lit in the tree: its Show in tree says so in the own window.
        if (d) for (const b of text.querySelectorAll<HTMLElement>('.research-overview__show-in-tree')) lightsGroup(b, 'direction', d.name);
        li.appendChild(text);
        return li;
    },

    /**
     * Now with the runs side by side (spec 126 U10 §3): "Now · 3 agents", a block per run (the general run
     * first, then the directions' runs in their order), each start of §1 in the place its run comes to.
     */
    appendOverviewNowRuns(body: HTMLElement, s: LiveSession, fold: LiveFold, mode: Mode, runs: readonly LiveRun[],
        starts: ReadonlyArray<{ scope: string; view: QueueStartView }>): void {
        const L = strings.live;
        const n = runCount(runs);
        const names = runs.filter(r => r.state !== 'ended').map(r => runName(r, s.researches));
        const host = liveSection(body, {
            ...fold, title: n > 0 ? L.nowAgents(n) : L.now,
            summary: names.length > 0 ? names.join(', ') : L.nobody,
            help: nowHelpTopic(s),
        });
        this.appendResearchElsewhere(host, 'overview');
        const list = el('ul', 'live-panel-list live-working research-overview__now research-overview__runs');
        host.appendChild(list);
        // The starts not yet named by a run of the bridge, where their runs come.
        const shownStarts = starts.filter(x => x.scope === QUEUE_SCOPE
            ? !runs.some(r => r.kind === 'queue' && r.state !== 'ended')
            : !runs.some(r => r.kind === 'line' && r.research === x.scope && r.state !== 'ended'));
        type Item = { kind: 'queue' | 'line'; research?: string; draw: () => HTMLElement };
        const items: Item[] = [
            ...runs.map((r): Item => ({ kind: r.kind, ...(r.research ? { research: r.research } : {}), draw: () => this.overviewNowRun(r, s, runs, mode) })),
            ...shownStarts.map((x): Item => x.scope === QUEUE_SCOPE
                ? { kind: 'queue', draw: () => this.overviewQueueStartRow(x.view) }
                : { kind: 'line', research: x.scope, draw: () => this.overviewQueueStartRow(x.view, s.researches.find(d => d.id === x.scope) ?? null, x.scope) }),
        ];
        for (const it of orderRuns(items, s.researches)) list.appendChild(it.draw());
        // "Work on the queue…" while the general run does not work (held at the most runs at once).
        if (!shownStarts.some(x => x.scope === QUEUE_SCOPE)) this.appendOverviewNowWork(host, s);
        scheduleRunsEndedRedraw(runs, () => this.renderResearchOverview());
    },

    /**
     * A run's block in Now: its glyph, the direction's name and code (the general run: "Whole queue") and its
     * state; the agent and since when; the person and task of its last step; what it skips or finishes; its
     * actions (Show in tree · Stop · Finish and stop; on the phone Show in tree only; none once it ended).
     */
    overviewNowRun(run: LiveRun, s: LiveSession, runs: readonly LiveRun[], mode: Mode): HTMLElement {
        const L = strings.live;
        const local = runStopNote(run);
        const shown: LiveRun = local?.state === 'stopped' && (run.state === 'working' || run.state === 'waiting')
            ? { ...run, state: 'finishing' } : run;
        const d = run.research ? s.researches.find(x => x.id === run.research) : undefined;
        const li = el('li', `research-overview__run${shown.state === 'ended' ? ' is-ended' : ''}`);
        li.dataset.run = run.id;
        if (run.research) li.dataset.direction = run.research;
        const glyph = el('span', run.kind === 'queue' ? 'live-line__glyph live-line__glyph--queue' : 'live-line__glyph', run.kind === 'queue' ? '' : directionGlyph(d));
        glyph.setAttribute('aria-hidden', 'true');
        li.appendChild(glyph);
        const text = el('div', 'research-overview__run-text');
        const head = el('div', 'research-overview__run-head');
        head.appendChild(el('strong', 'research-overview__run-name', run.kind === 'queue' ? L.runWhole : d?.name ?? run.research ?? ''));
        if (run.kind === 'line' && run.research) head.appendChild(el('span', 'research-overview__run-code', run.research));
        head.appendChild(this.overviewRunState(shown));
        text.appendChild(head);
        const meta = el('div', 'research-overview__run-meta');
        meta.appendChild(document.createTextNode(run.agentName || run.agent));
        const since = shown.state === 'ended' ? null : timeEl(run.since, 'sincefor');
        if (since) meta.append(' · ', since);
        text.appendChild(meta);
        // Its last step: the person (serif) and the task, how it helps its direction.
        const w = run.workers[0];
        if (w && shown.state !== 'ended') {
            const task = el('div', 'research-overview__run-task');
            const person = personByRefn(w.person);
            if (person || w.person) task.appendChild(el('span', 'research-overview__run-person', person ? fullName(person) : w.person!));
            if (w.task) task.appendChild(document.createTextNode(task.childNodes.length > 0 ? ` — ${w.task}` : w.task));
            const saving = workingSavingEl(w, task.childNodes.length > 0);
            if (saving) task.appendChild(saving);
            const why = workingWhyText(w, s, true);
            if (why) task.appendChild(el('span', 'research-overview__why', ` · ${why}`));
            if (task.childNodes.length > 0) text.appendChild(task);
        } else if (!w && run.lastStep && shown.state !== 'ended') {
            text.appendChild(el('div', 'research-overview__run-task', run.lastStep));
        }
        const note = (t: string) => text.appendChild(el('div', 'research-overview__run-note', t));
        if (run.kind === 'queue' && shown.state !== 'ended') {
            // The general run and the directions with a run of their own (§6): what it skips, what it finishes first.
            const lines = linesWithRun(runs);
            const skipped = s.researches.filter(x => lines.has(x.id));
            const doing = run.workers.find(x => x.research && lines.has(x.research));
            if (doing) {
                const line = s.researches.find(x => x.id === doing.research);
                note(L.runFinishesThen(run.task ?? doing.task, line?.name ?? doing.research!));
            }
            if (skipped.length > 0) note(L.runSkips(skipped.map(x => x.name).join(', ')));
        }
        if (shown.state === 'waiting' && shown.wait?.for === 'browser') note(L.runBrowserNote);
        if (shown.state === 'waiting' && shown.wait?.reason) note(shown.wait.reason);
        // An ended run: why it ended (the limit, an error) first, then a direction's run gives it back to the whole queue.
        const endWhy = shown.state === 'ended' ? runEndedText(run.endedWhy) : '';
        if (endWhy) note(endWhy);
        if (shown.state === 'ended' && run.kind === 'line') note(L.runAfterStop);
        if (local?.state === 'failed' && shown.state !== 'ended') {
            const failed = el('div', 'research-overview__run-note research-overview__run-failed', local.text);
            failed.setAttribute('role', 'alert');
            text.appendChild(failed);
        }
        if (shown.state !== 'ended') {
            const actions = this.overviewRunActions(shown, s, mode, d);
            if (actions) text.appendChild(actions);
        }
        li.appendChild(text);
        return li;
    },

    /** A run's state at the right of its head: working (a dot), waiting (what for, until when), finishing, ended. */
    overviewRunState(run: LiveRun): HTMLElement {
        const L = strings.live;
        const clock = (iso: string | undefined): string => {
            const ts = iso ? Date.parse(iso) : NaN;
            return Number.isFinite(ts) ? formatLiveClock(ts, researchNow(), getCurrentLanguage()) : '';
        };
        const span = el('span', 'research-overview__run-state');
        switch (run.state) {
            case 'working':
                span.classList.add('is-working');
                span.appendChild(el('i', 'research-overview__run-dot')).setAttribute('aria-hidden', 'true');
                span.appendChild(document.createTextNode(L.runStateWorking));
                break;
            case 'starting':
            case 'finishing':
                span.classList.add('is-busy');
                span.setAttribute('role', 'status');
                span.insertAdjacentHTML('afterbegin', busySpinHtml(12));
                span.appendChild(document.createTextNode(run.state === 'starting' ? L.runStateStarting : L.runStateFinishing));
                break;
            case 'waiting':
                span.classList.add('is-wait');
                span.textContent = runWaitText(run);
                break;
            case 'ended':
                span.classList.add('is-ended');
                span.textContent = L.runStateEnded(clock(run.endedAt !== undefined ? new Date(run.endedAt).toISOString() : undefined));
                break;
        }
        return span;
    },

    /**
     * A run's actions (spec 126 U10 §4): Show in tree (the direction's people lit; the general run: its person) ·
     * Stop (through the bridge, no mark; with `run.stop`) · Finish and stop (the research's terminal, by the run's
     * id). Waiting for the limit, an archive or a reason of its own: no Finish and stop, as a paused session today.
     * Finishing: Show in tree only. On the phone's sheet: Show in tree only. Nothing to offer: no row.
     */
    overviewRunActions(run: LiveRun, s: LiveSession, mode: Mode, d: LiveDirection | undefined): HTMLElement | null {
        const L = strings.live;
        const row = el('div', 'research-overview__now-actions research-overview__run-actions');
        const workerPerson = run.workers.map(w => personByRefn(w.person)).find((p): p is Person => !!p);
        const show = d && directionPersonIds(d) ? () => this.showDirectionInTree(d, mode)
            : workerPerson ? () => this.overviewShowPerson(workerPerson.id, mode) : null;
        if (show) {
            const btn = el('button', 'link-button research-overview__show-in-tree', L.showInTree);
            btn.type = 'button';
            btn.onclick = show;
            if (d) lightsGroup(btn, 'direction', d.name);
            row.appendChild(btn);
        }
        // Which run following goes to (spec 126 U10 §7): two or more runs and following on; the phone has no choice.
        const followable = mode !== 'sheet' && run.state !== 'ended' && this.isLiveFollowOn()
            && liveRuns(s).filter(r => r.state !== 'ended').length >= 2;
        if (followable && this.followedRun() === run.id) {
            const on = el('span', 'research-overview__followed');
            on.appendChild(el('span', 'research-overview__followed-dot', '●')).setAttribute('aria-hidden', 'true');
            on.append(L.runFollowed);
            row.appendChild(on);
        } else if (followable) {
            const btn = el('button', 'link-button research-overview__run-follow', L.runFollow);
            btn.type = 'button';
            btn.onclick = () => this.setFollowedRun(run.id);
            row.appendChild(btn);
        }
        const live = run.state === 'working' || run.state === 'waiting';
        // A device's sheet stops a run too, through the bridge (spec 094 §4, 4.3).
        if ((mode !== 'sheet' || inDeviceMode()) && live && runStopOn(s.features) && researchDeviceAllows('run-stop')) {
            const btn = el('button', 'link-button research-overview__run-stop');
            btn.type = 'button';
            btn.title = L.runStopHint;
            if (runStopNote(run)?.state === 'stopping') {
                btn.setAttribute('aria-disabled', 'true');
                btn.setAttribute('aria-busy', 'true');
                btn.classList.add('is-busy');
                btn.innerHTML = `${busySpinHtml(12)}${researchBridgeActionLabel(L.runStopping, 'run-stop')}`;
            } else {
                btn.innerHTML = researchBridgeActionLabel(inDeviceMode() ? L.stopRun : L.runStop, 'run-stop');
                btn.onclick = () => void this.stopRun(run.id);
            }
            row.appendChild(btn);
        }
        const finishable = run.state === 'working' || (run.state === 'waiting' && (run.wait?.for === 'browser' || run.wait?.for === 'download'));
        const finish = mode !== 'sheet' && finishable ? this.activeResearchLink('finish', { run: run.id }) : null;
        if (finish) {
            const btn = setResearchActionLabel(el('button', 'link-button research-overview__finish'), L.finishSession, researchLinkMark('finish'));
            btn.type = 'button';
            btn.title = L.finishHint;
            btn.onclick = () => this.launchResearchLink(finish);
            row.appendChild(btn);
        }
        return row.childElementCount > 0 ? row : null;
    },

    /**
     * Stop of one run (spec 126 U10 §4): "Stopping…" while the bridge writes it, then the run finishing at once
     * (the bridge's status says so next); a refusal said under the run. A run the bridge no longer knows is done.
     */
    async stopRun(runId: string): Promise<void> {
        if (runStopNote({ id: runId })?.state === 'stopping') return;
        runStopNotes.set(runId, { state: 'stopping' });
        this.renderResearchOverview();
        const r = await this.writeRunStop(runId);
        // Refused as the computer's only (a device): its button goes and one quiet sentence says why, nothing under the run.
        if (!r.ok && !researchDeviceAllows('run-stop')) runStopNotes.delete(runId);
        else runStopNotes.set(runId, r.ok ? { state: 'stopped' } : { state: 'failed', text: r.text });
        this.renderResearchOverview();
    },

    /**
     * Stop of one run written through the bridge, the status read again after it; the refusal's sentence.
     * The overview's own window asks its main window.
     */
    async writeRunStop(runId: string): Promise<{ ok: true } | { ok: false; text: string }> {
        const L = strings.live;
        const s = researchSession();
        if (!s || s.ended) return { ok: false, text: L.dirBridgeDown };
        const r = await postRunStop(s.bridge.base, runId);
        // 404 runs.unknown: the run is gone, nothing more to stop.
        if (r.ok || r.status === 404) {
            this.researchStatusAfterWrite(s);
            return { ok: true };
        }
        const said = r.code === 'held' ? r.held?.said || r.reason : r.reason;
        return {
            ok: false,
            text: r.code === 'busy' ? L.dirBusy : r.code === 'network' ? L.dirBridgeDown : said ? L.runStopFailedSaid(said) : L.runStopFailed,
        };
    },

    /** Progress: the changes while watching, by task, filtered; hover and click reach the tree. */
    appendOverviewTimeline(body: HTMLElement, s: LiveSession, fold: LiveFold, mode: Mode): void {
        const L = strings.live;
        // A preview: the last 24 hours, at most 20 steps; a quiet day still
        // shows the last step. The research has the rest.
        const recent = recentChanges(s.changes);
        const changes = recent.length > 0 || s.changes.length === 0
            ? groupChanges(recent).slice(0, MAX_STEPS).flatMap(g => g.items)
            : groupChanges(s.changes)[0].items;
        const older = s.changes.length - changes.length;
        noteOverviewSectionRows('changes', changes.length);
        // A device (spec 094 §4, 4.6): the sends among the rows, and what came since Progress was last seen here.
        const device = inDeviceMode();
        const sends = device ? deviceProgressSends(this.researchStatusOf(s.researchId)?.sends) : [];
        const seen = device ? deviceProgressSeenAt(s.treeId) : Infinity;
        const times = [...changes.map(c => Date.parse(c.at)), ...sends.map(x => Date.parse(x.at))].filter(Number.isFinite);
        const unseen = times.filter(t => t > seen).length;
        if (device && !fold.collapsed && times.length > 0) noteDeviceProgressSeen(s.treeId, Math.max(...times));
        const summary = unseen > 0 ? L.newChanges(unseen) : changes.length + sends.length > 0 ? String(changes.length + sends.length) : undefined;
        const host = liveSection(body, { ...fold, title: L.timeline, summary });
        host.classList.add('research-overview__timeline');

        const bar = el('div', 'research-overview__timeline-bar');
        const filters = el('div', 'research-overview__filters');
        filters.setAttribute('role', 'radiogroup');
        filters.setAttribute('aria-label', L.filterLabel);
        const sendsIn = (f: Filter): boolean => f === 'all' || f === 'persons';
        const count = (f: Filter): number => (f === 'all' ? changes.length : changes.filter(c => c.kind === f).length) + (sendsIn(f) ? sends.length : 0);
        const labels: Record<Filter, string> = { all: L.filterAll, persons: L.filterPersons, sources: L.filterSources, stories: L.filterStories };
        for (const f of ['all', 'persons', 'sources', 'stories'] as Filter[]) {
            const chip = el('button', 'research-overview__filter sel-opt', `${labels[f]} ${count(f)}`);
            chip.type = 'button';
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', String(filter === f));
            chip.dataset.filter = f;
            chip.onclick = () => {
                filter = f;
                // What was opened or folded by hand meant the other default.
                toggledGroups.clear();
                this.renderResearchOverview();
                // The changed people shown in the tree follow the filter.
                if (mode !== 'sheet' && this.evidenceHighlightKind() === 'changed') {
                    const show = document.querySelector<HTMLButtonElement>('#research-overview .research-overview__show-changed');
                    if (show) {
                        relighting = true;
                        try { show.click(); } finally { relighting = false; }
                    } else this.endEvidenceHighlight();
                }
            };
            filters.appendChild(chip);
        }
        bar.appendChild(filters);
        // The people of the changes the progress shows (the same 24 hours and
        // steps, the chosen filter), so the tree and the list agree.
        const pool = changes.filter(c => filter === 'all' || c.kind === filter);
        const changedIds = [...new Set(pool.flatMap(c => c.personIds))].filter(id => DataManager.getPerson(id));
        const changedTitle = [L.changedTitle, filter === 'all' ? '' : labels[filter]].filter(Boolean).join(' · ');
        if (changedIds.length > 0) {
            const show = el('button', 'link-button research-overview__show-changed', L.showChanged);
            show.type = 'button';
            show.onclick = () => {
                if (mode === 'sheet') this.closeResearchOverview();
                // Followed a filter: nobody asked anew, so the own window does not bring the main window forward.
                this.startPersonHighlight('changed', changedTitle, changedIds, null, relighting ? { quiet: true } : undefined);
            };
            lightsGroup(show, 'changed', changedTitle);
            bar.appendChild(show);
        }
        host.appendChild(bar);

        const shown = filter === 'all' ? changes : changes.filter(c => c.kind === filter);
        if (device) {
            this.appendDeviceTimeline(host, s, shown, sendsIn(filter) ? sends : [], seen, mode);
            this.appendOverviewOlder(host, older, mode);
            return;
        }
        if (shown.length === 0) {
            host.appendChild(el('p', 'live-empty', strings.research.noChanges));
            this.appendOverviewOlder(host, older, mode);
            return;
        }
        const groups = groupChanges(shown);
        // Open: what goes on now (a task a run works on); what is done folds.
        // A filter opens every group: what it found is to be seen. A click
        // flips that for the group.
        const running = new Set(s.working.filter(w => !w.paused && w.task).map(w => w.task));
        groups.forEach((g, i) => {
            const newest = Date.parse(g.items[0].at);
            const oldest = Date.parse(g.items[g.items.length - 1].at);
            // Stable while the group grows at its newest end.
            const key = `${g.run}:${Number.isFinite(oldest) ? oldest : i}`;
            const now = running.has(g.title);
            const open = (now || filter !== 'all') !== toggledGroups.has(key);
            const to = i === 0 && now ? L.groupNow : Number.isFinite(newest) ? hhmm(newest) : '';
            const span = [Number.isFinite(oldest) ? hhmm(oldest) : '', to].filter(Boolean).join(' – ');
            const gh = el('button', 'research-overview__group-head');
            gh.type = 'button';
            gh.setAttribute('aria-expanded', String(open));
            const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
            chevron.setAttribute('aria-hidden', 'true');
            const title = el('span', 'research-overview__group-title', g.title);
            const dir = taskDirectionName(s, g.items.find(c => c.research)?.research);
            if (dir) title.appendChild(el('span', 'research-overview__dir', ` · ${dir}`));
            gh.append(chevron, title, el('span', 'research-overview__group-span', `${span} · ${g.items.length}`));
            gh.onclick = () => {
                if (toggledGroups.has(key)) toggledGroups.delete(key);
                else toggledGroups.add(key);
                this.renderResearchOverview();
            };
            host.appendChild(gh);
            if (!open) return;
            const list = el('ul', 'research-overview__rows live-changes');
            const sources = this.liveSourceLinks(s, mode === 'sheet');
            const gateway = this.changeSourceGateway(s.researchId);
            for (const c of g.items.slice(0, GROUP_ROWS)) {
                const li = el('li', 'research-overview__row');
                const ts = Date.parse(c.at);
                if (Number.isFinite(ts) && ts >= openedAt && Date.now() - ts < 4000) li.classList.add('is-new');
                li.appendChild(el('span', 'research-overview__row-time', Number.isFinite(ts) ? hhmm(ts) : ''));
                const text = el('span', 'research-overview__row-text');
                if (appendChangeText(text, c, (id) => this.overviewShowPerson(id, mode), sources, gateway)) this.appendSourceInNewer(text, s, c, true);
                li.appendChild(text);
                const target = c.personIds.find(id => DataManager.getPerson(id));
                if (target) {
                    li.classList.add('has-person');
                    li.dataset.person = target;
                    li.onclick = () => this.overviewShowPerson(target, mode);
                }
                list.appendChild(li);
            }
            host.appendChild(list);
            if (g.items.length > GROUP_ROWS) host.appendChild(el('p', 'research-overview__group-more', L.groupMore(g.items.length - GROUP_ROWS)));
        });
        this.appendOverviewOlder(host, older, mode);
    },

    /** Changes left out of the preview: the research has them (on a computer). */
    appendOverviewOlder(host: HTMLElement, older: number, mode: Mode): void {
        if (older <= 0) return;
        const open = mode === 'sheet' ? null : this.activeResearchLink('open');
        if (open) {
            const btn = setResearchActionLabel(el('button', 'link-button research-overview__older'), strings.live.olderInResearch, researchLinkMark('open'));
            btn.type = 'button';
            btn.onclick = () => this.launchResearchLink(open);
            host.appendChild(btn);
        } else {
            host.appendChild(el('p', 'research-overview__older', strings.live.olderInResearch));
        }
    },

    /**
     * What the research knows across the tree: open conflicts first, then
     * hypotheses. From ten rows (or while a text is typed) searched here
     * (spec 083 §2): the field under the title, the chips counting what was
     * found, the rows found, the bulk head and foot about the found ones, the
     * Verifying block under it all unchanged.
     */
    appendOverviewKnows(body: HTMLElement, fold: LiveFold, mode: Mode, treeId: string): void {
        const L = strings.live;
        const facts = strings.research.changeWords.facts as Record<string, string>;
        const rows: (KnowsSearchRow & { person: Person; text: string; conflictId?: string; hypo?: ResearchHypothesis })[] = [];
        // A list of proposals accepted at once (spec 074 §10): its rows stay, decided, with what became of each.
        const rid = this.activeResearchId();
        const batch = rid ? acceptBatch(rid) : null;
        for (const p of Object.values(DataManager.getData().persons)) {
            const name = fullName(p);
            const personRef = researchPersonRef(p.refn);
            let n = 0;
            // As the research has them now: one decided from here (or read decided from its version not loaded) goes at once.
            for (const c of this.researchConflictsOf(p.id)) {
                if (c.status === 'decided') continue;
                const what = c.title || facts[c.fact] || c.fact;
                const values = c.values.map(v => conflictValueSaid(researchValueText(c.fact, v.value)));
                const conflictId = researchConflictRef(c.id) ?? undefined;
                // Between two sends of two devices (spec 094 K2.4): each value by the device its edit came from.
                const devices = this.researchConflictDevices(c);
                const said = devices ? c.values.map((v, i) => v.side === 'user' || v.side === 'research' ? strings.conflict.valueFrom(devices[v.side], values[i]) : values[i]) : values;
                rows.push({ key: `c:${p.id}:${conflictId ?? n++}`, person: p, name, personRef, words: [what, ...values],
                    text: `${name} · ${what}: ${said.join(' × ')}`, conflict: true, conflictId });
            }
            for (const h of p.research?.hypotheses ?? []) {
                if (!isOpenHypothesis(h) && !(h.id && acceptBatchRowResult(batch, h.id))) continue;
                rows.push({ key: `h:${p.id}:${h.id ?? n++}`, person: p, name, personRef, hypoId: h.id, words: [h.title],
                    text: `${name} · ${L.hypothesisRow(h.title)}`, conflict: false, hypo: h });
            }
        }
        // The tree's "Verifying" (spec 065 §10k): waiting facts, Stop, the bulk verification.
        const verify = this.treeVerifyBlock(() => { if (mode === 'sheet') this.closeResearchOverview(); });
        // The section's search: its field from ten rows, or while a text is typed (it stays while the text does).
        const typed = overviewSearches.text('knows');
        if (rows.length === 0 && !verify && !typed) return;
        rows.sort((a, b) => Number(b.conflict) - Number(a.conflict));
        const conflicts = rows.filter(r => r.conflict).length;
        const openHypos = rows.filter(r => r.hypo && isOpenHypothesis(r.hypo)).length;
        const showField = !fold.collapsed && fieldVisible(rows.length, typed);
        noteOverviewSectionRows('knows', rows.length);
        const search: SectionSearch | null = showField ? overviewSearches.ensure({
            section: 'knows', mode: 'local',
            placeholder: L.knowsSearchPlaceholder, ariaLabel: L.knowsSearchAria(L.knowsTitle),
            onInput: () => this.renderResearchOverview(),
            onArrowDown: () => focusFirstSectionRow(search!),
        }) : overviewSearches.get('knows');
        const host = liveSection(body, {
            ...fold, title: L.knowsTitle, ...(rows.length > 0 ? { summary: L.knowsSum(conflicts, openHypos) } : {}),
            ...(fold.collapsed && typed.trim() ? { summaryEl: searchSummaryEl(typed) } : {}),
        });
        if (showField) mountSectionSearch(host, search, rows.length);
        const toks = tokenize(showField ? search?.text ?? '' : '');
        if (rows.length === 0 && toks.length === 0) {
            if (search) appendSearchOutcome(host, search, { searching: false, found: 0, total: 0, kindLabel: null, onAllKinds: () => {} });
            if (verify) host.appendChild(verify);
            return;
        }
        // Its kinds (spec 052 §3): chips All / Conflicts / Hypotheses when both are there.
        const choice = knowsKindChoice(conflicts, rows.length - conflicts, knowsKind);
        // The index is built when the rows say something else (or the language changes), not at each key.
        knowsIndex = knowsSearchIndex(knowsIndex, rows, getCurrentLanguage());
        const res = searchSection(knowsIndex.index, toks, key => key.startsWith('c:') ? 'con' : 'hyp', choice.kind);
        const searching = res.searching;
        const shownKeys = new Set(res.shown);
        const shownRows = rows.filter(r => shownKeys.has(r.key));
        const hitOf = (r: { key: string }): SearchHit | undefined => searching ? res.hits.get(r.key) : undefined;
        // Its groups (spec 140): offered from two rows (D5), by line only with lines; a stored choice that cannot draw draws as None.
        const lineModel = researchLinesOf(DataManager.getData(), researchTableLive().places);
        const hasLines = lineModel.lines.length > 0;
        const offerGroups = !fold.collapsed && rows.length >= 2;
        const groupBy = offerGroups ? knowsGroupShown(SettingsManager.getKnowsGroupForTree(treeId), hasLines, rows.length) : 'none';
        const linesOfPerson = new Map<string, ReadonlySet<string>>();
        const groupCtx = {
            lines: lineModel.lines.map((l): KnowsGroupLine => ({ id: l.id, name: l.name?.trim() || L.knowsGroupLineUnnamed, done: l.state === 'done' })),
            lineIdsOf: (r: typeof rows[number]): ReadonlySet<string> => {
                let ids = linesOfPerson.get(r.person.id);
                if (!ids) linesOfPerson.set(r.person.id, ids = personLineIds(lineModel, r.person));
                return ids;
            },
            islandOf: (r: typeof rows[number]): boolean => !!r.person.research?.island,
        };
        const groupName = (g: KnowsGroupOf<unknown>): string =>
            g.line?.name ?? (g.kind === 'noLine' ? L.knowsGroupNoLine : g.kind === 'in' ? L.knowsGroupIn : L.knowsGroupOut);
        // A phone (P2): only the first group open when the overview opens.
        const firstOnly = mode === 'sheet' && isMobile();
        if (groupBy !== 'none') {
            // Its guessed height in the own window's columns: the bar, each band (its title wrapped) and an open group's rows, without the search.
            const est = knowsGroups(rows.filter(r => knowsKindShows(choice.kind, r.conflict)), groupBy, groupCtx);
            noteOverviewSectionRows('knows', knowsGroupedRows(est.map((g, i) => ({
                title: g.line?.done ? `${groupName(g)} · ${L.knowsLineEnded}` : groupName(g),
                rows: sectionPartOpen(`${groupBy}:${g.key}`, !firstOnly || i === 0, false, knowsGroupsOpen, null) ? g.rows.length : 0,
            }))));
        }
        // The kind chips and Group in one bar (the button wraps under the chips when it does not fit).
        if (choice.chips || offerGroups) {
            const bar = el('div', 'research-overview__knows-bar');
            if (choice.chips) {
                bar.appendChild(this.knowsKindChips(choice.kind, {
                    all: chipCount(res, 'all', rows.length), con: chipCount(res, 'con', conflicts), hyp: chipCount(res, 'hyp', rows.length - conflicts),
                }, searching));
            }
            if (offerGroups) bar.appendChild(this.knowsGroupButton(groupBy, knowsGroupOptions(hasLines), mode, treeId));
            host.appendChild(bar);
        }
        appendSearchOutcome(host, search, {
            searching, found: res.shown.length, total: res.total,
            kindLabel: choice.kind === 'con' ? L.knowsKindCon : choice.kind === 'hyp' ? L.knowsKindHyp : null,
            onAllKinds: () => {
                knowsKind = 'all';
                this.renderResearchOverview();
            },
        });
        // The hypotheses the search shows (the picked ones outside it stay picked) and what matched each by its number.
        const hypoSearch: HypothesisListSearch | null = searching ? {
            found: new Set(shownRows.flatMap(r => r.hypo?.id ? [r.hypo.id] : [])),
            hitOf: (id) => {
                const r = shownRows.find(x => x.hypo?.id === id);
                return r ? hitOf(r) : undefined;
            },
        } : null;
        // Accepting the agent's proposals at once (§10): a box before each hypothesis, the list's head and foot.
        // The head and "Select all" are about the rows shown; the conflicts alone have none.
        const accept = choice.kind === 'con' || !shownRows.some(r => !r.conflict) ? null
            : this.hypothesisKnowsAccept(shownRows.flatMap(r => r.hypo?.id ? [r.hypo.id] : []), mode, hypoSearch);
        // A row: its text and tags (an island's person "outside the tree" when grouped by line), its box when accepting.
        const rowLi = (row: typeof rows[number], box: boolean, island: boolean, where: string): HTMLLIElement => {
            const li = el('li');
            const btn = el('button', `research-overview__knows-row${row.conflict ? ' is-conflict' : ''}`);
            btn.type = 'button';
            // The first row ↓ of the section's search reaches.
            btn.dataset.row = '';
            // A redraw of the research followed live keeps the focus on the row (keepKeyFocus).
            btn.dataset.focusKey = `knows-row:${where}:${row.key}`;
            const hit = hitOf(row);
            const entry = row.hypo?.id ? accept?.entries.get(row.hypo.id) ?? null : null;
            let tags = row.hypo ? this.hypothesisKnowsTagsEl(row.hypo, entry) : null;
            // Outside the tree (spec 140 §2, D2): the first tag, after the amber ones of a match.
            if (island) {
                tags ??= el('span', 'rok-tags');
                tags.prepend(el('span', 'rok-tag rok-tag--island', L.knowsIsland));
            }
            // A hypothesis found by its number or its person's: the amber H… and P… lead its line of tags.
            const lead = row.hypo || island ? [
                ...(hit?.h && row.hypo?.id ? [searchHitTag(row.hypo.id)] : []),
                ...(hit?.p && row.personRef ? [searchHitTag(row.personRef)] : []),
            ] : [];
            if (lead.length > 0) {
                tags ??= el('span', 'rok-tags');
                tags.prepend(...lead);
            }
            if (tags) {
                btn.classList.add('has-tags');
                btn.append(el('span', 'rok-text', `${row.text} ›`), tags);
            } else if (row.conflict && hit?.p && row.personRef) {
                // A conflict found by its person's number: the amber P… before the name.
                btn.append(searchHitTag(row.personRef), `${row.text} ›`);
            } else {
                btn.textContent = `${row.text} ›`;
            }
            btn.onclick = () => {
                if (mode === 'sheet') this.closeResearchOverview();
                // A conflict's row: the dialog at its card (decided there); a hypothesis's: at its card.
                this.showPersonResearchDialog(row.person.id, row.conflictId ? { conflict: row.conflictId }
                    : row.hypo?.id && this.researchHypothesisPickable(row.hypo) !== 'old' ? { hypo: { id: row.hypo.id } } : {});
            };
            if (box) {
                li.classList.add('rok-item');
                if (entry) li.appendChild(this.hypothesisAcceptBoxEl(rid!, entry, where));
                else li.appendChild(el('span', 'hp2-box hp2-box--none')).setAttribute('aria-hidden', 'true');
            }
            li.appendChild(btn);
            return li;
        };
        if (groupBy !== 'none') {
            // Grouped (spec 140 §2, §3): the head of the accepting once over the first group, each group's band and its rows.
            host.classList.add('is-knows-grouped');
            if (accept?.head) host.appendChild(accept.head);
            const groups = knowsGroups(shownRows, groupBy, groupCtx);
            groups.forEach((g, i) => {
                const key = `${groupBy}:${g.key}`;
                const open = sectionPartOpen(key, !firstOnly || i === 0, searching, knowsGroupsOpen, search?.searchOpen);
                const name = groupName(g);
                const ended = !!g.line?.done;
                const state = ended ? el('span', 'research-overview__group-state', ` · ${L.knowsLineEnded}`) : undefined;
                const head = el('div', `research-overview__waiting-grouphead research-overview__knows-grouphead${i === 0 ? ' is-first' : ''}`);
                const { button, title } = this.groupBandButton({
                    name, titleAttr: name, titleExtra: state, side: [el('span', 'research-overview__group-span', String(g.rows.length))],
                    label: L.knowsGroupBandAria(name, g.rows.length, ended), open,
                    toggle: () => {
                        toggleSectionPart(key, open, searching, knowsGroupsOpen, search?.searchOpen);
                        this.renderResearchOverview();
                    },
                });
                button.dataset.band = key;
                button.dataset.focusKey = `knows-band:${key}`;
                head.append(button, groupTitleMoreEl(title, `knows:${key}`, knowsGroupsOpen));
                host.appendChild(head);
                if (!open) return;
                const list = el('ul', `live-panel-list research-overview__knows is-grouped${accept ? ' has-accept' : ''}`);
                list.setAttribute('aria-label', name);
                for (const row of g.rows) list.appendChild(rowLi(row, !!accept, groupBy === 'line' && !!row.person.research?.island, `knows:${key}`));
                host.appendChild(list);
            });
        } else {
            // Both kinds shown: the conflicts first, the head of the accepting over the hypotheses under them.
            const split = !!accept?.head && shownRows.some(r => r.conflict) && shownRows.some(r => !r.conflict);
            let list = el('ul', `live-panel-list research-overview__knows${accept ? ' has-accept' : ''}`);
            if (accept?.head && !split) host.appendChild(accept.head);
            for (const row of shownRows) {
                if (split && !row.conflict && list.dataset.kind === 'con') {
                    // The first hypothesis: the conflicts' list ends, the head stands over the hypotheses' one.
                    host.appendChild(list);
                    host.appendChild(accept!.head!);
                    list = el('ul', 'live-panel-list research-overview__knows has-accept');
                    list.dataset.kind = 'hyp';
                }
                if (split && row.conflict && !list.dataset.kind) {
                    list.className = 'live-panel-list research-overview__knows';
                    list.dataset.kind = 'con';
                }
                list.appendChild(rowLi(row, !!accept && !(split && row.conflict), false, 'knows'));
            }
            if (shownRows.length > 0) host.appendChild(list);
        }
        if (accept?.foot) host.appendChild(accept.foot);
        else if (searching && !accept && rid && rows.some(r => !r.conflict) && this.hypothesesAcceptAvailable()) {
            // Searching and no list of hypotheses drawn (none found, or Conflicts chosen): the picked ones are still said.
            this.pruneHypothesisAcceptSelection(rid);
            const foot = this.hypothesisAcceptFootEl(rid, 'knows', hypoSearch);
            if (foot) host.appendChild(foot);
        }
        if (verify) host.appendChild(verify);
    },

    /**
     * The kind chips of "What the research knows": All / Conflicts / Hypotheses,
     * each with its count; while searching (spec 083 §2) what was found of
     * each, a kind with nothing found dashed in its place, still choosable.
     */
    knowsKindChips(kind: KnowsKind, counts: Record<KnowsKind, number>, searching = false): HTMLElement {
        const L = strings.live;
        const pills = el('div', 'research-overview__filters research-overview__knows-kinds');
        pills.setAttribute('role', 'radiogroup');
        pills.setAttribute('aria-label', L.knowsKindAria);
        const options: [KnowsKind, string][] = [['all', L.knowsKindAll], ['con', L.knowsKindCon], ['hyp', L.knowsKindHyp]];
        for (const [id, label] of options) {
            const chip = el('button', 'research-overview__filter sel-opt');
            paintSearchChip(chip, label, counts[id], searching);
            chip.type = 'button';
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', String(kind === id));
            chip.dataset.kind = id;
            chip.onclick = () => {
                knowsKind = id;
                this.renderResearchOverview();
                document.querySelector<HTMLElement>(`#research-overview .research-overview__knows-kinds [data-kind="${id}"]`)?.focus({ preventScroll: true });
            };
            pills.appendChild(chip);
        }
        return pills;
    },

    /**
     * "Group: By research line ▾" of "What the research knows" (spec 140 §1):
     * a menu (a sheet on a phone) of None / By research line / In the tree
     * and outside it, kept for the tree; dark-framed when something is chosen.
     */
    knowsGroupButton(shown: KnowsGroup, options: readonly KnowsGroup[], mode: Mode, treeId: string): HTMLElement {
        const L = strings.live;
        const label = (g: KnowsGroup): string => g === 'line' ? L.knowsGroupLine : g === 'tree' ? L.knowsGroupTree : L.knowsGroupNone;
        const btn = el('button', `research-overview__order-btn research-overview__knows-group-btn${shown !== 'none' ? ' is-set' : ''}`);
        btn.type = 'button';
        btn.dataset.focusKey = 'knows-group';
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', L.knowsGroupAria(label(shown)));
        btn.append(el('span', 'research-overview__groups-btn-label', L.knowsGroupBtn), el('span', 'research-overview__order-name', label(shown)));
        const caret = el('span', 'research-overview__order-caret', '▾');
        caret.setAttribute('aria-hidden', 'true');
        btn.appendChild(caret);
        const choose = (g: KnowsGroup): void => {
            if (g === shown) return;
            SettingsManager.setKnowsGroupForTree(treeId, g);
            this.renderResearchOverview();
        };
        btn.onclick = () => this.openWaitingChoice(btn, {
            title: L.knowsGroup, sheet: mode === 'sheet' || isPhoneBar(),
            sheetClass: 'research-overview__knows-group-sheet', menuClass: 'research-overview__knows-group-menu',
            options: options.map(g => ({ id: `knows-group-${g}`, label: label(g), on: g === shown, run: () => choose(g) })),
        });
        return btn;
    },

    /** Foot: where evidence is missing (the tree overview's Data quality), Open the research (research). */
    appendOverviewFoot(root: HTMLElement, s: LiveSession, mode: Mode): void {
        const L = strings.live;
        // A busy host: the sentence of Open the research stays a line of the foot.
        const foot = el('div', 'research-overview__foot busy-host');
        const missing = computeEvidenceGaps(DataManager.getData()).noSource.length;
        if (missing > 0) {
            const link = el('button', 'link-button', L.missingLink(missing));
            link.type = 'button';
            link.onclick = () => {
                if (mode === 'sheet') this.closeResearchOverview();
                void this.showTreeOverview(s.treeId, { section: 'quality', scroll: true });
            };
            foot.appendChild(link);
        }
        // The research runs on the computer: a phone gets no (research) into it.
        const open = mode === 'sheet' ? null : this.activeResearchLink('open');
        if (open) {
            const btn = setResearchActionLabel(el('button', 'link-button research-overview__open'), strings.research.openResearch, researchLinkMark('open'));
            btn.type = 'button';
            // Found again when the overview is drawn anew while it waits: the state and its sentence follow (§3.1).
            btn.dataset.action = 'open-research';
            btn.onclick = () => { void this.launchResearchLink(open, 'terminal', btn); };
            foot.appendChild(btn);
        }
        if (foot.childElementCount > 0) root.appendChild(foot);
    },

    /**
     * Show one of the overview's sections expanded until the overview closes
     * (a way into it: a direction, a branch's tasks, a link to what waits);
     * the choice stays as it is.
     */
    unfoldOverviewSection(key: string): void {
        const s = drawnSession();
        if (!s) return;
        if (sectionCollapsed(key) || sectionPref(key) === 'hidden') s.overviewShown.add(key);
    },

    /**
     * The head of the overview's own window (§6, 6a/6b/6f): the state dot,
     * "{tree} · Research overview" over the research's name, then by the
     * state ◎ and Stop (following) or "Follow live" (viewed through the
     * bridge), and ⋯ Edit panel. It closes as a window: no ⤡, × or ⧉.
     */
    overviewWindowHead(s: LiveSession, source: OverviewSourceKind, frozen = false): HTMLElement {
        const L = strings.live;
        const r = strings.research;
        const head = el('div', 'research-overview__head research-overview__head--window');
        head.appendChild(el('span', `live-dot live-dot--still${source === 'live' && !frozen ? '' : ' live-dot--off'}`));
        const titles = el('div', 'research-overview__titles');
        const title = strings.win.overviewHead(ownWindow?.treeName() ?? '', L.overviewTitle);
        // Cut with an ellipsis on a narrow window: the whole title on hover.
        titles.appendChild(el('h1', 'research-overview__title', title)).title = title;
        const sub = titles.appendChild(el('div', 'research-overview__sub'));
        sub.appendChild(el('span', 'research-overview__name', s.name)).title = s.name;
        // "Awaiting action" hidden: its count stays in sight; a click shows it until the window closes.
        if (sectionPref('waiting') === 'hidden' && s.waiting.length > 0) {
            const chip = waitingChip(s, () => this.showOverviewWaiting());
            if (chip) sub.append(chip);
        }
        head.appendChild(titles);
        if (source === 'live') {
            const follow = this.liveFollowButton('overview');
            if (follow) head.appendChild(follow);
            // The run followed and the choice of another (spec 126 U10 §7, 7d): this window has no pill of the tree.
            const runs = liveRuns(s).filter(x => x.state !== 'ended');
            const followed = this.isLiveFollowOn() && runs.length >= 2 ? runs.find(x => x.id === this.followedRun()) : undefined;
            if (followed) {
                const name = runName(followed, s.researches);
                const pick = el('button', 'research-overview__follow-run');
                pick.type = 'button';
                pick.setAttribute('aria-haspopup', 'menu');
                pick.setAttribute('aria-expanded', 'false');
                pick.setAttribute('aria-label', L.followRunAria(name));
                pick.title = `${L.followRunPill} ${name}`;
                pick.appendChild(el('span', 'research-overview__follow-run-name', name));
                pick.appendChild(el('span', 'research-overview__follow-run-chev', '▾')).setAttribute('aria-hidden', 'true');
                pick.onclick = () => this.openFollowRunMenu(pick, s, followed.id);
                head.appendChild(pick);
            }
            const stop = el('button', 'live-panel-action research-overview__stop', r.stop);
            stop.type = 'button';
            stop.onclick = () => this.stopLiveFollow();
            head.appendChild(stop);
        } else if (source === 'bridge' && !this.activeResearchAgentless() && !inDeviceMode() && !inShowcase()) {
            // Not in the showcase (spec 143 K4.1): its research is a snapshot, nothing to follow.
            const follow = el('button', 'research-overview__follow-live research-overview__follow-live--head', r.followLive);
            follow.type = 'button';
            follow.title = L.followNote;
            follow.dataset.action = 'follow-live-head';
            follow.onclick = () => { void this.startFollowLive('overview', undefined, follow); };
            head.appendChild(follow);
        }
        head.appendChild(this.liveSectionMoreButton('research-overview__more', 'overview'));
        return head;
    },

    /**
     * ⧉ in the overview's head: the overview opens in a window of its own and
     * closes here (opened at once in the click: a browser blocks a window
     * opened later). Blocked: it stays here (the opener says why).
     */
    overviewWindowButton(): HTMLElement {
        const W = strings.win;
        const btn = el('button', 'research-overview__window', '⧉');
        btn.type = 'button';
        btn.setAttribute('aria-label', W.openInNewWindow);
        btn.title = W.openInNewWindow;
        // Opened: the main window's list of windows says so, and the overview here closes (overviewWindowOpenChanged, overview-window-ui).
        btn.onclick = () => openInNewWindow('overview');
        return btn;
    },

    /**
     * A person from the overview: centred in the tree (the sheet closes first). B14, 8a: a person not drawn lays
     * the tree out anew under the canvas overlay ("Calculating the layout…", seen past 120 ms), painted first.
     */
    overviewShowPerson(id: PersonId, mode: Mode): void {
        if (!DataManager.getPerson(id)) return;
        // Looking at someone else: the user has the tree.
        this.pauseLiveFollow();
        if (mode === 'sheet') this.closeResearchOverview();
        if (document.querySelector(`.person-card[data-id="${CSS.escape(id)}"]`)) {
            ZoomPan.centerOnPerson(id);
        } else {
            void canvasBusy(() => TreeRenderer.setFocus(id));
        }
    },
});

/** A question about a send in its row (1127): "25. 11. 2026 · 142 people: A, B, C". */
function importAskRowWho(w: LiveWaiting): string {
    const day = w.importAsk ? importAskDayText(w.importAsk.day) : '';
    const who = importAskWho(w, strings.live.importAsk.count);
    return day ? `${day} · ${who}` : who;
}
