/**
 * Colours of the ancestors' path on the map (spec 054 §2): one colour and one
 * dash pattern per grandparent line (quarter), a lighter or darker shade of
 * it per great-grandparent line (eighth), the trunk (parents and
 * grandparents) in the text colour, a casing under every line.
 *
 * The page draws with CSS variables (`--line-q0…q3`, `--line-e1/e3/e5/e7`,
 * `--line-casing` in index.html, light and dark), so the theme switch needs no
 * redraw; the OKLCH sources and their hex values live here, and a test keeps
 * both in step. Patterns never depend on colour alone: the pairs that a red-
 * green colour blindness merges (50↔95, 215↔320) differ in lightness AND in
 * the dash pattern, the same in the legend swatches.
 *
 * No DOM: every function returns strings and numbers for the SVG and the
 * legend.
 */

import { LINE_HUE, oklchToHex } from './fan-colors.js';
import type { LineClass } from './map-lines.js';

export type LineTheme = 'light' | 'dark';

/** A colour token of its own: the quarters and the odd eighths (the even eighths reuse their quarter). */
export type LineToken = 'q0' | 'q1' | 'q2' | 'q3' | 'e1' | 'e3' | 'e5' | 'e7';

export const LINE_TOKENS: readonly LineToken[] = ['q0', 'q1', 'q2', 'q3', 'e1', 'e3', 'e5', 'e7'];

/** OKLCH lightness and chroma per token and theme (hue from LINE_HUE by the token's quarter). */
const LC: Record<LineToken, Record<LineTheme, [number, number]>> = {
    q0: { light: [0.52, 0.15], dark: [0.72, 0.15] },
    q1: { light: [0.60, 0.12], dark: [0.86, 0.14] },
    q2: { light: [0.58, 0.10], dark: [0.80, 0.11] },
    q3: { light: [0.46, 0.17], dark: [0.70, 0.16] },
    e1: { light: [0.40, 0.11], dark: [0.62, 0.13] },
    e3: { light: [0.48, 0.10], dark: [0.72, 0.12] },
    e5: { light: [0.45, 0.08], dark: [0.68, 0.10] },
    e7: { light: [0.35, 0.14], dark: [0.62, 0.14] },
};

/** The quarter (0…3) a token belongs to. */
function tokenQuarter(token: LineToken): number {
    return token[0] === 'q' ? Number(token[1]) : Number(token[1]) >> 1;
}

/** The token's OKLCH source: [L, C, hue]. */
export function lineTokenOklch(token: LineToken, theme: LineTheme): [number, number, number] {
    const [L, C] = LC[token][theme];
    return [L, C, LINE_HUE[tokenQuarter(token)]];
}

/** The token's colour as sRGB hex (an out-of-gamut channel clamped, as a browser does). */
export function lineTokenHex(token: LineToken, theme: LineTheme): string {
    const [L, C, h] = lineTokenOklch(token, theme);
    return oklchToHex(L, C, h);
}

/** The casing under every line (`--line-casing`): the line's width + 3 px. */
export const LINE_CASING: Record<LineTheme, string> = {
    light: 'rgba(255,253,248,.95)',
    dark: 'rgba(22,20,16,.92)',
};

/** Stroke widths (px): an ordinary line, a fresh one (born in the last ten years), the trunk; the casing adds CASING_EXTRA. */
export const LINE_WIDTH = { base: 3, fresh: 4, trunk: 4.5 } as const;
export const CASING_EXTRA = 3;

/** Dash patterns of the four quarters at width 3 (the eighths take their quarter's). */
const QUARTER_DASH: readonly (string | null)[] = [null, '9 5', '0.1 6.5', '12 4 2.5 4'];

/** Whose line a class is: the quarter 0…3, or -1 for the trunk. */
export function lineQuarterOf(cls: LineClass): number {
    if (cls === 'trunk') return -1;
    const n = Number(cls.slice(1));
    return cls[0] === 'q' ? n : n >> 1;
}

/** The colour token of a class (null for the trunk, which is `--text`). */
export function lineTokenOf(cls: LineClass): LineToken | null {
    if (cls === 'trunk') return null;
    if (cls[0] === 'q') return cls as LineToken;
    const e = Number(cls.slice(1));
    return e % 2 ? (cls as LineToken) : (`q${e >> 1}` as LineToken);
}

/** The stroke/fill colour of a class as a CSS value; with the line colours off everything is `--primary`. */
export function lineColorVar(cls: LineClass, colors = true): string {
    if (!colors) return 'var(--primary)';
    const token = lineTokenOf(cls);
    return token ? `var(--line-${token})` : 'var(--text)';
}

/** The `stroke-dasharray` of a class, or null for a solid line (the trunk, the first quarter, colours off). */
export function lineDash(cls: LineClass, colors = true): string | null {
    if (!colors) return null;
    const q = lineQuarterOf(cls);
    return q < 0 ? null : QUARTER_DASH[q];
}

