/**
 * Random pairs of invented trees merged with random decisions (spec 134
 * K0.2): nothing of either tree is lost, the counts add up and no reference
 * points at nothing. Deterministic seeds; a failure names its seed.
 *
 * Besides the check of the production code (checkMergeResult) the test checks
 * on its own: the tree's persons, couples and parent links are all there,
 * every incoming person ends where its decision says, links are mutual and
 * nothing dangles.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { executeMerge, AUTO_CONFIRM_SCORE } from '../merge/executor.js';
import { createMergeState } from '../merge/matching.js';
import { StorageManager } from '../storage.js';
import { MergeState } from '../merge/types.js';
import { Attachment, Gender, Partnership, PartnershipId, Person, PersonId, Source, StromData } from '../types.js';

const RUNS = 200;

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const MALE = ['Bořivoj', 'Radomil', 'Kvido', 'Lubor', 'Ctibor', 'Hostivít', 'Velemír', 'Zbyhněv', 'Drahoš', 'Kojata'];
const FEMALE = ['Bohdana', 'Radmila', 'Dobroslava', 'Vlastislava', 'Ctislava', 'Mstislava', 'Zbyslava', 'Hostislava'];
const SURNAMES = ['Brambořík', 'Kvapilec', 'Hrbolec', 'Čmeldík', 'Ťapkal', 'Mrkvíček', 'Šmudlík', 'Kořenáč'];
const feminine = (s: string): string => s.endsWith('ík') || s.endsWith('ec') || s.endsWith('al') || s.endsWith('áč') ? `${s}ová` : `${s}ová`;

class TreeBuilder {
    readonly data: StromData = { persons: {}, partnerships: {}, sources: {}, media: {} };
    private n = 0;
    constructor(private readonly prefix: string, readonly rnd: () => number) {}
    pick<T>(list: readonly T[]): T { return list[Math.floor(this.rnd() * list.length)]; }
    chance(p: number): boolean { return this.rnd() < p; }
    id(kind: string): string { return `${this.prefix}${kind}${++this.n}`; }

    person(gender: Gender, lastName: string, year: number, o: Partial<Person> = {}): Person {
        const id = this.id('p') as PersonId;
        const p: Person = {
            id, gender, isPlaceholder: false,
            firstName: gender === 'female' ? this.pick(FEMALE) : this.pick(MALE),
            lastName: gender === 'female' ? feminine(lastName) : lastName,
            birthDate: String(year),
            partnerships: [], parentIds: [], childIds: [],
            ...o,
        };
        this.data.persons[id] = p;
        return p;
    }
    placeholder(gender: Gender): Person {
        return this.person(gender, '', 0, { firstName: '?', lastName: '', birthDate: undefined, isPlaceholder: true });
    }
    couple(a: Person, b: Person): Partnership {
        const id = this.id('u') as PartnershipId;
        const u: Partnership = { id, person1Id: a.id, person2Id: b.id, childIds: [], status: 'married' };
        this.data.partnerships[id] = u;
        a.partnerships.push(id);
        b.partnerships.push(id);
        return u;
    }
    child(u: Partnership, c: Person): void {
        u.childIds.push(c.id);
        for (const pid of [u.person1Id, u.person2Id]) {
            c.parentIds.push(pid);
            this.data.persons[pid].childIds.push(c.id);
        }
    }
    source(title: string): Source {
        const id = this.id('s');
        const s = { id, title } as Source;
        this.data.sources![id] = s;
        return s;
    }
    file(at: Person, bytes: string): Attachment {
        const id = this.id('m');
        const a: Attachment = { id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes}`, sizeBytes: bytes.length, places: [{ personId: at.id }] };
        this.data.media![id] = a;
        return a;
    }
    /** A family below a couple: children, some of them marrying and with children of their own. */
    family(u: Partnership, year: number, depth: number): void {
        const father = this.data.persons[u.person1Id];
        const kids = 1 + Math.floor(this.rnd() * 3);
        for (let i = 0; i < kids; i++) {
            const g: Gender = this.chance(0.5) ? 'male' : 'female';
            const c = this.person(g, father.lastName || this.pick(SURNAMES), year + 25 + i * 2);
            this.child(u, c);
            if (depth > 0 && this.chance(0.6)) {
                const spouse = this.chance(0.1) ? this.placeholder(g === 'male' ? 'female' : 'male')
                    : this.person(g === 'male' ? 'female' : 'male', this.pick(SURNAMES), year + 26);
                const cu = g === 'male' ? this.couple(c, spouse) : this.couple(spouse, c);
                this.family(cu, year + 25, depth - 1);
                if (this.chance(0.15)) {
                    // A second marriage.
                    const second = this.person(g === 'male' ? 'female' : 'male', this.pick(SURNAMES), year + 30);
                    const su = g === 'male' ? this.couple(c, second) : this.couple(second, c);
                    if (this.chance(0.5)) this.child(su, this.person('male', c.lastName, year + 55));
                }
            }
        }
    }
    decorate(titles: readonly string[]): void {
        const sources = titles.map(t => this.source(t));
        for (const p of Object.values(this.data.persons)) {
            if (p.isPlaceholder) continue;
            if (this.chance(0.3)) p.sourceIds = [this.pick(sources).id];
            if (this.chance(0.15)) this.file(p, `${p.firstName}${p.birthDate}`.replace(/[^A-Za-z0-9]/g, 'x'));
        }
    }
}

