/**
 * The custom card's width (src/card-width.ts, T04/T12) and its date column
 * (T05), and the poster drawing them (src/export-image.ts). Widths come from
 * a made-up measure, so the arithmetic is checked exactly. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    customCardWidth, customCardMetrics, customCardCutLines, MeasureTexts, CustomCardEntry, wrapCardText, wrapCardTexts,
    customCardRows, customCardHeight, customCardViewHeight, customCardSpouseLineY, WrapRequest,
} from '../card-width.js';
import { cardLines, cardLineHtml, cardDateReferences, cardDate, normalizeCardFields, DEFAULT_CARD_FIELDS } from '../card-fields.js';
import { buildTreeSvg, PosterLayout } from '../export-image.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId, PartnershipId, StromData } from '../types.js';

/** 6px a character, 8px for the name's: easy to add up. */
const measure: MeasureTexts = (kind, texts) => {
    const out = new Map<string, number>();
    for (const t of texts) out.set(t, t.length * (kind === 'name' ? 8 : 6));
    return out;
};

const line = (date: string, rest: string, extra: Partial<CustomCardEntry['lines'][number]> = {}) =>
    ({ key: 'birth' as const, mark: '*', text: `${date} ${rest}`.trim(), spoken: '', date, rest, ...extra });

describe('customCardWidth', () => {
    it('adds the 12px paddings and the 1px borders, rounds up to 4px, keeps 200–320', () => {
        expect(customCardWidth(0)).toBe(200);
        expect(customCardWidth(174)).toBe(200);          // 174 + 26 = 200
        expect(customCardWidth(175)).toBe(204);          // 201 → 204
        expect(customCardWidth(250)).toBe(276);          // 276 is a multiple of 4
        expect(customCardWidth(250.2)).toBe(280);        // a fraction counts as a whole pixel
        expect(customCardWidth(251)).toBe(280);
        expect(customCardWidth(294)).toBe(320);
        expect(customCardWidth(295)).toBe(320);          // over the top: the widest card
        expect(customCardWidth(5000)).toBe(320);
        for (let c = 0; c < 400; c += 7) expect(customCardWidth(c) % 4).toBe(0);
    });

    it('narrow and wide are the same rule with another cap (U02)', () => {
        expect(customCardWidth(174, 240)).toBe(200);
        expect(customCardWidth(190, 240)).toBe(216);     // 216 is a multiple of 4
        expect(customCardWidth(214, 240)).toBe(240);
        expect(customCardWidth(215, 240)).toBe(240);
        expect(customCardWidth(5000, 240)).toBe(240);
        expect(customCardWidth(295, 400)).toBe(324);     // past the medium cap
        expect(customCardWidth(374, 400)).toBe(400);
        expect(customCardWidth(5000, 400)).toBe(400);
        expect(customCardWidth(174, 400)).toBe(200);     // at least 200 whatever the cap
        expect(customCardWidth(5000, 320)).toBe(customCardWidth(5000));
    });
});

describe('customCardMetrics', () => {
    it('one width for the view from its longest row; the date column is the longest date', () => {
        const entries: CustomCardEntry[] = [
            { name: 'Jan Vlk', avatar: true, lines: [line('1862', 'Brno')] },
            { name: 'Marie', avatar: true, lines: [line('after 1919', 'Brno')] },
            // 30 characters of place: 11 + 6 + 60 (date column) + 6 + 180 = 263 → 289 → 292.
            { name: 'Anna', avatar: true, lines: [line('1890', 'x'.repeat(30))] },
        ];
        expect(customCardMetrics(entries, measure)).toEqual({ cardWidth: 292, dateColumn: 60 });
    });

    it('the name row counts with its avatar; a placeholder has none', () => {
        // 30 + 8 + 25 × 8 = 238 → 264.
        expect(customCardMetrics([{ name: 'n'.repeat(25), avatar: true, lines: [] }], measure).cardWidth).toBe(264);
        // 25 × 8 = 200 → 226 → 228.
        expect(customCardMetrics([{ name: 'n'.repeat(25), avatar: false, lines: [] }], measure).cardWidth).toBe(228);
    });

    it('the occupation starts at the date column; "+1" counts with the place', () => {
        // Occupation: 11 + 6 + 35 × 6 = 227 → 253 → 256, whatever the date column.
        const job = { key: 'occupation' as const, mark: '', text: '', spoken: '', date: '', rest: 'o'.repeat(35), wide: true };
        expect(customCardMetrics([{ name: 'A', avatar: true, lines: [line('after 1919', ''), job] }], measure))
            .toEqual({ cardWidth: 256, dateColumn: 60 });
        // 11 + 6 + 24 + 6 + 20 × 6 + " +1" (18) = 185 → 211 → 212.
        expect(customCardMetrics([{ name: 'A', avatar: true, lines: [line('1888', 'p'.repeat(20), { more: '+1' })] }], measure).cardWidth)
            .toBe(212);
    });

    it('reads the lines the card shows: an estimate is in the date column', () => {
        setLanguage('en');
        const p: Person = {
            id: 'p' as PersonId, firstName: 'Marie', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
            deathDate: '>1919', deathPlace: 'Brno', partnerships: [], parentIds: [], childIds: [],
        };
        const data: StromData = { persons: { [p.id]: p }, partnerships: {} as StromData['partnerships'] };
        const lines = cardLines(p, data, normalizeCardFields(DEFAULT_CARD_FIELDS));
        expect(lines).toEqual([expect.objectContaining({ date: 'after 1919', rest: 'Brno', text: 'after 1919 Brno' })]);
        expect(customCardMetrics([{ name: 'Marie Vlková', avatar: true, lines }], measure).dateColumn).toBe(60);
    });
});

