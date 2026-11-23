/**
 * Every output gets its images whole (spec 135, part D5a): a file, a saved
 * page, a poster, the book, a GEDCOM for a research or an older window takes
 * a pooled image's reference (`\u0000sm:<id>`, image-ref.ts) nowhere — only
 * the data URL the pool holds for it, byte for byte.
 *
 * `expandImages(data)`: a copy of tree data (objects and arrays copied,
 * strings shared) with each reference replaced by its image, read from the
 * pool in batches (encrypted ones decrypted). Taken at the call: a change of
 * the data while the images are read does not reach the copy. Data without a
 * reference come back as they are — the same object, nothing copied, nothing
 * read. An image not in the pool (or encrypted while the session is locked)
 * becomes empty text, as `unpoolObject` does: the load sanitizer drops it,
 * the rest is still worth having; `missing` counts them.
 *
 * `expandImageText(text)`: the same for HTML or SVG text a builder wrote with
 * references (imageAddrAttr's placeholder with `data-pool-ref`, or the
 * reference itself in an attribute); read are only the images the text names.
 */

import { POOL_REF, IMAGE_PLACEHOLDER, POOL_REF_ATTR, poolIdOf, poolKeyParts } from './image-ref.js';
import { loadImageUrls, type Decrypt } from './media-pool.js';
import { withExifOrientation } from './excerpts.js';

export interface ExpandOptions {
    /** Decrypts an encrypted image instead of the session (a backup under its own password). */
    decrypt?: Decrypt;
}

export interface Expanded<T> {
    data: T;
    /** Images not in the pool (or not readable now): empty text in `data`. */
    missing: number;
}

function isPlain(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function collectIds(value: unknown, out: Set<string>): void {
    if (typeof value === 'string') {
        const id = value.length === 46 ? poolIdOf(value) : null;
        if (id) out.add(id);
    } else if (Array.isArray(value)) {
        for (const v of value) collectIds(v, out);
    } else if (value && typeof value === 'object' && isPlain(value)) {
        for (const k in value as Record<string, unknown>) collectIds((value as Record<string, unknown>)[k], out);
    }
}

/** The value names at least one pooled image (exactly as the pool writes a reference). */
export function hasPoolRefs(value: unknown): boolean {
    if (typeof value === 'string') return value.length === 46 && poolIdOf(value) !== null;
    if (Array.isArray(value)) return value.some(hasPoolRefs);
    if (value && typeof value === 'object' && isPlain(value)) {
        for (const k in value as Record<string, unknown>) if (hasPoolRefs((value as Record<string, unknown>)[k])) return true;
    }
    return false;
}

type Slot = { at: Record<string, unknown> | unknown[]; key: string | number; id: string };

/** A copy of `value` (strings shared); every reference's place noted in `slots`. */
function copyWithSlots(value: unknown, slots: Slot[]): unknown {
    if (Array.isArray(value)) {
        const out: unknown[] = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const v = value[i];
            const id = typeof v === 'string' && v.length === 46 ? poolIdOf(v) : null;
            if (id) slots.push({ at: out, key: i, id });
            out[i] = copyWithSlots(v, slots);
        }
        return out;
    }
    if (value && typeof value === 'object' && isPlain(value)) {
        const out: Record<string, unknown> = {};
        for (const k in value as Record<string, unknown>) {
            const v = (value as Record<string, unknown>)[k];
            const id = typeof v === 'string' && v.length === 46 ? poolIdOf(v) : null;
            if (id) slots.push({ at: out, key: k, id });
            out[k] = copyWithSlots(v, slots);
        }
        return out;
    }
    return value;
}

/** Tree data with every pooled image whole (see the module's comment). */
export async function expandImages<T>(data: T, o: ExpandOptions = {}): Promise<Expanded<T>> {
    const ids = new Set<string>();
    collectIds(data, ids);
    if (ids.size === 0) return { data, missing: 0 };
    const slots: Slot[] = [];
    const copy = copyWithSlots(data, slots) as T;
    const urls = await loadImageUrls([...ids], o.decrypt);
    for (const s of slots) (s.at as Record<string | number, unknown>)[s.key] = urls.get(s.id) ?? '';
    let missing = 0;
    for (const id of ids) if (!urls.has(id)) missing++;
    return { data: copy, missing };
}

/** expandImages for a caller that needs only the data. */
export async function expandedData<T>(data: T, o: ExpandOptions = {}): Promise<T> {
    return (await expandImages(data, o)).data;
}

function escAttr(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const KEY_SRC = '[pe]:[0-9a-f]{40}(?:@o[2-8])?';
const PLACEHOLDER_ATTR = new RegExp(
    `\\b(src|href)="${IMAGE_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}" ${POOL_REF_ATTR}="(${KEY_SRC})"`, 'g');
const RAW_REF = new RegExp(`${POOL_REF.replace('\u0000', '\\u0000')}(${KEY_SRC})`, 'g');
const JSON_REF = new RegExp(`\\\\u0000sm:(${KEY_SRC})`, 'g');

/** A pool key's image (turned by its EXIF orientation when the key says so), or null when missing. */
function keyImage(key: string, urls: Map<string, string>): string | null {
    const { id, orient } = poolKeyParts(key);
    const url = urls.get(id);
    if (url === undefined) return null;
    return orient ? withExifOrientation(url, orient) : url;
}

/** HTML or SVG text with every pooled image it names whole (see the module's comment). */
export async function expandImageText(text: string, o: ExpandOptions = {}): Promise<Expanded<string>> {
    if (!text.includes(POOL_REF_ATTR) && !text.includes(POOL_REF) && !text.includes('\\u0000sm:')) return { data: text, missing: 0 };
    const ids = new Set<string>();
    for (const re of [PLACEHOLDER_ATTR, RAW_REF, JSON_REF]) {
        for (const m of text.matchAll(re)) ids.add(poolKeyParts(m[m.length - 1]).id);
    }
    if (ids.size === 0) return { data: text, missing: 0 };
    const urls = await loadImageUrls([...ids]);
    let missing = 0;
    for (const id of ids) if (!urls.has(id)) missing++;
    const out = text
        .replace(PLACEHOLDER_ATTR, (_m, attr: string, key: string) => `${attr}="${escAttr(keyImage(key, urls) ?? '')}"`)
        .replace(RAW_REF, (_m, key: string) => escAttr(keyImage(key, urls) ?? ''))
        .replace(JSON_REF, (_m, key: string) => JSON.stringify(keyImage(key, urls) ?? '').slice(1, -1));
    return { data: out, missing };
}
