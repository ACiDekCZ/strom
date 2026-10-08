/**
 * Marriage order (T13).
 *
 * A person's unions in chronological order — by the wedding date, then by the
 * order they have in the data (the person's `partnerships` list); a union
 * without a usable date comes after the dated ones. The diagram uses it twice:
 *
 * - the partners on one side of a person with several unions in a row
 *   (expanded view, partner chains) stand in this order, the earliest next
 *   to the person (src/layout/pipeline/2-build-model.ts);
 * - a marriage-order pill ("1. ∞ 1866") on the top edge of a partner of a
 *   person with two or more unions in view, at the corner that points to
 *   that person (the screen, the image export and the book): one pill per
 *   union, at most one per card (unionOrderBadges), laid out with the
 *   card's top-edge tabs by one rule for every density (placeUnionOrderPill),
 *   with a shorter label ("1. ∞", "1.") where the whole does not fit in its
 *   half of the card.
 *
 * The number counts every union of the person in the data, so a marriage
 * keeps its number however much of the family the view shows. An empty "?"
 * stand-in the diagram leaves out (T11) is a family, not a marriage: it is
 * not counted.
 */

import { PartnershipId, PersonId, Position, StromData, Partnership } from './types.js';
import type { Connection, SpouseLine } from './layout/pipeline/types.js';
import { parseFlexDate, displayYear } from './dates.js';
import { isDiagramStandIn } from './layout/pipeline/placeholders.js';

/** Chronological key of a wedding date; Infinity when there is none (after every dated union). */
function weddingKey(date: string | undefined): number {
    const d = parseFlexDate(date);
    if (!d) return Infinity;
    return d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0);
}

/**
 * Compare two unions chronologically: the wedding date first, the order in
 * the data (`index`) on a tie or when neither has a date.
 */
export function compareMarriages(
    a: { startDate?: string; index: number },
    b: { startDate?: string; index: number }
): number {
    const ka = weddingKey(a.startDate);
    const kb = weddingKey(b.startDate);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.index - b.index;
}

/** The person's unions (ids) in chronological order, "?" stand-in families left out. */
export function marriagesInOrder(data: StromData, personId: PersonId): PartnershipId[] {
    const ids = data.persons[personId]?.partnerships ?? [];
    return ids
        .map((id, index) => ({ id, index, union: data.partnerships[id] }))
        .filter((e): e is { id: PartnershipId; index: number; union: Partnership } => {
            if (!e.union) return false;
            const partnerId = e.union.person1Id === personId ? e.union.person2Id : e.union.person1Id;
            return !isDiagramStandIn(data, partnerId);
        })
        .sort((a, b) => compareMarriages(
            { startDate: a.union.startDate, index: a.index },
            { startDate: b.union.startDate, index: b.index }))
        .map(e => e.id);
}

/** The marriage-order pill of a partner's card. */
export interface UnionOrderBadge {
    /** The card that carries the pill (a partner). */
    personId: PersonId;
    /** The person whose marriages the number counts (the chain's shared person). */
    towardId: PersonId;
    partnershipId: PartnershipId;
    /** 1-based number of the union among the toward person's unions (chronological). */
    number: number;
    /** Wedding year as shown ('~1866' keeps the qualifier), '' without a date. */
    year: string;
    /** Wedding place, '' without one. */
    place: string;
    /** A married couple (married/divorced or no status) — "marriage"; otherwise "union". */
    married: boolean;
    /** The corner of the card's top edge: the one that points to the toward person. */
    side: 'left' | 'right';
}

/** What the badges read of a laid-out view. */
export interface UnionOrderLayout {
    positions: Map<PersonId, Position>;
    spouseLines: ReadonlyArray<{ person1Id: PersonId; person2Id: PersonId; partnershipId: PartnershipId | null }>;
}

/**
 * The marriage-order pills of a laid-out view: at most one per union and at
 * most one per card. A union is in view when its partner line is drawn (both
 * cards shown). A union gets a pill when one of its two persons has two or
 * more unions in view (a chain's shared person); the pill sits on the other
 * person's card and counts the shared person's marriages. When both persons
 * have several unions in view (a widow who married a widower), the number is
 * counted for the person in focus if it is one of them, else for the one with
 * more unions in view, else for the union's first person in the data — so a
 * marriage never shows two different numbers.
 *
 * One card could still be asked for two pills (a person with two unions, both
 * partners with more): the second pill then counts the card's own marriages
 * and goes on the partner's card instead, and when that card is taken too the
 * union shows no pill.
 *
 * `data` gives the shown year and place (the export passes its
 * privacy-filtered copy); `orderData` gives the order, so the numbers match
 * the screen even where the export leaves a wedding date out.
 */
