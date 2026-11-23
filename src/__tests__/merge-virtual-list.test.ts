/**
 * Step 3's list draws only the rows near the view (spec 134 §13h): with
 * 3 000 new people at most about a hundred rows are in the page, and the
 * spacers keep the scroll bar as long as the whole list.
 */

import { describe, it, expect } from 'vitest';
import { VIRTUAL_OVERSCAN, visibleWindow } from '../merge/virtual-list.js';

const ROW = 32;

describe('visibleWindow', () => {
    it('3 000 rows in a 600 px view: at most 100 drawn, at the top and anywhere down the list', () => {
        for (const scrollTop of [0, 5_000, 47_000, 3000 * ROW - 600]) {
            const w = visibleWindow(3000, ROW, scrollTop, 600);
            expect(w.end - w.start).toBeLessThanOrEqual(100);
            expect(w.end - w.start).toBeGreaterThan(600 / ROW);
            // The rows in view are among the drawn ones.
            const first = Math.floor(scrollTop / ROW);
            expect(w.start).toBeLessThanOrEqual(first);
            expect(w.end).toBeGreaterThanOrEqual(Math.min(3000, first + Math.ceil(600 / ROW)));
            // The spacers and the drawn rows make the whole list's height.
            expect(w.padTop + (w.end - w.start) * ROW + w.padBottom).toBe(3000 * ROW);
        }
    });

    it('draws 40 rows above and below the view where there are any', () => {
        const w = visibleWindow(3000, ROW, 100 * ROW, 10 * ROW);
        expect(w.start).toBe(100 - VIRTUAL_OVERSCAN);
        expect(w.end).toBe(100 + 11 + VIRTUAL_OVERSCAN);
        const top = visibleWindow(3000, ROW, 0, 10 * ROW);
        expect(top.start).toBe(0);
        expect(top.padTop).toBe(0);
    });

    it('a short list is drawn whole; an empty one or a scroll past the end draws nothing beyond it', () => {
        expect(visibleWindow(20, ROW, 0, 600)).toEqual({ start: 0, end: 20, padTop: 0, padBottom: 0 });
        expect(visibleWindow(0, ROW, 0, 600)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
        const past = visibleWindow(50, ROW, 99_999, 600);
        expect(past.end).toBe(50);
        expect(past.start).toBeGreaterThanOrEqual(0);
        expect(past.padBottom).toBe(0);
    });
});
