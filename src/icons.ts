/**
 * Shared inline SVG glyphs. One source of truth per drawing so the same mark
 * renders identically wherever it appears (card edge tab, event participant
 * badge, future forms). No emoji — a stroked SVG scales crisply and inherits
 * theme colour.
 */

interface ChainLinkOptions {
    /** Stroke colour. Use 'currentColor' to follow the element's `color`. */
    stroke?: string;
    /** Rendered box size in px (width = height). */
    size?: number;
    /** Stroke width in the 0..24 viewBox coordinate space. */
    strokeWidth?: number;
}

/**
 * A two-link chain (the classic "link"/"relationship" glyph). Returns an SVG
 * string ready to inline. Defaults follow `currentColor` so the caller controls
 * colour via CSS.
 */
export function chainLinkSvg(options: ChainLinkOptions = {}): string {
    const { stroke = 'currentColor', size = 12, strokeWidth = 2 } = options;
    return `<svg class="chain-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" `
        + `fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" `
        + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
        + `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>`
        + `<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`
        + `</svg>`;
}

interface TwoFiguresOptions {
    /** Draw the second figure with a dashed outline (an excluded/step relative). */
    secondExcluded?: boolean;
    /** Rendered height in px (width follows the 40:24 viewBox aspect). */
    size?: number;
    /** Stroke width in the 0..24 viewBox coordinate space. */
    strokeWidth?: number;
}

/**
 * Two person figures side by side (the "family / relatives" glyph). The second
 * figure switches to a dashed outline when `secondExcluded` — the blood-only
 * state where a partner's side is left out. Stroke follows `currentColor`; no
 * emoji, so it inherits theme colour and rasterises crisply.
 */
export function twoFiguresSvg(options: TwoFiguresOptions = {}): string {
    const { secondExcluded = false, size = 15, strokeWidth = 2 } = options;
    const w = Math.round((size * 40) / 24);
    const dash = secondExcluded ? ' stroke-dasharray="2.4 2.2"' : '';
    return `<svg class="figures-glyph" width="${w}" height="${size}" viewBox="0 0 40 24" `
        + `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" `
        + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
        + `<circle cx="11" cy="8" r="4.2"/><path d="M4 21v-1.5a7 7 0 0 1 14 0V21"/>`
        + `<g${dash}><circle cx="29" cy="8" r="4.2"/><path d="M22 21v-1.5a7 7 0 0 1 14 0V21"/></g>`
        + `</svg>`;
}