describe('the width cap (U02)', () => {
    it('caps the view\'s width and the places cut against it', () => {
        // 11 + 6 + 24 + 6 + 50 × 6 = 347 → 373 → 376.
        const long = line('1862', 'x'.repeat(50));
        const entries: CustomCardEntry[] = [{ name: 'A', avatar: true, lines: [long] }];
        expect(customCardMetrics(entries, measure)).toEqual({ cardWidth: 320, dateColumn: 24 });
        expect(customCardMetrics(entries, measure, 240).cardWidth).toBe(240);
        expect(customCardMetrics(entries, measure, 400).cardWidth).toBe(376);
        expect(customCardCutLines(entries, customCardMetrics(entries, measure, 240), measure).has(long)).toBe(true);
        expect(customCardCutLines(entries, customCardMetrics(entries, measure, 320), measure).has(long)).toBe(true);
        expect(customCardCutLines(entries, customCardMetrics(entries, measure, 400), measure).size).toBe(0);
        // A short view is as wide under every cap.
        const short: CustomCardEntry[] = [{ name: 'A', avatar: true, lines: [line('1862', 'Brno')] }];
        for (const cap of [240, 320, 400]) expect(customCardMetrics(short, measure, cap).cardWidth).toBe(200);
    });
});

describe('a place cut short is said in full (U02)', () => {
    // At 320px the room is 294; "1862" makes a 24px date column, so the place starts at 47 and has 247.
    it('marks only the lines whose place does not fit the widest card', () => {
        const fits = line('1862', 'f'.repeat(41));                       // 246 ≤ 247
        const cut = line('1862', 'c'.repeat(42));                        // 252 > 247
        const cutByMore = line('1862', 'm'.repeat(39), { more: '+1' });  // 234 + 18 > 247
        const job = { key: 'occupation' as const, mark: '', text: '', spoken: '', date: '', rest: 'o'.repeat(46), wide: true }; // 17 + 276 < 294
        const entries: CustomCardEntry[] = [{ name: 'A', avatar: true, lines: [fits, cut, cutByMore, job, line('1862', '')] }];
        const metrics = customCardMetrics(entries, measure);
        expect(metrics).toEqual({ cardWidth: 320, dateColumn: 24 });
        expect([...customCardCutLines(entries, metrics, measure)]).toEqual([cut, cutByMore]);
        // A view whose card grew to fit every place cuts nothing.
        const narrow: CustomCardEntry[] = [{ name: 'A', avatar: true, lines: [line('1862', 'x'.repeat(30))] }];
        expect(customCardCutLines(narrow, customCardMetrics(narrow, measure), measure).size).toBe(0);
    });

    it('the cut place carries its whole text (place · cause) in an escaped title; a whole one none', () => {
        const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
        const l = line('1919', 'Nové "Město" <u> Brna & okolí · tyfus');
        const html = cardLineHtml(l, esc, true);
        expect(html).toContain('<span class="card-line-rest" title="Nové &#34;Město&#34; &#60;u&#62; Brna &#38; okolí · tyfus">');
        // The attribute ends at its closing quote only: no raw quote, < or & inside it.
        const attr = /title="([^"]*)"/.exec(html)?.[1] ?? '';
        expect(attr).not.toMatch(/[<>'"]|&(?!#\d+;)/);
        expect(attr.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))).toBe(l.rest);
        expect(cardLineHtml(l, esc)).not.toContain('title=');
        expect(cardLineHtml(line('1919', ''), esc, true)).not.toContain('title=');
    });
});

