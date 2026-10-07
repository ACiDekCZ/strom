/**
 * The "Custom" card's width: as wide as the longest text of the view needs.
 *
 * Every card of a view has one width (the layout spaces cards by a single
 * size): the longest name row or detail line among the persons drawn, plus
 * the card's 12px side padding and its 1px border, rounded up to 4px, at
 * least 200 and at most the chosen width's cap (240 narrow, 320 medium, 400
 * wide; Settings → Person card). Below the cap nothing wraps. Above it only
 * the place column gives: with one row a detail it shortens (ellipsis, the
 * full text in a native tooltip, customCardCutLines), with two rows or the
 * whole detail it wraps into rows (wrapCardTexts, customCardRows) and the
 * card grows (customCardViewHeight; with the height "by content" each card
 * by its own rows, customCardRows heights). The date always fits, unless it alone is
 * wider than its column; a name wider than the widest card shrinks on the
 * one-row card and wraps into two rows otherwise (customCardRows).
 *
 * A detail line is a grid: the mark (11px), the date, the place, 6px apart.
 * The date column is as wide as the longest date of the view, so the places
 * of all cards start at one x, but never wider than the longest ordinary date
 * of the language and the date setting (cardDateReferences): a date wider
 * than that (a range of whole dates, "about" a whole date, a text that is no
 * date) is a long date, drawn whole and never wrapped. When a detail may take
 * more rows it takes the line's first row across the date and the place
 * columns and the place starts on the next row in its column; on the one-row
 * card the place follows it, 6px after it, and shortens. In the labels style
 * a line is the event's word (the label column, as wide as the longest label
 * of the view, 8px) and its value: the date, 5px, the place, wrapping under
 * the value's start. The image export draws the same geometry with the same
 * numbers (src/export-image.ts).
 *
 * The arithmetic is pure; the browser part measures the texts in the card's
 * real fonts (one hidden batch, every string cached), so a tree of thousands
 * costs one layout for the strings it has not seen yet.
 */

import type { CardHeightMode, CardLine, CardLineStyle, CardValueLines } from './card-fields.js';

export const CUSTOM_CARD_MIN_WIDTH = 200;
/** The medium width's cap: the card before the width choice, and the default. */
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
/** Labels style: between the label column and the value. */
export const CARD_LABEL_GAP = 8;
/** Labels style: between the date and the place in the value. */
export const CARD_VALUE_DATE_GAP = 5;

/** The card width for the widest content: padding and border added, up to 4px, within 200 and the cap. */
export function customCardWidth(contentWidth: number, cap: number = CUSTOM_CARD_MAX_WIDTH): number {
    const raw = Math.ceil(Math.max(0, contentWidth)) + 2 * (CUSTOM_CARD_PAD_X + CUSTOM_CARD_BORDER);
    const rounded = Math.ceil(raw / 4) * 4;
    return Math.min(Math.max(CUSTOM_CARD_MIN_WIDTH, cap), Math.max(CUSTOM_CARD_MIN_WIDTH, rounded));
}

/** The room inside a card of a given width (between its paddings). */
export function customCardContentWidth(cardWidth: number): number {
    return cardWidth - 2 * (CUSTOM_CARD_PAD_X + CUSTOM_CARD_BORDER);
}

/** Where a line's place starts, from the content's left edge. */
export function cardPlaceOffset(dateColumn: number): number {
    return CARD_MARK_WIDTH + CARD_COLUMN_GAP + dateColumn + CARD_COLUMN_GAP;
}

/** The card's text styles: the name, a date, a place, a label (labels style), the years under the name. */
export type CardTextKind = 'name' | 'date' | 'place' | 'label' | 'years';

/** Widths of texts in one style; returns a width for every text asked for. */
export type MeasureTexts = (kind: CardTextKind, texts: Iterable<string>) => Map<string, number>;

/** What the width and the rows read of a line (src/card-fields.ts CardLine). */
export type CardLineText = Pick<CardLine, 'date' | 'rest' | 'more' | 'wide' | 'place' | 'cause' | 'label'>;

