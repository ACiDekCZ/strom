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
 */

import { StromData, PersonId } from './types.js';

export interface PlaceUsage {
    /** The spelling shown to the user: the most frequent variant (ties: first alphabetically). */
    display: string;
    /** Every distinct spelling that normalizes to the same key, with counts. */
    variants: Map<string, number>;
    /** How many fields across the tree use this place (all variants together). */
    count: number;
    /** Everyone connected to this place — born, died, married or an event here. */
    personIds: PersonId[];
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
 * is how the map shows just what is on screen.
 */
export function collectPlaces(data: StromData, personFilter?: ReadonlySet<PersonId>): Map<string, PlaceUsage> {
    const out = new Map<string, PlaceUsage>();
    const add = (raw: string | undefined, who: PersonId[]): void => {
        const value = raw?.trim();
        if (!value) return;
        const key = placeKey(value);
        if (!key) return;
        const entry = out.get(key)
            ?? { display: value, variants: new Map<string, number>(), count: 0, personIds: [] };
        entry.variants.set(value, (entry.variants.get(value) ?? 0) + 1);
        entry.count++;
        for (const id of who) if (!entry.personIds.includes(id)) entry.personIds.push(id);
        out.set(key, entry);
    };
    const kept = (id: PersonId): boolean => !personFilter || personFilter.has(id);

    for (const person of Object.values(data.persons)) {
        if (!kept(person.id)) continue;
        add(person.birthPlace, [person.id]);
        add(person.deathPlace, [person.id]);
        for (const ev of person.events ?? []) add(ev.place, [person.id]);
    }
    for (const union of Object.values(data.partnerships)) {
        // A wedding place belongs to both partners; one of them being on screen
        // is enough for the wedding to belong on the map.
        const couple = [union.person1Id, union.person2Id].filter(kept);
        if (couple.length > 0) add(union.startPlace, couple);
    }

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

/** Places written in more than one way — candidates for unification. */
export function placesWithVariants(data: StromData): PlaceUsage[] {
    return [...collectPlaces(data).values()].filter(p => p.variants.size > 1);
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
    const swap = (value: string | undefined): string | undefined => {
        if (!value || placeKey(value) !== fromKey || value === target) return value;
        changed++;
        return target;
    };

    for (const person of Object.values(copy.persons)) {
        person.birthPlace = swap(person.birthPlace);
        person.deathPlace = swap(person.deathPlace);
        for (const ev of person.events ?? []) ev.place = swap(ev.place);
    }
    for (const union of Object.values(copy.partnerships)) union.startPlace = swap(union.startPlace);
    return { data: copy, changed };
}
