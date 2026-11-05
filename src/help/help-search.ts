/**
 * Search in "How Strom works": an index of the chapters, rules and terms of
 * one help language, built the first time the help window opens in it, and
 * the matching behind the window's search field.
 *
 * Text is compared without diacritics and letter case (NFD, combining marks
 * dropped; Polish ł as l), so "misto" finds "Místo". A query that looks like
 * a number (R4.3, a2, S1.4.2) is a number: the window offers to go there.
 * Results: up to 3 terms of the index (a match in the term first, then in its
 * definition), then up to 20 rules (a match in the title first, then in the
 * text, each group in the order of the documentation) with a snippet around
 * the first match in the text.
 */

import type { HelpBlock, HelpChapter, HelpInline, HelpLangData, HelpList, HelpTerm } from './help-types.js';

/** A piece of text for display: `m` marks the part that matched the query. */
export interface HelpSeg {
    t: string;
    m?: boolean;
}

/** Text without diacritics and letter case, with each character's place in the original. */
interface Folded {
    text: string;
    /** For every character of `text`, the index of the original character it came from. */
    map: number[];
}

/** One searchable rule (or a chapter's own introduction). */
export interface HelpIndexedRule {
    id: string;
    title: string;
    /** The paragraphs, lists and tables up to the next heading, as plain text. */
    text: string;
    chapter: HelpChapter;
    /** Heading level (2, 3); 1 = the chapter itself. */
    level: number;
    foldedTitle: string;
    foldedText: Folded;
}

export interface HelpIndexedTerm {
    term: HelpTerm;
    /** The term as the window shows it (code keys of the interface left out). */
    label: string;
    foldedLabel: string;
    foldedDef: string;
}

export interface HelpSearchIndex {
    rules: HelpIndexedRule[];
    terms: HelpIndexedTerm[];
    /** Chapter and rule numbers (lower case) → their entry. */
    byId: Map<string, HelpIndexedRule>;
}

export interface HelpRuleHit {
    rule: HelpIndexedRule;
    titleSegs: HelpSeg[];
    /** Around the first match in the text (null: the match is in the title only). */
    snippet: HelpSeg[] | null;
}

export interface HelpTermHit {
    term: HelpIndexedTerm;
    labelSegs: HelpSeg[];
}

export interface HelpSearchResult {
    /** The query folded and trimmed. */
    folded: string;
    /** The query is a number (R4.3, a2 …), whether it exists or not. */
    isNumber: boolean;
    /** The number's chapter or rule, when the help has it. */
    number: HelpIndexedRule | null;
    terms: HelpTermHit[];
    rules: HelpRuleHit[];
}

export const HELP_TERM_LIMIT = 3;
export const HELP_RULE_LIMIT = 20;
/** Characters of a snippet before the match and after it. */
const SNIP_BEFORE = 48;
const SNIP_AFTER = 80;

const NUMBER_RE = /^[ars]\d+(\.\d+)*$/;

