/**
 * The canvas overlay of a computation over the whole tree (waiting buttons §8, 8a): painted before the work,
 * seen only past 120 ms (a quick layout never blinks), at least 300 ms once seen, one overlay for works that
 * overlap.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installMiniDom } from './helpers/mini-dom.js';
import { canvasBusy, canvasBusyActive, resetCanvasBusy } from '../ui/canvas-busy.js';
import { strings } from '../strings.js';

let dom: ReturnType<typeof installMiniDom>;
let area: HTMLElement;

const overlay = (): HTMLElement | null => area.querySelector('.canvas-busy') as HTMLElement | null;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    dom = installMiniDom();
    const a = dom.document.createElement('div');
    a.setAttribute('id', 'tree-container');
    dom.document.body.appendChild(a);
    area = a as unknown as HTMLElement;
});

afterEach(() => {
    resetCanvasBusy();
    vi.useRealTimers();
    dom.uninstall();
});

describe('canvasBusy (§8, 8a)', () => {
    it('is on the area before the work runs (painted first), with the words and the 16 px spinner', async () => {
        let seenInWork: string | null = null;
        const run = canvasBusy(() => {
            seenInWork = overlay()?.textContent ?? null;
            expect(area.getAttribute('aria-busy')).toBe('true');
            expect(overlay()?.querySelector('.busy-spin.s16')).toBeTruthy();
            expect(overlay()?.querySelector('[role="status"]')).toBeTruthy();
            return 7;
        });
        await vi.advanceTimersByTimeAsync(0);
        await expect(run).resolves.toBe(7);
        expect(seenInWork).toBe(strings.busy.layout);
    });

    it('a quick layout (under 120 ms) never shows it: away at once, never marked seen', async () => {
        const run = canvasBusy(() => { vi.setSystemTime(Date.now() + 60); });
        await vi.advanceTimersByTimeAsync(0);
        await run;
        expect(overlay()).toBeNull();
        expect(area.getAttribute('aria-busy')).toBeNull();
        expect(canvasBusyActive()).toBe(false);
    });

    it('a layout that holds the page past 120 ms: seen, then held until 300 ms after it was seen', async () => {
        // One go of 200 ms: no timer fires meanwhile (the stylesheet shows it at 120 ms).
        const run = canvasBusy(() => { vi.setSystemTime(Date.now() + 200); });
        await vi.advanceTimersByTimeAsync(0);
        await run;
        expect(overlay()?.dataset.shown).toBe('true');
        expect(overlay()?.dataset.hold).toBe('true');
        await vi.advanceTimersByTimeAsync(210);
        expect(overlay()).not.toBeNull();
        await vi.advanceTimersByTimeAsync(20);
        expect(overlay()).toBeNull();
        expect(area.getAttribute('aria-busy')).toBeNull();
    });

    it('a long layout (past 420 ms) goes at once when done', async () => {
        const run = canvasBusy(() => { vi.setSystemTime(Date.now() + 900); });
        await vi.advanceTimersByTimeAsync(0);
        await run;
        expect(overlay()).toBeNull();
    });

    it('a work that yields is marked seen by the timer at 120 ms, not before', async () => {
        let done!: () => void;
        const run = canvasBusy(() => new Promise<void>(r => { done = r; }));
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(100);
        expect(overlay()?.dataset.shown).toBeUndefined();
        await vi.advanceTimersByTimeAsync(30);
        expect(overlay()?.dataset.shown).toBe('true');
        done();
        await run;
        expect(overlay()).not.toBeNull();
        await vi.advanceTimersByTimeAsync(300);
        expect(overlay()).toBeNull();
    });

    it('a second layout while one runs shares the one overlay; it goes after the last', async () => {
        let first!: () => void;
        const a = canvasBusy(() => new Promise<void>(r => { first = r; }));
        await vi.advanceTimersByTimeAsync(0);
        const b = canvasBusy(() => { vi.setSystemTime(Date.now() + 10); }, { label: strings.busy.mapCalc });
        await b;
        expect(area.querySelectorAll('.canvas-busy').length).toBe(1);
        expect(overlay()?.textContent).toBe(strings.busy.mapCalc);
        first();
        await a;
        expect(overlay()).toBeNull();
    });

    it('after a layout past 120 ms the next one (as large a tree) is seen at once and kept 300 ms', async () => {
        const first = canvasBusy(() => { vi.setSystemTime(Date.now() + 500); });
        await vi.advanceTimersByTimeAsync(0);
        await first;
        expect(overlay()).toBeNull();
        let seenAtOnce: string | undefined;
        const next = canvasBusy(() => { seenAtOnce = overlay()?.dataset.shown; vi.setSystemTime(Date.now() + 40); });
        await vi.advanceTimersByTimeAsync(0);
        await next;
        expect(seenAtOnce).toBe('true');
        await vi.advanceTimersByTimeAsync(250);
        expect(overlay()).not.toBeNull();
        await vi.advanceTimersByTimeAsync(20);
        expect(overlay()).toBeNull();
    });

    it('stateFirst: the work starts at once (its state now), the overlay painted at its ready before the layout', async () => {
        const order: string[] = [];
        const run = canvasBusy(async (ready) => {
            order.push(`state:${overlay() ? 'on' : 'off'}`);
            await ready();
            order.push('layout');
            vi.setSystemTime(Date.now() + 200);
        }, { stateFirst: true });
        expect(order).toEqual(['state:on']);
        await vi.advanceTimersByTimeAsync(0);
        await run;
        expect(order).toEqual(['state:on', 'layout']);
        expect(overlay()?.dataset.shown).toBe('true');
        await vi.advanceTimersByTimeAsync(230);
        expect(overlay()).toBeNull();
    });

    it('stateFirst without a layout (ready never called): the overlay goes, never painted', async () => {
        await canvasBusy(() => 1, { stateFirst: true });
        expect(overlay()).toBeNull();
        expect(area.getAttribute('aria-busy')).toBeNull();
    });

    it('a failed work takes the overlay away and passes the error on', async () => {
        const run = canvasBusy(() => { throw new Error('layout'); });
        const seen = expect(run).rejects.toThrow('layout');
        await vi.advanceTimersByTimeAsync(0);
        await seen;
        expect(overlay()).toBeNull();
    });

    it('without the area the work runs plainly', async () => {
        area.remove();
        await expect(canvasBusy(() => 3)).resolves.toBe(3);
    });

    it('the stylesheet shows it past 120 ms only, dims the area, no fade (index.html)', () => {
        const css = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
        const rule = css.match(/\.canvas-busy \{[^}]*\}/)?.[0] ?? '';
        expect(rule).toMatch(/opacity: 0/);
        expect(rule).toMatch(/animation: canvas-busy-in 1ms linear 120ms forwards/);
        expect(rule).toMatch(/color-mix\(in srgb, var\(--bg\) 55%, transparent\)/);
        expect(css).toMatch(/\.canvas-busy\[data-shown\] \{ opacity: 1; animation: none; \}/);
    });

    it('the Tree overview\'s "Calculating…" goes by the same times: seen past 120 ms (index.html, tree-overview.ts)', () => {
        const css = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
        expect(css.match(/\.tov-busy \{[^}]*\}/)?.[0]).toMatch(/animation: tov-busy-in 0s linear 120ms forwards/);
        const src = readFileSync(new URL('../ui/tree-overview.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/const BUSY_DELAY_MS = BUSY_SHOW_MS;/);
        expect(src).toMatch(/const BUSY_MIN_MS = BUSY_HOLD_MS;/);
    });
});
