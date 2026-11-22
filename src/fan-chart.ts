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

import { StromData, Person, PersonId, ParentChildRelType } from './types.js';
import { parentSlots } from './model-values.js';
import { dateSortKey } from './dates.js';
import { imageAddrAttr } from './image-ref.js';
import { shownName, shownNameFull } from './person-name.js';
import { strings } from './strings.js';
import { compareMarriages, marriageDates } from './marriage-order.js';
import { isDiagramStandIn } from './layout/pipeline/placeholders.js';
import { LineageIndex, RodId, buildLineages, rodOf, rodLabels } from './lineage.js';
import {
    posterFooterSvg, posterFooterHeight, PosterFooterMeta, POSTER_PADDING, POSTER_FONT, POSTER_BG,
} from './export-image.js';
import {
    FanColorMode, FanTheme, FanPalette, FanStyle, FanPatternId, FAN_PATTERNS, fanPalette, fanFillLook, fanLegend, fanHasRepeats,
    fanMixWhite, FAN_PRINT_DIM, FAN_PRINT_EDGE, FanRodGroup, fanRodOtherSwatch, fanPatternMarks, fanStyleFont,
} from './fan-colors.js';
import { assignFanRodColors, fanRodLegend, FanRodAssignment } from './fan-rod-assign.js';
import {
    FanLabelSizes, FanMeasure, fanScreenSizes, fanPrintSizes, fanBaseSize, defaultFanMeasure, fanLabelBox, fitFanLabel, fitFanSectorLabel,
    fanLabelSvg, fanCenteredRowsSvg, fanFocusFallbackRows, fanRadialRotation, fanYears, FanLabelBox, FanContent,
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

/**
 * A person's portrait in the fan (spec 118 §6): the photo (`href`, a square
 * data URL, or a pooled image's reference: the placeholder with
 * `data-pool-ref`, which image-src.ts fills on screen), or a photo on its
 * way — the initials on grey under a veil, or the stored photo under it
 * while a newer one comes (spec 116).
 */
export type FanPortrait = { href: string; loading?: false } | { loading: true; initials: string; href?: string };

/** Ancestor rings with portraits (parents and grandparents), besides the focus disc. */
export const FAN_PORTRAIT_RINGS = 2;
/** A portrait smaller than this (screen px, poster px ≈ 7 mm) is not drawn: the text comes first. */
export const FAN_PORTRAIT_MIN_PX = 26;
/** The largest portrait in a sector, fan units. */
const PORTRAIT_MAX_U = 46;
/** Between a sector's portrait and its text, px. */
const PORTRAIT_GAP_PX = 4;
/** The focus disc's portrait: radius and centre (above the middle) as parts of FOCUS_R. */
const FOCUS_PHOTO_R = 0.36;
const FOCUS_PHOTO_Y = -0.38;
/** The focus disc's text under its portrait: the centre of its rows, as a part of FOCUS_R. */
const FOCUS_TEXT_Y = 0.36;

/**
 * The people a fan may show a portrait of (spec 118 §6): the focus and the
 * ancestors of the rings 1–2 (never the descendants of the two-way fan),
 * each once, without the protected living. Their photos are the caller's.
 */
export function fanPortraitPeople(model: FanModel, protect?: (p: Person) => boolean): Person[] {
    const seen = new Set<PersonId>();
    const out: Person[] = [];
    for (const p of [model.focus, ...model.sectors.filter(s => s.generation <= FAN_PORTRAIT_RINGS).map(s => s.person)]) {
        if (!p || seen.has(p.id) || protect?.(p)) continue;
        seen.add(p.id);
        out.push(p);
    }
    return out;
}

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
    /**
     * The window's print of a highlighted group (spec 114 §7): the dimmed sectors
     * printed as lighter fills. Only the fan window highlights; the person page's
     * fan never does and keeps its styles as they were.
     */
    printHighlight?: boolean;
    colorMode?: FanColorMode;
    /**
     * The style (spec 118 §4): its palettes in every theme, the black-and-white
     * patterns, the antique serif face. Default: colour (the screen's palettes).
     */
    style?: FanStyle;
    /** A living person whose name and dates stay hidden ("Living person"). */
    protect?: (person: Person) => boolean;
    /**
     * What the sectors and the focus disc write besides the names (spec 118
     * §5): years (default, the ladder as always), dates with places where they
     * fit, or names alone (one pixel larger).
     */
    content?: FanContent;
    /**
     * Portraits (spec 118 §6) in the focus disc and the rings 1–2: a person's
     * photo, or null (the sector stays as it is). Missing: no portraits. Never
     * asked for a protected person.
     */
    portrait?: (person: Person) => FanPortrait | null;
    /** A link per person (saved pages): the sector becomes an `<a>`. */
    linkFor?: (personId: PersonId) => string | null;
    /** Font sizes (default: screen sizes, desktop minimum). */
    sizes?: FanLabelSizes;
    measure?: FanMeasure;
    /** Id of the SVG (prefix of its pattern and rail ids); unique per page. */
    uid?: string;
    /** The tree's family lines (rod colours); built from the model's data when missing. */
    rodIndex?: LineageIndex;
    /**
     * The family lines' colours as the window assigned them (spec 114 §3):
     * the drawing, the poster and print take them as they are. Missing: the
     * fan's own assignment, without memory.
     */
    rodColors?: FanRodAssignment;
    /**
     * A highlighted family line printed as it is seen (spec 114 §7; drawings
     * with `embedStyles` only — the screen marks its sectors by class): its
     * sectors outlined in a layer over all of them, the others' fills mixed
     * toward white and their names lighter. Ignored when none of `hit` is drawn.
     */
    highlight?: FanHighlight;
    /** Sector keys to outline (e.g. a first occurrence). */
    marks?: Iterable<string>;
    /** An extra row in the focus disc and its tooltip (the way back after re-centring). */
    focusBack?: { row: string; title: string };
    /** False: shapes and titles only (during a gesture). */
    labels?: boolean;
    /**
     * "Hide others" of a selection of ancestors (spec 098 §11b): the sectors
     * of people not in this set drawn as empty dashed outlines in their
     * places (no name, years, fill or "+", not clickable, hidden from
     * assistive technology); the geometry and the focus disc as always.
     */
    keepOnly?: ReadonlySet<PersonId>;
}

