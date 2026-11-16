/**
 * The portrait editor's pure parts (spec 107 §1, §7, §9, §10): the steps'
 * opening states, the footer, what Done returns per step, when Done keeps
 * today's compressPhoto bytes (K1.5), the small-photo note, the frame's place
 * and the angle as the slider shows it.
 */

import { describe, it, expect } from 'vitest';
import {
    coupleHalfCrop, initialPortraitSteps, portraitFooter, portraitStepCrop, finishPortraitStep, skipPortraitStep,
    portraitStepShownSkipped, isIdentityPortrait, isSmallPortrait, portraitFrameGeometry, formatPortraitAngle,
} from '../portrait-editor-model.js';
import {
    defaultPortraitCrop, isDefaultPortraitCrop, isPortraitRegionSquare, zoomPortraitView, mirrorPortraitView,
    straightenPortraitView, turnPortraitView, portraitSourcePixels,
} from '../photo.js';

const W = 1200, H = 800;

describe('coupleHalfCrop', () => {
    it('opens the partners on the left and right half of a wide photo', () => {
        const a = coupleHalfCrop(W, H, 0, 2), b = coupleHalfCrop(W, H, 1, 2);
        expect(a.region.x + a.region.w).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(b.region.x).toBeGreaterThanOrEqual(0.5 - 1e-9);
        // The largest square in a 600 × 800 half is 600 px.
        expect(a.region.w * W).toBeCloseTo(600);
        expect(isPortraitRegionSquare(a.region, W, H)).toBe(true);
        expect(isPortraitRegionSquare(b.region, W, H)).toBe(true);
    });

    it('takes the top and bottom half of an upright photo', () => {
        const a = coupleHalfCrop(600, 1400, 0, 2), b = coupleHalfCrop(600, 1400, 1, 2);
        expect(a.region.y + a.region.h).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(b.region.y).toBeGreaterThanOrEqual(0.5 - 1e-9);
        expect(isPortraitRegionSquare(a.region, 600, 1400)).toBe(true);
    });

    it('opens one known partner in the centre', () => {
        expect(coupleHalfCrop(W, H, 0, 1)).toEqual(defaultPortraitCrop(W, H));
    });
});

describe('initialPortraitSteps', () => {
    it('one portrait opens on the default crop, shown, without Keep / Replace', () => {
        const [s] = initialPortraitSteps({ steps: [{ current: 'data:x' }], couple: false }, W, H);
        expect(isDefaultPortraitCrop(portraitStepCrop(s, W, H)!, W, H)).toBe(true);
        expect(s).toMatchObject({ status: 'open', visited: true, keep: null });
    });

    it('a couple opens on the halves, the second step not yet shown, a partner with a portrait keeping it', () => {
        const states = initialPortraitSteps({ steps: [{}, { current: 'data:x' }], couple: true }, W, H);
        expect(states.map(s => s.visited)).toEqual([true, false]);
        expect(states.map(s => s.keep)).toEqual([null, true]);
        const c0 = portraitCropFor(states[0]);
        expect(c0.region.x + c0.region.w).toBeLessThanOrEqual(0.5 + 1e-6);
    });

    it('an initial crop wins over the halves', () => {
        const initial = { region: { x: 0.1, y: 0.1, w: 0.25, h: 0.375 } };
        const [s] = initialPortraitSteps({ steps: [{ initial }, {}], couple: true }, W, H);
        const c = portraitCropFor(s);
        expect(c.region.x).toBeCloseTo(0.1, 4);
        expect(c.region.w).toBeCloseTo(0.25, 4);
    });

    const portraitCropFor = (s: ReturnType<typeof initialPortraitSteps>[number]) =>
        portraitStepCrop({ ...s, keep: null }, W, H)!;
});

