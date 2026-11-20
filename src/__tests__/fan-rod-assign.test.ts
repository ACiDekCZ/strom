/**
 * Fan chart in family-line colours (spec 114 §1, §3, §10): the sides of the
 * lines, their slots, the memory of the previous state, the legend's data.
 *
 * The sample data (fictional plant surnames) and the expected slots come from
 * the reference implementation the design was drawn with (fixtures/
 * fan-rod-reference.json): the same fan models, the same sides and counts, the
 * same strong slots. The reference greyed the lines past the 20th place and
 * the lines drawn once; K1.7 colours every line, so those differ.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    assignFanRodColors, assignFanRodSlots, fanRodSides, fanRodAdjacency, fanRodNear, fanRodLegend, fanRodSlotOf,
    FAN_ROD_MAX_STRONG, FAN_ROD_LEGEND_MAIN, FanRodAssignment, FanRodInfo, FanRodModel, FAN_ROD_MAIN, fanRodMainSet,
} from '../fan-rod-assign.js';
import {
    FanRodSlot, FAN_ROD_SLOTS, fanRodSlotColor, deltaE, deltaEDeutan, parseFanRodSlot, FAN_PALETTES, fanMixWhite, FAN_PRINT_DIM, FAN_PRINT_EDGE,
    fanRodSlotDistance, fanFill,
} from '../fan-colors.js';
import { buildFanModel, buildFanSvg, buildFanPosterSvg, fanPosterGeometry, FanShape, FanHighlight } from '../fan-chart.js';
import { buildLineages, LineageIndex, RodId, rodOf, rodLabels, realRodMembers } from '../lineage.js';
import { strings } from '../strings.js';
import { StromData, Person, PersonId, Gender, PartnershipId, Partnership } from '../types.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

// ---------------------------------------------------------------- the reference

interface RefState {
    name: string;
    after: string | null;
    model: { focus: string; shape: string; sectors: Array<[number, number, string]>; desc: Array<[string, number, number, number, number]> };
    slots: Record<string, string>;
    memory: Record<string, string>;
    groups: Record<string, string>;
    counts: Record<string, number>;
}
interface Ref {
    tree: Record<string, number>;
    label: Record<string, string>;
    persons: Record<string, string>;
    states: RefState[];
    hex: Record<string, [string, string]>;
}
const REF: Ref = JSON.parse(readFileSync(join(__dirname, 'fixtures/fan-rod-reference.json'), 'utf8'));

const refPerson = (id: string) => ({ id }) as unknown as Person;

/** The reference's lines: one per surname (separate chains of a surname are the same line there). */
function refIndex(reverse = false): LineageIndex {
    const people = Object.entries(REF.persons);
    const rods = Object.entries(REF.tree);
    if (reverse) { people.reverse(); rods.reverse(); }
    return {
        data: { persons: {}, partnerships: {} } as unknown as StromData,
        rodByPerson: new Map(people.map(([p, r]) => [p as PersonId, (r || null) as RodId | null])),
        rods: new Map(rods.map(([id, tree]) => [id as RodId, { id, realMemberCount: tree }])) as unknown as LineageIndex['rods'],
        lineParent: new Map(),
        cutParent: new Map(),
    };
}

function refModel(s: RefState): FanRodModel {
    return {
        focus: refPerson(s.model.focus),
        shape: s.model.shape,
        sectors: s.model.sectors.map(([ahnentafel, generation, p]) => ({ ahnentafel, generation, person: refPerson(p) })),
        desc: s.model.desc.map(([p, r1, r2, lo, hi]) => ({ person: refPerson(p), r1, r2, lo, hi })),
    };
}

const state = (name: string) => REF.states.find(s => s.name === name)!;

/** Every state of the reference, each after its previous one (the memory carried). */
function runReference(index = refIndex()): Map<string, FanRodAssignment> {
    const out = new Map<string, FanRodAssignment>();
    for (const s of REF.states) {
        const memory = s.after ? out.get(s.after)!.memory : null;
        out.set(s.name, assignFanRodColors(refModel(s), index, memory));
    }
    return out;
}

const obj = (m: ReadonlyMap<string, string>) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)));

