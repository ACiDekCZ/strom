/**
 * Fan chart in family-line colours (spec 114 §1, §3, §10): which side of the
 * fan each family line (rod) belongs to, and which palette slot it gets.
 *
 * - Group: the centre's line is the father's side (P); a line seen only among
 *   the descendants and their partners is D; any other the side where it is
 *   nearest to the centre (lowest ring; a tie goes to the father's side).
 * - Every line in the fan has a colour (K1.7): ranked by count (the centre
 *   counted), then the size in the tree, then the id. The first 10 with 2+
 *   sectors strong, the others muted; the centre's line always strong and on
 *   PS0. Grey only for people without a line, unknown people and empty places.
 * - When a group's shades run out they repeat, never on two lines that are
 *   neighbours (sectors sharing an edge) or near (one sector between).
 * - Memory (§3): a line keeps the slot it had in the previous state of the
 *   window (re-centring, rings, shape) unless a neighbour already holds it; a
 *   line gone from the fan frees it.
 * - Distinctness wins over logic: a slot too close to a neighbouring line's
 *   colour is skipped while a better one is free.
 *
 * The strong part mirrors the reference implementation the design was drawn
 * with (fancolor.py); a test compares the lines of 2+ sectors on its sample.
 */

import type { Person, PersonId } from './types.js';
import { LineageIndex, RodId, rodOf, rodLabels } from './lineage.js';
import {
    FanRodGroup, FanRodTier, FanRodSlot, FanTheme, FanLegendItem, FAN_ROD_GROUPS, FAN_ROD_SLOTS, FAN_PALETTES,
    fanRodSlotColor, deltaE, deltaEDeutan, parseFanRodSlot,
} from './fan-colors.js';

/** At most this many strong lines (besides the centre's). */
export const FAN_ROD_MAX_STRONG = 10;
/** The legend's rows before "Other", the collapsible group of the smaller lines (§4). */
export const FAN_ROD_LEGEND_MAIN = 20;
/** Smallest ΔE OK between neighbouring lines (light, dark) and with deuteranopia (both themes). */
const MIN_DE = { light: 0.04, dark: 0.03 } as const;
const MIN_DE_DEUTAN = 0.02;
/** The groups a group borrows from, nearest band first. */
const BORROW_FROM: Record<FanRodGroup, readonly FanRodGroup[]> = { P: ['D', 'M'], M: ['D', 'P'], D: ['M', 'P'] };
const CENTRE_SLOT: FanRodSlot = 'PS0';
const FAR = 99;

/** A family line in the fan. */
export interface FanRodInfo {
    id: RodId;
    /** Sectors of its people (the centre counted; a repeated person each time). */
    count: number;
    group: FanRodGroup;
    /** Real members in the whole tree (the tie-break of equal counts). */
    tree: number;
    /** The centre person's line. */
    focus: boolean;
    /** Seen on both the father's and the mother's side. */
    both: boolean;
    /** Lowest ring on the father's / the mother's side (99: none). */
    nearest: { P: number; M: number };
    /** Place among the lines (0 = most sectors). */
    rank?: number;
    tier?: FanRodTier;
    slot?: FanRodSlot;
    /** The slot came from the memory. */
    kept?: boolean;
    /** The slot is another group's (distinctness, or the group's slots used up). */
    borrowed?: boolean;
    /** The slot is held by another line too, far enough away (the shades ran out). */
    shared?: boolean;
    /** The slot is of the group's other tier. */
    down?: boolean;
}

/** The family lines of one drawn fan and their slots. */
export interface FanRodAssignment {
    /** The family lines the slots belong to (fills look a person's line up here). */
    index: LineageIndex;
    slotOf: ReadonlyMap<RodId, FanRodSlot>;
    /** Every line in the fan, in the order of their rank. */
    rods: FanRodInfo[];
    /** Drawn people without a family line. */
    noRod: number;
    /** What the window remembers for the next state (§3 step 8). */
    memory: ReadonlyMap<RodId, FanRodSlot>;
}

