/**
 * The custom card's width (src/card-width.ts, T04/T12) and its date column
 * (T05), and the poster drawing them (src/export-image.ts). Widths come from
 * a made-up measure, so the arithmetic is checked exactly. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { customCardWidth, customCardMetrics, MeasureTexts, CustomCardEntry } from '../card-width.js';
import { cardLines, normalizeCardFields, DEFAULT_CARD_FIELDS } from '../card-fields.js';
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
