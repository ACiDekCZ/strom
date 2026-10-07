/**
 * Poster export — build a clean, self-contained SVG of the currently laid-out
 * tree from the layout result (positions, connections, spouse lines). This is
 * the source of truth for the SVG download, the PNG raster and the tiled PDF.
 *
 * It reads a LayoutResult but never touches the layout engine.
 */

import { StromData, LayoutConfig, DEFAULT_LAYOUT_CONFIG, PartnershipStatus, personCardHeight } from './types.js';
import { LayoutResult } from './layout/pipeline/types.js';
import { displayYear } from './dates.js';
import { personInitials } from './initials.js';
import { parentRelKind, parentRelDash, connectionDash } from './parent-rel-style.js';
import type { CardLine, CardLineStyle, CardValueLines } from './card-fields.js';
import {
    CARD_MARK_WIDTH, CARD_COLUMN_GAP, CUSTOM_CARD_PAD_X, CARD_ROW_HEIGHT, CARD_DETAIL_GAP, CARD_LABEL_GAP,
    CARD_VALUE_DATE_GAP, CARD_NAME_ROW_HEIGHT, CARD_YEARS_ROW_HEIGHT, CARD_AVATAR_WIDTH, CARD_HEAD_GAP,
    MeasureTexts, CardRow, cardPlaceOffset, cardLinesTop, customCardRows,
} from './card-width.js';
import { shownName } from './person-name.js';

/** The subset of a LayoutResult the poster needs (no diagnostics required). */
export type PosterLayout = Pick<LayoutResult, 'positions' | 'connections' | 'spouseLines'>;

/** Light-theme colors matching the on-canvas card styles. */
// "Letopis" poster palette (parity with the on-screen light theme). Cards are
// the neutral surface with a hairline border; gender is the avatar RING, not a
// card fill. Tree lines use the same muted --line-color as the app.
const COLORS = {
    male: '#5b7f9e',        // avatar ring
    female: '#a1706e',      // avatar ring
    placeholderRing: '#b8ae99',
    cardBg: '#fffdf8',
    cardBorder: '#ddd4c2',
    avatarBg: '#f0e9da',
    initials: '#5c5546',
    line: '#b8ae99',
    spouse: '#8a8272',
    text: '#2b2822',
    textLight: '#5c5546',
    textFaint: '#746c5c',
    printBorder: '#b8ad98',
    footer: '#8a8272',
    background: '#ffffff',
};

const FONT = "'Source Serif 4', Georgia, 'Times New Roman', serif";
const PADDING = 40;
export const FOOTER_HEIGHT = 44;

/** Poster geometry/style shared with other poster builders (e.g. the fan). */
export const POSTER_PADDING = PADDING;
export const POSTER_FONT = FONT;
export const POSTER_BG = COLORS.background;

/** Branch stripe colours (match the on-screen --branch-* variables). */
const BRANCH_COLORS: Record<string, string> = {
    paternal: '#d08a5a', maternal: '#5a8fc0', descendant: '#57a869',
};

/**
 * The branch stripe: the left `w` px of the card's rounded rectangle (corner
 * radius r), so it runs into the rounded corners like the on-screen stripe
 * instead of being a separate bar. Exported for tests.
 */
export function branchStripePath(x: number, y: number, h: number, r: number, w: number): string {
    const f = (n: number) => n.toFixed(2);
    // Where the corner arc meets the stripe's inner edge (x + w).
    const dy = w < r ? r - Math.sqrt(r * r - (r - w) * (r - w)) : 0;
    return `M${f(x + w)} ${f(y + dy)}A${r} ${r} 0 0 0 ${f(x)} ${f(y + r)}`
        + `L${f(x)} ${f(y + h - r)}A${r} ${r} 0 0 0 ${f(x + w)} ${f(y + h - dy)}Z`;
}

