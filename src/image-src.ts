/**
 * Where an image is shown from: a pooled image's reference (`\u0000sm:<id>`,
 * media-pool.ts) becomes an object URL of its bytes, read from the pool when
 * a place shows it; a data URL (or any other address) is used as it is.
 *
 * - imageUrl(value): the address to show, read from the pool when needed —
 *   several asked in one tick are read in one transaction.
 * - imageUrlNow(value): the same, synchronously, from what is at hand ('' for
 *   a reference not read yet).
 * - imageBlob(value): the image's bytes as a Blob (a download, a PDF).
 * - setImageSource / showsImage / builtHtml: the same for elements in the DOM.
 *
 * A pooled image becomes an object URL or a Blob only as a raster image
 * (JPEG, PNG, WebP, GIF) or a PDF; a record of any other type, one the pool
 * does not have and an encrypted one while the session is locked give
 * nothing (the place shows no picture).
 *
 * Object URLs are kept in a small LRU cache, bounded by bytes and count; one
 * pushed out is revoked (the browser frees its bytes). An image on screen
 * (a hydrator's element in view) is not pushed out: it goes once off screen. Places built as HTML
 * text write imgSrcAttr(value): a reference becomes a transparent placeholder
 * with `data-pool-ref`, and the hydrator (startImageHydrator) puts the image
 * in while the element is on screen and lets it go when it is not.
 *
 * Besides a reference, every function here takes a turned one (image-ref.ts
 * turnedPoolRef: a research crop shown upright): the pooled JPEG's bytes with
 * the EXIF orientation written in, cached under its own key (`<id>@oN`).
 */

import { loadImageBlobs, dataUrlBlob } from './media-pool.js';
import { POOL_REF, poolIdOf, isPoolRef, poolKeyOf, poolKeyParts, IMAGE_PLACEHOLDER, POOL_REF_ATTR, imageAddrAttr } from './image-ref.js';
import { jpegWithOrientation } from './exif-orientation.js';

/** The cache keeps object URLs of at most this many bytes … */
export const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** … and at most this many images. */
export const IMAGE_CACHE_MAX_COUNT = 400;

/** The placeholder and the attribute naming an element's pooled image (image-ref.ts). */
export { IMAGE_PLACEHOLDER, POOL_REF_ATTR };

/**
 * The only types a pooled image is shown or handed on as: the raster images
 * the load sanitizer lets in and a PDF (a file). Anything else in the pool
 * (a forged or a damaged record) gives nothing — no object URL of another
 * type (an SVG or HTML page with script) is ever made from it.
 */
const SHOWN_TYPE = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/i;

/** Whether a Blob of this type may be shown (SHOWN_TYPE). */
export function isShownImageType(type: string): boolean {
    return SHOWN_TYPE.test(type.trim());
}

function shown(blob: Blob | null | undefined): Blob | null {
    return blob && isShownImageType(blob.type) ? blob : null;
}

/** A pool key as `data-pool-ref` carries it: the id, a turned image's with `@oN`. */
const ID = /^[pe]:[0-9a-f]+(?:@o[2-8])?$/;

/** A reference's pool id, and whether a value is one (image-ref.ts: exactly as the pool writes them). */
export { poolIdOf, isPoolRef };

// ---- the cache ----

interface Entry { url: string; size: number }

/** Pool key (id, or id@oN) → object URL; Map order = least recently used first. */
const cache = new Map<string, Entry>();
let cacheBytes = 0;
const limits = { bytes: IMAGE_CACHE_MAX_BYTES, count: IMAGE_CACHE_MAX_COUNT };

type RevokeListener = (id: string, url: string) => void;
const revokeListeners = new Set<RevokeListener>();

/** Be told when an object URL is revoked (pushed out of the cache). */
export function onImageUrlRevoked(listener: RevokeListener): () => void {
    revokeListeners.add(listener);
    return () => { revokeListeners.delete(listener); };
}

function revoke(id: string, entry: Entry): void {
    cache.delete(id);
    cacheBytes -= entry.size;
    URL.revokeObjectURL(entry.url);
    for (const l of revokeListeners) {
        try { l(id, entry.url); } catch { /* a listener's failure is its own */ }
    }
}

function touch(id: string): Entry | undefined {
    const entry = cache.get(id);
    if (entry) { cache.delete(id); cache.set(id, entry); }
    return entry;
}

function remember(id: string, blob: Blob): string {
    const old = cache.get(id);
    if (old) return touch(id)!.url;
    const entry = { url: URL.createObjectURL(blob), size: blob.size };
    cache.set(id, entry);
    cacheBytes += entry.size;
    trim(id);
    return entry.url;
}

/** Tells whether an image is on screen somewhere (a hydrator): its object URL is not let go then. */
type OnScreen = (id: string) => boolean;
const onScreenChecks = new Set<OnScreen>();

