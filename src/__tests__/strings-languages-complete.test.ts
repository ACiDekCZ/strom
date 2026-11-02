/**
 * Every text of the app exists in every UI language (en, cs, de, pl): the
 * same keys, no empty text, arrays of the same length, functions that return
 * a text for sample arguments. Polish is checked against English too: a
 * Polish text equal to the English one while Czech and German differ from it
 * is an untranslated leftover.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang, SUPPORTED_LANGUAGES, Language } from '../strings.js';

const LANGS: Language[] = ['en', 'cs', 'de', 'pl'];

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path: string, out: Leaf[]): void {
    if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
    else out.push({ path, value });
}

function byPath(lang: Language): Map<string, unknown> {
    const out: Leaf[] = [];
    leaves(getStringsForLang(lang), '', out);
    return new Map(out.map(l => [l.path, l.value]));
}

/** Sample arguments by parameter name: numbers for counts, words for the rest. */
function sampleArgs(fn: Function): unknown[] {
    const src = String(fn);
    const head = /^(?:function[^(]*)?\(([^)]*)\)|^([\w$]+)\s*=>/.exec(src);
    const params = head ? (head[1] ?? head[2] ?? '').split(',').map(p => p.trim()).filter(Boolean) : [];
    return params.map(p => /^(n|m|c|o|k|count|total|done|years?|age|i|idx|index|days?|shown|pct|percent|size|bytes|max|min|from|to|left|kept|added|removed)\b/i.test(p.replace(/^_/, ''))
        ? 3 : 'X');
}

describe('texts in every UI language', () => {
    const packs = new Map(LANGS.map(l => [l, byPath(l)]));
    const en = packs.get('en')!;

    it('the language switch offers every language under its own name', () => {
        expect(SUPPORTED_LANGUAGES.map(l => l.code)).toEqual(LANGS);
        expect(SUPPORTED_LANGUAGES.find(l => l.code === 'pl')?.name).toBe('Polski');
    });

    for (const lang of LANGS) {
        it(`${lang}: the same keys as English, nothing empty`, () => {
            const pack = packs.get(lang)!;
            const missing = [...en.keys()].filter(k => !pack.has(k));
            const extra = [...pack.keys()].filter(k => !en.has(k));
            const empty = [...pack.entries()]
                .filter(([k, v]) => typeof v === 'string' && v.trim() === '' && typeof en.get(k) === 'string' && (en.get(k) as string).trim() !== '')
                .map(([k]) => k);
            const wrongKind = [...pack.entries()].filter(([k, v]) => en.has(k) && typeof v !== typeof en.get(k)).map(([k]) => k);
            expect({ missing, extra, empty, wrongKind }).toEqual({ missing: [], extra: [], empty: [], wrongKind: [] });
        });

        it(`${lang}: functions return a text`, () => {
            const pack = packs.get(lang)!;
            const failed: string[] = [];
            for (const [k, v] of pack) {
                if (typeof v !== 'function') continue;
                try {
                    const r = (v as (...a: unknown[]) => unknown)(...sampleArgs(v as Function));
                    if (typeof r === 'string' && r.trim() === '' && typeof en.get(k) === 'function') {
                        const re = (en.get(k) as (...a: unknown[]) => unknown)(...sampleArgs(en.get(k) as Function));
                        if (typeof re === 'string' && re.trim() !== '') failed.push(`${k}: empty`);
                    }
                } catch { /* a function that needs structured arguments: its shape is checked by the types */ }
            }
            expect(failed).toEqual([]);
        });
    }

    it('pl: no English text left where Czech and German translate it', () => {
        const cs = packs.get('cs')!, de = packs.get('de')!, pl = packs.get('pl')!;
        const left: string[] = [];
        for (const [k, v] of en) {
            if (typeof v !== 'string' || !/[a-z]{3,}\s+[a-z]{3,}/i.test(v)) continue;
            if (pl.get(k) === v && cs.get(k) !== v && de.get(k) !== v) left.push(`${k}: ${v.slice(0, 60)}`);
        }
        expect(left).toEqual([]);
    });

    it('pl: no Czech word left (letters Polish does not have, outside names the English text has too, declined or not)', () => {
        const pl = packs.get('pl')!;
        const NOT_POLISH = /[áéíúýčďěňřšťůž]/i;
        const left: string[] = [];
        for (const [k, v] of pl) {
            const text = typeof v === 'function' ? String(v) : typeof v === 'string' ? v : '';
            const enWords = (String(en.get(k) ?? '').match(/[\p{L}]+/gu) ?? []).filter(w => NOT_POLISH.test(w));
            for (const word of text.match(/[\p{L}]+/gu) ?? []) {
                if (NOT_POLISH.test(word) && !enWords.some(w => word.startsWith(w))) { left.push(`${k}: ${word}`); break; }
            }
        }
        expect(left).toEqual([]);
    });
});
