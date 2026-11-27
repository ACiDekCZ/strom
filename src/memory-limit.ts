/**
 * How close the app is to the memory one page may use (spec 135, P2/P3).
 *
 * A page's JavaScript has a ceiling (`jsHeapSizeLimit`, about 2 GB on many
 * computers, shared by every window of the app). Past it the page dies. The
 * measurements of spec 135 (D9a) showed that the browser's own figure of
 * what is in use (`performance.memory.usedJSHeapSize`) is useless as the
 * main signal (frozen at its first value for minutes in Chromium), so the
 * warning is computed from an estimate of what the app knows synchronously:
 *
 * - limit L: `jsHeapSizeLimit` where the browser tells it; else 2 GB, on a
 *   touch device 1 GB (Safari/iOS were not measured: on the safe side);
 * - steady heap H = 24 MB + 6 × the tree's JSON without its images
 *   + 25 MB for each other open window of the app (images are not in H:
 *   they stay in the image pool, their object URLs outside the heap);
 * - the tree is near the limit while it is open: 2 × H > 0.5 × L (or the
 *   browser's own figure over 60 % of L, where it has one — it lags behind,
 *   so when it says so it is bad already);
 * - an output with the tree's images: k × the images' volume + 3 × H
 *   > 0.7 × L, where k depends on how the output holds them. A file written
 *   a few images at a time (JSON, the saved app, the working file, GEDCOM:
 *   image-stream.ts, ged-export-images.ts) holds the file's bytes outside
 *   the page's heap and only a few images in it: k = OUTPUT_IMAGE_FACTOR
 *   (measured in D10c). An output that holds its images whole (a file
 *   sealed under a password, the book, the family pages, the poster, the
 *   change packet; every image whole in memory, a few times over while it
 *   is made): k = WHOLE_OUTPUT_IMAGE_FACTOR (measured in D9a);
 * - an import of a file: 3.5 × the file's size + H > 0.7 × L.
 *
 * The formulas are pure (tests: src/__tests__/memory-limit.test.ts); the
 * tree walks below are cheap (no JSON string is built) and run only now and
 * then (src/ui/memory-limit-ui.ts).
 */

import type { StromData } from './types.js';
import type { ContentOptions } from './privacy.js';
import { estimateJsonBytes } from './clone.js';
import { forEachImagePlace } from './image-intern.js';
import { poolIdOf, standInOf } from './image-ref.js';
import { imageMetaOf } from './image-meta.js';

export const MB = 1024 * 1024;

/** The limit where the browser does not tell it. */
export const DEFAULT_LIMIT = 2048 * MB;
/** The limit on a touch device that does not tell it. */
export const TOUCH_LIMIT = 1024 * MB;
/** The app's own heap with an empty tree. */
export const BASE_HEAP = 24 * MB;
/** The heap per byte of the tree's JSON (data and its drawing). */
export const JSON_FACTOR = 6;
/** Each other open window of the app. */
export const WINDOW_HEAP = 25 * MB;

/** Steady: 2 × H over this share of L. */
export const STEADY_SHARE = 0.5;
/** The browser's own figure over this share of L (where it has one). */
export const USED_SHARE = 0.6;
/** An output's or import's peak over this share of L. */
export const PEAK_SHARE = 0.7;
/**
 * An output written a few images at a time (image-stream.ts,
 * ged-export-images.ts): the images' volume counts this many times. Measured
 * (D10c, 2000 images of 80 kB): the JSON file's peak about 0.3 × the images,
 * the saved app's about 2 × (the share baseline it keeps is the tree's JSON
 * with its images whole, written once the file is made).
 */
export const OUTPUT_IMAGE_FACTOR = 2.5;
/**
 * An output that holds its images whole (sealed under a password, the book,
 * the family pages, the poster, the change packet): the images' volume
 * counts this many times.
 */
export const WHOLE_OUTPUT_IMAGE_FACTOR = 6.5;
/** An output: the steady heap counts this many times. */
export const OUTPUT_HEAP_FACTOR = 3;
/** An import: the file's size counts this many times. */
export const IMPORT_FILE_FACTOR = 3.5;

/** What the page's environment says about its memory. */
export interface HeapEnv {
    /** `performance.memory.jsHeapSizeLimit` (Chrome, Edge); absent elsewhere. */
    jsHeapSizeLimit?: number | null;
    /** A touch device (`pointer: coarse`). */
    coarse?: boolean;
}

/** The limit L in bytes. */
export function heapLimit(env: HeapEnv): number {
    const l = env.jsHeapSizeLimit;
    if (typeof l === 'number' && Number.isFinite(l) && l > 0) return l;
    return env.coarse ? TOUCH_LIMIT : DEFAULT_LIMIT;
}

/** The steady heap H for a tree whose JSON without images has `jsonBytes`, with `otherWindows` windows open. */
export function steadyHeap(jsonBytes: number, otherWindows = 0): number {
    return BASE_HEAP + JSON_FACTOR * Math.max(0, jsonBytes) + WINDOW_HEAP * Math.max(0, otherWindows);
}

