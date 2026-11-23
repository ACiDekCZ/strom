/**
 * Pictures the research has already go to it by reference (spec 133 phase 1):
 * a source's excerpt without its FILE when the research can cut it again (its
 * clip, or the original it was cut from), a portrait, a couple's photo or an
 * attachment as `_STROM_DATA <sha>` when the research holds that file. Only
 * to a bridge that says `sync.mediaRef` (and `media.known` for what it has to
 * be asked about); everything else goes with its data, as ever.
 *
 * What the research holds is asked with `POST <base>/media/known` before a
 * send. A reference it no longer finds refuses the whole send
 * (`sync.media-ref-unknown` with the hashes): the same tree then goes once with
 * every picture's data, and those hashes go with data for the rest of the page.
 */

import { MEDIA_KNOWN_FEATURE, MEDIA_KNOWN_MAX, parseMediaKnown } from './batch.js';
import { base64ToBytes } from './base64.js';
import { normalizeSha256, sha256Bytes } from './sha256.js';
import { treeMedia } from './media.js';
import { withAppVersion } from './research-link.js';
import type { GedcomMediaRef } from './ged-exporter.js';
import { isPoolRef, poolIdOf } from './image-ref.js';
import { imageMetaOf } from './image-meta.js';
import type { StromData } from './types.js';

/** `/status.features`: the bridge takes a send with pictures by reference. */
export const SYNC_MEDIA_REF_FEATURE = 'sync.mediaRef';
/** A send's refusal: a `_STROM_DATA` hash the research does not have (`shas` names them). */
export const MEDIA_REF_UNKNOWN_CODE = 'sync.media-ref-unknown';
/** At most this many hashes of a refusal are taken (the research names 50 at most). */
export const MEDIA_REF_UNKNOWN_MAX = 200;
/** How long one ask of `media/known` may take before the send goes with data. */
export const MEDIA_REF_KNOWN_TIMEOUT_MS = 30_000;

/**
 * What may go by reference to a bridge with these features: null nothing;
 * `known` false only excerpts with the research's clip (nothing can be asked).
 */
export function mediaRefGate(features: readonly string[] | null | undefined): { known: boolean } | null {
    if (!features?.includes(SYNC_MEDIA_REF_FEATURE)) return null;
    return { known: features.includes(MEDIA_KNOWN_FEATURE) };
}

/**
 * The bytes of a base64 data URL as the research reads them (its
 * `dataUrlBytes`: no whitespace, the URL-safe alphabet taken as the standard
 * one), else null — such data go with the file, never by reference.
 */
export function dataUrlBytes(url: string): Uint8Array | null {
    const comma = url.indexOf(',');
    if (!/^data:/i.test(url) || comma < 0) return null;
    const head = url.slice(5, comma).split(';').map(x => x.trim().toLowerCase());
    if (!head.slice(1).includes('base64')) return null;
    const payload = url.slice(comma + 1).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
    try {
        const bytes = base64ToBytes(payload);
        return bytes.length ? bytes : null;
    } catch {
        return null;
    }
}

const toHex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

/** The hash of each data URL hashed (null: not one), the oldest first; bounded by entries and characters. */
const shaCache = new Map<string, string | null>();
let shaCacheChars = 0;
const SHA_CACHE_MAX_ENTRIES = 8192;
const SHA_CACHE_MAX_CHARS = 128 * 1024 * 1024;

function rememberSha(url: string, sha: string | null): void {
    if (url.length > SHA_CACHE_MAX_CHARS) return;
    shaCache.set(url, sha);
    shaCacheChars += url.length;
    for (const [old] of shaCache) {
        if (shaCache.size <= SHA_CACHE_MAX_ENTRIES && shaCacheChars <= SHA_CACHE_MAX_CHARS) break;
        shaCache.delete(old);
        shaCacheChars -= old.length;
    }
}

/** The SHA-256 (hex) of a data URL's bytes as hashed before, without hashing it now. */
export function cachedDataUrlSha(url: string): string | undefined {
    return shaCache.get(url) ?? undefined;
}

/** The SHA-256 (hex) of a base64 data URL's bytes, null when it is not one; hashed once per page. */
export async function dataUrlSha(url: string): Promise<string | null> {
    const had = shaCache.get(url);
    if (had !== undefined) return had;
    const bytes = dataUrlBytes(url);
    const sha = bytes ? toHex(await sha256Bytes(bytes)) : null;
    rememberSha(url, sha);
    return sha;
}

