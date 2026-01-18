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
import { SelectSubgraphInput, GraphSelection } from './types.js';

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

    const focusPerson = data.persons[focusPersonId];
    if (!focusPerson) {
        return {
            persons,
            partnerships,
            focusPersonId,
            maxAncestorGen: 0,
            maxDescendantGen: 0
        };
    }

    // Track actual depths reached
    let actualAncestorDepth = 0;
    let actualDescendantDepth = 0;

    // 1. Focus person and their partners
    persons.add(focusPersonId);
    addPartners(data, focusPersonId, persons, partnerships);

    // 2. Siblings of focus + their partners + their descendants
    // Note: Half-siblings (sharing one parent) are included, but their OTHER parent
    // is NOT added - they won't render but their shared parent will show an indicator
    const focusSiblings = getSiblings(data, focusPersonId);
    for (const sibling of focusSiblings) {
        persons.add(sibling.id);
        addPartners(data, sibling.id, persons, partnerships);
        if (descendantDepth > 0) {
            const depth = addDescendantsRecursive(data, sibling.id, descendantDepth, persons, partnerships);
            actualDescendantDepth = Math.max(actualDescendantDepth, depth);
        }
    }

    // 3. Descendants of focus
    if (descendantDepth > 0) {
        const depth = addDescendantsRecursive(data, focusPersonId, descendantDepth, persons, partnerships);
        actualDescendantDepth = Math.max(actualDescendantDepth, depth);
    }

    // 4. Direct ancestors of focus (through partnerships - both parents as unit)
    if (ancestorDepth > 0) {
        const depth = addAncestorsThroughPartnership(
            data, focusPersonId, ancestorDepth, persons, partnerships, processedPartnerships
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
                            data, spouseId, ancestorDepth, persons, partnerships, processedPartnerships
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
                                    addDescendantsRecursive(data, cousinId, descendantDepth, persons, partnerships);
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
        maxDescendantGen: actualDescendantDepth
    };
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

            const depth = addDescendantsRecursive(
                data, childId, maxDepth - 1, persons, partnerships, currentDepth + 1
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
 * Returns the actual depth reached.
 */
function addAncestorsThroughPartnership(
    data: StromData,
    childId: PersonId,
    maxDepth: number,
    persons: Set<PersonId>,
    partnerships: Set<PartnershipId>,
    processedPartnerships: Set<PartnershipId>,
    currentDepth: number = 0
): number {
    if (maxDepth <= 0) return currentDepth;

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
            persons, partnerships, processedPartnerships, currentDepth + 1
        );
        const depth2 = addAncestorsThroughPartnership(
            data, parentPartnership.person2Id, maxDepth - 1,
            persons, partnerships, processedPartnerships, currentDepth + 1
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
                    persons, partnerships, processedPartnerships, currentDepth + 1
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
