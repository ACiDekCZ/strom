/**
 * How many generations up and down a person's view can reach: the limits of
 * the focus depth ("Ancestors / Descendants N"). Pure, on any data — the
 * tree's own, or the copy the view lays out with the links "linked in the
 * view only" applied (they count into the view).
 */

import { PersonId, StromData } from './types.js';

/** The longest line of parents above the person (0: none). */
export function maxAncestorDepth(data: StromData, personId: PersonId, visited: Set<PersonId> = new Set()): number {
    if (visited.has(personId)) return 0;
    visited.add(personId);
    const person = data.persons[personId];
    if (!person) return 0;
    let maxDepth = 0;
    for (const parentId of person.parentIds) {
        maxDepth = Math.max(maxDepth, 1 + maxAncestorDepth(data, parentId, visited));
    }
    return maxDepth;
}

/** The longest line of children below the person (0: none). */
export function maxDescendantDepth(data: StromData, personId: PersonId, visited: Set<PersonId> = new Set()): number {
    if (visited.has(personId)) return 0;
    visited.add(personId);
    const person = data.persons[personId];
    if (!person) return 0;
    let maxDepth = 0;

    // Children from all partnerships
    for (const partnershipId of person.partnerships) {
        const partnership = data.partnerships[partnershipId];
        if (!partnership) continue;
        for (const childId of partnership.childIds) {
            maxDepth = Math.max(maxDepth, 1 + maxDescendantDepth(data, childId, visited));
        }
    }

    // Also direct childIds (older data format)
    for (const childId of person.childIds) {
        if (!visited.has(childId)) maxDepth = Math.max(maxDepth, 1 + maxDescendantDepth(data, childId, visited));
    }

    // A partner's children from the partner's other unions are shown one
    // generation down too, within the depth (T19): the depth must reach them.
    // Only them: the view never shows their own descendants, so they add
    // exactly one generation and are not followed further.
    if (maxDepth < 1) {
        for (const partnershipId of person.partnerships) {
            const partnership = data.partnerships[partnershipId];
            if (!partnership) continue;
            const partnerId = partnership.person1Id === personId ? partnership.person2Id : partnership.person1Id;
            const hasStepChild = (data.persons[partnerId]?.partnerships ?? []).some(otherId =>
                otherId !== partnershipId && (data.partnerships[otherId]?.childIds.length ?? 0) > 0);
            if (hasStepChild) { maxDepth = 1; break; }
        }
    }
    return maxDepth;
}

/** Generations up and down from a person, each at least 1. */
export function maxGenerations(data: StromData, personId: PersonId): { up: number; down: number } {
    if (!data.persons[personId]) return { up: 1, down: 1 };
    return {
        up: Math.max(1, maxAncestorDepth(data, personId)),
        down: Math.max(1, maxDescendantDepth(data, personId)),
    };
}

/**
 * Generations up and down, the siblings' descendants counted into "down"
 * (siblings stand in the same generation: nieces, nephews and theirs).
 */
export function maxGenerationsWithSiblings(data: StromData, personId: PersonId): { up: number; down: number } {
    const person = data.persons[personId];
    if (!person) return { up: 1, down: 1 };
    let maxDown = maxDescendantDepth(data, personId);
    const siblings = new Set<PersonId>();
    for (const parentId of person.parentIds) {
        for (const childId of data.persons[parentId]?.childIds ?? []) if (childId !== personId) siblings.add(childId);
    }
    for (const sibling of siblings) {
        if (data.persons[sibling]) maxDown = Math.max(maxDown, maxDescendantDepth(data, sibling));
    }
    return { up: Math.max(1, maxAncestorDepth(data, personId)), down: Math.max(1, maxDown) };
}
