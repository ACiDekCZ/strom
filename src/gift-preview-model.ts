/**
 * "Give a family tree" (spec 093 §3): the drawing of the cut in step 2's
 * preview, without the DOM. The people of the cut as small cards by
 * generations: the recipient with partners and descendants, the ancestors
 * above as couples, each ancestor's siblings beside them with their families
 * below. A family left out of the cut is a dashed "+ family (n)" stub under
 * its sibling; above ~60 cards the ancestors above the third generation of
 * the main line, and above the grandparents of the other lines, fold into
 * "▲ n more generations (m)" / "▲ … ancestors (m)" stubs, unfolded by a click.
 *
 * The layout is its own (blocks packed side by side by their per-row
 * extents, parents centred over their children): the family view's pipeline
 * draws only the siblings of the parents, not those of further ancestors.
 */

import type { PersonId, StromData } from './types.js';
import { ancestorGenerations, descentParentIds, descentSiblingsOf, partnersOf, sortByBirth } from './lineage.js';
import type { GiftBranch } from './gift-tree.js';

/** A card's size in the preview (px at 100 %). */
export const GIFT_PREVIEW_CARD = { w: 124, h: 40 } as const;
/** From this many people the far ancestors fold into stubs. */
export const GIFT_PREVIEW_COLLAPSE_FROM = 60;
/**
 * Folded at most this far: the main line (father's father's…) keeps three
 * ancestor generations, the other lines two (to the grandparents). Folding
 * starts from the top and stops as soon as the cards fit the limit.
 */
export const GIFT_PREVIEW_MAIN_KEEP = 3;
export const GIFT_PREVIEW_SIDE_KEEP = 2;

const CW = GIFT_PREVIEW_CARD.w;
const CH = GIFT_PREVIEW_CARD.h;
/** Between partners. */
const HG = 10;
/** Between families. */
const FG = 18;
/** From one generation's row to the next. */
const ROW = 90;
const STUB_H = 26;
/** Room above the drawing for the counts line and around it. */
const PAD_X = 24;
const PAD_TOP = 48;
const PAD_BOTTOM = 56;

export type GiftPreviewStub =
    /** A sibling of an ancestor without their family in the cut: a click adds it. */
    | { kind: 'family'; key: string; personId: PersonId; count: number }
    /** The main line's ancestors above the kept generations. */
    | { kind: 'generations'; key: string; personId: PersonId; generations: number; count: number }
    /** Another line's ancestors above the grandparents, named by the surname of the ancestor under them. */
    | { kind: 'side'; key: string; personId: PersonId; surname: string; count: number };

export interface GiftPreviewCard {
    id: PersonId;
    x: number;
    y: number;
    recipient: boolean;
}

export interface GiftPreviewStubBox {
    stub: GiftPreviewStub;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A straight line [x1, y1, x2, y2]. */
export type GiftPreviewLine = [number, number, number, number];

export interface GiftPreviewModel {
    cards: GiftPreviewCard[];
    stubs: GiftPreviewStubBox[];
    lines: GiftPreviewLine[];
    width: number;
    height: number;
    /** Some ancestors are folded into stubs. */
    folded: boolean;
}

export interface GiftPreviewInput {
    data: StromData;
    /** The people of the cut. */
    ids: ReadonlySet<PersonId>;
    recipients: readonly PersonId[];
    /** giftBranchCandidates of the cut (the family stubs). */
    branches: readonly GiftBranch[];
    /** Stub keys unfolded by a click. */
    expanded?: ReadonlySet<string>;
    /** Fold from this many people (default GIFT_PREVIEW_COLLAPSE_FROM). */
    collapseFrom?: number;
    /** A stub's text (the caller's language). */
    stubLabel: (stub: GiftPreviewStub) => string;
    /** A stub's width for its text (default: an estimate from its length). */
    stubWidth?: (label: string) => number;
}

/** The people a sibling's family adds to the cut (the "+ family (n)" stub and the menu's "Add the family"). */
export function giftBranchAdds(b: Pick<GiftBranch, 'familyCount' | 'aloneCount'>): number {
    return Math.max(0, b.familyCount - b.aloneCount);
}

/** Whether a sibling of an ancestor shows a "+ family (n)" stub: their family is out and has someone in it. */
export function giftBranchHasStub(b: GiftBranch): boolean {
    return !b.included && giftBranchAdds(b) > 0;
}

// ==================== Blocks ====================

interface Item {
    id?: PersonId;
    stub?: GiftPreviewStub;
    label?: string;
    x: number;
    row: number;
    w: number;
}

/** Placed items with each row's extent [min x, max x]. */
class Block {
    items: Item[] = [];
    ext = new Map<number, [number, number]>();

