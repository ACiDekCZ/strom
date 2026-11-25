import { describe, expect, it } from 'vitest';
import { placeMenuVertically } from '../ui/menu-place';

describe('placeMenuVertically', () => {
    const view = 900;

    it('opens under the button when the menu fits there', () => {
        expect(placeMenuVertically({ top: 100, bottom: 130 }, 300, view)).toEqual({ top: 134, maxHeight: null });
    });

    it('opens over a button near the bottom when the menu fits there', () => {
        expect(placeMenuVertically({ top: 800, bottom: 830 }, 300, view)).toEqual({ top: 496, maxHeight: null });
    });

    it('takes the side with more room when it fits on neither, upwards near the bottom', () => {
        // 58 px under the button, 788 over it: the menu goes up, as high as that room.
        const p = placeMenuVertically({ top: 800, bottom: 830 }, 884, view);
        expect(p).toEqual({ top: 8, maxHeight: 788 });
        expect(p.top + p.maxHeight!).toBeLessThanOrEqual(800 - 4);
    });

    it('stays under the button when there is more room under it', () => {
        expect(placeMenuVertically({ top: 300, bottom: 330 }, 884, view)).toEqual({ top: 334, maxHeight: 558 });
    });

    it('takes the window height when both sides are small', () => {
        const p = placeMenuVertically({ top: 120, bottom: 150 }, 400, 300);
        expect(p.top).toBeGreaterThanOrEqual(8);
        expect(p.top + (p.maxHeight ?? 400)).toBeLessThanOrEqual(292);
    });
});
