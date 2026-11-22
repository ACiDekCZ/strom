/**
 * Materials: the family's files the research (or the Strom archive) keeps,
 * beside the tree's own attachments (spec 017 U5).
 *
 * - the bridge's material list (`GET /material`) as types, read defensively;
 * - one person's materials: attachments joined with the research's files by
 *   the original's hash (`personMaterials`);
 * - gates by the research's capabilities (`material.list`, `material.assign`,
 *   `material.thumb`) and the actions of one item (`materialActions`);
 * - the bridge client (list, assign, hide, previews) with quiet retries while
 *   the research is busy, and its refusals as the app's texts;
 * - a cache of the last list and of previews in IndexedDB `strom-materials`
 *   (outside the tree's data; memory when IndexedDB is not available).
 *
 * Nothing here changes the tree: attachments stay as they are.
 */

import { Attachment, MaterialKind, Person, StromData } from './types.js';
import { personMedia } from './media.js';
import { cleanText, isResearchHead, researchPersonRef, researchSchemeUrl, withAppVersion, MATERIAL_LINKS_FEATURE, MEDIA_APP_FEATURE } from './research-link.js';
import { strings } from './strings.js';
import { ResearchWriteHeld, writeHeldOfCode } from './research-write-held.js';
import { formatDateForInput, formatFlexDate, normalizeDateInput, parseFlexDate } from './dates.js';
import { parseGedcomDate } from './ged-parser.js';
import { formatGedcomDate } from './ged-exporter.js';

// ==================== CAPABILITIES ====================

export const MATERIAL_LIST_FEATURE = 'material.list';
export const MATERIAL_ASSIGN_FEATURE = 'material.assign';
export const MATERIAL_THUMB_FEATURE = 'material.thumb';
/** `uses {excerpts, sources, tasks}` on each file of `/material`, `GET /material/<I…>/uses` (Strom Research 1.35, spec 102). */
export const MATERIAL_USES_FEATURE = 'material.uses';
/** `POST /material/edit {ids, title?, kind?, date?}`: a file's title, kind and date (Strom Research 1.35, spec 102). */
export const MATERIAL_EDIT_FEATURE = 'material.edit';
/** `POST /material/sort`: the research's agent proposes titles and places for files (only a research with an agent). */
export const MATERIAL_SORT_FEATURE = 'material.sort';
/** `uses.of` on `/material` and `of` on `GET /material/<I…>/uses`: the sources whose file a file is (spec 102 K1.14, research 1.35). */
export const MATERIAL_SOURCE_OF_FEATURE = 'material.sourceOf';
/** `POST /material/sort` with 51–1500 files is a run of batches the research keeps; its `GET` and `cancel` (spec 102 K1.12). */
export const MATERIAL_SORT_RUN_FEATURE = 'material.sortRun';
/** `left {at, sort, why, said?}` on a file of `/material`: the agent left it unassigned last time (spec 102 K1.13). */
export const MATERIAL_LEFT_FEATURE = 'material.left';
/** `sameAs: "I…"` on a file of `/material`: an older file of the material has the same content (spec 102 K1.13). */
export const MATERIAL_SAME_AS_FEATURE = 'material.sameAs';
/** `POST /material/delete` with `dryRun` and the bridge's `confirm`: a file deleted for good (spec 102 K1.17). */
export const MATERIAL_DELETE_FEATURE = 'material.delete';
/**
 * The research lists its family tree files in Materials (`?trees=1`, `kind: "tree"`) and deletes them for
 * good together with their source (spec 117 §5–§7). Announced only with `source.retract` and
 * `material.delete`: the app takes it as all three.
 */
export const MATERIAL_TREES_FEATURE = 'material.trees';

/** Preview sizes the bridge makes (longer side, px). */
export const THUMB_SIZES = [128, 256, 512] as const;
export type ThumbSize = typeof THUMB_SIZES[number];

// ==================== TYPES ====================

export type { MaterialKind };
/** What a file is by its type, for its icon and label when it has no kind. */
export type MaterialType = 'image' | 'pdf' | 'audio' | 'file';
/** Why a file is hidden; 'removed': taken out of the tree (spec 102 §9, the research's M3). */
export type HiddenReason = 'unrelated' | 'duplicate' | 'removed';

export interface MaterialNote {
    at?: string;
    /** `user` = the sender's note; anything else = whoever sorted the file. */
    by?: string;
    text: string;
}

export interface MaterialHidden {
    at?: string;
    by?: string;
    reason?: HiddenReason;
}

/** One file of `GET /material` (only the fields the app reads; unknown ones are dropped). */
export interface MaterialFile {
    id: string;
    name: string;
    sha: string;
    mime?: string;
    bytes?: number;
    /** When the research received it (ISO). */
    at?: string;
    from?: string;
    /** People (REFN) the file concerns; always present, may be empty. */
    persons: string[];
    batch?: string;
    /** Path inside its batch ("Grandma/Letters/1946.jpg"). */
    path?: string;
    notes?: MaterialNote[];
    state?: 'new' | 'processed' | 'skipped';
    sorted?: { as?: string; persons?: string[]; source?: string; reason?: string };
    source?: string;
    /** false: the file is not on the research's computer (the record stays). */
    here?: boolean;
    title?: string;
    kind?: MaterialKind;
    /** The document's own date as written (GEDCOM-like text), not when it came. */
    date?: string;
    hidden?: MaterialHidden;
    /** 'app': a file of the tree (now or once), material.links. */
    origin?: 'app';
    /** Where the research has it linked (material.links): a person, family or source, maybe one of its events. */
    links?: MaterialLink[];
    /** Where the research uses it (material.uses; on every file with the gate). */
    uses?: MaterialUses;
    /** The agent left it unassigned in the last finished sorting that took it (`material.left`, spec 102 K1.13). */
    left?: MaterialLeft;
    /** The oldest other file of the material with the same content (`material.sameAs`, spec 102 K1.13). */
    sameAs?: string;
    /** A family tree file (`kind: "tree"`, only with `?trees=1` and `material.trees`, spec 117 §5): never sorted nor edited. */
    tree?: boolean;
}

/** A file the agent left unassigned, as the research says it (`left`). */
export interface MaterialLeft {
    at: string;
    /** The sorting that left it (sort-…). */
    sort?: string;
    why: 'nothing-said' | 'nothing-new' | 'dropped';
    /** What its reader wrote of it. */
    said?: string;
}

export interface MaterialLink {
    type: string;
    ref: string;
    event?: string;
}

/** The research's uses of a file: excerpts cut from it, its sources, the open tasks holding it. */
export interface MaterialUses {
    excerpts: number;
    sources: string[];
    tasks: number;
    /** The sources whose file it is (`material.sourceOf`, spec 102 K1.14); one per source, by S…. */
    of?: MaterialSourceOf[];
}

/** A source whose file a file is: `input` (made from it), `excerpt` (an excerpt of it on the same content), `media` (its picture). */
export interface MaterialSourceOf {
    source: string;
    via: 'input' | 'excerpt' | 'media';
    title?: string;
    /** People (REFN) whose events or names cite the source, at most 5; `citedCount` all of them. */
    cited: string[];
    citedCount: number;
    /** The source comes to the tree (the research's `/tree.ged`). */
    inTree: boolean;
}

export interface MaterialBatch {
    id: string;
    name: string;
    at?: string;
    done?: string;
    /** Files of the batch in the answer (with `?person=` only that person's). */
    files: number;
    /** People the whole batch was sent to. */
    persons?: string[];
    note?: string;
}

export interface MaterialList {
    files: MaterialFile[];
    batches: MaterialBatch[];
    /** REFN → name as the research knows it ("Jan Novák (1901–1975)"). */
    people: Record<string, string>;
    /** When the app received it (ms). */
    fetchedAt: number;
}

/** A person kept on a file only through its batch (answer of `assign`). */
export interface MaterialKept {
    id: string;
    person: string;
    batch: string;
}

/** One row of the materials: an attachment, a research file, or both joined. */
export interface MaterialItem {
    /** 'a:<attachmentId>' | 'm:<I…>' */
    key: string;
    origin: 'tree' | 'both' | 'archive';
    attachment?: Attachment;
    file?: MaterialFile;
    /** What the file is called where it is shown: the tree's title › the research's title › the file's name (spec 102 §2). */
    title: string;
    /** The file's own name (file.name › attachment.name). */
    name: string;
    /** It has a title of its own (`title` is not just the name). */
    titled: boolean;
    kind?: MaterialKind;
    date?: string;
    mime?: string;
    bytes?: number;
    /** When it came (file.at; a file of the tree: when it was added, in the overview). */
    at?: string;
    batch?: { id: string; name: string };
    path?: string;
    /** People (REFN). */
    persons: string[];
    /** People only through the batch the file came in. */
    viaBatch: string[];
    /** The sender's note (notes by "user"), else the attachment's note. */
    noteUser?: string;
    hidden?: { reason?: HiddenReason };
    /** The file is on the research's computer (attachments: always). */
    here: boolean;
    state?: MaterialFile['state'];
    /** How many places of the tree it is used in (the overview; src/media-uses.ts). */
    uses?: number;
    /** The first source it is evidence of or cut out for, by title (the overview; none: without a source). */
    source?: string;
    /** The tree's record of it, taken out of the tree (spec 102 §9): "Restore" brings it back with its places. */
    removedId?: string;
    /** The agent left it unassigned and it still lacks a title or a person (spec 102 §4.4; set by the Materials window). */
    agentLeft?: { why?: string; said?: string };
    /** It has the same content as an older file (its I…) and is not sent to the agent (spec 102 §4.2; set by the Materials window). */
    copyOf?: string;
    /** The sources whose file it is (`material.sourceOf`, spec 102 §7; set by the overview with the gate): it counts as assigned. */
    sourceOf?: MaterialSourceOf[];
    /** A family tree file of the research (spec 117 §5): only Details and Delete permanently…, outside sorting and bulk actions. */
    tree?: boolean;
}

// ==================== READING THE BRIDGE'S ANSWER ====================

const FILE_ID = /^I\d{1,7}$/;
const SHA = /^[0-9a-f]{64}$/;
const KINDS: readonly MaterialKind[] = ['photo', 'document', 'record', 'other'];
const STATES = ['new', 'processed', 'skipped'] as const;

function text(v: unknown, max = 500): string | undefined {
    const s = cleanText(v, max);
    return s ? s : undefined;
}

function refs(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const r of v) {
        const ref = researchPersonRef(r);
        if (ref && !out.includes(ref)) out.push(ref);
    }
    return out;
}

function isoTime(v: unknown): string | undefined {
    return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : undefined;
}

function hiddenOf(v: unknown): MaterialHidden | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const h = v as Record<string, unknown>;
    const out: MaterialHidden = {};
    const at = isoTime(h.at);
    if (at) out.at = at;
    const by = text(h.by, 40);
    if (by) out.by = by;
    if (h.reason === 'unrelated' || h.reason === 'duplicate' || h.reason === 'removed') out.reason = h.reason;
    return out;
}

