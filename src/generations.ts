/**
 * Generation assignment shared across features (family book, statistics).
 *
 * Generation = longest ancestor path (a person is one generation below their
 * deepest parent). Memoized DAG walk with a cycle guard, so malformed data with
 * a parent loop resolves to 0 rather than recursing forever. Roots (no parents)
 * are generation 0; the number grows downward toward descendants.
 */

import { StromData, PersonId } from './types.js';

/** Map every person id to its generation number (0 = oldest ancestor). */
export function assignGenerations(data: StromData): Map<string, number> {
    const { persons } = data;
    const gen = new Map<string, number>();
    const genOf = (id: string, seen = new Set<string>()): number => {
        if (gen.has(id)) return gen.get(id)!;
        if (seen.has(id)) return 0; // cycle guard
        seen.add(id);
        const p = persons[id as PersonId];
        let g = 0;
        if (p && p.parentIds.length > 0) {
            g = Math.max(...p.parentIds.map(pid => genOf(pid, seen))) + 1;
        }
        gen.set(id, g);
        return g;
    };
    for (const id of Object.keys(persons)) genOf(id);
    return gen;
}
