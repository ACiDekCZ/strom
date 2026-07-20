/**
 * Splitting one tree into the families it contains (N4). The decomposition is a
 * pure, FOCUS-INVARIANT partition: the same data always yields the same families
 * (invariant #0), every real person lands in exactly one, no family is
 * placeholder-only, and it is deterministic. The focus only affects order.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { decomposeIntoFamilies, seedIdsFor, bestRenderFocus } from '../split-families.js';
import { StromData, PersonId, Person, Partnership, PartnershipId } from '../types.js';

// ---- Tiny synthetic-tree builder (no real family data) ----
function person(id: string, first: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'X', gender,
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
    } as Person;
}
function placeholder(id: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return person(id, '', gender, { isPlaceholder: true, ...extra });
}
function union(id: string, a: string, b: string, children: string[] = []): Partnership {
    return {
        id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
        childIds: children as PersonId[], status: 'married',
    };
}
function tree(persons: Person[], partnerships: Partnership[]): StromData {
    return {
        version: 5,
        persons: Object.fromEntries(persons.map(p => [p.id, p])),
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])),
    } as StromData;
}
const P = (id: string): PersonId => id as PersonId;
const U = (id: string): PartnershipId => id as PartnershipId;

/** The sorted-groups-of-sorted-ids signature — identical iff the partition is. */
function signature(data: StromData, focus: PersonId): string {
    return decomposeIntoFamilies(data, focus)
        .map(c => [...c.personIds].sort().join(','))
        .sort()
        .join('|');
}

/** Focus-invariance (invariant #0): every person as focus gives ONE partition. */
function expectFocusInvariant(data: StromData): void {
    const ids = Object.keys(data.persons) as PersonId[];
    const sigs = new Set(ids.map(f => signature(data, f)));
    expect(sigs.size).toBe(1);
}

function expectCleanPartition(data: StromData, focus: PersonId): void {
    const comps = decomposeIntoFamilies(data, focus);
    const seen = new Set<PersonId>();
    for (const c of comps) {
        // No family is placeholder-only.
        expect(c.personIds.some(id => !data.persons[id].isPlaceholder)).toBe(true);
        // The name anchor and default person are real, existing persons.
        expect(data.persons[c.nameAnchorId]).toBeDefined();
        expect(data.persons[c.defaultPersonId]).toBeDefined();
        expect(data.persons[c.nameAnchorId].isPlaceholder).toBe(false);
        for (const id of c.personIds) {
            expect(seen.has(id)).toBe(false);   // disjoint
            seen.add(id);
        }
    }
    // 100% coverage.
    expect(seen.size).toBe(Object.keys(data.persons).length);
    // The focus's own family is listed first.
    expect(comps[0].isFirst).toBe(true);
    expect(comps[0].personIds.includes(focus)).toBe(true);
}

