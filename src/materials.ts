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

import { Attachment, Person } from './types.js';
import { cleanText, researchPersonRef, researchSchemeUrl, withAppVersion } from './research-link.js';
import { strings } from './strings.js';

// ==================== CAPABILITIES ====================

export const MATERIAL_LIST_FEATURE = 'material.list';
export const MATERIAL_ASSIGN_FEATURE = 'material.assign';
export const MATERIAL_THUMB_FEATURE = 'material.thumb';

/** Preview sizes the bridge makes (longer side, px). */
export const THUMB_SIZES = [128, 256, 512] as const;
export type ThumbSize = typeof THUMB_SIZES[number];

// ==================== TYPES ====================

export type MaterialKind = 'photo' | 'document' | 'record' | 'other';
/** What a file is by its type, for its icon and label when it has no kind. */
export type MaterialType = 'image' | 'pdf' | 'audio' | 'file';
export type HiddenReason = 'unrelated' | 'duplicate';

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
    /** file.title › file.name › attachment.name */
    title: string;
    kind?: MaterialKind;
    date?: string;
    mime?: string;
    bytes?: number;
    /** When it came (file.at; attachments carry no time). */
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
    if (h.reason === 'unrelated' || h.reason === 'duplicate') out.reason = h.reason;
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
    const date = text(r.date, 60);
    if (date) file.date = date;
    const hidden = hiddenOf(r.hidden);
    if (hidden) file.hidden = hidden;
    return file;
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

/** The item's name for its file type ("TIFF"), shown beside an image the app cannot show. */
function rawImageSuffix(mime: string | undefined, name: string | undefined): string {
    const m = (mime ?? '').toLowerCase();
    const ext = fileExt(name);
    if (m === 'image/tiff' || ext === 'tif' || ext === 'tiff') return 'TIFF';
    if (m === 'image/heic' || m === 'image/heif' || ext === 'heic' || ext === 'heif') return 'HEIC';
    return '';
}