/** One card of the view: its name, whether it has an avatar, its lines, the years under the name (src/card-fields.ts cardYears). */
export interface CustomCardEntry<L extends CardLineText = CardLine> {
    name: string;
    avatar: boolean;
    lines: readonly L[];
    /** The life years under the name ("1841 – 1922"); absent or empty: no such row. */
    years?: string;
}

export interface CustomCardMetrics {
    cardWidth: number;
    /** The width of the date column (0 when no line of the view has a date, and in the labels style). */
    dateColumn: number;
    /** Labels style: the width of the label column, the view's longest label (0 or absent in the marks style). */
    labelColumn?: number;
}

/** A piece of the place column: the text and what stays glued to its last word ("+1"). */
interface CardLinePart {
    text: string;
    tail?: string;
    cause?: boolean;
}

/**
 * What a line draws in its place column. A whole detail (`valueLines` 0)
 * puts the cause of death on rows of its own under the place; a detail of one
 * or two rows keeps it after the place with " · " (it shortens first).
 */
function cardLineParts(l: CardLineText, valueLines: CardValueLines): CardLinePart[] {
    if (valueLines === 0 && l.cause) {
        return [
            ...(l.place ? [{ text: l.place }] : []),
            { text: l.cause, cause: true },
        ];
    }
    if (!l.rest && !l.more) return [];
    return [{ text: l.rest, ...(l.more ? { tail: ` ${l.more}` } : {}) }];
}

/**
 * Whether a line's date is a long date (wider than the view's date column):
 * it does not go into the column (see the top of this file). `dateWidth` is
 * the date's measured width.
 */
export function isLongCardDate(l: CardLineText, dateWidth: number, dateColumn: number): boolean {
    return !l.wide && !!l.date && Math.ceil(dateWidth) > dateColumn;
}

/**
 * The view's card width (at most `cap`) and its date column (marks) or label
 * column (labels) from its cards' texts. The labels counted are the ones the
 * lines show: a stand-in says its own event ("Baptism" on the birth line).
 * `dateReferences` (src/card-fields.ts cardDateReferences): the date column
 * is at most as wide as the widest of them; none, no such limit.
 */
export function customCardMetrics<L extends CardLineText>(entries: Iterable<CustomCardEntry<L>>, measure: MeasureTexts,
    cap: number = CUSTOM_CARD_MAX_WIDTH, valueLines: CardValueLines = 1, style: CardLineStyle = 'marks',
    dateReferences: Iterable<string> = []): CustomCardMetrics {
    const list = [...entries];
    const labels = style === 'labels';
    const names = new Set<string>();
    const years = new Set<string>();
    const dates = new Set<string>();
    const places = new Set<string>();
    const labelTexts = new Set<string>();
    for (const e of list) {
        names.add(e.name);
        if (e.years) years.add(e.years);
        for (const l of e.lines) {
            if (l.date) dates.add(l.date);
            if (labels && l.label) labelTexts.add(l.label);
            for (const p of cardLineParts(l, valueLines)) places.add(p.text + (p.tail ?? ''));
        }
    }
    const nameW = measure('name', names);
    const yearsW = years.size ? measure('years', years) : new Map<string, number>();
    const dateW = measure('date', dates);
    const placeW = measure('place', places);
    const labelW = labelTexts.size ? measure('label', labelTexts) : new Map<string, number>();
    const w = (m: Map<string, number>, t: string): number => Math.ceil(m.get(t) ?? 0);

    let dateColumn = 0;
    let labelColumn = 0;
    if (labels) for (const t of labelTexts) labelColumn = Math.max(labelColumn, w(labelW, t));
    else {
        // The widest date that fits under the widest ordinary date; a longer one goes its own way.
        const refs = new Set(dateReferences);
        const refW = refs.size ? measure('date', refs) : new Map<string, number>();
        let dateCap = refs.size ? 0 : Infinity;
        for (const r of refs) dateCap = Math.max(dateCap, w(refW, r));
        for (const d of dates) if (w(dateW, d) <= dateCap) dateColumn = Math.max(dateColumn, w(dateW, d));
    }

    let content = 0;
    for (const e of list) {
        const head = Math.max(w(nameW, e.name), e.years ? w(yearsW, e.years) : 0);
        content = Math.max(content, (e.avatar ? CARD_AVATAR_WIDTH + CARD_HEAD_GAP : 0) + head);
        for (const l of e.lines) {
            // Unwrapped: each piece of the place column on one row.
            const parts = cardLineParts(l, valueLines).map(p => w(placeW, p.text + (p.tail ?? '')));
            let row: number;
            if (labels) {
                // The date, 5px and the first piece on one row; a whole cause on a row of its own.
                const date = l.date ? w(dateW, l.date) : 0;
                const first = parts.length === 0 ? date : date ? date + CARD_VALUE_DATE_GAP + parts[0] : parts[0];
                row = labelColumn + CARD_LABEL_GAP + Math.max(first, ...parts.slice(1));
            } else {
                const place = Math.max(0, ...parts);
                const date = l.date ? w(dateW, l.date) : 0;
                if (isLongCardDate(l, date, dateColumn)) {
                    // A long date: the place 6px after it on the one-row card, else on the rows under it.
                    const dateRow = CARD_MARK_WIDTH + CARD_COLUMN_GAP + date;
                    row = valueLines === 1
                        ? dateRow + (place > 0 ? CARD_COLUMN_GAP + place : 0)
                        : Math.max(dateRow, place > 0 ? cardPlaceOffset(dateColumn) + place : 0);
                } else {
                    row = l.wide
                        ? CARD_MARK_WIDTH + CARD_COLUMN_GAP + place
                        : place > 0 ? cardPlaceOffset(dateColumn) + place : CARD_MARK_WIDTH + CARD_COLUMN_GAP + dateColumn;
                }
            }
            content = Math.max(content, row);
        }
    }
    return { cardWidth: customCardWidth(content, cap), dateColumn, ...(labels ? { labelColumn } : {}) };
}