/** Spouse-line dash per partnership status (mirror of the renderer). */
function statusDash(status: PartnershipStatus | undefined): { dash?: string; color?: string } {
    switch (status) {
        case 'divorced': return { dash: '8,4', color: '#999999' };
        case 'separated': return { dash: '4,4', color: '#999999' };
        case 'partners': return { dash: '2,2' };
        default: return {};
    }
}

/** Non-biological kind of a child's link (mirror of the renderer). */
function relKind(data: StromData, childId: string) {
    return parentRelKind(data.persons[childId as keyof typeof data.persons]);
}

/**
 * Estimated text width (px) for the export's font stack — close enough to
 * pick a shrink step; textLength clamps whatever estimation misses.
 */
function estWidth(text: string, fontSize: number, bold: boolean): number {
    return text.length * fontSize * (bold ? 0.62 : 0.58);
}

/**
 * Text that FITS a max width like the on-screen cards do: shrink through the
 * same steps the renderer uses, then hard-clamp with textLength so long names
 * can never overflow the card (they used to run across neighbours).
 */
function fittedText(
    text: string, x: number, y: number, maxW: number,
    sizes: number[], bold: boolean, fill: string, anchor: 'middle' | 'start' = 'middle'
): string {
    let fs = sizes[0];
    for (const size of sizes) {
        fs = size;
        if (estWidth(text, size, bold) <= maxW) break;
    }
    const clamp = estWidth(text, fs, bold) > maxW
        ? ` textLength="${maxW.toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : '';
    const weight = bold ? ' font-weight="600"' : '';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${fs}"${weight} fill="${fill}"${clamp}>${escapeXml(text)}</text>`;
}

export interface SvgBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
}

export interface PosterOptions {
    /** Footer title (tree name). */
    treeName?: string;
    /** Footer date/subtitle. */
    dateLabel?: string;
    /** Footer view label (e.g. "Family — from Jan Novák (depth 3/3)"). */
    viewLabel?: string;
    config?: LayoutConfig;
    /** Branch classification (person id -> paternal|maternal|descendant). */
    branchMap?: Map<string, string> | null;
    /** Persons drawn with the † marker. */
    deceasedSet?: Set<string>;
    /**
     * Context-only persons drawn de-emphasized (opacity 0.5), matching the
     * on-screen `indirect` class in the descendants / family views.
     */
    dimmedIds?: Set<string>;
    /**
     * The custom card density (src/card-fields.ts): each person's lines. When
     * set, a card is the avatar and the name on one row and these lines under
     * them, at the size in `config` — what the screen shows.
     */
    cardLines?: Map<string, PosterCardLine[]>;
    /** The custom card's date column (the view's longest ordinary date, src/card-width.ts); a longer date is drawn on its own. */
    cardDateColumn?: number;
    /**
     * Rows a custom card's detail may take (src/card-fields.ts `lines`): 1
     * (default) shortens it to one row, 2 to two rows, 0 shows it whole; the
     * rows are the screen's (src/card-width.ts customCardRows).
     */
    cardValueLines?: CardValueLines;
    /** The custom card's line style: marks (default) or labels (the event's word before the value). */
    cardStyle?: CardLineStyle;
    /** Labels style: the label column (the view's longest label, src/card-width.ts). */
    cardLabelColumn?: number;
    /** The years under the name per person (the option "Years under the name"; src/card-fields.ts cardYears). */
    cardYears?: Map<string, string>;
    /** Text widths in the card's fonts (the screen measures them); estimated when absent. */
    measureCardTexts?: MeasureTexts;
    /**
     * @font-face rules of the app's fonts (src/poster-fonts.ts), embedded so
     * the SVG and the PNG made from it draw in the screen's fonts.
     */
    fontFaceCss?: string;
}

/** What the poster needs of a custom card line. */
export type PosterCardLine = Pick<CardLine, 'mark' | 'date' | 'rest' | 'more' | 'wide' | 'place' | 'cause' | 'label'>;

