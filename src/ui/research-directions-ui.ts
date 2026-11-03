/**
 * Research directions in the Research overview ("research" in the research,
 * id G…): the Directions section after Now (only with two or more, or one
 * with running work outside it: the row "Outside the directions"), each
 * direction's detail (generations of ancestors, its last session, Work on it,
 * Show in tree), its ⋯ menu (pause / end / restart in the research), the
 * direction named beside tasks while two or more run, and what the person
 * menu's "Find ancestors / descendants / Review again" says when the person
 * already has such a direction. Bridge text is set as text, never HTML.
 */

import { setResearchActionLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatLiveClock } from '../live-time.js';
import { Person, PersonId } from '../types.js';
import { LiveDirection, LiveDirectionKind, LiveWorker, ResearchDirectionDo, researchLinkMark } from '../research-link.js';
import { uiModule } from './module.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { LiveSession, el, liveSection, liveSession, pausedText, timeEl } from './research-ui.js';
import { shownName, fitNameHtml } from '../person-name.js';
import {
    orderDirections, withPendingOrder, moveInOrder, dropInOrder, sameOrder, DirectionOrderWriter, DirectionMove, withBusyRetry,
    foundParts, directionUnstarted, calendarDaysAgo,
} from '../research-directions.js';
import { DirectionStateDo, DirectionWriteRefused, setDirectionState, writeDirectionOrder } from '../research-directions-write.js';

type Mode = 'docked' | 'overlay' | 'sheet';

/** The direction whose detail is open (one at a time). */
let expanded: string | null = null;
/** "Paused and ended" unfolded. */
let inactiveOpen = false;
/**
 * The selected direction ('all' or a direction id; not remembered): the
 * live panel's working line and the overview's queue filter are one choice.
 */
let queueFilter = 'all';
/** The tree the selection was made in (a switch or the end of following drops it). */
let queueFilterTree: string | null = null;
/** The selection lit its people up in the tree (dropping it ends that). */
let selectionLit = false;
/** When each direction was last seen at work (ms): a selected one that stopped says since when. */
const lastAtWork = new Map<string, number>();
let listening = false;

const KIND_GLYPH: Record<LiveDirectionKind, string> = { ancestors: '↑', descendants: '↓', person: '⌕', question: '?' };

/** The person menu's research items and the direction kind each would start. */
const MENU_KIND: Record<string, LiveDirectionKind> = {
    'research-ancestors': 'ancestors',
    'research-descendants': 'descendants',
    'research-review': 'person',
};

function personByRefn(refn: string | undefined): Person | null {
    if (!refn) return null;
    return Object.values(DataManager.getData().persons).find(p => p.refn === refn) ?? null;
}

const fullName = (p: Person): string => shownName(p);

function shortDate(iso: string): string {
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? new Date(ts).toLocaleDateString(getCurrentLanguage(), { day: 'numeric', month: 'numeric' }) : '';
}

/** Two or more directions run: tasks name theirs, the queue filters by them. */
export function directionsMulti(s: LiveSession | null): boolean {
    return !!s && s.researches.filter(d => d.state === 'active').length >= 2;
}

/** A task's direction name while two or more run ('' otherwise). */
export function taskDirectionName(s: LiveSession | null, research: string | undefined): string {
    if (!research || !directionsMulti(s)) return '';
    return s!.researches.find(d => d.id === research)?.name ?? '';
}

/** The selection still stands: the same tree, still followed, the direction still listed. */
function selectionHolds(s: LiveSession | null): boolean {
    return !!s && !s.ended && s.treeId !== null && s.treeId === queueFilterTree
        && s.treeId === DataManager.getCurrentTreeId() && s.researches.some(d => d.id === queueFilter);
}

/** The selected direction ('all': none). A selection that no longer stands is dropped. */
export function queueDirectionFilter(s: LiveSession | null): string {
    if (queueFilter !== 'all' && !selectionHolds(s)) {
        queueFilter = 'all';
        queueFilterTree = null;
    }
    return queueFilter;
}

export function setQueueDirectionFilter(id: string): void {
    queueFilter = id;
    queueFilterTree = id === 'all' ? null : liveSession()?.treeId ?? null;
}

/**
 * A redraw replaces the line controls (a line's row, All directions, a
 * queue pill): the focused one is focused again afterwards, on the same
 * direction, so a second Enter drops a selection made from the keyboard.
 * All directions, gone with the selection, hands focus to the line it
 * dropped. Returns the step to run after the redraw (focus moved
 * elsewhere meanwhile is left alone).
 */
export function keepLineFocus(): () => void {
    const a = document.activeElement as HTMLElement | null;
    const id = a?.dataset.direction;
    if (!a || !id) return () => {};
    const sel = a.matches('#live-panel button.live-line, #live-panel .live-lines-all') ? '#live-panel button.live-line'
        : a.matches('#research-overview .research-overview__queue-filters .research-overview__filter')
            ? '#research-overview .research-overview__queue-filters .research-overview__filter' : null;
    if (!sel) return () => {};
    return () => {
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        const all = [...document.querySelectorAll<HTMLElement>(sel)];
        (all.find(e => e.dataset.direction === id) ?? all[0])?.focus();
    };
}

/** A direction's glyph (↑ ↓ ⌕ ?; "·" for one that does not say its kind). */
export function directionGlyph(d: LiveDirection | undefined): string {
    return d?.direction ? KIND_GLYPH[d.direction] : '·';
}

/** One working line: a direction with its workers, or the work outside the directions (id null). */
export interface WorkingLine {
    id: string | null;
    direction?: LiveDirection;
    workers: LiveWorker[];
}

/** The work grouped by direction in the order the bridge sends it; work outside any is one group, last. */
export function workingLineGroups(s: LiveSession): WorkingLine[] {
    const out: WorkingLine[] = [];
    const outside: LiveWorker[] = [];
    for (const w of s.working) {
        const d = w.research ? s.researches.find(x => x.id === w.research) : undefined;
        if (!d) {
            outside.push(w);
            continue;
        }
        let g = out.find(x => x.id === d.id);
        if (!g) out.push(g = { id: d.id, direction: d, workers: [] });
        g.workers.push(w);
    }
    if (outside.length > 0) out.push({ id: null, workers: outside });
    return out;
}

/** Lines at work now (a paused run does not count). */
export function workingLineCount(groups: readonly WorkingLine[]): number {
    return groups.filter(g => g.workers.some(w => !w.paused)).length;
}

/**
 * The panel groups the work by direction: two or more lines at work, or a
 * selection standing (its line stays after it stops). One line: as before.
 */
export function linesMulti(s: LiveSession | null): boolean {
    if (!s || s.ended) return false;
    return workingLineCount(workingLineGroups(s)) >= 2 || queueDirectionFilter(s) !== 'all';
}

/** The selected direction while the panel groups by lines (undefined: none). */
export function selectedLine(s: LiveSession | null): LiveDirection | undefined {
    if (!linesMulti(s)) return undefined;
    const sel = queueDirectionFilter(s);
    return sel === 'all' ? undefined : s!.researches.find(d => d.id === sel);
}

/** A line's glyph beside a change or task while two or more lines run and none is selected ('' otherwise). */
export function lineGlyphFor(s: LiveSession | null, research: string | undefined): string {
    if (!research || !linesMulti(s) || queueDirectionFilter(s) !== 'all') return '';
    const d = s!.researches.find(x => x.id === research);
    return d ? directionGlyph(d) : '';
}

/** The running directions in the section's order (the queue's filter pills follow it). */
export function activeDirections(s: LiveSession): LiveDirection[] {
    return orderDirections(s.researches, !!s.caps?.directionsOrder).active.filter(d => d.state === 'active');
}

/**
 * Running work no direction of the list holds: no research named, or one the
 * list does not have (the bridge sends it so for a task outside the directions).
 */
export function outsideWork(s: LiveSession): LiveWorker[] {
    return s.working.filter(w => !w.paused && (!w.research || !s.researches.some(d => d.id === w.research)));
}

/** Running, but nothing to do and nobody on it. */
function isEmpty(d: LiveDirection): boolean {
    return d.state === 'active' && d.tasks === 0 && (d.waiting ?? 0) === 0 && !d.working;
}

// ==================== DIRECTIONS MANAGED THROUGH THE BRIDGE (spec 038) ====================

/** What the Directions section may do with the followed research. */
export interface DirectionsView {
    /** The bridge writes the directions (`caps.directionsWrite`); false: an older research, the terminal's links. */
    managed: boolean;
    /** An archive, or a research waiting for its agent: shown, never changed. */
    readOnly: boolean;
    /** The bridge does not answer now: the last state shown, nothing written. */
    down: boolean;
    /** Writes go through (managed, not read-only, the bridge answers). */
    canWrite: boolean;
    /** The bridge keeps the order of work (numbers and moves). */
    ordered: boolean;
    /** Moves go through now. */
    canOrder: boolean;
    /**
     * The app on a phone without the research's bridge (touch, a phone's
     * size, the bridge not answering): read-only, a tap shows the direction
     * in the tree, one sentence says where directions are changed.
     */
    phoneOnly: boolean;
}

