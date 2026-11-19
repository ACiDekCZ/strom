/**
 * The materials overview (spec 017 §3, spec 102 §1): every file of the
 * research and every file of the tree as one list (one item per file),
 * filtered, grouped (by batch with its folders or by the day received; a
 * tree without an archive by the day added or by person) and laid out as
 * rows of a virtual list.
 *
 * UI-free and pure: the window (src/ui/materials-window.ts) keeps the state,
 * this module computes what to draw from it.
 */

import { Attachment } from './types.js';
import {
    MaterialItem, MaterialList, MaterialBatch, MaterialFile, MaterialKind,
    materialFileItem, attachmentItem, materialFolder, foldText,
} from './materials.js';

/** With an archive: by batch or the day received; without one (the tree's own files): by the day added or by person. */
export type OverviewGroupMode = 'batch' | 'date' | 'added' | 'person';
export type ArchiveGroupMode = 'batch' | 'date';
export type AppGroupMode = 'added' | 'person';
export type OverviewView = 'grid' | 'list';
export type KindFilter = MaterialKind | 'none';
export const KIND_FILTERS: KindFilter[] = ['photo', 'document', 'record', 'other', 'none'];

/** Days after which received files are shown together as "Earlier" (by date). */
export const EARLIER_DAYS = 60;

export interface OverviewFilters {
    /** A person's key (REFN with an archive, PersonId without): their files (directly, from sorting or through the batch). */
    person: string | null;
    kinds: KindFilter[];
    batch: string | null;
    noPerson: boolean;
    /** Review filters (spec 102 §8): files without a title of their own, without a source. */
    noTitle: boolean;
    noSource: boolean;
    /** Beside an archive: only files in the tree, or only in the archive (mutually exclusive). */
    where: 'tree' | 'archive' | null;
    showHidden: boolean;
    query: string;
}

export function emptyFilters(): OverviewFilters {
    return { person: null, kinds: [], batch: null, noPerson: false, noTitle: false, noSource: false, where: null, showHidden: false, query: '' };
}

/** Filters that narrow the list ("Filters · N"; the search is not counted, showing hidden is). */
export function activeFilterCount(f: OverviewFilters): number {
    return (f.person ? 1 : 0) + (f.kinds.length ? 1 : 0) + (f.batch ? 1 : 0) + (f.noPerson ? 1 : 0)
        + (f.noTitle ? 1 : 0) + (f.noSource ? 1 : 0) + (f.where ? 1 : 0) + (f.showHidden ? 1 : 0);
}

/** Something leaves items out (groups then say "k of n" and skip groups without a match). */
export function narrowing(f: OverviewFilters): boolean {
    return !!(f.person || f.kinds.length || f.batch || f.noPerson || f.noTitle || f.noSource || f.where || f.query.trim());
}

/** The remembered filters (`strom.materials.view` `filters`; the search and the person are not kept). */
export function parseFilters(raw: unknown): Partial<OverviewFilters> {
    const out: Partial<OverviewFilters> = {};
    if (!raw || typeof raw !== 'object') return out;
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.kinds)) out.kinds = r.kinds.filter((k): k is KindFilter => (KIND_FILTERS as readonly unknown[]).includes(k));
    for (const k of ['noPerson', 'noTitle', 'noSource', 'showHidden'] as const) if (r[k] === true) out[k] = true;
    if (r.where === 'tree' || r.where === 'archive') out.where = r.where;
    return out;
}

/** What of the filters is remembered. */
export function storedFilters(f: OverviewFilters): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (f.kinds.length) out.kinds = f.kinds;
    for (const k of ['noPerson', 'noTitle', 'noSource', 'showHidden'] as const) if (f[k]) out[k] = true;
    if (f.where) out.where = f.where;
    return out;
}

// ==================== ITEMS ====================

/** A file of the tree (one record of StromData.media, in the tree). */
export interface TreeRecord {
    att: Attachment;
    /** Its people as the overview's person keys (REFN with an archive, PersonId without), in the order of its places. */
    persons: readonly string[];
    /** How many places it is used in (src/media-uses.ts). */
    uses: number;
    /** The title of the first source it is evidence of or cut out for (none: without a source). */
    source?: string;
}

/**
 * Every item, one per file: the research's files (joined with the tree's
 * file of the same original: `both`) and the tree's files without an
 * original there (`tree`, their time the one they were added). Hidden files
 * are included (the filters decide).
 */
