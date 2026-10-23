/**
 * Children shown in place (the card's children tab): the timing and the
 * geometry of the transition between the view before and after a click
 * (src/renderer.ts runs it with the Web Animations API).
 *
 * - The cards that stay move from where they stood on the screen to their
 *   new places (FLIP); the cards a click brings in grow out of their
 *   parents' stem, the ones a click hides shrink back into it.
 * - The lines are never recomputed per frame: the old drawing fades out as a
 *   ghost while the new one fades in.
 * - On the desktop the view zooms out around the clicked card as far as the
 *   new children need (never below 0.6 × the scale before the click).
 *
 * Pure functions here; no DOM.
 */

import { TABLET_MAX } from './breakpoints.js';

/** The transition's easing (the cards' move and scale, the zoom); opacity runs linearly. */
export const CHILDREN_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * A CSS cubic-bezier timing function as a function of progress (0–1),
 * solved for x by Newton steps with a bisection fallback.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const x = (u: number) => ((ax * u + bx) * u + cx) * u;
    const y = (u: number) => ((ay * u + by) * u + cy) * u;
    const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
    return (t: number): number => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let u = t;
        for (let i = 0; i < 8; i++) {
            const err = x(u) - t;
            if (Math.abs(err) < 1e-6) return y(u);
            const d = dx(u);
            if (Math.abs(d) < 1e-6) break;
            u -= err / d;
        }
        let lo = 0, hi = 1;
        u = t;
        for (let i = 0; i < 40; i++) {
            const v = x(u);
            if (Math.abs(v - t) < 1e-6) break;
            if (v < t) lo = u; else hi = u;
            u = (lo + hi) / 2;
        }
        return y(u);
    };
}

/** CHILDREN_EASE as a function (the zoom of §5 runs frame by frame). */
export const childrenEase = cubicBezier(0.2, 0, 0, 1);

export type ChildrenTransitionDir = 'open' | 'close';

/** A time window within the transition, in ms from its start. */
export type Window = readonly [start: number, end: number];

export interface ChildrenTransitionTiming {
    /** The cards' move and scale, and the zoom. */
    duration: number;
    /** Cards that appear: opacity 0 → 1. */
    fadeIn: Window;
    /** Cards that leave: opacity 1 → 0. */
    fadeOut: Window;
    /** The lines the view had (the ghost): opacity 1 → 0. */
    ghostOut: Window;
    /** The new lines: opacity 0 → 1. */
    linesIn: Window;
    /** At most this many cards move (the nearest to the clicked card); the rest jump. */
    cap: number;
}

/** Desktop timings (ms); a phone or tablet runs them scaled to its shorter duration. */
const DESKTOP: Record<ChildrenTransitionDir, Omit<ChildrenTransitionTiming, 'cap'>> = {
    open: { duration: 320, fadeIn: [0, 160], fadeOut: [0, 160], ghostOut: [0, 80], linesIn: [200, 360] },
    close: { duration: 260, fadeIn: [80, 220], fadeOut: [80, 220], ghostOut: [0, 60], linesIn: [140, 280] },
};
const COMPACT_DURATION: Record<ChildrenTransitionDir, number> = { open: 280, close: 220 };
const DESKTOP_CAP = 200;
const COMPACT_CAP = 80;

/**
 * The timing of a transition. `compact`: a phone or tablet (width ≤ 1024 or
 * a coarse pointer) — shorter, every window scaled with it, fewer cards.
 */
export function childrenTransitionTiming(dir: ChildrenTransitionDir, compact: boolean): ChildrenTransitionTiming {
    const base = DESKTOP[dir];
    if (!compact) return { ...base, cap: DESKTOP_CAP };
    const k = COMPACT_DURATION[dir] / base.duration;
    const scale = (w: Window): Window => [Math.round(w[0] * k), Math.round(w[1] * k)];
    return {
        duration: COMPACT_DURATION[dir],
        fadeIn: scale(base.fadeIn), fadeOut: scale(base.fadeOut),
        ghostOut: scale(base.ghostOut), linesIn: scale(base.linesIn),
        cap: COMPACT_CAP,
    };
}

/** A phone or tablet for the transition: width ≤ 1024 or a coarse pointer. */
export function isCompactMotion(width: number, coarsePointer: boolean): boolean {
    return width <= TABLET_MAX || coarsePointer;
}

