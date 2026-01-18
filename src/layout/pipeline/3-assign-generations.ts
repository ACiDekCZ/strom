/**
 * Step 3: Assign Generations
 *
 * Assigns generation numbers to all persons and unions:
 * - Focus person = generation 0
 * - Parents = generation -1 (negative = ancestors)
 * - Grandparents = generation -2
 * - Children = generation +1 (positive = descendants)
 * - Grandchildren = generation +2
 *
 * Union generation = same as its members (partners always same gen).
 */

import { PersonId } from '../../types.js';
import {
    AssignGenInput,
    GenerationalModel,
    GenerationBandInfo,
    UnionId
} from './types.js';

/**
 * Assign generation numbers using BFS from focus person.
 */
export function assignGenerations(input: AssignGenInput): GenerationalModel {
    const { model, focusPersonId } = input;

    const personGen = new Map<PersonId, number>();
    const unionGen = new Map<UnionId, number>();

    // BFS queue: [personId, generation]
    const queue: Array<[PersonId, number]> = [];
    const visited = new Set<PersonId>();

    // Start with focus person at generation 0
    queue.push([focusPersonId, 0]);
    visited.add(focusPersonId);

    while (queue.length > 0) {
        const [personId, gen] = queue.shift()!;
        personGen.set(personId, gen);

        const person = model.persons.get(personId);
        if (!person) continue;

        // Find the union this person belongs to
        const unionId = model.personToUnion.get(personId);
        if (unionId) {
            // Set union generation (same as person)
            unionGen.set(unionId, gen);

            // Set partner's generation too (same as person)
            const union = model.unions.get(unionId);
            if (union) {
                const partnerId = union.partnerA === personId ? union.partnerB : union.partnerA;
                if (partnerId && !visited.has(partnerId)) {
                    visited.add(partnerId);
                    personGen.set(partnerId, gen);
                    // Partner's ancestors/descendants will be processed when we get to them
                }
            }
        }

        // Process children (next generation down = +1)
        const parentUnionId = model.personToUnion.get(personId);
        if (parentUnionId) {
            const union = model.unions.get(parentUnionId);
            if (union) {
                for (const childId of union.childIds) {
                    if (!visited.has(childId)) {
                        visited.add(childId);
                        queue.push([childId, gen + 1]);
                    }
                }
            }
        }

        // Process parents (previous generation = -1)
        const childUnionId = model.childToParentUnion.get(personId);
        if (childUnionId) {
            const parentUnion = model.unions.get(childUnionId);
            if (parentUnion) {
                // Add both parents to queue
                if (!visited.has(parentUnion.partnerA)) {
                    visited.add(parentUnion.partnerA);
                    queue.push([parentUnion.partnerA, gen - 1]);
                }
                if (parentUnion.partnerB && !visited.has(parentUnion.partnerB)) {
                    visited.add(parentUnion.partnerB);
                    queue.push([parentUnion.partnerB, gen - 1]);
                }
            }
        }
    }

    // Handle any remaining persons not reached by BFS
    // These are typically spouse ancestors or disconnected branches
    // Use EDGES to infer generations (more reliable than childToParentUnion)
    let changed = true;
    while (changed) {
        changed = false;

        // Use edges to propagate generations
        for (const edge of model.edges) {
            const parentUnionGenVal = unionGen.get(edge.parentUnionId);
            const childGenVal = personGen.get(edge.childPersonId);

            // If parent union has gen but child doesn't, set child gen
            if (parentUnionGenVal !== undefined && childGenVal === undefined) {
                const inferredChildGen = parentUnionGenVal + 1;
                personGen.set(edge.childPersonId, inferredChildGen);
                const childUnionId = model.personToUnion.get(edge.childPersonId);
                if (childUnionId && !unionGen.has(childUnionId)) {
                    unionGen.set(childUnionId, inferredChildGen);
                }
                changed = true;
            }

            // If child has gen but parent union doesn't, set parent union gen
            if (childGenVal !== undefined && parentUnionGenVal === undefined) {
                const inferredParentGen = childGenVal - 1;
                unionGen.set(edge.parentUnionId, inferredParentGen);
                const parentUnion = model.unions.get(edge.parentUnionId);
                if (parentUnion) {
                    if (!personGen.has(parentUnion.partnerA)) {
                        personGen.set(parentUnion.partnerA, inferredParentGen);
                    }
                    if (parentUnion.partnerB && !personGen.has(parentUnion.partnerB)) {
                        personGen.set(parentUnion.partnerB, inferredParentGen);
                    }
                }
                changed = true;
            }
        }

        // Also check union children directly (for unions with children but no edges somehow)
        for (const [personId] of model.persons) {
            if (personGen.has(personId)) continue;

            // Try to infer from union's children
            const unionId = model.personToUnion.get(personId);
            if (unionId) {
                const union = model.unions.get(unionId);
                if (union) {
                    for (const childId of union.childIds) {
                        const childGen = personGen.get(childId);
                        if (childGen !== undefined) {
                            const inferredGen = childGen - 1;
                            personGen.set(personId, inferredGen);
                            unionGen.set(unionId, inferredGen);
                            const partnerId = union.partnerA === personId ? union.partnerB : union.partnerA;
                            if (partnerId && !personGen.has(partnerId)) {
                                personGen.set(partnerId, inferredGen);
                            }
                            changed = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    // Final fallback: assign generation 0 to any still-unassigned persons
    for (const [personId] of model.persons) {
        if (!personGen.has(personId)) {
            personGen.set(personId, 0);
            const unionId = model.personToUnion.get(personId);
            if (unionId && !unionGen.has(unionId)) {
                unionGen.set(unionId, 0);
            }
        }
    }

    // Build generation bands
    const genBands = new Map<number, GenerationBandInfo>();
    let minGen = 0;
    let maxGen = 0;

    for (const [personId, gen] of personGen) {
        minGen = Math.min(minGen, gen);
        maxGen = Math.max(maxGen, gen);

        if (!genBands.has(gen)) {
            genBands.set(gen, { persons: [], unions: [] });
        }
        genBands.get(gen)!.persons.push(personId);
    }

    for (const [unionId, gen] of unionGen) {
        if (!genBands.has(gen)) {
            genBands.set(gen, { persons: [], unions: [] });
        }
        const band = genBands.get(gen)!;
        if (!band.unions.includes(unionId)) {
            band.unions.push(unionId);
        }
    }

    return {
        model,
        personGen,
        unionGen,
        genBands,
        minGen,
        maxGen
    };
}

/**
 * Validate generation assignments.
 * Returns list of errors (empty if valid).
 */
export function validateGenerations(genModel: GenerationalModel): string[] {
    const errors: string[] = [];
    const { model, personGen, unionGen } = genModel;

    // Check: all edges go from lower gen to higher gen
    for (const edge of model.edges) {
        const parentUnionGen = unionGen.get(edge.parentUnionId);
        const childGen = personGen.get(edge.childPersonId);

        if (parentUnionGen === undefined || childGen === undefined) {
            errors.push(`Missing generation for edge ${edge.parentUnionId} -> ${edge.childPersonId}`);
            continue;
        }

        // Parent union gen should be child gen - 1
        if (childGen !== parentUnionGen + 1) {
            errors.push(
                `Generation mismatch: union ${edge.parentUnionId} (gen ${parentUnionGen}) ` +
                `-> child ${edge.childPersonId} (gen ${childGen}), expected gen ${parentUnionGen + 1}`
            );
        }
    }

    // Check: partners in same union have same generation
    for (const [unionId, union] of model.unions) {
        const genA = personGen.get(union.partnerA);
        const genB = union.partnerB ? personGen.get(union.partnerB) : genA;

        if (genA !== genB) {
            errors.push(
                `Partners in union ${unionId} have different generations: ` +
                `${union.partnerA} (gen ${genA}) vs ${union.partnerB} (gen ${genB})`
            );
        }

        // Union gen should match partner gen
        const uGen = unionGen.get(unionId);
        if (uGen !== genA) {
            errors.push(
                `Union ${unionId} gen (${uGen}) doesn't match partner gen (${genA})`
            );
        }
    }

    return errors;
}
