/**
 * The agent's work started from a device of the home network (spec 094 K3.15,
 * D13–D14): every link of the agent's work goes on a device through one flow,
 * `startAgentFromDevice(link, ctx)`, never to the system as a
 * `strom-research://` link (a phone opens nothing with it).
 *
 * The flow asks the gateway without a `yes` first (`POST device/agent {link}`):
 * - `ask` — the confirmation: a sheet from below on a phone, a dialog with the
 *   same content on a tablet (10.2 the queue, 10.9 a line's run, 10.10 a
 *   conversation): the app's own texts, where the terminal opens, the AI badge
 *   with what it uses and the research's lines under it (`ask.note`). Back
 *   sends nothing; the primary button (with its mark) sends the `yes`. The
 *   queue's Automatically / Only N asks again with its new link;
 * - `started`, `computer`, `said` and the refusals — no sheet: the start's
 *   state is noted (device-agent.ts) and said (a toast unless the caller draws
 *   the state itself, `quiet`);
 * - a `yes` that holds no more (410) — asked again, a new sheet.
 * One flow per tree at a time: a second tap sends nothing.
 *
 * This module must never reach the tree (DataManager), the renderer or the
 * person picker, even through another module (device-research-imports.test.ts).
 */

import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import {
    DEVICE_COMPUTER_ONLY_EVENT, RESEARCH_LINK_ACTIONS, noteResearchDeviceRefused, researchDeviceState, researchUrlMark,
    type ResearchActionMark, type ResearchDeviceAction,
} from '../research-link.js';
import {
    applyDeviceAgentResult, deviceAgentLinkOk, deviceAgentStart, deviceAgentStartOf,
    type DeviceAgentAsk, type DeviceAgentNext, type DeviceAgentResult,
} from '../device/device-agent.js';
import { computerLabelOf, pairingNow } from '../device/device-store.js';
import { researchActionLabel } from './research-open-mark.js';
import { researchOpenSvg } from '../history-symbols.js';
import { normalizeModal } from './modal-skeleton.js';

const SHEET_ID = 'device-agent-sheet';

// ——— the sheet's content (a pure model, unit-tested) ———

/** What a sheet confirms: the queue's work (10.2), a line's run (10.9), a conversation (10.10), other work of the agent. */
export type DeviceAgentSheetKind = 'queue' | 'line' | 'chat' | 'other';

/** The queue's choice: automatically (`do=loop`) or only `n` tasks (`do=tasks&n=`). */
export type DeviceAgentMode = 'loop' | 'tasks';

/** What the caller knows of the work before the research says its question. */
export interface DeviceAgentSheetInfo {
    /** Default: by the link (`work` the queue, `work&research=` a line, `chat` / `task` / `conflict` a conversation). */
    kind?: DeviceAgentSheetKind;
    /** The heading (default: the queue's or a line's own; the research's question for the rest). */
    title?: string;
    /** The line under it (default: the tree and the tasks in the queue; a line's name and its tasks). */
    sub?: string;
    /** The tasks in the queue (a line's queue) for the line under the heading. */
    tasks?: number;
    /** A line's name. */
    lineName?: string;
    /** "First up: …" — the task the agent takes first. */
    first?: string;
    /** A line's agent (its name; absent: the default). */
    agent?: string;
    /** The segment Automatically / Only N: N, and which one is chosen. */
    mode?: { n: number; on: DeviceAgentMode };
    /** The link of each choice of the segment (a new choice is asked anew). */
    linkFor?: (mode: DeviceAgentMode) => string | null;
}

export type DeviceAgentRowIcon = 'terminal' | 'ai' | 'agent' | 'note' | 'stop';

export interface DeviceAgentSheetRow {
    icon: DeviceAgentRowIcon;
    text: string;
    /** A part of `text` set in bold (the computer's name). */
    strong?: string;
}

export interface DeviceAgentSheetModel {
    kind: DeviceAgentSheetKind;
    title: string;
    sub: string;
    seg: { auto: string; only: string; on: DeviceAgentMode } | null;
    first: string | null;
    rows: DeviceAgentSheetRow[];
    back: string;
    primary: string;
    mark: ResearchActionMark;
}