/** The images of the tree's portraits, couples' photos and attachments: data URLs and pooled images' references (each once). */
export function treeImageValues(data: StromData): string[] {
    const out = new Set<string>();
    const add = (v: unknown) => { if (typeof v === 'string' && (v.startsWith('data:') || isPoolRef(v))) out.add(v); };
    for (const p of Object.values(data.persons ?? {})) add(p?.photo);
    for (const u of Object.values(data.partnerships ?? {})) add(u?.photo);
    for (const a of treeMedia(data)) if (!a.originalOnly) add(a.dataUrl);
    return [...out];
}

/** The data URLs of the tree's portraits, couples' photos and attachments (each once). */
export function treeDataUrls(data: StromData): string[] {
    return treeImageValues(data).filter(v => v.startsWith('data:'));
}

/**
 * A pooled image's SHA-256 (hex) by the image catalog (image-meta.ts): the
 * hash of its stored bytes, what dataUrlSha gives its data URL (spec 135).
 * Not in the catalog, or no hash there: undefined.
 */
export function catalogSha(ref: string): string | undefined {
    const meta = imageMetaOf(ref);
    return meta && meta.bytes > 0 ? normalizeSha256(meta.sha) ?? undefined : undefined;
}

/** The hash of a value: a pooled image's by the catalog, a data URL's as hashed before. */
function knownSha(value: string): string | undefined {
    return isPoolRef(value) ? catalogSha(value) : cachedDataUrlSha(value);
}

/**
 * The hashes of pooled images (by reference): the catalog's; an image the
 * catalog has no entry for gets one (ensureImageMeta), one whose entry has no
 * hash is read and hashed alone, as its data URL (nothing of it kept).
 */
async function pooledShas(refs: readonly string[], out: Map<string, string>): Promise<void> {
    if (!refs.length) return;
    const { ensureImageMeta, loadImageUrls } = await import('./media-pool.js');
    await ensureImageMeta(refs.map(ref => poolIdOf(ref)!));
    for (const ref of refs) {
        const sha = catalogSha(ref);
        if (sha) {
            out.set(ref, sha);
            continue;
        }
        if (!imageMetaOf(ref)) continue;
        const id = poolIdOf(ref)!;
        const url = (await loadImageUrls([id])).get(id);
        const bytes = url ? dataUrlBytes(url) : null;
        if (bytes) out.set(ref, toHex(await sha256Bytes(bytes)));
    }
}

/** The originals the excerpts without the research's clip were cut from (each once). */
export function excerptOriginalShas(data: StromData): string[] {
    const out = new Set<string>();
    for (const s of Object.values(data.sources ?? {})) {
        for (const e of s?.excerpts ?? []) {
            if (e.clip) continue;
            const sha = normalizeSha256(e.originalSha);
            if (sha) out.add(sha);
        }
    }
    return [...out];
}

/**
 * The hashes of `shas` the research holds (`media/known` said `{id, …}`;
 * `queued` and `null` are not held), asked in parts of at most
 * MEDIA_KNOWN_MAX. Null when an ask fails or its answer is not one.
 */
export async function askMediaKnown(base: string, shas: readonly string[], fetchFn: typeof fetch = fetch,
    ms = MEDIA_REF_KNOWN_TIMEOUT_MS): Promise<Set<string> | null> {
    const known = new Set<string>();
    for (let i = 0; i < shas.length; i += MEDIA_KNOWN_MAX) {
        const part = shas.slice(i, i + MEDIA_KNOWN_MAX);
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
        try {
            const res = await fetchFn(withAppVersion(`${base}/media/known`), {
                method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ shas: part }), signal: ctl?.signal,
            });
            if (!res.ok) return null;
            const said = parseMediaKnown(await res.json().catch(() => null), part);
            if (!said) return null;
            for (const [sha, state] of said) if (state === 'has') known.add(sha);
        } catch {
            return null;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    return known;
}

/**
 * A send's answer is the refusal of a reference the research does not have
 * (its code read from the body itself: the general reply's codes are lower case).
 */
