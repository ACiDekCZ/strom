/**
 * A long name on the Normal and the Detailed card goes on as many rows as it
 * needs and the card grows (T40); the Compact card keeps its one row and the
 * Register and Custom cards two at most. Widths come from a made-up measure,
 * so the arithmetic is checked exactly. Invented names.
 */

import { describe, it, expect } from 'vitest';
import {
    MeasureTexts, normalCardNameRows, normalCardHeight, normalCardHeights, rowSeparators, cardNameMaxRows,
    customCardRows, CustomCardEntry, NORMAL_CARD_HEIGHT, NORMAL_CARD_NAME_WIDTH, CARD_NAME_ROW_HEIGHT, CARD_AVATAR_SIZE,
} from '../card-width.js';

/** 6px a character at the Normal card's 12.5px name (21 characters fill its 126px column), 8px at the 15px one. */
const measure: MeasureTexts = (kind, texts) => {
    const out = new Map<string, number>();
    for (const t of texts) out.set(t, Array.from(t).length * (kind === 'nameSmall' ? 6 : kind === 'name' ? 8 : 6));
    return out;
};

const rowsOf = (given: string, surname: string, avatar = true) =>
    normalCardNameRows([{ given, surname, avatar }], measure)[0];

describe('the Normal card name on rows (T40)', () => {
    it('a short name keeps one row a part and the 64px card', () => {
        expect(rowsOf('Kasimir', 'Krummhorn')).toEqual({ given: ['Kasimir'], surname: ['Krummhorn'] });
        expect(normalCardHeight(2)).toBe(NORMAL_CARD_HEIGHT);
        expect(normalCardHeight(1)).toBe(64);
        const heights = normalCardHeights(new Map([['a', { given: 'Kasimir', surname: 'Krummhorn', avatar: true }]]), measure);
        expect(heights).toBeNull();
    });

    it('a name of three rows and more makes the card taller, never shortened', () => {
        // 30 characters of given names (180px) do not fit the 126px column: two rows.
        const rows = rowsOf('Rosamunda Theodolinda Adalgisa', 'Kolodziejczyk');
        expect(rows.given).toEqual(['Rosamunda Theodolinda', 'Adalgisa']);
        expect(rows.surname).toEqual(['Kolodziejczyk']);
        expect([...rows.given, ...rows.surname].join(' ')).not.toContain('…');
        for (const r of [...rows.given, ...rows.surname]) expect(r.length * 6).toBeLessThanOrEqual(NORMAL_CARD_NAME_WIDTH);
        expect(normalCardHeight(3)).toBe(64 + 15);          // 14.375 rounded up
        expect(normalCardHeight(5)).toBe(64 + 44);          // 3 × 14.375 = 43.125
        const heights = normalCardHeights(new Map([
            ['long', { given: 'Rosamunda Theodolinda Adalgisa', surname: 'Kolodziejczyk', avatar: true }],
            ['short', { given: 'Kordula', surname: 'Krummhorn', avatar: true }],
        ]), measure);
        expect(heights).toEqual(new Map([['long', 79]]));
    });

    it('one long word without spaces breaks between characters and reads whole', () => {
        const surname = 'Wolfeschlegelsteinhausenbergerdorffvonkrummhorn';   // 47 characters = 282px
        const rows = rowsOf('Florimund', surname);
        expect(rows.surname.length).toBe(3);
        expect(rows.surname.join('')).toBe(surname);
        for (const r of rows.surname) expect(r.length * 6).toBeLessThanOrEqual(NORMAL_CARD_NAME_WIDTH);
        expect(rowSeparators(surname, rows.surname)).toEqual(['', '']);
        expect(normalCardHeight(rows.given.length + rows.surname.length)).toBe(64 + 29);   // 2 × 14.375 = 28.75
    });

    it('a card without an avatar (a placeholder) has the wider 168px column', () => {
        const name = 'Florimund Kasimir Eulalio';   // 25 characters = 150px: over 126, under 168
        expect(rowsOf(name, '', true).given.length).toBe(2);
        expect(rowsOf(name, '', false).given).toEqual([name]);
        expect(rowsOf(name, '', false).surname).toEqual([]);
    });

    it('the rows are put back together with the space they broke at', () => {
        expect(rowSeparators('Rosamunda Kordula Adalgisa', ['Rosamunda Kordula', 'Adalgisa'])).toEqual([' ']);
        expect(rowSeparators('Krummhorn-Grünwaldinger', ['Krummhorn-', 'Grünwaldinger'])).toEqual(['']);
        expect(rowSeparators('Kasimir', ['Kasimir'])).toEqual([]);
    });
});

describe('how many rows a card type gives the name (T40)', () => {
    it('Normal and Detailed the whole name, Register and Custom two, Compact one', () => {
        expect(cardNameMaxRows('normal')).toBe(0);
        expect(cardNameMaxRows('detailed')).toBe(0);
        expect(cardNameMaxRows('register')).toBe(2);
        expect(cardNameMaxRows('custom')).toBe(2);
        expect(cardNameMaxRows('compact')).toBe(1);
    });

    it('the Detailed card takes every row the name needs and grows; Custom stops at two with "…"', () => {
        // A 200px card: 174px inside, 136px beside the avatar = 17 characters at 8px.
        const entry: CustomCardEntry = { name: 'Rosamunda Theodolinda Adalgisa Kolodziejczyk', avatar: true, lines: [] };
        const metrics = { cardWidth: 200, dateColumn: 0 };
        const whole = customCardRows([entry], metrics, measure, 0, 'marks', cardNameMaxRows('detailed'));
        expect(whole.heads[0].name).toEqual(['Rosamunda', 'Theodolinda', 'Adalgisa', 'Kolodziejczyk']);
        expect(whole.heads[0].cut).toBe(false);
        expect(whole.heads[0].name.join(' ')).not.toContain('…');
        expect(whole.heads[0].block).toBe(4 * CARD_NAME_ROW_HEIGHT);
        const two = customCardRows([entry], metrics, measure, 0, 'marks', cardNameMaxRows('custom'));
        expect(two.heads[0].name.length).toBe(2);
        expect(two.heads[0].cut).toBe(true);
        expect(two.heads[0].name[1].endsWith('…')).toBe(true);
        expect(whole.heights[0]).toBe(two.heights[0] + 2 * CARD_NAME_ROW_HEIGHT);
        // A short name: one row, the avatar's height, the same on both.
        const short: CustomCardEntry = { name: 'Kordula Krummhorn', avatar: true, lines: [] };
        const a = customCardRows([short], metrics, measure, 0, 'marks', 0);
        const b = customCardRows([short], metrics, measure, 0, 'marks');
        expect(a.heads[0]).toEqual(b.heads[0]);
        expect(a.heads[0].block).toBe(CARD_AVATAR_SIZE);
    });

    it('a locked Detailed card keeps the lock\'s room beside its name', () => {
        // 136px beside the avatar: 17 characters (136px) fit; 10px of room less leaves 126px — they do not.
        const metrics = { cardWidth: 200, dateColumn: 0 };
        const entry: CustomCardEntry = { name: 'Florimund Kasimir', avatar: true, lines: [] };
        expect(customCardRows([entry], metrics, measure, 0, 'marks', 0).heads[0].name).toEqual(['Florimund Kasimir']);
        expect(customCardRows([{ ...entry, nameReserve: 10 }], metrics, measure, 0, 'marks', 0).heads[0].name)
            .toEqual(['Florimund', 'Kasimir']);
    });
});
