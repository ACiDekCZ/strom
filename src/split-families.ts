/**
 * Splitting the whole tree into clean families, from the focused person's point
 * of view (N4).
 *
 * Unlike src/components.ts — which only separates families that NOTHING connects
 * — this walks a CONNECTED tree the way a reader does. The first family is
 * exactly what the focused person currently sees (the family view). Every person
 * on its edge who still has relatives outside that view (the "◂ parents /
 * family ▸" pills) becomes the seed of the next family, and so on until the whole
 * tree is covered. Each person lands in exactly one family — the first that
 * reaches them (first claim), so a cousin marriage does not duplicate anybody.
 *
 * The boundary person (connector) stays a member of its own family, but it is
 * ALSO added as a single anchor card when the neighbouring family's tree is
 * created — that shared person is what lets the existing cross-tree badge link
 * the two families together. The decomposition itself keeps the families
 * strictly disjoint; the anchor is added later, at tree-creation time.
 */

import { PersonId, StromData } from './types.js';
import { selectSubgraph } from './layout/pipeline/1-select-subgraph.js';

/** One proposed family: a disjoint slice of the tree with an entry person. */
export interface FamilyComponent {
    /** The person this family was grown from (its focus). */
    focusId: PersonId;
    /**
     * The boundary person that seeded this family, or null for the first one.
     * It belongs to the PARENT family; the tree-creation step adds it back as an
     * anchor so the cross-tree link can form. Never counted in `personIds`.
     */
    connectorId: PersonId | null;
    /** Persons this family owns — disjoint from every other family, sorted. */
    personIds: PersonId[];
    /** Person the new tree opens on (a member of personIds, or the connector). */
    defaultPersonId: PersonId;
    /**
     * The real person the family is named after — never a placeholder. For an
     * ancestral/descendant branch this is the connector (the person you reached
     * the family through); for a spouse/sibling branch it is the family's own
     * senior member, so a second marriage does not borrow its in-law's name.
     */
    nameAnchorId: PersonId;
    /** The very first family (the focused person's current view). */
    isFirst: boolean;
}

export interface DecomposeOptions {
    ancestorDepth: number;
    descendantDepth: number;
    includeAuntsUncles: boolean;
    includeCousins: boolean;
    /**
     * WYSIWYG override for the FIRST family: the persons the renderer is showing
     * right now. When omitted (unit tests, headless), the first family is
     * computed the same way as every other one.
     */
    firstViewIds?: Set<PersonId>;
}

/** Partners of a person across all their unions. */
function partnersOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const out: PersonId[] = [];
    for (const uid of p.partnerships) {
        const u = data.partnerships[uid];
        if (!u) continue;
        out.push(u.person1Id === id ? u.person2Id : u.person1Id);
    }
    return out;
}

/** Siblings of a person (sharing at least one parent). */
function siblingsOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    const out = new Set<PersonId>();
    for (const parentId of p.parentIds) {
        const parent = data.persons[parentId];
        if (!parent) continue;
        for (const childId of parent.childIds) {
            if (childId !== id) out.add(childId);
        }
    }
    return [...out];
}

/** Every first-degree relative of a person that exists in the data. */
function relativesOf(data: StromData, id: PersonId): PersonId[] {
    const p = data.persons[id];
    if (!p) return [];
    return [...p.parentIds, ...p.childIds, ...siblingsOf(data, id), ...partnersOf(data, id)]
        .filter(r => data.persons[r]);
}

/**
 * A person is on the family's boundary when a relative of theirs is not in the
 * shown set — the exact condition behind the "◂ parents / family ▸" pills.
 */
