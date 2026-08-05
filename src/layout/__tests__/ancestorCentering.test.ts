/**
 * Ancestor Centering Invariants
 *
 * Invariant 6 says the centre of a parent couple lies above the centre of
 * their children's span. Phase B used to break it systematically: an ancestor
 * subtree was placed by its own bounding box — right edge flush with the
 * husband's card edge — which moves the subtree ROOT by half the width of
 * everything standing above it. The shift repeats every generation and
 * accumulates downward, so a deep line drifted sideways and left an empty band
 * between a child and their own parents (measured on a real 10-generation
 * tree: 2537px between a father and his son, with nothing in between).
 *
 * The harness in allPersonsFull checks overlaps and line geometry, which this
 * drift never violated — the layout was legal, just wrong. These tests measure
 * the distance itself.
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { DEFAULT_LAYOUT_CONFIG, PersonId } from '../../types.js';

const config = DEFAULT_LAYOUT_CONFIG;

/** Worst distance between a stem and the centre of the children it feeds. */
function worstOffset(fixture: string): { offset: number; where: string } {
    const data = loadFixture(fixture);
    let offset = 0;
    let where = '';

    for (const focusPersonId of Object.keys(data.persons) as PersonId[]) {
        for (const mode of ['standard', 'expanded'] as const) {
            const result = runLayoutPipeline({
                data,
                focusPersonId,
                config,
                ancestorDepth: 10,
                descendantDepth: 10,
                includeSpouseAncestors: true,
                includeParentSiblings: true,
                includeParentSiblingDescendants: true,
                displayPolicy: { mode },
            });

            for (const conn of result.connections) {
                // A single child pins the couple exactly: its card centre IS
                // the children's span centre, so any distance is pure drift.
                if (conn.drops.length !== 1) continue;
                const drift = Math.abs(conn.stemX - conn.drops[0].x);
                if (drift > offset) {
                    offset = drift;
                    where = `${fixture} focus=${focusPersonId} mode=${mode}`;
                }
            }
        }
    }
    return { offset, where };
}

describe('ancestor couples stay above the child they belong to', () => {
    it('a ten-generation line stays within half a card of straight', () => {
        // One couple per generation, one child each: nothing forces any
        // sideways movement at all. Before the fix this reached 1339px.
        const { offset, where } = worstOffset('etalon-line-10gen');
        expect(offset, where).toBeLessThanOrEqual(config.cardWidth / 2 + config.partnerGap);
    });

    it('a tree deep in both directions keeps its couples near their children', () => {
        // Here both branches of a couple carry ancestors, so the side rule
        // (paternal left, maternal right) legitimately moves couples apart.
        // The bound only rules out the runaway drift: 1545px before the fix.
        const { offset, where } = worstOffset('etalon-deep-both');
        expect(offset, where).toBeLessThan(1200);
    });
});
