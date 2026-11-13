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

import { researchOpenSrText, setResearchActionLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { Person, PersonId, ResearchHypothesis } from '../types.js';
import { acceptBatch, acceptBatchRowResult } from '../research-hypothesis-waiting.js';
import { computeEvidenceGaps } from '../stats.js';
import { LiveChangeKind, LiveWaiting, LiveWorker, ResearchActionMark, WAITING_SECTIONS, researchConflictRef, researchTaskRef, recentAddsCount, researchLinkMark } from '../research-link.js';
import { waitingGroupSendable, waitingGroupHasNote, waitingSendable, waitingUnsendable, waitingFileWritable } from '../research-waiting-write.js';
import {
    PLACES_GROUP, WaitingFilter, WaitingGroupRows, WaitingPhase, effectiveWaitingFilter, waitingActionDo, waitingChatLeads, waitingChips, waitingDaysAgo, waitingGroupChatTask,
    waitingGroupOpenByDefault, waitingPhase, waitingPhases, waitingSection, waitingTaskActions, waitingTodoCount,
    WaitActionView, imagesState, splitWaitingActions, waitingActions, waitingForImages, waitingGroupMissing,
} from '../research-waiting.js';
import { WaitingAnswerForm, waitingAnswerChangedNote } from './waiting-answer-form.js';
import { appendImagesDetail, bindImagesDrop, clearImagesSeen, forgetImagesArrived, imagesShortEl, itemKey, noteImagesArrived } from './waiting-images-ui.js';
import { clearOverviewImages, foldOverviewImages, overviewImagesResult } from './waiting-task-ui.js';
import { formatLiveClock } from '../live-time.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { browserGroupNote, browserNote } from '../research-browser.js';
import { uiModule } from './module.js';
import {
    LiveChangeItem, LiveFold, LiveSession, appendChangeText, el, ensureLiveTicker, liveDuration, liveSection,
    liveSession, nowHelpTopic, timeEl, appendAllHidden, noteWaitingShown, waitingChip, waitingNewChip,
    liveState, pausedText, waitsOnUser, appendLinkedText, newWaitingView, waitingKindLabel, appendFollowNote, holdFollowNoteIn,
    markWaitingFocus, waitingWhyEl, overviewViewing, OverviewViewing, onComputer, lightsGroup, markOverviewLit,
} from './research-ui.js';
import { storyWaitingPeople } from './story-compare-ui.js';
import {
    WorkingLine, directionDragActive, directionGlyph, directionPersonIds, directionRedrawHeld, keepLineFocus, linesMulti, queueDirectionFilter, taskDirectionName, workingLineCount, workingLineGroups,
} from './research-directions-ui.js';
import { conflictValueSaid, researchValueText } from './person-research-ui.js';
import { shownName, fitNameHtml } from '../person-name.js';
import { isOpenHypothesis } from '../view-links.js';
import { focusQueueMoved, waitBranchText, workingWhyText } from './research-offline-ui.js';
import { beginQueueSlots, endQueueSlots } from '../research-queue-pages.js';
import { KnowsKind, knowsKindChoice, knowsKindShows } from '../knows-kind.js';
import { activeQueueSearch, noteQueueSearchFocus, resetQueueSearch } from './queue-search-ui.js';
import { PREF_KEYS, PrefKey, SectionPref, prefKeyOfOverview, sectionOrder, sectionPrefs, setSectionPref, topPrefs, topTileShown } from './live-section-prefs.js';
import { OverviewSourceKind, afterTurnOnKeys, skeletonLines } from '../research-overview-source.js';
import { sectionTitle } from './live-section-edit.js';
import { joinAnd } from '../strings.js';
import { canOpenWindows, openInNewWindow } from '../windows/window-open.js';
import { focusOverviewWindow, overviewChanged, overviewInWindow } from '../windows/overview-window.js';
import { greyOverviewActions } from './overview-window-states.js';

/** The overview stays open over a reload / the next following (per device). */
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

type Filter = 'all' | Exclude<LiveChangeKind, 'other'>;
type Mode = 'docked' | 'overlay' | 'sheet' | 'window';

let filter: Filter = 'all';
/** The changed people lit again because the filter changed (not asked anew). */
let relighting = false;
/** The kind shown in "What the research knows" while the overview is open (All again once it closes). */
let knowsKind: KnowsKind = 'all';
/** When the overview was opened (changes after it are marked new for a moment). */
let openedAt = 0;
/** Older change groups the user unfolded (by group key). */
const toggledGroups = new Set<string>();
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

/** Two columns in the overview's own window from this width on (§6), else one. */
export const OVERVIEW_WINDOW_COLS_MIN = 1100;

/** Where a section stands in the window's two columns: now, waiting and lines left; progress, queue and knows right. */
const WINDOW_LEFT: ReadonlySet<PrefKey> = new Set<PrefKey>(['working', 'waiting', 'directions']);

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
}