// ============= Wrapping a value into rows =============

/** One text to wrap into a column. */
export interface WrapRequest {
    /** The text; it breaks after a space, "-", "–" and "/". */
    text: string;
    /** Glued to the text's last word and never cut ("+1" after a place, with its space). */
    tail?: string;
    /** The column's width (px). */
    width: number;
    /**
     * The room on the first row when something stands before the text there
     * (the date in the labels style). When not even the first word fits
     * there and another row is allowed, the first row stays empty (text '')
     * and the text starts on the next one.
     */
    firstWidth?: number;
    /** At most this many rows (the last ends in "…" when the text goes on); 0 = the whole text. */
    maxLines: CardValueLines;
    /** The text's style (default: the place's). */
    kind?: CardTextKind;
}

/** A row as drawn: its text and, on the row that ends the text, the tail. */
export interface WrappedRow {
    text: string;
    tail?: string;
}

export interface WrapResult {
    rows: WrappedRow[];
    /** The text did not fit the rows allowed: the last row ends in "…". */
    cut: boolean;
}

const BREAK_AFTER = /[-–/\s]/;
const SPACE = /\s/;

/** The text in pieces that end where a row may break (a space run, "-", "–", "/"). */
function breakPieces(text: string): string[] {
    const chars = Array.from(text);
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < chars.length; i++) {
        cur += chars[i];
        if (!BREAK_AFTER.test(chars[i])) continue;
        // Spaces after a break belong to it: a row never starts with one.
        while (i + 1 < chars.length && SPACE.test(chars[i + 1])) cur += chars[++i];
        out.push(cur);
        cur = '';
    }
    if (cur) out.push(cur);
    return out;
}

interface WrapState {
    req: WrapRequest;
    pieces: string[];
    /** The first piece of the row being filled. */
    at: number;
    rows: WrappedRow[];
    cut: boolean;
    done: boolean;
    /** fill: whole pieces; chars: a piece wider than the column, by characters; ellipsis: the last row. */
    phase: 'fill' | 'chars' | 'ellipsis';
    /** Ellipsis: try at most this many characters of what is left. */
    bound: number;
    candidates: string[];
}

const SLACK = 0.01;

