/**
 * Work outside the research's directions (spec 038 K7, a research with
 * `caps.offLineBranches` and two or more directions): the section of
 * branches under the directions (each branch's person, how it is taken,
 * its tasks), the branch's choices through the bridge (how it is taken, add
 * it to a direction, create a direction from it, do not research it, back
 * to the tree's default), the branches added to a direction shown at it,
 * the reason of a task's place in the queue and its own place (Do next / To
 * the end), and the growing branch in Awaiting action. Every write goes
 * through the bridge with no mark; a refusal is said at the branch (task),
 * a write done gives a toast with Undo. Bridge text is set as text, never HTML.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { Person } from '../types.js';
import {
    LiveDirection, LiveQueueItem, LiveWaiting, LiveWorker, OffLineBranch, OffLineMode, QUEUE_OWN_FEATURE,
} from '../research-link.js';
import { uiModule } from './module.js';
import { LiveSession, el, liveSession } from './research-ui.js';
import { shownName, fitNameHtml } from '../person-name.js';
import { bookYears } from '../book-blocks.js';
import { withBusyRetry } from '../research-directions.js';
import {
    BranchModeWrite, BranchWaitingDo, DirectionWriteRefused, TaskOrderDo, answerBranchWaiting, setBranchMode, setTaskOrder,
} from '../research-directions-write.js';
import { activeDirections, directionRefusedText, setQueueDirectionFilter } from './research-directions-ui.js';

type Mode = 'docked' | 'overlay' | 'sheet';

/** "Outside the directions" unfolded (null: as the research suggests – open while a growing branch waits for an answer). */
let outOpen: boolean | null = null;
/** "Not researched" unfolded. */
let neverOpen = false;
/** The branch whose choices are open (one at a time). */
let branchOpen: string | null = null;
/** What a refused write says at its branch (branch id → the box). */
interface Problem { text: string; tone: 'warn' | 'danger'; retry?: () => void }
const branchProblems = new Map<string, Problem>();
/** Branches with a write on its way. */
const branchBusy = new Set<string>();
/** The queue shows one branch's tasks (the bridge it was chosen at). */
let queueBranch: { base: string; id: string } | null = null;
/** What a refused own place says at its task (task id → the text). */
const taskProblems = new Map<string, string>();
/** Tasks with a write of their place on its way. */
const taskBusy = new Set<string>();
/** Growing branches answered here: hidden until the next status (item id). */
const answered = new Set<string>();
/** The add-to-direction picker's cleanup (null: none open). */
let pickCleanup: (() => void) | null = null;
/** The branch ⋯ menu's cleanup. */
let branchMenuCleanup: (() => void) | null = null;

const OWN_MODES: readonly Exclude<OffLineMode, 'never'>[] = ['occasional', 'last', 'normal'];

function personByRefn(refn: string | undefined): Person | null {
    if (!refn) return null;
    return Object.values(DataManager.getData().persons).find(p => p.refn === refn) ?? null;
}

/** The person a branch is named after ("B-P0031" → "P0031"). */
export function branchPersonRef(id: string): string {
    return id.replace(/^B-/, '');
}

/** A branch's name: its person in the tree, else the research's identifier. */
export function branchName(id: string, person?: string): string {
    const p = personByRefn(person ?? branchPersonRef(id));
    return p ? shownName(p) : person ?? branchPersonRef(id);
}

/** A direction's name ('' when the research does not list it). */
function directionName(s: LiveSession, id: string | undefined): string {
    return id ? s.researches.find(d => d.id === id)?.name ?? '' : '';
}

/** The followed research shows its work outside the directions by branches. */
export function offLineShown(s: LiveSession | null): boolean {
    return !!s && !!s.caps?.offLineBranches && !!s.offLine && s.researches.length >= 2;
}

/** The branch the queue is narrowed to (null: none, or one no longer there). */
export function queueBranchFilter(s: LiveSession | null): string | null {
    if (!queueBranch || !s || queueBranch.base !== s.bridge.base || !offLineShown(s)) return null;
    return queueBranch.id;
}

export function setQueueBranchFilter(s: LiveSession | null, id: string | null): void {
    queueBranch = id && s ? { base: s.bridge.base, id } : null;
}

