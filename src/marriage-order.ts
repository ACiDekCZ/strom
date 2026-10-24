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
import type { Connection, SpouseLine, OmittedEdge } from './layout/pipeline/types.js';
import { parseFlexDate, displayYear } from './dates.js';
import { isDiagramStandIn } from './layout/pipeline/placeholders.js';
import { childIdsShownInPlace, partnerIdsShownInPlace } from './layout/pipeline/1-select-subgraph.js';

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

/** One union of a person as the hover card lists it (T37). */
export interface UnionSummary {
    partnershipId: PartnershipId;
    /** The other partner, null when the union has none. */
    partnerId: PersonId | null;
    /** 1-based number among the person's unions (chronological, as the pill counts). */
    number: number;
    /** Wedding year as shown ('~1866' keeps the qualifier), '' without a date. */
    year: string;
    /** The person's children of this union. */
    childCount: number;
}

/**
 * A person's unions in chronological order (marriagesInOrder), each with its
 * partner, wedding year and children, and the person's children outside
 * them (an empty "?" stand-in family, a child with one parent recorded).
 */
export function unionSummaries(data: StromData, personId: PersonId): { unions: UnionSummary[]; otherChildren: number } {
    const person = data.persons[personId];
    if (!person) return { unions: [], otherChildren: 0 };
    const own = new Set(person.childIds);
    const counted = new Set<PersonId>();
    const unions = marriagesInOrder(data, personId).map((pid, i): UnionSummary => {
        const union = data.partnerships[pid];
        const other = union.person1Id === personId ? union.person2Id : union.person1Id;
        let childCount = 0;
        for (const c of union.childIds) {
            if (own.has(c) && !counted.has(c)) { counted.add(c); childCount++; }
        }
        return {
            partnershipId: pid,
            partnerId: other && other !== personId && data.persons[other] ? other : null,
            number: i + 1,
            year: union.startDate ? displayYear(union.startDate) : '',
            childCount,
        };
    });
    return { unions, otherChildren: person.childIds.filter(c => !counted.has(c)).length };
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

/**
 * A hidden-relatives tab on a card's top edge ("◎ parents", "◎ siblings",
 * "▸ children"); "▾ children" (childrenShown) is the children tab while the
 * view shows the person's children in place. The siblings of a person with
 * a parent in view are shown in place as well, as the children of the
 * parents ("▸ siblings", siblingsHere; "▾ siblings", siblingsShown); without
 * a parent in view the siblings tab focuses on the person (siblings).
 * "◎ family" (family) stands for both focus tabs at once (parents and
 * siblings out of view: both did the same); "▸ parents" dashed
 * (parentsFolded): the parents folded away for children shown in place.
 * An ancestor of the line at the edge of the depth (the parents out of view
 * only for the depth, the card is their anchor) shows them in place:
 * "▸ parents" (parentsHere), "▾ parents" while shown (parentsShown); its
 * siblings tab shows the parents and their children in one step.
 */
export type HiddenRelativesTab = 'parents' | 'parentsHere' | 'parentsShown' | 'parentsFolded' | 'family' | 'siblings' | 'siblingsHere' | 'siblingsShown' | 'children' | 'childrenShown';

/** What the view tells hiddenRelativesTabs about the children shown in place (the siblings tab). */
export interface ShownChildrenContext {
    /** Per person whose children the view shows in place: their children it drew before the click. */
    visibleBefore?: (parentId: PersonId) => ReadonlySet<PersonId> | undefined;
    /**
     * Whether a card in view hangs on a drawn parent line (a child drawn
     * elsewhere in the tree, say as a wife in another branch, does not).
     * Default: every card in view does.
     */
    hangsOnLine?: (id: PersonId) => boolean;
    /** Whether the person's parents are folded away for children shown in place (the dashed "▸ parents"). Default: never. */
    parentsFolded?: (id: PersonId) => boolean;
    /**
     * Whether the person is an ancestor of the line whose parents are out of
     * view only because of the depth (LayoutResult.ancestorDepthEdge): the
     * parents and siblings tabs show them in place. Default: never.
     */
    atDepthEdge?: (id: PersonId) => boolean;
    /**
     * Whether the view shows the person's parents in place beyond the depth
     * by the person's own "▸ parents" ("▾ parents"; not as part of a
     * siblings step, which the siblings tab closes). Default: never.
     */
    parentsShown?: (id: PersonId) => boolean;
}

/** The person's siblings as the layout counts them: the other children of the parents that are a union's children. */
function siblingIdsOf(data: StromData, personId: PersonId, unionChildIds: ReadonlySet<PersonId>): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const parentId of data.persons[personId]?.parentIds ?? []) {
        for (const childId of data.persons[parentId]?.childIds ?? []) {
            if (childId !== personId && data.persons[childId] && unionChildIds.has(childId)) out.add(childId);
        }
    }
    return out;
}

