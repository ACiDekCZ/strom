/**
 * ZoomPan - Pan and zoom controls for the tree canvas
 * Optimized for both mouse and touch devices
 */

import { PersonId } from './types.js';

// Import dynamically to avoid circular dependency
let getTreeRenderer: () => { getFocusPersonId: () => PersonId | null } | null = () => null;

export function setTreeRendererGetter(getter: () => { getFocusPersonId: () => PersonId | null }): void {
    getTreeRenderer = getter;
}

// Constants for touch handling
const TAP_THRESHOLD_MS = 200;  // Max time for a tap
const TAP_THRESHOLD_PX = 10;   // Max movement for a tap
/**
 * Manual zoom floor (wheel, pinch, the − button) for a tree that fits the
 * screen at this scale or above. A wider tree lowers the floor to its own fit
 * scale (see minScale), so "fit to screen" shows all of it and zooming out by
 * hand still reaches that view (T04: wide custom cards on a phone).
 */
const MIN_SCALE = 0.15;
/** Hard floor of the fit scale: below it cards are specks (and --zoom-inv stops growing). */
const FIT_MIN_SCALE = 0.05;
/** Fit to screen never zooms a small tree in past this. */
const FIT_MAX_SCALE = 1.5;
/** Margin (world px) around the cards when the whole tree is fitted to the screen. */
const FIT_PADDING = 50;
const MAX_SCALE = 4;
/** Below this scale the card badges become dots and the status icons hide. */
const ZOOM_FAR = 0.55;
/** Below this scale the research edge's stub becomes a stretch of the card's top edge. */
const ZOOM_EDGE_BAR = 0.6;
/** From this scale on the stub has its word (a hair under 1: a reset lands on 1 exactly). */
const ZOOM_EDGE_LABELS = 0.999;
const ZOOM_BUTTON_FACTOR = 1.3;
const ZOOM_ANIMATION_DURATION = 200; // ms
/**
 * A wheel zoom has no end event: the canvas keeps its compositor layer until
 * the wheel has been quiet this long, then it is drawn sharp again.
 */
const WHEEL_IDLE_MS = 150;
/** Class on #tree-canvas while it moves (drag, pinch, wheel, animation): will-change: transform. */
const MOVING_CLASS = 'is-moving';
/** Views drawn in their own container over the (hidden) tree canvas. */
// The welcome of an empty tree scrolls itself too (a phone held sideways is shorter than it).
const STANDALONE_VIEW_SELECTOR = '.timeline-container, .fan-container, .map-container, #empty-state';

interface TouchState {
    startTime: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    isTap: boolean;
    isPanning: boolean;
}

class ZoomPanClass {
    private scale = 1;
    private tx = 0;
    private ty = 0;

    // Mouse dragging
    private dragging = false;
    private dragStartX = 0;
    private dragStartY = 0;

    // Touch handling
    private touchState: TouchState | null = null;
    private lastPinchDistance = 0;
    private lastPinchCenterX = 0;
    private lastPinchCenterY = 0;

    // Animation
    private animationFrame: number | null = null;

    // Wheel zoom idle timer (the layer hint stays on until it fires)
    private wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

    // Listeners notified after every transform change (minimap viewport sync).
    private changeListeners: Array<() => void> = [];

    init(): void {
        const container = document.getElementById('tree-container');
        if (!container) return;

        // Mouse events
        container.addEventListener('mousedown', (e) => this.onMouseDown(e));
        container.addEventListener('mousemove', (e) => this.onMouseMove(e));
        container.addEventListener('mouseup', () => this.onMouseUp());
        container.addEventListener('mouseleave', () => this.onMouseUp());
        container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // Touch events - use passive: false only where needed
        container.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        container.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        container.addEventListener('touchend', (e) => this.onTouchEnd(e));
        container.addEventListener('touchcancel', () => this.onTouchCancel());
    }

    // ==================== MOUSE EVENTS ====================

