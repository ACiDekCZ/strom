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