/**
 * Split texts into rows of a column, measured in the card's fonts (the same
 * measure, and cache, the width comes from): the screen draws these rows
 * (each its own element, never wrapped by the browser) and the image export
 * draws the same ones, so both have the same rows and height.
 *
 * Rules: a row breaks after a space, "-", "–" or "/". A word wider than the
 * column breaks between characters when the whole text is shown
 * (`maxLines` 0); otherwise the text stops there with "…". When a limited text
 * goes on past its last row, that row ends in "…" (as many characters as fit).
 * The tail ("+1") stays glued to the last word and is never cut: after "…"
 * when the text is cut. A text that fits is one row; an empty text with a tail
 * is a row of the tail alone; nothing at all is no row. With `firstWidth` the
 * first row has less room (see WrapRequest).
 *
 * All texts are wrapped together, a measuring round per row, so a view of
 * thousands of cards measures in a few batches.
 */
export function wrapCardTexts(requests: readonly WrapRequest[], measure: MeasureTexts): WrapResult[] {
    const states: WrapState[] = requests.map(req => {
        const pieces = breakPieces(req.text.trim());
        const s: WrapState = { req, pieces, at: 0, rows: [], cut: false, done: false, phase: 'fill', bound: 0, candidates: [] };
        if (pieces.length === 0) {
            if (req.tail) s.rows.push({ text: '', tail: req.tail });
            s.done = true;
        }
        return s;
    });
    const tailOf = (s: WrapState): string => s.req.tail ?? '';
    const rowOf = (s: WrapState, from: number, to: number): WrappedRow => {
        const text = s.pieces.slice(from, to + 1).join('').trimEnd();
        return to === s.pieces.length - 1 && s.req.tail ? { text, tail: s.req.tail } : { text };
    };
    // The width a candidate row is measured with: the text and, on the last row, the tail.
    const fillCandidate = (s: WrapState, to: number): string =>
        s.pieces.slice(s.at, to + 1).join('').trimEnd() + (to === s.pieces.length - 1 ? tailOf(s) : '');
    const ellipsisCandidates = (s: WrapState): string[] => {
        const left = Array.from(s.pieces.slice(s.at).join(''));
        const out: string[] = [];
        for (let k = Math.min(s.bound, left.length); k >= 1; k--) out.push(`${left.slice(0, k).join('').trimEnd()}…${tailOf(s)}`);
        return out;
    };

    for (let round = 0; round < 10000; round++) {
        const active = states.filter(s => !s.done);
        if (active.length === 0) break;
        // What every active text needs measured this round, in one batch per style.
        const byKind = new Map<CardTextKind, Set<string>>();
        for (const s of active) {
            if (s.phase === 'fill') {
                s.candidates = [];
                for (let j = s.at; j < s.pieces.length; j++) s.candidates.push(fillCandidate(s, j));
            } else if (s.phase === 'chars') {
                const piece = Array.from(s.pieces[s.at]);
                s.candidates = [];
                for (let k = 1; k < piece.length; k++) s.candidates.push(piece.slice(0, k).join('').trimEnd());
            } else {
                s.candidates = ellipsisCandidates(s);
            }
            const kind = s.req.kind ?? 'place';
            const set = byKind.get(kind) ?? new Set<string>();
            for (const c of s.candidates) set.add(c);
            byKind.set(kind, set);
        }
        const widths = new Map<CardTextKind, Map<string, number>>();
        for (const [kind, texts] of byKind) widths.set(kind, measure(kind, texts));

        for (const s of active) {
            const width = (t: string): number => widths.get(s.req.kind ?? 'place')?.get(t) ?? 0;
            const firstRow = s.rows.length === 0 && s.req.firstWidth !== undefined;
            const room = firstRow ? Math.min(s.req.width, s.req.firstWidth!) : s.req.width;
            const fits = (t: string): boolean => width(t) <= room + SLACK;
            const last = s.pieces.length - 1;
            if (s.phase === 'fill') {
                let to = -1;
                s.candidates.forEach((c, i) => { if (fits(c)) to = s.at + i; });
                const lastRowAllowed = s.req.maxLines !== 0 && s.rows.length + 1 >= s.req.maxLines;
                if (to < s.at && firstRow && room < s.req.width && !lastRowAllowed) {
                    // Nothing fits beside what stands before it: the text starts on the next row.
                    s.rows.push({ text: '' });
                    continue;
                }
                if (to === last) {
                    s.rows.push(rowOf(s, s.at, last));
                    s.done = true;
                } else if (to >= s.at && !lastRowAllowed) {
                    s.rows.push(rowOf(s, s.at, to));
                    s.at = to + 1;
                } else if (to >= s.at) {
                    // The last row allowed and the text goes on: as much as fits, then "…".
                    s.phase = 'ellipsis';
                    s.bound = Array.from(s.pieces.slice(s.at, to + 2).join('')).length;
                } else if (s.req.maxLines === 0) {
                    s.phase = 'chars';
                    if (Array.from(s.pieces[s.at]).length <= 1) {
                        // One character wider than the column: nothing to break.
                        s.rows.push(rowOf(s, s.at, s.at));
                        s.at++;
                        s.phase = 'fill';
                        if (s.at > last) s.done = true;
                    }
                } else {
                    // A word wider than the column in a limited text: it stops there with "…".
                    s.phase = 'ellipsis';
                    s.bound = Array.from(s.pieces[s.at]).length;
                }
            } else if (s.phase === 'chars') {
                // The longest start of the piece that fits (one character at least); the rest goes on.
                let k = 1;
                s.candidates.forEach((c, i) => { if (fits(c)) k = i + 1; });
                const piece = Array.from(s.pieces[s.at]);
                s.rows.push({ text: piece.slice(0, k).join('').trimEnd() });
                s.pieces[s.at] = piece.slice(k).join('');
                s.phase = 'fill';
            } else {
                const hit = s.candidates.find(fits);
                const text = (hit ?? `…${tailOf(s)}`);
                const tail = tailOf(s);
                s.rows.push(tail ? { text: text.slice(0, text.length - tail.length), tail } : { text });
                s.cut = true;
                s.done = true;
            }
        }
    }
    return states.map(s => ({ rows: s.rows, cut: s.cut }));
}

