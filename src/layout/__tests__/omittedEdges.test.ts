/**
 * Lines that cannot be routed are left out (step 7, omitUnroutableDrops):
 * a parent-child line that would cross, run along or touch lines of other
 * families is not drawn, the child's card links to its parents and the
 * parents' cards to the child (LayoutResult.omittedEdges). One child's drop
 * at a time; the whole line goes only with its last child; never a line of
 * the focus's own line when another helps.
 *
 * Also the shared line geometry (line-geometry.ts) and the built-in
 * validation that now checks every line, not just bus against bus.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { runLayoutPipeline } from '../pipeline/index.js';
import { validateLayout } from '../pipeline/validation.js';
import {
    LineSegment, segmentPairViolation, findLineViolations, SegmentIndex
} from '../pipeline/line-geometry.js';
import { Connection, LayoutModel, LayoutResult, SpouseLine, UnionId } from '../pipeline/types.js';
import { omitUnroutableDrops, sharedLaneOverlaps } from '../pipeline/7-route-edges.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { syntheticPersonHeights } from './helpers/bandAudit.js';
import { loadFixture } from './helpers/loadFixture.js';
import { DEFAULT_LAYOUT_CONFIG, LayoutConfig, Person, PartnershipId, PersonId, StromData } from '../../types.js';

function layout(data: StromData, focus: string, expanded: boolean, depth = 5, config: LayoutConfig = DEFAULT_LAYOUT_CONFIG): LayoutResult {
    return runLayoutPipeline({
        data,
        focusPersonId: focus as PersonId,
        config,
        ancestorDepth: depth,
        descendantDepth: depth,
        includeSpouseAncestors: true,
        includeParentSiblings: true,
        includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand: expanded },
    });
}

const edges = (r: LayoutResult) => (r.omittedEdges ?? []).map(e => `${e.unionId} -> ${e.childId}`);
const lineViolations = (r: LayoutResult) => auditGeometry(r, DEFAULT_LAYOUT_CONFIG).filter(v => v.type !== 'line-through-card');

describe('etalon O: half-sisters married into two branches (the reported knot)', () => {
    const data = loadFixture('etalon-half-sisters');
    const LONE_FATHER = 'union_eO_half_fa_eO_half_ph';

    it.each(['eO_focus', 'eO_line2', 'eO_gen5'])('focus %s, expanded: exactly the line of the father alone is left out', (focus) => {
        const r = layout(data, focus, true, 8);
        expect(edges(r)).toEqual([`${LONE_FATHER} -> eO_gen6_w1`]);
        const edge = r.omittedEdges![0];
        // The "?" stand-in is no shown parent; the line left the father's card
        expect(edge.parentIds).toEqual(['eO_half_fa']);
        expect(edge.stemPersonId).toBe('eO_half_fa');
        // Its only child: the whole line is gone, every other line drawn clean
        expect(r.connections.some(c => c.unionId === LONE_FATHER)).toBe(false);
        expect(lineViolations(r)).toEqual([]);
        expect(r.diagnostics.errors).toEqual([]);
        // Both ends keep their cards
        expect(r.positions.has('eO_gen6_w1' as PersonId)).toBe(true);
        expect(r.positions.has('eO_half_fa' as PersonId)).toBe(true);
    });

    it('standard mode: the first wife is not drawn, nothing is left out', () => {
        const r = layout(data, 'eO_focus', false, 8);
        expect(r.omittedEdges).toBeUndefined();
        expect(lineViolations(r)).toEqual([]);
    });

    it('cards of their own heights leave out the same line', () => {
        const ids = Object.keys(data.persons) as PersonId[];
        const v3: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: syntheticPersonHeights(ids) };
        for (const focus of ['eO_focus', 'eO_line3', 'eO_gen5']) {
            expect(edges(layout(data, focus, true, 8, v3))).toEqual(edges(layout(data, focus, true, 8)));
        }
    });
});

describe('real-large: the in-law column inside the grandparents\' bus', () => {
    const file = join(process.cwd(), 'test', 'real-large.json');
    const data = existsSync(file) ? loadFixture('real-large') : null;
    const FOCUS = 'p_1783746448938_6w3g1';
    const GRANDPARENTS = 'union_p_1783746448938_jrgvs_p_1783746448938_m3cf5';
    const UNCLE = 'p_1783746448938_48fqk';

    it.each([['standard', false], ['expanded', true]])('%s: only the drop to the father\'s brother is left out', (_mode, expanded) => {
        if (!data) return; // local fixture missing — skip gracefully
        const r = layout(data, FOCUS, expanded as boolean);
        expect(edges(r)).toEqual([`${GRANDPARENTS} -> ${UNCLE}`]);
        // The grandparents keep their line to the focus's father, its bus
        // recomputed from the remaining drops
        const conn = r.connections.find(c => c.unionId === GRANDPARENTS)!;
        expect(conn).toBeDefined();
        expect(conn.drops.map(d => d.personId)).not.toContain(UNCLE);
        expect(conn.branchLeftX).toBe(Math.min(...conn.drops.map(d => d.x)));
        expect(conn.branchRightX).toBe(Math.max(...conn.drops.map(d => d.x)));
        expect(r.omittedEdges![0].parentIds).toHaveLength(2);
        expect(lineViolations(r)).toEqual([]);
        expect(r.diagnostics.validationPassed).toBe(true);
    });
});

describe('the focus\'s own line keeps its lines', () => {
    it('etalon J (in-law loop), focus eJ_focus: the partner\'s sibling\'s drop goes, not the focus\'s', () => {
        const data = loadFixture('etalon-inlaw-loop');
        for (const expanded of [false, true]) {
            const r = layout(data, 'eJ_focus', expanded);
            // Both drops would clear the crossing; the focus's own one stays
            expect(edges(r)).toEqual(['union_eJ_p_fa_eJ_p_mo -> eJ_partner_sib']);
            expect(lineViolations(r)).toEqual([]);
        }
    });

    it('etalon I (double in-law): one drop of the two cross-married families, off the focus\'s line', () => {
        const data = loadFixture('etalon-double-inlaw');
        const r = layout(data, 'eI_bro1', false);
        expect(edges(r)).toEqual(['union_eI_c_fa_eI_c_mo -> eI_sis2']);
        // A line of two children keeps its other drop
        expect(r.connections.find(c => c.unionId === 'union_eI_c_fa_eI_c_mo')!.drops.map(d => d.personId)).toEqual(['eI_sis1']);
        expect(lineViolations(r)).toEqual([]);
    });
});

// ==================== line geometry ====================

const H = (x1: number, x2: number, y: number, owner: string, kind: LineSegment['kind'] = 'bus'): LineSegment =>
    ({ x1, y1: y, x2, y2: y, owner, kind, label: `${kind}-${owner}` });
const V = (x: number, y1: number, y2: number, owner: string, kind: LineSegment['kind'] = 'drop'): LineSegment =>
    ({ x1: x, y1, x2: x, y2, owner, kind, label: `${kind}-${owner}` });

/**
 * `n` pairs of siblings among the focus's children, each pair's children
 * married to each other twice (double first cousins): every pair is a forced
 * knot of two cross-married families, so `n` lines have to go.
 */
