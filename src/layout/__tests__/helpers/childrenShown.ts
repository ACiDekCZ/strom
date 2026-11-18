/**
 * Shared by the children-shown-in-place harness files (childrenShownFull,
 * childrenShownTwoClicks, siblingsShownFull): the fixtures, modes and depths,
 * the layout calls and the measures their checks use. One file per heavy
 * sweep, so the sweeps run side by side instead of one after another.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { runLayoutPipeline, planShownChildrenFolding } from '../../pipeline/index.js';
import { PersonId, LayoutConfig, StromData } from '../../../types.js';
import type { PipelineInput } from '../../pipeline/types.js';

export const DEPTHS = [2, 4, 8];

export const MODES = [
    { name: 'standard', heights: false, autoExpand: false },
    { name: 'expanded', heights: false, autoExpand: true },
    { name: 'standard-v3', heights: true, autoExpand: false },
    { name: 'expanded-v3', heights: true, autoExpand: true },
];


export const FIXTURES = readdirSync(join(process.cwd(), 'test'))
    .filter(n => /^(comprehensive|edge-.*|etalon-.*|real-large)\.json$/.test(n))
    .map(n => n.replace(/\.json$/, ''))
    .filter(f => existsSync(join(process.cwd(), 'test', `${f}.json`)))
    .sort();

export function layout(data: StromData, focus: PersonId, config: LayoutConfig, depth: number, autoExpand: boolean, shown: PersonId[] = []) {
    return runLayoutPipeline({
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        ...(shown.length ? { expandChildrenOf: shown } : {}),
    });
}

/** As layout(), with the ancestors folded that the shown children call for (planShownChildrenFolding). */
export function plan(data: StromData, focus: PersonId, config: LayoutConfig, depth: number, autoExpand: boolean, shown: PersonId[] = [], extra: Partial<PipelineInput> = {}) {
    return planShownChildrenFolding({
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        ...(shown.length ? { expandChildrenOf: shown } : {}),
        ...extra,
    });
}

/**
 * Cards standing between the children of one of the person's unions in their
 * row that are neither such a child nor a child's partner: the children were
 * not shown together (invariant 5).
 */
export function foreignBetweenChildren(data: StromData, pid: PersonId, positions: Map<PersonId, { x: number; y: number }>): string[] {
    const out: string[] = [];
    for (const uid of data.persons[pid]?.partnerships ?? []) {
        const kids = (data.partnerships[uid]?.childIds ?? []).filter(c => positions.has(c));
        if (kids.length < 2) continue;
        const own = new Set<PersonId>(kids);
        for (const k of kids) for (const ku of data.persons[k]?.partnerships ?? []) {
            const u = data.partnerships[ku];
            if (u) { own.add(u.person1Id); own.add(u.person2Id); }
        }
        const y = positions.get(kids[0])!.y;
        if (kids.some(k => Math.abs(positions.get(k)!.y - y) > 1)) continue;
        const xs = kids.map(k => positions.get(k)!.x);
        const lo = Math.min(...xs), hi = Math.max(...xs);
        for (const [id, p] of positions) {
            if (own.has(id) || Math.abs(p.y - y) > 1) continue;
            if (p.x > lo && p.x < hi) out.push(`${id} between the children of ${uid}`);
        }
    }
    return out;
}

/**
 * Stem of the person's union lines to the nearest edge of the children's span
 * (0: the stem is over the children), as stemGapPastFamily measures it.
 */
export function stemToSpan(data: StromData, r: { positions: Map<PersonId, { x: number }>; connections: { stemX: number; drops: { personId: PersonId }[] }[] }, pid: PersonId, cw: number): number {
    let best = 0;
    for (const c of r.connections) {
        const kids = c.drops.map(d => d.personId).filter(id => r.positions.has(id));
        if (!kids.some(id => data.persons[id]?.parentIds.includes(pid))) continue;
        best = Math.max(best, stemGapPastFamily(data, r.positions, pid, kids, c.stemX, cw));
    }
    return best;
}

/**
 * How far a union's stem stands from its children (`kids`, drawn): to the
 * nearest edge of their span, 0 over it. The person's other children stand
 * together under their parents (invariant 5), each family with its partners
 * and descendants as one piece (invariant 4), and a child's partner may stand
 * on the inner side (a couple's order follows gender, invariant 3): when such
 * cards stand between the stem and the children, their width is not the
 * stem's distance — what counts is the stem's distance to them plus theirs to
 * the children (the line passes over that family, which cannot stand
 * elsewhere). `own`: the children not counted as such a family (default:
 * the union's own).
 */
export function stemGapPastFamily(data: StromData, positions: Map<PersonId, { x: number }>, pid: PersonId, kids: PersonId[], stemX: number, cw: number,
    own: PersonId[] = kids): number {
    const xs = kids.map(k => positions.get(k)!.x);
    const lo = Math.min(...xs), hi = Math.max(...xs) + cw;
    let gap = stemX < lo ? lo - stemX : stemX > hi ? stemX - hi : 0;
    if (gap === 0) return 0;
    const fam = new Set<PersonId>();
    const todo = (data.persons[pid].childIds as PersonId[]).filter(k => !own.includes(k));
    while (todo.length) {
        const k = todo.pop()!;
        if (fam.has(k)) continue;
        fam.add(k);
        todo.push(...(data.persons[k]?.childIds ?? []));
    }
    for (const k of [...fam, ...own]) for (const u of data.persons[k]?.partnerships ?? []) {
        const pp = data.partnerships[u];
        if (pp) for (const q of [pp.person1Id, pp.person2Id]) if (!own.includes(q)) fam.add(q);
    }
    const left = stemX < lo;
    const between = [...fam].map(id => positions.get(id)).filter((p): p is { x: number } => !!p)
        .filter(p => left ? p.x + cw > stemX && p.x + cw <= lo + 1 : p.x < stemX && p.x >= hi - 1);
    if (between.length > 0) {
        const near = left ? Math.min(...between.map(p => p.x)) : Math.max(...between.map(p => p.x + cw));
        const far = left ? Math.max(...between.map(p => p.x + cw)) : Math.min(...between.map(p => p.x));
        gap = Math.max(0, left ? near - stemX : stemX - near) + (left ? lo - far : far - hi);
    }
    return gap;
}
