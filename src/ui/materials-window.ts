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

import type { UIClass } from './index.js';
import { DataManager } from '../data.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { researchPersonRef, researchSchemeUrl } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { PersonPicker } from '../person-picker.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import {
    MaterialItem, MaterialList, MaterialBatch, MaterialError, MaterialActionId,
    cachedMaterials, primeMaterials, fetchMaterial, saveMaterialList, materialKindLabel, materialErrorText,
    materialType,
} from '../materials.js';
import {
    OverviewFilters, OverviewGroupMode, OverviewView, OverviewGroup, OverviewFolder, OverviewLayout, OverviewRow,
    RowMetrics, KindFilter, KIND_FILTERS, TreeAttachments,
    emptyFilters, activeFilterCount, narrowing, overviewItems, overviewSummary, overviewGroups, overviewRows,
    rowsInView, stickyGroupAt, gridColumns, rangeKeys, personsShort, nameWithoutYears, parseViewPrefs,
    itemWithoutPerson, OverviewSummary, inMaterialFolder, firstFolderLine,
} from '../materials-overview.js';
import { materialThumbs, ThumbSnapshot } from '../material-thumbs.js';
import { formatBytesShort } from './originals-ui.js';
import {
    MaterialsOpenOptions, MaterialActionCtx, materialShortDate, materialStaleTime, materialTileLetters, materialItemSha, treeAttachmentsKey,
} from './materials-ui.js';
import { uiModule } from './module.js';

const MODAL_ID = 'materials-modal';
const VIEW_KEY = 'strom.materials.view';
const THUMB_PX = 256;
const SEARCH_DEBOUNCE_MS = 150;
const LONG_PRESS_MS = 500;
/** Rows drawn above and below the view (px). */
const OVERSCAN = 480;

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
    'clear-person': 'person', 'clear-kind': 'kind', 'clear-batch': 'batch',
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

function quoted(text: string): string {
    return getCurrentLanguage() === 'en' ? `“${text}”` : `„${text}“`;
}

function readPrefs(): { group: OverviewGroupMode; view: OverviewView } {
    try {
        return parseViewPrefs(localStorage.getItem(VIEW_KEY));
    } catch {
        return parseViewPrefs(null);
    }
}

function writePrefs(group: OverviewGroupMode, view: OverviewView): void {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ group, view })); } catch { /* blocked: this window only */ }
}

type PopKind = 'person' | 'kind' | 'batch' | 'sheet' | 'batchMenu' | 'folderMenu';

interface Win {
    gen: number;
    treeId: string;
    overlay: HTMLElement;
    scroller: HTMLElement;
    canvas: HTMLElement;
    sticky: HTMLElement;
    filters: OverviewFilters;
    group: OverviewGroupMode;
    view: OverviewView;
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
    loadingBatches: Set<string>;
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
    popKey: ((e: KeyboardEvent) => void) | null;
    popOutside: ((e: MouseEvent) => void) | null;
    pressTimer: ReturnType<typeof setTimeout> | null;
    suppressClick: boolean;
    width: number;
    bridgeUp: boolean;
    /** The gates the window was drawn with (a poll that changes nothing redraws nothing). */
    drawnCaps: string;
    /** The tree's attachments its items were built from (see treeAttachmentsKey). */
    drawnAttachments: string;
}

function capsKey(caps: { list: boolean; assign: boolean; thumb: boolean; bridgeUp: boolean; links?: boolean }, base: string | null): string {
    return `${caps.list}|${caps.assign}|${caps.thumb}|${caps.bridgeUp}|${caps.links !== false}|${base ?? ''}`;
}

let win: Win | null = null;
let generation = 0;

const alive = (gen: number): Win | null => (win && win.gen === gen ? win : null);

/** Every person's attachments with their REFN. */
function treeAttachments(): TreeAttachments[] {
    return DataManager.getAllPersons()
        .filter(p => (p.attachments?.length ?? 0) > 0)
        .map(p => ({ refn: researchPersonRef(p.refn), attachments: p.attachments ?? [] }));
}

/** REFN → name: the tree's person first, else what the research calls them. */
function namesOf(list: MaterialList | null): Map<string, string> {
    const names = new Map<string, string>();
    for (const [refn, name] of Object.entries(list?.people ?? {})) names.set(refn, name);
    for (const p of DataManager.getAllPersons()) {
        const refn = researchPersonRef(p.refn);
        if (refn) names.set(refn, `${p.firstName} ${p.lastName}`.trim() || names.get(refn) || refn);
    }
    return names;
}

