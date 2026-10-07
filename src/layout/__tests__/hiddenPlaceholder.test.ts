/**
 * An empty "?" stand-in is not drawn (T11).
 *
 * A family of one known parent keeps a "?" stand-in for the other parent in
 * the data. The diagram leaves the empty card out and leads the children
 * from the bottom of the known parent's card — alone (a single parent) or
 * beside a real marriage of that parent (a chain). The data is unchanged.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline } from '../pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import type { LayoutResult } from '../pipeline/types.js';

const config = DEFAULT_LAYOUT_CONFIG;

interface Spec {
    marriage?: boolean;      // M also married to H (children K2, K4, K5)
    secondStandIn?: boolean; // a second "?" family of M (child K3)
    namedStandIn?: boolean;  // the stand-in has a name: a person, drawn
}

function build(spec: Spec): StromData {
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
    ['GF', 'S', 'K1', 'K3', 'K4', 'H'].forEach(x => P(x, 'male'));
    ['GM', 'M', 'K2', 'K5'].forEach(x => P(x, 'female'));
    P('X', 'male', true);
    if (spec.namedStandIn) persons.X.firstName = 'Adam';
    U('u0', 'GF', 'GM', ['M', 'S']);
    U('ux', 'M', 'X', ['K1']);
    if (spec.secondStandIn) {
        P('X2', 'male', true);
        U('ux2', 'M', 'X2', ['K3']);
    }
    if (spec.marriage) U('uh', 'M', 'H', ['K2', 'K4', 'K5']);
    return { persons, partnerships } as unknown as StromData;
}

const MODES = [
    { name: 'standard', displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded', displayPolicy: { mode: 'standard' as const, autoExpand: true } },
];

function layout(data: StromData, focus: string, displayPolicy: typeof MODES[number]['displayPolicy']): LayoutResult {
    return runLayoutPipeline({
        data, focusPersonId: focus as PersonId, config,
        ancestorDepth: 5, descendantDepth: 5,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy,
    });
}

/** Overlaps, validation and the strict geometry audit, as in the all-persons harness. */
function expectSound(r: LayoutResult, data: StromData): void {
    assertValidPositions(r.positions);
    assertNoNodeOverlap(r.positions, config.cardWidth, config.cardHeight);
    expect(r.diagnostics.errors).toEqual([]);
    expect(auditGeometry(r, config, data).map(v => `${v.type}: ${v.detail}`)).toEqual([]);
}

/** The line to `child` starts at the bottom centre of M's card. */
function expectLedFromM(r: LayoutResult, child: string): void {
    const m = r.positions.get('M' as PersonId)!;
    const conn = r.connections.find(c => c.drops.some(d => d.personId === child));
    expect(conn, `a line to ${child} (${[...r.positions.keys()].join(",")})`).toBeDefined();
    expect(conn!.stemX).toBeCloseTo(m.x + config.cardWidth / 2, 6);
    expect(conn!.stemTopY).toBeCloseTo(m.y + config.cardHeight, 6);
}

/**
 * Whether M's "?" family is in view: with expansion always; without it
 * (standard mode shows one family of a person) only from inside it.
 */
function shown(mode: typeof MODES[number], focus: string, child: string): boolean {
    return mode.displayPolicy.autoExpand || focus === child || (child === 'K1' && focus === 'K3');
}

function expectNoStandIn(r: LayoutResult, ids: string[]): void {
    for (const id of ids) {
        expect(r.positions.has(id as PersonId), `${id} has no card`).toBe(false);
        expect(r.spouseLines.some(l => l.person1Id === id || l.person2Id === id), `${id} has no spouse line`).toBe(false);
    }
}

