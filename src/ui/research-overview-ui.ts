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
import { Person, PersonId } from '../types.js';
import { computeEvidenceGaps } from '../stats.js';
import { LiveChangeKind, LiveWaiting, ResearchActionMark, WAITING_SECTIONS, researchConflictRef, researchTaskRef, recentAddsCount, researchLinkMark } from '../research-link.js';
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
} from './research-ui.js';
import { storyWaitingPeople } from './story-compare-ui.js';
import {
    WorkingLine, directionDragActive, directionGlyph, directionPersonIds, directionRedrawHeld, keepLineFocus, linesMulti, queueDirectionFilter, taskDirectionName, workingLineCount, workingLineGroups,
} from './research-directions-ui.js';
import { conflictValueSaid, researchValueText } from './person-research-ui.js';
import { shownName, fitNameHtml } from '../person-name.js';
import { isOpenHypothesis } from '../view-links.js';
import { waitBranchText } from './research-offline-ui.js';
import { beginQueueSlots, endQueueSlots } from '../research-queue-pages.js';
import { PREF_KEYS, SectionPref, prefKeyOfOverview, sectionPrefs, setSectionPref } from './live-section-prefs.js';

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
type Mode = 'docked' | 'overlay' | 'sheet';

let filter: Filter = 'all';
/** When the overview was opened (changes after it are marked new for a moment). */
let openedAt = 0;
/** Older change groups the user unfolded (by group key). */
const toggledGroups = new Set<string>();
/** The card lit up by hovering a change row. */
let hovered: HTMLElement | null = null;

