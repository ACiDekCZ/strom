/**
 * Poster export — build a clean, self-contained SVG of the currently laid-out
 * tree from the layout result (positions, connections, spouse lines). This is
 * the source of truth for the SVG download, the PNG raster and the tiled PDF.
 *
 * It reads a LayoutResult but never touches the layout engine.
 */

import { StromData, LayoutConfig, DEFAULT_LAYOUT_CONFIG } from './types.js';
import { LayoutResult } from './layout/pipeline/types.js';
import { displayYear } from './dates.js';

/** The subset of a LayoutResult the poster needs (no diagnostics required). */
export type PosterLayout = Pick<LayoutResult, 'positions' | 'connections' | 'spouseLines'>;

/** Light-theme colors matching the on-canvas card styles. */
const COLORS = {
    male: { fill: '#e3f2fd', stroke: '#90caf9' },
    female: { fill: '#fce4ec', stroke: '#f48fb1' },
    placeholder: { fill: '#f5f5f5', stroke: '#999999' },
    line: '#333333',
    spouse: '#666666',
    text: '#333333',
    textLight: '#666666',
    footer: '#888888',
    background: '#ffffff',
};

const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PADDING = 40;
const FOOTER_HEIGHT = 44;

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
    config?: LayoutConfig;
}

/** Bounding box of all cards (card top-left..bottom-right) in layout space. */
export function computeBounds(result: PosterLayout, config: LayoutConfig = DEFAULT_LAYOUT_CONFIG): SvgBounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of result.positions.values()) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + config.cardWidth);
        maxY = Math.max(maxY, pos.y + config.cardHeight);
    }
    if (!isFinite(minX)) {
        minX = minY = maxX = maxY = 0;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, dash = false): string {
    const d = dash ? ' stroke-dasharray="5,3"' : '';
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="1.5"${d}/>`;
}

/**
 * Build a self-contained SVG string for the laid-out tree. Deterministic:
 * cards are emitted in id order.
 */
export function buildTreeSvg(data: StromData, result: PosterLayout, options: PosterOptions = {}): string {
    const config = options.config ?? DEFAULT_LAYOUT_CONFIG;
    const cw = config.cardWidth;
    const ch = config.cardHeight;
    const bounds = computeBounds(result, config);

    const hasFooter = !!(options.treeName || options.dateLabel);
    const footer = hasFooter ? FOOTER_HEIGHT : 0;
    const width = bounds.width + PADDING * 2;
    const height = bounds.height + PADDING * 2 + footer;
    const ox = -bounds.minX + PADDING;
    const oy = -bounds.minY + PADDING;

    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" font-family="${FONT}">`);
    out.push(`<rect x="0" y="0" width="${width.toFixed(0)}" height="${height.toFixed(0)}" fill="${COLORS.background}"/>`);
    out.push(`<g transform="translate(${ox.toFixed(1)}, ${oy.toFixed(1)})">`);

    // --- Connections (parent -> children bus routing) ---
    out.push('<g class="connections">');
    for (const conn of result.connections) {
        // Stem
        out.push(line(conn.stemX, conn.stemTopY, conn.stemX, conn.stemBottomY, COLORS.line));
        // Connector (horizontal)
        if (Math.abs(conn.connectorFromX - conn.connectorToX) > 0.5) {
            out.push(line(conn.connectorFromX, conn.connectorY, conn.connectorToX, conn.connectorY, COLORS.line));
        }
        // Connector drop to bus
        if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
            out.push(line(conn.connectorToX, conn.connectorY, conn.connectorToX, conn.branchY, COLORS.line));
        }
        // Bus (horizontal branch)
        if (Math.abs(conn.branchRightX - conn.branchLeftX) > 0.5) {
            out.push(line(conn.branchLeftX, conn.branchY, conn.branchRightX, conn.branchY, COLORS.line));
        }
        // Drops to each child
        for (const drop of conn.drops) {
            out.push(line(drop.x, drop.topY ?? conn.branchY, drop.x, drop.bottomY, COLORS.line));
        }
    }
    out.push('</g>');

    // --- Spouse lines ---
    out.push('<g class="spouse-lines">');
    for (const sl of result.spouseLines) {
        if (Math.abs(sl.xMax - sl.xMin) > 0.5) {
            out.push(line(sl.xMin, sl.y, sl.xMax, sl.y, COLORS.spouse, true));
        }
    }
    out.push('</g>');

    // --- Cards (id order for deterministic output) ---
    out.push('<g class="cards">');
    const entries = [...result.positions.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const [personId, pos] of entries) {
        const person = data.persons[personId];
        const isPlaceholder = person?.isPlaceholder;
        const palette = isPlaceholder ? COLORS.placeholder : (person?.gender === 'male' ? COLORS.male : COLORS.female);
        const cx = pos.x + cw / 2;

        out.push(`<rect x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" width="${cw}" height="${ch}" rx="8" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.5"/>`);

        if (person) {
            const firstName = person.firstName || '?';
            const surname = person.lastName || '';
            const year = displayYear(person.birthDate);
            out.push(`<text x="${cx.toFixed(1)}" y="${(pos.y + 24).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="600" fill="${COLORS.text}">${escapeXml(firstName)}</text>`);
            if (surname) {
                out.push(`<text x="${cx.toFixed(1)}" y="${(pos.y + 40).toFixed(1)}" text-anchor="middle" font-size="12" fill="${COLORS.textLight}">${escapeXml(surname)}</text>`);
            }
            if (year) {
                out.push(`<text x="${cx.toFixed(1)}" y="${(pos.y + 56).toFixed(1)}" text-anchor="middle" font-size="11" fill="${COLORS.textLight}">${escapeXml(year)}</text>`);
            }
        }
    }
    out.push('</g>');

    out.push('</g>'); // translate

    // --- Footer ---
    if (hasFooter) {
        const fy = height - footer / 2;
        const title = options.treeName ? escapeXml(options.treeName) : '';
        const date = options.dateLabel ? escapeXml(options.dateLabel) : '';
        if (title) {
            out.push(`<text x="${PADDING}" y="${fy.toFixed(1)}" font-size="16" font-weight="600" fill="${COLORS.text}" dominant-baseline="middle">${title}</text>`);
        }
        if (date) {
            out.push(`<text x="${(width - PADDING).toFixed(1)}" y="${fy.toFixed(1)}" font-size="12" text-anchor="end" fill="${COLORS.footer}" dominant-baseline="middle">${date}</text>`);
        }
    }

    out.push('</svg>');
    return out.join('\n');
}
