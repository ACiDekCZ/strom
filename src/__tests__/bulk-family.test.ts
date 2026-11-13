/**
 * Children and siblings at once (src/bulk-family.ts): who a step shows
 * (collectBulkFamily), the persons whose children it shows (bulkParents)
 * and the people it adds (bulkNewIds); on the fixtures with a real layout
 * the count is the number of new cards and the layout invariants hold after
 * the step.
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from '../layout/__tests__/helpers/loadFixture.js';
import { planShownChildrenFolding } from '../layout/pipeline/index.js';
import { selectSubgraph } from '../layout/pipeline/1-select-subgraph.js';
import { assertNoNodeOverlap, assertValidPositions } from '../layout/__tests__/helpers/assertions.js';
import { auditGeometry } from '../layout/__tests__/helpers/geometryAudit.js';
import { DEFAULT_LAYOUT_CONFIG, type PartnershipId, type PersonId, type StromData } from '../types.js';
import { bulkAddedKeys, bulkBroughtInByParent, bulkNewIds, bulkParents, collectBulkFamily, BULK_TWO_GENERATIONS } from '../bulk-family.js';

const P = (id: string) => id as PersonId;

/** A small family: grandparents → dad, uncle (two marriages, no children); dad + mom → me, sis; me + wife → kid1, kid2. */
function family(): StromData {
    const persons: Record<string, unknown> = {};
    const partnerships: Record<string, unknown> = {};
    const person = (id: string, gender: 'male' | 'female', parentIds: string[] = []) => {
        persons[id] = { id, firstName: id, lastName: 'Test', gender, isPlaceholder: false, partnerships: [], parentIds, childIds: [] };
    };
    const union = (id: string, a: string, b: string, childIds: string[] = []) => {
        partnerships[id] = { id, person1Id: a, person2Id: b, childIds, status: 'married' };
        for (const p of [a, b]) {
            (persons[p] as { partnerships: string[] }).partnerships.push(id);
            (persons[p] as { childIds: string[] }).childIds.push(...childIds);
        }
    };
    person('gp1', 'male'); person('gp2', 'female');
    person('dad', 'male', ['gp1', 'gp2']); person('uncle', 'male', ['gp1', 'gp2']);
    person('mom', 'female');
    person('aunt1', 'female'); person('aunt2', 'female');
    person('me', 'male', ['dad', 'mom']); person('sis', 'female', ['dad', 'mom']);
    person('wife', 'female');
    person('kid1', 'male', ['me', 'wife']); person('kid2', 'female', ['me', 'wife']);
    union('u_gp', 'gp1', 'gp2', ['dad', 'uncle']);
    union('u_dm', 'dad', 'mom', ['me', 'sis']);
    union('u_a1', 'uncle', 'aunt1');
    union('u_a2', 'uncle', 'aunt2');
    union('u_mw', 'me', 'wife', ['kid1', 'kid2']);
    return { persons, partnerships } as unknown as StromData;
}

