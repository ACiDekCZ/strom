/**
 * Fan chart labels (spec 029 §4): the box a sector offers its text at the
 * current scale (along the arc or along the radius), the reading direction
 * (never upside down), and the ladder that picks the most text that fits —
 * full name with full dates first, down to the given name with the
 * surname's initial, a cut surname, the initials, or nothing where not even
 * those fit.
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

/** The type faces of the fan's names: the app's sans, and Strom Serif of the antique style (spec 118 §4). */
const FONT_STACKS = {
    sans: '"Instrument Sans", -apple-system, "Segoe UI", sans-serif',
    serif: '"Strom Serif", Georgia, serif',
} as const;
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

const measurers = new Map<'sans' | 'serif', FanMeasure>();

/** Measures with a face of the fan on a canvas at 100 px, cached by (face, weight, text). */
export function fanMeasureFor(family: 'sans' | 'serif'): FanMeasure {
    let m = measurers.get(family);
    if (!m) {
        const stack = FONT_STACKS[family];
        const prefix = family === 'serif' ? 's' : '';
        m = (text, fs, bold) => {
            const key = prefix + (bold ? 'b' : 'n') + text;
            let w = widthCache.get(key);
            if (w == null) {
                const ctx = context();
                if (ctx) {
                    ctx.font = `${bold ? 600 : 400} 100px ${stack}`;
                    w = ctx.measureText(text).width / 100;
                } else {
                    w = 0.58 * [...text].length;
                }
                widthCache.set(key, w);
            }
            return w * fs;
        };
        measurers.set(family, m);
    }
    return m;
}

/** Measures with the app font on a canvas at 100 px, cached by (weight, text). */
export const defaultFanMeasure: FanMeasure = fanMeasureFor('sans');

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
    return orientedBox(s, ppu, curved, anchor, aspan);
}

/** The box of a sector along the arc (`curved`) or along the radius, centred on `anchor` over `aspan` degrees. */
function orientedBox(s: FanSectorShape, ppu: number, curved: boolean, anchor: number, aspan: number): FanLabelBox {
    const rc = (s.r1 + s.r2) / 2;
    const ringW = (s.r2 - s.r1) * ppu;
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
        // 4 px off each end of the ring: a surname was cut where the ring had room for it (1101; §4.2 said 14).
        len: ringW - 8,
        cross: rad(s.hi - s.lo) * (s.r1 + (s.r2 - s.r1) * 0.15) * ppu - 2,
    };
}

/**
 * The sector's box in the other direction than fanLabelBox chose (a sector
 * under 120°): a wide short sector whose radial box holds no text at all may
 * still hold a name along its arc, and a narrow tall one along its radius.
 * Only a fallback where the chosen box gives nothing (1101).
 */