/** Why a task stands where it stands, in words ('' when the research does not say). */
export function queueWhyText(q: LiveQueueItem, s: LiveSession | null): string {
    const why = q.why;
    if (!why || !s) return '';
    const L = strings.live;
    switch (why.kind) {
        case 'own': return why.do === 'next' ? L.qWhyManualNext : L.qWhyManualLast;
        case 'line': return L.qWhyLine(directionName(s, why.research) || why.research);
        case 'paused': return L.qWhyPaused;
        case 'helps': {
            const how = why.by === 'branch' && q.branch ? L.qWhyHowBranch(branchName(q.branch)) : L.qWhyHow[why.by];
            return L.qWhyHelps(directionName(s, why.research) || why.research, how);
        }
        case 'off': {
            const branch = why.branch ?? q.branch;
            const mode = L.offMode[why.mode];
            return branch ? L.qWhyOut(mode, branchName(branch)) : L.qWhyOutNoBranch(mode);
        }
    }
}

/** A growing branch in Awaiting action, in the app's words ("Branch Alois Fíšek: 14 tasks outside … Near the direction …"). */
export function waitBranchText(w: LiveWaiting, s: LiveSession | null): string {
    const id = w.branch ?? '';
    return strings.live.waitBranchGrows(branchName(id, w.person), w.tasks ?? 0, w.persons ?? 0, s ? directionName(s, w.research) : '');
}

/** A task's own place is set here: a research that takes it, its bridge answering, not an archive. */
export function taskOrderOffered(s: LiveSession | null): boolean {
    return !!s && !s.ended && s.lostSince === null && !!s.features?.includes(QUEUE_OWN_FEATURE) && !!s.caps?.offLineBranches;
}

/** What a refused task place says (the agent at work on it: its own sentence). */
function taskRefusedText(r: DirectionWriteRefused): string {
    return r.errorCode === 'queue.doing' ? strings.live.taskDoing : directionRefusedText(r);
}

/** A branch's write that puts it back as it was. */
function branchBack(b: OffLineBranch): BranchModeWrite {
    if (b.mode === 'line' && b.line) return { line: b.line };
    return b.own ? b.mode as OffLineMode : 'default';
}

function problemBox(p: Problem): HTMLElement {
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

/** The growing branches waiting for an answer (not those just answered here). */
function growingWaiting(s: LiveSession): LiveWaiting[] {
    return s.waiting.filter(w => w.kind === 'branch' && !answered.has(w.id));
}

/**
 * A redraw replaced the branch's controls: focus goes back to its chosen
 * segment, else its expander, else the section's toggle (only when the
 * focus was lost with the old element).
 */
function refocusBranch(id: string): void {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    const row = document.querySelector<HTMLElement>(`#research-overview .research-offline__branch[data-branch="${CSS.escape(id)}"]`);
    const target = row?.querySelector<HTMLElement>('.research-offline__seg.is-on')
        ?? row?.querySelector<HTMLElement>('.research-offline__expand, .research-offline__reset')
        ?? document.querySelector<HTMLElement>('#research-overview .research-offline__toggle');
    target?.focus({ preventScroll: true });
}

/** Place a popup by its anchor (below, or above when no room). */
function placeBy(anchor: HTMLElement, box: HTMLElement, alignRight: boolean): void {
    const rect = anchor.getBoundingClientRect();
    const left = alignRight
        ? Math.max(8, Math.min(rect.right - box.offsetWidth, window.innerWidth - box.offsetWidth - 8))
        : Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8));
    const below = rect.bottom + 4;
    const top = below + box.offsetHeight > window.innerHeight - 8 ? Math.max(8, rect.top - box.offsetHeight - 4) : below;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
}