describe('the poster draws the custom card like the screen', () => {
    beforeEach(() => setLanguage('en'));

    it('the measured width, the date and the place as two texts, the place at left + 17 + date column + 6', () => {
        const a: Person = { id: 'a' as PersonId, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [] };
        const data: StromData = { persons: { [a.id]: a }, partnerships: {} as Record<PartnershipId, never> };
        const layout: PosterLayout = { positions: new Map([[a.id, { x: 100, y: 50 }]]), connections: [], spouseLines: [] };
        const lines = [line('1890', 'Horní Lhota u Bystřice'), line('after 1919', 'Brno', { key: 'death', mark: '†' }),
            { key: 'occupation' as const, mark: '', text: 'mlynář', spoken: '', date: '', rest: 'mlynář', wide: true }];
        const svg = buildTreeSvg(data, layout, {
            config: { ...{ cardWidth: 276, cardHeight: 107 } } as never,
            cardLines: new Map([['a', lines]]), cardDateColumn: 60, measureCardTexts: measure,
        });
        expect(svg).toMatch(/<rect x="100.0" y="50.0" width="276" height="107" rx="8"/);
        // left = 100 + 12; date at left + 17 = 129; place at 129 + 60 + 6 = 195.
        expect(svg).toMatch(/<text class="card-line-date" x="129.0" y="108.5"[^>]*font-weight="500"[^>]*>1890<\/text>/);
        expect(svg).toMatch(/<text class="card-line-place" x="195.0" y="108.5"[^>]*>Horní Lhota u Bystřice<\/text>/);
        expect(svg).toMatch(/<text class="card-line-date" x="129.0" y="125.5"[^>]*>after 1919<\/text>/);
        expect(svg).toMatch(/<text class="card-line-place" x="195.0" y="125.5"[^>]*>Brno<\/text>/);
        // The occupation starts at the date column.
        expect(svg).toMatch(/<text class="card-line-place" x="129.0" y="142.5"[^>]*>mlynář<\/text>/);
    });

    it('the name is drawn at its measured width, so another font cannot push it past the card (T12)', () => {
        const a: Person = { id: 'a' as PersonId, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [] };
        const b: Person = { ...a, id: 'b' as PersonId, firstName: 'Bartoloměj', lastName: 'Wolfensteiner' };
        const data: StromData = { persons: { [a.id]: a, [b.id]: b }, partnerships: {} as Record<PartnershipId, never> };
        const layout: PosterLayout = {
            positions: new Map([[a.id, { x: 0, y: 0 }], [b.id, { x: 300, y: 0 }]]), connections: [], spouseLines: [],
        };
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 200, cardHeight: 56 } as never,
            cardLines: new Map([['a', []], ['b', []]]), cardDateColumn: 0, measureCardTexts: measure,
        });
        // "Anna Vlková": 11 × 8 = 88px, within the room (200 − 24 − 38 = 138): drawn at 88.
        expect(svg).toMatch(/<text x="50.0" y="30.0" font-size="15" font-weight="600"[^>]*textLength="88.0" lengthAdjust="spacingAndGlyphs"[^>]*>Anna Vlková<\/text>/);
        // 24 × 8 = 192px: 13px still 166.4 > 138, so drawn into the room.
        expect(svg).toMatch(/<text x="350.0" y="30.0" font-size="13" font-weight="600"[^>]*textLength="138.0"[^>]*>Bartoloměj Wolfensteiner<\/text>/);
    });

    it('the date and the place are drawn at their measured widths and the fonts travel with the image (T05)', () => {
        const a: Person = { id: 'a' as PersonId, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [] };
        const data: StromData = { persons: { [a.id]: a }, partnerships: {} as Record<PartnershipId, never> };
        const layout: PosterLayout = { positions: new Map([[a.id, { x: 0, y: 0 }]]), connections: [], spouseLines: [] };
        const face = "@font-face { font-family: \"Instrument Sans\"; font-weight: 500; src: url(\"data:font/woff2;base64,AAAA\"); }";
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 320, cardHeight: 73 } as never,
            cardLines: new Map([['a', [line('after 1919', 'P'.repeat(80), { more: '+1' })]]]), cardDateColumn: 60, measureCardTexts: measure,
            fontFaceCss: face,
        });
        expect(svg).toContain(`<defs><style><![CDATA[\n${face}\n]]></style></defs>`);
        // "after 1919": 10 × 6 = 60px.
        expect(svg).toMatch(/<text class="card-line-date"[^>]*textLength="60.0" lengthAdjust="spacingAndGlyphs"[^>]*>after 1919<\/text>/);
        // Room: 320 − 12 − (12 + 17 + 60 + 6) = 213, less " +1" (18) = 195 → 31 P and the ellipsis (192),
        // then " +1" right after it (95 + 192), at 600.
        expect(svg).toMatch(new RegExp(`<text class="card-line-place" x="95.0"[^>]*textLength="192.0"[^>]*>${'P'.repeat(31)}…</text>`));
        expect(svg).toMatch(/<text class="card-line-more" x="287.0"[^>]*font-weight="600"[^>]*xml:space="preserve"[^>]*textLength="18.0"[^>]*> \+1<\/text>/);
    });

    it('only the place shortens; the date and "+1" stay whole', () => {
        const a: Person = { id: 'a' as PersonId, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [] };
        const data: StromData = { persons: { [a.id]: a }, partnerships: {} as Record<PartnershipId, never> };
        const layout: PosterLayout = { positions: new Map([[a.id, { x: 0, y: 0 }]]), connections: [], spouseLines: [] };
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 320, cardHeight: 73 } as never,
            cardLines: new Map([['a', [line('14. 11. 1919', 'P'.repeat(80), { more: '+1' })]]]), cardDateColumn: 72, measureCardTexts: measure,
        });
        expect(svg).toContain('>14. 11. 1919</text>');
        // Room: 320 − 12 − (12 + 17 + 72 + 6) = 201, less " +1" (18) = 183 → 29 characters and the ellipsis (30 × 6 = 180).
        expect(svg).toContain(`>${'P'.repeat(29)}…</text>`);
        expect(svg).toContain('> +1</text>');
    });

    it('"+1" is set at 600: measured in its own style, its row and the card\'s width count its own width', () => {
        // A "+1" at 600 a third wider than the place's text (8px a character instead of 6).
        const bold: MeasureTexts = (kind, texts) => {
            const out = new Map<string, number>();
            for (const t of texts) out.set(t, t.length * (kind === 'name' || kind === 'more' ? 8 : 6));
            return out;
        };
        const married = line('1888', 'p'.repeat(20), { key: 'marriage', more: '+1' });
        // 11 + 6 + 24 + 6 + 20 × 6 + " +1" (3 × 8 = 24) = 191 → 217 → 220 (one place style for all: 212).
        expect(customCardMetrics([{ name: 'A', avatar: true, lines: [married] }], bold).cardWidth).toBe(220);
        // 66px: "Dolní" (30) + " +1" (24) = 54 fits; "Dolní Lhota" (66) + 24 does not.
        expect(wrapCardText({ text: 'Dolní Lhota', tail: ' +1', width: 66, maxLines: 0 }, bold))
            .toEqual({ rows: [{ text: 'Dolní' }, { text: 'Lhota', tail: ' +1' }], cut: false });
        // 84px: "Dolní Lhota" (66) + 18 at the place's weight would fit; at 600 (24) it does not.
        expect(wrapCardText({ text: 'Dolní Lhota', tail: ' +1', width: 84, maxLines: 1 }, bold))
            .toEqual({ rows: [{ text: 'Dolní Lho…', tail: ' +1' }], cut: true });
        // The image export draws it at 600, right after the place, at its own width.
        const a: Person = { id: 'a' as PersonId, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [] };
        const data: StromData = { persons: { [a.id]: a }, partnerships: {} as Record<PartnershipId, never> };
        const layout: PosterLayout = { positions: new Map([[a.id, { x: 0, y: 0 }]]), connections: [], spouseLines: [] };
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 220, cardHeight: 73 } as never,
            cardLines: new Map([['a', [married]]]), cardDateColumn: 24, measureCardTexts: bold,
        });
        // The place at 12 + 11 + 6 + 24 + 6 = 59, 120px wide; "+1" at 179, 24px wide.
        expect(svg).toMatch(new RegExp(`<text class="card-line-place" x="59.0"[^>]*textLength="120.0"[^>]*>${'p'.repeat(20)}</text>`));
        expect(svg).toMatch(/<text class="card-line-more" x="179.0" [^>]*font-weight="600"[^>]*textLength="24.0"[^>]*> \+1<\/text>/);
    });
});