/** The app on a phone: a touch screen of a phone's size (upright or held sideways). */
function onPhone(): boolean {
    try { return !!window.matchMedia?.('(pointer: coarse)').matches && !!window.matchMedia(MQ_PHONE_BAR).matches; } catch { return false; }
}

/** "Ended" unfolded (a research that keeps the order). */
let endedOpen = false;
/** A move not in the research's status yet: the bridge it was made at, the ids in their new order, the row moved last. */
let pendingOrder: { base: string; order: string[]; moved: string } | null = null;
/** The writer of the order, one per bridge. */
let orderWriter: { base: string; writer: DirectionOrderWriter } | null = null;
/** The order is being written (the moved row's number shows a spinner). */
let orderSaving = false;
/** What a refused write says at its row (direction id → the box). */
interface RowProblem { text: string; tone: 'warn' | 'danger'; retry?: () => void }
const rowProblems = new Map<string, RowProblem>();
/** Rows with a write on its way (their state button waits). */
const rowsBusy = new Set<string>();
/** The bridge answered that its research is an archive (409 `directions.archive`): read-only from then on. */
let archiveSaid: string | null = null;
/** A row dragged now (its id): the overview is not redrawn under the drag. */
let dragging: string | null = null;
/** A redraw asked during a drag, done when it ends. */
let redrawAfterDrag = false;
/** The end confirmation's cleanup (null: none open). */
let endPopoverCleanup: (() => void) | null = null;

/** Directions just created from the form: lit for 2 s (§2.7). */
const freshDirections = new Set<string>();

/** Light a direction just created for 2 s (its row, when the overview shows it). */
export function markFreshDirection(id: string): void {
    freshDirections.add(id);
    setTimeout(() => {
        freshDirections.delete(id);
        document.querySelector(`#research-overview .research-direction[data-direction="${CSS.escape(id)}"]`)?.classList.remove('is-new');
    }, 2000);
}

/** A row is dragged: the overview waits with its redraw (research-overview-ui). */
export function directionDragActive(): boolean {
    return dragging !== null;
}

/** A redraw the drag held back is due. */
export function directionRedrawHeld(): void {
    redrawAfterDrag = true;
}

/** Days ago in words ("yesterday", "3 days ago"); a date past a week. */
function relativeDay(iso: string): string {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '';
    const days = calendarDaysAgo(ts, Date.now());
    if (days < 0 || days > 6) return shortDate(iso);
    try {
        return new Intl.RelativeTimeFormat(getCurrentLanguage(), { numeric: 'auto' }).format(-days, 'day');
    } catch {
        return shortDate(iso);
    }
}

/** The direction's limits in words ("up to 8 generations", "before 1750"). */
function limitTexts(d: LiveDirection): string[] {
    const L = strings.live;
    const out: string[] = [];
    if (d.limits?.generations !== undefined) out.push(L.dirLimitGen(d.limits.generations));
    if (d.limits?.before !== undefined) out.push(L.dirLimitBefore(d.limits.before));
    return out;
}

/** What a refused write of a direction said at its row ('' none), for an action elsewhere to say it too. */
export function directionProblemText(id: string): string {
    return rowProblems.get(id)?.text ?? '';
}

/** What a refused direction write says at its row or in its form. */
export function directionRefusedText(r: DirectionWriteRefused): string {
    const L = strings.live;
    switch (r.code) {
        case 'busy': return L.dirBusy;
        case 'archive': return L.dirArchive;
        case 'network': return L.dirBridgeDown;
        case 'held': return r.held?.said || (r.reason ? L.dirNotSavedSaid(r.reason) : L.dirNotSaved);
        default: return r.reason ? L.dirNotSavedSaid(r.reason) : L.dirNotSaved;
    }
}

/** The state a write leads to. */
function stateAfter(what: DirectionStateDo): LiveDirection['state'] {
    return what === 'pause' ? 'paused' : what === 'done' ? 'done' : 'active';
}

/** The write that puts a direction back in `state`. */
function stateBack(state: LiveDirection['state']): DirectionStateDo {
    return state === 'paused' ? 'pause' : state === 'done' ? 'done' : 'resume';
}

/** A control that cannot act while the bridge does not answer (it says why). */
export function holdForBridge(btn: HTMLElement): void {
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('is-held');
    btn.title = strings.live.dirBridgeDown;
    btn.onclick = (e) => e.preventDefault();
}

/** Where each managed row is now (for the move animation). */
function directionRowTops(): Map<string, number> {
    const out = new Map<string, number>();
    document.querySelectorAll<HTMLElement>('#research-overview .research-direction[data-direction]').forEach(r => {
        out.set(r.dataset.direction!, r.getBoundingClientRect().top);
    });
    return out;
}

