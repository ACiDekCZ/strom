/**
 * Fan chart in family-line colours (spec 114 §1, §3, §10): which side of the
 * fan each family line (rod) belongs to, and which palette slot it gets.
 *
 * - Group: the centre's line is the father's side (P); a line seen only among
 *   the descendants and their partners is D; any other the side where it is
 *   nearest to the centre (lowest ring; a tie goes to the father's side).
 * - Coloured lines: 2+ sectors (the centre counted), by count, then the size in
 *   the tree, then the id; at most 20. The first 10 strong, the next 10 muted;
 *   the centre's line always strong and on PS0. A line drawn once, or past the
 *   20th place, is grey.
 * - Memory (§3): a line keeps the slot it had in the previous state of the
 *   window (re-centring, rings, shape); a grey line still seen holds its slot
 *   loosely; a line gone from the fan frees it.
 * - Distinctness wins over logic: a slot too close to a neighbouring line's
 *   colour (sectors sharing an edge) is skipped while a better one is free.
 *
 * Mirrors the reference implementation the design was drawn with
 * (fancolor.py); a test compares both on the sample data.
 */

import type { Person, PersonId } from './types.js';
import { LineageIndex, RodId, rodOf, rodLabels } from './lineage.js';
import {
    FanRodGroup, FanRodTier, FanRodSlot, FanTheme, FanLegendItem, FAN_ROD_GROUPS, FAN_ROD_SLOTS, FAN_PALETTES,
    fanRodSlotColor, deltaE, deltaEDeutan, parseFanRodSlot,
} from './fan-colors.js';

/** At most this many strong lines, and coloured lines in all. */
export const FAN_ROD_MAX_STRONG = 10;
export const FAN_ROD_MAX_COLOURED = 20;
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
    /** Place among the coloured lines (0 = most sectors); undefined: grey. */
    rank?: number;
    tier?: FanRodTier;
    slot?: FanRodSlot;
    /** The slot came from the memory. */
    kept?: boolean;
    /** The slot is another group's (distinctness, or the group's slots used up). */
    borrowed?: boolean;
    /** The slot is of the group's other tier. */
    down?: boolean;
}