export function overviewItems(list: MaterialList | null, tree: readonly TreeRecord[]): MaterialItem[] {
    const files = list?.files ?? [];
    // A tree's file joins the research's record of it (`origin: 'app'`, material.links) before another
    // record of the same original (it came in a batch too); an older research: the first by the hash.
    const bySha = new Map<string, MaterialFile>();
    for (const f of files) {
        const had = bySha.get(f.sha);
        if (!had || (f.origin === 'app' && had.origin !== 'app')) bySha.set(f.sha, f);
    }
    const joined = new Map<string, TreeRecord>();
    const removed = new Map<string, TreeRecord>();
    const treeOnly: MaterialItem[] = [];
    for (const rec of tree) {
        const file = rec.att.original?.sha256 ? bySha.get(rec.att.original.sha256.toLowerCase()) : undefined;
        // Taken out of the tree (spec 102 §9): its archive file is hidden "removed" with Restore; nothing without one.
        if (rec.att.removed && !rec.att.places?.length) {
            if (file && !joined.has(file.id) && !removed.has(file.id)) removed.set(file.id, rec);
            continue;
        }
        if (file && !joined.has(file.id)) {
            joined.set(file.id, rec);
            continue;
        }
        const item = attachmentItem(rec.att, rec.persons);
        item.uses = rec.uses;
        if (rec.source) item.source = rec.source;
        if (rec.att.addedAt) item.at = rec.att.addedAt;
        treeOnly.push(item);
    }
    const batches = new Map((list?.batches ?? []).map(b => [b.id, b]));
    const items = files.map(f => {
        const rec = joined.get(f.id);
        const item = materialFileItem(f, list ?? { batches: [] }, rec?.att, batches);
        if (rec) {
            item.uses = rec.uses;
            if (rec.source) item.source = rec.source;
        }
        const out = !rec ? removed.get(f.id) : undefined;
        if (out) {
            item.removedId = out.att.id;
            item.hidden = { reason: 'removed' };
        }
        return item;
    });
    return [...items, ...treeOnly];
}

/** Search text of an item, folded once. */
const hayCache = new WeakMap<MaterialItem, string>();
function hay(item: MaterialItem): string {
    let h = hayCache.get(item);
    if (h === undefined) {
        h = foldText([
            item.title, item.file?.name, item.attachment?.name, item.path,
            ...(item.file?.notes ?? []).map(n => n.text), item.attachment?.note,
        ].filter(Boolean).join('\n'));
        hayCache.set(item, h);
    }
    return h;
}

/** The search's words, folded (no diacritics, lowercase). */
export function queryWords(query: string): string[] {
    return foldText(query).split(/\s+/).filter(Boolean);
}

/**
 * A file nobody is on: a research file (directly, from sorting or through
 * its batch), or a file of the tree at no person (only at a source or a
 * union; a person the research does not know yet still counts as one).
 */
export function itemWithoutPerson(item: MaterialItem): boolean {
    if (item.persons.length > 0) return false;
    return item.origin !== 'tree' || !item.attachment?.places?.some(p => 'personId' in p);
}

/** The file is in the tree (the tree keeps it or uses it); beside an archive the rest is only in the archive. */
export function itemInTree(item: MaterialItem): boolean {
    return !!item.attachment || (item.uses ?? 0) > 0;
}

/** Does the item pass the filters? (`words`: `queryWords(f.query)`, computed once.) */
export function passesFilters(item: MaterialItem, f: OverviewFilters, words: string[] = queryWords(f.query)): boolean {
    if (item.hidden && !f.showHidden) return false;
    if (f.person && !item.persons.includes(f.person)) return false;
    if (f.kinds.length && !f.kinds.includes(item.kind ?? 'none')) return false;
    if (f.batch && item.batch?.id !== f.batch) return false;
    if (f.noPerson && !itemWithoutPerson(item)) return false;
    if (f.noTitle && item.titled) return false;
    if (f.noSource && item.source) return false;
    if (f.where && (f.where === 'tree') !== itemInTree(item)) return false;
    if (words.length) {
        const h = hay(item);
        if (!words.every(w => h.includes(w))) return false;
    }
    return true;
}

// ==================== SUMMARY ====================

