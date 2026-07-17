/**
 * TreeRenderer - Rendering of family tree
 * Uses layout module for position computation, handles SVG rendering
 */

import { DataManager } from './data.js';
import { UI } from './ui.js';
import { ZoomPan } from './zoom.js';
import { strings, getCurrentLanguage } from './strings.js';
import {
    Person,
    PersonId,
    Position,
    DEFAULT_LAYOUT_CONFIG,
    TreeId,
    StromData
} from './types.js';
import { TreeManager } from './tree-manager.js';
import { chainLinkSvg } from './icons.js';
import * as CrossTree from './cross-tree.js';
import { CARD_SIZE, ViewMode, STANDALONE_VIEWS } from './types.js';
import {
    computeLayout,
    StromLayoutEngine,
    LayoutRequest,
    Connection,
    SpouseLine,
    DisplayPolicy,
    runLayoutPipelineWithDebug,
    collectBloodDescendants,
    collectBloodRelatives,
    DebugOptions,
    DebugSnapshot,
    LayoutDebugContext
} from './layout/index.js';
import { renderDebugOverlay, clearDebugOverlay } from './debug-overlay.js';
import { debugPanel } from './debug-panel.js';
import { yearOf, displayYear, formatFlexDate } from './dates.js';
import { computeTimelineModel } from './timeline.js';
import { buildTimelineSvg } from './timeline-chart.js';
import { sortLifeEvents } from './events.js';
import { classifyBranches, Branch } from './branch-colors.js';
import { presumedDeceasedSet, isLivingPerson } from './privacy.js';
import { placeList } from './places.js';
import { SettingsManager } from './settings.js';
import { extractSubtree } from './subtree.js';
import { buildFanModel, buildFanSvg } from './fan-chart.js';

/**
 * One generation band's world-space geometry, consumed by the sticky HTML
 * label overlay (src/ui/gen-labels.ts). All Y values are in canvas/world
 * coordinates; the overlay projects them to the screen on every pan/zoom.
 */
export interface GenerationBand {
    label: string;
    rowCenterY: number;   // where the label sits when the row is on screen
    bandTopY: number;     // top boundary of the band's span
    bandBottomY: number;  // bottom boundary of the band's span
}

class TreeRendererClass {
    private config = DEFAULT_LAYOUT_CONFIG;
    private positions = new Map<PersonId, Position>();

    /** Generation bands for the sticky label overlay (rebuilt each render). */
    private generationBands: GenerationBand[] = [];

    // Connections for line rendering from layout engine
    private connections: Connection[] = [];

    // Spouse lines from layout engine (only adjacent partners)
    private spouseLines: SpouseLine[] = [];

    // Focus mode state
    private focusPersonId: PersonId | null = null;

    /** Focus navigation history (browser back/forward style), per tree. */
    private focusHistory: PersonId[] = [];
    private focusForward: PersonId[] = [];
    private suppressHistoryPush = false;
    /** Search highlight: hits get 'search-hit', everyone else 'search-dim'. */
    private highlightIds: Set<PersonId> | null = null;
    private focusDepthUp: number = 3;
    private focusDepthDown: number = 3;

    // Debug overlay for visual verification of anchor points
    private debugOverlay: boolean = false;

    // Debug mode options (from URL params)
    private debugOptions: DebugOptions | null = null;
    private currentDebugSnapshot: DebugSnapshot | null = null;

    // Expanded display mode: persons whose all partnerships are shown inline
    private showAllPartnerships = true;

    /**
     * Display view mode. 'family' is the default focus-centric view (ancestors +
     * descendants + relatives). 'descendants' shows only the focus person's
     * descendants and their partners (a classic descendants chart). 'timeline'
     * shows the same selection as a set of life-bars on a year axis (no layout
     * pipeline). 'fan' is the classic semicircular ancestor chart (own SVG,
     * no layout pipeline). 'map' plots the places of the same people (own
     * container, needs the internet for tiles). Persisted per tree in
     * localStorage.
     */
    private viewMode: ViewMode = 'family';

    /**
     * Descendants view: show partners' whole families (their other unions and
     * step-children, de-emphasized)? null = not yet resolved; the first use
     * takes the default from settings. The badge toggle flips it ad hoc.
     */
    private descendantsFullFamilies: boolean | null = null;

    /** Blood descendants of the focus (incl. focus) — filled in descendants view. */
    private bloodDescendantIds: Set<PersonId> | null = null;

    /** Fan chart: how many ancestor rings to draw (4–8, persisted globally). */
    private fanGenerations = ((): number => {
        try {
            const v = parseInt(localStorage.getItem('strom-fan-generations') ?? '', 10);
            return v >= 4 && v <= 8 ? v : 5;
        } catch { return 5; }
    })();

    /**
     * Set debug options for pipeline visualization.
     */
    setDebugOptions(options: DebugOptions): void {
        this.debugOptions = options;
    }

    render(): void {
        // render() stays sync externally - the async part (cross-tree matching) is handled internally
        void this.renderInternal();
    }

    /** Async render that resolves when rendering is complete */
    renderAsync(): Promise<void> {
        return this.renderInternal();
    }

    private async renderInternal(): Promise<void> {
        const canvas = document.getElementById('tree-canvas');
        const svg = document.getElementById('tree-lines') as SVGSVGElement | null;
        const empty = document.getElementById('empty-state');

        if (!canvas || !svg) return;

        // A re-render invalidates the anchor of the cross-tree chooser (its
        // badge card is about to be removed) — close it first.
        UI.hideCrossTreeChooser?.();

        // Clear previous render
        canvas.querySelectorAll('.person-card').forEach(c => c.remove());
        svg.innerHTML = '';
        this.positions.clear();
        this.connections = [];
        this.generationBands = [];

        const persons = DataManager.getAllPersons();
        if (persons.length === 0) {
            if (empty) empty.style.display = 'block';
            this.focusPersonId = null;
            this.updateFocusUI();
            return;
        }
        if (empty) empty.style.display = 'none';

        // Ensure we have a valid focus person (exists in current tree)
        if (!this.focusPersonId || !DataManager.getPerson(this.focusPersonId)) {
            this.focusPersonId = this.findDefaultFocusPerson();
            if (!this.focusPersonId) return;
        }

        // Compute layout using the new layout engine
        // Auto-expand for gen >= -1 persons is handled by the pipeline
        // Descendants view: no ancestors, no aunts/uncles/cousins — only the
        // focus person's descendants and their partners.
        const descendantsOnly = this.viewMode === 'descendants';
        // The layout engine spaces cards from the config size — keep it in sync
        // with the density (and the CSS box) or cards overlap / drift apart.
        const density = SettingsManager.getCardDensity();
        this.config = { ...this.config, ...CARD_SIZE[density] };
        document.body.dataset.cardDensity = density;
        this.updatePlacesDatalist();
        const request: LayoutRequest = {
            data: DataManager.getData(),
            focusPersonId: this.focusPersonId,
            policy: {
                ancestorDepth: descendantsOnly ? 0 : this.focusDepthUp,
                descendantDepth: this.focusDepthDown,
                includeAuntsUncles: !descendantsOnly,
                includeCousins: !descendantsOnly
            },
            config: this.config,
            displayPolicy: {
                mode: this.showAllPartnerships ? 'expanded' : 'standard',
                autoExpand: this.showAllPartnerships,
                expandLineageOnly: descendantsOnly && !this.isDescendantsFullFamilies()
            }
        };

        let result;

        // Use debug pipeline if debug mode is enabled
        if (this.debugOptions?.enabled) {
            const debugResult = runLayoutPipelineWithDebug(
                {
                    data: request.data,
                    focusPersonId: request.focusPersonId,
                    config: request.config,
                    ancestorDepth: request.policy.ancestorDepth,
                    descendantDepth: request.policy.descendantDepth,
                    includeSpouseAncestors: false,
                    includeParentSiblings: request.policy.includeAuntsUncles,
                    includeParentSiblingDescendants: request.policy.includeCousins
                },
                this.debugOptions
            );

            result = debugResult.result;

            // Store current snapshot (last one for the target step)
            this.currentDebugSnapshot = debugResult.snapshots[debugResult.snapshots.length - 1] || null;

            // Set global debug context for DevTools inspection
            const debugContext: LayoutDebugContext = {
                query: {
                    debug: this.debugOptions.enabled,
                    step: this.debugOptions.step
                },
                snapshots: debugResult.snapshots,
                result: debugResult.result
            };
            window.__LAYOUT_DEBUG__ = debugContext;
        } else {
            const engine = new StromLayoutEngine();
            result = computeLayout(engine, request);
            this.currentDebugSnapshot = null;
        }

        // Apply layout result
        this.positions = result.positions;
        this.connections = result.connections;
        this.spouseLines = result.spouseLines;

        // Timeline, fan and map show the same person selection drawn their own
        // way, in their own container (the pipeline above only served to pick
        // which persons are visible). Everything else uses the tree canvas.
        const standalone: Partial<Record<ViewMode, { id: string; display: string; draw: (el: HTMLElement) => void }>> = {
            timeline: { id: 'timeline-container', display: 'block', draw: el => this.renderTimeline(el) },
            fan: { id: 'fan-container', display: 'flex', draw: el => this.renderFan(el) },
            map: { id: 'map-container', display: 'block', draw: el => UI.renderMapView?.(el) },
        };
        const active = standalone[this.viewMode];
        for (const [mode, view] of Object.entries(standalone)) {
            const el = document.getElementById(view.id);
            if (el) el.style.display = mode === this.viewMode ? view.display : 'none';
        }
        if (active) {
            const el = document.getElementById(active.id);
            if (el) {
                canvas.style.display = 'none';
                active.draw(el);
                this.updateFocusUI();
                UI.updateViewModeUI?.();
                UI.updateMinimap?.();  // hidden outside the tree canvas
                UI.updateGenLabels?.();  // clears labels for standalone views
                return;
            }
        }

        canvas.style.display = '';

        await this.renderCards(canvas);
        this.renderLines(svg);
        this.updateSVGSize(svg);
        // Fit long names once, after the cards are in the DOM and measurable.
        requestAnimationFrame(() => this.fitCardNames(canvas));

        // Update focus UI (shows panel with focused person name, generation controls)
        this.updateFocusUI();
        // Keep the view-mode segment + descendants badge in sync.
        UI.updateViewModeUI?.();
        // Refresh the overview minimap for the new layout.
        UI.updateMinimap?.();
        // Rebuild the sticky generation-label overlay for the new layout.
        UI.updateGenLabels?.();
    }

