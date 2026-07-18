/**
 * Poster export UI: download the current tree as SVG or PNG, or print it as a
 * tiled multi-page PDF (via the browser print dialog). Split from UIClass; see
 * src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import {
    buildTreeSvg, computeBounds, escapeXml, PosterOptions, PosterFooterMeta, FOOTER_HEIGHT, POSTER_PADDING,
} from '../export-image.js';
import { buildFanModel, buildFanPosterSvg, fanPosterGeometry } from '../fan-chart.js';
import { computeTimelineModel } from '../timeline.js';
import { buildTimelinePosterSvg, timelinePosterGeometry } from '../timeline-chart.js';
import { uiModule } from './module.js';
import { DEFAULT_LAYOUT_CONFIG, StromData, ViewMode } from '../types.js';
import { applyLivingPrivacy, PrivacyMode, presumedDeceasedSet } from '../privacy.js';
import { classifyBranches } from '../branch-colors.js';
import { SettingsManager } from '../settings.js';

/** Browsers cap canvas dimensions; keep well under the common ~16k limit. */
const MAX_CANVAS_PX = 15000;
/** Paper sizes in millimetres (portrait). */
const PAPER: Record<string, { w: number; h: number }> = {
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
};
const PAGE_MARGIN_MM = 10;
const PAGE_OVERLAP_MM = 10;
/** Millimetres per layout pixel (≈33mm wide cards — readable when printed). */
const MM_PER_PX = 0.26;

