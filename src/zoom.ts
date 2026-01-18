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
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const ZOOM_BUTTON_FACTOR = 1.3;
const ZOOM_ANIMATION_DURATION = 200; // ms

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
        this.tx = e.clientX - this.dragStartX;
        this.ty = e.clientY - this.dragStartY;
        this.apply();
    }

    private onMouseUp(): void {
        this.dragging = false;
    }

    private onWheel(e: WheelEvent): void {
        e.preventDefault();

        const container = document.getElementById('tree-container');
        if (!container) return;

        // Get mouse position relative to container
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate zoom factor
        const delta = e.deltaY > 0 ? 0.9 : 1.1;

        // Zoom toward mouse position
        this.zoomToPoint(mouseX, mouseY, delta);
    }

    // ==================== TOUCH EVENTS ====================

    private onTouchStart(e: TouchEvent): void {
        const target = e.target as HTMLElement;

        // Allow default behavior on person cards (for click/tap to work)
        if (target.closest('.person-card') || target.closest('.context-menu')) {
            // Don't interfere with person card interactions
            return;
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
        }
    }

    private onTouchMove(e: TouchEvent): void {
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
    }

    // ==================== HELPER METHODS ====================

    private isInteractiveElement(target: HTMLElement): boolean {
        return !!(
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
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * scaleFactor));

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
            }
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    // ==================== PUBLIC CONTROLS ====================

    zoomIn(): void {
        const targetScale = Math.min(MAX_SCALE, this.scale * ZOOM_BUTTON_FACTOR);
        this.animateZoom(targetScale);
    }

    zoomOut(): void {
        const targetScale = Math.max(MIN_SCALE, this.scale / ZOOM_BUTTON_FACTOR);
        this.animateZoom(targetScale);
    }

    reset(): void {
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
     * Fit the entire tree to screen with optimal zoom level
     */
    fitToScreen(): void {
        const container = document.getElementById('tree-container');
        const canvas = document.getElementById('tree-canvas');
        if (!container || !canvas) return;

        // Get all person cards
        const cards = canvas.querySelectorAll('.person-card') as NodeListOf<HTMLElement>;
        if (cards.length === 0) return;

        // Calculate bounding box of all cards
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        cards.forEach(card => {
            const left = parseFloat(card.style.left) || 0;
            const top = parseFloat(card.style.top) || 0;
            const width = card.offsetWidth;
            const height = card.offsetHeight;

            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, left + width);
            maxY = Math.max(maxY, top + height);
        });

        // Add padding around the tree
        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        // Calculate tree dimensions
        const treeWidth = maxX - minX;
        const treeHeight = maxY - minY;

        // Get container dimensions
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // Calculate scale to fit tree in container
        const scaleX = containerWidth / treeWidth;
        const scaleY = containerHeight / treeHeight;
        let newScale = Math.min(scaleX, scaleY);

        // Clamp scale to reasonable bounds (don't zoom in too much if tree is small)
        newScale = Math.max(MIN_SCALE, Math.min(1.5, newScale));

        // Calculate center of tree
        const treeCenterX = (minX + maxX) / 2;
        const treeCenterY = (minY + maxY) / 2;

        // Calculate translation to center the tree
        this.scale = newScale;
        this.tx = containerWidth / 2 - treeCenterX * this.scale;
        this.ty = containerHeight / 2 - treeCenterY * this.scale;

        this.apply();
    }

    /**
     * Center the view on a specific person card
     */
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

    private apply(): void {
        const canvas = document.getElementById('tree-canvas');
        if (canvas) {
            canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
            // Fonts scale naturally with CSS transform - no counter-scaling needed
        }
    }
}

export const ZoomPan = new ZoomPanClass();