/** Answer forms by tree and item: the open one (one at a time) and those kept over a redraw. */
const answerForms = new Map<string, WaitingAnswerForm>();
let answeringKey: string | null = null;
/** Items whose answer met a task that waits for something else now (409 changed): the ochre note at the top. */
const answerChanged = new Set<string>();
/** The "More actions" menu open (the item's id) and how it is let go. */
let moreMenuFor: string | null = null;
let moreMenuCleanup: (() => void) | null = null;

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
    answerForms.get(answeringKey)?.keepDraftNow();
    answerChanged.delete(answeringKey);
    answeringKey = null;
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
    btn.type = 'button';
    btn.dataset.action = a.key;
    if (a.write) btn.dataset.write = 'bridge';
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
function recentChanges(changes: readonly LiveChangeItem[], now = Date.now()): LiveChangeItem[] {
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
        if (body && heading) body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
        const input = activeQueueSearch()?.input;
        if (input?.isConnected) input.focus({ preventScroll: true });
        else heading?.focus({ preventScroll: true });
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
            body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
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
        body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
        const finish = body.querySelector<HTMLElement>('#ov-sec-now .research-overview__finish');
        if (finish) {
            finish.scrollIntoView?.({ block: 'nearest' });
            finish.focus({ preventScroll: true });
        } else heading.focus({ preventScroll: true });
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
        s.overviewShown.clear();
        // The queue's search and the kind shown in "What the research knows" last while the overview is open.
        resetQueueSearch();
        knowsKind = 'all';
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
        // A task just moved by "Do next": focused once drawn first.
        queueMicrotask(focusQueueMoved);
        // The followed research's, else the open tree's viewed without following (spec 057 §7.2).
        const followed = followedOverview();
        const viewed = followed ? null : overviewViewing();
        // The overview in its own window (6g): none is drawn here.
        const inWindow = overviewInWindow();
        const s = inWindow ? null : drawnSession();
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
                resetQueueSearch();
                knowsKind = 'all';
            }
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
        // The own window's two columns from 1100 px (§6): a resize across it draws anew (the window's start listens).
        const twoCols = mode === 'window' && window.innerWidth >= OVERVIEW_WINDOW_COLS_MIN;
        root.className = `research-overview research-overview--${mode}${twoCols ? ' research-overview--cols' : ''}`;
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
        const scroller = root.querySelector<HTMLElement>('.research-overview__body');
        const scrollTop = scroller?.scrollTop ?? 0;
        // The queue's search field is drawn again: the focus and caret it had go back to it.
        noteQueueSearchFocus();
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
            if (source === 'bridge' && !this.activeResearchAgentless() && frozenAt === null) {
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
            if (source === 'bridge' && viewed) {
                const strip = this.overviewFollowStrip(viewed);
                if (strip) root.appendChild(strip);
            }
            // Following on: "Follow in: Family / Fan / Map" under the head (in the phone's sheet too: a phone
            // held sideways keeps the strip to one row and has it only here).
            const followView = source === 'live' ? this.liveFollowViewRow('overview') : null;
            if (followView) root.appendChild(followView);
        }

        const body = el('div', 'research-overview__body');
        root.appendChild(body);
        // Which tree is followed now (after a switch), first.
        if (source === 'live') appendFollowNote(body, s);
        this.appendOverviewSummary(body, s, mode, viewed);
        // The own window without the bridge (§6 state 3): "not running · showing what is in the tree" and Turn on.
        if (mode === 'window' && viewed?.kind === 'tree' && onComputer()) this.appendOverviewOffFrame(body, viewed);
        if (s.update) this.appendUpdateStrip(body, s.update.version, s.busy);

        // A section hidden by the choice is not drawn, unless shown until the overview closes
        // (expanded, its heading says so and does not fold). A click on a heading is a lasting choice.
        const shown = (key: string): boolean => sectionPref(key) !== 'hidden' || s.overviewShown.has(key);
        const frozenWhen = frozenAt !== null ? L.asOf(formatLiveClock(frozenAt, Date.now(), getCurrentLanguage())) : '';
        const fold = (key: string): LiveFold => {
            let f = foldOf(key);
            // Frozen: each section says as of when (Awaiting action without the bridge says its own time).
            if (frozenWhen && !(key === 'waiting' && source === 'tree')) {
                f = { ...f, extra: [...(f.extra ?? []), el('span', 'research-overview__as-of research-overview__frozen-at', frozenWhen)] };
            }
            const pk = prefKeyOfOverview(key);
            return pk ? { ...f, menu: (h, at) => this.openLiveSectionMenu(h, pk, 'overview', at) } : f;
        };
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
            const collapsed = sectionCollapsed(key);
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
        // The own window's two columns (§6): now, waiting and lines left, progress, queue and knows right,
        // each in the sections' order; a hidden section leaves its column shorter.
        let host = body;
        const cols = twoCols ? body.appendChild(el('div', 'research-overview__cols')) : null;
        const left = cols?.appendChild(el('div', 'research-overview__col research-overview__col--left')) ?? null;
        const right = cols?.appendChild(el('div', 'research-overview__col research-overview__col--right')) ?? null;
        const draw: Record<PrefKey, () => void> = {
            working: () => {
                if (fromTree) return;
                if (shown('now')) this.appendOverviewNow(host, s, fold('now'), mode);
            },
            waiting: () => {
                if (s.waiting.length === 0 || !shown('waiting')) return;
                if (fromTree) {
                    this.appendOverviewWaitingAsOf(host, s, fold('waiting'), mode, viewed?.waitingAt ?? 0);
                    return;
                }
                const f = fold('waiting');
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
                if (shown('knows')) this.appendOverviewKnows(host, fold('knows'), mode);
            },
        };
        // In the sections' order (one for the overview and the panel).
        for (const key of sectionOrder()) {
            host = left && right ? (WINDOW_LEFT.has(key) ? left : right) : body;
            draw[key]();
        }
        // The research not running (on a computer): one line names what comes once it runs (not on a phone,
        // whose state says the agent's work is seen on the computer; none when all of it is hidden).
        if (fromTree && onComputer()) {
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
        body.scrollTop = scrollTop;

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
        const lastEl = viewed ? timeEl(new Date(viewed.refreshedAt || Date.now()).toISOString(), 'refreshed') : timeEl(lastIso, 'lastchange');
        lastEl?.classList.add('research-overview__cell-sub');
        const hover = s.head ? L.versionTitle(s.head.slice(0, 7)) : '';
        // Paused: when it goes on (and why, on hover) says more than the last change.
        const paused = stateCls === 'is-paused' ? s.working.find(w => w.paused) : undefined;
        const resumes = paused ? Date.parse(paused.paused!.until) : NaN;
        if (paused && Number.isFinite(resumes)) {
            cell(L.state, state, L.pausedUntil(formatLiveClock(resumes, Date.now(), getCurrentLanguage())), stateCls,
                [pausedText(paused), lastEl?.textContent ?? '', hover].filter(Boolean).join(' · '));
        } else if (stateCls === 'is-lost') {
            cell(L.state, state, strings.research.reconnectingShort, stateCls, [lastEl?.textContent ?? '', hover].filter(Boolean).join(' · '));
        } else {
            cell(L.state, state, lastEl ?? '', stateCls, [paused ? pausedText(paused) : '', lastEl?.textContent ?? '', hover].filter(Boolean).join(' · '));
        }
        if (s.logged || viewed) {
            // What the research added in the last 24 hours: the bridge's own count
            // (and what came after it), else from its history.
            const added = recentAddsCount(s.recent, s.adds, Date.now(), RECENT_MS);
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
        if (!onComputer()) {
            c.append(el('div', 'research-overview__cell-value', L.phoneTreeOnly), el('div', 'research-overview__cell-sub research-overview__why-off', L.phoneWhy));
            return;
        }
        c.appendChild(el('div', 'research-overview__cell-value', L.notRunning));
        // The own window says Turn on in its frame under the tiles (appendOverviewOffFrame).
        if (ownWindow) return;
        const state = this.researchLiveState(v.treeId);
        if (state?.canStart || state?.pending === 'starting') {
            const starting = state.pending === 'starting';
            const btn = el('button', 'link-button research-overview__turn-on', starting ? strings.researchLive.starting : L.turnOn);
            btn.type = 'button';
            if (starting) {
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
            }
            btn.onclick = () => void this.toggleResearchLive(v.treeId);
            c.appendChild(btn);
        } else {
            c.appendChild(this.researchLiveStartHow());
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
        const state = this.researchLiveState(v.treeId);
        if (state?.canStart || state?.pending === 'starting') {
            const starting = state.pending === 'starting';
            const btn = el('button', 'research-overview__turn-on research-overview__turn-on--frame', starting ? strings.researchLive.starting : L.turnOn);
            btn.type = 'button';
            if (starting) {
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
            }
            btn.onclick = () => void this.toggleResearchLive(v.treeId);
            frame.appendChild(btn);
        } else {
            frame.appendChild(this.researchLiveStartHow());
        }
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
        btn.onclick = () => this.startFollowLive('overview');
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
        const todo = waitingTodoCount(s.waiting);
        const replies = s.waiting.length - todo;
        const host = liveSection(body, {
            ...fold, title: `${r.waiting} · ${todo}`, summary: replies > 0 ? L.waitingReplyCount(replies) : undefined, headCls: 'live-panel-heading-waiting',
            help: 'waiting',
        });
        host.classList.add('research-overview__waiting');
        if (view.detail && !s.waiting.some(w => w.id === view.detail)) view.detail = null;
        noteImagesArrived(s);
        const rows = (items: readonly LiveWaiting[]): HTMLElement => {
            const list = el('ul', 'research-overview__waiting-rows');
            // A hypothesis (spec 074 §9): its choices in the row, not behind a detail.
            for (const w of items) list.appendChild(w.kind === 'hypothesis' ? this.hypothesisWaitingRow(w, mode, null) : this.overviewWaitingRow(s, w, mode));
            // Its proposals accepted at once (§10), where the research takes that.
            return items.some(w => w.kind === 'hypothesis') ? this.hypothesisWaitingList(items, mode, list) : list;
        };
        // An older research: no kinds, places or phases.
        if (!s.waiting.some(w => w.section)) {
            host.appendChild(rows(s.waiting));
            return;
        }

        const chips = waitingChips(s.waiting);
        const chosen = storedWaitingFilter();
        const filter = effectiveWaitingFilter(s.waiting, chosen);
        // A filter whose last item went falls back to all (and stays there).
        if (filter !== chosen) storeWaitingFilter(filter);
        if (chips.length > 0) {
            const bar = el('div', 'research-overview__filters research-overview__waiting-filters');
            bar.setAttribute('role', 'radiogroup');
            bar.setAttribute('aria-label', L.waitingFilterLabel);
            const all: { f: WaitingFilter; label: string; count: number }[] = [
                { f: 'all', label: L.filterAll, count: s.waiting.length },
                ...chips.map(c => ({ f: c.section as WaitingFilter, label: L.waitingChips[c.section], count: c.count })),
            ];
            for (const c of all) {
                const chip = el('button', 'research-overview__filter', `${c.label} ${c.count}`);
                chip.type = 'button';
                chip.setAttribute('role', 'radio');
                chip.setAttribute('aria-checked', String(filter === c.f));
                chip.dataset.filter = c.f;
                // A new item the filter hides: a dot on its kind.
                if (c.f !== 'all' && filter !== 'all' && c.f !== filter
                    && s.waiting.some(w => view.fresh.has(w.id) && waitingSection(w) === c.f)) {
                    chip.classList.add('has-new');
                    chip.setAttribute('aria-label', `${c.label} ${c.count}, ${L.waitingNewSr}`);
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

        const phases = waitingPhases(s.waiting, filter);
        browserNotedInHead.clear();
        for (const phase of ['todo', 'sent'] as WaitingPhase[]) {
            const groups = phases[phase];
            if (groups.length === 0) continue;
            const count = groups.reduce((n, g) => n + g.items.length, 0);
            const phaseKey = `phase:${phase}`;
            const open = view.open.get(phaseKey) ?? phase === 'todo';
            const ph = el('button', 'research-overview__phase-head');
            ph.type = 'button';
            ph.dataset.phase = phase;
            ph.setAttribute('aria-expanded', String(open));
            const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
            chevron.setAttribute('aria-hidden', 'true');
            ph.append(chevron, el('span', 'research-overview__phase-title', `${phase === 'todo' ? L.waitingPhaseTodo : L.waitingPhaseSent} · ${count}`));
            ph.onclick = () => {
                view.open.set(phaseKey, !open);
                this.renderResearchOverview();
            };
            host.appendChild(ph);
            if (!open) continue;
            const wrap = el('div', 'research-overview__phase');
            wrap.dataset.phase = phase;
            for (const g of groups) {
                // Every place has its heading, a lone item's too: a bare row would read as an item of the place above.
                const key = `group:${phase}:${g.key}`;
                const gOpen = view.open.get(key) ?? waitingGroupOpenByDefault(g.items, filter, view.fresh);
                wrap.appendChild(this.overviewWaitingGroupHead(s, g, phase, gOpen, () => {
                    view.open.set(key, !gOpen);
                    this.renderResearchOverview();
                }, mode));
                if (gOpen) wrap.appendChild(rows(g.items));
            }
            host.appendChild(wrap);
        }
    },

    /**
     * A group's heading: the place, its kind, how many, and a slot for the
     * group's own actions (overviewWaitingGroupAction).
     */
    overviewWaitingGroupHead(s: LiveSession, g: WaitingGroupRows, phase: WaitingPhase, open: boolean, toggle: () => void, mode: Mode): HTMLElement {
        const L = strings.live;
        const row = el('div', 'research-overview__waiting-grouphead');
        const gh = el('button', 'research-overview__group-head research-overview__waiting-group');
        gh.type = 'button';
        gh.dataset.group = g.key;
        gh.setAttribute('aria-expanded', String(open));
        const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
        chevron.setAttribute('aria-hidden', 'true');
        const places = g.key === PLACES_GROUP;
        const name = places ? strings.places.waiting.group : g.group?.name ?? L.waitingOtherGroup;
        const title = el('span', 'research-overview__group-title', name);
        title.title = name;
        const kind = places ? name : L.waitingGroupKinds[g.group?.kind ?? 'other'];
        // An archive's name is long (fond, institution): one line cut at its end, whole on hover;
        // the place's actions go under the heading rather than squeeze it (CSS).
        // How many images its items miss together (a research that says which).
        const missing = places ? null : waitingGroupMissing(g.items);
        const missingText = missing ? L.waitingTask.groupMissing(missing) : '';
        if (missing) {
            const titles = el('span', 'research-overview__group-titles');
            titles.append(title, el('span', 'research-overview__group-missing', missingText));
            gh.append(chevron, titles);
        } else {
            gh.append(chevron, title);
        }
        if (kind !== name) gh.appendChild(el('span', 'research-overview__group-kind', kind));
        gh.appendChild(el('span', 'research-overview__group-span', String(g.items.length)));
        gh.setAttribute('aria-label', `${name} · ${g.items.length}${kind !== name ? `, ${kind}` : ''}${missingText ? `, ${missingText}` : ''}`);
        gh.onclick = toggle;
        row.appendChild(gh);
        const action = this.overviewWaitingGroupAction(s, g, phase, mode);
        if (action) row.appendChild(action);
        // Two or more of its items wait for images from one browser-only archive: said once, here (spec 048 §11.2).
        const ctx = this.overviewBrowserContext(mode);
        const note = browserGroupNote(s.browser, g.items, s.waiting, ctx);
        if (note) {
            row.classList.add('has-browser-note');
            row.appendChild(this.browserNoteEl(note, s.researchId, 'research-overview__waiting-groupnote-browser'));
            for (const w of g.items) if (browserNote(s.browser, w, s.waiting, ctx)?.host === note.host) browserNotedInHead.add(itemKey(s, w.id));
        }
        return row;
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
                const btn = this.waitingWriteButton(W.groupSent, 'group-sent', () => { void this.markWaitingGroupSent(s, key); },
                    'research-overview__waiting-groupwrite');
                btn.setAttribute('aria-label', W.groupSentLabel(name, sendable.length));
                box.appendChild(btn);
            }
        }
        if (key && writes.note && waitingGroupHasNote(s.waiting.filter(w => w.group?.key === key))) {
            const btn = el('button', 'live-waiting-answer research-overview__waiting-groupwrite research-overview__waiting-groupnote', W.groupNote);
            btn.type = 'button';
            btn.dataset.action = 'group-note';
            btn.setAttribute('aria-label', `${W.groupNote} · ${name}`);
            btn.onclick = (e) => {
                e.stopPropagation();
                void this.showWaitingGroupNote(s, key, name);
            };
            box.appendChild(btn);
        }
        return box.childElementCount > 0 ? box : null;
    },

    /** The browser note's context in the overview: a phone gets no links. */
    overviewBrowserContext(mode: Mode): { phone: boolean; links: boolean } {
        const phone = mode === 'sheet';
        return { phone, links: !phone && this.researchLinkAvailable('archive') };
    },

    /** One waiting item: a compact row (kind, text in two lines, person, age); a click opens its detail. */
    overviewWaitingRow(s: LiveSession, w: LiveWaiting, mode: Mode): HTMLElement {
        const L = strings.live;
        const view = s.waitingView;
        const open = view.detail === w.id;
        const li = el('li', 'research-overview__waiting-item');
        li.dataset.id = w.id;
        // A growing branch is a suggestion: lit as new while it waits.
        if (view.fresh.has(w.id) || w.kind === 'branch') li.classList.add('is-fresh');
        if (open) li.classList.add('is-open');
        const detailId = `ov-wait-${w.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
        const row = el('button', 'research-overview__waiting-row');
        row.type = 'button';
        row.setAttribute('aria-expanded', String(open));
        row.setAttribute('aria-controls', detailId);
        const head = el('span', 'research-overview__waiting-what');
        if (w.kind === 'story') head.appendChild(el('span', 'live-kind-story', L.kindStory));
        else if (w.kind === 'branch') head.appendChild(el('span', 'live-kind live-kind--decide', L.waitBranchKind));
        else if (w.section || w.kind) head.appendChild(waitingKindLabel(w));
        head.append(w.kind === 'story' ? strings.story.nvWaitingItem : w.kind === 'branch' ? waitBranchText(w, s) : w.what);
        row.appendChild(head);
        const meta = el('span', 'research-overview__waiting-meta');
        const people = w.kind === 'story' ? storyWaitingPeople(w).map(p => p.name) : [personByRefn(w.person)].filter((p): p is Person => !!p).map(fullName);
        meta.appendChild(el('span', people.length > 0 ? 'research-overview__waiting-who' : 'research-overview__muted', people.length > 0 ? people.join(', ') : L.wholeResearch));
        const img = imagesState(w);
        if (img) meta.appendChild(imagesShortEl(itemKey(s, w.id), img));
        if (waitingPhase(w) === 'sent') {
            const ts = Date.parse(w.sentAt || w.at);
            if (Number.isFinite(ts)) {
                meta.appendChild(el('span', 'research-overview__waiting-sent',
                    L.waitingSentOn(new Date(ts).toLocaleDateString(getCurrentLanguage(), { day: 'numeric', month: 'numeric' }))));
            }
            if (Number.isFinite(ts)) meta.appendChild(el('span', 'research-overview__waiting-age', waitingDaysAgo(ts, Date.now(), getCurrentLanguage())));
        } else {
            const at = timeEl(w.at, 'ago');
            if (at) meta.appendChild(at);
        }
        row.appendChild(meta);
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

    /** An item's detail: the whole text (addresses as links), what it waits on, whom, the person, and its actions. */
    overviewWaitingDetail(s: LiveSession, w: LiveWaiting, mode: Mode): HTMLElement {
        const r = strings.research;
        const L = strings.live;
        const detail = el('div', 'research-overview__waiting-detail');
        if (w.kind === 'story') {
            // A story's new version: the comparison opens here (no (research)).
            const text = el('div', 'research-overview__waiting-text');
            const compare = this.appendStoryWaiting(text, w, (id) => this.overviewShowPerson(id, mode));
            const actions = el('div', 'research-overview__waiting-actions');
            actions.appendChild(compare);
            detail.append(text, actions);
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
        // Images, a website or a check (spec 048 U6): the actions of their kind, an answer written here, the images' state.
        const writes = this.liveWaitingWrites(s);
        const views = waitingActions(w, { writes, links: mode !== 'sheet' && this.researchLinkAvailable('task'), phone: mode === 'sheet' });
        const key = itemKey(s, w.id);
        if (views && answerChanged.has(key)) detail.appendChild(waitingAnswerChangedNote());
        const text = el('div', 'research-overview__waiting-text');
        appendLinkedText(text, w.what);
        detail.appendChild(text);
        // "on" is the agent's free text (an archive's terms); "user" only repeats the heading.
        if (!waitsOnUser(w.on)) {
            const on = el('small', 'research-overview__waiting-on');
            appendLinkedText(on, r.waitingOn(w.on));
            detail.appendChild(on);
        }
        if (w.to) detail.appendChild(el('small', 'research-overview__waiting-on', L.waitingTo(w.to)));
        const img = views ? imagesState(w) : null;
        if (img) appendImagesDetail(detail, img);
        // An archive only the agent's browser reaches (spec 048 §11.2): under the book, unless its group's heading says it.
        const bNote = views && !browserNotedInHead.has(key) ? browserNote(s.browser, w, s.waiting, this.overviewBrowserContext(mode)) : null;
        const bNoteEl = bNote ? this.browserNoteEl(bNote, s.researchId) : null;
        if (bNoteEl) detail.appendChild(bNoteEl);
        const meta = el('div', 'research-overview__waiting-meta');
        const person = personByRefn(w.person);
        if (person) {
            const link = el('button', 'live-person-link');
            link.innerHTML = fitNameHtml(person, fullName(person));
            link.type = 'button';
            link.onclick = () => this.overviewShowPerson(person.id, mode);
            meta.appendChild(link);
        } else {
            meta.appendChild(el('span', 'research-overview__muted', L.wholeResearch));
        }
        const dir = taskDirectionName(s, w.research);
        if (dir) meta.appendChild(el('span', 'research-overview__dir', `· ${dir}`));
        if (!img && w.inbox?.want !== undefined) meta.appendChild(el('span', 'research-overview__waiting-inbox', L.waitingInbox(w.inbox.have, w.inbox.want)));
        detail.appendChild(meta);
        if (views) {
            this.appendWaitingTaskActions(detail, s, w, views, mode);
            // Not beside the open "Have images" area or an answer being written.
            if (bNoteEl && detail.querySelector('.waiting-upload, .waiting-answer')) bNoteEl.remove();
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
        }
        if (actions.childElementCount > 0) detail.appendChild(actions);
        if (hint) detail.appendChild(el('p', 'research-overview__waiting-hint', L.waitingAnswerHint));
        if (mode === 'sheet') detail.appendChild(el('div', 'research-overview__muted', L.answerOnComputer));
        return detail;
    },

    /**
     * The actions of an item waiting for images, a website or a check (spec
     * 048 §1, §5, §9), by weight: the main one filled, the next outlined, the
     * rest as links; beyond two beside it, "More actions" (⋯). The research's
     * other actions it offers (Sent, a file, the query's text) come after
     * them. "Answer" through the bridge opens the answer in the detail (the
     * actions hide meanwhile); through the terminal, its hint goes under them.
     */
    appendWaitingTaskActions(detail: HTMLElement, s: LiveSession, w: LiveWaiting, views: readonly WaitActionView[], mode: Mode): void {
        const L = strings.live;
        const T = L.waitingTask;
        const W = L.waitingWrite;
        const key = itemKey(s, w.id);
        const task = researchTaskRef(w.id);
        const phone = mode === 'sheet';
        // The upload area of "Add images" (spec 048 §3): open, the actions hide meanwhile.
        const area = !phone && views.some(v => v.key === 'images') ? this.overviewImagesArea(s, w) : null;
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
            detail.appendChild(this.overviewAnswerForm(s, w, task).root);
            return;
        }
        if (answeringKey === key) closeAnswerForm();
        const list: ItemAction[] = [];
        for (const v of views) {
            if (v.key === 'web') {
                if (w.url) list.push({ key: 'web', label: T.openWeb, href: w.url });
            } else if (v.key === 'images') {
                list.push({ key: 'images', label: T.haveImages, run: () => this.openWaitingImages(s, w) });
            } else if (v.key === 'answer' && v.via === 'bridge') {
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
                list.push({ key: 'sent', label: W.sent, write: true, run: () => { void this.markWaitingSent(s, w); } });
            } else if (action === 'file' && writes.file && waitingFileWritable(w)) {
                list.push({ key: 'file', label: W.file, write: true, run: () => this.pickWaitingFile(s, w) });
            } else if (links) {
                const url = this.activeResearchLink('task', { task, taskDo: waitingActionDo(action) });
                if (url) list.push({ key: action, label: L.waitingActions[action], mark: researchLinkMark('task', { taskDo: waitingActionDo(action) }), run: () => this.launchResearchLink(url) });
            }
        }
        if (task && writes.sent && waitingUnsendable(w)) {
            list.push({ key: 'unsent', label: W.unsent, write: true, run: () => { void this.markWaitingUnsent(s, w.id); } });
        }
        const { shown, more } = splitWaitingActions(list, { phone: mode === 'sheet' });
        if (shown.length > 0) {
            const row = el('div', 'research-overview__waiting-actions waiting-actions');
            shown.forEach((a, i) => row.appendChild(waitingActionEl(a, i === 0 ? 'primary' : i === 1 ? 'secondary' : 'link')));
            if (more.length > 0) {
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
                row.appendChild(btn);
            }
            detail.appendChild(row);
        }
        // Answered in the terminal: the answer is kept with the task.
        if ([...shown, ...more].some(a => a.key === 'answer' && !!a.mark)) {
            detail.appendChild(el('p', 'research-overview__waiting-hint', T.answerHintOld));
        }
        // A phone adds no images and answers only through the bridge: it says where the rest is done.
        if (phone && waitingForImages(w)) detail.appendChild(el('p', 'research-overview__muted waiting-phone-note', T.phoneImages));
        if (phone && !views.some(v => v.key === 'answer' && v.via === 'bridge')) {
            detail.appendChild(el('p', 'research-overview__muted waiting-phone-note', T.phoneNoAnswer));
        }
    },

    /** The answer being written in the overview closes (its draft stays). */
    closeOverviewAnswer(): void {
        closeAnswerForm();
    },

    /** "Answer" through the bridge: the answer opens in the item's detail, the field focused (its draft back). */
    openOverviewAnswer(s: LiveSession, w: LiveWaiting): void {
        closeAnswerForm();
        answeringKey = itemKey(s, w.id);
        this.closeWaitingMoreMenu();
        this.renderResearchOverview();
        const form = answerForms.get(answeringKey);
        if (form?.root.isConnected) form.focus();
    },

    /** The item's answer form, the same node over every redraw (what is written, the caret, an error). */
    overviewAnswerForm(s: LiveSession, w: LiveWaiting, task: string): WaitingAnswerForm {
        const key = itemKey(s, w.id);
        let form = answerForms.get(key);
        if (form && !form.spent) return form;
        const focusAnswer = (): void => {
            this.renderResearchOverview();
            const li = document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(w.id)}"]`);
            li?.querySelector<HTMLElement>('[data-action="answer"]')?.focus();
        };
        form = new WaitingAnswerForm({
            treeId: s.treeId, task, idPrefix: `ov-answer-${w.id}`,
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
                answerForms.delete(key);
                if (answeringKey === key) answeringKey = null;
                answerChanged.delete(key);
                this.renderResearchOverview();
            },
        });
        answerForms.set(key, form);
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
            }
        };
        if (offered && task && (links || writes.sent || writes.file)) {
            let answer = false;
            for (const action of offered) {
                if (action === 'sent' && writes.sent && waitingSendable(w)) {
                    host.appendChild(this.waitingWriteButton(W.sent, 'sent', () => { void this.markWaitingSent(s, w); }));
                    continue;
                }
                if (action === 'file' && writes.file && waitingFileWritable(w)) {
                    host.appendChild(this.waitingWriteButton(W.file, 'file', () => this.pickWaitingFile(s, w)));
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
        const multi = linesMulti(s);
        const groups = multi ? workingLineGroups(s) : [];
        const lines = workingLineCount(groups);
        const host = liveSection(body, {
            ...fold, title: lines >= 2 ? strings.otherResearch.nowLines(lines) : L.now,
            summary: multi ? undefined
                : w0 ? [w0.who, w0.paused ? L.statePaused : Number.isFinite(since0) ? liveDuration(since0) : ''].filter(Boolean).join(' · ') : L.nobody,
            help: nowHelpTopic(s),
        });
        // First in Now: the other trees where an agent works or something waits (spec 011).
        this.appendResearchElsewhere(host, 'overview');
        const list = el('ul', 'live-panel-list live-working research-overview__now');
        host.appendChild(list);
        if (multi) {
            // Two or more lines at work: a row per line, the selected one marked (spec 011).
            const sel = queueDirectionFilter(s);
            for (const g of groups) list.appendChild(this.overviewNowLine(g, sel === g.id, mode));
            const stopped = sel !== 'all' && !groups.some(g => g.id === sel) ? s.researches.find(d => d.id === sel) : undefined;
            if (stopped) list.appendChild(this.overviewNowLine({ id: stopped.id, direction: stopped, workers: [] }, true, mode));
            return;
        }
        if (s.working.length === 0) list.appendChild(el('li', 'live-empty', L.nobody));
        for (const w of s.working) {
            const li = el('li', 'research-overview__now-row');
            const text = el('div', 'research-overview__now-text');
            text.appendChild(el('strong', undefined, w.who));
            if (w.task) text.appendChild(el('span', 'live-task', ` — ${w.task}`));
            // How the task helps its line, or its branch outside the lines; else the line's name (two or more lines).
            const why = workingWhyText(w, s);
            const dir = why || taskDirectionName(s, w.research);
            if (dir) text.appendChild(el('span', why ? 'research-overview__dir research-overview__why' : 'research-overview__dir', ` · ${dir}`));
            if (w.paused) text.appendChild(el('span', 'live-paused', pausedText(w)));
            const since = timeEl(w.since, 'sincefor');
            if (since) text.appendChild(since);
            li.appendChild(text);
            // Its actions in a row of links under the text (the text keeps the whole width).
            const person = personByRefn(w.person);
            const actions = this.overviewNowActions(w, mode, person ? () => this.overviewShowPerson(person.id, mode) : null);
            if (actions) li.appendChild(actions);
            list.appendChild(li);
        }
    },

    /**
     * A session's actions under its text in Now: Show in tree (when it has
     * whom to show) · Finish and stop (in the research: the agent writes up
     * what it found and closes the session; not on the phone's sheet).
     * Nothing to offer: no row.
     */
    overviewNowActions(w: LiveWorker, mode: Mode, show: (() => void) | null): HTMLElement | null {
        const L = strings.live;
        const row = el('div', 'research-overview__now-actions');
        if (show) {
            const btn = el('button', 'link-button research-overview__show-in-tree', L.showInTree);
            btn.type = 'button';
            btn.onclick = show;
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
    overviewNowLine(g: WorkingLine, selected: boolean, mode: Mode): HTMLElement {
        const L = strings.live;
        const s = drawnSession();
        const li = el('li', 'research-overview__now-row research-overview__now-row--line');
        if (g.id) li.dataset.direction = g.id;
        if (selected) li.classList.add('is-selected');
        const glyph = el('span', 'live-line__glyph', g.id ? directionGlyph(g.direction) : '·');
        glyph.setAttribute('aria-hidden', 'true');
        li.appendChild(glyph);
        const text = el('div', 'research-overview__now-text');
        const name = g.direction?.name ?? L.dirOutside;
        // Show in tree: the line's people lit up; work outside the directions: its person. Under the first session (or the idle line).
        const d = g.direction;
        const workerPerson = g.workers.map(w => personByRefn(w.person)).find((p): p is Person => !!p);
        const show = (d ? directionPersonIds(d) : workerPerson)
            ? () => (d ? this.showDirectionInTree(d, mode) : workerPerson && this.overviewShowPerson(workerPerson.id, mode))
            : null;
        if (g.workers.length === 0) {
            text.appendChild(el('strong', undefined, name));
            text.appendChild(el('small', 'research-overview__now-meta', strings.otherResearch.lineIdle('')));
            if (show) {
                const row = el('div', 'research-overview__now-actions');
                const btn = row.appendChild(el('button', 'link-button research-overview__show-in-tree', L.showInTree));
                btn.type = 'button';
                btn.onclick = show;
                text.appendChild(row);
            }
        }
        g.workers.forEach((w, i) => {
            const head = el('div', 'research-overview__now-line');
            if (i === 0) head.appendChild(el('strong', undefined, name));
            if (w.task) head.appendChild(el('span', 'live-task', i === 0 ? ` — ${w.task}` : w.task));
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
        const host = liveSection(body, { ...fold, title: L.timeline, summary: changes.length > 0 ? String(changes.length) : undefined });
        host.classList.add('research-overview__timeline');

        const bar = el('div', 'research-overview__timeline-bar');
        const filters = el('div', 'research-overview__filters');
        filters.setAttribute('role', 'radiogroup');
        filters.setAttribute('aria-label', L.filterLabel);
        const count = (f: Filter): number => (f === 'all' ? changes.length : changes.filter(c => c.kind === f).length);
        const labels: Record<Filter, string> = { all: L.filterAll, persons: L.filterPersons, sources: L.filterSources, stories: L.filterStories };
        for (const f of ['all', 'persons', 'sources', 'stories'] as Filter[]) {
            const chip = el('button', 'research-overview__filter', `${labels[f]} ${count(f)}`);
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
            for (const c of g.items.slice(0, GROUP_ROWS)) {
                const li = el('li', 'research-overview__row');
                const ts = Date.parse(c.at);
                if (Number.isFinite(ts) && ts >= openedAt && Date.now() - ts < 4000) li.classList.add('is-new');
                li.appendChild(el('span', 'research-overview__row-time', Number.isFinite(ts) ? hhmm(ts) : ''));
                const text = el('span', 'research-overview__row-text');
                if (appendChangeText(text, c, (id) => this.overviewShowPerson(id, mode), sources)) this.appendSourceInNewer(text, s, c, true);
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

    /** What the research knows across the tree: open conflicts first, then hypotheses. */
    appendOverviewKnows(body: HTMLElement, fold: LiveFold, mode: Mode): void {
        const L = strings.live;
        const facts = strings.research.changeWords.facts as Record<string, string>;
        const rows: { person: Person; text: string; conflict: boolean; conflictId?: string; hypo?: ResearchHypothesis }[] = [];
        // A list of proposals accepted at once (spec 074 §10): its rows stay, decided, with what became of each.
        const rid = this.activeResearchId();
        const batch = rid ? acceptBatch(rid) : null;
        for (const p of Object.values(DataManager.getData().persons)) {
            // As the research has them now: one decided from here (or read decided from its version not loaded) goes at once.
            for (const c of this.researchConflictsOf(p.id)) {
                if (c.status === 'decided') continue;
                const what = c.title || facts[c.fact] || c.fact;
                rows.push({ person: p, text: `${fullName(p)} · ${what}: ${c.values.map(v => conflictValueSaid(researchValueText(c.fact, v.value))).join(' × ')}`, conflict: true,
                    conflictId: researchConflictRef(c.id) ?? undefined });
            }
            for (const h of p.research?.hypotheses ?? []) {
                if (!isOpenHypothesis(h) && !(h.id && acceptBatchRowResult(batch, h.id))) continue;
                rows.push({ person: p, text: `${fullName(p)} · ${L.hypothesisRow(h.title)}`, conflict: false, hypo: h });
            }
        }
        // The tree's "Verifying" (spec 065 §10k): waiting facts, Stop, the bulk verification.
        const verify = this.treeVerifyBlock(() => { if (mode === 'sheet') this.closeResearchOverview(); });
        if (rows.length === 0 && !verify) return;
        rows.sort((a, b) => Number(b.conflict) - Number(a.conflict));
        const conflicts = rows.filter(r => r.conflict).length;
        const openHypos = rows.filter(r => r.hypo && isOpenHypothesis(r.hypo)).length;
        const host = liveSection(body, { ...fold, title: L.knowsTitle, ...(rows.length > 0 ? { summary: L.knowsSum(conflicts, openHypos) } : {}) });
        if (rows.length === 0) {
            host.appendChild(verify!);
            return;
        }
        // Its kinds (spec 052 §3): chips All / Conflicts / Hypotheses when both are there.
        const choice = knowsKindChoice(conflicts, rows.length - conflicts, knowsKind);
        if (choice.chips) host.appendChild(this.knowsKindChips(choice.kind, rows.length, conflicts));
        const shownRows = rows.filter(r => knowsKindShows(choice.kind, r.conflict));
        // Accepting the agent's proposals at once (§10): a box before each hypothesis, the list's head and foot.
        // The head and "Select all" are about the rows shown; the conflicts alone have none.
        const accept = choice.kind === 'con' ? null : this.hypothesisKnowsAccept(shownRows.flatMap(r => r.hypo?.id ? [r.hypo.id] : []), mode);
        // All with both kinds: the conflicts first, the head of the accepting over the hypotheses under them.
        const split = choice.chips && choice.kind === 'all' && !!accept?.head;
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
            const li = el('li');
            const btn = el('button', `research-overview__knows-row${row.conflict ? ' is-conflict' : ''}`);
            btn.type = 'button';
            const entry = row.hypo?.id ? accept?.entries.get(row.hypo.id) ?? null : null;
            const tags = row.hypo ? this.hypothesisKnowsTagsEl(row.hypo, entry) : null;
            if (tags) {
                btn.classList.add('has-tags');
                btn.append(el('span', 'rok-text', `${row.text} ›`), tags);
            } else {
                btn.textContent = `${row.text} ›`;
            }
            btn.onclick = () => {
                if (mode === 'sheet') this.closeResearchOverview();
                // A conflict's row: the dialog at its card (decided there); a hypothesis's: at its card.
                this.showPersonResearchDialog(row.person.id, row.conflictId ? { conflict: row.conflictId }
                    : row.hypo?.id && this.researchHypothesisPickable(row.hypo) !== 'old' ? { hypo: { id: row.hypo.id } } : {});
            };
            if (accept && !(split && row.conflict)) {
                li.classList.add('rok-item');
                if (entry) li.appendChild(this.hypothesisAcceptBoxEl(rid!, entry, 'knows'));
                else li.appendChild(el('span', 'hp2-box hp2-box--none')).setAttribute('aria-hidden', 'true');
            }
            li.appendChild(btn);
            list.appendChild(li);
        }
        host.appendChild(list);
        if (accept?.foot) host.appendChild(accept.foot);
        if (verify) host.appendChild(verify);
    },

    /** The kind chips of "What the research knows": All / Conflicts / Hypotheses, each with its count. */
    knowsKindChips(kind: KnowsKind, all: number, conflicts: number): HTMLElement {
        const L = strings.live;
        const pills = el('div', 'research-overview__filters research-overview__knows-kinds');
        pills.setAttribute('role', 'radiogroup');
        pills.setAttribute('aria-label', L.knowsKindAria);
        const options: [KnowsKind, string, number][] = [
            ['all', L.knowsKindAll, all], ['con', L.knowsKindCon, conflicts], ['hyp', L.knowsKindHyp, all - conflicts],
        ];
        for (const [id, label, n] of options) {
            const chip = el('button', 'research-overview__filter', `${label} ${n}`);
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

    /** Foot: where evidence is missing (the tree overview's Data quality), Open the research (research). */
    appendOverviewFoot(root: HTMLElement, s: LiveSession, mode: Mode): void {
        const L = strings.live;
        const foot = el('div', 'research-overview__foot');
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
            btn.onclick = () => this.launchResearchLink(open);
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
            const stop = el('button', 'live-panel-action research-overview__stop', r.stop);
            stop.type = 'button';
            stop.onclick = () => this.stopLiveFollow();
            head.appendChild(stop);
        } else if (source === 'bridge' && !this.activeResearchAgentless()) {
            const follow = el('button', 'research-overview__follow-live research-overview__follow-live--head', r.followLive);
            follow.type = 'button';
            follow.title = L.followNote;
            follow.onclick = () => this.startFollowLive('overview');
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

    /** A person from the overview: centred in the tree (the sheet closes first). */
    overviewShowPerson(id: PersonId, mode: Mode): void {
        if (!DataManager.getPerson(id)) return;
        // Looking at someone else: the user has the tree.
        this.pauseLiveFollow();
        if (mode === 'sheet') this.closeResearchOverview();
        if (document.querySelector(`.person-card[data-id="${CSS.escape(id)}"]`)) {
            ZoomPan.centerOnPerson(id);
        } else {
            TreeRenderer.setFocus(id);
            void TreeRenderer.renderAsync().then(() => ZoomPan.centerOnPerson(id));
        }
    },
});
