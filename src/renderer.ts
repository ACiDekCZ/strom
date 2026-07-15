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
import * as CrossTree from './cross-tree.js';
import {
    computeLayout,
    StromLayoutEngine,
    LayoutRequest,
    Connection,
    SpouseLine,
    DisplayPolicy,
    runLayoutPipelineWithDebug,
    collectBloodDescendants,
    DebugOptions,
    DebugSnapshot,
    LayoutDebugContext
} from './layout/index.js';
import { renderDebugOverlay, clearDebugOverlay } from './debug-overlay.js';
import { debugPanel } from './debug-panel.js';
import { yearOf, displayYear, formatFlexDate } from './dates.js';
import { computeTimelineModel, yearToFraction, axisTicks, TimelineRow, TimelineEvent } from './timeline.js';
import { classifyBranches, Branch } from './branch-colors.js';
import { presumedDeceasedSet } from './privacy.js';
import { SettingsManager } from './settings.js';
import { extractSubtree } from './subtree.js';
import { buildFanModel, buildFanSvg } from './fan-chart.js';

class TreeRendererClass {
    private config = DEFAULT_LAYOUT_CONFIG;
    private positions = new Map<PersonId, Position>();

    // Connections for line rendering from layout engine
    private connections: Connection[] = [];

    // Spouse lines from layout engine (only adjacent partners)
    private spouseLines: SpouseLine[] = [];

    // Focus mode state
    private focusPersonId: PersonId | null = null;