/** The tree is near the limit while it is open (`used`: the browser's own figure, when it has one). */
export function nearLimitSteady(heap: number, limit: number, used?: number | null): boolean {
    if (2 * heap > STEADY_SHARE * limit) return true;
    return typeof used === 'number' && used > 0 && used > USED_SHARE * limit;
}

/**
 * How an output holds its images: whole (true), a few at a time with a
 * copy kept (false, the saved app with its share baseline), or 'streamed':
 * a few at a time and none kept (the gift package, 1127) — their volume
 * does not count, only the steady heap.
 */
export type OutputImageHold = boolean | 'streamed';

/**
 * The peak of an output carrying `imageChars` of images (data URL
 * characters); `whole`: how it holds them (OutputImageHold).
 */
export function outputPeak(imageChars: number, heap: number, whole: OutputImageHold = false): number {
    const k = whole === 'streamed' ? 0 : whole ? WHOLE_OUTPUT_IMAGE_FACTOR : OUTPUT_IMAGE_FACTOR;
    return k * Math.max(0, imageChars) + OUTPUT_HEAP_FACTOR * heap;
}

/** An output may go past the limit (`whole`: how it holds its images, OutputImageHold). */
export function nearLimitOutput(imageChars: number, heap: number, limit: number, whole: OutputImageHold = false): boolean {
    return outputPeak(imageChars, heap, whole) > PEAK_SHARE * limit;
}

/** The peak of an import of a file of `fileBytes`. */
export function importPeak(fileBytes: number, heap: number): number {
    return IMPORT_FILE_FACTOR * Math.max(0, fileBytes) + heap;
}

/** An import may go past the limit. */
export function nearLimitImport(fileBytes: number, heap: number, limit: number): boolean {
    return importPeak(fileBytes, heap) > PEAK_SHARE * limit;
}

// ==================== THE TREE'S SIZES ====================

/** Which images an output carries (a ContentOptions' part; nothing given: all). */
export type ImageContent = Pick<ContentOptions, 'photos' | 'attachments' | 'sources' | 'sourceImages'>;

/** The characters of one image value: a data URL its length, a pool reference its catalog entry's. */
function imageValueChars(v: unknown): number {
    if (typeof v !== 'string' || v.length === 0) return 0;
    // A pooled image as its reference or as its stand-in (image-standin.ts): its volume from the catalog,
    // not the stand-in's few characters (1127: a book of gigabytes of photos taken for a small one).
    const id = poolIdOf(v) ?? standInOf(v)?.id;
    if (id) return imageMetaOf(id)?.len ?? 0;
    return v.startsWith('data:') ? v.length : 0;
}

/**
 * The volume of the tree's images as data URL characters (pooled ones from
 * the catalog; one it does not know counts 0). `content`: only the images an
 * output with these choices carries — photos (portraits, couples' photos),
 * attachments, source excerpts (with the sources; their own choice when the
 * export offers one, else with the attachments).
 */
export function treeImageChars(data: StromData, content?: ImageContent): number {
    const photos = content?.photos !== false;
    const attachments = content?.attachments !== false;
    const excerpts = content?.sources !== false
        && (content?.sourceImages ? content.sourceImages !== 'none' : attachments);
    let n = 0;
    const add = (holder: Record<string, unknown>, key: string): void => { n += imageValueChars(holder[key]); };
    if (photos) {
        for (const p of Object.values(data.persons ?? {})) add(p as unknown as Record<string, unknown>, 'photo');
        for (const u of Object.values(data.partnerships ?? {})) add(u as unknown as Record<string, unknown>, 'photo');
    }
    if (attachments) for (const a of Object.values(data.media ?? {})) if (a) add(a as unknown as Record<string, unknown>, 'dataUrl');
    if (excerpts) {
        for (const src of Object.values(data.sources ?? {})) {
            const list = src && typeof src === 'object' ? (src as { excerpts?: unknown }).excerpts : undefined;
            if (Array.isArray(list)) for (const e of list) if (e && typeof e === 'object') add(e as Record<string, unknown>, 'dataUrl');
        }
    }
    return n;
}

/**
 * The volume of these pooled images as data URL characters (from the
 * catalog; an id it does not know counts 0): what an output that carries
 * only some of the tree's images (the family pages' set, a poster's
 * portraits) holds.
 */
export function poolImagesChars(ids: Iterable<string>): number {
    let n = 0;
    for (const id of new Set(ids)) n += imageMetaOf(id)?.len ?? 0;
    return n;
}

/**
 * About how many bytes the tree's JSON has without its images (no string
 * built): a pooled image is a short reference in it, an image not pooled yet
 * (a data URL just added) is left out.
 */
export function jsonBytesWithoutImages(data: StromData): number {
    let images = 0;
    forEachImagePlace(data, (holder, key) => {
        const v = holder[key];
        if (typeof v === 'string' && v.startsWith('data:')) images += v.length;
    });
    return Math.max(0, estimateJsonBytes(data) - images);
}