export function unionOrderBadges(
    data: StromData,
    layout: UnionOrderLayout,
    orderData: StromData = data,
    focusId: PersonId | null = null
): Map<PersonId, UnionOrderBadge> {
    const inView = new Map<PersonId, Set<PartnershipId>>();
    const unions: PartnershipId[] = [];
    for (const line of layout.spouseLines) {
        const pid = line.partnershipId;
        if (!pid || !data.partnerships[pid]) continue;
        if (!layout.positions.has(line.person1Id) || !layout.positions.has(line.person2Id)) continue;
        if (!unions.includes(pid)) unions.push(pid);
        for (const id of [line.person1Id, line.person2Id]) {
            let set = inView.get(id);
            if (!set) inView.set(id, set = new Set());
            set.add(pid);
        }
    }
    const count = (id: PersonId): number => inView.get(id)?.size ?? 0;
    const orders = new Map<PersonId, PartnershipId[]>();
    const numberOf = (towardId: PersonId, pid: PartnershipId): number => {
        let order = orders.get(towardId);
        if (!order) orders.set(towardId, order = marriagesInOrder(orderData, towardId));
        return order.indexOf(pid) + 1;
    };
    const badge = (pid: PartnershipId, towardId: PersonId): UnionOrderBadge | null => {
        const union = data.partnerships[pid];
        const personId = union.person1Id === towardId ? union.person2Id : union.person1Id;
        const pos = layout.positions.get(personId);
        const towardPos = layout.positions.get(towardId);
        const number = numberOf(towardId, pid);
        if (!pos || !towardPos || personId === towardId || number === 0) return null;
        return {
            personId,
            towardId,
            partnershipId: pid,
            number,
            year: union.startDate ? displayYear(union.startDate) : '',
            place: union.startPlace?.trim() ?? '',
            married: union.status !== 'partners' && union.status !== 'separated',
            side: towardPos.x < pos.x ? 'left' : 'right',
        };
    };

    // Whose marriages each union counts: [preferred, the other one or null].
    const plans: Array<{ pid: PartnershipId; first: PersonId; second: PersonId | null }> = [];
    for (const pid of unions) {
        const { person1Id: a, person2Id: b } = data.partnerships[pid];
        const aShared = count(a) >= 2, bShared = count(b) >= 2;
        if (!aShared && !bShared) continue;
        if (aShared !== bShared) { plans.push({ pid, first: aShared ? a : b, second: null }); continue; }
        const first = focusId === a || focusId === b ? focusId
            : count(a) !== count(b) ? (count(a) > count(b) ? a : b)
            : a;
        plans.push({ pid, first, second: first === a ? b : a });
    }
    // A pill with no choice first (its card has no other union in view), then the rest.
    plans.sort((x, y) => Number(x.second !== null) - Number(y.second !== null));

    const out = new Map<PersonId, UnionOrderBadge>();
    const retry: typeof plans = [];
    for (const plan of plans) {
        const b = badge(plan.pid, plan.first);
        if (b && !out.has(b.personId)) out.set(b.personId, b);
        else if (plan.second) retry.push(plan);
    }
    for (const plan of retry) {
        const b = badge(plan.pid, plan.second!);
        if (b && !out.has(b.personId)) out.set(b.personId, b);
    }
    return out;
}

// ============= Hidden-relatives tabs =============

/** A hidden-relatives tab on a card's top edge ("◂ parents", "◆ siblings", "▸ family"). */
export type HiddenRelativesTab = 'parents' | 'siblings' | 'children';

/**
 * The hidden-relatives tabs of a card, in the order the card shows them: a
 * direction gets one when the person has relatives there and none of them is
 * in view. Siblings count only as children of a union (as the layout does).
 */
export function hiddenRelativesTabs(
    data: StromData,
    personId: PersonId,
    inView: (id: PersonId) => boolean,
    unionChildIds: ReadonlySet<PersonId>
): HiddenRelativesTab[] {
    const person = data.persons[personId];
    if (!person) return [];
    const out: HiddenRelativesTab[] = [];
    if (person.parentIds.length > 0 && !person.parentIds.some(inView)) out.push('parents');
    const siblings = new Set<PersonId>();
    for (const parentId of person.parentIds) {
        for (const childId of data.persons[parentId]?.childIds ?? []) {
            if (childId !== personId && data.persons[childId] && unionChildIds.has(childId)) siblings.add(childId);
        }
    }
    if (siblings.size > 0 && ![...siblings].some(inView)) out.push('siblings');
    if (person.childIds.length > 0 && !person.childIds.some(inView)) out.push('children');
    return out;
}

