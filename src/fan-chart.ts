/**
 * Fan chart: the classic semicircular ancestor diagram. Pure model + SVG
 * builder over StromData (no DOM access — the renderer wires the container
 * and its events). Ahnentafel numbering: 1 = focus, 2n = father of n,
 * 2n+1 = mother of n. The father's line fills the left half of the fan.
 */

import { StromData, Person, PersonId } from './types.js';
import { displayYear } from './dates.js';

export interface FanSector {
    /** Ahnentafel number (>= 2 — the focus is the center disc, not a sector). */
    ahnentafel: number;
    /** Ring number, 1 = parents. */
    generation: number;
    /** 0-based position in the ring, left to right. */
    indexInGen: number;
    /** The ancestor, or null for an unknown-ancestor slot. */
    person: Person | null;
    /** The person whose parent this slot is (always known for empty slots). */
    childId: PersonId;
}

export interface FanModel {
    focus: Person;
    /** Rings requested (config), >= 1. */
    generations: number;
    /** Sectors of all rings, including empty slots directly above known people. */
    sectors: FanSector[];
    /** Highest ring that contains at least one known ancestor (0 = none). */
    maxKnownGen: number;
}

/**
 * Split a person's parents into a father slot and a mother slot. Prefers
 * gender; falls back to declaration order when genders don't disambiguate.
 */
function fatherMotherOf(data: StromData, person: Person): [Person | null, Person | null] {
    const parents = person.parentIds
        .map(id => data.persons[id])
        .filter((p): p is Person => !!p)
        .slice(0, 2);
    if (parents.length === 0) return [null, null];
    if (parents.length === 1) {
        return parents[0].gender === 'female' ? [null, parents[0]] : [parents[0], null];
    }
    const male = parents.find(p => p.gender === 'male');
    const female = parents.find(p => p.gender === 'female');
    if (male && female && male !== female) return [male, female];
    return [parents[0], parents[1]];
}

/** Build the ancestor model for `generations` rings above the focus. */
export function buildFanModel(data: StromData, focusId: PersonId, generations: number): FanModel | null {
    const focus = data.persons[focusId];
    if (!focus) return null;

    const gens = Math.max(1, Math.min(8, Math.floor(generations)));
    // slots[i] = person at ahnentafel i (index 0 unused).
    const slots: Array<Person | null> = new Array(2 ** (gens + 1)).fill(null);
    slots[1] = focus;

    for (let i = 1; i < 2 ** gens; i++) {
        const child = slots[i];
        if (!child) continue;
        const [father, mother] = fatherMotherOf(data, child);
        slots[2 * i] = father;
        slots[2 * i + 1] = mother;
    }

    const sectors: FanSector[] = [];
    let maxKnownGen = 0;
    for (let g = 1; g <= gens; g++) {
        for (let i = 2 ** g; i < 2 ** (g + 1); i++) {
            const child = slots[Math.floor(i / 2)];
            if (!child) continue; // no known child below → nothing to attach to
            sectors.push({
                ahnentafel: i,
                generation: g,
                indexInGen: i - 2 ** g,
                person: slots[i],
                childId: child.id,
            });
            if (slots[i]) maxKnownGen = Math.max(maxKnownGen, g);
        }
    }

    return { focus, generations: gens, sectors, maxKnownGen };
}

// ==================== SVG RENDERING ====================

export interface FanSvgOptions {
    /** Escape function for text content (renderer supplies its own). */
    esc: (text: string) => string;
    /** Show "+" affordance in empty slots (hidden in view mode). */
    editable: boolean;
    /** Label under the focus name, e.g. localized "generations" for a11y. */
    addParentLabel: string;
    /** K9: draw the Kekulé (ahnentafel) number in each ancestor sector. */
    showKekule?: boolean;
}

const FOCUS_R = 72;
/** Ring widths by generation (1-based); outer rings get narrower. */
const RING_W = [0, 96, 92, 86, 76, 66, 58, 52, 48];
const PAD = 16;

function ringRadii(gen: number): { r1: number; r2: number } {
    let r = FOCUS_R;
    for (let g = 1; g < gen; g++) r += RING_W[g];
    return { r1: r, r2: r + RING_W[gen] };
}

