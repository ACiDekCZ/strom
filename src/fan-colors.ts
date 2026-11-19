/**
 * Fan chart colours (spec 029 §6): the fill of each sector in the three
 * colour modes — by sex, by the four grandparent lines, by family line (rod) —
 * for the light and dark themes and for print, and the legend that explains
 * them. Everything comes out as concrete hex values: the poster, the saved
 * HTML pages and the dark-theme overrides on screen cannot resolve the app's
 * CSS variables.
 *
 * The light/dark fills of the sex mode and the structural colours mirror the
 * `--fan-*` tokens in index.html (a test keeps both in step).
 */

import type { Person, PersonId } from './types.js';
import { rodOf } from './lineage.js';
import { fanRodLegend, type FanRodAssignment } from './fan-rod-assign.js';
import { strings } from './strings.js';
import { shownName } from './person-name.js';

export type FanColorMode = 'gender' | 'line' | 'rod';
export type FanTheme = 'light' | 'dark' | 'print';

export const FAN_COLOR_MODES: readonly FanColorMode[] = ['gender', 'line', 'rod'];

/** The structural colours of a fan drawing in one theme (hex). */
export interface FanPalette {
    /** Background: the 1 px gaps between sectors. */
    bg: string;
    /** Focus disc fill. */
    surface: string;
    text: string;
    textLight: string;
    primary: string;
    male: string;
    female: string;
    unknown: string;
    /** Hatching of a repeated person (implex) and of an unknown partner (30 % opacity). */
    hatch: string;
    /** Dashed outline of an empty slot (edit mode). */
    line: string;
    /** Family lines outside the ten largest, and small ones. */
    grey: string;
}

const LIGHT: FanPalette = {
    bg: '#f6f2ea', surface: '#fffdf8', text: '#2b2822', textLight: '#5c5546', primary: '#3f6b4f',
    male: '#d3dce4', female: '#ead8d4', unknown: '#e2ddd2', hatch: '#2b2822', line: '#b8ae99', grey: '#dcd7cc',
};
const DARK: FanPalette = {
    bg: '#211f1a', surface: '#2c2a24', text: '#e8e3d6', textLight: '#a89f8d', primary: '#6f9c7f',
    male: '#3f4c56', female: '#56443f', unknown: '#3f3b33', hatch: '#ece6d8', line: '#5a5546', grey: '#3a372f',
};

/** Print and poster: the light values on white paper. */
export const FAN_PALETTES: Record<FanTheme, FanPalette> = {
    light: LIGHT,
    dark: DARK,
    print: { ...LIGHT, bg: '#ffffff', surface: '#ffffff' },
};

// ---------------------------------------------------------------- oklch

