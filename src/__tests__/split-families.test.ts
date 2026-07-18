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
import { StromData, PersonId } from '../types.js';

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