/** Point on a circle; SVG y grows downward, angles are math-style degrees. */
function pt(cx: number, cy: number, r: number, deg: number): [number, number] {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

const fmt = (n: number) => n.toFixed(2);

/** Annulus sector path from angle a1 down to a2 (a1 > a2), radii r1 < r2. */
function sectorPath(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number): string {
    const [x1, y1] = pt(cx, cy, r1, a1);
    const [x2, y2] = pt(cx, cy, r2, a1);
    const [x3, y3] = pt(cx, cy, r2, a2);
    const [x4, y4] = pt(cx, cy, r1, a2);
    return `M ${fmt(x1)} ${fmt(y1)} L ${fmt(x2)} ${fmt(y2)} `
        + `A ${fmt(r2)} ${fmt(r2)} 0 0 1 ${fmt(x3)} ${fmt(y3)} `
        + `L ${fmt(x4)} ${fmt(y4)} `
        + `A ${fmt(r1)} ${fmt(r1)} 0 0 0 ${fmt(x1)} ${fmt(y1)} Z`;
}

/** Arc path (left→right along the fan) used as a textPath rail. */
function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
    const [x1, y1] = pt(cx, cy, r, a1);
    const [x2, y2] = pt(cx, cy, r, a2);
    return `M ${fmt(x1)} ${fmt(y1)} A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x2)} ${fmt(y2)}`;
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
}

/** Base font size per generation (mirrors the .fan-name CSS classes). */
const BASE_FS = [0, 14, 12.5, 11, 10.5, 9.5, 8.5, 8, 7.5];
/** Average glyph width as a fraction of font size (sans, mixed case). */
const GLYPH_W = 0.58;

/**
 * Pick a font size that fits `text` into `maxLen` px, shrinking from the
 * generation's base size down to `minFs` before giving up (ellipsis then).
 */
function fitFont(text: string, baseFs: number, maxLen: number, minFs: number): number {
    let fs = baseFs;
    while (fs > minFs && text.length * fs * GLYPH_W > maxLen) fs -= 0.5;
    return fs;
}

function yearsOf(p: Person): string {
    const b = displayYear(p.birthDate);
    const d = displayYear(p.deathDate);
    if (!b && !d) return '';
    return `${b || '?'}–${d || ''}`;
}

/**
 * Build the complete fan SVG. The viewBox is tight around the drawn fan; the
 * container CSS scales it to fit.
 */
