/**
 * "?" stand-ins in the diagram (T11).
 *
 * A family of one known parent keeps a "?" stand-in for the other parent in
 * the data (see single-parent.ts). The diagram does not draw an empty "?"
 * card: the children are led from the bottom of the known parent's card.
 * The data stays as it is — the stand-in is still filled in by "Add parent".
 *
 * Only a pure stand-in (no name, no data, no parents) in exactly one family,
 * with children, is left out; one with anything of its own, a childless
 * "?" marriage and the focus person itself keep their card.
 *
 * - Several "?" families of one parent are drawn as one: one line from the
 *   parent's card to all those children (foldPlaceholderFamilies).
 * - A parent with no real partner becomes a single parent: the stand-in
 *   leaves the selection and the children hang below the parent's card
 *   (hidePlaceholders, removed from the selection).
 * - A parent with a real partner too keeps the stand-in's slot beside it,
 *   so the children keep their room; the card is not emitted and the line
 *   starts at the parent's card bottom (hidePlaceholders, the returned ids;
 *   step 7 reroutes, step 8 drops the position).
 */

import { StromData, PersonId, PartnershipId, Person, Partnership } from '../../types.js';
import { isPurePlaceholder } from '../../single-parent.js';
import { GraphSelection } from './types.js';

/** The known parent a hideable stand-in stands beside, or null. */
function standInPartner(data: StromData, id: PersonId, focusPersonId: PersonId): { parentId: PersonId; unionId: PartnershipId } | null {
    if (id === focusPersonId || !isPurePlaceholder(data, id)) return null;
    const p = data.persons[id];
    if (p.partnerships.length !== 1) return null;
    const u = data.partnerships[p.partnerships[0]];
    // A childless "?" marriage says the person was married: it stays drawn.
    if (!u || u.childIds.length === 0) return null;
    const parentId = u.person1Id === id ? u.person2Id : u.person1Id;
    const parent = data.persons[parentId];
    if (!parent || parent.isPlaceholder || parentId === id) return null;
    return { parentId, unionId: u.id };
}

/**
 * Whether the diagram leaves this person's card out as an empty "?"
 * stand-in (unless it is the focus): not a hidden partner to point to.
 */
export function isDiagramStandIn(data: StromData, id: PersonId): boolean {
    return standInPartner(data, id, '' as PersonId) !== null;
}

/**
 * A view of the data where each parent has at most one hideable "?" family:
 * the children of the others join the first one (by family id). The input
 * is never changed; unchanged data comes back as the same object.
 */
export function foldPlaceholderFamilies(data: StromData, focusPersonId: PersonId): StromData {
    const byParent = new Map<PersonId, { standInId: PersonId; unionId: PartnershipId }[]>();
    for (const id of Object.keys(data.persons) as PersonId[]) {
        const s = standInPartner(data, id, focusPersonId);
        if (!s) continue;
        const list = byParent.get(s.parentId) ?? [];
        list.push({ standInId: id, unionId: s.unionId });
        byParent.set(s.parentId, list);
    }
    const groups = [...byParent].filter(([, list]) => list.length > 1);
    if (groups.length === 0) return data;

    const persons: Record<string, Person> = { ...data.persons };
    const partnerships: Record<string, Partnership> = { ...data.partnerships };
    for (const [parentId, list] of groups) {
        list.sort((a, b) => a.unionId.localeCompare(b.unionId));
        const [keep, ...fold] = list;
        const foldIds = new Set<string>(fold.map(f => f.standInId));
        const foldUnions = new Set<string>(fold.map(f => f.unionId));
        const kept = partnerships[keep.unionId];
        const childIds = [...kept.childIds];
        for (const f of fold) {
            for (const cid of partnerships[f.unionId].childIds) if (!childIds.includes(cid)) childIds.push(cid);
            delete partnerships[f.unionId];
            delete persons[f.standInId];
        }
        partnerships[keep.unionId] = { ...kept, childIds };
        persons[keep.standInId] = { ...persons[keep.standInId], childIds: [...childIds] };
        const parent = persons[parentId];
        persons[parentId] = { ...parent, partnerships: parent.partnerships.filter(u => !foldUnions.has(u)) };
        for (const cid of childIds) {
            const child = persons[cid];
            if (!child || !child.parentIds.some(p => foldIds.has(p))) continue;
            const parentIds = child.parentIds.map(p => foldIds.has(p) ? keep.standInId : p)
                .filter((p, i, a) => a.indexOf(p) === i);
            persons[cid] = { ...child, parentIds };
        }
    }
    return { ...data, persons: persons as StromData['persons'], partnerships: partnerships as StromData['partnerships'] };
}

/**
 * Leave the hideable stand-ins out of the selected subgraph. A stand-in
 * whose parent has no family with a real partner leaves the selection (with
 * its family) — the parent becomes a single parent. One whose parent has a
 * real partner too stays as a slot of the chain and is returned: its card
 * is not emitted and its children's line starts at the parent's card.
 */
export function hidePlaceholders(data: StromData, selection: GraphSelection, focusPersonId: PersonId): Set<PersonId> {
    const standIns = new Map<PersonId, { parentId: PersonId; unionId: PartnershipId }>();
    for (const id of selection.persons) {
        const s = standInPartner(data, id, focusPersonId);
        if (s && selection.persons.has(s.parentId) && selection.partnerships.has(s.unionId)) standIns.set(id, s);
    }
    const slots = new Set<PersonId>();
    for (const [id, { parentId, unionId }] of standIns) {
        // Read from the data, not the view: a single parent only when every
        // family of the parent is a "?" one. A family with a real partner,
        // even one out of view, keeps the stand-in's slot (its children are
        // not the single parent's).
        const parent = data.persons[parentId];
        const otherFamily = parent.partnerships.some(uid => {
            if (uid === unionId) return false;
            const u = data.partnerships[uid];
            if (!u) return false;
            const other = u.person1Id === parentId ? u.person2Id : u.person1Id;
            return !standInPartner(data, other, focusPersonId);
        });
        if (otherFamily) {
            slots.add(id);
        } else {
            selection.persons.delete(id);
            selection.partnerships.delete(unionId);
        }
    }
    return slots;
}