function doubleCousins(n: number): StromData {
    const d = { persons: {}, partnerships: {} } as unknown as StromData;
    const person = (id: string, gender: 'male' | 'female', birthDate?: string): PersonId => {
        d.persons[id as PersonId] = { id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...(birthDate ? { birthDate } : {}) } as Person;
        return id as PersonId;
    };
    const family = (id: string, a: PersonId, b: PersonId, children: PersonId[]): void => {
        d.partnerships[id as PartnershipId] = { id: id as PartnershipId, person1Id: a, person2Id: b, childIds: [...children], status: 'married' };
        d.persons[a].partnerships.push(id as PartnershipId);
        d.persons[b].partnerships.push(id as PartnershipId);
        for (const c of children) {
            d.persons[c].parentIds.push(a, b);
            d.persons[a].childIds.push(c);
            d.persons[b].childIds.push(c);
        }
    };
    const root = person('root', 'male'), rootWife = person('root_wife', 'female');
    const kids: PersonId[] = [];
    for (let k = 1; k <= n; k++) {
        const i = String(k).padStart(2, '0');
        const son = person(`son${i}`, 'male', `19${i}-01-01`), daughter = person(`daughter${i}`, 'female', `19${i}-06-01`);
        kids.push(son, daughter);
        const b1 = person(`grandson${i}a`, 'male', '1950-01-01'), b2 = person(`grandson${i}b`, 'male', '1952-01-01');
        const s1 = person(`granddaughter${i}a`, 'female', '1950-06-01'), s2 = person(`granddaughter${i}b`, 'female', '1952-06-01');
        family(`u_son${i}`, son, person(`son${i}_wife`, 'female'), [b1, b2]);
        family(`u_daughter${i}`, person(`daughter${i}_husband`, 'male'), daughter, [s1, s2]);
        family(`u_cousins${i}a`, b1, s1, []);
        family(`u_cousins${i}b`, b2, s2, []);
    }
    family('u_root', root, rootWife, kids);
    return d;
}

