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
    LiveDirection, LiveOffLine, LiveQueueItem, LiveWaiting, LiveWorker, OFF_LINE_MODES, OffLineBranch, OffLineMode, QUEUE_OWN_FEATURE,
} from '../research-link.js';
import { uiModule } from './module.js';
import { LiveSession, el, liveSession, queueNoteText } from './research-ui.js';
import { shownName, fitNameHtml } from '../person-name.js';
import { bookYears } from '../book-blocks.js';
import { withBusyRetry } from '../research-directions.js';
import {
    BranchModeWrite, BranchWaitingDo, DirectionWriteRefused, TaskOrderDo, answerBranchWaiting, directionPeopleKept, setBranchMode, setOffLineTree,
    setTaskOrder,
} from '../research-directions-write.js';
import { bridgeBase } from './history-ui.js';
import { activeDirections, directionRefusedText, holdForBridge, setQueueDirectionFilter } from './research-directions-ui.js';

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
/** The branch added to a direction whose tasks are unfolded in the direction's detail. */
let helpsOpen: string | null = null;
/** Where "All {n} tasks in the queue ›" was pressed: the chip's × gives the focus back there. */
let chipFrom: { branch: string; where: 'section' | 'detail' } | null = null;
/** Tasks of a branch shown under it (the rest is behind the link to the queue). */
const BRANCH_TASKS_SHOWN = 3;
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

/**
 * How a branch's person is related ("brother: Marie Fíšková"): the relation
 * by the person's sex where the tree knows it (neutral without it), the
 * related person's name as it is (not declined).
 */
export function branchViaText(b: OffLineBranch): string {
    if (!b.via) return '';
    const L = strings.live;
    const sex = personByRefn(b.person)?.gender;
    const words = sex === 'male' ? L.branchRelMale : sex === 'female' ? L.branchRelFemale : L.branchRel;
    const via = personByRefn(b.via.person);
    return L.branchVia(words[b.via.rel] ?? words.other, via ? shownName(via) : b.via.person);
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
    if (!queueBranch) chipFrom = null;
}

/** A branch's tasks in the queue, as shown under the branch (§9.1a). */
export interface BranchQueueView {
    /** The first few of its tasks up next, each with its place in the whole queue (1-based). */
    rows: { q: LiveQueueItem; pos: number }[];
    /** Its tasks set aside. */
    parked: LiveQueueItem[];
    /** How many of its tasks are up next (the queue's tail not sent counted by the branch's own number). */
    total: number;
}

/**
 * The tasks of a branch in the queue's order: the place is the task's number
 * in the queue (the same as the queue shows); a queue sent whole is counted
 * exactly, one cut short trusts the branch's own count for the rest.
 */
