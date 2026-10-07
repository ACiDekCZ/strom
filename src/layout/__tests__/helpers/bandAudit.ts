/**
 * Audit of the vertical layout with per-person card heights (custom card
 * "by content", LayoutConfig.personHeights).
 *
 * Checks that every generation is one horizontal band (invariant 7) with
 * the cards top-aligned in it, the band as tall as its tallest card, the
 * bus between the bands (invariant 8), the stems starting at the right
 * card's bottom or on the partner line, the drops ending at the child's
 * card top — and, against a run of the same tree with uniform cards, that
 * the X placement and the bus lanes are unchanged.
 */

import { LayoutConfig, PersonId, personCardHeight } from '../../../types.js';
import type { LayoutResult } from '../../pipeline/types.js';

const EPS = 0.01;

/** Deterministic synthetic card height per person, 56–294 px (FNV-1a of the id). */
export function syntheticCardHeight(personId: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < personId.length; i++) {
        h ^= personId.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 56 + (h % 239);
}

export function syntheticPersonHeights(personIds: Iterable<string>): Map<PersonId, number> {
    const map = new Map<PersonId, number>();
    for (const id of personIds) map.set(id as PersonId, syntheticCardHeight(id));
    return map;
}

/**
 * Violations of the band rules in `result` (laid out with `config`, which
 * carries personHeights). With `uniform` (the same tree, focus and policy
 * laid out without personHeights) the X geometry and the bus lanes must
 * match it.
 */
export function auditBands(result: LayoutResult, config: LayoutConfig, uniform?: LayoutResult): string[] {
    const out: string[] = [];
    const bands = result.bands;
    if (!bands || bands.length === 0) {
        if (result.positions.size > 0) out.push('no bands in the result');
        return out;
    }

    // Bands follow each other: top(g+1) = top(g) + height(g) + verticalGap
    const bandByTop = new Map<number, number>();  // rounded top -> index
    for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        if (i > 0) {
            const prev = bands[i - 1];
            if (b.generation !== prev.generation + 1) out.push(`band ${b.generation} does not follow ${prev.generation}`);
            if (Math.abs(b.top - (prev.top + prev.height + config.verticalGap)) > EPS) {
                out.push(`band ${b.generation} top ${b.top} != ${prev.top} + ${prev.height} + ${config.verticalGap}`);
            }
        }
        bandByTop.set(Math.round(b.top * 100), i);
    }

    // Every card's top is a band's top; the band is exactly its tallest card
    const tallest = new Array<number>(bands.length).fill(-Infinity);
    const bandOf = new Map<PersonId, number>();
    for (const [pid, pos] of result.positions) {
        const i = bandByTop.get(Math.round(pos.y * 100));
        if (i === undefined) {
            out.push(`card ${pid} top ${pos.y} is not a band top`);
            continue;
        }
        bandOf.set(pid, i);
        tallest[i] = Math.max(tallest[i], personCardHeight(config, pid));
    }
    for (let i = 0; i < bands.length; i++) {
        if (tallest[i] > -Infinity && Math.abs(tallest[i] - bands[i].height) > EPS) {
            out.push(`band ${bands[i].generation} height ${bands[i].height} != tallest card ${tallest[i]}`);
        }
    }
    const bandBottom = (i: number) => bands[i].top + bands[i].height;

    for (const conn of result.connections) {
        const u = String(conn.unionId);
        const childBand = conn.drops.length > 0 ? bandOf.get(conn.drops[0].personId) : undefined;
        // Drops end at the child's card top
        for (const drop of conn.drops) {
            const pos = result.positions.get(drop.personId);
            if (pos && Math.abs(drop.bottomY - pos.y) > EPS) out.push(`drop ${u}->${drop.personId} ends at ${drop.bottomY}, card top ${pos.y}`);
        }
        if (childBand === undefined || childBand === 0) continue;
        const parentBand = childBand - 1;
        // Bus and connector run in the gap between the parent and the child band
        for (const [name, y] of [['bus', conn.branchY], ['connector', conn.connectorY]] as const) {
            if (!(y > bandBottom(parentBand) + EPS && y < bands[childBand].top - EPS)) {
                out.push(`${name} ${u} at ${y} outside the gap ${bandBottom(parentBand)}..${bands[childBand].top}`);
            }
        }
        if (conn.stemPersonId) {
            // Stem from the bottom of that person's card, inside its width
            const pos = result.positions.get(conn.stemPersonId);
            if (!pos) {
                out.push(`stem ${u} from ${conn.stemPersonId}, who has no card`);
            } else {
                const bottom = pos.y + personCardHeight(config, conn.stemPersonId);
                if (Math.abs(conn.stemTopY - bottom) > EPS) out.push(`stem ${u} starts at ${conn.stemTopY}, card bottom of ${conn.stemPersonId} is ${bottom}`);
                if (conn.stemX < pos.x - EPS || conn.stemX > pos.x + config.cardWidth + EPS) {
                    out.push(`stem ${u} at x ${conn.stemX} is not under the card of ${conn.stemPersonId}`);
                }
            }
        } else {
            // Stem from the partner line: inside both partners' cards in height
            const line = result.spouseLines.find(l => l.unionId === conn.unionId);
            if (!line) {
                out.push(`stem ${u} has neither a stem person nor a partner line`);
            } else {
                if (Math.abs(conn.stemTopY - line.y) > EPS) out.push(`stem ${u} starts at ${conn.stemTopY}, partner line at ${line.y}`);
                for (const pid of [line.person1Id, line.person2Id]) {
                    const pos = result.positions.get(pid);
                    if (pos && !(line.y > pos.y && line.y < pos.y + personCardHeight(config, pid))) {
                        out.push(`partner line ${u} at ${line.y} misses the card of ${pid}`);
                    }
                }
            }
        }
    }

    if (uniform) out.push(...compareWithUniform(result, uniform));
    return out;
}