/** A family line highlighted in a printed fan: its id and its people (the faint spouses print as the others). */
export interface FanHighlight {
    rodId: RodId;
    hit: ReadonlySet<PersonId>;
}

/** The highlight when any of its people is drawn in the model, else null. */
export function fanDrawnHighlight(model: FanModel, h: FanHighlight | null | undefined): FanHighlight | null {
    if (!h || !h.hit.size) return null;
    if (h.hit.has(model.focus.id)) return h;
    const drawn = (p: Person | null) => !!p && h.hit.has(p.id);
    return model.sectors.some(s => drawn(s.person)) || model.desc.some(s => drawn(s.person)) ? h : null;
}

const fmt = (n: number) => n.toFixed(2);
const rad = (d: number) => (d * Math.PI) / 180;
const SANS = "'Instrument Sans', -apple-system, 'Segoe UI', sans-serif";
const SERIF = "'Strom Serif', Georgia, serif";
/** The face of a style's names (and of its poster legend). */
const fontOf = (style: FanStyle) => (fanStyleFont(style) === 'serif' ? SERIF : SANS);

/** A pattern of the black-and-white style in a drawing's `<defs>` (cell in px / ppu; the ink is the text colour). */
function fanPatternDef(id: string, pat: FanPatternId, ppu: number): string {
    const n = FAN_PATTERNS[pat].cell / ppu;
    return `<pattern id="${id}" width="${fmt(n)}" height="${fmt(n)}" patternUnits="userSpaceOnUse">${fanPatternMarks(pat, 1 / ppu)}</pattern>`;
}

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

/** The family lines' colours of a drawing: the window's, or the fan's own (deterministic). */
function fanRodColorsOf(model: FanModel, opts: Pick<FanSvgOptions, 'rodColors' | 'rodIndex' | 'style'>): FanRodAssignment {
    return opts.rodColors ?? assignFanRodColors(model, opts.rodIndex ?? lineagesOf(model.data), null, { style: opts.style ?? 'color' });
}
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

/**
 * Theme rules of the drawing's classes under `scope`. `halo` (black and white,
 * px in fan units): the names drawn over a pattern get an outline in their
 * sector's fill, so they stay legible.
 */
function themeRules(scope: string, T: FanPalette, fills: readonly string[], editable: boolean, halo = 0, pats = false, photos = false): string {
    let css = `${scope} .fan-fill{stroke:${T.bg}}`
        + `${scope} .fan-name{fill:${T.text}}`
        + `${scope} .fan-years,${scope} .fan-kekule{fill:${T.text}}`
        + (editable ? `${scope} .fan-plus{fill:${T.textLight}}${scope} .fan-empty-edge{stroke:${T.line}}` : '')
        + `${scope} .fan-nonbio-edge{stroke:${T.textLight}}`
        + `${scope} .fan-hatch-line{stroke:${T.hatch}}`
        + `${scope} .fan-focus-disc{fill:${T.surface};stroke:${T.primary}}`
        + `${scope} .fan-mark{stroke:${T.primary}}`
        + `${scope} .fan-back{fill:${T.primary}}`
        + (photos ? `${scope} .fan-photo-ring{stroke:${T.surface}}${scope} .fan-photo-wait{fill:${T.grey}}`
            + `${scope} .fan-photo-initials{fill:${T.textLight}}${scope} .fan-photo-veil{fill:${T.textLight};fill-opacity:.3}` : '')
        + (pats ? `${scope} .fan-pat-ink{stroke:${T.text};fill:${T.text}}` : '');
    fills.forEach((c, i) => { css += `${scope} .fc${i}{fill:${c}}`; });
    if (halo > 0) {
        fills.forEach((c, i) => {
            css += `${scope} .fc${i}~text{stroke:${c};stroke-width:${fmt(halo)};paint-order:stroke;stroke-linejoin:round}`;
        });
    }
    return css;
}

/**
 * The window's print of a highlighted group (spec 114 §7): the dimmed and the
 * faint sectors at full opacity, their fills mixed toward white (computed
 * hexes) and their names lighter, so paper (even grey) shows the group.
 */
