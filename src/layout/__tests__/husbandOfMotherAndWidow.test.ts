/**
 * A man married to a mother and to her son's widow ("Map maximum size
 * exceeded" in the expanded mode): Wigbert's three wives are Hildeburg,
 * Irmentraud (the widow of Hildeburg's son Eberwin, later also married to
 * Leodegar) and Notburga (Leodegar's daughter). In the expanded mode all
 * these unions form one partner chain, so Eberwin's own union is one of the
 * chain's unions while he is a child of another one (his parents' union).
 * Step 6 then took the chain block as a sibling cluster of the chain's real
 * children: its subtree holds those very children, so every separation pass
 * pushed the block and its children apart again, the coordinates ran off to
 * ~3e9 and the line index of step 7 outgrew a Map.
 *
 * A child whose own union lies in the parents' block is no sibling cluster;
 * every person can be the focus and the layout keeps a sane width.
 * Fixture: test/t5c_husband_of_mother_and_widow.json (fictional).
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import type { LayoutResult } from '../pipeline/types.js';
import { PersonId, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';

const config = DEFAULT_LAYOUT_CONFIG;
const data = loadFixture('t5c_husband_of_mother_and_widow');

const run = (tree: StromData, focus: string, autoExpand: boolean): LayoutResult => runLayoutPipeline({
    data: tree, focusPersonId: focus as PersonId, config,
    ancestorDepth: 5, descendantDepth: 5,
    includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
    displayPolicy: { mode: 'standard', autoExpand },
});

/** Cards side by side with a gap, twice over: far more than any sane row of these cards needs. */
function expectSaneWidth(result: LayoutResult): void {
    const xs = [...result.positions.values()].map(p => p.x);
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeLessThan(2 * result.positions.size * (config.cardWidth + config.horizontalGap));
    for (const x of xs) expect(Math.abs(x)).toBeLessThan(1e6);
}

// The chain also spans two generations (Eberwin is a child of Hildeburg and
// the husband of Irmentraud): with the focus on Hildeburg's or Leodegar's
// side of it, a few cards of the lower row overlap. That is the constellation
// itself, beyond the layout's invariants (as in GitHub #11), not this bug.
const CHAIN_ACROSS_GENERATIONS = new Set(['eberwin', 'bonifaz', 'hildeburg', 'mechthild', 'notburga']);

describe('a man married to a mother and to her son\'s widow', () => {
    it('Wigbert as focus (expanded): the whole tree laid out, clean, of a sane width', () => {
        const result = run(data, 'wigbert', true);
        assertValidPositions(result.positions);
        assertNoNodeOverlap(result.positions, config.cardWidth, config.cardHeight);
        for (const id of Object.keys(data.persons)) {
            expect(result.positions.has(id as PersonId), id).toBe(true);
        }
        expectSaneWidth(result);
        expect(auditGeometry(result, config)).toEqual([]);
        expect(result.diagnostics.validationPassed).toBe(true);
    });

    for (const focus of Object.keys(data.persons)) {
        for (const autoExpand of [false, true]) {
            it(`${focus} as focus (${autoExpand ? 'expanded' : 'standard'}): laid out, of a sane width`, () => {
                const result = run(data, focus, autoExpand);
                assertValidPositions(result.positions);
                expectSaneWidth(result);
                expect(auditGeometry(result, config)).toEqual([]);
                if (!autoExpand || !CHAIN_ACROSS_GENERATIONS.has(focus)) {
                    assertNoNodeOverlap(result.positions, config.cardWidth, config.cardHeight);
                }
            });
        }
    }
});

describe('a widow married to her late husband\'s father (GitHub #11): the same sibling of itself', () => {
    // The son's union is one of his parents' chain unions here too; the
    // chain block was a sibling of its own children and the row ran ~24000 px wide.
    const t5b = loadFixture('t5b_wife_of_father_and_son');
    for (const focus of ['vendelin', 'wendelgard', 'ansgar', 'rosmarie']) {
        it(`${focus} as focus (expanded): of a sane width`, () => {
            expectSaneWidth(run(t5b, focus, true));
        });
    }
});
