/**
 * Fan chart (spec 029): the ancestor fan as a half circle, a full circle or
 * two-way (ancestors above, descendants below). Pure model + SVG builder
 * over StromData (no DOM access — the renderer wires the container, the zoom
 * and the events).
 *
 * Ahnentafel numbering: 1 = focus, 2n = father of n, 2n+1 = mother of n. The
 * father's line fills the left side. A person met a second time (pedigree
 * collapse) is drawn again but not expanded: `repeatOf` names the first
 * occurrence.
 *
 * Geometry is in fan units: the focus centre at [0, 0], y down, angles in
 * math degrees (x = r·cos a, y = −r·sin a). `ppu` (screen pixels per unit)
 * decides how much text fits; sizes in the SVG are px / ppu.
 */

import { StromData, Person, PersonId, ParentChildRelType, parentSlots } from './types.js';
import { dateSortKey } from './dates.js';
import { shownName, shownNameFull } from './person-name.js';
import { strings } from './strings.js';
import { compareMarriages, marriageDates } from './marriage-order.js';
import { isDiagramStandIn } from './layout/pipeline/placeholders.js';
import { LineageIndex, buildLineages } from './lineage.js';
import {
    posterFooterSvg, PosterFooterMeta, FOOTER_HEIGHT, POSTER_PADDING, POSTER_FONT, POSTER_BG,
} from './export-image.js';
import {
    FanColorMode, FanTheme, FanPalette, FAN_PALETTES, fanFill, fanRodColors, FanRodColors, fanLegend, fanHasRepeats,
} from './fan-colors.js';
import {
    FanLabelSizes, FanMeasure, fanScreenSizes, fanPrintSizes, fanBaseSize, defaultFanMeasure, fanLabelBox, fitFanLabel, fitFanSectorLabel,
    fanLabelSvg, fanCenteredRowsSvg, fanRadialRotation, fanYears, FanLabelBox,
} from './fan-labels.js';

// ==================== GEOMETRY ====================

export type FanShape = 'half' | 'full' | 'two';
export const FAN_SHAPES: readonly FanShape[] = ['half', 'full', 'two'];

/** Radius of the focus disc. */
export const FOCUS_R = 56;
/** Widths of the ancestor rings 1–10. */
export const RING_W: readonly number[] = [84, 80, 74, 68, 62, 58, 54, 52, 50, 48];
/** Width of a partner band (two-way). */
export const PARTNER_W = 12;
/** Widths of the descendant rings 1–5. */
export const DESC_W: readonly number[] = [70, 62, 56, 52, 50];

export const FAN_MIN_GENERATIONS = 3;
export const FAN_MAX_GENERATIONS = 10;
export const FAN_DEFAULT_GENERATIONS = 5;
export const FAN_MIN_DESC_GENERATIONS = 1;
export const FAN_MAX_DESC_GENERATIONS = 5;
export const FAN_DEFAULT_DESC_GENERATIONS = 3;

/** Margin around the drawing (fan units). */
const BOUNDS_PAD = 10;

/** Inner and outer radius of ancestor ring `g` (1 = parents). */
export function ancestorRingRadii(g: number): [number, number] {
    let r = FOCUS_R;
    for (let k = 1; k < g; k++) r += RING_W[k - 1];
    return [r, r + RING_W[g - 1]];
}

/** Radii of descendant depth `d` (1 = children): the partner band below it and the ring itself. */
export function descendantRingRadii(d: number): { partner: [number, number]; ring: [number, number] } {
    let r = FOCUS_R;
    for (let k = 1; k < d; k++) r += PARTNER_W + DESC_W[k - 1];
    return { partner: [r, r + PARTNER_W], ring: [r + PARTNER_W, r + PARTNER_W + DESC_W[d - 1]] };
}

/** An axis-aligned rectangle in fan units. */
export interface FanBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

// ==================== MODEL ====================

export interface FanSector {
    /** Stable key of the sector in the drawing ('a' + Kekulé number). */
    key: string;
    /** Ahnentafel number (>= 2 — the focus is the center disc, not a sector). */
    ahnentafel: number;
    /** Ring number, 1 = parents. */
    generation: number;
    /** 0-based position in the ring, left to right. */
    indexInGen: number;
    /** The ancestor, or null for an unknown-ancestor slot. */
    person: Person | null;
    /** The person whose parent this slot is (always known for empty slots). */
    childId: PersonId;
    /** Adoptive/step/foster tie to the child below; undefined = biological. */
    relType?: Exclude<ParentChildRelType, 'biological'>;
    /** A repeated person: the Kekulé number of the first occurrence (its parents are not drawn again). */
    repeatOf?: number;
    r1: number;
    r2: number;
    /** Angles, lo < hi (math degrees). */
    lo: number;
    hi: number;
}

/** A descendant or a partner band of the two-way fan. */
export interface FanDescSector {
    /** Stable key ('d…' descendant, 'p…' partner band). */
    key: string;
    kind: 'desc' | 'partner';
    /** 1 = children of the focus (and the focus's partner bands). */
    depth: number;
    /** Null = an unknown partner. */
    person: Person | null;
    /** Descendant: the parent above; partner band: the person whose partner it is. */
    parentId: PersonId;
    /** A repeated person: the key of the first occurrence ('f' = the focus); not expanded again. */
    repeatOfKey?: string;
    r1: number;
    r2: number;
    lo: number;
    hi: number;
}

export interface FanModel {
    data: StromData;
    focus: Person;
    shape: FanShape;
    /** Rings requested (config), >= 1. */
    generations: number;
    /** Descendant depth requested (two-way only; 0 otherwise). */
    descGenerations: number;
    /** Sectors of all rings, including empty slots directly above known, unrepeated people. */
    sectors: FanSector[];
    /** Descendants and partner bands (two-way). */
    desc: FanDescSector[];
    /** Highest ring that contains at least one known ancestor (0 = none). */
    maxKnownGen: number;
    /** Deepest descendant depth drawn (0 = none). */
    descDepth: number;
    /** Outer radius of the requested ancestor rings. */
    R: number;
    /** Outer radius of the deepest drawn descendant band (FOCUS_R when none). */
    Rd: number;
    /** The whole drawing (viewBox at zoom 1), with a margin. */
    bounds: FanBounds;
}

