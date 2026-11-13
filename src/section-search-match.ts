/**
 * The search of a section of the Research overview (spec 083 §3): what is
 * typed is matched here against an index built once per item, never sent
 * anywhere. Every word of the query must match (AND, any order); a person's,
 * a task's or a hypothesis's number matches by its value (P47 = P0047), a
 * bare number is a task, else a hypothesis, else plain text (a year); a word
 * of five letters or more forgives its last letter ("bialy" finds "Białe").
 */

import { foldSearch } from './history-manage.js';

/** Letters NFD does not take apart, spelled the way they are typed on a plain keyboard. */
const SPELLED: Record<string, string> = {
    'ß': 'ss', 'ẞ': 'ss', 'ł': 'l', 'Ł': 'l', 'đ': 'd', 'Đ': 'd',
    'ø': 'o', 'Ø': 'o', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe',
};

/** Lower case without diacritics, ß ł đ ø æ œ spelled out ("Großhof" → "grosshof", "Białe" → "biale"). */
export function foldSearch2(s: string): string {
    return foldSearch(s.replace(/[ßẞłŁđĐøØæÆœŒ]/g, c => SPELLED[c] ?? c));
}

/** One word of a query: a person's (p), task's (t) or hypothesis's (h) number, a bare number (n) or text (s). */
export interface SearchToken {
    k: 'p' | 't' | 'h' | 'n' | 's';
    /** The number of p / t / h / n. */
    n?: number;
    /** The word folded. */
    t: string;
}

/** What an item is searched by: its text folded, and its numbers. */
export interface SearchDoc {
    /** Everything searchable as text, folded with `foldSearch2`. */
    hay: string;
    /** The person's number (P0047 → 47). */
    pn?: number;
    /** The task's number (T0815 → 815). */
    tn?: number;
    /** The hypothesis's number (H0022 → 22). */
    hn?: number;
}

/** What matched by its number (the amber tag of the row); `{}`: matched as text only. */
export interface SearchHit {
    p?: 1;
    t?: 1;
    h?: 1;
}

/** The words of a query (split at spaces, commas and semicolons), folded. */
export function tokenize(q: string): SearchToken[] {
    const out: SearchToken[] = [];
    for (const t of foldSearch2(q).split(/[\s,;]+/)) {
        if (!t) continue;
        const num = /^([pth])0*(\d+)$/.exec(t);
        if (num) out.push({ k: num[1] as 'p' | 't' | 'h', n: Number(num[2]), t });
        else if (/^\d+$/.test(t)) out.push({ k: 'n', n: Number(t), t });
        else out.push({ k: 's', t });
    }
    return out;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** A word of `hay` starts with `stem` (the character before it is no letter or digit). */
function wordStarts(hay: string, stem: string): boolean {
    for (let i = hay.indexOf(stem); i >= 0; i = hay.indexOf(stem, i + 1)) {
        if (i === 0 || !WORD_CHAR.test(hay[i - 1])) return true;
    }
    return false;
}

/** The text matches a word: in it anywhere, or (five letters or more) a word starts with it short of its last letter. */
function textMatches(hay: string, t: string): boolean {
    return hay.includes(t) || (t.length >= 5 && wordStarts(hay, t.slice(0, -1)));
}

/**
 * The item matches every word of the query: what matched by its number, or
 * null when a word does not match. No words: everything matches.
 */
export function matchDoc(d: SearchDoc, toks: readonly SearchToken[]): SearchHit | null {
    const hit: SearchHit = {};
    for (const tok of toks) {
        switch (tok.k) {
            case 'p':
                if (d.pn !== tok.n) return null;
                hit.p = 1;
                break;
            case 't':
                if (d.tn !== tok.n) return null;
                hit.t = 1;
                break;
            case 'h':
                if (d.hn !== tok.n) return null;
                hit.h = 1;
                break;
            case 'n':
                if (d.tn === tok.n) hit.t = 1;
                else if (d.hn === tok.n) hit.h = 1;
                else if (!d.hay.includes(tok.t)) return null;
                break;
            default:
                if (!textMatches(d.hay, tok.t)) return null;
        }
    }
    return hit;
}

/** The number of an id like "P0047" / "T0815" / "H0022" (undefined: none). */
export function idNumber(id: string | null | undefined): number | undefined {
    const m = id ? /^[A-Za-z]+0*(\d+)$/.exec(id.trim()) : null;
    return m ? Number(m[1]) : undefined;
}

/** A section's search field is shown: ten items or more, or a text typed (it stays while the text does). */
export function fieldVisible(total: number, text: string): boolean {
    return total >= 10 || text !== '';
}
