/**
 * A row's short action from its ⋯ menu (waiting buttons §4, src/ui/row-busy.ts): locked at once, its look
 * (the spinner in the ⋯'s place, the row's words) after 120 ms, kept 300 ms at least once shown; the overview's
 * own window draws the rows as the main window has them. The drawn row (⋯ spinner, words) is checked in e2e.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RowBusy } from '../ui/row-busy.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T09:30:00Z'));
});
afterEach(() => {
    vi.useRealTimers();
});

describe('RowBusy', () => {
    it('locks at once and shows after 120 ms, asking for a redraw then', () => {
        const rows = new RowBusy();
        const redraw = vi.fn();
        rows.start('t1', 'Pausing…', redraw);
        expect(rows.has('t1')).toBe(true);
        expect(rows.view('t1')).toEqual({ shown: false, label: 'Pausing…' });
        vi.advanceTimersByTime(119);
        expect(redraw).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(redraw).toHaveBeenCalledTimes(1);
        expect(rows.view('t1')).toEqual({ shown: true, label: 'Pausing…' });
    });

    it('a quick answer ends it without ever showing it', async () => {
        const rows = new RowBusy();
        const redraw = vi.fn();
        rows.start('t1', 'Saving…', redraw);
        vi.advanceTimersByTime(50);
        await expect(rows.end('t1')).resolves.toBe(true);
        vi.advanceTimersByTime(500);
        expect(redraw).not.toHaveBeenCalled();
        expect(rows.view('t1')).toBeNull();
    });

    it('once shown, it stays 300 ms at least', async () => {
        const rows = new RowBusy();
        rows.start('t1', 'Saving…', () => {});
        vi.advanceTimersByTime(150);
        let done = false;
        void rows.end('t1').then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(200);
        expect(done).toBe(false);
        expect(rows.has('t1')).toBe(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(done).toBe(true);
        expect(rows.has('t1')).toBe(false);
    });

    it('mirrors another window without timers', () => {
        const rows = new RowBusy();
        rows.start('a', 'Saving…', () => {});
        rows.mirror([{ id: 'b', label: 'Pausing…', shown: true }, 'c']);
        expect(rows.ids()).toEqual(['b', 'c']);
        expect(rows.view('b')).toEqual({ shown: true, label: 'Pausing…' });
        expect(rows.snapshot()).toEqual([{ id: 'b', label: 'Pausing…', shown: true }, { id: 'c', label: '', shown: true }]);
    });
});