/** One file record from the bridge, or null when it is not one. */
export function parseMaterialFile(raw: unknown): MaterialFile | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const sha = typeof r.sha === 'string' ? r.sha.trim().toLowerCase() : '';
    if (!FILE_ID.test(id) || !SHA.test(sha)) return null;
    const file: MaterialFile = { id, sha, name: text(r.name, 300) ?? id, persons: refs(r.persons) };
    const mime = text(r.mime, 120);
    if (mime && /^[\w.+-]+\/[\w.+-]+$/.test(mime)) file.mime = mime.toLowerCase();
    if (typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes >= 0) file.bytes = r.bytes;
    const at = isoTime(r.at);
    if (at) file.at = at;
    const from = text(r.from, 80);
    if (from) file.from = from;
    const batch = text(r.batch, 120);
    if (batch) file.batch = batch;
    const path = text(r.path, 1000);
    if (path) file.path = path;
    if (Array.isArray(r.notes)) {
        const notes = r.notes.flatMap((n): MaterialNote[] => {
            if (!n || typeof n !== 'object') return [];
            const o = n as Record<string, unknown>;
            const t = text(o.text, 2000);
            if (!t) return [];
            const note: MaterialNote = { text: t };
            const nat = isoTime(o.at);
            if (nat) note.at = nat;
            const by = text(o.by, 40);
            if (by) note.by = by;
            return [note];
        });
        if (notes.length) file.notes = notes;
    }
    if (typeof r.state === 'string' && (STATES as readonly string[]).includes(r.state)) file.state = r.state as MaterialFile['state'];
    if (r.sorted && typeof r.sorted === 'object') {
        const s = r.sorted as Record<string, unknown>;
        const sorted: NonNullable<MaterialFile['sorted']> = {};
        const as = text(s.as, 40);
        if (as) sorted.as = as;
        const sp = refs(s.persons);
        if (sp.length) sorted.persons = sp;
        const src = text(s.source, 20);
        if (src) sorted.source = src;
        const reason = text(s.reason, 500);
        if (reason) sorted.reason = reason;
        file.sorted = sorted;
    }
    const source = text(r.source, 20);
    if (source) file.source = source;
    if (r.here === false) file.here = false;
    const title = text(r.title, 300);
    if (title) file.title = title;
    if (typeof r.kind === 'string' && (KINDS as readonly string[]).includes(r.kind)) file.kind = r.kind as MaterialKind;
    // A family tree file (spec 117 §5): its kind stays outside KINDS, so sorting and bulk edits never take it.
    else if (r.kind === 'tree') file.tree = true;
    const date = text(r.date, 60);
    if (date) file.date = date;
    const hidden = hiddenOf(r.hidden);
    if (hidden) file.hidden = hidden;
    if (r.origin === 'app') file.origin = 'app';
    if (Array.isArray(r.links)) {
        const links = r.links.slice(0, 500).flatMap((l): MaterialLink[] => {
            if (!l || typeof l !== 'object') return [];
            const o = l as Record<string, unknown>;
            const type = text(o.type, 40);
            const ref = text(o.ref, 40);
            if (!type || !ref) return [];
            const event = text(o.event, 80);
            return [{ type, ref, ...(event ? { event } : {}) }];
        });
        if (links.length) file.links = links;
    }
    const uses = usesOf(r.uses);
    if (uses) file.uses = uses;
    const left = leftOf(r.left);
    if (left) file.left = left;
    if (typeof r.sameAs === 'string' && FILE_ID.test(r.sameAs) && r.sameAs !== id) file.sameAs = r.sameAs;
    return file;
}

const LEFT_WHYS: readonly MaterialLeft['why'][] = ['nothing-said', 'nothing-new', 'dropped'];

function leftOf(v: unknown): MaterialLeft | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    const at = isoTime(o.at);
    if (!at || !LEFT_WHYS.includes(o.why as MaterialLeft['why'])) return undefined;
    const sort = typeof o.sort === 'string' && /^sort-[0-9A-Za-z-]{1,60}$/.test(o.sort) ? o.sort : undefined;
    const said = text(o.said, 1000);
    return { at, why: o.why as MaterialLeft['why'], ...(sort ? { sort } : {}), ...(said ? { said } : {}) };
}

const SOURCE_REF = /^S\d{1,9}$/;

function sourceOfList(v: unknown): MaterialSourceOf[] {
    if (!Array.isArray(v)) return [];
    const out: MaterialSourceOf[] = [];
    for (const x of v.slice(0, 200)) {
        if (!x || typeof x !== 'object') continue;
        const o = x as Record<string, unknown>;
        const source = typeof o.source === 'string' ? o.source.trim() : '';
        if (!SOURCE_REF.test(source) || out.some(y => y.source === source)) continue;
        const via = o.via === 'input' || o.via === 'excerpt' || o.via === 'media' ? o.via : null;
        if (!via) continue;
        const title = text(o.title, 300);
        const cited = refs(o.cited).slice(0, 5);
        out.push({ source, via, ...(title ? { title } : {}), cited, citedCount: Math.max(count(o.citedCount), cited.length), inTree: o.inTree === true });
    }
    return out;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * The research's uses of a file: `uses` of a file in `GET /material`, or the
 * answer of `GET /material/<I…>/uses` (the same fields; `of` with `material.sourceOf`).
 */
export function parseMaterialUses(v: unknown): MaterialUses | undefined {
    return usesOf(v);
}

function usesOf(v: unknown): MaterialUses | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const u = v as Record<string, unknown>;
    const sources = Array.isArray(u.sources)
        ? [...new Set(u.sources.slice(0, 500).map(x => text(x, 40)).filter((x): x is string => !!x))] : [];
    const of = sourceOfList(u.of);
    return { excerpts: count(u.excerpts), sources, tasks: count(u.tasks), ...(of.length ? { of } : {}) };
}

export function parseMaterialBatch(raw: unknown): MaterialBatch | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = text(r.id, 120);
    if (!id) return null;
    const batch: MaterialBatch = {
        id, name: text(r.name, 300) ?? id,
        files: typeof r.files === 'number' && Number.isFinite(r.files) && r.files >= 0 ? Math.floor(r.files) : 0,
    };
    const at = isoTime(r.at);
    if (at) batch.at = at;
    const done = isoTime(r.done);
    if (done) batch.done = done;
    const persons = refs(r.persons);
    if (persons.length) batch.persons = persons;
    const note = text(r.note, 2000);
    if (note) batch.note = note;
    return batch;
}

export function parsePeople(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const ref = researchPersonRef(k);
        const name = text(v, 200);
        if (ref && name) out[ref] = name;
    }
    return out;
}

function parseFiles(raw: unknown): MaterialFile[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: MaterialFile[] = [];
    for (const r of raw) {
        const f = parseMaterialFile(r);
        if (f && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
    }
    return out;
}

/** The bridge's `GET /material` answer as a list (unknown or broken records left out). */
export function parseMaterialList(body: unknown, fetchedAt: number = Date.now()): MaterialList {
    const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const batches = Array.isArray(b.batches)
        ? b.batches.map(parseMaterialBatch).filter((x): x is MaterialBatch => !!x) : [];
    return { files: parseFiles(b.files), batches, people: parsePeople(b.people), fetchedAt };
}

// ==================== HELPERS ====================

/** Lowercase extension of a file name ("tif"), or ''. */
export function fileExt(name: string | undefined): string {
    const m = /\.([a-z0-9]{1,8})$/i.exec(name ?? '');
    return m ? m[1].toLowerCase() : '';
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'heif', 'bmp']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac', 'opus']);

/** What a file is by its type (mime, else its extension). */
export function materialType(mime: string | undefined, name?: string): MaterialType {
    const m = (mime ?? '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m === 'application/pdf') return 'pdf';
    if (m.startsWith('audio/')) return 'audio';
    if (m && m !== 'application/octet-stream') return 'file';
    const ext = fileExt(name);
    if (IMAGE_EXT.has(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (AUDIO_EXT.has(ext)) return 'audio';
    return 'file';
}

/** Images the research makes no preview of (`?thumb=` answers 415 `thumb.type`). */
const NO_RESEARCH_THUMB_MIME = new Set(['image/tiff', 'image/gif', 'image/webp']);
const NO_RESEARCH_THUMB_EXT = new Set(['tif', 'tiff', 'gif', 'webp']);

/** Does the research make a preview of this file (`?thumb=`)? Images but TIFF / GIF / WebP, and PDFs. */
export function researchMakesThumb(mime: string | undefined, name?: string): boolean {
    const type = materialType(mime, name);
    if (type === 'pdf') return true;
    if (type !== 'image') return false;
    const m = (mime ?? '').toLowerCase();
    // An image by its type, else (no type given) by its name's extension.
    return m.startsWith('image/') ? !NO_RESEARCH_THUMB_MIME.has(m) : !NO_RESEARCH_THUMB_EXT.has(fileExt(name));
}

/** The item's name for its file type ("TIFF"), shown beside an image the app cannot show. */
function rawImageSuffix(mime: string | undefined, name: string | undefined): string {
    const m = (mime ?? '').toLowerCase();
    const ext = fileExt(name);
    if (m === 'image/tiff' || ext === 'tif' || ext === 'tiff') return 'TIFF';
    if (m === 'image/heic' || m === 'image/heif' || ext === 'heic' || ext === 'heif') return 'HEIC';
    return '';
}

/** The kind as a label: its kind (Photo, Document…), else by type (Image TIFF, PDF, Audio, File). */
export function materialKindLabel(item: Pick<MaterialItem, 'kind' | 'mime' | 'file' | 'attachment'> & { name?: string; title?: string; tree?: boolean }): string {
    const m = strings.materials;
    if (item.tree || item.file?.tree) return m.treeFile;
    if (item.kind) return m.kind[item.kind] ?? m.kind.other;
    const name = item.file?.name ?? item.attachment?.name ?? item.name ?? item.title;
    const type = materialType(item.mime, name);
    const label = m.type[type] ?? m.type.file;
    const suffix = type === 'image' ? rawImageSuffix(item.mime, name) : '';
    return suffix ? `${label} ${suffix}` : label;
}

/** The folder of a path inside its batch, for showing ("Grandma / Letters"), or ''. */
export function materialFolder(path: string | undefined): string {
    if (!path) return '';
    const parts = path.split('/').map(p => p.trim()).filter(Boolean);
    parts.pop();
    return parts.join(' / ');
}

/** "batch › folder"; a file outside a batch (also the tree's own file): "Single files". */
export function batchFolderLabel(item: Pick<MaterialItem, 'batch' | 'path'> & { origin?: MaterialItem['origin'] }): string {
    // A file of the tree without its original in the research: "In the tree" (where it came from is not told apart).
    if (item.origin === 'tree') return strings.materials.inTreeTag;
    if (!item.batch) return strings.materials.loose;
    const folder = materialFolder(item.path);
    return folder ? `${item.batch.name} › ${folder}` : item.batch.name;
}

/** Fold for comparing: lowercase, without diacritics. */
export function foldText(s: string): string {
    return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Does the item match a search (every word, without diacritics, in title, name, path and notes)? */
export function materialMatches(item: MaterialItem, query: string): boolean {
    const words = foldText(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const hay = foldText([
        item.title, item.file?.name, item.attachment?.name, item.path,
        ...(item.file?.notes ?? []).map(n => n.text), item.attachment?.note,
    ].filter(Boolean).join('\n'));
    return words.every(w => hay.includes(w));
}

/**
 * A file nobody said whom it concerns: no person on it, none from sorting and none on its batch.
 * `sourceOf` (the research has `material.sourceOf`): the file of a source counts as assigned (spec 102 §7).
 */
export function fileWithoutPerson(file: MaterialFile, list: Pick<MaterialList, 'batches'>, opts: { sourceOf?: boolean } = {}): boolean {
    if (file.persons.length || file.sorted?.persons?.length) return false;
    if (opts.sourceOf && file.uses?.of?.length) return false;
    const batch = file.batch ? list.batches.find(b => b.id === file.batch) : undefined;
    return !batch?.persons?.length;
}

function noteOfSender(file: MaterialFile): string | undefined {
    const notes = (file.notes ?? []).filter(n => n.by === 'user').map(n => n.text);
    return notes.length ? notes.join('\n') : undefined;
}

/**
 * The note a research file takes along when it becomes a file of the tree
 * (linked, used as a portrait or as a source's file): the sender's last note,
 * the one the research reads as the file's note in a send (a file of the
 * tree without it reads as its note taken off). A file of the tree already:
 * its own note. None: no note of the sender.
 */
export function materialRecordNote(item: Pick<MaterialItem, 'file' | 'attachment'>): string | undefined {
    if (item.attachment) return item.attachment.note || undefined;
    const last = [...(item.file?.notes ?? [])].reverse().find(n => n.by === 'user');
    return last?.text || undefined;
}

function batchMap(list: Pick<MaterialList, 'batches'>): Map<string, MaterialBatch> {
    return new Map(list.batches.map(b => [b.id, b]));
}

/** A research file as an item (joined with the tree's attachment of the same original, when there is one). */
export function materialFileItem(
    file: MaterialFile, list: Pick<MaterialList, 'batches'>, attachment?: Attachment,
    batches: Map<string, MaterialBatch> = batchMap(list),
): MaterialItem {
    const batch = file.batch ? batches.get(file.batch) : undefined;
    const direct = [...file.persons];
    for (const p of file.sorted?.persons ?? []) if (!direct.includes(p)) direct.push(p);
    const viaBatch = (batch?.persons ?? []).filter(p => !direct.includes(p));
    // A file in the tree: the tree's title, kind and date (they are written to the research with the tree).
    const title = attachment?.title?.trim() || file.title?.trim() || '';
    const item: MaterialItem = {
        key: `m:${file.id}`,
        origin: attachment ? 'both' : 'archive',
        file,
        title: title || file.name,
        name: file.name,
        titled: !!title,
        persons: [...direct, ...viaBatch],
        viaBatch,
        here: file.here !== false,
    };
    if (attachment) item.attachment = attachment;
    const kind = attachment?.kind ?? file.kind;
    if (kind) item.kind = kind;
    const date = attachment?.date || file.date;
    if (date) item.date = date;
    const mime = file.mime ?? attachment?.original?.mimeType ?? attachment?.mimeType;
    if (mime) item.mime = mime;
    const bytes = file.bytes ?? attachment?.original?.bytes;
    if (bytes !== undefined) item.bytes = bytes;
    if (file.at) item.at = file.at;
    if (file.batch) item.batch = { id: file.batch, name: batch?.name ?? file.batch };
    if (file.path) item.path = file.path;
    const note = noteOfSender(file) ?? attachment?.note;
    if (note) item.noteUser = note;
    if (file.hidden) item.hidden = file.hidden.reason ? { reason: file.hidden.reason } : {};
    if (file.state) item.state = file.state;
    if (file.tree) item.tree = true;
    return item;
}

/** A file of the tree without its original in the research (`persons`: its people's keys, or one REFN). */
export function attachmentItem(att: Attachment, persons: string | null | readonly string[]): MaterialItem {
    const item: MaterialItem = {
        key: `a:${att.id}`,
        origin: 'tree',
        attachment: att,
        title: att.title?.trim() || att.name,
        name: att.name,
        titled: !!att.title?.trim(),
        mime: att.original?.mimeType ?? att.mimeType,
        bytes: att.original?.bytes ?? att.sizeBytes,
        persons: typeof persons === 'string' ? [persons] : persons ? [...persons] : [],
        viaBatch: [],
        here: true,
    };
    if (att.kind) item.kind = att.kind;
    if (att.date) item.date = att.date;
    if (att.note) item.noteUser = att.note;
    return item;
}

/** Does the file concern the person (directly, from sorting, or through its batch)? */
export function fileConcerns(file: MaterialFile, refn: string, batches: Map<string, MaterialBatch>): boolean {
    if (file.persons.includes(refn) || file.sorted?.persons?.includes(refn)) return true;
    const batch = file.batch ? batches.get(file.batch) : undefined;
    return !!batch?.persons?.includes(refn);
}

/** Newest first by `at`; items without it at the end in their order. */
export function sortMaterialItems(items: MaterialItem[]): MaterialItem[] {
    const time = (i: MaterialItem) => i.at ? Date.parse(i.at) : NaN;
    return items
        .map((item, index) => ({ item, index, t: time(item) }))
        .sort((a, b) => {
            const at = Number.isNaN(a.t), bt = Number.isNaN(b.t);
            if (at !== bt) return at ? 1 : -1;
            if (!at && a.t !== b.t) return b.t - a.t;
            return a.index - b.index;
        })
        .map(x => x.item);
}

/**
 * One person's materials: their attachments, joined with the research's files
 * by the original's hash (`both`), the research's files concerning the person
 * (`archive`) and attachments without an original there (`tree`). A person
 * without a REFN (or without a list): attachments only. Hidden files are left
 * out unless asked for.
 */
/** A person as the materials see them: the REFN and the files at the person (data v24: StromData.media). */
export interface MaterialPerson {
    refn?: string;
    attachments?: readonly Attachment[];
}

/** The person's REFN and files, from the tree. */
export function materialPerson(data: StromData, person: Pick<Person, 'id' | 'refn'>): MaterialPerson {
    return { refn: person.refn, attachments: personMedia(data, person.id) };
}

export function personMaterials(person: MaterialPerson, list?: MaterialList | null, opts: { includeHidden?: boolean } = {}): MaterialItem[] {
    const refn = researchPersonRef(person.refn);
    const attachments = person.attachments ?? [];
    if (!list || !refn) return attachments.map(a => attachmentItem(a, refn));
    const batches = batchMap(list);
    const bySha = new Map<string, MaterialFile>();
    for (const f of list.files) if (!bySha.has(f.sha)) bySha.set(f.sha, f);
    const used = new Set<string>();
    const items: MaterialItem[] = [];
    for (const att of attachments) {
        const file = att.original?.sha256 ? bySha.get(att.original.sha256.toLowerCase()) : undefined;
        if (file && !used.has(file.id)) {
            used.add(file.id);
            items.push(materialFileItem(file, list, att, batches));
        } else {
            items.push(attachmentItem(att, refn));
        }
    }
    for (const file of list.files) {
        if (used.has(file.id) || !fileConcerns(file, refn, batches)) continue;
        items.push(materialFileItem(file, list, undefined, batches));
    }
    const shown = opts.includeHidden ? items : items.filter(i => !i.hidden);
    return sortMaterialItems(shown);
}

// ==================== GATES AND ACTIONS ====================

/** What the gates look at: the research's capabilities (also remembered), the tree, the device, the bridge. */
export interface MaterialEnv {
    features?: readonly string[] | null;
    /** The tree is linked to a research (or an archive). */
    linked: boolean;
    /** A computer, not touch (the same test as the research's actions: not `(pointer: coarse)`). */
    onComputer: boolean;
    /** The research's bridge answers now. */
    bridgeUp: boolean;
}

const has = (env: MaterialEnv, f: string) => !!env.features?.includes(f);

/** Materials from the research are shown (also from the cache while the research is not running). */
export function matList(env: MaterialEnv): boolean {
    return env.linked && env.onComputer && has(env, MATERIAL_LIST_FEATURE);
}

/** The research can assign and hide (the actions are offered; they work while the bridge answers). */
export function matAssign(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_ASSIGN_FEATURE);
}

/** The research makes previews now. */
export function matThumb(env: MaterialEnv): boolean {
    return matList(env) && env.bridgeUp && has(env, MATERIAL_THUMB_FEATURE);
}

/** The research says where each file is used (`material.uses`). */
export function matUses(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_USES_FEATURE);
}

/** The research edits a file's title, kind and date (`material.edit`). */
export function matEdit(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_EDIT_FEATURE);
}

/** The research's agent sorts files (`material.sort`; never an archive or a research waiting for its agent). */
export function matSort(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_SORT_FEATURE);
}

/** The research keeps a run of batches (`material.sortRun`): one action sends up to 1500 files. */
export function matSortRun(env: MaterialEnv): boolean {
    return matSort(env) && has(env, MATERIAL_SORT_RUN_FEATURE);
}

/** The research says which sources a file is the file of (`material.sourceOf`). */
export function matSourceOf(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_SOURCE_OF_FEATURE);
}

/** The research says which files the agent left unassigned (`material.left`). */
export function matLeft(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_LEFT_FEATURE);
}

