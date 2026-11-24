/**
 * The name a `strom-research://new` link suggests (spec 139 \u00a711.4, the
 * research's answer A): cleaned and cut as the research cuts it — NFC, at
 * most 120 characters as a person sees them, never half an emoji or a letter
 * without its accent. Fuzzed: the cut is always a prefix of the cleaned
 * original in whole characters, and the link carries exactly that prefix.
 */

import { describe, it, expect } from 'vitest';
import { researchNewName, researchNewUrl, RESEARCH_NEW_NAME_MAX, sanitizeLiveStatus, sanitizeTreesRoot } from '../research-link.js';

const TOKEN = 'aB3_-xYz0123456789abcdefGHIJ';
type Segmenter = { segment(text: string): Iterable<{ segment: string }> };
const Seg = (Intl as unknown as { Segmenter: new (locale?: string, options?: { granularity: 'grapheme' }) => Segmenter }).Segmenter;
const seg = new Seg(undefined, { granularity: 'grapheme' });
const chars = (text: string): string[] => Array.from(seg.segment(text), s => s.segment);

/** The original as the research reads it before the cut: NFC, one line, spaces merged. */
function cleaned(text: string): string {
    return text.normalize('NFC')
        .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, c => (c === '\u200c' || c === '\u200d' ? c : ' '))
        .replace(/\s+/g, ' ').trim();
}

/** The name the link carries, decoded. */
function linkName(name: string): string | null {
    const url = researchNewUrl(TOKEN, undefined, undefined, undefined, name);
    const m = url?.match(/&name=([^&]*)$/);
    return m ? decodeURIComponent(m[1]) : null;
}

/** A small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const FAMILY = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}';
const PIECES = [
    'a', 'Z', '7', ' ', '  ', '-', '(kopie)', '\u0159', '\u017d',
    'e\u0301', 'a\u030a', 'o\u0308\u0304',                     // combining marks (NFC joins some, not all)
    '\u1112\u1161\u11ab',                                        // Hangul jamo: one syllable after NFC
    '\u6f22', '\u5b57', '\u65cf', '\u306e',                      // CJK
    '\u{1f600}', '\u{1f44d}\u{1f3fd}', '\u{1f1e8}\u{1f1ff}', '1\ufe0f\u20e3',   // emoji, skin tone, flag, keycap
    FAMILY, '\u{1f3f3}\ufe0f\u200d\u{1f308}',                   // ZWJ sequences
    '\n', '\t', '\r\n', '\u0007', '\u200b', '\u00ad', '\u2028', // line ends, controls, format characters
];

function randomName(next: () => number, around: number): string {
    let out = '';
    while (chars(out).length < around) out += PIECES[Math.floor(next() * PIECES.length)];
    return out;
}

describe('the name of a new research: the cut', () => {
    it('fuzz: a prefix of the cleaned original in whole characters, at most 120, and the link carries exactly it', () => {
        const next = rng(139);
        for (let i = 0; i < 600; i++) {
            // Mostly right around the limit, some short.
            const around = i % 5 === 0 ? Math.floor(next() * 40) : RESEARCH_NEW_NAME_MAX - 4 + Math.floor(next() * 10);
            const original = randomName(next, around);
            const out = researchNewName(original);
            const ref = cleaned(original);
            const refChars = chars(ref);
            expect(chars(out).length).toBeLessThanOrEqual(RESEARCH_NEW_NAME_MAX);
            expect(out).toBe(out.normalize('NFC'));
            expect(ref.startsWith(out)).toBe(true);
            // Whole characters: the cut lies on a boundary of the original's characters.
            expect(out).toBe(refChars.slice(0, Math.min(RESEARCH_NEW_NAME_MAX, refChars.length)).join('').trim());
            if (refChars.length <= RESEARCH_NEW_NAME_MAX) expect(out).toBe(ref);
            expect(linkName(original)).toBe(out || null);
        }
    });

    it('right at the boundary: an emoji, a ZWJ family, a letter with its accent, CJK are whole or out', () => {
        const a = 'a'.repeat(119);
        expect(researchNewName(a + FAMILY)).toBe(a + FAMILY);
        expect(researchNewName('a'.repeat(120) + FAMILY)).toBe('a'.repeat(120));
        expect(researchNewName(a + '\u{1f600}b')).toBe(a + '\u{1f600}');
        expect(researchNewName(a + '\u{1f44d}\u{1f3fd}')).toBe(a + '\u{1f44d}\u{1f3fd}');
        expect(researchNewName(a + '\u{1f1e8}\u{1f1ff}\u{1f1e9}\u{1f1ea}')).toBe(a + '\u{1f1e8}\u{1f1ff}');
        // A decomposed "\u00e9" 121 times: NFC first, then 120 of them.
        expect(researchNewName('e\u0301'.repeat(121))).toBe('\u00e9'.repeat(120));
        // Marks NFC cannot join stay with their letter.
        expect(researchNewName(a + 'q\u0301\u0327x')).toBe(a + 'q\u0327\u0301');
        expect(researchNewName('\u6f22'.repeat(121))).toBe('\u6f22'.repeat(120));
        expect(linkName(a + FAMILY + 'z')).toBe(a + FAMILY);
    });

    it('one line: controls and format characters are spaces, the joiners stay; nothing left is no name', () => {
        expect(researchNewName(' Rodina\u0007Kalinovsk\u00fdch\u200b(kopie)\u2028 ')).toBe('Rodina Kalinovsk\u00fdch (kopie)');
        expect(researchNewName('\u200b\n\t ')).toBe('');
        expect(researchNewUrl(TOKEN, undefined, undefined, undefined, '\u200b\n')).toBe(`strom-research://new?app=${TOKEN}`);
    });
});

/** `/status.treesRoot` (Strom Research 1.37, answer B): where new researches are made here, for display only. */
describe('the folder new researches are made in', () => {
    const status = (extra: Record<string, unknown>) => sanitizeLiveStatus({ tree: { id: 'c0ffee00-0000-4000-8000-000000000001', name: 'F' }, head: 'abc', ...extra });

    it('is read from the status when said, absent when not', () => {
        expect(status({ treesRoot: '/Users/jana/Strom v\u00fdzkum' })?.treesRoot).toBe('/Users/jana/Strom v\u00fdzkum');
        expect(status({})?.treesRoot).toBeUndefined();
        expect(status({ treesRoot: 42 })?.treesRoot).toBeUndefined();
    });

    it('an absolute path of one line, its trailing separator dropped; anything else is not said', () => {
        expect(sanitizeTreesRoot(' /home/jana/Strom/ ')).toBe('/home/jana/Strom');
        expect(sanitizeTreesRoot('C:\\Users\\jana\\Strom\\')).toBe('C:\\Users\\jana\\Strom');
        expect(sanitizeTreesRoot('\\\\nas\\Strom')).toBe('\\\\nas\\Strom');
        expect(sanitizeTreesRoot('~/Strom')).toBe('~/Strom');
        expect(sanitizeTreesRoot('/')).toBe('/');
        expect(sanitizeTreesRoot('C:\\')).toBe('C:\\');
        expect(sanitizeTreesRoot('Strom/v\u00fdzkum')).toBeNull();
        expect(sanitizeTreesRoot('')).toBeNull();
        expect(sanitizeTreesRoot('/a\nb')).toBeNull();
        expect(sanitizeTreesRoot('/' + 'a'.repeat(1024))).toBeNull();
    });
});
