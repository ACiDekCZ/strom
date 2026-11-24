/**
 * "Research on" (spec 064): a switch per research tree (the research panel,
 * the tree manager) that shows whether its bridge runs and switches it off
 * (`POST /live {"do": "stop"}`, feature `live.stop`) or on (the link
 * `live?tree=…&do=start`, feature `live.start`: no window, no terminal, so no
 * mark); and Settings' choice for the computer how long a bridge stays on
 * without work (`POST /live {"idleMinutes"}`, feature `live.idle`).
 *
 * Without a feature the switch only shows the state and says the command for
 * the terminal; nothing is sent. While the bridge is off its features are
 * those it last said: only when they are the research's word as it is now
 * (`liveFeaturesWord`: said with its version, nothing newer known) does a
 * missing `live.start` leave only the command; unknown or out of date (an
 * update since), the start link is offered (an older research knows `live`
 * as well) and its answer says the features. Phones and tablets have no switch (the
 * research runs on a computer). The state is the bridge's real one: it answers
 * (on) or not (off); how it ended is remembered per research for the text.
 *
 * The idle panel's slot while the research is off (`start`) has no switch:
 * a "Switch on" button (the same link) and under it the one command for the
 * terminal, in case the link does nothing.
 *
 * Every switch is drawn into a slot (`[data-research-live]`): the panels and
 * the manager place one, and each answer of a bridge redraws the slots whose
 * state changed (in place, so focus stays).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { storedResearchBridge, announcedResearchScheme } from '../research-device.js';
import {
    LIVE_IDLE_FEATURE, LIVE_START_FEATURE, LIVE_STOP_FEATURE, parseLiveBridge, researchSchemeUrl, type LiveStatus,
} from '../research-link.js';
import {
    LIVE_IDLE_FOREVER, LIVE_IDLE_TWO_HOURS, liveEndKind, liveFeaturesWord, noteLiveEnded, noteLiveStatus, postLiveIdle, postLiveStop,
    storedLiveState, type LiveWriteRefusal,
} from '../research-live.js';
import { el, researchHere } from './research-ui.js';
import { startPend, endPend, dropPend, pendOf, applyPend, pendStatusEl } from './switch-pend.js';
import { busySpinHtml } from './busy.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';
import {
    noteQueueStartStatus, queueStartOf, queueStartsOf, retryQueueStart, runStartProven, startQueueWork, QUEUE_SCOPE, QUEUE_START_MS, type QueueStartView,
} from './queue-start.js';
import { runLinesOn } from '../research-runs.js';
import { overviewChanged, overviewInWindow } from '../windows/overview-window.js';
import type { TreeId } from '../types.js';

/** How often a switch asks its bridge while it waits for it to go or come (ms), and for how long at most. */
const CONFIRM_EVERY_MS = 1500;
const STOP_CONFIRM_MS = 20_000;
const START_CONFIRM_MS = 30_000;
const ASK_TIMEOUT_MS = 3000;

/** A switch on its way (switching off or on) — until the bridge's answer says it went. */
interface Pending {
    kind: 'stopping' | 'starting';
    until: number;
}

/** A word under a switch after a click (a failure, or the command where the switch cannot do it). */
interface SwitchNote {
    text: string;
    command?: string;
    /** The state it was said in (on or off): a change of the state takes it away. */
    on: boolean;
    /** A refusal or a limit passed (6.1): said as an alert when first drawn, with "Try again". */
    retry?: boolean;
}

const pending = new Map<string, Pending>();
const notes = new Map<string, SwitchNote>();
/** The refusals already said (an alert once: a redraw does not say it again). */
const noteSaid = new WeakSet<SwitchNote>();

/** The key of a switch's write state (6.1, switch-pend). */
function pendKey(researchId: string): string {
    return `live:${key(researchId)}`;
}

/** A switch on its way: on (or off) at once, dashed and locked, its words after 120 ms, "Waiting for the research" after 5 s. */
function setPending(researchId: string, kind: Pending['kind'], ms: number, redraw: () => void, onLimit: () => void): void {
    pending.set(key(researchId), { kind, until: Date.now() + ms });
    const L = strings.researchLive;
    startPend(pendKey(researchId), { label: kind === 'stopping' ? L.stopping : L.starting, limitMs: ms, onLimit, redraw });
}

