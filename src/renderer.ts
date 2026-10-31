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
    PartnershipId,
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
import { ViewMode, STANDALONE_VIEWS, ResearchEdgeMode, ResearchEdgeHypo } from './types.js';
import { cardLines, CardLine, cardLineHtml, cardYears, CardLineStyle, cardDateReferences, cardAge, formatAge, isFieldCardDensity } from './card-fields.js';
import {
    CustomCardMetrics, CardLineRows, CardHead, customCardMetrics, customCardRows, customCardViewHeight, customCardSpouseLineY,
    measureCardTexts, cardFontsPending, CARD_HEAD_HEIGHT, CARD_EDGE_PILL_ROOM, CARD_EDGE_PILL_RIGHT, CARD_EDGE_PILL_LEFT,
} from './card-width.js';
import { checkRecordedAge, ageBirthDate } from './recorded-age.js';
import { ACTION_GLYPH, AGENT_DONE_MS, AGENT_DONE_FADE_MS, AGENT_SPIN_MS, CardSignalContext, CardSignalInfo, cardSignalInfo, researchCardInfoNow, sharedPhaseDelay, stateStripesHtml, storySignalText } from './card-signals.js';
import { EvidenceLevel, treeHasAnySource, unionsByPerson } from './evidence-level.js';
import { EdgeHypoFamilyLink, EdgeView, edgeHypoFamilies, edgeMoves, edgeNamedOptions, edgeView } from './research-edge.js';
import {
    computeLayout,
    StromLayoutEngine,
    LayoutRequest,
    Connection,
    SpouseLine,
    OmittedEdge,
    DisplayPolicy,
    runLayoutPipelineWithDebug,
    planShownChildrenFolding,
    pipelineInputFromRequest,
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
import { HISTORY_CHANGED_EVENT } from './ui/history-ui.js';
import { sortLifeEvents } from './events.js';
import { classifyBranches, Branch } from './branch-colors.js';
import { presumedDeceasedSet } from './privacy.js';
import { placeList } from './places.js';
import { SettingsManager } from './settings.js';
import { personInitials } from './initials.js';
import { shownName, shownNameParts, shownNameFull, birthNoteText } from './person-name.js';
import { extractSubtree } from './subtree.js';
import { buildFanModel, buildFanSvg } from './fan-chart.js';
import { computeIndirectIds } from './indirect.js';
import { isMobile as isMobileViewport, TABLET_MAX } from './breakpoints.js';
import { parentRelKind, parentRelDash, connectionDash } from './parent-rel-style.js';
import { isDiagramStandIn } from './layout/pipeline/placeholders.js';
import {
    unionOrderBadges, UnionOrderBadge, hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds, BranchTab, lineLinksOf, lineLinkTabs, LineLinks, placeUnionOrderPill, PillPlacement, REL_LINK_ICON_WIDTH,
    viewLineSegments, segmentsNearCard, EDGE_INSET, PillLabel, pillLabelForms, pillLabelWidths, unionSummaries,
    childrenDrawnElsewhere, siblingOrderMark, SiblingOrderMark,
    siblingsTabState, SiblingsTabState, newlyShownSiblingIds, siblingGroups, ShownChildrenContext, HiddenRelativesTab, unionChildIdSet, branchTabsInOrder,
    offeredPartners, OfferedPartner, childrenByUnion, childrenComeWithPartners, otherFamilyChildrenElsewhere, marriagesInOrder,
} from './marriage-order.js';
import { partnerIdsShownInPlace } from './layout/pipeline/1-select-subgraph.js';
import { measureUnionOrderPills, measureTabRows, rowKey, unionOrderPillKey, unionOrderPillPartsHtml, pillFontsPending, branchTabRestHtml, tabsForm, tabsFormClass, bubblePlacement, bubbleBox, touchBubbleBox, touchBubbleBounds, touchBubbleSide, bubbleOpensBelow, BUBBLE_WINDOW_MARGIN, BUBBLE_LOW_WINDOW_NAMES, BUBBLE_LOW_WINDOW_HEIGHT, bubbleNameCounts, bubbleNamesToFit } from './union-order-measure.js';
import { prepareBubble, showBubble, hideBubble, closeOpenBubble, openBubble } from './bubble-layer.js';
import { pillUnderFinger } from './card-tap.js';
import { showFocusToast, hideFocusToast } from './focus-toast.js';
import { openCardMenuFromKeyboard } from './ui/keyboard-access.js';
import { syncDepthStepper } from './ui/depth-stepper.js';
import {
    ViewLink, ViewLinkCandidate, loadViewLinks, isViewLinksMaster, viewLinksToDraw, viewLinksAvailable, viewLinkContext, viewLinkCandidates, familyGroups,
} from './view-links.js';
import { LineSegment, chainSegments, labelSpot, polylinePath, splitBus } from './view-link-lines.js';
import { maxGenerationsWithSiblings } from './focus-depth.js';
import {
    CHILDREN_EASE, childrenEase, ChildrenTransitionDir, childrenTransitionTiming, isCompactMotion, pickAnimated, Rect as ChildrenRect,
    rectsOverlap, STEM_SCALE, staggerDelay, widenedView, Window, zoomOutScale,
} from './children-transition.js';
import type { LayoutViewLayer, ViewLineFlag } from './layout/index.js';
import { buildViewLayer } from './layout/index.js';
import { ViewHistory, ViewHistoryEntry, ViewTransform, ViewStandIn, ShownChildrenSnapshot, emptyViewHistory, pushViewStep, stepViewHistory, sameShown, samePartnerUnions, shownKey, sameTransform, historyView } from './view-history.js';

/** A group of names in a tab's bubble: its own lines (a group label) before its names (nameGroupsHtml). */
interface BubbleNameGroup {
    pre: string;
    items: readonly string[];
}

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
    /** The cards of one height whose last line was wrapped clear of the ⇄ pill (CARD_EDGE_PILL_RIGHT). */
    edgeRightIds: Set<PersonId>;
    /** The cards of one height whose last line was wrapped clear of the ∞ pill (CARD_EDGE_PILL_LEFT). */
    edgeLeftIds: Set<PersonId>;
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
    /** The lines left out (step 7): the image labels their cards instead. */
    omittedEdges: OmittedEdge[];
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
/** How long the cards of children just shown (or one glided to) glow (ms). */
const CHILDREN_GLOW_MS = 1600;
/** The "▾ children" bubble stays this long after the pointer left it (ms), so the pointer can reach its rows. */
const CHILDREN_BUBBLE_CLOSE_MS = 150;
/** §5: the margin the new children keep from the tree's edges and from the controls over it. */
const ZOOM_FIT_MARGIN = 24;

/** The view before a change of the children shown (TreeRenderer.captureChildrenScene). */
interface ChildrenScene {
    positions: Map<PersonId, Position>;
    connections: Connection[];
    /** The cards' elements (a card that leaves moves into the transition's layer). */
    cards: Map<PersonId, HTMLElement>;
    /** A copy of the lines, for the ghost. */
    lines: SVGSVGElement;
}
/** Room the sibling-order pill ("3 of 5") takes on a card's bottom-right edge, with its inset (px). */
const SIBLING_ORDER_PILL_RIGHT = 60;

/** A bubble's own height, not the one its max-height cuts it to. */
function bubbleOwnHeight(bubble: HTMLElement): number {
    const was = bubble.style.maxHeight;
    bubble.style.maxHeight = 'none';
    const h = bubble.getBoundingClientRect().height;
    bubble.style.maxHeight = was;
    return h;
}

/**
 * A line a bubble opened by touch always keeps (round 5 §38): its header,
 * the names it lists with their groups' lines, "and n more" and its last
 * line, what a click does. The others (a note, rows of those drawn
 * elsewhere, "◎ Focus on …") a low window leaves out (placeTouchBubble).
 */
function isEssentialBubbleRow(el: HTMLElement): boolean {
    return el.matches('.badge-tooltip-header, [data-name-group], [data-group-head], .badge-tooltip-more, .bubble-menu-more, .badge-tooltip-action');
}

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
    /** The cards of one height whose last line was wrapped clear of the ⇄ pill (CARD_EDGE_PILL_RIGHT). */
    private edgeRightIds = new Set<PersonId>();
    /** The cards of one height whose last line was wrapped clear of the ∞ pill (CARD_EDGE_PILL_LEFT). */
    private edgeLeftIds = new Set<PersonId>();
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
    /** The lines the layout left out (LayoutResult.omittedEdges) and their other ends, per card. */
    private omittedEdges: OmittedEdge[] = [];
    private lineLinks = new Map<PersonId, LineLinks>();
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

    /**
     * The view's back/forward history (browser style), per tree: a new
     * focus, children shown or hidden, a jump to a card elsewhere
     * (src/view-history.ts).
     */
    private history: ViewHistory = emptyViewHistory();
    private suppressHistoryPush = false;
    /** Bumped by every new step: a jump that moves the view late (a glide) adds its step only when none came between. */
    private historySeq = 0;
    /** The children a focus from the history shows again (setFocus applies them with the new focus). */
    private pendingShown: readonly ShownChildrenSnapshot[] | null = null;
    /** After a step back or forward over a new focus (centred on it): the pan and zoom that focus left, while the view stays. */
    private viewStandIn: ViewStandIn | null = null;
    /** Search highlight: hits get 'search-hit', everyone else 'search-dim'. */
    private highlightIds: Set<PersonId> | null = null;
    /** People the last live-research change touched: 'live-changed' glow. */
    private changedIds: Set<PersonId> | null = null;
    /** "Show in tree" from the tree overview: these people stand out, the rest dims. Not kept over a reload. */
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
    /**
     * Persons whose children the family view shows in place (the card's
     * children tab, PipelineInput.expandChildrenOf), in the order shown.
     * A view of its own: cleared with a new focus, view mode or tree.
     */
    private childrenShownIds: PersonId[] = [];
    /** Per shown person: their children the view drew before the click (the tab never names them). */
    private childrenVisibleBefore = new Map<PersonId, ReadonlySet<PersonId>>();
    /**
     * Persons whose children a click drew none of: the tab and the menu row
     * are not offered again in this view (a safety net; the layout draws the
     * children it is asked for, childrenShownFull.test.ts).
     */
    private childrenUnshowable = new Set<PersonId>();
    /** Per shown person: the cards their click brought into view (closing them closes the expansions among those). */
    private childrenBroughtIn = new Map<PersonId, ReadonlySet<PersonId>>();
    /**
     * Siblings shown in place (the card's siblings tab, §1): the person whose
     * tab was clicked → the parents whose children that click showed (one
     * step: they are in childrenShownIds and close together). Only for the
     * tab's look and the step; the layout knows the parents alone.
     */
    private siblingsShownFor = new Map<PersonId, PersonId[]>();
    /**
     * Parents shown in place beyond the depth (§4, the "▸ parents" of an
     * ancestor at the edge of the depth, PipelineInput.extraDepthFor): the
     * persons whose parents the view shows one generation above the depth,
     * in the order shown. Cleared with the children shown.
     */
    private parentsShownIds: PersonId[] = [];
    /** Per person of parentsShownIds: the cards the click brought into view (closing them closes the expansions among those). */
    private parentsBroughtIn = new Map<PersonId, ReadonlySet<PersonId>>();
    /**
     * The persons of parentsShownIds whose parents came with their siblings
     * (the "▸ siblings" of an edge ancestor: one step with siblingsShownFor,
     * closed with it; no "▾ parents" tab of its own).
     */
    private parentsWithSiblings = new Set<PersonId>();
    /** Persons whose click drew none of their parents: the tab is not offered again in this view (a safety net, parentsShownFull.test.ts). */
    private parentsUnshowable = new Set<PersonId>();
    /** Per person of parentsShownIds whose click zoomed the view out (§5): the scale before and the scale it left. */
    private parentsZoom = new Map<PersonId, { before: number; after: number }>();
    /** Where the card of each person of parentsShownIds stood on the screen before its click (hide all brings it back there). */
    private parentsAnchorScreen = new Map<PersonId, { x: number; y: number }>();
    /**
     * Other partners shown in place (§5, the "▸ ∞" pill,
     * PipelineInput.showPartnersOf): the persons whose partners of unions
     * without children the view shows as further marriages beside them, in
     * the order shown. Cleared with the children shown.
     */
    private partnersShownIds: PersonId[] = [];
    /** Per person of partnersShownIds: the cards the click brought into view (closing them closes the expansions among those). */
    private partnersBroughtIn = new Map<PersonId, ReadonlySet<PersonId>>();
    /** Persons whose click drew none of their partners: the pill is not offered again in this view (a safety net, partnersShownFull.test.ts). */
    private partnersUnshowable = new Set<PersonId>();
    /** Per person of partnersShownIds whose click zoomed the view out (§5 of round 1): the scale before and the scale it left. */
    private partnersZoom = new Map<PersonId, { before: number; after: number }>();
    /** Where the card of each person of partnersShownIds stood on the screen before its click. */
    private partnersAnchorScreen = new Map<PersonId, { x: number; y: number }>();
    /**
     * Per person of partnersShownIds whose "▸ ∞" offered a marriage with
     * children (a child shown in place in the standard display, round 5 §36,
     * partnerOffers): the unions it showed (PipelineInput.showPartnerUnions;
     * those with children come with the children and take the place of the
     * partner the child stood with). The others go by showPartnersOf.
     */
    private partnersShownUnions = new Map<PersonId, PartnershipId[]>();
    /**
     * Per person of partnersShownUnions: the marriages the first click of
     * its "▸ ∞" offered (round 6 §42). A click on one name shows that one;
     * while any of the rest stands out of view the pill offers them
     * ("▸ ∞ n", partnersRemaining) and a click on it or on a name adds them
     * to the same expansion, as a step of its own.
     */
    private partnersOffered = new Map<PersonId, PartnershipId[]>();
    /** Marriages a click on their name drew none of (the safety net): not offered again in this view. */
    private partnerUnionsUnshowable = new Set<PartnershipId>();
    /**
     * While a click that shows relatives in place renders before it knows
     * which cards it brought (showChildrenOf, showParentsOf, showPartnersOf):
     * the cards in view before the click. The cards new against them carry
     * the hatch from that first render on (shownHereIds).
     */
    private shownStepBefore: ReadonlyMap<PersonId, unknown> | null = null;
    /** The drawn persons whose parents are out of view only because of the depth (LayoutResult.ancestorDepthEdge), per screen layout. */
    private depthEdge: ReadonlySet<PersonId> = new Set();
    /**
     * While any children are shown: how far each card has moved on the screen
     * since the first expansion, in world units (a click keeps its own card
     * in place, others may shift). "Hide all shown children" puts the first
     * expansion's card back where it stood, so the view returns as it was.
     */
    private childrenShownDrift = new Map<PersonId, { x: number; y: number }>();
    /**
     * The ancestors folded away while children are shown (§2, from
     * planShownChildrenFolding, per screen layout): each person whose
     * ancestors are folded → the shown person whose children folded them,
     * and the reverse lists. Empty without children shown.
     */
    private foldedFor = new Map<PersonId, PersonId>();
    private foldedAncestorsOf = new Map<PersonId, PersonId[]>();
    /** Per shown person whose click zoomed the view out (§5): the scale before and the scale it left. */
    private childrenZoom = new Map<PersonId, { before: number; after: number }>();
    /** Where each shown person's card centre stood on the screen (container px) before its click: hide all brings it back there with the scale (§5). */
    private childrenAnchorScreen = new Map<PersonId, { x: number; y: number }>();
    /** The running transition of children shown or hidden (§1): finish() ends it at once. */
    private childrenTransition: { finish: () => void } | null = null;
    /** The children hanging on a drawn parent line (drops of the drawn connections), per drawn view. */
    private dropIdsCache: { connections: unknown; ids: Set<PersonId> } | null = null;
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
        // A transition of children shown in place ends with any new drawing
        this.finishChildrenTransition();
        // The cards go: an open bubble (in the top layer) with them
        closeOpenBubble();
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
        this.omittedEdges = [];
        this.lineLinks = new Map();
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
            this.edgeRightIds.clear();
            this.edgeLeftIds.clear();
            this.customLines.clear();
            this.customRows.clear();
            this.customHeads.clear();
            this.customWrapped = false;
        }

        // Apply layout result
        this.positions = result.positions;
        this.connections = result.connections;
        this.omittedEdges = result.omittedEdges ?? [];
        this.lineLinks = lineLinksOf(this.omittedEdges);
        this.spouseLines = result.spouseLines;
        this.layoutBands = result.bands ?? [];
        this.viewLayer = result.viewLayer ?? null;
        this.depthEdge = new Set(result.ancestorDepthEdge ?? []);
        if (!descendantsOnly) this.pruneParentsShown(result.extraDepthDrawn ?? []);
        this.addOtherFamilyLinks();

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
            ...(!descendantsOnly && this.childrenShownIds.length > 0 ? { expandChildrenOf: this.childrenShownIds } : {}),
            ...(!descendantsOnly && this.parentsShownIds.length > 0 ? { extraDepthFor: this.parentsShownIds } : {}),
            ...(!descendantsOnly && this.partnersShownIds.some(id => !this.partnersShownUnions.has(id))
                ? { showPartnersOf: this.partnersShownIds.filter(id => !this.partnersShownUnions.has(id)) } : {}),
            ...(!descendantsOnly && this.partnersShownUnions.size > 0
                ? { showPartnerUnions: this.partnersShownIds.flatMap(id => this.partnersShownUnions.get(id) ?? []) } : {}),
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
                    viewLinks: request.viewLinks,
                    expandChildrenOf: request.expandChildrenOf,
                    extraDepthFor: request.extraDepthFor,
                    showPartnersOf: request.showPartnersOf,
                    showPartnerUnions: request.showPartnerUnions,
                    ...(request.expandChildrenOf && this.foldedFor.size > 0 ? { foldAncestorsOf: [...this.foldedFor.keys()] } : {}),
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
        if (debug) this.currentDebugSnapshot = null;
        // Children shown in place: the planner folds the ancestors in their
        // way (§2, planShownChildrenFolding); the screen keeps which folded
        // for whom (the dashed "▸ parents" tab, the "▾ children" bubble).
        if (request.expandChildrenOf) {
            const plan = planShownChildrenFolding(pipelineInputFromRequest(request));
            if (debug) {
                this.foldedFor = plan.foldedFor;
                this.foldedAncestorsOf = plan.foldedAncestorsOf;
            }
            return plan.result;
        }
        if (debug) {
            this.foldedFor = new Map();
            this.foldedAncestorsOf = new Map();
        }
        return computeLayout(new StromLayoutEngine(), request);
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
                spouseLines: this.spouseLines, omittedEdges: this.omittedEdges,
                box: this.posterBox(this.config, this.edgeRoomIds), custom: this.customMetrics,
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
            spouseLines: result.spouseLines, omittedEdges: result.omittedEdges ?? [], box: this.posterBox(config, edgeRoomIds), custom,
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
        this.edgeRightIds = measured.edgeRightIds;
        this.edgeLeftIds = measured.edgeLeftIds;
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
        // A card of one height for the view keeps its last line clear of the ⇄ pill
        // (index.html .has-edge-br) and the ∞ pill (.edge-bl-room): its rows are
        // wrapped that much narrower.
        const edgeRightIds = new Set<PersonId>();
        const edgeLeftIds = new Set<PersonId>();
        const visible = (pid: PersonId) => positions.has(pid);
        let anyBirth = false;
        for (const id of positions.keys()) {
            const person = DataManager.getPerson(id);
            if (!person) continue;
            const personLines = person.isPlaceholder ? [] : cardLines(person, data, fields);
            lines.set(id, personLines);
            ids.push(id);
            const crossPill = this.hasCrossTreePill(person, this.lastCrossTrees);
            const siblingPill = this.siblingOrderCandidate(id);
            const partnersPill = this.partnersPillOf(id, visible) !== null;
            const reserve = fields.height !== 'content' && personLines.length > 0 && (crossPill || siblingPill || partnersPill);
            if (reserve && (crossPill || siblingPill)) edgeRightIds.add(id);
            if (reserve && partnersPill) edgeLeftIds.add(id);
            // The birth surname under the name (src/person-name.ts): its row never widens the card.
            const birth = birthNoteText(shownNameParts(person, '?').birthNote);
            if (birth) anyBirth = true;
            entries.push({
                name: shownName(person, '?'), avatar: !person.isPlaceholder, lines: personLines,
                ...(birth ? { birth } : {}),
                ...(presumed ? { years: cardYears(person, presumed.has(id)) } : {}),
                ...(reserve ? { lastLineReserve: (crossPill ? CARD_EDGE_PILL_RIGHT : 0) + (siblingPill ? SIBLING_ORDER_PILL_RIGHT : 0)
                    + (partnersPill ? CARD_EDGE_PILL_LEFT : 0) } : {}),
            });
        }
        // The chosen width's cap (narrow / medium / wide); the poster takes this width too.
        // The date column at most as wide as the language's ordinary dates; a longer date goes its own way.
        const metrics = customCardMetrics(entries, measureCardTexts, fields.widthCap, fields.lines, fields.style,
            cardDateReferences(fields.fullDate));
        const { rows, heights, heads } = customCardRows(entries, metrics, measureCardTexts, fields.lines, fields.style);
        const measured = {
            lines, rows, wrapped: fields.lines !== 1, style: fields.style,
            heads: new Map(ids.map((id, i) => [id, heads[i]])), edgeRoomIds: new Set<PersonId>(), edgeRightIds, edgeLeftIds,
        };
        if (fields.height === 'content') {
            // Each card as tall as its own content; the view's height is its tallest
            // (a band with no card, the CSS default). A card with pills on its
            // bottom edge grows by their room, so they cover no text.
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
        return { ...measured, metrics: { ...metrics, cardHeight: customCardViewHeight(fields.on.length, fields.lines, heights, fields.years, anyBirth) } };
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
     * The ∞ pill of a card (§5, family view only): before a click the
     * partners of the person's unions without children out of view
     * (hiddenPartnerIds, "▸ ∞ N"), after it the ones it brought ("▾ ∞ N");
     * null without a pill (none of them, a click that drew none, another
     * view). Partners with children come with "▸ children", except on a
     * child shown in place in the standard display, which stands with one
     * partner: there the pill offers every marriage out of view (round 5
     * §36, partnerOffers). An empty "?" stand-in never counts (T11).
     */
    private partnersPillOf(id: PersonId, visible: (pid: PersonId) => boolean):
        { shown: boolean; ids: PersonId[]; offers?: OfferedPartner[]; remaining?: OfferedPartner[] } | null {
        if (this.viewMode !== 'family') return null;
        const data = DataManager.getData();
        if (!data.persons[id] || data.persons[id].isPlaceholder) return null;
        if (this.partnersShownIds.includes(id)) {
            const remaining = this.partnersRemaining(id, visible);
            return { shown: true, ids: this.partnersShownBy(id, visible), ...(remaining.length > 0 ? { remaining } : {}) };
        }
        if (this.partnersUnshowable.has(id)) return null;
        const offers = this.partnerOffers(id, visible);
        return offers.length > 0 ? { shown: false, ids: offers.map(o => o.partnerId), offers } : null;
    }

    /**
     * What a "▸ ∞" of the person offers (offeredPartners): in the standard
     * display, which draws a person with one partner, every marriage whose
     * partner is out of view (round 5 §36 on a child shown in place, round 6
     * §46 everywhere); in the expanded display the marriages without
     * children (the others come with "▸ children"). A marriage a click on
     * its name drew none of is left out (partnerUnionsUnshowable).
     */
    private partnerOffers(id: PersonId, visible: (pid: PersonId) => boolean): OfferedPartner[] {
        return offeredPartners(DataManager.getData(), id, visible, !this.showAllPartnerships)
            .filter(o => !this.partnerUnionsUnshowable.has(o.partnershipId));
    }

    /**
     * The marriages a "▸ ∞" shown one name at a time still offers (round 6
     * §42): the ones its first click offered (partnersOffered) neither shown
     * since nor drawn otherwise, in the order offered.
     */
    private partnersRemaining(id: PersonId, visible: (pid: PersonId) => boolean): OfferedPartner[] {
        const offered = this.partnersOffered.get(id);
        if (!offered) return [];
        const shown = this.partnersShownUnions.get(id) ?? [];
        const left = new Set(offered.filter(u => !shown.includes(u) && !this.partnerUnionsUnshowable.has(u)));
        return offeredPartners(DataManager.getData(), id, visible, true).filter(o => left.has(o.partnershipId));
    }

    /** The partners in view the person's "▸ ∞" brought (its "▾ ∞" names them). */
    private partnersShownBy(id: PersonId, visible: (pid: PersonId) => boolean): PersonId[] {
        const data = DataManager.getData();
        const brought = this.partnersBroughtIn.get(id);
        const unions = this.partnersShownUnions.get(id);
        const ids = unions
            ? unions.flatMap(u => {
                const union = data.partnerships[u];
                return union ? [union.person1Id === id ? union.person2Id : union.person1Id] : [];
            })
            : partnerIdsShownInPlace(data, id);
        return ids.filter(q => visible(q) && !!brought?.has(q));
    }

    /**
     * Whether a card carries pills on its bottom edge: on the left ∞ other
     * partners (the family view, partnersPillOf), on the right ⇄ the person
     * in other trees or the sibling-order pill's room.
     */
    private bottomEdgePills(id: PersonId, visible: (pid: PersonId) => boolean,
        crossTrees: Map<TreeId, { name: string; data: StromData }> | null): { left: boolean; right: boolean } {
        const person = DataManager.getPerson(id);
        if (!person) return { left: false, right: false };
        const left = this.partnersPillOf(id, visible) !== null;
        return { left, right: this.hasCrossTreePill(person, crossTrees) || this.siblingOrderCandidate(id) };
    }

    /** The card carries the ⇄ pill (the person is in other trees too) on its bottom-right edge. */
    private hasCrossTreePill(person: Person, crossTrees: Map<TreeId, { name: string; data: StromData }> | null): boolean {
        const treeId = DataManager.getCurrentTreeId();
        return !!crossTrees && !!treeId && !person.isPlaceholder
            && CrossTree.findCrossTreeMatches(treeId, person, crossTrees).length > 0;
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
        this.resetChildrenShown();
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
        // A new focus ends the confirmation of the previous one (§2)
        hideFocusToast();

        // View history (browser back/forward): a NORMAL navigation pushes the
        // previous view (focus + children shown) and clears the forward stack.
        // History is reset explicitly by resetFocusHistory() on tree
        // load/switch (not inferred here) — that avoids counting the
        // programmatic focus a load performs, while still counting the user's
        // very first click. goBack/goForward set suppressHistoryPush so they
        // can manage the stacks themselves.
        if (!this.suppressHistoryPush && this.focusPersonId && personId
            && this.focusPersonId !== personId) {
            const before = this.currentHistoryEntry();
            this.pushHistoryStep(before && { ...before, leftView: this.historyTransform() });
        }

        // Children shown in place belong to the view they were shown in
        // (a focus from the history brings back the ones it had)
        if (this.focusPersonId !== personId) this.resetChildrenShown();
        const pendingShown = this.pendingShown;
        this.pendingShown = null;
        if (pendingShown && this.viewMode === 'family') this.applyShownSnapshot(pendingShown);
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

    // ==================== CHILDREN SHOWN IN PLACE ====================

    private childrenShownSet(): ReadonlySet<PersonId> {
        return new Set(this.childrenShownIds);
    }

    /** A new view (focus, view mode, tree): no children shown in place. */
    private resetChildrenShown(): void {
        this.childrenShownIds = [];
        this.childrenVisibleBefore.clear();
        this.childrenUnshowable.clear();
        this.childrenBroughtIn.clear();
        this.siblingsShownFor.clear();
        this.childrenShownDrift.clear();
        this.childrenZoom.clear();
        this.childrenAnchorScreen.clear();
        this.parentsShownIds = [];
        this.parentsBroughtIn.clear();
        this.parentsWithSiblings.clear();
        this.parentsUnshowable.clear();
        this.parentsZoom.clear();
        this.parentsAnchorScreen.clear();
        this.partnersShownIds = [];
        this.partnersBroughtIn.clear();
        this.partnersUnshowable.clear();
        this.partnersZoom.clear();
        this.partnersAnchorScreen.clear();
        this.partnersShownUnions.clear();
        this.partnersOffered.clear();
        this.partnerUnionsUnshowable.clear();
    }

    /**
     * Parents shown beyond the depth that the view now draws without it
     * (a higher ancestor depth: the layout extended nobody for them,
     * LayoutResult.extraDepthDrawn; or the person left the view): their
     * "▾ parents" and its step go, the parents stay as the depth draws them.
     * The children shown in place stay (the siblings shown with the parents
     * keep their "▾ siblings", §1). The layout is the same with or without
     * them, so the cards are drawn from this render's state.
     */
    private pruneParentsShown(drawn: readonly PersonId[]): void {
        const keep = new Set(drawn);
        const gone = this.parentsShownIds.filter(id => !keep.has(id));
        if (gone.length === 0) return;
        this.parentsShownIds = this.parentsShownIds.filter(id => keep.has(id));
        for (const id of gone) {
            this.parentsBroughtIn.delete(id);
            this.parentsWithSiblings.delete(id);
            this.parentsZoom.delete(id);
            this.parentsAnchorScreen.delete(id);
        }
    }

    /** Whether the view shows anyone's children, parents or other partners in place. */
    private anyShown(): boolean {
        return this.childrenShownIds.length > 0 || this.parentsShownIds.length > 0 || this.partnersShownIds.length > 0;
    }

    /** What the tabs need to know about the children shown in place (hiddenRelativesTabs). */
    private shownChildrenContext(): ShownChildrenContext {
        const drops = this.dropIds();
        return {
            visibleBefore: pid => this.childrenVisibleBefore.get(pid), hangsOnLine: id => drops.has(id), parentsFolded: id => this.foldedFor.has(id),
            atDepthEdge: id => this.viewMode === 'family' && this.depthEdge.has(id) && !this.parentsUnshowable.has(id),
            parentsShown: id => this.parentsShownIds.includes(id) && !this.parentsWithSiblings.has(id),
        };
    }

    /** The hidden-relatives tabs of a drawn card in this view (hiddenRelativesTabs). */
    private relativesTabs(id: PersonId, unionChildIds: ReadonlySet<PersonId>): HiddenRelativesTab[] {
        return hiddenRelativesTabs(DataManager.getData(), id, pid => this.positions.has(pid), unionChildIds,
            this.childrenShownSet(), this.childrenUnshowable, this.shownChildrenContext());
    }

    /** The siblings tab of a drawn card in the family view (siblingsTabState), or null. */
    private siblingsTab(personId: PersonId): SiblingsTabState | null {
        if (this.viewMode !== 'family' || !this.positions.has(personId)) return null;
        const data = DataManager.getData();
        return siblingsTabState(data, personId, id => this.positions.has(id), unionChildIdSet(data),
            this.childrenShownSet(), this.childrenUnshowable, this.shownChildrenContext());
    }

    /** Whether the family view shows the person's siblings in place: all of them, through the parents' children ("▾ siblings"). */
    isSiblingsShown(personId: PersonId): boolean {
        return this.siblingsTab(personId)?.kind === 'siblingsShown';
    }

    /** Whether the person's card offers the siblings tab in place (a parent in view): "▸ siblings" or "▾ siblings". */
    canToggleSiblings(personId: PersonId): boolean {
        const kind = this.siblingsTab(personId)?.kind;
        return kind === 'siblingsHere' || kind === 'siblingsShown';
    }

    /** How many siblings "▸ siblings" would show in place (0: none to show). */
    siblingsToShowCount(personId: PersonId): number {
        const tab = this.siblingsTab(personId);
        return tab?.kind === 'siblingsHere' ? tab.promised.length : 0;
    }

    /** The parents in view whose children show the person's siblings in place (the "▾ siblings" bubble and sheet). */
    siblingsShownParents(personId: PersonId): PersonId[] {
        return (DataManager.getPerson(personId)?.parentIds ?? []).filter(q => this.childrenShownIds.includes(q));
    }

    /**
     * Show the person's siblings in place — the children of the parents in
     * view, of every marriage, in one step (the parents' "▸ children"; the
     * person's card keeps its place) — or hide them again: the parents'
     * children shown, whichever click showed them.
     */
    async toggleSiblingsShown(personId: PersonId): Promise<void> {
        const tab = this.siblingsTab(personId);
        if (tab?.kind === 'siblingsShown') {
            await this.closeChildrenShown(this.siblingsShownParents(personId), personId);
            return;
        }
        if (tab?.kind !== 'siblingsHere') return;
        // An ancestor at the edge of the depth: the parents come into view with their children (§4)
        if (tab.beyondDepth) await this.showParentsOf(personId, true);
        else await this.showChildrenOf(tab.parents, personId, personId);
    }

    // ---------- §4 parents shown in place beyond the depth ----------

    /** The parents tab in place of a drawn card in the family view: "▸ parents" (parentsHere), "▾ parents" (parentsShown) or null. */
    private parentsTab(personId: PersonId): 'parentsHere' | 'parentsShown' | null {
        if (this.viewMode !== 'family' || !this.positions.has(personId)) return null;
        const tabs = this.relativesTabs(personId, unionChildIdSet(DataManager.getData()));
        return tabs.includes('parentsShown') ? 'parentsShown' : tabs.includes('parentsHere') ? 'parentsHere' : null;
    }

    /** Whether the family view shows the person's parents in place beyond the depth by the person's "▸ parents" ("▾ parents"). */
    isParentsShown(personId: PersonId): boolean {
        return this.parentsTab(personId) === 'parentsShown';
    }

    /** Whether the person's card offers the parents tab in place (an ancestor at the edge of the depth): "▸ parents" or "▾ parents". */
    canToggleParents(personId: PersonId): boolean {
        return this.parentsTab(personId) !== null;
    }

    /** The person's parents in view while their "▾ parents" shows them (its bubble and the sheet). */
    shownParentsOf(personId: PersonId): PersonId[] {
        return (DataManager.getPerson(personId)?.parentIds ?? []).filter(q => this.positions.has(q) && !DataManager.getPerson(q)?.isPlaceholder);
    }

    /**
     * Show the parents of an ancestor at the edge of the depth in place (one
     * generation more above that branch alone; the person's card keeps its
     * place, one step back), or hide them again with what they brought.
     */
    async toggleParentsShown(personId: PersonId): Promise<void> {
        const tab = this.parentsTab(personId);
        if (tab === 'parentsShown') await this.closeShown([], [personId], personId);
        else if (tab === 'parentsHere') await this.showParentsOf(personId, false);
    }

    /**
     * Show the parents of `personId` beyond the depth in one render and one
     * step of the history (PipelineInput.extraDepthFor); `withSiblings`: the
     * person's "▸ siblings" — their children too in the same step
     * (expandChildrenOf, closed together, siblingsShownFor). The card keeps
     * its place on the screen. A click that draws none of the parents gives
     * the view back and leaves the tab out (parentsUnshowable); a parent
     * whose children it promised none of is left out of the children shown
     * (childrenUnshowable). After the transition the new cards glow.
     */
    private async showParentsOf(personId: PersonId, withSiblings: boolean): Promise<void> {
        this.finishChildrenTransition();
        const historyBefore = this.currentHistoryEntry();
        const scene = this.captureChildrenScene();
        const data = DataManager.getData();
        const beforeAll = new Map(this.positions);
        const screenBefore = this.cardScreenCenter(personId);
        const inView = (id: PersonId) => this.positions.has(id);
        const parents = (data.persons[personId]?.parentIds ?? []).filter(q => !!data.persons[q] && !data.persons[q].isPlaceholder);
        const promised = new Map(parents.map(q => [q, hiddenChildIds(data, q, inView).filter(id => id !== personId)] as const));
        const visible = new Map(parents.map(q => [q, new Set((data.persons[q]?.childIds ?? []).filter(inView))] as const));
        this.parentsShownIds = [...this.parentsShownIds, personId];
        this.shownStepBefore = beforeAll;
        if (withSiblings) {
            this.parentsWithSiblings.add(personId);
            this.childrenShownIds = [...this.childrenShownIds, ...parents];
            for (const q of parents) this.childrenVisibleBefore.set(q, visible.get(q)!);
            this.siblingsShownFor.set(personId, [...parents]);
        }
        await this.renderInternal();
        const drawn = parents.some(inView);
        const failed = withSiblings ? parents.filter(q => !drawn || !promised.get(q)!.some(inView)) : [];
        if (failed.length > 0) {
            this.childrenShownIds = this.childrenShownIds.filter(id => !failed.includes(id));
            for (const q of failed) {
                this.childrenVisibleBefore.delete(q);
                if (drawn) this.childrenUnshowable.add(q);
            }
            const kept = parents.filter(q => !failed.includes(q));
            if (kept.length > 0) this.siblingsShownFor.set(personId, kept);
            else {
                this.siblingsShownFor.delete(personId);
                this.parentsWithSiblings.delete(personId);
            }
        }
        if (!drawn) {
            this.parentsShownIds = this.parentsShownIds.filter(id => id !== personId);
            this.parentsWithSiblings.delete(personId);
            this.parentsUnshowable.add(personId);
        }
        if (failed.length > 0 || !drawn) {
            if (!drawn) this.shownStepBefore = null;
            await this.renderInternal();
            if (!drawn) {
                this.keepCardInPlace(personId, beforeAll, false);
                return;
            }
        }
        if (historyBefore) this.pushHistoryStep({ ...historyBefore, anchorId: personId });
        const broughtIn = new Set([...this.positions.keys()].filter(id => !beforeAll.has(id)));
        this.parentsBroughtIn.set(personId, broughtIn);
        this.shownStepBefore = null;
        const shown = withSiblings ? parents.filter(q => this.childrenShownIds.includes(q)) : [];
        for (const q of shown) this.childrenBroughtIn.set(q, broughtIn);
        if (screenBefore) this.parentsAnchorScreen.set(personId, screenBefore);
        const shift = this.keepCardInPlace(personId, beforeAll, false);
        // §5: zoom out around the card as far as the new cards need (desktop)
        const scaleBefore = ZoomPan.getScale();
        const zoomTo = this.childrenZoomOut(personId, [...broughtIn]);
        if (zoomTo !== null) this.parentsZoom.set(personId, { before: scaleBefore, after: zoomTo });
        const glow = () => this.glowParents(personId, shown);
        this.playChildrenTransition(scene, 'open', personId, shift, this.parentsInvolved(personId, broughtIn), zoomTo, glow);
    }

    /** The person's other partners in view while their "▾ ∞" shows them (the ones its click brought). */
    shownPartnersOf(personId: PersonId): PersonId[] {
        return this.partnersShownBy(personId, q => this.positions.has(q));
    }

    /** Whether the person's "▸ ∞" showed a marriage with children here (its partner came with the children, round 5 §36, round 6 §46). */
    private partnersShowedChildren(personId: PersonId): boolean {
        const data = DataManager.getData();
        return (this.partnersShownUnions.get(personId) ?? []).some(u => (data.partnerships[u]?.childIds.length ?? 0) > 0);
    }

    /** Whether the view shows the person's other partners in place ("▾ ∞"). */
    isPartnersShown(personId: PersonId): boolean {
        return this.partnersShownIds.includes(personId);
    }

    /**
     * The marriages a "▸ ∞" of the person would show: before its first
     * click what it offers (partnerOffers; none outside the family view or
     * after a click that drew none), after a click on one name the rest
     * (partnersRemaining, round 6 §42).
     */
    private partnersToShow(personId: PersonId): OfferedPartner[] {
        if (this.viewMode !== 'family') return [];
        const inView = (id: PersonId) => this.positions.has(id);
        if (this.partnersShownIds.includes(personId)) return this.partnersRemaining(personId, inView);
        if (this.partnersUnshowable.has(personId)) return [];
        return this.partnerOffers(personId, inView);
    }

    /**
     * The "▸ ∞" pill (§5): show the person's other partners (of unions
     * without children; in the standard display every marriage, round 5
     * §36, round 6 §46) in place, as further marriages beside the card, or
     * hide them again with what they brought. After a click on one name
     * (round 6 §42) the pill shows the rest while any is left ("▸ ∞ n"),
     * then hides them all.
     */
    async togglePartnersShown(personId: PersonId): Promise<void> {
        const rest = this.partnersToShow(personId);
        if (rest.length > 0) await this.showPartnersOf(personId);
        else if (this.partnersShownIds.includes(personId)) await this.closeShown([], [], personId, false, [personId]);
    }

    /**
     * A name in the "▸ ∞" bubble (round 6 §42): show only that marriage —
     * the partner with the marriage's children (on a child shown in place in
     * the standard display in place of the partner the child stood with, as
     * the pill does), a partner without children beside the card. One step
     * of the history, as the pill's; the pill then offers the rest.
     */
    async showPartnerHere(personId: PersonId, partnershipId: PartnershipId): Promise<void> {
        if (!this.partnersToShow(personId).some(o => o.partnershipId === partnershipId)) return;
        await this.showPartnersOf(personId, partnershipId);
    }

    /**
     * The names the person menu's "∞ Other partners" offers (round 7 §50):
     * the ones the card's "▸ ∞" bubble offers as buttons (partnersToShow) —
     * before a click every marriage the pill shows, after a click on one
     * name the rest — each with the count of the marriage's children; none
     * when the card has no such pill.
     */
    partnersMenuOffers(personId: PersonId): OfferedPartner[] {
        if (!this.positions.has(personId)) return [];
        return this.partnersToShow(personId).filter(o => DataManager.getPerson(o.partnerId) !== null);
    }

    /**
     * Show the other partners of `personId` in one render and one step of
     * the history (PipelineInput.showPartnersOf): the card keeps its place
     * on the screen, the partners carry the hatch of the cards shown here
     * and glow for a moment. A click that draws none of them gives the view
     * back and leaves the pill out (partnersUnshowable). With a marriage
     * with children among the offered ones (round 5 §36) the step goes by
     * its unions (PipelineInput.showPartnerUnions): such a partner comes
     * with the children, as "▸ children" brings that marriage, and takes
     * the place of the partner the child stood with.
     *
     * `only` (a name in the bubble, round 6 §42): that marriage alone, by
     * its union; the marriages offered are kept (partnersOffered) and a
     * later click on the pill or a name adds the rest to the same
     * expansion, as a step of its own (its cards join the ones brought, the
     * zoom and the card's place before the first click stay).
     */
    private async showPartnersOf(personId: PersonId, only: PartnershipId | null = null): Promise<void> {
        this.finishChildrenTransition();
        const historyBefore = this.currentHistoryEntry();
        const scene = this.captureChildrenScene();
        const beforeAll = new Map(this.positions);
        const screenBefore = this.cardScreenCenter(personId);
        const adding = this.partnersShownIds.includes(personId);
        const offers = this.partnersToShow(personId);
        const picked = only ? offers.filter(o => o.partnershipId === only) : offers;
        const promised = picked.map(o => o.partnerId);
        const unionsBefore = this.partnersShownUnions.get(personId);
        const broughtBefore = this.partnersBroughtIn.get(personId) ?? new Set<PersonId>();
        // By the unions: a marriage with children among the offered (round 5 §36), one name, or the rest after one
        const byUnions = adding || only !== null || offers.some(o => o.childCount > 0);
        if (byUnions) {
            if (!adding) this.partnersOffered.set(personId, offers.map(o => o.partnershipId));
            this.partnersShownUnions.set(personId, [...(unionsBefore ?? []), ...picked.map(o => o.partnershipId)]);
        }
        if (!adding) this.partnersShownIds = [...this.partnersShownIds, personId];
        // The partners promised carry the hatch from the first render (the cards brought in replace them below)
        this.partnersBroughtIn.set(personId, new Set([...broughtBefore, ...promised]));
        this.shownStepBefore = beforeAll;
        await this.renderInternal();
        if (!promised.some(id => this.positions.has(id))) {
            this.shownStepBefore = null;
            if (adding) {
                this.partnersBroughtIn.set(personId, broughtBefore);
                if (unionsBefore) this.partnersShownUnions.set(personId, unionsBefore);
            } else {
                this.partnersBroughtIn.delete(personId);
                this.partnersShownUnions.delete(personId);
                this.partnersOffered.delete(personId);
                this.partnersShownIds = this.partnersShownIds.filter(id => id !== personId);
            }
            // The safety net: the marriages picked (the person's whole pill after a click on it)
            if (adding || only !== null) for (const o of picked) this.partnerUnionsUnshowable.add(o.partnershipId);
            else this.partnersUnshowable.add(personId);
            await this.renderInternal();
            this.keepCardInPlace(personId, beforeAll, false);
            return;
        }
        if (historyBefore) this.pushHistoryStep({ ...historyBefore, anchorId: personId });
        const broughtIn = new Set([...broughtBefore, ...[...this.positions.keys()].filter(id => !beforeAll.has(id))]);
        this.partnersBroughtIn.set(personId, broughtIn);
        this.shownStepBefore = null;
        if (screenBefore && !adding) this.partnersAnchorScreen.set(personId, screenBefore);
        const shift = this.keepCardInPlace(personId, beforeAll, false);
        const scaleBefore = ZoomPan.getScale();
        const zoomTo = this.childrenZoomOut(personId, [...broughtIn]);
        if (zoomTo !== null) {
            const first = adding ? this.partnersZoom.get(personId) : undefined;
            this.partnersZoom.set(personId, { before: first?.before ?? scaleBefore, after: zoomTo });
        }
        const glow = () => this.highlightCards(this.shownPartnersOf(personId), CHILDREN_GLOW_MS);
        this.playChildrenTransition(scene, 'open', personId, shift, new Map([[personId, broughtIn]]), zoomTo, glow);
    }

    /** For the transition of a parents step: each parent of the person with the cards the step brought (they grow out of the parents' stem). */
    private parentsInvolved(personId: PersonId, broughtIn: ReadonlySet<PersonId>): Map<PersonId, ReadonlySet<PersonId>> {
        return new Map((DataManager.getPerson(personId)?.parentIds ?? []).map(q => [q, broughtIn] as const));
    }

    /**
     * After a click that showed the person's parents: the parents glow for a
     * moment with the person's active tab ("▾ parents"); with their children
     * shown in the same step (`withChildren`) as after the siblings tab.
     */
    private glowParents(personId: PersonId, withChildren: readonly PersonId[]): void {
        this.highlightCards(this.shownParentsOf(personId), CHILDREN_GLOW_MS);
        if (withChildren.length > 0) {
            this.glowShown(withChildren, personId);
            return;
        }
        const tab = this.cardElement(personId)?.querySelector<HTMLElement>('.branch-tab.parents-tab.active');
        if (!tab) return;
        tab.classList.add('tab-glow-anim');
        void tab.offsetWidth;
        tab.classList.add('tab-glow');
        setTimeout(() => tab.classList.remove('tab-glow'), CHILDREN_GLOW_MS);
    }

    /** Whether the family view shows the person's children in place (the children tab). */
    isChildrenShown(personId: PersonId): boolean {
        return this.childrenShownIds.includes(personId);
    }

    /**
     * Whether the person's card offers the children tab: the family view,
     * the person drawn, their children shown in place or any of them out of
     * view (unless a click drew none of them in this view).
     */
    canToggleChildren(personId: PersonId): boolean {
        if (this.viewMode !== 'family' || !this.positions.has(personId)) return false;
        if (this.isChildrenShown(personId)) return true;
        return !this.childrenUnshowable.has(personId)
            && hiddenChildIds(DataManager.getData(), personId, id => this.positions.has(id)).length > 0;
    }

    /**
     * Show the person's children in place, or hide the shown ones again. The
     * focus, depth and zoom stay; the person's card keeps its place on the
     * screen. Hiding lays the view out as it was before (with the expansions
     * of the children it brought into view, closeChildrenShown). A click that
     * draws none of the children it promised gives the view back and leaves
     * the tab out (the safety net, childrenUnshowable). After a click that
     * shows them, the person's children in view glow for a moment.
     */
    async toggleChildrenShown(personId: PersonId): Promise<void> {
        if (this.isChildrenShown(personId)) {
            await this.closeChildrenShown([personId], personId);
            return;
        }
        await this.showChildrenOf([personId], personId, null);
    }

    /**
     * Show the children of `parents` in place in one render and one step of
     * the history (the children tab: one person; the siblings tab: the
     * parents in view, `siblingsOf` the person whose tab it is). `anchorId`'s
     * card keeps its place on the screen. A parent whose click draws none of
     * the children it promised is left out again (the safety net,
     * childrenUnshowable); when none is left, the view comes back and no
     * step is made. After the transition the children in view glow.
     */
    private async showChildrenOf(parents: readonly PersonId[], anchorId: PersonId, siblingsOf: PersonId | null): Promise<void> {
        this.finishChildrenTransition();
        const historyBefore = this.currentHistoryEntry();
        const scene = this.captureChildrenScene();
        const data = DataManager.getData();
        const beforeAll = new Map(this.positions);
        const screenBefore = new Map(parents.map(q => [q, this.cardScreenCenter(q)] as const));
        const inView = (id: PersonId) => this.positions.has(id);
        const promised = new Map(parents.map(q => [q, hiddenChildIds(data, q, inView)] as const));
        const visible = new Map(parents.map(q => [q, new Set((data.persons[q]?.childIds ?? []).filter(inView))] as const));
        this.childrenShownIds = [...this.childrenShownIds, ...parents];
        for (const q of parents) this.childrenVisibleBefore.set(q, visible.get(q)!);
        // One step (the focus bar's count) from the first render on
        if (siblingsOf) this.siblingsShownFor.set(siblingsOf, [...parents]);
        this.shownStepBefore = beforeAll;
        await this.renderInternal();
        const failed = parents.filter(q => !promised.get(q)!.some(inView));
        const shown = parents.filter(q => !failed.includes(q));
        if (failed.length > 0) {
            this.childrenShownIds = this.childrenShownIds.filter(id => !failed.includes(id));
            for (const q of failed) {
                this.childrenVisibleBefore.delete(q);
                this.childrenUnshowable.add(q);
            }
            if (siblingsOf && shown.length > 0) this.siblingsShownFor.set(siblingsOf, shown);
            else if (siblingsOf) this.siblingsShownFor.delete(siblingsOf);
            if (shown.length === 0) this.shownStepBefore = null;
            await this.renderInternal();
            if (shown.length === 0) {
                this.keepCardInPlace(anchorId, beforeAll, false);
                return;
            }
        }
        // A step of the history (the safety net above showed nothing: no step)
        if (historyBefore) this.pushHistoryStep({ ...historyBefore, anchorId });
        const broughtIn = new Set([...this.positions.keys()].filter(id => !beforeAll.has(id)));
        this.shownStepBefore = null;
        for (const q of shown) {
            this.childrenBroughtIn.set(q, broughtIn);
            const at = screenBefore.get(q);
            if (at) this.childrenAnchorScreen.set(q, at);
        }
        const shift = this.keepCardInPlace(anchorId, beforeAll, false);
        // §5: zoom out around the card as far as the new children need (desktop)
        const scaleBefore = ZoomPan.getScale();
        const kids = shown.flatMap(q => newlyShownChildIds(data, q, inView, visible.get(q)!)).filter(id => id !== anchorId);
        const zoomTo = this.childrenZoomOut(anchorId, kids);
        if (zoomTo !== null) this.childrenZoom.set(shown[0], { before: scaleBefore, after: zoomTo });
        // §6: the children in view, of every marriage, glow once the cards stand (§1: and the active tabs)
        const glow = () => this.glowShown(shown, siblingsOf);
        this.playChildrenTransition(scene, 'open', anchorId, shift, new Map(shown.map(q => [q, broughtIn] as const)), zoomTo, glow);
    }

    /**
     * After a click that showed the children of `parents`: their children in
     * view glow for a moment (the person whose siblings they are left out);
     * after the siblings tab its active tabs glow too — the parents'
     * "▾ children" and the person's "▾ siblings" (§1).
     */
    private glowShown(parents: readonly PersonId[], siblingsOf: PersonId | null): void {
        const data = DataManager.getData();
        const kids = new Set(parents.flatMap(q => (data.persons[q]?.childIds ?? []).filter(id => this.positions.has(id) && id !== siblingsOf)));
        this.highlightCards([...kids], CHILDREN_GLOW_MS);
        if (!siblingsOf) return;
        const tabs: HTMLElement[] = [];
        for (const q of parents) {
            const t = this.cardElement(q)?.querySelector<HTMLElement>('.branch-tab.children-tab.active');
            if (t) tabs.push(t);
        }
        const own = this.cardElement(siblingsOf)?.querySelector<HTMLElement>('.branch-tab.siblings-tab.active');
        if (own) tabs.push(own);
        for (const t of tabs) {
            t.classList.add('tab-glow-anim');
            void t.offsetWidth;
            t.classList.add('tab-glow');
        }
        setTimeout(() => { for (const t of tabs) t.classList.remove('tab-glow'); }, CHILDREN_GLOW_MS);
    }

    /**
     * The steps that close together with the children shown for `childIds`,
     * the parents shown for `parentIds` and the other partners shown for
     * `partnerIds`: a siblings step goes as one
     * (both parents; for an edge ancestor its parents too), closing parents
     * closes their children shown, and whatever the closing steps brought
     * into view closes its own expansions (as childrenShownClosing: a card
     * shown without its line would stand alone).
     */
    private shownClosing(childIds: readonly PersonId[], parentIds: readonly PersonId[], partnerIds: readonly PersonId[] = []):
        { children: Set<PersonId>; parents: Set<PersonId>; partners: Set<PersonId> } {
        const children = new Set(childIds.filter(id => this.childrenShownIds.includes(id)));
        const parents = new Set(parentIds.filter(id => this.parentsShownIds.includes(id)));
        const partners = new Set(partnerIds.filter(id => this.partnersShownIds.includes(id)));
        let grew = true;
        const add = (set: Set<PersonId>, id: PersonId) => {
            if (set.has(id)) return;
            set.add(id);
            grew = true;
        };
        while (grew) {
            grew = false;
            for (const [p, qs] of this.siblingsShownFor) {
                const tied = this.parentsWithSiblings.has(p);
                if (!qs.some(q => children.has(q)) && !(tied && parents.has(p))) continue;
                for (const q of qs) if (this.childrenShownIds.includes(q)) add(children, q);
                if (tied && this.parentsShownIds.includes(p)) add(parents, p);
            }
            for (const p of parents) {
                for (const q of DataManager.getPerson(p)?.parentIds ?? []) if (this.childrenShownIds.includes(q)) add(children, q);
            }
            // A person's children shown and a "▸ ∞" of theirs that showed a marriage with
            // children (round 6 §46) show the same family: one closes with the other
            for (const p of this.partnersShownIds) {
                if (!this.partnersShowedChildren(p)) continue;
                if (children.has(p)) add(partners, p);
                if (partners.has(p) && this.childrenShownIds.includes(p)) add(children, p);
            }
            const brought = [
                ...[...children].map(id => this.childrenBroughtIn.get(id)),
                ...[...parents].map(id => this.parentsBroughtIn.get(id)),
                ...[...partners].map(id => this.partnersBroughtIn.get(id)),
            ].filter((b): b is ReadonlySet<PersonId> => !!b);
            for (const id of this.childrenShownIds) if (brought.some(b => b.has(id))) add(children, id);
            for (const id of this.parentsShownIds) if (brought.some(b => b.has(id))) add(parents, id);
            for (const id of this.partnersShownIds) if (brought.some(b => b.has(id))) add(partners, id);
        }
        return { children, parents, partners };
    }

    /**
     * Hide the children shown for `ids` in one render, together with the
     * expansions of the persons those brought into view (shownClosing).
     * Every way of hiding children comes here: the tab, the menu, the dashed
     * "▸ parents", "Hide shown children".
     */
    async closeChildrenShown(ids: readonly PersonId[], anchorId: PersonId, restoreView = false): Promise<void> {
        await this.closeShown(ids, [], anchorId, restoreView);
    }

    /**
     * Hide the children shown for `childIds`, the parents shown beyond the
     * depth for `parentIds` and the other partners shown for `partnerIds` in
     * one render, with everything that closes with them (shownClosing). The anchor's card keeps its place on the screen;
     * with `restoreView` it goes back where it stood before the first
     * expansion (hide all). The scale a click zoomed out from comes back
     * unless it was changed since (§5).
     */
    private async closeShown(childIds: readonly PersonId[], parentIds: readonly PersonId[], anchorId: PersonId, restoreView = false,
        partnerIds: readonly PersonId[] = []): Promise<void> {
        const { children: closing, parents: closingParents, partners: closingPartners } = this.shownClosing(childIds, parentIds, partnerIds);
        if (closing.size === 0 && closingParents.size === 0 && closingPartners.size === 0) return;
        this.finishChildrenTransition();
        const historyBefore = this.currentHistoryEntry();
        const anchorAt = restoreView ? this.cardScreenCenter(anchorId) : null;
        if (historyBefore) this.pushHistoryStep({ ...historyBefore, anchorId, ...(restoreView ? { restoreView: true } : {}), ...(anchorAt ? { anchorAt } : {}) });
        const scene = this.captureChildrenScene();
        const beforeAll = new Map(this.positions);
        const zooms = [
            ...this.childrenShownIds.filter(id => closing.has(id)).map(id => this.childrenZoom.get(id)),
            ...this.parentsShownIds.filter(id => closingParents.has(id)).map(id => this.parentsZoom.get(id)),
            ...this.partnersShownIds.filter(id => closingPartners.has(id)).map(id => this.partnersZoom.get(id)),
        ].filter(z => !!z);
        const involved = new Map([...closing].map(id => [id, this.childrenBroughtIn.get(id) ?? new Set<PersonId>()] as const));
        for (const p of closingParents) {
            for (const [q, b] of this.parentsInvolved(p, this.parentsBroughtIn.get(p) ?? new Set())) if (!involved.has(q)) involved.set(q, b);
        }
        for (const p of closingPartners) if (!involved.has(p)) involved.set(p, this.partnersBroughtIn.get(p) ?? new Set());
        this.childrenShownIds = this.childrenShownIds.filter(id => !closing.has(id));
        for (const id of closing) {
            this.childrenVisibleBefore.delete(id);
            this.childrenBroughtIn.delete(id);
            this.childrenZoom.delete(id);
        }
        for (const [p, parents] of this.siblingsShownFor) {
            if (parents.some(q => closing.has(q))) this.siblingsShownFor.delete(p);
        }
        const anchorScreen = this.childrenAnchorScreen.get(anchorId) ?? this.parentsAnchorScreen.get(anchorId) ?? this.partnersAnchorScreen.get(anchorId);
        for (const id of closing) this.childrenAnchorScreen.delete(id);
        this.parentsShownIds = this.parentsShownIds.filter(id => !closingParents.has(id));
        for (const id of closingParents) {
            this.parentsBroughtIn.delete(id);
            this.parentsWithSiblings.delete(id);
            this.parentsZoom.delete(id);
            this.parentsAnchorScreen.delete(id);
        }
        this.partnersShownIds = this.partnersShownIds.filter(id => !closingPartners.has(id));
        for (const id of closingPartners) {
            this.partnersBroughtIn.delete(id);
            this.partnersZoom.delete(id);
            this.partnersAnchorScreen.delete(id);
            this.partnersShownUnions.delete(id);
            this.partnersOffered.delete(id);
        }
        await this.renderInternal();
        const shift = this.keepCardInPlace(anchorId, beforeAll, restoreView);
        // §5: the scale before the first of these clicks, when the last one's zoom still stands
        const zoomTo = zooms.length > 0 && ZoomPan.getScale() === zooms[zooms.length - 1].after ? zooms[0].before : null;
        // Hide all with that scale back: the anchor's card goes where it stood before its click
        // (zooms around other cards moved it on the screen; the pivot that lands it there)
        const pivot = restoreView && zoomTo !== null && anchorScreen ? this.landingPivot(anchorId, anchorScreen, zoomTo) : null;
        this.playChildrenTransition(scene, 'close', anchorId, shift, involved, zoomTo, undefined, pivot);
    }

    /**
     * "▾ Hide shown · n" (the focus bar's button on the desktop, the
     * floating chip below it): while the family view shows anything in place,
     * n the steps (shownChildrenCount).
     */
    private updateChildrenShownUI(): void {
        const n = this.viewMode === 'family' ? this.shownChildrenCount() : 0;
        for (const id of ['hide-shown-children', 'hide-shown-children-chip']) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.hidden = n === 0;
            if (n === 0) continue;
            const text = el.querySelector('.hsc-text');
            if (text) text.textContent = strings.focus.hideAllShown(n);
            el.setAttribute('aria-label', strings.focus.hideAllShownAria(n));
        }
    }

    /**
     * How many steps show relatives in place in this view: a person whose
     * children are shown counts once, the parents of a siblings step
     * ("▸ siblings") count once together, so do the parents and the other
     * partners shown of a person.
     */
    shownChildrenCount(): number {
        const grouped = new Set([...this.siblingsShownFor.values()].flat());
        return this.childrenShownIds.filter(id => !grouped.has(id)).length + this.siblingsShownFor.size
            + this.parentsShownIds.filter(id => !this.parentsWithSiblings.has(id)).length
            + this.partnersShownIds.length;
    }

    /**
     * Hide every child shown in place, in one render: the view as it was
     * before the first expansion (its card where it stood on the screen).
     */
    async hideAllShownChildren(): Promise<void> {
        if (!this.anyShown()) return;
        // The first step's card: a parents step came first when the first children shown came with it
        const firstParents = this.parentsShownIds[0];
        const firstChildren = this.childrenShownIds[0];
        let anchor = firstParents !== undefined && (firstChildren === undefined
            || this.parentsBroughtIn.get(firstParents)?.has(firstChildren)
            || this.siblingsShownFor.get(firstParents)?.includes(firstChildren))
            ? firstParents : firstChildren;
        // Partners shown first: before every step that shows a card they brought
        const firstPartners = this.partnersShownIds[0];
        if (firstPartners !== undefined && (anchor === undefined || this.partnersBroughtIn.get(firstPartners)?.has(anchor))) anchor = firstPartners;
        await this.closeShown([...this.childrenShownIds], [...this.parentsShownIds], anchor, true, [...this.partnersShownIds]);
    }

    /**
     * After a render that showed or hid children: shift the view so the
     * anchor's card stays where it stood on the screen (ZoomPan.shiftWorld),
     * or with `restore` where it stood before the first expansion, and keep
     * every card's drift on the screen for that. Returns the shift (world
     * units: what stood at a world point now stands at the point plus it).
     */
    private keepCardInPlace(anchorId: PersonId, beforeAll: ReadonlyMap<PersonId, Position>, restore: boolean): { x: number; y: number } {
        const before = beforeAll.get(anchorId), after = this.positions.get(anchorId);
        let sx = 0, sy = 0;
        if (before && after) {
            sx = after.x - before.x;
            sy = after.y - before.y;
            const drift = this.childrenShownDrift.get(anchorId);
            if (restore && drift) { sx += drift.x; sy += drift.y; }
        }
        if (!this.anyShown()) this.childrenShownDrift.clear();
        else {
            const next = new Map<PersonId, { x: number; y: number }>();
            for (const [id, p] of this.positions) {
                const was = beforeAll.get(id);
                if (!was) continue;
                const drift = this.childrenShownDrift.get(id) ?? { x: 0, y: 0 };
                next.set(id, { x: drift.x + (p.x - was.x) - sx, y: drift.y + (p.y - was.y) - sy });
            }
            this.childrenShownDrift = next;
        }
        if (sx || sy) ZoomPan.shiftWorld(sx, sy);
        return { x: sx, y: sy };
    }

    // ---------- §1 the transition, §5 the zoom ----------

    /** A card's centre on the screen (container px), or null when it is not drawn. */
    private cardScreenCenter(id: PersonId): { x: number; y: number } | null {
        const box = this.cardBox(id);
        if (!box) return null;
        const { scale, tx, ty } = ZoomPan.getTransform();
        return { x: (box.left + box.right) / 2 * scale + tx, y: (box.top + box.bottom) / 2 * scale + ty };
    }

    /**
     * The world point to zoom around from the current scale to `scale` so
     * the card's centre lands on `screen` (null: the scales are equal, or
     * the card is not drawn).
     */
    private landingPivot(id: PersonId, screen: { x: number; y: number }, scale: number): { x: number; y: number } | null {
        const box = this.cardBox(id);
        const { scale: s, tx, ty } = ZoomPan.getTransform();
        if (!box || s === scale) return null;
        const wx = (box.left + box.right) / 2, wy = (box.top + box.bottom) / 2;
        return { x: (screen.x - tx - scale * wx) / (s - scale), y: (screen.y - ty - scale * wy) / (s - scale) };
    }

    /** The motion is reduced (the OS setting): every change in one frame. */
    private reducedMotion(): boolean {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    /**
     * What the view looks like before a change of the children shown, for
     * the transition (null: none — reduced motion, another view): the
     * cards' places and elements, the lines (a copy, for the ghost) and the
     * parent lines' stems.
     */
    private captureChildrenScene(): ChildrenScene | null {
        if (this.reducedMotion() || this.viewMode !== 'family' || typeof Element.prototype.animate !== 'function') return null;
        const canvas = document.getElementById('tree-canvas');
        const svg = document.getElementById('tree-lines');
        if (!canvas || !svg) return null;
        const cards = new Map<PersonId, HTMLElement>();
        canvas.querySelectorAll<HTMLElement>('.person-card[data-id]').forEach(c => cards.set(c.dataset.id as PersonId, c));
        return {
            positions: new Map(this.positions), connections: this.connections, cards,
            lines: svg.cloneNode(true) as SVGSVGElement,
        };
    }

    /**
     * §5: the scale a click that shows children zooms out to (around the
     * clicked card) so the new children stand within the tree's area, or
     * null when they do already or the device is not a desktop. The motion
     * runs with the transition (playChildrenTransition).
     */
    private childrenZoomOut(personId: PersonId, kids: readonly PersonId[]): number | null {
        if (window.innerWidth <= TABLET_MAX || window.matchMedia?.('(pointer: coarse)').matches) return null;
        const container = document.getElementById('tree-container');
        const anchor = this.cardBox(personId);
        if (!container || !anchor || kids.length === 0) return null;
        let target: ChildrenRect | null = null;
        for (const id of kids) {
            const box = this.cardBox(id);
            if (!box) continue;
            target = target
                ? { left: Math.min(target.left, box.left), top: Math.min(target.top, box.top), right: Math.max(target.right, box.right), bottom: Math.max(target.bottom, box.bottom) }
                : box;
        }
        if (!target) return null;
        const { scale, tx, ty } = ZoomPan.getTransform();
        const c = container.getBoundingClientRect();
        const pivotWorld = { x: (anchor.left + anchor.right) / 2, y: (anchor.top + anchor.bottom) / 2 };
        const avoid: ChildrenRect[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('.control-block, #focus-back-btn, #focus-forward-btn')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
            avoid.push({ left: r.left - c.left - ZOOM_FIT_MARGIN, top: r.top - c.top - ZOOM_FIT_MARGIN, right: r.right - c.left + ZOOM_FIT_MARGIN, bottom: r.bottom - c.top + ZOOM_FIT_MARGIN });
        }
        const s = zoomOutScale({
            scale, minScale: ZoomPan.zoomFloor(),
            pivotScreen: { x: pivotWorld.x * scale + tx, y: pivotWorld.y * scale + ty }, pivotWorld, target,
            area: { left: ZOOM_FIT_MARGIN, top: ZOOM_FIT_MARGIN, right: c.width - ZOOM_FIT_MARGIN, bottom: c.height - ZOOM_FIT_MARGIN },
            avoid,
        });
        return s < scale ? s : null;
    }

    /** A drawn card's box in the world (its element's size), or null. */
    private cardBox(id: PersonId): ChildrenRect | null {
        const pos = this.positions.get(id);
        const el = this.cardElement(id);
        if (!pos) return null;
        const w = el?.offsetWidth || this.config.cardWidth;
        const h = el?.offsetHeight || this.config.cardHeight;
        return { left: pos.x, top: pos.y, right: pos.x + w, bottom: pos.y + h };
    }

    private cardElement(id: PersonId): HTMLElement | null {
        return document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${CSS.escape(id)}"]`);
    }

    /**
     * Where a card a click brings in grows from (or a card it hides shrinks
     * into): for a child of a person in `involved`, the stem of the line down
     * to it at the top of its row; for another card that click brought in (a
     * child's partner), the stem of that person's line at the card's row;
     * null for any other card (it fades).
     */
    private stemOf(id: PersonId, connections: readonly Connection[], positions: ReadonlyMap<PersonId, Position>,
        involved: ReadonlyMap<PersonId, ReadonlySet<PersonId>>): { x: number; y: number } | null {
        const data = DataManager.getData();
        const pos = positions.get(id);
        if (!pos) return null;
        const parents = data.persons[id]?.parentIds ?? [];
        for (const [shownId, broughtIn] of involved) {
            const kids = new Set(data.persons[shownId]?.childIds ?? []);
            if (parents.includes(shownId)) {
                for (const c of connections) {
                    const drop = c.drops.find(d => d.personId === id);
                    if (drop) return { x: c.stemX, y: drop.bottomY };
                }
            }
            if (parents.includes(shownId) || broughtIn.has(id)) {
                const line = connections.find(c => c.drops.some(d => kids.has(d.personId)));
                if (line) return { x: line.stemX, y: pos.y };
            }
        }
        return null;
    }

    /** End the running transition at once: every card on its new place, the zoom on its target. */
    private finishChildrenTransition(): void {
        this.childrenTransition?.finish();
    }

    /**
     * §1: animate from the scene before (captureChildrenScene) to the view
     * just drawn. The cards that stay move from where they stood on the
     * screen (the view was shifted by `shift` to keep the anchor's card in
     * place); the cards the expansion brought in grow out of its stem, the
     * ones it takes away shrink into it in a layer of their own, other cards
     * fade; the old lines fade out over the new ones. Only cards near the
     * view move, at most the timing's cap (the nearest to the anchor); the
     * rest stand at once. The zoom of §5 (`zoomTo`) runs along. Without a
     * scene (reduced motion) the new view stands at once, the zoom too.
     * `onDone` runs once the cards stand (not when another change cuts in).
     */
    private playChildrenTransition(scene: ChildrenScene | null, dir: ChildrenTransitionDir, anchorId: PersonId,
        shift: { x: number; y: number }, involved: ReadonlyMap<PersonId, ReadonlySet<PersonId>>,
        zoomTo: number | null, onDone?: () => void, zoomPivot: { x: number; y: number } | null = null): void {
        const canvas = document.getElementById('tree-canvas');
        const svg = document.getElementById('tree-lines');
        const container = document.getElementById('tree-container');
        const anchor = this.cardBox(anchorId);
        const mid = anchor ? { x: (anchor.left + anchor.right) / 2, y: (anchor.top + anchor.bottom) / 2 } : null;
        const pivot = zoomPivot ?? mid;
        if (!scene || !canvas || !svg || !container || !pivot) {
            if (zoomTo !== null && pivot) ZoomPan.zoomAroundWorldPoint(pivot.x, pivot.y, zoomTo, 0, childrenEase);
            onDone?.();
            return;
        }
        const timing = childrenTransitionTiming(dir, isCompactMotion(window.innerWidth, window.matchMedia?.('(pointer: coarse)').matches === true));
        const { duration } = timing;
        const t0 = ZoomPan.getTransform();
        const s1 = zoomTo ?? t0.scale;
        // The transform at the end: zoomed around the anchor's centre
        const t1 = { scale: s1, tx: pivot.x * t0.scale + t0.tx - pivot.x * s1, ty: pivot.y * t0.scale + t0.ty - pivot.y * s1 };
        const view = widenedView(container.clientWidth, container.clientHeight);
        const onScreen = (x: number, y: number, w: number, h: number, t: { scale: number; tx: number; ty: number }) =>
            rectsOverlap({ left: x * t.scale + t.tx, top: y * t.scale + t.ty, right: (x + w) * t.scale + t.tx, bottom: (y + h) * t.scale + t.ty }, view);

        type Item = { dist: number; near: boolean; run: () => Animation[] };
        const items: Item[] = [];
        const ease = { duration, easing: CHILDREN_EASE };
        const fade = (el: Element, from: number, to: number, [a, b]: Window, delay = 0, fill: FillMode = 'none'): Animation => {
            const end = Math.max(b, 1);
            return el.animate([
                { opacity: from, offset: 0 }, { opacity: from, offset: Math.min(a / end, 1) }, { opacity: to, offset: 1 },
            ], { duration: end, delay, easing: 'linear', fill });
        };
        const grow: Array<{ el: HTMLElement; stem: { x: number; y: number }; pos: Position; dist: number; near: boolean }> = [];
        for (const [id, pos] of this.positions) {
            const el = this.cardElement(id);
            if (!el) continue;
            const w = el.offsetWidth, h = el.offsetHeight;
            const dist = Math.hypot(pos.x - (mid ?? pivot).x, pos.y - (mid ?? pivot).y);
            const was = scene.positions.get(id);
            if (was) {
                const dx = was.x + shift.x - pos.x, dy = was.y + shift.y - pos.y;
                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
                const near = onScreen(was.x + shift.x, was.y + shift.y, w, h, t0) || onScreen(pos.x, pos.y, w, h, t1);
                items.push({ dist, near, run: () => [el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], ease)] });
                continue;
            }
            const near = onScreen(pos.x, pos.y, w, h, t1);
            const stem = this.stemOf(id, this.connections, this.positions, involved);
            if (stem) grow.push({ el, stem, pos, dist, near });
            else items.push({ dist, near, run: () => [fade(el, 0, 1, timing.fadeIn, 0, 'backwards')] });
        }
        // New cards out of the stem, the nearest first (+20 ms each, none with many)
        grow.sort((a, b) => Math.hypot(a.pos.x - a.stem.x, a.pos.y - a.stem.y) - Math.hypot(b.pos.x - b.stem.x, b.pos.y - b.stem.y));
        grow.forEach((g, rank) => {
            const delay = staggerDelay(rank, grow.length);
            const from = `translate(${g.stem.x - g.el.offsetWidth / 2 - g.pos.x}px, ${g.stem.y - g.pos.y}px) scale(${STEM_SCALE})`;
            items.push({
                dist: g.dist, near: g.near, run: () => [
                    g.el.animate([{ transform: from, transformOrigin: '50% 0' }, { transform: 'none', transformOrigin: '50% 0' }], { ...ease, delay, fill: 'backwards' }),
                    fade(g.el, 0, 1, timing.fadeIn, delay, 'backwards'),
                ],
            });
        });
        // Cards that leave: into a layer over the cards, in the old places (shifted with the view)
        const layer = document.createElement('div');
        layer.className = 'children-leaving';
        layer.style.transform = `translate(${shift.x}px, ${shift.y}px)`;
        for (const [id, was] of scene.positions) {
            if (this.positions.has(id)) continue;
            const el = scene.cards.get(id);
            if (!el) continue;
            const dist = Math.hypot(was.x + shift.x - (mid ?? pivot).x, was.y + shift.y - (mid ?? pivot).y);
            const w = this.config.cardWidth, h = this.config.cardHeight;
            const near = onScreen(was.x + shift.x, was.y + shift.y, w, h, t0);
            const stem = this.stemOf(id, scene.connections, scene.positions, involved);
            items.push({
                dist, near, run: () => {
                    el.removeAttribute('data-id');
                    el.classList.remove('children-glow', 'children-glow-anim');
                    layer.appendChild(el);
                    if (!stem) return [fade(el, 1, 0, timing.fadeOut, 0, 'forwards')];
                    const to = `translate(${stem.x - el.offsetWidth / 2 - was.x}px, ${stem.y - was.y}px) scale(${STEM_SCALE})`;
                    return [
                        el.animate([{ transform: 'none', transformOrigin: '50% 0' }, { transform: to, transformOrigin: '50% 0' }], { ...ease, fill: 'forwards' }),
                        fade(el, 1, 0, timing.fadeOut, 0, 'forwards'),
                    ];
                },
            });
        }
        const animated = pickAnimated(items, timing.cap);
        if (animated.size > 0 || zoomTo !== null) canvas.appendChild(layer);
        const animations: Animation[] = [];
        const moving: HTMLElement[] = [];
        for (const item of animated) {
            for (const a of item.run()) {
                animations.push(a);
                const target = (a.effect as KeyframeEffect | null)?.target;
                if (target instanceof HTMLElement && !moving.includes(target)) {
                    target.style.willChange = 'transform';
                    moving.push(target);
                }
            }
        }
        // The lines: the old drawing a ghost over the new one, never recomputed per frame
        const ghost = scene.lines;
        ghost.removeAttribute('id');
        ghost.setAttribute('class', 'tree-lines-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.transform = `translate(${shift.x}px, ${shift.y}px)`;
        svg.after(ghost);
        animations.push(fade(ghost, 1, 0, timing.ghostOut, 0, 'forwards'), fade(svg, 0, 1, timing.linesIn));
        if (zoomTo !== null) ZoomPan.zoomAroundWorldPoint(pivot.x, pivot.y, zoomTo, duration, childrenEase);

        let ended = false;
        const end = (finished: boolean): void => {
            if (ended) return;
            ended = true;
            if (this.childrenTransition === transition) this.childrenTransition = null;
            for (const el of moving) el.style.willChange = '';
            ghost.remove();
            layer.remove();
            if (finished) onDone?.();
        };
        const transition = {
            finish: (): void => {
                for (const a of animations) {
                    try { a.finish(); } catch { /* an animation without an end */ }
                }
                if (zoomTo !== null) ZoomPan.finishAnimation();
                end(false);
            },
        };
        this.childrenTransition = transition;
        void Promise.all(animations.map(a => a.finished.catch(() => undefined))).then(() => end(true));
    }
    /**
     * The children of another family drawn elsewhere (§5, in place of the
     * former ⌂): a person whose other union's partner is out of view and
     * whose children of it all stand elsewhere in the family view gets a
     * "children ↗" jump to them (a line link's tab), when no "▸ children" /
     * "▾ children" of the card speaks of the children already.
     */
    private addOtherFamilyLinks(): void {
        if (this.viewMode !== 'family') return;
        const data = DataManager.getData();
        const inView = (id: PersonId) => this.positions.has(id);
        const drops = this.dropIds();
        for (const id of this.positions.keys()) {
            const person = data.persons[id];
            if (!person || person.isPlaceholder || person.partnerships.length === 0) continue;
            if (this.childrenShownIds.includes(id) || hiddenChildIds(data, id, inView).length > 0) continue;
            const kids = otherFamilyChildrenElsewhere(data, id, inView, cid => drops.has(cid));
            if (kids.length === 0) continue;
            const links = this.lineLinks.get(id) ?? { parentIds: [], childIds: [] };
            this.lineLinks.set(id, { parentIds: links.parentIds, childIds: [...links.childIds, ...kids.filter(k => !links.childIds.includes(k))] });
        }
    }

    /** The children hanging on a drawn parent line in the drawn view. */
    private dropIds(): Set<PersonId> {
        if (this.dropIdsCache?.connections !== this.connections) {
            this.dropIdsCache = { connections: this.connections, ids: new Set(this.connections.flatMap(c => c.drops.map(d => d.personId))) };
        }
        return this.dropIdsCache.ids;
    }

    /**
     * The person's children the family view draws elsewhere in the tree (in
     * view, no line from this family: a daughter as a wife in another branch).
     */
    childrenElsewhereOf(personId: PersonId): PersonId[] {
        if (this.viewMode !== 'family' || !this.positions.has(personId)) return [];
        const drops = this.dropIds();
        return childrenDrawnElsewhere(DataManager.getData(), personId, id => this.positions.has(id), id => drops.has(id));
    }

    /** Glide the view to a child drawn elsewhere (readable, glideToCards) and let its card glow for a moment. */
    showChildElsewhere(childId: PersonId): boolean {
        const { shown, moves } = this.glideToCards([childId]);
        if (shown.length > 0) this.highlightCards([childId], CHILDREN_GLOW_MS);
        return moves;
    }

    /**
     * Let the drawn cards of `ids` glow (a ring in the primary colour, 500 ms
     * in, none under reduced motion, index.html .children-glow). With
     * `holdMs` the glow goes by itself; the returned function ends it sooner
     * (or holds it while a pointer is over a control). A render draws new
     * cards without it.
     */
    highlightCards(ids: readonly PersonId[], holdMs?: number): () => void {
        const cards = ids
            .map(id => document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${CSS.escape(id)}"]`))
            .filter((c): c is HTMLElement => !!c);
        for (const card of cards) {
            card.classList.add('children-glow-anim');
            void card.offsetWidth;
            card.dataset.glow = String((Number(card.dataset.glow) || 0) + 1);
            card.classList.add('children-glow');
        }
        let released = false;
        const release = (): void => {
            if (released) return;
            released = true;
            for (const card of cards) {
                const n = (Number(card.dataset.glow) || 1) - 1;
                if (n > 0) { card.dataset.glow = String(n); continue; }
                delete card.dataset.glow;
                card.classList.remove('children-glow');
            }
        };
        if (holdMs !== undefined) setTimeout(release, holdMs);
        return release;
    }

    /** A person line of a bubble: the name and the year of birth. */
    private bubbleItemHtml(p: Person): string {
        const year = displayYear(p.birthDate);
        return `<div class="badge-tooltip-item"><span class="badge-tooltip-name">${this.escapeHtml(shownName(p, '?'))}</span>${year ? `<span class="badge-tooltip-detail"> *${this.escapeHtml(year)}</span>` : ''}</div>`;
    }

    /**
     * "Already in the tree elsewhere" in a "▾" bubble (§4 of round 1): a row
     * per card the view draws elsewhere, a click glides the view to it.
     */
    private elsewhereSectionHtml(ids: readonly PersonId[]): string {
        const rows = ids
            .map(cid => DataManager.getPerson(cid))
            .filter((c): c is Person => c !== null)
            .map(c => {
                const name = shownName(c, '?');
                const year = displayYear(c.birthDate);
                return `<button type="button" class="children-elsewhere-row" data-person-id="${this.escapeHtml(c.id)}" aria-label="${this.escapeHtml(strings.focus.childrenElsewhereAria(name))}">`
                    + `<span class="children-elsewhere-label"><span class="badge-tooltip-name">${this.escapeHtml(name)}</span>${year ? `<span class="badge-tooltip-detail"> *${this.escapeHtml(year)}</span>` : ''}</span>`
                    + `<span class="children-elsewhere-go" aria-hidden="true">↗</span></button>`;
            }).join('');
        return rows
            ? `<div class="children-elsewhere"><div class="badge-tooltip-header">${strings.focus.childrenElsewhereHeader}</div>${rows}<div class="badge-tooltip-hint">${strings.focus.childrenElsewhereHint}</div></div>`
            : '';
    }

    /** The generation of a drawn card counted from the focus's (0; ancestors negative, LayoutResult.bands), or null. */
    private generationOf(id: PersonId): number | null {
        const pos = this.positions.get(id);
        if (!pos) return null;
        return this.layoutBands.find(b => pos.y >= b.top - 1 && pos.y < b.top + b.height)?.generation ?? null;
    }

    /**
     * Whether what the anchor's "▾" tab shows is a nested expansion (§6):
     * the anchor is itself a card shown here (by another expansion), or it
     * stands more than three generations from the focus. Its bubble then
     * offers "◎ Focus on …" (nestedFocusHtml; the sheet has its "Focus" tile). The tab's kind:
     * the siblings of an anchor shown as a child of the same parents, and
     * the children of parents shown with them by an edge ancestor's
     * "▸ siblings" (§4), are that one expansion, not a nested one.
     */
    private isNestedShown(anchorId: PersonId, shownHere: ReadonlySet<PersonId>, tab: 'children' | 'siblings' | 'other'): boolean {
        if (this.viewMode !== 'family' || anchorId === this.focusPersonId || !this.positions.has(anchorId)) return false;
        const generation = this.generationOf(anchorId);
        if (generation !== null && Math.abs(generation) > 3) return true;
        if (!shownHere.has(anchorId)) return false;
        if (tab === 'siblings') return !this.siblingsShownParents(anchorId).some(q => this.childrenBroughtIn.get(q)?.has(anchorId));
        if (tab === 'children') return ![...this.parentsWithSiblings].some(p => this.siblingsShownFor.get(p)?.includes(anchorId));
        return true;
    }

    /**
     * "◎ Focus on …" in a "▾" bubble of a nested expansion (§6): a row
     * button that sets the focus on the anchor (a conscious choice: no
     * confirmation toast), with what it does under it.
     */
    private nestedFocusHtml(anchorId: PersonId): string {
        const person = DataManager.getPerson(anchorId);
        if (!person) return '';
        const label = strings.focus.nestedFocusRow(shownName(person, '?'));
        return `<div class="badge-tooltip-nested"><button type="button" class="nested-focus-row" data-person-id="${this.escapeHtml(anchorId)}">`
            + `<span class="nested-focus-glyph" aria-hidden="true">◎</span><span class="nested-focus-label">${this.escapeHtml(label)}</span></button>`
            + `<div class="badge-tooltip-body">${this.escapeHtml(strings.focus.nestedFocusHint)}</div></div>`;
    }

    /**
     * The person's siblings in a bubble (§6): by the union they were born
     * to — the full siblings, then the half siblings of each other marriage
     * of a parent — with a group line only when there is more than one group.
     */
    private siblingGroupsHtml(personId: PersonId, ids: readonly PersonId[]): string {
        return this.nameGroupsHtml(this.siblingNameGroups(personId, ids));
    }

    /** The groups of siblingGroupsHtml: each group's line (none when there is one group) and its names. */
    private siblingNameGroups(personId: PersonId, ids: readonly PersonId[]): BubbleNameGroup[] {
        const groups = siblingGroups(DataManager.getData(), personId, ids);
        const nameOf = (id: PersonId | null) => {
            const p = id ? DataManager.getPerson(id) : null;
            return p ? shownName(p, '?') : '?';
        };
        return groups.map(g => {
            const label = groups.length < 2 ? ''
                : g.full ? strings.focus.siblingsGroupFull
                    : g.parentId ? strings.focus.siblingsGroupHalf(nameOf(g.parentId), nameOf(g.partnerId)) : '';
            return {
                pre: label ? `<div class="badge-tooltip-group">${this.escapeHtml(label)}</div>` : '',
                items: this.bubbleItems(g.ids),
            };
        });
    }

    /** The bubble lines of these persons (bubbleItemHtml), the missing left out. */
    private bubbleItems(ids: readonly PersonId[]): string[] {
        return ids.map(id => DataManager.getPerson(id)).filter((p): p is Person => p !== null).map(p => this.bubbleItemHtml(p));
    }

    /**
     * The names of a bubble by group (each group's own lines before its
     * names), at most BUBBLE_MAX_NAMES in all, each group in proportion and
     * with one name at least (bubbleNameCounts); the rest as one line
     * "and n more". The menu and the sheet name everyone.
     */
    private nameGroupsHtml(groups: readonly BubbleNameGroup[]): string {
        const sizes = groups.map(g => g.items.length);
        const counts = bubbleNameCounts(sizes);
        let more = 0;
        const html = groups.map((g, i) => {
            more += g.items.length - counts[i];
            if (g.items.length > 0 && counts[i] === 0) return '';
            // Each name tagged with its group: fitBubbleNames lists fewer in a low window
            // (and its label, hidden with its last name)
            return g.pre.replace(/<div class="badge-tooltip-group"/g, `<div data-group-head="${i}" class="badge-tooltip-group"`)
                + g.items.slice(0, counts[i]).map(item => item.replace(/^<div /, `<div data-name-group="${i}" `)).join('');
        }).join('');
        if (sizes.every(n => n === 0)) return html;
        // "and n more", hidden while every name is listed (fitBubbleNames shows it when it lists fewer)
        return `${html}<div class="badge-tooltip-more" data-name-sizes="${sizes.join(',')}"${more > 0 ? '' : ' hidden'}>`
            + `${more > 0 ? this.escapeHtml(strings.focus.tabMoreNames(more)) : ''}</div>`;
    }

    /**
     * A bubble taller than the window lists fewer names, so it stands whole
     * in it with its header, "and n more" and its last line (what a click
     * does; round 3 §17, §25): bubbleNamesToFit, each group in proportion,
     * one name a group at least; "and n more" counts the rest. Every opening
     * starts from all the names nameGroupsHtml lists (a larger window lists
     * them again). Only a bubble that does not fit even then is cut.
     * `maxNames`: it lists that many at most (by touch in a low window,
     * round 4 §30), in proportion as well. `leastNames`: fewer in all down
     * to that many (by touch one, round 5 §38; bubbleNamesToFit).
     */
    private fitBubbleNames(bubble: HTMLElement, maxHeight: number, maxNames?: number, leastNames?: number): void {
        const more = bubble.querySelector<HTMLElement>('.badge-tooltip-more[data-name-sizes]');
        if (!more) return;
        const sizes = (more.dataset.nameSizes ?? '').split(',').map(Number);
        const items = [...bubble.querySelectorAll<HTMLElement>('[data-name-group]')];
        const groupOf = (el: HTMLElement) => Number(el.dataset.nameGroup);
        const listed = sizes.map((_, i) => items.filter(el => groupOf(el) === i).length);
        const shown = maxNames === undefined ? listed : bubbleNameCounts(sizes, maxNames).map((n, i) => Math.min(n, listed[i]));
        const total = sizes.reduce((a, b) => a + b, 0);
        const apply = (counts: number[]): void => {
            const seen = sizes.map(() => 0);
            for (const el of items) {
                const g = groupOf(el);
                el.hidden = seen[g]++ >= counts[g];
            }
            for (const head of bubble.querySelectorAll<HTMLElement>('[data-group-head]')) head.hidden = counts[Number(head.dataset.groupHead)] === 0;
            const rest = total - counts.reduce((a, b) => a + b, 0);
            more.hidden = rest <= 0;
            more.textContent = rest > 0 ? strings.focus.tabMoreNames(rest) : '';
        };
        // Its own height, not the one its max-height cuts it to
        const height = (): number => {
            bubble.style.maxHeight = 'none';
            const h = bubble.getBoundingClientRect().height;
            bubble.style.maxHeight = '';
            return h;
        };
        apply(bubbleNamesToFit(sizes, shown, counts => {
            apply(counts);
            return height() <= maxHeight;
        }, leastNames));
    }

    /**
     * The person's siblings the parents' children show in place, drawn
     * elsewhere in the tree (childrenDrawnElsewhere of each parent in view,
     * each once, the person left out). Also the rows of the person menu and
     * the sheet.
     */
    siblingsElsewhereOf(personId: PersonId): PersonId[] {
        const out: PersonId[] = [];
        for (const q of DataManager.getPerson(personId)?.parentIds ?? []) {
            for (const id of this.childrenElsewhereOf(q)) if (id !== personId && !out.includes(id)) out.push(id);
        }
        return out;
    }

    /** The person's siblings in view while the siblings tab shows them (the parents' children, the person left out): they glow while its bubble is open. */
    private shownSiblingsInView(personId: PersonId): PersonId[] {
        const data = DataManager.getData();
        const out = new Set<PersonId>();
        for (const q of this.siblingsShownParents(personId)) {
            for (const id of data.persons[q]?.childIds ?? []) if (id !== personId && this.positions.has(id)) out.add(id);
        }
        return [...out];
    }

    /**
     * The siblings tab in place (§1, a parent in view): "▸ siblings" with its
     * bubble inside (who, by group; the same people as the parents'
     * "▸ children"; what a click does), or "▾ siblings" (active) with the
     * bubble beside it (who was shown, through which parents, the siblings
     * drawn elsewhere as rows that glide to them; a click hides them again,
     * on the parents too).
     */
    private siblingsTabHtml(personId: PersonId, shown: boolean, fullTitle: string, unionChildIds: ReadonlySet<PersonId>, nested = false): string {
        const data = DataManager.getData();
        const inView = (id: PersonId) => this.positions.has(id);
        const elsewhere = this.siblingsElsewhereOf(personId);
        const aria = (shown ? strings.focus.siblingsTabHideAria : strings.focus.siblingsTabShowAria)(fullTitle);
        const tabHtml = `<button type="button" class="branch-tab siblings-tab kind-place${shown ? ' active' : ''}" data-action="toggle-siblings" aria-pressed="${shown}" aria-label="${this.escapeHtml(aria)}">`
            + branchTabRestHtml(shown ? 'siblingsShown' : 'siblingsHere');
        if (!shown) {
            const state = siblingsTabState(data, personId, inView, unionChildIds, this.childrenShownSet(), this.childrenUnshowable, this.shownChildrenContext());
            const elsewhereLine = elsewhere.length ? `<div class="badge-tooltip-elsewhere">${this.escapeHtml(strings.focus.childrenElsewhereCount(elsewhere.length))}</div>` : '';
            return `${tabHtml}<div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.hiddenSiblingsTooltip}</div>`
                + this.siblingGroupsHtml(personId, state?.promised ?? [])
                + `<div class="badge-tooltip-body">${this.escapeHtml(state?.beyondDepth ? strings.focus.siblingsWithParents : strings.focus.siblingsSameAsChildren)}</div>${elsewhereLine}`
                + `<div class="badge-tooltip-action">${strings.focus.placeShowHint}</div></div></button>`;
        }
        const ids = newlyShownSiblingIds(data, personId, inView, this.childrenShownSet(), q => this.childrenVisibleBefore.get(q));
        const via = this.siblingsShownParents(personId)
            .map(q => DataManager.getPerson(q)).filter((p): p is Person => p !== null).map(p => shownNameFull(p, '?')).join(', ');
        return `${tabHtml}</button><div class="badge-tooltip children-bubble siblings-bubble" data-bubble="siblings"><div class="badge-tooltip-header">${strings.focus.siblingsShownTooltip}</div>`
            + this.siblingGroupsHtml(personId, ids)
            + (via ? `<div class="badge-tooltip-body">${this.escapeHtml(strings.focus.siblingsShownVia(via))}</div>` : '')
            + this.elsewhereSectionHtml(elsewhere)
            + (nested ? this.nestedFocusHtml(personId) : '')
            + `<div class="badge-tooltip-action">${strings.focus.siblingsTabHideHint}</div></div>`;
    }

    /**
     * The parents tab in place (§4, an ancestor at the edge of the depth):
     * "▸ parents" with its bubble (the parents out of view, what a click
     * does), or "▾ parents" (active) naming the parents shown here; a click
     * hides them again with what they brought.
     */
    private parentsTabHtml(personId: PersonId, shown: boolean, fullTitle: string, nested = false): string {
        const parentIds = DataManager.getPerson(personId)?.parentIds ?? [];
        const items = this.nameGroupsHtml([{ pre: '', items: (shown ? this.shownParentsOf(personId) : parentIds.filter(q => !this.positions.has(q)))
            .map(q => DataManager.getPerson(q))
            .filter((p): p is Person => p !== null && !p.isPlaceholder)
            .map(p => this.bubbleItemHtml(p)) }]);
        const aria = (shown ? strings.focus.parentsTabHideAria : strings.focus.parentsTabShowAria)(fullTitle);
        const button = `<button type="button" class="branch-tab parents-tab kind-place${shown ? ' active' : ''}" data-action="toggle-parents" aria-pressed="${shown}" aria-label="${this.escapeHtml(aria)}">`
            + branchTabRestHtml(shown ? 'parentsShown' : 'parentsHere');
        const body = `<div class="badge-tooltip-header">${shown ? strings.focus.parentsShownTooltip : strings.focus.hiddenParentsTooltip}</div>${items}`;
        const action = `<div class="badge-tooltip-action">${shown ? strings.focus.placeHideHint : strings.focus.placeShowHint}</div>`;
        // Nested (§6): the bubble beside the tab, its "◎ Focus on …" a button of its own
        if (shown && nested) return `${button}</button><div class="badge-tooltip children-bubble" data-bubble="parents">${body}${this.nestedFocusHtml(personId)}${action}</div>`;
        return `${button}<div class="badge-tooltip">${body}${action}</div></button>`;
    }

    /**
     * A tab's bubble opens above the tab; a long one (groups of siblings, a
     * family) near the top went under the bars over the tree or off the
     * screen. Where the room above is too small it opens beside the card
     * (right, else left; .beside-*, its top edge at the card's top, on a low
     * screen moved up as far as it needs), and only where it fits on
     * neither side below the tab (.below, when the room below is larger);
     * by touch (a long press) always below the tab, never above it nor
     * beside the card (round 3 §22, round 4 §30; placeTouchBubble):
     * measured when it opens (bubblePlacement). In the top layer
     * (bubble-layer.ts) it stands at scale 1 in screen pixels whatever the
     * zoom, over the zoom buttons and the bars, whole in the window
     * (bubbleBox); without the top layer it stays on the canvas, above or
     * below its tab. False: by touch no room for the bubble even with one
     * name (placeTouchBubble), the person's menu opens instead.
     */
    private placeBubble(tab: HTMLElement, bubble: HTMLElement, touch = false): boolean {
        bubble.classList.remove('below', 'beside-right', 'beside-left');
        bubble.style.maxHeight = '';
        // The lines a low window left out by touch come back, "More in the person menu" goes (placeTouchBubble)
        for (const el of bubble.querySelectorAll<HTMLElement>(':scope > [data-dropped]')) {
            el.hidden = false;
            delete el.dataset.dropped;
        }
        bubble.querySelectorAll(':scope > .bubble-menu-more').forEach(el => el.remove());
        const layered = bubble.hasAttribute('popover') && bubble.matches(':popover-open');
        const cardEl = tab.closest<HTMLElement>('.person-card');
        // The card grows under the pointer (:hover scale), its tab with it:
        // measured as they will stand once that ends.
        const grown = this.cardGrowth(cardEl);
        const r = grown(tab.getBoundingClientRect());
        const card = grown((cardEl ?? tab).getBoundingClientRect());
        const container = document.getElementById('tree-container')?.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight, m = BUBBLE_WINDOW_MARGIN;
        let roomTop = container?.top ?? 0;
        // The bars standing over the tree above the tab (the toolbar, the focus bar, the "Hide shown" button or chip)
        const reach = 130;
        for (const sel of ['.toolbar', '#focus-controls', '#hide-shown-children', '#hide-shown-children-chip']) {
            const el = document.querySelector<HTMLElement>(sel);
            if (!el || el.hidden || el.getClientRects().length === 0) continue;
            const bar = el.getBoundingClientRect();
            if (bar.width === 0 || bar.bottom > r.top || bar.right < r.left - reach || bar.left > r.right + reach) continue;
            roomTop = Math.max(roomTop, bar.bottom);
        }
        // The visible tree under the bars, inside the window's margin (#tree-container may reach under its bottom edge)
        const room = {
            top: Math.max(roomTop, m), bottom: Math.min(container?.bottom ?? vh, vh - m),
            left: Math.max(container?.left ?? 0, m), right: Math.min(container?.right ?? vw, vw - m),
        };
        if (layered && touch) return this.placeTouchBubble(bubble, r, room.top, cardEl?.dataset.id as PersonId | undefined);
        // In the top layer whole in the window: as many names as fit there
        if (layered) this.fitBubbleNames(bubble, vh - 2 * m);
        const measure = (): DOMRect => {
            if (layered) return bubble.getBoundingClientRect();
            const shown = getComputedStyle(bubble).display !== 'none';
            if (!shown) { bubble.style.visibility = 'hidden'; bubble.style.display = 'block'; }
            const rect = grown(bubble.getBoundingClientRect());
            if (!shown) { bubble.style.display = ''; bubble.style.visibility = ''; }
            return rect;
        };
        const b = measure();
        if (b.height === 0) return true;
        const place = bubblePlacement(r, card, { width: b.width, height: b.height }, room, { touch });
        if (!layered) {
            // On the canvas: above the tab or below it, never beside the card
            const below = place === 'below' || (place !== 'above' && bubbleOpensBelow(r, b.height, room.top, room.bottom));
            if (below) bubble.classList.add('below');
            return true;
        }
        // As tall as the window lets it (max-height): cut without a scrollbar
        bubble.classList.toggle('bubble-clipped', b.height >= vh - 2 * m - 0.5);
        const box = bubbleBox(place, r, card, { width: b.width, height: b.height }, room, { width: vw, height: vh });
        bubble.style.left = `${box.left}px`;
        bubble.style.top = `${box.top}px`;
        const beside = place === 'right' || place === 'left';
        bubble.style.setProperty(beside ? '--beside-arrow' : '--arrow-x', `${box.arrow}px`);
        bubble.style.removeProperty(beside ? '--arrow-x' : '--beside-arrow');
        if (place !== 'above') bubble.classList.add(beside ? `beside-${place}` : 'below');
        bubble.classList.toggle('no-arrow', box.noArrow === true);
        return true;
    }

    /**
     * A bubble opened by touch in the top layer (round 5 §33, §34, §38;
     * touchBubbleSide): whole below its tab where it fits there, else whole
     * above it (its arrow at its bottom, on the tab), else on the side with
     * more room listing fewer names, one at least, with "and n more" and its
     * last line (what a click does); the lines between them (a note, the
     * rows of those drawn elsewhere, "◎ Focus on …") are left out from the
     * last one up while it is still too tall, so nothing in it is cut. Never
     * over the app's top bar nor the bars over the tree (`barsTop`, the
     * room's top) nor the bottom navigation (8 px over its top edge, its
     * safe area included; touchBubbleBounds). It lists 8 names at most, in a
     * low window (500 px high or less, whatever its width) 4. A bubble that
     * lists fewer names than it has (by the room, or by that cap: "and n
     * more", round 7 §54) or leaves lines out carries one more line under
     * its names, "More in the person menu" (round 6 §41, insertMenuMoreRow).
     * That line counts in its height always, also where the bubble then
     * shows whole and goes without it, so whether the menu opens in its
     * place does not hang on it. False where not even one name fits on
     * either side: no bubble, the person's menu opens instead
     * (openBubbleByTouch).
     */
    private placeTouchBubble(bubble: HTMLElement, tab: DOMRect, barsTop: number, personId?: PersonId): boolean {
        const vw = window.innerWidth, vh = window.innerHeight;
        const toolbar = document.querySelector<HTMLElement>('.toolbar');
        const barsBottom = Math.max(barsTop, toolbar && toolbar.getClientRects().length > 0 ? toolbar.getBoundingClientRect().bottom : 0);
        const nav = document.querySelector<HTMLElement>('.bottom-bar');
        const navBox = nav && nav.getClientRects().length > 0 && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
        const bounds = touchBubbleBounds(barsBottom, { width: vw, height: vh }, navBox);
        const maxNames = vh <= BUBBLE_LOW_WINDOW_HEIGHT ? BUBBLE_LOW_WINDOW_NAMES : undefined;
        bubble.classList.remove('bubble-clipped');
        // All the names it lists at most, then the least it may show (one name)
        const sideOf = (): { side: ReturnType<typeof touchBubbleSide>['side']; room: number; namesCut: boolean } => {
            this.fitBubbleNames(bubble, Infinity, maxNames);
            // Fewer names than it has: some hidden, or "and n more" (also the cap of 8 names, round 7 §54)
            const more = bubble.querySelector<HTMLElement>(':scope > .badge-tooltip-more');
            const namesCut = (!!more && !more.hidden && more.textContent !== '')
                || [...bubble.querySelectorAll<HTMLElement>('[data-name-group]')].some(el => el.hidden);
            const height = bubbleOwnHeight(bubble);
            const fit = touchBubbleSide(tab, height, this.bubbleLeastHeight(bubble, maxNames), bounds);
            return { ...fit, namesCut: namesCut || (fit.side !== 'menu' && height > fit.room + 0.5) };
        };
        // The way to the rest, measured with the bubble always (round 7 §54)
        if (personId) this.insertMenuMoreRow(bubble, personId);
        let { side, room, namesCut } = sideOf();
        // Shown whole (all the names, no line left out): without it
        if (!namesCut && side !== 'menu' && personId) {
            bubble.querySelectorAll(':scope > .bubble-menu-more').forEach(el => el.remove());
            ({ side, room } = sideOf());
        }
        if (side === 'menu') return false;
        this.fitBubbleNames(bubble, room, maxNames, 1);
        const optional = [...bubble.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.hidden && !isEssentialBubbleRow(el));
        while (optional.length > 0 && bubbleOwnHeight(bubble) > room + 0.5) {
            const el = optional.pop()!;
            el.hidden = true;
            el.dataset.dropped = '';
        }
        bubble.style.maxHeight = 'none';
        const b = bubble.getBoundingClientRect();
        const box = touchBubbleBox(side, tab, { width: b.width, height: b.height }, bounds);
        bubble.style.maxHeight = `${box.maxHeight}px`;
        // A safeguard: a bubble still taller than its room is cut, its last line kept
        bubble.classList.toggle('bubble-clipped', b.height > box.maxHeight + 0.5);
        bubble.style.left = `${box.left}px`;
        bubble.style.top = `${box.top}px`;
        bubble.style.setProperty('--arrow-x', `${box.arrow}px`);
        bubble.style.removeProperty('--beside-arrow');
        bubble.classList.toggle('below', side === 'below');
        bubble.classList.toggle('no-arrow', box.noArrow === true);
        return true;
    }

    /**
     * "More in the person menu" (round 6 §41): a line of a bubble opened by
     * touch that is shortened (placeTouchBubble), under its last name ("and
     * n more"), over its last line; a tap closes the bubble and opens the
     * person's menu, as a long press on the card does. Placed anew each time
     * the bubble opens (placeBubble takes it out).
     */
    private insertMenuMoreRow(bubble: HTMLElement, personId: PersonId): void {
        const row = document.createElement('div');
        row.className = 'bubble-menu-more';
        row.setAttribute('role', 'button');
        row.textContent = strings.focus.bubbleMoreInMenu;
        row.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeOpenBubble();
            UI.showPersonBottomSheet(personId, true);
        });
        const more = bubble.querySelector<HTMLElement>(':scope > .badge-tooltip-more');
        const names = [...bubble.querySelectorAll<HTMLElement>(':scope > [data-name-group]')];
        const after = more ?? names[names.length - 1] ?? null;
        if (after) after.after(row);
        else bubble.insertBefore(row, bubble.querySelector(':scope > .badge-tooltip-action'));
    }

    /**
     * The least a bubble opened by touch shows (touchBubbleSide's `least`,
     * round 5 §38): its header, one name (with its group's line), "and n
     * more" and its last line, what a click does. Measured with the names
     * cut to one and its other lines hidden for a moment, those put back as
     * they were (the names placeTouchBubble fits again).
     */
    private bubbleLeastHeight(bubble: HTMLElement, maxNames?: number): number {
        this.fitBubbleNames(bubble, 0, maxNames, 1);
        const rows = [...bubble.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !isEssentialBubbleRow(el));
        const was = rows.map(el => el.hidden);
        rows.forEach(el => { el.hidden = true; });
        const h = bubbleOwnHeight(bubble);
        rows.forEach((el, i) => { el.hidden = was[i]; });
        return h;
    }

    /**
     * A rect inside the card as it will stand once the card's running scale
     * transition (the :hover growth) ends: scaled about the card's centre by
     * the ratio of the end scale to the present one; unchanged when none runs.
     */
    private cardGrowth(cardEl: HTMLElement | null): (rect: DOMRect) => DOMRect {
        const same = (rect: DOMRect): DOMRect => rect;
        const run = cardEl?.getAnimations?.().find(a => (a as CSSTransition).transitionProperty === 'transform');
        if (!cardEl || !run || typeof DOMMatrixReadOnly === 'undefined') return same;
        const frames = (run.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
        const end = frames[frames.length - 1]?.transform;
        if (typeof end !== 'string') return same;
        try {
            const k = new DOMMatrixReadOnly(end).a / new DOMMatrixReadOnly(getComputedStyle(cardEl).transform).a;
            if (!Number.isFinite(k) || Math.abs(k - 1) < 1e-3) return same;
            const c = cardEl.getBoundingClientRect();
            const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
            return rect => new DOMRect(cx + (rect.left - cx) * k, cy + (rect.top - cy) * k, rect.width * k, rect.height * k);
        } catch {
            return same;
        }
    }

    /** What a long press on a tab opens: the tab's bubble (bindTabBubble, bindChildrenBubble); false where it found no room (placeTouchBubble). */
    private bubbleOpeners = new WeakMap<HTMLElement, () => boolean>();

    /**
     * A long press on a card at (x, y): on a tab with a bubble, the bubble
     * opens (true); else, and where the bubble has no room even for one
     * name (round 5 §38), the card's sheet, the person's menu.
     */
    private openBubbleByTouch(x: number, y: number): boolean {
        const pill = pillUnderFinger(x, y);
        const opener = pill ? this.bubbleOpeners.get(pill) : undefined;
        return opener ? opener() : false;
    }

    /**
     * The bubble inside a tab (who, what a click does): with a mouse while
     * the pointer is over the tab, from the keyboard while the tab has the
     * focus (Escape closes it), by touch after a long press until a press
     * elsewhere (a tap on the bubble only closes it). In the top layer
     * (bubble-layer.ts); without it the stylesheet shows it on the canvas.
     */
    private bindTabBubble(host: HTMLElement, tip: HTMLElement): void {
        if (!prepareBubble(tip)) {
            host.addEventListener('mouseenter', () => this.placeBubble(host, tip));
            host.addEventListener('focus', () => this.placeBubble(host, tip));
            return;
        }
        const hover = window.matchMedia?.('(hover: hover)').matches ?? false;
        let byTouch = false;
        const close = (): void => { byTouch = false; hideBubble(tip); };
        const open = (touch = false): boolean => {
            byTouch = touch;
            showBubble(tip, host, close);
            if (this.placeBubble(host, tip, touch)) return true;
            close();
            return false;
        };
        if (hover) {
            host.addEventListener('mouseenter', () => open());
            host.addEventListener('mouseleave', () => { if (!host.matches(':focus-visible')) close(); });
        }
        host.addEventListener('focus', () => { if (host.matches(':focus-visible')) open(); });
        host.addEventListener('blur', () => { if (!(hover && host.matches(':hover'))) close(); });
        host.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || openBubble() !== tip) return;
            e.stopPropagation();
            close();
        });
        tip.addEventListener('click', (e) => {
            if (!byTouch) return;
            e.preventDefault();
            e.stopPropagation();
            close();
        });
        this.bubbleOpeners.set(host, () => open(true));
    }

    /**
     * The "▾ children" bubble beside its tab: opens while a mouse is over the
     * tab or the bubble (the way between them closes it after 150 ms, so the
     * pointer reaches the rows) and while the tab or a row has the keyboard
     * focus; while it is open the card keeps its hover look (index.html), so
     * the bubble stands still the whole way between the tab and its rows; Escape closes it and gives the focus back to the tab. While it
     * is open the person's children in view glow (§6). A row glides the view
     * to the child drawn elsewhere (§4). By touch a long press on the tab
     * opens it below the tab, until a press elsewhere.
     */
    private bindChildrenBubble(personId: PersonId, tab: HTMLElement, bubble: HTMLElement,
        glowIds: () => PersonId[] = () => (DataManager.getPerson(personId)?.childIds ?? []).filter(cid => this.positions.has(cid))): void {
        let closeTimer: ReturnType<typeof setTimeout> | null = null;
        let releaseGlow: (() => void) | null = null;
        const hover = window.matchMedia?.('(hover: hover)').matches ?? false;
        const layered = prepareBubble(bubble);
        const open = (touch = false): boolean => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            if (bubble.classList.contains('open')) return true;
            if (layered) {
                showBubble(bubble, tab, close);
            } else {
                // Measured from the edge row's right side: the row is anchored there
                // and grows to the left (the card's hover shows the relations pill
                // left of the tabs), so the bubble stays over the tab whether or not
                // the card is under the pointer — a bubble that moved with the hover
                // shows and hides under a still pointer at its edge (a hover loop).
                const row = tab.offsetParent as HTMLElement | null;
                const fromRight = (row?.clientWidth ?? 0) - (tab.offsetLeft + tab.offsetWidth / 2);
                bubble.style.left = row ? `calc(100% - ${fromRight}px)` : `${tab.offsetLeft + tab.offsetWidth / 2}px`;
            }
            if (!this.placeBubble(tab, bubble, touch)) {
                close();
                return false;
            }
            bubble.classList.add('open');
            releaseGlow = this.highlightCards(glowIds());
            return true;
        };
        const close = (): void => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            bubble.classList.remove('open');
            hideBubble(bubble);
            releaseGlow?.();
            releaseGlow = null;
        };
        if (layered) this.bubbleOpeners.set(tab, () => open(true));
        const closeSoon = (): void => {
            if (closeTimer) clearTimeout(closeTimer);
            closeTimer = setTimeout(close, CHILDREN_BUBBLE_CLOSE_MS);
        };
        if (hover) {
            for (const el of [tab, bubble]) {
                el.addEventListener('mouseenter', () => open());
                el.addEventListener('mouseleave', closeSoon);
            }
        }
        tab.addEventListener('focus', () => { if (tab.matches(':focus-visible')) open(); });
        for (const el of [tab, bubble]) {
            el.addEventListener('focusout', (e) => {
                const next = (e as FocusEvent).relatedTarget as Node | null;
                if (next && (tab.contains(next) || bubble.contains(next))) return;
                // A click on a row may take the focus from the tab without giving it to the row (Safari)
                if (hover && (bubble.matches(':hover') || tab.matches(':hover'))) return;
                close();
            });
            el.addEventListener('keydown', (e) => {
                if ((e as KeyboardEvent).key !== 'Escape' || !bubble.classList.contains('open')) return;
                e.stopPropagation();
                close();
                tab.focus();
            });
        }
        // The tab's click hides the children (a new render); the bubble's clicks are its own
        tab.addEventListener('click', close);
        bubble.addEventListener('click', (e) => e.stopPropagation());
        bubble.querySelectorAll<HTMLElement>('.children-elsewhere-row').forEach(row => {
            row.addEventListener('click', () => {
                close();
                this.showChildElsewhereStep(row.dataset.personId as PersonId);
            });
        });
        // "◎ Focus on …" of a nested expansion (§6): a new focus, no confirmation (a conscious choice)
        bubble.querySelector<HTMLElement>('.nested-focus-row')?.addEventListener('click', () => {
            close();
            void this.setFocus(personId);
        });
    }

    /**
     * The sibling-order mark of a drawn card (siblingOrderMark): the family
     * view with children shown in place. A candidate (the direct line of a
     * shown family) keeps room on its bottom-right edge whether or not the
     * layout put it out of birth order.
     */
    private siblingOrderOf(id: PersonId): SiblingOrderMark | null {
        if (!this.siblingOrderCandidate(id)) return null;
        const drops = this.dropIds();
        return siblingOrderMark(DataManager.getData(), id, this.positions, this.childrenShownSet(),
            pid => this.childrenVisibleBefore.get(pid), cid => drops.has(cid));
    }

    /**
     * The cards in view only thanks to an expansion in place (children,
     * siblings, parents beyond the depth, other partners; at every level):
     * every card a click of those brought into view, as long as it stays —
     * the children and siblings themselves, the parents and the partners
     * the layout draws with them (a parent's other partner, a shown
     * parent's further marriages). They carry the hatch of the cards shown
     * here (`shown-here`) until the step that brought them is closed. A "?"
     * stand-in keeps its own look.
     */
    private shownHereIds(): ReadonlySet<PersonId> {
        const out = new Set<PersonId>();
        if (this.viewMode !== 'family') return out;
        const data = DataManager.getData();
        const shownCard = (id: PersonId) => this.positions.has(id) && !!data.persons[id] && !data.persons[id].isPlaceholder;
        for (const brought of [this.childrenBroughtIn, this.parentsBroughtIn, this.partnersBroughtIn]) {
            for (const ids of brought.values()) for (const id of ids) if (shownCard(id)) out.add(id);
        }
        // A click rendering for the first time: what is new against the view before it
        const before = this.shownStepBefore;
        if (before) for (const id of this.positions.keys()) if (!before.has(id) && shownCard(id)) out.add(id);
        // The relatives each step promised (the bubbles' lists) are always among them
        for (const pid of this.childrenShownIds) {
            for (const cid of newlyShownChildIds(data, pid, id => this.positions.has(id), this.childrenVisibleBefore.get(pid) ?? new Set())) out.add(cid);
        }
        for (const id of this.parentsShownIds) for (const q of this.shownParentsOf(id)) out.add(q);
        for (const id of this.partnersShownIds) for (const q of this.shownPartnersOf(id)) out.add(q);
        return out;
    }

    /** The card may carry the sibling-order pill: a child its shown parent's view drew before the click. */
    private siblingOrderCandidate(id: PersonId): boolean {
        if (this.viewMode !== 'family' || this.childrenShownIds.length === 0) return false;
        const person = DataManager.getPerson(id);
        return !!person && !person.isPlaceholder && person.parentIds.some(pid =>
            this.childrenShownIds.includes(pid) && !!this.childrenVisibleBefore.get(pid)?.has(id));
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
        this.resetChildrenShown();
        this.persistViewMode();
    }

    /** Switch the display view mode and re-render. Persisted per tree. */
    setViewMode(mode: ViewMode): void {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        this.resetChildrenShown();
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
        this.history = emptyViewHistory();
        this.viewStandIn = null;
        this.historySeq++;
        this.updateNavButtons();
    }

    /** Is there a previous view to go back to? */
    canGoBack(): boolean {
        return this.history.back.length > 0;
    }

    /** Is there a view to go forward to (after going back)? */
    canGoForward(): boolean {
        return this.history.forward.length > 0;
    }

    /** The view as a history entry: the focus and the children shown (null: no focus). */
    private currentHistoryEntry(): ViewHistoryEntry | null {
        if (!this.focusPersonId) return null;
        return {
            focus: this.focusPersonId,
            shown: this.childrenShownIds.map(id => {
                const zoom = this.childrenZoom.get(id), anchorScreen = this.childrenAnchorScreen.get(id);
                const siblingsOf = [...this.siblingsShownFor].find(([, parents]) => parents.includes(id))?.[0];
                return {
                    id,
                    visibleBefore: this.childrenVisibleBefore.get(id) ?? new Set<PersonId>(),
                    broughtIn: this.childrenBroughtIn.get(id) ?? new Set<PersonId>(),
                    ...(zoom ? { zoom } : {}),
                    ...(anchorScreen ? { anchorScreen } : {}),
                    ...(siblingsOf ? { siblingsOf } : {}),
                };
            }).concat(this.parentsShownIds.map(id => {
                const zoom = this.parentsZoom.get(id), anchorScreen = this.parentsAnchorScreen.get(id);
                return {
                    id,
                    parents: true as const,
                    visibleBefore: new Set<PersonId>(),
                    broughtIn: this.parentsBroughtIn.get(id) ?? new Set<PersonId>(),
                    ...(zoom ? { zoom } : {}),
                    ...(anchorScreen ? { anchorScreen } : {}),
                    ...(this.parentsWithSiblings.has(id) ? { siblingsOf: id } : {}),
                };
            })).concat(this.partnersShownIds.map(id => {
                const zoom = this.partnersZoom.get(id), anchorScreen = this.partnersAnchorScreen.get(id);
                const partnerUnions = this.partnersShownUnions.get(id), partnerOffered = this.partnersOffered.get(id);
                return {
                    id,
                    partners: true as const,
                    visibleBefore: new Set<PersonId>(),
                    broughtIn: this.partnersBroughtIn.get(id) ?? new Set<PersonId>(),
                    ...(zoom ? { zoom } : {}),
                    ...(anchorScreen ? { anchorScreen } : {}),
                    ...(partnerUnions ? { partnerUnions: [...partnerUnions] } : {}),
                    ...(partnerOffered ? { partnerOffered } : {}),
                };
            })),
        };
    }

    /** A new step of the history: the view before it goes back, forward is cleared, ↩ shows. */
    private pushHistoryStep(before: ViewHistoryEntry | null): void {
        if (!before) return;
        pushViewStep(this.history, before);
        this.viewStandIn = null;
        this.historySeq++;
        this.updateNavButtons();
    }

    /** The pan and zoom the history takes the view for (historyView: the stand-in after a step over a new focus). */
    private historyTransform(): ViewTransform {
        return historyView(ZoomPan.getTransform(), this.viewStandIn);
    }

    /** Set the children shown in place as a history entry has them (no render). */
    private applyShownSnapshot(all: readonly ShownChildrenSnapshot[]): void {
        const parents = all.filter(s => s.parents);
        this.parentsShownIds = parents.map(s => s.id);
        this.parentsBroughtIn = new Map(parents.map(s => [s.id, s.broughtIn] as const));
        this.parentsZoom = new Map(parents.filter(s => s.zoom).map(s => [s.id, s.zoom!] as const));
        this.parentsAnchorScreen = new Map(parents.filter(s => s.anchorScreen).map(s => [s.id, s.anchorScreen!] as const));
        this.parentsWithSiblings = new Set(parents.filter(s => s.siblingsOf).map(s => s.id));
        const partners = all.filter(s => s.partners);
        this.partnersShownIds = partners.map(s => s.id);
        this.partnersBroughtIn = new Map(partners.map(s => [s.id, s.broughtIn] as const));
        this.partnersZoom = new Map(partners.filter(s => s.zoom).map(s => [s.id, s.zoom!] as const));
        this.partnersAnchorScreen = new Map(partners.filter(s => s.anchorScreen).map(s => [s.id, s.anchorScreen!] as const));
        this.partnersShownUnions = new Map(partners.filter(s => s.partnerUnions).map(s => [s.id, [...s.partnerUnions!]] as const));
        this.partnersOffered = new Map(partners.filter(s => s.partnerOffered).map(s => [s.id, [...s.partnerOffered!]] as const));
        const shown = all.filter(s => !s.parents && !s.partners);
        this.childrenShownIds = shown.map(s => s.id);
        this.childrenVisibleBefore = new Map(shown.map(s => [s.id, s.visibleBefore] as const));
        this.childrenBroughtIn = new Map(shown.map(s => [s.id, s.broughtIn] as const));
        this.childrenZoom = new Map(shown.filter(s => s.zoom).map(s => [s.id, s.zoom!] as const));
        this.childrenAnchorScreen = new Map(shown.filter(s => s.anchorScreen).map(s => [s.id, s.anchorScreen!] as const));
        this.siblingsShownFor = new Map();
        for (const s of shown) {
            if (s.siblingsOf) this.siblingsShownFor.set(s.siblingsOf, [...(this.siblingsShownFor.get(s.siblingsOf) ?? []), s.id]);
        }
        if (all.length === 0) this.childrenShownDrift.clear();
    }

    /**
     * Navigate one step through the view history. A view with another focus
     * comes back with the children it showed (centred on the focus, as a new
     * focus is; the pan and zoom it had when it was left stand in for the
     * centred view while it stays, so a jump before it goes forward to where
     * it landed); within the focus the children shown change as a click
     * changes them (the transition of §1, the step's card in place, the zoom
     * of §5 back); a jump's pan and zoom come back as they were. Outside the
     * family view a step of the children shown alone is skipped. Skips
     * persons deleted meanwhile.
     */
    private async navigateHistory(dir: 'back' | 'forward'): Promise<void> {
        const current = this.currentHistoryEntry();
        if (!current) {
            this.updateNavButtons();
            return;
        }
        this.finishChildrenTransition();
        const family = this.viewMode === 'family';
        const currentView = this.historyTransform();
        const target = stepViewHistory(this.history, dir, current, currentView,
            id => !!DataManager.getPerson(id),
            // outside the family view a step of the children alone is skipped; so is a view that is the current one
            e => e.focus !== current.focus || (family && (!sameShown(e.shown, current.shown) || !!e.view)),
            id => this.cardScreenCenter(id));
        if (!target) {
            this.updateNavButtons();
            return;
        }
        this.historySeq++;
        this.viewStandIn = null;
        if (target.focus !== current.focus) {
            this.pendingShown = target.shown;
            this.suppressHistoryPush = true;
            try {
                await this.setFocus(target.focus);
            } finally {
                this.suppressHistoryPush = false;
                this.pendingShown = null;
            }
            // Centred on the focus: the view the focus had when it was left stands in for this one
            if (target.leftView) this.viewStandIn = { view: target.leftView, landed: ZoomPan.getTransform() };
            return;
        }
        if (!sameShown(target.shown, current.shown)) {
            await this.restoreChildrenShown(current.shown, target, target.anchorId ?? target.shown[0]?.id ?? current.shown[0]?.id ?? target.focus);
        } else if (target.view) {
            this.restoreTransform(target.view);
        }
        this.updateNavButtons();
    }

    /**
     * Change the children shown from `current` to the history entry's, in one
     * render, as the click of that step would (or its opposite): the cards
     * move, grow out of their stem or shrink into it (§1); the step's card
     * keeps its place on the screen ("Hide shown children" again: the first
     * card where it stood before); the zoom of §5 goes back as closing gives
     * it back, and comes again when its scale still stands.
     */
    private async restoreChildrenShown(current: readonly ShownChildrenSnapshot[], target: ViewHistoryEntry, anchorId: PersonId): Promise<void> {
        const targetKeys = new Set(target.shown.map(shownKey));
        const currentKeys = new Set(current.map(shownKey));
        const closing = current.filter(s => !targetKeys.has(shownKey(s)));
        const opening = target.shown.filter(s => !currentKeys.has(shownKey(s)));
        // A "▸ ∞" whose names were shown one by one (round 6 §42): fewer marriages close, more open
        for (const s of current) {
            const t = target.shown.find(x => shownKey(x) === shownKey(s));
            if (!t || samePartnerUnions(s, t)) continue;
            if ((t.partnerUnions?.length ?? 0) > (s.partnerUnions?.length ?? 0)) opening.push(t);
            else closing.push(s);
        }
        const scene = this.captureChildrenScene();
        const beforeAll = new Map(this.positions);
        const anchorScreen = this.childrenAnchorScreen.get(anchorId) ?? this.parentsAnchorScreen.get(anchorId) ?? this.partnersAnchorScreen.get(anchorId);
        const involved = new Map<PersonId, ReadonlySet<PersonId>>();
        for (const s of [...closing, ...opening]) {
            if (!s.parents) involved.set(s.id, s.broughtIn);
            else for (const [q, b] of this.parentsInvolved(s.id, s.broughtIn)) if (!involved.has(q)) involved.set(q, b);
        }
        this.applyShownSnapshot(target.shown);
        await this.renderInternal();
        const dir: ChildrenTransitionDir = opening.length > 0 ? 'open' : 'close';
        const restoreView = dir === 'close' && !!target.restoreView;
        const shift = this.keepCardInPlace(anchorId, beforeAll, restoreView);
        const scale = ZoomPan.getScale();
        let zoomTo: number | null = null;
        if (dir === 'close') {
            const zooms = closing.map(s => s.zoom).filter(z => !!z);
            if (zooms.length > 0 && scale === zooms[zooms.length - 1].after) zoomTo = zooms[0].before;
        } else {
            const zooms = opening.map(s => s.zoom).filter(z => !!z);
            if (zooms.length > 0 && scale === zooms[0].before) zoomTo = zooms[zooms.length - 1].after;
        }
        // Back over "Hide shown children": the step's card where it stood before it
        const landAt = dir === 'open' && target.restoreView ? target.anchorAt ?? null : null;
        let pivot = restoreView && zoomTo !== null && anchorScreen ? this.landingPivot(anchorId, anchorScreen, zoomTo) : null;
        if (landAt && zoomTo !== null) pivot = this.landingPivot(anchorId, landAt, zoomTo);
        else if (landAt) {
            const now = this.cardScreenCenter(anchorId);
            if (now) {
                const dx = (now.x - landAt.x) / scale, dy = (now.y - landAt.y) / scale;
                ZoomPan.shiftWorld(dx, dy);
                shift.x += dx;
                shift.y += dy;
            }
        }
        const siblingsStep = opening.filter(s => s.siblingsOf === anchorId && !s.parents).map(s => s.id);
        const parentsStep = opening.some(s => s.parents && s.id === anchorId);
        const partnersStep = opening.some(s => s.partners && s.id === anchorId);
        const glow = dir !== 'open' ? undefined
            : partnersStep ? () => this.highlightCards(this.shownPartnersOf(anchorId), CHILDREN_GLOW_MS)
            : parentsStep ? () => this.glowParents(anchorId, siblingsStep)
                : siblingsStep.length > 0 ? () => this.glowShown(siblingsStep, anchorId)
                    : opening.some(s => s.id === anchorId) ? () => this.glowShown([anchorId], null) : undefined;
        this.playChildrenTransition(scene, dir, anchorId, shift, involved, zoomTo, glow, pivot);
    }

    /** Put the pan and zoom back as a history entry has them (at once). */
    private restoreTransform(view: ViewTransform): void {
        ZoomPan.finishAnimation();
        ZoomPan.zoomAroundWorldPoint(0, 0, view.scale, 0, t => t);
        const t = ZoomPan.getTransform();
        ZoomPan.shiftWorld((t.tx - view.tx) / t.scale, (t.ty - view.ty) / t.scale);
    }

    /**
     * Run a move of the view to a card drawn elsewhere (a line link's
     * "child ↗", a row of "Already in the tree elsewhere") as a step of the
     * history: the pan and zoom before it come back with ↩. `move` says
     * whether it moves the view (a glide still under way counts); one that
     * moves nothing (the cards stood in view) adds no step.
     */
    private jumpStep(move: () => boolean): void {
        const before = this.currentHistoryEntry();
        const view = ZoomPan.getTransform();
        if (move() && before) this.pushHistoryStep({ ...before, view });
    }

    /** Move the view to a child drawn elsewhere in the tree (§4), as a step of the history. */
    showChildElsewhereStep(childId: PersonId): void {
        this.jumpStep(() => this.showChildElsewhere(childId));
    }

    /**
     * The line-link tabs of a card ("parents ↗", "child ↗", "children ↗"),
     * in the card's order, each with the people at the other end of its
     * left-out line (the person menu's "↗ Go to …" rows, round 6 §40).
     */
    lineJumpsOf(personId: PersonId): Array<{ kind: 'linkParents' | 'linkChild' | 'linkChildren'; ids: PersonId[] }> {
        const links = this.lineLinks.get(personId);
        return lineLinkTabs(links).map(kind => ({ kind, ids: [...(kind === 'linkParents' ? links!.parentIds : links!.childIds)] }));
    }

    /** What a card's line-link tab does (lineLinkTabHtml): the view to the other end, as a step of the history; the focus stays. */
    jumpAlongLine(personId: PersonId, toParents: boolean): void {
        const links = this.lineLinks.get(personId);
        if (!links) return;
        this.jumpStep(() => this.jumpToPersons(toParents ? links.parentIds : links.childIds));
    }

    /**
     * A focus set from a card's tab (§2: ◎ parents / siblings / family,
     * "+ family"): the tree is rebuilt around the person and the confirmation
     * "◎ Focused on {name} | ↩ Back" offers the previous view. A focus from
     * the menu, the fan, the timeline or the search is a choice of its own
     * and goes without it (setFocus).
     */
    async focusFromTab(personId: PersonId): Promise<void> {
        const person = DataManager.getPerson(personId);
        if (!person || personId === this.focusPersonId) return this.setFocus(personId);
        await this.setFocus(personId);
        if (this.focusPersonId !== personId || !this.canGoBack()) return;
        showFocusToast(shownNameFull(person, '?'), () => { void this.goBack(); });
    }

    /** Navigate to the previous view (browser back); resolves once the view is drawn and placed. */
    goBack(): Promise<void> {
        return this.navigateHistory('back');
    }

    /** Navigate to the next view after going back (browser forward). */
    goForward(): Promise<void> {
        return this.navigateHistory('forward');
    }

    /** Show/hide the floating back & forward buttons to match history state. */
    updateNavButtons(): void {
        const canBack = this.canGoBack();
        const canForward = this.canGoForward();
        const back = document.getElementById('focus-back-btn');
        if (back) back.style.display = canBack ? '' : 'none';
        const fwd = document.getElementById('focus-forward-btn');
        if (fwd) fwd.style.display = canForward ? '' : 'none';
        // The legend pill shares the bottom-left corner: it moves above the buttons while they show.
        document.body.classList.toggle('focus-nav-shown', canBack || canForward);
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
        this.updateChildrenShownUI();
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
    getPosterLayout(opts: { includeView?: boolean } = {}): {
        positions: Map<PersonId, Position>; connections: Connection[]; spouseLines: SpouseLine[]; omittedEdges: OmittedEdge[];
    } {
        if (!opts.includeView) {
            const { positions, connections, spouseLines, omittedEdges } = this.outputLayout();
            return { positions, connections, spouseLines, omittedEdges };
        }
        return {
            positions: this.positions,
            connections: this.withoutEdgeRoom(this.connections, this.edgeRoomIds),
            spouseLines: this.spouseLines,
            omittedEdges: this.omittedEdges,
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
        const shownHere = this.shownHereIds();

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
            if (shownHere.has(id)) classes += ' shown-here';
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
                if (target.closest('.hidden-partners-btn')) return;
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
            UI.attachCardLongPress(card, id, (x, y) => this.openBubbleByTouch(x, y));

            // The name as shown: the given name with the title before it, the
            // person's own lastName (maiden name for women) with the title
            // after it (src/person-name.ts) — the two lines of a split name.
            // With a married surname and Settings → "Surname display" on 'both',
            // the birth surname is a quiet row of its own (.card-birth) on the
            // normal and the field cards; never on the compact one.
            const { given: displayName, surname: displaySurname, birthNote } = shownNameParts(person, '?');
            // Tooltip and screen reader: the whole name with the note ("Marie Nováková (roz. Dvořáková)").
            const fullTitle = shownNameFull(person, '?');

            // Birth year for the card meta row (the year range replaces the dagger).
            const birthYear = person.birthDate ? displayYear(person.birthDate) : '';

            const partnerships = DataManager.getPartnerships(id);

            // Hidden parents, siblings (children of a union, as the layout
            // counts them) or children: a branch tab each (one rule with the
            // marriage-order pill's layout, src/marriage-order.ts).
            const hiddenTabs = this.relativesTabs(id, partnershipChildIds);
            const hasHiddenChildren = hiddenTabs.includes('children');
            const childrenShown = hiddenTabs.includes('childrenShown');
            // Siblings in place (a parent in view, §1): "▸ siblings" / "▾ siblings"
            const siblingsHere = hiddenTabs.includes('siblingsHere');
            const siblingsShown = hiddenTabs.includes('siblingsShown');

            let html = '';

            // The descendants chart hides relatives BY DESIGN — "hidden relative"
            // badges would be noise there, and their click action (re-focus)
            // changes nothing inside the filtered view. Skip them entirely.
            const showHiddenBadges = this.viewMode !== 'descendants';

            // Branch tabs (top-right edge slot): one pill per hidden direction,
            // in the order of the generations (parents, siblings, children; a
            // line link at its relation's place, branchTabsInOrder), each in
            // the look of what its click does (§2: in place, focus, jump).
            // Built into a string here; assembled into the edge container below.
            let branchTabsHtml = '';
            const tabHtml = new Map<BranchTab, string>();
            if (showHiddenBadges) {
                // Parents folded away for children shown in place (§2): the dashed
                // tab hides those children again and brings the parents back
                const foldedBy = hiddenTabs.includes('parentsFolded') ? this.foldedFor.get(id) : undefined;
                const foldedByPerson = foldedBy ? DataManager.getPerson(foldedBy) : null;
                if (foldedBy && foldedByPerson) {
                    const byName = shownNameFull(foldedByPerson, '?');
                    tabHtml.set('parentsFolded', `<button type="button" class="branch-tab kind-place folded" data-action="unfold-parents" data-shown-id="${this.escapeHtml(foldedBy)}" aria-label="${this.escapeHtml(strings.focus.parentsFoldedAria(byName))}">`
                        + branchTabRestHtml('parentsFolded')
                        + `<div class="badge-tooltip"><div class="badge-tooltip-header">${strings.focus.parentsFoldedHeader}</div>`
                        + `<div class="badge-tooltip-body">${this.escapeHtml(strings.focus.parentsFoldedBody(byName))}</div>`
                        + `<div class="badge-tooltip-action">${strings.focus.parentsFoldedHint}</div></div></button>`);
                }
                // An ancestor at the edge of the depth (§4): its parents in place
                const parentsPlace = hiddenTabs.includes('parentsShown') ? 'parentsShown' : hiddenTabs.includes('parentsHere') ? 'parentsHere' : null;
                if (parentsPlace) tabHtml.set(parentsPlace, this.parentsTabHtml(id, parentsPlace === 'parentsShown', fullTitle, this.isNestedShown(id, shownHere, 'other')));
                // The family of origin out of view (no anchor in it): a focus on the person (§4)
                for (const kind of ['family', 'parents', 'siblings'] as const) {
                    if (hiddenTabs.includes(kind)) tabHtml.set(kind, this.focusTabHtml(id, kind, partnershipChildIds));
                }
                if (siblingsHere || siblingsShown) {
                    tabHtml.set(siblingsShown ? 'siblingsShown' : 'siblingsHere',
                        this.siblingsTabHtml(id, siblingsShown, fullTitle, partnershipChildIds, siblingsShown && this.isNestedShown(id, shownHere, 'siblings')));
                }
                // Children: shown in place and hidden again (the view stays)
                if (hasHiddenChildren || childrenShown) {
                    // Shown: only the children the click brought into view
                    const ids = childrenShown
                        ? newlyShownChildIds(DataManager.getData(), id, cid => this.positions.has(cid), this.childrenVisibleBefore.get(id) ?? new Set())
                        : hiddenChildIds(DataManager.getData(), id, cid => this.positions.has(cid));
                    const childItems = this.childrenByUnionHtml(id, ids);
                    const header = childrenShown ? strings.focus.childrenShownTooltip : strings.focus.hiddenChildrenTooltip;
                    // Children of a union whose partner is out of view bring the partner along (§5)
                    const hint = childrenShown ? strings.focus.placeHideHint
                        : childrenComeWithPartners(DataManager.getData(), id, ids, cid => this.positions.has(cid))
                            ? strings.focus.childrenWithPartnersHint : strings.focus.placeShowHint;
                    const aria = (childrenShown ? strings.focus.childrenTabHideAria : strings.focus.childrenTabShowAria)(fullTitle);
                    // Children the view draws elsewhere in the tree (§4): counted
                    // before the click; after it, rows that glide to them
                    const elsewhere = this.childrenElsewhereOf(id);
                    const kind = childrenShown ? 'childrenShown' : 'children';
                    const button = `<button type="button" class="branch-tab children-tab kind-place${childrenShown ? ' active' : ''}" data-action="toggle-children" aria-pressed="${childrenShown}" aria-label="${this.escapeHtml(aria)}">`
                        + branchTabRestHtml(kind);
                    if (!childrenShown) {
                        const elsewhereLine = elsewhere.length ? `<div class="badge-tooltip-elsewhere">${this.escapeHtml(strings.focus.childrenElsewhereCount(elsewhere.length))}</div>` : '';
                        tabHtml.set(kind, `${button}<div class="badge-tooltip"><div class="badge-tooltip-header">${header}</div>${childItems}${elsewhereLine}<div class="badge-tooltip-action">${hint}</div></div></button>`);
                    } else {
                        // The bubble beside the tab, not in it: its rows are buttons of their own
                        const elsewhereHtml = this.elsewhereSectionHtml(elsewhere);
                        // The ancestors folded away for these children (§2)
                        const foldedHtml = (this.foldedAncestorsOf.get(id) ?? [])
                            .map(qid => DataManager.getPerson(qid))
                            .filter((q): q is Person => q !== null)
                            .map(q => `<div class="badge-tooltip-folded">${this.escapeHtml(strings.focus.childrenShownFoldedLine(shownNameFull(q, '?')))}</div>`)
                            .join('');
                        const nestedHtml = this.isNestedShown(id, shownHere, 'children') ? this.nestedFocusHtml(id) : '';
                        tabHtml.set(kind, `${button}</button><div class="badge-tooltip children-bubble" data-bubble="children"><div class="badge-tooltip-header">${header}</div>${childItems}${foldedHtml}${elsewhereHtml}${nestedHtml}<div class="badge-tooltip-action">${hint}</div></div>`);
                    }
                }
            }

            // Line links (in every view, the descendants chart too): a line the
            // layout left out because it could not be drawn without crossing or
            // running along another family's line (step 7). A click jumps to
            // the other end.
            const linkTabs = lineLinkTabs(this.lineLinks.get(id));
            for (const kind of linkTabs) tabHtml.set(kind, this.lineLinkTabHtml(id, kind));
            const tabKinds = branchTabsInOrder(showHiddenBadges ? hiddenTabs : [], linkTabs);
            for (const kind of tabKinds) branchTabsHtml += tabHtml.get(kind) ?? '';

            // Other partners (bottom-left edge slot, §5): "▸ ∞ N" shows the
            // partners of unions without children in place, "▾ ∞ N" hides them.
            const partnersPill = this.partnersPillOf(id, pid => this.positions.has(pid));
            const hiddenIndicatorsHtml = partnersPill
                ? this.partnersPillHtml(id, partnersPill, fullTitle, partnersPill.shown && this.isNestedShown(id, shownHere, 'other')) : '';

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
            const initials = personInitials(person.firstName, shownNameParts(person, '', false).surname) || '?';

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
            const nameAttrs = `title="${this.escapeHtml(fullTitle)}" data-given="${this.escapeHtml(displayName)}" data-surname="${this.escapeHtml(displaySurname)}"`;
            const nameHtml = `<div class="name"><span class="name-text" ${nameAttrs}>${this.escapeHtml(fullName)}</span></div>`;
            const head = customLines ? this.customHeads.get(id) : undefined;
            // The birth surname's row (only with a note: no note, no element).
            const birthHtml = birthNote && density !== 'compact'
                ? `<div class="card-birth" data-birth="${this.escapeHtml(birthNote)}">${this.escapeHtml(birthNoteText(birthNote))}</div>` : '';

            // Custom: the avatar and the name (and the years under it) on one
            // row, then one line per chosen event (src/card-fields.ts). When
            // details may wrap, a long name takes the two rows computed with
            // the card's height (src/card-width.ts), as the image export does.
            html += customLines ? `
                <div class="card-body card-body--custom">
                    <div class="card-head${head?.years ? ' card-head--years' : ''}">${avatarHtml}<div class="card-head-text">${head && this.customWrapped
                        ? `<div class="name name--rows"><span class="name-text" ${nameAttrs}>${head.name.map(r =>
                            `<span class="name-row">${this.escapeHtml(r)}</span>`).join('')}</span></div>`
                        : nameHtml}${birthHtml}${head?.years ? `<div class="card-years">${this.escapeHtml(head.years)}</div>` : ''}</div></div>
                    <div class="card-lines${this.customWrapped ? ' card-lines--rows' : ''}">${customLines.map(l => {
                        const rows = this.customRows.get(l);
                        return cardLineHtml(l, t => this.escapeHtml(t), !!rows?.cut, this.customWrapped ? rows : undefined, this.customStyle,
                            !!rows?.longDate);
                    }).join('')}</div>
                </div>` : `
                ${avatarHtml}
                <div class="card-body">
                    ${nameHtml}${birthHtml}
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
                            <div class="cross-tree-tooltip-reason">${this.escapeHtml(CrossTree.matchReasonsText(m))}</div>
                        </div>`
                    ).join('');
                    const moreCount = crossTreeMatches.length > 5 ? crossTreeMatches.length - 5 : 0;

                    // A jump (§2): "⇄ N ↗" in the jump's look, its bubble names the trees and what a click does
                    crossTreeHtml = `<div class="cross-tree-badge kind-jump" data-person-id="${this.escapeHtml(id)}" aria-label="${this.escapeHtml(strings.crossTree.badgeTitle(crossTreeMatches.length))}">
                        <span class="pill-glyph">⇄</span><span class="pill-count">${crossTreeMatches.length}</span><span class="pill-glyph pill-jump" aria-hidden="true">↗</span>
                        <div class="cross-tree-tooltip">
                            <div class="cross-tree-tooltip-header">${this.escapeHtml(strings.crossTree.badgeTitle(crossTreeMatches.length))}</div>
                            ${tooltipItems}
                            ${moreCount > 0 ? `<div class="cross-tree-tooltip-item">${strings.crossTree.moreMatches(moreCount)}</div>` : ''}
                            <div class="cross-tree-tooltip-hint badge-tooltip-action">${strings.focus.crossTreeHint}</div>
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
            // Tabs too wide for the card (§3): the short forms, then the glyphs alone (the whole card at once)
            const formClass = tabsFormClass(tabsForm(tabKinds, this.tabRoom(id, card.classList.contains('has-signal'))));
            if (chainHtml || rightOrderHtml || branchTabsHtml) html += `<div class="card-edge edge-top-right${formClass ? ` ${formClass}` : ''}">${chainHtml}${rightOrderHtml}${branchTabsHtml}</div>`;
            // Above the tabs: placed from the card's padding edge (the border inside the box).
            if (orderSlot?.row === 'above') html += `<div class="card-edge edge-top-above" style="left:${(orderSlot.x - orderSlot.border).toFixed(2)}px">${orderHtml}</div>`;
            if (hiddenIndicatorsHtml) {
                html += `<div class="card-edge edge-bottom-left">${hiddenIndicatorsHtml}</div>`;
                // The pills reach 9 px into the card: a card of details is measured taller for them.
                card.classList.add('has-edge-bl');
            }
            // A card of one height wrapped its last line clear of the ∞ pill (index.html .edge-bl-room)
            if (this.edgeLeftIds.has(id)) card.classList.add('edge-bl-room');
            // The sibling-order pill (§3): the direct-line card out of its birth place among the shown siblings
            const siblingOrder = this.siblingOrderOf(id);
            const siblingOrderHtml = siblingOrder
                ? `<span class="sibling-order-pill" aria-hidden="true"><span class="so-text">${this.escapeHtml(strings.focus.siblingOrderPill(siblingOrder.n, siblingOrder.total))}</span>`
                    + `<span class="badge-tooltip so-tip">${this.escapeHtml(strings.focus.siblingOrderTooltip(siblingOrder.n, siblingOrder.total))}</span></span>`
                : '';
            if (siblingOrder) card.setAttribute('aria-label', `${card.getAttribute('aria-label') ?? ''}. ${strings.focus.siblingOrderTooltip(siblingOrder.n, siblingOrder.total)}`);
            // A candidate keeps the pill's room whether or not the pill is drawn (measured before the layout)
            const siblingRoom = this.siblingOrderCandidate(id);
            if (crossTreeHtml || siblingOrderHtml) {
                html += `<div class="card-edge edge-bottom-right">${siblingOrderHtml}${crossTreeHtml}</div>`;
                // The pill reaches 9 px into the card: the status stripes rise above it.
                card.classList.add('has-edge-br');
            }
            // The room on the card: where the pill stands, or where a card of one height was wrapped for it
            if (siblingOrderHtml || (siblingRoom && this.edgeRightIds.has(id))) {
                card.classList.add('has-edge-br');
                card.style.setProperty('--edge-br-room', `${SIBLING_ORDER_PILL_RIGHT + (crossTreeHtml ? CARD_EDGE_PILL_RIGHT : 0)}px`);
            }
            const rightPills = !!crossTreeHtml || siblingRoom;
            // A card of details measured with the pills' room keeps its text above them (index.html .has-edge-room).
            if (this.edgeRoomIds.has(id)) card.classList.add('has-edge-room');
            if (measuresEdgeRoom && this.edgeRoomIds.has(id) !== !!(hiddenIndicatorsHtml || rightPills)) edgeRoomStale = true;
            // A card of one height: its last line wrapped clear of the ⇄ pill exactly when the pill is there.
            if (customLines?.length && !measuresEdgeRoom && this.edgeRightIds.has(id) !== rightPills) edgeRoomStale = true;
            if (customLines?.length && !measuresEdgeRoom && this.edgeLeftIds.has(id) !== !!hiddenIndicatorsHtml) edgeRoomStale = true;
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
            //   4. ∞ partner · N children, a line per union   [when either exists]
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

            // Relationship summary (T37): one line per union in the order of
            // the marriages, numbered as the marriage-order pills count them
            // when there are two or more ("1. ∞ 1857 Jiří Klaus · 6 dětí"),
            // each with that union's children; at most three, then "and N
            // more"; children outside them on a line of their own.
            const ttRelLines: string[] = [];
            const ttUnions = unionSummaries(DataManager.getData(), id);
            const TT_MAX_UNIONS = 3;
            const ttNumbered = ttUnions.unions.length > 1;
            for (const u of ttUnions.unions.slice(0, TT_MAX_UNIONS)) {
                const pp = u.partnerId ? DataManager.getPerson(u.partnerId) : null;
                const head = ttNumbered
                    ? `${strings.focus.unionOrdinal(u.number)} ∞${u.year ? ` ${u.year}` : ''}` : '∞';
                const bits = [this.escapeHtml(`${head} ${pp ? shownName(pp, '?') : '?'}`)];
                if (u.childCount > 0) bits.push(strings.tooltip.childrenCount(u.childCount));
                ttRelLines.push(bits.join(' · '));
            }
            if (ttUnions.unions.length > TT_MAX_UNIONS) {
                ttRelLines.push(strings.tooltip.moreUnions(ttUnions.unions.length - TT_MAX_UNIONS));
            }
            if (ttUnions.otherChildren > 0) {
                ttRelLines.push(ttUnions.unions.length > 0
                    ? strings.tooltip.moreChildrenCount(ttUnions.otherChildren)
                    : strings.tooltip.childrenCount(ttUnions.otherChildren));
            }

            const ttSignals = this.tooltipSignalRows(signals);
            // A ghost's last row: linked in the view only, by which hypothesis and version.
            const ttViewLink = ghostOf
                ? `<div class="tt-line tt-view-link"><span class="view-link-icon" aria-hidden="true"></span>${this.escapeHtml(strings.viewLinks.tooltip(ghostOf.hypo, ghostOf.variant))}</div>`
                : '';
            if (ttBirthLine || ttDeathLine || ttRelLines.length > 0 || ttSignals || ttViewLink) {
                const rows = [
                    `<div class="tt-name">${this.escapeHtml(fullTitle)}</div>`,
                    ttBirthLine ? `<div class="tt-line">${this.escapeHtml(ttBirthLine)}</div>` : '',
                    ttDeathLine ? `<div class="tt-line">${this.escapeHtml(ttDeathLine)}</div>` : '',
                    ttRecorded ? `<div class="tt-line tt-warn">${this.escapeHtml(ttRecorded)}</div>` : '',
                    ...ttRelLines.map(line => `<div class="tt-line tt-rel">${line}</div>`),
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

            // The bubbles inside the tabs (hover, keyboard) open below when there is no room above
            card.querySelectorAll<HTMLElement>('.branch-tab, .hidden-partners-btn').forEach(host => {
                const tip = host.querySelector<HTMLElement>(':scope > .badge-tooltip');
                if (tip) this.bindTabBubble(host, tip);
            });

            // The children tab shows (hides) the children in place
            const childrenTab = card.querySelector<HTMLElement>('.branch-tab.children-tab');
            childrenTab?.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.toggleChildrenShown(id);
            });
            const childrenBubble = card.querySelector<HTMLElement>('.children-bubble[data-bubble="children"]');
            if (childrenTab && childrenBubble) this.bindChildrenBubble(id, childrenTab, childrenBubble);
            // The siblings tab in place (§1): the parents' children, one step
            const siblingsTab = card.querySelector<HTMLElement>('.branch-tab.siblings-tab');
            siblingsTab?.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.toggleSiblingsShown(id);
            });
            const siblingsBubble = card.querySelector<HTMLElement>('.siblings-bubble');
            if (siblingsTab && siblingsBubble) {
                this.bindChildrenBubble(id, siblingsTab, siblingsBubble, () => this.shownSiblingsInView(id));
            }
            // The parents tab in place (§4): the parents beyond the depth, one step
            const parentsTab = card.querySelector<HTMLElement>('.branch-tab.parents-tab');
            parentsTab?.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.toggleParentsShown(id);
            });
            // Its bubble beside it when nested (§6: "◎ Focus on …")
            const parentsBubble = card.querySelector<HTMLElement>('.children-bubble[data-bubble="parents"]');
            if (parentsTab && parentsBubble) this.bindChildrenBubble(id, parentsTab, parentsBubble, () => this.shownParentsOf(id));
            // The dashed "▸ parents" (§2): hide the children that folded the parents away
            card.querySelector<HTMLElement>('.branch-tab.folded')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const shownId = (e.currentTarget as HTMLElement).dataset.shownId as PersonId | undefined;
                if (shownId && this.isChildrenShown(shownId)) void this.closeChildrenShown([shownId], shownId);
            });
            // The focus tabs (◎ parents / siblings / family) focus on this person, with ↩ offered
            card.querySelectorAll('.branch-tab.kind-focus').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.stopPropagation();
                    void this.focusFromTab(id);
                });
            });
            // Line links jump to the other end of the left-out line; the focus stays
            card.querySelectorAll<HTMLElement>('.branch-tab.line-link').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.jumpAlongLine(id, tab.dataset.action === 'jump-parents');
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

            // ∞ other partners (§5): shown here and hidden again, the view stays
            const partnersBtn = card.querySelector<HTMLElement>('.hidden-partners-btn');
            partnersBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.togglePartnersShown(id);
            });
            const partnersBubble = card.querySelector<HTMLElement>('.children-bubble[data-bubble="partners"]');
            if (partnersBtn && partnersBubble) this.bindChildrenBubble(id, partnersBtn, partnersBubble, () => this.shownPartnersOf(id));
            // A name in its bubble shows that partner alone (round 6 §42); the row below the ones shown hides them
            partnersBubble?.querySelectorAll<HTMLElement>('.partner-pick').forEach(row => {
                row.addEventListener('click', () => {
                    closeOpenBubble();
                    void this.showPartnerHere(id, row.dataset.partnershipId as PartnershipId);
                });
            });
            partnersBubble?.querySelector<HTMLElement>('.partner-hide-row')?.addEventListener('click', () => {
                closeOpenBubble();
                void this.closeShown([], [], id, false, [id]);
            });

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
        // Fitted in the fallback font before the card fonts were in: fit again
        // once they are (the serif name is wider, it would end up clipped).
        cardFontsPending()?.then(() => { if (canvas.isConnected) this.fitCardNames(canvas); });
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
        // overflow, even sub-pixel ("Maria Laroulková" is 128.14px in a
        // 128px column — clipped to "Maria Laroulko…"), while the integer
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
        if (density === 'compact' || isFieldCardDensity(density)) {
            this.fitCardBirths(canvas);
            return;
        }

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
        this.fitCardBirths(canvas);
    }

    /**
     * The birth surname's row under a name ("roz. Dvořáková", .card-birth)
     * shortens with "…" (CSS); when less than 4 letters of the surname would
     * show, the row is left out (the full name stays in the tooltip). Reads
     * only after the name has been fitted, one layout for all cards.
     */
    private fitCardBirths(canvas: HTMLElement): void {
        const rows = [...canvas.querySelectorAll<HTMLElement>('.person-card .card-birth')];
        if (!rows.length) return;
        rows.forEach(el => el.classList.remove('is-dropped'));
        const drop: HTMLElement[] = [];
        for (const el of rows) {
            const text = el.firstChild;
            const box = el.getBoundingClientRect().width;
            if (!text || text.nodeType !== Node.TEXT_NODE || box === 0) continue;
            const full = text.textContent ?? '';
            const birth = el.dataset.birth ?? '';
            // "roz. " and the surname's first 4 letters, and the ellipsis after them when the rest is cut.
            const keep = Math.min(full.length, full.length - birth.length + Math.min(4, birth.length));
            const range = document.createRange();
            range.setStart(text, 0);
            range.setEnd(text, full.length);
            const fullW = range.getBoundingClientRect().width;
            if (fullW <= box + 0.01) continue;
            range.setEnd(text, keep);
            const keepW = range.getBoundingClientRect().width;
            const ellipsisW = keepW / Math.max(1, keep);
            if (keepW + ellipsisW > box) drop.push(el);
        }
        drop.forEach(el => el.classList.add('is-dropped'));
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
            // The stand-in partner of a single parent (src/single-parent.ts) is no parent: with the mother
            // alone in the tree, "father not given" still shows on the father's side.
            const parents = p.parentIds.filter(pid => !DataManager.getPerson(pid)?.isPlaceholder).length;
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
        let group: Map<PersonId, number> | null = null;
        const familyOf = (refn: string): number | undefined => {
            const pid = byRefn.get(refn);
            if (!pid) return undefined;
            group ??= familyGroups(DataManager.getData());
            return group.get(pid);
        };
        const personOf = (refn: string): Person | null => {
            const pid = byRefn.get(refn);
            return pid ? DataManager.getPerson(pid) : null;
        };
        for (const [id, v] of this.edgeViews) {
            const person = DataManager.getPerson(id);
            // The island's own edges point back to the tree: the tree's side draws the link.
            if (!person || person.research?.island || v.kind === 'proof' || v.named) continue;
            const tip = this.edgeStubTip(id);
            if (!tip) continue;
            let hypo: ResearchEdgeHypo | undefined, families: EdgeHypoFamilyLink[] = [];
            for (const h of person.research?.edge?.hypos ?? []) {
                if (!h.join) continue;
                families = edgeHypoFamilies(h, personOf, familyOf);
                if (families.length > 0) { hypo = h; break; }
            }
            if (!hypo) continue;
            // A family shown "linked in the view only" stands linked: no pill, no curve to any.
            if (families.some(f => this.viewLayer?.ghostOf.has(byRefn.get(f.join)!))) continue;
            const several = families.length > 1;
            // Families drawn: a curve to each; the rest one pill at the stub's end.
            const away = families.filter(f => !this.positions.has(byRefn.get(f.join)!));
            for (const f of families.filter(x => !away.includes(x))) {
                const joinId = byRefn.get(f.join)!;
                const target = this.positions.get(joinId)!;
                const pill = document.createElement('button');
                pill.type = 'button';
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
                // Several families: which version reaches this one.
                pill.textContent = re.linkPill(several && f.variants.length > 0 ? `${hypo.id} ${f.variants.join(', ')}` : hypo.id);
                // The curve's midpoint (t = 0.5 of the cubic above).
                pill.style.left = `${(tip.x + tx) / 2}px`;
                pill.style.top = `${0.125 * tip.y + 0.75 * midY + 0.125 * ty}px`;
                pill.dataset.edgePerson = id;
                pill.dataset.edgeHypo = hypo.id;
                canvas.appendChild(pill);
                UI.bindEdgeLinkPill(id, pill, joinId, hypo.id);
            }
            if (away.length === 0) continue;
            const pill = document.createElement('button');
            pill.type = 'button';
            if (away.length > 1) {
                // One of several: the pill offers each (src/ui/view-links-ui.ts).
                pill.className = 'edge-link-pill edge-link-pill--family edge-link-pill--families';
                pill.textContent = re.familiesPill(away.length);
                pill.setAttribute('aria-label', re.familiesPillSr(away.length));
            } else {
                // As many people as reaching the family shows (its own count, not the hypothesis').
                const size = away[0].size;
                if (!size) continue;
                pill.className = 'edge-link-pill edge-link-pill--family';
                pill.textContent = re.familyPill(size);
                pill.setAttribute('aria-label', re.familyPillSr(size));
            }
            pill.style.left = `${tip.x}px`;
            pill.style.top = `${tip.y - 4}px`;
            pill.dataset.edgePerson = id;
            pill.dataset.edgeHypo = hypo.id;
            canvas.appendChild(pill);
            UI.bindEdgeLinkPill(id, pill, byRefn.get(away[0].join)!, hypo.id, away.length > 1
                ? away.map(f => ({ personId: byRefn.get(f.join)!, variants: f.variants, size: f.size })) : undefined);
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
        // A linked tree that shows materials: "Materials N" in place of the attachments.
        const files = s.materials ?? s.attachments;
        if (s.story || files > 0) {
            const bits: string[] = [];
            if (s.story) bits.push(storySignalText(s.story, c.story));
            if (files > 0) bits.push(s.materials !== null ? c.ttMaterials(files) : c.ttAttachments(files));
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
        const parts = [shownNameFull(person)];
        if (s.showEvidence && s.evidence) parts.push(c.ariaEv[s.evidence.level]);
        if (s.showStory && s.story) parts.push(storySignalText(s.story, c.story));
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

    /** The timeline's last markup (a redraw with nothing new leaves the DOM alone). */
    private timelineHtml = '';

    private renderTimeline(container: HTMLElement): void {
        // Delegate bar clicks once (safe against odd person ids in JSON imports).
        if (!container.dataset.wired) {
            container.dataset.wired = '1';
            // A cluster of the history row (§9): the card on its first event, a sheet on a phone.
            const histCluster = (e: Event): boolean => {
                const c = (e.target as Element).closest('.tl-hist[data-hist-ids]');
                const personId = c?.closest('[data-hist-person]')?.getAttribute('data-hist-person');
                if (!c || !personId) return false;
                const ids = (c.getAttribute('data-hist-ids') ?? '').split(' ').filter(Boolean).map(decodeURIComponent);
                UI.openTimelineHistory(personId, ids);
                return true;
            };
            container.addEventListener('click', (e) => {
                if (histCluster(e)) return;
                const g = (e.target as Element).closest('[data-person-id]') as HTMLElement | null;
                if (g?.dataset.personId) this.setFocus(g.dataset.personId as PersonId);
            });
            container.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (!(e.target as Element).matches?.('.tl-hist')) return;
                e.preventDefault();
                histCluster(e);
            });
            // The history row follows what the card's layer shows (a read, a hiding, the chip, Settings).
            window.addEventListener(HISTORY_CHANGED_EVENT, () => {
                if (this.viewMode === 'timeline' && container.isConnected) this.renderTimeline(container);
            });
        }

        const ids = [...this.positions.keys()] as unknown as string[];
        const todayYear = new Date().getFullYear();
        // Only the focused person's history (the card's events): nothing is computed for the others.
        const history = UI.timelineHistory(this.focusPersonId);
        const model = computeTimelineModel(DataManager.getData(), ids, todayYear, history ? { history } : {});
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
            narrow: isMobile,
        });

        // Nothing changed (a status that brought nothing new for the row): the DOM stays.
        const html = `${omitted}${empty}${svg}`;
        if (html === this.timelineHtml && container.firstElementChild) return;
        this.timelineHtml = html;
        // A redraw keeps the keyboard on the history cluster it was on.
        const focusedCluster = (document.activeElement as Element | null)?.closest?.('#timeline-container .tl-hist')?.getAttribute('data-hist-ids');
        container.innerHTML = html;
        if (focusedCluster) {
            container.querySelector<SVGGElement>(`.tl-hist[data-hist-ids="${CSS.escape(focusedCluster)}"]`)?.focus({ preventScroll: true });
        }
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
        const tabsOf = new Map<PersonId, BranchTab[]>();
        for (const id of badges.keys()) {
            // The line links show in every view (the descendants chart too)
            const hidden = showTabs ? this.relativesTabs(id, unionChildIds) : [];
            tabsOf.set(id, branchTabsInOrder(hidden, lineLinkTabs(this.lineLinks.get(id))));
        }
        const formOf = new Map([...tabsOf].map(([id, kinds]) => {
            const person = DataManager.getPerson(id);
            const signals = person ? cardSignalInfo(person, signalCtx) : null;
            return [id, tabsForm(kinds, this.tabRoom(id, !!signals && (!!signals.action || signals.showAgent || signals.doneSince !== null)))];
        }));
        const rowsByForm = new Map((['full', 'short', 'glyph'] as const).map(form =>
            [form, measureTabRows([...tabsOf].filter(([id]) => formOf.get(id) === form).map(([, kinds]) => kinds), form)]));
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
                rightTabs: rowsByForm.get(formOf.get(id) ?? 'full')?.get(rowKey(tabsOf.get(id)!, formOf.get(id) ?? 'full')) ?? 0,
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

    /**
     * The room of a card's top-edge tabs (tabsForm): the card's width
     * less both corner insets, the compact card's 8px beside a status badge.
     */
    private tabRoom(id: PersonId, signal: boolean): number {
        const border = id === this.focusPersonId ? 2 : 1;
        const badge = signal && SettingsManager.getCardDensity() === 'compact' ? 8 : 0;
        return this.config.cardWidth - 2 * (border + EDGE_INSET) - badge;
    }

    /**
     * A line-link tab of a card (lineLinkTabs, §2: a jump, "parents ↗"): the
     * branch-tab pill, its bubble naming the people at the other end of the
     * left-out line and what a click does (the view moves, the tree stays).
     */
    private lineLinkTabHtml(id: PersonId, kind: BranchTab): string {
        const links = this.lineLinks.get(id);
        if (!links) return '';
        const toParents = kind === 'linkParents';
        const people = (toParents ? links.parentIds : links.childIds)
            .map(pid => DataManager.getPerson(pid))
            .filter((p): p is Person => p !== null);
        const header = kind === 'linkParents' ? strings.focus.linkParentsTooltip
            : kind === 'linkChild' ? strings.focus.linkChildTooltip : strings.focus.linkChildrenTooltip;
        const items = this.nameGroupsHtml([{ pre: '', items: people.map(p => this.bubbleItemHtml(p)) }]);
        const self = DataManager.getPerson(id);
        const name = self ? shownNameFull(self, '?') : '?';
        const label = (kind === 'linkParents' ? strings.focus.linkParentsAria
            : kind === 'linkChild' ? strings.focus.linkChildAria : strings.focus.linkChildrenAria)(name);
        return `<button type="button" class="branch-tab line-link kind-jump" data-action="${toParents ? 'jump-parents' : 'jump-child'}" aria-label="${this.escapeHtml(label)}">`
            + `${branchTabRestHtml(kind)}<div class="badge-tooltip" aria-hidden="true"><div class="badge-tooltip-header">${this.escapeHtml(header)}</div>${items}`
            + `<div class="badge-tooltip-action">${this.escapeHtml(strings.focus.jumpHint(people.length))}</div></div></button>`;
    }

    /**
     * The children in a "▸ children" / "▾ children" bubble (§5): by the
     * marriage they were born to ("2. ∞ · Berta", numbered as the
     * marriage-order pill counts) when they come from more than one, else
     * the plain list.
     */
    private childrenByUnionHtml(personId: PersonId, ids: readonly PersonId[]): string {
        const groups = childrenByUnion(DataManager.getData(), personId, ids);
        if (groups.length < 2) return this.nameGroupsHtml([{ pre: '', items: this.bubbleItems(ids) }]);
        return this.nameGroupsHtml(groups.map(g => {
            const partner = g.partnerId ? DataManager.getPerson(g.partnerId) : null;
            const label = g.number > 0 ? strings.focus.childrenGroupUnion(g.number, partner ? shownName(partner, '?') : '?') : '';
            return { pre: label ? `<div class="badge-tooltip-group">${this.escapeHtml(label)}</div>` : '', items: this.bubbleItems(g.ids) };
        }));
    }

    /**
     * The ∞ pill of a card (§5, partnersPillOf): "▸ ∞ N" before a click,
     * "▾ ∞ N" (active) while the partners are shown here; its bubble names
     * them with their marriage ("2. ∞ 1890", numbered as the marriage-order
     * pill counts) and ends with what a click does.
     *
     * The bubble stands beside the pill and each name it offers is a
     * button of its own (round 6 §42, the expanded display too since round
     * 7 §50): it shows that partner alone (showPartnerHere). After such a click, while any of the
     * offered marriages is left, the pill offers the rest ("▸ ∞ n", half
     * pressed) and its bubble names them, then the partners shown here and
     * a row that hides those again.
     */
    private partnersPillHtml(id: PersonId, pill: { shown: boolean; ids: PersonId[]; offers?: OfferedPartner[]; remaining?: OfferedPartner[] },
        fullTitle: string, nested = false): string {
        const data = DataManager.getData();
        const order = marriagesInOrder(data, id);
        const shownUnions = this.partnersShownUnions.get(id);
        const partial = pill.shown && !!pill.remaining?.length;
        const item = (q: PersonId, offer: OfferedPartner | undefined): string => {
            const partner = DataManager.getPerson(q)!;
            const withPartner = (u: PartnershipId) => data.partnerships[u]?.person1Id === q || data.partnerships[u]?.person2Id === q;
            // The marriage the pill offers or showed (round 5 §36), else the one without children
            const uid = offer?.partnershipId
                ?? shownUnions?.find(withPartner)
                ?? order.find(u => withPartner(u) && data.partnerships[u].childIds.length === 0)
                ?? order.find(withPartner);
            const union = uid ? data.partnerships[uid] : undefined;
            const year = union?.startDate ? displayYear(union.startDate) : '';
            const marriage = uid ? `${strings.focus.unionOrdinal(order.indexOf(uid) + 1)} ∞${year ? ` ${year}` : ''}` : '';
            // A marriage with children: their count after the name ("Lena Fross · 1 child")
            const childCount = union ? union.childIds.filter(c => !!data.persons[c] && !data.persons[c].isPlaceholder).length : 0;
            const children = childCount > 0 ? ` · ${strings.tooltip.childrenCount(childCount)}` : '';
            const inner = `<span class="badge-tooltip-name">${this.escapeHtml(shownName(partner, '?') + children)}</span>`
                + `${marriage ? `<span class="badge-tooltip-detail"> ${this.escapeHtml(marriage)}</span>` : ''}`;
            if (!offer) return `<div class="badge-tooltip-item">${inner}</div>`;
            // A name offered: a button that shows this partner alone (round 6 §42)
            const aria = strings.focus.partnerShowOneAria(shownNameFull(partner, '?'), childCount > 0);
            return `<div class="badge-tooltip-item"><button type="button" class="partner-pick" data-partnership-id="${this.escapeHtml(offer.partnershipId)}"`
                + ` aria-label="${this.escapeHtml(aria)}">${inner}</button></div>`;
        };
        const known = (q: PersonId) => DataManager.getPerson(q) !== null;
        const offered = partial ? pill.remaining! : pill.shown ? [] : pill.offers ?? [];
        const offerOf = (q: PersonId) => offered.find(o => o.partnerId === q);
        const groups = partial
            ? [{ pre: '', items: offered.filter(o => known(o.partnerId)).map(o => item(o.partnerId, o)) },
                { pre: `<div class="badge-tooltip-group">${this.escapeHtml(strings.focus.partnersShownTooltip)}</div>`,
                    items: pill.ids.filter(known).map(q => item(q, undefined)) }]
            : [{ pre: '', items: pill.ids.filter(known).map(q => item(q, offerOf(q))) }];
        const items = this.nameGroupsHtml(groups);
        const header = pill.shown && !partial ? strings.focus.partnersShownTooltip : strings.focus.hiddenPartnersTooltip;
        const hint = partial ? strings.focus.partnersRestHint
            : pill.shown ? strings.focus.placeHideHint
                : offered.length > 1 ? strings.focus.partnersPickHint : strings.focus.placeShowHint;
        const aria = (partial ? strings.focus.partnersTabRestAria : pill.shown ? strings.focus.partnersTabHideAria : strings.focus.partnersTabShowAria)(fullTitle);
        const active = pill.shown && !partial;
        const button = `<button type="button" class="hidden-partners-btn kind-place${active ? ' active' : ''}${partial ? ' partial' : ''}" data-action="toggle-partners"`
            + ` aria-pressed="${partial ? 'mixed' : active}" aria-label="${this.escapeHtml(aria)}">`
            + `<span class="pill-glyph">${active ? '▾' : '▸'}</span><span class="pill-glyph">∞</span><span class="pill-count">${partial ? offered.length : pill.ids.length}</span>`;
        const body = `<div class="badge-tooltip-header">${this.escapeHtml(header)}</div>${items}`;
        const action = `<div class="badge-tooltip-action">${this.escapeHtml(hint)}</div>`;
        // A part shown: a row that hides the partners shown here (the whole step, as "▾ ∞" would)
        const hideRow = partial ? `<div class="badge-tooltip-nested"><button type="button" class="partner-hide-row">`
            + `<span class="nested-focus-glyph" aria-hidden="true">▾</span><span class="nested-focus-label">${this.escapeHtml(strings.focus.hidePartnersHere)}</span></button></div>` : '';
        // Beside the pill: its names are buttons (§42, §50), nested (§6) its "◎ Focus on …" too
        return `${button}</button><div class="badge-tooltip children-bubble" data-bubble="partners">${body}${hideRow}${nested ? this.nestedFocusHtml(id) : ''}${action}</div>`;
    }

    /**
     * A tab that sets the focus on the card's person (§2, §4: "◎ parents",
     * "◎ siblings", "◎ family" — the family of origin out of view and no
     * anchor of it in view): the bubble names the people the new focus
     * shows (by group in the family tab) and ends with what a click does;
     * the click rebuilds the tree around the person and offers ↩ (toast).
     */
    private focusTabHtml(personId: PersonId, kind: 'parents' | 'siblings' | 'family', unionChildIds: ReadonlySet<PersonId>): string {
        const person = DataManager.getPerson(personId);
        if (!person) return '';
        const name = shownNameFull(person, '?');
        const parents = person.parentIds
            .filter(pid => !this.positions.has(pid))
            .map(pid => DataManager.getPerson(pid))
            .filter((p): p is Person => p !== null);
        const siblingIds = DataManager.getSiblings(personId)
            .filter(s => unionChildIds.has(s.id) && !this.positions.has(s.id))
            .map(s => s.id);
        const parentItems = parents.map(p => this.bubbleItemHtml(p));
        let body: string;
        if (kind === 'family') {
            // Parents and siblings: one list of names, cut at the maximum as a whole
            const siblingGroupsOf = this.siblingNameGroups(personId, siblingIds);
            const siblingsLine = `<div class="badge-tooltip-group">${strings.focus.hiddenSiblingsTooltip}</div>`;
            body = `<div class="badge-tooltip-header">${strings.focus.familyTooltip}</div>`
                + this.nameGroupsHtml([
                    { pre: `<div class="badge-tooltip-group">${strings.focus.hiddenParentsTooltip}</div>`, items: parentItems },
                    ...(siblingGroupsOf.length > 0
                        ? siblingGroupsOf.map((g, i) => (i === 0 ? { ...g, pre: siblingsLine + g.pre } : g))
                        : [{ pre: siblingsLine, items: [] }]),
                ]);
        } else if (kind === 'parents') {
            body = `<div class="badge-tooltip-header">${strings.focus.hiddenParentsTooltip}</div>${this.nameGroupsHtml([{ pre: '', items: parentItems }])}`;
        } else {
            body = `<div class="badge-tooltip-header">${strings.focus.hiddenSiblingsTooltip}</div>${this.siblingGroupsHtml(personId, siblingIds)}`;
        }
                return `<button type="button" class="branch-tab kind-focus" data-action="focus-person" data-tab="${kind}" aria-label="${this.escapeHtml(strings.focus.focusTabAria(name))}">`
            + branchTabRestHtml(kind)
            + `<div class="badge-tooltip" aria-hidden="true">${body}`
            + `<div class="badge-tooltip-body">${this.escapeHtml(strings.focus.familyOfOrigin)}</div>`
            + `<div class="badge-tooltip-action">${this.escapeHtml(strings.focus.focusTabHint(name))}</div></div></button>`;
    }

    /**
     * Bring these cards into view and highlight them, without changing the
     * focus (a line link's other end): one card centred, several fitted,
     * always at a readable scale (glideToCards).
     */
    private jumpToPersons(ids: readonly PersonId[]): boolean {
        const { shown, moves } = this.glideToCards(ids);
        for (const pid of shown) ZoomPan.highlightPerson(pid);
        return moves;
    }

    /**
     * Glide the view to drawn cards elsewhere in the view (ZoomPan.jumpToBoxes:
     * centred at a readable scale, several together when they fit readably,
     * else the one nearest the view's centre). A running children transition
     * ends first, so its zoom does not land over the glide. Returns the cards
     * drawn of `ids` and whether the view moves.
     */
    private glideToCards(ids: readonly PersonId[]): { shown: PersonId[]; moves: boolean } {
        const shown = ids.filter(pid => this.positions.has(pid));
        if (shown.length === 0) return { shown, moves: false };
        this.finishChildrenTransition();
        const plan = ZoomPan.jumpToBoxes(shown.map(pid => this.cardBox(pid)).filter((b): b is ChildrenRect => b !== null));
        return { shown, moves: plan !== null };
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
