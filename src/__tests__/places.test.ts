/**
 * Places registry: everything is derived from the tree's own strings — no
 * external data. Spellings that differ only by case/diacritics/punctuation are
 * one place; renaming rewrites every field that used it.
 */
import { describe, it, expect } from 'vitest';
import { placeKey, collectPlaces, placeList, placesWithVariants, renamePlace, orphanedPlaceKeys,
    sortPlacesByName, sortPlacesForManager, isPlacesSort, readPlacesSort, DEFAULT_PLACES_SORT, placeFilterText, placeMatchesFilter,
    MapKind, countPlaceUses, compareHouses, houseKey, groupTownPoints, MappedPlaceInput, TownPoint, mapPointHasPerson,
    splitPlaceHouses, placeTownGroups, townHousePlaces, townOfPlace } from '../places.js';
import { StromData, Person, PersonId, PartnershipId, Partnership, PlaceGeo } from '../types.js';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender: 'male',
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}
function tree(persons: Person[], startPlace?: string): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: (startPlace ? {
            u1: { id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
                  childIds: [], status: 'married' as const, startPlace },
        } : {}) as StromData['partnerships'],
    };
}

describe('placeKey', () => {
    it('folds case, diacritics and punctuation', () => {
        expect(placeKey('Děčín')).toBe(placeKey('decin'));
        expect(placeKey('Děčín')).toBe(placeKey('DĚČÍN'));
        expect(placeKey('Praha,  2')).toBe(placeKey('praha 2'));
        expect(placeKey('  Brno ')).toBe('brno');
    });
    it('keeps genuinely different places apart', () => {
        expect(placeKey('Děčín')).not.toBe(placeKey('Dečice'));
    });
});

describe('collectPlaces', () => {
    it('gathers places from births, deaths, events and weddings with counts', () => {
        const data = tree([
            person('a', { birthPlace: 'Děčín', deathPlace: 'Praha' }),
            person('b', { birthPlace: 'Děčín', events: [{ id: 'e1', type: 'baptism', place: 'Praha' }] }),
        ], 'Brno');
        const places = collectPlaces(data);
        expect(places.get('decin')!.count).toBe(2);
        expect(places.get('praha')!.count).toBe(2);
        expect(places.get('brno')!.count).toBe(1);
    });

    it('groups variants and shows the most used spelling', () => {
        const data = tree([
            person('a', { birthPlace: 'Děčín' }),
            person('b', { birthPlace: 'Děčín' }),
            person('c', { birthPlace: 'decin' }),
        ]);
        const entry = collectPlaces(data).get('decin')!;
        expect(entry.count).toBe(3);
        expect(entry.variants.size).toBe(2);
        expect(entry.display).toBe('Děčín');       // 2 uses beats 1
    });

    it('ignores empty and whitespace-only places', () => {
        const data = tree([person('a', { birthPlace: '   ', deathPlace: '' })]);
        expect(collectPlaces(data).size).toBe(0);
    });
});

describe('placeList / placesWithVariants', () => {
    it('sorts by usage and finds inconsistent spellings', () => {
        const data = tree([
            person('a', { birthPlace: 'Praha' }),
            person('b', { birthPlace: 'Praha' }),
            person('c', { birthPlace: 'Děčín' }),
            person('d', { birthPlace: 'Děčín' }),
            person('e', { birthPlace: 'decin' }),
        ]);
        // Praha (2) and Děčín (3 across two spellings, 'Děčín' used most).
        expect(placeList(data).map(p => p.display)).toEqual(['Děčín', 'Praha']);
        const inconsistent = placesWithVariants(data);
        expect(inconsistent).toHaveLength(1);
        expect(inconsistent[0].variants.size).toBe(2);
    });
});