/** One text into rows (wrapCardTexts). */
export function wrapCardText(request: WrapRequest, measure: MeasureTexts): WrapResult {
    return wrapCardTexts([request], measure)[0];
}

// ============= Rows and height of the cards =============

/**
 * A row of a line's value as drawn: in the place column (marks), or the
 * value after the label (labels), where a row may start with (a piece of) the
 * date; `cause` on the rows of the cause of death of its own.
 */
export interface CardRow extends WrappedRow {
    cause?: boolean;
    /** Labels style: the date (or the piece of it) the row starts with; the text follows 5px after it. */
    date?: string;
}

/** A line's value as drawn: its rows (none without a place in the marks style) and whether it ended in "…". */
export interface CardLineRows {
    rows: CardRow[];
    cut: boolean;
    /**
     * Marks style: the date is wider than the view's date column (a long
     * date). When a detail may take more rows the first row is the date's
     * alone (an empty row here) and the place starts on the next; on the
     * one-row card the place follows the date (the room after it).
     */
    longDate?: boolean;
}

/** The name and the years under it as a card draws them. */
export interface CardHead {
    /** The name's rows: one, or up to two when details may wrap (the last ends in "…" when cut). */
    name: string[];
    /** The name did not fit its two rows. */
    cut: boolean;
    /** The years row under the name ('' = none). */
    years: string;
    /** The height of the header's content: the avatar's 30px, or the name's rows and the years when taller. */
    block: number;
}

/** The avatar: the header's content is at least this tall. */
export const CARD_AVATAR_SIZE = 30;
/** A row of the name (15px text). */
export const CARD_NAME_ROW_HEIGHT = 19;
/** The years under the name (11px text). */
export const CARD_YEARS_ROW_HEIGHT = 14;
/** A name wraps into at most this many rows (when details may wrap). */
export const CARD_NAME_MAX_ROWS = 2;
/** The card's header: 10px padding, the 30px name row, 10px padding. A card without lines is this tall. */
export const CARD_HEAD_HEIGHT = 50;
/** Between the header and the first line. */
export const CARD_LINES_GAP = 6;
/** Where the first line starts, from the card's top: 10px padding, the 30px name row, 6px. */
export const CARD_LINES_TOP = 10 + 30 + CARD_LINES_GAP;
/** A row of a line. */
export const CARD_ROW_HEIGHT = 17;
/** Between two details when a detail may take more than one row (the rows of one stay apart from the next). */
export const CARD_DETAIL_GAP = 3;
/** The partner line on a card taller than one row a detail: the middle of its header. */
export const CARD_HEAD_LINE_Y = 25;
/** The same with the years under the name: the middle of the taller header (10 + 33 / 2). */
export const CARD_HEAD_LINE_Y_YEARS = 10 + (CARD_NAME_ROW_HEIGHT + CARD_YEARS_ROW_HEIGHT) / 2;

