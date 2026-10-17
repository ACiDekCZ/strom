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

import { PersonId, LayoutConfig, personCardHeight } from '../../../types.js';
import { LayoutResult } from '../../pipeline/types.js';
import { layoutSegments, findLineViolations } from '../../pipeline/line-geometry.js';

const CARD_INSET = 2;     // cards are shrunk by this before the interior test

export interface GeometryViolation {
    type: 'crossing' | 'collinear' | 't-touch' | 'line-through-card';
    detail: string;
}

/**
 * Audit all segments and cards of a layout result. No line contact is
 * tolerated: a knot no placement avoids (two cross-married families, an
 * in-law column inside a sibling bus) is resolved by step 7 leaving the line
 * out (LayoutResult.omittedEdges, shown as card links), never by the audit.
 */
export function auditGeometry(
    result: LayoutResult,
    config: LayoutConfig
): GeometryViolation[] {
    const violations: GeometryViolation[] = [];

    const segments = layoutSegments(result);

    // --- Line checks (shared with the layout) ---
    for (const v of findLineViolations(segments)) {
        violations.push({ type: v.type, detail: v.detail });
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
