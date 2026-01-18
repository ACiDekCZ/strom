/**
 * assignGenerations Unit Tests
 *
 * Tests that assignGenerations correctly assigns generation numbers:
 * - Focus person = generation 0
 * - Parents = generation -1 (negative = ancestors)
 * - Grandparents = generation -2
 * - Great-grandparents = generation -3
 * - Children = generation +1 (positive = descendants)
 * - Grandchildren = generation +2
 * - Partners always have same generation
 * - Siblings have same generation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { buildLayoutModel } from '../pipeline/2-build-model.js';
import { assignGenerations, validateGenerations } from '../pipeline/3-assign-generations.js';
import { PersonId, PartnershipId, StromData } from '../../types.js';
import { GraphSelection, GenerationalModel, LayoutModel } from '../pipeline/types.js';

describe('assignGenerations', () => {
    let data: StromData;
    let selection: GraphSelection;
    let model: LayoutModel;
    let genModel: GenerationalModel;

    // All person IDs from fixture
    const ALL_PERSON_IDS = [
        'ggp1', 'ggp2',           // great-grandparents (gen -3)
        'gp1', 'gp2',             // grandparents (gen -2)
        'u1', 'u2', 'p1', 'p2', 'u3', 'u4',  // parents generation (gen -1)
        'f', 'fp', 's1', 'co1', 'co2', 'co3', 'co4',  // focus generation (gen 0)
        'c1', 'c2', 'c3', 'c2p',  // children generation (gen +1)
        'gc1'                      // grandchildren (gen +2)
    ] as PersonId[];

    const ALL_PARTNERSHIP_IDS = [
        'part_ggp', 'part_gp', 'part_u1', 'part_p1', 'part_u3', 'part_f', 'part_c2'
    ] as PartnershipId[];

    beforeAll(() => {
        data = loadFixture('t3_assign_generations');

        // Create selection with all persons
        selection = {
            persons: new Set(ALL_PERSON_IDS),
            partnerships: new Set(ALL_PARTNERSHIP_IDS),
            focusPersonId: 'f' as PersonId,
            maxAncestorGen: 3,
            maxDescendantGen: 2
        };

        model = buildLayoutModel({ data, selection, focusPersonId: 'f' as PersonId });
        genModel = assignGenerations({ model, focusPersonId: 'f' as PersonId });
    });

    describe('focus person', () => {
        it('assigns generation 0 to focus person', () => {
            const focusGen = genModel.personGen.get('f' as PersonId);
            expect(focusGen).toBe(0);
        });

        it('assigns same generation to focus partner', () => {
            const focusGen = genModel.personGen.get('f' as PersonId);
            const partnerGen = genModel.personGen.get('fp' as PersonId);
            expect(partnerGen).toBe(focusGen);
            expect(partnerGen).toBe(0);
        });
    });

    describe('parent-child relationship invariant', () => {
        it('child generation equals parent union generation + 1 for all edges', () => {
            for (const edge of model.edges) {
                const parentUnionGen = genModel.unionGen.get(edge.parentUnionId);
                const childGen = genModel.personGen.get(edge.childPersonId);

                expect(parentUnionGen).toBeDefined();
                expect(childGen).toBeDefined();
                expect(childGen).toBe(parentUnionGen! + 1);
            }
        });

        it('parents have generation -1', () => {
            const p1Gen = genModel.personGen.get('p1' as PersonId);
            const p2Gen = genModel.personGen.get('p2' as PersonId);
            expect(p1Gen).toBe(-1);
            expect(p2Gen).toBe(-1);
        });

        it('grandparents have generation -2', () => {
            const gp1Gen = genModel.personGen.get('gp1' as PersonId);
            const gp2Gen = genModel.personGen.get('gp2' as PersonId);
            expect(gp1Gen).toBe(-2);
            expect(gp2Gen).toBe(-2);
        });

        it('great-grandparents have generation -3', () => {
            const ggp1Gen = genModel.personGen.get('ggp1' as PersonId);
            const ggp2Gen = genModel.personGen.get('ggp2' as PersonId);
            expect(ggp1Gen).toBe(-3);
            expect(ggp2Gen).toBe(-3);
        });

        it('children have generation +1', () => {
            const c1Gen = genModel.personGen.get('c1' as PersonId);
            const c2Gen = genModel.personGen.get('c2' as PersonId);
            const c3Gen = genModel.personGen.get('c3' as PersonId);
            expect(c1Gen).toBe(1);
            expect(c2Gen).toBe(1);
            expect(c3Gen).toBe(1);
        });

        it('grandchildren have generation +2', () => {
            const gc1Gen = genModel.personGen.get('gc1' as PersonId);
            expect(gc1Gen).toBe(2);
        });
    });

    describe('sibling consistency', () => {
        it('focus siblings have same generation', () => {
            const fGen = genModel.personGen.get('f' as PersonId);
            const s1Gen = genModel.personGen.get('s1' as PersonId);
            expect(fGen).toBe(s1Gen);
            expect(fGen).toBe(0);
        });

        it('children of same union have same generation', () => {
            // Children of focus (c1, c2, c3)
            const c1Gen = genModel.personGen.get('c1' as PersonId);
            const c2Gen = genModel.personGen.get('c2' as PersonId);
            const c3Gen = genModel.personGen.get('c3' as PersonId);
            expect(c1Gen).toBe(c2Gen);
            expect(c2Gen).toBe(c3Gen);

            // Children of u1+u2 (co1, co2, co3)
            const co1Gen = genModel.personGen.get('co1' as PersonId);
            const co2Gen = genModel.personGen.get('co2' as PersonId);
            const co3Gen = genModel.personGen.get('co3' as PersonId);
            expect(co1Gen).toBe(co2Gen);
            expect(co2Gen).toBe(co3Gen);

            // Children of grandparents (u1, p1, u3)
            const u1Gen = genModel.personGen.get('u1' as PersonId);
            const p1Gen = genModel.personGen.get('p1' as PersonId);
            const u3Gen = genModel.personGen.get('u3' as PersonId);
            expect(u1Gen).toBe(p1Gen);
            expect(p1Gen).toBe(u3Gen);
        });

        it('parent siblings (uncles/aunts) have same generation', () => {
            const u1Gen = genModel.personGen.get('u1' as PersonId);
            const p1Gen = genModel.personGen.get('p1' as PersonId);
            const u3Gen = genModel.personGen.get('u3' as PersonId);

            expect(u1Gen).toBe(-1);
            expect(p1Gen).toBe(-1);
            expect(u3Gen).toBe(-1);
        });

        it('cousins have same generation as focus', () => {
            const fGen = genModel.personGen.get('f' as PersonId);
            const co1Gen = genModel.personGen.get('co1' as PersonId);
            const co2Gen = genModel.personGen.get('co2' as PersonId);
            const co3Gen = genModel.personGen.get('co3' as PersonId);
            const co4Gen = genModel.personGen.get('co4' as PersonId);

            expect(co1Gen).toBe(fGen);
            expect(co2Gen).toBe(fGen);
            expect(co3Gen).toBe(fGen);
            expect(co4Gen).toBe(fGen);
            expect(fGen).toBe(0);
        });
    });

    describe('partner consistency', () => {
        it('partners in union always have same generation', () => {
            for (const [unionId, union] of model.unions) {
                const genA = genModel.personGen.get(union.partnerA);
                const genB = union.partnerB ? genModel.personGen.get(union.partnerB) : genA;

                expect(genA).toBeDefined();
                if (union.partnerB) {
                    expect(genB).toBeDefined();
                    expect(genA).toBe(genB);
                }
            }
        });

        it('union generation matches partner generation', () => {
            for (const [unionId, union] of model.unions) {
                const unionGenVal = genModel.unionGen.get(unionId);
                const partnerGenVal = genModel.personGen.get(union.partnerA);

                expect(unionGenVal).toBeDefined();
                expect(partnerGenVal).toBeDefined();
                expect(unionGenVal).toBe(partnerGenVal);
            }
        });
    });

    describe('generation bands', () => {
        it('minGen equals lowest ancestor generation (-3)', () => {
            expect(genModel.minGen).toBe(-3);
        });

        it('maxGen equals highest descendant generation (+2)', () => {
            expect(genModel.maxGen).toBe(2);
        });

        it('genBands contains correct person count per generation', () => {
            // Gen -3: ggp1, ggp2 = 2 persons
            const band_3 = genModel.genBands.get(-3);
            expect(band_3).toBeDefined();
            expect(band_3!.persons.length).toBe(2);

            // Gen -2: gp1, gp2 = 2 persons
            const band_2 = genModel.genBands.get(-2);
            expect(band_2).toBeDefined();
            expect(band_2!.persons.length).toBe(2);

            // Gen -1: u1, u2, p1, p2, u3, u4 = 6 persons
            const band_1 = genModel.genBands.get(-1);
            expect(band_1).toBeDefined();
            expect(band_1!.persons.length).toBe(6);

            // Gen 0: f, fp, s1, co1, co2, co3, co4 = 7 persons
            const band0 = genModel.genBands.get(0);
            expect(band0).toBeDefined();
            expect(band0!.persons.length).toBe(7);

            // Gen +1: c1, c2, c3, c2p = 4 persons
            const bandPlus1 = genModel.genBands.get(1);
            expect(bandPlus1).toBeDefined();
            expect(bandPlus1!.persons.length).toBe(4);

            // Gen +2: gc1 = 1 person
            const bandPlus2 = genModel.genBands.get(2);
            expect(bandPlus2).toBeDefined();
            expect(bandPlus2!.persons.length).toBe(1);
        });

        it('genBands contains correct unions per generation', () => {
            // Gen -3: part_ggp = 1 union
            const band_3 = genModel.genBands.get(-3);
            expect(band_3!.unions.length).toBe(1);

            // Gen -2: part_gp = 1 union
            const band_2 = genModel.genBands.get(-2);
            expect(band_2!.unions.length).toBe(1);

            // Gen -1: part_u1, part_p1, part_u3 = 3 unions
            const band_1 = genModel.genBands.get(-1);
            expect(band_1!.unions.length).toBe(3);

            // Gen 0: part_f = 1 union (plus potentially single-person unions for cousins without partners)
            const band0 = genModel.genBands.get(0);
            expect(band0!.unions.length).toBeGreaterThanOrEqual(1);

            // Gen +1: part_c2 = 1 union (plus potentially single-person unions)
            const bandPlus1 = genModel.genBands.get(1);
            expect(bandPlus1!.unions.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('validation', () => {
        it('validateGenerations returns no errors', () => {
            const errors = validateGenerations(genModel);
            expect(errors).toEqual([]);
        });
    });

    describe('asymmetric branches', () => {
        it('handles deep ancestor branch correctly', () => {
            // 3 generations of ancestors: focus -> parents -> grandparents -> great-grandparents
            const fGen = genModel.personGen.get('f' as PersonId);
            const p1Gen = genModel.personGen.get('p1' as PersonId);
            const gp1Gen = genModel.personGen.get('gp1' as PersonId);
            const ggp1Gen = genModel.personGen.get('ggp1' as PersonId);

            expect(fGen).toBe(0);
            expect(p1Gen).toBe(-1);
            expect(gp1Gen).toBe(-2);
            expect(ggp1Gen).toBe(-3);

            // Verify the chain is consistent
            expect(fGen! - p1Gen!).toBe(1);
            expect(p1Gen! - gp1Gen!).toBe(1);
            expect(gp1Gen! - ggp1Gen!).toBe(1);
        });

        it('handles shallow descendant branch correctly', () => {
            // Only 1 branch goes to gen +2 (gc1 from c2)
            // Other children (c1, c3) have no children

            const c2Gen = genModel.personGen.get('c2' as PersonId);
            const gc1Gen = genModel.personGen.get('gc1' as PersonId);

            expect(c2Gen).toBe(1);
            expect(gc1Gen).toBe(2);

            // Only one person at gen +2
            const bandPlus2 = genModel.genBands.get(2);
            expect(bandPlus2!.persons.length).toBe(1);
            expect(bandPlus2!.persons).toContain('gc1');
        });
    });

    describe('determinism', () => {
        it('produces same generations on repeated calls', () => {
            // Call assignGenerations 5 times
            const results: GenerationalModel[] = [];
            for (let i = 0; i < 5; i++) {
                results.push(assignGenerations({ model, focusPersonId: 'f' as PersonId }));
            }

            // Compare all results to first
            const first = results[0];
            for (let i = 1; i < results.length; i++) {
                const current = results[i];

                // Same personGen values
                expect(current.personGen.size).toBe(first.personGen.size);
                for (const [personId, gen] of first.personGen) {
                    expect(current.personGen.get(personId)).toBe(gen);
                }

                // Same unionGen values
                expect(current.unionGen.size).toBe(first.unionGen.size);
                for (const [unionId, gen] of first.unionGen) {
                    expect(current.unionGen.get(unionId)).toBe(gen);
                }

                // Same minGen/maxGen
                expect(current.minGen).toBe(first.minGen);
                expect(current.maxGen).toBe(first.maxGen);
            }
        });
    });
});
