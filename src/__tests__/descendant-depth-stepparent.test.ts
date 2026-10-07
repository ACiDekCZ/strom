/**
 * The generations-down maximum of a step-parent (T19).
 *
 * A partner's children from the partner's other unions are shown one
 * generation down within the depth, so the maximum must reach them, but the
 * view never shows their own descendants: they add exactly one generation.
 * Mirrors Rosa Rossi of the sample tree (Erik's second wife; Erik's children
 * of the first marriage have long lines of their own).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { runLayoutPipeline } from '../layout/pipeline/index.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender, DEFAULT_LAYOUT_CONFIG } from '../types.js';

function build(): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const P = (id: string, gender: Gender) => {
        persons[id] = { id: id as PersonId, firstName: id, lastName: '', gender, isPlaceholder: false,
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
    ['Erik', 'David', 'Leo', 'G1', 'GG1', 'Simon'].forEach(x => P(x, 'male'));
    ['Laura', 'Rosa', 'Sofia', 'DavidW', 'G1W', 'G2'].forEach(x => P(x, 'female'));
    U('uEL', 'Erik', 'Laura', ['David', 'Sofia']);   // first marriage
    U('uER', 'Erik', 'Rosa', ['Leo']);               // second marriage: Rosa's only child
    U('uD', 'David', 'DavidW', ['G1']);
    U('uG', 'G1', 'G1W', ['GG1']);
    U('uS', 'Simon', 'Sofia', ['G2']);
    return { persons, partnerships } as unknown as StromData;
}

function load(data: StromData): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    (DataManager as unknown as { data: StromData }).data = data;
}

/** Persons shown for a depth: family view, or descendants view with whole families. */
function shownCount(data: StromData, focus: string, depth: number, family: boolean): number {
    const r = runLayoutPipeline({
        data, focusPersonId: focus as PersonId, config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: family ? 1 : 0, descendantDepth: depth,
        includeSpouseAncestors: false, includeParentSiblings: family, includeParentSiblingDescendants: family,
        displayPolicy: { mode: 'expanded', autoExpand: true, expandLineageOnly: false } as never,
    });
    return r.positions.size;
}

describe('generations-down maximum of a step-parent (T19)', () => {
    const data = build();
    beforeEach(() => load(data));

    it("counts the partner's children from another union as one generation, not their whole line", () => {
        expect(DataManager.getMaxGenerationsWithSiblings('Rosa' as PersonId).down).toBe(1);
    });

    it("still reaches the partner's children when the step-parent has no child of their own", () => {
        load({ ...data, partnerships: { ...data.partnerships, uER: { ...data.partnerships['uER' as PartnershipId], childIds: [] } } } as StromData);
        expect(DataManager.getMaxGenerationsWithSiblings('Rosa' as PersonId).down).toBe(1);
    });

    it('the father keeps the whole line of his children', () => {
        expect(DataManager.getMaxGenerationsWithSiblings('Erik' as PersonId).down).toBe(3);
    });

    for (const family of [true, false]) {
        it(`the maximum is the last depth that shows anyone more (${family ? 'family' : 'descendants, whole families'})`, () => {
            const focuses = family ? Object.keys(data.persons) : ['Rosa', 'Erik', 'Laura', 'G1'];
            for (const focus of focuses) {
                const max = DataManager.getMaxGenerationsWithSiblings(focus as PersonId).down;
                const at = (d: number) => shownCount(data, focus, d, family);
                if (max > 1) expect(at(max), `${focus}: depth ${max} adds someone`).toBeGreaterThan(at(max - 1));
                expect(at(max + 1), `${focus}: depth ${max + 1} adds nobody`).toBe(at(max));
            }
        });
    }
});
