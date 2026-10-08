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
 * - a marriage-order pill ("1. ∞ 1866") on the top edge of each partner of a
 *   person with two or more unions in view, at the corner that points to
 *   that person (the screen and the image export).
 *
 * The number counts every union of the person in the data, so a marriage
 * keeps its number however much of the family the view shows. An empty "?"
 * stand-in the diagram leaves out (T11) is a family, not a marriage: it is
 * not counted.
 */

import { PartnershipId, PersonId, Position, StromData, Partnership } from './types.js';
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

/** One marriage-order pill on a partner's card. */
export interface UnionOrderBadge {
    /** The card that carries the pill (a partner). */
    personId: PersonId;
    /** The person with several unions in view the pill counts for. */
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
 * The marriage-order pills of a laid-out view, per card. A union is in view
 * when its partner line is drawn (both cards shown). Each partner of a person
 * with two or more unions in view gets a pill for that union; the person
 * themself gets none (unless they are, in turn, the partner of someone with
 * several unions in view).
 *
 * `data` gives the shown year and place (the export passes its
 * privacy-filtered copy); `orderData` gives the order, so the numbers match
 * the screen even where the export leaves a wedding date out.
 */
export function unionOrderBadges(
    data: StromData,
    layout: UnionOrderLayout,
    orderData: StromData = data
): Map<PersonId, UnionOrderBadge[]> {
    const inView = new Map<PersonId, Set<PartnershipId>>();
    for (const line of layout.spouseLines) {
        const pid = line.partnershipId;
        if (!pid || !data.partnerships[pid]) continue;
        if (!layout.positions.has(line.person1Id) || !layout.positions.has(line.person2Id)) continue;
        for (const id of [line.person1Id, line.person2Id]) {
            let set = inView.get(id);
            if (!set) inView.set(id, set = new Set());
            set.add(pid);
        }
    }

    const out = new Map<PersonId, UnionOrderBadge[]>();
    for (const [towardId, unions] of inView) {
        if (unions.size < 2) continue;
        const order = marriagesInOrder(orderData, towardId);
        const towardPos = layout.positions.get(towardId)!;
        for (const pid of unions) {
            const number = order.indexOf(pid) + 1;
            if (number === 0) continue;
            const union = data.partnerships[pid];
            const personId = union.person1Id === towardId ? union.person2Id : union.person1Id;
            const pos = layout.positions.get(personId);
            if (!pos || personId === towardId) continue;
            const list = out.get(personId) ?? [];
            list.push({
                personId,
                towardId,
                partnershipId: pid,
                number,
                year: union.startDate ? displayYear(union.startDate) : '',
                place: union.startPlace?.trim() ?? '',
                married: union.status !== 'partners' && union.status !== 'separated',
                side: towardPos.x < pos.x ? 'left' : 'right',
            });
            out.set(personId, list);
        }
    }
    for (const list of out.values()) {
        list.sort((a, b) => (a.side === b.side ? a.number - b.number : a.side === 'left' ? -1 : 1));
    }
    return out;
}
