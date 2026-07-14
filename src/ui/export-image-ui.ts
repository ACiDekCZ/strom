/**
 * Poster export UI: download the current tree as SVG or PNG, or print it as a
 * tiled multi-page PDF (via the browser print dialog). Split from UIClass; see
 * src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { buildTreeSvg, computeBounds, PosterOptions, FOOTER_HEIGHT } from '../export-image.js';
import { uiModule } from './module.js';
import { DEFAULT_LAYOUT_CONFIG } from '../types.js';
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

function currentPosterSvg(): string | null {
    const layout = TreeRenderer.getPosterLayout();
    if (layout.positions.size === 0) return null;
    // The poster leaves the house — the living-privacy filter applies here
    // exactly like in the book/GEDCOM exports (audit K2: it used to export
    // raw full names of living people with no option at all).
    const data = applyLivingPrivacy(DataManager.getData(), posterPrivacyMode());
    // Draw-parity inputs shared with the on-screen renderer: branch colours
    // (when the setting is on) and the presumed-deceased † markers.
    const focusId = TreeRenderer.getFocusPersonId();
    const branchMap = (SettingsManager.isBranchColorsEnabled() && focusId)
        ? classifyBranches(data, focusId) as unknown as Map<string, string>
        : null;
    const options: PosterOptions = {
        treeName: TreeManager.getActiveTreeMetadata()?.name,
        dateLabel: new Date().toLocaleDateString(),
        branchMap,
        deceasedSet: presumedDeceasedSet(data),
    };
    return buildTreeSvg(data, layout, options);
}

/** Exact pixel size of the poster SVG (must match buildTreeSvg's math). */
function posterPixelSize(): { w: number; h: number } {
    const bounds = computeBounds(TreeRenderer.getPosterLayout());
    // 2×40 padding + footer (always present: dateLabel is always set).
    return { w: bounds.width + 80, h: bounds.height + 80 + FOOTER_HEIGHT };
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
    },

    closePosterDialog(): void {
        document.getElementById('poster-modal')?.classList.remove('active');
        this.clearDialogStack();
    },

    /** Download the current tree as a self-contained SVG. */
    exportPosterSvg(): void {
        const svg = currentPosterSvg();
        if (!svg) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        downloadBlob(svg, 'image/svg+xml', posterFilename('svg'));
        this.closePosterDialog();
    },

    /** Rasterize the current tree to a 2x PNG (clamped to the canvas limit). */
    async exportPosterPng(): Promise<void> {
        const svg = currentPosterSvg();
        if (!svg) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        const { w: baseW, h: baseH } = posterPixelSize();

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
        const svg = currentPosterSvg();
        if (!svg) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        const format = (document.getElementById('poster-format') as HTMLSelectElement)?.value || 'A4';
        const orientation = (document.getElementById('poster-orientation') as HTMLSelectElement)?.value || 'portrait';
        const paper = PAPER[format] || PAPER.A4;
        const pageW = orientation === 'landscape' ? paper.h : paper.w;
        const pageH = orientation === 'landscape' ? paper.w : paper.h;
        const contentW = pageW - PAGE_MARGIN_MM * 2;
        const contentH = pageH - PAGE_MARGIN_MM * 2;

        const { w: posterWpx, h: posterHpx } = posterPixelSize();
        const posterWmm = posterWpx * MM_PER_PX;
        const posterHmm = posterHpx * MM_PER_PX;

        const stepX = contentW - PAGE_OVERLAP_MM;
        const stepY = contentH - PAGE_OVERLAP_MM;
        const cols = Math.max(1, Math.ceil((posterWmm - PAGE_OVERLAP_MM) / stepX));
        const rows = Math.max(1, Math.ceil((posterHmm - PAGE_OVERLAP_MM) / stepY));

        // Occupied rectangles in poster-mm space (cards + the footer strip at
        // the bottom-left) — sheets that intersect NOTHING are skipped, so a
        // sparse tree corner no longer prints near-blank paper.
        const layout = TreeRenderer.getPosterLayout();
        const bounds = computeBounds(layout);
        const PAD_PX = 40;
        const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
        const cfg = DEFAULT_LAYOUT_CONFIG;
        for (const pos of layout.positions.values()) {
            occupied.push({
                x: (pos.x - bounds.minX + PAD_PX) * MM_PER_PX,
                y: (pos.y - bounds.minY + PAD_PX) * MM_PER_PX,
                w: cfg.cardWidth * MM_PER_PX,
                h: cfg.cardHeight * MM_PER_PX,
            });
        }
        // Footer (title · date), bottom-left. Width is a generous estimate.
        occupied.push({
            x: PAD_PX * MM_PER_PX,
            y: posterHmm - FOOTER_HEIGHT * MM_PER_PX,
            w: 420 * MM_PER_PX,
            h: FOOTER_HEIGHT * MM_PER_PX,
        });
        const tileHasContent = (offX: number, offY: number): boolean =>
            occupied.some(o =>
                o.x < offX + contentW && o.x + o.w > offX &&
                o.y < offY + contentH && o.y + o.h > offY);

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
