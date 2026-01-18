/**
 * routeEdges Unit Tests
 *
 * Tests that routeEdges correctly:
 * - Positions bus Y at midpoint between parent bottom and child top
 * - Prevents bus segments from overlapping at the same Y level
 * - Prevents edge crossings
 * - Creates drops that start at busY and end at childTopY
 *
 * Fixture structure (two sibling families):
 *
 *         GP1 ---+--- GP2                     (gen -1)
 *                |
 *         +------+------+
 *         |             |
 *     U1 -+- U1_spouse  U2 -+- U2_spouse      (gen 0 = focus)
 *         |                 |
 *     +---+---+         +---+---+
 *     |   |   |         |   |   |
 *    C1  C2  C3        C4  C5  C6             (gen +1)
 *
 * GP1+GP2: grandparents with 2 children (u1, u2)
 * U1: sibling 1 with 3 children (C1, C2, C3) -> wide bus
 * U2: sibling 2 with 3 children (C4, C5, C6) -> wide bus
 * Both U1 and U2 at gen 0 -> risk of bus overlap at gen 0->1
 * Focus person: U1
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { assertNoBusOverlap, assertNoEdgeCrossings } from './helpers/assertions.js';
import { buildLayoutModel } from '../pipeline/2-build-model.js';
import { assignGenerations } from '../pipeline/3-assign-generations.js';
import { measureSubtrees } from '../pipeline/4-measure.js';
import { placeX } from '../pipeline/5-place-x.js';
import { applyConstraints } from '../pipeline/6-constraints.js';
import { routeEdges } from '../pipeline/7-route-edges.js';
import { PersonId, PartnershipId, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import { GraphSelection, RoutedModel, UnionId } from '../pipeline/types.js';

describe('routeEdges - bus routing', () => {
    let data: StromData;
    let selection: GraphSelection;
    let routed: RoutedModel;

    // Config values
    const config = DEFAULT_LAYOUT_CONFIG;
    const cardHeight = config.cardHeight;       // 65
    const verticalGap = config.verticalGap;     // 80
    const padding = config.padding;             // 50

    // All person IDs from fixture (12 persons)
    const ALL_PERSON_IDS = [
        'gp1', 'gp2',                           // grandparents (gen -1)
        'u1', 'u1_spouse',                      // union 1 parents (gen 0)
        'u2', 'u2_spouse',                      // union 2 parents (gen 0)
        'c1', 'c2', 'c3',                       // children of U1 (gen +1)
        'c4', 'c5', 'c6'                        // children of U2 (gen +1)
    ] as PersonId[];

    const ALL_PARTNERSHIP_IDS = [
        'part_gp', 'part_u1', 'part_u2'
    ] as PartnershipId[];

    // Helper to calculate Y position for a generation
    const rowHeight = cardHeight + verticalGap;  // 145
    function genY(gen: number, minGen: number): number {
        const row = gen - minGen;
        return padding + row * rowHeight;
    }

    beforeAll(() => {
        data = loadFixture('t7_route_bus');

        // Create selection with all persons
        selection = {
            persons: new Set(ALL_PERSON_IDS),
            partnerships: new Set(ALL_PARTNERSHIP_IDS),
            focusPersonId: 'u1' as PersonId,
            maxAncestorGen: 1,
            maxDescendantGen: 1
        };

        const model = buildLayoutModel({ data, selection, focusPersonId: 'u1' as PersonId });
        const genModel = assignGenerations({ model, focusPersonId: 'u1' as PersonId });
        const measured = measureSubtrees({ genModel, config });
        const placed = placeX({ measured, config });
        const constrained = applyConstraints({ placed, config, maxIterations: 30, tolerance: 0.5 });
        routed = routeEdges({ constrained, config });
    });

    // Helper to get unionGen map
    function getUnionGen(): Map<UnionId, number> {
        return routed.constrained.placed.measured.genModel.unionGen;
    }

    // Helper to get minGen
    function getMinGen(): number {
        return routed.constrained.placed.measured.genModel.minGen;
    }

    describe('bus Y positioning', () => {
        it('bus Y is midpoint between parent bottom and child top', () => {
            const connections = routed.connections;
            const unionGen = getUnionGen();
            const minGen = getMinGen();

            for (const conn of connections) {
                const parentGen = unionGen.get(conn.unionId);
                expect(parentGen).toBeDefined();

                const parentY = genY(parentGen!, minGen);
                const parentBottomY = parentY + cardHeight;
                const childTopY = genY(parentGen! + 1, minGen);
                const expectedBusY = (parentBottomY + childTopY) / 2;

                // branchY should be at the midpoint
                expect(conn.branchY).toBeCloseTo(expectedBusY, 1);
            }
        });

        it('bus Y values are correctly computed based on generation', () => {
            // With minGen=-1:
            // For gen -1 -> 0: parentY=50, parentBottom=115, childTop=195, busY=155
            // For gen 0 -> 1: parentY=195, parentBottom=260, childTop=340, busY=300
            const connections = routed.connections;
            const unionGen = getUnionGen();
            const minGen = getMinGen();

            // minGen should be -1 since we have grandparents
            expect(minGen).toBe(-1);

            for (const conn of connections) {
                const parentGen = unionGen.get(conn.unionId);
                if (parentGen === -1) {
                    // grandparents -> parents bus
                    expect(conn.branchY).toBeCloseTo(155, 1);
                } else if (parentGen === 0) {
                    // parents -> children bus
                    expect(conn.branchY).toBeCloseTo(300, 1);
                }
            }
        });
    });

    describe('bus overlap prevention', () => {
        it('no bus segments overlap at same Y level', () => {
            expect(() => assertNoBusOverlap(routed.connections)).not.toThrow();
        });
    });

    describe('edge crossing prevention', () => {
        it('no edge segments cross', () => {
            expect(() => assertNoEdgeCrossings(routed.connections)).not.toThrow();
        });
    });

    describe('drop positioning', () => {
        it('drops start at busY and end exactly at child top', () => {
            const connections = routed.connections;
            const unionGen = getUnionGen();
            const minGen = getMinGen();

            for (const conn of connections) {
                const parentGen = unionGen.get(conn.unionId);
                expect(parentGen).toBeDefined();

                const childGen = parentGen! + 1;
                const childTopY = genY(childGen, minGen);

                for (const drop of conn.drops) {
                    // Drop starts at bus Y
                    expect(drop.topY).toBe(conn.branchY);
                    // Drop ends at child top Y
                    expect(drop.bottomY).toBe(childTopY);
                }
            }
        });

        it('each connection has correct number of drops for its children', () => {
            const connections = routed.connections;
            const unionGen = getUnionGen();

            // Filter connections at gen 0 (parents with 3 children each)
            const gen0Connections = connections.filter(c => unionGen.get(c.unionId) === 0);

            // Each U1 and U2 connection should have 3 drops
            for (const conn of gen0Connections) {
                expect(conn.drops.length).toBe(3);
            }

            // Grandparents connection (gen -1) should have 2 drops (u1 and u2)
            const gpConnections = connections.filter(c => unionGen.get(c.unionId) === -1);
            for (const conn of gpConnections) {
                expect(conn.drops.length).toBe(2);
            }
        });
    });

    describe('connection structure', () => {
        it('creates 3 connections (grandparents + 2 sibling families)', () => {
            expect(routed.connections.length).toBe(3);
        });

        it('each connection has valid stem coordinates', () => {
            for (const conn of routed.connections) {
                // stemTopY should be parent bottom
                expect(conn.stemTopY).toBeDefined();
                expect(conn.stemTopY).toBeLessThan(conn.stemBottomY);

                // stemX should be defined
                expect(conn.stemX).toBeDefined();
                expect(isFinite(conn.stemX)).toBe(true);
            }
        });

        it('branch extends from leftmost to rightmost child drop', () => {
            for (const conn of routed.connections) {
                if (conn.drops.length === 0) continue;

                const dropXs = conn.drops.map(d => d.x);
                const minDropX = Math.min(...dropXs);
                const maxDropX = Math.max(...dropXs);

                expect(conn.branchLeftX).toBe(minDropX);
                expect(conn.branchRightX).toBe(maxDropX);
            }
        });
    });

    describe('spouse lines', () => {
        it('creates 3 spouse lines (one per union with 2 partners)', () => {
            expect(routed.spouseLines.length).toBe(3);
        });

        it('spouse lines have correct Y position at card center', () => {
            const minGen = getMinGen();
            const unionGen = getUnionGen();

            for (const line of routed.spouseLines) {
                const gen = unionGen.get(line.unionId);
                expect(gen).toBeDefined();

                const lineGenY = genY(gen!, minGen);
                const expectedLineY = lineGenY + cardHeight / 2;

                expect(line.y).toBeCloseTo(expectedLineY, 1);
            }
        });
    });
});
