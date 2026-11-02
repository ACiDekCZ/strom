/**
 * One group per identified place (spec 034 §4): the ways a place is written
 * in the facts ("Horní Lhota", "H. Lhota", "Ober-Lhota"), its streets and its
 * houses, under the place's name.
 *
 * A group exists only where something says the spellings are one place:
 *   1. the research's record (`placeRefs`, or the live bridge's forms),
 *   2. a rename that unites them — the history of places' names, and the
 *      other names written down by "Unify" (`placeAliases`).
 * Without either nothing changes: the town-and-houses groups of 031 stay.
 *
 * Pure: the Places dialog, the map and the family pages' index of places
 * group by the same rules.
 */

import type { PlaceRecord, PlaceRecordName, StromData } from './types.js';
import type { BridgePlaces } from './places-bridge.js';
import { houseIsStreet, placeKey, townOfPlace, TOWN_GROUP_MIN, type PlaceUsage } from './places.js';
import type { KnownStreets } from './streets.js';
import { PLACE_TEXT_LIMITS } from './place-records.js';

/** What a group's member is to its place. */
export type PlaceMemberTag = 'main' | 'var' | 'old' | 'street' | 'house';

export interface PlaceGroupContext {
    data: StromData;
    live?: BridgePlaces | null;
    /** placeKey of a spelling → placeKey of the place it is another name of (placeAliasMap). */
    aliases?: ReadonlyMap<string, string>;
    known?: KnownStreets;
}

export interface PlaceVariantMember {
    key: string;
    tag: PlaceMemberTag;
    /** An old name's years ("1838–1845"), from the record's names. */
    period?: string;
    /**
     * The member is a way of writing the place itself (its record or other
     * names say so): on the map as the place. A house joined by its town
     * keeps its own location (031).
     */
    same: boolean;
}

export interface PlaceVariantGroup {
    /** The record's id ("L0012") or the placeKey of the name the spellings were united under. */
    key: string;
    /** The name the group is shown under: the record's today's name, else the most used spelling. */
    head: string;
    /** The member written as the head (or the most used spelling): the group's own row. */
    ownKey: string;
    /** The other members: other spellings, old names, streets, houses — in that order. */
    members: PlaceVariantMember[];
    /** Ways the place itself is written: its own row and the other spellings and old names (the "3 spellings" of the head). */
    spellings: number;
    /** Houses and streets (the "1 house" of the head). */
    houses: number;
    /** Facts of all members. */
    facts: number;
    /** Distinct people of all members. */
    persons: number;
}

const TAG_ORDER: Record<PlaceMemberTag, number> = { main: 0, var: 1, old: 2, street: 3, house: 4 };
const MAX_ALIASES = 50;

// ==================== OTHER NAMES (the local store) ====================

/** `placeAliases` as stored: placeKey → spellings, each a short text, no empties, no duplicates. */
export function sanitizePlaceAliases(raw: unknown): Record<string, string[]> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!key || key.length > PLACE_TEXT_LIMITS.key || !Array.isArray(value)) continue;
        const seen = new Set<string>();
        const names: string[] = [];
        for (const v of value) {
            if (typeof v !== 'string') continue;
            const name = v.trim().slice(0, PLACE_TEXT_LIMITS.name);
            const k = placeKey(name);
            if (!k || k === key || seen.has(k)) continue;
            seen.add(k);
            names.push(name);
            if (names.length >= MAX_ALIASES) break;
        }
        if (names.length) out[key] = names;
    }
    return Object.keys(out).length ? out : undefined;
}

/** `spelling` written down as another name of the place `target` (placeKey); the same store when nothing changes. */
export function addPlaceAlias(aliases: Record<string, string[]> | undefined, target: string, spelling: string): Record<string, string[]> | undefined {
    const name = spelling.trim();
    const k = placeKey(name);
    if (!k || !target || k === target) return aliases;
    const list = aliases?.[target] ?? [];
    if (list.some(n => placeKey(n) === k)) return aliases;
    const out: Record<string, string[]> = { ...(aliases ?? {}) };
    // A spelling that was another name of `name` itself moves along with it.
    const carried = out[k] ?? [];
    delete out[k];
    const merged = [...list, name, ...carried.filter(n => placeKey(n) !== target && !list.some(l => placeKey(l) === placeKey(n)))];
    out[target] = merged.slice(0, MAX_ALIASES);
    return out;
}

