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

import {
    TimelineModel, TimelineRow, TimelineEvent, TimelineHistory, TimelineHistoryItem, TimelineSharedMark,
    yearToFraction, axisTicks, axisLabelStep, clusterTimelineHistory, timelineHistoryYears,
} from './timeline.js';
import { strings } from './strings.js';
import { historyKindSvg } from './history-symbols.js';
import { graphemes } from './text-clip.js';
import {
    posterFooterSvg, posterFooterHeight, PosterFooterMeta, POSTER_PADDING, POSTER_FONT, POSTER_BG,
} from './export-image.js';

/** Axis-label band above the rows, and the right-hand plot padding. */
const TOP = 40;
const PAD_R = 16;
/**
 * Fallback life-bar colours — the light-theme `--male` / `--female` token
 * values. Callers pass resolved colours (screen: the `var(--male/--female)`
 * tokens directly; poster: hex read via getComputedStyle at export time);
 * these apply only when a caller supplies none.
 */
const FALLBACK_MALE = '#5b7f9e';
const FALLBACK_FEMALE = '#a1706e';
const FALLBACK_UNKNOWN = '#857d6c';

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
    + '.timeline-bar.focused .tl-bar-rect{stroke:#3f6b4f;stroke-width:2.5}'
    + '.tl-shared-mark{fill:#3f6b4f;opacity:.9}'
    + '.tl-shared-link{stroke:#3f6b4f;stroke-width:2;opacity:.5}'
    + '.tl-shared-label{fill:#2f5a3f;font-size:11.5px;font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}';

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
    /** Male life-bar fill. Screen: 'var(--male)'. Poster: resolved hex. */
    maleColor?: string;
    /** Female life-bar fill. Screen: 'var(--female)'. Poster: resolved hex. */
    femaleColor?: string;
    /** Life-bar fill for a sex the records do not give. Screen: 'var(--unknown)'. Poster: resolved hex. */
    unknownColor?: string;
    /** A phone's narrow layout: the history row 26 px, its clusters 22 px apart, its label without the name. */
    narrow?: boolean;
    /** A shared mark's label width in px as drawn (screen: measured in the page's font); default an estimate. */
    measureLabel?: (text: string) => number;
}

/** The history row's height (DEV symboly-dejin §9): 28 px, a phone 26 px. */
export function historyRowHeight(narrow: boolean): number {
    return narrow ? 26 : 28;
}

/** Events closer than this (px) to a cluster's first event join it: 16 px, a phone 22 px. */
export function historyClusterGap(narrow: boolean): number {
    return narrow ? 22 : 16;
}

/** A history event's year text: "1866", a period "1897–1901". */
function historyItemYears(e: TimelineHistoryItem): string {
    return e.year2 !== undefined ? `${e.year}–${e.year2}` : String(e.year);
}

function historyKindName(e: TimelineHistoryItem): string {
    return strings.history.kinds[e.kind] ?? strings.history.kinds.other;
}

/**
 * The focused person's history row under the axis band (§9, variant 9a): the
 * label "History · name" in the name column, a tint over the person's life,
 * each cluster the first event's kind symbol coloured by its origin, a count
 * badge for more, a period's 3 px stripe, the list on hover (<title>). A
 * cluster is a button (Enter / a click: the renderer opens the card or, on a
 * phone, a sheet) with a 44 × 44 touch target. Screen only: never printed,
 * never on the poster.
 */