/** The sheet's kind by its link, when the caller does not say it. */
export function deviceAgentSheetKindOf(link: string): DeviceAgentSheetKind {
    const m = /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/([a-z-]+)(?:\?(.*))?$/.exec(link.trim());
    if (!m) return 'other';
    const q = new URLSearchParams(m[2] ?? '');
    if (m[1] === 'work') return q.get('research') ? 'line' : 'queue';
    if (m[1] === 'chat' || (m[1] === 'task' && q.get('do') === 'chat') || (m[1] === 'conflict' && q.get('do') === 'agent')) return 'chat';
    return 'other';
}

/** The default heading of a conversation by its link: a task talked over, a conflict left to the agent, a line's work. */
function chatTitle(link: string, ask: DeviceAgentAsk): string {
    const m = /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/([a-z-]+)(?:\?(.*))?$/.exec(link.trim());
    const q = new URLSearchParams(m?.[2] ?? '');
    if (m?.[1] === 'task') return strings.live.waitingTask.discuss;
    if (m?.[1] === 'conflict') return strings.research.leaveToAgent;
    if (m?.[1] === 'chat' && q.get('research')) return strings.live.dirWork;
    return ask.what;
}

/** The "Only N tasks" segment's label. */
export function deviceAgentOnlyLabel(n: number): string {
    const L = strings.live;
    return `${L.queueWorkOnly} ${n} ${L.queueWorkOnlyWord(n)}`;
}

/**
 * The sheet's content (10.2, 10.9, 10.10): the app's own heading and texts, where the terminal opens (on `pc`), the
 * AI badge with what it uses and the research's lines under it (`ask.note`, its language), how to stop the queue's
 * work; Back and the primary "Start on {pc}" ("Open on {pc}" for a conversation) with the link's mark.
 */
export function deviceAgentSheetModel(info: DeviceAgentSheetInfo, ask: DeviceAgentAsk, pc: string, link: string): DeviceAgentSheetModel {
    const A = strings.deviceAgent;
    const L = strings.live;
    const kind = info.kind ?? deviceAgentSheetKindOf(link);
    const tasks = typeof info.tasks === 'number' && Number.isFinite(info.tasks) && info.tasks >= 0 ? Math.floor(info.tasks) : null;
    const where = (text: string): DeviceAgentSheetRow => ({ icon: 'terminal', text, ...(pc ? { strong: pc } : {}) });
    const rows: DeviceAgentSheetRow[] = [];
    let title: string;
    let sub: string;
    switch (kind) {
        case 'queue':
            title = info.title ?? L.queueWorkTitle;
            sub = info.sub ?? (tasks !== null ? A.queueSub(ask.tree, tasks) : ask.tree);
            rows.push(where(A.where(pc)));
            break;
        case 'line': {
            const name = info.lineName ?? '';
            title = info.title ?? L.lineRunKicker;
            sub = info.sub ?? (name && tasks !== null ? A.queueSub(name, tasks) : name || ask.tree);
            rows.push(where(A.whereLine(pc)), { icon: 'agent', text: `${L.lineRunAgent}: ${info.agent || L.lineRunAgentDefault}` });
            break;
        }
        case 'chat':
            title = info.title ?? chatTitle(link, ask);
            sub = info.sub ?? ask.tree;
            rows.push(where(A.whereChat(pc)));
            break;
        default:
            title = info.title ?? ask.what;
            sub = info.sub ?? ask.tree;
            rows.push(where(A.where(pc)));
            break;
    }
    rows.push({ icon: 'ai', text: A.cost });
    for (const note of ask.note) rows.push({ icon: 'note', text: note });
    if (kind === 'queue') rows.push({ icon: 'stop', text: A.stopHow });
    const seg = info.mode && info.linkFor && (kind === 'queue' || kind === 'line')
        ? { auto: L.queueWorkAuto, only: deviceAgentOnlyLabel(info.mode.n), on: info.mode.on } : null;
    return {
        kind, title, sub, seg,
        first: info.first ? `${L.queueWorkFirst}: ${info.first}` : null,
        rows,
        back: A.back,
        primary: kind === 'chat' ? A.openOn(pc) : A.startOn(pc),
        mark: researchUrlMark(link) ?? 'agent',
    };
}