    add(item: Item): void {
        this.items.push(item);
        const e = this.ext.get(item.row);
        if (e) { e[0] = Math.min(e[0], item.x); e[1] = Math.max(e[1], item.x + item.w); }
        else this.ext.set(item.row, [item.x, item.x + item.w]);
    }

    shift(dx: number): void {
        if (!dx) return;
        for (const it of this.items) it.x += dx;
        for (const e of this.ext.values()) { e[0] += dx; e[1] += dx; }
    }

    absorb(other: Block): void {
        for (const it of other.items) this.add(it);
    }

    get empty(): boolean { return this.items.length === 0; }

    center(row: number): number | null {
        const e = this.ext.get(row);
        return e ? (e[0] + e[1]) / 2 : null;
    }

    xOf(id: PersonId): number | null {
        const it = this.items.find(i => i.id === id);
        return it ? it.x : null;
    }

    bounds(): [number, number] {
        let lo = Infinity, hi = -Infinity;
        for (const [a, b] of this.ext.values()) { lo = Math.min(lo, a); hi = Math.max(hi, b); }
        return lo === Infinity ? [0, 0] : [lo, hi];
    }
}

/** Put `b` right of `a` (as close as their shared rows allow) and return both as one. */
function packPair(a: Block, b: Block, gap: number): Block {
    if (a.empty) return b;
    if (b.empty) return a;
    let dx = -Infinity;
    for (const [row, [lo]] of b.ext) {
        const e = a.ext.get(row);
        if (e) dx = Math.max(dx, e[1] + gap - lo);
    }
    if (dx === -Infinity) dx = a.bounds()[1] + gap - b.bounds()[0];
    b.shift(dx);
    a.absorb(b);
    return a;
}

function packRow(blocks: Block[], gap = FG): Block {
    return blocks.reduce((acc, b) => packPair(acc, b, gap), new Block());
}

// ==================== Layout ====================

/**
 * The preview's drawing of a cut. Above the limit the far ancestors fold:
 * generation by generation from the top, until the cards fit or the main line
 * keeps GIFT_PREVIEW_MAIN_KEEP generations and the others GIFT_PREVIEW_SIDE_KEEP.
 */
export function giftPreviewModel(input: GiftPreviewInput): GiftPreviewModel {
    const limit = input.collapseFrom ?? GIFT_PREVIEW_COLLAPSE_FROM;
    if (input.ids.size <= limit) return layoutOnce(input, null);
    let deepest = 0;
    for (const r of input.recipients) if (input.ids.has(r)) deepest = Math.max(deepest, ancestorGenerations(input.data, r).length);
    let model = layoutOnce(input, null);
    for (let side = deepest - 1; side >= GIFT_PREVIEW_SIDE_KEEP && model.cards.length > limit; side--) {
        model = layoutOnce(input, { main: Math.max(side + 1, GIFT_PREVIEW_MAIN_KEEP), side });
    }
    return model;
}

function layoutOnce(input: GiftPreviewInput, keep: { main: number; side: number } | null): GiftPreviewModel {
    const { data, ids } = input;
    const recipients = input.recipients.filter(r => ids.has(r));
    const expanded = input.expanded ?? new Set<string>();
    const fold = keep !== null;
    const widthOf = input.stubWidth ?? ((label: string) => Math.round(label.length * 6.6 + 18));
    const branchOf = new Map(input.branches.map(b => [b.siblingId, b]));

    // The line (recipients and their ancestors) is placed by the ancestry, never as someone's child or partner.
    const reserved = new Set<PersonId>(recipients);
    for (const r of recipients) for (const g of ancestorGenerations(data, r)) for (const a of g) if (ids.has(a)) reserved.add(a);
    const placed = new Set<PersonId>();
    const hidden = new Set<PersonId>();
    let folded = false;
    const free = (id: PersonId): boolean => ids.has(id) && !placed.has(id) && !reserved.has(id) && !hidden.has(id);
    const real = (id: PersonId): boolean => !!data.persons[id] && !data.persons[id].isPlaceholder;
    const female = (id: PersonId): boolean => data.persons[id]?.gender === 'female';

    const stubItem = (stub: GiftPreviewStub, x: number, row: number): Item => {
        const label = input.stubLabel(stub);
        return { stub, label, x, row, w: widthOf(label) };
    };

    /** Cards side by side from x = 0. */
    const cards = (list: PersonId[], row: number): Block => {
        const b = new Block();
        list.forEach((id, i) => { placed.add(id); b.add({ id, x: i * (CW + HG), row, w: CW }); });
        return b;
    };

    /** Children of these people in the cut and not yet drawn: shared ones first (by partner), then each one's own. */
    const childrenOf = (couple: PersonId[]): PersonId[] => {
        const out: PersonId[] = [];
        const seen = new Set<PersonId>();
        const push = (list: PersonId[]): void => {
            for (const c of sortByBirth(data, list)) if (!seen.has(c) && free(c)) { seen.add(c); out.push(c); }
        };
        const kids = (id: PersonId): PersonId[] => data.persons[id]?.childIds ?? [];
        const [head, ...rest] = couple;
        for (const p of rest) push(kids(head).filter(c => kids(p).includes(c)));
        for (const id of couple) push(kids(id));
        return out;
    };

    /** A person with partners in one row and the children below them, packed and centred. */
    const desc = (x: PersonId, row: number): Block => {
        placed.add(x);
        const partners = partnersOf(data, x).filter(p => free(p) && real(p));
        const couple = cards([x, ...partners], row);
        return hangChildren(couple, childrenOf([x, ...partners]), row, x);
    };

    /** The children's families under a row of cards (the cards centred over them), or the family stub. */
    const hangChildren = (couple: Block, kids: PersonId[], row: number, stubFor?: PersonId): Block => {
        const blocks: Block[] = [];
        for (const k of kids) if (free(k)) blocks.push(desc(k, row + 1));
        let children = packRow(blocks);
        if (children.empty && stubFor) {
            const b = branchOf.get(stubFor);
            if (b && giftBranchHasStub(b)) {
                children = new Block();
                children.add(stubItem({ kind: 'family', key: `fam:${stubFor}`, personId: stubFor, count: giftBranchAdds(b) }, 0, row + 1));
            }
        }
        if (children.empty) return couple;
        const [lo, hi] = couple.ext.get(row)!;
        couple.shift(children.center(row + 1)! - (lo + hi) / 2);
        couple.absorb(children);
        return couple;
    };

    /** Male first; otherwise by id (a stable order). */
    const orderParents = (ps: PersonId[]): PersonId[] =>
        ps.slice().sort((a, b) => (female(a) ? 1 : 0) - (female(b) ? 1 : 0) || (a < b ? -1 : a > b ? 1 : 0));

    /** A line person's other partners in the cut (not the other parent of the line). */
    const otherPartners = (id: PersonId, not: PersonId | null): PersonId[] =>
        partnersOf(data, id).filter(p => p !== not && free(p) && real(p));

    /**
     * Two halves side by side with the couple F (right end of `upF`) and M
     * (left end of `upM`) next to each other and `children` centred under
     * them; the halves move apart as far as the children's families need.
     */
    const joinCouple = (upF: Block, F: PersonId, upM: Block, M: PersonId, children: Block, childRow: number): Block => {
        const xF = upF.xOf(F) ?? upF.bounds()[1] - CW;
        const xM = upM.xOf(M) ?? upM.bounds()[0];
        let d = xF + CW + HG - xM;
        for (const [row, [lo]] of upM.ext) {
            const e = upF.ext.get(row);
            if (e) d = Math.max(d, e[1] + FG - lo);
        }
        const cc = children.empty ? 0 : children.center(childRow) ?? 0;
        if (!children.empty) {
            for (const [row, [lo, hi]] of children.ext) {
                const f = upF.ext.get(row);
                if (f) d = Math.max(d, 2 * (f[1] + FG - lo + cc) - xF - xM - CW);
                const m = upM.ext.get(row);
                if (m) d = Math.max(d, xF + xM + CW - 2 * cc + 2 * (hi + FG - m[0]));
            }
        }
        upM.shift(d);
        upF.absorb(upM);
        if (!children.empty) {
            children.shift((xF + xM + d + CW) / 2 - cc);
            upF.absorb(children);
        }
        return upF;
    };

    /** One parent over the children: centred under them, moved off the parent's siblings' families when needed. */
    const joinSingle = (up: Block, P: PersonId, children: Block, childRow: number, side: 'left' | 'right'): Block => {
        if (children.empty) return up;
        const xP = up.xOf(P) ?? 0;
        let c = xP + CW / 2 - (children.center(childRow) ?? 0);
        for (const [row, [lo, hi]] of children.ext) {
            const e = up.ext.get(row);
            if (!e) continue;
            c = side === 'right' ? Math.max(c, e[1] + FG - lo) : Math.min(c, e[0] - FG - hi);
        }
        children.shift(c);
        up.absorb(children);
        return up;
    };

    /** The row of a line person in their own block. */
    const rowIn = (b: Block, id: PersonId): number => b.items.find(i => i.id === id)?.row ?? 0;

    /**
     * A line person `L` (already in `self`, with partners or descendants) with
     * their siblings and their families beside them and the parents' ancestry
     * above. `side`: where L stands among the siblings ('right' = the right
     * end, next to a partner on the right). `g` = L's ancestor generation.
     */
    const lineFamily = (L: PersonId, self: Block, side: 'left' | 'right' | 'center', g: number, main: boolean, mayFold: boolean): Block => {
        const row = rowIn(self, L);
        const parents = orderParents(descentParentIds(data, L).filter(p => ids.has(p) && !placed.has(p) && !hidden.has(p) && real(p)));
        const key = `up:${L}`;
        if (parents.length > 0 && mayFold && fold && g >= (main ? keep!.main : keep!.side) && !expanded.has(key)) {
            // Count everyone the ancestry above would draw, then leave them out under one stub.
            const before = new Set(placed);
            buildAbove(L, new Block(), row, side, parents, g, main, false);
            let count = 0;
            for (const id of [...placed]) if (!before.has(id)) { placed.delete(id); hidden.add(id); count++; }
            if (count > 0) {
                folded = true;
                const gens = ancestorGenerations(data, L).filter(list => list.some(a => ids.has(a))).length;
                const p = data.persons[L];
                const stub: GiftPreviewStub = main
                    ? { kind: 'generations', key, personId: L, generations: gens, count }
                    : { kind: 'side', key, personId: L, surname: (p?.lastName || '').trim(), count };
                const item = stubItem(stub, 0, row - 1);
                item.x = (self.xOf(L) ?? 0) + CW / 2 - item.w / 2;
                self.add(item);
            }
            return self;
        }
        return buildAbove(L, self, row, side, parents, g, main, mayFold);
    };

    /** The siblings row of `L` and the parents' ancestry over it (lineFamily without the fold). */
    const buildAbove = (
        L: PersonId, self: Block, row: number, side: 'left' | 'right' | 'center',
        parents: PersonId[], g: number, main: boolean, mayFold: boolean,
    ): Block => {
        const [F, M] = parents;
        const sibs = sortByBirth(data, descentSiblingsOf(data, L).filter(s => free(s) && real(s)));
        const halfF: PersonId[] = [], halfM: PersonId[] = [], full: PersonId[] = [];
        for (const s of sibs) {
            const ps = descentParentIds(data, s);
            const hasF = !!F && ps.includes(F), hasM = !!M && ps.includes(M);
            if (M && hasF && !hasM) halfF.push(s);
            else if (M && hasM && !hasF) halfM.push(s);
            else full.push(s);
        }
        const order: Array<PersonId | 'self'> = side === 'right'
            ? [...halfF, ...halfM, ...full, 'self']
            : side === 'left'
                ? ['self', ...full, ...halfF, ...halfM]
                : [...halfF, ...sortByBirth(data, [...full, L]).map(x => (x === L ? 'self' as const : x)), ...halfM];
        const blocks: Block[] = [];
        for (const x of order) {
            if (x === 'self') blocks.push(self);
            else if (free(x)) blocks.push(desc(x, row));
        }
        const children = packRow(blocks);
        if (!F) return children;
        if (!M) {
            const up = lineFamily(F, cards([...otherPartners(F, null), F], row - 1), side === 'left' ? 'left' : 'right', g + 1, main, mayFold);
            return joinSingle(up, F, children, row, side === 'left' ? 'left' : 'right');
        }
        const upF = lineFamily(F, cards([...otherPartners(F, M), F], row - 1), 'right', g + 1, main, mayFold);
        const upM = lineFamily(M, cards([M, ...otherPartners(M, F)], row - 1), 'left', g + 1, false, mayFold);
        return joinCouple(upF, F, upM, M, children, row);
    };

    // The recipients: one person, a couple (side by side, their children under both), or two apart.
    let block: Block;
    const [R1, R2] = recipients;
    if (!R1) block = new Block();
    else if (R2 && partnersOf(data, R1).includes(R2)) {
        const self1 = cards([...otherPartners(R1, R2), R1], 0);
        const self2 = cards([R2, ...otherPartners(R2, R1)], 0);
        const couple = [...self1.items, ...self2.items].map(i => i.id!).filter(Boolean);
        const kids = new Block();
        const childBlocks: Block[] = [];
        for (const k of childrenOf([R1, R2, ...couple.filter(c => c !== R1 && c !== R2)])) if (free(k)) childBlocks.push(desc(k, 1));
        kids.absorb(packRow(childBlocks));
        const up1 = lineFamily(R1, self1, 'right', 0, true, true);
        const up2 = lineFamily(R2, self2, 'left', 0, false, true);
        block = joinCouple(up1, R1, up2, R2, kids, 1);
    } else {
        block = packRow(recipients.map((r, i) => lineFamily(r, desc(r, 0), 'center', 0, i === 0, true)), FG * 2);
    }

    // Anyone the walk above did not reach (linked in some other way): by generation, right of the rest.
    const rest = [...ids].filter(id => !placed.has(id) && !hidden.has(id) && real(id));
    if (rest.length) {
        const rowOf = generationRows(data, ids, recipients);
        const byRow = new Map<number, PersonId[]>();
        for (const id of sortByBirth(data, rest)) {
            const r = rowOf.get(id) ?? 0;
            byRow.set(r, [...(byRow.get(r) ?? []), id]);
        }
        const extra = new Block();
        for (const [r, list] of byRow) list.forEach((id, i) => { placed.add(id); extra.add({ id, x: i * (CW + HG), row: r, w: CW }); });
        block = packPair(block, extra, FG * 3);
    }

    return toModel(block, data, recipients, folded);
}

/** Each person's generation row from the recipients (parents −1, children +1, partners the same). */
function generationRows(data: StromData, ids: ReadonlySet<PersonId>, recipients: readonly PersonId[]): Map<PersonId, number> {
    const out = new Map<PersonId, number>();
    const queue: PersonId[] = [];
    for (const r of recipients) { out.set(r, 0); queue.push(r); }
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        const p = data.persons[id];
        if (!p) continue;
        const g = out.get(id)!;
        const step = (next: PersonId, ng: number): void => {
            if (!ids.has(next) || out.has(next)) return;
            out.set(next, ng);
            queue.push(next);
        };
        for (const x of p.parentIds) step(x, g - 1);
        for (const x of p.childIds) step(x, g + 1);
        for (const x of partnersOf(data, id)) step(x, g);
    }
    return out;
}