/**
 * The height of a header's content: the name's rows (19px each) and the
 * years (14px) when there are any, at least the avatar's 30px. One row: 30;
 * with years 33; two rows 38; two rows and years 52.
 */
export function cardHeadBlock(nameRows: number, years: boolean): number {
    return Math.max(CARD_AVATAR_SIZE, CARD_NAME_ROW_HEIGHT * Math.max(1, nameRows) + (years ? CARD_YEARS_ROW_HEIGHT : 0));
}

/** Where the first line starts on a card with this header content, from the card's top. */
export function cardLinesTop(block: number = CARD_AVATAR_SIZE): number {
    return 10 + block + CARD_LINES_GAP;
}

/**
 * Every line's rows on the cards of a view laid out with `metrics`, and each
 * card's header.
 *
 * Marks: the place column (or the occupation's, from the date column) wrapped
 * by wrapCardTexts, the cause of death on rows of its own when a detail is
 * whole. Labels: the value after the label column: the date first (wrapped
 * like the value when it does not fit), then the place 5px after it on the
 * date's row when its first word fits there, else from the next row; every
 * row starts at the value's start. The rows a detail may take count the date's.
 *
 * The name: one row with one row a detail (the screen shrinks a long one, as
 * before); otherwise it wraps into at most two rows, the second ending in
 * "…". The years row comes under it when the entry has years.
 *
 * `heights`: each card's height for those rows and its header
 * (customCardHeight), in the entries' order: the card's own height (the
 * height "by content"). With one row a detail the rows only say what is cut
 * (the screen shortens that row itself) and a card is its header and 17px a
 * line, no gap between details; the view's one height is customCardViewHeight.
 */