    // ============= Focus Mode Methods =============

    /**
     * Find a default focus person when none is set.
     * Uses getStartupFocus which handles the defaultPersonId setting
     * Fallback: first person in data
     */
    private findDefaultFocusPerson(): PersonId | null {
        const persons = DataManager.getAllPersons();
        if (persons.length === 0) return null;

        // Use getStartupFocus to respect the tree's defaultPersonId setting
        const startupFocus = DataManager.getStartupFocus();
        if (startupFocus) {
            return startupFocus.personId;
        }

        // Fallback to first person
        return persons[0].id;
    }

    /**
     * Restore focus from tree data based on default person setting
     * Called during initialization and after tree switch to restore user's position
     */
    restoreFromSession(): void {
        // Tree load/switch/startup: the focus that follows is programmatic,
        // not user navigation, so history starts empty for the new tree.
        this.resetFocusHistory();
        // Restore the per-tree display view mode on tree switch / startup.
        this.loadViewModeForCurrentTree();

        const persons = DataManager.getAllPersons();

        if (persons.length === 0) {
            this.focusPersonId = null;
            return;
        }

        // Get startup focus based on tree's defaultPersonId setting
        const startupFocus = DataManager.getStartupFocus();

        if (startupFocus) {
            // Use the specified person (and optionally saved depths)
            this.focusPersonId = startupFocus.personId;
            if (startupFocus.depthUp !== undefined) {
                this.focusDepthUp = startupFocus.depthUp;
            } else {
                const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
                this.focusDepthUp = maxGen.up;
            }
            if (startupFocus.depthDown !== undefined) {
                this.focusDepthDown = startupFocus.depthDown;
            } else {
                const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
                this.focusDepthDown = maxGen.down;
            }
        } else {
            // Fall back to first person
            this.focusPersonId = this.findDefaultFocusPerson();
            if (this.focusPersonId) {
                const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
                this.focusDepthUp = maxGen.up;
                this.focusDepthDown = maxGen.down;
            }
        }
    }

    // Public Focus Mode API
    setFocus(personId: PersonId | null, saveToData = true): void {
        // Always have a focus person
        // If null is passed, find a default person
        if (!personId) {
            personId = this.findDefaultFocusPerson();
        }

        // Focus history (browser back/forward): a NORMAL navigation pushes the
        // previous focus and clears the forward stack. History is reset
        // explicitly by resetFocusHistory() on tree load/switch (not inferred
        // here) — that avoids counting the programmatic focus a load performs,
        // while still counting the user's very first click. goBack/goForward
        // set suppressHistoryPush so they can manage the stacks themselves.
        if (!this.suppressHistoryPush && this.focusPersonId && personId
            && this.focusPersonId !== personId) {
            this.focusHistory.push(this.focusPersonId);
            if (this.focusHistory.length > 50) this.focusHistory.shift();
            this.focusForward = [];
        }

        this.focusPersonId = personId;

        // Set default depth to max available when focusing on a new person
        if (personId) {
            const maxGen = DataManager.getMaxGenerationsWithSiblings(personId);
            this.focusDepthUp = maxGen.up;
            this.focusDepthDown = maxGen.down;

            // Save to tree data if setting is LAST_FOCUSED (this DOES export)
            if (saveToData) {
                DataManager.saveLastFocus(personId, this.focusDepthUp, this.focusDepthDown);
            }
        }

        // Render async, then center once cards are in DOM. The descendants
        // chart fits the whole chart instead (focus sits at its top edge).
        const focusId = personId;
        void this.renderInternal().then(() => {
            this.updateFocusUI();
            if (this.viewMode === 'descendants') {
                this.centerForViewMode();
            } else if (focusId) {
                ZoomPan.centerOnPerson(focusId);
            }
        });
    }

    setFocusDepth(up: number, down: number): void {
        this.focusDepthUp = up;
        this.focusDepthDown = down;

        // Save to tree data if setting is LAST_FOCUSED (this DOES export)
        if (this.focusPersonId) {
            DataManager.saveLastFocus(this.focusPersonId, up, down);
            this.render();
        }
    }

    isFocusMode(): boolean {
        // Always in focus mode
        return true;
    }

    getFocusPersonId(): PersonId | null {
        return this.focusPersonId;
    }

    // ==================== DISPLAY VIEW MODE ====================

    getViewMode(): ViewMode {
        return this.viewMode;
    }

    /** Current ancestor depth (generations up) — used for the poster view label. */
    getFocusDepthUp(): number {
        return this.focusDepthUp;
    }

    /** Current descendant depth (generations down) — used for the poster view label. */
    getFocusDepthDown(): number {
        return this.focusDepthDown;
    }

    /**
     * Set + persist the view mode WITHOUT rendering. For callers that follow
     * up with setFocus (which renders) — avoids two overlapping renders.
     */
    presetViewMode(mode: ViewMode): void {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        this.persistViewMode();
    }

    /** Switch the display view mode and re-render. Persisted per tree. */
    setViewMode(mode: ViewMode): void {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        this.persistViewMode();
        // The modes lay the tree out in different coordinate frames — the
        // pan/zoom state from the previous mode can leave every card outside
        // the viewport (reported on a live tree: switching to descendants
        // showed an empty canvas). Center AFTER the async render finishes so
        // the new cards are measurable. Timeline has its own scroll container.
        void this.renderInternal().then(() => this.centerForViewMode());
    }

    /** Re-center the viewport for the current view mode (after a render). */
    centerForViewMode(): void {
        if (STANDALONE_VIEWS.includes(this.viewMode)) return;
        // The descendants chart is focus-at-top: center it and align its top
        // edge, but KEEP the user's current zoom level (user feedback —
        // fitting to screen kept re-zooming under their hands).
        if (this.viewMode === 'descendants') ZoomPan.centerTreeTopKeepScale();
        else ZoomPan.centerOnFocusWithContext();
    }

    private viewModeStorageKey(): string | null {
        const treeId = DataManager.getCurrentTreeId();
        return treeId ? `strom-viewmode-${treeId}` : null;
    }

    private persistViewMode(): void {
        const key = this.viewModeStorageKey();
        try {
            if (key) localStorage.setItem(key, this.viewMode);
        } catch { /* ignore storage errors */ }
    }

    /** Load the per-tree view mode (called on tree switch / session restore). */
    loadViewModeForCurrentTree(): void {
        const key = this.viewModeStorageKey();
        let stored: string | null = null;
        try { stored = key ? localStorage.getItem(key) : null; } catch { /* ignore */ }
        const known: readonly string[] = ['descendants', 'timeline', 'fan', 'map'];
        this.viewMode = (stored && known.includes(stored)) ? stored as ViewMode : 'family';
    }

    /**
     * Clear the focus back/forward history. Called on tree load/switch so the
     * programmatic focus a load performs doesn't seed history; stale entries
     * from another tree would be skipped anyway, this just keeps it tidy.
     */
    resetFocusHistory(): void {
        this.focusHistory = [];
        this.focusForward = [];
        this.updateNavButtons();
    }

    /** Is there a previous focus to go back to? */
    canGoBack(): boolean {
        return this.focusHistory.length > 0;
    }

    /** Is there a focus to go forward to (after going back)? */
    canGoForward(): boolean {
        return this.focusForward.length > 0;
    }

    /**
     * Navigate one step through focus history. `from` is the stack we pop the
     * target off; `to` is the stack the current focus is pushed onto, so the
     * opposite direction can retrace it. Skips persons deleted meanwhile.
     */
    private navigateHistory(from: PersonId[], to: PersonId[]): void {
        while (from.length > 0) {
            const target = from.pop()!;
            if (DataManager.getPerson(target)) {
                if (this.focusPersonId) to.push(this.focusPersonId);
                this.suppressHistoryPush = true;
                try {
                    this.setFocus(target);
                } finally {
                    this.suppressHistoryPush = false;
                }
                return;
            }
        }
        this.updateNavButtons();
    }

    /** Navigate to the previous focus (browser back). */
    goBack(): void {
        this.navigateHistory(this.focusHistory, this.focusForward);
    }

    /** Navigate to the next focus after going back (browser forward). */
    goForward(): void {
        this.navigateHistory(this.focusForward, this.focusHistory);
    }

    /** Show/hide the floating back & forward buttons to match history state. */
    updateNavButtons(): void {
        const back = document.getElementById('focus-back-btn');
        if (back) back.style.display = this.canGoBack() ? '' : 'none';
        const fwd = document.getElementById('focus-forward-btn');
        if (fwd) fwd.style.display = this.canGoForward() ? '' : 'none';
    }

