/**
 * The warnings before the app runs out of the memory one page may use
 * (spec 135, P2/P3; the estimate: src/memory-limit.ts).
 *
 * - A tree near the limit while it is open: one notice (a toast that can be
 *   closed) once per session and tree, after it is opened or after a change.
 *   The tree's size is measured on the idle time a few seconds after the
 *   tree is opened, and after an edit at most once a minute (a walk over the
 *   data, no JSON string built).
 * - Before an output with the images (the export dialog, saving to a file,
 *   the working file, sharing, the book, the family pages, the poster): a
 *   confirm, Continue or Cancel; where the output can leave the images out
 *   (the export dialog's Content), a checkbox to do so. A file written a few
 *   images at a time asks only much later than one that holds its images
 *   whole (src/memory-limit.ts).
 * - Before reading a large file: a confirm, Continue or Cancel.
 *
 * `window.Strom.MemoryLimit` (tests): `setLimit(bytes | null)` stands in for
 * the browser's limit, `check()` measures and decides at once.
 */

import { strings } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { StromData, TreeId } from '../types.js';
import { getUI } from '../ui-ref.js';
import { showToast } from './toast.js';
import { getWindowRegistry } from '../windows/window-start.js';
import { getWindowRole } from '../windows/window-role.js';
import {
    heapLimit, steadyHeap, nearLimitSteady, nearLimitOutput, nearLimitImport,
    treeImageChars, jsonBytesWithoutImages, type ImageContent,
} from '../memory-limit.js';

/** After the tree is opened: its size measured this long after (the first drawing goes first). */
const OPEN_DELAY_MS = 3000;
/** After an edit: measured this long after the last one... */
const EDIT_DELAY_MS = 10_000;
/** ...and at most this often. */
const EDIT_INTERVAL_MS = 60_000;
/** How long the notice stays (it can be closed sooner). */
const NOTICE_MS = 20_000;
/** sessionStorage: the trees the notice was shown for in this session. */
const NOTICE_KEY = 'strom-memory-notice';

/** The limit tests put in place of the browser's (null: the browser's). */
let testLimit: number | null = null;
/** The open tree's JSON without images, as last measured. */
let measured: { treeId: TreeId | null; bytes: number; at: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Trees the notice was shown for (when sessionStorage cannot keep it). */
const shownHere = new Set<string>();

interface PerfMemory { jsHeapSizeLimit?: number; usedJSHeapSize?: number }

function perfMemory(): PerfMemory | null {
    const p = typeof performance !== 'undefined' ? (performance as Performance & { memory?: PerfMemory }) : null;
    return p?.memory ?? null;
}

/** The limit L now. */
export function currentLimit(): number {
    if (testLimit !== null) return testLimit;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return heapLimit({ jsHeapSizeLimit: perfMemory()?.jsHeapSizeLimit ?? null, coarse });
}

/** The app's other windows open now. */
function otherWindows(): number {
    try {
        return getWindowRegistry()?.size ?? 0;
    } catch {
        return 0;
    }
}

/** Measure the open tree's JSON without images now. */
function measureNow(): number {
    const treeId = DataManager.getCurrentTreeId();
    let bytes = 0;
    try {
        bytes = jsonBytesWithoutImages(DataManager.getData());
    } catch {
        bytes = 0;
    }
    measured = { treeId, bytes, at: Date.now() };
    return bytes;
}

/** The steady heap H (the open tree measured again when it is not the one measured last). */
function steadyNow(): number {
    const treeId = DataManager.getCurrentTreeId();
    const bytes = measured && measured.treeId === treeId ? measured.bytes : measureNow();
    return steadyHeap(bytes, otherWindows());
}

function noticeShown(treeId: string): boolean {
    if (shownHere.has(treeId)) return true;
    try {
        const list = JSON.parse(sessionStorage.getItem(NOTICE_KEY) ?? '[]') as unknown;
        return Array.isArray(list) && list.includes(treeId);
    } catch {
        return false;
    }
}

function markNoticeShown(treeId: string): void {
    shownHere.add(treeId);
    try {
        const list = JSON.parse(sessionStorage.getItem(NOTICE_KEY) ?? '[]') as unknown;
        const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
        if (!ids.includes(treeId)) ids.push(treeId);
        sessionStorage.setItem(NOTICE_KEY, JSON.stringify(ids));
    } catch { /* kept in this window only */ }
}

/**
 * Measure the open tree and show the notice when it is near the limit (once
 * per session and tree). Whether it is near.
 */
export function checkMemoryNotice(): boolean {
    const treeId = DataManager.getCurrentTreeId();
    measureNow();
    const near = nearLimitSteady(steadyNow(), currentLimit(), testLimit === null ? perfMemory()?.usedJSHeapSize ?? null : null);
    if (!near || !treeId || noticeShown(treeId)) return near;
    markNoticeShown(treeId);
    const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
    showToast(strings.memoryLimit.notice(name), NOTICE_MS, { closable: true, notice: true, hold: true, kind: 'memory-limit' });
    return near;
}

/** Check on the idle time after `delay` (a check already waiting is moved). */
function schedule(delay: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        const run = (): void => { checkMemoryNotice(); };
        const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
        if (idle) idle(run, { timeout: 5000 });
        else run();
    }, delay);
}

