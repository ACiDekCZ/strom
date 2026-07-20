/**
 * Splitting one tree into the families it contains (N4).
 *
 * INVARIANT #0 — the partition is a property of the DATA, not the vantage point.
 * The same tree always breaks into the same families, whoever you happen to be
 * looking at. The focus person never changes WHO ends up with WHOM; it only
 * changes PRESENTATION — which family is listed first and which person a new
 * tree opens on. (An earlier version grew families outward from the focus along
 * connector chains, so the cut depended on where you started and even two
 * siblings produced different splits. That is fixed here.)
 *
 * The unit rule (objective, orientation-free): every person belongs to exactly
 * one NUCLEAR family, identified deterministically from the graph:
 *   1. If the person has a marriage/partnership, their home is their PRIMARY
 *      union (the `isPrimary` one, else the earliest by start date then id).
 *      Both spouses of a union whose primary it is land together — couples are
 *      atomic — as do that union's unmarried children.
 *   2. Otherwise, if they have parents, their home is the union that produced
 *      them (they stay with their parents and siblings).
 *   3. Otherwise they are their own single-person family.
 * A person married more than once is owned by ONE union (their primary); their
 * other spouses are owned by their own primary union, so a second marriage
 * becomes its own small family (the in-law is added back only as a link anchor).
 *
 * Kept invariants: every real person appears in exactly one family; no family is
 * placeholder-only (unknown GEDCOM slots fold into the real family that owns a
 * relative); the split is deterministic; the preview shows exactly the family.
 *
 * Cross-tree link: each family (except the focus one) records a `connectorId` —
 * a real person in a NEIGHBOURING family (a parent, spouse or child on its
 * edge). The tree-creation step adds that one shared card so the existing
 * cross-tree badge can tie the new trees back together. It is never counted in
 * `personIds`.
 */

import { PersonId, PartnershipId, StromData } from './types.js';
import { selectSubgraph } from './layout/pipeline/1-select-subgraph.js';

/** One proposed family: a disjoint nuclear unit of the tree. */
export interface FamilyComponent {
    /** The family's senior real person (same as `nameAnchorId`; kept for compat). */
    focusId: PersonId;
    /**
     * A real person in a NEIGHBOURING family used as the shared link card, or
     * null. Added as an anchor at tree-creation time so the cross-tree badge can
     * form. Never counted in `personIds`.
     */
    connectorId: PersonId | null;
    /** Persons this family owns — disjoint from every other family, sorted. */
    personIds: PersonId[];
    /** Person the new tree opens on (the focus if it lives here, else the anchor). */
    defaultPersonId: PersonId;
    /** The real person the family is named after — never a placeholder. */
    nameAnchorId: PersonId;
    /** True for the family that contains the focus person (presentation only). */
    isFirst: boolean;
}

/**
 * Options are presentation-only now (the partition ignores them); kept so
 * existing callers compile. Depths/view no longer influence WHO is in a family.
 */
export interface DecomposeOptions {
    ancestorDepth?: number;
    descendantDepth?: number;
    includeAuntsUncles?: boolean;
    includeCousins?: boolean;
    firstViewIds?: Set<PersonId>;
}

/** Partners of a person across all their unions (existing persons only). */
function partnersOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const out: PersonId[] = [];
    for (const uid of p.partnerships) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const other = u.person1Id === id ? u.person2Id : u.person1Id;
        if (data.persons[other]) out.push(other);
    }
    return out;
}

/** Every first-degree relative of a person that exists in the data. */
function relativesOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    return [...p.parentIds, ...p.childIds, ...partnersOf(data, id)].filter(r => data.persons[r]);
}

/** Deterministic order: birthdate, then id, so the split never wobbles. */
function sortIds(data: StromData, ids: PersonId[]): PersonId[] {
    return ids.slice().sort((a, b) => {
        const ba = data.persons[a]?.birthDate ?? '9999';
        const bb = data.persons[b]?.birthDate ?? '9999';
        if (ba !== bb) return ba < bb ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
    });
}

function isReal(data: StromData, id: PersonId): boolean {
    const p = data.persons[id];
    return !!p && !p.isPlaceholder;
}

