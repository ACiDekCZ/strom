/**
 * Minimap geometry (pure functions, no DOM): world→minimap fit transform and
 * the world bounding box over card rectangles.
 */

import { describe, it, expect } from 'vitest';
import { computeMinimapTransform, worldBoundingBox, WorldBox } from '../ui/minimap.js';
import { PersonId, Position } from '../types.js';

const MM_W = 180, MM_H = 120, PAD = 8;

function pos(x: number, y: number): Position { return { x, y }; }

describe('computeMinimapTransform', () => {
    it('fits a wide box to the inner width and centers vertically', () => {
        // 1000×100 world into 164×104 inner box → width-bound.
        const box: WorldBox = { minX: 0, minY: 0, maxX: 1000, maxY: 100 };
        const t = computeMinimapTransform(box, MM_W, MM_H, PAD);
        expect(t.scale).toBeCloseTo((MM_W - 2 * PAD) / 1000, 6);
        // Left edge maps to the padding (no horizontal centering slack).
        expect(0 * t.scale + t.offsetX).toBeCloseTo(PAD, 6);
        // Right edge maps to the far padding.
        expect(1000 * t.scale + t.offsetX).toBeCloseTo(MM_W - PAD, 6);
        // Vertically centered: box is shorter than the inner height.
        const drawnH = 100 * t.scale;
        const topInMinimap = 0 * t.scale + t.offsetY;
        expect(topInMinimap).toBeCloseTo(PAD + ((MM_H - 2 * PAD) - drawnH) / 2, 6);
    });

    it('maps a point and its inverse round-trips', () => {
        const box: WorldBox = { minX: -200, minY: 50, maxX: 300, maxY: 450 };
        const t = computeMinimapTransform(box, MM_W, MM_H, PAD);
        const wx = 123, wy = 210;
        const mmX = wx * t.scale + t.offsetX;
        const mmY = wy * t.scale + t.offsetY;
        expect((mmX - t.offsetX) / t.scale).toBeCloseTo(wx, 6);
        expect((mmY - t.offsetY) / t.scale).toBeCloseTo(wy, 6);
    });

    it('never divides by zero for a degenerate (single-point) box', () => {
        const box: WorldBox = { minX: 10, minY: 10, maxX: 10, maxY: 10 };
        const t = computeMinimapTransform(box, MM_W, MM_H, PAD);
        expect(Number.isFinite(t.scale)).toBe(true);
        expect(Number.isFinite(t.offsetX)).toBe(true);
        expect(Number.isFinite(t.offsetY)).toBe(true);
    });
});

describe('worldBoundingBox', () => {
    const cardW = 130, cardH = 65;

    it('returns null for an empty map', () => {
        expect(worldBoundingBox(new Map(), cardW, cardH)).toBeNull();
    });

    it('spans from the top-left of the leftmost card to the bottom-right of the farthest', () => {
        const m = new Map<PersonId, Position>([
            ['a' as PersonId, pos(0, 0)],
            ['b' as PersonId, pos(300, 200)],
        ]);
        const box = worldBoundingBox(m, cardW, cardH)!;
        expect(box).toEqual({ minX: 0, minY: 0, maxX: 300 + cardW, maxY: 200 + cardH });
    });
});