/** What the colours need of a fan model (structural: FanModel has it). */
export interface FanRodModel {
    focus: Person;
    shape: string;
    sectors: ReadonlyArray<{ ahnentafel: number; generation: number; person: Person | null }>;
    desc: ReadonlyArray<{ person: Person | null; r1: number; r2: number; lo: number; hi: number }>;
}

// ---------------------------------------------------------------- sides

/** Step 1: the lines in the fan with their count, side and size; the people without a line apart. */
export function fanRodSides(model: FanRodModel, index: LineageIndex): { rods: Map<RodId, FanRodInfo>; noRod: number } {
    const rods = new Map<RodId, FanRodInfo>();
    const desc = new Set<RodId>();
    let noRod = 0;
    const add = (p: Person | null, side: FanRodGroup, ring: number) => {
        if (!p) return;
        const id = rodOf(index, p.id);
        if (!id) { noRod++; return; }
        let r = rods.get(id);
        if (!r) {
            r = { id, count: 0, group: 'P', tree: index.rods.get(id)?.realMemberCount ?? 0, focus: false, both: false, nearest: { P: FAR, M: FAR } };
            rods.set(id, r);
        }
        r.count++;
        if (side === 'D') desc.add(id);
        else r.nearest[side] = Math.min(r.nearest[side], ring);
    };
    add(model.focus, 'P', 0);
    for (const s of model.sectors) add(s.person, ((s.ahnentafel >> (s.generation - 1)) & 1) === 0 ? 'P' : 'M', s.generation);
    for (const s of model.desc) add(s.person, 'D', 0);
    const focusRod = rodOf(index, model.focus.id);
    for (const r of rods.values()) {
        const { P, M } = r.nearest;
        r.focus = r.id === focusRod;
        r.both = P < FAR && M < FAR;
        r.group = r.focus ? 'P' : P === FAR && M === FAR ? 'D' : P <= M ? 'P' : 'M';
    }
    return { rods, noRod };
}

// ---------------------------------------------------------------- neighbours

/** The drawn sectors (their people) and the pairs of them sharing an edge (arc or radius). */
function sectorGraph(model: FanRodModel): { people: Person[]; edges: Array<[number, number]> } {
    const people: Person[] = [];
    const edges: Array<[number, number]> = [];
    const byAh = new Map<number, number>();
    for (const s of model.sectors) if (s.person) { byAh.set(s.ahnentafel, people.length); people.push(s.person); }
    const link = (a: number | undefined, b: number | undefined) => { if (a !== undefined && b !== undefined) edges.push([a, b]); };
    const full = model.shape === 'full';
    for (const s of model.sectors) {
        const i = byAh.get(s.ahnentafel);
        if (i === undefined) continue;
        const ah = s.ahnentafel, g = s.generation;
        link(i, byAh.get(2 * ah));
        link(i, byAh.get(2 * ah + 1));
        if (ah + 1 < 2 ** (g + 1)) link(i, byAh.get(ah + 1));
        else if (full) link(i, byAh.get(2 ** g));
    }
    const ds = model.desc.filter(s => s.person);
    const first = people.length;
    for (const s of ds) people.push(s.person!);
    const eps = 1e-6;
    ds.forEach((a, i) => ds.forEach((b, j) => {
        if (i === j) return;
        const sameRing = Math.abs(a.r1 - b.r1) < eps && Math.abs(a.hi - b.lo) < eps;
        const radial = Math.abs(a.r2 - b.r1) < eps && a.lo < b.hi - eps && b.lo < a.hi - eps;
        if (sameRing || radial) edges.push([first + i, first + j]);
    }));
    return { people, edges };
}

/** Distinct pairs of lines of the given pairs of people; each pair once, ids in order. */
function rodPairs(index: LineageIndex, pairs: Iterable<readonly [Person, Person]>): Array<[RodId, RodId]> {
    const out = new Map<string, [RodId, RodId]>();
    for (const [a, b] of pairs) {
        const ra = rodOf(index, a.id), rb = rodOf(index, b.id);
        if (!ra || !rb || ra === rb) continue;
        const pair: [RodId, RodId] = ra < rb ? [ra, rb] : [rb, ra];
        out.set(`${pair[0]}\u0000${pair[1]}`, pair);
    }
    return [...out.values()];
}

