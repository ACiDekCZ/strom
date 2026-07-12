/**
 * Poster export UI: download the current tree as SVG or PNG, or print it as a
 * tiled multi-page PDF (via the browser print dialog). Split from UIClass; see
 * src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { buildTreeSvg, computeBounds, PosterOptions } from '../export-image.js';
import { uiModule } from './module.js';

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

function currentPosterSvg(): string | null {
    const layout = TreeRenderer.getPosterLayout();
    if (layout.positions.size === 0) return null;
    const options: PosterOptions = {
        treeName: TreeManager.getActiveTreeMetadata()?.name,
        dateLabel: new Date().toLocaleDateString(),
    };
    return buildTreeSvg(DataManager.getData(), layout, options);
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
        document.getElementById('poster-modal')?.classList.add('active');
    },

    closePosterDialog(): void {
        document.getElementById('poster-modal')?.classList.remove('active');
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
        const layout = TreeRenderer.getPosterLayout();
        const bounds = computeBounds(layout);
        const baseW = bounds.width + 80;
        const baseH = bounds.height + 80;

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

        const layout = TreeRenderer.getPosterLayout();
        const bounds = computeBounds(layout);
        const posterWmm = (bounds.width + 80) * MM_PER_PX;
        const posterHmm = (bounds.height + 80) * MM_PER_PX;

        const stepX = contentW - PAGE_OVERLAP_MM;
        const stepY = contentH - PAGE_OVERLAP_MM;
        const cols = Math.max(1, Math.ceil((posterWmm - PAGE_OVERLAP_MM) / stepX));
        const rows = Math.max(1, Math.ceil((posterHmm - PAGE_OVERLAP_MM) / stepY));

        const dataUrl = svgDataUrl(svg);
        const pages: string[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const offX = c * stepX;
                const offY = r * stepY;
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
        window.print();
    },
});
