/**
 * About's coffee button: each opening chooses one of the nine animations
 * (A–C, E–J, never D) and plays it once two seconds later; nothing with
 * reduced motion, nothing when the dialog closed first, and the decorations
 * go after the animation so the next opening plays again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    COFFEE_DELAY_MS, COFFEE_RUN_MS, COFFEE_VARIANTS, createCoffeeScheduler, pickCoffeeVariant,
    type CoffeeStage, type CoffeeVariant,
} from '../ui/about-coffee-anim.js';

interface FakeStage extends CoffeeStage {
    played: CoffeeVariant[];
    cleared: number;
    playing: CoffeeVariant | null;
    open: boolean;
    reduced: boolean;
}

function fakeStage(): FakeStage {
    const s: FakeStage = {
        played: [], cleared: 0, playing: null, open: true, reduced: false,
        reducedMotion: () => s.reduced,
        isOpen: () => s.open,
        play(v) { s.played.push(v); s.playing = v; },
        clear() { s.cleared++; s.playing = null; },
    };
    return s;
}

/** A random source returning the given values in turn. */
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T10:30:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('pickCoffeeVariant', () => {
    it('chooses evenly among the nine variants, never D', () => {
        expect(COFFEE_VARIANTS).toEqual(['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'J']);
        const n = COFFEE_VARIANTS.length;
        const picked = COFFEE_VARIANTS.map((_, i) => pickCoffeeVariant(() => (i + 0.5) / n));
        expect(picked).toEqual([...COFFEE_VARIANTS]);
        expect(pickCoffeeVariant(() => 0)).toBe('A');
        expect(pickCoffeeVariant(() => 0.999999)).toBe('J');
        // Out-of-range sources still land on a variant.
        expect(pickCoffeeVariant(() => 1)).toBe('J');
        expect(pickCoffeeVariant(() => -0.1)).toBe('A');
    });
});

describe('createCoffeeScheduler', () => {
    it('opening chooses one of the nine and plays it once after two seconds', () => {
        const stage = fakeStage();
        const s = createCoffeeScheduler(stage, () => 0.5);
        const v = s.open();
        expect(v).toBe('F');
        vi.advanceTimersByTime(COFFEE_DELAY_MS - 1);
        expect(stage.played).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(stage.played).toEqual(['F']);
        expect(stage.playing).toBe('F');
        // Once: no repeat while the dialog stays open, the decorations go after the run.
        vi.advanceTimersByTime(COFFEE_RUN_MS);
        expect(stage.playing).toBeNull();
        vi.advanceTimersByTime(60_000);
        expect(stage.played).toEqual(['F']);
    });

    it('reduced motion: nothing is chosen and nothing plays', () => {
        const stage = fakeStage();
        stage.reduced = true;
        const s = createCoffeeScheduler(stage, () => 0.1);
        expect(s.open()).toBeNull();
        vi.advanceTimersByTime(10_000);
        expect(stage.played).toEqual([]);
    });

    it('reduced motion switched on while waiting: nothing plays', () => {
        const stage = fakeStage();
        const s = createCoffeeScheduler(stage, () => 0.1);
        s.open();
        stage.reduced = true;
        vi.advanceTimersByTime(COFFEE_DELAY_MS);
        expect(stage.played).toEqual([]);
    });

    it('closing before two seconds: nothing plays; the next opening chooses anew', () => {
        const stage = fakeStage();
        const s = createCoffeeScheduler(stage, seq(0.05, 0.95));
        expect(s.open()).toBe('A');
        vi.advanceTimersByTime(COFFEE_DELAY_MS - 500);
        s.close();
        stage.open = false;
        vi.advanceTimersByTime(10_000);
        expect(stage.played).toEqual([]);

        stage.open = true;
        expect(s.open()).toBe('J');
        vi.advanceTimersByTime(COFFEE_DELAY_MS);
        expect(stage.played).toEqual(['J']);
    });

    it('a dialog closed by another path (no close call) plays nothing', () => {
        const stage = fakeStage();
        const s = createCoffeeScheduler(stage, () => 0.3);
        s.open();
        stage.open = false;
        vi.advanceTimersByTime(COFFEE_DELAY_MS);
        expect(stage.played).toEqual([]);
    });

    it('closing during the animation clears it at once', () => {
        const stage = fakeStage();
        const s = createCoffeeScheduler(stage, () => 0.8);
        s.open();
        vi.advanceTimersByTime(COFFEE_DELAY_MS + 500);
        expect(stage.playing).toBe('I');
        s.close();
        expect(stage.playing).toBeNull();
    });

    it('opening again while waiting keeps one play only', () => {
        const stage = fakeStage();
        const s = createCoffeeScheduler(stage, seq(0.2, 0.6));
        s.open();
        vi.advanceTimersByTime(1000);
        s.open();
        vi.advanceTimersByTime(COFFEE_DELAY_MS + COFFEE_RUN_MS);
        expect(stage.played).toEqual(['G']);
    });
});
