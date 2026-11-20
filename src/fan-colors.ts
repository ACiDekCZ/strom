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

/**
 * The fan's styles (spec 118 §4): colour (the screen's palettes, the default),
 * pastel (less ink), antique (sepia and parchment, a serif face) and black and
 * white (greys and patterns). Each has a light, a dark and a print palette and
 * holds in every colour mode.
 */
export type FanStyle = 'color' | 'pastel' | 'antique' | 'mono';
export const FAN_STYLES: readonly FanStyle[] = ['color', 'pastel', 'antique', 'mono'];

/** The type face of a style's names and legend: the antique style is set in Strom Serif. */
export function fanStyleFont(style: FanStyle = 'color'): 'sans' | 'serif' {
    return style === 'antique' ? 'serif' : 'sans';
}

/** The patterns of the black-and-white style (spec 118 §4): lines on the father's side, dots on the mother's, crosses and dashes below. */
export type FanPatternId = 'vl' | 'hl' | 'grid' | 'dot' | 'dot2' | 'ring' | 'plus' | 'dash';

/**
 * One pattern: its cell (px on screen, divided by the drawing's scale), what is
 * drawn in it, the stroke width or radius, the ink's opacity and the angle.
 * No pattern is oblique: the hatching of a repeated person (45°) stays its own.
 */
export interface FanPattern {
    cell: number;
    draw: 'line' | 'grid' | 'dot' | 'ring' | 'plus' | 'dash';
    /** Stroke width (lines, ring, cross, dash). */
    width?: number;
    /** Radius (dot, ring). */
    r?: number;
    /** Arm of the cross, length of the dash. */
    len?: number;
    opacity: number;
    /** Degrees: 0 vertical, 90 horizontal (lines and grid). */
    angle: number;
}

export const FAN_PATTERNS: Readonly<Record<FanPatternId, FanPattern>> = {
    vl: { cell: 6, draw: 'line', width: 0.9, opacity: 0.55, angle: 0 },
    hl: { cell: 6, draw: 'line', width: 0.9, opacity: 0.55, angle: 90 },
    grid: { cell: 7, draw: 'grid', width: 0.7, opacity: 0.45, angle: 0 },
    dot: { cell: 5, draw: 'dot', r: 0.9, opacity: 0.60, angle: 0 },
    dot2: { cell: 8, draw: 'dot', r: 1.5, opacity: 0.50, angle: 0 },
    ring: { cell: 8, draw: 'ring', r: 1.8, width: 0.7, opacity: 0.60, angle: 0 },
    plus: { cell: 8, draw: 'plus', len: 1.6, width: 0.8, opacity: 0.60, angle: 0 },
    dash: { cell: 8, draw: 'dash', len: 4, width: 0.9, opacity: 0.60, angle: 0 },
};

/**
 * The marks of one pattern cell, `unit` px per pattern px (1 / ppu in a fan
 * drawing). The ink is the class `fan-pat-ink` (the drawing's text colour),
 * or a fixed colour when `ink` is given (legend swatches, the poster's legend).
 */
export function fanPatternMarks(id: FanPatternId, unit: number, ink?: string): string {
    const p = FAN_PATTERNS[id];
    const f = (n: number) => (Math.round(n * unit * 1000) / 1000).toString();
    const c = p.cell / 2;
    const paint = ink ? ` stroke="${ink}" fill="${ink}"` : ' class="fan-pat-ink"';
    const line = (x1: number, y1: number, x2: number, y2: number) =>
        `<line${paint} x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke-width="${f(p.width ?? 1)}" stroke-opacity="${p.opacity}"/>`;
    switch (p.draw) {
        case 'line': return p.angle === 90 ? line(0, c, p.cell, c) : line(c, 0, c, p.cell);
        case 'grid': return line(c, 0, c, p.cell) + line(0, c, p.cell, c);
        case 'dot': return `<circle${paint} cx="${f(c)}" cy="${f(c)}" r="${f(p.r ?? 1)}" stroke-width="0" fill-opacity="${p.opacity}"/>`;
        case 'ring': return `<circle${paint} cx="${f(c)}" cy="${f(c)}" r="${f(p.r ?? 1)}" stroke-width="${f(p.width ?? 1)}" stroke-opacity="${p.opacity}" fill-opacity="0"/>`;
        case 'plus': return line(c - (p.len ?? 1), c, c + (p.len ?? 1), c) + line(c, c - (p.len ?? 1), c, c + (p.len ?? 1));
        case 'dash': return line(c - (p.len ?? 4) / 2, c, c + (p.len ?? 4) / 2, c);
    }
}