export function branchQueueView(queue: readonly LiveQueueItem[], queueMore: number, b: OffLineBranch, shown = BRANCH_TASKS_SHOWN): BranchQueueView {
    const mine: { q: LiveQueueItem; pos: number }[] = [];
    let pos = 0;
    for (const q of queue) {
        if (q.state !== 'next') continue;
        pos++;
        if (q.branch === b.id) mine.push({ q, pos });
    }
    const parked = queue.filter(q => q.state === 'parked' && q.branch === b.id);
    const total = queueMore > 0 ? Math.max(mine.length, b.tasks - parked.length) : mine.length;
    return { rows: mine.slice(0, shown), parked, total };
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

/** A growing branch in Awaiting action, in the app's words ("Branch Alois Fíšek: 14 tasks outside … Near the direction … (paused)."). */
export function waitBranchText(w: LiveWaiting, s: LiveSession | null): string {
    const L = strings.live;
    const id = w.branch ?? '';
    const near = s && w.research ? s.researches.find(d => d.id === w.research) : undefined;
    const name = near ? `${near.name}${near.state === 'paused' ? ` ${L.dirNearPaused}` : ''}` : '';
    return L.waitBranchGrows(branchName(id, w.person), w.tasks ?? 0, w.persons ?? 0, name);
}

/**
 * The direction a growing branch's main button adds it to: the one the
 * research names near it while it runs; when that one is paused or ended,
 * the narrowest running direction the branch hangs on through its person
 * (`via`, else the branch's own person) by who is in which direction
 * (`directions.people`, narrowest first); with none, the paused one itself
 * (`paused`, its state said on the button). Null: no direction to add to.
 */
export function growingBranchLine(s: LiveSession, w: LiveWaiting, b: OffLineBranch | undefined): { line: LiveDirection; paused: boolean } | null {
    const near = s.researches.find(d => d.id === (w.research ?? b?.nearest));
    if (near?.state === 'active') return { line: near, paused: false };
    const who = b?.via?.person ?? b?.person ?? w.person;
    const ids = who ? directionPeopleKept(s.bridge.base)?.get(who) ?? [] : [];
    for (const id of ids) {
        const d = s.researches.find(x => x.id === id);
        if (d?.state === 'active') return { line: d, paused: false };
    }
    return near?.state === 'paused' ? { line: near, paused: true } : null;
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

// ==================== RESEARCH FOR THIS TREE: WORK OUTSIDE THE DIRECTIONS ====================

/** Where the settings' group says a refusal: a card ("mode:last"), the switch ("suggest"), a branch ("branch:B-P0031") or the tasks. */
interface SettingsProblem extends Problem { at: string }

/**
 * The group "Work outside the directions" in Research for this tree (§9.5):
 * the research it is for, what was written here and the research has not
 * said yet (a research not followed says it at its next status), the write
 * on its way and a refusal. Forgotten when the dialog opens again.
 */
const offSet: {
    rid: string;
    mode?: OffLineMode;
    suggest?: boolean;
    /** Branches put back to the tree's default here (until the status says so). */
    reset: Set<string>;
    /** Tasks given back their place here, and the status's count when that was written. */
    tasks: { ids: Set<string>; at: number } | null;
    busy: string | null;
    problem: SettingsProblem | null;
    html: string;
} = { rid: '', reset: new Set(), tasks: null, busy: null, problem: null, html: '' };

const SETTINGS_HOST = '#research-tree-settings-modal #research-offline-host';

function forgetOffLineSettings(rid: string): void {
    offSet.rid = rid;
    delete offSet.mode;
    delete offSet.suggest;
    offSet.reset = new Set();
    offSet.tasks = null;
    offSet.busy = null;
    offSet.problem = null;
    offSet.html = '';
}

/** The research's view of work outside the directions for the settings (followed: the live session's, else its last status). */
interface OffLineSettingsSource {
    off: LiveOffLine;
    queue: readonly LiveQueueItem[];
    base: string | null;
    up: boolean;
    live: LiveSession | null;
    /** The directions (a branch added to one names it). */
    researches: readonly LiveDirection[];
}

/** A branch with a choice of its own (added to a direction too): the tree's choice does not apply to it. */
function ownChoice(b: OffLineBranch | undefined): boolean {
    return !!b && (b.own || b.mode === 'line');
}

/** A write's refusal: a busy research or no answer can be tried again. */
function settingsProblem(at: string, r: DirectionWriteRefused, retry: () => void): SettingsProblem {
    return {
        at, text: directionRefusedText(r), tone: r.code === 'busy' ? 'warn' : 'danger',
        ...(r.code === 'busy' || r.code === 'network' || r.code === 'failed' ? { retry } : {}),
    };
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
            el('span', 'research-offline__sum', `· ${L.dirOutSum(off.queued || off.tasks, taken.length)}`));
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
        // Read only still unfolds a branch to its tasks, without their ⋯ and the branch's choices.
        const phone = !canWrite;
        const never = b.mode === 'never';
        const open = !never && branchOpen === b.id;
        const row = el('div', `research-offline__branch${never ? ' is-never' : ''}${open ? ' is-open' : ''}`);
        row.dataset.branch = b.id;
        const main = el('div', 'research-offline__main');
        // The whole head (person's line, meta with the count, samples) unfolds the branch; the person link shows them in the tree.
        const top = el('div', `research-offline__top${never ? '' : ' is-toggle'}`);
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
        if (!never) {
            const expand = el('button', 'research-offline__expand');
            expand.type = 'button';
            expand.setAttribute('aria-expanded', String(open));
            expand.setAttribute('aria-label', `${branchName(b.id, b.person)}: ${L.branchQueue}`);
            const ch = el('span', 'live-section__chevron', open ? '▾' : '▸');
            ch.setAttribute('aria-hidden', 'true');
            expand.appendChild(ch);
            head.prepend(expand);
            top.onclick = (e) => {
                if ((e.target as HTMLElement).closest('.live-person-link')) return;
                branchOpen = open ? null : b.id;
                this.closeBranchPopups();
                this.closeLiveTaskMenu();
                this.renderResearchOverview();
                document.querySelector<HTMLElement>(`#research-overview .research-offline__branch[data-branch="${CSS.escape(b.id)}"] .research-offline__expand`)
                    ?.focus({ preventScroll: true });
            };
        }
        top.appendChild(head);
        const view = branchQueueView(s.queue, s.queueMore, b);
        const meta = el('div', 'research-direction__meta research-offline__meta');
        if (b.via) meta.appendChild(el('span', undefined, branchViaText(b)));
        const near = s.researches.find(d => d.id === b.nearest);
        if (near) meta.appendChild(el('span', undefined, `${L.dirNear(near.name)}${near.state === 'paused' ? ` ${L.dirNearPaused}` : ''}`));
        meta.appendChild(el('span', 'research-offline__count', !never && view.total === 0 ? L.branchNoTasks : L.dirTasks(b.tasks)));
        top.appendChild(meta);
        if (b.samples.length > 0 && !open && !never) {
            const samples = el('div', 'research-offline__samples', b.samples.map(x => x.text).join(' · '));
            samples.title = b.samples.map(x => x.text).join('\n');
            top.appendChild(samples);
        }
        main.appendChild(top);
        if (never) main.appendChild(el('div', 'research-offline__never-note', L.branchNeverTasks));
        const problem = branchProblems.get(b.id);
        if (problem) main.appendChild(problemBox(problem));
        if (open) {
            main.appendChild(this.branchTaskList(s, b, canWrite, 'section'));
            if (canWrite) main.appendChild(this.offLineBranchChoices(s, b, off.mode, canWrite));
        }
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

    /** An open branch's choices under its tasks: "Taken:" Now and then · At the end · As usual, Add to the direction {nearest}. */
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
        if (acts.childElementCount > 0) box.appendChild(acts);
        return box;
    },

    /**
     * A branch's tasks under it (§9.1a): "In the queue" over its first three
     * tasks in the queue's order, each with its number in the queue (the arc
     * while the agent works on it), a hand-set place said under it and the
     * queue's ⋯ (read only: none); its tasks set aside below, muted; "All {n}
     * tasks in the queue ›" when not all fit; a sentence when none is up next.
     */
    branchTaskList(s: LiveSession, b: OffLineBranch, canWrite: boolean, where: 'section' | 'detail'): HTMLElement {
        const L = strings.live;
        const view = branchQueueView(s.queue, s.queueMore, b);
        const box = el('div', 'research-offline__queue');
        box.dataset.branch = b.id;
        const label = view.total === 0 ? L.branchQueue
            : view.rows.length < view.total ? L.branchQueueHead(view.rows.length, view.total) : L.branchQueueAll;
        box.appendChild(el('div', 'research-offline__queue-head', label));
        const list = el('ul', 'research-offline__tasks');
        const menu = canWrite && (taskOrderOffered(s) || this.researchLinkAvailable('task'));
        for (const { q, pos } of view.rows) {
            const li = el('li', 'research-offline__task');
            li.dataset.task = q.id;
            const doing = s.working.some(w => !!w.task && w.task === q.text);
            if (doing) {
                const arc = el('span', 'research-offline__task-num agent-mark agent-mark--spin');
                arc.setAttribute('aria-label', L.branchQueuePos(pos));
                li.appendChild(arc);
            } else {
                const num = el('span', 'research-offline__task-num', String(pos));
                num.setAttribute('aria-label', L.branchQueuePos(pos));
                li.appendChild(num);
            }
            const text = el('span', 'research-offline__task-text', q.text);
            // Only a hand-set place: the rest of the reason repeats the branch's row.
            if (q.own) text.appendChild(el('span', 'research-offline__task-why', q.own === 'next' ? L.qWhyManualNext : L.qWhyManualLast));
            if (doing) text.appendChild(el('span', 'research-offline__task-why', L.taskDoing));
            const problem = this.taskOrderProblem(q.id);
            if (problem) {
                const p = el('span', 'live-queue-problem', problem);
                p.setAttribute('role', 'alert');
                text.appendChild(p);
            }
            if (this.taskOrderBusy(q.id)) li.setAttribute('aria-busy', 'true');
            li.appendChild(text);
            if (menu) {
                const more = el('button', 'live-queue-more research-offline__task-more', '⋯');
                more.type = 'button';
                more.setAttribute('aria-label', strings.research.taskMenu);
                more.setAttribute('aria-haspopup', 'menu');
                more.dataset.task = q.id;
                more.onclick = (e) => {
                    e.stopPropagation();
                    this.openLiveTaskMenu(more, q.id);
                };
                li.appendChild(more);
            }
            list.appendChild(li);
        }
        for (const q of view.parked) {
            const li = el('li', 'research-offline__task is-parked');
            li.dataset.task = q.id;
            li.appendChild(el('span', 'research-offline__task-num'));
            const text = el('span', 'research-offline__task-text', L.branchParked(q.text));
            const why = queueWhyText(q, s) || queueNoteText(q);
            if (why) text.appendChild(el('span', 'research-offline__task-why', why));
            li.appendChild(text);
            list.appendChild(li);
        }
        if (list.childElementCount > 0) box.appendChild(list);
        if (view.total === 0) {
            box.appendChild(el('p', 'research-offline__queue-empty', view.parked.length > 0 ? L.branchQueueOnlyParked : L.branchQueueEmpty));
        }
        if (view.total > view.rows.length) {
            const all = el('button', 'link-button research-offline__all', L.branchAllTasks(view.total));
            all.type = 'button';
            all.dataset.do = 'all-tasks';
            all.dataset.branch = b.id;
            all.onclick = (e) => {
                e.stopPropagation();
                this.showBranchTasks(b.id, where);
            };
            box.appendChild(all);
        }
        return box;
    },

    /**
     * The whole queue narrowed to a branch's tasks: the queue unfolded, its
     * heading and the chip "Branch {name} {n} ×" at the top of the panel, the
     * focus on the chip (its × brings the focus back to the link).
     */
    showBranchTasks(id: string, where: 'section' | 'detail' = 'section'): void {
        const s = liveSession();
        if (!s) return;
        this.closeLiveTaskMenu();
        setQueueBranchFilter(s, id);
        chipFrom = { branch: id, where };
        setQueueDirectionFilter('all');
        this.unfoldOverviewSection('queue');
        this.renderResearchOverview();
        const body = document.querySelector<HTMLElement>('#research-overview .research-overview__body');
        const heading = body?.querySelector<HTMLElement>('[aria-controls="ov-sec-queue"]');
        if (body && heading) {
            body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
        }
        document.querySelector<HTMLElement>('#research-overview .research-offline__chip')?.focus({ preventScroll: true });
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
            const from = chipFrom?.branch === id ? chipFrom : null;
            setQueueBranchFilter(s, null);
            this.renderResearchOverview();
            // Back to the link it came from, when its branch is still unfolded; else the queue's first pill.
            const link = from ? document.querySelector<HTMLElement>(
                `#research-overview .research-offline__all[data-branch="${CSS.escape(id)}"]`) : null;
            (link ?? document.querySelector<HTMLElement>('#research-overview .research-overview__queue-filters .research-overview__filter'))?.focus();
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
        const kind = b.via?.rel === 'partner' ? 'ancestors' : 'descendants';
        const note = branchViaText(b);
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
        if (helpsOpen === b.id && next.mode !== 'line') helpsOpen = null;
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
        // "·" goes with the part after it: a wrapped line never ends with a dot.
        const part = (control: HTMLElement): HTMLElement => {
            const group = el('span', 'research-offline__helps-part');
            const dot = el('span', 'research-offline__sep', '·');
            dot.setAttribute('aria-hidden', 'true');
            group.append(dot, control);
            return group;
        };
        for (const b of s.offLine!.branches.filter(x => x.mode === 'line' && x.line === d.id)) {
            const wrap = el('div', 'research-offline__helps-box');
            wrap.dataset.branch = b.id;
            const line = el('div', 'research-offline__helps');
            line.dataset.branch = b.id;
            line.appendChild(el('span', undefined, L.dirBranchHelps(branchName(b.id, b.person))));
            // The count unfolds the branch's tasks under the line (the same list as in the section).
            const open = helpsOpen === b.id;
            const toggle = el('button', 'link-button research-offline__helps-toggle');
            toggle.type = 'button';
            toggle.dataset.do = 'branch-tasks';
            toggle.setAttribute('aria-expanded', String(open));
            const ch = el('span', 'live-section__chevron', open ? '▾' : '▸');
            ch.setAttribute('aria-hidden', 'true');
            const view = branchQueueView(s.queue, s.queueMore, b);
            toggle.append(ch, el('span', undefined, view.total === 0 ? L.branchNoTasks : L.dirTasks(b.tasks)));
            toggle.onclick = (e) => {
                e.stopPropagation();
                helpsOpen = open ? null : b.id;
                this.closeLiveTaskMenu();
                this.redrawDirections();
                document.querySelector<HTMLElement>(`#research-overview .research-offline__helps[data-branch="${CSS.escape(b.id)}"] .research-offline__helps-toggle`)
                    ?.focus({ preventScroll: true });
            };
            line.appendChild(part(toggle));
            if (canWrite) {
                const remove = el('button', 'link-button research-offline__remove', L.dirBranchRemove);
                remove.type = 'button';
                remove.dataset.do = 'remove-branch';
                if (!branchBusy.has(b.id)) remove.onclick = () => void this.changeBranchMode(b, 'default');
                line.appendChild(part(remove));
            }
            const problem = branchProblems.get(b.id);
            if (problem) line.appendChild(problemBox(problem));
            wrap.appendChild(line);
            if (open) wrap.appendChild(this.branchTaskList(s, b, canWrite, 'detail'));
            const actions = detail.querySelector('.research-direction__actions');
            detail.insertBefore(wrap, actions);
        }
    },

    /** Open the research's settings of the followed tree at "Work outside the directions". */
    openOffLineSettings(): void {
        const s = liveSession();
        if (!s) return;
        // The overview as a full-screen sheet stays above every dialog: it goes first.
        if (document.querySelector('#research-overview.research-overview--sheet')) this.closeResearchOverview();
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
     * A growing branch's buttons: Add to the direction {line} (main: the
     * nearest running one, a paused one only when no running one is near,
     * said so), Create a direction · Leave as it is · Do not research; the
     * hint under them.
     * A computer whose bridge does not answer now keeps the buttons held
     * (they say why, as the Directions section does); the app on a phone
     * without the bridge, an archive and an older bridge say where it is
     * answered.
     */
    appendBranchWaitingActions(host: HTMLElement, w: LiveWaiting, s: LiveSession): void {
        const L = strings.live;
        const off = s.offLine;
        const b = off?.branches.find(x => x.id === w.branch);
        const view = this.directionsView(s);
        const held = offLineShown(s) && view.down && view.managed && !view.readOnly && !view.phoneOnly;
        const canWrite = offLineShown(s) && view.canWrite;
        if (!canWrite && !held) {
            host.appendChild(el('p', 'research-overview__muted research-offline__elsewhere', L.waitBranchElsewhere));
            return;
        }
        const pick = growingBranchLine(s, w, b);
        const box = el('div', 'research-offline__wait-actions');
        const busy = branchBusy.has(w.id);
        const add = (label: string, cls: string, what: string, run: () => void): void => {
            const btn = el('button', `live-waiting-answer research-overview__waiting-action ${cls}`, label);
            btn.type = 'button';
            btn.dataset.do = what;
            if (held) holdForBridge(btn, L.waitBranchDown);
            else if (busy) btn.setAttribute('aria-disabled', 'true');
            else btn.onclick = run;
            box.appendChild(btn);
        };
        if (pick) {
            const { line, paused } = pick;
            add(paused ? L.branchAddPaused(line.name) : L.branchAdd(line.name), 'is-primary', 'line', () => void this.answerGrowingBranch(w, 'line', line.id));
        }
        if (b) add(L.dirCreate, '', 'create', () => this.createDirectionFromBranch(b, null, w));
        add(L.waitBranchLeave, '', 'keep', () => void this.answerGrowingBranch(w, 'keep'));
        add(L.branchNever, '', 'never', () => void this.answerGrowingBranch(w, 'never'));
        host.appendChild(box);
        if (held) host.appendChild(el('p', 'research-overview__muted research-offline__held', L.waitBranchDown));
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

    // ==================== RESEARCH FOR THIS TREE: WORK OUTSIDE THE DIRECTIONS ====================

    /** Where the settings' group reads work outside the directions (null: the research does not show it by branches). */
    offLineSettingsSource(rid: string): OffLineSettingsSource | null {
        const s = liveSession();
        const live = s && !s.ended && s.researchId.toLowerCase() === rid.toLowerCase() ? s : null;
        if (live) {
            return offLineShown(live)
                ? { off: live.offLine!, queue: live.queue, base: live.bridge.base, up: live.lostSince === null, live, researches: live.researches } : null;
        }
        const st = this.researchStatusOf(rid);
        if (!st?.caps?.offLineBranches || !st.offLine || st.researches.length < 2) return null;
        return { off: st.offLine, queue: st.queue, base: bridgeBase(rid), up: this.researchBridgeUp(rid), live: null, researches: st.researches };
    },

    /** The dialog opened (again): what was written in it before is forgotten. */
    startOffLineSettings(rid: string): void {
        forgetOffLineSettings(rid);
        this.renderOffLineSettings();
    },

    /**
     * §9.5 "Work outside the directions" in Research for this tree: the
     * tree's choice as four cards (now and then with the research's share,
     * at the end, as usual, never), what it applies to, the growing
     * branches' question (not with never), the branches with their own
     * choice and the tasks with a manual place, each with Reset to default.
     * Written at once; a refusal under its card (the choice goes back).
     * Drawn again only when something in it changed (focus kept).
     */
    renderOffLineSettings(): void {
        const host = document.querySelector<HTMLElement>(SETTINGS_HOST);
        if (!host) return;
        const rid = host.dataset.research ?? '';
        if (offSet.rid !== rid) forgetOffLineSettings(rid);
        const src = this.offLineSettingsSource(rid);
        if (!src) {
            if (host.firstChild) host.replaceChildren();
            offSet.html = '';
            return;
        }
        const { off } = src;
        const L = strings.live;
        // What the research says settles what was written here.
        if (offSet.mode !== undefined && off.mode === offSet.mode && offSet.busy === null) delete offSet.mode;
        if (offSet.suggest !== undefined && off.suggest === offSet.suggest && offSet.busy === null) delete offSet.suggest;
        for (const id of [...offSet.reset]) if (!ownChoice(off.branches.find(b => b.id === id))) offSet.reset.delete(id);
        if (offSet.tasks && off.ownTasks !== offSet.tasks.at) offSet.tasks = null;
        const mode = offSet.mode ?? off.mode;
        const suggest = offSet.suggest ?? off.suggest;
        const can = src.up && !!src.base;
        const p = offSet.problem;

        const group = el('fieldset', 'research-transcripts research-offline-settings');
        if (offSet.busy) group.setAttribute('aria-busy', 'true');
        group.appendChild(el('legend', undefined, L.setOutTitle));
        group.appendChild(el('p', 'research-offline-settings__intro', L.setOutIntro));
        const desc: Record<OffLineMode, string> = {
            occasional: L.setOutOcc(off.share), last: L.setOutLast, normal: L.setOutNorm, never: L.setOutNever,
        };
        for (const m of OFF_LINE_MODES) {
            const card = el('label', 'research-transcripts-card research-offline-settings__card');
            const input = el('input');
            input.type = 'radio';
            input.name = 'research-offline-mode';
            input.value = m;
            input.dataset.key = `mode:${m}`;
            if (m === mode) input.setAttribute('checked', '');
            if (!can) input.disabled = true;
            input.addEventListener('change', () => { if (input.checked) void this.setOffLineSettingsMode(m); });
            const text = el('span', 'research-transcripts-text');
            const title = el('span', 'research-transcripts-title', L.offModeCap[m]);
            if (m === 'occasional') title.append(' ', el('span', 'research-transcripts-default', strings.treeSettings.default));
            text.append(title, el('span', 'research-transcripts-desc', desc[m]));
            card.append(input, text);
            group.appendChild(card);
            if (p?.at === `mode:${m}`) group.appendChild(problemBox(p));
        }
        // What the tree's choice applies to: the branches that follow it (not those with their own choice,
        // not researched or added to a direction); how many have their own choice after it.
        const own = off.branches.filter(b => ownChoice(b) && !offSet.reset.has(b.id));
        let affects: string;
        if (off.branches.length > 0) {
            const follow = off.branches.filter(b => !own.includes(b) && b.mode !== 'line' && b.mode !== 'never');
            affects = L.setOutAffects(follow.reduce((n, b) => n + b.tasks, 0), follow.length);
            if (own.length > 0) affects += ` ${L.setOutOwn(own.length)}`;
        } else {
            affects = L.setOutAffects(off.queued || off.tasks, 0);
        }
        group.appendChild(el('p', 'research-offline-settings__affects', affects));

        // The growing branches' question: none with never.
        const never = mode === 'never';
        const row = el('label', 'settings-checkbox research-offline-settings__suggest');
        const box = el('input');
        box.type = 'checkbox';
        box.id = 'research-offline-suggest';
        box.dataset.key = 'suggest';
        if (suggest && !never) box.setAttribute('checked', '');
        if (!can || never) box.disabled = true;
        box.addEventListener('change', () => void this.setOffLineSettingsSuggest(box.checked));
        const boxText = el('span', 'settings-text');
        boxText.append(el('span', 'settings-name', L.setSuggest), el('span', 'settings-desc', never ? L.setSuggestNever : L.setSuggestDesc));
        row.append(box, boxText);
        group.appendChild(row);
        if (p?.at === 'suggest') group.appendChild(problemBox(p));

        // Branches with their own choice (one added to a direction: "– near the direction {n}", Remove from the direction),
        // tasks with a manual place.
        const ownIds = src.queue.filter(q => q.own && !offSet.tasks?.ids.has(q.id)).map(q => q.id);
        const ownTasks = offSet.tasks ? Math.max(0, offSet.tasks.at - offSet.tasks.ids.size) : off.ownTasks;
        if (own.length > 0 || ownTasks > 0) {
            const list = el('div', 'research-offline-settings__own');
            if (own.length > 0) list.appendChild(el('div', 'research-offline-settings__own-head', L.setOwnChoice));
            for (const b of own) {
                const line = el('div', 'research-offline-settings__row');
                line.dataset.branch = b.id;
                const added = b.mode === 'line';
                const how = added ? L.dirNear(src.researches.find(d => d.id === b.line)?.name ?? b.line ?? '')
                    : b.mode === 'never' ? L.offNotResearched : L.offMode[b.mode as OffLineMode];
                line.appendChild(el('span', 'research-offline-settings__row-text', L.setOwnRow(branchName(b.id, b.person), how)));
                if (can) {
                    const reset = el('button', 'link-button research-offline-settings__reset', added ? L.dirBranchRemove : L.branchReset);
                    reset.type = 'button';
                    reset.dataset.do = added ? 'remove-branch' : 'reset-branch';
                    reset.dataset.key = `branch:${b.id}`;
                    reset.addEventListener('click', () => void this.resetOffLineSettingsBranch(b.id));
                    line.appendChild(reset);
                }
                list.appendChild(line);
                if (p?.at === `branch:${b.id}`) list.appendChild(problemBox(p));
            }
            if (ownTasks > 0) {
                const line = el('div', 'research-offline-settings__row research-offline-settings__tasks');
                line.dataset.tasks = ownIds.join(' ');
                line.appendChild(el('span', 'research-offline-settings__row-text', L.setManualTasks(ownTasks)));
                if (can && ownIds.length > 0) {
                    const reset = el('button', 'link-button research-offline-settings__reset', L.branchReset);
                    reset.type = 'button';
                    reset.dataset.do = 'reset-tasks';
                    reset.dataset.key = 'tasks';
                    reset.addEventListener('click', () => void this.resetOffLineSettingsTasks());
                    line.appendChild(reset);
                }
                list.appendChild(line);
                if (p?.at === 'tasks') list.appendChild(problemBox(p));
            }
            group.appendChild(list);
        }
        if (!src.up) group.appendChild(el('p', 'research-stories-note research-offline-settings__down', strings.history.storiesBridgeDown));

        const html = group.outerHTML;
        if (html === offSet.html && host.firstChild) return;
        offSet.html = html;
        const a = document.activeElement as HTMLElement | null;
        const key = a && host.contains(a) ? a.dataset.key ?? (a.classList.contains('research-direction__retry') ? 'retry' : '') : null;
        host.replaceChildren(group);
        group.querySelectorAll<HTMLButtonElement>('.research-direction__retry').forEach(b => { b.dataset.key = 'retry'; });
        if (key !== null) {
            const target = (key ? group.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]:not(:disabled)`) : null)
                ?? group.querySelector<HTMLElement>('input[name="research-offline-mode"]:checked:not(:disabled)');
            target?.focus({ preventScroll: true });
        }
    },

    /** The tree's choice of how work outside the directions is taken (a card picked). */
    async setOffLineSettingsMode(m: OffLineMode): Promise<void> {
        const src = this.offLineSettingsSource(offSet.rid);
        if (!src || offSet.busy || m === (offSet.mode ?? src.off.mode)) { this.renderOffLineSettings(); return; }
        await this.writeOffLineSettingsTree(`mode:${m}`, { mode: m }, () => void this.setOffLineSettingsMode(m));
    },

    /** The growing branches' question on or off. */
    async setOffLineSettingsSuggest(on: boolean): Promise<void> {
        const src = this.offLineSettingsSource(offSet.rid);
        if (!src || offSet.busy || on === (offSet.suggest ?? src.off.suggest)) { this.renderOffLineSettings(); return; }
        await this.writeOffLineSettingsTree('suggest', { suggest: on }, () => void this.setOffLineSettingsSuggest(on));
    },

    /** `POST /offline` at once: shown chosen while on its way, back to what the research says when refused. */
    async writeOffLineSettingsTree(at: string, body: { mode?: OffLineMode; suggest?: boolean }, retry: () => void): Promise<void> {
        const rid = offSet.rid;
        const src = this.offLineSettingsSource(rid);
        if (!src?.base || !src.up) { this.renderOffLineSettings(); return; }
        const base = src.base;
        offSet.busy = at;
        offSet.problem = null;
        if (body.mode) offSet.mode = body.mode;
        if (body.suggest !== undefined) offSet.suggest = body.suggest;
        this.renderOffLineSettings();
        const head = await this.researchHeadBeforeWrite(rid, { ask: true, base });
        const r = await withBusyRetry(() => setOffLineTree(base, body));
        if (offSet.rid !== rid) return;
        offSet.busy = null;
        if (!r.ok) {
            if (body.mode) delete offSet.mode;
            if (body.suggest !== undefined) delete offSet.suggest;
            offSet.problem = settingsProblem(at, r, retry);
            this.renderOffLineSettings();
            return;
        }
        if (r.head) this.researchTakeOwnWriteHead(rid, head, r.head, r.parent);
        const live = src.live && liveSession() === src.live && !src.live.ended ? src.live : null;
        if (live?.offLine) {
            const said = r.offLine;
            const mode = said?.mode ?? body.mode ?? live.offLine.mode;
            live.offLine = {
                ...live.offLine,
                mode,
                own: said?.own ?? (body.mode ? true : live.offLine.own),
                share: said?.share ?? live.offLine.share,
                suggest: said?.suggest ?? body.suggest ?? live.offLine.suggest,
                // Branches without their own choice follow the tree's.
                branches: live.offLine.branches.map(b => b.own || b.mode === 'line' ? b : { ...b, mode }),
            };
            this.redrawDirections();
            this.liveStatusSoon(live);
        }
        this.renderOffLineSettings();
    },

    /** A branch with its own choice back to the tree's default (`POST /offline/<B…>` `{mode: 'default'}`). */
    async resetOffLineSettingsBranch(id: string): Promise<void> {
        const rid = offSet.rid;
        const src = this.offLineSettingsSource(rid);
        if (!src?.base || !src.up || offSet.busy) { this.renderOffLineSettings(); return; }
        const base = src.base;
        const at = `branch:${id}`;
        offSet.busy = at;
        offSet.problem = null;
        this.renderOffLineSettings();
        const head = await this.researchHeadBeforeWrite(rid, { ask: true, base });
        const r = await withBusyRetry(() => setBranchMode(base, id, 'default'));
        if (offSet.rid !== rid) return;
        offSet.busy = null;
        // Gone meanwhile (done, or in a direction): nothing to reset.
        const gone = !r.ok && r.code === 'none' && r.errorCode !== 'directions.none';
        if (!r.ok && !gone) {
            offSet.problem = settingsProblem(at, r, () => void this.resetOffLineSettingsBranch(id));
            this.renderOffLineSettings();
            return;
        }
        if (r.ok && r.head) this.researchTakeOwnWriteHead(rid, head, r.head, r.parent);
        offSet.reset.add(id);
        const live = src.live && liveSession() === src.live && !src.live.ended ? src.live : null;
        if (live?.offLine) {
            const off = live.offLine;
            live.offLine = {
                ...off,
                branches: off.branches.map(b => b.id !== id ? b
                    : r.ok && r.branch?.id === id ? r.branch : { ...b, mode: off.mode, own: false, line: undefined }),
            };
            this.redrawDirections();
            this.liveStatusSoon(live);
        }
        this.renderOffLineSettings();
    },

    /**
     * The tasks with a manual place back to the queue's order: the bridge
     * resets one task at a time (`POST /queue/<T…>` `{do: 'default'}`), each
     * in the queue as last said; one the agent works on now keeps its place
     * (said under the row), a refusal stops the rest (Try again goes on).
     */
    async resetOffLineSettingsTasks(): Promise<void> {
        const rid = offSet.rid;
        const src = this.offLineSettingsSource(rid);
        if (!src?.base || !src.up || offSet.busy) { this.renderOffLineSettings(); return; }
        const base = src.base;
        const ids = src.queue.filter(q => q.own && !offSet.tasks?.ids.has(q.id)).map(q => q.id);
        if (ids.length === 0) return;
        offSet.busy = 'tasks';
        offSet.problem = null;
        offSet.tasks ??= { ids: new Set(), at: src.off.ownTasks };
        const done = offSet.tasks;
        this.renderOffLineSettings();
        let head = await this.researchHeadBeforeWrite(rid, { ask: true, base });
        let doing = false;
        for (const id of ids) {
            const r = await withBusyRetry(() => setTaskOrder(base, id, 'default'));
            if (offSet.rid !== rid) return;
            if (!r.ok && r.errorCode === 'queue.doing') { doing = true; continue; }
            if (!r.ok && r.code !== 'none') {
                offSet.problem = settingsProblem('tasks', r, () => void this.resetOffLineSettingsTasks());
                break;
            }
            done.ids.add(id);
            if (r.ok && r.head) {
                this.researchTakeOwnWriteHead(rid, head, r.head, r.parent);
                head = r.head;
            }
        }
        offSet.busy = null;
        if (doing && !offSet.problem) offSet.problem = { at: 'tasks', text: strings.live.taskDoing, tone: 'warn' };
        const live = src.live && liveSession() === src.live && !src.live.ended ? src.live : null;
        if (live?.offLine && done.ids.size > 0) {
            live.queue = live.queue.map(q => {
                if (!done.ids.has(q.id) || !q.own) return q;
                const { own: _own, ...rest } = q;
                return rest.why?.kind === 'own' ? (({ why: _why, ...plain }) => plain)(rest) : rest;
            });
            live.offLine = { ...live.offLine, ownTasks: Math.max(0, live.offLine.ownTasks - done.ids.size) };
            offSet.tasks = null;
            this.renderLivePanel();
            this.liveStatusSoon(live);
        }
        this.renderOffLineSettings();
    },
});
