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
import { LineageIndex, RodId, rodOf, rods, rodLabels } from './lineage.js';
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

/** An OKLCH colour (L 0…1, C, hue in degrees) as sRGB hex, out-of-gamut channels clamped. */
export function oklchToHex(L: number, C: number, hue: number): string {
    const h = (hue * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    const hex = (v: number) => Math.round(gammaEncode(v) * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

/** WCAG relative luminance of a hex colour. */
export function relativeLuminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio of two hex colours. */
export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a), lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------- modes

/** Hues of the four grandparent lines: father's father, father's mother, mother's father, mother's mother. */
const LINE_HUE = [50, 95, 215, 320];
/** Hues of the ten largest family lines, in order of size. */
const ROD_HUE = [55, 145, 245, 320, 92, 195, 15, 275, 120, 345];

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
 * Line mode: the father (ring 1, left) and the mother. Light L .78 instead of
 * the drafted .76, which leaves the text at 6.8:1, under the required 7:1.
 */
function parentLineColor(father: boolean, theme: FanTheme): string {
    return oklchToHex(isDark(theme) ? 0.50 : 0.78, 0.04, father ? 70 : 250);
}

/** Line mode: descendants and their partners (two-way shape). */
function descLineColor(partner: boolean, theme: FanTheme): string {
    if (partner) return isDark(theme) ? oklchToHex(0.36, 0.03, 150) : oklchToHex(0.93, 0.03, 150);
    return isDark(theme) ? oklchToHex(0.42, 0.04, 150) : oklchToHex(0.88, 0.045, 150);
}

/** The fill of a family line among the ten largest (`rank` 0…9); grey otherwise. */
export function fanRodColor(rank: number | null, theme: FanTheme): string {
    if (rank == null || rank < 0 || rank >= ROD_HUE.length) return FAN_PALETTES[theme].grey;
    return isDark(theme) ? oklchToHex(0.45, 0.06, ROD_HUE[rank]) : oklchToHex(0.84, 0.07, ROD_HUE[rank]);
}

/**
 * The ten largest family lines of the whole tree (not small ones), each with
 * its fixed rank: the colour of a line stays when the fan is re-centred.
 */
export interface FanRodColors {
    index: LineageIndex;
    rank: ReadonlyMap<RodId, number>;
}

const rodColorsCache = new WeakMap<LineageIndex, FanRodColors>();

export function fanRodColors(index: LineageIndex): FanRodColors {
    let c = rodColorsCache.get(index);
    if (!c) {
        const rank = new Map<RodId, number>();
        for (const rod of rods(index)) {
            if (rank.size >= ROD_HUE.length) break;
            if (!rod.small) rank.set(rod.id, rank.size);
        }
        c = { index, rank };
        rodColorsCache.set(index, c);
    }
    return c;
}

/** The rank of a person's birth line among the ten largest, or null. */
export function fanRodRank(rc: FanRodColors, personId: PersonId): number | null {
    const id = rodOf(rc.index, personId);
    return id ? rc.rank.get(id) ?? null : null;
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
export function fanFill(s: FanFillSubject, mode: FanColorMode, theme: FanTheme, rc?: FanRodColors | null): string {
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
    if (mode === 'rod') return fanRodColor(rc ? fanRodRank(rc, s.person.id) : null, theme);
    return s.person.gender === 'male' ? T.male : s.person.gender === 'female' ? T.female : T.unknown;
}

// ---------------------------------------------------------------- legend

/** One row of the legend (§6.3). */
export interface FanLegendItem {
    /** Stable key: 'male' / 'female' / 'unknown', 'line0'…'line3', a rod id, 'rodOther'. */
    key: string;
    label: string;
    /** Line mode: the grandparent's name; rod mode: "7×". */
    who?: string;
    /** Swatch (inner ring for lines). */
    color: string;
    /** Line mode: the outer ring's shade, for a two-tone swatch. */
    color2?: string;
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

/** The legend of a colour mode for the drawn fan. Rod mode needs the tree's line colours. */
export function fanLegend(model: FanLegendModel, mode: FanColorMode, theme: FanTheme, rc?: FanRodColors | null): FanLegendItem[] {
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
        const counts = new Map<RodId | null, number>();
        const add = (p: Person | null) => {
            if (!p) return;
            const id = rc ? rodOf(rc.index, p.id) : null;
            const key = id && rc && rc.rank.has(id) ? id : null;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        };
        add(model.focus);
        for (const s of model.sectors) add(s.person);
        for (const s of model.desc) add(s.person);
        const labels = rc ? rodLabels(rc.index) : new Map<RodId, string>();
        const items: FanLegendItem[] = [...counts.entries()]
            .filter((e): e is [RodId, number] => e[0] != null)
            .sort((a, b) => b[1] - a[1] || (rc!.rank.get(a[0])! - rc!.rank.get(b[0])!))
            .map(([id, n]) => ({ key: id, label: labels.get(id) ?? '', who: `${n}×`, color: fanRodColor(rc!.rank.get(id)!, theme) }));
        const rest = counts.get(null) ?? 0;
        if (rest) items.push({ key: 'rodOther', label: S.legendOtherRods, who: `${rest}×`, color: T.grey });
        return items;
    }
    return [
        { key: 'male', label: S.legendMen, color: T.male },
        { key: 'female', label: S.legendWomen, color: T.female },
        { key: 'unknown', label: S.legendSexUnknown, color: T.unknown },
    ];
}
