/**
 * Fan chart labels (spec 029 §4): the box a sector offers its text at the
 * current scale (along the arc or along the radius), the reading direction
 * (never upside down), and the ladder that picks the most text that fits —
 * full name with full dates first, down to a cut surname or nothing at all.
 *
 * Pure apart from the default text measurer, which uses a canvas when one is
 * available and an estimate otherwise (tests inject their own).
 */

import type { Person } from './types.js';
import { parseFlexDate, displayYear, formatFlexDate } from './dates.js';
import { shownNameParts, birthNoteText } from './person-name.js';
import { strings } from './strings.js';

// ---------------------------------------------------------------- sizes

/** Font sizes in CSS px (screen) or poster px (print) — §4.1. */
export interface FanLabelSizes {
    /** Name base in rings 3+ and among descendants. */
    base: number;
    /** Name base in rings 1–2. */
    near: number;
    /** Name in the focus disc. */
    focus: number;
    /** Dates/years are the name size minus this. */
    yearsDrop: number;
    /** Nothing gets smaller. */
    min: number;
}

/** Screen sizes; the minimum is larger on a phone. */
export function fanScreenSizes(phone: boolean): FanLabelSizes {
    return { base: 12, near: 13, focus: 14, yearsDrop: 1.5, min: phone ? 10 : 9 };
}

/**
 * Print sizes, in poster px for a poster printed at `mmPerPx` millimetres per
 * poster pixel (1 pt = 0.3528 mm).
 */
export function fanPrintSizes(mmPerPx: number): FanLabelSizes {
    const pt = 0.352778 / mmPerPx;
    return { base: 7.5 * pt, near: 8 * pt, focus: 8 * pt, yearsDrop: 1 * pt, min: 6 * pt };
}

/** The name base of a ring (ancestors) or a descendant depth. */
export function fanBaseSize(sizes: FanLabelSizes, kind: 'anc' | 'desc', ring: number): number {
    return kind === 'anc' && ring <= 2 ? sizes.near : sizes.base;
}

// ---------------------------------------------------------------- measuring

/** Width in px of `text` at `fs` px; `bold` = weight 600 (names), else 400. */
export type FanMeasure = (text: string, fs: number, bold: boolean) => number;

/** A plain estimate (0.58 em per character) — tests and environments without a canvas. */
export const estimateFanMeasure: FanMeasure = (text, fs) => 0.58 * fs * [...text].length;

const FONT_STACK = '"Instrument Sans", -apple-system, "Segoe UI", sans-serif';
const widthCache = new Map<string, number>();
let canvasCtx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
    if (canvasCtx !== undefined) return canvasCtx;
    try {
        canvasCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
        canvasCtx = null;
    }
    return canvasCtx;
}

/** Measures with the app font on a canvas at 100 px, cached by (weight, text). */
export const defaultFanMeasure: FanMeasure = (text, fs, bold) => {
    const key = (bold ? 'b' : 'n') + text;
    let w = widthCache.get(key);
    if (w == null) {
        const ctx = context();
        if (ctx) {
            ctx.font = `${bold ? 600 : 400} 100px ${FONT_STACK}`;
            w = ctx.measureText(text).width / 100;
        } else {
            w = 0.58 * [...text].length;
        }
        widthCache.set(key, w);
    }
    return w * fs;
};

/** Forget measured widths (after the web fonts have loaded, `document.fonts.ready`). */
export function clearFanMeasureCache(): void {
    widthCache.clear();
}

// ---------------------------------------------------------------- box

/** A sector in fan units: radii and angles in math degrees (lo < hi). */
export interface FanSectorShape {
    r1: number;
    r2: number;
    lo: number;
    hi: number;
}

