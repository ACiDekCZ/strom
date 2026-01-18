/**
 * TreePreview - Read-only tree preview component
 * Reusable component for displaying a focused tree view in an overlay
 */

import { PersonId, StromData, LayoutConfig, DEFAULT_LAYOUT_CONFIG } from './types.js';
import { computeLayout, LayoutResult, StromLayoutEngine, SelectionPolicy, Connection, SpouseLine } from './layout/index.js';
import { strings } from './strings.js';

// ==================== TYPES ====================

export interface TreePreviewOptions {
    /** The tree data to display */
    data: StromData;
    /** Person to focus on */
    focusPersonId: PersonId;
    /** Depth of ancestors to show (default: 2) */
    depthUp?: number;
    /** Depth of descendants to show (default: 2) */
    depthDown?: number;
    /** Title to display (optional) */
    title?: string;
    /** Subtitle/source info (optional) */
    subtitle?: string;
    /** Callback when preview is closed */
    onClose?: () => void;
    /** Callback when a person is clicked (for external handling) */
    onPersonClick?: (personId: PersonId) => void;
}

/** Options for comparison view (two trees side by side) */
export interface TreeCompareOptions {
    /** Left pane options */
    left: TreePreviewOptions;
    /** Right pane options */
    right: TreePreviewOptions;
    /** Callback when comparison is closed */
    onClose?: () => void;
}

interface PreviewZoomState {
    scale: number;
    tx: number;
    ty: number;
    dragging: boolean;
    dragStartX: number;
    dragStartY: number;
    touchState: TouchState | null;
    lastPinchDistance: number;
}

interface TouchState {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    isPanning: boolean;
}

// ==================== CONSTANTS ====================

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const TAP_THRESHOLD_PX = 10;

// ==================== TREE PREVIEW CLASS ====================

class TreePreviewClass {
    private overlay: HTMLElement | null = null;
    private canvas: HTMLElement | null = null;
    private options: TreePreviewOptions | null = null;
    private zoomState: PreviewZoomState = this.createInitialZoomState();
    private positions: Map<PersonId, { x: number; y: number }> = new Map();
    private currentFocusId: PersonId | null = null;

    private createInitialZoomState(): PreviewZoomState {
        return {
            scale: 0.7,
            tx: 0,
            ty: 0,
            dragging: false,
            dragStartX: 0,
            dragStartY: 0,
            touchState: null,
            lastPinchDistance: 0
        };
    }

    /**
     * Show tree preview overlay
     */
    show(options: TreePreviewOptions): void {
        this.options = options;
        this.currentFocusId = options.focusPersonId;
        this.zoomState = this.createInitialZoomState();

        this.createOverlay();
        this.render();
        this.centerOnFocus();
    }