/** The other names of both trees (a merge): `base`'s first, `incoming`'s added. */
export function mergePlaceAliases(base: StromData, incoming: StromData): Record<string, string[]> | undefined {
    let out = base.placeAliases;
    for (const [target, names] of Object.entries(incoming.placeAliases ?? {})) {
        for (const n of names) out = addPlaceAlias(out, target, n);
    }
    return out && Object.keys(out).length ? out : undefined;
}

/** The other names of the given places (a part of a tree). */
export function placeAliasesFor(data: StromData, keys: ReadonlySet<string>): Record<string, string[]> | undefined {
    const out: Record<string, string[]> = {};
    for (const [target, names] of Object.entries(data.placeAliases ?? {})) {
        if (keys.has(target)) out[target] = [...names];
    }
    return Object.keys(out).length ? out : undefined;
}

/**
 * Which place each other name stands for: the local other names (`placeAliases`)
 * and the history of places' names (`history`: the Places dialog's tree key →
 * [today's name, …], placesHistoryAliases) — placeKey → placeKey; each
 * place named so maps to itself, so it joins its other names' group.
 */
export function placeAliasMap(data: StromData, history?: ReadonlyMap<string, readonly string[]>): Map<string, string> {
    const out = new Map<string, string>();
    for (const [target, names] of Object.entries(data.placeAliases ?? {})) {
        out.set(target, target);
        for (const n of names) {
            const k = placeKey(n);
            if (k && k !== target) out.set(k, target);
        }
    }
    for (const [treeKey, names] of history ?? []) {
        const today = names[0] ? placeKey(names[0]) : '';
        if (!today || out.has(treeKey)) continue;
        out.set(treeKey, today);
        if (!out.has(today)) out.set(today, today);
    }
    return out;
}

// ==================== GROUP KEY ====================

/** The research's record of a place key, when the tree (or the live bridge) has it. */
export function placeRecordOf(key: string, ctx: Pick<PlaceGroupContext, 'data' | 'live'>): PlaceRecord | null {
    const id = ctx.live?.formsByKey[key]?.place ?? ctx.data.placeRefs?.[key];
    if (!id) return null;
    return ctx.live?.places[id] ?? ctx.data.placeRecords?.[id] ?? null;
}

/**
 * The other names the Places dialog's search finds a place by (§4): its
 * record's names (today's and the old ones) and the other names "Unify"
 * wrote down for it. The history of places adds its own (`also`) in the dialog.
 */
export function placeSearchNames(key: string, ctx: Pick<PlaceGroupContext, 'data' | 'live'>): string[] {
    const out: string[] = [];
    const rec = placeRecordOf(key, ctx);
    if (rec) for (const n of rec.names) out.push(n.name);
    for (const n of ctx.data.placeAliases?.[key] ?? []) out.push(n);
    return out;
}

/**
 * What says a place is one with other spellings: its record's id, else the
 * place a rename unites it with (that place's record, when it has one).
 * Null for a place nothing says that of.
 */
export function variantGroupKey(key: string, ctx: PlaceGroupContext): string | null {
    const rec = placeRecordOf(key, ctx);
    if (rec) return rec.id;
    const alias = ctx.aliases?.get(key);
    if (alias) return placeRecordOf(alias, ctx)?.id ?? alias;
    return null;
}

function names(ctx: PlaceGroupContext, groupKey: string): readonly PlaceRecordName[] {
    return ctx.live?.places[groupKey]?.names ?? ctx.data.placeRecords?.[groupKey]?.names ?? [];
}

function periodText(n: PlaceRecordName): string | undefined {
    if (n.from && n.to) return `${n.from}–${n.to}`;
    if (n.from) return `${n.from}–`;
    if (n.to) return `–${n.to}`;
    return undefined;
}

/**
 * The groups of spellings among `places` (the dialog's or the map's list): a
 * group needs at least two spellings, or TOWN_GROUP_MIN houses — fewer houses
 * stay rows of their own as before. Ordered by the head.
 */
