/**
 * Clearance between the horizontal runs of the lines (bus and connector)
 * and the cards' top and bottom edges.
 *
 * In the dense spacing a gap between two generations is 48 px: the bus
 * lanes stay at most one lane (8 px) off its middle, so every run keeps
 * 16 px from the cards above and below it, and the pills on a card's edge
 * (9 px out + 4 px room) never touch a bus. A gap whose lines need more
 * lanes grows instead (LayoutResult.gapExtra).
 */

import { LayoutConfig, personCardHeight } from '../../../types.js';
import type { LayoutResult } from '../../pipeline/types.js';

/** Runs closer than `min` px to the top or bottom edge of a card under or over them. */
export function auditBusClearance(result: LayoutResult, config: LayoutConfig, min: number): string[] {
    const out: string[] = [];
    const EPS = 0.5;
    const cards = [...result.positions].map(([id, pos]) => ({
        id, left: pos.x, right: pos.x + config.cardWidth, top: pos.y, bottom: pos.y + personCardHeight(config, id),
    }));
    for (const conn of result.connections) {
        const runs: Array<[string, number, number, number]> = [
            ['bus', Math.min(conn.branchLeftX, conn.branchRightX), Math.max(conn.branchLeftX, conn.branchRightX), conn.branchY],
        ];
        if (Math.abs(conn.connectorFromX - conn.connectorToX) > EPS) {
            runs.push(['connector', Math.min(conn.connectorFromX, conn.connectorToX), Math.max(conn.connectorFromX, conn.connectorToX), conn.connectorY]);
        }
        for (const [name, left, right, y] of runs) {
            for (const card of cards) {
                if (right <= card.left + EPS || left >= card.right - EPS) continue;
                const d = y < card.top ? card.top - y : y > card.bottom ? y - card.bottom : 0;
                if (d < min - EPS) {
                    out.push(`${name} of ${conn.unionId} at Y=${y.toFixed(1)} is ${d.toFixed(1)} px from card ${card.id}`);
                }
            }
        }
    }
    return out;
}
