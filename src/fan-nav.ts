/**
 * Keyboard navigation between the sectors of a fan (spec 029 §1.7): the
 * nodes a key can reach and where an arrow leads from one of them.
 *
 * Levels run from the outermost descendant ring through the focus (0) to the
 * outermost ancestor ring: an ancestor's level is its generation, a partner
 * band of depth d is −(2d − 1) and the descendants of depth d are −2d.
 * ↑ goes to a parent (outwards on the ancestor side, towards the focus on
 * the descendant side), ↓ to a child, ←/→ along the ring in the order the
 * eye reads it (wrapping round only in the full circle).
 */

import type { FanModel } from './fan-chart.js';

export interface FanNavNode {
    /** The sector's `data-fan-key` ('f' for the focus disc). */
    key: string;
    level: number;
    /** Angles (math degrees, lo < hi); the focus covers everything. */
    lo: number;
    hi: number;
}

export type FanNavDir = 'left' | 'right' | 'up' | 'down';

/** Every sector a key can reach: people, and empty slots while editing (the unknown partner is skipped). */
export function fanNavNodes(model: FanModel, editable: boolean): FanNavNode[] {
    const nodes: FanNavNode[] = [{ key: 'f', level: 0, lo: -Infinity, hi: Infinity }];
    for (const s of model.sectors) {
        if (!s.person && !editable) continue;
        nodes.push({ key: s.key, level: s.generation, lo: s.lo, hi: s.hi });
    }
    for (const s of model.desc) {
        if (!s.person) continue;
        nodes.push({ key: s.key, level: s.kind === 'partner' ? -(2 * s.depth - 1) : -2 * s.depth, lo: s.lo, hi: s.hi });
    }
    return nodes;
}

const mid = (n: FanNavNode) => (n.lo + n.hi) / 2;

/** One level's nodes in reading order: ancestors from the left (falling angle), descendants from the left (rising angle). */
function ring(nodes: FanNavNode[], level: number): FanNavNode[] {
    const row = nodes.filter(n => n.level === level);
    return level > 0 ? row.sort((a, b) => mid(b) - mid(a)) : row.sort((a, b) => mid(a) - mid(b));
}

/**
 * The key an arrow leads to from `fromKey` (null: nowhere). `wrap`: the
 * ancestor rings close into a circle (the full shape).
 */
export function fanNavMove(nodes: FanNavNode[], fromKey: string, dir: FanNavDir, wrap = false): string | null {
    const from = nodes.find(n => n.key === fromKey);
    if (!from) return null;
    if (dir === 'left' || dir === 'right') {
        if (from.level === 0) return null;
        const row = ring(nodes, from.level);
        const i = row.indexOf(from);
        let j = i + (dir === 'right' ? 1 : -1);
        if (j < 0 || j >= row.length) {
            if (!(wrap && from.level > 0) || row.length < 2) return null;
            j = (j + row.length) % row.length;
        }
        return row[j].key;
    }
    // Up = towards the parents: a higher level on both sides of the focus.
    const step = dir === 'up' ? 1 : -1;
    const levels = [...new Set(nodes.map(n => n.level))];
    const targets = levels.filter(l => (step > 0 ? l > from.level : l < from.level))
        .sort((a, b) => (a - b) * step);
    for (const level of targets) {
        const row = ring(nodes, level);
        if (row.length === 0) continue;
        if (from.level === 0) return row[0].key;
        const m = mid(from);
        const inside = row.find(n => n.lo <= m && m <= n.hi);
        if (inside) return inside.key;
        const overlap = row
            .map(n => ({ n, o: Math.min(n.hi, from.hi) - Math.max(n.lo, from.lo) }))
            .filter(x => x.o > 0)
            .sort((a, b) => b.o - a.o)[0];
        if (overlap) return overlap.n.key;
        // Nothing over this sector in that ring: the next one further on may have it (the focus covers all).
    }
    return null;
}