describe('decomposeIntoFamilies — focus-invariant nuclear partition', () => {
    // A three-generation family with in-laws on both sides.
    const family = tree([
        person('gpa', 'Old', 'male', { partnerships: [U('u_g')], childIds: [P('dad')] }),
        person('gma', 'Stará', 'female', { partnerships: [U('u_g')], childIds: [P('dad')] }),
        person('dad', 'Jan', 'male', { parentIds: [P('gpa'), P('gma')], partnerships: [U('u_p')], childIds: [P('me'), P('bro')] }),
        person('mom', 'Marie', 'female', { partnerships: [U('u_p')], childIds: [P('me'), P('bro')] }),
        person('me', 'Petr', 'male', { parentIds: [P('dad'), P('mom')], partnerships: [U('u_m')], childIds: [P('kid')] }),
        person('bro', 'Josef', 'male', { parentIds: [P('dad'), P('mom')] }),
        person('wife', 'Eva', 'female', { partnerships: [U('u_m')], childIds: [P('kid')] }),
        person('kid', 'Adam', 'male', { parentIds: [P('me'), P('wife')] }),
    ], [
        union('u_g', 'gpa', 'gma', ['dad']),
        union('u_p', 'dad', 'mom', ['me', 'bro']),
        union('u_m', 'me', 'wife', ['kid']),
    ]);

    it('gives the SAME families whoever the focus is (invariant #0)', () => {
        expectFocusInvariant(family);
    });

    it('is a clean, deterministic, fully-covering partition', () => {
        expectCleanPartition(family, P('me'));
        expect(signature(family, P('me'))).toBe(signature(family, P('me')));
    });

    it('groups each couple with its unmarried children; married children start their own', () => {
        const comps = decomposeIntoFamilies(family, P('me'));
        const familyOf = (id: string): number => comps.findIndex(c => c.personIds.includes(P(id)));
        expect(familyOf('gpa')).toBe(familyOf('gma'));       // grandparents together
        expect(familyOf('dad')).toBe(familyOf('mom'));       // parents together
        expect(familyOf('bro')).toBe(familyOf('dad'));       // unmarried son stays home
        expect(familyOf('me')).not.toBe(familyOf('dad'));    // married son moved out
        expect(familyOf('me')).toBe(familyOf('wife'));       // Petr + Eva + Adam
        expect(familyOf('kid')).toBe(familyOf('me'));
        // Three nuclear families: grandparents; parents + unmarried Josef; Petr's.
        expect(comps.length).toBe(3);
    });

    it('lists the focus person\'s own family first, whoever it is', () => {
        expect(decomposeIntoFamilies(family, P('bro'))[0].personIds).toContain(P('bro'));
        expect(decomposeIntoFamilies(family, P('gpa'))[0].personIds).toContain(P('gpa'));
        // ...but the set of families is identical either way.
        expect(signature(family, P('bro'))).toBe(signature(family, P('gpa')));
    });
});

describe('decomposeIntoFamilies — second marriage', () => {
    // Anna married Johann first (a child), then Fritz. Anna is owned by her
    // primary (Johann) union; Fritz becomes his own one-person family.
    const remarriage = tree([
        person('johann', 'Johann', 'male', { partnerships: [U('u1')], childIds: [P('child')] }),
        person('anna', 'Anna', 'female', { partnerships: [U('u1'), U('u2')], childIds: [P('child')] }),
        person('child', 'Kind', 'male', { parentIds: [P('johann'), P('anna')] }),
        person('fritz', 'Fritz', 'male', { partnerships: [U('u2')] }),
    ], [
        union('u1', 'johann', 'anna', ['child']),
        { ...union('u2', 'fritz', 'anna', []), isPrimary: false },
    ]);

    it('keeps the first couple whole and makes the second spouse his own family', () => {
        expectFocusInvariant(remarriage);
        const comps = decomposeIntoFamilies(remarriage, P('johann'));
        const familyOf = (id: string): number => comps.findIndex(c => c.personIds.includes(P(id)));
        expect(familyOf('johann')).toBe(familyOf('anna'));    // couple atomic
        expect(familyOf('child')).toBe(familyOf('johann'));   // child with parents
        expect(familyOf('fritz')).not.toBe(familyOf('anna')); // Fritz his own family
        const fritz = comps.find(c => c.personIds.includes(P('fritz')))!;
        expect(fritz.nameAnchorId).toBe(P('fritz'));          // named after himself
        expect(fritz.connectorId).toBe(P('anna'));            // linked back to Anna
    });
});