/** Invented: every ancestor couple up to four generations above the focus has `extra` children besides the one on the line. */
function bigTree(extra: number): StromData {
    const persons: Record<string, Record<string, unknown>> = {};
    const partnerships: Record<string, Record<string, unknown>> = {};
    const person = (id: string, gender: 'male' | 'female', parentIds: string[] = []) => {
        persons[id] = { id, firstName: `Q${Object.keys(persons).length}`, lastName: 'Quillborn', gender, isPlaceholder: false, partnerships: [], parentIds, childIds: [] };
    };
    const union = (id: string, a: string, b: string, childIds: string[]) => {
        partnerships[id] = { id, person1Id: a, person2Id: b, childIds, status: 'married' };
        for (const p of [a, b]) { (persons[p].partnerships as string[]).push(id); (persons[p].childIds as string[]).push(...childIds); }
    };
    const parentsOf = (child: string, prefix: string, gen: number) => {
        const f = `${prefix}f`, m = `${prefix}m`;
        person(f, 'male'); person(m, 'female');
        persons[child].parentIds = [f, m];
        const kids = [child];
        for (let i = 0; i < extra; i++) { const k = `${prefix}k${i}`; person(k, i % 2 ? 'female' : 'male', [f, m]); kids.push(k); }
        union(`u_${prefix}`, f, m, kids);
        if (gen < 4) { parentsOf(f, `${prefix}f`, gen + 1); parentsOf(m, `${prefix}m`, gen + 1); }
    };
    person('q', 'male'); person('q_w', 'female');
    for (const k of ['q_c1', 'q_c2', 'q_c3']) person(k, 'female', ['q', 'q_w']);
    union('u_q', 'q', 'q_w', ['q_c1', 'q_c2', 'q_c3']);
    parentsOf('q', 'p', 1);
    return { persons, partnerships } as unknown as StromData;
}
describe('collectBulkFamily', () => {
    const data = family();
    const drawn = new Set(['gp1', 'gp2', 'dad', 'mom', 'me'].map(P));
    const inView = (id: PersonId) => drawn.has(id);

    it('takes the children of the person and the siblings of the person and of the ancestors whose parents are in view', () => {
        const f = collectBulkFamily(data, P('me'), inView);
        expect([...f.childrenOf]).toEqual(['me']);
        // mom and the grandparents have no parents in view: the top row of the depth keeps its own tab
        expect([...f.siblingsOf].sort()).toEqual(['dad', 'me']);
    });

    it('limits the ancestors by generation (bulk.two)', () => {
        expect([...collectBulkFamily(data, P('me'), inView, 0).siblingsOf]).toEqual(['me']);
        expect([...collectBulkFamily(data, P('me'), inView, BULK_TWO_GENERATIONS).siblingsOf].sort()).toEqual(['dad', 'me']);
    });

    it('is empty for a person out of view', () => {
        const f = collectBulkFamily(data, P('sis'), inView);
        expect(f.childrenOf.size + f.siblingsOf.size).toBe(0);
    });

    it('shows the children of each parent once and counts each new person once, partners included', () => {
        const f = collectBulkFamily(data, P('me'), inView);
        const parents = bulkParents(data, f, inView);
        expect(parents).toEqual(['me', 'dad', 'mom', 'gp1', 'gp2']);
        const unions = new Set(['u_gp', 'u_dm'] as PartnershipId[]);
        // sis once (child of dad and mom); wife comes with the children of me; the uncle with one partner or both
        expect(bulkNewIds(data, parents, drawn, unions, false).sort()).toEqual(['aunt1', 'kid1', 'kid2', 'sis', 'uncle', 'wife']);
        expect(bulkNewIds(data, parents, drawn, unions, true).sort()).toEqual(['aunt1', 'aunt2', 'kid1', 'kid2', 'sis', 'uncle', 'wife']);
    });

    it('leaves out the persons whose children are shown already', () => {
        const f = collectBulkFamily(data, P('me'), inView);
        const parents = bulkParents(data, f, inView, q => q !== P('me'));
        expect(parents).toEqual(['dad', 'mom', 'gp1', 'gp2']);
        const added = bulkAddedKeys(data, f, parents, inView);
        expect(added.childrenOf).toEqual([]);
        expect(added.siblingsOf.sort()).toEqual(['dad', 'me']);
    });

    it('files each brought card under its parents, a partner under the parent it married', () => {
        const by = bulkBroughtInByParent(data, [P('me'), P('gp1')], new Set(['kid1', 'wife', 'uncle', 'aunt1'].map(P)));
        expect([...by.get(P('me'))!].sort()).toEqual(['kid1', 'wife']);
        expect([...by.get(P('gp1'))!].sort()).toEqual(['aunt1', 'uncle']);
    });
});

