/**
 * Source images the research left out of its file (spec 014 U7): loading
 * them in the source viewer, the "Image in research" filter with the bulk
 * load in the Sources window, the Research menu's row while it runs, the section in
 * the research tree settings and the choice in the export dialog.
 *
 * Loaded images are kept with the tree in this browser (src/research-images.ts),
 * never as an edit of the tree. See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { Source, SourceExcerpt, StromData, TreeId } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { onComputer } from './research-ui.js';
import { heldReasonKey } from './sources.js';
import { storedResearchBridge } from '../research-device.js';
import { parseLiveBridge } from '../research-link.js';
import { SourceImagesChoice } from '../privacy.js';
import {
    RESEARCH_IMAGE_EVENT, HeldImageMode, LoadError, LoadErrorKind, MissingList, QueueSnapshot, ResearchImageQueue,
    fetchMissingList, formatImageBytes, hasResearchImages, heldImageMode, knownImageError, loadErrorKind,
    loadResearchImage, pendingClips, primeResearchImages, pruneDeliveredImages, removeResearchImages,
    researchImagesPrimed, researchImagesTotal, shownExcerpts, sourceRefOf, storedImagesOf,
} from '../research-images.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const size = (bytes: number): string => formatImageBytes(bytes, getCurrentLanguage());

/** What the app can do with held images of the open tree right now. */
interface ImagesEnv {
    treeId: string | null;
    researchId: string | null;
    base: string;
    head: string | undefined;
    mode: HeldImageMode;
    auto: boolean;
}

/** The source viewer's load (one source, its excerpts one by one). */
interface ViewerRun { sourceId: string; abort: AbortController; clips: string[]; index: number }

let viewerRun: ViewerRun | null = null;
let viewerOpenedFor: string | null = null;
/** Failures of this opening (clip → reason); '*' for the whole source. */
const viewerErrors = new Map<string, LoadError>();
/** "Remove from the app" in this opening: no load by itself until it is opened again. */
let viewerSuppressed = false;
let viewerAutoTried = false;
let listening = false;
let lastModeKey = '';

/** The bulk load (one per tab). */
let queue: ResearchImageQueue | null = null;
let queueTreeId: string | null = null;
let bulkView: 'line' | 'warn' | 'progress' | 'summary' = 'line';
let bulkPlan: { list: MissingList | null; free: number | null; images: number; sources: number; bytes: number; ready: number } | null = null;
let lastSummary: QueueSnapshot | null = null;
/** The Research menu's images row shows the finished load until the Sources window opens. */
let rowFinished = false;
/** A load before an export: the dialog's footer shows it. */
let exportLoad: { stop: () => void } | null = null;
let exportMissing: { treeId: string; list: MissingList | null; loading: boolean } | null = null;
/** The tree whose export offers the source images choice (null: not offered). */
let exportImagesTreeId: string | null = null;

function sentenceJoin(parts: string[]): string {
    return parts.filter(Boolean).join(' ');
}