    private onMouseDown(e: MouseEvent): void {
        // Don't start drag on person cards, context menu, or interactive elements
        const target = e.target as HTMLElement;
        if (this.isInteractiveElement(target)) return;

        this.dragging = true;
        this.dragStartX = e.clientX - this.tx;
        this.dragStartY = e.clientY - this.ty;
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.dragging) return;
        this.beginMotion();
        this.tx = e.clientX - this.dragStartX;
        this.ty = e.clientY - this.dragStartY;
        this.apply();
    }

    private onMouseUp(): void {
        this.dragging = false;
        this.endMotion();
    }

    private onWheel(e: WheelEvent): void {
        // Timeline and fan scroll natively and the map zooms itself — never
        // hijack their wheel events (it zoomed the hidden tree canvas).
        if ((e.target as HTMLElement).closest?.(STANDALONE_VIEW_SELECTOR)) return;
        e.preventDefault();

        const container = document.getElementById('tree-container');
        if (!container) return;

        // Get mouse position relative to container
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate zoom factor
        const delta = e.deltaY > 0 ? 0.9 : 1.1;

        this.beginMotion();
        if (this.wheelIdleTimer !== null) clearTimeout(this.wheelIdleTimer);
        this.wheelIdleTimer = setTimeout(() => {
            this.wheelIdleTimer = null;
            this.endMotion();
        }, WHEEL_IDLE_MS);

        // Zoom toward mouse position
        this.zoomToPoint(mouseX, mouseY, delta);
    }

    // ==================== TOUCH EVENTS ====================

    private onTouchStart(e: TouchEvent): void {
        const target = e.target as HTMLElement;

        // Allow default behavior on person cards (for click/tap to work)
        // and inside the timeline (native touch scrolling). The card guard
        // only applies to SINGLE-finger touches — a two-finger pinch that
        // happens to start on cards must still zoom (on dense trees cards
        // cover most of the screen and pinch otherwise never engages).
        if (e.touches.length === 1
            && (target.closest('.person-card') || target.closest('.context-menu')
                || target.closest(STANDALONE_VIEW_SELECTOR))) {
            // Don't interfere with person card interactions
            return;
        }
        if (e.touches.length > 1 && target.closest(STANDALONE_VIEW_SELECTOR)) {
            return;   // timeline/fan/map pinch stays theirs
        }

        if (e.touches.length === 1) {
            // Single finger - potential tap or pan
            const touch = e.touches[0];
            this.touchState = {
                startTime: Date.now(),
                startX: touch.clientX,
                startY: touch.clientY,
                lastX: touch.clientX,
                lastY: touch.clientY,
                isTap: true,
                isPanning: false
            };
            // Don't prevent default yet - wait to see if it's a tap or pan
        } else if (e.touches.length === 2) {
            // Two fingers - pinch zoom
            e.preventDefault();
            this.touchState = null; // Cancel any single-finger state

            this.lastPinchDistance = this.getTouchDistance(e.touches);
            const center = this.getTouchCenter(e.touches);
            this.lastPinchCenterX = center.x;
            this.lastPinchCenterY = center.y;
            this.beginMotion();
        }
    }

    private onTouchMove(e: TouchEvent): void {
        // Timeline/fan scroll natively, the map pans itself.
        if ((e.target as HTMLElement).closest?.(STANDALONE_VIEW_SELECTOR)) return;
        if (e.touches.length === 1 && this.touchState) {
            const touch = e.touches[0];
            const dx = touch.clientX - this.touchState.startX;
            const dy = touch.clientY - this.touchState.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Check if moved enough to be a pan
            if (distance > TAP_THRESHOLD_PX) {
                this.touchState.isTap = false;

                if (!this.touchState.isPanning) {
                    // Start panning
                    this.touchState.isPanning = true;
                    this.beginMotion();
                    this.touchState.lastX = touch.clientX;
                    this.touchState.lastY = touch.clientY;
                }
            }

            if (this.touchState.isPanning) {
                e.preventDefault(); // Only prevent default when actually panning

                // Calculate delta from last position
                const moveX = touch.clientX - this.touchState.lastX;
                const moveY = touch.clientY - this.touchState.lastY;

                this.tx += moveX;
                this.ty += moveY;
                this.apply();

                this.touchState.lastX = touch.clientX;
                this.touchState.lastY = touch.clientY;
            }
        } else if (e.touches.length === 2) {
            // Pinch zoom
            e.preventDefault();

            const newDistance = this.getTouchDistance(e.touches);
            const center = this.getTouchCenter(e.touches);

            if (this.lastPinchDistance > 0) {
                const scaleFactor = newDistance / this.lastPinchDistance;

                // Get container for coordinate calculation
                const container = document.getElementById('tree-container');
                if (container) {
                    const rect = container.getBoundingClientRect();
                    const centerX = center.x - rect.left;
                    const centerY = center.y - rect.top;

                    // Zoom toward pinch center
                    this.zoomToPoint(centerX, centerY, scaleFactor);
                }
            }

            this.lastPinchDistance = newDistance;
            this.lastPinchCenterX = center.x;
            this.lastPinchCenterY = center.y;
        }
    }

    private onTouchEnd(e: TouchEvent): void {
        // Check for remaining touches (for multi-touch scenarios)
        if (e.touches.length === 0) {
            // All fingers lifted
            this.lastPinchDistance = 0;
            this.touchState = null;
            this.endMotion();
        } else if (e.touches.length === 1 && this.lastPinchDistance > 0) {
            // Went from pinch to single finger - reset to pan mode
            this.lastPinchDistance = 0;
            const touch = e.touches[0];
            this.touchState = {
                startTime: Date.now(),
                startX: touch.clientX,
                startY: touch.clientY,
                lastX: touch.clientX,
                lastY: touch.clientY,
                isTap: false, // Not a tap since we were pinching
                isPanning: true
            };
        }
    }

    private onTouchCancel(): void {
        this.touchState = null;
        this.lastPinchDistance = 0;
        this.endMotion();
    }

    // ==================== LAYER HINT ====================

    /**
     * While the canvas moves it is its own compositor layer (will-change:
     * transform), so dragging stays smooth. A layer kept for good is drawn
     * once and then only scaled, which blurs the cards; at rest the hint is
     * dropped and the browser draws the cards sharp at the current scale.
     */
    private beginMotion(): void {
        document.getElementById('tree-canvas')?.classList.add(MOVING_CLASS);
    }

    /** Drop the layer hint, unless something still moves the canvas. */
    private endMotion(): void {
        if (this.dragging || this.touchState?.isPanning || this.lastPinchDistance > 0
            || this.animationFrame !== null || this.wheelIdleTimer !== null) return;
        document.getElementById('tree-canvas')?.classList.remove(MOVING_CLASS);
    }

    // ==================== HELPER METHODS ====================

    private isInteractiveElement(target: HTMLElement): boolean {
        return !!(
            target.closest(STANDALONE_VIEW_SELECTOR) ||
            target.closest('.person-card') ||
            target.closest('.context-menu') ||
            target.closest('.modal') ||
            target.closest('.toolbar') ||
            target.closest('.focus-controls') ||
            target.closest('.zoom-controls') ||
            target.closest('button') ||
            target.closest('input') ||
            target.closest('select')
        );
    }

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private getTouchCenter(touches: TouchList): { x: number; y: number } {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    /**
     * Zoom toward a specific point in container coordinates
     */
    private zoomToPoint(pointX: number, pointY: number, scaleFactor: number): void {
        const oldScale = this.scale;
        const newScale = Math.max(this.zoomOutFloor(oldScale * scaleFactor),
            Math.min(MAX_SCALE, oldScale * scaleFactor));

        if (newScale === oldScale) return;

        // Calculate the point in canvas coordinates before zoom
        // point_canvas = (point_container - tx) / scale
        const canvasX = (pointX - this.tx) / oldScale;
        const canvasY = (pointY - this.ty) / oldScale;

        // Update scale
        this.scale = newScale;

        // Adjust translation so the point stays in the same place
        // point_container = point_canvas * newScale + new_tx
        // We want point_container to be the same, so:
        // new_tx = point_container - point_canvas * newScale
        this.tx = pointX - canvasX * newScale;
        this.ty = pointY - canvasY * newScale;

        this.apply();
    }

    /**
     * Animate zoom to a target scale, centered on viewport center
     */
    private animateZoom(targetScale: number, duration: number = ZOOM_ANIMATION_DURATION): void {
        const container = document.getElementById('tree-container');
        if (!container) return;

        // Cancel any existing animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        const startScale = this.scale;
        const startTx = this.tx;
        const startTy = this.ty;
        const startTime = performance.now();

        // Get viewport center
        const centerX = container.clientWidth / 2;
        const centerY = container.clientHeight / 2;

        // Calculate the canvas point at viewport center
        const canvasX = (centerX - startTx) / startScale;
        const canvasY = (centerY - startTy) / startScale;

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);

            // Interpolate scale
            this.scale = startScale + (targetScale - startScale) * eased;

            // Keep viewport center pointing at the same canvas location
            this.tx = centerX - canvasX * this.scale;
            this.ty = centerY - canvasY * this.scale;

            this.apply();

            if (progress < 1) {
                this.animationFrame = requestAnimationFrame(animate);
            } else {
                this.animationFrame = null;
                this.endMotion();
            }
        };

        this.beginMotion();
        this.animationFrame = requestAnimationFrame(animate);
    }

    // ==================== PUBLIC CONTROLS ====================

    /**
     * True while a standalone view (timeline, fan, map) replaces the tree
     * canvas: zoom keys/buttons would only move the hidden canvas then.
     */
    private isStandaloneViewActive(): boolean {
        const canvas = document.getElementById('tree-canvas');
        return !!canvas && canvas.style.display === 'none';
    }

    zoomIn(): void {
        if (this.isStandaloneViewActive()) return;
        const targetScale = Math.min(MAX_SCALE, this.scale * ZOOM_BUTTON_FACTOR);
        this.animateZoom(targetScale);
    }

    zoomOut(): void {
        if (this.isStandaloneViewActive()) return;
        const wanted = this.scale / ZOOM_BUTTON_FACTOR;
        const targetScale = Math.max(this.zoomOutFloor(wanted), wanted);
        if (targetScale === this.scale) return;
        this.animateZoom(targetScale);
    }

    reset(): void {
        if (this.isStandaloneViewActive()) return;
        // A pending zoom animation would overwrite the reset on its next frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
            this.endMotion();
        }
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this.apply();

        // Center on focused person if available
        const renderer = getTreeRenderer();
        const focusedId = renderer?.getFocusPersonId();
        if (focusedId) {
            // Small delay to ensure DOM is updated
            setTimeout(() => this.centerOnPerson(focusedId), 0);
        }
    }

    /**
     * Center on focused person with context zoom (0.75x) - ideal for initial view
     * Shows the focused person plus surrounding family members
     */
    centerOnFocusWithContext(): void {
        const renderer = getTreeRenderer();
        const focusedId = renderer?.getFocusPersonId();
        if (focusedId) {
            this.scale = 0.75;
            this.tx = 0;
            this.ty = 0;
            this.apply();
            this.centerOnPerson(focusedId);
        } else {
            // Fallback to fit to screen if no focus person
            this.fitToScreen();
        }
    }

    /**
     * The scale and centre that show every card with a margin, or null when
     * nothing is rendered. The scale is not clamped.
     */
    private computeFit(): { scale: number; centerX: number; centerY: number } | null {
        const container = document.getElementById('tree-container');
        const canvas = document.getElementById('tree-canvas');
        if (!container || !canvas) return null;

        const cards = canvas.querySelectorAll('.person-card') as NodeListOf<HTMLElement>;
        if (cards.length === 0) return null;

        // Bounding box of all cards (canvas coordinates)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        cards.forEach(card => {
            const left = parseFloat(card.style.left) || 0;
            const top = parseFloat(card.style.top) || 0;
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, left + card.offsetWidth);
            maxY = Math.max(maxY, top + card.offsetHeight);
        });

        const treeWidth = maxX - minX + 2 * FIT_PADDING;
        const treeHeight = maxY - minY + 2 * FIT_PADDING;
        const scale = Math.min(container.clientWidth / treeWidth, container.clientHeight / treeHeight);
        if (!isFinite(scale) || scale <= 0) return null;
        return { scale, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
    }

    /**
     * The manual zoom floor: MIN_SCALE, or the fit scale of a tree too big to
     * fit at MIN_SCALE, so zooming out by hand reaches the fit-to-screen view.
     */
    private minScale(): number {
        const fit = this.computeFit();
        if (!fit) return MIN_SCALE;
        return Math.min(MIN_SCALE, Math.max(FIT_MIN_SCALE, fit.scale));
    }

    /**
     * Lowest scale a zoom-out step towards `wanted` may land on. The fit is
     * measured only when the step would go below MIN_SCALE. A view already
     * below the floor (the tree got narrower since) never jumps back in: the
     * floor is then the current scale.
     */
    private zoomOutFloor(wanted: number): number {
        if (wanted >= MIN_SCALE) return MIN_SCALE;
        return Math.min(this.minScale(), this.scale);
    }

    /**
     * Fit the entire tree to screen with optimal zoom level. A tree too wide
     * or tall for MIN_SCALE goes below it (down to FIT_MIN_SCALE), so all of
     * it is on screen (T04).
     */
    fitToScreen(): void {
        const container = document.getElementById('tree-container');
        const fit = this.computeFit();
        if (!container || !fit) return;

        // Don't zoom in too much if the tree is small
        this.scale = Math.max(FIT_MIN_SCALE, Math.min(FIT_MAX_SCALE, fit.scale));
        this.tx = container.clientWidth / 2 - fit.centerX * this.scale;
        this.ty = container.clientHeight / 2 - fit.centerY * this.scale;

        this.apply();
    }

    /**
     * Center the whole tree in the viewport WITHOUT changing the current zoom
     * level. Used by the descendants chart. The usable area starts below any
     * floating bar overlapping the top (the descendants badge); a chart
     * shorter than the viewport is centered in the remaining space instead of
     * being pinned under the bar.
     *
     * Horizontal framing:
     * - When the chart is NARROWER than the viewport it is centered on its
     *   content bounding box and clamped so no card is ever clipped.
     * - When the chart is WIDER than the viewport, centering the full bounding
     *   box would shove the top generation (the focus) off the left edge,
     *   because deep descendant rows sprawl far to the right and drag the box
     *   centre with them. Instead we anchor the LEFT edge of the top
     *   generation near the left margin so the focus is always the first thing
     *   read, then clamp so the content still fills the viewport (no empty
     *   gutter appears on either side).
     */
    centerTreeTopKeepScale(): void {
        const container = document.getElementById('tree-container');
        const canvas = document.getElementById('tree-canvas');
        if (!container || !canvas) return;

        const cards = canvas.querySelectorAll('.person-card') as NodeListOf<HTMLElement>;
        if (cards.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        cards.forEach(card => {
            const left = parseFloat(card.style.left) || 0;
            const top = parseFloat(card.style.top) || 0;
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, left + card.offsetWidth);
            maxY = Math.max(maxY, top + card.offsetHeight);
        });

        // Left edge of the top generation (the focus row): cards sharing the
        // topmost Y band. Used as the horizontal anchor for wide charts.
        const TOP_BAND_TOL = 2;
        let topMinX = Infinity;
        cards.forEach(card => {
            const top = parseFloat(card.style.top) || 0;
            if (top <= minY + TOP_BAND_TOL) {
                topMinX = Math.min(topMinX, parseFloat(card.style.left) || 0);
            }
        });
        if (!isFinite(topMinX)) topMinX = minX;

        const containerRect = container.getBoundingClientRect();
        const MARGIN = 16;
        let topLimit = MARGIN;
        const badge = document.getElementById('descendants-badge');
        if (badge) {
            const br = badge.getBoundingClientRect();
            if (br.height > 0) topLimit = Math.max(topLimit, br.bottom - containerRect.top + 12);
        }

        const treeH = (maxY - minY) * this.scale;
        const availH = container.clientHeight - topLimit - MARGIN;
        const top = treeH < availH ? topLimit + (availH - treeH) / 2 : topLimit;

        const viewW = container.clientWidth;
        const scaledW = (maxX - minX) * this.scale;
        const availW = viewW - 2 * MARGIN;

        let tx: number;
        if (scaledW <= availW) {
            // Fits: centre the content box, then clamp as a safety net so no
            // card ever pokes past the left/right margin.
            tx = viewW / 2 - ((minX + maxX) / 2) * this.scale;
            const leftScreen = minX * this.scale + tx;
            if (leftScreen < MARGIN) tx += MARGIN - leftScreen;
            const rightScreen = maxX * this.scale + tx;
            if (rightScreen > viewW - MARGIN) tx -= rightScreen - (viewW - MARGIN);
        } else {
            // Wider than the viewport: anchor the top generation's left edge at
            // the margin, then clamp into the valid pan range so the content
            // keeps filling the viewport (no empty gutter on either side).
            tx = MARGIN - topMinX * this.scale;
            const minTx = (viewW - MARGIN) - maxX * this.scale; // right edge at right margin
            const maxTx = MARGIN - minX * this.scale;           // left edge at left margin
            tx = Math.min(Math.max(tx, minTx), maxTx);
        }

        this.tx = tx;
        this.ty = top - minY * this.scale;
        this.apply();
    }

    /**
     * Center the view on a specific person card
     */
    /**
     * Animate BOTH pan and zoom so a person ends up centred at `targetScale`.
     * The slideshow's building block: centerOnPerson jumps, this glides.
     * Returns false when the card isn't rendered (nothing to fly to).
     */
    flyToPerson(personId: PersonId, targetScale: number, duration = 1600): boolean {
        const container = document.getElementById('tree-container');
        const card = document.querySelector(`.person-card[data-id="${personId}"]`) as HTMLElement | null;
        if (!container || !card) return false;

        const cardCenterX = (parseFloat(card.style.left) || 0) + card.offsetWidth / 2;
        const cardCenterY = (parseFloat(card.style.top) || 0) + card.offsetHeight / 2;
        const endScale = Math.max(Math.min(MIN_SCALE, this.scale), Math.min(MAX_SCALE, targetScale));
        const endTx = container.clientWidth / 2 - cardCenterX * endScale;
        const endTy = container.clientHeight / 2 - cardCenterY * endScale;

        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        const startScale = this.scale, startTx = this.tx, startTy = this.ty;
        const startTime = performance.now();

        const animate = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1);
            // Ease in-out: a gentle glide reads better on a TV than a snap.
            const eased = progress < 0.5
                ? 4 * progress ** 3
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            this.scale = startScale + (endScale - startScale) * eased;
            this.tx = startTx + (endTx - startTx) * eased;
            this.ty = startTy + (endTy - startTy) * eased;
            this.apply();
            this.animationFrame = progress < 1 ? requestAnimationFrame(animate) : null;
            if (this.animationFrame === null) this.endMotion();
        };
        this.beginMotion();
        this.animationFrame = requestAnimationFrame(animate);
        return true;
    }

    /**
     * Glide to centre a person (ease-out), optionally at another scale;
     * reduced motion: jump. Returns false when the card isn't rendered.
     */
    glideToPerson(personId: PersonId, targetScale = this.scale, duration = 300): boolean {
        const container = document.getElementById('tree-container');
        const card = document.querySelector(`.person-card[data-id="${CSS.escape(personId)}"]`) as HTMLElement | null;
        if (!container || !card) return false;
        const cx = (parseFloat(card.style.left) || 0) + card.offsetWidth / 2;
        const cy = (parseFloat(card.style.top) || 0) + card.offsetHeight / 2;
        // A view fitted below MIN_SCALE keeps its scale (no jump in).
        const endScale = Math.max(Math.min(MIN_SCALE, this.scale), Math.min(MAX_SCALE, targetScale));
        const endTx = container.clientWidth / 2 - cx * endScale;
        const endTy = container.clientHeight / 2 - cy * endScale;
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || duration <= 0) {
            this.scale = endScale;
            this.tx = endTx;
            this.ty = endTy;
            this.apply();
            this.endMotion();
            return true;
        }
        const startScale = this.scale, startTx = this.tx, startTy = this.ty;
        const startTime = performance.now();
        const step = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            this.scale = startScale + (endScale - startScale) * eased;
            this.tx = startTx + (endTx - startTx) * eased;
            this.ty = startTy + (endTy - startTy) * eased;
            this.apply();
            this.animationFrame = progress < 1 ? requestAnimationFrame(step) : null;
            if (this.animationFrame === null) this.endMotion();
        };
        this.beginMotion();
        this.animationFrame = requestAnimationFrame(step);
        return true;
    }

    centerOnPerson(personId: PersonId): void {
        const container = document.getElementById('tree-container');
        const card = document.querySelector(`.person-card[data-id="${personId}"]`) as HTMLElement;
        if (!container || !card) return;

        // Get card position (these are in canvas coordinates)
        const cardLeft = parseFloat(card.style.left) || 0;
        const cardTop = parseFloat(card.style.top) || 0;
        const cardWidth = card.offsetWidth;
        const cardHeight = card.offsetHeight;

        // Calculate center of the card in canvas coordinates
        const cardCenterX = cardLeft + cardWidth / 2;
        const cardCenterY = cardTop + cardHeight / 2;

        // Get container dimensions
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // Calculate translation to center the card
        // We want: cardCenter * scale + tx = containerCenter
        // So: tx = containerCenter - cardCenter * scale
        this.tx = containerWidth / 2 - cardCenterX * this.scale;
        this.ty = containerHeight / 2 - cardCenterY * this.scale;

        this.apply();
    }

    /**
     * Temporarily highlight a person card
     */
    highlightPerson(personId: PersonId, duration: number = 2000): void {
        const card = document.querySelector(`.person-card[data-id="${personId}"]`) as HTMLElement;
        if (!card) return;

        card.classList.add('highlighted');
        setTimeout(() => {
            card.classList.remove('highlighted');
        }, duration);
    }

    /**
     * Get current scale (for UI display)
     */
    getScale(): number {
        return this.scale;
    }

    /** Current transform (world→container: containerPt = worldPt * scale + t). */
    getTransform(): { scale: number; tx: number; ty: number } {
        return { scale: this.scale, tx: this.tx, ty: this.ty };
    }

    /** Size of the pannable viewport (the tree container), in CSS pixels. */
    getViewportSize(): { width: number; height: number } {
        const container = document.getElementById('tree-container');
        if (!container) return { width: 0, height: 0 };
        const rect = container.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    }

    /** Register a listener fired after every transform change. */
    onChange(cb: () => void): void {
        this.changeListeners.push(cb);
    }

    /** Center the viewport on a world-space point, keeping the current scale. */
    centerOnWorldPoint(worldX: number, worldY: number): void {
        const { width, height } = this.getViewportSize();
        this.tx = width / 2 - worldX * this.scale;
        this.ty = height / 2 - worldY * this.scale;
        this.apply();
    }

    private apply(): void {
        const canvas = document.getElementById('tree-canvas');
        if (canvas) {
            // Whole-pixel pan: a fractional translate puts every card between
            // device pixels and blurs its text and borders.
            canvas.style.transform = `translate(${Math.round(this.tx)}px, ${Math.round(this.ty)}px) scale(${this.scale})`;
            // Far out the card badges turn into dots that keep a readable size.
            canvas.classList.toggle('zoom-far', this.scale < ZOOM_FAR);
            // The research edge: a stretch of the top edge far out, its words from 100 %.
            canvas.classList.toggle('zoom-edge-bar', this.scale < ZOOM_EDGE_BAR);
            canvas.classList.toggle('zoom-edge-labels', this.scale >= ZOOM_EDGE_LABELS);
            canvas.style.setProperty('--zoom-inv', String(1 / Math.max(this.scale, 0.05)));
            // Fonts scale naturally with CSS transform - no counter-scaling needed
        }
        for (const cb of this.changeListeners) cb();
    }
}

export const ZoomPan = new ZoomPanClass();