describe('children and siblings at once on the fixtures', () => {
    const config = DEFAULT_LAYOUT_CONFIG;
    const plan = (data: StromData, focus: PersonId, depth: number, autoExpand: boolean, shown: PersonId[] = []) => planShownChildrenFolding({
        data, focusPersonId: focus, config, ancestorDepth: depth, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        ...(shown.length ? { expandChildrenOf: shown } : {}),
    });

    const cases: Array<[string, string, number]> = [
        ['edge-ancestor-children', 'focus', 6],
        ['edge-ancestor-children', 'f_m_f', 4],
        ['comprehensive', 'focus', 4],
        ['comprehensive', 'grandchild_1', 4],
    ];

    for (const [fixture, focus, depth] of cases) {
        for (const autoExpand of [false, true]) {
            it(`${fixture} ${focus} depth ${depth} ${autoExpand ? 'expanded' : 'standard'}: count = new cards, invariants hold`, () => {
                const data = loadFixture(fixture);
                const before = plan(data, P(focus), depth, autoExpand).result;
                const drawn = new Set(before.positions.keys());
                const inView = (id: PersonId) => drawn.has(id);
                const f = collectBulkFamily(data, P(focus), inView);
                const parents = bulkParents(data, f, inView);
                const unions = new Set(before.spouseLines.flatMap(l => l.partnershipId ? [l.partnershipId] : []));
                const held = selectSubgraph({ data, focusPersonId: P(focus), ancestorDepth: depth, descendantDepth: depth,
                    includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true });
                const newIds = bulkNewIds(data, parents, drawn, unions, autoExpand, id => held.persons.has(id), u => held.partnerships.has(u));
                const after = plan(data, P(focus), depth, autoExpand, parents).result;
                const brought = [...after.positions.keys()].filter(id => !drawn.has(id));
                expect(newIds.sort()).toEqual(brought.sort());
                assertValidPositions(after.positions);
                assertNoNodeOverlap(after.positions, config.cardWidth, config.cardHeight);
                expect(auditGeometry(after, config)).toEqual([]);
            });
        }
    }

    // Every person as focus: the count is the number of new cards, nothing folds
    for (const fixture of ['comprehensive', 'etalon-stress-all', 'edge-aunts-wide-family', 'etalon-deep-both']) {
        it(`${fixture}, every person as focus: count = new cards`, () => {
            const data = loadFixture(fixture);
            const failures: string[] = [];
            for (const focus of Object.keys(data.persons) as PersonId[]) {
                for (const autoExpand of [false, true]) {
                    const before = plan(data, focus, 4, autoExpand).result;
                    const drawn = new Set(before.positions.keys());
                    const inView = (id: PersonId) => drawn.has(id);
                    const parents = bulkParents(data, collectBulkFamily(data, focus, inView), inView);
                    if (parents.length === 0) continue;
                    const held = selectSubgraph({ data, focusPersonId: focus, ancestorDepth: 4, descendantDepth: 4,
                        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true });
                    const unions = new Set(before.spouseLines.flatMap(l => l.partnershipId ? [l.partnershipId] : []));
                    const n = bulkNewIds(data, parents, drawn, unions, autoExpand, id => held.persons.has(id), u => held.partnerships.has(u));
                    const planned = plan(data, focus, 4, autoExpand, parents);
                    const fresh = [...planned.result.positions.keys()].filter(id => !drawn.has(id));
                    if (n.length !== fresh.length || planned.foldedFor.size > 0) {
                        failures.push(`${focus} ${autoExpand ? 'expanded' : 'standard'}: n ${n.length}, new ${fresh.length}, folded ${planned.foldedFor.size}`);
                    }
                }
            }
            expect(failures).toEqual([]);
        });
    }

    for (const autoExpand of [false, true]) {
        for (const maxGeneration of [BULK_TWO_GENERATIONS, Infinity]) {
            it(`a big step (${autoExpand ? 'expanded' : 'standard'}, ${maxGeneration} generations) folds no ancestor: count = new cards, invariants hold`, () => {
                const data = bigTree(14);
                const input = (shown: PersonId[]) => ({
                    data, focusPersonId: P('q'), config, ancestorDepth: 4, descendantDepth: 1,
                    includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
                    displayPolicy: { mode: autoExpand ? 'expanded' as const : 'standard' as const, autoExpand },
                    ...(shown.length ? { expandChildrenOf: shown } : {}),
                });
                const before = planShownChildrenFolding(input([])).result;
                const drawn = new Set(before.positions.keys());
                const inView = (id: PersonId) => drawn.has(id);
                const parents = bulkParents(data, collectBulkFamily(data, P('q'), inView, maxGeneration), inView);
                const unions = new Set(before.spouseLines.flatMap(l => l.partnershipId ? [l.partnershipId] : []));
                const newIds = bulkNewIds(data, parents, drawn, unions, autoExpand);
                const planned = planShownChildrenFolding(input(parents));
                expect([...planned.foldedFor]).toEqual([]);
                const after = planned.result;
                expect(newIds.sort()).toEqual([...after.positions.keys()].filter(id => !drawn.has(id)).sort());
                for (const id of drawn) expect(after.positions.has(id), id).toBe(true);
                assertValidPositions(after.positions);
                assertNoNodeOverlap(after.positions, config.cardWidth, config.cardHeight);
                expect(auditGeometry(after, config)).toEqual([]);
            });
        }
    }

    it('edge-ancestor-children: the step for the focus at depth 6 shows the two ancestors with 13 children', () => {
        const data = loadFixture('edge-ancestor-children');
        const before = plan(data, P('focus'), 6, false).result;
        const inView = (id: PersonId) => before.positions.has(id);
        const parents = bulkParents(data, collectBulkFamily(data, P('focus'), inView), inView);
        expect(parents).toEqual(['f_m_f_m_f_f', 'f_m_f_m_f_m']);
    });
});