describe('portraitFooter and the steps', () => {
    const couple = initialPortraitSteps({ steps: [{}, {}], couple: true }, W, H);

    it('step 1 of 2: Skip and Next; the last: Skip and Done', () => {
        expect(portraitFooter(couple, 0, true)).toEqual({ skip: true, primary: 'next' });
        expect(portraitFooter(couple, 1, true)).toEqual({ skip: true, primary: 'done' });
    });

    it('one portrait or one known partner: no Skip', () => {
        const one = initialPortraitSteps({ steps: [{}], couple: false }, W, H);
        expect(portraitFooter(one, 0, false)).toEqual({ skip: false, primary: 'done' });
        const single = initialPortraitSteps({ steps: [{}], couple: true }, W, H);
        expect(portraitFooter(single, 0, true)).toEqual({ skip: false, primary: 'done' });
    });

    it('a partner with a portrait has no Skip (Keep is the same)', () => {
        const states = initialPortraitSteps({ steps: [{ current: 'data:x' }, {}], couple: true }, W, H);
        expect(portraitFooter(states, 0, true).skip).toBe(false);
        expect(portraitFooter([{ ...states[0], keep: false }, states[1]], 0, true).skip).toBe(false);
    });

    it('Done returns a crop per step, null for a skipped or kept one', () => {
        let states = initialPortraitSteps({ steps: [{}, { current: 'data:x' }], couple: true }, W, H);
        states = skipPortraitStep(states, 0);
        states = finishPortraitStep(states, 1);
        expect(states.map(s => portraitStepCrop(s, W, H))).toEqual([null, null]);
        expect(states.map(portraitStepShownSkipped)).toEqual([true, true]);
        const replaced = finishPortraitStep([states[0], { ...states[1], keep: false }], 1);
        expect(portraitStepCrop(replaced[1], W, H)).not.toBeNull();
        expect(portraitStepShownSkipped(replaced[1])).toBe(false);
    });
});

describe('isIdentityPortrait (K1.5)', () => {
    const file = { fromFile: true, squareOnly: false, stepCount: 1 };
    const [s] = initialPortraitSteps({ steps: [{}], couple: false }, W, H);

    it('Done untouched from one file keeps compressPhoto', () => {
        expect(isIdentityPortrait(file, portraitStepCrop(s, W, H), W, H)).toBe(true);
    });

    it('any change, another source or two steps does not', () => {
        const crop = (v: typeof s.view) => portraitStepCrop({ ...s, view: v }, W, H);
        expect(isIdentityPortrait(file, crop(zoomPortraitView(s.view, 1.5, W, H)), W, H)).toBe(false);
        expect(isIdentityPortrait(file, crop(straightenPortraitView(s.view, 2, W, H)), W, H)).toBe(false);
        expect(isIdentityPortrait(file, crop(mirrorPortraitView(s.view, W, H)), W, H)).toBe(false);
        expect(isIdentityPortrait(file, crop(turnPortraitView(s.view, 1, W, H)), W, H)).toBe(false);
        const c = portraitStepCrop(s, W, H);
        expect(isIdentityPortrait({ ...file, fromFile: false }, c, W, H)).toBe(false);
        expect(isIdentityPortrait({ ...file, squareOnly: true }, c, W, H)).toBe(false);
        expect(isIdentityPortrait({ ...file, stepCount: 2 }, c, W, H)).toBe(false);
        expect(isIdentityPortrait(file, null, W, H)).toBe(false);
    });
});

describe('isSmallPortrait (§10)', () => {
    it('warns once the crop holds fewer than 256 px of the original', () => {
        expect(isSmallPortrait(defaultPortraitCrop(W, H), W, H)).toBe(false);
        const [s] = initialPortraitSteps({ steps: [{}], couple: false }, W, H);
        const zoomed = portraitStepCrop({ ...s, view: zoomPortraitView(s.view, 4, W, H) }, W, H)!;
        expect(portraitSourcePixels(zoomed, W, H)).toBeCloseTo(200);
        expect(isSmallPortrait(zoomed, W, H)).toBe(true);
        expect(isSmallPortrait(defaultPortraitCrop(200, 300), 200, 300)).toBe(true);
    });
});

describe('portraitFrameGeometry (§9)', () => {
    it('a computer: 120 px of photo at the sides, above the zoom bar, at most 460 px', () => {
        expect(portraitFrameGeometry('wide', 676, 648)).toEqual({ side: 460, cx: 338, cy: 300 });
        expect(portraitFrameGeometry('wide', 500, 648).side).toBe(380);
        expect(portraitFrameGeometry('wide', 676, 400).side).toBe(288);
    });

    it('a phone: the width − 32, the stage height − 24; sideways: the height − 40', () => {
        expect(portraitFrameGeometry('phone', 390, 420)).toEqual({ side: 358, cx: 195, cy: 210 });
        expect(portraitFrameGeometry('phone', 390, 300).side).toBe(276);
        expect(portraitFrameGeometry('land', 430, 390)).toEqual({ side: 350, cx: 215, cy: 195 });
    });
});

describe('formatPortraitAngle', () => {
    it('the language decimal mark, a true minus, half degrees', () => {
        expect(formatPortraitAngle(-2.5, 'cs')).toBe('−2,5°');
        expect(formatPortraitAngle(-2.5, 'en')).toBe('−2.5°');
        expect(formatPortraitAngle(3.26, 'de')).toBe('3,5°');
        expect(formatPortraitAngle(0, 'en')).toBe('0°');
        expect(formatPortraitAngle(-0.1, 'en')).toBe('0°');
    });
});
