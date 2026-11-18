/**
 * A row of Awaiting action and its own optimistic write (waiting buttons §7):
 * "saving" until the research confirms, then nothing (no ✓); refused, the row
 * back where it was, tinted for 10 s or until the next action in it, with its
 * sentence until a new try or a change of the item. And the actions of rows
 * that just moved take no click for a moment (109 U4). Invented items only.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { WaitingRowNotes, WAITING_REFUSED_TINT_MS } from '../ui/waiting-row-notes.js';
import { holdAfterShift, shiftHeld, SHIFT_HOLD_MS } from '../ui/busy.js';
import { applyWaitingPending, WaitingPending } from '../research-waiting-write.js';
import { sanitizeWaiting } from '../research-link.js';
import { waitingPhase } from '../research-waiting.js';

const items = sanitizeWaiting([
    { id: 'T0001', what: 'Dopis archivu Vzorov', at: '2026-10-01T08:00:00Z', kind: 'letter', actions: ['sent'] },
    { id: 'T0002', what: 'Matrika Lhota 1850–1870', at: '2026-10-02T08:00:00Z', kind: 'letter', actions: ['sent'] },
], true);

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T09:30:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('a row of its own write', () => {
    it('saving while written, nothing once confirmed (the row stays moved)', () => {
        const notes = new WaitingRowNotes();
        const pending = new Map<string, WaitingPending>([['T0001', { phase: 'sent', sentAt: '2026-11-18T09:30:00Z', until: Infinity }]]);
        notes.start(['T0001']);
        expect(notes.state('T0001')).toEqual({ kind: 'saving' });
        expect(notes.state('T0002')).toBeNull();
        expect(waitingPhase(applyWaitingPending(items, pending)[0])).toBe('sent');
        notes.confirm(['T0001']);
        pending.set('T0001', { phase: 'sent', until: Date.now() + 15_000 });
        expect(notes.state('T0001')).toBeNull();
        expect(waitingPhase(applyWaitingPending(items, pending)[0])).toBe('sent');
    });

    it('refused: back where it was, tinted for 10 s, the sentence and Try again stay', () => {
        const notes = new WaitingRowNotes();
        const pending = new Map<string, WaitingPending>([['T0001', { phase: 'sent', until: Infinity }]]);
        notes.start(['T0001']);
        const retry = vi.fn();
        // The write refused: its move undone (settleWaitingWrite restores), the row says why.
        pending.delete('T0001');
        notes.refuse(['T0001'], { text: 'Zápis se nepovedl: strom ve výzkumu drží jiná relace.', retry, phase: 'todo' });
        expect(waitingPhase(applyWaitingPending(items, pending)[0])).toBe('todo');
        const now = notes.state('T0001');
        expect(now?.kind).toBe('refused');
        expect(now?.kind === 'refused' && now.tint).toBe(true);
        expect(notes.nextTintEnd()).toBe(Date.now() + WAITING_REFUSED_TINT_MS);
        vi.advanceTimersByTime(WAITING_REFUSED_TINT_MS - 1);
        expect(notes.state('T0001')).toMatchObject({ kind: 'refused', tint: true });
        vi.advanceTimersByTime(1);
        const later = notes.state('T0001');
        expect(later).toMatchObject({ kind: 'refused', tint: false });
        expect(later?.kind === 'refused' && later.refusal.text).toContain('jiná relace');
        expect(notes.nextTintEnd()).toBeNull();
        later?.kind === 'refused' && later.refusal.retry?.();
        expect(retry).toHaveBeenCalledOnce();
    });

    it('the next action in the row ends the tint before 10 s; a new try ends the sentence', () => {
        const notes = new WaitingRowNotes();
        notes.refuse(['T0001'], { text: 'Výzkum je zaneprázdněný.', phase: 'todo' });
        expect(notes.touch('T0001')).toBe(true);
        expect(notes.touch('T0001')).toBe(false);
        expect(notes.state('T0001')).toMatchObject({ kind: 'refused', tint: false });
        notes.start(['T0001']);
        expect(notes.state('T0001')).toEqual({ kind: 'saving' });
    });

    it('the sentence goes when the item is gone or the research says it elsewhere now', () => {
        const notes = new WaitingRowNotes();
        notes.refuse(['T0001', 'T0002'], { text: 'Zápis se nepovedl.', phase: 'todo' });
        notes.settle([{ id: 'T0001', phase: 'todo' }, { id: 'T0002', phase: 'sent' }]);
        expect(notes.state('T0001')?.kind).toBe('refused');
        expect(notes.state('T0002')).toBeNull();
        notes.settle([]);
        expect(notes.state('T0001')).toBeNull();
    });

    it('the overview’s own window gets the states without the actions', () => {
        const notes = new WaitingRowNotes();
        notes.start(['T0002']);
        notes.refuse(['T0001'], { text: 'Zápis se nepovedl.', retry: () => {}, phase: 'todo' });
        expect(notes.snapshot()).toEqual({ saving: ['T0002'], refused: [{ id: 'T0001', text: 'Zápis se nepovedl.', tint: true, retry: true }] });
    });
});

describe('rows that just moved (109 U4)', () => {
    it('their actions take no click for 400 ms, then do again', () => {
        expect(shiftHeld('rows-test')).toBe(false);
        holdAfterShift('rows-test');
        expect(shiftHeld('rows-test')).toBe(true);
        expect(shiftHeld('other-rows')).toBe(false);
        // A click with no pointer press (Enter, Space on the focused button) is not held: the focus stays put.
        expect(shiftHeld('rows-test', { type: 'click', isTrusted: true, detail: 0 } as unknown as Event)).toBe(false);
        expect(shiftHeld('rows-test', { type: 'click', isTrusted: true, detail: 1 } as unknown as Event)).toBe(true);
        vi.advanceTimersByTime(SHIFT_HOLD_MS - 1);
        expect(shiftHeld('rows-test')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(shiftHeld('rows-test')).toBe(false);
    });
});
