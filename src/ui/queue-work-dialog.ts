/**
 * "Work on the queue…" (spec 052 §5, the research's `work.link` and
 * `run.tasks`, Strom Research 1.32): a button in the overview's Queue heading,
 * the same action in Now while nothing runs, and an item of the Research menu
 * open a dialog that chooses how the agent
 * works on the queue – automatically (`do=loop`) or only a number of tasks
 * (`do=tasks&n=`) – and opens the research's terminal with that choice. The
 * app starts nothing: the terminal says what runs and asks before it starts.
 *
 * While the research works (`/status.busy`: a session or a run) the action is
 * not offered; the Queue heading says it works instead and leads to Now's
 * "Finish and stop".
 *
 * The same dialog narrowed to one direction (spec 126 U10 §2, `run.lines`):
 * "Put an agent on this direction" of its detail and its ⋯ starts the
 * direction's own run – its queue, its agent (with two or more, `run.agents`),
 * the link `work` with `research=` and `agent=`.
 */

import { strings } from '../strings.js';
import {
    QUEUE_PAGE_FEATURE, RUN_TASKS_FEATURE, WORK_LINK_FEATURE, WORK_TASKS_MAX, WORK_TASKS_MIN, researchDeviceAgentLink, researchLinkMark,
    researchSchemeUrl, workTasksCount,
    type LiveAgent, type LiveBusy, type LiveDirection, type LiveQueueCounts, type LiveQueueItem, type LiveRunEnded, type LiveRunLimits,
    type LiveRunWire, type LiveWork, type LiveWorker, type ResearchLinkParams,
} from '../research-link.js';
import {
    type LiveRun, atRunLimit, generalQueueCount, lineRunAgent, lineRunBlock, linesWithRun, liveRuns, queueForGeneralRun, queueRunOf,
    queueTaskTakenByLine, rememberLineAgent, runAgentsOn, runCount, runLimit, runLinesOn,
} from '../research-runs.js';
import { fetchQueuePage } from '../research-queue-pages.js';
import { uiModule } from './module.js';
import { runBusy, prepareBusy, BUSY_SHOW_MS, BUSY_MIN_MS } from './busy.js';
import { el, liveSession, queueKindText, type LiveSession } from './research-ui.js';
import { overviewMode } from './research-overview-ui.js';
import { directionGlyph } from './research-directions-ui.js';
import { normalizeModal } from './modal-skeleton.js';
import { QUEUE_SCOPE } from './queue-start.js';
import { researchActionLabel, setResearchActionLabel } from './research-open-mark.js';
import { inDeviceMode } from './device-mode-ui.js';

const DIALOG_ID = 'queue-work-modal';
/** The reason under the Queue heading's held "Work on the queue…" (and Now's). */
export const QUEUE_LIMIT_NOTE = 'queue-work-limit-queue';
export const NOW_LIMIT_NOTE = 'queue-work-limit-now';
/** "Only [n] tasks" before anything is typed. */
export const WORK_TASKS_DEFAULT = 5;

/** What the research says that the offer and the dialog read (a followed session or the bridge's last status). */
export interface QueueWorkState {
    features?: readonly string[] | null;
    busy?: LiveBusy;
    work?: LiveWork;
    queue: readonly LiveQueueItem[];
    /** The whole queue's counts (`queue.page`): how many tasks are up next beyond the status's twenty. */
    queueCounts?: LiveQueueCounts;
    /** The runs side by side (`run.lines`, spec 126 U10): who works, the agents, the most at once. */
    working?: readonly LiveWorker[];
    runs?: LiveRunWire[];
    runsEnded?: LiveRunEnded[];
    agents?: LiveAgent[];
    limits?: LiveRunLimits;
    researches?: readonly LiveDirection[];
}

/**
 * Where the offer stands: none, the action, "At work ›" in its place, or (runs side by side, spec 126 U10 §5)
 * the action held because the most runs at once work.
 */
export type QueueWorkOffer = 'none' | 'offer' | 'busy' | 'limit';

export interface QueueWorkContext {
    /** The bridge answers now. */
    live: boolean;
    /** The app opens the research's `work` link here (announced, on a computer, not switched off). */
    linkAvailable: boolean;
    /** An archive, a research waiting for its agent, or one whose mode is not known. */
    noAgent: boolean;
    /** The phone's sheet (≤ 640 px or a phone held sideways). */
    phone: boolean;
    /** Directions' runs on their way that the research does not name yet (they count toward the most at once). */
    starting?: number;
}

/** An agent session or a run works in the research now. */
export function researchWorking(state: Pick<QueueWorkState, 'busy'>): boolean {
    return !!state.busy && (state.busy.sessions > 0 || state.busy.runs > 0);
}

/**
 * Whether "Work on the queue…" is offered: a live bridge of a research with
 * an agent that takes the `work` link, the app opening its links, not on a
 * phone; while the research works "At work ›" stands in its place.
 */
export function queueWorkOffer(state: QueueWorkState | null, ctx: QueueWorkContext): QueueWorkOffer {
    if (!state || !ctx.live || ctx.phone || ctx.noAgent || !ctx.linkAvailable) return 'none';
    if (!state.features?.includes(WORK_LINK_FEATURE)) return 'none';
    // Runs side by side (spec 126 U10 §5): only the general run or a session of no run stands in its way,
    // else the most runs at once (the general run, the directions' runs and the starts on their way).
    if (runsSideBySide(state)) {
        const runs = workDialogRuns(state);
        if (generalWorkBusy(state, runs)) return 'busy';
        return atRunLimit(runs, runLimit(state), ctx.starting ?? 0) ? 'limit' : 'offer';
    }
    return researchWorking(state) ? 'busy' : 'offer';
}