/** A pattern cell as a standalone SVG in a fixed ink (a legend swatch's CSS background). */
export function fanPatternSvg(id: FanPatternId, ink: string): string {
    const n = FAN_PATTERNS[id].cell;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}">${fanPatternMarks(id, 1, ink)}</svg>`;
}

/** What fills a sector: a colour and, in the black-and-white style, a pattern over it. */
export interface FanFillLook {
    fill: string;
    pattern?: FanPatternId;
}

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
    /** People without a family line (every line has a colour, K1.7). */
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

/** Print and poster: the light values on white paper. The colour style (the default); fanPalette gives every style. */
export const FAN_PALETTES: Record<FanTheme, FanPalette> = {
    light: LIGHT,
    dark: DARK,
    print: { ...LIGHT, bg: '#ffffff', surface: '#ffffff' },
};

type Lch = readonly [number, number, number];
const ok = (c: Lch) => oklchToHex(c[0], c[1], c[2]);

/** The other styles' palettes (spec 118 §4), OKLCH where no hex is given; built once. */
function stylePalettes(style: Exclude<FanStyle, 'color'>): Record<FanTheme, FanPalette> {
    if (style === 'pastel') {
        const light: FanPalette = {
            ...LIGHT, male: ok([0.915, 0.026, 240]), female: ok([0.925, 0.024, 25]), unknown: ok([0.925, 0.010, 85]), grey: ok([0.912, 0.006, 85]),
        };
        const dark: FanPalette = {
            ...DARK, male: ok([0.385, 0.026, 240]), female: ok([0.395, 0.026, 25]), unknown: ok([0.365, 0.010, 85]), grey: ok([0.335, 0.006, 85]),
        };
        return { light, dark, print: { ...light, bg: '#ffffff', surface: '#ffffff' } };
    }
    if (style === 'antique') {
        // Sepia lines between the sectors (an engraving), a parchment disc; the poster's paper stays white.
        const light: FanPalette = {
            bg: ok([0.66, 0.035, 65]), surface: ok([0.965, 0.018, 85]), text: ok([0.28, 0.035, 55]), textLight: ok([0.45, 0.035, 60]),
            primary: ok([0.42, 0.05, 55]), male: ok([0.865, 0.030, 105]), female: ok([0.875, 0.034, 45]), unknown: ok([0.905, 0.016, 80]),
            hatch: ok([0.28, 0.035, 55]), line: ok([0.72, 0.03, 70]), grey: ok([0.905, 0.014, 80]),
        };
        const dark: FanPalette = {
            bg: ok([0.23, 0.02, 60]), surface: ok([0.30, 0.025, 70]), text: ok([0.93, 0.025, 85]), textLight: ok([0.75, 0.03, 80]),
            primary: ok([0.75, 0.05, 70]), male: ok([0.40, 0.030, 105]), female: ok([0.41, 0.034, 45]), unknown: ok([0.37, 0.016, 80]),
            hatch: ok([0.93, 0.025, 85]), line: ok([0.45, 0.03, 70]), grey: ok([0.345, 0.012, 80]),
        };
        return { light, dark, print: { ...light, surface: '#ffffff' } };
    }
    // Black and white: women white with dots (fanFillLook), the text black.
    const grey = (L: number) => ok([L, 0, 0]);
    const light: FanPalette = {
        bg: '#8c8c8c', surface: '#ffffff', text: '#1a1a1a', textLight: '#4d4d4d', primary: '#1a1a1a',
        male: grey(0.87), female: '#ffffff', unknown: grey(0.94), hatch: '#1a1a1a', line: '#9a9a9a', grey: grey(0.92),
    };
    const dark: FanPalette = {
        bg: '#111111', surface: '#2a2a2a', text: '#ededed', textLight: '#bdbdbd', primary: '#ededed',
        male: grey(0.40), female: grey(0.30), unknown: grey(0.35), hatch: '#ededed', line: '#5a5a5a', grey: grey(0.33),
    };
    return { light, dark, print: { ...light } };
}