export const researchImagesMethods = uiModule({
    /** The state of the open tree's research for its held images. */
    researchImagesEnv(): ImagesEnv {
        const treeId = DataManager.getCurrentTreeId();
        const ctx = this.researchSyncLink();
        const link = ctx?.link;
        const base = link ? parseLiveBridge(storedResearchBridge(link.id)?.base)?.base ?? '' : '';
        const mode = heldImageMode({
            onComputer: onComputer(),
            linked: !!link,
            bridgeUp: !!link && !!base && this.researchBridgeUp(link.id),
            features: link ? this.researchStatusOf(link.id)?.features : null,
        });
        return { treeId, researchId: link?.id ?? null, base, head: link?.head, mode, auto: link?.autoLoadImages !== false };
    },

    /** Listen once for stored images changing (a load, a removal, the first read of a tree). */
    researchImagesListen(): void {
        if (listening || typeof window === 'undefined') return;
        listening = true;
        window.addEventListener(RESEARCH_IMAGE_EVENT, (e) => {
            const detail = (e as CustomEvent<{ treeId: string; sourceRef?: string }>).detail;
            this.onResearchImagesChanged(detail?.treeId, detail?.sourceRef);
        });
        const treeId = DataManager.getCurrentTreeId();
        if (treeId) void primeResearchImages(treeId);
    },

    /** Read the open tree's stored images (a no-op once read); views redraw when they come. */
    ensureResearchImages(): void {
        this.researchImagesListen();
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || researchImagesPrimed(treeId)) return;
        void primeResearchImages(treeId).then(() => {
            // A new research version may bring some of them in its file.
            if (DataManager.getCurrentTreeId() === treeId) void pruneDeliveredImages(treeId, DataManager.getData());
            if (researchImagesTotal(treeId).images > 0) this.onResearchImagesChanged(treeId);
        });
    },

    onResearchImagesChanged(treeId: string | undefined, sourceRef?: string): void {
        if (!treeId || treeId !== DataManager.getCurrentTreeId()) return;
        if (this.sourceViewerId && document.getElementById('source-viewer-modal')?.classList.contains('active')) {
            const src = DataManager.getData().sources?.[this.sourceViewerId];
            if (src && (!sourceRef || sourceRefOf(src) === sourceRef)) this.renderSourceViewer();
        }
        if (document.getElementById('sources-modal')?.classList.contains('active')) {
            // While the bulk load runs, rows stay where they are: only their thumbnails and the count change.
            if (queue?.active && this.sourcesFilter === 'imageHeld') this.refreshHeldRows();
            else this.renderSourcesList();
        }
        this.refreshCitationChips();
        // The person's sources panel: its thumbnails too.
        if (document.getElementById('person-sources-modal')) this.renderPersonSourcesDialog();
        // The Research menu's images row counts the sources still held.
        this.refreshResearchMenu();
    },

    /** The research's bridge went up or down (each poll): views that depend on it follow. */
    researchImagesBridgeChanged(): void {
        this.ensureResearchImages();
        const env = this.researchImagesEnv();
        const key = `${env.treeId}|${env.mode}|${env.head ?? ''}`;
        if (key === lastModeKey) return;
        const sameTree = lastModeKey.split('|')[0] === String(env.treeId);
        const headChanged = sameTree && lastModeKey.split('|')[2] !== (env.head ?? '');
        lastModeKey = key;
        // The Research menu's images row needs a research that hands images out.
        this.refreshResearchMenu();
        // A new research version may bring loaded images in its file: the stored copies go.
        if (headChanged && env.treeId && researchImagesPrimed(env.treeId)) {
            void pruneDeliveredImages(env.treeId, DataManager.getData());
        }
        if (this.sourceViewerId && document.getElementById('source-viewer-modal')?.classList.contains('active')) {
            this.renderSourceViewer();
        }
        if (document.getElementById('sources-modal')?.classList.contains('active') && !queue?.active) this.renderResearchImagesBulk();
        if (exportImagesTreeId && document.getElementById('export-password-modal')?.classList.contains('active')) {
            this.renderExportSourceImages();
        }
    },

    // ==================== SOURCE VIEWER ====================

    /** The viewer opens a source: what failed in the previous opening is asked again. */
    researchImagesViewerOpened(sourceId: string): void {
        this.ensureResearchImages();
        if (viewerOpenedFor === sourceId) return;
        viewerRun?.abort.abort();
        viewerRun = null;
        viewerOpenedFor = sourceId;
        viewerErrors.clear();
        viewerSuppressed = false;
        viewerAutoTried = false;
    },

    researchImagesViewerClosed(): void {
        viewerRun?.abort.abort();
        viewerRun = null;
        viewerOpenedFor = null;
    },

    /** Every excerpt the viewer shows (the file's, then the loaded ones) and which came from the research. */
    viewerExcerpts(src: Source): { excerpts: SourceExcerpt[]; fromResearch: Set<string> } {
        const treeId = DataManager.getCurrentTreeId();
        return {
            excerpts: shownExcerpts(treeId, src),
            fromResearch: new Set(storedImagesOf(treeId, src).map(r => r.excerpt.id)),
        };
    },

    /** Caption + ⋯ menu of an excerpt loaded from the research. */
    researchExcerptExtrasHtml(exc: SourceExcerpt, src: Source): string {
        const r = strings.researchImages;
        const stored = storedImagesOf(DataManager.getCurrentTreeId(), src);
        const bytes = stored.reduce((n, s) => n + (s.excerpt.sizeBytes || 0), 0);
        const label = exc.caption ? `${exc.caption} · ${r.fromResearch}` : r.fromResearch;
        return `<div class="viewer-excerpt-foot"><span class="viewer-excerpt-origin">${esc(label)}</span>
            <div class="viewer-excerpt-more">
                <button type="button" class="icon viewer-excerpt-more-btn" aria-haspopup="menu" aria-expanded="false"
                    aria-label="${esc(r.moreOptions)}" title="${esc(r.moreOptions)}">⋯</button>
                <div class="viewer-excerpt-menu" role="menu" hidden>
                    <button type="button" role="menuitem" class="viewer-excerpt-remove">${esc(r.removeFromApp)}</button>
                    <p class="viewer-excerpt-menu-note">${esc(r.removeFromAppNote(stored.length, size(bytes)))}</p>
                </div>
            </div></div>`;
    },

    /**
     * The block under the excerpts for what is only in the research: slots
     * while loading, one line with a button, a sentence when it cannot load
     * here, what failed.
     */
    researchImagesViewerHtml(src: Source): string {
        if (!src.imageHeld) return '';
        const r = strings.researchImages;
        const env = this.researchImagesEnv();
        const ref = sourceRefOf(src);
        const treeId = env.treeId;
        const shown = shownExcerpts(treeId, src).length;
        const row = (text: string, extra = '', cls = ''): string => `
            <div class="viewer-image-held${cls}"><span class="viewer-image-held-mark" aria-hidden="true"></span>
                <span class="viewer-image-held-text" role="note">${text}</span>${extra}</div>`;
        if (src.imageHeld === 'missing' || !ref || !src.heldClips?.length) {
            return src.imageHeld === 'missing' ? row(esc(r.errMissingScan)) : row(esc(r.held[heldReasonKey(src.imageHeld)]));
        }
        const chunks: string[] = [];
        // A source gone from the research (now, or remembered until its next version).
        const gone = viewerErrors.get('*') ?? (treeId && knownImageError(treeId, env.head, ref, '*') === 'revoked' ? 'revoked' as const : null);
        if (gone) {
            if (typeof gone === 'object') {
                const target = Object.values(DataManager.getData().sources ?? {}).find(s => s?.refn === gone.merged);
                chunks.push(row(target
                    ? `${esc(r.errMerged('\u0000')).replace('\u0000', `<button type="button" class="link-button viewer-merged-open" data-source-id="${esc(target.id)}">${esc(target.title)}</button>`)}`
                    : esc(r.errMergedUnknown)));
            } else chunks.push(row(esc(r.errRevoked)));
            return chunks.join('');
        }
        const pending = pendingClips(treeId, src, env.head);
        const inFile = new Set((src.excerpts ?? []).map(e => e.clip));
        const stored = new Set(storedImagesOf(treeId, src).map(s => s.clip));
        // Scans missing in the research keep their place, dashed, with the reason.
        for (const clip of src.heldClips) {
            if (inFile.has(clip) || stored.has(clip)) continue;
            const err = viewerErrors.get(clip) ?? (treeId ? knownImageError(treeId, env.head, ref, clip) : null);
            if (err === 'missingScan') {
                chunks.push(`<div class="viewer-excerpt-slot is-missing"><span class="viewer-excerpt-slot-text">${esc(r.errMissingScan)}</span></div>`);
            }
        }
        const failed = pending.filter(c => viewerErrors.has(c));
        const open = pending.filter(c => !viewerErrors.has(c));
        if (viewerRun && viewerRun.sourceId === src.id) {
            const run = viewerRun;
            run.clips.forEach((clip, i) => {
                if (i < run.index || stored.has(clip) || viewerErrors.has(clip)) return;
                chunks.push(i === run.index
                    ? `<div class="viewer-excerpt-slot is-active" role="status"><span class="viewer-excerpt-slot-text">${esc(r.loading(i + 1, run.clips.length))}</span><span class="viewer-excerpt-slot-bar" aria-hidden="true"></span></div>`
                    : '<div class="viewer-excerpt-slot" aria-hidden="true"></div>');
            });
        } else if (open.length > 0) {
            const n = open.length;
            // Why the research left it out (when it said so), after "The image is in the research."
            const reason = heldReasonKey(src.imageHeld);
            const text = (shown > 0 ? r.heldMore(n) : r.heldN(n)) + (reason !== 'other' ? ` ${r.heldWhy[reason]}` : '');
            if (env.mode === 'fetch') {
                const bytes = this.heldBytesOf(ref);
                chunks.push(row(esc(text), ` <button type="button" class="secondary viewer-load-images">${esc(n > 1 ? r.loadMany : r.load)}</button>${bytes ? `<span class="muted viewer-load-size"> · ${esc(size(bytes))}</span>` : ''}`));
            } else if (env.mode === 'bridgeOff') chunks.push(row(esc(`${shown > 0 ? r.heldMore(n) : r.heldN(n)} ${r.heldBridgeOff(n)}`)));
            else if (env.mode === 'device') chunks.push(row(esc(r.heldDevice)));
            else chunks.push(row(esc(r.held[heldReasonKey(src.imageHeld)])));
        }
        if (failed.length > 0) {
            const timeout = failed.every(c => viewerErrors.get(c) === 'timeout');
            chunks.push(row(esc(timeout ? r.errTimeout : r.errFailed),
                env.mode === 'fetch' ? ` <button type="button" class="secondary viewer-load-retry">${esc(r.retry)}</button>` : ''));
        }
        return chunks.join('');
    },

    /** Known size of a source's held images (from the bridge's list, when it was read). */
    heldBytesOf(sourceRef: string): number {
        const list = bulkPlan?.list ?? exportMissing?.list;
        return list?.sources.find(s => s.source === sourceRef)?.bytes ?? 0;
    },

    /** Buttons of the block; then a load by itself when the tree wants it. */
    wireResearchImagesViewer(body: HTMLElement, src: Source): void {
        body.querySelector('.viewer-load-images')?.addEventListener('click', () => void this.loadViewerImages(src.id));
        body.querySelector('.viewer-load-retry')?.addEventListener('click', () => {
            for (const [clip, err] of [...viewerErrors]) if (err === 'failed' || err === 'timeout') viewerErrors.delete(clip);
            void this.loadViewerImages(src.id);
        });
        body.querySelectorAll<HTMLElement>('.viewer-merged-open[data-source-id]').forEach(btn => {
            btn.addEventListener('click', () => this.showSourceViewer(btn.dataset.sourceId ?? '', null));
        });
        body.querySelectorAll<HTMLElement>('.viewer-excerpt-more').forEach(wrap => {
            const btn = wrap.querySelector<HTMLButtonElement>('.viewer-excerpt-more-btn');
            const menu = wrap.querySelector<HTMLElement>('.viewer-excerpt-menu');
            if (!btn || !menu) return;
            const close = (): void => {
                menu.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
                document.removeEventListener('pointerdown', outside, true);
            };
            const outside = (e: Event): void => { if (!wrap.contains(e.target as Node)) close(); };
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!menu.hidden) { close(); return; }
                menu.hidden = false;
                btn.setAttribute('aria-expanded', 'true');
                document.addEventListener('pointerdown', outside, true);
                menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
            });
            menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } });
            menu.querySelector('.viewer-excerpt-remove')?.addEventListener('click', () => {
                close();
                void this.removeViewerImages(src.id);
            });
        });
        this.maybeAutoLoadViewerImages(src);
    },

    maybeAutoLoadViewerImages(src: Source): void {
        if (viewerRun || viewerSuppressed || viewerAutoTried || viewerOpenedFor !== src.id) return;
        const env = this.researchImagesEnv();
        if (env.mode !== 'fetch' || !env.auto || !researchImagesPrimed(env.treeId ?? '')) return;
        if (pendingClips(env.treeId, src, env.head).filter(c => !viewerErrors.has(c)).length === 0) return;
        viewerAutoTried = true;
        void this.loadViewerImages(src.id);
    },

    /** Load the open source's held excerpts one by one (stops when the viewer closes). */
    async loadViewerImages(sourceId: string): Promise<void> {
        if (viewerRun) return;
        const src = DataManager.getData().sources?.[sourceId];
        const env = this.researchImagesEnv();
        const ref = src ? sourceRefOf(src) : null;
        if (!src || !ref || !env.treeId || env.mode !== 'fetch') return;
        const clips = pendingClips(env.treeId, src, env.head).filter(c => !viewerErrors.has(c));
        if (clips.length === 0) return;
        const run: ViewerRun = { sourceId, abort: new AbortController(), clips, index: 0 };
        viewerRun = run;
        viewerAutoTried = true;
        this.renderSourceViewer();
        try {
            for (let i = 0; i < clips.length; i++) {
                run.index = i;
                if (i > 0) this.renderSourceViewer();
                let result: Awaited<ReturnType<typeof loadResearchImage>>;
                try {
                    result = await loadResearchImage(env.treeId, env.base, env.head, ref, clips[i], run.abort.signal);
                } catch {
                    return;
                }
                if (run.abort.signal.aborted) return;
                if (typeof result === 'object' && 'key' in result) continue;
                const kind = loadErrorKind(result);
                // The research stopped running: the rest waits for it (the line says so).
                if ((kind === 'failed' || kind === 'timeout') && !this.researchImagesEnv().base) break;
                if ((kind === 'failed' || kind === 'timeout') && this.researchImagesEnv().mode !== 'fetch') break;
                if (kind === 'revoked' || kind === 'merged') {
                    viewerErrors.set('*', result);
                    break;
                }
                viewerErrors.set(clips[i], result);
            }
        } finally {
            if (viewerRun === run) viewerRun = null;
            if (this.sourceViewerId === sourceId) this.renderSourceViewer();
        }
    },

    /** ⋯ → Remove from the app: the source's loaded images go (they stay in the research). */
    async removeViewerImages(sourceId: string): Promise<void> {
        const src = DataManager.getData().sources?.[sourceId];
        const treeId = DataManager.getCurrentTreeId();
        const ref = src ? sourceRefOf(src) : null;
        if (!src || !ref || !treeId) return;
        viewerSuppressed = true;
        await removeResearchImages(treeId, ref);
        if (this.sourceViewerId === sourceId) this.renderSourceViewer();
    },

    // ==================== SOURCES WINDOW ====================

    /** Sources with something to load from the research (not a missing scan, not gone). */
    heldSources(data: StromData = DataManager.getData()): { src: Source; clips: string[] }[] {
        const env = this.researchImagesEnv();
        return Object.values(data.sources ?? {}).flatMap(src => {
            if (!src?.imageHeld) return [];
            const clips = pendingClips(env.treeId, src, env.head);
            return clips.length ? [{ src, clips }] : [];
        });
    },

    /** Is a bulk load of the open tree running, or its summary still shown? */
    researchImagesBulkBusy(): boolean {
        return queueTreeId === DataManager.getCurrentTreeId() && (!!queue?.active || !!lastSummary);
    },

    /** The tag beside a row of a source whose image is only in the research. */
    sourceHeldTagHtml(src: Source): string {
        const treeId = DataManager.getCurrentTreeId();
        if (!src.imageHeld || shownExcerpts(treeId, src).length > 0) return '';
        const env = this.researchImagesEnv();
        if (src.imageHeld === 'missing' || pendingClips(treeId, src, env.head).length === 0) {
            const ref = sourceRefOf(src);
            const missing = src.imageHeld === 'missing'
                || (!!ref && !!treeId && (src.heldClips ?? []).some(c => knownImageError(treeId, env.head, ref, c) === 'missingScan'));
            return missing ? `<span class="source-meta source-held-reason"> — ${esc(strings.researchImages.metaMissingScan)}</span>` : '';
        }
        return `<span class="source-held-tag" title="${esc(strings.researchImages.held[heldReasonKey(src.imageHeld)])}">${esc(strings.researchImages.heldTag)}</span>`;
    },

    /** Size of the images loaded from the research (counted into the Sources window's excerpts total). */
    researchImagesBytes(): number {
        return researchImagesTotal(DataManager.getCurrentTreeId()).bytes;
    },

    /** Count line beside the excerpts' size: "of which from the research 3.1 MB". */
    researchImagesSizeSuffix(bytes: number): string {
        return bytes > 0 ? ` · ${strings.researchImages.sizeFromResearch(size(bytes))}` : '';
    },

    /** Rows of the filtered list: thumbnails filled in place, the filter count updated (no reordering). */
    refreshHeldRows(): void {
        const container = document.getElementById('sources-list');
        if (!container) return;
        const treeId = DataManager.getCurrentTreeId();
        container.querySelectorAll<HTMLElement>('.source-row').forEach(row => {
            const id = row.querySelector<HTMLElement>('.source-row-open')?.dataset.sourceId;
            const src = id ? DataManager.getData().sources?.[id] : undefined;
            const first = src ? shownExcerpts(treeId, src)[0] : undefined;
            const icon = row.querySelector('.source-row-icon, .source-row-thumb.is-held');
            if (src && first && icon) {
                const img = document.createElement('img');
                img.className = 'source-row-thumb';
                img.alt = '';
                img.src = first.dataUrl;
                icon.replaceWith(img);
                row.querySelector('.source-held-tag')?.remove();
            }
        });
        const chip = document.querySelector<HTMLElement>('#sources-filter [data-filter="imageHeld"]');
        if (chip) chip.textContent = strings.researchImages.filter(this.heldSources().length);
    },

    /** The line / warning / progress / summary under the filters (filter "Image in research"). */
    renderResearchImagesBulk(): void {
        const box = document.getElementById('sources-bulk');
        if (!box) return;
        const r = strings.researchImages;
        const env = this.researchImagesEnv();
        const mine = queue && queueTreeId === env.treeId ? queue : null;
        if (mine?.active) bulkView = 'progress';
        else if (lastSummary && queueTreeId === env.treeId && bulkView !== 'warn') bulkView = 'summary';
        if (this.sourcesFilter !== 'imageHeld' && bulkView !== 'progress' && bulkView !== 'summary') {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        const held = this.heldSources();
        const images = held.reduce((n, h) => n + h.clips.length, 0);
        if (bulkView === 'progress' && mine) {
            const s = mine.snapshot;
            const paused = s.phase === 'paused';
            const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
            box.hidden = false;
            box.innerHTML = `<div class="sources-bulk-panel${paused ? ' is-paused' : ''}" role="status">
                <p class="sources-bulk-progress">${esc(paused ? r.bulkPaused(s.done, s.total, size(s.bytes)) : r.bulkProgress(s.done, s.total, size(s.bytes)))}</p>
                <div class="sources-bulk-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
                <p class="sources-bulk-note">${esc(r.bulkCanClose)}</p>
                <div class="sources-bulk-buttons">
                    <button type="button" class="secondary" id="sources-bulk-pause">${esc(paused ? r.resume : r.pause)}</button>
                    <button type="button" class="secondary" id="sources-bulk-stop">${esc(r.stop)}</button>
                </div></div>`;
            box.querySelector('#sources-bulk-pause')?.addEventListener('click', () => (paused ? mine.resume() : mine.pause()));
            box.querySelector('#sources-bulk-stop')?.addEventListener('click', () => mine.stop());
            return;
        }
        if (bulkView === 'summary' && lastSummary) {
            const s = lastSummary;
            const lines: string[] = [];
            if (s.phase === 'done') {
                const failedTotal = Object.values(s.failed).reduce((n, v) => n + (v ?? 0), 0);
                const reasons = (Object.entries(s.failed) as [LoadErrorKind, number][])
                    .filter(([, n]) => n > 0).map(([k, n]) => `${r.reasons[k]} (${n})`).join(', ');
                lines.push(sentenceJoin([r.bulkDone(s.loaded, size(s.bytes)), failedTotal ? r.bulkFailed(failedTotal, reasons) : '']));
                if (failedTotal) lines.push(r.bulkLeft);
            } else if (s.phase === 'bridgeOff') {
                lines.push(r.bulkBridgeOff);
                lines.push(sentenceJoin([r.bulkStopped(s.done, s.total, size(s.bytes)), r.bulkBridgeOffRest]));
            } else {
                lines.push(sentenceJoin([r.bulkStopped(s.done, s.total, size(s.bytes)), r.bulkStoppedRest]));
            }
            box.hidden = false;
            box.innerHTML = `<div class="sources-bulk-panel" role="status">
                ${lines.map(l => `<p class="sources-bulk-text">${esc(l)}</p>`).join('')}
                <div class="sources-bulk-buttons"><button type="button" class="primary" id="sources-bulk-done">${esc(r.done)}</button></div></div>`;
            box.querySelector('#sources-bulk-done')?.addEventListener('click', () => {
                lastSummary = null;
                bulkView = 'line';
                this.renderSourcesList();
            });
            return;
        }
        if (env.mode !== 'fetch' || held.length === 0) {
            bulkView = 'line';
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        if (bulkView === 'warn' && bulkPlan) {
            const p = bulkPlan;
            const lines = [r.bulkSummary(p.sources, p.images, size(p.bytes))];
            const notReady = p.images - p.ready;
            if (p.list && notReady > 0) lines.push(r.bulkReady(p.ready, notReady));
            const noSpace = p.free !== null && p.free < p.bytes * 1.1;
            if (p.free !== null) lines.push(noSpace ? r.bulkNoSpace(size(p.free), size(Math.max(0, p.bytes * 1.1 - p.free))) : r.bulkSpace(size(p.free)));
            box.hidden = false;
            box.innerHTML = `<div class="sources-bulk-panel" role="region" aria-labelledby="sources-bulk-title">
                <h3 class="sources-bulk-title" id="sources-bulk-title">${esc(r.bulkTitle)}</h3>
                ${lines.map(l => `<p class="sources-bulk-text">${esc(l)}</p>`).join('')}
                <div class="sources-bulk-buttons">
                    <button type="button" class="secondary" id="sources-bulk-cancel">${esc(noSpace ? r.close : r.cancel)}</button>
                    ${noSpace ? '' : `<button type="button" class="primary" id="sources-bulk-go">${esc(r.loadButton)}</button>`}
                </div></div>`;
            box.querySelector('#sources-bulk-cancel')?.addEventListener('click', () => {
                bulkView = 'line';
                this.renderResearchImagesBulk();
            });
            box.querySelector('#sources-bulk-go')?.addEventListener('click', () => this.startBulkImageLoad());
            box.querySelector<HTMLElement>('#sources-bulk-go')?.focus();
            return;
        }
        box.hidden = false;
        box.innerHTML = `<div class="sources-bulk-line"><span>${esc(r.bulkLine(images, held.length))}</span>
            <button type="button" class="link-button" id="sources-bulk-open">${esc(r.bulkLoad)}</button></div>`;
        box.querySelector('#sources-bulk-open')?.addEventListener('click', () => void this.openBulkImageWarning());
    },

    /** "Load all from the research…": the warning with counts, size and free space. */
    async openBulkImageWarning(): Promise<void> {
        const env = this.researchImagesEnv();
        if (env.mode !== 'fetch') return;
        const held = this.heldSources();
        const images = held.reduce((n, h) => n + h.clips.length, 0);
        let list: MissingList | null = null;
        try { list = await fetchMissingList(env.base); } catch { list = null; }
        const known = new Map((list?.sources ?? []).map(s => [s.source, s]));
        // Sizes the research knows; the rest at their average.
        const withSize = held.filter(h => (known.get(sourceRefOf(h.src) ?? '')?.bytes ?? 0) > 0);
        const knownBytes = withSize.reduce((n, h) => n + (known.get(sourceRefOf(h.src) ?? '')?.bytes ?? 0), 0);
        const avg = withSize.length ? knownBytes / withSize.length : 150 * 1024;
        const bytes = Math.round(knownBytes + (held.length - withSize.length) * avg);
        const ready = held.reduce((n, h) => n + (known.get(sourceRefOf(h.src) ?? '')?.ready ? h.clips.length : 0), 0);
        let free: number | null = null;
        try {
            const est = await navigator.storage?.estimate?.();
            if (est && typeof est.quota === 'number' && typeof est.usage === 'number') free = Math.max(0, est.quota - est.usage);
        } catch { free = null; }
        bulkPlan = { list, free, images, sources: held.length, bytes, ready };
        bulkView = 'warn';
        this.renderResearchImagesBulk();
    },

    /** Start the bulk load of the filter's sources (ready ones first). */
    startBulkImageLoad(): ResearchImageQueue | null {
        const env = this.researchImagesEnv();
        const treeId = env.treeId;
        if (!treeId || env.mode !== 'fetch') return null;
        if (queue?.active) return queue;
        const known = new Map((bulkPlan?.list?.sources ?? []).map(s => [s.source, s]));
        const tasks = this.heldSources().map(h => {
            const ref = sourceRefOf(h.src)!;
            return { sourceRef: ref, clips: h.clips, ready: !!known.get(ref)?.ready };
        });
        if (tasks.length === 0) return null;
        const q = new ResearchImageQueue(tasks,
            (ref, clip, signal) => {
                const now = this.researchImagesEnv();
                return loadResearchImage(treeId, now.base || env.base, now.head, ref, clip, signal);
            },
            () => {
                const now = this.researchImagesEnv();
                return now.treeId === treeId && now.mode === 'fetch';
            });
        queue = q;
        queueTreeId = treeId;
        lastSummary = null;
        rowFinished = false;
        bulkView = 'progress';
        q.subscribe(() => {
            this.refreshResearchMenu();
            if (document.getElementById('sources-modal')?.classList.contains('active')) this.renderResearchImagesBulk();
        });
        void q.start().then(end => {
            lastSummary = end;
            rowFinished = true;
            bulkView = 'summary';
            this.refreshResearchMenu();
            if (document.getElementById('sources-modal')?.classList.contains('active')) this.renderSourcesList();
        });
        this.renderResearchImagesBulk();
        return q;
    },

    /**
     * The Research menu's row "Images in the research · N": N sources whose image is only in the
     * research, offered while the research hands images out; during the bulk load its progress
     * (sources done / all), with ✓ at its end until the Sources window opens. Null: no row.
     * It never lights the Research button's dot (only a state that needs action does, D7).
     */
    researchImagesMenuItem(): { label: string } | null {
        const r = strings.researchImages;
        const treeId = DataManager.getCurrentTreeId();
        if (queue && queueTreeId === treeId && (queue.active || rowFinished)) {
            const s = queue.snapshot;
            return { label: `${r.menuRowProgress(s.done, s.total)}${queue.active ? '' : ' ✓'}` };
        }
        if (this.researchImagesEnv().mode !== 'fetch') return null;
        const n = this.heldSources().length;
        return n > 0 ? { label: r.menuRow(n) } : null;
    },

    /** The images row: the Sources window with the "Image in research" filter. */
    researchActionHeldImages(): void {
        this.closeActionsMenu();
        this.sourcesFilter = 'imageHeld';
        this.showSourcesDialog();
    },

    /** The Sources window opened: a finished load leaves the menu row, the filter shows the bulk line. */
    researchImagesSourcesOpened(): void {
        this.ensureResearchImages();
        if (rowFinished && !queue?.active) {
            rowFinished = false;
            this.refreshResearchMenu();
        }
    },

    /** Settings → "Load all…": the Sources window with the filter and the warning open. */
    async showHeldImagesBulk(treeId: TreeId): Promise<void> {
        if (DataManager.getCurrentTreeId() !== treeId) await this.switchToTree(treeId, { follow: false });
        if (DataManager.getCurrentTreeId() !== treeId) return;
        this.closeTreeManagerDialog();
        this.sourcesFilter = 'imageHeld';
        this.showSourcesDialog();
        await this.openBulkImageWarning();
    },

    // ==================== RESEARCH TREE SETTINGS ====================

    /** The section "Source images" in the research tree settings (filled once the tree's images are read). */
    async renderResearchImagesSettings(treeId: TreeId, host: HTMLElement): Promise<void> {
        const data = DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : await TreeManager.getTreeData(treeId).catch(() => null);
        if (!data) return;
        await primeResearchImages(treeId);
        const t = strings.researchImages.settings;
        const total = researchImagesTotal(treeId);
        const isCurrent = DataManager.getCurrentTreeId() === treeId;
        const env = isCurrent ? this.researchImagesEnv() : null;
        const held = isCurrent ? this.heldSources(data) : [];
        if (!hasResearchImages(treeId, data)) {
            host.innerHTML = '';
            return;
        }
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const fetch = env?.mode === 'fetch';
        const known = new Map((bulkPlan?.list?.sources ?? []).map(s => [s.source, s.bytes]));
        const heldBytes = held.reduce((n, h) => n + (known.get(sourceRefOf(h.src) ?? '') ?? 0), 0);
        host.innerHTML = `<section class="research-images">
            <h3 class="research-images-title">${esc(t.section)}</h3>
            ${fetch ? `<label class="settings-checkbox">
                <input type="checkbox" id="research-images-auto"${link?.autoLoadImages !== false ? ' checked' : ''}>
                <span class="settings-text"><span class="settings-name">${esc(t.auto)}</span>
                <span class="settings-desc">${esc(t.autoDesc)}</span></span></label>` : ''}
            <div class="research-images-grid settings-desc">
                ${total.images > 0 ? `<span id="research-images-loaded">${esc(t.loaded(total.sources, size(total.bytes)))}</span>
                    <button type="button" class="link-button" id="research-images-remove">${esc(t.remove)}</button>` : ''}
                ${fetch && held.length > 0 ? `<span id="research-images-held">${esc(heldBytes > 0 ? t.held(held.length, size(heldBytes)) : t.heldCount(held.length))}</span>
                    <button type="button" class="link-button" id="research-images-load-all">${esc(t.loadAll)}</button>` : ''}
            </div></section>`;
        host.querySelector<HTMLInputElement>('#research-images-auto')?.addEventListener('change', (e) => {
            const on = (e.target as HTMLInputElement).checked;
            TreeManager.patchResearchLink(treeId, { autoLoadImages: on ? undefined : false });
        });
        host.querySelector('#research-images-remove')?.addEventListener('click', async () => {
            const now = researchImagesTotal(treeId);
            const ok = await this.showConfirm(
                `${t.removeBody(now.sources, now.images, size(now.bytes))} ${t.removeKeep}`,
                t.removeTitle, { confirmLabel: t.removeConfirm });
            if (!ok) return;
            await removeResearchImages(treeId);
            void this.renderResearchImagesSettings(treeId, host);
        });
        host.querySelector('#research-images-load-all')?.addEventListener('click', () => {
            this.closeResearchTreeSettings();
            void this.showHeldImagesBulk(treeId);
        });
    },

    // ==================== EXPORT ====================

    /** The export dialog opens: offer source images for a tree that has anything to do with them. */
    setupExportSourceImages(treeId: string | null): void {
        exportImagesTreeId = null;
        exportLoad?.stop();
        exportLoad = null;
        const fieldset = document.getElementById('export-source-images');
        const attachLabel = document.querySelector<HTMLElement>('#export-content-attachments + span');
        const progress = document.getElementById('export-images-progress');
        if (progress) { progress.hidden = true; progress.innerHTML = ''; }
        if (attachLabel) attachLabel.textContent = strings.privacy.contentAttachments;
        if (!fieldset) return;
        fieldset.hidden = true;
        fieldset.innerHTML = '';
        if (!treeId || treeId !== DataManager.getCurrentTreeId()) return;
        this.ensureResearchImages();
        if (!hasResearchImages(treeId, DataManager.getData())) return;
        exportImagesTreeId = treeId;
        if (attachLabel) attachLabel.textContent = strings.researchImages.export.attachmentsOnly;
        fieldset.hidden = false;
        fieldset.dataset.choice = 'app';
        this.renderExportSourceImages();
        const env = this.researchImagesEnv();
        if (env.mode === 'fetch' && this.heldSources().length > 0 && exportMissing?.treeId !== treeId) {
            exportMissing = { treeId, list: null, loading: true };
            void fetchMissingList(env.base).catch(() => null).then(list => {
                if (exportMissing?.treeId !== treeId) return;
                exportMissing = { treeId, list, loading: false };
                if (exportImagesTreeId === treeId) this.renderExportSourceImages();
            });
        }
    },

    /** The three choices of source images, with what each brings. */
    renderExportSourceImages(): void {
        const fieldset = document.getElementById('export-source-images');
        if (!fieldset || !exportImagesTreeId) return;
        const x = strings.researchImages.export;
        const data = DataManager.getData();
        const appExcerpts = Object.values(data.sources ?? {}).reduce((n, src) => n + (src ? shownExcerpts(exportImagesTreeId, src).length : 0), 0);
        const appBytes = Object.values(data.sources ?? {}).reduce((n, src) => n + (src ? shownExcerpts(exportImagesTreeId, src).reduce((m, e) => m + (e.sizeBytes || 0), 0) : 0), 0);
        const env = this.researchImagesEnv();
        const held = this.heldSources();
        const heldBytes = this.exportHeldBytes();
        const space = bulkPlan?.free ?? null;
        const noSpace = space !== null && heldBytes > 0 && space < heldBytes * 1.1;
        const allOff = env.mode !== 'fetch' ? (env.mode === 'device' ? x.allDevice : x.allOff)
            : held.length === 0 ? x.allNone
            : noSpace ? strings.researchImages.bulkNoSpace(size(space!), size(heldBytes * 1.1 - space!)) : '';
        let choice = (fieldset.dataset.choice as SourceImagesChoice) || 'app';
        if (choice === 'all' && allOff) choice = 'app';
        fieldset.dataset.choice = choice;
        const radio = (value: SourceImagesChoice, title: string, sub: string, disabled = false): string => `
            <label class="content-radio${choice === value ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}">
                <input type="radio" name="export-source-images" value="${value}"${choice === value ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                <span class="content-radio-text"><span class="content-radio-title">${esc(title)}</span>${sub ? `<span class="content-radio-sub">${esc(sub)}</span>` : ''}</span>
            </label>`;
        fieldset.innerHTML = `<legend>${esc(x.legend)}</legend>`
            + radio('none', x.none, '')
            + radio('app', x.app, x.appSub(appExcerpts, size(appBytes)))
            + radio('all', x.all, allOff || (heldBytes > 0 ? x.allSub(held.length, size(heldBytes)) : x.allSubCount(held.length)), !!allOff);
        fieldset.querySelectorAll<HTMLInputElement>('input[name="export-source-images"]').forEach(input => {
            input.addEventListener('change', () => {
                if (!input.checked) return;
                fieldset.dataset.choice = input.value;
                this.renderExportSourceImages();
                this.onExportContentChange();
            });
        });
    },

    /** Approximate size of what is only in the research (the bridge's list; the rest at its average). */
    exportHeldBytes(): number {
        const list = exportMissing?.list ?? bulkPlan?.list ?? null;
        const held = this.heldSources();
        if (!list || held.length === 0) return 0;
        const known = new Map(list.sources.map(s => [s.source, s.bytes]));
        const sizes = held.map(h => known.get(sourceRefOf(h.src) ?? '') ?? 0);
        const withSize = sizes.filter(b => b > 0);
        const avg = withSize.length ? withSize.reduce((a, b) => a + b, 0) / withSize.length : 0;
        return Math.round(sizes.reduce((n, b) => n + (b > 0 ? b : avg), 0));
    },

    /** The choice for the export's content options (undefined: not offered, excerpts go with attachments). */
    exportSourceImagesOption(quick: boolean): { sourceImages: SourceImagesChoice; researchExcerpts?: Record<string, SourceExcerpt[]> } | undefined {
        const treeId = quick ? DataManager.getCurrentTreeId() : exportImagesTreeId;
        if (!treeId || treeId !== DataManager.getCurrentTreeId()) return undefined;
        if (quick) {
            // Saving to a file takes the images in the app.
            if (researchImagesTotal(treeId).images === 0) return undefined;
        }
        const fieldset = document.getElementById('export-source-images');
        const choice: SourceImagesChoice = quick ? 'app' : ((fieldset?.dataset.choice as SourceImagesChoice) || 'app');
        if (choice === 'none') return { sourceImages: 'none' };
        const researchExcerpts: Record<string, SourceExcerpt[]> = {};
        for (const src of Object.values(DataManager.getData().sources ?? {})) {
            const stored = src ? storedImagesOf(treeId, src) : [];
            if (stored.length) researchExcerpts[src.id] = stored.map(s => s.excerpt);
        }
        return { sourceImages: choice, researchExcerpts };
    },

    /** Size the choice adds to the export estimate, and whether it is a guess. */
    exportSourceImagesBytes(): { bytes: number; approx: boolean } | null {
        if (!exportImagesTreeId) return null;
        const fieldset = document.getElementById('export-source-images');
        const choice = (fieldset?.dataset.choice as SourceImagesChoice) || 'app';
        if (choice === 'none') return { bytes: 0, approx: false };
        const data = DataManager.getData();
        const app = Object.values(data.sources ?? {}).reduce((n, src) => n + (src ? shownExcerpts(exportImagesTreeId, src).reduce((m, e) => m + (e.sizeBytes || 0), 0) : 0), 0);
        return choice === 'all' ? { bytes: app + this.exportHeldBytes(), approx: true } : { bytes: app, approx: false };
    },

    /**
     * Export with "All from the research": load the rest first (the dialog's
     * footer shows it, Stop ends it), then go on. Returns false when the
     * export should not go on (stopped, the research stopped running).
     */
    async loadImagesBeforeExport(): Promise<boolean> {
        const fieldset = document.getElementById('export-source-images');
        if (!exportImagesTreeId || fieldset?.dataset.choice !== 'all') return true;
        // A privacy mode leaves the sources out, their images with them: nothing to load.
        if (this.readExportPrivacyMode() !== 'full') return true;
        if (this.heldSources().length === 0 || this.researchImagesEnv().mode !== 'fetch') return true;
        const progress = document.getElementById('export-images-progress');
        const buttons = document.querySelector<HTMLElement>('#export-password-modal .export-buttons');
        const x = strings.researchImages.export;
        // A bulk load already running: the export waits for it.
        const q = queue?.active ? queue : this.startBulkImageLoad();
        if (!q) return true;
        const draw = (s: QueueSnapshot): void => {
            if (!progress) return;
            const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
            progress.hidden = false;
            progress.innerHTML = `<p class="export-images-progress-text">${esc(x.loadingBefore(s.done, s.total))}</p>
                <div class="sources-bulk-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
                <button type="button" class="secondary" id="export-images-stop">${esc(strings.researchImages.stop)}</button>`;
            progress.querySelector('#export-images-stop')?.addEventListener('click', () => q.stop());
        };
        if (buttons) buttons.style.display = 'none';
        draw(q.snapshot);
        const off = q.subscribe(draw);
        exportLoad = { stop: () => q.stop() };
        const end = await q.finished;
        off();
        exportLoad = null;
        if (buttons) buttons.style.display = '';
        if (end.phase !== 'done') {
            if (progress) {
                progress.hidden = false;
                progress.innerHTML = `<p class="export-images-progress-text">${esc(x.stopped(end.loaded))}</p>`;
            }
            this.renderExportSourceImages();
            return false;
        }
        const failed = Object.values(end.failed).reduce((n, v) => n + (v ?? 0), 0);
        if (progress) {
            progress.hidden = false;
            progress.innerHTML = `<p class="export-images-progress-text">${esc(failed ? `${x.writing} ${x.skipped(failed)}` : x.writing)}</p>`;
        }
        return true;
    },

    /** Was the export loading images (the footer shows it)? Esc / Cancel stops it. */
    stopExportImageLoad(): void {
        exportLoad?.stop();
    },
});
