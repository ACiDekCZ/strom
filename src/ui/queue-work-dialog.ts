/**
 * "Work on the queue…" (spec 052 §5, the research's `work.link` and
 * `run.tasks`, Strom Research 1.32): a button in the overview's Queue heading
 * and an item of the Research menu open a dialog that chooses how the agent
 * works on the queue – automatically (`do=loop`) or only a number of tasks
 * (`do=tasks&n=`) – and opens the research's terminal with that choice. The
 * app starts nothing: the terminal says what runs and asks before it starts.
 *
 * While the research works (`/status.busy`: a session or a run) the action is
 * not offered; the Queue heading says it works instead and leads to Now's
 * "Finish and stop".
 */

import { strings } from '../strings.js';
import {
    RUN_TASKS_FEATURE, WORK_LINK_FEATURE, WORK_TASKS_MAX, WORK_TASKS_MIN, researchLinkMark, workTasksCount,
    type LiveBusy, type LiveQueueItem, type LiveWork, type ResearchLinkParams,
} from '../research-link.js';
import { uiModule } from './module.js';
import { el, liveSession, type LiveSession } from './research-ui.js';
import { overviewMode } from './research-overview-ui.js';
import { normalizeModal } from './modal-skeleton.js';
import { researchActionLabel, setResearchActionLabel } from './research-open-mark.js';

const DIALOG_ID = 'queue-work-modal';
/** "Only [n] tasks" before anything is typed. */
export const WORK_TASKS_DEFAULT = 5;

/** What the research says that the offer and the dialog read (a followed session or the bridge's last status). */
export interface QueueWorkState {
    features?: readonly string[] | null;
    busy?: LiveBusy;
    work?: LiveWork;
    queue: readonly LiveQueueItem[];
}

/** Where the offer stands: none, the action, or "At work ›" in its place. */
export type QueueWorkOffer = 'none' | 'offer' | 'busy';

export interface QueueWorkContext {
    /** The bridge answers now. */
    live: boolean;
    /** The app opens the research's `work` link here (announced, on a computer, not switched off). */
    linkAvailable: boolean;
    /** An archive, a research waiting for its agent, or one whose mode is not known. */
    noAgent: boolean;
    /** The phone's sheet (≤ 640 px or a phone held sideways). */
    phone: boolean;
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
    return researchWorking(state) ? 'busy' : 'offer';
}

/** "Only [n] tasks" is a choice (`run.tasks`); without it only "Automatically". */
export function queueWorkCounted(state: QueueWorkState): boolean {
    return !!state.features?.includes(RUN_TASKS_FEATURE);
}

