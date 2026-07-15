/**
 * Surnames that mean the same family (K3 v2).
 *
 * Before about 1900 spelling was not fixed: one register writes Víšek, the next
 * Vyšek, a German-kept one Wischek. That is a fact about the NAME, so it is
 * written down once for the whole tree (StromData.surnameVariants) — the same
 * reasoning as a place's coordinates belonging to the place rather than to
 * whoever was born there.
 *
 * A group is an EQUIVALENCE, not "the right spelling plus its variants". Your
 * great-grandfather is written Vyšek and you are Víšek; neither is a variant of
 * the other, and a search for either has to find both. Per-person spellings
 * (Person.nameVariants) stay for what really belongs to one person: an alias, or
 * the farm a family was known by.
 */

import { StromData } from './types.js';

/** Compare surnames the way search does: no case, no diacritics. */
export function surnameKey(raw: string): string {
    return raw
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Every written form of this surname, itself included. An unknown surname comes
 * back as just itself, so callers never need to special-case it.
 */
export function surnameForms(surname: string, data: StromData): string[] {
    const key = surnameKey(surname);
    if (!key) return [];
    const group = (data.surnameVariants ?? []).find(g => g.some(n => surnameKey(n) === key));
    if (!group) return [surname];
    // The person's own spelling first: it is the one on their record.
    return [surname, ...group.filter(n => surnameKey(n) !== key)];
}

/** Do these two surnames mean the same family? */
export function sameSurname(a: string, b: string, data: StromData): boolean {
    const ka = surnameKey(a);
    const kb = surnameKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    return (data.surnameVariants ?? []).some(g => {
        const keys = g.map(surnameKey);
        return keys.includes(ka) && keys.includes(kb);
    });
}

/**
 * Add a group, merging it into any group it overlaps. Adding {Víšek, Vyšek} when
 * {Vyšek, Wischek} exists has to end with one group of three — otherwise Víšek
 * and Wischek would stay strangers despite both being Vyšek.
 */
export function addSurnameGroup(data: StromData, names: string[]): string[][] {
    const cleaned = [...new Set(names.map(n => n.trim()).filter(Boolean))];
    if (cleaned.length < 2) return data.surnameVariants ?? [];

    const keys = new Set(cleaned.map(surnameKey));
    const groups = data.surnameVariants ?? [];
    const untouched: string[][] = [];
    const merged: string[] = [...cleaned];

    for (const group of groups) {
        if (group.some(n => keys.has(surnameKey(n)))) {
            for (const name of group) {
                if (!merged.some(m => surnameKey(m) === surnameKey(name))) merged.push(name);
            }
        } else {
            untouched.push(group);
        }
    }
    return [...untouched, merged.sort((a, b) => a.localeCompare(b))];
}

/** Drop the group this surname belongs to. */
export function removeSurnameGroup(data: StromData, surname: string): string[][] {
    const key = surnameKey(surname);
    return (data.surnameVariants ?? []).filter(g => !g.some(n => surnameKey(n) === key));
}

/** Surnames actually used in the tree, most common first — for suggesting groups. */
export function surnamesInTree(data: StromData): { surname: string; count: number }[] {
    const counts = new Map<string, { surname: string; count: number }>();
    for (const person of Object.values(data.persons)) {
        const name = person.lastName?.trim();
        if (!name || person.isPlaceholder) continue;
        const key = surnameKey(name);
        const seen = counts.get(key);
        if (seen) seen.count++;
        else counts.set(key, { surname: name, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.surname.localeCompare(b.surname));
}