describe('renamePlace', () => {
    it('rewrites every field using any variant and leaves the original alone', () => {
        const data = tree([
            person('a', { birthPlace: 'decin', deathPlace: 'Praha' }),
            person('b', { birthPlace: 'Děčín', events: [{ id: 'e1', type: 'burial', place: 'DECIN' }] }),
        ], 'Děčín');
        const { data: out, changed } = renamePlace(data, 'decin', 'Děčín');
        // Only the misspelled ones count: a.birthPlace + b's event. b.birthPlace
        // and the wedding are already spelled 'Děčín'.
        expect(changed).toBe(2);
        expect(out.persons['a' as PersonId].birthPlace).toBe('Děčín');
        expect(out.persons['b' as PersonId].events![0].place).toBe('Děčín');
        expect(out.partnerships['u1' as PartnershipId].startPlace).toBe('Děčín');
        expect(out.persons['a' as PersonId].deathPlace).toBe('Praha');   // untouched
        // the source data is not mutated
        expect(data.persons['a' as PersonId].birthPlace).toBe('decin');
    });
});

describe('orphanedPlaceKeys', () => {
    // A tree where Brno is used (a birth) but data.places also carries an old
    // pin for Praha that no record mentions any more (a deleted person's place).
    function withPlaces(): StromData {
        const data = tree([person('a', { birthPlace: 'Brno' })]);
        data.places = {
            [placeKey('Brno')]: { lat: 49.2, lon: 16.6, label: 'Brno' },
            [placeKey('Praha')]: { lat: 50.08, lon: 14.42, label: 'Praha' },
            [placeKey('Wien')]: { lat: 48.2, lon: 16.37, label: 'Wien' },
        };
        return data;
    }

    it('reports only place keys nothing in the tree still references', () => {
        const data = withPlaces();
        const orphans = orphanedPlaceKeys(data).sort();
        expect(orphans).toEqual([placeKey('Praha'), placeKey('Wien')].sort());
        expect(orphans).not.toContain(placeKey('Brno'));   // Brno is a live birthplace
    });

    it('counts a wedding place and an event place as live references', () => {
        const data = tree([
            person('a', { events: [{ id: 'e1', type: 'residence', place: 'Plzeň' }] }),
            person('b'),
        ], 'Tábor');
        data.places = {
            [placeKey('Plzeň')]: { lat: 49.7, lon: 13.4 },
            [placeKey('Tábor')]: { lat: 49.4, lon: 14.7 },
            [placeKey('Ghost')]: { lat: 0, lon: 0 },
        };
        expect(orphanedPlaceKeys(data)).toEqual([placeKey('Ghost')]);
    });

    it('returns nothing when there is no places registry', () => {
        expect(orphanedPlaceKeys(tree([person('a', { birthPlace: 'Brno' })]))).toEqual([]);
    });
});

