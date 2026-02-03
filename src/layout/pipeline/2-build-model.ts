/**
 * Step 2: Build Layout Model
 *
 * Converts the selected subgraph into a LayoutModel with:
 * - PersonNodes: Individual persons
 * - UnionNodes: Atomic couples (never split!)
 * - ParentChildEdges: Parent-child relationships
 *
 * Key principle: UnionNode is the ATOMIC UNIT for layout.
 * Partners are ordered: male left, otherwise alphabetically by ID.
 */

import { PersonId, StromData } from '../../types.js';
import {
    BuildModelInput,
    LayoutModel,
    PersonNode,
    UnionNode,
    ParentChildEdge,
    UnionId,
    toUnionId,
    GenerationalModel
} from './types.js';

/**
 * Build the layout model from selected subgraph.
 */
export function buildLayoutModel(input: BuildModelInput): LayoutModel {
    const { data, selection, focusPersonId } = input;

    const persons = new Map<PersonId, PersonNode>();
    const unions = new Map<UnionId, UnionNode>();
    const edges: ParentChildEdge[] = [];
    const personToUnion = new Map<PersonId, UnionId>();
    const childToParentUnion = new Map<PersonId, UnionId>();

    // Track which persons have been assigned to a union
    const assignedPersons = new Set<PersonId>();

    // Get focus person's biological parents for priority sorting
    const focusPerson = data.persons[focusPersonId];
    const focusParentIds = new Set(focusPerson?.parentIds ?? []);

    // Step 1: Create PersonNodes for all selected persons
    for (const personId of selection.persons) {
        const person = data.persons[personId];
        if (person) {
            persons.set(personId, {
                id: personId,
                firstName: person.firstName,
                lastName: person.lastName,
                gender: person.gender,
                birthDate: person.birthDate
            });
        }
    }

    // Step 2: Create UnionNodes from partnerships
    // Sort partnerships by priority:
    // 1. Biological parent partnership (both partners are focus person's parents)
    // 2. isPrimary flag set
    // 3. Active status (married/partners/undefined) before terminated (divorced/separated)
    // 4. By wedding date (newest first)
    // 5. By ID for determinism
    const sortedPartnershipIds = [...selection.partnerships].sort((aId, bId) => {
        const a = data.partnerships[aId];
        const b = data.partnerships[bId];
        if (!a || !b) return 0;

        // Priority 1: Biological parents of focus person
        const aIsBioParent = focusParentIds.has(a.person1Id) && focusParentIds.has(a.person2Id);
        const bIsBioParent = focusParentIds.has(b.person1Id) && focusParentIds.has(b.person2Id);
        if (aIsBioParent && !bIsBioParent) return -1;
        if (!aIsBioParent && bIsBioParent) return 1;

        // Priority 2: isPrimary flag
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;

        // Priority 3: Active status beats terminated
        const isTerminated = (s?: string) => s === 'divorced' || s === 'separated';
        const aTerminated = isTerminated(a.status);
        const bTerminated = isTerminated(b.status);
        if (!aTerminated && bTerminated) return -1;
        if (aTerminated && !bTerminated) return 1;

        // Priority 4: Start date (newest first)
        const aDate = a.startDate ?? '';
        const bDate = b.startDate ?? '';
        if (aDate !== bDate) return bDate.localeCompare(aDate);

        // Priority 5: ID for determinism
        return aId.localeCompare(bId);
    });

    // Process partnerships to create unions
    for (const partnershipId of sortedPartnershipIds) {
        const partnership = data.partnerships[partnershipId];
        if (!partnership) continue;

        // Both partners must be in selection
        if (!selection.persons.has(partnership.person1Id) ||
            !selection.persons.has(partnership.person2Id)) {
            continue;
        }

        // Check if either partner is already assigned to a union
        // (handles multiple partnerships)
        const p1Assigned = assignedPersons.has(partnership.person1Id);
        const p2Assigned = assignedPersons.has(partnership.person2Id);

        if (p1Assigned && p2Assigned) {
            // Both already assigned - this partnership's children go to the union
            // that contains person1 (arbitrary but deterministic)
            const existingUnionId = personToUnion.get(partnership.person1Id);
            if (existingUnionId) {
                addChildrenToUnion(unions, existingUnionId, partnership, selection, data, childToParentUnion, edges);
            }
            continue;
        }

        // Order partners: male left, otherwise alphabetical
        const [partnerA, partnerB] = orderPartners(
            partnership.person1Id,
            partnership.person2Id,
            data
        );

        // Create union ID from sorted partner IDs (deterministic)
        const unionId = createUnionId(partnerA, partnerB);

        // Get children that are in selection, sorted
        const childIds = getSelectedChildren(partnership, selection, data);

        const union: UnionNode = {
            id: unionId,
            partnerA,
            partnerB,
            partnershipId,
            childIds
        };

        unions.set(unionId, union);
        // Only set personToUnion for first (highest priority) partnership
        // so the focus union is always the primary one
        if (!personToUnion.has(partnerA)) personToUnion.set(partnerA, unionId);
        if (!personToUnion.has(partnerB)) personToUnion.set(partnerB, unionId);
        assignedPersons.add(partnerA);
        assignedPersons.add(partnerB);

        // Create parent-child edges
        for (const childId of childIds) {
            childToParentUnion.set(childId, unionId);
            edges.push({
                parentUnionId: unionId,
                childPersonId: childId
            });
        }
    }

    // Step 3: Create single-person unions for persons without partners in selection
    for (const personId of selection.persons) {
        if (assignedPersons.has(personId)) continue;

        const person = data.persons[personId];
        if (!person) continue;

        // Create single-person union
        const unionId = createUnionId(personId, null);

        // Find children of this person that are in selection
        // For single parents (placeholders), include children from childIds directly
        // For parents with partnerships, only include from those partnerships
        const hasPartnerships = person.partnerships.length > 0;
        const childIds = person.childIds
            .filter(childId => selection.persons.has(childId))
            .filter(childId => {
                if (!hasPartnerships) {
                    // Single parent (placeholder) - include all children from childIds
                    // that have this person as a parent
                    const child = data.persons[childId];
                    return child && child.parentIds.includes(personId);
                }
                // Only include if child's parent partnership includes this person
                return Object.values(data.partnerships).some(p =>
                    p.childIds.includes(childId) &&
                    (p.person1Id === personId || p.person2Id === personId)
                );
            });

        // Sort children
        const sortedChildIds = sortChildren(childIds, data);

        const union: UnionNode = {
            id: unionId,
            partnerA: personId,
            partnerB: null,
            partnershipId: null,
            childIds: sortedChildIds
        };

        unions.set(unionId, union);
        personToUnion.set(personId, unionId);
        assignedPersons.add(personId);

        // Create parent-child edges
        for (const childId of sortedChildIds) {
            if (!childToParentUnion.has(childId)) {
                childToParentUnion.set(childId, unionId);
                edges.push({
                    parentUnionId: unionId,
                    childPersonId: childId
                });
            }
        }
    }

    return {
        persons,
        unions,
        edges,
        personToUnion,
        childToParentUnion
    };
}