export interface FanModelOptions {
    /** Ancestor rings, 1–10 (the view offers 3–10). */
    generations: number;
    shape?: FanShape;
    /** Descendant depth for the two-way shape, 1–5. */
    descGenerations?: number;
}

/**
 * Split a person's parents into a father slot and a mother slot. Prefers
 * gender (a parent of unknown sex takes the slot the other leaves free);
 * falls back to declaration order when genders don't disambiguate.
 */
function fatherMotherOf(data: StromData, person: Person): [Person | null, Person | null] {
    const parents = person.parentIds
        .map(id => data.persons[id])
        .filter((p): p is Person => !!p)
        .slice(0, 2);
    return parentSlots(parents);
}

function ancestorSectors(data: StromData, focus: Person, gens: number, shape: FanShape): { sectors: FanSector[]; maxKnownGen: number } {
    const start = shape === 'full' ? 270 : 180;
    const total = shape === 'full' ? 360 : 180;
    const slots = new Map<number, Person | null>([[1, focus]]);
    const repeated = new Set<number>();
    const first = new Map<PersonId, number>([[focus.id, 1]]);
    const sectors: FanSector[] = [];
    let maxKnownGen = 0;
    const end = 2 ** (gens + 1);
    for (let i = 2; i < end; i++) {
        const child = slots.get(i >> 1);
        if (!child || repeated.has(i >> 1)) continue; // nothing to attach to, or a repeat that is not expanded
        const [father, mother] = fatherMotherOf(data, child);
        const p = i % 2 === 0 ? father : mother;
        slots.set(i, p);
        const g = Math.floor(Math.log2(i));
        const idx = i - 2 ** g;
        const span = total / 2 ** g;
        const hi = start - idx * span;
        const [r1, r2] = ancestorRingRadii(g);
        const rt = p ? child.parentRelTypes?.[p.id] : undefined;
        const s: FanSector = {
            key: `a${i}`, ahnentafel: i, generation: g, indexInGen: idx, person: p, childId: child.id,
            ...(rt && rt !== 'biological' ? { relType: rt } : {}),
            r1, r2, lo: hi - span, hi,
        };
        if (p) {
            const f = first.get(p.id);
            if (f != null) { s.repeatOf = f; repeated.add(i); } else first.set(p.id, i);
            maxKnownGen = Math.max(maxKnownGen, g);
        }
        sectors.push(s);
    }
    return { sectors, maxKnownGen };
}

interface DescUnion {
    partner: Person | null;
    partnerKey: string;
    partnerRepeatOf?: string;
    children: DescNode[];
    weight: number;
}

interface DescNode {
    person: Person;
    key: string;
    repeatOfKey?: string;
    unions: DescUnion[];
    weight: number;
}

/**
 * A person's families for the descendant fan: unions in marriage order (the
 * wedding date or its latest possible date, then the data order;
 * compareMarriages), each with its children by birth; an
 * unknown partner (none recorded, a "?" stand-in) collects the stand-in
 * families and the children outside any union, in one band.
 */
