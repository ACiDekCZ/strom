/**
 * Cards clear of the floating pills (the highlight pill of a group or a
 * family line, the follow pill): the smallest vertical pan of the tree after
 * which no card lies under a pill, the card to keep (the one just centred)
 * still in the view. Screen coordinates. Pure.
 */

export interface ClearRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Room between a pill and a card (px). */
export const PILL_CLEARANCE = 8;

function overlapsX(a: ClearRect, b: ClearRect): boolean {
    return a.right > b.left && a.left < b.right;
}

function overlapsY(a: ClearRect, b: ClearRect, dy: number): boolean {
    return a.bottom + dy > b.top && a.top + dy < b.bottom;
}

/**
 * The vertical shift (px, + down) that keeps every card off the pills: 0 when
 * none is under one; null when no shift up to `maxShift` does it (the view
 * stays as it is). `view`: the tree's visible band, where the kept card stays
 * whole and off the pills.
 */
export function pillClearShift(
    cards: readonly ClearRect[],
    pills: readonly ClearRect[],
    view: { top: number; bottom: number },
    opts: { keep?: ClearRect | null; maxShift: number; margin?: number },
): number | null {
    const m = opts.margin ?? PILL_CLEARANCE;
    const zones = pills.filter(p => p.right > p.left && p.bottom > p.top)
        .map(p => ({ left: p.left - m, top: p.top - m, right: p.right + m, bottom: p.bottom + m }));
    if (!zones.length) return 0;
    // Only cards beside a pill (in its columns) and near enough to reach it.
    const near = cards.filter(c => zones.some(z => overlapsX(c, z)
        && c.bottom > z.top - opts.maxShift && c.top < z.bottom + opts.maxShift));
    const ok = (dy: number): boolean => {
        for (const z of zones) {
            for (const c of near) if (overlapsX(c, z) && overlapsY(c, z, dy)) return false;
        }
        const k = opts.keep;
        if (k && (k.top + dy < view.top || k.bottom + dy > view.bottom)) return false;
        return true;
    };
    if (ok(0)) return 0;
    const candidates = new Set<number>();
    for (const z of zones) {
        for (const c of near) {
            if (!overlapsX(c, z)) continue;
            candidates.add(z.bottom - c.top);
            candidates.add(z.top - c.bottom);
        }
    }
    const sorted = [...candidates].filter(dy => dy !== 0 && Math.abs(dy) <= opts.maxShift)
        .sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
    for (const dy of sorted) if (ok(dy)) return dy;
    return null;
}
