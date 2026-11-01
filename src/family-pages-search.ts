/**
 * The family pages' search (spec 026 §3.4): over the set's search index
 * (§0.7, only the people of the file), the query normalized as the index's
 * keys are (normalizeSearchText: lower case, no diacritics, the folded
 * letters ł ß ø …), every token the start of some word of the keys. Matches
 * in the shown name itself first (the exact surname: "fischek" finds Martin
 * Fischek before the Fíšeks it finds through the line's forms), then by
 * surname and given name in the file's language. Ten shown, the rest counted.
 *
 * The same search twice: `searchPageSetIndex` here for the app's window and
 * PAGE_SET_SEARCH_JS for the saved file's script (no modules there). A test
 * holds the two together on a sample of names.
 */

import { SearchEntry } from './family-pages.js';
import { normalizeSearchText } from './name-search.js';
import { Language, pluralCategory } from './strings.js';

/** Results shown; the rest are "N more in the index". */
export const PAGE_SET_SEARCH_MAX = 10;

export interface PageSetSearchResult {
    hits: SearchEntry[];
    /** All matches (hits.length is at most the maximum). */
    total: number;
}

/** The query's tokens, normalized as the index's keys. */
export function searchTokens(query: string): string[] {
    return normalizeSearchText(query).split(' ').filter(Boolean);
}

function matches(tokens: readonly string[], words: readonly string[]): boolean {
    return tokens.every(t => words.some(w => w.startsWith(t)));
}

/** The search of the set's index (§3.4); an empty query finds nothing. */
export function searchPageSetIndex(index: readonly SearchEntry[], query: string, lang: Language, max = PAGE_SET_SEARCH_MAX): PageSetSearchResult {
    const tokens = searchTokens(query);
    if (!tokens.length) return { hits: [], total: 0 };
    const found: { e: SearchEntry; direct: boolean }[] = [];
    for (const e of index) {
        if (!matches(tokens, e.k.split(' '))) continue;
        found.push({ e, direct: matches(tokens, normalizeSearchText(e.n).split(' ')) });
    }
    found.sort((a, b) => Number(b.direct) - Number(a.direct) || a.e.o.localeCompare(b.e.o, lang) || a.e.y.localeCompare(b.e.y));
    return { hits: found.slice(0, max).map(f => f.e), total: found.length };
}

/**
 * The same in the file's script: `spNorm(text)` and `spSearch(index, query,
 * lang, max)` → `{hits, total}`. Plain ES5 + the Unicode property escapes
 * that normalizeName uses.
 */
export const PAGE_SET_SEARCH_JS = `var SP_FOLD={'ł':'l','ß':'ss','ø':'o','æ':'ae','œ':'oe','đ':'d','ð':'d','þ':'th','ħ':'h','ı':'i','ŀ':'l','ŧ':'t','ĸ':'k','ŋ':'n'};
function spNorm(t){return String(t).toLowerCase().normalize('NFD').replace(/\\p{M}/gu,'').replace(/[łßøæœđðþħıŀŧĸŋ]/g,function(c){return SP_FOLD[c]||c}).replace(/[^\\p{L}\\p{N}\\s]/gu,'').trim().replace(/\\s+/g,' ')}
function spToks(q){return spNorm(q).split(' ').filter(Boolean)}
function spMatch(ts,ws){return ts.every(function(t){return ws.some(function(w){return w.indexOf(t)===0})})}
function spSearch(ix,q,lang,max){var ts=spToks(q);if(!ts.length)return{hits:[],total:0};var f=[];
ix.forEach(function(e){if(!spMatch(ts,e.k.split(' ')))return;f.push({e:e,d:spMatch(ts,spNorm(e.n).split(' '))})});
f.sort(function(a,b){return (b.d-a.d)||a.e.o.localeCompare(b.e.o,lang)||a.e.y.localeCompare(b.e.y)});
return{hits:f.slice(0,max).map(function(x){return x.e}),total:f.length}}`;

/**
 * A count's text for the script: the template per plural category of the
 * language ("{n}" for the number), from the strings' own function — the
 * script picks with Intl.PluralRules and falls back to "other".
 */
export function pluralTemplates(lang: Language, text: (n: number) => string): Record<string, string> {
    const out: Record<string, string> = {};
    for (let n = 0; n <= 200; n++) {
        const cat = pluralCategory(lang, n);
        if (out[cat] !== undefined) continue;
        const s = text(n);
        const at = s.indexOf(String(n));
        out[cat] = at < 0 ? s : s.slice(0, at) + '{n}' + s.slice(at + String(n).length);
    }
    return out;
}