const SOURCE_TITLES = ['Matrika Lhotka 1850', 'Matrika Lhotka 1880', 'Sčítání 1921', 'Pozemková kniha', 'Rodinný list', 'Kronika obce'];

function targetTree(rnd: () => number): StromData {
    const b = new TreeBuilder('t', rnd);
    const roots = 1 + Math.floor(rnd() * 2);
    for (let r = 0; r < roots; r++) {
        const last = b.pick(SURNAMES);
        const u = b.couple(b.person('male', last, 1820 + r * 3), b.person('female', b.pick(SURNAMES), 1822 + r * 3));
        b.family(u, 1820, 2);
    }
    b.decorate(SOURCE_TITLES.slice(0, 4));
    return b.data;
}

/** A source tree overlapping the target: some of its persons again (with small differences), new ones around them. */
function sourceTree(target: StromData, rnd: () => number): StromData {
    const b = new TreeBuilder('i', rnd);
    const copy = new Map<PersonId, Person>();
    for (const p of Object.values(target.persons)) {
        if (!b.chance(p.isPlaceholder ? 0.5 : 0.6)) continue;
        const q = b.person(p.gender, p.lastName, 0, {
            firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, isPlaceholder: p.isPlaceholder,
        });
        if (!p.isPlaceholder) {
            const r = rnd();
            if (r < 0.15 && p.birthDate) q.birthDate = `${p.birthDate}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}`;
            else if (r < 0.25) q.firstName = `${p.firstName} ${b.pick(MALE)}`;
            else if (r < 0.3 && p.birthDate) q.birthDate = String(Number(p.birthDate.slice(0, 4)) + 1);
            if (b.chance(0.2)) q.deathDate = String(Number((p.birthDate ?? '1850').slice(0, 4)) + 60);
        }
        copy.set(p.id, q);
    }
    // The couples and children among the copied persons.
    for (const u of Object.values(target.partnerships)) {
        const a = copy.get(u.person1Id);
        const c = copy.get(u.person2Id);
        if (!a || !c) continue;
        const nu = b.couple(a, c);
        for (const kid of u.childIds) {
            const k = copy.get(kid);
            if (k && b.chance(0.9)) b.child(nu, k);
        }
    }
    // New persons around them: children, spouses, a "?" partner, second marriages.
    for (const q of [...copy.values()]) {
        if (q.isPlaceholder || !b.chance(0.35)) continue;
        const spouseGender: Gender = q.gender === 'male' ? 'female' : 'male';
        const spouse = b.chance(0.15) ? b.placeholder(spouseGender) : b.person(spouseGender, b.pick(SURNAMES), 1850);
        const u = q.gender === 'male' ? b.couple(q, spouse) : b.couple(spouse, q);
        const kids = Math.floor(rnd() * 3);
        for (let i = 0; i < kids; i++) b.child(u, b.person(b.chance(0.5) ? 'male' : 'female', q.lastName || b.pick(SURNAMES), 1875 + i));
    }
    // A lone new family.
    if (b.chance(0.5)) {
        const u = b.couple(b.person('male', b.pick(SURNAMES), 1900), b.person('female', b.pick(SURNAMES), 1902));
        b.family(u, 1900, 1);
    }
    b.decorate(SOURCE_TITLES.slice(2));
    // Some of the target's files again (same bytes) at their copies.
    for (const att of Object.values(target.media ?? {})) {
        const at = 'personId' in att.places[0] ? copy.get(att.places[0].personId) : undefined;
        if (at && b.chance(0.5)) b.file(at, att.dataUrl.split(',')[1]);
    }
    return b.data;
}

