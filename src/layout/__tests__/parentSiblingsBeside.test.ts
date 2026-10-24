/**
 * The parents' siblings (aunts and uncles) stand beside their sibling, the
 * focus's parent, in the parents' row, also when the focus's own family
 * below is wide.
 *
 * Fixture edge-aunts-wide-family.json (invented): the focus Paula has two
 * marriages with ten children and grandchildren, so the rows below her are
 * far wider than the parents' row. Her father Ivo has three siblings, none
 * with children (Greta married to Hugo); her mother Lena has a sister.
 * Step 5 stood those siblings beyond the full width of Paula's family, so
 * the grandparents' bus ran across the whole tree to them. Now each run of
 * siblings stands next to the parent: the gaps between the cards from the
 * farthest sibling to the parent are no wider than the card gap.
 *
 * Covered: ancestor depths 2, 3 and 5; the standard and expanded modes;
 * depth 1 with "▸ siblings" on the father (his parents shown in place with
 * their children); and the father linked to his parents only in the view (a
 * hypothesis), at depth 2 laid out as the real link, and at depth 1 with his
 * "▸ siblings".
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline, planShownChildrenFolding } from '../pipeline/index.js';
import { assertNoNodeOverlap } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { PersonId, PartnershipId, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import type { LayoutResult } from '../pipeline/types.js';
import type { ViewLink } from '../../view-links.js';

const config = DEFAULT_LAYOUT_CONFIG;
const P = (id: string) => id as PersonId;
const FOCUS = P('fo');
const FATHER = P('fa');
const MOTHER = P('mo');
const FATHER_SIDE = [P('aunt_1'), P('uncle_1'), P('aunt_2'), P('aunt_2_h')];
const MOTHER_SIDE = [P('m_aunt')];

function layout(data: StromData, depth: number, autoExpand: boolean, opts: {
    extraDepthFor?: PersonId[]; shown?: PersonId[]; viewLinks?: ViewLink[];
} = {}): LayoutResult {
    const input = {
        data, focusPersonId: FOCUS, config, ancestorDepth: depth, descendantDepth: 3,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' as const : 'standard' as const, autoExpand },
        ...(opts.extraDepthFor ? { extraDepthFor: opts.extraDepthFor } : {}),
        ...(opts.shown ? { expandChildrenOf: opts.shown } : {}),
        ...(opts.viewLinks ? { viewLinks: opts.viewLinks } : {}),
    };
    return opts.shown ? planShownChildrenFolding(input).result : runLayoutPipeline(input);
}

/**
 * The cards of `parent` and `side` stand as one run in the parent's row:
 * between the farthest of them and the parent, no gap wider than the card gap.
 */
function runBesideParent(r: LayoutResult, parent: PersonId, side: PersonId[]): string[] {
    const failures: string[] = [];
    const pp = r.positions.get(parent);
    if (!pp) return [`${parent} not drawn`];
    const ids = [parent, ...side];
    for (const id of side) if (!r.positions.has(id)) failures.push(`${id} not drawn`);
    if (failures.length) return failures;
    const xs = ids.map(id => r.positions.get(id)!.x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    // Every card of the row inside the run's span, ordered
    const row = [...r.positions].filter(([, p]) => Math.abs(p.y - pp.y) < 1 && p.x >= lo - 0.5 && p.x <= hi + 0.5)
        .sort((a, b) => a[1].x - b[1].x);
    for (let i = 1; i < row.length; i++) {
        const gap = row[i][1].x - row[i - 1][1].x - config.cardWidth;
        if (gap > config.horizontalGap + 0.5) {
            failures.push(`gap of ${gap.toFixed(0)} px between ${row[i - 1][0]} and ${row[i][0]}`);
        }
    }
    return failures;
}

function strict(r: LayoutResult): string[] {
    const failures: string[] = [];
    try { assertNoNodeOverlap(r.positions, config.cardWidth, config.cardHeight); } catch (e) { failures.push(`Overlap: ${(e as Error).message.split('\n')[0]}`); }
    if (!r.diagnostics.validationPassed) failures.push(...r.diagnostics.errors.slice(0, 3).map(e => `Validation: ${e}`));
    failures.push(...auditGeometry(r, config).slice(0, 3).map(v => `Geometry: [${v.type}] ${v.detail}`));
    return failures;
}

/** The fixture with the father cut off his parents (to be linked in the view). */
function withFatherAlone(): StromData {
    const d = loadFixture('edge-aunts-wide-family');
    const u = d.partnerships['u_g' as PartnershipId];
    u.childIds = u.childIds.filter(c => c !== FATHER);
    d.persons[FATHER].parentIds = [];
    for (const g of [P('gf'), P('gm')]) d.persons[g].childIds = d.persons[g].childIds.filter(c => c !== FATHER);
    return d;
}

const HYPO: ViewLink = { hypo: 'H0001', variant: 'A', kind: 'child', anchorId: FATHER, islandIds: [P('gf'), P('gm')], on: true, addedAt: 1 };

describe('The parents\' siblings stand beside the parent over a wide family [edge-aunts-wide-family]', () => {
    const data = loadFixture('edge-aunts-wide-family');
    for (const autoExpand of [false, true]) {
        const mode = autoExpand ? 'expanded' : 'standard';
        for (const depth of [2, 3, 5]) {
            it(`depth ${depth} [${mode}]`, () => {
                const r = layout(data, depth, autoExpand);
                expect([...runBesideParent(r, FATHER, FATHER_SIDE), ...runBesideParent(r, MOTHER, MOTHER_SIDE), ...strict(r)]).toEqual([]);
            });
        }
        it(`depth 1, "▸ siblings" on the father [${mode}]`, () => {
            const r = layout(data, 1, autoExpand, { extraDepthFor: [FATHER], shown: [P('gf'), P('gm')] });
            expect([...runBesideParent(r, FATHER, FATHER_SIDE), ...strict(r)]).toEqual([]);
        });
        it(`depth 2, the father linked to his parents in the view only [${mode}]`, () => {
            const r = layout(withFatherAlone(), 2, autoExpand, { viewLinks: [HYPO] });
            expect([...runBesideParent(r, FATHER, FATHER_SIDE), ...strict(r)]).toEqual([]);
            // As the real link
            const real = layout(data, 2, autoExpand);
            for (const id of [FATHER, ...FATHER_SIDE]) expect(r.positions.get(id)?.x).toBeCloseTo(real.positions.get(id)!.x, 3);
        });
        it(`depth 1, "▸ siblings" on the father linked in the view only [${mode}]`, () => {
            const r = layout(withFatherAlone(), 1, autoExpand, { viewLinks: [HYPO], extraDepthFor: [FATHER], shown: [P('gf'), P('gm')] });
            expect([...runBesideParent(r, FATHER, FATHER_SIDE), ...strict(r)]).toEqual([]);
        });
    }
});
