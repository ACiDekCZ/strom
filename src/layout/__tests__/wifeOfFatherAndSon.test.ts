/**
 * A widow who later married her late husband's father (GitHub #11): she is
 * a partner in two unions a generation apart, and in the expanded mode her
 * union with the son and her union with the father join one partner chain
 * together with the father's first marriage. The son is a child of that
 * first marriage, so his own union is one of the chain's unions: the chain
 * block (built as an ancestor block of the granddaughter) took itself as a
 * child, and placing its descendants recursed into itself until the call
 * stack ran out ("Maximum call stack size exceeded", the tree did not open).
 *
 * A block is never its own child; every person can be the focus without the
 * layout recursing without end. Fixture: test/t5b_wife_of_father_and_son.json
 * (fictional).
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runLayoutPipeline } from '../pipeline/index.js';
import { selectSubgraph, expandSelectionForDisplay } from '../pipeline/1-select-subgraph.js';
import { buildLayoutModel } from '../pipeline/2-build-model.js';
import { assignGenerations } from '../pipeline/3-assign-generations.js';
import { measureSubtrees } from '../pipeline/4-measure.js';
import { DisplayPolicy, FamilyBlockModel } from '../pipeline/types.js';
import { assertNoNodeOverlap, assertValidPositions } from './helpers/assertions.js';
import { auditGeometry } from './helpers/geometryAudit.js';
import { Person, PersonId, PartnershipId, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';

const config = DEFAULT_LAYOUT_CONFIG;
const data = loadFixture('t5b_wife_of_father_and_son');

const run = (focus: string, autoExpand: boolean) => runLayoutPipeline({
    data, focusPersonId: focus as PersonId, config,
    ancestorDepth: 5, descendantDepth: 5,
    includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
    displayPolicy: { mode: 'standard', autoExpand },
});

describe('a widow married to her late husband\'s father (GitHub #11)', () => {
    it('no block of the measured tree is its own child or its own descendant', () => {
        const focus = 'edeltraud' as PersonId;
        const selection = selectSubgraph({
            data, focusPersonId: focus, ancestorDepth: 5, descendantDepth: 5,
            includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        });
        const policy: DisplayPolicy = {
            mode: 'expanded',
            expandedPersonIds: new Set(['vendelin', 'rosmarie'] as PersonId[]),
            autoExpand: true,
        };
        expandSelectionForDisplay(data, selection, policy);
        const model = buildLayoutModel({ data, selection, focusPersonId: focus, displayPolicy: policy });
        const genModel = assignGenerations({ model, focusPersonId: focus });
        const measured = measureSubtrees({ genModel, config, focusPersonId: focus }) as FamilyBlockModel;

        // The three unions share one chain block
        const chainBlock = measured.unionToBlock.get(model.personToUnion.get('rosmarie' as PersonId)!)!;
        expect(measured.blocks.get(chainBlock)!.chainInfo?.unionIds.length).toBe(3);

        const cycles: string[] = [];
        const state = new Map<string, 'open' | 'done'>();
        const visit = (id: string, path: string[]): void => {
            state.set(id, 'open');
            for (const child of measured.blocks.get(id as never)?.childBlockIds ?? []) {
                if (state.get(child) === 'open') cycles.push([...path, id, child].join(' -> '));
                else if (!state.has(child)) visit(child, [...path, id]);
            }
            state.set(id, 'done');
        };
        for (const id of measured.blocks.keys()) if (!state.has(id)) visit(id, []);
        expect(cycles).toEqual([]);
    });

    it('the husband of the granddaughter as focus: the whole tree laid out, clean (expanded)', () => {
        const result = run('gottlob', true);
        assertValidPositions(result.positions);
        assertNoNodeOverlap(result.positions, config.cardWidth, config.cardHeight);
        for (const id of ['gottlob', 'edeltraud', 'ansgar', 'rosmarie', 'vendelin', 'wendelgard', 'edelbert', 'hyacinta']) {
            expect(result.positions.has(id as PersonId), id).toBe(true);
        }
        expect(auditGeometry(result, config)).toEqual([]);
    });

    // The constellation itself (one union spanning two generations) is
    // beyond the layout's invariants for some focuses: the test-only
    // Phase B check reports moved descendants there (as it does for
    // Leopoldine, whose run never recursed). That is not this bug; the
    // runs must only never recurse without end.
    for (const focus of Object.keys(data.persons)) {
        for (const autoExpand of [false, true]) {
            it(`${focus} as focus (${autoExpand ? 'expanded' : 'standard'}): no endless recursion`, () => {
                expect(() => run(focus, autoExpand)).not.toThrow(RangeError);
            });
        }
    }
});

describe('a mother recorded as her own son\'s partner (GitHub #11)', () => {
    // Wrong data of the same shape: the son's union with his mother joins her
    // chain with his parents' union, so his own union is the chain again.
    const tree = (): StromData => {
        const d = { persons: {}, partnerships: {} } as unknown as StromData;
        const person = (id: string, gender: 'male' | 'female'): PersonId => {
            d.persons[id as PersonId] = { id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } as unknown as Person;
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
        const father = person('father', 'male'), mother = person('mother', 'female');
        const son = person('son', 'male'), daughter = person('daughter', 'female');
        const grandfather = person('grandfather', 'male'), grandmother = person('grandmother', 'female');
        family('u_parents', father, mother, [son, daughter]);
        family('u_son_mother', son, mother, []);
        family('u_grandparents', grandfather, grandmother, [mother]);
        return d;
    };
    for (const focus of ['father', 'mother', 'son', 'daughter', 'grandfather', 'grandmother']) {
        it(`${focus} as focus (expanded): no endless recursion`, () => {
            // (the son as focus meets the test-only Phase B check, as before)
            expect(() => runLayoutPipeline({
                data: tree(), focusPersonId: focus as PersonId, config,
                ancestorDepth: 5, descendantDepth: 5,
                includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
                displayPolicy: { mode: 'standard', autoExpand: true },
            })).not.toThrow(RangeError);
        });
    }
});