describe('the Places dialog: order and search', () => {
    const row = (display: string, extra: string[] = []) => ({
        key: placeKey(display),
        usage: {
            display, count: 1, personIds: [], kinds: new Map(), houses: new Map(),
            variants: new Map<string, number>([[display, 1], ...extra.map(v => [v, 1] as [string, number])]),
        },
    });
    const names = (rows: { usage: { display: string } }[]) => rows.map(r => r.usage.display);

    it('sorts by name as the UI language does: Czech puts "Ch" after "H", numbers by value', () => {
        const rows = [row('Chmelník'), row('Hlinsko'), row('Čapkov'), row('Cetkovice'), row('Ivančice'), row('Praha 10'), row('Praha 2')];
        expect(names(sortPlacesByName(rows, 'cs')))
            .toEqual(['Cetkovice', 'Čapkov', 'Hlinsko', 'Chmelník', 'Ivančice', 'Praha 2', 'Praha 10']);
        // English keeps "Ch" among the C's.
        const en = names(sortPlacesByName(rows, 'en'));
        expect(en.indexOf('Chmelník')).toBeLessThan(en.indexOf('Hlinsko'));
    });

    it('sorts by the number of people (most first) or the places without coordinates first, by name within a tie', () => {
        const at = (display: string, people: number, count: number, geo?: { lat: number; lon: number }) => {
            const r = row(display);
            return { ...r, usage: { ...r.usage, count, personIds: Array.from({ length: people }, (_, i) => `p${i}` as PersonId) }, geo };
        };
        const pin = { lat: 50, lon: 15 };
        const rows = [at('Hlinsko', 2, 2, pin), at('Chmelník', 3, 3), at('Čapkov', 2, 5), at('Cetkovice', 2, 2, pin), at('Ivančice', 1, 1)];
        expect(names(sortPlacesForManager(rows, 'people', 'cs')))
            .toEqual(['Chmelník', 'Čapkov', 'Cetkovice', 'Hlinsko', 'Ivančice']);
        expect(names(sortPlacesForManager(rows, 'state', 'cs')))
            .toEqual(['Čapkov', 'Chmelník', 'Ivančice', 'Cetkovice', 'Hlinsko']);
        // With the identity's rank: lower first, the name order inside.
        const rank = (r: { usage: { display: string } }) => r.usage.display === 'Hlinsko' ? 0 : 3;
        expect(names(sortPlacesForManager(rows, 'state', 'cs', rank)))
            .toEqual(['Hlinsko', 'Cetkovice', 'Čapkov', 'Chmelník', 'Ivančice']);
        expect(names(sortPlacesForManager(rows, 'name', 'cs')))
            .toEqual(['Cetkovice', 'Čapkov', 'Hlinsko', 'Chmelník', 'Ivančice']);
        expect(isPlacesSort('people')).toBe(true);
        expect(isPlacesSort('alpha')).toBe(false);
        expect(isPlacesSort('unplaced')).toBe(false);
        expect(readPlacesSort('unplaced')).toBe('state');
        expect(readPlacesSort('people')).toBe('people');
        expect(readPlacesSort(undefined)).toBe(DEFAULT_PLACES_SORT);
        expect(DEFAULT_PLACES_SORT).toBe('state');
    });

    it('finds a place without diacritics, by any of its spellings and by its other names', () => {
        const capkov = row('Čapkov', ['Capkov']);
        const text = placeFilterText(capkov.key, capkov.usage, ['Tschapkau']);
        expect(placeMatchesFilter(text, 'capkov')).toBe(true);
        expect(placeMatchesFilter(text, 'ČAP')).toBe(true);
        expect(placeMatchesFilter(text, 'tschapkau')).toBe(true);
        expect(placeMatchesFilter(text, 'kolin')).toBe(false);
        expect(placeMatchesFilter(text, '  ')).toBe(true);   // an empty query hides nothing
    });
});

// ==================== map kinds and houses (spec 031) ====================

const P = (id: string) => id as PersonId;
function treeWith(persons: Person[], unions: Partnership[] = [], places?: Record<string, PlaceGeo>): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(unions.map(u => [u.id, u])) as StromData['partnerships'],
        ...(places ? { places } : {}),
    };
}
function union(id: string, a: string, b: string, o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: P(a), person2Id: P(b), childIds: [], status: 'married', ...o };
}
const kindsOf = (data: StromData, place: string, id: string, kinds?: ReadonlySet<MapKind>) =>
    [...(collectPlaces(data, undefined, kinds).get(placeKey(place))?.kinds.get(P(id)) ?? [])].sort();

