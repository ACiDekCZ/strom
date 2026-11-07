/**
 * "Read a document" (spec 013), the result's view logic: the transcription's
 * marks as segments, where a line sits on the scan, which entry shows first,
 * which sections a document's kind shows and how a region fits a box.
 * Pure functions (no DOM); the dialog draws from them.
 */

import type { ReadDocKind, ReadEntry, ReadRegion, ReadResult, ReadVariant, ReadVariantKind } from './research-read.js';
import { readJudgedKept } from './research-read-task.js';

/** A piece of a transcription line: plain text, an uncertain word (`[?]`), an illegible spot (`[...]`), a column/line mark (`|`). */
export type MarkSeg =
    | { t: 'text'; s: string }
    | { t: 'uncertain'; s: string }
    | { t: 'illegible' }
    | { t: 'sep' };

/** A line's piece where the readers differ: the first reader's span (`a`) and the second's (`b`). */
export interface VariantSeg { t: 'variant'; a: MarkSeg[]; b: MarkSeg[]; at: string; other: string }

export type LineSeg = MarkSeg | VariantSeg;

/** One transcription line, parsed. */
export interface TranscriptLine { text: string; segs: LineSeg[]; variant: boolean }

/** A transcription, parsed: its lines and which marks occur (the legend shows only those). */
export interface ParsedTranscript {
    lines: TranscriptLine[];
    marks: { uncertain: boolean; illegible: boolean; variant: boolean };
}

const MARK_RE = /\[\?\]|\[\s*(?:\.{2,}|…)\s*\]|\s*\|\s*/g;

/** The transcription's lines (empty lines dropped). */
export function transcriptLines(text: string): string[] {
    return text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
}

/** A text's marks as segments: the word before `[?]` becomes uncertain, `[...]` illegible, `|` a separator. */
export function parseMarks(text: string): MarkSeg[] {
    const out: MarkSeg[] = [];
    const pushText = (s: string): void => {
        if (!s) return;
        const last = out[out.length - 1];
        if (last && last.t === 'text') last.s += s;
        else out.push({ t: 'text', s });
    };
    let at = 0;
    for (const m of text.matchAll(MARK_RE)) {
        const start = m.index ?? 0;
        let before = text.slice(at, start);
        at = start + m[0].length;
        const mark = m[0];
        if (mark === '[?]') {
            // The uncertain word: the run of non-space characters just before the mark.
            const w = /(\S+)$/.exec(before);
            if (w) {
                before = before.slice(0, before.length - w[1].length);
                pushText(before);
                out.push({ t: 'uncertain', s: w[1] });
            } else {
                // No word before it (after a space or another mark): the mark stands alone.
                pushText(before);
                out.push({ t: 'uncertain', s: '' });
            }
        } else if (mark.trim() === '|') {
            pushText(before);
            out.push({ t: 'sep' });
        } else {
            pushText(before);
            out.push({ t: 'illegible' });
        }
    }
    pushText(text.slice(at));
    return out;
}

const ILLEGIBLE_AT = /\[\s*(?:\.{2,}|…)\s*\]/y;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const COMBINING = /\p{M}/u;

/** A text folded for finding a span in it: no white space nor `|`, NFC, every illegible mark as `[...]`; each folded unit's span in the text. */
interface Folded { s: string; from: number[]; to: number[] }

