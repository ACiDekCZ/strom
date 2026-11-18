/**
 * A switch that writes (waiting buttons §6.1, src/ui/switch-pend.ts): locked
 * and dashed at once, its words after 120 ms, "Waiting for the research" after
 * 5 s, its limit told to the caller; once shown it stays 300 ms at least; a
 * refusal leaves one sentence with Try again (role=alert only when first drawn).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    startPend, endPend, pendOf, isPend, anyPend, pendAttrs, pendStatusHtml, pendRefusalHtml, pendRefusalOf,
    clearPendRefusals, dropPend, resetPends, PEND_WAIT_MS,
} from '../ui/switch-pend.js';
import { strings } from '../strings.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T09:30:00Z'));
    resetPends();
});
afterEach(() => {
    resetPends();
    vi.useRealTimers();
});

describe('a switch that writes', () => {
    it('locked at once, its words after 120 ms, at rest when confirmed (300 ms at least once shown)', async () => {
        const redraw = vi.fn();
        startPend('k:war', { redraw });
        expect(pendAttrs('k:war')).toBe(' data-pend="1" aria-busy="true" aria-disabled="true"');
        expect(pendStatusHtml('k:war')).toBe('');
        expect(pendOf('k:war')?.phase).toBe('lock');
        vi.advanceTimersByTime(119);
        expect(redraw).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(redraw).toHaveBeenCalledTimes(1);
        expect(pendStatusHtml('k:war')).toContain(strings.busy.saving);
        expect(pendStatusHtml('k:war')).toContain('busy-st');
        // Confirmed 50 ms after the words came: they stay until 300 ms.
        vi.advanceTimersByTime(50);
        let done = false;
        const end = endPend('k:war').then(v => { done = v; });
        await vi.advanceTimersByTimeAsync(249);
        expect(done).toBe(false);
        expect(isPend('k:war')).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        await end;
        expect(done).toBe(true);
        expect(isPend('k:war')).toBe(false);
        expect(pendAttrs('k:war')).toBe('');
        expect(pendRefusalHtml('k:war')).toBe('');
    });

    it('confirmed before 120 ms: at rest at once, nothing shown', async () => {
        const redraw = vi.fn();
        startPend('k:war', { redraw });
        vi.advanceTimersByTime(60);
        await expect(endPend('k:war')).resolves.toBe(true);
        vi.advanceTimersByTime(PEND_WAIT_MS);
        expect(redraw).not.toHaveBeenCalled();
        expect(pendStatusHtml('k:war')).toBe('');
    });

    it('refused: back at rest with its sentence and Try again, said as an alert once', async () => {
        const retry = vi.fn();
        startPend('k:war', { label: strings.busy.turningOn, redraw: () => undefined });
        vi.advanceTimersByTime(120);
        expect(pendStatusHtml('k:war')).toContain(strings.busy.turningOn);
        const end = endPend('k:war', { text: strings.busy.notChanged('a history read is running'), retry });
        await vi.advanceTimersByTimeAsync(300);
        await expect(end).resolves.toBe(true);
        expect(isPend('k:war')).toBe(false);
        const first = pendRefusalHtml('k:war');
        expect(first).toContain('role="alert"');
        expect(first).toContain(strings.busy.notChanged('a history read is running'));
        expect(first).toContain(`data-pend-retry="k:war"`);
        expect(first).toContain(strings.busy.retry);
        // Drawn again (a redraw): the same sentence, not said again.
        const again = pendRefusalHtml('k:war');
        expect(again).not.toContain('role="alert"');
        expect(again).toContain(strings.busy.notChanged('a history read is running'));
        // A new try takes the sentence away.
        startPend('k:war', { redraw: () => undefined });
        expect(pendRefusalOf('k:war')).toBeNull();
    });

    it('after 5 s "Waiting for the research"; the limit is told to the caller', () => {
        const onLimit = vi.fn();
        const redraw = vi.fn();
        startPend('live:a', { label: strings.busy.turningOn, limitMs: 30_000, onLimit, redraw });
        vi.advanceTimersByTime(PEND_WAIT_MS - 1);
        expect(pendOf('live:a')?.phase).toBe('shown');
        vi.advanceTimersByTime(1);
        expect(pendOf('live:a')).toEqual({ phase: 'waiting', label: strings.busy.waitingResearch });
        expect(pendStatusHtml('live:a')).toContain(strings.busy.waitingResearch);
        vi.advanceTimersByTime(30_000 - PEND_WAIT_MS - 1);
        expect(onLimit).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onLimit).toHaveBeenCalledTimes(1);
    });

    it('a wait without "Waiting for the research" (Infinity) keeps its words', () => {
        startPend('k:war', { label: strings.busy.generic, waitMs: Infinity, redraw: () => undefined });
        vi.advanceTimersByTime(60_000);
        expect(pendOf('k:war')).toEqual({ phase: 'shown', label: strings.busy.generic });
    });

    it('a write begun again meanwhile keeps its state (the older answer does not end it)', async () => {
        startPend('k:war', { redraw: () => undefined });
        vi.advanceTimersByTime(150);
        const older = endPend('k:war');
        startPend('k:war', { redraw: () => undefined });
        await vi.advanceTimersByTimeAsync(300);
        await expect(older).resolves.toBe(false);
        expect(isPend('k:war')).toBe(true);
    });

    it('a group locks while one of its switches writes; dropped, the timers stop', () => {
        const redraw = vi.fn();
        startPend('hk:t1:kind:war', { redraw });
        expect(anyPend('hk:t1:kind:')).toBe(true);
        expect(anyPend('hk:t2:')).toBe(false);
        dropPend('hk:t1:kind:war');
        vi.advanceTimersByTime(PEND_WAIT_MS);
        expect(redraw).not.toHaveBeenCalled();
        expect(anyPend('hk:t1:kind:')).toBe(false);
    });

    it('the sentences of a group go together', async () => {
        startPend('hk:t1:kind:war', { redraw: () => undefined });
        await endPend('hk:t1:kind:war', { text: 'x' });
        startPend('hk:t2:kind:war', { redraw: () => undefined });
        await endPend('hk:t2:kind:war', { text: 'y' });
        clearPendRefusals('hk:t1:');
        expect(pendRefusalOf('hk:t1:kind:war')).toBeNull();
        expect(pendRefusalOf('hk:t2:kind:war')?.text).toBe('y');
    });
});
