/**
 * The dense spacing (Settings → Spacing → Dense): its layout configuration,
 * and the bus lanes it keeps at most one lane off a gap's middle — a gap
 * whose lines need more lanes grows by 2 * LANE_OFFSET per further level.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadFixture } from './helpers/loadFixture.js';
import { auditBusClearance } from './helpers/busClearance.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { denseGapExtra, LANE_OFFSET } from '../pipeline/7-route-edges.js';
import type { Connection, LayoutResult } from '../pipeline/types.js';
import { DEFAULT_LAYOUT_CONFIG, DENSE_LAYOUT_CONFIG, LayoutConfig, PersonId, layoutConfigFor } from '../../types.js';

describe('layoutConfigFor', () => {
    it('normal is the default configuration, value for value', () => {
        expect(layoutConfigFor('normal')).toEqual(DEFAULT_LAYOUT_CONFIG);
        expect(DEFAULT_LAYOUT_CONFIG.dense).toBeUndefined();
    });

    it('dense: the same cards with gaps 20 / 48 / 14', () => {
        expect(layoutConfigFor('dense')).toEqual({
            ...DEFAULT_LAYOUT_CONFIG, horizontalGap: 20, verticalGap: 48, partnerGap: 14, dense: true,
        });
        expect(DENSE_LAYOUT_CONFIG.partnerGap).toBeGreaterThanOrEqual(DENSE_LAYOUT_CONFIG.horizontalGap / 2);
    });
});

describe('denseGapExtra', () => {
    const span = (lanes: Array<[number, number]>) => ({
        lanes: lanes.map(([gen, lane]) => ({ conn: {} as Connection, gen, lane })),
    });

    it('lanes up to one off the middle need no room: 0..2 lanes below lane 0', () => {
        expect(denseGapExtra(span([[0, 0], [0, 1], [1, 2], [2, 0]])).size).toBe(0);
    });

    it('every further level grows only that gap by 2 * LANE_OFFSET', () => {
        const extra = denseGapExtra(span([[-1, 3], [0, 1], [1, 4], [2, 5], [3, 6]]));
        expect([...extra].sort((a, b) => a[0] - b[0])).toEqual([
            [-1, 2 * LANE_OFFSET], [1, 2 * LANE_OFFSET], [2, 4 * LANE_OFFSET], [3, 4 * LANE_OFFSET],
        ]);
        expect(LANE_OFFSET).toBe(8);
    });
});

/** Lane of every line: its offset from the middle of its gap, in lanes. */
function lanesOffMiddle(result: LayoutResult): number[] {
    const bands = result.bands ?? [];
    return result.connections.map(c => {
        const below = bands.findIndex(b => Math.abs(b.top - c.drops[0].bottomY) < 0.01);
        const above = bands[below - 1];
        const mid = (above.top + above.height + bands[below].top) / 2;
        return (c.branchY - mid) / LANE_OFFSET;
    });
}

const FIXTURE = 'edge-ancestor-children';
describe.skipIf(!existsSync(join(process.cwd(), 'test', `${FIXTURE}.json`)))('dense spacing: a gap with four bus lanes', () => {
    // Four lines in the gap below the great-grandparents (lanes 0..3)
    const data = loadFixture(FIXTURE);
    const run = (config: LayoutConfig) => runLayoutPipeline({
        data, focusPersonId: 'f_m_f_m' as PersonId, config,
        ancestorDepth: 5, descendantDepth: 5,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand: true },
    });

    it('grows only that gap, by 16 px, and keeps every bus 16 px from the cards', () => {
        const dense = run(DENSE_LAYOUT_CONFIG);
        expect([...(dense.gapExtra ?? [])]).toEqual([[-2, 16]]);
        const bands = dense.bands!;
        for (let i = 1; i < bands.length; i++) {
            const gap = bands[i].top - (bands[i - 1].top + bands[i - 1].height);
            expect(gap).toBe(bands[i - 1].generation === -2 ? 64 : 48);
        }
        expect(auditBusClearance(dense, DENSE_LAYOUT_CONFIG, 16)).toEqual([]);
        // At most one lane above the middle; the fourth lane two below it
        const lanes = lanesOffMiddle(dense);
        expect(Math.min(...lanes)).toBe(-1);
        expect(Math.max(...lanes)).toBe(2);
    });

    it('the normal spacing has no lane cap: the same tree, no gap grown', () => {
        const normal = run(DEFAULT_LAYOUT_CONFIG);
        expect(normal.gapExtra).toBeUndefined();
        expect(Math.max(...lanesOffMiddle(normal))).toBe(3);
        expect(Math.min(...lanesOffMiddle(normal))).toBe(0);
    });
});

const FIXTURE_3 = 'edge-ancestor-far-children';
describe.skipIf(!existsSync(join(process.cwd(), 'test', `${FIXTURE_3}.json`)))('dense spacing: a gap with three bus lanes', () => {
    const data = loadFixture(FIXTURE_3);
    const run = (config: LayoutConfig) => runLayoutPipeline({
        data, focusPersonId: 'ff' as PersonId, config,
        ancestorDepth: 5, descendantDepth: 5,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand: true },
    });

    it('keeps 48 px: one lane above the middle, one below', () => {
        const dense = run(DENSE_LAYOUT_CONFIG);
        expect(dense.gapExtra).toBeUndefined();
        const lanes = lanesOffMiddle(dense);
        expect(Math.min(...lanes)).toBe(-1);
        expect(Math.max(...lanes)).toBe(1);
        expect(auditBusClearance(dense, DENSE_LAYOUT_CONFIG, 16)).toEqual([]);
        // The normal spacing keeps its lanes below the middle
        expect(Math.min(...lanesOffMiddle(run(DEFAULT_LAYOUT_CONFIG)))).toBe(0);
    });
});