/** The font of the custom card's lines (the screen's --font-sans), digits of one width. */
const LINE_FONT = `font-family="'Instrument Sans', -apple-system, 'Segoe UI', sans-serif" style="font-variant-numeric: tabular-nums"`;

/** Widths estimated per character, for a poster built without the screen's measure. */
const estimateCardTexts: MeasureTexts = (kind, texts) => {
    const out = new Map<string, number>();
    for (const t of texts) {
        out.set(t, kind === 'name' ? estWidth(t, 15, true) : kind === 'label' || kind === 'more' ? estWidth(t, 12, true)
            : kind === 'years' ? estWidth(t, 11, false) : estWidth(t, 12, false));
    }
    return out;
};

/** How a custom card is drawn: its columns, the rows a detail may take, its style. */
interface CustomCardLook {
    dateColumn: number;
    labelColumn: number;
    valueLines: CardValueLines;
    style: CardLineStyle;
    measure: MeasureTexts;
    /** Widths measured by the screen: texts are drawn at them. */
    exact: boolean;
}

/**
 * A custom-density card's content (src/card-fields.ts), in the on-screen
 * geometry: 10/12px padding, a 30px avatar and the name (and the years under
 * it) in the header, then 17px rows of 12px text. Marks: the mark in an 11px
 * column, the date, and the place where the view's date column ends
 * (separate texts, so the places of all cards start at one x); a long date
 * takes its row alone and the place starts under it, or, on the one-row
 * card, the place follows it 6px after it. Labels: the
 * event's word in the label column, the value 8px after it (the date, 5px,
 * the place; every row at the value's start). The rows are the screen's (the
 * same wrapping, src/card-width.ts customCardRows), one text a row, 3px
 * between details that may wrap. When details may wrap a long name takes the
 * screen's two rows; with one row a detail it shrinks to 13px and only then
 * shortens, as on screen. With `exact` (widths measured by the screen) texts
 * are drawn at their measured widths, so the geometry holds in whatever font
 * a viewer sets them.
 */
