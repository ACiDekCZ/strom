/**
 * The look of a line "linked in the view only" (src/view-links.ts): the
 * geometry the renderer needs to draw it hollow and to label it.
 *
 * - The hollow line is two strokes on top of each other (a wide one in the
 *   ghost's tone, a narrow one in the canvas colour). Drawn as separate
 *   segments the corners would be notched and the narrow stroke of one
 *   segment would be covered by the wide stroke of the next, so the
 *   segments of one link are chained into polylines first (chainSegments).
 * - A shown family's own line to its children stays a ghost line; only the
 *   part of its bus that reaches the link's anchor exists only in the view
 *   (splitBus).
 * - The label "unproven · H0022 B" sits on the line's horizontal stretch,
 *   else in the middle of its vertical one (labelSpot).
 */

/** One axis-aligned stretch of a tree line, in canvas coordinates. */
export interface LineSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface Point {
    x: number;
    y: number;
}

/** Endpoints closer than this are the same point (the layout's coordinates are floats). */
const SAME = 0.01;

const pointKey = (x: number, y: number): string => `${Math.round(x / SAME)}:${Math.round(y / SAME)}`;

/**
 * The segments chained into polylines: two segments that meet end to end,
 * and nothing else meets there, continue one polyline. Zero-length segments
 * are dropped. Every segment is in exactly one polyline, in the input order
 * of the polylines' first segments.
 */
export function chainSegments(segments: readonly LineSegment[]): Point[][] {
    const segs = segments.filter(s => Math.abs(s.x1 - s.x2) > SAME || Math.abs(s.y1 - s.y2) > SAME);
    const at = new Map<string, number[]>();
    segs.forEach((s, i) => {
        for (const k of [pointKey(s.x1, s.y1), pointKey(s.x2, s.y2)]) {
            const list = at.get(k);
            if (list) list.push(i); else at.set(k, [i]);
        }
    });
    const used = new Set<number>();
    const out: Point[][] = [];
    /** Walk on from `end` (a point of segment `from`) while the path does not fork. */
    const extend = (from: number, end: Point, push: (p: Point) => void): void => {
        let current = from;
        let point = end;
        for (;;) {
            const here = at.get(pointKey(point.x, point.y)) ?? [];
            if (here.length !== 2) return;
            const next = here[0] === current ? here[1] : here[0];
            if (used.has(next)) return;
            used.add(next);
            const s = segs[next];
            point = pointKey(s.x1, s.y1) === pointKey(point.x, point.y) ? { x: s.x2, y: s.y2 } : { x: s.x1, y: s.y1 };
            push(point);
            current = next;
        }
    };
    segs.forEach((s, i) => {
        if (used.has(i)) return;
        used.add(i);
        const points: Point[] = [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
        extend(i, points[1], p => points.push(p));
        extend(i, points[0], p => points.unshift(p));
        out.push(points);
    });
    return out;
}

/** An SVG path through the points. */
export function polylinePath(points: readonly Point[]): string {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/**
 * Where a link's label sits on its line: the middle of its longest
 * horizontal stretch at least `minRun` long (the label's width: it never
 * hangs over the line's corners), else the middle of its longest vertical
 * run (consecutive vertical segments count as one). Null: no line.
 */
export function labelSpot(segments: readonly LineSegment[], minRun: number): Point | null {
    let best: { len: number; p: Point } | null = null;
    for (const s of segments) {
        if (Math.abs(s.y1 - s.y2) > SAME) continue;
        const len = Math.abs(s.x2 - s.x1);
        if (len >= minRun && (!best || len > best.len)) best = { len, p: { x: (s.x1 + s.x2) / 2, y: s.y1 } };
    }
    if (best) return best.p;
    // Runs of vertical steps along each polyline (a vertical step after a vertical step continues the run).
    const runs: Array<{ from: Point; to: Point }> = [];
    for (const chain of chainSegments(segments)) {
        let run: { from: Point; to: Point } | null = null;
        for (let i = 1; i < chain.length; i++) {
            const a = chain[i - 1], b = chain[i];
            if (Math.abs(a.x - b.x) > SAME) { run = null; continue; }
            if (run) run.to = b;
            else { run = { from: a, to: b }; runs.push(run); }
        }
    }
    for (const run of runs) {
        const len = Math.abs(run.to.y - run.from.y);
        if (!best || len > best.len) best = { len, p: { x: run.from.x, y: (run.from.y + run.to.y) / 2 } };
    }
    if (best) return best.p;
    const s = segments.find(x => Math.abs(x.x1 - x.x2) > SAME || Math.abs(x.y1 - x.y2) > SAME);
    return s ? { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 } : null;
}

/**
 * A bus shared by a shown family's own children and a link's anchor: the
 * stretch over the family's own drops (and the point where its stem meets
 * the bus) stays a ghost line, the rest — out to the anchor's drop — exists
 * only in the view. `real`: the x of the stem's junction and of the family's
 * own drops; `virtual`: the x of the anchor drops.
 */
export function splitBus(left: number, right: number, real: readonly number[], virtual: readonly number[]): {
    ghost: [number, number] | null;
    virtual: Array<[number, number]>;
} {
    if (real.length === 0) return { ghost: null, virtual: [[left, right]] };
    const lo = Math.max(left, Math.min(...real));
    const hi = Math.min(right, Math.max(...real));
    const out: Array<[number, number]> = [];
    const leftMost = Math.min(...virtual.filter(x => x < lo - SAME), Infinity);
    const rightMost = Math.max(...virtual.filter(x => x > hi + SAME), -Infinity);
    if (isFinite(leftMost)) out.push([leftMost, lo]);
    if (isFinite(rightMost)) out.push([hi, rightMost]);
    return { ghost: hi - lo > SAME ? [lo, hi] : null, virtual: out };
}
