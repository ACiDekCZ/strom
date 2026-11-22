/**
 * "Add materials" (C2): a folder, many files or a ZIP sent to Strom Research
 * as one batch (`PUT /media/<sha256>` with `X-Strom-Batch` and `-Path`, then
 * `POST /batch/<id>/done`). The rules here are pure: which files are left
 * out and why, the research's limits, the rough cost, the folder tree of the
 * review list, and what this browser remembers of an unfinished batch.
 */

import type { LiveChange, LiveLogEntry } from './research-link.js';

/** Why a file is left out of a batch. */
export type BatchSkip = 'system' | 'secret' | 'program' | 'archive' | 'tooBig' | 'ged';

export interface BatchFileInfo {
    /** Relative path in the picked folder ("Babička/Dopisy/1946.jpg"), or the file's name. */
    path: string;
    size: number;
}

export interface BatchLimits {
    /** The largest file (`accepts.media.max`). */
    maxFile: number;
    /** At most so many files and bytes in one batch (`accepts.media.batch`). */
    files: number;
    bytes: number;
    zip: boolean;
}

const SYSTEM = /^(\.ds_store|thumbs\.db|desktop\.ini)$/i;
const SECRET = /(^\.env(\..*)?$|\.(pem|key|kdbx|p12|pfx)$|^id_rsa|heslo|password|passwd)/i;
const PROGRAM = /\.(exe|msi|dmg|app|bat|cmd|com|scr|ps1|sh|js|jar|apk|dll|so|dylib|pkg)$/i;
const ARCHIVE = /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i;
const GED = /\.(ged|gdz)$/i;

const baseName = (path: string): string => path.split('/').pop() ?? path;

/**
 * Why a file is left out (in the order the rules are told), or null. `fixed`:
 * the user cannot tick it back (the research would refuse it); system files
 * and possible secrets can be ticked.
 */
export function batchSkip(info: BatchFileInfo, maxFile: number): { reason: BatchSkip; fixed: boolean } | null {
    const name = baseName(info.path);
    const hidden = info.path.split('/').some(part => part.startsWith('.') && part !== '.' && part !== '..');
    if (SYSTEM.test(name) || name.startsWith('._') || (hidden && !SECRET.test(name))) return { reason: 'system', fixed: false };
    if (SECRET.test(name)) return { reason: 'secret', fixed: false };
    if (PROGRAM.test(name)) return { reason: 'program', fixed: true };
    if (ARCHIVE.test(name)) return { reason: 'archive', fixed: true };
    if (maxFile > 0 && info.size > maxFile) return { reason: 'tooBig', fixed: true };
    if (GED.test(name)) return { reason: 'ged', fixed: true };
    return null;
}

export const isZip = (path: string): boolean => /\.zip$/i.test(path);

/** The research's limits for a batch, or null when it takes none. */
export function batchLimitsOf(accepts: { mediaBatch: { files: number; bytes: number; zip: boolean } | null; mediaMaxBytes: number | null } | null): BatchLimits | null {
    if (!accepts?.mediaBatch) return null;
    return { maxFile: accepts.mediaMaxBytes ?? accepts.mediaBatch.bytes, ...accepts.mediaBatch };
}

/** How far over the limits a batch is (null: within them). */
export function batchOverLimit(files: number, bytes: number, limits: BatchLimits): { files: number; bytes: number } | null {
    const df = Math.max(0, files - limits.files);
    const db = Math.max(0, bytes - limits.bytes);
    return df || db ? { files: df, bytes: db } : null;
}

/** The rough cost of the first pass: tasks ≈ ceil(files / filesPerTask), amount ≈ tasks × perTask. */
export function batchEstimate(files: number, est: { filesPerTask: number; perTask: number; currency: string } | null):
    { tasks: number; amount: number; currency: string } | null {
    if (!est || files <= 0 || est.filesPerTask <= 0) return null;
    const tasks = Math.ceil(files / est.filesPerTask);
    return { tasks, amount: tasks * est.perTask, currency: est.currency };
}