/** The family lines of one drawn fan and their slots. */
export interface FanRodAssignment {
    /** The family lines the slots belong to (fills look a person's line up here). */
    index: LineageIndex;
    slotOf: ReadonlyMap<RodId, FanRodSlot>;
    /** Every line in the fan, in the order of their rank (coloured first, then grey by count). */
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

/** Pairs of lines whose sectors share an edge (arc or radius); each pair once, ids in order. */
export function fanRodAdjacency(model: FanRodModel, index: LineageIndex): Array<[RodId, RodId]> {
    const pairs = new Map<string, [RodId, RodId]>();
    const link = (a: Person | null | undefined, b: Person | null | undefined) => {
        if (!a || !b) return;
        const ra = rodOf(index, a.id), rb = rodOf(index, b.id);
        if (!ra || !rb || ra === rb) return;
        const pair: [RodId, RodId] = ra < rb ? [ra, rb] : [rb, ra];
        pairs.set(`${pair[0]}\u0000${pair[1]}`, pair);
    };
    const byAh = new Map<number, Person>();
    for (const s of model.sectors) if (s.person) byAh.set(s.ahnentafel, s.person);
    const full = model.shape === 'full';
    for (const s of model.sectors) {
        const p = s.person;
        if (!p) continue;
        const ah = s.ahnentafel, g = s.generation;
        link(p, byAh.get(2 * ah));
        link(p, byAh.get(2 * ah + 1));
        if (ah + 1 < 2 ** (g + 1)) link(p, byAh.get(ah + 1));
        else if (full) link(p, byAh.get(2 ** g));
    }
    const ds = model.desc.filter(s => s.person);
    const eps = 1e-6;
    for (const a of ds) {
        for (const b of ds) {
            if (a === b) continue;
            const sameRing = Math.abs(a.r1 - b.r1) < eps && Math.abs(a.hi - b.lo) < eps;
            const radial = Math.abs(a.r2 - b.r1) < eps && a.lo < b.hi - eps && b.lo < a.hi - eps;
            if (sameRing || radial) link(a.person, b.person);
        }
    }
    return [...pairs.values()];
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

/**
 * Steps 2–8: the slots of the lines (mutated: rank, tier, slot, kept,
 * borrowed, down) and the memory for the next state.
 */
export function assignFanRodSlots(
    rods: Iterable<FanRodInfo>,
    adjacency: ReadonlyArray<readonly [RodId, RodId]>,
    memory?: ReadonlyMap<RodId, FanRodSlot> | null,
): { slotOf: Map<RodId, FanRodSlot>; memory: Map<RodId, FanRodSlot>; ranked: FanRodInfo[] } {
    const all = [...rods];
    const info = new Map(all.map(r => [r.id, r]));
    const mem = new Map<RodId, FanRodSlot>();
    for (const [id, s] of memory ?? []) if (parseFanRodSlot(s)) mem.set(id, s);

    const order = (a: FanRodInfo, b: FanRodInfo) => b.count - a.count || b.tree - a.tree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const ranked = all.filter(r => r.count >= 2).sort(order);
    const coloured = ranked.slice(0, FAN_ROD_MAX_COLOURED);
    coloured.forEach((r, i) => { r.rank = i; r.tier = i < FAN_ROD_MAX_STRONG || r.focus ? 'S' : 'T'; });

    const taken = new Map<FanRodSlot, RodId>();
    const slotOf = new Map<RodId, FanRodSlot>();
    const give = (r: FanRodInfo, s: FanRodSlot) => { slotOf.set(r.id, s); taken.set(s, r.id); r.slot = s; };
    const reserveCentre = coloured.some(r => r.focus);

    // Step 4: a line keeps the slot it had, while nobody took it yet.
    for (const r of coloured) {
        const s = mem.get(r.id);
        if (s && !taken.has(s)) { give(r, s); r.kept = true; }
    }
    // Step 5: the centre's line on PS0.
    for (const r of coloured) {
        if (r.focus && !slotOf.has(r.id) && !taken.has(CENTRE_SLOT)) give(r, CENTRE_SLOT);
    }
    // Slots held loosely by lines drawn once: last in every pool.
    const soft = new Set<FanRodSlot>();
    for (const [id, s] of mem) if ((info.get(id)?.count ?? 0) === 1) soft.add(s);
    const neighbours = new Map<RodId, RodId[]>();
    for (const [a, b] of adjacency) {
        (neighbours.get(a) ?? neighbours.set(a, []).get(a)!).push(b);
        (neighbours.get(b) ?? neighbours.set(b, []).get(b)!).push(a);
    }

    // Step 6–7: the others by rank; own group and tier, own group's other tier, then borrowed.
    for (const r of coloured) {
        if (slotOf.has(r.id)) continue;
        const g = r.group, t = r.tier!;
        const other: FanRodTier = t === 'S' ? 'T' : 'S';
        const ownT = slotsOf(g, t), ownO = slotsOf(g, other);
        const borT: FanRodSlot[] = [], borO: FanRodSlot[] = [];
        for (const ng of BORROW_FROM[g]) {
            borT.push(...slotsOf(ng, t).reverse());
            borO.push(...slotsOf(ng, other).reverse());
        }
        // A strong line may go down to its group's muted shades; a muted one borrows before going up.
        const pools = (t === 'S' ? [ownT, ownO, borT, borO] : [ownT, borT, ownO, borO])
            .map(pl => pl.filter(c => !taken.has(c) && !(reserveCentre && c === CENTRE_SLOT)))
            .map(pl => [...pl.filter(c => !soft.has(c)), ...pl.filter(c => soft.has(c))]);
        const nbr = (neighbours.get(r.id) ?? []).map(id => slotOf.get(id)).filter((s): s is FanRodSlot => !!s);
        let pick: FanRodSlot | null = null;
        for (const pl of pools) {
            pick = pl.find(c => distinctness(c, nbr) >= 1) ?? null;
            if (pick) break;
        }
        if (!pick) {
            let best = -1;
            for (const c of pools.flat()) {
                const d = distinctness(c, nbr);
                if (d > best) { best = d; pick = c; }
            }
        }
        if (pick) {
            give(r, pick);
            const pg = parseFanRodSlot(pick)!;
            r.borrowed = pg.group !== g;
            r.down = pg.group === g && pg.tier !== t;
        }
    }

    // Step 8: the coloured lines, and the slots of lines still seen but grey (loosely).
    const next = new Map(slotOf);
    for (const [id, s] of mem) if (info.has(id) && !next.has(id) && !taken.has(s)) next.set(id, s);
    return { slotOf, memory: next, ranked };
}

/**
 * The slots of the lines in a drawn fan (§1–§3). `memory`: what the window
 * remembers from its previous state (none: deterministic from the fan alone).
 */
export function assignFanRodColors(model: FanRodModel, index: LineageIndex, memory?: ReadonlyMap<RodId, FanRodSlot> | null): FanRodAssignment {
    const { rods, noRod } = fanRodSides(model, index);
    const { slotOf, memory: next, ranked } = assignFanRodSlots(rods.values(), fanRodAdjacency(model, index), memory);
    const grey = [...rods.values()].filter(r => !slotOf.has(r.id))
        .sort((a, b) => b.count - a.count || b.tree - a.tree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const list = [...ranked.filter(r => slotOf.has(r.id)), ...grey];
    return { index, slotOf, rods: list, noRod, memory: next };
}

/** The slot of a person's line, or null (grey). */
export function fanRodSlotOf(a: FanRodAssignment, personId: PersonId): FanRodSlot | null {
    const id = rodOf(a.index, personId);
    return id ? a.slotOf.get(id) ?? null : null;
}

// ---------------------------------------------------------------- legend data (§4)

/** The legend of the family-line colours: a part per side, the grey lines under "Other". */
export interface FanRodLegend {
    /** Sides with at least one coloured line, P, M, D; the centre's line first, then by count. */
    groups: Array<{ group: FanRodGroup; items: FanLegendItem[] }>;
    /** Grey lines (drawn once, or past the 20th place), by count, then name. */
    other: FanLegendItem[];
    otherRods: number;
    /** People of the grey lines and people without a line. */
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
    const coloured = a.rods.filter(r => a.slotOf.has(r.id));
    const groups = FAN_ROD_GROUPS
        .map(group => ({
            group,
            items: coloured.filter(r => r.group === group)
                .sort((x, y) => Number(y.focus) - Number(x.focus) || y.count - x.count || y.tree - x.tree || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
                .map(item),
        }))
        .filter(g => g.items.length > 0);
    const other = a.rods.filter(r => !a.slotOf.has(r.id)).map(item)
        .sort((x, y) => (y.count ?? 0) - (x.count ?? 0) || x.label.localeCompare(y.label));
    const otherPeople = other.reduce((n, i) => n + (i.count ?? 0), 0) + a.noRod;
    return { groups, other, otherRods: other.length, otherPeople, noRod: a.noRod };
}
