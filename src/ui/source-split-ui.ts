/**
 * "Split as suggested…" (spec 075 §5): the offer lines of the Sources manager
 * and the Table's Sources view, the dialog with its preview, the toast with
 * Undo and the dialog's undo row.
 *
 * Everything here reads one interface, `SplitProvider` (src/source-split.ts):
 * the app itself for a tree without a research (one undo step, Ctrl+Z too),
 * the research's bridge for a research tree (`sources.split`: the preview
 * read when the Sources manager or the Table's Sources view opens, kept until
 * the research's head moves; the split and its undo written by the research,
 * its version then taken quietly). A research tree is never split here: its
 * research not running or without `sources.split` it is `needsResearch` (a
 * quiet sentence in the Sources manager, nothing in the Table).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatShortDateTime } from '../format.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import {
    localSplitPlan, localSplitPreview, splitOffer, splitPreviewMark, withSourcePlaces,
    type LocalSplitPlan, type SplitPreview, type SplitReadResult, type SplitProvider, type SplitRow, type SplitSourceKind, type SplitState, type SplitUndoInfo,
} from '../source-split.js';
import type { StromData } from '../types.js';
import { SOURCES_SPLIT_FEATURE } from '../research-link.js';
import { ownWriteHeadTarget } from '../research-sync.js';
import { diffValues } from '../research-changes.js';
import { getBridgeSplit, postBridgeSplit, postBridgeSplitUndo, type BridgeSplitReading } from '../source-split-bridge.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { bridgeBase } from './history-ui.js';
import { uiModule } from './module.js';

export const SOURCE_SPLIT_DIALOG_ID = 'source-split-modal';

/** The toast with Undo after a split stands this long. */
const TOAST_MS = 8000;
/** Rows read in at a time once "Show all" is on (more on scroll). */
const PAGE_ROWS = 50;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function matches(q: string): boolean {
    try { return window.matchMedia?.(q).matches ?? false; } catch { return false; }
}

/** The dialog's layout: a phone (cards, 3), a phone held sideways (table, 4), else a table of 6. */
type Layout = 'phone' | 'land' | 'wide';
function layoutNow(): Layout {
    return matches(MQ_MOBILE) ? 'phone' : matches(MQ_PHONE_LANDSCAPE) ? 'land' : 'wide';
}
const FIRST_ROWS: Record<Layout, number> = { phone: 3, land: 4, wide: 6 };

// ---- The local source (a tree without a research) ----

/** The local plan of the open data, computed once per data revision. */
const localPlans = new WeakMap<StromData, { rev: number; plan: LocalSplitPlan; preview: SplitPreview }>();

function localPlanNow(): { plan: LocalSplitPlan; preview: SplitPreview } {
    const data = DataManager.getData();
    const rev = DataManager.getRevision();
    const hit = localPlans.get(data);
    if (hit && hit.rev === rev) return hit;
    const plan = localSplitPlan(Object.values(data.sources ?? {}));
    const entry = { rev, plan, preview: localSplitPreview(plan) };
    localPlans.set(data, entry);
    return entry;
}

const localUndoId = (at: number): string => `local-${at}`;

/** The local split that can be undone: while it is the last step of the undo history. */
function localUndoNow(): SplitUndoInfo | null {
    const mark = DataManager.lastUndoMark();
    return mark?.kind === 'sourcesSplit' ? { id: localUndoId(mark.at), at: mark.at, count: mark.count } : null;
}

// ---- The research's bridge (a research tree whose bridge offers `sources.split`) ----

/** The bridge's last reading for a research at its head (`archive`: it said the tree is an archive). */
interface BridgeCache {
    rid: string;
    head: string;
    state: SplitState | null;
    archive: boolean;
}

let bridgeCache: BridgeCache | null = null;
/** A reading on its way (one at a time per research and head) and who waits for it. */
let bridgeReading: { rid: string; head: string; waiters: (() => void)[] } | null = null;

const bridgeState = (reading: BridgeSplitReading): SplitState => ({ kind: 'bridge', preview: reading.preview, undo: reading.undo });

