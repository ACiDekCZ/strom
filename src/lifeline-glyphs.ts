/**
 * One definition of a person's own life marks (birth, wedding, child, death,
 * an event by its type): the person card's "Course of life" and the person
 * page's text timeline draw the same glyphs. Inner shapes of a 24×24 viewBox,
 * stroked in currentColor; DOM-free (the saved person page embeds them inline).
 * The glyphs are decorative: aria-hidden, no <title> and no <text>, so they add
 * nothing to an element's textContent.
 */

import type { LifelinePoint } from './timeline.js';

const BIRTH = '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/>';
const DEATH = '<path d="M12 3v18M6 8h12"/>';
const RINGS = '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/>';
const CHILD = '<circle cx="12" cy="7" r="3"/><path d="M7 21c0-3 2.2-5 5-5s5 2 5 5"/>';
// Two rings apart, a bar between them (⚮).
const DIVORCE = '<circle cx="6" cy="13" r="4"/><circle cx="18" cy="13" r="4"/><path d="M12 5v16"/>';
const BURIAL = '<path d="M8 21V9a4 4 0 0 1 8 0v12M5 21h14"/>';
const DOT = '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>';

const EVENT_GLYPHS = new Map<string, string>(Object.entries({
    baptism: '<path d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/>',
    occupation: '<rect x="3" y="8" width="18" height="11" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    residence: '<path d="M4 11l8-6 8 6M6 10v9h12v-9"/>',
    military: '<path d="M12 3l7 3v5c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z"/>',
    emigration: '<path d="M14 5l7 7-7 7M21 12H3"/>',
    immigration: '<path d="M10 5L3 12l7 7M3 12h18"/>',
    education: '<path d="M12 4L2 9l10 5 10-5-10-5zM5 11v5c0 1.5 3 3 7 3s7-1.5 7-3v-5"/>',
    burial: BURIAL,
}));

/** The inner shapes of a point's glyph ('' for a couple's event other than the wedding: no mark). */
function glyphInner(pt: Pick<LifelinePoint, 'kind' | 'eventType' | 'childEvent'>): string {
    switch (pt.kind) {
        case 'birth': return BIRTH;
        case 'death': return DEATH;
        case 'marriage': return RINGS;
        case 'child': return CHILD;
        case 'divorce': return DIVORCE;
        case 'childEvent':
            switch (pt.childEvent) {
                case 'marriage': return RINGS;
                case 'divorce': return DIVORCE;
                case 'burial': return BURIAL;
                default: return DEATH;
            }
        // Only the wedding carries the rings; the couple's other events no mark.
        case 'coupleEvent': return '';
        default: return EVENT_GLYPHS.get(pt.eventType as string) ?? DOT;
    }
}

function glyphSvg(inner: string, size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** A point's decorative glyph (size × size px, 14 on the person card). */
export function lifelineGlyph(pt: Pick<LifelinePoint, 'kind' | 'eventType' | 'childEvent'>, size = 14): string {
    return glyphSvg(glyphInner(pt), size);
}

/**
 * A point's glyph where every row needs a mark (the person page's circle on
 * the line): a couple's event without a glyph of its own gets the dot.
 */
export function lifelineGlyphOrDot(pt: Pick<LifelinePoint, 'kind' | 'eventType' | 'childEvent'>, size = 14): string {
    return glyphSvg(glyphInner(pt) || DOT, size);
}