/** The scale a card grows from (and shrinks into) at its parents' stem. */
export const STEM_SCALE = 0.6;
const STAGGER_MS = 20;
const STAGGER_MAX_MS = 120;
/** More new cards than this: they all start at once. */
const STAGGER_MAX_CARDS = 12;

/**
 * The start delay of the `rank`-th new card (0 = nearest to the stem) when
 * `count` new cards come in: +20 ms a card, at most +120 ms; none with more
 * than twelve.
 */
export function staggerDelay(rank: number, count: number): number {
    if (count > STAGGER_MAX_CARDS) return 0;
    return Math.min(rank * STAGGER_MS, STAGGER_MAX_MS);
}

export interface Rect { left: number; top: number; right: number; bottom: number }

/** Whether two rectangles overlap (touching edges do not). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Of the candidates, those that animate: on screen (their old or new place
 * within the view widened by half its size each side, `near`), at most
 * `cap` of them, the nearest to the clicked card first.
 */
export function pickAnimated<T extends { dist: number; near: boolean }>(items: readonly T[], cap: number): Set<T> {
    return new Set(items.filter(i => i.near).sort((a, b) => a.dist - b.dist).slice(0, cap));
}

/** The view widened by half its width and height on each side. */
export function widenedView(width: number, height: number): Rect {
    return { left: -width / 2, top: -height / 2, right: width * 1.5, bottom: height * 1.5 };
}

/** The lowest the zoom of §5 goes: this share of the scale before the click. */
export const ZOOM_OUT_FLOOR = 0.6;

export interface ZoomOutInput {
    /** The scale before the click. */
    scale: number;
    /** The zoom's hard floor (ZoomPan's MIN_SCALE). */
    minScale: number;
    /** The clicked card's centre: on the screen (container px) and in the world. */
    pivotScreen: { x: number; y: number };
    pivotWorld: { x: number; y: number };
    /** The new children's bounding box in the world. */
    target: Rect;
    /** Where the cards may stand on the screen (the tree's area less the 24 px margin). */
    area: Rect;
    /** Controls over the tree (zoom block, minimap, back / forward), on the screen with the margin. */
    avoid: readonly Rect[];
}

/** The target's box on the screen at scale `s`, zoomed around the pivot. */
export function screenRectAt(input: ZoomOutInput, s: number): Rect {
    const { pivotScreen: p, pivotWorld: w, target: t } = input;
    return {
        left: p.x + (t.left - w.x) * s, right: p.x + (t.right - w.x) * s,
        top: p.y + (t.top - w.y) * s, bottom: p.y + (t.bottom - w.y) * s,
    };
}

/** The largest scale ≤ `scale` at which the target, zoomed around the pivot, stays within `area` (bounds it cannot meet are left out). */
function fitScale(input: ZoomOutInput, area: Rect): number {
    const { pivotScreen: p, pivotWorld: w, target: t } = input;
    let s = input.scale;
    const bound = (room: number, reach: number) => {
        if (reach > 0 && room > 0) s = Math.min(s, room / reach);
        else if (reach > 0) s = 0;
    };
    bound(p.x - area.left, w.x - t.left);
    bound(area.right - p.x, t.right - w.x);
    bound(p.y - area.top, w.y - t.top);
    bound(area.bottom - p.y, t.bottom - w.y);
    return s;
}

/**
 * The scale of §5: the scale before the click when the new children are on
 * screen already; else the largest smaller one at which they fit the area
 * and stay clear of the controls, zoomed around the clicked card, but never
 * below ZOOM_OUT_FLOOR × the scale before or minScale (what does not fit
 * even then stays off screen).
 */
export function zoomOutScale(input: ZoomOutInput): number {
    const floor = Math.min(input.scale, Math.max(ZOOM_OUT_FLOOR * input.scale, input.minScale));
    const clear = (s: number) => !input.avoid.some(r => rectsOverlap(screenRectAt(input, s), r));
    const areas: Rect[] = [input.area];
    for (const r of input.avoid) {
        areas.push({ ...input.area, right: Math.min(input.area.right, r.left) });
        areas.push({ ...input.area, bottom: Math.min(input.area.bottom, r.top) });
    }
    const fits = areas.map(a => fitScale(input, a));
    const ok = fits.filter(clear);
    const s = ok.length ? Math.max(...ok) : Math.min(...fits);
    return Math.max(floor, Math.min(input.scale, s));
}
