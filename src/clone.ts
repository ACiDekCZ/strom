/**
 * Deep copy of tree data that SHARES strings instead of copying them.
 *
 * Tree data is plain JSON-shaped objects, and its biggest parts are strings:
 * photos, attachments and source excerpts as base64 data URLs. Strings are
 * immutable, so two copies can safely point at the same one — only the object
 * structure needs copying for undo snapshots to be independent.
 * structuredClone copies every string's contents too: with 30 MB of images an
 * undo step cost ~60 MB of heap, and a few dozen edits ran a tab out of memory.
 */
export function cloneTreeData<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) out[i] = cloneTreeData(value[i]);
        return out as T;
    }
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) out[key] = cloneTreeData(src[key]);
    return out as T;
}

/**
 * The same shared-string copy, shaped like a JSON round-trip: object keys whose
 * value is undefined are left out, as JSON.parse(JSON.stringify(x)) would.
 * What gets written to storage has always looked like that.
 */
export function cloneTreeDataAsJson<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const v = value[i];
            out[i] = v === undefined ? null : cloneTreeDataAsJson(v);
        }
        return out as T;
    }
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
        const v = src[key];
        if (v === undefined || typeof v === 'function') continue;
        out[key] = cloneTreeDataAsJson(v);
    }
    return out as T;
}

/** UTF-8 byte length of a string (long strings are data URLs: ASCII). */
function utf8Length(text: string): number {
    if (text.length > 4096) return text.length;
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3;
    }
    return bytes;
}

/**
 * About how many bytes JSON.stringify(value) would take, without building the
 * string — for showing a tree's size after a save (an 80 MB tree used to be
 * serialized a second time on every save just to measure it). Escapes inside
 * strings are not counted.
 */
export function estimateJsonBytes(value: unknown): number {
    if (value === null) return 4;
    switch (typeof value) {
        case 'string': return utf8Length(value) + 2;
        case 'number': return String(value).length;
        case 'boolean': return value ? 4 : 5;
        case 'object': break;
        default: return 0;
    }
    if (Array.isArray(value)) {
        let n = 2 + Math.max(0, value.length - 1);
        for (const v of value) n += v === undefined ? 4 : estimateJsonBytes(v);
        return n;
    }
    let n = 2;
    let first = true;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined || typeof v === 'function') continue;
        n += (first ? 0 : 1) + utf8Length(key) + 3 + estimateJsonBytes(v);
        first = false;
    }
    return n;
}