    /**
     * Close the preview overlay
     */
    close(): void {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
            this.canvas = null;
        }
        if (this.options?.onClose) {
            this.options.onClose();
        }
        this.options = null;
        this.currentFocusId = null;
    }

    /**
     * Check if preview is currently open
     */
    isOpen(): boolean {
        return this.overlay !== null;
    }

    // ==================== OVERLAY CREATION ====================

    private createOverlay(): void {
        // Remove existing overlay if any
        if (this.overlay) {
            this.overlay.remove();
        }

        const s = strings.treePreview;
        const overlay = document.createElement('div');
        overlay.className = 'tree-preview-overlay';
        overlay.innerHTML = `
            <div class="tree-preview-header">
                <div class="tree-preview-info">
                    <div class="tree-preview-title">${this.options?.title || s?.title || 'Tree Preview'}</div>
                    ${this.options?.subtitle ? `<div class="tree-preview-subtitle">${this.options.subtitle}</div>` : ''}
                </div>
                <button class="tree-preview-close" title="${s?.close || 'Close'}">×</button>
            </div>
            <div class="tree-preview-container">
                <div class="tree-preview-canvas"></div>
                <svg class="tree-preview-lines"></svg>
            </div>
            <div class="tree-preview-footer">
                <div class="tree-preview-focus-info">
                    <span class="tree-preview-focus-label">${s?.focusedOn || 'Focused on'}:</span>
                    <span class="tree-preview-focus-name"></span>
                </div>
                <div class="tree-preview-zoom-controls">
                    <button class="tree-preview-zoom-btn" data-action="out">−</button>
                    <button class="tree-preview-zoom-btn" data-action="in">+</button>
                </div>
            </div>
        `;

        // Event listeners
        const closeBtn = overlay.querySelector('.tree-preview-close') as HTMLElement;
        closeBtn.addEventListener('click', () => this.close());

        // Click outside to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.close();
            }
        });

        // Escape key to close - use capture to intercept before other handlers
        const escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isOpen()) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.close();
                document.removeEventListener('keydown', escHandler, true);
            }
        };
        document.addEventListener('keydown', escHandler, true);

        // Zoom controls
        overlay.querySelectorAll('.tree-preview-zoom-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = (btn as HTMLElement).dataset.action;
                if (action === 'in') this.zoomIn();
                if (action === 'out') this.zoomOut();
            });
        });

        // Set up pan/zoom on container
        const container = overlay.querySelector('.tree-preview-container') as HTMLElement;
        this.setupPanZoom(container);

        document.body.appendChild(overlay);
        this.overlay = overlay;
        this.canvas = overlay.querySelector('.tree-preview-canvas') as HTMLElement;
    }

    // ==================== RENDERING ====================

    private render(): void {
        if (!this.canvas || !this.options || !this.currentFocusId) return;

        const { data } = this.options;
        const depthUp = this.options.depthUp ?? 2;
        const depthDown = this.options.depthDown ?? 2;

        // Clear previous content
        this.canvas.innerHTML = '';
        const svg = this.overlay?.querySelector('.tree-preview-lines') as SVGElement;
        if (svg) svg.innerHTML = '';

        // Layout config
        const config: LayoutConfig = {
            ...DEFAULT_LAYOUT_CONFIG,
            cardWidth: 120,
            cardHeight: 60,
            horizontalGap: 20,
            verticalGap: 80
        };

        // Selection policy
        const policy: SelectionPolicy = {
            ancestorDepth: depthUp,
            descendantDepth: depthDown,
            includeAuntsUncles: false,
            includeCousins: false
        };

        // Compute layout
        const engine = new StromLayoutEngine();
        const layout = computeLayout(engine, {
            data,
            focusPersonId: this.currentFocusId,
            policy,
            config
        });

        this.positions = layout.positions;

        // Render connections (lines)
        this.renderConnections(layout, svg, config);

        // Render person cards
        this.renderPersonCards(layout, data, config);

        // Update focus info
        this.updateFocusInfo();
    }

    private renderConnections(layout: LayoutResult, svg: SVGElement, config: LayoutConfig): void {
        if (!svg) return;

        // Render spouse lines
        for (const spouseLine of layout.spouseLines) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(spouseLine.xMin));
            line.setAttribute('y1', String(spouseLine.y));
            line.setAttribute('x2', String(spouseLine.xMax));
            line.setAttribute('y2', String(spouseLine.y));
            line.setAttribute('class', 'tree-preview-line couple');
            svg.appendChild(line);
        }

        // Render parent-child connections
        for (const conn of layout.connections) {
            // Stem (vertical from union to connector)
            const stem = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            stem.setAttribute('x1', String(conn.stemX));
            stem.setAttribute('y1', String(conn.stemTopY));
            stem.setAttribute('x2', String(conn.stemX));
            stem.setAttribute('y2', String(conn.stemBottomY));
            stem.setAttribute('class', 'tree-preview-line parent-child');
            svg.appendChild(stem);

            // Horizontal connector (if needed)
            if (conn.connectorFromX !== conn.connectorToX) {
                const connector = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                connector.setAttribute('x1', String(conn.connectorFromX));
                connector.setAttribute('y1', String(conn.connectorY));
                connector.setAttribute('x2', String(conn.connectorToX));
                connector.setAttribute('y2', String(conn.connectorY));
                connector.setAttribute('class', 'tree-preview-line parent-child');
                svg.appendChild(connector);
            }

            // Branch (horizontal bus over children)
            const branch = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            branch.setAttribute('x1', String(conn.branchLeftX));
            branch.setAttribute('y1', String(conn.branchY));
            branch.setAttribute('x2', String(conn.branchRightX));
            branch.setAttribute('y2', String(conn.branchY));
            branch.setAttribute('class', 'tree-preview-line parent-child');
            svg.appendChild(branch);

            // Drops to children
            for (const drop of conn.drops) {
                const dropLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                dropLine.setAttribute('x1', String(drop.x));
                dropLine.setAttribute('y1', String(conn.branchY));
                dropLine.setAttribute('x2', String(drop.x));
                dropLine.setAttribute('y2', String(drop.bottomY));
                dropLine.setAttribute('class', 'tree-preview-line parent-child');
                svg.appendChild(dropLine);
            }
        }
    }

    private renderPersonCards(layout: LayoutResult, data: StromData, config: LayoutConfig): void {
        if (!this.canvas) return;

        for (const [personId, pos] of layout.positions) {
            const person = data.persons[personId];
            if (!person) continue;

            const card = document.createElement('div');
            let classes = 'tree-preview-card';
            if (person.isPlaceholder) {
                classes += ' placeholder';
            } else {
                classes += ' ' + person.gender;
            }
            if (personId === this.currentFocusId) {
                classes += ' focused';
            }

            card.className = classes;
            card.style.left = pos.x + 'px';
            card.style.top = pos.y + 'px';
            card.style.width = config.cardWidth + 'px';
            card.style.height = config.cardHeight + 'px';
            card.dataset.id = personId;

            // Card content
            const displayName = person.firstName || '?';
            const displaySurname = person.lastName || '';

            let birthYear = '';
            if (person.birthDate) {
                birthYear = person.birthDate.split('-')[0];
            }

            card.innerHTML = `
                <div class="preview-card-name">${displayName}</div>
                <div class="preview-card-surname">${displaySurname}</div>
                ${birthYear ? `<div class="preview-card-year">${birthYear}</div>` : ''}
            `;

            // Click handler - refocus on this person or call external handler
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.options?.onPersonClick) {
                    this.options.onPersonClick(personId);
                } else {
                    // Default: refocus on clicked person
                    this.refocusOn(personId);
                }
            });

            this.canvas.appendChild(card);
        }
    }

    private updateFocusInfo(): void {
        if (!this.overlay || !this.options || !this.currentFocusId) return;

        const person = this.options.data.persons[this.currentFocusId];
        const nameEl = this.overlay.querySelector('.tree-preview-focus-name');
        if (nameEl && person) {
            nameEl.textContent = `${person.firstName || '?'} ${person.lastName || ''}`.trim();
        }
    }

    /**
     * Refocus the preview on a different person
     */
    refocusOn(personId: PersonId): void {
        if (!this.options) return;

        // Check if person exists in data
        if (!this.options.data.persons[personId]) return;

        this.currentFocusId = personId;
        this.render();
        this.centerOnFocus();
    }

    // ==================== PAN/ZOOM ====================

    private setupPanZoom(container: HTMLElement): void {
        // Mouse events
        container.addEventListener('mousedown', (e) => this.onMouseDown(e));
        container.addEventListener('mousemove', (e) => this.onMouseMove(e));
        container.addEventListener('mouseup', () => this.onMouseUp());
        container.addEventListener('mouseleave', () => this.onMouseUp());
        container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // Touch events
        container.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        container.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        container.addEventListener('touchend', () => this.onTouchEnd());
        container.addEventListener('touchcancel', () => this.onTouchEnd());
    }

    private onMouseDown(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        if (target.closest('.tree-preview-card')) return;

        this.zoomState.dragging = true;
        this.zoomState.dragStartX = e.clientX - this.zoomState.tx;
        this.zoomState.dragStartY = e.clientY - this.zoomState.ty;
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.zoomState.dragging) return;
        this.zoomState.tx = e.clientX - this.zoomState.dragStartX;
        this.zoomState.ty = e.clientY - this.zoomState.dragStartY;
        this.applyTransform();
    }

    private onMouseUp(): void {
        this.zoomState.dragging = false;
    }

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        const container = this.overlay?.querySelector('.tree-preview-container') as HTMLElement;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoomToPoint(mouseX, mouseY, delta);
    }

    private onTouchStart(e: TouchEvent): void {
        const target = e.target as HTMLElement;
        if (target.closest('.tree-preview-card')) return;

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.zoomState.touchState = {
                startX: touch.clientX,
                startY: touch.clientY,
                lastX: touch.clientX,
                lastY: touch.clientY,
                isPanning: false
            };
        } else if (e.touches.length === 2) {
            e.preventDefault();
            this.zoomState.touchState = null;
            this.zoomState.lastPinchDistance = this.getTouchDistance(e.touches);
        }
    }

    private onTouchMove(e: TouchEvent): void {
        if (e.touches.length === 1 && this.zoomState.touchState) {
            const touch = e.touches[0];
            const dx = touch.clientX - this.zoomState.touchState.startX;
            const dy = touch.clientY - this.zoomState.touchState.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > TAP_THRESHOLD_PX) {
                this.zoomState.touchState.isPanning = true;
            }

            if (this.zoomState.touchState.isPanning) {
                e.preventDefault();
                const moveX = touch.clientX - this.zoomState.touchState.lastX;
                const moveY = touch.clientY - this.zoomState.touchState.lastY;

                this.zoomState.tx += moveX;
                this.zoomState.ty += moveY;
                this.applyTransform();

                this.zoomState.touchState.lastX = touch.clientX;
                this.zoomState.touchState.lastY = touch.clientY;
            }
        } else if (e.touches.length === 2) {
            e.preventDefault();
            const newDistance = this.getTouchDistance(e.touches);
            const container = this.overlay?.querySelector('.tree-preview-container') as HTMLElement;

            if (this.zoomState.lastPinchDistance > 0 && container) {
                const scaleFactor = newDistance / this.zoomState.lastPinchDistance;
                const rect = container.getBoundingClientRect();
                const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
                const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

                this.zoomToPoint(centerX, centerY, scaleFactor);
            }

            this.zoomState.lastPinchDistance = newDistance;
        }
    }

    private onTouchEnd(): void {
        this.zoomState.touchState = null;
        this.zoomState.lastPinchDistance = 0;
    }

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private zoomToPoint(pointX: number, pointY: number, scaleFactor: number): void {
        const oldScale = this.zoomState.scale;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * scaleFactor));

        if (newScale === oldScale) return;

        const canvasX = (pointX - this.zoomState.tx) / oldScale;
        const canvasY = (pointY - this.zoomState.ty) / oldScale;

        this.zoomState.scale = newScale;
        this.zoomState.tx = pointX - canvasX * newScale;
        this.zoomState.ty = pointY - canvasY * newScale;

        this.applyTransform();
    }

    private zoomIn(): void {
        const container = this.overlay?.querySelector('.tree-preview-container') as HTMLElement;
        if (!container) return;

        const centerX = container.clientWidth / 2;
        const centerY = container.clientHeight / 2;
        this.zoomToPoint(centerX, centerY, 1.3);
    }

    private zoomOut(): void {
        const container = this.overlay?.querySelector('.tree-preview-container') as HTMLElement;
        if (!container) return;

        const centerX = container.clientWidth / 2;
        const centerY = container.clientHeight / 2;
        this.zoomToPoint(centerX, centerY, 1 / 1.3);
    }

    private centerOnFocus(): void {
        if (!this.currentFocusId || !this.overlay) return;

        const pos = this.positions.get(this.currentFocusId);
        if (!pos) return;

        const container = this.overlay.querySelector('.tree-preview-container') as HTMLElement;
        if (!container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // Center the focused card
        const cardCenterX = pos.x + 60; // half card width
        const cardCenterY = pos.y + 30; // half card height

        this.zoomState.tx = containerWidth / 2 - cardCenterX * this.zoomState.scale;
        this.zoomState.ty = containerHeight / 2 - cardCenterY * this.zoomState.scale;

        this.applyTransform();
    }

    private applyTransform(): void {
        if (!this.canvas) return;

        const svg = this.overlay?.querySelector('.tree-preview-lines') as SVGElement;
        const transform = `translate(${this.zoomState.tx}px, ${this.zoomState.ty}px) scale(${this.zoomState.scale})`;

        this.canvas.style.transform = transform;
        if (svg) {
            svg.style.transform = transform;
        }
    }
}