/** The research says which files have the same content as an older one (`material.sameAs`). */
export function matSameAs(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_SAME_AS_FEATURE);
}

/** The research deletes a file for good, after the dialog's confirmation (`material.delete`). */
export function matDelete(env: MaterialEnv): boolean {
    return matList(env) && has(env, MATERIAL_DELETE_FEATURE);
}

/** The research lists its family tree files and deletes them (`material.trees`, taken only with `material.delete`). */
export function matTrees(env: MaterialEnv): boolean {
    return matDelete(env) && has(env, MATERIAL_TREES_FEATURE);
}

export interface MaterialCaps {
    list: boolean;
    assign: boolean;
    thumb: boolean;
    bridgeUp: boolean;
    /** The research keeps the files' titles and places and gives them back (`material.links`). */
    links: boolean;
    /** The research edits a file outside the tree (`material.edit`). */
    edit: boolean;
    /** The research says where each file is used (`material.uses`). */
    uses: boolean;
    /** The research's agent sorts files (`material.sort`). */
    sort: boolean;
    /** The research keeps a run of batches (`material.sortRun`). */
    sortRun: boolean;
    /** The research says which sources a file is the file of (`material.sourceOf`). */
    sourceOf: boolean;
    /** The research says which files the agent left unassigned (`material.left`). */
    left: boolean;
    /** The research says which files have the same content as an older one (`material.sameAs`). */
    sameAs: boolean;
    /** The research deletes a file for good (`material.delete`). */
    delete: boolean;
    /** The research lists its family tree files and deletes them with their source (`material.trees`, spec 117 §5). */
    trees?: boolean;
    /** The research keeps the tree's own files (`media.app`). */
    mediaApp: boolean;
    /** Links into the research open (`/status.links`, also remembered); default yes. */
    openLinks?: boolean;
}

export function materialCaps(env: MaterialEnv & { openLinks?: boolean }): MaterialCaps {
    const caps: MaterialCaps = {
        list: matList(env), assign: matAssign(env), thumb: matThumb(env), bridgeUp: env.bridgeUp,
        links: env.linked && has(env, MATERIAL_LINKS_FEATURE),
        edit: matEdit(env), uses: matUses(env), sort: matSort(env),
        sortRun: matSortRun(env), sourceOf: matSourceOf(env), left: matLeft(env), sameAs: matSameAs(env), delete: matDelete(env), trees: matTrees(env),
        mediaApp: env.linked && has(env, MEDIA_APP_FEATURE),
    };
    if (env.openLinks !== undefined) caps.openLinks = env.openLinks;
    return caps;
}

export type MaterialActionId =
    | 'open' | 'assign' | 'removeFromPerson' | 'hide' | 'restore'
    | 'openSystem' | 'showInBatch' | 'download' | 'useAsPortrait' | 'removeFromTree' | 'edit' | 'attach' | 'makeSource';

export interface MaterialAction {
    id: MaterialActionId;
    /** Offered, but not now: why. */
    disabled?: 'bridgeDown';
    /** removeFromPerson: the person is on the item only through its batch (offer removing from the whole batch). */
    viaBatch?: boolean;
}

export interface MaterialActionContext {
    /** The person whose materials are shown (REFN). */
    person?: string | null;
    /** Where the actions are shown: the item's ⋯ menu (default) or the viewer. */
    where?: 'menu' | 'viewer';
    /** The tree already has the item's file as a picture it shows (at another person): Use as portrait… needs no bridge. */
    treeCopy?: (item: MaterialItem) => boolean;
}

interface ActionRow {
    id: MaterialActionId;
    /** Offered for the item at all. */
    when: (item: MaterialItem, caps: MaterialCaps, ctx: MaterialActionContext) => boolean;
    /** Writes to the research: offered but disabled while the bridge does not answer. */
    writes?: boolean | ((item: MaterialItem, ctx: MaterialActionContext) => boolean);
    extra?: (item: MaterialItem, ctx: MaterialActionContext) => Partial<MaterialAction>;
}

const inArchive = (item: MaterialItem) => item.origin !== 'tree' && !!item.file;
/** A file with a place in the tree. */
// The tree's file (not one taken out of it, spec 102 §9).
const inTree = (item: MaterialItem) => !!item.attachment && !item.attachment.removed;

/**
 * The actions in their order (the ⋯ menu and the viewer are built from this;
 * later actions — editing, using as a portrait… — are new rows here).
 */
const ACTION_ROWS: ActionRow[] = [
    { id: 'open', when: () => true },
    // Title, kind and date (spec 102 §2): the tree's file in the tree, material outside it in the research.
    { id: 'edit', writes: (i) => !i.attachment, when: (i, c) => (i.attachment ? true : inArchive(i) && c.edit) },
    // Link to… (spec 102 §4): a file of the tree in the tree; material outside it needs its working copy from the bridge.
    { id: 'attach', writes: (i) => !inTree(i), when: (i, c) => inTree(i) || (inArchive(i) && c.assign) },
    // Create a source from this file… (spec 102 §5): as Link to…, the file becomes the source's evidence.
    { id: 'makeSource', writes: (i) => !inTree(i), when: (i, c) => inTree(i) || (inArchive(i) && c.assign) },
    {
        id: 'removeFromPerson', writes: true,
        when: (i, c, x) => inArchive(i) && c.assign && !!x.person && i.persons.includes(x.person),
        extra: (i, x) => (x.person && i.viaBatch.includes(x.person) ? { viaBatch: true } : {}),
    },
    // Hide… only for material outside the tree; a file in it is removed from the tree instead (§9).
    { id: 'hide', writes: true, when: (i, c) => inArchive(i) && c.assign && !i.hidden && !inTree(i) },
    // Restore: a file taken out of the tree comes back to the tree with its places (no bridge needed).
    { id: 'restore', writes: (i) => !i.removedId, when: (i, c) => inArchive(i) && (c.assign || !!i.removedId) && !!i.hidden },
    { id: 'openSystem', when: (i, c) => inArchive(i) && c.openLinks !== false },
    { id: 'showInBatch', when: (i) => inArchive(i) && !!i.batch },
    { id: 'download', when: (i) => i.origin === 'tree' },
    // A picture as the person's portrait (spec 107 §4; the menu leaves it out where the person cannot change): the tree's
    // attachment, or a picture of the research the person is named in — its working copy comes over the bridge, so it
    // waits for the bridge (as Link to…) unless the tree already has the file at another person.
    {
        id: 'useAsPortrait',
        writes: (i, x) => !isPortraitCandidate(i.attachment) && !x.treeCopy?.(i),
        when: (i, c, x) => isPortraitCandidate(i.attachment) || (isMaterialPortraitCandidate(i, x.person) && (c.assign || !!x.treeCopy?.(i))),
    },
    { id: 'removeFromTree', when: (i) => inTree(i) },
];