/** The switch at rest again (its answer came, or its time passed). */
function clearPending(researchId: string): void {
    pending.delete(key(researchId));
    dropPend(pendKey(researchId));
}
/** Settings' choice being written (6.1: the chosen one dashed, the radios locked until the bridge answers). */
let idleWriting = false;
/** The choice on its way (shown chosen meanwhile). */
let idleSending: number | null = null;
let idleNote = '';
const IDLE_PEND = 'live:idle';

const COMMAND_START = 'strom live start';
const COMMAND_STOP = 'strom live stop';
const idleCommand = (minutes: number): string => `strom config set live.idleMinutes ${minutes}`;

/** What a switch shows now (null: no switch — not known, refused by the browser, a phone). */
interface SwitchState {
    on: boolean;
    pending: Pending['kind'] | null;
    /** The words of a switch on its way (empty before 120 ms). */
    pendWords: string;
    canStop: boolean;
    canStart: boolean;
    ended: 'stopped' | 'idle' | null;
    note: SwitchNote | null;
}

function key(id: string): string {
    return id.toLowerCase();
}

function bridgeBase(researchId: string): string | null {
    return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null;
}

function refusalText(r: LiveWriteRefusal): string {
    const L = strings.researchLive;
    if (r.code === 'busy') return L.busy;
    if (r.code === 'network') return L.noAnswer;
    return r.reason;
}

/** A command for the terminal with a small "Copy" beside it. */
export function commandLine(command: string, onCopy: (cmd: string) => void, label?: string): HTMLElement {
    const line = el('span', 'research-live-command');
    if (label) line.appendChild(el('span', 'research-live-command-label', label));
    line.appendChild(el('code', undefined, command));
    const copy = el('button', 'link-button research-live-copy', strings.researchLive.copy);
    copy.type = 'button';
    copy.onclick = (e) => {
        e.stopPropagation();
        onCopy(command);
    };
    line.appendChild(copy);
    return line;
}