function onScreen(id: string): boolean {
    for (const check of onScreenChecks) if (check(id)) return true;
    return false;
}

/**
 * Keep the cache to its bounds: the least recently used go, except `keep`
 * (the one just put in) and those on screen — the cache may stay over its
 * bounds while more is on screen than they allow (else the images on screen
 * would push each other out and be read again and again); they go once off
 * screen (trimImageCache).
 */
function trim(keep?: string): void {
    for (const [oldId, oldEntry] of cache) {
        if (cacheBytes <= limits.bytes && cache.size <= limits.count) break;
        if (oldId === keep || onScreen(oldId)) continue;
        revoke(oldId, oldEntry);
    }
}

let trimQueued = false;

/** Trim the cache soon (images went off screen); several asks in one tick, one trim. */
function trimSoon(): void {
    if (trimQueued) return;
    trimQueued = true;
    queueMicrotask(() => {
        trimQueued = false;
        trim();
    });
}

/** Revoke every object URL (a lock of the session, tests). */
export function releaseImageUrls(): void {
    for (const [id, entry] of [...cache]) revoke(id, entry);
}

/** Change the cache's bounds (tests); none given: the defaults. */
export function setImageCacheLimits(bytes = IMAGE_CACHE_MAX_BYTES, count = IMAGE_CACHE_MAX_COUNT): void {
    limits.bytes = bytes;
    limits.count = count;
    trim();
}

/** What the cache holds now (tests, diagnostics). */
export function imageCacheStats(): { count: number; bytes: number } {
    return { count: cache.size, bytes: cacheBytes };
}

// ---- reading, batched ----

const inflight = new Map<string, Promise<string>>();
let queue: Map<string, { resolve: (url: string) => void; reject: (err: unknown) => void }> | null = null;

/**
 * A pooled image's Blob as shown under its key: turned by the key's EXIF
 * orientation when it is a JPEG (as excerpts.ts withExifOrientation does to a
 * data URL), else as it is.
 */
async function asKeyed(blob: Blob | null, orient: number): Promise<Blob | null> {
    if (!blob || !orient || !/^image\/jpeg$/i.test(blob.type.trim())) return blob;
    const turned = jpegWithOrientation(new Uint8Array(await blob.arrayBuffer()), orient);
    return turned ? new Blob([turned as BlobPart], { type: blob.type }) : blob;
}

/** The Blobs of pool keys, read in one transaction (a turned key's from its image's bytes). */
async function loadKeyed(keys: readonly string[]): Promise<Map<string, Blob | null>> {
    const parts = keys.map(poolKeyParts);
    const blobs = await loadImageBlobs([...new Set(parts.map(p => p.id))]);
    const out = new Map<string, Blob | null>();
    for (let i = 0; i < keys.length; i++) {
        out.set(keys[i], await asKeyed(shown(blobs.get(parts[i].id)), parts[i].orient));
    }
    return out;
}

function flushQueue(): void {
    const batch = queue;
    queue = null;
    if (!batch) return;
    const ids = [...batch.keys()];
    loadKeyed(ids).then((blobs) => {
        for (const id of ids) {
            inflight.delete(id);
            const blob = blobs.get(id) ?? null;
            batch.get(id)!.resolve(blob ? remember(id, blob) : '');
        }
    }, (err) => {
        for (const id of ids) {
            inflight.delete(id);
            batch.get(id)!.reject(err);
        }
    });
}

function readPooled(id: string): Promise<string> {
    const running = inflight.get(id);
    if (running) return running;
    const p = new Promise<string>((resolve, reject) => {
        if (!queue) {
            queue = new Map();
            queueMicrotask(flushQueue);
        }
        queue.set(id, { resolve, reject });
    });
    inflight.set(id, p);
    return p;
}

/**
 * The address to show an image from: a reference's object URL ('' when the
 * pool does not have it, or it is encrypted and the session is locked); any
 * other value as it is.
 */
export function imageUrl(value: string): Promise<string> {
    const id = poolKeyOf(value);
    if (!id) return Promise.resolve(value);
    const entry = touch(id);
    if (entry) return Promise.resolve(entry.url);
    return readPooled(id);
}

/** imageUrl without waiting: '' for a reference whose image is not at hand. */
export function imageUrlNow(value: string): string {
    const id = poolKeyOf(value);
    if (!id) return value;
    return touch(id)?.url ?? '';
}

/**
 * The image's bytes as a Blob of its type (null: none, a locked or missing
 * pooled image, a pooled one of a type not shown, not a data URL).
 */
export async function imageBlob(value: string): Promise<Blob | null> {
    const key = poolKeyOf(value);
    if (!key) return dataUrlBlob(value);
    return (await loadKeyed([key])).get(key) ?? null;
}

// ---- HTML text ----