/** An attachment that can become a portrait: a picture the tree shows (not only its original kept by the research). */
export function isPortraitCandidate(att: Attachment | undefined): boolean {
    return !!att && att.mimeType.startsWith('image/') && !att.originalOnly && !!att.dataUrl;
}

/** Pictures a portrait can be cut from (the working copy the tree makes of them shows them). */
const PORTRAIT_MIMES = ['image/jpeg', 'image/png'];

/**
 * A picture of the research that names the person (REFN) and is not the
 * tree's file at them: Use as portrait… makes it the tree's file at the person.
 */
export function isMaterialPortraitCandidate(item: MaterialItem, person: string | null | undefined): boolean {
    if (item.attachment || item.tree || item.removedId || item.hidden || !inArchive(item) || !person || !item.persons.includes(person)) return false;
    return PORTRAIT_MIMES.includes((item.mime ?? item.file?.mime ?? '').toLowerCase());
}

/** The actions of one item (P1). */
export function materialActions(item: MaterialItem, caps: MaterialCaps, ctx: MaterialActionContext = {}): MaterialAction[] {
    const out: MaterialAction[] = [];
    // A family tree file (spec 117 §5): Details only; Delete permanently… is the menu's own last row.
    if (item.tree) return [{ id: 'open' }];
    for (const row of ACTION_ROWS) {
        if (!row.when(item, caps, ctx)) continue;
        const action: MaterialAction = { id: row.id, ...(row.extra?.(item, ctx) ?? {}) };
        const writes = typeof row.writes === 'function' ? row.writes(item, ctx) : row.writes;
        if (writes && !caps.bridgeUp) action.disabled = 'bridgeDown';
        out.push(action);
    }
    return out;
}

/** Who a file names itself: its own people and those from sorting (not its batch's). */
export function directPersons(file: Pick<MaterialFile, 'persons' | 'sorted'>): string[] {
    const out = [...file.persons];
    for (const p of file.sorted?.persons ?? []) if (!out.includes(p)) out.push(p);
    return out;
}

/** Where a file came from by its `from` (a key of `materials.from`; null: not known). */
export function materialFromKey(from: string | undefined): 'app' | 'batch' | 'phone' | 'cli' | null {
    const f = (from ?? '').toLowerCase();
    if (!f) return null;
    if (f.includes('batch')) return 'batch';
    if (f.includes('phone')) return 'phone';
    if (f.includes('terminal') || f === 'cli') return 'cli';
    if (f.includes('app')) return 'app';
    return null;
}

/** The people an assign really put on files (by the records before and after), in `add`'s order. */
export function addedPersons(before: readonly MaterialFile[], after: readonly MaterialFile[], add: readonly string[]): string[] {
    const prev = new Map(before.map(f => [f.id, new Set(directPersons(f))]));
    const got = new Set<string>();
    for (const f of after) {
        const was = prev.get(f.id) ?? new Set<string>();
        for (const p of directPersons(f)) if (!was.has(p)) got.add(p);
    }
    return add.filter(p => got.has(p));
}

/**
 * The writes that take an assign back: each person off the files the
 * operation really added them to, and back on the files it really took them
 * off (not where they were before). Files with the same change share one
 * request. Pure.
 */
export function assignUndoRequests(before: readonly MaterialFile[], after: readonly MaterialFile[]): AssignRequest[] {
    const prev = new Map(before.map(f => [f.id, new Set(directPersons(f))]));
    const byFile = new Map<string, { add: string[]; remove: string[] }>();
    for (const f of after) {
        const was = prev.get(f.id);
        if (!was) continue;
        const now = new Set(directPersons(f));
        const change = { add: [...was].filter(p => !now.has(p)), remove: [...now].filter(p => !was.has(p)) };
        if (change.add.length || change.remove.length) byFile.set(f.id, change);
    }
    const groups = new Map<string, AssignRequest>();
    for (const [id, change] of byFile) {
        const key = `${[...change.add].sort().join(',')}|${[...change.remove].sort().join(',')}`;
        const req = groups.get(key);
        if (req) req.files!.push(id);
        else groups.set(key, { files: [id], ...(change.add.length ? { add: change.add } : {}), ...(change.remove.length ? { remove: change.remove } : {}) });
    }
    return [...groups.values()];
}

/** The write that takes a batch's assign back (only the people it really added or took off; null: nothing). */
export function batchUndoRequest(batch: Pick<MaterialBatch, 'id' | 'persons'>, add: readonly string[], remove: readonly string[]): AssignRequest | null {
    const had = new Set(batch.persons ?? []);
    const added = add.filter(p => !had.has(p));
    const removed = remove.filter(p => had.has(p));
    if (!added.length && !removed.length) return null;
    return { batch: batch.id, ...(removed.length ? { add: removed } : {}), ...(added.length ? { remove: added } : {}) };
}

/** How many materials the person has (menu, card tooltip): items without hidden ones; without the list: attachments. */
export function personMaterialCount(person: MaterialPerson, list: MaterialList | null | undefined, listOn: boolean): number {
    if (!listOn) return person.attachments?.length ?? 0;
    return personMaterials(person, list).length;
}

/**
 * Counts for many people at once (card tooltips): the same number as
 * `personMaterials(person, list).length`, with the list indexed once.
 */
export function materialCounter(list: MaterialList | null | undefined): (person: MaterialPerson) => number {
    if (!list) return person => person.attachments?.length ?? 0;
    const batches = batchMap(list);
    const bySha = new Map<string, MaterialFile>();
    const byRefn = new Map<string, MaterialFile[]>();
    for (const f of list.files) {
        if (!bySha.has(f.sha)) bySha.set(f.sha, f);
        const refs = new Set([...f.persons, ...(f.sorted?.persons ?? []), ...((f.batch ? batches.get(f.batch)?.persons : undefined) ?? [])]);
        for (const r of refs) {
            const files = byRefn.get(r);
            if (files) files.push(f); else byRefn.set(r, [f]);
        }
    }
    return person => {
        const refn = researchPersonRef(person.refn);
        const attachments = person.attachments ?? [];
        if (!refn) return attachments.length;
        const used = new Set<string>();
        let n = 0;
        for (const att of attachments) {
            const file = att.original?.sha256 ? bySha.get(att.original.sha256.toLowerCase()) : undefined;
            if (file && !used.has(file.id)) {
                used.add(file.id);
                if (!file.hidden) n++;
            } else {
                n++;
            }
        }
        for (const f of byRefn.get(refn) ?? []) if (!used.has(f.id) && !f.hidden) n++;
        return n;
    };
}

// ==================== BRIDGE CLIENT ====================

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BridgeOptions {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    /** Waiting between quiet retries (tests replace it). */
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    /** Waits after a busy answer (the research's own `Retry-After` wins, up to `MAX_RETRY_WAIT_MS`). */
    retryDelaysMs?: readonly number[];
    now?: () => number;
}

export type MaterialErrorKind =
    | 'person' | 'file' | 'batch' | 'readonly' | 'busy' | 'body' | 'query'
    | 'gone' | 'missing' | 'type' | 'size' | 'unknown' | 'down' | 'aborted'
    // Held until something is settled in the research (sealed elsewhere, files not downloaded, its disk full; 017 U7).
    | 'held';

export interface MaterialError {
    kind: MaterialErrorKind;
    /** HTTP status (0: no answer). */
    status: number;
    code?: string;
    params?: Record<string, unknown>;
    /** Seconds the research asked to wait (busy). */
    retry?: number;
    /** `held`: what holds it, with the research's sentence (its language, shown as it is). */
    held?: ResearchWriteHeld;
}

export type MaterialResult<T> = { ok: true; value: T } | { ok: false; error: MaterialError };

export const MATERIAL_TIMEOUT_MS = 30_000;
export const BUSY_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
/** The longest quiet wait for a busy research, whatever it asks for. */
export const MAX_RETRY_WAIT_MS = 10_000;

const CODE_KINDS: Record<string, MaterialErrorKind> = {
    'material.person': 'person',
    'material.file': 'file',
    'material.batch': 'batch',
    'material.readonly': 'readonly',
    'material.busy': 'busy',
    'material.body': 'body',
    'material.query': 'query',
    'media.gone': 'gone',
    'thumb.type': 'type',
    'thumb.size': 'size',
    'thumb.busy': 'busy',
};

/** A refusal of the bridge (`{error, code, text, params?}`) as an error of the app. */
export function materialErrorOf(status: number, body: unknown, retryAfter?: string | null): MaterialError {
    const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const code = typeof b.code === 'string' ? b.code : undefined;
    // Never a busy research to try again quietly: its sentence says what to do there.
    const held = status === 409 || status === 507 ? writeHeldOfCode(code, b.error, b.params) : null;
    if (held) return { kind: 'held', status, ...(code ? { code } : {}), held };
    let kind: MaterialErrorKind = code && CODE_KINDS[code] ? CODE_KINDS[code] : 'unknown';
    if (kind === 'unknown') {
        if (status === 409 || status === 503) kind = 'busy';
        else if (status === 410) kind = 'gone';
        else if (status === 403) kind = 'readonly';
        else if (status === 415) kind = 'type';
        else if (status === 404) kind = 'missing';
    }
    const err: MaterialError = { kind, status };
    if (code) err.code = code;
    if (b.params && typeof b.params === 'object') err.params = b.params as Record<string, unknown>;
    const fromHeader = retryAfter ? Number(retryAfter) : NaN;
    const retry = Number.isFinite(fromHeader) ? fromHeader : typeof b.retry === 'number' ? b.retry : NaN;
    if (Number.isFinite(retry) && retry >= 0) err.retry = retry;
    return err;
}

/** The app's text for an error (`agent`: a research with its agent, else the Strom archive). */
export function materialErrorText(err: MaterialError, agent: boolean): string {
    const m = strings.materials;
    switch (err.kind) {
        case 'person': return agent ? m.errPersonResearch : m.errPerson;
        case 'file': return agent ? m.errFileResearch : m.errFile;
        case 'readonly': return agent ? m.errReadonlyResearch : m.errReadonly;
        case 'busy': return agent ? m.errBusyResearch : m.errBusy;
        case 'gone': return agent ? m.notHereResearch : m.notHere;
        case 'held': return err.held?.said || m.errGeneric;
        default: return m.errGeneric;
    }
}

/** What the error offers: load again (the research changed), try again (busy), or nothing. */
export function materialErrorAction(err: MaterialError): 'reload' | 'retry' | null {
    if (err.kind === 'person' || err.kind === 'file' || err.kind === 'batch') return 'reload';
    if (err.kind === 'busy') return 'retry';
    return null;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/** A bridge's answer as read (also for the other writes of the bridge: source-retract.ts). */
export interface RawAnswer { status: number; body: unknown; retryAfter: string | null; res?: Response }

/** One request with a timeout; null body when the answer is not JSON (or `raw`: the response is kept unread). */
async function request(url: string, init: RequestInit, opts: BridgeOptions, raw = false): Promise<RawAnswer | MaterialError> {
    const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? MATERIAL_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const res = await fetchImpl(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', ...init, signal: timeout.signal });
        const retryAfter = res.headers?.get?.('Retry-After') ?? null;
        if (raw && res.ok) return { status: res.status, body: null, retryAfter, res };
        let body: unknown = null;
        try { body = await res.json(); } catch { body = null; }
        return { status: res.status, body, retryAfter };
    } catch {
        return { kind: opts.signal?.aborted ? 'aborted' : 'down', status: 0 };
    } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * A request that is asked again, quietly, while the research is busy (409):
 * three more times after 1, 2 and 4 s, or after what it asks for (capped).
 */
export async function withBusyRetry(url: string, init: RequestInit, opts: BridgeOptions, raw = false,
    retryIf: (answer: RawAnswer) => boolean = () => true): Promise<RawAnswer | MaterialError> {
    const delays = opts.retryDelaysMs ?? BUSY_RETRY_DELAYS_MS;
    const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms, opts.signal));
    for (let attempt = 0; ; attempt++) {
        const answer = await request(url, init, opts, raw);
        if ('kind' in answer) return answer;
        if (answer.status !== 409 || attempt >= delays.length || !retryIf(answer)) return answer;
        const err = materialErrorOf(answer.status, answer.body, answer.retryAfter);
        const wait = err.retry !== undefined ? Math.min(err.retry * 1000, MAX_RETRY_WAIT_MS) : delays[attempt];
        await sleep(wait);
        if (opts.signal?.aborted) return { kind: 'aborted', status: 0 };
    }
}

