/**
 * A conflict whose one side is empty — a value deleted in the app (or never
 * in the research): shown as "(empty)", never as nothing, and read by what
 * the other side says (a deleted date is still a date conflict). Invented
 * data only.
 */

import { describe, it, expect } from 'vitest';
import { conflictValueHtml, conflictValueSaid, isDateConflict } from '../ui/person-research-ui.js';
import { strings } from '../strings.js';
import { ResearchConflict } from '../types.js';

const conflict = (fact: string, research: string, user: string): ResearchConflict => ({
    id: 'X0007', fact, status: 'open', take: true, values: [{ value: research, side: 'research' }, { value: user, side: 'user' }],
});

describe('an empty side of a conflict', () => {
    it('is said as "(empty)" and shown muted, never blank; a value as it is', () => {
        expect(conflictValueSaid('')).toBe(strings.conflict.empty);
        expect(conflictValueSaid('MUDr.')).toBe('MUDr.');
        expect(conflictValueHtml('')).toBe(`<span class="prc-empty">${strings.conflict.empty}</span>`);
        expect(conflictValueHtml('<b>')).toBe('&lt;b&gt;');
    });

    it('a deleted date is still about the date, a deleted place about the place', () => {
        expect(isDateConflict(conflict('BIRT', '3 FEB 1865', ''))).toBe(true);
        expect(isDateConflict(conflict('BIRT', '', '1865'))).toBe(true);
        expect(isDateConflict(conflict('BIRT', 'Chlumy', ''))).toBe(false);
        expect(isDateConflict(conflict('NPFX', 'MUDr.', ''))).toBe(false);
        // Both said: as before.
        expect(isDateConflict(conflict('BIRT', '3 FEB 1865', '1865'))).toBe(true);
        expect(isDateConflict(conflict('BIRT', 'Chlumy', '1865'))).toBe(false);
    });
});
