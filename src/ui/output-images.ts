/**
 * Outputs wait for the tree's photos (spec 116 §8, K1.7): a print, a file,
 * the book or a backup made while photos are still on their way would go
 * out without them. `imagesBeforeOutput` waits first: the element the
 * output was asked from says "Waiting for photos · k of n" (src/ui/busy.ts,
 * a second click starts nothing), the progress toast counts them with
 * Cancel, the indicator "Photos k / n" is held back meanwhile. Some did not
 * come: one alert with why and three actions — Try again, Continue without
 * N photos (the output from the data as they are, the one deliberate way to
 * one without them), Cancel. The decisions are `awaitTreeImages`
 * (src/image-loads.ts, no DOM); this is their look.
 *
 * `imagesReadyForPrint` is the other half of a faithful print: the images
 * of a document loaded lazily are loaded and decoded before `print()`.
 */

import { strings } from '../strings.js';
import {
    awaitTreeImages, imagesToAwait,
    type AwaitImagesChoice, type AwaitImagesResult, type AwaitImagesView, type ImageLoadSnapshot,
} from '../image-loads.js';
import { activatedElement, isBusy, runBusy } from './busy.js';
import { failedReasonText, suspendImageLoadChip } from './image-load-chip.js';
import { showProgressToast, type ProgressToastHandle } from './toast.js';

export type { AwaitImagesResult } from '../image-loads.js';

/** "Waiting for photos · 120 of 860": the line of the output's element (and of the book's window). */
export function waitingLine(s: Pick<ImageLoadSnapshot, 'done' | 'total'>): string {
    return `${strings.photos.waiting} · ${strings.busy.kOfN(s.done, s.total)}`;
}

/** The alert once some did not come: "Some photos did not load (12). The research is not running." */
export function someFailedText(s: Pick<ImageLoadSnapshot, 'failed' | 'reasons'>): string {
    return `${strings.photos.someFailed(s.failed)} ${failedReasonText(s.reasons)}`;
}

/** The output was asked for in a dialog (the poster's, the export's): its wait shows above it, Cancel reachable. */
function overDialog(t: ProgressToastHandle): ProgressToastHandle {
    t.el?.setAttribute('data-output-wait', '');
    return t;
}

/**
 * The wait in the progress toast (8a–8e): its title the output, the step "Waiting for photos", k of n with
 * its bar, Cancel; the indicator held back. `step`: the same count told elsewhere too (the element, the book's
 * window).
 */
export function toastImagesView(o: { step?: (line: string) => void } = {}): AwaitImagesView {
    let toast: ProgressToastHandle | null = null;
    let asking: ProgressToastHandle | null = null;
    let release: (() => void) | null = null;
    return {
        waiting(title, s, cancel) {
            release ??= suspendImageLoadChip();
            const step = { step: strings.photos.waiting, k: s.done, n: s.total, percent: s.total ? Math.round((s.done / s.total) * 100) : 0 };
            if (toast) toast.update(step);
            else toast = overDialog(showProgressToast({ title, cancel }, step));
            o.step?.(waitingLine(s));
        },
        ask(title, s) {
            release ??= suspendImageLoadChip();
            const t = toast ?? overDialog(showProgressToast({ title }));
            toast = null;
            asking = t;
            o.step?.(strings.photos.someFailed(s.failed));
            return new Promise<AwaitImagesChoice>(resolve => {
                const pick = (c: AwaitImagesChoice) => (): void => {
                    if (asking === t) asking = null;
                    resolve(c);
                };
                // Through the bridge, no terminal, no agent: no mark on Try again. Cancel is seen: no ✕.
                t.fail(someFailedText(s), { label: strings.busy.retry, run: pick('retry') }, {
                    title,
                    more: { label: strings.photos.continueWithout(s.failed), run: pick('without') },
                    third: { label: strings.buttons.cancel, run: pick('cancel') },
                });
            });
        },
        close() {
            toast?.close();
            toast = null;
            asking?.close();
            asking = null;
            release?.();
            release = null;
        },
    };
}

/**
 * Wait for the tree's photos before an output (§8.2). Nothing to wait for: 'ready' at once, nothing shown.
 * `el`: the element the output was asked from (default: the one clicked now — call this in the click, before
 * any await); it shows the wait and a second click on it starts nothing ('cancelled' for that click).
 */
export async function imagesBeforeOutput(title: string, o: {
    el?: HTMLElement | null; treeId?: string | null; signal?: AbortSignal; step?: (line: string) => void;
} = {}): Promise<AwaitImagesResult> {
    const el = o.el === undefined ? activatedElement() : o.el;
    if (el && isBusy(el)) return 'cancelled';
    if (!imagesToAwait(o.treeId)) return 'ready';
    const opts = { title, ...(o.signal ? { signal: o.signal } : {}), ...(o.treeId !== undefined ? { treeId: o.treeId } : {}) };
    if (!el) return awaitTreeImages(opts, toastImagesView(o.step ? { step: o.step } : {}));
    let result: AwaitImagesResult = 'cancelled';
    await runBusy(el, async ctl => {
        result = await awaitTreeImages(opts, toastImagesView({ step: line => { ctl.step(line); o.step?.(line); } }));
    }, { kind: 'local', label: strings.photos.waiting });
    return result;
}

// ==================== PRINT ONLY WITH THE IMAGES DRAWN ====================

/** How long a print waits for the images of its document at most (then it prints what is there). */
export const PRINT_IMAGES_MS = 5000;

/** What `imagesReadyForPrint` needs of an image (a test gives its own). */
interface PrintImage {
    loading: string;
    complete: boolean;
    decode(): Promise<void>;
}

/**
 * Before `print()`: every image of `root` loaded and decoded — a lazily loaded one (`loading="lazy"`, below
 * the fold of a person page or the book) is loaded now, else the print shows an empty frame where it goes. At
 * most `limitMs`; a broken image does not hold it.
 */
export async function imagesReadyForPrint(root: { querySelectorAll(sel: string): ArrayLike<unknown> }, limitMs = PRINT_IMAGES_MS): Promise<void> {
    const imgs = Array.from(root.querySelectorAll('img')) as PrintImage[];
    if (!imgs.length) return;
    for (const img of imgs) if (img.loading === 'lazy') img.loading = 'eager';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const limit = new Promise<void>(resolve => { timer = setTimeout(resolve, limitMs); });
    const all = Promise.all(imgs.map(img => {
        try { return img.decode().catch(() => undefined); } catch { return undefined; }
    })).then(() => undefined);
    await Promise.race([all, limit]);
    if (timer) clearTimeout(timer);
}
