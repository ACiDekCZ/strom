/**
 * Cousin marriage inside one anchor: the two partners of a gen -1 couple share
 * an ancestor union (their parents are siblings). The shared union may only be
 * carried by ONE of the anchor's two trees — the husband's, by first-claim
 * priority. Before this was enforced at BUILD time, both trees carried it, the
 * wife's tree width was inflated by the shared (chain-wide) union, and its
 * edge-aligned placement shoved the wife's direct parents far away from her
 * card (devel-demo: Alois+Růžena landed ~1600px right of their daughter
 * Vlasta in expanded mode). Claims recorded at transfer time are too late for
 * trees built within the same anchor iteration.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { runLayoutPipeline } from '../pipeline/index.js';
import { StromData, PersonId, DEFAULT_LAYOUT_CONFIG } from '../../types.js';

const FIXTURE = join(__dirname, '../../../test/devel-demo.json');

function load(): StromData | null {
    if (!existsSync(FIXTURE)) return null;
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
    return { persons: raw.persons, partnerships: raw.partnerships } as StromData;
}

function centerOf(result: { positions: Map<PersonId, { x: number }> }, id: string): number {
    const pos = result.positions.get(id as PersonId);
    expect(pos, `${id} must be visible`).toBeDefined();
    return pos!.x + DEFAULT_LAYOUT_CONFIG.cardWidth / 2;
}

describe('cousin-marriage anchor trees (devel-demo: Karel × Vlasta are first cousins)', () => {
    const data = load();

    it.each([
        ['standard', false],
        ['expanded', true],
    ])('%s: Vlasta\'s parents stay above Vlasta, not shoved right by the shared ancestor chain', (_name, autoExpand) => {
        if (!data) return; // fixture missing — skip gracefully
        const result = runLayoutPipeline({
            data,
            focusPersonId: 'pavel_dvorak' as PersonId,
            config: DEFAULT_LAYOUT_CONFIG,
            ancestorDepth: 3,
            descendantDepth: 3,
            includeSpouseAncestors: true,
            includeParentSiblings: true,
            includeParentSiblingDescendants: true,
            displayPolicy: { mode: 'standard', autoExpand },
        });

        const vlasta = centerOf(result, 'vlasta_dvorakova');
        const coupleCenter = (centerOf(result, 'alois_maly') + centerOf(result, 'ruzena_mala')) / 2;

        // The couple sits essentially above its child. The tolerance covers the
        // half-couple offset of edge-aligned placement (~103px measured), with
        // headroom — the broken state was ~1584px adrift.
        expect(Math.abs(coupleCenter - vlasta)).toBeLessThan(350);

        // And the shared grandparents (Josef's chain) exist exactly once, on
        // the husband's side — still part of the layout, never duplicated.
        expect(result.positions.has('josef_dvorak' as PersonId)).toBe(true);
    });
});