describe('collectPlaces: map kinds', () => {
    const data = treeWith([
        person('a', {
            birthPlace: 'Bělokamen', deathPlace: 'Lhotín',
            events: [
                { id: 'e1', type: 'baptism', place: 'Tichá Lhota' },
                { id: 'e2', type: 'burial', place: 'Zálesí u Brodku' },
                { id: 'e3', type: 'cremation', place: 'Horní Ves' },
                { id: 'e4', type: 'residence', place: 'Bělokamen' },
            ],
        }),
        person('b'),
    ], [union('u1', 'a', 'b', {
        startPlace: 'Lhotín', endPlace: 'Horní Ves',
        events: [{ id: 'c1', type: 'banns', place: 'Tichá Lhota' }, { id: 'c2', type: 'census', place: 'Zálesí u Brodku' }],
    })]);

    it('baptism is a birth, burial and cremation a death, banns a wedding (both partners), the divorce another event', () => {
        expect(kindsOf(data, 'Bělokamen', 'a')).toEqual(['birth', 'event']);
        expect(kindsOf(data, 'Tichá Lhota', 'a')).toEqual(['birth', 'wedding']);
        expect(kindsOf(data, 'Tichá Lhota', 'b')).toEqual(['wedding']);
        expect(kindsOf(data, 'Zálesí u Brodku', 'a')).toEqual(['death', 'event']);
        expect(kindsOf(data, 'Horní Ves', 'a')).toEqual(['death', 'event']);
        expect(kindsOf(data, 'Horní Ves', 'b')).toEqual(['event']);
        expect(kindsOf(data, 'Lhotín', 'b')).toEqual(['wedding']);
    });

    it('only the enabled kinds: places, people and counts of those facts alone', () => {
        const births = collectPlaces(data, undefined, new Set<MapKind>(['birth']));
        expect([...births.keys()].sort()).toEqual([placeKey('Bělokamen'), placeKey('Tichá Lhota')].sort());
        expect(births.get(placeKey('Bělokamen'))!.count).toBe(1);
        expect(births.get(placeKey('Tichá Lhota'))!.personIds).toEqual([P('a')]);
        const deaths = collectPlaces(data, undefined, new Set<MapKind>(['death']));
        expect(deaths.has(placeKey('Lhotín'))).toBe(true);
        expect(deaths.get(placeKey('Horní Ves'))!.personIds).toEqual([P('a')]);
        // without kinds: every fact, as before
        expect(collectPlaces(data).get(placeKey('Horní Ves'))!.count).toBe(2);
    });

    it('keeps the house field of each fact per person', () => {
        const d = treeWith([person('a', { birthPlace: 'Bělokamen', birthAddress: ' čp. 16 ', deathPlace: 'Bělokamen' })]);
        const houses = collectPlaces(d).get(placeKey('Bělokamen'))!.houses.get(P('a'))!;
        expect([...houses.keys()].sort()).toEqual(['', 'čp. 16']);
        expect([...houses.get('čp. 16')!]).toEqual(['birth']);
        expect([...houses.get('')!]).toEqual(['death']);
    });
});

describe('countPlaceUses', () => {
    it('counts exactly what renamePlace then rewrites', () => {
        const data = treeWith([
            person('a', { birthPlace: 'Bělokamen', deathPlace: 'bělokamen', events: [{ id: 'e', type: 'residence', place: 'Lhotín' }] }),
            person('b', { birthPlace: 'Lhotín' }),
            person('c', { deathPlace: 'Bělokamen' }),
        ], [union('u1', 'a', 'b', { startPlace: 'Bělokamen', endPlace: 'Bělokamen', events: [{ id: 'c', type: 'banns', place: 'BĚLOKAMEN' }] })]);
        const key = placeKey('Bělokamen');
        const count = countPlaceUses(data, key);
        expect(count).toEqual({ uses: 6, persons: 3 });
        expect(renamePlace(data, key, 'Bělokamen u Lhotína').changed).toBe(count.uses);
        // a new name one spelling already has: that spelling is not rewritten
        expect(countPlaceUses(data, key, 'Bělokamen').uses).toBe(renamePlace(data, key, 'Bělokamen').changed);
    });
});