describe('decomposeIntoFamilies — placeholders', () => {
    // A real couple whose son married an UNKNOWN woman and had unknown children:
    // that whole placeholder brood must fold into a real family, never stand alone.
    const withPlaceholders = tree([
        person('a', 'Real', 'male', { partnerships: [U('ua')], childIds: [P('son')] }),
        person('b', 'Realka', 'female', { partnerships: [U('ua')], childIds: [P('son')] }),
        person('son', 'Syn', 'male', { parentIds: [P('a'), P('b')], partnerships: [U('us')], childIds: [P('gk')] }),
        placeholder('phw', 'female', { partnerships: [U('us')], childIds: [P('gk')] }),
        placeholder('gk', 'male', { parentIds: [P('son'), P('phw')] }),
    ], [
        union('ua', 'a', 'b', ['son']),
        union('us', 'son', 'phw', ['gk']),
    ]);

    it('never proposes a placeholder-only family and still covers everyone', () => {
        expectFocusInvariant(withPlaceholders);
        expectCleanPartition(withPlaceholders, P('a'));
        const comps = decomposeIntoFamilies(withPlaceholders, P('a'));
        // The unknown wife + grandchild travel with the son (their nearest real).
        const sonFam = comps.find(c => c.personIds.includes(P('son')))!;
        expect(sonFam.personIds).toContain(P('phw'));
        expect(sonFam.personIds).toContain(P('gk'));
    });
});

describe('decomposeIntoFamilies — duplicate names', () => {
    it('anchors each same-named family on its own person (year disambiguates in UI)', () => {
        const dup = tree([
            person('a', 'Emil', 'male', { birthDate: '1942', partnerships: [U('ua')], childIds: [P('ac')] }),
            person('wa', 'Alena', 'female', { partnerships: [U('ua')], childIds: [P('ac')] }),
            person('ac', 'Petr', 'male', { parentIds: [P('a'), P('wa')] }),
            person('b', 'Emil', 'male', { birthDate: '1905', partnerships: [U('ub')], childIds: [P('bc')] }),
            person('wb', 'Berta', 'female', { partnerships: [U('ub')], childIds: [P('bc')] }),
            person('bc', 'Jana', 'female', { parentIds: [P('b'), P('wb')] }),
        ], [union('ua', 'a', 'wa', ['ac']), union('ub', 'b', 'wb', ['bc'])]);
        expectFocusInvariant(dup);
        const comps = decomposeIntoFamilies(dup, P('a'));
        for (const c of comps) expect(dup.persons[c.nameAnchorId].isPlaceholder).toBe(false);
        const years = comps.map(c => dup.persons[c.nameAnchorId].birthDate).filter(Boolean);
        expect(years).toContain('1942');
        expect(years).toContain('1905');
    });
});

describe('bestRenderFocus', () => {
    it('picks a member from which the whole family lays out', () => {
        const fam = tree([
            person('h', 'H', 'male', { partnerships: [U('u')], childIds: [P('c')] }),
            person('w', 'W', 'female', { partnerships: [U('u')], childIds: [P('c')] }),
            person('c', 'C', 'male', { parentIds: [P('h'), P('w')] }),
        ], [union('u', 'h', 'w', ['c'])]);
        expect(fam.persons[bestRenderFocus(fam)]).toBeDefined();
    });
});

// ---- Committed synthetic fixtures: still a clean, focus-invariant partition ----
function loadFixture(name: string): StromData | null {
    const path = join(process.cwd(), 'test', name);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as StromData;
}
function firstFocus(data: StromData): PersonId {
    const def = data.defaultPersonId;
    if (typeof def === 'string' && data.persons[def as PersonId]) return def as PersonId;
    return (Object.keys(data.persons) as PersonId[]).sort()[0];
}

for (const fixture of ['devel-demo.json', 'comprehensive.json']) {
    describe(`decomposeIntoFamilies — ${fixture}`, () => {
        const data = loadFixture(fixture);
        const maybe = data ? it : it.skip;

        maybe('is focus-invariant', () => expectFocusInvariant(data!));
        maybe('covers 100% with no placeholder-only family, deterministically', () => {
            expectCleanPartition(data!, firstFocus(data!));
        });
        maybe('every family seeds a valid render', () => {
            for (const c of decomposeIntoFamilies(data!, firstFocus(data!))) {
                const seeds = seedIdsFor(c);
                expect(seeds.has(c.defaultPersonId) || c.personIds.includes(c.defaultPersonId)).toBe(true);
            }
        });
    });
}