describe('an empty "?" stand-in is not drawn (T11)', () => {
    for (const mode of MODES) {
        describe(mode.name, () => {
            it('a mother with only the "?" family: the child hangs straight below her card', () => {
                const data = build({});
                for (const focus of ['M', 'K1', 'GF', 'S']) {
                    const r = layout(data, focus, mode.displayPolicy);
                    expectNoStandIn(r, ['X']);
                    expectSound(r, data);
                    expectLedFromM(r, 'K1');
                    // A single parent: the drop comes down in the stem's axis.
                    const conn = r.connections.find(c => c.drops.some(d => d.personId === 'K1'))!;
                    expect(conn.drops[0].x).toBeCloseTo(conn.stemX, 6);
                }
            });

            it('a mother with a "?" family and a marriage: both families drawn, no box', () => {
                const data = build({ marriage: true });
                for (const focus of ['M', 'K1', 'K2', 'H', 'GF', 'S']) {
                    const r = layout(data, focus, mode.displayPolicy);
                    expectNoStandIn(r, ['X']);
                    expectSound(r, data);
                    // Without expansion only the focus's own family of M is shown.
                    if (!shown(mode, focus, 'K1')) { expect(r.positions.has('K1' as PersonId)).toBe(false); continue; }
                    expectLedFromM(r, 'K1');
                    if (!mode.displayPolicy.autoExpand) continue;
                    for (const id of ['M', 'H', 'K1', 'K2', 'K4', 'K5']) expect(r.positions.has(id as PersonId), id).toBe(true);
                    expect(r.spouseLines.some(l => [l.person1Id, l.person2Id].sort().join() === 'H,M')).toBe(true);
                }
            });

            it('two "?" families of one mother beside her marriage: one line to both children', () => {
                const data = build({ marriage: true, secondStandIn: true });
                for (const focus of ['M', 'K1', 'K3', 'K2', 'GF']) {
                    const r = layout(data, focus, mode.displayPolicy);
                    expectNoStandIn(r, ['X', 'X2']);
                    expectSound(r, data);
                    if (!shown(mode, focus, 'K1')) { expect(r.positions.has('K1' as PersonId)).toBe(false); continue; }
                    expectLedFromM(r, 'K1');
                    const conn = r.connections.find(c => c.drops.some(d => d.personId === 'K1'))!;
                    expect(conn.drops.map(d => d.personId).sort()).toEqual(['K1', 'K3']);
                }
            });

            it('two "?" families of a mother with no other partner: one single-parent line', () => {
                const data = build({ secondStandIn: true });
                const r = layout(data, 'M', mode.displayPolicy);
                expectNoStandIn(r, ['X', 'X2']);
                expectSound(r, data);
                expectLedFromM(r, 'K1');
                expectLedFromM(r, 'K3');
            });
        });
    }

    it('the data is left as it is', () => {
        const data = build({ marriage: true, secondStandIn: true });
        const before = JSON.stringify(data);
        for (const focus of ['M', 'K1', 'GF']) layout(data, focus, MODES[1].displayPolicy);
        expect(JSON.stringify(data)).toBe(before);
        expect(data.persons['X' as PersonId]).toBeDefined();
    });

    it('a stand-in with a name, a childless "?" marriage, or the focus itself, keeps its card', () => {
        const named = build({ namedStandIn: true });
        expect(layout(named, 'M', MODES[0].displayPolicy).positions.has('X' as PersonId)).toBe(true);
        const plain = build({});
        expect(layout(plain, 'X', MODES[0].displayPolicy).positions.has('X' as PersonId)).toBe(true);
        const childless = build({});
        childless.partnerships['ux' as PartnershipId].childIds = [];
        childless.persons['X' as PersonId].childIds = [];
        childless.persons['K1' as PersonId].parentIds = [];
        childless.persons['M' as PersonId].childIds = [];
        const r = layout(childless, 'M', MODES[0].displayPolicy);
        expect(r.positions.has('X' as PersonId)).toBe(true);
        expect(r.spouseLines.some(l => l.person1Id === 'X' || l.person2Id === 'X')).toBe(true);
    });
});
