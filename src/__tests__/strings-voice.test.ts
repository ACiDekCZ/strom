/**
 * The Czech UI speaks impersonally (ZADANI_DEV §12.2, CLAUDE.md "Impersonal UI texts"): no sentence of the
 * Czech pack opens with a verb in the first person ("Posílám…", "Kontroluji…", "Čekáme…"); a running state
 * says what happens ("Posílá se…", "Kontroluje se…"). The German pack has no "Warte …" either.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang, type Language } from '../strings.js';

/** Every text of a pack: plain strings, and what its functions say for sample arguments. */
function texts(lang: Language): Array<{ path: string; text: string }> {
    const out: Array<{ path: string; text: string }> = [];
    const samples: unknown[][] = [[], ['X'], [2], ['X', 'Y'], [2, 3], [2, 3, 'X'], ['X', 2], ['X', 'Y', 'Z']];
    const walk = (v: unknown, path: string, depth: number): void => {
        if (depth > 8) return;
        if (typeof v === 'string') out.push({ path, text: v });
        else if (typeof v === 'function') {
            for (const args of samples) {
                try {
                    const r = (v as (...a: unknown[]) => unknown)(...args);
                    if (typeof r === 'string') out.push({ path, text: r });
                } catch { /* a function wanting other arguments */ }
            }
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    };
    walk(getStringsForLang(lang), '', 0);
    return out;
}

/** The first word of each sentence of a text. */
function sentenceStarts(text: string): string[] {
    return text
        .split(/(?:^|[.!?…:]\s+|\n+)/u)
        .map(s => s.trim().replace(/^[„“"'(«»‚\-–—•·\s]+/u, ''))
        .map(s => /^[\p{L}]+/u.exec(s)?.[0] ?? '')
        .filter(w => w.length > 0);
}

/**
 * A Czech verb in the first person at the start of a sentence: singular -ám / -ím / -uji / -uju (capitalised: the
 * sentence starts with it), or "Čekáme". Words of that shape that are not verbs are listed.
 */
const FIRST_PERSON_CS = /^\p{Lu}\p{Ll}+(?:ám|ím|uji|uju)$/u;
/** Verbal nouns and adverbs in the instrumental ("Kliknutím", "Spojením", "Zatím", "Předtím"). */
const NOT_VERB_END = /(?:ním|tím)$/u;
/**
 * Not the app speaking: answers in the person's own voice, offered as the person's reply
 * ("Rozumím" to a notice, "Nevím" among the answers to the agent's question).
 */
const OWN_ANSWERS = new Set(['Rozumím', 'Nevím']);
/** A box the person ticks in their own words (Delete permanently's "Rozumím, smazání nejde v aplikaci vrátit", spec 102 §9). */
const OWN_WORDS_PATHS = new Set(['materials.del.understand']);
const NOT_VERBS = new Set(['Přím', 'Rám', 'Tím', 'Nám', 'Vám', 'Sám', 'Jím', 'Kterým', 'Jejím', 'Mým', 'Tvým', 'Svým', 'Jakým', 'Všem', 'Dlouhým', 'Prvním', 'Posledním', 'Novým', 'Starým', 'Jiným', 'Každým', 'Takovým', 'Dalším', 'Ostatním', 'Hlavním', 'Celým', 'Jediným', 'Vlastním', 'Stejným', 'Tímto', 'Pouhým', 'Nejbližším']);

describe('impersonal Czech texts (§12.2)', () => {
    it('no Czech sentence opens with a verb in the first person', () => {
        const bad = new Set<string>();
        for (const { path, text } of texts('cs')) {
            for (const w of sentenceStarts(text)) {
                if (w === 'Čekáme' || (FIRST_PERSON_CS.test(w) && !NOT_VERB_END.test(w) && !NOT_VERBS.has(w) && !OWN_ANSWERS.has(text) && !OWN_WORDS_PATHS.has(path))) bad.add(`${path}: ${text}`);
            }
        }
        expect([...bad]).toEqual([]);
    });

    it('the renamed running states read impersonally', () => {
        const cs = getStringsForLang('cs');
        expect(cs.research.opening).toBe('Otevírá se výzkum…');
        expect(cs.research.openingAgent).toBe('Otevírá se agent…');
        expect(cs.research.opening).toBe(cs.busy.openingResearch);
        expect(cs.research.openingAgent).toBe(cs.busy.openingAgent);
        expect(cs.sync.sending).toBe('Posílá se…');
        expect(cs.map.searching).toBe('Hledá se…');
    });

    it('no German text opens with "Warte"', () => {
        const bad = texts('de').filter(({ text }) => sentenceStarts(text).includes('Warte')).map(t => `${t.path}: ${t.text}`);
        expect([...new Set(bad)]).toEqual([]);
    });
});
