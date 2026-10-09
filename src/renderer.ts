/**
 * TreeRenderer - Rendering of family tree
 * Uses layout module for position computation, handles SVG rendering
 */

import { DataManager } from './data.js';
import { UI } from './ui.js';
import { ZoomPan } from './zoom.js';
import { strings } from './strings.js';
import {
    Person,
    PersonId,
    Position,
    DEFAULT_LAYOUT_CONFIG,
    LayoutConfig,
    TreeId,
    StromData,
    personCardHeight
} from './types.js';
import { TreeManager } from './tree-manager.js';
import { chainLinkSvg, iconSvg } from './icons.js';
import * as CrossTree from './cross-tree.js';
import { ViewMode, STANDALONE_VIEWS, ResearchEdgeMode } from './types.js';
import { cardLines, CardLine, cardLineHtml, cardYears, CardLineStyle, cardDateReferences, cardAge, formatAge, isFieldCardDensity } from './card-fields.js';
import {
    CustomCardMetrics, CardLineRows, CardHead, customCardMetrics, customCardRows, customCardViewHeight, customCardSpouseLineY,
    measureCardTexts, cardFontsPending, CARD_HEAD_HEIGHT, CARD_EDGE_PILL_ROOM,
} from './card-width.js';
import { checkRecordedAge, ageBirthDate } from './recorded-age.js';
import { ACTION_GLYPH, AGENT_DONE_MS, AGENT_DONE_FADE_MS, AGENT_SPIN_MS, CardSignalContext, CardSignalInfo, cardSignalInfo, researchCardInfoNow, sharedPhaseDelay, stateStripesHtml } from './card-signals.js';
import { EvidenceLevel, treeHasAnySource, unionsByPerson } from './evidence-level.js';
import { EdgeView, edgeMoves, edgeNamedOptions, edgeView } from './research-edge.js';
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
    LayoutDebugContext,
    GenerationBand as LayoutBand
} from './layout/index.js';
import { renderDebugOverlay, clearDebugOverlay } from './debug-overlay.js';
import { debugPanel } from './debug-panel.js';
import { yearOf, displayYear, formatFlexDate } from './dates.js';
import { computeTimelineModel } from './timeline.js';
import { buildTimelineSvg } from './timeline-chart.js';
import { sortLifeEvents } from './events.js';
import { classifyBranches, Branch } from './branch-colors.js';
import { presumedDeceasedSet } from './privacy.js';
import { placeList } from './places.js';
import { SettingsManager } from './settings.js';
import { personInitials } from './initials.js';
import { shownName, shownNameParts } from './person-name.js';
import { extractSubtree } from './subtree.js';
import { buildFanModel, buildFanSvg } from './fan-chart.js';
import { computeIndirectIds } from './indirect.js';
import { isMobile as isMobileViewport } from './breakpoints.js';
import { parentRelKind, parentRelDash, connectionDash } from './parent-rel-style.js';
import { isDiagramStandIn } from './layout/pipeline/placeholders.js';
import {
    unionOrderBadges, UnionOrderBadge, hiddenRelativesTabs, HiddenRelativesTab, placeUnionOrderPill, PillPlacement, REL_LINK_ICON_WIDTH,
    viewLineSegments, segmentsNearCard, EDGE_INSET, PillLabel, pillLabelForms, pillLabelWidths,
} from './marriage-order.js';
import { measureUnionOrderPills, measureTabRows, rowKey, unionOrderPillKey, unionOrderPillPartsHtml, pillFontsPending } from './union-order-measure.js';
import { openCardMenuFromKeyboard } from './ui/keyboard-access.js';
import { syncDepthStepper } from './ui/depth-stepper.js';
import {
    ViewLink, ViewLinkCandidate, loadViewLinks, isViewLinksMaster, viewLinksToDraw, viewLinksAvailable, viewLinkContext, viewLinkCandidates,
} from './view-links.js';
import { LineSegment, chainSegments, labelSpot, polylinePath, splitBus } from './view-link-lines.js';
import { maxGenerationsWithSiblings } from './focus-depth.js';
import type { LayoutViewLayer, ViewLineFlag } from './layout/index.js';
import { buildViewLayer } from './layout/index.js';

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
    /** The boundary rule at bandTopY; the overlay breaks it around the band's name. */
    guideLine?: SVGLineElement;
    guideLeftX?: number;  // world X where the rule starts
    guideRightX?: number; // world X where the rule ends
}

/** The custom card's measures for a view: one width, the view's height, each card's own height ("by content"). */
type CustomCardViewMetrics = CustomCardMetrics & { cardHeight: number; personHeights?: Map<PersonId, number> };
/** The card box a layout is made for (the image export and the book draw it). */
type CardBox = Pick<LayoutConfig, 'cardWidth' | 'cardHeight' | 'personHeights' | 'spouseLineY'>;
/** The custom card measured for a set of people (src/card-width.ts): what the cards draw. */
interface CustomCardsMeasure {
    metrics: CustomCardViewMetrics;
    lines: Map<PersonId, CardLine[]>;
    rows: Map<CardLine, CardLineRows>;
    heads: Map<PersonId, CardHead>;
    wrapped: boolean;
    style: CardLineStyle;
    /** The cards measured with room for the pills on their bottom edge. */
    edgeRoomIds: Set<PersonId>;
}
/**
 * What the outputs draw (the poster, the book's tree, the people of the
 * view): the layout without the links "linked in the view only", with the
 * card box measured for the people it holds (a custom card as wide as the
 * longest text of those people, not of a shown family's), without the room
 * the screen keeps for the pills on a card's bottom edge.
 */
interface OutputLayout {
    positions: Map<PersonId, Position>;
    connections: Connection[];
    spouseLines: SpouseLine[];
    box: CardBox;
    custom: CustomCardMetrics | null;
}

/** How a tree line is drawn; `view` marks a line of the view layer (links "linked in the view only"). */
interface LineStyle {
    dashArray?: string;
    color?: string;
    className?: string;
    title?: string;
    view?: ViewLineFlag;
    viewLink?: ViewLink | null;
}

/** How far under a couple's cards (px, to its middle) the label of a partner shown "linked in the view only" sits. */
const VIEW_LABEL_BELOW = 18;
/** The line a child's label leaves showing at both ends of the horizontal stretch it sits on (px, together). */
const VIEW_LABEL_LINE_ENDS = 24;

/** Whether two layouts give each of `ids` the same card box (no new layout needed). */
function sameCardSizes(a: LayoutConfig, b: LayoutConfig, ids: Iterable<PersonId>): boolean {
    if (a.cardWidth !== b.cardWidth || a.cardHeight !== b.cardHeight) return false;
    if (!a.personHeights !== !b.personHeights) return false;
    if (!b.personHeights) return true;
    for (const id of ids) if (personCardHeight(a, id) !== personCardHeight(b, id)) return false;
    return true;
}

class TreeRendererClass {
    private config = DEFAULT_LAYOUT_CONFIG;
    /**
     * The custom card's width, date column and height for the current view
     * (null in other densities); with the height "by content" each drawn
     * person's own card height too (the layout's personHeights).
     */
    private customMetrics: CustomCardViewMetrics | null = null;
    /** The custom card's lines per drawn person, computed once per render. */
    private customLines = new Map<PersonId, CardLine[]>();
    /** The custom card lines' rows (src/card-width.ts customCardRows): what wraps, what is cut. */
    private customRows = new Map<CardLine, CardLineRows>();
    /** The details wrap into rows (not the one-row card): the cards draw the computed rows. */
    private customWrapped = false;
    /** The custom card's line style (marks or labels) the view was measured in. */
    private customStyle: CardLineStyle = 'marks';
    /** The custom card's header per drawn person: the name's rows, the years under it. */
    private customHeads = new Map<PersonId, CardHead>();
    /**
     * The cards measured with room for pills on their bottom edge (a card of
     * details as tall as its content grows by CARD_EDGE_PILL_ROOM, so the
     * pills cover no text); the image export draws no pills and leaves it out.
     */
    private edgeRoomIds = new Set<PersonId>();
    /** The other trees the last cards were matched against (the ⇄ pill); the next measure reads them. */
    private lastCrossTrees: Map<TreeId, { name: string; data: StromData }> | null = null;
    /** The last render was the one more render asked for by pills measured otherwise (never twice in a row). */
    private edgeRoomRetried = false;
    /** The render that asks for that one more render once it is done. */
    private edgeRoomRerenderSeq = -1;
    private positions = new Map<PersonId, Position>();

    /** Generation bands for the sticky label overlay (rebuilt each render). */
    private generationBands: GenerationBand[] = [];
    /** The layout's generation bands (LayoutResult.bands): each as tall as its tallest card. */
    private layoutBands: LayoutBand[] = [];

    // Connections for line rendering from layout engine
    private connections: Connection[] = [];
    /**
     * Links "linked in the view only" the current render laid out (null:
     * none — another view, the feature not available, the main switch off).
     */
    private viewLayer: LayoutViewLayer | null = null;
    /** The live bridge the tree follows, for whether the view links are available (null: from the data alone). */
    private viewLinksBridge: (() => { features: readonly string[] | null } | null) | null = null;
    /** The current render's layout without the view links (outputs, the people of the view), made when first asked. */
    private outputLayoutCache: { seq: number; output: OutputLayout } | null = null;
    /** The browser prints the tree: laid out without the view links until it is done (setPrinting). */
    private printing = false;
    /** The focus depth before the print, given back after it. */
    private printDepth: { up: number; down: number } | null = null;
    /** The research edge above each drawn person that has one (per render). */
    private edgeViews = new Map<PersonId, EdgeView>();
    /** The lines that exist only in the view, per link, gathered while the lines are drawn (drawn hollow after them). */
    private virtualSegments = new Map<ViewLink | null, LineSegment[]>();
    /** Where each link's label goes when not on its line's segments (a `partners` link: under the couple). */
    private viewLabelSpots = new Map<ViewLink, { x: number; y: number }>();

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
    /** People the last live-research change touched: 'live-changed' glow. */
    private changedIds: Set<PersonId> | null = null;
    /** "Show in tree" from tree health: these people stand out, the rest dims. Not kept over a reload. */
    private evidenceIds: Set<PersonId> | null = null;
    /** The Evidence mode: every card framed by its level (null: off). */
    private evidenceLevelMap: Map<PersonId, EvidenceLevel> | null = null;
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
    /** Incremented per render; stale async renders bail out (see renderInternal). */
    private renderSeq = 0;
    /** Signature of the last places datalist, to skip rebuilding it unchanged. */
    private placesDatalistSig: string | null = null;

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
        // Sequence token: a newer render started while this one awaited must
        // win, or both append their cards to the same canvas (duplicates).
        const seq = ++this.renderSeq;
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
        this.layoutBands = [];
        this.viewLayer = null;
        this.outputLayoutCache = null;

