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

import { strings, getCurrentLanguage } from '../strings.js';
import { LiveWaiting, researchTaskRef } from '../research-link.js';
import {
    WaitingWrites, WaitingPending, WaitingSentResult, WaitingWriteRefused, GroupNoteDone, NO_WAITING_WRITES, WAITING_SETTLE_MS, WAITING_FILE_ACCEPT,
    waitingWrites, waitingGroupSendable, waitingTaskIds, waitingFileWritable, waitingWrittenPhase, applyWaitingPending, settleWaitingPending, waitingSentDay, waitingFileTaken,
    postWaitingSent, postGroupSent, postGroupUnsent, getGroupNote, putWaitingFile,
} from '../research-waiting-write.js';
import { WaitingPhase, waitingPhase } from '../research-waiting.js';
import { uiModule } from './module.js';
import { el, liveSession, LiveSession } from './research-ui.js';
import { normalizeModal } from './modal-skeleton.js';

const NOTE_ID = 'waiting-note-modal';

interface WriteState {
    /** The research's own list, as its last status had it. */
    raw: LiveWaiting[];
    /** Rows moved by a write not yet in that list. */
    pending: Map<string, WaitingPending>;
    /** Places whose "Sent" runs. */
    groups: Set<string>;
}

const states = new WeakMap<LiveSession, WriteState>();

function writeState(s: LiveSession): WriteState {
    let st = states.get(s);
    if (!st) {
        st = { raw: [...s.waiting], pending: new Map(), groups: new Set() };
        states.set(s, st);
    }
    return st;
}

/** The session the write was made in still runs (following ended or went elsewhere: nothing to show). */
function stillFollowing(s: LiveSession): boolean {
    return liveSession() === s && !s.ended;
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
        case 'failed': return W.writeFailed;
        default: return W.failed;
    }
}