export const researchLiveMethods = uiModule({
    /** Keep what a bridge says for its switch while it is off, and redraw the switches (once, at start). */
    initResearchLive(): void {
        onBridgeStatus((researchId: string, status: LiveStatus) => {
            // A session or a run at work ends the start of the queue's work (its row takes the place).
            noteQueueStartStatus(researchId, status);
            // With its version and a newer research out: the remembered features are its word only while nothing newer is known.
            noteLiveStatus(researchId, status);
            const p = pending.get(key(researchId));
            if (p?.kind === 'starting') clearPending(researchId);
            this.refreshResearchLiveSwitches();
        });
    },

    // ==================== STARTING THE QUEUE'S WORK (waiting buttons §3.2) ====================

    /**
     * "Open terminal" of "Work on the queue" (`scope` absent) or "Start" of a direction's own run (`scope`: its
     * id, spec 126 U10): the link handed over quietly (Now says the state, queue-start.ts), its proof the link's
     * handoff or the run of the scope at work (an older research: a session or a run), at most 30 s.
     */
    beginRunWork(url: string, scope?: string): void {
        const rid = this.activeResearchId();
        if (!rid) return;
        const at = this.queueWorkMenuState()?.state as { working?: readonly unknown[]; features?: readonly string[] | null } | undefined;
        // An older research where someone works already: no session can prove this start, the link's own state says it
        // (a toast). With runs side by side (`run.lines`) the start always shows in Now.
        if (!runLinesOn(at?.features) && (at?.working?.length ?? 0) > 0) {
            void this.launchResearchLink(url, 'agent', document.createElement('span'), { timeoutMs: QUEUE_START_MS });
            return;
        }
        const sc = scope ?? QUEUE_SCOPE;
        // Now says the state where the overview is seen (here or in its own window); without it a toast does.
        const shown = overviewInWindow() || (document.getElementById('research-overview')?.getClientRects().length ?? 0) > 0;
        startQueueWork(rid, {
            launch: ({ limitMs, onLateProof }) => this.launchResearchLink(url, 'agent', document.createElement('span'), {
                timeoutMs: limitMs, quiet: shown, onLateProof, proof: (st) => runStartProven(st, sc),
            }),
            changed: () => {
                this.renderLivePanel();
                overviewChanged();
            },
        }, Date.now(), sc);
    },

    /** The start of the open tree's queue work as Now draws it (null: none). */
    queueStartNow(): QueueStartView | null {
        return queueStartOf(this.activeResearchId());
    },

    /** Every start of the open tree's work, the general run's (scope 'queue') and the directions' runs (their ids). */
    runStartsNow(): Array<{ scope: string; view: QueueStartView }> {
        return queueStartsOf(this.activeResearchId());
    },

    /** Try again after "Did the queue work not start?" (`scope`: a direction's run). */
    retryQueueWork(scope?: string): void {
        const rid = this.activeResearchId();
        if (rid) retryQueueStart(rid, scope ?? QUEUE_SCOPE);
    },

    /** The bridge's `end` event (followed): how it ended, kept for the switch's text. */
    noteResearchLiveEnd(researchId: string, reason: string, by?: 'app'): void {
        const kind = liveEndKind(reason);
        if (!kind) return;
        noteLiveEnded(researchId, kind, by);
        if (pending.get(key(researchId))?.kind === 'stopping') clearPending(researchId);
        this.refreshResearchLiveSwitches();
    },

    /** A tree's switch state (null: no switch here). */
    researchLiveState(treeId: string): SwitchState | null {
        if (!researchHere() || DataManager.isViewMode()) return null;
        const link = TreeManager.getTreeMetadata(treeId as TreeId)?.research;
        if (!link?.id || link.copy || !bridgeBase(link.id)) return null;
        const rid = link.id;
        const answer = this.researchAnswerOf(rid);
        const p = pending.get(key(rid)) ?? null;
        if (p && p.until < Date.now()) clearPending(rid);
        const live = pending.get(key(rid)) ?? null;
        if (!answer || answer.result === 'denied') {
            // Not known yet: a switch on its way still shows (its answer comes).
            if (!live) return null;
        }
        const on = answer?.result === 'up';
        const said = notes.get(key(rid));
        if (said && said.on !== on) notes.delete(key(rid));
        const stored = storedLiveState(rid);
        const features = on ? (answer?.status?.features ?? []) : (stored?.features ?? []);
        const canStop = features.includes(LIVE_STOP_FEATURE);
        // Off: the start link unless the research said, as it is now, that it has none (an update since may have brought it).
        const startSaid = features.includes(LIVE_START_FEATURE) || (!on && liveFeaturesWord(rid) !== 'said');
        const canStart = startSaid && this.researchLinkAvailable('live');
        return {
            on,
            pending: live?.kind ?? null,
            pendWords: live ? (pendOf(pendKey(rid))?.phase === 'lock' ? '' : pendOf(pendKey(rid))?.label ?? '') : '',
            canStop,
            canStart,
            ended: on ? null : stored?.ended?.kind ?? null,
            note: notes.get(key(rid)) ?? null,
        };
    },

    /**
     * A slot for a tree's switch (filled now and on each answer). `idle`: the
     * idle panel's (first in it while the research runs), `start`: the same
     * after the panel's state line while it is off; in both, off is a button and
     * the command instead of the switch (also when it goes off in place).
     */
    researchLiveSlot(treeId: string, where: 'panel' | 'manager' | 'idle' | 'start'): HTMLElement {
        const slot = el('div', where === 'manager' ? 'research-live research-live--manager'
            : `research-live research-live--panel${where === 'start' ? ' research-live--start' : ''}`);
        slot.dataset.researchLive = treeId;
        if (where === 'idle' || where === 'start') slot.dataset.variant = 'start';
        this.fillResearchLiveSlot(slot);
        return slot;
    },

    /** The slot's HTML for the manager's rows (filled after the list is drawn). */
    researchLiveSlotHtml(treeId: string): string {
        return `<div class="research-live research-live--manager" data-research-live="${treeId}" hidden></div>`;
    },

    /** Draw a slot's switch (only when what it shows changed). */
    fillResearchLiveSlot(slot: HTMLElement): void {
        const treeId = slot.dataset.researchLive ?? '';
        const state = this.researchLiveState(treeId);
        const stateKey = state ? JSON.stringify(state) : '';
        if (slot.dataset.liveKey === stateKey && slot.dataset.liveDrawn === '1') return;
        slot.dataset.liveKey = stateKey;
        slot.dataset.liveDrawn = '1';
        const hadFocus = slot.contains(document.activeElement);
        slot.replaceChildren();
        slot.hidden = !state;
        slot.classList.toggle('is-on', !!state?.on);
        if (!state) return;
        const L = strings.researchLive;
        const rid = TreeManager.getTreeMetadata(treeId as TreeId)?.research?.id ?? '';
        if (slot.dataset.variant === 'start' && (!state.on || state.pending === 'starting')) {
            this.fillResearchLiveStart(slot, treeId, rid, state);
            if (hadFocus) slot.querySelector<HTMLElement>('.research-live-start, .research-live-copy')?.focus({ preventScroll: true });
            return;
        }
        const checked = state.pending ? state.pending === 'starting' : state.on;
        const canAct = !state.pending && (state.on ? state.canStop : state.canStart);
        const row = slot.appendChild(el('div', 'research-live-row'));
        const sw = el('button', 'view-link-switch research-live-switch');
        sw.type = 'button';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(checked));
        if (!canAct) sw.setAttribute('aria-disabled', 'true');
        if (state.pending) applyPend(sw, pendKey(rid));
        sw.appendChild(el('span', 'view-link-switch__label', L.switchLabel));
        const track = sw.appendChild(el('span', 'view-link-switch__track'));
        track.setAttribute('aria-hidden', 'true');
        sw.onclick = (e) => {
            e.stopPropagation();
            void this.toggleResearchLive(treeId);
        };
        row.appendChild(sw);
        // Its words after 120 ms (said once in the shared busy region), "Waiting for the research" after 5 s.
        const words = state.pending ? pendStatusEl(pendKey(rid)) : null;
        if (words) row.appendChild(words).classList.add('research-live-busy');
        // Off: how it ended, and how it comes back where the switch cannot do it.
        const note = el('p', 'research-live-note');
        if (!state.on && !state.pending) {
            if (state.ended === 'idle') note.appendChild(el('span', undefined, L.offIdle));
            else if (state.ended === 'stopped') note.appendChild(el('span', undefined, L.offStopped));
        }
        if (state.note) {
            if (note.childNodes.length) note.appendChild(document.createTextNode(' '));
            note.appendChild(el('span', 'research-live-said', state.note.text));
            this.researchLiveRetry(note, treeId, rid);
            if (state.note.command) note.append(' ', commandLine(state.note.command, c => this.copyResearchLiveCommand(c)));
        } else if (!state.on && !state.pending && !state.canStart) {
            if (note.childNodes.length) note.appendChild(document.createTextNode(' '));
            note.append(el('span', undefined, L.startHow), ' ', commandLine(COMMAND_START, c => this.copyResearchLiveCommand(c)));
        }
        if (note.childNodes.length) slot.appendChild(note);
        if (hadFocus) slot.querySelector<HTMLElement>('.research-live-switch')?.focus({ preventScroll: true });
    },

    /**
     * The idle panel while the research is off: "Switch on" (the quiet link) where the research
     * can take it, and under it one command for the terminal (the failure's own word when it said one).
     */
    fillResearchLiveStart(slot: HTMLElement, treeId: string, rid: string, state: SwitchState): void {
        const L = strings.researchLive;
        if (state.canStart || state.pending) {
            const row = slot.appendChild(el('div', 'research-live-row'));
            const btn = el('button', 'live-panel-action research-live-start', state.pending ? (state.pendWords || L.starting) : L.startButton);
            btn.type = 'button';
            if (state.pending) {
                // Locked, keeping its focus (aria-disabled); the spinner after 120 ms, "Waiting for the research" after 5 s.
                btn.setAttribute('aria-disabled', 'true');
                btn.setAttribute('aria-busy', 'true');
                if (state.pendWords) btn.insertAdjacentHTML('afterbegin', busySpinHtml(14));
            }
            btn.onclick = (e) => {
                e.stopPropagation();
                void this.toggleResearchLive(treeId);
            };
            row.appendChild(btn);
        }
        const note = slot.appendChild(el('p', 'research-live-note'));
        if (!state.pending) {
            if (state.ended === 'idle') note.append(el('span', undefined, L.offIdle), ' ');
            else if (state.ended === 'stopped') note.append(el('span', undefined, L.offStopped), ' ');
        }
        const said = state.note && !state.note.on ? state.note : null;
        const text = said?.text ?? (state.canStart || state.pending ? L.startIfNothing : L.startHow);
        note.append(el('span', said ? 'research-live-said' : undefined, text));
        if (said) this.researchLiveRetry(note, treeId, rid);
        note.append(' ', commandLine(said?.command ?? COMMAND_START, c => this.copyResearchLiveCommand(c)));
    },

    /** A refusal's or a passed limit's sentence (6.1): an alert when first drawn, with "Try again" after it. */
    researchLiveRetry(note: HTMLElement, treeId: string, rid: string): void {
        const said = notes.get(key(rid));
        if (!said?.retry) return;
        if (!noteSaid.has(said)) {
            noteSaid.add(said);
            note.setAttribute('role', 'alert');
        }
        note.classList.add('is-err');
        const retry = el('button', 'link busy-msg__retry research-live-retry', strings.busy.retry);
        retry.type = 'button';
        retry.onclick = (e) => {
            e.stopPropagation();
            void this.toggleResearchLive(treeId);
        };
        note.append(' ', retry);
    },

    /** The command that switches a research on, as a line with its "Copy" (where no switch can show). */
    researchLiveStartHow(): HTMLElement {
        const p = el('p', 'research-live-note');
        p.append(el('span', undefined, strings.researchLive.startHow), ' ', commandLine(COMMAND_START, c => this.copyResearchLiveCommand(c)));
        return p;
    },

    /** Redraw the switches where they show, and Settings' choice when it is open. */
    refreshResearchLiveSwitches(): void {
        document.querySelectorAll<HTMLElement>('[data-research-live]').forEach(slot => this.fillResearchLiveSlot(slot));
        if (document.getElementById('settings-modal')?.classList.contains('active')) this.renderResearchLiveSettings(false);
    },

    /** A click on a tree's switch: off through the bridge, on by the link; else the command, nothing sent. */
    async toggleResearchLive(treeId: string): Promise<void> {
        const state = this.researchLiveState(treeId);
        const rid = TreeManager.getTreeMetadata(treeId as TreeId)?.research?.id;
        if (!state || !rid || state.pending) return;
        const L = strings.researchLive;
        notes.delete(key(rid));
        if (state.on) {
            const base = bridgeBase(rid);
            if (!state.canStop || !base) {
                notes.set(key(rid), { text: L.stopHow, command: COMMAND_STOP, on: true });
                this.refreshResearchLiveSwitches();
                return;
            }
            setPending(rid, 'stopping', STOP_CONFIRM_MS, () => this.refreshResearchLiveSwitches(), () => this.researchLiveTimedOut(rid, 'stopping'));
            this.refreshResearchLiveSwitches();
            const res = await postLiveStop(base);
            if (!res.ok) {
                clearPending(rid);
                notes.set(key(rid), { text: res.code === 'busy' ? L.busy : L.stopFailed(refusalText(res)), on: true, retry: true });
                this.refreshResearchLiveSwitches();
                return;
            }
            noteLiveEnded(rid, 'stopped', 'app');
            void this.confirmResearchLive(rid, 'stopping');
            return;
        }
        if (!state.canStart) {
            notes.set(key(rid), { text: L.startHow, command: COMMAND_START, on: false });
            this.refreshResearchLiveSwitches();
            return;
        }
        const scheme = storedLiveState(rid)?.scheme ?? announcedResearchScheme();
        const url = researchSchemeUrl('live', { tree: rid, liveDo: 'start' }, scheme);
        if (!url) return;
        setPending(rid, 'starting', START_CONFIRM_MS, () => this.refreshResearchLiveSwitches(), () => this.researchLiveTimedOut(rid, 'starting'));
        this.refreshResearchLiveSwitches();
        this.handOverResearchLink(url);
        void this.confirmResearchLive(rid, 'starting');
    },

    /** Ask the bridge until it went (off) or came (on), at most the pending's time; then say so. */
    async confirmResearchLive(researchId: string, kind: Pending['kind']): Promise<void> {
        for (;;) {
            const p = pending.get(key(researchId));
            if (!p || p.kind !== kind) break;
            await new Promise(resolve => setTimeout(resolve, CONFIRM_EVERY_MS));
            const status = await this.askResearchBridge(researchId, ASK_TIMEOUT_MS);
            const up = !!status;
            if ((kind === 'stopping' && !up) || (kind === 'starting' && up)) {
                clearPending(researchId);
                break;
            }
            if (Date.now() > p.until) {
                this.researchLiveTimedOut(researchId, kind, false);
                break;
            }
        }
        // Every round's answer: the marks and the switches.
        this.refreshResearchMarks();
        this.refreshResearchLiveSwitches();
    },

    /**
     * Its time passed without the research's answer (switched on: 30 s): the switch back
     * as it was, the sentence at it with "Try again" and the command for the terminal.
     */
    researchLiveTimedOut(researchId: string, kind: Pending['kind'], redraw = true): void {
        if (pending.get(key(researchId))?.kind !== kind) return;
        clearPending(researchId);
        notes.set(key(researchId), kind === 'starting'
            ? { text: strings.busy.liveSilent(Math.round(START_CONFIRM_MS / 1000)), command: COMMAND_START, on: false, retry: true }
            : { text: strings.researchLive.stopFailed(''), command: COMMAND_STOP, on: true, retry: true });
        if (redraw) this.refreshResearchLiveSwitches();
    },

    copyResearchLiveCommand(command: string): void {
        const done = (): void => { this.showToast(strings.researchLive.copied, 3000); };
        try {
            void navigator.clipboard?.writeText(command).then(done, () => { /* the code stays selectable */ });
        } catch { /* the code stays selectable */ }
    },

    // ==================== SETTINGS: THE COMPUTER'S CHOICE ====================

    /**
     * The research trees on this computer (the open one first): which of their
     * bridges takes the choice now, and what the choice is as last said.
     */
    researchLiveIdleSource(): { base: string; rid: string; minutes: number; choices: number[] } | null {
        const active = TreeManager.getActiveTreeId();
        const trees = TreeManager.getTrees().filter(t => !!t.research?.id && !t.research.copy)
            .sort((a, b) => (a.id === active ? -1 : b.id === active ? 1 : 0));
        for (const t of trees) {
            const rid = t.research!.id;
            const answer = this.researchAnswerOf(rid);
            const status = answer?.result === 'up' ? answer.status : null;
            const base = bridgeBase(rid);
            if (status?.live && base && (status.features ?? []).includes(LIVE_IDLE_FEATURE)) {
                return { base, rid, minutes: status.live.idleMinutes, choices: status.live.idleChoices };
            }
        }
        return null;
    },

    /** Whether some research on this computer answers now (to tell an older research from none running). */
    researchLiveAnyUp(): boolean {
        return TreeManager.getTrees().some(t => !!t.research?.id && !t.research.copy && this.researchAnswerOf(t.research.id)?.result === 'up');
    },

    /** Settings › Research on this computer (a computer with a research tree only). `force`: draw even when nothing changed. */
    renderResearchLiveSettings(force = true): void {
        const group = document.getElementById('settings-group-research-live');
        const body = group?.querySelector<HTMLElement>('.settings-group-body');
        if (!group || !body) return;
        const show = researchHere() && !DataManager.isViewMode() && TreeManager.getTrees().some(t => !!t.research?.id && !t.research.copy);
        group.hidden = !show;
        if (!show) {
            body.replaceChildren();
            delete body.dataset.liveKey;
            return;
        }
        const source = this.researchLiveIdleSource();
        const anyUp = this.researchLiveAnyUp();
        const stateKey = JSON.stringify([source?.rid ?? '', source?.minutes ?? -1, source?.choices ?? [], anyUp, idleWriting, idleSending, pendOf(IDLE_PEND)?.phase ?? '', idleNote]);
        if (!force && body.dataset.liveKey === stateKey) return;
        body.dataset.liveKey = stateKey;
        if (force) this.kickOtherResearch();
        const L = strings.researchLive;
        const hadFocus = body.contains(document.activeElement);
        body.replaceChildren();
        const row = body.appendChild(el('div', 'settings-row settings-row-stacked research-live-idle'));
        const text = row.appendChild(el('span', 'settings-text'));
        const name = text.appendChild(el('span', 'settings-name', L.idleName));
        name.id = 'research-live-idle-name';
        if (source) {
            const seg = row.appendChild(el('div', 'settings-options settings-segment sel-seg research-live-idle-options'));
            seg.setAttribute('role', 'radiogroup');
            seg.setAttribute('aria-labelledby', name.id);
            const options: { minutes: number; label: string }[] = [
                { minutes: LIVE_IDLE_FOREVER, label: L.idleForever },
                { minutes: LIVE_IDLE_TWO_HOURS, label: L.idleTwoHours },
            ];
            // A value set in the terminal shows as it is (it is not sent back).
            if (!options.some(o => o.minutes === source.minutes)) options.push({ minutes: source.minutes, label: L.idleCustom(source.minutes) });
            for (const o of options) {
                const label = seg.appendChild(el('label', 'settings-radio sel-opt'));
                label.dataset.selForm = 'seg';
                const input = label.appendChild(el('input'));
                input.type = 'radio';
                input.name = 'research-live-idle';
                input.value = String(o.minutes);
                const chosen = o.minutes === (idleSending ?? source.minutes);
                input.checked = chosen;
                // On its way: locked (keeping the focus), a click changes nothing.
                if (idleWriting) input.setAttribute('aria-disabled', 'true');
                if (idleWriting && chosen) applyPend(label, IDLE_PEND);
                input.onchange = () => {
                    if (idleWriting) {
                        delete body.dataset.liveKey;
                        this.renderResearchLiveSettings(false);
                        return;
                    }
                    if (input.checked) void this.writeResearchLiveIdle(o.minutes);
                };
                label.appendChild(el('span', undefined, o.label));
            }
            const words = idleWriting ? pendStatusEl(IDLE_PEND) : null;
            if (words) row.appendChild(words);
            if (idleNote) {
                const said = body.appendChild(el('p', 'settings-desc research-live-idle-said', idleNote));
                said.setAttribute('role', 'status');
            }
            if (hadFocus) body.querySelector<HTMLInputElement>('input[name="research-live-idle"]:checked')?.focus({ preventScroll: true });
            return;
        }
        // No research that takes the choice runs now: the commands for the terminal, nothing sent.
        const how = row.appendChild(el('div', 'settings-desc research-live-idle-commands'));
        how.appendChild(el('p', undefined, anyUp ? L.idleOlder : L.idleNoBridge));
        for (const [minutes, label] of [[LIVE_IDLE_FOREVER, L.idleCommandForever], [LIVE_IDLE_TWO_HOURS, L.idleCommandTwoHours]] as const) {
            how.appendChild(el('p', undefined)).appendChild(commandLine(idleCommand(minutes), c => this.copyResearchLiveCommand(c), label));
        }
    },

    /** Write the computer's choice through the bridge that takes it (only 0 or 120). */
    async writeResearchLiveIdle(minutes: number): Promise<void> {
        const source = this.researchLiveIdleSource();
        if (!source || idleWriting) return;
        idleWriting = true;
        idleSending = minutes;
        idleNote = '';
        startPend(IDLE_PEND, { redraw: () => this.renderResearchLiveSettings(false) });
        this.renderResearchLiveSettings(false);
        const res = await postLiveIdle(source.base, minutes);
        await endPend(IDLE_PEND);
        idleWriting = false;
        if (res.ok) {
            // The choice as the bridge says it now (its next status says it as well).
            await this.askResearchBridge(source.rid, ASK_TIMEOUT_MS);
            idleSending = null;
        } else {
            idleSending = null;
            idleNote = res.code === 'busy' ? strings.researchLive.busy : strings.researchLive.idleFailed(refusalText(res));
        }
        this.renderResearchLiveSettings(true);
    },
});
