/**
 * Where a jump to cards drawn elsewhere in the view lands: a line link's
 * other end ("child ↗", "children ↗", "parents ↗") and a child drawn
 * elsewhere (§4 "Already in the tree elsewhere"). The target lands at a
 * readable scale: a jump never leaves the cards as specks, however far out
 * the view was or however far apart the targets stand.
 *
 * - One card: centred, at the current scale or the readable one when the
 *   view is further out.
 * - Several cards: nothing moves when all of them are on screen already at
 *   a readable scale; else centred on all of them, zoomed out as far as they
 *   need but never below the scale at which cards are still read together
 *   (a little below the one-card scale, so a couple of parents fits a
 *   phone). When they do not fit even then, the view goes to the target
 *   nearest to the view's centre at the one-card scale (the others are
 *   highlighted by the caller).
 *
 * Pure function here; no DOM.
 */

import type { Rect } from './children-transition.js';

export interface JumpViewInput {
    /** The current transform (container px = world px × scale + t). */
    scale: number;
    tx: number;
    ty: number;
    /** The tree container's size (px). */
    view: { width: number; height: number };
    /** The target cards' boxes in the world. */
    targets: readonly Rect[];
    /** The lowest scale a jump to one card lands on (cards readable). */
    minScale: number;
    /** The lowest scale several cards are shown together at (<= minScale). */
    togetherMinScale: number;
    /** The highest scale (ZoomPan's MAX_SCALE). */
    maxScale: number;
    /** Margin around the targets on the screen (px). */
    padding: number;
}

export interface JumpViewPlan {
    scale: number;
    /** The world point that lands in the middle of the view. */
    centerX: number;
    centerY: number;
    /** The index of the one target the view went to (the targets did not fit together), or null. */
    only: number | null;
}

const width = (r: Rect) => r.right - r.left;
const height = (r: Rect) => r.bottom - r.top;

/** The largest scale at which the box fits the view within the padding. */
function fitScale(box: Rect, view: { width: number; height: number }, padding: number): number {
    const w = Math.max(width(box), 1), h = Math.max(height(box), 1);
    return Math.min((view.width - 2 * padding) / w, (view.height - 2 * padding) / h);
}

/**
 * The view after a jump to `targets`, or null when the view stays (no
 * target, or several all on screen already at a readable scale).
 */
export function jumpView(input: JumpViewInput): JumpViewPlan | null {
    const { targets, view, padding, minScale, maxScale } = input;
    const togetherMin = Math.min(minScale, input.togetherMinScale);
    if (targets.length === 0 || view.width <= 0 || view.height <= 0) return null;
    const box: Rect = {
        left: Math.min(...targets.map(t => t.left)), top: Math.min(...targets.map(t => t.top)),
        right: Math.max(...targets.map(t => t.right)), bottom: Math.max(...targets.map(t => t.bottom)),
    };
    const { scale, tx, ty } = input;
    if (targets.length > 1 && scale >= togetherMin) {
        const onScreen = box.left * scale + tx >= padding && box.right * scale + tx <= view.width - padding
            && box.top * scale + ty >= padding && box.bottom * scale + ty <= view.height - padding;
        if (onScreen) return null;
    }
    // Never further out than readable; never further in than the view was (unless it was too far out)
    const base = Math.min(maxScale, Math.max(scale, minScale));
    const together = Math.min(base, fitScale(box, view, padding));
    if (targets.length === 1 || together >= togetherMin) {
        return { scale: together, centerX: (box.left + box.right) / 2, centerY: (box.top + box.bottom) / 2, only: targets.length === 1 ? 0 : null };
    }
    // Too far apart to read together: the target nearest to the view's centre
    const cx = (view.width / 2 - tx) / scale, cy = (view.height / 2 - ty) / scale;
    let only = 0, best = Infinity;
    targets.forEach((t, i) => {
        const d = Math.hypot((t.left + t.right) / 2 - cx, (t.top + t.bottom) / 2 - cy);
        if (d < best) { best = d; only = i; }
    });
    const t = targets[only];
    return { scale: Math.min(base, fitScale(t, view, padding)), centerX: (t.left + t.right) / 2, centerY: (t.top + t.bottom) / 2, only };
}