describe('wrapping a value into rows (U02)', () => {
    const wrap = (text: string, width: number, maxLines: 0 | 1 | 2, tail?: string) =>
        wrapCardText({ text, width, maxLines, ...(tail ? { tail } : {}) }, measure);
    const texts = (r: { rows: { text: string; tail?: string }[] }) => r.rows.map(x => x.text + (x.tail ?? ''));

    it('a text that fits is one row; nothing is no row; an empty text with "+1" is the "+1" alone', () => {
        expect(wrap('Brno', 60, 0)).toEqual({ rows: [{ text: 'Brno' }], cut: false });
        expect(wrap('Brno', 60, 1)).toEqual({ rows: [{ text: 'Brno' }], cut: false });
        expect(wrap('', 60, 0)).toEqual({ rows: [], cut: false });
        expect(wrap('', 60, 2, ' +1')).toEqual({ rows: [{ text: '', tail: ' +1' }], cut: false });
    });

    it('breaks after a space, keeping as much as fits on a row', () => {
        // 10 characters a row at 6px.
        expect(texts(wrap('aaaa bbbb cccc', 60, 0))).toEqual(['aaaa bbbb', 'cccc']);
        expect(texts(wrap('aaaa bbbb cccc', 30, 0))).toEqual(['aaaa', 'bbbb', 'cccc']);
        // A row never starts with the spaces it broke at.
        expect(texts(wrap('aaaa    bbbb', 30, 0))).toEqual(['aaaa', 'bbbb']);
    });

    it('breaks after "-", "–" and "/" too (the sign stays on the first row), not after other signs', () => {
        expect(texts(wrap('Frýdek-Místek', 50, 0))).toEqual(['Frýdek-', 'Místek']);
        expect(texts(wrap('aaaa–bbbb', 30, 0))).toEqual(['aaaa–', 'bbbb']);
        expect(texts(wrap('aaaa/bbbb', 30, 0))).toEqual(['aaaa/', 'bbbb']);
        // A comma or a dot is no break: the word is wider than the column and breaks by characters.
        expect(texts(wrap('aaaa.bbbb', 30, 0))).toEqual(['aaaa.', 'bbbb']);
        expect(texts(wrap('aaa.bbbbbb', 30, 0))).toEqual(['aaa.b', 'bbbbb']);
    });

    it('a word wider than the column breaks by characters only when the whole text is shown', () => {
        expect(wrap('x'.repeat(25), 60, 0)).toEqual({ rows: [{ text: 'x'.repeat(10) }, { text: 'x'.repeat(10) }, { text: 'x'.repeat(5) }], cut: false });
        // Limited to rows: the text stops at that word with "…", even with a row to spare.
        expect(wrap('x'.repeat(25), 60, 2)).toEqual({ rows: [{ text: `${'x'.repeat(9)}…` }], cut: true });
        expect(wrap('x'.repeat(25), 60, 1)).toEqual({ rows: [{ text: `${'x'.repeat(9)}…` }], cut: true });
        expect(wrap(`aa ${'x'.repeat(25)}`, 60, 2)).toEqual({ rows: [{ text: 'aa' }, { text: `${'x'.repeat(9)}…` }], cut: true });
    });

    it('two rows: a third is never drawn, the second ends in "…" with as many characters as fit', () => {
        const r = wrap('aaaa bbbb cccc dddd', 30, 2);
        expect(r).toEqual({ rows: [{ text: 'aaaa' }, { text: 'bbbb…' }], cut: true });
        // Characters of the next word fill the row up to the ellipsis.
        expect(wrap('aaaa bb cccccccc', 30, 2)).toEqual({ rows: [{ text: 'aaaa' }, { text: 'bb c…' }], cut: true });
        // One row: today's shortening of the place.
        expect(wrap('aaaa bbbb cccc', 60, 1)).toEqual({ rows: [{ text: 'aaaa bbbb…' }], cut: true });
        expect(wrap('aaaa bbbb', 60, 2)).toEqual({ rows: [{ text: 'aaaa bbbb' }], cut: false });
    });

    it('"+1" stays glued to the last word and is never cut', () => {
        // "Dolní Lhota" alone fits 66px, with " +1" it does not: the last word goes down with it.
        expect(wrap('Dolní Lhota', 66, 0, ' +1')).toEqual({ rows: [{ text: 'Dolní' }, { text: 'Lhota', tail: ' +1' }], cut: false });
        // Shortened, the place ends in "…" and "+1" follows whole.
        expect(wrap('Dolní Lhota', 60, 1, ' +1')).toEqual({ rows: [{ text: 'Dolní…', tail: ' +1' }], cut: true });
        expect(wrap('aaaa bbbb cccc dddd', 30, 2, ' +1')).toEqual({ rows: [{ text: 'aaaa' }, { text: 'b…', tail: ' +1' }], cut: true });
        // A long last word broken by characters: "+1" goes with its end, at least one character of it.
        expect(texts(wrap('x'.repeat(12), 60, 0, ' +1'))).toEqual(['x'.repeat(10), 'xx +1']);
        expect(texts(wrap('x'.repeat(10), 60, 0, ' +1'))).toEqual(['x'.repeat(9), 'x +1']);
    });

    it('no row is wider than its column, whatever the width; every word is kept when whole', () => {
        const text = 'Nové Město na Moravě, okres Žďár nad Sázavou/Vysočina, Frýdek-Místek – Česká republika';
        for (let width = 30; width <= 300; width += 7) {
            const whole = wrap(text, width, 0);
            for (const row of whole.rows) expect(row.text.length * 6).toBeLessThanOrEqual(width);
            expect(whole.rows.map(r => r.text).join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
            const two = wrap(text, width, 2);
            expect(two.rows.length).toBeLessThanOrEqual(2);
            for (const row of two.rows) expect(row.text.length * 6).toBeLessThanOrEqual(width);
            expect(two.cut).toBe(text.length * 6 > 2 * width || two.rows[two.rows.length - 1].text.endsWith('…'));
        }
    });

    it('wraps every text of a view together: one measuring batch a round, not a call per text', () => {
        let calls = 0;
        const counting: MeasureTexts = (kind, t) => { calls++; return measure(kind, t); };
        const requests: WrapRequest[] = Array.from({ length: 50 }, (_, i) => ({ text: `aaaa bbbb cccc ${i}`, width: 30, maxLines: 0 }));
        const results = wrapCardTexts(requests, counting);
        expect(results.every(r => r.rows.length === 4)).toBe(true);
        expect(calls).toBe(4);
    });
});

describe('the rows and the height of the custom card (U02)', () => {
    // Width 200: room 174; "1919" makes a 24px date column, so the place column is 174 − 47 = 127 (21 characters).
    const death = line('1919', 'Horní Lhota, čp. 13 · náhlé zapálení mozkových blan', {
        key: 'death', mark: '†', place: 'Horní Lhota, čp. 13', cause: 'náhlé zapálení mozkových blan',
    });
    const birth = line('1862', 'Brno');
    const entries: CustomCardEntry[] = [{ name: 'Jan Vlk', avatar: true, lines: [birth, death] }];
    const metrics = { cardWidth: 200, dateColumn: 24 };

    it('whole: the place wraps in its column and the cause takes rows of its own under it', () => {
        const { rows, heights } = customCardRows(entries, metrics, measure, 0);
        expect(rows.get(death)).toEqual({
            rows: [{ text: 'Horní Lhota, čp. 13' }, { text: 'náhlé zapálení', cause: true }, { text: 'mozkových blan', cause: true }],
            cut: false,
        });
        expect(rows.get(birth)).toEqual({ rows: [{ text: 'Brno' }], cut: false });
        // 50 header + 6 + 4 rows × 17 + 3 between the two details.
        expect(heights).toEqual([50 + 6 + 4 * 17 + 3]);
    });

    it('two rows: the cause after the place with " · ", the second row ends in "…"', () => {
        const { rows, heights } = customCardRows(entries, metrics, measure, 2);
        expect(rows.get(death)).toEqual({ rows: [{ text: 'Horní Lhota, čp. 13 ·' }, { text: 'náhlé zapálení mozko…' }], cut: true });
        expect(heights).toEqual([50 + 6 + 3 * 17 + 3]);
    });

    it('one row: the line shortens, the card keeps today\'s height', () => {
        const { rows } = customCardRows(entries, metrics, measure, 1);
        expect(rows.get(death)!.cut).toBe(true);
        expect(rows.get(death)!.rows).toHaveLength(1);
        expect(customCardViewHeight(3, 1, [500])).toBe(107);
        expect(customCardViewHeight(7, 1, [])).toBe(175);
    });

    it('one row by content: a card is its header and 17px a detail, no gap between details (U02 V3)', () => {
        const { heights } = customCardRows([...entries, { name: 'Bez údajů', avatar: true, lines: [] }], metrics, measure, 1);
        // Two details: 50 + 6 + 2 × 17, the one-row card of before with two lines; no lines: the header alone.
        expect(heights).toEqual([56 + 2 * 17, 50]);
        expect(customCardHeight([1, 1], 30, 0)).toBe(90);
    });

    it('the occupation wraps from the date column; the whole cause counts alone for the width', () => {
        const job = { key: 'occupation' as const, mark: '', text: '', spoken: '', date: '', rest: 'mlynář a hostinský v Dolní Lhotě u kostela', wide: true };
        // 174 − 17 = 157: 26 characters.
        const { rows } = customCardRows([{ name: 'A', avatar: true, lines: [job] }], metrics, measure, 0);
        expect(rows.get(job)!.rows.map(r => r.text)).toEqual(['mlynář a hostinský v Dolní', 'Lhotě u kostela']);
        // Whole: the widest piece is the cause (29 × 6 = 174) → 47 + 174 = 221 → 247 → 248;
        // one row: "place · cause" (51 × 6 = 306) → past the cap.
        expect(customCardMetrics(entries, measure, 320, 0).cardWidth).toBe(248);
        expect(customCardMetrics(entries, measure, 320, 1).cardWidth).toBe(320);
    });

    it('the card height: the header alone, else 6px, 17px a row and 3px between details', () => {
        expect(customCardHeight([])).toBe(50);
        expect(customCardHeight([1])).toBe(73);
        expect(customCardHeight([1, 1, 1])).toBe(56 + 51 + 6);
        expect(customCardHeight([0, 3])).toBe(56 + 4 * 17 + 3);
    });

    it('the view\'s height: the tallest card when details wrap, today\'s formula for one row', () => {
        expect(customCardViewHeight(3, 0, [73, 127, 90])).toBe(127);
        expect(customCardViewHeight(3, 2, [73])).toBe(73);
        expect(customCardViewHeight(3, 0, [])).toBe(50);
    });

    it('the partner line: the card\'s middle on the one-row card, 25px (the header) on a card that grows', () => {
        expect(customCardSpouseLineY(1)).toBeUndefined();
        expect(customCardSpouseLineY(2)).toBe(25);
        expect(customCardSpouseLineY(0)).toBe(25);
        // Each card its own height: the header even on the one-row card (decision D).
        expect(customCardSpouseLineY(1, false, 'content')).toBe(25);
        expect(customCardSpouseLineY(1, true, 'content')).toBe(26.5);
        expect(customCardSpouseLineY(1, false, 'view')).toBeUndefined();
    });

    it('the card draws the rows as they are: each its own element, "+1" in the last, a title when it ended in "…"', () => {
        const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
        const { rows } = customCardRows(entries, metrics, measure, 2);
        const html = cardLineHtml(death, esc, false, rows.get(death));
        expect(html).toContain('class="card-line card-line--death card-line--rows"');
        expect([...html.matchAll(/<span class="card-line-row">([^<]*)<\/span>/g)].map(m => m[1]))
            .toEqual(['Horní Lhota, čp. 13 ·', 'náhlé zapálení mozko…']);
        expect(html).toContain(`<span class="card-line-place" title="${death.rest}">`);
        const whole = customCardRows(entries, metrics, measure, 0).rows.get(death)!;
        const wholeHtml = cardLineHtml(death, esc, false, whole);
        expect(wholeHtml).not.toContain('title=');
        expect(wholeHtml.match(/card-line-row--cause/g)).toHaveLength(2);
        const married = line('1888', 'Dolní Lhota', { key: 'marriage', mark: '⚭', more: '+1' });
        const m = customCardRows([{ name: 'A', avatar: true, lines: [married] }], metrics, measure, 0).rows.get(married)!;
        expect(cardLineHtml(married, esc, false, m)).toContain('<span class="card-line-row">Dolní Lhota<span class="card-line-more"> +1</span></span>');
    });
});

describe('the poster draws the wrapped card like the screen (U02)', () => {
    beforeEach(() => setLanguage('en'));
    const a: Person = { id: 'a' as PersonId, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [] };
    const data: StromData = { persons: { [a.id]: a }, partnerships: {} as Record<PartnershipId, never> };
    const layout: PosterLayout = { positions: new Map([[a.id, { x: 0, y: 0 }]]), connections: [], spouseLines: [] };
    const death = line('1919', 'Horní Lhota, čp. 13 · náhlé zapálení mozkových blan', {
        key: 'death', mark: '†', place: 'Horní Lhota, čp. 13', cause: 'náhlé zapálení mozkových blan',
    });
    const job = { key: 'occupation' as const, mark: '', text: '', spoken: '', date: '', rest: 'mlynář', wide: true };
    const places = (svg: string) => [...svg.matchAll(/<text class="card-line-place" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
        .map(m => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));

    it('whole: one text a row in the place column, the cause on rows of its own, 3px before the next detail', () => {
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 200, cardHeight: 50 + 6 + 4 * 17 + 3 } as never,
            cardLines: new Map([['a', [death, job]]]), cardDateColumn: 24, measureCardTexts: measure, cardValueLines: 0,
        });
        expect(svg).toMatch(/<rect x="0.0" y="0.0" width="200" height="127" rx="8"/);
        // Place column at 12 + 17 + 24 + 6 = 59; rows 17px apart from 46 + 12.5.
        expect(places(svg)).toEqual([
            { x: 59, y: 58.5, text: 'Horní Lhota, čp. 13' },
            { x: 59, y: 75.5, text: 'náhlé zapálení' },
            { x: 59, y: 92.5, text: 'mozkových blan' },
            // The occupation: 3 rows and 3px later, from the date column.
            { x: 29, y: 112.5, text: 'mlynář' },
        ]);
        expect(svg).toMatch(/<text class="card-line-date" x="29.0" y="58.5"[^>]*>1919<\/text>/);
        // No row is drawn shortened per character any more.
        expect(svg).not.toContain('…');
    });

    it('two rows: the second ends in "…" and no third is drawn', () => {
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 200, cardHeight: 90 } as never,
            cardLines: new Map([['a', [death]]]), cardDateColumn: 24, measureCardTexts: measure, cardValueLines: 2,
        });
        expect(places(svg).map(p => p.text)).toEqual(['Horní Lhota, čp. 13 ·', 'náhlé zapálení mozko…']);
    });
});