export function buildFanSvg(model: FanModel, opts: FanSvgOptions): string {
    const { esc } = opts;
    const R = ringRadii(model.generations).r2;
    const W = 2 * R + 2 * PAD;
    const H = R + FOCUS_R + 2 * PAD;
    const cx = W / 2;
    const cy = PAD + R; // fan baseline; focus disc dips below it

    const parts: string[] = [];
    const defs: string[] = [];

    for (const s of model.sectors) {
        const span = 180 / 2 ** s.generation;
        const a1 = 180 - s.indexInGen * span;
        const a2 = a1 - span;
        const mid = (a1 + a2) / 2;
        const { r1, r2 } = ringRadii(s.generation);
        const path = sectorPath(cx, cy, r1, r2, a1, a2);

        if (!s.person) {
            if (!opts.editable) continue;
            const [px, py] = pt(cx, cy, (r1 + r2) / 2, mid);
            parts.push(`<g class="fan-sector fan-empty" data-fan-add="${esc(s.childId)}">`
                + `<path d="${path}"/>`
                + `<text x="${fmt(px)}" y="${fmt(py)}" class="fan-plus">+</text>`
                + `<title>${esc(opts.addParentLabel)}</title></g>`);
            continue;
        }

        const p = s.person;
        const name = `${p.firstName} ${p.lastName}`.trim() || '?';
        const years = yearsOf(p);
        const gcls = p.gender === 'female' ? 'female' : 'male';
        let textSvg = '';

        if (s.generation <= 2) {
            // Wide sectors: curved text along two rails (name above years).
            // Capacity comes from the actual ARC LENGTH at the rail radius
            // (the old fixed character budgets clipped names that had room).
            const midR = (r1 + r2) / 2;
            const railName = `fan-rail-n-${s.ahnentafel}`;
            const railYear = `fan-rail-y-${s.ahnentafel}`;
            defs.push(`<path id="${railName}" d="${arcPath(cx, cy, midR + 6, a1, a2)}"/>`);
            defs.push(`<path id="${railYear}" d="${arcPath(cx, cy, midR - 14, a1, a2)}"/>`);
            const arcLen = (span * Math.PI / 180) * (midR + 6) - 12;
            const baseFs = BASE_FS[s.generation];
            const fs = fitFont(name, baseFs, arcLen, baseFs - 3);
            const maxChars = Math.max(6, Math.floor(arcLen / (fs * GLYPH_W)));
            const fsAttr = fs < baseFs ? ` style="font-size:${fs}px"` : '';
            textSvg = `<text class="fan-name g${s.generation}"${fsAttr}><textPath href="#${railName}" startOffset="50%" text-anchor="middle">${esc(truncate(name, maxChars))}</textPath></text>`
                + (years ? `<text class="fan-years g${s.generation}"><textPath href="#${railYear}" startOffset="50%" text-anchor="middle">${esc(years)}</textPath></text>` : '');
        } else {
            // Narrow sectors: radial text, flipped on the left half for
            // legibility. First and last name go on SEPARATE lines — the
            // tangential space (arc) fits several lines, while the radial
            // ring width is the scarce direction; splitting the name is what
            // lets "Antonín Krepčík" fit un-ellipsized. The font shrinks a
            // little before the ellipsis ever kicks in.
            const midR = (r1 + r2) / 2;
            const [px, py] = pt(cx, cy, midR, mid);
            let rot = -mid;
            if (mid > 90) rot += 180;
            const maxLen = RING_W[s.generation] - 14;
            const baseFs = BASE_FS[s.generation];

            // How many text lines the sector's arc can hold at base size.
            const arcLen = (span * Math.PI / 180) * midR;
            const maxLines = Math.max(1, Math.min(3, Math.floor(arcLen / (baseFs * 1.3))));

            // Greedy word wrap of the full name into the available lines —
            // "Johannes Jacobus Výsek" becomes three short lines instead of
            // one ellipsized one.
            const charCap = Math.max(4, Math.floor(maxLen / (baseFs * GLYPH_W)));
            const tokens = name.split(/\s+/).filter(Boolean);
            const lines: string[] = [];
            for (const tok of tokens) {
                const last = lines[lines.length - 1];
                if (lines.length === 0) lines.push(tok);
                else if (lines.length < maxLines && (last.length + 1 + tok.length) > charCap) lines.push(tok);
                else lines[lines.length - 1] = `${last} ${tok}`;
            }
            const showYears = s.generation <= 4 && years && lines.length < maxLines;
            if (showYears) lines.push(years);

            // One shared font size: the longest line decides the shrink.
            const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
            const fs = fitFont(longest, baseFs, maxLen, Math.max(7, baseFs - 2.5));
            const maxChars = Math.max(6, Math.floor(maxLen / (fs * GLYPH_W)));
            const fsAttr = fs < baseFs ? ` style="font-size:${fs}px"` : '';

            const startDy = -((lines.length - 1) / 2) * 1.15 + 0.35;
            const tspans = lines.map((line, i) => {
                const cls = line === years ? ' class="fan-years"' : '';
                const dy = i === 0 ? `${startDy.toFixed(2)}em` : '1.15em';
                return `<tspan x="${fmt(px)}" dy="${dy}"${cls}>${esc(truncate(line, maxChars))}</tspan>`;
            }).join('');
            textSvg = `<text class="fan-name g${s.generation}"${fsAttr} x="${fmt(px)}" y="${fmt(py)}"`
                + ` transform="rotate(${fmt(rot)} ${fmt(px)} ${fmt(py)})" text-anchor="middle">`
                + tspans + `</text>`;
        }

        // Kekulé/ahnentafel number: always in the tooltip (free), drawn in the
        // sector only when the user asked for it (it is noise for most people).
        let kekuleSvg = '';
        if (opts.showKekule) {
            // Always at the sector's INNER edge: the name/years rails own the
            // middle of the ring, a number there collides with them.
            const [kx, ky] = pt(cx, cy, r1 + 9, mid);
            let krot = -mid;
            if (mid > 90) krot += 180;
            kekuleSvg = `<text class="fan-kekule" x="${fmt(kx)}" y="${fmt(ky)}"`
                + ` transform="rotate(${fmt(krot)} ${fmt(kx)} ${fmt(ky)})" text-anchor="middle">${s.ahnentafel}</text>`;
        }
        parts.push(`<g class="fan-sector ${gcls}" data-fan-person="${esc(p.id)}">`
            + `<path d="${path}"/>`
            + textSvg
            + kekuleSvg
            + `<title>#${s.ahnentafel} · ${esc(name)}${years ? ` (${years})` : ''}</title></g>`);
    }

    // Focus disc at the fan's center bottom.
    const fname = `${model.focus.firstName} ${model.focus.lastName}`.trim() || '?';
    const fyears = yearsOf(model.focus);
    const fcls = model.focus.gender === 'female' ? 'female' : 'male';
    parts.push(`<g class="fan-focus ${fcls}" data-fan-person="${esc(model.focus.id)}">`
        + `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${FOCUS_R}"/>`
        + `<text x="${fmt(cx)}" y="${fmt(cy - 6)}" text-anchor="middle" class="fan-name g0">${esc(truncate(fname, 18))}</text>`
        + (fyears ? `<text x="${fmt(cx)}" y="${fmt(cy + 12)}" text-anchor="middle" class="fan-years g0">${esc(fyears)}</text>` : '')
        + `<title>#1 · ${esc(fname)}</title></g>`);

    return `<svg class="fan-svg" viewBox="0 0 ${fmt(W)} ${fmt(H)}" role="img">`
        + `<defs>${defs.join('')}</defs>${parts.join('')}</svg>`;
}