describe('nothing is left drawn wrong after step 7, however many lines have to go', () => {
    it.each([false, true])('twelve forced knots in one view: twelve lines left out, all others clean (expanded %s)', (expanded) => {
        const r = layout(doubleCousins(12), 'root', expanded);
        // Once capped at ten: two knots stayed drawn
        expect(r.omittedEdges).toHaveLength(12);
        expect(lineViolations(r)).toEqual([]);
        expect(sharedLaneOverlaps(r.connections)).toEqual([]);
        expect(r.diagnostics.errors).toEqual([]);
        // One drop per knot: every family keeps its line to the other child
        const unions = new Set(r.omittedEdges!.map(e => e.unionId));
        expect(unions.size).toBe(12);
        for (const u of unions) expect(r.connections.some(c => c.unionId === u)).toBe(true);
    });

    it.each([false, true])('stress NC: the two lines the lane allocation left on the bus\'s lane are left out (expanded %s)', (expanded) => {
        const r = layout(loadFixture('etalon-stress-all'), 'eNC_gk10_1', expanded);
        expect(edges(r)).toEqual(['union_eNB_FF_eNB_FM -> eNB_F', 'union_eNB_MF_eNB_MM -> eNB_M']);
        expect(sharedLaneOverlaps(r.connections)).toEqual([]);
        expect(lineViolations(r)).toEqual([]);
    });

    // Two hand-made lines: A's stem comes down through B's connector, and
    // neither family's drops reach it, so no single drop helps
    const model = { persons: new Map(), unions: new Map(), childToParentUnion: new Map() } as unknown as LayoutModel;
    const line = (unionId: string, stemX: number, y: number, dropXs: number[]): Connection => {
        const left = Math.min(...dropXs), right = Math.max(...dropXs);
        return {
            unionId: unionId as UnionId, stemX, stemTopY: y - 40, stemBottomY: y, branchY: y,
            branchLeftX: left, branchRightX: right, connectorFromX: stemX,
            connectorToX: stemX < left ? left : stemX > right ? right : stemX, connectorY: y,
            drops: dropXs.map((x, i) => ({ personId: `${unionId}_kid${i}` as PersonId, x, topY: y, bottomY: 100 })),
        };
    };

    it('when no single drop helps, the whole line of one family goes', () => {
        const connections = [line('uA', 100, 60, [110, 130]), line('uB', 150, 40, [0, 90])];
        const omitted = omitUnroutableDrops(connections, [], model, new Map(), undefined, () => {});
        expect(omitted.map(e => `${e.unionId} -> ${e.childId}`)).toEqual(['uA -> uA_kid0', 'uA -> uA_kid1']);
        expect(connections.map(c => c.unionId)).toEqual(['uB']);
    });

    it('a knot step 7 cannot resolve is an error under test', () => {
        const spouse = (unionId: string, xMin: number, xMax: number): SpouseLine => ({
            unionId: unionId as UnionId, person1Id: `${unionId}_a` as PersonId, person2Id: `${unionId}_b` as PersonId,
            partnershipId: null, y: 50, xMin, xMax,
        });
        // Two partner lines merged at one height: no parent-child line to leave out
        expect(() => omitUnroutableDrops([], [spouse('u1', 0, 100), spouse('u2', 50, 150)], model, new Map(), undefined, () => {}))
            .toThrow(/Step 7 left 1 line violation/);
    });
});