/** The siblings tab of a card and what it does (siblingsTabState). */
export interface SiblingsTabState {
    kind: 'siblings' | 'siblingsHere' | 'siblingsShown';
    /** siblingsHere: the parents in view a click shows the children of (one step), in the person's order of parents. */
    parents: PersonId[];
    /** siblingsHere: the siblings out of view that click draws (hiddenChildIds of those parents), in that order. */
    promised: PersonId[];
    /**
     * siblingsHere of an ancestor at the edge of the depth: `parents` are out
     * of view, the click shows them first (one generation more) and their
     * children with them, one step.
     */
    beyondDepth?: boolean;
}

/**
 * The siblings tab of a card, or null for none:
 *
 * - no parent in view: "◎ siblings" (a focus on the person) when the person
 *   has siblings and none of them is in view (siblings count only as
 *   children of a union, as the layout does); for an ancestor at the edge
 *   of the depth (ctx.atDepthEdge) "▸ siblings" instead, beyondDepth: the
 *   parents come into view with their children, one step;
 * - a parent in view: the siblings are the children of the parents, shown
 *   in place by the parents' children ("▸ children" of each, one step).
 *   No tab while a sibling stood in view before (hanging on the parents'
 *   line: the parents' family is drawn, the focus's and its parents'
 *   siblings); "▸ siblings" (siblingsHere) while a parent in view has
 *   children out of view (a sibling drawn elsewhere is never promised);
 *   "▾ siblings" (siblingsShown) once the parents show them all — also
 *   after a click on a parent's "▸ children".
 *
 * `childrenUnshowable`: persons whose children a click drew none of (the
 * view's safety net): never shown again by the siblings tab either.
 */
export function siblingsTabState(
    data: StromData,
    personId: PersonId,
    inView: (id: PersonId) => boolean,
    unionChildIds: ReadonlySet<PersonId>,
    childrenShown: ReadonlySet<PersonId> = new Set(),
    childrenUnshowable: ReadonlySet<PersonId> = new Set(),
    ctx: ShownChildrenContext = {}
): SiblingsTabState | null {
    const person = data.persons[personId];
    if (!person) return null;
    const siblings = siblingIdsOf(data, personId, unionChildIds);
    if (siblings.size === 0) return null;
    const parentsInView = person.parentIds.filter(inView);
    if (parentsInView.length === 0) {
        if ([...siblings].some(inView)) return null;
        if (ctx.atDepthEdge?.(personId)) {
            const parents = person.parentIds.filter(q => !!data.persons[q] && !data.persons[q].isPlaceholder);
            const promised: PersonId[] = [];
            for (const q of parents) {
                for (const c of hiddenChildIds(data, q, inView)) if (c !== personId && !promised.includes(c)) promised.push(c);
            }
            if (promised.length > 0) return { kind: 'siblingsHere', parents, promised, beyondDepth: true };
        }
        return { kind: 'siblings', parents: [], promised: [] };
    }
    const hangs = ctx.hangsOnLine ?? (() => true);
    // Shown by a parent's click: in view now, not drawn before it
    const newly = (s: PersonId) => parentsInView.some(q => childrenShown.has(q)
        && (data.persons[q]?.childIds ?? []).includes(s) && !(ctx.visibleBefore?.(q)?.has(s) ?? false));
    if ([...siblings].some(s => inView(s) && hangs(s) && !newly(s))) return null;
    const parents = parentsInView.filter(q => !childrenShown.has(q) && !childrenUnshowable.has(q)
        && hiddenChildIds(data, q, inView).length > 0);
    const promised: PersonId[] = [];
    for (const q of parents) {
        for (const c of hiddenChildIds(data, q, inView)) if (c !== personId && !promised.includes(c)) promised.push(c);
    }
    if (promised.length > 0) return { kind: 'siblingsHere', parents, promised };
    if (parentsInView.some(q => childrenShown.has(q)) && [...siblings].some(s => inView(s) && newly(s))) {
        return { kind: 'siblingsShown', parents: [], promised: [] };
    }
    return null;
}

