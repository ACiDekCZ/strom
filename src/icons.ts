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

/** Names of the generic UI glyphs rendered by {@link iconSvg}. */
export type IconName =
    | 'trash' | 'pencil' | 'book' | 'file' | 'folder' | 'info' | 'check'
    | 'star' | 'pin' | 'timer' | 'play' | 'pause' | 'user' | 'lock' | 'chevron-down'
    | 'file-unsaved' | 'file-saved';

/** Stroked 24×24 drawings (same stroke language as the chain/figures glyphs). */
const ICON_PATHS: Record<IconName, string> = {
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'
        + '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    pencil: '<path d="M4 20l4-.8L19 8.2a2 2 0 0 0-2.8-2.8L3.8 16z"/><path d="M14 7l3 3"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M10 2h4"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/>'
        + '<rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    // A document with the editors' "unsaved" dot in its corner — calm, not an error.
    'file-unsaved': '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11"/><path d="M8 13h6M8 17h8"/>'
        + '<circle cx="18.5" cy="5.5" r="3.5" fill="currentColor" stroke="none"/>',
    'file-saved': '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11"/><path d="M8 13h6M8 17h8"/>'
        + '<path d="M15.5 5.5l2 2 4-4"/>',
};

interface IconOptions {
    /** Rendered box size in px (width = height). */
    size?: number;
    /** Stroke width in the 0..24 viewBox coordinate space. */
    strokeWidth?: number;
    /** Extra class on the <svg> element. */
    className?: string;
}

/**
 * A generic monochrome UI glyph (trash, pencil, book, file, info…). Stroke
 * follows `currentColor`, so the caller colours it via CSS; decorative by
 * default (`aria-hidden`) — the host button carries the accessible label.
 */
export function iconSvg(name: IconName, options: IconOptions = {}): string {
    const { size = 14, strokeWidth = 2, className } = options;
    const cls = className ? `ui-icon ${className}` : 'ui-icon';
    return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" `
        + `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" `
        + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`
        + ICON_PATHS[name]
        + `</svg>`;
}
