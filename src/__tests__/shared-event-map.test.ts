/**
 * A shared event on the map (spec 085 §2f): one row of a place's bubble
 * however many persons it has, the number on the marker counting the rows,
 * Migration over time counting it once; the persons in the order of its
 * "Shared with", a living person left out after the privacy filter. Old data
 * without share ids stay as they were. Invented data.
 */
import { describe, it, expect } from 'vitest';
import {
    collectPlaces, groupTownPoints, mapPointRowCount, soloPersons, MappedPlaceInput, MapPoint, PlaceUsage,
} from '../places.js';
import { mergePlaceUsages } from '../place-groups.js';
import { collectDatedPlacePoints, datedRowCount } from '../map-time.js';
import { buildSharedEventIndex } from '../shared-events.js';
import { sharedIndexOf, sharedNames } from '../shared-with-line.js';
import { applyLivingPrivacy } from '../privacy.js';
import { LifeEvent, Person, PersonId, StromData, STROM_DATA_VERSION, toPersonId } from '../types.js';

const PLACE = 'Dolní Smyšlenice';
const KEY = 'dolni smyslenice';

function person(id: string, firstName: string, birthDate: string, events: LifeEvent[] = [], extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(id), firstName, lastName: 'Hurdálek', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], birthDate,
        ...(Number(birthDate) < 1950 ? { deathDate: '1990' } : {}),
        events, ...extra,
    };
}

function census(id: string, shareId: string | undefined, o: Partial<LifeEvent> = {}): LifeEvent {
    return { id: `ev_${id}`, type: 'census', date: '1921-02-15', place: PLACE, ...(shareId ? { shareId } : {}), ...o };
}

/** A household at the census of 1921 at one place: Svatobor, Radegunda, Bohuchval, Zbyhněv. */
function household(shareId: string | null = 'sh_c1921'): StromData {
    const members: [string, string, string][] = [
        ['p_svatobor', 'Svatobor', '1879'], ['p_radegunda', 'Radegunda', '1883'],
        ['p_bohuchval', 'Bohuchval', '1906'], ['p_zbyhnev', 'Zbyhněv', '1910'],
    ];
    const persons: Record<string, Person> = {};
    for (const [id, given, birth] of members) persons[id] = person(id, given, birth, [census(id, shareId ?? undefined)]);
    return { version: STROM_DATA_VERSION, persons: persons as StromData['persons'], partnerships: {} };
}

function usageOf(data: StromData, filter?: ReadonlySet<PersonId>): PlaceUsage {
    return collectPlaces(data, filter, undefined, buildSharedEventIndex(data)).get(KEY)!;
}

function pointOf(usage: PlaceUsage): MapPoint {
    return { type: 'place', key: KEY, usage, geo: { lat: 49.5, lon: 15.2 } };
}

