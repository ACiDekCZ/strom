/**
 * buildLayoutModel Unit Tests
 *
 * Tests that buildLayoutModel correctly builds UnionNodes and assigns children:
 * - Each child belongs to exactly one parent union
 * - Union has 1 or 2 partners (never 0)
 * - Children are assigned to correct union based on partnership
 * - Results are deterministic (repeated calls = same output)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { selectSubgraph } from '../pipeline/1-select-subgraph.js';
import { buildLayoutModel } from '../pipeline/2-build-model.js';
import { PersonId, PartnershipId, StromData } from '../../types.js';
import { GraphSelection, LayoutModel, UnionId } from '../pipeline/types.js';

describe('buildLayoutModel', () => {
    let data: StromData;
    let selectionAll: GraphSelection;
    let selectionSingleParent: GraphSelection;
    let modelAll: LayoutModel;
    let modelSingleParent: LayoutModel;

    beforeAll(() => {
        data = loadFixture('t2_build_model_unions');

        // Selection 1: All persons including f_partner (full selection)
        selectionAll = {
            persons: new Set([
                'a', 'b', 'e', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6',
                'f', 'f_partner', 'c7', 'g', 'h'
            ] as PersonId[]),
            partnerships: new Set([
                'part_a_b', 'part_a_e', 'part_f_unknown', 'part_g_h'
            ] as PartnershipId[]),
            focusPersonId: 'a' as PersonId,
            maxAncestorGen: 0,
            maxDescendantGen: 1
        };

        // Selection 2: Without f_partner (single parent case)
        selectionSingleParent = {
            persons: new Set([
                'a', 'b', 'e', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6',
                'f', 'c7', 'g', 'h'
            ] as PersonId[]),
            partnerships: new Set([
                'part_a_b', 'part_a_e', 'part_f_unknown', 'part_g_h'
            ] as PartnershipId[]),
            focusPersonId: 'a' as PersonId,
            maxAncestorGen: 0,
            maxDescendantGen: 1
        };

        modelAll = buildLayoutModel({ data, selection: selectionAll, focusPersonId: selectionAll.focusPersonId });
        modelSingleParent = buildLayoutModel({ data, selection: selectionSingleParent, focusPersonId: selectionSingleParent.focusPersonId });
    });

    describe('union structure', () => {
        it('every union has 1 or 2 partners, never 0', () => {
            for (const [unionId, union] of modelAll.unions) {
                // partnerA is always defined
                expect(union.partnerA).toBeDefined();
                expect(union.partnerA).not.toBe(null);

                // If partnerB exists, it must be a valid PersonId
                if (union.partnerB !== null) {
                    expect(modelAll.persons.has(union.partnerB)).toBe(true);
                }
            }

            // Same check for single parent model
            for (const [unionId, union] of modelSingleParent.unions) {
                expect(union.partnerA).toBeDefined();
                expect(union.partnerA).not.toBe(null);
            }
        });

        it('orders partners correctly (male left, alphabetical fallback)', () => {
            // Find union A+B - A is male, should be partnerA
            const unionAB = Array.from(modelAll.unions.values()).find(
                u => (u.partnerA === 'a' && u.partnerB === 'b') ||
                     (u.partnerA === 'b' && u.partnerB === 'a')
            );
            expect(unionAB).toBeDefined();
            expect(unionAB!.partnerA).toBe('a'); // Male on left

            // Find union A+E - A is male, should be partnerA
            const unionAE = Array.from(modelAll.unions.values()).find(
                u => (u.partnerA === 'a' && u.partnerB === 'e') ||
                     (u.partnerA === 'e' && u.partnerB === 'a')
            );
            expect(unionAE).toBeDefined();
            expect(unionAE!.partnerA).toBe('a'); // Male on left

            // Find union G+H - G is male, should be partnerA
            const unionGH = Array.from(modelAll.unions.values()).find(
                u => (u.partnerA === 'g' && u.partnerB === 'h') ||
                     (u.partnerA === 'h' && u.partnerB === 'g')
            );
            expect(unionGH).toBeDefined();
            expect(unionGH!.partnerA).toBe('g'); // Male on left
        });
    });

    describe('child assignment', () => {
        it('every child has exactly one parentUnionId', () => {
            const childIds = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'] as PersonId[];

            for (const childId of childIds) {
                if (!modelAll.persons.has(childId)) continue;

                // Check childToParentUnion map
                const parentUnionId = modelAll.childToParentUnion.get(childId);

                // Count how many unions have this child
                let unionCount = 0;
                for (const union of modelAll.unions.values()) {
                    if (union.childIds.includes(childId)) {
                        unionCount++;
                    }
                }

                // Either in childToParentUnion and one union's childIds, or none
                if (modelAll.childToParentUnion.has(childId)) {
                    expect(unionCount).toBe(1);
                    expect(parentUnionId).toBeDefined();
                }
            }
        });

        it('assigns children from first marriage to correct union (A+B)', () => {
            // Find union for A+B partnership
            const unionAB = Array.from(modelAll.unions.values()).find(
                u => u.partnershipId === ('part_a_b' as PartnershipId)
            );
            expect(unionAB).toBeDefined();

            // Children c1, c2, c3 should be in this union
            expect(unionAB!.childIds).toContain('c1');
            expect(unionAB!.childIds).toContain('c2');
            expect(unionAB!.childIds).toContain('c3');
            expect(unionAB!.childIds.length).toBe(3);
        });

        it('assigns children from second marriage to correct union (A+E)', () => {
            // Find union for A+E partnership
            const unionAE = Array.from(modelAll.unions.values()).find(
                u => u.partnershipId === ('part_a_e' as PartnershipId)
            );
            expect(unionAE).toBeDefined();

            // Children c4, c5, c6 should be in this union
            expect(unionAE!.childIds).toContain('c4');
            expect(unionAE!.childIds).toContain('c5');
            expect(unionAE!.childIds).toContain('c6');
            expect(unionAE!.childIds.length).toBe(3);
        });

        it('assigns single parent children to single-person union', () => {
            // In modelSingleParent, f_partner is not in selection
            // So F should be in a single-person union

            // Find union where F is alone
            const unionF = Array.from(modelSingleParent.unions.values()).find(
                u => u.partnerA === 'f' && u.partnerB === null
            );
            expect(unionF).toBeDefined();

            // c7 should be child of this union
            expect(unionF!.childIds).toContain('c7');
        });

        it('childless partnership has empty childIds', () => {
            // Find union for G+H partnership
            const unionGH = Array.from(modelAll.unions.values()).find(
                u => u.partnershipId === ('part_g_h' as PartnershipId)
            );
            expect(unionGH).toBeDefined();

            // Should have no children
            expect(unionGH!.childIds).toHaveLength(0);
        });
    });

    describe('edge consistency', () => {
        it('edge count equals total children count', () => {
            // Count all children across all unions
            let totalChildren = 0;
            for (const union of modelAll.unions.values()) {
                totalChildren += union.childIds.length;
            }

            // Should match edge count
            expect(modelAll.edges.length).toBe(totalChildren);
        });

        it('all edges reference existing unions and persons', () => {
            for (const edge of modelAll.edges) {
                // Union must exist
                expect(modelAll.unions.has(edge.parentUnionId)).toBe(true);

                // Person must exist
                expect(modelAll.persons.has(edge.childPersonId)).toBe(true);
            }
        });

        it('childToParentUnion map is consistent with edges', () => {
            // Build set of (child, union) pairs from edges
            const edgePairs = new Set(
                modelAll.edges.map(e => `${e.childPersonId}:${e.parentUnionId}`)
            );

            // Build set from map
            const mapPairs = new Set(
                Array.from(modelAll.childToParentUnion.entries())
                    .map(([child, union]) => `${child}:${union}`)
            );

            // Should be identical
            expect(edgePairs.size).toBe(mapPairs.size);
            for (const pair of edgePairs) {
                expect(mapPairs.has(pair)).toBe(true);
            }
        });
    });

    describe('determinism', () => {
        it('produces identical result on repeated calls', () => {
            // Call 5 times
            const results: LayoutModel[] = [];
            for (let i = 0; i < 5; i++) {
                results.push(buildLayoutModel({ data, selection: selectionAll, focusPersonId: selectionAll.focusPersonId }));
            }

            // Compare all results to first
            const first = results[0];
            for (let i = 1; i < results.length; i++) {
                const current = results[i];

                // Same persons
                expect(current.persons.size).toBe(first.persons.size);

                // Same unions
                expect(current.unions.size).toBe(first.unions.size);

                // Same edges
                expect(current.edges.length).toBe(first.edges.length);
            }
        });

        it('union IDs are stable across calls', () => {
            const model1 = buildLayoutModel({ data, selection: selectionAll, focusPersonId: selectionAll.focusPersonId });
            const model2 = buildLayoutModel({ data, selection: selectionAll, focusPersonId: selectionAll.focusPersonId });

            // Extract union IDs and sort
            const ids1 = Array.from(model1.unions.keys()).sort();
            const ids2 = Array.from(model2.unions.keys()).sort();

            expect(ids1).toEqual(ids2);
        });

        it('child order is deterministic (by birthDate then ID)', () => {
            // Find union A+B and check child order
            const model1 = buildLayoutModel({ data, selection: selectionAll, focusPersonId: selectionAll.focusPersonId });
            const model2 = buildLayoutModel({ data, selection: selectionAll, focusPersonId: selectionAll.focusPersonId });

            const union1 = Array.from(model1.unions.values()).find(
                u => u.partnershipId === ('part_a_b' as PartnershipId)
            );
            const union2 = Array.from(model2.unions.values()).find(
                u => u.partnershipId === ('part_a_b' as PartnershipId)
            );

            expect(union1).toBeDefined();
            expect(union2).toBeDefined();

            // Child order should be c1, c2, c3 (sorted by birthDate)
            expect(union1!.childIds).toEqual(['c1', 'c2', 'c3']);
            expect(union2!.childIds).toEqual(['c1', 'c2', 'c3']);

            // Same for A+E union
            const unionAE1 = Array.from(model1.unions.values()).find(
                u => u.partnershipId === ('part_a_e' as PartnershipId)
            );
            const unionAE2 = Array.from(model2.unions.values()).find(
                u => u.partnershipId === ('part_a_e' as PartnershipId)
            );

            expect(unionAE1!.childIds).toEqual(['c4', 'c5', 'c6']);
            expect(unionAE2!.childIds).toEqual(['c4', 'c5', 'c6']);
        });
    });

    describe('multiple partnerships', () => {
        it('person with multiple partnerships appears in multiple unions', () => {
            // Person A has 2 partnerships (with B and with E)
            // Should appear in 2 different unions

            const unionsWithA = Array.from(modelAll.unions.values()).filter(
                u => u.partnerA === 'a' || u.partnerB === 'a'
            );

            expect(unionsWithA.length).toBe(2);

            // One with B, one with E
            const partners = unionsWithA.map(u =>
                u.partnerA === 'a' ? u.partnerB : u.partnerA
            ).sort();
            expect(partners).toEqual(['b', 'e']);
        });

        it('personToUnion maps to first assigned union', () => {
            // Person A should be in personToUnion pointing to ONE union
            const unionId = modelAll.personToUnion.get('a' as PersonId);
            expect(unionId).toBeDefined();

            // The union should exist
            expect(modelAll.unions.has(unionId!)).toBe(true);

            // The union should contain A
            const union = modelAll.unions.get(unionId!);
            expect(union!.partnerA === 'a' || union!.partnerB === 'a').toBe(true);
        });
    });

    describe('person nodes', () => {
        it('creates PersonNode for each selected person', () => {
            expect(modelAll.persons.size).toBe(selectionAll.persons.size);

            for (const personId of selectionAll.persons) {
                expect(modelAll.persons.has(personId)).toBe(true);
            }
        });

        it('PersonNode contains correct data from StromData', () => {
            const personA = modelAll.persons.get('a' as PersonId);
            expect(personA).toBeDefined();
            expect(personA!.firstName).toBe('Adam');
            expect(personA!.lastName).toBe('Smith');
            expect(personA!.gender).toBe('male');

            const personB = modelAll.persons.get('b' as PersonId);
            expect(personB).toBeDefined();
            expect(personB!.firstName).toBe('Betty');
            expect(personB!.lastName).toBe('Jones');
            expect(personB!.gender).toBe('female');
        });

        it('PersonNode includes birthDate when present', () => {
            const personC1 = modelAll.persons.get('c1' as PersonId);
            expect(personC1).toBeDefined();
            expect(personC1!.birthDate).toBe('1990-01-01');

            const personA = modelAll.persons.get('a' as PersonId);
            expect(personA).toBeDefined();
            expect(personA!.birthDate).toBeUndefined();
        });
    });

    describe('union partnership reference', () => {
        it('unions from partnerships have correct partnershipId', () => {
            const unionAB = Array.from(modelAll.unions.values()).find(
                u => u.partnerA === 'a' && u.partnerB === 'b'
            );
            expect(unionAB!.partnershipId).toBe('part_a_b');

            const unionGH = Array.from(modelAll.unions.values()).find(
                u => u.partnerA === 'g' && u.partnerB === 'h'
            );
            expect(unionGH!.partnershipId).toBe('part_g_h');
        });

        it('single-person unions have null partnershipId', () => {
            const unionF = Array.from(modelSingleParent.unions.values()).find(
                u => u.partnerA === 'f' && u.partnerB === null
            );
            expect(unionF).toBeDefined();
            expect(unionF!.partnershipId).toBeNull();
        });
    });
});
