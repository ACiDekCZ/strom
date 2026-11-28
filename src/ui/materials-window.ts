/**
 * The materials window (spec 017 §3): every file of the research and every
 * attachment of the tree, filtered, grouped by batch (with its folders) or by
 * the day received, as a grid or a list, with selecting several items.
 *
 * Built for 3000+ files: the content is a virtual list (rows of the grid or
 * of the list, absolutely placed; only rows near the view are in the DOM),
 * the groups' headers stick at the top, the filter and the search work over
 * the remembered list (debounced). Previews come lazily from the shared queue
 * (src/material-thumbs.ts) as tiles come into view.
 *
 * The pure part (items, filters, groups, rows) is src/materials-overview.ts.
 * The research's writes go through `materialAction` and opening an item
 * through `openMaterialItems` (src/ui/materials-ui.ts) — the viewer and the
 * dialogs replace those.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { imgSrcAttr } from '../image-src.js';
import { MENU_LOAD_LIMIT_MS, startMenuLoad, type MenuLoad } from './menu-load.js';
import { allMedia, treeMedia, mediaPersonIds } from '../media.js';
import { materialPersonLabel, mediaUsesIndex } from '../media-uses.js';
import type { PersonId } from '../types.js';
import { researchActionLabel } from './research-open-mark.js';
import type { UIClass } from './index.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { researchPersonRef, researchSchemeUrl, researchLinkMark, researchSourceRef } from '../research-link.js';
import { announcedResearchScheme, researchAutoState } from '../research-device.js';
import { PersonPicker } from '../person-picker.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE, MQ_TABLET } from '../breakpoints.js';
import {
    MaterialItem, MaterialList, MaterialBatch, MaterialError, MaterialActionId, MaterialCaps,
    cachedMaterials, primeMaterials, fetchMaterial, saveMaterialList, materialKindLabel, materialErrorText,
    materialType, materialDateForInput, MATERIAL_SORT_FEATURE, DELETE_MAX_FILES,
} from '../materials.js';
import {
    OverviewFilters, OverviewGroupMode, OverviewView, OverviewGroup, OverviewFolder, OverviewLayout, OverviewRow,
    RowMetrics, KindFilter, KIND_FILTERS, TreeRecord,
    emptyFilters, activeFilterCount, narrowing, overviewItems, overviewSummary, overviewGroups, overviewRows,
    rowsInView, stickyGroupAt, gridColumns, rangeKeys, personsShort, nameWithoutYears, parseViewPrefs,
    itemWithoutPerson, OverviewSummary, inMaterialFolder, firstFolderLine, ViewPrefs,
    ListSort, ListColumn, SortChoice, sortOverviewGroups, chooseSort, storedFilters, itemInTree, sourceOfPersons,
    WindowHeadAction, windowHeadMenu, dragCarriesFiles,
} from '../materials-overview.js';
import { materialThumbs, ThumbSnapshot } from '../material-thumbs.js';
import { imageLoads } from '../image-loads.js';
import { setTileState, waitingTileHtml } from './image-slot.js';
import { materialImageWait } from './materials-ui.js';
import {
    MaterialsOpenOptions, MaterialActionCtx, fileNameBreakParts, materialShortDate, materialStaleTime, materialTileLetters, materialItemSha, treeAttachmentsKey,
} from './materials-ui.js';
import { uiModule } from './module.js';
import type { SortStripView } from './material-sort-ui.js';
import { sortLacksPerson, sortLeftDecided, type SortStripState } from '../material-sort.js';
import { isPhoneBar } from '../breakpoints.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { barHtml } from './prog-bar.js';
import { selectionDeletable, treeFileSource, withoutTreeFiles } from '../material-delete.js';
import { formatBytesShort } from './originals-ui.js';
import { closeHeadMenu, openHeadMenu, SEP, type MenuEntry } from './table-view/table-headmenu.js';
import { materialScopeSource } from './search-scope-ui.js';

const MODAL_ID = 'materials-modal';

/** The files a closed proposal left in this browser's memory and why (spec 147 K6): a proposal closed tags them at once. */
function sortLeftKey(treeId: string): string {
    const left = researchAutoState(treeId).sortLeft ?? {};
    return Object.keys(left).sort().map(id => `${id}:${left[id]?.why ?? ''}`).join(',');
}
const VIEW_KEY = 'strom.materials.view';
const THUMB_PX = 256;
/** The tiles' sizes as drawn (a grid's tile, a list row's): "Not loaded" under the glyph only on the grid's (spec 116 §5). */
const MW_TILE_PX = 120;
const MW_SMALL_TILE_PX = 36;
const SEARCH_DEBOUNCE_MS = 150;
const LONG_PRESS_MS = 500;
/** Rows drawn above and below the view (px). */
const OVERSCAN = 480;


/**
 * A sort strip drawn anew (its progress, the proposal ready) keeps the focus
 * on its action: the same one, or the strip's first when that one is gone.
 */
const stripHtml = new WeakMap<HTMLElement, string>();
function setStripHtml(el: HTMLElement, html: string): void {
    if ((stripHtml.get(el) ?? el.innerHTML) === html) return;
    stripHtml.set(el, html);
    const had = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.sort ?? '' : null;
    el.innerHTML = html;
    if (had === null) return;
    const next = (had ? el.querySelector<HTMLElement>(`[data-sort="${CSS.escape(had)}"]`) : null) ?? el.querySelector<HTMLElement>('[data-sort]');
    next?.focus();
}
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function media(query: string): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Controls that take each other's place when redrawn (the focus moves to the pair). */
const FOCUS_PAIRS: Record<string, string> = {
    'clear-person': 'person', 'clear-kind': 'kind', 'clear-batch': 'batch', 'clear-files': 'files',
    'thumbs-pause': 'thumbs-resume', 'thumbs-resume': 'thumbs-pause', 'sel-hide': 'sel-restore', 'sel-restore': 'sel-hide',
};

/** Redraw a container, keeping the focus on the control with the same `data-mw` (or its pair). */
function redraw(el: HTMLElement, html: string): void {
    const active = document.activeElement as HTMLElement | null;
    const key = active && el.contains(active) ? active.dataset.mw : undefined;
    el.innerHTML = html;
    if (!key) return;
    const next = el.querySelector<HTMLElement>(`[data-mw="${key}"]`)
        ?? (FOCUS_PAIRS[key] ? el.querySelector<HTMLElement>(`[data-mw="${FOCUS_PAIRS[key]}"]`) : null);
    next?.focus();
}

/** The scroller's width for the content (without its side padding). */
function innerWidth(el: HTMLElement): number {
    const cs = getComputedStyle(el);
    return Math.max(0, el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
}

function readPrefs(): ViewPrefs {
    try {
        return parseViewPrefs(localStorage.getItem(VIEW_KEY));
    } catch {
        return parseViewPrefs(null);
    }
}

/** Remember the grouping (of its model: with an archive or the tree's own files) and the view. */
function writePrefs(group: OverviewGroupMode, view: OverviewView): void {
    const prefs = readPrefs();
    if (group === 'batch' || group === 'date') prefs.group = group;
    else prefs.appGroup = group;
    prefs.view = view;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(prefs)); } catch { /* blocked: this window only */ }
}

/** Remember the list's sort and the last filters (spec 102 §8). */
function writeListPrefs(sort: ListSort | null, filters: OverviewFilters): void {
    const prefs = readPrefs();
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ ...prefs, sort, filters: storedFilters(filters) })); } catch { /* blocked: this window only */ }
}

/** The window's model: the research's archive with the tree's files, or the tree's own files alone. */
type WindowModel = 'archive' | 'app';

type PopKind = 'person' | 'kind' | 'batch' | 'sheet' | 'batchMenu' | 'folderMenu' | 'selMenu' | 'headMenu' | 'itemMenu' | 'where';

/** A batch's reading: done, stopped (its menu closed, the window gone) or refused with the research's error. */
type BatchLoad = { ok: true } | { ok: false; stopped: true } | { ok: false; error: MaterialError; stopped?: undefined };

interface Win {
    gen: number;
    model: WindowModel;
    treeId: string;
    overlay: HTMLElement;
    scroller: HTMLElement;
    canvas: HTMLElement;
    sticky: HTMLElement;
    filters: OverviewFilters;
    group: OverviewGroupMode;
    view: OverviewView;
    /** The list's column sort (spec 102 §8f). */
    sort: ListSort | null;
    /** Groups and folders opened or closed by hand (others follow the defaults). */
    open: Map<string, boolean>;
    /** The batch the window was opened for (open by default). */
    focusBatch: string | null;
    selecting: boolean;
    selected: Set<string>;
    anchor: string | null;
    /** Where the last picked item is (the bar's "Select whole folder / batch"). */
    lastPick: { group: string; folder?: string } | null;
    focusKey: string | null;
    loadedBatches: Set<string>;
    /** Batches being read, each with its reading (a second ask waits for it). */
    loadingBatches: Map<string, Promise<BatchLoad>>;
    loading: boolean;
    loadError: MaterialError | null;
    /** The list the items were made from (a new answer is a new object). */
    list: MaterialList | null;
    items: MaterialItem[];
    groups: OverviewGroup[];
    layout: OverviewLayout;
    metrics: RowMetrics;
    rendered: Map<string, HTMLElement>;
    names: Map<string, string>;
    summary: OverviewSummary;
    io: IntersectionObserver | null;
    ro: ResizeObserver | null;
    unsubThumbs: (() => void) | null;
    searchTimer: ReturnType<typeof setTimeout> | null;
    raf: number;
    picker: PersonPicker | null;
    pop: HTMLElement | null;
    popKind: PopKind | null;
    popAnchor: HTMLElement | null;
    /** The family tree file whose menu is open (`itemMenu`). */
    popItem?: string;
    popKey: ((e: KeyboardEvent) => void) | null;
    popOutside: ((e: MouseEvent) => void) | null;
    /** The menu item reading its batch's files before its action (B88). */
    popLoad: MenuLoad | null;
    pressTimer: ReturnType<typeof setTimeout> | null;
    suppressClick: boolean;
    width: number;
    bridgeUp: boolean;
    /** The gates the window was drawn with (a poll that changes nothing redraws nothing). */
    drawnCaps: string;
    /** The tree's attachments its items were built from (see treeAttachmentsKey). */
    drawnAttachments: string;
    /** This browser's memory of the files a closed proposal left (sortLeft) the tags were drawn with (spec 147 K6). */
    drawnLeft: string;
    /** The one strip of sorting over the window (spec 102 §1) as drawn last. */
    sortView: SortStripView | null;
    /** The strip closed with its × (A, E): away while its state stays, back with the next state or the next opening. */
    sortClosedState: SortStripState | null;
    /** A batch just added here (its file count): state A says "N files added" (spec 102 §1, §8). */
    sortAdded: number;
}

interface SelAction {
    id: string;
    label: string;
    /** Offered, but not now: why. */
    why: string | null;
    /** The label with its mark (escaped HTML), when it carries one. */
    html?: string;
}

function capsKey(caps: MaterialCaps, base: string | null): string {
    return `${caps.list}|${caps.assign}|${caps.thumb}|${caps.bridgeUp}|${caps.openLinks !== false}|${caps.links}|${caps.edit}|${caps.uses}|${caps.sort}|${caps.sortRun}|${caps.sourceOf}|${caps.left}|${caps.sameAs}|${!!caps.decided}|${caps.delete}|${!!caps.trees}|${caps.mediaApp}|${base ?? ''}`;
}

let win: Win | null = null;
let generation = 0;

const alive = (gen: number): Win | null => (win && win.gen === gen ? win : null);

/**
 * Every file of the tree once, with its people as the overview's person keys
 * (`byRefn`: their REFN with an archive, people the research does not know
 * yet left out; else their PersonId) and how many places it is used in.
 */
export function treeRecords(byRefn: boolean): TreeRecord[] {
    // The files still on their way are the tree's too: their tiles wait for them (spec 116 §5).
    const data = imageLoads.view(DataManager.getData());
    const uses = mediaUsesIndex(data);
    const key = (id: PersonId): string | null => (byRefn ? researchPersonRef(DataManager.getPerson(id)?.refn) : id);
    // With an archive a file taken out of the tree stays with it (Hidden · Removed from the tree, spec 102 §9).
    const taken = byRefn ? allMedia(data).filter(a => !a.places?.length && !!a.removed && !!a.original?.sha256) : [];
    return [...treeMedia(data), ...taken].map(att => {
        const used = uses.get(att.id) ?? [];
        const src = used.find(u => u.kind === 'source' || u.kind === 'excerpt');
        const source = src?.sourceId ? (data.sources?.[src.sourceId]?.title || strings.materials.unknownSource) : undefined;
        // The research's ids of its sources, not counted again as the file of a source (spec 102 §7).
        const sourceRefs = byRefn ? [...new Set(used.filter(u => u.kind === 'source' || u.kind === 'excerpt')
            .map(u => researchSourceRef(data.sources?.[u.sourceId ?? '']?.refn)).filter((r): r is string => !!r))] : [];
        return {
            att,
            persons: mediaPersonIds(att.places.length ? att : { places: att.removed?.places ?? [] }).map(key).filter((k): k is string => !!k),
            uses: used.length,
            ...(source ? { source } : {}),
            ...(sourceRefs.length ? { sourceRefs } : {}),
        };
    });
}

/** Person key → name: REFN (the tree's person first, else what the research calls them), or PersonId without an archive. */
function namesOf(list: MaterialList | null, model: WindowModel): Map<string, string> {
    const names = new Map<string, string>();
    if (model === 'app') {
        for (const p of DataManager.getAllPersons()) names.set(p.id, materialPersonLabel(`${p.firstName} ${p.lastName}`));
        return names;
    }
    for (const [refn, name] of Object.entries(list?.people ?? {})) names.set(refn, materialPersonLabel(name));
    for (const p of DataManager.getAllPersons()) {
        const refn = researchPersonRef(p.refn);
        if (!refn) continue;
        const own = `${p.firstName} ${p.lastName}`.trim();
        names.set(refn, own && own !== '?' ? own : names.get(refn) ?? materialPersonLabel(own));
    }
    return names;
}

function emptyLayout(): OverviewLayout {
    return { rows: [], height: 0, order: [], rowOf: new Map() };
}

