/**
 * "Hide others" of the window's selection (spec 098 §8, PipelineInput.personFilter).
 *
 * The filter works on the persons collected for the layout, never on the
 * cards of a finished one:
 *
 * 1. The view without the filter decides who could be drawn (its focus,
 *    depths and in-place expansions): the persons steps 1 to 5 place, with
 *    their generation and their order (drawnOrder in index.ts). Only those
 *    of the filter are kept, the focus always: never more cards than the
 *    whole view draws.
 * 2. The kept persons are laid out as the focus's own tree (the selection
 *    restricted to them: restrictSelection). Lines join only persons both
 *    drawn; a family whose other parent is left out hangs below the parent
 *    drawn (a single parent).
 * 3. A kept person that layout does not reach (no line to the focus's
 *    people) is laid out in a group of its own around the topmost of those
 *    left, again and again until everyone kept is drawn.
 * 4. The groups stand side by side (mergeGroups): each group in the rows of
 *    its generations, the groups in the order the whole view gives their
 *    first persons, left or right of the focus's group, a clear gap between
 *    them. Every group keeps its own layout; a common band height per
 *    generation (the tallest card of any group, the widest gap) moves each
 *    group's lines monotonically, so its lines stay straight and free of
 *    crossings, and no line of one group comes near another's.
 */

import { LayoutConfig, PersonId, Position } from '../../types.js';
import { Connection, GenerationBand, GraphSelection, LayoutResult, PartnerChain, SpouseLine } from './types.js';

/** Keep only `keep` in a selection (and the partnerships of two kept partners). */
export function restrictSelection(selection: GraphSelection, keep: ReadonlySet<PersonId>, data: { partnerships: Record<string, { person1Id: PersonId; person2Id: PersonId } | undefined> }): void {
    for (const id of [...selection.persons]) if (!keep.has(id)) selection.persons.delete(id);
    for (const pid of [...selection.partnerships]) {
        const u = data.partnerships[pid];
        if (!u || !selection.persons.has(u.person1Id) || !selection.persons.has(u.person2Id)) selection.partnerships.delete(pid);
    }
    const prune = (set: Set<PersonId> | undefined): void => {
        if (set) for (const id of [...set]) if (!keep.has(id)) set.delete(id);
    };
    prune(selection.depthLimitPersons);
    prune(selection.ancestorLimitPersons);
}

/** A person's place in the whole view: its generation (from the focus) and its X there. */
export interface FilterOrder {
    gen: number;
    x: number;
}

/** One group laid out on its own: the layout and the person it was laid out around. */
export interface FilterGroup {
    result: LayoutResult;
    rep: PersonId;
}

/** The persons the filter keeps of the whole view's: those of the filter, the focus always. */
export function keptPersons(order: ReadonlyMap<PersonId, FilterOrder>, filter: ReadonlySet<PersonId>, focusId: PersonId): Set<PersonId> {
    const keep = new Set<PersonId>();
    if (order.has(focusId)) keep.add(focusId);
    for (const id of order.keys()) if (filter.has(id)) keep.add(id);
    return keep;
}

/** The persons left in the order a group is laid out around them: the topmost first, then from the left. */
export function nextRepresentative(rest: readonly PersonId[], order: ReadonlyMap<PersonId, FilterOrder>): PersonId {
    let best = rest[0];
    for (const id of rest) {
        const a = order.get(id), b = order.get(best);
        if (!a || !b) continue;
        if (a.gen < b.gen || (a.gen === b.gen && a.x < b.x)) best = id;
    }
    return best;
}

/** The X extent of a group's cards and lines. */
function extentOf(r: LayoutResult, config: LayoutConfig): { left: number; right: number } {
    let left = Infinity, right = -Infinity;
    const take = (x: number): void => { if (x < left) left = x; if (x > right) right = x; };
    for (const p of r.positions.values()) { take(p.x); take(p.x + config.cardWidth); }
    for (const c of r.connections) {
        take(c.stemX); take(c.branchLeftX); take(c.branchRightX); take(c.connectorFromX); take(c.connectorToX);
        for (const d of c.drops) take(d.x);
    }
    for (const s of r.spouseLines) { take(s.xMin); take(s.xMax); }
    return { left, right };
}

