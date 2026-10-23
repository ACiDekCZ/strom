/**
 * The card's children tab (hiddenRelativesTabs): "▸ children" while any
 * child is out of view, "▾ children" (childrenShown) while the view shows the
 * person's children in place; "?" stand-ins never count.
 */

import { describe, it, expect } from 'vitest';
import { hiddenRelativesTabs, hiddenChildIds, newlyShownChildIds } from '../marriage-order.js';
import { tabsGlyphsOnly } from '../union-order-measure.js';
import { PersonId, PartnershipId, Person, StromData } from '../types.js';

function tree(): StromData {
    const d = { persons: {}, partnerships: {} } as unknown as StromData;
    const add = (id: string, gender: 'male' | 'female', isPlaceholder = false): PersonId => {
        d.persons[id as PersonId] = {
            id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder,
            partnerships: [], parentIds: [], childIds: [],
        } as Person;
        return id as PersonId;
    };
    const fam = (id: string, a: PersonId, b: PersonId, kids: PersonId[]): void => {
        d.partnerships[id as PartnershipId] = { id: id as PartnershipId, person1Id: a, person2Id: b, childIds: kids, status: 'married' };
        for (const p of [a, b]) { d.persons[p].partnerships.push(id as PartnershipId); d.persons[p].childIds.push(...kids); }
        for (const k of kids) d.persons[k].parentIds.push(a, b);
    };
    const gf = add('gf', 'male'), gm = add('gm', 'female');
    const father = add('father', 'male'), aunt = add('aunt', 'female'), uncle = add('uncle', 'male');
    fam('u1', gf, gm, [father, aunt, uncle]);
    const q = add('q', 'female', true), stand = add('stand_child', 'male', true);
    fam('u2', uncle, q, [stand]);
    return d;
}

describe('children tab', () => {
    const d = tree();
    const P = (id: string) => id as PersonId;
    const kids = new Set([P('father'), P('aunt'), P('uncle')]);

    it('shows while any child is out of view (the direct line\'s parent with the father in view)', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids)).toEqual(['children']);
        expect(hiddenChildIds(d, P('gf'), inView)).toEqual([P('aunt'), P('uncle')]);
    });

    it('none while every child is in view', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father', 'aunt', 'uncle'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids)).toEqual([]);
    });

    it('the shown state while the view shows the children in place, whatever is in view', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father', 'aunt', 'uncle'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids, new Set([P('gf')]))).toEqual(['childrenShown']);
        expect(hiddenRelativesTabs(d, P('gm'), inView, kids, new Set([P('gf')]))).toEqual([]);
    });

    it('a "?" stand-in child never counts', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'uncle'].includes(id);
        expect(hiddenChildIds(d, P('uncle'), inView)).toEqual([]);
        expect(hiddenRelativesTabs(d, P('uncle'), inView, kids)).not.toContain('children');
    });

    it('the shown state names only the children the click brought into view, never ones drawn before', () => {
        // The father stood in view before; the aunt and the uncle came with the click
        const before = new Set([P('father')]);
        const after = (id: PersonId) => ['gf', 'gm', 'father', 'aunt', 'uncle'].includes(id);
        expect(newlyShownChildIds(d, P('gf'), after, before)).toEqual([P('aunt'), P('uncle')]);
        // A click that drew nothing new names nobody
        const same = (id: PersonId) => ['gf', 'gm', 'father'].includes(id);
        expect(newlyShownChildIds(d, P('gf'), same, before)).toEqual([]);
        // "?" stand-ins never count
        expect(newlyShownChildIds(d, P('uncle'), () => true, new Set())).toEqual([]);
    });

    it('no tab for a person whose children a click drew none of (the safety net)', () => {
        const inView = (id: PersonId) => ['gf', 'gm', 'father'].includes(id);
        expect(hiddenRelativesTabs(d, P('gf'), inView, kids, new Set(), new Set([P('gf')]))).toEqual([]);
        // Another person keeps theirs
        expect(hiddenRelativesTabs(d, P('gm'), inView, kids, new Set(), new Set([P('gf')]))).toEqual(['children']);
    });

    it('keeps the order parents, siblings, children', () => {
        const inView = (id: PersonId) => id === 'uncle';
        // uncle: parents and siblings out of view; his only child is a stand-in
        expect(hiddenRelativesTabs(d, P('uncle'), inView, kids)).toEqual(['parents', 'siblings']);
        expect(hiddenRelativesTabs(d, P('uncle'), inView, kids, new Set([P('uncle')]))).toEqual(['parents', 'siblings', 'childrenShown']);
    });
});

describe('tabsGlyphsOnly', () => {
    // The default card: 188px wide, both corner insets 13px
    const room = 188 - 2 * 13;

    it('three tabs never fit with their words: the glyphs alone', () => {
        expect(tabsGlyphsOnly(['parents', 'siblings', 'children'], room)).toBe(true);
    });

    it('two tabs and one keep their words', () => {
        expect(tabsGlyphsOnly(['parents', 'siblings'], room)).toBe(false);
        expect(tabsGlyphsOnly(['children'], 20)).toBe(false);
        expect(tabsGlyphsOnly([], room)).toBe(false);
    });
});
