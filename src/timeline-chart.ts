/**
 * Timeline chart SVG builder: turns a TimelineModel (see src/timeline.ts) into
 * an SVG string, in two modes:
 *   - 'screen': byte-identical to the on-canvas renderer output — relies on the
 *     page CSS classes in index.html and uses <foreignObject> HTML labels for
 *     the name column (ellipsis, flex layout).
 *   - 'poster': self-contained — embeds explicit light-theme colours and draws
 *     names as plain <text> (no <foreignObject>, no CSS variables) so the SVG
 *     stands alone in a browser, in Inkscape and when rasterised to PNG.
 *
 * buildTimelinePosterSvg wraps the FULL timeline (every row, the entire time
 * range — not the on-screen scroll viewport) on a white canvas with the shared
 * poster footer. Pure: no DOM access, the renderer wires the container.
 */

import { TimelineModel, TimelineRow, TimelineEvent, yearToFraction, axisTicks } from './timeline.js';
import { strings } from './strings.js';
import {
    posterFooterSvg, PosterFooterMeta, FOOTER_HEIGHT, POSTER_PADDING, POSTER_FONT, POSTER_BG,
} from './export-image.js';

/** Axis-label band above the rows, and the right-hand plot padding. */
const TOP = 40;
const PAD_R = 16;
/** Life-bar colours (mirror of the renderer's inline fills). */
const BAR_MALE = '#8fb8de';
const BAR_FEMALE = '#e8a0bf';

/**
 * Light-theme timeline colours as concrete values, mirroring the `.tl-*` rules
 * in index.html at their light values (and the print overrides used by the
 * DÁVKA-9 timeline print). Emitted inside the poster SVG so it renders
 * identically without the app stylesheet.
 */
const TIMELINE_LIGHT_STYLE =
    '.tl-grid{stroke:#e2e2e2;stroke-width:1}'
    + '.tl-tick{fill:#666;font-size:11px}'
    + '.tl-dot{fill:#444}'
    + '.tl-dot-wedding{fill:#fff;stroke:#d4a017;stroke-width:2}'
    + '.tl-arrow{fill:#aaa}'
    + '.tl-name-txt{fill:#222;font-size:12px}'
    + '.tl-yr-txt{fill:#999;font-size:11px}'
    + '.timeline-bar.focused .tl-bar-rect{stroke:#4a90d9;stroke-width:2.5}';

export interface TimelineSvgOptions {
    /** Escape function for text content (renderer supplies its own). */
    esc: (t: string) => string;
    /** Total SVG width in px. */
    width: number;
    /** Row height in px. */
    rowH: number;
    /** Name-column width in px. */
    labelW: number;
    /** 'screen' uses CSS classes + foreignObject; 'poster' is self-contained. */
    mode: 'screen' | 'poster';
    /** Focused person's row gets the focus stroke. */
    focusId?: string | null;
    /** Search highlight/dim (screen only; the poster never dims content). */
    highlightIds?: ReadonlySet<string> | null;
}

/** Localized label for an event dot's tooltip (mirror of the renderer). */
function eventLabelFor(ev: TimelineEvent): string {
    if (ev.type === 'wedding') return strings.timeline.wedding;
    if (ev.type === 'custom' && ev.customLabel) return ev.customLabel;
    return strings.events.types[ev.type as keyof typeof strings.events.types] ?? String(ev.type);
}

/** Trim `text` to at most `max` characters, appending an ellipsis when cut. */
function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
}

/** The "start–end" year label for a row (living / open-ended / closed). */
function rowYears(r: TimelineRow): string {
    return r.isLiving ? `${r.startYear}–` : r.endKnown ? `${r.startYear}–${r.endYear}` : `${r.startYear}–?`;
}