/** The space a sector offers its label at a scale — §4.2. Lengths in px. */
export interface FanLabelBox {
    /** Along the arc (true) or along the radius. */
    curved: boolean;
    /** Arc: the angle the text is centred on and the angle it may use. */
    anchor: number;
    aspan: number;
    /** Arc: in the upper half (reads clockwise, first row outside). */
    upper: boolean;
    /** Radial: the sector's middle angle, 0…360. */
    mid: number;
    /** Ring centre radius (fan units). */
    rc: number;
    /** Room along the text line, px. */
    len: number;
    /** Room across the lines, px. */
    cross: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
export const normAngle = (a: number) => ((a % 360) + 360) % 360;

/** The longest overlap of [lo, hi] with [a, b] (modulo 360). */
function intersect(lo: number, hi: number, a: number, b: number): { len: number; mid: number } {
    let best = { len: 0, mid: (lo + hi) / 2 };
    for (const k of [-360, 0, 360]) {
        const l = Math.max(lo, a + k), h = Math.min(hi, b + k);
        if (h - l > best.len) best = { len: h - l, mid: (l + h) / 2 };
    }
    return best;
}

export function fanLabelBox(s: FanSectorShape, ppu: number): FanLabelBox {
    const span = s.hi - s.lo;
    const rc = (s.r1 + s.r2) / 2;
    const ringW = (s.r2 - s.r1) * ppu;
    let anchor = (s.lo + s.hi) / 2;
    let aspan = span;
    let curved: boolean;
    if (span >= 120) {
        curved = true;
        const up = intersect(s.lo, s.hi, 0, 180), dn = intersect(s.lo, s.hi, 180, 360);
        const w = up.len >= dn.len ? up : dn;
        anchor = w.mid;
        aspan = Math.min(w.len, 150);
    } else {
        const m = normAngle(anchor);
        const nearHorizontal = Math.min(Math.abs(m - 180), m, 360 - m) < 22;
        curved = !nearHorizontal && rad(span) * rc * ppu >= 1.6 * ringW;
    }
    const m = normAngle(anchor);
    if (curved) {
        return {
            curved, anchor, aspan, upper: m > 0 && m < 180, mid: m, rc,
            len: rad(aspan) * (s.r1 + (s.r2 - s.r1) * 0.25) * ppu - 10,
            cross: ringW - 5,
        };
    }
    return {
        curved: false, anchor, aspan, upper: m > 0 && m < 180, mid: m, rc,
        len: ringW - 14,
        cross: rad(span) * (s.r1 + (s.r2 - s.r1) * 0.15) * ppu - 2,
    };
}

/** The rotation of a radial label: along the radius, never upside down — §4.3. */
export function fanRadialRotation(mid: number): number {
    const m = normAngle(mid);
    return m > 90 && m < 270 ? -m + 180 : -m;
}

// ---------------------------------------------------------------- text

/** A date as the fan writes it in full: "24. 8. 1762", an approximate year "asi 1712". */
export function fanFullDate(value?: string): string {
    const d = parseFlexDate(value);
    if (!d) return value ?? '';
    if (d.qualifier === '~' && d.day === undefined && d.month === undefined && !d.end) return `${strings.fan.about} ${d.year}`;
    return formatFlexDate(value);
}

/** Full dates: "24. 8. 1762 – 1. 3. 1821", born only "* 12. 4. 1988", died only "† 1821"; '' without dates. */
export function fanFullDates(p: Person): string {
    const b = p.birthDate ? fanFullDate(p.birthDate) : '';
    const d = p.deathDate ? fanFullDate(p.deathDate) : '';
    if (b && d) return `${b} – ${d}`;
    if (b) return `* ${b}`;
    if (d) return `† ${d}`;
    return '';
}

/** Years: "1762–1821", "~1712–1771", born only "* 1988", died only "† 1821"; '' without dates. */
export function fanYears(p: Person): string {
    const b = displayYear(p.birthDate);
    const d = displayYear(p.deathDate);
    if (b && d) return b.includes('–') || d.includes('–') ? `${b} – ${d}` : `${b}–${d}`;
    if (b) return `* ${b}`;
    if (d) return `† ${d}`;
    return '';
}

/** Initials of the given names: "Bohumil Karel" → "B. K.". */
function initials(given: string): string {
    return given.split(/\s+/).filter(Boolean).map(w => `${[...w][0]}.`).join(' ');
}

// ---------------------------------------------------------------- ladder

export interface FanLabelRow {
    text: string;
    /** Font size in px. */
    fs: number;
    bold: boolean;
}

export interface FanLabel {
    rows: FanLabelRow[];
    /**
     * Ladder step (§4.4): 1 full name + full dates, 2 name + years, 3 initials
     * + years, 4 name without years, 5 surname, 6 cut surname.
     */
    level: number;
}

export interface FitFanLabelOptions {
    /** Name size to start from, px. */
    base: number;
    /** Smallest size, px. */
    min: number;
    /** Years/dates are the name size minus this (default 1.5). */
    yearsDrop?: number;
    /** A protected living person: "Living person" only. */
    protect?: boolean;
    /** A repeated person (implex): the text starts with "↻ ". */
    repeat?: boolean;
    measure?: FanMeasure;
}

const LINE_HEIGHT = 1.18;

interface Candidate {
    lines: string[];
    sub: string | null;
    note: string | null;
    level: number;
    /** The full-dates step may shrink only 2 px under the base. */
    floor2: boolean;
}

function candidates(p: Person, repeat: boolean): Candidate[] {
    const parts = shownNameParts(p, '?');
    const given = parts.given.trim();
    const surname = parts.surname.trim();
    const full = `${given} ${surname}`.trim() || '?';
    const note = birthNoteText(parts.birthNote) || null;
    const rep = repeat ? '↻ ' : '';
    const fd = fanFullDates(p) || null;
    const yr = fanYears(p) || null;
    const two = given && surname ? [rep + given, surname] : null;
    const ini = given && surname ? `${rep}${initials(given)} ${surname}` : null;
    const out: Candidate[] = [];
    const push = (lines: string[] | null, sub: string | null, n: string | null, level: number) => {
        // Without dates a "+ dates" step (1-3) equals a step below it, which may shrink further.
        if (!lines || (level <= 3 && !sub)) return;
        out.push({ lines, sub, note: n, level, floor2: level === 1 });
    };
    const named = (n: string | null) => {
        push([rep + full], fd, n, 1);
        push(two, fd, n, 1);
        push([rep + full], yr, n, 2);
        push(two, yr, n, 2);
    };
    if (note) named(note);
    named(null);
    push(ini ? [ini] : null, yr, null, 3);
    if (note) {
        push([rep + full], null, note, 4);
        push(two, null, note, 4);
    }
    push([rep + full], null, null, 4);
    push(two, null, null, 4);
    push(ini ? [ini] : null, null, null, 4);
    push([rep + (surname || full)], null, null, 5);
    // Only exact repeats go (same rows and the same font floor).
    const seen = new Set<string>();
    return out.filter(c => {
        const k = JSON.stringify([c.lines, c.sub, c.note, c.floor2]);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * The most text of a person that fits a box: the first ladder step whose
 * every row fits, trying sizes from the base down by 0.5 px. Null = the
 * sector shows only its colour (its title stays).
 */
export function fitFanLabel(p: Person, box: FanLabelBox, opts: FitFanLabelOptions): FanLabel | null {
    const { base, min } = opts;
    const drop = opts.yearsDrop ?? 1.5;
    const measure = opts.measure ?? defaultFanMeasure;
    if (box.len < min * 2.2 || box.cross < min * 1.05) return null;

    const list: Candidate[] = opts.protect
        ? [{ lines: [strings.fan.living], sub: null, note: null, level: 4, floor2: false }]
        : candidates(p, !!opts.repeat);

    for (const c of list) {
        const lo = c.floor2 ? Math.max(min, base - 2) : min;
        for (let fs = base; fs >= lo - 0.01; fs -= 0.5) {
            const sfs = Math.max(min, fs - drop);
            const extra = (c.sub ? 1 : 0) + (c.note ? 1 : 0);
            if (c.lines.length * fs * LINE_HEIGHT + extra * sfs * LINE_HEIGHT > box.cross) continue;
            let w = 0;
            for (const l of c.lines) w = Math.max(w, measure(l, fs, true));
            if (c.note) w = Math.max(w, measure(c.note, sfs, false));
            if (c.sub) w = Math.max(w, measure(c.sub, sfs, false));
            if (w <= box.len) {
                const rows: FanLabelRow[] = c.lines.map(text => ({ text, fs, bold: true }));
                if (c.note) rows.push({ text: c.note, fs: sfs, bold: false });
                if (c.sub) rows.push({ text: c.sub, fs: sfs, bold: false });
                return { rows, level: c.level };
            }
        }
    }

    // Step 6: the surname cut with "…", only while at least 6 characters and 60 % stay.
    if (box.cross >= min * LINE_HEIGHT) {
        const parts = shownNameParts(p, '?');
        const s = [...(opts.protect ? strings.fan.living : (opts.repeat ? '↻ ' : '') + (parts.surname.trim() || parts.given.trim() || '?'))];
        for (let n = s.length - 1; n >= Math.max(6, Math.ceil(s.length * 0.6)); n--) {
            const text = s.slice(0, n).join('') + '…';
            if (measure(text, min, true) <= box.len) return { rows: [{ text, fs: min, bold: true }], level: 6 };
        }
    }
    return null;
}

// ---------------------------------------------------------------- SVG

const fmt = (n: number) => n.toFixed(2);

function pt(r: number, a: number): [number, number] {
    return [r * Math.cos(rad(a)), -r * Math.sin(rad(a))];
}

export interface FanLabelSvgOptions {
    /** Prefix of the ids of the arc rails (unique per drawing). */
    uid: string;
    /** Collected `<path>` rails for curved text, emitted in `<defs>`. */
    defs: string[];
    esc: (s: string) => string;
}

/**
 * The SVG text of a label in its box at a scale (font sizes in fan units =
 * px / ppu). Names carry the class `fan-name`, dates `fan-years`.
 */
export function fanLabelSvg(label: FanLabel, box: FanLabelBox, ppu: number, o: FanLabelSvgOptions): string {
    const rows = label.rows;
    let total = 0;
    for (const r of rows) total += r.fs * LINE_HEIGHT;
    let acc = -total / 2;
    const offsets = rows.map(r => { const c = acc + r.fs * LINE_HEIGHT / 2; acc += r.fs * LINE_HEIGHT; return c; });
    let out = '';
    rows.forEach((r, i) => {
        const fsU = r.fs / ppu;
        const attr = `class="${r.bold ? 'fan-name' : 'fan-years'}" font-size="${fmt(fsU)}"`;
        if (box.curved) {
            const id = `${o.uid}r${o.defs.length}`;
            const rr = box.upper ? box.rc - offsets[i] / ppu - 0.35 * fsU : box.rc + offsets[i] / ppu + 0.35 * fsU;
            const a1 = box.anchor + box.aspan / 2, a2 = box.anchor - box.aspan / 2;
            const [x1, y1] = pt(rr, box.upper ? a1 : a2);
            const [x2, y2] = pt(rr, box.upper ? a2 : a1);
            const large = box.aspan > 180 ? 1 : 0;
            o.defs.push(`<path id="${id}" d="M${fmt(x1)} ${fmt(y1)}A${fmt(rr)} ${fmt(rr)} 0 ${large} ${box.upper ? 1 : 0} ${fmt(x2)} ${fmt(y2)}"/>`);
            out += `<text ${attr}><textPath href="#${id}" startOffset="50%" text-anchor="middle">${o.esc(r.text)}</textPath></text>`;
        } else {
            const [px, py] = pt(box.rc, box.mid);
            const rot = fanRadialRotation(box.mid);
            out += `<text ${attr} text-anchor="middle" x="${fmt(px)}" y="${fmt(py + (offsets[i] + 0.35 * r.fs) / ppu)}" transform="rotate(${fmt(rot)} ${fmt(px)} ${fmt(py)})">${o.esc(r.text)}</text>`;
        }
    });
    return out;
}

/** Rows centred on a point, horizontal (the focus disc). */
export function fanCenteredRowsSvg(rows: Array<FanLabelRow & { cls?: string }>, ppu: number, esc: (s: string) => string): string {
    let total = 0;
    for (const r of rows) total += r.fs * 1.2;
    let acc = -total / 2;
    let out = '';
    for (const r of rows) {
        const y = (acc + r.fs * 0.6 + 0.35 * r.fs) / ppu;
        acc += r.fs * 1.2;
        const cls = r.cls ?? (r.bold ? 'fan-name' : 'fan-years');
        out += `<text class="${cls}" x="0" y="${fmt(y)}" font-size="${fmt(r.fs / ppu)}" text-anchor="middle">${esc(r.text)}</text>`;
    }
    return out;
}
