/**
 * The search scope (spec 137 K1): the direct line is the person, all their
 * ancestors and all their descendants — no partners, no in-laws, no
 * placeholders — and a cycle in the data does not loop; the state is one
 * for the whole app, starts as the whole tree and is never stored.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    directLineIds, effectiveScope, getSearchScope, narrowIds, offeredScopes, onSearchScope,
    resetSearchScopeForTests, setSearchScope, stepScope,
} from '../search-scope.js';
import { getStringsForLang } from '../strings.js';
import type { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';

const P = (id: string): PersonId => id as PersonId;

interface Spec { parents?: string[]; placeholder?: boolean }

/** A small tree: people with their parents, unions [id, a, b, children]. */
function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][] = []): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: P(id), firstName: id, lastName: 'Ostrožný', gender: 'male',
            parentIds: (s.parents ?? []).map(P), childIds: [], partnerships: [],
            ...(s.placeholder ? { isPlaceholder: true } : {}),
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: P(a), person2Id: P(b), childIds: kids.map(P), status: 'married' } as Partnership;
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 13, persons, partnerships } as unknown as StromData;
}

// Four generations around jan: his parents and grandparents, his wife marie
// (with her own parents), their son and grandson, the son's wife, and jan's
// brother with his wife — none of the partners or their kin is in the line.
const ostrozni = (): StromData => tree({
    deda: {}, baba: {},
    otec: { parents: ['deda', 'baba'] }, matka: {},
    jan: { parents: ['otec', 'matka'] },
    bratr: { parents: ['otec', 'matka'] }, svagrova: {},
    marie: { parents: ['tchan'] }, tchan: {},
    syn: { parents: ['jan', 'marie'] }, snacha: {},
    vnuk: { parents: ['syn', 'snacha'] },
    nikdo: { placeholder: true },
}, [
    ['u1', 'deda', 'baba', ['otec']],
    ['u2', 'otec', 'matka', ['jan', 'bratr']],
    ['u3', 'jan', 'marie', ['syn']],
    ['u4', 'syn', 'snacha', ['vnuk']],
    ['u5', 'bratr', 'svagrova', []],
]);

describe('directLineIds', () => {
    it('is the person, the ancestors and the descendants over generations, without partners and in-laws', () => {
        const ids = [...directLineIds(ostrozni(), P('jan'))].sort();
        expect(ids).toEqual(['baba', 'deda', 'jan', 'matka', 'otec', 'syn', 'vnuk']);
    });

    it('leaves out placeholders but keeps the real ancestors above them', () => {
        const data = tree({
            jan: { parents: ['nezname'] }, nezname: { placeholder: true, parents: ['praded'] }, praded: {},
        });
        expect([...directLineIds(data, P('jan'))].sort()).toEqual(['jan', 'praded']);
    });

    it('does not loop on a cycle in the data', () => {
        const data = tree({ a: { parents: ['b'] }, b: { parents: ['a'] } });
        expect([...directLineIds(data, P('a'))].sort()).toEqual(['a', 'b']);
    });

    it('is empty for a person not in the tree', () => {
        expect(directLineIds(ostrozni(), P('gone')).size).toBe(0);
    });

    it('keeps a line per revision and works it out again after a change of the data', () => {
        const data = ostrozni();
        const first = directLineIds(data, P('jan'), 1);
        expect(directLineIds(data, P('jan'), 1)).toBe(first);
        // A new child of the grandson, the tree changed in place.
        data.persons[P('pravnuk')] = { ...data.persons[P('vnuk')], id: P('pravnuk'), parentIds: [P('vnuk')], childIds: [], partnerships: [] };
        data.persons[P('vnuk')].childIds.push(P('pravnuk'));
        expect(directLineIds(data, P('jan'), 1).has(P('pravnuk'))).toBe(false);
        expect(directLineIds(data, P('jan'), 2).has(P('pravnuk'))).toBe(true);
    });
});

describe('narrowing', () => {
    const line = new Set([P('a'), P('b')]);
    const view = new Set([P('c')]);

    it('narrows to the chosen offered scope, the whole tree is no narrowing', () => {
        expect(narrowIds('tree', { line, view })).toBeNull();
        expect(narrowIds('line', { line, view })).toBe(line);
        expect(narrowIds('view', { line, view })).toBe(view);
    });

    it('takes a scope not offered here as the whole tree', () => {
        expect(narrowIds('view', { line, view: null })).toBeNull();
        expect(effectiveScope('view', { line, view: null })).toBe('tree');
        expect(effectiveScope('line', { line: null, view })).toBe('tree');
    });

    it('offers the whole tree always, the others when they have people to narrow to', () => {
        expect(offeredScopes({ line: null, view: null })).toEqual(['tree']);
        expect(offeredScopes({ line, view: null })).toEqual(['tree', 'line']);
        expect(offeredScopes({ line, view })).toEqual(['tree', 'line', 'view']);
    });

    it('steps among the offered scopes without wrapping (Alt+←/→)', () => {
        expect(stepScope('tree', { line, view }, 1)).toBe('line');
        expect(stepScope('line', { line, view }, 1)).toBe('view');
        expect(stepScope('view', { line, view }, 1)).toBe('view');
        expect(stepScope('tree', { line: null, view }, 1)).toBe('view');
        expect(stepScope('tree', { line, view }, -1)).toBe('tree');
    });
});

describe('the scope state', () => {
    beforeEach(() => resetSearchScopeForTests());
    afterEach(() => { resetSearchScopeForTests(); vi.unstubAllGlobals(); });

    it('starts as the whole tree, tells its listeners of a change, and stores nothing', () => {
        const setItem = vi.fn();
        vi.stubGlobal('localStorage', { setItem, getItem: () => null, removeItem: vi.fn() });
        expect(getSearchScope()).toBe('tree');
        const heard: string[] = [];
        const off = onSearchScope(s => heard.push(s));
        setSearchScope('line');
        setSearchScope('line');
        setSearchScope('view');
        off();
        setSearchScope('tree');
        expect(heard).toEqual(['line', 'view']);
        expect(setItem).not.toHaveBeenCalled();
    });

    it('is the whole tree again after a new start', () => {
        setSearchScope('line');
        resetSearchScopeForTests();
        expect(getSearchScope()).toBe('tree');
    });
});

describe('texts', () => {
    it('has every key of the search scope in all four languages', () => {
        const keys = Object.keys(getStringsForLang('en').searchScope).sort();
        for (const l of ['cs', 'de', 'pl'] as const) expect(Object.keys(getStringsForLang(l).searchScope).sort()).toEqual(keys);
        expect(getStringsForLang('cs').searchScope.emptyLine(3)).toBe('V přímé linii nikdo. V celém stromu 3 shody.');
    });
});
