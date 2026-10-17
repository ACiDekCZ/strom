/**
 * Line geometry of a layout: the segments of the parent-child lines and the
 * partner lines, and the pairwise tests that find lines which read wrong.
 *
 * Violation classes (between segments of DIFFERENT unions; the segments of
 * one union and its partner line may meet freely):
 *  - crossing:  two segments intersect in their interiors
 *  - collinear: two horizontal (or vertical) runs overlap on the same line —
 *               they visually merge into one line
 *  - t-touch:   a segment's ENDPOINT lands on a foreign segment — it reads as
 *               a junction that connects the wrong families
 *
 * Used at runtime by step 7 (a child's line that cannot be drawn cleanly is
 * omitted, see omitUnroutableDrops), by the built-in validation, and by the
 * test geometry audit (which adds the line-through-card check).
 *
 * The pairs are found through a uniform grid over the segments' boxes, so a
 * layout costs about O(S · k) (k = segments sharing a cell), not O(S²).
 */

import { PersonId } from '../../types.js';
import { Connection, SpouseLine } from './types.js';

/** Same-line tolerance (bus lanes are >= 8px apart). */
export const LINE_EPS = 1.5;

export type LineSegmentKind = 'stem' | 'connector' | 'connector-drop' | 'bus' | 'drop' | 'spouse';

export interface LineSegment {
    x1: number; y1: number; x2: number; y2: number;
    /** The union the segment belongs to (its line or its partner line). */
    owner: string;
    label: string;
    kind: LineSegmentKind;
    /** A drop's child. */
    childId?: PersonId;
}

export type LineViolationType = 'crossing' | 'collinear' | 't-touch';

export interface LineViolation {
    type: LineViolationType;
    a: LineSegment;
    b: LineSegment;
    detail: string;
}

/** The segments of one parent-child line (stem, connector, bus, drops). */
export function connectionSegments(conn: Connection): LineSegment[] {
    const owner = String(conn.unionId);
    const segs: LineSegment[] = [];

    if (Math.abs(conn.stemBottomY - conn.stemTopY) > LINE_EPS) {
        segs.push({
            x1: conn.stemX, y1: conn.stemTopY, x2: conn.stemX, y2: conn.stemBottomY,
            owner, label: `stem-${owner}`, kind: 'stem'
        });
    }
    if (Math.abs(conn.connectorFromX - conn.connectorToX) > LINE_EPS) {
        segs.push({
            x1: conn.connectorFromX, y1: conn.connectorY, x2: conn.connectorToX, y2: conn.connectorY,
            owner, label: `connector-${owner}`, kind: 'connector'
        });
    }
    if (Math.abs(conn.connectorY - conn.branchY) > LINE_EPS) {
        segs.push({
            x1: conn.connectorToX, y1: conn.connectorY, x2: conn.connectorToX, y2: conn.branchY,
            owner, label: `connector-drop-${owner}`, kind: 'connector-drop'
        });
    }
    if (Math.abs(conn.branchRightX - conn.branchLeftX) > LINE_EPS) {
        segs.push({
            x1: conn.branchLeftX, y1: conn.branchY, x2: conn.branchRightX, y2: conn.branchY,
            owner, label: `bus-${owner}`, kind: 'bus'
        });
    }
    for (const drop of conn.drops) {
        segs.push({
            x1: drop.x, y1: drop.topY ?? conn.branchY, x2: drop.x, y2: drop.bottomY,
            owner, label: `drop-${owner}-${drop.personId}`, kind: 'drop', childId: drop.personId
        });
    }
    return segs;
}

/** A partner line as a segment (null when its cards touch). */
export function spouseLineSegment(line: SpouseLine): LineSegment | null {
    if (Math.abs(line.xMax - line.xMin) <= LINE_EPS) return null;
    return {
        x1: line.xMin, y1: line.y, x2: line.xMax, y2: line.y,
        owner: String(line.unionId),
        label: `spouse-${line.person1Id}-${line.person2Id}`,
        kind: 'spouse'
    };
}