export function fanLabelBoxTurned(s: FanSectorShape, ppu: number): FanLabelBox | null {
    if (s.hi - s.lo >= 120) return null;
    const chosen = fanLabelBox(s, ppu);
    // Text along the arc beside the horizontal would stand upright: never there.
    const m = normAngle(chosen.anchor);
    if (!chosen.curved && Math.min(Math.abs(m - 180), m, 360 - m) < 22) return null;
    return orientedBox(s, ppu, !chosen.curved, chosen.anchor, chosen.aspan);
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

/**
 * A double surname broken after the hyphen nearest its middle, the hyphen
 * staying on the first line; null without one (or with an empty half).
 */
function hyphenHalves(surname: string): [string, string] | null {
    const mid = surname.length / 2;
    let at = -1;
    for (let i = surname.indexOf('-'); i >= 0; i = surname.indexOf('-', i + 1)) {
        if (at < 0 || Math.abs(i + 0.5 - mid) < Math.abs(at + 0.5 - mid)) at = i;
    }
    if (at <= 0 || at >= surname.length - 1) return null;
    const a = surname.slice(0, at + 1).trim(), b = surname.slice(at + 1).trim();
    return a.length > 1 && b ? [a, b] : null;
}

/** Initials of the given names: "Bohumil Karel" → "B. K.". */
function initials(given: string): string {
    return given.split(/\s+/).filter(Boolean).map(w => `${[...w][0]}.`).join(' ');
}

// ---------------------------------------------------------------- content

/**
 * What a sector writes besides the name (spec 118 §5): the years (as
 * always), the full dates with the places of birth and death where they
 * fit, or the names alone (a pixel larger).
 */
export type FanContent = 'years' | 'places' | 'names';
export const FAN_CONTENTS: readonly FanContent[] = ['years', 'places', 'names'];

/** A place as the fan writes it: the part before the first comma ("Horní Vrbná, okres X" → "Horní Vrbná"). */
export function fanShortPlace(place?: string): string {
    return (place ?? '').split(',')[0].trim();
}

/**
 * The rows of birth and death with their places (spec 118 §5):
 * "* 22. 11. 1888 Kessenau", "† 25. 1. 1960 Tálov"; a place without a date
 * stays ("* Horní Vrbná"), empty parts and rows are left out. [] without any
 * place (the years say the rest). Only birth and death, as the dates: a
 * baptism's place is not a birthplace.
 */
export function fanPlaceRows(p: Person): string[] {
    const bp = fanShortPlace(p.birthPlace), dp = fanShortPlace(p.deathPlace);
    if (!bp && !dp) return [];
    const row = (mark: string, date: string | undefined, place: string) => {
        const parts = [date ? fanFullDate(date) : '', place].filter(Boolean);
        return parts.length ? `${mark} ${parts.join(' ')}` : '';
    };
    return [row('*', p.birthDate, bp), row('†', p.deathDate, dp)].filter(Boolean);
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
     * Ladder step (§4.4): 0 name + dates with places (spec 118 §5, content
     * 'places' only), 1 full name + full dates, 2 name + years, 3 initials
     * + years, 4 name without years, 5 surname, 6 given name + the surname's
     * initial ("Jan D.", with the years where they fit), 7 cut surname, 8 the
     * initials alone (1101).
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
    /** What the label writes besides the name (spec 118 §5); default years. */
    content?: FanContent;
    measure?: FanMeasure;
}

const LINE_HEIGHT = 1.18;

/** The fewest characters a cut surname keeps before its "…" (step 7). */
export const FAN_CUT_KEEP = 4;

/** All the characters a label shows (to compare two of the same step). */
function labelChars(l: FanLabel): number {
    let n = 0;
    for (const r of l.rows) n += [...r.text.replace(/…$/, '')].length;
    return n;
}

interface Candidate {
    lines: string[];
    sub: string | null;
    /** A second row of dates (the death with its place, step 0). */
    sub2?: string | null;
    note: string | null;
    level: number;
    /** The full-dates steps (0, 1) may shrink only 2 px under the base. */
    floor2: boolean;
}

function candidates(p: Person, repeat: boolean, content: FanContent): Candidate[] {
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
    // A double surname may break after its hyphen: "Oberwaldenburger-" / "Kreuzfeldt" (1101).
    const halves = hyphenHalves(surname);
    const three = given && halves ? [rep + given, ...halves] : null;
    const iniTwo = given && halves ? [`${rep}${initials(given)} ${halves[0]}`, halves[1]] : null;
    const out: Candidate[] = [];
    const push = (lines: string[] | null, sub: string | null, n: string | null, level: number) => {
        // Without dates a "+ dates" step (1-3) equals a step below it, which may shrink further.
        if (!lines || (level <= 3 && !sub)) return;
        out.push({ lines, sub, note: n, level, floor2: level === 1 });
    };
    // Step 0 (spec 118 §5): the name with the dates and places of birth and death, two rows.
    const places = content === 'places' ? fanPlaceRows(p) : [];
    const placed = (n: string | null) => {
        for (const lines of [[rep + full], two, three]) {
            if (lines) out.push({ lines, sub: places[0], sub2: places[1] ?? null, note: n, level: 0, floor2: true });
        }
    };
    if (places.length) {
        if (note) placed(note);
        placed(null);
    }
    const named = (n: string | null) => {
        push([rep + full], fd, n, 1);
        push(two, fd, n, 1);
        push(three, fd, n, 1);
        push([rep + full], yr, n, 2);
        push(two, yr, n, 2);
        push(three, yr, n, 2);
    };
    if (note) named(note);
    named(null);
    push(ini ? [ini] : null, yr, null, 3);
    push(iniTwo, yr, null, 3);
    if (note) {
        push([rep + full], null, note, 4);
        push(two, null, note, 4);
        push(three, null, note, 4);
    }
    push([rep + full], null, null, 4);
    push(two, null, null, 4);
    push(three, null, null, 4);
    push(ini ? [ini] : null, null, null, 4);
    push(iniTwo, null, null, 4);
    push([rep + (surname || full)], null, null, 5);
    if (halves) push([rep + halves[0], halves[1]], null, null, 5);
    // Step 6: where the surname would have to be cut, the given name with the surname's
    // initial names the person better ("Jan D.") — with the years where they fit, on one
    // line or the initial below; several given names then only the first (1101).
    // "van der Berg" → "B.": the first word that starts with a capital, if there is one.
    const sWord = surname.split(/\s+/).find(w => /^\p{Lu}/u.test(w)) ?? surname;
    const sInitial = [...sWord][0];
    if (given && sInitial) {
        const givens = [given];
        const first = given.split(/\s+/)[0];
        if (first !== given) givens.push(first);
        const shortForms = (sub: string | null) => {
            for (const g of givens) {
                push([`${rep}${g} ${sInitial}.`], sub, null, 6);
                push([rep + g, `${sInitial}.`], sub, null, 6);
            }
        };
        if (yr) shortForms(yr);
        shortForms(null);
    }
    // Only exact repeats go (same rows and the same font floor); names only: no step with dates.
    const seen = new Set<string>();
    return out.filter(c => {
        if (content === 'names' && c.sub) return false;
        const k = JSON.stringify([c.lines, c.sub, c.sub2 ?? null, c.note, c.floor2]);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * The most text of a person that fits a box: the first ladder step whose
 * every row fits, trying sizes from the base down by 0.5 px. Null = the
 * sector shows only its colour (its title stays): not even the initials fit.
 */
export function fitFanLabel(p: Person, box: FanLabelBox, opts: FitFanLabelOptions): FanLabel | null {
    const { base, min } = opts;
    const drop = opts.yearsDrop ?? 1.5;
    const measure = opts.measure ?? defaultFanMeasure;
    if (box.len < min * 2.2 || box.cross < min * 1.05) return null;

    const list: Candidate[] = opts.protect
        ? [{ lines: [strings.fan.living], sub: null, note: null, level: 4, floor2: false }]
        : candidates(p, !!opts.repeat, opts.content ?? 'years');

    for (const c of list) {
        const lo = c.floor2 ? Math.max(min, base - 2) : min;
        for (let fs = base; fs >= lo - 0.01; fs -= 0.5) {
            const sfs = Math.max(min, fs - drop);
            const extra = (c.sub ? 1 : 0) + (c.sub2 ? 1 : 0) + (c.note ? 1 : 0);
            if (c.lines.length * fs * LINE_HEIGHT + extra * sfs * LINE_HEIGHT > box.cross) continue;
            let w = 0;
            for (const l of c.lines) w = Math.max(w, measure(l, fs, true));
            if (c.note) w = Math.max(w, measure(c.note, sfs, false));
            if (c.sub) w = Math.max(w, measure(c.sub, sfs, false));
            if (c.sub2) w = Math.max(w, measure(c.sub2, sfs, false));
            if (w <= box.len) {
                const rows: FanLabelRow[] = c.lines.map(text => ({ text, fs, bold: true }));
                if (c.note) rows.push({ text: c.note, fs: sfs, bold: false });
                if (c.sub) rows.push({ text: c.sub, fs: sfs, bold: false });
                if (c.sub2) rows.push({ text: c.sub2, fs: sfs, bold: false });
                return { rows, level: c.level };
            }
        }
    }

    // Step 7: the surname cut with "…", while at least FAN_CUT_KEEP characters stay —
    // a long double surname cut short still names the line, an empty sector names
    // nobody (1101; §4.4 kept 6 characters and 60 %, which left such sectors empty).
    if (box.cross >= min * LINE_HEIGHT) {
        const parts = shownNameParts(p, '?');
        const s = [...(opts.protect ? strings.fan.living : (opts.repeat ? '↻ ' : '') + (parts.surname.trim() || parts.given.trim() || '?'))];
        for (let n = s.length - 1; n >= FAN_CUT_KEEP; n--) {
            const text = s.slice(0, n).join('') + '…';
            if (measure(text, min, true) <= box.len) return { rows: [{ text, fs: min, bold: true }], level: 7 };
        }
        // Step 8: the initials ("W. S."), the card's monogram — still somebody, not an empty sector (1101).
        const mono = opts.protect ? '' : [parts.given, parts.surname].map(w => [...w.trim()][0]).filter(c => c && c !== '?').map(c => `${c}.`).join(' ');
        if (mono && measure(mono, min, true) <= box.len) return { rows: [{ text: mono, fs: min, bold: true }], level: 8 };
    }
    return null;
}

/**
 * The focus disc's text where the ladder gives nothing better (the given name,
 * "Living person"): measured, never wider than the disc (P1b, 3.30.0: a long
 * given name ran into the first sector on a phone). Its words wrap onto as
 * many rows as the box holds; given names beyond them are left out (as step 6
 * keeps only the first); a word too wide for a row is cut with "…". The full
 * name stays in the disc's title.
 */
export function fanFocusFallbackRows(text: string, box: Pick<FanLabelBox, 'len' | 'cross'>, fs: number, measure: FanMeasure = defaultFanMeasure): FanLabelRow[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const maxRows = Math.max(1, Math.floor(box.cross / (fs * LINE_HEIGHT)));
    const fits = (s: string) => measure(s, fs, true) <= box.len;
    const cut = (s: string): string => {
        const chars = [...s];
        for (let n = chars.length - 1; n >= 1; n--) {
            const t = chars.slice(0, n).join('') + '…';
            if (fits(t)) return t;
        }
        return chars[0] + '…';
    };
    const rows: string[] = [];
    for (const w of words) {
        const last = rows.length - 1;
        if (last >= 0 && fits(`${rows[last]} ${w}`)) rows[last] = `${rows[last]} ${w}`;
        // A word cut with "…" ends the text: "Maxi… / There…" names nobody better than "Maxi…".
        else if (rows.length < maxRows && (last < 0 || fits(rows[last]))) rows.push(w);
        else break;
    }
    return rows.map(r => ({ text: fits(r) ? r : cut(r), fs, bold: true }));
}

/** A label's words, whatever its rows and sizes ("Anna / Novak / 1919 – 1979" → "Anna Novak 1919–1979"). */
function fanTextOf(l: FanLabel): string {
    return l.rows.map(r => r.text).join(' ').replace(/\s+/g, ' ').replace(/\s*–\s*/g, '–').replace(/-\s+/g, '-').trim();
}

/**
 * Whether two labels say the same: the same words, however they break into
 * rows and whatever their size (years alone are the same at step 1 and 2).
 * A portrait is drawn only where the label beside it says what it says
 * without one (spec 118 K2.8: the text comes first).
 */
export function sameFanText(a: FanLabel, b: FanLabel): boolean {
    return fanTextOf(a) === fanTextOf(b);
}

/**
 * The label of a person's sector: the ladder in the box fanLabelBox chose,
 * and where that gives nothing or only a shortened surname (the initial or a
 * cut), in the turned box when it holds more — a better step, or more of the
 * name (1101: a wide short sector on a phone had no name at all, surnames
 * were cut where the other direction had room). `adjust` shrinks a
 * box for what else the sector carries (the Kekulé number).
 */
export function fitFanSectorLabel(
    p: Person, s: FanSectorShape, ppu: number, opts: FitFanLabelOptions,
    adjust: (b: FanLabelBox) => FanLabelBox = b => b,
): { label: FanLabel; box: FanLabelBox } | null {
    const box = adjust(fanLabelBox(s, ppu));
    const label = fitFanLabel(p, box, opts);
    if (label && label.level < 6) return { label, box };
    const turned = fanLabelBoxTurned(s, ppu);
    if (turned) {
        const tbox = adjust(turned);
        const tlabel = fitFanLabel(p, tbox, opts);
        if (tlabel && (!label || tlabel.level < label.level || (tlabel.level === label.level && labelChars(tlabel) > labelChars(label)))) {
            return { label: tlabel, box: tbox };
        }
    }
    return label ? { label, box } : null;
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
