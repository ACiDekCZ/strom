/**
 * The "Custom" card's width: as wide as the longest text of the view needs.
 *
 * Every card of a view has one width (the layout spaces cards by a single
 * size): the longest name row or detail line among the persons drawn, plus
 * the card's 12px side padding and its 1px border, rounded up to 4px, at
 * least 200 and at most 320. Above 320 only the place shortens (ellipsis, the
 * full text in a native tooltip on the place, customCardCutLines); the name and the date always fit,
 * unless a name alone is wider than the widest card.
 *
 * A detail line is a grid: the mark (11px), the date, the place, 6px apart.
 * The date column is as wide as the longest date of the view, so the places
 * of all cards start at one x. The image export draws the same geometry with
 * the same numbers (src/export-image.ts).
 *
 * The arithmetic is pure; the browser part measures the texts in the card's
 * real fonts (one hidden batch, every string cached), so a tree of thousands
 * costs one layout for the strings it has not seen yet.
 */

import type { CardLine } from './card-fields.js';

export const CUSTOM_CARD_MIN_WIDTH = 200;
export const CUSTOM_CARD_MAX_WIDTH = 320;
/** Side padding of the card's content. */
export const CUSTOM_CARD_PAD_X = 12;
/** The card's border on each side (the focused card trims its padding for its 2px). */
export const CUSTOM_CARD_BORDER = 1;
/** The column of the line's mark. */
export const CARD_MARK_WIDTH = 11;
/** Between the grid columns of a line. */
export const CARD_COLUMN_GAP = 6;
/** The avatar and the gap after it on the name row. */
export const CARD_AVATAR_WIDTH = 30;
export const CARD_HEAD_GAP = 8;

/** The card width for the widest content: padding and border added, up to 4px, within 200–320. */
export function customCardWidth(contentWidth: number): number {
    const raw = Math.ceil(Math.max(0, contentWidth)) + 2 * (CUSTOM_CARD_PAD_X + CUSTOM_CARD_BORDER);
    const rounded = Math.ceil(raw / 4) * 4;
    return Math.min(CUSTOM_CARD_MAX_WIDTH, Math.max(CUSTOM_CARD_MIN_WIDTH, rounded));
}

/** The room inside a card of a given width (between its paddings). */
export function customCardContentWidth(cardWidth: number): number {
    return cardWidth - 2 * (CUSTOM_CARD_PAD_X + CUSTOM_CARD_BORDER);
}

/** Where a line's place starts, from the content's left edge. */
export function cardPlaceOffset(dateColumn: number): number {
    return CARD_MARK_WIDTH + CARD_COLUMN_GAP + dateColumn + CARD_COLUMN_GAP;
}

export type CardTextKind = 'name' | 'date' | 'place';

/** Widths of texts in one style; returns a width for every text asked for. */
export type MeasureTexts = (kind: CardTextKind, texts: Iterable<string>) => Map<string, number>;

/** One card of the view: its name, whether it has an avatar, its lines. */
export interface CustomCardEntry {
    name: string;
    avatar: boolean;
    lines: readonly CardLine[];
}

export interface CustomCardMetrics {
    cardWidth: number;
    /** The width of the date column (0 when no line of the view has a date). */
    dateColumn: number;
}

/** The view's card width and date column from its cards' texts. */
export function customCardMetrics(entries: Iterable<CustomCardEntry>, measure: MeasureTexts): CustomCardMetrics {
    const list = [...entries];
    const names = new Set<string>();
    const dates = new Set<string>();
    const places = new Set<string>();
    for (const e of list) {
        names.add(e.name);
        for (const l of e.lines) {
            if (l.date) dates.add(l.date);
            if (l.rest) places.add(l.rest);
            if (l.more) places.add(` ${l.more}`);
        }
    }
    const nameW = measure('name', names);
    const dateW = measure('date', dates);
    const placeW = measure('place', places);
    const w = (m: Map<string, number>, t: string): number => Math.ceil(m.get(t) ?? 0);

    let dateColumn = 0;
    for (const d of dates) dateColumn = Math.max(dateColumn, w(dateW, d));

    let content = 0;
    for (const e of list) {
        content = Math.max(content, (e.avatar ? CARD_AVATAR_WIDTH + CARD_HEAD_GAP : 0) + w(nameW, e.name));
        for (const l of e.lines) {
            const place = (l.rest ? w(placeW, l.rest) : 0) + (l.more ? w(placeW, ` ${l.more}`) : 0);
            const row = l.wide
                ? CARD_MARK_WIDTH + CARD_COLUMN_GAP + place
                : place > 0 ? cardPlaceOffset(dateColumn) + place : CARD_MARK_WIDTH + CARD_COLUMN_GAP + dateColumn;
            content = Math.max(content, row);
        }
    }
    return { cardWidth: customCardWidth(content), dateColumn };
}

