import { describe, expect, it } from 'vitest';
import { mapScopeAfterSelection, mapScopeOnOpen, mapScopePersonIds } from '../map-scope';
import type { PersonId } from '../types';

const ids = (...s: string[]) => new Set(s.map(x => x as PersonId));

describe('mapScopePersonIds', () => {
    const view = ids('a', 'b');
    const sel = ids('c');

    it('This view: the people laid out now', () => {
        expect(mapScopePersonIds('view', () => view, () => sel)).toBe(view);
    });

    it('Selection: the selection\'s people, none when the selection is gone', () => {
        expect(mapScopePersonIds('sel', () => view, () => sel)).toBe(sel);
        expect(mapScopePersonIds('sel', () => view, () => null)?.size).toBe(0);
    });

    it('Whole tree: everybody (no filter), the sets not even read', () => {
        let read = 0;
        expect(mapScopePersonIds('tree', () => { read++; return view; }, () => { read++; return sel; })).toBeUndefined();
        expect(read).toBe(0);
    });
});

describe('mapScopeOnOpen', () => {
    it('the remembered scope, Selection only with a selection', () => {
        expect(mapScopeOnOpen(null, true)).toBe('view');
        expect(mapScopeOnOpen('tree', false)).toBe('tree');
        expect(mapScopeOnOpen('sel', true)).toBe('sel');
        expect(mapScopeOnOpen('sel', false)).toBe('view');
    });
});

describe('mapScopeAfterSelection', () => {
    it('a selection cleared or gone takes Selection back to This view', () => {
        expect(mapScopeAfterSelection('sel', 'clear', false)).toBe('view');
        expect(mapScopeAfterSelection('sel', 'gone', false)).toBe('view');
        expect(mapScopeAfterSelection('sel', 'tree', false)).toBe('view');
        expect(mapScopeAfterSelection('sel', 'set', true)).toBe('sel');
        expect(mapScopeAfterSelection('sel', 'hideOthers', true)).toBe('sel');
    });

    it('the other scopes stay', () => {
        expect(mapScopeAfterSelection('view', 'clear', false)).toBe('view');
        expect(mapScopeAfterSelection('tree', 'gone', false)).toBe('tree');
    });
});
