/**
 * Lines of a marriage chain never merge (T14).
 *
 * In a marriage chain the far spouse line runs past the nearer partner's
 * card over the same gap as the near line. Every set of spouse lines that
 * overlap in X in one generation is fanned out with a visible spacing, so
 * each marriage keeps its own line whatever the order of the unions.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline } from '../pipeline/index.js';
import { SPOUSE_LINE_SPACING } from '../pipeline/7-route-edges.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import type { LayoutResult } from '../pipeline/types.js';

type U = [id: string, a: string, b: string, kids: string[]];

function build(unions: U[]): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const P = (id: string, gender: Gender) => {
        persons[id] = { id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [] } as Person;
    };
    ['GF', 'F', 'A', 'B', 'K1', 'K2', 'K3', 'KA1', 'KA2', 'KA3', 'KB1', 'KB2'].forEach(x => P(x, 'male'));
    ['GM', 'W1', 'W2', 'W3', 'A1', 'A2', 'A3', 'B1', 'B2'].forEach(x => P(x, 'female'));
    for (const [id, a, b, kids] of unions) {
        partnerships[id] = { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
            childIds: kids as PersonId[], status: 'married' } as Partnership;
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const k of kids) {
            persons[k].parentIds.push(a as PersonId, b as PersonId);
            persons[a].childIds.push(k as PersonId);
            persons[b].childIds.push(k as PersonId);
        }
    }
    return { persons, partnerships } as unknown as StromData;
}

// F and his brother A have three wives each, B two: three chains in one row.
// With three partners two of them sit on one side, so the far line runs over
// the near partner's gap.
const UNIONS: U[] = [
    ['u0', 'GF', 'GM', ['A', 'F', 'B']],
    ['uf1', 'F', 'W1', ['K1']],
    ['uf2', 'F', 'W2', ['K2']],
    ['uf3', 'F', 'W3', ['K3']],
    ['ua1', 'A', 'A1', ['KA1']],
    ['ua2', 'A', 'A2', ['KA2']],
    ['ua3', 'A', 'A3', ['KA3']],
    ['ub1', 'B', 'B1', ['KB1']],
    ['ub2', 'B', 'B2', ['KB2']],
];

// Unions are ordered by partnership id, so renaming them reorders the
// spouse lines: grouped per person, and interleaved between F and A.
const INTERLEAVED: Record<string, string> = {
    u0: 'p0', uf1: 'p1', ua1: 'p2', uf2: 'p3', ua2: 'p4', uf3: 'p5', ua3: 'p6', ub1: 'p7', ub2: 'p8',
};
const INTERLEAVED_REV: Record<string, string> = {
    u0: 'p0', ua1: 'p1', uf1: 'p2', ua3: 'p3', uf3: 'p4', ua2: 'p5', uf2: 'p6', ub2: 'p7', ub1: 'p8',
};

function layout(unions: U[]): LayoutResult {
    return runLayoutPipeline({
        data: build(unions), focusPersonId: 'F' as PersonId, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 1, descendantDepth: 1,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'expanded', autoExpand: true } as never,
    });
}

const rename = (map: Record<string, string>): U[] => UNIONS.map(([id, a, b, k]) => [map[id], a, b, k]);

const ORDERS: [string, U[]][] = [
    ['grouped ids', UNIONS],
    ['grouped ids, reversed list', [...UNIONS].reverse()],
    ['interleaved ids', rename(INTERLEAVED)],
    ['interleaved ids, other order', rename(INTERLEAVED_REV)],
    ['interleaved ids, reversed list', rename(INTERLEAVED).reverse()],
];

describe('spouse lines of a marriage chain (T14)', () => {
    it('spacing is visible', () => {
        expect(SPOUSE_LINE_SPACING).toBeGreaterThanOrEqual(5);
    });

    for (const [name, order] of ORDERS) {
        it(`overlapping spouse lines are ≥5 px apart (${name})`, () => {
            const r = layout(order);
            const lines = r.spouseLines;
            // All three chains are drawn: 8 marriage lines + the grandparents.
            expect(lines.length).toBe(9);
            const cardH = DEFAULT_LAYOUT_CONFIG.cardHeight;
            let overlaps = 0;
            for (let i = 0; i < lines.length; i++) {
                for (let j = i + 1; j < lines.length; j++) {
                    const a = lines[i], b = lines[j];
                    if (Math.abs(a.y - b.y) > cardH / 2) continue; // other generation
                    if (!(a.xMax > b.xMin && b.xMax > a.xMin)) continue;
                    overlaps++;
                    expect(Math.abs(a.y - b.y), `${a.unionId} vs ${b.unionId}`).toBeGreaterThanOrEqual(5);
                }
            }
            // One overlapping pair in each of F's and A's chains.
            expect(overlaps).toBe(2);
        });
    }

    it("the nearest partner's line is the lowest and a couple's stem starts on its line", () => {
        const r = layout(UNIONS);
        for (const [far, near] of [['union_F_W3', 'union_F_W2'], ['union_A_A3', 'union_A_A2']] as const) {
            const f = r.spouseLines.find(l => l.unionId === far)!;
            const n = r.spouseLines.find(l => l.unionId === near)!;
            expect(f.xMax - f.xMin).toBeGreaterThan(n.xMax - n.xMin);
            expect(n.y - f.y).toBeCloseTo(SPOUSE_LINE_SPACING, 6);
        }
        for (const conn of r.connections) {
            const sl = r.spouseLines.find(l => l.unionId === conn.unionId);
            const midX = sl ? (sl.xMin + sl.xMax) / 2 : NaN;
            if (sl && Math.abs(conn.stemX - midX) < 1) expect(conn.stemTopY, String(conn.unionId)).toBeCloseTo(sl.y, 6);
        }
    });
});

describe('the partner line at the header of a taller card (U02)', () => {
    const run = (config: typeof DEFAULT_LAYOUT_CONFIG) => runLayoutPipeline({
        data: build(UNIONS), focusPersonId: 'F' as PersonId, config,
        ancestorDepth: 1, descendantDepth: 1,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'expanded', autoExpand: true } as never,
    });

    it('runs spouseLineY below the card top instead of the middle, the couple\'s stem with it; nothing else moves', () => {
        const tall = { ...DEFAULT_LAYOUT_CONFIG, cardHeight: 160 };
        const middle = run(tall);
        const head = run({ ...tall, spouseLineY: 25 });
        expect(head.positions).toEqual(middle.positions);
        const couple = (r: LayoutResult) => r.spouseLines.find(l => l.unionId === 'union_GF_GM')!;
        const top = head.positions.get('GF' as PersonId)!.y;
        expect(couple(middle).y).toBe(top + 80);
        expect(couple(head).y).toBe(top + 25);
        // Fanned-out chain lines keep their spacing around the header line.
        for (const [a, b] of [['union_F_W3', 'union_F_W2']] as const) {
            const la = head.spouseLines.find(l => l.unionId === a)!, lb = head.spouseLines.find(l => l.unionId === b)!;
            expect(lb.y - la.y).toBeCloseTo(SPOUSE_LINE_SPACING, 6);
            expect(Math.abs((la.y + lb.y) / 2 - (head.positions.get('F' as PersonId)!.y + 25))).toBeLessThan(SPOUSE_LINE_SPACING);
        }
        const stem = head.connections.find(c => c.unionId === 'union_GF_GM')!;
        expect(stem.stemTopY).toBe(top + 25);
        expect(stem.branchY).toBe(middle.connections.find(c => c.unionId === 'union_GF_GM')!.branchY);
    });
});
