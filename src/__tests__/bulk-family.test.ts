/**
 * Children and siblings at once (src/bulk-family.ts): who a step shows
 * (collectBulkFamily), the persons whose children it shows (bulkParents)
 * and the people it adds (bulkNewIds); on the fixtures with a real layout
 * the count is exactly the number of new cards (every person as focus, also
 * "Only 2 ancestor generations", and an invented family of about 3 000
 * people at the depths 4 to 6), it stays cheap, and the layout invariants
 * hold after the step.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadFixture } from '../layout/__tests__/helpers/loadFixture.js';
import { planShownChildrenFolding, type PipelineInput } from '../layout/pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from '../layout/__tests__/helpers/assertions.js';
import { auditGeometry } from '../layout/__tests__/helpers/geometryAudit.js';
import { DEFAULT_LAYOUT_CONFIG, type PersonId, type StromData } from '../types.js';
import { bulkAddedKeys, bulkBroughtInByParent, bulkNewIds, bulkParents, collectBulkFamily, BULK_TWO_GENERATIONS } from '../bulk-family.js';
import { syntheticBigFamily } from './helpers/synthetic-big-family.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

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

    it('shows the children of each parent once', () => {
        const f = collectBulkFamily(data, P('me'), inView);
        expect(bulkParents(data, f, inView)).toEqual(['me', 'dad', 'mom', 'gp1', 'gp2']);
    });

    it('counts each new person once, partners included, as the layout then draws them', () => {
        for (const autoExpand of [false, true]) {
            const input = viewInput(data, P('kid1'), 3, 0, autoExpand);
            const before = new Set(planShownChildrenFolding(input).result.positions.keys());
            const inViewNow = (id: PersonId) => before.has(id);
            const parents = bulkParents(data, collectBulkFamily(data, P('kid1'), inViewNow), inViewNow);
            expect(parents).toEqual(['gp1', 'gp2']);
            // The uncle with the partner the standard display draws, or both
            expect(bulkNewIds(input, parents, before).sort()).toEqual(autoExpand ? ['aunt1', 'aunt2', 'uncle'] : ['aunt1', 'uncle']);
        }
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

/** The family view's layout input (the screen's: aunts, uncles and cousins in, no spouse ancestors). */
function viewInput(data: StromData, focus: PersonId, up: number, down: number, autoExpand: boolean, shown: readonly PersonId[] = []): PipelineInput {
    return {
        data, focusPersonId: focus, config: DEFAULT_LAYOUT_CONFIG, ancestorDepth: up, descendantDepth: down,
        includeSpouseAncestors: false, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: autoExpand ? 'expanded' : 'standard', autoExpand },
        ...(shown.length ? { expandChildrenOf: shown } : {}),
    };
}

/**
 * A step for `focus` in the view: the count (bulkNewIds) and the cards the
 * step's real layout (with its folds planned) draws that the view did not.
 * Null when the step has nothing to show.
 */