// ——— what the flow ends with ———

/**
 * How a start from the device ended: started (the terminal opens; its proof in the glance follows), waiting at the
 * computer, not started (said why), cancelled (Back), refused as the computer's only, a general error, or nothing
 * done because a flow of the same tree is on its way (a second tap).
 */
export type DeviceAgentFlowResult = 'started' | 'waitPc' | 'notStarted' | 'cancelled' | 'refused' | 'error' | 'busy';

export interface DeviceAgentCtx {
    /** The research's tree (the tunnel's tree, the link's `tree=`); default: the link's. */
    tree?: string;
    /** The computer's name for the texts; default: the pairing's. */
    pc?: string;
    /** What the sheet says (see DeviceAgentSheetInfo). */
    sheet?: DeviceAgentSheetInfo;
    /** What the row of Now says of the start (a line's name, a task's text). */
    label?: string;
    /** The runs seen before the start (a new run proves it); default: the last glance's. */
    runsBefore?: readonly string[];
    /** The element that started it (busy meanwhile, the focus back there after Back). */
    from?: HTMLElement | null;
    /** The caller draws the start's state itself (the Research screen's Now): no toast of it. */
    quiet?: boolean;
}

/** The trees with a flow on their way (a second tap does nothing). */
const flows = new Set<string>();

/** The link's `tree=`. */
function linkTree(link: string): string | null {
    const m = /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/[a-z-]+\?(.*)$/.exec(link.trim());
    return m ? new URLSearchParams(m[1]).get('tree') : null;
}

/** The action a `403 device.computer-only` names (`link.<action>`), as the device hides it. */
export function deviceAgentRefusedAction(action: string | undefined, link: string): ResearchDeviceAction | null {
    const a = action?.startsWith('link.') ? action.slice(5) : /^strom-research(?:-[a-z0-9-]{1,32})?:\/\/([a-z-]+)/.exec(link)?.[1] ?? '';
    if (a === 'conflict') return 'conflict-agent';
    return (RESEARCH_LINK_ACTIONS as readonly string[]).includes(a) ? a as ResearchDeviceAction : null;
}

