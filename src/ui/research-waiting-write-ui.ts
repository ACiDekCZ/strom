/**
 * "Awaiting action" written through the research's bridge, from the Research
 * overview (also its phone sheet): Sent for an item or a whole place, back to
 * To do, the text of all a place's queries in a small window with Copy, and a
 * file added to a task. Only what the bridge announces (src/research-waiting-write.ts);
 * otherwise the task links of part (a) stay.
 *
 * A row moves at once and stays moved until the research's status says the
 * same (or a short while after the write); a failed write puts it back and
 * says so. The bridge is the source of truth: after a write the status is
 * asked soon. Bridge text is set as text, never HTML.
 */

import { researchMarkFlags } from './research-open-mark.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { LiveWaiting, inShowcase, researchDeviceAllows, researchTaskRef } from '../research-link.js';
import {
    WaitingWrites, WaitingPending, WaitingSentResult, WaitingFileResult, WaitingAnswerResult, WaitingWriteRefused, GroupNoteDone, NO_WAITING_WRITES, WAITING_SETTLE_MS, WAITING_FILE_ACCEPT,
    waitingWrites, waitingGroupSendable, waitingTaskIds, waitingFileWritable, waitingWrittenPhase, applyWaitingPending, settleWaitingPending, waitingFileTaken,
    calendarDay, localDayOf, waitingDayShown, waitingSentDayOf,
    postWaitingSent, postGroupSent, postGroupUnsent, getGroupNote, putWaitingFile, answerWaiting, TaskImageResult, uploadTaskImage,
    retryWaiting, retryGroup, WaitingRetryResult, GroupRetryResult,
} from '../research-waiting-write.js';
import type { WaitingAnswerOutcome } from './waiting-answer-form.js';
import { WaitingPhase, groupRetryFailText, imagesState, waitingPhase, waitingRetryRefusedText } from '../research-waiting.js';
import type { UploadOutcome } from './waiting-images-upload.js';
import { imagesSentence, itemKey, takeOwnImages } from './waiting-images-ui.js';
import { uiModule } from './module.js';
import { el, LiveSession, researchSession } from './research-ui.js';
import { normalizeModal } from './modal-skeleton.js';
import { TreeManager } from '../tree-manager.js';
import type { ToastWorkEnd } from './toast.js';
import { activatedElement, announceBusy, busyStep, holdAfterShift, monoNow, runBusy, shiftHeld, showBusyMessage } from './busy.js';
import { isPicking, openFilePicker, takePickOrigin } from './file-pick.js';
import { formatBytes } from './attachments-ui.js';
import { RowNote, RowRefusal, WAITING_ROWS_SCOPE, WaitingRowNotes } from './waiting-row-notes.js';
import { overviewInWindow } from '../windows/overview-window.js';
import { openSentDayPopover } from './waiting-sent-day.js';

const NOTE_ID = 'waiting-note-modal';
/** "All queries' text": how long its reading may take (§1.5, §10.3). */
const WAITING_NOTE_MS = 30_000;

interface WriteState {
    /** The research's own list, as its last status had it. */
    raw: LiveWaiting[];
    /** Rows moved by a write not yet in that list. */
    pending: Map<string, WaitingPending>;
    /** Places whose "Sent" runs. */
    groups: Set<string>;
    /** What each row says of its own write: "saving", or refused with its sentence (§7). */
    notes: WaitingRowNotes;
    /** The redraw when a refused row's tint ends. */
    tintTimer: ReturnType<typeof setTimeout> | null;
    /** The rows as last shown (ids, phases, findings), and when a write here last moved them. */
    shownSig: string;
    ownMoveAt: number;
}

/** The rows' order and look in short: a new status that changes it moves them. */
function shownSignature(items: readonly LiveWaiting[]): string {
    return items.map(w => `${w.id}:${waitingPhase(w)}:${w.audit ? 'a' : ''}`).join('|');
}


/** The row of an item in the docked overview (null: not drawn here). */
function overviewRowEl(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`#research-overview .research-overview__waiting-item[data-id="${CSS.escape(id)}"]`);
}

/** A row is seen: drawn in the docked overview, or the overview's own window draws it. */
function rowSeen(id: string): boolean {
    if (overviewInWindow()) return true;
    const li = overviewRowEl(id);
    return !!li && li.getClientRects().length > 0;
}

/** The focus is in an item's row (its detail, or its ⋯ menu), or the click now started there (its button may have blurred, disabled). */
function focusInRow(id: string): boolean {
    if (typeof document === 'undefined') return false;
    const act = activatedElement();
    if (act && (overviewRowEl(id)?.contains(act) || act.closest(`#waiting-more-menu[data-id="${CSS.escape(id)}"]`))) return true;
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    if (overviewRowEl(id)?.contains(a)) return true;
    return !!a.closest(`#waiting-more-menu[data-id="${CSS.escape(id)}"]`);
}

/** A refusal another try may mend (the research busy, locked, held or not answering; not one it will never take). */
function retryHelps(r: WaitingWriteRefused): boolean {
    return r.code !== 'not-sendable' && r.code !== 'app-only' && r.code !== 'bad-body' && r.code !== 'none';
}

const states = new WeakMap<LiveSession, WriteState>();

function writeState(s: LiveSession): WriteState {
    let st = states.get(s);
    if (!st) {
        st = { raw: [...s.waiting], pending: new Map(), groups: new Set(), notes: new WaitingRowNotes(), tintTimer: null, shownSig: '', ownMoveAt: -Infinity };
        states.set(s, st);
    }
    return st;
}

/**
 * The session the write was made in still runs: followed, or viewed through its bridge in the
 * overview (following ended, went elsewhere or the overview closed: nothing to show).
 */
function stillFollowing(s: LiveSession): boolean {
    return researchSession() === s && !s.ended;
}

/** What a refused write says (none: nothing, the row just goes). */
function refusedText(r: WaitingWriteRefused): string {
    const W = strings.live.waitingWrite;
    switch (r.code) {
        case 'locked': return W.locked;
        case 'busy': return W.busy;
        case 'not-sendable': return W.notSendable;
        case 'app-only': return W.appOnly;
        case 'bad-body': return W.badBody;
        case 'bad-date': return W.badDate;
        case 'failed': return W.writeFailed;
        // The research's own sentence says what to do there (017 U7).
        case 'held': return r.held?.said || W.failed;
        default: return W.failed;
    }
}

