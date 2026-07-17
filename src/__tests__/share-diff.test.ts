/**
 * Change packets: diff/apply round-trip, empty diff on equality, and clean
 * detection failure for non-packets.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    buildChangePacket, applyChangePacket, isChangePacket, isEmptyPacket,
} from '../share-diff.js';
import { StromData, PersonId, PartnershipId } from '../types.js';

const comprehensive = JSON.parse(
    readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8')
) as StromData;

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }
/** Compare persons/partnerships/sources only (apply resets version + emits sources). */
function norm(d: StromData) {
    return { persons: d.persons, partnerships: d.partnerships, sources: d.sources ?? {} };
}
const META = { baseExportId: 'X' };

describe('buildChangePacket', () => {
    it('is empty when nothing changed', () => {
        const packet = buildChangePacket(comprehensive, clone(comprehensive), META);
        expect(isEmptyPacket(packet)).toBe(true);
        expect(packet.persons.added).toHaveLength(0);
        expect(packet.persons.changed).toHaveLength(0);
        expect(packet.persons.removedIds).toHaveLength(0);
    });

    it('detects an added, a changed and a removed person', () => {
        const base = clone(comprehensive);
        const current = clone(comprehensive);
        const ids = Object.keys(current.persons) as PersonId[];
        // change one, remove one, add one
        current.persons[ids[0]].firstName = 'CHANGED';
        const removedId = ids[1];
        delete current.persons[removedId];
        const newId = 'p_new' as PersonId;
        current.persons[newId] = { id: newId, firstName: 'New', lastName: 'Person', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };

        const packet = buildChangePacket(base, current, META);
        expect(packet.persons.changed.map(p => p.id)).toContain(ids[0]);
        expect(packet.persons.removedIds).toContain(removedId);
        expect(packet.persons.added.map(p => p.id)).toContain(newId);
    });

    it('detects partnership changes too', () => {
        const base = clone(comprehensive);
        const current = clone(comprehensive);
        const uid = Object.keys(current.partnerships)[0] as PartnershipId;
        current.partnerships[uid].status = current.partnerships[uid].status === 'married' ? 'divorced' : 'married';
        const packet = buildChangePacket(base, current, META);
        expect(packet.partnerships.changed.map(u => u.id)).toContain(uid);
    });
});

describe('applyChangePacket (round-trip)', () => {
    it('apply(base, diff(base, current)) equals current', () => {
        const base = clone(comprehensive);
        const current = clone(comprehensive);
        // A few mutations across collections.
        const ids = Object.keys(current.persons) as PersonId[];
        current.persons[ids[0]].birthPlace = 'Praha';
        delete current.persons[ids[2]];
        const nid = 'p_rt' as PersonId;
        current.persons[nid] = { id: nid, firstName: 'Round', lastName: 'Trip', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };

        const packet = buildChangePacket(base, current, META);
        const rebuilt = applyChangePacket(base, packet);
        expect(norm(rebuilt)).toEqual(norm(current));
    });
});

describe('isChangePacket', () => {
    it('accepts a real packet and rejects other JSON', () => {
        const packet = buildChangePacket(comprehensive, comprehensive, META);
        expect(isChangePacket(packet)).toBe(true);
        expect(isChangePacket({ persons: {}, partnerships: {} })).toBe(false);       // a full tree
        expect(isChangePacket({ kind: 'strom-changes' })).toBe(false);               // no baseExportId
        expect(isChangePacket(null)).toBe(false);
    });

    it('accepts both v1 and v2 format versions', () => {
        expect(isChangePacket({ kind: 'strom-changes', formatVersion: 1, baseExportId: 'X' })).toBe(true);
        expect(isChangePacket({ kind: 'strom-changes', formatVersion: 2, baseExportId: 'X' })).toBe(true);
        expect(isChangePacket({ kind: 'strom-changes', formatVersion: 3, baseExportId: 'X' })).toBe(false);
    });
});

describe('tree-level registries travel in the packet (Fix 3)', () => {
    it('a relative who adds a place coordinate and a surname group sends both', () => {
        const base = clone(comprehensive);
        const current = clone(comprehensive);
        // The relative geocodes a place and groups two spellings.
        current.places = { ...(current.places ?? {}), kolin: { lat: 50.0281, lon: 15.2003, label: 'Kolín' } };
        current.surnameVariants = [...(current.surnameVariants ?? []), ['Víšek', 'Vyšek']];

        const packet = buildChangePacket(base, current, META);
        expect(isEmptyPacket(packet)).toBe(false);
        expect(packet.formatVersion).toBe(2);
        expect(packet.places?.changed.kolin).toBeDefined();
        expect(packet.surnameVariants).toContainEqual(['Víšek', 'Vyšek']);

        const rebuilt = applyChangePacket(base, packet);
        expect(rebuilt.places?.kolin).toEqual({ lat: 50.0281, lon: 15.2003, label: 'Kolín' });
        expect(rebuilt.surnameVariants).toContainEqual(['Víšek', 'Vyšek']);
    });

    it('a place removed by the relative is removed on apply', () => {
        const base = clone(comprehensive);
        base.places = { kolin: { lat: 50.0281, lon: 15.2003, label: 'Kolín' } };
        const current = clone(base);
        delete current.places!.kolin;

        const packet = buildChangePacket(base, current, META);
        expect(packet.places?.removedKeys).toContain('kolin');
        const rebuilt = applyChangePacket(base, packet);
        expect(rebuilt.places?.kolin).toBeUndefined();
    });

    it('unioning a group into an overlapping baseline group keeps transitivity', () => {
        const base = clone(comprehensive);
        base.surnameVariants = [['Vyšek', 'Wischek']];
        const current = clone(base);
        current.surnameVariants = [['Vyšek', 'Wischek'], ['Víšek', 'Vyšek']];

        const packet = buildChangePacket(base, current, META);
        const rebuilt = applyChangePacket(base, packet);
        // Víšek, Vyšek and Wischek must all end up in ONE group.
        const group = (rebuilt.surnameVariants ?? []).find(g => g.some(n => n === 'Víšek'));
        expect(group).toBeDefined();
        expect(group).toEqual(expect.arrayContaining(['Víšek', 'Vyšek', 'Wischek']));
    });

    it('a person-only packet stays v1 (older apps still apply it)', () => {
        const base = clone(comprehensive);
        const current = clone(comprehensive);
        (Object.values(current.persons)[0] as { firstName: string }).firstName = 'CHANGED';
        const packet = buildChangePacket(base, current, META);
        expect(packet.formatVersion).toBe(1);
        expect(packet.places).toBeUndefined();
    });
});
