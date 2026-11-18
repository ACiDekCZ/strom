/**
 * Lineage markers drawn in SVG (spec 112): the tree image, the poster and the
 * family book's tree page draw the marker chosen in the settings (arc, letter
 * tag, stripe, corner) and the optional tint as the screen does with CSS
 * (index.html, "Lineage markers"). An image is always light: the colours are
 * the light theme's P2 tokens as hex.
 */

import type { BranchSet, Branch } from './branch-colors.js';
import type { BranchMarker } from './types.js';
import { branchesOf } from './branch-colors.js';
import { strings } from './strings.js';

/** The line's colour (the light theme's --branch-*; P2, decision R2). */
export const BRANCH_COLORS: Readonly<Record<Branch, string>> = {
    paternal: '#234e8c', maternal: '#d0679a', descendant: '#8a6400',
};
/** The letter on the tag (--branch-*-ink). */
export const BRANCH_INK: Readonly<Record<Branch, string>> = {
    paternal: '#ffffff', maternal: '#1c1a16', descendant: '#ffffff',
};
/** The card's ground with the tint on (--branch-*-tint). */
export const BRANCH_TINT: Readonly<Record<Branch, string>> = {
    paternal: '#e9eced', maternal: '#faeeef', descendant: '#f3eedf',
};

/** The id of the maternal corner's hatch and of the two-line tint (one each per image). */
export const BRANCH_HATCH_ID = 'branch-hatch';
export const BRANCH_TINT_BOTH_ID = 'branch-tint-pm';

const TAG_FONT = `font-family="'Instrument Sans', -apple-system, 'Segoe UI', sans-serif"`;
/** Around the tag, as the screen's 2px outline: a stroke drawn under the fill, 2px of it outside. */
const TAG_OUTLINE = '#ffffff';

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** The letters of the tag: the strings' initials, or 1 and 2 for two same-gender parents (R5). */
export function branchLetters(numbered: boolean): Record<Branch, string> {
    const s = strings.branchColors;
    return {
        paternal: numbered ? '1' : s.letterPaternal,
        maternal: numbered ? '2' : s.letterMaternal,
        descendant: s.letterDescendant,
    };
}

/** Both ancestral lines at once (R4). */
function both(set: BranchSet): boolean {
    return !!set.paternal && !!set.maternal;
}

/**
 * The branch stripe: the left `w` px of the card's rounded rectangle (corner
 * radius r), so it runs into the rounded corners like the on-screen stripe
 * instead of being a separate bar.
 */
export function branchStripePath(x: number, y: number, h: number, r: number, w: number): string {
    const p = (n: number) => n.toFixed(2);
    // Where the corner arc meets the stripe's inner edge (x + w).
    const dy = w < r ? r - Math.sqrt(r * r - (r - w) * (r - w)) : 0;
    return `M${p(x + w)} ${p(y + dy)}A${r} ${r} 0 0 0 ${p(x)} ${p(y + r)}`
        + `L${p(x)} ${p(y + h - r)}A${r} ${r} 0 0 0 ${p(x + w)} ${p(y + h - dy)}Z`;
}

/**
 * The shared definitions the markers of an image need: the maternal corner's
 * hatch (the screen's 45° stripes, 2px on 2px off) and the two-line tint (the
 * upper half paternal, the lower maternal). '' when none is needed.
 */
export function branchMarkerDefs(sets: Iterable<BranchSet>, marker: BranchMarker, tint: boolean): string {
    if (marker === 'off') return '';
    let hatch = false;
    let tintBoth = false;
    for (const set of sets) {
        if (marker === 'corner' && set.maternal) hatch = true;
        if (tint && both(set)) tintBoth = true;
    }
    const out: string[] = [];
    if (hatch) {
        out.push(`<pattern id="${BRANCH_HATCH_ID}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">`
            + `<rect x="0" y="0" width="2" height="4" fill="${BRANCH_COLORS.maternal}"/></pattern>`);
    }
    if (tintBoth) {
        out.push(`<linearGradient id="${BRANCH_TINT_BOTH_ID}" x1="0" y1="0" x2="0" y2="1">`
            + `<stop offset="0.5" stop-color="${BRANCH_TINT.paternal}"/><stop offset="0.5" stop-color="${BRANCH_TINT.maternal}"/></linearGradient>`);
    }
    return out.length ? `<defs class="branch-defs">${out.join('')}</defs>` : '';
}