/** The research names its runs (`run.lines` with `/status.runs`): the directions' own runs do not hold the general one. */
export function runsSideBySide(state: Pick<QueueWorkState, 'features' | 'runs'>): boolean {
    return runLinesOn(state.features) && Array.isArray(state.runs);
}

/**
 * The research refuses the general run (as the research's `work` does): the general run works already, or a
 * session that belongs to no run (a conversation) – a row of `working[]` none of the runs holds.
 */
export function generalWorkBusy(state: Pick<QueueWorkState, 'working'>, runs: readonly LiveRun[]): boolean {
    if (queueRunOf(runs)) return true;
    const owned = new Set(runs.flatMap(r => r.workers));
    return (state.working ?? []).some(w => !owned.has(w));
}

/** Why "Work on the queue…" is held at the most runs at once ("3 agents are working; the settings allow no more."). */
export function queueWorkLimitText(state: QueueWorkState): string {
    return strings.live.runsLimitReached(runCount(workDialogRuns(state)));
}

/** The queue the general run takes (without the directions with their own run), its count up next and the directions it skips. */
export function generalWorkQueue(state: QueueWorkState): { queue: LiveQueueItem[]; total: number | undefined; skips: LiveDirection[] } {
    const runs = runsSideBySide(state) ? workDialogRuns(state) : [];
    const lines = linesWithRun(runs);
    if (lines.size === 0) return { queue: [...state.queue], total: state.queueCounts?.next, skips: [] };
    const researches = state.researches ?? [];
    const skips = [...lines].map(id => researches.find(d => d.id === id) ?? ({ id, name: id } as LiveDirection));
    // In the order of the directions (Now's order of their runs).
    const order = new Map(researches.map((d, i) => [d.id, d.order ?? i]));
    skips.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    return {
        queue: queueForGeneralRun(state.queue, lines, runs),
        total: state.queueCounts ? generalQueueCount(state.queue, state.queueCounts, runs) : undefined,
        skips,
    };
}

/** "Skips the direction X (its own agent works on it)." (null: none skipped). */
export function queueWorkSkipsText(skips: readonly Pick<LiveDirection, 'name'>[]): string | null {
    return skips.length === 0 ? null : strings.live.queueWorkSkips(skips.map(d => d.name).join(', '), skips.length);
}

/** "Only [n] tasks" is a choice (`run.tasks`); without it only "Automatically". */
export function queueWorkCounted(state: QueueWorkState): boolean {
    return !!state.features?.includes(RUN_TASKS_FEATURE);
}

/**
 * The task that comes first: one set next by hand, else the one first in the queue (its lowest place: the
 * general run's first may stand after the directions' own, spec 126 U10 §6), else the first up next.
 */
export function queueWorkFirst(queue: readonly LiveQueueItem[]): LiveQueueItem | null {
    const next = queue.filter(q => q.state === 'next');
    const placed = next.filter(q => q.pos !== undefined);
    const lowest = placed.length > 0 ? placed.reduce((a, q) => (q.pos! < a.pos! ? q : a)) : null;
    return next.find(q => q.own === 'next') ?? lowest ?? next[0] ?? null;
}

/** The status carries at most this many tasks (`sanitizeQueue`): a full one may leave some out. */
const STATUS_QUEUE_FULL = 20;

/** The tasks after the first, in the research's order: up next, not "never", without the first. */
export function queueWorkMore(queue: readonly LiveQueueItem[], first: LiveQueueItem | null): LiveQueueItem[] {
    const rest = queue.filter(q => q.state === 'next' && q.offLine !== 'never' && q !== first);
    const own = rest.filter(q => q.own === 'next');
    const others = rest.filter(q => q.own !== 'next');
    // With `pos`: by it (a task without one after those with one, in the status's order; the sort is stable);
    // without: the status's order.
    const byPos = others.some(q => q.pos !== undefined)
        ? [...others].sort((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity)) : others;
    return [...own, ...byPos];
}

/** The count in "More (n)": "12", "19+" (an older research's full status without counts), or null: no button. */
export function queueWorkMoreCount(state: QueueWorkState, more: readonly LiveQueueItem[], total: number | undefined = state.queueCounts?.next): string | null {
    if (more.length === 0) return null;
    if (total !== undefined) return String(Math.max(more.length, total - 1));
    return state.queue.length >= STATUS_QUEUE_FULL ? `${more.length}+` : String(more.length);
}

/** Tasks up next past those listed (null: not known); `total`: a direction's up next (spec 126 U10). */
export function queueWorkRest(state: QueueWorkState, more: readonly LiveQueueItem[], total: number | undefined = state.queueCounts?.next): number | null {
    return total === undefined ? null : Math.max(0, total - 1 - more.length);
}

/** The runs at work and ended a moment ago (`run.lines`; empty for an older research or a status without its directions). */
export function workDialogRuns(state: QueueWorkState): LiveRun[] {
    if (!runLinesOn(state.features) || !Array.isArray(state.runs)) return [];
    return liveRuns({
        features: state.features ?? null, working: [...(state.working ?? [])], runs: state.runs, runsEnded: state.runsEnded,
        agents: state.agents, researches: [...(state.researches ?? [])],
    });
}

