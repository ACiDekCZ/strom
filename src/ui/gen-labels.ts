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

/**
 * Two placements for the generation names. Flip this constant to switch.
 *
 *  'line' (default) — the name is written INTO the band's top boundary line,
 *      a fieldset-legend look (— PARENTS ———) with a var(--bg) mask under the
 *      text that hides the guide rule beneath it. The boundary lives in the
 *      empty world-space gutter between two generation rows, so the label can
 *      NEVER collide with a card — the `.covered` fade is unused in this mode.
 *
 *  'row' — the previous behaviour: the name floats at the row centre and fades
 *      out (`.covered`) under any card that pans over it.
 *
 * Both modes keep the small-zoom pitch hiding and the ↑ pin at the top edge.
 */
const GEN_LABEL_MODE: 'line' | 'row' = 'line';

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
// Clearance between a label and the chrome above it (toolbar, focus chip,
// descendants badge) — kolo 14 N1.
const CHROME_GAP = 8;
// Fallback half label height when the row cannot be measured.
const PIN_HALF = 8;

/** Screen rect of an element, or null when it is not rendered. */
function visibleRect(el: Element | null): DOMRect | null {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    if (getComputedStyle(el).visibility === 'hidden') return null;
    return r;
}

/**
 * Chrome that floats over the top of the canvas: the toolbar spans the whole
 * width; the focus chip and the descendants badge only block the labels whose
 * horizontal extent they overlap. Rects are in viewport coordinates.
 */
function topChromeRects(): { toolbar: DOMRect | null; floating: DOMRect[] } {
    const floating: DOMRect[] = [];
    for (const id of ['focus-controls', 'descendants-badge']) {
        const r = visibleRect(document.getElementById(id));
        if (r) floating.push(r);
    }
    return { toolbar: visibleRect(document.querySelector('.toolbar')), floating };
}

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

        overlay.classList.toggle('gen-labels--line', GEN_LABEL_MODE === 'line');

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

        const { scale, tx, ty } = ZoomPan.getTransform();
        const { height } = ZoomPan.getViewportSize();
        const container = document.getElementById('tree-container');
        const containerRect = container ? container.getBoundingClientRect() : null;

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

        const lineMode = GEN_LABEL_MODE === 'line';

        // Topmost container-relative Y a label box may occupy: below the
        // toolbar, and below the focus chip / descendants badge wherever the
        // label runs underneath them (kolo 14 N1). Labels are never clipped by
        // the chrome — they pin below it or hide.
        const chrome = topChromeRects();
        const cTop = containerRect ? containerRect.top : 0;
        const cLeft = containerRect ? containerRect.left : 0;
        const baseMinTop = Math.max(EDGE_PAD,
            chrome.toolbar ? chrome.toolbar.bottom - cTop + CHROME_GAP : 0);
        const minTopFor = (row: HTMLElement): number => {
            const left = cLeft + row.offsetLeft;
            const right = left + row.offsetWidth;
            let minTop = baseMinTop;
            for (const r of chrome.floating) {
                if (r.left < right && r.right > left) {
                    minTop = Math.max(minTop, r.bottom - cTop + CHROME_GAP);
                }
            }
            return minTop;
        };
        // Visible label boxes (container-relative) for the pinned-vs-next check.
        const shown: { row: HTMLElement; top: number; bottom: number; pinned: boolean }[] = [];

        // Cards take precedence over labels (row mode only): project every card
        // rect to screen space (same coordinate system the labels use —
        // container-relative), so a label a card has panned over can fade out
        // instead of printing on top of the person. In line mode the labels sit
        // on the boundary rules in the empty band gutters and never collide, so
        // this projection is skipped entirely.
        // (Line mode projects them lazily, only when a label is pinned: a
        // pinned label leaves its gutter and sits inside the band.)
        type ScreenRect = { left: number; top: number; right: number; bottom: number };
        let projected: ScreenRect[] | null = null;
        const getCardRects = (): ScreenRect[] => {
            if (!projected) {
                projected = TreeRenderer.getCardWorldRects().map(r => ({
                    left: r.x * scale + tx,
                    top: r.y * scale + ty,
                    right: (r.x + r.w) * scale + tx,
                    bottom: (r.y + r.h) * scale + ty,
                }));
            }
            return projected;
        };

        for (const { row, arrow, band } of els) {
            const rowY = band.rowCenterY * scale + ty;
            const bandTop = band.bandTopY * scale + ty;
            const bandBottom = band.bandBottomY * scale + ty;

            if (bandBottom < EDGE_PAD || bandTop > height - 4) {
                // Band lies entirely outside the viewport.
                row.style.display = 'none';
                continue;
            }

            // The label anchors to the band's top boundary line in line mode,
            // to the row centre in row mode.
            const anchorY = lineMode ? bandTop : rowY;

            // Measure the row (it must be displayed for offset* to be real).
            // The arrow is shown for the measurement so a pinned label's width
            // is what the chrome overlap test sees.
            row.style.display = '';
            arrow.style.display = '';
            const halfH = row.offsetHeight > 0 ? row.offsetHeight / 2 : PIN_HALF;
            const minTop = minTopFor(row);

            let centerY: number;
            let pinned = false;
            if (anchorY - halfH < minTop) {
                // The anchor scrolled up under the chrome, but the band may
                // still reach in: pin the label just below the chrome with an
                // up-arrow — only while the band still shows below the label.
                centerY = minTop + halfH;
                pinned = true;
                if (bandBottom < centerY + halfH) {
                    row.style.display = 'none';
                    continue;
                }
            } else if (anchorY + halfH > height) {
                // Would be cut off at the bottom edge: hide, never clip.
                row.style.display = 'none';
                continue;
            } else {
                centerY = anchorY;
            }

            row.style.top = `${centerY}px`;
            arrow.style.display = pinned ? '' : 'none';
            shown.push({ row, top: centerY - halfH, bottom: centerY + halfH, pinned });

            if (lineMode) {
                // Line mode never collides with a card — the boundary lives in
                // an empty gutter — so `.covered` stays off. A PINNED label
                // sits inside the band, though: hide it (never print it over a
                // person) when a card is under it.
                row.classList.remove('covered');
                if (pinned) {
                    const l = row.offsetLeft, r = l + row.offsetWidth;
                    const t = centerY - halfH, b = centerY + halfH;
                    if (getCardRects().some(c => c.left < r && c.right > l && c.top < b && c.bottom > t)) {
                        row.style.display = 'none';
                        shown.pop();
                    }
                }
                continue;
            }

            // Fade the label out if any card covers it. The row keeps its
            // 'display' so opacity can transition (see .gen-label.covered CSS);
            // its measured screen box is read AFTER the top write above.
            const labelLeft = row.offsetLeft;
            const labelWidth = row.offsetWidth;
            const lLeft = labelLeft;
            const lRight = labelLeft + labelWidth;
            const lTop = centerY - halfH;
            const lBottom = centerY + halfH;
            const covered = getCardRects().some(c =>
                c.left < lRight && c.right > lLeft && c.top < lBottom && c.bottom > lTop);
            row.classList.toggle('covered', covered);
        }

        // A pinned label must not sit on top of the next band's own label
        // (the next boundary is just below the chrome): the real boundary
        // label wins, the pinned one hides.
        for (let i = 0; i + 1 < shown.length; i++) {
            const a = shown[i];
            const b = shown[i + 1];
            if (a.pinned && a.bottom > b.top) a.row.style.display = 'none';
        }
    },
});
