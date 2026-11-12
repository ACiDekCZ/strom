/**
 * Places registry (K5) — built ENTIRELY from the tree's own data. Nothing is
 * downloaded and nothing leaves the file: this module just collects every place
 * string already typed (birth/death places, event places, wedding places),
 * groups spellings that only differ by case/diacritics/punctuation, and can
 * rename one everywhere at once.
 *
 * Places stay plain strings in the model on purpose — turning them into
 * entities would touch every import/export path for little extra value today.
 * This gives the real wins (type it once, keep it consistent, find the
 * variants) with no migration.
 *
 * Map kinds (spec 031): every place field is a fact of one kind — a birth, a
 * death, a wedding or another event — so the map can show only some kinds.
 * House numbers: a place written with its house ("Bělokamen čp. 16",
 * "Bělokamen, Kopřivná 12") is read by the research's rules (src/streets.ts);
 * the map shows the houses of a town as one point (groupTownPoints), the Places
 * dialog as one group (placeTownGroups) and can split them into the town and
 * the house field (splitPlaceHouses).
 */

import { StromData, PersonId, PlaceGeo, LifeEventType, CoupleEventType } from './types.js';
import {
    bareNumber, foldText, houseWith, isNumberTok, KnownStreets, nameOf, numberedTown, splitStreet, streetOfHouse, tokens,
} from './streets.js';

/** The kind of fact a place stands for on the map (the chips above it). */
export type MapKind = 'birth' | 'death' | 'wedding' | 'event';

/** Every map kind, in the order the map shows them. */
export const MAP_KINDS: readonly MapKind[] = ['birth', 'death', 'wedding', 'event'];

export function isMapKind(v: unknown): v is MapKind {
    return v === 'birth' || v === 'death' || v === 'wedding' || v === 'event';
}

/** A person's event as a map kind: baptism counts as a birth, burial and cremation as a death. */
export function lifeEventKind(type: LifeEventType): MapKind {
    if (type === 'birth' || type === 'baptism') return 'birth';
    if (type === 'death' || type === 'burial' || type === 'cremation') return 'death';
    return 'event';
}

const WEDDING_EVENTS: ReadonlySet<CoupleEventType> = new Set<CoupleEventType>(
    ['engagement', 'banns', 'marriageLicence', 'marriageContract', 'marriageSettlement']);

/** A couple's event as a map kind: the steps to a wedding count as the wedding, the rest as other events. */
export function coupleEventKind(type: CoupleEventType): MapKind {
    return WEDDING_EVENTS.has(type) ? 'wedding' : 'event';
}

export interface PlaceUsage {
    /** The spelling shown to the user: the most frequent variant (ties: first alphabetically). */
    display: string;
    /** Every distinct spelling that normalizes to the same key, with counts. */
    variants: Map<string, number>;
    /** How many fields across the tree use this place (all variants together). */
    count: number;
    /** Everyone connected to this place — born, died, married or an event here. */
    personIds: PersonId[];
    /** The kinds of each person's facts here. */
    kinds: Map<PersonId, Set<MapKind>>;
    /**
     * Each person's houses here, from the house field of the same fact
     * (birthAddress, deathAddress, the event's address, the wedding's address):
     * house text as written (trimmed) → the kinds of those facts. '' = a fact
     * without a house (or one with no house field, the divorce).
     */
    houses: Map<PersonId, Map<string, Set<MapKind>>>;
}

/**
 * One place field of the tree, as a fact: its place, its house field, its
 * kind and the people it belongs to (a couple's fact belongs to both
 * partners). The setters write into the data walked — callers walk a copy.
 */
interface PlaceFact {
    place: string | undefined;
    /** The fact's house field; undefined when empty or when it has none. */
    house: string | undefined;
    /** False for the divorce place (union.endPlace): no house field. */
    hasHouseField: boolean;
    date: string | undefined;
    kind: MapKind;
    persons: PersonId[];
    setPlace(value: string | undefined): void;
    setHouse(value: string | undefined): void;
}

/**
 * Every place field of the tree in a fixed order (each person: birth, death,
 * events; each partnership: wedding, divorce, couple events). The single walk
 * behind collectPlaces, renamePlace, countPlaceUses and splitPlaceHouses, so
 * they always agree on what a place field is.
 */