/** The computer's name: the caller's, else the pairing's, else the device's state. */
function pcName(ctx: DeviceAgentCtx): string {
    return ctx.pc || computerLabelOf(pairingNow()?.computer) || researchDeviceState()?.computer || '';
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A text with its `strong` part in bold (escaped both). */
function rowTextHtml(row: DeviceAgentSheetRow): string {
    const i = row.strong ? row.text.indexOf(row.strong) : -1;
    if (i < 0 || !row.strong) return esc(row.text);
    return `${esc(row.text.slice(0, i))}<b>${esc(row.strong)}</b>${esc(row.text.slice(i + row.strong.length))}`;
}

const TERMINAL_SVG = researchOpenSvg(16);
const STOP_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"'
    + ' stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>';

function rowIconHtml(icon: DeviceAgentRowIcon): string {
    switch (icon) {
        case 'terminal': return TERMINAL_SVG;
        case 'stop': return STOP_SVG;
        case 'ai': return `<span class="research-ai-badge device-agent__ai">${esc(strings.research.aiBadge)}</span>`;
        case 'agent': return '◦';
        default: return '';
    }
}

/** The sheet's body: the segment, "First up", the rows. */
function bodyHtml(m: DeviceAgentSheetModel): string {
    const seg = m.seg ? `<div class="sel-seg device-agent__seg" role="radiogroup" aria-labelledby="device-agent-title">`
        + (['loop', 'tasks'] as const).map(v => {
            const on = m.seg!.on === v;
            return `<button type="button" class="sel-opt device-agent__seg-opt" data-sel-form="seg" role="radio" data-mode="${v}"`
                + ` aria-checked="${on}" tabindex="${on ? 0 : -1}">${esc(v === 'loop' ? m.seg!.auto : m.seg!.only)}</button>`;
        }).join('') + '</div>' : '';
    const first = m.first ? `<p class="device-agent__first">${esc(m.first)}</p>` : '';
    const rows = m.rows.map(r => `<div class="device-agent__row device-agent__row--${r.icon}"><span class="device-agent__icon" aria-hidden="true">${rowIconHtml(r.icon)}</span>`
        + `<span class="device-agent__text">${r.icon === 'ai' ? `<span class="research-open-sr">${esc(strings.research.aiBadge)}: </span>` : ''}${rowTextHtml(r)}</span></div>`).join('');
    return `${seg}${first}<div class="device-agent__rows">${rows}</div>`;
}

/** What the person did in the sheet. */
type SheetAct = { act: 'back' } | { act: 'go' } | { act: 'mode'; mode: DeviceAgentMode };

interface SheetHandle {
    /** The next act (each act once; a busy sheet takes none). */
    next(): Promise<SheetAct>;
    /** Its content anew (a new question: a new choice, a new `yes`). */
    update(m: DeviceAgentSheetModel): void;
    /** Asking meanwhile: its buttons do nothing. */
    busy(on: boolean): void;
    close(): void;
}

export const deviceAgentMethods = uiModule({
    /**
     * The browser tests' way to the flow before the Research screen draws its buttons (only in the device mode,
     * called once the device is paired): `__stromDeviceAgent.start(link, ctx)`.
     */
    exposeDeviceAgentForTests(): void {
        (globalThis as Record<string, unknown>).__stromDeviceAgent = {
            start: (link: string, ctx?: DeviceAgentCtx) => this.startAgentFromDevice(link, ctx),
            state: (tree: string) => deviceAgentStartOf(tree),
        };
    },

    /**
     * The agent's link started from this device through the gateway (D13): asked without `yes`, the sheet for an
     * `ask`, else the start's state noted at once. The flow's end says how it ended.
     */
    async startAgentFromDevice(link: string, ctx: DeviceAgentCtx = {}): Promise<DeviceAgentFlowResult> {
        const tree = ctx.tree ?? linkTree(link);
        if (!tree || !deviceAgentLinkOk(link)) return 'error';
        if (flows.has(tree)) return 'busy';
        flows.add(tree);
        const from = ctx.from ?? null;
        from?.setAttribute('aria-busy', 'true');
        try {
            return await this.deviceAgentFlow(tree, link, ctx);
        } finally {
            flows.delete(tree);
            from?.removeAttribute('aria-busy');
        }
    },

    /** The flow of one start (startAgentFromDevice holds the tree meanwhile). */
    async deviceAgentFlow(tree: string, first: string, ctx: DeviceAgentCtx): Promise<DeviceAgentFlowResult> {
        const pc = pcName(ctx);
        const info: DeviceAgentSheetInfo = { ...(ctx.sheet ?? {}) };
        let link = first;
        const note = (yesSent = false) => ({ link, ...(ctx.label ? { label: ctx.label } : {}), ...(ctx.runsBefore ? { runsBefore: ctx.runsBefore } : {}), yesSent });
        /** Asked without `yes` (once more when the answer was lost on the way). */
        const dry = async (): Promise<{ result: DeviceAgentResult; next: DeviceAgentNext }> => {
            let result = await deviceAgentStart(tree, link);
            let next = applyDeviceAgentResult(tree, note(), result);
            if (next === 'askAgain') {
                result = await deviceAgentStart(tree, link);
                next = applyDeviceAgentResult(tree, note(), result);
                if (next === 'askAgain') next = 'error';
            }
            return { result, next };
        };
        let { result, next } = await dry();
        if (next !== 'ask' || !result.ok || result.answer.state !== 'ask') return this.deviceAgentEnded(tree, link, result, next, ctx, pc);
        let ask = result.answer;
        const model = (): DeviceAgentSheetModel => deviceAgentSheetModel(info, ask.ask, pc, link);
        const sheet = this.openDeviceAgentSheet(model(), ctx.from ?? null);
        for (;;) {
            const act = await sheet.next();
            if (act.act === 'back') {
                sheet.close();
                return 'cancelled';
            }
            if (act.act === 'mode') {
                const other = info.linkFor?.(act.mode) ?? null;
                if (!other || !info.mode) continue;
                info.mode = { ...info.mode, on: act.mode };
                link = other;
            }
            sheet.busy(true);
            if (act.act === 'go') {
                result = await deviceAgentStart(tree, link, ask.yes);
                next = applyDeviceAgentResult(tree, note(true), result);
                // The yes held no more (410): asked again, a new question.
                if (next === 'askAgain') ({ result, next } = await dry());
            } else {
                ({ result, next } = await dry());
            }
            if (next === 'ask' && result.ok && result.answer.state === 'ask') {
                ask = result.answer;
                sheet.update(model());
                sheet.busy(false);
                continue;
            }
            sheet.close();
            return this.deviceAgentEnded(tree, link, result, next, ctx, pc);
        }
    },

    /** The flow's end without a sheet (or after it): the state noted is said, a refusal or an error too. */
    deviceAgentEnded(tree: string, link: string, result: DeviceAgentResult, next: DeviceAgentNext, ctx: DeviceAgentCtx, pc: string): DeviceAgentFlowResult {
        const A = strings.deviceAgent;
        if (next === 'refused') {
            const action = deviceAgentRefusedAction(result.ok ? undefined : result.action, link);
            if (action) noteResearchDeviceRefused(action);
            // The page says it as for any action refused here (device-mode-ui: the toast, the menus drawn again).
            window.dispatchEvent(new CustomEvent(DEVICE_COMPUTER_ONLY_EVENT, { detail: { action } }));
            return 'refused';
        }
        const start = next === 'noted' ? deviceAgentStartOf(tree) : null;
        if (!start) {
            this.showToast(A.failed, 6000, { closable: true, kind: 'device-agent' });
            return 'error';
        }
        const say = (text: string, ms = 6000): void => {
            if (!ctx.quiet) this.showToast(text, ms, { closable: true, kind: 'device-agent' });
        };
        switch (start.state) {
            case 'starting':
            case 'running':
                say(start.noConfirm ? `${A.startingSub(pc)} ${A.noConfirm(pc)}` : start.kind === 'chat' ? A.whereChat(pc) : A.startingSub(pc));
                return 'started';
            case 'waitPc':
                say(`${A.waitPc(pc)} ${A.waitPcSub}`, 8000);
                return 'waitPc';
            case 'notStarted':
                say(start.why === 'said' && start.text ? start.text
                    : start.why === 'noTerminal' ? A.noTerminal(pc)
                    : start.why === 'researchNewer' ? A.researchNewer
                    : A.down(pc), 8000);
                return 'notStarted';
        }
    },

    /** The confirmation: a sheet from below on a phone, a dialog with the same content elsewhere (a tablet). */
    openDeviceAgentSheet(first: DeviceAgentSheetModel, from: HTMLElement | null): SheetHandle {
        document.getElementById(SHEET_ID)?.remove();
        const phone = (() => { try { return window.matchMedia(MQ_PHONE_BAR).matches; } catch { return false; } })();
        let m = first;
        const overlay = document.createElement('div');
        overlay.id = SHEET_ID;
        overlay.className = phone ? 'bottom-sheet-overlay device-agent-overlay' : 'modal-overlay active device-agent-overlay';
        const box = phone ? 'bottom-sheet device-agent device-agent--sheet' : 'modal modal--sm device-agent device-agent--dialog';
        overlay.innerHTML = `<div class="${box}" role="dialog" aria-modal="true" aria-labelledby="device-agent-title" aria-describedby="device-agent-sub">`
            + (phone ? '<div class="bottom-sheet-handle" aria-hidden="true"></div>' : '')
            + `<div class="${phone ? '' : 'modal-header '}device-agent__head"><div class="device-agent__titles">`
            + '<h2 class="device-agent__title" id="device-agent-title"></h2><p class="device-agent__sub" id="device-agent-sub"></p></div></div>'
            + '<div class="device-agent__body"></div>'
            + '<div class="buttons device-agent__foot">'
            + '<button type="button" class="secondary device-agent__back" id="device-agent-back"></button>'
            + '<button type="button" class="primary device-agent__go" id="device-agent-go"></button></div></div>';
        document.body.appendChild(overlay);
        this.pushDialog(SHEET_ID);
        const dialog = overlay.firstElementChild as HTMLElement;
        if (!phone) normalizeModal(dialog);
        const back = overlay.querySelector<HTMLButtonElement>('#device-agent-back')!;
        const go = overlay.querySelector<HTMLButtonElement>('#device-agent-go')!;
        let busy = false;
        let closed = false;
        let waiting: ((a: SheetAct) => void) | null = null;
        const acts: SheetAct[] = [];
        const act = (a: SheetAct): void => {
            if (closed || (busy && a.act !== 'back')) return;
            // One go per question: a second tap while it is sent does nothing.
            if (a.act !== 'back') busy = true;
            if (waiting) {
                const w = waiting;
                waiting = null;
                w(a);
            } else acts.push(a);
        };
        const draw = (): void => {
            overlay.querySelector('#device-agent-title')!.textContent = m.title;
            const sub = overlay.querySelector<HTMLElement>('#device-agent-sub')!;
            sub.textContent = m.sub;
            sub.hidden = !m.sub;
            overlay.querySelector('.device-agent__body')!.innerHTML = bodyHtml(m);
            back.textContent = m.back;
            go.innerHTML = researchActionLabel(m.primary, m.mark);
            const opts = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.device-agent__seg-opt'));
            const pick = (b: HTMLButtonElement): void => {
                const mode = b.dataset.mode === 'tasks' ? 'tasks' : 'loop';
                if (m.seg?.on === mode) return;
                for (const x of opts) {
                    const on = x === b;
                    x.setAttribute('aria-checked', String(on));
                    x.tabIndex = on ? 0 : -1;
                }
                act({ act: 'mode', mode });
            };
            for (const b of opts) {
                b.onclick = () => pick(b);
                b.onkeydown = (e) => {
                    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                    if (!step) return;
                    e.preventDefault();
                    const target = opts[(opts.indexOf(b) + step + opts.length) % opts.length];
                    target.focus();
                    pick(target);
                };
            }
        };
        const setBusy = (on: boolean): void => {
            busy = on;
            dialog.setAttribute('aria-busy', String(on));
            go.setAttribute('aria-disabled', String(on));
            for (const b of overlay.querySelectorAll<HTMLButtonElement>('.device-agent__seg-opt')) b.setAttribute('aria-disabled', String(on));
        };
        draw();
        back.onclick = () => act({ act: 'back' });
        go.onclick = () => act({ act: 'go' });
        overlay.onclick = (e) => { if (e.target === overlay) act({ act: 'back' }); };
        overlay.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            act({ act: 'back' });
        });
        // The sheet slides up from its first frame (the backdrop fades in).
        if (phone) requestAnimationFrame(() => overlay.classList.add('active'));
        (overlay.querySelector<HTMLElement>('.device-agent__seg-opt[aria-checked="true"]') ?? go).focus({ preventScroll: true });
        return {
            next: () => new Promise<SheetAct>((resolve) => {
                const queued = acts.shift();
                if (queued) resolve(queued);
                else waiting = resolve;
            }),
            update: (next) => {
                m = next;
                const focused = document.activeElement?.closest('.device-agent__seg-opt') ? (document.activeElement as HTMLElement).dataset.mode : null;
                draw();
                const again = focused ? overlay.querySelector<HTMLElement>(`.device-agent__seg-opt[data-mode="${focused}"]`) : null;
                (again ?? go).focus({ preventScroll: true });
            },
            busy: setBusy,
            close: () => {
                if (closed) return;
                closed = true;
                overlay.remove();
                this.dialogStack = this.dialogStack.filter(d => d !== SHEET_ID);
                if (from?.isConnected) from.focus({ preventScroll: true });
            },
        };
    },
});