export function isMediaRefUnknown(body: unknown): boolean {
    return !!body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).code === MEDIA_REF_UNKNOWN_CODE;
}

/** The hashes a refusal names (`shas` of `sync.media-ref-unknown`, untrusted): valid ones, each once. */
export function mediaRefUnknownShas(body: unknown): string[] {
    const r = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!Array.isArray(r?.shas)) return [];
    const out = new Set<string>();
    for (const v of r.shas.slice(0, MEDIA_REF_UNKNOWN_MAX)) {
        const sha = normalizeSha256(v);
        if (sha) out.add(sha);
    }
    return [...out];
}

/** Hashes a research refused as unknown this page (they go with data), by research. */
const refusedOf = new Map<string, Set<string>>();
/** What `media/known` last said a research holds (a send leaving the page asks nothing), by research. */
const knownOf = new Map<string, Set<string>>();

/** A research refused these references: they go with data until the page is left. */
export function noteMediaRefRefused(researchId: string, shas: readonly string[]): void {
    const set = refusedOf.get(researchId) ?? new Set<string>();
    for (const sha of shas) set.add(sha);
    refusedOf.set(researchId, set);
}

/** Forget what was learnt of the researches and the hashes (tests). */
export function forgetMediaRefMemory(): void {
    refusedOf.clear();
    knownOf.clear();
    shaCache.clear();
    shaCacheChars = 0;
}

/**
 * The export's choice (GedcomExportOptions.mediaRef): an excerpt with a clip
 * by reference; one cut from an original the research holds, and a file whose
 * data it holds, only with `media.known` — a refused hash never.
 */
export function mediaRefOf(gate: { known: boolean }, known: ReadonlySet<string>, refused: ReadonlySet<string>,
    shaOf: (dataUrl: string) => string | undefined): GedcomMediaRef {
    const held = (sha: string | null | undefined): sha is string => !!sha && gate.known && known.has(sha) && !refused.has(sha);
    return {
        excerpt: e => !!e.clip || held(normalizeSha256(e.originalSha)),
        dataSha: url => {
            const sha = gate.known ? shaOf(url) : undefined;
            return held(sha) ? sha : undefined;
        },
    };
}

/**
 * What of the tree goes by reference to this research (undefined: all with
 * data, as to a bridge without `sync.mediaRef`). Asks `media/known` for the
 * tree's files and the excerpts' originals; leaving the page (`keepalive`)
 * there is no time: what it said last time, of files hashed before.
 */
export async function prepareMediaRef(args: {
    researchId: string; base: string; features: readonly string[] | null | undefined; data: StromData; keepalive?: boolean;
    fetchFn?: typeof fetch;
}): Promise<GedcomMediaRef | undefined> {
    const gate = mediaRefGate(args.features);
    if (!gate) return undefined;
    const refused = refusedOf.get(args.researchId) ?? new Set<string>();
    if (!gate.known) return mediaRefOf(gate, new Set(), refused, () => undefined);
    if (args.keepalive) return mediaRefOf(gate, knownOf.get(args.researchId) ?? new Set(), refused, knownSha);
    const shaOf = new Map<string, string>();
    // A pooled image goes by the catalog's hash (spec 135): never expanded nor hashed again here.
    const refs: string[] = [];
    for (const value of treeImageValues(args.data)) {
        if (isPoolRef(value)) {
            const sha = catalogSha(value);
            if (sha) shaOf.set(value, sha);
            else refs.push(value);
            continue;
        }
        const sha = await dataUrlSha(value);
        if (sha) shaOf.set(value, sha);
    }
    await pooledShas(refs, shaOf);
    const ask = [...new Set([...shaOf.values(), ...excerptOriginalShas(args.data)])].filter(sha => !refused.has(sha));
    const known = ask.length ? await askMediaKnown(args.base, ask, args.fetchFn ?? fetch) : new Set<string>();
    // Not answered: nothing it would have to hold goes by reference (and nothing of it is kept for leaving the page).
    knownOf.set(args.researchId, known ?? new Set());
    return mediaRefOf(gate, known ?? new Set(), refused, url => shaOf.get(url));
}

/** UTF-8 length of a text without encoding it (a send's body size, diagnostics). */
export function utf8Length(text: string): number {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            n += 4;
            i++;
        } else n += 3;
    }
    return n;
}
