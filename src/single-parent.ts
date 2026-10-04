/**
 * A child with one known parent, kept one way only: a family of that parent
 * and a "?" stand-in for the other one (Person.isPlaceholder). The layout,
 * the editors and the exports all know that family; a parent link without
 * a family ("loose", as "Add parent" with one parent, the family wizard and
 * Strom's own _STROM_NO_COUPLE families made it) was not drawn below its
 * parent and was easy to lose. Loose single parents are turned into that
 * family on load (deterministic ids: the same data gives the same family),
 * a stand-in is replaced in place when the real other parent is added, and
 * one left behind with nothing to stand for goes. Pure: works on the data.
 */

import { StromData, Person, PersonId, PartnershipId, Partnership } from './types.js';

/**
 * A stand-in and nothing more: no name, no data of its own, no parents —
 * it only marks the other parent of a family. One with anything of its own
 * (parents, an event, a note, a source…) is kept as a person.
 */
export function isPurePlaceholder(data: StromData, id: PersonId): boolean {
    const p = data.persons[id];
    if (!p || !p.isPlaceholder) return false;
    if ((p.firstName && p.firstName !== '?') || p.lastName) return false;
    if (p.parentIds.length > 0) return false;
    const own: (keyof Person)[] = ['birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'deathCause', 'notes', 'photo', 'refn', 'question'];
    if (own.some(k => { const v = p[k]; return typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null && v !== false; })) return false;
    if ((p.events?.length ?? 0) > 0 || (p.attachments?.length ?? 0) > 0) return false;
    if ((p.sourceIds?.length ?? 0) + (p.birthSourceIds?.length ?? 0) + (p.deathSourceIds?.length ?? 0) > 0) return false;
    return true;
}

/** Child → parent links a family of the parent with that child does not cover. */
function looseParents(data: StromData, child: Person): PersonId[] {
    return child.parentIds.filter(pid =>
        !Object.values(data.partnerships).some(u => u.childIds.includes(child.id) && (u.person1Id === pid || u.person2Id === pid)));
}

/** Parent id → its children linked to it alone, outside any family (a "?" family is due). */
export function looseSingleParents(data: StromData): Map<PersonId, PersonId[]> {
    const groups = new Map<PersonId, PersonId[]>();
    for (const child of Object.values(data.persons)) {
        if (child.parentIds.length !== 1) continue;
        const pid = child.parentIds[0];
        const parent = data.persons[pid];
        if (!parent || parent.isPlaceholder) continue;
        if (looseParents(data, child).length !== 1) continue;
        const list = groups.get(pid) ?? [];
        list.push(child.id);
        groups.set(pid, list);
    }
    return groups;
}

/**
 * Turn every loose single parent into a family with a "?" stand-in: one
 * family per parent and set of such children (as GEDCOM would group them).
 * A child whose only parent is itself a stand-in is left as it is (two
 * stand-ins would say nothing more). Returns whether anything changed.
 */
export function normalizeSingleParents(data: StromData): boolean {
    const groups = looseSingleParents(data);
    if (groups.size === 0) return false;
    for (const [pid, children] of groups) {
        const parent = data.persons[pid];
        const first = [...children].sort()[0];
        let phId = `p_single_${pid}_${first}` as PersonId;
        let uId = `u_single_${pid}_${first}` as PartnershipId;
        // (Never over someone else's record.)
        while (data.persons[phId] || data.partnerships[uId]) {
            phId = `${phId}_` as PersonId;
            uId = `${uId}_` as PartnershipId;
        }
        const stand: Person = {
            id: phId, firstName: '?', lastName: '', gender: parent.gender === 'male' ? 'female' : 'male',
            isPlaceholder: true, partnerships: [uId], parentIds: [], childIds: [...children],
        };
        const union: Partnership = { id: uId, person1Id: pid, person2Id: phId, childIds: [...children], status: 'married' };
        data.persons[phId] = stand;
        data.partnerships[uId] = union;
        parent.partnerships = [...parent.partnerships, uId];
        for (const cid of children) {
            const child = data.persons[cid];
            child.parentIds = [...child.parentIds, phId];
        }
    }
    return true;
}

/**
 * The real other parent `parentId` takes the stand-in's place in its family:
 * in the family itself, and as the parent of every child of it. When that
 * parent already has a family with the known parent, the children move into
 * it (one family, never a second). The stand-in goes when nothing is left.
 */
export function fillPlaceholder(data: StromData, placeholderId: PersonId, parentId: PersonId): void {
    const stand = data.persons[placeholderId];
    const parent = data.persons[parentId];
    if (!stand || !parent || placeholderId === parentId) return;
    for (const uid of [...stand.partnerships]) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const otherId = u.person1Id === placeholderId ? u.person2Id : u.person1Id;
        const existing = Object.values(data.partnerships).find(x => x.id !== uid
            && ((x.person1Id === parentId && x.person2Id === otherId) || (x.person2Id === parentId && x.person1Id === otherId)));
        if (existing) {
            for (const cid of u.childIds) if (!existing.childIds.includes(cid)) existing.childIds.push(cid);
            delete data.partnerships[uid];
            const other = data.persons[otherId];
            if (other) other.partnerships = other.partnerships.filter(x => x !== uid);
        } else {
            if (u.person1Id === placeholderId) u.person1Id = parentId;
            else u.person2Id = parentId;
            if (!parent.partnerships.includes(uid)) parent.partnerships.push(uid);
        }
    }
    stand.partnerships = [];
    for (const cid of [...stand.childIds]) {
        const child = data.persons[cid];
        if (!child) continue;
        child.parentIds = child.parentIds.map(p => p === placeholderId ? parentId : p).filter((p, i, a) => a.indexOf(p) === i);
        if (child.parentRelTypes && placeholderId in child.parentRelTypes) {
            child.parentRelTypes[parentId] = child.parentRelTypes[placeholderId];
            delete child.parentRelTypes[placeholderId];
        }
        if (!parent.childIds.includes(cid)) parent.childIds.push(cid);
    }
    stand.childIds = [];
    delete data.persons[placeholderId];
}