/** Rows that changed place slide there (180 ms; none with reduced motion). */
function playDirectionMoves(before: ReadonlyMap<string, number>): void {
    if (before.size === 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll<HTMLElement>('#research-overview .research-direction[data-direction]').forEach(r => {
        const was = before.get(r.dataset.direction!);
        if (was === undefined || typeof r.animate !== 'function') return;
        const dy = was - r.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
    });
}

/** A polite announcement for a screen reader (the order after a move). */
function announceDirections(text: string): void {
    let region = document.getElementById('research-directions-live');
    if (!region) {
        region = el('div', 'research-directions__sr');
        region.id = 'research-directions-live';
        region.setAttribute('aria-live', 'polite');
        region.setAttribute('role', 'status');
        document.body.appendChild(region);
    }
    region.textContent = '';
    const target = region;
    requestAnimationFrame(() => { target.textContent = text; });
}

/** The ids in the section's order now (a move not yet written included). */
function shownOrder(s: LiveSession): string[] {
    const { active } = orderDirections(s.researches, true);
    const rows = pendingOrder && pendingOrder.base === s.bridge.base ? withPendingOrder(active, pendingOrder.order) : active;
    return rows.map(d => d.id);
}

/** The research version that manages the directions from the app (the older research's footer names it). */
const DIRECTIONS_WRITE_SINCE = '1.26.0';

/** The box under a row's state line: a busy research (amber) or a refusal (red), Try again when it can help. */
function directionProblemBox(p: RowProblem): HTMLElement {
    const box = el('div', `research-direction__problem is-${p.tone}`);
    box.setAttribute('role', 'alert');
    box.appendChild(el('span', undefined, p.text));
    if (p.retry) {
        const retry = el('button', 'link-button research-direction__retry', strings.live.dirRetry);
        retry.type = 'button';
        retry.dataset.do = 'retry';
        const run = p.retry;
        retry.onclick = () => run();
        box.appendChild(retry);
    }
    return box;
}

/** A selector finding the same control of a row after a redraw. */
function focusSelector(a: HTMLElement): string {
    if (a.dataset.do) return `[data-do="${CSS.escape(a.dataset.do)}"]`;
    if (a.dataset.move) return `[data-move="${CSS.escape(a.dataset.move)}"]`;
    const cls = ['research-direction__handle', 'research-direction__more', 'research-direction__head'].find(c => a.classList.contains(c));
    return cls ? `.${cls}` : '.research-direction__head';
}

/** Focus a direction's control after a redraw (its head when the control is gone; `fallback` when the row is). */
function focusDirectionControl(id: string, sel: string, fallback?: HTMLElement): void {
    const row = document.querySelector<HTMLElement>(`#research-overview .research-direction[data-direction="${CSS.escape(id)}"]`);
    const target = row?.querySelector<HTMLElement>(sel) ?? row?.querySelector<HTMLElement>('.research-direction__head')
        ?? (fallback?.isConnected ? fallback : null);
    target?.focus();
}

/** Where a row dragged to `y` lands: before the row whose middle is below it (the count of rows: last). */
function dropIndexAt(list: HTMLElement, y: number): number {
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > .research-direction--managed')];
    const i = rows.findIndex(r => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
}

/** The line where a dragged row lands (2 px, a dot on the left). */
function showDropLine(list: HTMLElement, index: number): void {
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > .research-direction--managed')];
    let line = list.querySelector<HTMLElement>(':scope > .research-directions__drop');
    if (!line) {
        line = el('div', 'research-directions__drop');
        line.setAttribute('aria-hidden', 'true');
        list.appendChild(line);
    }
    const at = rows[index];
    const last = rows[rows.length - 1];
    const top = at ? at.offsetTop : last ? last.offsetTop + last.offsetHeight : 0;
    line.style.top = `${top - 1}px`;
}

function hideDropLine(list: HTMLElement): void {
    list.querySelector(':scope > .research-directions__drop')?.remove();
}

/** One item of a direction's ⋯ menu (null in a list: a separator). */
interface DirectionMenuItem {
    do: string;
    label: string;
    hint?: string;
    /** The research link's mark (an action through the bridge has none). */
    mark?: ReturnType<typeof researchLinkMark>;
    run: () => void;
}

/** The people of a direction, as the app knows them (null: it has no person). */
export function directionPersonIds(d: LiveDirection): PersonId[] | null {
    const focus = personByRefn(d.focus);
    if (!focus) return null;
    const data = DataManager.getData();
    const out = new Set<PersonId>([focus.id]);
    const walk = (id: PersonId, next: (p: Person) => PersonId[]): void => {
        for (const n of next(data.persons[id] ?? ({} as Person))) {
            if (out.has(n) || !data.persons[n]) continue;
            out.add(n);
            walk(n, next);
        }
    };
    if (d.direction === 'ancestors') walk(focus.id, p => p.parentIds ?? []);
    else if (d.direction === 'descendants') walk(focus.id, p => p.childIds ?? []);
    else if (d.direction === 'person') {
        for (const id of focus.parentIds ?? []) out.add(id);
        for (const id of focus.childIds ?? []) out.add(id);
        for (const pid of focus.partnerships ?? []) {
            const u = data.partnerships[pid];
            if (u) out.add(u.person1Id === focus.id ? u.person2Id : u.person1Id);
        }
    }
    return [...out].filter(id => data.persons[id]);
}

/** Generation labels: parents, grandparents, then "3. gen.". */
function generationLabel(g: number): string {
    const L = strings.live;
    return g === 1 ? L.dirGenParents : g === 2 ? L.dirGenGrandparents : L.dirGen(g);
}

export const researchDirectionsMethods = uiModule({
    /**
     * "At work" by direction (two or more lines, or a selection standing):
     * a row per line (glyph, name, task, person · since · how long; the
     * agents in its tooltip), work outside the directions as one row; a
     * click selects a line (again: drops it). A selected line that stopped
     * stays last, saying since when it does not work.
     */
    appendWorkingLines(host: HTMLElement, s: LiveSession, groups: readonly WorkingLine[]): void {
        const o = strings.otherResearch;
        const sel = queueDirectionFilter(s);
        const list = el('ul', 'live-panel-list live-lines');
        host.appendChild(list);
        const now = Date.now();
        for (const g of groups) {
            if (g.id && g.workers.some(w => !w.paused)) lastAtWork.set(g.id, now);
        }
        for (const g of groups) list.appendChild(this.workingLineRow(g, sel === g.id));
        const stopped = sel !== 'all' && !groups.some(g => g.id === sel) ? s.researches.find(d => d.id === sel) : undefined;
        if (stopped) {
            const last = lastAtWork.get(stopped.id);
            const t = last ? formatLiveClock(last, now, getCurrentLanguage()) : '';
            list.appendChild(this.workingLineRow({ id: stopped.id, direction: stopped, workers: [] }, true, o.lineIdle(t)));
        }
    },

    /** One line's row: a toggle (aria-pressed) for a direction, plain text for the work outside them. */
    workingLineRow(g: WorkingLine, selected: boolean, idle?: string): HTMLElement {
        const o = strings.otherResearch;
        const li = el('li', 'live-line-item');
        const name = g.direction?.name ?? strings.live.dirOutside;
        const row = g.id ? el('button', 'live-line') : el('div', 'live-line live-line--outside');
        if (g.id) {
            const id = g.id;
            const btn = row as HTMLButtonElement;
            btn.type = 'button';
            btn.dataset.direction = id;
            btn.setAttribute('aria-pressed', String(selected));
            btn.onclick = () => this.selectWorkingLine(id);
            const sr = el('span', 'live-line__sr', o.lineSelectSr(name));
            btn.appendChild(sr);
        }
        if (idle) row.classList.add('is-idle');
        const who = [...new Set(g.workers.map(w => w.who).filter(Boolean))].join(', ');
        if (who) row.title = who;
        const glyph = el('span', 'live-line__glyph', g.id ? directionGlyph(g.direction) : '·');
        glyph.setAttribute('aria-hidden', 'true');
        row.appendChild(glyph);
        const main = el('span', 'live-line__main');
        main.appendChild(el('span', 'live-line__name', name));
        for (const w of g.workers) {
            if (w.task) main.appendChild(el('span', 'live-line__task', w.task));
            const meta = el('span', 'live-line__meta');
            const person = personByRefn(w.person);
            const parts: (string | HTMLElement)[] = [];
            if (person) parts.push(fullName(person));
            else if (w.person) parts.push(w.person);
            if (w.paused) parts.push(el('span', 'live-paused', pausedText(w)));
            else {
                const since = timeEl(w.since, 'sincefor');
                if (since) parts.push(since);
            }
            parts.forEach((part, i) => meta.append(...(i > 0 ? [' · ', part] : [part])));
            if (parts.length > 0) main.appendChild(meta);
        }
        if (idle) main.appendChild(el('span', 'live-line__meta', idle));
        row.appendChild(main);
        li.appendChild(row);
        return li;
    },

    /** A click on a line: selected (lit up in the tree, Changes and Up next narrowed), again: all lines. */
    selectWorkingLine(id: string): void {
        this.setWorkingLine(queueDirectionFilter(liveSession()) === id ? 'all' : id);
    },

    /**
     * Select a direction ('all': none) for the panel and the overview's
     * queue alike; its people lit up in the tree with the overview's
     * "Show in tree" (the rest dimmed). Dropping it ends that light.
     */
    setWorkingLine(id: string): void {
        if (!listening) {
            listening = true;
            window.addEventListener('strom:tree-switched', () => this.syncLineSelection());
        }
        setQueueDirectionFilter(id);
        const s = liveSession();
        const d = id === 'all' ? undefined : s?.researches.find(x => x.id === id);
        const ids = d ? directionPersonIds(d) ?? [] : [];
        if (d && ids.length > 0) {
            // Dropped meanwhile (a tree switch): the same people until the light ends with the selection.
            let lit = ids;
            this.startPersonHighlight('direction', d.name, ids, () => {
                if (queueDirectionFilter(liveSession()) === d.id) lit = directionPersonIds(d) ?? [];
                return lit;
            });
            selectionLit = true;
        } else {
            this.endLineHighlight();
        }
        this.renderLivePanel();
    },

    /** A selection that no longer stands (another tree, following ended) is dropped with its light. */
    syncLineSelection(): void {
        if (queueDirectionFilter(liveSession()) === 'all' && selectionLit) this.endLineHighlight();
    },

    /** End the tree's light the selection started (another highlight since is left alone). */
    endLineHighlight(): void {
        if (selectionLit && this.evidenceHighlightKind() === 'direction') this.endEvidenceHighlight();
        selectionLit = false;
    },

    /** The Directions section of the overview (two or more directions). */
    appendOverviewDirections(body: HTMLElement, s: LiveSession, fold: { id: string; collapsed: boolean; onToggle: () => void }, mode: Mode): void {
        const view = this.directionsView(s);
        if (view.managed) {
            this.appendManagedDirections(body, s, fold, mode, view);
            return;
        }
        const outside = outsideWork(s);
        // One direction is the whole research, unless work runs outside it.
        if (s.researches.length < 2 && (s.researches.length === 0 || outside.length === 0)) return;
        const L = strings.live;
        const { active, inactive } = orderDirections(s.researches);
        const host = liveSection(body, { ...fold, title: L.dirTitle(active.length) });
        host.classList.add('research-directions');
        const list = el('div', 'research-directions__list');
        host.appendChild(list);
        // Work outside the directions is worked on: first, unless a direction is too.
        const outsideRow = outside.length > 0 ? this.outsideDirectionRow(outside, mode) : null;
        if (outsideRow && !active.some(d => d.working)) list.appendChild(outsideRow);
        for (const d of active) list.appendChild(this.directionRow(s, d, mode));
        if (outsideRow && !outsideRow.isConnected) list.appendChild(outsideRow);
        if (inactive.length > 0) {
            const toggle = el('button', 'research-directions__inactive');
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', String(inactiveOpen));
            const chevron = el('span', 'live-section__chevron', inactiveOpen ? '▾' : '▸');
            chevron.setAttribute('aria-hidden', 'true');
            toggle.append(chevron, el('span', undefined, L.dirInactive(inactive.length)));
            toggle.onclick = () => {
                inactiveOpen = !inactiveOpen;
                this.renderResearchOverview();
            };
            list.appendChild(toggle);
            if (inactiveOpen) for (const d of inactive) list.appendChild(this.directionRow(s, d, mode));
        }
        // An older research: the directions are changed in its terminal; a newer one changes them here.
        if (!this.activeResearchNoAgent()) host.appendChild(el('p', 'research-directions__foot', L.dirOldResearch(DIRECTIONS_WRITE_SINCE)));
    },

    /** What the Directions section may do with the followed research now. */
    directionsView(s: LiveSession): DirectionsView {
        const managed = !!s.caps?.directionsWrite;
        const readOnly = managed && (this.activeResearchNoAgent() || archiveSaid === s.bridge.base);
        const down = s.lostSince !== null;
        const ordered = managed && !!s.caps?.directionsOrder && !readOnly;
        const phoneOnly = managed && !readOnly && down && onPhone();
        return { managed, readOnly, down, canWrite: managed && !readOnly && !down, ordered, canOrder: ordered && !down, phoneOnly };
    },

    /**
     * The Directions section of a research that manages them through its
     * bridge: always while the research is active (an empty state with + New
     * direction), the bridge's order of work numbered (paused ones in it),
     * moves by drag, arrows or Alt+↑↓, the state changed right here, ended
     * ones folded below. An archive shows them read-only.
     */
    appendManagedDirections(body: HTMLElement, s: LiveSession, fold: { id: string; collapsed: boolean; onToggle: () => void },
        mode: Mode, view: DirectionsView): void {
        const L = strings.live;
        const outside = outsideWork(s);
        const viewOnly = view.readOnly || view.phoneOnly;
        if (viewOnly && s.researches.length < 2 && (s.researches.length === 0 || outside.length === 0)) return;
        if (pendingOrder && pendingOrder.base !== s.bridge.base) pendingOrder = null;
        const { active: listed, inactive: ended } = orderDirections(s.researches, true);
        const rows = pendingOrder ? withPendingOrder(listed, pendingOrder.order) : listed;
        let aside: HTMLElement | undefined;
        if (!viewOnly) {
            const add = el('button', 'link-button research-directions__new', L.dirNew);
            add.type = 'button';
            add.dataset.do = 'new';
            if (view.down) holdForBridge(add);
            else add.onclick = () => this.openDirectionForm({ mode: 'new', returnFocus: add });
            aside = add;
        }
        const host = liveSection(body, { ...fold, title: L.dirTitle(rows.filter(d => d.state === 'active').length), aside });
        host.classList.add('research-directions', 'research-directions--managed');
        if (view.readOnly) host.appendChild(el('p', 'research-directions__note', L.dirArchive));
        else if (view.phoneOnly) host.appendChild(el('p', 'research-directions__note', L.dirPhoneOnly));
        else if (view.down) host.appendChild(el('p', 'research-directions__note is-warn', L.dirBridgeDown));
        const orderMode = s.caps?.orderMode;
        if (orderMode && rows.length >= 2 && view.ordered) {
            host.appendChild(el('p', 'research-directions__note', orderMode === 'strict' ? L.dirOrderStrict : L.dirOrderWeight));
        }
        if (rows.length === 0 && !viewOnly) {
            const empty = el('div', 'research-directions__empty');
            empty.appendChild(el('p', 'research-directions__empty-text', L.dirEmptyNew));
            const add = el('button', 'secondary research-directions__empty-new', L.dirNew);
            add.type = 'button';
            add.dataset.do = 'new';
            if (view.down) holdForBridge(add);
            else add.onclick = () => this.openDirectionForm({ mode: 'new', returnFocus: add });
            empty.appendChild(add);
            host.appendChild(empty);
        }
        const list = el('div', 'research-directions__list');
        host.appendChild(list);
        rows.forEach((d, i) => list.appendChild(this.managedDirectionRow(s, d, mode, i + 1, rows.length, view)));
        if (view.canOrder) this.wireDirectionDrop(list);
        // Work outside the directions has no number and no place in the order: below them (none without directions);
        // a research that groups it by branches shows them there, above the ended ones.
        const branches = rows.length > 0 && this.appendOffLineSection(list, s, mode, view.canWrite, outside);
        if (!branches && outside.length > 0 && rows.length > 0) list.appendChild(this.outsideDirectionRow(outside, mode));
        if (ended.length > 0) {
            const toggle = el('button', 'research-directions__inactive');
            toggle.type = 'button';
            toggle.dataset.ended = 'true';
            toggle.setAttribute('aria-expanded', String(endedOpen));
            const chevron = el('span', 'live-section__chevron', endedOpen ? '▾' : '▸');
            chevron.setAttribute('aria-hidden', 'true');
            toggle.append(chevron, el('span', undefined, L.dirEnded(ended.length)));
            toggle.onclick = () => {
                endedOpen = !endedOpen;
                this.renderResearchOverview();
            };
            list.appendChild(toggle);
            if (endedOpen) for (const d of ended) list.appendChild(this.endedDirectionRow(d, mode, view));
        }
    },

    /**
     * A direction of the order: handle, number, kind, the name (the arc
     * while worked on, a chip while paused), one line of its state, ▲▼ on
     * touch, ⋯; its detail when open.
     */
    managedDirectionRow(s: LiveSession, d: LiveDirection, mode: Mode, n: number, total: number, view: DirectionsView): HTMLElement {
        const L = strings.live;
        // The sheet (a narrow window, a phone): ▲▼ instead of the handle, a tap unfolds the row with its
        // actions, no ⋯ (More… in the unfolded row); the app on a phone without the bridge only shows.
        const sheet = mode === 'sheet';
        const open = !view.phoneOnly && expanded === d.id;
        const paused = d.state === 'paused';
        const row = el('div', `research-direction research-direction--managed${paused ? ' is-paused' : ''}${open ? ' is-open' : ''}${freshDirections.has(d.id) ? ' is-new' : ''}`);
        row.dataset.direction = d.id;
        row.dataset.order = String(n);

        if (sheet) {
            // No handle column: the arrows move it.
        } else if (view.canOrder) {
            const handle = el('button', 'research-direction__handle');
            handle.type = 'button';
            handle.dataset.direction = d.id;
            handle.setAttribute('aria-roledescription', L.dirHandle);
            handle.setAttribute('aria-label', L.dirOrderSr(d.name, n, total));
            const grip = el('span', undefined, '⋮⋮');
            grip.setAttribute('aria-hidden', 'true');
            handle.appendChild(grip);
            handle.onkeydown = (e) => this.directionHandleKey(e, d.id);
            this.wireDirectionTouchDrag(handle, row, d.id);
            row.appendChild(handle);
            if (window.matchMedia?.('(pointer: fine)').matches) this.wireDirectionDrag(row, d.id);
        } else {
            row.appendChild(el('span', 'research-direction__handle is-none'));
        }

        const num = el('span', 'research-direction__num', String(n));
        if (orderSaving && pendingOrder?.moved === d.id) {
            const spin = el('span', 'research-direction__spin');
            spin.setAttribute('aria-hidden', 'true');
            num.appendChild(spin);
            num.setAttribute('aria-busy', 'true');
        }
        row.appendChild(num);

        const icon = el('span', 'research-direction__icon', d.direction ? KIND_GLYPH[d.direction] : '');
        icon.setAttribute('aria-hidden', 'true');
        if (!d.direction) icon.classList.add('is-blank');
        row.appendChild(icon);

        const main = el('div', 'research-direction__main');
        const head = el('button', 'research-direction__head');
        head.type = 'button';
        head.appendChild(el('span', 'research-direction__name', d.name));
        if (d.working) {
            const arc = el('span', 'agent-mark agent-mark--spin');
            arc.setAttribute('aria-hidden', 'true');
            head.appendChild(arc);
        }
        if (paused) head.appendChild(el('span', 'research-direction__chip', L.dirPausedChip(d.since ? shortDate(d.since) : '')));
        if (view.phoneOnly) {
            head.onclick = () => this.showDirectionInTree(d, mode);
        } else {
            head.setAttribute('aria-expanded', String(open));
            head.onclick = () => {
                expanded = open ? null : d.id;
                this.renderResearchOverview();
            };
        }
        main.appendChild(head);
        const meta = this.managedDirectionMeta(s, d, mode);
        if (meta.childElementCount > 0) main.appendChild(meta);
        const problem = rowProblems.get(d.id);
        if (problem) main.appendChild(directionProblemBox(problem));
        if (open) main.appendChild(this.managedDirectionDetail(s, d, mode, view));
        row.appendChild(main);

        const side = el('div', 'research-direction__side');
        if (view.ordered && !view.phoneOnly) {
            const order = shownOrder(s);
            const at = order.indexOf(d.id);
            const moves = el('div', 'research-direction__moves');
            for (const [what, glyph, label] of [['up', '▲', L.dirMoveUp], ['down', '▼', L.dirMoveDown]] as const) {
                const b = el('button', 'research-direction__move', glyph);
                b.type = 'button';
                b.dataset.move = what;
                b.setAttribute('aria-label', `${label}: ${d.name}`);
                const edge = what === 'up' ? at <= 0 : at < 0 || at >= order.length - 1;
                if (edge) b.disabled = true;
                else if (view.down) holdForBridge(b);
                else b.onclick = () => this.moveDirection(d.id, what);
                moves.appendChild(b);
            }
            side.appendChild(moves);
        }
        if (!view.readOnly && !sheet) side.appendChild(this.directionMoreButton(s, d, view));
        row.appendChild(side);
        return row;
    },

    /** The ⋯ of a managed row (held while the bridge does not answer). */
    directionMoreButton(s: LiveSession, d: LiveDirection, view: DirectionsView): HTMLElement {
        const L = strings.live;
        const more = el('button', 'live-queue-more research-direction__more', '⋯');
        more.type = 'button';
        more.dataset.direction = d.id;
        more.setAttribute('aria-label', L.dirMenu);
        more.setAttribute('aria-haspopup', 'menu');
        if (view.down) holdForBridge(more);
        else {
            more.onclick = (e) => {
                e.stopPropagation();
                this.openManagedDirectionMenu(more, s, d);
            };
        }
        return more;
    },

    /**
     * One line of a direction's state: its person · what runs now (or its
     * tasks, what waits, when last) · its limits; a paused one says why, or
     * that its running task finishes.
     */
    managedDirectionMeta(s: LiveSession, d: LiveDirection, mode: Mode): HTMLElement {
        const L = strings.live;
        const meta = el('div', 'research-direction__meta');
        const run = s.working.find(w => w.research === d.id && !w.paused && w.task);
        if (d.state === 'paused') {
            if (run) meta.appendChild(el('span', 'research-direction__now', L.dirFinishing(run.task)));
            else if (d.reason) meta.appendChild(el('span', undefined, L.dirReason(d.reason)));
            else if (d.tasks) meta.appendChild(el('span', undefined, L.dirTasks(d.tasks)));
        } else {
            const focus = personByRefn(d.focus);
            if (focus) {
                const link = el('button', 'live-person-link');
                link.innerHTML = fitNameHtml(focus, fullName(focus));
                link.type = 'button';
                link.onclick = () => this.overviewShowPerson(focus.id, mode);
                meta.appendChild(link);
            }
            if (run) meta.appendChild(el('span', 'research-direction__now', L.dirNow(run.task)));
            else if (directionUnstarted(d) && !d.found) meta.appendChild(el('span', 'research-direction__empty', L.dirNoTasks));
            else if (isEmpty(d)) meta.appendChild(el('span', 'research-direction__empty', L.dirEmpty));
            else {
                if (d.tasks) meta.appendChild(el('span', undefined, L.dirTasks(d.tasks)));
                if (d.waiting) meta.appendChild(el('span', 'research-direction__waiting', L.dirWaiting(d.waiting)));
                const last = d.last ? relativeDay(d.last.at) : '';
                if (last) meta.appendChild(el('span', undefined, L.dirLastShort(last)));
            }
        }
        for (const t of limitTexts(d)) meta.appendChild(el('span', 'research-direction__limit', t));
        return meta;
    },

    /**
     * The open detail of a managed direction: generations, what it found,
     * its last session, then Pause / Restart (through the bridge), Work on it
     * (its agent in the terminal) and Show in tree.
     */
    managedDirectionDetail(s: LiveSession, d: LiveDirection, mode: Mode, view: DirectionsView): HTMLElement {
        const L = strings.live;
        const detail = this.directionDetail(d, mode, { actions: false });
        if (d.found) {
            const found = d.found;
            const line = el('div', 'research-direction__found');
            line.appendChild(el('span', undefined, L.dirFoundIn(found.days)));
            const people = found.people.map(personByRefn).filter((p): p is Person => !!p).map(p => p.id);
            const parts = el('span', 'research-direction__found-parts');
            for (const part of foundParts(found)) {
                if (part === 'persons' && people.length > 0) {
                    const link = el('button', 'live-person-link', L.dirFoundPersons(found.persons));
                    link.type = 'button';
                    link.dataset.do = 'found-people';
                    link.onclick = () => {
                        if (mode === 'sheet') this.closeResearchOverview();
                        selectionLit = false;
                        this.startPersonHighlight('direction-found', d.name, people, null);
                    };
                    parts.appendChild(link);
                } else {
                    const text = part === 'sessions' ? L.dirFoundSessions(found.sessions)
                        : part === 'persons' ? L.dirFoundPersons(found.persons) : L.dirFoundSources(found.sources);
                    parts.appendChild(el('span', undefined, text));
                }
            }
            line.appendChild(parts);
            // Under the generations, above the last session.
            const last = detail.querySelector('.research-direction__last');
            detail.insertBefore(line, last);
        }
        const run = d.state === 'paused' ? s.working.find(w => w.research === d.id && !w.paused && w.task) : undefined;
        if (run) detail.appendChild(el('div', 'research-direction__last', L.dirFinishingLong(d.since ? shortDate(d.since) : '', run.task)));
        // The branches added to it (work outside the directions that now helps it).
        this.appendDirectionBranches(detail, s, d, view.canWrite);

        const actions = el('div', 'research-direction__actions');
        if (!view.readOnly && d.state !== 'done') {
            const what: DirectionStateDo = d.state === 'paused' ? 'resume' : 'pause';
            const state = el('button', 'secondary research-direction__state', what === 'pause' ? L.dirPause : L.dirResume);
            state.type = 'button';
            state.dataset.do = what;
            if (view.down) holdForBridge(state);
            else if (rowsBusy.has(d.id)) {
                state.setAttribute('aria-disabled', 'true');
                state.setAttribute('aria-busy', 'true');
            } else state.onclick = () => void this.changeDirectionState(d, what);
            actions.appendChild(state);
        }
        const sheet = mode === 'sheet';
        // The sheet: Edit in the row (the rest of the ⋯ behind More…).
        if (sheet && !view.readOnly && d.state !== 'done') {
            const edit = el('button', 'secondary research-direction__edit', L.dirEdit);
            edit.type = 'button';
            edit.dataset.do = 'edit';
            if (view.down) holdForBridge(edit);
            else edit.onclick = () => this.openDirectionForm({ mode: 'edit', direction: d, returnFocus: edit });
            actions.appendChild(edit);
        }
        // Its agent at work: not for a paused one, never in an archive or while the research waits for its agent.
        const work = d.state === 'active' && !sheet && !this.activeResearchNoAgent()
            ? this.activeResearchLink('chat', { research: d.id }) : null;
        if (work) {
            const btn = setResearchActionLabel(el('button', 'link-button'), L.dirWork, researchLinkMark('chat'));
            btn.type = 'button';
            btn.dataset.do = 'work';
            btn.onclick = () => this.launchResearchLink(work, 'agent');
            actions.appendChild(btn);
        }
        if (directionPersonIds(d)) {
            const btn = el('button', 'link-button', L.dirShow);
            btn.type = 'button';
            btn.dataset.do = 'show';
            btn.onclick = () => this.showDirectionInTree(d, mode);
            actions.appendChild(btn);
        }
        if (sheet && !view.readOnly) {
            const more = el('button', 'link-button research-direction__sheet-more', L.dirMoreActions);
            more.type = 'button';
            more.dataset.do = 'more';
            more.setAttribute('aria-haspopup', 'menu');
            if (view.down) holdForBridge(more);
            else more.onclick = (e) => {
                e.stopPropagation();
                this.openSheetDirectionMenu(more, s, d);
            };
            actions.appendChild(more);
        }
        if (actions.childElementCount > 0) detail.appendChild(actions);
        return detail;
    },

    /** An ended direction (folded below the order): no number; Restart beside it. */
    endedDirectionRow(d: LiveDirection, mode: Mode, view: DirectionsView): HTMLElement {
        const L = strings.live;
        const open = mode !== 'sheet' && expanded === d.id;
        const viewOnly = view.readOnly || view.phoneOnly;
        const row = el('div', `research-direction research-direction--ended is-inactive${open ? ' is-open' : ''}`);
        row.dataset.direction = d.id;
        const icon = el('span', 'research-direction__icon', d.direction ? KIND_GLYPH[d.direction] : '');
        icon.setAttribute('aria-hidden', 'true');
        if (!d.direction) icon.classList.add('is-blank');
        row.appendChild(icon);
        const main = el('div', 'research-direction__main');
        const head = el('button', 'research-direction__head');
        head.type = 'button';
        head.append(el('span', 'research-direction__name', d.name), el('span', 'research-direction__chip', L.dirDone));
        if (mode === 'sheet') head.onclick = () => this.showDirectionInTree(d, mode);
        else {
            head.setAttribute('aria-expanded', String(open));
            head.onclick = () => {
                expanded = open ? null : d.id;
                this.renderResearchOverview();
            };
        }
        main.appendChild(head);
        const bits = [d.reason ? L.dirReason(d.reason) : '', d.since ? L.dirSince(shortDate(d.since)) : ''].filter(Boolean);
        if (bits.length > 0) {
            const meta = el('div', 'research-direction__meta');
            for (const b of bits) meta.appendChild(el('span', undefined, b));
            main.appendChild(meta);
        }
        const problem = rowProblems.get(d.id);
        if (problem) main.appendChild(directionProblemBox(problem));
        if (open) main.appendChild(this.directionDetail(d, mode));
        row.appendChild(main);
        if (!viewOnly) {
            const again = el('button', 'link-button research-direction__do', L.dirResume);
            again.type = 'button';
            again.dataset.do = 'resume';
            if (view.down) holdForBridge(again);
            else if (!rowsBusy.has(d.id)) again.onclick = () => void this.changeDirectionState(d, 'resume');
            row.appendChild(again);
        }
        return row;
    },

    /**
     * The ⋯ menu of a managed direction: Edit · Pause / Restart · End… ·
     * the moves it can make · Work on it (its agent in the terminal).
     */
    openManagedDirectionMenu(anchor: HTMLElement, s: LiveSession, d: LiveDirection): void {
        const L = strings.live;
        const items: (DirectionMenuItem | null)[] = [];
        items.push({ do: 'edit', label: L.dirEdit, run: () => this.openDirectionForm({ mode: 'edit', direction: d, returnFocus: anchor }) });
        if (d.state === 'active') items.push({ do: 'pause', label: L.dirPause, hint: L.dirPauseHint, run: () => void this.changeDirectionState(d, 'pause') });
        else items.push({ do: 'resume', label: L.dirResume, hint: L.dirResumeHint, run: () => void this.changeDirectionState(d, 'resume') });
        items.push({ do: 'done', label: L.dirEndMenu, hint: L.dirEndHint, run: () => this.openDirectionEnd(anchor, d) });
        if (this.directionsView(s).canOrder) {
            const order = shownOrder(s);
            const at = order.indexOf(d.id);
            const moves: DirectionMenuItem[] = [];
            if (at > 0) moves.push({ do: 'up', label: L.dirMoveUp, run: () => this.moveDirection(d.id, 'up') });
            if (at >= 0 && at < order.length - 1) moves.push({ do: 'down', label: L.dirMoveDown, run: () => this.moveDirection(d.id, 'down') });
            if (at > 0) moves.push({ do: 'top', label: L.dirMoveTop, run: () => this.moveDirection(d.id, 'top') });
            if (moves.length > 0) items.push(null, ...moves);
        }
        const work = d.state === 'active' && !this.activeResearchNoAgent() ? this.activeResearchLink('chat', { research: d.id }) : null;
        if (work) {
            items.push(null, { do: 'work', label: L.dirWork, mark: researchLinkMark('chat'), run: () => this.launchResearchLink(work, 'agent') });
        }
        this.showDirectionMenu(anchor, d, items);
    },

    /**
     * More… of an unfolded row in the sheet: what the row does not show
     * (End…, Move to the top, Work on it with its agent in the terminal);
     * Pause, Edit, Show in tree and ▲▼ are on the row.
     */
    openSheetDirectionMenu(anchor: HTMLElement, s: LiveSession, d: LiveDirection): void {
        const L = strings.live;
        const items: (DirectionMenuItem | null)[] = [];
        if (d.state !== 'done') items.push({ do: 'done', label: L.dirEndMenu, hint: L.dirEndHint, run: () => this.openDirectionEnd(anchor, d) });
        if (this.directionsView(s).canOrder && shownOrder(s).indexOf(d.id) > 0) {
            items.push({ do: 'top', label: L.dirMoveTop, run: () => this.moveDirection(d.id, 'top') });
        }
        const work = d.state === 'active' && !this.activeResearchNoAgent() ? this.activeResearchLink('chat', { research: d.id }) : null;
        if (work) {
            if (items.length > 0) items.push(null);
            items.push({ do: 'work', label: L.dirWork, mark: researchLinkMark('chat'), run: () => this.launchResearchLink(work, 'agent') });
        }
        this.showDirectionMenu(anchor, d, items);
    },

    /**
     * End a direction, asked first: a small dialog by its ⋯ with an optional
     * reason (Enter ends, Esc cancels, focus back on the ⋯).
     */
    openDirectionEnd(anchor: HTMLElement, d: LiveDirection): void {
        this.closeDirectionMenu();
        this.closeDirectionEnd();
        const L = strings.live;
        const box = el('div', 'research-direction-end');
        box.id = 'research-direction-end';
        box.dataset.direction = d.id;
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', L.dirEndAsk(d.name));
        box.appendChild(el('div', 'research-direction-end__title', L.dirEndAsk(d.name)));
        box.appendChild(el('p', 'research-direction-end__text', L.dirEndText));
        const label = el('label', 'research-direction-end__label', L.dirReasonLabel);
        const input = el('input', 'research-direction-end__reason');
        input.type = 'text';
        input.maxLength = 400;
        label.appendChild(input);
        box.appendChild(label);
        const buttons = el('div', 'research-direction-end__buttons');
        const cancel = el('button', 'secondary', L.dirCancel);
        cancel.type = 'button';
        const confirm = el('button', 'primary', L.dirEndConfirm);
        confirm.type = 'button';
        confirm.dataset.do = 'done';
        buttons.append(cancel, confirm);
        box.appendChild(buttons);
        document.body.appendChild(box);
        const rect = anchor.getBoundingClientRect();
        const narrow = window.innerWidth <= 640;
        if (narrow) box.classList.add('is-sheet');
        else {
            const left = Math.max(8, Math.min(rect.right - box.offsetWidth, window.innerWidth - box.offsetWidth - 8));
            const below = rect.bottom + 4;
            const top = below + box.offsetHeight > window.innerHeight - 8 ? Math.max(8, rect.top - box.offsetHeight - 4) : below;
            box.style.left = `${Math.round(left)}px`;
            box.style.top = `${Math.round(top)}px`;
        }
        const back = (): void => {
            this.closeDirectionEnd();
            focusDirectionControl(d.id, focusSelector(anchor), anchor);
        };
        const end = (): void => {
            const reason = input.value.trim();
            this.closeDirectionEnd();
            focusDirectionControl(d.id, focusSelector(anchor), anchor);
            void this.changeDirectionState(d, 'done', { reason });
        };
        cancel.onclick = back;
        confirm.onclick = end;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                end();
            }
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                back();
            }
        };
        const onDown = (e: Event): void => {
            if (!box.contains(e.target as Node)) this.closeDirectionEnd();
        };
        document.addEventListener('keydown', onKey, true);
        const arm = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
        endPopoverCleanup = () => {
            clearTimeout(arm);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
        };
        input.focus();
    },

    closeDirectionEnd(): void {
        endPopoverCleanup?.();
        endPopoverCleanup = null;
        document.getElementById('research-direction-end')?.remove();
    },

    /**
     * Pause, end or restart a direction through the bridge: the row at once
     * in its new state, a toast with Undo (the state before, through the
     * bridge again), a busy research tried once more after 3 s, a refusal
     * said at the row. The research's new version is the tree's own.
     */
    async changeDirectionState(d: LiveDirection, what: DirectionStateDo, opts: { reason?: string; undo?: boolean } = {}): Promise<boolean> {
        this.closeDirectionMenu();
        const s = liveSession();
        if (!s || s.ended || !this.directionsView(s).canWrite || rowsBusy.has(d.id)) return false;
        const L = strings.live;
        const before = s.researches.find(x => x.id === d.id) ?? d;
        rowsBusy.add(d.id);
        rowProblems.delete(d.id);
        this.redrawDirections();
        const head = await this.waitingHeadBeforeWrite(s);
        const r = await withBusyRetry(() => setDirectionState(s.bridge.base, d.id, what, opts.reason));
        rowsBusy.delete(d.id);
        if (liveSession() !== s || s.ended) return false;
        if (!r.ok) {
            if (r.code === 'archive') archiveSaid = s.bridge.base;
            rowProblems.set(d.id, {
                text: directionRefusedText(r), tone: r.code === 'busy' ? 'warn' : 'danger',
                ...(r.code === 'busy' || r.code === 'network' || r.code === 'failed'
                    ? { retry: () => void this.changeDirectionState(d, what, opts) } : {}),
            });
            this.redrawDirections();
            return false;
        }
        if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
        const next: LiveDirection = r.direction?.id === d.id ? r.direction : {
            ...before, state: stateAfter(what), since: new Date().toISOString(),
            ...(opts.reason ? { reason: opts.reason } : {}),
        };
        s.researches = s.researches.map(x => x.id === d.id ? next : x);
        if (what === 'done' && expanded === d.id) expanded = null;
        this.redrawDirections();
        if (!opts.undo && before.state !== next.state) {
            const message = what === 'pause' ? L.dirToastPaused : what === 'done' ? L.dirToastEnded : L.dirToastResumed;
            const backTo = stateBack(before.state);
            this.showToast(message, 6000, {
                kind: 'direction',
                action: { label: L.dirUndo, run: () => void this.changeDirectionState(next, backTo, { undo: true, ...(before.reason ? { reason: before.reason } : {}) }) },
            });
        }
        this.liveStatusSoon(s);
        return true;
    },

    /**
     * Move a direction in the order: at once in the section, written after
     * 400 ms without another move (a series of moves is one write). The
     * order said aloud for a screen reader; `focusHandle`: the moved row's
     * handle keeps the focus.
     */
    moveDirection(id: string, move: DirectionMove | { drop: number }, focusHandle = false): void {
        this.closeDirectionMenu();
        const s = liveSession();
        if (!s || s.ended || !this.directionsView(s).canOrder) return;
        const current = shownOrder(s);
        const next = typeof move === 'object' ? dropInOrder(current, id, move.drop) : moveInOrder(current, id, move);
        if (sameOrder(next, current)) return;
        pendingOrder = { base: s.bridge.base, order: next, moved: id };
        rowProblems.delete(id);
        this.directionOrderWriter(s).move(next);
        this.redrawDirections();
        const d = s.researches.find(x => x.id === id);
        if (d) announceDirections(strings.live.dirOrderSr(d.name, next.indexOf(id) + 1, next.length));
        if (focusHandle) {
            document.querySelector<HTMLElement>(`#research-overview .research-direction__handle[data-direction="${CSS.escape(id)}"]`)?.focus();
        }
    },

    /** The writer of the followed bridge's order (a new one for another bridge). */
    directionOrderWriter(s: LiveSession): DirectionOrderWriter {
        if (orderWriter?.base === s.bridge.base) return orderWriter.writer;
        orderWriter?.writer.cancel();
        const base = s.bridge.base;
        const writer = new DirectionOrderWriter(async (order) => {
            orderSaving = true;
            this.redrawDirections();
            const head = await this.waitingHeadBeforeWrite(s);
            const r = await withBusyRetry(() => writeDirectionOrder(base, order));
            orderSaving = false;
            if (liveSession() !== s || s.ended) return;
            const moved = pendingOrder?.moved;
            if (r.ok) {
                if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
                const said = r.order.length > 0 ? r.order : order;
                s.researches = s.researches.map(x => said.includes(x.id) ? { ...x, order: said.indexOf(x.id) + 1 } : x);
                if (!writer.waiting && pendingOrder && sameOrder(pendingOrder.order, order)) pendingOrder = null;
                this.liveStatusSoon(s);
            } else if (!writer.waiting) {
                // The order of the last status again; the box at the row moved last tries the same order again.
                pendingOrder = null;
                if (r.code === 'archive') archiveSaid = base;
                if (moved) {
                    rowProblems.set(moved, {
                        text: r.code === 'busy' ? strings.live.dirOrderBusy : directionRefusedText(r),
                        tone: r.code === 'busy' ? 'warn' : 'danger',
                        retry: () => {
                            pendingOrder = { base, order, moved };
                            rowProblems.delete(moved);
                            writer.move(order);
                            this.redrawDirections();
                        },
                    });
                }
            }
            this.redrawDirections();
        });
        orderWriter = { base, writer };
        return writer;
    },

    /** Alt+↑ / Alt+↓ / Alt+Home on a handle: the row moves, the focus stays on its handle. */
    directionHandleKey(e: KeyboardEvent, id: string): void {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        const move: DirectionMove | null = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'Home' ? 'top' : null;
        if (!move) return;
        e.preventDefault();
        this.moveDirection(id, move, true);
    },

    /** A row dragged by mouse (the source dimmed, a line where it lands; Esc cancels). */
    wireDirectionDrag(row: HTMLElement, id: string): void {
        row.draggable = true;
        row.ondragstart = (e) => {
            if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
            dragging = id;
            e.dataTransfer?.setData('text/plain', id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            row.classList.add('is-drag-source');
        };
        row.ondragend = () => {
            row.classList.remove('is-drag-source');
            this.endDirectionDrag();
        };
    },

    /** The list takes a dragged row: the drop line follows, a drop moves it. */
    wireDirectionDrop(list: HTMLElement): void {
        list.ondragover = (e) => {
            if (!dragging) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            showDropLine(list, dropIndexAt(list, e.clientY));
        };
        list.ondragleave = (e) => {
            if (!list.contains(e.relatedTarget as Node | null)) hideDropLine(list);
        };
        list.ondrop = (e) => {
            if (!dragging) return;
            e.preventDefault();
            const id = dragging;
            const at = dropIndexAt(list, e.clientY);
            this.endDirectionDrag(false);
            this.moveDirection(id, { drop: at });
        };
    },

    /**
     * Touch (a tablet): the handle held 300 ms picks the row up, it follows
     * the finger, lifting it drops the row there; a move before that scrolls.
     */
    wireDirectionTouchDrag(handle: HTMLElement, row: HTMLElement, id: string): void {
        handle.onpointerdown = (e) => {
            if (e.pointerType === 'mouse') return;
            const list = row.parentElement;
            if (!list) return;
            const x0 = e.clientX;
            const y0 = e.clientY;
            let held = false;
            const timer = setTimeout(() => {
                held = true;
                dragging = id;
                row.classList.add('is-drag-source');
                try { handle.setPointerCapture(e.pointerId); } catch { /* gone meanwhile */ }
            }, 300);
            const onMove = (m: PointerEvent): void => {
                if (!held) {
                    if (Math.hypot(m.clientX - x0, m.clientY - y0) > 8) stop();
                    return;
                }
                m.preventDefault();
                showDropLine(list, dropIndexAt(list, m.clientY));
            };
            const onUp = (u: PointerEvent): void => {
                const at = held ? dropIndexAt(list, u.clientY) : -1;
                stop();
                if (at >= 0) this.moveDirection(id, { drop: at }, true);
            };
            const stop = (): void => {
                clearTimeout(timer);
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', stop);
                row.classList.remove('is-drag-source');
                if (held) this.endDirectionDrag(false);
            };
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', stop);
        };
    },

    /** A drag ended: the drop line goes; a redraw held back is done (`redraw`: unless a move redraws anyway). */
    endDirectionDrag(redraw = true): void {
        dragging = null;
        document.querySelectorAll<HTMLElement>('#research-overview .research-directions__list').forEach(hideDropLine);
        if (redrawAfterDrag) {
            redrawAfterDrag = false;
            if (redraw) this.renderResearchOverview();
        }
    },

    /** Redraw the overview keeping the focused control of a direction and sliding the rows that moved. */
    redrawDirections(): void {
        if (dragging) {
            redrawAfterDrag = true;
            return;
        }
        const a = document.activeElement as HTMLElement | null;
        const row = a?.closest?.<HTMLElement>('#research-overview .research-direction[data-direction]');
        const keep = row && a ? { id: row.dataset.direction!, sel: focusSelector(a) } : null;
        const tops = directionRowTops();
        this.renderResearchOverview();
        playDirectionMoves(tops);
        if (keep && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) {
            focusDirectionControl(keep.id, keep.sel);
        }
    },

    /** One direction: kind, name (and the arc while worked on), person and counts, ⋯; its detail when open. */
    directionRow(s: LiveSession, d: LiveDirection, mode: Mode): HTMLElement {
        const L = strings.live;
        const phone = mode === 'sheet';
        const canDo = !phone && this.researchLinkAvailable('direction');
        const open = !phone && expanded === d.id;
        const row = el('div', `research-direction${d.state !== 'active' ? ' is-inactive' : ''}${open ? ' is-open' : ''}`);
        row.dataset.direction = d.id;

        const icon = el('span', 'research-direction__icon', d.direction ? KIND_GLYPH[d.direction] : '');
        icon.setAttribute('aria-hidden', 'true');
        if (!d.direction) icon.classList.add('is-blank');
        row.appendChild(icon);

        const main = el('div', 'research-direction__main');
        const head = el('button', 'research-direction__head');
        head.type = 'button';
        const name = el('span', 'research-direction__name', d.name);
        head.appendChild(name);
        if (d.working && d.state === 'active') {
            const arc = el('span', 'agent-mark agent-mark--spin');
            arc.setAttribute('aria-hidden', 'true');
            head.appendChild(arc);
        }
        if (d.state !== 'active') head.appendChild(el('span', 'research-direction__chip', d.state === 'paused' ? L.dirPaused : L.dirDone));
        if (phone) {
            // Phone: a tap shows the direction's people in the tree.
            head.onclick = () => this.showDirectionInTree(d, mode);
        } else {
            head.setAttribute('aria-expanded', String(open));
            head.onclick = () => {
                expanded = open ? null : d.id;
                this.renderResearchOverview();
            };
        }
        main.appendChild(head);

        const meta = el('div', 'research-direction__meta');
        if (d.state !== 'active') {
            const bits = [d.reason ? L.dirReason(d.reason) : '', d.since ? L.dirSince(shortDate(d.since)) : ''].filter(Boolean);
            if (bits.length > 0) meta.appendChild(el('span', undefined, bits.join(' · ')));
        } else {
            const focus = personByRefn(d.focus);
            if (focus) {
                const link = el('button', 'live-person-link');
                link.innerHTML = fitNameHtml(focus, fullName(focus));
                link.type = 'button';
                link.onclick = () => this.overviewShowPerson(focus.id, mode);
                meta.appendChild(link);
            }
            if (isEmpty(d)) {
                meta.appendChild(el('span', 'research-direction__empty', phone ? L.dirEmptyPhone : L.dirEmpty));
            } else {
                if (d.tasks) meta.appendChild(el('span', undefined, L.dirTasks(d.tasks)));
                if (d.waiting) meta.appendChild(el('span', 'research-direction__waiting', L.dirWaiting(d.waiting)));
            }
        }
        if (meta.childElementCount > 0) main.appendChild(meta);
        // Right on the row: End for an empty direction, Restart for a paused / ended one (in the research).
        if (canDo && (isEmpty(d) || d.state !== 'active')) {
            const what: ResearchDirectionDo = d.state === 'active' ? 'done' : 'resume';
            const btn = setResearchActionLabel(el('button', 'link-button research-direction__do'), what === 'done' ? L.dirEnd : L.dirResume, researchLinkMark('direction'));
            btn.type = 'button';
            btn.dataset.do = what;
            btn.onclick = () => this.runDirection(d.id, what);
            main.appendChild(btn);
        }
        if (open) main.appendChild(this.directionDetail(d, mode));
        row.appendChild(main);

        if (canDo) {
            const more = el('button', 'live-queue-more research-direction__more', '⋯');
            more.type = 'button';
            more.setAttribute('aria-label', L.dirMenu);
            more.setAttribute('aria-haspopup', 'menu');
            more.onclick = (e) => {
                e.stopPropagation();
                this.openDirectionMenu(more, d);
            };
            row.appendChild(more);
        }
        return row;
    },

    /** "Outside the directions": the arc, each task's title and its person (shown in the tree on a click). */
    outsideDirectionRow(work: readonly LiveWorker[], mode: Mode): HTMLElement {
        const L = strings.live;
        const row = el('div', 'research-direction research-direction--outside');
        row.dataset.outside = 'true';
        const icon = el('span', 'research-direction__icon is-blank');
        icon.setAttribute('aria-hidden', 'true');
        row.appendChild(icon);
        const main = el('div', 'research-direction__main');
        const head = el('div', 'research-direction__head');
        head.appendChild(el('span', 'research-direction__name', L.dirOutside));
        const arc = el('span', 'agent-mark agent-mark--spin');
        arc.setAttribute('aria-hidden', 'true');
        head.appendChild(arc);
        main.appendChild(head);
        for (const w of work) {
            const meta = el('div', 'research-direction__meta');
            meta.appendChild(el('span', 'research-direction__task', w.task || w.who));
            const person = personByRefn(w.person);
            if (person) {
                const link = el('button', 'live-person-link');
                link.innerHTML = fitNameHtml(person, fullName(person));
                link.type = 'button';
                link.title = L.showInTree;
                link.onclick = () => this.overviewShowPerson(person.id, mode);
                meta.appendChild(link);
            } else if (w.person) {
                // A person the app's tree does not have: the research's identifier, no link.
                const ref = el('span', 'live-person-unknown', w.person);
                ref.title = L.personNotInApp;
                meta.appendChild(ref);
            }
            main.appendChild(meta);
        }
        row.appendChild(main);
        return row;
    },

    /** The open detail: generations (ancestors), the last session, Work on it, Show in tree (`actions: false`: without them). */
    directionDetail(d: LiveDirection, mode: Mode, opts: { actions?: boolean } = {}): HTMLElement {
        const L = strings.live;
        const detail = el('div', 'research-direction__detail');
        if (d.direction === 'ancestors' && d.generations && d.generations.length > 0) {
            detail.appendChild(el('div', 'research-direction__label', L.dirGenTitle));
            const grid = el('div', 'research-direction__gens');
            d.generations.forEach((known, i) => {
                const g = i + 1;
                const max = 2 ** g;
                const cell = el('div', 'research-direction__gen');
                const bar = el('span', 'research-direction__gen-bar');
                const fill = el('span', 'research-direction__gen-fill');
                fill.style.width = `${Math.min(100, Math.round((known / max) * 100))}%`;
                bar.appendChild(fill);
                cell.append(bar, el('span', 'research-direction__gen-text', `${Math.min(known, max)}/${max} ${generationLabel(g)}`));
                grid.appendChild(cell);
            });
            detail.appendChild(grid);
        }
        if (d.last) detail.appendChild(el('div', 'research-direction__last', L.dirLast(shortDate(d.last.at), d.last.text)));
        if (opts.actions === false) return detail;
        const actions = el('div', 'research-direction__actions');
        // Nothing that leads to an agent in an archive or while the research waits for one.
        const work = this.activeResearchNoAgent() ? null : this.activeResearchLink('chat', { research: d.id });
        if (work) {
            const btn = setResearchActionLabel(el('button', 'link-button'), L.dirWork, researchLinkMark('chat'));
            btn.type = 'button';
            btn.dataset.do = 'work';
            btn.onclick = () => this.launchResearchLink(work, 'agent');
            actions.appendChild(btn);
        }
        if (directionPersonIds(d)) {
            const btn = el('button', 'link-button', L.dirShow);
            btn.type = 'button';
            btn.dataset.do = 'show';
            btn.onclick = () => this.showDirectionInTree(d, mode);
            actions.appendChild(btn);
        }
        if (actions.childElementCount > 0) detail.appendChild(actions);
        return detail;
    },

    /** The direction's people lit up in the tree, named by the direction. */
    showDirectionInTree(d: LiveDirection, mode: Mode): void {
        const ids = directionPersonIds(d);
        if (!ids) return;
        if (mode === 'sheet') this.closeResearchOverview();
        selectionLit = false;
        this.startPersonHighlight('direction', d.name, ids, () => directionPersonIds(d) ?? []);
    },

    /** Pause / end / restart a direction in the research (the terminal asks; the next status tells). */
    runDirection(id: string, what: ResearchDirectionDo): void {
        this.closeDirectionMenu();
        const url = this.activeResearchLink('direction', { research: id, directionDo: what });
        if (url) this.launchResearchLink(url);
    },

    /** The ⋯ menu of a direction (an older research): each action in its terminal, with one line of what it does. */
    openDirectionMenu(anchor: HTMLElement, d: LiveDirection): void {
        const L = strings.live;
        const items: [ResearchDirectionDo, string, string][] = d.state === 'active'
            ? [['pause', L.dirPause, L.dirPauseHint], ['done', L.dirEnd, L.dirEndHint]]
            : [['resume', L.dirResume, L.dirResumeHint]];
        this.showDirectionMenu(anchor, d, items.map(([what, label, hint]) => ({
            do: what, label, hint, mark: researchLinkMark('direction'), run: () => this.runDirection(d.id, what),
        })));
    },

    /** A direction's ⋯ menu of `items` (null: a separator); again on the same direction closes it. */
    showDirectionMenu(anchor: HTMLElement, d: LiveDirection, items: readonly (DirectionMenuItem | null)[]): void {
        const wasOpen = document.getElementById('live-direction-menu')?.dataset.direction === d.id;
        this.closeDirectionMenu();
        if (wasOpen) return;
        const L = strings.live;
        const menu = el('div', 'context-menu live-task-menu research-direction-menu');
        menu.id = 'live-direction-menu';
        menu.dataset.direction = d.id;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', L.dirMenu);
        for (const it of items) {
            if (!it) {
                const sep = el('div', 'context-menu-divider');
                sep.setAttribute('role', 'separator');
                menu.appendChild(sep);
                continue;
            }
            const item = el('div', 'context-menu-item research-direction-menu__item');
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.do = it.do;
            const label = el('span', 'research-direction-menu__label');
            if (it.mark) setResearchActionLabel(label, it.label, it.mark);
            else label.textContent = it.label;
            item.appendChild(label);
            if (it.hint) item.appendChild(el('span', 'research-direction-menu__hint', it.hint));
            const run = it.run;
            item.onclick = () => {
                this.closeDirectionMenu();
                run();
            };
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.closeDirectionMenu();
                    run();
                }
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
                this.closeDirectionMenu();
                anchor.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const all = [...menu.querySelectorAll<HTMLElement>('.context-menu-item')];
                const i = all.indexOf(document.activeElement as HTMLElement);
                all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
            }
        };
        const onDown = (e: Event): void => {
            if (!menu.contains(e.target as Node) && e.target !== anchor) this.closeDirectionMenu();
        };
        document.addEventListener('keydown', onKey, true);
        // Armed after the press that opened it, and disarmed with the menu
        // (closed at once, the stray listener closed every later menu).
        const arm = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
        directionMenuCleanup = () => {
            clearTimeout(arm);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            anchor.removeAttribute('aria-expanded');
        };
    },

    closeDirectionMenu(): void {
        directionMenuCleanup?.();
        directionMenuCleanup = null;
        document.getElementById('live-direction-menu')?.remove();
    },

    /** Open the overview on a direction: Directions unfolded, its detail open. */
    openResearchDirection(id: string): void {
        expanded = id;
        const s = liveSession();
        const state = s?.researches.find(d => d.id === id)?.state;
        if (state !== 'active') inactiveOpen = true;
        if (state === 'done') endedOpen = true;
        this.unfoldOverviewSection('directions');
        if (this.isResearchOverviewOpen()) this.renderResearchOverview();
        else this.openResearchOverview();
        requestAnimationFrame(() => {
            document.querySelector(`#research-overview .research-direction[data-direction="${CSS.escape(id)}"]`)
                ?.scrollIntoView({ block: 'nearest' });
        });
    },

    /**
     * The person's existing direction of the kind a person-menu research item
     * would start (followed live, this tree): running, or paused / ended.
     */
    personDirection(personId: PersonId, action: string): LiveDirection | null {
        const kind = MENU_KIND[action];
        const s = liveSession();
        const refn = DataManager.getPerson(personId)?.refn;
        if (!kind || !s || s.ended || s.treeId !== DataManager.getCurrentTreeId() || !refn) return null;
        const mine = s.researches.filter(d => d.direction === kind && d.focus === refn);
        return mine.find(d => d.state === 'active') ?? mine[0] ?? null;
    },
});

let directionMenuCleanup: (() => void) | null = null;