/**
 * The hidden-relatives tabs of a card, in the order the card shows them
 * (parents, siblings, children): parents get one when the person has
 * parents and none of them is in view (folded away for children shown in
 * place: parentsFolded; an ancestor at the edge of the depth: parentsHere),
 * "▾ parents" (parentsShown) while the person's own click shows them;
 * siblings as siblingsTabState decides (`ctx`: the
 * children shown in place). Both focus tabs at once (parents and siblings
 * out of view, nothing to anchor them to) become the one "◎ family".
 * Children get one when any child (not a "?" stand-in) is out of view, or
 * as "childrenShown" while `childrenShown` holds the person.
 * `childrenUnshowable`: persons whose children a click drew none of (the
 * view's safety net, TreeRenderer.toggleChildrenShown): no children tab.
 */
export function hiddenRelativesTabs(
    data: StromData,
    personId: PersonId,
    inView: (id: PersonId) => boolean,
    unionChildIds: ReadonlySet<PersonId>,
    childrenShown: ReadonlySet<PersonId> = new Set(),
    childrenUnshowable: ReadonlySet<PersonId> = new Set(),
    ctx: ShownChildrenContext = {}
): HiddenRelativesTab[] {
    const person = data.persons[personId];
    if (!person) return [];
    const out: HiddenRelativesTab[] = [];
    const parents = person.parentIds.length > 0 && !person.parentIds.some(inView);
    const folded = parents && (ctx.parentsFolded?.(personId) ?? false);
    const edge = parents && !folded && (ctx.atDepthEdge?.(personId) ?? false);
    const siblings = siblingsTabState(data, personId, inView, unionChildIds, childrenShown, childrenUnshowable, ctx);
    if (parents && !folded && !edge && siblings?.kind === 'siblings') out.push('family');
    else {
        if (parents) out.push(folded ? 'parentsFolded' : edge ? 'parentsHere' : 'parents');
        else if (ctx.parentsShown?.(personId) && person.parentIds.some(inView)) out.push('parentsShown');
        if (siblings) out.push(siblings.kind);
    }
    if (childrenShown.has(personId)) out.push('childrenShown');
    else if (!childrenUnshowable.has(personId) && hiddenChildIds(data, personId, inView).length > 0) out.push('children');
    return out;
}

/**
 * The siblings the parents' click brought into view (the "▾ siblings"
 * bubble): the children each parent in `childrenShown` shows that it did not
 * draw before (newlyShownChildIds), the person left out, each once.
 */
export function newlyShownSiblingIds(
    data: StromData,
    personId: PersonId,
    inView: (id: PersonId) => boolean,
    childrenShown: ReadonlySet<PersonId>,
    visibleBefore: (parentId: PersonId) => ReadonlySet<PersonId> | undefined
): PersonId[] {
    const out: PersonId[] = [];
    for (const q of data.persons[personId]?.parentIds ?? []) {
        if (!childrenShown.has(q)) continue;
        for (const c of newlyShownChildIds(data, q, inView, visibleBefore(q) ?? new Set())) {
            if (c !== personId && !out.includes(c)) out.push(c);
        }
    }
    return out;
}

/**
 * One group of siblings in a bubble: the full siblings (the person's own
 * union of the parents), or the half siblings of one parent's other union
 * (`parentId` with `partnerId`; null for a "?" stand-in or none).
 */
export interface SiblingGroup {
    full: boolean;
    parentId: PersonId | null;
    partnerId: PersonId | null;
    ids: PersonId[];
}

/**
 * `ids` (siblings of the person) by the union they were born to: the full
 * siblings first, then for each parent (the person's order of parents) the
 * children of the parent's other unions in the order of the marriages.
 * Empty groups are left out; siblings of no such union close the list in a
 * group of their own (no parent).
 */