export interface OverviewSummary {
    /** Files of the research, without hidden ones. */
    files: number;
    batches: number;
    /** Files without a person (without hidden ones). */
    noPerson: number;
    hidden: number;
    /** Review counts (spec 102 §8, without hidden ones, over the files known here). */
    noTitle: number;
    noSource: number;
    inTree: number;
    onlyArchive: number;
}

/**
 * The window's header counts. While only some files are known (the whole
 * list not loaded yet), the batches' own counts stand in for theirs.
 */
export function overviewSummary(items: readonly MaterialItem[], list: MaterialList | null, full: boolean, withTree = false): OverviewSummary {
    let files = 0, noPerson = 0, hidden = 0, noTitle = 0, noSource = 0, inTree = 0, onlyArchive = 0;
    const loadedPerBatch = new Map<string, number>();
    for (const item of items) {
        // The tree's own files count only where they are the whole list (a tree without an archive).
        // The review counts are over every file shown (the tree's own too: the filters reach them).
        if (!item.hidden) {
            if (!item.titled) noTitle++;
            if (!item.source) noSource++;
            if (itemInTree(item)) inTree++; else onlyArchive++;
        }
        if (item.origin === 'tree' && !withTree) continue;
        if (item.hidden) { hidden++; continue; }
        files++;
        if (itemWithoutPerson(item)) noPerson++;
        if (item.batch) loadedPerBatch.set(item.batch.id, (loadedPerBatch.get(item.batch.id) ?? 0) + 1);
    }
    if (!full && list) {
        for (const b of list.batches) files += Math.max(0, b.files - (loadedPerBatch.get(b.id) ?? 0));
    }
    return { files, batches: list?.batches.length ?? 0, noPerson, hidden, noTitle, noSource, inTree, onlyArchive };
}

// ==================== GROUPS ====================

export interface OverviewFolder {
    /** `f:<batch id>/<folder path>` */
    key: string;
    /** The whole path inside the batch: "Photos / 1930" */
    label: string;
    /** Its own name, shown indented under its parent: "1930" */
    name: string;
    /** 0: right in the batch; 1: in a folder of it; … */
    depth: number;
    /** The folder it is in (its key); none right in the batch. */
    parent?: string;
    /** Matching items in it and in its subfolders (display order). */
    items: MaterialItem[];
    /** Matching items right in it (under its header, before its subfolders). */
    files: MaterialItem[];
    /** Items in it and in its subfolders without the narrowing filters. */
    total: number;
}

/** Is a file at `path` in the folder `label` (or in one of its subfolders)? */
export function inMaterialFolder(path: string | undefined, label: string): boolean {
    const folder = materialFolder(path);
    return folder === label || folder.startsWith(`${label} / `);
}

/** "A / B / C" → ["A", "A / B", "A / B / C"]. */
function folderChain(label: string): string[] {
    const parts = label.split(' / ');
    return parts.map((_, i) => parts.slice(0, i + 1).join(' / '));
}

export type OverviewGroupKind = 'batch' | 'loose' | 'day' | 'earlier' | 'person' | 'noperson';

export interface OverviewGroup {
    /** `b:<id>`, `loose`, `d:<YYYY-MM-DD>`, `earlier`, `p:<person key>`, `noperson` */
    key: string;
    kind: OverviewGroupKind;
    batch?: MaterialBatch;
    /** Local day (by date). */
    day?: string;
    /** Matching items in display order (root items, then folder by folder). */
    items: MaterialItem[];
    /** A batch's files outside folders (shown before its folders). */
    root: MaterialItem[];
    /** A batch's folder tree, flat: each folder after its parent (`depth`, `parent`). */
    folders: OverviewFolder[];
    /** Items of the group without the narrowing filters (hidden ones only with "Show hidden"). */
    total: number;
    /** A batch whose files are not known yet (its count is the research's). */
    pending?: boolean;
    /** By date: the batches of the day and how many came single. */
    batchNames?: string[];
    looseCount?: number;
    /** Single files: where they came from (`from` of the files). */
    froms?: string[];
    /** By day: the people of its files (keys, each once, in order); by person: the group's person. */
    persons?: string[];
}