export function forEachPlaceFact(data: StromData, visit: (fact: PlaceFact) => void): void {
    const none = (): void => { /* no house field */ };
    for (const person of Object.values(data.persons)) {
        const who = [person.id];
        visit({
            place: person.birthPlace, house: person.birthAddress, hasHouseField: true, date: person.birthDate,
            kind: 'birth', persons: who,
            setPlace: v => { person.birthPlace = v; }, setHouse: v => { person.birthAddress = v; },
        });
        visit({
            place: person.deathPlace, house: person.deathAddress, hasHouseField: true, date: person.deathDate,
            kind: 'death', persons: who,
            setPlace: v => { person.deathPlace = v; }, setHouse: v => { person.deathAddress = v; },
        });
        for (const ev of person.events ?? []) {
            visit({
                place: ev.place, house: ev.address, hasHouseField: true, date: ev.date,
                kind: lifeEventKind(ev.type), persons: who,
                setPlace: v => { ev.place = v; }, setHouse: v => { ev.address = v; },
            });
        }
    }
    for (const union of Object.values(data.partnerships)) {
        const couple = [union.person1Id, union.person2Id];
        visit({
            place: union.startPlace, house: union.address, hasHouseField: true, date: union.startDate,
            kind: 'wedding', persons: couple,
            setPlace: v => { union.startPlace = v; }, setHouse: v => { union.address = v; },
        });
        // The divorce has no house field of its own (union.address is the wedding's).
        visit({
            place: union.endPlace, house: undefined, hasHouseField: false, date: union.endDate,
            kind: 'event', persons: couple,
            setPlace: v => { union.endPlace = v; }, setHouse: none,
        });
        for (const ev of union.events ?? []) {
            visit({
                place: ev.place, house: ev.address, hasHouseField: true, date: ev.date,
                kind: coupleEventKind(ev.type), persons: couple,
                setPlace: v => { ev.place = v; }, setHouse: v => { ev.address = v; },
            });
        }
    }
}

/**
 * Comparison key: lowercase, accents stripped, punctuation and repeated spaces
 * collapsed. "Děčín", "decin" and "Děčín  ," share one key.
 */