describe('the reference (sample data of the design)', () => {
    const got = runReference();

    it.each(REF.states.map(s => s.name))('state %s: the same sides, counts and strong slots; every line coloured, remembered', name => {
        const s = state(name);
        const a = got.get(name)!;
        expect(Object.fromEntries(a.rods.map(r => [r.id, r.group]))).toEqual(s.groups);
        expect(Object.fromEntries(a.rods.map(r => [r.id, r.count]))).toEqual(s.counts);
        expect(a.slotOf.size).toBe(a.rods.length);
        // Remembered: every line drawn with its slot, and the lines out of view with theirs from before (K1.2).
        for (const [id, slot] of a.slotOf) expect(a.memory.get(id)).toBe(slot);
        const before = s.after ? got.get(s.after)!.memory : new Map<RodId, FanRodSlot>();
        for (const [id, slot] of before) if (!a.slotOf.has(id)) expect(a.memory.get(id), `${name} ${id}`).toBe(slot);
        expect(a.memory.size).toBe(new Set([...a.slotOf.keys(), ...before.keys()]).size);
        // The strong lines on their group's strong shades: the reference's slot (the table widened after it, K1.7).
        for (const r of a.rods) {
            const ref = s.slots[r.id] ? parseFanRodSlot(s.slots[r.id]) : null;
            if (r.tier === 'S' && !r.kept && ref && ref.group === r.group && ref.tier === 'S') expect(a.slotOf.get(r.id), `${name} ${REF.label[r.id]}`).toBe(s.slots[r.id]);
        }
    });

    it('fresh fans (A, half5): every line the reference coloured has the reference\'s slot', () => {
        for (const name of ['A', 'half5']) {
            const s = state(name), a = got.get(name)!;
            for (const [id, slot] of Object.entries(s.slots)) expect(a.slotOf.get(id as RodId), `${name} ${REF.label[id]}`).toBe(slot);
        }
    });

    it('sides (test 7): Adéla’s fan has the father’s, the mother’s and the descendants’ lines; Klásek coloured; the centre on PS0', () => {
        const a = got.get('A')!;
        const of = (g: string) => a.rods.filter(r => r.group === g).map(r => REF.label[r.id]).sort();
        expect(of('P')).toEqual(['Bodlák', 'Jasánek', 'Lískovec', 'Mechovský', 'Sládeček']);
        expect(of('M')).toEqual(['Ječmínek', 'Klásek', 'Rozmarýn', 'Vřesák', 'Řeřicha'].sort());
        expect(of('D')).toEqual(['Kapradina', 'Ostružník']);
        expect(a.slotOf.get('kla' as RodId)).toBe('MS1');
        expect(a.slotOf.get('jas' as RodId)).toBe('PS0');
        // Ten strong lines and no borrowing on the sample data (§1).
        expect(a.rods.filter(r => r.borrowed).length).toBe(0);
    });

    it('stability (test 5): Adéla → Jan → Jan with 7 rings keep the slots of the lines seen in both; Sládeček moves to M on PS1', () => {
        for (const [x, y] of [['A', 'B'], ['B', 'C']]) {
            const a = got.get(x)!, b = got.get(y)!;
            for (const [id, slot] of a.slotOf) {
                if (b.slotOf.has(id)) expect(b.slotOf.get(id), `${REF.label[id]} ${x}→${y}`).toBe(slot);
            }
        }
        const sla = got.get('B')!.rods.find(r => r.id === 'sla')!;
        expect(sla.group).toBe('M');
        expect(sla.slot).toBe('PS1');
        expect(sla.kept).toBe(true);
        for (const id of ['jas', 'sla', 'bod', 'mec', 'lis', 'ost']) {
            const slots = ['A', 'B', 'C'].map(n => got.get(n)!.slotOf.get(id as RodId));
            expect(new Set(slots).size, REF.label[id]).toBe(1);
        }
    });

    it('determinism (test 6): twice the same without memory; the order of the lines in the index does not matter', () => {
        for (const s of REF.states) {
            const a = assignFanRodColors(refModel(s), refIndex());
            const b = assignFanRodColors(refModel(s), refIndex());
            const c = assignFanRodColors(refModel(s), refIndex(true));
            expect(obj(b.slotOf)).toEqual(obj(a.slotOf));
            expect(obj(c.slotOf)).toEqual(obj(a.slotOf));
            expect(c.rods.map(r => r.id)).toEqual(a.rods.map(r => r.id));
        }
        const reversed = runReference(refIndex(true));
        for (const [name, a] of runReference()) expect(obj(reversed.get(name)!.slotOf)).toEqual(obj(a.slotOf));
    });

    it('neighbours (test 8): no two neighbouring coloured lines under the thresholds of step 7', () => {
        for (const s of REF.states) {
            const a = got.get(s.name)!;
            for (const [x, y] of fanRodAdjacency(refModel(s), refIndex())) {
                const sx = a.slotOf.get(x), sy = a.slotOf.get(y);
                if (!sx || !sy) continue;
                const light = [fanRodSlotColor(sx, 'light'), fanRodSlotColor(sy, 'light')] as const;
                const dark = [fanRodSlotColor(sx, 'dark'), fanRodSlotColor(sy, 'dark')] as const;
                const what = `${s.name}: ${REF.label[x]} ${sx} × ${REF.label[y]} ${sy}`;
                expect(deltaE(...light), what).toBeGreaterThanOrEqual(0.04);
                expect(deltaE(...dark), what).toBeGreaterThanOrEqual(0.03);
                expect(Math.min(deltaEDeutan(...light), deltaEDeutan(...dark)), what).toBeGreaterThanOrEqual(0.02);
            }
        }
    });

    it('neighbours: the arc, the radius, the full circle’s seam and the descendants’ edges', () => {
        const p = (id: string) => refPerson(id);
        const index = stubIndex({ a: 'r1', b: 'r2', c: 'r3', d: 'r4', e: 'r5', f: 'r6', g: 'r7', h: 'r8' });
        const model = (shape: string): FanRodModel => ({
            focus: p('a'), shape,
            sectors: [
                { ahnentafel: 2, generation: 1, person: p('b') }, { ahnentafel: 3, generation: 1, person: p('c') },
                { ahnentafel: 4, generation: 2, person: p('d') }, { ahnentafel: 7, generation: 2, person: p('e') },
            ],
            desc: [
                { person: p('f'), r1: 56, r2: 68, lo: 180, hi: 270 }, { person: p('g'), r1: 56, r2: 68, lo: 270, hi: 360 },
                { person: p('h'), r1: 68, r2: 138, lo: 200, hi: 250 },
            ],
        });
        const pairs = (shape: string) => fanRodAdjacency(model(shape), index).map(x => x.join('-')).sort();
        // The focus disc is no neighbour; 2–3 radius, 2–4 and 3–7 arcs, 4 and 7 apart unless the circle is full.
        expect(pairs('two')).toEqual(['r2-r3', 'r2-r4', 'r3-r5', 'r6-r7', 'r6-r8']);
        expect(pairs('full')).toContain('r4-r5');
        expect(pairs('half')).not.toContain('r4-r5');
    });

    it('near (K1.7): one sector between, measured on the sectors; a long line does not make its two ends near', () => {
        const p = (id: string) => refPerson(id);
        // The father's line on 2, 4, 8, 16; the mother (3) and the mother of 8 (17) are four sectors apart.
        const index = stubIndex({ me: 'L', f: 'L', ff: 'L', fff: 'L', ffff: 'L', m: 'x', fffm: 'y', fm: 'z' });
        const model: FanRodModel = {
            focus: p('me'), shape: 'half', desc: [],
            sectors: [
                { ahnentafel: 2, generation: 1, person: p('f') }, { ahnentafel: 3, generation: 1, person: p('m') },
                { ahnentafel: 4, generation: 2, person: p('ff') }, { ahnentafel: 5, generation: 2, person: p('fm') },
                { ahnentafel: 8, generation: 3, person: p('fff') },
                { ahnentafel: 16, generation: 4, person: p('ffff') }, { ahnentafel: 17, generation: 4, person: p('fffm') },
            ],
        };
        const near = fanRodNear(model, index).map(x => x.join('-')).sort();
        // x (3) and z (5) have 2 between them; z (5) and y (17) have 4 and 8 between: not near; x and y neither.
        expect(near).toContain('x-z');
        expect(near).not.toContain('x-y');
        expect(near).not.toContain('y-z');
        // The lines' graph would call x and y near (both neighbours of L).
        const adj = fanRodAdjacency(model, index).map(x => x.join('-'));
        expect(adj).toEqual(expect.arrayContaining(['L-x', 'L-y']));
    });
});

// ---------------------------------------------------------------- slots and memory

function stubIndex(rodByPerson: Record<string, string | null>, tree: Record<string, number> = {}): LineageIndex {
    const ids = [...new Set(Object.values(rodByPerson).filter((r): r is string => !!r))];
    return {
        data: { persons: {}, partnerships: {} } as unknown as StromData,
        rodByPerson: new Map(Object.entries(rodByPerson).map(([p, r]) => [p as PersonId, r as RodId | null])),
        rods: new Map(ids.map(id => [id as RodId, { id, realMemberCount: tree[id] ?? 1 }])) as unknown as LineageIndex['rods'],
        lineParent: new Map(),
        cutParent: new Map(),
    };
}

const info = (id: string, count: number, group: 'P' | 'M' | 'D' = 'P', o: Partial<FanRodInfo> = {}): FanRodInfo =>
    ({ id: id as RodId, count, group, tree: 1, focus: false, both: false, nearest: { P: 99, M: 99 }, ...o });

