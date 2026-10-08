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

import { StromData, Person, PersonId, PartnershipId, Partnership, oppositeGender } from './types.js';

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

/** Parent id → its children linked to it alone, outside any family (a "?" family each is due). */
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
 * Turn every loose single parent into a family with a "?" stand-in — one
 * per child: two children of one known parent need not share the unknown
 * other one (nothing said they do; a family from GEDCOM that does keeps its
 * one "?"). A child whose only parent is itself a stand-in is left as it is
 * (two stand-ins would say nothing more). Returns whether anything changed.
 */
export function normalizeSingleParents(data: StromData): boolean {
    const groups = looseSingleParents(data);
    if (groups.size === 0) return false;
    for (const [pid, kids] of groups) {
        const parent = data.persons[pid];
        for (const cid of kids) {
            let phId = `p_single_${pid}_${cid}` as PersonId;
            let uId = `u_single_${pid}_${cid}` as PartnershipId;
            // (Never over someone else's record.)
            while (data.persons[phId] || data.partnerships[uId]) {
                phId = `${phId}_` as PersonId;
                uId = `${uId}_` as PartnershipId;
            }
            data.persons[phId] = {
                id: phId, firstName: '?', lastName: '', gender: oppositeGender(parent.gender),
                isPlaceholder: true, partnerships: [uId], parentIds: [], childIds: [cid],
            };
            data.partnerships[uId] = { id: uId, person1Id: pid, person2Id: phId, childIds: [cid], status: 'married' };
            parent.partnerships = [...parent.partnerships, uId];
            const child = data.persons[cid];
            child.parentIds = [...child.parentIds, phId];
        }
    }
    return true;
}

/**
 * The real other parent `parentId` takes the stand-in's place for the
 * children in `childIds` — never for a child the user did not name (a
 * sibling in the same "?" family may have another father). All of the
 * stand-in's children named: the parent takes its place in the family
 * itself. Some only: they move into a family of the known parent and this
 * one (an existing one, never a second), the others keep the "?". When the
 * known parent and `parentId` already have a family, the children join it.
 * The stand-in goes when nothing is left.
 */
export function fillPlaceholder(data: StromData, placeholderId: PersonId, parentId: PersonId, childIds: readonly PersonId[]): void {
    const stand = data.persons[placeholderId];
    const parent = data.persons[parentId];
    if (!stand || !parent || placeholderId === parentId) return;
    const named = new Set(childIds.filter(cid => stand.childIds.includes(cid)));
    if (named.size === 0) return;
    for (const uid of [...stand.partnerships]) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const moving = u.childIds.filter(cid => named.has(cid));
        if (moving.length === 0) continue;
        const otherId = u.person1Id === placeholderId ? u.person2Id : u.person1Id;
        const other = data.persons[otherId];
        const existing = Object.values(data.partnerships).find(x => x.id !== uid
            && ((x.person1Id === parentId && x.person2Id === otherId) || (x.person2Id === parentId && x.person1Id === otherId)));
        const all = moving.length === u.childIds.length;
        if (existing) {
            for (const cid of moving) if (!existing.childIds.includes(cid)) existing.childIds.push(cid);
            u.childIds = u.childIds.filter(cid => !named.has(cid));
        } else if (all) {
            if (u.person1Id === placeholderId) u.person1Id = parentId;
            else u.person2Id = parentId;
            if (!parent.partnerships.includes(uid)) parent.partnerships.push(uid);
            stand.partnerships = stand.partnerships.filter(x => x !== uid);
        } else {
            const nu: Partnership = { id: `${uid}_${parentId}` as PartnershipId, person1Id: otherId, person2Id: parentId, childIds: moving, status: 'married' };
            data.partnerships[nu.id] = nu;
            parent.partnerships.push(nu.id);
            if (other) other.partnerships.push(nu.id);
            u.childIds = u.childIds.filter(cid => !named.has(cid));
        }
        // A "?" family left without children goes.
        if (data.partnerships[uid] && data.partnerships[uid].childIds.length === 0 && (data.partnerships[uid].person1Id === placeholderId || data.partnerships[uid].person2Id === placeholderId)) {
            delete data.partnerships[uid];
            if (other) other.partnerships = other.partnerships.filter(x => x !== uid);
            stand.partnerships = stand.partnerships.filter(x => x !== uid);
        }
    }
    for (const cid of named) {
        const child = data.persons[cid];
        if (!child) continue;
        child.parentIds = child.parentIds.map(p => p === placeholderId ? parentId : p).filter((p, i, a) => a.indexOf(p) === i);
        if (child.parentRelTypes && placeholderId in child.parentRelTypes) {
            child.parentRelTypes[parentId] = child.parentRelTypes[placeholderId];
            delete child.parentRelTypes[placeholderId];
        }
        if (!parent.childIds.includes(cid)) parent.childIds.push(cid);
    }
    stand.childIds = stand.childIds.filter(cid => !named.has(cid));
    if (stand.childIds.length === 0 && stand.partnerships.length === 0) delete data.persons[placeholderId];
}

/** The other children of the "?" family a child shares with its known parent (siblings who may or may not share the new parent). */
export function placeholderSiblings(data: StromData, childId: PersonId): PersonId[] {
    const child = data.persons[childId];
    if (!child) return [];
    const stand = child.parentIds.find(pid => isPurePlaceholder(data, pid));
    if (!stand) return [];
    const u = Object.values(data.partnerships).find(x => x.childIds.includes(childId) && (x.person1Id === stand || x.person2Id === stand));
    return u ? u.childIds.filter(cid => cid !== childId) : [];
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

/** A family the conversion made (`u_single_…`) that holds nothing but its ids and children. */
function plainConverted(u: Partnership | undefined): boolean {
    if (!u || !u.id.startsWith('u_single_') || u.status !== 'married') return false;
    return Object.keys(u).every(k => k === 'id' || k === 'person1Id' || k === 'person2Id' || k === 'childIds' || k === 'status');
}

/**
 * The tree as it was before the conversion made its "?" families (for the
 * fingerprint that tells whether the research has the tree): a stand-in the
 * conversion made, with nothing of its own in a family with nothing of its
 * own, is left out, and so are its links. Anything the user added to it
 * (a name, a date, the family's wedding) keeps it in. Unchanged data comes
 * back as it is (the same object).
 */
export function withoutConvertedStandIns(data: StromData): StromData {
    const drop = Object.values(data.persons).filter(p => p.id.startsWith('p_single_') && isPurePlaceholder(data, p.id)
        && p.partnerships.length > 0 && p.partnerships.every(uid => plainConverted(data.partnerships[uid])));
    if (drop.length === 0) return data;
    const ids = new Set<string>(drop.map(p => p.id));
    const unions = new Set<string>(drop.flatMap(p => p.partnerships));
    const persons: Record<string, Person> = {};
    for (const [id, p] of Object.entries(data.persons)) {
        if (ids.has(id)) continue;
        const touched = p.parentIds.some(x => ids.has(x)) || p.partnerships.some(x => unions.has(x));
        persons[id] = touched ? { ...p, parentIds: p.parentIds.filter(x => !ids.has(x)), partnerships: p.partnerships.filter(x => !unions.has(x)) } : p;
    }
    const partnerships: Record<string, Partnership> = {};
    for (const [id, u] of Object.entries(data.partnerships)) if (!unions.has(id)) partnerships[id] = u;
    return { ...data, persons: persons as StromData['persons'], partnerships: partnerships as StromData['partnerships'] };
}
