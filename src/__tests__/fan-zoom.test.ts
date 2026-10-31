/**
 * Zoom and pan of the fan (spec 029 §1): the viewBox math of FanZoom (limits,
 * the point under the cursor, the clamp to the frame, a pinch) and the inline
 * script for saved pages (§6.3: small, self-contained).
 */

import { describe, it, expect } from 'vitest';
import { transformSync } from 'esbuild';
import {
    fanFitView, fanBasePpu, clampFanView, fanViewBox, fanZoomAt, fanPanBy, fanWheelFactor, fanPinchStep,
    fanEase, fanLerpView, fanZoomInlineScript, FAN_ZOOM_MIN, FAN_ZOOM_MAX, FanView,
} from '../fan-zoom.js';
import type { FanBounds } from '../fan-chart.js';

/** A half-circle frame (twice as wide as high) on a 1000 × 600 surface. */
const G: FanBounds = { x: -500, y: -500, w: 1000, h: 520 };
const W = 1000, H = 600;
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** The fan point under surface point (sx, sy). */
function under(v: FanView, sx: number, sy: number): { x: number; y: number } {
    const vb = fanViewBox(v, G, W, H);
    return { x: vb.x + sx / vb.ppu, y: vb.y + sy / vb.ppu };
}

describe('fan zoom: the whole fan and the limits', () => {
    it('z = 1 shows the whole frame, centred, with the surface aspect ratio', () => {
        const vb = fanViewBox(fanFitView(G), G, W, H);
        expect(vb.ppu).toBe(fanBasePpu(G, W, H));
        expect(vb.w).toBeGreaterThanOrEqual(G.w - 1e-9);
        expect(vb.h).toBeGreaterThanOrEqual(G.h - 1e-9);
        near(vb.w / vb.h, W / H);
        near(vb.x + vb.w / 2, G.x + G.w / 2);
        near(vb.y + vb.h / 2, G.y + G.h / 2);
    });

    it('keeps z within 1-8', () => {
        expect(clampFanView({ z: 0.2, cx: 0, cy: 0 }, G, W, H).z).toBe(FAN_ZOOM_MIN);
        expect(clampFanView({ z: 50, cx: 0, cy: 0 }, G, W, H).z).toBe(FAN_ZOOM_MAX);
        let v = fanFitView(G);
        for (let i = 0; i < 40; i++) v = fanZoomAt(v, 1.6, 300, 200, G, W, H);
        expect(v.z).toBe(FAN_ZOOM_MAX);
        for (let i = 0; i < 40; i++) v = fanZoomAt(v, 1 / 1.6, 300, 200, G, W, H);
        expect(v.z).toBe(FAN_ZOOM_MIN);
        expect(clampFanView({ z: NaN, cx: NaN, cy: 0 }, G, W, H).z).toBe(1);
    });

    it('a zero-sized surface still gives a finite view', () => {
        const vb = fanViewBox(fanFitView(G), G, 0, 0);
        expect(Number.isFinite(vb.ppu) && vb.ppu > 0).toBe(true);
    });
});

describe('fan zoom: the wheel keeps the point under the cursor', () => {
    it('zooming in and out at a point leaves that fan point under it', () => {
        let v: FanView = { z: 2, cx: -100, cy: -200 };
        v = clampFanView(v, G, W, H);
        for (const [sx, sy, k] of [[250, 150, 1.4], [700, 420, 1.25], [500, 300, 1 / 1.3], [120, 500, 1.1]] as const) {
            const before = under(v, sx, sy);
            const next = fanZoomAt(v, k, sx, sy, G, W, H);
            // Not clamped (inside the frame): the same point stays under the cursor.
            const after = under(next, sx, sy);
            near(after.x, before.x, 1e-6);
            near(after.y, before.y, 1e-6);
            v = next;
        }
    });

    it('a wheel step down zooms out, up zooms in; a trackpad pinch (ctrl) is stronger', () => {
        expect(fanWheelFactor(100, false)).toBeLessThan(1);
        expect(fanWheelFactor(-100, false)).toBeGreaterThan(1);
        expect(fanWheelFactor(-10, true)).toBeGreaterThan(fanWheelFactor(-10, false));
        near(fanWheelFactor(-100, false), Math.exp(0.18));
        // Lines (deltaMode 1) count 16 px each.
        near(fanWheelFactor(-3, false, 1), fanWheelFactor(-48, false, 0));
    });
});