    /** @deprecated use updateNavButtons */
    updateBackButton(): void {
        this.updateNavButtons();
    }

    /**
     * Refill the shared place suggestions from the tree's own places, so typing
     * a place offers what this family already uses (see src/places.ts — nothing
     * is downloaded). Most-used first: the browser keeps datalist order.
     */
    private updatePlacesDatalist(): void {
        const list = document.getElementById('places-datalist');
        if (!list) return;
        list.innerHTML = placeList(DataManager.getData())
            .map(p => `<option value="${this.escapeHtml(p.display)}"></option>`)
            .join('');
    }

    /** Number of visible (non-placeholder) persons — used by the descendants badge. */
    getVisiblePersonCount(): number {
        let count = 0;
        for (const id of this.positions.keys()) {
            if (!DataManager.getPerson(id)?.isPlaceholder) count++;
        }
        return count;
    }

    /**
     * Descendants badge count: BLOOD descendants only (focus excluded) —
     * partners and step-relatives are visible context, not descendants.
     */
    getDescendantCount(): number {
        if (!this.bloodDescendantIds) return this.getVisiblePersonCount();
        let count = 0;
        for (const id of this.positions.keys()) {
            if (id === this.focusPersonId) continue;
            if (this.bloodDescendantIds.has(id) && !DataManager.getPerson(id)?.isPlaceholder) count++;
        }
        return count;
    }

    isDescendantsFullFamilies(): boolean {
        if (this.descendantsFullFamilies === null) {
            this.descendantsFullFamilies = SettingsManager.isDescendantsFullFamiliesDefault();
        }
        return this.descendantsFullFamilies;
    }

    /** Ad hoc override from the badge toggle (does not touch the setting). */
    setDescendantsFullFamilies(enabled: boolean): void {
        this.descendantsFullFamilies = enabled;
    }

    /**
     * Highlight a set of persons in the tree (search results): matched cards get
     * 'search-hit', all others 'search-dim'. Pass null to clear. Pure DOM class
     * toggling — the layout is never recomputed.
     */
    setHighlight(ids: Set<PersonId> | null): void {
        this.highlightIds = ids && ids.size > 0 ? ids : null;
        document.querySelectorAll('.person-card').forEach(el => {
            const card = el as HTMLElement;
            card.classList.remove('search-hit', 'search-dim');
            if (!this.highlightIds || card.classList.contains('placeholder')) return;
            const id = card.dataset.id as PersonId | undefined;
            if (id) card.classList.add(this.highlightIds.has(id) ? 'search-hit' : 'search-dim');
        });
        // Timeline bars mirror the same highlight classes.
        document.querySelectorAll('.timeline-bar').forEach(el => {
            const bar = el as SVGElement;
            bar.classList.remove('search-hit', 'search-dim');
            if (!this.highlightIds) return;
            const id = bar.getAttribute('data-person-id') as PersonId | null;
            if (id) bar.classList.add(this.highlightIds.has(id) ? 'search-hit' : 'search-dim');
        });
    }

    private updateFocusUI(): void {
        this.updateNavButtons();
        const focusControls = document.getElementById('focus-controls');
        const focusName = document.getElementById('focus-name');
        const focusCount = document.getElementById('focus-person-count');
        const depthUpSelect = document.getElementById('focus-depth-up') as HTMLSelectElement | null;
        const depthDownSelect = document.getElementById('focus-depth-down') as HTMLSelectElement | null;

        // Toolbar focus elements (for tablet landscape)
        const toolbarFocusName = document.getElementById('toolbar-focus-name');
        const toolbarFocusCount = document.getElementById('toolbar-focus-count');
        const toolbarDepthUp = document.getElementById('toolbar-depth-up') as HTMLSelectElement | null;
        const toolbarDepthDown = document.getElementById('toolbar-depth-down') as HTMLSelectElement | null;

        if (!focusControls) return;

        // Get toolbar-focus element for tablet view
        const toolbarFocus = document.querySelector('.toolbar-focus') as HTMLElement | null;

        // Hide everything if there are no persons in the tree
        const totalCount = DataManager.getAllPersons().length;
        if (totalCount === 0) {
            focusControls.classList.add('hidden');
            if (toolbarFocus) toolbarFocus.style.display = 'none';
            if (toolbarFocusName) toolbarFocusName.textContent = '';
            if (toolbarFocusCount) toolbarFocusCount.textContent = '';
            return;
        }

        // Show toolbar-focus if it was hidden (and we have persons)
        if (toolbarFocus) toolbarFocus.style.display = '';

        if (this.focusPersonId) {
            const person = DataManager.getPerson(this.focusPersonId);
            const displayName = person ? (`${person.firstName} ${person.lastName}`.trim() || '?') : '?';

            // Update floating focus controls
            if (focusName) {
                focusName.textContent = displayName;
            }
            // Update toolbar focus (tablet)
            if (toolbarFocusName) {
                toolbarFocusName.textContent = displayName;
            }

            // Update person count (visible / total)
            const visibleCount = this.positions.size;
            const countText = strings.focus.personCount(visibleCount, totalCount);

            if (focusCount) {
                focusCount.textContent = countText;
            }
            if (toolbarFocusCount) {
                toolbarFocusCount.textContent = countText;
            }

            // Update generation select options based on available data
            const maxGen = DataManager.getMaxGenerationsWithSiblings(this.focusPersonId);
            this.updateGenerationSelect(depthUpSelect, maxGen.up, this.focusDepthUp);
            this.updateGenerationSelect(depthDownSelect, maxGen.down, this.focusDepthDown);
            // Also update toolbar selects
            this.updateGenerationSelect(toolbarDepthUp, maxGen.up, this.focusDepthUp);
            this.updateGenerationSelect(toolbarDepthDown, maxGen.down, this.focusDepthDown);

            focusControls.classList.remove('hidden');
        } else {
            focusControls.classList.add('hidden');
            // Clear toolbar focus display when no focus person
            if (toolbarFocusName) toolbarFocusName.textContent = '';
            if (toolbarFocusCount) toolbarFocusCount.textContent = '';
        }

        // Toggle tree-locked body class
        document.body.classList.toggle('tree-locked', DataManager.isTreeLocked());
    }

    /**
     * Update a generation select element with options from 1 to maxValue.
     */
    private updateGenerationSelect(select: HTMLSelectElement | null, maxValue: number, currentValue: number): void {
        if (!select) return;

        // Clear existing options
        select.innerHTML = '';

        // Add options from 1 to maxValue
        for (let i = 1; i <= maxValue; i++) {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = String(i);
            select.appendChild(option);
        }

        // Set current value (clamped to available range)
        const clampedValue = Math.min(currentValue, maxValue);
        select.value = String(clampedValue);

        // Update internal state if clamped
        if (select.id === 'focus-depth-up' && clampedValue !== this.focusDepthUp) {
            this.focusDepthUp = clampedValue;
        } else if (select.id === 'focus-depth-down' && clampedValue !== this.focusDepthDown) {
            this.focusDepthDown = clampedValue;
        }
    }

    exportFocusedData(): void {
        if (!this.focusPersonId) return;

        // Use positions map which reflects what's actually rendered
        // (layout algorithm determines visibility via selectFocusSubgraph)
        const visibleIds = new Set(this.positions.keys());

        DataManager.exportFocusedJSON(visibleIds);
    }

    /**
     * Current layout geometry (positions/connections/spouse lines) for the
     * poster export. Empty when nothing is rendered.
     */
    getPosterLayout(): { positions: Map<PersonId, Position>; connections: Connection[]; spouseLines: SpouseLine[] } {
        return {
            positions: this.positions,
            connections: this.connections,
            spouseLines: this.spouseLines,
        };
    }

    /**
     * Get focused data as StromData object (for creating new tree from focus)
     */
    getFocusedData(): import('./types.js').StromData | null {
        if (!this.focusPersonId || this.positions.size === 0) return null;
        // Shared, self-consistent slice logic (glue + cleaned relations +
        // pruned sources) — same as "make a tree from this view".
        return extractSubtree(DataManager.getData(), new Set(this.positions.keys()));
    }

    /**
     * Get partners of a person that are not currently visible (hidden in focus mode)
     */
    getHiddenPartners(personId: PersonId): Person[] {
        const allPartners = DataManager.getAllPartners(personId);
        return allPartners.filter(p => !this.positions.has(p.id));
    }

    /**
     * Get partners with children that are not currently visible (hidden families)
     */
    getHiddenFamilyPartners(personId: PersonId): Person[] {
        const partnerships = DataManager.getPartnerships(personId);
        const hiddenFamilyPartners: Person[] = [];

        for (const partnership of partnerships) {
            // Only consider partnerships with children
            if (partnership.childIds.length === 0) continue;

            const partnerId = partnership.person1Id === personId
                ? partnership.person2Id
                : partnership.person1Id;

            // Only if partner is not visible
            if (!this.positions.has(partnerId)) {
                const partner = DataManager.getPerson(partnerId);
                if (partner) {
                    hiddenFamilyPartners.push(partner);
                }
            }
        }

        return hiddenFamilyPartners;
    }

    /**
     * Toggle showing all partnerships inline.
     */
    toggleShowAllPartnerships(): void {
        this.showAllPartnerships = !this.showAllPartnerships;
        this.render();
    }

    /**
     * Compute set of persons who are presumed deceased:
     * - Has death date, OR
     * - Birth year is more than 120 years ago, OR
     * - Is an ancestor of someone who is presumed deceased
     */
    private computePresumedDeceased(): Set<PersonId> {
        // Shared with the poster export (single source of the † rule).
        return presumedDeceasedSet(DataManager.getData()) as Set<PersonId>;
    }

