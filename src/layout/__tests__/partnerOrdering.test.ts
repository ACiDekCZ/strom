/**
 * Partner Ordering Invariant Tests
 *
 * Verifies that in every union, partnerA (left) has a smaller center X
 * than partnerB (right). This ensures deterministic, stable couple placement.
 *
 * Expected: PASS on current layout (basic ordering is handled correctly).
 */

import { describe, it, expect } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runPipeline } from './helpers/runPipeline.js';
import { assertPartnerOrdering } from './helpers/assertions.js';
import { PersonId, PartnershipId, Person, Partnership, StromData, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import { runLayoutPipeline } from '../pipeline/index.js';

describe('Partner Ordering Invariant', () => {
    it('simple-family: all couples have A left of B', () => {
        const data = loadFixture('simple-family');
        const { constrained } = runPipeline(data, 'c1' as PersonId, {
            ancestorDepth: 2,
            descendantDepth: 2
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('two-sibling-families: all couples ordered correctly', () => {
        const data = loadFixture('two-sibling-families-with-children');
        const { constrained } = runPipeline(data, 'c1' as PersonId, {
            ancestorDepth: 2,
            descendantDepth: 2
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('comprehensive (focus, depth 5): all couples ordered correctly', () => {
        const data = loadFixture('comprehensive');
        const { constrained } = runPipeline(data, 'focus' as PersonId, {
            ancestorDepth: 5,
            descendantDepth: 5
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('comprehensive (focus, depth 3): all couples ordered correctly', () => {
        const data = loadFixture('comprehensive');
        const { constrained } = runPipeline(data, 'focus' as PersonId, {
            ancestorDepth: 3,
            descendantDepth: 3
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });

    it('comprehensive (sibling_1, depth 5): all couples ordered correctly', () => {
        const data = loadFixture('comprehensive');
        const { constrained } = runPipeline(data, 'sibling_1' as PersonId, {
            ancestorDepth: 5,
            descendantDepth: 5
        });

        expect(() => assertPartnerOrdering(constrained)).not.toThrow();
    });
});

/**
 * T13: the extra partners on one side of a person with several unions in a
 * row (expanded view, partner chain) stand in the order of the marriages —
 * wedding date, then data order, an undated union last — the earliest next
 * to the person. The primary couple stays where it was.
 */
describe('Chronological partner order (T13)', () => {
    function threeMarriages(shared: 'male' | 'female', dataOrder: string[], dates: Record<string, string | undefined>): StromData {
        const other = shared === 'male' ? 'female' : 'male';
        const persons: Record<string, Person> = {};
        const partnerships: Record<string, Partnership> = {};
        const person = (id: string, gender: 'male' | 'female', birthDate?: string) => {
            persons[id] = { id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], ...(birthDate ? { birthDate } : {}) };
        };
        const union = (id: string, a: string, b: string, startDate: string | undefined, kids: string[]) => {
            partnerships[id] = { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
                childIds: kids as PersonId[], status: 'married', ...(startDate ? { startDate } : {}) };
            persons[a].partnerships.push(id as PartnershipId);
            persons[b].partnerships.push(id as PartnershipId);
            for (const k of kids) {
                persons[k].parentIds.push(a as PersonId, b as PersonId);
                persons[a].childIds.push(k as PersonId);
                persons[b].childIds.push(k as PersonId);
            }
        };
        person('gf', 'male'); person('gm', 'female'); person('S', shared);
        union('u_g', 'gf', 'gm', '1830', ['S']);
        for (const n of ['1', '2', '3']) { person('P' + n, other); person('c' + n, 'male', `${1860 + Number(n)}`); }
        for (const n of dataOrder) union('u' + n, 'S', 'P' + n, dates[n], ['c' + n]);
        return { persons, partnerships } as unknown as StromData;
    }

    function row(data: StromData, focus: string): string {
        const result = runLayoutPipeline({
            data, focusPersonId: focus as PersonId, config: DEFAULT_LAYOUT_CONFIG,
            ancestorDepth: 3, descendantDepth: 3,
            includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
            displayPolicy: { mode: 'standard', autoExpand: true },
        });
        return ['S', 'P1', 'P2', 'P3'].filter(id => result.positions.has(id as PersonId))
            .sort((a, b) => result.positions.get(a as PersonId)!.x - result.positions.get(b as PersonId)!.x)
            .join(' ');
    }

    // P1 1866, P3 1880, P2 1908 — data order 2, 3, 1 (not chronological).
    const dates = { '1': '1866', '2': '1908', '3': '1880' };

    it('a man: the extra wives on his left, the earliest next to him', () => {
        const data = threeMarriages('male', ['2', '3', '1'], dates);
        // Primary = the newest marriage (focus has no line through a wife).
        expect(row(data, 'S')).toBe('P3 P1 S P2');
        // Seen from the first marriage's child: that marriage is the primary one.
        expect(row(data, 'c1')).toBe('P2 P3 S P1');
        // From his parents: the same row as from himself.
        expect(row(data, 'gf')).toBe('P3 P1 S P2');
    });

    it('a woman: the extra husbands on her right, the earliest next to her', () => {
        const data = threeMarriages('female', ['2', '3', '1'], dates);
        expect(row(data, 'S')).toBe('P2 S P1 P3');
        expect(row(data, 'c1')).toBe('P1 S P3 P2');
    });

    it('an undated marriage stands after the dated ones', () => {
        const data = threeMarriages('male', ['3', '2', '1'], { '1': '1866', '2': '1908', '3': undefined });
        expect(row(data, 'c1')).toBe('P3 P2 S P1');
    });
});