function familiesOf(data: StromData, p: Person): Array<{ partner: Person | null; childIds: PersonId[] }> {
    const used = new Set<PersonId>();
    const byBirth = (ids: PersonId[]) => ids
        .map((id, index) => ({ id, index, key: dateSortKey(data.persons[id]?.birthDate) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
        .map(e => e.id);
    const take = (ids: readonly PersonId[]) => {
        const out: PersonId[] = [];
        for (const id of ids) {
            if (!data.persons[id] || used.has(id) || id === p.id) continue;
            used.add(id);
            out.push(id);
        }
        return out;
    };
    const unions = p.partnerships
        .map((id, index) => ({ u: data.partnerships[id], index }))
        .filter(e => !!e.u)
        .sort((a, b) => compareMarriages(marriageDates(data, a.u, a.index), marriageDates(data, b.u, b.index)));
    const out: Array<{ partner: Person | null; childIds: PersonId[] }> = [];
    let unknown: { partner: null; childIds: PersonId[] } | null = null;
    for (const { u } of unions) {
        const partnerId = u.person1Id === p.id ? u.person2Id : u.person1Id;
        const partner = data.persons[partnerId];
        const kids = take(u.childIds ?? []);
        if (!partner || partner.isPlaceholder || isDiagramStandIn(data, partnerId)) {
            if (!unknown) { unknown = { partner: null, childIds: [] }; out.push(unknown); }
            unknown.childIds.push(...kids);
        } else {
            out.push({ partner, childIds: kids });
        }
    }
    const loose = take(p.childIds ?? []);
    if (loose.length) {
        if (!unknown) { unknown = { partner: null, childIds: [] }; out.push(unknown); }
        unknown.childIds.push(...loose);
    }
    for (const f of out) f.childIds = byBirth(f.childIds);
    return out.filter(f => f.partner || f.childIds.length);
}

function descendantTree(data: StromData, focus: Person, maxDepth: number): DescNode {
    const first = new Map<PersonId, string>([[focus.id, 'f']]);
    let n = 0;
    const build = (person: Person, depth: number, key: string, repeatOfKey?: string): DescNode => {
        const node: DescNode = { person, key, unions: [], weight: 1, ...(repeatOfKey ? { repeatOfKey } : {}) };
        if (repeatOfKey || depth >= maxDepth) return node;
        for (const fam of familiesOf(data, person)) {
            if (depth > 0 && fam.childIds.length === 0) continue; // a childless union shows only around the focus
            const partnerKey = `p${n++}`;
            const u: DescUnion = { partner: fam.partner, partnerKey, children: [], weight: 1 };
            if (fam.partner) {
                const f = first.get(fam.partner.id);
                if (f) u.partnerRepeatOf = f; else first.set(fam.partner.id, partnerKey);
            }
            for (const cid of fam.childIds) {
                const c = data.persons[cid];
                const ckey = `d${n++}`;
                const f = first.get(cid);
                if (!f) first.set(cid, ckey);
                u.children.push(build(c, depth + 1, ckey, f));
            }
            u.weight = u.children.length ? u.children.reduce((a, c) => a + c.weight, 0) : 1;
            node.unions.push(u);
        }
        if (node.unions.length) node.weight = node.unions.reduce((a, u) => a + u.weight, 0);
        return node;
    };
    return build(focus, 0, 'f');
}

function descendantSectors(data: StromData, focus: Person, maxDepth: number): { desc: FanDescSector[]; depth: number; Rd: number } {
    const root = descendantTree(data, focus, maxDepth);
    const desc: FanDescSector[] = [];
    let depth = 0;
    let Rd = FOCUS_R;
    const place = (node: DescNode, d: number, a0: number, a1: number) => {
        if (!node.unions.length) return;
        const total = node.weight;
        const { partner: [pr1, pr2], ring: [cr1, cr2] } = descendantRingRadii(d + 1);
        let a = a0;
        for (const u of node.unions) {
            const span = (a1 - a0) * u.weight / total;
            const b = a + span;
            desc.push({
                key: u.partnerKey, kind: 'partner', depth: d + 1, person: u.partner, parentId: node.person.id,
                ...(u.partnerRepeatOf ? { repeatOfKey: u.partnerRepeatOf } : {}),
                r1: pr1, r2: pr2, lo: a, hi: b,
            });
            Rd = Math.max(Rd, pr2);
            let ca = a;
            for (const c of u.children) {
                const cs = span * c.weight / u.weight;
                desc.push({
                    key: c.key, kind: 'desc', depth: d + 1, person: c.person, parentId: node.person.id,
                    ...(c.repeatOfKey ? { repeatOfKey: c.repeatOfKey } : {}),
                    r1: cr1, r2: cr2, lo: ca, hi: ca + cs,
                });
                depth = Math.max(depth, d + 1);
                Rd = Math.max(Rd, cr2);
                place(c, d + 1, ca, ca + cs);
                ca += cs;
            }
            a = b;
        }
    };
    place(root, 0, 180, 360);
    return { desc, depth, Rd };
}

function shapeBounds(shape: FanShape, R: number, Rd: number): FanBounds {
    let x0: number, x1: number, y0: number, y1: number;
    if (shape === 'full') { x0 = -R; x1 = R; y0 = -R; y1 = R; }
    else if (shape === 'two') { const m = Math.max(R, Rd); x0 = -m; x1 = m; y0 = -R; y1 = Math.max(Rd, FOCUS_R); }
    else { x0 = -R; x1 = R; y0 = -R; y1 = FOCUS_R; }
    return { x: x0 - BOUNDS_PAD, y: y0 - BOUNDS_PAD, w: x1 - x0 + 2 * BOUNDS_PAD, h: y1 - y0 + 2 * BOUNDS_PAD };
}

/**
 * Build the fan model. `opts` may be a bare number of generations (half
 * circle, the old call).
 */
export function buildFanModel(data: StromData, focusId: PersonId, opts: number | FanModelOptions): FanModel | null {
    const focus = data.persons[focusId];
    if (!focus) return null;
    const o: FanModelOptions = typeof opts === 'number' ? { generations: opts } : opts;
    const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) => {
        const n = Math.floor(v ?? dflt);
        return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
    };
    const gens = clamp(o.generations, 1, FAN_MAX_GENERATIONS, FAN_DEFAULT_GENERATIONS);
    const shape: FanShape = o.shape && FAN_SHAPES.includes(o.shape) ? o.shape : 'half';
    const descGenerations = shape === 'two'
        ? clamp(o.descGenerations, FAN_MIN_DESC_GENERATIONS, FAN_MAX_DESC_GENERATIONS, FAN_DEFAULT_DESC_GENERATIONS)
        : 0;
    const { sectors, maxKnownGen } = ancestorSectors(data, focus, gens, shape);
    const d = shape === 'two' ? descendantSectors(data, focus, descGenerations) : { desc: [], depth: 0, Rd: FOCUS_R };
    const R = ancestorRingRadii(gens)[1];
    return {
        data, focus, shape, generations: gens, descGenerations, sectors, desc: d.desc, maxKnownGen,
        descDepth: d.depth, R, Rd: d.Rd, bounds: shapeBounds(shape, R, d.Rd),
    };
}

// ==================== SVG RENDERING ====================

export interface FanSvgOptions {
    /** Escape function for text content (renderer supplies its own). */
    esc: (text: string) => string;
    /** Show the "+" slots of unknown parents (hidden in view mode, on posters and pages). */
    editable: boolean;
    /** Title of an empty slot. */
    addParentLabel: string;
    /** K9: draw the Kekulé (ahnentafel) number in each ancestor sector. */
    showKekule?: boolean;
    /**
     * Fixed colours of one theme (`theme`, default light) inside the SVG —
     * posters, saved pages. Otherwise the drawing carries both themes and
     * follows the page's `data-theme`.
     */
    embedStyles?: boolean;
    /** Theme of the embedded colours (with `embedStyles`). */
    theme?: FanTheme;
    /** Label for a non-biological tie (tooltip suffix), e.g. "Adoptive". */
    relTypeLabel?: (type: Exclude<ParentChildRelType, 'biological'>) => string;
    /** Screen pixels per fan unit (labels are fitted for it); default 1. */
    ppu?: number;
    /** The visible part (fan units): the viewBox; labels only for sectors in it (+ a ring's margin). Default: the whole fan. */
    viewport?: FanBounds;
    colorMode?: FanColorMode;
    /** A living person whose name and dates stay hidden ("Living person"). */
    protect?: (person: Person) => boolean;
    /** A link per person (saved pages): the sector becomes an `<a>`. */
    linkFor?: (personId: PersonId) => string | null;
    /** Font sizes (default: screen sizes, desktop minimum). */
    sizes?: FanLabelSizes;
    measure?: FanMeasure;
    /** Id of the SVG (prefix of its pattern and rail ids); unique per page. */
    uid?: string;
    /** The tree's family lines (rod colours); built from the model's data when missing. */
    rodIndex?: LineageIndex;
    /** Sector keys to outline (e.g. a first occurrence). */
    marks?: Iterable<string>;
    /** An extra row in the focus disc and its tooltip (the way back after re-centring). */
    focusBack?: { row: string; title: string };
    /** False: shapes and titles only (during a gesture). */
    labels?: boolean;
}

const fmt = (n: number) => n.toFixed(2);
const rad = (d: number) => (d * Math.PI) / 180;
const SANS = "'Instrument Sans', -apple-system, 'Segoe UI', sans-serif";

function pt(r: number, a: number): [number, number] {
    return [r * Math.cos(rad(a)), -r * Math.sin(rad(a))];
}

/** The path of a ring sector [r1, r2] × [lo, hi] (a full ring in two halves). */
export function fanWedgePath(r1: number, r2: number, lo: number, hi: number): string {
    if (hi - lo >= 359.99) return fanWedgePath(r1, r2, lo, lo + 180) + fanWedgePath(r1, r2, lo + 180, hi);
    const L = hi - lo > 180 ? 1 : 0;
    const [x1, y1] = pt(r1, hi), [x2, y2] = pt(r2, hi), [x3, y3] = pt(r2, lo), [x4, y4] = pt(r1, lo);
    return `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}A${fmt(r2)} ${fmt(r2)} 0 ${L} 1 ${fmt(x3)} ${fmt(y3)}`
        + `L${fmt(x4)} ${fmt(y4)}A${fmt(r1)} ${fmt(r1)} 0 ${L} 0 ${fmt(x1)} ${fmt(y1)}Z`;
}

let uidCounter = 0;
const lineagesByData = new WeakMap<StromData, LineageIndex>();

/** The tree's family lines (cached per data object): the rod colours and the legend's rows. */
export function fanLineages(data: StromData): LineageIndex {
    return lineagesOf(data);
}

function lineagesOf(data: StromData): LineageIndex {
    let index = lineagesByData.get(data);
    if (!index) { index = buildLineages(data); lineagesByData.set(data, index); }
    return index;
}

/** Theme rules of the drawing's classes under `scope`. */
function themeRules(scope: string, T: FanPalette, fills: readonly string[], editable: boolean): string {
    let css = `${scope} .fan-fill{stroke:${T.bg}}`
        + `${scope} .fan-name{fill:${T.text}}`
        + `${scope} .fan-years,${scope} .fan-kekule{fill:${T.text}}`
        + (editable ? `${scope} .fan-plus{fill:${T.textLight}}${scope} .fan-empty-edge{stroke:${T.line}}` : '')
        + `${scope} .fan-nonbio-edge{stroke:${T.textLight}}`
        + `${scope} .fan-hatch-line{stroke:${T.hatch}}`
        + `${scope} .fan-focus-disc{fill:${T.surface};stroke:${T.primary}}`
        + `${scope} .fan-mark{stroke:${T.primary}}`
        + `${scope} .fan-back{fill:${T.primary}}`;
    fills.forEach((c, i) => { css += `${scope} .fc${i}{fill:${c}}`; });
    return css;
}

/** Sector title: "#241 · Marie Trnkopalová (1781–1840)" + the tie, the repeat or the partner note. */
function sectorTitle(p: Person | null, o: {
    ahnentafel?: number; protect: boolean; extra: string[];
}): string {
    const num = o.ahnentafel != null ? `#${o.ahnentafel} · ` : '';
    if (!p) return num + o.extra.join(' · ');
    let core: string;
    if (o.protect) core = strings.fan.living;
    else {
        const y = fanYears(p);
        core = `${shownNameFull(p)}${y ? ` (${y})` : ''}`;
    }
    return [num + core, ...o.extra].join(' · ');
}

/**
 * Build the fan SVG. Each sector is a `<g class="fan-sector …">` with
 * `data-fan-key`, `data-fan-kind` (anc / desc / partner), `data-fan-person`,
 * ancestors `data-fan-ahnentafel`, repeats `data-fan-repeat-of`, empty slots
 * `data-fan-add` (+ `data-fan-add-gender`); the focus disc is
 * `<g class="fan-focus" data-fan-kind="focus">`. Every sector has a title.
 */
export function buildFanSvg(model: FanModel, opts: FanSvgOptions): string {
    const { esc } = opts;
    const ppu = opts.ppu && opts.ppu > 0 ? opts.ppu : 1;
    const mode: FanColorMode = opts.colorMode ?? 'gender';
    const sizes = opts.sizes ?? fanScreenSizes(false);
    const measure = opts.measure ?? defaultFanMeasure;
    const uid = opts.uid ?? `fan${++uidCounter}`;
    const view = opts.viewport ?? model.bounds;
    const withLabels = opts.labels !== false;
    const protect = (p: Person | null) => !!p && !!opts.protect && opts.protect(p);
    const embedded = !!opts.embedStyles;
    const embedTheme: FanTheme = opts.theme ?? 'light';
    const rc: FanRodColors | null = mode === 'rod' ? fanRodColors(opts.rodIndex ?? lineagesOf(model.data)) : null;
    const marks = new Set(opts.marks ?? []);

    // Fill classes: one per distinct colour pair (light/dark) or embedded colour.
    const fillClass = new Map<string, number>();
    const fillsA: string[] = [];
    const fillsB: string[] = [];
    const fillOf = (s: Parameters<typeof fanFill>[0]): string => {
        const a = fanFill(s, mode, embedded ? embedTheme : 'light', rc);
        const b = embedded ? a : fanFill(s, mode, 'dark', rc);
        const k = `${a}${b}`;
        let i = fillClass.get(k);
        if (i == null) { i = fillsA.length; fillClass.set(k, i); fillsA.push(a); fillsB.push(b); }
        return `fc${i}`;
    };

    const defs: string[] = [];
    const hw = 5 / ppu;
    defs.push(`<pattern id="${uid}h" width="${fmt(hw)}" height="${fmt(hw)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
        + `<line class="fan-hatch-line" x1="0" y1="0" x2="0" y2="${fmt(hw)}" stroke-width="${fmt(1.3 / ppu)}" stroke-opacity="0.3"/></pattern>`);
    const body: string[] = [];
    const over: string[] = [];
    const vx0 = view.x, vy0 = view.y, vx1 = view.x + view.w, vy1 = view.y + view.h;
    const inView = (s: { r1: number; r2: number; lo: number; hi: number }) => {
        const [mx, my] = pt((s.r1 + s.r2) / 2, (s.lo + s.hi) / 2);
        const marg = (s.r2 - s.r1) + rad(s.hi - s.lo) * s.r2 / 2;
        return !(mx < vx0 - marg || mx > vx1 + marg || my < vy0 - marg || my > vy1 + marg);
    };
    const labelOpts = { uid, defs, esc };
    const STROKE = 'stroke-width="1" vector-effect="non-scaling-stroke"';

    const wrap = (personId: PersonId | null, g: string) => {
        const href = personId && opts.linkFor ? opts.linkFor(personId) : null;
        return href ? `<a href="${esc(href)}">${g}</a>` : g;
    };
    const kekuleSvg = (s: FanSector): { svg: string; box: (b: FanLabelBox) => FanLabelBox } => {
        const none = { svg: '', box: (b: FanLabelBox) => b };
        if (!opts.showKekule) return none;
        const ringPx = (s.r2 - s.r1) * ppu;
        if (ringPx < 30 || rad(s.hi - s.lo) * s.r1 * ppu < 12) return none;
        const mid = (s.lo + s.hi) / 2;
        const rk = s.r1 + 8 / ppu;
        const [kx, ky] = pt(rk, mid);
        const rot = fanRadialRotation(mid);
        return {
            svg: `<text class="fan-kekule" x="${fmt(kx)}" y="${fmt(ky + 3 / ppu)}" font-size="${fmt(9 / ppu)}" text-anchor="middle" transform="rotate(${fmt(rot)} ${fmt(kx)} ${fmt(ky)})">${s.ahnentafel}</text>`,
            box: (b: FanLabelBox) => b.curved
                ? { ...b, rc: b.rc + 6 / ppu, cross: b.cross - 12 }
                : { ...b, rc: b.rc + 6 / ppu, len: b.len - 12 },
        };
    };

    // ---- ancestors
    for (const s of model.sectors) {
        const d = fanWedgePath(s.r1, s.r2, s.lo, s.hi);
        if (!s.person) {
            if (!opts.editable) continue;
            let plus = '';
            if (withLabels && inView(s)) {
                const b = fanLabelBox(s, ppu);
                if (Math.min(b.len, b.cross) > 14) {
                    const [px, py] = pt((s.r1 + s.r2) / 2, (s.lo + s.hi) / 2);
                    plus = `<text class="fan-plus" x="${fmt(px)}" y="${fmt(py + 5 / ppu)}" font-size="${fmt(15 / ppu)}" text-anchor="middle">+</text>`;
                }
            }
            // The father's sector (even Kekulé number) adds a man, the mother's a woman.
            body.push(`<g class="fan-sector fan-empty" data-fan-key="${s.key}" data-fan-kind="anc" data-fan-ahnentafel="${s.ahnentafel}"`
                + ` data-fan-add="${esc(s.childId)}" data-fan-add-gender="${s.ahnentafel % 2 === 0 ? 'male' : 'female'}">`
                + `<path class="fan-empty-edge" d="${d}" fill="transparent" stroke-dasharray="4 3" ${STROKE}/>`
                + plus
                + `<title>${esc(`#${s.ahnentafel} · ${opts.addParentLabel}`)}</title></g>`);
            continue;
        }
        const p = s.person;
        const prot = protect(p);
        const fc = fillOf({ kind: 'anc', person: p, generation: s.generation, ahnentafel: s.ahnentafel });
        const nonBio = s.relType ? ' fan-nonbio' : '';
        const rep = s.repeatOf != null;
        const extra: string[] = [];
        if (s.relType && opts.relTypeLabel) extra.push(opts.relTypeLabel(s.relType));
        if (rep) extra.push(strings.fan.repeatsFirstAs(s.repeatOf!));
        let label = '';
        let kek = '';
        if (withLabels && inView(s)) {
            const k = kekuleSvg(s);
            kek = k.svg;
            const fit = fitFanSectorLabel(p, s, ppu, {
                base: fanBaseSize(sizes, 'anc', s.generation), min: sizes.min, yearsDrop: sizes.yearsDrop,
                protect: prot, repeat: rep, measure,
            }, k.box);
            if (fit) label = fanLabelSvg(fit.label, fit.box, ppu, labelOpts);
        }
        if (marks.has(s.key)) over.push(`<path class="fan-mark" d="${d}" fill="none" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        body.push(wrap(p.id, `<g class="fan-sector ${p.gender}${nonBio}${rep ? ' fan-repeat' : ''}" data-fan-key="${s.key}" data-fan-kind="anc"`
            + ` data-fan-ahnentafel="${s.ahnentafel}" data-fan-person="${esc(p.id)}"${rep ? ` data-fan-repeat-of="a${s.repeatOf}"` : ''}>`
            + `<path class="fan-fill ${fc}" d="${d}" ${STROKE}/>`
            + (rep ? `<path class="fan-hatch" d="${d}" fill="url(#${uid}h)" pointer-events="none"/>` : '')
            + (nonBio ? `<path class="fan-nonbio-edge" d="${d}" fill="none" stroke-dasharray="4 3" ${STROKE} pointer-events="none"/>` : '')
            + label + kek
            + `<title>${esc(sectorTitle(p, { ahnentafel: s.ahnentafel, protect: prot, extra }))}</title></g>`));
    }

    // ---- descendants (two-way)
    for (const s of model.desc) {
        const d = fanWedgePath(s.r1, s.r2, s.lo, s.hi);
        const p = s.person;
        const rep = s.repeatOfKey != null;
        if (marks.has(s.key)) over.push(`<path class="fan-mark" d="${d}" fill="none" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        if (s.kind === 'partner' && !p) {
            let label = '';
            if (withLabels && inView(s)) {
                const box = fanLabelBox(s, ppu);
                const fs = Math.max(sizes.min, Math.min(10, box.cross / 1.1));
                if (box.curved && box.cross >= sizes.min && measure(strings.fan.unknownPartner, fs, false) <= box.len) {
                    label = fanLabelSvg({ rows: [{ text: strings.fan.unknownPartner, fs, bold: false }], level: 4 }, box, ppu, labelOpts);
                }
            }
            body.push(`<g class="fan-sector unknown fan-partner fan-unknown-partner" data-fan-key="${s.key}" data-fan-kind="partner">`
                + `<path class="fan-fill ${fillOf({ kind: 'partner', person: null })}" d="${d}" ${STROKE}/>`
                + `<path class="fan-hatch" d="${d}" fill="url(#${uid}h)" pointer-events="none"/>`
                + label
                + `<title>${esc(strings.fan.unknownPartner)}</title></g>`);
            continue;
        }
        if (!p) continue;
        const prot = protect(p);
        const fc = fillOf({ kind: s.kind, person: p });
        const extra: string[] = [];
        if (s.kind === 'partner') extra.push(strings.fan.partner);
        if (rep) extra.push(strings.fan.repeatsShownBefore);
        let label = '';
        if (withLabels && inView(s)) {
            const box = fanLabelBox(s, ppu);
            if (s.kind === 'partner') {
                // A thin band: one light row along the arc, the name or the surname.
                if (box.curved && box.cross >= sizes.min) {
                    const fs = Math.max(sizes.min, Math.min(10, box.cross / 1.1));
                    const lab = fitFanLabel(p, { ...box, cross: fs * 1.18 }, { base: fs, min: fs, protect: prot, repeat: rep, measure });
                    if (lab && lab.level >= 4) {
                        label = fanLabelSvg({ rows: lab.rows.slice(0, 1).map(r => ({ ...r, bold: false })), level: lab.level }, box, ppu, labelOpts);
                    }
                }
            } else {
                const fit = fitFanSectorLabel(p, s, ppu, {
                    base: fanBaseSize(sizes, 'desc', s.depth), min: sizes.min, yearsDrop: sizes.yearsDrop,
                    protect: prot, repeat: rep, measure,
                });
                if (fit) label = fanLabelSvg(fit.label, fit.box, ppu, labelOpts);
            }
        }
        const kindCls = s.kind === 'partner' ? ' fan-partner' : ' fan-desc';
        body.push(wrap(p.id, `<g class="fan-sector ${p.gender}${kindCls}${rep ? ' fan-repeat' : ''}" data-fan-key="${s.key}" data-fan-kind="${s.kind}"`
            + ` data-fan-person="${esc(p.id)}"${rep ? ` data-fan-repeat-of="${s.repeatOfKey}"` : ''}>`
            + `<path class="fan-fill ${fc}" d="${d}" ${STROKE}/>`
            + (rep ? `<path class="fan-hatch" d="${d}" fill="url(#${uid}h)" pointer-events="none"/>` : '')
            + label
            + `<title>${esc(sectorTitle(p, { protect: prot, extra }))}</title></g>`));
    }

    // ---- focus disc
    const f = model.focus;
    const fprot = protect(f);
    let flabel = '';
    if (withLabels) {
        const back = opts.focusBack;
        const box: FanLabelBox = {
            curved: false, anchor: 0, aspan: 0, upper: false, mid: 0, rc: 0,
            len: FOCUS_R * 1.7 * ppu - 6, cross: FOCUS_R * 1.25 * ppu - (back ? 14 : 0),
        };
        const fit = fitFanLabel(f, box, { base: sizes.focus, min: sizes.min, yearsDrop: sizes.yearsDrop, protect: fprot, measure });
        // A cut surname or the initials name the focus worse than the given name below;
        // the given name with the surname's initial stays (1101).
        const lab = fit && (fit.level < 7 || fprot || !f.firstName) ? fit : null;
        const rows: Array<{ text: string; fs: number; bold: boolean; cls?: string }> = lab
            ? lab.rows.slice()
            : [{ text: fprot ? strings.fan.living : (f.firstName || shownNameFull(f)), fs: sizes.min, bold: true }];
        if (back) rows.push({ text: back.row, fs: Math.max(sizes.min, 11), bold: true, cls: 'fan-name fan-back' });
        flabel = fanCenteredRowsSvg(rows, ppu, esc);
    }
    const ftitle = `#1 · ${sectorTitle(f, { protect: fprot, extra: [] })}${opts.focusBack ? ` · ${opts.focusBack.title}` : ''}`;
    body.push(wrap(null, `<g class="fan-focus ${f.gender}" data-fan-key="f" data-fan-kind="focus" data-fan-person="${esc(f.id)}">`
        + `<circle class="fan-focus-disc" cx="0" cy="0" r="${FOCUS_R}" stroke-width="2" vector-effect="non-scaling-stroke"/>`
        + flabel
        + `<title>${esc(ftitle)}</title></g>`));

    // ---- styles
    const scope = `#${uid}`;
    let css: string;
    if (embedded) {
        css = themeRules(scope, FAN_PALETTES[embedTheme], fillsA, opts.editable);
    } else {
        css = themeRules(scope, FAN_PALETTES.light, fillsA, opts.editable)
            + themeRules(`[data-theme="dark"] ${scope}`, FAN_PALETTES.dark, fillsB, opts.editable)
            + `@media print{${themeRules(`[data-theme="dark"] ${scope}`, FAN_PALETTES.print, fillsA, opts.editable)}}`;
    }
    css += `${scope} text{pointer-events:none}`;

    const vb = `${fmt(view.x)} ${fmt(view.y)} ${fmt(view.w)} ${fmt(view.h)}`;
    return `<svg class="fan-svg" id="${uid}" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" data-fan-shape="${model.shape}" role="img" font-family="${SANS}">`
        + `<style>${css}</style><defs>${defs.join('')}</defs>${body.join('')}${over.join('')}</svg>`;
}

// ==================== FAN POSTER ====================

/**
 * Occupancy predicate over the fan poster in PIXEL space (origin at the
 * poster's top-left). Returns true when the given rectangle overlaps drawn
 * content — used by the tiled print to skip genuinely blank sheets. It is
 * conservative: it errs toward keeping a sheet, never toward dropping content.
 */
export type FanOccupancy = (x: number, y: number, w: number, h: number) => boolean;

/** Everything the poster tiler needs about a fan poster. */
export interface FanPosterGeometry {
    /** Total poster width in px. */
    width: number;
    /** Total poster height in px (header, fan, legend, footer). */
    height: number;
    hasContent: FanOccupancy;
}

export interface FanPosterOptions extends FanSvgOptions {
    /** @font-face rules embedded in the poster (Strom Serif, Instrument Sans). */
    fontFaceCss?: string;
    /** Millimetres per poster pixel when printed (label sizes in pt); default 0.26. */
    mmPerPx?: number;
}

/** Distance² from a point to the nearest point of an axis-aligned rectangle. */
function rectPointDistSq(px: number, py: number, x: number, y: number, w: number, h: number): number {
    const nx = Math.max(x, Math.min(px, x + w));
    const ny = Math.max(y, Math.min(py, y + h));
    const dx = nx - px, dy = ny - py;
    return dx * dx + dy * dy;
}

const POSTER_TITLE_FS = 26;
const POSTER_SUB_FS = 14;
const POSTER_LEGEND_FS = 13;
const POSTER_LEGEND_ROW = 22;
const POSTER_GAP = 16;

/**
 * Fan units → poster px: at least 1, more when the outer ring would leave no
 * room for even the smallest print text (at most 3×).
 */
function posterScale(model: FanModel): number {
    const g = model.generations;
    const total = model.shape === 'full' ? 360 : 180;
    const [r1, r2] = ancestorRingRadii(g);
    const arc = rad(total / 2 ** g) * (r1 + r2) / 2;
    return Math.max(1, Math.min(3, 12 / arc));
}

interface PosterLegendItem { text: string; color?: string; color2?: string; hatch?: boolean }

function posterLegendItems(model: FanModel, mode: FanColorMode, rodIndex?: LineageIndex): PosterLegendItem[] {
    const rc = mode === 'rod' ? fanRodColors(rodIndex ?? lineagesOf(model.data)) : null;
    const items: PosterLegendItem[] = fanLegend(model, mode, 'print', rc)
        .map(i => ({ text: i.who ? `${i.label} · ${i.who}` : i.label, color: i.color, color2: i.color2 }));
    if (fanHasRepeats(model)) items.push({ text: strings.fan.legendRepeats, hatch: true });
    return items;
}

interface PosterLayout {
    width: number;
    height: number;
    scale: number;
    header: { x: number; y: number; w: number; h: number };
    fan: { x: number; y: number; w: number; h: number };
    legend: { x: number; y: number; w: number; h: number; rows: Array<Array<{ item: PosterLegendItem; x: number; w: number }>> };
    footer: number;
    title: string;
    subtitle: string;
}

function posterLayout(model: FanModel, mode: FanColorMode, hasFooter: boolean, measure: FanMeasure, rodIndex?: LineageIndex,
    protect?: (p: Person) => boolean): PosterLayout {
    const s = posterScale(model);
    const b = model.bounds;
    const fanW = b.w * s, fanH = b.h * s;
    const S = strings.fan;
    const title = S.posterTitle(protect?.(model.focus) ? S.living : shownName(model.focus), model.shape === 'two');
    const subtitle = [
        S.posterGenerations(model.generations, model.shape === 'two' ? model.descGenerations : null),
        S.posterShape[model.shape],
        S.posterColors[mode],
    ].join(' · ');
    const titleW = Math.max(measure(title, POSTER_TITLE_FS, true), measure(subtitle, POSTER_SUB_FS, false));
    const contentW = Math.max(fanW, Math.min(titleW, 1600));
    const width = contentW + POSTER_PADDING * 2;
    const headerH = POSTER_TITLE_FS * 1.2 + 8 + POSTER_SUB_FS * 1.3;

    // Legend: one row, wrapping when the poster is narrow.
    const items = posterLegendItems(model, mode, rodIndex);
    const rows: PosterLayout['legend']['rows'] = [];
    let row: PosterLayout['legend']['rows'][number] = [];
    let x = 0;
    for (const item of items) {
        const w = 14 + 6 + measure(item.text, POSTER_LEGEND_FS, false) + 18;
        if (row.length && x + w > contentW) { rows.push(row); row = []; x = 0; }
        row.push({ item, x, w });
        x += w;
    }
    if (row.length) rows.push(row);
    const legendH = rows.length * POSTER_LEGEND_ROW;

    const header = { x: POSTER_PADDING, y: POSTER_PADDING, w: Math.min(titleW, contentW), h: headerH };
    const fan = { x: POSTER_PADDING + (contentW - fanW) / 2, y: POSTER_PADDING + headerH + POSTER_GAP, w: fanW, h: fanH };
    const legendW = rows.reduce((m, r) => Math.max(m, r[r.length - 1].x + r[r.length - 1].w), 0);
    const legend = { x: POSTER_PADDING, y: fan.y + fanH + POSTER_GAP, w: legendW, h: legendH, rows };
    const footer = hasFooter ? FOOTER_HEIGHT : 0;
    const height = legend.y + legendH + POSTER_PADDING + footer;
    return { width, height, scale: s, header, fan, legend, footer, title, subtitle };
}

function posterOccupancy(model: FanModel, L: PosterLayout): FanOccupancy {
    const s = L.scale;
    const b = model.bounds;
    const cx = L.fan.x + (0 - b.x) * s;
    const cy = L.fan.y + (0 - b.y) * s;
    const m = 2; // conservative margin, px
    const R = model.R * s + m, Rd = model.Rd * s + m, FR = FOCUS_R * s + m;
    const rects = [L.header, L.legend.h > 0 ? L.legend : null,
        L.footer ? { x: POSTER_PADDING, y: L.height - L.footer, w: 420, h: L.footer } : null]
        .filter((r): r is { x: number; y: number; w: number; h: number } => !!r && r.w > 0 && r.h > 0);
    return (x, y, w, h) => {
        if (rects.some(r => r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y)) return true;
        const d2 = rectPointDistSq(cx, cy, x, y, w, h);
        if (model.shape === 'full') return d2 <= R * R;
        if (d2 <= FR * FR) return true;
        // Upper half: the part of the rectangle above the centre line.
        if (y <= cy + m) {
            const top = rectPointDistSq(cx, cy, x, y, w, Math.min(y + h, cy) - y);
            if (top <= R * R) return true;
        }
        if (model.shape === 'two' && model.desc.length && y + h >= cy - m) {
            const y0 = Math.max(y, cy);
            const bottom = rectPointDistSq(cx, cy, x, y0, w, y + h - y0);
            if (bottom <= Rd * Rd) return true;
        }
        return false;
    };
}

/**
 * Poster-space geometry for a fan chart of the model's shape: total pixel
 * size (header, fan, legend, optional footer) and a content predicate for
 * tile skipping.
 */
export function fanPosterGeometry(model: FanModel, hasFooter: boolean,
    opts?: Pick<FanSvgOptions, 'colorMode' | 'measure' | 'rodIndex' | 'protect'>): FanPosterGeometry {
    const L = posterLayout(model, opts?.colorMode ?? 'gender', hasFooter, opts?.measure ?? defaultFanMeasure, opts?.rodIndex, opts?.protect);
    return { width: L.width, height: L.height, hasContent: posterOccupancy(model, L) };
}

/**
 * The fan as a self-contained poster: white background, print colours and
 * sizes, a title ("Name · ancestors") with what is shown, the legend of the
 * colour mode (and "↻ repeats" with a pedigree collapse), and the shared
 * poster footer (tree name · view label · date).
 */
export function buildFanPosterSvg(model: FanModel, opts: FanPosterOptions, meta: PosterFooterMeta): string {
    const hasFooter = !!(meta.treeName || meta.viewLabel || meta.dateLabel);
    const mode = opts.colorMode ?? 'gender';
    const measure = opts.measure ?? defaultFanMeasure;
    const L = posterLayout(model, mode, hasFooter, measure, opts.rodIndex, opts.protect);
    const { esc } = opts;

    // Never editable (no "+" slots), always self-contained print colours.
    const fan = buildFanSvg(model, {
        // A fixed id: one fan per poster file, and the same view gives the same file.
        uid: 'fanposter', ...opts, editable: false, embedStyles: true, theme: 'print', ppu: L.scale, viewport: model.bounds,
        sizes: opts.sizes ?? fanPrintSizes(opts.mmPerPx ?? 0.26), marks: [], focusBack: undefined, labels: true,
    });
    // Nest the fan with an explicit viewport so its viewBox maps into poster px.
    const nested = fan.replace('<svg class="fan-svg"',
        `<svg class="fan-svg" x="${fmt(L.fan.x)}" y="${fmt(L.fan.y)}" width="${fmt(L.fan.w)}" height="${fmt(L.fan.h)}"`);

    const T = FAN_PALETTES.print;
    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(L.width)}" height="${fmt(L.height)}" viewBox="0 0 ${fmt(L.width)} ${fmt(L.height)}" font-family="${POSTER_FONT}">`);
    if (opts.fontFaceCss) out.push(`<defs><style><![CDATA[\n${opts.fontFaceCss}\n]]></style></defs>`);
    out.push(`<rect x="0" y="0" width="${fmt(L.width)}" height="${fmt(L.height)}" fill="${POSTER_BG}"/>`);
    const ty = L.header.y + POSTER_TITLE_FS;
    out.push(`<text class="fan-poster-title" x="${fmt(L.header.x)}" y="${fmt(ty)}" font-size="${POSTER_TITLE_FS}" font-weight="600" fill="${T.text}">${esc(L.title)}</text>`);
    out.push(`<text class="fan-poster-subtitle" x="${fmt(L.header.x)}" y="${fmt(ty + 8 + POSTER_SUB_FS * 1.1)}" font-size="${POSTER_SUB_FS}" fill="${T.textLight}">${esc(L.subtitle)}</text>`);
    out.push(nested);

    // Legend row(s).
    const lg: string[] = [];
    L.legend.rows.forEach((row, ri) => {
        const y = L.legend.y + ri * POSTER_LEGEND_ROW;
        for (const { item, x } of row) {
            const sx = L.legend.x + x;
            if (item.hatch) {
                lg.push(`<rect x="${fmt(sx)}" y="${fmt(y + 2)}" width="14" height="14" fill="${T.unknown}"/>`);
                lg.push(`<path d="M${fmt(sx)} ${fmt(y + 16)}l14 -14M${fmt(sx)} ${fmt(y + 9)}l7 -7M${fmt(sx + 7)} ${fmt(y + 16)}l7 -7" stroke="${T.hatch}" stroke-opacity="0.3" stroke-width="1.3"/>`);
            } else if (item.color2) {
                lg.push(`<rect x="${fmt(sx)}" y="${fmt(y + 2)}" width="7" height="14" fill="${item.color}"/><rect x="${fmt(sx + 7)}" y="${fmt(y + 2)}" width="7" height="14" fill="${item.color2}"/>`);
            } else {
                lg.push(`<rect x="${fmt(sx)}" y="${fmt(y + 2)}" width="14" height="14" fill="${item.color}"/>`);
            }
            lg.push(`<text x="${fmt(sx + 20)}" y="${fmt(y + 13.5)}" font-size="${POSTER_LEGEND_FS}" fill="${T.text}">${esc(item.text)}</text>`);
        }
    });
    if (lg.length) out.push(`<g class="fan-poster-legend" font-family="${SANS}">${lg.join('')}</g>`);
    if (hasFooter) out.push(posterFooterSvg(meta, L.height));
    out.push('</svg>');
    return out.join('\n');
}