describe('line geometry', () => {
    it('crossing, collinear run and T-touch between different unions', () => {
        expect(segmentPairViolation(H(0, 100, 50, 'a'), V(50, 0, 100, 'b'))?.type).toBe('crossing');
        expect(segmentPairViolation(H(0, 100, 50, 'a'), H(80, 200, 50, 'b'))?.type).toBe('collinear');
        expect(segmentPairViolation(V(10, 0, 100, 'a'), V(10, 90, 200, 'b'))?.type).toBe('collinear');
        expect(segmentPairViolation(H(0, 100, 50, 'a'), V(50, 50, 100, 'b'))?.type).toBe('t-touch');
        expect(segmentPairViolation(H(0, 50, 50, 'a'), V(50, 0, 100, 'b'))?.type).toBe('t-touch');
    });

    it('no violation: one union, lanes apart, runs end to end, apart', () => {
        expect(segmentPairViolation(H(0, 100, 50, 'a'), V(50, 0, 100, 'a'))).toBeNull();
        expect(segmentPairViolation(H(0, 100, 50, 'a'), H(0, 100, 58, 'b'))).toBeNull();
        expect(segmentPairViolation(H(0, 100, 50, 'a'), H(100, 200, 50, 'b'))).toBeNull();
        expect(segmentPairViolation(H(0, 100, 50, 'a'), V(150, 0, 100, 'b'))).toBeNull();
    });

    it('the grid finds exactly the violations of every pair', () => {
        // Deterministic pseudo-random lines over a wide area (long buses, short drops)
        let seed = 7;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const segs: LineSegment[] = [];
        for (let i = 0; i < 400; i++) {
            const owner = `u${Math.floor(rnd() * 120)}`;
            const y = Math.round(rnd() * 12) * 40 + (rnd() < 0.3 ? 8 : 0);
            const x = Math.round(rnd() * 6000) - 1000;
            if (rnd() < 0.5) segs.push(H(x, x + Math.round(rnd() * 1500), y, owner));
            else segs.push(V(x, y, y + 20 + Math.round(rnd() * 60), owner));
        }
        const brute: string[] = [];
        for (let i = 0; i < segs.length; i++) {
            for (let j = i + 1; j < segs.length; j++) {
                const v = segmentPairViolation(segs[i], segs[j]);
                if (v) brute.push(`${i}/${j}/${v.type}`);
            }
        }
        const grid = findLineViolations(segs).map(v => `${segs.indexOf(v.a)}/${segs.indexOf(v.b)}/${v.type}`);
        expect(brute.length).toBeGreaterThan(20);
        expect(grid).toEqual(brute);
        // One segment against the index
        const index = new SegmentIndex(segs);
        const probe = V(500, 0, 600, 'probe');
        expect(index.countViolationsWith(probe, 'probe')).toBe(segs.filter(s => segmentPairViolation(s, probe)).length);
    });
});

describe('built-in validation checks every line', () => {
    const conn = (unionId: string, stemX: number, dropX: number, y: number): Connection => ({
        unionId: unionId as UnionId, stemX, stemTopY: y - 40, stemBottomY: y, branchY: y,
        branchLeftX: dropX, branchRightX: dropX, connectorFromX: stemX, connectorToX: dropX, connectorY: y,
        drops: [{ personId: `${unionId}_kid` as PersonId, x: dropX, topY: y, bottomY: y + 40 }],
    });
    const result = (connections: Connection[]): LayoutResult => ({
        positions: new Map(connections.map((c, i) => [c.drops[0].personId, { x: 100 + i * 400, y: 200 }])),
        connections, spouseLines: [],
        diagnostics: { totalPersons: 0, totalUnions: 0, generationRange: [0, 0], iterations: 0, validationPassed: true, errors: [] },
    });

    it('two connectors merged at one height (once invisible to the bus-only check)', () => {
        const r = result([conn('a', 1600, 260, 154), conn('b', 900, 460, 154)]);
        const errors = validateLayout(r, DEFAULT_LAYOUT_CONFIG).errors;
        expect(errors.some(e => e.startsWith('Line collinear:'))).toBe(true);
    });

    it('an omitted line must reference shown cards', () => {
        const r = result([conn('a', 100, 160, 154)]);
        r.omittedEdges = [{ unionId: 'x' as UnionId, childId: 'nobody' as PersonId, parentIds: ['ghost' as PersonId] }];
        const errors = validateLayout(r, DEFAULT_LAYOUT_CONFIG).errors;
        expect(errors).toContain('Omitted line references missing child: nobody');
        expect(errors).toContain('Omitted line references missing parent: ghost');
    });
});