/** Nothing left to split, the split just done to undo: what the bridge says right after a split. */
const afterSplit = (undo: SplitUndoInfo | null): SplitState => ({
    kind: 'bridge', undo,
    preview: { rows: [], count: 0, complete: true, unrecognized: 0, unrecognizedExamples: [], fromNote: 0 },
});

// ---- The dialog's state ----

interface DialogState {
    provider: SplitProvider;
    state: SplitState;
    /** Reading the state (the bridge's first reading). */
    loading: boolean;
    /** The split or its undo at work (the bridge: the progress bar). */
    busy: boolean;
    error: { text: string; retry?: 'read' | 'apply' | 'undo' } | null;
    /** "Show all" is on: the rows read in so far (`shown`), more on scroll. */
    all: boolean;
    shown: number;
    layout: Layout;
    opener: HTMLElement | null;
}

let dialog: DialogState | null = null;
let resizeWatch: (() => void) | null = null;

/** The value cell of a field after the split: new, left as it was (the field was filled), or none. */
function afterCell(after: string | undefined, before: string | undefined, tag?: string): { text: string; cls: string; tag: string } {
    const a = after?.trim();
    if (!a) return { text: '—', cls: 'is-none', tag: '' };
    if (tag) return { text: a, cls: '', tag };
    if (a === before?.trim()) return { text: a, cls: 'is-kept', tag: strings.sources.split.kept };
    return { text: a, cls: '', tag: '' };
}

/** The cells of a row after the split: folio, image, other location (and the call number, local with a note line). */
function rowCells(r: SplitRow, withCallNumber: boolean): { label: string; text: string; cls: string; tag: string }[] {
    const t = strings.sources.split;
    const cells = [
        { label: t.colFolio, ...afterCell(r.after.folio, r.before.folio) },
        { label: t.colImage, ...afterCell(r.after.image, r.before.image) },
        { label: t.colRest, ...afterCell(r.after.reference, undefined) },
    ];
    if (withCallNumber) cells.push({ label: t.colCallNumber, ...afterCell(r.after.callNumber, r.before.callNumber, r.callNumberFromNote ? t.fromNote : undefined) });
    return cells;
}

