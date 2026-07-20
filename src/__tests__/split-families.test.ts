/**
 * Splitting the whole tree into families from a focus (N4). The decomposition is
 * pure, so it is checked directly against real fixtures: it must be
 * deterministic, cover every person exactly once (a cousin marriage included),
 * and never place anybody in two families.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { decomposeIntoFamilies, seedIdsFor, DecomposeOptions } from '../split-families.js';
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
function isPlaceholderId(data: StromData, id: PersonId): boolean {
    return !!data.persons[id]?.isPlaceholder;
}

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

const OPTS: DecomposeOptions = {
    ancestorDepth: 2,
    descendantDepth: 2,
    includeAuntsUncles: true,
    includeCousins: true,
};

function checkPartitionAndCoverage(data: StromData, focus: PersonId): void {
    const components = decomposeIntoFamilies(data, focus, OPTS);
    expect(components.length).toBeGreaterThanOrEqual(1);

    // No person appears in two families.
    const seen = new Set<PersonId>();
    for (const c of components) {
        for (const id of c.personIds) {
            expect(seen.has(id)).toBe(false);
            seen.add(id);
        }
    }
    // Every person is covered exactly once → 100% coverage.
    expect(seen.size).toBe(Object.keys(data.persons).length);
    for (const id of Object.keys(data.persons) as PersonId[]) {
        expect(seen.has(id)).toBe(true);
    }

    // Each non-first family has a connector that lives in an EARLIER family.
    const owner = new Map<PersonId, number>();
    components.forEach((c, i) => c.personIds.forEach(id => owner.set(id, i)));
    components.forEach((c, i) => {
        if (c.connectorId) {
            const ownerIdx = owner.get(c.connectorId);
            expect(ownerIdx).not.toBeUndefined();
            expect(ownerIdx!).toBeLessThan(i);
            // The connector is added back as a tree anchor, so it seeds the tree.
            expect(seedIdsFor(c).has(c.connectorId)).toBe(true);
        }
        // The default person the new tree opens on always exists in the data.
        expect(data.persons[c.defaultPersonId]).toBeDefined();
    });
}

describe('decomposeIntoFamilies — devel-demo fixture', () => {
    const data = loadFixture('devel-demo.json');
    const maybe = data ? it : it.skip;

    maybe('is deterministic', () => {
        const focus = firstFocus(data!);
        const a = decomposeIntoFamilies(data!, focus, OPTS);
        const b = decomposeIntoFamilies(data!, focus, OPTS);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    maybe('covers 100% with no person in two families', () => {
        checkPartitionAndCoverage(data!, firstFocus(data!));
    });

    maybe('keeps the cousin marriage (Karel × Vlasta) whole in one family', () => {
        const karel = 'karel_dvorak' as PersonId;
        const vlasta = 'vlasta_dvorakova' as PersonId;
        // Only meaningful if the fixture still holds this pair.
        if (!data!.persons[karel] || !data!.persons[vlasta]) return;

        const components = decomposeIntoFamilies(data!, firstFocus(data!), OPTS);
        const karelIdx = components.findIndex(c => c.personIds.includes(karel));
        const vlastaIdx = components.findIndex(c => c.personIds.includes(vlasta));
        expect(karelIdx).toBeGreaterThanOrEqual(0);
        // Married cousins are one couple → same family, no duplication.
        expect(vlastaIdx).toBe(karelIdx);
    });

    maybe('honours a WYSIWYG first view', () => {
        const focus = firstFocus(data!);
        const view = new Set<PersonId>([focus, ...(data!.persons[focus].childIds as PersonId[])]);
        const components = decomposeIntoFamilies(data!, focus, { ...OPTS, firstViewIds: view });
        expect(components[0].isFirst).toBe(true);
        // The first family is exactly the shown persons (that exist).
        const expected = [...view].filter(id => data!.persons[id]).sort();
        expect([...components[0].personIds].sort()).toEqual(expected);
        expect(components[0].defaultPersonId).toBe(focus);
    });
});

describe('decomposeIntoFamilies — comprehensive fixture', () => {
    const data = loadFixture('comprehensive.json');
    const maybe = data ? it : it.skip;

    maybe('is deterministic', () => {
        const focus = firstFocus(data!);
        const a = decomposeIntoFamilies(data!, focus, OPTS);
        const b = decomposeIntoFamilies(data!, focus, OPTS);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    maybe('covers 100% with no person in two families', () => {
        checkPartitionAndCoverage(data!, firstFocus(data!));
    });
});

describe('decomposeIntoFamilies — every family a reader recognises (synthetic shapes)', () => {
    // Shape from the real data: a grandmother's SECOND marriage. The focus reaches
    // her through her first line; her second husband's tiny family branches off.
    // me → mom → (gpa + gma); gma also married `other` (real, no children).
    const bredlow = tree([
        person('me', 'Petr', 'male', { parentIds: ['mom' as PersonId] }),
        person('mom', 'Marie', 'female', { parentIds: ['gpa', 'gma'] as PersonId[], partnerships: ['u_p'] as PartnershipId[] }),
        person('dad', 'Jan', 'male', { partnerships: ['u_p'] as PartnershipId[], childIds: ['mom'] as PersonId[] }),
        person('gpa', 'Old', 'male', { partnerships: ['u_g'] as PartnershipId[], childIds: ['mom'] as PersonId[] }),
        person('gma', 'Anna', 'female', { partnerships: ['u_g', 'u_o'] as PartnershipId[], childIds: ['mom'] as PersonId[] }),
        person('other', 'Fritz', 'male', { partnerships: ['u_o'] as PartnershipId[] }),
    ], [
        union('u_p', 'dad', 'mom', ['me']),
        union('u_g', 'gpa', 'gma', ['mom']),
        union('u_o', 'other', 'gma', []),
    ]);

    it('names a second-marriage branch after its own spouse, not the in-law it hangs off', () => {
        const comps = decomposeIntoFamilies(bredlow, 'me' as PersonId, OPTS);
        const fritzFamily = comps.find(c => c.personIds.includes('other' as PersonId));
        expect(fritzFamily).toBeDefined();
        // The family is reached THROUGH gma, but it is Fritz's family — so it is
        // named after Fritz, while gma stays the connector (and the tree opens on
        // her, the shared cross-tree card).
        expect(fritzFamily!.connectorId).toBe('gma');
        expect(fritzFamily!.nameAnchorId).toBe('other');
        expect(fritzFamily!.defaultPersonId).toBe('gma');
        // gma herself belongs to an EARLIER family, not to Fritz's.
        const gmaFamily = comps.find(c => c.personIds.includes('gma' as PersonId));
        expect(gmaFamily).not.toBe(fritzFamily);
    });

    // A subtree made only of GEDCOM placeholder slots (Adam's unknown wife and
    // two unnamed children) must never become a family of its own.
    const withPlaceholders = tree([
        person('me', 'Petr', 'male', { partnerships: ['u_m'] as PartnershipId[], childIds: ['kid'] as PersonId[] }),
        person('wife', 'Eva', 'female', { partnerships: ['u_m'] as PartnershipId[], childIds: ['kid'] as PersonId[] }),
        person('kid', 'Adam', 'male', { parentIds: ['me', 'wife'] as PersonId[], partnerships: ['u_k'] as PartnershipId[], childIds: ['phk1', 'phk2'] as PersonId[] }),
        placeholder('phw', 'female', { partnerships: ['u_k'] as PartnershipId[], childIds: ['phk1', 'phk2'] as PersonId[] }),
        placeholder('phk1', 'male', { parentIds: ['kid', 'phw'] as PersonId[] }),
        placeholder('phk2', 'female', { parentIds: ['kid', 'phw'] as PersonId[] }),
    ], [
        union('u_m', 'me', 'wife', ['kid']),
        union('u_k', 'kid', 'phw', ['phk1', 'phk2']),
    ]);

    it('folds a placeholder-only subtree into the real family that owns it (no empty box)', () => {
        const shallow: DecomposeOptions = { ...OPTS, ancestorDepth: 1, descendantDepth: 1 };
        const comps = decomposeIntoFamilies(withPlaceholders, 'me' as PersonId, shallow);
        // No proposed family is placeholders only.
        for (const c of comps) {
            expect(c.personIds.some(id => !isPlaceholderId(withPlaceholders, id))).toBe(true);
        }
        // The placeholders travel with Adam, the real person they hang off.
        const kidComp = comps.find(c => c.personIds.includes('kid' as PersonId))!;
        for (const p of ['phw', 'phk1', 'phk2'] as PersonId[]) {
            expect(kidComp.personIds).toContain(p);
        }
        // Every name anchor is a real person.
        for (const c of comps) {
            expect(isPlaceholderId(withPlaceholders, c.nameAnchorId)).toBe(false);
        }
        // Coverage still totals everyone exactly once.
        const seen = comps.flatMap(c => c.personIds);
        expect(new Set(seen).size).toBe(6);
    });

    // Two people share a name; the birth year (used by the UI label) is what
    // tells the families apart — so each family's anchor is the RIGHT person.
    it('anchors each same-named family on its own person', () => {
        const dup = tree([
            person('a', 'Emil', 'male', { birthDate: '1942', partnerships: ['ua'] as PartnershipId[], childIds: ['ac'] as PersonId[] }),
            person('wa', 'Alena', 'female', { partnerships: ['ua'] as PartnershipId[], childIds: ['ac'] as PersonId[] }),
            person('ac', 'Petr', 'male', { parentIds: ['a', 'wa'] as PersonId[] }),
            person('b', 'Emil', 'male', { birthDate: '1905', partnerships: ['ub'] as PartnershipId[], childIds: ['bc'] as PersonId[] }),
            person('wb', 'Berta', 'female', { partnerships: ['ub'] as PartnershipId[], childIds: ['bc'] as PersonId[] }),
            person('bc', 'Jana', 'female', { parentIds: ['b', 'wb'] as PersonId[] }),
        ], [
            union('ua', 'a', 'wa', ['ac']),
            union('ub', 'b', 'wb', ['bc']),
        ]);
        // Two disconnected Emil families — anchors resolve to real people with
        // the distinguishing birth years.
        const comps = decomposeIntoFamilies(dup, 'a' as PersonId, OPTS);
        for (const c of comps) {
            const anchor = dup.persons[c.nameAnchorId];
            expect(anchor.isPlaceholder).toBe(false);
        }
        const years = comps.map(c => dup.persons[c.nameAnchorId].birthDate).filter(Boolean);
        // The 1942 Emil anchors the first family; the 1905 Emil his own.
        expect(years).toContain('1942');
    });
});