    /**
     * Get all trees for cross-tree matching
     * Returns a Map of treeId -> { name, data }
     * Only available when not in view mode and there are multiple visible trees
     */
    private async getAllTreesForCrossTreeMatching(): Promise<Map<TreeId, { name: string; data: StromData }> | null> {
        // Don't do cross-tree matching in view mode, or when the user turned
        // the connection badges off (also skips the per-tree decrypt cost).
        if (DataManager.isViewMode()) return null;
        if (!SettingsManager.isCrossTreeBadgesEnabled()) return null;

        // Cached per tree (stamped by lastModifiedAt): loading + decrypting
        // every tree's data on every render was a real cost on big setups.
        return CrossTree.getTreesDataForMatching(TreeManager);
    }

    private async renderCards(canvas: HTMLElement): Promise<void> {
        // Get all trees for cross-tree matching (only if not in view mode)
        const allTrees = await this.getAllTreesForCrossTreeMatching();
        const currentTreeId = DataManager.getCurrentTreeId();

        // Optional branch colouring: classify once per render (never in timeline).
        const branchMap: Map<PersonId, Branch> | null =
            (SettingsManager.isBranchColorsEnabled() && this.viewMode !== 'timeline' && this.focusPersonId)
                ? classifyBranches(DataManager.getData(), this.focusPersonId)
                : null;

        // Descendants view: mark step-relatives (neither blood descendants
        // nor partners of one) so they render de-emphasized, and remember the
        // blood set for the badge count.
        this.bloodDescendantIds = null;
        let indirectIds: Set<PersonId> | null = null;
        if (this.viewMode === 'descendants' && this.focusPersonId) {
            const data = DataManager.getData();
            const blood = collectBloodDescendants(data, this.focusPersonId);
            this.bloodDescendantIds = blood;
            indirectIds = new Set();
            for (const id of this.positions.keys()) {
                if (blood.has(id)) continue;
                const p = DataManager.getPerson(id);
                if (!p || p.isPlaceholder) continue;
                const partnerOfBlood = p.partnerships.some(pid => {
                    const u = data.partnerships[pid];
                    if (!u) return false;
                    const other = u.person1Id === id ? u.person2Id : u.person1Id;
                    return blood.has(other);
                });
                if (!partnerOfBlood) indirectIds.add(id);
            }
        }

        // Family view: de-emphasize people shown only for context — those who
        // belong to another union with no blood tie to the focus line (e.g. the
        // second husband of a great-grandmother). Fully visible =
        //   BLOOD(focus)
        //   ∪ {partners of anyone in BLOOD(focus)}
        //   ∪ BLOOD(each partner of focus)   (keeps the partner's V-fan ancestry)
        // where BLOOD is the up-then-down closure (see collectBloodRelatives).
        if (this.viewMode === 'family' && this.focusPersonId) {
            const data = DataManager.getData();
            const keep = collectBloodRelatives(data, this.focusPersonId);
            // Partners of anyone in the focus blood set.
            for (const bid of [...keep]) {
                const bp = data.persons[bid];
                if (!bp) continue;
                for (const pid of bp.partnerships) {
                    const u = data.partnerships[pid];
                    if (!u) continue;
                    keep.add(u.person1Id === bid ? u.person2Id : u.person1Id);
                }
            }
            // Blood of each partner of the focus (their whole ancestry stays lit).
            const focus = data.persons[this.focusPersonId];
            if (focus) {
                for (const pid of focus.partnerships) {
                    const u = data.partnerships[pid];
                    if (!u) continue;
                    const partnerId = u.person1Id === this.focusPersonId ? u.person2Id : u.person1Id;
                    for (const b of collectBloodRelatives(data, partnerId)) keep.add(b);
                }
            }
            indirectIds = new Set();
            for (const id of this.positions.keys()) {
                if (keep.has(id)) continue;
                const p = DataManager.getPerson(id);
                if (!p || p.isPlaceholder) continue;
                indirectIds.add(id);
            }
        }

        for (const [id, pos] of this.positions) {
            const person = DataManager.getPerson(id);
            if (!person) continue;

            const card = document.createElement('div');
            let classes = 'person-card';
            if (person.isPlaceholder) {
                classes += ' placeholder';
            } else {
                classes += ' ' + person.gender;
            }
            // The avatar circle is always present in normal/detailed density
            // (initials by default); a photo just fills it instead. `has-photo`
            // marks the photo case for styling/tests.
            if (person.photo && SettingsManager.getCardDensity() !== 'compact') {
                classes += ' has-photo';
            }
            // Add focused class if this is the focus person
            if (this.focusPersonId && id === this.focusPersonId) {
                classes += ' focused';
            }
            // Add locked class if person is locked
            if (DataManager.isPersonLocked(id)) {
                classes += ' locked';
            }
            // Search highlight (re-applied on every render so it survives one).
            if (this.highlightIds && !person.isPlaceholder) {
                classes += this.highlightIds.has(id) ? ' search-hit' : ' search-dim';
            }
            // Optional branch colour stripe (focus and placeholders never tagged).
            if (branchMap && !person.isPlaceholder) {
                const b = branchMap.get(id);
                if (b) classes += ` branch-${b}`;
            }
            // Descendants/family view: de-emphasize context-only relatives.
            if (indirectIds?.has(id)) {
                classes += ' indirect';
            }
            // An open question about this person (collaboration hint).
            if (person.question?.trim() && !person.isPlaceholder) {
                classes += ' has-question';
            }
            card.className = classes;
            card.style.left = pos.x + 'px';
            card.style.top = pos.y + 'px';
            card.dataset.id = id;

            card.onclick = (e) => {
                // A long-press just opened the bottom sheet — swallow this click.
                if (card.dataset.suppressClick) { delete card.dataset.suppressClick; return; }
                const target = e.target as HTMLElement;
                if (target.classList.contains('add-btn') || target.classList.contains('branch-tab')) return;
                // Don't open context menu when clicking on badge buttons or their children
                if (target.closest('.hidden-partners-btn') || target.closest('.hidden-families-btn')) return;
                UI.showContextMenu(id, e);
            };

            // Touch: long-press opens the mobile bottom sheet (coarse pointer only).
            UI.attachCardLongPress(card, id);

            const displayName = person.firstName || '?';

            // Always display person's own lastName (maiden name for women)
            const displaySurname = person.lastName;

            // Birth year for the card meta row (the year range replaces the dagger).
            const birthYear = person.birthDate ? displayYear(person.birthDate) : '';

            // Check for hidden partners (partners not in the visible/rendered set)
            let hiddenPartnersCount = 0;
            const allPartners = DataManager.getAllPartners(id);
            for (const partner of allPartners) {
                if (!this.positions.has(partner.id)) {
                    hiddenPartnersCount++;
                }
            }

            // Check for hidden families (partnerships with children where partner is not visible)
            // This indicates step-family situations that aren't shown in current view
            let hiddenFamiliesCount = 0;
            const partnerships = DataManager.getPartnerships(id);
            for (const partnership of partnerships) {
                const partnerId = partnership.person1Id === id ? partnership.person2Id : partnership.person1Id;
                // Count if: partner not visible AND partnership has children
                if (!this.positions.has(partnerId) && partnership.childIds.length > 0) {
                    hiddenFamiliesCount++;
                }
            }

            // Check if parents are currently visible
            const hasParents = person.parentIds.length > 0;
            const parentsVisible = hasParents &&
                person.parentIds.some(pid => this.positions.has(pid));

            // Check if children are currently visible
            const hasChildren = person.childIds.length > 0;
            const childrenVisible = hasChildren &&
                person.childIds.some(cid => this.positions.has(cid));

            // Check if siblings are currently visible
            // Filter to only siblings that are in a partnership.childIds (same as layout engine)
            const siblings = DataManager.getSiblings(id).filter(s =>
                Object.values(DataManager.getData().partnerships).some(
                    p => p.childIds.includes(s.id)
                )
            );
            const hasSiblings = siblings.length > 0;
            const siblingsVisible = hasSiblings &&
                siblings.some(s => this.positions.has(s.id));

            // Show branch tab if has hidden parents, children, or siblings
            const hasHiddenParents = hasParents && !parentsVisible;
            const hasHiddenChildren = hasChildren && !childrenVisible;
            const hasHiddenSiblings = hasSiblings && !siblingsVisible;

            let html = '';

            // The descendants chart hides relatives BY DESIGN — "hidden relative"
            // badges would be noise there, and their click action (re-focus)
            // changes nothing inside the filtered view. Skip them entirely.
            const showHiddenBadges = this.viewMode !== 'descendants';

            // Add branch tabs - separate button for each direction (displayed side by side)
            if (showHiddenBadges && (hasHiddenParents || hasHiddenChildren || hasHiddenSiblings)) {
                html += `<div class="branch-tabs">`;
                if (hasHiddenParents) {
                    const hiddenParents = person.parentIds
                        .filter(pid => !this.positions.has(pid))
                        .map(pid => DataManager.getPerson(pid))
                        .filter((p): p is Person => p !== null);
                    const parentItems = hiddenParents.map(p => {
                        const name = `${p.firstName || '?'} ${p.lastName || ''}`.trim();
                        const year = p.birthDate ? p.birthDate.split('-')[0] : '';
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${year}</span>` : ''}</div>`;
                    }).join('');
                    html += `<button class="branch-tab" data-action="focus-parent"><span class="pill-glyph">◂</span><span class="pill-text">${strings.focus.branchTabParents}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenParentsTooltip}</div>${parentItems}</div></button>`;
                }
                if (hasHiddenSiblings) {
                    const hiddenSiblings = siblings.filter(s => !this.positions.has(s.id));
                    const siblingItems = hiddenSiblings.map(s => {
                        const name = `${s.firstName || '?'} ${s.lastName || ''}`.trim();
                        const year = s.birthDate ? s.birthDate.split('-')[0] : '';
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${year}</span>` : ''}</div>`;
                    }).join('');
                    html += `<button class="branch-tab" data-action="focus-sibling"><span class="pill-glyph">◆</span><span class="pill-text">${strings.focus.branchTabSiblings}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenSiblingsTooltip}</div>${siblingItems}</div></button>`;
                }
                if (hasHiddenChildren) {
                    const hiddenChildren = person.childIds
                        .filter(cid => !this.positions.has(cid))
                        .map(cid => DataManager.getPerson(cid))
                        .filter((c): c is Person => c !== null);
                    const childItems = hiddenChildren.map(c => {
                        const name = `${c.firstName || '?'} ${c.lastName || ''}`.trim();
                        const year = c.birthDate ? c.birthDate.split('-')[0] : '';
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${year}</span>` : ''}</div>`;
                    }).join('');
                    html += `<button class="branch-tab" data-action="focus-child"><span class="pill-glyph">▸</span><span class="pill-text">${strings.focus.branchTabChildren}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenChildrenTooltip}</div>${childItems}</div></button>`;
                }
                html += `</div>`;
            }

            // Add hidden relationship indicators (above card on left, mirror of branch tabs)
            // Gen >= -1 persons are auto-expanded, so badges only appear for ancestors (gen <= -2)
            if (showHiddenBadges && (hiddenPartnersCount > 0 || hiddenFamiliesCount > 0)) {
                html += `<div class="hidden-indicators">`;
                if (hiddenPartnersCount > 0) {
                    // Build rich tooltip with list of hidden partners
                    const hiddenPartners = allPartners.filter(p => !this.positions.has(p.id));
                    const partnerItems = hiddenPartners.map(p => {
                        const name = `${p.firstName || '?'} ${p.lastName || ''}`.trim();
                        const year = p.birthDate ? p.birthDate.split('-')[0] : '';
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${year}</span>` : ''}</div>`;
                    }).join('');
                    html += `<button class="hidden-partners-btn" data-action="focus"><span class="pill-glyph">∞</span><span class="pill-count">${hiddenPartnersCount}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenPartnersTooltip}</div>${partnerItems}</div></button>`;
                }
                if (hiddenFamiliesCount > 0) {
                    // Build rich tooltip with hidden families (partner + children)
                    const hiddenFamilyItems = partnerships
                        .filter(p => {
                            const pid = p.person1Id === id ? p.person2Id : p.person1Id;
                            return !this.positions.has(pid) && p.childIds.length > 0;
                        })
                        .map(p => {
                            const pid = p.person1Id === id ? p.person2Id : p.person1Id;
                            const partner = DataManager.getPerson(pid);
                            const partnerName = partner ? `${partner.firstName || '?'} ${partner.lastName || ''}`.trim() : '?';
                            const partnerYear = partner?.birthDate ? partner.birthDate.split('-')[0] : '';
                            const childLabels = p.childIds
                                .map(cid => DataManager.getPerson(cid))
                                .filter((c): c is Person => c !== null)
                                .map(c => {
                                    const name = `${c.firstName || '?'} ${c.lastName || ''}`.trim();
                                    const year = c.birthDate ? c.birthDate.split('-')[0] : '';
                                    return this.escapeHtml(name) + (year ? ` *${year}` : '');
                                });
                            return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(partnerName)}</span>${partnerYear ? `<span class="badge-tooltip-detail"> *${partnerYear}</span>` : ''}<div class="badge-tooltip-detail">${childLabels.join(', ')}</div></div>`;
                        }).join('');
                    html += `<button class="hidden-families-btn" data-action="focus"><span class="pill-glyph">⌂</span><span class="pill-count">${hiddenFamiliesCount}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenFamiliesTooltip}</div>${hiddenFamilyItems}</div></button>`;
                }
                html += `</div>`;
            }

            const isLocked = DataManager.isPersonLocked(id);

            // Density decides what fits: compact = names only (no avatar/meta),
            // normal = avatar + name + life-year meta, detailed = + occupation & age.
            const density = SettingsManager.getCardDensity();
            // Placeholders are a dashed frame with no avatar (nothing to depict).
            const showAvatar = density !== 'compact' && !person.isPlaceholder;
            const showPhoto = showAvatar && !!person.photo;
            const cardAge = density === 'detailed' ? this.calculateAge(person) : null;
            const trade = density === 'detailed' ? (this.occupationOf(person) ?? '') : '';

            // Full name on one row (never shrunk — overflow ellipsizes).
            const fullName = `${displayName} ${displaySurname}`.trim();
            // Avatar initials (first name + surname), used when there is no photo.
            const initials = ((displayName[0] || '?') + (displaySurname[0] || '')).toUpperCase();

            // Meta row (row 2): life-year range. The year range carries the
            // "deceased" cue (the † dagger is gone from the name row): a dead
            // person reads "1902 – 1968", a living one "* 1958".
            const deathYear = person.deathDate ? displayYear(person.deathDate) : '';
            let metaYears = '';
            if (deathYear) metaYears = `${birthYear || '?'} – ${deathYear}`;
            else if (birthYear) metaYears = `* ${birthYear}`;
            const metaPlace = person.birthPlace?.trim() ?? '';
            // Normal cards pack "years · place" onto one ellipsized meta row.
            // Detailed cards give the place its own two-line row below and put
            // the age next to the years instead ("1907 – 1975 · věk 67").
            const metaText = density === 'detailed'
                ? [metaYears, cardAge !== null ? `${strings.card.ageWord} ${cardAge}` : '']
                    .filter(Boolean).join(' · ')
                : [metaYears, metaPlace].filter(Boolean).join(' · ');

            const avatarInner = showPhoto
                ? `<img src="${person.photo}" alt="">`
                : `<span class="avatar-initials">${this.escapeHtml(initials)}</span>`;

            html += `
                ${showAvatar ? `<div class="card-avatar">${avatarInner}</div>` : ''}
                <div class="card-body">
                    <div class="name"><span class="name-text" title="${this.escapeHtml(fullName)}" data-given="${this.escapeHtml(displayName)}" data-surname="${this.escapeHtml(displaySurname)}">${this.escapeHtml(fullName)}</span></div>
                    ${density !== 'compact' && metaText ? `<div class="birth-date" data-years="${this.escapeHtml(metaYears)}">${this.escapeHtml(metaText)}</div>` : ''}
                    ${trade ? `<div class="card-trade">${this.escapeHtml(trade)}</div>` : ''}
                    ${density === 'detailed' && metaPlace ? `<div class="card-place">${this.escapeHtml(metaPlace)}</div>` : ''}
                </div>
                ${this.focusPersonId && id === this.focusPersonId ? `<span class="focus-badge">${strings.card.focusBadge}</span>` : ''}
                ${isLocked ? `<span class="lock-icon" title="${strings.lock.lockedTooltip}">&#128274;</span>` : ''}
                ${!isLocked ? `<button class="rel-link-icon" data-action="relationships" title="${strings.buttons.manageRelationships}" aria-label="${strings.buttons.manageRelationships}"><span class="rel-link-glyph">${chainLinkSvg({ stroke: 'currentColor', size: 11, strokeWidth: 3 })}</span><span class="rel-link-label">${strings.card.relTab}</span></button>` : ''}
            `;

            // Add buttons based on context (hidden for locked persons). Each
            // rests as a small circle and expands into a labelled pill on hover
            // (see .add-btn CSS). The former left "sibling" tab is retired — the
            // action stays available in the card's context menu.
            if (!isLocked) {
                const addTab = (dir: string, action: string, title: string, label: string): string =>
                    `<button class="add-btn ${dir}" data-action="${action}" title="${title}">`
                    + `<span class="add-btn-glyph">+</span>`
                    + `<span class="add-btn-label">${label}</span></button>`;
                // Top: Add parent (if < 2 parents)
                if (person.parentIds.length < 2) {
                    html += addTab('top', 'parent', strings.contextMenu.addParent, strings.card.addTabParent);
                }
                // Right: Add partner
                html += addTab('right', 'partner', strings.contextMenu.addPartner, strings.card.addTabPartner);
                // Bottom: Add child
                html += addTab('bottom', 'child', strings.contextMenu.addChild, strings.card.addTabChild);
            }

            // Add cross-tree badge if person exists in other trees
            let crossTreeMatches: CrossTree.CrossTreeMatch[] = [];
            if (allTrees && currentTreeId && !person.isPlaceholder) {
                crossTreeMatches = CrossTree.findCrossTreeMatches(currentTreeId, person, allTrees);
                if (crossTreeMatches.length > 0) {
                    const tooltipItems = crossTreeMatches.slice(0, 5).map(m =>
                        `<div class="cross-tree-tooltip-item">
                            <div class="cross-tree-tooltip-tree">${this.escapeHtml(m.treeName)}</div>
                            <div class="cross-tree-tooltip-person">${this.escapeHtml(m.personName)}</div>
                        </div>`
                    ).join('');
                    const moreCount = crossTreeMatches.length > 5 ? crossTreeMatches.length - 5 : 0;

                    html += `<div class="cross-tree-badge" data-person-id="${id}" title="${strings.crossTree.badgeTitle(crossTreeMatches.length)}">
                        <span class="pill-glyph">⇄</span><span class="pill-count">${crossTreeMatches.length}</span>
                        <div class="cross-tree-tooltip">
                            <div class="cross-tree-tooltip-header">${strings.crossTree.tooltipHeader}</div>
                            ${tooltipItems}
                            ${moreCount > 0 ? `<div class="cross-tree-tooltip-item">...${moreCount} more</div>` : ''}
                            <div class="cross-tree-tooltip-hint">${strings.crossTree.clickToSwitch}</div>
                        </div>
                    </div>`;
                }
            }

            // Build tooltip content.
            //
            // Date and place are shown independently: knowing the village but
            // not the date is ordinary in parish work (a damaged register, an
            // entry you have not found yet), and requiring the date hid the
            // place completely — a person with only places got no tooltip at all.
            const tooltipLines: string[] = [];
            const event = (mark: string, date: string | undefined, place: string | undefined): void => {
                if (!date && !place) return;
                const parts = [date ? this.formatDateFull(date) : '', place ? this.escapeHtml(place) : ''];
                tooltipLines.push(`${mark} ${parts.filter(Boolean).join(', ')}`);
            };
            event('*', person.birthDate, person.birthPlace);
            event('†', person.deathDate, person.deathPlace);

            const age = this.calculateAge(person);
            if (age !== null) {
                tooltipLines.push(`${strings.tooltip.age}: ${age}`);
            }
            const tooltipTrade = this.occupationOf(person);
            if (tooltipTrade) tooltipLines.push(`${strings.events.types.occupation}: ${this.escapeHtml(tooltipTrade)}`);
            // How the registers spell the name — the reason the variants exist.
            if (person.nameVariants?.length) {
                // A short label here: the form's "Other spellings of the name"
                // is a heading, too long for a hover.
                tooltipLines.push(`${strings.tooltip.alsoWritten}: ${this.escapeHtml(person.nameVariants.join(', '))}`);
            }
            if (person.question?.trim()) {
                tooltipLines.push(`❓ ${this.escapeHtml(person.question.trim())}`);
            }
            for (const p of partnerships) {
                const partnerId = p.person1Id === id ? p.person2Id : p.person1Id;
                const partner = DataManager.getPerson(partnerId);
                if (partner) {
                    const partnerName = `${partner.firstName || '?'} ${partner.lastName || ''}`.trim();
                    const statusLabel = strings.partnershipStatus[p.status];
                    const startYear = p.startDate ? ` (${p.startDate.split('-')[0]})` : '';
                    tooltipLines.push(`${statusLabel}: ${this.escapeHtml(partnerName)}${startYear}`);
                }
            }
            if (person.notes) {
                const truncated = person.notes.length > 100 ? person.notes.substring(0, 100) + '...' : person.notes;
                tooltipLines.push(`${strings.tooltip.notes}: ${this.escapeHtml(truncated)}`);
            }
            if (tooltipLines.length > 0 || person.photo) {
                const tooltipPhoto = person.photo ? `<img class="card-tooltip-photo" src="${person.photo}" alt="">` : '';
                html += `<div class="card-tooltip">${tooltipPhoto}${tooltipLines.join('<br>')}</div>`;
            }

            card.innerHTML = html;

            // Attach event listeners for branch tabs - all focus on this person
            const branchTabs = card.querySelectorAll('.branch-tab');
            branchTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.setFocus(id);
                });
            });

            // Attach event listener for relationships icon
            const relIcon = card.querySelector('.rel-link-icon');
            if (relIcon) {
                relIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    UI.showRelationshipsPanel(id);
                });
            }

            // Attach event listener for hidden partners button
            // Since gen >= -1 persons are auto-expanded, remaining badges are for ancestors (gen <= -2)
            // → navigate to that person (setFocus)
            const hiddenPartnersBtn = card.querySelector('.hidden-partners-btn');
            if (hiddenPartnersBtn) {
                hiddenPartnersBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.setFocus(id);
                });
            }

            // Attach event listener for hidden families button → setFocus
            const hiddenFamiliesBtn = card.querySelector('.hidden-families-btn');
            if (hiddenFamiliesBtn) {
                hiddenFamiliesBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.setFocus(id);
                });
            }

            // Attach event listeners to add buttons
            card.querySelectorAll('.add-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = (btn as HTMLElement).dataset.action as 'parent' | 'child' | 'partner' | 'sibling';
                    UI.addRelation(id, action);
                });
            });

            // Attach event listener for cross-tree badge.
            // One match → switch directly. More than one → open a chooser so
            // the user picks which tree to open (no blind cycling).
            const crossTreeBadge = card.querySelector('.cross-tree-badge');
            if (crossTreeBadge && currentTreeId && crossTreeMatches.length > 0) {
                crossTreeBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (crossTreeMatches.length === 1) {
                        UI.switchToTreeAndFocus(crossTreeMatches[0].treeId, crossTreeMatches[0].personId);
                    } else {
                        UI.showCrossTreeChooser(crossTreeMatches, crossTreeBadge as HTMLElement);
                    }
                });
            }

            canvas.appendChild(card);
        }
    }

    /**
     * What this person did. Occupation is an event (it changes over a life:
     * apprentice, journeyman, master), so for a one-line summary take the last
     * one recorded — the trade they ended up with.
     */
    private occupationOf(person: Person): string | null {
        const jobs = (person.events ?? []).filter(e => e.type === 'occupation' && e.note?.trim());
        if (jobs.length === 0) return null;
        return sortLifeEvents(jobs)[jobs.length - 1].note?.trim() ?? null;
    }

    /**
     * Staged long-name fitting against the card's text column. Runs ONCE per
     * render pass (from a single requestAnimationFrame after the cards are in
     * the DOM), never per frame. When the canvas is not measurable yet (hidden
     * or zero width) it retries for a few frames — the only measurability
     * lesson kept from the old fit-tight mechanism.
     *
     * Steps (see the .name-fit-* CSS): 0 = 15px; 1 = 14px then 13px (floor);
     * 2 = two lines (given name / surname, 12.5px) plus the meta shortened to
     * years only; 3 = ellipsis on whichever line still overflows. The full name
     * always stays in the name-text title attribute.
     */
    private fitCardNames(canvas: HTMLElement, attempt = 0): void {
        if (canvas.clientWidth === 0 && attempt < 5) {
            requestAnimationFrame(() => this.fitCardNames(canvas, attempt + 1));
            return;
        }
        const names = canvas.querySelectorAll<HTMLElement>('.person-card .name');
        names.forEach(nameEl => {
            const textEl = nameEl.querySelector<HTMLElement>('.name-text');
            if (!textEl) return;

            const given = textEl.dataset.given ?? '';
            const surname = textEl.dataset.surname ?? '';
            const full = `${given} ${surname}`.trim();

            // Start from a clean single-line state (idempotent across retries).
            nameEl.classList.remove('name-fit-1', 'name-fit-13', 'name-fit-2lines');
            if (textEl.dataset.split === '1') {
                textEl.textContent = full;
                delete textEl.dataset.split;
            }
            const card = nameEl.closest('.person-card');
            const meta = card?.querySelector<HTMLElement>('.birth-date') ?? null;
            if (meta) {
                meta.classList.remove('meta-short');
                if (meta.dataset.full !== undefined) {
                    meta.textContent = meta.dataset.full;
                    delete meta.dataset.full;
                }
            }

            const avail = nameEl.clientWidth;
            if (avail === 0) return;                                 // detached card
            const fits = (): boolean => textEl.scrollWidth <= avail + 0.5;

            if (fits()) return;                                      // step 0: 15px
            nameEl.classList.add('name-fit-1');                      // step 1: 14px
            if (fits()) return;
            nameEl.classList.remove('name-fit-1');
            nameEl.classList.add('name-fit-13');                     // step 1: 13px floor
            if (fits()) return;

            // Compact cards are a single centred line in a 44px box: the two-line
            // step does not apply. Once the 12.5px floor still overflows, the base
            // ellipsis takes over (the compact-scoped .name-fit-* CSS shrinks to
            // that floor at matching specificity).
            if (SettingsManager.getCardDensity() === 'compact') return;

            // Step 2: two lines (break between given name and surname) + years-only meta.
            nameEl.classList.remove('name-fit-13');
            nameEl.classList.add('name-fit-2lines');
            const givenSpan = document.createElement('span');
            givenSpan.className = 'name-line name-given';
            givenSpan.textContent = given;
            const surnameSpan = document.createElement('span');
            surnameSpan.className = 'name-line name-surname';
            surnameSpan.textContent = surname;
            textEl.textContent = '';
            textEl.appendChild(givenSpan);
            textEl.appendChild(surnameSpan);
            textEl.dataset.split = '1';
            if (meta && meta.dataset.years !== undefined) {
                meta.dataset.full = meta.textContent ?? '';
                meta.textContent = meta.dataset.years;
                meta.classList.add('meta-short');
            }
            // Step 3 (ellipsis on an overflowing line) is handled by the
            // .name-line { text-overflow: ellipsis } CSS.
        });
    }

    /** True when the person is currently rendered on the canvas. */
    isVisible(personId: PersonId): boolean {
        return this.positions.has(personId);
    }

    /**
     * Highlight a kinship path: cards on the path glow, the rest dim.
     * Cleared automatically on the next render or by clicking the canvas.
     */
    highlightPath(personIds: PersonId[]): void {
        const ids = new Set(personIds as string[]);
        document.querySelectorAll('.person-card').forEach(card => {
            const el = card as HTMLElement;
            const onPath = el.dataset.id !== undefined && ids.has(el.dataset.id);
            el.classList.toggle('path-highlight', onPath);
            el.classList.toggle('path-dimmed', !onPath);
        });
        const clear = () => {
            document.querySelectorAll('.person-card').forEach(card => {
                card.classList.remove('path-highlight', 'path-dimmed');
            });
            document.removeEventListener('click', clear, true);
        };
        setTimeout(() => document.addEventListener('click', clear, true), 0);
    }

    /**
     * Map a generation offset relative to the focus person to a small-caps label.
     * 0 = focus generation; negative = ancestors (drawn above), positive = descendants.
     */
    private generationLabel(offset: number): string {
        const g = strings.generationLabels;
        switch (offset) {
            case -2: return g.grandparents;
            case -1: return g.parents;
            case 0: return g.focus;
            case 1: return g.children;
            case 2: return g.grandchildren;
            default: return g.generationN(offset);
        }
    }

    /**
     * Draw faint horizontal generation guide rules across the tree. The rules
     * stay in the transformed SVG layer (they pan and zoom with the cards). The
     * band LABELS are no longer drawn here — they live in a fixed HTML overlay
     * (see src/ui/gen-labels.ts) so they stick to the left edge while the tree
     * scrolls underneath. This method records each band's world geometry into
     * `generationBands` for that overlay to project.
     */
    private renderGenerationGuides(svg: SVGSVGElement): void {
        this.generationBands = [];
        if (this.viewMode !== 'family' && this.viewMode !== 'descendants') return;
        if (!this.focusPersonId || this.positions.size === 0) return;
        const focusPos = this.positions.get(this.focusPersonId);
        if (!focusPos) return;
        const step = this.config.cardHeight + this.config.verticalGap;
        if (step <= 0) return;

        // Distinct band tops (Y) and the overall horizontal extent.
        const bandYs = new Set<number>();
        let minX = Infinity, maxX = -Infinity;
        for (const pos of this.positions.values()) {
            bandYs.add(Math.round(pos.y));
            if (pos.x < minX) minX = pos.x;
            if (pos.x + this.config.cardWidth > maxX) maxX = pos.x + this.config.cardWidth;
        }
        if (!isFinite(minX)) return;

        const pad = 48;
        const lineLeft = minX - pad;
        const lineRight = maxX + pad;
        const halfGap = this.config.verticalGap / 2;

        for (const bandY of Array.from(bandYs).sort((a, b) => a - b)) {
            const offset = Math.round((bandY - focusPos.y) / step);
            // Boundary rule just above the band.
            const boundaryY = bandY - halfGap;
            this.drawLine(svg, lineLeft, boundaryY, lineRight, boundaryY, { className: 'gen-guide-line' });
            // Record the band for the sticky HTML label overlay.
            this.generationBands.push({
                label: this.generationLabel(offset),
                rowCenterY: bandY + this.config.cardHeight / 2,
                bandTopY: bandY - halfGap,
                bandBottomY: bandY + this.config.cardHeight + halfGap,
            });
        }
    }

    private renderLines(svg: SVGSVGElement): void {
        // In debug mode with step < 7, don't render lines (only boxes)
        const skipLines = this.debugOptions?.enabled && this.debugOptions.step < 7;

        if (!skipLines) {
            // Generation guides sit behind everything (appended first).
            this.renderGenerationGuides(svg);

            // PHASE 1: Draw spouse lines from layout engine
            // Collect all card X ranges at each Y for gap detection
            const cardGap = 4; // px gap before/after intermediate cards
            for (const spouseLine of this.spouseLines) {
                const partnership = spouseLine.partnershipId
                    ? DataManager.getPartnership(spouseLine.partnershipId)
                    : null;
                const lineStyle = partnership
                    ? this.getLineStyleForStatus(partnership.status)
                    : {};

                // Find intermediate cards that this line passes through
                const gaps: { left: number; right: number }[] = [];
                for (const [personId, pos] of this.positions) {
                    if (personId === spouseLine.person1Id || personId === spouseLine.person2Id) continue;
                    const cardLeft = pos.x;
                    const cardRight = pos.x + this.config.cardWidth;
                    // Card overlaps line's X range and is at same Y (within card height)
                    if (cardRight > spouseLine.xMin && cardLeft < spouseLine.xMax) {
                        const cardCenterY = pos.y + this.config.cardHeight / 2;
                        if (Math.abs(cardCenterY - spouseLine.y) < this.config.cardHeight / 2 + 2) {
                            gaps.push({ left: cardLeft - cardGap, right: cardRight + cardGap });
                        }
                    }
                }

                if (gaps.length === 0) {
                    this.drawLine(svg, spouseLine.xMin, spouseLine.y, spouseLine.xMax, spouseLine.y, lineStyle);
                } else {
                    // Sort gaps by left edge and draw segments between them
                    gaps.sort((a, b) => a.left - b.left);
                    let currentX = spouseLine.xMin;
                    for (const gap of gaps) {
                        if (gap.left > currentX) {
                            this.drawLine(svg, currentX, spouseLine.y, gap.left, spouseLine.y, lineStyle);
                        }
                        currentX = Math.max(currentX, gap.right);
                    }
                    if (currentX < spouseLine.xMax) {
                        this.drawLine(svg, currentX, spouseLine.y, spouseLine.xMax, spouseLine.y, lineStyle);
                    }
                }

            }

            // PHASE 2: Render cluster connections (simple lines, no jump detection)
            // Note: Single-parent children are handled by the layout engine via buildDescendantBlocksFallback
            this.renderClusterConnections(svg);
        }

        // Render debug overlay if enabled (after clearing lines)
        this.renderDebugOverlay(svg);

        // Render pipeline debug overlay if debug mode active
        this.renderPipelineDebugOverlay(svg);
    }

    /**
     * Render connections using bus routing (T-shape layout)
     * Uses pre-calculated connections from layout engine
     *
     * Structure: stem (vertical) → connector (horizontal, at connectorY) →
     *            junction (vertical, connectorY to branchY) → bus (at branchY) → drops
     */
    private renderClusterConnections(svg: SVGSVGElement): void {
        for (const conn of this.connections) {
            // Vertical stem from parent down to connectorY (= stemBottomY)
            this.drawLine(svg, conn.stemX, conn.stemTopY, conn.stemX, conn.connectorY);

            // Horizontal connector from stem to bus junction point (if stem outside bus range)
            if (conn.connectorFromX !== conn.connectorToX) {
                this.drawLine(svg, conn.connectorFromX, conn.connectorY, conn.connectorToX, conn.connectorY);

                // Vertical junction from connectorY to branchY (if connector on different lane)
                if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                    this.drawLine(svg, conn.connectorToX, conn.connectorY, conn.connectorToX, conn.branchY);
                }
            } else {
                // Stem is within bus range - extend stem to branchY if needed
                if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                    this.drawLine(svg, conn.stemX, conn.connectorY, conn.stemX, conn.branchY);
                }
            }

            // Horizontal bus (branch) - only over children
            this.drawLine(svg, conn.branchLeftX, conn.branchY, conn.branchRightX, conn.branchY);

            // Drops to each child - simple vertical lines from bus. The stroke
            // style reflects the parent→child relationship type (adoptive/step/
            // foster); geometry is unchanged.
            for (const drop of conn.drops) {
                this.drawLine(svg, drop.x, conn.branchY, drop.x, drop.bottomY, this.getParentRelDropStyle(drop.personId));
            }
        }
    }

    /**
     * Toggle debug overlay for visual verification of anchor points and junctions
     */
    setDebugOverlay(enabled: boolean): void {
        this.debugOverlay = enabled;
        this.render();
    }

    /**
     * Render pipeline debug overlay with geometry visualization.
     */
    private renderPipelineDebugOverlay(svg: SVGSVGElement): void {
        if (!this.debugOptions?.enabled || !this.currentDebugSnapshot) {
            clearDebugOverlay(svg);
            debugPanel.hide();
            return;
        }

        const snapshot = this.currentDebugSnapshot;

        // Render SVG overlay if geometry is available
        if (snapshot.geometry) {
            renderDebugOverlay(svg, snapshot.geometry);
        }

        // Update debug panel
        debugPanel.update(snapshot, this.debugOptions, this.config);
    }

    /**
     * Render debug overlay showing anchor points on cards and junction points on connections
     */
    private renderDebugOverlay(svg: SVGSVGElement): void {
        if (!this.debugOverlay) return;

        const { cardWidth, cardHeight } = this.config;

        // Anchor points on cards
        for (const [_personId, pos] of this.positions) {
            // topCenter (green) - where connections from parents arrive
            this.drawDebugDot(svg, pos.x + cardWidth / 2, pos.y, '#00FF00');
            // bottomCenter (blue) - where connections to children depart
            this.drawDebugDot(svg, pos.x + cardWidth / 2, pos.y + cardHeight, '#0000FF');
            // leftCenter/rightCenter (yellow) - for spouse lines
            this.drawDebugDot(svg, pos.x, pos.y + cardHeight / 2, '#FFFF00');
            this.drawDebugDot(svg, pos.x + cardWidth, pos.y + cardHeight / 2, '#FFFF00');
        }

        // Spouse line centers (magenta) - where stems should start for couples
        for (const sl of this.spouseLines) {
            const centerX = (sl.xMin + sl.xMax) / 2;
            this.drawDebugDot(svg, centerX, sl.y, '#FF00FF', 5);
        }

        // Junction points on connections (red)
        for (const conn of this.connections) {
            // Stem-to-branch junction
            this.drawDebugDot(svg, conn.stemX, conn.branchY, '#FF0000', 4);
            // Branch-to-drop junctions
            for (const drop of conn.drops) {
                this.drawDebugDot(svg, drop.x, conn.branchY, '#FF0000', 4);
            }
        }
    }

    private drawDebugDot(svg: SVGSVGElement, x: number, y: number, color: string, radius: number = 3): void {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(x));
        circle.setAttribute('cy', String(y));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#000');
        circle.setAttribute('stroke-width', '0.5');
        circle.setAttribute('opacity', '0.8');
        svg.appendChild(circle);
    }

    private getLineStyleForStatus(status: import('./types.js').PartnershipStatus): { dashArray?: string; color?: string } {
        switch (status) {
            case 'divorced':
                return { dashArray: '8,4', color: '#999' };
            case 'separated':
                return { dashArray: '4,4', color: '#999' };
            case 'partners':
                return { dashArray: '2,2' };
            case 'married':
            default:
                return {};
        }
    }

    private drawLine(svg: SVGSVGElement, x1: number, y1: number, x2: number, y2: number, style?: { dashArray?: string; color?: string; className?: string; title?: string }): void {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        if (style?.dashArray) {
            line.setAttribute('stroke-dasharray', style.dashArray);
        }
        if (style?.color) {
            line.setAttribute('stroke', style.color);
        }
        if (style?.className) {
            line.setAttribute('class', style.className);
        }
        if (style?.title) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = style.title;
            line.appendChild(t);
        }
        svg.appendChild(line);
    }

    /**
     * Line style for the vertical drop to a child, based on the child's
     * parent→child relationship type. Adoptive = dashed, step/foster = dotted;
     * colour unchanged. Only the drop's stroke changes — never its geometry.
     */
    private getParentRelDropStyle(childId: PersonId): { dashArray?: string; className: string; title?: string } {
        const child = DataManager.getPerson(childId);
        const types = child?.parentRelTypes ? Object.values(child.parentRelTypes) : [];
        if (types.includes('adoptive')) {
            return { dashArray: '6,4', className: 'child-drop', title: strings.parentRelType.adoptive };
        }
        if (types.includes('step') || types.includes('foster')) {
            const t = types.includes('foster') ? strings.parentRelType.foster : strings.parentRelType.step;
            return { dashArray: '2,3', className: 'child-drop', title: t };
        }
        return { className: 'child-drop' };
    }

    private updateSVGSize(svg: SVGSVGElement): void {
        let maxX = 500;
        let maxY = 500;

        for (const pos of this.positions.values()) {
            maxX = Math.max(maxX, pos.x + this.config.cardWidth + 100);
            maxY = Math.max(maxY, pos.y + this.config.cardHeight + 100);
        }

        svg.setAttribute('width', String(maxX));
        svg.setAttribute('height', String(maxY));
    }

    private formatDateFull(dateStr: string): string {
        const parts = dateStr.split('-');
        if (parts.length !== 3 || parts[1] === '00' || parts[2] === '00') {
            return parts[0]; // year only
        }
        const day = parseInt(parts[2], 10);
        const month = parseInt(parts[1], 10);
        const year = parts[0];
        if (getCurrentLanguage() === 'cs') {
            return `${day}. ${month}. ${year}`;
        }
        return `${month}/${day}/${year}`;
    }

    /**
     * Age at death, or today's age for someone plausibly still alive.
     * Without a death date we must NOT count to today for a historical person —
     * that produced ages like 230. When we can't know, we say nothing.
     */
    private calculateAge(person: Person): number | null {
        if (!person.birthDate) return null;
        if (!person.deathDate && !isLivingPerson(person, new Date().getFullYear())) return null;
        const birthParts = person.birthDate.split('-');
        if (birthParts.length < 1) return null;
        const birthYear = parseInt(birthParts[0], 10);
        if (isNaN(birthYear)) return null;

        let endYear: number;
        let endMonth = 0;
        let endDay = 0;
        if (person.deathDate) {
            const deathParts = person.deathDate.split('-');
            endYear = parseInt(deathParts[0], 10);
            if (isNaN(endYear)) return null;
            endMonth = deathParts.length >= 2 ? parseInt(deathParts[1], 10) : 0;
            endDay = deathParts.length >= 3 ? parseInt(deathParts[2], 10) : 0;
        } else {
            const now = new Date();
            endYear = now.getFullYear();
            endMonth = now.getMonth() + 1;
            endDay = now.getDate();
        }

        const birthMonth = birthParts.length >= 2 ? parseInt(birthParts[1], 10) : 0;
        const birthDay = birthParts.length >= 3 ? parseInt(birthParts[2], 10) : 0;

        let age = endYear - birthYear;
        if (birthMonth && endMonth && (endMonth < birthMonth || (endMonth === birthMonth && endDay < birthDay))) {
            age--;
        }
        return age >= 0 ? age : null;
    }

    // ==================== TIMELINE VIEW ====================

    /** Render the timeline (life-bars on a year axis) into its own container. */
    /** Fan chart: how many rings are drawn; setter re-renders + persists. */
    getFanGenerations(): number {
        return this.fanGenerations;
    }

    setFanGenerations(gens: number): void {
        const v = Math.max(4, Math.min(8, Math.floor(gens)));
        if (v === this.fanGenerations) return;
        this.fanGenerations = v;
        try { localStorage.setItem('strom-fan-generations', String(v)); } catch { /* ignore */ }
        if (this.viewMode === 'fan') this.render();
    }

    /** Render the ancestor fan chart into its container (fan view mode). */
    private renderFan(container: HTMLElement): void {
        // Delegate clicks once: sectors refocus, empty slots add a parent.
        if (!container.dataset.wired) {
            container.dataset.wired = '1';
            container.addEventListener('click', (e) => {
                const el = (e.target as Element).closest('[data-fan-person], [data-fan-add]') as HTMLElement | null;
                if (!el) return;
                if (el.dataset.fanPerson) {
                    this.setFocus(el.dataset.fanPerson as PersonId);
                } else if (el.dataset.fanAdd && !DataManager.isViewMode()) {
                    UI.addRelation(el.dataset.fanAdd as PersonId, 'parent');
                }
            });
            const select = container.querySelector('#fan-gen-select') as HTMLSelectElement | null;
            select?.addEventListener('change', () => this.setFanGenerations(parseInt(select.value, 10)));
        }

        const select = container.querySelector('#fan-gen-select') as HTMLSelectElement | null;
        if (select) select.value = String(this.fanGenerations);

        const chart = container.querySelector('#fan-chart') as HTMLElement | null;
        if (!chart || !this.focusPersonId) return;

        const model = buildFanModel(DataManager.getData(), this.focusPersonId, this.fanGenerations);
        if (!model) { chart.innerHTML = ''; return; }
        chart.innerHTML = buildFanSvg(model, {
            esc: (t) => this.escapeHtml(t),
            editable: !DataManager.isViewMode() && !DataManager.isTreeLocked(),
            addParentLabel: strings.contextMenu.addParent,
            showKekule: SettingsManager.isFanKekuleEnabled(),
        });

        // Mobile: the fan keeps a minimum drawing width and overflows the
        // container — start the view centered on the focus person.
        if (container.scrollWidth > container.clientWidth) {
            container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
        }
    }

    private renderTimeline(container: HTMLElement): void {
        // Delegate bar clicks once (safe against odd person ids in JSON imports).
        if (!container.dataset.wired) {
            container.dataset.wired = '1';
            container.addEventListener('click', (e) => {
                const g = (e.target as Element).closest('[data-person-id]') as HTMLElement | null;
                if (g?.dataset.personId) this.setFocus(g.dataset.personId as PersonId);
            });
        }

        const ids = [...this.positions.keys()] as unknown as string[];
        const todayYear = new Date().getFullYear();
        const model = computeTimelineModel(DataManager.getData(), ids, todayYear);
        const S = strings.timeline;

        const isMobile = window.innerWidth < 500;
        const ROW_H = isMobile ? 28 : 30;
        const LABEL_W = isMobile ? 96 : 160;
        const W = Math.max(320, container.clientWidth || 800);

        const omitted = model.omittedCount > 0
            ? `<div class="tl-omitted">${this.escapeHtml(S.omitted(model.omittedCount))}</div>` : '';
        const empty = model.rows.length === 0
            ? `<div class="tl-omitted">${this.escapeHtml(S.empty)}</div>` : '';

        // The on-screen SVG is built by the shared pure builder (screen mode:
        // CSS classes + foreignObject labels). The poster reuses the same
        // builder in 'poster' mode; see src/timeline-chart.ts.
        const svg = buildTimelineSvg(model, {
            esc: (t) => this.escapeHtml(t),
            width: W,
            rowH: ROW_H,
            labelW: LABEL_W,
            mode: 'screen',
            focusId: this.focusPersonId,
            highlightIds: this.highlightIds ?? null,
        });

        container.innerHTML = `${omitted}${empty}${svg}`;
    }

    private escapeHtml(text: string): string {
        // Must also escape quotes: callers interpolate into HTML attributes.
        return (text || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Public getter for positions (used by export)
    getPositions(): Map<PersonId, Position> {
        return this.positions;
    }

    // Public getter for visible person IDs
    getVisiblePersonIds(): Set<PersonId> {
        return new Set(this.positions.keys());
    }

    /** Generation bands for the sticky label overlay (empty outside family/descendants). */
    getGenerationBands(): GenerationBand[] {
        return this.generationBands;
    }
}

export const TreeRenderer = new TreeRendererClass();