/** Pairs of lines whose sectors share an edge (arc or radius); each pair once, ids in order. */
export function fanRodAdjacency(model: FanRodModel, index: LineageIndex): Array<[RodId, RodId]> {
    const { people, edges } = sectorGraph(model);
    return rodPairs(index, edges.map(([a, b]) => [people[a], people[b]] as const));
}

/**
 * Pairs of lines near each other: a sector of one shares an edge with a
 * sector that shares an edge with a sector of the other (K1.7: a repeated
 * shade never lands there). Measured on the sectors, not on the lines: a long
 * line touching both ends of the fan makes no two lines near.
 */
export function fanRodNear(model: FanRodModel, index: LineageIndex): Array<[RodId, RodId]> {
    const { people, edges } = sectorGraph(model);
    const nb: number[][] = people.map(() => []);
    for (const [a, b] of edges) { nb[a].push(b); nb[b].push(a); }
    const pairs: Array<readonly [Person, Person]> = [];
    nb.forEach((xs, i) => {
        for (const m of xs) for (const j of nb[m]) if (j > i) pairs.push([people[i], people[j]]);
    });
    return rodPairs(index, pairs);
}

// ---------------------------------------------------------------- slots

const slotsOf = (g: FanRodGroup, t: FanRodTier): FanRodSlot[] => FAN_ROD_SLOTS[g][t].map((_, i) => `${g}${t}${i}` as FanRodSlot);

/** How far a slot is from the neighbours' slots, as a share of the thresholds (>= 1: distinct enough). */
function distinctness(slot: FanRodSlot, neighbours: readonly FanRodSlot[]): number {
    let worst = 9;
    for (const th of ['light', 'dark'] as const) {
        const c = fanRodSlotColor(slot, th);
        for (const n of neighbours) {
            const o = fanRodSlotColor(n, th);
            worst = Math.min(worst, deltaE(c, o) / MIN_DE[th], deltaEDeutan(c, o) / MIN_DE_DEUTAN);
        }
    }
    return worst;
}

const byRank = (a: FanRodInfo, b: FanRodInfo) => b.count - a.count || b.tree - a.tree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Steps 2–8: the slots of the lines (mutated: rank, tier, slot, kept,
 * borrowed, down, shared) and the memory for the next state. Every line gets
 * a slot (K1.7). `near`: the pairs of lines near each other besides the
 * neighbours (fanRodNear); without it, a neighbour's neighbour.
 */