describe('slots (§1 steps 2–8)', () => {
    it('gives the centre’s line PS0 even with two people, and no other line PS0', () => {
        const { slotOf } = assignFanRodSlots([info('big', 9), info('mid', 5), info('me', 2, 'P', { focus: true })], []);
        expect(slotOf.get('me' as RodId)).toBe('PS0');
        expect(slotOf.get('big' as RodId)).toBe('PS1');
        expect(slotOf.get('mid' as RodId)).toBe('PS2');
    });

    it('gives the centre’s line PS0 even when drawn once; without a centre line PS0 goes to the largest', () => {
        const withCentre = assignFanRodSlots([info('a', 5), info('me', 2, 'P', { focus: true })], [], new Map([['a' as RodId, 'PS1' as FanRodSlot]]));
        expect(withCentre.slotOf.get('me' as RodId)).toBe('PS0');
        const once = assignFanRodSlots([info('a', 5), info('me', 1, 'P', { focus: true })], []);
        expect(once.slotOf.get('me' as RodId)).toBe('PS0');
        expect(once.slotOf.get('a' as RodId)).toBe('PS1');
        const none = assignFanRodSlots([info('a', 5), info('b', 3)], []);
        expect(none.slotOf.get('a' as RodId)).toBe('PS0');
    });

    it('colours every line (K1.7): the first 10 of 2+ sectors strong, the others muted in their own group\'s shades', () => {
        const rods = Array.from({ length: 60 }, (_, i) => info(`r${String(i).padStart(2, '0')}`, Math.max(1, 40 - i), (['P', 'M', 'D'] as const)[i % 3]));
        const { slotOf, ranked } = assignFanRodSlots(rods, []);
        expect(slotOf.size).toBe(60);
        expect(ranked.filter(r => r.tier === 'S').length).toBe(FAN_ROD_MAX_STRONG);
        for (const r of ranked.slice(FAN_ROD_MAX_STRONG)) expect(parseFanRodSlot(r.slot!), r.id).toMatchObject({ group: r.group, tier: 'T' });
        // Without neighbours nothing is borrowed: the own group's shades repeat.
        expect(ranked.some(r => r.borrowed)).toBe(false);
        expect(ranked.some(r => r.shared)).toBe(true);
        // Fresh shades before a repeat: the first 10 have slots of their own.
        expect(new Set(ranked.slice(0, FAN_ROD_MAX_STRONG).map(r => r.slot)).size).toBe(FAN_ROD_MAX_STRONG);
    });

    it('repeats a shade only on lines far apart: never on neighbours or a neighbour\'s neighbour', () => {
        // A chain r0 – r1 – … – r39 in one group: a shade may come back only three links on.
        const rods = Array.from({ length: 40 }, (_, i) => info(`r${String(i).padStart(2, '0')}`, 2, 'D'));
        const adj = rods.slice(1).map((r, i) => [rods[i].id, r.id] as const);
        const { slotOf } = assignFanRodSlots(rods, adj);
        for (let i = 0; i < 40; i++) {
            for (const k of [1, 2]) if (i + k < 40) expect(slotOf.get(rods[i].id), `r${i} × r${i + k}`).not.toBe(slotOf.get(rods[i + k].id));
            expect(parseFanRodSlot(slotOf.get(rods[i].id)!)!.group, `r${i}`).toBe('D');
        }
    });

    it('memory: a line keeps its slot, also drawn once; a line gone frees it but is remembered; a neighbour holding it moves the later one', () => {
        const first = assignFanRodSlots([info('a', 4, 'M'), info('b', 3, 'M')], []);
        expect(obj(first.slotOf)).toEqual({ a: 'MS0', b: 'MS1' });
        // b seen once: still coloured on its slot (muted tier now, the slot kept), c takes a fresh one.
        const second = assignFanRodSlots([info('a', 4, 'M'), info('b', 1, 'M'), info('c', 3, 'M')], [], first.memory);
        expect(obj(second.slotOf)).toEqual({ a: 'MS0', b: 'MS1', c: 'MS2' });
        expect(obj(second.memory)).toEqual(obj(second.slotOf));
        // b and c gone: remembered with their slots (K1.2); a new line takes a shade nobody remembers.
        const third = assignFanRodSlots([info('a', 4, 'M'), info('d', 3, 'M')], [], second.memory);
        expect(obj(third.memory)).toEqual({ a: 'MS0', b: 'MS1', c: 'MS2', d: 'MS3' });
        expect(obj(third.slotOf)).toEqual({ a: 'MS0', d: 'MS3' });
        // b back: its own slot again, beside d.
        const fourth = assignFanRodSlots([info('a', 4, 'M'), info('b', 3, 'M'), info('d', 3, 'M')], [], third.memory);
        expect(obj(fourth.slotOf)).toEqual({ a: 'MS0', b: 'MS1', d: 'MS3' });
        // Every shade of the group remembered by a line out of view: a new line still takes a free one (held by nobody drawn).
        const full = new Map(FAN_ROD_SLOTS.M.S.map((_, i) => [`m${i}` as RodId, `MS${i}` as FanRodSlot]));
        const fresh = assignFanRodSlots([info('e', 3, 'M')], [], full);
        expect(fresh.slotOf.get('e' as RodId)).toBe('MS0');
        expect(fresh.memory.size).toBe(full.size + 1);
        // Two lines remembering one slot (a repeat) become neighbours: the larger keeps it.
        const shared = new Map([['x' as RodId, 'MT0' as FanRodSlot], ['y' as RodId, 'MT0' as FanRodSlot]]);
        const out = assignFanRodSlots([info('x', 3, 'M'), info('y', 2, 'M')], [['x' as RodId, 'y' as RodId]], shared);
        expect(out.slotOf.get('x' as RodId)).toBe('MT0');
        expect(out.slotOf.get('y' as RodId)).not.toBe('MT0');
    });

    it('drops invalid slots of a memory (another window, an older build)', () => {
        const out = assignFanRodSlots([info('a', 4)], [], new Map([['a' as RodId, 'XS9' as FanRodSlot]]));
        expect(out.slotOf.get('a' as RodId)).toBe('PS0');
    });

    it('skips a slot too close to a coloured neighbour while a distinct one is free (step 7)', () => {
        // a takes PS0; b is its neighbour in the same group. PS1 is distinct enough from PS0 in the palette, so
        // force the question with a memory: b's remembered slot is kept regardless, c (neighbour of both) must pass the check.
        const out = assignFanRodSlots([info('a', 9), info('b', 8), info('c', 7)], [['a' as RodId, 'c' as RodId], ['b' as RodId, 'c' as RodId]]);
        const c = out.slotOf.get('c' as RodId)!;
        for (const n of ['a', 'b']) {
            const s = out.slotOf.get(n as RodId)!;
            expect(deltaE(fanRodSlotColor(c, 'light'), fanRodSlotColor(s, 'light'))).toBeGreaterThanOrEqual(0.04);
        }
    });
});

// ---------------------------------------------------------------- real trees

let pid = 0;
function mk(persons: Record<string, Person>, gender: Gender, lastName: string, o: Partial<Person> = {}): Person {
    const id = `p${++pid}` as PersonId;
    const p: Person = { id, firstName: id, lastName, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o };
    persons[id] = p;
    return p;
}
function couple(data: StromData, a: Person, b: Person, kids: Person[]): void {
    const id = `u${++pid}` as PartnershipId;
    const u: Partnership = { id, person1Id: a.id, person2Id: b.id, childIds: kids.map(k => k.id), status: 'married' };
    data.partnerships[id] = u;
    a.partnerships.push(id); b.partnerships.push(id);
    for (const k of kids) {
        k.parentIds.push(a.id, b.id);
        a.childIds.push(k.id); b.childIds.push(k.id);
    }
}

/** Seeded generator (mulberry32): the same 200 trees every run. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SURNAMES = ['Jasanovec', 'Bodlák', 'Klásek', 'Řeřicha', 'Mech', 'Lískovec', 'Ječmen', 'Rozmarýn', 'Vřes', 'Kapradina',
    'Dubánek', 'Jalovec', 'Pelyněk', 'Šafrán', 'Kmín', 'Lipenský', 'Javorovec', 'Habrůvek', 'Brusinka', 'Měsíček',
    'Bezovec', 'Ostřice', 'Pýr', 'Vratič', 'Šípkovec', 'Hloh', 'Kozlíkovec', 'Řebříček', 'Jitrocel', 'Sasanka'];

/** A random family: ancestors up to ten rings (fewer the further), a few descendants, some people without a surname. */
function randomTree(r: () => number): { data: StromData; focus: PersonId; people: PersonId[] } {
    const persons: Record<string, Person> = {};
    const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
    const pool = SURNAMES.slice(0, 4 + Math.floor(r() * SURNAMES.length));
    const pick = () => (r() < 0.06 ? '' : pool[Math.floor(r() * pool.length)]);
    const keep = 0.75 + r() * 0.23;
    const focus = mk(persons, r() < 0.5 ? 'male' : 'female', pick());
    const up = (child: Person, depth: number, surname: string) => {
        if (depth > 10 || r() > keep ** (depth * 0.8)) return;
        const fatherName = surname && r() < 0.95 ? surname : pick();
        const father = mk(persons, 'male', fatherName);
        const motherName = pick();
        const mother = mk(persons, 'female', motherName);
        couple(data, father, mother, [child]);
        up(father, depth + 1, fatherName);
        up(mother, depth + 1, motherName);
    };
    up(focus, 1, focus.lastName);
    const down = (p: Person, depth: number) => {
        if (depth > 3) return;
        const unions = r() < 0.15 ? 2 : r() < 0.7 ? 1 : 0;
        for (let u = 0; u < unions; u++) {
            const partner = mk(persons, p.gender === 'male' ? 'female' : 'male', pick());
            const name = p.gender === 'male' ? p.lastName : partner.lastName;
            const kids = Array.from({ length: Math.floor(r() * 4) }, () => mk(persons, r() < 0.5 ? 'male' : 'female', name));
            const [a, b] = p.gender === 'male' ? [p, partner] : [partner, p];
            couple(data, a, b, kids);
            for (const k of kids) down(k, depth + 1);
        }
    };
    down(focus, 1);
    return { data, focus: focus.id, people: Object.keys(persons) as PersonId[] };
}