/** Every person a union lists as its child (the layout's notion of a sibling). */
export function unionChildIdSet(data: StromData): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const p of Object.values(data.partnerships)) for (const c of p.childIds) out.add(c);
    return out;
}

// ============= Where the pill sits =============

/** Height of the pill (and of every card-edge tab). */
export const PILL_HEIGHT = 18;
/** The tabs and the pill straddle the card's top edge: their top is 9px above it. */
export const EDGE_ROW_Y = -PILL_HEIGHT / 2;
/** Space between two things on the top edge, and between the pill and the tabs below it. */
export const EDGE_GAP = 4;
/** Above the tabs: the pill's top, its bottom 2px above the tabs' top. */
export const ABOVE_ROW_Y = EDGE_ROW_Y - 2 - PILL_HEIGHT;
/** Half of the stretch at the middle of the top edge kept free (the line to the parents arrives there). */
export const CENTRE_CLEAR = 4;
/** The corner groups stand 12px inside the card's border. */
export const EDGE_INSET = 12;
/** The relations icon (.rel-link-icon): an 18px circle left of the branch tabs while the card is hovered. */
export const REL_LINK_ICON_WIDTH = 18;
/** How close the pill may come to a line (half a stroke and a hair). */
const LINE_CLEARANCE = 1.5;

/** An axis-parallel line, card-relative (x from the card's left edge, y from its top edge). */
export interface PillSegment { x1: number; y1: number; x2: number; y2: number }

/**
 * The label a pill shows: whole ("2nd ∞ 1908"; "3rd ∞" without a date),
 * without the year ("2nd ∞"), or the ordinal alone ("2nd"). The bubble and
 * the accessible label always say it all.
 */
export type PillLabel = 'full' | 'noYear' | 'ordinal';

/** One label of a pill: its parts (the screen's markup draws them, the measure measures them). */
export interface PillLabelForm {
    label: PillLabel;
    ordinal: string;
    /** '' when the label shows no year. */
    year: string;
    /** False for the ordinal alone (no ∞). */
    glyph: boolean;
}

/**
 * The labels a pill may show, longest first: the whole pill (the number, the
 * ∞ and the year when there is one), then without the year, then the
 * ordinal alone.
 */
export function pillLabelForms(ordinal: string, year: string): PillLabelForm[] {
    const out: PillLabelForm[] = [{ label: 'full', ordinal, year, glyph: true }];
    if (year) out.push({ label: 'noYear', ordinal, year: '', glyph: true });
    out.push({ label: 'ordinal', ordinal, year: '', glyph: false });
    return out;
}

/** The widths placeUnionOrderPill takes, from the labels (pillLabelForms) and their measures, in that order. */
export function pillLabelWidths(forms: ReadonlyArray<PillLabelForm>, widths: ReadonlyArray<number>):
    Pick<PillPlacementInput, 'pillWidth' | 'shorter'> {
    return { pillWidth: widths[0], shorter: forms.slice(1).map((f, i) => ({ label: f.label, width: widths[i + 1] })) };
}

export interface PillPlacementInput {
    cardWidth: number;
    /** The corner of the person whose marriages the pill counts. */
    side: 'left' | 'right';
    /** Width of the whole pill. */
    pillWidth: number;
    /**
     * Widths of its shorter labels, longest first (pillLabelForms): tried in
     * turn when the whole pill does not fit in its half of the card.
     */
    shorter?: ReadonlyArray<{ label: PillLabel; width: number }>;
    /** Width of the tabs resting in each top corner (0: none). */
    leftTabs: number;
    rightTabs: number;
    /** Distance of each corner group from the card's left / right outer edge. */
    leftInset: number;
    rightInset: number;
    /**
     * Width of what joins the right corner group, left of its tabs, while the
     * card is hovered (the relations icon, REL_LINK_ICON_WIDTH; 0: nothing).
     * A pill in the left half keeps clear of it too (N35).
     */
    rightHover?: number;
    /** The view's lines near the card, card-relative. */
    segments?: ReadonlyArray<PillSegment>;
}

export interface PillPlacement {
    /** The pill's left edge, from the card's left edge. */
    x: number;
    /** The pill's top, from the card's top edge (EDGE_ROW_Y or ABOVE_ROW_Y). */
    y: number;
    /** On the top edge beside the tabs, or above them. */
    row: 'edge' | 'above';
    /** False when no place kept clear of every line (the above row's corner then). */
    clear: boolean;
    /** The label shown: the whole pill, or a shorter one where the whole does not fit in its half. */
    label: PillLabel;
    /** The pill's width with that label. */
    width: number;
}