function randomDecisions(state: MergeState, rnd: () => number): void {
    const existingIds = Object.keys(state.existingData.persons) as PersonId[];
    const pick = (): PersonId => existingIds[Math.floor(rnd() * existingIds.length)];
    for (const m of state.matches) {
        const r = rnd();
        if (r < 0.3) continue;
        else if (r < 0.55) state.decisions.set(m.incomingId, { type: 'confirm' });
        else if (r < 0.75) state.decisions.set(m.incomingId, { type: 'reject' });
        else if (r < 0.9) state.decisions.set(m.incomingId, { type: 'skip' });
        else state.decisions.set(m.incomingId, { type: 'manual_match', targetId: pick() });
    }
    for (const id of state.unmatchedIncoming) {
        const r = rnd();
        if (r < 0.1) state.decisions.set(id, { type: 'skip' });
        else if (r < 0.15 && existingIds.length) state.decisions.set(id, { type: 'manual_match', targetId: pick() });
    }
    if (rnd() < 0.1) state.updateOnly = true;
}

/** Where each incoming non-placeholder person should end, by the rules the dialog states. */
function expectedFate(state: MergeState, id: PersonId): 'merged' | 'added' | 'left' {
    const d = state.decisions.get(id);
    if (d?.type === 'skip') return 'left';
    if (d?.type === 'manual_match') return 'merged';
    const m = state.matches.find(x => x.incomingId === id);
    if (m && (d?.type === 'confirm' || (!d && m.score >= AUTO_CONFIRM_SCORE))) return 'merged';
    return state.updateOnly ? 'left' : 'added';
}

/** References to nothing among persons and couples (the generated trees have none). */
function dangling(data: StromData): string[] {
    const out: string[] = [];
    for (const p of Object.values(data.persons)) {
        for (const id of [...p.parentIds, ...p.childIds]) if (!data.persons[id]) out.push(`${p.id}→${id}`);
        for (const id of p.partnerships) if (!data.partnerships[id]) out.push(`${p.id}→${id}`);
        for (const id of p.sourceIds ?? []) if (!data.sources?.[id]) out.push(`${p.id}→${id}`);
    }
    for (const u of Object.values(data.partnerships)) {
        for (const id of [u.person1Id, u.person2Id, ...u.childIds]) if (!data.persons[id]) out.push(`${u.id}→${id}`);
    }
    for (const a of Object.values(data.media ?? {})) {
        for (const pl of a.places) if ('personId' in pl && !data.persons[pl.personId]) out.push(`${a.id}→${pl.personId}`);
    }
    return out;
}

