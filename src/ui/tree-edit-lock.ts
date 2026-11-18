/**
 * The lock on edits while the tree is being replaced (waiting buttons §2.6):
 * loading the research's version, handing the tree to the research, switching
 * trees. Meanwhile an attempt to save an edit (the person dialog's Save, a
 * file dropped on the window, a table cell) makes no change and a toast says
 * why; looking, searching and the windows go on as before. Sending keeps no
 * lock (a snapshot goes; edits made meanwhile wait for the next send).
 *
 *     const release = TreeEditLock.hold('load');
 *     try { ... } finally { release(); }
 *
 *     // at an edit's entry point:
 *     if (TreeEditLock.refuse()) return;
 */

import { strings } from '../strings.js';
import { showToast } from './toast.js';

/** What holds the lock (its sentence: strings.busy.editsWait*). */
export type TreeEditLockReason = 'load' | 'adopt' | 'switch';

interface Hold {
    reason: TreeEditLockReason;
    text?: string;
}

const holds: Hold[] = [];
/** The toast is said once in this long (a key held down, a drag repeating). */
const TOLD_MS = 2000;
let toldAt = 0;

function textOf(h: Hold): string {
    if (h.text) return h.text;
    return h.reason === 'adopt' ? strings.busy.editsWaitAdopt : h.reason === 'switch' ? strings.busy.editsWaitSwitch : strings.busy.editsWaitLoad;
}

export const TreeEditLock = {
    /**
     * Hold the lock until the returned function is called (more holds may stand at once; the last one's
     * sentence is said). `text` over the reason's own sentence.
     */
    hold(reason: TreeEditLockReason, text?: string): () => void {
        const h: Hold = { reason, ...(text ? { text } : {}) };
        holds.push(h);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const i = holds.indexOf(h);
            if (i >= 0) holds.splice(i, 1);
        };
    },

    /** What holds the lock now (null: edits go). */
    held(): TreeEditLockReason | null {
        return holds.length ? holds[holds.length - 1].reason : null;
    },

    /** The sentence of the lock now ('' when none). */
    text(): string {
        return holds.length ? textOf(holds[holds.length - 1]) : '';
    },

    /** At an edit's entry point: true when the lock stands (the edit must not go), said by a toast. */
    refuse(): boolean {
        if (!holds.length) return false;
        const now = Date.now();
        if (now - toldAt >= TOLD_MS) {
            toldAt = now;
            showToast(TreeEditLock.text(), 4000, { kind: 'edit-lock' });
        }
        return true;
    },

    /** For the tests: no lock, the toast said again at once. */
    reset(): void {
        holds.length = 0;
        toldAt = 0;
    },
};
