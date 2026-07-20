/**
 * Splitting one tree into the families it contains (N4). Branch-level granularity
 * (the core family, then the in-law/ancestral BRANCHES that hang off it), but the
 * partition is FOCUS-INVARIANT: it is carved from a reference lineage chosen
 * deterministically from the data (invariant #0), so the same tree always yields
 * the same families. The focus only orders the list (its family first), pre-
 * highlights, and picks the created tree's default person. Every real person is
 * in exactly one family; no family is placeholder-only; it is deterministic.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { decomposeIntoFamilies, seedIdsFor, bestRenderFocus, referenceLineageAnchor } from '../split-families.js';
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
        expect(c.personIds.some(id => !data.persons[id].isPlaceholder)).toBe(true); // no placeholder-only
        expect(data.persons[c.nameAnchorId]?.isPlaceholder).toBe(false);            // real name anchor
        expect(data.persons[c.defaultPersonId]).toBeDefined();
        for (const id of c.personIds) {
            expect(seen.has(id)).toBe(false);   // disjoint
            seen.add(id);
        }
    }
    expect(seen.size).toBe(Object.keys(data.persons).length);   // 100% coverage
    if (comps.some(c => c.personIds.includes(focus))) {
        expect(comps[0].isFirst).toBe(true);
        expect(comps[0].personIds).toContain(focus);            // focus family first
    }
}

// A core family (grandparents → parents → child) with in-laws whose own lines
// hang off the edges. Wgpa is the oldest, so he anchors the largest lineage.
const branchy = tree([
    person('wgpa', 'Wgpa', 'male', { birthDate: '1880', partnerships: [U('uwg')], childIds: [P('wdad')] }),
    person('wgma', 'Wgma', 'female', { birthDate: '1882', partnerships: [U('uwg')], childIds: [P('wdad')] }),
    person('wdad', 'Wdad', 'male', { birthDate: '1910', parentIds: [P('wgpa'), P('wgma')], partnerships: [U('uw')], childIds: [P('wife')] }),
    person('wmom', 'Wmom', 'female', { birthDate: '1912', partnerships: [U('uw')], childIds: [P('wife')] }),
    person('dad', 'Dad', 'male', { birthDate: '1915', partnerships: [U('up')], childIds: [P('me')] }),
    person('mom', 'Mom', 'female', { birthDate: '1917', partnerships: [U('up')], childIds: [P('me')] }),
    person('me', 'Me', 'male', { birthDate: '1940', parentIds: [P('dad'), P('mom')], partnerships: [U('um')], childIds: [P('kid')] }),
    person('wife', 'Wife', 'female', { birthDate: '1942', parentIds: [P('wdad'), P('wmom')], partnerships: [U('um')], childIds: [P('kid')] }),
    person('kid', 'Kid', 'male', { birthDate: '1970', parentIds: [P('me'), P('wife')] }),
], [
    union('uwg', 'wgpa', 'wgma', ['wdad']),
    union('uw', 'wdad', 'wmom', ['wife']),
    union('up', 'dad', 'mom', ['me']),
    union('um', 'me', 'wife', ['kid']),
]);

describe('decomposeIntoFamilies — focus-invariant branch partition', () => {
    it('carves from the senior of the largest blood lineage, ignoring the focus', () => {
        expect(referenceLineageAnchor(branchy)).toBe(P('wgpa'));      // oldest of the one lineage
        // Same partition whoever the focus is.
        expectFocusInvariant(branchy);
        expect(signature(branchy, P('kid'))).toBe(signature(branchy, P('dad')));
    });

    it('keeps branch granularity: a whole three-generation family is ONE family', () => {
        const comps = decomposeIntoFamilies(branchy, P('me'));
        const core = comps.find(c => c.personIds.includes(P('me')))!;
        // Grandparents-in-law through the grandchild all sit in the core family —
        // it is a branch, not a nuclear couple-and-kids sliver.
        for (const id of ['wgpa', 'wgma', 'wdad', 'wmom', 'me', 'wife', 'kid']) {
            expect(core.personIds).toContain(P(id));
        }
        // Me's own parents are the in-law ancestral branch. The NAME belongs
        // to the branch's own senior (the owner's rule: "Rodina X" reads as
        // the family founded by X), the connector stays on the cross-reference.
        const parentsBranch = comps.find(c => c.personIds.includes(P('dad')))!;
        expect(parentsBranch).not.toBe(core);
        expect(parentsBranch.connectorId).toBe(P('me'));
        expect(parentsBranch.nameAnchorId).toBe(P('dad'));
    });

    it('is clean, deterministic and lists the focus family first with its default person', () => {
        expectCleanPartition(branchy, P('dad'));
        const comps = decomposeIntoFamilies(branchy, P('dad'));
        expect(comps[0].personIds).toContain(P('dad'));
        expect(comps[0].defaultPersonId).toBe(P('dad'));   // opens on the focus
        expect(signature(branchy, P('dad'))).toBe(signature(branchy, P('dad')));
    });
});

describe('decomposeIntoFamilies — second marriage names its own spouse', () => {
    // The main line Johann→Karl→Anselm; Anna (Johann's wife) also married Fritz.
    const remarriage = tree([
        person('johann', 'Johann', 'male', { birthDate: '1840', partnerships: [U('u1')], childIds: [P('karl')] }),
        person('anna', 'Anna', 'female', { birthDate: '1845', partnerships: [U('u1'), U('u2')], childIds: [P('karl')] }),
        person('karl', 'Karl', 'male', { birthDate: '1870', parentIds: [P('johann'), P('anna')], partnerships: [U('u3')], childIds: [P('anselm')] }),
        person('kw', 'Klára', 'female', { birthDate: '1872', partnerships: [U('u3')], childIds: [P('anselm')] }),
        person('anselm', 'Anselm', 'male', { birthDate: '1900', parentIds: [P('karl'), P('kw')] }),
        person('fritz', 'Fritz', 'male', { birthDate: '1843', partnerships: [U('u2')] }),
    ], [
        union('u1', 'johann', 'anna', ['karl']),
        union('u3', 'karl', 'kw', ['anselm']),
        { ...union('u2', 'fritz', 'anna', []), isPrimary: false },
    ]);

    it('keeps a second husband in his wife\'s family (a mother stays with all her unions)', () => {
        expectFocusInvariant(remarriage);
        expectCleanPartition(remarriage, P('karl'));
        const comps = decomposeIntoFamilies(remarriage, P('karl'));
        const fam = comps.find(c => c.personIds.includes(P('fritz')))!;
        // Fritz rides with Anna — her family holds both her unions.
        expect(fam.personIds).toContain(P('anna'));
        expect(fam.personIds).toContain(P('johann'));
        // The family carries the lineage name (Johann, its senior), not Fritz's.
        expect(fam.nameAnchorId).toBe(P('johann'));
    });
});

describe('decomposeIntoFamilies — placeholders never stand alone', () => {
    const withPlaceholders = tree([
        person('gpa', 'Gpa', 'male', { birthDate: '1900', partnerships: [U('ug')], childIds: [P('a')] }),
        person('gma', 'Gma', 'female', { birthDate: '1902', partnerships: [U('ug')], childIds: [P('a')] }),
        person('a', 'A', 'male', { birthDate: '1930', parentIds: [P('gpa'), P('gma')], partnerships: [U('ua')], childIds: [P('son')] }),
        person('b', 'B', 'female', { birthDate: '1932', partnerships: [U('ua')], childIds: [P('son')] }),
        person('son', 'Son', 'male', { birthDate: '1960', parentIds: [P('a'), P('b')], partnerships: [U('us')], childIds: [P('gk')] }),
        placeholder('phw', 'female', { partnerships: [U('us')], childIds: [P('gk')] }),
        placeholder('gk', 'male', { parentIds: [P('son'), P('phw')] }),
    ], [
        union('ug', 'gpa', 'gma', ['a']),
        union('ua', 'a', 'b', ['son']),
        union('us', 'son', 'phw', ['gk']),
    ]);

    it('folds the unknown wife + grandchild into a real family; covers everyone', () => {
        expectFocusInvariant(withPlaceholders);
        expectCleanPartition(withPlaceholders, P('a'));
    });
});

describe('decomposeIntoFamilies — duplicate names', () => {
    it('anchors each same-named family on its own real person', () => {
        const dup = tree([
            person('a', 'Emil', 'male', { birthDate: '1942', partnerships: [U('ua')], childIds: [P('ac')] }),
            person('wa', 'Alena', 'female', { partnerships: [U('ua')], childIds: [P('ac')] }),
            person('ac', 'Petr', 'male', { parentIds: [P('a'), P('wa')] }),
            person('b', 'Emil', 'male', { birthDate: '1905', partnerships: [U('ub')], childIds: [P('bc')] }),
            person('wb', 'Berta', 'female', { partnerships: [U('ub')], childIds: [P('bc')] }),
            person('bc', 'Jana', 'female', { parentIds: [P('b'), P('wb')] }),
        ], [union('ua', 'a', 'wa', ['ac']), union('ub', 'b', 'wb', ['bc'])]);
        expectFocusInvariant(dup);
        for (const c of decomposeIntoFamilies(dup, P('a'))) {
            expect(dup.persons[c.nameAnchorId].isPlaceholder).toBe(false);
        }
    });
});

describe('bestRenderFocus', () => {
    it('picks a member from which the whole family lays out', () => {
        expect(branchy.persons[bestRenderFocus(branchy)]).toBeDefined();
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