describe('a long date does not widen the date column (U02)', () => {
    beforeEach(() => setLanguage('cs'));
    const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    // "15. 6. 1797": 66px; the range of whole dates: 25 × 6 = 150px; the place 22 × 6 = 132px.
    const normal = line('15. 6. 1797', 'Brno');
    const range = line('22. 11. 1790–28. 12. 1795', 'Horní Lhota u Bystřice', { key: 'death', mark: '†' });
    const entries: CustomCardEntry[] = [
        { name: 'Jan Vlk', avatar: true, lines: [line('1862', 'Brno')] },
        { name: 'Anna', avatar: true, lines: [normal, range] },
    ];
    const refs = () => cardDateReferences(true);
    const texts = (r: { rows: { text: string; tail?: string }[] }) => r.rows.map(x => x.text + (x.tail ?? ''));

    it('the ordinary dates of each language and date setting', () => {
        expect(cardDateReferences(true)).toEqual(['28. 12. 1888', 'kolem 1888', 'před 1888', 'po 1888', '1888–1888']);
        expect(cardDateReferences(false)).toEqual(['1888', 'kolem 1888', 'před 1888', 'po 1888', '1888–1888']);
        setLanguage('en');
        expect(cardDateReferences(true)).toEqual(['12/28/1888', 'c. 1888', 'before 1888', 'after 1888', '1888–1888']);
        expect(cardDateReferences(false)).toEqual(['1888', 'c. 1888', 'before 1888', 'after 1888', '1888–1888']);
        setLanguage('de');
        expect(cardDateReferences(true)).toEqual(['28.12.1888', 'um 1888', 'vor 1888', 'nach 1888', '1888–1888']);
        expect(cardDateReferences(false)).toEqual(['1888', 'um 1888', 'vor 1888', 'nach 1888', '1888–1888']);
    });

    it('the column is the widest date under the widest ordinary date: a range of whole dates does not widen it', () => {
        expect(customCardMetrics(entries, measure, 320, 0, 'marks', refs()).dateColumn).toBe(66);
        // Without the limit (as before) the range set the column for every card.
        expect(customCardMetrics(entries, measure, 320, 0).dateColumn).toBe(150);
        // An ordinary date as wide as the limit still sets the column, exactly.
        const widest = [{ name: 'A', avatar: true, lines: [line('28. 12. 1888', 'Brno'), range] }];
        expect(customCardMetrics(widest, measure, 320, 0, 'marks', refs()).dateColumn).toBe(72);
        // "about" a whole date and a text that is no date are long too.
        const about = [{ name: 'A', avatar: true, lines: [normal, line('kolem 22. 11. 1797', 'Brno'), line('zima roku 1790 (nejisté)', 'Brno')] }];
        expect(customCardMetrics(about, measure, 320, 0, 'marks', refs()).dateColumn).toBe(66);
    });

    it('the limit per language and date setting: cs 72 / 60, en 66 / 66, de 60 / 54 (6px a character)', () => {
        const all = (full: boolean) => [{ name: 'A', avatar: true, lines: [
            ...cardDateReferences(full).map(d => line(d, 'Brno')), line('x'.repeat(30), 'Brno'),
        ] }];
        const column = (full: boolean) => customCardMetrics(all(full), measure, 320, 0, 'marks', cardDateReferences(full)).dateColumn;
        expect([column(true), column(false)]).toEqual([72, 60]);
        setLanguage('en');
        expect([column(true), column(false)]).toEqual([66, 66]);
        setLanguage('de');
        expect([column(true), column(false)]).toEqual([60, 54]);
        // Years only, a range of whole dates is a range of years: an ordinary date.
        setLanguage('cs');
        expect(cardDate('1790-11-22..1795-12-28', false)).toBe('1790–1795');
        expect(cardDate('1790-11-22..1795-12-28', true)).toBe('22. 11. 1790–28. 12. 1795');
    });

    it('whole: the long date takes the first row alone, the place goes on under it in the place column', () => {
        const metrics = customCardMetrics(entries, measure, 320, 0, 'marks', refs());
        // The long date's row: 17 + 150 = 167; the place under it: 89 + 132 = 221 → 247 → 248.
        expect(metrics).toEqual({ cardWidth: 248, dateColumn: 66 });
        const { rows, heights } = customCardRows(entries, metrics, measure, 0);
        expect(rows.get(range)).toEqual({ rows: [{ text: '' }, { text: 'Horní Lhota u Bystřice' }], cut: false, longDate: true });
        expect(rows.get(normal)).toEqual({ rows: [{ text: 'Brno' }], cut: false });
        // Anna: 1 + 2 rows, 3px between the details.
        expect(heights[1]).toBe(50 + 6 + 3 * 17 + 3);
        // On a narrower card the place wraps in its column (174 − 89 = 85: 14 characters).
        const narrow = customCardRows(entries, { cardWidth: 200, dateColumn: 66 }, measure, 0).rows.get(range)!;
        expect(texts(narrow)).toEqual(['', 'Horní Lhota u', 'Bystřice']);
        expect(narrow.cut).toBe(false);
    });

    it('two rows: the place has the one row under the date, ending in "…"', () => {
        const r = customCardRows(entries, { cardWidth: 200, dateColumn: 66 }, measure, 2).rows.get(range)!;
        expect(r).toEqual({ rows: [{ text: '' }, { text: 'Horní Lhota u…' }], cut: true, longDate: true });
        // A place that fits stays whole.
        const fits = customCardRows(entries, { cardWidth: 248, dateColumn: 66 }, measure, 2).rows.get(range)!;
        expect(texts(fits)).toEqual(['', 'Horní Lhota u Bystřice']);
        expect(fits.cut).toBe(false);
    });

    it('one row: the place follows the date 6px after it and shortens; the width counts the whole row', () => {
        const metrics = customCardMetrics(entries, measure, 320, 1, 'marks', refs());
        // 17 + 150 + 6 + 132 = 305 → past the medium cap.
        expect(metrics).toEqual({ cardWidth: 320, dateColumn: 66 });
        expect(customCardMetrics(entries, measure, 400, 1, 'marks', refs()).cardWidth).toBe(332);
        // Room 294 − 173 = 121: 19 characters and "…".
        const r = customCardRows(entries, metrics, measure, 1).rows.get(range)!;
        expect(r).toEqual({ rows: [{ text: 'Horní Lhota u Bystř…' }], cut: true, longDate: true });
        expect([...customCardCutLines(entries, metrics, measure)]).toEqual([range]);
        expect(customCardCutLines(entries, { cardWidth: 332, dateColumn: 66 }, measure).size).toBe(0);
    });

    it('the labels style is not affected: no date column, the same label column and rows', () => {
        const a = customCardMetrics(entries, measure, 320, 0, 'labels', refs());
        expect(a).toEqual(customCardMetrics(entries, measure, 320, 0, 'labels'));
        expect(a.dateColumn).toBe(0);
        const withRefs = customCardRows(entries, a, measure, 0, 'labels').rows.get(range)!;
        expect(withRefs.longDate).toBeUndefined();
        expect(withRefs.rows[0].date).toBe('22. 11. 1790–28. 12. 1795');
    });

    it('the card draws the long date across both columns: the place\'s rows under it, the one-row place after it', () => {
        const metrics = { cardWidth: 200, dateColumn: 66 };
        const whole = customCardRows(entries, metrics, measure, 0).rows.get(range)!;
        const html = cardLineHtml(range, esc, false, whole, 'marks', true);
        expect(html).toContain('class="card-line card-line--death card-line--rows card-line--longdate"');
        expect(html).toContain('<span class="card-line-date">22. 11. 1790–28. 12. 1795</span>');
        // The empty first row is the date's: not drawn in the place column.
        expect([...html.matchAll(/<span class="card-line-row">([^<]*)<\/span>/g)].map(m => m[1])).toEqual(['Horní Lhota u', 'Bystřice']);
        expect(html).not.toContain('title=');
        const two = customCardRows(entries, metrics, measure, 2).rows.get(range)!;
        expect(cardLineHtml(range, esc, false, two, 'marks', true)).toContain(`<span class="card-line-place" title="${range.rest}">`);
        const one = cardLineHtml(range, esc, true, undefined, 'marks', true);
        expect(one).toContain('class="card-line card-line--death card-line--longdate"');
        expect(one).toContain(`<span class="card-line-rest" title="${range.rest}">`);
        // An ordinary line and the labels style carry no such class.
        expect(cardLineHtml(normal, esc, false, undefined, 'marks', false)).not.toContain('longdate');
        expect(cardLineHtml(range, esc, false, undefined, 'labels', true)).not.toContain('longdate');
    });

    it('the poster draws the same: the place under the long date (rows) or 6px after it (one row)', () => {
        const a: Person = { id: 'a' as PersonId, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [] };
        const data: StromData = { persons: { [a.id]: a }, partnerships: {} as Record<PartnershipId, never> };
        const layout: PosterLayout = { positions: new Map([[a.id, { x: 0, y: 0 }]]), connections: [], spouseLines: [] };
        const draw = (cardWidth: number, cardValueLines: 0 | 1 | 2) => buildTreeSvg(data, layout, {
            config: { cardWidth, cardHeight: 110 } as never, cardLines: new Map([['a', [normal, range]]]),
            cardDateColumn: 66, measureCardTexts: measure, cardValueLines,
        });
        const placesOf = (svg: string) => [...svg.matchAll(/<text class="card-line-place" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
            .map(m => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
        // Whole: the dates at 12 + 17 = 29, places at 29 + 66 + 6 = 101; the range's line from 46 + 17 + 3 = 66.
        const whole = draw(248, 0);
        expect(whole).toMatch(/<text class="card-line-date" x="29.0" y="78.5"[^>]*>22. 11. 1790–28. 12. 1795<\/text>/);
        expect(placesOf(whole)).toEqual([
            { x: 101, y: 58.5, text: 'Brno' },
            { x: 101, y: 95.5, text: 'Horní Lhota u Bystřice' },
        ]);
        expect(placesOf(draw(200, 2))[1]).toEqual({ x: 101, y: 95.5, text: 'Horní Lhota u…' });
        // One row: the place on the date's row, 29 + 150 + 6 = 185, shortened as on screen.
        expect(placesOf(draw(320, 1))).toEqual([
            { x: 101, y: 58.5, text: 'Brno' },
            { x: 185, y: 75.5, text: 'Horní Lhota u Bystř…' },
        ]);
    });
});