/** K1.1, K1.6 and K1.7 on one assignment. */
function checkK17(a: FanRodAssignment, model: FanRodModel, what: string): void {
    // Every line coloured, in its own side's shades unless borrowed for distinctness.
    expect(a.slotOf.size, what).toBe(a.rods.length);
    for (const r of a.rods) if (!r.borrowed && !r.kept) expect(parseFanRodSlot(r.slot!)!.group, `${what}: ${r.id}`).toBe(r.group);
    // Strong = the larger lines: no muted line has more sectors than a strong one (the centre's line apart).
    const strong = a.rods.filter(r => r.tier === 'S' && !r.focus);
    expect(strong.length, what).toBeLessThanOrEqual(FAN_ROD_MAX_STRONG);
    const minStrong = Math.min(...strong.map(r => r.count));
    for (const r of a.rods) if (r.tier === 'T') expect(r.count, `${what}: ${r.id}`).toBeLessThanOrEqual(minStrong);
    // PS0 only for one line; never a shade shared by neighbours.
    expect([...a.slotOf.values()].filter(s => s === 'PS0').length, what).toBeLessThanOrEqual(1);
    for (const [x, y] of fanRodAdjacency(model, a.index)) expect(a.slotOf.get(x), `${what}: ${x} × ${y}`).not.toBe(a.slotOf.get(y));
}

/** Pairs of lines near each other (one sector between) holding the same shade. */
function nearRepeats(a: FanRodAssignment, model: FanRodModel): number {
    return fanRodNear(model, a.index).filter(([x, y]) => a.slotOf.get(x) === a.slotOf.get(y)).length;
}

/**
 * The same, leaving out pairs of two remembered slots: a kept slot yields only
 * to a neighbour (§3 step 4), so two lines kept from earlier states may end
 * one sector apart; a slot handed out now never does.
 */
function nearRepeatsAssigned(a: FanRodAssignment, model: FanRodModel): number {
    const kept = new Set(a.rods.filter(r => r.kept).map(r => r.id));
    return fanRodNear(model, a.index).filter(([x, y]) => a.slotOf.get(x) === a.slotOf.get(y) && !(kept.has(x) && kept.has(y))).length;
}

/** One random tree and the four fans the property test draws on it, each re-centred on a random person. */
interface RandomCase { index: LineageIndex; models: FanRodModel[] }

/** The 200 random trees of the property test: the same generator, the same order of draws. */
function randomCases(): RandomCase[] {
    const r = rng(114);
    const shapes: FanShape[] = ['half', 'full', 'two'];
    const cases: RandomCase[] = [];
    for (let t = 0; t < 200; t++) {
        const { data, focus, people } = randomTree(r);
        const models: FanRodModel[] = [];
        let centre = focus;
        for (let step = 0; step < 4; step++) {
            const opts = { generations: 3 + Math.floor(r() * 8), shape: shapes[Math.floor(r() * 3)], descGenerations: 1 + Math.floor(r() * 3) };
            models.push(buildFanModel(data, centre, opts)!);
            centre = people[Math.floor(r() * people.length)];
        }
        cases.push({ index: buildLineages(data), models });
    }
    return cases;
}

/** Colours every fan of every case, each with the memory of the previous fan of its tree. */
function assignAll(cases: RandomCase[]): number {
    let lines = 0;
    for (const { index, models } of cases) {
        let memory: ReadonlyMap<RodId, FanRodSlot> | null = null;
        for (const model of models) {
            const a = assignFanRodColors(model, index, memory);
            lines += a.slotOf.size;
            memory = a.memory;
        }
    }
    return lines;
}

// The assignment's speed against a budget that holds on a loaded machine (helpers/perf-budget.ts):
// 800 assignments take about 60 ms on the reference machine at rest.
const ASSIGN_BUDGET_MS = 400;
// About as long as the measured work (the calibration's best time on the reference machine at rest).
const ASSIGN_CALIBRATION_ROUNDS = 32;
const ASSIGN_CALIBRATION_REFERENCE_MS = 176;