export function assignFanRodSlots(
    rods: Iterable<FanRodInfo>,
    adjacency: ReadonlyArray<readonly [RodId, RodId]>,
    memory?: ReadonlyMap<RodId, FanRodSlot> | null,
    nearPairs?: ReadonlyArray<readonly [RodId, RodId]>,
): { slotOf: Map<RodId, FanRodSlot>; memory: Map<RodId, FanRodSlot>; ranked: FanRodInfo[] } {
    const ranked = [...rods].sort(byRank);
    const mem = new Map<RodId, FanRodSlot>();
    for (const [id, s] of memory ?? []) if (parseFanRodSlot(s)) mem.set(id, s);
    ranked.forEach((r, i) => { r.rank = i; r.tier = r.focus || (i < FAN_ROD_MAX_STRONG && r.count >= 2) ? 'S' : 'T'; });

    // Neighbours (sectors sharing an edge) and lines near (given, or a neighbour's neighbour).
    const neighbours = new Map<RodId, Set<RodId>>();
    const nb = (id: RodId) => neighbours.get(id) ?? neighbours.set(id, new Set()).get(id)!;
    for (const [a, b] of adjacency) { nb(a).add(b); nb(b).add(a); }
    const nearCache = new Map<RodId, Set<RodId>>();
    if (nearPairs) {
        const add = (a: RodId, b: RodId) => (nearCache.get(a) ?? nearCache.set(a, new Set(nb(a))).get(a)!).add(b);
        for (const [a, b] of nearPairs) { add(a, b); add(b, a); }
    }
    const near = (id: RodId): Set<RodId> => {
        let n = nearCache.get(id);
        if (!n) {
            n = new Set(nb(id));
            if (!nearPairs) for (const x of nb(id)) for (const y of nb(x)) if (y !== id) n.add(y);
            nearCache.set(id, n);
        }
        return n;
    };

    const holders = new Map<FanRodSlot, RodId[]>();
    const slotOf = new Map<RodId, FanRodSlot>();
    const give = (r: FanRodInfo, s: FanRodSlot) => {
        slotOf.set(r.id, s);
        (holders.get(s) ?? holders.set(s, []).get(s)!).push(r.id);
        r.slot = s;
    };
    /** Whether a line within `within` (its neighbours, or the lines near) already holds the slot. */
    const clash = (r: FanRodInfo, s: FanRodSlot, within: Set<RodId>) => (holders.get(s) ?? []).some(id => within.has(id));
    const reserveCentre = ranked.some(r => r.focus);
    // PS0 is the centre's alone: never shared, never handed to another line.
    const closed = (r: FanRodInfo, s: FanRodSlot) => s === CENTRE_SLOT && (holders.has(s) || (reserveCentre && !r.focus));

    // Step 4: a line keeps the slot it had, unless a neighbour holds it already.
    for (const r of ranked) {
        const s = mem.get(r.id);
        if (s && !(s === CENTRE_SLOT && holders.has(s)) && !clash(r, s, nb(r.id))) { give(r, s); r.kept = true; }
    }
    // Step 5: the centre's line on PS0.
    for (const r of ranked) {
        if (r.focus && !slotOf.has(r.id) && !holders.has(CENTRE_SLOT)) give(r, CENTRE_SLOT);
    }

    // Step 6–7: the others by rank. Fresh shades of the own group first; when they run out, the own
    // group's shades again on lines far enough apart; another group's only when nothing of the own is
    // distinct enough (distinctness wins over logic).
    for (const r of ranked) {
        if (slotOf.has(r.id)) continue;
        const g = r.group, t = r.tier!;
        const other: FanRodTier = t === 'S' ? 'T' : 'S';
        const ownT = slotsOf(g, t), ownO = slotsOf(g, other);
        const borT: FanRodSlot[] = [], borO: FanRodSlot[] = [];
        for (const ng of BORROW_FROM[g]) {
            borT.push(...slotsOf(ng, t).reverse());
            borO.push(...slotsOf(ng, other).reverse());
        }
        const open = (pl: FanRodSlot[]) => pl.filter(c => !closed(r, c));
        const fresh = (pl: FanRodSlot[]) => open(pl).filter(c => !holders.has(c));
        // Shades used already: the least used first, then in the palette's order.
        const again = (pl: FanRodSlot[]) => open(pl).filter(c => holders.has(c))
            .map((c, i) => [c, i] as const)
            .sort(([a, i], [b, j]) => holders.get(a)!.length - holders.get(b)!.length || i - j)
            .map(([c]) => c);
        // A strong line may go down to its group's muted shades; a muted one stays muted before going up.
        const pools = t === 'S'
            ? [fresh(ownT), fresh(ownO), again(ownT), again(ownO), fresh(borT), fresh(borO), again(borT), again(borO)]
            : [fresh(ownT), again(ownT), fresh(ownO), fresh(borT), again(borT), again(ownO), fresh(borO), again(borO)];
        const nbr = [...nb(r.id)].map(id => slotOf.get(id)).filter((s): s is FanRodSlot => !!s);
        const nearBy = near(r.id), next = nb(r.id);
        let pick: FanRodSlot | null = null;
        // Distinct from the neighbours and held by no line near; then by no neighbour; then the most distinct.
        for (const ok of [(c: FanRodSlot) => !clash(r, c, nearBy), (c: FanRodSlot) => !clash(r, c, next)]) {
            for (const pl of pools) {
                pick = pl.find(c => ok(c) && distinctness(c, nbr) >= 1) ?? null;
                if (pick) break;
            }
            if (pick) break;
        }
        if (!pick) {
            let best = -1;
            const all = pools.flat();
            for (const c of [...all.filter(c => !clash(r, c, next)), ...all]) {
                const d = distinctness(c, nbr);
                if (d > best) { best = d; pick = c; }
            }
        }
        if (pick) {
            r.shared = holders.has(pick);
            give(r, pick);
            const pg = parseFanRodSlot(pick)!;
            r.borrowed = pg.group !== g;
            r.down = pg.group === g && pg.tier !== t;
        }
    }

    // Step 8: what the window remembers is every line's slot.
    return { slotOf, memory: new Map(slotOf), ranked };
}

