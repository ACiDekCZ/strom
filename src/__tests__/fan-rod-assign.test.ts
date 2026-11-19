/**
 * Fan chart in family-line colours (spec 114 §1, §3, §10): the sides of the
 * lines, their slots, the memory of the previous state, the legend's data.
 *
 * The sample data (fictional plant surnames) and the expected slots come from
 * the reference implementation the design was drawn with (fixtures/
 * fan-rod-reference.json): the same fan models, the same results.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    assignFanRodColors, assignFanRodSlots, fanRodSides, fanRodAdjacency, fanRodLegend, fanRodSlotOf,
    FAN_ROD_MAX_STRONG, FAN_ROD_MAX_COLOURED, FanRodAssignment, FanRodInfo, FanRodModel,
} from '../fan-rod-assign.js';
import {
    FanRodSlot, fanRodSlotColor, deltaE, deltaEDeutan, parseFanRodSlot, FAN_PALETTES, fanMixWhite, FAN_PRINT_DIM, FAN_PRINT_EDGE,
} from '../fan-colors.js';
import { buildFanModel, buildFanSvg, buildFanPosterSvg, fanPosterGeometry, FanShape, FanHighlight } from '../fan-chart.js';
import { buildLineages, LineageIndex, RodId, rodOf, rodLabels, realRodMembers } from '../lineage.js';
import { strings } from '../strings.js';
import { StromData, Person, PersonId, Gender, PartnershipId, Partnership } from '../types.js';

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

    it.each(REF.states.map(s => s.name))('state %s: the same slots, memory, sides and counts', name => {
        const s = state(name);
        const a = got.get(name)!;
        expect(obj(a.slotOf)).toEqual(s.slots);
        expect(obj(a.memory)).toEqual(s.memory);
        expect(Object.fromEntries(a.rods.map(r => [r.id, r.group]))).toEqual(s.groups);
        expect(Object.fromEntries(a.rods.map(r => [r.id, r.count]))).toEqual(s.counts);
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

    it('keeps PS0 free while the centre’s line is coloured, and gives it away once the centre’s line is grey', () => {
        const withCentre = assignFanRodSlots([info('a', 5), info('me', 2, 'P', { focus: true })], [], new Map([['a' as RodId, 'PS1' as FanRodSlot]]));
        expect(withCentre.slotOf.get('me' as RodId)).toBe('PS0');
        const grey = assignFanRodSlots([info('a', 5), info('me', 1, 'P', { focus: true })], []);
        expect(grey.slotOf.get('a' as RodId)).toBe('PS0');
        expect(grey.slotOf.has('me' as RodId)).toBe(false);
    });

    it('colours at most 20 lines, the first 10 strong; a muted line takes its group’s muted shades first', () => {
        const rods = Array.from({ length: 25 }, (_, i) => info(`r${String(i).padStart(2, '0')}`, 40 - i, (['P', 'M', 'D'] as const)[i % 3]));
        const { slotOf, ranked } = assignFanRodSlots(rods, []);
        expect(slotOf.size).toBe(FAN_ROD_MAX_COLOURED);
        expect(ranked.filter(r => r.tier === 'S').length).toBe(FAN_ROD_MAX_STRONG);
        expect(new Set(slotOf.values()).size).toBe(slotOf.size);
        for (const r of ranked.slice(20)) expect(r.slot).toBeUndefined();
        const muted = ranked.slice(10, 20);
        for (const r of muted.filter(x => !x.borrowed)) expect(parseFanRodSlot(r.slot!)!.tier).toBe('T');
    });

    it('memory: a line seen once holds its slot loosely and gets it back; a line gone frees it; a line past the 20th loses it', () => {
        const first = assignFanRodSlots([info('a', 4, 'M'), info('b', 3, 'M')], []);
        expect(obj(first.slotOf)).toEqual({ a: 'MS0', b: 'MS1' });
        // b seen once: grey, its slot kept loosely, the new line c takes the next free one.
        const second = assignFanRodSlots([info('a', 4, 'M'), info('b', 1, 'M'), info('c', 3, 'M')], [], first.memory);
        expect(obj(second.slotOf)).toEqual({ a: 'MS0', c: 'MS2' });
        expect(second.memory.get('b' as RodId)).toBe('MS1');
        // b back on 2+: its slot again.
        const third = assignFanRodSlots([info('a', 4, 'M'), info('b', 2, 'M'), info('c', 3, 'M')], [], second.memory);
        expect(third.slotOf.get('b' as RodId)).toBe('MS1');
        // b gone: the slot is free for anybody.
        const fourth = assignFanRodSlots([info('a', 4, 'M'), info('d', 3, 'M')], [], third.memory);
        expect(fourth.memory.has('b' as RodId)).toBe(false);
        expect(fourth.slotOf.get('d' as RodId)).toBe('MS1');
        // A loosely held slot is the last choice of a new line.
        const loose = assignFanRodSlots([info('x', 1, 'D'), info('y', 3, 'D')], [], new Map([['x' as RodId, 'DS0' as FanRodSlot]]));
        expect(loose.slotOf.get('y' as RodId)).toBe('DS1');
        // Past the 20th place: grey, and its remembered slot goes to the line ranked in its place.
        const many = Array.from({ length: 21 }, (_, i) => info(`r${String(i).padStart(2, '0')}`, 30 - i, 'P'));
        const kept = new Map([['r20' as RodId, 'PS1' as FanRodSlot]]);
        const out = assignFanRodSlots(many, [], kept);
        expect(out.slotOf.has('r20' as RodId)).toBe(false);
        expect(out.slotOf.get('r00' as RodId)).toBe('PS0');
        expect([...out.slotOf.values()]).toContain('PS1');
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

/** K1.1 and the limits of step 2–3 on one assignment. */
function checkK11(a: FanRodAssignment, what: string): void {
    const coloured = a.rods.filter(r => a.slotOf.has(r.id));
    const grey = a.rods.filter(r => !a.slotOf.has(r.id));
    expect(coloured.length, what).toBeLessThanOrEqual(FAN_ROD_MAX_COLOURED);
    const focusLate = coloured.some(r => r.focus && (r.rank ?? 0) >= FAN_ROD_MAX_STRONG) ? 1 : 0;
    expect(coloured.filter(r => r.tier === 'S').length, what).toBeLessThanOrEqual(FAN_ROD_MAX_STRONG + focusLate);
    expect(new Set(a.slotOf.values()).size, what).toBe(a.slotOf.size);
    const minColoured = Math.min(...coloured.map(r => r.count));
    for (const g of grey) {
        // Grey only when drawn once, or past the 20th place.
        if (g.count >= 2) expect(coloured.length, `${what}: ${g.id} grey with ${g.count}`).toBe(FAN_ROD_MAX_COLOURED);
        // More people ⇒ never grey while a line with fewer has a colour.
        expect(g.count, `${what}: ${g.id} grey with ${g.count}, a coloured line has ${minColoured}`).toBeLessThanOrEqual(minColoured);
    }
}