export interface OverviewInput {
    items: readonly MaterialItem[];
    list: MaterialList | null;
    filters: OverviewFilters;
    mode: OverviewGroupMode;
    /** The batch's files are known (the whole list, or its `?batch=` answer). */
    batchLoaded: (id: string) => boolean;
    now?: number;
    /** A person key's name (by person: the groups' order). */
    personName?: (key: string) => string | null;
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
const compareText = (a: string, b: string) => (collator ? collator.compare(a, b) : a.localeCompare(b));

function time(iso: string | undefined): number {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? NaN : t;
}

/** Newest first; without a time at the end (in their order). */
function byNewest<T>(rows: T[], at: (row: T) => string | undefined): T[] {
    return rows
        .map((row, index) => ({ row, index, t: time(at(row)) }))
        .sort((a, b) => {
            const an = Number.isNaN(a.t), bn = Number.isNaN(b.t);
            if (an !== bn) return an ? 1 : -1;
            if (!an && a.t !== b.t) return b.t - a.t;
            return a.index - b.index;
        })
        .map(x => x.row);
}

/** The local day of a moment ("2026-10-23"), or ''. */
export function localDay(iso: string | undefined): string {
    const t = time(iso);
    if (Number.isNaN(t)) return '';
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Where single files came from, as `strings.materials.from` keys. A path
 * (`strom intake` gives the file's own: `/…`, `~/…`, `C:\…`, `\\server\…`)
 * is the terminal's; a value nothing here knows says nothing (null).
 */
export function fromKey(from: string | undefined): 'app' | 'batch' | 'phone' | 'cli' | null {
    const raw = (from ?? '').trim();
    if (!raw) return null;
    if (/^(?:[/~]|[a-z]:[\\/]|\\\\)/i.test(raw)) return 'cli';
    const f = raw.toLowerCase();
    if (/terminal|\bcli\b|command/.test(f)) return 'cli';
    if (/phone|mobil|telefon/.test(f)) return 'phone';
    if (/batch|dávk|stapel/.test(f)) return 'batch';
    if (/\bapp\b|strom|aplikac|browser|web/.test(f)) return 'app';
    return null;
}

/**
 * A batch's items: files outside folders first, then its folder tree (as in
 * the batch guide): every folder after its parent, siblings by name; a
 * folder's own files under its header, before its subfolders.
 */
function batchContent(items: MaterialItem[], all: MaterialItem[], batchId: string): { root: MaterialItem[]; folders: OverviewFolder[] } {
    const byName = (a: MaterialItem, b: MaterialItem) => compareText(a.path ?? a.title, b.path ?? b.title);
    const root: MaterialItem[] = [];
    const nodes = new Map<string, OverviewFolder>();
    const children = new Map<string, OverviewFolder[]>();
    const totals = new Map<string, number>();
    for (const item of all) {
        const label = materialFolder(item.path);
        if (label) for (const l of folderChain(label)) totals.set(l, (totals.get(l) ?? 0) + 1);
    }
    const node = (label: string): OverviewFolder => {
        let folder = nodes.get(label);
        if (folder) return folder;
        const chain = folderChain(label);
        const parentLabel = chain.length > 1 ? chain[chain.length - 2] : '';
        const parent = parentLabel ? node(parentLabel) : null;
        folder = {
            key: `f:${batchId}/${label}`, label, name: label.split(' / ').pop() ?? label, depth: chain.length - 1,
            ...(parent ? { parent: parent.key } : {}), items: [], files: [], total: totals.get(label) ?? 0,
        };
        nodes.set(label, folder);
        children.set(parentLabel, [...(children.get(parentLabel) ?? []), folder]);
        return folder;
    };
    for (const item of items) {
        const label = materialFolder(item.path);
        if (!label) root.push(item);
        else node(label).files.push(item);
    }
    root.sort(byName);
    const folders: OverviewFolder[] = [];
    const walk = (parentLabel: string): MaterialItem[] => {
        const out: MaterialItem[] = [];
        for (const folder of (children.get(parentLabel) ?? []).sort((a, b) => compareText(a.name, b.name))) {
            folders.push(folder);
            folder.files.sort(byName);
            folder.items = [...folder.files, ...walk(folder.label)];
            out.push(...folder.items);
        }
        return out;
    };
    walk('');
    return { root, folders };
}

/** The folders open at first: the first one, and down its line while a folder has only subfolders. */
export function firstFolderLine(group: OverviewGroup): string[] {
    const keys: string[] = [];
    let folder: OverviewFolder | undefined = group.folders[0];
    while (folder) {
        keys.push(folder.key);
        if (folder.files.length) break;
        const parent: string = folder.key;
        folder = group.folders.find(f => f.parent === parent);
    }
    return keys;
}

function emptyGroup(key: string, kind: OverviewGroupKind): OverviewGroup {
    return { key, kind, items: [], root: [], folders: [], total: 0 };
}

/**
 * The groups to draw. With narrowing filters, groups without a match are
 * left out (a batch whose files are not known yet too: its files cannot be
 * tested); without them every batch is listed, unknown ones as pending.
 */
export function overviewGroups(input: OverviewInput): OverviewGroup[] {
    const { items, list, filters, mode } = input;
    const words = queryWords(filters.query);
    const narrow = narrowing(filters);
    const shown = (i: MaterialItem) => !i.hidden || filters.showHidden;
    const pass = (i: MaterialItem) => passesFilters(i, filters, words);

    if (mode === 'date' || mode === 'added') return dateGroups(items, filters, input.now ?? Date.now(), pass, shown, narrow);
    if (mode === 'person') return personGroups(items, input.personName ?? (() => null), pass, shown);

    const groups: OverviewGroup[] = [];
    const perBatch = new Map<string, MaterialItem[]>();
    const loose: MaterialItem[] = [];
    for (const item of items) {
        if (item.batch) {
            const rows = perBatch.get(item.batch.id);
            if (rows) rows.push(item); else perBatch.set(item.batch.id, [item]);
        } else loose.push(item);
    }
    // Batches newest first; files naming a batch the list does not have get their own group.
    const known = list?.batches ?? [];
    const batches: MaterialBatch[] = [...known];
    for (const [id, rows] of perBatch) {
        if (!known.some(b => b.id === id)) batches.push({ id, name: rows[0].batch?.name ?? id, files: rows.length });
    }
    for (const batch of byNewest(batches, b => b.at)) {
        if (filters.batch && batch.id !== filters.batch) continue;
        const all = (perBatch.get(batch.id) ?? []).filter(shown);
        const loaded = input.batchLoaded(batch.id) || all.length > 0;
        const g = emptyGroup(`b:${batch.id}`, 'batch');
        g.batch = batch;
        if (!loaded) {
            if (narrow && !(filters.batch === batch.id && !words.length && !filters.person && !filters.kinds.length && !filters.noPerson)) continue;
            g.pending = true;
            g.total = batch.files;
            groups.push(g);
            continue;
        }
        const matching = all.filter(pass);
        if (narrow && matching.length === 0) continue;
        const { root, folders } = batchContent(matching, all, batch.id);
        g.root = root;
        g.folders = folders;
        g.items = [...root, ...folders.flatMap(f => f.files)];
        g.total = all.length;
        groups.push(g);
    }
    if (!filters.batch) {
        const allLoose = byNewest(loose.filter(shown), i => i.at);
        const matching = allLoose.filter(pass);
        if (matching.length && (narrow || allLoose.length)) {
            const g = emptyGroup('loose', 'loose');
            g.items = matching;
            g.root = matching;
            g.total = allLoose.length;
            const froms: string[] = [];
            for (const i of allLoose) {
                const k = fromKey(i.file?.from);
                if (k && !froms.includes(k)) froms.push(k);
            }
            g.froms = froms;
            groups.push(g);
        }
    }
    return groups;
}

/** People of items, each once, in order. */
function personsOf(items: readonly MaterialItem[]): string[] {
    const out: string[] = [];
    for (const i of items) for (const p of i.persons) if (!out.includes(p)) out.push(p);
    return out;
}

/**
 * By person (a tree without an archive): a group per person by name, a file
 * under each of its people (newest first); files without a person last.
 */
function personGroups(
    items: readonly MaterialItem[], name: (key: string) => string | null,
    pass: (i: MaterialItem) => boolean, shown: (i: MaterialItem) => boolean,
): OverviewGroup[] {
    const per = new Map<string, MaterialItem[]>();
    const none: MaterialItem[] = [];
    for (const item of items) {
        if (!shown(item)) continue;
        if (item.persons.length === 0) { none.push(item); continue; }
        for (const p of item.persons) {
            const rows = per.get(p);
            if (rows) rows.push(item); else per.set(p, [item]);
        }
    }
    const groups: OverviewGroup[] = [];
    const make = (key: string, kind: OverviewGroupKind, all: MaterialItem[], person?: string): void => {
        const sorted = byNewest(all, i => i.at);
        const matching = sorted.filter(pass);
        if (matching.length === 0) return;
        const g = emptyGroup(key, kind);
        g.items = matching;
        g.root = matching;
        g.total = sorted.length;
        if (person) g.persons = [person];
        groups.push(g);
    };
    const keys = [...per.keys()].sort((a, b) => compareText(name(a) ?? a, name(b) ?? b));
    for (const key of keys) make(`p:${key}`, 'person', per.get(key)!, key);
    make('noperson', 'noperson', none);
    return groups;
}

function dateGroups(
    items: readonly MaterialItem[], filters: OverviewFilters, now: number,
    pass: (i: MaterialItem) => boolean, shown: (i: MaterialItem) => boolean, narrow: boolean,
): OverviewGroup[] {
    const cutoff = now - EARLIER_DAYS * 86_400_000;
    const days = new Map<string, MaterialItem[]>();
    const earlier: MaterialItem[] = [];
    for (const item of items) {
        if (!shown(item)) continue;
        if (filters.batch && item.batch?.id !== filters.batch) continue;
        const t = time(item.at);
        const day = localDay(item.at);
        if (!day || t < cutoff) { earlier.push(item); continue; }
        const rows = days.get(day);
        if (rows) rows.push(item); else days.set(day, [item]);
    }
    const groups: OverviewGroup[] = [];
    const make = (key: string, kind: OverviewGroupKind, all: MaterialItem[], day?: string): void => {
        const sorted = byNewest(all, i => i.at);
        const matching = sorted.filter(pass);
        if (matching.length === 0 || (narrow && matching.length === 0)) return;
        const g = emptyGroup(key, kind);
        if (day) g.day = day;
        g.items = matching;
        g.root = matching;
        g.total = sorted.length;
        const names: string[] = [];
        let single = 0;
        for (const i of sorted) {
            if (i.batch) { if (!names.includes(i.batch.name)) names.push(i.batch.name); } else single++;
        }
        g.batchNames = names;
        g.looseCount = single;
        g.persons = personsOf(sorted);
        groups.push(g);
    };
    for (const day of [...days.keys()].sort().reverse()) make(`d:${day}`, 'day', days.get(day)!, day);
    make('earlier', 'earlier', earlier);
    return groups;
}

// ==================== ROWS (the virtual list) ====================

export interface RowMetrics {
    view: OverviewView;
    /** Grid: tiles per row. */
    cols: number;
    /** Height of a grid row (tile, its texts and the gap below). */
    tileRow: number;
    /** Extra height of a grid row with a hidden tile ("Restore" under it). */
    restoreExtra: number;
    listRow: number;
    group: number;
    folder: number;
    /** A pending batch's placeholder row. */
    skeleton: number;
    /** Space after an open group's content. */
    groupEnd: number;
}

export type OverviewRow =
    | { type: 'group'; key: string; top: number; height: number; group: OverviewGroup; open: boolean }
    | { type: 'folder'; key: string; top: number; height: number; group: OverviewGroup; folder: OverviewFolder; open: boolean }
    | { type: 'tiles'; key: string; top: number; height: number; group: OverviewGroup; folder?: OverviewFolder; items: MaterialItem[]; first: number }
    | { type: 'item'; key: string; top: number; height: number; group: OverviewGroup; folder?: OverviewFolder; item: MaterialItem; first: number }
    | { type: 'skeleton'; key: string; top: number; height: number; group: OverviewGroup }
    | { type: 'end'; key: string; top: number; height: number; group: OverviewGroup };

export interface OverviewLayout {
    rows: OverviewRow[];
    height: number;
    /** Items of open groups and folders in display order (keyboard, Shift ranges). */
    order: MaterialItem[];
    /** Item key → its row's index. */
    rowOf: Map<string, number>;
}

/** Lay out the groups as rows: a header per group, its content when open. */
export function overviewRows(groups: readonly OverviewGroup[], isOpen: (key: string) => boolean, m: RowMetrics): OverviewLayout {
    const rows: OverviewRow[] = [];
    const order: MaterialItem[] = [];
    const rowOf = new Map<string, number>();
    let top = 0;
    const push = (row: OverviewRow) => { rows.push(row); top += row.height; };
    const content = (group: OverviewGroup, items: MaterialItem[], folder?: OverviewFolder) => {
        if (m.view === 'list') {
            for (const item of items) {
                rowOf.set(item.key, rows.length);
                push({ type: 'item', key: `i:${item.key}`, top, height: m.listRow, group, ...(folder ? { folder } : {}), item, first: order.length });
                order.push(item);
            }
            return;
        }
        const cols = Math.max(1, m.cols);
        for (let i = 0; i < items.length; i += cols) {
            const chunk = items.slice(i, i + cols);
            const height = m.tileRow + (chunk.some(x => x.hidden) ? m.restoreExtra : 0);
            for (const item of chunk) rowOf.set(item.key, rows.length);
            push({ type: 'tiles', key: `t:${folder?.key ?? group.key}:${i}`, top, height, group, ...(folder ? { folder } : {}), items: chunk, first: order.length });
            order.push(...chunk);
        }
    };
    for (const group of groups) {
        const open = isOpen(group.key);
        push({ type: 'group', key: group.key, top, height: m.group, group, open });
        if (!open) continue;
        if (group.pending) {
            push({ type: 'skeleton', key: `s:${group.key}`, top, height: m.skeleton, group });
        } else {
            content(group, group.root);
            // The folder tree: a folder under a closed one is not shown.
            const closed = new Set<string>();
            for (const folder of group.folders) {
                if (folder.parent && closed.has(folder.parent)) { closed.add(folder.key); continue; }
                const fOpen = isOpen(folder.key);
                push({ type: 'folder', key: folder.key, top, height: m.folder, group, folder, open: fOpen });
                if (fOpen) content(group, folder.files, folder);
                else closed.add(folder.key);
            }
        }
        push({ type: 'end', key: `e:${group.key}`, top, height: m.groupEnd, group });
    }
    return { rows, height: top, order, rowOf };
}

/** Rows touching [from, to) (binary search on `top`). */
export function rowsInView(rows: readonly OverviewRow[], from: number, to: number): { start: number; end: number } {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].top + rows[mid].height <= from) lo = mid + 1; else hi = mid;
    }
    let end = lo;
    while (end < rows.length && rows[end].top < to) end++;
    return { start: lo, end };
}

