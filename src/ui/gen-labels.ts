/**
 * Sticky generation labels: the small-caps band names (GRANDPARENTS / PARENTS /
 * FOCUS GENERATION / CHILDREN …) pinned to the left edge of the canvas. The
 * guide LINES stay in the SVG and scroll with the tree; only the labels live
 * here, in an HTML overlay OUTSIDE the pan/zoom transform, so they hold their
 * place while the tree moves underneath.
 *
 * Like the minimap, this reads TreeRenderer/ZoomPan and never writes back. It
 * reprojects once per transform change (ZoomPan.onChange) — never per frame —
 * and the projection is O(bands) (a handful of rows), so panning stays smooth.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { TreeRenderer, GenerationBand } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { SettingsManager } from '../settings.js';
import { uiModule } from './module.js';

// Below this zoom the labels are noise on a distant tree — hide them.
/**
 * Hide the labels only when generation bands get too CRAMPED on screen to
 * label usefully. A raw scale threshold (the spec's 0.6) tripped one zoom
 * step from the default view, because fit-to-screen already works below
 * scale 1 on any real tree — the honest measure is the projected band pitch.
 */
const MIN_BAND_PITCH_PX = 56;
// Padding from the container's top edge for a pinned label.
const EDGE_PAD = 10;
// Half the label height, so a top-pinned row shows fully.
const PIN_HALF = 8;

interface GenLabelEl { row: HTMLElement; text: HTMLElement; arrow: HTMLElement; band: GenerationBand; }

export const genLabelsMethods = uiModule({
    /** Wire the overlay once at startup (ZoomPan sync + resize). */
    initGenLabels(): void {
        const overlay = document.getElementById('gen-labels');
        if (!overlay) return;

        // One reposition per transform change (no per-frame polling). While the
        // transform keeps changing the overlay is dimmed; it brightens 150ms
        // after motion stops.
        ZoomPan.onChange(() => {
            overlay.classList.add('panning');
            if (this.genLabelsPanTimer) clearTimeout(this.genLabelsPanTimer);
            this.genLabelsPanTimer = setTimeout(() => {
                this.genLabelsPanTimer = null;
                overlay.classList.remove('panning');
            }, 150);
            this.positionGenLabels();
        });

        window.addEventListener('resize', () => this.positionGenLabels());
    },

    /** Rebuild the label rows after a layout change, then project them. */
    updateGenLabels(): void {
        const overlay = document.getElementById('gen-labels');
        if (!overlay) return;

        const bands = SettingsManager.isGenLabelsEnabled() ? TreeRenderer.getGenerationBands() : [];
        overlay.innerHTML = '';
        this.genLabelEls = [];

        if (bands.length === 0) {
            overlay.style.display = 'none';
            return;
        }

        for (const band of bands) {
            const row = document.createElement('div');
            row.className = 'gen-label';
            const arrow = document.createElement('span');
            arrow.className = 'gen-label-arrow';
            arrow.textContent = '↑';  // ↑ — a glyph, not text (i18n-safe)
            const text = document.createElement('span');
            text.className = 'gen-label-text';
            text.textContent = band.label;
            row.appendChild(arrow);
            row.appendChild(text);
            overlay.appendChild(row);
            this.genLabelEls.push({ row, text, arrow, band });
        }

        this.positionGenLabels();
    },

    /** Project each band's world Y to the current screen Y (O(bands)). */
    positionGenLabels(): void {
        const overlay = document.getElementById('gen-labels');
        if (!overlay) return;
        const els = this.genLabelEls;
        if (!els || els.length === 0) {
            overlay.style.display = 'none';
            return;
        }

        const { scale, ty } = ZoomPan.getTransform();
        const { height } = ZoomPan.getViewportSize();

        // Hide the whole overlay when bands are too cramped to label (screen
        // pitch of one generation row), not at an arbitrary zoom scale.
        const worldPitch = els.length > 1
            ? (els[els.length - 1].band.rowCenterY - els[0].band.rowCenterY) / (els.length - 1)
            : els[0].band.bandBottomY - els[0].band.bandTopY;
        if (worldPitch * scale < MIN_BAND_PITCH_PX || height <= 0) {
            overlay.style.display = 'none';
            return;
        }
        overlay.style.display = 'block';

        for (const { row, arrow, band } of els) {
            const rowY = band.rowCenterY * scale + ty;
            const bandTop = band.bandTopY * scale + ty;
            const bandBottom = band.bandBottomY * scale + ty;

            if (bandBottom < EDGE_PAD || bandTop > height - 4) {
                // Band lies entirely outside the viewport.
                row.style.display = 'none';
                continue;
            }

            let centerY: number;
            let pinned = false;
            if (rowY < EDGE_PAD) {
                // The row scrolled above the top, but the band still reaches in:
                // pin the label to the top edge with an up-arrow.
                centerY = EDGE_PAD + PIN_HALF;
                pinned = true;
            } else if (rowY > height - 4) {
                row.style.display = 'none';
                continue;
            } else {
                centerY = rowY;
            }

            row.style.display = '';
            row.style.top = `${centerY}px`;
            arrow.style.display = pinned ? '' : 'none';
        }
    },
});
