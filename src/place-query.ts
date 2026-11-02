/**
 * Asking the map for a place in more ways than one (spec 034 §6): the
 * registers write "H. Lhota", "Ob. Lhota", "u Č. Lípy" or an old German name,
 * and the geocoder knows the place under today's full name. A query is
 * written out into a few forms the geocoder is asked in turn: the original,
 * the abbreviations spelled out, the place's other names (the research's
 * place record, the history of places) and the text without diacritics.
 *
 * Pure and offline; only the names ever leave the device, as today.
 */

import type { StromData } from './types.js';
import type { Language } from './strings.js';
import { placeKey } from './places.js';

/** At most this many queries for one search. */
export const MAX_PLACE_QUERIES = 4;

/**
 * Abbreviations of place names in the registers, by language of the place
 * names: the word before a name ("H. Lhota") → the words it stands for, the
 * usual one first. Applied for every UI language (a Czech place is written
 * the Czech way whatever the app speaks); the UI language only puts its own
 * alternatives first where both know the abbreviation ("St.").
 */
export const PLACE_ABBREVIATIONS: Readonly<Record<'cs' | 'de', Readonly<Record<string, readonly string[]>>>> = {
    cs: {
        'H.': ['Horní', 'Hořejší'],
        'D.': ['Dolní'],
        'M.': ['Malá'],
        'V.': ['Velká'],
        'N.': ['Nová'],
        'St.': ['Stará'],
    },
    de: {
        'Ob.': ['Ober'],
        'Nd.': ['Nieder'],
        'Gr.': ['Groß'],
        'Kl.': ['Klein'],
        'St.': ['Sankt'],
    },
};

/** Whole phrases written short ("u Č. Lípy" → "u České Lípy"). */
export const PLACE_PHRASES: readonly { from: RegExp; to: string }[] = [
    { from: /(^|\s)u\s+Č\.\s*Lípy(?=$|[\s,])/u, to: '$1u České Lípy' },
    { from: /(^|\s)u\s+Č\.\s*Budějovic(?=$|[\s,])/u, to: '$1u Českých Budějovic' },
    { from: /(^|\s)u\s+Č\.\s*Krumlova(?=$|[\s,])/u, to: '$1u Českého Krumlova' },
];

/** The text without diacritics on Latin letters ("Łotów" → "Lotow"); other scripts stay as they are. */
export function withoutDiacritics(text: string): string {
    return text
        .normalize('NFD')
        .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
        .replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .replace(/ß/g, 'ss')
        .normalize('NFC');
}

/** The alternatives of one abbreviation, the UI language's own first. */
function alternatives(abbr: string, lang: Language): string[] {
    const own = lang === 'de' ? PLACE_ABBREVIATIONS.de : PLACE_ABBREVIATIONS.cs;
    const other = lang === 'de' ? PLACE_ABBREVIATIONS.cs : PLACE_ABBREVIATIONS.de;
    return [...(own[abbr] ?? []), ...(other[abbr] ?? [])];
}

const ABBREVIATION = /(^|[\s,(-])(\p{Lu}\p{Ll}?\.)(?=\s*\p{L})/gu;

/** The query with its abbreviations spelled out: the usual reading first, then each other reading alone. */
function expandAbbreviations(q: string, lang: Language): string[] {
    let phrased = q;
    for (const p of PLACE_PHRASES) phrased = phrased.replace(p.from, p.to);
    const hits: { index: number; length: number; alts: string[] }[] = [];
    for (const m of phrased.matchAll(ABBREVIATION)) {
        const alts = alternatives(m[2], lang);
        if (alts.length) hits.push({ index: m.index! + m[1].length, length: m[2].length, alts });
    }
    const build = (pick: (i: number) => string): string => {
        let out = '';
        let at = 0;
        hits.forEach((h, i) => {
            out += phrased.slice(at, h.index) + pick(i);
            at = h.index + h.length;
            // "H.Lhota" → "Horní Lhota"
            if (phrased[at] && !/\s/.test(phrased[at])) out += ' ';
        });
        return (out + phrased.slice(at)).replace(/\s+/g, ' ').trim();
    };
    const out: string[] = [];
    if (phrased !== q) out.push(phrased.replace(/\s+/g, ' ').trim());
    if (!hits.length) return out;
    out.push(build(i => hits[i].alts[0]));
    hits.forEach((h, n) => {
        for (const alt of h.alts.slice(1)) out.push(build(i => i === n ? alt : hits[i].alts[0]));
    });
    return out;
}

/** The names of the research's place record of this place (its own, older, other languages). */
function recordNames(q: string, data: StromData | undefined): string[] {
    const records = data?.placeRecords;
    if (!records) return [];
    const key = placeKey(q);
    const id = data?.placeRefs?.[key]
        ?? Object.values(records).find(r => r.names.some(n => placeKey(n.name) === key))?.id;
    const rec = id ? records[id] : undefined;
    return rec ? rec.names.map(n => n.name) : [];
}

/**
 * The queries for one place search, at most MAX_PLACE_QUERIES, no two alike
 * (case and Unicode form aside): the original, its abbreviations spelled
 * out, the place's other names (the research's record; `also` = the names
 * the history of places knows for it, from the caller) and the text without
 * diacritics.
 */
export function expandPlaceQuery(q: string, lang: Language, data?: StromData, also: readonly string[] = []): string[] {
    const original = q.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!original) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (form: string): void => {
        const f = form.normalize('NFC').replace(/\s+/g, ' ').trim();
        const k = f.toLocaleLowerCase();
        if (!f || f.length > 200 || seen.has(k) || out.length >= MAX_PLACE_QUERIES) return;
        seen.add(k);
        out.push(f);
    };
    add(original);
    expandAbbreviations(original, lang).forEach(add);
    recordNames(original, data).forEach(add);
    also.forEach(add);
    add(withoutDiacritics(original));
    return out;
}
