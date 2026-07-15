/**
 * Overview minimap: a small canvas in the corner showing every card as a plain
 * rectangle plus a viewport frame, so large trees stay navigable. Read-only vs
 * TreeRenderer/ZoomPan — it redraws off the render cycle (updateMinimap) and off
 * ZoomPan.onChange (viewport frame), and only writes back through
 * ZoomPan.centerOnWorldPoint when the user clicks or drags inside it.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { DEFAULT_LAYOUT_CONFIG, PersonId, Position, STANDALONE_VIEWS } from '../types.js';
import { uiModule } from './module.js';

// Panel geometry (CSS px). Kept small; the card loop is a bare fillRect sweep.
const MINIMAP_W = 180;
const MINIMAP_H = 120;
const MINIMAP_PAD = 8;
const MOBILE_MAX = 500;
// Below this world-overflow ratio the tree fits comfortably — hide the minimap.
const FIT_MARGIN = 1.05;

export interface WorldBox { minX: number; minY: number; maxX: number; maxY: number; }
export interface MinimapTransform { scale: number; offsetX: number; offsetY: number; }

/**
 * Fit a world box into the minimap box (uniform scale, centered). Pure so the
 * geometry is unit-testable without a DOM. worldToMinimap: mmX = wx*scale+offsetX.
 */
export function computeMinimapTransform(
    box: WorldBox, mmW: number, mmH: number, pad: number
): MinimapTransform {
    const worldW = Math.max(1, box.maxX - box.minX);
    const worldH = Math.max(1, box.maxY - box.minY);
    const innerW = Math.max(1, mmW - 2 * pad);
    const innerH = Math.max(1, mmH - 2 * pad);
    const scale = Math.min(innerW / worldW, innerH / worldH);
    const offsetX = pad + (innerW - worldW * scale) / 2 - box.minX * scale;
    const offsetY = pad + (innerH - worldH * scale) / 2 - box.minY * scale;
    return { scale, offsetX, offsetY };
}

/** World bounding box over all card rectangles (pos = top-left corner). */
export function worldBoundingBox(
    positions: Map<PersonId, Position>, cardW: number, cardH: number
): WorldBox | null {
    if (positions.size === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of positions.values()) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + cardW);
        maxY = Math.max(maxY, pos.y + cardH);
    }
    return { minX, minY, maxX, maxY };
}

export const minimapMethods = uiModule({
    /** Wire the minimap once at startup (canvas handlers + ZoomPan sync). */
    initMinimap(): void {
        const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
        if (!canvas) return;
        canvas.width = MINIMAP_W;
        canvas.height = MINIMAP_H;

        const toWorldAndCenter = (clientX: number, clientY: number): void => {
            const t = this.minimapTransform;
            if (!t) return;
            const rect = canvas.getBoundingClientRect();
            const mmX = clientX - rect.left;
            const mmY = clientY - rect.top;
            ZoomPan.centerOnWorldPoint((mmX - t.offsetX) / t.scale, (mmY - t.offsetY) / t.scale);
        };

        canvas.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();  // do not start a canvas pan
            this.minimapDragging = true;
            canvas.setPointerCapture(e.pointerId);
            toWorldAndCenter(e.clientX, e.clientY);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!this.minimapDragging) return;
            e.preventDefault();
            toWorldAndCenter(e.clientX, e.clientY);
        });
        const end = (e: PointerEvent) => {
            this.minimapDragging = false;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);

        // Sync the viewport frame (and re-evaluate visibility, since it depends
        // on the current zoom) during pan/zoom — throttled to stay light.
        ZoomPan.onChange(() => {
            if (this.minimapViewportTimer) return;
            this.minimapViewportTimer = setTimeout(() => {
                this.minimapViewportTimer = null;
                this.updateMinimap();
            }, 30);
        });
    },

    /** Full redraw after a layout change; also decides visibility. */
    updateMinimap(): void {
        const panel = document.getElementById('minimap-panel');
        const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
        if (!panel || !canvas) return;

        const positions = TreeRenderer.getPosterLayout().positions;
        const isMobile = window.innerWidth < MOBILE_MAX;
        const { cardWidth, cardHeight } = DEFAULT_LAYOUT_CONFIG;
        const box = worldBoundingBox(positions, cardWidth, cardHeight);

        // The minimap navigates the tree canvas; the views with their own
        // container (timeline, fan, map) have nothing for it to steer.
        if (!SettingsManager.isMinimapEnabled() || isMobile || !box
            || STANDALONE_VIEWS.includes(TreeRenderer.getViewMode())) {
            panel.style.display = 'none';
            this.minimapTransform = null;
            return;
        }

        // Only worth showing when the tree overflows the viewport.
        const { width: vpW, height: vpH } = ZoomPan.getViewportSize();
        const { scale } = ZoomPan.getTransform();
        const worldVisibleW = vpW / scale, worldVisibleH = vpH / scale;
        const overflows = (box.maxX - box.minX) > worldVisibleW * FIT_MARGIN
            || (box.maxY - box.minY) > worldVisibleH * FIT_MARGIN;
        if (!overflows) {
            panel.style.display = 'none';
            this.minimapTransform = null;
            return;
        }

        panel.style.display = 'block';
        this.minimapBox = box;
        this.minimapTransform = computeMinimapTransform(box, MINIMAP_W, MINIMAP_H, MINIMAP_PAD);
        this.drawMinimap();
    },

    /** Paint cards + the current viewport frame onto the minimap canvas. */
    drawMinimap(): void {
        const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
        const t = this.minimapTransform;
        const box = this.minimapBox;
        if (!canvas || !t || !box) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
        const { cardWidth, cardHeight } = DEFAULT_LAYOUT_CONFIG;
        const positions = TreeRenderer.getPosterLayout().positions;
        const data = DataManager.getData();

        for (const [id, pos] of positions) {
            const person = data.persons[id];
            const w = Math.max(1, cardWidth * t.scale);
            const h = Math.max(1, cardHeight * t.scale);
            ctx.fillStyle = person?.gender === 'female' ? '#e8a0bf' : '#8fb8de';
            ctx.fillRect(pos.x * t.scale + t.offsetX, pos.y * t.scale + t.offsetY, w, h);
        }

        // Viewport frame: world-visible rectangle mapped into minimap space.
        const { width: vpW, height: vpH } = ZoomPan.getViewportSize();
        const { scale, tx, ty } = ZoomPan.getTransform();
        if (scale > 0) {
            const wx0 = -tx / scale, wy0 = -ty / scale;
            const vx = wx0 * t.scale + t.offsetX;
            const vy = wy0 * t.scale + t.offsetY;
            const vw = (vpW / scale) * t.scale;
            const vh = (vpH / scale) * t.scale;
            ctx.strokeStyle = '#d33';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(
                Math.max(0, vx), Math.max(0, vy),
                Math.min(vw, MINIMAP_W - Math.max(0, vx)),
                Math.min(vh, MINIMAP_H - Math.max(0, vy)),
            );
        }
    },
});
