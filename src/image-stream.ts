/**
 * A file of tree data written with its pooled images read as it is written
 * (spec 135, part D10c): a JSON file, the saved app's embedded data, the
 * working file. The tree is not expanded: its JSON is written with each
 * pooled image's reference (`"\u0000sm:<id>"`, image-ref.ts), the text is
 * cut at the references and the file is a Blob of the pieces with each
 * image put in its place, read from the pool a few images at a time — the
 * Blob holds the bytes, so the page holds the text and those few images at
 * once, never the tree's images whole. Byte for byte the JSON of
 * expandImages' copy (a missing image empty text, as there).
 *
 * The text is taken at the call (JSON.stringify before any wait): a change
 * of the data while the images are read does not reach the file. When the
 * text names another number of references than the value holds (a text
 * that only looks like one), the file is made from the expanded copy as
 * before — never a file with a reference in it.
 *
 * A file under a password is sealed whole (its text encrypted at once):
 * such a file is made from the expanded copy, as before.
 */

import { poolIdOf } from './image-ref.js';
import { loadImageUrls } from './media-pool.js';
import { expandedData } from './image-expand.js';
import { blobOut, type BlobOut, type Spool } from './spool.js';

/** Images read per read of the pool: an output holds only these at a time besides its text. */
export const IMAGES_PER_READ = 8;

/** A pool reference as JSON writes a value (not a key): the NUL escaped, the quotes around it. */
const REF_IN_JSON = /"\\u0000sm:([pe]:[0-9a-f]{40})"(?!:)/g;

/**
 * JSON text made safe inside an inline <script>: '<' escaped so no string
 * can close the element or open a comment, U+2028/U+2029 for older parsers.
 * Still valid JSON (export.ts jsonForScript).
 */
export function scriptSafeJson(json: string): string {
    return json
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function isPlain(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** How many places in `value` hold a pooled image's reference (each place counted, as JSON writes them). */
export function countPoolRefs(value: unknown): number {
    if (typeof value === 'string') return value.length === 46 && poolIdOf(value) ? 1 : 0;
    let n = 0;
    if (Array.isArray(value)) {
        for (const v of value) n += countPoolRefs(v);
    } else if (value && typeof value === 'object' && isPlain(value)) {
        for (const k in value as Record<string, unknown>) n += countPoolRefs((value as Record<string, unknown>)[k]);
    }
    return n;
}

/** A text cut at its references: `pieces[i]`, image `ids[i]`, …, the last piece. */
interface CutText { pieces: string[]; ids: string[] }

function cut(text: string): CutText {
    const pieces: string[] = [];
    const ids: string[] = [];
    let from = 0;
    for (const m of text.matchAll(REF_IN_JSON)) {
        pieces.push(text.slice(from, m.index));
        ids.push(m[1]);
        from = m.index! + m[0].length;
    }
    pieces.push(text.slice(from));
    return { pieces, ids };
}

/** The pieces with the images (JSON strings, `script`: safe in a script) in place, written to `out`; the images the pool did not give. */
async function writeWithImages(out: BlobOut, c: CutText, script: boolean): Promise<Set<string>> {
    const missing = new Set<string>();
    for (let i = 0; i < c.ids.length; i += IMAGES_PER_READ) {
        const group = c.ids.slice(i, i + IMAGES_PER_READ);
        const urls = await loadImageUrls([...new Set(group)]);
        for (let k = 0; k < group.length; k++) {
            const url = urls.get(group[k]);
            if (url === undefined) missing.add(group[k]);
            const json = JSON.stringify(url ?? '');
            out.write(c.pieces[i + k]);
            out.write(script ? scriptSafeJson(json) : json);
        }
        // Out at once (a Blob, the disk): the images of this read leave the page's memory.
        await out.ready();
    }
    out.write(c.pieces[c.pieces.length - 1]);
    await out.ready();
    return missing;
}

/** The file made of `head`, the pieces with their images and `tail`, written to `spool`'s file or as Blobs in memory. */
async function fileWithImages(c: CutText, script: boolean, type: string, spool: Spool | null | undefined, head: string[] = [], tail: string[] = []): Promise<DataFile> {
    const out = await blobOut(spool);
    try {
        for (const h of head) out.write(h);
        const missing = await writeWithImages(out, c, script);
        for (const t of tail) out.write(t);
        return { blob: await out.close(type), missing: missing.size };
    } catch (e) {
        await out.abort();
        throw e;
    }
}

/** A file made of tree data: its Blob and the images the pool did not give (empty text in it). */
export interface DataFile {
    blob: Blob;
    missing: number;
}

/**
 * JSON.stringify(value, null, indent) with its pooled images whole, as a
 * Blob of `type` (see the module's comment). `script`: the JSON as an
 * inline script embeds it (scriptSafeJson).
 */
export async function jsonFileWithImages(value: unknown, o: { indent?: number; type?: string; script?: boolean; spool?: Spool | null } = {}): Promise<DataFile> {
    const text = written(value, o.indent, o.script);
    const expected = countPoolRefs(value);
    const type = o.type ?? 'application/json';
    if (expected === 0) return { blob: new Blob([text], { type }), missing: 0 };
    const c = cut(text);
    if (c.ids.length !== expected) {
        const whole = written(await expandedData(value), o.indent, o.script);
        return { blob: new Blob([whole], { type }), missing: 0 };
    }
    return fileWithImages(c, !!o.script, type, o.spool);
}

function written(value: unknown, indent?: number, script?: boolean): string {
    const json = JSON.stringify(value, null, indent);
    return script ? scriptSafeJson(json) : json;
}

/**
 * An HTML page with a script inserted before its `</head>` (export.ts
 * injectBeforeHeadEnd): `script(values)` writes the script, its JSON
 * holding the values' pooled images as references; the page comes as a
 * Blob with the images whole in the script. Only the script is read for
 * references — the page's own code is written as it is. Taken at the call.
 * `spool`: the file written there (a large one, spool.ts), else in memory.
 */
export async function htmlFileWithImages<T>(html: string, values: T, script: (values: T) => string, spool?: Spool | null): Promise<DataFile> {
    const type = 'text/html';
    const text = `${script(values)}\n`;
    const expected = countPoolRefs(values);
    const at = html.indexOf('</head>');
    // No </head>: the page as it is (as String.replace leaves it).
    if (at < 0) return { blob: new Blob([html], { type }), missing: 0 };
    const head = html.slice(0, at);
    const rest = html.slice(at);
    if (expected === 0) return { blob: new Blob([head, text, rest], { type }), missing: 0 };
    const c = cut(text);
    if (c.ids.length !== expected) {
        return { blob: new Blob([head, `${script(await expandedData(values))}\n`, rest], { type }), missing: 0 };
    }
    return fileWithImages(c, true, type, spool, [head], [rest]);
}