/** X placement and bus lanes equal to the uniform-card layout. */
function compareWithUniform(result: LayoutResult, uniform: LayoutResult): string[] {
    const out: string[] = [];
    if (result.positions.size !== uniform.positions.size) out.push(`${result.positions.size} cards, uniform ${uniform.positions.size}`);
    for (const [pid, pos] of result.positions) {
        const u = uniform.positions.get(pid);
        if (!u || Math.abs(u.x - pos.x) > EPS) out.push(`card ${pid} x ${pos.x}, uniform ${u?.x}`);
    }
    // Middle of the gap above the band whose top is y
    const gapMidAbove = (r: LayoutResult, y: number): number => {
        const i = r.bands!.findIndex(b => Math.abs(b.top - y) < EPS);
        if (i <= 0) return NaN;
        const above = r.bands![i - 1];
        return (above.top + above.height + y) / 2;
    };
    const uniformConn = new Map(uniform.connections.map(c => [c.unionId, c]));
    if (result.connections.length !== uniform.connections.length) {
        out.push(`${result.connections.length} connections, uniform ${uniform.connections.length}`);
    }
    for (const conn of result.connections) {
        const u = uniformConn.get(conn.unionId);
        if (!u) { out.push(`connection ${conn.unionId} missing in the uniform layout`); continue; }
        const xs = (c: typeof conn) => [c.stemX, c.branchLeftX, c.branchRightX, c.connectorFromX, c.connectorToX, ...c.drops.map(d => d.x)];
        const a = xs(conn), b = xs(u);
        if (a.length !== b.length || a.some((x, i) => Math.abs(x - b[i]) > EPS)) out.push(`connection ${conn.unionId} X differs from uniform`);
        if (conn.stemPersonId !== u.stemPersonId) out.push(`connection ${conn.unionId} stem person ${conn.stemPersonId}, uniform ${u.stemPersonId}`);
        // The same lane: the same offset from the middle of the gap
        if (conn.drops.length === 0 || u.drops.length === 0) continue;
        const mid = gapMidAbove(result, conn.drops[0].bottomY);
        const uMid = gapMidAbove(uniform, u.drops[0].bottomY);
        const lanes = [conn.branchY - mid, conn.connectorY - mid];
        const uLanes = [u.branchY - uMid, u.connectorY - uMid];
        if (lanes.some((l, i) => !(Math.abs(l - uLanes[i]) <= EPS))) {
            out.push(`connection ${conn.unionId} lanes ${lanes.join('/')}, uniform ${uLanes.join('/')}`);
        }
    }
    return out;
}