export function placeKey(raw: string): string {
    return raw
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[.,;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Every place string in the tree, with usage counts, keyed by placeKey().
 * `personFilter` narrows the result to places connected to those people — that
 * is how the map shows just what is on screen. `kinds` narrows it to facts of
 * those map kinds: a place with no such fact is not in the result, `personIds`
 * holds only people with such a fact there and `count` counts only those
 * fields. Without `kinds` every fact counts.
 */
export function collectPlaces(
    data: StromData, personFilter?: ReadonlySet<PersonId>, kinds?: ReadonlySet<MapKind>,
): Map<string, PlaceUsage> {
    const out = new Map<string, PlaceUsage>();
    const kept = (id: PersonId): boolean => !personFilter || personFilter.has(id);

    forEachPlaceFact(data, fact => {
        const value = fact.place?.trim();
        if (!value) return;
        if (kinds && !kinds.has(fact.kind)) return;
        // A wedding place belongs to both partners; one of them being on screen
        // is enough for the wedding to belong on the map.
        const who = fact.persons.filter(kept);
        if (who.length === 0) return;
        const key = placeKey(value);
        if (!key) return;
        const entry = out.get(key) ?? {
            display: value, variants: new Map<string, number>(), count: 0, personIds: [],
            kinds: new Map<PersonId, Set<MapKind>>(), houses: new Map<PersonId, Map<string, Set<MapKind>>>(),
        };
        entry.variants.set(value, (entry.variants.get(value) ?? 0) + 1);
        entry.count++;
        const house = fact.house?.trim() ?? '';
        for (const id of who) {
            if (!entry.personIds.includes(id)) entry.personIds.push(id);
            const k = entry.kinds.get(id) ?? new Set<MapKind>();
            k.add(fact.kind);
            entry.kinds.set(id, k);
            const byHouse = entry.houses.get(id) ?? new Map<string, Set<MapKind>>();
            const hk = byHouse.get(house) ?? new Set<MapKind>();
            hk.add(fact.kind);
            byHouse.set(house, hk);
            entry.houses.set(id, byHouse);
        }
        out.set(key, entry);
    });

    // The display spelling is the one used most (stable tiebreak: alphabetical).
    for (const entry of out.values()) {
        entry.display = [...entry.variants.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    }
    return out;
}

/** Sorted list for pickers and the places manager: most used first, then alphabetical. */
export function placeList(data: StromData): PlaceUsage[] {
    return [...collectPlaces(data).values()]
        .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));
}

/**
 * The Places dialog's order: by name as the UI language sorts it (Czech puts
 * "Ch" after "H", "Č" after "C"; numbers by value, "Praha 2" before "Praha 10"),
 * ties by key so the order never depends on the input.
 */
export function sortPlacesByName<T extends { key: string; usage: PlaceUsage }>(rows: readonly T[], lang: string): T[] {
    const collator = new Intl.Collator(lang, { numeric: true });
    return [...rows].sort((a, b) => collator.compare(a.usage.display, b.usage.display)
        || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The Places dialog's sort choices: by state (default), by name, most people first. */
export type PlacesSort = 'state' | 'name' | 'people';

/** The sort the Places dialog opens with. */
export const DEFAULT_PLACES_SORT: PlacesSort = 'state';

export function isPlacesSort(v: unknown): v is PlacesSort {
    return v === 'state' || v === 'name' || v === 'people';
}

/** A stored or chosen sort: the old "places without coordinates first" is the state order now; anything unknown the default. */
export function readPlacesSort(v: unknown): PlacesSort {
    if (v === 'unplaced') return 'state';
    return isPlacesSort(v) ? v : DEFAULT_PLACES_SORT;
}

/**
 * The Places dialog's order for a sort choice. Every choice ends in the name
 * order of sortPlacesByName, so equal places keep reading like an index:
 *   - 'people': most people connected first (then most uses in the tree),
 *   - 'state': by `stateRank` (place-identity's placeStateRank: check,
 *     confirm, not identified, no location, being looked up, queued, placed);
 *     without it the places without coordinates first.
 */
export function sortPlacesForManager<T extends { key: string; usage: PlaceUsage; geo?: unknown }>(
    rows: readonly T[], sort: PlacesSort, lang: string, stateRank?: (row: T) => number,
): T[] {
    const byName = sortPlacesByName(rows, lang);
    // Array.prototype.sort is stable: the name order stays within each tie.
    if (sort === 'people') {
        return byName.sort((a, b) => b.usage.personIds.length - a.usage.personIds.length || b.usage.count - a.usage.count);
    }
    if (sort === 'state') {
        const rank = stateRank ?? ((r: T) => r.geo ? 1 : 0);
        return byName.sort((a, b) => rank(a) - rank(b));
    }
    return byName;
}

/**
 * What the Places dialog's search looks in, folded like a key: the shown name,
 * every spelling the tree uses, and other names of the place (`also`: the
 * research's name and other forms from the history of places, when there are).
 */
export function placeFilterText(key: string, usage: PlaceUsage, also: readonly string[] = []): string {
    return [usage.display, key, ...usage.variants.keys(), ...also].map(placeKey).filter(Boolean).join(' | ');
}

/** Every word of the query (folded: no case, no diacritics) is in the place's filter text. */
export function placeMatchesFilter(text: string, query: string): boolean {
    return placeKey(query).split(' ').filter(Boolean).every(w => text.includes(w));
}

/** Places written in more than one way — candidates for unification. */
export function placesWithVariants(data: StromData): PlaceUsage[] {
    return [...collectPlaces(data).values()].filter(p => p.variants.size > 1);
}

/**
 * Place keys that hold coordinates in `data.places` but are no longer written
 * on ANY person (birth/death place), event place or partnership start place —
 * geocache left behind after the last place-bearing record was edited or the
 * person deleted. `collectPlaces` is the single source of truth for "referenced"
 * (same fields the picker/map read), so this stays in sync with the data model.
 */
export function orphanedPlaceKeys(data: StromData): string[] {
    if (!data.places) return [];
    const referenced = collectPlaces(data);
    return Object.keys(data.places).filter(key => !referenced.has(key));
}

/**
 * Rewrite every occurrence of the places matching `fromKey` to `to`. Mutates a
 * COPY and returns it plus how many fields changed, so callers can run it
 * through the normal mutation/undo path.
 */
export function renamePlace(data: StromData, fromKey: string, to: string): { data: StromData; changed: number } {
    const copy = structuredClone(data);
    const target = to.trim();
    let changed = 0;
    forEachPlaceFact(copy, fact => {
        const value = fact.place;
        if (!value || placeKey(value) !== fromKey || value === target) return;
        changed++;
        fact.setPlace(target);
    });
    return { data: copy, changed };
}

/**
 * What renamePlace(data, key, to) would rewrite: the fields (`uses`) and the
 * distinct people they belong to (a couple's field counts both partners).
 * The same walk as renamePlace; without `to` every field of the place counts
 * (a new name none of its spellings has).
 */
export function countPlaceUses(data: StromData, key: string, to?: string): { uses: number; persons: number } {
    const target = to?.trim();
    let uses = 0;
    const persons = new Set<PersonId>();
    forEachPlaceFact(data, fact => {
        const value = fact.place;
        if (!value || placeKey(value) !== key || value === target) return;
        uses++;
        for (const id of fact.persons) persons.add(id);
    });
    return { uses, persons: persons.size };
}

// ==================== HOUSES ====================

/**
 * The streets of the tree's houses, by the municipality (the place's first
 * part, folded): "Dlouhá 88" in the house field of a fact at "Lhota" makes
 * "Lhota, Dlouhá" a street of Lhota for splitStreet — the research reads its
 * own houses the same way.
 */
export function knownStreets(data: StromData): KnownStreets {
    const known = new Map<string, Set<string>>();
    forEachPlaceFact(data, fact => {
        const place = fact.place?.trim();
        const house = fact.house?.trim();
        if (!place || !house) return;
        const street = streetOfHouse(house);
        if (!street) return;
        const town = foldText(place.split(',')[0]!);
        const set = known.get(town) ?? new Set<string>();
        set.add(street);
        known.set(town, set);
    });
    return town => known.get(town);
}

/** A place read as a town and a house. */
export interface PlaceHouse {
    /** The place without the house ("Bělokamen", "Lhota, okres Horní"). */
    town: string;
    /** The house as the place writes it ("16", "Kopřivná 12"); never with an added marker. */
    house: string;
    /** A number alone after the town's name ("Bělokamen 16"): a house or a part of the town, see bareNumber. */
    bare: boolean;
}

/**
 * The town and the house a place name holds: a street or a house number by the
 * research's rules (splitStreet), or a number alone after the name
 * (bareNumber, `bare: true`) — never after a town whose numbers are its parts
 * ("Praha 5", numberedTown). Null for a place without a house.
 */
export function townOfPlace(place: string, known?: KnownStreets): PlaceHouse | null {
    const s = splitStreet(place, known);
    if (s) return { town: s.town, house: s.house, bare: false };
    const b = bareNumber(place);
    if (b && !numberedTown(b.name)) return { town: b.town, house: b.house, bare: true };
    return null;
}

interface HouseOrder {
    /** 0 numbers (with a marker word or none), 1 a street with its number, 2 a text without a number. */
    cls: 0 | 1 | 2;
    street: string;
    /** The first number, as written folded ("13" of "13/2", "12a"). */
    num: string;
    /** The rest from the first number on, folded ("13 2"). */
    rest: string;
    text: string;
}

function houseOrder(text: string): HouseOrder {
    const t = text.normalize('NFC').trim();
    const toks = tokens(t);
    const i = toks.findIndex(isNumberTok);
    if (i < 0) return { cls: 2, street: '', num: '', rest: '', text: foldText(t) };
    // the words before the first number: a marker ("čp.", "Haus Nr.", "House No.") is no street
    const street = nameOf(toks.slice(0, i + 1));
    return {
        cls: street ? 1 : 0, street, num: toks[i]!.fold,
        rest: toks.slice(i).map(x => x.fold).join(' '), text: foldText(t),
    };
}

/** Is a house text a street ("Lhotákova 23", "Lhotákova") rather than a number with or without its marker ("16", "čp. 4")? */
export function houseIsStreet(text: string): boolean {
    return houseOrder(text).cls !== 0;
}

/**
 * The same house however it is written: "16", "čp. 16", "Haus Nr. 16" and
 * "House No. 16" are one house; "Kopřivná 12" and "kopřivná 12" too.
 */
export function houseKey(text: string): string {
    const o = houseOrder(text);
    if (o.cls === 2) return o.text;
    return o.street ? `${o.street} ${o.rest}` : o.rest;
}

const houseCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Natural order of house texts: plain numbers first (a marker word before
 * them is skipped: "čp. 4", "Haus Nr. 4") by value — "13/2" by 13, "12a"
 * after "12"; then houses with a street, by street and within it by number
 * ("Kopřivná 12" after the numbers); then texts without a number
 * ("mlýn", "u kostela"), alphabetically.
 */
export function compareHouses(a: string, b: string): number {
    const x = houseOrder(a);
    const y = houseOrder(b);
    return x.cls - y.cls
        || houseCollator.compare(x.street, y.street)
        || houseCollator.compare(x.num, y.num)
        || houseCollator.compare(x.rest, y.rest)
        || houseCollator.compare(x.text, y.text)
        || (a < b ? -1 : a > b ? 1 : 0);
}

/** The house of a fact at a place that holds `house`, beside the fact's own house field. */
function factHouse(house: string, had: string | undefined): string | undefined {
    const h = had?.trim();
    if (!h) return house;
    // the same house written another way ("16" and "čp. 16"): keep the field as it is
    if (houseKey(h) === houseKey(house)) return h;
    return houseWith(house, h);
}

/** Three examples of a list in house order: the smallest, the second and the largest. */
export function houseExamples<T extends { house: string }>(items: readonly T[]): T[] {
    const sorted = [...items].sort((a, b) => compareHouses(a.house, b.house));
    if (sorted.length <= 3) return sorted;
    return [sorted[0], sorted[1], sorted[sorted.length - 1]];
}

// ==================== TOWN POINTS ON THE MAP ====================

/** A place with coordinates, as the map has it. */
export interface MappedPlaceInput {
    key: string;
    usage: PlaceUsage;
    geo: PlaceGeo;
}

/** One house of a town point. */
export interface TownHouse {
    /** houseKey of the house: one row however it is written. */
    key: string;
    /** The house as written (the most frequent form). */
    house: string;
    /** The people with a fact at this house, with the kinds of those facts. */
    persons: Map<PersonId, Set<MapKind>>;
    /** The tree's places this house comes from (the town's own place for a house field there). */
    placeKeys: string[];
}

/** A map point of one place, as today. */
export interface PlacePoint {
    type: 'place';
    key: string;
    usage: PlaceUsage;
    geo: PlaceGeo;
}

/** A map point of a town with its houses. */
export interface TownPoint {
    type: 'town';
    /** 'town:' + townKey — what showPlacesManager and the bubble go by. */
    key: string;
    /** placeKey of the town. */
    townKey: string;
    /** The town as the tree writes it (its own place's spelling, else the members' most used). */
    town: string;
    /** Where the point stands: the town's own place, else its first place found by the town. */
    geo: PlaceGeo;
    /** The town's own place, when it is on the map. */
    ownKey?: string;
    /** Every place of the point: the town's own first, then the houses' places. */
    placeKeys: string[];
    /** The houses, in compareHouses order. */
    houses: TownHouse[];
    /** The people with a fact at the town itself without a house, with those facts' kinds. */
    noHouse: Map<PersonId, Set<MapKind>>;
    /** Distinct people in the point (houses and no house). */
    personCount: number;
    houseCount: number;
}

export type MapPoint = PlacePoint | TownPoint;

/** Whether a person has a fact at a map point (a town's: at one of its houses or at the town itself). */
export function mapPointHasPerson(point: MapPoint, personId: string): boolean {
    if (point.type === 'place') return point.usage.personIds.includes(personId as PersonId);
    return point.noHouse.has(personId as PersonId) || point.houses.some(h => h.persons.has(personId as PersonId));
}

/** The prefix of a town point's key and of showPlacesManager's town target. */
export const TOWN_POINT_PREFIX = 'town:';

/**
 * The map's points: places grouped into one point per town where they are
 * houses of it. Pure; the input are the places with coordinates (already
 * narrowed to the scope and the enabled kinds by collectPlaces).
 *   - A place whose geo was found by the town (`geo.byTown`) and whose name
 *     holds a house (townOfPlace: splitStreet, or a bare number — the bare
 *     number only so) joins the point of its town. A town whose numbers are
 *     its parts ("Praha 5") never does (townOfPlace).
 *   - The town's own place (place = the town) belongs there; the point stands
 *     on its coordinates, else on the first byTown place of the town (input
 *     order).
 *   - Houses from the house field of facts at the town's own place join too
 *     (a tree from the research: place "Bělokamen", house "čp. 16"), so a
 *     place with houses in its facts is a town point even with no member.
 *   - A place with its own exact coordinates (no byTown) stays a point of its
 *     own, also when its name holds a house and its facts a house field.
 * A person is listed under every house they have a fact at, and under "no
 * house" for facts at the town without a house. Points keep the input order
 * (a town point where its first place stood).
 */
export function groupTownPoints(places: readonly MappedPlaceInput[], known?: KnownStreets): MapPoint[] {
    interface Member { place: MappedPlaceInput; parsed: PlaceHouse }
    const members = new Map<string, Member[]>();
    const memberOf = new Map<string, string>();
    for (const p of places) {
        if (!p.geo.byTown) continue;
        const parsed = townOfPlace(p.usage.display, known);
        if (!parsed) continue;
        const townKey = placeKey(parsed.town);
        if (!townKey || townKey === p.key) continue;
        const list = members.get(townKey) ?? [];
        list.push({ place: p, parsed });
        members.set(townKey, list);
        memberOf.set(p.key, townKey);
    }
    const byKey = new Map(places.map(p => [p.key, p]));
    // A place with houses in its facts' house fields is a town point of its own
    // — when it is a town, not itself a house ("Bělokamen čp. 4" stays a place).
    const hasHouse = (u: PlaceUsage): boolean =>
        [...u.houses.values()].some(m => [...m.keys()].some(Boolean)) && !townOfPlace(u.display, known);

    const buildTown = (townKey: string): TownPoint => {
        const own = memberOf.has(townKey) ? undefined : byKey.get(townKey);
        const list = members.get(townKey) ?? [];
        const houses = new Map<string, { texts: Map<string, number>; persons: Map<PersonId, Set<MapKind>>; placeKeys: Set<string> }>();
        const noHouse = new Map<PersonId, Set<MapKind>>();
        const people = new Set<PersonId>();
        const addKinds = (to: Map<PersonId, Set<MapKind>>, id: PersonId, kinds: ReadonlySet<MapKind>): void => {
            const set = to.get(id) ?? new Set<MapKind>();
            for (const k of kinds) set.add(k);
            to.set(id, set);
            people.add(id);
        };
        const addHouse = (text: string, id: PersonId, kinds: ReadonlySet<MapKind>, from: string): void => {
            const key = houseKey(text);
            const h = houses.get(key) ?? { texts: new Map<string, number>(), persons: new Map(), placeKeys: new Set<string>() };
            h.texts.set(text, (h.texts.get(text) ?? 0) + 1);
            addKinds(h.persons, id, kinds);
            h.placeKeys.add(from);
            houses.set(key, h);
        };
        if (own) {
            for (const [id, byHouse] of own.usage.houses) {
                for (const [text, kinds] of byHouse) {
                    if (text) addHouse(text, id, kinds, own.key);
                    else addKinds(noHouse, id, kinds);
                }
            }
        }
        for (const { place, parsed } of list) {
            for (const [id, byHouse] of place.usage.houses) {
                for (const [had, kinds] of byHouse) addHouse(factHouse(parsed.house, had) ?? parsed.house, id, kinds, place.key);
            }
        }
        const most = (m: Map<string, number>): string =>
            [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        const spellings = new Map<string, number>();
        for (const { place, parsed } of list) spellings.set(parsed.town, (spellings.get(parsed.town) ?? 0) + place.usage.count);
        const houseList: TownHouse[] = [...houses.entries()].map(([key, h]) => ({
            key, house: most(h.texts), persons: h.persons, placeKeys: [...h.placeKeys],
        })).sort((a, b) => compareHouses(a.house, b.house));
        return {
            type: 'town',
            key: TOWN_POINT_PREFIX + townKey,
            townKey,
            town: own ? own.usage.display : most(spellings),
            geo: own ? own.geo : list[0].place.geo,
            ...(own ? { ownKey: own.key } : {}),
            placeKeys: [...(own ? [own.key] : []), ...list.map(m => m.place.key)],
            houses: houseList,
            noHouse,
            personCount: people.size,
            houseCount: houseList.length,
        };
    };

    const out: MapPoint[] = [];
    const done = new Set<string>();
    for (const p of places) {
        const townKey = memberOf.get(p.key) ?? (members.has(p.key) || hasHouse(p.usage) ? p.key : undefined);
        if (townKey === undefined) {
            out.push({ type: 'place', key: p.key, usage: p.usage, geo: p.geo });
            continue;
        }
        if (done.has(townKey)) continue;
        done.add(townKey);
        out.push(buildTown(townKey));
    }
    return out;
}

// ==================== TOWNS IN THE PLACES DIALOG ====================

/** A place of the tree that is a house of a town. */
export interface TownHousePlace {
    key: string;
    /** The place as the tree writes it most ("Bělokamen 16"). */
    display: string;
    /** The town as the place writes it ("Bělokamen"). */
    town: string;
    /** The house as the place writes it ("16"). */
    house: string;
    /** A number alone after the town's name: split only on a person's word for the whole town. */
    bare: boolean;
}

/**
 * Where a number alone after a town's name may be offered as a house (the
 * research's rules, strom-research streetsOf().bare): the town is written in
 * the tree without a number, nothing tells the number a part of the town (no
 * street under "<Town> N" elsewhere, no house with a street at "<Town> N"),
 * the town's numbers are no parts by the terms (numberedTown), and the
 * geocoder did not find "<Town> N" as a place of its own (coordinates without
 * byTown).
 */
function bareOffers(data: StromData, known: KnownStreets): (u: PlaceUsage, key: string) => boolean {
    const towns = new Set<string>();
    const parts = new Set<string>();
    const partOf = (first: string): void => {
        const b = bareNumber(first);
        if (b) parts.add(foldText(b.name));
    };
    const streetTowns = new Set<string>();
    forEachPlaceFact(data, fact => {
        const p = fact.place?.trim();
        if (!p) return;
        const s = splitStreet(p, known);
        if (s) partOf(s.town.split(',')[0]!);
        else if (!bareNumber(p)) towns.add(foldText(p.split(',')[0]!));
        const house = fact.house?.trim();
        if (house && streetOfHouse(house)) streetTowns.add(p.split(',')[0]!);
    });
    for (const t of streetTowns) partOf(t);
    return (u, key) => {
        const b = bareNumber(u.display);
        if (!b || numberedTown(b.name)) return false;
        const name = foldText(b.name);
        if (!towns.has(name) || parts.has(name)) return false;
        const geo = data.places?.[key];
        return !(geo && !geo.byTown);
    };
}

/** Every house place of the tree, by the placeKey of its town. */
function townMembers(data: StromData, places: ReadonlyMap<string, PlaceUsage>): Map<string, TownHousePlace[]> {
    const known = knownStreets(data);
    const offer = bareOffers(data, known);
    const out = new Map<string, TownHousePlace[]>();
    for (const [key, usage] of places) {
        const parsed = townOfPlace(usage.display, known);
        if (!parsed) continue;
        if (parsed.bare && !offer(usage, key)) continue;
        const townKey = placeKey(parsed.town);
        if (!townKey || townKey === key) continue;
        const list = out.get(townKey) ?? [];
        list.push({ key, display: usage.display, town: parsed.town, house: parsed.house, bare: parsed.bare });
        out.set(townKey, list);
    }
    for (const list of out.values()) list.sort((a, b) => compareHouses(a.house, b.house) || (a.key < b.key ? -1 : 1));
    return out;
}

/** A town's places with a house, for the Places dialog's split (§7). */
export interface TownHouses {
    townKey: string;
    /** In house order. */
    places: TownHousePlace[];
    /** Some are numbers alone: ask first whether they are houses (for the whole town). */
    hasBare: boolean;
    /** Three examples of all (smallest, second, largest), for the preview. */
    examples: TownHousePlace[];
    /** Three examples of the bare numbers, for the question. */
    bareExamples: TownHousePlace[];
}

/**
 * The places of a town (by placeKey of the town) that hold a house by the
 * research's rules; bare numbers only where they may be offered (bareOffers).
 * `places` defaults to every place of the tree.
 */
export function townHousePlaces(data: StromData, townKey: string, places: ReadonlyMap<string, PlaceUsage> = collectPlaces(data)): TownHouses {
    const list = townMembers(data, places).get(townKey) ?? [];
    const bare = list.filter(p => p.bare);
    return { townKey, places: list, hasBare: bare.length > 0, examples: houseExamples(list), bareExamples: houseExamples(bare) };
}

/** The fewest places with a house that make a town one group in the Places dialog. */
export const TOWN_GROUP_MIN = 3;

/** A town with its house places, one group of the Places dialog (§5). */
export interface TownGroup {
    /** placeKey of the town; the group's target is TOWN_POINT_PREFIX + townKey. */
    townKey: string;
    /** The town as the tree writes it (its own place's spelling, else the members' most used). */
    town: string;
    /** The town's own place key, when the tree has the town as a place. */
    ownKey?: string;
    /** The house places (members), in house order. */
    members: TownHousePlace[];
    /** Distinct houses among the members (houseKey). */
    houseCount: number;
    /** Distinct people of the town's own place and of the members. */
    personCount: number;
    /** Members without coordinates (the town's own place not counted). */
    unplacedCount: number;
    /** Some members are numbers alone (the split asks first). */
    hasBare: boolean;
}

/**
 * The towns of the Places dialog: every town with at least TOWN_GROUP_MIN
 * places with a house (by the research's rules, bare numbers only where they
 * may be offered, never a numbered town like "Praha 5"). `places` is the
 * dialog's list (collectPlaces for its scope), coordinates come from
 * data.places. Ordered by the town's key; the dialog sorts.
 */
export function placeTownGroups(data: StromData, places: ReadonlyMap<string, PlaceUsage> = collectPlaces(data)): TownGroup[] {
    const out: TownGroup[] = [];
    for (const [townKey, members] of townMembers(data, places)) {
        if (members.length < TOWN_GROUP_MIN) continue;
        const own = places.get(townKey);
        const people = new Set<PersonId>(own?.personIds ?? []);
        const houses = new Set<string>();
        const spellings = new Map<string, number>();
        for (const m of members) {
            for (const id of places.get(m.key)!.personIds) people.add(id);
            houses.add(houseKey(m.house));
            spellings.set(m.town, (spellings.get(m.town) ?? 0) + places.get(m.key)!.count);
        }
        out.push({
            townKey,
            town: own?.display ?? [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
            ...(own ? { ownKey: townKey } : {}),
            members,
            houseCount: houses.size,
            personCount: people.size,
            unplacedCount: members.filter(m => !data.places?.[m.key]).length,
            hasBare: members.some(m => m.bare),
        });
    }
    return out.sort((a, b) => (a.townKey < b.townKey ? -1 : a.townKey > b.townKey ? 1 : 0));
}

// ==================== SPLIT INTO TOWN AND HOUSE ====================

export interface SplitPlaceHousesOptions {
    /**
     * Towns (placeKey of the town, TownHousePlace.town) whose numbers alone a
     * person confirmed as houses ("Bělokamen 16" → "Bělokamen" + "16"). Bare
     * numbers of other towns stay.
     */
    bareTowns?: ReadonlySet<string>;
}

export interface SplitPlaceHousesResult {
    data: StromData;
    /** Facts changed: the place became the town, the house went to the house field. */
    changed: number;
    /** Distinct people of the changed facts. */
    persons: number;
    /** Facts left as they are: their house field holds another house. */
    skipped: number;
    /** Facts left as they are: they have no house field (the divorce place). */
    noHouseField: number;
}

/**
 * Split the places `keys` into the town and the house (§7). Works on a COPY
 * (like renamePlace), so the preview and the change run the same code. For
 * every fact at one of the places: the place becomes the town as the tree
 * writes it most, the house field gets the number or the street with its
 * number (splitStreet; a bare number only for a town in `opts.bareTowns`).
 * A house field that already holds another house (houseWith: none; the same
 * house written another way, "čp. 16" beside "16", is no other house) leaves
 * the fact as it is (`skipped`); the divorce place has no house field
 * (`noHouseField`). Towns whose numbers are their parts ("Praha 5") are never
 * split.
 */
export function splitPlaceHouses(data: StromData, keys: readonly string[], opts: SplitPlaceHousesOptions = {}): SplitPlaceHousesResult {
    const keySet = new Set(keys);
    const known = knownStreets(data);
    const usages = collectPlaces(data);
    const copy = structuredClone(data);
    let changed = 0;
    let skipped = 0;
    let noHouseField = 0;
    const persons = new Set<PersonId>();
    // The town as the tree writes it most: its own place's spelling, else the
    // spelling the split places write most.
    const spellings = new Map<string, Map<string, number>>();
    const plan: { fact: PlaceFact; town: string; townKey: string; house: string }[] = [];
    forEachPlaceFact(copy, fact => {
        const place = fact.place?.trim();
        if (!place || !keySet.has(placeKey(place))) return;
        const s = splitStreet(place, known);
        let town: string;
        let house: string;
        if (s) {
            town = s.town;
            house = s.house;
        } else {
            const b = bareNumber(place);
            if (!b || numberedTown(b.name) || !opts.bareTowns?.has(placeKey(b.town))) return;
            town = b.town;
            house = b.house;
        }
        const townKey = placeKey(town);
        const m = spellings.get(townKey) ?? new Map<string, number>();
        m.set(town, (m.get(town) ?? 0) + 1);
        spellings.set(townKey, m);
        plan.push({ fact, town, townKey, house });
    });
    for (const { fact, townKey, house } of plan) {
        if (!fact.hasHouseField) {
            noHouseField++;
            continue;
        }
        const next = factHouse(house, fact.house);
        if (next === undefined) {
            skipped++;
            continue;
        }
        const target = usages.get(townKey)?.display
            ?? [...spellings.get(townKey)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        fact.setPlace(target);
        fact.setHouse(next);
        changed++;
        for (const id of fact.persons) persons.add(id);
    }
    return { data: copy, changed, persons: persons.size, skipped, noHouseField };
}