const paletteCache = new Map<FanStyle, Record<FanTheme, FanPalette>>([['color', FAN_PALETTES]]);

/** The structural colours of a style in a theme (the colour style: FAN_PALETTES). */
export function fanPalette(theme: FanTheme, style: FanStyle = 'color'): FanPalette {
    let p = paletteCache.get(style);
    if (!p) { p = stylePalettes(style as Exclude<FanStyle, 'color'>); paletteCache.set(style, p); }
    return p[theme];
}

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
/** The antique style's hues of the four grandparent lines (olive, sage, brick, earth) and of the parents. */
const ANTIQUE_LINE_HUE = [105, 160, 45, 18] as const;
const ANTIQUE_PARENT_HUE = { father: 105, mother: 45 } as const;
const ANTIQUE_DESC_HUE = 80;
/** Black and white: the grandparent lines' greys (light, dark) and patterns — the father's lines dashed, the mother's dotted. */
const MONO_LINE: ReadonlyArray<readonly [number, number, FanPatternId]> = [[0.85, 0.42, 'vl'], [0.93, 0.32, 'vl'], [0.85, 0.42, 'dot'], [0.93, 0.32, 'dot']];

const isDark = (theme: FanTheme) => theme === 'dark';
const lineIndex = (line: number) => Math.max(0, Math.min(3, line));

/**
 * The colour of a grandparent line (0…3) in ring `generation` (>= 2): lighter
 * outward in the light theme, darker outward in the dark one (the
 * black-and-white style keeps one grey, its pattern tells the line).
 */
export function fanLineColor(line: number, generation: number, theme: FanTheme, style: FanStyle = 'color'): string {
    const k = Math.max(0, generation - 2);
    const i = lineIndex(line);
    const hue = LINE_HUE[i];
    const dark = isDark(theme);
    switch (style) {
        case 'pastel': return dark ? oklchToHex(0.44 - 0.015 * k, 0.030, hue) : oklchToHex(0.865 + 0.010 * k, 0.032, hue);
        case 'antique': return dark ? oklchToHex(0.43 - 0.015 * k, 0.040, ANTIQUE_LINE_HUE[i]) : oklchToHex(0.82 + 0.014 * k, 0.045, ANTIQUE_LINE_HUE[i]);
        case 'mono': return oklchToHex(MONO_LINE[i][dark ? 1 : 0], 0, 0);
        default: return dark ? oklchToHex(0.47 - 0.017 * k, 0.05, hue) : oklchToHex(0.80 + 0.016 * k, 0.05, hue);
    }
}

/** A grandparent line's fill with its pattern (black and white). */
export function fanLineLook(line: number, generation: number, theme: FanTheme, style: FanStyle = 'color'): FanFillLook {
    const fill = fanLineColor(line, generation, theme, style);
    return style === 'mono' ? { fill, pattern: MONO_LINE[lineIndex(line)][2] } : { fill };
}

/**
 * Line mode: the father (ring 1, left) and the mother, in the P2 hues of the
 * paternal and maternal lines. Light L .78 instead of the drafted .76, which
 * leaves the text at 6.8:1, under the required 7:1.
 */
