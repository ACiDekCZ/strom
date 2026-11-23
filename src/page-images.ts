/**
 * The pooled images a page output can show (spec 135, part D10b): a saved
 * person page, the family pages' file. Such an output is built from the tree
 * with only these images whole (read from the pool), never the whole tree's:
 * a person's page shows the person's portrait, the couples' photos, the
 * person's files and the excerpts of the sources the person cites or is
 * cited in; a set of pages those of its people, of the partners and children
 * on its family pages, and of their families' sources.
 */

import { personMedia } from './media.js';
import { personSourceRows } from './person-sources.js';
import { POOL_REF, poolIdOf } from './image-ref.js';
import { withPoolRefsReplaced } from './image-expand.js';
import { loadImageUrls } from './media-pool.js';
import type { StromData, PersonId, PartnershipId } from './types.js';

/** Every string anywhere in `value` (plain objects and arrays). */
function eachString(value: unknown, fn: (s: string) => void, depth = 0): void {
    if (typeof value === 'string') { fn(value); return; }
    if (!value || typeof value !== 'object' || depth > 32) return;
    for (const v of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) eachString(v, fn, depth + 1);
}

function addIds(value: unknown, ids: Set<string>): void {
    eachString(value, s => { const id = s.length === 46 ? poolIdOf(s) : null; if (id) ids.add(id); });
}

/** The content ids of the pooled images the person's page can show, added to `ids`. */
function addPersonPageIds(data: StromData, personId: PersonId, ids: Set<string>): void {
    const person = data.persons[personId];
    if (!person) return;
    const partnerships = (person.partnerships ?? []).map(id => data.partnerships[id]).filter(u => !!u);
    const catalog = data.sources ?? {};
    const sourceIds = new Set<string>();
    for (const row of personSourceRows(data, personId, undefined, { stories: true })) sourceIds.add(row.source.id);
    // A source the person's or a couple's records name (a citation anywhere in them).
    const named = (s: string): void => { if (Object.prototype.hasOwnProperty.call(catalog, s)) sourceIds.add(s); };
    eachString(person, named);
    for (const u of partnerships) eachString(u, named);
    addIds(person, ids);
    for (const u of partnerships) addIds(u, ids);
    for (const a of personMedia(data, personId)) addIds(a, ids);
    for (const id of sourceIds) addIds(catalog[id]?.excerpts, ids);
}

/** The content ids of the pooled images a person's page can show. */
export function personPageImageIds(data: StromData, personId: PersonId): Set<string> {
    const ids = new Set<string>();
    addPersonPageIds(data, personId, ids);
    return ids;
}

/**
 * The content ids of the pooled images a set of pages can show: the pages of
 * `persons`, and the people next to them (partners, parents, children — the
 * cards of a family page) and `families`' partners.
 */
export function pageSetImageIds(data: StromData, persons: Iterable<PersonId>, families: Iterable<PartnershipId> = []): Set<string> {
    const people = new Set<PersonId>();
    for (const id of persons) {
        const p = data.persons[id];
        if (!p) continue;
        people.add(id);
        for (const q of [...(p.parentIds ?? []), ...(p.childIds ?? [])]) people.add(q);
        for (const uid of p.partnerships ?? []) {
            const u = data.partnerships[uid];
            if (!u) continue;
            for (const q of [u.person1Id, u.person2Id, ...(u.childIds ?? [])]) if (q) people.add(q);
        }
    }
    for (const uid of families) {
        const u = data.partnerships[uid];
        for (const q of u ? [u.person1Id, u.person2Id] : []) if (q) people.add(q);
    }
    const ids = new Set<string>();
    for (const id of people) addPersonPageIds(data, id, ids);
    return ids;
}

/**
 * A copy of `data` (objects copied, strings shared) with the pooled images
 * `ids` whole — one the pool does not have (or cannot read now) empty text,
 * as expandImages gives it — every other reference kept. Taken at the call.
 */
export async function withImagesWhole<T>(data: T, ids: ReadonlySet<string>): Promise<T> {
    const snapshot = withPoolRefsReplaced(data, id => POOL_REF + id);
    if (ids.size === 0) return snapshot;
    const urls = await loadImageUrls([...ids]);
    return withPoolRefsReplaced(snapshot, id => (ids.has(id) ? urls.get(id) ?? '' : POOL_REF + id));
}