/** The card's ground with the tint on: the line's tint, both halves for both lines (R4); undefined without a line. */
export function branchTintFill(set: BranchSet | undefined): string | undefined {
    if (!set) return undefined;
    if (both(set)) return `url(#${BRANCH_TINT_BOTH_ID})`;
    const [first] = branchesOf(set);
    return first ? BRANCH_TINT[first] : undefined;
}

/** A card's box in the image (its rectangle's x, y, width, height; 1px hairline border, radius 8). */
export interface BranchCardBox { x: number; y: number; w: number; h: number; }

export interface BranchMarkerDraw {
    marker: BranchMarker;
    /** The compact card (150 x 44): the smaller tag, stripe and corner of the screen. */
    compact?: boolean;
    /** The tag's letters (branchLetters). */
    letters: Record<Branch, string>;
    /** A fresh id for a clip path (unique in the image). */
    nextId: () => string;
}

/**
 * A card's marker. `under`: drawn right after the card's rectangle (arc,
 * stripe, corner); `over`: after the card's content (the tag, which the screen
 * lays over the card's left edge). Empty for no line or the marker off.
 */
export function branchMarkerSvg(set: BranchSet | undefined, box: BranchCardBox, draw: BranchMarkerDraw): { under: string[]; over: string[] } {
    const under: string[] = [];
    const over: string[] = [];
    const lines = branchesOf(set);
    if (!set || lines.length === 0 || draw.marker === 'off') return { under, over };
    const pm = both(set);
    const { x, y, w, h } = box;
    const mid = y + h / 2;

    switch (draw.marker) {
        case 'arc': {
            // From the outer edge of the 1px border, following the card's rounded corners.
            const d = branchStripePath(x - 0.5, y - 0.5, h + 1, 8.5, 4.5);
            if (!pm) {
                under.push(`<path class="branch-stripe" data-branch="${lines[0]}" d="${d}" fill="${BRANCH_COLORS[lines[0]]}"/>`);
                break;
            }
            // R4: the same arc twice, the upper half paternal, the lower maternal.
            const up = draw.nextId();
            const down = draw.nextId();
            under.push(`<clipPath id="${up}"><rect x="${f(x - 1)}" y="${f(y - 1)}" width="6" height="${f(h / 2 + 1)}"/></clipPath>`
                + `<clipPath id="${down}"><rect x="${f(x - 1)}" y="${f(mid)}" width="6" height="${f(h / 2 + 1)}"/></clipPath>`);
            under.push(`<path class="branch-stripe" data-branch="paternal" d="${d}" fill="${BRANCH_COLORS.paternal}" clip-path="url(#${up})"/>`);
            under.push(`<path class="branch-stripe" data-branch="maternal" d="${d}" fill="${BRANCH_COLORS.maternal}" clip-path="url(#${down})"/>`);
            break;
        }
        case 'stripe': {
            // A bar inside the left edge (the screen's left 2px in the padding box):
            // paternal solid, maternal dashed 6/4, descendants dotted 3/3.
            const sw = draw.compact ? 3 : 4;
            const inset = draw.compact ? 6 : 10;
            const sx = x + 1 + 2 + sw / 2;
            const top = y + inset;
            const bottom = y + h - inset;
            const dash = (b: Branch) => b === 'maternal' ? ' stroke-dasharray="6 4"' : b === 'descendant' ? ' stroke-dasharray="3 3"' : '';
            const seg = (b: Branch, y1: number, y2: number) =>
                `<line class="branch-mark" data-shape="stripe" data-branch="${b}" x1="${f(sx)}" y1="${f(y1)}" x2="${f(sx)}" y2="${f(y2)}" stroke="${BRANCH_COLORS[b]}" stroke-width="${sw}"${dash(b)}/>`;
            if (pm) {
                // R4: the upper half solid paternal, the lower dashed maternal.
                under.push(seg('paternal', top, mid - 1), seg('maternal', mid + 1, bottom));
            } else {
                under.push(seg(lines[0], top, bottom));
            }
            break;
        }
        case 'corner': {
            // A triangle in the top-left corner from the border's outer edge, inside the card's rounded shape.
            const s = draw.compact ? 12 : 16;
            const cx = x - 0.5;
            const cy = y - 0.5;
            const clip = draw.nextId();
            under.push(`<clipPath id="${clip}"><rect x="${f(cx)}" y="${f(cy)}" width="${f(w + 1)}" height="${f(h + 1)}" rx="8.5"/></clipPath>`);
            const fill = (b: Branch) => b === 'maternal' ? `url(#${BRANCH_HATCH_ID})` : BRANCH_COLORS[b];
            const tri = `M${f(cx)} ${f(cy)}H${f(cx + s)}L${f(cx)} ${f(cy + s)}Z`;
            const parts: string[] = [];
            if (pm) {
                // R4: split by the diagonal — the lower-left half solid paternal, the upper hatched maternal.
                parts.push(`<path data-branch="paternal" d="M${f(cx)} ${f(cy)}L${f(cx + s / 2)} ${f(cy + s / 2)}L${f(cx)} ${f(cy + s)}Z" fill="${fill('paternal')}"/>`);
                parts.push(`<path data-branch="maternal" d="M${f(cx)} ${f(cy)}H${f(cx + s)}L${f(cx + s / 2)} ${f(cy + s / 2)}Z" fill="${fill('maternal')}"/>`);
            } else if (lines[0] === 'descendant') {
                // Descendants: an outline triangle (a hole inside).
                const a = draw.compact ? 3 : 4;
                const b = draw.compact ? 6 : 9;
                parts.push(`<path data-branch="descendant" d="${tri}M${f(cx + a)} ${f(cy + a)}H${f(cx + b)}L${f(cx + a)} ${f(cy + b)}Z" fill="${fill('descendant')}" fill-rule="evenodd"/>`);
            } else {
                parts.push(`<path data-branch="${lines[0]}" d="${tri}" fill="${fill(lines[0])}"/>`);
            }
            under.push(`<g class="branch-mark" data-shape="corner" clip-path="url(#${clip})">${parts.join('')}</g>`);
            break;
        }
        case 'tag': {
            // A small tag over the card's left edge, half of it in the gap between cards.
            const tw = draw.compact ? 12 : 16;
            const th = draw.compact ? 16 : 20;
            const fs = draw.compact ? 9 : 11;
            const tx = x - tw / 2;
            const tag = (b: Branch, top: number) =>
                `<g class="branch-mark" data-shape="tag" data-branch="${b}">`
                + `<rect x="${f(tx)}" y="${f(top)}" width="${tw}" height="${th}" rx="3" fill="${BRANCH_COLORS[b]}" stroke="${TAG_OUTLINE}" stroke-width="4" paint-order="stroke"/>`
                + `<text x="${f(x)}" y="${f(top + th / 2 + fs * 0.36)}" text-anchor="middle" ${TAG_FONT} font-size="${fs}" font-weight="700" fill="${BRANCH_INK[b]}">${escapeText(draw.letters[b])}</text></g>`;
            if (pm) {
                // R4: two tags, paternal above the middle, maternal below.
                over.push(tag('paternal', draw.compact ? mid - 17 : mid - 22), tag('maternal', draw.compact ? mid + 1 : mid + 2));
            } else {
                over.push(tag(lines[0], mid - th / 2));
            }
            break;
        }
    }
    return { under, over };
}

function escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
