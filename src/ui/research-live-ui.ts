/**
 * "Research on" (spec 064): a switch per research tree (the research panel,
 * the tree manager) that shows whether its bridge runs and switches it off
 * (`POST /live {"do": "stop"}`, feature `live.stop`) or on (the link
 * `live?tree=…&do=start`, feature `live.start`: no window, no terminal, so no
 * mark); and Settings' choice for the computer how long a bridge stays on
 * without work (`POST /live {"idleMinutes"}`, feature `live.idle`).
 *
 * Without a feature the switch only shows the state and says the command for
 * the terminal; nothing is sent. Phones and tablets have no switch (the
 * research runs on a computer). The state is the bridge's real one: it answers
 * (on) or not (off); how it ended is remembered per research for the text.
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
    LIVE_IDLE_FOREVER, LIVE_IDLE_TWO_HOURS, liveEndKind, noteLiveEnded, noteLiveStatus, postLiveIdle, postLiveStop,
    storedLiveState, type LiveWriteRefusal,
} from '../research-live.js';
import { el, onComputer } from './research-ui.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';
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
}

const pending = new Map<string, Pending>();
const notes = new Map<string, SwitchNote>();
/** Settings' choice being written (radios off until the bridge answers). */
let idleWriting = false;
let idleNote = '';

const COMMAND_START = 'strom live start';
const COMMAND_STOP = 'strom live stop';
const idleCommand = (minutes: number): string => `strom config set live.idleMinutes ${minutes}`;

