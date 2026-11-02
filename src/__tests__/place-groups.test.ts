import { describe, it, expect } from 'vitest';
import type { PersonId, StromData, PlaceRecord } from '../types.js';
import {
    placeVariantGroups, placeAliasMap, addPlaceAlias, sanitizePlaceAliases, mergePlaceAliases, placeAliasesFor,
    placeSpellingTargets, mergeSpellingPlaces, variantGroupKey, placeSearchNames,
} from '../place-groups.js';
import { placeKey, type PlaceUsage } from '../places.js';

const k = placeKey;

function usage(display: string, count: number, people: string[] = [display]): PlaceUsage {
    return {
        display, variants: new Map([[display, count]]), count,
        personIds: people as PersonId[], kinds: new Map(), houses: new Map(),
    };
}

function places(...list: PlaceUsage[]): Map<string, PlaceUsage> {
    return new Map(list.map(u => [k(u.display), u]));
}

const RECORD: PlaceRecord = {
    id: 'L0012',
    names: [{ name: 'Horní Lhota' }, { name: 'Ober-Lhota', lang: 'de', from: 1838, to: 1845 }],
};

function tree(refs: Record<string, string> = {}, aliases?: Record<string, string[]>): StromData {
    return {
        persons: {}, partnerships: {}, placeRecords: { L0012: RECORD }, placeRefs: refs,
        ...(aliases ? { placeAliases: aliases } : {}),
    } as StromData;
}

describe('placeVariantGroups', () => {
    it('groups a record’s spellings, old names, streets and houses under its name', () => {
        const data = tree({ [k('Horní Lhota')]: 'L0012', [k('H. Lhota')]: 'L0012', [k('Ober-Lhota')]: 'L0012' });
        const list = places(
            usage('Horní Lhota', 12, ['a', 'b']), usage('H. Lhota', 3, ['b', 'c']), usage('Ober-Lhota', 2, ['d']),
            usage('Horní Lhota, Lhotákova 23', 1, ['e']), usage('Horní Lhota 16', 1, ['f']), usage('Jinov', 4),
        );
        const groups = placeVariantGroups(list, { data });
        expect(groups).toHaveLength(1);
        const g = groups[0]!;
        expect(g).toMatchObject({ key: 'L0012', head: 'Horní Lhota', ownKey: k('Horní Lhota'), facts: 19, persons: 6 });
        expect(g.members).toEqual([
            { key: k('H. Lhota'), tag: 'var', same: true },
            { key: k('Ober-Lhota'), tag: 'old', period: '1838–1845', same: true },
            { key: k('Horní Lhota, Lhotákova 23'), tag: 'street', same: false },
            { key: k('Horní Lhota 16'), tag: 'house', same: false },
        ]);
        // Horní Lhota itself, H. Lhota and Ober-Lhota; the street and the house are counted as houses only.
        expect(g.spellings).toBe(3);
        expect(g.houses).toBe(2);
    });

    it('takes the most used spelling when no member is written as the record', () => {
        const data = tree({ [k('H. Lhota')]: 'L0012', [k('Hor. Lhota')]: 'L0012' });
        const [g] = placeVariantGroups(places(usage('H. Lhota', 2), usage('Hor. Lhota', 5)), { data });
        expect(g).toMatchObject({ head: 'Horní Lhota', ownKey: k('Hor. Lhota') });
        expect(g!.members).toEqual([{ key: k('H. Lhota'), tag: 'var', same: true }]);
        expect(g!.spellings).toBe(2);
    });

    it('groups the other names written down by Unify', () => {
        const data = { persons: {}, partnerships: {}, placeAliases: { [k('Lhotov')]: ['Lhotow'] } } as unknown as StromData;
        const aliases = placeAliasMap(data);
        const [g] = placeVariantGroups(places(usage('Lhotov', 9), usage('Lhotow', 1)), { data, aliases });
        expect(g).toMatchObject({ key: k('Lhotov'), head: 'Lhotov', ownKey: k('Lhotov'), members: [{ key: k('Lhotow'), tag: 'var', same: true }] });
    });

    it('tags a street the record itself names as a street on the map as the place', () => {
        const data = tree({ [k('Horní Lhota')]: 'L0012', [k('Horní Lhota, Lhotákova')]: 'L0012' });
        const [g] = placeVariantGroups(places(usage('Horní Lhota', 4), usage('Horní Lhota, Lhotákova', 1)), { data, known: () => new Set(['lhotakova']) });
        expect(g!.members).toEqual([{ key: k('Horní Lhota, Lhotákova'), tag: 'street', same: true }]);
        expect(placeSpellingTargets([g!]).get(k('Horní Lhota, Lhotákova'))).toBe(k('Horní Lhota'));
    });

    it('changes nothing without a record or another name', () => {
        const data = { persons: {}, partnerships: {} } as unknown as StromData;
        expect(placeVariantGroups(places(usage('Lhota', 5), usage('Lhota 16', 1), usage('Lhota 4', 1), usage('Lhota 7', 1)), { data })).toEqual([]);
        expect(variantGroupKey(k('Lhota'), { data })).toBeNull();
    });

    it('keeps a lone spelling with fewer than three houses out of a group', () => {
        const data = tree({ [k('Horní Lhota')]: 'L0012' });
        expect(placeVariantGroups(places(usage('Horní Lhota', 4), usage('Horní Lhota 16', 1)), { data })).toEqual([]);
        const three = placeVariantGroups(places(usage('Horní Lhota', 4), usage('Horní Lhota 16', 1), usage('Horní Lhota 2', 1), usage('Horní Lhota 3', 1)), { data });
        expect(three[0]!.members.map(m => m.tag)).toEqual(['house', 'house', 'house']);
    });
});

