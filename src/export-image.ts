/**
 * Poster export — build a clean, self-contained SVG of the currently laid-out
 * tree from the layout result (positions, connections, spouse lines). This is
 * the source of truth for the SVG download, the PNG raster and the tiled PDF.
 *
 * It reads a LayoutResult but never touches the layout engine.
 */

import { StromData, LayoutConfig, DEFAULT_LAYOUT_CONFIG, PartnershipStatus } from './types.js';
import { LayoutResult } from './layout/pipeline/types.js';
import { displayYear } from './dates.js';
import { personInitials } from './initials.js';

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

/** Spouse-line dash per partnership status (mirror of the renderer). */
function statusDash(status: PartnershipStatus | undefined): { dash?: string; color?: string } {
    switch (status) {
        case 'divorced': return { dash: '8,4', color: '#999999' };
        case 'separated': return { dash: '4,4', color: '#999999' };
        case 'partners': return { dash: '2,2' };
        default: return {};
    }
}

/** Child-drop dash per the child's parent-rel types (mirror of the renderer). */
function relDash(data: StromData, childId: string): string | undefined {
    const child = data.persons[childId as keyof typeof data.persons];
    const types = child?.parentRelTypes ? Object.values(child.parentRelTypes) : [];
    if (types.includes('adoptive')) return '6,4';
    if (types.includes('step') || types.includes('foster')) return '2,3';
    return undefined;
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
    sizes: number[], bold: boolean, fill: string
): string {
    let fs = sizes[0];
    for (const size of sizes) {
        fs = size;
        if (estWidth(text, size, bold) <= maxW) break;
    }
    const clamp = estWidth(text, fs, bold) > maxW
        ? ` textLength="${maxW.toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : '';
    const weight = bold ? ' font-weight="600"' : '';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="${fs}"${weight} fill="${fill}"${clamp}>${escapeXml(text)}</text>`;
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
 * cards are emitted in id order.
 */
export function buildTreeSvg(data: StromData, result: PosterLayout, options: PosterOptions = {}): string {
    const config = options.config ?? DEFAULT_LAYOUT_CONFIG;
    const cw = config.cardWidth;
    const ch = config.cardHeight;
    const bounds = computeBounds(result, config);

    const hasFooter = !!(options.treeName || options.dateLabel || options.viewLabel);
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
        // Stem — down to the CONNECTOR lane, not stemBottomY: lane allocation
        // can place the connector lower (secondary unions in partner chains),
        // and stopping short left visible gaps in the printed lines.
        out.push(line(conn.stemX, conn.stemTopY, conn.stemX, conn.connectorY, COLORS.line));
        if (Math.abs(conn.connectorFromX - conn.connectorToX) > 0.5) {
            // Connector (horizontal), then its drop to the bus lane.
            out.push(line(conn.connectorFromX, conn.connectorY, conn.connectorToX, conn.connectorY, COLORS.line));
            if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
                out.push(line(conn.connectorToX, conn.connectorY, conn.connectorToX, conn.branchY, COLORS.line));
            }
        } else if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
            // Stem sits within the bus range — extend it straight to the bus.
            out.push(line(conn.stemX, conn.connectorY, conn.stemX, conn.branchY, COLORS.line));
        }
        // Bus (horizontal branch)
        if (Math.abs(conn.branchRightX - conn.branchLeftX) > 0.5) {
            out.push(line(conn.branchLeftX, conn.branchY, conn.branchRightX, conn.branchY, COLORS.line));
        }
        // Drops to each child (adoptive dashed, step/foster dotted — parity
        // with the on-screen renderer)
        for (const drop of conn.drops) {
            out.push(line(drop.x, drop.topY ?? conn.branchY, drop.x, drop.bottomY, COLORS.line, relDash(data, drop.personId)));
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
                const cardCenterY = pos.y + ch / 2;
                if (Math.abs(cardCenterY - sl.y) < ch / 2 + 2) {
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
        const isPlaceholder = person?.isPlaceholder;
        const ring = isPlaceholder ? COLORS.placeholderRing
            : (person?.gender === 'male' ? COLORS.male : COLORS.female);

        // "Letopis" card: neutral surface, hairline border (dashed for placeholders).
        const borderDash = isPlaceholder ? ' stroke-dasharray="4,3"' : '';
        out.push(`<rect x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" width="${cw}" height="${ch}" rx="8" fill="${COLORS.cardBg}" stroke="${COLORS.cardBorder}" stroke-width="1"${borderDash}/>`);

        // Branch colour stripe (matches the on-screen ::before bar)
        const branch = options.branchMap?.get(personId);
        const stripeColor = branch ? BRANCH_COLORS[branch] : undefined;
        if (stripeColor) {
            out.push(`<rect x="${(pos.x + 1).toFixed(1)}" y="${(pos.y + 4).toFixed(1)}" width="4" height="${(ch - 8).toFixed(0)}" rx="2" fill="${stripeColor}"/>`);
        }

        if (person && !isPlaceholder) {
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

            const fullName = `${person.firstName || '?'} ${person.lastName || ''}`.trim();
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
