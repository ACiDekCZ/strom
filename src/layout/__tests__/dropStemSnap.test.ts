/**
 * No small step between a stem and its child's drop (T09).
 *
 * Ancestor branches can push a parent couple a few px off its child's axis
 * (comprehensive: union_father_mother 6.5 px). The drop then comes down in
 * the stem's axis, still on the child's card, instead of stem → 6.5 px of
 * bus → drop.
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { DROP_STEM_SNAP } from '../pipeline/7-route-edges.js';
import { DEFAULT_LAYOUT_CONFIG, PersonId } from '../../types.js';

describe('stem and drop in one axis (T09)', () => {
    const data = loadFixture('comprehensive');

    for (const mode of ['standard', 'expanded'] as const) {
        it(`comprehensive, focus ggp_h_h (${mode}): no connector of a few px`, () => {
            const r = runLayoutPipeline({
                data, focusPersonId: 'ggp_h_h' as PersonId, config: DEFAULT_LAYOUT_CONFIG,
                ancestorDepth: 40, descendantDepth: 40,
                includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
                displayPolicy: { mode, autoExpand: true } as never,
            });
            for (const c of r.connections) {
                const step = Math.abs(c.connectorToX - c.connectorFromX);
                expect(step > 0.5 && step <= DROP_STEM_SNAP, `${c.unionId} step ${step}`).toBe(false);
            }
            const fm = r.connections.find(c => c.unionId === 'union_father_mother')!;
            // The outermost drop comes down in the stem's axis…
            const drop = fm.drops.find(d => Math.abs(d.x - fm.stemX) < 1e-6);
            expect(drop, 'a drop in the stem axis').toBeDefined();
            // …still on its child's card, clear of the rounded corners.
            const childLeft = r.positions.get(drop!.personId)!.x;
            expect(drop!.x).toBeGreaterThan(childLeft + 12);
            expect(drop!.x).toBeLessThan(childLeft + DEFAULT_LAYOUT_CONFIG.cardWidth - 12);
        });
    }
});
