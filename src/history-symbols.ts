/**
 * One definition of the history symbols: what happened (the event's kind)
 * drawn by the text, and the "opens in the research" mark. Inner paths of
 * a 24×24 viewBox, stroked in currentColor with round caps and joins (as the
 * timeline's own glyphs); `fill` parts are filled in currentColor without a
 * stroke. The symbols are decorative: aria-hidden, no <title> and no <text>,
 * so they add nothing to an element's textContent; the kind's name rides on
 * the wrapping element's `title` (from strings.history.kinds).
 */

import { HISTORY_KINDS, type HistoryKind } from './history.js';

export const HISTORY_KIND_SVG: Record<HistoryKind, { d: string; fill?: string }> = {
    // Crossed sabres (a person's military service is a closed shield).
    war: { d: 'M5 4l11 11M19 4L8 15M14 17l4-4M6 13l4 4M16 15l3 3M8 15l-3 3' },
    // A germ: a ring, four spikes with knobs, a dot in the middle.
    epidemic: {
        d: 'M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM15.2 8.8L17 7M8.8 8.8L7 7M8.8 15.2L7 17M15.2 15.2L17 17',
        fill: 'M18 4.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM6 4.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM6 16.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM18 16.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM12 10.7a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 1 0 0-2.6z',
    },
    // Tally marks.
    census: { d: 'M5 5v14M9 5v14M13 5v14M17 5v14M3 15.5l18-7' },
    // A flag on its pole.
    state: { d: 'M5 21V3M5 4h12l-2.5 4L17 12H5' },
    // A ship with a sail (a person's emigration keeps the arrow).
    emigration: { d: 'M3 15h18l-2 5H5zM12 15V3M12 4l6 9h-6' },
    // Scales.
    law: { d: 'M12 4v16M8 20h8M5 7h14M5 7l-3 6M5 7l3 6M2 13a3 3 0 0 0 6 0zM19 7l-3 6M19 7l3 6M16 13a3 3 0 0 0 6 0z' },
    // A stack of coins.
    economy: { d: 'M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5' },
    // A lightning bolt (slanted, unlike the death's upright cross).
    disaster: { d: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z' },
    // A small empty ring (a person's "other" is a filled dot).
    other: { d: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z' },
};

/**
 * Optical centring of a kind's symbol in the person page's 24 px circle
 * (`.pp-mk-h`): px at 14 px, positive = down. The flag and the sabres carry
 * their weight high and read as sitting too high in a round frame; the other
 * kinds are centred (or weigh low, the ship) and stay put. Only the circle
 * uses it: the card, the chart and the timeline draw the symbols unshifted.
 */
export const HISTORY_KIND_OPTICAL_DY: Partial<Record<HistoryKind, number>> = { war: 1, state: 1 };

/** A terminal window with the prompt ">_": the action opens the research. */
export const RESEARCH_OPEN_SVG = 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7 9l3 3-3 3M13 15h4';

const cache = new Map<string, string>();

/** The stroke stays at least about 1 px: thicker at 12 px and below. */
function strokeWidth(size: number): string {
    return size < 14 ? '2.2' : '2';
}

function svg(d: string, fill: string | undefined, size: number): string {
    return `<svg class="hist-kind-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
        + ` stroke-width="${strokeWidth(size)}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`
        + `<path d="${d}"/>${fill ? `<path d="${fill}" fill="currentColor" stroke="none"/>` : ''}</svg>`;
}

/** The kind's decorative symbol (aria-hidden, no text); an unknown kind draws "other". */
export function historyKindSvg(kind: HistoryKind, size = 14): string {
    const k: HistoryKind = (HISTORY_KINDS as readonly string[]).includes(kind) ? kind : 'other';
    const key = `${k}:${size}`;
    let out = cache.get(key);
    if (out === undefined) {
        const s = HISTORY_KIND_SVG[k];
        out = svg(s.d, s.fill, size);
        cache.set(key, out);
    }
    return out;
}

/** The "opens in the research" mark (aria-hidden, no text). */
export function researchOpenSvg(size = 14): string {
    const key = `research:${size}`;
    let out = cache.get(key);
    if (out === undefined) {
        out = svg(RESEARCH_OPEN_SVG, undefined, size).replace('class="hist-kind-svg"', 'class="research-open-svg"');
        cache.set(key, out);
    }
    return out;
}
