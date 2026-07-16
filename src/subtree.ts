/**
 * Extract a self-contained tree from a subset of persons — the data behind the
 * "make a new tree from the current view" action.
 *
 * WYSIWYG with minimal glue: the caller passes the persons that are currently
 * visible (renderer.positions). We keep exactly those, plus we pull in the
 * OTHER partner of any kept couple that has a kept child, so children never end
 * up half-orphaned in the new tree. Relationships and partnerships pointing
 * outside the kept set are dropped (those persons simply become roots/leaves),
 * so the result is internally consistent and passes validation.
 */

import { StromData, Person, PersonId, Partnership, PartnershipId } from './types.js';
import { placeKey } from './places.js';

/**
 * Build a deep-copied StromData containing only `seedIds` (plus glue partners),
 * with every relationship/partnership restricted to the kept set. Sources are
 * carried along only where still cited; the source catalog is pruned to what
 * remains referenced.
 */
export function extractSubtree(data: StromData, seedIds: Set<PersonId>): StromData {
    // 1. Glue: for any partnership with a kept child and one kept partner,
    //    add the missing partner so the child keeps both parents.
    const kept = new Set<PersonId>(seedIds);
    for (const union of Object.values(data.partnerships)) {
        const p1In = kept.has(union.person1Id);
        const p2In = kept.has(union.person2Id);
        if (p1In === p2In) continue;               // both in or both out — nothing to glue
        const hasKeptChild = union.childIds.some(c => seedIds.has(c));
        if (hasKeptChild) kept.add(p1In ? union.person2Id : union.person1Id);
    }

    // 2. Copy the kept persons, restricting relationship links to the kept set.
    const persons: Record<string, Person> = {};
    for (const id of kept) {
        const src = data.persons[id];
        if (!src) continue;
        const copy: Person = structuredClone(src);
        copy.parentIds = copy.parentIds.filter(pid => kept.has(pid));
        copy.childIds = copy.childIds.filter(cid => kept.has(cid));
        if (copy.parentRelTypes) {
            for (const key of Object.keys(copy.parentRelTypes)) {
                if (!kept.has(key as PersonId)) delete copy.parentRelTypes[key as PersonId];
            }
        }
        // A linked godparent/witness who stays in the other half keeps their
        // written name instead of a dangling id — the record loses the link,
        // not the fact.
        for (const ev of copy.events ?? []) {
            for (const part of ev.participants ?? []) {
                if (part.personId && !kept.has(part.personId)) {
                    const gone = data.persons[part.personId];
                    const written = `${gone?.firstName ?? ''} ${gone?.lastName ?? ''}`.trim();
                    if (!part.name && written && written !== '?') part.name = written;
                    delete part.personId;
                }
            }
        }
        copy.partnerships = [];   // rebuilt below from the kept partnerships
        persons[id] = copy;
    }

    // 3. Keep partnerships whose BOTH partners survived; restrict their children.
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, union] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        if (!kept.has(union.person1Id) || !kept.has(union.person2Id)) continue;
        const copy: Partnership = structuredClone(union);
        copy.childIds = copy.childIds.filter(c => kept.has(c));
        partnerships[uid] = copy;
        persons[union.person1Id]?.partnerships.push(uid);
        persons[union.person2Id]?.partnerships.push(uid);
    }

    // 4. Prune the source catalog to citations that still exist.
    const usedSources = new Set<string>();
    for (const p of Object.values(persons)) {
        p.sourceIds?.forEach(s => usedSources.add(s));
        p.events?.forEach(ev => ev.sourceIds?.forEach(s => usedSources.add(s)));
        p.attachments?.forEach(a => { if (a.sourceId) usedSources.add(a.sourceId); });
    }
    for (const u of Object.values(partnerships)) {
        u.sourceIds?.forEach(s => usedSources.add(s));
    }
    const result: StromData = {
        persons: persons as StromData['persons'],
        partnerships: partnerships as StromData['partnerships'],
    };
    if (data.sources) {
        const sources: StromData['sources'] = {};
        for (const [sid, src] of Object.entries(data.sources)) {
            if (usedSources.has(sid)) sources[sid] = structuredClone(src);
        }
        if (Object.keys(sources).length > 0) result.sources = sources;
    }

    // 5. Tree-level registries travel with the new tree. Coordinates are pruned
    //    to places the kept persons still use; surname groups are cheap facts
    //    about names and come along whole — an unused group is not wrong.
    if (data.places) {
        const usedPlaces = collectSubtreePlaceKeys(result);
        const places: NonNullable<StromData['places']> = {};
        for (const [key, geo] of Object.entries(data.places)) {
            if (usedPlaces.has(key)) places[key] = structuredClone(geo);
        }
        if (Object.keys(places).length > 0) result.places = places;
    }
    if (data.surnameVariants && data.surnameVariants.length > 0) {
        result.surnameVariants = structuredClone(data.surnameVariants);
    }
    return result;
}

/** Every placeKey the extracted persons/partnerships still refer to. */
function collectSubtreePlaceKeys(data: StromData): Set<string> {
    const keys = new Set<string>();
    const add = (place?: string): void => {
        if (place?.trim()) keys.add(placeKey(place));
    };
    for (const p of Object.values(data.persons)) {
        add(p.birthPlace);
        add(p.deathPlace);
        p.events?.forEach(ev => add(ev.place));
    }
    for (const u of Object.values(data.partnerships)) {
        add(u.startPlace);
    }
    return keys;
}