export function postInit(body: unknown): RequestInit {
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export interface MaterialQuery {
    /** The person's REFN: their files. */
    person?: string;
    /** One batch's files. */
    batch?: string;
    /** Only batches and people, no files. */
    files0?: boolean;
    /** The family tree files too (`?trees=1`, only with `material.trees`, spec 117 §5). */
    trees?: boolean;
}

/** The URL of `GET /material` with its filters, or null when a filter is not valid (never the whole list instead). */
export function materialUrl(base: string, q: MaterialQuery = {}): string | null {
    const params: string[] = [];
    if (q.person !== undefined) {
        const ref = researchPersonRef(q.person);
        if (!ref) return null;
        params.push(`person=${ref}`);
    }
    if (q.batch !== undefined) {
        const batch = typeof q.batch === 'string' ? q.batch.trim() : '';
        if (!batch || batch.length > 120) return null;
        params.push(`batch=${encodeURIComponent(batch)}`);
    }
    if (q.files0) params.push('files=0');
    if (q.trees) params.push('trees=1');
    return withAppVersion(`${base}/material${params.length ? `?${params.join('&')}` : ''}`);
}

/** The research's materials (`GET /material`). */
export async function fetchMaterial(base: string, q: MaterialQuery = {}, opts: BridgeOptions = {}): Promise<MaterialResult<MaterialList>> {
    const url = materialUrl(base, q);
    if (!url) return { ok: false, error: { kind: 'query', status: 0 } };
    const answer = await withBusyRetry(url, { method: 'GET' }, opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200 && answer.body && typeof answer.body === 'object') {
        return { ok: true, value: parseMaterialList(answer.body, (opts.now ?? Date.now)()) };
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

export interface AssignRequest {
    /** Files (I…), or a whole batch. */
    files?: string[];
    batch?: string;
    add?: string[];
    remove?: string[];
}

export interface AssignAnswer {
    files: MaterialFile[];
    people: Record<string, string>;
    kept: MaterialKept[];
    /** The research's head after the write ('' = not said). */
    head: string;
    /** The research's head the write was made on ('' = not said: an older research). */
    parent: string;
}

/** The answer to `POST /material/hide`. */
export interface HideAnswer {
    files: MaterialFile[];
    people: Record<string, string>;
    /** The research's head after the write ('' = not said). */
    head: string;
    /** The research's head the write was made on ('' = not said: an older research). */
    parent: string;
}

function parseKept(raw: unknown): MaterialKept[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((k): MaterialKept[] => {
        if (!k || typeof k !== 'object') return [];
        const o = k as Record<string, unknown>;
        const id = typeof o.id === 'string' && FILE_ID.test(o.id) ? o.id : null;
        const person = researchPersonRef(o.person);
        const batch = text(o.batch, 120);
        return id && person && batch ? [{ id, person, batch }] : [];
    });
}

const bodyError = (): MaterialResult<never> => ({ ok: false, error: { kind: 'body', status: 0 } });

/** Add or remove people on files or on a whole batch (`POST /material/assign`). */
export async function assignMaterial(base: string, req: AssignRequest, opts: BridgeOptions = {}): Promise<MaterialResult<AssignAnswer>> {
    const add = req.add ?? [];
    const remove = req.remove ?? [];
    const hasFiles = Array.isArray(req.files) && req.files.length > 0;
    if (hasFiles === !!req.batch || (add.length === 0 && remove.length === 0)) return bodyError();
    if (![...add, ...remove].every(p => researchPersonRef(p) === p)) return bodyError();
    if (hasFiles && !req.files!.every(f => FILE_ID.test(f))) return bodyError();
    const body: Record<string, unknown> = hasFiles ? { files: req.files } : { batch: req.batch };
    if (add.length) body.add = add;
    if (remove.length) body.remove = remove;
    const answer = await withBusyRetry(withAppVersion(`${base}/material/assign`), postInit(body), opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200 && answer.body && typeof answer.body === 'object') {
        const b = answer.body as Record<string, unknown>;
        return { ok: true, value: { files: parseFiles(b.files), people: parsePeople(b.people), kept: parseKept(b.kept), head: isResearchHead(b.head) ?? '', parent: isResearchHead(b.parent) ?? '' } };
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

export interface HideRequest {
    files: string[];
    hidden: boolean;
    reason?: HiddenReason;
}

/** Hide or restore files (`POST /material/hide`). */
export async function hideMaterial(base: string, req: HideRequest, opts: BridgeOptions = {}): Promise<MaterialResult<HideAnswer>> {
    if (!req.files.length || !req.files.every(f => FILE_ID.test(f))) return bodyError();
    const body: Record<string, unknown> = { files: req.files, hidden: req.hidden };
    if (req.hidden && req.reason) body.reason = req.reason;
    const answer = await withBusyRetry(withAppVersion(`${base}/material/hide`), postInit(body), opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200 && answer.body && typeof answer.body === 'object') {
        const b = answer.body as Record<string, unknown>;
        return { ok: true, value: { files: parseFiles(b.files), people: parsePeople(b.people), head: isResearchHead(b.head) ?? '', parent: isResearchHead(b.parent) ?? '' } };
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

export interface EditRequest {
    ids: string[];
    /** '' clears it. */
    title?: string;
    kind?: MaterialKind | '';
    /** GEDCOM-like text; '' clears it. */
    date?: string;
}

/** What a file had before an edit (the undo sends it back). */
export type EditWas = Record<string, { title?: string; kind?: MaterialKind | ''; date?: string }>;

/** The answer to `POST /material/edit`. */
export interface EditAnswer {
    files: MaterialFile[];
    people: Record<string, string>;
    was: EditWas;
    head: string;
    parent: string;
}

function parseWas(raw: unknown): EditWas {
    const out: EditWas = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!FILE_ID.test(id) || !v || typeof v !== 'object') continue;
        const o = v as Record<string, unknown>;
        const was: EditWas[string] = {};
        if (typeof o.title === 'string') was.title = cleanText(o.title, 500) ?? '';
        if (o.kind === '' || (typeof o.kind === 'string' && KINDS.includes(o.kind as MaterialKind))) was.kind = o.kind as MaterialKind | '';
        if (typeof o.date === 'string') was.date = cleanText(o.date, 100) ?? '';
        out[id] = was;
    }
    return out;
}

/** A file's title, kind and date outside the tree (`POST /material/edit`, `material.edit`; spec 102 §2). */
export async function editMaterial(base: string, req: EditRequest, opts: BridgeOptions = {}): Promise<MaterialResult<EditAnswer>> {
    if (!req.ids.length || req.ids.length > 500 || !req.ids.every(f => FILE_ID.test(f))) return bodyError();
    const body: Record<string, unknown> = { ids: req.ids };
    if (req.title !== undefined) body.title = req.title;
    if (req.kind !== undefined) body.kind = req.kind;
    if (req.date !== undefined) body.date = req.date;
    if (Object.keys(body).length === 1) return bodyError();
    const answer = await withBusyRetry(withAppVersion(`${base}/material/edit`), postInit(body), opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200 && answer.body && typeof answer.body === 'object') {
        const b = answer.body as Record<string, unknown>;
        return { ok: true, value: { files: parseFiles(b.files), people: parsePeople(b.people), was: parseWas(b.was), head: isResearchHead(b.head) ?? '', parent: isResearchHead(b.parent) ?? '' } };
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

// ==================== DELETING FOR GOOD (`material.delete`, spec 102 §9, K1.17) ====================

/** The most files one deletion takes (the research's `DELETE_MOST_FILES`). */
export const DELETE_MAX_FILES = 500;

/** A source a file to be deleted is the file of: made of it (input), an excerpt on (excerpt) or an image of (media) its content. */
export interface DeleteImpactSource {
    id: string;
    title: string;
    via: 'input' | 'excerpt' | 'media';
    citedCount: number;
}

/** What deleting one file takes with it (`impacts[]` of `POST /material/delete`). */
export interface DeleteImpact {
    id: string;
    name: string;
    sha: string;
    sources: DeleteImpactSource[];
    /** Excerpts of sources on images of its content (they go only with its bytes). */
    excerpts: number;
    /** The people it is of (REFN). */
    people: string[];
    /** Its places in the app's tree (taken off). */
    links: number;
    /** The tasks holding it (narrowed, or given up). */
    tasks: string[];
    /** Its bytes go, or stay: another file of the research (`sameAs`) or another research keeps the same content. */
    bytes: 'deleted' | 'kept';
    keptWhy?: 'sameAs' | 'otherResearch';
    /** The files of the research with the same content that keep the bytes. */
    sameAs: string[];
    /**
     * A family tree file a live source was made of (spec 117 §7): the sources (S…) that
     * have to be deleted with it (`retractSources`), else the file is never deleted.
     */
    blockedBy?: string[];
}

/** The research's list of what a deletion takes, file by file (anything not understood left out). */
export function parseDeleteImpacts(raw: unknown): DeleteImpact[] {
    if (!Array.isArray(raw)) return [];
    const out: DeleteImpact[] = [];
    for (const x of raw.slice(0, DELETE_MAX_FILES)) {
        if (!x || typeof x !== 'object') continue;
        const o = x as Record<string, unknown>;
        const id = typeof o.id === 'string' && FILE_ID.test(o.id) ? o.id : null;
        if (!id || out.some(i => i.id === id)) continue;
        const sources: DeleteImpactSource[] = [];
        for (const s of Array.isArray(o.sources) ? o.sources.slice(0, 200) : []) {
            if (!s || typeof s !== 'object') continue;
            const so = s as Record<string, unknown>;
            const sid = typeof so.id === 'string' ? so.id.trim() : '';
            const via = so.via === 'input' || so.via === 'excerpt' || so.via === 'media' ? so.via : null;
            if (!SOURCE_REF.test(sid) || !via || sources.some(y => y.id === sid && y.via === via)) continue;
            sources.push({ id: sid, title: text(so.title, 300) ?? sid, via, citedCount: count(so.citedCount) });
        }
        const tasks = Array.isArray(o.tasks)
            ? [...new Set(o.tasks.filter((t): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(t)))] : [];
        const sameAs = Array.isArray(o.sameAs)
            ? [...new Set(o.sameAs.filter((t): t is string => typeof t === 'string' && FILE_ID.test(t) && t !== id))] : [];
        const keptWhy = o.keptWhy === 'sameAs' || o.keptWhy === 'otherResearch' ? o.keptWhy : undefined;
        const blockedBy = sourceRefs(o.blockedBy);
        out.push({
            id, name: text(o.name, 300) ?? id, sha: typeof o.sha === 'string' && SHA.test(o.sha) ? o.sha : '',
            sources, excerpts: count(o.excerpts), people: refs(o.people), links: count(o.links), tasks,
            // Not said as kept: the bytes go (the strict reading — the dialog never promises they stay).
            bytes: o.bytes === 'kept' ? 'kept' : 'deleted', ...(o.bytes === 'kept' && keptWhy ? { keptWhy } : {}), sameAs,
            ...(blockedBy.length ? { blockedBy } : {}),
        });
    }
    return out;
}

/** The dry run's answer: what the deletion takes and the bridge's confirmation of that list (15 minutes). */
export interface DeleteDry {
    files: string[];
    impacts: DeleteImpact[];
    confirm: string;
    /**
     * With `retractSources` (spec 117 §7): the sources deleted first, and the research's list of
     * what rests on them as `/source/retract` says it (read by `parseSourceImpacts` in src/source-retract.ts).
     */
    retractSources?: string[];
    sourceImpacts?: unknown;
}

/** The deletion's answer. */
export interface DeleteDone {
    files: string[];
    deleted: string[];
    impacts: DeleteImpact[];
    /** The research's head after the write ('' = not said). */
    head: string;
    /** With `retractSources`: the sources deleted with the files (spec 117 §7). */
    retracted?: string[];
}

/**
 * A refused deletion; `changed`: the research changed since the list was
 * shown (409 `material.delete-changed`), with the new list to show and confirm again
 * (`changedSources`: the sources' new list, spec 117 §7); `live`: a family tree file
 * a live source was made of, asked without that source (409 `material.source-live`).
 */
export type DeleteResult<T> = { ok: true; value: T }
    | { ok: false; error: MaterialError; changed?: DeleteImpact[]; changedSources?: unknown; live?: string[] };

const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((f): f is string => typeof f === 'string' && FILE_ID.test(f)))] : []);
/** Sources (S…), from a list or the research's "S1,S2" of `params.sources`. */
const sourceRefs = (v: unknown): string[] => {
    const list = typeof v === 'string' ? v.split(',').map(x => x.trim()) : Array.isArray(v) ? v : [];
    return [...new Set(list.filter((x): x is string => typeof x === 'string' && SOURCE_REF.test(x)))].slice(0, 50);
};

/** The sources a deletion is asked to take with it (spec 117 §7): none, or 1–50 S…. */
const retractList = (v: readonly string[] | undefined): string[] | null => {
    if (!v?.length) return [];
    return v.length <= 50 && v.every(x => SOURCE_REF.test(x)) ? [...new Set(v)] : null;
};

/** What a 409 of a deletion carries beside its code: the new lists, or the live sources. */
function deleteRefusal(answer: RawAnswer): DeleteResult<never> | null {
    const b = answer.body && typeof answer.body === 'object' ? answer.body as Record<string, unknown> : {};
    if (answer.status === 409 && b.code === 'material.delete-changed') {
        return {
            ok: false, error: { kind: 'body', status: 409, code: 'material.delete-changed' }, changed: parseDeleteImpacts(b.impacts),
            ...(b.sourceImpacts !== undefined ? { changedSources: b.sourceImpacts } : {}),
        };
    }
    if (answer.status === 409 && b.code === 'material.source-live') {
        const params = b.params && typeof b.params === 'object' ? (b.params as Record<string, unknown>).sources : undefined;
        const live = sourceRefs(b.sources);
        return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter), live: live.length ? live : sourceRefs(params) };
    }
    return null;
}

/**
 * Busy is waited out quietly; a changed list, a file held by its live source or a source
 * deleted already (`source.*`, spec 117 §7) never (the person has to see it).
 */
const busyOnly = (a: RawAnswer): boolean => {
    const code = a.body && typeof a.body === 'object' ? (a.body as Record<string, unknown>).code : undefined;
    return code !== 'material.delete-changed' && code !== 'material.source-live' && !(typeof code === 'string' && code.startsWith('source.'));
};

/** Which sources a deletion also deletes first (spec 117 §7: only those its dry run named in `blockedBy`). */
export interface DeleteWith {
    retractSources?: string[];
}

/**
 * What deleting files would take with them (`POST /material/delete {files, dryRun: true}`): nothing is written.
 * With `retractSources` (a family tree file and the live source made of it, spec 117 §7) also what rests on the sources.
 */
export async function deleteMaterialDry(base: string, files: string[], opts: BridgeOptions & DeleteWith = {}): Promise<DeleteResult<DeleteDry>> {
    const sources = retractList(opts.retractSources);
    if (!files.length || files.length > DELETE_MAX_FILES || !files.every(f => FILE_ID.test(f)) || !sources) return bodyError();
    const body = { files, ...(sources.length ? { retractSources: sources } : {}), dryRun: true };
    const answer = await withBusyRetry(withAppVersion(`${base}/material/delete`), postInit(body), opts, false, busyOnly);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200 && answer.body && typeof answer.body === 'object') {
        const b = answer.body as Record<string, unknown>;
        const confirm = typeof b.confirm === 'string' && b.confirm.length <= 4096 ? b.confirm : '';
        if (b.dryRun !== true || !confirm) return bodyError();
        const value: DeleteDry = { files: ids(b.files), impacts: parseDeleteImpacts(b.impacts), confirm };
        if (sources.length) {
            value.retractSources = sourceRefs(b.retractSources);
            value.sourceImpacts = b.sourceImpacts;
        }
        return { ok: true, value };
    }
    return deleteRefusal(answer) ?? { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/**
 * Delete files for good (`POST /material/delete {files, confirm}`): only with
 * the confirmation of a dry run whose list the person saw and confirmed.
 */
export async function deleteMaterial(base: string, files: string[], confirm: string, opts: BridgeOptions & DeleteWith = {}): Promise<DeleteResult<DeleteDone>> {
    const sources = retractList(opts.retractSources);
    if (!files.length || files.length > DELETE_MAX_FILES || !files.every(f => FILE_ID.test(f)) || !confirm || !sources) return bodyError();
    const body = { files, ...(sources.length ? { retractSources: sources } : {}), confirm };
    const answer = await withBusyRetry(withAppVersion(`${base}/material/delete`), postInit(body), opts, false, busyOnly);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200 && answer.body && typeof answer.body === 'object') {
        const b = answer.body as Record<string, unknown>;
        const value: DeleteDone = { files: ids(b.files), deleted: ids(b.deleted), impacts: parseDeleteImpacts(b.impacts), head: isResearchHead(b.head) ?? '' };
        if (sources.length) value.retracted = sourceRefs(b.retracted);
        return { ok: true, value };
    }
    return deleteRefusal(answer) ?? { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/** Files deleted for good leave the remembered list (and their batches' counts). */
export async function dropFromCache(treeId: string, gone: readonly string[], now: number = Date.now()): Promise<MaterialCacheRecord | null> {
    await primeMaterials(treeId);
    const prev = cachedMaterials(treeId);
    if (!prev || !gone.length) return prev;
    const set = new Set(gone);
    const rec = cloneRecord(prev);
    const left: MaterialFile[] = [];
    const less = new Map<string, number>();
    for (const f of rec.list.files) {
        if (!set.has(f.id)) { left.push(f); continue; }
        if (f.batch) less.set(f.batch, (less.get(f.batch) ?? 0) + 1);
    }
    rec.list.files = left;
    rec.list.batches = rec.list.batches.map(b => (less.has(b.id) ? { ...b, files: Math.max(0, b.files - less.get(b.id)!) } : b));
    return putRecord(rec, now);
}

// ==================== SORTING BY THE AGENT (`material.sort`, spec 102 §13) ====================

/** The most files one sorting takes and the longest note (the research's limits). */
export const SORT_MAX_FILES = 50;
export const SORT_MAX_TEXT = 2000;

export type SortState = 'queued' | 'working' | 'done' | 'failed' | 'cancelled';
export type SortSure = 'high' | 'medium' | 'low';

/** A link the agent proposes (research refs: P…, F…, S…; `event` a GEDCOM tag of a person's or a couple's event). */
export interface SortLink {
    type: 'person' | 'family' | 'event' | 'source';
    ref: string;
    event?: string;
}

/** The agent's proposal for one file (`id` = the file's I…). */
export interface SortProposal {
    id: string;
    title?: string;
    date?: string;
    kind?: MaterialKind;
    links: SortLink[];
    why: string;
    sure: SortSure;
    /**
     * The agent says the file is not about the family at all (a screenshot, a
     * receipt, a stranger's photo, sent by mistake); `why` says what it saw.
     * Optional: a research that does not say it leaves the file unassigned.
     */
    unrelated?: true;
    /**
     * The back side of the same photo or page (its I…; spec 102 §10, a link
     * `{type: 'back', ref: 'I…'}`): offered as a chip, accepting gives it the
     * same places and the title with "(back)".
     */
    back?: string;
    /**
     * The file is a portrait of this person (P…; a link `{type: 'portrait',
     * ref: 'P…'}`, spec 102 §10): offered as a chip when the person has none.
     */
    portrait?: string;
}

/** A sorting as the research tells it (`GET /material/sort/<id>`). */
export interface SortJob {
    id: string;
    state: SortState;
    /** The files sent (I…). */
    files: string[];
    at: string;
    proposals: SortProposal[];
    reason?: string;
    /**
     * While working: how many of the files the research's readers have already
     * judged (optional; a research that does not say it leaves the progress without a number).
     */
    filesDone?: number;
    /**
     * Once done: the files with no proposal, each with why (optional; a research
     * that does not say it leaves them without a reason).
     */
    unproposed?: SortUnproposed[];
}

/** Why a file of a sorting has no proposal, as the research says it. */
export type SortUnproposedWhy = 'nothing-said' | 'nothing-new' | 'dropped' | 'left-out' | 'reader-failed';
export const SORT_UNPROPOSED_WHYS: readonly SortUnproposedWhy[] = ['nothing-said', 'nothing-new', 'dropped', 'left-out', 'reader-failed'];

/** A file of a sorting with no proposal: `said` = what its reader wrote of it, `outcome` = how a failed reader ended. */
export interface SortUnproposed {
    id: string;
    why: SortUnproposedWhy;
    said?: string;
    outcome?: string;
}

/** One file without a proposal (anything off, or a reason this app does not know: null, shown without a reason). */
export function parseSortUnproposed(raw: unknown): SortUnproposed | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || !FILE_ID.test(o.id)) return null;
    if (!SORT_UNPROPOSED_WHYS.includes(o.why as SortUnproposedWhy)) return null;
    const said = cleanText(o.said, 1000);
    const outcome = cleanText(o.outcome, 60);
    return { id: o.id, why: o.why as SortUnproposedWhy, ...(said ? { said } : {}), ...(outcome ? { outcome } : {}) };
}

const SORT_ID = /^sort-[0-9A-Za-z-]{1,60}$/;
const SORT_STATES: readonly SortState[] = ['queued', 'working', 'done', 'failed', 'cancelled'];
const LINK_REF = /^[PFS]\d{1,9}$/;

export function isSortId(id: unknown): id is string {
    return typeof id === 'string' && SORT_ID.test(id);
}

function parseSortLink(raw: unknown): SortLink | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const type = o.type;
    if (type !== 'person' && type !== 'family' && type !== 'event' && type !== 'source') return null;
    const ref = typeof o.ref === 'string' ? o.ref.trim() : '';
    if (!LINK_REF.test(ref)) return null;
    if (type === 'person' && ref[0] !== 'P') return null;
    if (type === 'family' && ref[0] !== 'F') return null;
    if (type === 'source' && ref[0] !== 'S') return null;
    if (type === 'event' && ref[0] === 'S') return null;
    const event = typeof o.event === 'string' && /^[A-Z_][A-Z0-9_]{1,15}$/.test(o.event) ? o.event : undefined;
    if (type === 'event' && !event) return null;
    return { type, ref, ...(event ? { event } : {}) };
}

/** One proposal as the research gives it (anything off: dropped, never shown on a guess). */
export function parseSortProposal(raw: unknown): SortProposal | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === 'string' && FILE_ID.test(o.id) ? o.id : null;
    if (!id) return null;
    const title = cleanText(o.title, 200);
    const date = cleanText(o.date, 100);
    const kind = typeof o.kind === 'string' && KINDS.includes(o.kind as MaterialKind) ? o.kind as MaterialKind : undefined;
    const links = Array.isArray(o.links) ? o.links.map(parseSortLink).filter((l): l is SortLink => !!l).slice(0, 20) : [];
    // The back side: the first link to another file of the research.
    const backLink = Array.isArray(o.links) ? o.links.find((l): l is { type: 'back'; ref: string } => !!l && typeof l === 'object'
        && (l as Record<string, unknown>).type === 'back' && typeof (l as Record<string, unknown>).ref === 'string'
        && FILE_ID.test(((l as Record<string, unknown>).ref as string).trim()) && ((l as Record<string, unknown>).ref as string).trim() !== id) : undefined;
    const portraitLink = Array.isArray(o.links) ? o.links.find((l): l is { type: 'portrait'; ref: string } => !!l && typeof l === 'object'
        && (l as Record<string, unknown>).type === 'portrait' && typeof (l as Record<string, unknown>).ref === 'string'
        && /^P\d{1,9}$/.test(((l as Record<string, unknown>).ref as string).trim())) : undefined;
    const sure: SortSure = o.sure === 'high' || o.sure === 'low' ? o.sure : 'medium';
    return {
        id, links, sure, why: cleanText(o.why, 500) ?? '',
        ...(title ? { title } : {}), ...(date ? { date } : {}), ...(kind ? { kind } : {}),
        ...(o.unrelated === true ? { unrelated: true as const } : {}),
        ...(backLink ? { back: backLink.ref.trim() } : {}),
        ...(portraitLink ? { portrait: portraitLink.ref.trim() } : {}),
    };
}