/**
 * The address attributes of an <img> built as HTML text: `src="…"` for a data
 * URL or any other address; for a reference the placeholder plus
 * `data-pool-ref="<id>"`, which the hydrator fills while the element is on
 * screen (starting it when there is a document).
 */
export function imgSrcAttr(value: string): string {
    if (poolKeyOf(value) && typeof document !== 'undefined') startImageHydrator(document);
    return imageAddrAttr(value);
}

// ---- elements in the DOM ----

/**
 * Show `value` in an element (an <img>, an SVG <image>): an address as its
 * src (href), a reference as `data-pool-ref` with its object URL when at
 * hand, else the placeholder until the hydrator puts it in.
 */
export function setImageSource(el: Element, value: string): void {
    const attr = addressAttr(el);
    const id = poolKeyOf(value);
    if (!id) {
        if (el.hasAttribute(POOL_REF_ATTR)) el.removeAttribute(POOL_REF_ATTR);
        el.setAttribute(attr, value);
        return;
    }
    el.setAttribute(attr, imageUrlNow(value) || IMAGE_PLACEHOLDER);
    el.setAttribute(POOL_REF_ATTR, id);
    const doc = el.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (doc) startImageHydrator(doc);
}

/** Whether an element shows `value` already (a reference: by its id, whatever object URL it has now). */
export function showsImage(el: Element | null | undefined, value: string): boolean {
    if (!el) return false;
    const id = poolKeyOf(value);
    if (id) return el.getAttribute(POOL_REF_ATTR) === id;
    return !el.hasAttribute(POOL_REF_ATTR) && el.getAttribute(addressAttr(el)) === value;
}

/** Whether two elements show the same image (pooled ones by their id, whatever object URL each has now). */
export function sameImgSource(a: Element, b: Element): boolean {
    const ia = a.getAttribute(POOL_REF_ATTR), ib = b.getAttribute(POOL_REF_ATTR);
    if (ia !== null || ib !== null) return ia === ib;
    return a.getAttribute(addressAttr(a)) === b.getAttribute(addressAttr(b));
}

/**
 * An element's HTML as it was built: the object URLs the hydrator put in
 * since read back as the placeholder (a place comparing what it drew with
 * what it would draw now).
 */
export function builtHtml(el: Element): string {
    if (!el.hasAttribute(POOL_REF_ATTR) && !el.querySelector(`[${POOL_REF_ATTR}]`)) return el.outerHTML;
    const copy = el.cloneNode(true) as Element;
    const all = [copy, ...copy.querySelectorAll(`[${POOL_REF_ATTR}]`)];
    for (const x of all) if (x.hasAttribute(POOL_REF_ATTR)) x.setAttribute(addressAttr(x), IMAGE_PLACEHOLDER);
    return copy.outerHTML;
}

// ---- the hydrator ----

interface Hydrator {
    stop(): void;
}

const hydrators = new WeakMap<Document, Hydrator>();

/** The attribute that carries an element's address (SVG <image>: href). */
function addressAttr(el: Element): string {
    return el.tagName.toLowerCase() === 'image' ? 'href' : 'src';
}

/**
 * Keep the images of `doc` with `data-pool-ref` filled: an element on screen
 * (or about to be) gets its object URL, one off screen whose URL the cache
 * pushed out goes back to the placeholder, so the browser can free the
 * picture. An image already at hand is put in at once when the element is
 * added. Idempotent per document.
 */