function stepOf(data: StromData, focus: PersonId, up: number, down: number, autoExpand: boolean, maxGeneration = Infinity) {
    const input = viewInput(data, focus, up, down, autoExpand);
    const before = planShownChildrenFolding(input).result;
    const drawn = new Set(before.positions.keys());
    const inView = (id: PersonId) => drawn.has(id);
    const parents = bulkParents(data, collectBulkFamily(data, focus, inView, maxGeneration), inView);
    if (parents.length === 0) return null;
    const n = bulkNewIds(input, parents, drawn);
    const planned = planShownChildrenFolding(viewInput(data, focus, up, down, autoExpand, parents));
    const fresh = [...planned.result.positions.keys()].filter(id => !drawn.has(id));
    return { n, fresh, planned, parents, drawn };
}

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
                const step = stepOf(loadFixture(fixture), P(focus), depth, depth, autoExpand);
                // (the expanded display of comprehensive draws the whole family already)
                if (!step) return;
                expect(step.n.sort()).toEqual(step.fresh.sort());
                const after = step.planned.result;
                assertValidPositions(after.positions);
                assertNoNodeOverlap(after.positions, config.cardWidth, config.cardHeight);
                expect(auditGeometry(after, config)).toEqual([]);
            });
        }
    }

    // Every person as focus, the whole step and "Only 2 ancestor generations":
    // the count is exactly the number of new cards (the fixtures where an
    // estimate of the count went wrong among them: a childless partner, a
    // shown child's family, the demo tree, the author's own tree when here)
    const everyone = ['comprehensive', 'etalon-stress-all', 'edge-aunts-wide-family', 'etalon-deep-both',
        'edge-childless-partners', 'edge-shown-child-family', 'devel-demo', 'edge-ancestor-children', 'real-large'];
    for (const fixture of everyone) {
        const present = existsSync(join(process.cwd(), 'test', `${fixture}.json`));
        it.skipIf(!present)(`${fixture}, every person as focus: count = new cards, no tolerance`, () => {
            const data = loadFixture(fixture);
            const failures: string[] = [];
            let steps = 0;
            for (const focus of Object.keys(data.persons) as PersonId[]) {
                for (const autoExpand of [false, true]) {
                    for (const maxGeneration of [Infinity, BULK_TWO_GENERATIONS]) {
                        const step = stepOf(data, focus, 4, 4, autoExpand, maxGeneration);
                        if (!step) continue;
                        steps++;
                        const n = new Set(step.n), fresh = new Set(step.fresh);
                        if (n.size !== fresh.size || [...n].some(id => !fresh.has(id))) {
                            failures.push(`${focus} ${autoExpand ? 'expanded' : 'standard'} ${maxGeneration}: n ${n.size}, new ${fresh.size}`);
                        }
                    }
                }
            }
            expect(steps).toBeGreaterThan(0);
            expect(failures).toEqual([]);
        }, 120_000);
    }

    // The fixtures of the first version: a step from scratch folds no ancestor
    for (const fixture of ['comprehensive', 'etalon-stress-all', 'edge-aunts-wide-family', 'etalon-deep-both']) {
        it(`${fixture}, every person as focus: nothing folds`, () => {
            const data = loadFixture(fixture);
            const folded: string[] = [];
            for (const focus of Object.keys(data.persons) as PersonId[]) {
                for (const autoExpand of [false, true]) {
                    const step = stepOf(data, focus, 4, 4, autoExpand);
                    if (step && step.planned.foldedFor.size > 0) folded.push(`${focus} ${autoExpand}`);
                }
            }
            expect(folded).toEqual([]);
        });
    }

    // An invented family of about 3 000 people, the youngest as focus and some
    // of the ancestors' line: exact at the depths 4 to 6, both displays
    it('an invented family of 3 000 people at the depths 4 to 6: count = new cards, no tolerance', () => {
        const data = syntheticBigFamily();
        expect(Object.keys(data.persons).length).toBeGreaterThan(3000);
        const failures: string[] = [];
        for (const focus of ['z', 'af', 'amf', 'z_c1'].map(P)) {
            for (const depth of [4, 5, 6]) {
                for (const autoExpand of [false, true]) {
                    for (const maxGeneration of [Infinity, BULK_TWO_GENERATIONS]) {
                        const step = stepOf(data, focus, depth, 1, autoExpand, maxGeneration);
                        if (!step) { failures.push(`${focus} ${depth}: no step`); continue; }
                        if (step.n.length !== step.fresh.length || step.n.some(id => !step.fresh.includes(id))) {
                            failures.push(`${focus} depth ${depth} ${autoExpand ? 'expanded' : 'standard'} ${maxGeneration}: n ${step.n.length}, new ${step.fresh.length}`);
                        }
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    }, 120_000);

    // The count after every drawing (the switch) stays in single milliseconds
    // on that family at depth 6: judged against a calibration run right
    // before it (helpers/perf-budget.ts), so a busy machine does not fail it
    it('the count on 3 000 people at depth 6 takes a few milliseconds', () => {
        const data = syntheticBigFamily();
        const input = viewInput(data, P('z'), 6, 1, false);
        const drawn = new Set(planShownChildrenFolding(input).result.positions.keys());
        const inView = (id: PersonId) => drawn.has(id);
        let n = 0;
        const count = () => {
            const parents = bulkParents(data, collectBulkFamily(data, P('z'), inView), inView);
            n = bulkNewIds(input, parents, drawn).length;
        };
        count();
        expect(n).toBeGreaterThan(150);
        const BUDGET_MS = 10;
        const m = measureAgainstBudget(count, {
            budgetMs: BUDGET_MS, calibrationRounds: 2, referenceMs: 11, minPairs: 3, maxPairs: 15, maxWallMs: 20_000,
        });
        console.log(budgetReport('children and siblings count, 3 000 people, depth 6', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);

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
                const newIds = bulkNewIds(input([]), parents, drawn);
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