describe('K1.1 (property, test 4)', () => {
    it('200 random trees and fans with re-centring: more people is never grey while fewer is coloured; at most 10 strong and 20 coloured', () => {
        const r = rng(114);
        const shapes: FanShape[] = ['half', 'full', 'two'];
        let states = 0, saturated = 0;
        for (let t = 0; t < 200; t++) {
            const { data, focus, people } = randomTree(r);
            const index = buildLineages(data);
            let memory: ReadonlyMap<RodId, FanRodSlot> | null = null;
            let centre = focus;
            for (let step = 0; step < 4; step++) {
                const opts = { generations: 3 + Math.floor(r() * 8), shape: shapes[Math.floor(r() * 3)], descGenerations: 1 + Math.floor(r() * 3) };
                const model = buildFanModel(data, centre, opts)!;
                const a = assignFanRodColors(model, index, memory);
                checkK11(a, `tree ${t} step ${step}`);
                if (a.slotOf.size === FAN_ROD_MAX_COLOURED) saturated++;
                // Remembered slots: only lines in this fan.
                for (const id of a.memory.keys()) expect(a.rods.some(x => x.id === id)).toBe(true);
                memory = a.memory;
                centre = people[Math.floor(r() * people.length)];
                states++;
            }
        }
        expect(states).toBe(800);
        // The generator reaches the 20-line limit in some fans (else the property would not test it).
        expect(saturated).toBeGreaterThan(0);
    });
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
            expect(L.otherRods).toBe(a.rods.filter(r => !a.slotOf.has(r.id)).length);
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

    it('only the centre: its line drawn once is grey, "Other" has one line and one person', () => {
        const a = run(tree({ me: 'Jasanovec' }));
        expect(a.slotOf.size).toBe(0);
        const L = fanRodLegend(a, 'light');
        expect(L.groups).toEqual([]);
        expect([L.otherRods, L.otherPeople]).toEqual([1, 1]);
        expect(L.other[0].color).toBe(FAN_PALETTES.light.grey);
    });

    it('every line drawn once: everything grey', () => {
        // The centre without a father, his mother and hers: three lines of one person each.
        const persons: Record<string, Person> = {};
        const data: StromData = { persons: persons as StromData['persons'], partnerships: {} };
        const me = mk(persons, 'male', 'Jasanovec'), m = mk(persons, 'female', 'Klásek'), mm = mk(persons, 'female', 'Habrůvek');
        me.parentIds.push(m.id); m.childIds.push(me.id);
        m.parentIds.push(mm.id); mm.childIds.push(m.id);
        const a = run({ data, me: me.id });
        expect(a.slotOf.size).toBe(0);
        const L = fanRodLegend(a, 'light');
        expect([L.groups.length, L.otherRods, L.otherPeople]).toEqual([0, 3, 3]);
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
        expect(obj(first.slotOf)).toEqual({ [jasan]: 'PS0' });
        // An edit adds the mother's parents: her line now has two people.
        couple(data, mk(persons, 'male', 'Klásek'), mk(persons, 'female', 'Habrůvek'), [m]);
        const index = buildLineages(data);
        const second = assignFanRodColors(fan(), index, first.memory);
        expect(second.slotOf.get(jasan)).toBe('PS0');
        expect(second.slotOf.get(rodOf(index, m.id)!)).toBe('MS0');
        expect(second.slotOf.size).toBe(2);
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
        const svg = buildFanSvg(model, { ...opts, uid: 'w', rodColors: a });
        const print = svg.slice(svg.indexOf('@media print{'));
        expect(print).toContain(':is(.fan-sector,.fan-focus):is(.evidence-dim,.evidence-faint){opacity:1!important}');
        const centre = fanRodSlotColor(a.slotOf.get(rodOf(a.index, model.focus.id)!)!, 'light');
        expect(print).toContain(`:is(.evidence-dim,.evidence-faint) .fc`);
        expect(print).toContain(`{fill:${fanMixWhite(centre, FAN_PRINT_DIM)}}`);
        // The screen's drawing has no layer of its own (the renderer adds it by class).
        expect(svg).not.toContain('fan-hl-layer');
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

    it('eight rings: the lines hold together, the small ones muted, the single ones grey; a small line highlighted alone', () => {
        const { data, focus } = dense();
        const index = buildLineages(data);
        const model = buildFanModel(data, focus.id, { generations: 8, shape: 'full' })!;
        expect(model.generations).toBe(8);
        const a = assignFanRodColors(model, index);
        checkK11(a, 'dense');
        for (const r of a.rods) if (r.count < 2) expect(a.slotOf.has(r.id)).toBe(false);
        const coloured = a.rods.filter(r => a.slotOf.has(r.id));
        expect(coloured.length).toBe(FAN_ROD_MAX_COLOURED);
        // The smallest coloured line takes a muted slot.
        const small = coloured.reduce((x, y) => (y.count < x.count ? y : x));
        expect(parseFanRodSlot(a.slotOf.get(small.id)!)!.tier).toBe('T');
        const highlight: FanHighlight = { rodId: small.id, hit: new Set(realRodMembers(index, small.id)) };
        const poster = buildFanPosterSvg(model, { ...opts(), rodColors: a, highlight }, {});
        expect((poster.match(/class="fan-hl-edge"/g) ?? []).length).toBe(small.count);
        expect((poster.match(/class="fan-poster-strong"/g) ?? []).length).toBe(1);
        // A grey line highlighted: "Other" is the legend's marked row.
        const grey = a.rods.find(r => !a.slotOf.has(r.id) && r.count === 1)!;
        const g = buildFanPosterSvg(model, { ...opts(), rodColors: a, highlight: { rodId: grey.id, hit: new Set(realRodMembers(index, grey.id)) } }, {});
        expect((g.match(/class="fan-hl-edge"/g) ?? []).length).toBe(1);
        expect(g).toMatch(/font-weight="600" fill="[^"]+">[^<]+ · \d+ [^<]+ · \d+×<\/text>\s*<rect class="fan-poster-strong"/);
    });
    const opts = () => ({ esc: (t: string) => t, editable: false, addParentLabel: '', colorMode: 'rod' as const });
});
