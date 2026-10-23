/**
 * The materials overview (spec 017 §3): every file of the research and every
 * attachment of the tree as one list, filtered, grouped (by batch with its
 * folders, or by the day received) and laid out as rows of a virtual list.
 *
 * UI-free and pure: the window (src/ui/materials-window.ts) keeps the state,
 * this module computes what to draw from it.
 */

import { Attachment } from './types.js';
import {
    MaterialItem, MaterialList, MaterialBatch, MaterialFile, MaterialKind,
    materialFileItem, attachmentItem, materialFolder, foldText,
} from './materials.js';

export type OverviewGroupMode = 'batch' | 'date';
export type OverviewView = 'grid' | 'list';
export type KindFilter = MaterialKind | 'none';
export const KIND_FILTERS: KindFilter[] = ['photo', 'document', 'record', 'other', 'none'];

/** Days after which received files are shown together as "Earlier" (by date). */
export const EARLIER_DAYS = 60;

export interface OverviewFilters {
    /** A person's REFN: their files (directly, from sorting or through the batch). */
    person: string | null;
    kinds: KindFilter[];
    batch: string | null;
    noPerson: boolean;
    showHidden: boolean;
    query: string;
}

export function emptyFilters(): OverviewFilters {
    return { person: null, kinds: [], batch: null, noPerson: false, showHidden: false, query: '' };
}

/** Filters that narrow the list ("Filters · N"; the search is not counted, showing hidden is). */
export function activeFilterCount(f: OverviewFilters): number {
    return (f.person ? 1 : 0) + (f.kinds.length ? 1 : 0) + (f.batch ? 1 : 0) + (f.noPerson ? 1 : 0) + (f.showHidden ? 1 : 0);
}

/** Something leaves items out (groups then say "k of n" and skip groups without a match). */
export function narrowing(f: OverviewFilters): boolean {
    return !!(f.person || f.kinds.length || f.batch || f.noPerson || f.query.trim());
}

// ==================== ITEMS ====================

/** A person of the tree with their attachments (REFN: null when the research does not know them yet). */
export interface TreeAttachments {
    refn: string | null;
    attachments: readonly Attachment[];
}

/**
 * Every item: the research's files (joined with the tree's attachment of the
 * same original: `both`) and the tree's attachments without an original
 * there (`tree`). Hidden files are included (the filters decide).
 */
