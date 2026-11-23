/**
 * A pooled image's reference as it stands in tree data: `\u0000sm:` and the
 * image's content id (`p:` or `e:` and 40 hex digits, media-pool.ts). Pure,
 * no imports: the sanitizer, the size helpers and the fingerprints ask it
 * without loading the pool.
 */

/** What every reference starts with (the NUL makes it impossible as real tree text). */
export const POOL_REF = '\u0000sm:';

/** A reference exactly as the pool writes one: nothing before, nothing after. */
const REF = /^\u0000sm:([pe]:[0-9a-f]{40})$/;

/** The pool id a reference names, or null when the value is not exactly one. */
export function poolIdOf(value: unknown): string | null {
    if (typeof value !== 'string' || value.length !== 46 || !value.startsWith(POOL_REF)) return null;
    const m = REF.exec(value);
    return m ? m[1] : null;
}

/** The value is exactly a pooled image's reference. */
export function isPoolRef(value: unknown): boolean {
    return poolIdOf(value) !== null;
}

/**
 * The value starts like a reference (valid or not): text no person writes,
 * so where no image may be it can only be a stray or forged one.
 */
export function looksLikePoolRef(value: unknown): value is string {
    return typeof value === 'string' && value.charCodeAt(0) === 0 && value.startsWith(POOL_REF);
}

/**
 * An address to show a pooled image by, never stored in the tree: its
 * reference, or its reference turned by an EXIF orientation (`@o2`…`@o8`, a
 * research crop lying as its original is stored; excerpts.ts
 * excerptImageUrl). The pool key is what the resolver and the hydrator read:
 * the pool id, with `@oN` when turned.
 */
const KEY = /^\u0000sm:([pe]:[0-9a-f]{40}(?:@o[2-8])?)$/;

/** The pool key an address names (pool id, or pool id + `@oN`), or null for any other value. */
export function poolKeyOf(value: unknown): string | null {
    if (typeof value !== 'string' || (value.length !== 46 && value.length !== 49) || !value.startsWith(POOL_REF)) return null;
    const m = KEY.exec(value);
    return m ? m[1] : null;
}

/** A pool key's image id and the EXIF orientation it is shown turned by (0: as stored). */
export function poolKeyParts(key: string): { id: string; orient: number } {
    const at = key.indexOf('@o');
    return at < 0 ? { id: key, orient: 0 } : { id: key.slice(0, at), orient: Number(key.slice(at + 2)) };
}

/**
 * The address to show a pooled image by turned by an EXIF orientation (2–8);
 * the reference itself for any other orientation. Only for showing: the tree
 * keeps the reference and the orientation apart.
 */
export function turnedPoolRef(ref: string, orientation: number | undefined): string {
    const id = poolIdOf(ref);
    if (!id || !orientation || orientation < 2 || orientation > 8 || !Number.isInteger(orientation)) return ref;
    return `${POOL_REF}${id}@o${orientation}`;
}

/** The value is an image as tree data holds one: a data URL or a pooled image's reference. */
export function isImageValue(value: unknown): value is string {
    return typeof value === 'string' && (value.startsWith('data:') || isPoolRef(value));
}

/** A transparent 1×1 GIF: what an element shows until its pooled image is in. */
export const IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The attribute naming the pooled image of an element built as HTML text (image-src.ts fills it). */
export const POOL_REF_ATTR = 'data-pool-ref';

function escAttr(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * The address attribute of an image built as HTML or SVG text, without
 * starting anything (image-src.ts imgSrcAttr starts the hydrator too):
 * `<attr>="…"` for a data URL or any other address, for a reference the
 * placeholder and `data-pool-ref="<key>"` (its pool key: the id, turned ones
 * with `@oN`).
 */
export function imageAddrAttr(value: string, attr: 'src' | 'href' = 'src'): string {
    const id = poolKeyOf(value);
    if (!id) return `${attr}="${escAttr(value)}"`;
    return `${attr}="${IMAGE_PLACEHOLDER}" ${POOL_REF_ATTR}="${id}"`;
}