export const sourceSplitMethods = uiModule({
    /**
     * Where the split comes from for the open tree. A research tree: the
     * research's bridge while it runs and says `sources.split` (else
     * `needsResearch`), `archive` for a research in the archive (also when
     * its bridge said so at this head).
     */
    sourceSplitKind(): SplitSourceKind {
        if (!DataManager.getCurrentTreeId() || DataManager.isReadOnly() || DataManager.isTreeLocked()) return 'none';
        const ctx = this.researchSyncLink();
        if (!ctx) return 'local';
        if (this.activeResearchArchive()) return 'archive';
        const rid = ctx.link.id;
        if (bridgeCache?.rid === rid && bridgeCache.archive && bridgeCache.head === this.researchHeadNow(rid)) return 'archive';
        const up = !!bridgeBase(rid) && this.researchBridgeUp(rid);
        return up && this.researchStatusOf(rid)?.features?.includes(SOURCES_SPLIT_FEATURE) ? 'bridge' : 'needsResearch';
    },

    /** The split's source for the open tree, or null when none is offered (`sourceSplitKind`). */
    sourceSplitProvider(): SplitProvider | null {
        const kind = this.sourceSplitKind();
        if (kind === 'local') return this.sourceSplitLocal();
        const rid = this.researchSyncLink()?.link.id;
        return kind === 'bridge' && rid ? this.sourceSplitBridge(rid) : null;
    },

    /**
     * The research's split through its bridge: the preview (`GET
     * /sources/split`, kept until its head moves), the split on the click
     * (`POST /sources/split {plan}`) and its undo, written by the research as
     * the user's; its version then taken quietly (sourceSplitTakeVersion).
     * Nothing is split in the app.
     */
    sourceSplitBridge(rid: string): SplitProvider {
        const t = strings.sources.split;
        const down = strings.history.storiesBridgeDown;
        const keep = (head: string, state: SplitState | null, archive = false): void => { bridgeCache = { rid, head, state, archive }; };
        const read = async (all = false): Promise<SplitReadResult> => {
            const base = bridgeBase(rid);
            if (!base) return { ok: false, error: 'failed', reason: down };
            const head = this.researchHeadNow(rid);
            const r = await getBridgeSplit(base, all);
            if (r.ok) {
                const state = bridgeState(r.reading);
                keep(head, state);
                return { ok: true, state };
            }
            if (r.code === 'archive') {
                keep(head, null, true);
                return { ok: false, error: 'archive' };
            }
            // Not read at this head: not asked again until it moves (the dialog's Try again asks).
            if (bridgeCache?.rid !== rid || bridgeCache.head !== head) keep(head, null);
            return { ok: false, error: r.code === 'busy' ? 'busy' : 'failed', ...(r.code === 'network' ? { reason: down } : {}) };
        };
        return {
            kind: 'bridge',
            state: () => (bridgeCache?.rid === rid && bridgeCache.state) || { kind: 'bridge', preview: null, undo: null },
            read,
            apply: async (preview) => {
                const plan = preview.plan;
                if (!plan) return { ok: false, error: 'failed' };
                const before = this.researchHeadNow(rid);
                const r = await this.postResearchBridgeWrite(base => postBridgeSplit(base, plan), { load: false });
                if (!r) return { ok: false, error: 'failed', reason: down };
                if (r.ok) {
                    const undo = r.undo ? { id: r.undo, at: Date.now(), count: r.count } : null;
                    keep(r.head || before, afterSplit(undo));
                    void this.sourceSplitTakeVersion(rid, before, r.head, r.parent);
                    return { ok: true, count: r.count, undo };
                }
                if (r.code === 'plan') {
                    if (r.reading) {
                        keep(this.researchHeadNow(rid), bridgeState(r.reading));
                        return { ok: false, error: 'plan', preview: r.reading.preview };
                    }
                    const again = await read();
                    return again.ok && again.state.preview ? { ok: false, error: 'plan', preview: again.state.preview } : { ok: false, error: 'failed' };
                }
                if (r.code === 'archive') {
                    keep(this.researchHeadNow(rid), null, true);
                    return { ok: false, error: 'archive' };
                }
                return { ok: false, error: r.code === 'busy' ? 'busy' : 'failed', ...(r.code === 'network' ? { reason: down } : {}) };
            },
            undo: async (info) => {
                const before = this.researchHeadNow(rid);
                const r = await this.postResearchBridgeWrite(base => postBridgeSplitUndo(base, info.id), { load: false });
                if (!r) return { ok: false, error: 'failed', reason: down };
                if (r.ok) {
                    // The preview comes back: read again at the next look.
                    bridgeCache = null;
                    void this.sourceSplitTakeVersion(rid, before, r.head, r.parent);
                    return { ok: true, restored: r.restored };
                }
                if (r.code === 'changed') return { ok: false, error: 'changed', count: r.count, titles: r.titles };
                if (r.code === 'gone') return { ok: false, error: 'failed', reason: t.errUndoLater };
                return { ok: false, error: r.code === 'busy' ? 'busy' : 'failed', ...(r.code === 'network' ? { reason: down } : {}) };
            },
        };
    },

    /**
     * The bridge's preview for the offer lines, read once per research head
     * (the Sources manager or the Table's Sources view opened, the head
     * moved); `then` redraws the line once it is in.
     */
    sourceSplitBridgeFresh(then: () => void): void {
        if (this.sourceSplitKind() !== 'bridge') return;
        const rid = this.researchSyncLink()?.link.id;
        if (!rid) return;
        const head = this.researchHeadNow(rid);
        if (bridgeCache?.rid === rid && bridgeCache.head === head) return;
        if (bridgeReading?.rid === rid && bridgeReading.head === head) {
            bridgeReading.waiters.push(then);
            return;
        }
        const reading = { rid, head, waiters: [then] };
        bridgeReading = reading;
        void this.sourceSplitBridge(rid).read(false).finally(() => {
            if (bridgeReading === reading) bridgeReading = null;
            for (const fn of reading.waiters) fn();
        });
    },

    /**
     * After a split or its undo through the bridge: the research's version
     * taken quietly when the tree was in step with the research before the
     * write (its head the tree's, ownWriteHeadTarget), nothing of the app's
     * own waits to be sent, and the version differs only in the sources'
     * places. Else the version waits as any newer one (its head noted).
     */
    async sourceSplitTakeVersion(rid: string, before: string, head: string, parent: string): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx || ctx.link.id !== rid || !head) return;
        const { treeId, link } = ctx;
        if (!ownWriteHeadTarget(link, before, head, parent)) return;
        const fps = this.researchSyncFingerprints(treeId, link);
        if (!fps.matchesBase && fps.current !== link.sent?.fingerprint) return;
        const version = await this.researchVersionRead(true);
        if (!version || DataManager.getCurrentTreeId() !== treeId) return;
        if (version.header.head && version.header.head !== head) return;
        const there = this.researchVersionAsLoaded(version.data);
        if (diffValues(withSourcePlaces(DataManager.getData(), there), there).rows.length > 0) return;
        if (!await this.ensureLocalUnlocked()) return;
        await this.applyResearch(version.data, version.header, { force: true, quiet: true, head });
        this.sourceSplitLinesAgain();
    },

    /** The app's own split: the plan of the data now, applied as one undo step. */
    sourceSplitLocal(): SplitProvider {
        const state = (): SplitState => ({ kind: 'local', preview: localPlanNow().preview, undo: localUndoNow() });
        return {
            kind: 'local',
            state,
            read: async () => ({ ok: true, state: state() }),
            apply: async (preview) => {
                const now = localPlanNow();
                // The sources changed since the preview was shown (a live change, another window): the preview as it is now.
                if (splitPreviewMark(now.preview.rows) !== splitPreviewMark(preview.rows)) return { ok: false, error: 'plan', preview: now.preview };
                const mark = DataManager.splitSourcePlaces(now.plan.changes.map(c => c.source));
                if (!mark) return { ok: false, error: 'failed' };
                return { ok: true, count: mark.count, undo: { id: localUndoId(mark.at), at: mark.at, count: mark.count } };
            },
            undo: async (info) => {
                const now = localUndoNow();
                if (!now || now.id !== info.id) return { ok: false, error: 'failed', reason: strings.sources.split.errUndoLater };
                this.performUndo();
                return { ok: true, restored: now.count };
            },
        };
    },

    /** What the offer lines and the dialog show now. */
    sourceSplitState(): SplitState {
        const provider = this.sourceSplitProvider();
        if (provider) return provider.state();
        const kind = this.sourceSplitKind();
        // A research tree not split here: the app's reading of its copy says whether there is anything to split at all.
        return { kind, preview: kind === 'needsResearch' ? localPlanNow().preview : null, undo: null };
    },

    /** The Sources manager's line (under the images' line): the offer, the research needed, the split done; else hidden. */
    renderSourceSplitBar(): void {
        const box = document.getElementById('sources-split-bulk');
        if (!box) return;
        this.sourceSplitBridgeFresh(() => this.renderSourceSplitBar());
        const offer = splitOffer(this.sourceSplitState(), 'sources');
        const t = strings.sources.split;
        if (offer.line === 'hidden') {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        if (offer.line === 'needsResearch') {
            box.innerHTML = `<p class="sources-split-quiet">${esc(t.needsResearch)}</p>`;
            return;
        }
        const text = offer.line === 'offer' ? t.offer(offer.count) : t.doneLine(formatShortDateTime(offer.undo.at, getCurrentLanguage()), offer.undo.count);
        const action = offer.line === 'offer' ? t.open : t.undoOpen;
        box.innerHTML = `<div class="sources-bulk-line sources-split-line"><span>${esc(text)}</span>`
            + `<button type="button" class="link-button" id="sources-split-open">${esc(action)}</button></div>`;
        box.querySelector('#sources-split-open')?.addEventListener('click', () => this.openSourceSplit());
    },

    /** The Table's line over the Sources view: the offer only (§3). */
    renderTableSplitBar(el: HTMLElement, rowType: string): void {
        if (rowType === 'sources') this.sourceSplitBridgeFresh(() => { if (el.isConnected) this.renderTableSplitBar(el, rowType); });
        const offer = rowType === 'sources' ? splitOffer(this.sourceSplitState(), 'table') : { line: 'hidden' as const };
        if (offer.line !== 'offer') {
            el.hidden = true;
            el.innerHTML = '';
            return;
        }
        const t = strings.sources.split;
        const key = `${getCurrentLanguage()}|${offer.count}`;
        el.hidden = false;
        if (el.dataset.key === key && el.firstChild) return;
        el.dataset.key = key;
        el.innerHTML = `<span class="table-bulk-text">${esc(t.offer(offer.count))}</span>`
            + `<button type="button" class="link-button table-bulk-open">${esc(t.open)}</button>`;
        el.querySelector('.table-bulk-open')?.addEventListener('click', () => this.openSourceSplit());
    },

    /** After the tree's data changed under the split (an undo, a redo, a split): the lines and an open dialog again. */
    sourceSplitTreeChanged(): void {
        if (document.getElementById('sources-modal')?.classList.contains('active')) this.renderSourcesList();
        const st = dialog;
        if (st && !st.busy && st.provider.kind === 'local') {
            st.state = st.provider.state();
            this.renderSourceSplit();
        }
    },

    // ---- The dialog ----

    /** "Split as suggested…" / "Undo…": the dialog with the preview (and the undo row). */
    openSourceSplit(): void {
        const provider = this.sourceSplitProvider();
        if (!provider) return;
        this.closeSourceSplit(false);
        const active = document.activeElement;
        const layout = layoutNow();
        dialog = {
            provider, state: provider.state(), loading: false, busy: false, error: null, all: false, shown: FIRST_ROWS[layout], layout,
            opener: active instanceof HTMLElement ? active : null,
        };
        dialog.loading = !dialog.state.preview && !dialog.state.undo;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = SOURCE_SPLIT_DIALOG_ID;
        overlay.innerHTML = '<div class="modal modal--lg ssp-modal" role="dialog" data-dialog-kind="choice" aria-modal="true"'
            + ' aria-labelledby="ssp-title" data-skeleton="done"></div>';
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) this.closeSourceSplit(); });
        overlay.addEventListener('click', e => this.sourceSplitClick(e));
        overlay.addEventListener('scroll', e => this.sourceSplitScrolled(e.target), true);
        document.body.appendChild(overlay);
        this.pushDialog(SOURCE_SPLIT_DIALOG_ID);
        const onResize = (): void => {
            const st = dialog;
            if (!st) return;
            const next = layoutNow();
            if (next === st.layout) return;
            st.layout = next;
            if (!st.all) st.shown = FIRST_ROWS[next];
            this.renderSourceSplit();
        };
        window.addEventListener('resize', onResize);
        resizeWatch = () => window.removeEventListener('resize', onResize);
        this.renderSourceSplit();
        overlay.querySelector<HTMLElement>('[data-ssp="go"]:not([disabled]), [data-dismiss]')?.focus({ preventScroll: true });
        if (dialog.loading) void this.sourceSplitRead();
    },

    /** Close the dialog (`refocus`: back to the line or button it was opened from). */
    closeSourceSplit(refocus = true): void {
        const opener = dialog?.opener;
        dialog = null;
        resizeWatch?.();
        resizeWatch = null;
        const el = document.getElementById(SOURCE_SPLIT_DIALOG_ID);
        if (!el) return;
        el.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== SOURCE_SPLIT_DIALOG_ID);
        if (refocus && opener?.isConnected) opener.focus({ preventScroll: true });
    },

    /** Read the state again (the bridge's GET; `all`: every row). */
    async sourceSplitRead(all = false): Promise<void> {
        const st = dialog;
        if (!st) return;
        st.loading = !st.state.preview;
        st.error = null;
        this.renderSourceSplit();
        const r = await st.provider.read(all);
        if (dialog !== st) return;
        st.loading = false;
        if (r.ok) {
            st.state = r.state;
        } else if (r.error === 'archive') {
            this.closeSourceSplit();
            this.sourceSplitLinesAgain();
            return;
        } else {
            st.error = { text: r.error === 'busy' ? strings.sources.split.errBusy : (r.reason || strings.sources.split.errFailed), retry: 'read' };
        }
        this.renderSourceSplit();
    },

    /** "Split (n)": the split done, the dialog closed, the toast with Undo. */
    async sourceSplitGo(): Promise<void> {
        const st = dialog;
        const preview = st?.state.preview;
        if (!st || !preview || st.busy || preview.count === 0) return;
        const t = strings.sources.split;
        st.busy = true;
        st.error = null;
        this.renderSourceSplit();
        const r = await st.provider.apply(preview);
        if (dialog !== st) return;
        st.busy = false;
        if (r.ok) {
            const provider = st.provider;
            const undo = r.undo;
            this.closeSourceSplit();
            this.sourceSplitLinesAgain();
            this.showToast(t.toast(r.count), TOAST_MS, {
                kind: 'source-split',
                ...(undo ? { action: { label: t.undo, run: () => { void this.sourceSplitUndoFromToast(provider, undo); } } } : {}),
            });
            return;
        }
        if (r.error === 'plan') {
            st.state = { ...st.state, preview: r.preview };
            st.all = false;
            st.shown = FIRST_ROWS[st.layout];
            st.error = { text: t.errPlan };
        } else if (r.error === 'archive') {
            this.closeSourceSplit();
            this.sourceSplitLinesAgain();
            return;
        } else {
            st.error = { text: r.error === 'busy' ? t.errBusy : (r.reason || strings.sources.split.errFailed), retry: 'apply' };
        }
        this.renderSourceSplit();
    },

    /** The undo row's "Undo": the split undone, the preview again (or why not). */
    async sourceSplitUndoRow(): Promise<void> {
        const st = dialog;
        const undo = st?.state.undo;
        if (!st || !undo || st.busy) return;
        st.busy = true;
        st.error = null;
        this.renderSourceSplit();
        const r = await st.provider.undo(undo);
        if (dialog !== st) return;
        st.busy = false;
        if (r.ok) {
            const again = await st.provider.read(st.all);
            if (dialog !== st) return;
            st.state = again.ok ? again.state : { ...st.state, undo: null };
            st.shown = st.all ? Math.max(st.shown, PAGE_ROWS) : FIRST_ROWS[st.layout];
            this.sourceSplitLinesAgain();
        } else {
            st.error = { text: this.sourceSplitUndoError(r), ...(r.error === 'busy' ? { retry: 'undo' as const } : {}) };
        }
        this.renderSourceSplit();
    },

    /** The toast's "Undo". */
    async sourceSplitUndoFromToast(provider: SplitProvider, undo: SplitUndoInfo): Promise<void> {
        const r = await provider.undo(undo);
        if (r.ok) {
            this.sourceSplitLinesAgain();
            return;
        }
        this.showToast(this.sourceSplitUndoError(r), 8000, { kind: 'source-split', closable: true });
    },

    sourceSplitUndoError(r: { ok: false; error: 'changed'; count: number; titles: string[] } | { ok: false; error: 'busy' | 'failed'; reason?: string }): string {
        const t = strings.sources.split;
        if (r.error === 'changed') return t.errUndo(r.count, r.titles.slice(0, 3).join('; '));
        if (r.error === 'busy') return t.errBusy;
        return r.reason || strings.sources.split.errFailed;
    },

    /** The tree and the lines after a split or its undo. */
    sourceSplitLinesAgain(): void {
        void TreeRenderer.renderAsync();
        this.refreshUndoRedoToolbar();
        if (document.getElementById('sources-modal')?.classList.contains('active')) this.renderSourcesList();
    },

    sourceSplitClick(e: MouseEvent): void {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ssp]');
        const st = dialog;
        if (!el || !st) return;
        switch (el.dataset.ssp) {
            case 'close': this.closeSourceSplit(); return;
            case 'go': void this.sourceSplitGo(); return;
            case 'undo': void this.sourceSplitUndoRow(); return;
            case 'retry':
                if (st.error?.retry === 'apply') void this.sourceSplitGo();
                else if (st.error?.retry === 'undo') void this.sourceSplitUndoRow();
                else void this.sourceSplitRead(st.all);
                return;
            case 'all': {
                st.all = true;
                st.shown = PAGE_ROWS;
                if (st.state.preview && !st.state.preview.complete) void this.sourceSplitRead(true);
                else this.renderSourceSplit();
                document.querySelector<HTMLElement>(`#${SOURCE_SPLIT_DIALOG_ID} .ssp-list`)?.focus({ preventScroll: true });
                return;
            }
        }
    },

    /** "Show all": the next rows once the list (or a phone's dialog) is scrolled near its end. */
    sourceSplitScrolled(target: EventTarget | null): void {
        const st = dialog;
        const pv = st?.state.preview;
        if (!st || !pv || !st.all || st.shown >= pv.rows.length) return;
        const el = target as HTMLElement | null;
        if (!el?.classList?.contains('ssp-list') && !el?.classList?.contains('ssp-body')) return;
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 80) return;
        st.shown += PAGE_ROWS;
        this.renderSourceSplit();
    },

    renderSourceSplit(): void {
        const modal = document.querySelector<HTMLElement>(`#${SOURCE_SPLIT_DIALOG_ID} .ssp-modal`);
        const st = dialog;
        if (!modal || !st) return;
        const t = strings.sources.split;
        const pv = st.state.preview;
        const n = pv?.count ?? 0;
        const local = st.state.kind === 'local';
        // Through the bridge: no mark (RESEARCH_BRIDGE_MARKS, the research writes it, no terminal).
        const bridgeLabel = (label: string): string => st.provider.kind === 'bridge' ? researchBridgeActionLabel(label, 'sources-split') : esc(label);
        const withCallNumber = local && !!pv && pv.fromNote > 0;
        const body = modal.querySelector<HTMLElement>('.ssp-body');
        const list = modal.querySelector<HTMLElement>('.ssp-list');
        const scroll = { body: body?.scrollTop ?? 0, list: list?.scrollTop ?? 0 };
        let content = '';
        const undo = st.state.undo;
        if (undo) {
            content += '<div class="ssp-undo-row">'
                + `<span class="ssp-undo-text">${esc(t.undoRow(formatShortDateTime(undo.at, getCurrentLanguage()), undo.count))}</span>`
                + `<button type="button" class="secondary ssp-small" data-ssp="undo"${st.busy ? ' disabled' : ''}>${bridgeLabel(t.undoBtn)}</button></div>`;
        }
        if (st.error) {
            content += '<div class="ssp-error" role="alert"><span class="ssp-error-text"><span class="ssp-dot" aria-hidden="true"></span>'
                + `<span>${esc(st.error.text)}</span></span>`
                + (st.error.retry ? `<button type="button" class="secondary ssp-small" data-ssp="retry">${esc(t.retry)}</button>` : '') + '</div>';
        }
        if (st.loading && !pv) {
            content += `<p class="ssp-loading" role="status">${esc(strings.materials.loading)}</p>`;
        } else if (!pv || n === 0) {
            content += `<p class="ssp-nothing">${esc(t.nothingLeft)}</p>`;
        } else {
            content += '<div class="ssp-intro">'
                + `<p class="ssp-lead">${esc(t.lead(n))}</p>`
                + `<p class="ssp-rule">${esc(t.rule)}</p>`
                + (withCallNumber ? `<p class="ssp-rule ssp-sig">${esc(t.sigNote(pv.fromNote))}</p>` : '')
                + '</div>';
            content += this.sourceSplitRowsHtml(st, pv, withCallNumber);
            if (pv.unrecognized > 0) {
                content += `<div class="ssp-unrec"><p>${esc(t.unrec(pv.unrecognized))}</p>`
                    + (pv.unrecognizedExamples.length ? `<p class="ssp-unrec-ex">${esc(t.unrecEx(pv.unrecognizedExamples.map(x => x.length > 60 ? `${x.slice(0, 59)}…` : x)))}</p>` : '')
                    + '</div>';
            }
        }
        const offer = !!pv && n > 0;
        modal.dataset.dialogKind = offer ? 'choice' : 'info';
        modal.classList.toggle('has-call-number', withCallNumber);
        const primary = offer
            ? `<button type="button" class="primary" data-ssp="go"${st.busy || st.error?.retry === 'read' || st.error?.retry === 'apply' ? ' disabled' : ''}${st.busy ? ' aria-busy="true"' : ''}>`
                + `${bridgeLabel(st.busy && st.provider.kind === 'bridge' ? t.progress(n) : t.go(n))}</button>`
            : '';
        modal.innerHTML = '<div class="modal-header ssp-header">'
            + `<h2 id="ssp-title">${esc(t.title)}</h2>`
            + `<button type="button" class="close-btn" data-ssp="close" aria-label="${esc(strings.buttons.close)}">&times;</button></div>`
            + (st.busy && st.provider.kind === 'bridge' ? '<div class="ssp-progress" aria-hidden="true"><span></span></div>' : '')
            + `<div class="modal-content ssp-body">${content}</div>`
            + '<div class="buttons ssp-foot">'
            + `<button type="button" class="secondary" data-dismiss data-ssp="close">${esc(offer ? strings.buttons.cancel : strings.buttons.close)}</button>${primary}</div>`;
        const nb = modal.querySelector<HTMLElement>('.ssp-body');
        if (nb) nb.scrollTop = scroll.body;
        const nl = modal.querySelector<HTMLElement>('.ssp-list');
        if (nl) nl.scrollTop = scroll.list;
    },

    /** The preview's rows: a table (a phone: cards), the first ones or, with "Show all", all read in so far. */
    sourceSplitRowsHtml(st: DialogState, pv: SplitPreview, withCallNumber: boolean): string {
        const t = strings.sources.split;
        const rows = pv.rows.slice(0, st.all ? st.shown : FIRST_ROWS[st.layout]);
        const canAll = !st.all && pv.count > rows.length;
        const allBtn = canAll ? `<button type="button" class="link-button ssp-all" data-ssp="all">${esc(t.all(pv.count))}</button>` : '';
        const shownText = st.all && rows.length < pv.count ? `<span class="ssp-shown">${esc(t.shown(rows.length, pv.count))}</span>` : '';
        const value = (c: { text: string; cls: string; tag: string }): string =>
            `<span class="ssp-v ${c.cls}">${esc(c.text)}</span>${c.tag ? `<span class="ssp-tag">${esc(c.tag)}</span>` : ''}`;
        if (st.layout === 'phone') {
            const cards = rows.map(r => '<li class="ssp-card">'
                + `<span class="ssp-card-title">${esc(r.title)}</span>`
                + `<span class="ssp-card-before">${esc(r.before.reference?.trim() || '—')}</span>`
                + `<dl class="ssp-card-after">${rowCells(r, withCallNumber).map(c => `<dt>${esc(c.label)}</dt><dd>${value(c)}</dd>`).join('')}</dl>`
                + '</li>').join('');
            return `<div class="ssp-list ssp-cards${st.all ? ' is-all' : ''}" tabindex="-1"><ul>${cards}</ul></div>`
                + (allBtn || shownText ? `<div class="ssp-list-foot">${allBtn}${shownText}</div>` : '');
        }
        const heads = [t.colSource, t.colBefore, t.colFolio, t.colImage, t.colRest, ...(withCallNumber ? [t.colCallNumber] : [])];
        const body = rows.map(r => '<tr>'
            + `<td class="ssp-title">${esc(r.title)}</td>`
            + `<td class="ssp-before">${esc(r.before.reference?.trim() || '—')}</td>`
            + rowCells(r, withCallNumber).map(c => `<td>${value(c)}</td>`).join('')
            + '</tr>').join('');
        return `<div class="ssp-table-wrap"><div class="ssp-list${st.all ? ' is-all' : ''}" tabindex="-1">`
            + `<table class="ssp-table"><thead><tr>${heads.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>`
            + `<tbody>${body}</tbody></table></div>`
            + (allBtn || shownText ? `<div class="ssp-list-foot">${allBtn}${shownText}</div>` : '')
            + '</div>';
    },
});
