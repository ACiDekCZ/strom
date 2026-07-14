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
            const midR = (r1 + r2) / 2;
            const railName = `fan-rail-n-${s.ahnentafel}`;
            const railYear = `fan-rail-y-${s.ahnentafel}`;
            defs.push(`<path id="${railName}" d="${arcPath(cx, cy, midR + 6, a1, a2)}"/>`);
            defs.push(`<path id="${railYear}" d="${arcPath(cx, cy, midR - 14, a1, a2)}"/>`);
            const maxChars = s.generation === 1 ? 26 : 20;
            textSvg = `<text class="fan-name g${s.generation}"><textPath href="#${railName}" startOffset="50%" text-anchor="middle">${esc(truncate(name, maxChars))}</textPath></text>`
                + (years ? `<text class="fan-years g${s.generation}"><textPath href="#${railYear}" startOffset="50%" text-anchor="middle">${esc(years)}</textPath></text>` : '');
        } else {
            // Narrow sectors: radial text, flipped on the left half for legibility.
            const midR = (r1 + r2) / 2;
            const [px, py] = pt(cx, cy, midR, mid);
            let rot = -mid;
            if (mid > 90) rot += 180;
            const maxChars = Math.max(6, Math.floor((RING_W[s.generation] - 14) / (s.generation >= 5 ? 5.4 : 6.2)));
            const showYears = s.generation <= 4 && years;
            const line1 = truncate(name, maxChars);
            textSvg = `<text class="fan-name g${s.generation}" x="${fmt(px)}" y="${fmt(py)}"`
                + ` transform="rotate(${fmt(rot)} ${fmt(px)} ${fmt(py)})" text-anchor="middle">`
                + (showYears
                    ? `<tspan x="${fmt(px)}" dy="-0.15em">${esc(line1)}</tspan><tspan x="${fmt(px)}" dy="1.15em" class="fan-years">${esc(years)}</tspan>`
                    : `<tspan x="${fmt(px)}" dy="0.35em">${esc(line1)}</tspan>`)
                + `</text>`;
        }

        parts.push(`<g class="fan-sector ${gcls}" data-fan-person="${esc(p.id)}">`
            + `<path d="${path}"/>`
            + textSvg
            + `<title>${esc(name)}${years ? ` (${years})` : ''}</title></g>`);
    }

    // Focus disc at the fan's center bottom.
    const fname = `${model.focus.firstName} ${model.focus.lastName}`.trim() || '?';
    const fyears = yearsOf(model.focus);
    const fcls = model.focus.gender === 'female' ? 'female' : 'male';
    parts.push(`<g class="fan-focus ${fcls}" data-fan-person="${esc(model.focus.id)}">`
        + `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${FOCUS_R}"/>`
        + `<text x="${fmt(cx)}" y="${fmt(cy - 6)}" text-anchor="middle" class="fan-name g0">${esc(truncate(fname, 18))}</text>`
        + (fyears ? `<text x="${fmt(cx)}" y="${fmt(cy + 12)}" text-anchor="middle" class="fan-years g0">${esc(fyears)}</text>` : '')
        + `<title>${esc(fname)}</title></g>`);

    return `<svg class="fan-svg" viewBox="0 0 ${fmt(W)} ${fmt(H)}" role="img">`
        + `<defs>${defs.join('')}</defs>${parts.join('')}</svg>`;
}
