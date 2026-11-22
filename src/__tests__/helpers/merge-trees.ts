/**
 * Random pairs of invented trees for the merge tests (spec 134): a target
 * tree, a source overlapping it (some persons again with small differences,
 * new ones around them, "?" partners, sources, files), random decisions.
 * Deterministic: the same seed gives the same trees.
 */

import { MergeState } from '../../merge/types.js';
import { Attachment, Gender, Partnership, PartnershipId, Person, PersonId, Source, StromData } from '../../types.js';

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const MALE = ['Bořivoj', 'Radomil', 'Kvido', 'Lubor', 'Ctibor', 'Hostivít', 'Velemír', 'Zbyhněv', 'Drahoš', 'Kojata'];
export const FEMALE = ['Bohdana', 'Radmila', 'Dobroslava', 'Vlastislava', 'Ctislava', 'Mstislava', 'Zbyslava', 'Hostislava'];
export const SURNAMES = ['Brambořík', 'Kvapilec', 'Hrbolec', 'Čmeldík', 'Ťapkal', 'Mrkvíček', 'Šmudlík', 'Kořenáč'];
const feminine = (s: string): string => s.endsWith('ík') || s.endsWith('ec') || s.endsWith('al') || s.endsWith('áč') ? `${s}ová` : `${s}ová`;

export class TreeBuilder {
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

export const SOURCE_TITLES = ['Matrika Lhotka 1850', 'Matrika Lhotka 1880', 'Sčítání 1921', 'Pozemková kniha', 'Rodinný list', 'Kronika obce'];

export function targetTree(rnd: () => number): StromData {
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
export function sourceTree(target: StromData, rnd: () => number): StromData {
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
    // A source under an id the target uses for another source (two trees that
    // once shared an ancestry), cited by a few persons.
    const targetSources = Object.values(target.sources ?? {});
    if (targetSources.length && b.chance(0.3)) {
        const taken = b.pick(targetSources);
        const s = { id: taken.id, title: `${taken.title} – opis`, transcript: 'jiný zápis' } as Source;
        b.data.sources![s.id] = s;
        for (const q of Object.values(b.data.persons)) if (!q.isPlaceholder && b.chance(0.2)) q.sourceIds = [...(q.sourceIds ?? []), s.id];
    }
    // Some of the target's files again (same bytes) at their copies.
    for (const att of Object.values(target.media ?? {})) {
        const at = 'personId' in att.places[0] ? copy.get(att.places[0].personId) : undefined;
        if (at && b.chance(0.5)) b.file(at, att.dataUrl.split(',')[1]);
    }
    return b.data;
}

export function randomDecisions(state: MergeState, rnd: () => number): void {
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

/** References to nothing among persons and couples (the generated trees have none). */
export function dangling(data: StromData): string[] {
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