function customCardSvg(
    person: StromData['persons'][keyof StromData['persons']], pos: { x: number; y: number }, cw: number,
    lines: PosterCardLine[], ring: string, clipId: string, years: string, look: CustomCardLook,
): string {
    const { dateColumn, labelColumn, valueLines, style, measure, exact } = look;
    const out: string[] = [];
    const left = pos.x + CUSTOM_CARD_PAD_X;
    const right = pos.x + cw - CUSTOM_CARD_PAD_X;
    const name = shownName(person, '?');
    const metrics = { cardWidth: cw, dateColumn, ...(style === 'labels' ? { labelColumn } : {}) };
    const { rows, heads } = customCardRows([{ name, avatar: !person.isPlaceholder, lines, ...(years ? { years } : {}) }],
        metrics, measure, valueLines, style);
    const head = heads[0];
    let textX = left;
    if (!person.isPlaceholder) {
        const cx = left + 15;
        // The avatar in the middle of the header.
        const cy = pos.y + 10 + head.block / 2;
        if (person.photo) {
            out.push(`<clipPath id="${clipId}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="15"/></clipPath>`);
            out.push(`<image href="${escapeXml(person.photo)}" x="${(cx - 15).toFixed(1)}" y="${(cy - 15).toFixed(1)}" width="30" height="30" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`);
            out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="15" fill="none" stroke="${ring}" stroke-width="1.5"/>`);
        } else {
            const initials = personInitials(person.firstName, person.lastName) || '?';
            out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="15" fill="${COLORS.avatarBg}" stroke="${ring}" stroke-width="1.5"/>`);
            out.push(`<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLORS.initials}">${escapeXml(initials)}</text>`);
        }
        textX = left + CARD_AVATAR_WIDTH + CARD_HEAD_GAP;
    }
    const nameRoom = right - textX;
    // The name's rows and the years, as a block in the middle of the header; a 15px text's baseline 14.5px into its 19px row.
    const blockTop = pos.y + 10 + (head.block - CARD_NAME_ROW_HEIGHT * head.name.length - (head.years ? CARD_YEARS_ROW_HEIGHT : 0)) / 2;
    if (valueLines === 1) {
        const nameAt15 = measure('name', [name]).get(name) ?? 0;
        let fs = 15;
        for (const size of [15, 14, 13]) {
            fs = size;
            if (nameAt15 * size / 15 <= nameRoom) break;
        }
        // Measured in the screen's font, the name is drawn at that width: a viewer
        // that sets it in another (wider) font still keeps it inside the card.
        const nameW = Math.min(nameAt15 * fs / 15, nameRoom);
        const clamp = exact && nameW > 0
            ? ` textLength="${nameW.toFixed(1)}" lengthAdjust="spacingAndGlyphs"`
            : nameAt15 * fs / 15 > nameRoom ? ` textLength="${nameRoom.toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : '';
        out.push(`<text x="${textX.toFixed(1)}" y="${(blockTop + 14.5).toFixed(1)}" font-size="${fs}" font-weight="600" fill="${COLORS.text}"${clamp}>${escapeXml(name)}</text>`);
    } else {
        // The rows the screen draws (two at most), each at its measured width.
        const widths = measure('name', head.name);
        head.name.forEach((row, i) => {
            const w = Math.min(widths.get(row) ?? 0, nameRoom);
            const clamp = exact && w > 0 ? ` textLength="${w.toFixed(1)}" lengthAdjust="spacingAndGlyphs"`
                : (widths.get(row) ?? 0) > nameRoom ? ` textLength="${nameRoom.toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : '';
            out.push(`<text class="card-name-row" x="${textX.toFixed(1)}" y="${(blockTop + CARD_NAME_ROW_HEIGHT * i + 14.5).toFixed(1)}" font-size="15" font-weight="600" fill="${COLORS.text}"${clamp}>${escapeXml(row)}</text>`);
        });
    }
    // The 11px years 10.5px into their 14px row, under the name.
    const pin = (w: number): string => exact && w > 0 ? ` textLength="${w.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
    if (head.years) {
        const w = Math.min(measure('years', [head.years]).get(head.years) ?? 0, nameRoom);
        const y = blockTop + CARD_NAME_ROW_HEIGHT * head.name.length + 10.5;
        out.push(`<text class="card-years" x="${textX.toFixed(1)}" y="${y.toFixed(1)}" font-size="11" fill="${COLORS.textLight}"${pin(w)} ${LINE_FONT}>${escapeXml(head.years)}</text>`);
    }

    const labels = style === 'labels';
    const dateX = left + CARD_MARK_WIDTH + CARD_COLUMN_GAP;
    const valueX = left + labelColumn + CARD_LABEL_GAP;
    // The date and the place at their measured widths: in another font the
    // date still ends before the place's column and a shortened place inside the card.
    const detailGap = valueLines === 1 ? 0 : CARD_DETAIL_GAP;
    let top = pos.y + cardLinesTop(head.block);
    const place = (text: string, x: number, y: string): string => {
        const w = measure('place', [text]).get(text) ?? 0;
        return `<text class="card-line-place" x="${x.toFixed(1)}" y="${y}" font-size="12" fill="${COLORS.textLight}"${pin(Math.min(w, right - x))} ${LINE_FONT}>${escapeXml(text)}</text>`;
    };
    // A row of the place column: its text, then the "+1" right after it, at 600 (as on screen).
    const placeRow = (row: CardRow, x: number, y: string): string => {
        const out: string[] = [];
        if (row.text.trim()) out.push(place(row.text, x, y));
        if (row.tail) {
            const tx = x + (row.text ? measure('place', [row.text]).get(row.text) ?? 0 : 0);
            const w = measure('more', [row.tail]).get(row.tail) ?? 0;
            out.push(`<text class="card-line-more" x="${tx.toFixed(1)}" y="${y}" font-size="12" font-weight="600" fill="${COLORS.textLight}" xml:space="preserve"${pin(Math.min(w, right - tx))} ${LINE_FONT}>${escapeXml(row.tail)}</text>`);
        }
        return out.join('');
    };
    const date = (text: string, x: number, y: string): string => {
        const w = measure('date', [text]).get(text) ?? 0;
        return `<text class="card-line-date" x="${x.toFixed(1)}" y="${y}" font-size="12" font-weight="500" fill="${COLORS.text}"${pin(Math.min(w, right - x))} ${LINE_FONT}>${escapeXml(text)}</text>`;
    };
    for (const l of lines) {
        // The text's baseline in its 17px row (12px text).
        const y = (top + 12.5).toFixed(1);
        const drawn = rows.get(l)?.rows ?? [];
        if (labels) {
            if (l.label) {
                const w = measure('label', [l.label]).get(l.label) ?? 0;
                out.push(`<text class="card-line-label" x="${left.toFixed(1)}" y="${y}" font-size="12" font-weight="600" fill="${COLORS.textFaint}"${pin(Math.min(w, labelColumn))} ${LINE_FONT}>${escapeXml(l.label)}</text>`);
            }
            drawn.forEach((row, k) => {
                const rowY = (top + CARD_ROW_HEIGHT * k + 12.5).toFixed(1);
                let x = valueX;
                if (row.date) {
                    out.push(date(row.date, x, rowY));
                    // As the screen sets it: the date's own width, then 5px.
                    x += (measure('date', [row.date]).get(row.date) ?? 0) + CARD_VALUE_DATE_GAP;
                }
                out.push(placeRow(row, x, rowY));
            });
        } else {
            if (l.mark) out.push(`<text x="${(left + CARD_MARK_WIDTH / 2).toFixed(1)}" y="${y}" text-anchor="middle" font-size="12" fill="${COLORS.textFaint}" ${LINE_FONT}>${escapeXml(l.mark)}</text>`);
            if (!l.wide && l.date) out.push(date(l.date, dateX, y));
            // A long date (src/card-width.ts): on one row the place follows it 6px after it;
            // with rows its first row is the date's alone and the place goes on in its column.
            const longOneRow = !!rows.get(l)?.longDate && valueLines === 1;
            const placeX = l.wide ? dateX
                : longOneRow ? dateX + (measure('date', [l.date]).get(l.date) ?? 0) + CARD_COLUMN_GAP
                    : left + cardPlaceOffset(dateColumn);
            drawn.forEach((row, k) => {
                out.push(placeRow(row, placeX, (top + CARD_ROW_HEIGHT * k + 12.5).toFixed(1)));
            });
        }
        top += CARD_ROW_HEIGHT * Math.max(1, drawn.length) + detailGap;
    }
    return out.join('');
}

/** Fields the shared poster footer needs (a subset of PosterOptions). */
export interface PosterFooterMeta {
    treeName?: string;
    viewLabel?: string;
    dateLabel?: string;
}

/**
 * Shared poster footer: "<tree name>  ·  <view label>  ·  <date>" on the
 * bottom-left. Title, view label and date sit TOGETHER on the left — a lone
 * date in the far-right corner used to force a nearly-empty last print sheet.
 * Returns '' when there is nothing to show. Positioned against `totalHeight`
 * (the poster's full pixel height, footer strip included).
 */
export function posterFooterSvg(meta: PosterFooterMeta, totalHeight: number): string {
    const title = meta.treeName ? escapeXml(meta.treeName) : '';
    const view = meta.viewLabel ? escapeXml(meta.viewLabel) : '';
    const date = meta.dateLabel ? escapeXml(meta.dateLabel) : '';
    if (!title && !view && !date) return '';
    const fy = totalHeight - FOOTER_HEIGHT / 2;
    const parts: string[] = [];
    if (title) parts.push(`<tspan font-size="16" font-weight="600" fill="${COLORS.text}">${title}</tspan>`);
    if (view) parts.push(`<tspan font-size="12" fill="${COLORS.footer}">${parts.length ? '  ·  ' : ''}${view}</tspan>`);
    if (date) parts.push(`<tspan font-size="12" fill="${COLORS.footer}">${parts.length ? '  ·  ' : ''}${date}</tspan>`);
    return `<text x="${PADDING}" y="${fy.toFixed(1)}" dominant-baseline="middle">${parts.join('')}</text>`;
}

/**
 * Bounding box of all cards (card top-left..bottom-right) in layout space;
 * each card as tall as its own height (config.personHeights) when it has one.
 */
export function computeBounds(result: PosterLayout, config: LayoutConfig = DEFAULT_LAYOUT_CONFIG): SvgBounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, pos] of result.positions) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + config.cardWidth);
        maxY = Math.max(maxY, pos.y + personCardHeight(config, id));
    }
    if (!isFinite(minX)) {
        minX = minY = maxX = maxY = 0;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, dash?: string): string {
    const d = dash ? ` stroke-dasharray="${dash}"` : '';
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="1.5"${d}/>`;
}

