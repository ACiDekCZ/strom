/**
 * The transition when children are shown or hidden in place (src/children-transition.ts):
 * the easing, the timings, the stagger, which cards animate, and the zoom out of §5.
 */
import { describe, expect, it } from 'vitest';
import {
    childrenEase, childrenTransitionTiming, cubicBezier, isCompactMotion, pickAnimated,
    rectsOverlap, screenRectAt, staggerDelay, widenedView, zoomOutScale, type ZoomOutInput,
} from '../children-transition.js';

describe('cubicBezier', () => {
    it('runs from 0 to 1 and matches the linear curve', () => {
        const lin = cubicBezier(0, 0, 1, 1);
        for (const t of [0, 0.1, 0.5, 0.9, 1]) expect(lin(t)).toBeCloseTo(t, 5);
    });

    it('the transition easing starts fast and settles (decelerating)', () => {
        expect(childrenEase(0)).toBe(0);
        expect(childrenEase(1)).toBe(1);
        expect(childrenEase(0.25)).toBeGreaterThan(0.5);
        expect(childrenEase(0.5)).toBeGreaterThan(0.85);
        let last = 0;
        for (let t = 0.05; t <= 1; t += 0.05) {
            const v = childrenEase(t);
            expect(v).toBeGreaterThanOrEqual(last);
            last = v;
        }
    });
});

describe('childrenTransitionTiming', () => {
    it('desktop: open 320 ms, close 260 ms, up to 200 cards', () => {
        const open = childrenTransitionTiming('open', false);
        expect(open).toMatchObject({ duration: 320, fadeIn: [0, 160], ghostOut: [0, 80], linesIn: [200, 360], cap: 200 });
        const close = childrenTransitionTiming('close', false);
        expect(close).toMatchObject({ duration: 260, fadeOut: [80, 220], ghostOut: [0, 60], linesIn: [140, 280], cap: 200 });
    });

    it('phone and tablet: open 280 ms, close 220 ms, every window scaled, up to 80 cards', () => {
        const open = childrenTransitionTiming('open', true);
        expect(open.duration).toBe(280);
        expect(open.cap).toBe(80);
        expect(open.fadeIn).toEqual([0, 140]);
        expect(open.linesIn).toEqual([175, 315]);
        const close = childrenTransitionTiming('close', true);
        expect(close.duration).toBe(220);
        expect(close.fadeOut[1]).toBeLessThanOrEqual(close.duration);
    });

    it('compact below 1025 px or with a coarse pointer', () => {
        expect(isCompactMotion(1440, false)).toBe(false);
        expect(isCompactMotion(1024, false)).toBe(true);
        expect(isCompactMotion(1440, true)).toBe(true);
    });
});

describe('staggerDelay', () => {
    it('+20 ms a card, at most +120 ms; more than twelve cards start together', () => {
        expect(staggerDelay(0, 5)).toBe(0);
        expect(staggerDelay(3, 5)).toBe(60);
        expect(staggerDelay(10, 12)).toBe(120);
        expect(staggerDelay(10, 13)).toBe(0);
    });
});

describe('pickAnimated', () => {
    it('only cards near the view, the nearest first, at most the cap', () => {
        const items = [
            { id: 'a', dist: 50, near: true }, { id: 'b', dist: 10, near: true },
            { id: 'c', dist: 1, near: false }, { id: 'd', dist: 30, near: true },
        ];
        expect([...pickAnimated(items, 2)].map(i => i.id)).toEqual(['b', 'd']);
    });

    it('the widened view reaches half its size beyond each edge', () => {
        expect(widenedView(800, 600)).toEqual({ left: -400, top: -300, right: 1200, bottom: 900 });
        expect(rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
        expect(rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 9, top: 9, right: 20, bottom: 20 })).toBe(true);
    });
});

describe('zoomOutScale (§5)', () => {
    const base: ZoomOutInput = {
        scale: 1, minScale: 0.1,
        pivotScreen: { x: 500, y: 300 }, pivotWorld: { x: 0, y: 0 },
        target: { left: -100, top: 100, right: 100, bottom: 200 },
        area: { left: 24, top: 24, right: 976, bottom: 576 },
        avoid: [],
    };

    it('children already in view: the scale stays', () => {
        expect(zoomOutScale(base)).toBe(1);
    });

    it('children beyond the edge: the largest scale at which they fit, around the clicked card', () => {
        const input = { ...base, target: { left: -600, top: 100, right: 100, bottom: 200 } };
        const s = zoomOutScale(input);
        expect(s).toBeCloseTo(476 / 600, 9);
        const r = screenRectAt(input, s);
        expect(r.left).toBeCloseTo(24, 6);
    });

    it('never below 0.6 × the scale before (what does not fit then stays off screen)', () => {
        const input = { ...base, scale: 0.8, target: { left: -5000, top: 100, right: 100, bottom: 200 } };
        expect(zoomOutScale(input)).toBeCloseTo(0.48, 12);
    });

    it('never below the zoom\'s own floor', () => {
        const input = { ...base, scale: 0.2, minScale: 0.15, target: { left: -5000, top: 100, right: 100, bottom: 200 } };
        expect(zoomOutScale(input)).toBe(0.15);
    });

    it('clear of the controls: a zoom block in the bottom right corner', () => {
        const input = {
            ...base,
            target: { left: -100, top: 100, right: 500, bottom: 200 },
            avoid: [{ left: 900, top: 400, right: 1000, bottom: 600 }],
        };
        // The whole area would fit them at 0.952 but over the block; left of it at 0.8
        const s = zoomOutScale(input);
        expect(s).toBeCloseTo(0.8, 12);
        expect(rectsOverlap(screenRectAt(input, s), input.avoid[0])).toBe(false);
    });
});