export function parentLineColor(father: boolean, theme: FanTheme, style: FanStyle = 'color'): string {
    const dark = isDark(theme);
    switch (style) {
        case 'pastel': return oklchToHex(dark ? 0.46 : 0.85, 0.028, father ? PARENT_LINE_HUE.father : PARENT_LINE_HUE.mother);
        case 'antique': return oklchToHex(dark ? 0.46 : 0.80, 0.040, father ? ANTIQUE_PARENT_HUE.father : ANTIQUE_PARENT_HUE.mother);
        case 'mono': return oklchToHex(dark ? 0.46 : 0.80, 0, 0);
        default: return oklchToHex(dark ? 0.50 : 0.78, 0.04, father ? PARENT_LINE_HUE.father : PARENT_LINE_HUE.mother);
    }
}

/** A parent's fill with its pattern (black and white: the father's lines, the mother's dots). */
export function parentLineLook(father: boolean, theme: FanTheme, style: FanStyle = 'color'): FanFillLook {
    const fill = parentLineColor(father, theme, style);
    return style === 'mono' ? { fill, pattern: father ? 'vl' : 'dot' } : { fill };
}

/** Line mode: descendants and their partners (two-way shape), in the P2 hue of the descendants. */
export function descLineColor(partner: boolean, theme: FanTheme, style: FanStyle = 'color'): string {
    const h = DESCENDANT_LINE_HUE;
    const dark = isDark(theme);
    switch (style) {
        case 'pastel': return partner ? oklchToHex(dark ? 0.34 : 0.95, 0.02, h) : oklchToHex(dark ? 0.40 : 0.92, 0.03, h);
        case 'antique': return partner ? oklchToHex(dark ? 0.35 : 0.93, 0.025, ANTIQUE_DESC_HUE) : oklchToHex(dark ? 0.41 : 0.885, 0.04, ANTIQUE_DESC_HUE);
        case 'mono': return partner ? oklchToHex(dark ? 0.28 : 0.98, 0, 0) : oklchToHex(dark ? 0.36 : 0.95, 0, 0);
    }
    if (partner) return dark ? oklchToHex(0.36, 0.03, h) : oklchToHex(0.93, 0.03, h);
    return dark ? oklchToHex(0.42, 0.04, h) : oklchToHex(0.88, 0.045, h);
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
 * violet), M 302–50° (pink violet → pink → coral → orange), D 62–112° (ochre).
 * The slots after the design's table (P 6 + 5, M 6 + 4, D 3 + 2) widen it
 * for dense fans where every line is coloured (K1.7); each keeps clear of
 * its group's other slots (ΔE OK ≥ 0.03 light, 0.025 dark).
 * The colour and the pastel style take these hues.
 */
export const FAN_ROD_SLOTS: Readonly<Record<FanRodGroup, Readonly<Record<FanRodTier, ReadonlyArray<readonly [number, -1 | 0 | 1]>>>>> = {
    P: {
        S: [[252, 0], [150, 0], [205, 1], [178, -1], [285, -1], [232, 1], [216, -1], [290, 1]],
        T: [[222, 0], [160, 1], [268, -1], [192, -1], [138, 0], [288, 1], [196, 1], [234, 1], [158, -1]],
    },
    M: {
        S: [[352, 0], [42, 0], [318, 1], [15, -1], [332, -1], [28, 1], [302, -1], [6, 1]],
        T: [[8, 0], [335, 1], [42, -1], [305, -1], [50, 1], [342, -1]],
    },
    D: {
        S: [[85, 0], [105, 1], [68, -1], [112, -1]],
        T: [[97, 1], [74, -1], [112, -1], [62, 1]],
    },
};

/**
 * The antique style's hues of the same slots (spec 118 §4): the father's side
 * olive, sage and slate (96–200°), the mother's brick, earth and umber
 * (22–72°), the descendants ochre and gold (76–98°); the lightness steps are
 * the colour style's.
 */
const ANTIQUE_SLOT_HUE: Readonly<Record<FanRodGroup, Readonly<Record<FanRodTier, readonly number[]>>>> = {
    P: { S: [120, 98, 175, 145, 200, 110, 160, 190], T: [135, 104, 185, 155, 118, 200, 170, 128, 96] },
    M: { S: [38, 62, 26, 52, 32, 72, 22, 58], T: [34, 60, 26, 46, 70, 30] },
    D: { S: [86, 98, 78, 92], T: [90, 80, 98, 76] },
};

