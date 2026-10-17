/**
 * Strict geometry audit for layout results.
 *
 * Goes beyond assertNoEdgeCrossings: catches every geometric artifact that
 * breaks the "natural reading" of a family tree, not just strict interior
 * crossings.
 *
 * Violation classes:
 *  - crossing:        two segments of different unions intersect (interior)
 *  - collinear:       two horizontal (or vertical) runs of different unions
 *                     overlap on the same line — they visually merge
 *  - t-touch:         a segment ENDPOINT lands on a FOREIGN segment — reads
 *                     as a junction that connects the wrong families
 *  - line-through-card: a segment passes through a person card's interior
 *
 * The line tests are the layout's own (src/layout/pipeline/line-geometry.ts,
 * which step 7 and the built-in validation use); the audit adds the cards.
 */

import { PersonId, LayoutConfig, StromData, personCardHeight } from '../../../types.js';
import { Connection, LayoutResult } from '../../pipeline/types.js';
import { layoutSegments, findLineViolations } from '../../pipeline/line-geometry.js';

const CARD_INSET = 2;     // cards are shrunk by this before the interior test

export interface GeometryViolation {
    /**
     * 'inherent-crossing' = a crossing between two CROSS-MARRIED unions
     * (a child of one is partnered with a child of the other, and both
     * unions have 2+ child drops). With atomic couples on one row and
     * single-bus T-routing, the two unions' drop intervals always interleave
     * or nest, so one clean perpendicular crossing is topologically
     * unavoidable — this is how genealogists draw it on paper too. Reported
     * separately so it can be tolerated without hiding avoidable crossings.
     */
    type: 'crossing' | 'inherent-crossing' | 'collinear' | 't-touch' | 'line-through-card';
    detail: string;
}

/**
 * Audit all segments and cards of a layout result.
 *
 * When `data` is provided, crossings between cross-married unions (see
 * GeometryViolation) are classified as 'inherent-crossing' instead of
 * 'crossing'.
 */
export function auditGeometry(
    result: LayoutResult,
    config: LayoutConfig,
    data?: StromData
): GeometryViolation[] {
    const violations: GeometryViolation[] = [];

    const segments = layoutSegments(result);
    const connByUnion = new Map<string, Connection>();
    for (const conn of result.connections) connByUnion.set(String(conn.unionId), conn);

    // Partner pairs from raw data (for the inherent-crossing classification)
    const partnerPairs = new Set<string>();
    if (data) {
        for (const p of Object.values(data.partnerships)) {
            if (p.person1Id && p.person2Id) {
                partnerPairs.add([p.person1Id, p.person2Id].sort().join('|'));
            }
        }
    }

    /** True when a crossing between these two unions is topologically forced. */
    const isInherentCrossing = (ownerA: string, ownerB: string): boolean => {
        if (partnerPairs.size === 0) return false;
        const a = connByUnion.get(ownerA);
        const b = connByUnion.get(ownerB);
        if (!a || !b) return false;
        // Both unions must have 2+ drops — with a single drop the crossing is
        // avoidable by ordering (e.g. pedigree-collapse partner swap)
        if (a.drops.length < 2 || b.drops.length < 2) return false;
        for (const da of a.drops) {
            for (const db of b.drops) {
                if (partnerPairs.has([da.personId, db.personId].sort().join('|'))) {
                    return true;
                }
            }
        }
        return false;
    };

    // --- Line checks (shared with the layout) ---
    for (const v of findLineViolations(segments)) {
        violations.push({
            type: v.type === 'crossing' && isInherentCrossing(v.a.owner, v.b.owner) ? 'inherent-crossing' : v.type,
            detail: v.detail
        });
    }

    // --- Line-through-card checks ---
    const cards: Array<{ personId: PersonId; left: number; top: number; right: number; bottom: number }> = [];
    for (const [personId, pos] of result.positions) {
        cards.push({
            personId,
            left: pos.x + CARD_INSET,
            top: pos.y + CARD_INSET,
            right: pos.x + config.cardWidth - CARD_INSET,
            bottom: pos.y + personCardHeight(config, personId) - CARD_INSET
        });
    }

    for (const seg of segments) {
        // Spouse lines are exempt: the renderer deliberately interrupts them
        // around intermediate cards (segments with a 4px gap), so a straight
        // SpouseLine crossing a card never renders through it.
        if (seg.kind === 'spouse') continue;
        const sL = Math.min(seg.x1, seg.x2), sR = Math.max(seg.x1, seg.x2);
        const sT = Math.min(seg.y1, seg.y2), sB = Math.max(seg.y1, seg.y2);
        for (const card of cards) {
            if (sR < card.left || sL > card.right || sB < card.top || sT > card.bottom) continue;
            violations.push({
                type: 'line-through-card',
                detail: `${seg.label} passes through card of ${card.personId} ` +
                    `[${(card.left - CARD_INSET).toFixed(0)},${(card.top - CARD_INSET).toFixed(0)}]`
            });
        }
    }

    return violations;
}
