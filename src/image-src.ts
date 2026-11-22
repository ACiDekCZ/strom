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
 *
 * Object URLs are kept in a small LRU cache, bounded by bytes and count; one
 * pushed out is revoked (the browser frees its bytes). Places built as HTML
 * text write imgSrcAttr(value): a reference becomes a transparent placeholder
 * with `data-pool-ref`, and the hydrator (startImageHydrator) puts the image
 * in while the element is on screen and lets it go when it is not.
 */

import { POOL_REF, loadImageBlobs, dataUrlBlob } from './media-pool.js';

/** The cache keeps object URLs of at most this many bytes … */
export const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** … and at most this many images. */
export const IMAGE_CACHE_MAX_COUNT = 400;

/** A transparent 1×1 GIF: what an element shows until its image is in. */
export const IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The attribute naming the pooled image of an element built by imgSrcAttr. */
export const POOL_REF_ATTR = 'data-pool-ref';

const REF_ID = /^\u0000sm:([pe]:[0-9a-f]+)$/;
const ID = /^[pe]:[0-9a-f]+$/;

/** The pool id of a reference, or null when the value is none. */
export function poolIdOf(value: unknown): string | null {
    if (typeof value !== 'string' || !value.startsWith(POOL_REF)) return null;
    const m = REF_ID.exec(value);
    return m ? m[1] : null;
}

/** The value is a pooled image's reference. */
export function isPoolRef(value: unknown): value is string {
    return poolIdOf(value) !== null;
}

// ---- the cache ----

interface Entry { url: string; size: number }

/** Pool id → object URL; Map order = least recently used first. */
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
    // The oldest go; the one just put in always stays.
    for (const [oldId, oldEntry] of cache) {
        if (cache.size <= 1 || (cacheBytes <= limits.bytes && cache.size <= limits.count)) break;
        if (oldId === id) continue;
        revoke(oldId, oldEntry);
    }
    return entry.url;
}

/** Revoke every object URL (a lock of the session, tests). */
export function releaseImageUrls(): void {
    for (const [id, entry] of [...cache]) revoke(id, entry);
}

/** Change the cache's bounds (tests); none given: the defaults. */
export function setImageCacheLimits(bytes = IMAGE_CACHE_MAX_BYTES, count = IMAGE_CACHE_MAX_COUNT): void {
    limits.bytes = bytes;
    limits.count = count;
}

/** What the cache holds now (tests, diagnostics). */
export function imageCacheStats(): { count: number; bytes: number } {
    return { count: cache.size, bytes: cacheBytes };
}

// ---- reading, batched ----

const inflight = new Map<string, Promise<string>>();
let queue: Map<string, { resolve: (url: string) => void; reject: (err: unknown) => void }> | null = null;

function flushQueue(): void {
    const batch = queue;
    queue = null;
    if (!batch) return;
    const ids = [...batch.keys()];
    loadImageBlobs(ids).then((blobs) => {
        for (const id of ids) {
            inflight.delete(id);
            const blob = blobs.get(id);
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
    const id = poolIdOf(value);
    if (!id) return Promise.resolve(value);
    const entry = touch(id);
    if (entry) return Promise.resolve(entry.url);
    return readPooled(id);
}

/** imageUrl without waiting: '' for a reference whose image is not at hand. */
export function imageUrlNow(value: string): string {
    const id = poolIdOf(value);
    if (!id) return value;
    return touch(id)?.url ?? '';
}

/** The image's bytes as a Blob of its type (null: none, a locked or missing pooled image, not a data URL). */
export async function imageBlob(value: string): Promise<Blob | null> {
    const id = poolIdOf(value);
    if (!id) return dataUrlBlob(value);
    return (await loadImageBlobs([id])).get(id) ?? null;
}

// ---- HTML text ----

function esc(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * The address attributes of an <img> built as HTML text: `src="…"` for a data
 * URL or any other address; for a reference the placeholder plus
 * `data-pool-ref="<id>"`, which the hydrator fills while the element is on
 * screen (starting it when there is a document).
 */
export function imgSrcAttr(value: string): string {
    const id = poolIdOf(value);
    if (!id) return `src="${esc(value)}"`;
    if (typeof document !== 'undefined') startImageHydrator(document);
    return `src="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}="${id}"`;
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
            // Still the same image, still wanted.
            if (url && el.getAttribute(POOL_REF_ATTR) === id && visible.has(el)) el.setAttribute(attr, url);
        }, () => { /* left as the placeholder */ });
    };

    const letGo = (el: Element): void => {
        const id = el.getAttribute(POOL_REF_ATTR);
        const attr = addressAttr(el);
        const src = el.getAttribute(attr);
        if (!id || !src || src === IMAGE_PLACEHOLDER) return;
        if (imageUrlNow(POOL_REF + id) !== src) el.setAttribute(attr, IMAGE_PLACEHOLDER);
    };

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
        if (watched.has(el)) { fill(el); return; }
        watched.add(el);
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
        visible.delete(el);
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
    const off = onImageUrlRevoked((_id, url) => {
        for (const el of watched) {
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
            doc.removeEventListener('error', onError, true);
            watched.clear();
            visible.clear();
        },
    });
}

/** Stop the hydrator of `doc` (a window closing, tests). */
export function stopImageHydrator(doc: Document): void {
    hydrators.get(doc)?.stop();
    hydrators.delete(doc);
}