/**
 * Black and white (spec 118 §4): the strong slots' greys (L light, L dark) and
 * patterns — the father's side lines, the mother's dots, the descendants
 * crosses and dashes; PS0 (the centre's line) L .78 / .52. The muted slots are
 * three light greys without a pattern, in turn.
 */
const MONO_SLOTS: Readonly<Record<FanRodGroup, ReadonlyArray<readonly [number, number, FanPatternId]>>> = {
    P: [[0.80, 0.50, 'vl'], [0.90, 0.40, 'hl'], [0.86, 0.44, 'grid'], [0.94, 0.36, 'vl'], [0.82, 0.48, 'hl'], [0.95, 0.34, 'grid'], [0.88, 0.42, 'vl'], [0.86, 0.46, 'hl']],
    M: [[0.90, 0.40, 'dot'], [0.82, 0.48, 'ring'], [0.95, 0.34, 'dot2'], [0.86, 0.44, 'dot'], [0.94, 0.36, 'ring'], [0.84, 0.46, 'dot2'], [0.80, 0.50, 'dot'], [0.90, 0.40, 'ring']],
    D: [[0.90, 0.40, 'plus'], [0.84, 0.46, 'dash'], [0.95, 0.34, 'dash'], [0.82, 0.48, 'plus']],
};
const MONO_CENTRE: readonly [number, number] = [0.78, 0.52];
const MONO_MUTED: ReadonlyArray<readonly [number, number]> = [[0.97, 0.30], [0.91, 0.36], [0.85, 0.42]];

type RodSpec = { readonly S: readonly [number, number, number]; readonly T: readonly [number, number, number]; readonly H: readonly [number, number] };

/** OKLCH lightness, chroma and lightness step of a tier per style and theme; `H`: the centre's line (PS0). Print = light. */
const ROD_SPEC: Readonly<Record<Exclude<FanStyle, 'mono'>, { light: RodSpec; dark: RodSpec }>> = {
    color: {
        light: { S: [0.815, 0.088, 0.028], T: [0.905, 0.055, 0.025], H: [0.79, 0.10] },
        dark: { S: [0.445, 0.085, 0.025], T: [0.355, 0.045, 0.022], H: [0.48, 0.10] },
    },
    pastel: {
        light: { S: [0.888, 0.052, 0.030], T: [0.945, 0.030, 0.018], H: [0.870, 0.062] },
        dark: { S: [0.405, 0.052, 0.028], T: [0.335, 0.030, 0.020], H: [0.445, 0.065] },
    },
    antique: {
        light: { S: [0.830, 0.050, 0.040], T: [0.900, 0.030, 0.025], H: [0.800, 0.060] },
        dark: { S: [0.430, 0.050, 0.030], T: [0.355, 0.030, 0.020], H: [0.470, 0.060] },
    },
};

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

/** OKLCH [L, C, h] of a slot in a theme and style (print = light); the chroma kept at 97 % of the sRGB limit. */
export function fanRodSlotOklch(slot: FanRodSlot, theme: FanTheme, style: FanStyle = 'color'): [number, number, number] {
    const s = parseFanRodSlot(slot);
    if (!s) throw new Error(`not a fan rod slot: ${slot}`);
    const dark = isDark(theme);
    if (style === 'mono') {
        const L = slot === 'PS0' ? MONO_CENTRE[dark ? 1 : 0]
            : s.tier === 'S' ? MONO_SLOTS[s.group][s.index][dark ? 1 : 0]
                : MONO_MUTED[s.index % MONO_MUTED.length][dark ? 1 : 0];
        return [L, 0, 0];
    }
    const spec = ROD_SPEC[style][dark ? 'dark' : 'light'];
    const [hue0, step] = FAN_ROD_SLOTS[s.group][s.tier][s.index];
    const hue = style === 'antique' ? ANTIQUE_SLOT_HUE[s.group][s.tier][s.index] : hue0;
    let L: number, C: number;
    if (slot === 'PS0') [L, C] = spec.H;
    else { const [L0, C0, dL] = spec[s.tier]; L = L0 + dL * step; C = C0; }
    const h = ((hue % 360) + 360) % 360;
    return [round3(L), round3(Math.min(C, maxChroma(L, h) * 0.97)), h];
}

