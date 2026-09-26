import { describe, it, expect } from 'vitest';
import { fitView, scaleLimits, clampView, zoomAt, panBy, zoomPercent, isFitted, FIT_MARGIN } from '../image-zoom.js';

// A wide register excerpt on a phone.
const box = { nw: 1200, nh: 240, vw: 390, vh: 844 };

describe('fitView', () => {
    it('fits the whole image, centred', () => {
        const v = fitView(box);
        expect(v.scale).toBeCloseTo((390 * FIT_MARGIN) / 1200);
        expect(v.x + 1200 * v.scale / 2).toBeCloseTo(195);
        expect(v.y + 240 * v.scale / 2).toBeCloseTo(422);
    });

    it('never enlarges a tiny image past 2×', () => {
        expect(fitView({ nw: 50, nh: 20, vw: 1440, vh: 900 }).scale).toBe(2);
    });
});

describe('zoomAt', () => {
    it('keeps the image point under the finger', () => {
        const v0 = fitView(box);
        const px = 100, py = 422;   // vertical centre: a strip shorter than the screen stays centred
        const u = (px - v0.x) / v0.scale, w = (py - v0.y) / v0.scale;
        const v1 = zoomAt(v0, 3, px, py, box);
        expect(v1.scale).toBeCloseTo(v0.scale * 3);
        expect(v1.x + u * v1.scale).toBeCloseTo(px);
        expect(v1.y + w * v1.scale).toBeCloseTo(py);
    });

    it('stops at the limits', () => {
        const { min, max } = scaleLimits(box);
        expect(zoomAt(fitView(box), 0.1, 0, 0, box).scale).toBeCloseTo(min);
        expect(zoomAt(fitView(box), 1000, 0, 0, box).scale).toBeCloseTo(max);
        expect(max).toBeGreaterThanOrEqual(4);
    });
});

describe('clampView / panBy', () => {
    it('a side smaller than the viewport stays centred', () => {
        const v = panBy(fitView(box), 500, 500, box);
        expect(v).toEqual(fitView(box));
    });

    it('a zoomed image cannot uncover backdrop at its edges', () => {
        const zoomed = zoomAt(fitView(box), 4, 195, 422, box);
        const right = panBy(zoomed, 10_000, 0, box);
        expect(right.x).toBe(0);
        const left = panBy(zoomed, -10_000, 0, box);
        expect(left.x + 1200 * left.scale).toBeCloseTo(390);
    });

    it('clamps a scale out of range', () => {
        expect(clampView({ scale: 100, x: 0, y: 0 }, box).scale).toBe(scaleLimits(box).max);
    });
});

describe('zoomPercent / isFitted', () => {
    it('reads 100 % at the fit', () => {
        expect(zoomPercent(fitView(box), box)).toBe(100);
        expect(isFitted(fitView(box), box)).toBe(true);
        const z = zoomAt(fitView(box), 2, 0, 0, box);
        expect(zoomPercent(z, box)).toBe(200);
        expect(isFitted(z, box)).toBe(false);
    });
});
