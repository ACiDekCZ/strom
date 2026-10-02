/**
 * What changed between the approved story and its waiting new version
 * (Story.draft): paragraphs paired by likeness, a word diff inside each pair,
 * and the lines of facts as a set. Pure and DOM-free; src/story-compare.ts
 * sets it as HTML.
 *
 * Paragraphs are the blank-line blocks of the text. A pair is two paragraphs
 * sharing at least half their words (Dice over the words); a paragraph with no
 * partner is new (only in the new version) or removed (only in the approved
 * one). Inside a pair the diff runs over tokens: a word or a punctuation mark,
 * each carrying the whitespace after it, so spacing never shows as a change.
 * `**bold**` marks do not take part in the comparison — a token only remembers
 * that it was bold, so the changes can still be set in bold.
 */

import { sameText } from './story-text.js';

/** A run of text, bold or not. */
export interface StorySeg {
    text: string;
    bold: boolean;
}

/** A run of a changed paragraph: kept, added (new version) or removed (approved). */
export interface StoryWordOp extends StorySeg {
    op: 'eq' | 'add' | 'del';
}

/** A paragraph as written: a subheading (`## …`) or prose. */
export interface StoryPara {
    heading: boolean;
    segs: StorySeg[];
}

export type StoryParaDiff =
    /** `n`: its number in the new version (1-based). */
    | { kind: 'same'; n: number; para: StoryPara }
    | { kind: 'changed'; heading: boolean; ops: StoryWordOp[] }
    | { kind: 'added'; para: StoryPara }
    | { kind: 'removed'; para: StoryPara };

export interface StoryTextDiff {
    paras: StoryParaDiff[];
    /** Paragraphs in the comparison, and how many of them are not the same. */
    total: number;
    changed: number;
    /** Fold the unchanged ones: at most half the paragraphs changed. */
    collapse: boolean;
}

/** Below this share of common words two paragraphs are not a pair. */
const PAIR_MIN = 0.5;
/** Past this many token pairs a paragraph is compared whole (removed + added). */
const MAX_CELLS = 4_000_000;

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const BOLD = /\*\*(?=\S)([^*]+?)\*\*/g;
const TOKEN = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*[^\S\n]*|\n|[^\s\p{L}\p{N}][^\S\n]*|[^\S\n]+/gu;
const WORD = /[\p{L}\p{N}]/u;

interface Token extends StorySeg {
    /** What is compared: the token without its whitespace. */
    key: string;
}

/**
 * The blank-line blocks of a text. A first `# …` that only repeats the title
 * is left out (the reader and the book leave it out too); a subheading loses
 * its marks; a list item's dash becomes a bullet.
 */
export function storyParagraphs(text: string, title?: string): StoryPara[] {
    const blocks = text.replace(/\r\n?/g, '\n').split(/\n[^\S\n]*\n/)
        .map(b => b.split('\n').map(l => l.trim()).filter(Boolean).join('\n'))
        .filter(Boolean);
    const out: StoryPara[] = [];
    blocks.forEach((block, i) => {
        const h = !block.includes('\n') ? HEADING.exec(block) : null;
        if (h && i === 0 && block.startsWith('# ') && title && sameText(h[1], title)) return;
        const body = h ? h[1] : block.replace(/^-\s+/gm, '• ');
        out.push({ heading: !!h, segs: boldSegs(body) });
    });
    return out;
}

/** `**bold**` spans out of a text: the marks go, the runs remember. */
function boldSegs(text: string): StorySeg[] {
    const segs: StorySeg[] = [];
    let last = 0;
    for (const m of text.matchAll(BOLD)) {
        if (m.index! > last) segs.push({ text: text.slice(last, m.index), bold: false });
        segs.push({ text: m[1], bold: true });
        last = m.index! + m[0].length;
    }
    if (last < text.length) segs.push({ text: text.slice(last), bold: false });
    return segs;
}

function tokens(para: StoryPara): Token[] {
    const out: Token[] = [];
    for (const seg of para.segs) {
        for (const m of seg.text.matchAll(TOKEN)) {
            const key = m[0] === '\n' ? '\n' : m[0].trim();
            // Whitespace alone (a space between two bold runs) sticks to the token before.
            if (!key && out.length > 0) { out[out.length - 1].text += m[0]; continue; }
            out.push({ text: m[0], bold: seg.bold, key });
        }
    }
    return out;
}

/** The plain words of a paragraph (for pairing and for "is it the same"). */
function words(para: StoryPara): string[] {
    return tokens(para).map(t => t.key.toLocaleLowerCase()).filter(k => WORD.test(k));
}