        const persons = DataManager.getAllPersons();
        // The first render knows whether the tree is empty: the welcome may show now.
        document.documentElement.classList.remove('app-booting');
        if (persons.length === 0) {
            if (empty) empty.style.display = 'block';
            this.focusPersonId = null;
            this.updateFocusUI();
            UI.updateViewLinksIndicator?.();
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
        const size = SettingsManager.getCardSize();
        // Detailed, Register and Custom draw lines of details (their fields: effectiveCardFields).
        const fieldCards = SettingsManager.getEffectiveCardFields(density);
        const custom = !!fieldCards && !STANDALONE_VIEWS.includes(this.viewMode);
        // The custom card is as wide as the view's longest text and (details
        // that wrap) as tall as its tallest card: start from the size the last
        // view had (usually the same), measure once laid out.
        // With the height "by content" every card is its own height (the last
        // view's, the view's tallest for one not measured yet), cards top-aligned in their band.
        const { lines: valueLines, years, height: heightMode } = fieldCards ?? SettingsManager.getCardFields();
        const ownHeights = custom && heightMode === 'content';
        const spouseLineY = custom ? customCardSpouseLineY(valueLines, years, heightMode) : undefined;
        this.config = {
            ...this.config, ...size, spouseLineY, personHeights: undefined,
            ...(custom && this.customMetrics ? { cardWidth: this.customMetrics.cardWidth, cardHeight: this.customMetrics.cardHeight } : {}),
            ...(ownHeights && this.customMetrics?.personHeights ? { personHeights: this.customMetrics.personHeights } : {}),
        };
        document.body.dataset.cardDensity = density;
        // The cards of details share one look (index.html body[data-card-fields]).
        if (fieldCards) document.body.dataset.cardFields = '';
        else delete document.body.dataset.cardFields;
        // The partner line (and the "+ partner" pill) at the header of a card that grows.
        if (spouseLineY !== undefined) {
            document.body.dataset.cardSpouseLine = 'head';
            document.body.style.setProperty('--card-head-line', `${spouseLineY}px`);
        } else delete document.body.dataset.cardSpouseLine;
        // The custom card's height follows how many lines it shows.
        document.body.style.setProperty('--card-custom-h', `${this.config.cardHeight}px`);
        this.updatePlacesDatalist();
        // Links "linked in the view only": the Family and Descendants views lay them out as if real.
        const viewLinks = this.currentViewLinks();
        let result = this.computeTreeLayout(descendantsOnly, viewLinks);
        if (custom) {
            const metrics = this.measureCustomCards(result.positions);
            this.customMetrics = metrics;
            document.body.style.setProperty('--card-custom-w', `${metrics.cardWidth}px`);
            document.body.style.setProperty('--card-custom-h', `${metrics.cardHeight}px`);
            document.body.style.setProperty('--card-date-col', `${metrics.dateColumn}px`);
            document.body.style.setProperty('--card-label-col', `${metrics.labelColumn ?? 0}px`);
            // The settings preview states the card size: keep it in step with the view.
            if (document.getElementById('settings-modal')?.classList.contains('active')) UI.renderCardPreview?.();
            const measured: LayoutConfig = {
                ...this.config, cardWidth: metrics.cardWidth, cardHeight: metrics.cardHeight,
                personHeights: metrics.personHeights,
            };
            if (!sameCardSizes(this.config, measured, result.positions.keys())) {
                // The person set does not depend on the card size: lay out again at the measured size.
                this.config = measured;
                result = this.computeTreeLayout(descendantsOnly, viewLinks);
            } else this.config = measured;
            // Measured before the card fonts were in: measure again once they are.
            cardFontsPending()?.then(() => {
                if (seq === this.renderSeq && isFieldCardDensity(SettingsManager.getCardDensity())) this.render();
            });
        } else {
            this.customMetrics = null;
            this.edgeRoomIds.clear();
            this.customLines.clear();
            this.customRows.clear();
            this.customHeads.clear();
            this.customWrapped = false;
        }

        // Apply layout result
        this.positions = result.positions;
        this.connections = result.connections;
        this.spouseLines = result.spouseLines;
        this.layoutBands = result.bands ?? [];
        this.viewLayer = result.viewLayer ?? null;

        // Timeline, fan and map show the same person selection drawn their own
        // way, in their own container (the pipeline above only served to pick
        // which persons are visible). Everything else uses the tree canvas.
        const standalone: Partial<Record<ViewMode, { id: string; display: string; draw: (el: HTMLElement) => void }>> = {
            timeline: { id: 'timeline-container', display: 'block', draw: el => this.renderTimeline(el) },
            fan: { id: 'fan-container', display: 'flex', draw: el => this.renderFan(el) },
            map: { id: 'map-container', display: 'block', draw: el => UI.renderMapView?.(el) },
        };
        const active = standalone[this.viewMode];
        // Chrome that belongs to some views only (the evidence pill) reads it here.
        document.body.dataset.viewMode = this.viewMode;
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
                UI.updateViewLinksIndicator?.();  // none outside the Family and Descendants views
                return;
            }
        }

        canvas.style.display = '';

        const current = await this.renderCards(canvas, seq);
        if (!current) return;
        this.renderLines(svg);
        this.renderEdgeLinks(svg, canvas);
        this.renderViewLinkLabels(canvas);
        this.renderViewLinkIslands(canvas);
        this.updateSVGSize(svg);
        // Fit long names once, after the cards are in the DOM and measurable.
        // Printing: now, the page is printed before the next frame.
        if (this.printing) this.fitCardNames(canvas);
        else requestAnimationFrame(() => this.fitCardNames(canvas));

        // Update focus UI (shows panel with focused person name, generation controls)
        this.updateFocusUI();
        // Keep the view-mode segment + descendants badge in sync.
        UI.updateViewModeUI?.();
        // Refresh the overview minimap for the new layout.
        UI.updateMinimap?.();
        // Rebuild the sticky generation-label overlay for the new layout.
        UI.updateGenLabels?.();
        // "Linked in the view only · n" over the view, the open list in step.
        UI.updateViewLinksIndicator?.();
        // Pills on a bottom edge came out otherwise than measured: once more at their size.
        if (this.edgeRoomRerenderSeq === seq && seq === this.renderSeq) this.render();
    }

    /**
     * Lay out the current view at the current card size (this.config), with
     * the given links "linked in the view only" laid out as if real (none:
     * the tree as it is — the outputs). `debug`: the pipeline's debug mode
     * may take it (the screen's layout only). `config`: another card size
     * (the outputs' custom card, measured for their own people).
     */
    private computeTreeLayout(descendantsOnly: boolean, viewLinks: readonly ViewLink[] = [], debug = true,
        config: LayoutConfig = this.config): ReturnType<typeof computeLayout> {
        const request: LayoutRequest = {
            data: DataManager.getData(),
            focusPersonId: this.focusPersonId!,
            policy: {
                ancestorDepth: descendantsOnly ? 0 : this.focusDepthUp,
                descendantDepth: this.focusDepthDown,
                includeAuntsUncles: !descendantsOnly,
                includeCousins: !descendantsOnly
            },
            config,
            displayPolicy: {
                mode: this.showAllPartnerships ? 'expanded' : 'standard',
                autoExpand: this.showAllPartnerships,
                expandLineageOnly: descendantsOnly && !this.isDescendantsFullFamilies()
            },
            ...(viewLinks.length > 0 ? { viewLinks } : {}),
        };

        // Use debug pipeline if debug mode is enabled
        if (debug && this.debugOptions?.enabled) {
            const debugResult = runLayoutPipelineWithDebug(
                {
                    data: request.data,
                    focusPersonId: request.focusPersonId,
                    config: request.config,
                    ancestorDepth: request.policy.ancestorDepth,
                    descendantDepth: request.policy.descendantDepth,
                    includeSpouseAncestors: false,
                    includeParentSiblings: request.policy.includeAuntsUncles,
                    includeParentSiblingDescendants: request.policy.includeCousins,
                    viewLinks: request.viewLinks
                },
                this.debugOptions
            );

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
            return debugResult.result;
        }
        const engine = new StromLayoutEngine();
        if (debug) this.currentDebugSnapshot = null;
        return computeLayout(engine, request);
    }

    // ==================== LINKED IN THE VIEW ONLY ====================

    /**
     * The links "linked in the view only" the current view draws: only the
     * Family and Descendants views, the feature available for the tree, the
     * main switch on, each record drawn and switched on (src/view-links.ts).
     * None while the browser prints.
     */
    private currentViewLinks(): ViewLink[] {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || this.printing) return [];
        return viewLinksToDraw(DataManager.getData(), {
            viewMode: this.viewMode,
            links: loadViewLinks(treeId),
            master: isViewLinksMaster(treeId),
            bridge: this.viewLinksBridge?.() ?? null,
        });
    }

    /** Whether "linked in the view only" shows for the tree at all (its data, the live bridge's features). */
    viewLinksOffered(): boolean {
        return viewLinksAvailable(DataManager.getData(), this.viewLinksBridge?.() ?? null);
    }

    /**
     * Draw again after a change of the stored view links (never a change of
     * the data: no undo step, nothing to send). The focus depth that reached
     * as far as it could keeps doing so (a shown family adds generations);
     * it is not written into the tree. Measured against what the last
     * drawing laid out, so a change already stored (another window, a
     * bridge's answer) counts the same.
     */
    async refreshViewLinks(change: () => void): Promise<void> {
        const focus = this.focusPersonId;
        const before = focus ? maxGenerationsWithSiblings(this.viewData(this.viewLayer?.links ?? []), focus) : null;
        change();
        if (focus && before) {
            const after = this.maxGenerations(focus);
            this.focusDepthUp = this.focusDepthUp >= before.up ? after.up : Math.min(this.focusDepthUp, after.up);
            this.focusDepthDown = this.focusDepthDown >= before.down ? after.down : Math.min(this.focusDepthDown, after.down);
        }
        await this.renderInternal();
    }

    /** The live bridge the tree follows (its /status features), for whether the view links show at all. */
    setViewLinksBridge(provider: (() => { features: readonly string[] | null } | null) | null): void {
        this.viewLinksBridge = provider;
    }

    /**
     * What the current render laid out of the links "linked in the view
     * only": the links, the ghosts (people of the shown families), the data
     * the layout saw. Null: nothing shown. The drawn lines carry their own
     * flag (Connection.view, ChildDrop.view, SpouseLine.view).
     */
    getViewLayer(): LayoutViewLayer | null {
        return this.viewLayer;
    }

    /** The data the view is laid out from: with the drawn view links applied, else the tree's. */
    private viewData(links: readonly ViewLink[] = this.currentViewLinks()): StromData {
        return buildViewLayer(DataManager.getData(), links)?.data ?? DataManager.getData();
    }

    /** How far the focus depth reaches from a person in the current view (the view links count in). */
    private maxGenerations(personId: PersonId): { up: number; down: number } {
        return maxGenerationsWithSiblings(this.viewData(), personId);
    }

    /**
     * The current render laid out without the view links: what the outputs
     * draw and what "the people in the view" are (export of the view, a tree
     * from the view, sharing, the presentation). The screen's own layout when
     * no link is shown. A custom card is measured again for the people laid
     * out (the screen's is as wide as a shown family's longest text too), as
     * the screen would measure it without the links.
     */
    private outputLayout(): OutputLayout {
        if (!this.viewLayer || !this.focusPersonId) {
            return {
                positions: this.positions, connections: this.withoutEdgeRoom(this.connections, this.edgeRoomIds),
                spouseLines: this.spouseLines, box: this.posterBox(this.config, this.edgeRoomIds), custom: this.customMetrics,
            };
        }
        if (this.outputLayoutCache?.seq === this.renderSeq) return this.outputLayoutCache.output;
        const descendantsOnly = this.viewMode === 'descendants';
        let config = this.config;
        let result = this.computeTreeLayout(descendantsOnly, [], false, config);
        let custom: CustomCardMetrics | null = null;
        let edgeRoomIds = new Set<PersonId>();
        if (this.customMetrics) {
            const measured = this.customCardsOf(result.positions);
            const next: LayoutConfig = {
                ...config, cardWidth: measured.metrics.cardWidth, cardHeight: measured.metrics.cardHeight,
                personHeights: measured.metrics.personHeights,
            };
            // The person set does not depend on the card size: once more at the measured size.
            if (!sameCardSizes(config, next, result.positions.keys())) result = this.computeTreeLayout(descendantsOnly, [], false, next);
            config = next;
            custom = measured.metrics;
            edgeRoomIds = measured.edgeRoomIds;
        }
        const output: OutputLayout = {
            positions: result.positions, connections: this.withoutEdgeRoom(result.connections, edgeRoomIds),
            spouseLines: result.spouseLines, box: this.posterBox(config, edgeRoomIds), custom,
        };
        this.outputLayoutCache = { seq: this.renderSeq, output };
        return output;
    }

    /** A line that starts at the bottom of a card drawn without its pills' room starts that much higher. */
    private withoutEdgeRoom(connections: Connection[], edgeRoomIds: ReadonlySet<PersonId>): Connection[] {
        return edgeRoomIds.size === 0 ? connections : connections.map(c =>
            c.stemPersonId && edgeRoomIds.has(c.stemPersonId) ? { ...c, stemTopY: c.stemTopY - CARD_EDGE_PILL_ROOM } : c);
    }

    /** The card box of a layout as the image export draws it: without the room kept for the pills on a bottom edge. */
    private posterBox(config: LayoutConfig, edgeRoomIds: ReadonlySet<PersonId>): CardBox {
        const { cardWidth, cardHeight, personHeights, spouseLineY } = config;
        const box: CardBox = { cardWidth, cardHeight, ...(personHeights ? { personHeights } : {}), ...(spouseLineY !== undefined ? { spouseLineY } : {}) };
        if (!personHeights || edgeRoomIds.size === 0) return box;
        const heights = new Map(personHeights);
        for (const id of edgeRoomIds) {
            const h = heights.get(id);
            if (h !== undefined) heights.set(id, h - CARD_EDGE_PILL_ROOM);
        }
        return { ...box, personHeights: heights };
    }

    /**
     * The browser prints the tree (beforeprint / afterprint): while it does,
     * the view is laid out without the links "linked in the view only" — no
     * ghosts, no hole where they stood — and drawn as before afterwards.
     * Done within the event (the render's only wait, the other trees' data
     * for the ⇄ pill, is cached by then). Nothing when no link is shown.
     */
    setPrinting(on: boolean): Promise<void> {
        if (on === this.printing || (on && !this.viewLayer)) return Promise.resolve();
        this.printing = on;
        // The depth reaching the shown generations comes back with them (the
        // print's render clamps it to the tree's own).
        if (on) this.printDepth = { up: this.focusDepthUp, down: this.focusDepthDown };
        else if (this.printDepth) {
            this.focusDepthUp = this.printDepth.up;
            this.focusDepthDown = this.printDepth.down;
            this.printDepth = null;
        }
        return this.renderInternal();
    }

    /** The link a ghost card, or a line between these people, belongs to (null: none). */
    private viewLinkOf(...ids: PersonId[]): ViewLink | null {
        const layer = this.viewLayer;
        if (!layer) return null;
        for (const link of layer.links) {
            if (ids.includes(link.anchorId) && ids.some(id => link.islandIds.includes(id))) return link;
        }
        // A line down to a link's anchor (the shown parents' drop).
        for (const link of layer.links) {
            if (link.kind === 'child' && ids.includes(link.anchorId)) return link;
        }
        for (const id of ids) {
            const link = layer.ghostOf.get(id);
            if (link) return link;
        }
        return null;
    }

    /**
     * The custom card's lines for every drawn person (kept for the cards), the
     * width and date column they need, their rows at that width and the
     * view's card height (src/card-width.ts).
     */
    private measureCustomCards(positions: Map<PersonId, Position>): CustomCardViewMetrics {
        const measured = this.customCardsOf(positions);
        this.customLines = measured.lines;
        this.customRows = measured.rows;
        this.customWrapped = measured.wrapped;
        this.customStyle = measured.style;
        this.customHeads = measured.heads;
        this.edgeRoomIds = measured.edgeRoomIds;
        return measured.metrics;
    }

    /** The custom card measured for the people of a layout (the screen's or an output's), nothing kept. */
    private customCardsOf(positions: Map<PersonId, Position>): CustomCardsMeasure {
        const data = DataManager.getData();
        const fields = SettingsManager.getEffectiveCardFields() ?? SettingsManager.getCardFields();
        // The years under the name say "1841 †" for one presumed dead, as the detailed card.
        const presumed = fields.years ? this.computePresumedDeceased() : null;
        const lines = new Map<PersonId, CardLine[]>();
        const ids: PersonId[] = [];
        const entries = [];
        for (const id of positions.keys()) {
            const person = DataManager.getPerson(id);
            if (!person) continue;
            const personLines = person.isPlaceholder ? [] : cardLines(person, data, fields);
            lines.set(id, personLines);
            ids.push(id);
            entries.push({
                name: shownName(person, '?'), avatar: !person.isPlaceholder, lines: personLines,
                ...(presumed ? { years: cardYears(person, presumed.has(id)) } : {}),
            });
        }
        // The chosen width's cap (narrow / medium / wide); the poster takes this width too.
        // The date column at most as wide as the language's ordinary dates; a longer date goes its own way.
        const metrics = customCardMetrics(entries, measureCardTexts, fields.widthCap, fields.lines, fields.style,
            cardDateReferences(fields.fullDate));
        const { rows, heights, heads } = customCardRows(entries, metrics, measureCardTexts, fields.lines, fields.style);
        const measured = {
            lines, rows, wrapped: fields.lines !== 1, style: fields.style,
            heads: new Map(ids.map((id, i) => [id, heads[i]])), edgeRoomIds: new Set<PersonId>(),
        };
        if (fields.height === 'content') {
            // Each card as tall as its own content; the view's height is its tallest
            // (a band with no card, the CSS default). A card with pills on its
            // bottom edge grows by their room, so they cover no text.
            const visible = (pid: PersonId) => positions.has(pid);
            ids.forEach((id, i) => {
                const pills = this.bottomEdgePills(id, visible, this.lastCrossTrees);
                if (pills.left || pills.right) {
                    measured.edgeRoomIds.add(id);
                    heights[i] += CARD_EDGE_PILL_ROOM;
                }
            });
            let tallest = CARD_HEAD_HEIGHT;
            for (const h of heights) tallest = Math.max(tallest, h);
            return { ...measured, metrics: { ...metrics, cardHeight: tallest, personHeights: new Map(ids.map((id, i) => [id, heights[i]])) } };
        }
        return { ...measured, metrics: { ...metrics, cardHeight: customCardViewHeight(fields.on.length, fields.lines, heights, fields.years) } };
    }

    /** The custom card's width and date column of the drawn view (null in other densities). */
    getCustomCardMetrics(): CustomCardMetrics | null {
        return this.customMetrics;
    }

    /**
     * The card box the drawn view is laid out with; with the height "by
     * content" each drawn person's own height (personHeights) and the partner
     * line's offset, so the image export draws every card as the screen does.
     */
    getCardBox(): CardBox {
        const { cardWidth, cardHeight, personHeights, spouseLineY } = this.config;
        return { cardWidth, cardHeight, ...(personHeights ? { personHeights } : {}), ...(spouseLineY !== undefined ? { spouseLineY } : {}) };
    }

    /**
     * The card box the image export and the book draw: their own layout's
     * (outputLayout: the screen's when no link is shown), without the room a
     * card measured with pills on its bottom edge keeps (no pills there).
     */
    getPosterCardBox(): CardBox {
        return this.outputLayout().box;
    }

    /** The custom card's width and columns the image export and the book draw (null in other densities). */
    getPosterCardMetrics(): CustomCardMetrics | null {
        return this.outputLayout().custom;
    }

    /** A drawn person's card height: its own ("by content"), else the view's. */
    private cardHeightOf(id: PersonId): number {
        return personCardHeight(this.config, id);
    }

    /**
     * A person's partners not drawn in the view (the ∞ pill) and the
     * partnerships with children whose partner is not drawn (the ⌂ pill: a
     * step family the view leaves out). An empty "?" stand-in is never drawn
     * (T11), so it counts as neither.
     */
    private hiddenPartnersAndFamilies(id: PersonId, visible: (pid: PersonId) => boolean): {
        partners: Person[]; families: import('./types.js').Partnership[];
    } {
        const data = DataManager.getData();
        const partners = DataManager.getAllPartners(id).filter(p => !isDiagramStandIn(data, p.id) && !visible(p.id));
        const families = DataManager.getPartnerships(id).filter(p => {
            const partnerId = p.person1Id === id ? p.person2Id : p.person1Id;
            return !visible(partnerId) && p.childIds.length > 0 && !isDiagramStandIn(data, partnerId);
        });
        return { partners, families };
    }

    /**
     * Whether a card carries pills on its bottom edge: on the left ∞ hidden
     * partners or ⌂ hidden families (not in the descendants chart, which hides
     * relatives by design), on the right ⇄ the person in other trees.
     */
    private bottomEdgePills(id: PersonId, visible: (pid: PersonId) => boolean,
        crossTrees: Map<TreeId, { name: string; data: StromData }> | null): { left: boolean; right: boolean } {
        const person = DataManager.getPerson(id);
        if (!person) return { left: false, right: false };
        let left = false;
        if (this.viewMode !== 'descendants') {
            const hidden = this.hiddenPartnersAndFamilies(id, visible);
            left = hidden.partners.length > 0 || hidden.families.length > 0;
        }
        const treeId = DataManager.getCurrentTreeId();
        const right = !!crossTrees && !!treeId && !person.isPlaceholder
            && CrossTree.findCrossTreeMatches(treeId, person, crossTrees).length > 0;
        return { left, right };
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
                const maxGen = this.maxGenerations(this.focusPersonId);
                this.focusDepthUp = maxGen.up;
            }
            if (startupFocus.depthDown !== undefined) {
                this.focusDepthDown = startupFocus.depthDown;
            } else {
                const maxGen = this.maxGenerations(this.focusPersonId);
                this.focusDepthDown = maxGen.down;
            }
        } else {
            // Fall back to first person
            this.focusPersonId = this.findDefaultFocusPerson();
            if (this.focusPersonId) {
                const maxGen = this.maxGenerations(this.focusPersonId);
                this.focusDepthUp = maxGen.up;
                this.focusDepthDown = maxGen.down;
            }
        }
    }

    // Public Focus Mode API
    /**
     * `reveal`: instead of centring the focused card after the render, call
     * this (it moves the view itself). Resolves once drawn and placed.
     */
    setFocus(personId: PersonId | null, saveToData = true, reveal?: (id: PersonId) => void): Promise<void> {
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
            const maxGen = this.maxGenerations(personId);
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
        return this.renderInternal().then(() => {
            this.updateFocusUI();
            if (this.viewMode === 'descendants') {
                this.centerForViewMode();
            } else if (focusId && reveal) {
                reveal(focusId);
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
    private navigateHistory(from: PersonId[], to: PersonId[]): Promise<void> {
        while (from.length > 0) {
            const target = from.pop()!;
            if (DataManager.getPerson(target)) {
                if (this.focusPersonId) to.push(this.focusPersonId);
                this.suppressHistoryPush = true;
                try {
                    return this.setFocus(target);
                } finally {
                    this.suppressHistoryPush = false;
                }
            }
        }
        this.updateNavButtons();
        return Promise.resolve();
    }

    /** Navigate to the previous focus (browser back); resolves once the view is drawn and placed. */
    goBack(): Promise<void> {
        return this.navigateHistory(this.focusHistory, this.focusForward);
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
        const places = placeList(DataManager.getData());
        // Rebuilding the datalist on every render is wasted DOM work; only
        // refresh it when the place list actually changed.
        const sig = places.map(p => p.display).join('\u0001');
        if (sig === this.placesDatalistSig && list.childElementCount === places.length) return;
        this.placesDatalistSig = sig;
        list.innerHTML = places
            .map(p => `<option value="${this.escapeHtml(p.display)}"></option>`)
            .join('');
    }

    /** Number of visible (non-placeholder) persons — used by the descendants badge. Nobody seen only through a view link counts. */
    getVisiblePersonCount(): number {
        let count = 0;
        for (const id of this.outputLayout().positions.keys()) {
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
        for (const id of this.outputLayout().positions.keys()) {
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
        // An empty set is an active search with no match: dim everything.
        // Only null (no search) clears the highlight.
        this.highlightIds = ids;
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

    /**
     * Mark the people a live research change just touched ('live-changed').
     * Pass null to clear. Class toggling only; re-applied on every render.
     */
    setChangedIds(ids: Set<PersonId> | null): void {
        this.changedIds = ids && ids.size > 0 ? ids : null;
        document.querySelectorAll('.person-card').forEach(el => {
            const card = el as HTMLElement;
            const id = card.dataset.id as PersonId | undefined;
            card.classList.toggle('live-changed', !!(id && this.changedIds?.has(id)));
        });
    }

    /**
     * "Where evidence is missing → Show in tree": the people in `ids` get a
     * dashed frame, everyone else dims (cards and fan sectors). Null ends it.
     * Class toggling only; re-applied on every render.
     */
    setEvidenceHighlight(ids: Set<PersonId> | null): void {
        this.evidenceIds = ids;
        this.applyEvidenceHighlight();
    }

    /** The Evidence mode: each card framed by its level (full / partial / none); null ends it. */
    setEvidenceLevels(levels: Map<PersonId, EvidenceLevel> | null): void {
        this.evidenceLevelMap = levels;
        this.applyEvidenceHighlight();
    }

    getEvidenceHighlight(): ReadonlySet<PersonId> | null {
        return this.evidenceIds;
    }

    private applyEvidenceHighlight(): void {
        const mark = (el: Element, id: string | null | undefined): void => {
            el.classList.remove('evidence-hit', 'evidence-dim');
            if (!this.evidenceIds || !id) return;
            el.classList.add(this.evidenceIds.has(id as PersonId) ? 'evidence-hit' : 'evidence-dim');
        };
        document.querySelectorAll<HTMLElement>('.person-card').forEach(card => {
            mark(card, card.dataset.id);
            card.classList.remove('evl-full', 'evl-partial', 'evl-none');
            const level = card.dataset.id ? this.evidenceLevelMap?.get(card.dataset.id as PersonId) : undefined;
            if (level) card.classList.add(`evl-${level}`);
        });
        document.querySelectorAll<HTMLElement>('[data-fan-person]').forEach(seg => mark(seg, seg.dataset.fanPerson));
        document.body.classList.toggle('evidence-mode', !!this.evidenceIds || !!this.evidenceLevelMap);
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
        // Descendants badge depth (↓ only — the chart forces ancestorDepth=0).
        const descDepthDown = document.getElementById('descendants-depth-down') as HTMLSelectElement | null;

        if (!focusControls) return;

        // Get toolbar-focus element for tablet view
        const toolbarFocus = document.querySelector('.toolbar-focus') as HTMLElement | null;

        // Hide everything if there are no persons in the tree
        const totalCount = DataManager.getAllPersons().length;
        if (totalCount === 0) {
            focusControls.classList.add('hidden');
            document.body.classList.remove('has-focus-panel');
            if (toolbarFocus) toolbarFocus.style.display = 'none';
            if (toolbarFocusName) toolbarFocusName.textContent = '';
            if (toolbarFocusCount) toolbarFocusCount.textContent = '';
            return;
        }

        // Show toolbar-focus if it was hidden (and we have persons)
        if (toolbarFocus) toolbarFocus.style.display = '';

        if (this.focusPersonId) {
            const person = DataManager.getPerson(this.focusPersonId);
            const displayName = person ? shownName(person) : '?';

            // Update floating focus controls
            if (focusName) {
                focusName.textContent = displayName;
            }
            // Update toolbar focus (tablet)
            if (toolbarFocusName) {
                toolbarFocusName.textContent = displayName;
            }

            // Update person count (visible / total) — people, not the "?" stand-ins for unknown parents.
            // Nobody seen only through a link "linked in the view only": the counts are the tree's.
            const isPerson = (id: PersonId): boolean => !DataManager.getPerson(id)?.isPlaceholder;
            const visibleCount = [...this.outputLayout().positions.keys()].filter(isPerson).length;
            const countText = strings.focus.personCount(visibleCount, DataManager.getAllPersons().filter(p => !p.isPlaceholder).length);

            if (focusCount) {
                focusCount.textContent = countText;
            }
            if (toolbarFocusCount) {
                toolbarFocusCount.textContent = countText;
            }

            // Update generation select options based on available data
            const maxGen = this.maxGenerations(this.focusPersonId);
            this.updateGenerationSelect(depthUpSelect, maxGen.up, this.focusDepthUp);
            this.updateGenerationSelect(depthDownSelect, maxGen.down, this.focusDepthDown);
            // Also update toolbar selects
            this.updateGenerationSelect(toolbarDepthUp, maxGen.up, this.focusDepthUp);
            this.updateGenerationSelect(toolbarDepthDown, maxGen.down, this.focusDepthDown);
            // Descendants badge depth select (mirrors focus-depth-down).
            this.updateGenerationSelect(descDepthDown, maxGen.down, this.focusDepthDown);

            focusControls.classList.remove('hidden');
            // The phone draws the tree under the panel row (CSS).
            document.body.classList.add('has-focus-panel');
        } else {
            focusControls.classList.add('hidden');
            document.body.classList.remove('has-focus-panel');
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

        // The visible "− n +" stepper fronting this (hidden) select.
        syncDepthStepper(select);
    }

    exportFocusedData(): void {
        if (!this.focusPersonId) return;

        // The people of the view as laid out (layout algorithm determines
        // visibility via selectFocusSubgraph), nobody seen only through a
        // link "linked in the view only"
        const visibleIds = this.getVisiblePersonIds();

        DataManager.exportFocusedJSON(visibleIds);
    }

    /**
     * Current layout geometry (positions/connections/spouse lines) for the
     * poster export, the book and the minimap. Empty when nothing is rendered.
     * The outputs lay out WITHOUT the links "linked in the view only" (their
     * own layout of the view; `includeView: true` — the minimap — takes the
     * screen's, ghosts and all).
     */
    getPosterLayout(opts: { includeView?: boolean } = {}): { positions: Map<PersonId, Position>; connections: Connection[]; spouseLines: SpouseLine[] } {
        if (!opts.includeView) {
            const { positions, connections, spouseLines } = this.outputLayout();
            return { positions, connections, spouseLines };
        }
        return {
            positions: this.positions,
            connections: this.withoutEdgeRoom(this.connections, this.edgeRoomIds),
            spouseLines: this.spouseLines,
        };
    }

    /**
     * The focus depth the outputs name (the poster's footer): the view's, at
     * most as far as the tree itself reaches — a shown family's generations
     * count on screen only.
     */
    getOutputFocusDepth(): { up: number; down: number } {
        const focus = this.focusPersonId;
        if (!this.viewLayer || !focus) return { up: this.focusDepthUp, down: this.focusDepthDown };
        const max = maxGenerationsWithSiblings(DataManager.getData(), focus);
        return { up: Math.min(this.focusDepthUp, max.up), down: Math.min(this.focusDepthDown, max.down) };
    }

    /**
     * Get focused data as StromData object (for creating new tree from focus)
     */
    getFocusedData(): import('./types.js').StromData | null {
        if (!this.focusPersonId || this.positions.size === 0) return null;
        // Shared, self-consistent slice logic (glue + cleaned relations +
        // pruned sources) — same as "make a tree from this view".
        // Nobody seen only through a link "linked in the view only".
        return extractSubtree(DataManager.getData(), this.getVisiblePersonIds());
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

    /** Returns false when a newer render superseded this one during the await. */
    private async renderCards(canvas: HTMLElement, seq: number): Promise<boolean> {
        // Get all trees for cross-tree matching (only if not in view mode)
        const allTrees = await this.getAllTreesForCrossTreeMatching();
        if (seq !== this.renderSeq) return false;
        // Clear again after the await: nothing may have been added in between,
        // but a card left by an interrupted render must never survive.
        canvas.querySelectorAll('.person-card').forEach(c => c.remove());
        const currentTreeId = DataManager.getCurrentTreeId();

        // Optional branch colouring: classify once per render (never in timeline).
        // A link "linked in the view only" stands as if real: the family it shows takes its branch.
        const layoutData = this.viewLayer?.data ?? DataManager.getData();
        const branchMap: Map<PersonId, Branch> | null =
            (SettingsManager.isBranchColorsEnabled() && this.viewMode !== 'timeline' && this.focusPersonId)
                ? classifyBranches(layoutData, this.focusPersonId)
                : null;

        // Descendants / family views de-emphasize context-only people (step-
        // relatives, or in-laws shown only for context). The membership rule is
        // shared verbatim with the poster export via computeIndirectIds — the
        // single source of truth for the `indirect` set. Descendants view also
        // keeps the blood set for the badge count.
        this.bloodDescendantIds = null;
        let indirectIds: Set<PersonId> | null = null;
        if (this.focusPersonId && (this.viewMode === 'descendants' || this.viewMode === 'family')) {
            const data = DataManager.getData();
            if (this.viewMode === 'descendants') {
                this.bloodDescendantIds = collectBloodDescendants(data, this.focusPersonId);
            }
            // The family a view link shows is no context-only relative: read as laid out.
            indirectIds = computeIndirectIds(layoutData, this.focusPersonId, this.viewMode, this.positions.keys());
        }

        // Persons that are a child of some partnership (the layout engine only
        // treats those as siblings) — computed once, not per card.
        const partnershipChildIds = new Set<PersonId>();
        for (const p of Object.values(DataManager.getData().partnerships)) {
            for (const cid of p.childIds) partnershipChildIds.add(cid);
        }
        // Deceased cue without a death date (same rule as the poster export).
        const presumedDeceased = this.computePresumedDeceased();
        // At-a-glance signals (evidence, story, action badge): shared context.
        const signalCtx = this.signalContext();
        this.edgeViews = this.computeEdgeViews(signalCtx);
        const edgeAll = this.researchEdgeMode() === 'all';
        const edgeMotion = this.researchEdgeMotion();
        canvas.querySelectorAll('.edge-link-pill, .view-link-label').forEach(el => el.remove());
        // The agent's arcs turn in step (one phase for every card, kept across redraws).
        const spinDelay = sharedPhaseDelay(AGENT_SPIN_MS, document.timeline?.currentTime as number ?? performance.now());
        const renderedAt = Date.now();
        this.observeTreeOnScreen();
        // The lines of details the card type draws (Detailed, Register, Custom), null for Compact and Normal.
        const cardFields = SettingsManager.getEffectiveCardFields();
        // The next measure reads the other trees the cards are matched against now (the ⇄ pill).
        this.lastCrossTrees = allTrees;
        // Cards of details as tall as their content were measured with room for
        // the pills on their bottom edge; a card whose pills came out otherwise
        // (the other trees were not read yet) asks for one more render.
        const measuresEdgeRoom = !!this.customMetrics?.personHeights;
        let edgeRoomStale = false;
        // Marriage-order pills (T13): one per union, at most one per card, at
        // the corner pointing to the person whose marriages it counts; laid
        // out with the card's top-edge tabs (placeUnionOrderPill).
        const orderBadges = unionOrderBadges(DataManager.getData(),
            { positions: this.positions, spouseLines: this.spouseLines }, DataManager.getData(), this.focusPersonId);
        const orderSlots = this.unionOrderSlots(orderBadges, partnershipChildIds, signalCtx);

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
            if (this.changedIds?.has(id)) classes += ' live-changed';
            // A person of a family shown "linked in the view only" (the hook of its look: package C).
            const ghostOf = this.viewLayer?.ghostIds.has(id) ? this.viewLayer.ghostOf.get(id) : undefined;
            if (ghostOf) classes += ' view-ghost';
            if (this.evidenceIds) classes += this.evidenceIds.has(id) ? ' evidence-hit' : ' evidence-dim';
            const evl = this.evidenceLevelMap?.get(id);
            if (evl) classes += ` evl-${evl}`;
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
            const signals = cardSignalInfo(person, signalCtx);
            if (signals.action || signals.showAgent || signals.doneSince !== null) classes += ' has-signal';
            card.className = classes;
            card.style.left = pos.x + 'px';
            card.style.top = pos.y + 'px';
            // The height "by content": the card's own height (top-aligned in its band).
            if (this.config.personHeights) card.style.setProperty('--card-custom-h', `${this.cardHeightOf(id)}px`);
            card.dataset.id = id;
            if (ghostOf) {
                card.dataset.viewGhost = '';
                card.dataset.viewHypo = ghostOf.hypo;
                card.dataset.viewVariant = ghostOf.variant;
            }

            card.onclick = (e) => {
                // A long-press just opened the bottom sheet — swallow this click.
                if (card.dataset.suppressClick) { delete card.dataset.suppressClick; return; }
                const target = e.target as HTMLElement;
                if (target.classList.contains('add-btn') || target.classList.contains('branch-tab')) return;
                // Don't open context menu when clicking on badge buttons or their children
                if (target.closest('.hidden-partners-btn') || target.closest('.hidden-families-btn')) return;
                // The badge opens what it signals (touch: the person menu, which leads with it).
                const badge = target.closest<HTMLElement>('.card-signal');
                if (badge && !window.matchMedia?.('(pointer: coarse)').matches) {
                    e.stopPropagation();
                    UI.openCardSignal(id, badge.dataset.signal ?? '');
                    return;
                }
                UI.showContextMenu(id, e);
            };

            // Keyboard (review S37): the card is a button; Enter / Space open
            // the same person menu as a click. setAttribute keeps the name
            // plain text (never parsed as HTML).
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', this.cardAriaLabel(person, signals));
            card.addEventListener('keydown', (e) => {
                if (e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                openCardMenuFromKeyboard(card);
            });

            // Touch: long-press opens the mobile bottom sheet (coarse pointer only).
            UI.attachCardLongPress(card, id);

            // The name as shown: the given name with the title before it, the
            // person's own lastName (maiden name for women) with the title
            // after it (src/person-name.ts) — the two lines of a split name.
            const { given: displayName, surname: displaySurname } = shownNameParts(person, '?');

            // Birth year for the card meta row (the year range replaces the dagger).
            const birthYear = person.birthDate ? displayYear(person.birthDate) : '';

            // Hidden partners (not in the visible/rendered set) and hidden
            // families (a partnership with children whose partner is not
            // visible: a step family the view leaves out).
            const partnerships = DataManager.getPartnerships(id);
            const hidden = this.hiddenPartnersAndFamilies(id, pid => this.positions.has(pid));
            const hiddenPartnersCount = hidden.partners.length;
            const hiddenFamiliesCount = hidden.families.length;

            // Hidden parents, siblings (children of a union, as the layout
            // counts them) or children: a branch tab each (one rule with the
            // marriage-order pill's layout, src/marriage-order.ts).
            const hiddenTabs = hiddenRelativesTabs(DataManager.getData(), id, pid => this.positions.has(pid), partnershipChildIds);
            const hasHiddenParents = hiddenTabs.includes('parents');
            const hasHiddenChildren = hiddenTabs.includes('children');
            const hasHiddenSiblings = hiddenTabs.includes('siblings');
            const siblings = hasHiddenSiblings ? DataManager.getSiblings(id).filter(s => partnershipChildIds.has(s.id)) : [];

            let html = '';

            // The descendants chart hides relatives BY DESIGN — "hidden relative"
            // badges would be noise there, and their click action (re-focus)
            // changes nothing inside the filtered view. Skip them entirely.
            const showHiddenBadges = this.viewMode !== 'descendants';

            // Branch tabs (top-right edge slot): one pill per hidden direction.
            // Built into a string here; assembled into the edge container below.
            let branchTabsHtml = '';
            if (showHiddenBadges && (hasHiddenParents || hasHiddenChildren || hasHiddenSiblings)) {
                if (hasHiddenParents) {
                    const hiddenParents = person.parentIds
                        .filter(pid => !this.positions.has(pid))
                        .map(pid => DataManager.getPerson(pid))
                        .filter((p): p is Person => p !== null);
                    const parentItems = hiddenParents.map(p => {
                        const name = shownName(p, '?');
                        const year = displayYear(p.birthDate);
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${this.escapeHtml(year)}</span>` : ''}</div>`;
                    }).join('');
                    branchTabsHtml += `<button class="branch-tab" data-action="focus-parent"><span class="pill-glyph">◂</span><span class="pill-text">${strings.focus.branchTabParents}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenParentsTooltip}</div>${parentItems}</div></button>`;
                }
                if (hasHiddenSiblings) {
                    const hiddenSiblings = siblings.filter(s => !this.positions.has(s.id));
                    const siblingItems = hiddenSiblings.map(s => {
                        const name = shownName(s, '?');
                        const year = displayYear(s.birthDate);
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${this.escapeHtml(year)}</span>` : ''}</div>`;
                    }).join('');
                    branchTabsHtml += `<button class="branch-tab" data-action="focus-sibling"><span class="pill-glyph">◆</span><span class="pill-text">${strings.focus.branchTabSiblings}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenSiblingsTooltip}</div>${siblingItems}</div></button>`;
                }
                if (hasHiddenChildren) {
                    const hiddenChildren = person.childIds
                        .filter(cid => !this.positions.has(cid))
                        .map(cid => DataManager.getPerson(cid))
                        .filter((c): c is Person => c !== null);
                    const childItems = hiddenChildren.map(c => {
                        const name = shownName(c, '?');
                        const year = displayYear(c.birthDate);
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${this.escapeHtml(year)}</span>` : ''}</div>`;
                    }).join('');
                    branchTabsHtml += `<button class="branch-tab" data-action="focus-child"><span class="pill-glyph">▸</span><span class="pill-text">${strings.focus.branchTabChildren}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenChildrenTooltip}</div>${childItems}</div></button>`;
                }
            }

            // Hidden relationship indicators (bottom-left edge slot): ∞ partners, ⌂ families.
            // Gen >= -1 persons are auto-expanded, so these only appear for ancestors (gen <= -2).
            let hiddenIndicatorsHtml = '';
            if (showHiddenBadges && (hiddenPartnersCount > 0 || hiddenFamiliesCount > 0)) {
                if (hiddenPartnersCount > 0) {
                    // Build rich tooltip with list of hidden partners
                    const partnerItems = hidden.partners.map(p => {
                        const name = shownName(p, '?');
                        const year = displayYear(p.birthDate);
                        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${this.escapeHtml(year)}</span>` : ''}</div>`;
                    }).join('');
                    hiddenIndicatorsHtml += `<button class="hidden-partners-btn" data-action="focus"><span class="pill-glyph">∞</span><span class="pill-count">${hiddenPartnersCount}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenPartnersTooltip}</div>${partnerItems}</div></button>`;
                }
                if (hiddenFamiliesCount > 0) {
                    // Build rich tooltip with hidden families (partner + children)
                    const hiddenFamilyItems = hidden.families
                        .map(p => {
                            const pid = p.person1Id === id ? p.person2Id : p.person1Id;
                            const partner = DataManager.getPerson(pid);
                            const partnerName = partner ? shownName(partner, '?') : '?';
                            const partnerYear = displayYear(partner?.birthDate);
                            const childLabels = p.childIds
                                .map(cid => DataManager.getPerson(cid))
                                .filter((c): c is Person => c !== null)
                                .map(c => {
                                    const name = shownName(c, '?');
                                    const year = displayYear(c.birthDate);
                                    return this.escapeHtml(name) + (year ? ` *${this.escapeHtml(year)}` : '');
                                });
                            return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(partnerName)}</span>${partnerYear ? `<span class="badge-tooltip-detail"> *${this.escapeHtml(partnerYear)}</span>` : ''}<div class="badge-tooltip-detail">${childLabels.join(', ')}</div></div>`;
                        }).join('');
                    hiddenIndicatorsHtml += `<button class="hidden-families-btn" data-action="focus"><span class="pill-glyph">⌂</span><span class="pill-count">${hiddenFamiliesCount}</span><div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenFamiliesTooltip}</div>${hiddenFamilyItems}</div></button>`;
                }
            }

            const isLocked = DataManager.isPersonLocked(id);

            // Density decides what fits: compact = names only (no avatar/meta),
            // normal = avatar + name + life-year meta; detailed, register and
            // custom = the avatar, the name and a line per detail (their fields).
            const density = SettingsManager.getCardDensity();
            const customLines = cardFields
                ? (this.customLines.get(id)
                    ?? (person.isPlaceholder ? [] : cardLines(person, DataManager.getData(), cardFields)))
                : null;
            if (customLines?.length) {
                card.setAttribute('aria-label',
                    [this.cardAriaLabel(person, signals), ...customLines.map(l => l.spoken)].join(', '));
            }
            // A ghost says last that it stands here only in the view.
            if (ghostOf) card.setAttribute('aria-label', `${card.getAttribute('aria-label') ?? ''}. ${strings.viewLinks.aria}`);
            // Placeholders are a dashed frame with no avatar (nothing to depict).
            const showAvatar = density !== 'compact' && !person.isPlaceholder;
            const showPhoto = showAvatar && !!person.photo;

            // Full name on one row (never shrunk — overflow ellipsizes).
            const fullName = `${displayName} ${displaySurname}`.trim();
            // Avatar initials (first name + surname, never a title), used when there is no photo.
            const initials = personInitials(person.firstName, person.lastName) || '?';

            // Meta row (row 2): life-year range. The year range carries the
            // "deceased" cue (the † dagger is gone from the name row): a dead
            // person reads "1902 – 1968", a living one "* 1958".
            const deathYear = person.deathDate ? displayYear(person.deathDate) : '';
            let metaYears = '';
            const presumedDead = !person.isPlaceholder && presumedDeceased.has(id);
            if (deathYear) metaYears = `${birthYear || '?'} – ${deathYear}`;
            else if (birthYear) metaYears = presumedDead ? `${birthYear} †` : `* ${birthYear}`;
            else if (presumedDead) metaYears = '†';
            const metaPlace = person.birthPlace?.trim() ?? '';
            // Normal cards pack "years · place" onto one ellipsized meta row.
            const metaText = [metaYears, metaPlace].filter(Boolean).join(' · ');

            // Person status: quiet stripes in the card's bottom-right corner, in
            // every density (decoration; the tooltip and aria-label say it).
            const stateHtml = stateStripesHtml(
                signals.showEvidence && signals.evidence ? signals.evidence.level : null,
                signals.showStory ? signals.story : null);
            // The action badge on the avatar's corner (a dot on the card's
            // corner where there is no avatar, or when zoomed far out). Without
            // a badge: the agent's arc circling the avatar (a small ring at the
            // card's corner), or the check once it is done with the person.
            const signalLabel = signals.action ? this.signalText(signals, signals.action) : '';
            let badgeHtml = '';
            let dotHtml = '';
            if (signals.action) {
                badgeHtml = `<button type="button" class="card-signal signal-${signals.action}" data-signal="${signals.action}" aria-label="${this.escapeHtml(signalLabel)}">${ACTION_GLYPH[signals.action]}</button>`;
                dotHtml = `<span class="card-signal-dot signal-${signals.action}" aria-hidden="true"></span>`;
            } else if (signals.showAgent) {
                badgeHtml = `<span class="card-agent" style="animation-delay:${spinDelay}" aria-hidden="true"></span>`;
                dotHtml = `<span class="card-agent-dot" style="animation-delay:${spinDelay}" aria-hidden="true"></span>`;
            } else if (signals.doneSince !== null) {
                const since = Math.min(renderedAt - signals.doneSince, AGENT_DONE_MS + AGENT_DONE_FADE_MS);
                const fade = `animation-delay:-${Math.max(0, since)}ms`;
                badgeHtml = `<span class="card-signal card-done" style="${fade}" aria-hidden="true">✓</span>`;
                dotHtml = `<span class="card-signal-dot card-done" style="${fade}" aria-hidden="true"></span>`;
            }

            const avatarInner = showPhoto
                ? `<img src="${this.escapeHtml(person.photo ?? '')}" alt="">`
                : `<span class="avatar-initials">${this.escapeHtml(initials)}</span>`;
            const avatarHtml = showAvatar
                ? `<div class="card-avatar-wrap"><div class="card-avatar">${avatarInner}</div>${badgeHtml}</div>` : '';
            const nameAttrs = `title="${this.escapeHtml(fullName)}" data-given="${this.escapeHtml(displayName)}" data-surname="${this.escapeHtml(displaySurname)}"`;
            const nameHtml = `<div class="name"><span class="name-text" ${nameAttrs}>${this.escapeHtml(fullName)}</span></div>`;
            const head = customLines ? this.customHeads.get(id) : undefined;

            // Custom: the avatar and the name (and the years under it) on one
            // row, then one line per chosen event (src/card-fields.ts). When
            // details may wrap, a long name takes the two rows computed with
            // the card's height (src/card-width.ts), as the image export does.
            html += customLines ? `
                <div class="card-body card-body--custom">
                    <div class="card-head">${avatarHtml}<div class="card-head-text">${head && this.customWrapped
                        ? `<div class="name name--rows"><span class="name-text" ${nameAttrs}>${head.name.map(r =>
                            `<span class="name-row">${this.escapeHtml(r)}</span>`).join('')}</span></div>`
                        : nameHtml}${head?.years ? `<div class="card-years">${this.escapeHtml(head.years)}</div>` : ''}</div></div>
                    <div class="card-lines${this.customWrapped ? ' card-lines--rows' : ''}">${customLines.map(l => {
                        const rows = this.customRows.get(l);
                        return cardLineHtml(l, t => this.escapeHtml(t), !!rows?.cut, this.customWrapped ? rows : undefined, this.customStyle,
                            !!rows?.longDate);
                    }).join('')}</div>
                </div>` : `
                ${avatarHtml}
                <div class="card-body">
                    ${nameHtml}
                    ${density !== 'compact' && metaText ? `<div class="birth-date" data-years="${this.escapeHtml(metaYears)}"><span class="meta-text">${this.escapeHtml(metaText)}</span></div>` : ''}
                </div>
            `;
            // The lock, the status stripes and the corner dot: on every card type, the custom one too (N34).
            html += `${isLocked ? `<span class="lock-icon" title="${strings.lock.lockedTooltip}">${iconSvg('lock', { size: 10 })}</span>` : ''}${stateHtml}${dotHtml}`;

            // Chain-link "relations" tab — lives in the top-right edge slot,
            // to the LEFT of the branch tabs so those (always visible, pinned to
            // the card's right corner) never shift when the chain appears or
            // expands on hover.
            const chainHtml = !isLocked
                ? `<button class="rel-link-icon" data-action="relationships" title="${strings.buttons.manageRelationships}" aria-label="${strings.buttons.manageRelationships}"><span class="rel-link-glyph">${chainLinkSvg({ stroke: 'currentColor', size: 11, strokeWidth: 3 })}</span><span class="rel-link-label">${strings.card.relTab}</span></button>`
                : '';

            // Add tabs (hidden for locked persons). Each rests as a small circle
            // and expands into a labelled pill on hover. The former left "sibling"
            // tab is retired — the action stays available in the context menu.
            const addTab = (dir: string, action: string, title: string, label: string): string =>
                `<button class="add-btn ${dir}" data-action="${action}" title="${title}">`
                + `<span class="add-btn-glyph">+</span>`
                + `<span class="add-btn-label">${label}</span></button>`;
            const parentAddHtml = (!isLocked && person.parentIds.length < 2)
                ? addTab('top', 'parent', strings.contextMenu.addParent, strings.card.addTabParent) : '';
            const partnerAddHtml = !isLocked
                ? addTab('right', 'partner', strings.contextMenu.addPartner, strings.card.addTabPartner) : '';
            const childAddHtml = !isLocked
                ? addTab('bottom', 'child', strings.contextMenu.addChild, strings.card.addTabChild) : '';

            // Cross-tree badge (bottom-right edge slot) if the person exists elsewhere.
            let crossTreeMatches: CrossTree.CrossTreeMatch[] = [];
            let crossTreeHtml = '';
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

                    crossTreeHtml = `<div class="cross-tree-badge" data-person-id="${this.escapeHtml(id)}" title="${strings.crossTree.badgeTitle(crossTreeMatches.length)}">
                        <span class="pill-glyph">⇄</span><span class="pill-count">${crossTreeMatches.length}</span>
                        <div class="cross-tree-tooltip">
                            <div class="cross-tree-tooltip-header">${strings.crossTree.tooltipHeader}</div>
                            ${tooltipItems}
                            ${moreCount > 0 ? `<div class="cross-tree-tooltip-item">${strings.crossTree.moreMatches(moreCount)}</div>` : ''}
                            <div class="cross-tree-tooltip-hint">${strings.crossTree.clickToSwitch}</div>
                        </div>
                    </div>`;
                }
            }

            // The marriage-order pill (T13), where placeUnionOrderPill put it:
            // on the edge at the left corner (the "+ parent" tab appears
            // beside it on hover), on the edge just inside the branch tabs
            // pinned to the right corner, or above the tabs.
            const orderBadge = orderBadges.get(id);
            const orderSlot = orderSlots.get(id);
            const orderHtml = orderBadge && orderSlot ? this.unionOrderPillHtml(orderBadge, orderSlot.label) : '';
            const leftOrderHtml = orderSlot?.row === 'edge' && orderBadge!.side === 'left' ? orderHtml : '';
            const rightOrderHtml = orderSlot?.row === 'edge' && orderBadge!.side === 'right' ? orderHtml : '';
            if (orderSlot) card.classList.add(orderSlot.row === 'edge' ? 'has-order-edge' : 'has-order-above');

            // Assemble one flex container per card edge. Containers are
            // pointer-events:none (children re-enable auto) so the gaps between
            // pills never steal a click meant for the card.
            if (leftOrderHtml || parentAddHtml) html += `<div class="card-edge edge-top-left">${leftOrderHtml}${parentAddHtml}</div>`;
            if (chainHtml || rightOrderHtml || branchTabsHtml) html += `<div class="card-edge edge-top-right">${chainHtml}${rightOrderHtml}${branchTabsHtml}</div>`;
            // Above the tabs: placed from the card's padding edge (the border inside the box).
            if (orderSlot?.row === 'above') html += `<div class="card-edge edge-top-above" style="left:${(orderSlot.x - orderSlot.border).toFixed(2)}px">${orderHtml}</div>`;
            if (hiddenIndicatorsHtml) {
                html += `<div class="card-edge edge-bottom-left">${hiddenIndicatorsHtml}</div>`;
                // The pills reach 9 px into the card: a card of details is measured taller for them.
                card.classList.add('has-edge-bl');
            }
            if (crossTreeHtml) {
                html += `<div class="card-edge edge-bottom-right">${crossTreeHtml}</div>`;
                // The pill reaches 9 px into the card: the status stripes rise above it.
                card.classList.add('has-edge-br');
            }
            // A card of details measured with the pills' room keeps its text above them (index.html .has-edge-room).
            if (this.edgeRoomIds.has(id)) card.classList.add('has-edge-room');
            if (measuresEdgeRoom && this.edgeRoomIds.has(id) !== !!(hiddenIndicatorsHtml || crossTreeHtml)) edgeRoomStale = true;
            // The research edge above the card (a stub, or a label by the dashed line to the parents).
            const edge = this.edgeViews.get(id);
            if (edge) {
                html += this.researchEdgeHtml(id, edge, edgeAll, edgeMotion);
                card.classList.add('has-research-edge');
            }
            const island = edgeAll && !person.isPlaceholder ? person.research?.island : undefined;
            if (island) {
                card.classList.add('research-island');
                // A ghost stands in the tree: no "outside the tree" under it.
                if (!ghostOf) html += `<div class="island-caption">${this.escapeHtml(strings.researchEdge.islandCaption(island.size, island.held ?? 0))}</div>`;
            }
            if (partnerAddHtml) html += `<div class="card-edge edge-right-center">${partnerAddHtml}</div>`;
            if (childAddHtml) html += `<div class="card-edge edge-bottom-center">${childAddHtml}</div>`;

            // Default hover tooltip (round 6): a fixed 5-part structure —
            //   1. full name (serif)
            //   2. * birth date, place
            //   3. † death date, place (age)   [deceased only]
            //   4. ∞ primary partner · N children   [when either exists]
            //   5. footer: the real card gesture
            // Date and place are shown independently: knowing the village but not
            // the date is ordinary in parish work (a damaged register, an entry
            // not yet found). The tooltip is skipped entirely when there is no
            // life detail to show (a bare name gets no hover card).
            const ttBirthDate = person.birthDate ? this.formatDateFull(person.birthDate) : '';
            const ttBirthPlace = person.birthPlace?.trim() ?? '';
            let ttBirthLine = '';
            if (ttBirthDate || ttBirthPlace) {
                ttBirthLine = `* ${[ttBirthDate, ttBirthPlace].filter(Boolean).join(', ')}`;
            } else {
                // No birth recorded, only the baptism (the register's own entry).
                const baptism = sortLifeEvents((person.events ?? []).filter(e => e.type === 'baptism' && (e.date || e.place)))[0];
                if (baptism) {
                    const bits = [baptism.date ? this.formatDateFull(baptism.date) : '', baptism.place?.trim() ?? ''];
                    ttBirthLine = `≈ ${strings.card.ttBaptized(bits.filter(Boolean).join(', '), person.gender)}`;
                }
            }

            const ttDeathDate = person.deathDate ? this.formatDateFull(person.deathDate) : '';
            const ttDeathPlace = person.deathPlace?.trim() ?? '';
            let ttDeathLine = '';
            if (ttDeathDate || ttDeathPlace) {
                const ttAge = cardAge(person);
                // The plural follows the number said last ("55–58 years").
                const agePart = ttAge !== null
                    ? ` ${strings.tooltip.yearsOld(ttAge.max ?? ttAge.years, formatAge(ttAge))}` : '';
                ttDeathLine = `† ${[ttDeathDate, ttDeathPlace].filter(Boolean).join(', ')}${agePart}`;
            }
            // The cause after a dot; the age the register gave only when it
            // differs from the dates — a lead worth seeing (src/recorded-age.ts).
            const ttCause = person.deathCause?.trim() ?? '';
            if (ttCause) ttDeathLine = ttDeathLine ? `${ttDeathLine} · ${ttCause}` : `† ${ttCause}`;
            const ttRecorded = person.deathAge?.trim()
                && checkRecordedAge(person.deathAge, ageBirthDate(person), person.deathDate)?.differs
                ? strings.fields.ageRecorded(person.deathAge.trim()) : '';

            // Relationship summary: the primary (first) partnership's partner and
            // the person's total children count. Either alone is enough to show.
            let ttRelLine = '';
            let ttPartnerName = '';
            const primaryPartnership = partnerships[0];
            if (primaryPartnership) {
                const ppid = primaryPartnership.person1Id === id ? primaryPartnership.person2Id : primaryPartnership.person1Id;
                const pp = DataManager.getPerson(ppid);
                if (pp) ttPartnerName = shownName(pp, '?');
            }
            const ttChildCount = person.childIds.length;
            if (ttPartnerName || ttChildCount > 0) {
                const bits: string[] = [];
                if (ttPartnerName) bits.push(`∞ ${this.escapeHtml(ttPartnerName)}`);
                if (ttChildCount > 0) bits.push(strings.tooltip.childrenCount(ttChildCount));
                ttRelLine = bits.join(' · ');
            }

            const ttSignals = this.tooltipSignalRows(signals);
            // A ghost's last row: linked in the view only, by which hypothesis and version.
            const ttViewLink = ghostOf
                ? `<div class="tt-line tt-view-link"><span class="view-link-icon" aria-hidden="true"></span>${this.escapeHtml(strings.viewLinks.tooltip(ghostOf.hypo, ghostOf.variant))}</div>`
                : '';
            if (ttBirthLine || ttDeathLine || ttRelLine || ttSignals || ttViewLink) {
                const rows = [
                    `<div class="tt-name">${this.escapeHtml(fullName)}</div>`,
                    ttBirthLine ? `<div class="tt-line">${this.escapeHtml(ttBirthLine)}</div>` : '',
                    ttDeathLine ? `<div class="tt-line">${this.escapeHtml(ttDeathLine)}</div>` : '',
                    ttRecorded ? `<div class="tt-line tt-warn">${this.escapeHtml(ttRecorded)}</div>` : '',
                    ttRelLine ? `<div class="tt-line tt-rel">${ttRelLine}</div>` : '',
                    ttSignals ? `<div class="tt-signals">${ttSignals}</div>` : '',
                    ttViewLink,
                    `<div class="tt-foot">${strings.tooltip.gestureHint}</div>`,
                ].filter(Boolean).join('');
                // A photo (round 9): reuse the SAME thumbnail the card avatar shows
                // (person.photo) — no extra load, so the hover card never waits on
                // a fresh fetch. No photo → no column at all (initials live on the
                // card below the tooltip, not here).
                const ttHasPhoto = !person.isPlaceholder && !!person.photo;
                const ttPhoto = ttHasPhoto ? `<img class="tt-photo" src="${this.escapeHtml(person.photo ?? '')}" alt="">` : '';
                html += `<div class="card-tooltip${ttHasPhoto ? ' has-photo' : ''}">${ttPhoto}<div class="tt-body">${rows}</div></div>`;
            }

            card.innerHTML = html;
            const edgeButton = card.querySelector<HTMLElement>('.research-edge');
            if (edgeButton) UI.bindResearchEdge(id, edgeButton);

            // Tooltip flip: the default hover card sits ~30px above the card, but
            // near the top of the viewport it would be clipped. On first hover we
            // measure the (already-laid-out, visibility-hidden) tooltip and flip it
            // below the card when there is not enough room above. getBoundingClientRect
            // is in screen space, so pan/zoom transforms are accounted for.
            const tooltipEl = card.querySelector<HTMLElement>('.card-tooltip');
            if (tooltipEl) {
                card.addEventListener('mouseenter', () => {
                    const cardTop = card.getBoundingClientRect().top;
                    const needed = tooltipEl.offsetHeight + 30;
                    card.classList.toggle('tooltip-below', cardTop - needed < 4);
                });
            }

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
        // Measure again with the pills as drawn (once: the second render knows them).
        if (edgeRoomStale && !this.edgeRoomRetried) {
            this.edgeRoomRetried = true;
            this.edgeRoomRerenderSeq = seq;
        } else this.edgeRoomRetried = false;
        return true;
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
        // In passes over all cards (each card fits on its own: fixed width,
        // absolutely placed): every write of a step, then one round of reads.
        // A write and a read per card forced a layout of the page per card
        // (2.7 s for 1 500 cards); now one layout per step.
        type Item = { nameEl: HTMLElement; textEl: HTMLElement; given: string; surname: string;
            meta: HTMLElement | null; metaText: HTMLElement | null };
        const items: Item[] = [];
        canvas.querySelectorAll<HTMLElement>('.person-card .name').forEach(nameEl => {
            const textEl = nameEl.querySelector<HTMLElement>('.name-text');
            // A custom card's name in computed rows is drawn as it is (src/card-width.ts).
            if (!textEl || nameEl.classList.contains('name--rows')) return;
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
            // The text part only: the status icons after it stay.
            const metaText = meta?.querySelector<HTMLElement>('.meta-text') ?? meta;
            if (meta && metaText) {
                meta.classList.remove('meta-short');
                if (meta.dataset.full !== undefined) {
                    metaText.textContent = meta.dataset.full;
                    delete meta.dataset.full;
                }
            }
            items.push({ nameEl, textEl, given, surname, meta, metaText });
        });

        // Fractional measurement: the ellipsis triggers on ANY layout
        // overflow, even sub-pixel ("Maria Paroulková" is 128.34px in a
        // 128px column — clipped to "Maria Paroulko…"), while the integer
        // scrollWidth rounds that overflow away AND never reports below the
        // box width. Range rects give the true glyph width; both sides come
        // from the same (possibly zoom-transformed) space, so the
        // comparison holds at any canvas scale.
        const fits = (textEl: HTMLElement): boolean => {
            const range = document.createRange();
            range.selectNodeContents(textEl);
            let contentW = 0;
            for (const r of range.getClientRects()) contentW = Math.max(contentW, r.width);
            return contentW <= textEl.getBoundingClientRect().width + 0.01;
        };
        const overflowing = (list: Item[]): Item[] => list.filter(it => !fits(it.textEl));

        // Step 0: 15px (a detached card, no width, is left as it is).
        let left = overflowing(items.filter(it => it.nameEl.clientWidth !== 0));
        // Step 1: 14px.
        left.forEach(it => it.nameEl.classList.add('name-fit-1'));
        left = overflowing(left);
        // Step 1: 13px floor.
        left.forEach(it => { it.nameEl.classList.remove('name-fit-1'); it.nameEl.classList.add('name-fit-13'); });
        left = overflowing(left);

        // Compact cards are a single centred line in a 44px box: the two-line
        // step does not apply. Once the 12.5px floor still overflows, the base
        // ellipsis takes over (the compact-scoped .name-fit-* CSS shrinks to
        // that floor at matching specificity).
        // The custom card has one name row above its lines: no two-line step either.
        const density = SettingsManager.getCardDensity();
        if (density === 'compact' || isFieldCardDensity(density)) return;

        // Step 2: two lines (break between given name and surname) + years-only meta.
        for (const { nameEl, textEl, given, surname, meta, metaText } of left) {
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
            if (meta && metaText && meta.dataset.years !== undefined) {
                meta.dataset.full = metaText.textContent ?? '';
                metaText.textContent = meta.dataset.years;
                meta.classList.add('meta-short');
            }
        }
        // Step 3 (ellipsis on an overflowing line) is handled by the
        // .name-line { text-overflow: ellipsis } CSS.
    }

    // ============= Research edge =============

    private researchEdgeMode(): ResearchEdgeMode {
        const treeId = DataManager.getCurrentTreeId();
        return treeId ? TreeManager.getResearchEdgeMode(treeId) : 'all';
    }

    /** Whether a working edge may move now (see edgeMoves). */
    private researchEdgeMotion(): { live: boolean; motion: boolean; reducedMotion: boolean } {
        const treeId = DataManager.getCurrentTreeId();
        return {
            live: DataManager.isLiveFollowing(),
            motion: !!treeId && TreeManager.isResearchEdgeMotion(treeId),
            reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
        };
    }

    /**
     * The edge of every drawn person the research wrote one for. A person who
     * meanwhile got the parents the edge misses (added by hand) has none.
     */
    private computeEdgeViews(ctx: CardSignalContext): Map<PersonId, EdgeView> {
        const out = new Map<PersonId, EdgeView>();
        const mode = this.researchEdgeMode();
        if (mode === 'off') return out;
        // Parents shown "linked in the view only" stand where the stub would: it comes back when they are
        // unlinked, or in a view that does not draw them (the Descendants of the person).
        const shownParents = new Set(this.viewLayer?.links
            .filter(l => l.kind === 'child' && l.islandIds.some(pid => this.positions.has(pid))).map(l => l.anchorId) ?? []);
        for (const id of this.positions.keys()) {
            const p = DataManager.getPerson(id);
            const edge = p?.research?.edge;
            if (!p || !edge || p.isPlaceholder || shownParents.has(id)) continue;
            const parents = p.parentIds.length;
            if (edge.missing === 'parents' ? parents > 0 : edge.missing !== 'proof' && parents >= 2) continue;
            const live = p.refn ? ctx.research.get(p.refn) : undefined;
            const view = edgeView(edge, mode, { working: !!live?.agent, waiting: !!live?.waiting, queued: !!live?.queued }, edgeNamedOptions(p));
            if (view) out.set(id, view);
        }
        return out;
    }

    /** The edge's button above the card: the stub (or the "proof" label) and its short word. */
    private researchEdgeHtml(id: PersonId, v: EdgeView, all: boolean, motion: ReturnType<TreeRendererClass['researchEdgeMotion']>): string {
        const cls = ['research-edge', `edge-kind-${v.kind}`, `edge-${v.shape}`, `tone-${v.tone}`, `side-${v.side}`];
        if (edgeMoves(v, motion)) cls.push('is-moving');
        // Parents named, not linked: two hollow circles on top of the open stub; a click pins its bubble.
        if (v.named) cls.push('edge-named');
        const dots = v.named ? '<span class="research-edge-dots"></span>' : '';
        const label = v.label && (all || v.kind !== 'proof') ? `<span class="research-edge-label">${this.escapeHtml(v.label)}</span>` : '';
        const popup = v.named ? ' aria-haspopup="dialog"' : '';
        return `<button type="button" class="${cls.join(' ')}" data-edge-person="${this.escapeHtml(id)}" aria-label="${this.escapeHtml(v.aria)}"${popup}>`
            + `<i class="research-edge-line" aria-hidden="true">${dots}</i>${label}</button>`;
    }

    /** Where a person's stub ends, in canvas coordinates (null: not drawn). */
    edgeStubTip(id: PersonId): { x: number; y: number } | null {
        const v = this.edgeViews.get(id);
        const pos = this.positions.get(id);
        if (!v || !pos || v.kind === 'proof') return null;
        const w = this.config.cardWidth;
        const x = pos.x + (v.side === 'father' ? w * 40 / 188 : v.side === 'mother' ? w * 148 / 188 : w / 2);
        const h = v.kind === 'muted' ? 14 : v.shape === 'closed' ? 18 : v.named ? 37 : 26;
        return { x, y: pos.y - h };
    }

    /**
     * Possible links of the edge to a family outside the tree (hypotheses
     * with a person to join; "all" only). The family drawn: a dashed curve
     * from the stub to its card, "possible link · H0001" in the middle. Not
     * drawn: "+ family · 29" at the stub's end. Either pill opens a small
     * menu — show the family linked in the view only, or go to it — where
     * the view links are offered (src/ui/view-links-ui.ts), else the pill goes
     * to that person. A person whose stub names the parents (`named`) has
     * neither: the versions are in its bubble.
     */
    private renderEdgeLinks(svg: SVGSVGElement, canvas: HTMLElement): void {
        canvas.querySelectorAll('.edge-link-pill').forEach(el => el.remove());
        if (this.edgeViews.size === 0 || this.researchEdgeMode() !== 'all') return;
        const byRefn = new Map<string, PersonId>();
        for (const p of DataManager.getAllPersons()) if (p.refn) byRefn.set(p.refn, p.id);
        const re = strings.researchEdge;
        for (const [id, v] of this.edgeViews) {
            const person = DataManager.getPerson(id);
            // The island's own edges point back to the tree: the tree's side draws the link.
            if (!person || person.research?.island || v.kind === 'proof' || v.named) continue;
            const hypo = person.research?.edge?.hypos.find(h => h.join && byRefn.has(h.join));
            const tip = this.edgeStubTip(id);
            if (!hypo || !tip) continue;
            const joinId = byRefn.get(hypo.join!)!;
            // The family shown "linked in the view only" stands linked: no pill, no curve to it.
            if (this.viewLayer?.ghostOf.has(joinId)) continue;
            const target = this.positions.get(joinId);
            const pill = document.createElement('button');
            pill.type = 'button';
            if (target) {
                const w = this.config.cardWidth, h = this.cardHeightOf(joinId);
                // Into the island card's nearest side (its top when it is above).
                const above = target.y + h < tip.y;
                const tx = above ? target.x + w / 2 : (target.x + w / 2 < tip.x ? target.x + w : target.x);
                const ty = above ? target.y + h : target.y + h / 2;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const midY = Math.min(tip.y, ty) - 30;
                path.setAttribute('d', `M ${tip.x} ${tip.y} C ${tip.x} ${midY}, ${tx} ${midY}, ${tx} ${ty}`);
                path.setAttribute('class', 'edge-link-curve');
                path.setAttribute('fill', 'none');
                svg.appendChild(path);
                pill.className = 'edge-link-pill edge-link-pill--link';
                pill.textContent = re.linkPill(hypo.id);
                // The curve's midpoint (t = 0.5 of the cubic above).
                pill.style.left = `${(tip.x + tx) / 2}px`;
                pill.style.top = `${0.125 * tip.y + 0.75 * midY + 0.125 * ty}px`;
            } else {
                if (!hypo.island) continue;
                pill.className = 'edge-link-pill edge-link-pill--family';
                pill.textContent = re.familyPill(hypo.island);
                pill.setAttribute('aria-label', re.familyPillSr(hypo.island));
                pill.style.left = `${tip.x}px`;
                pill.style.top = `${tip.y - 4}px`;
            }
            pill.dataset.edgePerson = id;
            pill.dataset.edgeHypo = hypo.id;
            canvas.appendChild(pill);
            UI.bindEdgeLinkPill(id, pill, joinId, hypo.id);
        }
    }

    /**
     * The family's own way back (a family outside the tree in view, the
     * research edge "all"): under the caption of its top couple, once per
     * family, "Show linked to the tree" with the version it would be linked
     * by (several: a menu of them, src/ui/view-links-ui.ts). Not drawn while
     * the family is shown linked (it stands in the tree then).
     */
    private renderViewLinkIslands(canvas: HTMLElement): void {
        canvas.querySelectorAll('.view-link-island').forEach(el => el.remove());
        if (this.researchEdgeMode() !== 'all') return;
        const data = DataManager.getData();
        const islandIds = [...this.positions.keys()].filter(id => {
            const p = data.persons[id];
            return !!p?.research?.island && !p.isPlaceholder && !this.viewLayer?.ghostIds.has(id);
        });
        if (islandIds.length === 0 || !this.viewLinksOffered()) return;
        const ctx = viewLinkContext(data);
        const candidates = viewLinkCandidates(data, ctx).filter(c => c.state === 'draw');
        if (candidates.length === 0) return;
        const shownGroups = new Set((this.viewLayer?.links ?? []).flatMap(l => l.islandIds.map(id => ctx.group.get(id))));
        const byGroup = new Map<number, PersonId[]>();
        for (const id of islandIds) {
            const g = ctx.group.get(id);
            if (g === undefined || shownGroups.has(g)) continue;
            const list = byGroup.get(g) ?? [];
            list.push(id);
            byGroup.set(g, list);
        }
        const w = this.config.cardWidth;
        const v = strings.viewLinks;
        for (const [g, ids] of byGroup) {
            const offers = candidates.filter(c => c.islandIds.some(id => ctx.group.get(id) === g));
            if (offers.length === 0) continue;
            // The top row of the family, its leftmost card and that card's partner beside it.
            const top = Math.min(...ids.map(id => this.positions.get(id)!.y));
            const row = ids.filter(id => this.positions.get(id)!.y === top).sort((a, b) => this.positions.get(a)!.x - this.positions.get(b)!.x);
            const first = row[0];
            const partner = row.find(id => id !== first && Object.values(data.partnerships ?? {}).some(u => !!u
                && ((u.person1Id === first && u.person2Id === id) || (u.person2Id === first && u.person1Id === id))));
            const couple = partner ? [first, partner] : [first];
            const xs = couple.map(id => this.positions.get(id)!.x);
            const left = Math.min(...xs), right = Math.max(...xs) + w;
            const bottom = Math.max(...couple.map(id => this.positions.get(id)!.y + this.cardHeightOf(id)));
            const wrap = document.createElement('div');
            wrap.className = 'view-link-island';
            wrap.dataset.islandOf = first;
            wrap.style.left = `${(left + right) / 2}px`;
            wrap.style.top = `${bottom}px`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'view-link-island-btn';
            btn.innerHTML = `<span class="view-link-icon view-link-icon--12" aria-hidden="true"></span><span>${this.escapeHtml(v.showFromIsland)}</span>`;
            const sub = document.createElement('div');
            sub.className = 'view-link-island-sub';
            sub.textContent = offers.length === 1 ? this.viewLinkIslandTo(offers[0]) : offers.map(o => `${o.hypo} ${o.variant}`).join(' · ');
            sub.id = `view-link-island-sub-${g}`;
            btn.setAttribute('aria-describedby', sub.id);
            if (offers.length > 1) btn.setAttribute('aria-haspopup', 'menu');
            wrap.append(btn, sub);
            canvas.appendChild(wrap);
            btn.onclick = (e) => {
                e.stopPropagation();
                UI.showViewLinkFromIsland(btn, offers);
            };
        }
    }

    /** "H0022 B · to Václav Horák (1818)": what the family's button would link it to. */
    private viewLinkIslandTo(c: ViewLinkCandidate): string {
        const anchor = DataManager.getPerson(c.anchorId);
        return strings.viewLinks.islandTo(c.hypo, c.variant, anchor ? shownName(anchor) : '?', yearOf(anchor?.birthDate));
    }

    /** What every card's signals are evaluated against (once per render). */
    private signalContext(): CardSignalContext {
        const data = DataManager.getData();
        return {
            data,
            unions: unionsByPerson(data),
            treeHasSources: treeHasAnySource(data),
            settings: SettingsManager.getCardSignals(),
            research: researchCardInfoNow(),
        };
    }

    private treeObserver: IntersectionObserver | null = null;

    /**
     * The agent's arcs stop turning while the tree is off screen (one
     * observer on the tree's container, not one per card; a hidden tab
     * pauses them on its own).
     */
    private observeTreeOnScreen(): void {
        if (this.treeObserver || typeof IntersectionObserver !== 'function') return;
        const container = document.getElementById('tree-container');
        if (!container) return;
        this.treeObserver = new IntersectionObserver((entries) => {
            for (const e of entries) container.classList.toggle('tree-offscreen', !e.isIntersecting);
        });
        this.treeObserver.observe(container);
    }

    /** One person's signals, as their card shows them (the person menu leads with them). */
    cardSignalsFor(personId: PersonId): CardSignalInfo | null {
        const person = DataManager.getPerson(personId);
        return person ? cardSignalInfo(person, this.signalContext()) : null;
    }

    /** One action signal in words (badge label, tooltip row). */
    private signalText(s: CardSignalInfo, which: 'waiting' | 'conflict' | 'question' | 'agent' | 'queued'): string {
        const c = strings.card;
        const clip = (t: string): string => (t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t);
        if (which === 'waiting') return c.ttWaiting(clip(s.waiting ?? ''));
        if (which === 'conflict') return c.ttConflicts(s.conflicts);
        if (which === 'question') return c.ttQuestion(clip(s.question ?? ''));
        if (which === 'queued') return c.ttQueued(clip(s.queued ?? ''));
        return c.ttAgent(clip(s.agent ?? ''));
    }

    /** The tooltip's signal rows (HTML): evidence, story and attachments, then what waits. */
    private tooltipSignalRows(s: CardSignalInfo): string {
        const c = strings.card;
        const rows: string[] = [];
        if (s.evidence) {
            const ev = s.evidence;
            const bits = [ev.sources > 0 ? c.ttSources(ev.sources) : c.ariaEv.none];
            if (ev.sources > 0 && ev.hasBirth) bits.push(ev.birthCited ? c.ttBirthCited : c.ttBirthMissing);
            if (ev.sources > 0 && ev.hasDeath && !ev.deathCited) bits.push(c.ttDeathMissing);
            rows.push(`<div class="tt-line tt-ev">${stateStripesHtml(ev.level, null, true)}${this.escapeHtml(bits.join(' · '))}</div>`);
        }
        if (s.story || s.attachments > 0) {
            const bits: string[] = [];
            if (s.story) bits.push(s.story === 'draft' ? c.ttStoryDraft : s.storyNew ? c.ttStoryNew : c.ttStory);
            if (s.attachments > 0) bits.push(c.ttAttachments(s.attachments));
            rows.push(`<div class="tt-line tt-story">${stateStripesHtml(null, s.story, true)}${this.escapeHtml(bits.join(' · '))}</div>`);
        }
        const action = (text: string): string => `<div class="tt-line tt-action">${this.escapeHtml(text)}</div>`;
        if (s.waiting) rows.push(action(this.signalText(s, 'waiting')));
        if (s.conflicts > 0 || s.hypotheses > 0) {
            rows.push(action([
                s.conflicts > 0 ? c.ttConflicts(s.conflicts) : '',
                s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : '',
            ].filter(Boolean).join(' · ')));
        }
        if (s.question) rows.push(action(this.signalText(s, 'question')));
        // The agent: a still arc as its mark (it turns on the card only).
        const agent = (text: string): string =>
            `<div class="tt-line tt-agent"><span class="agent-mark" aria-hidden="true"></span>${this.escapeHtml(text)}</div>`;
        if (s.agent) rows.push(agent(this.signalText(s, 'agent')));
        else if (s.queued) rows.push(agent(this.signalText(s, 'queued')));
        return rows.join('');
    }

    /** The card's accessible name: the name, then its status and what waits. */
    private cardAriaLabel(person: Person, s: CardSignalInfo): string {
        const c = strings.card;
        const parts = [shownName(person)];
        if (s.showEvidence && s.evidence) parts.push(c.ariaEv[s.evidence.level]);
        if (s.showStory) parts.push(s.story === 'draft' ? c.ariaStoryDraft : s.storyNew ? c.ariaStoryNew : c.ariaStory);
        if (s.action === 'waiting') parts.push(c.ariaWaiting);
        else if (s.action === 'conflict') parts.push(c.ariaConflict);
        else if (s.action === 'question') parts.push(c.ariaQuestion);
        else if (s.showAgent) parts.push(c.ariaAgent);
        return parts.join(', ');
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
        // The layout's bands (each as tall as its tallest card, generations counted
        // from the focus); only those with a card drawn get a rule and a label.
        const bands = this.drawnBands(focusPos.y);
        let minX = Infinity, maxX = -Infinity;
        for (const pos of this.positions.values()) {
            if (pos.x < minX) minX = pos.x;
            if (pos.x + this.config.cardWidth > maxX) maxX = pos.x + this.config.cardWidth;
        }
        if (!isFinite(minX) || bands.length === 0) return;

        const pad = 48;
        const lineLeft = minX - pad;
        const lineRight = maxX + pad;
        const halfGap = this.config.verticalGap / 2;

        for (const band of bands) {
            // Boundary rule just above the band.
            const boundaryY = band.top - halfGap;
            const guideLine = this.drawLine(svg, lineLeft, boundaryY, lineRight, boundaryY, { className: 'gen-guide-line' });
            // Record the band for the sticky HTML label overlay.
            this.generationBands.push({
                label: this.generationLabel(band.generation),
                rowCenterY: band.top + band.height / 2,
                bandTopY: band.top - halfGap,
                bandBottomY: band.top + band.height + halfGap,
                guideLine,
                guideLeftX: lineLeft,
                guideRightX: lineRight,
            });
        }
    }

    /**
     * The generation bands that have a card drawn, top to bottom: the
     * layout's (LayoutResult.bands); a result without them (a debug step
     * before the end) has one card height a band, counted from the focus row.
     */
    private drawnBands(focusY: number): LayoutBand[] {
        const tops = new Set<number>();
        for (const pos of this.positions.values()) tops.add(Math.round(pos.y));
        if (this.layoutBands.length > 0) return this.layoutBands.filter(b => tops.has(Math.round(b.top)));
        const step = this.config.cardHeight + this.config.verticalGap;
        if (step <= 0) return [];
        return [...tops].sort((a, b) => a - b).map(top => ({
            generation: Math.round((top - focusY) / step), top, height: this.config.cardHeight,
        }));
    }

    private renderLines(svg: SVGSVGElement): void {
        // In debug mode with step < 7, don't render lines (only boxes)
        const skipLines = this.debugOptions?.enabled && this.debugOptions.step < 7;
        this.virtualSegments = new Map();
        this.viewLabelSpots = new Map();

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
                const lineStyle: LineStyle = partnership
                    ? this.getLineStyleForStatus(partnership.status)
                    : {};
                if (spouseLine.view) {
                    lineStyle.view = spouseLine.view;
                    lineStyle.viewLink = this.viewLinkOf(spouseLine.person1Id, spouseLine.person2Id);
                    // A partner shown "linked in the view only": the label under the couple (the line between
                    // the cards is too short for it, and on it the label would cover both cards).
                    const link = lineStyle.viewLink;
                    if (spouseLine.view === 'virtual' && link?.kind === 'partners' && !this.viewLabelSpots.has(link)) {
                        const bottom = Math.max(...[spouseLine.person1Id, spouseLine.person2Id].map(pid =>
                            (this.positions.get(pid)?.y ?? spouseLine.y) + this.cardHeightOf(pid)));
                        this.viewLabelSpots.set(link, { x: (spouseLine.xMin + spouseLine.xMax) / 2, y: bottom + VIEW_LABEL_BELOW });
                    }
                }

                // Find intermediate cards that this line passes through
                const gaps: { left: number; right: number }[] = [];
                for (const [personId, pos] of this.positions) {
                    if (personId === spouseLine.person1Id || personId === spouseLine.person2Id) continue;
                    const cardLeft = pos.x;
                    const cardRight = pos.x + this.config.cardWidth;
                    // Card overlaps line's X range and is at same Y (within card height)
                    if (cardRight > spouseLine.xMin && cardLeft < spouseLine.xMax) {
                        const h = this.cardHeightOf(personId);
                        if (Math.abs(pos.y + h / 2 - spouseLine.y) < h / 2 + 2) {
                            gaps.push({ left: cardLeft - cardGap, right: cardRight + cardGap });
                        }
                    }
                }

                if (gaps.length === 0) {
                    this.drawTreeLine(svg, spouseLine.xMin, spouseLine.y, spouseLine.xMax, spouseLine.y, lineStyle);
                } else {
                    // Sort gaps by left edge and draw segments between them
                    gaps.sort((a, b) => a.left - b.left);
                    let currentX = spouseLine.xMin;
                    for (const gap of gaps) {
                        if (gap.left > currentX) {
                            this.drawTreeLine(svg, currentX, spouseLine.y, gap.left, spouseLine.y, lineStyle);
                        }
                        currentX = Math.max(currentX, gap.right);
                    }
                    if (currentX < spouseLine.xMax) {
                        this.drawTreeLine(svg, currentX, spouseLine.y, spouseLine.xMax, spouseLine.y, lineStyle);
                    }
                }

            }

            // PHASE 2: Render cluster connections (simple lines, no jump detection)
            // Note: Single-parent children are handled by the layout engine via buildDescendantBlocksFallback
            this.renderClusterConnections(svg);

            // PHASE 3: the lines that exist only in the view, hollow, over the rest.
            this.renderVirtualLines(svg);
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
            // When every child is adopted (step/foster), the whole path is
            // dashed, not just the drops; with a biological sibling the shared
            // part stays solid.
            const sharedDash = connectionDash(conn.drops.map(d => parentRelKind(DataManager.getPerson(d.personId) ?? undefined)));
            const shared: LineStyle = { dashArray: sharedDash, className: 'child-link' };
            // Links "linked in the view only": the stem and bus of a line that exists only in the view, or of a shown family.
            if (conn.view) {
                shared.view = conn.view;
                shared.viewLink = this.viewLinkOf(...conn.drops.map(d => d.personId));
            }

            // Vertical stem from parent down to connectorY (= stemBottomY)
            this.drawTreeLine(svg, conn.stemX, conn.stemTopY, conn.stemX, conn.connectorY, shared);

            // Horizontal connector from stem to bus junction point (if stem outside bus range)
            if (conn.connectorFromX !== conn.connectorToX) {
                this.drawTreeLine(svg, conn.connectorFromX, conn.connectorY, conn.connectorToX, conn.connectorY, shared);

                // Vertical junction from connectorY to branchY (if connector on different lane)
                if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                    this.drawTreeLine(svg, conn.connectorToX, conn.connectorY, conn.connectorToX, conn.branchY, shared);
                }
            } else {
                // Stem is within bus range - extend stem to branchY if needed
                if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                    this.drawTreeLine(svg, conn.stemX, conn.connectorY, conn.stemX, conn.branchY, shared);
                }
            }

            // Horizontal bus (branch) - only over children. A shown family's
            // bus that also reaches a link's anchor: the stretch out to the
            // anchor exists only in the view.
            const anchorDrops = conn.view === 'ghost' ? conn.drops.filter(d => d.view === 'virtual') : [];
            if (anchorDrops.length > 0) {
                const junctionX = conn.connectorFromX !== conn.connectorToX ? conn.connectorToX : conn.stemX;
                const own = conn.drops.filter(d => d.view !== 'virtual').map(d => d.x);
                const bus = splitBus(conn.branchLeftX, conn.branchRightX, [junctionX, ...own], anchorDrops.map(d => d.x));
                if (bus.ghost) this.drawTreeLine(svg, bus.ghost[0], conn.branchY, bus.ghost[1], conn.branchY, shared);
                for (const [from, to] of bus.virtual) {
                    const anchor = anchorDrops.find(d => Math.abs(d.x - from) < 0.5 || Math.abs(d.x - to) < 0.5) ?? anchorDrops[0];
                    this.drawTreeLine(svg, from, conn.branchY, to, conn.branchY,
                        { className: 'child-link', view: 'virtual', viewLink: this.viewLinkOf(anchor.personId) });
                }
            } else {
                this.drawTreeLine(svg, conn.branchLeftX, conn.branchY, conn.branchRightX, conn.branchY, shared);
            }

            // Drops to each child - simple vertical lines from bus. The stroke
            // style reflects the parent→child relationship type (adoptive/step/
            // foster); geometry is unchanged.
            for (const drop of conn.drops) {
                // Parents no record documents: the drop is dashed (research edge "proof").
                const style: LineStyle = this.edgeViews.get(drop.personId)?.kind === 'proof'
                    ? { dashArray: '3,4', className: 'child-drop edge-proof-drop' }
                    : this.getParentRelDropStyle(drop.personId);
                if (drop.view) {
                    style.view = drop.view;
                    style.viewLink = this.viewLinkOf(drop.personId);
                }
                this.drawTreeLine(svg, drop.x, conn.branchY, drop.x, drop.bottomY, style);
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

        const { cardWidth } = this.config;

        // Anchor points on cards
        for (const [personId, pos] of this.positions) {
            const cardHeight = this.cardHeightOf(personId);
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

    private getLineStyleForStatus(status: import('./types.js').PartnershipStatus): LineStyle {
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

    /**
     * A line of the tree: drawn now, or — when it exists only in the view
     * (a link "linked in the view only") — kept for renderVirtualLines,
     * which draws such lines hollow once they are all known.
     */
    private drawTreeLine(svg: SVGSVGElement, x1: number, y1: number, x2: number, y2: number, style?: LineStyle): void {
        if (style?.view !== 'virtual') {
            this.drawLine(svg, x1, y1, x2, y2, style);
            return;
        }
        const key = style.viewLink ?? null;
        const list = this.virtualSegments.get(key);
        if (list) list.push({ x1, y1, x2, y2 });
        else this.virtualSegments.set(key, [{ x1, y1, x2, y2 }]);
    }

    /**
     * The lines that exist only in the view: hollow — each link's segments
     * chained into polylines, every wide stroke first, then every narrow one
     * in the canvas colour over them (so no wide stroke covers another
     * line's hollow). No dash, whatever the relation's own line has.
     */
    private renderVirtualLines(svg: SVGSVGElement): void {
        const outer: SVGPathElement[] = [];
        const inner: SVGPathElement[] = [];
        for (const [link, segments] of this.virtualSegments) {
            for (const points of chainSegments(segments)) {
                for (const [part, list] of [['outer', outer], ['inner', inner]] as const) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', polylinePath(points));
                    path.setAttribute('class', `view-virtual view-virtual-${part}`);
                    path.dataset.view = 'virtual';
                    path.dataset.viewPart = part;
                    if (link) {
                        path.dataset.viewHypo = link.hypo;
                        path.dataset.viewVariant = link.variant;
                    }
                    list.push(path);
                }
            }
        }
        for (const path of [...outer, ...inner]) svg.appendChild(path);
    }

    /**
     * "unproven · H0022 B" on each link's line: a button that opens the
     * anchor's "What research knows" at the hypothesis (the dialog takes the
     * hypothesis and version: showPersonResearchDialog `hypo`). Not drawn
     * far out (CSS: .zoom-far), where the hatch and the hollow line still say it.
     */
    private renderViewLinkLabels(canvas: HTMLElement): void {
        canvas.querySelectorAll('.view-link-label').forEach(el => el.remove());
        const v = strings.viewLinks;
        const links = new Set<ViewLink>([...this.viewLabelSpots.keys()]);
        for (const link of this.virtualSegments.keys()) if (link) links.add(link);
        for (const link of links) {
            const label = document.createElement('button');
            label.type = 'button';
            label.className = 'view-link-label';
            label.setAttribute('role', 'button');
            label.textContent = v.lineLabel(link.hypo, link.variant);
            label.setAttribute('aria-label', v.lineAria(link.hypo, link.variant));
            label.dataset.viewHypo = link.hypo;
            label.dataset.viewVariant = link.variant;
            label.dataset.viewAnchor = link.anchorId;
            canvas.appendChild(label);
            // A partner's label was placed with the couple's line; a child's sits on a horizontal stretch
            // of its line as long as the label (with some line showing at both ends), else on the vertical.
            const spot = this.viewLabelSpots.get(link)
                ?? labelSpot(this.virtualSegments.get(link) ?? [], label.offsetWidth + VIEW_LABEL_LINE_ENDS);
            if (!spot) {
                label.remove();
                continue;
            }
            label.style.left = `${spot.x}px`;
            label.style.top = `${spot.y}px`;
            label.onclick = (e) => {
                e.stopPropagation();
                UI.showPersonResearchDialog(link.anchorId, { hypo: { id: link.hypo, variant: link.variant } });
            };
        }
    }

    private drawLine(svg: SVGSVGElement, x1: number, y1: number, x2: number, y2: number, style?: LineStyle): SVGLineElement {
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
        // A line of the view layer: `view-virtual` (only in the view) or `view-ghost` (inside a shown family), with its link.
        const className = [style?.className, style?.view ? `view-${style.view}` : ''].filter(Boolean).join(' ');
        if (className) {
            line.setAttribute('class', className);
        }
        if (style?.view) {
            line.dataset.view = style.view;
            if (style.viewLink) {
                line.dataset.viewHypo = style.viewLink.hypo;
                line.dataset.viewVariant = style.viewLink.variant;
            }
        }
        if (style?.title) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = style.title;
            line.appendChild(t);
        }
        svg.appendChild(line);
        return line;
    }

    /**
     * Line style for the vertical drop to a child, based on the child's
     * parent→child relationship type. Adoptive = dashed, step/foster = dotted;
     * colour unchanged. Only the drop's stroke changes — never its geometry.
     */
    private getParentRelDropStyle(childId: PersonId): LineStyle {
        const kind = parentRelKind(DataManager.getPerson(childId) ?? undefined);
        if (!kind) return { className: 'child-drop' };
        const title = kind === 'adoptive' ? strings.parentRelType.adoptive
            : kind === 'foster' ? strings.parentRelType.foster : strings.parentRelType.step;
        return { dashArray: parentRelDash(kind), className: 'child-drop', title };
    }

    private updateSVGSize(svg: SVGSVGElement): void {
        let maxX = 500;
        let maxY = 500;

        for (const [id, pos] of this.positions) {
            maxX = Math.max(maxX, pos.x + this.config.cardWidth + 100);
            maxY = Math.max(maxY, pos.y + this.cardHeightOf(id) + 100);
        }

        svg.setAttribute('width', String(maxX));
        svg.setAttribute('height', String(maxY));
    }

    private formatDateFull(dateStr: string): string {
        // Shared formatter: qualifiers ('about 1880') and ranges read as text.
        return formatFlexDate(dateStr);
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
                } else if (el.dataset.fanAdd && !DataManager.isReadOnly()) {
                    const slot = el.dataset.fanAddGender;
                    UI.addRelation(el.dataset.fanAdd as PersonId, 'parent', slot === 'male' || slot === 'female' ? slot : undefined);
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
            editable: !DataManager.isReadOnly() && !DataManager.isTreeLocked(),
            addParentLabel: strings.contextMenu.addParent,
            showKekule: SettingsManager.isFanKekuleEnabled(),
            relTypeLabel: (t) => strings.parentRelType[t],
        });
        if (this.evidenceIds || this.evidenceLevelMap) this.applyEvidenceHighlight();

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

        const isMobile = isMobileViewport();
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
            // Screen SVG is inline in the DOM, so the gender tokens resolve
            // themselves and follow the active theme.
            maleColor: 'var(--male)',
            femaleColor: 'var(--female)',
            unknownColor: 'var(--unknown)',
        });

        container.innerHTML = `${omitted}${empty}${svg}`;
    }

    /**
     * A marriage-order pill (T13): "1. ∞ 1866" ("1. ∞" without a date), the
     * look of the other card-edge pills. Not clickable (a click is the
     * card's); a mouse shows its bubble, which names whose marriage the
     * number counts ("Jan Novák's 2nd marriage, 1885, Dolní Lhota"); the
     * aria-label says the same. Where the whole pill does not fit in its
     * half of the card it shows a shorter `label` ("2nd ∞", "2nd"); the
     * bubble and the aria-label still say it all.
     */
    private unionOrderPillHtml(b: UnionOrderBadge, label: PillLabel): string {
        const toward = DataManager.getPerson(b.towardId);
        const tip = strings.focus.unionOrderTip(b.number, b.year, b.place, b.married, toward ? shownName(toward, '?') : '?');
        const form = pillLabelForms(strings.focus.unionOrdinal(b.number), b.year).find(f => f.label === label)!;
        return `<span class="union-order-pill" role="img" aria-label="${this.escapeHtml(tip)}"`
            + ` data-union-order="${b.number}" data-toward="${this.escapeHtml(b.towardId)}" data-side="${b.side}" data-label="${label}">`
            + unionOrderPillPartsHtml(form.ordinal, form.year, form.glyph)
            + `<span class="badge-tooltip uo-tip">${this.escapeHtml(tip)}</span></span>`;
    }

    /**
     * Where each marriage-order pill sits on its card (placeUnionOrderPill):
     * the pill and the resting branch tabs measured in the screen's styles,
     * the corner groups 12px inside the border (the compact card's right
     * group 8px further in beside a status badge), the view's lines; each
     * label of a pill measured, for the shorter one where the whole does not
     * fit in its half. A card whose half holds not even the ordinal shows none.
     */
    private unionOrderSlots(badges: Map<PersonId, UnionOrderBadge>, unionChildIds: ReadonlySet<PersonId>, signalCtx: CardSignalContext):
        Map<PersonId, PillPlacement & { border: number }> {
        const out = new Map<PersonId, PillPlacement & { border: number }>();
        if (badges.size === 0) return out;
        const data = DataManager.getData();
        const showTabs = this.viewMode !== 'descendants';
        const formsOf = (b: UnionOrderBadge) => pillLabelForms(strings.focus.unionOrdinal(b.number), b.year);
        const pills = measureUnionOrderPills([...badges.values()].flatMap(formsOf));
        const tabsOf = new Map<PersonId, HiddenRelativesTab[]>();
        for (const id of badges.keys()) {
            tabsOf.set(id, showTabs ? hiddenRelativesTabs(data, id, pid => this.positions.has(pid), unionChildIds) : []);
        }
        const tabRows = measureTabRows(tabsOf.values());
        const segments = viewLineSegments({ connections: this.connections, spouseLines: this.spouseLines });
        const compact = SettingsManager.getCardDensity() === 'compact';
        const W = this.config.cardWidth;
        // The relations icon joins the right group on hover (a pointer that hovers; never in view mode) (N35).
        const hoverIcon = !DataManager.isViewMode() && typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches
            ? REL_LINK_ICON_WIDTH : 0;
        for (const [id, b] of badges) {
            const pos = this.positions.get(id);
            const person = DataManager.getPerson(id);
            if (!pos || !person) continue;
            const border = id === this.focusPersonId ? 2 : 1;
            const signals = compact && cardSignalInfo(person, signalCtx);
            const signal = !!signals && (!!signals.action || signals.showAgent || signals.doneSince !== null);
            const forms = formsOf(b);
            const slot = placeUnionOrderPill({
                cardWidth: W,
                side: b.side,
                ...pillLabelWidths(forms, forms.map(f => pills.get(unionOrderPillKey(f.ordinal, f.year, f.glyph))!.width)),
                leftTabs: 0,
                rightTabs: tabRows.get(rowKey(tabsOf.get(id)!)) ?? 0,
                leftInset: border + EDGE_INSET,
                rightInset: border + EDGE_INSET + (signal ? 8 : 0),
                rightHover: DataManager.isPersonLocked(id) ? 0 : hoverIcon,
                segments: segmentsNearCard(segments, pos.x, pos.y, W),
            });
            if (slot) out.set(id, { ...slot, border });
        }
        // Measured before the pill font was in: lay the pills out again once it is.
        const seq = this.renderSeq;
        pillFontsPending()?.then(() => { if (seq === this.renderSeq) this.render(); });
        return out;
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

    /**
     * The people of the view (export of the view, a tree from it, sharing,
     * the presentation, the map of the view): without anyone seen only
     * through a link "linked in the view only" (`includeView: true`: as drawn).
     */
    getVisiblePersonIds(opts: { includeView?: boolean } = {}): Set<PersonId> {
        return new Set((opts.includeView ? this.positions : this.outputLayout().positions).keys());
    }

    /** Generation bands for the sticky label overlay (empty outside family/descendants). */
    getGenerationBands(): GenerationBand[] {
        return this.generationBands;
    }

    /**
     * World-space rectangles of every rendered card. The sticky label overlay
     * (src/ui/gen-labels.ts) projects these to the screen to fade out any band
     * label a card has panned over — cards always take precedence over labels.
     */
    getCardWorldRects(): { x: number; y: number; w: number; h: number }[] {
        const w = this.config.cardWidth;
        const rects: { x: number; y: number; w: number; h: number }[] = [];
        for (const [id, pos] of this.positions) {
            rects.push({ x: pos.x, y: pos.y, w, h: this.cardHeightOf(id) });
        }
        return rects;
    }
}

export const TreeRenderer = new TreeRendererClass();