export function siblingGroups(data: StromData, personId: PersonId, ids: readonly PersonId[]): SiblingGroup[] {
    const person = data.persons[personId];
    if (!person) return [];
    const left = new Set(ids);
    const take = (kids: readonly PersonId[]): PersonId[] => ids.filter(id => kids.includes(id) && left.delete(id));
    const own = Object.values(data.partnerships).find(u => u.childIds.includes(personId));
    const out: SiblingGroup[] = [];
    const full = take(own?.childIds ?? []);
    if (full.length) out.push({ full: true, parentId: null, partnerId: null, ids: full });
    for (const q of person.parentIds) {
        const ordered = marriagesInOrder(data, q);
        const unions = [...ordered, ...(data.persons[q]?.partnerships ?? []).filter(u => !ordered.includes(u))];
        for (const uid of unions) {
            const u = data.partnerships[uid];
            if (!u || uid === own?.id) continue;
            const kids = take(u.childIds);
            if (kids.length === 0) continue;
            const other = u.person1Id === q ? u.person2Id : u.person1Id;
            const partnerId = other && data.persons[other] && !data.persons[other].isPlaceholder ? other : null;
            out.push({ full: false, parentId: q, partnerId, ids: kids });
        }
    }
    const rest = ids.filter(id => left.has(id));
    if (rest.length) out.push({ full: false, parentId: null, partnerId: null, ids: rest });
    return out;
}

/**
 * The children a "▾ children" tab names: the person's children in view that
 * were not in view before the click (`visibleBefore`), in data order; never
 * the ones the view drew already ("?" stand-ins never count).
 */
export function newlyShownChildIds(
    data: StromData,
    personId: PersonId,
    inView: (id: PersonId) => boolean,
    visibleBefore: ReadonlySet<PersonId>
): PersonId[] {
    return (data.persons[personId]?.childIds ?? []).filter(id => {
        const child = data.persons[id];
        return !!child && !child.isPlaceholder && inView(id) && !visibleBefore.has(id);
    });
}

/**
 * The person's children out of view that showing them in place would draw
 * (the layout's own rule, childIdsShownInPlace: children of the person's
 * unions), in data order ("?" stand-ins never count). A child linked to the
 * person without a union is never drawn below them, so it is not promised.
 */
export function hiddenChildIds(data: StromData, personId: PersonId, inView: (id: PersonId) => boolean): PersonId[] {
    const showable = new Set(childIdsShownInPlace(data, personId));
    return (data.persons[personId]?.childIds ?? []).filter(id => {
        const child = data.persons[id];
        return !!child && !child.isPlaceholder && showable.has(id) && !inView(id);
    });
}

/**
 * The person's children in view that the view does not draw as children of
 * this family: no line comes down to them (`hangsOnLine`: the child is a drop
 * of a drawn parent line), they stand elsewhere in the tree — a daughter as
 * the wife in another branch, an ancestor through a marriage of relatives.
 * In data order; "?" stand-ins never count. The children tab never promises
 * them (they are in view already); its bubbles name them.
 */
export function childrenDrawnElsewhere(
    data: StromData,
    personId: PersonId,
    inView: (id: PersonId) => boolean,
    hangsOnLine: (id: PersonId) => boolean
): PersonId[] {
    return (data.persons[personId]?.childIds ?? []).filter(id => {
        const child = data.persons[id];
        return !!child && !child.isPlaceholder && inView(id) && !hangsOnLine(id);
    });
}

/**
 * The other partners a card's "▸ ∞" promises (§5): the partners of the
 * person's unions without children that the view does not draw (the
 * layout's own rule, partnerIdsShownInPlace: showing draws them as further
 * marriages beside the person), in data order; never an empty "?" stand-in.
 * A partner of a union with children comes with the children ("▸ children").
 */
export function hiddenPartnerIds(data: StromData, personId: PersonId, inView: (id: PersonId) => boolean): PersonId[] {
    return partnerIdsShownInPlace(data, personId).filter(id => !inView(id) && !isDiagramStandIn(data, id));
}

/** One marriage a card's "▸ ∞" offers: the partner, the union and how many children it has. */
export interface OfferedPartner {
    partnerId: PersonId;
    partnershipId: PartnershipId;
    /** The union's children (real persons), 0 for a marriage without children. */
    childCount: number;
}