const slotHexCache = new Map<string, string>();

/** The fill of a palette slot (hex) in a style; print takes the light values. */
export function fanRodSlotColor(slot: FanRodSlot, theme: FanTheme, style: FanStyle = 'color'): string {
    const th = isDark(theme) ? 'dark' : 'light';
    const key = slot + th + style;
    let hex = slotHexCache.get(key);
    if (!hex) {
        hex = oklchToHex(...fanRodSlotOklch(slot, theme, style));
        slotHexCache.set(key, hex);
    }
    return hex;
}

/** The pattern of a slot: black and white, the strong slots only (the muted are plain greys). */
export function fanRodSlotPattern(slot: FanRodSlot, style: FanStyle = 'color'): FanPatternId | undefined {
    if (style !== 'mono') return undefined;
    const s = parseFanRodSlot(slot);
    if (!s || s.tier !== 'S') return undefined;
    return MONO_SLOTS[s.group][s.index][2];
}

/** Smallest ΔE OK between neighbouring lines (light, dark) and with deuteranopia (both themes). */
export const FAN_ROD_MIN_DE = { light: 0.04, dark: 0.03, deutan: 0.02 } as const;

/**
 * How far apart two slots look in a theme and style, as a share of the
 * thresholds (>= 1: distinct enough). Two different patterns always tell
 * apart; the same pattern or none leaves it to the colours.
 */
export function fanRodSlotDistance(a: FanRodSlot, b: FanRodSlot, theme: 'light' | 'dark', style: FanStyle = 'color'): number {
    const pa = fanRodSlotPattern(a, style), pb = fanRodSlotPattern(b, style);
    if (pa !== pb) return 9;
    const ca = fanRodSlotColor(a, theme, style), cb = fanRodSlotColor(b, theme, style);
    return Math.min(deltaE(ca, cb) / FAN_ROD_MIN_DE[theme], deltaEDeutan(ca, cb) / FAN_ROD_MIN_DE.deutan);
}