/** SVG for one timeline row (name label + life-bar + event dots). */
function rowSvg(
    r: TimelineRow, i: number, opts: TimelineSvgOptions, xOf: (y: number) => number
): string {
    const { esc, rowH, labelW, width: rowWidth, mode } = opts;
    const y = TOP + i * rowH;
    const barY = y + (rowH - 14) / 2;
    const x1 = xOf(r.startYear), x2 = xOf(r.endYear);
    const w = Math.max(2, x2 - x1);
    const color = r.gender === 'female' ? BAR_FEMALE : BAR_MALE;
    const focused = r.personId === opts.focusId ? ' focused' : '';
    const highlight = opts.highlightIds
        ? (opts.highlightIds.has(r.personId) ? ' search-hit' : ' search-dim') : '';

    const nameEsc = esc(r.name);
    const yearsStr = rowYears(r);
    const yearsEsc = esc(yearsStr);
    const cy = (barY + 7).toFixed(1);
    const dots = r.events.map(ev => {
        const ex = xOf(ev.year).toFixed(1);
        const label = esc(`${eventLabelFor(ev)} (${ev.year})`);
        const cls = ev.type === 'wedding' ? 'tl-dot tl-dot-wedding' : 'tl-dot';
        const rad = ev.type === 'wedding' ? 4.5 : 3;
        return `<circle cx="${ex}" cy="${cy}" r="${rad}" class="${cls}"><title>${label}</title></circle>`;
    }).join('');
    const arrow = r.isLiving
        ? `<polygon points="${x2.toFixed(1)},${barY} ${(x2 + 7).toFixed(1)},${(barY + 7).toFixed(1)} ${x2.toFixed(1)},${(barY + 14)}" class="tl-arrow"/>`
        : '';
    // Unknown end: fade the bar out to the right ("we don't know further").
    const fadeW = Math.max(0, Math.min(26, rowWidth - x2 - 2));
    const fade = !r.endKnown && fadeW > 4
        ? `<rect x="${x2.toFixed(1)}" y="${barY}" width="${fadeW.toFixed(1)}" height="14"`
          + ` fill="url(#tl-fade-${r.gender})"/>`
        : '';

    // Name label: HTML in <foreignObject> on screen (ellipsis, flex); a plain
    // <text> in the poster so the SVG needs no external CSS and rasterises to
    // PNG (foreignObject is dropped/tainting on canvas).
    let label: string;
    if (mode === 'poster') {
        const ty = (y + rowH / 2).toFixed(1);
        const avail = labelW - 8;
        const yearsW = yearsStr.length * 11 * 0.55;
        const nameChars = Math.max(3, Math.floor((avail - yearsW - 6) / (12 * 0.55)));
        const nameFit = esc(truncate(r.name, nameChars));
        label = `<text x="4" y="${ty}" dominant-baseline="middle">`
            + `<tspan class="tl-name-txt">${nameFit}</tspan>`
            + ` <tspan class="tl-yr-txt">${yearsEsc}</tspan></text>`;
    } else {
        label = `<foreignObject x="2" y="${y}" width="${labelW - 6}" height="${rowH}">`
            + `<div xmlns="http://www.w3.org/1999/xhtml" class="tl-name" title="${nameEsc}">`
            + `<span class="tl-nm">${nameEsc}</span> <span class="tl-yr">${yearsEsc}</span></div></foreignObject>`;
    }

    return `<g class="timeline-bar${focused}${highlight}" data-person-id="${esc(r.personId)}">`
        + `<rect x="0" y="${y}" width="${rowWidth}" height="${rowH}" class="tl-rowhit" fill="transparent"/>`
        + label
        + `<rect x="${x1.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="14" rx="3" fill="${color}" class="tl-bar-rect"/>`
        + `${fade}${arrow}${dots}</g>`;
}

/**
 * Build the timeline SVG string. In 'screen' mode this is byte-identical to the
 * former inline renderer markup; in 'poster' mode it embeds its own light-theme
 * styles and self-contained name labels.
 */
export function buildTimelineSvg(model: TimelineModel, opts: TimelineSvgOptions): string {
    const { width: W, rowH: ROW_H, labelW: LABEL_W, mode } = opts;
    const plotX0 = LABEL_W;
    const plotW = Math.max(40, W - LABEL_W - PAD_R);
    const H = TOP + model.rows.length * ROW_H + 12;
    const xOf = (year: number) => plotX0 + yearToFraction(year, model.axis) * plotW;

    const grid = axisTicks(model.axis).map(yr => {
        const x = xOf(yr).toFixed(1);
        return `<line x1="${x}" y1="${TOP - 6}" x2="${x}" y2="${H}" class="tl-grid"/>`
            + `<text x="${x}" y="${TOP - 14}" text-anchor="middle" class="tl-tick">${yr}</text>`;
    }).join('');

    const rows = model.rows.map((r, i) => rowSvg(r, i, opts, xOf)).join('');

    // Fade-out gradients for bars with an unknown end (deceased, no death date).
    const fadeStops = (color: string) =>
        `<stop offset="0" stop-color="${color}" stop-opacity="0.85"/>`
        + `<stop offset="1" stop-color="${color}" stop-opacity="0"/>`;
    const defs = `<defs>`
        + `<linearGradient id="tl-fade-male" x1="0" y1="0" x2="1" y2="0">${fadeStops(BAR_MALE)}</linearGradient>`
        + `<linearGradient id="tl-fade-female" x1="0" y1="0" x2="1" y2="0">${fadeStops(BAR_FEMALE)}</linearGradient>`
        + `</defs>`;

    const style = mode === 'poster' ? `<style>${TIMELINE_LIGHT_STYLE}</style>` : '';
    return `<svg class="timeline-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`
        + `${style}${defs}${grid}${rows}</svg>`;
}