/**
 * The marriages a card's "▸ ∞" offers. On a child shown in place in the
 * standard display (`everyMarriage`, round 5 §36), which stands with one
 * partner: every marriage whose partner the view does not draw, those with
 * children too (the pill then brings the partner with the children, as
 * "▸ children" brings that marriage), in the marriage order. Elsewhere the
 * partners of the marriages without children out of view
 * (hiddenPartnerIds, in data order). Never an empty "?" stand-in.
 */
export function offeredPartners(data: StromData, personId: PersonId, inView: (id: PersonId) => boolean,
    everyMarriage: boolean): OfferedPartner[] {
    const out: OfferedPartner[] = [];
    const unions = everyMarriage ? marriagesInOrder(data, personId) : (data.persons[personId]?.partnerships ?? []);
    for (const partnershipId of unions) {
        const union = data.partnerships[partnershipId];
        if (!union) continue;
        const partnerId = union.person1Id === personId ? union.person2Id : union.person1Id;
        const childCount = union.childIds.filter(id => !!data.persons[id] && !data.persons[id].isPlaceholder).length;
        if (!everyMarriage && union.childIds.length > 0) continue;
        if (partnerId === personId || !data.persons[partnerId] || inView(partnerId) || isDiagramStandIn(data, partnerId)) continue;
        if (out.some(o => o.partnerId === partnerId)) continue;
        out.push({ partnerId, partnershipId, childCount });
    }
    return out;
}

/** The children of one union of a person in a "▸ children" bubble (§5). */
export interface ChildrenUnionGroup {
    /** The union, null for children linked to the person outside any union. */
    partnershipId: PartnershipId | null;
    /** The union's place among the person's marriages, as the marriage-order pill counts it (0: outside them). */
    number: number;
    /** The other partner, null without one (or a "?" stand-in). */
    partnerId: PersonId | null;
    ids: PersonId[];
}

/**
 * The person's children `ids` by the union they were born to, in the order
 * of the marriages (marriagesInOrder, as the marriage-order pill numbers
 * them; a "?" stand-in family after them), each in the order of `ids`.
 * Children of no union of the person close the list. Empty groups are left
 * out. The bubble labels the groups only when there is more than one.
 */
export function childrenByUnion(data: StromData, personId: PersonId, ids: readonly PersonId[]): ChildrenUnionGroup[] {
    const person = data.persons[personId];
    if (!person) return [];
    const ordered = marriagesInOrder(data, personId);
    const unions = [...ordered, ...person.partnerships.filter(u => !ordered.includes(u))];
    const left = new Set(ids);
    const out: ChildrenUnionGroup[] = [];
    for (const uid of unions) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const kids = ids.filter(id => u.childIds.includes(id) && left.delete(id));
        if (kids.length === 0) continue;
        const other = u.person1Id === personId ? u.person2Id : u.person1Id;
        const partnerId = other !== personId && data.persons[other] && !data.persons[other].isPlaceholder ? other : null;
        out.push({ partnershipId: uid, number: ordered.indexOf(uid) + 1, partnerId, ids: kids });
    }
    const rest = ids.filter(id => left.has(id));
    if (rest.length) out.push({ partnershipId: null, number: 0, partnerId: null, ids: rest });
    return out;
}

/**
 * Whether showing these children of the person in place brings a partner
 * along: the other parent of some child (its union with the person) is not
 * in view, so the bubble says the partners come too (§5).
 */
export function childrenComeWithPartners(data: StromData, personId: PersonId, ids: readonly PersonId[], inView: (id: PersonId) => boolean): boolean {
    for (const uid of data.persons[personId]?.partnerships ?? []) {
        const u = data.partnerships[uid];
        if (!u || !u.childIds.some(id => ids.includes(id))) continue;
        const other = u.person1Id === personId ? u.person2Id : u.person1Id;
        if (other !== personId && data.persons[other] && !isDiagramStandIn(data, other) && !inView(other)) return true;
    }
    return false;
}

