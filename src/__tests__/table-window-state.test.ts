/**
 * The Table opened in a new window (spec 079 §1): the state the main window's
 * Table hands over (row type, open view, filters, sort, search, selected row)
 * survives the channel and is taken over by the new window's Table as it was.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { setLanguage } from '../strings.js';
import type { TableView } from '../types.js';
import { defaultTableState, sortClick } from '../ui/table-view/table-state.js';
import { setChip } from '../ui/table-view/table-filter.js';
import { applyView, openViewOf, viewChanged } from '../ui/table-view/table-views.js';
import { applyTableWindowState, readTableWindowState, tableWindowStateOf } from '../ui/table-view/table-window-state.js';

beforeAll(() => setLanguage('en'));

function saved(): TableView {
    return {
        id: 'tv-mlyny', name: 'Mlýny u Lopuchova', rowType: 'persons', columns: [{ id: 'name', width: 230 }, { id: 'bapDate' }, { id: 'bapPlace' }], pinned: 1,
        collapsedGroups: [], coverageRow: true, filter: { op: 'and', items: [{ chip: 'deceased' }] },
        sort: [{ col: 'bapDate', dir: -1 }], updated: '2026-11-10T09:30:00.000Z',
    } as TableView;
}

/** The main window's Table: the saved view open, a chip and a sort changed on top, a search and a selected row. */
function mainState() {
    const state = defaultTableState();
    const st = state.types.persons;
    state.open.persons = 'tv-mlyny';
    applyView(saved(), st);
    setChip(st.filter, 'living', true);
    sortClick(st, 'name');
    st.search = 'Vrtiš';
    st.selected = 'p:c';
    st.top = 640;
    return state;
}

describe('a Table window takes the main window\'s Table over', () => {
    it('the row type, the open view, its filters and sort as they are now, the search and the selected row', () => {
        const stored = [saved()];
        const ws = tableWindowStateOf(mainState(), stored);
        // Over the channel: a structured clone, read back as a carried state.
        const carried = readTableWindowState(structuredClone(ws));
        expect(carried).not.toBeNull();

        const state = defaultTableState();
        state.rowType = 'events';
        applyTableWindowState(state, carried!, stored);

        const st = state.types.persons;
        expect(state.rowType).toBe('persons');
        expect(state.open.persons).toBe('tv-mlyny');
        expect(openViewOf(state, 'persons', stored).id).toBe('tv-mlyny');
        expect(st.filter).toEqual(mainState().types.persons.filter);
        expect(st.sort).toEqual([{ col: 'name', dir: 'asc' }]);
        expect(st.columns).toEqual(mainState().types.persons.columns);
        expect(st.search).toBe('Vrtiš');
        expect(st.selected).toBe('p:c');
        expect(st.top).toBe(0);
        // The changes on top of the saved view stay changes: Reset to default still returns to the saved view.
        expect(viewChanged(saved(), st)).toBe(true);
    });

    it('a built-in view and another row type', () => {
        const main = defaultTableState();
        main.rowType = 'events';
        main.types.events.search = 'Lopuchov';
        const carried = readTableWindowState(structuredClone(tableWindowStateOf(main, [])));
        const state = defaultTableState();
        applyTableWindowState(state, carried!, []);
        expect(state.rowType).toBe('events');
        expect(state.open.events).toBe(main.open.events);
        expect(state.types.events.search).toBe('Lopuchov');
        expect(state.types.events.selected).toBeNull();
    });

    it('anything else over the channel is not a carried state', () => {
        expect(readTableWindowState(null)).toBeNull();
        expect(readTableWindowState('persons')).toBeNull();
        expect(readTableWindowState({ rowType: 'cats', view: saved() })).toBeNull();
        expect(readTableWindowState({ rowType: 'events', viewId: 'tv-mlyny', view: saved(), search: '', selected: null })).toBeNull();
        expect(readTableWindowState({ rowType: 'persons', viewId: 7, view: saved(), search: 3, selected: '' }))
            .toMatchObject({ rowType: 'persons', viewId: '', search: '', selected: null });
    });
});