async function runOne(seed: number): Promise<string[]> {
    const rnd = mulberry32(seed);
    const existing = targetTree(rnd);
    const incoming = sourceTree(existing, rnd);
    const existingCopy = structuredClone(existing);
    const state = createMergeState(existing, incoming);
    randomDecisions(state, rnd);
    const result = await executeMerge(state);
    const errors: string[] = [];
    if (!result.success) {
        return [`merge not saved: ${JSON.stringify(result.check?.problems ?? result.errors)}`];
    }
    const merged = result.mergedData;
    // The production check passed and its tallies add up.
    if (!result.check?.ok) errors.push('check not ok');
    for (const [kind, t] of Object.entries(result.check?.tallies ?? {})) {
        if (t.merged + t.added + t.left + t.lost !== t.source || t.lost) errors.push(`tally ${kind}: ${JSON.stringify(t)}`);
    }
    // The merge did not change its inputs.
    if (JSON.stringify(existing) !== JSON.stringify(existingCopy)) errors.push('existing data changed in place');
    // Nothing of the tree is gone.
    for (const p of Object.values(existing.persons)) {
        if (!merged.persons[p.id]) errors.push(`tree person ${p.id} gone`);
        for (const parent of p.parentIds) if (!merged.persons[p.id]?.parentIds.includes(parent)) errors.push(`tree link ${p.id}←${parent} gone`);
    }
    for (const id of Object.keys(existing.partnerships)) if (!merged.partnerships[id as PartnershipId]) errors.push(`tree couple ${id} gone`);
    for (const id of Object.keys(existing.sources ?? {})) if (!merged.sources?.[id]) errors.push(`tree source ${id} gone`);
    for (const id of Object.keys(existing.media ?? {})) if (!merged.media?.[id]) errors.push(`tree file ${id} gone`);
    // Every incoming person where its decision says.
    let expectedAdded = 0;
    for (const p of Object.values(incoming.persons)) {
        if (p.isPlaceholder) continue;
        const fate = expectedFate(state, p.id);
        if (fate === 'added') expectedAdded++;
        if (fate === 'merged') {
            const d = state.decisions.get(p.id);
            const target = d?.type === 'manual_match' ? d.targetId : state.matches.find(m => m.incomingId === p.id)!.existingId;
            if (!merged.persons[target]) errors.push(`merged person ${p.id} → ${target} missing`);
        }
    }
    // Every incoming parent link between two persons that came along is there,
    // unless the child has two other parents or the link would close a circle;
    // every incoming file at a person that came along is at that person.
    const placed = (id: PersonId): PersonId | undefined => {
        const to = result.trace?.persons.get(id);
        return to && merged.persons[to] ? to : undefined;
    };
    const above = (from: PersonId, target: PersonId): boolean => {
        const seen = new Set<PersonId>();
        const todo = [from];
        while (todo.length) {
            const id = todo.pop()!;
            if (id === target) return true;
            if (!seen.has(id)) { seen.add(id); todo.push(...(merged.persons[id]?.parentIds ?? [])); }
        }
        return false;
    };
    for (const p of Object.values(incoming.persons)) {
        const c = placed(p.id);
        if (!c) continue;
        for (const par of p.parentIds) {
            const to = placed(par);
            if (!to || to === c || merged.persons[c].parentIds.includes(to)) continue;
            const others = merged.persons[c].parentIds.filter(id => id !== to);
            if (others.length < 2 && !above(to, c)) errors.push(`incoming link ${p.id}←${par} (${c}←${to}) lost`);
        }
    }
    for (const att of Object.values(incoming.media ?? {})) {
        const pl = att.places[0];
        const at = 'personId' in pl ? placed(pl.personId) : undefined;
        if (!at) continue;
        const kept = Object.values(merged.media ?? {}).some(m => m.dataUrl === att.dataUrl && m.places.some(x => 'personId' in x && x.personId === at));
        if (!kept) errors.push(`incoming file ${att.id} not at ${at}`);
    }
    const newNamed = Object.values(merged.persons).filter(p => !existing.persons[p.id] && !p.isPlaceholder).length;
    if (newNamed !== expectedAdded) errors.push(`added ${newNamed} persons, expected ${expectedAdded}`);
    // Links are mutual and nothing points at nothing.
    for (const p of Object.values(merged.persons)) {
        for (const c of p.childIds) if (!merged.persons[c]?.parentIds.includes(p.id)) errors.push(`one-sided ${p.id}→${c}`);
        for (const par of p.parentIds) if (!merged.persons[par]?.childIds.includes(p.id)) errors.push(`one-sided ${p.id}←${par}`);
        for (const u of p.partnerships) {
            const pu = merged.partnerships[u];
            if (pu && pu.person1Id !== p.id && pu.person2Id !== p.id) errors.push(`couple ${u} not ${p.id}'s`);
        }
    }
    errors.push(...dangling(merged).map(d => `dangling ${d}`));
    return errors;
}

beforeAll(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe(`random pairs of invented trees (${RUNS} seeds)`, () => {
    it('nothing is lost, the counts add up, no reference points at nothing', async () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= RUNS; seed++) {
            const errors = await runOne(seed);
            if (errors.length) failures.push(`seed ${seed}: ${errors.slice(0, 5).join('; ')}`);
        }
        expect(failures).toEqual([]);
    }, 30_000);
});
