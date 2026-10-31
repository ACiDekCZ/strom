/**
 * Keyboard navigation between fan sectors (spec 029 §1.7): ←/→ along a
 * ring in reading order, ↑ to a parent, ↓ to a child, through the focus to
 * the descendants of the two-way fan.
 */

import { describe, it, expect } from 'vitest';
import { buildFanModel } from '../fan-chart.js';
import { fanNavNodes, fanNavMove } from '../fan-nav.js';
import { StromData, Person, PersonId, Gender, Partnership, PartnershipId } from '../types.js';

function person(id: string, gender: Gender = 'male', parentIds: string[] = []): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender, isPlaceholder: false,
        parentIds: parentIds as PersonId[], childIds: [], partnerships: [],
    };
}

function tree(unions: Array<[string, string, string[]]> = []): StromData {
    const persons = [
        person('f', 'male', ['pgf', 'pgm']),
        person('m', 'female', ['mgf', 'mgm']),
        person('me', 'male', ['f', 'm']),
        person('pgf'), person('pgm', 'female'),
        person('mgf'), person('mgm', 'female'),
        person('w', 'female'), person('c1'), person('c2', 'female'),
    ];
    const d: StromData = { persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'], partnerships: {} };
    unions.forEach(([a, b, kids], i) => {
        const u: Partnership = { id: `u${i}` as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        d.partnerships[u.id] = u;
        for (const pid of [a, b]) {
            const p = d.persons[pid as PersonId];
            p.partnerships.push(u.id);
            for (const c of kids) {
                if (!p.childIds.includes(c as PersonId)) p.childIds.push(c as PersonId);
                const ch = d.persons[c as PersonId];
                if (!ch.parentIds.includes(pid as PersonId)) ch.parentIds.push(pid as PersonId);
            }
        }
    });
    return d;
}

describe('fan keyboard navigation', () => {
    const model = buildFanModel(tree(), 'me' as PersonId, { generations: 2 })!;
    const nodes = fanNavNodes(model, false);

    it('moves along a ring from the left, without wrapping in the half fan', () => {
        // Ring 2 reads pgf, pgm, mgf, mgm from the left.
        expect(fanNavMove(nodes, 'a4', 'right')).toBe('a5');
        expect(fanNavMove(nodes, 'a5', 'right')).toBe('a6');
        expect(fanNavMove(nodes, 'a6', 'left')).toBe('a5');
        expect(fanNavMove(nodes, 'a7', 'right')).toBeNull();
        expect(fanNavMove(nodes, 'a4', 'left')).toBeNull();
        expect(fanNavMove(nodes, 'f', 'left')).toBeNull();
    });

    it('goes up to a parent and down to the child', () => {
        expect(fanNavMove(nodes, 'f', 'up')).toBe('a2');
        expect(fanNavMove(nodes, 'a3', 'up')).toBe('a6');
        expect(fanNavMove(nodes, 'a7', 'down')).toBe('a3');
        expect(fanNavMove(nodes, 'a2', 'down')).toBe('f');
        expect(fanNavMove(nodes, 'a5', 'up')).toBeNull();
        expect(fanNavMove(nodes, 'f', 'down')).toBeNull();
    });

    it('wraps round the ring of the full circle', () => {
        const full = buildFanModel(tree(), 'me' as PersonId, { generations: 2, shape: 'full' })!;
        const n = fanNavNodes(full, false);
        const ring2 = ['a4', 'a5', 'a6', 'a7'];
        const first = ring2.find(k => fanNavMove(n, k, 'left') === null)!;
        const last = ring2.find(k => fanNavMove(n, k, 'right') === null)!;
        expect(first).not.toBe(last);
        expect(fanNavMove(n, last, 'right', true)).toBe(first);
        expect(fanNavMove(n, first, 'left', true)).toBe(last);
    });

    it('reaches empty slots only while editing', () => {
        const d = tree();
        d.persons['m' as PersonId].parentIds = [];
        const m = buildFanModel(d, 'me' as PersonId, { generations: 2 })!;
        expect(fanNavNodes(m, false).some(n => n.key === 'a6')).toBe(false);
        expect(fanNavNodes(m, true).some(n => n.key === 'a6')).toBe(true);
        expect(fanNavMove(fanNavNodes(m, false), 'a3', 'up')).toBeNull();
        expect(fanNavMove(fanNavNodes(m, true), 'a3', 'up')).toBe('a6');
    });

    it('goes down from the focus to the descendants of the two-way fan and back', () => {
        const d = tree([['me', 'w', ['c1', 'c2']]]);
        const two = buildFanModel(d, 'me' as PersonId, { generations: 2, shape: 'two', descGenerations: 1 })!;
        const n = fanNavNodes(two, false);
        const band = two.desc.find(s => s.kind === 'partner' && s.person?.id === 'w')!;
        const c1 = two.desc.find(s => s.person?.id === 'c1')!;
        const c2 = two.desc.find(s => s.person?.id === 'c2')!;
        expect(fanNavMove(n, 'f', 'down')).toBe(band.key);
        expect(fanNavMove(n, band.key, 'down')).toBe(c1.key);
        expect(fanNavMove(n, c1.key, 'right')).toBe(c2.key);
        expect(fanNavMove(n, c2.key, 'up')).toBe(band.key);
        expect(fanNavMove(n, band.key, 'up')).toBe('f');
    });
});