/** The tasks of `line`'s own run, in the status's order: its own and those helping it (spec 126 U10 §2). */
export function lineWorkQueue(state: QueueWorkState, line: string): LiveQueueItem[] {
    const runs = workDialogRuns(state);
    const lines = new Set([line]);
    return state.queue.filter(q => queueTaskTakenByLine(q, lines, runs) === line);
}

/** The agents to choose from (`run.agents` with two or more; null: no choice drawn, the research's default goes). */
export function workDialogAgents(state: QueueWorkState): LiveAgent[] | null {
    return runAgentsOn(state.features) && (state.agents?.length ?? 0) >= 2 ? state.agents! : null;
}

/** The most agents drawn as a segment; more (or a segment wider than its room) are a select. */
export const AGENT_SEGMENT_MAX = 3;

/** Whether the agents' segment, as laid out, is wider than its room or cuts one of its names. */
function agentSegmentOverflows(seg: HTMLElement): boolean {
    const room = seg.parentElement?.clientWidth ?? 0;
    if (room > 0 && seg.scrollWidth > Math.min(seg.clientWidth || room, room) + 1) return true;
    return Array.from(seg.querySelectorAll<HTMLElement>('[data-agent]')).some(b => b.scrollWidth > b.clientWidth + 1);
}

/** How many runs work already (the line "Subscription usage adds up" only from one on; 0 for an older research). */
export function workDialogAddsUp(state: QueueWorkState): number {
    return runCount(workDialogRuns(state));
}

/** The footer's sentence: the terminal confirms (`work.confirm` 'ask' or not said), else it starts at once. */
export function workConfirmText(work: LiveWork | undefined): string {
    return work?.confirm === 'no' ? strings.live.lineRunConfirm : strings.live.queueWorkConfirm;
}

/** The unfolded list under First up: its heading, the rows and what lies beyond them (hidden until More). */
function queueWorkMoreHtml(state: QueueWorkState, more: readonly LiveQueueItem[], line?: { total?: number }, total: number | undefined = state.queueCounts?.next): string {
    const L = strings.live;
    const placed = more.some(q => q.pos !== undefined);
    // With places: the rows numbered 1., 2., 3. as they come after the first (a task set first from 2nd
    // place left no gap at 2.); the place in the whole queue in the tooltip and for a screen reader.
    const rows = more.map((q, i) => {
        const kind = queueKindText(q);
        const tags = `${q.own === 'next' ? ` <span class="research-queue__tag-next">${esc(L.queueTagNext)}</span>` : ''}${kind
            ? ` <span class="live-queue-kind" data-kind="${esc(q.kind ?? '')}">${esc(kind)}</span>` : ''}`;
        return `
                        <li class="queue-work__more-row"${q.pos !== undefined ? ` title="${esc(L.branchQueuePos(q.pos))}"` : ''}>
                            <span class="queue-work__pos" aria-hidden="true">${placed ? `${i + 1}.` : '–'}</span>
                            <span class="queue-work__more-text"><strong>${esc(q.id)}</strong> ${esc(q.text)}${tags}${q.pos !== undefined
                                ? `<span class="queue-work__sr">, ${esc(L.branchQueuePos(q.pos))}</span>` : ''}</span>
                        </li>`;
    }).join('');
    const rest = line ? queueWorkRest(state, more, line.total) : queueWorkRest(state, more, total);
    const restText = rest !== null && rest > 0 ? (line ? L.lineRunRest(rest) : L.queueWorkRest(rest))
        : rest === null && state.queue.length >= STATUS_QUEUE_FULL ? L.queueWorkRestUnknown : '';
    return `
                    <div class="queue-work__more" id="queue-work-more" hidden>
                        <div class="queue-work__more-head" id="queue-work-more-head">${esc(placed ? L.queueWorkThen : L.queueWorkByQueue)}</div>
                        ${placed ? '' : `<div class="queue-work__more-hint">${esc(L.queueWorkByQueueHint)}</div>`}
                        <ol class="queue-work__more-list" aria-labelledby="queue-work-more-head">${rows}
                        </ol>
                        ${restText ? `<p class="queue-work__more-rest">${esc(restText)} · <button type="button" class="link-button queue-work__overview" id="queue-work-overview">${esc(L.queueWorkOverview)}</button></p>` : ''}
                    </div>`;
}

/** "Session up to 1 h · gate: …": the parts the bridge says (none: no line). */
export function queueWorkSessionLine(work: LiveWork | undefined): string {
    if (!work) return '';
    const L = strings.live;
    const parts: string[] = [];
    if (work.minutes > 0) parts.push(L.queueWorkSession(work.minutes));
    if (work.gate) parts.push(L.queueWorkGate(work.gate));
    return parts.join(' · ');
}

/**
 * The link's parameters for a choice (null: a count out of 1–100); `extra`: a direction's own run (its id) and
 * its agent (spec 126 U10 §2; the agent only with the direction).
 */