/** The fill of a family line: its slot's colour, grey without one. */
export function fanRodFill(slot: FanRodSlot | null | undefined, theme: FanTheme, style: FanStyle = 'color'): string {
    return slot ? fanRodSlotColor(slot, theme, style) : fanPalette(theme, style).grey;
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
 * The fill of a sector and its pattern (black and white). The focus disc is
 * always the surface colour; an unknown person (unknown partner) the
 * "unknown" fill. By family lines in the main-lines scope (spec 118 §2), a
 * line outside the main ones is grey (its slot stays, it is only not shown).
 */
export function fanFillLook(s: FanFillSubject, mode: FanColorMode, theme: FanTheme, rods?: FanRodAssignment | null, style: FanStyle = 'color'): FanFillLook {
    const T = fanPalette(theme, style);
    if (s.kind === 'focus') return { fill: T.surface };
    if (!s.person) return { fill: T.unknown };
    if (mode === 'line') {
        if (s.kind === 'desc') return { fill: descLineColor(false, theme, style) };
        if (s.kind === 'partner') return { fill: descLineColor(true, theme, style) };
        const g = s.generation ?? 1;
        const ah = s.ahnentafel ?? 2;
        if (g <= 1) return parentLineLook(ah % 2 === 0, theme, style);
        return fanLineLook((ah >> (g - 2)) - 4, g, theme, style);
    }
    if (mode === 'rod') {
        const id = rods ? rodOf(rods.index, s.person.id) : null;
        const slot = id && (!rods!.main || rods!.main.has(id)) ? rods!.slotOf.get(id) : null;
        if (!slot) return { fill: T.grey };
        const pattern = fanRodSlotPattern(slot, style);
        return pattern ? { fill: fanRodSlotColor(slot, theme, style), pattern } : { fill: fanRodSlotColor(slot, theme, style) };
    }
    if (s.person.gender === 'male') return { fill: T.male };
    if (s.person.gender === 'female') return style === 'mono' ? { fill: T.female, pattern: 'dot' } : { fill: T.female };
    return { fill: T.unknown };
}

/** The fill of a sector (fanFillLook without the pattern). */
export function fanFill(s: FanFillSubject, mode: FanColorMode, theme: FanTheme, rods?: FanRodAssignment | null, style: FanStyle = 'color'): string {
    return fanFillLook(s, mode, theme, rods, style).fill;
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
    /** Black and white: the pattern over the swatch (and over its second half). */
    pattern?: FanPatternId;
    pattern2?: FanPatternId;
    /** Rod mode: the people of the line in the fan. */
    count?: number;
    /** Rod mode: the line's palette slot (none: grey). */
    slot?: FanRodSlot;
    /** Rod mode: the centre person's line. */
    focus?: boolean;
}

/**
 * The swatch of "Other" in the family-line legend: the colours of its first
 * two lines side by side (K1.7: the smaller lines are coloured, not grey).
 */
export function fanRodOtherSwatch(other: readonly FanLegendItem[]): { color: string; color2: string; pattern?: FanPatternId; pattern2?: FanPatternId } {
    const color = other[0]?.color ?? FAN_PALETTES.light.grey;
    const pattern = other[0]?.pattern;
    const second = other[1] ?? other[0];
    const pattern2 = second?.pattern;
    return { color, color2: second?.color ?? color, ...(pattern ? { pattern } : {}), ...(pattern2 ? { pattern2 } : {}) };
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
export function fanLegend(model: FanLegendModel, mode: FanColorMode, theme: FanTheme, rods?: FanRodAssignment | null, style: FanStyle = 'color'): FanLegendItem[] {
    const S = strings.fan;
    const T = fanPalette(theme, style);
    if (mode === 'line') {
        const labels = [S.lineFatherFather, S.lineFatherMother, S.lineMotherFather, S.lineMotherMother];
        const outer = Math.max(2, model.generations);
        return [4, 5, 6, 7].map((ah, i) => {
            const p = model.sectors.find(s => s.ahnentafel === ah)?.person ?? null;
            const inner = fanLineLook(i, 2, theme, style), out = fanLineLook(i, outer, theme, style);
            return {
                key: `line${i}`, label: labels[i], who: p ? shownName(p) : '–', color: inner.fill, color2: out.fill,
                ...(inner.pattern ? { pattern: inner.pattern } : {}), ...(out.pattern ? { pattern2: out.pattern } : {}),
            };
        });
    }
    if (mode === 'rod') {
        // A flat list of the sides' lines and one row of the smaller ones (spec 114 §4 groups them in the view).
        if (!rods) return [];
        const legend = fanRodLegend(rods, theme, undefined, style);
        const items = legend.groups.flatMap(g => g.items);
        if (legend.otherRods) {
            items.push(legend.grey
                ? { key: 'rodOther', label: S.legendOtherGrey(legend.otherRods), who: `${legend.otherPeople}×`, color: T.grey }
                : { key: 'rodOther', label: S.legendOther(legend.otherRods), who: `${legend.otherPeople}×`, ...fanRodOtherSwatch(legend.other) });
        } else if (legend.noRod) items.push({ key: 'noRod', label: S.legendNoRod, who: `${legend.noRod}×`, color: T.grey });
        return items;
    }
    return [
        { key: 'male', label: S.legendMen, color: T.male },
        { key: 'female', label: S.legendWomen, color: T.female, ...(style === 'mono' ? { pattern: 'dot' as const } : {}) },
        { key: 'unknown', label: S.legendSexUnknown, color: T.unknown },
    ];
}
