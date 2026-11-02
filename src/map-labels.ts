/**
 * Which place names the map can show without one covering another.
 *
 * Nearby points (a village and its neighbour) put their names over each
 * other's dots. The names are kept by weight (most people first, then the
 * order given); a name that would cover a kept name or another point's dot
 * or check mark is left out — the point keeps its dot, its name is one hover
 * or tap away.
 */

export interface LabelBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface MapLabelCandidate {
    /** The name's box; an empty box (a hidden name) is never kept. */
    label: LabelBox;
    /** The point's own dot, check mark and houses tag: they never hide its name. */
    own: readonly LabelBox[];
    /** People at the point: the heavier point keeps its name first. */
    weight: number;
}

const overlaps = (a: LabelBox, b: LabelBox, gap: number): boolean =>
    a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;

const isEmpty = (b: LabelBox): boolean => b.right - b.left <= 0 || b.bottom - b.top <= 0;

/**
 * For each candidate: whether its name stays shown. `gap` keeps a little air
 * between a name and what it would touch.
 */
export function pickMapLabels(candidates: readonly MapLabelCandidate[], gap = 1): boolean[] {
    const keep = new Array<boolean>(candidates.length).fill(false);
    const order = candidates.map((_, i) => i)
        .sort((a, b) => candidates[b].weight - candidates[a].weight || a - b);
    const kept: LabelBox[] = [];
    for (const i of order) {
        const c = candidates[i];
        if (isEmpty(c.label)) continue;
        if (kept.some(k => overlaps(c.label, k, gap))) continue;
        const coversPoint = candidates.some((o, j) => j !== i && o.own.some(b => !isEmpty(b) && overlaps(c.label, b, 0)));
        if (coversPoint) continue;
        keep[i] = true;
        kept.push(c.label);
    }
    return keep;
}