function emptyLayout(): OverviewLayout {
    return { rows: [], height: 0, order: [], rowOf: new Map() };
}

export const materialsWindowMethods = uiModule({
    /** Fill the window `openMaterials` just put up (called once per opening). */
    initMaterialsWindow(opts: { group?: MaterialsOpenOptions['group']; person: string | null; batch: string | null }): void {
        this.teardownMaterialsWindow();
        const overlay = document.getElementById(MODAL_ID);
        const body = overlay?.querySelector<HTMLElement>('#materials-window-body');
        const ctx = this.materialsContext();
        if (!overlay || !body || !ctx) return;
        const prefs = readPrefs();
        const group: OverviewGroupMode = opts.group ?? prefs.group;
        overlay.dataset.group = group;
        body.innerHTML = `
            <div class="mw-status" hidden></div>
            <div class="mw-scroll">
                <div class="mw-sticky"></div>
                <div class="mw-empty" hidden></div>
                <div class="mw-canvas" role="grid" aria-labelledby="materials-title"></div>
            </div>
            <div class="mw-foot">
                <div class="mw-skipped" role="note" hidden></div>
                <div class="mw-thumbs" role="status" hidden></div>
                <div class="mw-selbar" role="region" hidden></div>
            </div>`;
        const filters = emptyFilters();
        filters.person = opts.person;
        filters.batch = opts.batch;
        const w: Win = {
            gen: ++generation,
            treeId: ctx.treeId,
            overlay,
            scroller: body.querySelector<HTMLElement>('.mw-scroll')!,
            canvas: body.querySelector<HTMLElement>('.mw-canvas')!,
            sticky: body.querySelector<HTMLElement>('.mw-sticky')!,
            filters,
            group,
            view: prefs.view,
            open: new Map(),
            focusBatch: opts.batch,
            selecting: false,
            selected: new Set(),
            anchor: null,
            lastPick: null,
            focusKey: null,
            loadedBatches: new Set(),
            loadingBatches: new Set(),
            loading: false,
            loadError: null,
            list: null,
            items: [],
            groups: [],
            layout: emptyLayout(),
            metrics: { view: 'grid', cols: 1, tileRow: 180, restoreExtra: 28, listRow: 48, group: 56, folder: 36, skeleton: 180, groupEnd: 12 },
            rendered: new Map(),
            names: new Map(),
            summary: { files: 0, batches: 0, noPerson: 0, hidden: 0 },
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
            pressTimer: null,
            suppressClick: false,
            width: 0,
            bridgeUp: ctx.caps.bridgeUp,
            drawnCaps: '',
            drawnAttachments: '',
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
        this.mwRebuild({ items: true });
        void primeMaterials(ctx.treeId).then(() => {
            if (!alive(w.gen)) return;
            this.mwRebuild({ items: true });
            void this.mwLoad();
        });
    },

    teardownMaterialsWindow(): void {
        const w = win;
        if (!w) return;
        this.mwClosePop();
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
        return w.items.filter(i => w.selected.has(i.key));
    },

    /** The remembered list or the bridge changed: redraw (quietly), ask again once the bridge runs. */
    refreshMaterialsWindow(): void {
        const w = win;
        if (!w || !document.getElementById(MODAL_ID)) return;
        const ctx = this.materialsContext();
        if (!ctx || ctx.treeId !== w.treeId) return;
        const cameUp = ctx.caps.bridgeUp && !w.bridgeUp;
        w.bridgeUp = ctx.caps.bridgeUp;
        const changed = capsKey(ctx.caps, ctx.base) !== w.drawnCaps || (cachedMaterials(w.treeId)?.list ?? null) !== w.list
            || treeAttachmentsKey() !== w.drawnAttachments;
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
        const ctx = this.materialsContext();
        if (!w || w.loading || !ctx?.caps.list || !ctx.caps.bridgeUp || !ctx.base) return;
        const gen = w.gen;
        const base = ctx.base;
        w.loading = true;
        w.loadError = null;
        try {
            const head = await fetchMaterial(base, { files0: true });
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
            const all = await fetchMaterial(base, {});
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

    /** One batch's files (`?batch=`), unless the whole list is known. */
    async mwLoadBatch(id: string): Promise<void> {
        const w = win;
        const ctx = this.materialsContext();
        if (!w || !ctx?.caps.bridgeUp || !ctx.base) return;
        if (cachedMaterials(w.treeId)?.full || w.loadedBatches.has(id) || w.loadingBatches.has(id)) return;
        const gen = w.gen;
        w.loadingBatches.add(id);
        try {
            const answer = await fetchMaterial(ctx.base, { batch: id });
            if (!alive(gen)) return;
            if (answer.ok) {
                w.loadedBatches.add(id);
                await saveMaterialList(w.treeId, answer.value, { kind: 'batch', batch: id });
            }
        } finally {
            alive(gen)?.loadingBatches.delete(id);
        }
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
        if (narrowing(w.filters) || w.group === 'date') return true;
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
        const cols = phone ? 3 : gridColumns(width, land ? 88 : 124, gap);
        const tile = (width - gap * (cols - 1)) / cols;
        // Under a tile: its name (2 lines) and its people; nothing on a phone (the name is in the viewer).
        const text = compact ? 0 : 57;
        const tileRow = Math.round(tile + text + gap);
        return {
            view: w.view,
            cols,
            tileRow,
            restoreExtra: 26,
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
        const ctx = this.materialsContext();
        if (!w || !ctx) return;
        const rec = cachedMaterials(w.treeId);
        const list = rec?.list ?? null;
        if (opts.items || list !== w.list) {
            w.list = list;
            w.drawnAttachments = treeAttachmentsKey();
            w.items = overviewItems(list, treeAttachments());
            w.names = namesOf(list);
            const keys = new Set(w.items.map(i => i.key));
            for (const k of [...w.selected]) if (!keys.has(k)) w.selected.delete(k);
        }
        // A research without assigning never sends hidden files; "Show hidden" is not offered.
        if (!ctx.caps.assign) w.filters.showHidden = false;
        w.summary = overviewSummary(w.items, list, !!rec?.full);
        w.groups = overviewGroups({
            items: w.items, list, filters: w.filters, mode: w.group,
            batchLoaded: id => !!rec?.full || w.loadedBatches.has(id),
        });
        w.drawnCaps = capsKey(ctx.caps, ctx.base);
        w.metrics = this.mwMetrics();
        w.layout = overviewRows(w.groups, key => this.mwIsOpen(key), w.metrics);
        w.overlay.dataset.group = w.group;
        w.overlay.classList.toggle('can-select', ctx.caps.assign);
        w.overlay.classList.toggle('is-selecting', w.selecting);
        w.overlay.classList.toggle('is-list', w.view === 'list');
        this.mwHeader();
        this.mwTools();
        this.mwStatus();
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

    /** The header's counts (or "Loading…"). */
    mwHeader(): void {
        const w = win!;
        const ctx = this.materialsContext();
        const el = w.overlay.querySelector<HTMLElement>('.mw-summary');
        if (!el || !ctx) return;
        const m = strings.materials;
        const rec = cachedMaterials(w.treeId);
        const s = w.summary;
        let text = '';
        if (!rec) text = ctx.caps.bridgeUp && !w.loadError ? m.loading : '';
        else if (w.filters.noPerson) text = m.summaryNoPerson(s.noPerson, s.files);
        else text = `${m.summary(s.files, s.batches, s.noPerson)}${w.filters.showHidden ? ` ${m.summaryHidden(s.hidden)}` : ''}`;
        el.textContent = text;
        el.title = text;
    },

    /** Filters, grouping, view and "Select" (the search field stays, it keeps its focus). */
    mwTools(): void {
        const w = win!;
        const ctx = this.materialsContext();
        const tools = w.overlay.querySelector<HTMLElement>('.mw-tools');
        if (!tools || !ctx) return;
        const m = strings.materials;
        const f = w.filters;
        const chip = (act: string, label: string, active: string | null, popup = true) => active
            ? `<span class="mw-chip is-active"><button type="button" class="mw-chip-main" data-mw="${act}"${popup ? ' aria-haspopup="dialog"' : ''}>${esc(active)}</button><button type="button" class="mw-chip-x" data-mw="clear-${act}" aria-label="${esc(`${m.removeFilter}: ${active}`)}">×</button></span>`
            : `<button type="button" class="mw-chip" data-mw="${act}" aria-haspopup="dialog">${esc(label)} <span aria-hidden="true">▾</span></button>`;
        const personName = f.person ? nameWithoutYears(w.names.get(f.person) ?? f.person) : '';
        const kindLabel = (k: KindFilter) => (k === 'none' ? m.kindNone : m.kind[k] ?? k);
        const batchName = f.batch ? (w.list?.batches.find(b => b.id === f.batch)?.name ?? f.batch) : '';
        const count = activeFilterCount(f);
        const toggle = (act: string, label: string, on: boolean) =>
            `<button type="button" class="mw-chip mw-toggle${on ? ' is-active' : ''}" data-mw="${act}" aria-pressed="${on}">${esc(label)}</button>`;
        const seg = (cls: string, aria: string, opts: { act: string; label: string; icon?: string; on: boolean }[]) =>
            `<div class="mw-seg ${cls}" role="group" aria-label="${esc(aria)}">${opts.map(o =>
                `<button type="button" data-mw="${o.act}" aria-pressed="${o.on}"${o.icon ? ` aria-label="${esc(o.label)}" title="${esc(o.label)}"` : ''}>${o.icon ? `<span class="mw-seg-icon" aria-hidden="true">${o.icon}</span>` : ''}<span class="mw-seg-text">${esc(o.label)}</span></button>`).join('')}</div>`;
        redraw(tools, `
            <div class="mw-chips">
                ${chip('person', m.fPerson, f.person ? m.filterChip(m.fPerson, personName) : null)}
                ${chip('kind', m.fKind, f.kinds.length ? m.filterChip(m.fKind, f.kinds.map(kindLabel).join(', ')) : null)}
                ${chip('batch', m.fBatch, f.batch ? m.filterChip(m.fBatch, batchName) : null)}
                ${toggle('noperson', `${m.noPerson} · ${w.summary.noPerson.toLocaleString(getCurrentLanguage())}`, f.noPerson)}
                ${ctx.caps.assign ? toggle('hidden', m.showHidden, f.showHidden) : ''}
                ${count ? `<button type="button" class="link-button mw-clear" data-mw="clear">${esc(m.clearFilters)}</button>` : ''}
            </div>
            <button type="button" class="mw-chip mw-filters-btn${count ? ' is-active' : ''}" data-mw="sheet" aria-haspopup="dialog">${esc(count ? m.filters(count) : m.filtersTitle)}</button>
            <span class="mw-gap"></span>
            ${seg('mw-seg-group', m.groupBy, [
                { act: 'group-batch', label: m.groupBatch, on: w.group === 'batch' },
                { act: 'group-date', label: m.groupDate, on: w.group === 'date' },
            ])}
            ${seg('mw-seg-view', m.viewAs, [
                { act: 'view-grid', label: m.grid, icon: '▦', on: w.view === 'grid' },
                { act: 'view-list', label: m.list, icon: '☰', on: w.view === 'list' },
            ])}
            ${ctx.caps.assign ? `<button type="button" class="mw-chip mw-select${w.selecting ? ' is-active' : ''}" data-mw="select" aria-pressed="${w.selecting}">${esc(w.selecting ? m.done : m.select)}</button>` : ''}`);
    },

    /** The strip above the content: not running (with the time), or the list's error. */
    mwStatus(): void {
        const w = win!;
        const ctx = this.materialsContext();
        const el = w.overlay.querySelector<HTMLElement>('.mw-status');
        if (!el || !ctx) return;
        const m = strings.materials;
        const rec = cachedMaterials(w.treeId);
        const start = this.researchStartUrl() ? `<button type="button" class="link-button materials-start" data-mw="start">${esc(strings.sync.startResearch.replace(' ↗', ''))}</button>` : '';
        let html = '';
        let state = 'live';
        if (rec && !ctx.caps.bridgeUp) {
            state = 'stale';
            html = `<span>${esc(m.stale(materialStaleTime(rec.list.fetchedAt || Date.now())))}</span>${start}`;
        } else if (w.loadError && ctx.caps.bridgeUp) {
            state = 'error';
            html = `<span>${esc(materialErrorText(w.loadError, ctx.agent))}</span><button type="button" class="link-button materials-start" data-mw="retry">${esc(m.retry)}</button>`;
        }
        w.overlay.dataset.state = !rec && !ctx.caps.bridgeUp ? 'nocache' : !rec ? 'loading' : state;
        el.hidden = !html;
        el.setAttribute('role', 'status');
        el.innerHTML = html;
    },

    /** Nothing to show: loading (skeleton), not running without memory, or no match. */
    mwEmpty(): 'skeleton' | 'nocache' | 'nomatch' | null {
        const w = win!;
        const ctx = this.materialsContext();
        const el = w.overlay.querySelector<HTMLElement>('.mw-empty');
        if (!el || !ctx) return null;
        const m = strings.materials;
        const rec = cachedMaterials(w.treeId);
        let kind: 'skeleton' | 'nocache' | 'nomatch' | null = null;
        let html = '';
        if (!rec && ctx.caps.bridgeUp && !w.loadError) {
            kind = 'skeleton';
            const square = '<span class="mw-skel-tile"></span>';
            const head = '<div class="mw-skel-head"><span></span><span></span></div>';
            html = `${head}<div class="mw-skel-row">${square.repeat(5)}</div>${head}${head}`;
        } else if (!rec && !ctx.caps.bridgeUp) {
            kind = 'nocache';
            const start = this.researchStartUrl() ? `<button type="button" class="primary btn-sm" data-mw="start">${esc(strings.sync.startResearch.replace(' ↗', ''))}</button>` : '';
            html = `<p>${esc(m.loadWhenRunning)}</p>${start}`;
        } else if (rec && w.groups.length === 0) {
            kind = 'nomatch';
            html = `<p>${esc(m.noMatch)}</p>${activeFilterCount(w.filters) || w.filters.query ? `<button type="button" class="link-button" data-mw="clear">${esc(m.clearFilters)}</button>` : ''}`;
        }
        el.hidden = !kind;
        el.className = `mw-empty${kind ? ` is-${kind}` : ''}`;
        el.setAttribute('aria-hidden', kind === 'skeleton' ? 'true' : 'false');
        el.innerHTML = html;
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
            case 'tree': return cachedMaterials(win?.treeId) ? m.inTreeGroup : m.inTreeAttachments;
            case 'earlier': return m.earlier;
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
            return [materialShortDate(b.at), people.length ? m.forPersons(people) : '', b.note ? quoted(b.note) : '']
                .filter(Boolean).join(' · ');
        }
        if (group.kind === 'loose') {
            const froms = (group.froms ?? []).map(k => m.from[k]).filter(Boolean);
            return froms.length ? `${m.looseSub} · ${joinAnd(lang, froms)}` : m.looseSub;
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
        if (itemWithoutPerson(item)) return { text: strings.materials.noPerson, none: true };
        return { text: personsShort(item.persons, refn => w.names.get(refn) ?? null), none: false };
    },

    mwThumbHtml(item: MaterialItem, group: OverviewGroup, small: boolean): string {
        const m = strings.materials;
        const att = item.attachment;
        const hiddenLabel = item.hidden ? m.hiddenLabel[item.hidden.reason ?? 'none'] ?? m.hiddenLabel.none : '';
        const label = hiddenLabel && !small ? `<span class="mw-hidden-label">${esc(hiddenLabel)}</span>` : '';
        const check = '<span class="mw-check" aria-hidden="true"></span>';
        const cls = `mw-thumb${item.hidden ? ' is-hidden' : ''}`;
        if (att && !att.originalOnly && att.mimeType.startsWith('image/') && att.dataUrl) {
            return `<span class="${cls} has-thumb"><img src="${esc(att.dataUrl)}" alt="" loading="lazy">${label}${check}</span>`;
        }
        const sha = materialItemSha(item);
        const letters = `<span class="mw-type">${esc(materialTileLetters(item))}</span>`;
        const lazy = !!sha && item.origin !== 'tree' && ['image', 'pdf'].includes(materialType(item.mime, item.title));
        if (!lazy || !sha) return `<span class="${cls}">${letters}${label}${check}</span>`;
        const ready = materialThumbs().urlOf(sha, THUMB_PX);
        const img = ready ? `<img src="${esc(ready)}" alt="">` : letters;
        return `<span class="${cls}${ready ? ' has-thumb' : ''}"${ready ? '' : ` data-sha="${esc(sha)}" data-group="${esc(group.key)}" data-item="${esc(item.key)}"`}>${img}${label}${check}</span>`;
    },

    mwAriaLabel(item: MaterialItem): string {
        const m = strings.materials;
        const persons = this.mwPersons(item).text;
        const hidden = item.hidden ? m.hiddenLabel[item.hidden.reason ?? 'none'] ?? m.hiddenLabel.none : '';
        return [item.title, persons, hidden].filter(Boolean).join(', ');
    },

    mwRestoreHtml(item: MaterialItem): string {
        const ctx = this.materialsContext();
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
            <span class="mw-tile-title" title="${esc(item.title)}">${esc(item.title)}</span>
            <span class="mw-tile-persons${persons.none ? ' is-none' : ''}">${esc(persons.text)}</span>
            ${this.mwRestoreHtml(item)}
        </div>`;
    },

    mwListRowHtml(item: MaterialItem, group: OverviewGroup): string {
        const w = win!;
        const m = strings.materials;
        const persons = this.mwPersons(item);
        const selected = w.selected.has(item.key);
        const kind = item.hidden ? `${materialKindLabel(item)} · ${m.hiddenLabel[item.hidden.reason ?? 'none'] ?? m.hiddenLabel.none}` : materialKindLabel(item);
        return `<div class="mw-li${selected ? ' is-selected' : ''}${item.hidden ? ' is-hidden' : ''}" role="gridcell" tabindex="-1" data-key="${esc(item.key)}" aria-label="${esc(this.mwAriaLabel(item))}"${w.selecting ? ` aria-selected="${selected}"` : ''}>
            <span class="mw-li-check"><span class="mw-check" aria-hidden="true"></span></span>
            ${this.mwThumbHtml(item, group, true)}
            <span class="mw-li-title" title="${esc(item.title)}">${esc(item.title)}</span>
            <span class="mw-li-kind" title="${esc(kind)}">${esc(kind)}</span>
            <span class="mw-li-persons${persons.none ? ' is-none' : ''}">${esc(persons.text)}</span>
            <span class="mw-li-size">${item.bytes ? esc(formatBytesShort(item.bytes)) : ''}</span>
            <span class="mw-li-at">${item.hidden && this.mwRestoreHtml(item) ? this.mwRestoreHtml(item) : esc(materialShortDate(item.at))}</span>
        </div>`;
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
        materialThumbs().want(
            { sha, px: THUMB_PX, mime: item?.mime, name: item?.file?.name ?? item?.title, bytes: item?.bytes, where: group ? this.mwGroupName(group) : '' },
            url => {
                if (!url || !el.isConnected) return;
                const type = el.querySelector('.mw-type');
                const img = document.createElement('img');
                img.src = url;
                img.alt = '';
                if (type) type.replaceWith(img); else el.prepend(img);
                el.classList.add('has-thumb');
            },
            () => el.isConnected && el.dataset.vis === '1',
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
            <span class="mw-progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
            <span class="mw-thumbs-text">${esc(text)}</span>
            <button type="button" class="link-button mw-thumbs-toggle" data-mw="${s.phase === 'paused' ? 'thumbs-resume' : 'thumbs-pause'}">${esc(s.phase === 'paused' ? m.resume : m.pause)}</button>`);
    },

    // ==================== SELECTING ====================

    /** Selection marks, the bar and the phone header (`marks`: also the drawn tiles). */
    mwSelectionChanged(marks = true): void {
        const w = win;
        const ctx = this.materialsContext();
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
        const tree = items.filter(i => i.origin === 'tree').length;
        skipped.hidden = !w.selecting || tree === 0;
        skipped.textContent = tree ? m.skippedTree(tree) : '';
        if (!w.selecting) { bar.innerHTML = ''; return; }
        const archive = items.filter(i => i.origin !== 'tree');
        const onlyHidden = archive.length > 0 && archive.every(i => i.hidden);
        const off = (why: string | null) => (why ? ` aria-disabled="true" title="${esc(why)}"` : '');
        const why = !ctx.caps.bridgeUp ? m.actionsWhenRunning : archive.length === 0 ? (n ? m.skippedTree(tree) : m.nothingSelected) : null;
        const whole = this.mwWholeTarget();
        bar.setAttribute('aria-label', n ? m.selected(n) : m.nothingSelected);
        redraw(bar, `
            <span class="mw-selcount">${esc(n ? m.selected(n) : m.nothingSelected)}</span>
            <span class="mw-selacts">
                <button type="button" class="primary mw-selbtn" data-mw="sel-assign"${off(why)}>${esc(m.assign)}</button>
                <button type="button" class="secondary mw-selbtn" data-mw="${onlyHidden ? 'sel-restore' : 'sel-hide'}"${off(why)}>${esc(onlyHidden ? m.restore : m.hide)}</button>
            </span>
            <span class="mw-gap"></span>
            ${whole ? `<button type="button" class="link-button mw-selwhole" data-mw="sel-whole">${esc(whole.label)}</button>` : ''}
            <button type="button" class="link-button mw-selclear" data-mw="sel-clear">${esc(m.clearSelection)}</button>`);
        // On a phone held sideways the bar is one row: the content keeps its height free below.
        w.scroller.style.paddingBottom = '';
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

    mwToggleSelect(key: string, on?: boolean): void {
        const w = win;
        if (!w) return;
        w.selecting = true;
        const next = on ?? !w.selected.has(key);
        if (next) w.selected.add(key); else w.selected.delete(key);
        w.anchor = key;
        this.mwSelectionChanged();
    },

    mwSelectKeys(keys: string[]): void {
        const w = win;
        if (!w) return;
        w.selecting = true;
        for (const k of keys) w.selected.add(k);
        this.mwSelectionChanged();
    },

    mwCanSelect(): boolean {
        return !!this.materialsContext()?.caps.assign;
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
        this.openMaterialItems(items, index, { where: 'window', label: personName ? strings.materials.ctxPerson(personName) : group ? this.mwGroupName(group) : '' });
    },

    mwRun(id: MaterialActionId, items: MaterialItem[], ctx: MaterialActionCtx): void {
        this.materialAction(id, items, { where: 'window', ...ctx });
    },

    /** A batch's (or its folder's) actions (3b). */
    mwBatchActions(group: OverviewGroup, folder: OverviewFolder | undefined): { id: string; label: string; writes?: boolean; divider?: boolean }[] {
        const ctx = this.materialsContext();
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
        if (ctx.caps.links !== false) rows.push({ id: 'research', label: strings.batch.openInResearch, divider: rows.length > 0 });
        return rows;
    },

    /** The batch's files (loaded first when not known), optionally one folder's. */
    async mwBatchItems(batch: MaterialBatch, folderLabel?: string): Promise<MaterialItem[]> {
        await this.mwLoadBatch(batch.id);
        const w = win;
        if (!w) return [];
        this.mwRebuild();
        return w.items.filter(i => i.batch?.id === batch.id && !i.hidden
            && (folderLabel === undefined || inMaterialFolder(i.path, folderLabel)));
    },

    async mwBatchAction(id: string, group: OverviewGroup, folder: OverviewFolder | undefined): Promise<void> {
        const w = win;
        const batch = group.batch;
        if (!w || !batch) return;
        const folderCtx = folder ? { folder: { batch: batch.id, path: folder.label } } : {};
        switch (id) {
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
                const ctx = this.materialsContext();
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
        const menu = kind === 'batchMenu' || kind === 'folderMenu';
        pop.setAttribute('role', menu ? 'menu' : 'dialog');
        if (!menu) pop.setAttribute('aria-label', kind === 'sheet' ? m.filtersTitle : kind === 'person' ? m.fPerson : kind === 'kind' ? m.fKind : m.fBatch);
        w.overlay.appendChild(pop);
        w.pop = pop;
        w.popKind = kind;
        w.popAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        if (menu) this.mwFillMenu(pop, data);
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
            if (pop.contains(t) || anchor.contains(t) || (t as HTMLElement).closest?.('.person-picker-dropdown')) return;
            this.mwClosePop();
        };
        document.addEventListener('keydown', w.popKey, true);
        document.addEventListener('mousedown', w.popOutside, true);
        if (kind === 'person') w.picker?.focusInput();
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
        const ctx = this.materialsContext();
        const group = w.groups.find(g => g.key === data.group);
        const folder = data.folder ? group?.folders.find(f => f.key === data.folder) : undefined;
        if (!group || !ctx) return;
        const m = strings.materials;
        const actions = this.mwBatchActions(group, folder);
        pop.innerHTML = actions.map(a => {
            const divider = a.divider ? '<div class="materials-item-menu-divider" role="separator"></div>' : '';
            const off = a.writes && !ctx.caps.bridgeUp ? ` aria-disabled="true" title="${esc(m.actionsWhenRunning)}"` : '';
            return `${divider}<button type="button" role="menuitem" class="materials-item-menu-row" data-action="${a.id}"${off}>${esc(a.label)}</button>`;
        }).join('');
        pop.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.getAttribute('aria-disabled') === 'true') return;
            const back = w.popAnchor;
            this.mwClosePop();
            back?.focus();
            void this.mwBatchAction(btn.dataset.action ?? '', group, folder);
        }));
    },

    /** The filter popovers (wide) and the filters sheet (≤ 1024). */
    mwFillFilters(pop: HTMLElement, kind: PopKind): void {
        const w = win!;
        const ctx = this.materialsContext();
        if (!ctx) return;
        const m = strings.materials;
        const f = w.filters;
        const sheet = kind === 'sheet';
        const parts: string[] = [];
        if (kind === 'person' || sheet) {
            const current = f.person ? nameWithoutYears(w.names.get(f.person) ?? f.person) : '';
            parts.push(`<div class="mw-pop-section">
                ${sheet ? `<div class="mw-pop-title">${esc(m.fPerson)}</div>` : ''}
                ${current ? `<span class="mw-chip is-active"><span class="mw-chip-main">${esc(current)}</span><button type="button" class="mw-chip-x" data-pop="clear-person" aria-label="${esc(`${m.removeFilter}: ${current}`)}">×</button></span>` : ''}
                <div id="mw-person-picker" class="mw-person-picker"></div>
            </div>`);
        }
        if (kind === 'kind' || sheet) {
            parts.push(`<div class="mw-pop-section" role="group" aria-label="${esc(m.fKind)}">
                ${sheet ? `<div class="mw-pop-title">${esc(m.fKind)}</div>` : ''}
                ${KIND_FILTERS.map(k => `<label class="mw-check-row"><input type="checkbox" data-pop="kind" value="${k}"${f.kinds.includes(k) ? ' checked' : ''}> ${esc(k === 'none' ? m.kindNone : m.kind[k] ?? k)}</label>`).join('')}
            </div>`);
        }
        if (kind === 'batch' || sheet) {
            const batches = [...(w.list?.batches ?? [])].sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0));
            parts.push(`<div class="mw-pop-section" role="radiogroup" aria-label="${esc(m.fBatch)}">
                ${sheet ? `<div class="mw-pop-title">${esc(m.fBatch)}</div>` : ''}
                <label class="mw-check-row"><input type="radio" name="mw-batch" data-pop="batch" value=""${f.batch ? '' : ' checked'}> ${esc(m.allBatches)}</label>
                ${batches.map(b => `<label class="mw-check-row"><input type="radio" name="mw-batch" data-pop="batch" value="${esc(b.id)}"${f.batch === b.id ? ' checked' : ''}> <span class="mw-check-text">${esc(b.name)}</span></label>`).join('')}
            </div>`);
        }
        if (sheet) {
            const toggle = (act: string, label: string, on: boolean) =>
                `<button type="button" class="mw-chip mw-toggle${on ? ' is-active' : ''}" data-pop="${act}" aria-pressed="${on}">${esc(label)}</button>`;
            parts.push(`<div class="mw-pop-section mw-pop-toggles">
                ${toggle('noperson', `${m.noPerson} · ${w.summary.noPerson.toLocaleString(getCurrentLanguage())}`, f.noPerson)}
                ${ctx.caps.assign ? toggle('hidden', m.showHidden, f.showHidden) : ''}
            </div>`);
            parts.push(`<div class="mw-pop-section">
                <div class="mw-pop-title">${esc(m.groupBy)}</div>
                <div class="mw-seg" role="group" aria-label="${esc(m.groupBy)}">
                    <button type="button" data-pop="group-batch" aria-pressed="${w.group === 'batch'}">${esc(m.groupBatch)}</button>
                    <button type="button" data-pop="group-date" aria-pressed="${w.group === 'date'}">${esc(m.groupDate)}</button>
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
                filter: p => !!researchPersonRef(p.refn),
                onSelect: (id) => {
                    const refn = researchPersonRef(DataManager.getPerson(id)?.refn);
                    if (!refn) return;
                    w.filters.person = refn;
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
            switch (btn.dataset.pop) {
                case 'clear-person': w.filters.person = null; break;
                case 'noperson': w.filters.noPerson = !w.filters.noPerson; break;
                case 'hidden': w.filters.showHidden = !w.filters.showHidden; break;
                case 'group-batch': this.mwSetGroup('batch'); break;
                case 'group-date': this.mwSetGroup('date'); break;
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
        this.mwRebuild();
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
            const btn = (e.target as HTMLElement).closest<HTMLElement>('.mw-tools [data-mw]');
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
            case 'sheet': this.mwOpenPop('sheet', btn); return;
            case 'clear-person': f.person = null; break;
            case 'clear-kind': f.kinds = []; break;
            case 'clear-batch': f.batch = null; w.focusBatch = null; break;
            case 'noperson': f.noPerson = !f.noPerson; break;
            case 'hidden': f.showHidden = !f.showHidden; break;
            case 'clear': this.mwClearFilters(); break;
            case 'group-batch': this.mwSetGroup('batch'); break;
            case 'group-date': this.mwSetGroup('date'); break;
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
        w.canvas.addEventListener('keydown', (e) => this.mwKeydown(e));
        w.canvas.addEventListener('focusin', (e) => {
            const cell = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"][data-key]');
            if (cell?.dataset.key) { w.focusKey = cell.dataset.key; this.mwRoving(); }
        });
        // Touch: a long press starts selecting with the item.
        w.canvas.addEventListener('pointerdown', (e) => {
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
                case 'sel-assign': case 'sel-hide': case 'sel-restore': {
                    if (disabled) return;
                    const items = this.materialsSelection().filter(i => i.origin !== 'tree');
                    const id: MaterialActionId = act.dataset.mw === 'sel-assign' ? 'assign' : act.dataset.mw === 'sel-hide' ? 'hide' : 'restore';
                    this.mwRun(id, items, { selection: true });
                    return;
                }
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
        this.mwOpenItem(key);
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
            case 'Enter': e.preventDefault(); this.mwOpenItem(key); break;
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