export function overviewItems(list: MaterialList | null, tree: readonly TreeAttachments[]): MaterialItem[] {
    const files = list?.files ?? [];
    const bySha = new Map<string, MaterialFile>();
    for (const f of files) if (!bySha.has(f.sha)) bySha.set(f.sha, f);
    const joined = new Map<string, Attachment>();
    const treeOnly: MaterialItem[] = [];
    for (const person of tree) {
        for (const att of person.attachments) {
            const file = att.original?.sha256 ? bySha.get(att.original.sha256.toLowerCase()) : undefined;
            if (file && !joined.has(file.id)) joined.set(file.id, att);
            else treeOnly.push(attachmentItem(att, person.refn));
        }
    }
    const batches = new Map((list?.batches ?? []).map(b => [b.id, b]));
    const items = files.map(f => materialFileItem(f, list ?? { batches: [] }, joined.get(f.id), batches));
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

/** A research file nobody is on (directly, from sorting or through its batch). */
export function itemWithoutPerson(item: MaterialItem): boolean {
    return item.origin !== 'tree' && item.persons.length === 0;
}

/** Does the item pass the filters? (`words`: `queryWords(f.query)`, computed once.) */
export function passesFilters(item: MaterialItem, f: OverviewFilters, words: string[] = queryWords(f.query)): boolean {
    if (item.hidden && !f.showHidden) return false;
    if (f.person && !item.persons.includes(f.person)) return false;
    if (f.kinds.length && !f.kinds.includes(item.kind ?? 'none')) return false;
    if (f.batch && item.batch?.id !== f.batch) return false;
    if (f.noPerson && !itemWithoutPerson(item)) return false;
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
}

/**
 * The window's header counts. While only some files are known (the whole
 * list not loaded yet), the batches' own counts stand in for theirs.
 */
export function overviewSummary(items: readonly MaterialItem[], list: MaterialList | null, full: boolean): OverviewSummary {
    let files = 0, noPerson = 0, hidden = 0;
    const loadedPerBatch = new Map<string, number>();
    for (const item of items) {
        if (item.origin === 'tree') continue;
        if (item.hidden) { hidden++; continue; }
        files++;
        if (itemWithoutPerson(item)) noPerson++;
        if (item.batch) loadedPerBatch.set(item.batch.id, (loadedPerBatch.get(item.batch.id) ?? 0) + 1);
    }
    if (!full && list) {
        for (const b of list.batches) files += Math.max(0, b.files - (loadedPerBatch.get(b.id) ?? 0));
    }
    return { files, batches: list?.batches.length ?? 0, noPerson, hidden };
}

// ==================== GROUPS ====================

export interface OverviewFolder {
    /** `f:<batch id>/<folder path>` */
    key: string;
    /** "Photos / 1930" */
    label: string;
    items: MaterialItem[];
    /** Items in the folder without the narrowing filters. */
    total: number;
}

export type OverviewGroupKind = 'batch' | 'loose' | 'tree' | 'day' | 'earlier';

export interface OverviewGroup {
    /** `b:<id>`, `loose`, `tree`, `d:<YYYY-MM-DD>`, `earlier` */
    key: string;
    kind: OverviewGroupKind;
    batch?: MaterialBatch;
    /** Local day (by date). */
    day?: string;
    /** Matching items in display order (root items, then folder by folder). */
    items: MaterialItem[];
    /** A batch's files outside folders (shown before its folders). */
    root: MaterialItem[];
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
}

export interface OverviewInput {
    items: readonly MaterialItem[];
    list: MaterialList | null;
    filters: OverviewFilters;
    mode: OverviewGroupMode;
    /** The batch's files are known (the whole list, or its `?batch=` answer). */
    batchLoaded: (id: string) => boolean;
    now?: number;
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

/** Where single files came from, as `strings.materials.from` keys. */
export function fromKey(from: string | undefined): 'app' | 'batch' | 'phone' | 'cli' | null {
    const f = (from ?? '').toLowerCase();
    if (!f) return null;
    if (/terminal|cli|command/.test(f)) return 'cli';
    if (/phone|mobil|telefon/.test(f)) return 'phone';
    if (/batch|dávk|stapel/.test(f)) return 'batch';
    return 'app';
}

/** A batch's items: files outside folders first, then the folders (each sorted by name). */
function batchContent(items: MaterialItem[], all: MaterialItem[], batchId: string): { root: MaterialItem[]; folders: OverviewFolder[] } {
    const byName = (a: MaterialItem, b: MaterialItem) => compareText(a.path ?? a.title, b.path ?? b.title);
    const root: MaterialItem[] = [];
    const folders = new Map<string, OverviewFolder>();
    const totals = new Map<string, number>();
    for (const item of all) {
        const label = materialFolder(item.path);
        if (label) totals.set(label, (totals.get(label) ?? 0) + 1);
    }
    for (const item of items) {
        const label = materialFolder(item.path);
        if (!label) { root.push(item); continue; }
        let folder = folders.get(label);
        if (!folder) {
            folder = { key: `f:${batchId}/${label}`, label, items: [], total: totals.get(label) ?? 0 };
            folders.set(label, folder);
        }
        folder.items.push(item);
    }
    root.sort(byName);
    const sorted = [...folders.values()].sort((a, b) => compareText(a.label, b.label));
    sorted.forEach(f => f.items.sort(byName));
    return { root, folders: sorted };
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

    if (mode === 'date') return dateGroups(items, filters, input.now ?? Date.now(), pass, shown, narrow);

    const groups: OverviewGroup[] = [];
    const perBatch = new Map<string, MaterialItem[]>();
    const loose: MaterialItem[] = [];
    const tree: MaterialItem[] = [];
    for (const item of items) {
        if (item.origin === 'tree') tree.push(item);
        else if (item.batch) {
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
        g.items = [...root, ...folders.flatMap(f => f.items)];
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
        const treeShown = tree.filter(shown);
        const treeMatching = treeShown.filter(pass);
        if (treeMatching.length) {
            const g = emptyGroup('tree', 'tree');
            g.items = treeMatching;
            g.root = treeMatching;
            g.total = treeShown.length;
            groups.push(g);
        }
    }
    return groups;
}

function dateGroups(
    items: readonly MaterialItem[], filters: OverviewFilters, now: number,
    pass: (i: MaterialItem) => boolean, shown: (i: MaterialItem) => boolean, narrow: boolean,
): OverviewGroup[] {
    const cutoff = now - EARLIER_DAYS * 86_400_000;
    const days = new Map<string, MaterialItem[]>();
    const earlier: MaterialItem[] = [];
    const tree: MaterialItem[] = [];
    for (const item of items) {
        if (!shown(item)) continue;
        if (filters.batch && item.batch?.id !== filters.batch) continue;
        if (item.origin === 'tree') { tree.push(item); continue; }
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
        if (kind !== 'tree') {
            const names: string[] = [];
            let single = 0;
            for (const i of sorted) {
                if (i.batch) { if (!names.includes(i.batch.name)) names.push(i.batch.name); } else single++;
            }
            g.batchNames = names;
            g.looseCount = single;
        }
        groups.push(g);
    };
    for (const day of [...days.keys()].sort().reverse()) make(`d:${day}`, 'day', days.get(day)!, day);
    make('earlier', 'earlier', earlier);
    if (!filters.batch) make('tree', 'tree', tree);
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
            for (const folder of group.folders) {
                const fOpen = isOpen(folder.key);
                push({ type: 'folder', key: folder.key, top, height: m.folder, group, folder, open: fOpen });
                if (fOpen) content(group, folder.items, folder);
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

export interface ViewPrefs {
    group: OverviewGroupMode;
    view: OverviewView;
}

/** The remembered grouping and view (`localStorage['strom.materials.view']`). */
export function parseViewPrefs(raw: string | null | undefined): ViewPrefs {
    const prefs: ViewPrefs = { group: 'batch', view: 'grid' };
    try {
        const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
        if (parsed?.group === 'date') prefs.group = 'date';
        if (parsed?.view === 'list') prefs.view = 'list';
    } catch { /* not ours: the defaults */ }
    return prefs;
}