export function placeVariantGroups(places: ReadonlyMap<string, PlaceUsage>, ctx: PlaceGroupContext): PlaceVariantGroup[] {
    const byGroup = new Map<string, { key: string; usage: PlaceUsage; house?: string }[]>();
    for (const [key, usage] of places) {
        const own = variantGroupKey(key, ctx);
        let g = own;
        let house: string | undefined;
        if (!g) {
            const town = townOfPlace(usage.display, ctx.known);
            const t = town ? placeKey(town.town) : '';
            if (town && t && t !== key) {
                g = variantGroupKey(t, ctx);
                house = town.house;
            }
        }
        if (!g) continue;
        const list = byGroup.get(g) ?? [];
        list.push({ key, usage, ...(house !== undefined ? { house } : {}) });
        byGroup.set(g, list);
    }
    const out: PlaceVariantGroup[] = [];
    for (const [groupKey, list] of byGroup) {
        const plain = list.filter(m => m.house === undefined);
        const houseN = list.length - plain.length;
        if (plain.length < 2 && houseN < TOWN_GROUP_MIN) continue;
        const recNames = names(ctx, groupKey);
        const head = recNames[0]?.name
            ?? [...(plain.length ? plain : list)].sort((a, b) => b.usage.count - a.usage.count || a.usage.display.localeCompare(b.usage.display))[0]!.usage.display;
        const headKey = placeKey(head);
        const own = plain.find(m => m.key === headKey)
            ?? [...plain].filter(m => !townOfPlace(m.usage.display, ctx.known)).sort((a, b) => b.usage.count - a.usage.count || a.usage.display.localeCompare(b.usage.display))[0]
            ?? [...plain].sort((a, b) => b.usage.count - a.usage.count || a.usage.display.localeCompare(b.usage.display))[0];
        if (!own) continue;
        const members: PlaceVariantMember[] = [];
        for (const m of list) {
            if (m === own) continue;
            if (m.house !== undefined) {
                members.push({ key: m.key, tag: houseIsStreet(m.house) ? 'street' : 'house', same: false });
                continue;
            }
            const old = recNames.slice(1).find(n => placeKey(n.name) === m.key);
            const town = old ? null : townOfPlace(m.usage.display, ctx.known);
            if (old) {
                const period = periodText(old);
                members.push({ key: m.key, tag: 'old', ...(period ? { period } : {}), same: true });
            } else if (town && !town.bare && placeKey(town.town) !== m.key) {
                members.push({ key: m.key, tag: houseIsStreet(town.house) ? 'street' : 'house', same: true });
            } else {
                members.push({ key: m.key, tag: 'var', same: true });
            }
        }
        members.sort((a, b) => TAG_ORDER[a.tag] - TAG_ORDER[b.tag]
            || (places.get(b.key)!.count - places.get(a.key)!.count)
            || places.get(a.key)!.display.localeCompare(places.get(b.key)!.display));
        const people = new Set<string>();
        let facts = 0;
        for (const m of list) {
            facts += m.usage.count;
            for (const id of m.usage.personIds) people.add(id);
        }
        out.push({
            key: groupKey, head, ownKey: own.key, members,
            spellings: 1 + members.filter(m => m.tag === 'var' || m.tag === 'old').length,
            houses: members.filter(m => m.tag === 'house' || m.tag === 'street').length,
            facts, persons: people.size,
        });
    }
    return out.sort((a, b) => a.head.localeCompare(b.head) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The spellings of one place on the map (§4): each way of writing the place
 * (not a house) → the group's own key. A house keeps its own point (by its
 * town, 031). The map draws one point per group.
 */
export function placeSpellingTargets(groups: readonly PlaceVariantGroup[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const g of groups) {
        for (const m of g.members) if (m.same && m.tag !== 'house') out.set(m.key, g.ownKey);
    }
    return out;
}

/** Usages of one place's spellings as one: counts and people summed, shown under `display`. */
export function mergePlaceUsages(display: string, usages: readonly PlaceUsage[]): PlaceUsage {
    const variants = new Map<string, number>();
    const kinds: PlaceUsage['kinds'] = new Map();
    const houses: PlaceUsage['houses'] = new Map();
    const people: PlaceUsage['personIds'] = [];
    const seen = new Set<string>();
    let count = 0;
    for (const u of usages) {
        count += u.count;
        for (const [v, n] of u.variants) variants.set(v, (variants.get(v) ?? 0) + n);
        for (const id of u.personIds) if (!seen.has(id)) { seen.add(id); people.push(id); }
        for (const [id, set] of u.kinds) {
            const into = kinds.get(id) ?? new Set();
            set.forEach(k => into.add(k));
            kinds.set(id, into);
        }
        for (const [id, map] of u.houses) {
            const into = houses.get(id) ?? new Map();
            for (const [h, set] of map) {
                const hs = into.get(h) ?? new Set();
                set.forEach(k => hs.add(k));
                into.set(h, hs);
            }
            houses.set(id, into);
        }
    }
    return { display, variants, count, personIds: people, kinds, houses };
}

/**
 * The map's places with each place's spellings drawn as one point (§4). The
 * point of a group is its own place when that is on the map (`located`), else
 * its first spelling that is; every other spelling joins it, its usage added
 * (a spelling without a location too). A group with nothing on the map stays
 * as it is. `keyOf` tells for every joined spelling which point it is now.
 */
export function mergeSpellingPlaces<T extends { key: string; usage: PlaceUsage }>(
    places: readonly T[], targets: ReadonlyMap<string, string>, heads: ReadonlyMap<string, string>,
    located: (p: T) => boolean = () => true,
): { places: T[]; keyOf: Map<string, string> } {
    const keyOf = new Map<string, string>();
    if (!targets.size) return { places: [...places], keyOf };
    const byKey = new Map(places.map(p => [p.key, p]));
    // Each group's point: its own place on the map, else its first spelling on the map.
    const pointOf = new Map<string, string>();
    for (const p of places) {
        const own = targets.get(p.key);
        if (!own || pointOf.has(own)) continue;
        const ownPlace = byKey.get(own);
        if (ownPlace && located(ownPlace)) pointOf.set(own, own);
        else if (located(p)) pointOf.set(own, p.key);
    }
    for (const own of new Set(targets.values())) {
        const ownPlace = byKey.get(own);
        if (!pointOf.has(own) && ownPlace && located(ownPlace)) pointOf.set(own, own);
    }
    const parts = new Map<string, T[]>();
    for (const p of places) {
        const own = targets.get(p.key) ?? p.key;
        const point = pointOf.get(own) ?? p.key;
        const list = parts.get(point) ?? [];
        list.push(p);
        parts.set(point, list);
        if (point !== p.key) keyOf.set(p.key, point);
    }
    const out: T[] = [];
    for (const p of places) {
        const list = parts.get(p.key);
        if (!list) continue;
        if (list.length === 1) { out.push(p); continue; }
        const display = heads.get(targets.get(p.key) ?? p.key) ?? p.usage.display;
        out.push({ ...p, usage: mergePlaceUsages(display, list.map(x => x.usage)) });
    }
    return { places: out, keyOf };
}

/**
 * The map's places merged by their groups (§4): the tree's records and its
 * other names; `entries` are the places in scope with their locations.
 */
export function mapSpellingPlaces<T extends { key: string; usage: PlaceUsage; geo?: unknown }>(
    data: StromData, entries: readonly T[], known?: KnownStreets,
): { places: T[]; keyOf: Map<string, string> } {
    if (!data.placeRefs && !data.placeAliases) return { places: [...entries], keyOf: new Map() };
    const groups = placeVariantGroups(new Map(entries.map(e => [e.key, e.usage])), { data, aliases: placeAliasMap(data), ...(known ? { known } : {}) });
    const targets = placeSpellingTargets(groups);
    for (const g of groups) if (g.members.some(m => targets.has(m.key))) targets.set(g.ownKey, g.ownKey);
    const heads = new Map(groups.map(g => [g.ownKey, g.head]));
    return mergeSpellingPlaces(entries, targets, heads, e => !!e.geo);
}
