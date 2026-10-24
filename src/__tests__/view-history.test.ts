/**
 * The view's back/forward history (src/view-history.ts): a new focus,
 * children shown or hidden and a jump to a card elsewhere are steps; back
 * restores the view before a step and forward retraces it.
 */

import { describe, it, expect } from 'vitest';
import {
    ViewHistoryEntry, ShownChildrenSnapshot, emptyViewHistory, pushViewStep, stepViewHistory, liveEntry, sameShown,
    sameTransform, VIEW_HISTORY_LIMIT,
} from '../view-history.js';
import type { PersonId } from '../types.js';

const id = (s: string) => s as PersonId;
const shown = (...ids: string[]): ShownChildrenSnapshot[] =>
    ids.map(s => ({ id: id(s), visibleBefore: new Set([id(`${s}_kid`)]), broughtIn: new Set([id(`${s}_new`)]) }));
const entry = (focus: string, ...ids: string[]): ViewHistoryEntry => ({ focus: id(focus), shown: shown(...ids) });
const T0 = { scale: 1, tx: 0, ty: 0 };
const all = () => true;
const last = (stack: ViewHistoryEntry[]): ViewHistoryEntry => stack[stack.length - 1];

describe('view history', () => {
    it('a step pushes the view before it and clears forward', () => {
        const h = emptyViewHistory();
        h.forward.push(entry('x'));
        pushViewStep(h, entry('a'));
        expect(h.back.map(e => e.focus)).toEqual(['a']);
        expect(h.forward).toEqual([]);
    });

    it('keeps at most the limit of steps (the oldest drop out)', () => {
        const h = emptyViewHistory();
        for (let i = 0; i < VIEW_HISTORY_LIMIT + 5; i++) pushViewStep(h, entry(`p${i}`));
        expect(h.back).toHaveLength(VIEW_HISTORY_LIMIT);
        expect(h.back[0].focus).toBe('p5');
    });

    it('nested children shown, back twice, forward twice: each step retraced with the card it concerned', () => {
        const h = emptyViewHistory();
        // focus f; show the children of a, then of a's child c
        pushViewStep(h, { ...entry('f'), anchorId: id('a') });
        pushViewStep(h, { ...entry('f', 'a'), anchorId: id('c') });
        let current = entry('f', 'a', 'c');

        const b1 = stepViewHistory(h, 'back', current, T0, all)!;
        expect(b1.shown.map(s => s.id)).toEqual(['a']);
        expect(b1.anchorId).toBe('c');
        expect(last(h.forward).shown.map(s => s.id)).toEqual(['a', 'c']);
        expect(last(h.forward).anchorId).toBe('c');
        current = b1;

        const b2 = stepViewHistory(h, 'back', current, T0, all)!;
        expect(b2.shown).toEqual([]);
        expect(b2.anchorId).toBe('a');
        expect(h.back).toEqual([]);
        current = b2;

        const f1 = stepViewHistory(h, 'forward', current, T0, all)!;
        expect(f1.shown.map(s => s.id)).toEqual(['a']);
        expect(f1.anchorId).toBe('a');
        current = f1;
        const f2 = stepViewHistory(h, 'forward', current, T0, all)!;
        expect(f2.shown.map(s => s.id)).toEqual(['a', 'c']);
        // what closing needs comes back with the entry
        expect([...f2.shown[1].broughtIn]).toEqual(['c_new']);
        expect([...f2.shown[0].visibleBefore]).toEqual(['a_kid']);
        expect(h.forward).toEqual([]);
        expect(h.back).toHaveLength(2);
    });

    it('"Hide shown children": back brings every expansion at once, forward hides them again as hide all', () => {
        const h = emptyViewHistory();
        pushViewStep(h, { ...entry('f', 'a', 'b'), anchorId: id('a'), restoreView: true });
        const back = stepViewHistory(h, 'back', entry('f'), T0, all)!;
        expect(back.shown.map(s => s.id)).toEqual(['a', 'b']);
        const fwd = stepViewHistory(h, 'forward', back, T0, all, undefined, p => p === 'a' ? { x: 40, y: 50 } : null)!;
        expect(fwd.shown).toEqual([]);
        expect(fwd.restoreView).toBe(true);
        expect(fwd.anchorId).toBe('a');
        // the way back again: the first card goes where it stands now
        expect(last(h.back).anchorAt).toEqual({ x: 40, y: 50 });
        expect(last(h.back).shown.map(s => s.id)).toEqual(['a', 'b']);
    });

    it('a new focus: back returns the focus with the children it showed, forward the new focus with its own', () => {
        const h = emptyViewHistory();
        pushViewStep(h, entry('f', 'a'));
        const back = stepViewHistory(h, 'back', entry('g', 'x'), T0, all)!;
        expect(back.focus).toBe('f');
        expect(back.shown.map(s => s.id)).toEqual(['a']);
        expect(back.anchorId).toBeUndefined();
        const fwd = stepViewHistory(h, 'forward', back, T0, all)!;
        expect(fwd.focus).toBe('g');
        expect(fwd.shown.map(s => s.id)).toEqual(['x']);
    });

    it('a jump: back returns the pan and zoom before it, forward the ones it left', () => {
        const h = emptyViewHistory();
        const before = { scale: 0.8, tx: 10, ty: 20 };
        const after = { scale: 0.8, tx: -400, ty: 90 };
        pushViewStep(h, { ...entry('f', 'a'), view: before });
        const back = stepViewHistory(h, 'back', entry('f', 'a'), after, all)!;
        expect(back.view).toEqual(before);
        expect(last(h.forward).view).toEqual(after);
        const fwd = stepViewHistory(h, 'forward', back, { scale: 1, tx: 0, ty: 0 }, all)!;
        expect(fwd.view).toEqual(after);
        // a step without a jump carries no pan and zoom
        pushViewStep(h, entry('f'));
        stepViewHistory(h, 'back', entry('g'), after, all);
        expect(last(h.forward).view).toBeUndefined();
    });

    it('skips an entry whose focus was deleted and drops shown children of deleted persons', () => {
        const h = emptyViewHistory();
        pushViewStep(h, entry('f', 'a', 'gone'));
        pushViewStep(h, entry('deleted'));
        const exists = (p: PersonId) => p !== 'deleted' && p !== 'gone';
        const back = stepViewHistory(h, 'back', entry('g'), T0, exists)!;
        expect(back.focus).toBe('f');
        expect(back.shown.map(s => s.id)).toEqual(['a']);
        expect(h.back).toEqual([]);
        expect(h.forward).toHaveLength(1);
        expect(liveEntry(entry('deleted'), exists)).toBeNull();
    });

    it('`usable` skips entries (outside the family view: a step of the children alone)', () => {
        const h = emptyViewHistory();
        pushViewStep(h, entry('e'));
        pushViewStep(h, { ...entry('f'), anchorId: id('a') });
        const current = entry('f');
        const back = stepViewHistory(h, 'back', current, T0, all, e => e.focus !== current.focus)!;
        expect(back.focus).toBe('e');
        expect(h.forward).toHaveLength(1);
    });

    it('nothing to step to: null, the stacks stay', () => {
        const h = emptyViewHistory();
        expect(stepViewHistory(h, 'back', entry('f'), T0, all)).toBeNull();
        expect(h.forward).toEqual([]);
    });

    it('sameShown compares order; sameTransform tolerates sub-pixel pans', () => {
        expect(sameShown(shown('a', 'b'), shown('a', 'b'))).toBe(true);
        expect(sameShown(shown('a', 'b'), shown('b', 'a'))).toBe(false);
        expect(sameShown(shown('a'), shown('a', 'b'))).toBe(false);
        expect(sameTransform({ scale: 1, tx: 0, ty: 0 }, { scale: 1, tx: 0.2, ty: -0.3 })).toBe(true);
        expect(sameTransform({ scale: 1, tx: 0, ty: 0 }, { scale: 1, tx: 3, ty: 0 })).toBe(false);
        expect(sameTransform({ scale: 1, tx: 0, ty: 0 }, { scale: 0.9, tx: 0, ty: 0 })).toBe(false);
    });
});