/** A sorting's state (null: not a sorting's answer). */
export function parseSortJob(raw: unknown): SortJob | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (!isSortId(o.id) || !SORT_STATES.includes(o.state as SortState)) return null;
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string' && FILE_ID.test(f)) : [];
    const seen = new Set<string>();
    const proposals = (Array.isArray(o.proposals) ? o.proposals : []).map(parseSortProposal)
        .filter((p): p is SortProposal => !!p && !seen.has(p.id) && !!seen.add(p.id));
    const reason = cleanText(o.reason, 300);
    const filesDone = typeof o.filesDone === 'number' && Number.isFinite(o.filesDone) && o.filesDone >= 0 ? Math.floor(o.filesDone) : undefined;
    const known = new Set<string>();
    const unproposed = (Array.isArray(o.unproposed) ? o.unproposed : []).map(parseSortUnproposed)
        .filter((u): u is SortUnproposed => !!u && !known.has(u.id) && !!known.add(u.id));
    return {
        id: o.id, state: o.state as SortState, files, at: typeof o.at === 'string' ? o.at : '', proposals,
        ...(reason ? { reason } : {}),
        ...(filesDone !== undefined ? { filesDone } : {}),
        ...(unproposed.length ? { unproposed } : {}),
    };
}

/**
 * Start the agent's sorting (`POST /material/sort {ids, text}`). Sent once
 * (never retried quietly): it uses the subscription or credit.
 */