export const researchWaitingWriteMethods = uiModule({
    /** A refused write, said; held by the research (sealed elsewhere …): its sentence, the seal's way beside. */
    showWaitingRefused(result: WaitingWriteRefused): void {
        const seal = result.held ? this.researchSealAction(result.held)[0] : undefined;
        this.showToast(refusedText(result), seal ? 12000 : 6000, {
            kind: 'waiting-failed',
            ...(seal ? { action: { label: seal.label, run: () => this.researchSyncAction(seal.action), ...researchMarkFlags(this.researchSyncActionMark(seal.action)) } } : {}),
        });
    },

    /**
     * A write of "Awaiting action" is committed by the research but leaves the
     * tree as it is: the tree in step before it takes the new head as its
     * version, by the rule of the family's material (researchTakeOwnWriteHead:
     * its `parent` the tree's head; not said, `before`: the head asked right
     * before the write, waitingHeadBeforeWrite), and following loads nothing
     * again for it. A commit of its agent meanwhile: nothing taken, the newer
     * version comes as ever.
     */
    takeWaitingWriteHead(s: LiveSession, before: string,
        result: WaitingSentResult | WaitingFileResult | WaitingAnswerResult | TaskImageResult | WaitingRetryResult | GroupRetryResult): void {
        if (!result.ok || !result.head) return;
        this.researchTakeOwnWriteHead(s.researchId, before, result.head, result.parent);
        if (!s.ended && TreeManager.getTreeMetadata(s.treeId)?.research?.head === result.head) s.head = result.head;
    },

    /**
     * The research's head right before a write of "Awaiting action": asked
     * now at the followed bridge (researchHeadBeforeWrite), never the head
     * following last heard of — a commit of its agent since then, not yet
     * in the stream, would otherwise be taken in as the tree's own. A
     * research whose answers say their `parent` is not asked.
     */
    waitingHeadBeforeWrite(s: LiveSession): Promise<string> {
        return this.researchHeadBeforeWrite(s.researchId, { ask: true, base: s.bridge.base });
    },

    /** What the followed (or viewed) research's bridge takes from "Awaiting action". */
    liveWaitingWrites(s: LiveSession | null = researchSession()): WaitingWrites {
        // A device the gateway refused answers on (403 device.computer-only): nothing written here (spec 094 §4).
        if (!s || s.ended || !researchDeviceAllows('waiting-answer')) return NO_WAITING_WRITES;
        // The showcase (spec 143 K4.1): only "Answer" is drawn (greyed, it writes nothing); no other write.
        if (inShowcase()) return { ...NO_WAITING_WRITES, answer: waitingWrites({ features: s.features, accepts: s.accepts }).answer };
        return waitingWrites({ features: s.features, accepts: s.accepts });
    },

    /** A new status: its list, with the rows a write moved and the research has not reported yet. */
    liveWaitingShown(s: LiveSession, raw: LiveWaiting[]): LiveWaiting[] {
        const st = writeState(s);
        st.raw = [...raw];
        settleWaitingPending(st.pending, raw);
        // A refusal's sentence goes once its item is gone or the research says it elsewhere now.
        st.notes.settle(raw.map(w => ({ id: w.id, phase: waitingPhase(w) })));
        const shown = applyWaitingPending(raw, st.pending);
        // The research's answer to a write made here moves the rows again: their actions held a moment (109 U4).
        const sig = shownSignature(shown);
        if (sig !== st.shownSig && monoNow() - st.ownMoveAt < WAITING_SETTLE_MS) holdAfterShift(WAITING_ROWS_SCOPE);
        st.shownSig = sig;
        return shown;
    },

    /**
     * A write made here moved Awaiting action's rows (a row went, opened its preview or changed its place): their
     * actions take no click for a moment, so a second click meant for the row before does not land on the next
     * one (109 U4); the research's answer to it, when it moves them again, holds them once more.
     */
    waitingRowsMoved(s: LiveSession | null = researchSession()): void {
        holdAfterShift(WAITING_ROWS_SCOPE);
        if (s) writeState(s).ownMoveAt = monoNow();
    },

    /** What an item's row says of its own write (§7): "saving", or refused (the overview's own window: as its main window has it). */
    waitingRowNote(s: LiveSession, id: string): RowNote | null {
        return states.get(s)?.notes.state(id) ?? null;
    },

    /** An action in a refused row: its tint ends (true: it had one). */
    touchWaitingRow(s: LiveSession, id: string): boolean {
        return states.get(s)?.notes.touch(id) ?? false;
    },

    /** "Try again" in a refused row: the same write once more. */
    retryWaitingRow(s: LiveSession, id: string): boolean {
        const retry = states.get(s)?.notes.state(id);
        if (retry?.kind !== 'refused' || !retry.refusal.retry) return false;
        retry.refusal.retry();
        return true;
    },

    /** The rows' own states for the overview's own window. */
    waitingRowsWindowState(s: LiveSession | null): ReturnType<WaitingRowNotes['snapshot']> {
        return s ? states.get(s)?.notes.snapshot() ?? { saving: [], refused: [] } : { saving: [], refused: [] };
    },

    /** A write of these rows starts (§7): "saving" at their ends, said once; the list's actions held a moment (the rows moved). */
    startWaitingRows(s: LiveSession, ids: readonly string[]): void {
        writeState(s).notes.start(ids);
        this.waitingRowsMoved(s);
        announceBusy(strings.busy.savingRow);
    },

    /**
     * A write of these rows ended: confirmed, the state just goes; refused (`refusal`), the rows are back, tinted
     * with the sentence in the first (`quiet`: the end is said elsewhere, a toast's Undo). Call before the rows are
     * drawn again (settleWaitingWrite).
     */
    endWaitingRows(s: LiveSession, ids: readonly string[], refusal: Omit<RowRefusal, 'at' | 'untinted' | 'said'> | null): void {
        const st = writeState(s);
        if (!refusal) {
            st.notes.confirm(ids);
            return;
        }
        st.notes.refuse(ids.slice(0, 1), refusal);
        if (ids.length > 1) st.notes.refuse(ids.slice(1), { phase: refusal.phase, text: '' });
        this.waitingRowsMoved(s);
        // The tint ends after 10 s: drawn again then.
        if (st.tintTimer) clearTimeout(st.tintTimer);
        const next = st.notes.nextTintEnd();
        if (next !== null) {
            st.tintTimer = setTimeout(() => {
                st.tintTimer = null;
                if (stillFollowing(s)) this.renderLivePanel();
            }, Math.max(0, next - Date.now()) + 20);
        }
    },

    /**
     * A refusal drawn in its row: the focus on its sentence when it was in the row (`fromRow`); a row not seen
     * (the overview closed, its section folded) says it by the toast as before.
     */
    sayWaitingRowRefused(id: string, result: WaitingWriteRefused | string, fromRow: boolean): void {
        if (!rowSeen(id)) {
            if (typeof result === 'string') this.showToast(result, 6000, { kind: 'waiting-failed' });
            else this.showWaitingRefused(result);
            return;
        }
        if (!fromRow) return;
        // The row is drawn anew (now or on the next frames): the focus goes to its sentence unless it went elsewhere.
        let tries = 0;
        const put = (): void => {
            const a = document.activeElement;
            const li = overviewRowEl(id);
            if (a && a !== document.body && !li?.contains(a)) return;
            const note = li?.querySelector<HTMLElement>('.research-overview__waiting-note');
            if (note) note.focus({ preventScroll: true });
            else if (++tries < 5) requestAnimationFrame(put);
        };
        put();
    },

    /** Show the list again after a move (the menu's count, the panel, the overview). */
    reshowLiveWaiting(s: LiveSession): void {
        const st = writeState(s);
        s.waiting = applyWaitingPending(st.raw, st.pending);
        st.shownSig = shownSignature(s.waiting);
        this.refreshActionMenuBadges();
        this.renderLivePanel();
    },

    /**
     * After a write: what it wrote holds a while (until the status says so),
     * what is gone goes, and a failure puts the rows back (`back`: each row's
     * move before this write, when it had one; `group`: a place's write, whose
     * answer names the tasks it moved; 'exact': only those, none when it names none).
     */
    settleWaitingWrite(s: LiveSession, ids: readonly string[], phase: WaitingPhase, result: WaitingSentResult,
        back: ReadonlyMap<string, WaitingPending | undefined> = new Map(), group: boolean | 'exact' = false): boolean {
        const st = writeState(s);
        const until = Date.now() + WAITING_SETTLE_MS;
        const restore = (id: string): void => {
            const before = back.get(id);
            if (before) st.pending.set(id, { ...before, until: Math.max(before.until === Infinity ? 0 : before.until, until) });
            else st.pending.delete(id);
        };
        if (result.ok) {
            // A place's write says which it moved: the rest goes back; one it moved beyond those moved here moves too.
            // (`exact`: the answer's list is the whole truth, even empty.)
            const said = group === 'exact' || (result.sent.length > 0 && (ids.length > 1 || group)) ? new Set(result.sent) : null;
            for (const id of ids) {
                const p = st.pending.get(id);
                if (said && !said.has(id)) restore(id);
                else if (p) st.pending.set(id, { ...p, until });
            }
            if (said) {
                const first = phase === 'sent' ? st.pending.get(ids[0]) : undefined;
                const at = first?.sentAt;
                const day = first?.sentDay;
                for (const id of said) {
                    if (!ids.includes(id) && st.raw.some(w => w.id === id)) st.pending.set(id, { phase, ...(at ? { sentAt: at } : {}), ...(day ? { sentDay: day } : {}), until });
                }
            }
        } else if (result.code === 'none') {
            for (const id of ids) st.pending.set(id, { phase, gone: true, until });
        } else {
            for (const id of ids) restore(id);
        }
        if (stillFollowing(s)) {
            this.reshowLiveWaiting(s);
            this.researchStatusAfterWrite(s);
        }
        return result.ok;
    },

    /**
     * "Sent" at an item: written through the bridge, the row in "Awaiting a reply" at once, saying "saving" at its
     * end until the research confirms (§7); "Undo" for a few seconds. Refused: the row back, its sentence and
     * "Try again" in it (a toast only when the row is not seen).
     */
    async markWaitingSent(s: LiveSession, w: LiveWaiting, day?: string): Promise<void> {
        const task = researchTaskRef(w.id);
        const writes = this.liveWaitingWrites(s);
        if (!task || !writes.sent) return;
        const st = writeState(s);
        // A second click while it is written sends nothing more.
        if (st.pending.get(w.id)?.until === Infinity) return;
        const back = new Map([[w.id, st.pending.get(w.id)]]);
        const was = waitingPhase(st.raw.find(x => x.id === w.id) ?? w);
        const fromRow = focusInRow(w.id);
        const now = Date.now();
        // A day other than today (spec 149): only where the bridge takes it; today goes as before (the moment kept).
        const at = writes.sentDay && day && day !== localDayOf(now) ? day : undefined;
        const shownDay = at ?? localDayOf(now);
        st.pending.set(w.id, { phase: 'sent', sentAt: at ? `${at}T12:00:00.000Z` : new Date(now).toISOString(), sentDay: shownDay, until: Infinity });
        this.startWaitingRows(s, [w.id]);
        this.reshowLiveWaiting(s);
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingSent(s.bridge.base, task, 'sent', at ? { at } : {});
        this.takeWaitingWriteHead(s, before, result);
        // The answer says where the task is now (already sent: `sent: []`, phase sent): the row follows it.
        const phase = waitingWrittenPhase(result, task, 'sent');
        if (phase !== 'sent') st.pending.set(w.id, { phase, until: Infinity });
        const refused = !result.ok && result.code !== 'none' ? result : null;
        this.endWaitingRows(s, [w.id], refused ? this.waitingRowRefusal(refused, was, () => { void this.markWaitingSent(s, w, day); }) : null);
        const ok = this.settleWaitingWrite(s, [w.id], phase, result, back);
        if (!stillFollowing(s)) return;
        const W = strings.live.waitingWrite;
        if (ok && phase === 'sent') {
            // The toast says the day the research recorded (its answer's), else the one asked.
            this.showToast(W.sentToast(waitingDayShown((result.ok && result.sentDay) || shownDay, now, getCurrentLanguage())), 6000, {
                kind: 'waiting-sent',
                // Undo works in the toast (4d): "Undoing…" and its end there.
                action: { label: W.undo, run: () => this.markWaitingUnsent(s, w.id, { inToast: true }),
                    work: { label: strings.busy.reverting, ...(w.what ? { sub: w.what } : {}) } },
            });
        } else if (refused) {
            this.sayWaitingRowRefused(w.id, refused, fromRow);
        }
    },

    /**
     * "Change the day it was sent" (spec 149 K2.1): a sent task's day written through the bridge (`waiting.sentDay`),
     * the row's day at once, saying "saving"; the toast says the day recorded and Undo writes the day before back.
     */
    async changeWaitingSentDay(s: LiveSession, w: LiveWaiting, day: string, opts: { inToast?: boolean } = {}): Promise<ToastWorkEnd | undefined> {
        const task = researchTaskRef(w.id);
        if (!task || !this.liveWaitingWrites(s).sentDay || !calendarDay(day)) return undefined;
        const st = writeState(s);
        if (st.pending.get(w.id)?.until === Infinity) return undefined;
        const shown = s.waiting.find(x => x.id === w.id) ?? w;
        if (waitingPhase(shown) !== 'sent') return undefined;
        const previous = waitingSentDayOf(shown);
        if (previous === day) return undefined;
        const back = new Map([[w.id, st.pending.get(w.id)]]);
        const fromRow = focusInRow(w.id);
        st.pending.set(w.id, { phase: 'sent', sentAt: `${day}T12:00:00.000Z`, sentDay: day, until: Infinity });
        this.startWaitingRows(s, [w.id]);
        this.reshowLiveWaiting(s);
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingSent(s.bridge.base, task, 'sent', { at: day });
        this.takeWaitingWriteHead(s, before, result);
        const phase = waitingWrittenPhase(result, task, 'sent');
        if (phase !== 'sent') st.pending.set(w.id, { phase, until: Infinity });
        const refused = !result.ok && result.code !== 'none' ? result : null;
        this.endWaitingRows(s, [w.id], refused && !opts.inToast
            ? this.waitingRowRefusal(refused, 'sent', () => { void this.changeWaitingSentDay(s, w, day); }) : null);
        const ok = this.settleWaitingWrite(s, [w.id], phase, result, back);
        if (!stillFollowing(s)) return undefined;
        const W = strings.live.waitingWrite;
        const now = Date.now();
        if (ok && phase === 'sent') {
            const text = W.sentDayChangedToast(waitingDayShown((result.ok && result.sentDay) || day, now, getCurrentLanguage()));
            if (opts.inToast) return { ok: true, text };
            this.showToast(text, 6000, {
                kind: 'waiting-sent',
                ...(previous ? { action: { label: W.undo, run: () => this.changeWaitingSentDay(s, w, previous, { inToast: true }),
                    work: { label: strings.busy.reverting, ...(w.what ? { sub: w.what } : {}) } } } : {}),
            });
        } else if (refused) {
            if (opts.inToast) return { ok: false, text: refusedText(refused), whole: true };
            this.sayWaitingRowRefused(w.id, refused, fromRow);
        }
        return undefined;
    },

    /** A refusal as its row says it: the research's sentence, "Try again" where another try may mend it, the seal's way. */
    waitingRowRefusal(result: WaitingWriteRefused, phase: WaitingPhase, retry: () => void): Omit<RowRefusal, 'at' | 'untinted' | 'said'> {
        const seal = result.held ? this.researchSealAction(result.held)[0] : undefined;
        return {
            text: refusedText(result), phase,
            ...(retryHelps(result) ? { retry } : {}),
            ...(seal ? { alt: { label: seal.label, run: () => this.researchSyncAction(seal.action), ...researchMarkFlags(this.researchSyncActionMark(seal.action)) } } : {}),
        };
    },

    /**
     * Back to To do ("Undo" after Sent, or at a sent item), the row saying "saving" until confirmed. `inToast`:
     * the toast's Undo (4d), its end given back to the toast instead of a sentence or a toast of its own.
     */
    async markWaitingUnsent(s: LiveSession, id: string, opts: { inToast?: boolean } = {}): Promise<ToastWorkEnd | undefined> {
        const task = researchTaskRef(id);
        if (!task || !this.liveWaitingWrites(s).sent) return undefined;
        const st = writeState(s);
        if (st.pending.get(id)?.until === Infinity) return undefined;
        const back = new Map([[id, st.pending.get(id)]]);
        const raw = st.raw.find(x => x.id === id);
        const was: WaitingPhase = raw ? waitingPhase(raw) : 'sent';
        const fromRow = focusInRow(id);
        st.pending.set(id, { phase: 'todo', until: Infinity });
        this.startWaitingRows(s, [id]);
        this.reshowLiveWaiting(s);
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await postWaitingSent(s.bridge.base, task, 'unsent');
        this.takeWaitingWriteHead(s, before, result);
        const phase = waitingWrittenPhase(result, task, 'todo');
        if (phase !== 'todo') st.pending.set(id, { phase, until: Infinity });
        const refused = !result.ok && result.code !== 'none' ? result : null;
        this.endWaitingRows(s, [id], refused && !opts.inToast
            ? this.waitingRowRefusal(refused, was, () => { void this.markWaitingUnsent(s, id); }) : null);
        const ok = this.settleWaitingWrite(s, [id], phase, result, back);
        if (!stillFollowing(s)) return undefined;
        if (ok && phase === 'todo') {
            if (opts.inToast) return { ok: true, text: strings.live.waitingWrite.unsentToast };
            this.showToast(strings.live.waitingWrite.unsentToast, 3000, { kind: 'waiting-unsent' });
        } else if (refused) {
            if (opts.inToast) return { ok: false, text: refusedText(refused), whole: true };
            this.sayWaitingRowRefused(id, refused, fromRow);
        }
        return undefined;
    },

    /** "Sent" for a whole place: its items to do that offer it move at once, saying "saving"; the research writes the place. */
    async markWaitingGroupSent(s: LiveSession, key: string, day?: string): Promise<void> {
        const writes = this.liveWaitingWrites(s);
        if (!writes.sent) return;
        const st = writeState(s);
        if (st.groups.has(key)) return;
        const items = waitingGroupSendable(s.waiting.filter(w => w.group?.key === key));
        if (items.length === 0) return;
        const ids = items.map(w => w.id);
        const back = new Map(ids.map(id => [id, st.pending.get(id)]));
        const fromRow = ids.some(focusInRow) || !!document.activeElement?.closest('.research-overview__waiting-groupwrite');
        const now = Date.now();
        // One day for all of them (spec 149 K1.6); today goes as before.
        const at = writes.sentDay && day && day !== localDayOf(now) ? day : undefined;
        const shownDay = at ?? localDayOf(now);
        for (const id of ids) st.pending.set(id, { phase: 'sent', sentAt: at ? `${at}T12:00:00.000Z` : new Date(now).toISOString(), sentDay: shownDay, until: Infinity });
        st.groups.add(key);
        this.startWaitingRows(s, ids);
        this.reshowLiveWaiting(s);
        let result: WaitingSentResult;
        try {
            const before = await this.waitingHeadBeforeWrite(s);
            result = await postGroupSent(s.bridge.base, key, at ? { at } : {});
            this.takeWaitingWriteHead(s, before, result);
        } finally {
            st.groups.delete(key);
        }
        const refused = !result.ok && result.code !== 'none' ? result : null;
        this.endWaitingRows(s, ids, refused ? this.waitingRowRefusal(refused, 'todo', () => { void this.markWaitingGroupSent(s, key, day); }) : null);
        const ok = this.settleWaitingWrite(s, ids, 'sent', result, back, true);
        if (!stillFollowing(s)) return;
        const W = strings.live.waitingWrite;
        if (ok && result.ok) {
            const n = result.sent.length || ids.length;
            // Undo puts back exactly what the bridge said it marked (an answer naming none: no Undo).
            const marked = [...result.sent];
            this.showToast(W.groupSentToast(n, waitingDayShown(result.sentDay || shownDay, now, getCurrentLanguage())), 6000, {
                kind: 'waiting-sent',
                ...(marked.length > 0 ? { action: { label: W.undo, run: () => this.markWaitingGroupUnsent(s, key, marked),
                    work: { label: strings.busy.reverting, ...(items[0]?.group?.name ? { sub: items[0].group.name } : {}) } } } : {}),
            });
        } else if (refused) {
            this.sayWaitingRowRefused(ids[0], refused, fromRow);
        }
    },

    /**
     * "Undo" after a place's Sent: exactly the tasks that Sent marked (its
     * answer's list) go back to do through the bridge; their rows move at
     * once saying "saving", and the answer's `unsent` says which really went back. Its end is the toast's (4d).
     */
    async markWaitingGroupUnsent(s: LiveSession, key: string, marked: readonly string[]): Promise<ToastWorkEnd | undefined> {
        if (!this.liveWaitingWrites(s).sent) return undefined;
        const st = writeState(s);
        if (st.groups.has(key)) return undefined;
        const tasks = waitingTaskIds(marked);
        if (tasks.length === 0) return undefined;
        const ids = tasks.filter(id => st.pending.get(id)?.until !== Infinity
            && s.waiting.some(w => w.id === id && waitingPhase(w) === 'sent'));
        const back = new Map(ids.map(id => [id, st.pending.get(id)]));
        for (const id of ids) st.pending.set(id, { phase: 'todo', until: Infinity });
        st.groups.add(key);
        this.startWaitingRows(s, ids);
        this.reshowLiveWaiting(s);
        let result: WaitingSentResult;
        try {
            const before = await this.waitingHeadBeforeWrite(s);
            result = await postGroupUnsent(s.bridge.base, key, tasks);
            this.takeWaitingWriteHead(s, before, result);
        } finally {
            st.groups.delete(key);
        }
        this.endWaitingRows(s, ids, null);
        const ok = this.settleWaitingWrite(s, ids, 'todo', result, back, 'exact');
        if (!stillFollowing(s)) return undefined;
        if (ok) return { ok: true, text: strings.live.waitingWrite.unsentToast };
        if (!result.ok && result.code !== 'none') return { ok: false, text: refusedText(result), whole: true };
        return undefined;
    },

    /**
     * "All queries' text" of a place: read from the bridge, shown in a small window with Copy. `btn`: the
     * button it came from, in the working state meanwhile ("Loading…", 30 s at most; a second click asks
     * nothing more), its failure said under it (§1.5); without it a failure is a toast.
     */
    async showWaitingGroupNote(s: LiveSession, key: string, name: string, btn?: HTMLElement): Promise<void> {
        if (!this.liveWaitingWrites(s).note) return;
        const read = (): Promise<string | null> => this.readWaitingGroupNote(s, key, name);
        if (!btn) {
            const failed = await read();
            if (failed) this.showToast(failed, 6000, { kind: 'waiting-failed' });
            return;
        }
        await runBusy(btn, async ctl => {
            const failed = await read();
            if (failed) ctl.end({ ok: false, kind: 'error', text: failed, retry: () => { void this.showWaitingGroupNote(s, key, name, btn); } });
        }, { label: strings.busy.generic, timeoutMs: WAITING_NOTE_MS, kind: 'bridge' });
    },

    /**
     * The queries' text of a place read from the bridge and shown in its small window; the failure's sentence
     * (null: shown, or nothing left to show). The overview's own window asks its main window, which shows it.
     */
    async readWaitingGroupNote(s: LiveSession, key: string, name: string): Promise<string | null> {
        const result = await getGroupNote(s.bridge.base, key, { timeoutMs: WAITING_NOTE_MS });
        if (!stillFollowing(s)) return null;
        const W = strings.live.waitingWrite;
        if (result.ok) {
            this.showWaitingNoteDialog(name, result);
            return null;
        }
        if (result.code === 'none' && result.status !== 200) {
            // The place (or its tasks) is gone meanwhile: nothing to show; the status says what is left.
            this.researchStatusAfterWrite(s);
            return null;
        }
        return result.code === 'none' ? W.noteNone : W.noteFailed;
    },

    /** The queries' text, read-only and selectable, with Copy and ×. */
    showWaitingNoteDialog(name: string, note: GroupNoteDone): void {
        this.closeWaitingNoteDialog();
        const W = strings.live.waitingWrite;
        const overlay = el('div', 'modal-overlay active waiting-note-overlay');
        overlay.id = NOTE_ID;
        const modal = el('div', 'modal modal--md waiting-note-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.dataset.dialogKind = 'info';
        modal.setAttribute('aria-labelledby', 'waiting-note-title');
        const header = el('div', 'modal-header');
        const heading = el('div', 'audit-log-heading');
        const title = el('h2', undefined, W.noteTitle);
        title.id = 'waiting-note-title';
        const count = note.tasks.length || note.notes.length;
        heading.append(title, el('div', 'audit-log-subtitle', count > 0 ? `${name} · ${W.noteTasks(count)}` : name));
        const x = el('button', 'close-btn', '×');
        x.type = 'button';
        x.setAttribute('aria-label', strings.buttons.close);
        x.onclick = () => this.closeWaitingNoteDialog();
        header.append(heading, x);
        const text = el('div', 'waiting-note-text', note.text);
        text.tabIndex = 0;
        text.setAttribute('role', 'document');
        const buttons = el('div', 'buttons');
        const copy = el('button', 'primary waiting-note-copy', W.noteCopy);
        copy.type = 'button';
        copy.onclick = () => { void this.copyWaitingNote(text, note.text); };
        buttons.appendChild(copy);
        modal.append(header, text, buttons);
        overlay.appendChild(modal);
        overlay.onclick = (e) => { if (e.target === overlay) this.closeWaitingNoteDialog(); };
        document.body.appendChild(overlay);
        this.pushDialog(NOTE_ID);
        normalizeModal(modal);
        copy.focus();
    },

    closeWaitingNoteDialog(): void {
        document.getElementById(NOTE_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== NOTE_ID);
    },

    isWaitingNoteDialogOpen(): boolean {
        return !!document.getElementById(NOTE_ID);
    },

    /** Copy the queries' text; without the clipboard the text is selected for copying by hand. */
    async copyWaitingNote(node: HTMLElement, text: string): Promise<void> {
        const W = strings.live.waitingWrite;
        try {
            if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
            await navigator.clipboard.writeText(text);
            this.showToast(W.noteCopied, 3000, { kind: 'waiting-copied' });
            return;
        } catch { /* the selection below */ }
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        let copied = false;
        try { copied = document.execCommand('copy'); } catch { /* by hand */ }
        this.showToast(copied ? W.noteCopied : W.noteCopyFailed, copied ? 3000 : 6000, { kind: copied ? 'waiting-copied' : 'waiting-failed' });
    },

    /**
     * The person's answer to an item (spec 048 §2), through the bridge
     * (`waiting.answer`): taken, the row leaves To do at once and the toast
     * says so; gone already (404): the row goes silently; the task waits for
     * something else now (409 changed): the status is asked again and the
     * next try expects what it says (`expect`); answered in the terminal
     * (409 no-answer): the item is read again. The form says the rest.
     */
    async sendWaitingAnswer(s: LiveSession, w: LiveWaiting, text: string, expect?: string): Promise<WaitingAnswerOutcome> {
        const task = researchTaskRef(w.id);
        if (!task || !this.liveWaitingWrites(s).answer) return 'fail';
        const st = writeState(s);
        if (st.pending.get(w.id)?.until === Infinity) return 'skipped';
        const back = st.pending.get(w.id);
        st.pending.set(w.id, { phase: waitingPhase(w), until: Infinity });
        let result: WaitingAnswerResult;
        try {
            const before = await this.waitingHeadBeforeWrite(s);
            result = await answerWaiting(s.bridge.base, task, { text, expect: expect ?? w.at });
            this.takeWaitingWriteHead(s, before, result);
        } finally {
            if (back) st.pending.set(w.id, back);
            else st.pending.delete(w.id);
        }
        const taken = result.ok || result.code === 'none';
        if (taken) st.pending.set(w.id, { phase: waitingPhase(w), gone: true, until: Date.now() + WAITING_SETTLE_MS });
        if (!stillFollowing(s)) return taken ? (result.ok ? 'saved' : 'gone') : 'fail';
        if (taken) this.reshowLiveWaiting(s);
        this.researchStatusAfterWrite(s);
        if (result.ok) {
            this.showToast(strings.live.waitingTask.answerSaved, 6000, { kind: 'waiting-answered' });
            return 'saved';
        }
        switch (result.code) {
            case 'none': return 'gone';
            case 'changed': return 'changed';
            case 'no-answer': return 'no-answer';
            case 'busy': case 'locked': return 'busy';
            // Held by the research (sealed elsewhere …): its own sentence and way, the form says it was not saved.
            case 'held': this.showWaitingRefused(result); return 'fail';
            default: return 'fail';
        }
    },

    /**
     * "Retry with the agent" at an item (spec 089 §1.3, §5, §6), through the
     * bridge (`waiting.retry`) with the item's `at` as read: no dialog, the
     * row says "saving" (its button disabled, a second click sends nothing);
     * taken, the item leaves at once and the toast says whether the agent
     * takes it up now or at its next start. Refused, the row says why without
     * "Try again" (the button stays in the detail): it waits for something
     * else now (drawn as the research says it), it cannot go back, the
     * research not answering; back three times in 24 hours, the item shows the
     * limit in place of its button until the next status. The overview's own
     * window waits for the outcome.
     */
    async retryWaitingItem(s: LiveSession, w: LiveWaiting): Promise<WaitingRetryResult | null> {
        const task = researchTaskRef(w.id);
        if (!task || !w.retry?.can || !this.liveWaitingWrites(s).retry) return null;
        const st = writeState(s);
        if (st.pending.get(w.id)?.until === Infinity) return null;
        const back = st.pending.get(w.id);
        const phase = waitingPhase(st.raw.find(x => x.id === w.id) ?? w);
        const fromRow = focusInRow(w.id);
        st.pending.set(w.id, { phase, until: Infinity });
        this.startWaitingRows(s, [w.id]);
        this.reshowLiveWaiting(s);
        let result: WaitingRetryResult;
        try {
            const before = await this.waitingHeadBeforeWrite(s);
            result = await retryWaiting(s.bridge.base, task, { expect: w.at });
            this.takeWaitingWriteHead(s, before, result);
        } finally {
            if (back) st.pending.set(w.id, back);
            else st.pending.delete(w.id);
        }
        const lang = getCurrentLanguage();
        let refused: string | null = null;
        if (result.ok) {
            st.pending.set(w.id, { phase, gone: true, until: Date.now() + WAITING_SETTLE_MS });
        } else if (result.code === 'limit') {
            // Held by the limit (§6): the item says when it can go back again, its button gone, until the next status.
            const until = result.until;
            st.raw = st.raw.map(x => x.id === w.id && x.retry ? { ...x, retry: { ...x.retry, can: false, ...(until ? { until } : {}) } } : x);
        } else {
            refused = waitingRetryRefusedText(result, lang);
        }
        this.endWaitingRows(s, [w.id], refused ? { text: refused, phase } : null);
        if (!stillFollowing(s)) return result;
        this.reshowLiveWaiting(s);
        this.researchStatusAfterWrite(s);
        if (result.ok) {
            const R = strings.live.waitingRetry;
            const running = s.working.some(x => !x.paused) || (s.runs?.length ?? 0) > 0;
            this.showToast(running ? R.doneRunning : R.doneIdle, 6000, { kind: 'waiting-retried' });
        } else if (refused) {
            this.sayWaitingRowRefused(w.id, refused, fromRow);
        } else if (!rowSeen(w.id)) {
            this.showToast(waitingRetryRefusedText(result, lang), 6000, { kind: 'waiting-failed' });
        }
        return result;
    },

    /**
     * "Retry all with the agent" of a place (spec 089 §4, §5) through the
     * bridge (`waiting.retry`): every item of the place that can go back says
     * "saving" in its row; the items the research took back leave at once and
     * the toast says how many; nothing taken (refused, none of them could go
     * back), the toast says why and the rows stay. The overview's own window
     * waits for the outcome (its confirmation closes then).
     */
    async retryWaitingGroup(s: LiveSession, key: string): Promise<GroupRetryResult | null> {
        if (!this.liveWaitingWrites(s).retry) return null;
        const st = writeState(s);
        if (st.groups.has(key)) return null;
        const items = s.waiting.filter(w => w.group?.key === key && w.retry?.can === true && !!researchTaskRef(w.id)
            && st.pending.get(w.id)?.until !== Infinity);
        if (items.length === 0) return null;
        const ids = items.map(w => w.id);
        const back = new Map(ids.map(id => [id, st.pending.get(id)]));
        const phases = new Map(ids.map(id => [id, waitingPhase(st.raw.find(x => x.id === id) ?? items.find(x => x.id === id)!)]));
        for (const id of ids) st.pending.set(id, { phase: phases.get(id)!, until: Infinity });
        st.groups.add(key);
        this.startWaitingRows(s, ids);
        this.reshowLiveWaiting(s);
        let result: GroupRetryResult;
        try {
            const before = await this.waitingHeadBeforeWrite(s);
            result = await retryGroup(s.bridge.base, key);
            this.takeWaitingWriteHead(s, before, result);
        } finally {
            st.groups.delete(key);
            for (const [id, was] of back) {
                if (was) st.pending.set(id, was);
                else st.pending.delete(id);
            }
        }
        const taken = result.ok ? new Set(result.retried) : new Set<string>();
        const gone = ids.filter(id => taken.has(researchTaskRef(id)!));
        const settle = Date.now() + WAITING_SETTLE_MS;
        for (const id of gone) st.pending.set(id, { phase: phases.get(id)!, gone: true, until: settle });
        this.endWaitingRows(s, ids, null);
        if (!stillFollowing(s)) return result;
        this.reshowLiveWaiting(s);
        this.researchStatusAfterWrite(s);
        const R = strings.live.waitingRetry;
        const lang = getCurrentLanguage();
        if (result.ok && result.retried.length > 0) {
            this.showToast(R.groupDone(R.tasks(gone.length || result.retried.length)), 6000, { kind: 'waiting-retried' });
        } else {
            // None of the place could go back: as a task that cannot go back any more.
            this.showToast(groupRetryFailText(result.ok ? { code: 'not' } : result, lang), 6000, { kind: 'waiting-failed' });
        }
        return result;
    },

    /**
     * One image of "Add images" (spec 048 §3) through the bridge, its number,
     * Replace and progress; the research's new head taken as the tree's own.
     */
    async uploadWaitingImage(s: LiveSession, task: string, file: File,
        opts: { image: number | null; replace: boolean; onProgress: (sent: number, total: number) => void }): Promise<TaskImageResult> {
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await uploadTaskImage(s.bridge.base, task, file, { ...opts, maxBytes: s.accepts?.mediaMaxBytes });
        this.takeWaitingWriteHead(s, before, result);
        return result;
    },

    /**
     * "Add images" finished: the task woke with its last image (the row goes
     * at once, the toast says so) or is gone (the row goes silently);
     * otherwise the images saved are taken as seen here (not lit as arrived)
     * and the sentence of how it stands comes back ("✓ 1 of 2 images saved –
     * image 58 missing. The task keeps waiting."); null: nothing to say.
     */
    settleWaitingImages(s: LiveSession, w: LiveWaiting, outcome: UploadOutcome): string | null {
        const following = stillFollowing(s);
        if (outcome.woken || outcome.gone) {
            writeState(s).pending.set(w.id, { phase: waitingPhase(w), gone: true, until: Date.now() + WAITING_SETTLE_MS });
            if (following) {
                this.reshowLiveWaiting(s);
                this.researchStatusAfterWrite(s);
            }
            if (outcome.woken) this.showToast(strings.live.waitingTask.imagesAll, 6000, { kind: 'waiting-images' });
            return null;
        }
        if (following) this.researchStatusAfterWrite(s);
        // Files not added (the same as an image taken already) are said after how it stands.
        const notes = outcome.notes.slice(0, 5).join(' ') + (outcome.notes.length > 5 ? ' …' : '');
        if (outcome.saved === 0) return notes || null;
        const now = outcome.inbox ? imagesState({ ...w, inbox: outcome.inbox }) : null;
        takeOwnImages(itemKey(s, w.id), now);
        return `✓ ${now ? `${imagesSentence(now)} ` : ''}${strings.live.waitingTask.stillWaits}${notes ? ` ${notes}` : ''}`;
    },

    /**
     * "Add a file" at a task: an image or PDF picked here goes to the research
     * with the task's id. The system's dialog with nothing shown, the button
     * only guarded against a second dialog; a choice called off gives it back
     * at once (9c).
     */
    pickWaitingFile(s: LiveSession, w: LiveWaiting, origin: HTMLElement | null = activatedElement()): void {
        const task = researchTaskRef(w.id);
        if (!task || !this.liveWaitingWrites(s).file || !waitingFileWritable(w)) return;
        if (isPicking(origin)) return;
        document.querySelector('input.waiting-file-input')?.remove();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = WAITING_FILE_ACCEPT;
        input.className = 'waiting-file-input';
        input.hidden = true;
        input.dataset.task = task;
        input.addEventListener('cancel', () => input.remove());
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            const from = takePickOrigin(input);
            input.remove();
            if (file) void this.sendWaitingFile(s, task, file, from, () => this.pickWaitingFile(s, w, from));
        });
        document.body.appendChild(input);
        openFilePicker(input, origin);
    },

    /**
     * The file sent as the button's working state (9c): "Sending…", above it
     * the line "Sending <name> to the research… 1.2 MB"; a refusal is a
     * sentence at the button with "Choose another file" (a file the research
     * does not take) or "Try again". Without the button, toasts as before.
     */
    async sendWaitingFile(s: LiveSession, task: string, file: File, origin: HTMLElement | null = null,
        again?: () => void): Promise<void> {
        const W = strings.live.waitingWrite;
        const shown = !!origin && origin.isConnected;
        const other = again ? { label: strings.busy.pickOther, run: again } : undefined;
        if (!waitingFileTaken(file)) {
            if (shown && origin) {
                showBusyMessage(origin, { ok: false, kind: 'error', text: W.fileType, ...(other ? { alt: other } : {}) });
            } else {
                this.showToast(W.fileType, 6000, { kind: 'waiting-failed' });
            }
            return;
        }
        const why: Partial<Record<WaitingWriteRefused['code'], string>> = {
            'too-large': W.fileTooLarge, type: W.fileType, full: W.fileFull, none: W.fileGone, 'no-file': W.fileNotTaken,
            failed: W.writeFailed, 'bad-body': W.badBody, locked: W.locked, busy: W.busy, 'app-only': W.appOnly,
        };
        const send = (): Promise<WaitingFileResult | null> => this.writeWaitingFile(s, task, file);
        const silent = strings.busy.mainWindowSilent;
        if (!shown || !origin) {
            this.showToast(W.fileSending(file.name), Infinity, { spinner: true, kind: 'waiting-file' });
            const result = await send();
            if (!result) {
                this.showToast(silent, 6000, { kind: 'waiting-failed' });
                return;
            }
            if (result.ok) {
                this.showToast(W.fileSent, 4000, { kind: 'waiting-file-sent' });
                return;
            }
            this.showToast(why[result.code] ?? W.fileFailed, 6000, { kind: 'waiting-failed' });
            return;
        }
        const line = busyStep(origin, `${W.fileSending(file.name)} ${formatBytes(file.size)}`);
        await runBusy(origin, async ctl => {
            try {
                const result = await send();
                // The overview's own window: its main window did not answer (§11.2).
                if (!result) {
                    ctl.end({ ok: false, kind: 'timeout', text: silent, retry: () => { void this.sendWaitingFile(s, task, file, origin, again); } });
                    return;
                }
                if (result.ok) {
                    // The row stays as it was: the toast says the file went.
                    this.showToast(W.fileSent, 4000, { kind: 'waiting-file-sent' });
                    return;
                }
                const text = why[result.code] ?? W.fileFailed;
                // A file the research does not take: another one; a research busy or a failed write: once more.
                const pick = result.code === 'too-large' || result.code === 'type' || result.code === 'no-file';
                const retry = result.code === 'busy' || result.code === 'locked' || result.code === 'failed';
                ctl.end({
                    ok: false, kind: 'error', text,
                    ...(pick && other ? { alt: other } : {}),
                    ...(retry ? { retry: () => { void this.sendWaitingFile(s, task, file, origin, again); } } : {}),
                });
            } finally {
                line.clear();
            }
        }, { label: strings.busy.sending, kind: 'local' });
    },

    /**
     * A file written to a task through the bridge (`PUT media/<sha>` with the task), the research's version taken
     * in. The overview's own window asks its main window instead (null there: the main window did not answer).
     */
    async writeWaitingFile(s: LiveSession, task: string, file: File): Promise<WaitingFileResult | null> {
        const before = await this.waitingHeadBeforeWrite(s);
        const result = await putWaitingFile(s.bridge.base, task, file, { maxBytes: s.accepts?.mediaMaxBytes });
        this.takeWaitingWriteHead(s, before, result);
        if (result.ok && stillFollowing(s)) this.researchStatusAfterWrite(s);
        return result;
    },

    /**
     * The day a request went out, asked under its button (spec 149 K2.1): `sent` an item's Sent, `group` a place's
     * (one day for all), `change` a sent item's day. Without `waiting.sentDay` a Sent goes at once as before (today)
     * and there is no change of the day. Cancelled: nothing is written, the button works again.
     */
    askWaitingSentDay(s: LiveSession, anchor: HTMLElement, ask: { kind: 'sent' | 'change'; w: LiveWaiting } | { kind: 'group'; key: string; n: number }): void {
        const writes = this.liveWaitingWrites(s);
        if (!writes.sent) return;
        if (!writes.sentDay) {
            if (ask.kind === 'sent') void this.markWaitingSent(s, ask.w);
            else if (ask.kind === 'group') void this.markWaitingGroupSent(s, ask.key);
            return;
        }
        const W = strings.live.waitingWrite;
        const now = Date.now();
        const shown = ask.kind === 'change' ? s.waiting.find(x => x.id === ask.w.id) ?? ask.w : null;
        const day = (shown && waitingSentDayOf(shown)) || localDayOf(now);
        const btn = anchor instanceof HTMLButtonElement ? anchor : null;
        let saved = false;
        openSentDayPopover({
            anchor, day, now,
            labels: {
                title: ask.kind === 'change' ? W.changeSentDay : W.sentDayTitle,
                ...(ask.kind === 'group' && ask.n > 1 ? { note: W.sentDayGroup(ask.n) } : {}),
                save: W.sentDaySave, cancel: W.sentDayCancel, future: W.sentDayFuture,
            },
            onSave: (d) => {
                saved = true;
                if (ask.kind === 'sent') void this.markWaitingSent(s, ask.w, d);
                else if (ask.kind === 'group') void this.markWaitingGroupSent(s, ask.key, d);
                else void this.changeWaitingSentDay(s, ask.w, d);
            },
            onClose: () => {
                if (!saved && btn) btn.disabled = false;
            },
        });
    },

    /** A write button (no research mark: it stays here); one click only. */
    waitingWriteButton(label: string, action: string, run: () => void, cls = 'research-overview__waiting-action',
        oneClick = true): HTMLButtonElement {
        const btn = el('button', `live-waiting-answer ${cls} research-overview__waiting-write`, label);
        btn.type = 'button';
        btn.dataset.action = action;
        btn.dataset.write = 'bridge';
        btn.onclick = (e) => {
            e.stopPropagation();
            // Rows moved under the pointer a moment ago: the click was meant for the row before (drobnost 109 U4).
            if (btn.disabled || shiftHeld(WAITING_ROWS_SCOPE, e)) return;
            // "Add a file" keeps the button: its dialog guards it, a choice called off gives it back (9c).
            if (oneClick) btn.disabled = true;
            run();
        };
        return btn;
    },
});