function hitsLine(x: number, y: number, w: number, segments: ReadonlyArray<PillSegment>): boolean {
    const x0 = x - LINE_CLEARANCE, x1 = x + w + LINE_CLEARANCE;
    const y0 = y - LINE_CLEARANCE, y1 = y + PILL_HEIGHT + LINE_CLEARANCE;
    for (const s of segments) {
        const sx0 = Math.min(s.x1, s.x2), sx1 = Math.max(s.x1, s.x2);
        const sy0 = Math.min(s.y1, s.y2), sy1 = Math.max(s.y1, s.y2);
        if (sx1 > x0 && sx0 < x1 && sy1 > y0 && sy0 < y1) return true;
    }
    return false;
}

/**
 * Where a marriage-order pill sits on its card — one rule for every density
 * (compact, normal, detailed, custom):
 *
 * - the middle of the top edge stays free (the line to the parents arrives
 *   there, the research stub of hidden parents stands there);
 * - the tabs stay in their corners; the pill goes to the corner of the person
 *   it counts for, right beside the tabs there, never over them, and within
 *   that half of the card;
 * - when it does not fit there (a narrow card, long tabs, a line in the way),
 *   it moves above the tabs, wholly above the top edge, still in its half
 *   and within the card's width, so it never reaches a neighbouring card —
 *   at the corner, or as close to it as the lines allow;
 * - when the whole pill is wider than its half even there (a narrow card, a
 *   wide font — the widths are the screen's own, measured in its font), it
 *   shows a shorter label: without the year, then the ordinal alone, the
 *   longest that fits; a label clear of the lines before one that is not.
 *
 * Null when not even the ordinal alone fits in the half: the card then
 * shows no pill rather than one over the middle of its top edge.
 */
export function placeUnionOrderPill(input: PillPlacementInput): PillPlacement | null {
    const forms: Array<{ label: PillLabel; width: number }> = [{ label: 'full', width: input.pillWidth }, ...(input.shorter ?? [])];
    for (const clearOnly of [true, false]) {
        for (const f of forms) {
            const slot = placeWidth(input, f.width, clearOnly);
            if (slot) return { ...slot, label: f.label, width: f.width };
        }
    }
    return null;
}

/**
 * Where a pill `w` wide sits (placeUnionOrderPill), or null when it is wider
 * than its half of the card — or, with `clearOnly`, when no place in the half
 * is clear of the lines.
 */
function placeWidth(input: PillPlacementInput, w: number, clearOnly: boolean):
    { x: number; y: number; row: 'edge' | 'above'; clear: boolean } | null {
    const { cardWidth: W, side, leftTabs, rightTabs, leftInset, rightInset } = input;
    const segments = input.segments ?? [];
    const mid = W / 2;
    const leftEnd = leftTabs > 0 ? leftInset + leftTabs : -Infinity;
    const rightStart = rightTabs > 0 ? W - rightInset - rightTabs : Infinity;
    // Where the right group starts while the card is hovered (the relations icon left of its tabs).
    const hover = input.rightHover ?? 0;
    const rightHoverStart = hover > 0 ? (rightTabs > 0 ? rightStart - EDGE_GAP : W - rightInset) - hover : Infinity;

    // On the edge, beside the corner's tabs.
    if (side === 'left') {
        const x = leftTabs > 0 ? leftEnd + EDGE_GAP : leftInset;
        if (x + w <= mid - CENTRE_CLEAR && x + w + EDGE_GAP <= Math.min(rightStart, rightHoverStart) && !hitsLine(x, EDGE_ROW_Y, w, segments)) {
            return { x, y: EDGE_ROW_Y, row: 'edge', clear: true };
        }
    } else {
        const x = (rightTabs > 0 ? rightStart - EDGE_GAP : W - rightInset) - w;
        if (x >= mid + CENTRE_CLEAR && x >= leftEnd + EDGE_GAP && !hitsLine(x, EDGE_ROW_Y, w, segments)) {
            return { x, y: EDGE_ROW_Y, row: 'edge', clear: true };
        }
    }

    // Above the tabs: in the half, within the card, the corner first.
    const lo = side === 'left' ? 0 : mid + CENTRE_CLEAR;
    const hi = side === 'left' ? mid - CENTRE_CLEAR - w : W - w;
    if (hi < lo - 1e-9) return null;   // wider than its half: it would cover the middle
    const corner = side === 'left' ? Math.min(Math.max(leftInset, lo), hi) : Math.max(Math.min(W - rightInset - w, hi), lo);
    if (!hitsLine(corner, ABOVE_ROW_Y, w, segments)) return { x: corner, y: ABOVE_ROW_Y, row: 'above', clear: true };
    // The nearest free place to the corner, in half-pixel steps.
    for (let d = 0.5; d <= hi - lo + 0.5; d += 0.5) {
        for (const x of [corner - d, corner + d]) {
            if (x < lo - 1e-9 || x > hi + 1e-9) continue;
            if (!hitsLine(x, ABOVE_ROW_Y, w, segments)) return { x, y: ABOVE_ROW_Y, row: 'above', clear: true };
        }
    }
    return clearOnly ? null : { x: corner, y: ABOVE_ROW_Y, row: 'above', clear: false };
}

