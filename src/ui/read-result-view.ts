/**
 * "Read a document", the result screen's text and lists (spec 059 P7): the text as read with one mark per place
 * (the readers disagree, a change against the existing transcript, an uncertain word, an illegible spot), the
 * "To check" list in groups (substantive first, minor details folded) and the bubble of a place. HTML from plain
 * data; the dialog wires it.
 */

import { strings } from '../strings.js';
import { researchLinkMark } from '../research-link.js';
import { researchActionLabel } from './research-open-mark.js';
import { locateSpan, readSourceCat, variantClass, type MergedVariant, type ReadSourceCat, type VariantClass, type VerdictSorted } from '../read-result.js';
import { readJudgedKept } from '../research-read-task.js';

export type PlaceKind = 'dis' | 'chg' | 'unc' | 'ill';

/** One place of the shown entry: a mark in the text and a row in "To check". */
export interface ShownPlace {
    /** `d0` a disagreement, `c0` a change, `u3-12` / `i3-12` an uncertain word / an illegible spot (line, offset). */
    id: string;
    kind: PlaceKind;
    /** Its line in the shown text (-1: not in the text, e.g. a place of the data). */
    line: number;
    span: [number, number] | null;
    /** A disagreement: `at` reader 1, `other` reader 2. A change: `at` the existing transcript, `other` the new reading. */
    v: MergedVariant | null;
    cls: VariantClass | null;
    /** An uncertain word. */
    word: string;
    /** A place of the data: what it is about ("Josef Vlk · surname"). */
    label: string;
    /** An uncertain word or illegible spot inside a disagreement or a change: that place's row covers it. */
    inside: boolean;
    /** A change listed but not marked in the shown text (reader 2's text shows; the change lies in reader 1's). */
    elsewhere?: boolean;
    /** A change, sorted (`read.sourceTask`): its group (`sortPlaces`). */
    cat?: ReadSourceCat;
    /** A disagreement, sorted: the change whose row covers it (the readers disagree on a changed word). */
    under?: string;
    /** An uncertain change, sorted: reader 2's words there (from the disagreement it covers); absent: not known. */
    r2?: string;
}

interface Tok { k: 'text' | 'unc' | 'ill' | 'sep'; start: number; end: number; word: string }

const TOK_RE = /\[\?\]|\[\s*(?:\.{2,}|…)\s*\]|\s*\|\s*/g;

/** A line cut into its text and its marks, each with its span (the word before `[?]` belongs to its mark). */
export function lineTokens(line: string): Tok[] {
    const out: Tok[] = [];
    const text = (a: number, b: number): void => { if (b > a) out.push({ k: 'text', start: a, end: b, word: '' }); };
    let at = 0;
    for (const m of line.matchAll(TOK_RE)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        if (m[0] === '[?]') {
            const w = /(\S+)$/.exec(line.slice(at, start));
            const from = w ? start - w[1].length : start;
            text(at, from);
            out.push({ k: 'unc', start: from, end, word: w ? w[1] : '' });
        } else if (m[0].trim() === '|') {
            text(at, start);
            out.push({ k: 'sep', start, end, word: '' });
        } else {
            text(at, start);
            out.push({ k: 'ill', start, end, word: '' });
        }
        at = end;
    }
    text(at, line.length);
    return out;
}

/** A span widened to whole marks (never half of `Novák[?]` or of `[…]`). */
function snap(span: [number, number], toks: readonly Tok[]): [number, number] {
    let [a, b] = span;
    for (const t of toks) {
        if (t.k !== 'unc' && t.k !== 'ill') continue;
        if (a > t.start && a < t.end) a = t.start;
        if (b > t.start && b < t.end) b = t.end;
    }
    return [a, b];
}

