/**
 * Switching trees in the one working state (waiting buttons §2.3, 2f): the
 * element that asked for the switch (a row of the switcher, the tree
 * manager's Open, the sample tree's button) says "Switching…" until the tree
 * is open. Before it the open tree's edits go to its research when they go by
 * themselves; while the switch really waits for them, a sentence says so
 * ("Sending edits to the research before switching…") with Cancel beside the
 * element — or a progress toast with Cancel when the element went with its
 * menu. Cancel: no switch, the send goes on. No answer within 15 s: no switch,
 * and one sentence says the tree stayed open, with Try again. Edits wait the
 * whole time (TreeEditLock 'switch'); one switch at a time, so a double click
 * switches once.
 */

import { strings } from '../strings.js';
import { runBusy, BUSY_SHOW_MS } from './busy.js';
import { showProgressToast, type ProgressToastHandle } from './toast.js';
import { TreeEditLock } from './tree-edit-lock.js';

/** The switch waits this long at most for the open tree's edits (research-follow-ui SEND_BEFORE_SWITCH_MS). */
export const TREE_SWITCH_SEND_MS = 15_000;

/** How waiting for the open tree's edits ended (research-sync-ui SendBeforeLeave). */
export type TreeSwitchSent = 'none' | 'sent' | 'timeout' | 'cancelled';

export interface TreeSwitchDeps<F extends { sent: TreeSwitchSent }> {
    /** The open tree's edits before it is left: `onWait` when it really waits, `signal` stops the waiting. */
    before(opts: { signal: AbortSignal; onWait: () => void }): Promise<F>;
    /** The switch itself, once the edits went (or nothing waited). */
    go(from: F): Promise<void>;
    /** The same switch once more (the end's Try again). */
    retry(): void;
}

export interface TreeSwitchPlace {
    /** Where the "sending first" sentence stands (the open tree's row); absent: a progress toast says it. */
    sentenceIn?: HTMLElement | null;
    /** Cancel stands after this element (default: the element itself, when it is seen). */
    cancelAfter?: HTMLElement | null;
    /** The row that takes the state when the element goes (the switcher's button for a closed menu). */
    rowOf?: HTMLElement | null;
    /** Where the end's sentence goes (the target's row); absent: a toast. */
    msgIn?: HTMLElement | null;
}

export type TreeSwitchResult = 'switched' | 'cancelled' | 'timeout' | 'busy';

let running: { target: string; ac: AbortController } | null = null;

/** The tree a switch is on its way to (null: none). */
export function treeSwitchRunning(): string | null {
    return running?.target ?? null;
}

/** Stop the switch on its way (its send goes on); false: none. */
export function cancelTreeSwitch(): boolean {
    if (!running) return false;
    running.ac.abort();
    return true;
}

function seen(el: Element | null | undefined): el is HTMLElement {
    return !!el && el.isConnected && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);
}

/** Switch to `target` from `el` (null: no element, e.g. an automatic switch). */
export async function runTreeSwitch<F extends { sent: TreeSwitchSent }>(
    el: HTMLElement | null, target: string, deps: TreeSwitchDeps<F>, place: TreeSwitchPlace = {},
): Promise<TreeSwitchResult> {
    if (running) return 'busy';
    const ac = new AbortController();
    const me = { target, ac };
    running = me;
    // Without a page (a test of the steps alone) the steps run without the state.
    const host = el ?? (typeof document === 'undefined' ? null : document.createElement('span'));
    const release = TreeEditLock.hold('switch');
    let result: TreeSwitchResult = 'cancelled';

    // The waiting said: a sentence and Cancel at the rows, or a progress toast.
    let sayTimer: ReturnType<typeof setTimeout> | null = null;
    let sentence: HTMLElement | null = null;
    let cancelBtn: HTMLButtonElement | null = null;
    let toast: ProgressToastHandle | null = null;
    const cancel = (): void => { ac.abort(); };
    const say = (): void => {
        sayTimer = null;
        if (ac.signal.aborted) return;
        const after = place.cancelAfter ?? (seen(el) ? el : null);
        if (seen(place.sentenceIn) && seen(after)) {
            sentence = document.createElement('div');
            sentence.className = 'busy-msg tree-switch-wait';
            sentence.setAttribute('role', 'status');
            const text = document.createElement('span');
            text.className = 'busy-msg__text';
            text.textContent = strings.busy.beforeSwitchSend;
            sentence.appendChild(text);
            place.sentenceIn.appendChild(sentence);
            cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'link tree-switch-cancel';
            cancelBtn.textContent = strings.buttons.cancel;
            cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
            after.after(cancelBtn);
            return;
        }
        toast = showProgressToast({ title: strings.busy.switching, cancel }, { step: strings.busy.beforeSwitchSend });
        toast.el?.classList.add('tree-switch-toast');
    };
    const unsay = (): void => {
        if (sayTimer) clearTimeout(sayTimer);
        sayTimer = null;
        sentence?.remove();
        cancelBtn?.remove();
        sentence = cancelBtn = null;
        toast?.close();
        toast = null;
    };
    try {
        const work = async (ctl: { end(e: { ok: false; kind: 'timeout'; text: string; retry: () => void }): void }): Promise<void> => {
            const from = await deps.before({
                signal: ac.signal,
                // Said only when the wait lasts (a quick send does not blink).
                onWait: () => { if (!sayTimer && !sentence && !toast) sayTimer = setTimeout(say, BUSY_SHOW_MS); },
            });
            unsay();
            if (from.sent === 'cancelled' || ac.signal.aborted) { result = 'cancelled'; return; }
            if (from.sent === 'timeout') {
                result = 'timeout';
                ctl.end({ ok: false, kind: 'timeout', text: strings.busy.switchNotSent(Math.round(TREE_SWITCH_SEND_MS / 1000)), retry: deps.retry });
                return;
            }
            await deps.go(from);
            result = 'switched';
        };
        if (!host) await work({ end: () => undefined });
        else await runBusy(host, work, {
            label: strings.busy.switching,
            toastWhenGone: false,
            ...(place.rowOf ? { rowOf: place.rowOf } : {}),
            ...(place.msgIn ? { msgIn: place.msgIn } : { endToast: true }),
        });
    } finally {
        unsay();
        release();
        if (running === me) running = null;
    }
    return result;
}

/** For the tests: no switch on its way. */
export function resetTreeSwitch(): void {
    running?.ac.abort();
    running = null;
}
