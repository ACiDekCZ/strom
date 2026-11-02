/**
 * Cards clear of the floating pills: the least vertical pan after which no
 * card lies under a pill, the kept card staying in the view.
 */

import { describe, it, expect } from 'vitest';
import { ClearRect, pillClearShift } from '../pill-clearance.js';

const box = (left: number, top: number, w: number, h: number): ClearRect => ({ left, top, right: left + w, bottom: top + h });
const VIEW = { top: 56, bottom: 750 };

describe('pillClearShift', () => {
    const pill = box(540, 112, 360, 40);

    it('no card under the pill, or no pill: no pan', () => {
        expect(pillClearShift([box(100, 112, 200, 64)], [pill], VIEW, { maxShift: 230 })).toBe(0);
        expect(pillClearShift([box(560, 120, 200, 64)], [], VIEW, { maxShift: 230 })).toBe(0);
    });

    it('a row under the top pill: the least pan, down below it with the room', () => {
        // The founder's row at 114–178 (as under the descendants badge at 750 px).
        const cards = [box(552, 114, 196, 64), box(764, 114, 186, 64), box(80, 258, 192, 64)];
        const dy = pillClearShift(cards, [pill], VIEW, { maxShift: 230 })!;
        expect(dy).toBe(152 + 8 - 114);
        for (const c of cards) expect(c.top + dy >= pill.bottom + 8 || c.bottom + dy <= pill.top - 8 || c.right <= pill.left || c.left >= pill.right).toBe(true);
    });

    it('a pan that would push another row under the pill is passed over', () => {
        // Rows 70 px apart: down would bring the row above in; up clears both.
        const above = box(560, 40, 196, 64);
        const under = box(560, 140, 196, 64);
        const dy = pillClearShift([above, under], [pill], { top: -400, bottom: 750 }, { maxShift: 230 })!;
        expect(dy).not.toBeNull();
        expect([above, under].every(c => c.top + dy >= pill.bottom + 8 || c.bottom + dy <= pill.top - 8)).toBe(true);
    });

    it('the bottom pill of a phone: the cards pan up; the kept card stays in the view', () => {
        const bottomPill = box(16, 723, 294, 50);
        const kept = box(96, 360, 196, 64);
        const low = box(136, 676, 190, 64);
        const dy = pillClearShift([kept, low], [bottomPill], { top: 56, bottom: 780 }, { keep: kept, maxShift: 260 })!;
        expect(dy).toBe(723 - 8 - 740);
        expect(kept.top + dy).toBeGreaterThanOrEqual(56);
    });

    it('no pan within the limit (or one that loses the kept card): the view stays', () => {
        const kept = box(560, 60, 196, 64);
        const under = box(560, 120, 196, 64);
        expect(pillClearShift([kept, under], [pill], VIEW, { keep: kept, maxShift: 20 })).toBeNull();
    });
});
