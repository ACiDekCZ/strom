/**
 * Cards of their own heights (custom card "by content", U02 V3).
 *
 * With LayoutConfig.personHeights every card is as tall as its content.
 * A generation stays one horizontal band: the cards stand top-aligned in
 * it and the band is as tall as its tallest card. The bus runs in the
 * middle of the gap between the parent band's bottom and the child band's
 * top; a stem from a card (single parent, a chain's extra partner, a parent
 * beside a hidden "?" stand-in) starts at the bottom of that person's card,
 * a couple's stem on the partner line. X placement does not change.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline, validateLayout } from '../pipeline/index.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { auditBands } from './helpers/bandAudit.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import {
    StromData, Person, Partnership, PersonId, PartnershipId, Gender, LayoutConfig, DEFAULT_LAYOUT_CONFIG,
} from '../../types.js';
import type { LayoutResult, Connection } from '../pipeline/types.js';

function build(): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const P = (id: string, gender: Gender, placeholder = false) => {
        persons[id] = { id: id as PersonId, firstName: placeholder ? '?' : id, lastName: '', gender,
            isPlaceholder: placeholder, parentIds: [], childIds: [], partnerships: [] } as Person;
    };
    const U = (id: string, a: string, b: string, kids: string[]) => {
        partnerships[id] = { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
            childIds: kids as PersonId[], status: 'married' } as Partnership;
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const k of kids) {
            persons[k].parentIds.push(a as PersonId, b as PersonId);
            persons[a].childIds.push(k as PersonId);
            persons[b].childIds.push(k as PersonId);
        }
    };
    ['GF', 'F', 'S', 'A', 'K1', 'K3', 'KS'].forEach(x => P(x, 'male'));
    ['GM', 'W1', 'W2', 'K2', 'KA'].forEach(x => P(x, 'female'));
    P('X', 'male', true);
    U('u0', 'GF', 'GM', ['F', 'S', 'A']);
    U('uf1', 'F', 'W1', ['K1', 'K2']);   // F's marriage chain: W1 ...
    U('uf2', 'F', 'W2', ['K3']);         // ... and W2
    U('ua', 'A', 'X', ['KA']);           // A beside a hidden "?" stand-in
    // S: a single parent without a partnership (shown from KS)
    persons.S.childIds.push('KS' as PersonId);
    persons.KS.parentIds.push('S' as PersonId);
    return { persons, partnerships } as unknown as StromData;
}

const HEIGHTS: Record<string, number> = {
    GF: 100, GM: 150,                                    // first row: band 150
    F: 80, W1: 120, W2: 200, S: 60, A: 90,               // second row: band 200
    K1: 56, K2: 294, K3: 70, KS: 100, KA: 80,            // third row: band 294
};
const heights = new Map(Object.entries(HEIGHTS)) as Map<PersonId, number>;
const v3: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25, personHeights: heights };
const uniform: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, spouseLineY: 25 };

function layout(config: LayoutConfig, autoExpand = true, focus = 'GF'): LayoutResult {
    return runLayoutPipeline({
        data: build(), focusPersonId: focus as PersonId, config,
        ancestorDepth: 3, descendantDepth: 3,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand },
    });
}

const pos = (r: LayoutResult, id: string) => r.positions.get(id as PersonId)!;
const lineTo = (r: LayoutResult, child: string): Connection =>
    r.connections.find(c => c.drops.some(d => d.personId === child))!;

describe('cards of their own heights (U02 V3)', () => {
    const r = layout(v3);

    it('a band is as tall as its tallest card; cards stand top-aligned; verticalGap between bands', () => {
        expect(r.bands!.map(b => [b.generation, b.height])).toEqual([[0, 150], [1, 200], [2, 294]]);
        const [g1, g0, gc] = r.bands!;
        expect(g1.top).toBe(v3.padding);
        expect(g0.top).toBe(g1.top + 150 + v3.verticalGap);
        expect(gc.top).toBe(g0.top + 200 + v3.verticalGap);
        for (const id of ['GF', 'GM']) expect(pos(r, id).y).toBe(g1.top);
        for (const id of ['F', 'W1', 'W2', 'S', 'A']) expect(pos(r, id).y).toBe(g0.top);
        for (const id of ['K1', 'K2', 'K3', 'KA']) expect(pos(r, id).y).toBe(gc.top);
    });

    it('the bus runs in the middle between the parent band bottom and the child band top', () => {
        const [g1, g0] = r.bands!;
        const conn = r.connections.find(c => c.unionId === 'union_GF_GM')!;
        expect(conn.branchY).toBe((g1.top + 150 + g0.top) / 2);
        // Drops end at the children's card tops
        for (const d of conn.drops) expect(d.bottomY).toBe(g0.top);
    });

    it('a couple\'s stem starts on the partner line, spouseLineY below the cards\' top', () => {
        const line = r.spouseLines.find(l => l.unionId === 'union_GF_GM')!;
        expect(line.y).toBe(pos(r, 'GF').y + 25);
        const conn = r.connections.find(c => c.unionId === 'union_GF_GM')!;
        expect(conn.stemTopY).toBe(line.y);
        expect(conn.stemPersonId).toBeUndefined();
    });

    it('a single parent\'s stem starts at the bottom of that parent\'s card, not the band\'s', () => {
        // S has KS without a partnership: drawn from KS's point of view
        const r = layout(v3, true, 'KS');
        expect(r.bands!.find(b => b.generation === -1)!.height).toBe(200);
        const conn = lineTo(r, 'KS');
        expect(conn.stemPersonId).toBe('S');
        expect(conn.stemTopY).toBe(pos(r, 'S').y + 60);
        expect(conn.stemX).toBe(pos(r, 'S').x + v3.cardWidth / 2);
    });

    it('beside a hidden "?" stand-in the stem starts at the known parent\'s card bottom', () => {
        expect(r.positions.has('X' as PersonId)).toBe(false);
        const conn = lineTo(r, 'KA');
        expect(conn.stemPersonId).toBe('A');
        expect(conn.stemTopY).toBe(pos(r, 'A').y + 90);
    });

    it('a chain\'s extra partner leads its children from the bottom of its own card', () => {
        const extra = [lineTo(r, 'K1'), lineTo(r, 'K3')].filter(c => c.stemPersonId);
        expect(extra).toHaveLength(1);
        const conn = extra[0];
        const partner = conn.stemPersonId!;
        expect(['W1', 'W2']).toContain(partner);
        expect(conn.stemX).toBe(pos(r, partner).x + v3.cardWidth / 2);
        expect(conn.stemTopY).toBe(pos(r, partner).y + HEIGHTS[partner]);
        // The partners differ in height: the other one's bottom would be wrong
        const other = partner === 'W1' ? 'W2' : 'W1';
        expect(conn.stemTopY).not.toBe(pos(r, other).y + HEIGHTS[other]);
    });

    it('X placement and bus lanes stay those of uniform cards; the strict audits pass', () => {
        for (const autoExpand of [false, true]) {
            for (const focus of Object.keys(HEIGHTS)) {
                const tall = layout(v3, autoExpand, focus);
                const flat = layout(uniform, autoExpand, focus);
                expect(auditBands(tall, v3, flat), `${focus} ${autoExpand}`).toEqual([]);
                assertValidPositions(tall.positions);
                assertNoNodeOverlap(tall.positions, v3.cardWidth, v3.cardHeight);
                expect(tall.diagnostics.errors).toEqual([]);
                expect(auditGeometry(tall, v3, build()).map(v => `${v.type}: ${v.detail}`)).toEqual([]);
            }
        }
    });

    it('without personHeights every band is cardHeight tall, and equal heights change nothing', () => {
        const flat = layout(uniform);
        expect(flat.bands!.map(b => b.height)).toEqual([64, 64, 64]);
        expect(flat.bands!.map(b => b.top)).toEqual([0, 1, 2].map(i => uniform.padding + i * (64 + uniform.verticalGap)));
        const same = layout({ ...uniform, personHeights: new Map([...heights.keys()].map(id => [id, 64])) });
        expect(same.positions).toEqual(flat.positions);
        expect(same.connections).toEqual(flat.connections);
        expect(same.spouseLines).toEqual(flat.spouseLines);
        expect(same.bands).toEqual(flat.bands);
    });
});

describe('checks with cards of their own heights', () => {
    const a = 'a' as PersonId, b = 'b' as PersonId;
    // b stands below a, inside a's 200 px but below a 64 px card
    const result: LayoutResult = {
        positions: new Map([[a, { x: 0, y: 0 }], [b, { x: 0, y: 150 }]]),
        connections: [], spouseLines: [],
        diagnostics: { totalPersons: 2, totalUnions: 0, generationRange: [0, 0], iterations: 0, validationPassed: true, errors: [] },
    };
    const tallA: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, personHeights: new Map([[a, 200]]) };

    it('validation sees an overlap with a tall card', () => {
        expect(validateLayout(result, DEFAULT_LAYOUT_CONFIG).errors.filter(e => e.startsWith('Card overlap'))).toEqual([]);
        expect(validateLayout(result, tallA).errors.filter(e => e.startsWith('Card overlap'))).toHaveLength(1);
    });

    it('the geometry audit sees a line through the lower part of a tall card', () => {
        const through: LayoutResult = {
            ...result,
            positions: new Map([[a, { x: 0, y: 0 }]]),
            connections: [{
                unionId: 'u' as never, stemX: 90, stemTopY: 100, stemBottomY: 140, branchY: 140,
                branchLeftX: 90, branchRightX: 90, connectorFromX: 90, connectorToX: 90, connectorY: 140, drops: [],
            }],
        };
        const cards = (cfg: LayoutConfig) => auditGeometry(through, cfg).filter(v => v.type === 'line-through-card');
        expect(cards(DEFAULT_LAYOUT_CONFIG)).toEqual([]);
        expect(cards(tallA)).toHaveLength(1);
    });
});