function posterFilename(ext: string): string {
    const name = TreeManager.getActiveTreeMetadata()?.name || 'family-tree';
    const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${safe || 'family-tree'}.${ext}`;
}

function posterPrivacyMode(): PrivacyMode {
    const sel = document.getElementById('poster-privacy-mode') as HTMLSelectElement | null;
    const v = sel?.value;
    return (v === 'initials' || v === 'anonymous' || v === 'minimal') ? v : 'full';
}

/** What the poster will print, given the current view. */
interface PosterViewInfo {
    /** Dialog line, e.g. "Prints the current view: Family — from Jan (depth 3/3)". */
    line: string;
    /** Footer label ('' for views the poster cannot print). */
    label: string;
    /** True for views the poster cannot print (map, timeline). */
    blocked: boolean;
}

/** The focus person's name as it appears in `source` (raw or privacy-filtered). */
function focusNameFrom(source: StromData): string {
    const id = TreeRenderer.getFocusPersonId();
    const p = id ? source.persons[id] : null;
    return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

/** The view label (no "Prints…" prefix), given the focus name to embed. */
function viewLabelFor(mode: ViewMode, name: string): string {
    switch (mode) {
        case 'fan':
            return strings.poster.viewFan(name, TreeRenderer.getFanGenerations());
        case 'timeline':
            return strings.poster.viewTimeline(name);
        case 'descendants':
            return strings.poster.viewDescendants(name);
        default:
            return strings.poster.viewFamily(name, TreeRenderer.getFocusDepthUp(), TreeRenderer.getFocusDepthDown());
    }
}

/**
 * Describe what the poster will actually print for the CURRENT view — the
 * poster prints what you are looking at, so the map is honestly blocked
 * rather than silently exporting the family card layout underneath. The dialog
 * line shows the RAW focus name (the user is looking at their own screen); the
 * footer label is rebuilt from privacy-filtered data in buildCurrentPoster.
 */
function posterViewInfo(): PosterViewInfo {
    const mode = TreeRenderer.getViewMode();
    if (mode === 'map') return { line: strings.poster.viewMapBlocked, label: '', blocked: true };
    const label = viewLabelFor(mode, focusNameFrom(DataManager.getData()));
    return { line: `${strings.poster.printsView} ${label}`, label, blocked: false };
}

/** The current view rendered as a poster, with the size + tiling geometry. */
interface PosterBuild {
    svg: string;
    widthPx: number;
    heightPx: number;
    /** Content predicate in poster-px space (origin top-left) for tile skipping. */
    hasContent: (x: number, y: number, w: number, h: number) => boolean;
}

/**
 * Build the poster for whatever view is on screen: the fan chart in fan view,
 * the timeline in timeline view, the tree card layout otherwise. Returns null
 * when there is nothing printable (empty tree, or the blocked map view).
 *
 * The poster leaves the house — the living-privacy filter applies here exactly
 * like in the book/GEDCOM exports (audit K2: it used to export raw full names
 * of living people with no option at all).
 */
function buildCurrentPoster(): PosterBuild | null {
    const mode = TreeRenderer.getViewMode();
    if (mode === 'map') return null; // not printable

    const data = applyLivingPrivacy(DataManager.getData(), posterPrivacyMode());
    const meta: PosterFooterMeta = {
        treeName: TreeManager.getActiveTreeMetadata()?.name,
        // Footer leaves the house — build the label from the SAME privacy-
        // filtered data as the cards, so a living focus person is not named in
        // full in the footer while their card shows only initials (audit K2).
        viewLabel: viewLabelFor(mode, focusNameFrom(data)),
        dateLabel: new Date().toLocaleDateString(),
    };

    if (mode === 'timeline') {
        // Persons = the SAME pipeline selection the on-screen timeline draws
        // (positions.keys()), fed through the privacy-filtered data so living
        // people are not named in full (audit K2).
        const ids = [...TreeRenderer.getPosterLayout().positions.keys()] as unknown as string[];
        const model = computeTimelineModel(data, ids, new Date().getFullYear());
        if (model.rows.length === 0) return null;
        // Poster rasterises to PNG without a CSS context, so var(--male/--female)
        // cannot resolve — read the concrete token values now (light fallback).
        const rootStyle = getComputedStyle(document.documentElement);
        const svg = buildTimelinePosterSvg(model, {
            esc: escapeXml,
            focusId: TreeRenderer.getFocusPersonId(),
            maleColor: rootStyle.getPropertyValue('--male').trim() || '#5b7f9e',
            femaleColor: rootStyle.getPropertyValue('--female').trim() || '#a1706e',
        }, meta);
        const geom = timelinePosterGeometry(model, true);
        return { svg, widthPx: geom.width, heightPx: geom.height, hasContent: geom.hasContent };
    }

    if (mode === 'fan') {
        const focusId = TreeRenderer.getFocusPersonId();
        if (!focusId) return null;
        const model = buildFanModel(data, focusId, TreeRenderer.getFanGenerations());
        if (!model) return null;
        const svg = buildFanPosterSvg(model, {
            esc: escapeXml,
            editable: false,
            addParentLabel: '',
            showKekule: SettingsManager.isFanKekuleEnabled(),
        }, meta);
        const geom = fanPosterGeometry(model, true);
        return { svg, widthPx: geom.width, heightPx: geom.height, hasContent: geom.hasContent };
    }

    // Tree / descendants: the card layout as currently laid out.
    const layout = TreeRenderer.getPosterLayout();
    if (layout.positions.size === 0) return null;
    // Draw-parity inputs shared with the on-screen renderer: branch colours
    // (when the setting is on) and the presumed-deceased † markers.
    const focusId = TreeRenderer.getFocusPersonId();
    const branchMap = (SettingsManager.isBranchColorsEnabled() && focusId)
        ? classifyBranches(data, focusId) as unknown as Map<string, string>
        : null;
    const options: PosterOptions = {
        ...meta,
        branchMap,
        deceasedSet: presumedDeceasedSet(data),
    };
    const svg = buildTreeSvg(data, layout, options);

    // Occupied rectangles in poster-px space (cards + footer strip). Sheets
    // that intersect NOTHING are skipped, so a sparse tree corner no longer
    // prints near-blank paper.
    const bounds = computeBounds(layout);
    const cfg = DEFAULT_LAYOUT_CONFIG;
    const widthPx = bounds.width + POSTER_PADDING * 2;
    const heightPx = bounds.height + POSTER_PADDING * 2 + FOOTER_HEIGHT;
    const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const pos of layout.positions.values()) {
        occupied.push({
            x: pos.x - bounds.minX + POSTER_PADDING,
            y: pos.y - bounds.minY + POSTER_PADDING,
            w: cfg.cardWidth,
            h: cfg.cardHeight,
        });
    }
    occupied.push({ x: POSTER_PADDING, y: heightPx - FOOTER_HEIGHT, w: 420, h: FOOTER_HEIGHT });
    const hasContent = (x: number, y: number, w: number, h: number): boolean =>
        occupied.some(o => o.x < x + w && o.x + o.w > x && o.y < y + h && o.y + o.h > y);
    return { svg, widthPx, heightPx, hasContent };
}

function downloadBlob(content: string, type: string, filename: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function svgDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const exportImageMethods = uiModule({
    showPosterDialog(): void {
        this.closeMobileMenu();
        const layout = TreeRenderer.getPosterLayout();
        if (layout.positions.size === 0) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        // Close the launching export dialog and take over the dialog stack, so a
        // parent dialog can't be reopened on top of the poster (z-index bug).
        document.getElementById('export-modal')?.classList.remove('active');
        this.clearDialogStack();
        this.pushDialog('poster-modal');
        document.getElementById('poster-modal')?.classList.add('active');

        // Tell the user WHAT will print (the poster prints what you are looking
        // at), and disable the export buttons for views that cannot be printed
        // as a poster (map: foreign raster tiles; timeline: not yet supported).
        const info = posterViewInfo();
        const labelEl = document.getElementById('poster-view-label');
        if (labelEl) labelEl.textContent = info.line;
        document.querySelectorAll<HTMLButtonElement>('#poster-modal .menu-option').forEach(btn => {
            btn.disabled = info.blocked;
            btn.classList.toggle('disabled', info.blocked);
        });
    },

    closePosterDialog(): void {
        document.getElementById('poster-modal')?.classList.remove('active');
        this.clearDialogStack();
    },

    /** Download the current view as a self-contained SVG. */
    exportPosterSvg(): void {
        const poster = buildCurrentPoster();
        if (!poster) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        downloadBlob(poster.svg, 'image/svg+xml', posterFilename('svg'));
        this.closePosterDialog();
    },

    /** Rasterize the current view to a 2x PNG (clamped to the canvas limit). */
    async exportPosterPng(): Promise<void> {
        const poster = buildCurrentPoster();
        if (!poster) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        const svg = poster.svg;
        const baseW = poster.widthPx;
        const baseH = poster.heightPx;

        let scale = 2;
        const maxScale = Math.min(MAX_CANVAS_PX / baseW, MAX_CANVAS_PX / baseH);
        let clamped = false;
        if (scale > maxScale) {
            scale = Math.max(1, maxScale);
            clamped = true;
        }

        try {
            const img = new Image();
            img.width = baseW;
            img.height = baseH;
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('SVG image load failed'));
                img.src = svgDataUrl(svg);
            });

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(baseW * scale);
            canvas.height = Math.round(baseH * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas 2D context unavailable');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = posterFilename('png');
            a.click();

            if (clamped) {
                this.showToast(strings.poster.pngScaledDown);
            }
            this.closePosterDialog();
        } catch (e) {
            console.error('PNG export failed:', e);
            this.showAlert(strings.poster.pngError, 'error');
        }
    },

    /**
     * Open the browser print dialog with the tree tiled across pages of the
     * chosen paper size/orientation, with a 10mm overlap and glue/crop marks.
     */
    printPosterPdf(): void {
        const poster = buildCurrentPoster();
        if (!poster) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        const svg = poster.svg;
        const format = (document.getElementById('poster-format') as HTMLSelectElement)?.value || 'A4';
        const orientation = (document.getElementById('poster-orientation') as HTMLSelectElement)?.value || 'portrait';
        const paper = PAPER[format] || PAPER.A4;
        const pageW = orientation === 'landscape' ? paper.h : paper.w;
        const pageH = orientation === 'landscape' ? paper.w : paper.h;
        const contentW = pageW - PAGE_MARGIN_MM * 2;
        const contentH = pageH - PAGE_MARGIN_MM * 2;

        const posterWmm = poster.widthPx * MM_PER_PX;
        const posterHmm = poster.heightPx * MM_PER_PX;

        const stepX = contentW - PAGE_OVERLAP_MM;
        const stepY = contentH - PAGE_OVERLAP_MM;
        const cols = Math.max(1, Math.ceil((posterWmm - PAGE_OVERLAP_MM) / stepX));
        const rows = Math.max(1, Math.ceil((posterHmm - PAGE_OVERLAP_MM) / stepY));

        // A sheet is printed only when it intersects drawn content — the poster
        // knows its own occupancy (card rects for the tree, the semicircle for
        // the fan), so sparse corners no longer print near-blank paper. Tiles
        // are mm-space; the predicate is px-space, so convert with MM_PER_PX.
        const tileHasContent = (offX: number, offY: number): boolean =>
            poster.hasContent(offX / MM_PER_PX, offY / MM_PER_PX, contentW / MM_PER_PX, contentH / MM_PER_PX);

        const dataUrl = svgDataUrl(svg);
        const pages: string[] = [];

        // Optional first page: the whole poster in miniature with the sheet
        // grid + labels overlaid, so the person gluing knows what goes where.
        let printedSheets = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (tileHasContent(c * stepX, r * stepY)) printedSheets++;
            }
        }

        const wantGuide = (document.getElementById('poster-guide-page') as HTMLInputElement | null)?.checked ?? true;
        if (wantGuide && rows * cols > 1) {
            const gs = Math.min((contentW - 4) / posterWmm, (contentH - 30) / posterHmm);
            const gw = posterWmm * gs;
            const gh = posterHmm * gs;
            const cells: string[] = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Each sheet covers [off, off+content], clipped to the poster.
                    const x = c * stepX * gs;
                    const y = r * stepY * gs;
                    const w = Math.min(contentW, posterWmm - c * stepX) * gs;
                    const h = Math.min(contentH, posterHmm - r * stepY) * gs;
                    const empty = !tileHasContent(c * stepX, r * stepY);
                    const label = empty ? strings.poster.emptySheet : strings.poster.pageLabel(r + 1, c + 1);
                    cells.push(`<div class="poster-guide-cell${empty ? ' skip' : ''}" style="left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm;width:${w.toFixed(2)}mm;height:${h.toFixed(2)}mm;"><span>${label}</span></div>`);
                }
            }
            pages.push(`
                <div class="poster-page poster-guide">
                    <div class="poster-guide-head">
                        <strong>${strings.poster.guideTitle}</strong>
                        <span>${strings.poster.guideInfo(printedSheets, rows, cols, PAGE_OVERLAP_MM)}</span>
                    </div>
                    <div class="poster-guide-map" style="width:${gw.toFixed(2)}mm;height:${gh.toFixed(2)}mm;">
                        <img src="${dataUrl}" style="width:${gw.toFixed(2)}mm;height:${gh.toFixed(2)}mm;">
                        ${cells.join('')}
                    </div>
                </div>`);
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const offX = c * stepX;
                const offY = r * stepY;
                if (!tileHasContent(offX, offY)) continue;   // blank sheet — skip
                pages.push(`
                    <div class="poster-page">
                        <div class="poster-page-clip" style="width:${contentW}mm;height:${contentH}mm;">
                            <img src="${dataUrl}" style="width:${posterWmm}mm;height:${posterHmm}mm;margin-left:-${offX}mm;margin-top:-${offY}mm;">
                        </div>
                        <div class="poster-mark tl"></div><div class="poster-mark tr"></div>
                        <div class="poster-mark bl"></div><div class="poster-mark br"></div>
                        <div class="poster-page-label">${strings.poster.pageLabel(r + 1, c + 1)}</div>
                    </div>`);
            }
        }

        const style = `
            @page { size: ${format} ${orientation}; margin: ${PAGE_MARGIN_MM}mm; }
            body.poster-printing > *:not(#poster-print) { display: none !important; }
            #poster-print { display: block !important; }
            .poster-print { font-family: sans-serif; }
            .poster-page { position: relative; width: ${contentW}mm; height: ${contentH}mm; page-break-after: always; overflow: hidden; }
            .poster-page:last-child { page-break-after: auto; }
            .poster-page-clip { overflow: hidden; position: relative; }
            .poster-mark { position: absolute; width: 6mm; height: 6mm; border: 0.2mm solid #000; }
            .poster-mark.tl { top: 0; left: 0; border-right: none; border-bottom: none; }
            .poster-mark.tr { top: 0; right: 0; border-left: none; border-bottom: none; }
            .poster-mark.bl { bottom: 0; left: 0; border-right: none; border-top: none; }
            .poster-mark.br { bottom: 0; right: 0; border-left: none; border-top: none; }
            .poster-page-label { position: absolute; bottom: 1mm; right: 2mm; font-size: 8pt; color: #666; }
            .poster-guide-head { display: flex; flex-direction: column; gap: 1mm; margin-bottom: 4mm; font-size: 11pt; }
            .poster-guide-head span { font-size: 9pt; color: #555; }
            .poster-guide-map { position: relative; margin: 0 auto; border: 0.3mm solid #bbb; }
            .poster-guide-map img { display: block; }
            .poster-guide-cell {
                position: absolute; box-sizing: border-box;
                border: 0.3mm dashed #c0392b;
                display: flex; align-items: center; justify-content: center;
            }
            .poster-guide-cell span {
                font-size: 9pt; color: #c0392b; background: rgba(255,255,255,0.75);
                padding: 0.5mm 1.5mm; border-radius: 1mm;
            }
            .poster-guide-cell.skip { border-color: #bbb; background: rgba(200,200,200,0.25); }
            .poster-guide-cell.skip span { color: #888; }
        `;

        let container = document.getElementById('poster-print');
        if (container) container.remove();
        container = document.createElement('div');
        container.id = 'poster-print';
        container.className = 'poster-print';
        const styleEl = document.createElement('style');
        styleEl.id = 'poster-print-style';
        styleEl.media = 'print';
        styleEl.textContent = style;
        container.innerHTML = pages.join('');
        document.body.appendChild(container);
        document.head.appendChild(styleEl);
        document.body.classList.add('poster-printing');

        const cleanup = () => {
            container?.remove();
            styleEl.remove();
            document.body.classList.remove('poster-printing');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        this.closePosterDialog();

        // Print ONLY after the tile images are decoded: Chrome snapshots the
        // page the moment print() is called, and firing it synchronously
        // produced print previews full of EMPTY pages (the SVG data URLs had
        // not finished decoding yet — reported live). All tiles share one
        // src, so decoding the first is enough; a timeout guards pathological
        // cases so the dialog always appears.
        const firstImg = container.querySelector('img');
        const ready = firstImg
            ? Promise.race([
                firstImg.decode().catch(() => undefined),
                new Promise<void>(resolve => setTimeout(resolve, 3000)),
            ])
            : Promise.resolve();
        void ready.then(() => window.print());
    },
});