export const materialsWindowMethods = uiModule({
    /** Fill the window `openMaterials` just put up (called once per opening). */
    initMaterialsWindow(opts: { group?: MaterialsOpenOptions['group']; person: string | null; batch: string | null; files?: string[] }): void {
        this.teardownMaterialsWindow();
        const overlay = document.getElementById(MODAL_ID);
        const body = overlay?.querySelector<HTMLElement>('#materials-window-body');
        const ctx = this.materialsWindowContext();
        if (!overlay || !body || !ctx) return;
        const prefs = readPrefs();
        const model: WindowModel = ctx.caps.list ? 'archive' : 'app';
        const group: OverviewGroupMode = opts.group ?? (model === 'app' ? prefs.appGroup : prefs.group);
        overlay.dataset.group = group;
        body.innerHTML = `
            <div class="mw-status" hidden></div>
            <div class="mw-sort mw-sort--top" role="status" hidden></div>
            <div class="mw-lhead" hidden></div>
            <div class="mw-scroll">
                <div class="mw-sticky"></div>
                <div class="mw-empty" hidden></div>
                <div class="mw-canvas" role="grid" aria-labelledby="materials-title"></div>
            </div>
            <div class="mw-foot">
                <div class="mw-skipped" role="note" hidden></div>
                <div class="mw-thumbs" role="status" hidden></div>
                <div class="mw-bulk" role="status" hidden></div>
                <div class="mw-selbar" role="region" hidden></div>
            </div>`;
        // The last filters come back (spec 102 §8), except for a window opened for a person or a batch.
        const filters: OverviewFilters = { ...emptyFilters(), ...(opts.person || opts.batch || opts.files ? {} : prefs.filters) };
        if (model === 'app') filters.where = null;
        filters.person = opts.person;
        filters.batch = opts.batch;
        if (opts.files?.length) filters.files = opts.files;
        const w: Win = {
            gen: ++generation,
            model,
            treeId: ctx.treeId,
            overlay,
            scroller: body.querySelector<HTMLElement>('.mw-scroll')!,
            canvas: body.querySelector<HTMLElement>('.mw-canvas')!,
            sticky: body.querySelector<HTMLElement>('.mw-sticky')!,
            filters,
            group,
            view: prefs.view,
            sort: prefs.sort,
            open: new Map(),
            focusBatch: opts.batch,
            selecting: false,
            selected: new Set(),
            anchor: null,
            lastPick: null,
            focusKey: null,
            loadedBatches: new Set(),
            loadingBatches: new Map(),
            loading: false,
            loadError: null,
            list: null,
            items: [],
            groups: [],
            layout: emptyLayout(),
            metrics: { view: 'grid', cols: 1, tileRow: 180, restoreExtra: 28, listRow: 48, group: 56, folder: 36, skeleton: 180, groupEnd: 12 },
            rendered: new Map(),
            names: new Map(),
            summary: { files: 0, batches: 0, noPerson: 0, hidden: 0, noTitle: 0, noSource: 0, inTree: 0, onlyArchive: 0, left: 0 },
            io: null,
            ro: null,
            unsubThumbs: null,
            searchTimer: null,
            raf: 0,
            picker: null,
            pop: null,
            popKind: null,
            popAnchor: null,
            popKey: null,
            popOutside: null,
            popLoad: null,
            pressTimer: null,
            suppressClick: false,
            width: 0,
            bridgeUp: ctx.caps.bridgeUp,
            drawnCaps: '',
            drawnAttachments: '',
            drawnLeft: '',
            sortView: null,
            sortClosedState: null,
            sortAdded: 0,
        };
        win = w;
        const thumbs = materialThumbs();
        thumbs.resetFailures();
        w.unsubThumbs = thumbs.subscribe(s => this.mwThumbStrip(s));
        if (typeof IntersectionObserver === 'function') {
            w.io = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    const el = entry.target as HTMLElement;
                    el.dataset.vis = entry.isIntersecting ? '1' : '0';
                    if (entry.isIntersecting) this.mwWantThumb(el);
                }
            }, { root: w.scroller, rootMargin: '200px' });
        }
        if (typeof ResizeObserver === 'function') {
            w.ro = new ResizeObserver(() => {
                const now = alive(w.gen);
                if (now && innerWidth(now.scroller) !== now.width) this.mwRebuild();
            });
            w.ro.observe(w.scroller);
        }
        this.mwWireHeader();
        this.mwWireBody();
        this.mwWireDrop();
        this.mwRebuild({ items: true });
        void primeMaterials(ctx.treeId).then(() => {
            if (!alive(w.gen)) return;
            // The cache read: drawn again only when it brought something the window shows. Otherwise the
            // tiles stay (redrawn, each one was replaced just after the window opened, under a finger or a pointer).
            const now = this.materialsWindowContext();
            const rec = w.model === 'archive' ? cachedMaterials(w.treeId) : null;
            if (now && (capsKey(now.caps, now.base) !== w.drawnCaps || (rec?.list ?? null) !== w.list
                || treeAttachmentsKey() !== w.drawnAttachments)) this.mwRebuild({ items: true });
            void this.mwLoad();
        });
    },

    teardownMaterialsWindow(): void {
        const w = win;
        if (!w) return;
        this.mwClosePop();
        closeHeadMenu();
        w.io?.disconnect();
        w.ro?.disconnect();
        w.unsubThumbs?.();
        if (w.searchTimer) clearTimeout(w.searchTimer);
        if (w.pressTimer) clearTimeout(w.pressTimer);
        if (w.raf) cancelAnimationFrame(w.raf);
        win = null;
    },

    /** Esc in the window: a popover first (its own handler), then the selection, then the window. */
    materialsEscape(): void {
        if (win?.selecting) {
            this.clearMaterialsSelection();
            return;
        }
        this.closeMaterials();
    },

    /** Leave selecting (after a successful action, Esc, "Clear selection", "Done"). */
    clearMaterialsSelection(): void {
        const w = win;
        if (!w) return;
        w.selecting = false;
        w.selected.clear();
        w.anchor = null;
        this.mwSelectionChanged();
    },

    /** The window's selected items (in display order). */
    materialsSelection(): MaterialItem[] {
        const w = win;
        if (!w) return [];
        return w.items.filter(i => w.selected.has(i.key) && !this.mwWaits(i));
    },

    /** The remembered list or the bridge changed: redraw (quietly), ask again once the bridge runs. */
    refreshMaterialsWindow(): void {
        // The agent's proposal open over it shows the files as they are now (hidden, restored).
        this.materialSortProposalRefresh();
        const w = win;
        if (!w || !document.getElementById(MODAL_ID)) return;
        const ctx = this.materialsWindowContext();
        if (!ctx || ctx.treeId !== w.treeId) return;
        const cameUp = ctx.caps.bridgeUp && !w.bridgeUp;
        w.bridgeUp = ctx.caps.bridgeUp;
        // Add materials… comes and goes with the research's batches and the tree's lock (spec 102 §8).
        const addBtn = w.overlay.querySelector<HTMLElement>('.mw-add');
        if (addBtn) addBtn.hidden = !this.materialsAddOffered();
        // The agent's sorting moves on its own (its progress, its proposal ready).
        this.mwSortStrip();
        const changed = capsKey(ctx.caps, ctx.base) !== w.drawnCaps || (cachedMaterials(w.treeId)?.list ?? null) !== w.list
            || treeAttachmentsKey() !== w.drawnAttachments || sortLeftKey(w.treeId) !== w.drawnLeft;
        if (changed && !w.raf) {
            w.raf = requestAnimationFrame(() => {
                w.raf = 0;
                if (!alive(w.gen)) return;
                this.mwRebuild({ items: treeAttachmentsKey() !== w.drawnAttachments });
            });
        }
        if (cameUp) {
            w.loadError = null;
            materialThumbs().resetFailures();
            void this.mwLoad();
        }
    },

    // ==================== LOADING ====================

    /** Batches and people, the open batches' files, then the whole list in the background. */
    async mwLoad(): Promise<void> {
        const w = win;
        const ctx = this.materialsWindowContext();
        if (!w || w.loading || !ctx?.caps.list || !ctx.caps.bridgeUp || !ctx.base) return;
        const gen = w.gen;
        const base = ctx.base;
        w.loading = true;
        w.loadError = null;
        try {
            const head = await fetchMaterial(base, { files0: true, trees: ctx.caps.trees });
            if (!alive(gen)) return;
            if (!head.ok) {
                w.loadError = head.error;
                return;
            }
            await saveMaterialList(w.treeId, head.value, { kind: 'files0' });
            if (!alive(gen)) return;
            this.mwRebuild();
            for (const id of this.mwOpenPendingBatches()) {
                await this.mwLoadBatch(id);
                if (!alive(gen)) return;
            }
            const all = await fetchMaterial(base, { trees: ctx.caps.trees });
            if (!alive(gen)) return;
            if (all.ok) await saveMaterialList(w.treeId, all.value, { kind: 'all' });
        } finally {
            const now = alive(gen);
            if (now) {
                now.loading = false;
                this.mwRebuild();
            }
        }
    },

    /** The batch's files are known (the whole list, or the batch read). */
    mwBatchKnown(id: string): boolean {
        const w = win;
        return !w || !!cachedMaterials(w.treeId)?.full || w.loadedBatches.has(id);
    },

    /**
     * One batch's files (`?batch=`), unless the whole list is known. A reading already under way is waited for
     * (B88: a menu's action does not go on with half the batch); `signal` stops the waiting (its menu closed).
     */
    async mwLoadBatch(id: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<BatchLoad> {
        const w = win;
        const ctx = this.materialsWindowContext();
        if (!w || !ctx?.caps.bridgeUp || !ctx.base) return { ok: true };
        if (this.mwBatchKnown(id)) return { ok: true };
        const gen = w.gen;
        const base = ctx.base;
        let reading = w.loadingBatches.get(id);
        if (!reading) {
            reading = (async (): Promise<BatchLoad> => {
                try {
                    const answer = await fetchMaterial(base, { batch: id, trees: ctx.caps.trees }, { signal: opts.signal, timeoutMs: opts.timeoutMs });
                    if (!alive(gen)) return { ok: false, stopped: true };
                    if (!answer.ok) return opts.signal?.aborted ? { ok: false, stopped: true } : { ok: false, error: answer.error };
                    w.loadedBatches.add(id);
                    await saveMaterialList(w.treeId, answer.value, { kind: 'batch', batch: id });
                    return { ok: true };
                } finally {
                    alive(gen)?.loadingBatches.delete(id);
                }
            })();
            w.loadingBatches.set(id, reading);
        }
        const signal = opts.signal;
        if (!signal) return reading;
        if (signal.aborted) return { ok: false, stopped: true };
        return Promise.race([reading, new Promise<BatchLoad>(resolve => {
            signal.addEventListener('abort', () => resolve({ ok: false, stopped: true }), { once: true });
        })]);
    },

    /** Open batches whose files are not known yet. */
    mwOpenPendingBatches(): string[] {
        const w = win;
        if (!w) return [];
        return w.groups.filter(g => g.pending && g.batch && this.mwIsOpen(g.key)).map(g => g.batch!.id);
    },

    // ==================== STATE → DRAWING ====================

    mwIsOpen(key: string): boolean {
        const w = win;
        if (!w) return false;
        const set = w.open.get(key);
        if (set !== undefined) return set;
        if (narrowing(w.filters) || w.group !== 'batch') return true;
        // The batch it was opened for, else the first group; a batch's first folder with it
        // (and down its line while a folder holds only folders).
        const first = w.groups.find(g => w.focusBatch ? g.batch?.id === w.focusBatch : true) ?? w.groups[0];
        if (!first) return false;
        if (key === first.key) return true;
        return firstFolderLine(first).includes(key);
    },

    mwMetrics(): RowMetrics {
        const w = win!;
        const phone = media(MQ_MOBILE);
        const land = media(MQ_PHONE_LANDSCAPE);
        const coarse = media('(pointer: coarse)');
        w.width = innerWidth(w.scroller);
        const width = Math.max(120, w.width);
        const compact = phone || land;
        const gap = phone ? 6 : land ? 8 : 12;
        // A tablet (641–1024) gets larger tiles for a finger: 5 columns at 1024 (spec 102 §11).
        const tablet = !land && media(MQ_TABLET);
        const cols = phone ? 3 : gridColumns(width, land ? 88 : tablet ? 176 : 124, gap);
        const tile = (width - gap * (cols - 1)) / cols;
        // Under a tile: its name (2 lines) and its people; nothing on a phone (the name is in the viewer).
        const text = compact ? 0 : 57;
        const tileRow = Math.round(tile + text + gap);
        return {
            view: w.view,
            cols,
            tileRow,
            restoreExtra: 26,
            // Two more lines under a family tree file: "File of a source · Family tree file · 184 kB" whole (spec 117 §5, 5a).
            treeExtra: compact ? 0 : 30,
            listRow: coarse ? 56 : 48,
            group: coarse ? 60 : 56,
            folder: coarse ? 44 : 36,
            skeleton: w.view === 'grid' ? tileRow : 96,
            groupEnd: 12,
        };
    },

    /** Recompute what is shown from the state (items again when the list changed) and draw it. */
    mwRebuild(opts: { items?: boolean } = {}): void {
        const w = win;
        const ctx = this.materialsWindowContext();
        if (!w || !ctx) return;
        const model: WindowModel = ctx.caps.list ? 'archive' : 'app';
        if (model !== w.model) {
            // A research came or went while open: the other model's grouping and filters.
            w.model = model;
            const prefs = readPrefs();
            w.group = model === 'app' ? prefs.appGroup : prefs.group;
            w.filters = { ...emptyFilters(), query: w.filters.query };
            w.focusBatch = null;
            opts = { ...opts, items: true };
        }
        const rec = model === 'archive' ? cachedMaterials(w.treeId) : null;
        const list = rec?.list ?? null;
        if (opts.items || list !== w.list) {
            w.list = list;
            w.drawnAttachments = treeAttachmentsKey();
            w.items = overviewItems(list, treeRecords(model === 'archive'), { sourceOf: model === 'archive' && ctx.caps.sourceOf });
            w.names = namesOf(list, model);
            const keys = new Set(w.items.map(i => i.key));
            for (const k of [...w.selected]) if (!keys.has(k)) w.selected.delete(k);
        }
        // A research without assigning never sends hidden files; "Show hidden" is not offered.
        if (!ctx.caps.assign) w.filters.showHidden = false;
        this.mwSortMarks();
        w.drawnLeft = sortLeftKey(w.treeId);
        w.summary = overviewSummary(w.items, list, !!rec?.full);
        // "Not assigned by the agent" is offered only while there is such a file: its filter goes with the last one.
        if (!w.summary.left) w.filters.left = false;
        w.groups = overviewGroups({
            items: w.items, list, filters: w.filters, mode: w.group,
            batchLoaded: id => !!rec?.full || w.loadedBatches.has(id),
            personName: key => w.names.get(key) ?? null,
        });
        // One sort for the grid and the list (the viewer and Go through follow the groups' order).
        sortOverviewGroups(w.groups, w.sort, { personName: key => w.names.get(key) ?? null, kindLabel: materialKindLabel });
        w.drawnCaps = capsKey(ctx.caps, ctx.base);
        w.metrics = this.mwMetrics();
        w.layout = overviewRows(w.groups, key => this.mwIsOpen(key), w.metrics);
        w.overlay.dataset.group = w.group;
        w.overlay.dataset.model = model;
        w.overlay.classList.toggle('can-select', this.mwCanSelect());
        w.overlay.classList.toggle('is-selecting', w.selecting);
        w.overlay.classList.toggle('is-list', w.view === 'list');
        this.mwHeader();
        this.mwTools();
        this.mwStatus();
        this.mwSortStrip();
        this.mwListHead();
        const empty = this.mwEmpty();
        w.canvas.hidden = empty === 'skeleton';
        w.canvas.style.height = `${w.layout.height}px`;
        w.canvas.setAttribute('aria-multiselectable', w.selecting ? 'true' : 'false');
        w.canvas.setAttribute('aria-rowcount', String(w.layout.rows.length));
        this.mwRenderRows(true);
        this.mwSelectionChanged(false);
        materialThumbs().setEnv({ treeId: w.treeId, base: ctx.base, thumb: ctx.caps.thumb, bridgeUp: ctx.caps.bridgeUp });
        this.mwThumbStrip(materialThumbs().snapshot());
        for (const id of this.mwOpenPendingBatches()) void this.mwLoadBatch(id);
    },

    /**
     * The files the agent left unassigned and the copies of an older file
     * (spec 102 §4.2, §4.4), marked on the items that still lack a title or a
     * person: their tag in the tile and the row, the filter "Not assigned by
     * the agent". Only beside a research that sorts.
     */
    mwSortMarks(): void {
        const w = win!;
        const marks = w.model === 'archive' && this.materialSortGate() ? this.materialSortMarks(w.items) : null;
        for (const i of w.items) {
            delete i.agentLeft;
            delete i.sortDecided;
            delete i.copyOf;
            // The file of a source is assigned (spec 102 §7): no "Not assigned by the agent", no copy tag.
            if (!marks || !i.file || i.hidden || i.sourceOf?.length || (i.titled && !sortLacksPerson(i))) continue;
            const left = marks.left.get(i.file.id);
            // A proposal a person accepted or rejected is no "Not assigned by the agent" (spec 147 K6).
            const decided = sortLeftDecided(left?.why);
            if (decided) i.sortDecided = decided;
            else if (left) i.agentLeft = { ...left };
            const copy = marks.copyOf.get(i.file.id);
            if (copy) i.copyOf = copy;
        }
    },

    /** The tag before the people of a tile or a row: the agent left it unassigned, or it is a copy (spec 102 §4). */
    mwSortTagHtml(item: MaterialItem): string {
        const s = strings.materials.agentSort;
        const tag = this.mwSortTag(item);
        const kind = item.agentLeft ? 'left' : item.sortDecided ? item.sortDecided : 'copy';
        return tag ? `<span class="mw-intree-tag mw-sort-tag" data-tag="${kind}">${esc(tag)}</span>` : '';
    },

    /** The sorting's tag of a file: left by the agent, its proposal accepted or rejected (spec 147 K6), a copy; '' none. */
    mwSortTag(item: MaterialItem): string {
        const s = strings.materials.agentSort;
        return item.agentLeft ? s.tagLeft : item.sortDecided === 'accepted' ? s.tagAccepted : item.sortDecided === 'refused' ? s.tagRefused
            : item.copyOf ? s.tagCopy : '';
    },

    /** "File of a source" / "File of 2 sources" (spec 102 §7), '' for any other file. */
    mwSourceOfTag(item: MaterialItem): string {
        const n = item.sourceOf?.length ?? 0;
        return n ? strings.materials.agentSort.sourceOfN(n) : '';
    },

    /** The header's counts (or "Loading…"). */
    mwHeader(): void {
        const w = win!;
        const ctx = this.materialsWindowContext();
        const el = w.overlay.querySelector<HTMLElement>('.mw-summary');
        if (!el || !ctx) return;
        const m = strings.materials;
        const rec = cachedMaterials(w.treeId);
        const s = w.summary;
        let text = '';
        if (w.model === 'app') text = w.filters.noPerson ? m.summaryNoPerson(s.noPerson, s.files) : m.summaryApp(s.files, s.noPerson);
        else if (!rec) text = ctx.caps.bridgeUp && !w.loadError ? m.loading : '';
        else if (w.filters.noPerson) text = m.summaryNoPerson(s.noPerson, s.files);
        else text = `${m.summary(s.files, s.batches, s.noPerson)}${w.filters.showHidden ? ` ${m.summaryHidden(s.hidden)}` : ''}`;
        el.textContent = text;
        el.title = text;
    },

    /** Filters, grouping, view and "Select" (the search field stays, it keeps its focus). */
    mwTools(): void {
        const w = win!;
        const ctx = this.materialsWindowContext();
        const tools = w.overlay.querySelector<HTMLElement>('.mw-tools');
        if (!tools || !ctx) return;
        const m = strings.materials;
        const f = w.filters;
        const chip = (act: string, label: string, active: string | null, popup = true) => active
            ? `<span class="mw-chip sel-opt is-active"><button type="button" class="mw-chip-main" data-mw="${act}"${popup ? ' aria-haspopup="dialog"' : ''}>${esc(active)}</button><button type="button" class="mw-chip-x" data-mw="clear-${act}" aria-label="${esc(`${m.removeFilter}: ${active}`)}">×</button></span>`
            : `<button type="button" class="mw-chip sel-opt" data-mw="${act}" aria-haspopup="dialog">${esc(label)} <span aria-hidden="true">▾</span></button>`;
        const personName = f.person ? nameWithoutYears(w.names.get(f.person) ?? f.person) : '';
        const kindLabel = (k: KindFilter) => (k === 'none' ? m.kindNone : k === 'tree' ? m.kindTrees : m.kind[k] ?? k);
        const batchName = f.batch ? (w.list?.batches.find(b => b.id === f.batch)?.name ?? f.batch) : '';
        const count = activeFilterCount(f);
        const toggle = (act: string, label: string, on: boolean) =>
            `<button type="button" class="mw-chip sel-opt mw-toggle${on ? ' is-active' : ''}" data-mw="${act}" aria-pressed="${on}">${esc(label)}</button>`;
        const seg = (cls: string, aria: string, opts: { act: string; label: string; icon?: string; on: boolean }[]) =>
            `<div class="mw-seg ${cls} sel-seg" role="group" aria-label="${esc(aria)}">${opts.map(o =>
                `<button type="button" class="sel-opt" data-sel-form="seg" data-mw="${o.act}" aria-pressed="${o.on}"${o.icon ? ` aria-label="${esc(o.label)}" title="${esc(o.label)}"` : ''}>${o.icon ? `<span class="mw-seg-icon" aria-hidden="true">${o.icon}</span>` : ''}<span class="mw-seg-text">${esc(o.label)}</span></button>`).join('')}</div>`;
        redraw(tools, `
            <div class="mw-chips">
                ${f.files?.length ? chip('files', m.fFiles, m.filterChip(m.fFiles, f.files.length.toLocaleString(getCurrentLanguage())), false) : ''}
                ${chip('person', m.fPerson, f.person ? m.filterChip(m.fPerson, personName) : null)}
                ${chip('kind', m.fKind, f.kinds.length ? m.filterChip(m.fKind, f.kinds.map(kindLabel).join(', ')) : null)}
                ${w.model === 'archive' ? chip('batch', m.fBatch, f.batch ? m.filterChip(m.fBatch, batchName) : null) : ''}
                ${toggle('noperson', `${m.noPerson} · ${w.summary.noPerson.toLocaleString(getCurrentLanguage())}`, f.noPerson)}
                ${ctx.caps.assign ? toggle('hidden', m.showHidden, f.showHidden) : ''}
                ${count ? `<button type="button" class="link-button mw-clear" data-mw="clear">${esc(m.clearFilters)}</button>` : ''}
            </div>
            <div class="mw-tools-row2">
                ${this.mwReviewChips(toggle)}
                <span class="mw-gap"></span>
                ${this.mwSortChipHtml()}
            </div>
            <button type="button" class="mw-chip sel-opt mw-filters-btn${count ? ' is-active' : ''}" data-mw="sheet" aria-haspopup="dialog">${esc(count ? m.filters(count) : m.filtersTitle)}</button>
            <span class="mw-gap"></span>
            ${seg('mw-seg-group', m.groupBy, w.model === 'app' ? [
                { act: 'group-added', label: m.groupAdded, on: w.group === 'added' },
                { act: 'group-person', label: m.groupPerson, on: w.group === 'person' },
            ] : [
                { act: 'group-batch', label: m.groupBatch, on: w.group === 'batch' },
                { act: 'group-date', label: m.groupDate, on: w.group === 'date' },
            ])}
            ${seg('mw-seg-view', m.viewAs, [
                { act: 'view-grid', label: m.grid, icon: '▦', on: w.view === 'grid' },
                { act: 'view-list', label: m.list, icon: '☰', on: w.view === 'list' },
            ])}
            ${this.mwCanSelect() ? `<button type="button" class="mw-chip sel-opt mw-select${w.selecting ? ' is-active' : ''}" data-mw="select" aria-pressed="${w.selecting}">${esc(w.selecting ? m.done : m.select)}</button>` : ''}`);
    },

    /**
     * The review filters with their counts (spec 102 §8a): Without title,
     * Without source | In the tree, Only in the archive (beside an archive).
     */
    mwReviewChips(toggle: (act: string, label: string, on: boolean) => string, cls = 'mw-chips mw-chips-review'): string {
        const w = win!;
        const m = strings.materials;
        const f = w.filters;
        const s = w.summary;
        const where = w.model === 'archive'
            ? `<span class="mw-chips-sep" aria-hidden="true"></span>
                ${toggle('where-tree', m.filterCount(m.fInTree, s.inTree), f.where === 'tree')}
                ${toggle('where-archive', m.filterCount(m.fOnlyArchive, s.onlyArchive), f.where === 'archive')}`
            : '';
        return `<div class="${cls}" role="group" aria-label="${esc(m.filtersTitle)}">
                ${toggle('notitle', m.filterCount(m.fNoTitle, s.noTitle), f.noTitle)}
                ${toggle('nosource', m.filterCount(m.fNoSource, s.noSource), f.noSource)}
                ${where}
                ${s.left ? `<span class="mw-chips-sep" aria-hidden="true"></span>
                ${toggle('left', m.filterCount(m.agentSort.fLeft, s.left), f.left)}` : ''}
            </div>`;
    },

    /** The strip above the content: not running (with the time), or the list's error. */
    mwStatus(): void {
        const w = win!;
        const ctx = this.materialsWindowContext();
        const el = w.overlay.querySelector<HTMLElement>('.mw-status');
        if (!el || !ctx) return;
        const m = strings.materials;
        const rec = cachedMaterials(w.treeId);
        const start = this.researchStartUrl() ? `<button type="button" class="link-button materials-start" data-mw="start">${this.researchSyncActionLabel('startResearch', strings.sync.startResearch)}</button>` : '';
        let html = '';
        let state = 'live';
        if (w.model === 'app') {
            // A tree beside a research on a phone or a tablet: its own files here, the archive's on the computer (spec 102 §11f).
            const linked = this.materialsTouchLinked() ? this.materialsContext() : null;
            // Sorting with the agent says itself in the strip of sorting (spec 102 §11).
            const note = linked ? (linked.agent ? m.desktopOnlyResearch : m.desktopOnly) : '';
            w.overlay.dataset.state = 'live';
            el.hidden = !note;
            el.setAttribute('role', 'note');
            el.innerHTML = note ? `<span class="mw-status-note">${esc(note)}</span>` : '';
            return;
        }
        if (rec && !ctx.caps.bridgeUp) {
            state = 'stale';
            // What can be edited now: the tree's files (written with the tree), not the material outside it (spec 102 §12a).
            html = `<span>${esc(m.staleEdit(materialStaleTime(rec.list.fetchedAt || Date.now())))}</span>${start}`;
        } else if (w.loadError && ctx.caps.bridgeUp) {
            state = 'error';
            html = `<span>${esc(materialErrorText(w.loadError, ctx.agent))}</span><button type="button" class="link-button materials-start" data-mw="retry">${esc(m.retry)}</button>`;
        }
        w.overlay.dataset.state = !rec && !ctx.caps.bridgeUp ? 'nocache' : !rec ? 'loading' : state;
        el.hidden = !html;
        el.setAttribute('role', 'status');
        el.innerHTML = html;
    },

    /**
     * The one strip of sorting over the list (spec 102 §1): the state of the
     * whole archive, with a filter or a search too. On a phone (and a phone
     * held sideways) the state only (§11); a tree beside a research on a
     * phone or a tablet says that sorting is on the computer.
     */
    mwSortStrip(): void {
        const w = win;
        const el = w?.overlay.querySelector<HTMLElement>('.mw-sort--top');
        if (!w || !el) return;
        const s = strings.materials.agentSort;
        let view: SortStripView | null = null;
        let html = '';
        let mod = '';
        if (w.model === 'app') {
            // A research whose agent sorts: that and its proposal are on the computer (spec 102 §13l, §11).
            const linked = this.materialsTouchLinked() ? this.materialsContext() : null;
            if (linked?.agent && linked.env.features?.includes(MATERIAL_SORT_FEATURE)) {
                html = `<span class="mw-sort-text"><span class="mw-sort-note mw-sort-phone">${esc(s.phone)}</span><span class="mw-sort-note mw-sort-phone-short">${esc(s.phoneShort)}</span></span>`;
                mod = 'is-off';
            }
        } else {
            view = this.materialSortStripView(w.items, { phone: isPhoneBar(), added: w.sortAdded });
            // "N files added" is A's only: once the sorting moved on, A says the whole archive again.
            if (view.state && view.state !== 'A') w.sortAdded = 0;
            // Closed with its ×: back once the state is another one.
            if (w.sortClosedState && view.state !== w.sortClosedState) w.sortClosedState = null;
            if (!(view.state && view.state === w.sortClosedState)) { html = view.html; mod = view.mod; }
        }
        w.sortView = view;
        el.hidden = !html;
        for (const c of ['is-done', 'is-off', 'is-error']) el.classList.toggle(c, c === mod);
        el.dataset.state = html ? view?.state ?? '' : '';
        // A batch of a run that did not run is said at once (spec 102 §3); the other states as a status.
        const role = view?.state === 'error' && html ? 'alert' : 'status';
        if (el.getAttribute('role') !== role) el.setAttribute('role', role);
        setStripHtml(el, html);
        el.onclick = (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-sort]');
            if (!btn || !view) return;
            if (btn.dataset.sort === 'close') { this.mwSortWholeClose(); return; }
            if (btn.dataset.sort === 'review') { this.mwReview(view.review); return; }
            this.materialSortStripClick(e, view);
        };
    },

    /** The strip closed (×, states A and E): away while its state stays; the focus goes on to the files. */
    mwSortWholeClose(): void {
        const w = win;
        if (!w) return;
        const state = w.sortView?.state;
        w.sortClosedState = state === 'A' || state === 'E' ? state : null;
        this.mwSortStrip();
        const next = w.canvas.querySelector<HTMLElement>('[tabindex="0"]') ?? w.overlay.querySelector<HTMLElement>('.mw-search');
        next?.focus();
    },

        /** Nothing to show: loading (skeleton), not running without memory, no files at all (the tree's own), or no match. */
    mwEmpty(): 'skeleton' | 'nocache' | 'none' | 'nomatch' | null {
        const w = win!;
        const ctx = this.materialsWindowContext();
        const el = w.overlay.querySelector<HTMLElement>('.mw-empty');
        if (!el || !ctx) return null;
        const m = strings.materials;
        const rec = w.model === 'app' ? null : cachedMaterials(w.treeId);
        let kind: 'skeleton' | 'nocache' | 'none' | 'nomatch' | null = null;
        let html = '';
        if (w.model === 'app') {
            if (w.items.length === 0 && !activeFilterCount(w.filters) && !w.filters.query) {
                kind = 'none';
                html = `<span class="mw-empty-file" aria-hidden="true">JPG</span><h3 class="mw-empty-title">${esc(m.emptyTreeTitle)}</h3><p>${esc(m.emptyTreeText)}</p><p class="mw-empty-where">${esc(m.whereApp)}</p>`;
            } else if (w.groups.length === 0) {
                kind = 'nomatch';
                html = `<p>${esc(m.noMatch)}</p>${activeFilterCount(w.filters) || w.filters.query ? `<button type="button" class="link-button" data-mw="clear">${esc(m.clearFilters)}</button>` : ''}`;
            }
        } else if (!rec && ctx.caps.bridgeUp && !w.loadError) {
            kind = 'skeleton';
            const square = '<span class="mw-skel-tile"></span>';
            const head = '<div class="mw-skel-head"><span></span><span></span></div>';
            html = `${head}<div class="mw-skel-row">${square.repeat(5)}</div>${head}${head}`;
        } else if (!rec && !ctx.caps.bridgeUp) {
            kind = 'nocache';
            const start = this.researchStartUrl() ? `<button type="button" class="primary btn-sm" data-mw="start">${this.researchSyncActionLabel('startResearch', strings.sync.startResearch)}</button>` : '';
            html = `<p>${esc(m.loadWhenRunning)}</p>${start}`;
        } else if (rec && w.groups.length === 0) {
            kind = 'nomatch';
            html = `<p>${esc(m.noMatch)}</p>${activeFilterCount(w.filters) || w.filters.query ? `<button type="button" class="link-button" data-mw="clear">${esc(m.clearFilters)}</button>` : ''}`;
        }
        el.hidden = !kind;
        el.className = `mw-empty${kind ? ` is-${kind}` : ''}`;
        el.setAttribute('aria-hidden', kind === 'skeleton' ? 'true' : 'false');
        el.innerHTML = html;
        w.overlay.classList.toggle('is-bare', kind === 'none');
        return kind;
    },

    // ==================== THE VIRTUAL LIST ====================

    /** Draw the rows near the view (`force`: the layout changed, draw them anew). */
    mwRenderRows(force = false): void {
        const w = win;
        if (!w) return;
        const hadFocus = force && w.canvas.contains(document.activeElement);
        if (force) {
            for (const el of w.rendered.values()) {
                el.querySelectorAll('.mw-thumb[data-sha]').forEach(t => w.io?.unobserve(t));
                el.remove();
            }
            w.rendered.clear();
        }
        const top = w.scroller.scrollTop - w.canvas.offsetTop;
        const { rows } = w.layout;
        const { start, end } = rowsInView(rows, top - OVERSCAN, top + w.scroller.clientHeight + OVERSCAN);
        const keep = new Set<string>();
        const fragment = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
            const row = rows[i];
            keep.add(row.key);
            if (w.rendered.has(row.key)) continue;
            const el = this.mwRowElement(row, i);
            w.rendered.set(row.key, el);
            fragment.appendChild(el);
        }
        for (const [key, el] of w.rendered) {
            if (keep.has(key)) continue;
            el.querySelectorAll('.mw-thumb[data-sha]').forEach(t => w.io?.unobserve(t));
            el.remove();
            w.rendered.delete(key);
        }
        w.canvas.appendChild(fragment);
        w.canvas.querySelectorAll<HTMLElement>('.mw-thumb[data-sha]:not([data-obs])').forEach(t => {
            t.dataset.obs = '1';
            if (w.io) w.io.observe(t); else { t.dataset.vis = '1'; this.mwWantThumb(t); }
        });
        this.mwRoving();
        this.mwSticky();
        if (hadFocus && w.focusKey) w.canvas.querySelector<HTMLElement>(`[role="gridcell"][data-key="${CSS.escape(w.focusKey)}"]`)?.focus();
    },

    mwRowElement(row: OverviewRow, index: number): HTMLElement {
        const w = win!;
        const el = document.createElement('div');
        el.className = `mw-r mw-r-${row.type}`;
        el.style.top = `${row.top}px`;
        el.style.height = `${row.height}px`;
        el.dataset.row = row.key;
        el.setAttribute('role', 'row');
        el.setAttribute('aria-rowindex', String(index + 1));
        switch (row.type) {
            case 'group': el.innerHTML = this.mwGroupHtml(row.group, row.open); break;
            case 'folder': el.innerHTML = this.mwFolderHtml(row.group, row.folder, row.open); break;
            case 'tiles':
                el.style.gridTemplateColumns = `repeat(${w.metrics.cols}, minmax(0, 1fr))`;
                el.innerHTML = row.items.map(item => this.mwTileHtml(item, row.group)).join('');
                break;
            case 'item': el.innerHTML = this.mwListRowHtml(row.item, row.group); break;
            case 'skeleton':
                el.setAttribute('aria-hidden', 'true');
                el.style.gridTemplateColumns = `repeat(${w.view === 'grid' ? w.metrics.cols : 1}, minmax(0, 1fr))`;
                el.innerHTML = w.view === 'grid'
                    ? '<span class="mw-skel-tile"></span>'.repeat(Math.min(w.metrics.cols, 8))
                    : '<span class="mw-skel-line"></span><span class="mw-skel-line"></span>';
                break;
            case 'end': el.setAttribute('aria-hidden', 'true'); el.removeAttribute('role'); break;
        }
        return el;
    },

    /** A group's name as shown. */
    mwGroupName(group: OverviewGroup): string {
        const m = strings.materials;
        switch (group.kind) {
            case 'batch': return group.batch?.name ?? '';
            case 'loose': return m.loose;
            case 'earlier': return m.earlier;
            case 'person': {
                const key = group.persons?.[0] ?? '';
                return win?.names.get(key) ?? key;
            }
            case 'noperson': return m.noPerson;
            case 'day': {
                const d = new Date(`${group.day}T12:00:00`);
                return Number.isNaN(d.getTime()) ? group.day ?? '' : d.toLocaleDateString(getCurrentLanguage(), { day: 'numeric', month: 'numeric', year: 'numeric' });
            }
        }
    },

    mwGroupMeta(group: OverviewGroup): string {
        const w = win!;
        const m = strings.materials;
        const lang = getCurrentLanguage();
        if (group.kind === 'batch' && group.batch) {
            const b = group.batch;
            const people = (b.persons ?? []).map(p => w.names.get(p) ?? p);
            return [materialShortDate(b.at), people.length ? m.forPersons(people) : '', b.note ? m.quoted(b.note) : '']
                .filter(Boolean).join(' · ');
        }
        if (group.kind === 'loose') {
            const froms = (group.froms ?? []).map(k => m.from[k]).filter(Boolean);
            return froms.length ? `${m.looseSub} · ${joinAnd(lang, froms)}` : m.looseSub;
        }
        if ((group.kind === 'day' || group.kind === 'earlier') && w.model === 'app') {
            const people = (group.persons ?? []).map(p => nameWithoutYears(w.names.get(p) ?? p));
            return people.length ? m.addedWith(people) : '';
        }
        if (group.kind === 'day' || group.kind === 'earlier') {
            return [(group.batchNames ?? []).join(', '), group.looseCount ? m.looseCount(group.looseCount) : ''].filter(Boolean).join(' · ');
        }
        return '';
    },

    mwCountLabel(shown: number, total: number): string {
        const w = win!;
        const lang = getCurrentLanguage();
        return narrowing(w.filters) && shown !== total ? strings.materials.countOf(shown, total) : total.toLocaleString(lang);
    },

    mwGroupHtml(group: OverviewGroup, open: boolean): string {
        const name = this.mwGroupName(group);
        const meta = this.mwGroupMeta(group);
        const count = group.pending ? (group.batch?.files ?? 0).toLocaleString(getCurrentLanguage()) : this.mwCountLabel(group.items.length, group.total);
        const more = group.kind === 'batch' && this.mwBatchActions(group, undefined).length > 0
            ? `<button type="button" class="mw-more" data-mw="batch-menu" data-group="${esc(group.key)}" aria-haspopup="menu" aria-label="${esc(`${strings.materials.moreActions}: ${name}`)}">⋯</button>`
            : '';
        return `<div class="mw-group" role="gridcell" aria-colspan="${win!.metrics.cols}">
            <button type="button" class="mw-group-toggle" data-mw="toggle" data-group="${esc(group.key)}" aria-expanded="${open}">
                <span class="mw-caret" aria-hidden="true">${open ? '▾' : '›'}</span>
                <span class="mw-group-text">
                    <span class="mw-group-name" title="${esc(name)}">${esc(name)}</span>
                    ${meta ? `<span class="mw-group-meta" title="${esc(meta)}">${esc(meta)}</span>` : ''}
                </span>
            </button>
            <span class="mw-group-count">${esc(count)}</span>
            ${more}
        </div>`;
    },

    mwFolderHtml(group: OverviewGroup, folder: OverviewFolder, open: boolean): string {
        const more = this.mwBatchActions(group, folder).length > 0
            ? `<button type="button" class="mw-more" data-mw="folder-menu" data-group="${esc(group.key)}" data-folder="${esc(folder.key)}" aria-haspopup="menu" aria-label="${esc(`${strings.materials.moreActions}: ${folder.label}`)}">⋯</button>`
            : '';
        return `<div class="mw-folder" role="gridcell" aria-colspan="${win!.metrics.cols}" data-depth="${folder.depth}" style="--mw-depth: ${folder.depth}">
            <button type="button" class="mw-folder-toggle" data-mw="toggle-folder" data-folder="${esc(folder.key)}" aria-expanded="${open}">
                <span class="mw-caret" aria-hidden="true">${open ? '▾' : '›'}</span>
                <span class="mw-folder-name" title="${esc(folder.label)}">${esc(folder.name)}</span>
                <span class="mw-folder-count">${esc(this.mwCountLabel(folder.items.length, folder.total))}</span>
            </button>
            ${more}
        </div>`;
    },

    /** The people line under a tile ('' for a tree attachment without anyone). */
    mwPersons(item: MaterialItem): { text: string; none: boolean } {
        const w = win!;
        // A family tree file (spec 117 §5): no people, its kind and size instead (mwTreeFileLine).
        if (item.tree) return { text: '', none: false };
        if (itemWithoutPerson(item)) return { text: strings.materials.noPerson, none: true };
        // The file of a source (spec 102 §7): its own people, then those the source cites.
        if (item.sourceOf?.length) {
            const cited = sourceOfPersons(item);
            return { text: personsShort(cited.persons, refn => w.names.get(refn) ?? null, cited.more), none: false };
        }
        return { text: personsShort(item.persons, refn => w.names.get(refn) ?? null), none: false };
    },

    mwThumbHtml(item: MaterialItem, group: OverviewGroup, small: boolean): string {
        const m = strings.materials;
        const att = item.attachment;
        const hiddenLabel = item.hidden ? m.hiddenLabel[item.hidden.reason ?? 'none'] ?? m.hiddenLabel.none : '';
        const label = hiddenLabel && !small ? `<span class="mw-hidden-label">${esc(hiddenLabel)}</span>` : '';
        const check = '<span class="mw-check" aria-hidden="true"></span>';
        const cls = `mw-thumb${item.hidden ? ' is-hidden' : ''}`;
        // "In the tree" only beside an archive (without one everything is); a hidden file keeps its own label.
        const inTree = win?.model === 'archive' && !hiddenLabel && itemInTree(item)
            ? `<span class="mw-intree">${esc(m.inTreeTag)}</span>` : '';
        const places = item.uses ? `<span class="mw-places" aria-label="${esc(m.places(item.uses))}" title="${esc(m.places(item.uses))}">${item.uses.toLocaleString(getCurrentLanguage())}</span>` : '';
        const marks = `${label}${inTree}${places}${check}`;
        const letters = `<span class="mw-type">${esc(materialTileLetters(item))}</span>`;
        const px = small ? MW_SMALL_TILE_PX : MW_TILE_PX;
        // A file of the tree on its way after the tree, or one that did not come (spec 116 §5).
        const waits = waitingTileHtml(materialImageWait(item), { tag: 'span', cls, px, content: letters, extra: marks });
        if (waits) return waits;
        if (att && !att.originalOnly && att.mimeType.startsWith('image/') && att.dataUrl) {
            return `<span class="${cls} has-thumb"><img ${imgSrcAttr(att.dataUrl)} alt="" loading="lazy">${marks}</span>`;
        }
        const sha = materialItemSha(item);
        const lazy = !!sha && item.origin !== 'tree' && ['image', 'pdf'].includes(materialType(item.mime, item.name));
        if (!lazy || !sha) return `<span class="${cls}">${letters}${marks}</span>`;
        const thumbs = materialThumbs();
        // A preview that did not come says so; one asked for now waits under the veil (spec 116 §5).
        if (thumbs.isBroken(sha, THUMB_PX)) return waitingTileHtml('failed', { tag: 'span', cls, px, extra: marks });
        const ready = thumbs.urlOf(sha, THUMB_PX);
        const img = ready ? `<img src="${esc(ready)}" alt="">` : letters;
        const veil = !ready && thumbs.isWaiting(sha, THUMB_PX) ? ' data-img-state="loading"' : '';
        return `<span class="${cls}${ready ? ' has-thumb' : ''}"${ready ? '' : ` data-sha="${esc(sha)}" data-group="${esc(group.key)}" data-item="${esc(item.key)}"`}${veil}>${img}${marks}</span>`;
    },

    /** A family tree file's quiet line: "Family tree file · 184 kB" (spec 117 §5). */
    mwTreeFileLine(item: MaterialItem): string {
        const bytes = item.bytes ?? item.file?.bytes;
        return [strings.materials.treeFile, bytes ? formatBytesShort(bytes) : ''].filter(Boolean).join(' · ');
    },

    /** "the file of the source {title}" of a family tree file a live source was made of, else ''. */
    mwTreeFileOf(item: MaterialItem): string {
        const of = treeFileSource(item);
        return of ? strings.materials.treeFileOf(of.title ?? of.source) : '';
    },

    mwAriaLabel(item: MaterialItem): string {
        const m = strings.materials;
        if (item.tree) return [item.title, this.mwTreeFileLine(item), this.mwTreeFileOf(item)].filter(Boolean).join(', ');
        const persons = this.mwPersons(item).text;
        const hidden = item.hidden ? m.hiddenLabel[item.hidden.reason ?? 'none'] ?? m.hiddenLabel.none : '';
        const tag = this.mwSortTag(item) || this.mwSourceOfTag(item);
        return [item.title, persons, tag, hidden].filter(Boolean).join(', ');
    },

    mwRestoreHtml(item: MaterialItem): string {
        const ctx = this.materialsWindowContext();
        if (!item.hidden || !ctx?.caps.assign) return '';
        const off = ctx.caps.bridgeUp ? '' : ` aria-disabled="true" title="${esc(strings.materials.actionsWhenRunning)}"`;
        return `<button type="button" class="link-button mw-restore" data-mw="restore" data-key="${esc(item.key)}"${off}>${esc(strings.materials.restore)}</button>`;
    },

    mwTileHtml(item: MaterialItem, group: OverviewGroup): string {
        const w = win!;
        const persons = this.mwPersons(item);
        const selected = w.selected.has(item.key);
        return `<div class="mw-tile${selected ? ' is-selected' : ''}${item.hidden ? ' is-hidden' : ''}" role="gridcell" tabindex="-1" data-key="${esc(item.key)}" aria-label="${esc(this.mwAriaLabel(item))}"${w.selecting ? ` aria-selected="${selected}"` : ''}>
            ${this.mwThumbHtml(item, group, false)}
            <span class="mw-tile-title" title="${esc(item.title)}">${fileNameBreakParts(item.title).map(esc).join('<wbr>')}</span>
            ${item.tree ? this.mwTreeTilePersonsHtml(item) : `<span class="mw-tile-persons${persons.none ? ' is-none' : ''}">${this.mwSortTagHtml(item)}${this.mwSourceOfTagHtml(item)}${esc(persons.text)}</span>`}
            ${this.mwRestoreHtml(item)}
        </div>`;
    },

    /** A family tree file's line under its tile: the tag "File of a source" with a live one, then its kind and size (5a). */
    mwTreeTilePersonsHtml(item: MaterialItem): string {
        const line = this.mwTreeFileLine(item);
        const title = [line, this.mwTreeFileOf(item)].filter(Boolean).join(' · ');
        // The size whole on the line it wraps to ("184 kB", not "184" and "kB").
        return `<span class="mw-tile-persons is-tree" title="${esc(title)}">${this.mwSourceOfTagHtml(item)}${esc(line.replace(/(\d) (?=\S+$)/, '$1\u00a0'))}</span>`;
    },

    /**
     * A list row with the columns of spec 102 §8f: Title (the file's name
     * under it) · Kind · Date · People · Source · In the tree (beside an
     * archive) · Used.
     */
    mwListRowHtml(item: MaterialItem, group: OverviewGroup): string {
        const w = win!;
        const m = strings.materials;
        const persons = this.mwPersons(item);
        const selected = w.selected.has(item.key);
        const kind = item.hidden ? `${materialKindLabel(item)} · ${m.hiddenLabel[item.hidden.reason ?? 'none'] ?? m.hiddenLabel.none}` : (item.kind || item.tree ? materialKindLabel(item) : '');
        const date = item.date ? materialDateForInput(item.date) : '';
        const inTree = w.model === 'archive'
            ? `<span class="mw-li-intree">${itemInTree(item) ? `<span class="mw-intree-tag">${esc(m.inTreeTag)}</span>` : `<span class="is-none">${esc(m.onlyArchiveShort)}</span>`}</span>`
            : '';
        const used = item.hidden && this.mwRestoreHtml(item) ? this.mwRestoreHtml(item)
            : item.uses ? esc(m.places(item.uses)) : `<span class="is-none">${esc(m.nowhere)}</span>`;
        return `<div class="mw-li sel-opt${selected ? ' is-selected' : ''}${item.hidden ? ' is-hidden' : ''}" role="gridcell" data-sel-form="row" tabindex="-1" data-key="${esc(item.key)}" aria-label="${esc(this.mwAriaLabel(item))}"${w.selecting ? ` aria-selected="${selected}"` : ''}>
            <span class="mw-li-check"><span class="mw-check" aria-hidden="true"></span></span>
            ${this.mwThumbHtml(item, group, true)}
            <span class="mw-li-name">
                <span class="mw-li-title" title="${esc(item.title)}">${esc(item.title)}</span>
                ${item.tree ? this.mwTreeListFileHtml(item) : item.titled ? `<span class="mw-li-file" title="${esc(item.name)}">${esc(item.name)}</span>` : `<span class="mw-li-file is-untitled">${esc(m.untitled)}</span>`}
            </span>
            <span class="mw-li-kind" title="${esc(kind)}">${esc(kind)}</span>
            <span class="mw-li-date">${esc(date)}</span>
            <span class="mw-li-persons${persons.none ? ' is-none' : ''}${item.tree ? ' is-tree' : ''}">${this.mwSortTagHtml(item)}${this.mwSourceOfTagHtml(item, 'mw-li-srctag')}${item.tree ? `<span class="mw-li-treeline">${esc(this.mwTreeFileLine(item))}</span>` : esc(persons.text)}</span>
            ${this.mwListSourceHtml(item)}
            ${inTree}
            <span class="mw-li-used">${used}</span>
        </div>`;
    },

    /** A family tree file's name and size under its title in a list row (5c: "talvanen.ged · 62 kB"). */
    mwTreeListFileHtml(item: MaterialItem): string {
        const bytes = item.bytes ?? item.file?.bytes;
        const text = [item.name, bytes ? formatBytesShort(bytes) : ''].filter(Boolean).join(' · ');
        return `<span class="mw-li-file" title="${esc(text)}">${esc(text)}</span>`;
    },

    /** The tag "File of a source" before the people (spec 102 §7; in a list row only on a phone, where the Source column is not). */
    mwSourceOfTagHtml(item: MaterialItem, cls = ''): string {
        const tag = this.mwSourceOfTag(item);
        return tag ? `<span class="mw-intree-tag mw-srcof-tag${cls ? ` ${cls}` : ''}">${esc(tag)}</span>` : '';
    },

    /** A list row's Source: the file of a source with its tag and the first source's title (", + 1"), else the tree's source. */
    mwListSourceHtml(item: MaterialItem): string {
        const m = strings.materials;
        const of = item.sourceOf ?? [];
        if (of.length) {
            const title = `${of[0].title ?? of[0].source}${of.length > 1 ? `, + ${(of.length - 1).toLocaleString(getCurrentLanguage())}` : ''}`;
            return `<span class="mw-li-source is-sourceof" title="${esc(title)}">${this.mwSourceOfTagHtml(item)} ${esc(title)}</span>`;
        }
        return `<span class="mw-li-source${item.source ? '' : ' is-none'}" title="${esc(item.source ?? '')}">${esc(item.source ?? m.noSourceShort)}</span>`;
    },

    /** The list's column header: a click or Enter sorts by it, again the other way, a third time back to the groups' order. */
    mwListHead(): void {
        const w = win!;
        const el = w.overlay.querySelector<HTMLElement>('.mw-lhead');
        if (!el) return;
        el.hidden = w.view !== 'list';
        if (el.hidden) { el.innerHTML = ''; return; }
        const cols = this.mwSortColumns();
        const cell = ([col, label]: [ListColumn, string]) => {
            const on = w.sort?.col === col ? w.sort.dir : 0;
            const sort = on === 1 ? 'ascending' : on === -1 ? 'descending' : 'none';
            return `<span class="mw-lh-cell mw-lh-${col}" role="columnheader" aria-sort="${sort}"><button type="button" class="mw-lh-btn" data-mw="sort" data-col="${col}">${esc(label)}<span class="mw-lh-arrow" aria-hidden="true">${on === 1 ? '▲' : on === -1 ? '▼' : ''}</span></button></span>`;
        };
        el.innerHTML = `<div class="mw-lh" role="row"><span class="mw-li-check" aria-hidden="true"></span><span class="mw-lh-thumb" aria-hidden="true"></span>${cols.map(cell).join('')}</div>`;
    },

    /** The columns the window sorts by (the list's headers, the Sort menu). */
    mwSortColumns(): [ListColumn, string][] {
        const m = strings.materials;
        return [
            ['title', m.colTitle], ['kind', m.colKind], ['date', m.colDate], ['persons', m.colPersons], ['source', m.colSource],
            ...(win?.model === 'archive' ? [['intree', m.colInTree] as [ListColumn, string]] : []), ['used', m.colUsed],
        ];
    },

    /** The toolbar's Sort ▾ (the grid and the list; ≤ 1024 it is in the filters sheet). */
    mwSortChipHtml(): string {
        const w = win!;
        const m = strings.materials;
        const s = w.sort;
        const col = s ? this.mwSortColumns().find(c => c[0] === s.col)?.[1] ?? s.col : '';
        const text = s ? m.sortChip(col, s.dir === 1 ? '↑' : '↓') : m.sortBy;
        const aria = s ? `${m.sortBy}: ${col}, ${s.dir === 1 ? m.sortAscending : m.sortDescending}` : `${m.sortBy}: ${m.sortDefault}`;
        return `<button type="button" class="mw-chip sel-opt mw-sortby" data-mw="sort-menu" aria-haspopup="menu" aria-label="${esc(aria)}">${esc(text)} <span aria-hidden="true">▾</span></button>`;
    },

    /** Sort ▾'s menu: the default order, the columns, the direction (the table's menu: ↑ ↓ Enter Esc). */
    mwSortMenu(anchor: HTMLElement): void {
        const w = win;
        if (!w) return;
        this.mwClosePop();
        const m = strings.materials;
        const s = w.sort;
        const pick = (choice: SortChoice) => () => this.mwSetSort(chooseSort(win?.sort ?? null, choice));
        const entries: MenuEntry[] = [
            { id: 'default', label: m.sortDefault, icon: '', checked: !s, run: pick(null) },
            SEP,
            ...this.mwSortColumns().map(([col, label]) => ({ id: col, label, icon: '', checked: s?.col === col, run: pick({ col }) })),
            SEP,
            { id: 'asc', label: m.sortAscending, icon: '↑', checked: s?.dir === 1, disabled: !s, run: pick({ dir: 1 }) },
            { id: 'desc', label: m.sortDescending, icon: '↓', checked: s?.dir === -1, disabled: !s, run: pick({ dir: -1 }) },
        ];
        openHeadMenu(anchor, m.sortBy, '', entries).classList.add('mw-sort-menu');
    },

    /** The window's sort from Sort ▾ or the filters sheet: both views, remembered with the view. */
    mwSetSort(sort: ListSort | null): void {
        const w = win;
        if (!w) return;
        w.sort = sort;
        writeListPrefs(w.sort, w.filters);
        w.scroller.scrollTop = 0;
        this.mwRebuild();
    },

    /** Sort the list by a column (ascending, descending, none); remembered with the view. */
    mwSortBy(col: ListColumn): void {
        const w = win;
        if (!w) return;
        const now = w.sort?.col === col ? w.sort.dir : 0;
        w.sort = now === 0 ? { col, dir: 1 } : now === 1 ? { col, dir: -1 } : null;
        writeListPrefs(w.sort, w.filters);
        this.mwRebuild();
        w.overlay.querySelector<HTMLElement>(`.mw-lhead [data-col="${col}"]`)?.focus();
    },

    /** The group header that stays at the top while its content scrolls. */
    mwSticky(): void {
        const w = win;
        if (!w) return;
        const top = w.scroller.scrollTop - w.canvas.offsetTop;
        const at = top > 0 ? stickyGroupAt(w.layout.rows, top) : null;
        if (!at || at.row.top >= top || w.canvas.hidden) {
            w.sticky.innerHTML = '';
            w.sticky.dataset.group = '';
            return;
        }
        const push = at.next !== null ? Math.min(0, at.next - top - at.row.height) : 0;
        if (w.sticky.dataset.group !== at.row.key || w.sticky.dataset.open !== String(at.row.open)) {
            w.sticky.dataset.group = at.row.key;
            w.sticky.dataset.open = String(at.row.open);
            w.sticky.innerHTML = `<div class="mw-sticky-head" aria-hidden="true">${this.mwGroupHtml(at.row.group, at.row.open)}</div>`;
            w.sticky.querySelectorAll('button').forEach(b => b.setAttribute('tabindex', '-1'));
        }
        const head = w.sticky.firstElementChild as HTMLElement | null;
        if (head) {
            head.style.height = `${at.row.height}px`;
            head.style.transform = `translateY(${push}px)`;
        }
    },

    /** One tile or list row is in the tab order (the focused one, else the first drawn). */
    mwRoving(): void {
        const w = win;
        if (!w) return;
        const cells = w.canvas.querySelectorAll<HTMLElement>('[data-key][role="gridcell"]');
        let has = false;
        cells.forEach(c => {
            const on = c.dataset.key === w.focusKey;
            c.tabIndex = on ? 0 : -1;
            if (on) has = true;
        });
        if (!has && cells[0]) cells[0].tabIndex = 0;
    },

    mwWantThumb(el: HTMLElement): void {
        const w = win;
        const sha = el.dataset.sha;
        if (!w || !sha || el.classList.contains('has-thumb')) return;
        const item = w.items.find(i => i.key === el.dataset.item);
        const group = w.groups.find(g => g.key === el.dataset.group);
        const thumbs = materialThumbs();
        const px = el.closest('.mw-li') ? MW_SMALL_TILE_PX : MW_TILE_PX;
        thumbs.want(
            { sha, px: THUMB_PX, mime: item?.mime, name: item?.file?.name ?? item?.title, bytes: item?.bytes, where: group ? this.mwGroupName(group) : '' },
            url => {
                if (!el.isConnected) return;
                const type = el.querySelector('.mw-type');
                if (!url) {
                    // Did not come: "Not loaded"; no preview to be had: the letters stay, calm (spec 116 §5).
                    setTileState(el, thumbs.isBroken(sha, THUMB_PX) ? 'failed' : 'none', px, type);
                    if (thumbs.isBroken(sha, THUMB_PX)) el.removeAttribute('data-sha');
                    return;
                }
                const img = document.createElement('img');
                img.src = url;
                img.alt = '';
                if (type) type.replaceWith(img); else el.prepend(img);
                el.classList.add('has-thumb');
                el.removeAttribute('data-img-state');
            },
            () => el.isConnected && el.dataset.vis === '1',
            () => { if (el.isConnected) setTileState(el, 'loading', px); },
        );
    },

    /** The footer's preview strip: shown while previews are on their way. */
    mwThumbStrip(s: ThumbSnapshot): void {
        const w = win;
        const el = w?.overlay.querySelector<HTMLElement>('.mw-thumbs');
        if (!w || !el) return;
        const m = strings.materials;
        const on = s.left > 0 && (s.phase === 'running' || s.phase === 'paused');
        el.hidden = !on;
        if (!on) { el.innerHTML = ''; return; }
        const total = Math.max(s.total, s.done + s.left);
        const pct = total ? Math.round((s.done / total) * 100) : 0;
        const text = s.phase === 'paused' ? m.thumbsPaused(s.done, total, s.where) : m.thumbsLoading(s.done, total, s.where);
        redraw(el, `
            ${barHtml(pct / 100, { cls: 'mw-progress', paused: s.phase === 'paused' })}
            <span class="mw-thumbs-text">${esc(text)}</span>
            <button type="button" class="link-button mw-thumbs-toggle" data-mw="${s.phase === 'paused' ? 'thumbs-resume' : 'thumbs-pause'}">${esc(s.phase === 'paused' ? m.resume : m.pause)}</button>`);
    },

    // ==================== SELECTING ====================

    /** Selection marks, the bar and the phone header (`marks`: also the drawn tiles). */
    mwSelectionChanged(marks = true): void {
        const w = win;
        const ctx = this.materialsWindowContext();
        if (!w || !ctx) return;
        const m = strings.materials;
        w.overlay.classList.toggle('is-selecting', w.selecting);
        w.canvas.setAttribute('aria-multiselectable', w.selecting ? 'true' : 'false');
        if (marks) {
            w.canvas.querySelectorAll<HTMLElement>('[data-key][role="gridcell"]').forEach(c => {
                const on = w.selected.has(c.dataset.key ?? '');
                c.classList.toggle('is-selected', on);
                if (w.selecting) c.setAttribute('aria-selected', String(on)); else c.removeAttribute('aria-selected');
            });
            const sel = w.overlay.querySelector<HTMLElement>('[data-mw="select"]');
            if (sel) {
                sel.textContent = w.selecting ? m.done : m.select;
                sel.setAttribute('aria-pressed', String(w.selecting));
                sel.classList.toggle('is-active', w.selecting);
            }
        }
        const items = this.materialsSelection();
        const n = items.length;
        const head = w.overlay.querySelector<HTMLElement>('.mw-selhead-count');
        if (head) head.textContent = n ? m.selected(n) : m.nothingSelected;
        const bar = w.overlay.querySelector<HTMLElement>('.mw-selbar');
        const skipped = w.overlay.querySelector<HTMLElement>('.mw-skipped');
        if (!bar || !skipped) return;
        bar.hidden = !w.selecting;
        // Assign… and Hide… act on the research's files only: the files only in the tree stay unchanged (spec 102 §8).
        const onlyTree = this.mwSkippedTree(items);
        skipped.hidden = !w.selecting || !onlyTree;
        skipped.textContent = w.selecting && onlyTree ? m.skippedTree(onlyTree) : '';
        if (!w.selecting) { bar.innerHTML = ''; return; }
        const off = (why: string | null | undefined) => (why ? ` aria-disabled="true" title="${esc(why)}"` : '');
        const whole = this.mwWholeTarget();
        const acts = this.mwSelActions(items);
        // A phone: three actions and ⋯ (spec 102 §11); wider: Go through, Link to…, Title…, Kind…, Date… and ⋯.
        const inline: string[] = media(MQ_MOBILE) ? ['sel-attach', 'sel-title', 'sel-review'] : ['sel-review', 'sel-attach', 'sel-title', 'sel-kind', 'sel-date', 'sel-sort'];
        const shown = inline.map(id => acts.find(a => a.id === id)).filter((a): a is SelAction => !!a);
        const more = acts.filter(a => !inline.includes(a.id));
        bar.setAttribute('aria-label', n ? m.selected(n) : m.nothingSelected);
        redraw(bar, `
            <span class="mw-selcount">${esc(n ? m.selected(n) : m.nothingSelected)}</span>
            <span class="mw-selacts" lang="${getCurrentLanguage()}">
                ${shown.map(a => `<button type="button" class="${a.id === 'sel-attach' ? 'primary' : 'secondary'} mw-selbtn" data-mw="${a.id}"${off(a.why)}>${a.html ?? esc(a.label)}</button>`).join('')}
                ${more.length ? `<button type="button" class="secondary mw-selbtn mw-selmore" data-mw="sel-more" aria-haspopup="menu" aria-label="${esc(m.selMore)}" title="${esc(m.selMore)}">⋯</button>` : ''}
            </span>
            <span class="mw-gap"></span>
            ${whole ? `<button type="button" class="link-button mw-selwhole" data-mw="sel-whole">${esc(whole.label)}</button>` : ''}
            <button type="button" class="link-button mw-selclear" data-mw="sel-clear">${esc(m.clearSelection)}</button>`);
        // On a phone held sideways the bar is one row: the content keeps its height free below.
        w.scroller.style.paddingBottom = '';
    },

    /**
     * The selection's files only in the tree that the research's actions
     * (Assign…, Hide…) leave as they are — counted when the selection also
     * has the research's files those act on (0: no sentence).
     */
    mwSkippedTree(items: MaterialItem[]): number {
        const ctx = this.materialsWindowContext();
        if (!ctx?.caps.assign || !ctx.caps.bridgeUp) return 0;
        const tree = items.filter(i => i.origin === 'tree').length;
        return tree && tree < items.length ? tree : 0;
    },

    /** "Select whole folder" / "Select whole batch (N)" for the last picked item's place. */
    mwWholeTarget(): { label: string; keys: string[] } | null {
        const w = win;
        if (!w?.lastPick) return null;
        const group = w.groups.find(g => g.key === w.lastPick!.group);
        if (!group || group.kind !== 'batch' || !group.batch) return null;
        const shown = (i: MaterialItem) => !i.hidden || w.filters.showHidden;
        const ofBatch = w.items.filter(i => i.batch?.id === group.batch!.id && shown(i));
        if (w.lastPick.folder) {
            const folder = group.folders.find(f => f.key === w.lastPick!.folder);
            if (!folder) return null;
            const keys = ofBatch.filter(i => inMaterialFolder(i.path, folder.label)).map(i => i.key);
            return { label: strings.materials.selectFolder, keys };
        }
        return { label: strings.materials.selectBatch(ofBatch.length), keys: ofBatch.map(i => i.key) };
    },

    /** A file of the tree still on its way (or not come): shown, opened, never selected nor acted on (spec 116 §5). */
    mwWaits(item: MaterialItem | null | undefined): boolean {
        return !!item && materialImageWait(item) !== 'none';
    },

    mwToggleSelect(key: string, on?: boolean): void {
        const w = win;
        if (!w) return;
        w.selecting = true;
        const next = (on ?? !w.selected.has(key)) && !this.mwWaits(this.mwItem(key));
        if (next) w.selected.add(key); else w.selected.delete(key);
        w.anchor = key;
        this.mwSelectionChanged();
    },

    mwSelectKeys(keys: string[]): void {
        const w = win;
        if (!w) return;
        w.selecting = true;
        for (const k of keys) if (!this.mwWaits(this.mwItem(k))) w.selected.add(k);
        this.mwSelectionChanged();
    },

    /** Selecting is offered for an editable tree (its own files) and for a research that can assign. */
    mwCanSelect(): boolean {
        const ctx = this.materialsWindowContext();
        return !!ctx && (ctx.caps.assign || !DataManager.isReadOnly());
    },

    /**
     * The selection's actions (spec 102 §8b): each with why it is off now.
     * Archive writes (assign, hide) act on the research's files only; Title… /
     * Kind… / Date… on the files that can change here.
     */
    mwSelActions(selection: MaterialItem[]): SelAction[] {
        const ctx = this.materialsWindowContext();
        const m = strings.materials;
        if (!ctx) return [];
        const readOnly = DataManager.isReadOnly();
        const deleteAction = (): SelAction[] => {
            if (!ctx.caps.delete || readOnly) return [];
            const files = selectionDeletable(selection).length;
            const why = !ctx.caps.bridgeUp ? m.actionsWhenRunning : !selection.length ? m.nothingSelected : !files ? m.selUnchanged(selection.length)
                : files > DELETE_MAX_FILES ? m.del.tooMany(DELETE_MAX_FILES) : null;
            return [{ id: 'sel-delete', label: m.del.forever, why }];
        };
        // Only family tree files selected (spec 117 §5): Delete permanently… alone; else they are left out of every action.
        if (selection.length && selection.every(i => i.tree)) return deleteAction();
        const items = withoutTreeFiles(selection);
        const n = items.length;
        const archive = items.filter(i => i.origin !== 'tree');
        const editable = items.filter(i => this.bulkEditable(i, ctx)).length;
        const editWhy = !n ? m.nothingSelected : editable ? null : readOnly ? strings.materials.treeReadOnly : archive.length && !ctx.caps.bridgeUp ? m.actionsWhenRunning : m.selUnchanged(n);
        const out: SelAction[] = [
            // A phone's bar has room for the word only (the count is in the header).
            { id: 'sel-review', label: media(MQ_MOBILE) ? m.reviewShort : m.review(n), why: n ? null : m.nothingSelected },
            { id: 'sel-attach', label: m.attach, why: !n ? m.nothingSelected : readOnly ? strings.materials.treeReadOnly : null },
            { id: 'sel-title', label: m.setTitle, why: editWhy },
            { id: 'sel-kind', label: m.setKind, why: editWhy },
            { id: 'sel-date', label: m.setDate, why: editWhy },
        ];
        if (ctx.caps.assign) {
            const why = !ctx.caps.bridgeUp ? m.actionsWhenRunning : archive.length === 0 ? (n ? m.skippedTree(n) : m.nothingSelected) : null;
            out.push({ id: 'sel-assign', label: m.assign, why });
        }
        // ⋯: Remove a person…, Hide…, Remove from the tree… (spec 102 §8), each on its own files.
        if (ctx.caps.assign || (!readOnly && items.some(i => (i.attachment?.places?.length ?? 0) > 0))) {
            const people = n ? this.selRemovePersonOptions(items).length : 0;
            out.push({ id: 'sel-remove-person', label: m.selRemovePerson,
                why: !n ? m.nothingSelected : people ? null : readOnly ? strings.materials.treeReadOnly : archive.length && !ctx.caps.bridgeUp ? m.actionsWhenRunning : m.selNoPerson });
        }
        if (ctx.caps.assign) {
            const why = !ctx.caps.bridgeUp ? m.actionsWhenRunning : archive.length === 0 ? (n ? m.skippedTree(n) : m.nothingSelected) : null;
            const onlyHidden = archive.length > 0 && archive.every(i => i.hidden);
            out.push({ id: onlyHidden ? 'sel-restore' : 'sel-hide', label: onlyHidden ? m.restore : m.hide, why });
        }
        const removable = items.filter(i => i.attachment && !i.removedId && (i.attachment.places?.length ?? 0) > 0 && DataManager.canEditMedia(i.attachment.id));
        if (removable.length) out.push({ id: 'sel-remove', label: m.removeFromTree, why: null });
        // Sort with the agent (spec 102 §13, 13c): opens its dialog over the selected files of the research.
        const sortGate = this.materialSortGate();
        if (sortGate === 'on' || sortGate === 'offRun') {
            const files = items.filter(i => !!i.file && !i.hidden).length;
            const why = sortGate === 'offRun' ? m.agentSort.offRun : !n ? m.nothingSelected : !files ? m.skippedTree(n)
                : this.materialSortBusy() ? m.agentSort.runNote : null;
            out.push({ id: 'sel-sort', label: m.agentSort.sort, html: researchBridgeActionLabel(m.agentSort.sort, 'material-sort'), why });
        }
        // Delete permanently… (spec 102 §9): the last one, behind `material.delete`, never in a tree that is read only.
        if (ctx.caps.delete && !readOnly) {
            const files = selectionDeletable(items).length;
            const why = !ctx.caps.bridgeUp ? m.actionsWhenRunning : !n ? m.nothingSelected : !files ? m.skippedTree(n)
                : files > DELETE_MAX_FILES ? m.del.tooMany(DELETE_MAX_FILES) : null;
            out.push({ id: 'sel-delete', label: m.del.forever, why });
        }
        return out;
    },

    /** A family tree file's menu by its tile (5a): Details, a divider, Delete permanently…. */
    mwFillItemMenu(pop: HTMLElement): void {
        const item = win?.popItem ? this.mwItem(win.popItem) : null;
        if (!item) return;
        const acts = this.mwTreeFileActions(item);
        pop.innerHTML = acts.map(a => {
            const danger = a.id === 'delete';
            const divider = danger ? '<div class="materials-item-menu-divider" role="separator"></div>' : '';
            const off = a.why ? ` aria-disabled="true" title="${esc(a.why)}"` : '';
            return `${divider}<button type="button" role="menuitem" class="materials-item-menu-row${danger ? ' is-danger' : ''}" data-action="${a.id}"${off}>${esc(a.label)}</button>`;
        }).join('');
        pop.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.getAttribute('aria-disabled') === 'true') return;
            const back = win?.popAnchor;
            this.mwClosePop();
            back?.focus();
            acts.find(a => a.id === btn.dataset.action)?.run();
        }));
    },

    /** The selection's ⋯: the actions not in the bar. */
    mwFillSelMenu(pop: HTMLElement): void {
        const items = this.materialsSelection();
        const inline = media(MQ_MOBILE) ? ['sel-attach', 'sel-title', 'sel-review'] : ['sel-review', 'sel-attach', 'sel-title', 'sel-kind', 'sel-date', 'sel-sort'];
        const acts = this.mwSelActions(items).filter(a => !inline.includes(a.id));
        pop.innerHTML = acts.map(a => {
            const danger = a.id === 'sel-remove' || a.id === 'sel-delete';
            // Remove from the tree… and Delete permanently… each after a divider of its own.
            const divider = danger ? '<div class="materials-item-menu-divider" role="separator"></div>' : '';
            const off = a.why ? ` aria-disabled="true" title="${esc(a.why)}"` : '';
            return `${divider}<button type="button" role="menuitem" class="materials-item-menu-row${danger ? ' is-danger' : ''}" data-action="${a.id}"${off}>${a.html ?? esc(a.label)}</button>`;
        }).join('');
        pop.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.getAttribute('aria-disabled') === 'true') return;
            const back = win?.popAnchor;
            this.mwClosePop();
            back?.focus();
            this.mwSelAction(btn.dataset.action ?? '');
        }));
    },

    /** Run a selection action (the bar's buttons, its ⋯). */
    mwSelAction(id: string): void {
        const w = win;
        if (!w) return;
        const selection = this.mwOrdered(this.materialsSelection());
        // Family tree files only ever go with Delete permanently… (spec 117 §5).
        if (id === 'sel-delete') {
            const files = selectionDeletable(selection);
            const opts = { ctx: { selection: true, where: 'window' as const } };
            // One family tree file alone: its own way (with a live source, the two-part dialog, spec 117 §7).
            void (files.length === 1 && files[0].tree ? this.openTreeFileDelete(files[0], opts) : this.openDeleteDialog(files, opts));
            return;
        }
        const items = withoutTreeFiles(selection);
        const end = () => { if (alive(w.gen)) this.clearMaterialsSelection(); };
        switch (id) {
            case 'sel-review': this.mwReview(items); return;
            case 'sel-sort': this.openSortDialog({ items, batch: null, selection: true }); return;
            case 'sel-attach': this.mwRun('attach', items, { selection: true }); return;
            case 'sel-title': this.openBulkEditDialog('title', items, { done: end, refused: r => this.mwShowRefused(r) }); return;
            case 'sel-kind': this.openBulkEditDialog('kind', items, { done: end, refused: r => this.mwShowRefused(r) }); return;
            case 'sel-date': this.openBulkEditDialog('date', items, { done: end, refused: r => this.mwShowRefused(r) }); return;
            case 'sel-remove': void this.openRemoveManyFromTreeDialog(items).then(ok => { if (ok) end(); }); return;
            case 'sel-remove-person':
                this.openSelRemovePersonDialog(items, {
                    done: end,
                    research: (files, refn) => this.mwRun('removeFromPerson', files, { selection: true, person: refn }),
                });
                return;
            case 'sel-assign': case 'sel-hide': case 'sel-restore': {
                const files = items.filter(i => i.origin !== 'tree');
                const action: MaterialActionId = id === 'sel-assign' ? 'assign' : id === 'sel-hide' ? 'hide' : 'restore';
                this.mwRun(action, files, { selection: true });
                return;
            }
        }
    },

    /**
     * Go through (spec 102 §8c): the viewer over the items with the fields
     * open; the header names the review filter. At the end the window keeps
     * its filters (files that no longer match leave it only now).
     */
    mwReview(items: MaterialItem[]): void {
        const w = win;
        if (!w || !items.length) return;
        const m = strings.materials;
        const f = w.filters;
        const label = [f.noTitle ? m.fNoTitle : '', f.noSource ? m.fNoSource : '', f.noPerson ? m.noPerson : '', f.left ? m.agentSort.fLeft : ''].filter(Boolean).join(' · ');
        this.openMaterialViewer(items, 0, {
            where: 'review', label, noSource: f.noSource,
            done: () => { if (alive(w.gen)) { this.clearMaterialsSelection(); this.mwRebuild({ items: true }); } },
        });
    },

    /** Items in the window's order (the groups' order; Title… numbers them so). */
    mwOrdered(items: MaterialItem[]): MaterialItem[] {
        const w = win;
        if (!w) return items;
        const at = new Map<string, number>();
        w.groups.forEach(g => g.items.forEach(i => { if (!at.has(i.key)) at.set(i.key, at.size); }));
        return [...items].sort((a, b) => (at.get(a.key) ?? Infinity) - (at.get(b.key) ?? Infinity));
    },

    /** "Show" on a refusal: the refused files selected. */
    mwShowRefused(items: MaterialItem[]): void {
        const w = win;
        if (!w) return;
        w.selected.clear();
        this.mwSelectKeys(items.map(i => i.key));
    },

    /** Ctrl/⌘+A: every file the filters show (closed groups too). */
    mwSelectAll(): void {
        const w = win;
        if (!w || !this.mwCanSelect()) return;
        const keys = w.groups.flatMap(g => g.items.map(i => i.key));
        this.mwSelectKeys(keys);
    },

    /**
     * The footer's progress of a large change (spec 102 §8h): `k` of `n` with
     * Cancel; null hides it.
     */
    mwBulkProgress(k: number | null, n: number, cancel: (() => void) | null): void {
        const w = win;
        const el = w?.overlay.querySelector<HTMLElement>('.mw-bulk');
        if (!w || !el) return;
        if (k === null) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        const pct = n ? Math.round((k / n) * 100) : 0;
        el.innerHTML = `${barHtml(pct / 100, { cls: 'mw-progress' })}<span class="mw-thumbs-text">${esc(strings.materials.bulkProgress(k, n))}</span>${cancel ? `<button type="button" class="link-button mw-thumbs-toggle" data-mw="bulk-cancel">${esc(strings.buttons.cancel)}</button>` : ''}`;
        el.querySelector('[data-mw="bulk-cancel"]')?.addEventListener('click', () => { cancel?.(); el.hidden = true; });
    },

    /** Note where an item is (its group and folder) for "Select whole …". */
    mwPick(key: string): void {
        const w = win;
        if (!w) return;
        const rowIndex = w.layout.rowOf.get(key);
        const row = rowIndex !== undefined ? w.layout.rows[rowIndex] : null;
        if (row && (row.type === 'tiles' || row.type === 'item')) w.lastPick = { group: row.group.key, ...(row.folder ? { folder: row.folder.key } : {}) };
    },

    // ==================== ACTIONS ====================

    mwItem(key: string): MaterialItem | null {
        return win?.items.find(i => i.key === key) ?? null;
    },

    /**
     * A click or Enter on a tile: a family tree file shows its menu (Details, Delete permanently…;
     * spec 117 §5), any other file opens.
     */
    mwActivateItem(key: string, anchor: HTMLElement | null): void {
        const item = this.mwItem(key);
        if (item?.tree && anchor) this.mwTreeFileMenu(item, anchor);
        else this.mwOpenItem(key);
    },

    /** A family tree file's menu (spec 117 §5): a menu by the tile, a list from below on a phone or touch (5d, 5e). */
    mwTreeFileMenu(item: MaterialItem, anchor: HTMLElement): void {
        const w = win;
        if (!w) return;
        const rows = this.mwTreeFileActions(item);
        if (isPhoneBar() || media('(pointer: coarse)')) {
            this.mwClosePop();
            const open = rows.find(r => r.id === 'open');
            const del = rows.find(r => r.id === 'delete');
            this.presentMenuSheet(item.title, [
                ...(open ? [{ rows: [{ label: open.label, id: 'mw-tree-open', run: open.run }] }] : []),
                ...(del ? [{ divider: true, rows: [{
                    label: del.label, id: 'mw-tree-delete', danger: true, run: del.run,
                    ...(del.why ? { disabled: true, why: del.why } : {}),
                }] }] : []),
            ], { subtitle: [this.mwTreeFileLine(item), this.mwTreeFileOf(item)].filter(Boolean).join(' · ') });
            return;
        }
        w.popItem = item.key;
        this.mwOpenPop('itemMenu', anchor);
    },

    /** A family tree file's actions: Details, and Delete permanently… behind `material.delete` in a tree that can change. */
    mwTreeFileActions(item: MaterialItem): { id: 'open' | 'delete'; label: string; why: string | null; run: () => void }[] {
        const ctx = this.materialsWindowContext();
        const m = strings.materials;
        const out: { id: 'open' | 'delete'; label: string; why: string | null; run: () => void }[] = [
            { id: 'open', label: m.treeDetails, why: null, run: () => this.mwOpenItem(item.key) },
        ];
        if (ctx?.caps.delete && !DataManager.isReadOnly()) {
            out.push({
                id: 'delete', label: m.del.forever, why: ctx.caps.bridgeUp ? null : m.actionsWhenRunning,
                run: () => { void this.openTreeFileDelete(item, { ctx: { where: 'window' } }); },
            });
        }
        return out;
    },

    /** Open an item with its group's items around it (the viewer's ‹ ›). */
    mwOpenItem(key: string): void {
        const w = win;
        if (!w) return;
        const rowIndex = w.layout.rowOf.get(key);
        const row = rowIndex !== undefined ? w.layout.rows[rowIndex] : null;
        const group = row && 'group' in row ? row.group : null;
        const items = group ? group.items : w.layout.order;
        const index = items.findIndex(i => i.key === key);
        if (index < 0) return;
        const personName = w.filters.person ? nameWithoutYears(w.names.get(w.filters.person) ?? w.filters.person) : '';
        // The window filtered to a person: Use as portrait… is for them (1121).
        const who = w.filters.person;
        const personId = !who ? null : DataManager.getPerson(who as PersonId)?.id
            ?? DataManager.getAllPersons().find(p => researchPersonRef(p.refn) === who)?.id ?? null;
        this.openMaterialItems(items, index, { where: 'window', label: personName ? strings.materials.ctxPerson(personName) : group ? this.mwGroupName(group) : '', personId });
    },

    mwRun(id: MaterialActionId, items: MaterialItem[], ctx: MaterialActionCtx): void {
        this.materialAction(id, items, { where: 'window', ...ctx });
    },

    /** A batch's (or its folder's) actions (3b). */
    mwBatchActions(group: OverviewGroup, folder: OverviewFolder | undefined): { id: string; label: string; writes?: boolean; divider?: boolean }[] {
        const ctx = this.materialsWindowContext();
        const batch = group.batch;
        if (!ctx || !batch) return [];
        const m = strings.materials;
        const rows: { id: string; label: string; writes?: boolean; divider?: boolean }[] = [];
        if (ctx.caps.assign) {
            if (folder) {
                rows.push({ id: 'select', label: m.selectFolderN(folder.total) });
                rows.push({ id: 'assign', label: m.folderAssign, writes: true });
                rows.push({ id: 'hide', label: m.folderHide, writes: true });
            } else {
                rows.push({ id: 'select', label: m.selectBatch(group.pending ? batch.files : group.total) });
                rows.push({ id: 'assign', label: m.batchAssign, writes: true });
                if (batch.persons?.length) rows.push({ id: 'removePerson', label: m.batchRemovePerson, writes: true });
                rows.push({ id: 'hide', label: m.batchHide, writes: true });
            }
        }
        // Sort with the agent over the batch's files without a title or a person (spec 102 §1: the batch's strip went).
        const gate = this.materialSortGate();
        if (!folder && (gate === 'on' || gate === 'offRun') && (group.pending || group.items.some(i => !!i.file && !i.hidden && (!i.titled || sortLacksPerson(i))))) {
            rows.push({ id: 'sort', label: m.agentSort.sort, divider: rows.length > 0 });
        }
        if (ctx.caps.openLinks !== false) rows.push({ id: 'research', label: strings.batch.openInResearch, divider: rows.length > 0 });
        return rows;
    },

    /** The batch's files (loaded first when not known), optionally one folder's. */
    async mwBatchItems(batch: MaterialBatch, folderLabel?: string): Promise<MaterialItem[]> {
        await this.mwLoadBatch(batch.id);
        const w = win;
        if (!w) return [];
        this.mwRebuild();
        return w.items.filter(i => i.batch?.id === batch.id && !i.hidden && !this.mwWaits(i)
            && (folderLabel === undefined || inMaterialFolder(i.path, folderLabel)));
    },

    async mwBatchAction(id: string, group: OverviewGroup, folder: OverviewFolder | undefined): Promise<void> {
        const w = win;
        const batch = group.batch;
        if (!w || !batch) return;
        const folderCtx = folder ? { folder: { batch: batch.id, path: folder.label } } : {};
        switch (id) {
            case 'sort': {
                const items = await this.mwBatchItems(batch);
                if (win) this.openSortDialog({ items, batch: batch.name });
                break;
            }
            case 'select': {
                const items = await this.mwBatchItems(batch, folder?.label);
                const now = win;
                if (!now) return;
                now.lastPick = { group: group.key, ...(folder ? { folder: folder.key } : {}) };
                this.mwSelectKeys(items.map(i => i.key));
                break;
            }
            case 'assign': this.mwRun('assign', await this.mwBatchItems(batch, folder?.label), { batch, ...folderCtx }); break;
            case 'removePerson': this.mwRun('removeFromPerson', await this.mwBatchItems(batch), { batch }); break;
            case 'hide': this.mwRun('hide', await this.mwBatchItems(batch, folder?.label), { batch, ...folderCtx }); break;
            case 'research': {
                const ctx = this.materialsWindowContext();
                const url = ctx ? researchSchemeUrl('open', { tree: ctx.researchId }, announcedResearchScheme()) : null;
                if (url) this.launchResearchLink(url);
                break;
            }
        }
    },

    // ==================== POPOVERS ====================

    mwClosePop(): void {
        const w = win;
        if (!w) return;
        // A batch's files being read for its action: closing the menu cancels it (B88).
        w.popLoad?.cancel();
        w.popLoad = null;
        w.picker?.destroy();
        w.picker = null;
        w.pop?.remove();
        w.pop = null;
        w.popKind = null;
        w.popAnchor?.setAttribute('aria-expanded', 'false');
        w.popAnchor = null;
        if (w.popKey) document.removeEventListener('keydown', w.popKey, true);
        if (w.popOutside) document.removeEventListener('mousedown', w.popOutside, true);
        w.popKey = null;
        w.popOutside = null;
    },

    mwOpenPop(kind: PopKind, anchor: HTMLElement, data: { group?: string; folder?: string } = {}): void {
        const w = win;
        if (!w) return;
        const reopen = w.popKind === kind && w.popAnchor === anchor;
        this.mwClosePop();
        if (reopen) return;
        const m = strings.materials;
        const pop = document.createElement('div');
        pop.className = `mw-pop mw-pop-${kind}`;
        const menu = kind === 'batchMenu' || kind === 'folderMenu' || kind === 'selMenu' || kind === 'headMenu' || kind === 'itemMenu';
        pop.setAttribute('role', menu ? 'menu' : 'dialog');
        if (!menu) pop.setAttribute('aria-label', kind === 'where' ? m.whereTitle : kind === 'sheet' ? m.filtersTitle : kind === 'person' ? m.fPerson : kind === 'kind' ? m.fKind : m.fBatch);
        w.overlay.appendChild(pop);
        w.pop = pop;
        w.popKind = kind;
        w.popAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        if (kind === 'selMenu') this.mwFillSelMenu(pop);
        else if (kind === 'itemMenu') this.mwFillItemMenu(pop);
        else if (kind === 'headMenu') this.mwFillHeadMenu(pop);
        else if (menu) this.mwFillMenu(pop, data);
        else if (kind === 'where') this.mwFillWhere(pop);
        else this.mwFillFilters(pop, kind);
        this.mwPlacePop();
        w.popKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                const back = w.popAnchor;
                this.mwClosePop();
                back?.focus();
                return;
            }
            if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                const rows = Array.from(pop.querySelectorAll<HTMLElement>('[role="menuitem"]'));
                const i = rows.indexOf(document.activeElement as HTMLElement);
                e.preventDefault();
                rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
            }
        };
        w.popOutside = (e: MouseEvent) => {
            const t = e.target as Node;
            // The sheet drawn anew (mwRefillSheet) is another element: the current one counts.
            if ((w.pop ?? pop).contains(t) || anchor.contains(t) || (t as HTMLElement).closest?.('.person-picker-dropdown')) return;
            this.mwClosePop();
        };
        document.addEventListener('keydown', w.popKey, true);
        document.addEventListener('mousedown', w.popOutside, true);
        if (kind === 'person') w.picker?.focusInput();
        else if (kind === 'where') { pop.tabIndex = -1; pop.focus(); }
        else pop.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"]), input, button')?.focus();
    },

    mwPlacePop(): void {
        const w = win;
        const pop = w?.pop;
        const anchor = w?.popAnchor;
        if (!pop || !anchor) return;
        const r = anchor.getBoundingClientRect();
        const pw = pop.offsetWidth;
        const ph = pop.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - pw - 8, w!.popKind?.endsWith('Menu') ? r.right - pw : r.left));
        const top = r.bottom + 4 + ph > window.innerHeight - 8 ? Math.max(8, r.top - ph - 4) : r.bottom + 4;
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
    },

    mwFillMenu(pop: HTMLElement, data: { group?: string; folder?: string }): void {
        const w = win!;
        const ctx = this.materialsWindowContext();
        const group = w.groups.find(g => g.key === data.group);
        const folder = data.folder ? group?.folders.find(f => f.key === data.folder) : undefined;
        if (!group || !ctx) return;
        const m = strings.materials;
        const actions = this.mwBatchActions(group, folder);
        pop.innerHTML = actions.map(a => {
            const divider = a.divider ? '<div class="materials-item-menu-divider" role="separator"></div>' : '';
            // A read-only tree (locked, a newer version's data, an exported page) writes nothing (spec 102 §12g).
            const why = a.id === 'sort' ? (!ctx.caps.bridgeUp ? m.agentSort.offRun : this.materialSortBusy() ? m.agentSort.runNote : null)
                : !a.writes ? null : DataManager.isReadOnly() ? m.treeReadOnly : !ctx.caps.bridgeUp ? m.actionsWhenRunning : null;
            const off = why ? ` aria-disabled="true" title="${esc(why)}"` : '';
            // Sort with the agent: through the bridge, the AI badge alone.
            const label = a.id === 'sort' ? researchBridgeActionLabel(a.label, 'material-sort') : researchActionLabel(a.label, a.id === 'research' ? researchLinkMark('open') : 'none');
            return `${divider}<button type="button" role="menuitem" class="materials-item-menu-row" data-action="${a.id}"${off}>${label}</button>`;
        }).join('');
        pop.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('aria-busy') === 'true') return;
            const action = btn.dataset.action ?? '';
            const batch = group.batch;
            // Its files not known yet (B88, §4 4c): the menu stays while they are read, closing it cancels.
            if (action !== 'research' && batch && ctx.caps.bridgeUp && !this.mwBatchKnown(batch.id)) {
                void this.mwBatchActionAfterLoad(pop, btn, action, group, folder);
                return;
            }
            const back = w.popAnchor;
            this.mwClosePop();
            back?.focus();
            void this.mwBatchAction(action, group, folder);
        }));
    },

    /** A batch's action whose files are read first, the menu held meanwhile (B88). */
    async mwBatchActionAfterLoad(pop: HTMLElement, btn: HTMLElement, action: string, group: OverviewGroup, folder: OverviewFolder | undefined): Promise<void> {
        const w = win;
        const batch = group.batch;
        if (!w || !batch) return;
        const load = startMenuLoad(pop, btn);
        w.popLoad = load;
        const r = await this.mwLoadBatch(batch.id, { signal: load.signal, timeoutMs: MENU_LOAD_LIMIT_MS });
        const now = win;
        if (!now || now.popLoad !== load) return;
        if (load.stopped()) { now.popLoad = null; return; }
        if (!r.ok) {
            now.popLoad = null;
            if ('error' in r && r.error) load.fail(materialErrorText(r.error, !!this.materialsWindowContext()?.agent));
            else load.cancel();
            return;
        }
        load.done();
        now.popLoad = null;
        const back = now.popAnchor;
        this.mwClosePop();
        back?.focus();
        await this.mwBatchAction(action, group, folder);
    },

    /** The header's ⋯ on a phone (spec 102 §8, §11): Add materials… (no symbol) and Where the files are. */
    mwFillHeadMenu(pop: HTMLElement): void {
        const m = strings.materials;
        const labels: Record<WindowHeadAction, string> = { add: m.addMaterials, where: m.whereTitle };
        pop.innerHTML = '<div class="bottom-sheet-handle" aria-hidden="true"></div>'
            + windowHeadMenu({ add: this.materialsAddOffered() })
                .map(a => `<button type="button" role="menuitem" class="materials-item-menu-row" data-head="${a}">${esc(labels[a])}</button>`).join('');
        pop.querySelectorAll<HTMLButtonElement>('[data-head]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const anchor = win?.popAnchor ?? null;
            this.mwClosePop();
            if (btn.dataset.head === 'add') this.mwAddMaterials();
            else if (anchor) this.mwOpenPop('where', anchor);
        }));
    },

    /** Add materials… (spec 102 §8): the research's batch wizard over the window, with dropped files when there are some. */
    mwAddMaterials(files?: { file: File; path: string }[]): void {
        if (!win || !this.materialsAddOffered()) return;
        this.mwClosePop();
        this.showBatchDialog(files?.length ? { files } : {});
    },

    /**
     * Files dragged onto the window (spec 102 §8): its own drop, `.drop-overlay`
     * over the window, the files and folders into Add materials. The window's
     * events stay here, so the app's drop (which waits while a dialog is open)
     * does not refuse them; a phone has no drop.
     */
    mwWireDrop(): void {
        const w = win!;
        const box = w.overlay.querySelector<HTMLElement>('.materials-window');
        if (!box) return;
        let depth = 0;
        const m = strings.materials;
        const show = (on: boolean): void => {
            let node = box.querySelector<HTMLElement>('.mw-drop');
            if (!on) { node?.classList.remove('active'); return; }
            if (!node) {
                node = document.createElement('div');
                node.className = 'drop-overlay mw-drop';
                node.setAttribute('aria-hidden', 'true');
                node.innerHTML = `<div class="drop-overlay-box"><div class="drop-overlay-title">${esc(m.dropTitleMaterials)}</div>`
                    + `<div class="drop-overlay-sub">${esc(m.dropSubMaterials)}</div></div>`;
                box.appendChild(node);
            }
            node.classList.add('active');
        };
        const ours = (e: DragEvent): boolean => alive(w.gen) === w && dragCarriesFiles(e.dataTransfer?.types)
            && !media(MQ_MOBILE) && this.materialsAddOffered();
        w.overlay.addEventListener('dragenter', (e) => {
            if (!ours(e)) return;
            e.preventDefault();
            e.stopPropagation();
            depth++;
            show(true);
        });
        w.overlay.addEventListener('dragover', (e) => {
            if (!ours(e)) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        w.overlay.addEventListener('dragleave', (e) => {
            if (!ours(e)) return;
            e.stopPropagation();
            depth = Math.max(0, depth - 1);
            if (depth === 0) show(false);
        });
        w.overlay.addEventListener('drop', (e) => {
            if (!ours(e)) return;
            e.preventDefault();
            e.stopPropagation();
            depth = 0;
            show(false);
            // The entries are read now (a drop's data is gone after this event), the folders walked after.
            void this.batchFilesFromDrop(e.dataTransfer).then(files => { if (files.length && alive(w.gen)) this.mwAddMaterials(files); });
        });
    },

    /** A batch added while the window is open (spec 102 §1 A, §8): "N files added" until the sorting moves on, the list read again. */
    materialsBatchAdded(count: number): void {
        const w = win;
        if (!w || w.model !== 'archive' || count <= 0 || !document.getElementById(MODAL_ID)) return;
        w.sortAdded = count;
        w.sortClosedState = null;
        this.mwSortStrip();
        void this.mwLoad();
    },

    /** ⓘ "Where the files are": one sentence by the model, a second one for an encrypted tree (1c, 1d). */
    mwFillWhere(pop: HTMLElement): void {
        const w = win!;
        const ctx = this.materialsWindowContext();
        const m = strings.materials;
        const agent = !!ctx?.agent;
        const encrypted = SettingsManager.isEncryptionEnabled();
        const lines = [
            w.model === 'app' ? m.whereApp : agent ? m.whereArchiveResearch : m.whereArchive,
            encrypted && w.model === 'archive' ? (agent ? m.whereEncryptedResearch : m.whereEncrypted) : '',
        ].filter(Boolean);
        pop.innerHTML = `<div class="mw-pop-head">${esc(m.whereTitle)}</div>${lines.map(t => `<p class="mw-where-text">${esc(t)}</p>`).join('')}`;
    },

    /** The filter popovers (wide) and the filters sheet (≤ 1024). */
    /** The Kind filter's rows: "Family tree files" only while there is one (or it is ticked, to be unticked; spec 117 §5). */
    mwKindRows(): KindFilter[] {
        const w = win!;
        return w.items.some(i => i.tree) || w.filters.kinds.includes('tree') ? [...KIND_FILTERS, 'tree'] : KIND_FILTERS;
    },

    mwFillFilters(pop: HTMLElement, kind: PopKind): void {
        const w = win!;
        const ctx = this.materialsWindowContext();
        if (!ctx) return;
        const m = strings.materials;
        const f = w.filters;
        const sheet = kind === 'sheet';
        const parts: string[] = [];
        if (kind === 'person' || sheet) {
            const current = f.person ? nameWithoutYears(w.names.get(f.person) ?? f.person) : '';
            parts.push(`<div class="mw-pop-section">
                ${sheet ? `<div class="mw-pop-title">${esc(m.fPerson)}</div>` : ''}
                ${current ? `<span class="mw-chip sel-opt is-active"><span class="mw-chip-main">${esc(current)}</span><button type="button" class="mw-chip-x" data-pop="clear-person" aria-label="${esc(`${m.removeFilter}: ${current}`)}">×</button></span>` : ''}
                <div id="mw-person-picker" class="mw-person-picker"></div>
            </div>`);
        }
        if (kind === 'kind' || sheet) {
            parts.push(`<div class="mw-pop-section" role="group" aria-label="${esc(m.fKind)}">
                ${sheet ? `<div class="mw-pop-title">${esc(m.fKind)}</div>` : ''}
                ${this.mwKindRows().map(k => `<label class="mw-check-row"><input type="checkbox" data-pop="kind" value="${k}"${f.kinds.includes(k) ? ' checked' : ''}> ${esc(k === 'none' ? m.kindNone : k === 'tree' ? m.kindTrees : m.kind[k] ?? k)}</label>`).join('')}
            </div>`);
        }
        if (kind === 'batch' || (sheet && w.model === 'archive')) {
            const batches = [...(w.list?.batches ?? [])].sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0));
            parts.push(`<div class="mw-pop-section" role="radiogroup" aria-label="${esc(m.fBatch)}">
                ${sheet ? `<div class="mw-pop-title">${esc(m.fBatch)}</div>` : ''}
                <label class="mw-check-row"><input type="radio" name="mw-batch" data-pop="batch" value=""${f.batch ? '' : ' checked'}> ${esc(m.allBatches)}</label>
                ${batches.map(b => `<label class="mw-check-row"><input type="radio" name="mw-batch" data-pop="batch" value="${esc(b.id)}"${f.batch === b.id ? ' checked' : ''}> <span class="mw-check-text">${esc(b.name)}</span></label>`).join('')}
            </div>`);
        }
        if (sheet) {
            const toggle = (act: string, label: string, on: boolean) =>
                `<button type="button" class="mw-chip sel-opt mw-toggle${on ? ' is-active' : ''}" data-pop="${act}" aria-pressed="${on}">${esc(label)}</button>`;
            parts.push(`<div class="mw-pop-section mw-pop-toggles">
                ${toggle('noperson', `${m.noPerson} · ${w.summary.noPerson.toLocaleString(getCurrentLanguage())}`, f.noPerson)}
                ${ctx.caps.assign ? toggle('hidden', m.showHidden, f.showHidden) : ''}
            </div>`);
            parts.push(this.mwReviewChips(toggle, 'mw-pop-section mw-pop-toggles mw-pop-review'));
            parts.push(`<div class="mw-pop-section">
                <div class="mw-pop-title">${esc(m.groupBy)}</div>
                <div class="mw-seg sel-seg" role="group" aria-label="${esc(m.groupBy)}">
                    ${(w.model === 'app'
                        ? [['added', m.groupAdded], ['person', m.groupPerson]]
                        : [['batch', m.groupBatch], ['date', m.groupDate]]).map(([g, label]) =>
                        `<button type="button" class="sel-opt" data-sel-form="seg" data-pop="group-${g}" aria-pressed="${w.group === g}">${esc(label)}</button>`).join('')}
                </div>
            </div>`);
            // Sort (the toolbar's Sort ▾ on a computer): the default order or a column, then its direction.
            const s = w.sort;
            parts.push(`<div class="mw-pop-section">
                <div class="mw-pop-title">${esc(m.sortBy)}</div>
                <div class="mw-pop-sort" role="group" aria-label="${esc(m.sortBy)}">
                    ${toggle('sort-col-none', m.sortDefault, !s)}
                    ${this.mwSortColumns().map(([col, label]) => toggle(`sort-col-${col}`, label, s?.col === col)).join('')}
                </div>
                <div class="mw-seg sel-seg mw-pop-sortdir" role="group" aria-label="${esc(m.sortBy)}">
                    ${([[1, '↑', m.sortAscending], [-1, '↓', m.sortDescending]] as const).map(([dir, arrow, label]) =>
                        `<button type="button" class="sel-opt" data-sel-form="seg" data-pop="sort-dir-${dir}" aria-pressed="${s?.dir === dir}"${s ? '' : ' disabled'}><span aria-hidden="true">${arrow}</span> ${esc(label)}</button>`).join('')}
                </div>
            </div>`);
            parts.push(`<div class="mw-pop-foot">
                <button type="button" class="link-button" data-pop="clear">${esc(m.clearFilters)}</button>
                <button type="button" class="primary btn-sm" data-pop="done">${esc(m.done)}</button>
            </div>`);
        }
        pop.innerHTML = sheet ? `<div class="mw-pop-head">${esc(m.filtersTitle)}</div>${parts.join('')}` : parts.join('');
        if (pop.querySelector('#mw-person-picker')) {
            w.picker = new PersonPicker({
                containerId: 'mw-person-picker',
                filter: p => w.model === 'app' || !!researchPersonRef(p.refn),
                // The window covers the view: Whole tree / Direct line of the tree's main person (spec 137 §1.5).
                scope: materialScopeSource(null),
                onSelect: (id) => {
                    const key = w.model === 'app' ? (DataManager.getPerson(id) ? id : null) : researchPersonRef(DataManager.getPerson(id)?.refn);
                    if (!key) return;
                    w.filters.person = key;
                    this.mwFiltersChanged();
                    if (sheet) this.mwRefillSheet(); else { const back = w.popAnchor; this.mwClosePop(); back?.focus(); }
                },
            });
        }
        pop.addEventListener('change', (e) => {
            const input = e.target as HTMLInputElement;
            if (input.dataset.pop === 'kind') {
                const k = input.value as KindFilter;
                w.filters.kinds = input.checked ? [...new Set([...w.filters.kinds, k])] : w.filters.kinds.filter(x => x !== k);
                this.mwFiltersChanged();
            } else if (input.dataset.pop === 'batch') {
                w.filters.batch = input.value || null;
                this.mwFiltersChanged();
                if (!sheet) { const back = w.popAnchor; this.mwClosePop(); back?.focus(); }
            }
        });
        pop.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-pop]');
            if (!btn || btn.tagName === 'INPUT') return;
            const sortPick = btn.dataset.pop?.match(/^sort-(col|dir)-(.+)$/);
            if (sortPick) {
                const [, what, value] = sortPick;
                w.sort = chooseSort(w.sort, what === 'dir' ? { dir: value === '1' ? 1 : -1 } : value === 'none' ? null : { col: value as ListColumn });
                this.mwFiltersChanged();
                this.mwRefillSheet();
                return;
            }
            switch (btn.dataset.pop) {
                case 'clear-person': w.filters.person = null; break;
                case 'noperson': w.filters.noPerson = !w.filters.noPerson; break;
                case 'notitle': w.filters.noTitle = !w.filters.noTitle; break;
                case 'nosource': w.filters.noSource = !w.filters.noSource; break;
                case 'left': w.filters.left = !w.filters.left; break;
                case 'where-tree': w.filters.where = w.filters.where === 'tree' ? null : 'tree'; break;
                case 'where-archive': w.filters.where = w.filters.where === 'archive' ? null : 'archive'; break;
                case 'hidden': w.filters.showHidden = !w.filters.showHidden; break;
                case 'group-batch': this.mwSetGroup('batch'); break;
                case 'group-date': this.mwSetGroup('date'); break;
                case 'group-added': this.mwSetGroup('added'); break;
                case 'group-person': this.mwSetGroup('person'); break;
                case 'clear': this.mwClearFilters(); break;
                case 'done': { const back = w.popAnchor; this.mwClosePop(); back?.focus(); return; }
                default: return;
            }
            this.mwFiltersChanged();
            if (sheet) this.mwRefillSheet(); else this.mwClosePop();
        });
    },

    /** Redraw the open sheet with the current filters (keeps it open). */
    mwRefillSheet(): void {
        const w = win;
        if (!w?.pop || w.popKind !== 'sheet') return;
        w.picker?.destroy();
        w.picker = null;
        const fresh = w.pop.cloneNode(false) as HTMLElement;
        w.pop.replaceWith(fresh);
        w.pop = fresh;
        this.mwFillFilters(fresh, 'sheet');
        this.mwPlacePop();
    },

    // ==================== CHANGES ====================

    mwFiltersChanged(): void {
        const w = win;
        if (!w) return;
        w.scroller.scrollTop = 0;
        writeListPrefs(w.sort, w.filters);
        this.mwRebuild();
    },

    /** The files the agent left unassigned, shown with their filter (the sorting dialog's Show in Materials, spec 102 §2). */
    mwShowLeft(): void {
        const w = win;
        if (!w) return;
        w.filters.left = true;
        this.mwFiltersChanged();
    },

    mwClearFilters(): void {
        const w = win;
        if (!w) return;
        const query = w.filters.query;
        w.filters = { ...emptyFilters(), query };
        w.focusBatch = null;
    },

    mwSetGroup(group: OverviewGroupMode): void {
        const w = win;
        if (!w || w.group === group) return;
        w.group = group;
        writePrefs(w.group, w.view);
    },

    mwSetView(view: OverviewView): void {
        const w = win;
        if (!w || w.view === view) return;
        // Keep the first item in view in view.
        const top = w.scroller.scrollTop - w.canvas.offsetTop;
        const first = w.layout.rows.find(r => r.top + r.height > top && (r.type === 'tiles' || r.type === 'item'));
        const key = first ? (first.type === 'tiles' ? first.items[0].key : first.type === 'item' ? first.item.key : null) : null;
        w.view = view;
        writePrefs(w.group, w.view);
        this.mwRebuild();
        if (key) this.mwScrollTo(key, 'start');
    },

    mwToggleOpen(key: string): void {
        const w = win;
        if (!w) return;
        w.open.set(key, !this.mwIsOpen(key));
        this.mwRebuild();
    },

    /** Bring an item's row into view (`start`: at the top). */
    mwScrollTo(key: string, how: 'start' | 'nearest' = 'nearest'): void {
        const w = win;
        if (!w) return;
        const index = w.layout.rowOf.get(key);
        if (index === undefined) return;
        const row = w.layout.rows[index];
        const stickyH = w.metrics.group;
        const top = row.top + w.canvas.offsetTop;
        const view = w.scroller.clientHeight;
        if (how === 'start') w.scroller.scrollTop = Math.max(0, top - stickyH);
        else if (top - stickyH < w.scroller.scrollTop) w.scroller.scrollTop = Math.max(0, top - stickyH);
        else if (top + row.height > w.scroller.scrollTop + view) w.scroller.scrollTop = top + row.height - view;
        this.mwRenderRows();
    },

    mwFocusItem(key: string): void {
        const w = win;
        if (!w) return;
        w.focusKey = key;
        this.mwScrollTo(key);
        this.mwRoving();
        w.canvas.querySelector<HTMLElement>(`[role="gridcell"][data-key="${CSS.escape(key)}"]`)?.focus();
    },

    // ==================== WIRING ====================

    mwWireHeader(): void {
        const w = win!;
        const input = w.overlay.querySelector<HTMLInputElement>('#materials-search');
        input?.addEventListener('input', () => {
            if (w.searchTimer) clearTimeout(w.searchTimer);
            w.searchTimer = setTimeout(() => {
                w.searchTimer = null;
                if (!alive(w.gen)) return;
                w.filters.query = input.value;
                this.mwFiltersChanged();
            }, SEARCH_DEBOUNCE_MS);
        });
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                e.stopPropagation();
                input.value = '';
                w.filters.query = '';
                this.mwFiltersChanged();
            }
        });
        w.overlay.querySelector('.mw-selhead-done')?.addEventListener('click', () => this.clearMaterialsSelection());
        w.overlay.querySelector('.mw-head')?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('.mw-tools [data-mw], .mw-where, .mw-add, .mw-head-more');
            if (!btn) return;
            this.mwToolAction(btn);
        });
    },

    mwToolAction(btn: HTMLElement): void {
        const w = win;
        if (!w) return;
        const f = w.filters;
        switch (btn.dataset.mw) {
            case 'person': this.mwOpenPop('person', btn); return;
            case 'kind': this.mwOpenPop('kind', btn); return;
            case 'batch': this.mwOpenPop('batch', btn); return;
            case 'files': return;
            case 'sheet': this.mwOpenPop('sheet', btn); return;
            case 'sort-menu': this.mwSortMenu(btn); return;
            case 'where': this.mwOpenPop('where', btn); return;
            case 'add': this.mwAddMaterials(); return;
            case 'head-menu': this.mwOpenPop('headMenu', btn); return;
            case 'clear-person': f.person = null; break;
            case 'clear-kind': f.kinds = []; break;
            case 'clear-batch': f.batch = null; w.focusBatch = null; break;
            case 'clear-files': f.files = null; break;
            case 'noperson': f.noPerson = !f.noPerson; break;
            case 'notitle': f.noTitle = !f.noTitle; break;
            case 'nosource': f.noSource = !f.noSource; break;
            case 'left': f.left = !f.left; break;
            case 'where-tree': f.where = f.where === 'tree' ? null : 'tree'; break;
            case 'where-archive': f.where = f.where === 'archive' ? null : 'archive'; break;
            case 'hidden': f.showHidden = !f.showHidden; break;
            case 'clear': this.mwClearFilters(); break;
            case 'group-batch': this.mwSetGroup('batch'); break;
            case 'group-date': this.mwSetGroup('date'); break;
            case 'group-added': this.mwSetGroup('added'); break;
            case 'group-person': this.mwSetGroup('person'); break;
            case 'view-grid': this.mwSetView('grid'); return;
            case 'view-list': this.mwSetView('list'); return;
            case 'select':
                if (w.selecting) this.clearMaterialsSelection();
                else { w.selecting = true; this.mwSelectionChanged(); }
                return;
            default: return;
        }
        this.mwFiltersChanged();
        // The toolbar was drawn anew: keep the focus on the same control.
        w.overlay.querySelector<HTMLElement>(`.mw-tools [data-mw="${btn.dataset.mw}"]`)?.focus();
    },

    mwWireBody(): void {
        const w = win!;
        w.scroller.addEventListener('scroll', () => {
            const now = alive(w.gen);
            if (!now) return;
            this.mwRenderRows();
        }, { passive: true });
        const body = w.overlay.querySelector<HTMLElement>('#materials-window-body')!;
        body.addEventListener('click', (e) => this.mwBodyClick(e));
        // Ctrl/⌘+A: every file the filters show (not in a text field).
        w.overlay.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a') return;
            const t = e.target as HTMLElement;
            if (t.closest('input, textarea, [contenteditable="true"]') || w.pop) return;
            if (!this.mwCanSelect()) return;
            e.preventDefault();
            this.mwSelectAll();
        });
        w.canvas.addEventListener('keydown', (e) => this.mwKeydown(e));
        w.canvas.addEventListener('focusin', (e) => {
            const cell = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"][data-key]');
            if (cell?.dataset.key) { w.focusKey = cell.dataset.key; this.mwRoving(); }
        });
        // Touch: a long press starts selecting with the item.
        w.canvas.addEventListener('pointerdown', (e) => {
            // A new touch: a long press's click was not delivered (a phone sends none), the tap counts.
            w.suppressClick = false;
            if (e.pointerType !== 'touch' || !this.mwCanSelect()) return;
            const cell = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"][data-key]');
            if (!cell?.dataset.key) return;
            const key = cell.dataset.key;
            const x = e.clientX, y = e.clientY;
            const cancel = () => {
                if (w.pressTimer) clearTimeout(w.pressTimer);
                w.pressTimer = null;
                w.canvas.removeEventListener('pointermove', move);
                w.canvas.removeEventListener('pointerup', cancel);
                w.canvas.removeEventListener('pointercancel', cancel);
            };
            const move = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - x, ev.clientY - y) > 10) cancel(); };
            w.canvas.addEventListener('pointermove', move);
            w.canvas.addEventListener('pointerup', cancel);
            w.canvas.addEventListener('pointercancel', cancel);
            w.pressTimer = setTimeout(() => {
                cancel();
                if (!alive(w.gen)) return;
                w.suppressClick = true;
                this.mwPick(key);
                this.mwToggleSelect(key, true);
            }, LONG_PRESS_MS);
        });
        w.canvas.addEventListener('contextmenu', (e) => { if (w.suppressClick) e.preventDefault(); });
    },

    mwBodyClick(e: MouseEvent): void {
        const w = win;
        if (!w) return;
        const target = e.target as HTMLElement;
        const act = target.closest<HTMLElement>('[data-mw]');
        if (act && !act.closest('.mw-tools')) {
            const disabled = act.getAttribute('aria-disabled') === 'true';
            switch (act.dataset.mw) {
                case 'toggle': {
                    const key = act.dataset.group ?? '';
                    const fromSticky = !!act.closest('.mw-sticky');
                    this.mwToggleOpen(key);
                    if (fromSticky) {
                        const row = w.layout.rows.find(r => r.key === key);
                        if (row) { w.scroller.scrollTop = row.top + w.canvas.offsetTop; this.mwRenderRows(); }
                    }
                    w.canvas.querySelector<HTMLElement>(`[data-mw="toggle"][data-group="${CSS.escape(key)}"]`)?.focus();
                    return;
                }
                case 'toggle-folder': {
                    const key = act.dataset.folder ?? '';
                    this.mwToggleOpen(key);
                    w.canvas.querySelector<HTMLElement>(`[data-mw="toggle-folder"][data-folder="${CSS.escape(key)}"]`)?.focus();
                    return;
                }
                case 'batch-menu': this.mwOpenPop('batchMenu', act, { group: act.dataset.group }); return;
                case 'folder-menu': this.mwOpenPop('folderMenu', act, { group: act.dataset.group, folder: act.dataset.folder }); return;
                case 'restore': {
                    e.stopPropagation();
                    if (disabled) return;
                    const item = this.mwItem(act.dataset.key ?? '');
                    if (item) this.mwRun('restore', [item], {});
                    return;
                }
                case 'start': this.researchSyncAction('startResearch'); return;
                case 'retry': w.loadError = null; void this.mwLoad(); this.mwRebuild(); return;
                case 'clear': this.mwClearFilters(); this.mwFiltersChanged(); return;
                case 'thumbs-pause': materialThumbs().pause(); return;
                case 'thumbs-resume': materialThumbs().resume(); return;
                case 'sel-clear': this.clearMaterialsSelection(); return;
                case 'sel-whole': {
                    const whole = this.mwWholeTarget();
                    if (whole) this.mwSelectKeys(whole.keys);
                    return;
                }
                case 'sel-more': this.mwOpenPop('selMenu', act); return;
                case 'sort': this.mwSortBy(act.dataset.col as ListColumn); return;
                case 'sel-review': case 'sel-attach': case 'sel-title': case 'sel-kind': case 'sel-date':
                case 'sel-assign': case 'sel-hide': case 'sel-restore': case 'sel-remove': case 'sel-remove-person': case 'sel-sort':
                case 'sel-delete':
                    if (disabled) return;
                    this.mwSelAction(act.dataset.mw);
                    return;
            }
        }
        const cell = target.closest<HTMLElement>('.mw-canvas [role="gridcell"][data-key]');
        if (!cell?.dataset.key) return;
        const key = cell.dataset.key;
        if (w.suppressClick) { w.suppressClick = false; return; }
        w.focusKey = key;
        const canSelect = this.mwCanSelect();
        if (canSelect && e.shiftKey) {
            e.preventDefault();
            const from = w.anchor ?? key;
            this.mwPick(key);
            this.mwSelectKeys(rangeKeys(w.layout.order, from, key));
            w.anchor = key;
            return;
        }
        if (canSelect && (w.selecting || target.closest('.mw-check'))) {
            this.mwPick(key);
            this.mwToggleSelect(key);
            return;
        }
        this.mwActivateItem(key, cell);
    },

    mwKeydown(e: KeyboardEvent): void {
        const w = win;
        if (!w) return;
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"][data-key]');
        const key = cell?.dataset.key;
        if (!cell || !key || e.target !== cell) return;
        const order = w.layout.order;
        const at = order.findIndex(i => i.key === key);
        if (at < 0) return;
        const move = (index: number) => {
            const next = order[Math.max(0, Math.min(order.length - 1, index))];
            if (!next) return;
            e.preventDefault();
            if (e.shiftKey && this.mwCanSelect() && w.selecting) {
                this.mwSelectKeys(rangeKeys(order, w.anchor ?? key, next.key));
            }
            this.mwFocusItem(next.key);
        };
        const vertical = (dir: 1 | -1) => {
            const rowIndex = w.layout.rowOf.get(key);
            if (rowIndex === undefined) return;
            const row = w.layout.rows[rowIndex];
            if (row.type !== 'tiles' && row.type !== 'item') return;
            const col = at - row.first;
            for (let i = rowIndex + dir; i >= 0 && i < w.layout.rows.length; i += dir) {
                const r = w.layout.rows[i];
                if (r.type === 'tiles') { move(r.first + Math.min(col, r.items.length - 1)); return; }
                if (r.type === 'item') { move(r.first); return; }
            }
        };
        switch (e.key) {
            case 'ArrowRight': move(at + 1); break;
            case 'ArrowLeft': move(at - 1); break;
            case 'ArrowDown': vertical(1); break;
            case 'ArrowUp': vertical(-1); break;
            case 'Home': move(0); break;
            case 'End': move(order.length - 1); break;
            case 'Enter': e.preventDefault(); this.mwActivateItem(key, cell); break;
            case ' ':
                if (!this.mwCanSelect()) return;
                e.preventDefault();
                this.mwPick(key);
                this.mwToggleSelect(key);
                break;
        }
    },
});

/** The window is open (tests, the viewer's way back). */
export function materialsWindowOpen(): boolean {
    return !!win;
}