export function customCardRows<L extends CardLineText>(entries: Iterable<CustomCardEntry<L>>, metrics: CustomCardMetrics,
    measure: MeasureTexts, valueLines: CardValueLines, style: CardLineStyle = 'marks',
): { rows: Map<L, CardLineRows>; heights: number[]; heads: CardHead[] } {
    const list = [...entries];
    const room = customCardContentWidth(metrics.cardWidth);
    const rows = new Map<L, CardLineRows>();
    for (const e of list) for (const l of e.lines) rows.set(l, { rows: [], cut: false });

    if (style === 'labels') {
        const valueWidth = Math.max(1, room - (metrics.labelColumn ?? 0) - CARD_LABEL_GAP);
        // The dates first: what is left of the date's last row is the place's first.
        const dated = list.flatMap(e => e.lines.filter(l => !!l.date));
        const dates = wrapCardTexts(dated.map(l => ({ text: l.date, width: valueWidth, maxLines: valueLines, kind: 'date' as const })), measure);
        const dateRows = new Map<L, WrapResult>();
        dated.forEach((l, i) => dateRows.set(l, dates[i]));
        const lastDates = new Set<string>();
        for (const d of dates) if (d.rows.length) lastDates.add(d.rows[d.rows.length - 1].text);
        const lastW = measure('date', lastDates);

        const requests: WrapRequest[] = [];
        const owners: { line: L; first: boolean; cause: boolean }[] = [];
        for (const e of list) {
            for (const l of e.lines) {
                const d = dateRows.get(l);
                const entry = rows.get(l)!;
                if (d) {
                    entry.rows.push(...d.rows.map(r => ({ text: '', date: r.text })));
                    entry.cut = d.cut;
                    // A date cut short leaves no room for the rest.
                    if (d.cut) continue;
                }
                const k = d?.rows.length ?? 0;
                cardLineParts(l, valueLines).forEach((p, i) => {
                    const first = i === 0;
                    const lead = first && k > 0
                        ? valueWidth - Math.ceil(lastW.get(d!.rows[k - 1].text) ?? 0) - CARD_VALUE_DATE_GAP : undefined;
                    requests.push({
                        text: p.text, ...(p.tail ? { tail: p.tail } : {}), width: valueWidth,
                        ...(lead !== undefined ? { firstWidth: lead } : {}),
                        // The date's rows count: the place may share only its last one.
                        maxLines: valueLines === 0 ? 0 : Math.max(1, valueLines - Math.max(0, k - 1)) as CardValueLines,
                    });
                    owners.push({ line: l, first: first && k > 0, cause: !!p.cause });
                });
            }
        }
        wrapCardTexts(requests, measure).forEach((r, i) => {
            const { line, first, cause } = owners[i];
            const entry = rows.get(line)!;
            const drawn: CardRow[] = r.rows.map(row => cause ? { ...row, cause: true } : { ...row });
            if (first && drawn.length) {
                // The first row goes on the date's last row, after the date.
                const dateRow = entry.rows[entry.rows.length - 1];
                const head = drawn.shift()!;
                entry.rows[entry.rows.length - 1] = { ...head, date: dateRow.date };
            }
            entry.rows.push(...drawn);
            entry.cut = entry.cut || r.cut;
        });
    } else {
        const dates = new Set<string>();
        for (const e of list) for (const l of e.lines) if (!l.wide && l.date) dates.add(l.date);
        const dateW = dates.size ? measure('date', dates) : new Map<string, number>();
        const requests: WrapRequest[] = [];
        const owners: { line: L; cause: boolean }[] = [];
        for (const e of list) {
            for (const l of e.lines) {
                const date = l.date ? dateW.get(l.date) ?? 0 : 0;
                const long = isLongCardDate(l, date, metrics.dateColumn);
                if (long) rows.get(l)!.longDate = true;
                // One row with a long date: the place in the room 6px after the date.
                const width = Math.max(1, room - (l.wide ? CARD_MARK_WIDTH + CARD_COLUMN_GAP
                    : long && valueLines === 1 ? CARD_MARK_WIDTH + CARD_COLUMN_GAP + date + CARD_COLUMN_GAP
                        : cardPlaceOffset(metrics.dateColumn)));
                cardLineParts(l, valueLines).forEach((p, i) => {
                    // Rows with a long date: the date's row stays empty here, the place has one row less.
                    const under = long && valueLines !== 1 && i === 0;
                    if (under) rows.get(l)!.rows.push({ text: '' });
                    const maxLines = under && valueLines === 2 ? 1 : valueLines;
                    requests.push({ text: p.text, ...(p.tail ? { tail: p.tail } : {}), width, maxLines });
                    owners.push({ line: l, cause: !!p.cause });
                });
            }
        }
        wrapCardTexts(requests, measure).forEach((r, i) => {
            const { line, cause } = owners[i];
            const entry = rows.get(line)!;
            entry.rows.push(...r.rows.map(row => cause ? { ...row, cause: true } : row));
            entry.cut = entry.cut || r.cut;
        });
    }

    // The name: two rows at most when details may wrap, else one (shrunk on screen when long).
    const names = valueLines === 1 ? null : wrapCardTexts(list.map(e => ({
        text: e.name, kind: 'name' as const, maxLines: CARD_NAME_MAX_ROWS as CardValueLines,
        width: Math.max(1, room - (e.avatar ? CARD_AVATAR_WIDTH + CARD_HEAD_GAP : 0)),
    })), measure);
    const heads: CardHead[] = list.map((e, i) => {
        const wrapped = names?.[i];
        const name = wrapped && wrapped.rows.length ? wrapped.rows.map(r => r.text) : [e.name];
        const years = e.years ?? '';
        return { name, cut: !!wrapped?.cut, years, block: cardHeadBlock(name.length, !!years) };
    });
    const detailGap = valueLines === 1 ? 0 : CARD_DETAIL_GAP;
    const heights = list.map((e, i) => customCardHeight(e.lines.map(l => valueLines === 1 ? 1 : rows.get(l)!.rows.length),
        heads[i].block, detailGap));
    return { rows, heights, heads };
}