/** A word as compared for the context of a place: NFC, lower case, without marks and the punctuation around it ('' none). */
function contextWord(w: string): string {
    return w.normalize('NFC').toLocaleLowerCase().replace(/\[\?\]/g, '').replace(/^[.,;:!?„“"'()\-–]+|[.,;:!?„“"'()\-–]+$/g, '');
}

/** The words of a text as compared for a context, `|` and marks aside. */
function contextWords(text: string): string[] {
    return text.split(/[\s|]+/).map(contextWord).filter(Boolean);
}

/** How many words around `[a, b)` of `words` match `before` (its end) and `after` (its start), up to `n` each side. */
function contextScore(words: readonly string[], a: number, b: number, before: readonly string[], after: readonly string[], n: number): number {
    let score = 0;
    for (let k = 1; k <= n && k <= before.length && a - k >= 0 && words[a - k] === before[before.length - k]; k++) score++;
    for (let k = 0; k < n && k < after.length && b + k < words.length && words[b + k] === after[k]; k++) score++;
    return score;
}

/** Words of context compared on each side of a repeated place. */
const CONTEXT_WORDS = 3;

/**
 * Of the occurrences of a place's words in the shown text, the one the other text has around the place's other
 * words: the research says no position of a place (only its words), and a word repeated ("12 | 3. Martii | 12")
 * is the occurrence whose neighbours stand around the other side there. -1: not to tell (the first one stays).
 */
function pickByContext(lines: readonly string[], spots: readonly { line: number; span: [number, number] }[], counter: readonly string[], counterNeedle: string): number {
    const want = contextWords(counterNeedle);
    // Where the other words stand in the other text (none: each gap between its words).
    const at: [number, number][] = [];
    for (let i = 0; i + want.length <= counter.length; i++) {
        if (want.every((w, k) => counter[i + k] === w)) at.push([i, i + want.length]);
    }
    if (!at.length) return -1;
    // The most neighbours alike wins; of equals, the first (as without the other text).
    let best = -1, bestScore = 0;
    spots.forEach((p, i) => {
        const before = contextWords([...lines.slice(0, p.line), lines[p.line].slice(0, p.span[0])].join('\n'));
        const after = contextWords([lines[p.line].slice(p.span[1]), ...lines.slice(p.line + 1)].join('\n'));
        const score = Math.max(...at.map(([a, b]) => contextScore(counter, a, b, before, after, CONTEXT_WORDS)));
        if (score > bestScore) { best = i; bestScore = score; }
    });
    return best;
}

/**
 * Where each variant lies in the lines (`side`: which of its words are in this text), each once, the first
 * occurrence not taken by an earlier one; null where not found. `counter`: the text of the variant's other side
 * (the other reader's, the existing transcript): a place whose words stand more than once in the lines takes the
 * occurrence with the same neighbours there.
 */
export function locatePlaces(lines: readonly string[], variants: readonly MergedVariant[], side: 'at' | 'other', counter?: string): ({ line: number; span: [number, number] } | null)[] {
    const taken: [number, number][][] = lines.map(() => []);
    const toks = lines.map(lineTokens);
    const counterWords = counter ? contextWords(counter) : null;
    return variants.map(v => {
        const needle = side === 'at' ? v.at : v.other;
        if (!needle.trim()) return null;
        const spots: { line: number; span: [number, number] }[] = [];
        for (let j = 0; j < lines.length; j++) {
            const seen: [number, number][] = [...taken[j]];
            for (;;) {
                const span = locateSpan(lines[j], needle, seen);
                if (!span) break;
                spots.push({ line: j, span: snap(span, toks[j]) });
                seen.push(span);
                if (!counterWords) break;
            }
            if (spots.length && !counterWords) break;
        }
        if (!spots.length) return null;
        const k = spots.length > 1 && counterWords ? pickByContext(lines, spots, counterWords, side === 'at' ? v.other : v.at) : -1;
        const p = spots[k >= 0 ? k : 0];
        taken[p.line].push(p.span);
        return p;
    });
}

export interface ResultMarksInput {
    /** The shown text (reader 1's or reader 2's). */
    text: string;
    /** The readers' places of the text (`at` reader 1, `other` reader 2), found in the text by `disSide`. */
    dis: readonly MergedVariant[];
    disSide: 'at' | 'other';
    /** The research named the kinds of the readers' places (`read.variantKind`): minor ones fold. */
    disKinded: boolean;
    /** The readers' places only in the data, with what each is about. */
    data: readonly { v: MergedVariant; label: string }[];
    /** Changes against the existing transcript (`other` in this text), or null: not marked in this text. */
    chg: readonly MergedVariant[] | null;
    /** The other reader's text (the readers' places' other side): a repeated word is placed by its neighbours there. */
    disCounter?: string;
    /** The existing transcript (the changes' other side), for the same. */
    chgCounter?: string;
}

export interface ResultMarks { lines: string[]; places: ShownPlace[] }

/** The shown entry's places, in reading order within each kind. */
export function resultPlaces(o: ResultMarksInput): ResultMarks {
    const lines = o.text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
    const places: ShownPlace[] = [];
    const disAt = locatePlaces(lines, o.dis, o.disSide, o.disCounter);
    o.dis.forEach((v, i) => {
        const p = disAt[i];
        const cls = o.disKinded && (v.kind || v.kinds) ? variantClass(v) : { minor: false, kinds: [] };
        places.push({ id: `d${i}`, kind: 'dis', line: p?.line ?? -1, span: p?.span ?? null, v, cls, word: '', label: '', inside: false });
    });
    o.data.forEach((d, i) => places.push({
        id: `d${o.dis.length + i}`, kind: 'dis', line: -1, span: null, v: d.v,
        cls: o.disKinded && (d.v.kind || d.v.kinds) ? variantClass(d.v) : { minor: false, kinds: [] }, word: '', label: d.label, inside: false,
    }));
    if (o.chg) {
        const chgAt = locatePlaces(lines, o.chg, 'other', o.chgCounter);
        o.chg.forEach((v, i) => {
            const p = chgAt[i];
            places.push({ id: `c${i}`, kind: 'chg', line: p?.line ?? -1, span: p?.span ?? null, v, cls: variantClass(v), word: '', label: '', inside: false });
        });
    }
    lines.forEach((line, j) => {
        for (const tk of lineTokens(line)) {
            if (tk.k !== 'unc' && tk.k !== 'ill') continue;
            const inside = places.some(p => p.line === j && p.span && p.span[0] <= tk.start && p.span[1] >= tk.end);
            places.push({ id: `${tk.k === 'unc' ? 'u' : 'i'}${j}-${tk.start}`, kind: tk.k, line: j, span: [tk.start, tk.end], v: null, cls: null, word: tk.word, label: '', inside });
        }
    });
    return { lines, places };
}

/** Two places cover the same words: on one line, spans that meet; without spans (another text shows), words in common. */
function overlaps(c: ShownPlace, d: ShownPlace): boolean {
    if (c.span && d.span && !c.elsewhere && c.line === d.line) return c.span[0] < d.span[1] && d.span[0] < c.span[1];
    const a = (c.v?.other ?? '').trim(), b = (d.v?.at ?? '').trim();
    return !!a && !!b && (a.includes(b) || b.includes(a));
}

/**
 * The places sorted (spec 059, `read.sourceTask`): each change gets its group, a disagreement on a changed word is
 * covered by that change (listed once, in the change's row), an uncertain change keeps reader 2's words.
 */
export function sortPlaces(places: readonly ShownPlace[]): ShownPlace[] {
    const out = places.map(p => p.kind === 'chg' && p.v ? { ...p, cat: readSourceCat(p.v) } : { ...p });
    const chg = out.filter(p => p.kind === 'chg');
    for (const d of out) {
        if (d.kind !== 'dis' || !d.v || d.line < 0) continue;
        const c = chg.find(x => overlaps(x, d));
        if (!c) continue;
        d.under = c.id;
        if (c.cat === 'unsure' && c.r2 === undefined) c.r2 = d.v.other;
    }
    return out;
}

/** The sorted groups of "To check": sure changes, uncertain (changes and the readers' other places), assessed by task, minor. */
export interface SortedGroups {
    major: ShownPlace[];
    unsure: ShownPlace[];
    judged: { task: string; rows: ShownPlace[] }[];
    minor: ShownPlace[];
}

export function sortedGroups(places: readonly ShownPlace[]): SortedGroups {
    const g: SortedGroups = { major: [], unsure: [], judged: [], minor: [] };
    for (const p of places) {
        if (p.inside) continue;
        if (p.kind === 'chg') {
            if (p.cat === 'judged' && p.v?.judged) {
                const task = p.v.judged;
                // A task's places by task; the readings a person kept (D…) in one group.
                const kept = readJudgedKept(task);
                const j = g.judged.find(x => kept ? readJudgedKept(x.task) : x.task === task);
                if (j) j.rows.push(p); else g.judged.push({ task, rows: [p] });
            } else g[p.cat === 'judged' ? 'major' : p.cat ?? 'major'].push(p);
        } else if (p.kind === 'dis' && !p.under) {
            g[p.cls?.minor ? 'minor' : 'unsure'].push(p);
        }
    }
    // Changes and the readers' places mixed in a group: in reading order (a place off the text last).
    const at = (p: ShownPlace): number => p.line < 0 || !p.span ? Infinity : p.line * 1e6 + p.span[0];
    for (const rows of [g.unsure, g.minor]) rows.sort((x, y) => at(x) - at(y) || 0);
    return g;
}

/** The sorted groups' counts for the header's sentence. */
export function sortedCounts(places: readonly ShownPlace[]): VerdictSorted {
    const g = sortedGroups(places);
    return { major: g.major.length, unsure: g.unsure.length, minor: g.minor.length, judged: g.judged.map(j => ({ task: j.task, n: j.rows.length })) };
}

/** The bubble's word on an assessed place: the task that assessed it, or the reading a person kept. */
function judgedText(judged: string): string {
    return readJudgedKept(judged) ? strings.read.bKept : strings.read.bJudged(judged);
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PLACE_ATTRS = (id: string, focus: string): string =>
    ` data-place="${esc(id)}" tabindex="0" role="button" aria-haspopup="dialog"${id === focus ? ' data-focus' : ''}`;

/** A piece of text with its marks (an uncertain word: dotted with a raised ?, an illegible spot: a label); `ids`: marks that are places. */
function piecesHtml(line: string, toks: readonly Tok[], a: number, b: number, ids: ReadonlyMap<number, string> | null, focus: string): string {
    const t = strings.read;
    let out = '';
    for (const tk of toks) {
        if (tk.k === 'text') {
            const s = Math.max(a, tk.start), e = Math.min(b, tk.end);
            if (e > s) out += esc(line.slice(s, e));
            continue;
        }
        if (tk.start < a || tk.start >= b) continue;
        const id = ids?.get(tk.start);
        const attrs = id ? PLACE_ATTRS(id, focus) : '';
        const cls = id === focus && id ? ' is-focus' : '';
        if (tk.k === 'sep') out += '<span class="read-sep" aria-hidden="true"> | </span>';
        else if (tk.k === 'unc') {
            out += `<span class="read-mk read-mk-unc${cls}"${attrs}>${esc(tk.word)}<sup aria-hidden="true">?</sup><span class="read-sr"> (${esc(t.uncertain)})</span></span>`;
        } else {
            out += `<span class="read-mk read-mk-ill${cls}"${attrs} aria-label="${esc(t.illegibleSr)}">${esc(t.illegible)}</span>`;
        }
    }
    return out;
}

/** One line of the shown text with its marks: a change (dashed frame) around, a disagreement (tinted, underlined) inside. */
export function lineMarksHtml(line: string, j: number, places: readonly ShownPlace[], focus: string): string {
    const toks = lineTokens(line);
    const on = places.filter(p => p.line === j && p.span && !p.elsewhere);
    const chg = on.filter(p => p.kind === 'chg').sort((x, y) => x.span![0] - y.span![0]);
    // An uncertain change is drawn as the readers' disagreement: the disagreement it covers is not drawn again.
    const asDis = new Set(chg.filter(p => p.cat === 'unsure').map(p => p.id));
    const dis = on.filter(p => p.kind === 'dis' && !(p.under && asDis.has(p.under))).sort((x, y) => x.span![0] - y.span![0]);
    const ids = new Map(on.filter(p => (p.kind === 'unc' || p.kind === 'ill') && !p.inside).map(p => [p.span![0], p.id] as const));
    const inner = (a: number, b: number): string => {
        let out = '';
        let pos = a;
        for (const d of dis) {
            const s = Math.max(d.span![0], a), e = Math.min(d.span![1], b);
            if (e <= s || s < pos) continue;
            out += piecesHtml(line, toks, pos, s, ids, focus);
            out += `<span class="read-mk read-mk-dis${d.id === focus ? ' is-focus' : ''}"${PLACE_ATTRS(d.id, focus)}>${piecesHtml(line, toks, s, e, null, focus)}</span>`;
            pos = e;
        }
        return out + piecesHtml(line, toks, pos, b, ids, focus);
    };
    let out = '';
    let pos = 0;
    for (const c of chg) {
        const [s, e] = c.span!;
        if (s < pos) continue;
        out += inner(pos, s);
        const cls = c.cat === 'unsure' ? 'read-mk-dis read-mk-unsure' : c.cat === 'judged' ? 'read-mk-jud' : c.cat === 'minor' ? 'read-mk-min' : 'read-mk-chg';
        const ok = c.cat === 'judged' && c.v?.judged
            ? `<sup aria-hidden="true">✓</sup><span class="read-sr"> (${esc(judgedText(c.v.judged))})</span>` : '';
        out += `<span class="read-mk ${cls}${c.id === focus ? ' is-focus' : ''}"${PLACE_ATTRS(c.id, focus)}>${inner(s, e)}${ok}</span>`;
        pos = e;
    }
    return out + inner(pos, line.length);
}

/** One side of a place in a list or the bubble: its marks drawn small, an empty side in words. */
function sideHtml(text: string, none: string): string {
    if (!text.trim()) return `<span class="read-place-missing">${esc(none)}</span>`;
    const toks = lineTokens(text.replace(/(\S)\s+\[\?\]/g, '$1[?]'));
    return piecesHtml(text.replace(/(\S)\s+\[\?\]/g, '$1[?]'), toks, 0, Infinity, null, '');
}

/** A reader's circled number (only readers have circles; entries are said in words). */
function readerMark(n: 1 | 2): string {
    return `<span class="read-rd" aria-hidden="true">${n}</span><span class="read-sr"> (${esc(strings.read.readerN(n))})</span>`;
}

/**
 * A change drawn as in "To check": the old words struck through, an arrow, the new words in the change's mark;
 * `before`/`after`: the line's words around it (the proposal's rows).
 */
export function changeWhatHtml(at: string, other: string, mk = 'read-mk-chg', before = '', after = ''): string {
    const t = strings.read;
    return `${before ? `<span class="read-check-ctx">${esc(before)}</span> ` : ''}<s class="read-check-old">${sideHtml(at, t.oldNone)}</s>`
        + `<span class="read-check-arrow" aria-hidden="true"> → </span><span class="read-mk ${mk}">${sideHtml(other, t.newNone)}</span>`
        + `${after ? ` <span class="read-check-ctx">${esc(after)}</span>` : ''}`;
}

export function kindText(cls: VariantClass | null): string {
    const vk = strings.read.vk;
    return cls?.kinds.length ? [...new Set(cls.kinds.map(k => vk[k] ?? k))].join(', ') : '';
}

/** A place's row in "To check": the line, what was read, its kind. */
function checkRowHtml(p: ShownPlace, shown: 1 | 2, focus: string, more: boolean): string {
    const t = strings.read;
    let what = '';
    let kind = '';
    if (p.kind === 'chg' && p.v && p.cat === 'unsure') {
        // The transcript · reader 1 · reader 2 (the shown reader bold).
        const side = (n: 1 | 2, text: string): string =>
            `<span class="read-check-side${shown === n ? ' is-shown' : ''}">${sideHtml(text, t.placeMissing)}</span> ${readerMark(n)}`;
        what = `<span class="read-check-was">${sideHtml(p.v.at, t.oldNone)}</span><span class="read-check-dot" aria-hidden="true"> · </span>${side(1, p.v.other)}`
            + (p.r2 !== undefined ? `<span class="read-check-dot" aria-hidden="true"> · </span>${side(2, p.r2)}` : '');
        kind = kindText(p.cls);
    } else if (p.kind === 'chg' && p.v) {
        const mk = p.cat === 'judged' ? 'read-mk-jud' : p.cat === 'minor' ? 'read-mk-min' : 'read-mk-chg';
        what = changeWhatHtml(p.v.at, p.v.other, mk);
        kind = kindText(p.cls);
    } else if (p.kind === 'dis' && p.v) {
        const side = (n: 1 | 2, text: string): string =>
            `<span class="read-check-side${shown === n ? ' is-shown' : ''}">${sideHtml(text, t.placeMissing)}</span> ${readerMark(n)}`;
        what = `${p.label ? `<span class="read-place-label">${esc(p.label)}:</span> ` : ''}${side(1, p.v.at)}<span class="read-check-dot" aria-hidden="true"> · </span>${side(2, p.v.other)}`;
        kind = kindText(p.cls);
    } else if (p.kind === 'unc') {
        what = `<span class="read-mk read-mk-unc">${esc(p.word)}<sup aria-hidden="true">?</sup></span>`;
        kind = t.kUnc;
    } else {
        what = `<span class="read-mk read-mk-ill">${esc(t.illegible)}</span>`;
        kind = t.kIll;
    }
    const ln = p.line >= 0 ? `${t.ln} ${p.line + 1}` : '';
    return `<li${more ? ' data-more hidden' : ''}><button type="button" class="read-check-row${p.cat === 'judged' ? ' is-judged' : ''}${p.id === focus ? ' is-focus' : ''}" data-act="place" data-place="${esc(p.id)}">`
        + `<span class="read-check-ln">${esc(ln)}</span><span class="read-check-what">${what}</span>`
        + `<span class="read-check-kind">${esc(kind)}</span></button></li>`;
}

/** Substantive rows shown before "and N more". */
const CHECK_SHOWN = 8;

export interface CheckOptions {
    isSource: boolean;
    /** Reader 2's text shows (the changes are reader 1's: said in the group's head). */
    shown: 1 | 2;
    /** The research named the changes' kinds ("2 substantive changes"); else "2 changes". */
    kinded: boolean;
    focus: string;
    /** A source read again, sorted (`read.sourceTask`): the sentence under the sure changes ('' none), a person reviews them. */
    sorted?: { note: string; person: boolean; taskLink: boolean };
    /** One reader read (`readOneReader`): its uncertain places are where it was not sure. */
    oneReader?: boolean;
}

/** Rows shown up to `CHECK_SHOWN`, then "and N more". */
function rowsHtml(rows: readonly ShownPlace[], o: CheckOptions): string {
    const t = strings.read;
    const list = rows.map((p, i) => checkRowHtml(p, o.shown, o.focus, i >= CHECK_SHOWN)).join('');
    const more = rows.length > CHECK_SHOWN
        ? `<li class="read-check-more"><button type="button" class="link-button read-places-more" data-act="places-more">${esc(t.placesMore(rows.length - CHECK_SHOWN))}</button></li>` : '';
    return rows.length ? `<ul class="read-check-rows">${list}${more}</ul>` : '';
}

/**
 * "To check" sorted (spec 059, `read.sourceTask`): sure substantive changes (only they go into a task), uncertain
 * places, places assessed in an earlier task (folded, one group per task, a link to the task), minor details
 * (folded); then uncertain words and illegible spots as before.
 */
function sortedCheckHtml(places: readonly ShownPlace[], o: CheckOptions & { sorted: { note: string; person: boolean; taskLink: boolean } }): string {
    const t = strings.read;
    const g = sortedGroups(places);
    const sample = (cls: string, sup = ''): string => `<span class="read-mk ${cls}" aria-hidden="true">Abc${sup ? `<sup>${sup}</sup>` : ''}</span>`;
    const head = (smp: string, name: string, n: number, extra = ''): string =>
        `${smp}<span class="read-check-name">${esc(name)}</span><span class="read-check-count">(${n})</span>${extra}`;
    const from = o.shown === 2 ? ` <span class="read-check-from">${esc(t.fromR1)}</span>` : '';
    const note = (text: string): string => text ? `<p class="read-check-note">${esc(text)}</p>` : '';
    const open = (rows: readonly ShownPlace[]): string => rows.some(p => p.id === o.focus) ? ' open' : '';
    const out: string[] = [];
    if (g.major.length) out.push(`
                <div class="read-check-group" data-group="major">
                    <div class="read-check-head">${head(sample('read-mk-chg'), o.sorted.person ? t.gMajorPerson : t.gMajor, g.major.length, from)}</div>
                    ${note(o.sorted.note)}${rowsHtml(g.major, o)}
                </div>`);
    if (g.unsure.length) out.push(`
                <div class="read-check-group" data-group="unsure">
                    <div class="read-check-head">${head(sample('read-mk-dis'), o.oneReader ? t.gUnsure1 : t.gUnsure, g.unsure.length)}</div>
                    ${note(t.cUnsNote)}${rowsHtml(g.unsure, o)}
                </div>`);
    for (const j of g.judged) {
        // A reading a person kept (D…): no task to open.
        const kept = readJudgedKept(j.task);
        out.push(`
                <div class="read-check-group is-fold" data-group="${kept ? 'kept' : 'judged'}"${kept ? '' : ` data-task="${esc(j.task)}"`}>
                    <details class="read-check-fold"${open(j.rows)}>
                        <summary class="read-check-head">${head(sample('read-mk-jud', '✓'), kept ? t.gKept : t.gJudged(j.task), j.rows.length)}</summary>
                        ${note(t.cJudNote)}<ul class="read-check-rows">${j.rows.map(p => checkRowHtml(p, o.shown, o.focus, false)).join('')}</ul>
                    </details>
                    ${o.sorted.taskLink && !kept ? `<button type="button" class="read-link read-check-task" data-act="open-task" data-task="${esc(j.task)}">${researchActionLabel(t.tTaskLink(j.task), researchLinkMark('task'))}</button>` : ''}
                </div>`);
    }
    if (g.minor.length) out.push(`
                <div class="read-check-group is-fold" data-group="minor">
                    <details class="read-check-fold"${open(g.minor)}>
                        <summary class="read-check-head">${head(sample('read-mk-min'), t.gMinor, g.minor.length)}</summary>
                        <ul class="read-check-rows">${g.minor.map(p => checkRowHtml(p, o.shown, o.focus, false)).join('')}</ul>
                    </details>
                </div>`);
    return out.join('') + kindGroupsHtml(places, ['unc', 'ill'], o);
}

/**
 * "To check" (spec 059 P7 §4): groups in a fixed order (a source: changes, disagreements, uncertain, illegible;
 * a document: disagreements, uncertain, illegible), each with a sample of its mark, its name and count; minor
 * details folded under "and N minor details (kinds)". '' with no place.
 */
export function checkHtml(places: readonly ShownPlace[], o: CheckOptions): string {
    if (o.sorted && o.isSource) return sortedCheckHtml(places, { ...o, sorted: o.sorted });
    return kindGroupsHtml(places, o.isSource ? ['chg', 'dis', 'unc', 'ill'] : ['dis', 'unc', 'ill'], o);
}

/** The groups of the kinds in `order` (as before the sorted view). */
function kindGroupsHtml(places: readonly ShownPlace[], order: readonly PlaceKind[], o: CheckOptions): string {
    const t = strings.read;
    const groups = order.map(kind => {
        const rows = places.filter(p => p.kind === kind && !p.inside);
        if (!rows.length) return '';
        const major = rows.filter(p => !p.cls?.minor);
        const minor = rows.filter(p => p.cls?.minor);
        const name = kind === 'chg' ? t.gChg : kind === 'dis' ? t.gDis : kind === 'unc' ? t.gUnc : t.gIll;
        const count = kind === 'chg' ? (major.length ? t.nChg(major.length, o.kinded) : '')
            : kind === 'dis' ? t.nPlaces(major.length || rows.length) : t.nWords(rows.length);
        const sample = kind === 'ill'
            ? `<span class="read-mk read-mk-ill" aria-hidden="true">${esc(t.illegible)}</span>`
            : `<span class="read-mk read-mk-${kind}" aria-hidden="true">Abc${kind === 'unc' ? '<sup>?</sup>' : ''}</span>`;
        const from = kind === 'chg' && o.shown === 2 ? ` <span class="read-check-from">${esc(t.fromR1)}</span>` : '';
        const majorRows = major.map((p, i) => checkRowHtml(p, o.shown, o.focus, i >= CHECK_SHOWN)).join('');
        const moreBtn = major.length > CHECK_SHOWN
            ? `<li class="read-check-more"><button type="button" class="link-button read-places-more" data-act="places-more">${esc(t.placesMore(major.length - CHECK_SHOWN))}</button></li>` : '';
        const kinds = [...new Set(minor.flatMap(p => p.cls?.kinds ?? []).map(k => t.vk[k] ?? k))].join(', ');
        const minors = minor.length ? `
                    <details class="read-check-minors"${minor.some(p => p.id === o.focus) ? ' open' : ''}>
                        <summary>${esc((major.length ? t.minors : t.minorsOnly)(minor.length, kinds))}</summary>
                        <ul class="read-check-rows">${minor.map(p => checkRowHtml(p, o.shown, o.focus, false)).join('')}</ul>
                    </details>` : '';
        return `
                <div class="read-check-group" data-group="${kind}">
                    <div class="read-check-head">${sample}<span class="read-check-name">${esc(name)}</span>${count ? `<span class="read-check-count">· ${esc(count)}</span>` : ''}${from}</div>
                    ${majorRows || moreBtn ? `<ul class="read-check-rows">${majorRows}${moreBtn}</ul>` : ''}${minors}
                </div>`;
    }).join('');
    return groups;
}

/**
 * The bubble of a place (spec 059 P7 §5): each reader's reading (the shown one bold), the existing transcript for a
 * change, under a line its kind; an uncertain word and an illegible spot in one sentence. `phone`: a bottom sheet
 * with "Show on the scan".
 */
export function placePopHtml(places: readonly ShownPlace[], shown: 1 | 2, phone: boolean): string {
    const t = strings.read;
    const dis = places.find(p => p.kind === 'dis' && p.v);
    const chg = places.find(p => p.kind === 'chg' && p.v);
    const rows: string[] = [];
    const notes: string[] = [];
    const row = (sym: string, label: string, value: string, bold: boolean): string =>
        `<div class="read-pop-row${bold ? ' is-shown' : ''}"><span class="read-pop-sym">${sym}</span><span class="read-pop-label">${esc(label)}</span><span class="read-pop-val">${value}</span></div>`;
    if (dis?.v) {
        rows.push(row(readerMark(1), t.readerN(1), sideHtml(dis.v.at, t.placeMissing), shown === 1));
        rows.push(row(readerMark(2), t.readerN(2), sideHtml(dis.v.other, t.placeMissing), shown === 2));
    } else if (chg?.v && chg.cat === 'unsure' && chg.r2 !== undefined) {
        rows.push(row(readerMark(1), t.readerN(1), sideHtml(chg.v.other, t.newNone), shown === 1));
        rows.push(row(readerMark(2), t.readerN(2), sideHtml(chg.r2, t.placeMissing), shown === 2));
    } else if (chg?.v) {
        rows.push(row(readerMark(1), t.readerN(1), sideHtml(chg.v.other, t.newNone), true));
    }
    if (chg?.v) rows.push(row('<span class="read-pop-old" aria-hidden="true"></span>', t.bOld, sideHtml(chg.v.at, t.oldNone), false));
    const disKind = dis?.cls?.kinds.length ? kindText(dis.cls) : '';
    if (disKind) notes.push(disKind);
    if (chg?.cls) {
        const k = kindText(chg.cls);
        const sorted = chg.cat === 'unsure' ? t.bUnsure : chg.cat === 'judged' && chg.v?.judged ? judgedText(chg.v.judged) : '';
        const weight = sorted || (chg.cls.kinds.length ? chg.cls.minor ? t.minor : t.major : '');
        const line = [k && k !== disKind ? k : '', weight].filter(Boolean).join(' · ');
        if (line) notes.push(line);
    }
    const unc = places.find(p => p.kind === 'unc');
    const ill = places.find(p => p.kind === 'ill');
    if (!rows.length && unc) notes.push(t.bUnc(shown));
    if (!rows.length && ill) notes.push(t.bIll);
    const scan = phone ? `<button type="button" class="secondary read-pop-scan" data-act="pop-scan">${esc(t.showOnScan)}</button>` : '';
    return `${rows.length ? `<div class="read-pop-rows">${rows.join('')}</div>` : ''}`
        + `${notes.length ? `<p class="read-pop-note${rows.length ? ' has-rows' : ''}">${notes.map(esc).join('<br>')}</p>` : ''}${scan}`;
}