// ==================== COMPARISON VIEW ====================

interface PaneState {
    canvas: HTMLElement;
    svg: SVGElement;
    options: TreePreviewOptions;
    positions: Map<PersonId, { x: number; y: number }>;
    currentFocusId: PersonId;
    zoomState: PreviewZoomState;
}

class TreeCompareClass {
    private overlay: HTMLElement | null = null;
    private leftPane: PaneState | null = null;
    private rightPane: PaneState | null = null;
    private compareOptions: TreeCompareOptions | null = null;

    /**
     * Show comparison view with two trees side by side
     */
    showComparison(options: TreeCompareOptions): void {
        this.compareOptions = options;
        this.createCompareOverlay();
        this.initializePane('left', options.left);
        this.initializePane('right', options.right);
    }

    /**
     * Close the comparison overlay
     */
    close(): void {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        if (this.compareOptions?.onClose) {
            this.compareOptions.onClose();
        }
        this.leftPane = null;
        this.rightPane = null;
        this.compareOptions = null;
    }

    /**
     * Check if comparison is currently open
     */
    isOpen(): boolean {
        return this.overlay !== null;
    }

    private createCompareOverlay(): void {
        if (this.overlay) {
            this.overlay.remove();
        }

        const s = strings.treePreview;
        const leftTitle = this.compareOptions?.left.title || s?.title || 'Tree Preview';
        const rightTitle = this.compareOptions?.right.title || s?.title || 'Tree Preview';

        const overlay = document.createElement('div');
        overlay.className = 'tree-compare-overlay';
        overlay.innerHTML = `
            <div class="tree-compare-header">
                <div class="tree-compare-title">${s?.compare || 'Compare Trees'}</div>
                <button class="tree-preview-close" title="${s?.close || 'Close'}">×</button>
            </div>
            <div class="tree-compare-content">
                <div class="tree-compare-pane" data-pane="left">
                    <div class="tree-compare-pane-header">
                        <span class="pane-title">${leftTitle}</span>
                        ${this.compareOptions?.left.subtitle ? `<span class="pane-subtitle">${this.compareOptions.left.subtitle}</span>` : ''}
                    </div>
                    <div class="tree-compare-pane-container">
                        <div class="tree-preview-canvas"></div>
                        <svg class="tree-preview-lines"></svg>
                    </div>
                    <div class="tree-compare-pane-footer">
                        <span class="tree-preview-focus-name"></span>
                        <div class="tree-preview-zoom-controls">
                            <button class="tree-preview-zoom-btn" data-action="out">−</button>
                            <button class="tree-preview-zoom-btn" data-action="in">+</button>
                        </div>
                    </div>
                </div>
                <div class="tree-compare-divider"></div>
                <div class="tree-compare-pane" data-pane="right">
                    <div class="tree-compare-pane-header">
                        <span class="pane-title">${rightTitle}</span>
                        ${this.compareOptions?.right.subtitle ? `<span class="pane-subtitle">${this.compareOptions.right.subtitle}</span>` : ''}
                    </div>
                    <div class="tree-compare-pane-container">
                        <div class="tree-preview-canvas"></div>
                        <svg class="tree-preview-lines"></svg>
                    </div>
                    <div class="tree-compare-pane-footer">
                        <span class="tree-preview-focus-name"></span>
                        <div class="tree-preview-zoom-controls">
                            <button class="tree-preview-zoom-btn" data-action="out">−</button>
                            <button class="tree-preview-zoom-btn" data-action="in">+</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Event listeners
        const closeBtn = overlay.querySelector('.tree-preview-close') as HTMLElement;
        closeBtn.addEventListener('click', () => this.close());

        // Escape key to close - use capture to intercept before other handlers
        const escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isOpen()) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.close();
                document.removeEventListener('keydown', escHandler, true);
            }
        };
        document.addEventListener('keydown', escHandler, true);

        // Zoom controls for each pane
        overlay.querySelectorAll('.tree-compare-pane').forEach(paneEl => {
            const paneName = (paneEl as HTMLElement).dataset.pane as 'left' | 'right';
            paneEl.querySelectorAll('.tree-preview-zoom-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = (btn as HTMLElement).dataset.action;
                    if (action === 'in') this.zoomPane(paneName, 1.3);
                    if (action === 'out') this.zoomPane(paneName, 1 / 1.3);
                });
            });
        });

        document.body.appendChild(overlay);
        this.overlay = overlay;
    }

    private initializePane(paneName: 'left' | 'right', options: TreePreviewOptions): void {
        const paneEl = this.overlay?.querySelector(`.tree-compare-pane[data-pane="${paneName}"]`);
        if (!paneEl) return;

        const canvas = paneEl.querySelector('.tree-preview-canvas') as HTMLElement;
        const svg = paneEl.querySelector('.tree-preview-lines') as SVGElement;
        const container = paneEl.querySelector('.tree-compare-pane-container') as HTMLElement;

        const paneState: PaneState = {
            canvas,
            svg,
            options,
            positions: new Map(),
            currentFocusId: options.focusPersonId,
            zoomState: {
                scale: 0.6,
                tx: 0,
                ty: 0,
                dragging: false,
                dragStartX: 0,
                dragStartY: 0,
                touchState: null,
                lastPinchDistance: 0
            }
        };

        if (paneName === 'left') {
            this.leftPane = paneState;
        } else {
            this.rightPane = paneState;
        }

        // Setup pan/zoom
        this.setupPanePanZoom(container, paneName);

        // Render
        this.renderPane(paneName);
        this.centerPane(paneName);
    }

    private renderPane(paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane) return;

        const { canvas, svg, options, currentFocusId } = pane;
        const depthUp = options.depthUp ?? 2;
        const depthDown = options.depthDown ?? 2;

        // Clear
        canvas.innerHTML = '';
        svg.innerHTML = '';

        // Layout config
        const config: LayoutConfig = {
            ...DEFAULT_LAYOUT_CONFIG,
            cardWidth: 110,
            cardHeight: 55,
            horizontalGap: 15,
            verticalGap: 70
        };

        const policy: SelectionPolicy = {
            ancestorDepth: depthUp,
            descendantDepth: depthDown,
            includeAuntsUncles: false,
            includeCousins: false
        };

        const engine = new StromLayoutEngine();
        const layout = computeLayout(engine, {
            data: options.data,
            focusPersonId: currentFocusId,
            policy,
            config
        });

        pane.positions = layout.positions;

        // Render connections
        this.renderPaneConnections(pane, layout, svg);

        // Render cards
        this.renderPaneCards(pane, layout, options.data, config, paneName);

        // Update focus info
        this.updatePaneFocusInfo(paneName);
    }

    private renderPaneConnections(pane: PaneState, layout: LayoutResult, svg: SVGElement): void {
        // Spouse lines
        for (const spouseLine of layout.spouseLines) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(spouseLine.xMin));
            line.setAttribute('y1', String(spouseLine.y));
            line.setAttribute('x2', String(spouseLine.xMax));
            line.setAttribute('y2', String(spouseLine.y));
            line.setAttribute('class', 'tree-preview-line couple');
            svg.appendChild(line);
        }

        // Parent-child connections
        for (const conn of layout.connections) {
            const stem = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            stem.setAttribute('x1', String(conn.stemX));
            stem.setAttribute('y1', String(conn.stemTopY));
            stem.setAttribute('x2', String(conn.stemX));
            stem.setAttribute('y2', String(conn.stemBottomY));
            stem.setAttribute('class', 'tree-preview-line parent-child');
            svg.appendChild(stem);

            if (conn.connectorFromX !== conn.connectorToX) {
                const connector = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                connector.setAttribute('x1', String(conn.connectorFromX));
                connector.setAttribute('y1', String(conn.connectorY));
                connector.setAttribute('x2', String(conn.connectorToX));
                connector.setAttribute('y2', String(conn.connectorY));
                connector.setAttribute('class', 'tree-preview-line parent-child');
                svg.appendChild(connector);
            }

            const branch = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            branch.setAttribute('x1', String(conn.branchLeftX));
            branch.setAttribute('y1', String(conn.branchY));
            branch.setAttribute('x2', String(conn.branchRightX));
            branch.setAttribute('y2', String(conn.branchY));
            branch.setAttribute('class', 'tree-preview-line parent-child');
            svg.appendChild(branch);

            for (const drop of conn.drops) {
                const dropLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                dropLine.setAttribute('x1', String(drop.x));
                dropLine.setAttribute('y1', String(conn.branchY));
                dropLine.setAttribute('x2', String(drop.x));
                dropLine.setAttribute('y2', String(drop.bottomY));
                dropLine.setAttribute('class', 'tree-preview-line parent-child');
                svg.appendChild(dropLine);
            }
        }
    }

    private renderPaneCards(pane: PaneState, layout: LayoutResult, data: StromData, config: LayoutConfig, paneName: 'left' | 'right'): void {
        const { canvas, currentFocusId } = pane;

        for (const [personId, pos] of layout.positions) {
            const person = data.persons[personId];
            if (!person) continue;

            const card = document.createElement('div');
            let classes = 'tree-preview-card compact';
            if (person.isPlaceholder) {
                classes += ' placeholder';
            } else {
                classes += ' ' + person.gender;
            }
            if (personId === currentFocusId) {
                classes += ' focused';
            }

            card.className = classes;
            card.style.left = pos.x + 'px';
            card.style.top = pos.y + 'px';
            card.style.width = config.cardWidth + 'px';
            card.style.height = config.cardHeight + 'px';
            card.dataset.id = personId;

            const displayName = person.firstName || '?';
            const displaySurname = person.lastName || '';

            card.innerHTML = `
                <div class="preview-card-name">${displayName}</div>
                <div class="preview-card-surname">${displaySurname}</div>
            `;

            card.addEventListener('click', (e) => {
                e.stopPropagation();
                this.refocusPane(paneName, personId);
            });

            canvas.appendChild(card);
        }
    }

    private updatePaneFocusInfo(paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane || !this.overlay) return;

        const paneEl = this.overlay.querySelector(`.tree-compare-pane[data-pane="${paneName}"]`);
        const nameEl = paneEl?.querySelector('.tree-preview-focus-name');
        const person = pane.options.data.persons[pane.currentFocusId];

        if (nameEl && person) {
            nameEl.textContent = `${person.firstName || '?'} ${person.lastName || ''}`.trim();
        }
    }

    private refocusPane(paneName: 'left' | 'right', personId: PersonId): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane || !pane.options.data.persons[personId]) return;

        pane.currentFocusId = personId;
        this.renderPane(paneName);
        this.centerPane(paneName);
    }

    private centerPane(paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane || !this.overlay) return;

        const pos = pane.positions.get(pane.currentFocusId);
        if (!pos) return;

        const paneEl = this.overlay.querySelector(`.tree-compare-pane[data-pane="${paneName}"]`);
        const container = paneEl?.querySelector('.tree-compare-pane-container') as HTMLElement;
        if (!container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        const cardCenterX = pos.x + 55;
        const cardCenterY = pos.y + 27;

        pane.zoomState.tx = containerWidth / 2 - cardCenterX * pane.zoomState.scale;
        pane.zoomState.ty = containerHeight / 2 - cardCenterY * pane.zoomState.scale;

        this.applyPaneTransform(paneName);
    }

    private zoomPane(paneName: 'left' | 'right', factor: number): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane || !this.overlay) return;

        const paneEl = this.overlay.querySelector(`.tree-compare-pane[data-pane="${paneName}"]`);
        const container = paneEl?.querySelector('.tree-compare-pane-container') as HTMLElement;
        if (!container) return;

        const centerX = container.clientWidth / 2;
        const centerY = container.clientHeight / 2;

        const oldScale = pane.zoomState.scale;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor));

        if (newScale === oldScale) return;

        const canvasX = (centerX - pane.zoomState.tx) / oldScale;
        const canvasY = (centerY - pane.zoomState.ty) / oldScale;

        pane.zoomState.scale = newScale;
        pane.zoomState.tx = centerX - canvasX * newScale;
        pane.zoomState.ty = centerY - canvasY * newScale;

        this.applyPaneTransform(paneName);
    }

    private setupPanePanZoom(container: HTMLElement, paneName: 'left' | 'right'): void {
        container.addEventListener('mousedown', (e) => this.onPaneMouseDown(e, paneName));
        container.addEventListener('mousemove', (e) => this.onPaneMouseMove(e, paneName));
        container.addEventListener('mouseup', () => this.onPaneMouseUp(paneName));
        container.addEventListener('mouseleave', () => this.onPaneMouseUp(paneName));
        container.addEventListener('wheel', (e) => this.onPaneWheel(e, paneName), { passive: false });

        container.addEventListener('touchstart', (e) => this.onPaneTouchStart(e, paneName), { passive: false });
        container.addEventListener('touchmove', (e) => this.onPaneTouchMove(e, paneName), { passive: false });
        container.addEventListener('touchend', () => this.onPaneTouchEnd(paneName));
        container.addEventListener('touchcancel', () => this.onPaneTouchEnd(paneName));
    }

    private onPaneMouseDown(e: MouseEvent, paneName: 'left' | 'right'): void {
        const target = e.target as HTMLElement;
        if (target.closest('.tree-preview-card')) return;

        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane) return;

        pane.zoomState.dragging = true;
        pane.zoomState.dragStartX = e.clientX - pane.zoomState.tx;
        pane.zoomState.dragStartY = e.clientY - pane.zoomState.ty;
    }

    private onPaneMouseMove(e: MouseEvent, paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane || !pane.zoomState.dragging) return;

        pane.zoomState.tx = e.clientX - pane.zoomState.dragStartX;
        pane.zoomState.ty = e.clientY - pane.zoomState.dragStartY;
        this.applyPaneTransform(paneName);
    }

    private onPaneMouseUp(paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (pane) pane.zoomState.dragging = false;
    }

    private onPaneWheel(e: WheelEvent, paneName: 'left' | 'right'): void {
        e.preventDefault();
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane) return;

        const container = (e.currentTarget as HTMLElement);
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const oldScale = pane.zoomState.scale;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * delta));

        if (newScale !== oldScale) {
            const canvasX = (mouseX - pane.zoomState.tx) / oldScale;
            const canvasY = (mouseY - pane.zoomState.ty) / oldScale;

            pane.zoomState.scale = newScale;
            pane.zoomState.tx = mouseX - canvasX * newScale;
            pane.zoomState.ty = mouseY - canvasY * newScale;

            this.applyPaneTransform(paneName);
        }
    }

    private onPaneTouchStart(e: TouchEvent, paneName: 'left' | 'right'): void {
        const target = e.target as HTMLElement;
        if (target.closest('.tree-preview-card')) return;

        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane) return;

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            pane.zoomState.touchState = {
                startX: touch.clientX,
                startY: touch.clientY,
                lastX: touch.clientX,
                lastY: touch.clientY,
                isPanning: false
            };
        } else if (e.touches.length === 2) {
            e.preventDefault();
            pane.zoomState.touchState = null;
            pane.zoomState.lastPinchDistance = this.getTouchDistance(e.touches);
        }
    }

    private onPaneTouchMove(e: TouchEvent, paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane) return;

        if (e.touches.length === 1 && pane.zoomState.touchState) {
            const touch = e.touches[0];
            const dx = touch.clientX - pane.zoomState.touchState.startX;
            const dy = touch.clientY - pane.zoomState.touchState.startY;

            if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD_PX) {
                pane.zoomState.touchState.isPanning = true;
            }

            if (pane.zoomState.touchState.isPanning) {
                e.preventDefault();
                const moveX = touch.clientX - pane.zoomState.touchState.lastX;
                const moveY = touch.clientY - pane.zoomState.touchState.lastY;

                pane.zoomState.tx += moveX;
                pane.zoomState.ty += moveY;
                this.applyPaneTransform(paneName);

                pane.zoomState.touchState.lastX = touch.clientX;
                pane.zoomState.touchState.lastY = touch.clientY;
            }
        } else if (e.touches.length === 2 && pane.zoomState.lastPinchDistance > 0) {
            e.preventDefault();
            const newDistance = this.getTouchDistance(e.touches);
            const container = (e.currentTarget as HTMLElement);
            const rect = container.getBoundingClientRect();
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            const scaleFactor = newDistance / pane.zoomState.lastPinchDistance;
            const oldScale = pane.zoomState.scale;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * scaleFactor));

            if (newScale !== oldScale) {
                const canvasX = (centerX - pane.zoomState.tx) / oldScale;
                const canvasY = (centerY - pane.zoomState.ty) / oldScale;

                pane.zoomState.scale = newScale;
                pane.zoomState.tx = centerX - canvasX * newScale;
                pane.zoomState.ty = centerY - canvasY * newScale;

                this.applyPaneTransform(paneName);
            }

            pane.zoomState.lastPinchDistance = newDistance;
        }
    }

    private onPaneTouchEnd(paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (pane) {
            pane.zoomState.touchState = null;
            pane.zoomState.lastPinchDistance = 0;
        }
    }

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private applyPaneTransform(paneName: 'left' | 'right'): void {
        const pane = paneName === 'left' ? this.leftPane : this.rightPane;
        if (!pane) return;

        const transform = `translate(${pane.zoomState.tx}px, ${pane.zoomState.ty}px) scale(${pane.zoomState.scale})`;
        pane.canvas.style.transform = transform;
        pane.svg.style.transform = transform;
    }
}

export const TreePreview = new TreePreviewClass();
export const TreeCompare = new TreeCompareClass();