/** The `stroke-linecap`: butt for the dashed patterns (their numbers are exact), round for solid and dotted lines. */
export function lineCap(cls: LineClass, colors = true): 'round' | 'butt' {
    const q = colors ? lineQuarterOf(cls) : -1;
    return q === 1 || q === 3 ? 'butt' : 'round';
}

/** The stroke width of a class: the trunk 4.5 always (also without colours), a fresh line 4, else 3. */
export function lineWidth(cls: LineClass, fresh: boolean): number {
    if (cls === 'trunk') return LINE_WIDTH.trunk;
    return fresh ? LINE_WIDTH.fresh : LINE_WIDTH.base;
}

/**
 * Opacity of a path line `age` years after the child's birth: max(0.55,
 * 1 − age/60 · 0.45), so the whole path stays readable at the end. (Without
 * a chosen person the map keeps its own fade, 1.0 → 0.15.)
 */
export function pathLineOpacity(age: number): number {
    return Math.max(0.55, 1 - (Math.max(0, age) / 60) * 0.45);
}

/** The factors of a highlighted (hovered or pinned) line: what is NOT in it fades. */
export const LINE_FOCUS_DIM = { line: 0.15, trunk: 0.3, point: 0.25, row: 0.45 } as const;

/** Everything a path line needs in the SVG. */
export interface LineStyle {
    stroke: string;
    width: number;
    dash: string | null;
    cap: 'round' | 'butt';
    opacity: number;
    casing: string;
    casingWidth: number;
}

/**
 * The style of one path line. `age` = year shown − the child's birth year;
 * fresh = under ten years. `focus` = the highlighted class (hover or pinned
 * line); a line of another class fades (the trunk less).
 */
export function lineStyle(cls: LineClass, opts: { age: number; colors?: boolean; focus?: LineClass | null }): LineStyle {
    const colors = opts.colors ?? true;
    const fresh = opts.age >= 0 && opts.age < 10;
    const width = lineWidth(cls, fresh);
    let opacity = pathLineOpacity(opts.age);
    if (opts.focus && opts.focus !== cls) opacity *= cls === 'trunk' ? LINE_FOCUS_DIM.trunk : LINE_FOCUS_DIM.line;
    return {
        stroke: lineColorVar(cls, colors),
        width,
        dash: lineDash(cls, colors),
        cap: lineCap(cls, colors),
        opacity,
        casing: 'var(--line-casing)',
        casingWidth: width + CASING_EXTRA,
    };
}

// ---------------------------------------------------------------- points

/** The fixed order of the slices of a split point: q0…q3, e0…e7, the trunk last. */
export const LINE_CLASS_ORDER: readonly LineClass[] = [
    'q0', 'q1', 'q2', 'q3', 'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'trunk',
];

/** Distinct classes in the slice order. */
export function sortLineClasses(classes: Iterable<LineClass>): LineClass[] {
    const set = new Set(classes);
    return LINE_CLASS_ORDER.filter(c => set.has(c));
}

/** Point diameters (px): one class, a fresh point (with a halo), a split point. */
export const POINT_SIZE = { base: 13, fresh: 18, split: 17 } as const;

/** The diameter of a point by its classes and freshness. */
export function pointSize(classCount: number, fresh: boolean): number {
    return fresh ? POINT_SIZE.fresh : classCount > 1 ? POINT_SIZE.split : POINT_SIZE.base;
}

/**
 * The fill of a point: the colour of its one class, or a `conic-gradient` of
 * equal slices in LINE_CLASS_ORDER when several lines meet there. Without the
 * line colours it is `--primary`.
 */
export function pointFill(classes: Iterable<LineClass>, colors = true): string {
    if (!colors) return 'var(--primary)';
    const list = sortLineClasses(classes);
    if (list.length === 0) return 'var(--primary)';
    // Two classes of one colour (q0 and e0) still read as one: split by distinct colours.
    const cols = [...new Set(list.map(c => lineColorVar(c)))];
    if (cols.length === 1) return cols[0];
    const pct = (i: number) => `${+(i / cols.length * 100).toFixed(3)}%`;
    return `conic-gradient(${cols.map((c, i) => `${c} ${pct(i)} ${pct(i + 1)}`).join(', ')})`;
}

// ---------------------------------------------------------------- legend

/**
 * The legend swatch of a class as a CSS `background`: the same pattern as
 * the line (solid, dashed, dotted, dash-dot), drawn with gradients. The
 * trunk and colours off are solid.
 */
export function lineSwatch(cls: LineClass, colors = true): string {
    const c = lineColorVar(cls, colors);
    const q = colors ? lineQuarterOf(cls) : -1;
    if (q === 1) return `repeating-linear-gradient(90deg, ${c} 0 9px, transparent 9px 14px)`;
    if (q === 2) return `radial-gradient(circle at 2.5px 50%, ${c} 2.2px, transparent 2.6px) 0 0 / 6.5px 100% repeat-x`;
    if (q === 3) return `repeating-linear-gradient(90deg, ${c} 0 12px, transparent 12px 16px, ${c} 16px 19px, transparent 19px 23px)`;
    return c;
}