describe('houses: natural order and one house however written', () => {
    it('numbers by value (a marker word skipped), then streets, then texts without a number', () => {
        const list = ['Za Humny', 'Kopřivná 12', '12a', '102', 'čp. 4', '13/2', '12', '2', '16', 'Haus Nr. 3', 'Kopřivná 5', 'House No. 7'];
        expect([...list].sort(compareHouses)).toEqual(
            ['2', 'Haus Nr. 3', 'čp. 4', 'House No. 7', '12', '12a', '13/2', '16', '102', 'Kopřivná 5', 'Kopřivná 12', 'Za Humny']);
    });

    it('"16", "čp. 16", "Haus Nr. 16" and "č. p. 16" are one house', () => {
        for (const h of ['čp. 16', 'Haus Nr. 16', 'č. p. 16', 'House No. 16']) expect(houseKey(h)).toBe(houseKey('16'));
        expect(houseKey('Kopřivná 12')).toBe(houseKey('kopřivná  12'));
        expect(houseKey('Kopřivná 12')).not.toBe(houseKey('12'));
    });

    it('townOfPlace: a recognised house, a bare number, never a numbered town', () => {
        expect(townOfPlace('Bělokamen čp. 4')).toEqual({ town: 'Bělokamen', house: '4', bare: false });
        expect(townOfPlace('Bělokamen, Kopřivná 12')).toEqual({ town: 'Bělokamen', house: 'Kopřivná 12', bare: false });
        expect(townOfPlace('Bělokamen 16')).toEqual({ town: 'Bělokamen', house: '16', bare: true });
        expect(townOfPlace('Praha 5')).toBeNull();
        expect(townOfPlace('Bělokamen')).toBeNull();
    });
});

describe('groupTownPoints', () => {
    const exact = (lat: number): PlaceGeo => ({ lat, lon: 15 });
    const byTown = (lat: number, town: string): PlaceGeo => ({ lat, lon: 15, byTown: town });
    const mapped = (data: StromData): MappedPlaceInput[] =>
        [...collectPlaces(data)].filter(([k]) => data.places?.[k]).map(([key, usage]) => ({ key, usage, geo: data.places![key] }));

    it('houses found by the town join one point of the town; exact coordinates and "Praha 5" stay apart', () => {
        const data = treeWith([
            person('e', { birthPlace: 'Bělokamen', birthAddress: 'čp. 16' }),
            person('f', { deathPlace: 'Bělokamen' }),
            person('g', { birthPlace: 'Bělokamen 16' }),
            person('h', { birthPlace: 'Bělokamen čp. 4', deathPlace: 'Bělokamen čp. 4' }),
            person('i', { birthPlace: 'Bělokamen 31' }),
            person('j', { birthPlace: 'Praha 5' }),
            person('k', { birthPlace: 'Lhotín, Kopřivná 12' }),
        ], [], {
            [placeKey('Bělokamen')]: exact(49.1),
            [placeKey('Bělokamen 16')]: byTown(49.2, 'Bělokamen'),
            [placeKey('Bělokamen čp. 4')]: byTown(49.2, 'Bělokamen'),
            [placeKey('Bělokamen 31')]: exact(49.3),
            [placeKey('Praha 5')]: byTown(50, 'Praha'),
            [placeKey('Lhotín, Kopřivná 12')]: byTown(48, 'Lhotín'),
        });
        const points = groupTownPoints(mapped(data));
        const town = points.find(p => p.key === 'town:' + placeKey('Bělokamen')) as TownPoint;
        expect(town).toBeDefined();
        expect(town.geo.lat).toBe(49.1);   // the town's own place
        expect(town.ownKey).toBe(placeKey('Bělokamen'));
        expect(town.houses.map(h => [h.house, [...h.persons.keys()].sort()])).toEqual([
            ['4', [P('h')]],
            ['16', [P('e'), P('g')]],   // the house field "čp. 16" and "Bělokamen 16" are one house
        ]);
        expect([...town.houses[0].persons.get(P('h'))!].sort()).toEqual(['birth', 'death']);
        expect([...town.noHouse.keys()]).toEqual([P('f')]);
        expect(town.personCount).toBe(4);
        expect(town.houseCount).toBe(2);
        // exact coordinates of a house: its own point; a numbered town never groups
        expect(points.find(p => p.key === placeKey('Bělokamen 31'))?.type).toBe('place');
        expect(points.find(p => p.key === placeKey('Praha 5'))?.type).toBe('place');
        // a town not on the map itself: the point stands where its first house was found
        const lhotin = points.find(p => p.key === 'town:' + placeKey('Lhotín')) as TownPoint;
        expect(lhotin.geo.lat).toBe(48);
        expect(lhotin.town).toBe('Lhotín');
        expect(lhotin.ownKey).toBeUndefined();
        expect(points).toHaveLength(4);
    });

    it('a tree from the research (town in the place, house in the field) gets the same town point', () => {
        const data = treeWith([
            person('e', { birthPlace: 'Bělokamen', birthAddress: 'čp. 16' }),
            person('f', { birthPlace: 'Bělokamen', birthAddress: 'Kopřivná 12' }),
            person('g', { birthPlace: 'Lhotín' }),
        ], [], { [placeKey('Bělokamen')]: exact(49), [placeKey('Lhotín')]: exact(48) });
        const points = groupTownPoints(mapped(data));
        const town = points.find(p => p.type === 'town') as TownPoint;
        expect(town.key).toBe('town:' + placeKey('Bělokamen'));
        expect(town.houses.map(h => h.house)).toEqual(['čp. 16', 'Kopřivná 12']);
        expect(points.find(p => p.key === placeKey('Lhotín'))?.type).toBe('place');
    });

    it('a recognised house with exact coordinates is no member', () => {
        const data = treeWith([person('h', { birthPlace: 'Bělokamen čp. 4', birthAddress: 'čp. 4' }), person('e', { birthPlace: 'Bělokamen' })], [],
            { [placeKey('Bělokamen čp. 4')]: exact(49.2), [placeKey('Bělokamen')]: exact(49.1) });
        expect(groupTownPoints(mapped(data)).map(p => p.type)).toEqual(['place', 'place']);
    });

    it('a person\'s points (another window\'s selection on the map): a place by its people, a town by its houses and the town itself', () => {
        const data = treeWith([
            person('e', { birthPlace: 'Bělokamen', birthAddress: 'čp. 16' }),
            person('f', { deathPlace: 'Bělokamen' }),
            person('g', { birthPlace: 'Lhotín' }),
        ], [], { [placeKey('Bělokamen')]: exact(49), [placeKey('Lhotín')]: exact(48) });
        const points = groupTownPoints(mapped(data));
        const town = points.find(p => p.type === 'town')!;
        const lhotin = points.find(p => p.key === placeKey('Lhotín'))!;
        expect([mapPointHasPerson(town, 'e'), mapPointHasPerson(town, 'f'), mapPointHasPerson(town, 'g')]).toEqual([true, true, false]);
        expect([mapPointHasPerson(lhotin, 'g'), mapPointHasPerson(lhotin, 'e')]).toEqual([true, false]);
    });
});

