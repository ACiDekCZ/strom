/**
 * A live load of the research's tree (spec 055): the timing and the geometry
 * of the transition from the tree shown to the one just loaded. Same motion
 * as children shown in place (src/children-transition.ts): the cards that
 * stay move to their new places (FLIP), new people grow out of their line,
 * people taken away shrink back into it, the lines cross-fade. On top of it
 * the "light along the line": a short glow runs down the line from the
 * parents to a new card, and the card lights up once it arrives.
 *
 * Pure functions here; no DOM (TreeRenderer.renderLive runs it).
 */

import { CHILDREN_EASE, STEM_SCALE } from './children-transition.js';

export const LIVE = {
    move: 320, compactMove: 280,
    ease: CHILDREN_EASE,
    stemScale: STEM_SCALE, stagger: 20,
    /** A partner's card grows before the children of the same couple: they wait this long. */
    childAfterPartner: 40,
    removeMs: 260, removeFade: [80, 220] as const,
    mergeFade: [160, 320] as const, mergeScale: 0.96,
    /** A card with no line to grow from fades in on its place. */
    fadeOnlyMs: 160,
    linesOutMs: 80, linesIn: [200, 360] as const,
    ring: { in: 150, holdUntil: 500, outUntil: 1000, staticMs: 1600 },
    pulse: { from: 200, to: 560, ease: 'cubic-bezier(0.4, 0, 0.2, 1)', dash: 34, minLine: 48, max: 6 },
    bloom: { from: 540, ms: 380 },
    edge: { in: [200, 400] as const, holdMs: 4000, outMs: 600, length: 36, thick: 6, corner: 8, hit: 44 },
    /** Cards beyond the view widened by this many px on each side do not animate. */
    offscreenMargin: 64,
    maxAnimatedNew: 12, maxChangedForScene: 60,
    /** A phone or tablet: every time × this. */
    compactFactor: 0.875,
} as const;

/** The scene's times on this device: × 0.875 on a phone or tablet. */
export function liveTime(ms: number, compact: boolean): number {
    return compact ? Math.round(ms * LIVE.compactFactor) : ms;
}

/** Whether the scene moves anything: the setting on and the system does not reduce motion. */
export function liveMotionOn(setting: boolean, reducedMotion: boolean): boolean {
    return setting && !reducedMotion;
}

export interface Point { x: number; y: number }

/** A polyline's length. */
export function polylineLength(points: readonly Point[]): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return len;
}

/** The polyline without repeated points and without points in the middle of a straight run. */
export function simplifyPolyline(points: readonly Point[]): Point[] {
    const out: Point[] = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
        if (out.length >= 2) {
            const a = out[out.length - 2], b = last!;
            const straight = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5);
            if (straight) out[out.length - 1] = p;
            else out.push(p);
            continue;
        }
        out.push(p);
    }
    return out;
}

/** An SVG path of the polyline ("M x y L x y …"). */
export function polylinePath(points: readonly Point[]): string {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** What the light needs of a parent line (a subset of the layout's Connection). */
export interface LineOfChildren {
    stemX: number;
    stemTopY: number;
    connectorY: number;
    connectorToX: number;
    branchY: number;
    drops: ReadonlyArray<{ personId: string; x: number; bottomY: number }>;
}

/**
 * The way the light runs from the parents to the child `childId`: down the
 * stem, along the connector and the bus, down the child's drop to the top
 * of its card. Null when the line has no drop to the child.
 */
export function childLightPath(line: LineOfChildren, childId: string): Point[] | null {
    const drop = line.drops.find(d => d.personId === childId);
    if (!drop) return null;
    return simplifyPolyline([
        { x: line.stemX, y: line.stemTopY },
        { x: line.stemX, y: line.connectorY },
        { x: line.connectorToX, y: line.connectorY },
        { x: line.connectorToX, y: line.branchY },
        { x: drop.x, y: line.branchY },
        { x: drop.x, y: drop.bottomY },
    ]);
}

/** The light's dash: a 34 px glow, then a gap longer than the path (`length`). */
export function pulseDash(length: number): { dasharray: string; from: number; to: number } {
    const d = LIVE.pulse.dash;
    return { dasharray: `${d} ${Math.ceil(length + 44)}`, from: d, to: d - (length + d) };
}

/** Whether a line is long enough for the light (a partner's short line is not: only the glow). */
export function lightFits(length: number): boolean {
    return length >= LIVE.pulse.minLine;
}

/**
 * The order the new cards come in: the nearest to the anchor first, +20 ms
 * a card; a partner before the children of the same couple (those +40 ms).
 * Returns each card's delay (ms, before the device's factor). At most
 * `maxAnimatedNew` animate; the rest stand at once (no entry).
 */
export function newCardDelays<T extends { id: string; dist: number; afterPartner: boolean }>(items: readonly T[]): Map<string, number> {
    const sorted = [...items].sort((a, b) => (a.afterPartner === b.afterPartner ? a.dist - b.dist : a.afterPartner ? 1 : -1));
    const out = new Map<string, number>();
    sorted.slice(0, LIVE.maxAnimatedNew).forEach((it, rank) => {
        out.set(it.id, rank * LIVE.stagger + (it.afterPartner ? LIVE.childAfterPartner : 0));
    });
    return out;
}

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * The edge of the tree's area a person out of the view is beyond, and where
 * along it the notch stands (the person's projection, kept `corner` px from
 * the corners). Null when the card is in the view. `card`: the card's box on
 * the screen (container px); `w`, `h`: the area's size.
 */
export function edgeNotchSpot(card: { left: number; top: number; right: number; bottom: number }, w: number, h: number): { side: EdgeSide; at: number } | null {
    const cx = (card.left + card.right) / 2, cy = (card.top + card.bottom) / 2;
    const outLeft = card.right <= 0, outRight = card.left >= w, outTop = card.bottom <= 0, outBottom = card.top >= h;
    if (!outLeft && !outRight && !outTop && !outBottom) return null;
    // The side the person is furthest beyond (relative to the area's size).
    const beyond: Array<[EdgeSide, number]> = [
        ['left', outLeft ? -cx / w : -Infinity], ['right', outRight ? (cx - w) / w : -Infinity],
        ['top', outTop ? -cy / h : -Infinity], ['bottom', outBottom ? (cy - h) / h : -Infinity],
    ];
    beyond.sort((a, b) => b[1] - a[1]);
    const side = beyond[0][0];
    const len = LIVE.edge.length, c = LIVE.edge.corner;
    const along = side === 'left' || side === 'right' ? cy : cx;
    const span = side === 'left' || side === 'right' ? h : w;
    const at = Math.max(c + len / 2, Math.min(span - c - len / 2, along));
    return { side, at };
}

/** The trail dot's strength by its age in the trail (0 = the newest). */
const CARD_TRAIL_OPACITY = [1, 0.86, 0.74, 0.63, 0.54, 0.46, 0.39, 0.33];
export function cardTrailOpacity(index: number): number {
    return CARD_TRAIL_OPACITY[Math.max(0, Math.min(CARD_TRAIL_OPACITY.length - 1, index))];
}