describe('K1.1 (property, test 4)', () => {
    // Correctness only: the time the 800 fans take is judged by the budget test below,
    // so a loaded machine (the whole suite at once) cannot fail this one.
    it('200 random trees and fans with re-centring: every line coloured, the larger ones strong, neighbours never alike, slots kept', () => {
        let states = 0, shared = 0, near = 0, seenAgain = 0, kept = 0;
        randomCases().forEach(({ index, models }, t) => {
            let memory: ReadonlyMap<RodId, FanRodSlot> | null = null;
            models.forEach((model, step) => {
                const a = assignFanRodColors(model, index, memory);
                checkK17(a, model, `tree ${t} step ${step}`);
                if (a.rods.some(x => x.shared)) shared++;
                near += nearRepeatsAssigned(a, model);
                // K1.2: a line seen before keeps its slot (unless a neighbour holds it now).
                for (const [id, s] of memory ?? []) if (a.slotOf.has(id)) { seenAgain++; if (a.slotOf.get(id) === s) kept++; }
                // Remembered slots: the lines in this fan with theirs, the lines seen before and out of view now with theirs.
                for (const [id, s] of a.slotOf) expect(a.memory.get(id)).toBe(s);
                for (const [id, s] of memory ?? []) if (!a.slotOf.has(id)) expect(a.memory.get(id)).toBe(s);
                memory = a.memory;
                states++;
            });
        });
        expect(states).toBe(800);
        // The generator runs some groups out of fresh shades (else the repeats would not be tested).
        expect(shared).toBeGreaterThan(0);
        expect(near).toBe(0);
        expect(kept / seenAgain).toBeGreaterThan(0.99);
    }, 600_000);

    it('colours the 800 fans within the time budget, judged against the machine\'s load', () => {
        const cases = randomCases();
        expect(assignAll(cases)).toBeGreaterThan(800);
        const m = measureAgainstBudget(() => assignAll(cases), {
            budgetMs: ASSIGN_BUDGET_MS, calibrationRounds: ASSIGN_CALIBRATION_ROUNDS, referenceMs: ASSIGN_CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('fan line colours, 800 fans', m, ASSIGN_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(ASSIGN_BUDGET_MS);
    }, 600_000);
});

describe('sides on a real tree (§1)', () => {
    it('puts a line seen on both sides on the nearer one, ties to the father’s; the centre’s line on P even among descendants', () => {
        // A line follows the fathers (lineage.ts), whatever the surnames say.
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const M = (n: string) => mk(persons, 'male', n), F = (n: string) => mk(persons, 'female', n);
        const me = M('Jasanovec');
        const f = M('Jasanovec'), m = F('Klásek');
        couple(data, f, m, [me]);
        const ff = M('Jasanovec'), fm = F('Mech');
        couple(data, ff, fm, [f]);
        const mf = M('Klásek'), mm = F('Bodlák');
        couple(data, mf, mm, [m]);
        // Bodlák: the mother's mother (ring 2, M) and her sister the father's mother's mother (ring 3, P).
        const fmf = M('Mech'), fmm = F('Bodlák');
        couple(data, fmf, fmm, [fm]);
        const z = M('Bodlák'), zw = F('Lipnicová');
        couple(data, z, zw, [mm, fmm]);
        // Habrůvek: two sisters on ring 3, the father's father's mother and the mother's father's mother (a tie).
        const fff = M('Jasanovec'), ffm = F('Habrůvek');
        couple(data, fff, ffm, [ff]);
        const mff = M('Klásek'), mfm = F('Habrůvek');
        couple(data, mff, mfm, [mf]);
        const w = M('Habrůvek'), ww = F('Lipnicová');
        couple(data, w, ww, [ffm, mfm]);
        // The centre's son (the centre's line) and his wife's line, seen only below.
        const wife = F('Kmín');
        couple(data, mk(persons, 'male', 'Kmín'), mk(persons, 'female', 'Pýr'), [wife]);
        const son = M('Jasanovec');
        couple(data, me, wife, [son]);
        const index = buildLineages(data);
        const model = buildFanModel(data, me.id, { generations: 4, shape: 'two', descGenerations: 2 })!;
        const { rods } = fanRodSides(model, index);
        const side = (p: Person) => rods.get(rodOf(index, p.id)!)!;
        expect(side(me)).toBe(side(son));
        expect([side(me).group, side(me).focus]).toEqual(['P', true]);
        expect(side(m).group).toBe('M');
        expect([side(mm).group, side(mm).both, side(mm).nearest]).toEqual(['M', true, { P: 3, M: 2 }]);
        expect(side(fmm)).toBe(side(mm));
        expect([side(ffm).group, side(ffm).both, side(ffm).nearest]).toEqual(['P', true, { P: 3, M: 3 }]);
        expect(side(wife).group).toBe('D');
        // Every sector of a line has one colour: the fill looks the person's line up.
        const a = assignFanRodColors(model, index);
        expect(fanRodSlotOf(a, mm.id)).not.toBeNull();
        expect(fanRodSlotOf(a, mm.id)).toBe(fanRodSlotOf(a, fmm.id));
        expect(fanRodSlotOf(a, me.id)).toBe('PS0');
    });
});

// ---------------------------------------------------------------- legend data and edge states (§4 data, §10)

function legendSum(a: FanRodAssignment, labelOf?: (id: RodId) => string): number {
    const L = fanRodLegend(a, 'light', labelOf);
    return L.groups.reduce((n, g) => n + g.items.reduce((m, i) => m + (i.count ?? 0), 0), 0) + L.otherPeople;
}

describe('legend data (test 9)', () => {
    it('counts every drawn person once: the groups, "Other" (lines and people) and the people without a line', () => {
        const got = runReference();
        for (const s of REF.states) {
            const a = got.get(s.name)!;
            const drawn = s.model.sectors.length + s.model.desc.length + 1;
            const label = (id: RodId) => REF.label[id];
            expect(legendSum(a, label), s.name).toBe(drawn);
            const L = fanRodLegend(a, 'dark', label);
            // "Other": the smaller lines, each in its colour.
            expect(L.otherRods).toBe(a.rods.filter(r => !r.focus && ((r.rank ?? 0) >= FAN_ROD_LEGEND_MAIN || r.count < 2)).length);
            for (const i of L.other) expect(i.color).toBe(fanRodSlotColor(i.slot!, 'dark'));
            // Groups P, M, D in this order; the centre's line first in P.
            expect(L.groups.map(g => g.group)).toEqual(['P', 'M', 'D'].filter(g => L.groups.some(x => x.group === g)));
            expect(L.groups[0].items[0].focus).toBe(true);
            for (const g of L.groups) for (const i of g.items) expect(i.color).toBe(fanRodSlotColor(i.slot!, 'dark'));
        }
        const A = fanRodLegend(got.get('A')!, 'light', id => REF.label[id]);
        expect(A.groups.map(g => g.items.map(i => `${i.label} ${i.count}`))).toEqual([
            ['Jasánek 9', 'Sládeček 7', 'Bodlák 5', 'Mechovský 3', 'Lískovec 2'],
            ['Ječmínek 8', 'Klásek 6', 'Řeřicha 4', 'Rozmarýn 2'],
            ['Ostružník 5'],
        ]);
        expect(A.other.map(i => i.label)).toEqual(['Kapradina', 'Vřesák']);
        expect(A.otherPeople).toBe(2);
    });

    it('holds on the random trees too', () => {
        const r = rng(9);
        for (let t = 0; t < 40; t++) {
            const { data, focus } = randomTree(r);
            const model = buildFanModel(data, focus, { generations: 6, shape: 'two', descGenerations: 3 })!;
            const a = assignFanRodColors(model, buildLineages(data));
            const drawn = model.sectors.filter(s => s.person).length + model.desc.filter(s => s.person).length + 1;
            expect(legendSum(a)).toBe(drawn);
        }
    });
});

describe('edge states (§10)', () => {
    const tree = (names: { me: string; f?: string; m?: string; ff?: string; fm?: string }) => {
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const me = mk(persons, 'male', names.me);
        if (names.f !== undefined) {
            const f = mk(persons, 'male', names.f), m = mk(persons, 'female', names.m ?? '');
            couple(data, f, m, [me]);
            if (names.ff !== undefined) couple(data, mk(persons, 'male', names.ff), mk(persons, 'female', names.fm ?? ''), [f]);
        }
        return { data, me: me.id };
    };
    const run = (t: { data: StromData; me: PersonId }) => {
        const model = buildFanModel(t.data, t.me, { generations: 4, shape: 'half' })!;
        return assignFanRodColors(model, buildLineages(t.data));
    };

    it('a tree without lines: everything grey, only the people without a line', () => {
        const a = run(tree({ me: '', f: '', m: '', ff: '', fm: '' }));
        expect(a.slotOf.size).toBe(0);
        const L = fanRodLegend(a, 'light');
        expect(L.groups).toEqual([]);
        expect(L.otherRods).toBe(0);
        expect(L.noRod).toBe(5);
        expect(L.otherPeople).toBe(5);
    });

    it('everybody in one line: one row in P on PS0', () => {
        const a = run(tree({ me: 'Jasanovec', f: 'Jasanovec', ff: 'Jasanovec' }));
        expect(obj(a.slotOf)).toEqual({ [a.rods[0].id]: 'PS0' });
        const L = fanRodLegend(a, 'light');
        expect(L.groups.map(g => [g.group, g.items.length])).toEqual([['P', 1]]);
        expect(L.otherRods).toBe(0);
    });

    it('only the centre: its line drawn once is coloured, on PS0, the one row in P', () => {
        const a = run(tree({ me: 'Jasanovec' }));
        expect(obj(a.slotOf)).toEqual({ [a.rods[0].id]: 'PS0' });
        const L = fanRodLegend(a, 'light');
        expect(L.groups.map(g => [g.group, g.items.length])).toEqual([['P', 1]]);
        expect([L.otherRods, L.otherPeople]).toEqual([0, 0]);
    });

    it('every line drawn once: every line coloured, the centre\'s in P, the others under "Other" in colour', () => {
        // The centre without a father, his mother and hers: three lines of one person each.
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const me = mk(persons, 'male', 'Jasanovec'), m = mk(persons, 'female', 'Klásek'), mm = mk(persons, 'female', 'Habrůvek');
        me.parentIds.push(m.id); m.childIds.push(me.id);
        m.parentIds.push(mm.id); mm.childIds.push(m.id);
        const a = run({ data, me: me.id });
        expect(a.slotOf.size).toBe(3);
        const L = fanRodLegend(a, 'light');
        expect([L.groups.length, L.otherRods, L.otherPeople]).toEqual([1, 2, 2]);
        for (const i of L.other) expect(i.color).not.toBe(FAN_PALETTES.light.grey);
        expect(L.other.map(i => parseFanRodSlot(i.slot!)!.group)).toEqual(['M', 'M']);
    });

    it('a small centre line (2 people) is still PS0, the anchor', () => {
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const me = mk(persons, 'male', 'Jasanovec'), f = mk(persons, 'male', 'Jasanovec'), m = mk(persons, 'female', 'Klásek');
        couple(data, f, m, [me]);
        const mf = mk(persons, 'male', 'Klásek');
        couple(data, mf, mk(persons, 'female', 'Habrůvek'), [m]);
        couple(data, mk(persons, 'male', 'Klásek'), mk(persons, 'female', 'Mech'), [mf]);
        const a = run({ data, me: me.id });
        const centre = a.rods.find(r => r.focus)!;
        expect(centre.count).toBe(2);
        expect(centre.slot).toBe('PS0');
        expect(a.rods[0].count).toBe(3);
        expect(a.rods[0].slot).toBe('MS0');
    });

    it('the data change while the fan is open: the lines that stayed keep their slots, a new line takes a free one', () => {
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const me = mk(persons, 'male', 'Jasanovec');
        const f = mk(persons, 'male', 'Jasanovec'), m = mk(persons, 'female', 'Klásek');
        couple(data, f, m, [me]);
        couple(data, mk(persons, 'male', 'Jasanovec'), mk(persons, 'female', 'Mech'), [f]);
        const fan = () => buildFanModel(data, me.id, { generations: 4, shape: 'half' })!;
        const first = assignFanRodColors(fan(), buildLineages(data));
        const jasan = rodOf(first.index, me.id)!;
        expect(first.slotOf.get(jasan)).toBe('PS0');
        expect(first.slotOf.size).toBe(first.rods.length);
        // An edit adds the mother's parents: her line now has two people.
        couple(data, mk(persons, 'male', 'Klásek'), mk(persons, 'female', 'Habrůvek'), [m]);
        const index = buildLineages(data);
        const second = assignFanRodColors(fan(), index, first.memory);
        expect(second.slotOf.get(jasan)).toBe('PS0');
        expect(second.slotOf.get(rodOf(index, m.id)!)).toBe('MS0');
        expect(second.slotOf.size).toBe(second.rods.length);
        // The lines that stayed keep their slots (Mech, drawn once, too).
        for (const [id, slot] of first.slotOf) if (second.slotOf.has(id)) expect(second.slotOf.get(id)).toBe(slot);
    });
});

describe('the drawing and the poster take the window’s colours (§3, §7)', () => {
    const family = () => {
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const me = mk(persons, 'male', 'Jasanovec'), f = mk(persons, 'male', 'Jasanovec'), m = mk(persons, 'female', 'Lopuchová');
        couple(data, f, m, [me]);
        const mf = mk(persons, 'male', 'Lopuch');
        couple(data, mf, mk(persons, 'female', 'Habrůvek'), [m]);
        couple(data, mk(persons, 'male', 'Lopuch'), mk(persons, 'female', 'Mech'), [mf]);
        return { data, me, m };
    };
    const opts = { esc: (t: string) => t, editable: false, addParentLabel: '', colorMode: 'rod' as const };

    it('fills the sectors with the given slots, not with an assignment of its own', () => {
        const { data, me, m } = family();
        const model = buildFanModel(data, me.id, 4)!;
        const index = buildLineages(data);
        const lopuch = rodOf(index, m.id)!;
        // As if the window remembered the mother's line on MS3 from a previous state.
        const a = assignFanRodColors(model, index, new Map([[lopuch, 'MS3' as FanRodSlot]]));
        expect(a.slotOf.get(lopuch)).toBe('MS3');
        const own = buildFanSvg(model, { ...opts, uid: 'o' });
        const given = buildFanSvg(model, { ...opts, uid: 'g', rodColors: a });
        expect(own).toContain(fanRodSlotColor('MS0', 'light'));
        expect(given).toContain(fanRodSlotColor('MS3', 'light'));
        expect(given).not.toContain(fanRodSlotColor('MS0', 'light'));
    });

    it('names the lines of a poster drawn from a copy with the living hidden as the copy names them', () => {
        const { data, me, m } = family();
        const model = buildFanModel(data, me.id, 4)!;
        const a = assignFanRodColors(model, buildLineages(data));
        // The copy: the mother's line's surnames hidden (initials), the same ids.
        const copy: StromData = JSON.parse(JSON.stringify(data));
        for (const p of Object.values(copy.persons)) if (p.lastName.startsWith('Lopuch')) p.lastName = 'L.';
        const poster = buildFanPosterSvg(buildFanModel(copy, me.id, 4)!, { ...opts, rodColors: a }, {});
        expect(poster).toContain(fanRodSlotColor(a.slotOf.get(rodOf(a.index, m.id)!)!, 'print'));
        expect(poster).not.toContain('Lopuch');
        expect(poster).toContain('Jasanovec');
    });
});

describe('a highlighted line on the poster, the image and paper (§7, test 10)', () => {
    const family = () => {
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const me = mk(persons, 'male', 'Jasanovec'), f = mk(persons, 'male', 'Jasanovec'), m = mk(persons, 'female', 'Lopuchová');
        couple(data, f, m, [me]);
        const mf = mk(persons, 'male', 'Lopuch');
        couple(data, mf, mk(persons, 'female', 'Habrůvek'), [m]);
        couple(data, mk(persons, 'male', 'Lopuch'), mk(persons, 'female', 'Mech'), [mf]);
        couple(data, mk(persons, 'male', 'Jasanovec'), mk(persons, 'female', 'Pelyněk'), [f]);
        return { data, me, m };
    };
    const opts = { esc: (t: string) => t, editable: false, addParentLabel: '', colorMode: 'rod' as const };
    const setup = () => {
        const { data, me, m } = family();
        const model = buildFanModel(data, me.id, 4)!;
        const index = buildLineages(data);
        const a = assignFanRodColors(model, index);
        const rod = rodOf(index, m.id)!;
        const highlight: FanHighlight = { rodId: rod, hit: new Set(realRodMembers(index, rod)) };
        return { data, me, model, index, a, rod, highlight };
    };
    const drawnOf = (svg: string, hit: ReadonlySet<PersonId>) =>
        [...svg.matchAll(/data-fan-person="([^"]+)"/g)].filter(x => hit.has(x[1] as PersonId)).length;

    it('outlines the line in a layer over the sectors, the others toward white (hexes, no opacity), the subtitle names it', () => {
        const { model, index, a, rod, highlight } = setup();
        const poster = buildFanPosterSvg(model, { ...opts, rodColors: a, highlight }, {});
        const layer = /<g class="fan-hl-layer"[^>]*>(.*?)<\/g>/.exec(poster);
        expect(layer).not.toBeNull();
        // One outline per drawn sector of the line, after every sector.
        const edges = (layer![1].match(/class="fan-hl-edge"/g) ?? []).length;
        expect(edges).toBe(drawnOf(poster, highlight.hit));
        expect(edges).toBeGreaterThan(1);
        expect(poster.lastIndexOf('data-fan-person=')).toBeLessThan(poster.indexOf('class="fan-hl-layer"'));
        expect(poster).toContain(`stroke:${FAN_PRINT_EDGE}`);
        // The centre's line (another colour) printed lighter: the computed hex, not an opacity.
        const centre = fanRodSlotColor(a.slotOf.get(rodOf(index, model.focus.id)!)!, 'print');
        expect(poster).toContain(`{fill:${fanMixWhite(centre, FAN_PRINT_DIM)}}`);
        expect(poster).toContain(`{fill:${fanRodSlotColor(a.slotOf.get(rod)!, 'print')}}`);
        expect(poster).not.toMatch(/(^|[^-])opacity/);
        // The others' names in the lighter text.
        expect(poster).toContain(`.fan-hl-dim :is(.fan-name,.fan-years,.fan-kekule){fill:${FAN_PALETTES.print.textLight}}`);
        // The subtitle and the legend's row (bold, underlined).
        const label = rodLabels(index).get(rod)!;
        expect(poster).toMatch(new RegExp(`class="fan-poster-subtitle"[^>]*>[^<]* · ${strings.fan.posterHighlighted(label)}<`));
        expect(poster).toMatch(new RegExp(`font-weight="600" fill="[^"]+">${label} · \\d+×<`));
        expect((poster.match(/class="fan-poster-strong"/g) ?? []).length).toBe(1);
        // The legend in parts by side, each after its heading.
        expect(poster).toContain(`>${strings.fan.legendFatherSide}</text>`);
        expect(poster).toContain(`>${strings.fan.legendMotherSide}</text>`);
        // The geometry knows the longer subtitle.
        const plain = fanPosterGeometry(model, {}, { colorMode: 'rod', rodColors: a });
        const lit = fanPosterGeometry(model, {}, { colorMode: 'rod', rodColors: a, highlight });
        expect(lit.width).toBeGreaterThanOrEqual(plain.width);
    });

    it('without a highlight (or with one nobody drawn belongs to) prints none of it', () => {
        const { model, a } = setup();
        for (const highlight of [undefined, { rodId: 'nobody' as RodId, hit: new Set(['p0' as PersonId]) }]) {
            const poster = buildFanPosterSvg(model, { ...opts, rodColors: a, ...(highlight ? { highlight } : {}) }, {});
            expect(poster).not.toContain('fan-hl-layer');
            expect(poster).not.toContain('fan-hl-dim');
            expect(poster).not.toContain('fan-poster-strong');
            expect(poster).not.toContain(strings.fan.posterHighlighted('').trim());
        }
    });

    it('prints a highlight in the sex colours too (what is seen is printed)', () => {
        const { model, highlight } = setup();
        const poster = buildFanPosterSvg(model, { ...opts, colorMode: 'gender', highlight }, {});
        expect((poster.match(/class="fan-hl-edge"/g) ?? []).length).toBe(drawnOf(poster, highlight.hit));
        expect(poster).toContain(`{fill:${fanMixWhite(FAN_PALETTES.print.male, FAN_PRINT_DIM)}}`);
        expect(poster).not.toContain('fan-poster-strong');
    });

    it('the window\'s print: the dimmed sectors at full opacity, their fills toward white', () => {
        const { model, a } = setup();
        const svg = buildFanSvg(model, { ...opts, uid: 'w', rodColors: a, printHighlight: true });
        const print = svg.slice(svg.indexOf('@media print{'));
        expect(print).toContain(':is(.fan-sector,.fan-focus):is(.evidence-dim,.evidence-faint){opacity:1!important}');
        const centre = fanRodSlotColor(a.slotOf.get(rodOf(a.index, model.focus.id)!)!, 'light');
        expect(print).toContain(`:is(.evidence-dim,.evidence-faint) .fc`);
        expect(print).toContain(`{fill:${fanMixWhite(centre, FAN_PRINT_DIM)}}`);
        // The screen's drawing has no layer of its own (the renderer adds it by class).
        expect(svg).not.toContain('fan-hl-layer');
    });

    it('a fan that never highlights (the person page) has no print rules of a highlight', () => {
        const { model, a } = setup();
        const svg = buildFanSvg(model, { ...opts, uid: 'p', rodColors: a });
        expect(svg).toContain('@media print{');
        expect(svg).not.toContain('evidence-dim');
        expect(svg).not.toContain('evidence-faint');
    });
});

describe('shapes and a dense fan (§8)', () => {
    /** Eight full rings: a father keeps the surname, every mother brings a line of her own. */
    const dense = () => {
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const name = new Map<number, string>();
        const at = new Map<number, Person>();
        for (let n = 1; n < 512; n++) {
            name.set(n, n === 1 || n % 2 === 1 ? `Tvarek${n}` : name.get(n / 2)!);
            at.set(n, mk(persons, n === 1 || n % 2 === 0 ? 'male' : 'female', name.get(n)!));
        }
        for (let n = 1; n < 256; n++) couple(data, at.get(2 * n)!, at.get(2 * n + 1)!, [at.get(n)!]);
        // A daughter's husband and child: a line of the descendants alone.
        const kid = mk(persons, 'female', name.get(1)!);
        couple(data, at.get(1)!, mk(persons, 'female', 'Tvarek0'), [kid]);
        couple(data, mk(persons, 'male', 'Tvarek600'), kid, [mk(persons, 'male', 'Tvarek600')]);
        return { data, focus: at.get(1)! };
    };

    it('half and full circle: no Descendants part; two-way: the descendants\' part', () => {
        const { data, focus } = dense();
        const index = buildLineages(data);
        const groups = (shape: FanShape) => {
            const model = buildFanModel(data, focus.id, { generations: 4, shape, descGenerations: 2 })!;
            return fanRodLegend(assignFanRodColors(model, index), 'light').groups.map(g => g.group);
        };
        expect(groups('half')).not.toContain('D');
        expect(groups('full')).not.toContain('D');
        expect(groups('two')).toContain('D');
    });

    it('eight rings (K1.7): over 60 lines, every one coloured, no grey sector, no shade repeated near; a small line highlighted alone', () => {
        const { data, focus } = dense();
        const index = buildLineages(data);
        const model = buildFanModel(data, focus.id, { generations: 8, shape: 'full' })!;
        expect(model.generations).toBe(8);
        const a = assignFanRodColors(model, index);
        expect(a.rods.length).toBeGreaterThan(60);
        checkK17(a, model, 'dense');
        expect(nearRepeats(a, model)).toBe(0);
        // Shades repeat (more lines than the palette has), each in its own side's band.
        expect(a.rods.some(r => r.shared)).toBe(true);
        for (const th of ['light', 'dark'] as const) {
            const svg = buildFanSvg(model, { ...opts(), uid: `d${th}`, rodColors: a });
            expect(svg, th).not.toContain(`fill="${FAN_PALETTES[th].grey}"`);
        }
        // The smallest line takes a muted slot.
        const small = a.rods.reduce((x, y) => (y.count < x.count ? y : x));
        expect(parseFanRodSlot(a.slotOf.get(small.id)!)!.tier).toBe('T');
        const two = a.rods.find(r => r.count === 2 && r.tier === 'T')!;
        const highlight: FanHighlight = { rodId: two.id, hit: new Set(realRodMembers(index, two.id)) };
        const poster = buildFanPosterSvg(model, { ...opts(), rodColors: a, highlight }, {});
        expect((poster.match(/class="fan-hl-edge"/g) ?? []).length).toBe(two.count);
        expect((poster.match(/class="fan-poster-strong"/g) ?? []).length).toBe(1);
        // A line drawn once highlighted: "Other" (in colours, not grey) is the legend's marked row.
        const once = a.rods.find(r => r.count === 1)!;
        const g = buildFanPosterSvg(model, { ...opts(), rodColors: a, highlight: { rodId: once.id, hit: new Set(realRodMembers(index, once.id)) } }, {});
        expect((g.match(/class="fan-hl-edge"/g) ?? []).length).toBe(1);
        expect(g).toMatch(/font-weight="600" fill="[^"]+">[^<]+ · \d+ [^<]+ · \d+×<\/text>\s*<rect class="fan-poster-strong"/);
        const L = fanRodLegend(a, 'print');
        expect(L.otherRods).toBeGreaterThan(0);
        expect(g).toContain(`fill="${L.other[0].color}"`);
        expect(g).not.toContain(`fill="${FAN_PALETTES.print.grey}"`);
    });

    it('re-centring a dense fan (K1.2): the lines seen in both states keep their colours', () => {
        const { data, focus } = dense();
        const index = buildLineages(data);
        const [father, mother] = focus.parentIds;
        let memory: ReadonlyMap<RodId, FanRodSlot> | null = null;
        let prev: FanRodAssignment | null = null;
        // Each step shares lines with the one before (the father's and the mother's fans share none).
        for (const [centre, gens] of [[focus.id, 8], [father, 8], [focus.id, 7], [mother, 8], [focus.id, 9]] as const) {
            const model = buildFanModel(data, centre, { generations: gens, shape: 'full' })!;
            const a = assignFanRodColors(model, index, memory);
            checkK17(a, model, `centre ${centre}`);
            if (prev) {
                let both = 0;
                for (const [id, slot] of prev.slotOf) if (a.slotOf.has(id)) { both++; expect(a.slotOf.get(id), `${centre} ${id}`).toBe(slot); }
                expect(both, centre).toBeGreaterThan(30);
            }
            memory = a.memory;
            prev = a;
        }
    });

    it('there and back (K1.2): after the father, the mother and a child as centre, the first centre shows every line in its colours again', () => {
        const { data, focus } = dense();
        const index = buildLineages(data);
        const [father, mother] = focus.parentIds;
        const child = Object.values(data.persons).find(p => p.parentIds.includes(focus.id))!.id;
        for (const shape of ['full', 'two'] as const) {
            const draw = (centre: PersonId, memory: ReadonlyMap<RodId, FanRodSlot> | null) => {
                const model = buildFanModel(data, centre, { generations: 8, shape, descGenerations: 2 })!;
                const a = assignFanRodColors(model, index, memory);
                checkK17(a, model, `${shape} ${centre}`);
                expect(nearRepeatsAssigned(a, model), `${shape} ${centre}`).toBe(0);
                return a;
            };
            const first = draw(focus.id, null);
            expect(first.rods.length).toBeGreaterThan(60);
            expect(nearRepeats(first, buildFanModel(data, focus.id, { generations: 8, shape, descGenerations: 2 })!)).toBe(0);
            let memory = first.memory;
            for (const away of [father, mother, child]) {
                const there = draw(away, memory);
                const back = draw(focus.id, there.memory);
                expect(obj(back.slotOf), `${shape} via ${away}`).toEqual(obj(first.slotOf));
                memory = back.memory;
            }
        }
    });
    const opts = () => ({ esc: (t: string) => t, editable: false, addParentLabel: '', colorMode: 'rod' as const });
});

describe('styles and the main lines (spec 118 §2, §4)', () => {
    const label = (id: RodId) => REF.label[id];

    // Two lines that both keep their remembered slots (§3 step 4) may come closer than the
    // thresholds: keeping a colour across re-centring wins (as in the colour style).
    it.each(['color', 'pastel', 'antique', 'mono'] as const)('neighbours in the %s style stay distinct (or differ in pattern)', style => {
        const out = new Map<string, FanRodAssignment>();
        for (const s of REF.states) {
            const memory = s.after ? out.get(s.after)!.memory : null;
            const a = assignFanRodColors(refModel(s), refIndex(), memory, { style });
            out.set(s.name, a);
            expect(a.style).toBe(style);
            const kept = new Set(a.rods.filter(r => r.kept).map(r => r.id));
            for (const [x, y] of fanRodAdjacency(refModel(s), refIndex())) {
                const sx = a.slotOf.get(x), sy = a.slotOf.get(y);
                if (!sx || !sy || (kept.has(x) && kept.has(y))) continue;
                for (const th of ['light', 'dark'] as const) {
                    expect(fanRodSlotDistance(sx, sy, th, style), `${s.name} ${th}: ${label(x)} ${sx} × ${label(y)} ${sy}`).toBeGreaterThanOrEqual(1);
                }
            }
        }
    });

    it('the main lines: the 10 largest by rank, the centre\'s always in place of the tenth; fewer than 10 lines: all', () => {
        const rods = Array.from({ length: 14 }, (_, i) => info(`r${String(i).padStart(2, '0')}`, 20 - i));
        const { ranked } = assignFanRodSlots(rods, []);
        expect([...fanRodMainSet(ranked)].sort()).toEqual(rods.slice(0, FAN_ROD_MAIN).map(r => r.id).sort());
        const withMe = assignFanRodSlots([...rods, info('me', 1, 'P', { focus: true })], []).ranked;
        const main = fanRodMainSet(withMe);
        expect(main.size).toBe(FAN_ROD_MAIN);
        expect(main.has('me' as RodId)).toBe(true);
        expect([...main].filter(id => id !== 'me').sort()).toEqual(rods.slice(0, FAN_ROD_MAIN - 1).map(r => r.id).sort());
        const few = assignFanRodSlots(rods.slice(0, 4), []).ranked;
        expect(fanRodMainSet(few).size).toBe(4);
    });

    it('the main-lines scope keeps every slot and only greys the rest, in the fill and the legend', () => {
        const s = state('two8');
        const all = assignFanRodColors(refModel(s), refIndex());
        const main = assignFanRodColors(refModel(s), refIndex(), null, { scope: 'main' });
        expect(all.main).toBeUndefined();
        expect(obj(main.slotOf)).toEqual(obj(all.slotOf));
        expect(main.main!.size).toBe(FAN_ROD_MAIN);
        const focus = main.rods.find(r => r.focus)!;
        expect(main.main!.has(focus.id)).toBe(true);
        const outside = main.rods.find(r => !main.main!.has(r.id))!;
        const inside = main.rods.find(r => main.main!.has(r.id) && !r.focus)!;
        const sector = (rod: RodId) => {
            const pid = Object.keys(REF.persons).find(p => REF.persons[p] === rod)!;
            return { kind: 'anc' as const, person: refPerson(pid), generation: 3, ahnentafel: 9 };
        };
        expect(fanFill(sector(outside.id), 'rod', 'light', main)).toBe(FAN_PALETTES.light.grey);
        expect(fanFill(sector(outside.id), 'rod', 'light', all)).toBe(fanRodSlotColor(all.slotOf.get(outside.id)!, 'light'));
        expect(fanFill(sector(inside.id), 'rod', 'dark', main)).toBe(fanRodSlotColor(main.slotOf.get(inside.id)!, 'dark'));

        const L = fanRodLegend(main, 'light', label);
        expect(L.grey).toBe(true);
        const shown = L.groups.flatMap(g => g.items.map(i => i.key));
        expect(shown.sort()).toEqual([...main.main!].sort());
        expect(L.otherRods).toBe(main.rods.length - FAN_ROD_MAIN);
        for (const i of L.other) {
            expect(i.color).toBe(FAN_PALETTES.light.grey);
            expect(i.slot).toBeUndefined();
        }
        expect(legendSum(main, label)).toBe(s.model.sectors.length + s.model.desc.length + 1);
        expect(fanRodLegend(all, 'light', label).grey).toBeUndefined();
    });

    it('re-centring there and back gives the lines the same colours in the main-lines scope', () => {
        const look = { scope: 'main' as const };
        const a1 = assignFanRodColors(refModel(state('A')), refIndex(), null, look);
        const b = assignFanRodColors(refModel(state('B')), refIndex(), a1.memory, look);
        const a2 = assignFanRodColors(refModel(state('A')), refIndex(), b.memory, look);
        expect(obj(a2.slotOf)).toEqual(obj(a1.slotOf));
        expect([...a2.main!].sort()).toEqual([...a1.main!].sort());
    });

    it('the poster: "Other lines (N)" in grey and the main lines\' colours in the subtitle', () => {
        const s = state('two8');
        const rc = assignFanRodColors(refModel(s), refIndex(), null, { scope: 'main' });
        expect(strings.fan.legendOtherGrey(4)).toBe('Other lines (4)');
        expect(strings.fan.posterColorsMain).toBe('colours of the main lines');
        expect(rc.main).toBeDefined();
    });
});