/** Start watching the open tree (the main window only; a satellite has the main window's tree). */
export function initMemoryLimitNotice(): void {
    if (getWindowRole() === 'satellite') return;
    window.addEventListener('strom:tree-switched', () => { measured = null; schedule(OPEN_DELAY_MS); });
    window.addEventListener('strom:data-changed', () => { measured = null; schedule(OPEN_DELAY_MS); });
    window.addEventListener('strom:user-change', () => {
        const since = measured ? Date.now() - measured.at : Infinity;
        schedule(Math.max(EDIT_DELAY_MS, EDIT_INTERVAL_MS - since));
    });
    schedule(OPEN_DELAY_MS);
}

/** What an output carries, for its check. */
export interface OutputCheck {
    /** Every tree goes into the file. */
    allTrees?: boolean;
    /** The data the file is made from (default: the open tree). */
    data?: StromData | null;
    /** The tree's name in the question (default: the open tree's). */
    treeId?: TreeId | null;
    /** Which images go in (default: all). */
    content?: ImageContent;
    /** The output can leave its images out: the question offers it. */
    canLeaveOut?: boolean;
    /**
     * The output holds its images whole (sealed under a password, the book,
     * the family pages, the poster, the change packet); else it is written a
     * few images at a time.
     */
    whole?: boolean;
    /**
     * The output reads its images a few at a time and keeps none (the gift
     * package, 1127): their volume does not count, only the steady heap;
     * the question still names it and offers to leave them out.
     */
    streamed?: boolean;
    /**
     * The images' volume the output really carries, when it carries only
     * some of the tree's (the family pages' set, the poster's portraits):
     * worked out only when the tree's images would be near the limit.
     */
    refine?: () => number;
    /** What the question names: a file (default), the book, the poster or the gift package. */
    what?: 'file' | 'book' | 'poster' | 'gift';
}

/** The images' volume of an output (all trees: the stored sizes of the others, the open one measured). */
function outputImageChars(o: OutputCheck): number {
    if (o.allTrees) {
        const openId = DataManager.getCurrentTreeId();
        let n = treeImageChars(DataManager.getData(), o.content);
        for (const t of TreeManager.getTrees()) if (t.id !== openId) n += Math.max(0, t.sizeBytes || 0);
        return n;
    }
    return treeImageChars(o.data ?? DataManager.getData(), o.content);
}

/**
 * The images' volume of an output when it may go past the limit, else null
 * (synchronous: an output that must start in its click, as a window, asks
 * only when this says so).
 */
export function outputNearLimit(o: OutputCheck = {}): number | null {
    const heap = steadyNow();
    const limit = currentLimit();
    const whole = o.streamed ? 'streamed' as const : !!o.whole;
    let chars = outputImageChars(o);
    if (!nearLimitOutput(chars, heap, limit, whole)) return null;
    if (o.refine) {
        chars = Math.max(0, o.refine());
        if (!nearLimitOutput(chars, heap, limit, whole)) return null;
    }
    return chars;
}

/**
 * Before an output with images: 'go' (not near the limit, or Continue),
 * 'without' (Continue with "Leave the images out" ticked) or 'cancel'.
 */
export async function confirmMemoryForOutput(o: OutputCheck = {}): Promise<'go' | 'without' | 'cancel'> {
    const chars = outputNearLimit(o);
    if (chars === null) return 'go';
    const m = strings.memoryLimit;
    const size = TreeManager.formatBytes(chars);
    const treeId = o.treeId ?? DataManager.getCurrentTreeId();
    const name = treeId ? TreeManager.getTreeMetadata(treeId)?.name ?? '' : '';
    const message = o.what === 'book' ? m.book(name, size)
        : o.what === 'poster' ? m.poster(size)
            : o.what === 'gift' ? m.gift(size)
            : o.allTrees ? m.outputAll(size) : m.output(name, size);
    const ui = getUI();
    const leaveOut = !!o.canLeaveOut && chars > 0;
    const asked = ui.showConfirm(message, m.title, {
        confirmLabel: m.continue,
        ...(leaveOut ? { checkbox: { label: o.what === 'gift' ? m.leaveOutGift : m.leaveOut, checked: false } } : {}),
    });
    // Asked from the export dialog: above it (the next confirm sets its own classes).
    document.getElementById('confirmation-modal')?.classList.add('over-dialog');
    const ok = await asked;
    if (!ok) return 'cancel';
    return leaveOut && ui.confirmChecked ? 'without' : 'go';
}

/** Before reading a file of `size` bytes: whether to go on (not near the limit, or Continue). */
export async function confirmMemoryForImport(size: number, name: string): Promise<boolean> {
    if (!nearLimitImport(size, steadyNow(), currentLimit())) return true;
    const m = strings.memoryLimit;
    return getUI().showConfirm(m.import(name, TreeManager.formatBytes(size)), m.title, { confirmLabel: m.continue });
}

/** The test hook (window.Strom.MemoryLimit). */
export const MemoryLimit = {
    /** Stand in for the browser's limit (bytes); null: the browser's again. */
    setLimit(bytes: number | null): void {
        testLimit = typeof bytes === 'number' && bytes > 0 ? bytes : null;
    },
    /** Measure and decide now (the notice shown when due); whether the open tree is near the limit. */
    check(): boolean {
        return checkMemoryNotice();
    },
    /** The current estimate (bytes). */
    estimate(): { limit: number; heap: number; json: number } {
        const heap = steadyNow();
        return { limit: currentLimit(), heap, json: measured?.bytes ?? 0 };
    },
};
