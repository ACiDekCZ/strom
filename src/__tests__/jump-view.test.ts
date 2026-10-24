/**
 * Where a jump to cards elsewhere in the view lands (src/jump-view.ts): a
 * line link's other end and a child drawn elsewhere, always at a readable
 * scale.
 */
import { describe, expect, it } from 'vitest';
import { jumpView, type JumpViewInput } from '../jump-view.js';

const card = (x: number, y: number) => ({ left: x, top: y, right: x + 190, bottom: y + 80 });
const input = (over: Partial<JumpViewInput>): JumpViewInput => ({
    scale: 1, tx: 0, ty: 0, view: { width: 1440, height: 844 }, targets: [],
    minScale: 0.75, togetherMinScale: 0.6, maxScale: 4, padding: 25, ...over,
});

describe('jumpView', () => {
    it('no target: the view stays', () => {
        expect(jumpView(input({}))).toBeNull();
    });

    it('one card: centred at the current scale when that is readable', () => {
        const plan = jumpView(input({ scale: 1.4, targets: [card(5000, 900)] }))!;
        expect(plan).toEqual({ scale: 1.4, centerX: 5095, centerY: 940, only: 0 });
    });

    it('one card in a view zoomed far out: centred at the readable scale, not left a speck', () => {
        const plan = jumpView(input({ scale: 0.08, targets: [card(-3000, 400)] }))!;
        expect(plan.scale).toBe(0.75);
        expect([plan.centerX, plan.centerY]).toEqual([-2905, 440]);
    });

    it('several cards on screen already at a readable scale: the view stays', () => {
        expect(jumpView(input({ targets: [card(100, 100), card(400, 100)] }))).toBeNull();
    });

    it('several cards on screen but the view too far out: zoomed in to readable around them', () => {
        const plan = jumpView(input({ scale: 0.2, targets: [card(100, 100), card(400, 100)] }))!;
        expect(plan.scale).toBe(0.75);
        expect(plan.only).toBeNull();
        expect([plan.centerX, plan.centerY]).toEqual([(100 + 590) / 2, 140]);
    });

    it('several cards off screen that fit readably: centred on all of them, zoomed out only as far as they need', () => {
        const plan = jumpView(input({ scale: 2, targets: [card(3000, 0), card(4000, 0)] }))!;
        // The box is 1190 wide: (1440 - 50) / 1190 ≈ 1.17
        expect(plan.scale).toBeCloseTo(1390 / 1190, 5);
        expect(plan.only).toBeNull();
        expect(plan.centerX).toBe((3000 + 4190) / 2);
    });

    it('several cards too far apart to read together (the old fit went to 0.05): the nearest one, readable', () => {
        // The view's centre stands at world (720, 422); the targets 20 000 px apart
        const near = card(1500, 300), far = card(-18000, 300);
        const plan = jumpView(input({ targets: [far, near] }))!;
        expect(plan.scale).toBe(1);
        expect(plan.only).toBe(1);
        expect([plan.centerX, plan.centerY]).toEqual([1595, 340]);
    });

    it('a couple of parents on a phone: both together a little below the one-card scale, not just the nearest', () => {
        // The box is 490 wide: (390 - 50) / 490 ≈ 0.69, under 0.75 but over 0.6
        const plan = jumpView(input({ scale: 0.3, view: { width: 390, height: 700 }, targets: [card(0, 0), card(300, 0)] }))!;
        expect(plan.only).toBeNull();
        expect(plan.scale).toBeCloseTo(340 / 490, 5);
        expect(plan.centerX).toBe(245);
    });

    it('several cards on screen at a scale they are read together at: the view stays', () => {
        const phone = { width: 390, height: 700 };
        expect(jumpView(input({ scale: 0.65, view: phone, targets: [card(0, 0), card(300, 0)], tx: 30, ty: 100 }))).toBeNull();
    });

    it('never below the readable scale for one card, on a phone too', () => {
        const phone = { width: 390, height: 700 };
        for (const scale of [0.05, 0.3, 0.75, 1, 2.5]) {
            const plan = jumpView(input({ scale, view: phone, targets: [card(0, 0), card(260, 0), card(5000, 600)] }));
            if (plan) expect(plan.scale).toBeGreaterThanOrEqual(0.75 - 1e-9);
        }
    });

    it('a card wider than the view at the readable scale: the whole card in view comes first', () => {
        const wide = { left: 0, top: 0, right: 900, bottom: 80 };
        const plan = jumpView(input({ scale: 0.1, view: { width: 390, height: 700 }, targets: [wide] }))!;
        expect(plan.scale).toBeCloseTo(340 / 900, 5);
    });
});
