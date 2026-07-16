/**
 * Descendants view "lineage only" expansion (DisplayPolicy.expandLineageOnly):
 * partners of descendants keep their card, but their OTHER unions and those
 * unions' children (step-relatives) are excluded unless whole families are
 * requested.
 */

import { describe, it, expect } from 'vitest';
import { runLayoutPipeline, collectBloodDescendants, collectBloodRelatives } from '../pipeline/index.js';
import { StromData, Person, PersonId, PartnershipId, Gender, DEFAULT_LAYOUT_CONFIG } from '../../types.js';

function person(id: string, gender: Gender, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [],
        ...o,
    };
}

/**
 * grandpa ─┬─ grandma
 *          son ─┬─ wife ─┬─ exHusband
 *             child   stepChild
 */
function buildData(): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, g] of [['grandpa', 'male'], ['grandma', 'female'], ['son', 'male'],
        ['wife', 'female'], ['exHusband', 'male'], ['child', 'male'], ['stepChild', 'female']] as const) {
        persons[id] = person(id, g);
    }
    const partnerships: StromData['partnerships'] = {} as StromData['partnerships'];
    const union = (id: string, a: string, b: string, children: string[]) => {
        (partnerships as Record<string, unknown>)[id] = {
            id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
            childIds: children as PersonId[], status: 'married',
        };
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const c of children) {
            persons[c].parentIds = [a as PersonId, b as PersonId];
            persons[a].childIds.push(c as PersonId);
            persons[b].childIds.push(c as PersonId);
        }
    };
    union('u1', 'grandpa', 'grandma', ['son']);
    union('u2', 'son', 'wife', ['child']);
    union('u3', 'exHusband', 'wife', ['stepChild']);
    return { persons: persons as StromData['persons'], partnerships };
}

function run(expandLineageOnly: boolean) {
    return runLayoutPipeline({
        data: buildData(),
        focusPersonId: 'grandpa' as PersonId,
        config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 0,
        descendantDepth: 10,
        includeSpouseAncestors: false,
        includeParentSiblings: false,
        includeParentSiblingDescendants: false,
        displayPolicy: { mode: 'expanded', autoExpand: true, expandLineageOnly },
    });
}

describe('collectBloodDescendants', () => {
    it('returns focus + blood descendants only', () => {
        const blood = collectBloodDescendants(buildData(), 'grandpa' as PersonId);
        expect([...blood].sort()).toEqual(['child', 'grandpa', 'son']);
    });
});