export const researchOffLineMethods = uiModule({
    /**
     * The section "Outside the directions" under the running and paused
     * directions, above the ended ones: its sum and the tree's choice (a
     * link to the research's settings of this tree), unfolded each branch
     * (person, years, how it is taken, growing), its relation and nearest
     * direction, a few of its tasks; branches not researched folded last.
     * A phone reads it only.
     */
    appendOffLineSection(list: HTMLElement, s: LiveSession, mode: Mode, canWrite: boolean, working: readonly LiveWorker[] = []): boolean {
        if (!offLineShown(s)) return false;
        const off = s.offLine!;
        const L = strings.live;
        const shown = off.branches.filter(b => b.mode !== 'line');
        const taken = shown.filter(b => b.mode !== 'never');
        const never = shown.filter(b => b.mode === 'never');
        if (shown.length === 0 && off.tasks === 0 && working.length === 0) return false;
        const growing = growingWaiting(s).length > 0;
        const open = outOpen ?? growing;
        const head = el('div', 'research-offline__head');
        const toggle = el('button', 'research-directions__inactive research-offline__toggle');
        toggle.type = 'button';
        toggle.dataset.offline = 'true';
        toggle.setAttribute('aria-expanded', String(open));
        const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
        chevron.setAttribute('aria-hidden', 'true');
        toggle.append(chevron, el('span', 'research-offline__title', L.dirOutside),
            el('span', 'research-offline__sum', `· ${L.dirOutSum(off.queued || off.tasks, taken.length)} ·`));
        if (working.length > 0) {
            // Worked on now: the arc, as at a direction.
            const arc = el('span', 'agent-mark agent-mark--spin');
            arc.setAttribute('aria-hidden', 'true');
            toggle.appendChild(arc);
        }
        toggle.onclick = () => {
            outOpen = !open;
            this.renderResearchOverview();
        };
        head.appendChild(toggle);
        const modeLink = el('button', 'link-button research-offline__mode', L.offMode[off.mode]);
        modeLink.type = 'button';
        modeLink.dataset.do = 'offline-settings';
        modeLink.title = L.offModeLink;
        modeLink.onclick = () => this.openOffLineSettings();
        head.appendChild(modeLink);
        list.appendChild(head);
        // What runs outside the directions now: each task and its person, folded or not.
        for (const w of working) {
            const meta = el('div', 'research-direction__meta research-offline__working');
            meta.appendChild(el('span', 'research-direction__task', w.task || w.who));
            const person = personByRefn(w.person);
            if (person) {
                const link = el('button', 'live-person-link');
                link.type = 'button';
                link.innerHTML = fitNameHtml(person, shownName(person));
                link.title = L.showInTree;
                link.onclick = () => this.overviewShowPerson(person.id, mode);
                meta.appendChild(link);
            } else if (w.person) {
                meta.appendChild(el('span', 'live-person-unknown', w.person));
            }
            list.appendChild(meta);
        }
        if (!open) return true;
        const box = el('div', 'research-offline__branches');
        for (const b of taken) box.appendChild(this.offLineBranchRow(s, b, mode, canWrite));
        if (never.length > 0) {
            const t = el('button', 'research-directions__inactive research-offline__never');
            t.type = 'button';
            t.dataset.never = 'true';
            t.setAttribute('aria-expanded', String(neverOpen));
            const c = el('span', 'live-section__chevron', neverOpen ? '▾' : '▸');
            c.setAttribute('aria-hidden', 'true');
            t.append(c, el('span', undefined, L.branchNeverGroup(never.length)));
            t.onclick = () => {
                neverOpen = !neverOpen;
                this.renderResearchOverview();
            };
            box.appendChild(t);
            if (neverOpen) for (const b of never) box.appendChild(this.offLineBranchRow(s, b, mode, canWrite));
        }
        list.appendChild(box);
        return true;
    },

    /** One branch: its head (person, years, how taken, growing), meta, samples; open: the choices; ⋯ on a computer. */
    offLineBranchRow(s: LiveSession, b: OffLineBranch, mode: Mode, canWrite: boolean): HTMLElement {
        const L = strings.live;
        const off = s.offLine!;
        // Read only: a phone without the bridge, an archive, a bridge not answering (a narrow window with it acts).
        const phone = !canWrite;
        const never = b.mode === 'never';
        const open = !phone && !never && branchOpen === b.id;
        const row = el('div', `research-offline__branch${never ? ' is-never' : ''}${open ? ' is-open' : ''}`);
        row.dataset.branch = b.id;
        const main = el('div', 'research-offline__main');
        const head = el('div', 'research-offline__line');
        const person = personByRefn(b.person);
        if (person) {
            const link = el('button', 'live-person-link research-offline__person');
            link.type = 'button';
            link.innerHTML = fitNameHtml(person, shownName(person));
            link.title = L.showInTree;
            link.onclick = () => this.overviewShowPerson(person.id, mode);
            head.appendChild(link);
            const years = bookYears(person);
            if (years) head.appendChild(el('span', 'research-offline__years', years));
        } else {
            head.appendChild(el('span', 'research-offline__person is-unknown', b.person));
        }
        const tag = el('span', `research-offline__tag${b.own ? ' is-own' : ''}`);
        const word = never ? L.offNotResearched : L.offMode[b.mode as OffLineMode] ?? '';
        if (b.own) {
            const dot = el('span', 'research-offline__dot');
            dot.setAttribute('aria-hidden', 'true');
            tag.appendChild(dot);
            tag.setAttribute('aria-label', `${word}, ${L.branchOwnChoice}`);
        }
        tag.appendChild(el('span', undefined, word));
        head.appendChild(tag);
        if (b.grows && !never) head.appendChild(el('span', 'research-offline__grows', L.branchGrows(b.persons)));
        if (!phone && !never) {
            const expand = el('button', 'research-offline__expand');
            expand.type = 'button';
            expand.setAttribute('aria-expanded', String(open));
            expand.setAttribute('aria-label', `${branchName(b.id, b.person)}: ${L.branchTakenAria}`);
            const ch = el('span', 'live-section__chevron', open ? '▾' : '▸');
            ch.setAttribute('aria-hidden', 'true');
            expand.appendChild(ch);
            expand.onclick = () => {
                branchOpen = open ? null : b.id;
                this.closeBranchPopups();
                this.renderResearchOverview();
            };
            head.prepend(expand);
        }
        main.appendChild(head);
        const meta = el('div', 'research-direction__meta research-offline__meta');
        if (b.via) {
            const via = personByRefn(b.via.person);
            meta.appendChild(el('span', undefined, L.branchVia(L.branchRel[b.via.rel] ?? L.branchRel.other, via ? shownName(via) : b.via.person)));
        }
        const near = s.researches.find(d => d.id === b.nearest);
        if (near) meta.appendChild(el('span', undefined, `${L.dirNear(near.name)}${near.state === 'paused' ? ` ${L.dirNearPaused}` : ''}`));
        meta.appendChild(el('span', undefined, L.dirTasks(b.tasks)));
        main.appendChild(meta);
        if (b.samples.length > 0) {
            const samples = el('div', 'research-offline__samples', b.samples.map(x => x.text).join(' · '));
            samples.title = b.samples.map(x => x.text).join('\n');
            main.appendChild(samples);
        }
        const problem = branchProblems.get(b.id);
        if (problem) main.appendChild(problemBox(problem));
        if (open) main.appendChild(this.offLineBranchChoices(s, b, off.mode, canWrite));
        if (never && !phone && canWrite) {
            const reset = el('button', 'link-button research-offline__reset', L.branchReset);
            reset.type = 'button';
            reset.dataset.do = 'default';
            if (!branchBusy.has(b.id)) reset.onclick = () => void this.changeBranchMode(b, 'default');
            main.appendChild(reset);
        }
        row.appendChild(main);
        if (!phone && !never && canWrite) {
            const more = el('button', 'live-queue-more research-offline__more', '⋯');
            more.type = 'button';
            more.dataset.branch = b.id;
            more.setAttribute('aria-label', `${L.branchMenu}: ${branchName(b.id, b.person)}`);
            more.setAttribute('aria-haspopup', 'menu');
            more.onclick = (e) => {
                e.stopPropagation();
                this.openBranchMenu(more, b);
            };
            row.appendChild(more);
        }
        return row;
    },

    /** An open branch: "Taken:" Now and then · At the end · As usual, Add to the direction {nearest}, Branch tasks ›. */
    offLineBranchChoices(s: LiveSession, b: OffLineBranch, treeMode: OffLineMode, canWrite: boolean): HTMLElement {
        const L = strings.live;
        const box = el('div', 'research-offline__choices');
        const taken = el('div', 'research-offline__taken');
        taken.appendChild(el('span', 'research-offline__taken-label', L.branchTaken));
        const seg = el('div', 'research-offline__segment');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', L.branchTakenAria);
        const busy = branchBusy.has(b.id);
        const radios: HTMLButtonElement[] = [];
        for (const m of OWN_MODES) {
            const on = b.mode === m;
            const label = `${L.offModeCap[m]}${m === treeMode ? ` ${L.branchDefaultTag}` : ''}`;
            const r = el('button', `research-offline__seg${on ? ' is-on' : ''}`, label);
            r.type = 'button';
            r.setAttribute('role', 'radio');
            r.setAttribute('aria-checked', String(on));
            r.tabIndex = on || (!OWN_MODES.includes(b.mode as typeof m) && m === OWN_MODES[0]) ? 0 : -1;
            r.dataset.mode = m;
            if (!canWrite || busy) r.setAttribute('aria-disabled', 'true');
            else r.onclick = () => {
                if (on) return;
                // The tree's own choice: back to the default (it follows the tree from then on).
                void this.changeBranchMode(b, m === treeMode ? 'default' : m);
            };
            radios.push(r);
            seg.appendChild(r);
        }
        seg.onkeydown = (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const i = radios.indexOf(document.activeElement as HTMLButtonElement);
            const next = radios[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : radios.length - 1)) % radios.length];
            next?.focus();
            next?.click();
        };
        taken.appendChild(seg);
        box.appendChild(taken);
        const acts = el('div', 'research-offline__acts');
        const lines = activeDirections(s);
        const nearest = lines.find(d => d.id === b.nearest);
        if (lines.length > 0) {
            const add = el('button', 'secondary research-offline__add', nearest ? L.branchAdd(nearest.name) : L.branchAddPick);
            add.type = 'button';
            add.dataset.do = 'add';
            add.setAttribute('aria-haspopup', 'menu');
            if (!canWrite || busy) add.setAttribute('aria-disabled', 'true');
            else add.onclick = (e) => {
                e.stopPropagation();
                this.openBranchAddPick(add, b, lines);
            };
            acts.appendChild(add);
        }
        const tasks = el('button', 'link-button research-offline__tasks', L.branchTasks);
        tasks.type = 'button';
        tasks.dataset.do = 'tasks';
        tasks.onclick = () => this.showBranchTasks(b.id);
        acts.appendChild(tasks);
        box.appendChild(acts);
        return box;
    },

    /** The queue narrowed to a branch's tasks (a chip says so; × shows all again). */
    showBranchTasks(id: string): void {
        const s = liveSession();
        if (!s) return;
        setQueueBranchFilter(s, id);
        setQueueDirectionFilter('all');
        this.unfoldOverviewSection('queue');
        this.renderResearchOverview();
        document.querySelector<HTMLElement>('#research-overview .research-offline__chip')?.focus();
        document.querySelector('#research-overview .live-queue')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },

    /** The chip of a narrowed queue: "Branch {name} {n} ×". */
    branchQueueChip(s: LiveSession, id: string, n: number): HTMLElement {
        const L = strings.live;
        const chip = el('button', 'research-overview__filter research-offline__chip', `${L.branchQueueChip(branchName(id), n)} ×`);
        chip.type = 'button';
        chip.setAttribute('aria-pressed', 'true');
        chip.title = L.branchQueueChipClear;
        chip.dataset.branch = id;
        chip.onclick = () => {
            setQueueBranchFilter(s, null);
            this.renderResearchOverview();
            document.querySelector<HTMLElement>('#research-overview .research-overview__queue-filters .research-overview__filter')?.focus();
        };
        return chip;
    },

    /** Add to a direction: the running ones, the nearest first (lit, "nearest"). */
    openBranchAddPick(anchor: HTMLElement, b: OffLineBranch, lines: readonly LiveDirection[]): void {
        const wasOpen = document.getElementById('research-offline-pick')?.dataset.branch === b.id;
        this.closeBranchPopups();
        if (wasOpen) return;
        const L = strings.live;
        const menu = el('div', 'context-menu live-task-menu research-offline-pick');
        menu.id = 'research-offline-pick';
        menu.dataset.branch = b.id;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', L.branchAddTitle);
        menu.appendChild(el('div', 'research-offline-pick__title', L.branchAddTitle));
        const sorted = [...lines].sort((x, y) => (x.id === b.nearest ? -1 : 0) - (y.id === b.nearest ? -1 : 0));
        for (const d of sorted) {
            const item = el('div', `context-menu-item research-offline-pick__item${d.id === b.nearest ? ' is-nearest' : ''}`);
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.direction = d.id;
            item.appendChild(el('span', 'research-offline-pick__name', d.name));
            if (d.id === b.nearest) item.appendChild(el('span', 'research-offline-pick__near', L.branchNearest));
            const run = (): void => {
                this.closeBranchPopups();
                void this.changeBranchMode(b, { line: d.id });
            };
            item.onclick = run;
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
            };
            menu.appendChild(item);
        }
        this.showBranchPopup(anchor, menu, false, c => { pickCleanup = c; });
    },

    /** The ⋯ of a branch: Create a direction from it (a computer) · Do not research · Reset to default (own choice). */
    openBranchMenu(anchor: HTMLElement, b: OffLineBranch): void {
        const wasOpen = document.getElementById('research-offline-menu')?.dataset.branch === b.id;
        this.closeBranchPopups();
        if (wasOpen) return;
        const L = strings.live;
        const menu = el('div', 'context-menu live-task-menu research-direction-menu research-offline-menu');
        menu.id = 'research-offline-menu';
        menu.dataset.branch = b.id;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', L.branchMenu);
        const items: [string, string, string | undefined, () => void][] = [];
        items.push(['create', L.branchCreate, undefined, () => this.createDirectionFromBranch(b, anchor)]);
        items.push(['never', L.branchNever, L.branchNeverHint, () => void this.changeBranchMode(b, 'never')]);
        if (b.own) items.push(['default', L.branchReset, undefined, () => void this.changeBranchMode(b, 'default')]);
        for (const [what, label, hint, run] of items) {
            const item = el('div', 'context-menu-item research-direction-menu__item');
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.do = what;
            item.appendChild(el('span', 'research-direction-menu__label', label));
            if (hint) item.appendChild(el('span', 'research-direction-menu__hint', hint));
            const go = (): void => {
                this.closeBranchPopups();
                run();
            };
            item.onclick = go;
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            };
            menu.appendChild(item);
        }
        this.showBranchPopup(anchor, menu, true, c => { branchMenuCleanup = c; });
    },

    /** Show a popup by its anchor: arrows move, Escape closes (focus back), a press elsewhere closes. */
    showBranchPopup(anchor: HTMLElement, menu: HTMLElement, alignRight: boolean, keep: (cleanup: () => void) => void): void {
        document.body.appendChild(menu);
        anchor.setAttribute('aria-expanded', 'true');
        placeBy(anchor, menu, alignRight);
        menu.querySelector<HTMLElement>('.context-menu-item')?.focus();
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeBranchPopups();
                anchor.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const all = [...menu.querySelectorAll<HTMLElement>('.context-menu-item')];
                const i = all.indexOf(document.activeElement as HTMLElement);
                all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
            }
        };
        const onDown = (e: Event): void => {
            if (!menu.contains(e.target as Node) && e.target !== anchor) this.closeBranchPopups();
        };
        document.addEventListener('keydown', onKey, true);
        const arm = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
        keep(() => {
            clearTimeout(arm);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            anchor.removeAttribute('aria-expanded');
            menu.remove();
        });
    },

    closeBranchPopups(): void {
        pickCleanup?.();
        pickCleanup = null;
        branchMenuCleanup?.();
        branchMenuCleanup = null;
    },

    /**
     * Create a direction from a branch: the form with its person, the kind
     * from the relation (a sibling of an ancestor: descendants; an in-law:
     * ancestors), and the branch (the research adds it to the new direction).
     */
    createDirectionFromBranch(b: OffLineBranch, returnFocus: HTMLElement | null, waiting?: LiveWaiting): void {
        const L = strings.live;
        const kind = b.via?.rel === 'partner' ? 'ancestors' : 'descendants';
        const via = b.via ? personByRefn(b.via.person) : null;
        const note = b.via ? L.branchVia(L.branchRel[b.via.rel] ?? L.branchRel.other, via ? shownName(via) : b.via.person) : '';
        this.openDirectionForm({
            mode: 'new', person: b.person, kind, branch: b.id, kindFromBranch: true, ...(note ? { branchNote: note } : {}), returnFocus,
        });
    },

    /**
     * A branch's choice through the bridge: the section at once in its new
     * state, a toast with Undo (the choice before), a busy research tried
     * again once after 3 s, a refusal said at the branch.
     */
    async changeBranchMode(b: OffLineBranch, to: BranchModeWrite, opts: { undo?: boolean } = {}): Promise<boolean> {
        this.closeBranchPopups();
        const s = liveSession();
        if (!s || s.ended || !s.offLine || branchBusy.has(b.id) || !this.directionsView(s).canWrite) return false;
        const L = strings.live;
        const before = s.offLine.branches.find(x => x.id === b.id) ?? b;
        branchBusy.add(b.id);
        branchProblems.delete(b.id);
        this.redrawDirections();
        refocusBranch(b.id);
        const head = await this.waitingHeadBeforeWrite(s);
        const r = await withBusyRetry(() => setBranchMode(s.bridge.base, b.id, to));
        branchBusy.delete(b.id);
        if (liveSession() !== s || s.ended || !s.offLine) return false;
        if (!r.ok) {
            branchProblems.set(b.id, {
                text: r.code === 'none' && r.errorCode !== 'directions.none' ? L.branchGone : directionRefusedText(r),
                tone: r.code === 'busy' ? 'warn' : 'danger',
                ...(r.code === 'busy' || r.code === 'network' || r.code === 'failed' ? { retry: () => void this.changeBranchMode(b, to, opts) } : {}),
            });
            this.redrawDirections();
            refocusBranch(b.id);
            return false;
        }
        if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
        const treeMode = s.offLine.mode;
        const next: OffLineBranch = r.branch?.id === b.id ? r.branch : {
            ...before,
            ...(typeof to === 'object' ? { mode: 'line' as const, line: to.line, own: true }
                : to === 'default' ? { mode: treeMode, own: false, line: undefined } : { mode: to, own: true, line: undefined }),
        };
        s.offLine = { ...s.offLine, branches: s.offLine.branches.map(x => x.id === b.id ? next : x) };
        if (next.mode === 'line' || next.mode === 'never') {
            if (branchOpen === b.id) branchOpen = null;
            if (queueBranch?.id === b.id && next.mode === 'never') queueBranch = null;
        }
        this.redrawDirections();
        refocusBranch(b.id);
        if (!opts.undo) {
            const message = typeof to === 'object' ? L.dirToastAdded : to === 'never' ? L.dirToastBranchOff : L.dirToastSaved;
            const back = branchBack(before);
            this.showToast(message, 6000, {
                kind: 'direction',
                action: { label: L.dirUndo, run: () => void this.changeBranchMode(next, back, { undo: true }) },
            });
        }
        this.liveStatusSoon(s);
        return true;
    },

    /** The branches added to a direction, in its detail: "Branch {name} helps too · {n} tasks · Remove from the direction". */
    appendDirectionBranches(detail: HTMLElement, s: LiveSession, d: LiveDirection, canWrite: boolean): void {
        if (!offLineShown(s)) return;
        const L = strings.live;
        for (const b of s.offLine!.branches.filter(x => x.mode === 'line' && x.line === d.id)) {
            const line = el('div', 'research-offline__helps');
            line.dataset.branch = b.id;
            line.appendChild(el('span', undefined, L.dirBranchHelps(branchName(b.id, b.person), b.tasks)));
            if (canWrite) {
                const remove = el('button', 'link-button research-offline__remove', L.dirBranchRemove);
                remove.type = 'button';
                remove.dataset.do = 'remove-branch';
                if (!branchBusy.has(b.id)) remove.onclick = () => void this.changeBranchMode(b, 'default');
                line.appendChild(remove);
            }
            const problem = branchProblems.get(b.id);
            if (problem) line.appendChild(problemBox(problem));
            const actions = detail.querySelector('.research-direction__actions');
            detail.insertBefore(line, actions);
        }
    },

    /** Open the research's settings of the followed tree at "Work outside the directions". */
    openOffLineSettings(): void {
        const s = liveSession();
        if (!s) return;
        void this.showResearchTreeSettings(s.treeId).then(() => {
            const group = document.getElementById('research-offline-host');
            group?.scrollIntoView({ block: 'start' });
            group?.querySelector<HTMLInputElement>('input[name="research-offline-mode"]:checked')?.focus({ preventScroll: true });
        });
    },

    // ==================== A TASK'S OWN PLACE ====================

    /** What a refused own place says at its task ('' none). */
    taskOrderProblem(id: string): string {
        return taskProblems.get(id) ?? '';
    },

    /** A task's place in the queue is being written. */
    taskOrderBusy(id: string): boolean {
        return taskBusy.has(id);
    },

    /**
     * Do next / To the end / Reset to default through the bridge: a toast
     * with Undo, the agent at work on it (409 `queue.doing`) said at the task.
     */
    async changeTaskOrder(task: string, what: TaskOrderDo, opts: { undo?: boolean } = {}): Promise<boolean> {
        this.closeLiveTaskMenu();
        const s = liveSession();
        if (!s || !taskOrderOffered(s) || taskBusy.has(task)) return false;
        const L = strings.live;
        const before = s.queue.find(q => q.id === task);
        taskBusy.add(task);
        taskProblems.delete(task);
        this.renderLivePanel();
        const head = await this.waitingHeadBeforeWrite(s);
        const r = await withBusyRetry(() => setTaskOrder(s.bridge.base, task, what));
        taskBusy.delete(task);
        if (liveSession() !== s || s.ended) return false;
        if (!r.ok) {
            taskProblems.set(task, taskRefusedText(r));
            this.renderLivePanel();
            return false;
        }
        if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
        s.queue = s.queue.map(q => {
            if (q.id !== task) return q;
            if (r.task?.id === task) return r.task;
            const { own: _own, ...rest } = q;
            return what === 'default' ? rest : { ...rest, own: what, why: { kind: 'own', do: what } };
        });
        this.renderLivePanel();
        if (!opts.undo) {
            const back: TaskOrderDo = before?.own ?? 'default';
            this.showToast(L.dirToastSaved, 6000, {
                kind: 'direction',
                action: { label: L.dirUndo, run: () => void this.changeTaskOrder(task, back, { undo: true }) },
            });
        }
        this.liveStatusSoon(s);
        return true;
    },

    // ==================== A GROWING BRANCH IN AWAITING ACTION ====================

    /**
     * A new status's waiting items: a growing branch answered here stays
     * hidden while a status read before the answer still lists it; once a
     * status leaves it out, it is forgotten (a later one may ask again).
     */
    withoutBranchAnswers(items: LiveWaiting[]): LiveWaiting[] {
        for (const id of [...answered]) if (!items.some(w => w.id === id)) answered.delete(id);
        return answered.size === 0 ? items : items.filter(w => !answered.has(w.id));
    },

    /**
     * A growing branch's buttons: Add to the direction {line} (main), Create
     * a direction · Leave as it is · Do not research; the hint under them.
     * A phone (and an older bridge) says where it is answered.
     */
    appendBranchWaitingActions(host: HTMLElement, w: LiveWaiting, s: LiveSession): void {
        const L = strings.live;
        const off = s.offLine;
        const b = off?.branches.find(x => x.id === w.branch);
        const canWrite = offLineShown(s) && this.directionsView(s).canWrite;
        if (!canWrite) {
            host.appendChild(el('p', 'research-overview__muted research-offline__elsewhere', L.waitBranchElsewhere));
            return;
        }
        const line = s.researches.find(d => d.id === (w.research ?? b?.nearest));
        const box = el('div', 'research-offline__wait-actions');
        const busy = branchBusy.has(w.id);
        const add = (label: string, cls: string, what: string, run: () => void): void => {
            const btn = el('button', `live-waiting-answer research-overview__waiting-action ${cls}`, label);
            btn.type = 'button';
            btn.dataset.do = what;
            if (busy) btn.setAttribute('aria-disabled', 'true');
            else btn.onclick = run;
            box.appendChild(btn);
        };
        if (line && line.state !== 'done') {
            add(L.branchAdd(line.name), 'is-primary', 'line', () => void this.answerGrowingBranch(w, 'line', line.id));
        }
        if (b) add(L.dirCreate, '', 'create', () => this.createDirectionFromBranch(b, null, w));
        add(L.waitBranchLeave, '', 'keep', () => void this.answerGrowingBranch(w, 'keep'));
        add(L.branchNever, '', 'never', () => void this.answerGrowingBranch(w, 'never'));
        host.appendChild(box);
        const problem = branchProblems.get(w.id);
        if (problem) host.appendChild(problemBox(problem));
        const taken = b && b.mode !== 'line' ? b.mode : off?.mode;
        if (taken && taken !== 'never') host.appendChild(el('p', 'research-offline__wait-hint', L.waitBranchHint(L.offMode[taken])));
    },

    /** Answer a growing branch through the bridge: the item leaves at once, a toast with Undo (the branch's choice before). */
    async answerGrowingBranch(w: LiveWaiting, what: BranchWaitingDo, line?: string): Promise<boolean> {
        const s = liveSession();
        if (!s || s.ended || branchBusy.has(w.id)) return false;
        const L = strings.live;
        const before = s.offLine?.branches.find(x => x.id === w.branch);
        branchBusy.add(w.id);
        branchProblems.delete(w.id);
        this.renderResearchOverview();
        const head = await this.waitingHeadBeforeWrite(s);
        const r = await withBusyRetry(() => answerBranchWaiting(s.bridge.base, w.id, what, line));
        branchBusy.delete(w.id);
        if (liveSession() !== s || s.ended) return false;
        if (!r.ok) {
            // Answered elsewhere meanwhile: the item just goes.
            if (r.code === 'none') {
                answered.add(w.id);
                s.waiting = s.waiting.filter(x => x.id !== w.id);
                this.renderLivePanel();
                this.liveStatusSoon(s);
                return false;
            }
            branchProblems.set(w.id, {
                text: directionRefusedText(r), tone: r.code === 'busy' ? 'warn' : 'danger',
                ...(r.code === 'busy' || r.code === 'network' || r.code === 'failed' ? { retry: () => void this.answerGrowingBranch(w, what, line) } : {}),
            });
            this.renderResearchOverview();
            return false;
        }
        if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
        answered.add(w.id);
        s.waiting = s.waiting.filter(x => x.id !== w.id);
        if (s.offLine && before && what !== 'keep') {
            const next: OffLineBranch = what === 'line'
                ? { ...before, mode: 'line', line: line ?? before.nearest, own: true }
                : { ...before, mode: 'never', own: true, line: undefined };
            s.offLine = { ...s.offLine, branches: s.offLine.branches.map(x => x.id === before.id ? next : x) };
        }
        this.renderLivePanel();
        const message = what === 'line' ? L.dirToastAdded : what === 'never' ? L.dirToastBranchOff : L.dirToastSaved;
        // Undo puts the branch's choice back (the question itself comes again only when the branch grows further).
        const undo = before && what !== 'keep' ? { label: L.dirUndo, run: () => void this.changeBranchMode(
            { ...before, mode: what === 'line' ? 'line' : 'never', line: what === 'line' ? line ?? before.nearest : undefined, own: true },
            branchBack(before), { undo: true }) } : undefined;
        this.showToast(message, 6000, { kind: 'direction', ...(undo ? { action: undo } : {}) });
        this.liveStatusSoon(s);
        return true;
    },
});
