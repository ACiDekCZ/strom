import { describe, expect, it } from 'vitest';
import { JUMP_HISTORY_MAX, JumpHistory, jumpTargetCell, type JumpStep } from '../ui/table-view/table-jump.js';
import { personLinks } from '../ui/table-view/table-grid.js';
import type { CellValue } from '../ui/table-view/table-model.js';

/** Spec 103 U3: the Table's jumps by a person's name. */

const step = (from: string, to: string): JumpStep => ({
    from: { rowType: 'persons', row: `p:${from}`, key: `p:${from}`, col: 'father', scrollTop: 0, scrollLeft: 0, label: from },
    to: { personId: to, key: `p:${to}`, col: 'name', origin: null, label: to },
});

describe('JumpHistory', () => {
    it('goes back and forward over the jumps, a new jump drops the steps ahead', () => {
        const h = new JumpHistory();
        expect(h.any()).toBe(false);
        expect(h.canBack()).toBe(false);
        h.push(step('a', 'b'));
        h.push(step('b', 'c'));
        expect(h.backLabel()).toBe('b');
        expect(h.back()?.to.personId).toBe('c');
        expect(h.backLabel()).toBe('a');
        expect(h.forwardLabel()).toBe('c');
        expect(h.back()?.to.personId).toBe('b');
        expect(h.canBack()).toBe(false);
        expect(h.back()).toBeNull();
        expect(h.forward()?.to.personId).toBe('b');
        h.push(step('b', 'd'));
        expect(h.canForward()).toBe(false);
        expect(h.back()?.to.personId).toBe('d');
        expect(h.back()?.to.personId).toBe('b');
        expect(h.back()).toBeNull();
        h.clear();
        expect(h.any()).toBe(false);
    });

    it('keeps at most 50 steps, the oldest go first', () => {
        const h = new JumpHistory();
        for (let i = 0; i < JUMP_HISTORY_MAX + 5; i++) h.push(step(`p${i}`, `p${i + 1}`));
        let n = 0;
        while (h.back()) n++;
        expect(n).toBe(JUMP_HISTORY_MAX);
        expect(h.forwardLabel()).toBe('p6');
    });
});

describe('jumpTargetCell (decision D2)', () => {
    const shown = ['name', 'bDate', 'partner'];
    it('a partner lands on the Partner cell of the union\'s line', () => {
        expect(jumpTargetCell('partner', shown, 0, 1)).toEqual({ col: 'partner', sub: 0 });
        expect(jumpTargetCell('partner', shown, 1, 2)).toEqual({ col: 'partner', sub: 2 });
    });
    it('a parent, a godparent, a witness, a hidden Partner column: the Name cell', () => {
        expect(jumpTargetCell('father', shown, -1, 2)).toEqual({ col: 'name', sub: 0 });
        expect(jumpTargetCell('godparents', shown, -1, 0)).toEqual({ col: 'name', sub: 0 });
        expect(jumpTargetCell('partner', ['name', 'bDate'], 0, 2)).toEqual({ col: 'name', sub: 0 });
    });
});

describe('personLinks', () => {
    const base = { text: '', sortKey: '', empty: false } as CellValue;
    it('a parent\'s cell links its person; an aggregate, a written name or a participant\'s role do not', () => {
        expect(personLinks({ ...base, text: 'Kestrin Ostrolam', personId: 'c' } as CellValue)).toEqual([{ text: 'Kestrin Ostrolam', personId: 'c' }]);
        expect(personLinks({ ...base, text: '2 unions', personId: 'c', aggregate: true } as CellValue)).toEqual([]);
        expect(personLinks({
            ...base, text: 'A, B, C',
            names: [{ text: 'A', personId: 'a' }, { text: 'B' }, { text: 'C', personId: 'c', role: 'godparent' }],
        } as CellValue)).toEqual([{ text: 'A', personId: 'a' }]);
    });
});