export const researchWaitingWriteMethods = uiModule({
    /** What the followed research's bridge takes from "Awaiting action". */
    liveWaitingWrites(s: LiveSession | null = liveSession()): WaitingWrites {
        if (!s || s.ended) return NO_WAITING_WRITES;
        return waitingWrites({ features: s.features, accepts: s.accepts });
    },

    /** A new status: its list, with the rows a write moved and the research has not reported yet. */
    liveWaitingShown(s: LiveSession, raw: LiveWaiting[]): LiveWaiting[] {
        const st = writeState(s);
        st.raw = [...raw];
        settleWaitingPending(st.pending, raw);
        return applyWaitingPending(raw, st.pending);
    },

    /** Show the list again after a move (the menu's count, the panel, the overview). */
    reshowLiveWaiting(s: LiveSession): void {
        const st = writeState(s);
        s.waiting = applyWaitingPending(st.raw, st.pending);
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
                const at = phase === 'sent' ? st.pending.get(ids[0])?.sentAt : undefined;
                for (const id of said) {
                    if (!ids.includes(id) && st.raw.some(w => w.id === id)) st.pending.set(id, { phase, ...(at ? { sentAt: at } : {}), until });
                }
            }
        } else if (result.code === 'none') {
            for (const id of ids) st.pending.set(id, { phase, gone: true, until });
        } else {
            for (const id of ids) restore(id);
        }
        if (stillFollowing(s)) {
            this.reshowLiveWaiting(s);
            this.liveStatusSoon(s);
        }
        return result.ok;
    },

    /** "Sent" at an item: written through the bridge, the row in "Awaiting a reply" at once; "Undo" for a few seconds. */
    async markWaitingSent(s: LiveSession, w: LiveWaiting): Promise<void> {
        const task = researchTaskRef(w.id);
        if (!task || !this.liveWaitingWrites(s).sent) return;
        const st = writeState(s);
        // A second click while it is written sends nothing more.
        if (st.pending.get(w.id)?.until === Infinity) return;
        const back = new Map([[w.id, st.pending.get(w.id)]]);
        const now = Date.now();
        st.pending.set(w.id, { phase: 'sent', sentAt: new Date(now).toISOString(), until: Infinity });
        this.reshowLiveWaiting(s);
        const result = await postWaitingSent(s.bridge.base, task, 'sent');
        // The answer says where the task is now (already sent: `sent: []`, phase sent): the row follows it.
        const phase = waitingWrittenPhase(result, task, 'sent');
        if (phase !== 'sent') st.pending.set(w.id, { phase, until: Infinity });
        const ok = this.settleWaitingWrite(s, [w.id], phase, result, back);
        if (!stillFollowing(s)) return;
        const W = strings.live.waitingWrite;
        if (ok && phase === 'sent') {
            this.showToast(W.sentToast(waitingSentDay(now, getCurrentLanguage())), 6000, {
                kind: 'waiting-sent',
                action: { label: W.undo, run: () => { void this.markWaitingUnsent(s, w.id); } },
            });
        } else if (!result.ok && result.code !== 'none') {
            this.showToast(refusedText(result), 6000, { kind: 'waiting-failed' });
        }
    },

    /** Back to To do ("Undo" after Sent, or at a sent item). */
    async markWaitingUnsent(s: LiveSession, id: string): Promise<void> {
        const task = researchTaskRef(id);
        if (!task || !this.liveWaitingWrites(s).sent) return;
        const st = writeState(s);
        if (st.pending.get(id)?.until === Infinity) return;
        const back = new Map([[id, st.pending.get(id)]]);
        st.pending.set(id, { phase: 'todo', until: Infinity });
        this.reshowLiveWaiting(s);
        const result = await postWaitingSent(s.bridge.base, task, 'unsent');
        const phase = waitingWrittenPhase(result, task, 'todo');
        if (phase !== 'todo') st.pending.set(id, { phase, until: Infinity });
        const ok = this.settleWaitingWrite(s, [id], phase, result, back);
        if (!stillFollowing(s)) return;
        if (ok && phase === 'todo') this.showToast(strings.live.waitingWrite.unsentToast, 3000, { kind: 'waiting-unsent' });
        else if (!result.ok && result.code !== 'none') this.showToast(refusedText(result), 6000, { kind: 'waiting-failed' });
    },

    /** "Sent" for a whole place: its items to do that offer it move at once; the research writes the place. */
    async markWaitingGroupSent(s: LiveSession, key: string): Promise<void> {
        if (!this.liveWaitingWrites(s).sent) return;
        const st = writeState(s);
        if (st.groups.has(key)) return;
        const items = waitingGroupSendable(s.waiting.filter(w => w.group?.key === key));
        if (items.length === 0) return;
        const ids = items.map(w => w.id);
        const back = new Map(ids.map(id => [id, st.pending.get(id)]));
        const now = Date.now();
        for (const id of ids) st.pending.set(id, { phase: 'sent', sentAt: new Date(now).toISOString(), until: Infinity });
        st.groups.add(key);
        this.reshowLiveWaiting(s);
        let result: WaitingSentResult;
        try {
            result = await postGroupSent(s.bridge.base, key);
        } finally {
            st.groups.delete(key);
        }
        const ok = this.settleWaitingWrite(s, ids, 'sent', result, back, true);
        if (!stillFollowing(s)) return;
        const W = strings.live.waitingWrite;
        if (ok && result.ok) {
            const n = result.sent.length || ids.length;
            // Undo puts back exactly what the bridge said it marked (an answer naming none: no Undo).
            const marked = [...result.sent];
            this.showToast(W.groupSentToast(n, waitingSentDay(now, getCurrentLanguage())), 6000, {
                kind: 'waiting-sent',
                ...(marked.length > 0 ? { action: { label: W.undo, run: () => { void this.markWaitingGroupUnsent(s, key, marked); } } } : {}),
            });
        } else if (!result.ok && result.code !== 'none') {
            this.showToast(refusedText(result), 6000, { kind: 'waiting-failed' });
        }
    },

    /**
     * "Undo" after a place's Sent: exactly the tasks that Sent marked (its
     * answer's list) go back to do through the bridge; their rows move at
     * once, and the answer's `unsent` says which really went back.
     */
    async markWaitingGroupUnsent(s: LiveSession, key: string, marked: readonly string[]): Promise<void> {
        if (!this.liveWaitingWrites(s).sent) return;
        const st = writeState(s);
        if (st.groups.has(key)) return;
        const tasks = waitingTaskIds(marked);
        if (tasks.length === 0) return;
        const ids = tasks.filter(id => st.pending.get(id)?.until !== Infinity
            && s.waiting.some(w => w.id === id && waitingPhase(w) === 'sent'));
        const back = new Map(ids.map(id => [id, st.pending.get(id)]));
        for (const id of ids) st.pending.set(id, { phase: 'todo', until: Infinity });
        st.groups.add(key);
        this.reshowLiveWaiting(s);
        let result: WaitingSentResult;
        try {
            result = await postGroupUnsent(s.bridge.base, key, tasks);
        } finally {
            st.groups.delete(key);
        }
        const ok = this.settleWaitingWrite(s, ids, 'todo', result, back, 'exact');
        if (!stillFollowing(s)) return;
        if (ok) this.showToast(strings.live.waitingWrite.unsentToast, 3000, { kind: 'waiting-unsent' });
        else if (!result.ok && result.code !== 'none') this.showToast(refusedText(result), 6000, { kind: 'waiting-failed' });
    },

    /** "All queries' text" of a place: read from the bridge, shown in a small window with Copy. */
    async showWaitingGroupNote(s: LiveSession, key: string, name: string): Promise<void> {
        if (!this.liveWaitingWrites(s).note) return;
        const result = await getGroupNote(s.bridge.base, key);
        if (!stillFollowing(s)) return;
        const W = strings.live.waitingWrite;
        if (result.ok) {
            this.showWaitingNoteDialog(name, result);
        } else if (result.code === 'none' && result.status !== 200) {
            // The place (or its tasks) is gone meanwhile: nothing to show; the status says what is left.
            this.liveStatusSoon(s);
        } else {
            this.showToast(result.code === 'none' ? W.noteNone : W.noteFailed, 6000, { kind: 'waiting-failed' });
        }
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

    /** "Add a file" at a task: an image or PDF picked here goes to the research with the task's id. */
    pickWaitingFile(s: LiveSession, w: LiveWaiting): void {
        const task = researchTaskRef(w.id);
        if (!task || !this.liveWaitingWrites(s).file || !waitingFileWritable(w)) return;
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
            input.remove();
            if (file) void this.sendWaitingFile(s, task, file);
        });
        document.body.appendChild(input);
        input.click();
    },

    async sendWaitingFile(s: LiveSession, task: string, file: File): Promise<void> {
        const W = strings.live.waitingWrite;
        if (!waitingFileTaken(file)) {
            this.showToast(W.fileType, 6000, { kind: 'waiting-failed' });
            return;
        }
        this.showToast(W.fileSending(file.name), Infinity, { spinner: true, kind: 'waiting-file' });
        const result = await putWaitingFile(s.bridge.base, task, file, { maxBytes: s.accepts?.mediaMaxBytes });
        if (result.ok) {
            this.showToast(W.fileSent, 4000, { kind: 'waiting-file-sent' });
            if (stillFollowing(s)) this.liveStatusSoon(s);
            return;
        }
        const why: Partial<Record<WaitingWriteRefused['code'], string>> = {
            'too-large': W.fileTooLarge, type: W.fileType, full: W.fileFull, none: W.fileGone, 'no-file': W.fileNotTaken,
            failed: W.writeFailed, 'bad-body': W.badBody, locked: W.locked, busy: W.busy, 'app-only': W.appOnly,
        };
        const text = why[result.code] ?? W.fileFailed;
        this.showToast(text, 6000, { kind: 'waiting-failed' });
    },

    /** A write button (no ↗: it stays here); one click only. */
    waitingWriteButton(label: string, action: string, run: () => void, cls = 'research-overview__waiting-action'): HTMLButtonElement {
        const btn = el('button', `live-waiting-answer ${cls} research-overview__waiting-write`, label);
        btn.type = 'button';
        btn.dataset.action = action;
        btn.dataset.write = 'bridge';
        btn.onclick = (e) => {
            e.stopPropagation();
            if (btn.disabled) return;
            btn.disabled = true;
            run();
        };
        return btn;
    },
});