describe('the other names of places', () => {
    it('adds a spelling once, moving a spelling’s own other names along', () => {
        let a = addPlaceAlias(undefined, k('Horní Lhota'), 'H. Lhota');
        expect(a).toEqual({ [k('Horní Lhota')]: ['H. Lhota'] });
        expect(addPlaceAlias(a, k('Horní Lhota'), 'H Lhota')).toBe(a);
        a = addPlaceAlias({ [k('Ober-Lhota')]: ['Oberlhota'] }, k('Horní Lhota'), 'Ober-Lhota');
        expect(a).toEqual({ [k('Horní Lhota')]: ['Ober-Lhota', 'Oberlhota'] });
        expect(addPlaceAlias(a, k('Horní Lhota'), 'Horní Lhota')).toBe(a);
    });

    it('sanitizes, merges and cuts to a part of a tree', () => {
        expect(sanitizePlaceAliases({ lhotov: ['Lhotow', ' ', 'lhotow', 'Lhotov', 5], x: 'no' })).toEqual({ lhotov: ['Lhotow'] });
        expect(sanitizePlaceAliases([])).toBeUndefined();
        const base = { placeAliases: { lhotov: ['Lhotow'] } } as unknown as StromData;
        const incoming = { placeAliases: { lhotov: ['Lhotof'], jinov: ['Jinow'] } } as unknown as StromData;
        expect(mergePlaceAliases(base, incoming)).toEqual({ lhotov: ['Lhotow', 'Lhotof'], jinov: ['Jinow'] });
        expect(placeAliasesFor(incoming, new Set(['jinov']))).toEqual({ jinov: ['Jinow'] });
    });

    it('maps the history of places’ names to today’s name', () => {
        const data = { persons: {}, partnerships: {} } as unknown as StromData;
        const map = placeAliasMap(data, new Map([[k('Ober-Lhota'), ['Horní Lhota', 'h1']], [k('Horní Lhota'), ['Horní Lhota', 'h1']]]));
        expect([...map]).toEqual([[k('Ober-Lhota'), k('Horní Lhota')], [k('Horní Lhota'), k('Horní Lhota')]]);
    });
});

describe('one map point per place', () => {
    it('draws a place’s spellings as one point with their people', () => {
        const data = tree({ [k('Horní Lhota')]: 'L0012', [k('H. Lhota')]: 'L0012' });
        const list = places(usage('Horní Lhota', 12, ['a']), usage('H. Lhota', 3, ['b']), usage('Jinov', 1));
        const groups = placeVariantGroups(list, { data });
        const targets = placeSpellingTargets(groups);
        const heads = new Map(groups.map(g => [g.ownKey, g.head]));
        const mapped = [...list].map(([key, u]) => ({ key, usage: u }));
        const { places: out, keyOf } = mergeSpellingPlaces(mapped, targets, heads);
        expect(out.map(p => p.key)).toEqual([k('Horní Lhota'), k('Jinov')]);
        expect(out[0]!.usage).toMatchObject({ display: 'Horní Lhota', count: 15, personIds: ['a', 'b'] });
        expect(keyOf.get(k('H. Lhota'))).toBe(k('Horní Lhota'));
        // The group's own place not on the map: the spelling that is stands for it, the own place joins it.
        const { places: only, keyOf: k2 } = mergeSpellingPlaces(mapped, targets, heads, p => p.key !== k('Horní Lhota'));
        expect(only.map(p => p.key)).toEqual([k('H. Lhota'), k('Jinov')]);
        expect(only[0]!.usage).toMatchObject({ display: 'Horní Lhota', count: 15 });
        expect(k2.get(k('Horní Lhota'))).toBe(k('H. Lhota'));
    });
});

describe('placeSearchNames', () => {
    it('finds a place by its record’s names and by the other names Unify wrote down', () => {
        const data = tree({ [k('Horní Lhota')]: 'L0012' }, { [k('Horní Lhota')]: ['H. Lhota'] });
        expect(placeSearchNames(k('Horní Lhota'), { data })).toEqual(['Horní Lhota', 'Ober-Lhota', 'H. Lhota']);
        expect(placeSearchNames(k('Jinov'), { data })).toEqual([]);
    });
});