/**
 * The slots of the lines in a drawn fan (§1–§3). `memory`: what the window
 * remembers from its previous state (none: deterministic from the fan alone).
 */
export function assignFanRodColors(model: FanRodModel, index: LineageIndex, memory?: ReadonlyMap<RodId, FanRodSlot> | null): FanRodAssignment {
    const { rods, noRod } = fanRodSides(model, index);
    const { slotOf, memory: next, ranked } = assignFanRodSlots(rods.values(), fanRodAdjacency(model, index), memory, fanRodNear(model, index));
    return { index, slotOf, rods: ranked, noRod, memory: next };
}

/** The slot of a person's line, or null (grey). */
export function fanRodSlotOf(a: FanRodAssignment, personId: PersonId): FanRodSlot | null {
    const id = rodOf(a.index, personId);
    return id ? a.slotOf.get(id) ?? null : null;
}

// ---------------------------------------------------------------- legend data (§4)

/** The legend of the family-line colours: a part per side, the smaller lines under "Other". */
export interface FanRodLegend {
    /** Sides with at least one line of the first 20 (2+ sectors), P, M, D; the centre's line first, then by count. */
    groups: Array<{ group: FanRodGroup; items: FanLegendItem[] }>;
    /** The smaller lines (drawn once, or past the 20th place), each in its colour, by count, then name. */
    other: FanLegendItem[];
    otherRods: number;
    /** People of the smaller lines and people without a line. */
    otherPeople: number;
    /** Drawn people without a family line. */
    noRod: number;
}

/**
 * The legend's rows of an assignment. `labelOf`: the name of a line (default:
 * the tree's names of its lines, rodLabels).
 */
export function fanRodLegend(a: FanRodAssignment, theme: FanTheme, labelOf?: (id: RodId) => string): FanRodLegend {
    let labels: Map<RodId, string> | null = null;
    const label = labelOf ?? ((id: RodId) => (labels ??= rodLabels(a.index)).get(id) ?? '');
    const item = (r: FanRodInfo): FanLegendItem => {
        const slot = a.slotOf.get(r.id);
        return {
            key: r.id, label: label(r.id), who: `${r.count}×`, count: r.count,
            color: slot ? fanRodSlotColor(slot, theme) : FAN_PALETTES[theme].grey,
            ...(slot ? { slot } : {}), ...(r.focus ? { focus: true } : {}),
        };
    };
    const main = (r: FanRodInfo) => r.focus || ((r.rank ?? FAN_ROD_LEGEND_MAIN) < FAN_ROD_LEGEND_MAIN && r.count >= 2);
    const first = a.rods.filter(main);
    const groups = FAN_ROD_GROUPS
        .map(group => ({
            group,
            items: first.filter(r => r.group === group)
                .sort((x, y) => Number(y.focus) - Number(x.focus) || y.count - x.count || y.tree - x.tree || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
                .map(item),
        }))
        .filter(g => g.items.length > 0);
    const other = a.rods.filter(r => !main(r)).map(item)
        .sort((x, y) => (y.count ?? 0) - (x.count ?? 0) || x.label.localeCompare(y.label));
    const otherPeople = other.reduce((n, i) => n + (i.count ?? 0), 0) + a.noRod;
    return { groups, other, otherRods: other.length, otherPeople, noRod: a.noRod };
}