/** A group's own bands by generation, counted in the whole view's generations. */
function groupBands(r: LayoutResult, offset: number): { gen: number; top: number; height: number; extra: number }[] {
    return (r.bands ?? []).map((b: GenerationBand) => ({
        gen: b.generation + offset, top: b.top, height: b.height, extra: r.gapExtra?.get(b.generation) ?? 0,
    })).sort((a, b) => a.gen - b.gen);
}

/**
 * The groups side by side in one layout (see the module comment). `order`:
 * the whole view's generations and order; the first group is the focus's.
 */
export function mergeGroups(groups: readonly FilterGroup[], order: ReadonlyMap<PersonId, FilterOrder>, config: LayoutConfig): LayoutResult {
    const main = groups[0];
    const offsetOf = (g: FilterGroup): number => (g === main ? 0 : order.get(g.rep)?.gen ?? 0);

    // The common bands: per generation the tallest band and the widest gap below it
    const height = new Map<number, number>();
    const extra = new Map<number, number>();
    let minGen = Infinity, maxGen = -Infinity;
    const own = new Map<FilterGroup, ReturnType<typeof groupBands>>();
    for (const g of groups) {
        const bands = groupBands(g.result, offsetOf(g));
        own.set(g, bands);
        for (const b of bands) {
            height.set(b.gen, Math.max(height.get(b.gen) ?? 0, b.height));
            if (b.extra > 0) extra.set(b.gen, Math.max(extra.get(b.gen) ?? 0, b.extra));
            minGen = Math.min(minGen, b.gen);
            maxGen = Math.max(maxGen, b.gen);
        }
    }
    const top = new Map<number, number>();
    const bands: GenerationBand[] = [];
    let y = config.padding;
    for (let gen = minGen; gen <= maxGen; gen++) {
        const h = height.get(gen) ?? config.cardHeight;
        top.set(gen, y);
        bands.push({ generation: gen, top: y, height: h });
        y += h + config.verticalGap + (extra.get(gen) ?? 0);
    }

    /** A group's Y in the common bands: in a band from its top, in a gap from the gap's middle (monotone). */
    const mapY = (g: FilterGroup) => {
        const list = own.get(g)!;
        return (v: number): number => {
            if (list.length === 0) return v;
            let i = 0;
            while (i + 1 < list.length && list[i + 1].top <= v + 0.01) i++;
            const b = list[i];
            const T = top.get(b.gen)!;
            if (v <= b.top + b.height + 0.01 || i === list.length - 1) return T + (v - b.top);
            const midOwn = b.top + b.height + (config.verticalGap + b.extra) / 2;
            const midAll = T + height.get(b.gen)! + (config.verticalGap + (extra.get(b.gen) ?? 0)) / 2;
            return midAll + (v - midOwn);
        };
    };

    // The order: by the whole view's X of each group's first person, left or right of the focus's group
    const keyOf = (g: FilterGroup): number => order.get(g.rep)?.x ?? 0;
    const mainKey = keyOf(main);
    const others = groups.slice(1);
    const left = others.filter(g => keyOf(g) < mainKey).sort((a, b) => keyOf(b) - keyOf(a));
    const right = others.filter(g => keyOf(g) >= mainKey).sort((a, b) => keyOf(a) - keyOf(b));
    const gap = 2 * config.horizontalGap + config.cardWidth / 2;
    const dx = new Map<FilterGroup, number>([[main, 0]]);
    const mainExt = extentOf(main.result, config);
    let edge = mainExt.left;
    for (const g of left) {
        const e = extentOf(g.result, config);
        const shift = edge - gap - e.right;
        dx.set(g, shift);
        edge = e.left + shift;
    }
    edge = mainExt.right;
    for (const g of right) {
        const e = extentOf(g.result, config);
        const shift = edge + gap - e.left;
        dx.set(g, shift);
        edge = e.right + shift;
    }

    const positions = new Map<PersonId, Position>();
    const connections: Connection[] = [];
    const spouseLines: SpouseLine[] = [];
    const partnerChains = new Map<PersonId, PartnerChain>();
    const omittedEdges: NonNullable<LayoutResult['omittedEdges']> = [];
    const innerSiblingRuns: NonNullable<LayoutResult['innerSiblingRuns']> = [];
    let totalPersons = 0, totalUnions = 0, iterations = 0;
    for (const g of groups) {
        const r = g.result;
        const sx = dx.get(g) ?? 0;
        const my = mapY(g);
        for (const [id, p] of r.positions) positions.set(id, { x: p.x + sx, y: my(p.y) });
        for (const c of r.connections) {
            connections.push({
                ...c,
                stemX: c.stemX + sx, stemTopY: my(c.stemTopY), stemBottomY: my(c.stemBottomY), branchY: my(c.branchY),
                branchLeftX: c.branchLeftX + sx, branchRightX: c.branchRightX + sx,
                connectorFromX: c.connectorFromX + sx, connectorToX: c.connectorToX + sx, connectorY: my(c.connectorY),
                drops: c.drops.map(d => ({ ...d, x: d.x + sx, topY: my(d.topY), bottomY: my(d.bottomY) })),
            });
        }
        for (const s of r.spouseLines) spouseLines.push({ ...s, y: my(s.y), xMin: s.xMin + sx, xMax: s.xMax + sx });
        for (const [id, chain] of r.partnerChains ?? []) partnerChains.set(id, { ...chain, sharedPersonCenterX: chain.sharedPersonCenterX + sx });
        if (r.omittedEdges) omittedEdges.push(...r.omittedEdges);
        if (r.innerSiblingRuns) innerSiblingRuns.push(...r.innerSiblingRuns);
        totalPersons += r.diagnostics.totalPersons;
        totalUnions += r.diagnostics.totalUnions;
        iterations = Math.max(iterations, r.diagnostics.iterations);
    }

    // Normalized as every layout: the leftmost card at the padding
    let minX = Infinity;
    for (const p of positions.values()) minX = Math.min(minX, p.x);
    const shift = isFinite(minX) ? config.padding - minX : 0;
    if (Math.abs(shift) >= 0.1) {
        for (const [id, p] of positions) positions.set(id, { x: p.x + shift, y: p.y });
        for (const c of connections) {
            c.stemX += shift; c.branchLeftX += shift; c.branchRightX += shift; c.connectorFromX += shift; c.connectorToX += shift;
            for (const d of c.drops) d.x += shift;
        }
        for (const s of spouseLines) { s.xMin += shift; s.xMax += shift; }
        for (const [id, chain] of partnerChains) partnerChains.set(id, { ...chain, sharedPersonCenterX: chain.sharedPersonCenterX + shift });
    }

    const m = main.result;
    return {
        positions,
        connections,
        spouseLines,
        diagnostics: {
            ...m.diagnostics,
            totalPersons, totalUnions, iterations,
            generationRange: [minGen, maxGen],
            validationPassed: true,
            errors: [],
        },
        ...(partnerChains.size > 0 ? { partnerChains } : {}),
        bands,
        ...(extra.size > 0 ? { gapExtra: extra } : {}),
        ...(m.viewLayer ? { viewLayer: m.viewLayer } : {}),
        ...(omittedEdges.length > 0 ? { omittedEdges } : {}),
        ...(innerSiblingRuns.length > 0 ? { innerSiblingRuns } : {}),
        ...(m.ancestorDepthEdge ? { ancestorDepthEdge: m.ancestorDepthEdge } : {}),
        ...(m.extraDepthDrawn ? { extraDepthDrawn: m.extraDepthDrawn } : {}),
    };
}