/** sRGB channel 0…1 from linear light (clamped). */
function gammaEncode(x: number): number {
    const c = Math.max(0, Math.min(1, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** An OKLCH colour as linear sRGB (channels may fall outside 0…1). */
function oklchToLinear(L: number, C: number, hue: number): [number, number, number] {
    const h = (hue * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
}

/** Linear sRGB as hex, channels clamped. */
function linearToHex(rgb: readonly number[]): string {
    return '#' + rgb.map(v => Math.round(gammaEncode(v) * 255).toString(16).padStart(2, '0')).join('');
}

/** An OKLCH colour (L 0…1, C, hue in degrees) as sRGB hex, out-of-gamut channels clamped. */
export function oklchToHex(L: number, C: number, hue: number): string {
    return linearToHex(oklchToLinear(L, C, hue));
}

/** The largest chroma of lightness L and hue h inside sRGB (bisection). */
function maxChroma(L: number, hue: number): number {
    let lo = 0, hi = 0.4;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (oklchToLinear(L, mid, hue).every(v => v >= -1e-4 && v <= 1 + 1e-4)) lo = mid;
        else hi = mid;
    }
    return lo;
}

/** A hex colour as linear sRGB. */
function hexToLinear(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

const oklabCache = new Map<string, [number, number, number]>();

/** OKLab coordinates [L, a, b] of a hex colour (spec 114 §2; exported for the tests). */
export function oklab(hex: string): [number, number, number] {
    let v = oklabCache.get(hex);
    if (!v) {
        const [r, g, b] = hexToLinear(hex);
        const cbrt = (x: number) => Math.sign(x) * Math.abs(x) ** (1 / 3);
        const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        v = [
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
        ];
        oklabCache.set(hex, v);
    }
    return v;
}

/** Distance of two hex colours in OKLab (ΔE OK). */
export function deltaE(a: string, b: string): number {
    const [l1, a1, b1] = oklab(a), [l2, a2, b2] = oklab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Machado 2009, deuteranopia at full severity (linear RGB). */
const DEUTERANOPIA = [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
] as const;

const deutCache = new Map<string, string>();

/** A hex colour as a person with deuteranopia sees it (simulated, as hex). */
export function deuteranopia(hex: string): string {
    let d = deutCache.get(hex);
    if (!d) {
        const v = hexToLinear(hex);
        d = linearToHex(DEUTERANOPIA.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
        deutCache.set(hex, d);
    }
    return d;
}

/** ΔE OK of two colours as seen with deuteranopia. */
export function deltaEDeutan(a: string, b: string): number {
    return deltaE(deuteranopia(a), deuteranopia(b));
}

/**
 * A hex colour mixed toward white by `t` (0…1) in sRGB: what a highlight
 * leaves of the other sectors on paper (spec 114 §7; a hex, not an opacity).
 */
export function fanMixWhite(hex: string, t: number): string {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v: number) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0');
    return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** How far the sectors outside a printed highlight go toward white (spec 114 §7). */
export const FAN_PRINT_DIM = 0.62;
/** The printed highlight's dashed outline: the copper of `--accent-text` (spec 114 §7). */
export const FAN_PRINT_EDGE = '#8a5528';

/** WCAG relative luminance of a hex colour. */
export function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToLinear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours. */
export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a), lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------- modes

/**
 * Hues of the four grandparent lines: father's father (blue), father's mother
 * (blue-green), mother's father (pink), mother's mother (raspberry) — the P2
 * lineage palette of the cards (spec 112 §3), shared with the map.
 */
export const LINE_HUE = [258, 232, 352, 5] as const;
/** P2 hues of the parents' lines and of the descendants (spec 112 §3): paternal blue, maternal pink, descendants ochre. */
export const PARENT_LINE_HUE = { father: 258, mother: 352 } as const;
export const DESCENDANT_LINE_HUE = 82;

const isDark = (theme: FanTheme) => theme === 'dark';

/**
 * The colour of a grandparent line (0…3) in ring `generation` (>= 2): lighter
 * outward in the light theme, darker outward in the dark one.
 */
export function fanLineColor(line: number, generation: number, theme: FanTheme): string {
    const k = Math.max(0, generation - 2);
    const hue = LINE_HUE[Math.max(0, Math.min(3, line))];
    return isDark(theme) ? oklchToHex(0.47 - 0.017 * k, 0.05, hue) : oklchToHex(0.80 + 0.016 * k, 0.05, hue);
}

/**
 * Line mode: the father (ring 1, left) and the mother, in the P2 hues of the
 * paternal and maternal lines. Light L .78 instead of the drafted .76, which
 * leaves the text at 6.8:1, under the required 7:1.
 */
export function parentLineColor(father: boolean, theme: FanTheme): string {
    return oklchToHex(isDark(theme) ? 0.50 : 0.78, 0.04, father ? PARENT_LINE_HUE.father : PARENT_LINE_HUE.mother);
}

/** Line mode: descendants and their partners (two-way shape), in the P2 hue of the descendants. */
export function descLineColor(partner: boolean, theme: FanTheme): string {
    const h = DESCENDANT_LINE_HUE;
    if (partner) return isDark(theme) ? oklchToHex(0.36, 0.03, h) : oklchToHex(0.93, 0.03, h);
    return isDark(theme) ? oklchToHex(0.42, 0.04, h) : oklchToHex(0.88, 0.045, h);
}

// ---------------------------------------------------------------- family lines (spec 114 §2)

/** The side of the fan a family line belongs to: the father's (P), the mother's (M), the descendants (D). */
export type FanRodGroup = 'P' | 'M' | 'D';
/** Strong (S) or muted (T) shades of a group. */
export type FanRodTier = 'S' | 'T';
/** A palette slot: group, tier, index (e.g. 'PS0', the centre's line). */
export type FanRodSlot = `${FanRodGroup}${FanRodTier}${number}`;

export const FAN_ROD_GROUPS: readonly FanRodGroup[] = ['P', 'M', 'D'];

/**
 * The slots of each group in the order they are handed out: hue (OKLCH) and
 * lightness step (−1 / 0 / +1). Hue bands: P 132–290° (green → blue → blue
 * violet), M 302–50° (pink violet → pink → coral → orange), D 65–110° (ochre).
 */
export const FAN_ROD_SLOTS: Readonly<Record<FanRodGroup, Readonly<Record<FanRodTier, ReadonlyArray<readonly [number, -1 | 0 | 1]>>>>> = {
    P: {
        S: [[252, 0], [150, 0], [205, 1], [178, -1], [285, -1], [232, 1]],
        T: [[222, 0], [160, 1], [268, -1], [192, -1], [138, 0]],
    },
    M: {
        S: [[352, 0], [42, 0], [318, 1], [15, -1], [332, -1], [28, 1]],
        T: [[8, 0], [335, 1], [42, -1], [305, -1]],
    },
    D: {
        S: [[85, 0], [105, 1], [68, -1]],
        T: [[97, 1], [74, -1]],
    },
};

/** OKLCH lightness, chroma and lightness step of a tier per theme; `H`: the centre's line (PS0). Print = light. */
const ROD_SPEC = {
    light: { S: [0.815, 0.088, 0.028], T: [0.905, 0.055, 0.025], H: [0.79, 0.10] },
    dark: { S: [0.445, 0.085, 0.025], T: [0.355, 0.045, 0.022], H: [0.48, 0.10] },
} as const;

/** Every slot of the palette, group by group, strong before muted. */
export function fanRodSlots(): FanRodSlot[] {
    const out: FanRodSlot[] = [];
    for (const g of FAN_ROD_GROUPS) {
        for (const t of ['S', 'T'] as const) FAN_ROD_SLOTS[g][t].forEach((_, i) => out.push(`${g}${t}${i}`));
    }
    return out;
}

/** The parts of a slot, or null for anything that is not one of the palette. */
export function parseFanRodSlot(slot: string): { group: FanRodGroup; tier: FanRodTier; index: number } | null {
    const m = /^([PMD])([ST])(\d{1,2})$/.exec(slot);
    if (!m) return null;
    const group = m[1] as FanRodGroup, tier = m[2] as FanRodTier, index = Number(m[3]);
    return index < FAN_ROD_SLOTS[group][tier].length ? { group, tier, index } : null;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** OKLCH [L, C, h] of a slot in a theme (print = light); the chroma kept at 97 % of the sRGB limit. */
export function fanRodSlotOklch(slot: FanRodSlot, theme: FanTheme): [number, number, number] {
    const s = parseFanRodSlot(slot);
    if (!s) throw new Error(`not a fan rod slot: ${slot}`);
    const spec = ROD_SPEC[isDark(theme) ? 'dark' : 'light'];
    const [hue, step] = FAN_ROD_SLOTS[s.group][s.tier][s.index];
    let L: number, C: number;
    if (slot === 'PS0') [L, C] = spec.H;
    else { const [L0, C0, dL] = spec[s.tier]; L = L0 + dL * step; C = C0; }
    const h = ((hue % 360) + 360) % 360;
    return [round3(L), round3(Math.min(C, maxChroma(L, h) * 0.97)), h];
}

const slotHexCache = new Map<string, string>();

/** The fill of a palette slot (hex); print takes the light values. */
export function fanRodSlotColor(slot: FanRodSlot, theme: FanTheme): string {
    const th = isDark(theme) ? 'dark' : 'light';
    const key = slot + th;
    let hex = slotHexCache.get(key);
    if (!hex) {
        hex = oklchToHex(...fanRodSlotOklch(slot, theme));
        slotHexCache.set(key, hex);
    }
    return hex;
}

/** The fill of a family line: its slot's colour, grey without one. */
export function fanRodFill(slot: FanRodSlot | null | undefined, theme: FanTheme): string {
    return slot ? fanRodSlotColor(slot, theme) : FAN_PALETTES[theme].grey;
}

/** What the colour of a sector depends on. */
export interface FanFillSubject {
    kind: 'anc' | 'desc' | 'partner' | 'focus';
    person: Person | null;
    /** Ancestors: ring (1 = parents) and Kekulé number. */
    generation?: number;
    ahnentafel?: number;
}

/**
 * The fill of a sector. The focus disc is always the surface colour; an
 * unknown person (unknown partner) the "unknown" fill.
 */
export function fanFill(s: FanFillSubject, mode: FanColorMode, theme: FanTheme, rods?: FanRodAssignment | null): string {
    const T = FAN_PALETTES[theme];
    if (s.kind === 'focus') return T.surface;
    if (!s.person) return T.unknown;
    if (mode === 'line') {
        if (s.kind === 'desc') return descLineColor(false, theme);
        if (s.kind === 'partner') return descLineColor(true, theme);
        const g = s.generation ?? 1;
        const ah = s.ahnentafel ?? 2;
        if (g <= 1) return parentLineColor(ah % 2 === 0, theme);
        return fanLineColor((ah >> (g - 2)) - 4, g, theme);
    }
    if (mode === 'rod') {
        const id = rods ? rodOf(rods.index, s.person.id) : null;
        return fanRodFill(id ? rods!.slotOf.get(id) : null, theme);
    }
    return s.person.gender === 'male' ? T.male : s.person.gender === 'female' ? T.female : T.unknown;
}

// ---------------------------------------------------------------- legend

/** One row of the legend (§6.3). */
export interface FanLegendItem {
    /** Stable key: 'male' / 'female' / 'unknown', 'line0'…'line3', a rod id, 'rodOther', 'noRod'. */
    key: string;
    label: string;
    /** Line mode: the grandparent's name; rod mode: "7×". */
    who?: string;
    /** Swatch (inner ring for lines). */
    color: string;
    /** Line mode: the outer ring's shade, for a two-tone swatch. */
    color2?: string;
    /** Rod mode: the people of the line in the fan. */
    count?: number;
    /** Rod mode: the line's palette slot (none: grey). */
    slot?: FanRodSlot;
    /** Rod mode: the centre person's line. */
    focus?: boolean;
}

/** What the legend needs of a fan model (kept structural: fan-chart imports this file). */
export interface FanLegendModel {
    focus: Person;
    generations: number;
    sectors: ReadonlyArray<{ ahnentafel: number; person: Person | null; repeatOf?: number }>;
    desc: ReadonlyArray<{ person: Person | null; repeatOfKey?: string }>;
}

/** Whether the drawn fan shows a repeated person (implex): the legend adds "↻ repeats". */
export function fanHasRepeats(model: FanLegendModel): boolean {
    return model.sectors.some(s => s.repeatOf != null) || model.desc.some(s => s.repeatOfKey != null);
}

/** The legend of a colour mode for the drawn fan. Rod mode needs the fan's line colours (assignFanRodColors). */
export function fanLegend(model: FanLegendModel, mode: FanColorMode, theme: FanTheme, rods?: FanRodAssignment | null): FanLegendItem[] {
    const S = strings.fan;
    const T = FAN_PALETTES[theme];
    if (mode === 'line') {
        const labels = [S.lineFatherFather, S.lineFatherMother, S.lineMotherFather, S.lineMotherMother];
        const outer = Math.max(2, model.generations);
        return [4, 5, 6, 7].map((ah, i) => {
            const p = model.sectors.find(s => s.ahnentafel === ah)?.person ?? null;
            return { key: `line${i}`, label: labels[i], who: p ? shownName(p) : '–', color: fanLineColor(i, 2, theme), color2: fanLineColor(i, outer, theme) };
        });
    }
    if (mode === 'rod') {
        // A flat list of the sides' lines and one row of the grey ones (spec 114 §4 groups them in the view).
        if (!rods) return [];
        const legend = fanRodLegend(rods, theme);
        const items = legend.groups.flatMap(g => g.items);
        if (legend.otherRods) items.push({ key: 'rodOther', label: S.legendOther(legend.otherRods), who: `${legend.otherPeople}×`, color: T.grey });
        else if (legend.noRod) items.push({ key: 'noRod', label: S.legendNoRod, who: `${legend.noRod}×`, color: T.grey });
        return items;
    }
    return [
        { key: 'male', label: S.legendMen, color: T.male },
        { key: 'female', label: S.legendWomen, color: T.female },
        { key: 'unknown', label: S.legendSexUnknown, color: T.unknown },
    ];
}