function isBoundary(data: StromData, id: PersonId, view: Set<PersonId>): boolean {
    return relativesOf(data, id).some(r => !view.has(r));
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

/**
 * The persons the family view selects around a focus — the same step-1 pipeline
 * selection that the renderer uses. Depths are clamped to at least one in each
 * direction so the walk can always climb and descend (a descendants-only first
 * view would otherwise never reach the ancestors and coverage would be partial).
 */
function viewOf(data: StromData, focus: PersonId, opts: DecomposeOptions): Set<PersonId> {
    return selectSubgraph({
        data,
        focusPersonId: focus,
        ancestorDepth: Math.max(1, opts.ancestorDepth),
        descendantDepth: Math.max(1, opts.descendantDepth),
        includeSpouseAncestors: false,
        includeParentSiblings: opts.includeAuntsUncles,
        includeParentSiblingDescendants: opts.includeCousins,
    }).persons;
}

/** Walk everyone connected to `start` among a set of still-uncovered persons. */
function walkIsland(data: StromData, start: PersonId, pool: Set<PersonId>): PersonId[] {
    const group: PersonId[] = [];
    const queue: PersonId[] = [start];
    const seen = new Set<PersonId>([start]);
    while (queue.length) {
        const id = queue.pop()!;
        group.push(id);
        for (const r of relativesOf(data, id)) {
            if (pool.has(r) && !seen.has(r)) {
                seen.add(r);
                queue.push(r);
            }
        }
    }
    return group;
}

/**
 * Break the whole tree into disjoint families from `rootFocusId`.
 *
 * The result always covers every person exactly once. The first family is the
 * focused person's current view; the rest are discovered by following boundary
 * persons outward. Any persons left unreachable (genuinely separate families in
 * the same file) are appended as their own islands so coverage stays total.
 */
export function decomposeIntoFamilies(
    data: StromData,
    rootFocusId: PersonId,
    opts: DecomposeOptions
): FamilyComponent[] {
    const covered = new Set<PersonId>();
    const components: FamilyComponent[] = [];
    const enqueued = new Set<PersonId>([rootFocusId]);
    const queue: { focus: PersonId; connector: PersonId | null }[] = [
        { focus: rootFocusId, connector: null },
    ];

    while (queue.length > 0) {
        const { focus, connector } = queue.shift()!;
        const isFirst = components.length === 0;
        const view = isFirst && opts.firstViewIds ? opts.firstViewIds : viewOf(data, focus, opts);

        const claimed = sortIds(
            data,
            [...view].filter(id => data.persons[id] && !covered.has(id))
        );
        // A boundary can lead only into persons an earlier family already took.
        if (!isFirst && claimed.length === 0) continue;

        for (const id of claimed) covered.add(id);

        components.push({
            focusId: focus,
            connectorId: connector,
            personIds: claimed,
            // The connector is not in `claimed` (an earlier family owns it); it is
            // added as an anchor at tree-creation time, so it is a valid default.
            defaultPersonId: isFirst ? rootFocusId : (connector as PersonId),
            nameAnchorId: isFirst ? rootFocusId : (connector as PersonId), // finalised below
            isFirst,
        });

        for (const b of sortIds(data, claimed.filter(id => isBoundary(data, id, view)))) {
            if (!enqueued.has(b)) {
                enqueued.add(b);
                queue.push({ focus: b, connector: b });
            }
        }
    }

    // Safety net: anything the walk could not reach (separate families sharing
    // the file) becomes its own island, so the split always covers 100%.
    const pool = new Set<PersonId>(
        (Object.keys(data.persons) as PersonId[]).filter(id => !covered.has(id))
    );
    for (const start of sortIds(data, [...pool])) {
        if (covered.has(start)) continue;
        const island = sortIds(data, walkIsland(data, start, pool));
        for (const id of island) covered.add(id);
        components.push({
            focusId: island[0],
            connectorId: null,
            personIds: island,
            defaultPersonId: island[0],
            nameAnchorId: island[0], // finalised below
            isFirst: false,
        });
    }

    return finaliseComponents(data, components);
}

/** A person that carries a real identity (not a GEDCOM placeholder slot). */
function isReal(data: StromData, id: PersonId): boolean {
    const p = data.persons[id];
    return !!p && !p.isPlaceholder;
}

/** The family's own senior real member (birthdate→id), or null if it has none. */
function firstRealOwned(data: StromData, c: FamilyComponent): PersonId | null {
    const reals = c.personIds.filter(id => isReal(data, id));
    return reals.length ? sortIds(data, reals)[0] : null;
}

/**
 * Fold placeholder-only families away and give every surviving family a real
 * name anchor and a sensible default person.
 *
 * A family with no real member of its own is not a family a reader would
 * recognise — it is a run of GEDCOM placeholder slots (unknown spouses,
 * unnamed children) that hangs off one real person. Proposing it as a separate
 * tree shows an empty box. Instead its persons are folded into the real family
 * that reached them (the one owning its connector), so the split still covers
 * everyone exactly once but never offers an empty family.
 */
function finaliseComponents(data: StromData, components: FamilyComponent[]): FamilyComponent[] {
    const hasReal = (c: FamilyComponent): boolean => c.personIds.some(id => isReal(data, id));

    const ownerOf = new Map<PersonId, number>();
    components.forEach((c, i) => c.personIds.forEach(id => ownerOf.set(id, i)));

    // The surviving real family a placeholder-only component folds into: follow
    // its connector to the owning family, and on up until a real family. The
    // connector always lives in an EARLIER family, so this terminates; the first
    // family (the focus view) is the guaranteed real fallback.
    const target = new Map<number, number>();
    const targetFor = (i: number): number => {
        if (target.has(i)) return target.get(i)!;
        target.set(i, 0); // guard against a pathological cycle
        const c = components[i];
        let t = 0;
        if (c.connectorId != null) {
            const owner = ownerOf.get(c.connectorId);
            if (owner != null && owner !== i) t = hasReal(components[owner]) ? owner : targetFor(owner);
        }
        target.set(i, t);
        return t;
    };

    const foldedInto = new Map<number, PersonId[]>();
    components.forEach((c, i) => {
        if (hasReal(c)) return;
        const t = targetFor(i);
        foldedInto.set(t, [...(foldedInto.get(t) ?? []), ...c.personIds]);
    });

    const result: FamilyComponent[] = [];
    components.forEach((c, i) => {
        if (!hasReal(c)) return; // folded away above
        const extra = foldedInto.get(i);
        const personIds = extra ? sortIds(data, [...c.personIds, ...extra]) : c.personIds;
        const owned = new Set(personIds);

        // Name anchor: the connector when the family is that connector's own
        // blood line (its parents or children are here); otherwise the family's
        // senior member, so a second-marriage branch keeps its own name.
        let nameAnchorId: PersonId;
        if (c.isFirst) {
            nameAnchorId = c.focusId;
        } else {
            const connector = c.connectorId != null ? data.persons[c.connectorId] : undefined;
            const bloodLine = !!connector && !connector.isPlaceholder
                && [...connector.parentIds, ...connector.childIds].some(id => owned.has(id));
            nameAnchorId = bloodLine
                ? (c.connectorId as PersonId)
                : (firstRealOwned(data, { ...c, personIds }) ?? c.focusId);
        }

        // Open on the shared connector card (the visible cross-tree link) when it
        // is a real person; otherwise open on the family's own name anchor.
        const defaultPersonId = (!c.isFirst && c.connectorId != null && isReal(data, c.connectorId))
            ? c.connectorId
            : nameAnchorId;

        result.push({ ...c, personIds, nameAnchorId, defaultPersonId });
    });

    return result;
}

/**
 * The persons whose data actually travels into a family's new tree: the family
 * itself plus its connector anchor (if any). The connector is the single shared
 * card that lets the cross-tree badge link the family back to its neighbour.
 */
export function seedIdsFor(component: FamilyComponent): Set<PersonId> {
    const ids = new Set<PersonId>(component.personIds);
    if (component.connectorId) ids.add(component.connectorId);
    return ids;
}