/** What a switch shows now (null: no switch — not known, refused by the browser, a phone). */
interface SwitchState {
    on: boolean;
    pending: Pending['kind'] | null;
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
function commandLine(command: string, onCopy: (cmd: string) => void, label?: string): HTMLElement {
    const line = el('span', 'research-live-command');
    line.appendChild(el('code', undefined, command));
    if (label) line.appendChild(el('span', 'research-live-command-label', label));
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
            noteLiveStatus(researchId, status);
            const p = pending.get(key(researchId));
            if (p?.kind === 'starting') pending.delete(key(researchId));
            this.refreshResearchLiveSwitches();
        });
    },

    /** The bridge's `end` event (followed): how it ended, kept for the switch's text. */
    noteResearchLiveEnd(researchId: string, reason: string, by?: 'app'): void {
        const kind = liveEndKind(reason);
        if (!kind) return;
        noteLiveEnded(researchId, kind, by);
        if (pending.get(key(researchId))?.kind === 'stopping') pending.delete(key(researchId));
        this.refreshResearchLiveSwitches();
    },

    /** A tree's switch state (null: no switch here). */
    researchLiveState(treeId: string): SwitchState | null {
        if (!onComputer() || DataManager.isViewMode()) return null;
        const link = TreeManager.getTreeMetadata(treeId as TreeId)?.research;
        if (!link?.id || link.copy || !bridgeBase(link.id)) return null;
        const rid = link.id;
        const answer = this.researchAnswerOf(rid);
        const p = pending.get(key(rid)) ?? null;
        if (p && p.until < Date.now()) pending.delete(key(rid));
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
        const canStart = features.includes(LIVE_START_FEATURE) && this.researchLinkAvailable('live');
        return {
            on,
            pending: live?.kind ?? null,
            canStop,
            canStart,
            ended: on ? null : stored?.ended?.kind ?? null,
            note: notes.get(key(rid)) ?? null,
        };
    },

    /** A slot for a tree's switch (filled now and on each answer). */
    researchLiveSlot(treeId: string, where: 'panel' | 'manager'): HTMLElement {
        const slot = el('div', `research-live research-live--${where}`);
        slot.dataset.researchLive = treeId;
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
        const checked = state.pending ? state.pending === 'starting' : state.on;
        const canAct = !state.pending && (state.on ? state.canStop : state.canStart);
        const row = slot.appendChild(el('div', 'research-live-row'));
        const sw = el('button', 'view-link-switch research-live-switch');
        sw.type = 'button';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(checked));
        if (!canAct) sw.setAttribute('aria-disabled', 'true');
        if (state.pending) sw.setAttribute('aria-busy', 'true');
        sw.appendChild(el('span', 'view-link-switch__label', L.switchLabel));
        const track = sw.appendChild(el('span', 'view-link-switch__track'));
        track.setAttribute('aria-hidden', 'true');
        sw.onclick = (e) => {
            e.stopPropagation();
            void this.toggleResearchLive(treeId);
        };
        row.appendChild(sw);
        if (state.pending) {
            const busy = row.appendChild(el('span', 'research-live-busy', state.pending === 'stopping' ? L.stopping : L.starting));
            busy.setAttribute('role', 'status');
        }
        // Off: how it ended, and how it comes back where the switch cannot do it.
        const note = el('p', 'research-live-note');
        if (!state.on && !state.pending) {
            if (state.ended === 'idle') note.appendChild(el('span', undefined, L.offIdle));
            else if (state.ended === 'stopped') note.appendChild(el('span', undefined, L.offStopped));
        }
        if (state.note) {
            if (note.childNodes.length) note.appendChild(document.createTextNode(' '));
            note.appendChild(el('span', 'research-live-said', state.note.text));
            if (state.note.command) note.append(' ', commandLine(state.note.command, c => this.copyResearchLiveCommand(c)));
        } else if (!state.on && !state.pending && !state.canStart) {
            if (note.childNodes.length) note.appendChild(document.createTextNode(' '));
            note.append(el('span', undefined, L.startHow), ' ', commandLine(COMMAND_START, c => this.copyResearchLiveCommand(c)));
        }
        if (note.childNodes.length) slot.appendChild(note);
        if (hadFocus) slot.querySelector<HTMLElement>('.research-live-switch')?.focus({ preventScroll: true });
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
            pending.set(key(rid), { kind: 'stopping', until: Date.now() + STOP_CONFIRM_MS });
            this.refreshResearchLiveSwitches();
            const res = await postLiveStop(base);
            if (!res.ok) {
                pending.delete(key(rid));
                notes.set(key(rid), { text: res.code === 'busy' ? L.busy : L.stopFailed(refusalText(res)), on: true });
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
        pending.set(key(rid), { kind: 'starting', until: Date.now() + START_CONFIRM_MS });
        this.refreshResearchLiveSwitches();
        this.handOverResearchLink(url);
        void this.confirmResearchLive(rid, 'starting');
    },

    /** Ask the bridge until it went (off) or came (on), at most the pending's time; then say so. */
    async confirmResearchLive(researchId: string, kind: Pending['kind']): Promise<void> {
        const L = strings.researchLive;
        for (;;) {
            const p = pending.get(key(researchId));
            if (!p || p.kind !== kind) break;
            await new Promise(resolve => setTimeout(resolve, CONFIRM_EVERY_MS));
            const status = await this.askResearchBridge(researchId, ASK_TIMEOUT_MS);
            const up = !!status;
            if ((kind === 'stopping' && !up) || (kind === 'starting' && up)) {
                pending.delete(key(researchId));
                break;
            }
            if (Date.now() > p.until) {
                pending.delete(key(researchId));
                notes.set(key(researchId), kind === 'starting'
                    ? { text: L.startFailed, command: COMMAND_START, on: false }
                    : { text: L.stopFailed(''), command: COMMAND_STOP, on: true });
                break;
            }
        }
        // Every round's answer: the marks and the switches.
        this.refreshResearchMarks();
        this.refreshResearchLiveSwitches();
    },

    copyResearchLiveCommand(command: string): void {
        const done = (): void => this.showToast(strings.researchLive.copied, 3000);
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
        const show = onComputer() && !DataManager.isViewMode() && TreeManager.getTrees().some(t => !!t.research?.id && !t.research.copy);
        group.hidden = !show;
        if (!show) {
            body.replaceChildren();
            delete body.dataset.liveKey;
            return;
        }
        const source = this.researchLiveIdleSource();
        const anyUp = this.researchLiveAnyUp();
        const stateKey = JSON.stringify([source?.rid ?? '', source?.minutes ?? -1, source?.choices ?? [], anyUp, idleWriting, idleNote]);
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
            const seg = row.appendChild(el('div', 'settings-options settings-segment research-live-idle-options'));
            seg.setAttribute('role', 'radiogroup');
            seg.setAttribute('aria-labelledby', name.id);
            const options: { minutes: number; label: string }[] = [
                { minutes: LIVE_IDLE_FOREVER, label: L.idleForever },
                { minutes: LIVE_IDLE_TWO_HOURS, label: L.idleTwoHours },
            ];
            // A value set in the terminal shows as it is (it is not sent back).
            if (!options.some(o => o.minutes === source.minutes)) options.push({ minutes: source.minutes, label: L.idleCustom(source.minutes) });
            for (const o of options) {
                const label = seg.appendChild(el('label', 'settings-radio'));
                const input = label.appendChild(el('input'));
                input.type = 'radio';
                input.name = 'research-live-idle';
                input.value = String(o.minutes);
                input.checked = o.minutes === source.minutes;
                input.disabled = idleWriting;
                input.onchange = () => { if (input.checked) void this.writeResearchLiveIdle(o.minutes); };
                label.appendChild(el('span', undefined, o.label));
            }
            if (idleNote) {
                const said = body.appendChild(el('p', 'settings-desc research-live-idle-said', idleNote));
                said.setAttribute('role', 'status');
            }
            if (hadFocus) body.querySelector<HTMLInputElement>('input[name="research-live-idle"]:checked')?.focus({ preventScroll: true });
            return;
        }
        // No research that takes the choice runs now: the commands for the terminal, nothing sent.
        const how = body.appendChild(el('div', 'settings-desc research-live-idle-commands'));
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
        idleNote = '';
        this.renderResearchLiveSettings(false);
        const res = await postLiveIdle(source.base, minutes);
        idleWriting = false;
        if (res.ok) {
            // The choice as the bridge says it now (its next status says it as well).
            await this.askResearchBridge(source.rid, ASK_TIMEOUT_MS);
        } else {
            idleNote = res.code === 'busy' ? strings.researchLive.busy : strings.researchLive.idleFailed(refusalText(res));
        }
        this.renderResearchLiveSettings(true);
    },
});
