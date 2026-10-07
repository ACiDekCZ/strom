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
import { DEFAULT_LAYOUT_CONFIG, PersonId, PartnershipId, Person, Partnership, Gender, StromData } from '../../types.js';

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

/**
 * Marriage chains (T09): a stem from the bottom of a chain partner's card
 * and its child's drop were 13–41 px apart (chain partners stand 18 px
 * apart, the children's blocks 31 px, so the children's row is wider than
 * the chain by 13 px per gap and every child is a multiple of 13 px off its
 * parent). The drop now comes down in the stem's axis, still well inside the
 * child's card.
 */
describe('stem and drop in one axis in marriage chains (T09)', () => {
    const MAX_CHECKED_STEP = 41;

    /** Jiří with three wives, each wife with a second husband, one child per union. */
    function chainOfChains(): StromData {
        const persons: Record<string, Person> = {};
        const partnerships: Record<string, Partnership> = {};
        const P = (id: string, gender: Gender, birthDate: string) => {
            persons[id] = { id: id as PersonId, firstName: id, lastName: '', gender, birthDate, isPlaceholder: false,
                parentIds: [], childIds: [], partnerships: [] } as unknown as Person;
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
        P('Hugo', 'male', '1820'); P('Hilda', 'female', '1822');
        P('Jiri', 'male', '1850'); P('Anna', 'female', '1852'); P('Berta', 'female', '1856'); P('Cecilie', 'female', '1860');
        P('Daniel', 'male', '1848'); P('Emil', 'male', '1854'); P('Frantisek', 'male', '1858');
        P('Adam', 'male', '1875'); P('Bara', 'female', '1880'); P('Cyril', 'male', '1885');
        P('Dora', 'female', '1872'); P('Ema', 'female', '1878'); P('Filip', 'male', '1882');
        U('F0', 'Hugo', 'Hilda', ['Jiri']);
        U('F1', 'Jiri', 'Anna', ['Adam']);
        U('F2', 'Jiri', 'Berta', ['Bara']);
        U('F3', 'Jiri', 'Cecilie', ['Cyril']);
        U('F4', 'Daniel', 'Anna', ['Dora']);
        U('F5', 'Emil', 'Berta', ['Ema']);
        U('F6', 'Frantisek', 'Cecilie', ['Filip']);
        return { persons, partnerships } as unknown as StromData;
    }

    const sets: [string, StromData][] = [
        ['comprehensive', loadFixture('comprehensive')],
        ['edge-marriage-cascade', loadFixture('edge-marriage-cascade')],
        ['edge-remarriage-web', loadFixture('edge-remarriage-web')],
        ['etalon-merged-chain', loadFixture('etalon-merged-chain')],
        ['etalon-multi-partners', loadFixture('etalon-multi-partners')],
        ['chain of chains', chainOfChains()],
    ];

    for (const [name, data] of sets) {
        for (const mode of ['standard', 'expanded'] as const) {
            it(`${name} (${mode}), every focus: no connector step up to ${MAX_CHECKED_STEP} px, drops inside the child's card`, () => {
                const W = DEFAULT_LAYOUT_CONFIG.cardWidth;
                const steps: string[] = [];
                for (const focus of Object.keys(data.persons) as PersonId[]) {
                    if (data.persons[focus].isPlaceholder) continue;
                    const r = runLayoutPipeline({
                        data, focusPersonId: focus, config: DEFAULT_LAYOUT_CONFIG,
                        ancestorDepth: 40, descendantDepth: 40,
                        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
                        displayPolicy: { mode, autoExpand: mode === 'expanded' } as never,
                    });
                    for (const c of r.connections) {
                        const step = Math.abs(c.connectorToX - c.connectorFromX);
                        if (step > 0.5 && step <= MAX_CHECKED_STEP) steps.push(`focus ${focus}: ${c.unionId} step ${step}`);
                        for (const d of c.drops) {
                            const left = r.positions.get(d.personId)!.x;
                            expect(d.x, `${focus}: ${c.unionId} drop to ${d.personId}`).toBeGreaterThanOrEqual(left + W / 4);
                            expect(d.x, `${focus}: ${c.unionId} drop to ${d.personId}`).toBeLessThanOrEqual(left + W * 3 / 4);
                        }
                    }
                }
                expect(steps).toEqual([]);
            });
        }
    }
});
