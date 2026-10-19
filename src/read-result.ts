/**
 * "Read a document" (spec 013), the result's view logic: the transcription's
 * marks as segments, where a line sits on the scan, which entry shows first,
 * which sections a document's kind shows and how a region fits a box.
 * Pure functions (no DOM); the dialog draws from them.
 */

import type { ReadDocKind, ReadEntry, ReadRegion, ReadResult, ReadVariant } from './research-read.js';

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

const MARK_RE = /\[\?\]|\[(?:\.{2,}|…)\]|\s*\|\s*/g;

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

/** One line with the readers' differing spans (`at` found literally in the line, each variant once). */
export function parseTranscriptLine(line: string, variants: readonly ReadVariant[], used: Set<number>): TranscriptLine {
    const hits: { start: number; end: number; v: ReadVariant }[] = [];
    variants.forEach((v, i) => {
        if (used.has(i) || !v.at) return;
        let from = 0;
        while (from <= line.length) {
            const start = line.indexOf(v.at, from);
            if (start < 0) return;
            const end = start + v.at.length;
            if (!hits.some(h => start < h.end && end > h.start)) {
                hits.push({ start, end, v });
                used.add(i);
                return;
            }
            from = start + 1;
        }
    });
    hits.sort((a, b) => a.start - b.start);
    const segs: LineSeg[] = [];
    let at = 0;
    for (const h of hits) {
        segs.push(...parseMarks(line.slice(at, h.start)));
        segs.push({ t: 'variant', a: parseMarks(h.v.at), b: parseMarks(h.v.other), at: h.v.at, other: h.v.other });
        at = h.end;
    }
    segs.push(...parseMarks(line.slice(at)));
    return { text: line, segs, variant: hits.length > 0 };
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

/** Line `i` of `n` within an entry's region, split evenly (until the research gives lines). */
export function lineRegion(region: ReadRegion, i: number, n: number): ReadRegion {
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

/** The number of places the readers differ in (all entries). */
export function variantCount(entries: readonly Pick<ReadEntry, 'variants'>[]): number {
    return entries.reduce((sum, e) => sum + e.variants.length, 0);
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
