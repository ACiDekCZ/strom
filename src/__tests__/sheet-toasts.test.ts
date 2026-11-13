/**
 * A toast coming while a bottom sheet is open stands over the backdrop, its
 * bottom edge 8 px over the sheet's top edge; beside a sheet at the side (a
 * phone held sideways) in the room left of it; where the room above a sheet
 * across the window is too low for it, at the window's top
 * (src/sheet-toasts.ts).
 */

import { describe, it, expect } from 'vitest';
import { placeOverSheet, pressOnToast } from '../sheet-toasts.js';

describe('where a toast stands over an open sheet', () => {
    it('8 px over the sheet\'s top edge (a phone upright, a tablet)', () => {
        // 844 tall, the sheet from 697: the toast's bottom edge at 689
        expect(placeOverSheet({ left: 0, top: 697 }, 62, 844)).toEqual({ bottom: 844 - 689, left: null, maxWidth: null });
        // 768 tall, a sheet 560 wide in the middle from 400
        expect(placeOverSheet({ left: 232, top: 400 }, 44, 768)).toEqual({ bottom: 768 - 392, left: null, maxWidth: null });
    });

    it('just room enough above the sheet: still over it', () => {
        // 8 + 44 + 8 = 60: the toast from 8 to 52
        expect(placeOverSheet({ left: 0, top: 60 }, 44, 390).bottom).toBe(390 - 52);
    });

    it('a sheet at the side over the whole height: in the middle of the room left of it, at its own height', () => {
        // 844 × 390, the person sheet 360 wide at the right
        expect(placeOverSheet({ left: 484, top: 0 }, 44, 390)).toEqual({ bottom: null, left: 242, maxWidth: 452 });
    });

    it('too low a room above a sheet across the window: at the window\'s top', () => {
        expect(placeOverSheet({ left: 0, top: 59 }, 44, 390)).toEqual({ bottom: 390 - 8 - 44, left: null, maxWidth: null });
        expect(placeOverSheet({ left: 142, top: 20 }, 62, 390).bottom).toBe(390 - 8 - 62);
    });

    it('never below the window\'s bottom edge', () => {
        expect(placeOverSheet({ left: 0, top: 10 }, 500, 390).bottom).toBe(0);
    });

    it('a press counts as on a toast only inside one', () => {
        expect(pressOnToast(null)).toBe(false);
        expect(pressOnToast({} as EventTarget)).toBe(false);
        expect(pressOnToast({ closest: (sel: string) => sel.includes('.undo-toast') ? {} : null } as unknown as EventTarget)).toBe(true);
    });
});