// ==================== TIMELINE POSTER ====================

/** Poster layout constants — generous, since the poster is not clamped to a
 *  screen width. Timeline posters are typically WIDE and SHORT. */
const POSTER_ROW_H = 30;
const POSTER_LABEL_W = 190;
/** Horizontal spread: pixels per year across the axis (min plot width 600). */
const POSTER_PX_PER_YEAR = 8;

/** Everything the poster tiler needs about a timeline poster. */
export interface TimelinePosterGeometry {
    /** Inner timeline SVG width (no poster padding). */
    innerW: number;
    /** Inner timeline SVG height (no poster padding / footer). */
    innerH: number;
    /** Total poster width in px (timeline + padding). */
    width: number;
    /** Total poster height in px (timeline + padding + footer). */
    height: number;
    hasContent: (x: number, y: number, w: number, h: number) => boolean;
}

/**
 * Poster-space geometry for a timeline: total pixel size (with padding and an
 * optional footer strip) and a content predicate for tile skipping. The
 * timeline is dense — a filled axis+rows band spans the whole inner rectangle —
 * so the predicate is simply "the inner band OR the footer strip". Conservative:
 * it never drops a sheet that could carry a bar.
 */
export function timelinePosterGeometry(model: TimelineModel, hasFooter: boolean): TimelinePosterGeometry {
    const span = Math.max(0, model.axis.maxYear - model.axis.minYear);
    const plotW = Math.max(600, Math.round(span * POSTER_PX_PER_YEAR));
    const innerW = POSTER_LABEL_W + plotW + PAD_R;
    const innerH = TOP + model.rows.length * POSTER_ROW_H + 12;
    const footer = hasFooter ? FOOTER_HEIGHT : 0;
    const width = innerW + POSTER_PADDING * 2;
    const height = innerH + POSTER_PADDING * 2 + footer;

    const inner = { x: POSTER_PADDING, y: POSTER_PADDING, w: innerW, h: innerH };
    const footerRect = { x: POSTER_PADDING, y: height - footer, w: 420, h: footer };
    const overlaps = (o: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number) =>
        o.x < x + w && o.x + o.w > x && o.y < y + h && o.y + o.h > y;
    const hasContent = (x: number, y: number, w: number, h: number): boolean => {
        if (footer > 0 && overlaps(footerRect, x, y, w, h)) return true;
        return overlaps(inner, x, y, w, h);
    };
    return { innerW, innerH, width, height, hasContent };
}

/**
 * Wrap the full timeline as a self-contained poster: white background, explicit
 * light-theme colours, and the shared poster footer (tree name · view label ·
 * date). Reuses `posterFooterSvg` so the timeline shares the tree/fan footer.
 */
export function buildTimelinePosterSvg(
    model: TimelineModel, opts: Pick<TimelineSvgOptions, 'esc' | 'focusId'>, meta: PosterFooterMeta
): string {
    const hasFooter = !!(meta.treeName || meta.viewLabel || meta.dateLabel);
    const g = timelinePosterGeometry(model, hasFooter);

    // Poster-safe timeline: self-contained colours, plain-text labels, no search
    // dimming (the poster prints every row at full opacity).
    const inner = buildTimelineSvg(model, {
        esc: opts.esc,
        focusId: opts.focusId ?? null,
        highlightIds: null,
        width: g.innerW,
        rowH: POSTER_ROW_H,
        labelW: POSTER_LABEL_W,
        mode: 'poster',
    });
    // Embed the timeline as a nested SVG offset by the padding. buildTimelineSvg
    // already emits width="innerW" height="innerH" (== g.innerW/g.innerH), so we
    // add ONLY x/y here — re-adding width/height would duplicate those attributes
    // and make the SVG invalid XML, which silently fails to decode as an <img>
    // (blank print tiles / PNG). The existing viewport already maps 1:1 to px.
    const nested = inner.replace(
        '<svg class="timeline-svg"',
        `<svg class="timeline-svg" x="${POSTER_PADDING}" y="${POSTER_PADDING}"`);

    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" font-family="${POSTER_FONT}">`);
    out.push(`<rect x="0" y="0" width="${g.width}" height="${g.height}" fill="${POSTER_BG}"/>`);
    out.push(nested);
    if (hasFooter) out.push(posterFooterSvg(meta, g.height));
    out.push('</svg>');
    return out.join('\n');
}