/** The batch's default name: the picked folder's (or the one ZIP's), else "Materials <date>". */
export function batchDefaultName(paths: readonly string[], fallback: string): string {
    if (paths.length === 0) return fallback;
    const firsts = new Set(paths.map(p => (p.includes('/') ? p.split('/')[0] : '')));
    if (firsts.size === 1) {
        const only = [...firsts][0];
        if (only) return only;
    }
    if (paths.length === 1 && isZip(paths[0])) return baseName(paths[0]).replace(/\.zip$/i, '');
    return fallback;
}

/** A folder of the review list: its subfolders and its files (indices into the batch's files). */
export interface BatchFolder {
    name: string;
    path: string;
    folders: BatchFolder[];
    files: number[];
}

/** The folder tree of a batch's files (by their paths), folders and files in name order. */
export function batchTree(paths: readonly string[]): BatchFolder {
    const root: BatchFolder = { name: '', path: '', folders: [], files: [] };
    const byPath = new Map<string, BatchFolder>([['', root]]);
    paths.forEach((path, index) => {
        const parts = path.split('/');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const sub = parts.slice(0, i + 1).join('/');
            let next = byPath.get(sub);
            if (!next) {
                next = { name: parts[i], path: sub, folders: [], files: [] };
                byPath.set(sub, next);
                node.folders.push(next);
            }
            node = next;
        }
        node.files.push(index);
    });
    const sort = (f: BatchFolder): void => {
        f.folders.sort((a, b) => a.name.localeCompare(b.name));
        f.files.sort((a, b) => paths[a].localeCompare(paths[b]));
        f.folders.forEach(sort);
    };
    sort(root);
    return root;
}

/** Every file index under a folder (its own and its subfolders'). */
export function batchFolderFiles(folder: BatchFolder): number[] {
    return [...folder.files, ...folder.folders.flatMap(batchFolderFiles)];
}