describe('the Places dialog: towns with house numbers', () => {
    const data = treeWith([
        person('a', { birthPlace: 'Bělokamen' }),
        person('b', { birthPlace: 'Bělokamen čp. 4' }),
        person('c', { birthPlace: 'Bělokamen 16' }),
        person('d', { birthPlace: 'Bělokamen 102', deathPlace: 'Bělokamen, Kopřivná 12' }),
        person('e', { birthPlace: 'Bělokamen 2' }),
        person('f', { birthPlace: 'Praha 5' }), person('g', { birthPlace: 'Praha 6' }), person('h', { birthPlace: 'Praha 7' }),
        person('i', { birthPlace: 'Praha' }),
        person('j', { birthPlace: 'Tichá Lhota 3' }), person('k', { birthPlace: 'Tichá Lhota 4' }), person('l', { birthPlace: 'Tichá Lhota 5' }),
    ], [], { [placeKey('Bělokamen čp. 4')]: { lat: 49, lon: 15, byTown: 'Bělokamen' } });

    it('groups a town with three or more house places; never a numbered town, bare numbers only of a town the tree writes plain', () => {
        const groups = placeTownGroups(data);
        expect(groups.map(g => g.townKey)).toEqual([placeKey('Bělokamen')]);
        const g = groups[0];
        expect(g.ownKey).toBe(placeKey('Bělokamen'));
        expect(g.members.map(m => m.house)).toEqual(['2', '4', '16', '102', 'Kopřivná 12']);
        expect(g.houseCount).toBe(5);
        expect(g.personCount).toBe(5);
        expect(g.unplacedCount).toBe(4);
        expect(g.hasBare).toBe(true);
    });

    it('a town\'s house places with three examples: smallest, second, largest', () => {
        const t = townHousePlaces(data, placeKey('Bělokamen'));
        expect(t.places).toHaveLength(5);
        expect(t.hasBare).toBe(true);
        expect(t.examples.map(p => p.house)).toEqual(['2', '4', 'Kopřivná 12']);
        expect(t.bareExamples.map(p => p.display)).toEqual(['Bělokamen 2', 'Bělokamen 16', 'Bělokamen 102']);
    });
});

