/**
 * Step 1: Select Subgraph
 *
 * Selects which persons and partnerships to include in the visible layout
 * based on focus person and depth policy.
 *
 * Rules:
 * - Focus person + their partners (always)
 * - Siblings of focus + their families
 * - Direct ancestors up to ancestorDepth
 * - Descendants down to descendantDepth
 * - Optionally: ancestors of spouse, aunts/uncles, cousins
 */

import { PersonId, PartnershipId, Person, Partnership, StromData } from '../../types.js';
import { SelectSubgraphInput, GraphSelection, DisplayPolicy } from './types.js';
import { isDiagramStandIn } from './placeholders.js';
import { marriagesInOrder } from '../../marriage-order.js';

/**
 * Select visible subgraph based on focus person and policy.
 */
export function selectSubgraph(input: SelectSubgraphInput): GraphSelection {
    const {
        data,
        focusPersonId,
        ancestorDepth,
        descendantDepth,
        includeSpouseAncestors,
        includeParentSiblings,
        includeParentSiblingDescendants
    } = input;

    const persons = new Set<PersonId>();
    const partnerships = new Set<PartnershipId>();
    const processedPartnerships = new Set<PartnershipId>();
    const depthLimit = new Set<PersonId>();
    const ancestorLimit = new Set<PersonId>();

    const focusPerson = data.persons[focusPersonId];
    if (!focusPerson) {
        return {
            persons,
            partnerships,
            focusPersonId,
            maxAncestorGen: 0,
            maxDescendantGen: 0,
            ancestorLimitPersons: ancestorLimit
        };
    }

    // Track actual depths reached
    let actualAncestorDepth = 0;
    let actualDescendantDepth = 0;

    // 1. Focus person and their partners
    persons.add(focusPersonId);
    addPartners(data, focusPersonId, persons, partnerships);
    if (descendantDepth <= 0) markWithPartners(data, focusPersonId, depthLimit);

    // 2. Siblings of focus + their partners + their descendants
    // Note: Half-siblings (sharing one parent) are included, but their OTHER parent
    // is NOT added - they won't render but their shared parent will show an indicator
    const focusSiblings = getSiblings(data, focusPersonId);
    for (const sibling of focusSiblings) {
        persons.add(sibling.id);
        addPartners(data, sibling.id, persons, partnerships);
        if (descendantDepth > 0) {
            const depth = addDescendantsRecursive(data, sibling.id, descendantDepth, persons, partnerships, depthLimit);
            actualDescendantDepth = Math.max(actualDescendantDepth, depth);
        } else {
            markWithPartners(data, sibling.id, depthLimit);
        }
    }

    // 3. Descendants of focus
    if (descendantDepth > 0) {
        const depth = addDescendantsRecursive(data, focusPersonId, descendantDepth, persons, partnerships, depthLimit);
        actualDescendantDepth = Math.max(actualDescendantDepth, depth);
    }

    // 4. Direct ancestors of focus (through partnerships - both parents as unit)
    if (ancestorDepth > 0) {
        const depth = addAncestorsThroughPartnership(
            data, focusPersonId, ancestorDepth, persons, partnerships, processedPartnerships, 0, ancestorLimit
        );
        actualAncestorDepth = Math.max(actualAncestorDepth, depth);

        // Also add ancestors of focus person's spouse(s) if requested
        if (includeSpouseAncestors) {
            for (const partnershipId of focusPerson.partnerships) {
                const partnership = data.partnerships[partnershipId];
                if (partnership) {
                    const spouseId = partnership.person1Id === focusPersonId
                        ? partnership.person2Id
                        : partnership.person1Id;
                    if (spouseId && persons.has(spouseId)) {
                        const spouseDepth = addAncestorsThroughPartnership(
                            data, spouseId, ancestorDepth, persons, partnerships, processedPartnerships, 0, ancestorLimit
                        );
                        actualAncestorDepth = Math.max(actualAncestorDepth, spouseDepth);
                    }
                }
            }
        }
    }

    // 5. Aunts/uncles (siblings of parents) if requested
    if (includeParentSiblings && ancestorDepth >= 1) {
        for (const parentId of focusPerson.parentIds) {
            const parentSiblings = getSiblings(data, parentId);
            for (const sibling of parentSiblings) {
                persons.add(sibling.id);
                addPartners(data, sibling.id, persons, partnerships);

                // Add cousins if requested
                if (includeParentSiblingDescendants) {
                    const auntUncle = data.persons[sibling.id];
                    if (auntUncle) {
                        for (const cousinId of auntUncle.childIds) {
                            // Only add if in a partnership.childIds
                            const isInPartnership = Object.values(data.partnerships).some(
                                p => p.childIds.includes(cousinId)
                            );
                            if (!isInPartnership) continue;

                            if (!persons.has(cousinId)) {
                                persons.add(cousinId);
                                addPartners(data, cousinId, persons, partnerships);

                                // Add cousin's descendants
                                if (descendantDepth > 0) {
                                    addDescendantsRecursive(data, cousinId, descendantDepth, persons, partnerships, depthLimit);
                                } else {
                                    markWithPartners(data, cousinId, depthLimit);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Collect all partnerships involving selected persons
    collectPartnerships(data, persons, partnerships);

    return {
        persons,
        partnerships,
        focusPersonId,
        maxAncestorGen: actualAncestorDepth,
        maxDescendantGen: actualDescendantDepth,
        depthLimitPersons: depthLimit,
        ancestorLimitPersons: ancestorLimit
    };
}

/**
 * Mark a person of the deepest shown generation together with their partners
 * (who stand in the same generation): their children lie beyond the depth.
 */
function markWithPartners(data: StromData, personId: PersonId, depthLimit: Set<PersonId>): void {
    depthLimit.add(personId);
    for (const partnershipId of data.persons[personId]?.partnerships ?? []) {
        const partnership = data.partnerships[partnershipId];
        if (!partnership) continue;
        depthLimit.add(partnership.person1Id === personId ? partnership.person2Id : partnership.person1Id);
    }
}

/**
 * Add all partners of a person to the visible set.
 */
function addPartners(
    data: StromData,
    personId: PersonId,
    persons: Set<PersonId>,
    partnerships: Set<PartnershipId>
): void {
    const person = data.persons[personId];
    if (!person) return;

    for (const partnershipId of person.partnerships) {
        const partnership = data.partnerships[partnershipId];
        if (partnership) {
            persons.add(partnership.person1Id);
            persons.add(partnership.person2Id);
            partnerships.add(partnershipId);
        }
    }
}

/**
 * Add descendants recursively. Returns the actual depth reached.
 */
function addDescendantsRecursive(
    data: StromData,
    personId: PersonId,
    maxDepth: number,
    persons: Set<PersonId>,
    partnerships: Set<PartnershipId>,
    depthLimit: Set<PersonId>,
    currentDepth: number = 0
): number {
    if (maxDepth <= 0) return currentDepth;

    const person = data.persons[personId];
    if (!person) return currentDepth;

    let maxReached = currentDepth;

    for (const childId of person.childIds) {
        if (!persons.has(childId)) {
            // Only add if child is in at least one partnership.childIds
            const isInPartnership = Object.values(data.partnerships).some(
                p => p.childIds.includes(childId)
            );
            if (!isInPartnership) continue;

            persons.add(childId);
            addPartners(data, childId, persons, partnerships);
            if (maxDepth === 1) markWithPartners(data, childId, depthLimit);

            const depth = addDescendantsRecursive(
                data, childId, maxDepth - 1, persons, partnerships, depthLimit, currentDepth + 1
            );
            maxReached = Math.max(maxReached, depth);
        }
    }

    return maxReached;
}

/**
 * Find parent partnership that contains this child.
 */
function findParentPartnership(data: StromData, childId: PersonId): Partnership | null {
    const child = data.persons[childId];
    if (!child) return null;

    for (const partnershipId in data.partnerships) {
        const p = data.partnerships[partnershipId as PartnershipId];
        if (p.childIds.includes(childId)) {
            if (child.parentIds.includes(p.person1Id) || child.parentIds.includes(p.person2Id)) {
                return p;
            }
        }
    }
    return null;
}

/**
 * Add ancestors through partnerships (both parents as a unit).
 * Returns the actual depth reached. `ancestorLimit` collects the persons
 * reached whose parents lie beyond the depth (GraphSelection.ancestorLimitPersons).
 */
function addAncestorsThroughPartnership(
    data: StromData,
    childId: PersonId,
    maxDepth: number,
    persons: Set<PersonId>,
    partnerships: Set<PartnershipId>,
    processedPartnerships: Set<PartnershipId>,
    currentDepth: number = 0,
    ancestorLimit?: Set<PersonId>
): number {
    if (maxDepth <= 0) {
        if ((data.persons[childId]?.parentIds.length ?? 0) > 0) ancestorLimit?.add(childId);
        return currentDepth;
    }

    const child = data.persons[childId];
    if (!child || child.parentIds.length === 0) return currentDepth;

    const parentPartnership = findParentPartnership(data, childId);

    if (parentPartnership && !processedPartnerships.has(parentPartnership.id)) {
        processedPartnerships.add(parentPartnership.id);
        partnerships.add(parentPartnership.id);

        // Add BOTH partners
        persons.add(parentPartnership.person1Id);
        persons.add(parentPartnership.person2Id);

        // Continue recursively for each parent
        const depth1 = addAncestorsThroughPartnership(
            data, parentPartnership.person1Id, maxDepth - 1,
            persons, partnerships, processedPartnerships, currentDepth + 1, ancestorLimit
        );
        const depth2 = addAncestorsThroughPartnership(
            data, parentPartnership.person2Id, maxDepth - 1,
            persons, partnerships, processedPartnerships, currentDepth + 1, ancestorLimit
        );
        return Math.max(depth1, depth2);
    } else if (!parentPartnership) {
        // Fallback: add individual parents AND their spouses
        let maxReached = currentDepth;
        for (const parentId of child.parentIds) {
            if (!persons.has(parentId)) {
                persons.add(parentId);
                // Also add this parent's partners (spouse)
                addPartners(data, parentId, persons, partnerships);
                const depth = addAncestorsThroughPartnership(
                    data, parentId, maxDepth - 1,
                    persons, partnerships, processedPartnerships, currentDepth + 1, ancestorLimit
                );
                maxReached = Math.max(maxReached, depth);
            }
        }
        return maxReached;
    }

    return currentDepth;
}

/**
 * Get siblings of a person (shared at least one parent).
 */
function getSiblings(data: StromData, personId: PersonId): Person[] {
    const person = data.persons[personId];
    if (!person) return [];

    const siblingIds = new Set<PersonId>();

    for (const parentId of person.parentIds) {
        const parent = data.persons[parentId];
        if (parent) {
            for (const childId of parent.childIds) {
                if (childId !== personId) {
                    // Only include if in at least one partnership.childIds
                    const isInPartnership = Object.values(data.partnerships).some(
                        p => p.childIds.includes(childId)
                    );
                    if (isInPartnership) {
                        siblingIds.add(childId);
                    }
                }
            }
        }
    }

    return Array.from(siblingIds)
        .map(id => data.persons[id])
        .filter((p): p is Person => p !== undefined);
}

/**
 * Collect all partnerships between selected persons.
 * Ensures we don't have dangling partnerships.
 */
function collectPartnerships(
    data: StromData,
    persons: Set<PersonId>,
    partnerships: Set<PartnershipId>
): void {
    for (const partnershipId in data.partnerships) {
        const partnership = data.partnerships[partnershipId as PartnershipId];
        // Include partnership only if BOTH partners are in selection
        // AND they have at least one common child in selection
        if (persons.has(partnership.person1Id) && persons.has(partnership.person2Id)) {
            const hasChildInSelection = partnership.childIds.some(childId => persons.has(childId));
            if (hasChildInSelection || partnerships.has(partnershipId as PartnershipId)) {
                partnerships.add(partnershipId as PartnershipId);
            }
        }
    }
}

/**
 * The children a "show children in place" brings into the view: the
 * children of the person's unions, union by union. A parent link without a
 * union (a child whose only parent is a "?" stand-in, single-parent.ts) is
 * never drawn, so its child is not among them. The card's children tab
 * promises only these (hiddenChildIds), the layout shows exactly these
 * (expandChildrenInSelection).
 */
export function childIdsShownInPlace(data: StromData, personId: PersonId): PersonId[] {
    const out: PersonId[] = [];
    for (const partnershipId of data.persons[personId]?.partnerships ?? []) {
        for (const childId of data.partnerships[partnershipId]?.childIds ?? []) {
            if (data.persons[childId] && !out.includes(childId)) out.push(childId);
        }
    }
    return out;
}

/**
 * The other partners a "▸ ∞" shows in place: the partner of each of the
 * person's unions without children (a union with children comes with them,
 * by the children tab), in data order, each once. Any partner can be drawn
 * so: an empty "?" stand-in is hidden only with children (isDiagramStandIn).
 */
export function partnerIdsShownInPlace(data: StromData, personId: PersonId): PersonId[] {
    const out: PersonId[] = [];
    for (const partnershipId of data.persons[personId]?.partnerships ?? []) {
        const partnership = data.partnerships[partnershipId];
        if (!partnership || partnership.childIds.length > 0) continue;
        const partnerId = partnership.person1Id === personId ? partnership.person2Id : partnership.person1Id;
        if (partnerId !== personId && data.persons[partnerId] && !out.includes(partnerId)) out.push(partnerId);
    }
    return out;
}

/**
 * Show the other partners of the given persons in place (the "▸ ∞" pill,
 * PipelineInput.showPartnersOf): each partner of partnerIdsShownInPlace not
 * in the selection joins it with the partnership (without the partner's
 * parents, other partners or children; their own tabs lead on). A partner
 * the selection holds already (drawn elsewhere) is left alone. Persons not
 * in the selection are skipped. Returns the persons that now stand in more
 * than one union of the selection (a partner chain).
 */
export function showPartnersInSelection(
    data: StromData,
    selection: GraphSelection,
    personIds: readonly PersonId[]
): PersonId[] {
    const chained: PersonId[] = [];
    const done = new Set<PersonId>();
    // A partner shown here can be listed too (nested): until nobody new comes in
    for (let grew = true; grew;) {
        grew = false;
        for (const personId of personIds) {
            if (done.has(personId) || !selection.persons.has(personId)) continue;
            done.add(personId);
            grew = true;
            addPartnersShown(data, selection, personId);
        }
    }
    for (const personId of done) {
        const person = data.persons[personId];
        if (!person) continue;
        const unions = person.partnerships.filter(pid => {
            const u = data.partnerships[pid];
            return !!u && selection.partnerships.has(pid) && selection.persons.has(u.person1Id) && selection.persons.has(u.person2Id);
        });
        if (unions.length > 1) chained.push(personId);
    }
    return chained;
}

/** One person's step of showPartnersInSelection: the partners of unions without children not in the selection join it. */
function addPartnersShown(data: StromData, selection: GraphSelection, personId: PersonId): void {
    const person = data.persons[personId];
    if (!person) return;
    for (const partnershipId of person.partnerships) {
        const partnership = data.partnerships[partnershipId];
        if (!partnership || partnership.childIds.length > 0) continue;
        const partnerId = partnership.person1Id === personId ? partnership.person2Id : partnership.person1Id;
        if (partnerId === personId || !data.persons[partnerId] || selection.persons.has(partnerId)) continue;
        selection.persons.add(partnerId);
        selection.partnerships.add(partnershipId);
    }
}

/**
 * Show the parents of the given persons in place (the card's "▸ parents" on
 * an ancestor at the edge of the depth, PipelineInput.extraDepthFor): each
 * listed person of the line whose parents lie beyond the ancestor depth
 * (ancestorLimitPersons, no parent in the selection) gets one generation
 * more above that branch alone: the parents' couple (or, without one, each
 * parent with their partners), never their ancestors. The parents stand at
 * the new edge in turn, so a later person of the list can be one of them
 * (the parents' own "▸ parents", nested). Others are skipped.
 *
 * Only the parents: their other children (the person's siblings) and
 * everything hanging on those stay out of the view, at every depth. At
 * depth 1 the selection holds them already (the aunts and uncles with their
 * families, includeParentSiblings), not drawn until the grandparents are;
 * they leave it here, so the parents alone come. Another input brings them
 * (the parents' children shown in place, PipelineInput.expandChildrenOf:
 * the person's "▸ siblings" or a parent's "▸ children"). Anyone the view
 * draws without the extension stays (`drawnWithout`, the drawn persons of
 * the same input without extraDepthFor; asked only when one of those
 * siblings is in the selection).
 * Returns the persons extended, in the order of the list as reached.
 */
export function extendAncestorDepth(
    data: StromData,
    selection: GraphSelection,
    personIds: readonly PersonId[],
    drawnWithout: () => ReadonlySet<PersonId>
): PersonId[] {
    const limit = selection.ancestorLimitPersons ?? (selection.ancestorLimitPersons = new Set());
    const processed = new Set(selection.partnerships);
    const before = new Set(selection.persons);
    const done = new Set<PersonId>();
    for (let grew = true; grew;) {
        grew = false;
        for (const personId of personIds) {
            if (done.has(personId) || !limit.has(personId) || !selection.persons.has(personId)) continue;
            if ((data.persons[personId]?.parentIds ?? []).some(id => selection.persons.has(id))) continue;
            done.add(personId);
            limit.delete(personId);
            addAncestorsThroughPartnership(data, personId, 1, selection.persons, selection.partnerships, processed, 0, limit);
            grew = true;
        }
    }
    if (done.size > 0) {
        const added = new Set([...selection.persons].filter(id => !before.has(id)));
        leaveOutOtherChildrenOf(data, selection, added, done, drawnWithout);
        collectPartnerships(data, selection.persons, selection.partnerships);
    }
    return [...done];
}

/**
 * The parents shown beyond the depth come alone (extendAncestorDepth): the
 * line from each of `parents` down to a child that is not one of `line`
 * (the persons whose parents they are shown for) is cut, and everyone
 * reached only through such a cut goes — the child, their partners, their
 * descendants and whoever hangs on those — unless the view without the
 * extension draws them (`drawnWithout`: a pedigree collapse, a cousin
 * married into the view); those stay and stop the walk. `drawnWithout` is
 * asked only when such a child is in the selection (at depth 1: the aunts
 * and uncles).
 */
function leaveOutOtherChildrenOf(
    data: StromData,
    selection: GraphSelection,
    parents: ReadonlySet<PersonId>,
    line: ReadonlySet<PersonId>,
    drawnWithout: () => ReadonlySet<PersonId>
): void {
    const isCut = (childId: PersonId, parentId: PersonId): boolean =>
        parents.has(parentId) && !line.has(childId) && (data.persons[childId]?.parentIds ?? []).includes(parentId);
    const cutChildren: PersonId[] = [];
    for (const parentId of parents) {
        for (const childId of data.persons[parentId]?.childIds ?? []) {
            if (selection.persons.has(childId) && isCut(childId, parentId) && !cutChildren.includes(childId)) cutChildren.push(childId);
        }
    }
    if (cutChildren.length === 0) return;
    const drawn = drawnWithout();
    const stays = (id: PersonId): boolean => drawn.has(id) || parents.has(id) || line.has(id) || id === selection.focusPersonId;
    const gone = new Set<PersonId>();
    const stack = cutChildren.filter(id => !stays(id));
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (gone.has(id)) continue;
        gone.add(id);
        const person = data.persons[id];
        if (!person) continue;
        const next: PersonId[] = [];
        for (const parentId of person.parentIds) if (!isCut(id, parentId)) next.push(parentId);
        for (const childId of person.childIds) if (!isCut(childId, id)) next.push(childId);
        for (const partnershipId of person.partnerships) {
            const partnership = data.partnerships[partnershipId];
            if (partnership) next.push(partnership.person1Id === id ? partnership.person2Id : partnership.person1Id);
        }
        for (const n of next) if (selection.persons.has(n) && !gone.has(n) && !stays(n)) stack.push(n);
    }
    for (const id of gone) {
        selection.persons.delete(id);
        selection.depthLimitPersons?.delete(id);
    }
    for (const partnershipId of [...selection.partnerships]) {
        const partnership = data.partnerships[partnershipId];
        if (partnership && (gone.has(partnership.person1Id) || gone.has(partnership.person2Id))) {
            selection.partnerships.delete(partnershipId);
        }
    }
}

/**
 * Show the children of the given persons in place (the card's "children"
 * tab): for every union of a person already in the selection, the partner,
 * the partnership and the union's children (childIdsShownInPlace) join it.
 * A child the step brings comes with their partners, as the plain depth
 * draws a relative: with every partner drawn (`allPartners`, the expanded
 * mode) the partner of each of the child's unions joins with the
 * partnership; the standard mode draws one partner, so only one joins: the
 * partner of the union whose children stand in the view (after this step),
 * else the first union in the marriage order (marriagesInOrder, as the
 * marriage-order pill numbers them); the other partners stay behind the
 * card's own tabs ("▸ ∞", "▸ children"). Never a partner the selection holds
 * already (drawn elsewhere: the union stays undrawn, as before) or an empty
 * "?" stand-in (drawn only with the union's children). Never the children's
 * children (the child's own tab leads on). A child the selection held
 * already keeps what it had. A listed person the step itself brings (a
 * shown child's partner, a child listed before its parent: nested clicks)
 * is reached in a further pass; persons the selection never holds are
 * skipped.
 */
export function expandChildrenInSelection(
    data: StromData,
    selection: GraphSelection,
    personIds: readonly PersonId[],
    allPartners = true
): void {
    const before = new Set(selection.persons);
    const done = new Set<PersonId>();
    const partnered = new Set<PersonId>();
    // A person of the list the step itself brings into the selection (a
    // shown child's partner, whose own "▸ children" is a nested click, or a
    // child of a person later in the list) is reached in a further pass
    for (let grew = true; grew;) {
        grew = false;
        const brought: PersonId[] = [];
        for (let reached = true; reached;) {
            reached = false;
            for (const personId of personIds) {
                const person = data.persons[personId];
                if (done.has(personId) || !person || !selection.persons.has(personId)) continue;
                done.add(personId);
                reached = true;
                for (const partnershipId of person.partnerships) {
                    const partnership = data.partnerships[partnershipId];
                    if (!partnership || partnership.childIds.length === 0) continue;
                    selection.persons.add(partnership.person1Id);
                    selection.persons.add(partnership.person2Id);
                    selection.partnerships.add(partnershipId);
                }
                for (const childId of childIdsShownInPlace(data, personId)) {
                    if (!before.has(childId) && !partnered.has(childId) && !brought.includes(childId)) brought.push(childId);
                    selection.persons.add(childId);
                }
                // The person's children now stand in the view: no longer the deepest generation
                selection.depthLimitPersons?.delete(personId);
            }
        }
        for (const childId of brought) partnered.add(childId);
        const size = selection.persons.size;
        bringPartnersOfShownChildren(data, selection, brought, before, allPartners);
        grew = selection.persons.size > size && personIds.some(id => !done.has(id) && selection.persons.has(id));
    }
}

/**
 * The partners a child brought by children shown in place comes with
 * (expandChildrenInSelection): every partner (`allPartners`) or the one
 * the standard mode draws; never one the selection held before the step
 * (`before`) or an empty "?" stand-in.
 */
function bringPartnersOfShownChildren(
    data: StromData,
    selection: GraphSelection,
    brought: readonly PersonId[],
    before: ReadonlySet<PersonId>,
    allPartners: boolean
): void {
    for (const childId of brought) {
        const unions: Array<{ partnershipId: PartnershipId; partnerId: PersonId }> = [];
        for (const partnershipId of data.persons[childId]?.partnerships ?? []) {
            const partnership = data.partnerships[partnershipId];
            if (!partnership) continue;
            const partnerId = partnership.person1Id === childId ? partnership.person2Id : partnership.person1Id;
            // An empty "?" stand-in stands only for the union's children (isDiagramStandIn)
            if (partnerId === childId || !data.persons[partnerId] || before.has(partnerId) || isDiagramStandIn(data, partnerId)) continue;
            unions.push({ partnershipId, partnerId });
        }
        for (const { partnershipId, partnerId } of allPartners ? unions : onePartnerUnion(data, selection, childId, unions)) {
            selection.persons.add(partnerId);
            selection.partnerships.add(partnershipId);
        }
    }
}

/**
 * The one union of a child shown in place whose partner the standard mode
 * brings (expandChildrenInSelection): the first in the marriage order whose
 * children stand in the view, else the first in the marriage order.
 */
function onePartnerUnion<T extends { partnershipId: PartnershipId }>(
    data: StromData,
    selection: GraphSelection,
    childId: PersonId,
    unions: readonly T[]
): T[] {
    if (unions.length <= 1) return [...unions];
    const order = marriagesInOrder(data, childId);
    const ranked = [...unions].sort((a, b) => order.indexOf(a.partnershipId) - order.indexOf(b.partnershipId));
    const withChildrenInView = ranked.find(u =>
        (data.partnerships[u.partnershipId]?.childIds ?? []).some(id => selection.persons.has(id)));
    return [withChildrenInView ?? ranked[0]];
}

/**
 * Leave the ancestors of the given persons out of the view for now
 * (PipelineInput.foldAncestorsOf, to make room for children shown in place):
 * the line from each person up to their parents is cut and everyone the view
 * then no longer reaches from the focus goes — the parents, their ancestors,
 * their other children and those children's families.
 *
 * A person is drawn once, so an ancestor the view also reaches another way
 * stays (a pedigree collapse: the same couple above the other half of the
 * pedigree), with everything hanging on them; and when one of the person's
 * parents stays that way, the person keeps the line to their parents. The
 * view stays one connected tree around the focus: nobody who stays loses a
 * partner or a child, only the cut lines go.
 */
export function foldAncestorsInSelection(
    data: StromData,
    selection: GraphSelection,
    personIds: readonly PersonId[],
    focusPersonId: PersonId
): void {
    const folded = new Set(personIds.filter(id => selection.persons.has(id) && id !== focusPersonId));
    if (folded.size === 0) return;
    const isCut = (childId: PersonId, parentId: PersonId): boolean =>
        folded.has(childId) && (data.persons[childId]?.parentIds ?? []).includes(parentId);

    // Who stays connected to whom inside the selection: parent and child,
    // partner and partner (as buildLayoutModel links them)
    // The focus's own line: the focus and their ancestors in the selection
    const ownLine = new Set<PersonId>();
    for (const stack = [selection.focusPersonId]; stack.length > 0;) {
        const id = stack.pop()!;
        if (ownLine.has(id) || !selection.persons.has(id)) continue;
        ownLine.add(id);
        stack.push(...(data.persons[id]?.parentIds ?? []));
    }
    const neighbours = (id: PersonId): PersonId[] => {
        const person = data.persons[id];
        if (!person) return [];
        const out: PersonId[] = [];
        if (ownLine.has(id)) {
            for (const parentId of person.parentIds) {
                if (selection.persons.has(parentId) && !isCut(id, parentId)) out.push(parentId);
            }
        }
        for (const childId of person.childIds) {
            if (selection.persons.has(childId) && !isCut(childId, id)) out.push(childId);
        }
        for (const partnershipId of person.partnerships) {
            const partnership = data.partnerships[partnershipId];
            if (!partnership) continue;
            const other = partnership.person1Id === id ? partnership.person2Id : partnership.person1Id;
            if (selection.persons.has(other)) out.push(other);
        }
        return out;
    };
    const reach = (start: PersonId, into: Set<PersonId>): void => {
        const stack = [start];
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (into.has(id)) continue;
            into.add(id);
            for (const next of neighbours(id)) if (!into.has(next)) stack.push(next);
        }
    };

    const kept = new Set<PersonId>();
    reach(focusPersonId, kept);
    const gone = new Set<PersonId>();
    for (const id of folded) {
        for (const parentId of data.persons[id]?.parentIds ?? []) {
            if (selection.persons.has(parentId) && !kept.has(parentId)) reach(parentId, gone);
        }
    }
    if (gone.size === 0) return;
    for (const id of gone) {
        selection.persons.delete(id);
        selection.depthLimitPersons?.delete(id);
    }
    for (const partnershipId of [...selection.partnerships]) {
        const partnership = data.partnerships[partnershipId];
        if (partnership && (gone.has(partnership.person1Id) || gone.has(partnership.person2Id))) {
            selection.partnerships.delete(partnershipId);
        }
    }
}

/**
 * Expand selection for expanded persons (display policy).
 * Adds missing partners, partnerships, and children for persons
 * whose all partnerships should be shown inline.
 */
export function expandSelectionForDisplay(
    data: StromData,
    selection: GraphSelection,
    displayPolicy: DisplayPolicy
): void {
    if (displayPolicy.mode !== 'expanded') return;

    for (const personId of displayPolicy.expandedPersonIds ?? []) {
        const person = data.persons[personId];
        if (!person || !selection.persons.has(personId)) continue;

        for (const partnershipId of person.partnerships) {
            const partnership = data.partnerships[partnershipId];
            if (!partnership) continue;

            // Add both partners to selection
            selection.persons.add(partnership.person1Id);
            selection.persons.add(partnership.person2Id);
            selection.partnerships.add(partnershipId);

            // Children of the deepest shown generation lie beyond the depth (T19).
            if (selection.depthLimitPersons?.has(personId)) continue;

            // Add children from this partnership
            for (const childId of partnership.childIds) {
                selection.persons.add(childId);
                // Also add the child's partners
                addPartners(data, childId, selection.persons, selection.partnerships);
            }
        }
    }

    // Appendage expansion (deep ancestors): inline the extra spouse card
    // only — partner + partnership, WITHOUT the union's children. Pulling
    // the children in would attach whole new branches to the ancestor row.
    for (const personId of displayPolicy.appendagePersonIds ?? []) {
        const person = data.persons[personId];
        if (!person || !selection.persons.has(personId)) continue;

        for (const partnershipId of person.partnerships) {
            const partnership = data.partnerships[partnershipId];
            if (!partnership) continue;
            selection.persons.add(partnership.person1Id);
            selection.persons.add(partnership.person2Id);
            selection.partnerships.add(partnershipId);
        }
    }
}