/** The kind as a label: its kind (Photo, Document…), else by type (Image TIFF, PDF, Audio, File). */
export function materialKindLabel(item: Pick<MaterialItem, 'kind' | 'mime' | 'title' | 'file' | 'attachment'>): string {
    const m = strings.materials;
    if (item.kind) return m.kind[item.kind] ?? m.kind.other;
    const name = item.file?.name ?? item.attachment?.name ?? item.title;
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

/** "batch › folder"; a file outside a batch: "Single files". */
export function batchFolderLabel(item: Pick<MaterialItem, 'batch' | 'path'> & { origin?: MaterialItem['origin'] }): string {
    // An attachment without its original in the research: "In the tree" (where it came from is not told apart).
    if (item.origin === 'tree') return strings.materials.inTreeGroup;
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

/** A file nobody said whom it concerns: no person on it, none from sorting and none on its batch. */
export function fileWithoutPerson(file: MaterialFile, list: Pick<MaterialList, 'batches'>): boolean {
    if (file.persons.length || file.sorted?.persons?.length) return false;
    const batch = file.batch ? list.batches.find(b => b.id === file.batch) : undefined;
    return !batch?.persons?.length;
}

function noteOfSender(file: MaterialFile): string | undefined {
    const notes = (file.notes ?? []).filter(n => n.by === 'user').map(n => n.text);
    return notes.length ? notes.join('\n') : undefined;
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
    const item: MaterialItem = {
        key: `m:${file.id}`,
        origin: attachment ? 'both' : 'archive',
        file,
        title: file.title ?? file.name,
        persons: [...direct, ...viaBatch],
        viaBatch,
        here: file.here !== false,
    };
    if (attachment) item.attachment = attachment;
    if (file.kind) item.kind = file.kind;
    if (file.date) item.date = file.date;
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
    return item;
}

/** A tree attachment without its original in the research. */
export function attachmentItem(att: Attachment, refn: string | null): MaterialItem {
    const item: MaterialItem = {
        key: `a:${att.id}`,
        origin: 'tree',
        attachment: att,
        title: att.name,
        mime: att.original?.mimeType ?? att.mimeType,
        bytes: att.original?.bytes ?? att.sizeBytes,
        persons: refn ? [refn] : [],
        viaBatch: [],
        here: true,
    };
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
export function personMaterials(person: Pick<Person, 'refn' | 'attachments'>, list?: MaterialList | null, opts: { includeHidden?: boolean } = {}): MaterialItem[] {
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

export interface MaterialCaps {
    list: boolean;
    assign: boolean;
    thumb: boolean;
    bridgeUp: boolean;
    /** Links into the research open (`/status.links`, also remembered); default yes. */
    links?: boolean;
}

export function materialCaps(env: MaterialEnv & { links?: boolean }): MaterialCaps {
    const caps: MaterialCaps = { list: matList(env), assign: matAssign(env), thumb: matThumb(env), bridgeUp: env.bridgeUp };
    if (env.links !== undefined) caps.links = env.links;
    return caps;
}

export type MaterialActionId =
    | 'open' | 'assign' | 'removeFromPerson' | 'hide' | 'restore'
    | 'openSystem' | 'showInBatch' | 'download' | 'deleteFromTree';

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
}

interface ActionRow {
    id: MaterialActionId;
    /** Offered for the item at all. */
    when: (item: MaterialItem, caps: MaterialCaps, ctx: MaterialActionContext) => boolean;
    /** Writes to the research: offered but disabled while the bridge does not answer. */
    writes?: boolean;
    extra?: (item: MaterialItem, ctx: MaterialActionContext) => Partial<MaterialAction>;
}

const inArchive = (item: MaterialItem) => item.origin !== 'tree' && !!item.file;

/**
 * The actions in their order (the ⋯ menu and the viewer are built from this;
 * later actions — editing, using as a portrait… — are new rows here).
 */
const ACTION_ROWS: ActionRow[] = [
    { id: 'open', when: () => true },
    { id: 'assign', writes: true, when: (i, c) => inArchive(i) && c.assign },
    {
        id: 'removeFromPerson', writes: true,
        when: (i, c, x) => inArchive(i) && c.assign && !!x.person && i.persons.includes(x.person),
        extra: (i, x) => (x.person && i.viaBatch.includes(x.person) ? { viaBatch: true } : {}),
    },
    { id: 'hide', writes: true, when: (i, c) => inArchive(i) && c.assign && !i.hidden },
    { id: 'restore', writes: true, when: (i, c) => inArchive(i) && c.assign && !!i.hidden },
    { id: 'openSystem', when: (i, c) => inArchive(i) && c.links !== false },
    { id: 'showInBatch', when: (i) => inArchive(i) && !!i.batch },
    { id: 'download', when: (i) => i.origin === 'tree' },
    { id: 'deleteFromTree', when: (i) => i.origin === 'tree' },
];

/** The actions of one item (P1). */
export function materialActions(item: MaterialItem, caps: MaterialCaps, ctx: MaterialActionContext = {}): MaterialAction[] {
    const out: MaterialAction[] = [];
    for (const row of ACTION_ROWS) {
        if (!row.when(item, caps, ctx)) continue;
        const action: MaterialAction = { id: row.id, ...(row.extra?.(item, ctx) ?? {}) };
        if (row.writes && !caps.bridgeUp) action.disabled = 'bridgeDown';
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
export function personMaterialCount(person: Pick<Person, 'refn' | 'attachments'>, list: MaterialList | null | undefined, listOn: boolean): number {
    if (!listOn) return person.attachments?.length ?? 0;
    return personMaterials(person, list).length;
}

/**
 * Counts for many people at once (card tooltips): the same number as
 * `personMaterials(person, list).length`, with the list indexed once.
 */
export function materialCounter(list: MaterialList | null | undefined): (person: Pick<Person, 'refn' | 'attachments'>) => number {
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
    | 'gone' | 'missing' | 'type' | 'size' | 'unknown' | 'down' | 'aborted';

export interface MaterialError {
    kind: MaterialErrorKind;
    /** HTTP status (0: no answer). */
    status: number;
    code?: string;
    params?: Record<string, unknown>;
    /** Seconds the research asked to wait (busy). */
    retry?: number;
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

interface RawAnswer { status: number; body: unknown; retryAfter: string | null; res?: Response }

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
async function withBusyRetry(url: string, init: RequestInit, opts: BridgeOptions, raw = false): Promise<RawAnswer | MaterialError> {
    const delays = opts.retryDelaysMs ?? BUSY_RETRY_DELAYS_MS;
    const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms, opts.signal));
    for (let attempt = 0; ; attempt++) {
        const answer = await request(url, init, opts, raw);
        if ('kind' in answer) return answer;
        if (answer.status !== 409 || attempt >= delays.length) return answer;
        const err = materialErrorOf(answer.status, answer.body, answer.retryAfter);
        const wait = err.retry !== undefined ? Math.min(err.retry * 1000, MAX_RETRY_WAIT_MS) : delays[attempt];
        await sleep(wait);
        if (opts.signal?.aborted) return { kind: 'aborted', status: 0 };
    }
}

function postInit(body: unknown): RequestInit {
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export interface MaterialQuery {
    /** The person's REFN: their files. */
    person?: string;
    /** One batch's files. */
    batch?: string;
    /** Only batches and people, no files. */
    files0?: boolean;
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
        return { ok: true, value: { files: parseFiles(b.files), people: parsePeople(b.people), kept: parseKept(b.kept) } };
    }
    return { ok: false, error: materialErrorOf(answer.status, answer.body, answer.retryAfter) };
}

export interface HideRequest {
    files: string[];
    hidden: boolean;
    reason?: HiddenReason;
}

/** Hide or restore files (`POST /material/hide`). */
export async function hideMaterial(base: string, req: HideRequest, opts: BridgeOptions = {}): Promise<MaterialResult<{ files: MaterialFile[]; people: Record<string, string> }>> {
    if (!req.files.length || !req.files.every(f => FILE_ID.test(f))) return bodyError();
    const body: Record<string, unknown> = { files: req.files, hidden: req.hidden };
    if (req.hidden && req.reason) body.reason = req.reason;
    const answer = await withBusyRetry(withAppVersion(`${base}/material/hide`), postInit(body), opts);
    if ('kind' in answer) return { ok: false, error: answer };
    if (answer.status === 200 && answer.body && typeof answer.body === 'object') {
        const b = answer.body as Record<string, unknown>;
        return { ok: true, value: { files: parseFiles(b.files), people: parsePeople(b.people) } };
    }
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
