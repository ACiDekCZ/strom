/**
 * A part of a documented fact deleted in the app (the research's side the
 * whole fact, the app's what is left of it): decidable by a side, read as a
 * conflict of the whole fact — a death whose date went (its place kept), a
 * death whose place went, an occupation's value, a couple's wedding date —
 * and an empty side only when nothing of the fact is left. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { conflictScope, isDateConflict } from '../ui/person-research-ui.js';
import { canDecideInApp } from '../research-decide.js';
import { ResearchConflict } from '../types.js';

const conflict = (fact: string, research: string, user: string): ResearchConflict => ({
    id: 'X0011', fact, status: 'open', take: true, values: [{ value: research, side: 'research' }, { value: user, side: 'user' }],
});

describe('a part of a documented fact deleted in the app', () => {
    it('decidable by a side: a person\'s death, a couple\'s wedding, an occupation (an event\'s value)', () => {
        const at = { refn: 'P0003' };
        expect(canDecideInApp(conflict('DEAT', '23. 10. 1865, Lipnice', 'Lipnice'), at)).toBe(true);
        expect(canDecideInApp(conflict('MARR', '12. 2. 1840, Lipnice', 'Lipnice'), at)).toBe(true);
        expect(canDecideInApp(conflict('OCCU', 'tkadlec, 1865', '1865'), at)).toBe(true);
        // Nothing of the fact left: the app's side empty, still decidable.
        expect(canDecideInApp(conflict('OCCU', 'tkadlec', ''), at)).toBe(true);
        expect(canDecideInApp(conflict('DEAT', '23. 10. 1865, Lipnice', ''), at)).toBe(true);
    });

    it('the date deleted (the place kept), the place deleted (the date kept): the whole fact, not its place', () => {
        expect(isDateConflict(conflict('DEAT', '23. 10. 1865, Lipnice', 'Lipnice'))).toBe(false);
        expect(conflictScope(conflict('DEAT', '23. 10. 1865, Lipnice', 'Lipnice'))).toBe('fact');
        expect(conflictScope(conflict('DEAT', '23. 10. 1865, Lipnice', '23. 10. 1865'))).toBe('fact');
        expect(conflictScope(conflict('DEAT', '23. 10. 1865, Lipnice', ''))).toBe('fact');
        expect(conflictScope(conflict('MARR', '12. 2. 1840, Lipnice', 'Lipnice'))).toBe('fact');
        expect(conflictScope(conflict('OCCU', 'tkadlec, 1865', '1865'))).toBe('fact');
    });

    it('a conflict of one part reads as before: the date, the place, the value, the name', () => {
        expect(conflictScope(conflict('BIRT', '3 FEB 1865', '1865'))).toBe('date');
        expect(conflictScope(conflict('BIRT', '3 FEB 1865', ''))).toBe('date');
        expect(conflictScope(conflict('BIRT', 'Chlumy', 'Lipnice'))).toBe('place');
        expect(conflictScope(conflict('BIRT', 'Chlumy', ''))).toBe('place');
        expect(conflictScope(conflict('OCCU', 'tkadlec', ''))).toBe('place');
        expect(conflictScope(conflict('NPFX', 'MUDr.', ''))).toBe('place');
        expect(conflictScope(conflict('NAME', 'Jan /Novák 1865/', 'Jan /Novák/'))).toBe('place');
    });
});