/** A new batch mark (`X-Strom-Batch`: letters, digits, '-', 8–64 characters). */
export function newBatchId(): string {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** `X-Strom-Path`: the relative path, each part percent-encoded (never an absolute path from the disk). */
export function batchPathHeader(path: string): string {
    return path.split('/').filter(p => p && p !== '.' && p !== '..').map(encodeURIComponent).join('/');
}

/** What this browser remembers of a batch not finished (`strom-batch:<treeId>`): no files, only counts. */
export interface UnfinishedBatch {
    id: string;
    name: string;
    total: number;
    done: number;
    bytes: number;
    startedAt: string;
    personId?: string;
    note?: string;
}

export function sanitizeUnfinishedBatch(value: unknown): UnfinishedBatch | null {
    const r = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    if (!r || typeof r.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(r.id) || typeof r.name !== 'string') return null;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return {
        id: r.id, name: r.name.slice(0, 200), total: n(r.total), done: n(r.done), bytes: n(r.bytes),
        startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
        ...(typeof r.personId === 'string' ? { personId: r.personId } : {}),
        ...(typeof r.note === 'string' ? { note: r.note.slice(0, 500) } : {}),
    };
}

// ==================== THE BRIDGE'S FAST WAY (Strom Research 1.36) ====================

/** The bridge answers a batch's file with `Prefer: respond-async` at once (202) and writes the batch as it is closed. */
export const MEDIA_QUEUED_FEATURE = 'media.queued';
/** The bridge says what it has of many files at once (`POST <token>/media/known {shas}`). */
export const MEDIA_KNOWN_FEATURE = 'media.known';
/** At most this many hashes in one `POST /media/known` (the bridge refuses more with 413). */
export const MEDIA_KNOWN_MAX = 5000;
/** One ask of `media/known` covers at most this many files… */
export const KNOWN_CHUNK_FILES = 200;
/** …or this many bytes to hash first (so a pause or a cancel is never far away). */
export const KNOWN_CHUNK_BYTES = 64 * 1024 * 1024;

/** A failed close of a batch is asked again after this long when the research says no `retry`. */
export const CLOSE_RETRY_DEFAULT_MS = 5000;
/** One wait between closes is never longer than this, whatever the research says. */
export const CLOSE_RETRY_MAX_MS = 60_000;
/** Closes failing this long in a row: no more by itself, the run pauses (Continue closes it again). */
export const CLOSE_RETRY_TOTAL_MS = 10 * 60_000;

/**
 * How long to wait before closing a batch again after `batch/<id>/done` failed: the
 * research's `retry` (seconds) of its JSON body first, then its `Retry-After` header
 * (seconds; a browser reads it only when the bridge exposes it), else 5 s — between
 * 1 s and a minute.
 */
export function batchCloseWaitMs(body: unknown, retryAfter: string | null | undefined): number {
    const seconds = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    const said = (body && typeof body === 'object' ? seconds((body as Record<string, unknown>).retry) : null) ?? seconds(retryAfter);
    if (said === null) return CLOSE_RETRY_DEFAULT_MS;
    return Math.min(CLOSE_RETRY_MAX_MS, Math.max(1000, Math.round(said * 1000)));
}

/**
 * How a closed batch is sorted (spec 130), said at the end of sending it:
 * - `older`: a research without `intake.auto` sorts every batch by itself, as it always did;
 * - `auto`: the research's setting is on — it makes the batch's tasks of sorting itself;
 * - `manual`: off (the default) — the files wait in Materials unsorted, Sort with the agent… is offered.
 * The batch's own reply decides first (`sort`, then `auto` of `batch/<id>/done`), then `/status.intake.auto`;
 * a research with the feature that says neither is off (its default).
 */
export type BatchSorting = 'older' | 'auto' | 'manual';

export function batchSorting(feature: boolean, statusAuto: boolean | undefined, done: { sort?: boolean; auto?: boolean } | null | undefined): BatchSorting {
    if (!feature) return 'older';
    const on = typeof done?.sort === 'boolean' ? done.sort : typeof done?.auto === 'boolean' ? done.auto : statusAuto === true;
    return on ? 'auto' : 'manual';
}

/** What the research has of one file: the file (`has`), it waits in the bridge's queue (`queued`), or nothing (`none`). */
export type MediaKnownState = 'has' | 'queued' | 'none';

/**
 * The files the next ask of `media/known` covers: from `from` on, those not
 * asked yet and not a ZIP (a ZIP is opened by the research, never skipped),
 * at most `maxFiles` of them and `maxBytes` to hash (at least one).
 */
export function batchKnownChunk(items: readonly { path: string; size: number }[], from: number, asked: (index: number) => boolean,
    maxFiles = KNOWN_CHUNK_FILES, maxBytes = KNOWN_CHUNK_BYTES): number[] {
    const out: number[] = [];
    let bytes = 0;
    const cap = Math.min(maxFiles, MEDIA_KNOWN_MAX);
    for (let i = Math.max(0, from); i < items.length && out.length < cap; i++) {
        if (asked(i) || isZip(items[i].path)) continue;
        if (out.length > 0 && bytes + items[i].size > maxBytes) break;
        out.push(i);
        bytes += items[i].size;
    }
    return out;
}

/**
 * The answer of `POST /media/known` (untrusted): each asked hash with what
 * the research has of it. A hash it did not answer is left out (asked again
 * one by one); null for an answer that is not one.
 */
export function parseMediaKnown(value: unknown, asked: readonly string[]): Map<string, MediaKnownState> | null {
    const r = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    const known = r?.known && typeof r.known === 'object' && !Array.isArray(r.known) ? r.known as Record<string, unknown> : null;
    if (!known) return null;
    const out = new Map<string, MediaKnownState>();
    for (const sha of asked) {
        if (!Object.prototype.hasOwnProperty.call(known, sha)) continue;
        const v = known[sha];
        if (v === null) out.set(sha, 'none');
        else if (v && typeof v === 'object' && !Array.isArray(v)) {
            const rec = v as Record<string, unknown>;
            if (rec.queued === true) out.set(sha, 'queued');
            else if (typeof rec.id === 'string' && rec.id) out.set(sha, 'has');
        }
    }
    return out;
}

/** What became of one file of a batch as the research wrote it (`batch/done` → `files`, media.queued). */
export interface BatchFileFate {
    sha: string;
    path: string;
    /** The input it became… */
    input?: string;
    /** …or the record the research had of it already… */
    known?: string;
    /** …or why it was not taken (its code and the research's sentence). */
    refused?: { code: string; why: string };
    /** A ZIP: what came of the files inside it. */
    zip?: { inputs: number; known: number; refused: { path: string; why: string }[] };
}

const fateId = (v: unknown): string | undefined => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(v) ? v : undefined);
const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** `files` of a `batch/done` answer (untrusted): each file the research took from its queue, at most 10 000. */
export function parseBatchDoneFiles(value: unknown): BatchFileFate[] {
    if (!Array.isArray(value)) return [];
    const out: BatchFileFate[] = [];
    for (const x of value.slice(0, 10_000)) {
        const r = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
        if (!r || typeof r.sha !== 'string' || !/^[0-9a-fA-F]{64}$/.test(r.sha)) continue;
        const fate: BatchFileFate = { sha: r.sha.toLowerCase(), path: typeof r.path === 'string' ? r.path.slice(0, 500) : '' };
        const input = fateId(r.input);
        const known = fateId(r.known);
        const ref = r.refused && typeof r.refused === 'object' && !Array.isArray(r.refused) ? r.refused as Record<string, unknown> : null;
        const zip = r.zip && typeof r.zip === 'object' && !Array.isArray(r.zip) ? r.zip as Record<string, unknown> : null;
        if (input) fate.input = input;
        else if (known) fate.known = known;
        else if (ref) fate.refused = { code: typeof ref.code === 'string' ? ref.code.slice(0, 60) : '', why: typeof ref.why === 'string' ? ref.why.slice(0, 400) : '' };
        if (zip) {
            fate.zip = {
                inputs: countOf(zip.inputs), known: countOf(zip.known),
                refused: (Array.isArray(zip.refused) ? zip.refused.slice(0, 200) : []).flatMap((z) => {
                    const zr = z && typeof z === 'object' ? z as Record<string, unknown> : null;
                    return zr ? [{ path: typeof zr.path === 'string' ? zr.path.slice(0, 500) : '', why: typeof zr.why === 'string' ? zr.why.slice(0, 400) : '' }] : [];
                }),
            };
        }
        out.push(fate);
    }
    return out;
}

/**
 * The changes of a followed research held while a batch of this page is
 * sent to it (oldest first) as one: its last head, every commit's entry
 * (newest first, as a change gives them; one without entries gets one of its
 * own lines) — the tree is read once for all of them.
 */
export function batchHeldChange(changes: readonly LiveChange[]): LiveChange | null {
    if (changes.length === 0) return null;
    const last = [...changes].reverse().find(c => c.head) ?? changes[changes.length - 1];
    // Newest first; a commit the research described (its entries) wins over one only named by its head.
    const entries: LiveLogEntry[] = [];
    const at = new Map<string, number>();
    for (const c of [...changes].reverse()) {
        const said = !!c.entries;
        const own: LiveLogEntry[] = c.entries ?? (c.head || c.what.length ? [{ head: c.head, at: c.at, what: c.what, task: '' }] : []);
        for (const e of own) {
            const i = e.head ? at.get(e.head) : undefined;
            if (i === undefined) {
                if (e.head) at.set(e.head, entries.length);
                entries.push(e);
            } else if (said) {
                entries[i] = e;
            }
        }
    }
    return { head: last.head, at: changes.reduce((t, c) => (c.at > t ? c.at : t), ''), what: [], entries };
}
