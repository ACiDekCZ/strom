/**
 * The image's footer (tree name · view label · date) stays inside the image's
 * width: a long view label wraps onto a second row, and only when two rows do
 * not take it the second ends in "…" (1109).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildTreeSvg, posterFooterLayout, PosterLayout, PosterFooterMeta } from '../export-image.js';
import { StromData, Person, PersonId, PartnershipId, Position } from '../types.js';
import { MeasureTexts } from '../card-width.js';
import { setLanguage, strings } from '../strings.js';

afterEach(() => setLanguage('cs'));

const PADDING = 40;

/** Width of one character: wide for CJK and emoji, nothing for a combining mark or joiner. */
function charWidth(ch: string): number {
    if (/[\p{M}‍️]/u.test(ch)) return 0;
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) return 12;
    if (/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/u.test(ch)) return 14;
    return 6.5;
}
/** A measure of the footer's two fonts (the tree name 16px, the rest 12px). */
const measure: MeasureTexts = (kind, texts) => {
    const scale = kind === 'posterTitle' ? 16 / 12 : 1;
    const out = new Map<string, number>();
    for (const t of texts) out.set(t, Array.from(t).reduce((w, ch) => w + charWidth(ch), 0) * scale);
    return out;
};

function person(id: string): Person {
    return {
        id: id as PersonId, firstName: 'Jan', lastName: 'Novák', gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
    };
}

function treeOf(n: number): { data: StromData; layout: PosterLayout } {
    const persons: StromData['persons'] = {};
    const positions = new Map<PersonId, Position>();
    for (let i = 0; i < n; i++) {
        const p = person(`p${i}`);
        persons[p.id] = p;
        positions.set(p.id, { x: i * 220, y: 0 });
    }
    return {
        data: { persons, partnerships: {} as Record<PartnershipId, never> },
        layout: { positions, connections: [], spouseLines: [] },
    };
}

const unescape = (s: string): string =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The footer's rows as drawn: each row's parts (16px the tree name, else the rest). */
function footerRows(svg: string): Array<Array<{ title: boolean; text: string }>> {
    const tail = svg.slice(svg.lastIndexOf('</g>'));
    return [...tail.matchAll(/<text [^>]*>(.*?)<\/text>/g)].map(m =>
        [...m[1].matchAll(/<tspan font-size="(\d+)"[^>]*>(.*?)<\/tspan>/g)]
            .map(t => ({ title: t[1] === '16', text: unescape(t[2]) })));
}

const rowWidth = (row: Array<{ title: boolean; text: string }>): number =>
    row.reduce((w, p) => w + (measure(p.title ? 'posterTitle' : 'posterNote', [p.text]).get(p.text) ?? 0), 0);

const svgSize = (svg: string): { width: number; height: number } => {
    const m = svg.match(/<svg [^>]*width="(\d+)" height="(\d+)"/)!;
    return { width: Number(m[1]), height: Number(m[2]) };
};

const LONG_NAMES: Record<'de' | 'cs', { tree: string; name: string }> = {
    de: { tree: 'Familie Quastenbrück', name: 'Wunibalda-Ottiline Quastenbrück-Zwiebelhain' },
    cs: { tree: 'Rodina Pomněnkových', name: 'Bohumila Květoslava Pomněnková-Bezinková' },
};

describe('the image footer stays inside the image (1109)', () => {
    for (const lang of ['de', 'cs'] as const) {
        it(`${lang}: a long name in the view label wraps onto a second row, the image grows`, () => {
            setLanguage(lang);
            const { tree, name } = LONG_NAMES[lang];
            const meta: PosterFooterMeta = {
                treeName: tree, viewLabel: strings.poster.viewFamily(name, 3, 3), dateLabel: '10. 11. 2026',
                measureFooterTexts: measure,
            };
            const { data, layout } = treeOf(2);
            const svg = buildTreeSvg(data, layout, meta);
            const { width, height } = svgSize(svg);
            const rows = footerRows(svg);
            expect(rows).toHaveLength(2);
            for (const row of rows) expect(rowWidth(row)).toBeLessThanOrEqual(width - 2 * PADDING);
            // Nothing lost: the rows read the whole footer (spaces aside).
            const read = rows.map(r => r.map(p => p.text).join('')).join('').replace(/\s+/g, '');
            expect(read).toBe(`${tree}·${meta.viewLabel}·10. 11. 2026`.replace(/\s+/g, ''));
            // The second row adds its height to the image.
            const short = buildTreeSvg(data, layout, { ...meta, viewLabel: 'Familie' });
            expect(footerRows(short)).toHaveLength(1);
            expect(height).toBe(svgSize(short).height + 20);
        });

        it(`${lang}: a very narrow image takes two rows, the second ending in "…"`, () => {
            setLanguage(lang);
            const { tree, name } = LONG_NAMES[lang];
            const { data, layout } = treeOf(1);
            const svg = buildTreeSvg(data, layout, {
                treeName: tree, viewLabel: strings.poster.viewFamily(name, 3, 3), dateLabel: '10. 11. 2026',
                measureFooterTexts: measure,
            });
            const { width } = svgSize(svg);
            const rows = footerRows(svg);
            expect(rows).toHaveLength(2);
            for (const row of rows) expect(rowWidth(row)).toBeLessThanOrEqual(width - 2 * PADDING);
            expect(rows[1][rows[1].length - 1].text.endsWith('…')).toBe(true);
        });
    }

    it('a short footer stays one row, the image as tall as before', () => {
        const { data, layout } = treeOf(2);
        const svg = buildTreeSvg(data, layout, {
            treeName: 'Rodina', viewLabel: 'Rodina — od Jana', dateLabel: '1. 1. 2026', measureFooterTexts: measure,
        });
        expect(footerRows(svg)).toHaveLength(1);
        // 64px card + padding 2x40 + the footer's 44px.
        expect(svgSize(svg).height).toBe(64 + 80 + 44);
    });
});

