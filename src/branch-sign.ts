/**
 * The lineage sign (spec 112 §3): the marker chosen in the settings at the
 * legend's size, put before a name where no card carries it — the Timeline's
 * name column and the Table's Lineage column.
 *
 * On screen it is the legend's element (`.branch-swatch[data-shape][data-line]`
 * in index.html, which follows the theme); the Timeline's poster draws it in
 * SVG with the light theme's P2 hex, as the tree image draws its cards. A
 * person on both sides carries both signs (R4); with two same-gender parents
 * the tag's letters are 1 and 2 (R5). The tint is never used here.
 */

import type { Branch, BranchSet } from './branch-colors.js';
import { branchesOf } from './branch-colors.js';
import type { BranchMarker } from './types.js';
import { BRANCH_COLORS, BRANCH_HATCH_ID, BRANCH_INK, branchStripePath } from './branch-marker-svg.js';

/** The width of a sign's slot before a name (px): one sign centred in it; two signs (R4) widen it. */
export const BRANCH_SIGN_SLOT = 18;
/** The gap between the two signs of a person on both sides (px). */
export const BRANCH_SIGN_GAP = 3;

/** The drawn width of one sign per shape (the legend's sizes). */
const SIGN_W: Readonly<Record<Exclude<BranchMarker, 'off'>, number>> = { arc: 10, tag: 13, stripe: 4, corner: 15 };

/** The lines a set shows signs for: none while the markers are off. */
export function branchSignLines(set: BranchSet | undefined, marker: BranchMarker | undefined): Branch[] {
    if (!marker || marker === 'off') return [];
    return branchesOf(set);
}

/** The width (px) the signs of `lines` take in a name's slot: at least the slot, two signs side by side. */
export function branchSignWidth(lines: readonly Branch[], marker: BranchMarker): number {
    if (marker === 'off' || lines.length === 0) return BRANCH_SIGN_SLOT;
    const w = lines.length * SIGN_W[marker] + (lines.length - 1) * BRANCH_SIGN_GAP;
    return Math.max(BRANCH_SIGN_SLOT, w);
}

/**
 * The signs as HTML (screen): the legend's swatch per line, in the chosen
 * shape, aria-hidden (the row says its line in words elsewhere). '' when
 * there is no line or the markers are off.
 */
export function branchSignsHtml(lines: readonly Branch[], marker: BranchMarker | undefined, numbered: boolean): string {
    if (!marker || marker === 'off') return '';
    const num = numbered ? ' is-numbered' : '';
    return lines.map(b =>
        `<span class="branch-swatch branch-sign${num}" data-line="${b}" data-shape="${marker}" aria-hidden="true"><i></i></span>`).join('');
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * One sign in SVG (poster), its box's left edge at `x`, centred on `cy`:
 * arc 10 x 18 (the 4px edge of a rounded card), tag 13 x 16 with the letter,
 * stripe 4 x 18 (solid, dashed 6/4, dotted 3/3), corner a 15px triangle
 * (maternal hatched — needs `branchMarkerDefs` in the image — descendants an
 * outline).
 */
function signSvg(b: Branch, marker: Exclude<BranchMarker, 'off'>, x: number, cy: number, letters: Record<Branch, string>): string {
    const color = BRANCH_COLORS[b];
    switch (marker) {
        case 'arc':
            return `<path class="branch-sign" data-shape="arc" data-branch="${b}" d="${branchStripePath(x, cy - 9, 18, 8, 4)}" fill="${color}"/>`;
        case 'tag':
            return `<g class="branch-sign" data-shape="tag" data-branch="${b}">`
                + `<rect x="${f(x)}" y="${f(cy - 8)}" width="13" height="16" rx="3" fill="${color}"/>`
                + `<text x="${f(x + 6.5)}" y="${f(cy + 3.6)}" text-anchor="middle" font-size="10" font-weight="700" fill="${BRANCH_INK[b]}">${escapeText(letters[b])}</text></g>`;
        case 'stripe': {
            const dash = b === 'maternal' ? ' stroke-dasharray="6 4"' : b === 'descendant' ? ' stroke-dasharray="3 3"' : '';
            return `<line class="branch-sign" data-shape="stripe" data-branch="${b}" x1="${f(x + 2)}" y1="${f(cy - 9)}" x2="${f(x + 2)}" y2="${f(cy + 9)}" stroke="${color}" stroke-width="4"${dash}/>`;
        }
        case 'corner': {
            const y = cy - 7.5;
            const tri = `M${f(x)} ${f(y)}H${f(x + 15)}L${f(x)} ${f(y + 15)}Z`;
            if (b === 'descendant') {
                return `<path class="branch-sign" data-shape="corner" data-branch="${b}" d="${tri}M${f(x + 3.5)} ${f(y + 3.5)}H${f(x + 8.5)}L${f(x + 3.5)} ${f(y + 8.5)}Z" fill="${color}" fill-rule="evenodd"/>`;
            }
            const fill = b === 'maternal' ? `url(#${BRANCH_HATCH_ID})` : color;
            return `<path class="branch-sign" data-shape="corner" data-branch="${b}" d="${tri}" fill="${fill}"/>`;
        }
    }
}

/**
 * The signs of `lines` in SVG for a name's slot starting at `x`, centred on
 * `cy` (one sign centred in the 18px slot, two side by side). '' when there is
 * no line or the markers are off.
 */
export function branchSignsSvg(
    lines: readonly Branch[], marker: BranchMarker, x: number, cy: number, letters: Record<Branch, string>,
): string {
    if (marker === 'off' || lines.length === 0) return '';
    const w = SIGN_W[marker];
    const total = lines.length * w + (lines.length - 1) * BRANCH_SIGN_GAP;
    let left = x + (branchSignWidth(lines, marker) - total) / 2;
    const out: string[] = [];
    for (const b of lines) {
        out.push(signSvg(b, marker, left, cy, letters));
        left += w + BRANCH_SIGN_GAP;
    }
    return out.join('');
}

function escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
