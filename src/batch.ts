/**
 * "Add materials" (C2): a folder, many files or a ZIP sent to Strom Research
 * as one batch (`PUT /media/<sha256>` with `X-Strom-Batch` and `-Path`, then
 * `POST /batch/<id>/done`). The rules here are pure: which files are left
 * out and why, the research's limits, the rough cost, the folder tree of the
 * review list, and what this browser remembers of an unfinished batch.
 */

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