export function startImageHydrator(doc: Document): void {
    if (hydrators.has(doc)) return;
    const win = (doc.defaultView ?? globalThis) as typeof globalThis;
    const MO = win.MutationObserver;
    const IO = win.IntersectionObserver;
    if (typeof MO !== 'function' || typeof IO !== 'function') return;

    const visible = new Set<Element>();
    const watched = new Set<Element>();
    /** The watched elements by the id they carry (one image in several places: the card and its tooltip). */
    const byId = new Map<string, Set<Element>>();
    const idOf = new Map<Element, string>();

    const index = (el: Element): void => {
        const id = el.getAttribute(POOL_REF_ATTR) ?? '';
        const was = idOf.get(el);
        if (was === id) return;
        if (was !== undefined) {
            const set = byId.get(was);
            set?.delete(el);
            if (set && set.size === 0) byId.delete(was);
        }
        idOf.set(el, id);
        let set = byId.get(id);
        if (!set) { set = new Set(); byId.set(id, set); }
        set.add(el);
    };

    const unindex = (el: Element): void => {
        const was = idOf.get(el);
        if (was === undefined) return;
        idOf.delete(el);
        const set = byId.get(was);
        set?.delete(el);
        if (set && set.size === 0) byId.delete(was);
    };

    const fill = (el: Element): void => {
        const id = el.getAttribute(POOL_REF_ATTR);
        if (!id || !ID.test(id)) return;
        const attr = addressAttr(el);
        const now = imageUrlNow(POOL_REF + id);
        if (now) {
            if (el.getAttribute(attr) !== now) el.setAttribute(attr, now);
            return;
        }
        void imageUrl(POOL_REF + id).then((url) => {
            if (!url) return;
            // Still the same image, still wanted.
            if (el.getAttribute(POOL_REF_ATTR) === id && visible.has(el)) el.setAttribute(attr, url);
            // The same image elsewhere waiting for it (a card's tooltip): in as well, no wait when it shows.
            for (const x of byId.get(id) ?? []) {
                const a = addressAttr(x);
                if (x !== el && x.getAttribute(POOL_REF_ATTR) === id && x.getAttribute(a) === IMAGE_PLACEHOLDER) x.setAttribute(a, url);
            }
        }, () => { /* left as the placeholder */ });
    };

    const letGo = (el: Element): void => {
        const id = el.getAttribute(POOL_REF_ATTR);
        const attr = addressAttr(el);
        const src = el.getAttribute(attr);
        if (!id || !src || src === IMAGE_PLACEHOLDER) return;
        if (imageUrlNow(POOL_REF + id) !== src) el.setAttribute(attr, IMAGE_PLACEHOLDER);
        // Off screen: the cache may let it go now, if over its bounds.
        trimSoon();
    };

    /** An image of this document on screen (or about to be): the cache keeps its object URL. */
    const shownHere: OnScreen = (id) => {
        for (const el of byId.get(id) ?? []) if (visible.has(el)) return true;
        return false;
    };
    onScreenChecks.add(shownHere);

    const io = new IO((entries) => {
        for (const e of entries) {
            if (e.isIntersecting) {
                visible.add(e.target);
                fill(e.target);
            } else {
                visible.delete(e.target);
                letGo(e.target);
            }
        }
    }, { rootMargin: '300px' });

    const watch = (el: Element): void => {
        if (watched.has(el)) { index(el); fill(el); return; }
        watched.add(el);
        index(el);
        // At hand already: in before the next paint, no placeholder seen.
        const id = el.getAttribute(POOL_REF_ATTR);
        if (id) {
            const now = imageUrlNow(POOL_REF + id);
            if (now) el.setAttribute(addressAttr(el), now);
        }
        io.observe(el);
    };

    const unwatch = (el: Element): void => {
        if (!watched.delete(el)) return;
        unindex(el);
        if (visible.delete(el)) trimSoon();
        io.unobserve(el);
    };

    const scan = (node: Node, add: boolean): void => {
        if (node.nodeType !== 1) return;
        const el = node as Element;
        const each = (x: Element) => (add ? watch(x) : unwatch(x));
        if (el.hasAttribute(POOL_REF_ATTR)) each(el);
        for (const x of el.querySelectorAll(`[${POOL_REF_ATTR}]`)) each(x);
    };

    const mo = new MO((records) => {
        for (const r of records) {
            if (r.type === 'attributes') {
                const el = r.target as Element;
                if (el.hasAttribute(POOL_REF_ATTR)) watch(el);
                else unwatch(el);
                continue;
            }
            for (const n of r.removedNodes) scan(n, false);
            for (const n of r.addedNodes) scan(n, true);
        }
    });
    const root = doc.documentElement ?? doc;
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: [POOL_REF_ATTR] });
    scan(root, true);

    // A URL pushed out of the cache: elements off screen showing it go back to the placeholder.
    const off = onImageUrlRevoked((id, url) => {
        for (const el of byId.get(id) ?? []) {
            if (!visible.has(el) && el.getAttribute(addressAttr(el)) === url) el.setAttribute(addressAttr(el), IMAGE_PLACEHOLDER);
        }
    });
    // An element on screen whose URL was revoked under it (an error): read again.
    const onError = (ev: Event): void => {
        const el = ev.target as Element | null;
        if (el && typeof el.getAttribute === 'function' && watched.has(el) && visible.has(el)) {
            const src = el.getAttribute(addressAttr(el));
            const id = el.getAttribute(POOL_REF_ATTR);
            if (id && src && src !== IMAGE_PLACEHOLDER && imageUrlNow(POOL_REF + id) !== src) fill(el);
        }
    };
    doc.addEventListener('error', onError, true);

    hydrators.set(doc, {
        stop() {
            mo.disconnect();
            io.disconnect();
            off();
            onScreenChecks.delete(shownHere);
            doc.removeEventListener('error', onError, true);
            watched.clear();
            visible.clear();
            byId.clear();
            idOf.clear();
        },
    });
}

/** Stop the hydrator of `doc` (a window closing, tests). */
export function stopImageHydrator(doc: Document): void {
    hydrators.get(doc)?.stop();
    hydrators.delete(doc);
}