/** Intl.Segmenter (ES2022; Node has it): the reference for where a character ends. */
const Segmenter = (Intl as unknown as {
    Segmenter: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ index: number }> };
}).Segmenter;

describe('a footer row break never loses or tears a character (1109)', () => {
    const graphemeEnds = (text: string): Set<number> => {
        const out = new Set<number>();
        for (const g of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) out.add(g.index);
        out.add(text.length);
        return out;
    };
    // A small deterministic generator (xorshift).
    let seed = 1109;
    const rand = (): number => {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        return ((seed >>> 0) % 100000) / 100000;
    };
    const PIECES = ['Novák', ' ', ' ', '-', '–', 'é', 'ño', '👨‍👩‍👧', '🇨🇿', '👍🏽', '1️⃣', '山田太郎', '花子',
        'カタカナ', 'Zwiebelhain', '(Tiefe 3/3)', '·', 'Ł', '&<>'];
    const textOf = (n: number): string => Array.from({ length: n }, () => PIECES[Math.floor(rand() * PIECES.length)]).join('');

    it('joined rows give the text back (or its start before "…"), every break between whole characters', () => {
        for (let round = 0; round < 400; round++) {
            const meta: PosterFooterMeta = {
                treeName: rand() < 0.8 ? textOf(1 + Math.floor(rand() * 4)) : undefined,
                viewLabel: textOf(1 + Math.floor(rand() * 20)),
                dateLabel: rand() < 0.7 ? textOf(1 + Math.floor(rand() * 3)) : undefined,
                measureFooterTexts: measure,
            };
            const width = 2 * PADDING + 40 + Math.floor(rand() * 500);
            const f = posterFooterLayout(meta, width);
            const where = JSON.stringify({ meta: { ...meta, measureFooterTexts: undefined }, width });
            expect(f.rows.length, where).toBeGreaterThan(0);
            expect(f.rows.length, where).toBeLessThanOrEqual(2);
            expect(f.rows[0][0], where).toBe(0);
            f.rows.forEach(([a], k) => { if (k > 0) expect(a, where).toBe(f.rows[k - 1][1]); });
            const joined = f.rows.map(([a, b]) => f.text.slice(a, b)).join('');
            if (f.cut) expect(f.text.startsWith(joined), where).toBe(true);
            else expect(joined, where).toBe(f.text);
            const ends = graphemeEnds(f.text);
            for (const [a, b] of f.rows) {
                expect(ends.has(a), where).toBe(true);
                expect(ends.has(b), where).toBe(true);
            }
        }
    });

    it('CJK breaks between its characters at the row\'s end; a joined emoji stays whole', () => {
        const cjk = posterFooterLayout({ viewLabel: '家族 — 山田太郎山田太郎山田太郎山田太郎山田太郎', measureFooterTexts: measure }, 2 * PADDING + 120);
        expect(cjk.rows).toHaveLength(2);
        expect(cjk.rows[0][1]).toBeGreaterThan('家族 — '.length);
        const emoji = '👨‍👩‍👧'.repeat(12);
        const e = posterFooterLayout({ viewLabel: emoji, measureFooterTexts: measure }, 2 * PADDING + 50);
        const ends = graphemeEnds(emoji);
        for (const [a, b] of e.rows) expect(ends.has(a) && ends.has(b)).toBe(true);
        expect(e.cut).toBe(true);
    });
});