describe('splitPlaceHouses', () => {
    const build = (): StromData => treeWith([
        person('a', { birthPlace: 'Bělokamen', deathPlace: 'Bělokamen' }),
        person('b', { birthPlace: 'Bělokamen čp. 4' }),
        person('c', { deathPlace: 'Bělokamen čp. 4', deathAddress: '7' }),
        person('d', { birthPlace: 'Bělokamen čp. 4', birthAddress: 'čp. 4' }),
        person('e', { birthPlace: 'Bělokamen 16', events: [{ id: 'x', type: 'residence', place: 'Bělokamen 16' }] }),
        person('f', { birthPlace: 'Praha 5' }),
        person('g'),
    ], [union('u1', 'b', 'g', { startPlace: 'Bělokamen, Kopřivná 12', endPlace: 'Bělokamen, Kopřivná 12' })]);
    const keys = ['Bělokamen čp. 4', 'Bělokamen, Kopřivná 12', 'Bělokamen 16', 'Praha 5'].map(placeKey);

    it('the place becomes the town, the house goes to the house field; another house and the divorce stay', () => {
        const data = build();
        const before = structuredClone(data);
        const r = splitPlaceHouses(data, keys);
        expect(data).toEqual(before);   // works on a copy
        expect(r.changed).toBe(3);      // b's birth, d's birth, the wedding
        expect(r.skipped).toBe(1);      // c: the house field says 7
        expect(r.noHouseField).toBe(1); // the divorce
        expect(r.persons).toBe(3);      // b, d, g
        const p = r.data.persons;
        expect([p[P('b')].birthPlace, p[P('b')].birthAddress]).toEqual(['Bělokamen', '4']);
        expect([p[P('d')].birthPlace, p[P('d')].birthAddress]).toEqual(['Bělokamen', 'čp. 4']);   // the same house, kept as written
        expect([p[P('c')].deathPlace, p[P('c')].deathAddress]).toEqual(['Bělokamen čp. 4', '7']);
        expect([r.data.partnerships['u1' as PartnershipId].startPlace, r.data.partnerships['u1' as PartnershipId].address])
            .toEqual(['Bělokamen', 'Kopřivná 12']);
        expect(r.data.partnerships['u1' as PartnershipId].endPlace).toBe('Bělokamen, Kopřivná 12');
        // a bare number stays without the person's word, a numbered town always
        expect(p[P('e')].birthPlace).toBe('Bělokamen 16');
        expect(p[P('f')].birthPlace).toBe('Praha 5');
    });

    it('bare numbers of a confirmed town are split too, to the spelling the tree uses most', () => {
        const data = build();
        data.persons[P('a')].birthPlace = 'BĚLOKAMEN';
        data.persons[P('g')].birthPlace = 'Bělokamen';
        const r = splitPlaceHouses(data, keys, { bareTowns: new Set([placeKey('Bělokamen')]) });
        const e = r.data.persons[P('e')];
        expect([e.birthPlace, e.birthAddress, e.events![0].place, e.events![0].address]).toEqual(['Bělokamen', '16', 'Bělokamen', '16']);
        expect(r.changed).toBe(5);
        expect(r.data.persons[P('f')].birthPlace).toBe('Praha 5');
    });
});
