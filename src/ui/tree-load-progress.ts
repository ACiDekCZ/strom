/**
 * Loading the research's version (waiting buttons §2.3, 2e): one progress
 * toast "Loading the tree from the research…" from the click to the tree
 * redrawn. While the file downloads, a bar of known share and "1.4 MB of
 * 3.2 MB" when the bridge says its size (`Content-Length`), else a bar of
 * unknown share and the megabytes so far, with Cancel (the tree stays as it
 * was); then "Processing N people" (no Cancel). A question asked on the way
 * (the Load dialog) hides it, and it comes back after the answer. Edits wait
 * meanwhile (TreeEditLock, §2.6) and leaving the page asks first (§2.7).
 * A failure or the time limit: the toast says it (the tree unchanged) with
 * Try again.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { showProgressToast, type ProgressToastHandle, type ProgressStep } from './toast.js';
import { busyErrFromBridge, setBusy, nextPaint } from './busy.js';
import { TreeEditLock } from './tree-edit-lock.js';
import { holdLeave } from './busy-leave.js';

/** What a download of the tree tells while it runs (fetchResearchTree's `watch`). */
export interface TreeDownloadWatch {
    /** Cancel (the person's, not the time limit). */
    signal?: AbortSignal;
    /** Bytes so far, of `total` (null: not said). */
    progress?(loaded: number, total: number | null): void;
}

const MB = 1024 * 1024;

/** Megabytes with one decimal in the language's own way ("1,4 MB", "1.4 MB"). */
export function formatMb(bytes: number, lang: string = getCurrentLanguage()): string {
    const mb = Math.max(0, bytes) / MB;
    // Under a tenth of a megabyte: a tenth (never "0.0 MB" for a file on its way).
    const shown = bytes > 0 ? Math.max(0.1, mb) : 0;
    let num: string;
    try {
        num = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(shown);
    } catch {
        num = shown.toFixed(1);
    }
    return strings.busy.mb(num);
}

/**
 * The step of a download: a known share and "1.4 MB of 3.2 MB" when the size is said (and not passed: a
 * compressed answer counts more than it said), else a bar of unknown share and the megabytes so far.
 */
export function downloadStep(loaded: number, total: number | null, lang: string = getCurrentLanguage()): Required<Pick<ProgressStep, 'size' | 'percent'>> {
    if (total && total > 0 && loaded <= total) {
        return { percent: Math.round((loaded / total) * 100), size: strings.busy.sizeOf(formatMb(loaded, lang), formatMb(total, lang)) };
    }
    return { percent: null, size: loaded > 0 ? formatMb(loaded, lang) : '' };
}

/** The people of a GEDCOM file (its INDI records), counted without parsing it. */
export function countGedcomPersons(text: string): number {
    const m = text.match(/^0 @[^@\r\n]+@ INDI\b/gm);
    return m ? m.length : 0;
}

/** Read a response's body, telling its progress (`watch`); without a stream reader, whole. */
export async function readBodyWithProgress(res: Response, watch?: TreeDownloadWatch): Promise<ArrayBuffer> {
    const body = res.body;
    if (!watch?.progress || !body || typeof body.getReader !== 'function') return res.arrayBuffer();
    const said = Number(res.headers?.get('content-length') ?? '');
    const total = Number.isFinite(said) && said > 0 ? said : null;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    watch.progress(0, total);
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            loaded += value.byteLength;
            watch.progress(loaded, total);
        }
    }
    const out = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
    }
    return out.buffer;
}

/** A load of the research's version on its way (startTreeLoad). */
export interface TreeLoadRun {
    /** For the download (fetchResearchTree). */
    readonly watch: TreeDownloadWatch;
    /** Cancelled by the person (nothing changed). */
    readonly cancelled: boolean;
    /** The file is in: its people are being processed (Cancel goes). */
    processing(persons: number): Promise<void>;
    /** A question is asked on the way: the toast goes meanwhile. */
    pause(): void;
    /** The answer came: the toast again, processing. */
    resume(): void;
    /** It failed: said (the tree unchanged), with Try again. */
    fail(err: unknown): void;
    /** Done (or nothing to do): the toast goes, the lock ends. */
    done(): void;
}

let current: TreeLoadRun | null = null;

/** The load of the research's version on its way (null: none). */
export function currentTreeLoad(): TreeLoadRun | null {
    return current;
}

/**
 * Start a load of the research's version: its toast at once, the edits locked, leaving asked. `el`: the
 * element of the click (its working state until the end); `retry`: Try again after a failure.
 */
export function startTreeLoad(opts: { el?: HTMLElement | null; retry?: () => void; treeId?: string | null } = {}): TreeLoadRun {
    const b = strings.busy;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    let cancelled = false;
    let ended = false;
    let persons = 0;
    let step: ProgressStep = { percent: null };
    let toast: ProgressToastHandle | null = null;
    const release = TreeEditLock.hold('load');
    const releaseLeave = holdLeave('load', opts.treeId ?? null);
    const el = opts.el && opts.el.isConnected ? opts.el : null;
    if (el) setBusy(el, true, { label: b.generic, kind: 'local' });
    let lastDraw = 0;
    const open = (): void => {
        toast = showProgressToast({ title: b.loadingTree, lockEdits: b.editsWaitShort, cancel: () => run.cancel() }, step);
        toast.el.dataset.kind = 'tree-load';
    };
    const end = (): void => {
        ended = true;
        release();
        releaseLeave();
        if (el) setBusy(el, false);
        if (current === run) current = null;
    };
    const run = {
        watch: {
            ...(ac ? { signal: ac.signal } : {}),
            progress(loaded: number, total: number | null) {
                if (ended || step.cancel === false) return;
                step = { ...downloadStep(loaded, total), cancel: true };
                // A redraw at most every 100 ms (a fast local bridge sends many small parts).
                const now = Date.now();
                if (now - lastDraw < 100 && !(total && loaded >= total)) return;
                lastDraw = now;
                toast?.update(step);
            },
        } as TreeDownloadWatch,
        get cancelled() { return cancelled; },
        cancel(): void {
            if (ended || step.cancel === false) return;
            cancelled = true;
            ac?.abort();
            toast?.close();
            toast = null;
            end();
        },
        async processing(n: number): Promise<void> {
            if (ended) return;
            persons = n;
            step = { step: b.processing(n), percent: null, cancel: false };
            if (toast) toast.update({ ...step, size: '' });
            // The step is painted before the heavy parse (§8).
            await nextPaint();
        },
        pause(): void {
            toast?.close();
            toast = null;
        },
        resume(): void {
            if (ended || toast) return;
            step = { step: persons ? b.processing(persons) : '', percent: null, cancel: false };
            open();
        },
        fail(err: unknown): void {
            if (ended) return;
            const why = busyErrFromBridge(err, { timeoutMs: 120_000 }).text;
            if (!toast) open();
            const t = toast as ProgressToastHandle | null;
            t?.fail(`${why} ${b.treeUnchanged}`, opts.retry ? { label: b.retry, run: opts.retry } : undefined, { title: b.loadFailed });
            // Still the load's toast: over a device's start screen (its chooser of trees) as its progress was.
            if (t) t.el.dataset.kind = 'tree-load';
            toast = null;
            end();
        },
        done(): void {
            if (ended) return;
            toast?.done();
            toast = null;
            end();
        },
    };
    open();
    current = run;
    return run;
}