    /** Focus navigation history (browser back/forward style), per tree. */
    private focusHistory: PersonId[] = [];
    private focusForward: PersonId[] = [];
    private focusHistoryTreeId: string | null = null;
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
     * no layout pipeline). Persisted per tree in localStorage.
     */
    private viewMode: 'family' | 'descendants' | 'timeline' | 'fan' = 'family';

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

        // Clear previous render
        canvas.querySelectorAll('.person-card').forEach(c => c.remove());
        svg.innerHTML = '';
        this.positions.clear();
        this.connections = [];

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

        // Timeline uses the same person selection but its own SVG layout (the
        // pipeline above only served to pick which persons are visible).
        const timelineContainer = document.getElementById('timeline-container');
        const fanContainer = document.getElementById('fan-container');
        if (this.viewMode === 'timeline' && timelineContainer) {
            canvas.style.display = 'none';
            if (fanContainer) fanContainer.style.display = 'none';
            timelineContainer.style.display = 'block';
            this.renderTimeline(timelineContainer);
            this.updateFocusUI();
            UI.updateViewModeUI?.();
            UI.updateMinimap?.();  // hides the minimap in timeline mode
            return;
        }
        // Fan chart: ancestors-only semicircle, its own SVG (no pipeline).
        if (this.viewMode === 'fan' && fanContainer) {
            canvas.style.display = 'none';
            if (timelineContainer) timelineContainer.style.display = 'none';
            fanContainer.style.display = 'flex';
            this.renderFan(fanContainer);
            this.updateFocusUI();
            UI.updateViewModeUI?.();
            UI.updateMinimap?.();  // hidden in fan mode
            return;
        }
        canvas.style.display = '';
        if (timelineContainer) timelineContainer.style.display = 'none';
        if (fanContainer) fanContainer.style.display = 'none';

        await this.renderCards(canvas);
        this.renderLines(svg);
        this.updateSVGSize(svg);

        // Update focus UI (shows panel with focused person name, generation controls)
        this.updateFocusUI();
        // Keep the view-mode segment + descendants badge in sync.
        UI.updateViewModeUI?.();
        // Refresh the overview minimap for the new layout.
        UI.updateMinimap?.();
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

        // Focus history (browser back/forward). Reset on tree switch. On a
        // NORMAL navigation push the previous focus onto the back stack and
        // clear the forward stack (a new branch). goBack/goForward set
        // suppressHistoryPush so they can manage the stacks themselves.
        const historyTreeId = DataManager.getCurrentTreeId();
        if (this.focusHistoryTreeId !== historyTreeId) {
            this.focusHistory = [];
            this.focusForward = [];
            this.focusHistoryTreeId = historyTreeId;
        } else if (!this.suppressHistoryPush && this.focusPersonId && personId
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

    // ==================== DISPLAY VIEW MODE (family / descendants / timeline / fan) ====================

    getViewMode(): 'family' | 'descendants' | 'timeline' | 'fan' {
        return this.viewMode;
    }

    /**
     * Set + persist the view mode WITHOUT rendering. For callers that follow
     * up with setFocus (which renders) — avoids two overlapping renders.
     */
    presetViewMode(mode: 'family' | 'descendants' | 'timeline' | 'fan'): void {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        this.persistViewMode();
    }

    /** Switch the display view mode and re-render. Persisted per tree. */
    setViewMode(mode: 'family' | 'descendants' | 'timeline' | 'fan'): void {
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
        if (this.viewMode === 'timeline' || this.viewMode === 'fan') return;
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
        this.viewMode = (stored === 'descendants' || stored === 'timeline' || stored === 'fan') ? stored : 'family';
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
        // Don't do cross-tree matching in view mode
        if (DataManager.isViewMode()) return null;

        // Cached per tree (stamped by lastModifiedAt): loading + decrypting
        // every tree's data on every render was a real cost on big setups.
        return CrossTree.getTreesDataForMatching(TreeManager);
    }

    private async renderCards(canvas: HTMLElement): Promise<void> {
        // Pre-compute presumed deceased set
        const presumedDeceased = this.computePresumedDeceased();

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
            // Photo avatar shifts the text right; without a photo the card is
            // rendered exactly as before (no avatar element, no class).
            if (person.photo) {
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
            // Descendants view: de-emphasize step-relatives.
            if (indirectIds?.has(id)) {
                classes += ' indirect';
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
            const isDeceased = presumedDeceased.has(id);

            // Always display person's own lastName (maiden name for women)
            const displaySurname = person.lastName;

            // Format birth date - both full date and year only
            let birthYear = '';
            let birthFull = '';
            if (person.birthDate) {
                birthYear = displayYear(person.birthDate);
                const formatted = formatFlexDate(person.birthDate);
                if (formatted !== birthYear) {
                    birthFull = formatted;
                }
            }

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
                    html += `<button class="branch-tab" data-action="focus-parent">▲<div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenParentsTooltip}</div>${parentItems}</div></button>`;
                }
                if (hasHiddenSiblings) {
                    const hiddenSiblings = siblings.filter(s => !this.positions.has(s.id));
                    const siblingItems = hiddenSiblings.map(s => {
                        const name = `${s.firstName || '?'} ${s.lastName || ''}`.trim();
                        const year = s.birthDate ? s.birthDate.split('-')[0] : '';
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${year}</span>` : ''}</div>`;
                    }).join('');
                    html += `<button class="branch-tab" data-action="focus-sibling">◆<div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenSiblingsTooltip}</div>${siblingItems}</div></button>`;
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
                    html += `<button class="branch-tab" data-action="focus-child">▼<div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenChildrenTooltip}</div>${childItems}</div></button>`;
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
                    html += `<button class="hidden-partners-btn" data-action="focus">+${hiddenPartnersCount}<div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenPartnersTooltip}</div>${partnerItems}</div></button>`;
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
                    html += `<button class="hidden-families-btn" data-action="focus">👨‍👩‍👧<div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenFamiliesTooltip}</div>${hiddenFamilyItems}</div></button>`;
                }
                html += `</div>`;
            }

            const isLocked = DataManager.isPersonLocked(id);

            html += `
                ${person.photo ? `<div class="card-avatar"><img src="${person.photo}" alt=""></div>` : ''}
                <div class="name"><span class="name-text">${this.escapeHtml(displayName)}</span>${isDeceased ? '<span class="deceased-marker">†</span>' : ''}</div>
                <div class="surname">${this.escapeHtml(displaySurname)}</div>
                ${birthYear ? `<div class="birth-date"><span class="date-year">${birthYear}</span>${birthFull ? `<span class="date-full">${birthFull}</span>` : ''}</div>` : ''}
                ${isLocked ? `<span class="lock-icon" title="${strings.lock.lockedTooltip}">&#128274;</span>` : ''}
                ${!isLocked ? `<button class="rel-link-icon" data-action="relationships" title="${strings.buttons.manageRelationships}">&#128279;</button>` : ''}
            `;

            // Add buttons based on context (hidden for locked persons)
            if (!isLocked) {
                // Top: Add parent (if < 2 parents)
                if (person.parentIds.length < 2) {
                    html += `<button class="add-btn top" data-action="parent" title="${strings.contextMenu.addParent}">+</button>`;
                }
                // Right: Add partner
                html += `<button class="add-btn right" data-action="partner" title="${strings.contextMenu.addPartner}">+</button>`;
                // Bottom: Add child
                html += `<button class="add-btn bottom" data-action="child" title="${strings.contextMenu.addChild}">+</button>`;
                // Left: Add sibling
                html += `<button class="add-btn left" data-action="sibling" title="${strings.contextMenu.addSibling}">+</button>`;
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
                        +${crossTreeMatches.length}
                        <div class="cross-tree-tooltip">
                            <div class="cross-tree-tooltip-header">${strings.crossTree.tooltipHeader}</div>
                            ${tooltipItems}
                            ${moreCount > 0 ? `<div class="cross-tree-tooltip-item">...${moreCount} more</div>` : ''}
                            <div class="cross-tree-tooltip-hint">${strings.crossTree.clickToSwitch}</div>
                        </div>
                    </div>`;
                }
            }

            // Build tooltip content
            const tooltipLines: string[] = [];
            if (person.birthDate) {
                const bStr = this.formatDateFull(person.birthDate);
                tooltipLines.push(`* ${bStr}${person.birthPlace ? ', ' + this.escapeHtml(person.birthPlace) : ''}`);
            }
            if (person.deathDate) {
                const dStr = this.formatDateFull(person.deathDate);
                tooltipLines.push(`† ${dStr}${person.deathPlace ? ', ' + this.escapeHtml(person.deathPlace) : ''}`);
            }
            const age = this.calculateAge(person);
            if (age !== null) {
                tooltipLines.push(`${strings.tooltip.age}: ${age}`);
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

            // Attach event listener for cross-tree badge (cycle through trees)
            const crossTreeBadge = card.querySelector('.cross-tree-badge');
            if (crossTreeBadge && currentTreeId && crossTreeMatches.length > 0) {
                crossTreeBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nextMatch = CrossTree.getNextMatch(currentTreeId, id, crossTreeMatches);
                    if (nextMatch) {
                        UI.switchToTreeAndFocus(nextMatch.treeId, nextMatch.personId);
                    }
                });
            }

            canvas.appendChild(card);
        }

        // Fit names on the NEXT frame: measuring immediately can race a
        // concurrent render or catch the canvas mid-layout, leaving some
        // cards unshrunk (reported on a live tree: one card ellipsized at
        // full size while its neighbours were fitted).
        requestAnimationFrame(() => this.fitCardNames(canvas));
    }

    /**
     * Long names: shrink the font (two steps) before falling back to the CSS
     * ellipsis, so full names stay readable on the fixed-size cards. One pass
     * after all cards are in the DOM (needs real text measurements). When the
     * canvas is not measurable yet (hidden / zero width), retry a few frames.
     */
    private fitCardNames(canvas: HTMLElement, attempt = 0): void {
        if (canvas.clientWidth === 0 && attempt < 5) {
            requestAnimationFrame(() => this.fitCardNames(canvas, attempt + 1));
            return;
        }
        const texts = canvas.querySelectorAll<HTMLElement>(
            '.person-card .name-text, .person-card .surname');
        texts.forEach(el => {
            if (el.clientWidth === 0) return;           // detached/hidden card
            el.classList.remove('fit-tight', 'fit-tighter');
            if (el.scrollWidth <= el.clientWidth) return;
            el.classList.add('fit-tight');
            if (el.scrollWidth > el.clientWidth) el.classList.add('fit-tighter');
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

    private renderLines(svg: SVGSVGElement): void {
        // In debug mode with step < 7, don't render lines (only boxes)
        const skipLines = this.debugOptions?.enabled && this.debugOptions.step < 7;

        if (!skipLines) {
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

    private calculateAge(person: Person): number | null {
        if (!person.birthDate) return null;
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
        const TOP = 40;
        const PAD_R = 16;
        const W = Math.max(320, container.clientWidth || 800);
        const plotX0 = LABEL_W;
        const plotW = Math.max(40, W - LABEL_W - PAD_R);
        const H = TOP + model.rows.length * ROW_H + 12;
        const xOf = (year: number) => plotX0 + yearToFraction(year, model.axis) * plotW;

        const grid = axisTicks(model.axis).map(yr => {
            const x = xOf(yr).toFixed(1);
            return `<line x1="${x}" y1="${TOP - 6}" x2="${x}" y2="${H}" class="tl-grid"/>`
                + `<text x="${x}" y="${TOP - 14}" text-anchor="middle" class="tl-tick">${yr}</text>`;
        }).join('');

        const rows = model.rows
            .map((r, i) => this.timelineRowSvg(r, i, TOP, ROW_H, LABEL_W, W, xOf, S))
            .join('');

        const omitted = model.omittedCount > 0
            ? `<div class="tl-omitted">${this.escapeHtml(S.omitted(model.omittedCount))}</div>` : '';
        const empty = model.rows.length === 0
            ? `<div class="tl-omitted">${this.escapeHtml(S.empty)}</div>` : '';

        // Fade-out gradients for bars with an unknown end (deceased, no death date).
        const fadeStops = (color: string) =>
            `<stop offset="0" stop-color="${color}" stop-opacity="0.85"/>`
            + `<stop offset="1" stop-color="${color}" stop-opacity="0"/>`;
        const defs = `<defs>`
            + `<linearGradient id="tl-fade-male" x1="0" y1="0" x2="1" y2="0">${fadeStops('#8fb8de')}</linearGradient>`
            + `<linearGradient id="tl-fade-female" x1="0" y1="0" x2="1" y2="0">${fadeStops('#e8a0bf')}</linearGradient>`
            + `</defs>`;

        container.innerHTML = `${omitted}${empty}`
            + `<svg class="timeline-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`
            + `${defs}${grid}${rows}</svg>`;
    }

    /** SVG for one timeline row (label + life-bar + event dots). */
    private timelineRowSvg(
        r: TimelineRow, i: number, top: number, rowH: number, labelW: number,
        rowWidth: number, xOf: (y: number) => number, S: typeof strings.timeline
    ): string {
        const y = top + i * rowH;
        const barY = y + (rowH - 14) / 2;
        const x1 = xOf(r.startYear), x2 = xOf(r.endYear);
        const w = Math.max(2, x2 - x1);
        const color = r.gender === 'female' ? '#e8a0bf' : '#8fb8de';
        const focused = r.personId === this.focusPersonId ? ' focused' : '';
        const highlight = this.highlightIds
            ? (this.highlightIds.has(r.personId as PersonId) ? ' search-hit' : ' search-dim') : '';

        const nameEsc = this.escapeHtml(r.name);
        const yearsEsc = this.escapeHtml(
            r.isLiving ? `${r.startYear}–` : r.endKnown ? `${r.startYear}–${r.endYear}` : `${r.startYear}–?`);
        const cy = (barY + 7).toFixed(1);
        const dots = r.events.map(ev => {
            const ex = xOf(ev.year).toFixed(1);
            const label = this.escapeHtml(`${this.timelineEventLabel(ev, S)} (${ev.year})`);
            const cls = ev.type === 'wedding' ? 'tl-dot tl-dot-wedding' : 'tl-dot';
            const rad = ev.type === 'wedding' ? 4.5 : 3;
            return `<circle cx="${ex}" cy="${cy}" r="${rad}" class="${cls}"><title>${label}</title></circle>`;
        }).join('');
        const arrow = r.isLiving
            ? `<polygon points="${x2.toFixed(1)},${barY} ${(x2 + 7).toFixed(1)},${(barY + 7).toFixed(1)} ${x2.toFixed(1)},${(barY + 14)}" class="tl-arrow"/>`
            : '';
        // Unknown end: fade the bar out to the right ("we don't know further").
        const fadeW = Math.max(0, Math.min(26, rowWidth - x2 - 2));
        const fade = !r.endKnown && fadeW > 4
            ? `<rect x="${x2.toFixed(1)}" y="${barY}" width="${fadeW.toFixed(1)}" height="14"`
              + ` fill="url(#tl-fade-${r.gender})"/>`
            : '';

        return `<g class="timeline-bar${focused}${highlight}" data-person-id="${this.escapeHtml(r.personId)}">`
            + `<rect x="0" y="${y}" width="${rowWidth}" height="${rowH}" class="tl-rowhit" fill="transparent"/>`
            + `<foreignObject x="2" y="${y}" width="${labelW - 6}" height="${rowH}">`
            + `<div xmlns="http://www.w3.org/1999/xhtml" class="tl-name" title="${nameEsc}">`
            + `<span class="tl-nm">${nameEsc}</span> <span class="tl-yr">${yearsEsc}</span></div></foreignObject>`
            + `<rect x="${x1.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="14" rx="3" fill="${color}" class="tl-bar-rect"/>`
            + `${fade}${arrow}${dots}</g>`;
    }

    private timelineEventLabel(ev: TimelineEvent, S: typeof strings.timeline): string {
        if (ev.type === 'wedding') return S.wedding;
        if (ev.type === 'custom' && ev.customLabel) return ev.customLabel;
        return strings.events.types[ev.type as keyof typeof strings.events.types] ?? String(ev.type);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    // Public getter for positions (used by export)
    getPositions(): Map<PersonId, Position> {
        return this.positions;
    }

    // Public getter for visible person IDs
    getVisiblePersonIds(): Set<PersonId> {
        return new Set(this.positions.keys());
    }
}

export const TreeRenderer = new TreeRendererClass();