export function queueWorkParams(mode: 'loop' | 'tasks', count: unknown, extra: { research?: string; agent?: string } = {}): Omit<ResearchLinkParams, 'tree'> | null {
    const line = extra.research ? { research: extra.research, ...(extra.agent ? { agent: extra.agent } : {}) } : {};
    if (mode === 'loop') return { workDo: 'loop', ...line };
    const n = workTasksCount(count);
    // A string: the overview's own window hands the parameters to the main window as text.
    return n === null ? null : { workDo: 'tasks', n: String(n), ...line };
}

/** HTML-escape text for innerHTML (text and attribute values). */
function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** What opened the dialog: the focus goes back there (the overview's button drawn anew: its successor). */
let opener: HTMLElement | null = null;

export const queueWorkMethods = uiModule({
    /** The `work` link opens here: on a computer, announced; on a device, started through the gateway (`agent.start`). */
    queueWorkLinkAvailable(): boolean {
        return this.researchLinkAvailable('work') || (inDeviceMode() && !!this.activeResearchLink('work', { workDo: 'loop' }));
    },

    /** The offer for a followed session drawn in the overview (the overview's own window too). */
    queueWorkOfferFor(s: LiveSession): QueueWorkOffer {
        return queueWorkOffer(s, {
            live: !s.ended && s.lostSince === null,
            linkAvailable: this.queueWorkLinkAvailable(),
            noAgent: this.activeResearchNoAgent(),
            phone: overviewMode() === 'sheet',
            starting: this.lineRunsStarting(),
        });
    },

    /** The directions' runs on their way from here (they count toward the most runs at once until their runs come). */
    lineRunsStarting(): number {
        return this.runStartsNow().filter(x => x.scope !== QUEUE_SCOPE && x.view.phase === 'starting').length;
    },

    /**
     * "Work on the queue…" held at the most runs at once (spec 126 U10 §5, 5d): the button grey and inert,
     * described by the reason drawn under it (queueWorkLimitNote with the same `noteId`).
     */
    queueWorkHeldButton(cls: string, noteId: string): HTMLElement {
        const btn = setResearchActionLabel(el('button', `${cls} is-held`), strings.live.queueWork, researchLinkMark('work'));
        btn.type = 'button';
        btn.dataset.offer = 'limit';
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('aria-describedby', noteId);
        btn.onclick = (e) => e.preventDefault();
        return btn;
    },

    /** The reason under a held "Work on the queue…": "3 agents are working; the settings allow no more. Settings ›". */
    queueWorkLimitNote(state: QueueWorkState, noteId: string): HTMLElement {
        const p = el('p', 'queue-work-limit');
        p.id = noteId;
        p.appendChild(el('span', undefined, queueWorkLimitText(state)));
        const settings = el('button', 'link-button queue-work-limit__settings', strings.live.runsSettingsLink);
        settings.type = 'button';
        settings.onclick = () => this.openRunsSettings();
        p.append(' ', settings);
        return p;
    },

    /**
     * The Queue heading's own control (unfolded only): "Work on the queue…"
     * (AI + terminal), or while the research works "● At work ›" (no mark),
     * which shows Now's "Finish and stop". Null: neither.
     */
    queueWorkHead(s: LiveSession): HTMLElement | null {
        const L = strings.live;
        const offer = this.queueWorkOfferFor(s);
        if (offer === 'busy') {
            const link = el('button', 'link-button queue-work-busy');
            link.type = 'button';
            link.appendChild(el('span', 'queue-work-busy__dot'));
            link.appendChild(el('span', 'queue-work-busy__text', L.queueWorkingLink));
            link.appendChild(el('span', 'queue-work-busy__go', ' ›'));
            link.onclick = () => this.showOverviewNowFinish();
            return link;
        }
        if (offer === 'limit') return this.queueWorkHeldButton('queue-work-btn', QUEUE_LIMIT_NOTE);
        if (offer !== 'offer') return null;
        const btn = setResearchActionLabel(el('button', 'queue-work-btn'), L.queueWork, researchLinkMark('work'));
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.onclick = () => this.showQueueWorkDialog(s, btn);
        this.drawQueueWorkStarting(btn);
        return btn;
    },

    /**
     * A "Work on the queue…" button while its work starts (3a): "Starting…" with the spinner, `aria-busy`,
     * nothing on a click; at rest again after the proof or the limit (the overview is drawn anew).
     */
    drawQueueWorkStarting(btn: HTMLElement): void {
        if (this.queueStartNow()?.phase !== 'starting') return;
        prepareBusy(btn, strings.busy.starting);
        btn.dataset.busy = 'busy';
        btn.setAttribute('aria-busy', 'true');
        btn.setAttribute('aria-disabled', 'true');
        btn.onclick = null;
    },

    /** The state the Research menu reads for the active tree: its followed session, else its bridge's last status. */
    queueWorkMenuState(): { state: QueueWorkState; live: boolean } | null {
        const rid = this.activeResearchId();
        if (!rid) return null;
        const s = liveSession();
        if (s && s.researchId === rid) return { state: s, live: !s.ended && s.lostSince === null };
        const status = this.researchStatusOf(rid);
        return status ? { state: status, live: this.researchBridgeUp(rid) } : null;
    },

    /** "Work on the queue…" in the Research menu (not while the research works). */
    queueWorkMenuOffered(): boolean {
        return this.queueWorkMenuOffer() === 'offer';
    },

    /** The Research menu's offer: the item, the item grey with the reason (`limit`), or none. */
    queueWorkMenuOffer(): QueueWorkOffer {
        const at = this.queueWorkMenuState();
        return !at ? 'none' : queueWorkOffer(at.state, {
            live: at.live,
            linkAvailable: this.queueWorkLinkAvailable(),
            noAgent: this.activeResearchNoAgent(),
            phone: overviewMode() === 'sheet',
            starting: this.lineRunsStarting(),
        });
    },

    /** Why the Research menu's "Work on the queue…" is grey (the most runs at once reached). */
    queueWorkMenuLimitText(): string {
        const at = this.queueWorkMenuState();
        return at ? queueWorkLimitText(at.state) : '';
    },

    /** The Research menu's "Work on the queue…". */
    researchActionWork(): void {
        const opener = document.getElementById('research-menu-btn');
        this.closeActionsMenu();
        const at = this.queueWorkMenuState();
        if (at) this.showQueueWorkDialog(at.state, opener);
    },

    /** The dialog: how to work, what comes first, then the research's terminal. */
    showQueueWorkDialog(state: QueueWorkState, from: HTMLElement | null): void {
        this.showWorkDialog(state, from, {});
    },

    /**
     * "Put an agent on this direction" (spec 126 U10 §2): the dialog narrowed to the direction – its name, its
     * agent, its queue – opened only while its run can start.
     */
    showLineRunDialog(s: LiveSession, d: LiveDirection, from: HTMLElement | null): void {
        this.showWorkDialog(s, from, { line: d, researchId: s.researchId, base: s.bridge?.base });
    },

    /**
     * The dialog of "Work on the queue…" (`scope` empty) or of a direction's own run (`scope.line`): how to work,
     * what comes first, then the research's terminal.
     */
    showWorkDialog(state: QueueWorkState, from: HTMLElement | null, scope: { line?: LiveDirection; researchId?: string; base?: string }): void {
        this.closeQueueWorkDialog(false);
        // A device of the home network: the same choice in the sheet of its start (10.2, 10.9), asked through the gateway.
        if (inDeviceMode()) {
            this.startWorkFromDevice(state, from, scope);
            return;
        }
        const L = strings.live;
        opener = from;
        const line = scope.line ?? null;
        const counted = queueWorkCounted(state);
        const noGate = !!state.work && state.work.gate === null;
        // A direction's run: its queue and its count up next (`queueCounts.research`); else the whole queue.
        const lineTotal = line ? state.queueCounts?.research[line.id] : undefined;
        // The whole queue: without the tasks of the directions with their own run (spec 126 U10 §6), said under the box.
        const general = line ? null : generalWorkQueue(state);
        let queue: readonly LiveQueueItem[] = line ? lineWorkQueue(state, line.id) : general!.queue;
        const skipsText = general ? queueWorkSkipsText(general.skips) : null;
        const session = queueWorkSessionLine(state.work);
        const addsUp = runLinesOn(state.features) ? workDialogAddsUp(state) : 0;
        const agents = line ? workDialogAgents(state) : null;
        const defaultAgent = agents?.find(a => a.default)?.id ?? agents?.[0]?.id ?? null;
        let agent = line && agents && scope.researchId ? lineRunAgent(line, agents, scope.researchId) : null;
        const n0 = WORK_TASKS_DEFAULT;
        /** The box "First up" (with More and the session) for `q`: '' when it has nothing to say. */
        const firstHtml = (q: readonly LiveQueueItem[]): string => {
            const first = queueWorkFirst(q);
            // The tasks after it (not the count in "Only [n] tasks"): folded at every opening.
            const more = queueWorkMore(q, first);
            const moreCount = line ? queueWorkMoreCount({ ...state, queue: q }, more, lineTotal) : queueWorkMoreCount(state, more, general!.total);
            if (!first && !session) return '';
            return `
                <div class="queue-work__first">
                    ${first ? `<div class="queue-work__first-label">${esc(L.queueWorkFirst)}</div>
                    <div class="queue-work__first-task"><strong>${esc(first.id)}</strong> ${esc(first.text)}</div>` : ''}
                    ${moreCount !== null ? `<button type="button" class="link-button queue-work__more-btn" id="queue-work-more-btn" aria-expanded="false" aria-controls="queue-work-more" aria-label="${esc(L.queueWorkMoreAria(moreCount))}" data-count="${esc(moreCount)}"><span class="queue-work__more-label">${esc(L.queueWorkMore(moreCount))}</span><span class="queue-work__chev" aria-hidden="true"></span></button>${queueWorkMoreHtml(line ? { ...state, queue: q } : state, more, line ? { total: lineTotal } : undefined, general?.total)}` : ''}
                    ${session ? `<div class="queue-work__session">${esc(session)}</div>` : ''}
                </div>`;
        };
        const head = line ? `
                    <div class="queue-work__head">
                        <div class="queue-work__head-kicker">${esc(L.lineRunKicker)}</div>
                        <h2 id="queue-work-title"><span class="queue-work__glyph" aria-hidden="true">${esc(directionGlyph(line))}</span> ${esc(line.name)} <span class="code">${esc(line.id)}</span></h2>
                    </div>` : `
                    <h2 id="queue-work-title">${esc(L.queueWorkTitle)}</h2>`;
        // The agent: a segment while it fits (a few short names), else the dialogs' select (five agents of a real research).
        const agentSegHtml = (list: readonly LiveAgent[]): string =>
            `<div class="sel-seg queue-work__agent-seg" role="radiogroup" aria-labelledby="queue-work-agent-h">${list.map(a => `<button type="button" class="segment-btn sel-opt" data-sel-form="seg" role="radio" data-agent="${esc(a.id)}" aria-checked="${a.id === agent}" tabindex="${a.id === agent ? 0 : -1}">${esc(a.name)}${a.id === defaultAgent ? ` <small>(${esc(L.lineRunAgentDefault)})</small>` : ''}</button>`).join('')}</div>`;
        const agentSelectHtml = (list: readonly LiveAgent[]): string =>
            `<select class="queue-work__agent-select" id="queue-work-agent" aria-labelledby="queue-work-agent-h">${list.map(a => `<option value="${esc(a.id)}"${a.id === agent ? ' selected' : ''}>${esc(a.name)}${a.id === defaultAgent ? ` (${esc(L.lineRunAgentDefault)})` : ''}</option>`).join('')}</select>`;
        const agentHtml = agents ? `
                <div class="queue-work__agent">
                    <div class="queue-work__agent-label" id="queue-work-agent-h">${esc(L.lineRunAgent)}</div>
                    ${agents.length <= AGENT_SEGMENT_MAX ? agentSegHtml(agents) : agentSelectHtml(agents)}
                    <p class="queue-work__agent-kept">${esc(L.lineRunAgentKept)}</p>
                </div>` : '';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = DIALOG_ID;
        if (line) overlay.dataset.direction = line.id;
        overlay.innerHTML = `
            <div class="modal modal--sm queue-work${line ? ' queue-work--line' : ''}" role="dialog" data-dialog-kind="choice" aria-modal="true" aria-labelledby="queue-work-title">
                <div class="modal-header">${head}
                    <button type="button" class="close-btn" id="queue-work-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>${agentHtml}
                <div class="queue-work__opts" role="radiogroup" aria-labelledby="queue-work-title">
                    <label class="queue-work__opt sel-opt" data-sel-form="tile">
                        <input type="radio" name="queue-work-mode" value="loop" checked aria-labelledby="queue-work-auto" aria-describedby="queue-work-auto-hint${noGate ? ' queue-work-nogate' : ''}">
                        <span class="queue-work__opt-body">
                            <span class="queue-work__opt-title" id="queue-work-auto">${esc(L.queueWorkAuto)}</span>
                            <span class="queue-work__opt-hint" id="queue-work-auto-hint">${esc(line ? L.lineRunAutoHint : L.queueWorkAutoHint)}</span>
                            ${noGate ? `<span class="queue-work__nogate" id="queue-work-nogate">${esc(L.queueWorkNoGate)}</span>` : ''}
                        </span>
                    </label>
                    ${counted ? `
                    <label class="queue-work__opt sel-opt" data-sel-form="tile">
                        <input type="radio" name="queue-work-mode" value="tasks" aria-label="${esc(`${L.queueWorkOnly} ${n0} ${L.queueWorkOnlyWord(n0)}`)}" aria-describedby="queue-work-only-hint">
                        <span class="queue-work__opt-body">
                            <span class="queue-work__opt-title" id="queue-work-only">${esc(L.queueWorkOnly)} <input type="number" class="queue-work__count" id="queue-work-count" inputmode="numeric" min="${WORK_TASKS_MIN}" max="${WORK_TASKS_MAX}" step="1" value="${n0}" aria-label="${esc(L.queueWorkCountAria)}"> <span class="queue-work__word">${esc(L.queueWorkOnlyWord(n0))}</span></span>
                            <span class="queue-work__opt-hint" id="queue-work-only-hint">${esc(L.queueWorkOnlyHint(n0))}</span>
                        </span>
                    </label>` : ''}
                </div>${firstHtml(queue)}
                ${skipsText ? `<p class="queue-work__adds queue-work__skips">${esc(skipsText)}</p>` : ''}
                ${addsUp > 0 ? `<p class="queue-work__adds">${esc(L.runsAddUp(addsUp))}</p>` : ''}
                ${line ? '<p class="queue-work__held" id="queue-work-held" role="status" hidden></p>' : ''}
                <div class="buttons queue-work__foot">
                    <p class="queue-work__confirm">${esc(workConfirmText(state.work))}</p>
                    <button type="button" class="secondary" id="queue-work-cancel" data-dismiss>${esc(strings.buttons.cancel)}</button>
                    <button type="button" class="primary" id="queue-work-open">${researchActionLabel(line ? L.lineRunStart : L.queueWorkOpenTerm, researchLinkMark('work'))}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.clearDialogStack();
        this.pushDialog(DIALOG_ID);
        const close = (): void => this.closeQueueWorkDialog();
        const open = overlay.querySelector<HTMLButtonElement>('#queue-work-open')!;
        const count = overlay.querySelector<HTMLInputElement>('#queue-work-count');
        const radios = Array.from(overlay.querySelectorAll<HTMLInputElement>('input[name="queue-work-mode"]'));
        const mode = (): 'loop' | 'tasks' => radios.find(r => r.checked)?.value === 'tasks' ? 'tasks' : 'loop';
        const extra = (): { research?: string; agent?: string } => line ? { research: line.id, ...(agents && agent ? { agent } : {}) } : {};
        /** The rows' look, the count's words and its validity (an invalid count: no opening while chosen). */
        const sync = (): void => {
            for (const r of radios) r.closest('.queue-work__opt')?.classList.toggle('is-on', r.checked);
            if (count) {
                const n = workTasksCount(count.value);
                if (n !== null) {
                    overlay.querySelector('.queue-work__word')!.textContent = L.queueWorkOnlyWord(n);
                    overlay.querySelector('#queue-work-only-hint')!.textContent = L.queueWorkOnlyHint(n);
                }
                if (n === null) count.setAttribute('aria-invalid', 'true');
                else count.removeAttribute('aria-invalid');
                // The choice's name with the count typed (the field's own value is not read into it anew).
                radios.find(r => r.value === 'tasks')?.setAttribute('aria-label',
                    `${L.queueWorkOnly} ${count.value.trim()} ${L.queueWorkOnlyWord(n ?? WORK_TASKS_DEFAULT)}`.replace(/\s+/g, ' '));
            }
            open.disabled = queueWorkParams(mode(), count?.value, extra()) === null || overlay.dataset.held === 'true';
        };
        const chooseCount = (): void => {
            const r = radios.find(x => x.value === 'tasks');
            if (r && !r.checked) r.checked = true;
            sync();
        };
        for (const r of radios) r.addEventListener('change', sync);
        // Typing into the count (or clicking it) chooses "Only [n] tasks".
        count?.addEventListener('input', chooseCount);
        count?.addEventListener('click', chooseCount);
        // A segment wider than its room (long names, a narrow screen): the select in its place.
        const seg = overlay.querySelector<HTMLElement>('.queue-work__agent-seg');
        if (seg && agents && agentSegmentOverflows(seg)) seg.outerHTML = agentSelectHtml(agents);
        const agentSelect = overlay.querySelector<HTMLSelectElement>('#queue-work-agent');
        if (agentSelect) agentSelect.onchange = () => { agent = agentSelect.value || null; };
        // The agent: one of the segment (arrows move the choice, as radios do).
        const agentBtns = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.queue-work__agent-seg [data-agent]'));
        const pick = (b: HTMLButtonElement, focus: boolean): void => {
            agent = b.dataset.agent ?? null;
            for (const x of agentBtns) {
                const on = x === b;
                x.setAttribute('aria-checked', String(on));
                x.tabIndex = on ? 0 : -1;
            }
            if (focus) b.focus();
        };
        for (const b of agentBtns) {
            b.onclick = () => pick(b, false);
            b.onkeydown = (e) => {
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const i = agentBtns.indexOf(b);
                pick(agentBtns[(i + step + agentBtns.length) % agentBtns.length], true);
            };
        }
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        overlay.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            close();
        });
        // "More (n)" ↔ "Hide more": the list unfolds under it, the focus stays on it.
        const wireMore = (): void => {
            const moreBtn = overlay.querySelector<HTMLButtonElement>('#queue-work-more-btn');
            const moreBox = overlay.querySelector<HTMLElement>('#queue-work-more');
            const moreCount = moreBtn?.dataset.count;
            if (moreBtn && moreBox && moreCount) {
                moreBtn.onclick = () => {
                    const open = moreBox.hidden;
                    moreBox.hidden = !open;
                    moreBtn.setAttribute('aria-expanded', String(open));
                    moreBtn.setAttribute('aria-label', open ? L.queueWorkLess : L.queueWorkMoreAria(moreCount));
                    moreBtn.querySelector('.queue-work__more-label')!.textContent = open ? L.queueWorkLess : L.queueWorkMore(moreCount);
                    if (open) moreBtn.scrollIntoView?.({ block: 'nearest' });
                };
            }
            const toOverview = overlay.querySelector<HTMLButtonElement>('#queue-work-overview');
            if (toOverview) {
                toOverview.onclick = () => {
                    this.closeQueueWorkDialog(false);
                    this.showOverviewQueue();
                };
            }
        };
        wireMore();
        // A direction's queue the status carries only in part (its twenty of the whole): its page from the bridge
        // (the main window; the overview's own window keeps what the status says).
        if (line && scope.base && state.features?.includes(QUEUE_PAGE_FEATURE) && lineTotal !== undefined
            && queue.length < Math.min(lineTotal, STATUS_QUEUE_FULL) && overviewMode() !== 'window') {
            void fetchQueuePage(scope.base, { research: line.id, state: 'next' }, 0, STATUS_QUEUE_FULL, undefined, state.features).then(r => {
                if (!r.ok || document.getElementById(DIALOG_ID) !== overlay || r.items.length <= queue.length) return;
                queue = r.items;
                const box = overlay.querySelector('.queue-work__first');
                const html = firstHtml(queue);
                if (box) box.outerHTML = html;
                else overlay.querySelector('.queue-work__opts')?.insertAdjacentHTML('afterend', html);
                wireMore();
            });
        }
        overlay.querySelector<HTMLButtonElement>('#queue-work-close-x')!.onclick = close;
        overlay.querySelector<HTMLButtonElement>('#queue-work-cancel')!.onclick = close;
        // "Opening the agent…" on the button while it is seen (≥ 300 ms), then Now takes the state (3a).
        open.onclick = () => {
            if (overlay.dataset.held === 'true') return;
            const params = queueWorkParams(mode(), count?.value, extra());
            const url = params ? this.activeResearchLink('work', params) : null;
            if (!url) return;
            // The agent chosen is kept for the direction once it starts (spec 126 U10 §2).
            if (line && agents && agent && scope.researchId) rememberLineAgent(scope.researchId, line.id, agent);
            void runBusy(open, async () => {
                this.beginRunWork(url, line?.id);
                await new Promise(resolve => setTimeout(resolve, BUSY_SHOW_MS + BUSY_MIN_MS));
            }, { label: strings.busy.openingAgent, kind: 'queueWork', toastWhenGone: false }).then(() => {
                if (document.getElementById(DIALOG_ID) === overlay) close();
            });
        };
        sync();
        // Focus after the skeleton has wrapped the body (moving a node drops focus).
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        radios.find(r => r.checked)?.focus();
    },

    /**
     * The queue's work (10.2) or a line's run (10.9) started from a device (spec 094 K3.15): what the dialog says,
     * told to the sheet of the start (device-agent-ui.ts); its choice Automatically / Only N asks with its own link.
     */
    startWorkFromDevice(state: QueueWorkState, from: HTMLElement | null, scope: { line?: LiveDirection; researchId?: string }): void {
        const tree = scope.researchId ?? this.activeResearchId();
        if (!tree) return;
        const line = scope.line ?? null;
        const agents = line ? workDialogAgents(state) : null;
        const agentId = line && agents ? lineRunAgent(line, agents, tree) : null;
        const agentName = agentId ? agents?.find(a => a.id === agentId)?.name ?? '' : '';
        const extra = line ? { research: line.id, ...(agentId ? { agent: agentId } : {}) } : {};
        const linkFor = (mode: 'loop' | 'tasks'): string | null => {
            const params = queueWorkParams(mode, WORK_TASKS_DEFAULT, extra);
            const url = params ? researchSchemeUrl('work', { tree, ...params }) : null;
            return url && researchDeviceAgentLink(url) ? url : null;
        };
        const link = linkFor('loop');
        if (!link) return;
        const general = line ? null : generalWorkQueue(state);
        const queue = line ? lineWorkQueue(state, line.id) : general!.queue;
        const tasks = line ? state.queueCounts?.research[line.id] ?? queue.length : general!.total ?? queue.length;
        const first = queueWorkFirst(queue);
        void this.startAgentFromDevice(link, {
            tree, from, ...(line ? { label: line.name } : {}),
            sheet: {
                kind: line ? 'line' : 'queue', tasks, ...(line ? { lineName: line.name } : {}),
                ...(first ? { first: `${first.text} (${first.id})` } : {}), ...(agentName ? { agent: agentName } : {}),
                ...(queueWorkCounted(state) ? { mode: { n: WORK_TASKS_DEFAULT, on: 'loop' as const }, linkFor } : {}),
            },
        }).then(r => {
            // The agent chosen is kept for the line once it starts (spec 126 U10 §2).
            if (line && agentId && (r === 'started' || r === 'waitPc')) rememberLineAgent(tree, line.id, agentId);
        });
    },

    /**
     * A direction's dialog while it stays open (spec 126 U10 §2): once its run cannot start any more (paused,
     * its own run came, the most runs at once reached) "Start" is held and the reason stands above it.
     */
    syncLineRunDialog(s: LiveSession): void {
        const overlay = document.getElementById(DIALOG_ID);
        const id = overlay?.dataset.direction;
        if (!overlay || !id) return;
        const d = s.researches.find(x => x.id === id);
        const offer = d ? this.lineRunOffer(s, d) : null;
        const why = !d ? strings.live.lineRunCannot
            : offer?.kind === 'held' ? offer.why
            : offer?.kind === 'running' ? strings.live.lineRunWorkingMeta(offer.run?.agentName || d.agent || '')
            : !offer ? strings.live.lineRunCannot : '';
        const held = !!why && offer?.kind !== 'starting';
        const was = overlay.dataset.held === 'true';
        if (held === was && (!held || overlay.querySelector('#queue-work-held')?.textContent === why)) return;
        overlay.dataset.held = String(held);
        const note = overlay.querySelector<HTMLElement>('#queue-work-held');
        if (note) {
            note.hidden = !held;
            note.textContent = held ? why : '';
        }
        const open = overlay.querySelector<HTMLButtonElement>('#queue-work-open');
        if (open && !open.hasAttribute('aria-busy')) open.disabled = held;
    },

    /** Close the dialog; `restore`: the focus back to what opened it (or its button in the overview drawn since). */
    closeQueueWorkDialog(restore = true): void {
        const overlay = document.getElementById(DIALOG_ID);
        if (!overlay) return;
        overlay.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        const to = opener;
        opener = null;
        if (!restore) return;
        const successor = ['queue-work-btn', 'research-overview__work'].find(c => to?.classList.contains(c));
        // A direction's button or ⋯ drawn anew since: the same direction's.
        const dir = to?.closest<HTMLElement>('.research-direction[data-direction]')?.dataset.direction ?? to?.dataset.direction;
        const lineTarget = !to?.isConnected && dir ? document.querySelector<HTMLElement>(
            to?.classList.contains('research-direction__run-btn')
                ? `#research-overview .research-direction[data-direction="${CSS.escape(dir)}"] .research-direction__run-btn`
                : `#research-overview .research-direction__more[data-direction="${CSS.escape(dir)}"]`) : null;
        const target = to?.isConnected ? to
            : successor ? document.querySelector<HTMLElement>(`#research-overview .${successor}`) : lineTarget;
        target?.focus({ preventScroll: true });
    },
});