/** Every line segment of a layout: the parent-child lines, then the partner lines. */
export function layoutSegments(layout: { connections: readonly Connection[]; spouseLines: readonly SpouseLine[] }): LineSegment[] {
    const segments: LineSegment[] = [];
    for (const conn of layout.connections) segments.push(...connectionSegments(conn));
    for (const line of layout.spouseLines) {
        const seg = spouseLineSegment(line);
        if (seg) segments.push(seg);
    }
    return segments;
}

const isHorizontal = (s: LineSegment): boolean => Math.abs(s.y1 - s.y2) <= LINE_EPS;
const isVertical = (s: LineSegment): boolean => Math.abs(s.x1 - s.x2) <= LINE_EPS;

/**
 * The violation between two segments, or null. Segments of one union (its
 * line and its partner line) never violate each other.
 */
export function segmentPairViolation(a: LineSegment, b: LineSegment): { type: LineViolationType; detail: string } | null {
    if (a.owner === b.owner) return null;
    const aH = isHorizontal(a), bH = isHorizontal(b);

    if (aH && bH) {
        // Collinear horizontal overlap
        if (Math.abs(a.y1 - b.y1) > LINE_EPS) return null;
        const left = Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
        const right = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2));
        if (right - left <= LINE_EPS) return null;
        return {
            type: 'collinear',
            detail: `${a.label} and ${b.label} merge at Y=${a.y1.toFixed(0)} over X=[${left.toFixed(0)},${right.toFixed(0)}]`
        };
    }
    if (!aH && !bH && isVertical(a) && isVertical(b)) {
        // Collinear vertical overlap
        if (Math.abs(a.x1 - b.x1) > LINE_EPS) return null;
        const top = Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2));
        const bottom = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2));
        if (bottom - top <= LINE_EPS) return null;
        return {
            type: 'collinear',
            detail: `${a.label} and ${b.label} merge at X=${a.x1.toFixed(0)} over Y=[${top.toFixed(0)},${bottom.toFixed(0)}]`
        };
    }

    // One horizontal, one vertical
    const h = aH ? a : b;
    const v = aH ? b : a;
    const hL = Math.min(h.x1, h.x2), hR = Math.max(h.x1, h.x2);
    const vT = Math.min(v.y1, v.y2), vB = Math.max(v.y1, v.y2);

    const xInside = v.x1 > hL + LINE_EPS && v.x1 < hR - LINE_EPS;
    const yInside = h.y1 > vT + LINE_EPS && h.y1 < vB - LINE_EPS;
    const xTouch = v.x1 >= hL - LINE_EPS && v.x1 <= hR + LINE_EPS;
    const yTouch = h.y1 >= vT - LINE_EPS && h.y1 <= vB + LINE_EPS;

    if (xInside && yInside) {
        return { type: 'crossing', detail: `${v.label} crosses ${h.label} at (${v.x1.toFixed(0)}, ${h.y1.toFixed(0)})` };
    }
    if (xInside && yTouch) {
        // The vertical's endpoint lands ON the foreign horizontal run
        return { type: 't-touch', detail: `${v.label} endpoint touches foreign ${h.label} at (${v.x1.toFixed(0)}, ${h.y1.toFixed(0)})` };
    }
    if (yInside && xTouch) {
        // The horizontal's endpoint lands ON the foreign vertical run
        return { type: 't-touch', detail: `${h.label} endpoint touches foreign ${v.label} at (${v.x1.toFixed(0)}, ${h.y1.toFixed(0)})` };
    }
    return null;
}

/** Grid cell size (px): a band's buses and drops share a row or two of cells. */
const CELL = 128;
const CELL_BIAS = 1 << 20;

const cellKey = (cx: number, cy: number): number => (cx + CELL_BIAS) * (1 << 22) + (cy + CELL_BIAS);

interface Box { minCX: number; maxCX: number; minCY: number; maxCY: number; minX: number; minY: number }