/**
 * The children of the person's other families that the view draws, all of
 * them, elsewhere in the tree (§5: "children ↗" in place of the former ⌂):
 * a union with children whose partner is out of view and whose every child
 * is in view without a line from this family (`hangsOnLine`, as
 * childrenDrawnElsewhere). In data order, each once; "?" stand-ins never
 * count, nor a "?" stand-in partner's family (drawn under the person).
 */
export function otherFamilyChildrenElsewhere(
    data: StromData,
    personId: PersonId,
    inView: (id: PersonId) => boolean,
    hangsOnLine: (id: PersonId) => boolean
): PersonId[] {
    const out: PersonId[] = [];
    for (const uid of data.persons[personId]?.partnerships ?? []) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const other = u.person1Id === personId ? u.person2Id : u.person1Id;
        if (other === personId || !data.persons[other] || inView(other) || isDiagramStandIn(data, other)) continue;
        const kids = u.childIds.filter(id => !!data.persons[id] && !data.persons[id].isPlaceholder);
        if (kids.length === 0 || !kids.every(id => inView(id) && !hangsOnLine(id))) continue;
        for (const id of kids) if (!out.includes(id)) out.push(id);
    }
    return out;
}

/** A direct-line card's place by birth among its siblings in view ("3 of 5"). */
export interface SiblingOrderMark {
    n: number;
    total: number;
}

/** Chronological key of a birth date; null when there is none. */
function birthKey(date: string | undefined): number | null {
    const key = weddingKey(date);
    return key === Infinity ? null : key;
}

/**
 * The sibling-order pill of a card (children shown in place): the layout
 * keeps the direct line at the inner end of its siblings' row and the others
 * by birth, so the direct-line card is the one that can stand out of order.
 * A mark when the person's parent shows the children in place (`childrenShown`),
 * the person stood in view before that click (the direct line, `visibleBefore`)
 * and does not stand where birth would put them in the row. `n` is the place
 * by birth among the children of the family in the row (the union the person
 * was born to; `hangsOnLine`: a child drawn elsewhere in the tree, say as a
 * wife in another branch, stands in no row of theirs), `total` their number.
 * No mark without a birth date (the person's or a sibling's: the place cannot
 * be told); siblings born the same day share the places they could take.
 */
export function siblingOrderMark(
    data: StromData,
    personId: PersonId,
    positions: ReadonlyMap<PersonId, { x: number }>,
    childrenShown: ReadonlySet<PersonId>,
    visibleBefore: (parentId: PersonId) => ReadonlySet<PersonId> | undefined,
    hangsOnLine: (id: PersonId) => boolean = () => true
): SiblingOrderMark | null {
    const person = data.persons[personId];
    const own = positions.get(personId);
    if (!person || person.isPlaceholder || !own || !hangsOnLine(personId)) return null;
    const parentId = person.parentIds.find(pid => childrenShown.has(pid) && !!visibleBefore(pid)?.has(personId));
    if (!parentId) return null;
    const union = Object.values(data.partnerships).find(u =>
        u.childIds.includes(personId) && (u.person1Id === parentId || u.person2Id === parentId));
    const family = (union?.childIds ?? data.persons[parentId]?.childIds ?? []).filter(id => {
        const child = data.persons[id];
        return !!child && !child.isPlaceholder && positions.has(id) && hangsOnLine(id);
    });
    if (family.length < 2) return null;
    const keys = new Map<PersonId, number>();
    for (const id of family) {
        const key = birthKey(data.persons[id].birthDate);
        if (key === null) return null;
        keys.set(id, key);
    }
    const ownKey = keys.get(personId)!;
    const n = 1 + family.filter(id => keys.get(id)! < ownKey).length;
    const sameDay = family.filter(id => id !== personId && keys.get(id) === ownKey).length;
    const place = 1 + family.filter(id => positions.get(id)!.x < own.x).length;
    if (place >= n && place <= n + sameDay) return null;
    return { n, total: family.length };
}

/**
 * The persons whose shown children close together with `ids`: those, and
 * every shown person whose card one of them brought into view (`broughtIn`:
 * the cards a click added), on and on — a child's shown children go with it.
 */