function printHighlightRules(scope: string, fills: readonly string[], style: FanStyle): string {
    const T = fanPalette('print', style);
    const s = `:is(${scope},[data-theme="dark"] ${scope})`;
    const off = ':is(.evidence-dim,.evidence-faint)';
    let css = `${s} :is(.fan-sector,.fan-focus)${off}{opacity:1!important}`
        + `${s} ${off} :is(.fan-name,.fan-years,.fan-kekule){fill:${T.textLight}}`;
    fills.forEach((c, i) => { css += `${s} ${off} .fc${i}{fill:${fanMixWhite(c, FAN_PRINT_DIM)}}`; });
    // The patterns of the black-and-white style fade as their fills do.
    css += `${s} ${off} .fan-pat{opacity:${fmt(1 - FAN_PRINT_DIM)}}`;
    if (style === 'mono') css += `${s} .fan-hl-edge{stroke:${T.text}!important}`;
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
    const style: FanStyle = opts.style ?? 'color';
    const sizes = opts.sizes ?? fanScreenSizes(false);
    const measure = opts.measure ?? defaultFanMeasure;
    const uid = opts.uid ?? `fan${++uidCounter}`;
    const view = opts.viewport ?? model.bounds;
    const withLabels = opts.labels !== false;
    const protect = (p: Person | null) => !!p && !!opts.protect && opts.protect(p);
    const embedded = !!opts.embedStyles;
    const embedTheme: FanTheme = opts.theme ?? 'light';
    const rc: FanRodAssignment | null = mode === 'rod' ? fanRodColorsOf(model, opts) : null;
    const marks = new Set(opts.marks ?? []);
    const content: FanContent = opts.content ?? 'years';
    // Names only: one pixel more for them (spec 118 §5).
    const namesBoost = content === 'names' ? 1 : 0;
    // A printed highlight (spec 114 §7): the line's sectors outlined over all, the rest toward white.
    const hl = embedded ? fanDrawnHighlight(model, opts.highlight) : null;
    const dimmed = (p: Person | null) => !!hl && !(p && hl.hit.has(p.id));
    const hlEdges: string[] = [];
    const hlEdge = (d: string) => {
        if (hl) hlEdges.push(`<path class="fan-hl-edge" d="${d}"/>`);
    };

    // Fill classes: one per distinct colour pair (light/dark) or embedded colour.
    const fillClass = new Map<string, number>();
    const fillsA: string[] = [];
    const fillsB: string[] = [];
    const defs: string[] = [];
    // The black-and-white patterns: one <pattern> per kind drawn (spec 118 §8), a path over the fill.
    const patsUsed = new Set<FanPatternId>();
    const patId = (p: FanPatternId) => `${uid}p-${p}`;
    let patOver = '';
    const fillOf = (s: Parameters<typeof fanFillLook>[0], dim = false): string => {
        const look = fanFillLook(s, mode, embedded ? embedTheme : 'light', rc, style);
        let a = look.fill;
        if (dim) a = fanMixWhite(a, FAN_PRINT_DIM);
        const b = embedded ? a : fanFillLook(s, mode, 'dark', rc, style).fill;
        const k = `${a}${b}`;
        let i = fillClass.get(k);
        if (i == null) { i = fillsA.length; fillClass.set(k, i); fillsA.push(a); fillsB.push(b); }
        patOver = '';
        if (look.pattern) {
            patsUsed.add(look.pattern);
            patOver = `<path class="fan-pat" d="{d}" fill="url(#${patId(look.pattern)})" pointer-events="none"${dim ? ` opacity="${fmt(1 - FAN_PRINT_DIM)}"` : ''}/>`;
        }
        return `fc${i}`;
    };
    /** The pattern path of the fill just asked for (fillOf), over the path `d`. */
    const patOf = (d: string) => patOver.replace('{d}', d);

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
    // "Hide others" (spec 098 §11b): a sector outside the kept people is an empty outline in its place.
    const keepOnly = opts.keepOnly ?? null;
    let offCount = 0;
    const off = (personId: PersonId | null): boolean => !!keepOnly && !(personId && (keepOnly.has(personId) || personId === model.focus.id));
    const offSector = (key: string, d: string): string => {
        offCount++;
        return `<g class="fan-sector fan-sector--off" data-fan-off="${key}" aria-hidden="true" pointer-events="none">`
            + `<path class="fan-empty-edge" d="${d}" fill="none" stroke-dasharray="4 3" ${STROKE}/></g>`;
    };

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

    // ---- portraits (spec 118 §6)
    const photoFilter = style === 'antique' ? 'sepia' : style === 'mono' ? 'grey' : null;
    let photoFilterUsed = false;
    let photoCount = 0;
    /** A round photo (or its wait) centred at (cx, cy), radius r — fan units. */
    const photoSvg = (ph: FanPortrait, cx: number, cy: number, r: number): string => {
        const clip = `${uid}c${photoCount++}`;
        const c = `cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"`;
        defs.push(`<clipPath id="${clip}"><circle ${c}/></clipPath>`);
        let out = '';
        if (ph.href) {
            if (photoFilter) photoFilterUsed = true;
            out += `<image ${imageAddrAttr(ph.href, 'href')} x="${fmt(cx - r)}" y="${fmt(cy - r)}" width="${fmt(2 * r)}" height="${fmt(2 * r)}"`
                + ` preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"${photoFilter ? ` filter="url(#${uid}${photoFilter})"` : ''}/>`;
        } else if (ph.loading) {
            out += `<circle class="fan-photo-wait" ${c}/>`
                + `<text class="fan-photo-initials" x="${fmt(cx)}" y="${fmt(cy + 0.28 * r)}" font-size="${fmt(0.8 * r)}" font-family="${SERIF}"`
                + ` font-weight="600" text-anchor="middle">${esc(ph.initials)}</text>`;
        }
        // One slow veil for every photo on its way, in the window's phase (index.html, spec 116).
        if (ph.loading) out += `<circle class="fan-photo-veil" ${c}/>`;
        out += `<circle class="fan-photo-ring" ${c} fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
        const state = ph.loading ? ` data-img-state="${ph.href ? 'refresh' : 'loading'}"` : '';
        return `<g class="fan-photo"${state} pointer-events="none">${out}</g>`;
    };
    /**
     * The portrait of an ancestor in the rings 1–2: a circle at the sector's
     * inner edge, at the angle of its text, which moves outward past it.
     * Null where there is none or it would be too small.
     */
    const portraitOf = (p: Person, s: FanSector): { box: (b: FanLabelBox) => FanLabelBox; svg: (b: FanLabelBox) => string } | null => {
        if (!opts.portrait || s.generation > FAN_PORTRAIT_RINGS || protect(p)) return null;
        const ph = opts.portrait(p);
        if (!ph) return null;
        const w = s.r2 - s.r1;
        const dU = Math.min(0.5 * w, 0.62 * rad(s.hi - s.lo) * (s.r1 + w / 3), PORTRAIT_MAX_U);
        const dPx = dU * ppu;
        if (dPx < FAN_PORTRAIT_MIN_PX) return null;
        const shift = dPx + PORTRAIT_GAP_PX;
        return {
            box: b => b.curved
                ? { ...b, rc: b.rc + shift / 2 / ppu, cross: b.cross - shift }
                : { ...b, rc: b.rc + shift / 2 / ppu, len: b.len - shift },
            // `b` is the box the portrait made: the photo stands where its room began.
            svg: b => {
                const inner = b.rc * ppu - (b.curved ? b.cross : b.len) / 2 - shift;
                const [cx, cy] = pt((inner + dPx / 2) / ppu, b.anchor);
                return photoSvg(ph, cx, cy, dU / 2);
            },
        };
    };

    // ---- ancestors
    for (const s of model.sectors) {
        const d = fanWedgePath(s.r1, s.r2, s.lo, s.hi);
        if (!s.person) {
            if (!opts.editable) continue;
            // A missing parent of someone hidden: no "+" either.
            if (off(s.childId)) { body.push(offSector(s.key, d)); continue; }
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
        if (off(p.id)) { body.push(offSector(s.key, d)); continue; }
        const prot = protect(p);
        const dim = dimmed(p);
        const fc = fillOf({ kind: 'anc', person: p, generation: s.generation, ahnentafel: s.ahnentafel }, dim);
        if (hl && !dim) hlEdge(d);
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
            const lopts = {
                base: fanBaseSize(sizes, 'anc', s.generation) + namesBoost, min: sizes.min, yearsDrop: sizes.yearsDrop,
                protect: prot, repeat: rep, content, measure,
            };
            // The text comes first: a portrait only while the label stays at step 6 or better.
            const por = portraitOf(p, s);
            let fit = por ? fitFanSectorLabel(p, s, ppu, lopts, b => por.box(k.box(b))) : null;
            if (por && fit && fit.label.level <= 6) label = por.svg(fit.box);
            else fit = fitFanSectorLabel(p, s, ppu, lopts, k.box);
            if (fit) label += fanLabelSvg(fit.label, fit.box, ppu, labelOpts);
        }
        if (marks.has(s.key)) over.push(`<path class="fan-mark" d="${d}" fill="none" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        body.push(wrap(p.id, `<g class="fan-sector ${p.gender}${nonBio}${rep ? ' fan-repeat' : ''}${dim ? ' fan-hl-dim' : ''}" data-fan-key="${s.key}" data-fan-kind="anc"`
            + ` data-fan-ahnentafel="${s.ahnentafel}" data-fan-person="${esc(p.id)}"${rep ? ` data-fan-repeat-of="a${s.repeatOf}"` : ''}>`
            + `<path class="fan-fill ${fc}" d="${d}" ${STROKE}/>` + patOf(d)
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
        if (off(p?.id ?? null)) { body.push(offSector(s.key, d)); continue; }
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
            body.push(`<g class="fan-sector unknown fan-partner fan-unknown-partner${hl ? ' fan-hl-dim' : ''}" data-fan-key="${s.key}" data-fan-kind="partner">`
                + `<path class="fan-fill ${fillOf({ kind: 'partner', person: null }, !!hl)}" d="${d}" ${STROKE}/>` + patOf(d)
                + `<path class="fan-hatch" d="${d}" fill="url(#${uid}h)" pointer-events="none"/>`
                + label
                + `<title>${esc(strings.fan.unknownPartner)}</title></g>`);
            continue;
        }
        if (!p) continue;
        const prot = protect(p);
        const dim = dimmed(p);
        const fc = fillOf({ kind: s.kind, person: p }, dim);
        if (hl && !dim) hlEdge(d);
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
                    base: fanBaseSize(sizes, 'desc', s.depth) + namesBoost, min: sizes.min, yearsDrop: sizes.yearsDrop,
                    protect: prot, repeat: rep, content, measure,
                });
                if (fit) label = fanLabelSvg(fit.label, fit.box, ppu, labelOpts);
            }
        }
        const kindCls = s.kind === 'partner' ? ' fan-partner' : ' fan-desc';
        body.push(wrap(p.id, `<g class="fan-sector ${p.gender}${kindCls}${rep ? ' fan-repeat' : ''}${dim ? ' fan-hl-dim' : ''}" data-fan-key="${s.key}" data-fan-kind="${s.kind}"`
            + ` data-fan-person="${esc(p.id)}"${rep ? ` data-fan-repeat-of="${s.repeatOfKey}"` : ''}>`
            + `<path class="fan-fill ${fc}" d="${d}" ${STROKE}/>` + patOf(d)
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
        const fbox = (len: number, cross: number): FanLabelBox => ({
            curved: false, anchor: 0, aspan: 0, upper: false, mid: 0, rc: 0,
            len: FOCUS_R * len * ppu - 6, cross: FOCUS_R * cross * ppu - (back ? 14 : 0),
        });
        const fopts = { base: sizes.focus + namesBoost, min: sizes.min, yearsDrop: sizes.yearsDrop, protect: fprot, content, measure };
        // The portrait (spec 118 §6) in the disc's upper part, the text below it — while the text
        // keeps step 6 or better; else the disc as without it.
        const fph = opts.portrait && !fprot ? opts.portrait(f) : null;
        const photoR = FOCUS_PHOTO_R * FOCUS_R;
        let photo = '';
        let box = fbox(1.7, 1.25);
        let fit: ReturnType<typeof fitFanLabel> = null;
        if (fph && 2 * photoR * ppu >= FAN_PORTRAIT_MIN_PX) {
            const pbox = fbox(1.55, 0.62);
            const pfit = fitFanLabel(f, pbox, fopts);
            if (pfit && pfit.level <= 6) {
                photo = photoSvg(fph, 0, FOCUS_PHOTO_Y * FOCUS_R, photoR);
                box = pbox;
                fit = pfit;
            }
        }
        if (!photo) fit = fitFanLabel(f, box, fopts);
        // A cut surname or the initials name the focus worse than the given name below;
        // the given name with the surname's initial stays (1101).
        const lab = fit && (fit.level < 7 || fprot || !f.firstName) ? fit : null;
        const rows: Array<{ text: string; fs: number; bold: boolean; cls?: string }> = lab
            ? lab.rows.slice()
            : fanFocusFallbackRows(fprot ? strings.fan.living : (f.firstName || shownNameFull(f)), box, sizes.min, measure);
        if (back) rows.push({ text: back.row, fs: Math.max(sizes.min, 11), bold: true, cls: 'fan-name fan-back' });
        const text = fanCenteredRowsSvg(rows, ppu, esc);
        flabel = photo ? `${photo}<g transform="translate(0 ${fmt(FOCUS_TEXT_Y * FOCUS_R)})">${text}</g>` : text;
    }
    const ftitle = `#1 · ${sectorTitle(f, { protect: fprot, extra: [] })}${opts.focusBack ? ` · ${opts.focusBack.title}` : ''}`;
    const fdim = dimmed(f);
    if (hl && !fdim) hlEdges.push(`<circle class="fan-hl-edge" cx="0" cy="0" r="${FOCUS_R}"/>`);
    body.push(wrap(null, `<g class="fan-focus ${f.gender}${fdim ? ' fan-hl-dim' : ''}" data-fan-key="f" data-fan-kind="focus" data-fan-person="${esc(f.id)}">`
        + `<circle class="fan-focus-disc" cx="0" cy="0" r="${FOCUS_R}" stroke-width="2" vector-effect="non-scaling-stroke"/>`
        + flabel
        + `<title>${esc(ftitle)}</title></g>`));

    for (const p of patsUsed) defs.push(fanPatternDef(patId(p), p, ppu));
    // The photos in the antique style sepia, in black and white grey (spec 118 §6).
    if (photoFilterUsed && photoFilter === 'sepia') {
        defs.push(`<filter id="${uid}sepia" color-interpolation-filters="sRGB"><feColorMatrix type="matrix"`
            + ` values="0.393 0.769 0.189 0 0 0.349 0.686 0.168 0 0 0.272 0.534 0.131 0 0 0 0 0 1 0"/></filter>`);
    } else if (photoFilterUsed && photoFilter === 'grey') {
        defs.push(`<filter id="${uid}grey" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>`);
    }

    // ---- styles
    const scope = `#${uid}`;
    // Black and white: the names over a pattern carry a halo of their sector's fill (3 px).
    const halo = style === 'mono' ? 3 / ppu : 0;
    const pats = patsUsed.size > 0;
    // The photo rules only where a portrait (or its wait) is drawn: a drawing without one stays as it was.
    const photos = photoCount > 0;
    // The empty outlines' colour: editable (the "+" slots) or sectors hidden by "Hide others".
    const edges = opts.editable || offCount > 0;
    let css: string;
    if (embedded) {
        const T = fanPalette(embedTheme, style);
        css = themeRules(scope, T, fillsA, edges, halo, pats, photos);
        if (hl) {
            css += `${scope} .fan-hl-dim :is(.fan-name,.fan-years,.fan-kekule){fill:${T.textLight}}`
                + `${scope} .fan-hl-edge{fill:none;stroke:${style === 'mono' ? T.text : FAN_PRINT_EDGE};stroke-width:${fmt(2.5 / ppu)};`
                + `stroke-dasharray:${fmt(5 / ppu)} ${fmt(3 / ppu)};stroke-linejoin:round}`;
        }
    } else {
        css = themeRules(scope, fanPalette('light', style), fillsA, edges, halo, pats, photos)
            + themeRules(`[data-theme="dark"] ${scope}`, fanPalette('dark', style), fillsB, edges, halo, pats, photos)
            + `@media print{${themeRules(`[data-theme="dark"] ${scope}`, fanPalette('print', style), fillsA, edges, halo, pats, photos)}`
            + (opts.printHighlight ? printHighlightRules(scope, fillsA, style) : '') + '}';
    }
    css += `${scope} text{pointer-events:none}`;

    const vb = `${fmt(view.x)} ${fmt(view.y)} ${fmt(view.w)} ${fmt(view.h)}`;
    return `<svg class="fan-svg" id="${uid}" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" data-fan-shape="${model.shape}" data-fan-style="${style}" role="img" font-family="${fontOf(style)}">`
        + `<style>${css}</style><defs>${defs.join('')}</defs>${body.join('')}${over.join('')}`
        + (hlEdges.length ? `<g class="fan-hl-layer" pointer-events="none">${hlEdges.join('')}</g>` : '') + '</svg>';
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

interface PosterLegendItem {
    text: string;
    color?: string;
    color2?: string;
    /** Black and white: the patterns over the swatch (and its second half). */
    pattern?: FanPatternId;
    pattern2?: FanPatternId;
    hatch?: boolean;
    /** The highlighted family line (spec 114 §7): bold and underlined, as the screen's pressed row. */
    strong?: boolean;
}

/** A part of the poster's legend on rows of its own: a side's lines after its heading, or the rest. */
interface PosterLegendPart {
    head?: string;
    /** The part's rows start after the headings' column. */
    indent: boolean;
    items: PosterLegendItem[];
}

type PosterRodOptions = Pick<FanSvgOptions, 'rodColors' | 'rodIndex' | 'highlight' | 'style'>;

/** Width of the headings' column of the legend (spec 114 §7: 112 px and a 14 px gap). */
const POSTER_LEGEND_HEAD_W = 126;

/**
 * The poster's legend: one part in the sex and line modes; by family lines a
 * part per side with its heading (spec 114 §7), then "Other" (or "no family
 * line") and the repeats on a row of their own. In the main-lines scope
 * (spec 118 §3) "Other lines (N) · M×" in grey stands for the grey lines.
 */
function posterLegendParts(model: FanModel, mode: FanColorMode, opts: PosterRodOptions): PosterLegendPart[] {
    const S = strings.fan;
    const style = opts.style ?? 'color';
    const pats = (i: { pattern?: FanPatternId; pattern2?: FanPatternId }) =>
        ({ ...(i.pattern ? { pattern: i.pattern } : {}), ...(i.pattern2 ? { pattern2: i.pattern2 } : {}) });
    const repeats: PosterLegendItem[] = fanHasRepeats(model) ? [{ text: S.legendRepeats, hatch: true }] : [];
    if (mode !== 'rod') {
        const items: PosterLegendItem[] = fanLegend(model, mode, 'print', null, style)
            .map(i => ({ text: i.who ? `${i.label} · ${i.who}` : i.label, color: i.color, color2: i.color2, ...pats(i) }));
        return [{ indent: false, items: [...items, ...repeats] }];
    }
    const rc = fanRodColorsOf(model, opts);
    const hl = fanDrawnHighlight(model, opts.highlight);
    // A copy of the data (the living hidden) names each line as the copy does.
    const legend = fanRodLegend(rc, 'print', rc.index.data !== model.data ? copyRodLabeler(model, rc.index) : undefined, style);
    const heads: Record<FanRodGroup, string> = { P: S.legendFatherSide, M: S.legendMotherSide, D: S.legendDescendants };
    const parts: PosterLegendPart[] = legend.groups.map(g => ({
        head: heads[g.group], indent: true,
        items: g.items.map(i => ({ text: `${i.label} · ${i.who}`, color: i.color, ...pats(i), ...(hl?.rodId === i.key ? { strong: true } : {}) })),
    }));
    const grey = fanPalette('print', style).grey;
    const rest: PosterLegendItem[] = [];
    if (legend.otherRods) {
        const strong = !!hl && legend.other.some(i => i.key === hl.rodId);
        rest.push(legend.grey
            ? { text: `${S.legendOtherGrey(legend.otherRods)} · ${legend.otherPeople}×`, color: grey, ...(strong ? { strong } : {}) }
            : { text: `${S.legendOther(legend.otherRods)} · ${legend.otherPeople}×`, ...fanRodOtherSwatch(legend.other), ...(strong ? { strong } : {}) });
    } else if (legend.noRod) rest.push({ text: `${S.legendNoRod} · ${legend.noRod}×`, color: grey });
    rest.push(...repeats);
    if (rest.length) parts.push({ indent: parts.length > 0, items: rest });
    return parts;
}

/**
 * The names of the lines of a poster drawn from a copy of the data (the
 * living hidden): each line named as the copy names it (through a drawn
 * member), so a hidden surname never reaches the poster.
 */
function copyRodLabeler(model: FanModel, index: LineageIndex): (id: RodId) => string {
    const own = lineagesOf(model.data);
    const ownLabels = rodLabels(own);
    const drawn = [model.focus, ...model.sectors.map(s => s.person), ...model.desc.map(s => s.person)];
    return (id: RodId): string => {
        for (const p of drawn) {
            if (!p || rodOf(index, p.id) !== id) continue;
            const r = rodOf(own, p.id);
            if (r) return ownLabels.get(r) ?? '–';
        }
        return '–';
    };
}

/** The highlighted line's name for the subtitle: as the drawing's data names it, through a drawn member. */
function highlightLabel(model: FanModel, hl: FanHighlight): string {
    const own = lineagesOf(model.data);
    const drawn = [model.focus, ...model.sectors.map(s => s.person), ...model.desc.map(s => s.person)];
    const p = drawn.find(x => !!x && hl.hit.has(x.id));
    const r = p ? rodOf(own, p.id) : null;
    return (r && rodLabels(own).get(r)) || '–';
}

/** A row of the poster's legend: a part's heading (its first row) and its items placed from the left. */
interface PosterLegendRow {
    head?: string;
    cells: Array<{ item: PosterLegendItem; x: number; w: number }>;
}

interface PosterLayout {
    width: number;
    height: number;
    scale: number;
    header: { x: number; y: number; w: number; h: number };
    fan: { x: number; y: number; w: number; h: number };
    legend: { x: number; y: number; w: number; h: number; rows: PosterLegendRow[] };
    footer: number;
    title: string;
    subtitle: string;
}

function posterLayout(model: FanModel, mode: FanColorMode, meta: PosterFooterMeta, measure: FanMeasure,
    rods: PosterRodOptions, protect?: (p: Person) => boolean): PosterLayout {
    const s = posterScale(model);
    const b = model.bounds;
    const fanW = b.w * s, fanH = b.h * s;
    const S = strings.fan;
    // The family lines' colours once for the subtitle and the legend.
    if (mode === 'rod') rods = { ...rods, rodColors: fanRodColorsOf(model, rods) };
    const title = S.posterTitle(protect?.(model.focus) ? S.living : shownName(model.focus), model.shape === 'two');
    const subtitleParts = [
        S.posterGenerations(model.generations, model.shape === 'two' ? model.descGenerations : null),
        S.posterShape[model.shape],
        mode === 'rod' && rods.rodColors?.main ? S.posterColorsMain : S.posterColors[mode],
    ];
    const hl = fanDrawnHighlight(model, rods.highlight);
    if (hl) subtitleParts.push(S.posterHighlighted(highlightLabel(model, hl)));
    const subtitle = subtitleParts.join(' · ');
    const titleW = Math.max(measure(title, POSTER_TITLE_FS, true), measure(subtitle, POSTER_SUB_FS, false));
    const contentW = Math.max(fanW, Math.min(titleW, 1600));
    const width = contentW + POSTER_PADDING * 2;
    const headerH = POSTER_TITLE_FS * 1.2 + 8 + POSTER_SUB_FS * 1.3;

    // Legend: a part per row (by family lines a side after its heading), wrapping when the poster is narrow.
    const rows: PosterLegendRow[] = [];
    for (const part of posterLegendParts(model, mode, rods)) {
        const x0 = part.indent ? POSTER_LEGEND_HEAD_W : 0;
        let row: PosterLegendRow = { ...(part.head ? { head: part.head } : {}), cells: [] };
        let x = x0;
        for (const item of part.items) {
            const w = 14 + 6 + measure(item.text, POSTER_LEGEND_FS, !!item.strong) + 18;
            if (row.cells.length && x + w > contentW) { rows.push(row); row = { cells: [] }; x = x0; }
            row.cells.push({ item, x, w });
            x += w;
        }
        if (row.cells.length) rows.push(row);
    }
    const legendH = rows.length * POSTER_LEGEND_ROW;

    const header = { x: POSTER_PADDING, y: POSTER_PADDING, w: Math.min(titleW, contentW), h: headerH };
    const fan = { x: POSTER_PADDING + (contentW - fanW) / 2, y: POSTER_PADDING + headerH + POSTER_GAP, w: fanW, h: fanH };
    const legendW = rows.reduce((m, r) => Math.max(m, r.cells[r.cells.length - 1].x + r.cells[r.cells.length - 1].w), 0);
    const legend = { x: POSTER_PADDING, y: fan.y + fanH + POSTER_GAP, w: legendW, h: legendH, rows };
    const footer = posterFooterHeight(meta, width);
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
 * size (header, fan, legend, the footer `meta` gives) and a content predicate
 * for tile skipping.
 */
export function fanPosterGeometry(model: FanModel, meta: PosterFooterMeta,
    opts?: Pick<FanSvgOptions, 'colorMode' | 'measure' | 'rodIndex' | 'rodColors' | 'protect' | 'highlight' | 'style'>): FanPosterGeometry {
    const L = posterLayout(model, opts?.colorMode ?? 'gender', meta, opts?.measure ?? defaultFanMeasure, opts ?? {}, opts?.protect);
    return { width: L.width, height: L.height, hasContent: posterOccupancy(model, L) };
}

/**
 * The fan as a self-contained poster: white background, print colours and
 * sizes, a title ("Name · ancestors") with what is shown, the legend of the
 * colour mode (and "↻ repeats" with a pedigree collapse), and the shared
 * poster footer (tree name · view label · date).
 */
export function buildFanPosterSvg(model: FanModel, opts: FanPosterOptions, meta: PosterFooterMeta): string {
    const mode = opts.colorMode ?? 'gender';
    const style: FanStyle = opts.style ?? 'color';
    const measure = opts.measure ?? defaultFanMeasure;
    // The family lines' colours once for the drawing, the subtitle and the legend.
    if (mode === 'rod' && !opts.rodColors) opts = { ...opts, rodColors: fanRodColorsOf(model, opts) };
    const L = posterLayout(model, mode, meta, measure, opts, opts.protect);
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

    const T = fanPalette('print', style);
    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(L.width)}" height="${fmt(L.height)}" viewBox="0 0 ${fmt(L.width)} ${fmt(L.height)}" font-family="${POSTER_FONT}">`);
    if (opts.fontFaceCss) out.push(`<defs><style><![CDATA[\n${opts.fontFaceCss}\n]]></style></defs>`);
    out.push(`<rect x="0" y="0" width="${fmt(L.width)}" height="${fmt(L.height)}" fill="${POSTER_BG}"/>`);
    const ty = L.header.y + POSTER_TITLE_FS;
    out.push(`<text class="fan-poster-title" x="${fmt(L.header.x)}" y="${fmt(ty)}" font-size="${POSTER_TITLE_FS}" font-weight="600" fill="${T.text}">${esc(L.title)}</text>`);
    out.push(`<text class="fan-poster-subtitle" x="${fmt(L.header.x)}" y="${fmt(ty + 8 + POSTER_SUB_FS * 1.1)}" font-size="${POSTER_SUB_FS}" fill="${T.textLight}">${esc(L.subtitle)}</text>`);
    out.push(nested);

    // Legend row(s); the black-and-white swatches carry their patterns (defined once, in the text's ink).
    const lg: string[] = [];
    const legendPats = new Set<FanPatternId>();
    const patRect = (pat: FanPatternId | undefined, x: number, y: number, w: number) => {
        if (!pat) return;
        legendPats.add(pat);
        lg.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="14" fill="url(#fanposter-lp-${pat})"/>`);
    };
    L.legend.rows.forEach((row, ri) => {
        const y = L.legend.y + ri * POSTER_LEGEND_ROW;
        if (row.head) {
            lg.push(`<text x="${fmt(L.legend.x)}" y="${fmt(y + 13.5)}" font-size="${POSTER_LEGEND_FS}" font-weight="600" fill="${T.textLight}">${esc(row.head)}</text>`);
        }
        for (const { item, x, w } of row.cells) {
            const sx = L.legend.x + x;
            if (item.hatch) {
                lg.push(`<rect x="${fmt(sx)}" y="${fmt(y + 2)}" width="14" height="14" fill="${T.unknown}"/>`);
                lg.push(`<path d="M${fmt(sx)} ${fmt(y + 16)}l14 -14M${fmt(sx)} ${fmt(y + 9)}l7 -7M${fmt(sx + 7)} ${fmt(y + 16)}l7 -7" stroke="${T.hatch}" stroke-opacity="0.3" stroke-width="1.3"/>`);
            } else if (item.color2) {
                lg.push(`<rect x="${fmt(sx)}" y="${fmt(y + 2)}" width="7" height="14" fill="${item.color}"/><rect x="${fmt(sx + 7)}" y="${fmt(y + 2)}" width="7" height="14" fill="${item.color2}"/>`);
                patRect(item.pattern, sx, y + 2, 7);
                patRect(item.pattern2 ?? item.pattern, sx + 7, y + 2, 7);
            } else {
                lg.push(`<rect x="${fmt(sx)}" y="${fmt(y + 2)}" width="14" height="14" fill="${item.color}"/>`);
                patRect(item.pattern, sx, y + 2, 14);
            }
            lg.push(`<text x="${fmt(sx + 20)}" y="${fmt(y + 13.5)}" font-size="${POSTER_LEGEND_FS}"${item.strong ? ' font-weight="600"' : ''} fill="${T.text}">${esc(item.text)}</text>`);
            // The highlighted line: underlined as the screen's pressed row (spec 114 §7).
            if (item.strong) lg.push(`<rect class="fan-poster-strong" x="${fmt(sx)}" y="${fmt(y + 19)}" width="${fmt(w - 18)}" height="2" fill="${T.text}"/>`);
        }
    });
    if (legendPats.size) {
        const defs = [...legendPats].map(p => {
            const n = FAN_PATTERNS[p].cell;
            return `<pattern id="fanposter-lp-${p}" width="${n}" height="${n}" patternUnits="userSpaceOnUse">${fanPatternMarks(p, 1, T.text)}</pattern>`;
        });
        lg.unshift(`<defs>${defs.join('')}</defs>`);
    }
    if (lg.length) out.push(`<g class="fan-poster-legend" font-family="${fontOf(style)}">${lg.join('')}</g>`);
    const footer = posterFooterSvg(meta, L.height, L.width);
    if (footer) out.push(footer);
    out.push('</svg>');
    return out.join('\n');
}