describe('collectBloodRelatives', () => {
    /**
     *  ggpa ─┬─ ggma ─── ggma2   (ggma2 = great-grandma's 2nd husband, childless)
     *       gpa ─┬─ gma
     *   ┌───────┴───────┐
     * uncle ─ aunt    dad ─┬─ mom     (mom's own parents momDad/momMom = maternal
     *   │                 me ─── spouse       grandparents, genuine blood)
     * cousin              kid       spouseDad ─── spouse
     *
     * spouseDad is reachable from ME only by stepping DOWN to the shared child
     * kid and then UP to kid's OTHER parent (me → kid → spouse → spouseDad) —
     * the classic naive parent+child BFS leak. It must NOT count as ME's blood.
     * Contrast momDad, a true maternal grandfather, which IS blood.
     */
    function kinData(): StromData {
        const persons: Record<string, Person> = {};
        for (const [id, g] of [
            ['ggpa', 'male'], ['ggma', 'female'], ['ggma2', 'male'],
            ['gpa', 'male'], ['gma', 'female'],
            ['uncle', 'male'], ['aunt', 'female'], ['dad', 'male'], ['mom', 'female'],
            ['momDad', 'male'], ['momMom', 'female'],
            ['me', 'male'], ['cousin', 'female'], ['spouse', 'female'], ['kid', 'male'],
            ['spouseDad', 'male'], ['spouseMom', 'female'],
        ] as const) {
            persons[id] = person(id, g);
        }
        const partnerships: StromData['partnerships'] = {} as StromData['partnerships'];
        const union = (id: string, a: string, b: string, children: string[]) => {
            (partnerships as Record<string, unknown>)[id] = {
                id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
                childIds: children as PersonId[], status: 'married',
            };
            persons[a].partnerships.push(id as PartnershipId);
            persons[b].partnerships.push(id as PartnershipId);
            for (const c of children) {
                persons[c].parentIds.push(a as PersonId, b as PersonId);
                persons[a].childIds.push(c as PersonId);
                persons[b].childIds.push(c as PersonId);
            }
        };
        union('gg', 'ggpa', 'ggma', ['gpa']);        // great-grandparents → grandpa
        union('gg2', 'ggma2', 'ggma', []);           // great-grandma's 2nd husband (childless)
        union('g', 'gpa', 'gma', ['uncle', 'dad']);  // grandparents → uncle + dad
        union('u', 'uncle', 'aunt', ['cousin']);     // uncle's child = cousin
        union('p', 'dad', 'mom', ['me']);            // parents → me
        union('mp', 'momDad', 'momMom', ['mom']);    // mom's parents = maternal grandparents
        union('k', 'me', 'spouse', ['kid']);         // focus's own union → kid
        union('sp', 'spouseDad', 'spouseMom', ['spouse']); // spouse's parents (in-law blood)
        return { persons: persons as StromData['persons'], partnerships };
    }

    it('includes ancestors, and descendants of ancestors (siblings, uncles, cousins)', () => {
        const blood = collectBloodRelatives(kinData(), 'me' as PersonId);
        expect(blood.has('me' as PersonId)).toBe(true);
        expect(blood.has('dad' as PersonId)).toBe(true);      // parent
        expect(blood.has('gpa' as PersonId)).toBe(true);      // grandparent
        expect(blood.has('ggma' as PersonId)).toBe(true);     // great-grandparent
        expect(blood.has('momDad' as PersonId)).toBe(true);   // maternal grandfather (true ancestor)
        expect(blood.has('uncle' as PersonId)).toBe(true);    // parent's sibling
        expect(blood.has('cousin' as PersonId)).toBe(true);   // descendant of a grandparent
    });

    it('does NOT leak to an in-law\'s blood through a shared child (naive-BFS case)', () => {
        const blood = collectBloodRelatives(kinData(), 'me' as PersonId);
        expect(blood.has('kid' as PersonId)).toBe(true);       // shared child IS blood
        expect(blood.has('spouse' as PersonId)).toBe(false);   // kid's other parent: not blood
        expect(blood.has('spouseDad' as PersonId)).toBe(false); // spouse's father: not blood
        expect(blood.has('spouseMom' as PersonId)).toBe(false); // spouse's mother: not blood
        expect(blood.has('aunt' as PersonId)).toBe(false);     // uncle's wife: in-law, not blood
    });

    it('excludes a childless second spouse of an ancestor', () => {
        const blood = collectBloodRelatives(kinData(), 'me' as PersonId);
        expect(blood.has('ggma2' as PersonId)).toBe(false);   // great-grandma's 2nd husband
    });

    it('down-closure catches the focus\'s own subtree but not their partner', () => {
        const blood = collectBloodRelatives(kinData(), 'me' as PersonId);
        expect(blood.has('kid' as PersonId)).toBe(true);      // focus's child
        expect(blood.has('spouse' as PersonId)).toBe(false);  // partner, not blood
    });
});

describe('descendants view lineage-only expansion', () => {
    it('excludes the partner\'s other union and step-children', () => {
        const result = run(true);
        const shown = new Set(result.positions.keys());
        expect(shown.has('son' as PersonId)).toBe(true);
        expect(shown.has('wife' as PersonId)).toBe(true);      // partner of a descendant stays
        expect(shown.has('child' as PersonId)).toBe(true);
        expect(shown.has('stepChild' as PersonId)).toBe(false); // not grandpa's blood
        expect(shown.has('exHusband' as PersonId)).toBe(false); // partner's other partner
    });

    it('whole-families mode still shows them', () => {
        const result = run(false);
        const shown = new Set(result.positions.keys());
        expect(shown.has('stepChild' as PersonId)).toBe(true);
        expect(shown.has('exHusband' as PersonId)).toBe(true);
    });
});