/**
 * After a person, a link or a family went: stand-ins among `ids` keep only
 * what they stand for. A child no longer in the stand-in's family loses the
 * "?" parent, a family of the stand-in with no children left goes, and a
 * stand-in with no family goes. Children left with one real parent get
 * their "?" family again (normalizeSingleParents). Returns whether anything changed.
 */
export function tidyPlaceholders(data: StromData, ids: readonly PersonId[]): boolean {
    let changed = false;
    for (const id of new Set(ids)) {
        const p = data.persons[id];
        if (!p || !isPurePlaceholder(data, id)) continue;
        const unions = p.partnerships.map(uid => data.partnerships[uid]).filter((u): u is Partnership => !!u);
        // A child outside the stand-in's families: the "?" says nothing there.
        for (const cid of [...p.childIds]) {
            if (unions.some(u => u.childIds.includes(cid))) continue;
            const child = data.persons[cid];
            if (child) {
                child.parentIds = child.parentIds.filter(x => x !== id);
                if (child.parentRelTypes && id in child.parentRelTypes) {
                    delete child.parentRelTypes[id];
                    if (Object.keys(child.parentRelTypes).length === 0) delete child.parentRelTypes;
                }
            }
            p.childIds = p.childIds.filter(x => x !== cid);
            changed = true;
        }
        // A family of the stand-in without children: an empty "?" partner.
        for (const u of unions) {
            if (u.childIds.length > 0) continue;
            delete data.partnerships[u.id];
            const otherId = u.person1Id === id ? u.person2Id : u.person1Id;
            const other = data.persons[otherId];
            if (other) other.partnerships = other.partnerships.filter(x => x !== u.id);
            changed = true;
        }
        p.partnerships = p.partnerships.filter(uid => data.partnerships[uid]);
        if (p.partnerships.length === 0 && p.childIds.length === 0) {
            delete data.persons[id];
            changed = true;
        }
    }
    return normalizeSingleParents(data) || changed;
}