describe('fan zoom: the clamp keeps the view inside the frame', () => {
    it('a pan never leaves the frame', () => {
        let v = fanZoomAt(fanFitView(G), 3, 500, 300, G, W, H);
        v = fanPanBy(v, 1e6, 1e6, G, W, H);
        let vb = fanViewBox(v, G, W, H);
        near(vb.x, G.x);
        near(vb.y, G.y);
        v = fanPanBy(v, -1e7, -1e7, G, W, H);
        vb = fanViewBox(v, G, W, H);
        near(vb.x + vb.w, G.x + G.w);
        near(vb.y + vb.h, G.y + G.h);
    });

    it('an axis wider than the frame stays centred on it', () => {
        // At z = 1 the surface is wider than the frame's aspect: x is centred, whatever the input.
        const v = clampFanView({ z: 1, cx: 4000, cy: -4000 }, G, W, H);
        near(v.cx, G.x + G.w / 2);
        near(v.cy, G.y + G.h / 2);
    });

    it('a drag moves the content with the pointer', () => {
        const v = clampFanView({ z: 4, cx: 0, cy: -250 }, G, W, H);
        const before = under(v, 400, 300);
        const moved = fanPanBy(v, 40, -30, G, W, H);
        const after = under(moved, 440, 270);
        near(after.x, before.x);
        near(after.y, before.y);
    });
});

describe('fan zoom: pinch', () => {
    it('spreading the fingers zooms in around their midpoint', () => {
        const v = fanFitView(G);
        const prev = { d: 100, mx: 500, my: 300 };
        const next = { d: 200, mx: 500, my: 300 };
        const before = under(v, 500, 300);
        const out = fanPinchStep(v, prev, next, G, W, H);
        near(out.z, 2);
        const after = under(out, 500, 300);
        near(after.x, before.x);
        near(after.y, before.y);
    });

    it('moving both fingers pans, the point between them follows', () => {
        const v = clampFanView({ z: 3, cx: 0, cy: -250 }, G, W, H);
        const before = under(v, 400, 300);
        const out = fanPinchStep(v, { d: 120, mx: 400, my: 300 }, { d: 150, mx: 430, my: 280 }, G, W, H);
        near(out.z, 3 * 150 / 120);
        const after = under(out, 430, 280);
        near(after.x, before.x);
        near(after.y, before.y);
    });

    it('pinching in from the whole fan stays at the whole fan', () => {
        const out = fanPinchStep(fanFitView(G), { d: 200, mx: 300, my: 300 }, { d: 50, mx: 300, my: 300 }, G, W, H);
        expect(out.z).toBe(1);
    });
});

describe('fan zoom: animation', () => {
    it('ease-out cubic from 0 to 1, views interpolate', () => {
        expect(fanEase(0)).toBe(0);
        expect(fanEase(1)).toBe(1);
        expect(fanEase(0.5)).toBeGreaterThan(0.5);
        const m = fanLerpView({ z: 1, cx: 0, cy: 0 }, { z: 3, cx: 10, cy: -10 }, 0.5);
        expect(m).toEqual({ z: 2, cx: 5, cy: -5 });
    });
});

describe('fanZoomInlineScript (§6.3)', () => {
    const src = fanZoomInlineScript();

    it('parses and stays under 4 kB minified', () => {
        const min = transformSync(src, { minify: true, loader: 'js' }).code;
        expect(min.length).toBeLessThan(4096);
    });

    it('needs nothing outside the page', () => {
        expect(src).not.toMatch(/\bimport\b|\brequire\s*\(|\bfetch\s*\(|XMLHttpRequest|\beval\s*\(|new Function/);
    });

    it('works on the page markup: the fan surface, its buttons and its hint', () => {
        expect(src).toContain('[data-fan-zoom]');
        expect(src).toContain('[data-fan-zoom-act]');
        expect(src).toContain('[data-fan-zoom-hint]');
    });
});