function fold(text: string): Folded {
    let s = '';
    const from: number[] = [];
    const to: number[] = [];
    const put = (unit: string, a: number, b: number): void => {
        for (let k = 0; k < unit.length; k++) { from.push(a); to.push(b); }
        s += unit;
    };
    let i = 0;
    while (i < text.length) {
        ILLEGIBLE_AT.lastIndex = i;
        const m = ILLEGIBLE_AT.exec(text);
        if (m) { put('[...]', i, i + m[0].length); i += m[0].length; continue; }
        const ch = text[i];
        if (/\s/.test(ch) || ch === '|') { i++; continue; }
        // A character with its combining marks (decomposed diacritics) is one unit.
        let j = i + ((text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);
        while (j < text.length && COMBINING.test(text[j])) j++;
        put(text.slice(i, j).normalize('NFC'), i, j);
        i = j;
    }
    return { s, from, to };
}

/**
 * Where `at` (a reader's span, as the research composes it from words) lies in `line`: compared without
 * white space and `|` (cells, line marks), NFC, `[…]` / `[ ... ]` as `[...]`; both ends on a word boundary of the
 * line (no "an" inside "Johann"); the first occurrence not overlapping `taken`. The span in the line, or null.
 */
export function locateSpan(line: string, at: string, taken: readonly (readonly [number, number])[] = []): [number, number] | null {
    const needle = fold(at).s;
    if (!needle) return null;
    const hay = fold(line);
    let from = 0;
    for (;;) {
        const k = hay.s.indexOf(needle, from);
        if (k < 0) return null;
        from = k + 1;
        const start = hay.from[k];
        const end = hay.to[k + needle.length - 1];
        if (start > 0 && WORD_CHAR.test(line[start]) && WORD_CHAR.test(line[start - 1])) continue;
        if (end < line.length && WORD_CHAR.test(line[end - 1]) && WORD_CHAR.test(line[end])) continue;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        return [start, end];
    }
}

/** A variant of the transcription's text (not of a person's field, a role or an event). */
export function textVariant(v: ReadVariant): boolean {
    return !v.field || v.field === 'transcript';
}

/** The text variants of `variants` found in `line` (each variant once over the lines: `used`), by index. */
function placeInLine(line: string, variants: readonly ReadVariant[], used: Set<number>): { start: number; end: number; i: number }[] {
    const hits: { start: number; end: number; i: number }[] = [];
    variants.forEach((v, i) => {
        if (used.has(i) || !v.at || !textVariant(v)) return;
        const span = locateSpan(line, v.at, hits.map(h => [h.start, h.end] as const));
        if (!span) return;
        hits.push({ start: span[0], end: span[1], i });
        used.add(i);
    });
    return hits.sort((a, b) => a.start - b.start);
}

/**
 * One line with the readers' differing spans (`at` found in the line by `locateSpan`, each variant once). Only the
 * transcription's own variants: a role, a name field or an event ("p2.role" father / witness) is no text of the
 * line ("other" would light up in "mother"); those show at the person.
 */
export function parseTranscriptLine(line: string, variants: readonly ReadVariant[], used: Set<number>): TranscriptLine {
    const hits = placeInLine(line, variants, used);
    const segs: LineSeg[] = [];
    let at = 0;
    for (const h of hits) {
        const v = variants[h.i];
        segs.push(...parseMarks(line.slice(at, h.start)));
        segs.push({ t: 'variant', a: parseMarks(v.at), b: parseMarks(v.other), at: v.at, other: v.other });
        at = h.end;
    }
    segs.push(...parseMarks(line.slice(at)));
    return { text: line, segs, variant: hits.length > 0 };
}

/** A place where the readers differ: its variant, and for one in the text its line and span there. */
export interface ReadPlace {
    v: ReadVariant;
    /** The transcription line it lies on; -1: not placed in the text (no `at`, not found, or a data place). */
    line: number;
    span: [number, number] | null;
}

/** An entry's places: those of the text (placed first, in reading order) and those only in the data. */
export interface ReaderPlaces { text: ReadPlace[]; data: ReadPlace[] }

/** A span without its marks, for comparing (case and white space aside). */
function markless(text: string): string {
    return text.normalize('NFC').replace(/\[\?\]/g, '').replace(/\[\s*(?:\.{2,}|…)\s*\]/g, '…').replace(/\s*\|\s*/g, ' ')
        .replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/**
 * The places an entry's readers differ in: the transcription's variants (placed in the text where `at` is
 * found, the same way the text marks them), then the variants of the data (a person's name, a date, a place,
 * a person or the entry read by one reader only). A data variant that says the same as a place of the text
 * is that place (left out).
 */
export function readerPlaces(entry: Pick<ReadEntry, 'transcript' | 'variants'>): ReaderPlaces {
    const used = new Set<number>();
    const placed: ReadPlace[] = [];
    transcriptLines(entry.transcript).forEach((line, j) => {
        for (const h of placeInLine(line, entry.variants, used)) placed.push({ v: entry.variants[h.i], line: j, span: [h.start, h.end] });
    });
    const text = [...placed, ...entry.variants.filter((v, i) => textVariant(v) && !used.has(i)).map(v => ({ v, line: -1, span: null }))];
    const seen = new Set(text.map(p => `${markless(p.v.at)}\u0000${markless(p.v.other)}`));
    const data = entry.variants.filter(v => !textVariant(v) && !seen.has(`${markless(v.at)}\u0000${markless(v.other)}`))
        .map(v => ({ v, line: -1, span: null }));
    return { text, data };
}

/** The number of places an entry's readers differ in (as its legend lists them). */
export function placeCount(entry: Pick<ReadEntry, 'transcript' | 'variants'>): number {
    const p = readerPlaces(entry);
    return p.text.length + p.data.length;
}

/** The number of places the readers differ in over all entries. */
export function placeCountAll(entries: readonly Pick<ReadEntry, 'transcript' | 'variants'>[]): number {
    return entries.reduce((sum, e) => sum + placeCount(e), 0);
}

/** The words around a span of a text: up to `words` before and after (`|` and a lone `[?]` not counted), and whether the text goes on. */
export interface PlaceContext { before: string; after: string; moreBefore: boolean; moreAfter: boolean }

export function placeContext(text: string, start: number, end: number, words = 3): PlaceContext {
    const counts = (tok: string): boolean => tok !== '|' && tok !== '[?]';
    const rest = (s: string): boolean => s.replace(/[\s|]/g, '') !== '';
    const head = text.slice(0, start);
    const tail = text.slice(end);
    let from = 0;
    let n = 0;
    const before = [...head.matchAll(/\S+/g)];
    for (let k = before.length - 1; k >= 0; k--) {
        if (counts(before[k][0]) && ++n === words) { from = before[k].index ?? 0; break; }
    }
    let to = tail.length;
    n = 0;
    for (const m of tail.matchAll(/\S+/g)) {
        if (counts(m[0]) && ++n === words) { to = (m.index ?? 0) + m[0].length; break; }
    }
    const flat = (s: string): string => s.replace(/\s+/g, ' ');
    return {
        before: flat(head.slice(from)), after: flat(tail.slice(0, to)),
        moreBefore: rest(head.slice(0, from)), moreAfter: rest(tail.slice(to)),
    };
}

function hasMark(segs: readonly LineSeg[], kind: 'uncertain' | 'illegible'): boolean {
    return segs.some(s => s.t === kind || (s.t === 'variant' && (hasMark(s.a, kind) || hasMark(s.b, kind))));
}

/** An entry's transcription, parsed into lines with its marks and variants. */
export function parseTranscript(entry: Pick<ReadEntry, 'transcript' | 'variants'>): ParsedTranscript {
    const used = new Set<number>();
    const lines = transcriptLines(entry.transcript).map(l => parseTranscriptLine(l, entry.variants, used));
    return {
        lines,
        marks: {
            uncertain: lines.some(l => hasMark(l.segs, 'uncertain')),
            illegible: lines.some(l => hasMark(l.segs, 'illegible')),
            variant: lines.some(l => l.variant),
        },
    };
}

/** A text (a translation) with its marks, without line structure. */
export function parseBlock(text: string): MarkSeg[][] {
    return transcriptLines(text).map(parseMarks);
}

/** Line `i` of `n` within an entry's region: the line's own region when given (`lines`), else the region split evenly. */
export function lineRegion(region: ReadRegion, i: number, n: number, lines?: readonly ReadRegion[]): ReadRegion {
    const own = lines?.[i];
    if (own) return own;
    const [x, y, w, h] = region;
    const count = Math.max(1, n);
    const k = Math.min(count - 1, Math.max(0, i));
    return [x, y + h * k / count, w, h / count];
}

/** The line under a point of the page (fractions), or -1 when it is outside the region. */
export function lineAt(region: ReadRegion, fx: number, fy: number, n: number): number {
    const [x, y, w, h] = region;
    if (n < 1 || h <= 0 || fx < x || fx > x + w || fy < y || fy > y + h) return -1;
    return Math.min(n - 1, Math.floor((fy - y) / h * n));
}

/** The entry shown first: the one whose person the research matched to `refn` (best guess first), else the first. */
export function defaultEntryIndex(entries: readonly Pick<ReadEntry, 'persons'>[], refn: string): number {
    if (!refn) return 0;
    const best = entries.findIndex(e => e.persons.some(p => p.match[0]?.person === refn));
    if (best >= 0) return best;
    const any = entries.findIndex(e => e.persons.some(p => p.match.some(m => m.person === refn)));
    return any >= 0 ? any : 0;
}

/** "Suggest for the tree" is offered: at least one person with a role other than `mentioned`. */
export function canPropose(entry: Pick<ReadEntry, 'persons'> | null | undefined): boolean {
    return !!entry && entry.persons.some(p => p.role !== 'mentioned');
}

/** The base of a language tag ("de-AT" → "de"). */
function langBase(tag: string): string {
    return tag.toLowerCase().split('-')[0];
}

/** The document is in the app's language (all its languages): the translation is not shown. */
export function sameLanguage(docLangs: readonly string[], appLang: string): boolean {
    return docLangs.length > 0 && docLangs.every(l => langBase(l) === langBase(appLang));
}

/** How the explanation is headed by the document's kind ([4c]). */
export type GlossFlavor = 'terms' | 'symbols' | 'context' | 'short';

export function glossFlavor(kind: ReadDocKind): GlossFlavor {
    if (kind.startsWith('register.') || kind === 'certificate') return 'terms';
    if (kind === 'gravestone') return 'symbols';
    if (kind === 'letter' || kind === 'deed') return 'context';
    return 'short';
}

/** Which sections the result shows for an entry: a section without data is not drawn. */
export interface ResultSections {
    transcript: boolean;
    /** The transcription is an inscription (a gravestone). */
    inscription: boolean;
    translation: boolean;
    gloss: boolean;
    about: boolean;
    /** Only mentioned persons: they are listed as "Mentioned" (no suggestion for the tree). */
    mentioned: boolean;
    propose: boolean;
}

export function resultSections(res: Pick<ReadResult, 'doc' | 'context'>, entry: ReadEntry | null, appLang: string): ResultSections {
    const propose = canPropose(entry);
    return {
        transcript: !!entry?.transcript,
        inscription: res.doc.kind === 'gravestone',
        translation: !!entry?.translation && !sameLanguage(res.doc.language, appLang),
        gloss: !!entry?.glossary.length || !!res.context,
        about: !!res.context,
        mentioned: !!entry && entry.persons.length > 0 && !propose,
        propose,
    };
}

/** An entry's first name ("Joannes Novák"), for its pill and its frame's label. */
export function entryName(entry: Pick<ReadEntry, 'persons'>): string {
    const p = entry.persons.find(x => x.role !== 'mentioned' && (x.given || x.surname)) ?? entry.persons.find(x => x.given || x.surname);
    return p ? [p.given, p.surname].filter(Boolean).join(' ') : '';
}

/** Where a page sheet goes so that a region fills a box: its size and offset in the box (px). */
export interface CropLayout { width: number; height: number; left: number; top: number }

/**
 * Fit a page (aspect `ratio` = width / height) into a box `boxW` × `boxH` so
 * that `region` (fractions; null = the whole page) shows whole, centred, with
 * `pad` (a fraction of the page) around it. The sheet covers the box where it
 * can (no empty band at a side when the page reaches beyond it).
 */
export function cropLayout(region: ReadRegion | null, boxW: number, boxH: number, ratio: number, pad = 0.02): CropLayout {
    const ar = ratio > 0 && Number.isFinite(ratio) ? ratio : 0.75;
    if (boxW <= 0 || boxH <= 0) return { width: 0, height: 0, left: 0, top: 0 };
    const [rx, ry, rw, rh] = region ?? [0, 0, 1, 1];
    const p = region ? pad : 0;
    const spanW = Math.min(1, rw + 2 * p);
    const spanH = Math.min(1, rh + 2 * p);
    const width = Math.max(1, Math.min(boxW / Math.max(spanW, 1e-3), boxH * ar / Math.max(spanH, 1e-3)));
    const height = width / ar;
    const place = (box: number, size: number, centre: number): number => {
        if (size <= box) return (box - size) / 2;
        const want = box / 2 - centre * size;
        return Math.min(0, Math.max(box - size, want));
    };
    return {
        width, height,
        left: place(boxW, width, rx + rw / 2),
        top: place(boxH, height, ry + rh / 2),
    };
}

/**
 * The phone's strip over the text (spec 059 P7 §10): the page as wide as the entry (`region`, with `pad` around it)
 * fills the box's width; vertically the whole entry centred when it fits, else the `focus` (the chosen line) centred,
 * else the entry's middle. The sheet never leaves an empty band inside the box when the page reaches beyond it.
 */
export function stripLayout(region: ReadRegion | null, focus: ReadRegion | null, boxW: number, boxH: number, ratio: number, pad = 0.02): CropLayout {
    const ar = ratio > 0 && Number.isFinite(ratio) ? ratio : 0.75;
    if (boxW <= 0 || boxH <= 0) return { width: 0, height: 0, left: 0, top: 0 };
    const [rx, ry, rw, rh] = region ?? [0, 0, 1, 1];
    const p = region ? pad : 0;
    const width = Math.max(1, boxW / Math.max(Math.min(1, rw + 2 * p), 1e-3));
    const height = width / ar;
    const fits = Math.min(1, rh + 2 * p) * height <= boxH;
    const cy = focus && !fits ? focus[1] + focus[3] / 2 : ry + rh / 2;
    const place = (box: number, size: number, centre: number): number => {
        if (size <= box) return (box - size) / 2;
        return Math.min(0, Math.max(box - size, box / 2 - centre * size));
    };
    return { width, height, left: place(boxW, width, rx + rw / 2), top: place(boxH, height, cy) };
}

/** The entry of a source read again shown first: the first of the source's own (`ids`) among `entries`, else -1. */
export function sourceEntryIndex(entries: readonly Pick<ReadEntry, 'id'>[], ids: readonly string[]): number {
    for (const id of ids) {
        const k = entries.findIndex(e => e.id === id);
        if (k >= 0) return k;
    }
    return -1;
}

/**
 * The second reader's transcription of an entry, parsed: the same places marked from its side (`other` found
 * in its text as `at` is in reader 1's), each place's `a` the second reader's version, `b` the first's.
 */
export function parseBlindTranscript(entry: Pick<ReadEntry, 'variants'>, transcript: string): ParsedTranscript {
    const swapped = entry.variants.filter(textVariant).map(v => ({ ...v, at: v.other, other: v.at }));
    return parseTranscript({ transcript, variants: swapped });
}

// ---- Result screen, round 2 (spec 059 P7): one place = one mark, kinds of a difference, the header's sentence ----

/** The kinds of a difference that are minor details (folded under "and N minor details"); the rest are substantive. */
export const MINOR_KINDS: ReadonlySet<ReadVariantKind> = new Set<ReadVariantKind>(['spelling', 'punctuation', 'label', 'abbr', 'case']);

const MINOR_STRIP = /[\s.,;:!?„“"'()\-–|]/g;

/**
 * A difference told apart without the research's kind: only punctuation, white space and case differ → a minor
 * detail; anything else (a letter, a diacritic, a mark) → a change.
 */
export function classifyVariant(at: string, other: string): 'minor' | 'change' {
    const f = (s: string): string => s.normalize('NFC').toLocaleLowerCase().replace(MINOR_STRIP, '');
    return f(at) === f(other) ? 'minor' : 'change';
}

/** A difference, merged from neighbours: the kinds of its parts when every part named one. */
export interface MergedVariant extends ReadVariant { kinds?: ReadVariantKind[] }

/** How a difference counts: a minor detail or not, and the kinds the research named (empty: none named, the app sorted it). */
export interface VariantClass { minor: boolean; kinds: ReadVariantKind[] }

export function variantClass(v: MergedVariant): VariantClass {
    const kinds = v.kinds ?? (v.kind ? [v.kind] : []);
    if (kinds.length) return { minor: kinds.every(k => MINOR_KINDS.has(k)), kinds };
    return { minor: classifyVariant(v.at, v.other) === 'minor', kinds: [] };
}

/** Only white space and punctuation between two places; a register's cell boundary (`|`) keeps them apart (other fields). */
const GAP_ONLY = /^[\s.,;:!?„“"'()\-–]*$/;

/**
 * Differences next to each other merged into one: two variants whose spans in `text` (the text as read; `side` says
 * which of `at` / `other` is its words) have only white space and punctuation between them on one line become one
 * (both sides joined, the kinds of both, the region around both). Variants not found in the text stay as they are;
 * the order is kept (a merged one where its first part was).
 */
export function mergeAdjacent(variants: readonly ReadVariant[], text: string, side: 'at' | 'other' = 'at'): MergedVariant[] {
    const lines = transcriptLines(text);
    const read = (v: ReadVariant): string => side === 'at' ? v.at : v.other;
    const old = (v: ReadVariant): string => side === 'at' ? v.other : v.at;
    const oriented = variants.map(v => ({ ...v, at: read(v), other: old(v) }));
    const used = new Set<number>();
    const hits: { line: number; start: number; end: number; i: number }[] = [];
    lines.forEach((line, j) => { for (const h of placeInLine(line, oriented, used)) hits.push({ line: j, ...h }); });
    const groups: (typeof hits)[] = [];
    for (const h of hits) {
        const g = groups[groups.length - 1];
        const prev = g?.[g.length - 1];
        if (prev && prev.line === h.line && GAP_ONLY.test(lines[h.line].slice(prev.end, h.start))) g.push(h);
        else groups.push([h]);
    }
    const merged = new Map<number, MergedVariant>();
    const dropped = new Set<number>();
    for (const g of groups) {
        if (g.length < 2) continue;
        const line = lines[g[0].line];
        const parts = g.map(h => variants[h.i]);
        const readSide = line.slice(g[0].start, g[g.length - 1].end);
        const oldSide = g.map((h, k) => (k ? line.slice(g[k - 1].end, h.start).replace(/\s+/g, ' ') : '') + old(variants[h.i])).join('').trim();
        const kinds = parts.every(p => p.kind) ? [...new Set(parts.map(p => p.kind!))] : undefined;
        const regions = parts.map(p => p.region);
        const region = regions.every((r): r is ReadRegion => !!r) ? unionRegion(regions) : undefined;
        const first = Math.min(...g.map(h => h.i));
        const kind = kinds ? kinds.find(k => !MINOR_KINDS.has(k)) ?? kinds[0] : undefined;
        // Unsure when any part is; sure only when every part says so; judged when every part was, in one task.
        const sure = parts.some(p => p.sure === false) ? false : parts.every(p => p.sure === true) ? true : undefined;
        const judged = parts.every(p => p.judged && p.judged === parts[0].judged) ? parts[0].judged : undefined;
        merged.set(first, {
            at: side === 'at' ? readSide : oldSide, other: side === 'at' ? oldSide : readSide,
            ...(parts[0].field ? { field: parts[0].field } : {}),
            ...(kind ? { kind } : {}), ...(kinds ? { kinds } : {}), ...(region ? { region } : {}),
            ...(sure !== undefined ? { sure } : {}), ...(judged ? { judged } : {}),
        });
        for (const h of g) if (h.i !== first) dropped.add(h.i);
    }
    return variants.flatMap((v, i) => dropped.has(i) ? [] : [merged.get(i) ?? v]);
}

function unionRegion(rs: readonly ReadRegion[]): ReadRegion {
    const x0 = Math.min(...rs.map(r => r[0])), y0 = Math.min(...rs.map(r => r[1]));
    const x1 = Math.max(...rs.map(r => r[0] + r[2])), y1 = Math.max(...rs.map(r => r[1] + r[3]));
    return [x0, y0, x1 - x0, y1 - y0];
}

/** The number of illegible spots (`[…]`) in a text. */
export function illegibleCount(text: string): number {
    return (text.match(/\[\s*(?:\.{2,}|…)\s*\]/g) ?? []).length;
}

/** Words of a text for comparing: white space and `|` aside, NFC. */
function compareTokens(text: string): string[] {
    return text.normalize('NFC').replace(/\s*\|\s*/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * A text compared with a source's existing transcript in the app (a source read again whose entry the research did
 * not find, spec 059 P7 §6): the runs of words that differ, as `source.variants` carry them (`at` the transcript's
 * words, `other` the text's). Word by word (longest common run); a very long text is compared as far as the cap.
 */
export function compareWithTranscript(transcript: string, text: string, cap = 1500): ReadVariant[] {
    const a = compareTokens(transcript).slice(0, cap);
    const b = compareTokens(text).slice(0, cap);
    const n = a.length, m = b.length;
    // Length of the common run from (i, j) on, row by row from the end.
    const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const out: ReadVariant[] = [];
    let i = 0, j = 0;
    let oldRun: string[] = [], newRun: string[] = [];
    const flush = (): void => {
        if (oldRun.length || newRun.length) out.push({ at: oldRun.join(' '), other: newRun.join(' ') });
        oldRun = []; newRun = [];
    };
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; }
        else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) newRun.push(b[j++]);
        else oldRun.push(a[i++]);
    }
    flush();
    return out;
}

// ---- A source read again, sorted (spec 059, `read.sourceTask`): only sure substantive changes go into a task ----

/** Where a change against the transcript belongs: a sure substantive change, the readers disagree, assessed in a task before, a minor detail. */
export type ReadSourceCat = 'major' | 'unsure' | 'judged' | 'minor';

const ILLEGIBLE_ONLY = /^\s*\[\s*(?:\.{2,}|…)\s*\]\s*$/;

/**
 * One change's group: `unsure` when the research says it is not sure (also an illegible spot in the new reading
 * where the transcript has a word), `judged` when a task assessed it before or a person kept the reading, `minor` by its kind (without a kind:
 * the app's own rule), the rest `major`.
 */
export function readSourceCat(v: MergedVariant): ReadSourceCat {
    if (v.sure === false || (ILLEGIBLE_ONLY.test(v.other) && v.at.trim() !== '')) return 'unsure';
    if (v.judged) return 'judged';
    return variantClass(v).minor ? 'minor' : 'major';
}

export interface ReadSourceSorted<V> { major: V[]; unsure: V[]; judged: V[]; minor: V[] }

/** The changes in their groups (order kept). Only `major` goes into a task: its length is the count everywhere. */
export function readSourceSort<V extends MergedVariant>(variants: readonly V[]): ReadSourceSorted<V> {
    const out: ReadSourceSorted<V> = { major: [], unsure: [], judged: [], minor: [] };
    for (const v of variants) out[readSourceCat(v)].push(v);
    return out;
}

/** The research says which changes are sure or assessed: the sorted view applies (else everything as before it). */
export function readSourceSaysSure(variants: readonly ReadVariant[]): boolean {
    return variants.some(v => v.sure !== undefined || !!v.judged);
}

/** What the header's sentence says (spec 059 P7 §3), counted by the dialog. */
export interface VerdictFacts {
    /** Read only in part, with the reason in words ('' none). */
    partial: boolean;
    why: string;
    illegible: number;
    /** A source read again: compared (substantive changes, minor details, whether the research named the kinds), or not compared (`why`: its own sentence, else the entry not found). */
    source: { compared: true; major: number; minor: number; kinded: boolean; sorted?: VerdictSorted } | { compared: false; why?: string } | null;
    /** Two readers on this entry: the places they disagree in (0: they agree); null: not both read it. */
    disagree: number | null;
}

/**
 * One reader read (as the research counts it: a reading where the second one did not run is one reader's): its places
 * not sure are where that reader was not sure, never where readers disagree.
 */
export function readOneReader(r: Pick<ReadResult, 'readers' | 'blind'>): boolean {
    return (r.readers.ran || r.readers.asked) < 2 && !r.blind;
}

/** A source read again, sorted (`read.sourceTask`): the groups' counts, the assessed ones by task (a kept reading's, D…: one group). */
export interface VerdictSorted { major: number; unsure: number; minor: number; judged: { task: string; n: number }[] }

/** The strings the header's sentence is made of (`strings.read`). `b` makes a count bold. */
export interface VerdictStrings {
    vRead: string;
    vIll: (n: number) => string;
    vPartial: (n: number, why: string) => string;
    vSrc: (major: number, minor: number, kinded: boolean, b: (s: string) => string) => string;
    vSrcSame: string;
    vNc: string;
    vDis: (n: number, b: (s: string) => string) => string;
    vAgree: string;
    vMajor: (n: number) => string;
    vUnsure: (n: number) => string;
    vMinor: (n: number) => string;
    vJudged: (n: number, task: string) => string;
    vKept: (n: number) => string;
}

/** The reason after the illegible words' count, in words: none for `other` or an unknown reason
 *  (its text is written for a document that could not be read at all, not for a count of words). */
export function verdictWhy(why: string | null | undefined, whyText: Record<string, string>): string {
    return why && why !== 'other' ? whyText[why] ?? '' : '';
}

/** The header's sentence: legibility, then the comparison with the transcript, then the readers. `bPart`: a whole part bold (the sorted groups' first). */
export function composeVerdict(f: VerdictFacts, t: VerdictStrings, b: (s: string) => string = s => s, bPart: (s: string) => string = b): string {
    const out: string[] = [];
    out.push(f.partial ? t.vPartial(f.illegible, f.why) : f.illegible > 0 ? t.vIll(f.illegible) : t.vRead);
    if (f.source && !f.source.compared) out.push(f.source.why || t.vNc);
    else if (f.source?.compared && f.source.sorted) {
        // Sorted: the groups joined by "·", the first bold, a group without places left out; the readers are in "uncertain".
        const s = f.source.sorted;
        const parts = [
            s.major ? t.vMajor(s.major) : '', s.unsure ? t.vUnsure(s.unsure) : '', s.minor ? t.vMinor(s.minor) : '',
            ...s.judged.filter(j => j.n > 0).map(j => readJudgedKept(j.task) ? t.vKept(j.n) : t.vJudged(j.n, j.task)),
        ].filter(Boolean);
        out.push(parts.length ? [bPart(parts[0]), ...parts.slice(1)].join(' · ') : t.vSrcSame);
        return out.join(' ');
    }
    else if (f.source?.compared) out.push(f.source.major + f.source.minor ? t.vSrc(f.source.major, f.source.minor, f.source.kinded, b) : t.vSrcSame);
    if (f.disagree !== null) out.push(f.disagree > 0 ? t.vDis(f.disagree, b) : t.vAgree);
    return out.join(' ');
}