function foldChar(ch: string): string {
    if (ch === 'ł') return 'l';
    if (ch === 'Ł') return 'l';
    return ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Text without diacritics and letter case (for comparing). */
export function foldHelpText(text: string): string {
    return fold(text).text;
}

function fold(text: string): Folded {
    let out = '';
    const map: number[] = [];
    let i = 0;
    for (const ch of text) {
        const f = foldChar(ch);
        for (let k = 0; k < f.length; k++) map.push(i);
        out += f;
        i += ch.length;
    }
    return { text: out, map };
}

/** Whether a query is a rule or chapter number (R4.3, a2, S1.4.2), any letter case. */
export function isHelpNumber(query: string): boolean {
    return NUMBER_RE.test(foldHelpText(query.trim()));
}

/** Plain text of inline content. */
export function helpInlineText(c: HelpInline[]): string {
    return c.map(x => typeof x === 'string' ? x
        : 'b' in x ? x.b : 'i' in x ? x.i : 'code' in x ? x.code : x.t).join('');
}

function listText(list: HelpList): string[] {
    const out: string[] = [];
    list.items.forEach((item, n) => {
        out.push(helpInlineText(item));
        const sub = list.sub?.[n];
        if (sub) out.push(...listText(sub));
    });
    return out;
}

function blockText(block: HelpBlock): string[] {
    switch (block.k) {
        case 'p': return [helpInlineText(block.c)];
        case 'ul':
        case 'ol': return listText(block);
        case 'table': return block.rows.map(row => row.map(cell => helpInlineText(cell)).join(' · '));
        case 'quote': return block.blocks.flatMap(blockText);
        default: return [];
    }
}

/**
 * The term as the window shows it: the register writes after some terms the
 * keys of the interface they come from ("(terminal, run.minutes)",
 * "(`ui.wait.sent.title`, app `waitingPhaseSent`)"); those brackets are for
 * the documentation's authors and are left out. Brackets with words only
 * ("(app)", "(GEDCOM)") stay.
 */
export function helpTermLabel(term: string): string {
    const cleaned = term.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) =>
        /[a-z]\.[a-z]|[a-z][A-Z]|`/.test(inner) ? '' : whole);
    return cleaned.trim() || term;
}

/** Build the index of one language (the chapters in the order of the documentation). */
export function buildHelpIndex(data: HelpLangData): HelpSearchIndex {
    const rules: HelpIndexedRule[] = [];
    const byId = new Map<string, HelpIndexedRule>();
    const add = (entry: Omit<HelpIndexedRule, 'foldedTitle' | 'foldedText'>): HelpIndexedRule => {
        const text = entry.text.replace(/\s+/g, ' ').trim();
        const full: HelpIndexedRule = { ...entry, text, foldedTitle: foldHelpText(entry.title), foldedText: fold(text) };
        rules.push(full);
        byId.set(full.id.toLowerCase(), full);
        return full;
    };
    for (const chapter of data.chapters) {
        const chapterEntry = add({ id: chapter.id, title: chapter.title, text: chapter.intro, chapter, level: 1 });
        let current = chapterEntry;
        let parts: string[] = [chapter.intro];
        const flush = (): void => {
            const text = parts.join(' ').replace(/\s+/g, ' ').trim();
            current.text = text;
            current.foldedText = fold(text);
        };
        const visit = (blocks: HelpBlock[]): void => {
            for (const block of blocks) {
                if (block.k === 'h') {
                    flush();
                    current = add({ id: block.id, title: block.title, text: '', chapter, level: block.level });
                    parts = [];
                } else if (block.k === 'quote' && block.blocks.some(b => b.k === 'h')) {
                    visit(block.blocks);
                } else {
                    parts.push(...blockText(block));
                }
            }
        };
        visit(chapter.blocks);
        flush();
    }
    const terms = data.terms.map(term => {
        const label = helpTermLabel(term.term);
        return { term, label, foldedLabel: foldHelpText(label), foldedDef: foldHelpText(term.def) };
    });
    return { rules, terms, byId };
}

/** The text cut into pieces, every match of the folded query marked. */
export function helpHighlight(text: string, folded: string): HelpSeg[] {
    if (!folded) return [{ t: text }];
    const f = fold(text);
    return segsOf(text, f, folded, 0, text.length);
}

function segsOf(text: string, f: Folded, q: string, from: number, to: number): HelpSeg[] {
    const out: HelpSeg[] = [];
    let i = from;
    let pos = 0;
    while ((pos = f.text.indexOf(q, pos)) >= 0) {
        const start = f.map[pos];
        const endFold = pos + q.length;
        const end = endFold < f.map.length ? f.map[endFold] : text.length;
        pos = endFold;
        if (start < from || end > to) continue;
        if (start > i) out.push({ t: text.slice(i, start) });
        out.push({ t: text.slice(start, end), m: true });
        i = end;
    }
    if (i < to) out.push({ t: text.slice(i, to) });
    return out;
}

/**
 * A snippet of a rule's text around the first match: about 48 characters
 * before and 80 after it, cut at a space, "…" where the text goes on.
 */
export function helpSnippet(text: string, folded: string): HelpSeg[] | null {
    return snippetOf(text, fold(text), folded);
}

function snippetOf(text: string, f: Folded, q: string): HelpSeg[] | null {
    if (!q) return null;
    const pos = f.text.indexOf(q);
    if (pos < 0) return null;
    const start = f.map[pos];
    const end = pos + q.length < f.map.length ? f.map[pos + q.length] : text.length;
    let a = Math.max(0, start - SNIP_BEFORE);
    if (a > 0) {
        const sp = text.indexOf(' ', a);
        a = sp >= 0 && sp < start ? sp + 1 : a;
    }
    let b = Math.min(text.length, end + SNIP_AFTER);
    if (b < text.length) {
        const sp = text.lastIndexOf(' ', b);
        b = sp > end ? sp : b;
    }
    const segs = segsOf(text, f, q, a, b);
    if (a > 0) segs.unshift({ t: '…' });
    if (b < text.length) segs.push({ t: '…' });
    return segs;
}

/**
 * Search the index. Shorter than 2 characters (after trimming): nothing.
 */
export function searchHelp(index: HelpSearchIndex, query: string): HelpSearchResult {
    const folded = foldHelpText(query).trim().replace(/\s+/g, ' ');
    const empty: HelpSearchResult = { folded, isNumber: false, number: null, terms: [], rules: [] };
    if (folded.length < 2) return empty;
    const isNumber = NUMBER_RE.test(folded);
    const number = isNumber ? index.byId.get(folded) ?? null : null;

    const termsInLabel: HelpIndexedTerm[] = [];
    const termsInDef: HelpIndexedTerm[] = [];
    if (!isNumber) {
        for (const t of index.terms) {
            if (t.foldedLabel.includes(folded)) termsInLabel.push(t);
            else if (t.foldedDef.includes(folded)) termsInDef.push(t);
        }
    }
    const terms = [...termsInLabel, ...termsInDef].slice(0, HELP_TERM_LIMIT)
        .map(term => ({ term, labelSegs: helpHighlight(term.label, folded) }));

    const inTitle: HelpIndexedRule[] = [];
    const inText: HelpIndexedRule[] = [];
    for (const r of index.rules) {
        if (isNumber) {
            const id = r.id.toLowerCase();
            if (id === folded || id.startsWith(folded + '.')) inTitle.push(r);
        } else if (r.foldedTitle.includes(folded)) inTitle.push(r);
        else if (r.foldedText.text.includes(folded)) inText.push(r);
    }
    const rules = [...inTitle, ...inText].slice(0, HELP_RULE_LIMIT).map(rule => ({
        rule,
        titleSegs: isNumber ? [{ t: rule.title }] : helpHighlight(rule.title, folded),
        snippet: isNumber ? null : snippetOf(rule.text, rule.foldedText, folded),
    }));
    return { folded, isNumber, number, terms, rules };
}