/** Block coordinates to the drawing's pixels, with the lines between the cards. */
function toModel(block: Block, data: StromData, recipients: readonly PersonId[], folded: boolean): GiftPreviewModel {
    if (block.empty) return { cards: [], stubs: [], lines: [], width: 0, height: 0, folded };
    const [minX, maxX] = block.bounds();
    const rows = [...block.ext.keys()];
    const minRow = Math.min(...rows), maxRow = Math.max(...rows);
    const rowY = (row: number): number => PAD_TOP + (row - minRow) * ROW;
    const px = (x: number): number => Math.round(x - minX + PAD_X);
    const cards: GiftPreviewCard[] = [];
    const stubs: GiftPreviewStubBox[] = [];
    const at = new Map<PersonId, { x: number; y: number; row: number }>();
    for (const it of block.items) {
        if (it.id) {
            const c = { id: it.id, x: px(it.x), y: rowY(it.row), recipient: recipients.includes(it.id) };
            cards.push(c);
            at.set(it.id, { x: c.x, y: c.y, row: it.row });
        } else if (it.stub) {
            // A family stub sits in its row; an ancestors' stub just above the card it stands on.
            const y = it.stub.kind === 'family' ? rowY(it.row) + (CH - STUB_H) / 2 : rowY(it.row) + CH + (ROW - CH) - STUB_H - 10;
            stubs.push({ stub: it.stub, label: it.label ?? '', x: px(it.x), y: Math.round(y), w: it.w, h: STUB_H });
        }
    }

    const lines: GiftPreviewLine[] = [];
    // Partners in one row: the line between their cards.
    for (const u of Object.values(data.partnerships)) {
        const a = at.get(u.person1Id), b = at.get(u.person2Id);
        if (!a || !b || a.row !== b.row) continue;
        const [l, r] = a.x <= b.x ? [a, b] : [b, a];
        if (r.x > l.x + CW) lines.push([l.x + CW, l.y + CH / 2, r.x, r.y + CH / 2]);
    }
    // Children under their parents: a stem from the couple (or the parent), the bus, a drop to each child.
    const groups = new Map<string, { parents: PersonId[]; kids: PersonId[] }>();
    for (const [id, pos] of at) {
        const parents = parentsDrawn(data, id).filter(p => at.get(p)?.row === pos.row - 1);
        if (!parents.length) continue;
        const two = parents.length >= 2 ? parents.slice(0, 2) : parents;
        const key = two.slice().sort().join('|');
        const g = groups.get(key) ?? { parents: two, kids: [] };
        g.kids.push(id);
        groups.set(key, g);
    }
    for (const { parents, kids } of groups.values()) {
        const ps = parents.map(p => at.get(p)!).sort((a, b) => a.x - b.x);
        const top = ps[0].y;
        let ax: number, ay: number;
        if (ps.length === 2) { ax = (ps[0].x + CW + ps[1].x) / 2; ay = top + CH / 2; }
        else { ax = ps[0].x + CW / 2; ay = top + CH; }
        const busY = top + CH + (ROW - CH) / 2;
        const xs = kids.map(k => at.get(k)!.x + CW / 2);
        lines.push([ax, ay, ax, busY]);
        const lo = Math.min(ax, ...xs), hi = Math.max(ax, ...xs);
        if (hi > lo) lines.push([lo, busY, hi, busY]);
        for (const k of kids) {
            const c = at.get(k)!;
            lines.push([c.x + CW / 2, busY, c.x + CW / 2, c.y]);
        }
    }
    return {
        cards, stubs, lines,
        width: Math.round(maxX - minX + PAD_X * 2),
        height: Math.round(rowY(maxRow) + CH + PAD_BOTTOM),
        folded,
    };
}

/** A person's parents for the lines: the descent parents, else any recorded parent (a step or foster child). */
function parentsDrawn(data: StromData, id: PersonId): PersonId[] {
    const d = descentParentIds(data, id);
    return d.length ? d : (data.persons[id]?.parentIds ?? []);
}
