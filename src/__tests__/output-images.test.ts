/**
 * An output waits for the tree's photos (spec 116 §8, K1.7): the look of the
 * wait — the progress toast titled by the output, "Waiting for photos" k of
 * n with Cancel, the indicator held back meanwhile; some did not come: one
 * alert with why and three actions (Try again, Continue without N photos,
 * Cancel), no ✕ — and a print only once the images of its document are
 * loaded and decoded (a lazily loaded one too).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FailCall { text: string; action?: { label: string; run: () => void }; extra?: Record<string, { label: string; run: () => void } | string | boolean | undefined> }
const toasts: Array<{ opts: Record<string, unknown>; steps: unknown[]; closed: boolean; failed: FailCall[] }> = [];
vi.mock('../ui/toast.js', () => ({
    showToast: () => ({ el: null, update: () => undefined, close: () => undefined }),
    showProgressToast: (opts: Record<string, unknown>, first: unknown) => {
        const t = { opts, steps: [first] as unknown[], closed: false, failed: [] as FailCall[] };
        toasts.push(t);
        return {
            el: null,
            update: (s: unknown) => { t.steps.push(s); },
            done: () => undefined,
            fail: (text: string, action?: FailCall['action'], extra?: FailCall['extra']) => { t.failed.push({ text, action, extra }); },
            close: () => { t.closed = true; },
        };
    },
}));
let held = 0;
vi.mock('../ui/image-load-chip.js', async (orig) => ({
    ...(await orig<typeof import('../ui/image-load-chip.js')>()),
    suspendImageLoadChip: () => { held++; let on = true; return () => { if (on) { on = false; held--; } }; },
}));

const { toastImagesView, waitingLine, imagesReadyForPrint } = await import('../ui/output-images.js');
const { setLanguage, getStringsForLang, strings } = await import('../strings.js');
import type { ImageLoadSnapshot } from '../image-loads.js';

const snap = (o: Partial<ImageLoadSnapshot> = {}): ImageLoadSnapshot => ({
    treeId: 'tree-a', seq: 1, phase: 'running', done: 120, total: 860, failed: 0, left: 740, reasons: [], ...o,
});

beforeEach(() => {
    toasts.length = 0;
    held = 0;
    setLanguage('en');
});
afterEach(() => vi.useRealTimers());

describe('the wait in the progress toast (8a–8e)', () => {
    it('titled by the output, "Waiting for photos" k of n with Cancel; the count moves on in the same toast', () => {
        const lines: string[] = [];
        const v = toastImagesView({ step: l => lines.push(l) });
        const cancel = vi.fn();
        v.waiting('Printing the poster', snap(), cancel);
        v.waiting('Printing the poster', snap({ done: 640, left: 220 }), cancel);
        expect(toasts).toHaveLength(1);
        expect(toasts[0].opts).toMatchObject({ title: 'Printing the poster', cancel });
        expect(toasts[0].steps).toEqual([
            { step: 'Waiting for photos', k: 120, n: 860, percent: 14 },
            { step: 'Waiting for photos', k: 640, n: 860, percent: 74 },
        ]);
        expect(lines).toEqual(['Waiting for photos · 120 of 860', 'Waiting for photos · 640 of 860']);
        expect(held).toBe(1);
        v.close();
        expect(toasts[0].closed).toBe(true);
        expect(held).toBe(0);
    });

    it('some did not come: one alert with why and three actions, no ✕; each answers', async () => {
        const v = toastImagesView();
        v.waiting('Printing the poster', snap(), () => undefined);
        const s = snap({ phase: 'done', done: 848, failed: 12, left: 0, reasons: ['offline'] });
        for (const [pick, answer] of [['action', 'retry'], ['more', 'without'], ['third', 'cancel']] as const) {
            const asked = v.ask('Printing the poster', s);
            const t = toasts[toasts.length - 1];
            const call = t.failed[t.failed.length - 1];
            expect(call.text).toBe(`Some photos did not load (12). ${strings.busy.errOffline}`);
            expect(call.action?.label).toBe('Try again');
            expect(call.extra?.title).toBe('Printing the poster');
            expect((call.extra?.more as { label: string }).label).toBe('Continue without 12 photos');
            expect((call.extra?.third as { label: string }).label).toBe('Cancel');
            (pick === 'action' ? call.action! : call.extra![pick] as { run: () => void }).run();
            expect(await asked).toBe(answer);
        }
        v.close();
        expect(held).toBe(0);
    });

    it('in every language', () => {
        setLanguage('cs');
        expect(waitingLine({ done: 120, total: 860 })).toBe('Čeká se na fotky · 120 z 860');
        const cs = getStringsForLang('cs').photos;
        expect(cs.continueWithout(12)).toBe('Pokračovat bez 12 fotek');
        expect(cs.continueWithout(2)).toBe('Pokračovat bez 2 fotek');
        expect(cs.out.poster).toBe('Tisk plakátu');
        expect(getStringsForLang('de').photos.continueWithout(1)).toBe('Ohne 1 Foto fortfahren');
        expect(getStringsForLang('pl').photos.continueWithout(5)).toBe('Kontynuuj bez 5 zdjęć');
        expect(getStringsForLang('en').photos.continueWithout(1)).toBe('Continue without 1 photo');
    });
});

/** An image of a document as the print sees it: loaded lazily or not, decoded once `decode` settles. */
function img(o: { loading?: string; decode?: () => Promise<void> } = {}) {
    return { loading: o.loading ?? 'auto', complete: false, decode: o.decode ?? (() => Promise.resolve()) };
}
const root = (imgs: ReturnType<typeof img>[]) => ({ querySelectorAll: (sel: string) => (sel === 'img' ? imgs : []) });

describe('a print only with its images drawn', () => {
    it('a lazily loaded image is loaded now, and the print waits until each is decoded', async () => {
        let decoded!: () => void;
        const lazy = img({ loading: 'lazy', decode: () => new Promise<void>(r => { decoded = r; }) });
        const eager = img();
        let ready = false;
        const wait = imagesReadyForPrint(root([lazy, eager])).then(() => { ready = true; });
        expect(lazy.loading).toBe('eager');
        await new Promise(r => setTimeout(r, 5));
        expect(ready).toBe(false);
        decoded();
        await wait;
        expect(ready).toBe(true);
    });

    it('a broken image does not hold it; one that never decodes, at most the limit', async () => {
        await imagesReadyForPrint(root([img({ decode: () => Promise.reject(new Error('EncodingError')) })]));
        vi.useFakeTimers();
        let ready = false;
        const wait = imagesReadyForPrint(root([img({ decode: () => new Promise<void>(() => undefined) })]), 5000).then(() => { ready = true; });
        await vi.advanceTimersByTimeAsync(4999);
        expect(ready).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await wait;
        expect(ready).toBe(true);
    });

    it('no images: at once', async () => {
        await expect(imagesReadyForPrint(root([]))).resolves.toBeUndefined();
    });
});