/**
 * Build a self-contained SVG string for the laid-out tree. Deterministic:
 * cards are emitted in id order. A card is as tall as the person's own
 * height (config.personHeights, the custom card "by content"), else
 * config.cardHeight.
 */
export function buildTreeSvg(data: StromData, result: PosterLayout, options: PosterOptions = {}): string {
    const config = options.config ?? DEFAULT_LAYOUT_CONFIG;
    const cw = config.cardWidth;
    const heightOf = (id: string): number => personCardHeight(config, id as keyof StromData['persons']);
    const bounds = computeBounds(result, config);

    const hasFooter = !!(options.treeName || options.dateLabel || options.viewLabel);
    const footer = hasFooter ? FOOTER_HEIGHT : 0;
    const width = bounds.width + PADDING * 2;
    const height = bounds.height + PADDING * 2 + footer;
    const ox = -bounds.minX + PADDING;
    const oy = -bounds.minY + PADDING;

    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" font-family="${FONT}">`);
    // The app's fonts travel with the image (CDATA: the CSS is not markup).
    if (options.fontFaceCss) out.push(`<defs><style><![CDATA[\n${options.fontFaceCss}\n]]></style></defs>`);
    out.push(`<rect x="0" y="0" width="${width.toFixed(0)}" height="${height.toFixed(0)}" fill="${COLORS.background}"/>`);
    out.push(`<g transform="translate(${ox.toFixed(1)}, ${oy.toFixed(1)})">`);

    // --- Connections (parent -> children bus routing) ---
    out.push('<g class="connections">');
    for (const conn of result.connections) {
        // All children adopted (step/foster): the whole path is dashed, as on
        // screen; with a biological sibling only the drops are.
        const shared = connectionDash(conn.drops.map(d => relKind(data, d.personId)));
        // Stem — down to the CONNECTOR lane, not stemBottomY: lane allocation
        // can place the connector lower (secondary unions in partner chains),
        // and stopping short left visible gaps in the printed lines.
        out.push(line(conn.stemX, conn.stemTopY, conn.stemX, conn.connectorY, COLORS.line, shared));
        if (Math.abs(conn.connectorFromX - conn.connectorToX) > 0.5) {
            // Connector (horizontal), then its drop to the bus lane.
            out.push(line(conn.connectorFromX, conn.connectorY, conn.connectorToX, conn.connectorY, COLORS.line, shared));
            if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                out.push(line(conn.connectorToX, conn.connectorY, conn.connectorToX, conn.branchY, COLORS.line, shared));
            }
        } else if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
            // Stem sits within the bus range — extend it straight to the bus.
            out.push(line(conn.stemX, conn.connectorY, conn.stemX, conn.branchY, COLORS.line, shared));
        }
        // Bus (horizontal branch)
        if (Math.abs(conn.branchRightX - conn.branchLeftX) > 0.5) {
            out.push(line(conn.branchLeftX, conn.branchY, conn.branchRightX, conn.branchY, COLORS.line, shared));
        }
        // Drops to each child (adoptive dashed, step/foster dotted — parity
        // with the on-screen renderer)
        for (const drop of conn.drops) {
            out.push(line(drop.x, drop.topY ?? conn.branchY, drop.x, drop.bottomY, COLORS.line, parentRelDash(relKind(data, drop.personId))));
        }
    }
    out.push('</g>');

    // --- Spouse lines (status-styled, split around intervening cards in
    //     partner chains — same algorithm as the renderer) ---
    out.push('<g class="spouse-lines">');
    const cardGap = 4;
    for (const sl of result.spouseLines) {
        if (Math.abs(sl.xMax - sl.xMin) <= 0.5) continue;
        const partnership = sl.partnershipId ? data.partnerships[sl.partnershipId] : undefined;
        const style = statusDash(partnership?.status);
        const stroke = style.color ?? COLORS.spouse;

        const gaps: { left: number; right: number }[] = [];
        for (const [personId, pos] of result.positions) {
            if (personId === sl.person1Id || personId === sl.person2Id) continue;
            const cardLeft = pos.x;
            const cardRight = pos.x + cw;
            if (cardRight > sl.xMin && cardLeft < sl.xMax) {
                const h = heightOf(personId);
                if (Math.abs(pos.y + h / 2 - sl.y) < h / 2 + 2) {
                    gaps.push({ left: cardLeft - cardGap, right: cardRight + cardGap });
                }
            }
        }
        if (gaps.length === 0) {
            out.push(line(sl.xMin, sl.y, sl.xMax, sl.y, stroke, style.dash));
        } else {
            gaps.sort((a, b) => a.left - b.left);
            let currentX = sl.xMin;
            for (const gap of gaps) {
                if (gap.left > currentX) out.push(line(currentX, sl.y, gap.left, sl.y, stroke, style.dash));
                currentX = Math.max(currentX, gap.right);
            }
            if (currentX < sl.xMax) out.push(line(currentX, sl.y, sl.xMax, sl.y, stroke, style.dash));
        }
    }
    out.push('</g>');

    // --- Cards (id order for deterministic output) ---
    out.push('<g class="cards">');
    let clipCounter = 0;
    const entries = [...result.positions.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const [personId, pos] of entries) {
        const person = data.persons[personId];
        const ch = heightOf(personId);
        const isPlaceholder = person?.isPlaceholder;
        const ring = isPlaceholder ? COLORS.placeholderRing
            : (person?.gender === 'male' ? COLORS.male : COLORS.female);

        // Context-only person (step-relative / in-law): dim the whole card group
        // to 50%, matching the on-screen `indirect` de-emphasis (draw parity).
        const dimmed = !!options.dimmedIds?.has(personId);
        if (dimmed) out.push('<g opacity="0.5">');

        // "Letopis" card: neutral surface, hairline border (dashed for placeholders).
        // Custom cards are made to be printed: a firmer border on paper.
        const borderDash = isPlaceholder ? ' stroke-dasharray="4,3"' : '';
        const border = options.cardLines ? COLORS.printBorder : COLORS.cardBorder;
        out.push(`<rect x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" width="${cw}" height="${ch}" rx="8" fill="${COLORS.cardBg}" stroke="${border}" stroke-width="1"${borderDash}/>`);

        // Branch colour stripe (matches the on-screen ::before stripe): from the
        // outer edge of the 1px border, following the card's rounded corners.
        const branch = options.branchMap?.get(personId);
        const stripeColor = branch ? BRANCH_COLORS[branch] : undefined;
        if (stripeColor) {
            out.push(`<path class="branch-stripe" d="${branchStripePath(pos.x - 0.5, pos.y - 0.5, ch + 1, 8.5, 4.5)}" fill="${stripeColor}"/>`);
        }

        if (person && options.cardLines) {
            out.push(customCardSvg(person, pos, cw, options.cardLines.get(personId) ?? [], ring, `av${clipCounter++}`,
                options.cardYears?.get(personId) ?? '', {
                    dateColumn: options.cardDateColumn ?? 0, labelColumn: options.cardLabelColumn ?? 0,
                    valueLines: options.cardValueLines ?? 1, style: options.cardStyle ?? 'marks',
                    measure: options.measureCardTexts ?? estimateCardTexts, exact: !!options.measureCardTexts,
                }));
        } else if (person && !isPlaceholder) {
            // Avatar: gender-ring circle with a photo or initials (like on
            // screen). 34px avatar (r=17), 10px left padding — matches the CSS.
            const cxAv = pos.x + 10 + 17;
            const cyAv = pos.y + ch / 2;
            const hasPhoto = !!person.photo;
            if (hasPhoto) {
                const clipId = `av${clipCounter++}`;
                out.push(`<clipPath id="${clipId}"><circle cx="${cxAv.toFixed(1)}" cy="${cyAv.toFixed(1)}" r="17"/></clipPath>`);
                out.push(`<image href="${escapeXml(person.photo!)}" x="${(cxAv - 17).toFixed(1)}" y="${(cyAv - 17).toFixed(1)}" width="34" height="34" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`);
                out.push(`<circle cx="${cxAv.toFixed(1)}" cy="${cyAv.toFixed(1)}" r="17" fill="none" stroke="${ring}" stroke-width="2"/>`);
            } else {
                const initials = personInitials(person.firstName, person.lastName) || '?';
                out.push(`<circle cx="${cxAv.toFixed(1)}" cy="${cyAv.toFixed(1)}" r="17" fill="${COLORS.avatarBg}" stroke="${ring}" stroke-width="2"/>`);
                out.push(`<text x="${cxAv.toFixed(1)}" y="${(cyAv + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="${COLORS.initials}">${escapeXml(initials)}</text>`);
            }

            // Text column right of the avatar (10px padding + 34px avatar + 9px gap).
            const contentX = pos.x + 10 + 34 + 9;
            const contentW = cw - (contentX - pos.x) - 10;
            const cx = contentX + contentW / 2;

            const fullName = shownName(person, '?');
            // Meta row: life-year range + place; the range carries the deceased cue.
            const birthY = displayYear(person.birthDate);
            const deathY = displayYear(person.deathDate);
            const isDeceasedP = !!options.deceasedSet?.has(personId);
            let metaYears = '';
            if (deathY) metaYears = `${birthY || '?'} – ${deathY}`;
            else if (birthY) metaYears = isDeceasedP ? `${birthY} †` : `* ${birthY}`;
            else if (isDeceasedP) metaYears = '†';
            const metaPlace = person.birthPlace?.trim() || '';
            const meta = [metaYears, metaPlace].filter(Boolean).join(' · ');

            out.push(fittedText(fullName, cx, pos.y + 28, contentW, [15, 13, 11], true, COLORS.text));
            if (meta) {
                out.push(fittedText(meta, cx, pos.y + 45, contentW, [11, 10, 9], false, COLORS.textLight));
            }
        }

        if (dimmed) out.push('</g>');
    }
    out.push('</g>');

    out.push('</g>'); // translate

    // --- Footer (tree name · view label · date) ---
    if (hasFooter) {
        out.push(posterFooterSvg(options, height));
    }

    out.push('</svg>');
    return out.join('\n');
}