/**
 * A card's height for its lines' row counts (a line without a place is one
 * row) and its header's content (cardHeadBlock, the avatar's 30px by
 * default): 10px, the header, then 6px, 17px a row and `detailGap` (3px)
 * between details, 10px; the header alone (with its paddings) without lines.
 * The one-row card has no gap between details (`detailGap` 0).
 */
export function customCardHeight(rowCounts: readonly number[], headBlock: number = CARD_AVATAR_SIZE,
    detailGap: number = CARD_DETAIL_GAP): number {
    const head = CARD_HEAD_HEIGHT - CARD_AVATAR_SIZE + headBlock;
    if (rowCounts.length === 0) return head;
    const rows = rowCounts.reduce((sum, n) => sum + Math.max(1, n), 0);
    return head + CARD_LINES_GAP + CARD_ROW_HEIGHT * rows + detailGap * (rowCounts.length - 1);
}

/**
 * The one card height of a view (the height "equal": the layout spaces every
 * card by it). One row a detail: 56 + 17 × the details on (3px more with the
 * years under the name), the card as it always was (it does not change with
 * the focus). Two rows or the whole detail: the tallest card of the view
 * (`heights`, customCardRows). With the height "by content" every card is
 * its own height (customCardRows heights, LayoutConfig.personHeights).
 */
export function customCardViewHeight(detailsOn: number, valueLines: CardValueLines, heights: Iterable<number>,
    years = false): number {
    if (valueLines === 1) {
        return customCardHeight([], cardHeadBlock(1, years)) + CARD_LINES_GAP + CARD_ROW_HEIGHT * Math.max(0, detailsOn);
    }
    let tallest = CARD_HEAD_HEIGHT;
    for (const h of heights) tallest = Math.max(tallest, h);
    return tallest;
}

/**
 * Where the partner line runs on the custom card (LayoutConfig.spouseLineY):
 * the card's middle on the one-row card of one height (undefined), the
 * middle of the header on a card whose details may take more rows or whose
 * height is its own ("by content"), so it stays by the names however tall
 * the card is: 25px, 26.5px with the years under the name (one value for
 * every card of the view).
 */
export function customCardSpouseLineY(valueLines: CardValueLines, years = false, height: CardHeightMode = 'view'): number | undefined {
    if (valueLines === 1 && height !== 'content') return undefined;
    return years ? CARD_HEAD_LINE_Y_YEARS : CARD_HEAD_LINE_Y;
}

/**
 * The lines whose place shortens (an ellipsis) on the one-row cards of a view
 * laid out with `metrics`: the card says their place in full in a native
 * tooltip (cardLineHtml). Measured as the width is, in the same fonts and
 * grid, so it agrees with what the card draws; texts are already cached by
 * then. The width's cap is in `metrics.cardWidth` already.
 */
export function customCardCutLines<L extends CardLineText>(entries: Iterable<CustomCardEntry<L>>, metrics: CustomCardMetrics,
    measure: MeasureTexts, valueLines: CardValueLines = 1, style: CardLineStyle = 'marks'): Set<L> {
    const cut = new Set<L>();
    for (const [line, r] of customCardRows(entries, metrics, measure, valueLines, style).rows) if (r.cut) cut.add(line);
    return cut;
}

// ============= Browser: measuring in the card's fonts =============

/** The CSS each kind is set in on the card (index.html, the custom density). */
const KIND_STYLE: Record<CardTextKind, string> = {
    name: 'font: 600 15px var(--font-serif);',
    date: 'font: 500 12px var(--font-sans); font-variant-numeric: tabular-nums;',
    place: 'font: 400 12px var(--font-sans); font-variant-numeric: tabular-nums;',
    label: 'font: 600 12px var(--font-sans); font-variant-numeric: tabular-nums;',
    years: 'font: 400 11px var(--font-sans); font-variant-numeric: tabular-nums;',
};
/** The faces those styles use, to know whether they are loaded yet. */
const KIND_FACES = ['600 15px "Source Serif 4"', '500 12px "Instrument Sans"', '400 12px "Instrument Sans"', '600 12px "Instrument Sans"'];

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