function boxOf(s: LineSegment): Box {
    const minX = Math.min(s.x1, s.x2) - LINE_EPS, maxX = Math.max(s.x1, s.x2) + LINE_EPS;
    const minY = Math.min(s.y1, s.y2) - LINE_EPS, maxY = Math.max(s.y1, s.y2) + LINE_EPS;
    return {
        minCX: Math.floor(minX / CELL), maxCX: Math.floor(maxX / CELL),
        minCY: Math.floor(minY / CELL), maxCY: Math.floor(maxY / CELL),
        minX, minY
    };
}

/**
 * The segments of a layout in a uniform grid: the segments that may touch
 * a given one, without testing every pair.
 */
export class SegmentIndex {
    readonly segments: readonly LineSegment[];
    private readonly boxes: Box[];
    private readonly cells = new Map<number, number[]>();
    private stamp: Int32Array;
    private round = 0;

    constructor(segments: readonly LineSegment[]) {
        this.segments = segments;
        this.boxes = segments.map(boxOf);
        this.stamp = new Int32Array(segments.length);
        this.boxes.forEach((b, i) => {
            for (let cx = b.minCX; cx <= b.maxCX; cx++) {
                for (let cy = b.minCY; cy <= b.maxCY; cy++) {
                    const k = cellKey(cx, cy);
                    const list = this.cells.get(k);
                    if (list) list.push(i); else this.cells.set(k, [i]);
                }
            }
        });
    }

    /** Every violation between two indexed segments, in segment order. */
    violations(): LineViolation[] {
        const found: Array<{ i: number; j: number; v: { type: LineViolationType; detail: string } }> = [];
        const segs = this.segments;
        for (const [k, list] of this.cells) {
            if (list.length < 2) continue;
            const cx = Math.floor(k / (1 << 22)) - CELL_BIAS;
            const cy = (k % (1 << 22)) - CELL_BIAS;
            for (let p = 0; p < list.length; p++) {
                const i = list[p];
                for (let q = p + 1; q < list.length; q++) {
                    const j = list[q];
                    if (segs[i].owner === segs[j].owner) continue;
                    // Test a pair once: in the cell of its boxes' common corner
                    const bi = this.boxes[i], bj = this.boxes[j];
                    if (Math.floor(Math.max(bi.minX, bj.minX) / CELL) !== cx
                        || Math.floor(Math.max(bi.minY, bj.minY) / CELL) !== cy) continue;
                    const [lo, hi] = i < j ? [i, j] : [j, i];
                    const v = segmentPairViolation(segs[lo], segs[hi]);
                    if (v) found.push({ i: lo, j: hi, v });
                }
            }
        }
        found.sort((x, y) => x.i - y.i || x.j - y.j);
        return found.map(f => ({ type: f.v.type, a: segs[f.i], b: segs[f.j], detail: f.v.detail }));
    }

    /** How many indexed segments (not of `skipOwner`) the given segment violates. */
    countViolationsWith(seg: LineSegment, skipOwner: string): number {
        const b = boxOf(seg);
        if (++this.round === 0x7fffffff) { this.stamp.fill(0); this.round = 1; }
        let n = 0;
        for (let cx = b.minCX; cx <= b.maxCX; cx++) {
            for (let cy = b.minCY; cy <= b.maxCY; cy++) {
                const list = this.cells.get(cellKey(cx, cy));
                if (!list) continue;
                for (const i of list) {
                    if (this.stamp[i] === this.round) continue;
                    this.stamp[i] = this.round;
                    const other = this.segments[i];
                    if (other.owner === skipOwner) continue;
                    if (segmentPairViolation(other, seg)) n++;
                }
            }
        }
        return n;
    }
}

/** Every crossing, collinear run and T-touch between lines of different unions. */
export function findLineViolations(segments: readonly LineSegment[]): LineViolation[] {
    return new SegmentIndex(segments).violations();
}