/**
 * Order partners: male left, otherwise alphabetical by ID.
 */
function orderPartners(
    p1: PersonId,
    p2: PersonId,
    data: StromData
): [PersonId, PersonId] {
    const person1 = data.persons[p1];
    const person2 = data.persons[p2];

    // Male on the left
    if (person1?.gender === 'male' && person2?.gender === 'female') {
        return [p1, p2];
    }
    if (person1?.gender === 'female' && person2?.gender === 'male') {
        return [p2, p1];
    }

    // Same gender or unknown: alphabetical by ID
    return p1 < p2 ? [p1, p2] : [p2, p1];
}

/**
 * Create deterministic union ID.
 */
function createUnionId(partnerA: PersonId, partnerB: PersonId | null): UnionId {
    if (partnerB === null) {
        return toUnionId(`union_${partnerA}_single`);
    }
    // Use sorted IDs for determinism
    const sorted = [partnerA, partnerB].sort();
    return toUnionId(`union_${sorted[0]}_${sorted[1]}`);
}

/**
 * Get children from partnership that are in selection, sorted.
 */
function getSelectedChildren(
    partnership: { childIds: PersonId[] },
    selection: { persons: Set<PersonId> },
    data: StromData
): PersonId[] {
    const children = partnership.childIds.filter(id => selection.persons.has(id));
    return sortChildren(children, data);
}

/**
 * Sort children by birthDate, then by ID.
 */
function sortChildren(childIds: PersonId[], data: StromData): PersonId[] {
    return [...childIds].sort((a, b) => {
        const personA = data.persons[a];
        const personB = data.persons[b];

        // Sort by birth date first
        const birthA = personA?.birthDate ?? '';
        const birthB = personB?.birthDate ?? '';
        if (birthA !== birthB) {
            return birthA.localeCompare(birthB);
        }

        // Then by ID for determinism
        return a.localeCompare(b);
    });
}

/**
 * Get child union IDs for a parent union in deterministic order.
 * Returns deduplicated union IDs preserving the order of children in the parent union.
 */
export function getChildUnions(
    parentUnionId: UnionId,
    model: LayoutModel,
    genModel: GenerationalModel
): UnionId[] {
    const union = model.unions.get(parentUnionId);
    if (!union) return [];

    const parentGen = genModel.unionGen.get(parentUnionId) ?? 0;
    const result: UnionId[] = [];
    const seen = new Set<UnionId>();

    for (const childId of union.childIds) {
        const childUnionId = model.personToUnion.get(childId);
        if (!childUnionId || seen.has(childUnionId)) continue;
        const childGen = genModel.unionGen.get(childUnionId);
        if (childGen === undefined || childGen <= parentGen) continue;
        seen.add(childUnionId);
        result.push(childUnionId);
    }

    return result;
}

/**
 * Add children from a partnership to an existing union.
 * Used when both partners are already in unions (multiple partnerships).
 */
function addChildrenToUnion(
    unions: Map<UnionId, UnionNode>,
    unionId: UnionId,
    partnership: { childIds: PersonId[] },
    selection: { persons: Set<PersonId> },
    data: StromData,
    childToParentUnion: Map<PersonId, UnionId>,
    edges: ParentChildEdge[]
): void {
    const union = unions.get(unionId);
    if (!union) return;

    const newChildren = getSelectedChildren(partnership, selection, data);
    for (const childId of newChildren) {
        if (!union.childIds.includes(childId)) {
            union.childIds.push(childId);
            if (!childToParentUnion.has(childId)) {
                childToParentUnion.set(childId, unionId);
                edges.push({
                    parentUnionId: unionId,
                    childPersonId: childId
                });
            }
        }
    }

    // Re-sort children
    union.childIds = sortChildren(union.childIds, data);
}