export async function startMaterialSort(base: string, req: { ids: string[]; text: string; run?: boolean }, opts: BridgeOptions = {}): Promise<MaterialResult<{ id: string; state: SortState; run?: string; parts?: string[] }>> {
    // Over 50 files only as a run of batches (behind material.sortRun, spec 102 §3).
    const most = req.run ? SORT_RUN_MAX_FILES : SORT_MAX_FILES;
    if (!req.ids.length || req.ids.length > most || !req.ids.every(f => FILE_ID.test(f))) return bodyError();
    const text = req.text.slice(0, SORT_MAX_TEXT);
    const answer = await request(withAppVersion(`${base}/material/sort`), postInit({ ids: req.ids, text }), opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if ((answer.status === 202 || answer.status === 200) && answer.body && typeof answer.body === 'object') {
        const b = answer.body as Record<string, unknown>;
        if (!isSortId(b.id)) return bodyError();
        const state = SORT_STATES.includes(b.state as SortState) ? b.state as SortState : 'queued';
        if (req.ids.length <= SORT_MAX_FILES) return { ok: true, value: { id: b.id, state } };
        // A run: its id and the sortings of its batches, in order (the first is `id`).
        const parts = Array.isArray(b.parts) ? b.parts.filter(isSortId) : [];
        if (!isRunId(b.run) || !parts.length || parts[0] !== b.id) return bodyError();
        return { ok: true, value: { id: b.id, state, run: b.run, parts } };
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/** A sorting's state and proposal (`GET /material/sort/<id>`). */
export async function fetchMaterialSort(base: string, id: string, opts: BridgeOptions = {}): Promise<MaterialResult<SortJob>> {
    if (!isSortId(id)) return bodyError();
    const answer = await request(withAppVersion(`${base}/material/sort/${encodeURIComponent(id)}`), { method: 'GET' }, opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200) {
        const job = parseSortJob(answer.body);
        return job ? { ok: true, value: job } : bodyError();
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/** Stop a sorting (`POST /material/sort/<id>/cancel`). */
export async function cancelMaterialSort(base: string, id: string, opts: BridgeOptions = {}): Promise<MaterialResult<true>> {
    if (!isSortId(id)) return bodyError();
    const answer = await request(withAppVersion(`${base}/material/sort/${encodeURIComponent(id)}/cancel`), postInit({}), opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status >= 200 && answer.status < 300) return { ok: true, value: true };
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/** One batch of a run as the run says it (spec 102 §3). */
export interface SortRunPart {
    id: string;
    /** 1…n */
    part: number;
    state: SortState;
    files: number;
    filesDone?: number;
}

/** A run of batches (`GET /material/sort/<run-…>`, behind material.sortRun). */
export interface SortRunState {
    id: string;
    state: SortState;
    files: number;
    filesDone: number;
    parts: SortRunPart[];
    /** Why a batch waits to start (the readers' limit, read.app…) and when it tries again (s). */
    waiting?: { why: string; retry?: number };
}

const RUN_ID = /^run-[0-9A-Za-z-]{1,60}$/;
/** The most files one run takes (30 batches of 50). */
export const SORT_RUN_MAX_FILES = 1500;

export function isRunId(id: unknown): id is string {
    return typeof id === 'string' && RUN_ID.test(id);
}

const runCount = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;

export function parseSortRun(raw: unknown): SortRunState | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (!isRunId(o.id) || !SORT_STATES.includes(o.state as SortState)) return null;
    const seen = new Set<string>();
    const parts = (Array.isArray(o.parts) ? o.parts : []).map((p): SortRunPart | null => {
        if (!p || typeof p !== 'object') return null;
        const q = p as Record<string, unknown>;
        if (!isSortId(q.id) || seen.has(q.id) || !SORT_STATES.includes(q.state as SortState)) return null;
        seen.add(q.id);
        const done = runCount(q.filesDone);
        return { id: q.id, part: runCount(q.part) ?? seen.size, state: q.state as SortState, files: runCount(q.files) ?? 0, ...(done !== undefined ? { filesDone: done } : {}) };
    }).filter((p): p is SortRunPart => !!p).sort((a, b) => a.part - b.part);
    const w = o.waiting && typeof o.waiting === 'object' ? o.waiting as Record<string, unknown> : null;
    const why = w ? cleanText(w.why, 80) : '';
    const retry = w ? runCount(w.retry) : undefined;
    return {
        id: o.id, state: o.state as SortState, files: runCount(o.files) ?? parts.reduce((t, p) => t + p.files, 0),
        filesDone: runCount(o.filesDone) ?? 0, parts,
        ...(w ? { waiting: { why, ...(retry !== undefined ? { retry } : {}) } } : {}),
    };
}

/** A run's state (`GET /material/sort/<run-…>`); each finished batch's proposal is its own sorting's. */
export async function fetchMaterialSortRun(base: string, id: string, opts: BridgeOptions = {}): Promise<MaterialResult<SortRunState>> {
    if (!isRunId(id)) return bodyError();
    const answer = await request(withAppVersion(`${base}/material/sort/${encodeURIComponent(id)}`), { method: 'GET' }, opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200) {
        const run = parseSortRun(answer.body);
        return run ? { ok: true, value: run } : bodyError();
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/** Stop a whole run (`POST /material/sort/<run-…>/cancel`): the batch at work stops, the waiting ones do not start. */
export async function cancelMaterialSortRun(base: string, id: string, opts: BridgeOptions = {}): Promise<MaterialResult<true>> {
    if (!isRunId(id)) return bodyError();
    const answer = await request(withAppVersion(`${base}/material/sort/${encodeURIComponent(id)}/cancel`), postInit({}), opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status >= 200 && answer.status < 300) return { ok: true, value: true };
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

/** The preview's URL (`GET /media/<sha>?thumb=<px>`). */
export function thumbUrl(base: string, sha: string, px: ThumbSize): string {
    return withAppVersion(`${base}/media/${sha}?thumb=${px}`);
}

/** The file itself (`GET /media/<sha>?file=1`; 410 when it is not on the computer). */
export function fileUrl(base: string, sha: string): string {
    return withAppVersion(`${base}/media/${sha}?file=1`);
}

/** The file opened by the system's program through the research (`strom-research://media?tree=&sha=`). */
export function materialSystemLink(treeId: string, sha: string, scheme?: string): string | null {
    return researchSchemeUrl('media', { tree: treeId, sha }, scheme);
}

/** A preview from the bridge (415: a type it cannot preview; 503: busy — not retried here, the queue decides). */
export async function fetchThumb(base: string, sha: string, px: ThumbSize, opts: BridgeOptions = {}): Promise<MaterialResult<Blob>> {
    if (!SHA.test(sha) || !THUMB_SIZES.includes(px)) return { ok: false, error: { kind: 'size', status: 0 } };
    const answer = await request(thumbUrl(base, sha, px), { method: 'GET', cache: 'default' }, opts, true);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.res && answer.status === 200) {
        try {
            return { ok: true, value: await answer.res.blob() };
        } catch {
            return { ok: false, error: { kind: 'down', status: 0 } };
        }
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

// ==================== CACHE (IndexedDB `strom-materials`) ====================

export const MATERIALS_EVENT = 'materials-changed';
/** The cached list's limit; over it only batches (and batches opened lately) are kept. */
export const LIST_CACHE_LIMIT = 5 * 1024 * 1024;
export const OPENED_BATCH_DAYS = 30;
export const THUMB_CACHE_LIMIT = 50 * 1024 * 1024;

/** The research's list as last seen, per tree (metadata only). */
export interface MaterialCacheRecord {
    treeId: string;
    list: MaterialList;
    /** `list.files` is the whole list (not only some people's or batches' files). */
    full: boolean;
    /** Batch id → when it was last opened (ms). */
    opened: Record<string, number>;
}

export interface ThumbMeta {
    key: string;
    treeId: string;
    sha: string;
    px: number;
    bytes: number;
    usedAt: number;
}

export interface ThumbRow extends ThumbMeta {
    blob: Blob;
}

export interface MaterialsBackend {
    getList(treeId: string): Promise<MaterialCacheRecord | null>;
    putList(record: MaterialCacheRecord): Promise<void>;
    deleteList(treeId: string): Promise<void>;
    getThumb(key: string): Promise<ThumbRow | null>;
    putThumb(row: ThumbRow): Promise<void>;
    thumbs(treeId: string): Promise<ThumbMeta[]>;
    deleteThumbs(keys: string[]): Promise<void>;
}

const DB_NAME = 'strom-materials';
const LISTS = 'lists';
const THUMBS = 'thumbs';

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Its own database: the app's main one stays at its version. */
function indexedDbBackend(): MaterialsBackend {
    let dbPromise: Promise<IDBDatabase> | null = null;
    const open = (): Promise<IDBDatabase> => {
        if (!dbPromise) {
            dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS, { keyPath: 'treeId' });
                    if (!db.objectStoreNames.contains(THUMBS)) {
                        db.createObjectStore(THUMBS, { keyPath: 'key' }).createIndex('treeId', 'treeId');
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            }).catch(err => {
                dbPromise = null;
                throw err;
            });
        }
        return dbPromise;
    };
    const tx = async (store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> =>
        (await open()).transaction(store, mode).objectStore(store);
    return {
        async getList(treeId) {
            return (await idbRequest((await tx(LISTS, 'readonly')).get(treeId)) as MaterialCacheRecord | undefined) ?? null;
        },
        async putList(record) { await idbRequest((await tx(LISTS, 'readwrite')).put(record)); },
        async deleteList(treeId) { await idbRequest((await tx(LISTS, 'readwrite')).delete(treeId)); },
        async getThumb(key) {
            return (await idbRequest((await tx(THUMBS, 'readonly')).get(key)) as ThumbRow | undefined) ?? null;
        },
        async putThumb(row) { await idbRequest((await tx(THUMBS, 'readwrite')).put(row)); },
        async thumbs(treeId) {
            const rows = await idbRequest((await tx(THUMBS, 'readonly')).index('treeId').getAll(treeId)) as ThumbRow[];
            return rows.map(({ key, treeId: t, sha, px, bytes, usedAt }) => ({ key, treeId: t, sha, px, bytes, usedAt }));
        },
        async deleteThumbs(keys) {
            if (keys.length === 0) return;
            const store = await tx(THUMBS, 'readwrite');
            await Promise.all(keys.map(k => idbRequest(store.delete(k))));
        },
    };
}

/** An in-memory store (tests, or a browser without IndexedDB: kept for the tab only). */
export function memoryMaterialsBackend(): MaterialsBackend {
    const lists = new Map<string, MaterialCacheRecord>();
    const thumbs = new Map<string, ThumbRow>();
    return {
        async getList(treeId) { return lists.get(treeId) ?? null; },
        async putList(record) { lists.set(record.treeId, record); },
        async deleteList(treeId) { lists.delete(treeId); },
        async getThumb(key) { return thumbs.get(key) ?? null; },
        async putThumb(row) { thumbs.set(row.key, row); },
        async thumbs(treeId) {
            return [...thumbs.values()].filter(r => r.treeId === treeId)
                .map(({ key, treeId: t, sha, px, bytes, usedAt }) => ({ key, treeId: t, sha, px, bytes, usedAt }));
        },
        async deleteThumbs(keys) { keys.forEach(k => thumbs.delete(k)); },
    };
}

let backend: MaterialsBackend | null = null;
let fallenBack = false;
function store(): MaterialsBackend {
    if (!backend) backend = typeof indexedDB !== 'undefined' ? indexedDbBackend() : memoryMaterialsBackend();
    return backend;
}

/** Run on the store; when IndexedDB fails (private window, blocked), go on in memory for this tab. */
async function safely<T>(op: (b: MaterialsBackend) => Promise<T>): Promise<T> {
    try {
        return await op(store());
    } catch (err) {
        if (fallenBack) throw err;
        console.warn('Materials cache: IndexedDB unavailable, keeping it in memory', err);
        fallenBack = true;
        backend = memoryMaterialsBackend();
        return op(backend);
    }
}

/** Tree id → its cached list (sync for rendering, after `primeMaterials`). */
const lists = new Map<string, MaterialCacheRecord | null>();
const priming = new Map<string, Promise<void>>();

/** Replace the storage (tests); clears what is cached in memory. */
export function setMaterialsBackend(next: MaterialsBackend | null): void {
    backend = next;
    fallenBack = false;
    lists.clear();
    priming.clear();
}

function notify(treeId: string): void {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MATERIALS_EVENT, { detail: { treeId } }));
}

/** Read a tree's cached list into memory (once; later calls wait for the same read). */
export function primeMaterials(treeId: string): Promise<MaterialCacheRecord | null> {
    let p = priming.get(treeId);
    if (!p) {
        p = safely(b => b.getList(treeId)).then(rec => {
            const ok = rec && rec.list && Array.isArray(rec.list.files) ? rec : null;
            if (!lists.has(treeId)) lists.set(treeId, ok);
        }).catch(err => {
            console.warn('Reading the materials cache failed', err);
            if (!lists.has(treeId)) lists.set(treeId, null);
        });
        priming.set(treeId, p);
    }
    return p.then(() => lists.get(treeId) ?? null);
}

/** The tree's cached record (null: nothing cached or not read yet). */
export function cachedMaterials(treeId: string | null | undefined): MaterialCacheRecord | null {
    return treeId ? lists.get(treeId) ?? null : null;
}

/** The tree's cached list (null: the research never answered `/material` here). */
export function cachedMaterialList(treeId: string | null | undefined): MaterialList | null {
    return cachedMaterials(treeId)?.list ?? null;
}

function emptyRecord(treeId: string): MaterialCacheRecord {
    return { treeId, list: { files: [], batches: [], people: {}, fetchedAt: 0 }, full: false, opened: {} };
}

function cloneRecord(rec: MaterialCacheRecord): MaterialCacheRecord {
    return {
        treeId: rec.treeId,
        list: { files: [...rec.list.files], batches: [...rec.list.batches], people: { ...rec.list.people }, fetchedAt: rec.list.fetchedAt },
        full: rec.full,
        opened: { ...rec.opened },
    };
}

/** Replace files with the same id (others stay), add new ones at the end. */
function mergeFiles(files: MaterialFile[], fresh: MaterialFile[]): MaterialFile[] {
    const byId = new Map(fresh.map(f => [f.id, f]));
    const out = files.map(f => byId.get(f.id) ?? f);
    const known = new Set(files.map(f => f.id));
    for (const f of fresh) if (!known.has(f.id)) out.push(f);
    return out;
}

/** What a fresh answer was asked for. */
export type MaterialScope =
    | { kind: 'all' }
    | { kind: 'files0' }
    | { kind: 'person'; person: string }
    | { kind: 'batch'; batch: string };

/** The record after a fresh answer (pure). */
export function applyMaterialAnswer(prev: MaterialCacheRecord | null, treeId: string, list: MaterialList, scope: MaterialScope): MaterialCacheRecord {
    const rec = prev ? cloneRecord(prev) : emptyRecord(treeId);
    rec.list.fetchedAt = list.fetchedAt;
    Object.assign(rec.list.people, list.people);
    switch (scope.kind) {
        case 'all':
            rec.list.files = [...list.files];
            rec.list.batches = [...list.batches];
            rec.list.people = { ...list.people };
            rec.full = true;
            break;
        case 'files0':
            rec.list.batches = [...list.batches];
            break;
        case 'person': {
            const fresh = new Set(list.files.map(f => f.id));
            // A file that named the person and is no longer among theirs: the person was taken off it.
            rec.list.files = rec.list.files.map(f => {
                if (fresh.has(f.id) || !(f.persons.includes(scope.person) || f.sorted?.persons?.includes(scope.person))) return f;
                const next: MaterialFile = { ...f, persons: f.persons.filter(p => p !== scope.person) };
                if (f.sorted?.persons) next.sorted = { ...f.sorted, persons: f.sorted.persons.filter(p => p !== scope.person) };
                return next;
            });
            rec.list.files = mergeFiles(rec.list.files, list.files);
            // Batch counts in a person's answer are that person's: keep the known ones, add new batches.
            const known = new Map(rec.list.batches.map(b => [b.id, b]));
            for (const b of list.batches) {
                const old = known.get(b.id);
                known.set(b.id, old ? { ...b, files: old.files } : b);
            }
            rec.list.batches = [...known.values()];
            break;
        }
        case 'batch': {
            const fresh = new Set(list.files.map(f => f.id));
            rec.list.files = rec.list.files.filter(f => f.batch !== scope.batch || fresh.has(f.id));
            rec.list.files = mergeFiles(rec.list.files, list.files);
            const fromAnswer = list.batches.find(b => b.id === scope.batch);
            if (fromAnswer) {
                const i = rec.list.batches.findIndex(b => b.id === scope.batch);
                if (i >= 0) rec.list.batches[i] = fromAnswer; else rec.list.batches.push(fromAnswer);
            }
            rec.opened[scope.batch] = list.fetchedAt || Date.now();
            break;
        }
    }
    return rec;
}

/** Rough size of a record as stored (JSON characters). */
export function recordSize(rec: MaterialCacheRecord): number {
    return JSON.stringify(rec).length;
}

/**
 * Keep the record under the limit: over it, only batches, people and the files
 * of batches opened within the last 30 days stay (pure).
 */
export function trimListForCache(rec: MaterialCacheRecord, now: number = Date.now(), limit: number = LIST_CACHE_LIMIT): MaterialCacheRecord {
    if (recordSize(rec) <= limit) return rec;
    const since = now - OPENED_BATCH_DAYS * 86_400_000;
    const recent = new Set(Object.entries(rec.opened).filter(([, t]) => t >= since).map(([id]) => id));
    const opened: Record<string, number> = {};
    for (const id of recent) opened[id] = rec.opened[id];
    const trimmed: MaterialCacheRecord = {
        ...rec,
        list: { ...rec.list, files: rec.list.files.filter(f => !!f.batch && recent.has(f.batch)) },
        full: false,
        opened,
    };
    if (recordSize(trimmed) <= limit) return trimmed;
    return { ...trimmed, list: { ...trimmed.list, files: [] }, opened: {} };
}

async function putRecord(rec: MaterialCacheRecord, now: number): Promise<MaterialCacheRecord> {
    const kept = trimListForCache(rec, now);
    lists.set(rec.treeId, kept);
    try {
        await safely(b => b.putList(kept));
    } catch (err) {
        console.warn('Storing the materials list failed', err);
    }
    notify(rec.treeId);
    return kept;
}

/** Store a fresh answer of `GET /material` for the tree (by what it was asked for). */
export async function saveMaterialList(treeId: string, list: MaterialList, scope: MaterialScope, now: number = Date.now()): Promise<MaterialCacheRecord> {
    await primeMaterials(treeId);
    return putRecord(applyMaterialAnswer(cachedMaterials(treeId), treeId, list, scope), now);
}

/** Records from an `assign`/`hide` answer into the cache (same id replaced; people added). */
export async function mergeIntoCache(treeId: string, files: MaterialFile[], people: Record<string, string> = {}, now: number = Date.now()): Promise<MaterialCacheRecord> {
    await primeMaterials(treeId);
    const rec = cloneRecord(cachedMaterials(treeId) ?? emptyRecord(treeId));
    rec.list.files = mergeFiles(rec.list.files, files);
    Object.assign(rec.list.people, people);
    return putRecord(rec, now);
}

/** The record with a batch's people changed (an assign on the whole batch; pure). */
export function applyBatchPersons(rec: MaterialCacheRecord, batchId: string, add: readonly string[] = [], remove: readonly string[] = []): MaterialCacheRecord {
    const i = rec.list.batches.findIndex(b => b.id === batchId);
    if (i < 0) return rec;
    const next = cloneRecord(rec);
    const b = next.list.batches[i];
    const persons = (b.persons ?? []).filter(p => !remove.includes(p));
    for (const p of add) if (!persons.includes(p)) persons.push(p);
    next.list.batches[i] = { ...b, persons };
    return next;
}

/** An `assign` answer into the cache: its records, its people and (for a whole batch) the batch's people. */
export async function mergeAssignIntoCache(
    treeId: string, files: MaterialFile[], people: Record<string, string> = {},
    batch?: { id: string; add?: readonly string[]; remove?: readonly string[] }, now: number = Date.now(),
): Promise<MaterialCacheRecord> {
    await primeMaterials(treeId);
    let rec = cloneRecord(cachedMaterials(treeId) ?? emptyRecord(treeId));
    rec.list.files = mergeFiles(rec.list.files, files);
    Object.assign(rec.list.people, people);
    if (batch) rec = applyBatchPersons(rec, batch.id, batch.add, batch.remove);
    return putRecord(rec, now);
}

/** Remember a batch was opened (its files stay cached for 30 days even over the limit). */
export async function markBatchOpened(treeId: string, batch: string, now: number = Date.now()): Promise<void> {
    await primeMaterials(treeId);
    const prev = cachedMaterials(treeId);
    if (!prev) return;
    const rec = cloneRecord(prev);
    rec.opened[batch] = now;
    await putRecord(rec, now);
}

export function thumbKey(treeId: string, sha: string, px: number): string {
    return `${treeId}|${sha}|${px}`;
}

/** Least recently used previews to drop so the rest fits the limit (pure). */
export function thumbsToEvict(rows: readonly ThumbMeta[], limit: number = THUMB_CACHE_LIMIT): string[] {
    let total = rows.reduce((s, r) => s + r.bytes, 0);
    if (total <= limit) return [];
    const out: string[] = [];
    for (const r of [...rows].sort((a, b) => a.usedAt - b.usedAt)) {
        if (total <= limit) break;
        out.push(r.key);
        total -= r.bytes;
    }
    return out;
}

/** Touches a used preview at most once a minute (fewer writes while scrolling). */
const TOUCH_MS = 60_000;

/** A cached preview (null: none). */
export async function getCachedThumb(treeId: string, sha: string, px: number, now: number = Date.now()): Promise<Blob | null> {
    try {
        const row = await safely(b => b.getThumb(thumbKey(treeId, sha, px)));
        if (!row) return null;
        if (now - row.usedAt > TOUCH_MS) void safely(b => b.putThumb({ ...row, usedAt: now })).catch(() => undefined);
        return row.blob;
    } catch {
        return null;
    }
}

/** Keep a preview; the tree's least recently used ones go over 50 MB. */
export async function putCachedThumb(treeId: string, sha: string, px: number, blob: Blob, now: number = Date.now()): Promise<void> {
    try {
        await safely(b => b.putThumb({ key: thumbKey(treeId, sha, px), treeId, sha, px, bytes: blob.size, usedAt: now, blob }));
        const evict = thumbsToEvict(await safely(b => b.thumbs(treeId)));
        if (evict.length) await safely(b => b.deleteThumbs(evict));
    } catch (err) {
        console.warn('Storing a material preview failed', err);
    }
}

/** Forget the tree's cached list and previews (disconnecting, removing the tree). */
export async function clearMaterialsCache(treeId: string): Promise<void> {
    lists.set(treeId, null);
    priming.delete(treeId);
    try {
        await safely(b => b.deleteList(treeId));
        const keys = (await safely(b => b.thumbs(treeId))).map(r => r.key);
        await safely(b => b.deleteThumbs(keys));
    } catch (err) {
        console.warn('Clearing the materials cache failed', err);
    }
    lists.delete(treeId);
    notify(treeId);
}

/** The document's own date for showing (a GEDCOM-like text, else as written). */
export function materialDate(date: string): string {
    if (parseFlexDate(date)) return formatFlexDate(date);
    const flex = parseGedcomDate(date);
    return flex && parseFlexDate(flex) ? formatFlexDate(flex) : date;
}

/** A file's date (GEDCOM-like text, or the app's flex form) as the date field shows it; one it cannot read as written. */
export function materialDateForInput(date: string | undefined): string {
    if (!date) return '';
    const flex = parseGedcomDate(date);
    if (flex && parseFlexDate(flex)) return formatDateForInput(flex);
    return parseFlexDate(date) ? formatDateForInput(date) : date;
}

/**
 * The date field's text as a file's date: GEDCOM text as the research and
 * the files of other programs write it ("ABT 1910", "12 MAY 1924"); '' = no
 * date; null = it cannot be read.
 */
export function materialDateFromInput(value: string): string | null {
    const flex = normalizeDateInput(value);
    if (flex === null) return null;
    if (!flex) return '';
    return formatGedcomDate(flex) ?? flex;
}