/**
 * The lines whose place shortens (an ellipsis) on the cards of a view laid out
 * with `metrics`: the card says their place in full in a native tooltip
 * (cardLineHtml). Measured as the width is, in the same fonts and grid, so it
 * agrees with what the card draws; texts are already cached by then.
 */
export function customCardCutLines(entries: Iterable<CustomCardEntry>, metrics: CustomCardMetrics,
    measure: MeasureTexts): Set<CardLine> {
    const lines = [...entries].flatMap(e => e.lines.filter(l => l.rest));
    const cut = new Set<CardLine>();
    if (lines.length === 0) return cut;
    const texts = new Set<string>();
    for (const l of lines) {
        texts.add(l.rest);
        if (l.more) texts.add(` ${l.more}`);
    }
    const placeW = measure('place', texts);
    const room = customCardContentWidth(metrics.cardWidth);
    for (const l of lines) {
        const start = l.wide ? CARD_MARK_WIDTH + CARD_COLUMN_GAP : cardPlaceOffset(metrics.dateColumn);
        const width = (placeW.get(l.rest) ?? 0) + (l.more ? placeW.get(` ${l.more}`) ?? 0 : 0);
        // A hair of slack for float noise: a text that just fits is not cut.
        if (start + width > room + 0.01) cut.add(l);
    }
    return cut;
}

// ============= Browser: measuring in the card's fonts =============

/** The CSS each kind is set in on the card (index.html, the custom density). */
const KIND_STYLE: Record<CardTextKind, string> = {
    name: 'font: 600 15px var(--font-serif);',
    date: 'font: 500 12px var(--font-sans); font-variant-numeric: tabular-nums;',
    place: 'font: 400 12px var(--font-sans); font-variant-numeric: tabular-nums;',
};
/** The faces those styles use, to know whether they are loaded yet. */
const KIND_FACES = ['600 15px "Source Serif 4"', '500 12px "Instrument Sans"', '400 12px "Instrument Sans"'];

const measured = new Map<string, number>();
let fontsPending: Promise<void> | null = null;
/** Waited for the fonts once: whatever came (a face may fail), measure with what there is. */
let fontsSettled = false;

function fontsReady(): boolean {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fontsSettled || !fonts?.check) return true;
    try {
        return KIND_FACES.every(f => fonts.check(f));
    } catch {
        return true;
    }
}

/**
 * Null when the card fonts are in; otherwise a promise that settles once they
 * load (texts measured before then are not cached and are measured again).
 */
export function cardFontsPending(): Promise<void> | null {
    if (fontsReady()) return null;
    if (!fontsPending) {
        const fonts = document.fonts;
        fontsPending = Promise.all(KIND_FACES.map(f => fonts.load(f).catch(() => [])))
            .then(() => undefined)
            .finally(() => { fontsPending = null; fontsSettled = true; });
    }
    return fontsPending;
}

/** Measure texts in the card's fonts: one hidden batch for the ones not cached yet. */
export const measureCardTexts: MeasureTexts = (kind, texts) => {
    const out = new Map<string, number>();
    const todo: string[] = [];
    for (const t of texts) {
        const hit = measured.get(kind + '\u0000' + t);
        if (hit !== undefined) out.set(t, hit);
        else if (!out.has(t)) { out.set(t, 0); todo.push(t); }
    }
    if (todo.length === 0 || typeof document === 'undefined' || !document.body) return out;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
    const els = todo.map(t => {
        const el = document.createElement('div');
        el.style.cssText = `${KIND_STYLE[kind]}display:block;width:max-content;white-space:pre;letter-spacing:normal;`;
        el.textContent = t;
        host.appendChild(el);
        return el;
    });
    document.body.appendChild(host);
    const cache = fontsReady();
    todo.forEach((t, i) => {
        const width = els[i].getBoundingClientRect().width;
        out.set(t, width);
        if (cache) measured.set(kind + '\u0000' + t, width);
    });
    host.remove();
    return out;
};
