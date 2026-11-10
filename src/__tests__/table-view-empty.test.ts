/**
 * The Table view's states in place of the grid (spec 073 §13): an empty tree
 * (with Add person unless read-only), Unions without unions, the built-in
 * Checks view without findings (Data quality › only with leads) and the
 * built-in Gaps view when nothing is missing. A changed view, a search or
 * findings still being computed keep the grid.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { setLanguage } from '../strings.js';
import { tableEmptyState, type TableEmptyInput } from '../ui/table-view/table-empty.js';
import { builtinId } from '../ui/table-view/table-views.js';

const base: TableEmptyInput = {
    persons: 12, unions: 4, type: 'persons', viewId: builtinId('overview'), viewChanged: false, search: '', shown: 12,
    checksDone: true, leads: 0, allComplete: () => false, readOnly: false,
};

describe('table empty states', () => {
    beforeAll(() => setLanguage('en'));

    it('draws the grid when the tree has rows', () => {
        expect(tableEmptyState(base)).toBeNull();
    });

    it('an empty tree offers Add person, a read-only one does not', () => {
        const s = tableEmptyState({ ...base, persons: 0, unions: 0, shown: 0 });
        expect(s?.kind).toBe('empty');
        expect(s?.title).toBe('The table is empty so far');
        expect(s?.action).toEqual({ id: 'add', label: '＋ Add person' });
        expect(tableEmptyState({ ...base, persons: 0, unions: 0, shown: 0, readOnly: true })?.action).toBeNull();
        // Also in the Unions table of an empty tree.
        expect(tableEmptyState({ ...base, persons: 0, unions: 0, shown: 0, type: 'unions' })?.kind).toBe('empty');
    });

    it('the Unions table without unions says when they appear', () => {
        const s = tableEmptyState({ ...base, type: 'unions', unions: 0, shown: 0, viewId: builtinId('marriages') });
        expect(s?.kind).toBe('noUnions');
        expect(s?.text).toBe('Unions appear here as soon as someone has a partner.');
        expect(tableEmptyState({ ...base, type: 'persons', unions: 0 })).toBeNull();
    });

    it('the Events table without events says when they appear (§14.1)', () => {
        const s = tableEmptyState({ ...base, type: 'events', events: 0, shown: 0, viewId: builtinId('events') });
        expect(s?.kind).toBe('noEvents');
        expect(s?.title).toBe('There is no event in the tree');
        expect(s?.action).toBeNull();
        expect(tableEmptyState({ ...base, type: 'events', events: 3, shown: 0, viewId: builtinId('events') })).toBeNull();
        expect(tableEmptyState({ ...base, type: 'persons', events: 0 })).toBeNull();
        // An empty tree says so in the Events table too.
        expect(tableEmptyState({ ...base, persons: 0, unions: 0, events: 0, shown: 0, type: 'events' })?.kind).toBe('empty');
    });

    it('the Checks view without findings: Data quality › only when there are leads', () => {
        const checks = { ...base, viewId: builtinId('checks'), shown: 0 };
        const none = tableEmptyState(checks);
        expect(none?.kind).toBe('noFindings');
        expect(none?.text).toBe('The checks found nothing worth checking.');
        expect(none?.action).toBeNull();
        const leads = tableEmptyState({ ...checks, leads: 2 });
        expect(leads?.text).toBe('The checks found nothing worth checking. Leads (2) are in Data quality.');
        expect(leads?.action).toEqual({ id: 'quality', label: 'Data quality ›' });
        // Still computing, a search, a changed view or another view: the grid (with its no-match line).
        expect(tableEmptyState({ ...checks, checksDone: false })).toBeNull();
        expect(tableEmptyState({ ...checks, search: 'Orvin' })).toBeNull();
        expect(tableEmptyState({ ...checks, viewChanged: true })).toBeNull();
        expect(tableEmptyState({ ...checks, viewId: builtinId('overview') })).toBeNull();
        expect(tableEmptyState({ ...checks, shown: 3 })).toBeNull();
    });

    it('the Gaps view when nothing is missing; completeness asked only there', () => {
        let asked = 0;
        const complete = (): boolean => { asked++; return true; };
        const s = tableEmptyState({ ...base, viewId: builtinId('gaps'), allComplete: complete });
        expect(s?.kind).toBe('nothingMissing');
        expect(s?.text).toBe('All tracked fields (birth, unions, death and their sources) are filled in for all 12 people.');
        expect(tableEmptyState({ ...base, viewId: builtinId('gaps'), shown: 1, allComplete: complete })?.text).toContain('for the one person');
        expect(tableEmptyState({ ...base, viewId: builtinId('gaps'), allComplete: () => false })).toBeNull();
        asked = 0;
        tableEmptyState({ ...base, allComplete: complete });
        expect(asked).toBe(0);
    });
});