/** The person's primary union: the flagged one, else the earliest (start,id). */
function primaryUnionOf(data: StromData, id: PersonId): PartnershipId | null {
    const unions = (data.persons[id]?.partnerships ?? []).filter(u => data.partnerships[u]);
    if (unions.length === 0) return null;
    const flagged = unions.find(u => data.partnerships[u].isPrimary);
    if (flagged) return flagged;
    return unions.slice().sort((a, b) => {
        const sa = data.partnerships[a].startDate ?? '';
        const sb = data.partnerships[b].startDate ?? '';
        if (sa !== sb) return sa < sb ? -1 : 1;
        return a < b ? -1 : 1;
    })[0];
}

/** The union that produced this person (its childIds include them), if any. */
function parentsUnionOf(data: StromData, id: PersonId): PartnershipId | null {
    const parents = (data.persons[id]?.parentIds ?? []).filter(p => data.persons[p]);
    if (parents.length < 2) return null;
    for (const [uid, u] of Object.entries(data.partnerships) as [PartnershipId, StromData['partnerships'][PartnershipId]][]) {
        if (u.childIds.includes(id) && parents.includes(u.person1Id) && parents.includes(u.person2Id)) return uid;
    }
    return null;
}

/**
 * The objective home key for a person (see invariant #0). Two persons share a
 * family exactly when their home keys are equal — no reference to any focus.
 */
function homeKeyOf(data: StromData, id: PersonId): string {
    const own = primaryUnionOf(data, id);
    if (own) return `U:${own}`;
    const parents = parentsUnionOf(data, id);
    if (parents) return `U:${parents}`;
    const parentIds = (data.persons[id]?.parentIds ?? []).filter(p => data.persons[p]).slice().sort();
    if (parentIds.length) return `P:${parentIds.join(',')}`;
    return `S:${id}`;
}

/**
 * Break the whole tree into disjoint nuclear families. Focus-invariant: the set
 * of families and their membership does not depend on `focusId`; only the order
 * (focus family first) and each family's default person do.
 */
export function decomposeIntoFamilies(
    data: StromData,
    focusId: PersonId,
    _opts: DecomposeOptions = {}
): FamilyComponent[] {
    // 1. Objective partition by home key.
    const members = new Map<string, PersonId[]>();
    const keyOf = new Map<PersonId, string>();
    for (const id of Object.keys(data.persons) as PersonId[]) {
        const key = homeKeyOf(data, id);
        keyOf.set(id, key);
        (members.get(key) ?? members.set(key, []).get(key)!).push(id);
    }

    // 2. Fold placeholder-only families into the real family that owns their
    //    nearest real person, so no family is a run of unknown slots. This is
    //    focus-free (it walks the relative graph, not the vantage point): a chain
    //    of unknown ancestors folds into whichever real descendant it hangs off.
    const hasReal = (list: PersonId[]): boolean => list.some(id => isReal(data, id));
    // A stable global fallback for a placeholder island with no real relative at
    // all: the tree's senior real person's family (never the focus).
    const allReal = sortIds(data, (Object.keys(data.persons) as PersonId[]).filter(id => isReal(data, id)));
    const fallbackKey = allReal.length ? keyOf.get(allReal[0])! : keyOf.get(focusId)!;
    for (const key of [...members.keys()].sort()) {
        const list = members.get(key)!;
        if (hasReal(list)) continue;
        const targetKey = nearestRealFamilyKey(data, list, keyOf) ?? fallbackKey;
        const target = members.get(targetKey);
        if (!target || targetKey === key) continue;
        target.push(...list);
        for (const m of list) keyOf.set(m, targetKey);
        members.delete(key);
    }

    // 3. Build one family per surviving unit.
    const focusKey = keyOf.get(focusId);
    const units = [...members.entries()].map(([key, list]) => {
        const personIds = sortIds(data, list);
        const owned = new Set(personIds);
        // Named after the senior real member; the focus, if it lives here, opens the tree.
        const reals = personIds.filter(id => isReal(data, id));
        const nameAnchorId = (reals.length ? sortIds(data, reals)[0] : personIds[0]);
        const isFirst = key === focusKey;
        const defaultPersonId = isFirst ? focusId : nameAnchorId;
        // Cross-tree link: a real person just outside this family (a parent,
        // spouse or child on its edge), senior first, upward links preferred.
        const connectorId = connectorFor(data, personIds, owned);
        return { key, focusId: nameAnchorId, connectorId, personIds, defaultPersonId, nameAnchorId, isFirst };
    });

    // 4. Presentation order: the focus family first, then by senior member.
    units.sort((a, b) => {
        if (a.isFirst !== b.isFirst) return a.isFirst ? -1 : 1;
        const ba = data.persons[a.nameAnchorId]?.birthDate ?? '9999';
        const bb = data.persons[b.nameAnchorId]?.birthDate ?? '9999';
        if (ba !== bb) return ba < bb ? -1 : 1;
        return a.nameAnchorId < b.nameAnchorId ? -1 : a.nameAnchorId > b.nameAnchorId ? 1 : 0;
    });

    return units.map(({ key: _key, ...c }) => c);
}

