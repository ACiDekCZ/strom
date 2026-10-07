/**
 * The custom card's width (src/card-width.ts, T04/T12) and its date column
 * (T05), and the poster drawing them (src/export-image.ts). Widths come from
 * a made-up measure, so the arithmetic is checked exactly. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { customCardWidth, customCardMetrics, customCardCutLines, MeasureTexts, CustomCardEntry } from '../card-width.js';
import { cardLines, cardLineHtml, normalizeCardFields, DEFAULT_CARD_FIELDS } from '../card-fields.js';
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
        // Room: 320 − 12 − (12 + 17 + 60 + 6) = 213, less " +1" (18) = 195 → 31 P and the ellipsis (192) + 18 = 210.
        expect(svg).toMatch(new RegExp(`<text class="card-line-place"[^>]*textLength="210.0"[^>]*>${'P'.repeat(31)}… \\+1</text>`));
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
        expect(svg).toContain(`>${'P'.repeat(29)}… +1</text>`);
    });
});