/** A phone (≤ 640 px) and a phone held sideways get the full-screen sheet. */
function overviewMode(): Mode {
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

/** Light a card up while its change row is hovered. */
function hoverCard(id: PersonId | null): void {
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

export const researchOverviewMethods = uiModule({
    /** ⤢ is offered: following a research, on a screen wider than a phone. */
    canOpenResearchOverview(): boolean {
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
            return localStorage.getItem(OPEN_KEY) === '1' && this.canOpenResearchOverview();
        } catch {
            return false;
        }
    },

    /**
     * Open the overview. `showWaiting`: "Awaiting action" shown there expanded
     * until it closes, whatever its choice (the chip of a hidden or collapsed
     * one), with the focus on its heading.
     */
    openResearchOverview(opts: { showWaiting?: boolean } = {}): void {
        const s = liveSession();
        if (!s || s.ended) return;
        s.overview = true;
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

    /** "Awaiting action" in the open overview, shown until it closes (the choice stays), in view and focused. */
    showOverviewWaiting(): void {
        const s = liveSession();
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

    /** ⤡ (and Escape): back to the small panel; following goes on. */
    closeResearchOverview(): void {
        const s = liveSession();
        if (!s) return;
        s.overview = false;
        // What was unfolded, opened and new in "Awaiting action" lasts while the overview is open;
        // so do the sections shown whatever their choice.
        s.waitingView = newWaitingView();
        s.overviewShown.clear();
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
        // A direction dragged: its row stays under the pointer; the redraw comes when it lands.
        if (directionDragActive()) {
            directionRedrawHeld();
            return;
        }
        queueMicrotask(keepLineFocus());
        queueMicrotask(keepAnswerFocus());
        const s = liveSession();
        const on = !!s && !s.ended && s.overview && DataManager.getCurrentTreeId() === s.treeId;
        // "More actions" belongs to the open detail: gone with it.
        if (moreMenuFor && (!on || s?.waitingView.detail !== moreMenuFor)) this.closeWaitingMoreMenu();
        let root = document.getElementById('research-overview');
        if (!on || !s) {
            // Nothing shows the queue's pages: their reads stop.
            beginQueueSlots();
            endQueueSlots();
            if (root) {
                root.remove();
                hoverCard(null);
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
        root.className = `research-overview research-overview--${mode}`;
        root.dataset.form = `${mode === 'sheet'}:${window.innerWidth >= 1280}`;
        if (mode === 'sheet') {
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
        } else {
            root.setAttribute('role', 'complementary');
            root.removeAttribute('aria-modal');
        }
        root.setAttribute('aria-label', L.overviewTitle);
        const scroller = root.querySelector<HTMLElement>('.research-overview__body');
        const scrollTop = scroller?.scrollTop ?? 0;
        root.replaceChildren();
        // The queue's pages this drawing shows (a branch unfolded, the queue's filter); the rest is let go at its end.
        beginQueueSlots();

        // Head: state dot, title over a line with the research's name and
        // Stop, then the follow switch and ⤡ / ×. Stop on the name's line
        // keeps the title whole in the 400px overlay and on a phone.
        const head = el('div', 'research-overview__head');
        head.appendChild(el('span', 'live-dot live-dot--still'));
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
        const stop = el('button', 'live-panel-action', r.stop);
        stop.type = 'button';
        stop.onclick = () => this.stopLiveFollow();
        // The full-screen sheet covers the tree: no follow switch there.
        const follow = mode === 'sheet' ? null : this.liveFollowButton('overview');
        sub.append(stop);
        // "Awaiting action" hidden: its count stays in sight; a click shows it here until the overview closes.
        if (sectionPref('waiting') === 'hidden' && s.waiting.length > 0) {
            const chip = waitingChip(s, () => this.showOverviewWaiting());
            if (chip) sub.append(chip);
        }
        if (follow) head.appendChild(follow);
        // Customize panel: after the follow switch, before ⤡ / ×.
        head.appendChild(this.liveSectionMoreButton('research-overview__more', 'overview'));
        head.appendChild(close);
        root.appendChild(head);
        // Following on: "Follow in: Family / Fan / Map" under the head (in the phone's sheet too: a phone
        // held sideways keeps the strip to one row and has it only here).
        const followView = this.liveFollowViewRow('overview');
        if (followView) root.appendChild(followView);

        const body = el('div', 'research-overview__body');
        root.appendChild(body);
        // Which tree is followed now (after a switch), first.
        appendFollowNote(body, s);
        this.appendOverviewSummary(body, s, mode);
        if (s.update) this.appendUpdateStrip(body, s.update.version, s.busy);

        // A section hidden by the choice is not drawn, unless shown until the overview closes
        // (expanded, its heading says so and does not fold). A click on a heading is a lasting choice.
        const shown = (key: string): boolean => sectionPref(key) !== 'hidden' || s.overviewShown.has(key);
        const fold = (key: string): LiveFold => {
            const f = foldOf(key);
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
        if (shown('now')) this.appendOverviewNow(body, s, fold('now'), mode);
        if (s.waiting.length > 0 && shown('waiting')) {
            const f = fold('waiting');
            // Collapsed: "N new" beside the title; expanded: what is to do now is seen.
            if (f.collapsed) {
                const chip = waitingNewChip(s);
                if (chip) f.extra = [...(f.extra ?? []), chip];
            } else {
                noteWaitingShown(s);
            }
            this.appendOverviewWaiting(body, s, f, mode);
        }
        if (shown('directions')) this.appendOverviewDirections(body, s, fold('directions'), mode);
        if (shown('timeline')) this.appendOverviewTimeline(body, s, fold('timeline'), mode);
        if (!s.ended && shown('queue')) this.appendQueueSection(body, s, fold('queue'), 20, L.queueTitle, true);
        if (shown('knows')) this.appendOverviewKnows(body, fold('knows'), mode);
        this.appendOverviewFoot(root, s, mode);
        endQueueSlots();
        body.scrollTop = scrollTop;

        this.setResearchOverviewDocked(mode === 'docked');
        ensureLiveTicker();
        this.syncLiveSectionEditor();
    },

    /** The summary strip: state, what came while watching, this month. */
    appendOverviewSummary(body: HTMLElement, s: LiveSession, mode: Mode): void {
        const L = strings.live;
        const data = DataManager.getData();
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const sources = Object.keys(data.sources ?? {}).length;
        const strip = el('div', 'research-overview__summary');
        const cell = (label: string, value: string, sub: HTMLElement | string, cls = '', title = ''): void => {
            const c = el('div', `research-overview__cell${cls ? ` ${cls}` : ''}`);
            c.append(el('div', 'research-overview__cell-label', label), el('div', 'research-overview__cell-value', value));
            const subEl = typeof sub === 'string' ? el('div', 'research-overview__cell-sub', sub) : sub;
            // One line; the whole text (and the research version) on hover.
            subEl.title = title || subEl.textContent || '';
            c.appendChild(subEl);
            strip.appendChild(c);
        };
        const { label: state, cls: stateCls } = liveState(s);
        // When the research last changed (its own time; else the last change
        // seen; unknown: nothing). The research version (commit) on hover.
        const lastIso = s.headAt || s.changes[0]?.at || '';
        const lastEl = timeEl(lastIso, 'lastchange');
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
        if (s.logged) {
            // What the research added in the last 24 hours: the bridge's own count
            // (and what came after it), else from its history.
            const added = recentAddsCount(s.recent, s.adds, Date.now(), RECENT_MS);
            cell(L.last24h, L.plusPersons(added.persons), L.plusSourcesToday(added.sources));
        } else {
            cell(L.sinceWatching, L.plusPersons(Math.max(0, persons - s.startPersons)),
                L.plusSources(Math.max(0, sources - s.startSources), hhmm(s.startedAt)));
        }
        if (s.spend && mode !== 'sheet') {
            const currency = s.spend.currency;
            const money = (n: number): string => {
                try {
                    return new Intl.NumberFormat(getCurrentLanguage(), { style: 'currency', currency }).format(n);
                } catch {
                    return `${n.toFixed(2)} ${currency}`;
                }
            };
            const amount = money(s.spend.amount);
            const url = this.activeResearchLink('sessions');
            let sub: HTMLElement;
            if (url) {
                sub = setResearchActionLabel(el('button', 'link-button research-overview__cell-sub'), L.sessions(s.spend.sessions), researchLinkMark('sessions'));
                (sub as HTMLButtonElement).type = 'button';
                sub.onclick = () => this.launchResearchLink(url);
            } else {
                sub = el('div', 'research-overview__cell-sub', L.sessions(s.spend.sessions));
            }
            cell(L.thisMonth, amount, sub);
            // Of it the scan readers (a bridge that counts them, when they cost anything).
            if (s.spend.readers) {
                const readers = el('div', 'research-overview__cell-sub research-overview__readers', L.scanReaders(money(s.spend.readers)));
                readers.title = readers.textContent ?? '';
                strip.lastElementChild?.appendChild(readers);
            }
        }
        strip.classList.toggle('research-overview__summary--two', strip.childElementCount === 2);
        body.appendChild(strip);
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
            for (const w of items) list.appendChild(this.overviewWaitingRow(s, w, mode));
            return list;
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
            const dir = taskDirectionName(s, w.research);
            if (dir) text.appendChild(el('span', 'research-overview__dir', ` · ${dir}`));
            if (w.paused) text.appendChild(el('span', 'live-paused', pausedText(w)));
            const since = timeEl(w.since, 'sincefor');
            if (since) text.appendChild(since);
            li.appendChild(text);
            const person = personByRefn(w.person);
            if (person) {
                const show = el('button', 'link-button', L.showInTree);
                show.type = 'button';
                show.onclick = () => this.overviewShowPerson(person.id, mode);
                li.appendChild(show);
            }
            // Finish and stop (in the research): the agent writes up what it found and closes the session.
            const finish = mode !== 'sheet' && w.session && !w.paused ? this.activeResearchLink('finish', { session: w.session }) : null;
            if (finish) {
                const btn = setResearchActionLabel(el('button', 'link-button research-overview__finish'), L.finishSession, researchLinkMark('finish'));
                btn.type = 'button';
                btn.title = L.finishHint;
                btn.onclick = () => this.launchResearchLink(finish);
                li.appendChild(btn);
            }
            list.appendChild(li);
        }
    },

    /**
     * A line in Now: glyph, "name — task", "agent · person · since · how
     * long", Show in tree (the line's people lit up; work outside the
     * directions: its person), Finish and stop (research) per session.
     */
    overviewNowLine(g: WorkingLine, selected: boolean, mode: Mode): HTMLElement {
        const L = strings.live;
        const li = el('li', 'research-overview__now-row research-overview__now-row--line');
        if (g.id) li.dataset.direction = g.id;
        if (selected) li.classList.add('is-selected');
        const glyph = el('span', 'live-line__glyph', g.id ? directionGlyph(g.direction) : '·');
        glyph.setAttribute('aria-hidden', 'true');
        li.appendChild(glyph);
        const text = el('div', 'research-overview__now-text');
        const name = g.direction?.name ?? L.dirOutside;
        if (g.workers.length === 0) {
            text.appendChild(el('strong', undefined, name));
            text.appendChild(el('small', 'research-overview__now-meta', strings.otherResearch.lineIdle('')));
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
            if (w.paused) parts.push(el('span', 'live-paused', pausedText(w)));
            else {
                const since = timeEl(w.since, 'sincefor');
                if (since) parts.push(since);
            }
            parts.filter(Boolean).forEach((part, j) => meta.append(...(j > 0 ? [' · ', part] : [part])));
            text.appendChild(meta);
        });
        li.appendChild(text);
        const d = g.direction;
        const workerPerson = g.workers.map(w => personByRefn(w.person)).find((p): p is Person => !!p);
        if (d ? directionPersonIds(d) : workerPerson) {
            const show = el('button', 'link-button', L.showInTree);
            show.type = 'button';
            show.onclick = () => (d ? this.showDirectionInTree(d, mode) : workerPerson && this.overviewShowPerson(workerPerson.id, mode));
            li.appendChild(show);
        }
        for (const w of g.workers) {
            const finish = mode !== 'sheet' && w.session && !w.paused ? this.activeResearchLink('finish', { session: w.session }) : null;
            if (!finish) continue;
            const btn = setResearchActionLabel(el('button', 'link-button research-overview__finish'), L.finishSession, researchLinkMark('finish'));
            btn.type = 'button';
            btn.title = L.finishHint;
            btn.onclick = () => this.launchResearchLink(finish);
            li.appendChild(btn);
        }
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
                    if (show) show.click();
                    else this.endEvidenceHighlight();
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
                this.startPersonHighlight('changed', changedTitle, changedIds, null);
            };
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
        const rows: { person: Person; text: string; conflict: boolean; conflictId?: string }[] = [];
        for (const p of Object.values(DataManager.getData().persons)) {
            // As the research has them now: one decided from here (or read decided from its version not loaded) goes at once.
            for (const c of this.researchConflictsOf(p.id)) {
                if (c.status === 'decided') continue;
                const what = c.title || facts[c.fact] || c.fact;
                rows.push({ person: p, text: `${fullName(p)} · ${what}: ${c.values.map(v => conflictValueSaid(researchValueText(c.fact, v.value))).join(' × ')}`, conflict: true,
                    conflictId: researchConflictRef(c.id) ?? undefined });
            }
            for (const h of p.research?.hypotheses ?? []) {
                if (!isOpenHypothesis(h)) continue;
                rows.push({ person: p, text: `${fullName(p)} · ${L.hypothesisRow(h.title)}`, conflict: false });
            }
        }
        if (rows.length === 0) return;
        rows.sort((a, b) => Number(b.conflict) - Number(a.conflict));
        const conflicts = rows.filter(r => r.conflict).length;
        const host = liveSection(body, { ...fold, title: L.knowsTitle, summary: L.knowsSum(conflicts, rows.length - conflicts) });
        const list = el('ul', 'live-panel-list research-overview__knows');
        for (const row of rows) {
            const li = el('li');
            const btn = el('button', `research-overview__knows-row${row.conflict ? ' is-conflict' : ''}`, `${row.text} ›`);
            btn.type = 'button';
            btn.onclick = () => {
                if (mode === 'sheet') this.closeResearchOverview();
                // A conflict's row: the dialog at its card (decided there).
                this.showPersonResearchDialog(row.person.id, row.conflictId ? { conflict: row.conflictId } : {});
            };
            li.appendChild(btn);
            list.appendChild(li);
        }
        host.appendChild(list);
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
        const s = liveSession();
        if (!s) return;
        if (sectionCollapsed(key) || sectionPref(key) === 'hidden') s.overviewShown.add(key);
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