describe('a shared event at a place of the map (spec 085 §2f)', () => {
    it('one shared event of four persons is one row, the marker counts 1', () => {
        const usage = usageOf(household());
        expect(usage.shares).toHaveLength(1);
        expect(usage.shares![0].personIds).toEqual(['p_svatobor', 'p_radegunda', 'p_bohuchval', 'p_zbyhnev']);
        expect(usage.shares![0].event.type).toBe('census');
        expect(soloPersons(usage).size).toBe(0);
        expect(mapPointRowCount(pointOf(usage))).toBe(1);
        // Everybody is still a person of the place (the Places dialog, the persons' marks).
        expect(usage.personIds).toHaveLength(4);
    });

    it('a person born there too has a row of their own besides the shared event', () => {
        const data = household();
        data.persons[toPersonId('p_bohuchval')].birthPlace = PLACE;
        const usage = usageOf(data);
        expect([...soloPersons(usage).keys()]).toEqual(['p_bohuchval']);
        expect([...soloPersons(usage).get(toPersonId('p_bohuchval'))!]).toEqual(['birth']);
        expect(mapPointRowCount(pointOf(usage))).toBe(2);
    });

    it('two different shared events with the same place and date are two rows', () => {
        const data = household();
        for (const id of ['p_bohuchval', 'p_zbyhnev']) {
            const ev = data.persons[toPersonId(id)].events![0];
            ev.shareId = 'sh_lodgers';
        }
        const usage = usageOf(data);
        expect(usage.shares!.map(r => [r.shareId, r.personIds])).toEqual([
            ['sh_c1921', ['p_svatobor', 'p_radegunda']],
            ['sh_lodgers', ['p_bohuchval', 'p_zbyhnev']],
        ]);
        expect(mapPointRowCount(pointOf(usage))).toBe(2);
    });

    it('old data without share ids stay as they were: a row and a count per person', () => {
        const data = household(null);
        const usage = usageOf(data);
        expect(usage.shares).toEqual([]);
        expect([...soloPersons(usage).keys()]).toHaveLength(4);
        expect(mapPointRowCount(pointOf(usage))).toBe(4);
        // Without the index (the Places dialog) nothing changes at all.
        const plain = collectPlaces(data).get(KEY)!;
        expect(plain.shares).toBeUndefined();
        expect(soloPersons(plain)).toBe(plain.kinds);
        expect(mapPointRowCount(pointOf(plain))).toBe(4);
    });

    it('a copy alone in scope is its person\'s own fact', () => {
        const usage = usageOf(household(), new Set([toPersonId('p_radegunda')]));
        expect(usage.shares).toEqual([]);
        expect([...soloPersons(usage).keys()]).toEqual(['p_radegunda']);
        expect(mapPointRowCount(pointOf(usage))).toBe(1);
    });

    it('the persons follow the order of the share, not of the data', () => {
        const data = household();
        // Radegunda's copy made first: she leads the share's order.
        const evs = Object.values(data.persons).map(p => p.events![0]);
        evs.forEach((ev, i) => { ev.id = `ev_${1700000000000 + (ev.id === 'ev_p_radegunda' ? 0 : i + 1)}_000${i}`; });
        const index = buildSharedEventIndex(data);
        const order = index.shares.get('sh_c1921')!.map(c => c.personId);
        const usage = collectPlaces(data, undefined, undefined, index).get(KEY)!;
        expect(usage.shares![0].personIds).toEqual(order);
        expect(order[0]).toBe('p_radegunda');
    });

    it('spellings of one place joined keep one row of the shared event', () => {
        const data = household();
        data.persons[toPersonId('p_zbyhnev')].events![0].place = 'Dolni Smyslenice,';
        const index = buildSharedEventIndex(data);
        const usages = [...collectPlaces(data, undefined, undefined, index).values()];
        expect(usages).toHaveLength(1);
        const merged = mergePlaceUsages(PLACE, [usageOf(household()), usageOf(household())]);
        expect(merged.shares).toHaveLength(1);
        expect(merged.shares![0].personIds).toHaveLength(4);
    });

    it('a town point: the shared event is one row of its house, counted once', () => {
        const data = household();
        for (const p of Object.values(data.persons)) p.events![0].address = 'č. 14';
        data.persons[toPersonId('p_svatobor')].deathPlace = PLACE;
        const usage = usageOf(data);
        const input: MappedPlaceInput[] = [{ key: KEY, usage, geo: { lat: 49.5, lon: 15.2 } }];
        const [point] = groupTownPoints(input);
        expect(point.type).toBe('town');
        if (point.type !== 'town') return;
        expect(point.houses.map(h => h.house)).toEqual(['č. 14']);
        expect(point.houses[0].shares).toHaveLength(1);
        expect(point.houses[0].shares[0].personIds).toHaveLength(4);
        expect(point.houses[0].solo.size).toBe(0);
        expect([...point.noHouseSolo.keys()]).toEqual(['p_svatobor']);
        expect(point.personCount).toBe(4);
        expect(mapPointRowCount(point)).toBe(2);
    });

    it('given names for the row; the same given name twice gives the whole names', () => {
        const data = household();
        data.persons[toPersonId('p_zbyhnev')].firstName = 'Bohuchval';
        const names = sharedNames(data, usageOf(data).shares![0].personIds).map(n => n.text);
        expect(names).toEqual(['Svatobor', 'Radegunda', 'Bohuchval Hurdálek', 'Bohuchval Hurdálek']);
    });

    it('privacy: a living person of the event is not in the row (the filter first, then the index)', () => {
        const data = household();
        data.persons[toPersonId('p_hostivit')] = person('p_hostivit', 'Hostivít', '1995', [census('p_hostivit', 'sh_c1921')]);
        expect(usageOf(data).shares![0].personIds).toContain('p_hostivit');
        const prot = applyLivingPrivacy(data, 'initials', 2026);
        const usage = collectPlaces(prot, undefined, undefined, sharedIndexOf(prot)).get(KEY)!;
        expect(usage.shares![0].personIds).toEqual(['p_svatobor', 'p_radegunda', 'p_bohuchval', 'p_zbyhnev']);
        expect(mapPointRowCount(pointOf(usage))).toBe(1);
    });
});

describe('a shared event in Migration over time (spec 085 §2f)', () => {
    it('its points carry the share; the marker counts it once', () => {
        const data = household();
        data.persons[toPersonId('p_svatobor')].birthPlace = PLACE;
        const harvest = collectDatedPlacePoints(data, undefined, undefined, buildSharedEventIndex(data));
        const here = harvest.points.filter(p => p.placeKey === KEY);
        expect(here.filter(p => p.shareId === 'sh_c1921')).toHaveLength(4);
        expect(datedRowCount(here)).toBe(2);
        // Up to 1900: only the birth.
        expect(datedRowCount(here.filter(p => p.year <= 1900))).toBe(1);
    });

    it('old data count each person; a share of one person there counts as that person', () => {
        const plain = household(null);
        const points = collectDatedPlacePoints(plain, undefined, undefined, buildSharedEventIndex(plain)).points;
        expect(points.every(p => !p.shareId)).toBe(true);
        expect(datedRowCount(points)).toBe(4);
        const id = (s: string) => toPersonId(s);
        expect(datedRowCount([{ personId: id('a'), shareId: 's1' }, { personId: id('a') }])).toBe(1);
        expect(datedRowCount([{ personId: id('a'), shareId: 's1' }, { personId: id('b'), shareId: 's1' }, { personId: id('a') }])).toBe(2);
    });
});