/** The task that comes first: one set next by hand, else the first of the whole queue, else the first up next. */
export function queueWorkFirst(queue: readonly LiveQueueItem[]): LiveQueueItem | null {
    const next = queue.filter(q => q.state === 'next');
    return next.find(q => q.own === 'next') ?? next.find(q => q.pos === 1) ?? next[0] ?? null;
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

/** The link's parameters for a choice (null: a count out of 1–100). */
export function queueWorkParams(mode: 'loop' | 'tasks', count: unknown): Omit<ResearchLinkParams, 'tree'> | null {
    if (mode === 'loop') return { workDo: 'loop' };
    const n = workTasksCount(count);
    // A string: the overview's own window hands the parameters to the main window as text.
    return n === null ? null : { workDo: 'tasks', n: String(n) };
}

/** HTML-escape text for innerHTML (text and attribute values). */
function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** What opened the dialog: the focus goes back there (the overview's button drawn anew: its successor). */
let opener: HTMLElement | null = null;

export const queueWorkMethods = uiModule({
    /** The offer for a followed session drawn in the overview (the overview's own window too). */
    queueWorkOfferFor(s: LiveSession): QueueWorkOffer {
        return queueWorkOffer(s, {
            live: !s.ended && s.lostSince === null,
            linkAvailable: this.researchLinkAvailable('work'),
            noAgent: this.activeResearchNoAgent(),
            phone: overviewMode() === 'sheet',
        });
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
        if (offer !== 'offer') return null;
        const btn = setResearchActionLabel(el('button', 'queue-work-btn'), L.queueWork, researchLinkMark('work'));
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.onclick = () => this.showQueueWorkDialog(s, btn);
        return btn;
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
        const at = this.queueWorkMenuState();
        return !!at && queueWorkOffer(at.state, {
            live: at.live,
            linkAvailable: this.researchLinkAvailable('work'),
            noAgent: this.activeResearchNoAgent(),
            phone: overviewMode() === 'sheet',
        }) === 'offer';
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
        this.closeQueueWorkDialog(false);
        const L = strings.live;
        opener = from;
        const counted = queueWorkCounted(state);
        const noGate = !!state.work && state.work.gate === null;
        const first = queueWorkFirst(state.queue);
        const session = queueWorkSessionLine(state.work);
        const n0 = WORK_TASKS_DEFAULT;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = DIALOG_ID;
        overlay.innerHTML = `
            <div class="modal modal--sm queue-work" role="dialog" data-dialog-kind="choice" aria-modal="true" aria-labelledby="queue-work-title">
                <div class="modal-header">
                    <h2 id="queue-work-title">${esc(L.queueWorkTitle)}</h2>
                    <button type="button" class="close-btn" id="queue-work-close-x" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="queue-work__opts" role="radiogroup" aria-labelledby="queue-work-title">
                    <label class="queue-work__opt">
                        <input type="radio" name="queue-work-mode" value="loop" checked aria-labelledby="queue-work-auto" aria-describedby="queue-work-auto-hint${noGate ? ' queue-work-nogate' : ''}">
                        <span class="queue-work__opt-body">
                            <span class="queue-work__opt-title" id="queue-work-auto">${esc(L.queueWorkAuto)}</span>
                            <span class="queue-work__opt-hint" id="queue-work-auto-hint">${esc(L.queueWorkAutoHint)}</span>
                            ${noGate ? `<span class="queue-work__nogate" id="queue-work-nogate">${esc(L.queueWorkNoGate)}</span>` : ''}
                        </span>
                    </label>
                    ${counted ? `
                    <label class="queue-work__opt">
                        <input type="radio" name="queue-work-mode" value="tasks" aria-label="${esc(`${L.queueWorkOnly} ${n0} ${L.queueWorkOnlyWord(n0)}`)}" aria-describedby="queue-work-only-hint">
                        <span class="queue-work__opt-body">
                            <span class="queue-work__opt-title" id="queue-work-only">${esc(L.queueWorkOnly)} <input type="number" class="queue-work__count" id="queue-work-count" inputmode="numeric" min="${WORK_TASKS_MIN}" max="${WORK_TASKS_MAX}" step="1" value="${n0}" aria-label="${esc(L.queueWorkCountAria)}"> <span class="queue-work__word">${esc(L.queueWorkOnlyWord(n0))}</span></span>
                            <span class="queue-work__opt-hint" id="queue-work-only-hint">${esc(L.queueWorkOnlyHint(n0))}</span>
                        </span>
                    </label>` : ''}
                </div>
                ${first || session ? `
                <div class="queue-work__first">
                    ${first ? `<div class="queue-work__first-label">${esc(L.queueWorkFirst)}</div>
                    <div class="queue-work__first-task"><strong>${esc(first.id)}</strong> ${esc(first.text)}</div>` : ''}
                    ${session ? `<div class="queue-work__session">${esc(session)}</div>` : ''}
                </div>` : ''}
                <div class="buttons queue-work__foot">
                    <p class="queue-work__confirm">${esc(L.queueWorkConfirm)}</p>
                    <button type="button" class="secondary" id="queue-work-cancel" data-dismiss>${esc(strings.buttons.cancel)}</button>
                    <button type="button" class="primary" id="queue-work-open">${researchActionLabel(L.queueWorkOpenTerm, researchLinkMark('work'))}</button>
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
            open.disabled = queueWorkParams(mode(), count?.value) === null;
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
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        overlay.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            close();
        });
        overlay.querySelector<HTMLButtonElement>('#queue-work-close-x')!.onclick = close;
        overlay.querySelector<HTMLButtonElement>('#queue-work-cancel')!.onclick = close;
        open.onclick = () => {
            const params = queueWorkParams(mode(), count?.value);
            const url = params ? this.activeResearchLink('work', params) : null;
            if (!url) return;
            close();
            this.launchResearchLink(url, 'agent');
        };
        sync();
        // Focus after the skeleton has wrapped the body (moving a node drops focus).
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        radios.find(r => r.checked)?.focus();
    },

    /** Close the dialog; `restore`: the focus back to what opened it (or the Queue's button drawn since). */
    closeQueueWorkDialog(restore = true): void {
        const overlay = document.getElementById(DIALOG_ID);
        if (!overlay) return;
        overlay.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        const to = opener;
        opener = null;
        if (!restore) return;
        const target = to?.isConnected ? to
            : to?.classList.contains('queue-work-btn') ? document.querySelector<HTMLElement>('#research-overview .queue-work-btn') : null;
        target?.focus({ preventScroll: true });
    },
});