/**
 * Family key of the nearest real person reachable from a placeholder-only unit,
 * walking the relative graph breadth-first (through other placeholders if need
 * be). Focus-free and deterministic: nearest wins, senior (birthdate→id) breaks
 * ties. Null only if no real person is reachable at all.
 */
function nearestRealFamilyKey(
    data: StromData,
    seed: PersonId[],
    keyOf: Map<PersonId, string>
): string | null {
    const seen = new Set<PersonId>(seed);
    let frontier = sortIds(data, seed);
    while (frontier.length) {
        const next: PersonId[] = [];
        for (const id of frontier) {
            for (const r of relativesOf(data, id)) {
                if (seen.has(r)) continue;
                seen.add(r);
                next.push(r);
            }
        }
        const reals = sortIds(data, next.filter(r => isReal(data, r)));
        if (reals.length) return keyOf.get(reals[0]) ?? null;
        frontier = sortIds(data, next);
    }
    return null;
}

/**
 * A real person just outside the family, used as the shared cross-tree card.
 * Preference keeps links stable and mostly upward: a member's parents, then
 * spouses, then children; senior (birthdate→id) wins ties. Null if the family
 * touches no other real person (a truly isolated unit).
 */
function connectorFor(data: StromData, personIds: PersonId[], owned: Set<PersonId>): PersonId | null {
    const outsideReal = (list: PersonId[]): PersonId[] =>
        list.filter(r => isReal(data, r) && !owned.has(r));
    const tiers: PersonId[][] = [[], [], []];
    for (const m of sortIds(data, personIds)) {
        const p = data.persons[m];
        if (!p) continue;
        tiers[0].push(...outsideReal(p.parentIds));
        tiers[1].push(...outsideReal(partnersOf(data, m)));
        tiers[2].push(...outsideReal(p.childIds));
    }
    for (const tier of tiers) {
        const uniq = [...new Set(tier)];
        if (uniq.length) return sortIds(data, uniq)[0];
    }
    return null;
}

/**
 * The persons whose data travels into a family's new tree: exactly the family it
 * owns. `extractSubtree` still pulls the missing partner of a kept couple whose
 * child is kept, so children never end up half-orphaned — but no extra anchor is
 * forced in, so the created tree, the preview and the head-count are one and the
 * same set. The `connectorId` names the neighbouring family this one marries
 * into (shown as a "connects to …" note), it is not a card in this tree.
 */
export function seedIdsFor(component: FamilyComponent): Set<PersonId> {
    return new Set<PersonId>(component.personIds);
}

/**
 * The person to lay a family's preview out from, so that EVERY member is drawn
 * (count == preview). A family reaches sideways through in-laws and half-sibs
 * that a single vantage would clip; we pick the member whose full selection
 * covers the most of the family (senior wins ties). Meant for a small,
 * self-contained family tree (the output of `extractSubtree`).
 */
export function bestRenderFocus(family: StromData): PersonId {
    const ids = Object.keys(family.persons) as PersonId[];
    if (ids.length <= 1) return ids[0];
    let best = ids[0];
    let bestReach = -1;
    for (const id of sortIds(family, ids)) {
        const reach = selectSubgraph({
            data: family,
            focusPersonId: id,
            ancestorDepth: 40,
            descendantDepth: 40,
            includeSpouseAncestors: true,
            includeParentSiblings: true,
            includeParentSiblingDescendants: true,
        }).persons.size;
        if (reach > bestReach) { bestReach = reach; best = id; }
    }
    return best;
}