/** The group header that sticks at the top for a scroll position (null: none above). */
export function stickyGroupAt(rows: readonly OverviewRow[], scrollTop: number): { row: Extract<OverviewRow, { type: 'group' }>; next: number | null } | null {
    let current: Extract<OverviewRow, { type: 'group' }> | null = null;
    let next: number | null = null;
    for (const row of rows) {
        if (row.type !== 'group') continue;
        if (row.top <= scrollTop) current = row;
        else { next = row.top; break; }
    }
    return current ? { row: current, next } : null;
}

/** Tiles per grid row for a width (`min`: a tile's least width). */
export function gridColumns(width: number, min: number, gap: number): number {
    return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** Keys from one item to another in display order (both included; either way round). */
export function rangeKeys(order: readonly MaterialItem[], fromKey: string, toKey: string): string[] {
    const a = order.findIndex(i => i.key === fromKey);
    const b = order.findIndex(i => i.key === toKey);
    if (b < 0) return [];
    if (a < 0) return [toKey];
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return order.slice(lo, hi + 1).map(i => i.key);
}

// ==================== SMALL HELPERS ====================

/** A name without its years ("Jan Novák (1901–1975)" → "Jan Novák"). */
export function nameWithoutYears(name: string): string {
    return name
        .replace(/\s*\([^()]*\d{3,4}[^()]*\)\s*$/, '')
        .replace(/\s*[*†✝]\s*\d{3,4}\s*$/, '')
        .trim();
}

/** "Jan Novák +2"; '' without people. `name`: a REFN's name (null: unknown). */
export function personsShort(persons: readonly string[], name: (refn: string) => string | null): string {
    if (persons.length === 0) return '';
    const first = nameWithoutYears(name(persons[0]) ?? persons[0]);
    return persons.length > 1 ? `${first} +${persons.length - 1}` : first;
}

// ==================== LIST COLUMNS (spec 102 §8f) ====================

export type ListColumn = 'title' | 'kind' | 'date' | 'persons' | 'source' | 'intree' | 'used';
export const LIST_COLUMNS: readonly ListColumn[] = ['title', 'kind', 'date', 'persons', 'source', 'intree', 'used'];

export interface ListSort {
    col: ListColumn;
    dir: 1 | -1;
}

/** A GEDCOM-like date's first year (for sorting; none: null). */
function dateYear(date: string | undefined): number | null {
    const m = date?.match(/\b(\d{3,4})\b/);
    return m ? Number(m[1]) : null;
}

/**
 * Sort the groups' items by a list column (within each group and folder,
 * the groups keep their order). Empty values go last either way.
 */
export function sortOverviewGroups(groups: OverviewGroup[], sort: ListSort | null, ctx: { personName: (key: string) => string | null; kindLabel: (item: MaterialItem) => string }): OverviewGroup[] {
    if (!sort) return groups;
    const keyOf = (i: MaterialItem): string | number | null => {
        switch (sort.col) {
            case 'title': return i.title;
            case 'kind': return i.kind ? ctx.kindLabel(i) : null;
            case 'date': return dateYear(i.date);
            case 'persons': return i.persons.length ? nameWithoutYears(ctx.personName(i.persons[0]) ?? i.persons[0]) : null;
            case 'source': return i.source ?? null;
            case 'intree': return itemInTree(i) ? 0 : 1;
            case 'used': return i.uses ?? 0;
        }
    };
    const cmp = (a: MaterialItem, b: MaterialItem): number => {
        const x = keyOf(a), y = keyOf(b);
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : compareText(String(x), String(y));
        return c * sort.dir;
    };
    const sorted = (rows: MaterialItem[]) => rows.map((r, i) => [r, i] as const).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map(r => r[0]);
    for (const g of groups) {
        if (g.pending) continue;
        g.root = sorted(g.root);
        for (const f of g.folders) f.files = sorted(f.files);
        g.items = g.folders.length ? [...g.root, ...g.folders.flatMap(f => f.files)] : sorted(g.items);
    }
    return groups;
}

/** A choice of the window's Sort: a column, a direction, or the default order (null). */
export type SortChoice = { col: ListColumn } | { dir: 1 | -1 } | null;

/**
 * The sort after a choice: a column keeps the direction (ascending at
 * first), a direction keeps the column (none without one), null is the
 * groups' own order.
 */
export function chooseSort(sort: ListSort | null, choice: SortChoice): ListSort | null {
    if (!choice) return null;
    if ('col' in choice) return { col: choice.col, dir: sort?.dir ?? 1 };
    return sort ? { col: sort.col, dir: choice.dir } : null;
}

export interface ViewPrefs {
    /** With an archive. */
    group: ArchiveGroupMode;
    /** Without one (the tree's own files). */
    appGroup: AppGroupMode;
    view: OverviewView;
    /** The list's column sort (none: the group's order). */
    sort: ListSort | null;
    filters: Partial<OverviewFilters>;
}

/** The remembered groupings and view (`localStorage['strom.materials.view']`). */
export function parseViewPrefs(raw: string | null | undefined): ViewPrefs {
    const prefs: ViewPrefs = { group: 'batch', appGroup: 'added', view: 'grid', sort: null, filters: {} };
    try {
        const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
        if (parsed?.group === 'date') prefs.group = 'date';
        if (parsed?.appGroup === 'person') prefs.appGroup = 'person';
        if (parsed?.view === 'list') prefs.view = 'list';
        const sort = parsed?.sort as Record<string, unknown> | undefined;
        if (sort && (LIST_COLUMNS as readonly unknown[]).includes(sort.col) && (sort.dir === 1 || sort.dir === -1)) prefs.sort = { col: sort.col as ListColumn, dir: sort.dir };
        prefs.filters = parseFilters(parsed?.filters);
    } catch { /* not ours: the defaults */ }
    return prefs;
}

// ==================== ADD MATERIALS (spec 102 §8) ====================

/**
 * "Add materials…" in the window: beside a research that takes batches
 * (`batches`, the research menu's own condition), over its archive (a tree
 * without one adds attachments at a person) and only when the tree writes.
 */
export function windowAddOffered(o: { model: 'archive' | 'app'; batches: boolean; readOnly: boolean }): boolean {
    return o.model === 'archive' && o.batches && !o.readOnly;
}

export type WindowHeadAction = 'add' | 'where';

/** The header's ⋯ on a phone (§8, §11): Add materials… when offered, then Where the files are (the ⓘ's place there). */
export function windowHeadMenu(o: { add: boolean }): WindowHeadAction[] {
    return o.add ? ['add', 'where'] : ['where'];
}

/** A drag that carries files (not text or a link dragged out of the page). */
export function dragCarriesFiles(types: ArrayLike<string> | null | undefined): boolean {
    return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
}