/**
 * The lines of a laid-out view as axis-parallel segments (absolute canvas
 * coordinates): each family's stem, connector, bus and drops, and the partner
 * lines.
 */
export function viewLineSegments(layout: {
    connections: ReadonlyArray<Connection>;
    spouseLines: ReadonlyArray<SpouseLine>;
}): PillSegment[] {
    const out: PillSegment[] = [];
    for (const c of layout.connections) {
        // The stem reaches the connector's lane (as drawn), then the connector
        // and its drop to the bus, or the stem goes on to the bus.
        out.push({ x1: c.stemX, y1: c.stemTopY, x2: c.stemX, y2: c.connectorY });
        const toX = Math.abs(c.connectorFromX - c.connectorToX) > 0.5 ? c.connectorToX : c.stemX;
        if (toX !== c.stemX) out.push({ x1: c.connectorFromX, y1: c.connectorY, x2: c.connectorToX, y2: c.connectorY });
        if (Math.abs(c.connectorY - c.branchY) > 0.5) out.push({ x1: toX, y1: c.connectorY, x2: toX, y2: c.branchY });
        out.push({ x1: c.branchLeftX, y1: c.branchY, x2: c.branchRightX, y2: c.branchY });
        for (const d of c.drops) out.push({ x1: d.x, y1: d.topY ?? c.branchY, x2: d.x, y2: d.bottomY });
    }
    for (const s of layout.spouseLines) out.push({ x1: s.xMin, y1: s.y, x2: s.xMax, y2: s.y });
    return out;
}

/** The segments that come near a card's top edge, card-relative (for placeUnionOrderPill). */
export function segmentsNearCard(segments: ReadonlyArray<PillSegment>, x: number, y: number, width: number): PillSegment[] {
    const top = y + ABOVE_ROW_Y - 4, bottom = y + EDGE_ROW_Y + PILL_HEIGHT + 4;
    const out: PillSegment[] = [];
    for (const s of segments) {
        if (Math.max(s.x1, s.x2) < x - 4 || Math.min(s.x1, s.x2) > x + width + 4) continue;
        if (Math.max(s.y1, s.y2) < top || Math.min(s.y1, s.y2) > bottom) continue;
        out.push({ x1: s.x1 - x, y1: s.y1 - y, x2: s.x2 - x, y2: s.y2 - y });
    }
    return out;
}

// ============= The pill's measure =============

/** Where the parts of a pill sit, from its left edge (px), and its width. */
export interface PillMetrics {
    width: number;
    numX: number;
    /** The ∞ glyph's centre (0 for the ordinal alone). */
    glyphX: number;
    /** 0 without a year. */
    yearX: number;
}

/** Estimated width of a 10px semibold pill text in the card's sans (digits of one width). */
export function estimatePillTextWidth(text: string): number {
    let w = 0;
    for (const c of text) w += /[0-9~<>]/.test(c) ? 6 : c === '.' ? 2.8 : c === ' ' ? 2.6 : 5.6;
    return w;
}

/**
 * The pill measured without a browser (tests, the export outside one): the
 * screen's .union-order-pill — 1px border, 7px padding, 3px between the
 * parts, a 9px ∞. `glyph` false: the ordinal alone (no ∞, no year).
 */
export function estimatePillMetrics(ordinal: string, year: string, glyph = true): PillMetrics {
    const numW = estimatePillTextWidth(ordinal);
    const numX = 8;
    if (!glyph) return { width: numX + numW + 8, numX, glyphX: 0, yearX: 0 };
    const glyphW = 9;
    const glyphX = numX + numW + 3 + glyphW / 2;
    const yearX = year ? numX + numW + 3 + glyphW + 3 : 0;
    const width = (year ? yearX + estimatePillTextWidth(year) : numX + numW + 3 + glyphW) + 8;
    return { width, numX, glyphX, yearX };
}