export function childrenShownClosing(
    ids: readonly PersonId[],
    shownIds: readonly PersonId[],
    broughtIn: (id: PersonId) => ReadonlySet<PersonId> | undefined
): Set<PersonId> {
    const out = new Set(ids.filter(id => shownIds.includes(id)));
    let grew = true;
    while (grew) {
        grew = false;
        for (const id of shownIds) {
            if (out.has(id) || ![...out].some(x => broughtIn(x)?.has(id))) continue;
            out.add(id);
            grew = true;
        }
    }
    return out;
}

/**
 * A tab that stands for a line the layout left out (LayoutResult.omittedEdges):
 * on the child's card "parents ↗", on a parent's card "child ↗" (or
 * "children ↗" for several). A click jumps to the other end.
 */
export type LineLinkTab = 'linkParents' | 'linkChild' | 'linkChildren';

/** Any tab on a card's top edge, in one row (branchTabsInOrder): the hidden-relatives tabs and the line links. */
export type BranchTab = HiddenRelativesTab | LineLinkTab;

/**
 * What a click on a tab does, carried by the pill's shape and glyph (not by
 * its colour): shows people in place, the view staying ("▸"/"▾", a round
 * pill), rebuilds the tree around the person ("◎", squarer corners), or moves
 * the view to a card drawn elsewhere ("↗" at the end, no shadow).
 */
export type TabKind = 'place' | 'focus' | 'jump';

/** The kind of a top-edge tab (TabKind). */
export function branchTabKind(tab: BranchTab): TabKind {
    switch (tab) {
        case 'parents':
        case 'family':
        case 'siblings': return 'focus';
        case 'linkParents':
        case 'linkChild':
        case 'linkChildren': return 'jump';
        default: return 'place';
    }
}

/** The relation a top-edge tab stands for (its place in the row, its short letter). */
export function branchTabRelation(tab: BranchTab): 'parents' | 'siblings' | 'children' {
    switch (tab) {
        case 'parents':
        case 'parentsHere':
        case 'parentsShown':
        case 'parentsFolded':
        case 'family':
        case 'linkParents': return 'parents';
        case 'siblings':
        case 'siblingsHere':
        case 'siblingsShown': return 'siblings';
        default: return 'children';
    }
}

/**
 * A card's top-edge tabs in the order the card shows them: by relation
 * (parents, siblings, children, as the generations go), a line link at the
 * place of the relation it stands for ("parents ↗" with the parents,
 * "child ↗" after the children tab). Stable within a relation.
 */
export function branchTabsInOrder(hidden: readonly HiddenRelativesTab[], links: readonly LineLinkTab[]): BranchTab[] {
    const rank = { parents: 0, siblings: 1, children: 2 } as const;
    return [...hidden, ...links]
        .map((tab, i) => ({ tab, i }))
        .sort((a, b) => rank[branchTabRelation(a.tab)] - rank[branchTabRelation(b.tab)] || a.i - b.i)
        .map(x => x.tab);
}

/** The other ends of a card's left-out lines: its parents (as a child) and its children (as a parent). */
export interface LineLinks {
    parentIds: PersonId[];
    childIds: PersonId[];
}

/**
 * The line links of every card with a left-out line, in the layout's order
 * (each id once). A parent of several left-out children gets one link to all.
 */
export function lineLinksOf(edges: readonly OmittedEdge[]): Map<PersonId, LineLinks> {
    const out = new Map<PersonId, LineLinks>();
    const of = (id: PersonId): LineLinks => {
        let links = out.get(id);
        if (!links) { links = { parentIds: [], childIds: [] }; out.set(id, links); }
        return links;
    };
    for (const edge of edges) {
        if (edge.parentIds.length === 0) continue;
        const child = of(edge.childId);
        for (const parentId of edge.parentIds) {
            if (!child.parentIds.includes(parentId)) child.parentIds.push(parentId);
            const parent = of(parentId);
            if (!parent.childIds.includes(edge.childId)) parent.childIds.push(edge.childId);
        }
    }
    return out;
}

/** The line-link tabs of a card, in the order the card shows them. */
export function lineLinkTabs(links: LineLinks | undefined): LineLinkTab[] {
    if (!links) return [];
    const out: LineLinkTab[] = [];
    if (links.parentIds.length > 0) out.push('linkParents');
    if (links.childIds.length === 1) out.push('linkChild');
    else if (links.childIds.length > 1) out.push('linkChildren');
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
