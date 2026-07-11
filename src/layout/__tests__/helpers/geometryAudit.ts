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
 */

import { PersonId, Position, LayoutConfig, StromData } from '../../../types.js';
import { Connection, SpouseLine, LayoutResult } from '../../pipeline/types.js';

const EPS = 1.5;          // same-line tolerance (lane offsets are >= 8px apart)
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

interface Segment {
    x1: number; y1: number; x2: number; y2: number;
    owner: string;           // unionId — segments of the same union may touch
    label: string;
    kind: 'stem' | 'connector' | 'connector-drop' | 'bus' | 'drop' | 'spouse';
}

function connectionSegments(conn: Connection): Segment[] {
    const owner = String(conn.unionId);
    const segs: Segment[] = [];

    if (Math.abs(conn.stemBottomY - conn.stemTopY) > EPS) {
        segs.push({
            x1: conn.stemX, y1: conn.stemTopY, x2: conn.stemX, y2: conn.stemBottomY,
            owner, label: `stem-${owner}`, kind: 'stem'
        });
    }
    if (Math.abs(conn.connectorFromX - conn.connectorToX) > EPS) {
        segs.push({
            x1: conn.connectorFromX, y1: conn.connectorY, x2: conn.connectorToX, y2: conn.connectorY,
            owner, label: `connector-${owner}`, kind: 'connector'
        });
    }
    if (Math.abs(conn.connectorY - conn.branchY) > EPS) {
        segs.push({
            x1: conn.connectorToX, y1: conn.connectorY, x2: conn.connectorToX, y2: conn.branchY,
            owner, label: `connector-drop-${owner}`, kind: 'connector-drop'
        });
    }
    if (Math.abs(conn.branchRightX - conn.branchLeftX) > EPS) {
        segs.push({
            x1: conn.branchLeftX, y1: conn.branchY, x2: conn.branchRightX, y2: conn.branchY,
            owner, label: `bus-${owner}`, kind: 'bus'
        });
    }
    for (const drop of conn.drops) {
        segs.push({
            x1: drop.x, y1: drop.topY ?? conn.branchY, x2: drop.x, y2: drop.bottomY,
            owner, label: `drop-${owner}-${drop.personId}`, kind: 'drop'
        });
    }
    return segs;
}

function spouseLineSegment(line: SpouseLine): Segment | null {
    if (Math.abs(line.xMax - line.xMin) <= EPS) return null;
    return {
        x1: line.xMin, y1: line.y, x2: line.xMax, y2: line.y,
        owner: `spouse-${line.unionId}`,
        label: `spouse-${line.person1Id}-${line.person2Id}`,
        kind: 'spouse'
    };
}

const isHorizontal = (s: Segment): boolean => Math.abs(s.y1 - s.y2) <= EPS;
const isVertical = (s: Segment): boolean => Math.abs(s.x1 - s.x2) <= EPS;

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

    const segments: Segment[] = [];
    const connByUnion = new Map<string, Connection>();
    for (const conn of result.connections) {
        segments.push(...connectionSegments(conn));
        connByUnion.set(String(conn.unionId), conn);
    }
    for (const line of result.spouseLines) {
        const seg = spouseLineSegment(line);
        if (seg) segments.push(seg);
    }

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

    // Spouse segments share ownership with their union's connection segments
    const ownerKey = (s: Segment): string => s.owner.replace(/^spouse-/, '');

    // --- Pairwise segment checks ---
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const a = segments[i];
            const b = segments[j];
            if (ownerKey(a) === ownerKey(b)) continue;

            const aH = isHorizontal(a), bH = isHorizontal(b);

            if (aH && bH) {
                // Collinear horizontal overlap
                if (Math.abs(a.y1 - b.y1) <= EPS) {
                    const left = Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
                    const right = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2));
                    if (right - left > EPS) {
                        violations.push({
                            type: 'collinear',
                            detail: `${a.label} and ${b.label} merge at Y=${a.y1.toFixed(0)} over X=[${left.toFixed(0)},${right.toFixed(0)}]`
                        });
                    }
                }
            } else if (!aH && !bH && isVertical(a) && isVertical(b)) {
                // Collinear vertical overlap
                if (Math.abs(a.x1 - b.x1) <= EPS) {
                    const top = Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2));
                    const bottom = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2));
                    if (bottom - top > EPS) {
                        violations.push({
                            type: 'collinear',
                            detail: `${a.label} and ${b.label} merge at X=${a.x1.toFixed(0)} over Y=[${top.toFixed(0)},${bottom.toFixed(0)}]`
                        });
                    }
                }
            } else {
                // One horizontal, one vertical
                const h = aH ? a : b;
                const v = aH ? b : a;
                const hL = Math.min(h.x1, h.x2), hR = Math.max(h.x1, h.x2);
                const vT = Math.min(v.y1, v.y2), vB = Math.max(v.y1, v.y2);

                const xInside = v.x1 > hL + EPS && v.x1 < hR - EPS;
                const yInside = h.y1 > vT + EPS && h.y1 < vB - EPS;
                const xTouch = v.x1 >= hL - EPS && v.x1 <= hR + EPS;
                const yTouch = h.y1 >= vT - EPS && h.y1 <= vB + EPS;

                if (xInside && yInside) {
                    violations.push({
                        type: isInherentCrossing(ownerKey(a), ownerKey(b))
                            ? 'inherent-crossing'
                            : 'crossing',
                        detail: `${v.label} crosses ${h.label} at (${v.x1.toFixed(0)}, ${h.y1.toFixed(0)})`
                    });
                } else if (xInside && yTouch && !yInside) {
                    // Vertical endpoint lands ON the foreign horizontal run
                    violations.push({
                        type: 't-touch',
                        detail: `${v.label} endpoint touches foreign ${h.label} at (${v.x1.toFixed(0)}, ${h.y1.toFixed(0)})`
                    });
                } else if (yInside && xTouch && !xInside) {
                    // Horizontal endpoint lands ON the foreign vertical run
                    violations.push({
                        type: 't-touch',
                        detail: `${h.label} endpoint touches foreign ${v.label} at (${v.x1.toFixed(0)}, ${h.y1.toFixed(0)})`
                    });
                }
            }
        }
    }

    // --- Line-through-card checks ---
    const cards: Array<{ personId: PersonId; left: number; top: number; right: number; bottom: number }> = [];
    for (const [personId, pos] of result.positions) {
        cards.push({
            personId,
            left: pos.x + CARD_INSET,
            top: pos.y + CARD_INSET,
            right: pos.x + config.cardWidth - CARD_INSET,
            bottom: pos.y + config.cardHeight - CARD_INSET
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
