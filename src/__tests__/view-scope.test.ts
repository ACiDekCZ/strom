import { describe, expect, it } from 'vitest';
import {
    isViewScope, scopeAfterSelection, scopeDefault, scopeHighlightIds, scopeIdList, scopeOnOpen, scopePersonIds,
    SCOPED_VIEWS, type ScopedView,
} from '../view-scope';
import type { PersonId } from '../types';

const ids = (...s: string[]) => new Set(s.map(x => x as PersonId));

describe('scopePersonIds', () => {
    const view = ids('a', 'b');
    const sel = ids('c');

    it('the three scopes: the people laid out, the selection\'s, everybody', () => {
        expect(scopePersonIds('view', () => view, () => sel)).toBe(view);
        expect(scopePersonIds('sel', () => view, () => sel)).toBe(sel);
        expect(scopePersonIds('tree', () => view, () => sel)).toBeUndefined();
    });

    it('Selection with the selection gone: nobody', () => {
        expect(scopePersonIds('sel', () => view, () => null)?.size).toBe(0);
    });
});

describe('scopeDefault', () => {
    it('the Map and the Timeline This view, the Table the whole tree', () => {
        expect(scopeDefault('map')).toBe('view');
        expect(scopeDefault('timeline')).toBe('view');
        expect(scopeDefault('table')).toBe('tree');
    });
});

describe('scopeOnOpen', () => {
    it('nothing remembered: the view\'s default', () => {
        expect(scopeOnOpen(null, true, 'map')).toBe('view');
        expect(scopeOnOpen(null, true, 'timeline')).toBe('view');
        expect(scopeOnOpen(null, false, 'table')).toBe('tree');
    });

    it('the remembered scope; Selection only with a selection', () => {
        for (const v of SCOPED_VIEWS) {
            expect(scopeOnOpen('tree', false, v)).toBe('tree');
            expect(scopeOnOpen('view', false, v)).toBe('view');
            expect(scopeOnOpen('sel', true, v)).toBe('sel');
        }
        expect(scopeOnOpen('sel', false, 'map')).toBe('view');
        expect(scopeOnOpen('sel', false, 'timeline')).toBe('view');
        expect(scopeOnOpen('sel', false, 'table')).toBe('tree');
    });

    it('the map by default (the old mapScopeOnOpen)', () => {
        expect(scopeOnOpen('sel', false)).toBe('view');
    });
});

describe('scopeAfterSelection', () => {
    const back: Record<ScopedView, string> = { map: 'view', timeline: 'view', table: 'tree' };

    it('a selection cleared or gone takes Selection back to the view\'s default', () => {
        for (const v of SCOPED_VIEWS) {
            expect(scopeAfterSelection('sel', 'clear', false, v)).toBe(back[v]);
            expect(scopeAfterSelection('sel', 'gone', false, v)).toBe(back[v]);
            expect(scopeAfterSelection('sel', 'tree', false, v)).toBe(back[v]);
        }
    });

    it('another selection or Hide others keeps Selection', () => {
        for (const v of SCOPED_VIEWS) {
            expect(scopeAfterSelection('sel', 'set', true, v)).toBe('sel');
            expect(scopeAfterSelection('sel', 'hideOthers', true, v)).toBe('sel');
            expect(scopeAfterSelection('sel', 'restore', true, v)).toBe('sel');
        }
    });

    it('the other scopes stay, whatever happened to the selection', () => {
        for (const v of SCOPED_VIEWS) {
            expect(scopeAfterSelection('view', 'clear', false, v)).toBe('view');
            expect(scopeAfterSelection('tree', 'gone', false, v)).toBe('tree');
        }
    });
});

describe('scopeHighlightIds', () => {
    const sel = ids('c');
    it('This view and Whole tree highlight the selection on the Map and the Timeline', () => {
        expect(scopeHighlightIds('map', 'tree', () => sel)).toBe(sel);
        expect(scopeHighlightIds('map', 'view', () => sel)).toBe(sel);
        expect(scopeHighlightIds('timeline', 'tree', () => sel)).toBe(sel);
    });

    it('no highlight: the scope Selection, no selection, the Table', () => {
        expect(scopeHighlightIds('map', 'sel', () => sel)).toBeNull();
        expect(scopeHighlightIds('map', 'tree', () => null)).toBeNull();
        expect(scopeHighlightIds('table', 'tree', () => sel)).toBeNull();
    });
});

describe('isViewScope', () => {
    it('only the three scopes', () => {
        expect(isViewScope('view')).toBe(true);
        expect(isViewScope('sel')).toBe(true);
        expect(isViewScope('tree')).toBe(true);
        expect(isViewScope('list')).toBe(false);
        expect(isViewScope(undefined)).toBe(false);
    });
});

describe('scopeIdList (the Timeline\'s rows, spec 098 §11a)', () => {
    const persons: Record<string, { firstName?: string; isPlaceholder?: boolean }> = {
        a: { firstName: 'Ada' },
        b: { firstName: 'Bo' },
        c: { firstName: 'Cid' },
        x: { isPlaceholder: true },
    };
    const view = ids('a', 'b');
    const sel = ids('c');

    it('This view: the people laid out now', () => {
        expect(scopeIdList('view', () => view, () => sel, persons)).toEqual(['a', 'b']);
    });

    it('Selection: the selection\'s people; the selection gone: nobody', () => {
        expect(scopeIdList('sel', () => view, () => sel, persons)).toEqual(['c']);
        expect(scopeIdList('sel', () => view, () => null, persons)).toEqual([]);
    });

    it('Whole tree: every real person, no placeholder', () => {
        expect(scopeIdList('tree', () => view, () => sel, persons).sort()).toEqual(['a', 'b', 'c']);
    });
});