function historyRowSvg(
    h: TimelineHistory, opts: TimelineSvgOptions, xOf: (y: number) => number, rowH: number, plotX0: number,
): string {
    const { esc, labelW, width: W } = opts;
    const narrow = !!opts.narrow;
    const S = strings.history;
    const cy = TOP + rowH / 2;
    const who = `${S.timelineRowLabel} · ${h.name}`;
    const label = `<foreignObject x="2" y="${TOP}" width="${labelW - 6}" height="${rowH}">`
        + `<div xmlns="http://www.w3.org/1999/xhtml" class="tl-hist-label" title="${esc(who)}"><span class="tl-hist-txt">`
        + `<b>${esc(S.timelineRowLabel)}</b>${narrow || !h.name ? '' : ` · ${esc(h.name)}`}</span></div></foreignObject>`;
    const bx1 = Math.max(plotX0 - 4, xOf(h.startYear) - 10);
    const bx2 = Math.min(W - 2, xOf(h.endYear) + 10);
    const band = `<rect class="tl-hist-band" x="${bx1.toFixed(1)}" y="${TOP + 3}" width="${Math.max(0, bx2 - bx1).toFixed(1)}"`
        + ` height="${rowH - 6}" rx="6"/>`;
    const periods = h.events.filter(e => e.year2 !== undefined).map(e => {
        const x1 = xOf(e.year), x2 = xOf(e.year2!);
        return `<rect class="tl-hist-period is-${e.scope}" x="${x1.toFixed(1)}" y="${(cy + 8).toFixed(1)}"`
            + ` width="${Math.max(2, x2 - x1).toFixed(1)}" height="3" rx="1.5"/>`;
    }).join('');
    const clusters = clusterTimelineHistory(h.events, xOf, historyClusterGap(narrow)).map(c => {
        const first = c.items[0];
        const x = c.x;
        const kinds = [...new Set(c.items.map(historyKindName))].join(', ');
        const aria = S.timelineClusterAria(timelineHistoryYears(c.items), kinds);
        const tip = c.items.map(e => `${historyItemYears(e)} ${historyKindName(e)} – ${e.text}`).join('\n');
        const sym = historyKindSvg(first.kind, 12).replace('<svg ', `<svg x="${(x - 6).toFixed(1)}" y="${(cy - 6).toFixed(1)}" `);
        const n = c.items.length;
        let badge = '';
        if (n > 1) {
            const bw = Math.max(13, 5 + String(n).length * 6);
            const bx = x + 3, by = cy - 14;
            badge = `<rect class="tl-hist-n" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw}" height="13" rx="6.5"/>`
                + `<text class="tl-hist-n-txt" x="${(bx + bw / 2).toFixed(1)}" y="${(by + 6.5).toFixed(1)}"`
                + ` text-anchor="middle" dominant-baseline="central" aria-hidden="true">${n}</text>`;
        }
        const ids = c.items.map(e => encodeURIComponent(e.id)).join(' ');
        return `<g class="tl-hist is-${first.scope}" role="button" tabindex="0" aria-label="${esc(aria)}" data-hist-ids="${esc(ids)}">`
            + `<title>${esc(tip)}</title>`
            + `<rect class="tl-hist-hit" x="${(x - 22).toFixed(1)}" y="${(cy - 22).toFixed(1)}" width="44" height="44" fill="transparent"/>`
            + `<rect class="tl-hist-ring" x="${(x - 9).toFixed(1)}" y="${(cy - 9).toFixed(1)}" width="18" height="18" rx="5"/>`
            + `${sym}${badge}</g>`;
    }).join('');
    return `<g class="tl-hist-row" data-hist-person="${esc(h.personId)}">${label}${band}`
        + `<g aria-hidden="true">${periods}</g>${clusters}</g>`;
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

/** The mark's label: "Census 1921". */
function sharedMarkLabel(m: TimelineSharedMark): string {
    return `${eventLabelFor({ year: m.year, type: m.type, ...(m.customLabel ? { customLabel: m.customLabel } : {}) })} ${m.year}`;
}

/** The shared marks' label font size (px), as `.tl-shared-label` sets it. */
const SHARED_LABEL_FS = 11.5;
/** A label's box around its baseline: the ascent above, the descent and halo below. */
const SHARED_LABEL_ASC = 11.5;
const SHARED_LABEL_DESC = 3.5;
/** Room kept between a label and a mark or another label. */
const SHARED_LABEL_PAD = 2;
/** A label beside its mark keeps at most this far from it (px), so it still reads as its own. */
const SHARED_LABEL_REACH = 30;

interface Box { x1: number; y1: number; x2: number; y2: number }

const boxesOverlap = (a: Box, b: Box): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** One shared mark's geometry: the bars over its runs of rows, the links between them. */
interface SharedMarkGeom {
    mark: TimelineSharedMark;
    x: number;
    bars: Box[];
    links: Box[];
    label: string;
}

function sharedMarkGeom(m: TimelineSharedMark, rowH: number, xOf: (y: number) => number): SharedMarkGeom {
    const x = xOf(m.year);
    const barTop = (i: number): number => TOP + i * rowH + (rowH - 14) / 2;
    const runs: [number, number][] = [];
    for (const i of m.rows) {
        const last = runs[runs.length - 1];
        if (last && last[1] === i - 1) last[1] = i;
        else runs.push([i, i]);
    }
    const bars = runs.map(([a, b]) => ({ x1: x - 7, y1: barTop(a) - 3, x2: x + 7, y2: barTop(b) + 17 }));
    const links = runs.slice(1).map(([a], k) => ({ x1: x - 1, y1: barTop(runs[k][1]) + 17, x2: x + 1, y2: barTop(a) - 3 }));
    return { mark: m, x, bars, links, label: sharedMarkLabel(m) };
}

/** Where a mark's label goes: its text (cut short with "…" when nothing longer fits) and its box. */
interface SharedLabelSpot { text: string; x1: number; baseline: number }

/**
 * Places the marks' labels so that none lies over a mark (its own included)
 * or over another label: centred above the mark's top row when that is
 * free, else beside the mark (right, then left) in the gap above one of its
 * rows or below its last, the nearest such spot first; only when no spot
 * holds the whole label, the longest text cut with "…" that fits; none at
 * all when not even a few characters do (the tooltip still names it).
 */
export function placeSharedLabels(
    geoms: readonly { x: number; bars: readonly Box[]; links: readonly Box[]; label: string; rows: readonly number[] }[],
    o: { rowH: number; rowCount: number; plotX0: number; plotX1: number; measure: (text: string) => number },
): (SharedLabelSpot | null)[] {
    const obstacles: Box[] = geoms.flatMap(g => [...g.bars, ...g.links]);
    const placed: Box[] = [];
    const out: (SharedLabelSpot | null)[] = geoms.map(() => null);
    const baselineOf = (gap: number): number => TOP + gap * o.rowH + (o.rowH - 14) / 2 - 6.5;
    const order = geoms.map((g, i) => i).sort((a, b) => (geoms[a].rows[0] - geoms[b].rows[0]) || (geoms[a].x - geoms[b].x));
    for (const i of order) {
        const g = geoms[i];
        const first = g.rows[0], last = g.rows[g.rows.length - 1];
        const fit = (text: string): { spot: SharedLabelSpot; box: Box } | null => {
            const w = o.measure(text);
            if (w > o.plotX1 - o.plotX0) return null;
            let best: { spot: SharedLabelSpot; box: Box; cost: number } | null = null;
            for (let gap = first; gap <= Math.min(last + 1, o.rowCount); gap++) {
                const baseline = baselineOf(gap);
                const y1 = baseline - SHARED_LABEL_ASC, y2 = baseline + SHARED_LABEL_DESC;
                const inBand = [...obstacles, ...placed].filter(b => b.y1 < y2 && y1 < b.y2);
                // Left edges to try: centred on the mark, right after each thing in the band, before each.
                const lefts = new Set<number>([g.x - w / 2]);
                for (const b of inBand) {
                    lefts.add(b.x2 + SHARED_LABEL_PAD);
                    lefts.add(b.x1 - SHARED_LABEL_PAD - w);
                }
                for (const raw of lefts) {
                    const x1 = Math.min(Math.max(raw, o.plotX0), o.plotX1 - w);
                    const box = { x1, y1, x2: x1 + w, y2 };
                    // Apart from the mark: no nearer than its bar's edge allows, no farther than the reach.
                    const away = Math.max(0, x1 - (g.x + 7), (g.x - 7) - (x1 + w));
                    if (away > SHARED_LABEL_REACH) continue;
                    const grown = { x1: box.x1 - SHARED_LABEL_PAD / 2, y1, x2: box.x2 + SHARED_LABEL_PAD / 2, y2 };
                    if (inBand.some(b => boxesOverlap(grown, b))) continue;
                    const cost = Math.abs(x1 + w / 2 - g.x) + (gap === first ? 0 : 20 + 4 * (gap - first));
                    if (!best || cost < best.cost - 0.01) best = { spot: { text, x1, baseline }, box, cost };
                }
            }
            return best;
        };
        let got = fit(g.label);
        if (!got) {
            const chars = graphemes(g.label);
            for (let n = chars.length - 1; n >= 4 && !got; n--) got = fit(`${chars.slice(0, n).join('').trimEnd()}…`);
        }
        if (got) {
            out[i] = got.spot;
            placed.push(got.box);
        }
    }
    return out;
}

/** A label's width (px) without a measure: a little wider than the app's sans at 11.5 px semibold. */
function estimateLabelWidth(text: string): number {
    return graphemes(text).length * SHARED_LABEL_FS * 0.62;
}

/**
 * A shared event's one mark across the rows of its persons (spec 085 §2e):
 * a 14 px wide rounded bar over each run of adjacent rows in it, a thin line
 * past the rows between that are not, the label once near the top where it
 * covers no mark and no other label. The mark lets clicks through to the
 * rows; its label names the persons.
 */
function sharedMarkSvg(g: SharedMarkGeom, spot: SharedLabelSpot | null, rows: readonly TimelineRow[], opts: TimelineSvgOptions): string {
    const { esc } = opts;
    const m = g.mark;
    const bars = g.bars.map(b =>
        `<rect class="tl-shared-mark" x="${b.x1.toFixed(1)}" y="${b.y1.toFixed(1)}" width="14" height="${(b.y2 - b.y1).toFixed(1)}" rx="7"/>`).join('');
    const links = g.links.map(b =>
        `<line class="tl-shared-link" x1="${g.x.toFixed(1)}" y1="${b.y1.toFixed(1)}" x2="${g.x.toFixed(1)}" y2="${b.y2.toFixed(1)}"/>`).join('');
    const who = m.rows.map(i => rows[i]?.name ?? '').filter(Boolean).join(', ');
    const text = spot
        ? `<text class="tl-shared-label" x="${spot.x1.toFixed(1)}" y="${spot.baseline.toFixed(1)}" text-anchor="start">${esc(spot.text)}</text>`
        : '';
    return `<g class="tl-shared" data-share="${esc(m.shareId)}"><g class="tl-shared-bars" pointer-events="none">${links}${bars}</g>`
        + `<g class="tl-shared-tip"><title>${esc(`${g.label}: ${who}`)}</title>${text}</g></g>`;
}

/** SVG for one timeline row (name label + life-bar + event dots). */
function rowSvg(
    r: TimelineRow, i: number, opts: TimelineSvgOptions, xOf: (y: number) => number, marked: ReadonlySet<string> = new Set(),
): string {
    const { esc, rowH, labelW, width: rowWidth, mode } = opts;
    const y = TOP + i * rowH;
    const barY = y + (rowH - 14) / 2;
    const x1 = xOf(r.startYear), x2 = xOf(r.endYear);
    const w = Math.max(2, x2 - x1);
    const color = r.gender === 'female'
        ? (opts.femaleColor ?? FALLBACK_FEMALE)
        : r.gender === 'unknown' ? (opts.unknownColor ?? FALLBACK_UNKNOWN)
        : (opts.maleColor ?? FALLBACK_MALE);
    const focused = r.personId === opts.focusId ? ' focused' : '';
    const highlight = opts.highlightIds
        ? (opts.highlightIds.has(r.personId) ? ' search-hit' : ' search-dim') : '';

    const nameEsc = esc(r.name);
    const yearsStr = rowYears(r);
    const yearsEsc = esc(yearsStr);
    const cy = (barY + 7).toFixed(1);
    const dots = r.events.filter(ev => !ev.shareId || !marked.has(ev.shareId)).map(ev => {
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
          + ` fill="url(#tl-fade-${r.gender === 'female' || r.gender === 'unknown' ? r.gender : 'male'})"/>`
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
            + `<div xmlns="http://www.w3.org/1999/xhtml" class="tl-name" title="${r.fullName ? esc(r.fullName) : nameEsc}">`
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
    // The focused person's history row (screen only): under the axis band, the rows below it.
    const hist = mode === 'screen' ? model.history : undefined;
    const histH = hist ? historyRowHeight(!!opts.narrow) : 0;
    const H = TOP + histH + model.rows.length * ROW_H + 12;
    const xOf = (year: number) => plotX0 + yearToFraction(year, model.axis) * plotW;

    // Labels only as dense as they fit; decade lines unless they would merge
    // into a solid band, then only at the labels.
    const labelStep = axisLabelStep(model.axis, plotW);
    const decadePx = 10 * plotW / Math.max(1, model.axis.maxYear - model.axis.minYear);
    const gridStep = decadePx >= 8 ? 10 : labelStep;
    // Round years (1900, 1950), not steps from the first decade (860, 910).
    const grid = axisTicks(model.axis).filter(yr => yr % gridStep === 0).map(yr => {
        const x = xOf(yr).toFixed(1);
        return `<line x1="${x}" y1="${TOP - 6}" x2="${x}" y2="${H}" class="tl-grid"/>`
            + (yr % labelStep === 0
                ? `<text x="${x}" y="${TOP - 14}" text-anchor="middle" class="tl-tick">${yr}</text>` : '');
    }).join('');

    // A shared event of two rows or more: one mark instead of the rows' dots, drawn over them (spec 085 §2e).
    const shared = model.shared ?? [];
    const marked = new Set(shared.map(m => m.shareId));
    const geoms = shared.map(m => sharedMarkGeom(m, ROW_H, xOf));
    const spots = placeSharedLabels(geoms.map(g => ({ ...g, rows: g.mark.rows })), {
        rowH: ROW_H, rowCount: model.rows.length, plotX0, plotX1: plotX0 + plotW, measure: opts.measureLabel ?? estimateLabelWidth,
    });
    const marks = geoms.map((g, i) => sharedMarkSvg(g, spots[i], model.rows, opts)).join('');
    const rowsSvg = model.rows.map((r, i) => rowSvg(r, i, opts, xOf, marked)).join('') + marks;
    // Shifted by the history row; print drops the row and the shift (index.html @media print).
    const rows = hist ? `<g class="tl-rows" transform="translate(0 ${histH})">${rowsSvg}</g>` : rowsSvg;
    // Drawn after the rows: a cluster's touch target may reach into the first row.
    const histRow = hist ? historyRowSvg(hist, opts, xOf, histH, plotX0) : '';

    // Fade-out gradients for bars with an unknown end (deceased, no death date).
    const maleColor = opts.maleColor ?? FALLBACK_MALE;
    const femaleColor = opts.femaleColor ?? FALLBACK_FEMALE;
    const unknownColor = opts.unknownColor ?? FALLBACK_UNKNOWN;
    const fadeStops = (color: string) =>
        `<stop offset="0" stop-color="${color}" stop-opacity="0.85"/>`
        + `<stop offset="1" stop-color="${color}" stop-opacity="0"/>`;
    const defs = `<defs>`
        + `<linearGradient id="tl-fade-male" x1="0" y1="0" x2="1" y2="0">${fadeStops(maleColor)}</linearGradient>`
        + `<linearGradient id="tl-fade-female" x1="0" y1="0" x2="1" y2="0">${fadeStops(femaleColor)}</linearGradient>`
        + `<linearGradient id="tl-fade-unknown" x1="0" y1="0" x2="1" y2="0">${fadeStops(unknownColor)}</linearGradient>`
        + `</defs>`;

    const style = mode === 'poster' ? `<style>${TIMELINE_LIGHT_STYLE}</style>` : '';
    return `<svg class="timeline-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`
        + `${style}${defs}${grid}${rows}${histRow}</svg>`;
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
 * it never drops a sheet that could carry a bar. The footer strip is as tall
 * as `meta`'s footer takes in the poster's width (posterFooterHeight).
 */
export function timelinePosterGeometry(model: TimelineModel, meta: PosterFooterMeta): TimelinePosterGeometry {
    const span = Math.max(0, model.axis.maxYear - model.axis.minYear);
    const plotW = Math.max(600, Math.round(span * POSTER_PX_PER_YEAR));
    const innerW = POSTER_LABEL_W + plotW + PAD_R;
    const innerH = TOP + model.rows.length * POSTER_ROW_H + 12;
    const width = innerW + POSTER_PADDING * 2;
    const footer = posterFooterHeight(meta, width);
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
    model: TimelineModel,
    opts: Pick<TimelineSvgOptions, 'esc' | 'focusId' | 'maleColor' | 'femaleColor' | 'unknownColor'>,
    meta: PosterFooterMeta
): string {
    const g = timelinePosterGeometry(model, meta);

    // Poster-safe timeline: self-contained colours, plain-text labels, no search
    // dimming (the poster prints every row at full opacity). Bar fills are the
    // resolved gender tokens (var() cannot be rasterised without a CSS context).
    const inner = buildTimelineSvg(model, {
        esc: opts.esc,
        focusId: opts.focusId ?? null,
        highlightIds: null,
        width: g.innerW,
        rowH: POSTER_ROW_H,
        labelW: POSTER_LABEL_W,
        mode: 'poster',
        maleColor: opts.maleColor,
        femaleColor: opts.femaleColor,
        unknownColor: opts.unknownColor,
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
    const footer = posterFooterSvg(meta, g.height, g.width);
    if (footer) out.push(footer);
    out.push('</svg>');
    return out.join('\n');
}