const plain = (para: StoryPara): string => tokens(para).map(t => t.key).join(' ');

/** Dice coefficient over two multisets of words. */
function likeness(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 1;
    const count = new Map<string, number>();
    for (const w of a) count.set(w, (count.get(w) ?? 0) + 1);
    let common = 0;
    for (const w of b) {
        const n = count.get(w) ?? 0;
        if (n > 0) { common++; count.set(w, n - 1); }
    }
    return (2 * common) / (a.length + b.length);
}

/**
 * The best order-preserving pairing of two lists, by weight (0 = no pair):
 * the classic LCS table with weights instead of ones.
 */
function align(n: number, m: number, w: (i: number, j: number) => number): [number, number][] {
    const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            const pair = w(i, j);
            t[i][j] = Math.max(t[i + 1][j], t[i][j + 1], pair > 0 ? pair + t[i + 1][j + 1] : 0);
        }
    }
    const out: [number, number][] = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        const pair = w(i, j);
        if (pair > 0 && t[i][j] === pair + t[i + 1][j + 1]) { out.push([i, j]); i++; j++; }
        else if (t[i][j] === t[i + 1][j]) i++;
        else j++;
    }
    return out;
}

/** Word diff of two paired paragraphs. */
function wordDiff(a: StoryPara, b: StoryPara): StoryWordOp[] {
    const x = tokens(a), y = tokens(b);
    const ops: StoryWordOp[] = [];
    const push = (op: StoryWordOp['op'], t: Token): void => {
        const prev = ops[ops.length - 1];
        if (prev && prev.op === op && prev.bold === t.bold) prev.text += t.text;
        else ops.push({ op, text: t.text, bold: t.bold });
    };
    if (x.length * y.length > MAX_CELLS) {
        x.forEach(t => push('del', t));
        y.forEach(t => push('add', t));
        return ops;
    }
    let i = 0, j = 0;
    for (const [pi, pj] of align(x.length, y.length, (p, q) => x[p].key === y[q].key ? 1 : 0)) {
        // Between two kept tokens: what went, then what came.
        while (i < pi) push('del', x[i++]);
        while (j < pj) push('add', y[j++]);
        push('eq', y[j]);
        i++; j++;
    }
    while (i < x.length) push('del', x[i++]);
    while (j < y.length) push('add', y[j++]);
    return ops;
}

/** The approved text against the new one (each with its own title, for a leading `# title`). */
export function diffStoryText(oldText: string, newText: string, oldTitle?: string, newTitle?: string): StoryTextDiff {
    const a = storyParagraphs(oldText, oldTitle);
    const b = storyParagraphs(newText, newTitle);
    const wa = a.map(words), wb = b.map(words);
    const pa = a.map(plain), pb = b.map(plain);
    // The same paragraph weighs more than a merely similar one, so an
    // unchanged paragraph is never paired with its edited neighbour.
    const weight = (i: number, j: number): number => {
        if (pa[i] === pb[j]) return 2;
        const l = likeness(wa[i], wb[j]);
        return l >= PAIR_MIN ? l : 0;
    };
    const paras: StoryParaDiff[] = [];
    let i = 0, j = 0;
    const rest = (toI: number, toJ: number): void => {
        while (i < toI) paras.push({ kind: 'removed', para: a[i++] });
        while (j < toJ) paras.push({ kind: 'added', para: b[j++] });
    };
    for (const [pi, pj] of align(a.length, b.length, weight)) {
        rest(pi, pj);
        if (pa[i] === pb[j]) paras.push({ kind: 'same', n: j + 1, para: b[j] });
        else paras.push({ kind: 'changed', heading: b[j].heading, ops: wordDiff(a[i], b[j]) });
        i++; j++;
    }
    rest(a.length, b.length);
    const changed = paras.filter(p => p.kind !== 'same').length;
    return { paras, total: paras.length, changed, collapse: changed * 2 <= paras.length };
}

/** Lines only in the new list, and only in the old one (order kept; whitespace aside). */
export function diffStoryLines(oldLines: readonly string[], newLines: readonly string[]): { added: string[]; removed: string[] } {
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const oldSet = new Set(oldLines.map(norm).filter(Boolean));
    const newSet = new Set(newLines.map(norm).filter(Boolean));
    return {
        added: newLines.filter(l => norm(l) && !oldSet.has(norm(l))),
        removed: oldLines.filter(l => norm(l) && !newSet.has(norm(l))),
    };
}
